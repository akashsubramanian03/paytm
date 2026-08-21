import { cx } from '../primitives.jsx';

/**
 * How each category contributed, and how much it was allowed to.
 *
 * Two numbers per row, deliberately: how well the person did in that category
 * (`rawPct`), and how much of the final score that category could move
 * (`weightPct`). Showing only the first would hide that a strong result in a
 * lightly-weighted area barely matters; showing only the second would hide the
 * behaviour entirely.
 *
 * An UNMEASURED category is shown, not hidden — greyed, labelled, and stated to
 * carry no weight. Silently dropping it would leave a person wondering why the
 * numbers do not add up, and would disguise the fairness adjustment as an
 * absence.
 */
export default function CategoryBars({ breakdown }) {
  return (
    <div className="divide-y divide-line">
      {breakdown.map((row) => {
        const unmeasured = !row.measured;
        return (
          <div key={row.category} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cx(
                  'text-[14px] font-semibold',
                  unmeasured ? 'text-ink-faint' : 'text-ink',
                )}
              >
                {row.label}
              </span>
              <span className="tnum shrink-0 text-[12.5px] font-semibold text-ink-muted">
                {unmeasured ? 'not measured' : `${row.rawPct}%`}
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
              <div
                className={cx(
                  'h-full rounded-full transition-all duration-500',
                  unmeasured
                    ? 'bg-line'
                    : row.rawPct >= 70
                      ? 'bg-credit'
                      : row.rawPct >= 45
                        ? 'bg-sky'
                        : 'bg-warn',
                )}
                style={{ width: unmeasured ? '100%' : `${Math.max(row.rawPct, 2)}%` }}
              />
            </div>

            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
              {unmeasured ? (
                <>
                  Nambikai has no evidence here, so this category carries no weight
                  and is not counted against you.
                </>
              ) : (
                <>
                  Worth {row.weightPct}% of your score
                  {row.weightBps !== row.baseWeightBps && (
                    <span className="font-semibold text-navy">
                      {' '}
                      (raised from {Math.round(row.baseWeightBps / 100)}%)
                    </span>
                  )}
                  {row.description ? ` · ${row.description}` : ''}
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
