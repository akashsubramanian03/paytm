/**
 * Patterns that look like a score being manufactured rather than earned.
 *
 * Every alternative-data score can be gamed, and this one is unusually easy to
 * game in one specific way: two people sending the same money back and forth
 * generate transaction count, counterparty depth and apparent income for both,
 * at zero cost. If that worked, the whole scorecard would be worthless.
 *
 * These flags are SURFACED, not silently punitive. A flag appears on the report
 * as a risk signal a human can read and dispute — circular-looking transfers
 * have innocent explanations (a shared household account, a supplier who is also
 * a customer), and a system that quietly downgraded people for them would be
 * making an accusation it cannot support.
 *
 * PURE MODULE.
 */
import { ANOMALY_KIND } from '../constants.js';
import { clampBps, medianInt, ratioBps } from '../util/stats.js';

/**
 * An UNCLAMPED ratio in basis points.
 *
 * ratioBps() clamps to 10000 because everywhere else in the engine a ratio is a
 * share of a whole and cannot exceed 100%. A velocity spike is the opposite
 * case: the whole point is the multiple, and a 7x burst clamped to 1x would be
 * invisible to exactly the check meant to catch it.
 */
const multipleBps = (value, baseline) =>
  Math.round((Math.trunc(value) * 10_000) / Math.max(Math.trunc(baseline), 1));

/** Money that goes out to someone and comes back from them, repeatedly, at
 *  close to the same size. */
export function detectCircularTransfers(entries, { minRoundTrips = 4, toleranceBps = 1500 } = {}) {
  const byCounterparty = new Map();
  for (const e of entries) {
    if (!e.counterpartyId) continue;
    if ((e.metadata ?? '').includes('GROUP_CONTRIBUTION')) continue; // a circle IS circular, legitimately
    if (!byCounterparty.has(e.counterpartyId)) byCounterparty.set(e.counterpartyId, []);
    byCounterparty.get(e.counterpartyId).push(e);
  }

  const flags = [];
  for (const [counterpartyId, rows] of byCounterparty) {
    const sent = rows.filter((r) => r.direction === 'DEBIT');
    const received = rows.filter((r) => r.direction === 'CREDIT');
    if (sent.length < minRoundTrips || received.length < minRoundTrips) continue;

    const sentMedian = medianInt(sent.map((r) => r.amountPaise));
    const receivedMedian = medianInt(received.map((r) => r.amountPaise));
    if (sentMedian === 0 || receivedMedian === 0) continue;

    // Near-identical amounts in both directions is the tell. Genuine trade is
    // lumpy; wash trading is symmetrical.
    const asymmetryBps = Math.abs(
      Math.round(((sentMedian - receivedMedian) * 10_000) / Math.max(sentMedian, receivedMedian)),
    );
    if (asymmetryBps > toleranceBps) continue;

    const roundTrips = Math.min(sent.length, received.length);
    flags.push({
      kind: ANOMALY_KIND.CIRCULAR_TRANSFER,
      severityBps: clampBps(Math.round((roundTrips * 10_000) / 20) + (1500 - asymmetryBps)),
      evidence: {
        roundTrips,
        sentMedianPaise: sentMedian,
        receivedMedianPaise: receivedMedian,
        asymmetryBps,
        note: 'Money moving back and forth with the same person at near-identical amounts. This has innocent explanations and is shown, not scored.',
      },
    });
  }
  return flags;
}

/** A sudden burst of activity against the subject's own established baseline. */
export function detectVelocitySpike(monthlyCounts, { multiplierBps = 30_000 } = {}) {
  if (monthlyCounts.length < 4) return [];
  const history = monthlyCounts.slice(0, -1);
  const latest = monthlyCounts[monthlyCounts.length - 1];
  const baseline = medianInt(history);
  if (baseline < 5) return []; // too little history to call anything a spike

  const ratio = multipleBps(latest, baseline);
  if (ratio < multiplierBps) return [];

  return [
    {
      kind: ANOMALY_KIND.VELOCITY_SPIKE,
      severityBps: clampBps(ratio - multiplierBps),
      evidence: {
        latestMonthTransactions: latest,
        typicalMonthTransactions: baseline,
        multipleOfNormalBps: ratio,
        note: 'Activity in the most recent month is well above this account’s own norm.',
      },
    },
  ];
}

/** A declared business whose wallet activity does not resemble its claims. */
export function detectBusinessInconsistency({ declaredMonthlyRevenuePaise, observedMonthlyInflowPaise }) {
  if (!declaredMonthlyRevenuePaise || !observedMonthlyInflowPaise) return [];
  const ratio = ratioBps(observedMonthlyInflowPaise, declaredMonthlyRevenuePaise);
  // Under a fifth of declared revenue actually visible is worth a look. Being
  // paid partly in cash is normal, so this is a flag, never a penalty.
  if (ratio >= 2000) return [];
  return [
    {
      kind: ANOMALY_KIND.INCONSISTENT_WITH_BUSINESS,
      severityBps: clampBps(2000 - ratio),
      evidence: {
        declaredMonthlyRevenuePaise,
        observedMonthlyInflowPaise,
        observedShareBps: ratio,
        note: 'Far less money is visible than the business declares. Cash trade explains most of this; it is shown for context, not scored.',
      },
    },
  ];
}

export function detectAnomalies({ entries, monthlyCounts, business, observedMonthlyInflowPaise }) {
  return [
    ...detectCircularTransfers(entries),
    ...detectVelocitySpike(monthlyCounts ?? []),
    ...(business
      ? detectBusinessInconsistency({
          declaredMonthlyRevenuePaise: business.monthlyRevenueEstimatePaise,
          observedMonthlyInflowPaise,
        })
      : []),
  ];
}
