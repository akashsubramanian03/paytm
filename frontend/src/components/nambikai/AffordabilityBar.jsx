import Icon from '../Icon.jsx';
import { cx } from '../primitives.jsx';

/**
 * Where the offer came from.
 *
 * A borrower shown a number they cannot account for assumes the worst — that
 * they were judged and found wanting. Naming the binding constraint turns an
 * arbitrary-looking figure into an explanation, and often into good news: being
 * capped because it is a first loan is a very different thing from being capped
 * because the assessment went badly.
 */
const CONSTRAINT_COPY = {
  FOIR: {
    icon: 'shield',
    title: 'Capped by what you can comfortably repay',
    detail: (a) =>
      `On a monthly income in the ${a.incomeBand} band, Nambikai caps total commitments at ${a.foirPct}%. Lower incomes are capped harder, on purpose.`,
  },
  GRADUATED_CAP: {
    icon: 'trend',
    title: 'Capped because this is your first loan',
    detail: () =>
      'First loans are kept small whatever the numbers say. The ceiling rises each time you finish one.',
  },
  RISK_BAND: {
    icon: 'chart',
    title: 'Capped by your current score',
    detail: () => 'A stronger score would lift this. Nothing here is permanent.',
  },
  PRODUCT_MAX: {
    icon: 'bank',
    title: 'This is the most this product offers',
    detail: () => 'You could carry more — this particular partner does not lend more.',
  },
  REQUESTED: {
    icon: 'check',
    title: 'This is what you asked for',
    detail: () => 'You could have borrowed more, and chose not to.',
  },
};

export default function AffordabilityBar({ affordability, className = '' }) {
  const copy = CONSTRAINT_COPY[affordability.bindingConstraint] ?? CONSTRAINT_COPY.FOIR;
  return (
    <div className={cx('rounded-tile bg-canvas px-3.5 py-3', className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-navy">
          <Icon name={copy.icon} size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-ink">{copy.title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
            {copy.detail(affordability)}
          </p>
          {affordability.maxEmi && (
            <p className="mt-1.5 text-[12px] text-ink-faint">
              Most Nambikai would let you commit:{' '}
              <span className="tnum font-semibold text-ink">{affordability.maxEmi.formatted}</span> a month
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
