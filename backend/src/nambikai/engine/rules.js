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
