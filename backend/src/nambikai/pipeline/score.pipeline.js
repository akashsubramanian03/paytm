/**
 * The scoring pipeline: consent -> features -> engine -> persist.
 *
 * This is the only place the whole sequence is expressed, and the order is the
 * point. Consent is checked before any data is read; the engine sees a
 * FeatureVector and nothing else; the audit USE rows are written only after the
 * artifact exists, so a run that fails produces no disclosure record.
 */
import { ACTOR, ARTIFACT_TYPE, DEFAULT_WINDOW_DAYS, PURPOSE, SUBJECT_TYPE } from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { requireConsent } from '../consent/consent.guard.js';
import * as audit from '../consent/audit.js';
import { buildUserFeatureVector } from '../features/featureVector.js';
import { computeSignals } from '../engine/signals.js';
import { scoreUser } from '../engine/scorecard.js';
import { applyRules } from '../engine/rules.js';
import { monthsBetween, utcMonthStart, windowFor } from '../util/window.js';
import * as persist from './persist.js';
import config from '../../config.js';

/**
 * Is a stored score still usable?
 *
 * An engine-version mismatch always invalidates, regardless of age. A cached
 * number produced by different arithmetic is worse than no number, because it
 * looks current.
 */
export function isFresh(score, { asOf = new Date() } = {}) {
  if (!score) return false;
  if (score.engineVersion !== ENGINE_VERSION) return false;
  const ageMinutes = (asOf.getTime() - new Date(score.computedAt).getTime()) / 60_000;
  return ageMinutes < config.nambikai.scoreTtlMinutes;
}

/**
 * Compute (or reuse) a subject's financial health score.
 *
 * @param {object} args
 * @param {string} args.subjectId
 * @param {Date}   args.asOf        always passed in; never read from the clock below
 * @param {boolean} args.refresh    force a recompute even if a fresh score exists
 */
export async function computeHealthScore({
  subjectType = SUBJECT_TYPE.USER,
  subjectId,
  user,
  asOf = new Date(),
  requestId,
  actor = ACTOR.USER,
  actorId,
  refresh = false,
}) {
  // 1. Consent, before anything is read.
  const token = await requireConsent({
    subjectType,
    subjectId,
    purpose: PURPOSE.HEALTH_SCORE,
    actor,
    actorId: actorId ?? subjectId,
    requestId,
    asOf,
  });

  // 2. A fresh score is reused — but only after the gate has passed, so a
  //    revoked permission still blocks the cached number.
  if (!refresh) {
    const existing = await persist.latestScore({ subjectType, subjectId });
    if (isFresh(existing, { asOf })) {
      return { score: existing, signals: await persist.latestSignals({ subjectType, subjectId }), cached: true };
    }
  }

  // 3. Features. Each extractor re-asserts against the token before querying.
  const tenureMonths = user ? monthsBetween(user.createdAt, asOf) : 0;
  const fv = await buildUserFeatureVector(subjectId, { asOf, token, tenureMonths });

  // 4. The engine. Pure from here to the end of step 5.
  const signals = computeSignals(fv);
  const scoreResult = scoreUser(fv);
  const ruleResult = applyRules(scoreResult, fv);

  // 5. Persist.
  const window = {
    days: DEFAULT_WINDOW_DAYS,
    start: utcMonthStart(asOf, -(fv.windowMonths - 1)),
    end: asOf,
  };
  await persist.writeSignals({ subjectType, subjectId, signals, window });
  const stored = await persist.writeScore({
    subjectType,
    subjectId,
    scoreResult,
    ruleResult,
    inputsHash: fv.inputsHash,
    consentRecordId: token.primaryConsentId,
    computedAt: asOf,
  });

  // 6. Only now, with an artifact to point at, record what was read.
  await audit.logUse({
    token,
    artifactType: ARTIFACT_TYPE.FINANCIAL_HEALTH_SCORE,
    artifactId: stored.id,
  });

  return {
    score: stored,
    signals: await persist.latestSignals({ subjectType, subjectId }),
    featureVector: fv,
    cached: false,
    token,
  };
}

export { windowFor };
