/**
 * Cluster Trust Signal: opting in, opting out, and disputing.
 *
 * The opt-out and the appeal are first-class routes shipped alongside the
 * feature, not added later. A group-level signal you cannot leave or contest is
 * not a signal, it is a verdict.
 */
import { Router } from 'express';
import prisma from '../../lib/db.js';
import { ApiError, asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  APPEAL_STATUS,
  CLUSTER_TYPE,
  DATA_TYPE,
  MEMBER_STATUS,
  PURPOSE,
  SUBJECT_TYPE,
} from '../../nambikai/constants.js';
import * as consentService from '../../nambikai/consent/consent.service.js';
import {
  clusterSignalForUser,
  eligibleClustersFor,
} from '../../nambikai/pipeline/cluster.pipeline.js';
import { bpsToPct } from '../../nambikai/util/stats.js';
import { parseJson } from '../../nambikai/serialize.js';
import { clusterGroupSchema, createAppealSchema, idParamSchema } from '../../nambikai/validators.js';

const router = Router();
router.use(requireAuth);

const serialiseAppeal = (a) => ({
  id: a.id,
  clusterId: a.clusterId,
  clusterType: a.clusterType,
  reason: a.reason,
  status: a.status,
  suppressed: a.suppressed,
  createdAt: a.createdAt,
  resolvedAt: a.resolvedAt,
  resolutionNote: a.resolutionNote,
});

/** Everything a person needs to decide: what is eligible, what they opted into,
 *  and what they are disputing. */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const asOf = new Date();
    const [clusters, consents, appeals] = await Promise.all([
      eligibleClustersFor(req.user.id, { asOf }),
      consentService.activeConsentsFor({
        subjectType: SUBJECT_TYPE.USER,
        subjectId: req.user.id,
        purpose: PURPOSE.UNDERWRITING,
        dataTypes: [DATA_TYPE.CLUSTER_TRUST_SIGNAL],
        asOf,
      }),
      prisma.clusterSignalAppeal.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const optedInGroupIds = new Set(
      consents.map((c) => parseJson(c.scope, {}).clusterId).filter(Boolean),
    );

    res.json({
      // Off unless explicitly turned on. Never a default.
      optedIn: optedInGroupIds.size > 0,
      eligibleClusters: clusters.map((c) => ({
        ...c,
        optedIn: optedInGroupIds.has(c.groupId),
        consentId: consents.find((x) => parseJson(x.scope, {}).clusterId === c.groupId)?.id ?? null,
      })),
      appeals: appeals.map(serialiseAppeal),
      explanation:
        'A group signal describes the other people in a savings circle you belong to. It is never blended into your own score, it is off unless you turn it on, and you can withdraw or dispute it at any time.',
    });
  }),
);

router.post(
  '/opt-in',
  validate({ body: clusterGroupSchema }),
  asyncHandler(async (req, res) => {
    const { groupId } = req.valid.body;

    const membership = await prisma.groupMember.findFirst({
      where: { groupId, userId: req.user.id, status: MEMBER_STATUS.ACTIVE },
    });
    if (!membership) throw ApiError.notFound('You are not a member of that group.');

    const { consent, created } = await consentService.grantConsent({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      userId: req.user.id,
      dataType: DATA_TYPE.CLUSTER_TRUST_SIGNAL,
      purpose: PURPOSE.UNDERWRITING,
      scope: { clusterId: groupId, windowDays: 365, partnerIds: [] },
      actorId: req.user.id,
      requestId: req.requestId,
    });

    res.status(created ? 201 : 200).json({
      consentId: consent.id,
      optedIn: true,
      note: 'This signal will be shown to a lender as a separate, clearly-labelled figure. It will never change your own score.',
    });
  }),
);

router.post(
  '/opt-out',
  validate({ body: clusterGroupSchema }),
  asyncHandler(async (req, res) => {
    const consents = await consentService.activeConsentsFor({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      purpose: PURPOSE.UNDERWRITING,
      dataTypes: [DATA_TYPE.CLUSTER_TRUST_SIGNAL],
    });
    const match = consents.find((c) => parseJson(c.scope, {}).clusterId === req.valid.body.groupId);
    if (!match) throw ApiError.notFound('You have not turned on group scoring for that group.');

    await consentService.revokeConsent({
      id: match.id,
      userId: req.user.id,
      requestId: req.requestId,
      reason: 'CLUSTER_OPT_OUT',
    });

    res.json({
      optedIn: false,
      revoked: true,
      // Honest about the limit of what opting out can do.
      note: 'Future assessments will carry no group signal. Assessments already sent to a partner are unchanged — but any regenerated one will say the signal was withdrawn.',
    });
  }),
);

router.get(
  '/:groupId/signal',
  validate({ params: idParamSchema.extend({ groupId: idParamSchema.shape.id }).omit({ id: true }) }),
  asyncHandler(async (req, res) => {
    const result = await clusterSignalForUser(req.user.id, { persist: false });
    const signal = result.signal;

    res.json({
      clusterSignal: signal
        ? {
            clusterId: signal.clusterId,
            clusterType: signal.clusterType,
            clusterName: signal.clusterName,
            reliabilityScore: bpsToPct(signal.reliabilityBps),
            band: signal.band,
            memberCount: signal.memberCount,
            observedCycles: signal.observedCycles,
            excludedSubject: true,
          }
        : null,
      omissionReason: result.omissionReason,
      // Restated on every read so a client cannot render it as a personal score.
      isSeparateFromIndividualScore: true,
      affectsIndividualScore: false,
      disclaimer:
        'This describes the other members of your savings circle. It is never blended into your own score, and one member’s behaviour never changes another’s assessment.',
    });
  }),
);

/* --------------------------------------------------------------- appeals -- */

router.get(
  '/appeals',
  asyncHandler(async (req, res) => {
    const appeals = await prisma.clusterSignalAppeal.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ appeals: appeals.map(serialiseAppeal) });
  }),
);

/**
 * Filing a dispute suppresses the signal IMMEDIATELY.
 *
 * Suppression is checked at read time, so the very next assessment carries no
 * group signal. Someone contesting being judged by their neighbours should not
 * have to keep being judged by them while the dispute is considered.
 */
router.post(
  '/appeals',
  validate({ body: createAppealSchema }),
  asyncHandler(async (req, res) => {
    const { groupId, reason } = req.valid.body;

    const membership = await prisma.groupMember.findFirst({
      where: { groupId, userId: req.user.id },
    });
    if (!membership) throw ApiError.notFound('You are not a member of that group.');

    const existing = await prisma.clusterSignalAppeal.findFirst({
      where: { userId: req.user.id, clusterId: groupId, status: APPEAL_STATUS.OPEN },
    });
    if (existing) {
      return res.status(200).json({ appeal: serialiseAppeal(existing), effect: 'ALREADY_OPEN' });
    }

    const appeal = await prisma.clusterSignalAppeal.create({
      data: {
        userId: req.user.id,
        clusterType: CLUSTER_TYPE.GROUP,
        clusterId: groupId,
        reason,
        status: APPEAL_STATUS.OPEN,
        suppressed: true,
      },
    });

    return res.status(201).json({
      appeal: serialiseAppeal(appeal),
      effect: 'SUPPRESSED_IMMEDIATELY',
      note: 'The group signal is withheld from your assessments from now on, starting with the next one.',
    });
  }),
);

router.post(
  '/appeals/:id/withdraw',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const appeal = await prisma.clusterSignalAppeal.findFirst({
      where: { id: req.valid.params.id, userId: req.user.id },
    });
    if (!appeal) throw ApiError.notFound('Dispute not found.');

    const updated = await prisma.clusterSignalAppeal.update({
      where: { id: appeal.id },
      data: {
        status: APPEAL_STATUS.WITHDRAWN,
        suppressed: false,
        resolvedAt: new Date(),
        resolutionNote: 'Withdrawn by the person who raised it.',
      },
    });
    res.json({ appeal: serialiseAppeal(updated) });
  }),
);

export default router;
