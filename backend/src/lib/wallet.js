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
 *  4. Nambikai adds exactly ONE new money path here (payGroupContribution) rather
 *     than writing ledger rows of its own. Nothing under src/nambikai/ may call
 *     prisma.ledgerEntry.create — a test greps for it.
 */
import prisma from './db.js';
import { ApiError } from './errors.js';
import { formatINR } from './money.js';
import { buildReferenceId } from './ids.js';
import { PAYABLE_CONTRIB_STATUSES, PAYABLE_INSTALLMENT_STATUSES } from '../nambikai/constants.js';
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

/**
 * Pay one savings-group contribution.
 *
 * This is an ordinary peer-to-peer transfer — Nambikai holds no money and runs no
 * chit auction. The contribution row is an ANNOTATION on the debit leg, not a
 * money movement of its own, which is why the wallet's three whole-database
 * invariants keep covering it unchanged:
 *   - two legs, one DEBIT and one CREDIT, sharing a referenceId
 *   - category TRANSFER, so "every TRANSFER has exactly one debit and one credit"
 *     already applies (no new category, no new invariant to maintain)
 *   - both balances written by the same guarded helpers as every other transfer
 *
 * The contribution is marked PAID inside the SAME transaction as the money
 * movement, so the two can never disagree. Reentrancy is handled the same way
 * this file handles balances: a conditional updateMany that matches zero rows if
 * the contribution has already been paid, aborting the whole transaction. Two
 * simultaneous taps therefore cannot pay twice — the second one gets a 409 and
 * no money moves.
 */
export async function payGroupContribution({
  payerId,
  payeeId,
  contributionId,
  amountPaise,
  daysLate = 0,
  note = null,
  metadata = null,
}) {
  assertWithinLimits(amountPaise);
  if (payerId === payeeId) {
    throw ApiError.badRequest(
      'SELF_CONTRIBUTION',
      'This cycle pays out to you, so there is nothing to send.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const payee = await tx.user.findUnique({
      where: { id: payeeId },
      include: { account: true },
    });
    if (!payee || !payee.account) {
      throw ApiError.notFound('That group member is not on Paytm.');
    }
    const payer = await tx.user.findUnique({ where: { id: payerId } });
    if (!payer) throw ApiError.notFound('Payer account not found.');

    const payerBalance = await applyDebit(tx, payerId, amountPaise);
    const payeeBalance = await applyCredit(tx, payeeId, amountPaise);

    const referenceId = buildReferenceId();
    const createdAt = new Date();
    const entryMetadata = JSON.stringify({
      simulated: true,
      kind: 'GROUP_CONTRIBUTION',
      ...(metadata ?? {}),
    });

    const debitEntry = await tx.ledgerEntry.create({
      data: {
        referenceId,
        userId: payerId,
        direction: 'DEBIT',
        category: 'TRANSFER',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: payerBalance,
        counterpartyId: payee.id,
        counterpartyName: fullName(payee),
        counterpartyHandle: payee.upiId,
        note,
        metadata: entryMetadata,
        createdAt,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        referenceId,
        userId: payeeId,
        direction: 'CREDIT',
        category: 'TRANSFER',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: payeeBalance,
        counterpartyId: payer.id,
        counterpartyName: fullName(payer),
        counterpartyHandle: payer.upiId,
        note,
        metadata: entryMetadata,
        createdAt,
      },
    });

    // Conditional update: matches 0 rows if this contribution was already paid
    // (or was waived), which rolls the whole transaction back including both
    // ledger rows and both balance changes.
    const marked = await tx.contribution.updateMany({
      where: {
        id: contributionId,
        userId: payerId,
        status: { in: PAYABLE_CONTRIB_STATUSES },
      },
      data: {
        status: 'PAID',
        paidAt: createdAt,
        amountPaidPaise: amountPaise,
        daysLate,
        ledgerEntryId: debitEntry.id,
      },
    });

    if (marked.count !== 1) {
      throw ApiError.conflict(
        'CONTRIBUTION_ALREADY_PAID',
        'This contribution has already been paid.',
      );
    }

    const contribution = await tx.contribution.findUnique({ where: { id: contributionId } });

    return { referenceId, entry: debitEntry, contribution, balancePaise: payerBalance, payee };
  }, TX_OPTIONS);
}

/**
 * Disburse a loan into the wallet.
 *
 * A SIMULATED PARTNER LENDS. Nambikai scores; it does not extend credit, set
 * the rate or hold the risk. This function exists here rather than in the
 * Nambikai layer for one reason: this file is the only place in the codebase
 * permitted to write a ledger row, and a loan that reached the wallet by any
 * other route would be money the passbook could not account for.
 *
 * Single-leg CREDIT, like addMoney. That keeps the "every TRANSFER has exactly
 * one debit and one credit" invariant untouched — there is no counterparty
 * wallet here, because the partner is not a Paytm user.
 */
export async function disburseLoan({ userId, amountPaise, loanId, partnerName, note = null }) {
  assertWithinLimits(amountPaise);

  return prisma.$transaction(async (tx) => {
    const balancePaise = await applyCredit(tx, userId, amountPaise);
    const entry = await tx.ledgerEntry.create({
      data: {
        referenceId: buildReferenceId(),
        userId,
        direction: 'CREDIT',
        category: 'LOAN_DISBURSEMENT',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: balancePaise,
        counterpartyName: partnerName,
        counterpartyHandle: 'simulated-partner',
        note: note ?? 'Loan disbursed',
        metadata: JSON.stringify({ simulated: true, kind: 'LOAN_DISBURSEMENT', loanId }),
      },
    });
    return { entry, balancePaise };
  }, TX_OPTIONS);
}

/**
 * Pay one loan instalment.
 *
 * The money movement and the instalment update commit together, so the two can
 * never disagree. Reentrancy is guarded exactly as payGroupContribution guards
 * it: a conditional updateMany that matches zero rows if the instalment has
 * already been paid, which rolls back the whole transaction including the debit.
 * Two simultaneous taps therefore cannot pay twice — the second gets a 409 and
 * no money moves.
 *
 * Single-leg DEBIT: the repayment leaves the Paytm economy for the partner, who
 * has no wallet here.
 */
export async function repayLoanInstallment({
  userId,
  installmentId,
  amountPaise,
  daysLate = 0,
  partnerName,
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
        category: 'LOAN_REPAYMENT',
        status: 'SUCCESS',
        amountPaise,
        balanceAfterPaise: balancePaise,
        counterpartyName: partnerName,
        counterpartyHandle: 'simulated-partner',
        note: note ?? 'Loan instalment',
        metadata: JSON.stringify({
          simulated: true,
          kind: 'LOAN_REPAYMENT',
          installmentId,
          ...(metadata ?? {}),
        }),
      },
    });

    const paidAt = new Date();
    const marked = await tx.loanInstallment.updateMany({
      where: { id: installmentId, status: { in: PAYABLE_INSTALLMENT_STATUSES } },
      data: {
        status: 'PAID',
        paidAt,
        amountPaidPaise: amountPaise,
        daysLate,
        ledgerEntryId: entry.id,
      },
    });

    if (marked.count !== 1) {
      throw ApiError.conflict('INSTALLMENT_ALREADY_PAID', 'This instalment has already been paid.');
    }

    const installment = await tx.loanInstallment.findUnique({
      where: { id: installmentId },
      include: { loan: true },
    });

    // Reduce the outstanding by the PRINCIPAL portion only. Interest is the cost
    // of the loan, not a reduction of it.
    const remaining = Math.max(installment.loan.outstandingPaise - installment.principalPaise, 0);
    const stillOwing = await tx.loanInstallment.count({
      where: { loanId: installment.loanId, status: { in: PAYABLE_INSTALLMENT_STATUSES } },
    });

    const loan = await tx.loan.update({
      where: { id: installment.loanId },
      data: {
        outstandingPaise: remaining,
        ...(stillOwing === 0 ? { status: 'CLOSED', closedAt: paidAt, outstandingPaise: 0 } : {}),
      },
    });

    return { entry, installment, loan, balancePaise };
  }, TX_OPTIONS);
}
