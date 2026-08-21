import { useState } from 'react';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card, EmptyState, MockBadge, Spinner, cx } from '../../components/primitives.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { formatWhen, formatDayGroup } from '../../lib/format.js';

/**
 * The record of what Nambikai actually did.
 *
 * Every row here is generated from ConsentAuditLog, never from static copy. A
 * USE row means data was genuinely read; a DENY row means a request was refused
 * because permission was missing — and showing refusals is the point, because
 * "we never looked at that" is only credible if the absence is recorded too.
 */
const TONE = {
  GRANT: { icon: 'check', className: 'bg-credit/10 text-credit' },
  USE: { icon: 'chart', className: 'bg-sky-100 text-navy' },
  REVOKE: { icon: 'slash', className: 'bg-warn/10 text-warn' },
  DENY: { icon: 'lock', className: 'bg-debit/10 text-debit' },
  EXPIRE: { icon: 'clock', className: 'bg-canvas text-ink-muted' },
};

const ACTION_NOTE = {
  DENY: 'Refused — you had not granted this',
  USE: 'Read to produce something you asked for',
};

export default function ConsentAudit() {
  const [pages, setPages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const first = useAsync(async () => {
    const res = await api.nambikai.consentAudit({ limit: 30 });
    setPages([res.events]);
    setCursor(res.nextCursor);
    return res;
  }, []);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.nambikai.consentAudit({ limit: 30, cursor });
      setPages((p) => [...p, res.events]);
      setCursor(res.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const events = pages.flat();

  // Group by day, reusing the passbook's own date grouping so the two screens
  // read the same way.
  const days = [];
  for (const event of events) {
    const label = formatDayGroup(event.createdAt);
    const last = days[days.length - 1];
    if (last && last.label === label) last.events.push(event);
    else days.push({ label, events: [event] });
  }

  return (
    <>
      <ScreenHeader title="What Nambikai has read" subtitle="Generated from the audit log" />

      <div className="space-y-3 px-3 pt-3">
        {first.loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {!first.loading && events.length === 0 && (
          <Card>
            <EmptyState
              icon="passbook"
              title="Nothing read yet"
              description="Once you grant a permission and Nambikai uses it, every read shows up here."
            />
          </Card>
        )}

        {days.map((day) => (
          <Card key={day.label}>
            <p className="px-4 pb-1 pt-3 text-2xs font-bold uppercase tracking-[0.09em] text-ink-faint">
              {day.label}
            </p>
            <div className="divide-y divide-line">
              {day.events.map((event) => {
                const tone = TONE[event.action] ?? TONE.EXPIRE;
                return (
                  <div key={event.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cx(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                        tone.className,
                      )}
                    >
                      <Icon name={tone.icon} size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold leading-snug text-ink">
                        {event.label}
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-muted">
                        {event.purposeLabel} · {formatWhen(event.createdAt)}
                      </p>
                      {ACTION_NOTE[event.action] && (
                        <p className="mt-1 text-[11.5px] text-ink-faint">
                          {ACTION_NOTE[event.action]}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}

        {cursor && (
          <Button variant="outline" full loading={loadingMore} onClick={loadMore}>
            Load older entries
          </Button>
        )}

        <MockBadge className="pb-3 pt-1">
          This record is append-only — withdrawing a permission never erases it
        </MockBadge>
      </div>
    </>
  );
}
