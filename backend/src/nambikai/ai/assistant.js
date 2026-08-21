/**
 * The financial assistant.
 *
 * Three layers keep it inside its lane, and no single one of them is trusted
 * alone:
 *
 *   1. PRE-CHECK. An off-topic question is refused locally by intents.js. It
 *      never reaches the network, so it cannot leak anything and costs nothing.
 *   2. SYSTEM PROMPT. Frozen, and explicit about what the model may not do.
 *   3. POST-CHECK. If the answer asserts a score or risk figure that was not in
 *      the facts, the text is discarded and the deterministic answer is returned
 *      instead. The model therefore cannot originate a number even if it tries.
 */
import { EXPLAINER_SOURCE } from '../constants.js';
import { assertContextClean } from './guard.js';
import { callModel } from './client.js';
import { classifyIntent, REFUSAL_TEXT } from './intents.js';
import { renderAnswer } from './templates.js';

const SYSTEM_PROMPT = `You are the Nambikai assistant inside the Paytm app. You help one person understand their own money.

You are given a JSON object of ALREADY-COMPUTED facts about that person: their score, weighted categories, reason codes, and a few summary figures. Rupee figures appear only as BANDS (for example "₹5,000–₹10,000"), never as exact amounts.

Rules:
- Answer ONLY from the facts in the JSON. If the question cannot be answered from them, reply exactly: "I don't have that in your Nambikai data." and then one sentence naming what would be needed.
- Never produce, estimate, revise or contradict a score, grade, risk band or eligibility. Those are computed before you are called. If asked to change a score, explain which behaviours move it instead.
- Never invent a precise rupee amount. If you mention money, use the band you were given.
- Never promise, imply or predict a loan approval, an amount, or an interest rate. Nambikai is not a lender.
- Never give investment, tax or legal advice.
- Speak directly to the person as "you". Two to four sentences, plain language, no markdown, no bullet points.
- Be concrete. Cite the counts and percentages you were given rather than speaking generally.`;

const HISTORY_TURNS = 6;

/** Same guard as the explainer: a number presented as a score must be the real one. */
function assertsWrongScore(text, score) {
  const matches = text.matchAll(/\b(?:score|rating|grade)\b[^.]{0,40}?\b(\d{1,3})\b/gi);
  for (const match of matches) {
    if (Number(match[1]) !== score.value) return true;
  }
  return false;
}

/**
 * @param {object} args
 * @param {Array}  [args.richCodes] reason codes WITH their evidence numbers.
 *   The model context deliberately strips evidence, but the deterministic
 *   templates need it to say "10 of 12 months" instead of "undefined of
 *   undefined". Both paths work from the same code list; only the templates see
 *   the figures.
 */
export async function answerQuestion({ question, history = [], context, richCodes }) {
  const { matched, onTopic } = classifyIntent(question);

  // Refused before any network call.
  if (!onTopic) {
    return {
      text: REFUSAL_TEXT,
      source: EXPLAINER_SOURCE.TEMPLATE,
      refused: true,
      intents: [],
      groundedIn: [],
    };
  }

  const template = renderAnswer(matched, richCodes ? { ...context, reason_codes: richCodes } : context);
  const groundedIn = Object.keys(context.facts ?? {});

  assertContextClean(context);

  const payload = {
    ...context,
    conversation: history.slice(-HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: String(turn.content).slice(0, 500),
    })),
    question: String(question).slice(0, 400),
  };
  assertContextClean(payload);

  const text = await callModel({ system: SYSTEM_PROMPT, payload, maxTokens: 600 });

  if (!text) {
    return {
      text: template,
      source: EXPLAINER_SOURCE.TEMPLATE,
      refused: false,
      intents: matched,
      groundedIn,
    };
  }

  if (assertsWrongScore(text, context.score)) {
    return {
      text: template,
      source: EXPLAINER_SOURCE.TEMPLATE,
      refused: false,
      discardedModelOutput: true,
      intents: matched,
      groundedIn,
    };
  }

  return { text, source: EXPLAINER_SOURCE.LLM, refused: false, intents: matched, groundedIn };
}

export const SUGGESTIONS = [
  'Why is my score what it is?',
  'What would improve my score the most?',
  'How am I doing in my savings groups?',
  'How long would my balance last?',
  'What would a lender see about me?',
];

export const SME_SUGGESTIONS = [
  'Why is my business score what it is?',
  'How healthy are my receivables?',
  'Is my GST filing record hurting me?',
  'What would a lender see about my business?',
];
