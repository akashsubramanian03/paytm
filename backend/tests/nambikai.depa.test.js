/**
 * The consent artefact, and the OCEN role model.
 *
 * The point of these is narrower than it looks. They do not test compliance —
 * nothing here is an Account Aggregator and no test could make it one. They
 * test two things that ARE checkable:
 *
 *   1. Every field the framework requires is already present in the consent
 *      record, so the artefact is a serialiser and not a second model invented
 *      to look compliant. If a field had to be faked, that would show up here
 *      as a hardcoded value with nothing behind it.
 *
 *   2. The artefact never claims to be more than it is. An unsigned, simulated
 *      artefact that says so is honest; one that omits the disclaimer is not,
 *      and this file fails the build if the disclaimer goes missing.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  consentArtefact,
  ocenRoles,
  DEPA_VERSION,
  FI_TYPE_FOR_DATA_TYPE,
  PURPOSE_CODE_FOR,
} from '../src/nambikai/depa.js';
import { DATA_TYPE, PURPOSE } from '../src/nambikai/constants.js';

const USER = { id: 'usr_1', upiId: 'karthik.balaji@paytm' };
const ASOF = new Date('2026-08-22T00:00:00.000Z');

const RECORD = {
  id: 'cns_1',
  subjectType: 'USER',
  subjectId: 'usr_1',
  userId: 'usr_1',
  dataType: DATA_TYPE.WALLET_LEDGER,
  purpose: PURPOSE.UNDERWRITING,
  scope: JSON.stringify({ windowDays: 365, partnerIds: ['partner_demo_nbfc'] }),
  version: 1,
  grantedAt: new Date('2026-02-01T00:00:00.000Z'),
  expiresAt: new Date('2027-02-01T00:00:00.000Z'),
  revokedAt: null,
};

const build = (overrides = {}) =>
  consentArtefact({ ...RECORD, ...overrides }, { user: USER, asOf: ASOF });

/* ================================================ the artefact shape ====== */

describe('the consent record already carries what DEPA requires', () => {
  test('every required consentDetail field is populated from the record', () => {
    const { consentDetail: d } = build();

    // Each of these comes from a column that existed before this file did.
    assert.equal(d.consentStart, '2026-02-01T00:00:00.000Z');
    assert.equal(d.consentExpiry, '2027-02-01T00:00:00.000Z');
    assert.equal(d.Purpose.code, '105');
    assert.equal(d.Purpose.Category.type, 'UNDERWRITING');
    assert.deepEqual(d.fiTypes, ['DEPOSIT']);
    assert.equal(d.Customer.id, 'karthik.balaji@paytm');
    assert.ok(d.DataLife, 'retention must be stated');
    assert.ok(d.Frequency, 'access frequency must be stated');
  });

  test('the rolling window resolves into an explicit date range', () => {
    // The record stores "365 days"; the artefact must state two instants,
    // because a relative window is not something a lender can hold you to.
    const { consentDetail } = build();
    assert.equal(consentDetail.FIDataRange.to, ASOF.toISOString());
    assert.equal(consentDetail.FIDataRange.from, '2025-08-22T00:00:00.000Z');
  });

  test('a consent with no window has no data range rather than a guessed one', () => {
    const { consentDetail } = build({ scope: JSON.stringify({}) });
    assert.equal(consentDetail.FIDataRange, null);
  });

  test('the mode is VIEW, because no raw record is ever retained', () => {
    // STORE would overstate what Nambikai keeps: derived scores, never the
    // transactions they came from.
    assert.equal(build().consentDetail.consentMode, 'VIEW');
  });

  test('the digest changes when any term of the consent changes', () => {
    const a = build();
    const b = build({ scope: JSON.stringify({ windowDays: 90 }) });
    assert.notEqual(a.consentDetailDigest, b.consentDetailDigest);
    assert.match(a.consentDetailDigest, /^[0-9a-f]{64}$/);
  });

  test('the digest is stable for identical terms', () => {
    assert.equal(build().consentDetailDigest, build().consentDetailDigest);
  });

  test('every data type maps to a real ReBIT FI type', () => {
    const REBIT_FI_TYPES = new Set([
      'DEPOSIT', 'TERM_DEPOSIT', 'RECURRING_DEPOSIT', 'MUTUAL_FUNDS', 'EQUITIES',
      'BONDS', 'INSURANCE_POLICIES', 'NPS', 'GSTR1_3B', 'OTHER',
    ]);
    for (const dataType of Object.values(DATA_TYPE)) {
      const fiType = FI_TYPE_FOR_DATA_TYPE[dataType];
      assert.ok(fiType, `${dataType} has no FI type`);
      assert.ok(REBIT_FI_TYPES.has(fiType), `${dataType} maps to invented FI type ${fiType}`);
    }
  });

  test('every purpose maps to a real ReBIT purpose code', () => {
    for (const purpose of Object.values(PURPOSE)) {
      assert.ok(['101', '102', '103', '104', '105'].includes(PURPOSE_CODE_FOR[purpose]),
        `${purpose} maps to an invented purpose code`);
    }
  });
});

/* ============================================== it never overclaims ======= */

describe('the artefact never claims to be more than it is', () => {
  test('it is unsigned, and says so rather than faking a signature', () => {
    assert.equal(build().signature, null);
  });

  test('it is labelled simulated, with the reason spelled out', () => {
    const { nambikai } = build();
    assert.equal(nambikai.simulated, true);
    assert.match(nambikai.note, /not an AA and not a registered FIU/i);
  });

  test('it declares the spec version it follows', () => {
    assert.equal(build().ver, DEPA_VERSION);
  });

  test('revocation and expiry are distinguished, not collapsed into "inactive"', () => {
    assert.equal(build().nambikai.status, 'ACTIVE');
    assert.equal(build({ revokedAt: new Date('2026-06-01') }).nambikai.status, 'REVOKED');
    assert.equal(
      build({ expiresAt: new Date('2026-03-01'), revokedAt: null }).nambikai.status,
      'EXPIRED',
    );
  });

  test('a revoked consent still serialises — the record of what was allowed survives', () => {
    // Deleting it would destroy the audit story. It must remain readable and
    // be marked, exactly as a withdrawn permission is elsewhere in the system.
    const artefact = build({ revokedAt: new Date('2026-06-01') });
    assert.equal(artefact.consentId, 'cns_1');
    assert.equal(artefact.nambikai.revokedAt, '2026-06-01T00:00:00.000Z');
  });
});

/* ==================================================== the OCEN roles ====== */

describe('the OCEN role model matches what the code actually does', () => {
  test('Nambikai is the LSP and explicitly not the lender', () => {
    const roles = ocenRoles({ partner: { id: 'partner_demo_nbfc', displayName: 'Demo NBFC' } });
    assert.equal(roles.loanServiceProvider.role, 'LSP');
    assert.match(roles.loanServiceProvider.note, /does not lend/i);
    assert.equal(roles.lender.id, 'partner_demo_nbfc');
  });

  test('the Account Aggregator slot is empty and honest about it', () => {
    // Claiming an AA we do not use would be the single most misleading thing
    // this file could do.
    const roles = ocenRoles();
    assert.equal(roles.accountAggregator.id, null);
    assert.match(roles.accountAggregator.note, /Not used/i);
    assert.equal(roles.simulated, true);
  });

  test('a report generated without a partner still names the roles', () => {
    assert.equal(ocenRoles().lender.id, null);
    assert.equal(ocenRoles().loanServiceProvider.id, 'nambikai');
  });
});
