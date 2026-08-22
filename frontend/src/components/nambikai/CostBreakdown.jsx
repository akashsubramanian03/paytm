import { cx } from '../primitives.jsx';

/**
 * What the loan actually costs, both ways round.
 *
 * Indian microlenders routinely advertise a FLAT rate, which is roughly half the
 * true reducing-balance figure for the same money. Showing both side by side,
 * with the rupee cost underneath, is not a feature anyone asks for — it is a
 * feature people do not know to ask for, which is rather the point.
 */
export default function CostBreakdown({ offer, className = '' }) {
  const quotedFlat = offer.rate.quotedAs === 'FLAT';
  return (
    <div className={cx('rounded-tile border border-line', className)}>
      <div className="grid grid-cols-2 divide-x divide-line">
        <div className={cx('px-3 py-3 text-center', quotedFlat && 'bg-canvas')}>
          <p className="tnum text-[20px] font-bold leading-none text-ink">{offer.rate.flatPct}%</p>
          <p className="mt-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            flat {quotedFlat && '· as advertised'}
          </p>
        </div>
        <div className={cx('px-3 py-3 text-center', !quotedFlat && 'bg-canvas')}>
          <p className="tnum text-[20px] font-bold leading-none text-navy">{offer.rate.reducingPct}%</p>
          <p className="mt-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            reducing balance
          </p>
        </div>
      </div>
      <p className="border-t border-line px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
        {offer.rate.note}
      </p>
      <dl className="divide-y divide-line border-t border-line">
        {[
          ['You receive', offer.principal.formatted],
          ['You repay', offer.totalRepayable.formatted],
          ['Cost of the loan', offer.totalInterest.formatted],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between px-3 py-2">
            <dt className="text-[12.5px] text-ink-muted">{k}</dt>
            <dd className="tnum text-[12.5px] font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
