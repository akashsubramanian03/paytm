/**
 * Savings-group features: the commitment record.
 *
 * This is the category that matters most for a thin-file applicant, because it
 * is the only one that measures a promise kept rather than money observed. A
 * bureau cannot see any of it.
 *
 * Like the ledger extractor, the consent assertion is the first statement. Test
 * 16 calls this function directly with a token that lacks GROUP_CONTRIBUTIONS
 * and asserts that it throws — which is what proves the gate lives at the data
 * boundary rather than on the HTTP route.
 */
import prisma from '../../lib/db.js';
import {
  CONTRIB_STATUS,
  DATA_TYPE,
  DEFAULT_WINDOW_MONTHS,
  MEMBER_STATUS,
} from '../constants.js';
import { assertDataType } from '../consent/consent.guard.js';
import { monthsBetween, utcMonthStart } from '../util/window.js';

export async function extractGroupFeatures(
  userId,
  { asOf = new Date(), months = DEFAULT_WINDOW_MONTHS, token } = {},
) {
  assertDataType(token, DATA_TYPE.GROUP_CONTRIBUTIONS);

  const windowStart = utcMonthStart(asOf, -(months - 1));

  const [memberships, dueInWindow, everDue] = await Promise.all([
    prisma.groupMember.findMany({
      where: { userId },
      include: { group: true },
    }),
    prisma.contribution.findMany({
      where: {
        userId,
        dueAt: { gte: windowStart, lte: asOf },
        status: { not: CONTRIB_STATUS.WAIVED },
      },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.contribution.findFirst({
      where: { userId },
      orderBy: { dueAt: 'asc' },
    }),
  ]);

  // A cycle that is merely open is not yet a broken promise. Only settled
  // cycles — paid or definitively missed — are evidence either way.
  const settled = dueInWindow.filter(
    (c) => c.status === CONTRIB_STATUS.PAID || c.status === CONTRIB_STATUS.MISSED,
  );
  const paid = settled.filter((c) => c.status === CONTRIB_STATUS.PAID);
  const paidOnTime = paid.filter((c) => c.daysLate === 0);
  const paidLate = paid.filter((c) => c.daysLate > 0);
  const missed = settled.filter((c) => c.status === CONTRIB_STATUS.MISSED);

  const totalDaysLate = paidLate.reduce((sum, c) => sum + c.daysLate, 0);

  const activeMemberships = memberships.filter(
    (m) => m.status === MEMBER_STATUS.ACTIVE && m.group.status === 'ACTIVE',
  );

  const earliestJoin = memberships.reduce(
    (earliest, m) => (!earliest || m.joinedAt < earliest ? m.joinedAt : earliest),
    null,
  );

  // Recency matters: six clean cycles a year ago and three misses last month is
  // a different applicant from the reverse, and a flat average hides it.
  const recent = settled.slice(-6);
  const recentMissed = recent.filter((c) => c.status === CONTRIB_STATUS.MISSED).length;

  return {
    dueCount: settled.length,
    paidCount: paid.length,
    onTimeCount: paidOnTime.length,
    lateCount: paidLate.length,
    missedCount: missed.length,
    totalDaysLate,
    avgDaysLate: paidLate.length ? Math.round(totalDaysLate / paidLate.length) : 0,

    openCount: dueInWindow.length - settled.length,
    recentDueCount: recent.length,
    recentMissedCount: recentMissed,

    activeGroupCount: activeMemberships.length,
    everGroupCount: memberships.length,
    monthsInAnyGroup: earliestJoin ? monthsBetween(earliestJoin, asOf) : 0,
    firstContributionDueAt: everDue?.dueAt ? everDue.dueAt.toISOString() : null,

    savedPaise: paid.reduce((sum, c) => sum + c.amountPaidPaise, 0),
    committedPerCyclePaise: activeMemberships.reduce(
      (sum, m) => sum + m.group.contributionPaise,
      0,
    ),
  };
}
