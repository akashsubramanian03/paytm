/**
 * The lending loop: consent → score → capacity → offers → application →
 * KYC → disbursement → schedule.
 *
 * A SIMULATED PARTNER LENDS. Nambikai computes the score and the capacity and
 * hands both to the partner's product rules; it does not decide, price, or hold
 * the risk. What it adds that a lender working from a bureau file cannot is the
 * second half of the question — a band says whether someone will repay, and
 * capacity says how much they can carry without being broken by it.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import {
  ACTOR,
  APPLICATION_STATUS,
  ARTIFACT_TYPE,
  BINDING_CONSTRAINT,
  INSTALLMENT_STATUS,
  LOAN_STATUS,
  OFFER_STATUS,
  PURPOSE,
  RISK_BAND,
  SUBJECT_TYPE,
} from '../constants.js';
import { requireConsent } from '../consent/consent.guard.js';
import * as audit from '../consent/audit.js';
import { buildUserFeatureVector } from '../features/featureVector.js';
import { scoreUser } from '../engine/scorecard.js';
import { applyRules } from '../engine/rules.js';
import { assessAffordability, buildSchedule, priceLoan } from '../engine/affordability.js';
import { buildDayProfile, bestDueDay, forecastShortfall } from '../engine/cashflow.js';
import { whatWouldChange } from '../engine/whatIf.js';
import { findProduct, productsFor, findPartner, PARTNER_DISCLAIMER } from '../partners.js';
import { monthsBetween, utcMonthStart } from '../util/window.js';
import { disburseLoan } from '../../lib/wallet.js';
import { assertKycVerified } from './kyc.pipeline.js';
import * as persist from './persist.js';

const OFFER_VALID_DAYS = 14;

/** The borrower's cash-flow shape, for choosing a due date. */
async function dayProfileFor(userId, { asOf, months = 12 }) {
  const windowStart = utcMonthStart(asOf, -(months - 1));
  const entries = await prisma.ledgerEntry.findMany({
    where: { userId, createdAt: { gte: windowStart, lte: asOf } },
    select: { createdAt: true, direction: true, amountPaise: true },
  });
  return buildDayProfile(entries, { months });
}

/**
 * What could this person borrow, and why that much?
 *
 * Returns capacity per product, or — when nothing is on offer — the specific
 * things that would change that. A decline with no route out is a wall, and for
 * someone with no credit history a wall with no visible door is exactly the
 * experience this whole product exists to remove.
 */
export async function assessEligibility({
  userId,
  user,
  asOf = new Date(),
  requestId,
  actorId,
  requestedPaise,
}) {
  const token = await requireConsent({
    subjectType: SUBJECT_TYPE.USER,
    subjectId: userId,
    purpose: PURPOSE.UNDERWRITING,
    actor: ACTOR.USER,
    actorId: actorId ?? userId,
    requestId,
    asOf,
  });

  const tenureMonths = user ? monthsBetween(user.createdAt, asOf) : 0;
  const fv = await buildUserFeatureVector(userId, { asOf, token, tenureMonths });
  const scoreResult = scoreUser(fv);
  const ruleResult = applyRules(scoreResult, fv);

  const stored = await persist.writeScore({
    subjectType: SUBJECT_TYPE.USER,
    subjectId: userId,
    scoreResult,
    ruleResult,
    inputsHash: fv.inputsHash,
    consentRecordId: token.primaryConsentId,
    computedAt: asOf,
  });
  await audit.logUse({ token, artifactType: ARTIFACT_TYPE.FINANCIAL_HEALTH_SCORE, artifactId: stored.id });

  const loans = fv.loans ?? {};
  const candidates = productsFor({
    band: ruleResult.band,
    hasGroupHistory: (fv.group.dueCount ?? 0) > 0,
  });

  const profile = await dayProfileFor(userId, { asOf });

  const offers = [];
  for (const product of candidates) {
    for (const tenure of product.tenureMonths) {
      const affordability = assessAffordability({
        fv,
        band: ruleResult.band,
        eligible: ruleResult.eligible,
        activeEmiPaise: loans.activeEmiPaise ?? 0,
        closedLoanCount: loans.closedLoanCount ?? 0,
        annualRateBps: product.rateBps,
        tenureMonths: tenure,
        productMaxPaise: product.maxPaise,
        requestedPaise: requestedPaise ?? Infinity,
      });

      // Below the product's floor there is no offer to make.
      if (!affordability.eligible || affordability.maxPrincipalPaise < product.minPaise) continue;

      const priced = priceLoan(affordability.maxPrincipalPaise, product.rateBps, tenure);
      const due = bestDueDay(profile, {
        openingPaise: fv.ledger.currentBalancePaise,
        emiPaise: priced.emiPaise,
      });

      offers.push({
        productKey: product.key,
        productName: product.name,
        productType: product.type,
        partnerId: product.partnerId,
        partnerName: product.partnerName,
        quotesFlat: product.quotesFlat,
        ...priced,
        suggestedDueDay: due.day,
        dueDayRationale: due.rationale,
        affordability,
      });
    }
  }

  // Best first: the most a partner will actually advance.
  offers.sort((a, b) => b.principalPaise - a.principalPaise);

  /**
   * WHY there is no offer, which is not one question but two.
   *
   * "We do not think you would repay" and "you are already borrowing as much
   * as is safe" are completely different messages, and collapsing them into a
   * single decline is misleading and needlessly demoralising. Someone at
   * capacity has done nothing wrong — they are being protected — and the
   * honest response says so and names what would change it.
   */
  let noOfferReason = null;
  if (!offers.length) {
    const capacity = assessAffordability({
      fv,
      band: ruleResult.band,
      eligible: ruleResult.eligible,
      activeEmiPaise: loans.activeEmiPaise ?? 0,
      closedLoanCount: loans.closedLoanCount ?? 0,
      annualRateBps: 2400,
      tenureMonths: 12,
    });

    const creditworthy = ruleResult.eligible && ruleResult.band !== RISK_BAND.HIGH;
    const obligations = capacity.evidence.existingObligationsPaise;
    const nearCeiling = capacity.maxEmiPaise * 4 < capacity.evidence.foirCeilingPaise;

    // An overdue instalment is the salient fact, and it outranks every other
    // explanation. Telling someone who is two payments behind that they are
    // merely "at capacity" buries the thing they most need to hear.
    if ((loans.maxDaysPastDue ?? 0) > 0) {
      noOfferReason = {
        kind: "IN_ARREARS",
        headline: "There is an overdue instalment on your current loan",
        detail:
          "Nambikai will not help you take on more while something is behind. Clearing it is also the fastest thing that moves your score back.",
        daysPastDue: loans.maxDaysPastDue,
        overdueCount: loans.overdueCount ?? 0,
        paths: [
          {
            key: "CLEAR_ARREARS",
            label: "Clear what is overdue",
            detail: "Recent instalments weigh more than older ones, so catching up moves the score faster than the misses held it down.",
          },
        ],
      };
    } else if (creditworthy && obligations > 0 && nearCeiling) {
      const freed = Math.round((loans.activeEmiPaise ?? 0) / 100).toLocaleString("en-IN");
      noOfferReason = {
        kind: "AT_CAPACITY",
        headline: "You are already borrowing about as much as is safe",
        detail:
          "This is not a judgement about you. What you already commit each month is close to the most Nambikai thinks you should carry on your income.",
        monthlyIncomePaise: capacity.evidence.monthlyIncomePaise,
        committedPaise: obligations,
        ceilingPaise: capacity.evidence.foirCeilingPaise,
        incomeBand: capacity.incomeBand,
        foirPct: capacity.foirBps / 100,
        paths: [
          ...(loans.activeLoanCount
            ? [{
                key: "FINISH_CURRENT_LOAN",
                label: "Finish your current loan",
                detail: "That frees Rs " + freed + " a month, and closing a loan also raises your ceiling.",
              }]
            : []),
          {
            key: "GROW_INCOME",
            label: "A higher income raises the ceiling",
            detail: "You are in the " + capacity.incomeBand + " band, where commitments are capped at " + (capacity.foirBps / 100) + "% of income.",
          },
        ],
      };
    } else if (!creditworthy) {
      noOfferReason = {
        kind: "NOT_YET_ELIGIBLE",
        headline: "Not eligible yet",
        detail: "There is not enough evidence, or something is holding the assessment back.",
        gates: ruleResult.gates.filter((g) => g.triggered).map((g) => g.code),
      };
    } else {
      noOfferReason = {
        kind: "BELOW_MINIMUM",
        headline: "No partner has a product this small",
        detail: "What you could safely borrow is below the smallest loan any partner offers.",
        maxPrincipalPaise: capacity.maxPrincipalPaise,
      };
    }
  }

  return {
    score: stored,
    scoreResult,
    ruleResult,
    fv,
    token,
    offers,
    eligible: offers.length > 0,
    noOfferReason,
    // Score-improving advice only when the SCORE is the problem. Offering it to
    // someone who is simply at capacity would be noise, and slightly insulting.
    whatWouldHelp:
      offers.length === 0 && noOfferReason?.kind === 'NOT_YET_ELIGIBLE' ? whatWouldChange(fv) : null,
    disclaimer: PARTNER_DISCLAIMER,
  };
}

/** Turn one chosen offer into a persisted application and offer row. */
export async function applyForLoan({
  userId,
  user,
  productKey,
  requestedPaise,
  purpose,
  asOf = new Date(),
  requestId,
  actorId,
}) {
  const product = findProduct(productKey);
  if (!product) throw ApiError.badRequest('UNKNOWN_PRODUCT', 'That loan product is not recognised.');

  const assessment = await assessEligibility({
    userId,
    user,
    asOf,
    requestId,
    actorId,
    requestedPaise,
  });

  const chosen = assessment.offers.find((o) => o.productKey === productKey);

  const application = await prisma.loanApplication.create({
    data: {
      userId,
      partnerId: product.partnerId,
      productKey,
      requestedPaise: requestedPaise ?? 0,
      purpose,
      status: chosen ? APPLICATION_STATUS.OFFERED : APPLICATION_STATUS.DECLINED,
      scoreId: assessment.score.id,
      affordability: JSON.stringify(chosen?.affordability ?? { bindingConstraint: BINDING_CONSTRAINT.INELIGIBLE }),
      declineReasonCodes: chosen
        ? null
        : JSON.stringify({
            band: assessment.ruleResult.band,
            eligible: assessment.ruleResult.eligible,
            gates: assessment.ruleResult.gates.filter((g) => g.triggered).map((g) => g.code),
            whatWouldHelp: assessment.whatWouldHelp?.scenarios ?? [],
          }),
      consentRecordId: assessment.token.primaryConsentId,
    },
  });

  if (!chosen) return { application, offer: null, assessment };

  const offer = await prisma.loanOffer.create({
    data: {
      applicationId: application.id,
      sanctionedPaise: chosen.principalPaise,
      rateBps: chosen.annualRateBps,
      flatRateBps: chosen.flatRateBps,
      tenureMonths: chosen.tenureMonths,
      emiPaise: chosen.emiPaise,
      totalRepayablePaise: chosen.totalRepayablePaise,
      totalInterestPaise: chosen.totalInterestPaise,
      suggestedDueDay: chosen.suggestedDueDay,
      dueDayRationale: JSON.stringify(chosen.dueDayRationale),
      expiresAt: new Date(asOf.getTime() + OFFER_VALID_DAYS * 86_400_000),
      status: OFFER_STATUS.OPEN,
    },
  });

  return { application, offer, assessment };
}

/**
 * Accept an offer: gate on KYC, disburse through wallet.js, write the schedule.
 *
 * The disbursement and the loan row are created in that order deliberately —
 * the ledger entry is the fact, and the loan record points at it. A loan that
 * existed without a matching credit would be a claim the passbook could not
 * corroborate.
 */
export async function acceptOffer({ userId, offerId, dueDayOverride, asOf = new Date(), requestId }) {
  const offer = await prisma.loanOffer.findFirst({
    where: { id: offerId, application: { userId } },
    include: { application: true },
  });
  if (!offer) throw ApiError.notFound('Offer not found.');
  if (offer.status !== OFFER_STATUS.OPEN) {
    throw ApiError.conflict('OFFER_NOT_OPEN', 'That offer is no longer open.');
  }
  if (offer.expiresAt < asOf) {
    await prisma.loanOffer.update({ where: { id: offer.id }, data: { status: OFFER_STATUS.EXPIRED } });
    throw ApiError.conflict('OFFER_EXPIRED', 'That offer has expired. Ask for a fresh one.');
  }

  // The gate. A partner cannot pay out to an unverified identity.
  await assertKycVerified(userId);

  const partner = findPartner(offer.application.partnerId);
  const dueDay = Math.min(Math.max(dueDayOverride ?? offer.suggestedDueDay, 1), 28);

  const { entry } = await disburseLoan({
    userId,
    amountPaise: offer.sanctionedPaise,
    loanId: offer.id,
    partnerName: partner?.displayName ?? 'Lending partner',
    note: `Loan from ${partner?.displayName ?? 'partner'}`,
  });

  const loan = await prisma.loan.create({
    data: {
      userId,
      applicationId: offer.applicationId,
      offerId: offer.id,
      partnerId: offer.application.partnerId,
      principalPaise: offer.sanctionedPaise,
      rateBps: offer.rateBps,
      tenureMonths: offer.tenureMonths,
      emiPaise: offer.emiPaise,
      dueDayOfMonth: dueDay,
      disbursedAt: asOf,
      disbursementLedgerEntryId: entry.id,
      status: LOAN_STATUS.ACTIVE,
      outstandingPaise: offer.sanctionedPaise,
    },
  });

  const rows = buildSchedule(offer.sanctionedPaise, offer.rateBps, offer.tenureMonths);
  await prisma.loanInstallment.createMany({
    data: rows.map((r) => ({
      loanId: loan.id,
      installmentIndex: r.installmentIndex,
      dueAt: installmentDueDate(asOf, dueDay, r.installmentIndex),
      amountDuePaise: r.amountDuePaise,
      principalPaise: r.principalPaise,
      interestPaise: r.interestPaise,
      status: INSTALLMENT_STATUS.PENDING,
    })),
  });

  await prisma.loanOffer.update({ where: { id: offer.id }, data: { status: OFFER_STATUS.ACCEPTED } });
  await prisma.loanApplication.update({
    where: { id: offer.applicationId },
    data: { status: APPLICATION_STATUS.ACCEPTED },
  });

  return { loan, disbursement: entry };
}

/**
 * The nth instalment date: the chosen day of month, n months out.
 * Day is capped at 28 so no month can silently shift a due date.
 */
export function installmentDueDate(disbursedAt, dueDayOfMonth, index) {
  const d = new Date(disbursedAt);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + index, Math.min(dueDayOfMonth, 28), 10, 0, 0, 0),
  );
}

export { forecastShortfall, dayProfileFor };
