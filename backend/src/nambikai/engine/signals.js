/**
 * The four behaviour signals, derived from a FeatureVector.
 *
 * These are the persisted, human-legible summaries a partner or a user can be
 * shown on their own ("your savings consistency is 71%"), independent of how the
 * scorecard happens to weight them today. Keeping them separate from the
 * scorecard means the weights can be retuned without changing what a signal
 * MEANS — and a stored signal from six months ago is still interpretable.
 *
 * PURE MODULE. No Prisma, no clock, no randomness, integer basis points only.
 */
import { SIGNAL_KEY } from '../constants.js';
import { clampBps, cvBps, meanInt, minInt, ratioBps, weightedBps } from '../util/stats.js';

/**
 * Only the months the subject actually existed for.
 *
 * The monthly arrays are always a fixed length so variance maths divides by a
 * constant, but months BEFORE an account existed are zeros. Counting those as
 * "months with no income" would punish a new user for the calendar, so every
 * calculation below slices to the months that are really theirs.
 */
export const recent = (values, n) => (n >= values.length ? values : values.slice(values.length - n));

export function computeSignals(fv) {
  const { ledger, group } = fv;
  const n = Math.max(ledger.activeMonths, 1);

  const inflows = recent(ledger.monthlyInflowPaise, n);
  const outflows = recent(ledger.monthlyOutflowPaise, n);
  const monthEnds = recent(ledger.monthEndBalancePaise, n);
  const withIncome = recent(ledger.monthsWithIncome, n);

  /* ---- income stability ---- */
  const coverageBps = ratioBps(
    withIncome.reduce((a, b) => a + b, 0),
    n,
  );
  const stabilityBps = clampBps(10000 - cvBps(inflows));
  const incomeStabilityBps = weightedBps([
    [stabilityBps, 60],
    [coverageBps, 40],
  ]);

  /* ---- savings consistency ---- */
  const savingsRates = inflows.map((inflow, i) =>
    clampBps(Math.round(((inflow - outflows[i]) * 10000) / Math.max(inflow, 1))),
  );
  const positiveMonths = inflows.filter((inflow, i) => inflow - outflows[i] >= 0).length;
  const savingsConsistencyBps = weightedBps([
    [meanInt(savingsRates), 60],
    [ratioBps(positiveMonths, n), 40],
  ]);

  /* ---- payment consistency ---- */
  // Bills and recharges are treated as one signal: "did something formal get
  // paid this month". Scoring them separately would punish a person twice for
  // the single fact of not having a broadband connection.
  const formalMonths = recent(ledger.monthsWithBill, n).filter(
    (had, i) => had === 1 || recent(ledger.monthsWithRecharge, n)[i] === 1,
  ).length;
  const failureRateBps = ratioBps(ledger.failedCount, ledger.entryCount);
  const paymentConsistencyBps = weightedBps([
    [ratioBps(formalMonths, n), 60],
    [clampBps(10000 - failureRateBps * 5), 40],
  ]);

  /* ---- repayment behaviour ---- */
  // Two distinct kinds of promise: money returned to a person, and a
  // contribution owed to a circle. Both are repayment in the sense that matters.
  const peerBps = ledger.borrowLikeEvents
    ? ratioBps(ledger.repaidEvents, ledger.borrowLikeEvents)
    : null;
  const commitmentBps = group.dueCount ? ratioBps(group.onTimeCount, group.dueCount) : null;
  const repaymentParts = [
    ...(peerBps === null ? [] : [[peerBps, 40]]),
    ...(commitmentBps === null ? [] : [[commitmentBps, 60]]),
  ];
  const repaymentBehaviourBps = repaymentParts.length ? weightedBps(repaymentParts) : 0;

  return {
    [SIGNAL_KEY.INCOME_STABILITY]: {
      valueBps: incomeStabilityBps,
      sampleCount: n,
      evidence: {
        monthsObserved: n,
        monthsWithIncome: withIncome.reduce((a, b) => a + b, 0),
        volatilityBps: cvBps(inflows),
        meanMonthlyInflowPaise: meanInt(inflows),
      },
    },
    [SIGNAL_KEY.SAVINGS_CONSISTENCY]: {
      valueBps: savingsConsistencyBps,
      sampleCount: n,
      evidence: {
        monthsObserved: n,
        monthsSavedSomething: positiveMonths,
        meanSavingsRateBps: meanInt(savingsRates),
        lowestMonthEndPaise: minInt(monthEnds),
      },
    },
    [SIGNAL_KEY.PAYMENT_CONSISTENCY]: {
      valueBps: paymentConsistencyBps,
      sampleCount: ledger.entryCount,
      evidence: {
        monthsObserved: n,
        monthsWithFormalPayment: formalMonths,
        transactionCount: ledger.entryCount,
        failedCount: ledger.failedCount,
      },
    },
    [SIGNAL_KEY.REPAYMENT_BEHAVIOUR]: {
      valueBps: repaymentBehaviourBps,
      sampleCount: (group.dueCount ?? 0) + (ledger.borrowLikeEvents ?? 0),
      evidence: {
        contributionsSettled: group.dueCount,
        contributionsOnTime: group.onTimeCount,
        peerLoansObserved: ledger.borrowLikeEvents,
        peerLoansRepaid: ledger.repaidEvents,
      },
    },
  };
}
