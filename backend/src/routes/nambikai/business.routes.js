/**
 * The SME slice.
 *
 * A business is scored by the same engine, with a business feature set. Its
 * consent is its own: SME_UNDERWRITING never comes bundled with a personal
 * health score, because assessing someone's shop and assessing their household
 * are different disclosures.
 */
import { Router } from 'express';
import prisma from '../../lib/db.js';
import { ApiError, asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { RECORD_KIND, SUBJECT_TYPE } from '../../nambikai/constants.js';
import { computeBusinessScore } from '../../nambikai/pipeline/business.pipeline.js';
import { buildAssistantContext, bandRupees } from '../../nambikai/ai/context.js';
import { answerQuestion, SME_SUGGESTIONS } from '../../nambikai/ai/assistant.js';
import * as s from '../../nambikai/serialize.js';
import { askSchema, createBusinessSchema, idParamSchema, updateBusinessSchema } from '../../nambikai/validators.js';

const router = Router();
router.use(requireAuth);

const owned = async (id, ownerId) => {
  const business = await prisma.business.findFirst({ where: { id, ownerId } });
  if (!business) throw ApiError.notFound('Business not found.');
  return business;
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const businesses = await prisma.business.findMany({ where: { ownerId: req.user.id } });
    res.json({ businesses: businesses.map(s.business) });
  }),
);

router.post(
  '/',
  validate({ body: createBusinessSchema }),
  asyncHandler(async (req, res) => {
    const b = req.valid.body;
    const created = await prisma.business.create({
      data: {
        ownerId: req.user.id,
        name: b.name,
        sector: b.sector,
        gstNumber: b.gstNumber ?? null,
        city: b.city,
        employeeCount: b.employeeCount,
        monthlyRevenueEstimatePaise: b.monthlyRevenue,
        monthlyInflowEstimatePaise: b.monthlyInflow,
        receivablesEstimatePaise: b.receivables,
        existingDebtEstimatePaise: b.existingDebt,
      },
    });
    res.status(201).json({ business: s.business(created) });
  }),
);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ business: s.business(await owned(req.valid.params.id, req.user.id)) });
  }),
);

router.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateBusinessSchema }),
  asyncHandler(async (req, res) => {
    await owned(req.valid.params.id, req.user.id);
    const b = req.valid.body;
    const updated = await prisma.business.update({
      where: { id: req.valid.params.id },
      data: {
        ...(b.name && { name: b.name }),
        ...(b.sector && { sector: b.sector }),
        ...(b.gstNumber !== undefined && { gstNumber: b.gstNumber ?? null }),
        ...(b.city && { city: b.city }),
        ...(b.employeeCount !== undefined && { employeeCount: b.employeeCount }),
        ...(b.monthlyRevenue !== undefined && { monthlyRevenueEstimatePaise: b.monthlyRevenue }),
        ...(b.monthlyInflow !== undefined && { monthlyInflowEstimatePaise: b.monthlyInflow }),
        ...(b.receivables !== undefined && { receivablesEstimatePaise: b.receivables }),
        ...(b.existingDebt !== undefined && { existingDebtEstimatePaise: b.existingDebt }),
      },
    });
    res.json({ business: s.business(updated) });
  }),
);

router.get(
  '/:id/records',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await owned(req.valid.params.id, req.user.id);
    const kind = req.query.kind && Object.values(RECORD_KIND).includes(req.query.kind)
      ? req.query.kind
      : undefined;
    const records = await prisma.businessRecord.findMany({
      where: { businessId: req.valid.params.id, ...(kind && { kind }) },
      orderBy: { periodStart: 'desc' },
      take: 60,
    });
    res.json({ count: records.length, records: records.map(s.businessRecord) });
  }),
);

router.get(
  '/:id/score',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await owned(req.valid.params.id, req.user.id);
    const result = await computeBusinessScore({
      businessId: req.valid.params.id,
      ownerId: req.user.id,
      requestId: req.requestId,
      actorId: req.user.id,
    });
    res.json({
      score: s.healthScore(result.score),
      business: s.business(result.business),
    });
  }),
);

router.post(
  '/:id/score/recompute',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await owned(req.valid.params.id, req.user.id);
    const result = await computeBusinessScore({
      businessId: req.valid.params.id,
      ownerId: req.user.id,
      requestId: req.requestId,
      actorId: req.user.id,
    });
    res.json({ score: s.healthScore(result.score) });
  }),
);

router.get(
  '/:id/assistant/suggestions',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await owned(req.valid.params.id, req.user.id);
    res.json({ suggestions: SME_SUGGESTIONS });
  }),
);

router.post(
  '/:id/assistant/ask',
  validate({ params: idParamSchema, body: askSchema }),
  asyncHandler(async (req, res) => {
    const business = await owned(req.valid.params.id, req.user.id);
    const result = await computeBusinessScore({
      businessId: business.id,
      ownerId: req.user.id,
      requestId: req.requestId,
      actorId: req.user.id,
    });

    const bf = result.features;
    const facts = {
      months_invoiced: bf.activeMonths,
      invoices_raised: bf.invoiceCount,
      invoices_settled: bf.settledCount,
      invoices_overdue: bf.overdueCount,
      days_customers_take_to_pay: bf.dso,
      gst_filings: bf.filingCount,
      gst_filed_late: bf.filedLate,
      // Rupees leave this layer only as bands, exactly as on the personal side.
      monthly_revenue_band: bandRupees(bf.monthlyRevenueEstimatePaise),
      outstanding_band: bandRupees(bf.outstandingPaise),
      existing_debt_band: bandRupees(bf.existingDebtEstimatePaise),
    };

    const context = buildAssistantContext({
      user: { firstName: business.name, lastName: '' },
      score: {
        score: result.scoreResult.score,
        grade: result.scoreResult.grade,
        breakdown: result.scoreResult.breakdown,
        reasonCodes: result.scoreResult.reasonCodes,
      },
      ruleResult: result.ruleResult,
      facts,
      isSme: true,
    });

    const answer = await answerQuestion({
      question: req.valid.body.question,
      history: req.valid.body.history,
      context,
    });

    res.json({
      answer: answer.text,
      source: answer.source,
      refused: answer.refused,
      groundedIn: answer.groundedIn,
    });
  }),
);

export default router;
