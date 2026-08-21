import { useNavigate, useParams } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import { TransactionGlyph } from '../components/TransactionRow.jsx';
import { Button, MockBadge, Spinner, cx } from '../components/primitives.jsx';
import { StatusPill } from './Success.jsx';
import { api } from '../lib/api.js';
import { useAsync, useCopy } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatFull, formatPaise, splitAmount } from '../lib/format.js';

/** Human labels for the metadata blobs the backend attaches per category. */
const META_LABELS = {
  operator: 'Operator',
  circle: 'Circle',
  mobileNumber: 'Mobile number',
  validityDays: 'Validity',
  data: 'Data',
  talktime: 'Talktime',
  sms: 'SMS',
  billerName: 'Biller',
  consumerNumber: 'Consumer number',
  method: 'Paid using',
  category: 'Category',
};

export default function TransactionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { copied, copy } = useCopy();

  const { data, loading, error } = useAsync(() => api.transaction(id), [id]);
  const transaction = data?.transaction;

  if (loading) {
    return (
      <>
        <ScreenHeader title="Transaction" />
        <div className="flex justify-center py-24">
          <Spinner size={24} className="text-navy" />
        </div>
      </>
    );
  }

  if (error || !transaction) {
    return (
      <>
        <ScreenHeader title="Transaction" />
        <div className="px-4 py-20 text-center">
          <p className="text-[15px] font-bold text-ink">Transaction not found</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            It may belong to another account, or it no longer exists.
          </p>
          <Button className="mt-5" onClick={() => navigate('/passbook')}>
            Back to passbook
          </Button>
        </div>
      </>
    );
  }

  const credit = transaction.direction === 'CREDIT';
  const amount = splitAmount(transaction.amountPaise);

  const metaRows = Object.entries(transaction.metadata ?? {})
    .filter(([key]) => META_LABELS[key])
    .map(([key, value]) => [
      META_LABELS[key],
      key === 'validityDays' ? `${value} days` : String(value),
    ]);

  return (
    <>
      <ScreenHeader title="Transaction details" />

      <div className="space-y-3 px-3 pt-3">
        {/* ---- passbook entry head ---- */}
        <section className="card overflow-hidden">
          <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
            <TransactionGlyph transaction={transaction} size={58} />
            <p className="mt-3 text-[16px] font-bold text-ink">{transaction.counterparty.name}</p>
            {transaction.counterparty.handle && (
              <p className="mt-0.5 text-[13px] text-ink-muted">{transaction.counterparty.handle}</p>
            )}

            <p
              className={cx(
                'mt-4 flex items-baseline gap-0.5',
                credit ? 'text-credit' : 'text-ink',
              )}
            >
              <span className="text-[26px] font-bold leading-none">{credit ? '+' : '−'}</span>
              <span className="tnum text-[38px] font-bold leading-none tracking-[-0.025em]">
                {amount.whole}
              </span>
              <span className="tnum text-[19px] font-semibold leading-none opacity-75">
                .{amount.fraction}
              </span>
            </p>

            <div className="mt-3">
              <StatusPill status={transaction.status} />
            </div>
          </div>

          {/* ---- the passbook line itself ---- */}
          <dl className="divide-y divide-line border-t border-line">
            <Row label="Type" value={`${transaction.categoryLabel} · ${credit ? 'Credit' : 'Debit'}`} />
            <Row label="Date & time" value={formatFull(transaction.createdAt)} />
            <Row
              label="Balance after"
              value={<span className="tnum">{formatPaise(transaction.balanceAfterPaise)}</span>}
            />
            {transaction.note && <Row label="Note" value={transaction.note} />}
            <Row
              label="Transaction ID"
              value={
                <button
                  onClick={async () => {
                    const ok = await copy(transaction.referenceId);
                    toast[ok ? 'success' : 'error'](
                      ok ? 'Transaction ID copied' : "Couldn't copy",
                      ok ? transaction.referenceId : 'Select and copy it manually.',
                    );
                  }}
                  className="tnum inline-flex items-center gap-1.5 font-semibold text-navy"
                >
                  {transaction.referenceId}
                  <Icon name={copied ? 'check' : 'copy'} size={14} />
                </button>
              }
            />
          </dl>
        </section>

        {metaRows.length > 0 && (
          <section className="card overflow-hidden">
            <h2 className="section-title px-4 pb-2 pt-3.5">
              {transaction.category === 'RECHARGE' ? 'Recharge details' : 'Payment details'}
            </h2>
            <dl className="divide-y divide-line border-t border-line">
              {metaRows.map(([label, value]) => (
                <Row key={label} label={label} value={value} />
              ))}
            </dl>
          </section>
        )}

        {transaction.category === 'TRANSFER' && transaction.counterparty.id && (
          <Button
            variant="outline"
            size="lg"
            full
            onClick={() => navigate(`/pay/${transaction.counterparty.id}`)}
          >
            <Icon name="send" size={17} />
            Pay {transaction.counterparty.name.split(' ')[0]} again
          </Button>
        )}

        <MockBadge className="pb-4 pt-2" />
      </div>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-6 px-4 py-3">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-right text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  );
}
