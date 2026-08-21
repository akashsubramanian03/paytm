import { Link, useParams } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import ScoreRing from '../../components/nambikai/ScoreRing.jsx';
import CategoryBars from '../../components/nambikai/CategoryBars.jsx';
import ReasonCodeList from '../../components/nambikai/ReasonCodeList.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

const STATUS_TONE = {
  FILED: 'text-credit',
  PAID: 'text-credit',
  LATE: 'text-warn',
  PENDING: 'text-ink-muted',
  OVERDUE: 'text-debit',
};

export default function BusinessProfile() {
  const { id } = useParams();
  const business = useAsync(() => api.nambikai.business(id), [id]);
  const score = useAsync(() => api.nambikai.businessScore(id), [id]);
  const records = useAsync(() => api.nambikai.businessRecords(id), [id]);

  const blocked = score.error?.code === 'CONSENT_REQUIRED';
  const b = business.data?.business;
  const s = score.data?.score;
  const gates = (s?.gates?.gates ?? []).filter((g) => g.triggered);

  if (business.loading) {
    return (
      <>
        <ScreenHeader title="Business" />
        <div className="flex justify-center py-20">
          <Spinner size={26} className="text-navy" />
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title={b?.name ?? 'Business'} subtitle={b?.sector?.toLowerCase()} tone="brand" />

      <div className="space-y-3 px-3 pt-3">
        {blocked && <ConsentGate error={score.error} title="This business hasn’t been assessed yet" />}

        {s && (
          <>
            <section className="overflow-hidden rounded-card bg-brand-card px-5 pb-5 pt-6 shadow-lift">
              <div className="flex flex-col items-center">
                <p className="text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
                  Business score
                </p>
                <ScoreRing value={s.value} grade={s.grade} className="mt-3" />
                <p className="mt-3 text-[15px] font-bold text-white">
                  {s.grade.charAt(0) + s.grade.slice(1).toLowerCase()}
                </p>
              </div>
            </section>

            {s.gates?.eligible === false && (
              <Card className="border border-warn/30 px-4 py-3.5">
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  <span className="font-bold text-warn">Not enough records to assess yet.</span>{' '}
                  Nambikai will not issue a confident assessment built on two
                  categories. Raising invoices through Paytm, or registering for
                  GST, would give it more to work with.
                </p>
              </Card>
            )}

            {gates.length > 0 && (
              <Card className="border border-warn/25">
                <CardHeader title="What’s holding this back" />
                <div className="divide-y divide-line">
                  {gates.map((g) => {
                    const reason = s.reasonCodes.find((r) => r.code === g.code);
                    return (
                      <div key={g.code} className="px-4 py-3">
                        <p className="text-[14px] font-semibold text-ink">{reason?.label ?? g.code}</p>
                        {reason?.guidance && (
                          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                            {reason.guidance}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card>
              <CardHeader title="What’s helping" />
              <ReasonCodeList reasonCodes={s.reasonCodes} filter={(r) => r.polarity === 'POSITIVE'} />
            </Card>

            <Card>
              <CardHeader title="What’s holding it back" />
              <ReasonCodeList reasonCodes={s.reasonCodes} filter={(r) => r.polarity === 'NEGATIVE'} />
            </Card>

            <Card>
              <CardHeader title="How the score is made up" />
              <CategoryBars breakdown={s.breakdown} />
            </Card>
          </>
        )}

        {b && (
          <Card>
            <CardHeader title="Business profile" />
            <dl className="divide-y divide-line">
              {[
                ['GST number', b.gstNumber ?? 'Not registered'],
                ['City', b.city],
                ['People', String(b.employeeCount)],
                ['Monthly revenue', b.monthlyRevenue.formatted],
                ['Money coming in', b.monthlyInflow.formatted],
                ['Owed by customers', b.receivables.formatted],
                ['Existing debt', b.existingDebt.formatted],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-4 py-2.5">
                  <dt className="text-[13px] text-ink-muted">{k}</dt>
                  <dd className="tnum text-[13px] font-semibold text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {records.data?.records?.length > 0 && (
          <Card>
            <CardHeader title="Records Nambikai reads" />
            <div className="divide-y divide-line">
              {records.data.records.slice(0, 12).map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
                    <Icon name={r.kind === 'GST_FILING' ? 'document' : 'passbook'} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">
                      {r.kind === 'GST_FILING' ? 'GST return' : (r.counterpartyName ?? 'Invoice')}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted">
                      {new Date(r.periodStart).toLocaleDateString('en-IN')}
                    </span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-semibold text-ink">
                    {r.amount.formatted}
                  </span>
                  <span
                    className={cx(
                      'shrink-0 text-[11px] font-bold uppercase',
                      STATUS_TONE[r.status] ?? 'text-ink-muted',
                    )}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <Link to={`/nambikai/business/${id}/assistant`} className="block">
            <ListRow
              icon={
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                  <Icon name="sparkle" size={19} />
                </span>
              }
              title="Ask about this business"
              subtitle="Cash flow, receivables, GST"
              onClick={() => {}}
            />
          </Link>
        </Card>

        {business.error && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load" description={business.error.message} />
          </Card>
        )}

        <MockBadge className="pb-3 pt-1">
          Simulated business records — no real GST or invoice data
        </MockBadge>
      </div>
    </>
  );
}
