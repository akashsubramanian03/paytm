# Paytm — a local-only wallet clone

A full-stack digital wallet you can run entirely on your own machine. Sign up, get a
funded demo wallet, search people, send money, add money, recharge a phone, pay a bill,
scan a QR code and read a passbook — all backed by a real API and a real database.

> **Every rupee in this app is fake.** There is no bank, no UPI network, no card
> processor and no payment gateway anywhere in the code. All money movement is simulated
> inside a SQLite file on your disk. No Docker, no containers, no cloud services.
>
> This is an unofficial learning project that reproduces Paytm's look and flows. It is
> not affiliated with, endorsed by, or connected to One97 Communications / Paytm, and it
> is not a real payments product.

<br>

## What's inside

| | |
|---|---|
| **Frontend** | React 18 · Vite · Tailwind CSS · React Router |
| **Backend** | Node.js · Express · Zod validation · JWT + server-side sessions |
| **Database** | SQLite via Prisma ORM (a single file, no server to install) |
| **Tests** | 33 API tests on Node's built-in test runner |

`npm audit` reports **0 vulnerabilities** in both workspaces. `backend/package.json`
carries one `overrides` entry pinning `deepmerge-ts` to `^8.0.1`: the Prisma CLI ships a
version with a stack-exhaustion advisory. It is a dev-time CLI dependency that
`@prisma/client` never loads at runtime, but the patched major is pulled in anyway and
all Prisma commands were verified against it.

<br>

## Requirements

- **Node.js 20.11 or newer** (`node -v`). Node 22+ recommended.
- **npm 9+** (ships with Node).

That's the whole list. SQLite needs no installation — Prisma creates and manages a
`.db` file for you.

<br>

## Quick start

From the project root, run these four commands:

```bash
npm run install:all   # install backend + frontend dependencies
npm run env:init      # create both .env files and generate a JWT secret
npm run db:setup      # create the SQLite database and seed demo data
npm run dev           # start the API (:4000) and the web app (:5173)
```

Then open **<http://localhost:5173>**.

> `npm run setup` runs the first three steps in one go if you prefer.

### Sign in with a demo account

Every seeded user shares the password **`password123`**:

| Email | Mobile | Starting balance |
|---|---|---|
| `sreeram@paytm.test` | 9876543210 | ₹13,396.00 |
| `ananya@paytm.test` | 9812345678 | ₹11,552.00 |
| `rahul@paytm.test` | 9823456789 | ₹6,741.00 |
| `priya@paytm.test` | 9834567890 | ₹12,101.00 |
| `karthik@paytm.test` | 9845678901 | ₹7,365.00 |
| `divya@paytm.test` | 9856789012 | ₹6,250.00 |

The sign-in screen has a **Fill demo credentials** button so you don't have to type
anything. You can also create a brand new account — it starts with ₹10,000 of demo
money (configurable via `SIGNUP_BONUS_PAISE`).

<br>

## If npm blocks install scripts

npm 11 asks before running package install scripts. If you see a
`npm warn allow-scripts` message during `npm run install:all`, approve the packages that
need it and re-run the database setup:

```bash
npm --prefix backend approve-scripts @prisma/engines prisma @prisma/client
npm --prefix frontend approve-scripts esbuild fsevents
npm run db:setup
```

`esbuild` needs it to place its platform binary (Vite will not start without it).
`fsevents` is macOS file-watching — optional, but without it Vite falls back to slower
polling. Prisma 6.19 bundles its engines inside the package, so it generally works even
unapproved.

<br>

## Every command

Run all of these from the project root.

| Command | What it does |
|---|---|
| `npm run setup` | Install everything, create `.env` files, migrate and seed |
| `npm run dev` | Run API + web app together with prefixed logs (Ctrl-C stops both) |
| `npm run dev:backend` | Run only the API on <http://127.0.0.1:4000> |
| `npm run dev:frontend` | Run only the web app on <http://127.0.0.1:5173> |
| `npm test` | Run the 33 backend API tests against a throwaway database |
| `npm run db:seed` | Re-seed demo users and history (wipes existing data) |
| `npm run db:reset` | Drop the database, re-run migrations, re-seed |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Prisma Studio to browse the database in a browser |
| `npm run build` | Production build of the frontend into `frontend/dist` |

<br>

## Configuration

Nothing is hardcoded. All secrets and settings come from `.env` files, which are
generated from the checked-in `.env.example` templates and are git-ignored.

**`backend/.env`**

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./paytm.db` | SQLite file, relative to `backend/prisma/` |
| `JWT_SECRET` | *(generated)* | Signs auth tokens. **Required** — the server refuses to start without at least 32 characters |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime |
| `PORT` / `HOST` | `4000` / `127.0.0.1` | Where the API listens |
| `CORS_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed browser origins |
| `SIGNUP_BONUS_PAISE` | `1000000` | Demo money for a new wallet (₹10,000) |
| `BCRYPT_ROUNDS` | `10` | Password hashing cost |
| `MAX_TRANSFER_PAISE` | `20000000` | Per-transaction ceiling (₹2,00,000) |

**`frontend/.env`**

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://127.0.0.1:4000/api/v1` | Where the web app calls the API |
| `VITE_PORT` | `5173` | Dev server port — must appear in the backend's `CORS_ORIGIN` |
| `VITE_APP_NAME` | `Paytm` | Name shown in the UI |

<br>

## How the money is kept safe

These are the rules the backend enforces. The client is never trusted with any of them.

**Balances are integers, never floats.** Every amount is stored in *paise*
(1 rupee = 100 paise) as an `Int`. A rupee value from a request is converted with string
math, so `"1250.75"` becomes exactly `125075` — no floating point drift ever enters a
balance.

**A debit is a single conditional UPDATE.** Deducting money is one statement:

```sql
UPDATE Account SET balancePaise = balancePaise - :amount
 WHERE userId = :id AND balancePaise >= :amount
```

If that matches zero rows, the wallet did not have the money and the whole transaction
aborts. **A balance cannot go negative even if requests race** — there is no
read-then-write window to lose. `backend/tests/api.test.js` proves it by firing 8
parallel ₹100 transfers at a wallet holding exactly ₹500: exactly 5 succeed, 3 are
rejected, and the balance lands on exactly zero.

**Transfers are atomic.** A peer-to-peer payment writes four rows — debit the sender,
credit the recipient, and one passbook entry for each side — inside a single
`prisma.$transaction`. All four commit or none do. A failed transfer leaves no trace in
either passbook.

**The client never supplies a balance or a price.** Request bodies carry only *who* and
*how much*. Balances are always read fresh from the database. Recharge plan prices are
looked up from the `RechargePlan` table by id, so a tampered request pays the real price
or nothing. Bill amounts are range-checked against the biller's own limits. The tests
send decoy `balancePaise`, `amountPaise` and `status` fields and assert they are ignored.

**Passwords are hashed with bcrypt**, never stored or returned in plaintext, and no
serializer ever includes `passwordHash`. Sign-in runs a hash comparison even when the
user does not exist, so a missing account and a wrong password take similar time.

**Sessions are revocable.** The JWT carries only a user id and a session id; every
request re-checks the `Session` row. Signing out revokes it server-side, so the token
stops working immediately rather than lingering until it expires.

**Every input is validated on the server** with Zod schemas, independently of anything
the UI checks. Validated output lands on `req.valid`, and handlers read only from there.

<br>

## The passbook model

Transactions use a double-entry style ledger. Each row belongs to exactly one user, and
the two sides of a transfer share a `referenceId`:

| direction | category | userId | amount | counterparty | referenceId |
|---|---|---|---|---|---|
| `DEBIT` | `TRANSFER` | Sreeram | ₹640 | Ananya Iyer | `NBK4F2A9C31D8E0` |
| `CREDIT` | `TRANSFER` | Ananya | ₹640 | Sreeram R | `NBK4F2A9C31D8E0` |

Every row also stores `balanceAfterPaise` — what the wallet held immediately after that
entry — which is what makes the detail view read like a real passbook. The test suite
asserts that each wallet's balance always equals the sum of its own ledger, and that
every transfer reference has exactly one matching debit and credit.

<br>

## API

All routes are under `/api/v1`. Everything except sign-up and sign-in requires an
`Authorization: Bearer <token>` header.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/signup` | Create a user + funded wallet, return a token |
| `POST` | `/auth/signin` | Sign in with email **or** mobile number |
| `POST` | `/auth/signout` | Revoke the current session |
| `GET` | `/auth/me` | Current user and balance |
| `GET` | `/account/balance` | Wallet balance, read from the database |
| `POST` | `/account/add-money` | Mock top-up via card / net banking / UPI |
| `POST` | `/account/transfer` | Send money to another user |
| `GET` | `/account/limits` | Min/max transaction amounts |
| `GET` | `/users/search?q=` | Find people by name, email, mobile or UPI ID |
| `GET` | `/users/recent` | People you've paid recently |
| `POST` | `/users/resolve` | Turn a scanned QR / UPI ID / mobile into a payee |
| `GET` | `/users/me/pay-code` | The payload your own QR encodes |
| `PATCH` | `/users/me` | Update your name |
| `PATCH` | `/users/me/password` | Change password, revoke other sessions |
| `GET` | `/transactions` | Passbook, newest first, cursor-paginated + filters |
| `GET` | `/transactions/summary` | Sent/received totals for the dashboard |
| `GET` | `/transactions/:id` | One passbook entry (scoped to the owner) |
| `GET` | `/payments/operators` · `/payments/plans` | Mock recharge catalogue |
| `POST` | `/payments/recharge` | Pay for a plan (price comes from the server) |
| `GET` | `/payments/billers` | Mock biller directory |
| `POST` | `/payments/bill` | Pay a bill within the biller's limits |

### Try it with curl

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:4000/api/v1/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"sreeram@paytm.test","password":"password123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s http://127.0.0.1:4000/api/v1/account/balance -H "Authorization: Bearer $TOKEN"
```

<br>

## Tests

```bash
npm test
```

Runs 33 tests against a separate `backend/prisma/test.db` that is recreated from
migrations and re-seeded on every run, so your demo data is never touched. Coverage
includes signup/signin, password hashing, session revocation, route protection, atomic
transfers, insufficient-balance rejection, the concurrency race, client-supplied-balance
rejection, passbook scoping, server-side recharge pricing, biller range checks, and
whole-database invariants (no negative wallet, ledger matches balance, every transfer
balanced).

<br>

## Project layout

```
Paytm/
├── package.json              root scripts (setup, dev, test)
├── scripts/
│   ├── init-env.js           creates .env files + generates the JWT secret
│   └── dev.js                runs API + web together
├── backend/
│   ├── .env.example          every backend setting, documented
│   ├── prisma/
│   │   ├── schema.prisma     User, Account, Session, LedgerEntry, RechargePlan, Biller
│   │   ├── migrations/       checked-in SQL migrations
│   │   └── seed.js           demo users + 6 weeks of consistent history
│   ├── src/
│   │   ├── config.js         validated env config — the server won't boot without it
│   │   ├── app.js            express app, CORS, helmet, routes
│   │   ├── lib/
│   │   │   ├── wallet.js     >> all money movement lives here <<
│   │   │   ├── money.js      exact rupee/paise conversion
│   │   │   ├── auth.js       bcrypt + JWT + session issuing
│   │   │   ├── validators.js shared Zod schemas
│   │   │   ├── serialize.js  response shaping (never leaks passwordHash)
│   │   │   └── qr.js         pay-code building and parsing
│   │   ├── middleware/       auth guard, validation, error handling
│   │   └── routes/           auth, user, account, transaction, payment
│   └── tests/api.test.js     end-to-end API tests
└── frontend/
    ├── .env.example
    ├── tailwind.config.js    the Paytm-style design tokens
    └── src/
        ├── lib/              API client, formatters, hooks
        ├── context/          auth + toast notifications
        ├── components/       layout, nav, passbook row, primitives
        └── pages/            13 screens
```

<br>

## Screens

Sign in · Sign up · Dashboard (balance card, quick actions, pay-again, services,
recent activity) · Send money (search) · Pay (amount + note) · Add money (mock card /
net banking / UPI) · Mobile recharge (operators, plan tabs, confirm sheet) · Bill
payments (6 categories) · Passbook (day-grouped, filterable, paginated) · Transaction
detail (passbook-style) · Scan & pay (camera + manual entry) · Profile (QR code, edit
name, change password) · Payment success.

The UI is mobile-first and matches Paytm's visual language — navy `#012B72` and cyan
`#00B9F1`, a blue gradient app bar, white cards on a light field, four-across icon
grids, and the elevated scan button in the tab bar. On a desktop browser it stays a
centred phone-width column.

<br>

## Troubleshooting

**`JWT_SECRET must be at least 32 characters`** — run `npm run env:init`, or paste a
secret into `backend/.env` generated with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**`Can't reach the Paytm API`** in the browser — the backend isn't running. Start it
with `npm run dev:backend` and check <http://127.0.0.1:4000/health>.

**CORS errors** — the browser origin must be listed in `CORS_ORIGIN` in `backend/.env`.
If you changed `VITE_PORT`, add the new origin there too.

**Port already in use** — change `PORT` in `backend/.env` (then update
`VITE_API_BASE_URL`), or `VITE_PORT` in `frontend/.env` (then update `CORS_ORIGIN`).

**`SQLite database error: database is locked`** — a running API server is holding the
database file. Migrations need exclusive access, so stop `npm run dev` (Ctrl-C) before
running `db:setup`, `db:migrate` or `db:reset`. If a server was killed without shutting
down cleanly, clear any stragglers first:

```bash
pkill -f 'scripts/dev.js'; pkill -f 'src/index.js'; pkill -f vite
```

**Want a clean slate** — `npm run db:reset` drops the database, re-applies migrations
and re-seeds the demo data.

**Camera doesn't work on the Scan screen** — browsers only allow camera access on
`localhost` or HTTPS, and you must accept the permission prompt. The manual code entry
below the viewfinder always works: paste a pay code, or type a UPI ID like
`priya.nair@paytm`, a registered mobile number, or an email.

<br>

## Scope

This is a learning/demo project. It deliberately does **not** integrate any real payment
rail, and it shouldn't be deployed as a real financial service. Things a production
wallet would add: KYC, two-factor authentication, idempotency keys on payment requests,
an append-only audit log, per-user rate limits on transfers, refunds and reversals,
statement exports, and a database that handles concurrent writes better than SQLite.
