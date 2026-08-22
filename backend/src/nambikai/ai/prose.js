/**
 * Two short pieces of prose that were previously template-only.
 *
 * Both follow the pattern the explainer and the assistant already established
 * and neither departs from it: the facts are computed first, the context is
 * derived and scrubbed, the model is handed the result and asked to describe it,
 * and anything it returns that asserts a number is discarded in favour of the
 * template. The model is late to every one of these conversations on purpose.
 *
 * The decline is the more delicate of the two. It is the moment a person is told
 * no, and the difference between a wall and a plan is entirely in the wording —
 * which is exactly the kind of thing worth spending a model call on, and exactly
 * the kind of thing that must never be allowed to imply a promise.
 */
import { EXPLAINER_SOURCE } from '../constants.js';
import { callModel } from './client.js';

const DECLINE_PROMPT = `You write the short explanation a person sees when Nambikai has not offered them a loan.

Nambikai turns everyday behaviour — savings-group contributions, wallet activity, bills — into an explainable assessment. It is not a lender and does not approve or decline credit; a licensed partner does.

You are given a JSON object of ALREADY-COMPUTED facts: why there was no offer, the person's income band, the share of income they are allowed to commit, and the paths that would change the outcome.

Rules:
- Use ONLY the facts in the JSON. Never invent a figure, a date or a reason that is not there.
- Rupee figures appear only as BANDS. Never state an exact amount.
- Never produce, estimate, revise or contradict a score, grade, band or limit.
- NEVER promise, imply or predict that following the suggestions will result in a loan, an amount, or a rate. Say what would change, not what would be granted.
- This is not a judgement about the person. Do not moralise, do not congratulate, do not express sympathy.
- Speak directly to them as "you". Two to three sentences, plain language, no markdown, no bullet points.
- Be concrete: name the specific thing that is binding and the specific thing that would move it.`;

const INCOME_PROOF_PROMPT = `You write the two-sentence summary at the top of a Nambikai income record.

This document shows money received into one Paytm wallet over a period. It is shown to people like landlords and employers, not to lenders.

You are given a JSON object of ALREADY-COMPUTED facts: months observed, typical/quietest/busiest monthly bands, how many different people paid, and how many transactions.

Rules:
- Use ONLY the facts in the JSON. Never invent a figure.
- Rupee figures appear only as BANDS. Never state an exact amount.
- NEVER assess creditworthiness, reliability or character. Never mention scores, loans, credit or risk.
- Never imply this is a salary, an employer's declaration, or a complete picture of the person's income. It is one wallet.
- Write exactly two sentences of plain, neutral prose. No markdown, no bullet points.
- Describe the shape of the income: how regular it is, and how many people it comes from.`;

/** Any number offered as a score, band or limit is one the model was never given. */
function assertsANumber(text) {
  return /\b(?:score|grade|band|limit|rate|emi|interest)\b[^.]{0,40}?\b\d/i.test(text);
}

/**
 * @param {object} args
 * @param {object} args.context   from buildDeclineContext()
 * @param {string} args.fallback  the deterministic `detail` the pipeline already wrote
 * @param {string} [args.cacheKey] the feature vector's inputsHash
 * @param {string} [args.userId]
 */
export async function explainDecline({ context, fallback, cacheKey, userId }) {
  const text = await callModel({
    system: DECLINE_PROMPT,
    payload: context,
    maxTokens: 350,
    cacheKey: cacheKey && `decline:${cacheKey}`,
    userId,
  });

  if (!text) return { text: fallback, source: EXPLAINER_SOURCE.TEMPLATE };

  if (assertsANumber(text)) {
    return { text: fallback, source: EXPLAINER_SOURCE.TEMPLATE, discardedModelOutput: true };
  }

  return { text, source: EXPLAINER_SOURCE.LLM };
}

/**
 * The deterministic summary. Written from the same facts the model gets, so the
 * document reads the same way whether or not a key is present.
 */
export function renderIncomeProofSummary(context) {
  const { period, income } = context;
  const regular =
    period.months_with_income === period.months_observed
      ? `every one of the last ${period.months_observed} months`
      : `${period.months_with_income} of the last ${period.months_observed} months`;

  const payers =
    income.distinct_payers === 1
      ? 'a single payer'
      : `${income.distinct_payers} different payers`;

  // When the quietest and busiest months fall inside the same band, naming the
  // range says "between X and X" — worse than not mentioning it. Steady income
  // is the more useful thing to report there anyway.
  const spread =
    income.quietest_month_band === income.busiest_month_band
      ? 'Every month fell in that same range, so the income is steady rather than seasonal.'
      : `The quietest month was ${income.quietest_month_band} and the busiest ${income.busiest_month_band}.`;

  return (
    `This wallet received money in ${regular}, typically ${income.typical_monthly_band} a month ` +
    `across ${income.transaction_count.toLocaleString('en-IN')} payments from ${payers}. ` +
    spread
  );
}

/**
 * @param {object} args
 * @param {object} args.context    from buildIncomeProofContext()
 * @param {string} [args.cacheKey] the proof's verificationHash
 * @param {string} [args.userId]
 */
export async function summariseIncomeProof({ context, cacheKey, userId }) {
  const template = renderIncomeProofSummary(context);

  const text = await callModel({
    system: INCOME_PROOF_PROMPT,
    payload: context,
    maxTokens: 250,
    cacheKey: cacheKey && `income:${cacheKey}`,
    userId,
  });

  if (!text) return { text: template, source: EXPLAINER_SOURCE.TEMPLATE };

  // A summary that reaches for credit language has left its lane entirely.
  if (/\b(?:credit|creditworth|loan|score|risk|eligib)/i.test(text)) {
    return { text: template, source: EXPLAINER_SOURCE.TEMPLATE, discardedModelOutput: true };
  }

  return { text, source: EXPLAINER_SOURCE.LLM };
}
