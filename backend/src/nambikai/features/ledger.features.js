/**
 * Wallet features: everything the engine knows from the passbook.
 *
 * This is one of only two layers that touch Prisma, and it never runs without a
 * ConsentToken. assertDataType is the first statement in the function for a
 * reason — a missing permission stops the query from being issued at all, rather
 * than filtering rows out of a response that was already fetched.
 *
 * WHAT THE TWO WALLET PERMISSIONS ACTUALLY SEPARATE.
 * WALLET_LEDGER covers amounts, dates, directions and categories — enough to see
 * "a bill is paid most months". BILL_PAYMENTS and RECHARGE_HISTORY cover the
 * DETAIL: which biller, which consumer number, which plan. A score needs the
 * former; only a lender-facing report has any business with the latter. So the
 * biller identities in `metadata` are read only when that consent is present,
 * and the score is identical either way.
 *
 * Nothing here returns a row id, a counterparty identity, or a note. The
 * FeatureVector that leaves this layer is flat integers and ISO strings.
 */
import prisma from '../../lib/db.js';
import { DATA_TYPE, DEFAULT_WINDOW_MONTHS } from '../constants.js';
import { assertDataType } from '../consent/consent.guard.js';
import { historyMonths, monthBuckets, utcMonthStart } from '../util/window.js';

/** Money in: credits that represent earnings, not the demo's own signup bonus. */
const INCOME_CATEGORIES = new Set(['TRANSFER', 'ADD_MONEY']);

const isSignupBonus = (entry) => (entry.metadata ?? '').includes('SIGNUP_BONUS');

export async function extractLedgerFeatures(
  userId,
  { asOf = new Date(), months = DEFAULT_WINDOW_MONTHS, token } = {},
) {
  assertDataType(token, DATA_TYPE.WALLET_LEDGER);

  // Detail-level access is optional and does not change any number below.
  const mayReadBillDetail = token.grantedDataTypes.has(DATA_TYPE.BILL_PAYMENTS);
  if (mayReadBillDetail) token.used.add(DATA_TYPE.BILL_PAYMENTS);

  const windowStart = utcMonthStart(asOf, -(months - 1));

  const [account, oldest, entries] = await Promise.all([
    prisma.account.findUnique({ where: { userId } }),
    prisma.ledgerEntry.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.ledgerEntry.findMany({
      where: { userId, createdAt: { gte: windowStart, lte: asOf } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const firstActivityAt = oldest?.createdAt ?? null;
  const activeMonths = historyMonths({ firstActivityAt, asOf, max: months });

  const buckets = monthBuckets(entries, { asOf, months });

  const monthlyInflowPaise = [];
  const monthlyOutflowPaise = [];
  const monthEndBalancePaise = [];
  const monthsWithIncome = [];
  const monthsWithBill = [];
  const monthsWithRecharge = [];

  for (const bucket of buckets) {
    let inflow = 0;
    let outflow = 0;
    let sawBill = false;
    let sawRecharge = false;

    for (const entry of bucket.rows) {
      if (entry.direction === 'CREDIT') {
        if (INCOME_CATEGORIES.has(entry.category) && !isSignupBonus(entry)) inflow += entry.amountPaise;
      } else {
        outflow += entry.amountPaise;
        if (entry.category === 'BILL_PAYMENT') sawBill = true;
        if (entry.category === 'RECHARGE') sawRecharge = true;
      }
    }

    monthlyInflowPaise.push(inflow);
    monthlyOutflowPaise.push(outflow);
    monthsWithIncome.push(inflow > 0 ? 1 : 0);
    monthsWithBill.push(sawBill ? 1 : 0);
    monthsWithRecharge.push(sawRecharge ? 1 : 0);
    // The closing balance of the month, or carried forward if the month was quiet.
    const last = bucket.rows[bucket.rows.length - 1];
    monthEndBalancePaise.push(
      last ? last.balanceAfterPaise : (monthEndBalancePaise[monthEndBalancePaise.length - 1] ?? 0),
    );
  }

  const failedCount = entries.filter((e) => e.status !== 'SUCCESS').length;
  // A balance under Rs 100 after a payment is a sign of strain, not of thrift.
  const lowBalanceCount = entries.filter((e) => e.balanceAfterPaise < 10_000).length;

  const counterpartyIds = new Set(
    entries.filter((e) => e.counterpartyId).map((e) => e.counterpartyId),
  );

  /**
   * Peer repayment: money received from someone, then largely sent back to that
   * same person within 45 days. Nambikai has no bureau access, so this is the
   * only repayment evidence that exists — and the UI says exactly that rather
   * than letting anyone assume a CIBIL pull.
   */
  const credits = entries.filter((e) => e.direction === 'CREDIT' && e.counterpartyId);
  const debits = entries.filter((e) => e.direction === 'DEBIT' && e.counterpartyId);
  let borrowLikeEvents = 0;
  let repaidEvents = 0;

  for (const credit of credits) {
    // Only sizeable, one-off credits look like a loan from a friend.
    if (credit.amountPaise < 100_000) continue;
    borrowLikeEvents += 1;
    const deadline = new Date(credit.createdAt.getTime() + 45 * 86_400_000);
    const returned = debits
      .filter(
        (d) =>
          d.counterpartyId === credit.counterpartyId &&
          d.createdAt > credit.createdAt &&
          d.createdAt <= deadline,
      )
      .reduce((sum, d) => sum + d.amountPaise, 0);
    if (returned * 100 >= credit.amountPaise * 90) repaidEvents += 1;
  }

  const billerVariety = mayReadBillDetail
    ? new Set(
        entries
          .filter((e) => e.category === 'BILL_PAYMENT')
          .map((e) => e.counterpartyName),
      ).size
    : null;

  return {
    windowMonths: months,
    activeMonths,
    firstActivityAt: firstActivityAt ? firstActivityAt.toISOString() : null,
    lastActivityAt: entries.length ? entries[entries.length - 1].createdAt.toISOString() : null,
    daysSinceLastActivity: entries.length
      ? Math.trunc((asOf - entries[entries.length - 1].createdAt) / 86_400_000)
      : null,

    currentBalancePaise: account?.balancePaise ?? 0,
    monthlyInflowPaise,
    monthlyOutflowPaise,
    monthEndBalancePaise,
    monthsWithIncome,
    monthsWithBill,
    monthsWithRecharge,

    entryCount: entries.length,
    failedCount,
    lowBalanceCount,
    distinctCounterparties: counterpartyIds.size,
    borrowLikeEvents,
    repaidEvents,

    // Present only when the extra permission was granted; never scored.
    billerVariety,
  };
}
