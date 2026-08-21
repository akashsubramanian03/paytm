/**
 * Consent: granting, listing, revoking, and the record of what was read.
 *
 * Every data type used in scoring must have an active ConsentRecord before it is
 * touched. These routes are how a person creates and destroys those records, and
 * how they inspect what Nambikai actually did with the permission.
 */
import { Router } from 'express';
import { asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  DATA_TYPE,
  DATA_TYPE_LABEL,
  PURPOSE,
  PURPOSE_LABEL,
  SUBJECT_TYPE,
} from '../../nambikai/constants.js';
import { REQUIRED_CONSENTS } from '../../nambikai/consent/consent.guard.js';
import * as consentService from '../../nambikai/consent/consent.service.js';
import * as audit from '../../nambikai/consent/audit.js';
import * as s from '../../nambikai/serialize.js';
import { auditQuerySchema, grantConsentSchema, idParamSchema } from '../../nambikai/validators.js';

const router = Router();
router.use(requireAuth);

/**
 * What Nambikai can ask for, in plain language, and which purposes need what.
 * The consent screen is built from this rather than from hardcoded copy, so the
 * UI cannot drift from what the gate actually enforces.
 */
router.get(
  '/catalogue',
  asyncHandler(async (_req, res) => {
    res.json({
      dataTypes: Object.values(DATA_TYPE).map((dataType) => ({
        dataType,
        label: DATA_TYPE_LABEL[dataType] ?? dataType,
      })),
      purposes: Object.values(PURPOSE).map((purpose) => ({
        purpose,
        label: PURPOSE_LABEL[purpose] ?? purpose,
        requires: REQUIRED_CONSENTS[purpose] ?? [],
      })),
    });
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const consents = await consentService.listConsents({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
    });
    res.json({ consents: consents.map((c) => s.consentRecord(c)) });
  }),
);

router.post(
  '/',
  validate({ body: grantConsentSchema }),
  asyncHandler(async (req, res) => {
    const { dataType, purpose, windowDays, partnerIds, clusterId, expiresInDays } = req.valid.body;

    const { consent, created } = await consentService.grantConsent({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      userId: req.user.id,
      dataType,
      purpose,
      scope: { windowDays, partnerIds, ...(clusterId ? { clusterId } : {}) },
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
      actorId: req.user.id,
      requestId: req.requestId,
    });

    // Re-granting something already on is a no-op, not a second record.
    res.status(created ? 201 : 200).json({ consent: s.consentRecord(consent), created });
  }),
);

router.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const result = await consentService.revokeConsent({
      id: req.valid.params.id,
      userId: req.user.id,
      requestId: req.requestId,
    });

    res.json({
      consent: s.consentRecord(result.consent),
      revoked: result.revoked,
      // Existing scores and reports are not deleted — they are the record of
      // what was disclosed. They become unusable instead.
      affectedArtifacts: result.affectedArtifacts,
    });
  }),
);

/** "Nambikai used these signals" — generated from the log, never from copy. */
router.get(
  '/audit',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit, cursor } = req.valid.query;
    const { events, nextCursor, hasMore } = await audit.listAudit({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      limit,
      cursor,
    });
    res.json({ events: events.map(s.auditEvent), nextCursor, hasMore });
  }),
);

export default router;
