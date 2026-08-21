import { Link, useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button,
  Card,
  EmptyState,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { formatWhen } from '../../lib/format.js';

/** Colour the on-time record the way the score treats it, so the two agree. */
function StreakPill({ stats }) {
  if (!stats || stats.onTimePct === null) {
    return <span className="text-[12px] text-ink-faint">No cycles yet</span>;
  }
  const tone =
    stats.onTimePct >= 90
      ? 'bg-credit/10 text-credit'
      : stats.onTimePct >= 60
        ? 'bg-warn/10 text-warn'
        : 'bg-debit/10 text-debit';
  return (
    <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-bold', tone)}>
      {stats.onTimePct}% on time
    </span>
  );
}

function GroupCard({ group }) {
  const stats = group.my;
  const next = stats?.nextDue;

  return (
    <Link to={`/nambikai/groups/${group.id}`} className="block">
      <Card className="transition-shadow hover:shadow-lift">
        <div className="flex items-start gap-3 px-4 pt-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
            <Icon name="users" size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink">{group.name}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              {group.contribution.formatted} · {group.cadenceLabel.toLowerCase()} ·{' '}
              {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          <Icon name="chevronRight" size={18} className="mt-1 shrink-0 text-ink-faint" />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 px-4 pb-3">
          <StreakPill stats={stats} />
          <span className="tnum text-[12.5px] font-semibold text-ink-muted">
            {stats?.totalSaved?.formatted ?? '₹0.00'} saved
          </span>
        </div>

        {next && (
          <div className="hairline flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
              <Icon name="clock" size={14} className="text-ink-faint" />
              Cycle {next.cycleIndex} due {formatWhen(next.dueAt)}
            </span>
            <span className="tnum text-[13px] font-bold text-navy">
              {next.amountDue.formatted}
            </span>
          </div>
        )}
      </Card>
    </Link>
  );
}

export default function Groups() {
  const navigate = useNavigate();
  const { data, error, loading } = useAsync(() => api.nambikai.groups(), []);
  const groups = data?.groups ?? [];

  return (
    <>
      <ScreenHeader
        title="Savings groups"
        subtitle="Your circles build your Nambikai record"
        tone="brand"
        action={
          <button
            onClick={() => navigate('/nambikai/groups/new')}
            className="rounded-full p-1.5 text-white/95 transition-colors hover:bg-white/15"
            aria-label="Start a new group"
          >
            <Icon name="plus" size={21} strokeWidth={2} />
          </button>
        }
      />

      <div className="space-y-3 px-3 pt-3">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {error && (
          <Card>
            <EmptyState
              icon="alert"
              title="Couldn't load your groups"
              description={error.message}
            />
          </Card>
        )}

        {!loading && !error && groups.length === 0 && (
          <Card>
            <EmptyState
              icon="users"
              title="No savings groups yet"
              description="A savings circle is the fastest way to build a Nambikai record. Every contribution you make on time becomes evidence a lender can read."
              action={
                <Button onClick={() => navigate('/nambikai/groups/new')}>Start a group</Button>
              }
            />
          </Card>
        )}

        {groups.map((group) => (
          <GroupCard key={group.id} group={group} />
        ))}

        {groups.length > 0 && (
          <Button variant="outline" full onClick={() => navigate('/nambikai/groups/new')}>
            <Icon name="plus" size={18} />
            Start another group
          </Button>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>
    </>
  );
}
