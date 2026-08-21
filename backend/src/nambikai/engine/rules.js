/**
 * The rule engine: hard gates applied AFTER the score.
 *
 * A scorecard blends. Some facts should not be blended away — three months of
 * history is not "a bit less" than eighteen, it is not enough, and no amount of
 * strength elsewhere should paper over it. Those live here.
 *
 * THE ONE-WAY PROPERTY. Every gate goes through worseOf(), so a rule can lower a
 * band and can never raise one. This is structural rather than conventional: a
 * rule that could improve a band would be a back door around the scorecard, and
 * a way to launder a good outcome for someone the arithmetic did not support.
 * A test generates hundreds of score results and asserts bandRank never falls.
 *
 * WHY GATES ARE ANNOUNCED. A gate that quietly caps someone is the black-box
 * failure mode this whole layer exists to avoid. Each triggered gate emits a
 * named reason code with the numbers behind it, and `eligible: false` is stated
 * outright rather than being disguised as a low score.
 *
 * PURE MODULE.
 */
import { RISK_BAND } from '../constants.js';
import { emit, inCatalogueOrder } from './reasonCodes.js';
import { bandRank, worseOf } from './bands.js';

/**
 * Each gate declares the condition it fires on and the band it forces.
 * Keeping them as data rather than a chain of ifs makes the whole policy
 * readable in one screen — which is the point of having it written down.
 */
const GATES = [
  {
    code: 'GATE_INSUFFICIENT_HISTORY',
    floor: RISK_BAND.HIGH,
    // Not a judgement. "We cannot say yet" is the honest answer, and saying it
    // plainly is better than emitting a confident-looking low number.
    blocksEligibility: true,
    test: (fv) => fv.ledger.activeMonths < 3,
    evidence: (fv) => ({ monthsObserved: fv.ledger.activeMonths, monthsRequired: 3 }),
  },
  {
    code: 'GATE_DORMANT',
    floor: RISK_BAND.HIGH,
    test: (fv) => fv.ledger.daysSinceLastActivity !== null && fv.ledger.daysSinceLastActivity > 60,
    evidence: (fv) => ({ daysSinceLastActivity: fv.ledger.daysSinceLastActivity }),
  },
  {
    code: 'GATE_MISSED_COMMITMENTS',
    floor: RISK_BAND.MEDIUM,
    // Recent misses, not lifetime ones. Someone who slipped a year ago and has
    // been reliable since should not be held at a floor forever.
    test: (fv) => fv.group.recentMissedCount >= 2,
    evidence: (fv) => ({
      recentMissed: fv.group.recentMissedCount,
      recentCycles: fv.group.recentDueCount,
    }),
  },
  {
    code: 'GATE_NEGATIVE_TREND',
    floor: RISK_BAND.MEDIUM,
    // Both halves must hold. Spending more than you earn while sitting on a
    // healthy buffer is a choice; doing it with nothing in reserve is a risk.
    test: (fv) => {
      const n = Math.max(fv.ledger.activeMonths, 1);
      const inflows = fv.ledger.monthlyInflowPaise.slice(-Math.min(3, n));
      const outflows = fv.ledger.monthlyOutflowPaise.slice(-Math.min(3, n));
      const net = inflows.reduce((sum, v, i) => sum + (v - outflows[i]), 0);
      const avgMonthlyOutflow = Math.round(
        fv.ledger.monthlyOutflowPaise.slice(-n).reduce((a, b) => a + b, 0) / n,
      );
      const bufferDays = Math.round(
        (fv.ledger.currentBalancePaise * 30) / Math.max(avgMonthlyOutflow, 1),
      );
      return net < 0 && bufferDays < 7;
    },
    evidence: (fv) => {
      const n = Math.max(fv.ledger.activeMonths, 1);
      const avgMonthlyOutflow = Math.round(
        fv.ledger.monthlyOutflowPaise.slice(-n).reduce((a, b) => a + b, 0) / n,
      );
      return {
        bufferDays: Math.round(
          (fv.ledger.currentBalancePaise * 30) / Math.max(avgMonthlyOutflow, 1),
        ),
        currentBalancePaise: fv.ledger.currentBalancePaise,
      };
    },
  },
];

/**
 * Gates for a business. Same one-way property: they can only ever worsen a band.
 * Applied only when a business feature vector is supplied, so an individual
 * assessment can never be caught by an SME rule.
 */
/** At least this many of the six categories must have real evidence. */
const SME_MIN_MEASURED_CATEGORIES = 3;

const SME_GATES = [
  {
    /**
     * The counterpart to weight redistribution, and the reason it is safe.
     *
     * Redistribution stops an absence being counted AGAINST a business. Without
     * this gate it would start counting absence FOR them: an unregistered stall
     * with no invoices and no filings would be scored on two categories and
     * could come out LOW risk on almost no evidence. Absence should be neither
     * a penalty nor a reward — it should be an honest "not enough to say".
     */
    code: 'GATE_SME_INSUFFICIENT_DATA',
    test: (bf, scoreResult) =>
      (scoreResult?.breakdown ?? []).filter((b) => b.measured).length < SME_MIN_MEASURED_CATEGORIES,
    floor: () => RISK_BAND.MEDIUM,
    blocksEligibility: true,
    evidence: (bf, scoreResult) => ({
      measuredCategories: (scoreResult?.breakdown ?? []).filter((b) => b.measured).length,
      categoriesRequired: SME_MIN_MEASURED_CATEGORIES,
      unmeasured: (scoreResult?.breakdown ?? [])
        .filter((b) => !b.measured)
        .map((b) => b.category),
    }),
  },
  {
    code: 'GATE_SME_OVERLEVERAGED',
    test: (bf) => bf.existingDebtEstimatePaise > bf.monthlyRevenueEstimatePaise * 6,
    floor: (bf) =>
      bf.existingDebtEstimatePaise > bf.monthlyRevenueEstimatePaise * 12
        ? RISK_BAND.HIGH
        : RISK_BAND.MEDIUM,
    evidence: (bf) => ({
      debtInMonthsOfRevenue:
        Math.round((bf.existingDebtEstimatePaise * 100) / Math.max(bf.monthlyRevenueEstimatePaise, 1)) / 100,
    }),
  },
  {
    code: 'GATE_SME_GST_LAPSED',
    test: (bf) => bf.isRegistered && bf.recentLate >= 2,
    floor: () => RISK_BAND.MEDIUM,
    evidence: (bf) => ({ lateInLastSix: bf.recentLate, filings: bf.filingCount }),
  },
];

export function applySmeRules(scoreResult, bf) {
  let band = scoreResult.band;
  let eligible = true;
  const gates = [];
  const codes = [];

  for (const gate of SME_GATES) {
    const triggered = Boolean(gate.test(bf, scoreResult));
    const floor = triggered ? gate.floor(bf) : null;
    gates.push({
      code: gate.code,
      triggered,
      effect: triggered ? `band floored at ${floor}` : null,
      evidence: triggered ? gate.evidence(bf, scoreResult) : null,
    });
    if (!triggered) continue;
    band = worseOf(band, floor);
    if (gate.blocksEligibility) eligible = false;
    codes.push(emit(gate.code, gate.evidence(bf, scoreResult)));
  }

  if (bandRank(band) < bandRank(scoreResult.band)) band = scoreResult.band;

  return {
    band,
    bandBeforeGates: scoreResult.band,
    downgraded: band !== scoreResult.band,
    eligible,
    gates,
    reasonCodes: inCatalogueOrder(codes),
  };
}

export function applyRules(scoreResult, fv) {
  let band = scoreResult.band;
  let eligible = true;
  const gates = [];
  const codes = [];

  for (const gate of GATES) {
    const triggered = Boolean(gate.test(fv));
    gates.push({
      code: gate.code,
      triggered,
      effect: triggered ? `band floored at ${gate.floor}` : null,
      evidence: triggered ? gate.evidence(fv) : null,
    });

    if (!triggered) continue;

    // The one-way ratchet. worseOf can only move the band in one direction.
    band = worseOf(band, gate.floor);
    if (gate.blocksEligibility) eligible = false;
    codes.push(emit(gate.code, gate.evidence(fv)));
  }

  // Belt and braces: even if a future gate forgot worseOf, this holds the line.
  if (bandRank(band) < bandRank(scoreResult.band)) band = scoreResult.band;

  return {
    band,
    bandBeforeGates: scoreResult.band,
    downgraded: band !== scoreResult.band,
    eligible,
    gates,
    reasonCodes: inCatalogueOrder(codes),
  };
}
