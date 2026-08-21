/**
 * Granting, listing and revoking consent.
 *
 * A ConsentRecord is scoped to one subject, one data type and one purpose.
 * Splitting it that finely is deliberate: "you may read my wallet in order to
 * show me my own score" and "you may read my wallet in order to send an
 * assessment to a lender" are genuinely different permissions, and collapsing
 * them into a single switch would make the second one impossible to refuse.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { ACTOR, SUBJECT_TYPE } from '../constants.js';
import * as audit from './audit.js';

/** Active means: granted, not revoked, and not expired as of `asOf`. */
export function isActive(record, asOf = new Date()) {
  if (record.revokedAt) return false;
  if (record.expiresAt && new Date(record.expiresAt) <= asOf) return false;
  return true;
}

const activeWhere = (asOf) => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }],
});

export async function listConsents({ subjectType, subjectId }) {
  return prisma.consentRecord.findMany({
    where: { subjectType, subjectId },
    orderBy: [{ grantedAt: 'desc' }],
  });
}

export async function activeConsentsFor({
  subjectType,
  subjectId,
  purpose,
  dataTypes,
  asOf = new Date(),
}) {
  return prisma.consentRecord.findMany({
    where: {
      subjectType,
      subjectId,
      purpose,
      ...(dataTypes ? { dataType: { in: dataTypes } } : {}),
      ...activeWhere(asOf),
    },
    orderBy: [{ grantedAt: 'desc' }],
  });
}

/**
 * Grant consent, idempotently.
 *
 * Toggling a permission that is already on is a no-op rather than a second
 * record — otherwise the audit trail fills with duplicate grants every time the
 * screen is re-rendered, and "when did I allow this?" stops having one answer.
 */
export async function grantConsent({
  subjectType = SUBJECT_TYPE.USER,
  subjectId,
  userId,
  dataType,
  purpose,
  scope = {},
  expiresAt = null,
  actor = ACTOR.USER,
  actorId,
  requestId,
  asOf = new Date(),
}) {
  const existing = await prisma.consentRecord.findFirst({
    where: { subjectType, subjectId, dataType, purpose, ...activeWhere(asOf) },
  });
  if (existing) return { consent: existing, created: false };

  // Version increments across the subject's whole history for this permission,
  // so a re-grant after a revoke is visibly a new decision, not the old one.
  const previous = await prisma.consentRecord.count({
    where: { subjectType, subjectId, dataType, purpose },
  });

  const consent = await prisma.consentRecord.create({
    data: {
      subjectType,
      subjectId,
      userId,
      dataType,
      purpose,
      scope: JSON.stringify(scope),
      version: previous + 1,
      expiresAt,
    },
  });

  await audit.logGrant({ consent, actor, actorId: actorId ?? userId, requestId });
  return { consent, created: true };
}

/**
 * Revoke consent.
 *
 * Existing scores and reports are deliberately NOT deleted — they are the record
 * of what was disclosed, and erasing them would destroy the evidence a user
 * might later need. They are instead marked unusable, and any new scoring call
 * is refused.
 */
export async function revokeConsent({ id, userId, actor = ACTOR.USER, requestId, reason }) {
  const consent = await prisma.consentRecord.findFirst({ where: { id, userId } });
  if (!consent) throw ApiError.notFound('That permission was not found.');

  if (consent.revokedAt) {
    return { consent, revoked: false, affectedArtifacts: { scores: 0, reports: 0 } };
  }

  const updated = await prisma.consentRecord.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  await audit.logRevoke({ consent: updated, actor, actorId: userId, requestId, reason });

  const [scores, reports] = await Promise.all([
    prisma.financialHealthScore.count({ where: { consentRecordId: id } }),
    prisma.underwritingReport.count({ where: { consentRecordId: id } }),
  ]);

  return { consent: updated, revoked: true, affectedArtifacts: { scores, reports } };
}
