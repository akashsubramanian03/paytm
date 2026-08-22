import { ScreenHeader } from '../../components/AppLayout.jsx';
import { Card, CardHeader, EmptyState, MockBadge, Spinner, cx } from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

const BAND_TONE = { LOW: 'text-credit', MEDIUM: 'text-warn', HIGH: 'text-debit' };

/**
 * The scorecard, marked.
 *
 * Every alternative-data lender claims their model works. This is the only
 * screen that could show it was wrong: outcomes grouped by the band each
 * borrower was scored at when they applied. Without it a score is an opinion
 * that has never been checked against what actually happened.
 */
export default function Portfolio() {
  const { data, error, loading } = useAsync(() => api.nambikai.portfolio(), []);
  const rows = data?.byBand ?? [];

  return (
    <>
      <ScreenHeader title="How the scorecard performed" subtitle="Outcomes by risk band" tone="brand" />
      <div className="space-y-3 px-3 pt-3">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <Card>
            <EmptyState
              icon="chart"
              title="No loans to measure yet"
              description="Once loans have run for a while, this shows whether the bands actually predicted repayment."
            />
          </Card>
        )}

        {rows.map((r) => (
          <Card key={r.band}>
            <CardHeader
              title={`Scored ${r.band}`}
              action={<span className="text-[12px] text-ink-muted">{r.loans} loans</span>}
            />
            <div className="grid grid-cols-3 gap-px bg-line">
              {[
                ['On time', r.onTimeRatePct === null ? '—' : `${r.onTimeRatePct}%`, BAND_TONE[r.band]],
                ['Missed', r.missRatePct === null ? '—' : `${r.missRatePct}%`, 'text-ink'],
                ['Closed', String(r.closed), 'text-ink'],
              ].map(([label, value, tone]) => (
                <div key={label} className="bg-white px-3 py-3 text-center">
                  <p className={cx('tnum text-[20px] font-bold leading-none', tone)}>{value}</p>
                  <p className="mt-1 text-2xs font-medium text-ink-muted">{label}</p>
                </div>
              ))}
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-muted">
              {r.installmentsDue} instalments due · ₹
              {Math.round(r.disbursedPaise / 100).toLocaleString('en-IN')} disbursed
            </p>
          </Card>
        ))}

        {data?.note && (
          <Card className="px-4 py-3">
            <p className="text-[12px] leading-relaxed text-ink-muted">{data.note}</p>
          </Card>
        )}

        {error && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load outcomes" description={error.message} />
          </Card>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>
    </>
  );
}
