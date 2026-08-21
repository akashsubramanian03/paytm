/**
 * The lending partners a user can choose to share an underwriting report with.
 *
 * DELIBERATELY NOT A DATABASE TABLE. A partner here is demo scaffolding, not user
 * data: it has no lifecycle, nobody edits it at runtime, and keeping it frozen in
 * source means a report's `requested_by_partner_id` can be validated by a zod
 * enum instead of a foreign key lookup that could be spoofed by a client.
 *
 * NAMBIKAI IS NOT A LENDER. It originates a signal; a licensed NBFC underwrites
 * and disburses. Nothing in this codebase issues credit, holds lending risk, or
 * makes an approve/deny decision — the report says "here is what this applicant's
 * behaviour shows", and the partner decides.
 */
import { z } from 'zod';

export const PARTNERS = [
  {
    id: 'partner_demo_nbfc',
    displayName: 'Demo NBFC',
    type: 'NBFC',
    blurb: 'A simulated non-banking financial company that underwrites thin-file borrowers.',
  },
  {
    id: 'partner_demo_bank',
    displayName: 'Demo Small Finance Bank',
    type: 'BANK',
    blurb: 'A simulated small finance bank focused on micro and small enterprises.',
  },
  {
    id: 'partner_demo_mfi',
    displayName: 'Demo Microfinance',
    type: 'MFI',
    blurb: 'A simulated microfinance institution lending against group savings behaviour.',
  },
];

export const PARTNER_IDS = PARTNERS.map((p) => p.id);

export const partnerIdSchema = z.enum(PARTNER_IDS);

export function findPartner(id) {
  return PARTNERS.find((p) => p.id === id) ?? null;
}

/** Every partner-facing surface carries this, so the demo can never be mistaken
 *  for a real credit decision. */
export const PARTNER_DISCLAIMER =
  'Simulated lending partner. Nambikai does not lend, does not hold lending risk, and does not approve or decline credit. A licensed partner would make that decision using this report alongside their own underwriting.';
