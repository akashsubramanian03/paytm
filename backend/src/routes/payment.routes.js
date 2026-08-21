/**
 * Mock recharge + bill payment.
 *
 * The client only ever sends an identifier (planId / billerId) plus the
 * customer's own number. The PRICE is looked up from the database server-side,
 * so a tampered request cannot pay a different amount than the plan costs.
 */
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { biller as serializeBiller, ledgerEntry, rechargePlan } from '../lib/serialize.js';
import { spendFromWallet } from '../lib/wallet.js';
import { formatINR } from '../lib/money.js';
import { phoneSchema, rupeeAmountToPaise } from '../lib/validators.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/operators',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.rechargePlan.findMany({
      where: { isActive: true },
      distinct: ['operator'],
      select: { operator: true },
      orderBy: { operator: 'asc' },
    });
    res.json({ operators: rows.map((r) => r.operator) });
  }),
);

const plansQuery = z.object({
  operator: z.string().trim().min(2).max(40).optional(),
  category: z.enum(['POPULAR', 'UNLIMITED', 'DATA', 'TALKTIME']).optional(),
});

router.get(
  '/plans',
  validate({ query: plansQuery }),
  asyncHandler(async (req, res) => {
    const { operator, category } = req.valid.query;
    const plans = await prisma.rechargePlan.findMany({
      where: { isActive: true, ...(operator && { operator }), ...(category && { category }) },
      orderBy: [{ category: 'asc' }, { pricePaise: 'asc' }],
    });
    res.json({ count: plans.length, plans: plans.map(rechargePlan) });
  }),
);

router.post(
  '/recharge',
  validate({
    body: z.object({
      planId: z.string().trim().min(6).max(64),
      mobileNumber: phoneSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { planId, mobileNumber } = req.valid.body;

    const plan = await prisma.rechargePlan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw ApiError.notFound('That recharge plan is no longer available.');

    const { entry, balancePaise } = await spendFromWallet({
      userId: req.user.id,
      amountPaise: plan.pricePaise, // server-side price — the client cannot set this
      category: 'RECHARGE',
      counterpartyName: `${plan.operator} Prepaid`,
      counterpartyHandle: mobileNumber,
      note: `${plan.data} for ${plan.validityDays} days`,
      metadata: {
        kind: 'MOBILE_RECHARGE',
        operator: plan.operator,
        circle: plan.circle,
        mobileNumber,
        planId: plan.id,
        validityDays: plan.validityDays,
        data: plan.data,
        talktime: plan.talktime,
        sms: plan.sms,
      },
    });

    res.status(201).json({
      success: true,
      message: `Recharge of ${formatINR(plan.pricePaise)} successful for ${mobileNumber}.`,
      transaction: ledgerEntry(entry),
      plan: rechargePlan(plan),
      account: { balancePaise, balance: balancePaise / 100 },
    });
  }),
);

router.get(
  '/billers',
  validate({
    query: z.object({
      category: z.enum(['ELECTRICITY', 'DTH', 'GAS', 'WATER', 'BROADBAND']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const billers = await prisma.biller.findMany({
      where: { isActive: true, ...(req.valid.query.category && { category: req.valid.query.category }) },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json({ count: billers.length, billers: billers.map(serializeBiller) });
  }),
);

router.post(
  '/bill',
  validate({
    body: z.object({
      billerId: z.string().trim().min(6).max(64),
      consumerNumber: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9-]{4,24}$/, 'Enter a valid consumer/account number.'),
      amount: rupeeAmountToPaise,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { billerId, consumerNumber, amount: amountPaise } = req.valid.body;

    const biller = await prisma.biller.findFirst({ where: { id: billerId, isActive: true } });
    if (!biller) throw ApiError.notFound('That biller is not available.');

    // Bill amounts are user-entered, so they are range-checked against the
    // biller's own server-side limits.
    if (amountPaise < biller.minPaise || amountPaise > biller.maxPaise) {
      throw ApiError.badRequest(
        'AMOUNT_OUT_OF_RANGE',
        `${biller.name} accepts payments between ${formatINR(biller.minPaise)} and ${formatINR(biller.maxPaise)}.`,
      );
    }

    const { entry, balancePaise } = await spendFromWallet({
      userId: req.user.id,
      amountPaise,
      category: 'BILL_PAYMENT',
      counterpartyName: biller.name,
      counterpartyHandle: consumerNumber,
      note: `${biller.category.charAt(0)}${biller.category.slice(1).toLowerCase()} bill payment`,
      metadata: {
        kind: 'BILL_PAYMENT',
        billerId: biller.id,
        billerName: biller.name,
        category: biller.category,
        consumerNumber,
      },
    });

    res.status(201).json({
      success: true,
      message: `${formatINR(amountPaise)} paid to ${biller.name}.`,
      transaction: ledgerEntry(entry),
      account: { balancePaise, balance: balancePaise / 100 },
    });
  }),
);

export default router;
