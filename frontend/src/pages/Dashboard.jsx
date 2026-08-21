import { Link, useNavigate } from 'react-router-dom';
import { BrandBar } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Button, Card, CardHeader, EmptyState, MockBadge, Spinner, cx } from '../components/primitives.jsx';
import TransactionRow from '../components/TransactionRow.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatPaise, splitAmount } from '../lib/format.js';

const QUICK_ACTIONS = [
  { to: '/send', icon: 'send', label: 'Send Money' },
  { to: '/add-money', icon: 'plus', label: 'Add Money' },
  { to: '/recharge', icon: 'mobile', label: 'Recharge' },
  { to: '/scan', icon: 'scan', label: 'Scan QR' },
];

const SERVICES = [
  { to: '/recharge', icon: 'mobile', label: 'Mobile\nRecharge' },
  { to: '/bills?category=ELECTRICITY', icon: 'bolt', label: 'Electricity\nBill' },
  { to: '/bills?category=DTH', icon: 'tv', label: 'DTH\nRecharge' },
  { to: '/bills?category=BROADBAND', icon: 'wifi', label: 'Broadband\nBill' },
  { to: '/bills?category=GAS', icon: 'flame', label: 'Book Gas\nCylinder' },
  { to: '/bills?category=WATER', icon: 'droplet', label: 'Water\nBill' },
  { to: '/passbook', icon: 'passbook', label: 'Balance &\nHistory' },
  { to: '/bills', icon: 'chevronRight', label: 'View\nMore' },
];

export default function Dashboard() {
  const { user, account } = useAuth();
  const navigate = useNavigate();

  const summary = useAsync(() => api.summary(30), []);
  const payees = useAsync(() => api.recentPayees(), []);
  const recent = useAsync(() => api.transactions({ limit: 5 }), []);

  const amount = splitAmount(account?.balancePaise ?? 0);

  return (
    <>
      <BrandBar />

      <div className="space-y-3 px-3 pt-3">
        {/* ---- balance hero: the wallet is the first thing on the screen ---- */}
        <section className="overflow-hidden rounded-card bg-brand-card shadow-lift">
          <div className="px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
                  Paytm Wallet Balance
                </p>
                <p className="mt-2 flex items-baseline gap-0.5 text-white">
                  <span className="tnum text-[36px] font-bold leading-none tracking-[-0.025em]">
                    {amount.whole}
                  </span>
                  <span className="tnum text-[19px] font-semibold leading-none opacity-80">
                    .{amount.fraction}
                  </span>
                </p>
                <p className="mt-2 truncate text-[12.5px] text-sky-200">{user?.upiId}</p>
              </div>

              <Button variant="sky" size="sm" onClick={() => navigate('/add-money')} className="shrink-0">
                <Icon name="plus" size={15} strokeWidth={2.4} />
                Add Money
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-white/15 border-t border-white/15 bg-white/[0.07]">
            <StatCell
              label="Sent · 30 days"
              value={summary.data?.sentFormatted}
              count={summary.data?.sentCount}
              loading={summary.loading}
            />
            <StatCell
              label="Received · 30 days"
              value={summary.data?.receivedFormatted}
              count={summary.data?.receivedCount}
              loading={summary.loading}
            />
          </div>
        </section>

        {/* ---- quick actions ------------------------------------------------ */}
        <Card>
          <CardHeader title="UPI Money Transfer" />
          <div className="tile-grid px-3 pb-4">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.to} to={action.to} className="tile">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-navy">
                  <Icon name={action.icon} size={21} strokeWidth={1.8} />
                </span>
                <span className="tile-label">{action.label}</span>
              </Link>
            ))}
          </div>
          <Link
            to="/profile"
            className="flex items-center gap-2 border-t border-line bg-sky-50/70 px-4 py-2.5 text-[12.5px] font-semibold text-navy transition-colors hover:bg-sky-100"
          >
            <Icon name="gift" size={16} />
            <span className="flex-1">Your pay QR is ready to share</span>
            <Icon name="chevronRight" size={16} />
          </Link>
        </Card>

        {/* ---- pay again ---------------------------------------------------- */}
        {payees.data?.users?.length > 0 && (
          <Card>
            <CardHeader
              title="Pay again"
              action={
                <Link to="/send" className="text-[12.5px] font-bold text-navy hover:underline">
                  See all
                </Link>
              }
            />
            <div className="scrollbar-none flex gap-1 overflow-x-auto px-2 pb-4">
              {payees.data.users.map((payee) => (
                <button
                  key={payee.id}
                  onClick={() => navigate(`/pay/${payee.id}`)}
                  className="flex w-[74px] shrink-0 flex-col items-center gap-1.5 rounded-tile px-1 py-2 transition-colors active:bg-sky-50"
                >
                  <Avatar initials={payee.initials} color={payee.avatarColor} size={46} />
                  <span className="w-full truncate text-center text-2xs font-medium text-ink-muted">
                    {payee.firstName}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* ---- services ----------------------------------------------------- */}
        <Card>
          <CardHeader title="Recharge & Bill Payments" />
          <div className="tile-grid px-3 pb-4">
            {SERVICES.map((service) => (
              <Link key={service.label} to={service.to} className="tile">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-50 text-navy">
                  <Icon name={service.icon} size={21} strokeWidth={1.8} />
                </span>
                <span className="tile-label whitespace-pre-line">{service.label}</span>
              </Link>
            ))}
          </div>
        </Card>

        {/* ---- recent transactions ------------------------------------------ */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Recent transactions"
            action={
              <Link to="/passbook" className="text-[12.5px] font-bold text-navy hover:underline">
                View all
              </Link>
            }
          />
          {recent.loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="text-navy" />
            </div>
          ) : recent.data?.transactions?.length ? (
            <div className="divide-y divide-line">
              {recent.data.transactions.map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} showBalance={false} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon="passbook"
              title="No transactions yet"
              description="Send money to someone or add money to your wallet to see it here."
              action={
                <Button size="sm" onClick={() => navigate('/send')}>
                  Send money
                </Button>
              }
            />
          )}
        </Card>

        <MockBadge className="pb-3 pt-1" />
      </div>
    </>
  );
}

function StatCell({ label, value, count, loading }) {
  return (
    <div className="px-5 py-3">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-sky-200">{label}</p>
      <p className={cx('tnum mt-1 text-[15px] font-bold text-white', loading && 'opacity-40')}>
        {loading ? formatPaise(0) : (value ?? formatPaise(0))}
      </p>
      {!loading && count !== undefined && (
        <p className="text-2xs text-white/60">
          {count} {count === 1 ? 'transaction' : 'transactions'}
        </p>
      )}
    </div>
  );
}
