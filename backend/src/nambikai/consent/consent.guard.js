/**
 * The consent gate.
 *
 * WHERE THIS LIVES, AND WHY IT IS NOT MIDDLEWARE.
 *
 * Express middleware protects an HTTP path. It does nothing about an internal
 * caller — the assistant answering a question, a batch recompute, a future cron
 * — which would walk straight past it and read whatever it liked. So the gate is
 * not a route decorator. It runs inside the pipeline, and it hands back a
 * ConsentToken that the feature extractors themselves re-assert against before
 * they query. A missing permission physically prevents the findMany from
 * running; it is not a filter applied to the response afterwards.
 *
 * The practical test of that design is test 16: calling a feature extractor
 * directly, with a token that lacks the data type, must throw. If the gate were
 * middleware, that call would succeed.
 */
import { ApiError } from '../../lib/errors.js';
import { ACTOR, DATA_TYPE, PURPOSE, SUBJECT_TYPE } from '../constants.js';
import * as audit from './audit.js';
import { activeConsentsFor } from './consent.service.js';

/**
 * What each purpose is allowed to read, and therefore what it must ask for.
 *
 * Kept deliberately tight. HEALTH_SCORE does not require BILL_PAYMENTS because
 * a user should be able to see their own score without also authorising a
 * lender-facing assessment; UNDERWRITING asks for more because it discloses more.
 */
export const REQUIRED_CONSENTS = {
  [PURPOSE.HEALTH_SCORE]: [DATA_TYPE.WALLET_LEDGER, DATA_TYPE.GROUP_CONTRIBUTIONS],
  [PURPOSE.UNDERWRITING]: [
    DATA_TYPE.WALLET_LEDGER,
    DATA_TYPE.GROUP_CONTRIBUTIONS,
    DATA_TYPE.BILL_PAYMENTS,
  ],
  [PURPOSE.ASSISTANT]: [DATA_TYPE.WALLET_LEDGER],
  [PURPOSE.SME_UNDERWRITING]: [
    DATA_TYPE.WALLET_LEDGER,
    DATA_TYPE.BUSINESS_GST,
    DATA_TYPE.BUSINESS_INVOICES,
  ],
};

export function requiredFor(purpose) {
  const required = REQUIRED_CONSENTS[purpose];
  if (!required) throw new Error(`No consent requirements declared for purpose ${purpose}`);
  return required;
}

/**
 * A ConsentToken is proof that permission was checked, and a place to record
 * what was subsequently read. It is passed down into every extractor; nothing
 * below this layer talks to the database without one.
 */
function buildToken({ subjectType, subjectId, purpose, records, requestId, actor, actorId }) {
  return {
    subjectType,
    subjectId,
    purpose,
    records,
    grantedDataTypes: new Set(records.map((r) => r.dataType)),
    primaryConsentId: records[0]?.id ?? null,
    requestId,
    actor,
    actorId,
    /** Data types actually read. Only these become USE rows in the audit log. */
    used: new Set(),
  };
}

/**
 * Check consent, or refuse.
 *
 * On refusal a DENY row is written for every missing data type BEFORE the throw,
 * so a blocked attempt is as visible in the audit trail as a successful read.
 */
export async function requireConsent({
  subjectType = SUBJECT_TYPE.USER,
  subjectId,
  purpose,
  actor = ACTOR.ENGINE,
  actorId,
  requestId,
  asOf = new Date(),
}) {
  const required = requiredFor(purpose);

  const records = await activeConsentsFor({
    subjectType,
    subjectId,
    purpose,
    dataTypes: required,
    asOf,
  });

  // One record per data type: if several are somehow active, the newest wins.
  const byType = new Map();
  for (const record of records) if (!byType.has(record.dataType)) byType.set(record.dataType, record);

  const missing = required.filter((t) => !byType.has(t));

  if (missing.length) {
    await audit.logDeny({ subjectType, subjectId, purpose, missing, actor, actorId, requestId });
    throw new ApiError(
      403,
      'CONSENT_REQUIRED',
      'Nambikai needs your permission to read this data before it can do this.',
      {
        missing,
        required,
        purpose,
        grantPath: '/api/v1/nambikai/consents',
      },
    );
  }

  return buildToken({
    subjectType,
    subjectId,
    purpose,
    records: required.map((t) => byType.get(t)),
    requestId,
    actor,
    actorId,
  });
}

/**
 * Called by every feature extractor before it queries.
 *
 * This is the line that makes the gate real rather than decorative: it runs
 * inside the data layer, so there is no code path that reads a data type the
 * token does not carry. Marking the type as used is what later produces an
 * honest USE row — permitted-but-unread types get no row.
 */
export function assertDataType(token, dataType) {
  if (!token || typeof token.grantedDataTypes?.has !== 'function') {
    throw new ApiError(
      403,
      'CONSENT_REQUIRED',
      'Nambikai needs your permission to read this data before it can do this.',
      { missing: [dataType], reason: 'NO_CONSENT_TOKEN' },
    );
  }
  if (!token.grantedDataTypes.has(dataType)) {
    throw new ApiError(
      403,
      'CONSENT_REQUIRED',
      'Nambikai needs your permission to read this data before it can do this.',
      { missing: [dataType], purpose: token.purpose, grantPath: '/api/v1/nambikai/consents' },
    );
  }
  token.used.add(dataType);
  return true;
}

/**
 * A token carrying an explicit set of data types, for internal callers and for
 * tests that need to prove a SPECIFIC permission is what unlocks a query.
 *
 * `dataTypes` is honoured directly rather than being derived from records — a
 * token built from an empty record list would refuse everything, which would let
 * a boundary test pass without actually demonstrating that the missing type was
 * the reason.
 */
export function tokenFor(dataTypes = [], overrides = {}) {
  const token = buildToken({
    subjectType: SUBJECT_TYPE.USER,
    subjectId: 'none',
    purpose: PURPOSE.HEALTH_SCORE,
    records: [],
    requestId: 'none',
    actor: ACTOR.ENGINE,
    ...overrides,
  });
  token.grantedDataTypes = new Set(dataTypes);
  return token;
}

/** A token that permits nothing. */
export const emptyToken = (overrides = {}) => tokenFor([], overrides);
