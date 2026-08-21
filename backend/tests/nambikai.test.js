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
      name: 'Anna Nagar Vendors Chit',
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
    name: 'Besant Nagar Savers',
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
