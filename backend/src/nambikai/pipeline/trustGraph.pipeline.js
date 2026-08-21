/**
 * The trust graph.
 *
 * COMPLIANCE NOTE — READ BEFORE CHANGING ANYTHING HERE.
 *
 * An edge records that a subject has genuinely, repeatedly shown up in a
 * relationship: a circle they contribute to, a shop they buy from every week, a
 * supplier they pay. `strengthBps` measures PARTICIPATION and VERIFICATION —
 * how consistently and for how long — and nothing else.
 *
 * It is NOT a transfer of credit risk between the two ends of the edge. One
 * member defaulting must never move another member's score. Nothing in
 * engine/scorecard.js may import this module, and nothing here is an input to a
 * FinancialHealthScore. The graph exists so a lender can see that a thin-file
 * applicant is embedded in verifiable relationships, not so that anyone can be
 * judged by their associates.
 *
 * The only place group-level behaviour is allowed to inform an assessment is the
 * Cluster Trust Signal, which is opt-in, appealable, and reported as its own
 * separate field.
 */
import prisma from '../../lib/db.js';
import { CONTRIB_STATUS, MEMBER_STATUS, TRUST_RELATION } from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { clampBps, ratioBps } from '../util/stats.js';
import { monthsBetween } from '../util/window.js';

/** How many repeat dealings before a counterparty counts as a real relationship. */
const MIN_OBSERVATIONS = 4;

/**
 * Rebuild every edge for one subject.
 *
 * Strength blends how long the relationship has run against how often it
 * recurs — a supplier paid twice a week for a year is a stronger verification
 * than one paid twice, ever.
 */
export async function rebuildTrustGraphForUser(userId, { asOf = new Date() } = {}) {
  const edges = [];

  /* ---- user -> group ---- */
  const memberships = await prisma.groupMember.findMany({
    where: { userId, status: MEMBER_STATUS.ACTIVE },
    include: { group: true },
  });

  for (const membership of memberships) {
    const mine = await prisma.contribution.findMany({
      where: { groupId: membership.groupId, userId, dueAt: { lte: asOf } },
    });
    const settled = mine.filter(
      (c) => c.status === CONTRIB_STATUS.PAID || c.status === CONTRIB_STATUS.MISSED,
    );
    if (!settled.length) continue;

    const months = monthsBetween(membership.joinedAt, asOf);
    // Participation, not performance: how present they have been, and for how
    // long. Whether they paid ON TIME belongs to their own COMMITMENTS score,
    // not to the shape of the relationship.
    const showedUp = settled.filter((c) => c.status === CONTRIB_STATUS.PAID).length;
    const strengthBps = clampBps(
      Math.round(
        (ratioBps(showedUp, settled.length) * 60 + clampBps(Math.round((months * 10_000) / 18)) * 40) /
          100,
      ),
    );

    edges.push({
      fromType: 'USER',
      fromId: userId,
      toType: 'GROUP',
      toId: membership.groupId,
      relation: TRUST_RELATION.GROUP_MEMBER,
      strengthBps,
      observationCount: settled.length,
      firstSeenAt: membership.joinedAt,
      lastSeenAt: asOf,
      evidence: JSON.stringify({
        groupName: membership.group.name,
        settledCycles: settled.length,
        monthsInGroup: months,
        // Stated in the record itself, so anyone reading the row knows what it
        // does and does not mean.
        meaning: 'participation and verification only; not a transfer of credit risk',
      }),
      engineVersion: ENGINE_VERSION,
      computedAt: asOf,
    });
  }

  /* ---- user -> business (as customer or supplier) ---- */
  // A repeated counterparty who owns a business is a verifiable commercial
  // relationship: the neighbourhood shop someone buys from every week.
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId, counterpartyId: { not: null }, category: 'TRANSFER' },
    select: { counterpartyId: true, direction: true, createdAt: true, metadata: true },
  });

  const byCounterparty = new Map();
  for (const entry of entries) {
    // Circle money is a group relationship, already captured above.
    if ((entry.metadata ?? '').includes('GROUP_CONTRIBUTION')) continue;
    if (!byCounterparty.has(entry.counterpartyId)) {
      byCounterparty.set(entry.counterpartyId, { paidTo: 0, receivedFrom: 0, first: entry.createdAt, last: entry.createdAt });
    }
    const agg = byCounterparty.get(entry.counterpartyId);
    if (entry.direction === 'DEBIT') agg.paidTo += 1;
    else agg.receivedFrom += 1;
    if (entry.createdAt < agg.first) agg.first = entry.createdAt;
    if (entry.createdAt > agg.last) agg.last = entry.createdAt;
  }

  const counterpartyIds = [...byCounterparty.keys()];
  const businesses = counterpartyIds.length
    ? await prisma.business.findMany({ where: { ownerId: { in: counterpartyIds } } })
    : [];
  const businessByOwner = new Map(businesses.map((b) => [b.ownerId, b]));

  for (const [counterpartyId, agg] of byCounterparty) {
    const business = businessByOwner.get(counterpartyId);
    if (!business) continue;

    const total = agg.paidTo + agg.receivedFrom;
    if (total < MIN_OBSERVATIONS) continue;

    const months = Math.max(monthsBetween(agg.first, agg.last), 1);
    const strengthBps = clampBps(
      Math.round(
        (clampBps(Math.round((total * 10_000) / 24)) * 60 +
          clampBps(Math.round((months * 10_000) / 12)) * 40) /
          100,
      ),
    );

    edges.push({
      fromType: 'USER',
      fromId: userId,
      toType: 'BUSINESS',
      toId: business.id,
      // Direction of the money names the role: mostly paying them makes you
      // their customer; mostly being paid makes them your customer.
      relation: agg.paidTo >= agg.receivedFrom ? TRUST_RELATION.SUPPLIER : TRUST_RELATION.CUSTOMER,
      strengthBps,
      observationCount: total,
      firstSeenAt: agg.first,
      lastSeenAt: agg.last,
      evidence: JSON.stringify({
        businessName: business.name,
        dealings: total,
        monthsKnown: months,
        meaning: 'participation and verification only; not a transfer of credit risk',
      }),
      engineVersion: ENGINE_VERSION,
      computedAt: asOf,
    });
  }

  for (const edge of edges) {
    await prisma.trustGraphEdge.upsert({
      where: {
        fromType_fromId_toType_toId_relation: {
          fromType: edge.fromType,
          fromId: edge.fromId,
          toType: edge.toType,
          toId: edge.toId,
          relation: edge.relation,
        },
      },
      create: edge,
      update: edge,
    });
  }

  return edges;
}

export async function trustGraphFor(userId) {
  return prisma.trustGraphEdge.findMany({
    where: { fromType: 'USER', fromId: userId },
    orderBy: { strengthBps: 'desc' },
  });
}
