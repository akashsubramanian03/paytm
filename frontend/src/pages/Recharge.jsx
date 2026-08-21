import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { Button, Card, EmptyState, Field, MockBadge, Spinner, cx } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise } from '../lib/format.js';

const CATEGORIES = [
  { id: 'POPULAR', label: 'Popular' },
  { id: 'UNLIMITED', label: 'Unlimited' },
  { id: 'DATA', label: 'Data' },
  { id: 'TALKTIME', label: 'Talktime' },
];

export default function Recharge() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user, account, refreshBalance } = useAuth();

  const [mobile, setMobile] = useState(user?.phone ?? '');
  const [operator, setOperator] = useState('');
  const [category, setCategory] = useState('POPULAR');
  const [selected, setSelected] = useState(null);
  const [paying, setPaying] = useState(false);
  const [mobileError, setMobileError] = useState(null);

  const operators = useAsync(() => api.operators(), []);
  const plans = useAsync(() => api.plans({ operator: operator || undefined }), [operator]);

  // Default to the first operator once the list arrives.
  const operatorList = operators.data?.operators ?? [];
  const activeOperator = operator || operatorList[0] || '';

  const visiblePlans = useMemo(
    () =>
      (plans.data?.plans ?? []).filter(
        (plan) => plan.category === category && (!activeOperator || plan.operator === activeOperator),
      ),
    [plans.data, category, activeOperator],
  );

  async function confirmRecharge() {
    if (!/^[6-9]\d{9}$/.test(mobile)) {
      setMobileError('Enter a valid 10-digit mobile number.');
      setSelected(null);
      toast.error('Check the mobile number', 'It must be 10 digits starting with 6-9.');
      return;
    }
    setPaying(true);
    try {
      const result = await api.recharge({ planId: selected.id, mobileNumber: mobile });
      await refreshBalance();
      toast.success('Recharge successful', result.message);
      navigate('/success', {
        replace: true,
        state: {
          kind: 'RECHARGE',
          transaction: result.transaction,
          headline: `${result.plan.operator} Prepaid`,
          subline: `${mobile} · ${result.plan.data} for ${result.plan.validityLabel}`,
          balancePaise: result.account.balancePaise,
        },
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Please try again.';
      toast.error('Recharge failed', message);
      setSelected(null);
    } finally {
      setPaying(false);
    }
  }

  return (
    <>
      <ScreenHeader
        title="Mobile recharge"
        subtitle={`Balance ${formatPaise(account?.balancePaise ?? 0)}`}
      />

      <div className="space-y-3 px-3 pt-3">
        <Card className="p-4">
          <Field
            label="Mobile number"
            name="mobile"
            inputMode="numeric"
            placeholder="9876543210"
            prefix={<span className="text-[15px] font-semibold text-ink">+91</span>}
            value={mobile}
            error={mobileError}
            onChange={(e) => {
              setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
              setMobileError(null);
            }}
          />

          <p className="mb-2 mt-4 text-[13px] font-semibold text-ink-muted">Operator</p>
          {operators.loading ? (
            <Spinner size={18} className="text-navy" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {operatorList.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setOperator(name);
                    setSelected(null);
                  }}
                  className={cx(
                    'rounded-full border px-4 py-1.5 text-[13px] font-semibold transition-colors',
                    name === activeOperator
                      ? 'border-navy bg-navy text-white'
                      : 'border-line bg-white text-ink hover:border-sky hover:bg-sky-50',
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-line px-2 pt-1">
            {CATEGORIES.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={cx(
                  'relative shrink-0 px-3.5 py-3 text-[13.5px] font-bold transition-colors',
                  category === tab.id ? 'text-navy' : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {tab.label}
                {category === tab.id && (
                  <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-navy" />
                )}
              </button>
            ))}
          </div>

          {plans.loading ? (
            <div className="flex justify-center py-14">
              <Spinner className="text-navy" />
            </div>
          ) : visiblePlans.length === 0 ? (
            <EmptyState
              icon="mobile"
              title="No plans in this pack"
              description={`${activeOperator || 'This operator'} has no ${CATEGORIES.find((c) => c.id === category)?.label.toLowerCase()} plans right now. Try another tab.`}
            />
          ) : (
            <ul className="divide-y divide-line">
              {visiblePlans.map((plan) => (
                <li key={plan.id}>
                  <button
                    onClick={() => setSelected(plan)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-sky-50 active:bg-sky-100"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="tnum text-[17px] font-bold text-ink">{plan.priceFormatted}</span>
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-navy">
                          {plan.validityLabel}
                        </span>
                        <span className="text-[12px] font-semibold text-ink-muted">{plan.data}</span>
                      </span>
                      <span className="mt-1 block text-[12.5px] leading-snug text-ink-muted">
                        {plan.description}
                      </span>
                    </span>
                    <span className="mt-1 shrink-0 rounded-full bg-navy px-3.5 py-1.5 text-[12.5px] font-bold text-white">
                      Recharge
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <MockBadge className="pb-3 pt-1">Simulated recharge — no operator is contacted</MockBadge>
      </div>

      <Sheet
        open={Boolean(selected)}
        onClose={() => !paying && setSelected(null)}
        title="Confirm recharge"
        footer={
          <Button size="lg" full loading={paying} onClick={confirmRecharge}>
            {paying ? 'Paying' : `Pay ${selected?.priceFormatted ?? ''}`}
          </Button>
        }
      >
        {selected && (
          <div className="p-4">
            <div className="flex items-center gap-3 rounded-xl bg-canvas/70 p-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-white">
                <Icon name="mobile" size={20} />
              </span>
              <span>
                <span className="block text-[14.5px] font-bold text-ink">
                  {selected.operator} Prepaid
                </span>
                <span className="tnum block text-[12.5px] text-ink-muted">+91 {mobile || '—'}</span>
              </span>
            </div>

            <dl className="mt-4 divide-y divide-line rounded-xl border border-line">
              <DetailLine label="Amount" value={selected.priceFormatted} strong />
              <DetailLine label="Validity" value={selected.validityLabel} />
              <DetailLine label="Data" value={selected.data} />
              {selected.talktime && <DetailLine label="Talktime" value={selected.talktime} />}
              {selected.sms && <DetailLine label="SMS" value={selected.sms} />}
              <DetailLine label="Paying from" value={`Wallet · ${formatPaise(account?.balancePaise ?? 0)}`} />
            </dl>

            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              The plan price is taken from the server record, not from this screen.
            </p>
          </div>
        )}
      </Sheet>
    </>
  );
}

function DetailLine({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2.5">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className={cx('text-[13px] text-ink', strong ? 'tnum font-bold' : 'font-semibold')}>{value}</dd>
    </div>
  );
}
