import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ledgerEntry } from '../lib/serialize.js';
import { formatINR } from '../lib/money.js';

const router = Router();
router.use(requireAuth);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(6).max(64).optional(),
  direction: z.enum(['DEBIT', 'CREDIT']).optional(),
  category: z.enum(['TRANSFER', 'ADD_MONEY', 'RECHARGE', 'BILL_PAYMENT']).optional(),
  q: z.string().trim().max(60).optional(),
});

/** Passbook: newest first, cursor paginated, scoped to the signed-in user only. */
router.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req, res) => {
    const { limit, cursor, direction, category, q } = req.valid.query;

    const where = {
      userId: req.user.id,
      ...(direction && { direction }),
      ...(category && { category }),
      ...(q && {
        OR: [
          { counterpartyName: { contains: q } },
          { counterpartyHandle: { contains: q } },
          { referenceId: { contains: q.toUpperCase() } },
          { note: { contains: q } },
        ],
      }),
    };

    const entries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;

    res.json({
      transactions: page.map(ledgerEntry),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  }),
);

/** Totals for the dashboard cards. */
router.get(
  '/summary',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - req.valid.query.days * 86_400_000);

    const grouped = await prisma.ledgerEntry.groupBy({
      by: ['direction'],
      where: { userId: req.user.id, status: 'SUCCESS', createdAt: { gte: since } },
      _sum: { amountPaise: true },
      _count: { _all: true },
    });

    const find = (d) => grouped.find((g) => g.direction === d);
    const sentPaise = find('DEBIT')?._sum.amountPaise ?? 0;
    const receivedPaise = find('CREDIT')?._sum.amountPaise ?? 0;

    res.json({
      days: req.valid.query.days,
      since,
      sentPaise,
      sentFormatted: formatINR(sentPaise),
      sentCount: find('DEBIT')?._count._all ?? 0,
      receivedPaise,
      receivedFormatted: formatINR(receivedPaise),
      receivedCount: find('CREDIT')?._count._all ?? 0,
    });
  }),
);

/** Passbook detail view. Scoped by userId so one user can never read another's. */
router.get(
  '/:id',
  validate({ params: z.object({ id: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req, res) => {
    const entry = await prisma.ledgerEntry.findFirst({
      where: { id: req.valid.params.id, userId: req.user.id },
    });
    if (!entry) throw ApiError.notFound('Transaction not found.');

    res.json({ transaction: ledgerEntry(entry) });
  }),
);

export default router;
