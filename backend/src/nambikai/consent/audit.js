/**
 * The consent audit trail.
 *
 * Two things make this more than a log file:
 *
 *  1. USE rows are written for data that was ACTUALLY READ, not merely
 *     permitted. If a user consented to five data types and a scoring run only
 *     needed three, three rows appear. That distinction is the entire point —
 *     "you allowed this" and "we used this" are different claims, and only the
 *     second one is a disclosure.
 *
 *  2. DENY rows are written when the gate blocks a call. A refusal is as
 *     auditable as a use, so "Nambikai never looked at that" is provable rather
 *     than merely asserted.
 *
 * Rows are never updated or deleted. Revoking consent does not erase the record
 * of what was already read — that would defeat the purpose.
 */
import prisma from '../../lib/db.js';
import { ACTOR, AUDIT_ACTION } from '../constants.js';

async function write(rows) {
  if (!rows.length) return { count: 0 };
  return prisma.consentAuditLog.createMany({ data: rows });
}

export async function logGrant({ consent, actor = ACTOR.USER, actorId, requestId }) {
  return write([
    {
      consentRecordId: consent.id,
      subjectType: consent.subjectType,
      subjectId: consent.subjectId,
      dataType: consent.dataType,
      purpose: consent.purpose,
      action: AUDIT_ACTION.GRANT,
      actor,
      actorId: actorId ?? consent.userId,
      requestId,
    },
  ]);
}

export async function logRevoke({ consent, actor = ACTOR.USER, actorId, requestId, reason }) {
  return write([
    {
      consentRecordId: consent.id,
      subjectType: consent.subjectType,
      subjectId: consent.subjectId,
      dataType: consent.dataType,
      purpose: consent.purpose,
      action: AUDIT_ACTION.REVOKE,
      actor,
      actorId: actorId ?? consent.userId,
      reason: reason ?? null,
      requestId,
    },
  ]);
}

/**
 * One row per data type the run actually read.
 *
 * Called AFTER the artifact is persisted, so every row can name it. A run that
 * fails before producing anything writes nothing — there is no disclosure to
 * record if nothing was produced.
 */
export async function logUse({ token, dataTypes, artifactType, artifactId }) {
  const used = dataTypes ?? [...token.used];
  const byType = new Map(token.records.map((r) => [r.dataType, r]));

  return write(
    used.map((dataType) => ({
      consentRecordId: byType.get(dataType)?.id ?? token.primaryConsentId,
      subjectType: token.subjectType,
      subjectId: token.subjectId,
      dataType,
      purpose: token.purpose,
      action: AUDIT_ACTION.USE,
      actor: token.actor,
      actorId: token.actorId ?? null,
      artifactType: artifactType ?? null,
      artifactId: artifactId ?? null,
      requestId: token.requestId,
    })),
  );
}

/** One row per missing data type, written when the gate refuses a call. */
export async function logDeny({
  subjectType,
  subjectId,
  purpose,
  missing,
  actor = ACTOR.ENGINE,
  actorId,
  requestId,
  reason = 'MISSING_CONSENT',
}) {
  return write(
    missing.map((dataType) => ({
      consentRecordId: null,
      subjectType,
      subjectId,
      dataType,
      purpose,
      action: AUDIT_ACTION.DENY,
      actor,
      actorId: actorId ?? null,
      reason,
      requestId,
    })),
  );
}

/** Reverse-chronological audit feed for the "what has Nambikai read" screen. */
export async function listAudit({ subjectType, subjectId, limit = 30, cursor }) {
  const events = await prisma.consentAuditLog.findMany({
    where: { subjectType, subjectId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  });

  const hasMore = events.length > limit;
  const page = hasMore ? events.slice(0, limit) : events;
  return { events: page, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore };
}
