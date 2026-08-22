/**
 * The assistant.
 *
 * Note the order, which is the same as everywhere else in Nambikai: consent
 * first, then the score, then a scrubbed context, then — maybe — the model. The
 * assistant is a reader of already-computed facts, never a source of them.
 */
import { Router } from 'express';
import { asyncHandler } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ACTOR, ARTIFACT_TYPE, PURPOSE, SUBJECT_TYPE } from '../../nambikai/constants.js';
import { requireConsent } from '../../nambikai/consent/consent.guard.js';
import * as audit from '../../nambikai/consent/audit.js';
import { computeHealthScore } from '../../nambikai/pipeline/score.pipeline.js';
import { buildAssistantContext, bandRupees } from '../../nambikai/ai/context.js';
import { answerQuestion, SUGGESTIONS } from '../../nambikai/ai/assistant.js';
import { isAiEnabled } from '../../nambikai/ai/client.js';
import { parseJson } from '../../nambikai/serialize.js';
import { askSchema } from '../../nambikai/validators.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/suggestions',
  asyncHandler(async (_req, res) => {
    res.json({ suggestions: SUGGESTIONS, aiEnabled: isAiEnabled() });
  }),
);

router.post(
  '/ask',
  validate({ body: askSchema }),
  asyncHandler(async (req, res) => {
    const asOf = new Date();

    // Asking about your own money is still reading your own money.
    const token = await requireConsent({
      subjectType: SUBJECT_TYPE.USER,
      subjectId: req.user.id,
      purpose: PURPOSE.ASSISTANT,
      actor: ACTOR.USER,
      actorId: req.user.id,
      requestId: req.requestId,
      asOf,
    });

    const { score } = await computeHealthScore({
      subjectId: req.user.id,
      user: req.user,
      asOf,
      requestId: req.requestId,
      actorId: req.user.id,
    });

    const breakdown = parseJson(score.breakdown, []);
    const reasonCodes = parseJson(score.reasonCodes, []);
    const gates = parseJson(score.gates, {});

    // A small, deliberately coarse set of facts. Rupee figures are bands.
    const buffer = breakdown.find((b) => b.category === 'EMERGENCY_BUFFER')?.evidence ?? {};
    const commitments = breakdown.find((b) => b.category === 'COMMITMENTS')?.evidence ?? {};
    const facts = {
      buffer_days: buffer.bufferDays ?? null,
      typical_monthly_spend_band: bandRupees(buffer.avgMonthlyOutflowPaise),
      active_groups: commitments.activeGroups ?? 0,
      settled_cycles: commitments.settledCycles ?? 0,
      on_time: commitments.onTime ?? 0,
      missed: commitments.missed ?? 0,
      months_in_a_circle: commitments.monthsInAnyGroup ?? 0,
      monthly_commitment_band: bandRupees(commitments.committedPerCyclePaise),
    };

    const context = buildAssistantContext({
      user: req.user,
      score: { score: score.score, grade: score.grade, breakdown, reasonCodes },
      ruleResult: gates,
      facts,
    });

    const answer = await answerQuestion({
      question: req.valid.body.question,
      history: req.valid.body.history,
      context,
      // The model gets the scrubbed context; the templates get the numbers.
      richCodes: reasonCodes,
      scoreId: score.id,
      userId: req.user.id,
    });

    // A refused question read nothing, so it discloses nothing and is not logged
    // as a use. Anything answered from the person's data is.
    if (!answer.refused) {
      await audit.logUse({
        token,
        artifactType: ARTIFACT_TYPE.ASSISTANT_TURN,
        artifactId: score.id,
      });
    }

    res.json({
      answer: answer.text,
      source: answer.source,
      refused: answer.refused,
      groundedIn: answer.groundedIn,
      // Shown in the UI so a reader always knows whether a model or a template
      // wrote the words in front of them.
      aiEnabled: isAiEnabled(),
    });
  }),
);

export default router;
