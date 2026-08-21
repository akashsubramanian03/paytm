/**
 * Response shapes for the Nambikai API.
 *
 * Mirrors the conventions in lib/serialize.js: money is returned as both integer
 * paise and a pre-formatted INR string so the client never does currency maths,
 * and nothing leaks a field the caller has no business seeing.
 */
import { formatINR, paiseToRupees } from '../lib/money.js';
import { initialsOf } from '../lib/serialize.js';
import {
  CADENCE,
  CATEGORY_DESCRIPTION,
  CATEGORY_LABEL,
  CONTRIB_STATUS,
  DATA_TYPE_LABEL,
  PURPOSE_LABEL,
  SME_CATEGORY_DESCRIPTION,
  SME_CATEGORY_LABEL,
} from './constants.js';
import { bpsToPct } from './util/stats.js';

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const money = (paise) => ({
  paise,
  rupees: paiseToRupees(paise),
  formatted: formatINR(paise),
});

const GROUP_PURPOSE_LABEL = {
  SAVINGS: 'Savings circle',
  ROTATING_SAVINGS: 'Rotating savings (chit)',
  EMERGENCY_FUND: 'Emergency fund',
  BUSINESS_POOL: 'Business pool',
};

const CADENCE_LABEL = { WEEKLY: 'Every week', MONTHLY: 'Every month' };

export const CONTRIB_STATUS_LABEL = {
  PENDING: 'Due',
  PAID: 'Paid',
  LATE: 'Paid late',
  MISSED: 'Missed',
  WAIVED: 'Waived',
};

/** A person as they appear inside a group. Contact details are never included —
 *  group membership is not a reason to expose someone's phone number. */
export function groupPerson(user) {
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    initials: initialsOf(user.firstName, user.lastName),
    avatarColor: user.avatarColor,
    upiId: user.upiId,
  };
}

export function group(g, { memberCount, myStats } = {}) {
  return {
    id: g.id,
    name: g.name,
    purpose: g.purpose,
    purposeLabel: GROUP_PURPOSE_LABEL[g.purpose] ?? g.purpose,
    cadence: g.cadence,
    cadenceLabel: CADENCE_LABEL[g.cadence] ?? g.cadence,
    contribution: money(g.contributionPaise),
    plannedCycles: g.plannedCycles,
    isOpenEnded: g.plannedCycles === 0,
    startedAt: g.startedAt,
    status: g.status,
    createdById: g.createdById,
    memberCount: memberCount ?? g.members?.length ?? 0,
    createdAt: g.createdAt,
    ...(myStats ? { my: myStats } : {}),
  };
}

export function groupMember(m) {
  return {
    id: m.id,
    userId: m.userId,
    role: m.role,
    payoutOrder: m.payoutOrder,
    status: m.status,
    joinedAt: m.joinedAt,
    exitedAt: m.exitedAt,
    ...(m.user ? { user: groupPerson(m.user) } : {}),
  };
}

export function contribution(c) {
  return {
    id: c.id,
    groupId: c.groupId,
    userId: c.userId,
    cycleIndex: c.cycleIndex,
    dueAt: c.dueAt,
    paidAt: c.paidAt,
    amountDue: money(c.amountDuePaise),
    amountPaid: money(c.amountPaidPaise),
    status: c.status,
    statusLabel: CONTRIB_STATUS_LABEL[c.status] ?? c.status,
    daysLate: c.daysLate,
    isPayable: c.status === CONTRIB_STATUS.PENDING || c.status === CONTRIB_STATUS.LATE,
    // The passbook row this contribution annotates, when it was actually paid.
    ledgerEntryId: c.ledgerEntryId,
    payoutToUserId: c.payoutToUserId,
  };
}

/** Per-member summary shown on the group list. */
export function memberStats(contributions) {
  const due = contributions.filter((c) => c.status !== CONTRIB_STATUS.WAIVED);
  const paid = due.filter((c) => c.status === CONTRIB_STATUS.PAID);
  const onTime = paid.filter((c) => c.daysLate === 0);
  const missed = due.filter((c) => c.status === CONTRIB_STATUS.MISSED);
  const next = due
    .filter((c) => c.status === CONTRIB_STATUS.PENDING || c.status === CONTRIB_STATUS.LATE)
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];

  return {
    dueCount: due.length,
    paidCount: paid.length,
    onTimeCount: onTime.length,
    missedCount: missed.length,
    onTimePct: due.length ? Math.round((onTime.length * 100) / due.length) : null,
    totalSaved: money(paid.reduce((sum, c) => sum + c.amountPaidPaise, 0)),
    nextDue: next ? contribution(next) : null,
  };
}

export function consentRecord(c, { asOf = new Date() } = {}) {
  const active =
    !c.revokedAt && (!c.expiresAt || new Date(c.expiresAt) > asOf);
  return {
    id: c.id,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    dataType: c.dataType,
    dataTypeLabel: DATA_TYPE_LABEL[c.dataType] ?? c.dataType,
    purpose: c.purpose,
    purposeLabel: PURPOSE_LABEL[c.purpose] ?? c.purpose,
    scope: parseJson(c.scope, {}),
    version: c.version,
    grantedAt: c.grantedAt,
    expiresAt: c.expiresAt,
    revokedAt: c.revokedAt,
    active,
  };
}

const AUDIT_LABEL = {
  GRANT: 'You allowed Nambikai to read',
  REVOKE: 'You withdrew permission for',
  USE: 'Nambikai read',
  DENY: 'Nambikai was blocked from reading',
  EXPIRE: 'Permission expired for',
};

export function auditEvent(e) {
  return {
    id: e.id,
    action: e.action,
    dataType: e.dataType,
    dataTypeLabel: DATA_TYPE_LABEL[e.dataType] ?? e.dataType,
    purpose: e.purpose,
    purposeLabel: PURPOSE_LABEL[e.purpose] ?? e.purpose,
    actor: e.actor,
    reason: e.reason,
    artifactType: e.artifactType,
    artifactId: e.artifactId,
    requestId: e.requestId,
    createdAt: e.createdAt,
    label: `${AUDIT_LABEL[e.action] ?? e.action} ${DATA_TYPE_LABEL[e.dataType] ?? e.dataType}`,
  };
}

/** A stored FinancialHealthScore, expanded for the dashboard. */
export function healthScore(s) {
  const breakdown = parseJson(s.breakdown, []);
  const isSme = s.subjectType === 'BUSINESS';
  const labels = isSme ? SME_CATEGORY_LABEL : CATEGORY_LABEL;
  const descriptions = isSme ? SME_CATEGORY_DESCRIPTION : CATEGORY_DESCRIPTION;

  return {
    id: s.id,
    subjectType: s.subjectType,
    subjectId: s.subjectId,
    value: s.score,
    band: s.band,
    grade: s.grade,
    breakdown: breakdown.map((b) => ({
      ...b,
      label: labels[b.category] ?? b.category,
      description: descriptions[b.category] ?? null,
      rawPct: bpsToPct(b.rawBps),
      weightPct: bpsToPct(b.weightBps),
      contributionPct: Math.round(b.contributionBps / 100),
    })),
    reasonCodes: parseJson(s.reasonCodes, []),
    gates: parseJson(s.gates, []),
    engineVersion: s.engineVersion,
    inputsHash: s.inputsHash,
    consentRecordId: s.consentRecordId,
    computedAt: s.computedAt,
  };
}

export function behaviourSignal(sig) {
  return {
    key: sig.signalKey,
    valueBps: sig.valueBps,
    valuePct: bpsToPct(sig.valueBps),
    windowDays: sig.windowDays,
    windowStart: sig.windowStart,
    windowEnd: sig.windowEnd,
    sampleCount: sig.sampleCount,
    evidence: parseJson(sig.evidence, {}),
    computedAt: sig.computedAt,
  };
}

export function business(b) {
  return {
    id: b.id,
    ownerId: b.ownerId,
    name: b.name,
    sector: b.sector,
    gstNumber: b.gstNumber,
    registeredAt: b.registeredAt,
    city: b.city,
    employeeCount: b.employeeCount,
    monthlyRevenue: money(b.monthlyRevenueEstimatePaise),
    monthlyInflow: money(b.monthlyInflowEstimatePaise),
    receivables: money(b.receivablesEstimatePaise),
    existingDebt: money(b.existingDebtEstimatePaise),
    status: b.status,
    createdAt: b.createdAt,
  };
}

export function businessRecord(r) {
  return {
    id: r.id,
    kind: r.kind,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    amount: money(r.amountPaise),
    status: r.status,
    counterpartyName: r.counterpartyName,
    dueAt: r.dueAt,
    settledAt: r.settledAt,
    metadata: parseJson(r.metadata, null),
  };
}

export { money, parseJson };
