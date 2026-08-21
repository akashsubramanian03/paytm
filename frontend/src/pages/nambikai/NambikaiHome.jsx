import { Link } from 'react-router-dom';
import { BrandBar } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ListRow,
  MockBadge,
  Spinner,
} from '../../components/primitives.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

const Stat = ({ label, value, sub }) => (
  <div className="bg-white px-3 py-3 text-center">
    <p className="tnum text-[19px] font-bold leading-none text-ink">{value}</p>
    <p className="mt-1 text-2xs font-medium text-ink-muted">{label}</p>
    {sub && <p className="mt-0.5 text-2xs text-ink-faint">{sub}</p>}
  </div>
);

export default function NambikaiHome() {
  const { data, error, loading } = useAsync(() => api.nambikai.scoreInputs(), []);
  const blocked = error?.code === 'CONSENT_REQUIRED';

  return (
    <>
      <BrandBar />

      <div className="space-y-3 px-3 pt-3">
        <section className="overflow-hidden rounded-card bg-brand-card px-5 py-5 shadow-lift">
          <p className="text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
            Nambikai · trust profile
          </p>
          <p className="mt-2 text-[17px] font-bold leading-snug text-white">
            Your everyday money habits, turned into a financial record you own.
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-sky-200">
            Savings circles, bills paid on time and steady earnings are all evidence.
            A credit bureau cannot see any of it.
          </p>
        </section>

        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {/* The wall. Not an error state — an honest description of what has not
            been shared yet, built from what the server said was missing. */}
        {blocked && <ConsentGate error={error} title="Nambikai hasn’t read anything yet" />}

        {error && !blocked && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load your profile" description={error.message} />
          </Card>
        )}

        {data && (
          <>
            <Card>
              <CardHeader title="What Nambikai can see" />
              <div className="grid grid-cols-3 gap-px bg-line">
                <Stat label="Months observed" value={data.wallet.monthsObserved} />
                <Stat label="Transactions" value={data.wallet.transactionCount} />
                <Stat
                  label="Buffer"
                  value={data.wallet.bufferDays === null ? '—' : `${data.wallet.bufferDays}d`}
                  sub="of usual spending"
                />
              </div>
              <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
                <Stat
                  label="On-time"
                  value={data.commitments.onTimePct === null ? '—' : `${data.commitments.onTimePct}%`}
                  sub="contributions"
                />
                <Stat label="Circles" value={data.commitments.activeGroups} />
                <Stat label="Saved" value={data.commitments.totalSaved.formatted} />
              </div>
            </Card>

            {/* Generated from the audit token, never from static copy. */}
            <Card>
              <CardHeader title="Nambikai used these signals" />
              <ul className="divide-y divide-line">
                {data.consent.dataTypesUsed.map((dataType) => (
                  <li key={dataType} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Icon name="check" size={15} className="shrink-0 text-credit" />
                    <span className="text-[13.5px] text-ink">
                      {dataType === 'WALLET_LEDGER'
                        ? 'Your Paytm wallet activity'
                        : dataType === 'GROUP_CONTRIBUTIONS'
                          ? 'Your savings group contributions'
                          : dataType}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="px-4 pb-3.5 pt-2 text-[11.5px] leading-relaxed text-ink-faint">
                Read {new Date(data.asOf).toLocaleString('en-IN')} · engine {data.engineVersion}
              </p>
            </Card>

            {data.commitments.missed > 0 && (
              <Card className="border border-warn/25 px-4 py-3.5">
                <p className="text-[13px] leading-relaxed text-ink-muted">
                  <span className="font-bold text-warn">
                    {data.commitments.missed} missed{' '}
                    {data.commitments.missed === 1 ? 'contribution' : 'contributions'}
                  </span>{' '}
                  are part of your record. Nambikai shows what is there, including
                  the parts that do not help.
                </p>
              </Card>
            )}
          </>
        )}

        <Card>
          <ListRow
            icon={
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                <Icon name="users" size={19} />
              </span>
            }
            title="Savings groups"
            subtitle="Every contribution you keep becomes evidence"
            onClick={() => {}}
            as="div"
            className="pointer-events-none"
          />
          <div className="hairline" />
          <ListRow
            icon={
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                <Icon name="shield" size={19} />
              </span>
            }
            title="Data & consent"
            subtitle="See and change what Nambikai may read"
            onClick={() => {}}
            as="div"
            className="pointer-events-none"
          />
          <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-3">
            <Link to="/nambikai/groups">
              <Button variant="outline" full>
                Groups
              </Button>
            </Link>
            <Link to="/nambikai/consent">
              <Button variant="outline" full>
                Consent
              </Button>
            </Link>
          </div>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated data — Nambikai does not lend and makes no credit decision
        </MockBadge>
      </div>
    </>
  );
}
