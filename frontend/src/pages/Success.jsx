import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Button, MockBadge } from '../components/primitives.jsx';
import { formatFull, formatPaise, splitAmount } from '../lib/format.js';
import { useCopy } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Shared confirmation screen for every kind of payment. Driven entirely by
 * router state handed over by the flow that just completed.
 */
export default function Success() {
  const navigate = useNavigate();
  const toast = useToast();
  const { state } = useLocation();
  const { copied, copy } = useCopy();

  if (!state?.transaction) return <Navigate to="/" replace />;

  const { transaction, headline, subline, balancePaise } = state;
  const credit = transaction.direction === 'CREDIT';
  const amount = splitAmount(transaction.amountPaise);

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <div className="bg-brand-card px-6 pb-12 pt-14 text-center">
        <span className="mx-auto flex h-[72px] w-[72px] animate-pop-tick items-center justify-center rounded-full bg-white/15 ring-[6px] ring-white/10">
          <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-white">
            <Icon name="check" size={28} strokeWidth={2.8} className="text-credit" />
          </span>
        </span>

        <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-sky-200">
          {credit ? 'Money added' : 'Payment successful'}
        </p>

        <p className="mt-2 flex items-baseline justify-center gap-0.5 text-white">
          <span className="tnum text-[40px] font-bold leading-none tracking-[-0.025em]">{amount.whole}</span>
          <span className="tnum text-[20px] font-semibold leading-none opacity-80">.{amount.fraction}</span>
        </p>

        <p className="mt-3 text-[15px] font-semibold text-white">{headline}</p>
        {subline && <p className="mt-0.5 text-[13px] text-sky-200">{subline}</p>}
      </div>

      <div className="mx-auto -mt-6 w-full max-w-app flex-1 px-4">
        <div className="card divide-y divide-line">
          <DetailRow label="Status" value={<StatusPill status={transaction.status} />} />
          <DetailRow label="Date & time" value={formatFull(transaction.createdAt)} />
          <DetailRow
            label="Transaction ID"
            value={
              <button
                onClick={async () => {
                  const ok = await copy(transaction.referenceId);
                  toast[ok ? 'success' : 'error'](
                    ok ? 'Transaction ID copied' : "Couldn't copy",
                    ok ? transaction.referenceId : 'Copy it manually instead.',
                  );
                }}
                className="tnum inline-flex items-center gap-1.5 font-semibold text-navy"
              >
                {transaction.referenceId}
                <Icon name={copied ? 'check' : 'copy'} size={14} />
              </button>
            }
          />
          {balancePaise !== undefined && (
            <DetailRow label="Wallet balance" value={<span className="tnum">{formatPaise(balancePaise)}</span>} />
          )}
        </div>

        <div className="mt-5 space-y-3">
          <Button size="lg" full onClick={() => navigate('/', { replace: true })}>
            Done
          </Button>
          <Button
            variant="outline"
            size="lg"
            full
            onClick={() => navigate(`/passbook/${transaction.id}`, { replace: true })}
          >
            View in passbook
          </Button>
        </div>

        <MockBadge className="py-7" />
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="text-right text-[13px] font-semibold text-ink">{value}</span>
    </div>
  );
}

export function StatusPill({ status }) {
  const success = status === 'SUCCESS';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold uppercase tracking-wide ${
        success ? 'bg-credit/10 text-credit' : 'bg-debit/10 text-debit'
      }`}
    >
      <Icon name={success ? 'check' : 'alert'} size={12} strokeWidth={2.6} />
      {success ? 'Success' : status}
    </span>
  );
}
