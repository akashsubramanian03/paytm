/**
 * The Anthropic client, and the exact request shape.
 *
 * TWO PROPERTIES MATTER HERE, AND NEITHER IS ABOUT THE MODEL.
 *
 * 1. THE WALLET MUST NOT DEPEND ON THIS. The SDK is imported lazily inside
 *    getAnthropic(), so a missing, half-installed or broken package can never
 *    stop the server booting. Someone who clones this repo and runs the wallet
 *    should never see a payments outage because an AI dependency failed.
 *
 * 2. NO KEY IS A SUPPORTED STATE, NOT A DEGRADED ONE. With no ANTHROPIC_API_KEY
 *    every caller falls through to the deterministic templates and the product
 *    behaves identically — same numbers, same reason codes, same decisions. The
 *    only difference is who wrote the prose, and every artifact records that in
 *    `explainerSource`.
 */
import config from '../../config.js';

let cached;

export const isAiEnabled = () => config.nambikai.aiEnabled;

export async function getAnthropic() {
  if (!isAiEnabled()) return null;
  if (cached !== undefined) return cached;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    cached = new Anthropic({ apiKey: config.nambikai.anthropicApiKey });
  } catch {
    // A broken install is treated exactly like no key at all.
    cached = null;
  }
  return cached;
}

/**
 * Call the model with a frozen request shape.
 *
 * The omissions below are deliberate and each one is a 400 on this model class.
 * They are exactly the parameters someone porting older Claude code reaches for,
 * so they are named here rather than left to be rediscovered:
 *
 *   - NO `temperature`, `top_p`, `top_k` — removed; sending any is a 400.
 *   - NO assistant prefill (a trailing assistant message) — removed; a 400.
 *   - NO `thinking: {type:'enabled', budget_tokens: N}` — removed; a 400.
 *
 * Thinking is left at its default and cost is controlled with
 * `output_config.effort` instead. Explicitly disabling thinking is avoided: on
 * this model class it can leak reasoning tags into the visible answer, which for
 * a user-facing financial explanation would be worse than the latency it saves.
 *
 * Returns null on any failure, which every caller treats as "use the template".
 */
export async function callModel({ system, payload, maxTokens }) {
  const client = await getAnthropic();
  if (!client) return null;

  try {
    const response = await client.messages.create(
      {
        model: config.nambikai.model,
        max_tokens: maxTokens ?? config.nambikai.maxTokens,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      },
      { timeout: config.nambikai.timeoutMs },
    );

    // A refusal is a successful HTTP response with no usable text. Treat it the
    // same as any other empty result rather than surfacing a half-answer.
    if (response.stop_reason === 'refusal') return null;

    const text = response.content?.find((block) => block.type === 'text')?.text ?? '';
    return text.trim() ? text.trim() : null;
  } catch {
    // Timeouts, rate limits, network failures, API errors — all the same to the
    // caller. The user gets a deterministic explanation instead of an error.
    return null;
  }
}
