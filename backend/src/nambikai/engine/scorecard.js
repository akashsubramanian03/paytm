/**
 * The scorecard. THIS is where the risk assessment happens.
 *
 * Everything downstream — the rule engine, the LLM explainer, the report — reads
 * this output. Nothing downstream may change the number. That is the hard
 * constraint the whole architecture rests on: the part that decides is
 * auditable, reproducible and made of arithmetic you can check by hand, and the
 * part that writes English only ever describes it.
 *
 * FAIRNESS PROPERTIES, EACH DELIBERATE:
 *
 *  1. ABSENCE OF EVIDENCE IS NOT EVIDENCE OF RISK. A category with no data has
 *     its weight redistributed across the categories that do, rather than
 *     scoring zero. Someone who has never joined a savings circle is unmeasured
 *     on commitments, not bad at them.
 *
 *  2. NOTHING IS SCORED THAT A PERSON CANNOT CHANGE. There is no location, no
 *     name, no age, no counterparty identity, no device — nothing that could act
 *     as a proxy for something protected. Every input is a behaviour.
 *
 *  3. ONLY MONTHS THE SUBJECT EXISTED FOR ARE COUNTED. The monthly arrays are
 *     fixed-length so variance divides by a constant; the empty months before an
 *     account opened are sliced off rather than counted as failures.
 *
 *  4. SUB-SIGNALS REDISTRIBUTE TOO. Inside a category, a component with nothing
 *     to measure (no peer loans observed, say) gives its weight to its siblings
 *     instead of dragging the category down.
 *
 *  5. EVERY MATERIAL CONTRIBUTION EMITS A REASON CODE with the numbers behind
 *     it, so the score is an argument rather than an assertion.
 *
 *  6. ONE ROUNDING, AT THE END. All intermediate maths is integer basis points.
 *
 * PURE MODULE — no Prisma, no Date.now(), no Math.random(). Enforced by a test
 * that reads this file as text. It also must not import engine/cluster.js: the
 * individual score is never allowed to see group-level data.
 */
import {
  BPS_MAX,
  CATEGORY,
  CATEGORY_KEYS,
  CATEGORY_WEIGHTS_BPS,
} from '../constants.js';
import {
  clamp,
  clampBps,
  cvBps,
  meanInt,
  minInt,
  ratioBps,
  redistributeWeights,
  sumInt,
  weightedBps,
} from '../util/stats.js';
import { emit, inCatalogueOrder } from './reasonCodes.js';
import { scoreToBand, scoreToGrade } from './bands.js';
import { recent } from './signals.js';

/** Blend sub-signals, dropping any that had nothing to measure. weightedBps
 *  divides by the weight actually supplied, so dropping a part redistributes
 *  its weight across its siblings pro rata. */
const blend = (parts) => weightedBps(parts.filter(([value]) => value !== null));

/* ------------------------------------------------------------ categories -- */

function incomeStability(fv, codes) {
  const { ledger } = fv;
  const n = Math.max(ledger.activeMonths, 1);
  const inflows = recent(ledger.monthlyInflowPaise, n);
  const withIncome = recent(ledger.monthsWithIncome, n);

  const monthsWithIncome = sumInt(withIncome);
  const coverageBps = ratioBps(monthsWithIncome, n);
  const volatilityBps = cvBps(inflows);
  const stabilityBps = clampBps(BPS_MAX - volatilityBps);

  // Direction of travel: the last three months against the three before them.
  const recent3 = meanInt(recent(inflows, 3));
  const prior3 = inflows.length >= 6 ? meanInt(inflows.slice(-6, -3)) : null;
  const trendBps =
    prior3 === null
      ? null
      : clampBps(5000 + Math.round(((recent3 - prior3) * 5000) / Math.max(prior3, 1)));

  let rawBps = blend([
    [stabilityBps, 45],
    [coverageBps, 35],
    [trendBps, 20],
  ]);

  const evidence = { monthsObserved: n, monthsWithIncome, volatilityBps, coverageBps };

  // Too little history to make a claim either way. Capping is honest: it says
  // "we cannot see enough", not "you are bad".
  if (n < 3) {
    rawBps = Math.min(rawBps, 4000);
    codes.push(emit('THIN_FILE_INCOME', { ...evidence, cappedAtBps: 4000 }));
  } else if (stabilityBps >= 7000) {
    codes.push(emit('INCOME_STEADY', { ...evidence, stabilityBps }));
  } else if (stabilityBps < 5000) {
    codes.push(emit('INCOME_VOLATILE', { ...evidence, stabilityBps }));
  }

  if (n >= 3 && monthsWithIncome < n) {
    codes.push(emit('INCOME_GAPS', { ...evidence, monthsWithoutIncome: n - monthsWithIncome }));
  }
  if (trendBps !== null && trendBps >= 6500) {
    codes.push(emit('INCOME_TREND_UP', { recentThreeMonthMeanPaise: recent3, priorThreeMonthMeanPaise: prior3 }));
  } else if (trendBps !== null && trendBps <= 3500) {
    codes.push(emit('INCOME_TREND_DOWN', { recentThreeMonthMeanPaise: recent3, priorThreeMonthMeanPaise: prior3 }));
  }

  return { rawBps, sampleCount: n, evidence };
}

function savingsConsistency(fv, codes) {
  const { ledger, group } = fv;
  const n = Math.max(ledger.activeMonths, 1);
  const inflows = recent(ledger.monthlyInflowPaise, n);
  const outflows = recent(ledger.monthlyOutflowPaise, n);
  const monthEnds = recent(ledger.monthEndBalancePaise, n);

  // outflows already exclude circle contributions (see ledger.features.js), so
  // a month where someone earned, spent less than they earned, and put the rest
  // into a chit reads as a saving month — which is what it is.
  const savingsRates = inflows.map((inflow, i) =>
    clampBps(Math.round(((inflow - outflows[i]) * BPS_MAX) / Math.max(inflow, 1))),
  );
  const avgSavingsRateBps = meanInt(savingsRates);
  const positiveMonths = inflows.filter((inflow, i) => inflow - outflows[i] >= 0).length;
  const regularityBps = ratioBps(positiveMonths, n);

  const totalOutflow = sumInt(outflows);
  const avgMonthlyOutflow = Math.round(totalOutflow / n);
  const floorBps = clampBps(
    Math.round((minInt(monthEnds) * BPS_MAX) / Math.max(avgMonthlyOutflow, 1)),
  );

  // Money put into a savings circle is saving, even though it left the wallet.
  // Without this the most disciplined behaviour in the product would read as
  // spending.
  const totalInflow = sumInt(inflows);
  const groupBonusBps = clampBps(
    Math.round((group.savedPaise * 40000) / Math.max(totalInflow, 1)),
  );

  const rawBps = blend([
    [avgSavingsRateBps, 35],
    [regularityBps, 25],
    [floorBps, 20],
    [groupBonusBps, 20],
  ]);

  const evidence = {
    monthsObserved: n,
    monthsSavedSomething: positiveMonths,
    avgSavingsRateBps,
    groupSavedPaise: group.savedPaise,
  };

  if (positiveMonths * 2 < n) {
    codes.push(emit('NEGATIVE_NET_FLOW', { ...evidence, monthsSpentMoreThanEarned: n - positiveMonths }));
  } else if (avgSavingsRateBps >= 1500) {
    codes.push(emit('SAVINGS_CONSISTENT', evidence));
  } else if (avgSavingsRateBps < 500) {
    codes.push(emit('SAVINGS_THIN', evidence));
  }
  if (groupBonusBps >= 3000) {
    codes.push(emit('GROUP_SAVINGS_STRONG', { groupSavedPaise: group.savedPaise, groupBonusBps }));
  }

  return { rawBps, sampleCount: n, evidence };
}

function paymentBehaviour(fv, codes) {
  const { ledger } = fv;
  const n = Math.max(ledger.activeMonths, 1);
  const withBill = recent(ledger.monthsWithBill, n);
  const withRecharge = recent(ledger.monthsWithRecharge, n);

  // One combined signal, not two. See signals.js for why.
  const formalMonths = withBill.filter((had, i) => had === 1 || withRecharge[i] === 1).length;
  const formalRegularityBps = ratioBps(formalMonths, n);

  const failureRateBps = ratioBps(ledger.failedCount, ledger.entryCount);
  const reliabilityBps = clampBps(BPS_MAX - failureRateBps * 5);
  const strainBps = clampBps(
    BPS_MAX - Math.round((ledger.lowBalanceCount * 20000) / Math.max(ledger.entryCount, 1)),
  );

  const rawBps = blend([
    [formalRegularityBps, 45],
    [reliabilityBps, 30],
    [strainBps, 25],
  ]);

  const evidence = {
    monthsObserved: n,
    monthsWithFormalPayment: formalMonths,
    transactionCount: ledger.entryCount,
    failedCount: ledger.failedCount,
    lowBalanceCount: ledger.lowBalanceCount,
  };

  if (formalRegularityBps >= 7500) codes.push(emit('BILLS_REGULAR', evidence));
  else if (formalRegularityBps < 4000) codes.push(emit('BILLS_IRREGULAR', evidence));
  if (strainBps < 6000) codes.push(emit('PAYMENT_STRAIN', { ...evidence, strainBps }));
  if (ledger.failedCount > 0) codes.push(emit('PAYMENT_FAILURES', { failedCount: ledger.failedCount }));

  return { rawBps, sampleCount: ledger.entryCount, evidence };
}

function commitments(fv, codes) {
  const { group } = fv;
  const evidence = {
    settledCycles: group.dueCount,
    onTime: group.onTimeCount,
    late: group.lateCount,
    missed: group.missedCount,
    activeGroups: group.activeGroupCount,
    monthsInAnyGroup: group.monthsInAnyGroup,
  };

  // No circle, no evidence. Score nothing and let the weight move elsewhere —
  // this is the single most important fairness decision in the file, because
  // COMMITMENTS is the heaviest behavioural category and a zero here would
  // quietly punish everyone who has simply never joined a group.
  if (group.dueCount === 0) {
    codes.push(emit('NO_GROUP_HISTORY', evidence));
    return { rawBps: 0, sampleCount: 0, evidence };
  }

  const onTimeBps = ratioBps(group.onTimeCount, group.dueCount);
  const missBps = ratioBps(group.missedCount, group.dueCount);
  const latenessPenBps = clamp(group.avgDaysLate * 300, 0, 6000);
  const tenureBps = clampBps(Math.round((group.monthsInAnyGroup * BPS_MAX) / 18));
  const breadthBps = clampBps(Math.round((group.activeGroupCount * BPS_MAX) / 3));

  const base = weightedBps([
    [onTimeBps, 50],
    [tenureBps, 25],
    [breadthBps, 25],
  ]);
  const penalty = weightedBps([
    [latenessPenBps, 25],
    [missBps, 75],
  ]);
  const rawBps = clampBps(base - penalty);

  if (group.missedCount === 0 && group.lateCount === 0) {
    codes.push(emit('GROUP_PERFECT_RECORD', evidence));
  } else if (onTimeBps >= 8000) {
    codes.push(emit('GROUP_ON_TIME_STREAK', { ...evidence, onTimeBps }));
  }
  if (group.monthsInAnyGroup >= 12) {
    codes.push(emit('GROUP_TENURE_LONG', { monthsInAnyGroup: group.monthsInAnyGroup }));
  }
  if (group.activeGroupCount >= 2) {
    codes.push(emit('GROUP_MULTIPLE', { activeGroups: group.activeGroupCount }));
  }
  if (group.lateCount > 0 && group.avgDaysLate >= 2) {
    codes.push(emit('GROUP_LATE_PATTERN', { late: group.lateCount, avgDaysLate: group.avgDaysLate }));
  }
  if (group.missedCount > 0) {
    codes.push(emit('GROUP_MISSED', { missed: group.missedCount, settledCycles: group.dueCount }));
  }
  if (group.recentMissedCount >= 2) {
    codes.push(
      emit('GROUP_RECENT_MISSES', {
        recentMissed: group.recentMissedCount,
        recentCycles: group.recentDueCount,
      }),
    );
  }

  return { rawBps, sampleCount: group.dueCount, evidence };
}

function creditHistory(fv, codes) {
  const { ledger } = fv;
  const tenureMonths = fv.accountTenureMonths;
  const tenureBps = clampBps(Math.round((tenureMonths * BPS_MAX) / 24));
  const depthBps = clampBps(Math.round((ledger.distinctCounterparties * BPS_MAX) / 12));

  // Inferring a loan from a pattern of transfers is genuinely uncertain — a
  // gift, a refund and a debt all look alike from the outside. So this
  // sub-signal demands real evidence before it is allowed to count at all:
  // fewer than three loan-shaped events and it steps aside entirely, giving its
  // weight to tenure and depth rather than guessing. Penalising someone on a
  // handful of ambiguous transfers is not a judgement this engine should make.
  const MIN_LOAN_EVIDENCE = 3;
  const repaymentBps =
    ledger.borrowLikeEvents >= MIN_LOAN_EVIDENCE
      ? ratioBps(ledger.repaidEvents, ledger.borrowLikeEvents)
      : null;

  const rawBps = blend([
    [tenureBps, 40],
    [repaymentBps, 40],
    [depthBps, 20],
  ]);

  const evidence = {
    accountTenureMonths: tenureMonths,
    distinctCounterparties: ledger.distinctCounterparties,
    peerLoansObserved: ledger.borrowLikeEvents,
    peerLoansRepaid: ledger.repaidEvents,
  };

  // Always emitted. Nobody should ever be left to assume a bureau was consulted.
  codes.push(emit('NO_FORMAL_CREDIT', evidence));

  if (tenureMonths >= 18) codes.push(emit('TENURE_ESTABLISHED', { accountTenureMonths: tenureMonths }));
  else if (tenureMonths < 6) codes.push(emit('TENURE_SHORT', { accountTenureMonths: tenureMonths }));
  if (repaymentBps !== null && repaymentBps >= 8000) {
    codes.push(emit('PEER_REPAYMENT_STRONG', evidence));
  } else if (repaymentBps !== null && repaymentBps < 4000) {
    codes.push(emit('PEER_REPAYMENT_WEAK', evidence));
  }
  if (depthBps >= 7500) {
    codes.push(emit('COUNTERPARTY_DEPTH', { distinctCounterparties: ledger.distinctCounterparties }));
  }

  return { rawBps, sampleCount: Math.max(tenureMonths, 1), evidence };
}

function emergencyBuffer(fv, codes) {
  const { ledger } = fv;
  const n = Math.max(ledger.activeMonths, 1);
  const outflows = recent(ledger.monthlyOutflowPaise, n);
  const monthEnds = recent(ledger.monthEndBalancePaise, n);

  const avgMonthlyOutflow = Math.round(sumInt(outflows) / n);
  const bufferDays = Math.round(
    (ledger.currentBalancePaise * 30) / Math.max(avgMonthlyOutflow, 1),
  );
  const bufferBps = clampBps(Math.round((bufferDays * BPS_MAX) / 45));
  const avgMonthEnd = meanInt(monthEnds);
  const bufferStabBps = clampBps(
    Math.round((minInt(monthEnds) * BPS_MAX) / Math.max(avgMonthEnd, 1)),
  );

  const rawBps = blend([
    [bufferBps, 70],
    [bufferStabBps, 30],
  ]);

  const evidence = {
    bufferDays,
    currentBalancePaise: ledger.currentBalancePaise,
    avgMonthlyOutflowPaise: avgMonthlyOutflow,
    lowestMonthEndPaise: minInt(monthEnds),
  };

  if (bufferDays >= 45) codes.push(emit('BUFFER_HEALTHY', evidence));
  else if (bufferDays < 14) codes.push(emit('LOW_EMERGENCY_BUFFER', evidence));
  if (bufferStabBps < 3000) codes.push(emit('BUFFER_VOLATILE', { ...evidence, bufferStabBps }));

  return { rawBps, sampleCount: n, evidence };
}

const CATEGORY_FN = {
  [CATEGORY.INCOME_STABILITY]: incomeStability,
  [CATEGORY.SAVINGS_CONSISTENCY]: savingsConsistency,
  [CATEGORY.PAYMENT_BEHAVIOUR]: paymentBehaviour,
  [CATEGORY.COMMITMENTS]: commitments,
  [CATEGORY.CREDIT_HISTORY]: creditHistory,
  [CATEGORY.EMERGENCY_BUFFER]: emergencyBuffer,
};

/* ---------------------------------------------------------------- score --- */

export function scoreUser(fv) {
  const codes = [];
  const parts = {};

  // Fixed iteration order. Never Object.keys() of anything built from database
  // rows — that is one of the three classic ways a "deterministic" engine stops
  // being deterministic.
  for (const key of CATEGORY_KEYS) parts[key] = CATEGORY_FN[key](fv, codes);

  const measured = new Set(CATEGORY_KEYS.filter((key) => parts[key].sampleCount > 0));
  const { weights, redistributed } = redistributeWeights(
    CATEGORY_KEYS,
    CATEGORY_WEIGHTS_BPS,
    measured,
  );

  if (redistributed.length) {
    codes.push(
      emit('WEIGHT_REDISTRIBUTED', {
        unmeasuredCategories: redistributed,
        // Shown verbatim in the UI so the adjustment is visible, not implied.
        adjustedWeightsBps: weights,
      }),
    );
  }

  const breakdown = CATEGORY_KEYS.map((key) => {
    const weightBps = weights[key];
    const rawBps = parts[key].rawBps;
    const contributionBps = Math.round((rawBps * weightBps) / BPS_MAX);
    return {
      category: key,
      weightBps,
      baseWeightBps: CATEGORY_WEIGHTS_BPS[key],
      rawBps,
      contributionBps,
      sampleCount: parts[key].sampleCount,
      measured: measured.has(key),
      evidence: parts[key].evidence,
      reasonCodes: codes.filter((c) => c.category === key).map((c) => c.code),
    };
  });

  // ONE rounding, at the very end. Rounding per-category would let the error
  // compound and would make the arithmetic impossible to check by hand.
  const score = clamp(Math.round(sumInt(breakdown.map((b) => b.contributionBps)) / 100), 0, 100);

  return {
    score,
    band: scoreToBand(score),
    grade: scoreToGrade(score),
    breakdown,
    reasonCodes: inCatalogueOrder(codes),
    /**
     * Set here and ONLY here. underwrite.pipeline.js asserts this flag before it
     * will attach a cluster signal to a report. Anyone wiring group-level data
     * into the individual score has to delete that assertion to compile, which
     * makes the change visible in review instead of silent.
     */
    computedWithoutClusterData: true,
  };
}
