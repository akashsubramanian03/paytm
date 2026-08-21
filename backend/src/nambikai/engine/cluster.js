/**
 * Cluster reliability. PURE MODULE.
 *
 * READ THE GUARDRAILS IN ../README.md BEFORE CHANGING ANY OF THIS.
 *
 * A cluster is exactly one thing: a savings group with enough members and enough
 * completed cycles to say something meaningful. There is no inferred cohort, no
 * behavioural segment, no geographic grouping — that is a deliberate constraint,
 * not a missing feature. Inferred clusters are precisely where proxy
 * discrimination hides: a "cluster" derived from where people live or who they
 * pay is a protected characteristic wearing a different name.
 *
 * Two properties are load-bearing:
 *
 *  1. THE SUBJECT IS EXCLUDED from their own cluster aggregate. Otherwise a
 *     reliable person's own behaviour would inflate the group number that is
 *     then reported alongside them — counting them twice and making the signal
 *     look independent when it is not.
 *
 *  2. THIN EVIDENCE PRODUCES NULL, NEVER A NUMBER. A group with six
 *     observations does not get a confident-looking percentage. Fabricating one
 *     would be worse than saying nothing, because a number invites reliance.
 *
 * This module must never be imported by engine/scorecard.js. A test reads the
 * source and fails if it ever is.
 */
import {
  CLUSTER_BAND,
  CLUSTER_BAND_THRESHOLDS,
  CLUSTER_MIN_ACTIVE_MEMBERS,
  CLUSTER_MIN_OBSERVATIONS,
  CONTRIB_STATUS,
} from '../constants.js';
import { clampBps, ratioBps } from '../util/stats.js';

export function bandFor(reliabilityBps) {
  if (reliabilityBps >= CLUSTER_BAND_THRESHOLDS.POSITIVE_MIN) return CLUSTER_BAND.POSITIVE;
  if (reliabilityBps >= CLUSTER_BAND_THRESHOLDS.NEUTRAL_MIN) return CLUSTER_BAND.NEUTRAL;
  return CLUSTER_BAND.CAUTION;
}

/**
 * @param {object} input
 * @param {Array}  input.contributions  settled contributions, SUBJECT ALREADY EXCLUDED
 * @param {number} input.activeMembers
 * @param {number} input.everMembers
 * @param {number} input.completedCycles
 * @returns {{reliabilityBps, band, ...}|null} null when the evidence is too thin
 */
export function computeClusterReliability({
  contributions,
  activeMembers,
  everMembers,
  completedCycles,
}) {
  const settled = contributions.filter(
    (c) => c.status === CONTRIB_STATUS.PAID || c.status === CONTRIB_STATUS.MISSED,
  );

  // The evidence gate. Below it, there is no number — only an honest absence.
  if (settled.length < CLUSTER_MIN_OBSERVATIONS || activeMembers < CLUSTER_MIN_ACTIVE_MEMBERS) {
    return null;
  }

  const onTime = settled.filter(
    (c) => c.status === CONTRIB_STATUS.PAID && c.daysLate === 0,
  ).length;
  const missed = settled.filter((c) => c.status === CONTRIB_STATUS.MISSED).length;

  const onTimeBps = ratioBps(onTime, settled.length);
  const missBps = ratioBps(missed, settled.length);
  // Depth, size and churn are about how much the group can be RELIED ON as
  // evidence, not about how good its members are. A large, long-running,
  // stable group tells you more than a small new one with the same on-time rate.
  const depthBps = clampBps(Math.round((completedCycles * 10_000) / 12));
  const sizeBps = clampBps(Math.round((activeMembers * 10_000) / 8));
  const churnBps = clampBps(
    10_000 - Math.round(((everMembers - activeMembers) * 20_000) / Math.max(everMembers, 1)),
  );

  const reliabilityBps = clampBps(
    Math.round((45 * onTimeBps + 20 * depthBps + 15 * sizeBps + 20 * churnBps) / 100) -
      Math.round((35 * missBps) / 100),
  );

  return {
    reliabilityBps,
    band: bandFor(reliabilityBps),
    observations: settled.length,
    onTimeRateBps: onTimeBps,
    missedCount: missed,
    completedCycles,
    activeMembers,
  };
}
