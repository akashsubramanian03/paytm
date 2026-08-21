/**
 * Underwriting reports.
 *
 * A report is generated at the APPLICANT's request, for a partner they choose.
 * There is deliberately no route by which a partner can pull a report about
 * someone: the person decides who sees their assessment, every time.
 */
import { Router } from 'express';
import prisma from '../../lib/db.js';
import { ApiError, asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { SUBJECT_TYPE } from '../../nambikai/constants.js';
import { PARTNERS, PARTNER_DISCLAIMER } from '../../nambikai/partners.js';
import {
  buildUnderwritingReport,
  readReport,
} from '../../nambikai/pipeline/underwrite.pipeline.js';
import { trustGraphFor } from '../../nambikai/pipeline/trustGraph.pipeline.js';
import { parseJson } from '../../nambikai/serialize.js';
import { bpsToPct } from '../../nambikai/util/stats.js';
import { auditQuerySchema, createReportSchema, idParamSchema } from '../../nambikai/validators.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/partners',
  asyncHandler(async (_req, res) => {
    res.json({ partners: PARTNERS, disclaimer: PARTNER_DISCLAIMER });
  }),
);

/** The relationships a lender can verify. Never a risk transfer — see the
 *  compliance note in trustGraph.pipeline.js. */
router.get(
  '/relationships',
  asyncHandler(async (req, res) => {
    const edges = await trustGraphFor(req.user.id);
    res.json({
      relationships: edges.map((e) => ({
        type: e.toType,
        relation: e.relation,
        strengthPct: bpsToPct(e.strengthBps),
        observations: e.observationCount,
        firstSeenAt: e.firstSeenAt,
        lastSeenAt: e.lastSeenAt,
        evidence: parseJson(e.evidence, {}),
      })),
      disclaimer:
        'These are participation and verification signals only. They describe relationships you actually have; they never move your score, and one person’s behaviour never affects another’s.',
    });
  }),
);

router.post(
  '/reports',
  validate({ body: createReportSchema }),
  asyncHandler(async (req, res) => {
    const { applicantType, applicantId, partnerId } = req.valid.body;

    // You can only ever generate a report about yourself.
    if (applicantType === SUBJECT_TYPE.USER && applicantId && applicantId !== req.user.id) {
      throw ApiError.forbidden('You can only request a report about yourself.');
    }

    const { payload } = await buildUnderwritingReport({
      applicantType: SUBJECT_TYPE.USER,
      applicantId: req.user.id,
      user: req.user,
      partnerId,
      requestId: req.requestId,
      actorId: req.user.id,
    });

    res.status(201).json({ report: payload });
  }),
);

router.get(
  '/reports',
  validate({ query: auditQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit, cursor } = req.valid.query;
    const rows = await prisma.underwritingReport.findMany({
      where: { applicantId: req.user.id },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: { consentRecord: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      reports: page.map((r) => ({
        id: r.id,
        riskCategory: r.riskCategory,
        partnerId: r.requestedByPartnerId,
        explainerSource: r.explainerSource,
        clusterSignalIncluded: r.clusterSignalIncluded,
        generatedAt: r.generatedAt,
        usable: !r.consentRecord?.revokedAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  }),
);

router.get(
  '/reports/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const { report, consentStatus, usable } = await readReport({
      id: req.valid.params.id,
      applicantId: req.user.id,
    });
    res.json({
      report: parseJson(report.payload, null),
      consentStatus,
      // A report generated under a permission that has since been withdrawn
      // stays readable as a record, but is marked unusable.
      usable,
      generatedAt: report.generatedAt,
    });
  }),
);

export default router;
