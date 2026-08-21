/**
 * The scrubber. This is the proof, not the promise.
 *
 * Nambikai's claim is that the model never sees raw financial records — only
 * derived percentages. A comment saying so is worth nothing; this function runs
 * in EVERY environment immediately before every API call and throws rather than
 * sending anything that fails it.
 *
 * A unit test feeds it a deliberately dirty context for each rule below and
 * asserts it throws. That test IS the guarantee.
 *
 * It fails closed and loudly: a context that trips a rule raises a 500 and is
 * logged, rather than being quietly sanitised. Silently stripping a leaking
 * field would hide the bug that put it there.
 */

/** Field names that have no business in a derived context. */
const FORBIDDEN_KEY = /paise|amount|balance|reference|ledger|counterpart|upi|vpa|phone|mobile|email|entry_?id|\bnote\b|address|pincode/i;

/** A buildReferenceId() output, e.g. NBK4F2A9C31D8E0. */
const REFERENCE_ID = /^NBK[0-9A-F]{12}$/;

/** A UPI handle or an Indian mobile number. */
const UPI_HANDLE = /@paytm$/i;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const EMAIL = /\b[\w.+-]+@[\w-]+\.\w{2,}\b/;

const MAX_ARRAY_LENGTH = 24;
const MAX_PAYLOAD_BYTES = 8192;

export class ContextLeakError extends Error {
  constructor(reason, path) {
    super(`Refusing to send context to the model: ${reason} at ${path}`);
    this.name = 'ContextLeakError';
    this.reason = reason;
    this.path = path;
  }
}

/**
 * Walk a context object and throw on anything that looks like raw data.
 * @returns {true} when the context is clean
 */
export function assertContextClean(context) {
  const serialised = JSON.stringify(context ?? null);
  if (serialised.length > MAX_PAYLOAD_BYTES) {
    throw new ContextLeakError(
      `payload is ${serialised.length} bytes, over the ${MAX_PAYLOAD_BYTES} limit — a derived summary should never be this large`,
      '$',
    );
  }

  const walk = (node, path) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      // A long array is the tell that rows are being shipped rather than summaries.
      if (node.length > MAX_ARRAY_LENGTH) {
        throw new ContextLeakError(`array of ${node.length} items looks like bulk rows`, path);
      }
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }

    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (FORBIDDEN_KEY.test(key)) {
          throw new ContextLeakError(`field "${key}" carries raw financial or identifying data`, path);
        }
        // Percentages are the unit this layer speaks in; an out-of-range one
        // means something un-normalised slipped through.
        if (/_pct$/.test(key) && typeof value === 'number' && (value < 0 || value > 100)) {
          throw new ContextLeakError(`"${key}" is ${value}, which is not a percentage`, path);
        }
        walk(value, path === '$' ? `$.${key}` : `${path}.${key}`);
      }
      return;
    }

    if (typeof node === 'string') {
      if (REFERENCE_ID.test(node)) throw new ContextLeakError('a transaction reference id', path);
      if (UPI_HANDLE.test(node)) throw new ContextLeakError('a UPI handle', path);
      if (INDIAN_MOBILE.test(node)) throw new ContextLeakError('a mobile number', path);
      if (EMAIL.test(node)) throw new ContextLeakError('an email address', path);
    }
  };

  walk(context, '$');
  return true;
}
