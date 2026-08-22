/**
 * Assembles the FeatureVector: the single, canonical input to the scoring engine.
 *
 * This is the boundary. Above it, code talks to the database. Below it,
 * everything is pure — `engine/` receives this object and nothing else, which is
 * what makes a score reproducible from a hash of its inputs.
 *
 * Two rules hold here:
 *   - No row ids, counterparty identities, note text or free-form strings. Only
 *     integers, fixed-length arrays of integers, and ISO timestamps.
 *   - No clock. `asOf` is threaded in from the route layer, never read here, so
 *     the same vector can be rebuilt for the same instant forever.
 */
import { DEFAULT_WINDOW_MONTHS, SUBJECT_TYPE } from '../constants.js';
import { ENGINE_VERSION } from '../version.js';
import { hashInputs } from '../util/hash.js';
import { utcDayKey } from '../util/window.js';
import { extractLedgerFeatures } from './ledger.features.js';
import { extractGroupFeatures } from './group.features.js';
import { extractLoanFeatures, NO_LOAN_FEATURES } from './loan.features.js';

export async function buildUserFeatureVector(
  userId,
  { asOf = new Date(), months = DEFAULT_WINDOW_MONTHS, token, tenureMonths = 0 } = {},
) {
  const [ledger, group] = await Promise.all([
    extractLedgerFeatures(userId, { asOf, months, token }),
    extractGroupFeatures(userId, { asOf, months, token }),
  ]);

  // Loan history is its own permission. Without it the repayment category is
  // simply unmeasured — the score is built from less, never from a guess.
  const loans = token.grantedDataTypes.has('LOAN_HISTORY')
    ? await extractLoanFeatures(userId, { asOf, months, token })
    : NO_LOAN_FEATURES;

  const vector = {
    schemaVersion: 'nbk-fv-1',
    engineVersion: ENGINE_VERSION,
    subjectType: SUBJECT_TYPE.USER,
    windowMonths: months,
    asOf: asOf.toISOString(),
    accountTenureMonths: tenureMonths,
    ledger,
    group,
    loans,
  };

  // The determinism proof. A test asserts this is byte-identical whether or not
  // the subject has opted in to cluster scoring — if anyone ever wires cluster
  // data into the individual scorecard, this hash moves and that test fails.
  //
  // asOf is quantised to the UTC DAY before hashing. Hashing it at millisecond
  // precision would change the hash on every single call, making it useless for
  // its actual job: proving the same DATA produces the same score. Real changes
  // still move it — a new transaction alters the counts, balances and monthly
  // buckets below — so this narrows the hash to data changes rather than
  // weakening it.
  const hashPayload = { ...vector, asOf: utcDayKey(asOf) };
  return { ...vector, inputsHash: hashInputs(hashPayload) };
}
