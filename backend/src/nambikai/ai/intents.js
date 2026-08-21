/**
 * What the assistant is willing to be asked.
 *
 * An allow-list, checked BEFORE any network call. An off-topic question is
 * refused locally: it costs nothing, it cannot leak anything, and it means the
 * assistant's scope is enforced by code rather than by hoping the system prompt
 * holds.
 *
 * The refusal is deliberately not a scolding. "I can only help with your own
 * Nambikai data" plus a few things it CAN answer is more useful than a lecture.
 */
// Patterns are written to tolerate plurals and inflections. A trailing \b after
// a singular noun silently fails on "groups", which would have made the most
// obvious question a user can ask — "how are my savings groups doing?" — miss
// the intent it was written for.
const INTENTS = [
  { key: 'SCORE', pattern: /\b(scores?|ratings?|grades?|nambikai)\b/i },
  { key: 'IMPROVE', pattern: /\b(improve|improving|increase|raise|better|higher|boost|fix|grow)\b/i },
  { key: 'GROUPS', pattern: /\b(groups?|circles?|chits?|contributions?|committees?|kitty)\b/i },
  { key: 'SAVINGS', pattern: /\b(sav(e|es|ed|ing|ings)|put aside|set aside)\b/i },
  { key: 'SPENDING', pattern: /\b(spend|spends|spending|spent|expenses?|outgo)\b/i },
  { key: 'INCOME', pattern: /\b(income|earn|earns|earning|earnings|salary|revenue|inflow)\b/i },
  { key: 'BILLS', pattern: /\b(bills?|recharges?|electricity|utility|utilities)\b/i },
  {
    key: 'BUFFER',
    // "how long would my balance last" is the plainest phrasing of this
    // question and contains none of the jargon words.
    pattern: /\b(buffer|emergency|cushion|reserve|rainy day|balances?|run out|how long.*(last|survive))\b/i,
  },
  { key: 'AFFORD', pattern: /\b(afford|borrow|borrowing|loans?|emi|repay|credit|eligible|eligibility)\b/i },
  { key: 'REPORT', pattern: /\b(reports?|lenders?|partners?|nbfc|banks?|underwrit)\b/i },
  { key: 'CONSENT', pattern: /\b(consent|permission|permissions|data|privacy|share|shared)\b/i },
  { key: 'BUSINESS', pattern: /\b(business|shop|stall|gst|invoices?|receivables?|suppliers?|customers?)\b/i },
];

export function classifyIntent(question) {
  const text = String(question ?? '');
  const matched = INTENTS.filter((i) => i.pattern.test(text)).map((i) => i.key);
  return { matched, onTopic: matched.length > 0 };
}

export const REFUSAL_TEXT =
  'I can only help with your own Nambikai data — your score, your savings groups, your spending and what a lender would see. Try asking why your score is what it is, or what would move it.';
