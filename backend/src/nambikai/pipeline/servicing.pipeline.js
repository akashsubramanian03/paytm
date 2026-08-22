/**
 * Loan servicing: paying, falling behind, and being warned before you do.
 *
 * THE ORDER MATTERS HERE. A conventional lender discovers a problem when a
 * payment fails and then starts collections. Nambikai already holds twelve
 * months of the borrower's cash flow, so it can see a shortfall coming and say
 * so while there is still time to do something — move the date, pay part of it,
 * or simply know. Collections after the fact is the industry default; it is also
 * the most expensive and least humane point at which to intervene.
 *
 * Delinquency is refreshed lazily on read, the same pattern groups.service.js
 * uses for contributions. No scheduler is needed and the state is always current
 * at the moment anyone actually looks at it.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { INSTALLMENT_STATUS, LOAN_STATUS, PAYABLE_INSTALLMENT_STATUSES } from '../constants.js';
import { findPartner } from '../partners.js';
import { repayLoanInstallment } from '../../lib/wallet.js';
import { daysBetween } from '../util/window.js';
import { forecastShortfall } from '../engine/cashflow.js';
import { dayProfileFor } from './loan.pipeline.js';

/** How long after the due date an instalment stops being merely late. */
export const GRACE_DAYS = 5;

/**
 * Bring a loan's instalment states up to date.
 *
 * PENDING past its grace becomes MISSED. A MISSED instalment stays payable —
 * unlike a savings-circle cycle, which closes. A missed EMI is still owed, and a
 * borrower catching up late should be able to, and should get credit for it.
 */
export async function refreshDelinquency(loanId, asOf = new Date()) {
  const cutoff = new Date(asOf.getTime() - GRACE_DAYS * 86_400_000);
  const result = await prisma.loanInstallment.updateMany({
    where: { loanId, status: INSTALLMENT_STATUS.PENDING, dueAt: { lt: cutoff } },
    data: { status: INSTALLMENT_STATUS.MISSED },
  });
  return { missed: result.count };
}

/** Days past due on the oldest thing still owed, with its bucket. */
export function delinquencyOf(installments, asOf = new Date()) {
  const owed = installments.filter(
    (i) => PAYABLE_INSTALLMENT_STATUSES.includes(i.status) && new Date(i.dueAt) < asOf,
  );
  if (!owed.length) return { daysPastDue: 0, bucket: 'CURRENT', overdueCount: 0, overduePaise: 0 };

  const daysPastDue = owed.reduce((max, i) => Math.max(max, daysBetween(i.dueAt, asOf)), 0);
  const bucket =
    daysPastDue > 90 ? 'DPD_90_PLUS'
    : daysPastDue > 60 ? 'DPD_60_90'
    : daysPastDue > 30 ? 'DPD_30_60'
    : daysPastDue > 0 ? 'DPD_1_30'
    : 'CURRENT';

  return {
    daysPastDue,
    bucket,
    overdueCount: owed.length,
    overduePaise: owed.reduce((sum, i) => sum + i.amountDuePaise, 0),
  };
}

export async function loadLoan(loanId, userId, { asOf = new Date() } = {}) {
  const exists = await prisma.loan.findFirst({ where: { id: loanId, userId } });
  if (!exists) throw ApiError.notFound('Loan not found.');

  await refreshDelinquency(loanId, asOf);

  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: { installments: { orderBy: { installmentIndex: 'asc' } } },
  });
  return { loan, delinquency: delinquencyOf(loan.installments, asOf) };
}

/** Pay one instalment. The amount comes from the schedule, never the request. */
export async function payInstallment({ userId, loanId, installmentId, asOf = new Date() }) {
  const { loan } = await loadLoan(loanId, userId, { asOf });

  const installment = loan.installments.find((i) => i.id === installmentId);
  if (!installment) throw ApiError.notFound('Instalment not found.');
  if (installment.status === INSTALLMENT_STATUS.PAID) {
    throw ApiError.conflict('INSTALLMENT_ALREADY_PAID', 'You have already paid this one.');
  }
  if (installment.status === INSTALLMENT_STATUS.WAIVED) {
    throw ApiError.conflict('INSTALLMENT_WAIVED', 'This instalment was waived.');
  }

  const partner = findPartner(loan.partnerId);

  return repayLoanInstallment({
    userId,
    installmentId: installment.id,
    amountPaise: installment.amountDuePaise,
    daysLate: daysBetween(installment.dueAt, asOf),
    partnerName: partner?.displayName ?? 'Lending partner',
    note: `Instalment ${installment.installmentIndex} of ${loan.tenureMonths}`,
    metadata: { loanId: loan.id, installmentIndex: installment.installmentIndex },
  });
}

/**
 * Will the next instalment clear?
 *
 * Answered from the borrower's own twelve months of cash flow, and returned with
 * a suggested date when it will not — a warning that arrives with a fix attached
 * is worth several that do not.
 */
export async function forecastNextInstallment({ userId, loanId, asOf = new Date() }) {
  const { loan, delinquency } = await loadLoan(loanId, userId, { asOf });

  const next = loan.installments
    .filter((i) => PAYABLE_INSTALLMENT_STATUSES.includes(i.status))
    .sort((a, b) => a.dueAt - b.dueAt)[0];
  if (!next) return { loan, delinquency, forecast: null, next: null };

  const [profile, account] = await Promise.all([
    dayProfileFor(userId, { asOf }),
    prisma.account.findUnique({ where: { userId } }),
  ]);

  const forecast = forecastShortfall(profile, {
    emiPaise: next.amountDuePaise,
    dueDay: new Date(next.dueAt).getUTCDate(),
    openingPaise: account?.balancePaise ?? 0,
  });

  return { loan, delinquency, next, forecast };
}

/** Every loan for a borrower, with delinquency, for the list screen. */
export async function loansFor(userId, { asOf = new Date() } = {}) {
  const loans = await prisma.loan.findMany({
    where: { userId },
    include: { installments: { orderBy: { installmentIndex: 'asc' } } },
    orderBy: { disbursedAt: 'desc' },
  });

  for (const loan of loans.filter((l) => l.status === LOAN_STATUS.ACTIVE)) {
    await refreshDelinquency(loan.id, asOf);
  }

  const refreshed = await prisma.loan.findMany({
    where: { userId },
    include: { installments: { orderBy: { installmentIndex: 'asc' } } },
    orderBy: { disbursedAt: 'desc' },
  });

  return refreshed.map((loan) => ({ loan, delinquency: delinquencyOf(loan.installments, asOf) }));
}

/**
 * Outcome data, aggregated by the band the borrower was scored at.
 *
 * This is what turns a scorecard into an underwriting model: "of the applicants
 * we called LOW, this share repaid on time." Without it a score is an opinion
 * that has never been marked.
 */
export async function portfolioOutcomes({ asOf = new Date() } = {}) {
  const loans = await prisma.loan.findMany({
    include: {
      installments: true,
      application: { include: {} },
    },
  });

  const byBand = new Map();
  for (const loan of loans) {
    const score = loan.application.scoreId
      ? await prisma.financialHealthScore.findUnique({ where: { id: loan.application.scoreId } })
      : null;
    const band = score?.band ?? 'UNKNOWN';

    if (!byBand.has(band)) {
      byBand.set(band, {
        band, loans: 0, disbursedPaise: 0, installmentsDue: 0, onTime: 0, late: 0, missed: 0, closed: 0,
      });
    }
    const agg = byBand.get(band);
    agg.loans += 1;
    agg.disbursedPaise += loan.principalPaise;
    if (loan.status === LOAN_STATUS.CLOSED) agg.closed += 1;

    for (const i of loan.installments) {
      if (i.status === INSTALLMENT_STATUS.PAID) {
        agg.installmentsDue += 1;
        if (i.daysLate === 0) agg.onTime += 1;
        else agg.late += 1;
      } else if (i.status === INSTALLMENT_STATUS.MISSED) {
        agg.installmentsDue += 1;
        agg.missed += 1;
      }
    }
  }

  const rows = [...byBand.values()].map((a) => ({
    ...a,
    onTimeRatePct: a.installmentsDue ? Math.round((a.onTime * 100) / a.installmentsDue) : null,
    missRatePct: a.installmentsDue ? Math.round((a.missed * 100) / a.installmentsDue) : null,
  }));

  return {
    asOf: asOf.toISOString(),
    byBand: rows.sort((a, b) => a.band.localeCompare(b.band)),
    note:
      'Outcomes for simulated loans, grouped by the risk band each borrower was scored at when they applied. This is how a scorecard gets marked.',
  };
}
