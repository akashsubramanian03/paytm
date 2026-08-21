/**
 * Canonical serialisation and hashing — the determinism proof.
 *
 * Every FinancialHealthScore stores an `inputsHash`: the sha256 of the canonical
 * form of the FeatureVector it was computed from. That gives us two things a
 * comment could never give us:
 *
 *   1. Reproducibility. Same inputs -> same hash -> the same score must come out.
 *      A test asserts this over 100 iterations.
 *   2. A cluster guardrail with teeth. The individual score's inputsHash is
 *      asserted to be BYTE-IDENTICAL with cluster opt-in on and off. If anyone
 *      ever wires cluster data into the individual scorecard, that hash changes
 *      and the test fails. The guarantee is mechanical, not editorial.
 *
 * Canonical means: object keys sorted, no insignificant whitespace, and numbers
 * emitted as integers. JSON.stringify alone is NOT canonical — it preserves
 * insertion order, so two structurally identical vectors built by different code
 * paths would hash differently.
 */
import crypto from 'node:crypto';

/** Deterministic JSON: keys sorted at every depth, arrays order-preserving. */
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';

  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) return 'null';
    // -0 and 0 must serialise the same, or the hash depends on how a zero arose.
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);

  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Set) return canonicalJson([...value].sort());
  if (value instanceof Map) {
    return canonicalJson(Object.fromEntries(value));
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** The value stored as FinancialHealthScore.inputsHash. */
export function hashInputs(value) {
  return sha256Hex(canonicalJson(value));
}
