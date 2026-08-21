/**
 * SME features: what a business looks like from its records.
 *
 * Same consent discipline as everywhere else — the assertion is the first
 * statement, so a missing permission stops the query rather than filtering a
 * response. GST filings and invoices are separate permissions because they are
 * genuinely different disclosures: turnover declared to the state, versus who
 * your customers are and how slowly they pay you.
 *
 * Nothing here reads Account or LedgerEntry, so the wallet invariants are
 * untouched by the SME slice. The owner's personal wallet is scored separately,
 * by the individual engine, using their own consent.
 */
import prisma from '../../lib/db.js';
import { DATA_TYPE, DEFAULT_WINDOW_MONTHS, RECORD_KIND, RECORD_STATUS } from '../constants.js';
import { assertDataType } from '../consent/consent.guard.js';
import { monthBuckets, utcMonthStart, daysBetween } from '../util/window.js';

export async function extractBusinessFeatures(
  businessId,
  { asOf = new Date(), months = DEFAULT_WINDOW_MONTHS, token } = {},
) {
  assertDataType(token, DATA_TYPE.BUSINESS_GST);
  assertDataType(token, DATA_TYPE.BUSINESS_INVOICES);

  const windowStart = utcMonthStart(asOf, -(months - 1));

  const [business, filings, invoices] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId } }),
    prisma.businessRecord.findMany({
      where: { businessId, kind: RECORD_KIND.GST_FILING, periodStart: { gte: windowStart, lte: asOf } },
      orderBy: { periodStart: 'asc' },
    }),
    prisma.businessRecord.findMany({
      where: { businessId, kind: RECORD_KIND.INVOICE, periodStart: { gte: windowStart, lte: asOf } },
      orderBy: { periodStart: 'asc' },
    }),
  ]);

  if (!business) return null;

  /* ---- revenue, from invoices ---- */
  const buckets = monthBuckets(invoices, { asOf, months, dateField: 'periodStart' });
  const monthlyInvoicedPaise = buckets.map((b) =>
    b.rows.reduce((sum, r) => sum + r.amountPaise, 0),
  );
  const activeMonths = monthlyInvoicedPaise.filter((v) => v > 0).length || 1;

  /* ---- receivables ---- */
  const settled = invoices.filter((i) => i.status === RECORD_STATUS.PAID && i.settledAt);
  const outstanding = invoices.filter(
    (i) => i.status === RECORD_STATUS.PENDING || i.status === RECORD_STATUS.OVERDUE,
  );
  const overdue = invoices.filter(
    (i) => i.status === RECORD_STATUS.OVERDUE || (i.status === RECORD_STATUS.PENDING && i.dueAt && i.dueAt < asOf),
  );

  // Days sales outstanding: how long customers actually take to pay.
  const totalDaysToSettle = settled.reduce(
    (sum, i) => sum + daysBetween(i.periodStart, i.settledAt),
    0,
  );
  const dso = settled.length ? Math.round(totalDaysToSettle / settled.length) : null;

  const outstandingPaise = outstanding.reduce((sum, i) => sum + i.amountPaise, 0);
  const overduePaise = overdue.reduce((sum, i) => sum + i.amountPaise, 0);

  /* ---- GST compliance ---- */
  const filedOnTime = filings.filter((f) => f.status === RECORD_STATUS.FILED).length;
  const filedLate = filings.filter((f) => f.status === RECORD_STATUS.LATE).length;
  const recentFilings = filings.slice(-6);
  const recentLate = recentFilings.filter((f) => f.status === RECORD_STATUS.LATE).length;
  const declaredTurnover = filings.map((f) => f.amountPaise);

  return {
    windowMonths: months,
    activeMonths,
    isRegistered: Boolean(business.gstNumber),

    monthlyInvoicedPaise,
    invoiceCount: invoices.length,
    settledCount: settled.length,
    outstandingCount: outstanding.length,
    outstandingPaise,
    overdueCount: overdue.length,
    overduePaise,
    dso,

    filingCount: filings.length,
    filedOnTime,
    filedLate,
    recentFilingCount: recentFilings.length,
    recentLate,
    declaredTurnoverPaise: declaredTurnover,

    monthlyRevenueEstimatePaise: business.monthlyRevenueEstimatePaise,
    monthlyInflowEstimatePaise: business.monthlyInflowEstimatePaise,
    receivablesEstimatePaise: business.receivablesEstimatePaise,
    existingDebtEstimatePaise: business.existingDebtEstimatePaise,
    employeeCount: business.employeeCount,
  };
}
