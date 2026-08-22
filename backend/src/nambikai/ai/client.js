/**
 * The OpenAI client, and the exact request shape.
 *
 * THREE PROPERTIES MATTER HERE, AND NONE OF THEM IS ABOUT THE MODEL.
 *
 * 1. THE WALLET MUST NOT DEPEND ON THIS. The SDK is imported lazily inside
 *    getClient(), so a missing, half-installed or broken package can never stop
 *    the server booting. Someone who clones this repo and runs the wallet should
 *    never see a payments outage because an AI dependency failed.
 *
 * 2. NO KEY IS A SUPPORTED STATE, NOT A DEGRADED ONE. With no OPENAI_API_KEY
 *    every caller falls through to the deterministic templates and the product
 *    behaves identically — same numbers, same reason codes, same decisions. The
 *    only difference is who wrote the prose, and every artifact records that in
 *    `explainerSource`.
 *
 * 3. EVERY FAILURE LOOKS THE SAME TO THE CALLER. Timeout, rate limit, refusal,
 *    exhausted budget, broken install, no key — all of them return null, and
 *    null means "use the template". There is exactly one fallback path, so it is
 *    the one that gets exercised.
 */
import config from '../../config.js';
import { claimCall, releaseCall, cacheGet, cacheSet } from './budget.js';

let cached;

/** Tests swap the environment between cases; nothing in the app calls this. */
export function resetClientForTests() {
  cached = undefined;
}

export const isAiEnabled = () => config.nambikai.aiEnabled;

export async function getClient() {
  if (!isAiEnabled()) return null;
  if (cached !== undefined) return cached;
  try {
    const { default: OpenAI } = await import('openai');
    cached = new OpenAI({
      apiKey: config.nambikai.openaiApiKey,
      // Undefined keeps the SDK's own default, which is the normal case.
      baseURL: config.nambikai.baseUrl,
    });
  } catch {
    // A broken install is treated exactly like no key at all.
    cached = null;
  }
  return cached;
}

/**
 * Call the model with a frozen request shape.
 *
 * PORTING NOTE. This layer previously targeted Anthropic's Opus 5 class, where
 * `temperature`, `top_p`, `top_k`, assistant prefill and an explicit thinking
 * budget are all rejected with a 400, and cost was steered with
 * `output_config.effort` instead. None of that applies here and all of it has
 * been removed. On OpenAI the equivalent lever is simply `temperature`, and a
 * low one is exactly right: this model writes neutral prose over figures that
 * were computed before it ran, and there is nothing to be gained by making it
 * inventive about a lending document.
 *
 * @param {object}   args
 * @param {string}   args.system     frozen system prompt for this surface
 * @param {object}   args.payload    the scrubbed, derived context
 * @param {number}   [args.maxTokens]
 * @param {string}   [args.cacheKey] a stable hash of the same inputs the prose
 *   describes. Omit it and the call is simply not cached.
 * @param {string}   [args.userId]   charged against this user's daily budget
 * @returns {Promise<string|null>} null on any failure, which every caller treats
 *   as "use the template".
 */
export async function callModel({ system, payload, maxTokens, cacheKey, userId }) {
  if (!isAiEnabled()) return null;

  // Checked before the budget: a cache hit costs nothing and must not be
  // refused for being over a limit it does not consume.
  const hit = cacheGet(cacheKey);
  if (hit) return hit;

  if (!claimCall({ userId })) return null;

  const client = await getClient();
  if (!client) {
    releaseCall({ userId });
    return null;
  }

  try {
    const response = await client.chat.completions.create(
      {
        model: config.nambikai.model,
        max_tokens: maxTokens ?? config.nambikai.maxTokens,
        temperature: 0.2,
        messages: [
          // The system prompt is static and first so it stays cacheable upstream.
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      },
      { timeout: config.nambikai.timeoutMs },
    );

    const choice = response.choices?.[0];

    // A refusal is a successful HTTP response with no usable text. Treat it the
    // same as any other empty result rather than surfacing a half-answer.
    if (choice?.message?.refusal) return null;
    if (choice?.finish_reason === 'content_filter') return null;

    const text = (choice?.message?.content ?? '').trim();
    if (!text) return null;

    cacheSet(cacheKey, text);
    return text;
  } catch {
    // Timeouts, rate limits, network failures, API errors — all the same to the
    // caller. The user gets a deterministic explanation instead of an error.
    return null;
  }
}
