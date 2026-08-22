/**
 * The OpenAI transport, the spend controls, and the two new prose surfaces.
 *
 * WHY THIS FILE RUNS A SERVER. The rest of the AI tests run with no key, which
 * proves the product is complete without a model but exercises none of the
 * request or response handling. A wrong field name in the port would pass every
 * one of them and fail silently in production as "the model never answers".
 *
 * So this file points the SDK at a local mock over NAMBIKAI_AI_BASE_URL and
 * asserts on the bytes actually sent. It is the only place the OpenAI wire
 * format is checked, and it needs neither a real key nor a network.
 */
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const PORT = 4113;

/** Captured requests, and the reply the next call will receive. */
const seen = [];
let reply = { content: 'A steady record over the period observed.' };

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: reply.finishReason ?? 'stop',
            message: {
              role: 'assistant',
              content: reply.content ?? null,
              ...(reply.refusal ? { refusal: reply.refusal } : {}),
            },
          },
        ],
      }),
    );
  });
});

// config.js reads the environment once at import, so both must be set before
// anything under src/ is pulled in.
process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key';
process.env.NAMBIKAI_AI_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.NAMBIKAI_AI_DAILY_CALL_BUDGET = '4';
process.env.NAMBIKAI_AI_USER_CALL_BUDGET = '2';

const { callModel, isAiEnabled, resetClientForTests } = await import('../src/nambikai/ai/client.js');
const { resetBudgetForTests, budgetStatus } = await import('../src/nambikai/ai/budget.js');
const { buildDeclineContext, buildIncomeProofContext } = await import('../src/nambikai/ai/context.js');
const { explainDecline, summariseIncomeProof, renderIncomeProofSummary } = await import(
  '../src/nambikai/ai/prose.js'
);
const { assertContextClean, ContextLeakError } = await import('../src/nambikai/ai/guard.js');

const USER = { firstName: 'Karthik', lastName: 'Balaji' };
const SCORE = { value: 85, grade: 'STRONG', band: 'LOW' };

/** Exactly what loan.pipeline.js builds — raw paise and all. */
const AT_CAPACITY = {
  kind: 'AT_CAPACITY',
  headline: 'You are already borrowing about as much as is safe',
  detail: 'What you already commit each month is close to the most you should carry.',
  monthlyIncomePaise: 1_529_500,
  committedPaise: 443_012,
  ceilingPaise: 458_850,
  incomeBand: '₹15,000–₹30,000',
  foirPct: 30,
  paths: [{ key: 'FINISH_CURRENT_LOAN', label: 'Finish your current loan', detail: 'Frees Rs 1,930.' }],
};

/** Exactly what incomeProof.pipeline.js builds. */
const PROOF = {
  period: { monthsObserved: 12, monthsWithIncome: 12 },
  income: {
    medianMonthlyPaise: 1_529_500,
    lowestMonthPaise: 1_347_200,
    highestMonthPaise: 1_952_000,
    distinctPayers: 9,
    transactionCount: 1482,
  },
};

before(() => new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve)));
after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  seen.length = 0;
  reply = { content: 'A steady record over the period observed.' };
  resetBudgetForTests();
  resetClientForTests();
});

/* ===================================================== the wire format ==== */

describe('the OpenAI request and response shape', () => {
  test('a key turns the layer on', () => {
    assert.equal(isAiEnabled(), true);
  });

  test('sends chat completions with the system prompt first', async () => {
    const text = await callModel({ system: 'SYS', payload: { a: 1 }, maxTokens: 250 });

    assert.equal(text, 'A steady record over the period observed.');
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /chat\/completions$/);
    assert.equal(seen[0].auth, 'Bearer sk-test-not-a-real-key');

    const sent = seen[0].body;
    assert.equal(sent.model, 'gpt-4o');
    assert.equal(sent.max_tokens, 250);
    assert.equal(sent.temperature, 0.2);
    assert.equal(sent.messages[0].role, 'system');
    assert.equal(sent.messages[0].content, 'SYS');
    assert.equal(sent.messages[1].role, 'user');
    assert.deepEqual(JSON.parse(sent.messages[1].content), { a: 1 });
  });

  test('none of the Anthropic-only parameters survive the port', async () => {
    await callModel({ system: 'SYS', payload: {} });
    for (const dead of ['output_config', 'system', 'top_k', 'thinking']) {
      assert.equal(seen[0].body[dead], undefined, `${dead} is still being sent`);
    }
  });

  test('a refusal reads as no answer, not a half answer', async () => {
    reply = { content: null, refusal: "I can't help with that." };
    assert.equal(await callModel({ system: 'SYS', payload: {} }), null);
  });

  test('a content filter reads as no answer', async () => {
    reply = { content: 'partial', finishReason: 'content_filter' };
    assert.equal(await callModel({ system: 'SYS', payload: {} }), null);
  });

  test('empty content reads as no answer', async () => {
    reply = { content: '   ' };
    assert.equal(await callModel({ system: 'SYS', payload: {} }), null);
  });
});

/* ======================================================= spend controls ==== */

describe('the key cannot be spent without limit', () => {
  test('a cache hit costs neither a call nor a budget slot', async () => {
    await callModel({ system: 'SYS', payload: { a: 1 }, cacheKey: 'k1' });
    await callModel({ system: 'SYS', payload: { a: 1 }, cacheKey: 'k1' });
    await callModel({ system: 'SYS', payload: { a: 1 }, cacheKey: 'k1' });

    assert.equal(seen.length, 1, 'the model was called more than once for one key');
    assert.equal(budgetStatus().callsToday, 1);
    assert.equal(budgetStatus().cacheHits, 2);
  });

  test('a different key is a different call', async () => {
    await callModel({ system: 'SYS', payload: {}, cacheKey: 'k1' });
    await callModel({ system: 'SYS', payload: {}, cacheKey: 'k2' });
    assert.equal(seen.length, 2);
  });

  test('no cache key means no caching', async () => {
    await callModel({ system: 'SYS', payload: {} });
    await callModel({ system: 'SYS', payload: {} });
    assert.equal(seen.length, 2);
  });

  test('the daily budget stops the calls and nothing else', async () => {
    // Budget is 4 for the day; distinct users so the per-user cap is not what bites.
    for (let i = 0; i < 6; i += 1) {
      await callModel({ system: 'SYS', payload: {}, userId: `u${i}` });
    }
    assert.equal(seen.length, 4, 'the daily budget did not hold');
    assert.equal(budgetStatus().budgetRefusals, 2);
  });

  test('one person cannot exhaust the budget for everyone', async () => {
    await callModel({ system: 'SYS', payload: {}, userId: 'greedy' });
    await callModel({ system: 'SYS', payload: {}, userId: 'greedy' });
    const third = await callModel({ system: 'SYS', payload: {}, userId: 'greedy' });

    assert.equal(third, null, 'the per-user cap did not hold');
    assert.equal(seen.length, 2);

    // Someone else still gets served.
    assert.ok(await callModel({ system: 'SYS', payload: {}, userId: 'other' }));
  });

  test('running out of budget degrades to the template, not to an error', async () => {
    // This is the property that makes the caps safe to set aggressively: an
    // exhausted budget must look to a caller exactly like having no key, which
    // is a supported state. If this ever throws instead, a demo that runs out
    // of budget turns into a 500 on the Borrow screen.
    const context = buildDeclineContext({ user: USER, score: SCORE, reason: AT_CAPACITY, scenarios: [] });

    // Burn the per-user allowance (2).
    await explainDecline({ context, fallback: AT_CAPACITY.detail, userId: 'u', cacheKey: 'a' });
    await explainDecline({ context, fallback: AT_CAPACITY.detail, userId: 'u', cacheKey: 'b' });

    const overBudget = await explainDecline({
      context,
      fallback: AT_CAPACITY.detail,
      userId: 'u',
      cacheKey: 'c',
    });

    assert.equal(overBudget.text, AT_CAPACITY.detail);
    assert.equal(overBudget.source, 'TEMPLATE');
    // Not a discard — nothing was generated to discard.
    assert.equal(overBudget.discardedModelOutput, undefined);
  });
});

/* =================================== the two new surfaces stay in lane ==== */

describe('the decline explanation', () => {
  test('the raw reason would leak, and the derived context does not', () => {
    // The negative control matters as much as the positive one: it is what shows
    // the guard would actually have caught this if the builder were skipped.
    assert.throws(() => assertContextClean(AT_CAPACITY), ContextLeakError);
    assert.doesNotThrow(() =>
      buildDeclineContext({ user: USER, score: SCORE, reason: AT_CAPACITY, scenarios: [] }),
    );
  });

  test('no exact rupee figure reaches the model', () => {
    const context = buildDeclineContext({ user: USER, score: SCORE, reason: AT_CAPACITY, scenarios: [] });
    const json = JSON.stringify(context);
    for (const exact of ['1529500', '443012', '458850', '15295', '4430']) {
      assert.ok(!json.includes(exact), `an exact figure survived: ${exact}`);
    }
    assert.equal(context.outcome.committed_band, '₹2,500–₹5,000');
  });

  test('a model answer that asserts a number is discarded for the template', async () => {
    reply = { content: 'Your limit is 4588 rupees this month.' };
    const result = await explainDecline({
      context: buildDeclineContext({ user: USER, score: SCORE, reason: AT_CAPACITY, scenarios: [] }),
      fallback: AT_CAPACITY.detail,
    });
    assert.equal(result.text, AT_CAPACITY.detail);
    assert.equal(result.source, 'TEMPLATE');
    assert.equal(result.discardedModelOutput, true);
  });

  test('a clean answer is used, and says so', async () => {
    reply = { content: 'You are close to the share of your income that can go to repayments.' };
    const result = await explainDecline({
      context: buildDeclineContext({ user: USER, score: SCORE, reason: AT_CAPACITY, scenarios: [] }),
      fallback: AT_CAPACITY.detail,
    });
    assert.equal(result.source, 'LLM');
  });
});

describe('the income proof summary', () => {
  test('the raw proof would leak, and the derived context does not', () => {
    assert.throws(() => assertContextClean(PROOF), ContextLeakError);
    assert.doesNotThrow(() => buildIncomeProofContext({ user: USER, proof: PROOF }));
  });

  test('it never characterises the person', async () => {
    reply = { content: 'Karthik is a creditworthy applicant with a strong record.' };
    const result = await summariseIncomeProof({
      context: buildIncomeProofContext({ user: USER, proof: PROOF }),
    });
    assert.equal(result.source, 'TEMPLATE');
    assert.equal(result.discardedModelOutput, true);
  });

  test('the template never says "between X and X"', () => {
    // Every month of this proof falls inside one band, which is the case that
    // used to produce "ranging from ₹10,000–₹25,000 to ₹10,000–₹25,000".
    const text = renderIncomeProofSummary(buildIncomeProofContext({ user: USER, proof: PROOF }));
    assert.match(text, /steady rather than seasonal/);
    assert.ok(!/undefined|null|NaN/.test(text));
  });

  test('a genuine spread is reported as a range', () => {
    const spread = {
      ...PROOF,
      income: { ...PROOF.income, lowestMonthPaise: 200_000, highestMonthPaise: 8_000_000 },
    };
    const text = renderIncomeProofSummary(buildIncomeProofContext({ user: USER, proof: spread }));
    assert.match(text, /quietest month was .* and the busiest/);
  });
});
