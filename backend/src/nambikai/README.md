# Nambikai — the compliance contract

Read this before changing anything in `engine/`, `consent/`, or `pipeline/`.

Nambikai (நம்பிக்கை, Tamil for *trust*) turns behaviour that already happens —
savings-group contributions, wallet activity, bill payments — into an explainable
financial identity for people a credit bureau cannot see. It sits on top of the
Paytm wallet in this repo and reads its real `LedgerEntry` passbook.

Most of what follows is not style. It is the set of properties that make this
system defensible, and each one is held in place by a test rather than by good
intentions.

---

## 1. What Nambikai is not

- **Not a lender.** It never issues credit, holds lending risk, or approves or
  declines anything. It produces a signal; a licensed partner decides.
- **Not a chit operator.** It runs no auction and holds no pot. Contributions are
  ordinary peer-to-peer wallet transfers between members. `GET /groups/:id/payout-cycle`
  reports what *would* be routed to a registered operator and deliberately does
  nothing — there is no `POST` counterpart, and that absence is intentional.
- **Not a bureau replacement.** There is no CIBIL pull. The `CREDIT_HISTORY`
  category measures account tenure and peer repayment, and the UI says exactly
  that rather than letting a user assume otherwise.
- **Not an AI that decides.** See §3.

## 2. The money rule

`backend/src/lib/wallet.js` is the only module in the entire codebase that moves
money. Nambikai added exactly one new money path — `payGroupContribution` — and
put it inside that file.

A `Contribution` row **never moves money**. It annotates a `LedgerEntry` that a
real transfer already created. `PENDING` and `MISSED` rows point at nothing.

Three whole-database invariants are asserted by the test suite and must survive
every change:

1. No wallet balance is ever negative.
2. Every wallet's balance equals the sum of its own ledger entries.
3. Every `TRANSFER` reference id has exactly one `DEBIT` and one `CREDIT` of equal
   amount.

This is why a group contribution is a plain two-leg `TRANSFER` carrying
`metadata.kind = 'GROUP_CONTRIBUTION'` rather than a new single-leg category: the
existing invariants then cover it for free. A test greps `src/nambikai/` and fails
if any file there calls `prisma.ledgerEntry.create`.

## 3. The LLM never originates a number

```
raw data -> features -> scorecard -> RULE ENGINE -> LLM EXPLAINER -> prose
                        ^^^^^^^^^^^^^^^^^^^^^^^^
                        the risk assessment happens here, and only here
```

`engine/scorecard.js` produces the score. `engine/rules.js` applies hard gates and
may only ever make a band **worse**. The LLM is called afterwards, is handed the
already-computed result, and writes English. It cannot change the number.

Three mechanisms enforce this rather than one:

- **Pre-check** (`ai/intents.js`) — an off-topic question is refused before any
  network call happens.
- **Scrub** (`ai/guard.js#assertContextClean`) — runs in *every* environment
  immediately before the API call and throws rather than sending. It rejects raw
  amounts, balances, reference ids, UPI ids, phone numbers, emails, oversized
  arrays and oversized payloads. The model receives derived percentages only.
- **Post-check** (`ai/assistant.js`) — if the model asserts a numeric score or
  risk value that is not in the facts it was given, the text is discarded and the
  deterministic template is returned instead.

If no `OPENAI_API_KEY` is set, everything still works: `ai/templates.js` and
`ai/prose.js` produce the prose deterministically. Every artifact records
`explainerSource` as `LLM` or `TEMPLATE`, and the UI shows it, so a reviewer
always knows which wrote what.

The model writes on five surfaces: the underwriting recommendation
(`ai/explainer.js`), the personal and SME assistants (`ai/assistant.js`), the
borrowing decline and the income-proof summary (both `ai/prose.js`). The last two
are the reason `ai/context.js` gained `buildDeclineContext` and
`buildIncomeProofContext`: `noOfferReason` and an income proof are both built for
the screen and carry raw paise, so passing either to the model directly throws
`ContextLeakError`. A test asserts both the leak and the derived version, because
the negative control is what shows the guard would really have caught it.

`ai/budget.js` holds the spend controls — an LRU keyed on the same inputs hash the
score uses, plus a daily and a per-user call budget. Every refusal returns `null`,
which is the same thing a timeout, a rate limit or a missing key returns, so there
is exactly one fallback path and it is the one that gets exercised.

## 4. Determinism

Everything under `engine/` is pure. No Prisma import, no `Date.now()`, no
`Math.random()`, and no floats — all values are integer basis points (0..10000).
`asOf` is always passed down from the route layer, never read from the clock
inside the engine.

Month bucketing is **UTC** (`util/window.js`). Local-calendar bucketing would make
the same data score differently in different timezones.

Every score stores an `inputsHash`: the sha256 of the canonical form of its
`FeatureVector` (`util/hash.js`). Same inputs, same hash, same score — asserted
over 100 iterations by a test.

Category iteration uses the fixed `CATEGORY_KEYS` array from `constants.js`, never
`Object.keys()` of a map built from database rows.

## 5. Consent is a gate, not a checkbox

Nothing is scored without an active `ConsentRecord` for each required data type.

The gate lives **at the data boundary, not in middleware**. Express middleware
only protects the HTTP path; an internal caller — the assistant, a batch
recompute, a future cron — would walk straight past it. So `consent/guard.js`
returns a `ConsentToken`, and each feature extractor re-asserts against that token
before it queries. A missing consent physically prevents the `findMany` from
running. It is not a response filter.

`ConsentAuditLog` records `USE` rows only for data types **actually read**, not
merely permitted — that distinction is the entire point of the log. Blocked calls
write `DENY` rows, so a refusal is as auditable as a use. Every row from one
scoring call shares a `requestId`.

Revoking consent does not delete existing reports — they are the record of what
was disclosed — but they return `usable: false`, and any new scoring call 403s.

## 6. Cluster Trust Signal — the sharpest edge

A cluster is **exactly one thing**: a `Group` with at least 3 active members and
at least 3 completed cycles. There is no inferred cohort, no behavioural cluster,
no geographic grouping. That is a deliberate constraint, not a missing feature —
inferred clusters are precisely where proxy discrimination hides.

Group-level signal can quietly penalise a reliable person for their neighbours'
behaviour. So:

1. **Opt-in only.** Never on by default.
2. **Never blended.** `ScoreResult` has no field capable of holding a cluster
   value. `engine/scorecard.js` may not import `engine/cluster.js` — a test reads
   the source and fails if it does. `scorecard.js` sets
   `computedWithoutClusterData: true`, and `pipeline/underwrite.pipeline.js`
   asserts that flag before attaching a cluster signal. Anyone blending the two
   must delete that assertion to compile, which makes it visible in review.
3. **Always a separate labelled field.** `cluster_signal` is a top-level key that
   is always present, object or `null`, so a client cannot accidentally merge it.
   When null, `cluster_omission_reason` says why — "we did not look" and "we
   looked and found nothing" are different disclosures.
4. **Appeal works from day one.** An `OPEN` or `UPHELD` appeal suppresses the
   signal immediately, at read time, with no recompute.
5. **Reason codes name the contribution.** `CLUSTER_SIGNAL_POSITIVE` and friends
   all carry `attribution: 'CLUSTER'` and `affects_score: false`. No `CLUSTER_*`
   code may appear in the individual signal lists.
6. **The applicant is excluded from their own cluster aggregate**, so the signal
   is exogenous and their behaviour is never counted twice.
7. **Thin clusters get `null`, never a fabricated number.**

The decisive test: the individual `score` and `inputsHash` are byte-identical with
cluster opt-in on and off. If that test ever fails, the blend happened.

## 7. Trust graph is participation, not risk transfer

`TrustGraphEdge.strengthBps` records how consistently and how long a subject has
shown up in a relationship. It is **not** a transfer of credit risk between the
two ends of the edge, and it is never an input to `FinancialHealthScore`. One
member's default must not move another member's score.

## 8. Layer boundaries

| Layer | May touch |
|---|---|
| `consent/guard` | prisma (consent tables only) |
| `features/*` | prisma, read-only, and only what the token permits |
| `engine/*` | **nothing** — pure functions |
| `pipeline/*` | orchestrates: consent -> features -> engine -> persist -> explain |
| `ai/*` | the network, optionally, with a scrubbed context |

`features/*` emits flat integers and ISO strings. No row ids, no counterparty
identities, no note text ever crosses out of that layer.
