import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { contactUser, selfUser } from '../lib/serialize.js';
import { buildPayPayload, parsePayPayload } from '../lib/qr.js';
import { hashPassword, verifyPassword } from '../lib/auth.js';
import { nameSchema, passwordSchema } from '../lib/validators.js';

const router = Router();
router.use(requireAuth);

const searchSchema = z.object({
  q: z.string().trim().max(60).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Search the directory by name, email, mobile or UPI ID. */
router.get(
  '/search',
  validate({ query: searchSchema }),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.valid.query;
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 4);

    // Every term must match somewhere on the user (AND of ORs), so "sreeram r"
    // narrows instead of widening. SQLite LIKE is case-insensitive for ASCII.
    const where = {
      id: { not: req.user.id },
      ...(terms.length
        ? {
            AND: terms.map((term) => ({
              OR: [
                { firstName: { contains: term } },
                { lastName: { contains: term } },
                { email: { contains: term } },
                { phone: { contains: term } },
                { upiId: { contains: term } },
              ],
            })),
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      take: limit,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    res.json({ query: q, count: users.length, users: users.map(contactUser) });
  }),
);

/** Recent people this user has transacted with — powers the dashboard row. */
router.get(
  '/recent',
  asyncHandler(async (req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { userId: req.user.id, category: 'TRANSFER', counterpartyId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { counterpartyId: true },
    });

    const uniqueIds = [...new Set(entries.map((e) => e.counterpartyId))].slice(0, 8);
    if (uniqueIds.length === 0) return res.json({ users: [] });

    const users = await prisma.user.findMany({ where: { id: { in: uniqueIds } } });
    const byId = new Map(users.map((u) => [u.id, u]));
    res.json({
      users: uniqueIds.map((id) => byId.get(id)).filter(Boolean).map(contactUser),
    });
  }),
);

/** Resolve a scanned QR payload / typed UPI ID / mobile / email to a payee. */
router.post(
  '/resolve',
  validate({ body: z.object({ code: z.string().trim().min(3, 'Enter a code to look up.').max(200) }) }),
  asyncHandler(async (req, res) => {
    const parsed = parsePayPayload(req.valid.body.code);
    if (!parsed) {
      throw ApiError.badRequest(
        'UNREADABLE_CODE',
        'That does not look like a Paytm pay code, UPI ID, mobile number or email.',
      );
    }

    const whereByKind = {
      id: { id: parsed.value },
      upi: { upiId: parsed.value },
      phone: { phone: parsed.value },
      email: { email: parsed.value },
    };

    const user = await prisma.user.findFirst({ where: whereByKind[parsed.kind] });
    if (!user) throw ApiError.notFound('No Paytm account matches that code.');
    if (user.id === req.user.id) {
      throw ApiError.badRequest('SELF_TRANSFER', 'That is your own pay code.');
    }

    res.json({ matchedBy: parsed.kind, user: contactUser(user) });
  }),
);

/** The signed-in user's own profile + the payload their QR should encode. */
router.get(
  '/me/pay-code',
  asyncHandler(async (req, res) => {
    res.json({
      upiId: req.user.upiId,
      payload: buildPayPayload(req.user),
      name: `${req.user.firstName} ${req.user.lastName}`.trim(),
    });
  }),
);

router.patch(
  '/me',
  validate({ body: z.object({ firstName: nameSchema.optional(), lastName: nameSchema.optional() }) }),
  asyncHandler(async (req, res) => {
    const { firstName, lastName } = req.valid.body;
    if (firstName === undefined && lastName === undefined) {
      throw ApiError.badRequest('NOTHING_TO_UPDATE', 'Send a first name or last name to update.');
    }
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(firstName !== undefined && { firstName }), ...(lastName !== undefined && { lastName }) },
    });
    res.json({ user: selfUser(user), message: 'Profile updated.' });
  }),
);

router.patch(
  '/me/password',
  validate({
    body: z.object({
      currentPassword: z.string().min(1, 'Enter your current password.').max(72),
      newPassword: passwordSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.valid.body;

    const ok = await verifyPassword(currentPassword, req.user.passwordHash);
    if (!ok) throw ApiError.badRequest('WRONG_PASSWORD', 'Your current password is incorrect.');
    if (await verifyPassword(newPassword, req.user.passwordHash)) {
      throw ApiError.badRequest('SAME_PASSWORD', 'Choose a password different from your current one.');
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Every other device is signed out; the current session stays alive.
    await prisma.session.updateMany({
      where: { userId: req.user.id, revokedAt: null, id: { not: req.sessionId } },
      data: { revokedAt: new Date() },
    });

    res.json({ success: true, message: 'Password changed. Other devices have been signed out.' });
  }),
);

router.get(
  '/:id',
  validate({ params: z.object({ id: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.valid.params.id } });
    if (!user) throw ApiError.notFound('That person is not on Paytm.');
    res.json({ user: contactUser(user) });
  }),
);

export default router;
