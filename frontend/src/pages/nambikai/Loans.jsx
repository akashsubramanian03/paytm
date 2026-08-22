import { Link } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card, EmptyState, MockBadge, Spinner, cx } from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

const BUCKET_TONE = {
  CURRENT: 'bg-credit/10 text-credit',
  DPD_1_30: 'bg-warn/10 text-warn',
  DPD_30_60: 'bg-debit/10 text-debit',
  DPD_60_90: 'bg-debit/10 text-debit',
  DPD_90_PLUS: 'bg-debit/10 text-debit',
};

export default function Loans() {
  const { data, error, loading } = useAsync(() => api.nambikai.loans(), []);
  const loans = data?.loans ?? [];

  return (
    <>
      <ScreenHeader title="Your loans" tone="brand" />
      <div className="space-y-3 px-3 pt-3">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {!loading && !error && loans.length === 0 && (
          <Card>
            <EmptyState
              icon="bank"
              title="No loans yet"
              description="Your savings-circle record and everyday activity are what a partner would price a loan on."
              action={
                <Link to="/nambikai/borrow">
                  <Button>See what you could borrow</Button>
                </Link>
              }
            />
          </Card>
        )}

        {loans.map((l) => (
          <Card key={l.id}>
            <Link to={`/nambikai/loans/${l.id}`} className="block">
              <div className="px-4 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="tnum text-[22px] font-bold leading-none text-ink">
                      {l.outstanding.formatted}
                    </p>
                    <p className="mt-1 text-[12.5px] text-ink-muted">
                      outstanding of {l.principal.formatted}
                    </p>
                  </div>
                  <span
                    className={cx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                      l.status === 'CLOSED'
                        ? 'bg-credit/10 text-credit'
                        : (BUCKET_TONE[l.delinquency?.bucket] ?? 'bg-canvas text-ink-muted'),
                    )}
                  >
                    {l.status === 'CLOSED'
                      ? 'Repaid in full'
                      : l.delinquency?.daysPastDue > 0
                        ? `${l.delinquency.daysPastDue} days late`
                        : 'On track'}
                  </span>
                </div>
                <p className="mt-2 text-[12.5px] text-ink-muted">
                  {l.paidCount ?? 0} of {l.totalCount ?? l.tenureMonths} instalments paid ·{' '}
                  {l.emi.formatted} on the {l.dueDayOfMonth}
                </p>
              </div>
              <div className="mt-3 h-1.5 w-full bg-canvas">
                <div
                  className={cx('h-full', l.status === 'CLOSED' ? 'bg-credit' : 'bg-navy')}
                  style={{
                    width: `${Math.round(((l.paidCount ?? 0) * 100) / Math.max(l.totalCount ?? 1, 1))}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <span className="text-[12.5px] text-ink-muted">
                  {l.status === 'CLOSED' ? 'Closed' : 'View schedule'}
                </span>
                <Icon name="chevronRight" size={17} className="text-ink-faint" />
              </div>
            </Link>
          </Card>
        ))}

        {error && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load your loans" description={error.message} />
          </Card>
        )}

        <MockBadge className="pb-3 pt-1">
          Simulated lending partner — no real credit is extended
        </MockBadge>
      </div>
    </>
  );
}
