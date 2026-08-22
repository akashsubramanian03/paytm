/**
 * Every string domain used by Nambikai, in one place.
 *
 * The schema stores these as plain String columns (matching the wallet models),
 * so this file is the only thing standing between us and a typo'd status. Import
 * from here rather than writing the literal.
 *
 * ORDER MATTERS in CATEGORY_KEYS and SME_CATEGORY_KEYS: the scorecard iterates
 * those arrays, never Object.keys() of a map built from database rows. Object key
 * order is stable in V8 for string keys but the arrays make the guarantee
 * explicit and reviewable, and they fix which category absorbs the integer
 * remainder when weights are redistributed.
 */

export const SUBJECT_TYPE = { USER: 'USER', BUSINESS: 'BUSINESS' };

export const GROUP_PURPOSE = {
  SAVINGS: 'SAVINGS',
  ROTATING_SAVINGS: 'ROTATING_SAVINGS',
  EMERGENCY_FUND: 'EMERGENCY_FUND',
  BUSINESS_POOL: 'BUSINESS_POOL',
};

export const CADENCE = { WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' };

export const GROUP_STATUS = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  DISSOLVED: 'DISSOLVED',
};

export const MEMBER_ROLE = { ADMIN: 'ADMIN', MEMBER: 'MEMBER' };
export const MEMBER_STATUS = { ACTIVE: 'ACTIVE', EXITED: 'EXITED', REMOVED: 'REMOVED' };

export const CONTRIB_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  LATE: 'LATE',
  MISSED: 'MISSED',
  WAIVED: 'WAIVED',
};

/** Statuses a contribution can be paid FROM. Used by the conditional update that
 *  makes double-paying impossible. */
export const PAYABLE_CONTRIB_STATUSES = [CONTRIB_STATUS.PENDING, CONTRIB_STATUS.LATE];

export const SIGNAL_KEY = {
  SAVINGS_CONSISTENCY: 'SAVINGS_CONSISTENCY',
  PAYMENT_CONSISTENCY: 'PAYMENT_CONSISTENCY',
  INCOME_STABILITY: 'INCOME_STABILITY',
  REPAYMENT_BEHAVIOUR: 'REPAYMENT_BEHAVIOUR',
};

export const DATA_TYPE = {
  WALLET_LEDGER: 'WALLET_LEDGER',
  GROUP_CONTRIBUTIONS: 'GROUP_CONTRIBUTIONS',
  BILL_PAYMENTS: 'BILL_PAYMENTS',
  RECHARGE_HISTORY: 'RECHARGE_HISTORY',
  CLUSTER_TRUST_SIGNAL: 'CLUSTER_TRUST_SIGNAL',
  BUSINESS_GST: 'BUSINESS_GST',
  BUSINESS_INVOICES: 'BUSINESS_INVOICES',
  LOAN_HISTORY: 'LOAN_HISTORY',
  REPAYMENT_HISTORY: 'REPAYMENT_HISTORY',
};

/** Plain-language labels for the consent screen. The user must be able to read
 *  what they are agreeing to without a glossary. */
export const DATA_TYPE_LABEL = {
  WALLET_LEDGER: 'Your Paytm wallet activity',
  GROUP_CONTRIBUTIONS: 'Your savings group contributions',
  BILL_PAYMENTS: 'Your bill payment history',
  RECHARGE_HISTORY: 'Your mobile recharge history',
  CLUSTER_TRUST_SIGNAL: 'Your savings group’s overall reliability',
  BUSINESS_GST: 'Your business GST filings',
  BUSINESS_INVOICES: 'Your business invoices and receivables',
  LOAN_HISTORY: 'Loans you have taken through Paytm',
  REPAYMENT_HISTORY: 'How you repaid them',
};

export const PURPOSE = {
  HEALTH_SCORE: 'HEALTH_SCORE',
  UNDERWRITING: 'UNDERWRITING',
  ASSISTANT: 'ASSISTANT',
  SME_UNDERWRITING: 'SME_UNDERWRITING',
  LOAN_SERVICING: 'LOAN_SERVICING',
};

export const PURPOSE_LABEL = {
  HEALTH_SCORE: 'Show you your financial health score',
  UNDERWRITING: 'Share an assessment with a lending partner you choose',
  ASSISTANT: 'Answer your questions about your own money',
  SME_UNDERWRITING: 'Share a business assessment with a lending partner you choose',
  LOAN_SERVICING: 'Run a loan you have taken — schedule, reminders and repayment',
};

export const RISK_BAND = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };

/** Higher rank is worse. engine/rules.js uses this to guarantee a gate can only
 *  downgrade a band, never improve it. */
export const BAND_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export const GRADE = {
  BUILDING: 'BUILDING',
  FAIR: 'FAIR',
  GOOD: 'GOOD',
  STRONG: 'STRONG',
};

export const CLUSTER_BAND = {
  POSITIVE: 'POSITIVE',
  NEUTRAL: 'NEUTRAL',
  CAUTION: 'CAUTION',
};

export const CLUSTER_TYPE = { GROUP: 'GROUP' };

/**
 * Why a report carries no cluster signal. One of these is ALWAYS set when
 * cluster_signal is null — the field is never silently absent, because "we did
 * not look" and "we looked and found nothing" are different disclosures.
 */
export const CLUSTER_OMISSION = {
  NOT_CONSENTED: 'NOT_CONSENTED',
  SUPPRESSED_APPEAL: 'SUPPRESSED_APPEAL',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  NO_CLUSTER: 'NO_CLUSTER',
};

export const APPEAL_STATUS = {
  OPEN: 'OPEN',
  UPHELD: 'UPHELD',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
};

/** While an appeal is in one of these states the cluster signal is suppressed
 *  from every report for that user, at read time, with no recompute. */
export const APPEAL_SUPPRESSING_STATUSES = [APPEAL_STATUS.OPEN, APPEAL_STATUS.UPHELD];

export const AUDIT_ACTION = {
  GRANT: 'GRANT',
  REVOKE: 'REVOKE',
  USE: 'USE',
  DENY: 'DENY',
  EXPIRE: 'EXPIRE',
};

export const ACTOR = { USER: 'USER', ENGINE: 'ENGINE', PARTNER: 'PARTNER' };

export const ARTIFACT_TYPE = {
  FINANCIAL_HEALTH_SCORE: 'FINANCIAL_HEALTH_SCORE',
  UNDERWRITING_REPORT: 'UNDERWRITING_REPORT',
  ASSISTANT_TURN: 'ASSISTANT_TURN',
};

export const ATTRIBUTION = { INDIVIDUAL: 'INDIVIDUAL', CLUSTER: 'CLUSTER' };
export const POLARITY = { POSITIVE: 'POSITIVE', NEGATIVE: 'NEGATIVE', NEUTRAL: 'NEUTRAL' };

export const EXPLAINER_SOURCE = { LLM: 'LLM', TEMPLATE: 'TEMPLATE' };

export const BUSINESS_SECTOR = {
  RETAIL: 'RETAIL',
  FOOD: 'FOOD',
  SERVICES: 'SERVICES',
  MANUFACTURING: 'MANUFACTURING',
  TRANSPORT: 'TRANSPORT',
  AGRI: 'AGRI',
};

export const RECORD_KIND = {
  GST_FILING: 'GST_FILING',
  INVOICE: 'INVOICE',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
};

export const RECORD_STATUS = {
  FILED: 'FILED',
  LATE: 'LATE',
  PENDING: 'PENDING',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  WRITTEN_OFF: 'WRITTEN_OFF',
};

export const TRUST_RELATION = {
  GROUP_MEMBER: 'GROUP_MEMBER',
  EMPLOYER: 'EMPLOYER',
  SUPPLIER: 'SUPPLIER',
  CUSTOMER: 'CUSTOMER',
};

/* ------------------------------------------------- scorecard categories -- */

export const CATEGORY = {
  INCOME_STABILITY: 'INCOME_STABILITY',
  SAVINGS_CONSISTENCY: 'SAVINGS_CONSISTENCY',
  PAYMENT_BEHAVIOUR: 'PAYMENT_BEHAVIOUR',
  COMMITMENTS: 'COMMITMENTS',
  REPAYMENT_TRACK_RECORD: 'REPAYMENT_TRACK_RECORD',
  CREDIT_HISTORY: 'CREDIT_HISTORY',
  EMERGENCY_BUFFER: 'EMERGENCY_BUFFER',
};

/** Fixed iteration order. The first entry absorbs the integer remainder when
 *  weights are redistributed, so this order is part of the scoring contract. */
export const CATEGORY_KEYS = [
  CATEGORY.INCOME_STABILITY,
  CATEGORY.SAVINGS_CONSISTENCY,
  CATEGORY.PAYMENT_BEHAVIOUR,
  CATEGORY.COMMITMENTS,
  CATEGORY.REPAYMENT_TRACK_RECORD,
  CATEGORY.CREDIT_HISTORY,
  CATEGORY.EMERGENCY_BUFFER,
];

/** Basis points. Must sum to exactly 10000 — asserted by a test. */
/**
 * Basis points. Must sum to exactly 10000 — asserted by a test.
 *
 * REPAYMENT_TRACK_RECORD carries real weight because actual repaid credit is
 * far stronger evidence than anything the engine can infer. It is also, for
 * almost everyone here, UNMEASURED — nobody starts with a loan. An unmeasured
 * category gives its weight back pro rata (see redistributeWeights), so adding
 * it barely moves the score of someone who has never borrowed, and only starts
 * to matter once there is a repayment record to matter about.
 */
export const CATEGORY_WEIGHTS_BPS = {
  INCOME_STABILITY: 1700,
  SAVINGS_CONSISTENCY: 1700,
  PAYMENT_BEHAVIOUR: 1700,
  COMMITMENTS: 1600,
  REPAYMENT_TRACK_RECORD: 1500,
  CREDIT_HISTORY: 1000,
  EMERGENCY_BUFFER: 800,
};

export const CATEGORY_LABEL = {
  INCOME_STABILITY: 'Income stability',
  SAVINGS_CONSISTENCY: 'Savings consistency',
  PAYMENT_BEHAVIOUR: 'Payment behaviour',
  COMMITMENTS: 'Commitments kept',
  REPAYMENT_TRACK_RECORD: 'Loan repayment record',
  CREDIT_HISTORY: 'Credit history',
  EMERGENCY_BUFFER: 'Emergency buffer',
};

/**
 * Shown verbatim in the UI. CREDIT_HISTORY especially: Nambikai has no bureau
 * access, so the category measures peer repayment and account tenure, and the
 * user is told exactly that rather than being left to assume a CIBIL pull.
 */
export const CATEGORY_DESCRIPTION = {
  INCOME_STABILITY: 'How steady and predictable your money coming in has been.',
  SAVINGS_CONSISTENCY: 'Whether you hold on to some of what you earn, month after month.',
  PAYMENT_BEHAVIOUR: 'How regularly you pay bills and recharges, and how often payments fail.',
  COMMITMENTS: 'Your record of paying savings-group contributions on time.',
  REPAYMENT_TRACK_RECORD:
    'How you have repaid credit taken through Paytm. Recent months count for more than older ones, in both directions.',
  CREDIT_HISTORY:
    'Nambikai has no credit-bureau access. This measures how long you have been on Paytm and whether you repay money lent to you by people you know.',
  EMERGENCY_BUFFER: 'How many days of your usual spending your balance could cover.',
};

/* ------------------------------------------------------- SME categories -- */

export const SME_CATEGORY = {
  SME_REVENUE_STABILITY: 'SME_REVENUE_STABILITY',
  SME_INFLOW_CONSISTENCY: 'SME_INFLOW_CONSISTENCY',
  SME_RECEIVABLES_QUALITY: 'SME_RECEIVABLES_QUALITY',
  SME_LEVERAGE: 'SME_LEVERAGE',
  SME_COMPLIANCE: 'SME_COMPLIANCE',
  SME_OWNER_COMMITMENTS: 'SME_OWNER_COMMITMENTS',
};

export const SME_CATEGORY_KEYS = [
  SME_CATEGORY.SME_REVENUE_STABILITY,
  SME_CATEGORY.SME_INFLOW_CONSISTENCY,
  SME_CATEGORY.SME_RECEIVABLES_QUALITY,
  SME_CATEGORY.SME_LEVERAGE,
  SME_CATEGORY.SME_COMPLIANCE,
  SME_CATEGORY.SME_OWNER_COMMITMENTS,
];

/** Basis points. Must sum to exactly 10000 — asserted by a test. */
export const SME_CATEGORY_WEIGHTS_BPS = {
  SME_REVENUE_STABILITY: 2200,
  SME_INFLOW_CONSISTENCY: 1800,
  SME_RECEIVABLES_QUALITY: 1600,
  SME_LEVERAGE: 1600,
  SME_COMPLIANCE: 1400,
  SME_OWNER_COMMITMENTS: 1400,
};

export const SME_CATEGORY_LABEL = {
  SME_REVENUE_STABILITY: 'Revenue stability',
  SME_INFLOW_CONSISTENCY: 'Customer inflow consistency',
  SME_RECEIVABLES_QUALITY: 'Receivables quality',
  SME_LEVERAGE: 'Debt load',
  SME_COMPLIANCE: 'GST compliance',
  SME_OWNER_COMMITMENTS: 'Owner’s savings-group record',
};

export const SME_CATEGORY_DESCRIPTION = {
  SME_REVENUE_STABILITY: 'How steady your invoiced revenue has been, month to month.',
  SME_INFLOW_CONSISTENCY: 'How reliably your repeat customers keep paying you.',
  SME_RECEIVABLES_QUALITY: 'How quickly customers settle, and how much is overdue.',
  SME_LEVERAGE: 'How large your existing debt is relative to monthly revenue.',
  SME_COMPLIANCE: 'Whether GST filings have gone in on time.',
  SME_OWNER_COMMITMENTS:
    'The owner’s own savings-group record. This is the owner’s personal behaviour, not any other member’s.',
};

/* ------------------------------------------------------- scoring bounds -- */

export const BPS_MAX = 10000;

/** Risk band thresholds on the 0..100 score. */
export const BAND_THRESHOLDS = { LOW_MIN: 70, MEDIUM_MIN: 45 };

/** Consumer-facing grade thresholds on the 0..100 score. */
export const GRADE_THRESHOLDS = { STRONG_MIN: 80, GOOD_MIN: 60, FAIR_MIN: 40 };

/** Cluster reliability band thresholds, in basis points. */
export const CLUSTER_BAND_THRESHOLDS = { POSITIVE_MIN: 7500, NEUTRAL_MIN: 4000 };

/** A cluster below either of these is reported as INSUFFICIENT_EVIDENCE rather
 *  than being given a fabricated number. */
export const CLUSTER_MIN_OBSERVATIONS = 12;
export const CLUSTER_MIN_ACTIVE_MEMBERS = 3;

/** Rolling window the engine scores over. */
export const DEFAULT_WINDOW_MONTHS = 12;
export const DEFAULT_WINDOW_DAYS = 365;

/* ---------------------------------------------------------------- lending -- */

export const LOAN_PURPOSE = {
  WORKING_CAPITAL: 'WORKING_CAPITAL',
  EMERGENCY: 'EMERGENCY',
  FAMILY: 'FAMILY',
  EQUIPMENT: 'EQUIPMENT',
  OTHER: 'OTHER',
};

export const APPLICATION_STATUS = {
  SUBMITTED: 'SUBMITTED',
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
  WITHDRAWN: 'WITHDRAWN',
};

export const OFFER_STATUS = {
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
};

export const LOAN_STATUS = { ACTIVE: 'ACTIVE', CLOSED: 'CLOSED', WRITTEN_OFF: 'WRITTEN_OFF' };

export const INSTALLMENT_STATUS = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  LATE: 'LATE',
  MISSED: 'MISSED',
  WAIVED: 'WAIVED',
};

/** Statuses an installment can be paid FROM. Used by the conditional update
 *  that makes double-paying impossible. */
export const PAYABLE_INSTALLMENT_STATUSES = [
  INSTALLMENT_STATUS.PENDING,
  INSTALLMENT_STATUS.LATE,
  INSTALLMENT_STATUS.MISSED,
];

export const KYC_STATUS = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', FAILED: 'FAILED' };
export const KYC_ID_TYPE = { PAN: 'PAN', AADHAAR: 'AADHAAR' };

export const ANOMALY_KIND = {
  CIRCULAR_TRANSFER: 'CIRCULAR_TRANSFER',
  VELOCITY_SPIKE: 'VELOCITY_SPIKE',
  INCONSISTENT_WITH_BUSINESS: 'INCONSISTENT_WITH_BUSINESS',
};

/**
 * Income-banded FOIR: the share of monthly income that may go to servicing debt.
 *
 * THE BANDS FALL WITH INCOME, DELIBERATELY. A flat ratio — the industry default
 * — quietly over-lends to the poorest, because 30% of ₹12,000 leaves ₹8,400 to
 * live on while 30% of ₹1,20,000 leaves ₹84,000. The people this product exists
 * for are exactly the ones a flat ratio hurts, so capacity is capped harder the
 * less there is to spare.
 *
 * Ordered low to high; the first band whose ceiling the income falls under wins.
 */
export const FOIR_BANDS = [
  { maxIncomePaise: 1_500_000, foirBps: 2000, label: 'under ₹15,000' },
  { maxIncomePaise: 3_000_000, foirBps: 3000, label: '₹15,000–₹30,000' },
  { maxIncomePaise: 6_000_000, foirBps: 4000, label: '₹30,000–₹60,000' },
  { maxIncomePaise: Infinity, foirBps: 5000, label: 'over ₹60,000' },
];

/** A first loan is capped regardless of affordability. The ceiling lifts as
 *  loans are closed on time — the safe way to lend to a thin file. */
export const FIRST_LOAN_CEILING_PAISE = 1_500_000; // ₹15,000
export const GRADUATION_MULTIPLIER_BPS = 15_000; // each closed loan raises the cap 1.5x

/** What bound the offer. Named so the UI can explain a number, not assert it. */
export const BINDING_CONSTRAINT = {
  FOIR: 'FOIR',
  RISK_BAND: 'RISK_BAND',
  GRADUATED_CAP: 'GRADUATED_CAP',
  PRODUCT_MAX: 'PRODUCT_MAX',
  REQUESTED: 'REQUESTED',
  INELIGIBLE: 'INELIGIBLE',
};
