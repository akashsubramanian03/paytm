/**
 * Nambikai API tests — groups, contributions, and the money path.
 *
 * Runs against the same throwaway backend/prisma/test.db as api.test.js. The
 * suite is configured with --test-concurrency=1, so files run sequentially and
 * each may reset the database safely.
 *
 * The three whole-database invariants are re-asserted at the END of this file on
 * purpose. The copies in api.test.js run against a database that has never seen a
 * Nambikai write, so they cannot catch a regression in this layer.
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
  const prismaBin = path.join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma');

  const run = (file, args) => {
    try {
      execFileSync(file, args, { cwd: BACKEND_ROOT, env, stdio: 'pipe' });
    } catch (err) {
      const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
      throw new Error(`Test database setup failed: ${file} ${args.join(' ')}\n${out}`);
    }
  };

  run(prismaBin, ['migrate', 'deploy']);
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
  const res = await api('POST', '/auth/signin', {
    body: { identifier: email, password: 'password123' },
  });
  assert.equal(res.status, 200, `signin failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token, userId: res.body.user.id };
};

const balanceOf = async (token) =>
  (await api('GET', '/account/balance', { token })).body.account.balancePaise;

let counter = 0;

/** A fresh signed-up user, so a test can drain a wallet without touching a
 *  seeded persona that later tests rely on. */
async function makeUser(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  const res = await api('POST', '/auth/signup', {
    body: {
      firstName: 'Test',
      lastName: 'Member',
      email: `nbk.user${n}.${Date.now()}@example.com`,
      phone: `9${String(600000000 + counter * 211 + (Date.now() % 100000)).slice(0, 9)}`,
      password: 'password123',
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A group whose start is backdated so it arrives with real cycle history. */
async function makeBackdatedGroup(token, memberUserIds, overrides = {}) {
  const now = new Date();
  const startedAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 10, 10, 0));
  const res = await api('POST', '/nambikai/groups', {
    token,
    body: {
      // Deliberately not a seeded group name: the seeded-history tests below
      // filter by name, and a collision would let these fixtures pollute them.
      name: 'Test Rotating Circle',
      purpose: 'ROTATING_SAVINGS',
      cadence: 'MONTHLY',
      amount: '500',
      startedAt: startedAt.toISOString(),
      memberUserIds,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `create group failed: ${JSON.stringify(res.body)}`);
  return res.body.group;
}

/**
 * A backdated SAVINGS circle: the creator is the admin and acts as collector, so
 * every other member owes every cycle. Used for the money-path tests because it
 * makes "who has something payable" deterministic — in a rotating group a member
 * skips the cycles they take the pot in, which for a small group can leave them
 * with nothing due.
 */
async function makeSavingsGroup(adminToken, memberUserIds) {
  return makeBackdatedGroup(adminToken, memberUserIds, {
    name: 'Test Savings Circle',
    purpose: 'SAVINGS',
  });
}

/** The caller's first payable contribution in a group. */
async function firstPayable(token, groupId) {
  const detail = await api('GET', `/nambikai/groups/${groupId}`, { token });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const payable = detail.body.myContributions.find((c) => c.isPayable);
  assert.ok(
    payable,
    `expected a payable contribution, got ${JSON.stringify(
      detail.body.myContributions.map((c) => [c.cycleIndex, c.status]),
    )}`,
  );
  return payable;
}

/* ======================================================== groups & cycles == */

describe('savings groups', () => {
  test('creates a group, storing the contribution as integer paise', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');

    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    assert.equal(group.contribution.paise, 50_000, 'Rs 500 must be stored as 50000 paise');
    assert.equal(group.memberCount, 2);
    assert.equal(group.purpose, 'ROTATING_SAVINGS');
  });

  test('a backdated group arrives with its cycle history, not empty', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const ananya = await signIn('ananya@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [ananya.userId]);

    const res = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });
    assert.equal(res.status, 200);
    // Started 3 months ago, monthly: 4 elapsed cycles plus one of lookahead.
    assert.ok(res.body.cycles.length >= 4, `expected >= 4 cycles, got ${res.body.cycles.length}`);
  });

  test('the member receiving a cycle does not also pay into it', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const ananya = await signIn('ananya@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId, ananya.userId]);

    const res = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });
    // 3 members, one takes the pot each cycle, so exactly 2 pay in every cycle.
    for (const cycle of res.body.cycles) {
      assert.equal(cycle.totalCount, 2, `cycle ${cycle.cycleIndex} should have 2 payers`);
    }
  });

  test('contributions past their grace period become MISSED', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    const res = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });
    const statuses = res.body.myContributions.map((c) => c.status);
    assert.ok(
      statuses.includes('MISSED'),
      `a 3-month-old group must have missed cycles, got ${statuses.join(',')}`,
    );
  });

  test('cycle generation is idempotent across repeated reads', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    const first = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });
    const second = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });
    const third = await api('GET', `/nambikai/groups/${group.id}`, { token: karthik.token });

    assert.equal(second.body.cycles.length, first.body.cycles.length);
    assert.equal(third.body.myContributions.length, first.body.myContributions.length);
  });

  test('a group is invisible to anyone who is not a member', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const divya = await signIn('divya@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    const res = await api('GET', `/nambikai/groups/${group.id}`, { token: divya.token });
    assert.equal(res.status, 404, 'a non-member must not learn the group even exists');
  });

  test('only the admin can add or remove members', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const divya = await signIn('divya@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    const added = await api('POST', `/nambikai/groups/${group.id}/members`, {
      token: sreeram.token,
      body: { userId: divya.userId },
    });
    assert.equal(added.status, 403);

    const byAdmin = await api('POST', `/nambikai/groups/${group.id}/members`, {
      token: karthik.token,
      body: { userId: divya.userId },
    });
    assert.equal(byAdmin.status, 201);
  });

  test('a member added later owes nothing for cycles that closed before them', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const priya = await signIn('priya@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    await api('POST', `/nambikai/groups/${group.id}/members`, {
      token: karthik.token,
      body: { userId: priya.userId },
    });

    const theirs = await prisma.contribution.findMany({
      where: { groupId: group.id, userId: priya.userId },
    });
    const founders = await prisma.contribution.findMany({
      where: { groupId: group.id, userId: sreeram.userId },
    });
    assert.ok(
      theirs.length < founders.length,
      'a late joiner must not inherit a founding member’s backlog',
    );
  });
});

/* ============================================================ the money path */

describe('paying a contribution', () => {
  test('writes exactly two legs sharing a referenceId, and annotates the debit', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [sreeram.userId]);
    const payable = await firstPayable(sreeram.token, group.id);

    const before = await balanceOf(sreeram.token);
    const res = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`,
      { token: sreeram.token },
    );
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.contribution.status, 'PAID');

    // A plain TRANSFER, not a new category — that is what keeps the existing
    // "every TRANSFER has one debit and one credit" invariant covering it.
    assert.equal(res.body.transaction.category, 'TRANSFER');
    assert.equal(res.body.transaction.metadata.kind, 'GROUP_CONTRIBUTION');

    const after = await balanceOf(sreeram.token);
    assert.equal(before - after, payable.amountDue.paise, 'debited exactly the amount due');

    const legs = await prisma.ledgerEntry.findMany({
      where: { referenceId: res.body.transaction.referenceId },
    });
    assert.equal(legs.length, 2);
    assert.equal(legs.filter((l) => l.direction === 'DEBIT').length, 1);
    assert.equal(legs.filter((l) => l.direction === 'CREDIT').length, 1);

    const stored = await prisma.contribution.findUnique({ where: { id: payable.id } });
    assert.equal(stored.ledgerEntryId, legs.find((l) => l.direction === 'DEBIT').id);
    assert.equal(stored.amountPaidPaise, stored.amountDuePaise);
  });

  test('the amount comes from the contribution, never from the request body', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const ananya = await signIn('ananya@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [ananya.userId]);
    const payable = await firstPayable(ananya.token, group.id);

    const before = await balanceOf(ananya.token);
    const res = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`,
      { token: ananya.token, body: { amount: '1', amountPaise: 1, status: 'PAID' } },
    );
    assert.equal(res.status, 201);
    assert.equal(
      before - (await balanceOf(ananya.token)),
      50_000,
      'the decoy amount in the request body must be ignored',
    );
  });

  test('paying twice is rejected and moves no money', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const priya = await signIn('priya@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [priya.userId]);
    const payable = await firstPayable(priya.token, group.id);

    const first = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`,
      { token: priya.token },
    );
    assert.equal(first.status, 201);

    const afterFirst = await balanceOf(priya.token);
    const second = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`,
      { token: priya.token },
    );
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'CONTRIBUTION_ALREADY_PAID');
    assert.equal(await balanceOf(priya.token), afterFirst, 'the second attempt moved money');
  });

  test('concurrent taps pay exactly once', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const divya = await signIn('divya@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [divya.userId]);
    const payable = await firstPayable(divya.token, group.id);

    const before = await balanceOf(divya.token);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api(`POST`, `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`, {
          token: divya.token,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 201);
    assert.equal(ok.length, 1, `exactly one tap should succeed, got ${ok.length}`);
    assert.equal(before - (await balanceOf(divya.token)), 50_000, 'money moved more than once');

    const legs = await prisma.ledgerEntry.findMany({
      where: { metadata: { contains: payable.id } },
    });
    assert.equal(legs.length, 2, 'exactly one transfer (two legs) should exist');
  });

  test('an insufficient balance leaves the contribution unpaid and both wallets untouched', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const broke = await makeUser();
    const group = await makeSavingsGroup(karthik.token, [broke.user.id]);
    const payable = await firstPayable(broke.token, group.id);

    // Drain the payer's wallet so the debit cannot succeed.
    const bal = await balanceOf(broke.token);
    await api('POST', '/account/transfer', {
      token: broke.token,
      body: { toUserId: karthik.userId, amount: String(bal / 100) },
    });
    assert.equal(await balanceOf(broke.token), 0);

    const payeeBefore = await balanceOf(karthik.token);
    const res = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${payable.id}/pay`,
      { token: broke.token },
    );
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');

    const stored = await prisma.contribution.findUnique({ where: { id: payable.id } });
    assert.notEqual(stored.status, 'PAID');
    assert.equal(stored.ledgerEntryId, null, 'a failed payment must annotate nothing');
    assert.equal(await balanceOf(broke.token), 0);
    assert.equal(
      await balanceOf(karthik.token),
      payeeBefore,
      'the payee was credited despite the failure',
    );
  });

  test('a missed cycle is closed and cannot be paid', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [sreeram.userId]);

    const missed = await prisma.contribution.findFirst({
      where: { groupId: group.id, userId: sreeram.userId, status: 'MISSED' },
    });
    assert.ok(missed, 'a 3-month-old group must have a missed cycle');

    const before = await balanceOf(sreeram.token);
    const res = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${missed.id}/pay`,
      { token: sreeram.token },
    );
    // A missed cycle stays missed. That is what makes the commitment signal mean
    // something: a record of kept promises is only evidence if broken ones stick.
    assert.equal(res.status, 409);
    assert.equal(await balanceOf(sreeram.token), before);
  });

  test('you cannot pay someone else’s contribution', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeSavingsGroup(karthik.token, [sreeram.userId]);

    const theirs = await prisma.contribution.findFirst({
      where: { groupId: group.id, userId: sreeram.userId, status: 'PENDING' },
    });
    assert.ok(theirs);

    const res = await api(
      'POST',
      `/nambikai/groups/${group.id}/contributions/${theirs.id}/pay`,
      { token: karthik.token },
    );
    assert.equal(res.status, 404);
  });
});

/* ================================================== regulatory posture ==== */

describe('regulatory posture', () => {
  test('the payout cycle is reported, never executed', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const group = await makeBackdatedGroup(karthik.token, [sreeram.userId]);

    const res = await api('GET', `/nambikai/groups/${group.id}/payout-cycle`, {
      token: karthik.token,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.routing.handledByNambikai, false);
    assert.match(res.body.routing.label, /registered/i);

    // The absence of this endpoint is the feature.
    const post = await api('POST', `/nambikai/groups/${group.id}/payout-cycle`, {
      token: karthik.token,
    });
    assert.equal(post.status, 404, 'Nambikai must not expose a way to execute a payout');
  });

  test('no module under src/nambikai/ writes a ledger row directly', async () => {
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

    assert.deepEqual(
      offenders,
      [],
      'lib/wallet.js must remain the only module that writes ledger rows',
    );
  });

  test('every Nambikai route requires authentication', async () => {
    for (const [method, url] of [
      ['GET', '/nambikai/groups'],
      ['POST', '/nambikai/groups'],
      ['GET', '/nambikai/groups/abcdefghij'],
    ]) {
      const res = await api(method, url);
      assert.equal(res.status, 401, `${method} ${url} should require a token`);
    }
  });
});

/* ============================================ whole-database invariants ==== */

describe('whole-database invariants after Nambikai writes', () => {
  test('no wallet is negative', async () => {
    const accounts = await prisma.account.findMany();
    for (const a of accounts) assert.ok(a.balancePaise >= 0, `${a.userId} went negative`);
  });

  test('every wallet balance equals the sum of its ledger', async () => {
    const accounts = await prisma.account.findMany();
    const entries = await prisma.ledgerEntry.findMany();
    for (const account of accounts) {
      const sum = entries
        .filter((e) => e.userId === account.userId)
        .reduce((n, e) => n + (e.direction === 'CREDIT' ? e.amountPaise : -e.amountPaise), 0);
      assert.equal(sum, account.balancePaise, `ledger and balance disagree for ${account.userId}`);
    }
  });

  test('every transfer has exactly one matching debit and credit', async () => {
    const entries = await prisma.ledgerEntry.findMany({ where: { category: 'TRANSFER' } });
    const byRef = new Map();
    for (const e of entries) {
      if (!byRef.has(e.referenceId)) byRef.set(e.referenceId, []);
      byRef.get(e.referenceId).push(e);
    }
    for (const [ref, legs] of byRef) {
      assert.equal(legs.length, 2, `${ref} has ${legs.length} legs`);
      assert.equal(legs.filter((l) => l.direction === 'DEBIT').length, 1, `${ref} debit count`);
      assert.equal(legs.filter((l) => l.direction === 'CREDIT').length, 1, `${ref} credit count`);
      assert.equal(legs[0].amountPaise, legs[1].amountPaise, `${ref} amounts differ`);
    }
  });

  test('every paid contribution agrees with the ledger row it annotates', async () => {
    const paid = await prisma.contribution.findMany({
      where: { status: 'PAID' },
      include: { ledgerEntry: true },
    });
    assert.ok(paid.length > 0, 'expected at least one paid contribution in this run');
    for (const c of paid) {
      assert.ok(c.ledgerEntry, `paid contribution ${c.id} annotates nothing`);
      assert.equal(c.ledgerEntry.direction, 'DEBIT');
      assert.equal(c.ledgerEntry.userId, c.userId);
      assert.equal(c.amountPaidPaise, c.ledgerEntry.amountPaise);
    }
  });

  test('no unpaid contribution points at a ledger row', async () => {
    const unpaid = await prisma.contribution.findMany({
      where: { status: { in: ['PENDING', 'MISSED', 'WAIVED'] } },
    });
    for (const c of unpaid) {
      assert.equal(c.ledgerEntryId, null, `${c.status} contribution ${c.id} moved money`);
    }
  });
});

/* ================================================ the seeded 18 months ==== */

/**
 * These assert the PROPERTIES the behaviour engine depends on, not exact
 * numbers. A seed that still runs but has quietly lost its shape — every persona
 * behaving identically, nobody ever missing a contribution — would produce a
 * scorecard that cannot distinguish anyone, and every downstream test would
 * still pass. These are the tests that would catch that.
 */
describe('seeded 18-month history', () => {
  const seededGroupNames = ['Anna Nagar Vendors Chit', 'Besant Nagar Savers', 'T Nagar Traders Pool'];

  /** Contributions from the seed only, ignoring groups created by other tests. */
  async function seededContributions(where = {}) {
    return prisma.contribution.findMany({
      where: { group: { name: { in: seededGroupNames } }, ...where },
      include: { group: true },
    });
  }

  const personaId = async (email) => (await prisma.user.findUnique({ where: { email } })).id;

  test('every persona has a wallet whose ledger goes back far enough to score', async () => {
    const expected = { 'karthik@paytm.test': 400, 'sreeram@paytm.test': 400, 'divya@paytm.test': 400 };
    for (const [email, minDays] of Object.entries(expected)) {
      const id = await personaId(email);
      const oldest = await prisma.ledgerEntry.findFirst({
        where: { userId: id },
        orderBy: { createdAt: 'asc' },
      });
      const days = Math.round((Date.now() - oldest.createdAt.getTime()) / 86_400_000);
      assert.ok(days >= minDays, `${email} has only ${days} days of history, need ${minDays}`);
    }
  });

  test('the deliberately-new persona has too little history to score', async () => {
    const id = await personaId('arjun@paytm.test');
    const oldest = await prisma.ledgerEntry.findFirst({
      where: { userId: id },
      orderBy: { createdAt: 'asc' },
    });
    const days = Math.round((Date.now() - oldest.createdAt.getTime()) / 86_400_000);
    assert.ok(days < 100, `the thin-file persona should be new, has ${days} days`);
  });

  test('the hero has a long, spotless commitment record', async () => {
    const id = await personaId('karthik@paytm.test');
    const mine = await seededContributions({ userId: id, dueAt: { lte: new Date() } });

    assert.ok(mine.length >= 30, `expected >= 30 due contributions, got ${mine.length}`);
    assert.equal(mine.filter((c) => c.status === 'MISSED').length, 0, 'the hero never misses');
    assert.equal(
      mine.filter((c) => c.status === 'PAID' && c.daysLate > 0).length,
      0,
      'the hero is never late',
    );
    assert.ok(
      new Set(mine.map((c) => c.groupId)).size >= 2,
      'the hero should be building a record in more than one circle',
    );
  });

  test('somebody misses — a commitment record needs a downside to mean anything', async () => {
    const missed = await seededContributions({ status: 'MISSED' });
    assert.ok(missed.length > 0, 'no missed contributions at all: the signal has no negative case');

    const byUser = new Map();
    for (const c of missed) byUser.set(c.userId, (byUser.get(c.userId) ?? 0) + 1);
    assert.ok(byUser.size >= 2, 'misses should be concentrated in specific personas, not universal');
  });

  test('personas differ: on-time rates span a wide range', async () => {
    const all = await seededContributions({ dueAt: { lte: new Date() } });
    const byUser = new Map();
    for (const c of all) {
      if (!byUser.has(c.userId)) byUser.set(c.userId, { due: 0, onTime: 0 });
      const s = byUser.get(c.userId);
      s.due += 1;
      if (c.status === 'PAID' && c.daysLate === 0) s.onTime += 1;
    }
    const rates = [...byUser.values()].filter((s) => s.due >= 5).map((s) => s.onTime / s.due);
    assert.ok(rates.length >= 4, 'expected several personas with a real record');
    assert.ok(Math.max(...rates) >= 0.99, 'somebody should be spotless');
    assert.ok(Math.min(...rates) <= 0.2, 'somebody should be clearly unreliable');
  });

  test('two personas have no group history at all', async () => {
    for (const email of ['priya@paytm.test', 'arjun@paytm.test']) {
      const id = await personaId(email);
      const mine = await seededContributions({ userId: id });
      assert.equal(mine.length, 0, `${email} should have no seeded group history`);
    }
  });

  test('income volatility differs sharply between the freelancer and the salaried', async () => {
    const monthlyTotals = async (email) => {
      const id = await personaId(email);
      const rows = await prisma.ledgerEntry.findMany({
        where: { userId: id, direction: 'CREDIT' },
      });
      const buckets = new Map();
      for (const r of rows) {
        if ((r.metadata ?? '').includes('SIGNUP_BONUS')) continue;
        const key = `${r.createdAt.getUTCFullYear()}-${r.createdAt.getUTCMonth()}`;
        buckets.set(key, (buckets.get(key) ?? 0) + r.amountPaise);
      }
      return [...buckets.values()];
    };

    const cv = (values) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      return Math.sqrt(variance) / mean;
    };

    const freelancer = cv(await monthlyTotals('divya@paytm.test'));
    const shopkeeper = cv(await monthlyTotals('meena@paytm.test'));
    assert.ok(
      freelancer > shopkeeper * 2,
      `the freelancer's income should be far lumpier than the shopkeeper's (${freelancer.toFixed(2)} vs ${shopkeeper.toFixed(2)})`,
    );
  });

  test('buffers differ: somebody is comfortable, somebody is days from empty', async () => {
    const bufferDays = async (email) => {
      const id = await personaId(email);
      const account = await prisma.account.findUnique({ where: { userId: id } });
      const debits = await prisma.ledgerEntry.findMany({ where: { userId: id, direction: 'DEBIT' } });
      const oldest = debits.reduce((a, e) => (e.createdAt < a ? e.createdAt : a), debits[0].createdAt);
      const months = Math.max(1, (Date.now() - oldest.getTime()) / (30 * 86_400_000));
      const perMonth = debits.reduce((n, e) => n + e.amountPaise, 0) / months;
      return (account.balancePaise * 30) / perMonth;
    };

    // Rahul's income collapsed six months ago and his costs did not.
    assert.ok((await bufferDays('rahul@paytm.test')) < 20, 'the declining persona should be nearly empty');
    // Ananya earns well and spends all of it.
    assert.ok((await bufferDays('ananya@paytm.test')) < 20, 'the high-earner should still have a thin buffer');
    // Sreeram is the healthy baseline.
    assert.ok((await bufferDays('sreeram@paytm.test')) > 45, 'the baseline persona should be comfortable');
  });

  test('every seeded paid contribution agrees with the ledger row it annotates', async () => {
    const paid = await prisma.contribution.findMany({
      where: { status: 'PAID' },
      include: { ledgerEntry: true },
    });
    assert.ok(paid.length >= 150, `expected a substantial paid history, got ${paid.length}`);
    for (const c of paid) {
      assert.ok(c.ledgerEntry, `paid contribution ${c.id} annotates nothing`);
      assert.equal(c.amountPaidPaise, c.ledgerEntry.amountPaise);
      assert.equal(c.ledgerEntry.userId, c.userId);
    }
  });

  test('the seed produced a substantial, chronologically coherent ledger', async () => {
    const count = await prisma.ledgerEntry.count();
    assert.ok(count > 3000, `expected thousands of ledger rows, got ${count}`);

    // Every row's balanceAfterPaise must be the running balance at that moment.
    const users = await prisma.user.findMany();
    for (const user of users) {
      const rows = await prisma.ledgerEntry.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      let running = 0;
      for (const row of rows) {
        running += row.direction === 'CREDIT' ? row.amountPaise : -row.amountPaise;
        assert.ok(running >= 0, `${user.email} went negative mid-history`);
      }
      assert.equal(running, rows.at(-1).balanceAfterPaise, `${user.email} final balance drifted`);
    }
  });
});

/* ==================================================== the consent gate ==== */

/**
 * The consent layer is only meaningful if it is a real gate. These tests prove
 * three things a decorative toggle could not do:
 *
 *   - a blocked call names exactly what is missing, and is itself recorded
 *   - the log records what was READ, not merely what was permitted
 *   - the gate lives in the data layer, so an internal caller cannot walk past it
 */
describe('consent gate', () => {
  const inputsFor = (token) => api('GET', '/nambikai/score/inputs', { token });

  test('with no consent, scoring is refused and says precisely what it needs', async () => {
    // Arjun is seeded having granted nothing at all.
    const arjun = await signIn('arjun@paytm.test');
    const res = await inputsFor(arjun.token);

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'CONSENT_REQUIRED');
    assert.deepEqual(
      [...res.body.error.details.missing].sort(),
      ['GROUP_CONTRIBUTIONS', 'WALLET_LEDGER'],
      'the wall must name the exact permissions it wants, not just refuse',
    );
    assert.equal(res.body.error.details.grantPath, '/api/v1/nambikai/consents');
  });

  test('a blocked call is itself audited, one DENY row per missing type', async () => {
    const arjun = await signIn('arjun@paytm.test');
    const before = await prisma.consentAuditLog.count({
      where: { subjectId: arjun.userId, action: 'DENY' },
    });

    await inputsFor(arjun.token);

    const after = await prisma.consentAuditLog.count({
      where: { subjectId: arjun.userId, action: 'DENY' },
    });
    assert.equal(after - before, 2, 'a refusal must be as auditable as a read');

    const rows = await prisma.consentAuditLog.findMany({
      where: { subjectId: arjun.userId, action: 'DENY' },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });
    assert.equal(new Set(rows.map((r) => r.requestId)).size, 1, 'one call, one requestId');
    assert.ok(rows.every((r) => r.reason === 'MISSING_CONSENT'));
    assert.ok(rows.every((r) => r.consentRecordId === null), 'a DENY references no consent');
  });

  test('granting the required permissions opens the gate', async () => {
    const user = await makeUser();
    assert.equal((await inputsFor(user.token)).status, 403, 'a new user starts closed');

    for (const dataType of ['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS']) {
      const granted = await api('POST', '/nambikai/consents', {
        token: user.token,
        body: { dataType, purpose: 'HEALTH_SCORE' },
      });
      assert.equal(granted.status, 201);
    }

    const res = await inputsFor(user.token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(typeof res.body.inputsHash === 'string' && res.body.inputsHash.length === 64);
  });

  test('the log records what was read, not what was permitted', async () => {
    // Karthik is seeded with BILL_PAYMENTS consent for UNDERWRITING, but a
    // health-score run has no business reading biller identities.
    const karthik = await signIn('karthik@paytm.test');
    const res = await inputsFor(karthik.token);
    assert.equal(res.status, 200);

    const requestId = res.body.consent.requestId;
    const rows = await prisma.consentAuditLog.findMany({ where: { requestId, action: 'USE' } });

    assert.equal(rows.length, 2, 'exactly the two types this run needed');
    assert.deepEqual(rows.map((r) => r.dataType).sort(), ['GROUP_CONTRIBUTIONS', 'WALLET_LEDGER']);
    assert.ok(
      !rows.some((r) => r.dataType === 'BILL_PAYMENTS'),
      'a permitted-but-unread type must not appear as a disclosure',
    );
    assert.ok(rows.every((r) => r.artifactType === 'FINANCIAL_HEALTH_SCORE'));
  });

  test('revoking closes the gate again, without erasing what was disclosed', async () => {
    const user = await makeUser();
    for (const dataType of ['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS']) {
      await api('POST', '/nambikai/consents', {
        token: user.token,
        body: { dataType, purpose: 'HEALTH_SCORE' },
      });
    }
    assert.equal((await inputsFor(user.token)).status, 200);

    const list = await api('GET', '/nambikai/consents', { token: user.token });
    const wallet = list.body.consents.find(
      (c) => c.dataType === 'WALLET_LEDGER' && c.purpose === 'HEALTH_SCORE' && c.active,
    );

    const revoked = await api('DELETE', `/nambikai/consents/${wallet.id}`, { token: user.token });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.revoked, true);

    const after = await inputsFor(user.token);
    assert.equal(after.status, 403);
    assert.ok(after.body.error.details.missing.includes('WALLET_LEDGER'));

    // The history of what was read is deliberately preserved.
    const uses = await prisma.consentAuditLog.count({
      where: { subjectId: user.user.id, action: 'USE' },
    });
    assert.ok(uses > 0, 'revoking must not erase the record of what was already read');
  });

  test('re-granting is a new decision, and granting twice is a no-op', async () => {
    const user = await makeUser();

    const first = await api('POST', '/nambikai/consents', {
      token: user.token,
      body: { dataType: 'WALLET_LEDGER', purpose: 'HEALTH_SCORE' },
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.consent.version, 1);

    const again = await api('POST', '/nambikai/consents', {
      token: user.token,
      body: { dataType: 'WALLET_LEDGER', purpose: 'HEALTH_SCORE' },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false, 'toggling an active permission on must not duplicate it');

    await api('DELETE', `/nambikai/consents/${first.body.consent.id}`, { token: user.token });

    const third = await api('POST', '/nambikai/consents', {
      token: user.token,
      body: { dataType: 'WALLET_LEDGER', purpose: 'HEALTH_SCORE' },
    });
    assert.equal(third.status, 201);
    assert.equal(third.body.consent.version, 2, 'a re-grant after a revoke is visibly a new decision');
  });

  test('THE BOUNDARY: an extractor called directly without consent throws', async () => {
    // This is the test that distinguishes a real gate from middleware. If the
    // check lived on the HTTP route, this call would happily return data.
    const { extractGroupFeatures } = await import('../src/nambikai/features/group.features.js');
    const { tokenFor } = await import('../src/nambikai/consent/consent.guard.js');
    const karthik = await signIn('karthik@paytm.test');

    // The token carries WALLET_LEDGER but NOT GROUP_CONTRIBUTIONS, so the
    // refusal can only be about the missing type — not about an empty token.
    await assert.rejects(
      () => extractGroupFeatures(karthik.userId, { token: tokenFor(['WALLET_LEDGER']) }),
      (err) => err.code === 'CONSENT_REQUIRED' && err.details.missing.includes('GROUP_CONTRIBUTIONS'),
      'a token without GROUP_CONTRIBUTIONS must not be able to read contributions',
    );

    // And the positive control: the same call succeeds once the type is present.
    const ok = await extractGroupFeatures(karthik.userId, {
      token: tokenFor(['GROUP_CONTRIBUTIONS']),
    });
    assert.ok(ok.dueCount > 0, 'with the right permission the extractor must work');

    await assert.rejects(
      () => extractGroupFeatures(karthik.userId, {}),
      (err) => err.code === 'CONSENT_REQUIRED',
      'no token at all must also be refused',
    );
  });

  test('the same data produces the same inputs hash', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const a = await inputsFor(karthik.token);
    const b = await inputsFor(karthik.token);
    assert.equal(a.body.inputsHash, b.body.inputsHash, 'the hash tracks data, not the clock');
  });

  test('the audit feed is readable and scoped to the caller', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await api('GET', '/nambikai/consents/audit?limit=10', { token: karthik.token });

    assert.equal(res.status, 200);
    assert.ok(res.body.events.length > 0);
    for (const event of res.body.events) {
      assert.ok(typeof event.label === 'string' && event.label.length > 10, 'plain-language label');
      assert.ok(['GRANT', 'REVOKE', 'USE', 'DENY', 'EXPIRE'].includes(event.action));
    }

    const ids = res.body.events.map((e) => e.id);
    const leaked = await prisma.consentAuditLog.count({
      where: { id: { in: ids }, subjectId: { not: karthik.userId } },
    });
    assert.equal(leaked, 0, 'the audit feed must be scoped to the caller');
  });

  test('the seed leaves the wall persona with nothing, and nobody opted into clusters', async () => {
    const arjun = await signIn('arjun@paytm.test');
    const arjunConsents = await prisma.consentRecord.count({ where: { userId: arjun.userId } });
    assert.equal(arjunConsents, 0, 'the consent-wall persona must have granted nothing');

    // Cluster scoring being opt-in is only meaningful if the seed leaves it off.
    const clusterConsents = await prisma.consentRecord.count({
      where: { dataType: 'CLUSTER_TRUST_SIGNAL', revokedAt: null },
    });
    assert.equal(clusterConsents, 0, 'cluster scoring must never be on by default');
  });
});

/* ================================================ underwriting reports ==== */

describe('underwriting reports', () => {
  const generate = (token, partnerId = 'partner_demo_nbfc') =>
    api('POST', '/nambikai/underwriting/reports', { token, body: { partnerId } });

  test('a report is generated for a partner the applicant chooses', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await generate(karthik.token);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body.report;
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(r.risk_category));
    assert.equal(r.requested_by_partner_id, 'partner_demo_nbfc');
    assert.ok(r.individual_positive_signals.length > 0);
    assert.ok(r.recommendation_text.length > 80);
    assert.ok(r.consent_ref, 'a report must name the consent it was produced under');
    assert.match(r.partner_disclaimer, /does not lend/i);
  });

  test('the risk category is the engine’s, not the prose writer’s', async () => {
    // Recompute the band independently and require the report to agree. The
    // explainer runs after this is fixed and cannot influence it.
    const karthik = await signIn('karthik@paytm.test');
    const res = await generate(karthik.token);
    const r = res.body.report;

    const { scoreUser } = await import('../src/nambikai/engine/scorecard.js');
    const { applyRules } = await import('../src/nambikai/engine/rules.js');
    const { buildUserFeatureVector } = await import('../src/nambikai/features/featureVector.js');
    const { tokenFor } = await import('../src/nambikai/consent/consent.guard.js');
    const { monthsBetween } = await import('../src/nambikai/util/window.js');

    const user = await prisma.user.findUnique({ where: { id: karthik.userId } });
    const asOf = new Date();
    const fv = await buildUserFeatureVector(karthik.userId, {
      asOf,
      token: tokenFor(['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS']),
      tenureMonths: monthsBetween(user.createdAt, asOf),
    });
    const independent = applyRules(scoreUser(fv), fv);

    assert.equal(r.risk_category, independent.band, 'the prose layer changed the risk category');
    assert.equal(r.score.value, scoreUser(fv).score);
  });

  test('cluster_signal is always present as its own key, and never merged', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const r = (await generate(karthik.token)).body.report;

    assert.ok('cluster_signal' in r, 'the key must always exist, object or null');
    assert.equal(r.cluster_signal, null, 'nobody is opted in by default');
    assert.ok(r.cluster_omission_reason, 'a null signal must say why');

    // No cluster-attributed code may appear in the individual lists.
    for (const signal of [...r.individual_positive_signals, ...r.individual_risk_signals]) {
      assert.ok(!signal.code.startsWith('CLUSTER_'), `${signal.code} leaked into individual signals`);
    }
    // And the cluster codes that do exist are tagged and non-scoring.
    const clusterCodes = r.reason_codes.filter((c) => c.attribution === 'CLUSTER');
    assert.ok(clusterCodes.length > 0);
    assert.ok(clusterCodes.every((c) => c.affects_score === false));
  });

  test('the trust graph is participation, and says so', async () => {
    const karthik = await signIn('karthik@paytm.test');
    await generate(karthik.token);

    const res = await api('GET', '/nambikai/underwriting/relationships', { token: karthik.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.relationships.length > 0, 'the hero belongs to circles and buys from a shop');
    assert.match(res.body.disclaimer, /never move your score/i);

    for (const rel of res.body.relationships) {
      assert.ok(rel.strengthPct >= 0 && rel.strengthPct <= 100);
      assert.match(rel.evidence.meaning, /not a transfer of credit risk/i);
    }

    // The decisive property: an edge exists, and the score is identical whether
    // or not the graph has been built.
    const { scoreUser } = await import('../src/nambikai/engine/scorecard.js');
    const { buildUserFeatureVector } = await import('../src/nambikai/features/featureVector.js');
    const { tokenFor } = await import('../src/nambikai/consent/consent.guard.js');
    const fv = await buildUserFeatureVector(karthik.userId, {
      token: tokenFor(['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS']),
    });
    assert.ok(!JSON.stringify(fv).includes('strengthBps'), 'the graph must not reach the scorecard');
  });

  test('you cannot request a report about somebody else', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const sreeram = await signIn('sreeram@paytm.test');
    const res = await api('POST', '/nambikai/underwriting/reports', {
      token: karthik.token,
      body: { partnerId: 'partner_demo_nbfc', applicantId: sreeram.userId },
    });
    assert.equal(res.status, 403);
  });

  test('an unknown partner is rejected', async () => {
    const karthik = await signIn('karthik@paytm.test');
    const res = await api('POST', '/nambikai/underwriting/reports', {
      token: karthik.token,
      body: { partnerId: 'partner_evil_corp' },
    });
    assert.equal(res.status, 400);
  });

  test('underwriting needs its own consent, separate from seeing your own score', async () => {
    const user = await makeUser();
    // Enough to see your own score...
    for (const dataType of ['WALLET_LEDGER', 'GROUP_CONTRIBUTIONS']) {
      await api('POST', '/nambikai/consents', {
        token: user.token,
        body: { dataType, purpose: 'HEALTH_SCORE' },
      });
    }
    assert.equal((await api('GET', '/nambikai/score', { token: user.token })).status, 200);

    // ...but not enough to send an assessment to a lender.
    const blocked = await generate(user.token);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'CONSENT_REQUIRED');
    assert.ok(blocked.body.error.details.missing.includes('BILL_PAYMENTS'));
  });

  test('a report survives consent withdrawal as a record, but becomes unusable', async () => {
    const karthik = await signIn('karthik@paytm.test');
    await generate(karthik.token);

    const list = await api('GET', '/nambikai/underwriting/reports?limit=1', { token: karthik.token });
    const id = list.body.reports[0].id;
    assert.equal(list.body.reports[0].usable, true);

    const detail = await api('GET', `/nambikai/underwriting/reports/${id}`, { token: karthik.token });
    const consentRef = detail.body.report.consent_ref;

    const consents = await api('GET', '/nambikai/consents', { token: karthik.token });
    const used = consents.body.consents.find((c) => c.id === consentRef);
    assert.ok(used, 'the report must reference a real consent record');

    await api('DELETE', `/nambikai/consents/${used.id}`, { token: karthik.token });

    const after = await api('GET', `/nambikai/underwriting/reports/${id}`, { token: karthik.token });
    assert.equal(after.status, 200, 'the record must remain readable');
    assert.equal(after.body.consentStatus, 'REVOKED');
    assert.equal(after.body.usable, false);
    assert.ok(after.body.report, 'the disclosed content is preserved as evidence');

    // Restore, so later tests in this file are unaffected.
    await api('POST', '/nambikai/consents', {
      token: karthik.token,
      body: { dataType: used.dataType, purpose: used.purpose },
    });
  });
});
