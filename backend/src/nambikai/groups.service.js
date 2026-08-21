/**
 * Savings-group cycle bookkeeping.
 *
 * A Group here is a schedule, not a fund. This module works out WHEN each member
 * owes a contribution and WHO a rotating group would pay out to — it never moves
 * money and never executes a payout. The actual transfer goes through
 * lib/wallet.js#payGroupContribution like any other transfer, and the payout step
 * is reported, not performed (see payoutCycleFor).
 *
 * All date maths is UTC, matching util/window.js, so a group's cycle boundaries
 * are a property of the group rather than of the server's timezone.
 */
import prisma from '../lib/db.js';
import { CADENCE, CONTRIB_STATUS, MEMBER_STATUS, GROUP_PURPOSE } from './constants.js';
import { daysBetween } from './util/window.js';

/** How long after the due date a contribution may still be paid before it counts
 *  as MISSED rather than merely LATE. Real chit groups have exactly this kind of
 *  informal grace, and scoring without one would punish ordinary life. */
export const GRACE_DAYS = { WEEKLY: 3, MONTHLY: 7 };

/** Groups that rotate a pot to one member per cycle. */
const ROTATING_PURPOSES = new Set([GROUP_PURPOSE.ROTATING_SAVINGS, GROUP_PURPOSE.BUSINESS_POOL]);

export const isRotating = (group) => ROTATING_PURPOSES.has(group.purpose);

/** Due date of a 1-based cycle index. */
export function cycleDueDate(startedAt, cadence, cycleIndex) {
  const start = new Date(startedAt);
  const n = cycleIndex - 1;
  if (cadence === CADENCE.WEEKLY) {
    return new Date(start.getTime() + n * 7 * 86_400_000);
  }
  return new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + n,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      0,
      0,
    ),
  );
}

/** How many cycles have come due by `asOf` (0 if the group has not started). */
export function cyclesElapsed(group, asOf) {
  const start = new Date(group.startedAt);
  if (asOf < start) return 0;
  if (group.cadence === CADENCE.WEEKLY) {
    return Math.floor(daysBetween(start, asOf) / 7) + 1;
  }
  const a = start;
  const b = new Date(asOf);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(months, 0) + 1;
}

/**
 * Which member a rotating group pays out to in a given cycle.
 * Returns null for pure savings groups, where nobody is paid out — members simply
 * contribute to the group's designated collector (its admin).
 */
export function payoutMemberForCycle(group, members, cycleIndex) {
  const active = members
    .filter((m) => m.status === MEMBER_STATUS.ACTIVE)
    .sort((a, b) => (a.payoutOrder ?? 9999) - (b.payoutOrder ?? 9999) || a.joinedAt - b.joinedAt);
  if (!active.length) return null;
  if (!isRotating(group)) return null;
  return active[(cycleIndex - 1) % active.length];
}

/**
 * Who a member's contribution is actually SENT to in a given cycle.
 * Rotating groups: this cycle's payout member. Savings groups: the group admin,
 * who acts as the collector — the same arrangement a real neighbourhood committee
 * runs on. Returns null when the payer would be paying themselves.
 */
export function collectorForCycle(group, members, cycleIndex, payerId) {
  const target = isRotating(group)
    ? payoutMemberForCycle(group, members, cycleIndex)
    : (members.find((m) => m.role === 'ADMIN' && m.status === MEMBER_STATUS.ACTIVE) ?? null);
  if (!target || target.userId === payerId) return null;
  return target;
}

/**
 * Create any Contribution rows that have come due but do not exist yet, and one
 * cycle of lookahead so a member always has something to pay.
 *
 * Idempotent: existing rows are read and skipped, with the
 * [groupId, userId, cycleIndex] unique constraint as the backstop. Calling this
 * repeatedly is safe and cheap, which is what lets it run lazily on read
 * instead of needing a scheduler.
 */
export async function ensureCycles(groupId, asOf = new Date()) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true },
  });
  if (!group || group.status !== 'ACTIVE') return { created: 0 };

  const active = group.members.filter((m) => m.status === MEMBER_STATUS.ACTIVE);
  if (!active.length) return { created: 0 };

  let upTo = cyclesElapsed(group, asOf) + 1; // +1 = lookahead
  if (group.plannedCycles > 0) upTo = Math.min(upTo, group.plannedCycles);
  if (upTo < 1) return { created: 0 };

  // Prisma does not support createMany({ skipDuplicates }) on SQLite, so the
  // idempotency is explicit: read the keys that already exist and skip them.
  // The [groupId, userId, cycleIndex] unique constraint is still the backstop if
  // two callers race here.
  const existing = await prisma.contribution.findMany({
    where: { groupId },
    select: { userId: true, cycleIndex: true },
  });
  const seen = new Set(existing.map((c) => `${c.userId}:${c.cycleIndex}`));

  const rows = [];
  for (let cycleIndex = 1; cycleIndex <= upTo; cycleIndex += 1) {
    const dueAt = cycleDueDate(group.startedAt, group.cadence, cycleIndex);
    const payout = payoutMemberForCycle(group, group.members, cycleIndex);
    for (const member of active) {
      // The member receiving this cycle's pot does not also pay into it.
      if (payout && payout.userId === member.userId) continue;
      // Nobody owes for cycles that predate them joining.
      if (new Date(member.joinedAt) > dueAt) continue;
      if (seen.has(`${member.userId}:${cycleIndex}`)) continue;
      rows.push({
        groupId,
        userId: member.userId,
        cycleIndex,
        dueAt,
        amountDuePaise: group.contributionPaise,
        status: CONTRIB_STATUS.PENDING,
        payoutToUserId: payout?.userId ?? null,
      });
    }
  }

  if (!rows.length) return { created: 0 };
  const result = await prisma.contribution.createMany({ data: rows });
  return { created: result.count };
}

/**
 * Flip PENDING contributions that are past their grace period to MISSED.
 *
 * Run lazily on read rather than on a schedule. A MISSED row moves no money, so
 * this is pure bookkeeping — but it is the single most important input the
 * behaviour engine has, because a record of kept commitments is only meaningful
 * if broken ones are recorded too.
 */
export async function refreshOverdue(groupId, asOf = new Date()) {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return { missed: 0 };

  const grace = GRACE_DAYS[group.cadence] ?? GRACE_DAYS.MONTHLY;
  const cutoff = new Date(asOf.getTime() - grace * 86_400_000);

  const result = await prisma.contribution.updateMany({
    where: { groupId, status: CONTRIB_STATUS.PENDING, dueAt: { lt: cutoff } },
    data: { status: CONTRIB_STATUS.MISSED },
  });
  return { missed: result.count };
}

/** Bring a group's ledger up to date before reading it. */
export async function syncGroup(groupId, asOf = new Date()) {
  await ensureCycles(groupId, asOf);
  await refreshOverdue(groupId, asOf);
}

/** Whole days a payment made at `paidAt` is late. 0 if on or before the due date. */
export function lateDays(dueAt, paidAt) {
  return daysBetween(dueAt, paidAt);
}

/**
 * What a rotating group's current cycle WOULD pay out, and to whom.
 *
 * Nambikai does not run this. There is deliberately no POST counterpart to the
 * route that returns this — executing a chit payout is a regulated activity, and
 * the honest thing for a demo to do is describe the hand-off rather than fake it.
 */
export function payoutCycleFor(group, members, contributions, asOf = new Date()) {
  const cycleIndex = Math.max(Math.min(cyclesElapsed(group, asOf), group.plannedCycles || Infinity), 1);
  const payout = payoutMemberForCycle(group, members, cycleIndex);
  const forCycle = contributions.filter((c) => c.cycleIndex === cycleIndex);
  const collectedPaise = forCycle
    .filter((c) => c.status === CONTRIB_STATUS.PAID)
    .reduce((sum, c) => sum + c.amountPaidPaise, 0);
  const expectedPaise = forCycle.reduce((sum, c) => sum + c.amountDuePaise, 0);

  return {
    cycleIndex,
    payoutToUserId: payout?.userId ?? null,
    collectedPaise,
    expectedPaise,
    routing: {
      handledByNambikai: false,
      label: 'Would route to a registered chit fund operator',
      detail:
        'Nambikai records the schedule and the contributions. It does not hold the pot, run the auction, or make the payout — that is a regulated activity and would be carried out by a registered partner.',
    },
  };
}
