import { useState } from 'react';
import Icon from '../Icon.jsx';
import { cx } from '../primitives.jsx';

/**
 * "Nambikai used these signals."
 *
 * THIS COMPONENT HAS NO FALLBACK COPY, ON PURPOSE. It renders what the engine
 * emitted and nothing else — given an empty list it renders nothing at all,
 * rather than a reassuring sentence nobody computed. That is what makes the
 * explanation on screen the same explanation the score was built from, instead
 * of marketing text that happens to sit next to a number.
 *
 * Each row can be expanded to show the actual figures the code was derived from,
 * because "you pay your contributions on time" is a claim and "43 of 43 settled
 * cycles, none late" is evidence.
 */
const POLARITY = {
  POSITIVE: { icon: 'check', chip: 'bg-credit/10 text-credit', label: 'Helps' },
  NEGATIVE: { icon: 'alert', chip: 'bg-debit/10 text-debit', label: 'Holds back' },
  NEUTRAL: { icon: 'info', chip: 'bg-canvas text-ink-muted', label: 'Context' },
};

/** Turn an evidence key into something a person can read. */
const EVIDENCE_LABEL = {
  monthsObserved: 'Months of history',
  monthsWithIncome: 'Months with income',
  monthsWithoutIncome: 'Months with none',
  settledCycles: 'Settled contributions',
  onTime: 'Paid on time',
  late: 'Paid late',
  missed: 'Missed',
  activeGroups: 'Savings circles',
  monthsInAnyGroup: 'Months in a circle',
  bufferDays: 'Days of spending covered',
  accountTenureMonths: 'Months on Paytm',
  distinctCounterparties: 'People transacted with',
  transactionCount: 'Transactions',
  failedCount: 'Failed payments',
  monthsWithFormalPayment: 'Months a bill or recharge was paid',
  monthsSavedSomething: 'Months you saved something',
  recentMissed: 'Missed recently',
  recentCycles: 'Recent cycles',
  peerLoansObserved: 'Loan-like transfers seen',
  peerLoansRepaid: 'Sent back',
  unmeasuredCategories: 'Not measured',
  daysSinceLastActivity: 'Days since last activity',
  monthsRequired: 'Months needed',
};

const PAISE_KEYS = /Paise$/;

function formatEvidence(key, value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (typeof value === 'object' && value !== null) return null;
  if (PAISE_KEYS.test(key)) return `₹${Math.round(value / 100).toLocaleString('en-IN')}`;
  if (key.endsWith('Bps')) return `${Math.round(value / 100)}%`;
  return String(value);
}

function labelFor(key) {
  if (EVIDENCE_LABEL[key]) return EVIDENCE_LABEL[key];
  if (PAISE_KEYS.test(key)) {
    return key.replace(/Paise$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  }
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

function Row({ reason }) {
  const [open, setOpen] = useState(false);
  const tone = POLARITY[reason.polarity] ?? POLARITY.NEUTRAL;
  const entries = Object.entries(reason.evidence ?? {}).filter(
    ([key, value]) => formatEvidence(key, value) !== null,
  );
  const expandable = entries.length > 0 || Boolean(reason.guidance);

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cx('flex w-full items-start gap-3 text-left', !expandable && 'cursor-default')}
      >
        <span
          className={cx(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            tone.chip,
          )}
        >
          <Icon name={tone.icon} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold leading-snug text-ink">
            {reason.label}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-faint">
              {tone.label}
            </span>
            {reason.affectsScore === false && (
              <span className="rounded-full bg-canvas px-1.5 py-px text-[10.5px] font-semibold text-ink-muted">
                does not change your score
              </span>
            )}
          </span>
        </span>
        {expandable && (
          <Icon
            name="chevronDown"
            size={17}
            className={cx('mt-1 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')}
          />
        )}
      </button>

      {open && (
        <div className="mt-2.5 pl-11">
          {reason.guidance && (
            <p className="mb-2 text-[12px] leading-relaxed text-ink-muted">{reason.guidance}</p>
          )}
          {entries.length > 0 && (
            <dl className="divide-y divide-line rounded-tile border border-line">
              {entries.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-[12px] text-ink-muted">{labelFor(key)}</dt>
                  <dd className="tnum text-[12px] font-semibold text-ink">
                    {formatEvidence(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReasonCodeList({ reasonCodes, filter }) {
  const rows = (reasonCodes ?? []).filter((r) => (filter ? filter(r) : true));
  // No fallback. If the engine said nothing, this component says nothing.
  if (!rows.length) return null;
  return <div className="divide-y divide-line">{rows.map((r) => <Row key={r.code} reason={r} />)}</div>;
}
