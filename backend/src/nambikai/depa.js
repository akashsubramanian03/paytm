/**
 * The consent record, serialised into the shape India's Account Aggregator
 * framework uses — and the OCEN roles this system already splits itself into.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT.
 *
 * Nambikai is not an Account Aggregator and is not a Financial Information
 * User. Becoming either requires RBI onboarding that a demo does not have, and
 * nothing here talks to a real AA. Every artefact this file produces is marked
 * `simulated: true` and carries a note saying so.
 *
 * What it IS: proof that the consent layer was built to the right shape. DEPA's
 * consent artefact names a purpose, the data types it covers, a validity
 * window, a retention life, and a revocation state — and requires every access
 * to be logged. `consent.guard.js` and `audit.js` already store all of that,
 * because a permission that cannot be scoped, expired, revoked and audited is
 * not a permission. So this is a serialiser over fields that already exist, not
 * a new model bolted on to look compliant.
 *
 * The practical consequence is the one worth saying out loud: the production
 * version of Nambikai replaces the seeded ledger with an AA fetch and changes
 * nothing else. Feature extractors already sit behind a consent token and
 * already re-assert against it before they query. The token is the seam.
 */
import { DATA_TYPE, PURPOSE, DATA_TYPE_LABEL, PURPOSE_LABEL } from './constants.js';
import { canonicalJson, sha256Hex } from './util/hash.js';

/** ReBIT's AA specification version this shape follows. */
export const DEPA_VERSION = '1.1.2';

/**
 * ReBIT Financial Information types.
 *
 * A Paytm wallet is not a category the AA schema anticipated — the taxonomy was
 * written for banks, depositories and insurers. DEPOSIT is the honest nearest
 * neighbour for wallet money, and OTHER is used rather than inventing a code,
 * because a made-up FI type would be worse than an accurate "not covered".
 */
export const FI_TYPE_FOR_DATA_TYPE = {
  [DATA_TYPE.WALLET_LEDGER]: 'DEPOSIT',
  [DATA_TYPE.BILL_PAYMENTS]: 'DEPOSIT',
  [DATA_TYPE.RECHARGE_HISTORY]: 'DEPOSIT',
  [DATA_TYPE.GROUP_CONTRIBUTIONS]: 'OTHER',
  [DATA_TYPE.CLUSTER_TRUST_SIGNAL]: 'OTHER',
  [DATA_TYPE.LOAN_HISTORY]: 'OTHER',
  [DATA_TYPE.REPAYMENT_HISTORY]: 'OTHER',
  [DATA_TYPE.BUSINESS_GST]: 'GSTR1_3B',
  [DATA_TYPE.BUSINESS_INVOICES]: 'OTHER',
};

/**
 * ReBIT purpose codes. Only the two that genuinely apply are used.
 *
 * 102 is "customer spending patterns, budget or other reportings" — which is
 * what a behavioural score actually is. 105 is a one-time explicit consent,
 * which is the right code for a report generated for one lender on one day.
 */
export const PURPOSE_CODE_FOR = {
  [PURPOSE.HEALTH_SCORE]: '102',
  [PURPOSE.ASSISTANT]: '102',
  [PURPOSE.UNDERWRITING]: '105',
  [PURPOSE.SME_UNDERWRITING]: '105',
  [PURPOSE.LOAN_SERVICING]: '105',
};

const PURPOSE_REF = (code) => `https://api.rebit.org.in/aa/purpose/${code}.xml`;

/**
 * VIEW means the consumer may read but not retain.
 *
 * Nambikai stores derived scores, never the records they came from — so VIEW is
 * the accurate mode and STORE would overstate what is kept.
 */
const CONSENT_MODE = 'VIEW';

const isActive = (c, asOf) =>
  !c.revokedAt && (!c.expiresAt || new Date(c.expiresAt) > asOf);

/**
 * One consent record as a DEPA-shaped artefact.
 *
 * @param {object} record  a ConsentRecord row
 * @param {object} opts
 * @param {object} opts.user     the person who granted it
 * @param {Date}   [opts.asOf]   evaluated at this instant
 * @param {object} [opts.scope]  the parsed scope JSON, if already parsed
 */
export function consentArtefact(record, { user, asOf = new Date(), scope } = {}) {
  const parsedScope = scope ?? safeParse(record.scope);
  const windowDays = parsedScope.windowDays ?? null;
  const purposeCode = PURPOSE_CODE_FOR[record.purpose] ?? '102';

  // The AA spec's FIDataRange is the window of history being requested. Ours is
  // expressed as a rolling day count, so it is resolved against `asOf` here
  // rather than stored as two timestamps that would go stale.
  const fiDataRange = windowDays
    ? {
        from: new Date(asOf.getTime() - windowDays * 86_400_000).toISOString(),
        to: asOf.toISOString(),
      }
    : null;

  const consentDetail = {
    consentStart: new Date(record.grantedAt).toISOString(),
    consentExpiry: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
    consentMode: CONSENT_MODE,
    fetchType: 'PERIODIC',
    consentTypes: ['TRANSACTIONS', 'SUMMARY'],
    fiTypes: [FI_TYPE_FOR_DATA_TYPE[record.dataType] ?? 'OTHER'],
    DataConsumer: { id: 'nambikai-fiu-simulated', type: 'FIU' },
    DataProvider: { id: 'paytm-wallet-simulated', type: 'FIP' },
    Customer: { id: user?.upiId ?? record.userId },
    Purpose: {
      code: purposeCode,
      refUri: PURPOSE_REF(purposeCode),
      text: PURPOSE_LABEL[record.purpose] ?? record.purpose,
      Category: { type: record.purpose },
    },
    FIDataRange: fiDataRange,
    // Nothing raw is retained, so the data life is the request itself.
    DataLife: { unit: 'INF', value: 0 },
    Frequency: { unit: 'DAY', value: 1 },
    DataFilter: [],
  };

  return {
    ver: DEPA_VERSION,
    consentId: record.id,
    consentDetail,
    // The spec signs this digest. Nothing here is signed — an unsigned artefact
    // labelled as such is honest; a fake signature would not be.
    consentDetailDigest: sha256Hex(canonicalJson(consentDetail)),
    signature: null,

    // Everything below is outside the spec and is Nambikai's own annotation.
    nambikai: {
      simulated: true,
      note:
        'Shaped to the RBI Account Aggregator consent artefact, but not issued by an ' +
        'Account Aggregator and not signed. Nambikai is not an AA and not a registered FIU. ' +
        'This shows the consent record carries every field the framework requires.',
      status: isActive(record, asOf) ? 'ACTIVE' : record.revokedAt ? 'REVOKED' : 'EXPIRED',
      revokedAt: record.revokedAt ? new Date(record.revokedAt).toISOString() : null,
      dataType: record.dataType,
      dataTypeLabel: DATA_TYPE_LABEL[record.dataType] ?? record.dataType,
      windowDays,
      partnerIds: parsedScope.partnerIds ?? [],
    },
  };
}

/**
 * Who does what, in OCEN's vocabulary.
 *
 * OCEN separates the Loan Service Provider — which assembles a borrower's case
 * — from the Lender, which is regulated and carries the risk. That split is not
 * a label applied afterwards: it is the reason `PARTNER_DISCLAIMER` exists and
 * the reason the engine produces a risk band rather than an approval. Naming it
 * here makes the existing architecture legible to someone who knows the
 * framework, and does not change any behaviour.
 */
export function ocenRoles({ partner } = {}) {
  return {
    specification: 'OCEN (Open Credit Enablement Network), role model only',
    simulated: true,
    borrower: {
      role: 'BORROWER',
      note: 'The person or business being assessed.',
    },
    loanServiceProvider: {
      role: 'LSP',
      id: 'nambikai',
      note:
        'Nambikai assembles the case, holds the consent, and produces the assessment. ' +
        'It does not lend, does not price risk it carries, and does not approve or decline.',
    },
    lender: {
      role: 'LENDER',
      id: partner?.id ?? null,
      displayName: partner?.displayName ?? null,
      note: 'A licensed lender makes the credit decision. Simulated in this demo.',
    },
    accountAggregator: {
      role: 'AA',
      id: null,
      note:
        'Not used. This demo reads a local ledger instead. In production the ledger fetch ' +
        'is replaced by an AA data flow under the consent artefact above; nothing downstream changes, ' +
        'because feature extraction already sits behind a consent token.',
    },
  };
}

function safeParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
