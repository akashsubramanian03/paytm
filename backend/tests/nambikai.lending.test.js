/**
 * Lending tests.
 *
 * The properties that matter here are not "does a loan get created" but
 * "does the system refuse to lend more than someone can carry", "can an
 * instalment be paid twice", and "does repaying actually change the score".
 * Those are the things that would quietly break and stay broken.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';

let server;
let baseUrl;
let prisma;

function resetTestDatabase() {
  const dbDir = path.join(BACKEND_ROOT, 'prisma');
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const file = path.join(dbDir, `test.db${suffix}`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  const env = { ...process.env, DATABASE_URL: 'file:./test.db' };
  const run = (file, args) => {
    try {
      execFileSync(file, args, { cwd: BACKEND_ROOT, env, stdio: 'pipe' });
    } catch (err) {
      throw new Error(`setup failed: ${file}\n${`${err.stdout ?? ''}${err.stderr ?? ''}`.trim()}`);
    }
  };
  run(path.join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy']);
  run(process.execPath, ['prisma/seed.js']);
}

before(async () => {
  resetTestDatabase();
  const { createApp } = await import('../src/app.js');
  const db = await import('../src/lib/db.js');
  prisma = db.prisma;
  await db.initDatabase();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  await prisma?.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

async function api(method, url, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const signIn = async (email) => {
  const res = await api('POST', '/auth/signin', { body: { identifier: email, password: 'password123' } });
  return { token: res.body.token, userId: res.body.user.id };
};
const balanceOf = async (token) =>
  (await api('GET', '/account/balance', { token })).body.account.balancePaise;

/* ==================================================== the money question == */

describe('affordability decides how much, not just whether', () => {
  test('an offer names the limit that bound it', async () => {
    const sreeram = await signIn('sreeram@paytm.test');
    const res = await api('GET', '/nambikai/lending/offers', { token: sreeram.token });
    assert.equal(res.status, 200);
    const offer = res.body.offers[0];
    assert.ok(offer, 'the baseline persona should have an offer');

    assert.ok(offer.affordability.bindingConstraint, 'an offer must say what capped it');
    assert.ok(
      ['FOIR', 'RISK_BAND', 'GRADUATED_CAP', 'PRODUCT_MAX', 'REQUESTED'].includes(
        offer.affordability.bindingConstraint,
      ),
    );
    assert.ok(offer.emi.paise > 0 && offer.principal.paise > 0);
  });

  test('a first-time borrower is capped however good the numbers are', async () => {
    const sreeram = await signIn('sreeram@paytm.test');
    const offer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];

    const loans = await prisma.loan.count({ where: { userId: sreeram.userId } });
    assert.equal(loans, 0, 'this persona is seeded with no loan history');
    assert.equal(
      offer.affordability.bindingConstraint,
      'GRADUATED_CAP',
      'a first loan must be capped by history, not only by capacity',
    );
    assert.ok(offer.principal.paise <= 1_500_000, 'the first-loan ceiling is Rs 15,000');
  });

  test('closing a loan lifts the ceiling', async () => {
    const meena = await signIn('meena@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');

    const closed = await prisma.loan.count({ where: { userId: meena.userId, status: 'CLOSED' } });
    assert.ok(closed > 0, 'this persona is seeded with a repaid loan');

    const meenaOffer = (await api('GET', '/nambikai/lending/offers', { token: meena.token })).body.offers[0];
    const sreeramOffer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];

    assert.ok(
      meenaOffer.principal.paise > sreeramOffer.principal.paise,
      'someone who finished a loan should be trusted with more than a first-timer',
    );
  });

  test('FOIR falls with income, so the poorest are capped hardest', async () => {
    const { foirBandFor } = await import('../src/nambikai/engine/affordability.js');
    const bands = [1_000_000, 2_000_000, 4_000_000, 9_000_000].map((i) => foirBandFor(i).foirBps);
    for (let i = 1; i < bands.length; i += 1) {
      assert.ok(bands[i] >= bands[i - 1], 'a lower income must never permit a higher debt share');
    }
    assert.ok(bands[0] < bands[bands.length - 1], 'the bands must actually differ');
  });

  test('capacity is never exceeded, across a wide sweep', async () => {
    const { assessAffordability, emiFor, foirBandFor } = await import(
      '../src/nambikai/engine/affordability.js'
    );

    for (let i = 0; i < 150; i += 1) {
      const income = 500_000 + i * 90_000;
      const obligations = (i % 9) * 60_000;
      const fv = {
        windowMonths: 12,
        ledger: {
          activeMonths: 12,
          monthlyInflowPaise: Array(12).fill(income),
          monthlyOutflowPaise: Array(12).fill(Math.round(income * 0.7)),
        },
        group: { committedPerCyclePaise: obligations },
      };
      const result = assessAffordability({
        fv,
        band: 'LOW',
        eligible: true,
        activeEmiPaise: 0,
        closedLoanCount: 5, // lift the graduated cap so FOIR is what binds
        annualRateBps: 2400,
        tenureMonths: 12,
      });

      const ceiling = Math.floor((foirBandFor(income).foirBps * income) / 10_000);
      const emi = emiFor(result.maxPrincipalPaise, 2400, 12);

      if (obligations >= ceiling) {
        // Already at or over the ceiling before this loan. The only correct
        // answer is to lend nothing — not to squeeze in a smaller instalment.
        assert.equal(
          result.maxPrincipalPaise, 0,
          `lent ${result.maxPrincipalPaise} to someone already over their ceiling at income ${income}`,
        );
      } else {
        assert.ok(
          emi + obligations <= ceiling + 1, // one paise for the ceil in emiFor
          `FOIR exceeded at income ${income}: EMI ${emi} + obligations ${obligations} > ${ceiling}`,
        );
      }
    }
  });

  test('the amortisation schedule closes exactly', async () => {
    const { buildSchedule, schedulePrincipalTotal } = await import(
      '../src/nambikai/engine/affordability.js'
    );
    for (const [principal, rate, tenure] of [
      [5_000_000, 2400, 12], [1_234_567, 1800, 6], [10_000_000, 3000, 24], [200_000, 0, 3],
    ]) {
      const rows = buildSchedule(principal, rate, tenure);
      assert.equal(rows.length, tenure);
      assert.equal(
        schedulePrincipalTotal(rows), principal,
        'the principal legs must sum to exactly the principal borrowed',
      );
      assert.equal(rows[rows.length - 1].outstandingAfterPaise, 0);
    }
  });
});

/* ============================================ a decline is not a rejection */

describe('a no explains itself', () => {
  test('being at capacity is distinguished from being ineligible', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await api('GET', '/nambikai/lending/eligibility', { token: karthik.token });

    assert.equal(res.status, 200);
    assert.equal(res.body.score.band, 'LOW', 'the hero is creditworthy');
    assert.ok(!res.body.bestOffer, 'and is already at his safe limit');

    const reason = res.body.noOfferReason;
    assert.equal(reason.kind, 'AT_CAPACITY');
    assert.ok(reason.committedPaise > 0 && reason.ceilingPaise > 0);
    assert.ok(reason.paths.length > 0, 'a no must name what would change it');
    assert.ok(
      reason.paths.some((p) => p.key === 'FINISH_CURRENT_LOAN'),
      'someone with a live loan should be told that finishing it helps',
    );
  });

  test('an overdue instalment outranks every other explanation', async () => {
    const rahul = await signIn('rahul@paytm.test');
    const res = await api('GET', '/nambikai/lending/eligibility', { token: rahul.token });
    assert.equal(res.body.noOfferReason.kind, 'IN_ARREARS');
    assert.ok(res.body.noOfferReason.daysPastDue > 0);
  });

  test('the what-if quotes numbers the real engine would produce', async () => {
    const { whatWouldChange } = await import('../src/nambikai/engine/whatIf.js');
    const { scoreUser } = await import('../src/nambikai/engine/scorecard.js');
    const { SCENARIOS } = await import('../src/nambikai/engine/whatIf.js');

    const fv = {
      windowMonths: 12,
      accountTenureMonths: 4,
      ledger: {
        activeMonths: 4,
        monthlyInflowPaise: Array(12).fill(900_000),
        monthlyOutflowPaise: Array(12).fill(800_000),
        monthEndBalancePaise: Array(12).fill(80_000),
        monthsWithIncome: Array(12).fill(1),
        monthsWithBill: Array(12).fill(0),
        monthsWithRecharge: Array(12).fill(0),
        monthlyLoanOutPaise: Array(12).fill(0),
        entryCount: 120, failedCount: 0, lowBalanceCount: 20,
        distinctCounterparties: 3, borrowLikeEvents: 0, repaidEvents: 0,
        currentBalancePaise: 80_000, daysSinceLastActivity: 2,
      },
      group: { dueCount: 0, onTimeCount: 0, paidCount: 0, lateCount: 0, missedCount: 0, avgDaysLate: 0, recentDueCount: 0, recentMissedCount: 0, activeGroupCount: 0, monthsInAnyGroup: 0, savedPaise: 0, committedPerCyclePaise: 0 },
    };

    const result = whatWouldChange(fv);
    assert.ok(result.scenarios.length > 0, 'a thin file should have routes forward');

    // Every projection must be reproducible by applying the delta for real.
    for (const s of result.scenarios) {
      const scenario = SCENARIOS.find((x) => x.key === s.key);
      const applied = scenario.apply(JSON.parse(JSON.stringify(fv)));
      assert.equal(
        scoreUser(applied).score, s.projectedScore,
        `${s.key} quoted a score the engine would not produce`,
      );
      assert.ok(s.scoreDelta > 0 || s.unlocksEligibility, 'advice that changes nothing is noise');
    }
  });

  test('what-if is deterministic', async () => {
    const { whatWouldChange } = await import('../src/nambikai/engine/whatIf.js');
    const karthik = await signIn('karthik@paytm.test');
    const { buildUserFeatureVector } = await import('../src/nambikai/features/featureVector.js');
    const { tokenFor } = await import('../src/nambikai/consent/consent.guard.js');
    const fv = await buildUserFeatureVector(karthik.userId, {
      token: tokenFor(['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS', 'LOAN_HISTORY', 'REPAYMENT_HISTORY']),
    });
    assert.deepEqual(whatWouldChange(fv), whatWouldChange(fv));
  });
});

/* ================================================== the loop, end to end == */

describe('the lending loop', () => {
  test('KYC gates disbursement', async () => {
    const sreeram = await signIn('sreeram@paytm.test');

    const kyc = await api('GET', '/nambikai/lending/kyc', { token: sreeram.token });
    assert.equal(kyc.body.verified, false, 'this persona is seeded without KYC on purpose');

    const offer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];
    const applied = await api('POST', '/nambikai/lending/applications', {
      token: sreeram.token,
      body: { productKey: offer.productKey, purpose: 'WORKING_CAPITAL' },
    });
    assert.equal(applied.status, 201);
    assert.ok(applied.body.offer);

    const blocked = await api(
      'POST',
      `/nambikai/lending/applications/${applied.body.application.id}/accept`,
      { token: sreeram.token, body: { offerId: applied.body.offer.id } },
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'KYC_REQUIRED');
  });

  test('a malformed identity number is refused', async () => {
    const sreeram = await signIn('sreeram@paytm.test');
    const bad = await api('POST', '/nambikai/lending/kyc', {
      token: sreeram.token,
      body: { idType: 'PAN', value: 'NOTAPAN123' },
    });
    assert.equal(bad.body.verified, false);
    assert.ok(bad.body.failureReason);
    assert.equal(bad.body.record.method, 'SIMULATED_FORMAT_CHECK', 'never claim real verification');
  });

  test('apply → verify → disburse → repay, end to end', async () => {
    const sreeram = await signIn('sreeram@paytm.test');

    const verified = await api('POST', '/nambikai/lending/kyc', {
      token: sreeram.token,
      body: { idType: 'PAN', value: 'ABCDE1234F' },
    });
    assert.equal(verified.body.verified, true);
    assert.match(verified.body.record.maskedId, /X/, 'the full number must never be stored');

    const offer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];
    const applied = await api('POST', '/nambikai/lending/applications', {
      token: sreeram.token,
      body: { productKey: offer.productKey, purpose: 'WORKING_CAPITAL' },
    });

    const before = await balanceOf(sreeram.token);
    const accepted = await api(
      'POST',
      `/nambikai/lending/applications/${applied.body.application.id}/accept`,
      { token: sreeram.token, body: { offerId: applied.body.offer.id } },
    );
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));

    // The money is real, and lands in the ordinary passbook.
    const after = await balanceOf(sreeram.token);
    assert.equal(after - before, accepted.body.loan.principal.paise);
    assert.equal(accepted.body.disbursement.category, 'LOAN_DISBURSEMENT');

    const loanId = accepted.body.loan.id;
    const detail = await api('GET', `/nambikai/lending/loans/${loanId}`, { token: sreeram.token });
    assert.equal(detail.body.installments.length, accepted.body.loan.tenureMonths);

    // Paying one moves money and marks exactly that instalment.
    const first = detail.body.installments[0];
    const beforePay = await balanceOf(sreeram.token);
    const paid = await api(
      'POST',
      `/nambikai/lending/loans/${loanId}/installments/${first.id}/pay`,
      { token: sreeram.token },
    );
    assert.equal(paid.status, 201);
    assert.equal(paid.body.installment.status, 'PAID');
    assert.equal(paid.body.transaction.category, 'LOAN_REPAYMENT');
    assert.equal(beforePay - (await balanceOf(sreeram.token)), first.amountDue.paise);

    // Outstanding falls by the PRINCIPAL portion, not the whole instalment —
    // interest is the cost of the loan, not a reduction of it.
    assert.equal(
      paid.body.loan.outstanding.paise,
      accepted.body.loan.principal.paise - first.principal.paise,
    );
  });

  test('an instalment cannot be paid twice, even concurrently', async () => {
    const ananya = await signIn('ananya@paytm.test');
    // Give this persona what they need, then borrow.
    for (const dataType of ['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS', 'BILL_PAYMENTS', 'LOAN_HISTORY']) {
      await api('POST', '/nambikai/consents', {
        token: ananya.token,
        body: { dataType, purpose: 'UNDERWRITING' },
      });
    }
    await api('POST', '/nambikai/lending/kyc', {
      token: ananya.token,
      body: { idType: 'PAN', value: 'ZYXWV9876B' },
    });

    const offers = (await api('GET', '/nambikai/lending/offers', { token: ananya.token })).body.offers;
    assert.ok(offers.length, 'expected an offer for this persona');

    const applied = await api('POST', '/nambikai/lending/applications', {
      token: ananya.token,
      body: { productKey: offers[0].productKey, purpose: 'EMERGENCY' },
    });
    const accepted = await api(
      'POST',
      `/nambikai/lending/applications/${applied.body.application.id}/accept`,
      { token: ananya.token, body: { offerId: applied.body.offer.id } },
    );
    const loanId = accepted.body.loan.id;
    const detail = await api('GET', `/nambikai/lending/loans/${loanId}`, { token: ananya.token });
    const target = detail.body.installments[0];

    const before = await balanceOf(ananya.token);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api('POST', `/nambikai/lending/loans/${loanId}/installments/${target.id}/pay`, {
          token: ananya.token,
        }),
      ),
    );

    assert.equal(results.filter((r) => r.status === 201).length, 1, 'exactly one tap may succeed');
    assert.equal(
      before - (await balanceOf(ananya.token)),
      target.amountDue.paise,
      'money moved more than once',
    );
  });

  test('you cannot see or pay somebody else’s loan', async () => {
    const rahul = await signIn('rahul@paytm.test');
    const divya = await signIn('divya@paytm.test');
    const loan = await prisma.loan.findFirst({ where: { userId: rahul.userId } });

    assert.equal((await api('GET', `/nambikai/lending/loans/${loan.id}`, { token: divya.token })).status, 404);
    const inst = await prisma.loanInstallment.findFirst({ where: { loanId: loan.id } });
    assert.equal(
      (await api('POST', `/nambikai/lending/loans/${loan.id}/installments/${inst.id}/pay`, { token: divya.token })).status,
      404,
    );
  });
});

/* ============================================ repayment feeds the score == */

describe('the loop closes', () => {
  test('a clean repayment record is measured and helps', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const score = (await api('POST', '/nambikai/score/recompute', { token: karthik.token })).body.score;
    const category = score.breakdown.find((b) => b.category === 'REPAYMENT_TRACK_RECORD');

    assert.equal(category.measured, true, 'this persona is seeded mid-loan and paying on time');
    assert.ok(category.weightBps > 0);
    assert.ok(category.rawPct >= 90, `a spotless record should score high, got ${category.rawPct}`);
    assert.ok(score.reasonCodes.some((c) => c.code === 'REPAYMENT_SPOTLESS'));
  });

  test('someone with no loan is unmeasured, not penalised', async () => {
    const priya = await signIn('priya@paytm.test');
    for (const dataType of ['LOAN_HISTORY']) {
      await api('POST', '/nambikai/consents', { token: priya.token, body: { dataType, purpose: 'HEALTH_SCORE' } });
    }
    const score = (await api('POST', '/nambikai/score/recompute', { token: priya.token })).body.score;
    const category = score.breakdown.find((b) => b.category === 'REPAYMENT_TRACK_RECORD');

    assert.equal(category.measured, false);
    assert.equal(category.weightBps, 0, 'never having borrowed must not be counted against you');
    assert.equal(score.breakdown.reduce((a, b) => a + b.weightBps, 0), 10_000);
  });

  test('delinquency fires a gate that can only worsen the band', async () => {
    const rahul = await signIn('rahul@paytm.test');
    const score = (await api('POST', '/nambikai/score/recompute', { token: rahul.token })).body.score;
    const gate = score.gates.gates.find((g) => g.code === 'GATE_ACTIVE_DELINQUENCY');

    assert.ok(gate?.triggered, 'this persona is seeded with overdue instalments');
    assert.ok(gate.evidence.maxDaysPastDue > 30);
    const { bandRank } = await import('../src/nambikai/engine/bands.js');
    assert.ok(bandRank(score.band) >= bandRank(score.gates.bandBeforeGates));
  });

  test('the portfolio marks the scorecard against outcomes', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await api('GET', '/nambikai/lending/portfolio', { token: karthik.token });

    assert.equal(res.status, 200);
    assert.ok(res.body.byBand.length > 0);
    for (const row of res.body.byBand) {
      assert.ok(row.loans > 0);
      if (row.installmentsDue > 0) {
        assert.ok(row.onTimeRatePct >= 0 && row.onTimeRatePct <= 100);
      }
    }
  });
});

/* ================================================= supporting capability = */

describe('supporting capabilities', () => {
  test('the due date comes from the borrower’s own cash flow', async () => {
    const sreeram = await signIn('sreeram@paytm.test');
    const offer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];
    assert.ok(offer.suggestedDueDay >= 1 && offer.suggestedDueDay <= 28);
    assert.ok(offer.dueDayRationale, 'the choice must be explainable');
  });

  test('both rates are always shown', async () => {
    const sreeram = await signIn('sreeram@paytm.test');
    const offer = (await api('GET', '/nambikai/lending/offers', { token: sreeram.token })).body.offers[0];
    assert.ok(offer.rate.flatPct > 0 && offer.rate.reducingPct > 0);
    assert.ok(
      offer.rate.flatPct < offer.rate.reducingPct,
      'a flat quote always looks smaller — that is why both are shown',
    );
    assert.ok(offer.rate.note.length > 30);
  });

  test('the income proof states its own limits', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await api('GET', '/nambikai/lending/income-proof', { token: karthik.token });
    assert.equal(res.status, 200);
    const p = res.body.proof;

    assert.ok(p.income.medianMonthlyPaise > 0);
    assert.ok(p.income.distinctPayers > 0);
    assert.ok(p.limitations.length >= 3, 'the caveats belong on the document');
    assert.ok(p.limitations.some((l) => /cash/i.test(l)), 'it must admit cash income is invisible');
    assert.ok(!JSON.stringify(p).includes(karthik.userId), 'no internal ids on a shareable document');
  });

  test('wash trading is detected, a savings circle is not', async () => {
    const { detectCircularTransfers } = await import('../src/nambikai/engine/anomaly.js');
    const wash = Array.from({ length: 16 }, (_, i) => ({
      counterpartyId: 'x',
      direction: i % 2 ? 'CREDIT' : 'DEBIT',
      amountPaise: 1_000_000,
      createdAt: new Date(),
    }));
    assert.equal(detectCircularTransfers(wash).length, 1);
    assert.equal(
      detectCircularTransfers(wash.map((e) => ({ ...e, metadata: '{"kind":"GROUP_CONTRIBUTION"}' }))).length,
      0,
      'a circle IS circular, legitimately',
    );
  });
});

/* ================================================ whole-database checks == */

describe('whole-database invariants after loan writes', () => {
  test('no wallet is negative', async () => {
    for (const a of await prisma.account.findMany()) assert.ok(a.balancePaise >= 0);
  });

  test('every balance still equals the sum of its ledger', async () => {
    const accounts = await prisma.account.findMany();
    const entries = await prisma.ledgerEntry.findMany();
    for (const account of accounts) {
      const sum = entries
        .filter((e) => e.userId === account.userId)
        .reduce((n, e) => n + (e.direction === 'CREDIT' ? e.amountPaise : -e.amountPaise), 0);
      assert.equal(sum, account.balancePaise, `ledger and balance disagree for ${account.userId}`);
    }
  });

  test('transfers still pair, and loan rows are single-leg', async () => {
    const entries = await prisma.ledgerEntry.findMany();
    const byRef = new Map();
    for (const e of entries.filter((x) => x.category === 'TRANSFER')) {
      if (!byRef.has(e.referenceId)) byRef.set(e.referenceId, []);
      byRef.get(e.referenceId).push(e);
    }
    for (const [ref, legs] of byRef) {
      assert.equal(legs.length, 2, `${ref} has ${legs.length} legs`);
    }
    for (const category of ['LOAN_DISBURSEMENT', 'LOAN_REPAYMENT']) {
      const rows = entries.filter((e) => e.category === category);
      assert.ok(rows.length > 0, `expected ${category} rows`);
      for (const row of rows) {
        assert.equal(
          entries.filter((e) => e.referenceId === row.referenceId).length, 1,
          'loan rows are single-leg — the partner has no wallet here',
        );
      }
    }
  });

  test('every paid instalment agrees with the ledger row it annotates', async () => {
    const paid = await prisma.loanInstallment.findMany({
      where: { status: 'PAID' },
      include: { ledgerEntry: true },
    });
    assert.ok(paid.length > 0);
    for (const i of paid) {
      assert.ok(i.ledgerEntry, `paid instalment ${i.id} annotates nothing`);
      assert.equal(i.ledgerEntry.direction, 'DEBIT');
      assert.equal(i.amountPaidPaise, i.ledgerEntry.amountPaise);
    }
  });

  test('no unpaid instalment points at a ledger row', async () => {
    const unpaid = await prisma.loanInstallment.findMany({
      where: { status: { in: ['PENDING', 'MISSED', 'WAIVED'] } },
    });
    for (const i of unpaid) assert.equal(i.ledgerEntryId, null);
  });

  test('nothing under src/nambikai/ writes a ledger row directly', () => {
    const root = path.join(BACKEND_ROOT, 'src', 'nambikai');
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const src = fs.readFileSync(full, 'utf8');
          if (/(prisma|tx)\.ledgerEntry\.(create|createMany|update|updateMany|delete)/.test(src)) {
            offenders.push(path.relative(BACKEND_ROOT, full));
          }
        }
      }
    };
    walk(root);
    assert.deepEqual(offenders, [], 'lib/wallet.js must remain the only module writing ledger rows');
  });
});
