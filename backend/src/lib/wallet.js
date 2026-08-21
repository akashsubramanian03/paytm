/**
 * Every rupee movement in Paytm goes through this module.
 *
 * Safety rules enforced here (and nowhere else):
 *  1. Amounts are integer paise, supplied by the SERVER after validation.
 *     A balance value sent by a client is never read or trusted.
 *  2. A debit is a single conditional UPDATE:
 *        UPDATE Account SET balance = balance - N WHERE userId = ? AND balance >= N
 *     If it matches 0 rows the wallet did not have the money, so the whole
 *     transaction aborts. A balance therefore cannot go negative even if two
 *     requests race.
 *  3. Both legs of a peer-to-peer transfer plus both passbook rows are written
 *     inside one prisma.$transaction — all of it commits, or none of it does.
 */
import prisma from './db.js';
import { ApiError } from './errors.js';
import { formatINR } from './money.js';
import { buildReferenceId } from './ids.js';
import config from '../config.js';

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export function assertWithinLimits(amountPaise, { max = config.wallet.maxTransferPaise } = {}) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw ApiError.badRequest('INVALID_AMOUNT', 'Enter an amount greater than zero.');
  }
  if (amountPaise < config.wallet.minTransferPaise) {
    throw ApiError.badRequest(
      'AMOUNT_TOO_SMALL',
      `The minimum amount is ${formatINR(config.wallet.minTransferPaise)}.`,
    );
  }
  if (amountPaise > max) {
    throw ApiError.badRequest(
      'AMOUNT_TOO_LARGE',
      `The maximum amount per transaction is ${formatINR(max)}.`,
    );
  }
}

const fullName = (user) => `${user.firstName} ${user.lastName}`.trim();

/** Conditional debit. Returns the balance AFTER the debit. Throws if short. */
async function applyDebit(tx, userId, amountPaise) {
  const result = await tx.account.updateMany({
    where: { userId, balancePaise: { gte: amountPaise } },
    data: { balancePaise: { decrement: amountPaise } },
  });

  if (result.count !== 1) {
    const account = await tx.account.findUnique({ where: { userId } });
    if (!account) throw ApiError.notFound('Wallet not found for this account.');
    throw ApiError.unprocessable(
      'INSUFFICIENT_BALANCE',
      `Insufficient balance. Your wallet has ${formatINR(account.balancePaise)}.`,
    );
  }

  const account = await tx.account.findUnique({ where: { userId } });
  return account.balancePaise;
}

/** Credit. Returns the balance AFTER the credit. */
async function applyCredit(tx, userId, amountPaise) {
  const account = await tx.account.update({
    where: { userId },
    data: { balancePaise: { increment: amountPaise } },
  });
  return account.balancePaise;
}

/**
 * Peer-to-peer transfer. Writes 4 rows atomically:
 * sender account, recipient account, sender DEBIT entry, recipient CREDIT entry.
 */
export async function transferMoney({ senderId, recipientId, amountPaise, note = null }) {
  assertWithinLimits(amountPaise);
  if (senderId === recipientId) {
    throw ApiError.badRequest('SELF_TRANSFER', 'You cannot send money to your own wallet.');
  }

  return prisma.$transaction(async (tx) => {
    const recipient = await tx.user.findUnique({
      where: { id: recipientId },
      include: { account: true },
    });
    if (!recipient || !recipient.account) {
      throw ApiError.notFound('That person is not on Paytm.');
    }
    const sender = await tx.user.findUnique({ where: { id: senderId } });
    if (!sender) throw ApiError.notFound('Sender account not found.');

    const senderBalance = await applyDebit(tx, senderId, amountPaise);
    const recipientBalance = await applyCredit(tx, recipientId, amountPaise);

    const referenceId = buildReferenceId();
    const createdAt = new Date();

    const debitEntry = await tx.ledgerEntry.create({
      data: {
        referenceId,
        userId: senderId,
        direction: 'DEBIT',
        category: 'TRANSFER',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: senderBalance,
        counterpartyId: recipient.id,
        counterpartyName: fullName(recipient),
        counterpartyHandle: recipient.upiId,
        note,
        createdAt,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        referenceId,
        userId: recipientId,
        direction: 'CREDIT',
        category: 'TRANSFER',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: recipientBalance,
        counterpartyId: sender.id,
        counterpartyName: fullName(sender),
        counterpartyHandle: sender.upiId,
        note,
        createdAt,
      },
    });

    return { referenceId, entry: debitEntry, balancePaise: senderBalance, recipient };
  }, TX_OPTIONS);
}

/**
 * Mock "add money from a bank/card". No gateway is contacted — this simply
 * credits the local wallet and records the passbook row.
 */
export async function addMoney({ userId, amountPaise, source }) {
  assertWithinLimits(amountPaise);

  return prisma.$transaction(async (tx) => {
    const balancePaise = await applyCredit(tx, userId, amountPaise);
    const entry = await tx.ledgerEntry.create({
      data: {
        referenceId: buildReferenceId(),
        userId,
        direction: 'CREDIT',
        category: 'ADD_MONEY',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: balancePaise,
        counterpartyName: source.label,
        counterpartyHandle: source.instrument,
        note: source.note ?? null,
        metadata: JSON.stringify({ simulated: true, ...source }),
      },
    });
    return { entry, balancePaise };
  }, TX_OPTIONS);
}

/**
 * Debit the wallet to pay a mock merchant (recharge / bill). The price always
 * comes from a server-side record, never from the request body.
 */
export async function spendFromWallet({
  userId,
  amountPaise,
  category,
  counterpartyName,
  counterpartyHandle,
  note = null,
  metadata = null,
}) {
  assertWithinLimits(amountPaise);

  return prisma.$transaction(async (tx) => {
    const balancePaise = await applyDebit(tx, userId, amountPaise);
    const entry = await tx.ledgerEntry.create({
      data: {
        referenceId: buildReferenceId(),
        userId,
        direction: 'DEBIT',
        category,
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: balancePaise,
        counterpartyName,
        counterpartyHandle,
        note,
        metadata: metadata ? JSON.stringify({ simulated: true, ...metadata }) : null,
      },
    });
    return { entry, balancePaise };
  }, TX_OPTIONS);
}
