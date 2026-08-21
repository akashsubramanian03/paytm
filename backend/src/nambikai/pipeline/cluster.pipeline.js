/**
 * The Cluster Trust Signal: opt-in, appealable, and never blended.
 *
 * This is the one place group-level behaviour is allowed to inform an
 * assessment, and it is fenced accordingly. The fences are enforced in code
 * rather than trusted to reviewers:
 *
 *  1. OPT-IN ONLY. Without an active CLUSTER_TRUST_SIGNAL consent naming the
 *     specific group, this returns null with NOT_CONSENTED. Nothing is computed,
 *     nothing is stored, nothing is disclosed.
 *  2. AN APPEAL SUPPRESSES IMMEDIATELY. Checked at READ time, so filing a
 *     dispute takes effect on the very next request with no recompute and no
 *     delay. A person contesting a signal should not have to wait for a batch
 *     job to stop being judged by it.
 *  3. THE SUBJECT IS EXCLUDED from their own cluster aggregate.
 *  4. THIN EVIDENCE RETURNS NULL, never a fabricated number.
 */
import prisma from '../../lib/db.js';
import {
  APPEAL_SUPPRESSING_STATUSES,
  CLUSTER_OMISSION,
  CLUSTER_TYPE,
  CONTRIB_STATUS,
  DATA_TYPE,
  MEMBER_STATUS,
  PURPOSE,
  SUBJECT_TYPE,
} from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { computeClusterReliability } from '../engine/cluster.js';

/** Groups that could carry a signal at all, with why they can or cannot. */
export async function eligibleClustersFor(userId, { asOf = new Date() } = {}) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, status: MEMBER_STATUS.ACTIVE },
    include: { group: { include: { members: true } } },
  });

  const out = [];
  for (const membership of memberships) {
    const group = membership.group;
    const activeMembers = group.members.filter((m) => m.status === MEMBER_STATUS.ACTIVE).length;
    const settled = await prisma.contribution.count({
      where: {
        groupId: group.id,
        userId: { not: userId },
        dueAt: { lte: asOf },
        status: { in: [CONTRIB_STATUS.PAID, CONTRIB_STATUS.MISSED] },
      },
    });
    const eligible = activeMembers >= 3 && settled >= 12;
    out.push({
      groupId: group.id,
      name: group.name,
      memberCount: activeMembers,
      observationsExcludingYou: settled,
      eligible,
      reason: eligible ? null : CLUSTER_OMISSION.INSUFFICIENT_EVIDENCE,
    });
  }
  return out;
}

const activeClusterConsent = async (userId, asOf) =>
  prisma.consentRecord.findMany({
    where: {
      subjectType: SUBJECT_TYPE.USER,
      subjectId: userId,
      dataType: DATA_TYPE.CLUSTER_TRUST_SIGNAL,
      purpose: PURPOSE.UNDERWRITING,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }],
    },
  });

const openAppeals = async (userId) =>
  prisma.clusterSignalAppeal.findMany({
    where: { userId, status: { in: APPEAL_SUPPRESSING_STATUSES }, suppressed: true },
  });

/**
 * The signal for one user, or null with a reason.
 *
 * A reason is ALWAYS returned. "We did not look" and "we looked and found
 * nothing" are different disclosures and the report says which.
 */
export async function clusterSignalForUser(userId, { asOf = new Date(), persist = true } = {}) {
  const consents = await activeClusterConsent(userId, asOf);
  if (!consents.length) {
    return { signal: null, omissionReason: CLUSTER_OMISSION.NOT_CONSENTED };
  }

  // Read-time suppression: an open dispute takes effect immediately.
  const appeals = await openAppeals(userId);
  const suppressedGroupIds = new Set(appeals.map((a) => a.clusterId));

  for (const consent of consents) {
    let scope = {};
    try {
      scope = JSON.parse(consent.scope ?? '{}');
    } catch {
      scope = {};
    }
    const groupId = scope.clusterId;
    if (!groupId) continue;
    if (suppressedGroupIds.has(groupId)) {
      return { signal: null, omissionReason: CLUSTER_OMISSION.SUPPRESSED_APPEAL };
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    if (!group) continue;

    const activeMembers = group.members.filter((m) => m.status === MEMBER_STATUS.ACTIVE).length;

    // THE EXCLUSION. The subject's own rows are left out, so the signal is
    // exogenous and their behaviour is not counted twice.
    const contributions = await prisma.contribution.findMany({
      where: { groupId, userId: { not: userId }, dueAt: { lte: asOf } },
    });
    const completedCycles = contributions.reduce((max, c) => Math.max(max, c.cycleIndex), 0);

    const computed = computeClusterReliability({
      contributions,
      activeMembers,
      everMembers: group.members.length,
      completedCycles,
    });

    if (!computed) {
      return { signal: null, omissionReason: CLUSTER_OMISSION.INSUFFICIENT_EVIDENCE };
    }

    const record = {
      clusterType: CLUSTER_TYPE.GROUP,
      clusterId: groupId,
      reliabilityBps: computed.reliabilityBps,
      band: computed.band,
      memberCount: activeMembers,
      observedCycles: computed.completedCycles,
      onTimeRateBps: computed.onTimeRateBps,
      missedCount: computed.missedCount,
      excludedUserId: userId,
      evidence: JSON.stringify({
        observations: computed.observations,
        excludedSubject: true,
        meaning:
          'Describes the other members of this group. Never blended into the individual score.',
      }),
      engineVersion: ENGINE_VERSION,
      computedAt: asOf,
    };

    const stored = persist ? await prisma.clusterTrustSignal.create({ data: record }) : record;
    return {
      signal: { ...stored, clusterName: group.name, consentRef: consent.id },
      omissionReason: null,
    };
  }

  return { signal: null, omissionReason: CLUSTER_OMISSION.NO_CLUSTER };
}
