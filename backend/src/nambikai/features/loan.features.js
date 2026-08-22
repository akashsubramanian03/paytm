/**
 * Loan and repayment features.
 *
 * Same discipline as every other extractor: the consent assertion is the first
 * statement, so a missing permission stops the query being issued rather than
 * filtering a response that was already fetched.
 *
 * Note the two separate permissions. LOAN_HISTORY covers the existence and size
 * of a loan — which a lender needs to know for capacity. REPAYMENT_HISTORY
 * covers how it was serviced, which is a judgement about conduct. Someone may
 * reasonably disclose the first without the second, and the score simply treats
 * the conduct category as unmeasured if they do.
 */
import prisma from '../../lib/db.js';
import {
  DATA_TYPE,
  DEFAULT_WINDOW_MONTHS,
  INSTALLMENT_STATUS,
  LOAN_STATUS,
} from '../constants.js';
import { assertDataType } from '../consent/consent.guard.js';
import { daysBetween, utcMonthStart } from '../util/window.js';

/** How many of the most recent instalments count double. */
const RECENT_WINDOW = 6;

export async function extractLoanFeatures(
  userId,
  { asOf = new Date(), months = DEFAULT_WINDOW_MONTHS, token } = {},
) {
  assertDataType(token, DATA_TYPE.LOAN_HISTORY);

  const loans = await prisma.loan.findMany({
    where: { userId },
    include: { installments: { orderBy: { dueAt: 'asc' } } },
  });

  const activeLoans = loans.filter((l) => l.status === LOAN_STATUS.ACTIVE);
  const closedLoans = loans.filter((l) => l.status === LOAN_STATUS.CLOSED);

  const base = {
    activeLoanCount: activeLoans.length,
    closedLoanCount: closedLoans.length,
    writtenOffCount: loans.filter((l) => l.status === LOAN_STATUS.WRITTEN_OFF).length,
    activeEmiPaise: activeLoans.reduce((sum, l) => sum + l.emiPaise, 0),
    outstandingPaise: activeLoans.reduce((sum, l) => sum + l.outstandingPaise, 0),
    totalBorrowedPaise: loans.reduce((sum, l) => sum + l.principalPaise, 0),
    hasEverBorrowed: loans.length > 0,
  };

  // Conduct is a separate disclosure. Without it, the repayment category is
  // unmeasured and its weight redistributes — the score is simply built from
  // less, rather than from a guess.
  if (!token.grantedDataTypes.has(DATA_TYPE.REPAYMENT_HISTORY)) {
    return { ...base, settledCount: 0, repaymentDisclosed: false };
  }
  token.used.add(DATA_TYPE.REPAYMENT_HISTORY);

  const windowStart = utcMonthStart(asOf, -(months - 1));
  const installments = loans
    .flatMap((l) => l.installments)
    .filter((i) => i.dueAt >= windowStart && i.dueAt <= asOf);

  // Only settled instalments are evidence either way. One that is merely open is
  // not yet a kept promise or a broken one.
  const settled = installments.filter(
    (i) => i.status === INSTALLMENT_STATUS.PAID || i.status === INSTALLMENT_STATUS.MISSED,
  );
  const paid = settled.filter((i) => i.status === INSTALLMENT_STATUS.PAID);
  const onTime = paid.filter((i) => i.daysLate === 0);
  const late = paid.filter((i) => i.daysLate > 0);
  const missed = settled.filter((i) => i.status === INSTALLMENT_STATUS.MISSED);

  const recent = settled.slice(-RECENT_WINDOW);
  const recentOnTime = recent.filter(
    (i) => i.status === INSTALLMENT_STATUS.PAID && i.daysLate === 0,
  );

  // Days past due on anything still owed right now — the delinquency signal.
  const overdue = installments.filter(
    (i) =>
      (i.status === INSTALLMENT_STATUS.PENDING ||
        i.status === INSTALLMENT_STATUS.LATE ||
        i.status === INSTALLMENT_STATUS.MISSED) &&
      i.dueAt < asOf,
  );
  const maxDaysPastDue = overdue.reduce(
    (max, i) => Math.max(max, daysBetween(i.dueAt, asOf)),
    0,
  );

  return {
    ...base,
    repaymentDisclosed: true,
    settledCount: settled.length,
    onTimeCount: onTime.length,
    lateCount: late.length,
    missedCount: missed.length,
    avgDaysLate: late.length
      ? Math.round(late.reduce((sum, i) => sum + i.daysLate, 0) / late.length)
      : 0,
    recentSettledCount: recent.length,
    recentOnTimeCount: recentOnTime.length,
    overdueCount: overdue.length,
    maxDaysPastDue,
    nextDueAt: installments
      .filter((i) => i.status === INSTALLMENT_STATUS.PENDING)
      .sort((a, b) => a.dueAt - b.dueAt)[0]?.dueAt ?? null,
  };
}

/** The shape the scorecard expects when no loan permission was granted. */
export const NO_LOAN_FEATURES = {
  activeLoanCount: 0,
  closedLoanCount: 0,
  writtenOffCount: 0,
  activeEmiPaise: 0,
  outstandingPaise: 0,
  totalBorrowedPaise: 0,
  hasEverBorrowed: false,
  repaymentDisclosed: false,
  settledCount: 0,
};
