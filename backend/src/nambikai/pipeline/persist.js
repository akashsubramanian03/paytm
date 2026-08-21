/**
 * Writing engine output to the database.
 *
 * Kept apart from `engine/` so that layer can stay pure. Everything here is
 * impure by definition; nothing here makes a decision.
 */
import prisma from '../../lib/db.js';
import { SIGNAL_KEY } from '../constants.js';
import { ENGINE_VERSION } from '../version.js';

/**
 * Upsert the four behaviour signals.
 *
 * Upsert rather than append: the unique key is (subject, signal, window) with no
 * timestamp, so repeated scoring does not grow rows without bound. Historical
 * snapshots live inside FinancialHealthScore.breakdown, which is the artifact
 * that is actually meant to be a record.
 */
export async function writeSignals({ subjectType, subjectId, signals, window }) {
  const written = [];
  for (const key of Object.keys(SIGNAL_KEY)) {
    const signal = signals[key];
    if (!signal) continue;
    const data = {
      subjectType,
      subjectId,
      signalKey: key,
      windowDays: window.days,
      windowStart: window.start,
      windowEnd: window.end,
      valueBps: signal.valueBps,
      sampleCount: signal.sampleCount,
      evidence: JSON.stringify(signal.evidence ?? {}),
      engineVersion: ENGINE_VERSION,
      computedAt: window.end,
    };
    written.push(
      await prisma.behaviourSignal.upsert({
        where: {
          subjectType_subjectId_signalKey_windowDays: {
            subjectType,
            subjectId,
            signalKey: key,
            windowDays: window.days,
          },
        },
        create: data,
        update: data,
      }),
    );
  }
  return written;
}

export async function writeScore({
  subjectType,
  subjectId,
  scoreResult,
  ruleResult,
  inputsHash,
  consentRecordId,
  computedAt,
}) {
  return prisma.financialHealthScore.create({
    data: {
      subjectType,
      subjectId,
      score: scoreResult.score,
      // The band that is STORED is the one after the gates. The pre-gate band is
      // kept in `gates` so the adjustment is inspectable rather than lost.
      band: ruleResult.band,
      grade: scoreResult.grade,
      breakdown: JSON.stringify(scoreResult.breakdown),
      reasonCodes: JSON.stringify([...scoreResult.reasonCodes, ...ruleResult.reasonCodes]),
      gates: JSON.stringify({
        bandBeforeGates: ruleResult.bandBeforeGates,
        downgraded: ruleResult.downgraded,
        eligible: ruleResult.eligible,
        gates: ruleResult.gates,
      }),
      inputsHash,
      computedWithoutClusterData: scoreResult.computedWithoutClusterData,
      engineVersion: ENGINE_VERSION,
      consentRecordId,
      computedAt,
    },
  });
}

export async function latestScore({ subjectType, subjectId }) {
  return prisma.financialHealthScore.findFirst({
    where: { subjectType, subjectId },
    orderBy: { computedAt: 'desc' },
  });
}

export async function scoreHistory({ subjectType, subjectId, limit = 12 }) {
  return prisma.financialHealthScore.findMany({
    where: { subjectType, subjectId },
    orderBy: { computedAt: 'desc' },
    take: limit,
  });
}

export async function latestSignals({ subjectType, subjectId }) {
  return prisma.behaviourSignal.findMany({
    where: { subjectType, subjectId },
    orderBy: { computedAt: 'desc' },
  });
}
