import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Card, CardHeader, EmptyState, MockBadge, Spinner } from '../../components/primitives.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

const rupees = (paise) => `₹${Math.round((paise ?? 0) / 100).toLocaleString('en-IN')}`;

/**
 * Proof of income for someone who has no payslip.
 *
 * Deliberately not only a credit artifact. A gig worker asked for salary slips
 * by a landlord or a visa office has nothing to show — the income is real, it
 * simply never took the shape of a document. This is the same eighteen months
 * that produce the score, arranged so somebody else can read them.
 */
export default function IncomeProof() {
  const { data, error, loading } = useAsync(() => api.nambikai.incomeProof(), []);
  const blocked = error?.code === 'CONSENT_REQUIRED';
  const p = data?.proof;

  return (
    <>
      <ScreenHeader title="Proof of income" subtitle="Derived from your own activity" tone="brand" />
      <div className="space-y-3 px-3 pt-3">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {blocked && <ConsentGate error={error} title="This needs permission to read your activity" />}

        {error && !blocked && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t build the document" description={error.message} />
          </Card>
        )}

        {p && (
          <>
            <Card className="px-4 py-4">
              <p className="text-[15px] font-bold text-ink">{p.subject.name}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-muted">
                {p.subject.maskedPhone} · on Paytm for {p.subject.accountAgeMonths} months
              </p>
              <p className="mt-3 text-2xs font-bold uppercase tracking-[0.11em] text-ink-faint">
                Period observed
              </p>
              <p className="mt-1 text-[13px] text-ink">
                {p.period.from} to {p.period.to} · income in {p.period.monthsWithIncome} of{' '}
                {p.period.monthsObserved} months
              </p>
            </Card>

            <Card>
              <CardHeader title="Money received" />
              <dl className="divide-y divide-line">
                {[
                  ['Typical month', rupees(p.income.medianMonthlyPaise), true],
                  ['Lowest month', rupees(p.income.lowestMonthPaise)],
                  ['Highest month', rupees(p.income.highestMonthPaise)],
                  ['Total over the period', rupees(p.income.totalReceivedPaise)],
                  ['People and businesses paying', String(p.income.distinctPayers)],
                  ['Transactions', String(p.income.transactionCount)],
                ].map(([k, v, lead]) => (
                  <div key={k} className="flex items-baseline justify-between px-4 py-2.5">
                    <dt className="text-[13px] text-ink-muted">{k}</dt>
                    <dd className={lead ? 'tnum text-[18px] font-bold text-ink' : 'tnum text-[13.5px] font-semibold text-ink'}>
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>

            {/* The caveats belong on the document, not in a footnote somebody
                has to go looking for. */}
            <Card className="border border-warn/25">
              <CardHeader title="What this does and does not show" />
              <ul className="space-y-2 px-4 pb-4">
                {p.limitations.map((l) => (
                  <li key={l} className="flex items-start gap-2">
                    <Icon name="info" size={14} className="mt-0.5 shrink-0 text-warn" />
                    <span className="text-[12px] leading-relaxed text-ink-muted">{l}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="px-4 py-3">
              <p className="text-[11.5px] text-ink-faint">
                Generated {new Date(p.generatedAt).toLocaleString('en-IN')} · engine{' '}
                {p.engineVersion}
              </p>
              <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">
                {p.verificationHash?.slice(0, 32)}…
              </p>
            </Card>
          </>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>
    </>
  );
}
