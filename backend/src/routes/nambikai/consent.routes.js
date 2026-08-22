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
import { consentArtefact } from '../../nambikai/depa.js';

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

/**
 * Every active permission, in the shape India's Account Aggregator framework
 * uses for a consent artefact.
 *
 * This is the claim made concrete: the consent layer was not built as a
 * checkbox and then described as compliant afterwards. Each record already
 * carries a purpose, the data types it covers, a validity window, a retention
 * life and a revocation state, because a permission that cannot be scoped,
 * expired, revoked and audited is not a permission. The artefact is a
 * serialiser over fields that were always there.
 *
 * Nambikai is not an Account Aggregator and not a registered FIU. Every
 * artefact says so, and none of them is signed.
 */
router.get(
  '/artefacts',
  asyncHandler(async (req, res) => {
    const asOf = new Date();
    const consents = await consentService.listConsents({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
    });

    res.json({
      artefacts: consents.map((c) => consentArtefact(c, { user: req.user, asOf })),
      note:
        'Shaped to the RBI Account Aggregator consent artefact. Not issued by an AA, not signed. ' +
        'In production the wallet ledger is fetched through an AA under exactly these terms.',
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
