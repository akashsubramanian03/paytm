/**
 * Turning a 0..100 score into the two words a human reads.
 *
 * There are deliberately TWO vocabularies:
 *
 *   `band`  — LOW / MEDIUM / HIGH risk. Partner-facing. This is a statement
 *             about lending risk and it belongs in an underwriting report.
 *   `grade` — BUILDING / FAIR / GOOD / STRONG. Consumer-facing. This is a
 *             statement about where someone is on a path.
 *
 * The same number produces both, and the UI must never show a person that they
 * are "HIGH risk". Telling someone their financial life makes them a high risk
 * is not information they can act on; telling them their score is BUILDING and
 * naming the two behaviours that would move it is. The split is not cosmetic —
 * it is the difference between a system that judges people and one that helps
 * them, and it costs nothing to maintain.
 *
 * PURE MODULE. No Prisma, no clock, no randomness, integers only.
 */
import { BAND_RANK, BAND_THRESHOLDS, GRADE, GRADE_THRESHOLDS, RISK_BAND } from '../constants.js';

export function scoreToBand(score) {
  if (score >= BAND_THRESHOLDS.LOW_MIN) return RISK_BAND.LOW;
  if (score >= BAND_THRESHOLDS.MEDIUM_MIN) return RISK_BAND.MEDIUM;
  return RISK_BAND.HIGH;
}

export function scoreToGrade(score) {
  if (score >= GRADE_THRESHOLDS.STRONG_MIN) return GRADE.STRONG;
  if (score >= GRADE_THRESHOLDS.GOOD_MIN) return GRADE.GOOD;
  if (score >= GRADE_THRESHOLDS.FAIR_MIN) return GRADE.FAIR;
  return GRADE.BUILDING;
}

export const bandRank = (band) => BAND_RANK[band] ?? BAND_RANK.HIGH;

/**
 * The worse of two bands.
 *
 * Every gate in rules.js goes through this, which is what mechanically
 * guarantees a rule can only ever downgrade a band and never improve one. A
 * rule that could raise a score would be a back door around the scorecard.
 */
export function worseOf(a, b) {
  return bandRank(a) >= bandRank(b) ? a : b;
}

/** What a person is told, in the second person, without a risk word in sight. */
export const GRADE_MESSAGE = {
  BUILDING: 'You are building a financial record. There is not much history here yet.',
  FAIR: 'You have a real record. A few habits would strengthen it noticeably.',
  GOOD: 'You have a solid record of managing money and keeping commitments.',
  STRONG: 'You have a strong, consistent record across everything Nambikai can see.',
};
