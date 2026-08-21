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
import { monthsBetween } from '../../nambikai/util/window.js';
import { bpsToPct, ratioBps } from '../../nambikai/util/stats.js';
import { money } from '../../nambikai/serialize.js';

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

export default router;
