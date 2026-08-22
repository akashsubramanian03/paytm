/**
 * "What would change this?"
 *
 * A decline that names what would move it, and by how much, is a plan. A
 * decline that does not is a wall — and for someone with no formal credit
 * history, a wall with no visible door is exactly the experience this product
 * exists to fix.
 *
 * The mechanism is deliberately simple: apply a small, fixed set of hypothetical
 * deltas to a FeatureVector and re-run the real scorecard. No separate model, no
 * approximation — the number quoted is the number the engine would actually
 * produce, which is what makes the promise safe to print.
 *
 * PURE MODULE.
 */
import { scoreUser } from './scorecard.js';
import { applyRules } from './rules.js';

const clone = (fv) => JSON.parse(JSON.stringify(fv));

/**
 * The deltas a person can actually act on. Each is something they could do,
 * expressed in the units they would do it in — not "raise your income
 * stability", which is not an action anyone can take.
 */
export const SCENARIOS = [
  {
    key: 'THREE_MORE_ON_TIME',
    label: 'Pay your next 3 savings-group contributions on time',
    horizonMonths: 3,
    apply: (fv) => {
      fv.group.dueCount += 3;
      fv.group.paidCount += 3;
      fv.group.onTimeCount += 3;
      fv.group.recentDueCount = Math.min(fv.group.recentDueCount + 3, 6);
      return fv;
    },
  },
  {
    key: 'JOIN_A_CIRCLE',
    label: 'Join a savings circle and keep it for 3 months',
    horizonMonths: 3,
    apply: (fv) => {
      if (fv.group.dueCount === 0) {
        fv.group.dueCount = 3;
        fv.group.paidCount = 3;
        fv.group.onTimeCount = 3;
        fv.group.recentDueCount = 3;
        fv.group.activeGroupCount = 1;
        fv.group.monthsInAnyGroup = 3;
      } else {
        fv.group.activeGroupCount += 1;
      }
      return fv;
    },
  },
  {
    key: 'THREE_MORE_MONTHS',
    label: 'Keep using Paytm for 3 more months',
    horizonMonths: 3,
    apply: (fv) => {
      fv.ledger.activeMonths = Math.min(fv.ledger.activeMonths + 3, fv.windowMonths);
      fv.accountTenureMonths += 3;
      return fv;
    },
  },
  {
    key: 'BUILD_BUFFER',
    label: 'Build up two weeks of spending as a buffer',
    horizonMonths: 6,
    apply: (fv) => {
      const n = Math.max(fv.ledger.activeMonths, 1);
      const avgOutflow = Math.round(
        fv.ledger.monthlyOutflowPaise.slice(-n).reduce((a, b) => a + b, 0) / n,
      );
      const target = Math.round((avgOutflow * 14) / 30);
      fv.ledger.currentBalancePaise = Math.max(fv.ledger.currentBalancePaise, target);
      return fv;
    },
  },
  {
    key: 'PAY_BILLS_THROUGH_PAYTM',
    label: 'Pay a bill or recharge through Paytm each month',
    horizonMonths: 3,
    apply: (fv) => {
      const n = Math.max(fv.ledger.activeMonths, 1);
      for (let i = fv.ledger.monthsWithBill.length - Math.min(3, n); i < fv.ledger.monthsWithBill.length; i += 1) {
        if (i >= 0) fv.ledger.monthsWithBill[i] = 1;
      }
      return fv;
    },
  },
];

/**
 * Score each scenario and return only the ones that genuinely help.
 *
 * A scenario that does not move the score is omitted rather than listed with a
 * zero — advice that changes nothing is worse than no advice.
 */
export function whatWouldChange(fv, { limit = 3 } = {}) {
  const base = scoreUser(fv);
  const baseRuled = applyRules(base, fv);

  const results = [];
  for (const scenario of SCENARIOS) {
    const candidate = scenario.apply(clone(fv));
    const scored = scoreUser(candidate);
    const ruled = applyRules(scored, candidate);

    const delta = scored.score - base.score;
    if (delta <= 0 && ruled.band === baseRuled.band && ruled.eligible === baseRuled.eligible) {
      continue;
    }

    results.push({
      key: scenario.key,
      label: scenario.label,
      horizonMonths: scenario.horizonMonths,
      scoreDelta: delta,
      projectedScore: scored.score,
      projectedBand: ruled.band,
      unlocksEligibility: !baseRuled.eligible && ruled.eligible,
      // The category that moved most, so the reason is legible.
      biggestMover: scored.breakdown
        .map((b) => {
          const before = base.breakdown.find((x) => x.category === b.category);
          return { category: b.category, deltaBps: b.contributionBps - (before?.contributionBps ?? 0) };
        })
        .sort((a, b) => b.deltaBps - a.deltaBps)[0],
    });
  }

  return {
    currentScore: base.score,
    currentBand: baseRuled.band,
    eligible: baseRuled.eligible,
    scenarios: results
      .sort((a, b) => Number(b.unlocksEligibility) - Number(a.unlocksEligibility) || b.scoreDelta - a.scoreDelta)
      .slice(0, limit),
  };
}
