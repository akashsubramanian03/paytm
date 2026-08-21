/**
 * Integer-only statistics for the scoring engine.
 *
 * WHY INTEGERS. Every value the engine computes is stored and compared as
 * BASIS POINTS: an integer from 0 to 10000. Float accumulation is the classic
 * way a "deterministic" scorecard stops being deterministic — 0.1 + 0.2 is
 * reproducible on one machine but the ORDER of a float sum is not always stable
 * once you refactor a reduce into a loop, and a score that shifts by one point
 * between runs destroys the audit story. So: no floats leave this module.
 *
 * Math.sqrt is the single unavoidable float touchpoint (IEEE-754 guarantees a
 * correctly-rounded result for a given double, so it IS deterministic), and
 * intSqrt truncates it back to an integer immediately.
 *
 * This module must stay pure: no Prisma, no Date.now(), no Math.random().
 */
import { BPS_MAX } from '../constants.js';

/** Clamp to the basis-point range. The engine's single most-used helper. */
export function clampBps(value) {
  const n = Math.trunc(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > BPS_MAX) return BPS_MAX;
  return n;
}

export function clamp(value, min, max) {
  const n = Math.trunc(value);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n > max ? max : n;
}

export function sumInt(values) {
  let total = 0;
  for (const v of values) total += Math.trunc(v);
  return total;
}

/** Integer mean, rounded half-up. Returns 0 for an empty list rather than NaN. */
export function meanInt(values) {
  if (!values.length) return 0;
  return Math.round(sumInt(values) / values.length);
}

export function medianInt(values) {
  if (!values.length) return 0;
  const sorted = [...values].map(Math.trunc).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function minInt(values) {
  return values.length ? values.reduce((a, b) => (b < a ? b : a), values[0]) : 0;
}

export function maxInt(values) {
  return values.length ? values.reduce((a, b) => (b > a ? b : a), values[0]) : 0;
}

/** Integer square root: deterministic, and never leaks a float to the caller. */
export function intSqrt(value) {
  const n = Math.trunc(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(Math.sqrt(n));
}

/**
 * `part / whole` expressed in basis points.
 * The denominator is floored at 1 so a subject with no history yields 0 rather
 * than NaN or Infinity — "unmeasured" must never poison a score.
 */
export function ratioBps(part, whole) {
  return clampBps(Math.round((Math.trunc(part) * BPS_MAX) / Math.max(Math.trunc(whole), 1)));
}

/**
 * Coefficient of variation in basis points: stdDev / mean.
 * Higher means more erratic. Callers invert it (10000 - cvBps) to get stability.
 * A mean of 0 (no activity at all) returns BPS_MAX — maximally unstable — which
 * is the honest reading of "we saw nothing".
 */
export function cvBps(values) {
  if (values.length < 2) return BPS_MAX;
  const mean = meanInt(values);
  if (mean <= 0) return BPS_MAX;
  const squaredDiffs = values.map((v) => {
    const d = Math.trunc(v) - mean;
    return d * d;
  });
  const variance = Math.trunc(sumInt(squaredDiffs) / values.length);
  const stdDev = intSqrt(variance);
  return clampBps(Math.round((stdDev * BPS_MAX) / mean));
}

/**
 * Weighted blend of basis-point components.
 * `parts` is [[valueBps, weight], ...] where the weights are small integers that
 * sum to 100 — matching how the scorecard formulas are written in the spec, e.g.
 * (45*stability + 35*coverage + 20*trend) / 100.
 */
export function weightedBps(parts) {
  let numerator = 0;
  let weightTotal = 0;
  for (const [value, weight] of parts) {
    numerator += Math.trunc(value) * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0;
  return clampBps(Math.round(numerator / weightTotal));
}

/** Basis points -> a 0..100 percentage, for display and for the LLM context. */
export function bpsToPct(bps) {
  return Math.round(clampBps(bps) / 100);
}

/**
 * Redistribute the weight of unmeasured categories across the measured ones.
 *
 * Without this a user who has never joined a savings group scores 0 on
 * COMMITMENTS and is PUNISHED for an absence of evidence, when the honest
 * treatment is to score them on what we can actually see. Categories with
 * sampleCount === 0 give their weight away pro rata; the integer remainder goes
 * to the first measured category in `orderedKeys`, which is why that order is
 * fixed in constants.js rather than derived from Object.keys().
 *
 * @param {string[]} orderedKeys      fixed iteration order
 * @param {Record<string, number>} baseWeightsBps
 * @param {Set<string>} measuredKeys  categories that have evidence
 * @returns {{weights: Record<string, number>, redistributed: string[]}}
 */
export function redistributeWeights(orderedKeys, baseWeightsBps, measuredKeys) {
  const measured = orderedKeys.filter((k) => measuredKeys.has(k));
  const unmeasured = orderedKeys.filter((k) => !measuredKeys.has(k));

  // Nothing to move, or nothing to move it to (every category unmeasured —
  // the score will be 0 and a gate will catch it).
  if (!unmeasured.length || !measured.length) {
    return { weights: { ...baseWeightsBps }, redistributed: [] };
  }

  const freed = sumInt(unmeasured.map((k) => baseWeightsBps[k]));
  const measuredTotal = sumInt(measured.map((k) => baseWeightsBps[k]));

  const weights = {};
  for (const key of unmeasured) weights[key] = 0;

  let assigned = 0;
  for (const key of measured) {
    const share = Math.trunc((freed * baseWeightsBps[key]) / Math.max(measuredTotal, 1));
    weights[key] = baseWeightsBps[key] + share;
    assigned += share;
  }

  // The remainder from integer division lands on the first measured category in
  // the fixed order, so the weights still sum to exactly 10000.
  weights[measured[0]] += freed - assigned;

  return { weights, redistributed: unmeasured };
}
