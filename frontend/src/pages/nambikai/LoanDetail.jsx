import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import Sheet from '../../components/Sheet.jsx';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { formatWhen } from '../../lib/format.js';

const STATUS_TONE = {
  PAID: 'bg-credit/10 text-credit',
  PENDING: 'bg-sky-100 text-navy',
  LATE: 'bg-warn/10 text-warn',
  MISSED: 'bg-debit/10 text-debit',
  WAIVED: 'bg-canvas text-ink-muted',
};

/**
 * The warning that arrives before the miss.
 *
 * A conventional lender learns about a problem when a payment fails. Because
 * Nambikai already holds the borrower's cash flow, it can say "this will be
 * short" while there is still time — and, more usefully, name a day that would
 * work instead.
 */
function ForecastCard({ forecast, next }) {
  if (!forecast || !next) return null;

  if (forecast.willClear) {
    return (
      <Card className="border border-credit/25 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-credit/10 text-credit">
            <Icon name="check" size={17} />
          </span>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Based on your last months, you should have{' '}
            <span className="tnum font-semibold text-ink">{forecast.projectedBalance.formatted}</span>{' '}
            around the {forecast.dueDay}
            {'  '}— enough for this instalment.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border border-warn/30 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/10 text-warn">
          <Icon name="alert" size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink">
            You may be about {forecast.shortfall.formatted} short
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Your instalment of {next.amountDue.formatted} falls on the {forecast.dueDay}, and your
            last {forecast.monthsObserved} months suggest your balance will be around{' '}
            {forecast.projectedBalance.formatted} then.
            {forecast.suggestedDay
              ? ` Money usually reaches you nearer the ${forecast.suggestedDay}.`
              : ''}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function LoanDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { refreshBalance } = useAuth();
  const [confirming, setConfirming] = useState(null);
  const [paying, setPaying] = useState(false);

  const detail = useAsync(() => api.nambikai.loan(id), [id]);
  const forecast = useAsync(() => api.nambikai.loanForecast(id), [id]);

  async function pay() {
    setPaying(true);
    try {
      const res = await api.nambikai.payInstallment(id, confirming.id);
      setConfirming(null);
      await refreshBalance();
      toast.success(
        res.loan.status === 'CLOSED' ? 'Loan repaid in full' : 'Instalment paid',
        res.loan.status === 'CLOSED'
          ? 'Finishing a loan raises how much you can borrow next.'
          : undefined,
      );
      await Promise.all([detail.reload(), forecast.reload()]);
    } catch (err) {
      toast.error(err.message);
      setConfirming(null);
      detail.reload();
    } finally {
      setPaying(false);
    }
  }

  if (detail.loading) {
    return (
      <>
        <ScreenHeader title="Loan" />
        <div className="flex justify-center py-20">
          <Spinner size={26} className="text-navy" />
        </div>
      </>
    );
  }

  if (detail.error) {
    return (
      <>
        <ScreenHeader title="Loan" />
        <div className="px-3 pt-3">
          <Card>
            <EmptyState icon="alert" title="Couldn’t load this loan" description={detail.error.message} />
          </Card>
        </div>
      </>
    );
  }

  const { loan, installments, delinquency } = detail.data;
  const paid = installments.filter((i) => i.status === 'PAID').length;

  return (
    <>
      <ScreenHeader
        title={loan.status === 'CLOSED' ? 'Loan · repaid' : 'Your loan'}
        subtitle={`${loan.emi.formatted} on the ${loan.dueDayOfMonth}`}
        tone="brand"
      />

      <div className="space-y-3 px-3 pt-3">
        <section className="overflow-hidden rounded-card bg-brand-card px-5 py-5 shadow-lift">
          <p className="text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
            {loan.status === 'CLOSED' ? 'Repaid in full' : 'Still to repay'}
          </p>
          <p className="tnum mt-2 text-[34px] font-bold leading-none text-white">
            {loan.outstanding.formatted}
          </p>
          <p className="mt-2 text-[12.5px] text-sky-200">
            {paid} of {installments.length} instalments paid · borrowed {loan.principal.formatted} at{' '}
            {loan.ratePct}%
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.round((paid * 100) / Math.max(installments.length, 1))}%` }}
            />
          </div>
        </section>

        {delinquency?.daysPastDue > 0 && (
          <Card className="border border-debit/25 px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              <span className="font-bold text-debit">
                {delinquency.overdueCount} instalment{delinquency.overdueCount === 1 ? '' : 's'}{' '}
                overdue by {delinquency.daysPastDue} days.
              </span>{' '}
              Recent instalments weigh more than older ones, so catching up moves your
              score faster than the misses held it down.
            </p>
          </Card>
        )}

        <ForecastCard forecast={forecast.data?.forecast} next={forecast.data?.next} />

        <Card>
          <CardHeader title="Schedule" />
          <div className="divide-y divide-line">
            {installments.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                    STATUS_TONE[i.status] ?? 'bg-canvas text-ink-muted',
                  )}
                >
                  {i.installmentIndex}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink">{formatWhen(i.dueAt)}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {i.principal.formatted} principal + {i.interest.formatted} interest
                    {i.status === 'PAID' && i.daysLate > 0 ? ` · ${i.daysLate}d late` : ''}
                  </p>
                </div>
                <span className="tnum shrink-0 text-[14px] font-bold text-ink">
                  {i.amountDue.formatted}
                </span>
                {i.isPayable ? (
                  <Button size="sm" variant="sky" onClick={() => setConfirming(i)}>
                    Pay
                  </Button>
                ) : (
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                      STATUS_TONE[i.status],
                    )}
                  >
                    {i.statusLabel}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated lending partner — no real credit is extended
        </MockBadge>
      </div>

      <Sheet
        open={Boolean(confirming)}
        onClose={() => !paying && setConfirming(null)}
        title="Pay this instalment"
        footer={
          <Button full size="lg" loading={paying} onClick={pay}>
            Pay {confirming?.amountDue.formatted}
          </Button>
        }
      >
        {confirming && (
          <div className="space-y-3">
            <p className="tnum text-center text-[34px] font-bold leading-none text-ink">
              {confirming.amountDue.formatted}
            </p>
            <dl className="divide-y divide-line rounded-tile border border-line">
              {[
                ['Instalment', `${confirming.installmentIndex} of ${installments.length}`],
                ['Due', formatWhen(confirming.dueAt)],
                ['Principal', confirming.principal.formatted],
                ['Interest', confirming.interest.formatted],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-3 py-2.5">
                  <dt className="text-[13px] text-ink-muted">{k}</dt>
                  <dd className="text-[13px] font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <MockBadge />
          </div>
        )}
      </Sheet>
    </>
  );
}
