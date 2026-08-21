import { cx } from '../primitives.jsx';

/**
 * The partner-facing risk band.
 *
 * This component exists ONLY for the report screen, which is explicitly a
 * preview of what a lender would see. It is never used on a person's own
 * dashboard — there they see a grade. Telling someone in their own app that they
 * are "HIGH risk" is a verdict they cannot act on, and the whole point of the
 * two vocabularies is to keep that out of the consumer surface.
 */
const TONE = {
  LOW: 'bg-credit/10 text-credit border-credit/25',
  MEDIUM: 'bg-warn/10 text-warn border-warn/25',
  HIGH: 'bg-debit/10 text-debit border-debit/25',
};

export default function RiskBandChip({ band, className = '' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.05em]',
        TONE[band] ?? TONE.MEDIUM,
        className,
      )}
    >
      {band} risk
    </span>
  );
}
