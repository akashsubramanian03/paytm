/**
 * End-to-end API tests. Runs against a throwaway SQLite database
 * (backend/prisma/test.db) so the demo data is never touched.
 *
 *   npm test
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Point everything at the test database BEFORE the app/config/prisma load.
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

  // stdio is piped so a clean run stays quiet, but on failure the child's output
  // is re-printed. Without this a seed that throws (e.g. the negative-balance
  // guard) fails every test in the suite with an opaque execFileSync error and
  // no indication of the actual cause.
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

/** Thin fetch wrapper returning { status, body }. */
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

let counter = 0;
/** Registers a fresh user and returns { token, user, account }. */
async function makeUser(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  const res = await api('POST', '/auth/signup', {
    body: {
      firstName: 'Test',
      lastName: 'User',
      email: `test.user${n}.${Date.now()}@example.com`,
      phone: `9${String(700000000 + counter * 137 + (Date.now() % 100000)).slice(0, 9)}`,
      password: 'password123',
      ...overrides,
    },
  });
  assert.equal(res.status, 201, `signup failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

const balanceOf = async (userId) =>
  (await prisma.account.findUnique({ where: { userId } })).balancePaise;

// ---------------------------------------------------------------------------

describe('auth', () => {
  test('signup creates a user, a funded wallet and a welcome passbook entry', async () => {
    const out = await makeUser();
    assert.ok(out.token);
    assert.equal(out.account.balancePaise, 1_000_000);
    assert.match(out.user.upiId, /@paytm$/);

    const entries = await prisma.ledgerEntry.findMany({ where: { userId: out.user.id } });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].direction, 'CREDIT');
    assert.equal(entries[0].balanceAfterPaise, 1_000_000);
  });

  test('password is hashed, never stored or returned in plaintext', async () => {
    const out = await makeUser();
    const row = await prisma.user.findUnique({ where: { id: out.user.id } });
    assert.notEqual(row.passwordHash, 'password123');
    assert.match(row.passwordHash, /^\$2[aby]\$/);
    assert.ok(!JSON.stringify(out).includes('password123'));
    assert.ok(!JSON.stringify(out).includes('passwordHash'));
  });

  test('rejects weak passwords, bad emails and bad phone numbers', async () => {
    for (const bad of [
      { password: 'short' },
      { password: 'alllettersnodigits' },
      { email: 'not-an-email' },
      { phone: '12345' },
      { phone: '1234567890' },
      { firstName: '' },
    ]) {
      const res = await api('POST', '/auth/signup', {
        body: {
          firstName: 'A', lastName: 'B', email: `x${Date.now()}${Math.random()}@e.com`,
          phone: '9876500001', password: 'password123', ...bad,
        },
      });
      assert.equal(res.status, 400, `expected rejection for ${JSON.stringify(bad)}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  test('duplicate email and duplicate phone are rejected with 409', async () => {
    const first = await makeUser();
    const dupEmail = await api('POST', '/auth/signup', {
      body: { firstName: 'Dup', lastName: 'Two', email: first.user.email, phone: '9876500123', password: 'password123' },
    });
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.body.error.code, 'EMAIL_TAKEN');

    const dupPhone = await api('POST', '/auth/signup', {
      body: { firstName: 'Dup', lastName: 'Three', email: `other${Date.now()}@e.com`, phone: first.user.phone, password: 'password123' },
    });
    assert.equal(dupPhone.status, 409);
    assert.equal(dupPhone.body.error.code, 'PHONE_TAKEN');
  });

  test('signs in by email or phone, and rejects a wrong password', async () => {
    const created = await makeUser();
    for (const identifier of [created.user.email, created.user.phone]) {
      const res = await api('POST', '/auth/signin', { body: { identifier, password: 'password123' } });
      assert.equal(res.status, 200);
      assert.ok(res.body.token);
    }
    const bad = await api('POST', '/auth/signin', {
      body: { identifier: created.user.email, password: 'wrongpassword1' },
    });
    assert.equal(bad.status, 401);
  });

  test('signing out revokes the token server-side', async () => {
    const { token } = await makeUser();
    assert.equal((await api('GET', '/auth/me', { token })).status, 200);
    assert.equal((await api('POST', '/auth/signout', { token })).status, 200);
    assert.equal((await api('GET', '/auth/me', { token })).status, 401);
  });
});

describe('protected routes', () => {
  const guarded = [
    ['GET', '/auth/me'], ['GET', '/account/balance'], ['POST', '/account/transfer'],
    ['POST', '/account/add-money'], ['GET', '/transactions'], ['GET', '/users/search'],
    ['GET', '/payments/plans'], ['POST', '/payments/recharge'],
  ];

  test('every account/transaction route requires a valid token', async () => {
    for (const [method, url] of guarded) {
      const none = await api(method, url, { body: method === 'POST' ? {} : undefined });
      assert.equal(none.status, 401, `${method} ${url} allowed an anonymous request`);

      const bogus = await api(method, url, { token: 'not.a.real.token', body: method === 'POST' ? {} : undefined });
      assert.equal(bogus.status, 401, `${method} ${url} accepted a forged token`);
    }
  });
});

describe('transfers', () => {
  test('moves money atomically and writes two linked passbook rows', async () => {
    const sender = await makeUser();
    const recipient = await makeUser();

    const res = await api('POST', '/account/transfer', {
      token: sender.token,
      body: { toUserId: recipient.user.id, amount: '250.50', note: 'Test payment' },
    });
    assert.equal(res.status, 201);

    assert.equal(await balanceOf(sender.user.id), 1_000_000 - 25_050);
    assert.equal(await balanceOf(recipient.user.id), 1_000_000 + 25_050);

    const legs = await prisma.ledgerEntry.findMany({
      where: { referenceId: res.body.transaction.referenceId },
    });
    assert.equal(legs.length, 2);
    assert.deepEqual(legs.map((l) => l.direction).sort(), ['CREDIT', 'DEBIT']);
    assert.ok(legs.every((l) => l.amountPaise === 25_050));

    const debitLeg = legs.find((l) => l.direction === 'DEBIT');
    assert.equal(debitLeg.balanceAfterPaise, 1_000_000 - 25_050);
  });

  test('rejects a transfer larger than the balance and leaves both wallets untouched', async () => {
    const sender = await makeUser();
    const recipient = await makeUser();
    const before = [await balanceOf(sender.user.id), await balanceOf(recipient.user.id)];

    const res = await api('POST', '/account/transfer', {
      token: sender.token,
      body: { toUserId: recipient.user.id, amount: '99999' },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');

    assert.deepEqual([await balanceOf(sender.user.id), await balanceOf(recipient.user.id)], before);
    const rows = await prisma.ledgerEntry.count({
      where: { userId: sender.user.id, category: 'TRANSFER' },
    });
    assert.equal(rows, 0, 'a failed transfer must not write a passbook row');
  });

  test('rejects self-transfer, zero, negative and malformed amounts', async () => {
    const sender = await makeUser();
    const recipient = await makeUser();

    const self = await api('POST', '/account/transfer', {
      token: sender.token, body: { toUserId: sender.user.id, amount: '10' },
    });
    assert.equal(self.status, 400);
    assert.equal(self.body.error.code, 'SELF_TRANSFER');

    for (const amount of ['0', '-100', 'abc', '10.999', '', null, '1e5', '0.001']) {
      const res = await api('POST', '/account/transfer', {
        token: sender.token, body: { toUserId: recipient.user.id, amount },
      });
      assert.ok(res.status === 400, `amount ${JSON.stringify(amount)} was not rejected (got ${res.status})`);
    }
    assert.equal(await balanceOf(sender.user.id), 1_000_000);
  });

  test('a balance sent by the client is ignored', async () => {
    const sender = await makeUser();
    const recipient = await makeUser();

    const res = await api('POST', '/account/transfer', {
      token: sender.token,
      body: {
        toUserId: recipient.user.id,
        amount: '100',
        // All of these are attempts to dictate state from the client.
        balancePaise: 99_999_999,
        balance: 999999,
        senderId: recipient.user.id,
        status: 'FAILED',
        amountPaise: 1,
      },
    });
    assert.equal(res.status, 201);
    assert.equal(await balanceOf(sender.user.id), 1_000_000 - 10_000);
    assert.equal(await balanceOf(recipient.user.id), 1_000_000 + 10_000);
    assert.equal(res.body.transaction.status, 'SUCCESS');
  });

  test('concurrent transfers cannot overdraw the wallet', async () => {
    const sender = await makeUser();
    const recipient = await makeUser();

    // Drain to exactly Rs 500.00, then fire 8 parallel Rs 100 transfers.
    // Only 5 can succeed and the balance must land on exactly zero.
    await api('POST', '/account/transfer', {
      token: sender.token, body: { toUserId: recipient.user.id, amount: '9500' },
    });
    assert.equal(await balanceOf(sender.user.id), 50_000);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        api('POST', '/account/transfer', {
          token: sender.token, body: { toUserId: recipient.user.id, amount: '100' },
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.body?.error?.code === 'INSUFFICIENT_BALANCE').length;

    assert.equal(ok, 5, `expected exactly 5 successes, got ${ok}`);
    assert.equal(rejected, 3, `expected 3 insufficient-balance rejections, got ${rejected}`);

    const finalBalance = await balanceOf(sender.user.id);
    assert.equal(finalBalance, 0);
    assert.ok(finalBalance >= 0, 'balance went negative');

    // Ledger must agree with the account row.
    const entries = await prisma.ledgerEntry.findMany({ where: { userId: sender.user.id } });
    const net = entries.reduce(
      (sum, e) => sum + (e.direction === 'CREDIT' ? e.amountPaise : -e.amountPaise), 0,
    );
    assert.equal(net, finalBalance);
  });
});

describe('add money (mock)', () => {
  test('credits the wallet and records a passbook row without any gateway', async () => {
    const user = await makeUser();
    const res = await api('POST', '/account/add-money', {
      token: user.token,
      body: { amount: '1500', method: 'CARD', cardNumber: '4111111111111111' },
    });
    assert.equal(res.status, 201);
    assert.equal(await balanceOf(user.user.id), 1_000_000 + 150_000);
    assert.equal(res.body.transaction.counterparty.handle, 'XXXX XXXX XXXX 1111');
    // The full card number must never be persisted.
    const entry = await prisma.ledgerEntry.findFirst({
      where: { userId: user.user.id, category: 'ADD_MONEY', direction: 'CREDIT' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(!JSON.stringify(entry).includes('4111111111111111'));
    assert.equal(JSON.parse(entry.metadata).simulated, true);
  });

  test('requires the details matching the chosen method', async () => {
    const user = await makeUser();
    const res = await api('POST', '/account/add-money', {
      token: user.token, body: { amount: '100', method: 'CARD' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'CARD_REQUIRED');
  });
});

describe('user search and pay codes', () => {
  test('finds seeded users by name and by email, never including yourself', async () => {
    const me = await makeUser();

    const byName = await api('GET', '/users/search?q=Ananya', { token: me.token });
    assert.equal(byName.status, 200);
    assert.ok(byName.body.users.some((u) => u.name === 'Ananya Iyer'));

    const byEmail = await api('GET', '/users/search?q=rahul@paytm.test', { token: me.token });
    assert.ok(byEmail.body.users.some((u) => u.name === 'Rahul Menon'));

    const all = await api('GET', '/users/search?q=', { token: me.token });
    assert.ok(!all.body.users.some((u) => u.id === me.user.id), 'search returned the caller');
    // Contact details are masked and no password material is exposed.
    assert.ok(all.body.users.every((u) => u.maskedEmail.includes('*')));
    assert.ok(!JSON.stringify(all.body).includes('passwordHash'));
  });

  test('resolves a scanned pay code, a UPI ID and a mobile number', async () => {
    const me = await makeUser();
    const target = await prisma.user.findUnique({ where: { email: 'priya@paytm.test' } });

    for (const code of [
      `paytm://pay?vpa=${target.upiId}&pn=Priya%20Nair&uid=${target.id}`,
      target.upiId,
      target.phone,
    ]) {
      const res = await api('POST', '/users/resolve', { token: me.token, body: { code } });
      assert.equal(res.status, 200, `failed to resolve ${code}`);
      assert.equal(res.body.user.id, target.id);
    }

    const junk = await api('POST', '/users/resolve', { token: me.token, body: { code: '@@@@' } });
    assert.equal(junk.status, 400);
  });

  test('exposes the caller own pay payload', async () => {
    const me = await makeUser();
    const res = await api('GET', '/users/me/pay-code', { token: me.token });
    assert.equal(res.status, 200);
    assert.ok(res.body.payload.startsWith('paytm://pay?'));
    assert.ok(res.body.payload.includes(encodeURIComponent(me.user.upiId).replace(/%40/g, '%40')));
  });
});

describe('transaction history', () => {
  test('lists only the caller transactions, newest first', async () => {
    const a = await makeUser();
    const b = await makeUser();
    for (const amount of ['10', '20', '30']) {
      await api('POST', '/account/transfer', { token: a.token, body: { toUserId: b.user.id, amount } });
    }

    const res = await api('GET', '/transactions?limit=50', { token: a.token });
    assert.equal(res.status, 200);
    const times = res.body.transactions.map((t) => new Date(t.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((x, y) => y - x), 'not newest-first');

    const ids = new Set(res.body.transactions.map((t) => t.id));
    const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: [...ids] } } });
    assert.ok(rows.every((r) => r.userId === a.user.id), 'history leaked another user rows');
  });

  test('detail view is scoped to the owner', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const transfer = await api('POST', '/account/transfer', {
      token: a.token, body: { toUserId: b.user.id, amount: '55' },
    });
    const id = transfer.body.transaction.id;

    const mine = await api('GET', `/transactions/${id}`, { token: a.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.transaction.amountFormatted, '₹55.00');

    const theirs = await api('GET', `/transactions/${id}`, { token: b.token });
    assert.equal(theirs.status, 404, 'another user could read this transaction');
  });

  test('filters by direction and category and paginates', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await api('POST', '/account/transfer', { token: a.token, body: { toUserId: b.user.id, amount: '11' } });

    const debits = await api('GET', '/transactions?direction=DEBIT', { token: a.token });
    assert.ok(debits.body.transactions.every((t) => t.direction === 'DEBIT'));

    const page = await api('GET', '/transactions?limit=1', { token: a.token });
    assert.equal(page.body.transactions.length, 1);
    assert.ok(page.body.hasMore);
    assert.ok(page.body.nextCursor);

    const next = await api(`GET`, `/transactions?limit=1&cursor=${page.body.nextCursor}`, { token: a.token });
    assert.notEqual(next.body.transactions[0].id, page.body.transactions[0].id);
  });

  test('summary totals match the ledger', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await api('POST', '/account/transfer', { token: a.token, body: { toUserId: b.user.id, amount: '42' } });

    const res = await api('GET', '/transactions/summary?days=365', { token: a.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.sentPaise, 4200);
    assert.equal(res.body.receivedPaise, 1_000_000); // the welcome bonus
  });
});

describe('recharge and bills (mock)', () => {
  test('charges the plan price from the server, ignoring any amount in the body', async () => {
    const user = await makeUser();
    const plans = await api('GET', '/payments/plans?operator=Jio', { token: user.token });
    assert.equal(plans.status, 200);
    const plan = plans.body.plans.find((p) => p.price === 349);
    assert.ok(plan, 'expected the seeded Jio 349 plan');

    const res = await api('POST', '/payments/recharge', {
      token: user.token,
      // amount/price here are decoys — the server must use the plan record.
      body: { planId: plan.id, mobileNumber: '9876543210', amount: '1', pricePaise: 1 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.amountPaise, 34_900);
    assert.equal(await balanceOf(user.user.id), 1_000_000 - 34_900);
    assert.equal(res.body.transaction.category, 'RECHARGE');
  });

  test('rejects an unknown plan and an invalid mobile number', async () => {
    const user = await makeUser();
    const unknown = await api('POST', '/payments/recharge', {
      token: user.token, body: { planId: 'cxxxxxxxxxxxxxxxxxxxxxxx', mobileNumber: '9876543210' },
    });
    assert.equal(unknown.status, 404);

    const plans = await api('GET', '/payments/plans', { token: user.token });
    const badPhone = await api('POST', '/payments/recharge', {
      token: user.token, body: { planId: plans.body.plans[0].id, mobileNumber: '12345' },
    });
    assert.equal(badPhone.status, 400);
  });

  test('bill payment enforces the biller amount range', async () => {
    const user = await makeUser();
    const billers = await api('GET', '/payments/billers?category=DTH', { token: user.token });
    const biller = billers.body.billers[0];

    const tooSmall = await api('POST', '/payments/bill', {
      token: user.token, body: { billerId: biller.id, consumerNumber: 'ABC12345', amount: '1' },
    });
    assert.equal(tooSmall.status, 400);
    assert.equal(tooSmall.body.error.code, 'AMOUNT_OUT_OF_RANGE');

    const ok = await api('POST', '/payments/bill', {
      token: user.token, body: { billerId: biller.id, consumerNumber: 'ABC12345', amount: '450' },
    });
    assert.equal(ok.status, 201);
    assert.equal(await balanceOf(user.user.id), 1_000_000 - 45_000);
  });

  test('a recharge that exceeds the balance is rejected and changes nothing', async () => {
    const user = await makeUser();
    const other = await makeUser();
    await api('POST', '/account/transfer', { token: user.token, body: { toUserId: other.user.id, amount: '9999' } });
    assert.equal(await balanceOf(user.user.id), 100);

    const plans = await api('GET', '/payments/plans?operator=Airtel', { token: user.token });
    const plan = plans.body.plans.find((p) => p.price === 299);
    const res = await api('POST', '/payments/recharge', {
      token: user.token, body: { planId: plan.id, mobileNumber: '9876543210' },
    });
    assert.equal(res.status, 422);
    assert.equal(await balanceOf(user.user.id), 100);
  });
});

describe('profile', () => {
  test('updates the display name', async () => {
    const user = await makeUser();
    const res = await api('PATCH', '/users/me', {
      token: user.token, body: { firstName: 'Renamed', lastName: 'Person' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Renamed Person');
    assert.equal(res.body.user.initials, 'RP');
  });

  test('rejects an invalid name', async () => {
    const user = await makeUser();
    const res = await api('PATCH', '/users/me', { token: user.token, body: { firstName: '<script>' } });
    assert.equal(res.status, 400);
  });

  test('changing the password re-hashes it and revokes other sessions', async () => {
    const user = await makeUser();
    const second = await api('POST', '/auth/signin', {
      body: { identifier: user.user.email, password: 'password123' },
    });
    const otherToken = second.body.token;

    const res = await api('PATCH', '/users/me/password', {
      token: user.token, body: { currentPassword: 'password123', newPassword: 'newpassword456' },
    });
    assert.equal(res.status, 200);

    // The session that made the change survives; the other one does not.
    assert.equal((await api('GET', '/auth/me', { token: user.token })).status, 200);
    assert.equal((await api('GET', '/auth/me', { token: otherToken })).status, 401);

    assert.equal(
      (await api('POST', '/auth/signin', { body: { identifier: user.user.email, password: 'password123' } })).status,
      401,
    );
    assert.equal(
      (await api('POST', '/auth/signin', { body: { identifier: user.user.email, password: 'newpassword456' } })).status,
      200,
    );
  });

  test('rejects a wrong current password', async () => {
    const user = await makeUser();
    const res = await api('PATCH', '/users/me/password', {
      token: user.token, body: { currentPassword: 'nope12345', newPassword: 'newpassword456' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'WRONG_PASSWORD');
  });
});

describe('system invariants', () => {
  test('no wallet in the database is ever negative', async () => {
    const accounts = await prisma.account.findMany();
    assert.ok(accounts.length > 0);
    for (const a of accounts) assert.ok(a.balancePaise >= 0, `wallet ${a.id} is negative`);
  });

  test('every wallet balance equals the sum of its ledger', async () => {
    const accounts = await prisma.account.findMany();
    for (const account of accounts) {
      const entries = await prisma.ledgerEntry.findMany({ where: { userId: account.userId } });
      const net = entries.reduce(
        (sum, e) => sum + (e.direction === 'CREDIT' ? e.amountPaise : -e.amountPaise), 0,
      );
      assert.equal(net, account.balancePaise, `ledger drift on wallet ${account.id}`);
    }
  });

  test('every transfer has exactly one matching debit and credit', async () => {
    const legs = await prisma.ledgerEntry.findMany({ where: { category: 'TRANSFER' } });
    const byRef = new Map();
    for (const leg of legs) {
      byRef.set(leg.referenceId, [...(byRef.get(leg.referenceId) ?? []), leg]);
    }
    for (const [ref, pair] of byRef) {
      assert.equal(pair.length, 2, `reference ${ref} has ${pair.length} legs`);
      const debit = pair.find((p) => p.direction === 'DEBIT');
      const credit = pair.find((p) => p.direction === 'CREDIT');
      assert.ok(debit && credit, `reference ${ref} is not a debit/credit pair`);
      assert.equal(debit.amountPaise, credit.amountPaise);
    }
  });

  test('unknown routes return a JSON 404', async () => {
    const res = await api('GET', '/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });
});
