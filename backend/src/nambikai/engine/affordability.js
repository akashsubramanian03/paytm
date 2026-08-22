/**
 * How much can this person actually afford?
 *
 * A risk band answers "will they repay". It does not answer "how much can they
 * carry" — and lending the wrong AMOUNT to a low-risk borrower is how a good
 * borrower is turned into a bad one. This module is the missing half.
 *
 * THREE DELIBERATE CHOICES:
 *
 * 1. INCOME IS THE MEDIAN, NOT THE MEAN. A chit payout, a festival bonus or one
 *    big invoice would drag a mean upward and manufacture capacity that does not
 *    exist month to month. The median is what a person can actually count on.
 *
 * 2. FOIR FALLS WITH INCOME. The industry default is a flat ratio, which quietly
 *    over-lends to the poorest: 30% of ₹12,000 leaves ₹8,400 to live on, 30% of
 *    ₹1,20,000 leaves ₹84,000. The people this product exists for are exactly
 *    the ones a flat ratio hurts. See FOIR_BANDS in constants.js.
 *
 * 3. A FIRST LOAN IS CAPPED regardless of affordability, and the cap lifts only
 *    as loans are closed on time. Thin-file lending fails when the first ticket
 *    is the size of the last one.
 *
 * The result names its BINDING CONSTRAINT — which of the limits actually bound —
 * so a screen can explain a number rather than assert it.
 *
 * PURE MODULE. No Prisma, no clock, no randomness, integer paise only.
 */
import {
  BINDING_CONSTRAINT,
  FIRST_LOAN_CEILING_PAISE,
  FOIR_BANDS,
  GRADUATION_MULTIPLIER_BPS,
  RISK_BAND,
} from '../constants.js';
import { medianInt, sumInt } from '../util/stats.js';
import { recent } from './signals.js';

/** The FOIR band an income falls in. */
export function foirBandFor(monthlyIncomePaise) {
  return FOIR_BANDS.find((b) => monthlyIncomePaise < b.maxIncomePaise) ?? FOIR_BANDS[FOIR_BANDS.length - 1];
}

/**
 * The EMI for a principal at a monthly rate, reducing balance.
 *
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1)
 *
 * Computed in integer paise with a scaled fixed-point power, so the same inputs
 * give the same paise on every machine. A zero rate degrades to P/n rather than
 * dividing by zero.
 */
export function emiFor(principalPaise, annualRateBps, tenureMonths) {
  if (principalPaise <= 0 || tenureMonths <= 0) return 0;
  if (annualRateBps <= 0) return Math.ceil(principalPaise / tenureMonths);

  // r as a scaled integer: rate per month in units of 1e-9.
  const SCALE = 1_000_000_000;
  const r = Math.round((annualRateBps * SCALE) / (12 * 10_000));

  // (1+r)^n, kept in the same scale.
  let pow = SCALE;
  for (let i = 0; i < tenureMonths; i += 1) {
    pow = Math.round((pow * (SCALE + r)) / SCALE);
  }

  const numerator = principalPaise * r * pow;
  const denominator = SCALE * (pow - SCALE);
  if (denominator <= 0) return Math.ceil(principalPaise / tenureMonths);
  return Math.ceil(numerator / denominator);
}

/**
 * The largest principal whose EMI does not exceed a ceiling.
 *
 * Binary search over emiFor rather than an algebraic inverse: the forward
 * function is the one that will actually be charged, so inverting it by search
 * guarantees the two can never disagree by a rounding step.
 */
export function principalFor(maxEmiPaise, annualRateBps, tenureMonths) {
  if (maxEmiPaise <= 0 || tenureMonths <= 0) return 0;
  let lo = 0;
  let hi = maxEmiPaise * tenureMonths; // interest-free upper bound
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (emiFor(mid, annualRateBps, tenureMonths) <= maxEmiPaise) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Flat-rate equivalent of a reducing-balance loan, for honest comparison. */
export function flatRateBpsFor(principalPaise, totalInterestPaise, tenureMonths) {
  if (principalPaise <= 0 || tenureMonths <= 0) return 0;
  const years = tenureMonths / 12;
  return Math.round((totalInterestPaise * 10_000) / (principalPaise * years));
}

/**
 * Assess capacity.
 *
 * @param {object} args
 * @param {object} args.fv            the FeatureVector
 * @param {string} args.band          the post-gate risk band
 * @param {boolean} args.eligible     the rule engine's eligibility flag
 * @param {number} args.activeEmiPaise  EMIs already being serviced
 * @param {number} args.closedLoanCount loans repaid in full
 * @param {number} args.annualRateBps
 * @param {number} args.tenureMonths
 * @param {number} [args.productMaxPaise]
 * @param {number} [args.requestedPaise]
 */
export function assessAffordability({
  fv,
  band,
  eligible,
  activeEmiPaise = 0,
  closedLoanCount = 0,
  annualRateBps,
  tenureMonths,
  productMaxPaise = Infinity,
  requestedPaise = Infinity,
}) {
  const n = Math.max(fv.ledger.activeMonths, 1);
  const inflows = recent(fv.ledger.monthlyInflowPaise, n);
  const outflows = recent(fv.ledger.monthlyOutflowPaise, n);

  const monthlyIncomePaise = medianInt(inflows);
  const typicalSpendPaise = medianInt(outflows);

  // Everything already promised each month: savings circles plus live EMIs.
  const groupCommitmentPaise = fv.group.committedPerCyclePaise ?? 0;
  const existingObligationsPaise = groupCommitmentPaise + activeEmiPaise;

  const bandInfo = foirBandFor(monthlyIncomePaise);
  const foirCeilingPaise = Math.floor((bandInfo.foirBps * monthlyIncomePaise) / 10_000);
  const maxEmiPaise = Math.max(foirCeilingPaise - existingObligationsPaise, 0);

  const evidence = {
    monthlyIncomePaise,
    typicalSpendPaise,
    groupCommitmentPaise,
    activeEmiPaise,
    existingObligationsPaise,
    foirCeilingPaise,
    incomeBand: bandInfo.label,
    monthsObserved: n,
  };

  // The rule engine already said no. Capacity is irrelevant.
  if (!eligible || band === RISK_BAND.HIGH) {
    return {
      eligible: false,
      maxEmiPaise: 0,
      maxPrincipalPaise: 0,
      foirBps: bandInfo.foirBps,
      incomeBand: bandInfo.label,
      bindingConstraint: BINDING_CONSTRAINT.INELIGIBLE,
      tenureMonths,
      annualRateBps,
      evidence,
    };
  }

  const affordablePrincipal = principalFor(maxEmiPaise, annualRateBps, tenureMonths);

  // Each limit, and the reason it exists. The smallest one wins, and we report
  // WHICH — a borrower shown a number they cannot account for assumes the worst.
  const bandCapPaise =
    band === RISK_BAND.MEDIUM ? Math.floor(affordablePrincipal / 2) : affordablePrincipal;

  const graduatedCapPaise =
    closedLoanCount === 0
      ? Math.min(FIRST_LOAN_CEILING_PAISE, monthlyIncomePaise)
      : Math.floor(
          (FIRST_LOAN_CEILING_PAISE * GRADUATION_MULTIPLIER_BPS ** Math.min(closedLoanCount, 4)) /
            10_000 ** Math.min(closedLoanCount, 4),
        );

  const limits = [
    { value: affordablePrincipal, why: BINDING_CONSTRAINT.FOIR },
    { value: bandCapPaise, why: BINDING_CONSTRAINT.RISK_BAND },
    { value: graduatedCapPaise, why: BINDING_CONSTRAINT.GRADUATED_CAP },
    { value: productMaxPaise, why: BINDING_CONSTRAINT.PRODUCT_MAX },
    { value: requestedPaise, why: BINDING_CONSTRAINT.REQUESTED },
  ].filter((l) => Number.isFinite(l.value));

  const binding = limits.reduce((min, l) => (l.value < min.value ? l : min), limits[0]);
  const maxPrincipalPaise = Math.max(binding.value, 0);

  return {
    eligible: maxPrincipalPaise > 0,
    maxEmiPaise: emiFor(maxPrincipalPaise, annualRateBps, tenureMonths),
    maxPrincipalPaise,
    foirBps: bandInfo.foirBps,
    incomeBand: bandInfo.label,
    bindingConstraint: binding.why,
    tenureMonths,
    annualRateBps,
    limits: limits.map((l) => ({ constraint: l.why, valuePaise: l.value })),
    evidence,
  };
}

/** Price a principal: EMI, total repayable, and the flat-rate equivalent. */
export function priceLoan(principalPaise, annualRateBps, tenureMonths) {
  const emiPaise = emiFor(principalPaise, annualRateBps, tenureMonths);
  const totalRepayablePaise = emiPaise * tenureMonths;
  const totalInterestPaise = Math.max(totalRepayablePaise - principalPaise, 0);
  return {
    principalPaise,
    emiPaise,
    tenureMonths,
    annualRateBps,
    totalRepayablePaise,
    totalInterestPaise,
    flatRateBps: flatRateBpsFor(principalPaise, totalInterestPaise, tenureMonths),
  };
}

/**
 * The amortisation schedule. Interest on the reducing balance each month, with
 * the final instalment absorbing the rounding so the sum of principal repaid is
 * exactly the principal borrowed — never a stray paisa either way.
 */
export function buildSchedule(principalPaise, annualRateBps, tenureMonths) {
  const emiPaise = emiFor(principalPaise, annualRateBps, tenureMonths);
  const rows = [];
  let outstanding = principalPaise;

  for (let i = 1; i <= tenureMonths; i += 1) {
    const interestPaise = Math.round((outstanding * annualRateBps) / (12 * 10_000));
    const last = i === tenureMonths;
    const principalPart = last ? outstanding : Math.min(emiPaise - interestPaise, outstanding);
    const amountDuePaise = last ? principalPart + interestPaise : emiPaise;
    outstanding -= principalPart;
    rows.push({
      installmentIndex: i,
      amountDuePaise,
      principalPaise: principalPart,
      interestPaise,
      outstandingAfterPaise: outstanding,
    });
  }

  return rows;
}

/** Total of a schedule's principal legs — used by a test to prove it closes. */
export const schedulePrincipalTotal = (rows) => sumInt(rows.map((r) => r.principalPaise));
