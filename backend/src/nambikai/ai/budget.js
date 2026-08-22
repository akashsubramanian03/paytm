/**
 * What the key is allowed to cost, and what it should never be spent on twice.
 *
 * The model is called on five surfaces now, one of which (the borrowing decline)
 * sits on a screen that loads rather than on an explicit action. An uncapped key
 * behind a demo anyone can click through is a real bill.
 *
 * THE ONE PROPERTY THAT MAKES THIS SAFE TO BE BLUNT: every refusal here returns
 * the same `null` a network failure returns, and every caller already treats
 * `null` as "use the deterministic template". Running out of budget is therefore
 * indistinguishable from having no key at all — which is a supported state, not
 * a degraded one. The bill stops; the product does not.
 *
 * Deliberately in-memory. A demo runs in one process, budgets that reset on
 * restart are the forgiving behaviour, and a table here would mean a migration
 * for something that is not part of the product's story.
 */
import config from '../../config.js';

/** UTC, so the reset time does not move with the machine's timezone. */
const utcDay = (at) => at.toISOString().slice(0, 10);

let day = null;
let globalCalls = 0;
let userCalls = new Map();

let hits = 0;
let misses = 0;
let refusals = 0;

function rollOver(at) {
  const today = utcDay(at);
  if (day === today) return;
  day = today;
  globalCalls = 0;
  userCalls = new Map();
}

/**
 * Claim one call against both budgets, or refuse.
 *
 * Claimed up front rather than counted afterwards: two concurrent requests must
 * not both see the last remaining call as available. Node is single-threaded
 * between awaits, so incrementing before the network call is sufficient here.
 *
 * `userId` is optional — a call made outside a request (a background report)
 * counts against the global budget only.
 */
export function claimCall({ userId, at = new Date() } = {}) {
  rollOver(at);

  const { dailyCallBudget, userCallBudget } = config.nambikai;

  if (globalCalls >= dailyCallBudget) {
    refusals += 1;
    return false;
  }

  if (userId && userCallBudget > 0) {
    const used = userCalls.get(userId) ?? 0;
    if (used >= userCallBudget) {
      refusals += 1;
      return false;
    }
    userCalls.set(userId, used + 1);
  }

  globalCalls += 1;
  return true;
}

/** Hand a claimed call back when it never reached the network. */
export function releaseCall({ userId } = {}) {
  if (globalCalls > 0) globalCalls -= 1;
  if (userId) {
    const used = userCalls.get(userId) ?? 0;
    if (used > 0) userCalls.set(userId, used - 1);
  }
}

/* ── the cache ──────────────────────────────────────────────────────────────
 *
 * Three of the five call sites already compute a stable, day-quantised hash of
 * exactly the inputs their prose describes: `inputsHash` on the feature vector,
 * `verificationHash` on an income proof. Same person, same day, same facts →
 * the same paragraph. So the cache key is not a heuristic about similar
 * requests; it is derived from the same values the score is, which is why it can
 * be trusted to return a previous answer verbatim.
 *
 * A caller with nothing stable to key on passes no key and is simply not cached.
 */

const cache = new Map();

export function cacheGet(key) {
  if (!key) return null;
  if (!cache.has(key)) {
    misses += 1;
    return null;
  }
  // Re-insert so the Map's insertion order is the LRU order.
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  hits += 1;
  return value;
}

export function cacheSet(key, text) {
  const { cacheSize } = config.nambikai;
  if (!key || !text || cacheSize <= 0) return;

  cache.delete(key);
  cache.set(key, text);

  // Map iterates in insertion order, so the first key is the least recently used.
  while (cache.size > cacheSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

/** Surfaced on the assistant routes so the spend is visible rather than guessed at. */
export function budgetStatus({ at = new Date() } = {}) {
  rollOver(at);
  return {
    day,
    callsToday: globalCalls,
    dailyCallBudget: config.nambikai.dailyCallBudget,
    userCallBudget: config.nambikai.userCallBudget,
    cacheEntries: cache.size,
    cacheHits: hits,
    cacheMisses: misses,
    budgetRefusals: refusals,
  };
}

/** Tests need a known starting point; nothing in the app calls this. */
export function resetBudgetForTests() {
  day = null;
  globalCalls = 0;
  userCalls = new Map();
  cache.clear();
  hits = 0;
  misses = 0;
  refusals = 0;
}
