/**
 * Deterministic prose, assembled from reason codes.
 *
 * This is not a fallback in the apologetic sense. It is the floor the product
 * stands on: with no API key, no network, or a model outage, every explanation
 * still gets written, from the same codes, in the same order, with the same
 * numbers. The same input produces byte-identical output — a test asserts it.
 *
 * That property is what lets `explainerSource` be an honest label rather than a
 * disclaimer. A reviewer can always tell which wrote a given piece of prose, and
 * neither one invented the score.
 */
import { REASON_CODE_ORDER, REASON_CODES } from '../engine/reasonCodes.js';

/**
 * The catalogue is the source of truth for a code's wording.
 *
 * Callers pass code objects from several places — some carry a label, some carry
 * only a code and its evidence. Reading the label from the catalogue instead of
 * from the caller means the prose cannot break depending on which path built the
 * list, and the wording stays in one place.
 */
const labelOf = (code) => REASON_CODES[code]?.label ?? code;

const GRADE_OPENER = {
  STRONG: 'has a strong and consistent record',
  GOOD: 'has a solid record',
  FAIR: 'has a real but uneven record',
  BUILDING: 'is still building a record',
};

const BAND_PHRASE = {
  LOW: 'sits in the lower-risk band',
  MEDIUM: 'sits in the middle-risk band',
  HIGH: 'sits in the higher-risk band',
};

/** Short clauses, written to be joined into a sentence. */
const FRAGMENT = {
  GROUP_PERFECT_RECORD: (e) => `every one of ${e.settledCycles} savings-group contributions paid on time`,
  GROUP_ON_TIME_STREAK: (e) => `${e.onTime} of ${e.settledCycles} contributions paid on time`,
  GROUP_TENURE_LONG: (e) => `${e.monthsInAnyGroup} months of unbroken savings-circle membership`,
  GROUP_MULTIPLE: (e) => `commitments kept across ${e.activeGroups} separate circles`,
  INCOME_STEADY: () => 'steady month-to-month earnings',
  INCOME_TREND_UP: () => 'earnings that have grown recently',
  SAVINGS_CONSISTENT: (e) => `money retained in ${e.monthsSavedSomething} of ${e.monthsObserved} months`,
  GROUP_SAVINGS_STRONG: () => 'a meaningful share of earnings committed to savings circles',
  BILLS_REGULAR: (e) => `bills or recharges paid in ${e.monthsWithFormalPayment} of ${e.monthsObserved} months`,
  BUFFER_HEALTHY: (e) => `a balance covering about ${e.bufferDays} days of usual spending`,
  TENURE_ESTABLISHED: (e) => `${e.accountTenureMonths} months of account history`,
  PEER_REPAYMENT_STRONG: () => 'money borrowed from others reliably returned',
  COUNTERPARTY_DEPTH: (e) => `regular dealings with ${e.distinctCounterparties} different people`,

  GROUP_MISSED: (e) => `${e.missed} missed contributions out of ${e.settledCycles}`,
  GROUP_RECENT_MISSES: (e) => `${e.recentMissed} of the last ${e.recentCycles} contributions missed`,
  GROUP_LATE_PATTERN: (e) => `${e.late} contributions paid late, by ${e.avgDaysLate} days on average`,
  LOW_EMERGENCY_BUFFER: (e) => `a buffer of roughly ${e.bufferDays} days of spending`,
  NEGATIVE_NET_FLOW: (e) => `spending exceeding income in ${e.monthsSpentMoreThanEarned} of ${e.monthsObserved} months`,
  INCOME_VOLATILE: () => 'earnings that vary sharply between months',
  INCOME_TREND_DOWN: () => 'earnings that have fallen recently',
  INCOME_GAPS: (e) => `${e.monthsWithoutIncome} months with no income at all`,
  SAVINGS_THIN: () => 'very little retained from what is earned',
  BILLS_IRREGULAR: () => 'bills and recharges paid only occasionally',
  PAYMENT_STRAIN: () => 'a balance that often runs close to empty after paying',
  PAYMENT_FAILURES: (e) => `${e.failedCount} failed payments`,
  BUFFER_VOLATILE: () => 'a balance that swings widely between months',
  PEER_REPAYMENT_WEAK: () => 'money received from others not always returned',
  TENURE_SHORT: (e) => `only ${e.accountTenureMonths} months of account history`,
};

const GATE_SENTENCE = {
  GATE_INSUFFICIENT_HISTORY: (e) =>
    `Nambikai has only ${e.monthsObserved} months of activity to look at, below the ${e.monthsRequired} it needs, so this assessment is marked not yet eligible rather than being estimated.`,
  GATE_DORMANT: (e) =>
    `The account has been inactive for ${e.daysSinceLastActivity} days, so recent behaviour cannot be observed.`,
  GATE_MISSED_COMMITMENTS: (e) =>
    `${e.recentMissed} of the last ${e.recentCycles} savings-group contributions were missed, which holds the risk band at medium regardless of the score.`,
  GATE_NEGATIVE_TREND: (e) =>
    `Spending has been running ahead of income with only about ${e.bufferDays} days of reserve, which holds the risk band at medium.`,
};

const rank = new Map(REASON_CODE_ORDER.map((code, i) => [code, i]));

/** Codes in catalogue order, so two runs read identically. */
function ordered(codes, polarity) {
  return codes
    .filter((c) => c.polarity === polarity && FRAGMENT[c.code])
    .sort((a, b) => (rank.get(a.code) ?? 999) - (rank.get(b.code) ?? 999));
}

function clause(codes, polarity, limit) {
  const picked = ordered(codes, polarity).slice(0, limit);
  const parts = picked.map((c) => FRAGMENT[c.code](c.evidence ?? {}));
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The recommendation paragraph on an underwriting report.
 *
 * Careful about what it does NOT say: it never recommends approving or declining
 * anything. Nambikai does not lend and does not hold lending risk; the report
 * describes behaviour and leaves the decision where it belongs.
 */
export function renderRecommendation(context) {
  const { subject, score, reason_codes: codes, gates, eligible, cluster_signal: cluster } = context;
  const all = codes.map((c) => ({ ...c, evidence: c.evidence ?? {} }));

  // The template works from the SAME code list the model would get, but it needs
  // evidence numbers the model context deliberately omits. Callers pass the rich
  // codes; this guards against the lean ones.
  const positives = clause(all, 'POSITIVE', 3);
  const negatives = clause(all, 'NEGATIVE', 2);

  const sentences = [];
  sentences.push(
    `${subject.display_name} ${GRADE_OPENER[score.grade] ?? 'has a record'} and ${BAND_PHRASE[score.band] ?? 'has been assessed'}, with a Nambikai score of ${score.value} out of 100.`,
  );

  if (positives) sentences.push(`The strongest evidence is ${positives}.`);
  if (negatives) sentences.push(`Against that, the assessment notes ${negatives}.`);

  for (const gate of gates ?? []) {
    const line = GATE_SENTENCE[gate.code];
    if (line) sentences.push(line(gate.evidence ?? {}));
  }

  if (cluster) {
    sentences.push(
      `Separately, the savings group this applicant belongs to has a collective reliability of ${cluster.reliability_pct}% (${cluster.band.toLowerCase()}). This describes the group, not the applicant, and has not been blended into the individual score.`,
    );
  }

  sentences.push(
    'Nambikai holds no credit-bureau record for this applicant; the assessment rests entirely on wallet activity and savings-group behaviour. Nambikai does not lend and makes no approval decision.',
  );

  if (eligible === false) {
    sentences.push('On this evidence Nambikai does not consider the applicant assessable yet.');
  }

  return sentences.join(' ');
}

/** The plain-language summary a person sees about their own score. */
export function renderPersonalSummary(context) {
  const { score, reason_codes: codes } = context;
  const all = codes.map((c) => ({ ...c, evidence: c.evidence ?? {} }));
  const positives = clause(all, 'POSITIVE', 2);
  const negatives = clause(all, 'NEGATIVE', 2);

  const sentences = [`Your score is ${score.value} out of 100.`];
  if (positives) sentences.push(`What is helping most: ${positives}.`);
  if (negatives) sentences.push(`What is holding it back: ${negatives}.`);
  else sentences.push('Nothing in your record is currently holding it back.');
  return sentences.join(' ');
}

/**
 * Answers built from facts, for when there is no model available.
 * Terse and honest rather than chatty — a template pretending to be a
 * conversation is worse than a template that plainly answers.
 */
export function renderAnswer(intents, context) {
  const { score, facts, reason_codes: codes } = context;
  const all = codes.map((c) => ({ ...c, evidence: c.evidence ?? {} }));

  if (intents.includes('AFFORD')) {
    return [
      `Nambikai does not decide what you can borrow — a lender does, and it would use its own checks alongside this.`,
      `What it can tell you: your score is ${score.value} out of 100, your balance covers roughly ${facts.buffer_days ?? 'an unknown number of'} days of your usual spending, and you currently commit ${facts.monthly_commitment_band ?? 'nothing'} a month to savings circles.`,
    ].join(' ');
  }

  if (intents.includes('IMPROVE')) {
    const negatives = ordered(all, 'NEGATIVE').slice(0, 2);
    if (!negatives.length) {
      return `Your score is ${score.value} out of 100 and nothing in your record is holding it back. Keeping up what you already do is what maintains it.`;
    }
    const named = negatives.map((c) => labelOf(c.code).toLowerCase());
    return `${named.length === 1 ? 'The thing' : 'The two things'} holding your score back: ${named.join(', and ')}. That is where a change would move it most.`;
  }

  if (intents.includes('GROUPS') || intents.includes('SAVINGS')) {
    return `You have ${facts.active_groups ?? 0} active savings ${facts.active_groups === 1 ? 'circle' : 'circles'}. Of ${facts.settled_cycles ?? 0} settled contributions, ${facts.on_time ?? 0} were on time and ${facts.missed ?? 0} were missed.`;
  }

  if (intents.includes('BUFFER')) {
    return `Your balance would cover about ${facts.buffer_days ?? 'an unknown number of'} days of your usual spending. Nambikai treats 45 days as a healthy buffer.`;
  }

  if (intents.includes('SCORE') || intents.includes('SPENDING') || intents.includes('INCOME')) {
    return renderPersonalSummary(context);
  }

  return renderPersonalSummary(context);
}
