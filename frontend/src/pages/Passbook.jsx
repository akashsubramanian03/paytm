import { useCallback, useEffect, useState } from 'react';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import TransactionRow from '../components/TransactionRow.jsx';
import { Button, EmptyState, Spinner, cx } from '../components/primitives.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise, groupByDay } from '../lib/format.js';

const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'CREDIT', label: 'Money in', direction: 'CREDIT' },
  { id: 'DEBIT', label: 'Money out', direction: 'DEBIT' },
  { id: 'TRANSFER', label: 'Transfers', category: 'TRANSFER' },
  { id: 'ADD_MONEY', label: 'Top-ups', category: 'ADD_MONEY' },
  { id: 'RECHARGE', label: 'Recharges', category: 'RECHARGE' },
  { id: 'BILL_PAYMENT', label: 'Bills', category: 'BILL_PAYMENT' },
];

export default function Passbook() {
  const { account } = useAuth();
  const toast = useToast();

  const [filterId, setFilterId] = useState('ALL');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const active = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0];

  const load = useCallback(
    async (nextCursor) => {
      const isFirstPage = !nextCursor;
      isFirstPage ? setLoading(true) : setLoadingMore(true);
      try {
        const data = await api.transactions({
          limit: 20,
          cursor: nextCursor ?? undefined,
          direction: active.direction,
          category: active.category,
        });
        setItems((current) => (isFirstPage ? data.transactions : [...current, ...data.transactions]));
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (err) {
        toast.error("Couldn't load your passbook", err.message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [active.direction, active.category, toast],
  );

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterId]);

  const groups = groupByDay(items);

  return (
    <>
      <ScreenHeader
        title="Passbook"
        subtitle={`Balance ${formatPaise(account?.balancePaise ?? 0)}`}
        action={
          <button
            onClick={() => setShowFilters(true)}
            className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-bold text-navy transition-colors hover:bg-sky-50"
          >
            <Icon name="filter" size={15} />
            {active.label}
          </button>
        }
      />

      <div className="px-3 pt-3">
        {loading ? (
          <div className="card flex justify-center py-16">
            <Spinner className="text-navy" />
          </div>
        ) : items.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="passbook"
              title={filterId === 'ALL' ? 'Your passbook is empty' : `No ${active.label.toLowerCase()} yet`}
              description={
                filterId === 'ALL'
                  ? 'Every payment, top-up and recharge will show up here.'
                  : 'Try a different filter to see other entries.'
              }
              action={
                filterId !== 'ALL' && (
                  <Button size="sm" variant="outline" onClick={() => setFilterId('ALL')}>
                    Show all
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <section key={group.label} className="card overflow-hidden">
                <h2 className="border-b border-line bg-canvas/50 px-4 py-2 text-2xs font-bold uppercase tracking-[0.09em] text-ink-muted">
                  {group.label}
                </h2>
                <div className="divide-y divide-line">
                  {group.items.map((transaction) => (
                    <TransactionRow key={transaction.id} transaction={transaction} />
                  ))}
                </div>
              </section>
            ))}

            {hasMore && (
              <Button variant="outline" full loading={loadingMore} onClick={() => load(cursor)}>
                {loadingMore ? 'Loading' : 'Load older entries'}
              </Button>
            )}
            <p className="pb-3 pt-1 text-center text-2xs text-ink-faint">
              {items.length} {items.length === 1 ? 'entry' : 'entries'} shown
            </p>
          </div>
        )}
      </div>

      <Sheet open={showFilters} onClose={() => setShowFilters(false)} title="Filter passbook">
        <div className="grid grid-cols-2 gap-2 p-4">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              onClick={() => {
                setFilterId(filter.id);
                setShowFilters(false);
              }}
              className={cx(
                'rounded-xl border px-3 py-3 text-[14px] font-semibold transition-colors',
                filter.id === filterId
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-white text-ink hover:border-sky hover:bg-sky-50',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
