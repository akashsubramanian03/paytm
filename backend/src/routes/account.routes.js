import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import config from '../config.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { balance, contactUser, ledgerEntry } from '../lib/serialize.js';
import { addMoney, transferMoney } from '../lib/wallet.js';
import { rupeeAmountToPaise, noteSchema, upiIdSchema } from '../lib/validators.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    // Read straight from the database, never from anything the client sent.
    const account = await prisma.account.findUnique({ where: { userId: req.user.id } });
    if (!account) throw ApiError.notFound('Wallet not found.');
    res.json({ account: balance(account) });
  }),
);

/**
 * MOCK top-up. There is no payment gateway behind this — the "card" and
 * "netbanking" details are only used to label the passbook entry, are never
 * stored in full, and no external request is made.
 */
const addMoneySchema = z.object({
  amount: rupeeAmountToPaise,
  method: z.enum(['CARD', 'NETBANKING', 'UPI']).default('CARD'),
  // Only the last 4 digits are kept, and only for display.
  cardNumber: z.string().trim().regex(/^\d{12,19}$/, 'Enter a valid card number.').optional(),
  bank: z.string().trim().min(2).max(40).optional(),
  upiId: upiIdSchema.optional(),
});

const BANK_LABEL = {
  CARD: 'Debit Card',
  NETBANKING: 'Net Banking',
  UPI: 'UPI',
};

router.post(
  '/add-money',
  validate({ body: addMoneySchema }),
  asyncHandler(async (req, res) => {
    const { amount: amountPaise, method, cardNumber, bank, upiId } = req.valid.body;

    if (method === 'CARD' && !cardNumber) {
      throw ApiError.badRequest('CARD_REQUIRED', 'Enter your card number.');
    }
    if (method === 'NETBANKING' && !bank) {
      throw ApiError.badRequest('BANK_REQUIRED', 'Choose a bank.');
    }
    if (method === 'UPI' && !upiId) {
      throw ApiError.badRequest('UPI_REQUIRED', 'Enter the UPI ID to debit.');
    }

    const instrument =
      method === 'CARD'
        ? `XXXX XXXX XXXX ${cardNumber.slice(-4)}`
        : method === 'NETBANKING'
          ? bank
          : upiId;

    const { entry, balancePaise } = await addMoney({
      userId: req.user.id,
      amountPaise,
      source: {
        label: `Added via ${BANK_LABEL[method]}`,
        instrument,
        method,
        note: 'Simulated top-up — no real bank was contacted',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Money added to your wallet.',
      transaction: ledgerEntry(entry),
      account: { balancePaise, balance: balancePaise / 100 },
    });
  }),
);

/**
 * Peer-to-peer transfer. The client sends WHO and HOW MUCH; the server decides
 * everything else and performs the debit/credit atomically.
 */
const transferSchema = z
  .object({
    toUserId: z.string().trim().min(6).max(64).optional(),
    toUpiId: upiIdSchema.optional(),
    amount: rupeeAmountToPaise,
    note: noteSchema,
  })
  .refine((v) => v.toUserId || v.toUpiId, {
    message: 'Choose someone to pay.',
    path: ['toUserId'],
  });

router.post(
  '/transfer',
  validate({ body: transferSchema }),
  asyncHandler(async (req, res) => {
    const { toUserId, toUpiId, amount: amountPaise, note } = req.valid.body;

    const recipient = await prisma.user.findFirst({
      where: toUserId ? { id: toUserId } : { upiId: toUpiId },
    });
    if (!recipient) throw ApiError.notFound('That person is not on Paytm.');

    const result = await transferMoney({
      senderId: req.user.id,
      recipientId: recipient.id,
      amountPaise,
      note,
    });

    res.status(201).json({
      success: true,
      message: `Paid to ${recipient.firstName} ${recipient.lastName}`.trim(),
      transaction: ledgerEntry(result.entry),
      recipient: contactUser(recipient),
      account: { balancePaise: result.balancePaise, balance: result.balancePaise / 100 },
    });
  }),
);

router.get('/limits', (_req, res) => {
  res.json({
    minTransferPaise: config.wallet.minTransferPaise,
    maxTransferPaise: config.wallet.maxTransferPaise,
    signupBonusPaise: config.wallet.signupBonusPaise,
  });
});

export default router;
