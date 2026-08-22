# Nambikai — the complete reference

**நம்பிக்கை** — Tamil for *trust*, and for the confidence to extend it.

A credit-underwriting and lending layer built on top of a local-only Paytm wallet
clone. It scores people who have no credit-bureau file — tea-stall owners, gig
workers, chit-fund members — from behaviour they already generate, and explains
every point of the score in words a borrower can act on.

| | |
|---|---|
| **Stack** | Node 20+ · Express 4 · Prisma 6 + SQLite · Zod 3 · JWT + server-side sessions · React 18 · Vite 6 · Tailwind 3 |
| **Size** | ~20,000 lines · 25 database tables · 77 API endpoints · 3 migrations |
| **Tests** | 237, on Node's built-in runner |
| **Demo data** | 10 personas · 18 months · 8,501 ledger rows · 223 contributions · 3 loans |
| **External services** | None required. OpenAI is optional and changes only prose |

> **Every rupee here is simulated.** No bank, no UPI network, no card processor,
> no payment gateway. This is an unofficial learning project, not affiliated
> with One97 Communications / Paytm.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [The three invariants](#2-the-three-invariants)
3. [Architecture](#3-architecture)
4. [Layer 1 — the wallet](#4-layer-1--the-wallet)
5. [Layer 2 — savings circles](#5-layer-2--savings-circles)
6. [Layer 3 — consent](#6-layer-3--consent)
7. [Layer 4 — the behaviour engine](#7-layer-4--the-behaviour-engine)
8. [Layer 5 — the cluster signal](#8-layer-5--the-cluster-signal)
9. [Layer 6 — lending](#9-layer-6--lending)
10. [Layer 7 — the SME slice](#10-layer-7--the-sme-slice)
11. [The AI layer](#11-the-ai-layer)
12. [Account Aggregator and OCEN](#12-account-aggregator-and-ocen)
13. [Data model](#13-data-model)
14. [API reference](#14-api-reference)
15. [The seed](#15-the-seed)
16. [Tests](#16-tests)
17. [Running it](#17-running-it)
18. [What is not real](#18-what-is-not-real)

---

## 1. The problem

Roughly 400 million Indians have no credit-bureau file. Not a bad one — *none*.
A bureau score answers "has this person handled formal credit before?", and for
them the answer is no, which ends the conversation. They are not risky; they are
invisible.

But they are not behaviourally silent. A tea-stall owner takes hundreds of small
UPI payments a month. A chit-fund member has paid the same amount on the same day
for four years. That is a credit history. Nobody has ever written it down.

Nambikai answers a different question — **"does this person's money behave
reliably?"** — from data they already generate, and it is the only one of the two
that tells you what to do next.

---

## 2. The three invariants

Everything else is negotiable. These are not, and each is enforced by a test that
fails the build.

### One module moves money

`backend/src/lib/wallet.js` is the only code permitted to write a ledger row.
Every transfer, top-up, bill, recharge, loan disbursement and EMI goes through it.

```js
// backend/tests/nambikai.test.js — greps the entire nambikai tree
assert.deepEqual(offenders, [], 'nothing under src/nambikai/ may write a ledger row');
```

Alongside it, three whole-database invariants are re-asserted after every suite:

- No wallet balance is ever negative.
- Every balance equals the sum of its own ledger.
- Every `TRANSFER` referenceId has exactly one DEBIT and one CREDIT of equal amount.

Money is stored as **integer paise** throughout. There is not a floating-point
rupee anywhere in the codebase.

### The engine is pure

Everything under `backend/src/nambikai/engine/` is a pure function. A test reads
each file **as text** and fails on `db.js`, `@prisma/client`, `Date.now()`,
`new Date()` or `Math.random()`.

```js
// backend/tests/nambikai.engine.test.js
for (const file of fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'))) { … }
assert.deepEqual(offenders, [], 'engine/ must stay pure and reproducible');
```

Time enters as an `asOf` parameter threaded from the route. The consequence: the
same inputs always produce the same score, on any machine, at any time.

### The model cannot originate a number

The score comes from `engine/scorecard.js` → `engine/rules.js`, and nothing
downstream may change it. The language model is called **after** the score, the
band and the gates already exist. It is handed the result and asked to describe
it — it cannot alter any of it, not because it is instructed not to, but because
by the time it runs there is nothing left to change.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React 18 · Vite · Tailwind          frontend/src/           │
│  32 routes · 19 Nambikai screens                             │
└───────────────────────────┬──────────────────────────────────┘
                            │  JSON over HTTP, Bearer token
┌───────────────────────────▼──────────────────────────────────┐
│  Express 4 · Zod validation · JWT + server-side sessions     │
│  backend/src/routes/                                         │
└───────────────────────────┬──────────────────────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
┌───────▼─────────┐                   ┌─────────▼──────────────┐
│  lib/wallet.js  │                   │  nambikai/             │
│  the ONLY money │                   │                        │
│  mover          │                   │  consent/  ← the gate  │
└───────┬─────────┘                   │  features/ ← extract   │
        │                             │  engine/   ← PURE      │
        │                             │  pipeline/ ← orchestr. │
        │                             │  ai/       ← prose     │
        │                             └─────────┬──────────────┘
        │                                       │
┌───────▼───────────────────────────────────────▼──────────────┐
│  Prisma 6 → SQLite (WAL)          25 tables · 3 migrations   │
└──────────────────────────────────────────────────────────────┘
```

### The pipeline, in order

The order is the guarantee. By the time the explainer runs, the number is fixed.

```
consent gate → feature extraction → scorecard → rules/gates → persist → explain
```

| Directory | Role | Pure? |
|---|---|---|
| `consent/` | The gate. Nothing is read without a live consent record | no (DB) |
| `features/` | Turn raw rows into derived percentages and counts | no (DB) |
| `engine/` | Score, band, gates, affordability, cash-flow, what-if | **yes** |
| `pipeline/` | Orchestration and persistence | no (DB) |
| `ai/` | Prose over an already-decided result | no (network) |

---

## 4. Layer 1 — the wallet

A working Paytm clone, and the substrate everything else measures.

| Feature | Detail |
|---|---|
| **Send money** | By UPI ID, phone, name search, or scanned QR pay code |
| **Add money** | Mock card or bank; no gateway involved |
| **Mobile recharge** | 38 seeded plans across operators and circles |
| **Bill payment** | 10 billers — electricity, water, broadband, DTH, gas |
| **Passbook** | Cursor-paginated, filterable by direction, category and free text |
| **Pay code** | A scannable QR another signed-in account can pay |
| **Profile** | Edit name, change password (revokes every other session) |

### The ledger model

Double-entry. A transfer writes **two** rows sharing a `referenceId` — one DEBIT
on the sender, one CREDIT on the recipient — each carrying `balanceAfterPaise`, so
the passbook is a true running balance rather than a recomputation.

Disbursement and repayment are deliberately **single-leg** (the counterparty is a
simulated partner, not a wallet), which is why they do not disturb the
"every transfer is balanced" invariant.

Six ledger categories: `TRANSFER`, `ADD_MONEY`, `RECHARGE`, `BILL_PAYMENT`,
`LOAN_DISBURSEMENT`, `LOAN_REPAYMENT`.

### Concurrency

`payGroupContribution` and `repayLoanInstallment` both use a conditional
`updateMany` as a reentrancy guard:

```js
const marked = await tx.loanInstallment.updateMany({
  where: { id: installmentId, status: { in: PAYABLE_INSTALLMENT_STATUSES } },
  data: { status: 'PAID', … },
});
if (marked.count !== 1) throw ApiError.conflict('INSTALLMENT_ALREADY_PAID', …);
```

A test fires **four concurrent taps** at one instalment and asserts exactly one
payment lands.

---

## 5. Layer 2 — savings circles

A chit fund, modelled properly. Members contribute a fixed amount each cycle; one
member takes the pot each cycle in rotation. It is the inverse of a bill-splitting
app — you pay *in*, and periodically you take *out*.

**Nambikai never holds the pot.** Contributions are ordinary wallet transfers
between members, which is why the money invariants still hold over a circle.

### Three purposes

| Purpose | Cadence | What it models |
|---|---|---|
| `ROTATING_SAVINGS` | Monthly | A classic chit — everyone pays, one collects |
| `SAVINGS` | Weekly | A savings circle where the admin collects |
| `BUSINESS_POOL` | Monthly | A traders' pool |

### Three rules that make it a credit signal

**Cycles close permanently.** A missed cycle stays `MISSED`. You cannot repair
your record by paying late. This is the single most important design decision in
the layer — without it, the history is a to-do list rather than evidence.

**On-time percentage counts settled cycles only.** A cycle not yet due is not
held against you. (This was a real bug: the hero persona showed 93% instead of
100% because unsettled cycles counted as failures.)

**Circle money is not spending.** Contributions out and payouts in are tracked
separately from everyday flows in `features/ledger.features.js`. Without this,
saving diligently read as reckless spending — and fixing it moved the hero from
78/GOOD to 83/STRONG.

---

## 6. Layer 3 — consent

Nothing about a person is read without a live consent record naming **both** the
data type and the purpose.

### Nine data types × five purposes

```
DATA_TYPE   WALLET_LEDGER · GROUP_CONTRIBUTIONS · BILL_PAYMENTS · RECHARGE_HISTORY
            CLUSTER_TRUST_SIGNAL · BUSINESS_GST · BUSINESS_INVOICES
            LOAN_HISTORY · REPAYMENT_HISTORY

PURPOSE     HEALTH_SCORE · UNDERWRITING · ASSISTANT · SME_UNDERWRITING · LOAN_SERVICING
```

Each purpose declares its required data types in `REQUIRED_CONSENTS`. A missing
one produces a **403 naming exactly what is absent**, not a blank screen.

### The gate is in the data layer

This is the part that matters. The check is not middleware — feature extractors
re-assert against a consent token immediately before they query:

```js
assertDataType(token, DATA_TYPE.GROUP_CONTRIBUTIONS);
```

There is no route that skips the check by taking a different path, because the
check lives next to the query rather than in front of the handler.

### The audit log records reads, not permissions

| Action | Written when |
|---|---|
| `GRANT` | A permission is given |
| `REVOKE` | A permission is withdrawn |
| `USE` | Data was **actually read** — with the artifact it fed |
| `DENY` | A read was **blocked** — a refusal is as auditable as a use |
| `EXPIRE` | A permission lapsed |

Granting access to your loan history and never having it read produces **no USE
row**. That distinction is what makes the log worth anything.

### Revocation does not delete history

A revoked consent leaves existing scores and reports in place — they are the
record of what was disclosed — but marks them **unusable**. Deleting them would
destroy the audit story.

---

## 7. Layer 4 — the behaviour engine

### Seven categories

Weights are basis points summing to exactly **10000**. No floats, no drift.

| Category | Weight | What it measures |
|---|---:|---|
| `INCOME_STABILITY` | 1700 | Regularity and floor of inflows — not their size |
| `SAVINGS_CONSISTENCY` | 1700 | Whether a surplus survives the month |
| `PAYMENT_BEHAVIOUR` | 1700 | Bills and recharges paid without prompting |
| `COMMITMENTS` | 1600 | Circle record — on time, late, missed |
| `REPAYMENT_TRACK_RECORD` | 1500 | EMIs paid, weighted toward recent ones |
| `CREDIT_HISTORY` | 1000 | Depth of observable history |
| `EMERGENCY_BUFFER` | 800 | Days of expenses the balance would cover |

Output: **0–100**, with a grade and a risk band.

```
GRADE   STRONG ≥ 80 · GOOD ≥ 60 · FAIR ≥ 40 · BUILDING < 40
BAND    LOW ≥ 70 · MEDIUM ≥ 45 · HIGH < 45
```

### Weight redistribution — absence is not a penalty

If a category has no data to measure (`sampleCount: 0`), its weight is
redistributed **pro-rata** across the categories that do. A person with no circle
history is not scored zero on commitments; that category simply does not apply to
them, and a `WEIGHT_REDISTRIBUTED` reason code says so.

```js
// backend/src/nambikai/util/stats.js
export function redistributeWeights(measured, weights) { … }
```

### The insufficient-data gate — absence is not a reward either

The mirror problem is subtler and was a real bug. An unregistered tea stall with
almost no business data scored **88 / STRONG** on two measured categories out of
six, because redistribution handed all the weight to the two things that happened
to look good.

`GATE_SME_INSUFFICIENT_DATA` now requires **at least three measured categories**
before a score is issued.

### Nine gates, which can only make things worse

| Gate | Effect |
|---|---|
| `GATE_INSUFFICIENT_HISTORY` | Not enough months observed |
| `GATE_DORMANT` | The wallet has gone quiet |
| `GATE_MISSED_COMMITMENTS` | Circle misses floor the band |
| `GATE_NEGATIVE_TREND` | Behaviour is deteriorating |
| `GATE_ACTIVE_DELINQUENCY` | >30 DPD floors MEDIUM; >90 floors HIGH |
| `GATE_OVER_OBLIGATED` | Commitments already exceed the FOIR band |
| `GATE_SME_INSUFFICIENT_DATA` | Fewer than three measured categories |
| `GATE_SME_OVERLEVERAGED` | Business debt load too high |
| `GATE_SME_GST_LAPSED` | Filings have stopped |

Every gate routes through `worseOf()`. A test asserts **a gate can never improve
a band**.

### 60+ reason codes with evidence attached

Every point of the score carries a code and the numbers behind it, so a screen can
say *"your circle contributions are 46 of 46 on time"* rather than showing a
number and asking for trust.

Codes span income (`INCOME_STEADY`, `INCOME_VOLATILE`, `INCOME_TREND_DOWN`),
savings, payment behaviour, commitments (`GROUP_PERFECT_RECORD`,
`GROUP_RECENT_MISSES`), repayment (`REPAYMENT_SPOTLESS`, `LOAN_CLOSED_IN_FULL`),
credit history, buffer, and the SME set.

### Determinism

The feature vector carries an `inputsHash`, **quantised to the UTC day** so it
does not change on every call. Same person, same day, same facts → the same hash,
the same score, and a reusable explanation.

---

## 8. Layer 5 — the cluster signal

A circle where everyone pays on time is information about **that circle**. It is
shown to a lender as context about the group — and it is structurally prevented
from touching any individual's score.

| Band | Threshold |
|---|---|
| `POSITIVE` | ≥ 7500 bps |
| `NEUTRAL` | ≥ 4000 bps |
| `CAUTION` | < 4000 bps |

### Three guardrails

- **Opt-in, per circle, reversible.** Two seeded personas are opted out.
- **Appealable.** An open appeal suppresses the signal
  (`CLUSTER_SIGNAL_SUPPRESSED_APPEAL`).
- **Provably isolated.** A test computes a person's score inputs with the cluster
  signal present and absent and asserts the `inputsHash` is **byte-identical**.

Group lending has always had a dark side — you get judged by your neighbours. The
seeded persona **Lakshmi** pays perfectly inside a pool that does not: her score
is 76, her pool is in CAUTION, and one cannot move the other.

---

## 9. Layer 6 — lending

The full loop: eligibility → offers → application → KYC → disbursement into the
wallet → EMI schedule → repayment → and repayment feeding back into the score.

**A simulated partner lends. Nambikai only scores**, and every screen says so via
`PARTNER_DISCLAIMER`.

Three partners, four products:

| Partner | Product | Type |
|---|---|---|
| Demo NBFC | `nbfc_working_capital` | Working capital |
| Demo NBFC | `nbfc_emergency` | Emergency |
| Demo Bank | `bank_business_term` | Business term |
| Demo MFI | `mfi_chit_advance` | Chit advance |

### Income-banded FOIR — the protective core

How much of your income may service debt depends on **how much you earn**:

| Monthly income | Max share to debt |
|---|---:|
| under ₹15,000 | 20% |
| ₹15,000–₹30,000 | 30% |
| ₹30,000–₹60,000 | 40% |
| over ₹60,000 | 50% |

₹5,000 of EMI on a ₹15,000 income is ruinous; on ₹1,50,000 it is trivial. A flat
ratio — the industry default — quietly over-lends to the poorest borrower, which
is exactly the person this product exists for. A test asserts **a lower income
band never permits a higher debt share**.

### Cash-flow-aware EMI dates

`engine/cashflow.js` buckets 18 months of inflow by **day of month**, projects 60
days forward, and picks the due date where the projected balance is highest — then
shows the rationale.

A tea-stall owner earns daily; a salaried person on the 1st. Choosing the due date
from the borrower's actual pattern is the highest-leverage intervention available
on delinquency. Others sell cash-flow forecasting to *predict* failure; using the
same forecast to *prevent* it is strictly better.

### Flat versus reducing, side by side

Indian microlenders routinely quote flat interest, which roughly doubles the true
rate. Every offer shows both, in the partner's own words:

> *"This partner advertises 14.23% flat. On a reducing balance that is 24%."*

### Explainable declines

`engine/whatIf.js` re-runs the scorecard with a hypothetical delta applied and
reports the result — so a refusal is a plan, not a wall. Four decline kinds:

| Kind | Meaning |
|---|---|
| `NOT_YET_ELIGIBLE` | The score is the problem — what-if paths are offered |
| `AT_CAPACITY` | Already near the safe ceiling — not a judgement |
| `IN_ARREARS` | Something is overdue; clear it first |
| `BELOW_MINIMUM` | The amount is under the product floor |

### The graduated ceiling

A first-time borrower is capped at `min(affordability, 1 month income, ₹15,000)`
regardless of what the maths permits. The cap lifts with each loan closed on time.
This is how you lend safely to a thin file.

### The moment that lands

Karthik scores **85 / STRONG** and still gets **no offer**, because he is already
committing ₹4,430 of a ₹4,588 ceiling. The screen says *"This is not a judgement
about you"* and names the two things that would change it.

A lender optimising for volume lends him the money anyway.

### Also in this layer

- **KYC** — format-checks PAN (`[A-Z]{5}[0-9]{4}[A-Z]`) and Aadhaar (12 digits,
  Verhoeff), stores masked, marks `SIMULATED_FORMAT_CHECK`. **Never claims real
  verification.** Gates disbursement.
- **Income proof** — a shareable document derived from the ledger. Karthik's reads
  ₹15,295/month across 9 distinct payers over 1,482 transactions. Useful for a
  rental deposit, not only for credit.
- **Portfolio view** — of applicants scored LOW/MEDIUM/HIGH, what share actually
  repaid on time. The outcome data that turns a score from an opinion into
  something that has been marked.
- **Anomaly detection** — circular transfers between the same pair, velocity spikes
  against the subject's own baseline, activity inconsistent with a declared
  business.

---

## 10. Layer 7 — the SME slice

The same engine over business data: GST filings, invoices, receivables.

- Scored **separately from the owner**, but the owner's personal commitments are
  carried in — a sole trader's business and household finances are not
  independent.
- Six SME categories with their own reason codes (`SME_REVENUE_STEADY`,
  `SME_RECEIVABLES_OVERDUE`, `SME_GST_CLEAN`, `SME_UNREGISTERED`, …).
- Its own assistant, answering from business facts and refusing off-topic.
- Two seeded businesses, 101 records.

---

## 11. The AI layer

**Optional.** With no `OPENAI_API_KEY` the product is complete, not degraded —
same numbers, same reason codes, same decisions. Only the prose differs, and every
artifact records which wrote it in `explainerSource` (`LLM` or `TEMPLATE`).

### Five surfaces

| Surface | Module | Max tokens |
|---|---|---:|
| Underwriting recommendation | `ai/explainer.js` | 500 |
| Personal assistant | `ai/assistant.js` | 400 |
| SME assistant | `ai/assistant.js` | 400 |
| Borrowing decline | `ai/prose.js` | 350 |
| Income-proof summary | `ai/prose.js` | 250 |

Model: `gpt-4o` at `temperature: 0.2`, via `chat.completions`.

### Three layers of containment

**1 · Pre-check — the scrubber (`ai/guard.js`).** Runs in **every** environment
immediately before every request and **throws** rather than sending anything that
fails it. Forbidden key pattern:

```js
/paise|amount|balance|reference|ledger|counterpart|upi|vpa|phone|mobile|email|entry_?id|\bnote\b|address|pincode/i
```

Plus reference-ID, UPI-handle, mobile and email value patterns, array-length and
payload-size caps. It **fails closed and loudly** — a context that trips a rule
raises a 500 and is logged, rather than being quietly sanitised. Silently
stripping a leaking field would hide the bug that put it there.

Rupee figures reach the model only as **bands** (`"₹15,000–₹30,000"`), never exact
amounts.

**2 · Frozen system prompts**, explicit about what the model may not do — never
produce or revise a score, never promise a loan, never imply a bureau was
consulted.

**3 · Post-check.** If the answer states a number the context did not contain, the
text is **discarded** and the deterministic template is returned instead.

> The first version of this check looked for digits *near* words like "band" — and
> threw away *"...as much as is safe for your income band of ₹15,000–₹30,000"*,
> which is a correct sentence quoting a supplied fact. Proximity to a keyword says
> nothing about whether a figure was invented. It now extracts every number from
> the context and every number from the answer, and discards only if the answer
> contains one the context did not.

Off-topic questions are refused **locally** by `ai/intents.js` before any network
call — they leak nothing and cost nothing.

### Spend controls (`ai/budget.js`)

`gpt-4o` across five surfaces, one of which sits on a screen that *loads* rather
than a button that is clicked, is a real bill.

- **Cache** keyed on the same `inputsHash` the score is derived from — already
  quantised to the UTC day. Not a heuristic about similar requests: the key comes
  from the same values the number does. Opening Borrow five times costs one call.
- **Daily call budget** (default 150) and **per-user budget** (default 25),
  claimed *before* the request so two concurrent calls cannot both take the last
  slot.
- **Every refusal returns `null`** — the same thing a timeout, a rate limit, a
  broken install and a missing key return. One fallback path, so it is the one
  that gets exercised. Running out of budget is indistinguishable from having no
  key.

The SDK is imported **lazily**, so a missing or broken AI package can never stop
the wallet booting.

---

## 12. Account Aggregator and OCEN

India already has a regulated mechanism for what this does, and the design matches
its shape rather than being retrofitted to it.

### DEPA consent artefacts

An Account Aggregator sits between Financial Information Providers and Users. It
is **data-blind** — it manages consent artefacts and brokers flows it cannot read.
An artefact names a purpose, the data types covered, a validity window, a
retention life and a revocation state, and every access is logged.

That is what `consent/consent.guard.js` and `consent/audit.js` already store.
`GET /nambikai/consents/artefacts` serialises each record into the DEPA shape:

```json
{
  "ver": "1.1.2",
  "consentId": "cns_…",
  "consentDetail": {
    "consentStart": "2026-02-01T00:00:00.000Z",
    "consentExpiry": "2027-02-01T00:00:00.000Z",
    "consentMode": "VIEW",
    "fiTypes": ["DEPOSIT"],
    "Purpose": { "code": "105", "refUri": "https://api.rebit.org.in/aa/purpose/105.xml" },
    "FIDataRange": { "from": "2025-08-22…", "to": "2026-08-22…" },
    "DataLife": { "unit": "INF", "value": 0 }
  },
  "consentDetailDigest": "c6feea25…",
  "signature": null,
  "nambikai": { "simulated": true, "status": "ACTIVE", "note": "…not an AA…" }
}
```

**It is a serialiser over columns that already existed**, not a second model added
to look compliant. Tests assert every field traces back to a record field, and
that every FI type and purpose code is a real ReBIT value rather than an invented
one.

Two mapping decisions: a Paytm wallet is not a category the ReBIT taxonomy
anticipated — it was written for banks and depositories — so `DEPOSIT` is the
nearest honest neighbour and `OTHER` is used rather than inventing a code. Consent
mode is `VIEW`, not `STORE`, because Nambikai keeps derived scores and never the
transactions they came from.

### OCEN roles

OCEN separates the **Loan Service Provider**, which assembles the case, from the
**Lender**, which is regulated and carries the risk. That split is not a label
applied afterwards — it is why the engine produces a risk band rather than an
approval. Each report carries an `ocen` block naming the roles, with the Account
Aggregator slot explicitly `null` and "Not used".

### The honest limits

Nambikai is **not** an Account Aggregator and **not** a registered FIU — both
require RBI onboarding a demo does not have. Nothing talks to a real AA, no
artefact is signed, and every one is marked `simulated: true`. A fake signature
would be worse than no signature, and a test fails the build if the disclaimer
goes missing.

**What production would change:** the seeded ledger is replaced by an AA fetch
under the artefact above. Nothing downstream moves, because feature extraction
already sits behind a consent token. *The token is the seam.*

---

## 13. Data model

25 tables across 3 **purely additive** migrations — no `ALTER` or `DROP` on any
pre-existing table at any point.

| Migration | Tables added |
|---|---|
| `init` | User, Account, Session, LedgerEntry, RechargePlan, Biller |
| `nambikai_layer` | Group, GroupMember, Contribution, BehaviourSignal, TrustGraphEdge, FinancialHealthScore, ClusterTrustSignal, ClusterSignalAppeal, UnderwritingReport, ConsentRecord, ConsentAuditLog, Business, BusinessRecord |
| `lending_loop` | LoanApplication, LoanOffer, Loan, LoanInstallment, KycRecord, AnomalyFlag |

### Conventions

- `cuid()` primary keys
- String "enums" with a trailing comment listing the values — SQLite has no native
  enum, and a comment beats a lookup table for a fixed set
- All money as `Int` paise
- `@@index` on every query path the code actually uses
- JSON blobs (`scope`, `breakdown`, `evidence`, `payload`) stored as `String`

---

## 14. API reference

**77 endpoints.** Base: `http://127.0.0.1:4000/api/v1`. All except auth require
`Authorization: Bearer <token>`.

### Wallet

| | |
|---|---|
| `POST /auth/signup` · `/signin` · `/signout` · `GET /auth/me` | Sessions are server-side and revocable |
| `GET /account/balance` · `/limits` | |
| `POST /account/add-money` · `/transfer` | |
| `GET /users/search` · `/recent` · `/:id` · `/me/pay-code` | |
| `POST /users/resolve` | Scanned pay code, UPI ID or mobile |
| `PATCH /users/me` · `/me/password` | |
| `GET /transactions` · `/summary` · `/:id` | Cursor-paginated passbook |
| `GET /payments/operators` · `/plans` · `/billers` | |
| `POST /payments/recharge` · `/bill` | Pricing is server-side |

### Circles

```
GET    /nambikai/groups                                   list
POST   /nambikai/groups                                   create
GET    /nambikai/groups/:id                               detail
POST   /nambikai/groups/:id/members                       add
DELETE /nambikai/groups/:id/members/:userId               remove
GET    /nambikai/groups/:id/contributions                 schedule
POST   /nambikai/groups/:id/contributions/:cId/pay        pay one
GET    /nambikai/groups/:id/payout-cycle                  whose turn
```

### Consent

```
GET    /nambikai/consents/catalogue     every data type and purpose
GET    /nambikai/consents               what you have granted
POST   /nambikai/consents               grant
DELETE /nambikai/consents/:id           revoke
GET    /nambikai/consents/artefacts     DEPA-shaped export
GET    /nambikai/consents/audit         what was actually read
```

### Score

```
GET  /nambikai/score              current score, breakdown, reason codes
GET  /nambikai/score/inputs       the feature vector it was computed from
POST /nambikai/score/recompute
GET  /nambikai/score/history      the trend
GET  /nambikai/score/signals      behaviour signals
```

### Cluster

```
GET  /nambikai/cluster/status
POST /nambikai/cluster/opt-in · /opt-out
GET  /nambikai/cluster/:groupId/signal
GET  /nambikai/cluster/appeals    ·  POST /appeals  ·  POST /appeals/:id/withdraw
```

### Underwriting

```
GET  /nambikai/underwriting/partners        who can receive a report
GET  /nambikai/underwriting/relationships
POST /nambikai/underwriting/reports         generate for one partner
GET  /nambikai/underwriting/reports · /:id
```

### Lending

```
GET  /nambikai/lending/eligibility          score + affordability, or the decline
GET  /nambikai/lending/offers               concrete offers across partners
POST /nambikai/lending/applications         apply
GET  /nambikai/lending/applications
POST /nambikai/lending/applications/:id/accept    → KYC gate → disburse
GET  /nambikai/lending/kyc  ·  POST /nambikai/lending/kyc
GET  /nambikai/lending/loans · /loans/:id
POST /nambikai/lending/loans/:id/installments/:iid/pay
GET  /nambikai/lending/loans/:id/forecast   shortfall warning
GET  /nambikai/lending/income-proof
GET  /nambikai/lending/portfolio            outcome data
```

### SME and assistant

```
GET  /nambikai/businesses · /:id · /:id/records · /:id/score
POST /nambikai/businesses  ·  POST /:id/score/recompute
GET  /nambikai/businesses/:id/assistant/suggestions
POST /nambikai/businesses/:id/assistant/ask
GET  /nambikai/assistant/suggestions
POST /nambikai/assistant/ask
```

---

## 15. The seed

`npm run db:seed` writes 18 months of history for 10 people.

| | |
|---|---:|
| Ledger entries | 8,501 |
| Contributions | 223 |
| Consent records | 70 |
| Loans / instalments | 3 / 30 |
| KYC records | 5 |
| Businesses / records | 2 / 101 |

### Determinism

One seeded `mulberry32` generator (`0x4e424b31` — `NBK1` in hex), every date built
with `Date.UTC`, opening balances solved in a two-pass sweep rather than
accumulated. Two machines seeding on the **same day** produce identical rows to
the paise.

History is anchored to *today* — "18 months back from now" — so a clone made next
week gets one more cycle and slightly different balances. **The behaviour each
persona demonstrates never changes.**

### Money circulates

Nobody is funded by an invisible faucet. Salaried personas buy tea from Karthik;
Karthik buys stock from Meena. The trust graph therefore has real supplier and
customer edges, and a vendor's income genuinely is a stream of small UPI receipts.

### The cast

| Persona | Demonstrates |
|---|---|
| **karthik** | The thesis. Tea stall, no bureau file, spotless two-circle record, active loan — and no new offer, because he is at capacity |
| **rahul** | A decline done humanely. Four gates fire, two EMIs 47 days overdue |
| **arjun** | Thin file *and* no consent granted. Grant it on screen and watch a score appear |
| **lakshmi** | The fairness guardrail. Impeccable inside a failing pool, opted out, appeal open |
| **meena** | A loan seen through — repaid in full, lifting her ceiling |
| **sreeram** | The clean offer screen: live EMI, cash-flow-chosen due date, both rates |
| **ananya** | Income is not capacity. Earns well, keeps nothing, pays late |
| **divya** | Irregular income is not unreliable income |
| **priya** | Weight redistribution — no circle history, not punished for it |
| **vignesh** | The cluster signal from inside, and opting out being real |

Password for all ten: `password123`. Sign in with `<name>@paytm.test` or the
mobile number.

---

## 16. Tests

**237 tests**, `node --test`, against a throwaway `test.db` recreated and re-seeded
each run, so demo data is never touched.

| File | Tests | Covers |
|---|---:|---|
| `api.test.js` | 33 | Auth, hashing, session revocation, atomic transfers, the concurrency race, client-supplied-balance rejection, passbook scoping, server-side pricing, whole-DB invariants |
| `nambikai.test.js` | 73 | Circles, consent gates and the 403 wall, audit semantics, scoring, cluster isolation, SME |
| `nambikai.lending.test.js` | 31 | Affordability caps, graduated ceiling, KYC gate, EMI double-payment race, delinquency gate, decline paths, portfolio |
| `nambikai.ai.test.js` | 30 | The scrubber, intent classification, template determinism, the discard path |
| `nambikai.engine.test.js` | 29 | **Engine purity**, weight sum, FOIR monotonicity, EMI round-trip, gate direction |
| `nambikai.openai.test.js` | 21 | The OpenAI wire format against a local mock, cache, budgets |
| `nambikai.depa.test.js` | 16 | Consent artefact fields, ReBIT code validity, OCEN roles |

### The tests worth knowing about

- **Engine purity** reads each engine file as text and fails on any clock, RNG or
  Prisma import.
- **Cluster isolation** asserts a person's `inputsHash` is byte-identical with the
  cluster signal present and absent.
- **The architectural test** greps `src/nambikai/` and fails if anything writes a
  ledger row directly.
- **Four concurrent EMI taps** produce exactly one payment.
- **FOIR monotonicity** — a lower income band never permits a higher debt share.
- **`maxPrincipal` round-trips** through the EMI formula within one paise, because
  `principalFor` binary-searches over `emiFor` and the two can never disagree.
- **DEPA negative control** — the raw `noOfferReason` object *must* trip the
  scrubber, and the derived context *must not*. The negative half is what proves
  the guard would really have caught it.
- **Tests never call the real API.** `OPENAI_API_KEY` and `NAMBIKAI_AI_BASE_URL`
  are pinned empty in the test script.

---

## 17. Running it

Node 20.11+. No Docker, no cloud account, no API key.

```bash
git clone https://github.com/akashsubramanian03/paytm.git
cd paytm
npm run setup   # install, .env files, prisma generate, migrate, seed
npm run dev     # API :4000, web :5173
```

Open <http://localhost:5173>, sign in as `karthik@paytm.test` / `password123`.

### Commands

| | |
|---|---|
| `npm run setup` | Everything below, chained |
| `npm run install:all` | Both workspaces |
| `npm run env:init` | Both `.env` files, generated JWT secret |
| `npm run db:generate` | Prisma client |
| `npm run db:migrate` | Build the SQLite file |
| `npm run db:seed` | 18 months of history |
| `npm run db:reset` | Drop, migrate, re-seed |
| `npm run db:studio` | Browse the database |
| `npm test` | All 237 tests |
| `npm run build` | Production frontend build |

### Configuration

`backend/.env` — the database and both `.env` files are **gitignored** and created
by setup.

| Variable | Default | |
|---|---|---|
| `JWT_SECRET` | *generated* | **Required.** Server refuses to boot under 32 chars |
| `DATABASE_URL` | `file:./paytm.db` | |
| `SIGNUP_BONUS_PAISE` | `1000000` | ₹10,000 for a new wallet |
| `MAX_TRANSFER_PAISE` | `20000000` | ₹2,00,000 |
| `OPENAI_API_KEY` | *empty* | Optional. Empty = templates |
| `NAMBIKAI_AI_MODEL` | `gpt-4o` | |
| `NAMBIKAI_AI_DAILY_CALL_BUDGET` | `150` | Over budget → template, never an error |
| `NAMBIKAI_AI_USER_CALL_BUDGET` | `25` | |
| `NAMBIKAI_AI_CACHE_SIZE` | `500` | |
| `NAMBIKAI_AI_BASE_URL` | *empty* | Any OpenAI-compatible endpoint |

### Troubleshooting

| Symptom | Fix |
|---|---|
| `@prisma/client did not initialize yet` | `npm run db:generate` — npm's script blocking suppressed the postinstall |
| `EADDRINUSE :4000` / `:5173` | `lsof -ti:4000 \| xargs kill`. Don't change the port; `frontend/.env` pins the API |
| `database is locked` | Stop `npm run dev` before `npm run db:reset` |
| Sign-in fails for everyone | `npm run db:reset` — it prints all ten accounts |

---

## 18. What is not real

State this first, before anyone finds it.

- **No payment rails.** No bank, no UPI network, no gateway. The wallet is a
  SQLite file.
- **KYC is a format check** on PAN and Aadhaar patterns, labelled
  `SIMULATED_FORMAT_CHECK` in the database. It never claims real verification.
- **The lending partners are simulated.** Every loan screen carries a badge.
- **Not an Account Aggregator, not a registered FIU.** No artefact is signed.
- **The ten people and their 18 months are generated**, not collected.

**What is real:** the engine, the invariants, and the 237 tests.

### What a production version would add

KYC through a real provider, two-factor authentication, idempotency keys on
payment requests, an append-only audit log, per-user transfer rate limits, refunds
and reversals, statement exports, and a database that handles concurrent writes
better than SQLite.

---

*Nambikai — because the word means trust, and because a score nobody can question
is not trust, it is just a number.*
