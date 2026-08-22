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

/**
 * Products live beside their partner, in source, for the same reason the
 * partners do: a product is scaffolding, not user data. Keeping them here means
 * a productKey on an application validates against a frozen enum rather than a
 * table row a client could point anywhere.
 *
 * `quotesFlat` records how the partner ADVERTISES the rate. Indian microlenders
 * routinely quote flat, which roughly doubles the apparent cost; the offer
 * screen shows both figures side by side whichever way a partner quotes.
 */
export const PARTNERS = [
  {
    id: 'partner_demo_nbfc',
    displayName: 'Demo NBFC',
    type: 'NBFC',
    blurb: 'A simulated non-banking financial company that underwrites thin-file borrowers.',
    products: [
      {
        key: 'nbfc_working_capital',
        name: 'Working Capital',
        type: 'WORKING_CAPITAL',
        rateBps: 2400,
        quotesFlat: true,
        minPaise: 500_000,
        maxPaise: 15_000_000,
        tenureMonths: [6, 9, 12],
        eligibleBands: ['LOW', 'MEDIUM'],
      },
      {
        key: 'nbfc_emergency',
        name: 'Emergency Credit',
        type: 'EMERGENCY',
        rateBps: 3000,
        quotesFlat: false,
        minPaise: 200_000,
        maxPaise: 5_000_000,
        tenureMonths: [3, 6],
        eligibleBands: ['LOW', 'MEDIUM'],
      },
    ],
  },
  {
    id: 'partner_demo_bank',
    displayName: 'Demo Small Finance Bank',
    type: 'BANK',
    blurb: 'A simulated small finance bank focused on micro and small enterprises.',
    products: [
      {
        key: 'bank_business_term',
        name: 'Business Term Loan',
        type: 'WORKING_CAPITAL',
        rateBps: 1800,
        quotesFlat: false,
        minPaise: 2_500_000,
        maxPaise: 50_000_000,
        tenureMonths: [12, 18, 24],
        // A bank prices lower and lends only to the strongest band.
        eligibleBands: ['LOW'],
      },
    ],
  },
  {
    id: 'partner_demo_mfi',
    displayName: 'Demo Microfinance',
    type: 'MFI',
    blurb: 'A simulated microfinance institution lending against group savings behaviour.',
    products: [
      {
        key: 'mfi_chit_advance',
        name: 'Savings-Circle Advance',
        type: 'CHIT_ADVANCE',
        rateBps: 2800,
        quotesFlat: true,
        minPaise: 200_000,
        maxPaise: 8_000_000,
        tenureMonths: [6, 12],
        eligibleBands: ['LOW', 'MEDIUM'],
        // The point of this product: a proven circle record IS the collateral.
        requiresGroupHistory: true,
      },
    ],
  },
];

export const PARTNER_IDS = PARTNERS.map((p) => p.id);

export const partnerIdSchema = z.enum(PARTNER_IDS);

export function findPartner(id) {
  return PARTNERS.find((p) => p.id === id) ?? null;
}

export const PRODUCTS = PARTNERS.flatMap((p) =>
  (p.products ?? []).map((product) => ({ ...product, partnerId: p.id, partnerName: p.displayName })),
);

export const PRODUCT_KEYS = PRODUCTS.map((p) => p.key);

export const productKeySchema = z.enum(PRODUCT_KEYS);

export function findProduct(key) {
  return PRODUCTS.find((p) => p.key === key) ?? null;
}

/** Products a subject could actually be offered, given their band and history. */
export function productsFor({ band, hasGroupHistory }) {
  return PRODUCTS.filter(
    (p) =>
      p.eligibleBands.includes(band) && (!p.requiresGroupHistory || hasGroupHistory),
  );
}

/** Every partner-facing surface carries this, so the demo can never be mistaken
 *  for a real credit decision. */
export const PARTNER_DISCLAIMER =
  'Simulated lending partner. Nambikai does not lend, does not hold lending risk, and does not approve or decline credit. A licensed partner would make that decision using this report alongside their own underwriting.';
