import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/db.js';
import config from '../config.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { hashPassword, verifyPassword, issueSession, revokeSession } from '../lib/auth.js';
import { buildUpiId, buildReferenceId, pickAvatarColor } from '../lib/ids.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { balance, selfUser } from '../lib/serialize.js';
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from '../lib/validators.js';

const router = Router();

// Slows down credential-stuffing against the local API.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 10_000 : 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again in a few minutes.' },
  },
});

const signupSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

const signinSchema = z.object({
  // Accepts either the email address or the 10-digit mobile number.
  identifier: z.string().trim().min(3, 'Enter your email or mobile number.').max(120),
  password: z.string().min(1, 'Enter your password.').max(72),
});

/** Generates a UPI id, retrying on the (very unlikely) collision. */
async function reserveUpiId(firstName, lastName) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = buildUpiId(firstName, lastName);
    const existing = await prisma.user.findUnique({ where: { upiId: candidate } });
    if (!existing) return candidate;
  }
  throw new ApiError(500, 'UPI_ID_UNAVAILABLE', 'Could not allocate a UPI ID. Please try again.');
}

router.post(
  '/signup',
  authLimiter,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, phone, password } = req.valid.body;

    const clash = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    });
    if (clash) {
      throw ApiError.conflict(
        clash.email === email ? 'EMAIL_TAKEN' : 'PHONE_TAKEN',
        clash.email === email
          ? 'An account with this email already exists. Try signing in.'
          : 'An account with this mobile number already exists. Try signing in.',
      );
    }

    const passwordHash = await hashPassword(password);
    const upiId = await reserveUpiId(firstName, lastName);
    const bonus = config.wallet.signupBonusPaise;

    // User + wallet (+ the welcome credit passbook row) are created together.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          passwordHash,
          upiId,
          avatarColor: pickAvatarColor(email),
          account: { create: { balancePaise: bonus } },
        },
        include: { account: true },
      });

      if (bonus > 0) {
        await tx.ledgerEntry.create({
          data: {
            referenceId: buildReferenceId(),
            userId: created.id,
            direction: 'CREDIT',
            category: 'ADD_MONEY',
            status: 'SUCCESS',
            amountPaise: bonus,
            balanceAfterPaise: bonus,
            counterpartyName: 'Paytm Welcome Bonus',
            counterpartyHandle: 'paytm@demo',
            note: 'Demo money credited on sign up',
            metadata: JSON.stringify({ simulated: true, kind: 'SIGNUP_BONUS' }),
          },
        });
      }
      return created;
    });

    const { token, expiresAt } = await issueSession(user.id, req.get('user-agent'));

    res.status(201).json({
      token,
      expiresAt,
      user: selfUser(user),
      account: balance(user.account),
    });
  }),
);

router.post(
  '/signin',
  authLimiter,
  validate({ body: signinSchema }),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.valid.body;
    const normalised = identifier.toLowerCase();

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: normalised }, { phone: identifier.trim() }] },
      include: { account: true },
    });

    // Always run a comparison so a missing user and a wrong password take a
    // similar amount of time.
    const stored = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await verifyPassword(password, stored);

    if (!user || !ok) {
      throw ApiError.unauthorized('Incorrect email/mobile or password.');
    }

    const { token, expiresAt } = await issueSession(user.id, req.get('user-agent'));
    res.json({ token, expiresAt, user: selfUser(user), account: balance(user.account) });
  }),
);

router.post(
  '/signout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSession(req.sessionId);
    res.json({ success: true, message: 'Signed out.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: selfUser(req.user), account: balance(req.user.account) });
  }),
);

export default router;
