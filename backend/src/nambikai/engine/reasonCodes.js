/**
 * The reason code catalogue.
 *
 * THIS IS THE ANTI-BLACK-BOX MACHINERY. A score on its own is an assertion; a
 * score plus the specific, evidenced behaviours that produced it is an argument
 * someone can check, learn from, or dispute.
 *
 * Every code carries four things:
 *   - a plain-language `label` a person can read without a glossary
 *   - `evidence`: the actual numbers it was derived from, so nothing is
 *     unexplained and nothing has to be taken on trust
 *   - `polarity`, so helping and hurting are visibly distinguished
 *   - `attribution`, INDIVIDUAL or CLUSTER, so a person can always tell whether
 *     something is about them or about a group they belong to
 *
 * Rules that hold, and are tested:
 *   1. Every code emitted by the engine exists in this catalogue. An orphan code
 *      cannot reach the UI and be rendered as a bare identifier.
 *   2. No code here is INDIVIDUAL and prefixed CLUSTER_, or vice versa.
 *   3. Codes are emitted in a fixed order, so two runs over the same data
 *      produce byte-identical explanations.
 *
 * PURE MODULE.
 */
import { ATTRIBUTION, CATEGORY, POLARITY, SME_CATEGORY } from '../constants.js';

const { POSITIVE, NEGATIVE, NEUTRAL } = POLARITY;
const { INDIVIDUAL, CLUSTER } = ATTRIBUTION;

/**
 * @type {Record<string, {label:string, category:string|null, polarity:string,
 *   attribution:string, affectsScore:boolean, guidance?:string}>}
 */
export const REASON_CODES = {
  /* ---------------------------------------------------- income stability -- */
  INCOME_STEADY: {
    label: 'Money comes in steadily',
    category: CATEGORY.INCOME_STABILITY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  INCOME_VOLATILE: {
    label: 'Income varies a lot month to month',
    category: CATEGORY.INCOME_STABILITY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'Irregular earnings are normal for many kinds of work. Consistent saving counts for more when income is uneven.',
  },
  INCOME_GAPS: {
    label: 'Some months had no money coming in',
    category: CATEGORY.INCOME_STABILITY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  INCOME_TREND_UP: {
    label: 'Earnings have grown recently',
    category: CATEGORY.INCOME_STABILITY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  INCOME_TREND_DOWN: {
    label: 'Earnings have fallen recently',
    category: CATEGORY.INCOME_STABILITY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  THIN_FILE_INCOME: {
    label: 'Not enough months of earnings to judge yet',
    category: CATEGORY.INCOME_STABILITY,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'This is about how long Nambikai has been able to see, not about anything you did.',
  },

  /* ------------------------------------------------- savings consistency -- */
  SAVINGS_CONSISTENT: {
    label: 'You hold on to some of what you earn',
    category: CATEGORY.SAVINGS_CONSISTENCY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SAVINGS_THIN: {
    label: 'Most months, nearly everything goes back out',
    category: CATEGORY.SAVINGS_CONSISTENCY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  NEGATIVE_NET_FLOW: {
    label: 'Spending has been running ahead of income',
    category: CATEGORY.SAVINGS_CONSISTENCY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_SAVINGS_STRONG: {
    label: 'A real share of your earnings goes into savings circles',
    category: CATEGORY.SAVINGS_CONSISTENCY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },

  /* -------------------------------------------------- payment behaviour --- */
  BILLS_REGULAR: {
    label: 'Bills and recharges are paid most months',
    category: CATEGORY.PAYMENT_BEHAVIOUR,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  BILLS_IRREGULAR: {
    label: 'Bills and recharges are paid only occasionally',
    category: CATEGORY.PAYMENT_BEHAVIOUR,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'Only payments made through Paytm are visible here. Anything paid in cash or elsewhere is not counted against you deliberately — it simply cannot be seen.',
  },
  PAYMENT_STRAIN: {
    label: 'Your balance often runs close to empty after paying',
    category: CATEGORY.PAYMENT_BEHAVIOUR,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  PAYMENT_FAILURES: {
    label: 'Some payments failed',
    category: CATEGORY.PAYMENT_BEHAVIOUR,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },

  /* ------------------------------------------------------- commitments ---- */
  GROUP_PERFECT_RECORD: {
    label: 'Every savings-group contribution paid on time',
    category: CATEGORY.COMMITMENTS,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_ON_TIME_STREAK: {
    label: 'Savings-group contributions are usually on time',
    category: CATEGORY.COMMITMENTS,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_TENURE_LONG: {
    label: 'You have kept up a savings circle for a long time',
    category: CATEGORY.COMMITMENTS,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_MULTIPLE: {
    label: 'You keep commitments in more than one circle',
    category: CATEGORY.COMMITMENTS,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_LATE_PATTERN: {
    label: 'Contributions are often paid late',
    category: CATEGORY.COMMITMENTS,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_MISSED: {
    label: 'Some savings-group contributions were missed',
    category: CATEGORY.COMMITMENTS,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  GROUP_RECENT_MISSES: {
    label: 'Contributions have been missed recently',
    category: CATEGORY.COMMITMENTS,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'Recent months carry more weight than older ones, in both directions.',
  },
  NO_GROUP_HISTORY: {
    label: 'No savings-group history yet',
    category: CATEGORY.COMMITMENTS,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: false,
    guidance: 'Nambikai does not count this against you. The weight moves to what it can actually see.',
  },

  /* ----------------------------------------------------- credit history --- */
  NO_FORMAL_CREDIT: {
    label: 'No formal credit history',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: false,
    guidance: 'Nambikai has no credit-bureau access. This category measures how long you have been on Paytm and whether you repay people you know.',
  },
  TENURE_ESTABLISHED: {
    label: 'A long history on Paytm',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  TENURE_SHORT: {
    label: 'Fairly new to Paytm',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  PEER_REPAYMENT_STRONG: {
    label: 'Money borrowed from people you know is paid back',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  PEER_REPAYMENT_WEAK: {
    label: 'Money received from others is not always sent back',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'Nambikai infers this from patterns of transfers, which can misread a gift as a loan. It is a small part of the score.',
  },
  COUNTERPARTY_DEPTH: {
    label: 'You transact with a wide circle of people',
    category: CATEGORY.CREDIT_HISTORY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },

  /* --------------------------------------------------- emergency buffer --- */
  BUFFER_HEALTHY: {
    label: 'Your balance could cover a while without income',
    category: CATEGORY.EMERGENCY_BUFFER,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  LOW_EMERGENCY_BUFFER: {
    label: 'Very little set aside for an emergency',
    category: CATEGORY.EMERGENCY_BUFFER,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  BUFFER_VOLATILE: {
    label: 'Your balance swings a lot between months',
    category: CATEGORY.EMERGENCY_BUFFER,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },

  /* ---------------------------------------------------------------- SME --- */
  SME_REVENUE_STEADY: {
    label: 'Invoiced revenue is steady month to month',
    category: SME_CATEGORY.SME_REVENUE_STABILITY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_REVENUE_VOLATILE: {
    label: 'Invoiced revenue swings sharply between months',
    category: SME_CATEGORY.SME_REVENUE_STABILITY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_INFLOW_STEADY: {
    label: 'Customers keep buying, month after month',
    category: SME_CATEGORY.SME_INFLOW_CONSISTENCY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_RECEIVABLES_HEALTHY: {
    label: 'Customers settle quickly',
    category: SME_CATEGORY.SME_RECEIVABLES_QUALITY,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_RECEIVABLES_OVERDUE: {
    label: 'A meaningful share of invoices is overdue',
    category: SME_CATEGORY.SME_RECEIVABLES_QUALITY,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_LOW_LEVERAGE: {
    label: 'Existing debt is small relative to revenue',
    category: SME_CATEGORY.SME_LEVERAGE,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_HIGH_LEVERAGE: {
    label: 'Existing debt is large relative to revenue',
    category: SME_CATEGORY.SME_LEVERAGE,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_GST_CLEAN: {
    label: 'Every GST return filed on time',
    category: SME_CATEGORY.SME_COMPLIANCE,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_GST_LATE: {
    label: 'Recent GST returns were filed late',
    category: SME_CATEGORY.SME_COMPLIANCE,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
  },
  SME_UNREGISTERED: {
    label: 'Not GST-registered',
    category: SME_CATEGORY.SME_COMPLIANCE,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: false,
    guidance:
      'Many small businesses are below the registration threshold. Nambikai does not count the absence of filings against you — the weight moves to what it can see.',
  },
  SME_OWNER_RELIABLE: {
    label: 'The owner keeps their own savings-group commitments',
    category: SME_CATEGORY.SME_OWNER_COMMITMENTS,
    polarity: POSITIVE,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance:
      'This is the owner’s OWN record. It is never another member’s behaviour, and never a group-level signal.',
  },

  GATE_SME_INSUFFICIENT_DATA: {
    label: 'Not enough business records to assess yet',
    category: null,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: false,
    guidance:
      'Redistributing weight stops an absence being counted against you, but it cannot manufacture evidence. With only a couple of measurable areas, Nambikai says "not yet" rather than issuing a confident low-risk assessment built on very little.',
  },
  GATE_SME_OVERLEVERAGED: {
    label: 'Debt is very large relative to revenue',
    category: null,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: false,
  },
  GATE_SME_GST_LAPSED: {
    label: 'GST filing has repeatedly lapsed',
    category: null,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: false,
  },

  /* -------------------------------------------------------------- gates --- */
  GATE_INSUFFICIENT_HISTORY: {
    label: 'Not enough history to assess yet',
    category: null,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: false,
    guidance: 'Nambikai would rather say "not yet" than guess.',
  },
  GATE_DORMANT: {
    label: 'This account has been inactive',
    category: null,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: false,
  },
  GATE_MISSED_COMMITMENTS: {
    label: 'Several recent contributions were missed',
    category: null,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: false,
  },
  GATE_NEGATIVE_TREND: {
    label: 'Spending is outpacing income with little in reserve',
    category: null,
    polarity: NEGATIVE,
    attribution: INDIVIDUAL,
    affectsScore: false,
  },

  /* ------------------------------------------------- fairness machinery --- */
  WEIGHT_REDISTRIBUTED: {
    label: 'Unmeasured areas were not counted against you',
    category: null,
    polarity: NEUTRAL,
    attribution: INDIVIDUAL,
    affectsScore: true,
    guidance: 'Where Nambikai has no evidence, that category’s weight moves to the ones it can see, instead of scoring you zero for an absence.',
  },

  /* -------------------------------------------------------- cluster ------- */
  // Declared here so the catalogue is complete and the "no orphan codes" test
  // covers them. They are only ever emitted by the cluster layer, never by the
  // individual scorecard, and every one of them has affectsScore: false.
  CLUSTER_SIGNAL_POSITIVE: {
    label: 'The group you save with has a strong collective record',
    category: null,
    polarity: POSITIVE,
    attribution: CLUSTER,
    affectsScore: false,
  },
  CLUSTER_SIGNAL_NEUTRAL: {
    label: 'The group you save with has a mixed collective record',
    category: null,
    polarity: NEUTRAL,
    attribution: CLUSTER,
    affectsScore: false,
  },
  CLUSTER_SIGNAL_CAUTION: {
    label: 'The group you save with has a weak collective record',
    category: null,
    polarity: NEGATIVE,
    attribution: CLUSTER,
    affectsScore: false,
    guidance: 'This describes the group, not you. It never changes your own score, and you can dispute or withdraw from it.',
  },
  CLUSTER_SIGNAL_NOT_CONSENTED: {
    label: 'Group-level signal not shared',
    category: null,
    polarity: NEUTRAL,
    attribution: CLUSTER,
    affectsScore: false,
  },
  CLUSTER_SIGNAL_SUPPRESSED_APPEAL: {
    label: 'Group-level signal withheld while a dispute is open',
    category: null,
    polarity: NEUTRAL,
    attribution: CLUSTER,
    affectsScore: false,
  },
  CLUSTER_SIGNAL_INSUFFICIENT_EVIDENCE: {
    label: 'Not enough group history for a reliable group signal',
    category: null,
    polarity: NEUTRAL,
    attribution: CLUSTER,
    affectsScore: false,
  },
};

/** Fixed emission order, so two runs produce byte-identical explanations. */
export const REASON_CODE_ORDER = Object.keys(REASON_CODES);

export function describeCode(code) {
  return REASON_CODES[code] ?? null;
}

export function isKnownCode(code) {
  return Object.prototype.hasOwnProperty.call(REASON_CODES, code);
}

/**
 * Build one emitted reason code.
 * `evidence` is the numbers it came from — the part that makes it checkable
 * rather than merely assertable.
 */
export function emit(code, evidence = {}) {
  const meta = REASON_CODES[code];
  if (!meta) throw new Error(`Unknown reason code: ${code}`);
  return {
    code,
    label: meta.label,
    category: meta.category,
    polarity: meta.polarity,
    attribution: meta.attribution,
    affectsScore: meta.affectsScore,
    ...(meta.guidance ? { guidance: meta.guidance } : {}),
    evidence,
  };
}

/** Sort emitted codes into catalogue order. */
export function inCatalogueOrder(codes) {
  const rank = new Map(REASON_CODE_ORDER.map((c, i) => [c, i]));
  return [...codes].sort((a, b) => (rank.get(a.code) ?? 999) - (rank.get(b.code) ?? 999));
}
