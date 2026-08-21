/**
 * Scoring.
 *
 * Everything here runs through the consent gate first. The gate is called by the
 * pipeline rather than mounted as middleware, because middleware would only
 * protect this HTTP path and not an internal caller.
 *
 * At this stage the route exposes the CONSENTED INPUTS — what Nambikai is
 * permitted to see and what it actually read. The scorecard that turns these
 * into a number is the next layer; it consumes exactly this vector and nothing
 * else, which is what keeps the score reproducible from a hash of its inputs.
 */
import { Router } from 'express';
import prisma from '../../lib/db.js';
import { asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { ACTOR, ARTIFACT_TYPE, PURPOSE, SUBJECT_TYPE } from '../../nambikai/constants.js';
import { requireConsent } from '../../nambikai/consent/consent.guard.js';
import * as audit from '../../nambikai/consent/audit.js';
import { buildUserFeatureVector } from '../../nambikai/features/featureVector.js';
import { computeHealthScore } from '../../nambikai/pipeline/score.pipeline.js';
import * as persist from '../../nambikai/pipeline/persist.js';
import { monthsBetween } from '../../nambikai/util/window.js';
import { bpsToPct, ratioBps } from '../../nambikai/util/stats.js';
import { GRADE_MESSAGE } from '../../nambikai/engine/bands.js';
import { validate } from '../../middleware/validate.js';
import { historyQuerySchema, scoreQuerySchema } from '../../nambikai/validators.js';
import * as s from '../../nambikai/serialize.js';
const { money } = s;

const router = Router();
router.use(requireAuth);

/**
 * The consented view of a subject's own data.
 *
 * Note the order: consent is checked, then features are extracted (each
 * extractor re-asserting against the token), then the USE rows are written for
 * the data types that were ACTUALLY read. A permitted-but-unread type gets no
 * row — that distinction is the whole point of the audit log.
 */
router.get(
  '/inputs',
  asyncHandler(async (req, res) => {
    const asOf = new Date();

    const token = await requireConsent({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      purpose: PURPOSE.HEALTH_SCORE,
      actor: ACTOR.USER,
      actorId: req.user.id,
      requestId: req.requestId,
    });

    const tenureMonths = monthsBetween(req.user.createdAt, asOf);
    const fv = await buildUserFeatureVector(req.user.id, { asOf, token, tenureMonths });

    await audit.logUse({ token, artifactType: ARTIFACT_TYPE.FINANCIAL_HEALTH_SCORE });

    const { ledger, group } = fv;
    const totalInflow = ledger.monthlyInflowPaise.reduce((a, b) => a + b, 0);
    const totalOutflow = ledger.monthlyOutflowPaise.reduce((a, b) => a + b, 0);
    const avgMonthlyOutflow = Math.round(totalOutflow / Math.max(ledger.activeMonths, 1));

    res.json({
      asOf: fv.asOf,
      engineVersion: fv.engineVersion,
      inputsHash: fv.inputsHash,
      consent: {
        purpose: token.purpose,
        // Exactly what was read, in the order it was read. This is what the
        // "Nambikai used these signals" line is generated from.
        dataTypesUsed: [...token.used],
        consentRef: token.primaryConsentId,
        requestId: token.requestId,
      },
      wallet: {
        monthsObserved: ledger.activeMonths,
        accountTenureMonths: tenureMonths,
        transactionCount: ledger.entryCount,
        totalReceived: money(totalInflow),
        totalSpent: money(totalOutflow),
        currentBalance: money(ledger.currentBalancePaise),
        avgMonthlySpend: money(avgMonthlyOutflow),
        bufferDays: avgMonthlyOutflow
          ? Math.round((ledger.currentBalancePaise * 30) / avgMonthlyOutflow)
          : null,
        monthsWithIncomePct: bpsToPct(
          ratioBps(
            ledger.monthsWithIncome.reduce((a, b) => a + b, 0),
            ledger.activeMonths,
          ),
        ),
        distinctCounterparties: ledger.distinctCounterparties,
        daysSinceLastActivity: ledger.daysSinceLastActivity,
      },
      commitments: {
        settledCycles: group.dueCount,
        onTime: group.onTimeCount,
        late: group.lateCount,
        missed: group.missedCount,
        openCycles: group.openCount,
        onTimePct: group.dueCount ? bpsToPct(ratioBps(group.onTimeCount, group.dueCount)) : null,
        activeGroups: group.activeGroupCount,
        monthsInAnyGroup: group.monthsInAnyGroup,
        totalSaved: money(group.savedPaise),
      },
    });
  }),
);


/**
 * The financial health score.
 *
 * What is returned is deliberately shaped around explanation rather than around
 * the number: the breakdown says how each category contributed, the reason codes
 * say which behaviours drove it and carry the evidence they were derived from,
 * and the gates say plainly whether anything capped the result.
 *
 * The consumer-facing `grade` is what the UI shows a person. The partner-facing
 * risk `band` is present for the report layer, and the UI never uses it to tell
 * someone they are a risk.
 */
async function respondWithScore(req, res, { refresh }) {
  const asOf = new Date();
  const result = await computeHealthScore({
    subjectId: req.user.id,
    user: req.user,
    asOf,
    requestId: req.requestId,
    actorId: req.user.id,
    refresh,
  });

  res.json({ score: s.healthScore(result.score), cached: result.cached });
}

router.get(
  '/',
  validate({ query: scoreQuerySchema }),
  asyncHandler(async (req, res) => respondWithScore(req, res, { refresh: req.valid.query.refresh })),
);

router.post(
  '/recompute',
  asyncHandler(async (req, res) => respondWithScore(req, res, { refresh: true })),
);

/** The score over time — the shape of a life, not a single verdict. */
router.get(
  '/history',
  validate({ query: historyQuerySchema }),
  asyncHandler(async (req, res) => {
    const rows = await persist.scoreHistory({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      limit: req.valid.query.limit,
    });
    res.json({
      points: rows
        .map((r) => ({ score: r.score, grade: r.grade, computedAt: r.computedAt }))
        .reverse(),
    });
  }),
);

/** The four behaviour signals on their own, independent of today's weights. */
router.get(
  '/signals',
  asyncHandler(async (req, res) => {
    // Reading a signal is reading the subject's data, so it goes through the
    // same gate rather than trusting that a row already exists.
    await computeHealthScore({
      subjectId: req.user.id,
      user: req.user,
      asOf: new Date(),
      requestId: req.requestId,
      actorId: req.user.id,
    });
    const rows = await persist.latestSignals({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
    });
    res.json({ signals: rows.map(s.behaviourSignal) });
  }),
);

export default router;
