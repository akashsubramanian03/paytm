/**
 * Building an underwriting report.
 *
 * The whole sequence in one place: consent -> score -> gates -> (cluster) ->
 * explanation -> persist. The order is the guarantee. By the time the explainer
 * runs, the risk category is already fixed.
 *
 * THE CLUSTER ASSERTION. Before any cluster signal may be attached, this
 * pipeline checks that the score it is attaching to was computed WITHOUT cluster
 * data. That flag is set in engine/scorecard.js and nowhere else. Anyone who
 * wires group-level data into the individual scorecard has to delete this
 * assertion to make the code run, which turns a silent fairness regression into
 * a visible diff.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import {
  ACTOR,
  ARTIFACT_TYPE,
  ATTRIBUTION,
  CLUSTER_OMISSION,
  EXPLAINER_SOURCE,
  PURPOSE,
  SUBJECT_TYPE,
} from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { requireConsent } from '../consent/consent.guard.js';
import * as audit from '../consent/audit.js';
import { buildUserFeatureVector } from '../features/featureVector.js';
import { computeSignals } from '../engine/signals.js';
import { scoreUser } from '../engine/scorecard.js';
import { applyRules } from '../engine/rules.js';
import { emit } from '../engine/reasonCodes.js';
import { buildExplainerContext } from '../ai/context.js';
import { explainReport } from '../ai/explainer.js';
import { findPartner, PARTNER_DISCLAIMER } from '../partners.js';
import { monthsBetween } from '../util/window.js';
import { bpsToPct } from '../util/stats.js';
import { rebuildTrustGraphForUser } from './trustGraph.pipeline.js';
import * as persist from './persist.js';

/**
 * The cluster hook.
 *
 * Phase 7 supplies the real implementation. Until then this returns null with a
 * reason, and the report carries `cluster_signal: null` — which is deliberately
 * the SAME shape the real one produces when a subject has not opted in. Shipping
 * the null path first means the report's structure is proven before the feature
 * that fills it exists, so adding the feature cannot quietly change the contract.
 */
let clusterProvider = async () => ({ signal: null, omissionReason: CLUSTER_OMISSION.NOT_CONSENTED });

/** Phase 7 installs the real provider here. */
export function setClusterProvider(fn) {
  clusterProvider = fn;
}

const CLUSTER_CODE = {
  POSITIVE: 'CLUSTER_SIGNAL_POSITIVE',
  NEUTRAL: 'CLUSTER_SIGNAL_NEUTRAL',
  CAUTION: 'CLUSTER_SIGNAL_CAUTION',
};

const OMISSION_CODE = {
  [CLUSTER_OMISSION.NOT_CONSENTED]: 'CLUSTER_SIGNAL_NOT_CONSENTED',
  [CLUSTER_OMISSION.SUPPRESSED_APPEAL]: 'CLUSTER_SIGNAL_SUPPRESSED_APPEAL',
  [CLUSTER_OMISSION.INSUFFICIENT_EVIDENCE]: 'CLUSTER_SIGNAL_INSUFFICIENT_EVIDENCE',
  [CLUSTER_OMISSION.NO_CLUSTER]: 'CLUSTER_SIGNAL_INSUFFICIENT_EVIDENCE',
};

export async function buildUnderwritingReport({
  applicantType = SUBJECT_TYPE.USER,
  applicantId,
  user,
  partnerId,
  asOf = new Date(),
  requestId,
  actorId,
}) {
  const partner = findPartner(partnerId);
  if (!partner) throw ApiError.badRequest('UNKNOWN_PARTNER', 'That lending partner is not recognised.');

  // 1. Consent for UNDERWRITING specifically. Consenting to see your own score
  //    is not consenting to send an assessment to a lender.
  const token = await requireConsent({
    subjectType: applicantType,
    subjectId: applicantId,
    purpose: PURPOSE.UNDERWRITING,
    actor: ACTOR.PARTNER,
    actorId: actorId ?? applicantId,
    requestId,
    asOf,
  });

  // 2. Features and the engine. Always recomputed for a report — a lender-facing
  //    document should not be built from a cached number of unknown age.
  const tenureMonths = user ? monthsBetween(user.createdAt, asOf) : 0;
  const fv = await buildUserFeatureVector(applicantId, { asOf, token, tenureMonths });
  const signals = computeSignals(fv);
  const scoreResult = scoreUser(fv);
  const ruleResult = applyRules(scoreResult, fv);

  // 3. Persist the score this report is about, so the report references a real
  //    stored artifact rather than a number that exists only inside it.
  await persist.writeSignals({
    subjectType: applicantType,
    subjectId: applicantId,
    signals,
    window: { days: 365, start: new Date(fv.asOf), end: asOf },
  });
  const storedScore = await persist.writeScore({
    subjectType: applicantType,
    subjectId: applicantId,
    scoreResult,
    ruleResult,
    inputsHash: fv.inputsHash,
    consentRecordId: token.primaryConsentId,
    computedAt: asOf,
  });

  // 4. The cluster signal, if and only if the subject opted in.
  const cluster = await clusterProvider({ userId: applicantId, asOf, requestId });

  if (cluster.signal) {
    // THE ASSERTION. See the note at the top of this file.
    if (!scoreResult.computedWithoutClusterData) {
      throw new Error(
        'Refusing to attach a cluster signal to a score that may already contain cluster data. ' +
          'The individual score and the cluster signal must remain separate.',
      );
    }
  }

  // 5. Trust graph — relationships a lender can verify, never a risk transfer.
  const edges = await rebuildTrustGraphForUser(applicantId, { asOf });

  // 6. Reason codes, with cluster codes tagged distinctly and marked as not
  //    affecting the score.
  const clusterCodes = cluster.signal
    ? [
        emit(CLUSTER_CODE[cluster.signal.band] ?? CLUSTER_CODE.NEUTRAL, {
          clusterType: cluster.signal.clusterType,
          reliabilityPct: bpsToPct(cluster.signal.reliabilityBps),
          memberCount: cluster.signal.memberCount,
          observedCycles: cluster.signal.observedCycles,
        }),
      ]
    : [emit(OMISSION_CODE[cluster.omissionReason] ?? 'CLUSTER_SIGNAL_NOT_CONSENTED', {})];

  const individualCodes = [...scoreResult.reasonCodes, ...ruleResult.reasonCodes];

  // 7. The explanation. Runs last, on a fixed result.
  const context = buildExplainerContext({
    user,
    score: {
      score: scoreResult.score,
      grade: scoreResult.grade,
      breakdown: scoreResult.breakdown,
      reasonCodes: individualCodes,
      tenureMonths,
      isThinFile: fv.ledger.activeMonths < 6,
    },
    ruleResult,
    clusterSignal: cluster.signal,
    partner,
  });
  const explanation = await explainReport(context, {
    richCodes: [...individualCodes, ...clusterCodes],
    cacheKey: fv.inputsHash,
    userId: actorId,
  });

  // 8. The payload, exactly as the caller receives it.
  const payload = {
    applicant_id: applicantId,
    applicant_type: applicantType,
    risk_category: ruleResult.band,
    eligible: ruleResult.eligible,
    score: {
      value: scoreResult.score,
      grade: scoreResult.grade,
      band_before_gates: ruleResult.bandBeforeGates,
      engine_version: ENGINE_VERSION,
      inputs_hash: fv.inputsHash,
    },
    individual_positive_signals: individualCodes
      .filter((c) => c.polarity === 'POSITIVE')
      .map((c) => ({ code: c.code, label: c.label, evidence: c.evidence })),
    individual_risk_signals: individualCodes
      .filter((c) => c.polarity === 'NEGATIVE')
      .map((c) => ({ code: c.code, label: c.label, evidence: c.evidence })),

    /**
     * ALWAYS PRESENT, object or null. Never merged into the individual signals
     * above, and never omitted — a client that receives this key can only treat
     * it as a separate thing, and a null with a stated reason is a different
     * disclosure from a missing field.
     */
    cluster_signal: cluster.signal
      ? {
          cluster_id: cluster.signal.clusterId,
          cluster_type: cluster.signal.clusterType,
          cluster_name: cluster.signal.clusterName ?? null,
          reliability_score: bpsToPct(cluster.signal.reliabilityBps),
          band: cluster.signal.band,
          member_count: cluster.signal.memberCount,
          observed_cycles: cluster.signal.observedCycles,
          excluded_subject: true,
          affects_individual_score: false,
          disclaimer:
            'A participation and verification signal for the group this applicant belongs to. It is not a transfer of credit risk between members and is never blended into the individual score.',
          opt_out_path: 'POST /api/v1/nambikai/cluster/opt-out',
          appeal_path: 'POST /api/v1/nambikai/cluster/appeals',
        }
      : null,
    cluster_omission_reason: cluster.signal ? null : cluster.omissionReason,

    reason_codes: [
      ...individualCodes.map((c) => ({
        code: c.code,
        attribution: ATTRIBUTION.INDIVIDUAL,
        polarity: c.polarity,
        affects_score: c.affectsScore,
      })),
      ...clusterCodes.map((c) => ({
        code: c.code,
        attribution: ATTRIBUTION.CLUSTER,
        polarity: c.polarity,
        affects_score: false,
      })),
    ],
    gates: ruleResult.gates.map((g) => ({ code: g.code, triggered: g.triggered, effect: g.effect })),
    relationships: edges.map((e) => ({
      type: e.toType,
      relation: e.relation,
      strength_pct: bpsToPct(e.strengthBps),
      observations: e.observationCount,
      meaning: 'participation and verification only',
    })),
    recommendation_text: explanation.text,
    explainer_source: explanation.source,
    consent_ref: token.primaryConsentId,
    requested_by_partner_id: partnerId,
    partner_disclaimer: PARTNER_DISCLAIMER,
    generated_at: asOf.toISOString(),
  };

  const stored = await prisma.underwritingReport.create({
    data: {
      applicantType,
      applicantId,
      requestedByPartnerId: partnerId,
      riskCategory: ruleResult.band,
      scoreId: storedScore.id,
      clusterSignalId: cluster.signal?.id ?? null,
      clusterSignalIncluded: Boolean(cluster.signal),
      clusterOmissionReason: cluster.signal ? null : cluster.omissionReason,
      reasonCodes: JSON.stringify(payload.reason_codes),
      recommendationText: explanation.text,
      explainerSource: explanation.source ?? EXPLAINER_SOURCE.TEMPLATE,
      payload: JSON.stringify(payload),
      consentRecordId: token.primaryConsentId,
      engineVersion: ENGINE_VERSION,
      generatedAt: asOf,
    },
  });

  await audit.logUse({
    token,
    artifactType: ARTIFACT_TYPE.UNDERWRITING_REPORT,
    artifactId: stored.id,
  });

  return { report: stored, payload };
}

/**
 * A stored report, plus whether the consent behind it still stands.
 *
 * Reports are never deleted when consent is withdrawn — they are the record of
 * what was disclosed, and destroying that would remove the very evidence a
 * person might need. They become unusable instead, and say so.
 */
export async function readReport({ id, applicantId }) {
  const report = await prisma.underwritingReport.findFirst({
    where: { id, applicantId },
    include: { consentRecord: true },
  });
  if (!report) throw ApiError.notFound('Report not found.');

  const consent = report.consentRecord;
  const revoked = Boolean(consent?.revokedAt);
  return {
    report,
    consentStatus: revoked ? 'REVOKED' : 'ACTIVE',
    usable: !revoked,
  };
}
