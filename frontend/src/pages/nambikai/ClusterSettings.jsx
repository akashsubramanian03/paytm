import { useState } from 'react';
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
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { formatWhen } from '../../lib/format.js';

/**
 * Turning group-level scoring on, off, or disputing it.
 *
 * The screen leads with what the signal IS and IS NOT, before the switch. A
 * toggle whose consequences a person has to infer is not meaningful consent —
 * and this is the one feature where the consequence is being partly assessed on
 * other people's behaviour.
 */
export default function ClusterSettings() {
  const toast = useToast();
  const status = useAsync(() => api.nambikai.clusterStatus(), []);
  const [busy, setBusy] = useState(null);
  const [disputing, setDisputing] = useState(null);
  const [reason, setReason] = useState('');

  async function toggle(cluster) {
    setBusy(cluster.groupId);
    try {
      if (cluster.optedIn) {
        const res = await api.nambikai.clusterOptOut(cluster.groupId);
        toast.info('Group signal turned off', res.note);
      } else {
        const res = await api.nambikai.clusterOptIn(cluster.groupId);
        toast.success('Group signal turned on', res.note);
      }
      await status.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function fileDispute() {
    setBusy(disputing.groupId);
    try {
      const res = await api.nambikai.createAppeal({ groupId: disputing.groupId, reason: reason.trim() });
      setDisputing(null);
      setReason('');
      toast.success('Dispute filed', res.note ?? 'The group signal is withheld from now on.');
      await status.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(appeal) {
    setBusy(appeal.id);
    try {
      await api.nambikai.withdrawAppeal(appeal.id);
      toast.info('Dispute withdrawn');
      await status.reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  }

  const clusters = status.data?.eligibleClusters ?? [];
  const appeals = status.data?.appeals ?? [];
  const openAppeals = new Set(
    appeals.filter((a) => a.status === 'OPEN' || a.status === 'UPHELD').map((a) => a.clusterId),
  );

  return (
    <>
      <ScreenHeader title="Group signal" subtitle="Off unless you turn it on" tone="brand" />

      <div className="space-y-3 px-3 pt-3">
        {/* ---- what this is, before the switch ------------------------- */}
        <Card className="px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
              <Icon name="link" size={20} />
            </span>
            <div>
              <p className="text-[14.5px] font-bold text-ink">
                A signal about your circle, not about you
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                Lenders often want to know whether a savings circle is reliable.
                Nambikai can calculate that from the other members’ record — never
                yours — and show it to a partner as a separate figure.
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {[
              ['check', 'It is never blended into your own score.'],
              ['check', 'Your own contributions are excluded from the figure.'],
              ['check', 'You can turn it off or dispute it at any time.'],
              ['alert', 'It can describe your group unfavourably even when your own record is spotless.'],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-2">
                <Icon
                  name={icon}
                  size={14}
                  className={cx('mt-1 shrink-0', icon === 'check' ? 'text-credit' : 'text-warn')}
                />
                <span className="text-[12.5px] leading-relaxed text-ink-muted">{text}</span>
              </li>
            ))}
          </ul>
        </Card>

        {status.loading && (
          <div className="flex justify-center py-12">
            <Spinner size={24} className="text-navy" />
          </div>
        )}

        {!status.loading && clusters.length === 0 && (
          <Card>
            <EmptyState
              icon="users"
              title="No eligible circles"
              description="A circle needs at least three members and a real run of completed cycles before a group signal means anything."
            />
          </Card>
        )}

        {clusters.map((cluster) => {
          const disputed = openAppeals.has(cluster.groupId);
          return (
            <Card key={cluster.groupId}>
              <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-ink">{cluster.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">
                    {cluster.memberCount} members · {cluster.observationsExcludingYou} contributions
                    from others
                  </p>
                  {!cluster.eligible && (
                    <p className="mt-1 text-[12px] text-warn">
                      Not enough history yet for a reliable group signal.
                    </p>
                  )}
                  {disputed && (
                    <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-warn">
                      <Icon name="flag" size={13} />
                      Disputed — the signal is withheld
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cluster.optedIn}
                  disabled={!cluster.eligible || busy === cluster.groupId}
                  onClick={() => toggle(cluster)}
                  className={cx(
                    'relative mt-1 h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-40',
                    cluster.optedIn ? 'bg-credit' : 'bg-line',
                  )}
                >
                  <span
                    className={cx(
                      'absolute top-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-card transition-all',
                      cluster.optedIn ? 'left-[23px]' : 'left-[3px]',
                    )}
                  >
                    {busy === cluster.groupId && <Spinner size={11} className="text-ink-muted" />}
                  </span>
                </button>
              </div>

              {cluster.eligible && !disputed && (
                <div className="border-t border-line px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => setDisputing(cluster)}
                    className="flex items-center gap-1.5 text-[12.5px] font-bold text-navy hover:underline"
                  >
                    <Icon name="flag" size={14} />
                    Dispute this group signal
                  </button>
                </div>
              )}
            </Card>
          );
        })}

        {appeals.length > 0 && (
          <Card>
            <CardHeader title="Your disputes" />
            <div className="divide-y divide-line">
              {appeals.map((a) => (
                <div key={a.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cx(
                        'rounded-full px-2 py-0.5 text-[11.5px] font-bold',
                        a.suppressed ? 'bg-warn/10 text-warn' : 'bg-canvas text-ink-muted',
                      )}
                    >
                      {a.status.toLowerCase()}
                    </span>
                    <span className="text-[11.5px] text-ink-faint">{formatWhen(a.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{a.reason}</p>
                  {a.status === 'OPEN' && (
                    <button
                      type="button"
                      onClick={() => withdraw(a)}
                      disabled={busy === a.id}
                      className="mt-2 text-[12.5px] font-bold text-navy hover:underline disabled:opacity-50"
                    >
                      Withdraw this dispute
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <MockBadge className="pb-3 pt-1" />
      </div>

      <Sheet
        open={Boolean(disputing)}
        onClose={() => setDisputing(null)}
        title="Dispute this group signal"
        footer={
          <Button
            full
            size="lg"
            disabled={reason.trim().length < 10}
            loading={busy === disputing?.groupId}
            onClick={fileDispute}
          >
            File dispute
          </Button>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Tell us why this group signal should not be applied to you. The signal is
          withheld from your assessments immediately, starting with the next one —
          you do not have to wait for the dispute to be reviewed.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          maxLength={500}
          placeholder="For example: my own contributions have all been on time."
          className="mt-3 w-full rounded-xl border border-line bg-white p-3 text-[14px] text-ink placeholder:text-ink-faint focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/25"
        />
      </Sheet>
    </>
  );
}
