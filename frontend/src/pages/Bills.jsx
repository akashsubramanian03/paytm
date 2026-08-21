import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import AmountEntry from '../components/AmountEntry.jsx';
import { Button, Card, EmptyState, Field, MockBadge, Spinner, cx } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise } from '../lib/format.js';

const CATEGORIES = [
  { id: '', label: 'All', icon: 'bag' },
  { id: 'ELECTRICITY', label: 'Electricity', icon: 'bolt' },
  { id: 'DTH', label: 'DTH', icon: 'tv' },
  { id: 'BROADBAND', label: 'Broadband', icon: 'wifi' },
  { id: 'GAS', label: 'Gas', icon: 'flame' },
  { id: 'WATER', label: 'Water', icon: 'droplet' },
];

const ICON_FOR = { bolt: 'bolt', tv: 'tv', wifi: 'wifi', flame: 'flame', droplet: 'droplet' };

export default function Bills() {
  const navigate = useNavigate();
  const toast = useToast();
  const { account, refreshBalance } = useAuth();
  const [params, setParams] = useSearchParams();

  const category = params.get('category') ?? '';
  const [selected, setSelected] = useState(null);
  const [consumerNumber, setConsumerNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState({});
  const [paying, setPaying] = useState(false);

  const billers = useAsync(() => api.billers({ category: category || undefined }), [category]);

  function openBiller(biller) {
    setSelected(biller);
    setConsumerNumber('');
    setAmount('');
    setErrors({});
  }

  async function payBill() {
    setErrors({});
    setPaying(true);
    try {
      const result = await api.payBill({ billerId: selected.id, consumerNumber, amount });
      await refreshBalance();
      toast.success('Bill paid', result.message);
      navigate('/success', {
        replace: true,
        state: {
          kind: 'BILL_PAYMENT',
          transaction: result.transaction,
          headline: selected.name,
          subline: `Consumer no. ${consumerNumber}`,
          balancePaise: result.account.balancePaise,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...err.fieldErrors, form: err.message });
        toast.error("Couldn't pay this bill", err.message);
      } else {
        toast.error('Something went wrong', 'Please try again.');
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <ScreenHeader
        title="Bill payments"
        subtitle={`Balance ${formatPaise(account?.balancePaise ?? 0)}`}
      />

      <div className="space-y-3 px-3 pt-3">
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {CATEGORIES.map((tab) => (
            <button
              key={tab.id || 'all'}
              onClick={() => (tab.id ? setParams({ category: tab.id }) : setParams({}))}
              className={cx(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors',
                category === tab.id
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-white text-ink hover:border-sky hover:bg-sky-50',
              )}
            >
              <Icon name={tab.icon} size={15} />
              {tab.label}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          {billers.loading ? (
            <div className="flex justify-center py-14">
              <Spinner className="text-navy" />
            </div>
          ) : billers.data?.billers?.length ? (
            <ul className="divide-y divide-line">
              {billers.data.billers.map((biller) => (
                <li key={biller.id}>
                  <button
                    onClick={() => openBiller(biller)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-sky-50 active:bg-sky-100"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
                      <Icon name={ICON_FOR[biller.icon] ?? 'bolt'} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-ink">{biller.name}</span>
                      <span className="tnum block text-[12px] text-ink-muted">
                        {biller.minFormatted} – {biller.maxFormatted}
                      </span>
                    </span>
                    <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="bolt" title="No billers here" description="Pick another category above." />
          )}
        </Card>

        <MockBadge className="pb-3 pt-1">Simulated bill payment — no biller is contacted</MockBadge>
      </div>

      <Sheet
        open={Boolean(selected)}
        onClose={() => !paying && setSelected(null)}
        title={selected?.name ?? 'Pay bill'}
        footer={
          <Button size="lg" full loading={paying} disabled={!amount || !consumerNumber} onClick={payBill}>
            {paying ? 'Paying' : `Pay ${amount ? `₹${amount}` : 'bill'}`}
          </Button>
        }
      >
        {selected && (
          <div className="space-y-5 p-4">
            <Field
              label="Consumer / account number"
              name="consumerNumber"
              placeholder="e.g. TN4471902"
              value={consumerNumber}
              onChange={(e) => setConsumerNumber(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 24))}
              error={errors.consumerNumber}
              prefix={<Icon name="passbook" size={17} />}
              hint="Any reference works in this demo."
            />

            <div className="rounded-xl border border-line p-4">
              <AmountEntry
                value={amount}
                onChange={setAmount}
                error={errors.amount ?? errors.form}
                autoFocus={false}
                quickAmounts={[500, 1000, 1500, 2000]}
                max={formatPaise(account?.balancePaise ?? 0)}
              />
            </div>

            <p className="tnum text-center text-[12px] text-ink-faint">
              {selected.name} accepts {selected.minFormatted} – {selected.maxFormatted}
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}
