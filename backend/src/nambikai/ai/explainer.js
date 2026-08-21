/**
 * Turning a completed assessment into prose.
 *
 * The model is called AFTER the score, the band and the gates already exist. It
 * is handed the result and asked to describe it. It cannot change any of it —
 * not because it is instructed not to, but because by the time it runs there is
 * nothing left to change.
 *
 * Every output records which wrote it, and both paths are shown to the user.
 */
import { EXPLAINER_SOURCE } from '../constants.js';
import { assertContextClean } from './guard.js';
import { callModel } from './client.js';
import { renderRecommendation } from './templates.js';

const SYSTEM_PROMPT = `You write the recommendation paragraph on a Nambikai underwriting report.

Nambikai turns everyday behaviour — savings-group contributions, wallet activity, bills — into an explainable assessment for a lending partner. It is not a lender. It does not approve or decline credit and does not hold lending risk.

You are given a JSON object of ALREADY-COMPUTED facts: a score, a risk band, weighted categories, reason codes and any gates that fired.

Rules:
- Use ONLY the facts in the JSON. Never invent a figure, a rupee amount, a transaction or a trend that is not there.
- The score, band and eligibility were computed before you were called. Never produce, estimate, revise, contradict or second-guess them. Describe them.
- Never recommend approving, declining, or pricing anything. That decision belongs to the lending partner.
- If a cluster_signal is present, describe it as being about the GROUP, and state plainly that it has not been blended into the individual score.
- Never imply a credit bureau was consulted. Nambikai has no bureau access.
- Write 3 to 5 sentences of plain, neutral prose. No bullet points, no headings, no markdown.
- Write about the applicant in the third person. Be specific: cite the counts and percentages you were given.`;

/**
 * Model output is checked before it is trusted.
 *
 * The specific failure worth guarding against is the model asserting a score or
 * risk number that was never computed. It is the one thing it must never do, so
 * the output is checked for numbers presented as a score and discarded if they
 * do not match the real one. The template then answers instead.
 */
export function assertsWrongScore(text, score) {
  const matches = text.matchAll(/\b(?:score|rating|risk)\b[^.]{0,40}?\b(\d{1,3})\b/gi);
  for (const match of matches) {
    const asserted = Number(match[1]);
    if (asserted !== score.value && asserted !== score.value) return true;
  }
  return false;
}

export async function explainReport(context, { richCodes } = {}) {
  // The template needs the evidence numbers; the model deliberately does not get
  // them. Both work from the same code list.
  const templateContext = richCodes ? { ...context, reason_codes: richCodes } : context;
  const template = renderRecommendation(templateContext);

  assertContextClean(context);
  const text = await callModel({ system: SYSTEM_PROMPT, payload: context });

  if (!text) return { text: template, source: EXPLAINER_SOURCE.TEMPLATE };

  if (assertsWrongScore(text, context.score)) {
    // The model stated a number that is not the computed one. Discard it: a
    // fluent wrong figure in a lender-facing document is worse than plain prose.
    return { text: template, source: EXPLAINER_SOURCE.TEMPLATE, discardedModelOutput: true };
  }

  return { text, source: EXPLAINER_SOURCE.LLM };
}
