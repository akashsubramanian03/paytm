/**
 * Building what the model is allowed to see.
 *
 * These are the ONLY functions that construct a model payload. Everything they
 * emit is derived: percentages, bands, counts of months, code identifiers. No
 * rupee figure, no transaction, no row id, no counterparty, no note text.
 *
 * The display name is deliberately reduced to a first name and an initial. The
 * model does not need to know who someone is in order to explain a score, and
 * anything it does not need it should not receive.
 */
import { CATEGORY_LABEL, SME_CATEGORY_LABEL } from '../constants.js';
import { assertContextClean } from './guard.js';

/** "Karthik B." — enough to address someone, not enough to identify them. */
export function shortName(user) {
  if (!user) return 'This applicant';
  const first = (user.firstName ?? '').trim();
  const initial = (user.lastName ?? '').trim().charAt(0);
  return initial ? `${first} ${initial}.` : first || 'This applicant';
}

const pct = (bps) => Math.round((bps ?? 0) / 100);

function categoryBlocks(breakdown, isSme) {
  const labels = isSme ? SME_CATEGORY_LABEL : CATEGORY_LABEL;
  return breakdown.map((b) => ({
    key: b.category,
    label: labels[b.category] ?? b.category,
    raw_pct: pct(b.rawBps),
    weight_pct: pct(b.weightBps),
    measured: b.measured,
  }));
}

const codeBlocks = (codes) =>
  codes.map((c) => ({
    code: c.code,
    label: c.label,
    attribution: c.attribution,
    polarity: c.polarity,
    affects_score: c.affectsScore,
  }));

/**
 * Context for the underwriting explainer.
 *
 * Note what is absent: the applicant's balance, their income, their
 * transactions, the identity of anyone they pay. A lender reading the prose gets
 * an explanation of a score; the model producing it never held the underlying
 * records.
 */
export function buildExplainerContext({ user, score, ruleResult, clusterSignal, partner, isSme }) {
  const context = {
    schema_version: 'nbk-explainer-1',
    subject: {
      type: isSme ? 'BUSINESS' : 'USER',
      display_name: shortName(user),
      tenure_months: score.tenureMonths ?? null,
      is_thin_file: Boolean(score.isThinFile),
    },
    score: { value: score.score, band: ruleResult.band, grade: score.grade },
    categories: categoryBlocks(score.breakdown, isSme),
    reason_codes: codeBlocks([...score.reasonCodes, ...(ruleResult.reasonCodes ?? [])]),
    gates: (ruleResult.gates ?? [])
      .filter((g) => g.triggered)
      .map((g) => ({ code: g.code, triggered: true })),
    eligible: ruleResult.eligible,
    cluster_signal: clusterSignal
      ? {
          reliability_pct: pct(clusterSignal.reliabilityBps),
          band: clusterSignal.band,
          // Restated inside the payload so the model cannot describe the cluster
          // as if it moved the score.
          affects_individual_score: false,
        }
      : null,
    partner: partner ? { id: partner.id, display_name: partner.displayName } : null,
    notes:
      'All figures are percentages of a maximum. No rupee amounts, transactions, or counterparty identities are shared.',
  };

  assertContextClean(context);
  return context;
}

/**
 * Context for the assistant.
 *
 * Rupee figures are the one thing a person legitimately wants from an assistant
 * about their own money — so they are given as BANDS ("₹5,000–₹10,000"), never
 * exact amounts. A band answers "roughly what can I afford" without handing the
 * model a balance, and the guard's forbidden-key rule keeps the exact number out
 * by construction.
 */
export function bandRupees(paise) {
  if (paise === null || paise === undefined) return null;
  const rupees = Math.round(paise / 100);
  const steps = [0, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];
  for (let i = 0; i < steps.length - 1; i += 1) {
    if (rupees < steps[i + 1]) {
      return `₹${steps[i].toLocaleString('en-IN')}–₹${steps[i + 1].toLocaleString('en-IN')}`;
    }
  }
  return `over ₹${steps[steps.length - 1].toLocaleString('en-IN')}`;
}

export function buildAssistantContext({ user, score, ruleResult, facts, isSme }) {
  const context = {
    schema_version: 'nbk-assistant-1',
    subject: { display_name: shortName(user), type: isSme ? 'BUSINESS' : 'USER' },
    score: { value: score.score, grade: score.grade },
    categories: categoryBlocks(score.breakdown, isSme),
    reason_codes: codeBlocks(score.reasonCodes),
    gates: (ruleResult?.gates ?? []).filter((g) => g.triggered).map((g) => ({ code: g.code })),
    facts,
    notes:
      'Every figure here is a percentage, a count, or a rupee BAND. There are no exact amounts and no transactions. If a question cannot be answered from these facts, say so.',
  };

  assertContextClean(context);
  return context;
}

/**
 * The borrowing decline, reduced to something the model may see.
 *
 * `noOfferReason` is built for the screen, not for a model: it carries
 * `monthlyIncomePaise`, `committedPaise` and `ceilingPaise` verbatim. Every one
 * of those trips the forbidden-key rule in guard.js, which is the intended
 * behaviour — this builder is the only sanctioned way for a decline to reach the
 * model, and the guard is what makes that a fact rather than a convention.
 */
export function buildDeclineContext({ user, score, reason, scenarios = [] }) {
  const context = {
    schema_version: 'nbk-decline-1',
    subject: { display_name: shortName(user), type: 'USER' },
    score: { value: score.value, grade: score.grade, band: score.band },
    outcome: {
      kind: reason.kind,
      headline: reason.headline,
      income_band: reason.incomeBand ?? null,
      share_of_income_allowed_pct: reason.foirPct ?? null,
      committed_band: bandRupees(reason.committedPaise),
      ceiling_band: bandRupees(reason.ceilingPaise),
      days_past_due: reason.daysPastDue ?? null,
      overdue_count: reason.overdueCount ?? null,
    },
    paths: (reason.paths ?? []).map((p) => ({ key: p.key, label: p.label })),
    what_would_change_it: scenarios.map((s) => ({
      key: s.key ?? null,
      label: s.label ?? null,
      months_away: s.monthsAway ?? null,
    })),
    notes:
      'This person was NOT offered a loan. Rupee figures are BANDS. Describe why and what would change it. Never state or imply that following these steps results in a loan.',
  };

  assertContextClean(context);
  return context;
}

/**
 * The income-proof summary.
 *
 * Deliberately thinner than it could be. This document is shown to a landlord or
 * an employer, not a lender, so the model is given the shape of the income and
 * nothing about creditworthiness — there is no score in this context at all, and
 * it therefore has nothing to characterise the person with.
 */
export function buildIncomeProofContext({ user, proof }) {
  const context = {
    schema_version: 'nbk-income-proof-1',
    subject: { display_name: shortName(user), type: 'USER' },
    period: {
      months_observed: proof.period.monthsObserved,
      months_with_income: proof.period.monthsWithIncome,
    },
    income: {
      typical_monthly_band: bandRupees(proof.income.medianMonthlyPaise),
      quietest_month_band: bandRupees(proof.income.lowestMonthPaise),
      busiest_month_band: bandRupees(proof.income.highestMonthPaise),
      distinct_payers: proof.income.distinctPayers,
      transaction_count: proof.income.transactionCount,
    },
    notes:
      'This is a record of money received into one wallet, nothing more. Rupee figures are BANDS. Do not assess creditworthiness, do not mention loans or scores, and do not imply this is a salary declaration.',
  };

  assertContextClean(context);
  return context;
}
