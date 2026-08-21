import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import Sheet from '../../components/Sheet.jsx';
import {
  Avatar,
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

function StatusChip({ contribution }) {
  const label =
    contribution.status === 'PAID' && contribution.daysLate > 0
      ? `Paid ${contribution.daysLate}d late`
      : contribution.statusLabel;
  return (
    <span
      className={cx(
        'shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold',
        STATUS_TONE[contribution.status] ?? 'bg-canvas text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}

/** The record this group has built — the thing the behaviour engine reads. */
function RecordCard({ stats }) {
  if (!stats || stats.dueCount === 0) return null;
  return (
    <Card>
      <CardHeader title="Your record in this group" />
      <div className="grid grid-cols-3 gap-px overflow-hidden bg-line">
        {[
          { label: 'On time', value: stats.onTimeCount, tone: 'text-credit' },
          { label: 'Missed', value: stats.missedCount, tone: 'text-debit' },
          { label: 'Cycles due', value: stats.dueCount, tone: 'text-ink' },
        ].map((cell) => (
          <div key={cell.label} className="bg-white px-3 py-3 text-center">
            <p className={cx('tnum text-[22px] font-bold leading-none', cell.tone)}>
              {cell.value}
            </p>
            <p className="mt-1 text-2xs font-medium text-ink-muted">{cell.label}</p>
          </div>
        ))}
      </div>
      <div className="hairline flex items-center justify-between px-4 py-3">
        <span className="text-[13px] text-ink-muted">Total contributed</span>
        <span className="tnum text-[15px] font-bold text-ink">{stats.totalSaved.formatted}</span>
      </div>
    </Card>
  );
}

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { refreshBalance } = useAuth();

  const { data, error, loading, reload } = useAsync(() => api.nambikai.group(id), [id]);
  const payout = useAsync(() => api.nambikai.payoutCycle(id), [id]);

  const [confirming, setConfirming] = useState(null);
  const [paying, setPaying] = useState(false);

  async function pay() {
    setPaying(true);
    try {
      const res = await api.nambikai.payContribution(id, confirming.id);
      setConfirming(null);
      await refreshBalance();
      navigate('/success', {
        state: {
          transaction: res.transaction,
          headline: 'Contribution paid',
          subline: `${data.group.name} · cycle ${res.contribution.cycleIndex}`,
          balancePaise: res.account.balancePaise,
        },
      });
    } catch (err) {
      toast.error(err.message);
      setConfirming(null);
      reload();
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <>
        <ScreenHeader title="Group" />
        <div className="flex justify-center py-20">
          <Spinner size={26} className="text-navy" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <ScreenHeader title="Group" />
        <div className="px-3 pt-3">
          <Card>
            <EmptyState icon="alert" title="Couldn't load this group" description={error.message} />
          </Card>
        </div>
      </>
    );
  }

  const { group, members, cycles, myContributions, isRotating, currentCycle } = data;
  const memberById = new Map(members.map((m) => [m.userId, m.user]));

  return (
    <>
      <ScreenHeader
        title={group.name}
        subtitle={`${group.contribution.formatted} · ${group.cadenceLabel.toLowerCase()}`}
        tone="brand"
      />

      <div className="space-y-3 px-3 pt-3">
        <RecordCard stats={group.my} />

        {/* ---- what I owe ------------------------------------------------- */}
        <Card>
          <CardHeader title="Your contributions" />
          {myContributions.length === 0 ? (
            <EmptyState
              icon="clock"
              title="Nothing due from you yet"
              description="This group hasn't reached a cycle you owe."
            />
          ) : (
            <div className="divide-y divide-line">
              {myContributions.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-ink">Cycle {c.cycleIndex}</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      Due {formatWhen(c.dueAt)}
                    </p>
                  </div>
                  <span className="tnum shrink-0 text-[14px] font-bold text-ink">
                    {c.amountDue.formatted}
                  </span>
                  {c.isPayable ? (
                    <Button size="sm" variant="sky" onClick={() => setConfirming(c)}>
                      Pay
                    </Button>
                  ) : (
                    <StatusChip contribution={c} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- members ---------------------------------------------------- */}
        <Card>
          <CardHeader title={`Members (${group.memberCount})`} />
          <div className="divide-y divide-line">
            {members
              .filter((m) => m.status === 'ACTIVE')
              .map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar
                    initials={m.user.initials}
                    color={m.user.avatarColor}
                    size={38}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold text-ink">{m.user.name}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">{m.user.upiId}</p>
                  </div>
                  {m.role === 'ADMIN' && (
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11.5px] font-bold text-navy">
                      Admin
                    </span>
                  )}
                </div>
              ))}
          </div>
        </Card>

        {/* ---- cycle timeline --------------------------------------------- */}
        <Card>
          <CardHeader title="Cycles" />
          <div className="divide-y divide-line">
            {cycles.map((cycle) => {
              const payoutTo = cycle.payoutToUserId
                ? memberById.get(cycle.payoutToUserId)
                : null;
              const complete = cycle.paidCount === cycle.totalCount;
              return (
                <div key={cycle.cycleIndex} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={cx(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                      cycle.missedCount > 0
                        ? 'bg-debit/10 text-debit'
                        : complete
                          ? 'bg-credit/10 text-credit'
                          : 'bg-sky-50 text-navy',
                    )}
                  >
                    {cycle.cycleIndex}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink">
                      {formatWhen(cycle.dueAt)}
                      {cycle.cycleIndex === currentCycle && (
                        <span className="ml-1.5 text-[11.5px] font-bold text-sky-600">now</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {cycle.paidCount}/{cycle.totalCount} paid
                      {payoutTo ? ` · pot to ${payoutTo.name.split(' ')[0]}` : ''}
                      {cycle.missedCount > 0 ? ` · ${cycle.missedCount} missed` : ''}
                    </p>
                  </div>
                  <span className="tnum shrink-0 text-[13px] font-semibold text-ink-muted">
                    {cycle.collected.formatted}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ---- payout routing --------------------------------------------- */}
        {isRotating && payout.data && (
          <Card className="border border-warn/25">
            <CardHeader title="This cycle's payout" />
            <div className="px-4 pb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-ink-muted">
                  Cycle {payout.data.cycleIndex} pot
                </span>
                <span className="tnum text-[16px] font-bold text-ink">
                  {payout.data.collected.formatted}
                  <span className="text-[12.5px] font-medium text-ink-faint">
                    {' '}
                    of {payout.data.expected.formatted}
                  </span>
                </span>
              </div>

              {payout.data.payoutTo && (
                <div className="mt-3 flex items-center gap-3 rounded-tile bg-canvas px-3 py-2.5">
                  <Avatar
                    initials={payout.data.payoutTo.initials}
                    color={payout.data.payoutTo.avatarColor}
                    size={32}
                  />
                  <p className="text-[13.5px] font-semibold text-ink">
                    {payout.data.payoutTo.name} takes this pot
                  </p>
                </div>
              )}

              {/* The regulatory posture, stated on the screen rather than only in
                  a doc: Nambikai records the schedule, it does not disburse. */}
              <div className="mt-3 flex items-start gap-2 rounded-tile bg-warn/5 px-3 py-2.5">
                <Icon name="info" size={15} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  <p className="text-[12.5px] font-bold text-warn">
                    {payout.data.routing.label}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                    {payout.data.routing.detail}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>

      {/* ---- confirm sheet ------------------------------------------------ */}
      <Sheet
        open={Boolean(confirming)}
        onClose={() => !paying && setConfirming(null)}
        title="Confirm contribution"
        footer={
          <Button full size="lg" loading={paying} onClick={pay}>
            Pay {confirming?.amountDue.formatted}
          </Button>
        }
      >
        {confirming && (
          <div className="space-y-3">
            <p className="text-center text-[13px] text-ink-muted">
              Cycle {confirming.cycleIndex} of {group.name}
            </p>
            <p className="tnum text-center text-[34px] font-bold leading-none text-ink">
              {confirming.amountDue.formatted}
            </p>
            <dl className="divide-y divide-line rounded-tile border border-line">
              {[
                ['Group', group.name],
                ['Cycle', `#${confirming.cycleIndex}`],
                ['Due', formatWhen(confirming.dueAt)],
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
