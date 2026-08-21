import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Avatar, cx } from './primitives.jsx';
import { formatPaise, formatWhen } from '../lib/format.js';

/** Non-transfer categories get a tinted glyph instead of a person's initials. */
const CATEGORY_GLYPH = {
  ADD_MONEY: { icon: 'plus', wrap: 'bg-credit/10 text-credit' },
  RECHARGE: { icon: 'mobile', wrap: 'bg-sky-100 text-navy' },
  BILL_PAYMENT: { icon: 'bolt', wrap: 'bg-amber-100 text-warn' },
};

export function TransactionGlyph({ transaction, size = 42 }) {
  const glyph = CATEGORY_GLYPH[transaction.category];
  if (!glyph) {
    return (
      <Avatar
        initials={transaction.counterparty.initials || '?'}
        color={transaction.direction === 'CREDIT' ? '#0E9F6E' : '#012B72'}
        size={size}
      />
    );
  }
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-full', glyph.wrap)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon name={glyph.icon} size={size * 0.5} strokeWidth={1.9} />
    </span>
  );
}

/**
 * One passbook line. Amounts are tabular so the column stays aligned, with the
 * balance the wallet held right after the entry underneath — like a real
 * passbook, this row is a statement of record, not just a list item.
 */
export default function TransactionRow({ transaction, showBalance = true }) {
  const navigate = useNavigate();
  const credit = transaction.direction === 'CREDIT';

  const subtitle =
    transaction.category === 'TRANSFER'
      ? `${credit ? 'Received from' : 'Paid to'} ${transaction.counterparty.handle ?? '—'}`
      : transaction.counterparty.handle
        ? `${transaction.categoryLabel} · ${transaction.counterparty.handle}`
        : transaction.categoryLabel;

  return (
    <button
      onClick={() => navigate(`/passbook/${transaction.id}`)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sky-50 active:bg-sky-100"
    >
      <TransactionGlyph transaction={transaction} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold leading-tight text-ink">
          {transaction.counterparty.name}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-ink-muted">{subtitle}</span>
        <span className="mt-0.5 block text-[11.5px] leading-tight text-ink-faint">
          {formatWhen(transaction.createdAt)}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span
          className={cx('tnum block text-[15px] font-bold leading-tight', credit ? 'text-credit' : 'text-ink')}
        >
          {credit ? '+' : '−'} {transaction.amountFormatted}
        </span>
        {showBalance && (
          <span className="tnum mt-0.5 block text-[11.5px] leading-tight text-ink-faint">
            Bal {formatPaise(transaction.balanceAfterPaise)}
          </span>
        )}
      </span>
    </button>
  );
}
