/**
 * Savings groups — the entry point of the whole Nambikai flywheel.
 *
 * A group is a schedule and a ledger of kept promises. Nambikai holds no pot and
 * runs no auction: contributions are ordinary wallet transfers between members,
 * and the payout step is REPORTED, not performed. Note there is deliberately no
 * POST /:id/payout-cycle — executing a chit payout is a regulated activity.
 */
import { Router } from 'express';
import prisma from '../../lib/db.js';
import { ApiError, asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { payGroupContribution } from '../../lib/wallet.js';
import { ledgerEntry, balance } from '../../lib/serialize.js';
import {
  CONTRIB_STATUS,
  GROUP_STATUS,
  MEMBER_ROLE,
  MEMBER_STATUS,
} from '../../nambikai/constants.js';
import {
  addMemberSchema,
  createGroupSchema,
  groupContributionParamsSchema,
  idParamSchema,
  listContributionsSchema,
} from '../../nambikai/validators.js';
import * as s from '../../nambikai/serialize.js';
import {
  collectorForCycle,
  cyclesElapsed,
  isRotating,
  lateDays,
  payoutCycleFor,
  syncGroup,
} from '../../nambikai/groups.service.js';

const router = Router();
router.use(requireAuth);

/** Load a group the caller is actually a member of. Membership is the only way
 *  to see a group — there is no public group directory. */
async function loadMemberGroup(groupId, userId, { include = {} } = {}) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: { include: { user: true } }, ...include },
  });
  if (!group) throw ApiError.notFound('Group not found.');

  const me = group.members.find((m) => m.userId === userId && m.status === MEMBER_STATUS.ACTIVE);
  if (!me) throw ApiError.notFound('Group not found.');

  return { group, me };
}

/* -------------------------------------------------------------- listing -- */

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: req.user.id, status: MEMBER_STATUS.ACTIVE },
      include: { group: { include: { members: true } } },
      orderBy: { joinedAt: 'desc' },
    });

    const asOf = new Date();
    // Lazily bring each group's schedule up to date. Cheap and idempotent, which
    // is what lets this run on read instead of needing a scheduler.
    for (const m of memberships) await syncGroup(m.groupId, asOf);

    const groupIds = memberships.map((m) => m.groupId);
    const mine = groupIds.length
      ? await prisma.contribution.findMany({
          where: { groupId: { in: groupIds }, userId: req.user.id },
        })
      : [];

    const byGroup = new Map();
    for (const c of mine) {
      if (!byGroup.has(c.groupId)) byGroup.set(c.groupId, []);
      byGroup.get(c.groupId).push(c);
    }

    res.json({
      groups: memberships.map((m) =>
        s.group(m.group, {
          memberCount: m.group.members.filter((x) => x.status === MEMBER_STATUS.ACTIVE).length,
          myStats: s.memberStats(byGroup.get(m.groupId) ?? []),
        }),
      ),
    });
  }),
);

/* ------------------------------------------------------------- creation -- */

router.post(
  '/',
  validate({ body: createGroupSchema }),
  asyncHandler(async (req, res) => {
    const { name, purpose, cadence, amount, plannedCycles, startedAt, memberUserIds, rotation } =
      req.valid.body;

    const uniqueOthers = [...new Set(memberUserIds)].filter((id) => id !== req.user.id);

    if (uniqueOthers.length) {
      const found = await prisma.user.count({ where: { id: { in: uniqueOthers } } });
      if (found !== uniqueOthers.length) {
        throw ApiError.badRequest('UNKNOWN_MEMBER', 'One of those people is not on Paytm.');
      }
    }

    // The creator is always the admin and a member. Ordering: creator first, then
    // the invited members in the order given, unless an explicit rotation is set.
    const ordered = rotation?.length
      ? [...new Set(rotation)].filter((id) => id === req.user.id || uniqueOthers.includes(id))
      : [req.user.id, ...uniqueOthers];

    const memberIds = [req.user.id, ...uniqueOthers];
    for (const id of memberIds) if (!ordered.includes(id)) ordered.push(id);

    const groupStart = startedAt ?? new Date();

    const created = await prisma.group.create({
      data: {
        name,
        purpose,
        cadence,
        contributionPaise: amount,
        plannedCycles,
        startedAt: groupStart,
        status: GROUP_STATUS.ACTIVE,
        createdById: req.user.id,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === req.user.id ? MEMBER_ROLE.ADMIN : MEMBER_ROLE.MEMBER,
            payoutOrder: ordered.indexOf(userId) + 1,
            // Founding members are in from cycle 1, so their joinedAt is the
            // group's start rather than "now". This matters for the common real
            // case: a circle that has been running informally for a year and is
            // being recorded in Nambikai today. Without it, ensureCycles would
            // skip every backdated cycle as predating the membership and the
            // group would arrive with no history at all. Members added LATER
            // (POST /:id/members) keep their real join date and correctly owe
            // nothing for cycles that closed before them.
            joinedAt: groupStart,
          })),
        },
      },
      include: { members: { include: { user: true } } },
    });

    await syncGroup(created.id);

    const withCycles = await prisma.group.findUnique({
      where: { id: created.id },
      include: { members: { include: { user: true } } },
    });

    res.status(201).json({
      group: s.group(withCycles, { memberCount: withCycles.members.length }),
      members: withCycles.members.map(s.groupMember),
    });
  }),
);

/* ------------------------------------------------------------------ one -- */

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const asOf = new Date();
    await loadMemberGroup(req.valid.params.id, req.user.id);
    await syncGroup(req.valid.params.id, asOf);

    const { group } = await loadMemberGroup(req.valid.params.id, req.user.id);
    const contributions = await prisma.contribution.findMany({
      where: { groupId: group.id },
      orderBy: [{ cycleIndex: 'asc' }, { dueAt: 'asc' }],
    });

    const mine = contributions.filter((c) => c.userId === req.user.id);
    const activeMembers = group.members.filter((m) => m.status === MEMBER_STATUS.ACTIVE);

    // Per-cycle roll-up so the UI can draw the timeline without doing the maths.
    const cycles = [];
    for (const c of contributions) {
      let cycle = cycles.find((x) => x.cycleIndex === c.cycleIndex);
      if (!cycle) {
        cycle = {
          cycleIndex: c.cycleIndex,
          dueAt: c.dueAt,
          payoutToUserId: c.payoutToUserId,
          paidCount: 0,
          missedCount: 0,
          totalCount: 0,
          collectedPaise: 0,
        };
        cycles.push(cycle);
      }
      cycle.totalCount += 1;
      if (c.status === CONTRIB_STATUS.PAID) {
        cycle.paidCount += 1;
        cycle.collectedPaise += c.amountPaidPaise;
      }
      if (c.status === CONTRIB_STATUS.MISSED) cycle.missedCount += 1;
    }
    cycles.sort((a, b) => a.cycleIndex - b.cycleIndex);

    res.json({
      group: s.group(group, {
        memberCount: activeMembers.length,
        myStats: s.memberStats(mine),
      }),
      members: group.members.map(s.groupMember),
      isRotating: isRotating(group),
      currentCycle: cyclesElapsed(group, asOf),
      cycles: cycles.map((c) => ({ ...c, collected: s.money(c.collectedPaise) })),
      myContributions: mine.map(s.contribution),
    });
  }),
);

/* ---------------------------------------------------------------- members -- */

router.post(
  '/:id/members',
  validate({ params: idParamSchema, body: addMemberSchema }),
  asyncHandler(async (req, res) => {
    const { group, me } = await loadMemberGroup(req.valid.params.id, req.user.id);
    if (me.role !== MEMBER_ROLE.ADMIN) {
      throw ApiError.forbidden('Only the group admin can add members.');
    }

    const { userId, payoutOrder } = req.valid.body;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('That person is not on Paytm.');

    const existing = group.members.find((m) => m.userId === userId);
    if (existing && existing.status === MEMBER_STATUS.ACTIVE) {
      throw ApiError.conflict('ALREADY_A_MEMBER', 'They are already in this group.');
    }

    const nextOrder =
      payoutOrder ?? Math.max(0, ...group.members.map((m) => m.payoutOrder ?? 0)) + 1;

    // Re-joining reactivates the original row so the member keeps their history.
    const member = existing
      ? await prisma.groupMember.update({
          where: { id: existing.id },
          data: { status: MEMBER_STATUS.ACTIVE, exitedAt: null, payoutOrder: nextOrder },
          include: { user: true },
        })
      : await prisma.groupMember.create({
          data: { groupId: group.id, userId, payoutOrder: nextOrder },
          include: { user: true },
        });

    await syncGroup(group.id);
    res.status(201).json({ member: s.groupMember(member) });
  }),
);

router.delete(
  '/:id/members/:userId',
  validate({ params: idParamSchema.extend({ userId: idParamSchema.shape.id }) }),
  asyncHandler(async (req, res) => {
    const { group, me } = await loadMemberGroup(req.valid.params.id, req.user.id);
    if (me.role !== MEMBER_ROLE.ADMIN) {
      throw ApiError.forbidden('Only the group admin can remove members.');
    }
    if (req.valid.params.userId === req.user.id) {
      throw ApiError.badRequest('CANNOT_REMOVE_ADMIN', 'The admin cannot leave their own group.');
    }

    const target = group.members.find(
      (m) => m.userId === req.valid.params.userId && m.status === MEMBER_STATUS.ACTIVE,
    );
    if (!target) throw ApiError.notFound('They are not in this group.');

    const member = await prisma.groupMember.update({
      where: { id: target.id },
      data: { status: MEMBER_STATUS.REMOVED, exitedAt: new Date() },
      include: { user: true },
    });

    // Unpaid future obligations disappear with the membership; the record of what
    // they did or did not pay while they were in the group stays untouched.
    await prisma.contribution.deleteMany({
      where: { groupId: group.id, userId: target.userId, status: CONTRIB_STATUS.PENDING },
    });

    res.json({ member: s.groupMember(member) });
  }),
);

/* ---------------------------------------------------------- contributions -- */

router.get(
  '/:id/contributions',
  validate({ params: idParamSchema, query: listContributionsSchema }),
  asyncHandler(async (req, res) => {
    const { group } = await loadMemberGroup(req.valid.params.id, req.user.id);
    await syncGroup(group.id);

    const { cycleIndex, status } = req.valid.query;
    const contributions = await prisma.contribution.findMany({
      where: { groupId: group.id, ...(cycleIndex && { cycleIndex }), ...(status && { status }) },
      orderBy: [{ cycleIndex: 'asc' }, { dueAt: 'asc' }],
    });

    res.json({ count: contributions.length, contributions: contributions.map(s.contribution) });
  }),
);

/**
 * Pay one contribution. The ONLY new money path Nambikai adds.
 *
 * The amount comes from the Contribution row, never from the request body — the
 * same rule the wallet already applies to recharge plans and bill payments.
 */
router.post(
  '/:id/contributions/:contributionId/pay',
  validate({ params: groupContributionParamsSchema }),
  asyncHandler(async (req, res) => {
    const { group } = await loadMemberGroup(req.valid.params.id, req.user.id);

    const contribution = await prisma.contribution.findFirst({
      where: {
        id: req.valid.params.contributionId,
        groupId: group.id,
        userId: req.user.id,
      },
    });
    if (!contribution) throw ApiError.notFound('Contribution not found.');
    if (contribution.status === CONTRIB_STATUS.PAID) {
      throw ApiError.conflict('CONTRIBUTION_ALREADY_PAID', 'You have already paid this one.');
    }
    if (contribution.status === CONTRIB_STATUS.WAIVED) {
      throw ApiError.conflict('CONTRIBUTION_WAIVED', 'This contribution was waived.');
    }

    const collector = collectorForCycle(
      group,
      group.members,
      contribution.cycleIndex,
      req.user.id,
    );
    if (!collector) {
      throw ApiError.unprocessable(
        'NO_COLLECTOR',
        'This group has nobody to collect this cycle yet.',
      );
    }

    const paidAt = new Date();
    const result = await payGroupContribution({
      payerId: req.user.id,
      payeeId: collector.userId,
      contributionId: contribution.id,
      amountPaise: contribution.amountDuePaise,
      daysLate: lateDays(contribution.dueAt, paidAt),
      note: `${group.name} · cycle ${contribution.cycleIndex}`,
      metadata: {
        groupId: group.id,
        groupName: group.name,
        cycleIndex: contribution.cycleIndex,
        contributionId: contribution.id,
      },
    });

    const account = await prisma.account.findUnique({ where: { userId: req.user.id } });

    res.status(201).json({
      success: true,
      message: `Contribution paid to ${collector.user?.firstName ?? 'the group'}.`,
      contribution: s.contribution(result.contribution),
      transaction: ledgerEntry(result.entry),
      account: balance(account),
    });
  }),
);

/* ---------------------------------------------------------- payout cycle -- */

/**
 * What this cycle WOULD pay out, and to whom.
 *
 * Read-only on purpose. There is no POST counterpart anywhere in this codebase:
 * running a chit auction and disbursing the pot is a regulated activity, and the
 * honest thing for this demo to do is describe the hand-off to a registered
 * operator rather than simulate being one.
 */
router.get(
  '/:id/payout-cycle',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const asOf = new Date();
    const { group } = await loadMemberGroup(req.valid.params.id, req.user.id);
    await syncGroup(group.id, asOf);

    const contributions = await prisma.contribution.findMany({ where: { groupId: group.id } });
    const cycle = payoutCycleFor(group, group.members, contributions, asOf);

    const payoutTo = cycle.payoutToUserId
      ? group.members.find((m) => m.userId === cycle.payoutToUserId)
      : null;

    res.json({
      cycleIndex: cycle.cycleIndex,
      isRotating: isRotating(group),
      payoutTo: payoutTo?.user ? s.groupPerson(payoutTo.user) : null,
      collected: s.money(cycle.collectedPaise),
      expected: s.money(cycle.expectedPaise),
      routing: cycle.routing,
    });
  }),
);

export default router;
