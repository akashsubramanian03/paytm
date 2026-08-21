/**
 * Scoring a business.
 *
 * The same sequence as everywhere: consent -> features -> engine -> persist.
 * SME_UNDERWRITING is its own purpose with its own required data types, so
 * consenting to a personal score never implies consenting to have a business
 * assessed.
 *
 * The owner's COMMITMENTS category is computed by the INDIVIDUAL engine and
 * reused verbatim. That is deliberate: it is the owner's own record of keeping
 * promises, not their group's and not another member's. Reaching for a
 * group-level figure here would smuggle cluster scoring in through a side door.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import {
  ACTOR,
  ARTIFACT_TYPE,
  DEFAULT_WINDOW_DAYS,
  PURPOSE,
  SUBJECT_TYPE,
} from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { requireConsent } from '../consent/consent.guard.js';
import * as audit from '../consent/audit.js';
import { extractBusinessFeatures } from '../features/business.features.js';
import { extractGroupFeatures } from '../features/group.features.js';
import { scoreBusiness } from '../engine/scorecard.js';
import { applySmeRules } from '../engine/rules.js';
import { ratioBps, clampBps, clamp } from '../util/stats.js';
import { utcMonthStart } from '../util/window.js';
import * as persist from './persist.js';

/**
 * Rebuild the owner's COMMITMENTS result in the shape scoreBusiness expects.
 *
 * Mirrors the individual scorecard's commitments maths rather than importing it,
 * because that function is private to the module and coupling the two would let
 * a change to one silently alter the other.
 */
function ownerCommitmentsFrom(groupFeatures) {
  if (!groupFeatures || groupFeatures.dueCount === 0) {
    return { rawBps: 0, sampleCount: 0, evidence: { settledCycles: 0 } };
  }
  const onTimeBps = ratioBps(groupFeatures.onTimeCount, groupFeatures.dueCount);
  const missBps = ratioBps(groupFeatures.missedCount, groupFeatures.dueCount);
  const latenessPenBps = clamp(groupFeatures.avgDaysLate * 300, 0, 6000);
  const tenureBps = clampBps(Math.round((groupFeatures.monthsInAnyGroup * 10_000) / 18));
  const breadthBps = clampBps(Math.round((groupFeatures.activeGroupCount * 10_000) / 3));

  const base = Math.round((50 * onTimeBps + 25 * tenureBps + 25 * breadthBps) / 100);
  const penalty = Math.round((25 * latenessPenBps + 75 * missBps) / 100);

  return {
    rawBps: clampBps(base - penalty),
    sampleCount: groupFeatures.dueCount,
    evidence: {
      settledCycles: groupFeatures.dueCount,
      onTime: groupFeatures.onTimeCount,
      missed: groupFeatures.missedCount,
      activeGroups: groupFeatures.activeGroupCount,
      monthsInAnyGroup: groupFeatures.monthsInAnyGroup,
      note: 'the owner’s own record, not the group’s',
    },
  };
}

export async function computeBusinessScore({
  businessId,
  ownerId,
  asOf = new Date(),
  requestId,
  actor = ACTOR.USER,
  actorId,
}) {
  const business = await prisma.business.findFirst({ where: { id: businessId, ownerId } });
  if (!business) throw ApiError.notFound('Business not found.');

  const token = await requireConsent({
    subjectType: SUBJECT_TYPE.BUSINESS,
    subjectId: businessId,
    purpose: PURPOSE.SME_UNDERWRITING,
    actor,
    actorId: actorId ?? ownerId,
    requestId,
    asOf,
  });

  const bf = await extractBusinessFeatures(businessId, { asOf, token });
  if (!bf) throw ApiError.notFound('Business not found.');

  // The owner's own group record. Reading it needs the owner's own consent for
  // GROUP_CONTRIBUTIONS, which the SME purpose does not grant — so if it is not
  // there, this category is simply unmeasured and the weight redistributes.
  let ownerCommitments = { rawBps: 0, sampleCount: 0, evidence: {} };
  try {
    const ownerToken = await requireConsent({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: ownerId,
      purpose: PURPOSE.HEALTH_SCORE,
      actor,
      actorId: ownerId,
      requestId,
      asOf,
    });
    ownerCommitments = ownerCommitmentsFrom(
      await extractGroupFeatures(ownerId, { asOf, token: ownerToken }),
    );
  } catch (err) {
    if (err.code !== 'CONSENT_REQUIRED') throw err;
    // No permission to read the owner's personal group record. That is a valid
    // choice, and it costs the business nothing beyond an unmeasured category.
  }

  const scoreResult = scoreBusiness(bf, ownerCommitments);
  const ruleResult = applySmeRules(scoreResult, bf);

  const stored = await persist.writeScore({
    subjectType: SUBJECT_TYPE.BUSINESS,
    subjectId: businessId,
    scoreResult,
    ruleResult,
    inputsHash: `sme-${businessId}-${asOf.toISOString().slice(0, 10)}`,
    consentRecordId: token.primaryConsentId,
    computedAt: asOf,
  });

  await audit.logUse({
    token,
    artifactType: ARTIFACT_TYPE.FINANCIAL_HEALTH_SCORE,
    artifactId: stored.id,
  });

  return { business, score: stored, features: bf, scoreResult, ruleResult, window: {
    days: DEFAULT_WINDOW_DAYS,
    start: utcMonthStart(asOf, -11),
    end: asOf,
  } };
}

export { ENGINE_VERSION };
