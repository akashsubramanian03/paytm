/**
 * Lending.
 *
 * A SIMULATED PARTNER LENDS. Every response carries that, and no route lets a
 * partner pull anything about a borrower — the borrower asks, chooses and
 * accepts. That asymmetry is the same one the underwriting routes already keep.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { balance, ledgerEntry } from '../../lib/serialize.js';
import { KYC_ID_TYPE, LOAN_PURPOSE } from '../../nambikai/constants.js';
import { PARTNER_DISCLAIMER } from '../../nambikai/partners.js';
import { assessEligibility, applyForLoan, acceptOffer } from '../../nambikai/pipeline/loan.pipeline.js';
import {
  forecastNextInstallment,
  loadLoan,
  loansFor,
  payInstallment,
  portfolioOutcomes,
} from '../../nambikai/pipeline/servicing.pipeline.js';
import { kycStatusFor, submitKyc } from '../../nambikai/pipeline/kyc.pipeline.js';
import { buildIncomeProof } from '../../nambikai/pipeline/incomeProof.pipeline.js';
import { cuidSchema, rupeeAmountToPaise } from '../../lib/validators.js';
import { productKeySchema } from '../../nambikai/partners.js';
import * as s from '../../nambikai/serialize.js';
import prisma from '../../lib/db.js';

const router = Router();
router.use(requireAuth);

const money = s.money;

const offerView = (o) => ({
  productKey: o.productKey,
  productName: o.productName,
  productType: o.productType,
  partnerId: o.partnerId,
  partnerName: o.partnerName,
  principal: money(o.principalPaise),
  emi: money(o.emiPaise),
  tenureMonths: o.tenureMonths,
  totalRepayable: money(o.totalRepayablePaise),
  totalInterest: money(o.totalInterestPaise),
  // Both figures, always. A partner that quotes flat is quoting the smaller
  // number, and the borrower is entitled to see the other one next to it.
  rate: {
    reducingPct: o.annualRateBps / 100,
    flatPct: o.flatRateBps / 100,
    quotedAs: o.quotesFlat ? 'FLAT' : 'REDUCING',
    note: o.quotesFlat
      ? `This partner advertises ${o.flatRateBps / 100}% flat. On a reducing balance that is ${o.annualRateBps / 100}%.`
      : `Quoted on a reducing balance. The same cost advertised flat would read as ${o.flatRateBps / 100}%.`,
  },
  suggestedDueDay: o.suggestedDueDay,
  dueDayRationale: o.dueDayRationale,
  affordability: {
    maxEmi: money(o.affordability.maxEmiPaise),
    foirPct: o.affordability.foirBps / 100,
    incomeBand: o.affordability.incomeBand,
    bindingConstraint: o.affordability.bindingConstraint,
    limits: o.affordability.limits,
    evidence: o.affordability.evidence,
  },
});

/* --------------------------------------------------------- eligibility -- */

router.get(
  '/eligibility',
  validate({ query: z.object({ amount: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await assessEligibility({
      userId: req.user.id,
      user: req.user,
      requestId: req.requestId,
      actorId: req.user.id,
      requestedPaise: req.valid.query.amount ? req.valid.query.amount * 100 : undefined,
    });

    res.json({
      eligible: result.eligible,
      score: { value: result.scoreResult.score, grade: result.scoreResult.grade, band: result.ruleResult.band },
      gates: result.ruleResult.gates.filter((g) => g.triggered).map((g) => ({ code: g.code, effect: g.effect })),
      bestOffer: result.offers[0] ? offerView(result.offers[0]) : null,
      offerCount: result.offers.length,
      // Being at capacity is not a rejection, and the response says which it is.
      noOfferReason: result.noOfferReason,
      // Only present when there is nothing on offer — and then it is the point
      // of the response, not a consolation.
      whatWouldHelp: result.whatWouldHelp,
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

router.get(
  '/offers',
  validate({ query: z.object({ amount: z.coerce.number().int().positive().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await assessEligibility({
      userId: req.user.id,
      user: req.user,
      requestId: req.requestId,
      actorId: req.user.id,
      requestedPaise: req.valid.query.amount ? req.valid.query.amount * 100 : undefined,
    });
    res.json({
      offers: result.offers.map(offerView),
      noOfferReason: result.noOfferReason,
      whatWouldHelp: result.whatWouldHelp,
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

/* --------------------------------------------------------- applications -- */

router.post(
  '/applications',
  validate({
    body: z.object({
      productKey: productKeySchema,
      amount: rupeeAmountToPaise.optional(),
      purpose: z.enum(Object.values(LOAN_PURPOSE)).default(LOAN_PURPOSE.OTHER),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { application, offer, assessment } = await applyForLoan({
      userId: req.user.id,
      user: req.user,
      productKey: req.valid.body.productKey,
      requestedPaise: req.valid.body.amount,
      purpose: req.valid.body.purpose,
      requestId: req.requestId,
      actorId: req.user.id,
    });

    res.status(201).json({
      application: s.loanApplication(application),
      offer: offer ? s.loanOffer(offer) : null,
      // A decline says what would change it. That is the whole point.
      whatWouldHelp: offer ? null : assessment.whatWouldHelp,
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

router.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const rows = await prisma.loanApplication.findMany({
      where: { userId: req.user.id },
      include: { offers: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ applications: rows.map((a) => ({ ...s.loanApplication(a), offers: a.offers.map(s.loanOffer) })) });
  }),
);

router.post(
  '/applications/:id/accept',
  validate({
    params: z.object({ id: cuidSchema }),
    body: z.object({ offerId: cuidSchema, dueDay: z.coerce.number().int().min(1).max(28).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const application = await prisma.loanApplication.findFirst({
      where: { id: req.valid.params.id, userId: req.user.id },
    });
    if (!application) throw ApiError.notFound('Application not found.');

    const { loan, disbursement } = await acceptOffer({
      userId: req.user.id,
      offerId: req.valid.body.offerId,
      dueDayOverride: req.valid.body.dueDay,
      requestId: req.requestId,
    });

    const account = await prisma.account.findUnique({ where: { userId: req.user.id } });
    res.status(201).json({
      loan: s.loan(loan),
      disbursement: ledgerEntry(disbursement),
      account: balance(account),
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

/* ------------------------------------------------------------------ kyc -- */

router.get(
  '/kyc',
  asyncHandler(async (req, res) => {
    const status = await kycStatusFor(req.user.id);
    res.json({
      verified: status.verified,
      record: status.record ? s.kycRecord(status.record) : null,
      disclaimer: status.disclaimer,
    });
  }),
);

router.post(
  '/kyc',
  validate({
    body: z.object({
      idType: z.enum(Object.values(KYC_ID_TYPE)),
      value: z.string().trim().min(6).max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await submitKyc({
      userId: req.user.id,
      idType: req.valid.body.idType,
      value: req.valid.body.value,
    });
    res.status(result.ok ? 201 : 200).json({
      verified: result.ok,
      record: s.kycRecord(result.record),
      failureReason: result.record.failureReason,
      disclaimer: result.disclaimer,
    });
  }),
);

/* ---------------------------------------------------------------- loans -- */

router.get(
  '/loans',
  asyncHandler(async (req, res) => {
    const rows = await loansFor(req.user.id);
    res.json({
      loans: rows.map(({ loan, delinquency }) => ({ ...s.loan(loan), delinquency })),
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

router.get(
  '/loans/:id',
  validate({ params: z.object({ id: cuidSchema }) }),
  asyncHandler(async (req, res) => {
    const { loan, delinquency } = await loadLoan(req.valid.params.id, req.user.id);
    res.json({
      loan: s.loan(loan),
      delinquency,
      installments: loan.installments.map(s.loanInstallment),
      disclaimer: PARTNER_DISCLAIMER,
    });
  }),
);

/** Pay an instalment. The amount comes from the schedule, never the request. */
router.post(
  '/loans/:id/installments/:installmentId/pay',
  validate({ params: z.object({ id: cuidSchema, installmentId: cuidSchema }) }),
  asyncHandler(async (req, res) => {
    const result = await payInstallment({
      userId: req.user.id,
      loanId: req.valid.params.id,
      installmentId: req.valid.params.installmentId,
    });
    const account = await prisma.account.findUnique({ where: { userId: req.user.id } });
    res.status(201).json({
      success: true,
      installment: s.loanInstallment(result.installment),
      loan: s.loan(result.loan),
      transaction: ledgerEntry(result.entry),
      account: balance(account),
    });
  }),
);

/** Will the next instalment clear? Asked before it is due, not after it fails. */
router.get(
  '/loans/:id/forecast',
  validate({ params: z.object({ id: cuidSchema }) }),
  asyncHandler(async (req, res) => {
    const { loan, delinquency, next, forecast } = await forecastNextInstallment({
      userId: req.user.id,
      loanId: req.valid.params.id,
    });
    res.json({
      loanId: loan.id,
      delinquency,
      next: next ? s.loanInstallment(next) : null,
      forecast: forecast
        ? {
            ...forecast,
            projectedBalance: money(forecast.projectedBalancePaise),
            shortfall: money(forecast.shortfallPaise),
          }
        : null,
    });
  }),
);

/* ------------------------------------------------------- income proof --- */

router.get(
  '/income-proof',
  asyncHandler(async (req, res) => {
    const proof = await buildIncomeProof({
      userId: req.user.id,
      user: req.user,
      requestId: req.requestId,
      actorId: req.user.id,
    });
    res.json({ proof });
  }),
);

/* ------------------------------------------------------------ portfolio -- */

/** How the scorecard actually performed. Without this a score is an opinion
 *  that has never been marked. */
router.get(
  '/portfolio',
  asyncHandler(async (_req, res) => {
    res.json(await portfolioOutcomes());
  }),
);

export default router;
