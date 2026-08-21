import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import AmountEntry from '../components/AmountEntry.jsx';
import Icon from '../components/Icon.jsx';
import { Button, Field, MockBadge, cx } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise } from '../lib/format.js';

const METHODS = [
  { id: 'CARD', label: 'Debit / Credit card', icon: 'card' },
  { id: 'NETBANKING', label: 'Net banking', icon: 'bank' },
  { id: 'UPI', label: 'Another UPI app', icon: 'scan' },
];

const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank'];

export default function AddMoney() {
  const navigate = useNavigate();
  const toast = useToast();
  const { account, refreshBalance } = useAuth();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CARD');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [bank, setBank] = useState(BANKS[0]);
  const [upiId, setUpiId] = useState('');
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    try {
      const payload = {
        amount,
        method,
        ...(method === 'CARD' && { cardNumber: cardNumber.replace(/\s/g, '') }),
        ...(method === 'NETBANKING' && { bank }),
        ...(method === 'UPI' && { upiId }),
      };
      const result = await api.addMoney(payload);
      await refreshBalance();
      toast.success('Money added', result.message);
      navigate('/success', {
        replace: true,
        state: {
          kind: 'ADD_MONEY',
          transaction: result.transaction,
          headline: result.transaction.counterparty.name,
          subline: result.transaction.counterparty.handle,
          balancePaise: result.account.balancePaise,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ ...err.fieldErrors, form: err.message });
        toast.error("Couldn't add money", err.message);
      } else {
        toast.error('Something went wrong', 'Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Add money" subtitle={`Balance ${formatPaise(account?.balancePaise ?? 0)}`} />

      <form onSubmit={handleSubmit} className="space-y-3 px-3 pt-3">
        <section className="card px-5 py-6">
          <AmountEntry
            value={amount}
            onChange={setAmount}
            error={errors.amount ?? errors.form}
            quickAmounts={[500, 1000, 2000, 5000]}
          />
        </section>

        <section className="card overflow-hidden">
          <h2 className="section-title px-4 pb-2 pt-3.5">Pay using</h2>
          <div className="divide-y divide-line">
            {METHODS.map((option) => (
              <label
                key={option.id}
                className={cx(
                  'flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors',
                  method === option.id ? 'bg-sky-50' : 'hover:bg-canvas/60',
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={option.id}
                  checked={method === option.id}
                  onChange={() => setMethod(option.id)}
                  className="sr-only"
                />
                <span
                  className={cx(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    method === option.id ? 'bg-navy text-white' : 'bg-canvas text-navy',
                  )}
                >
                  <Icon name={option.icon} size={19} />
                </span>
                <span className="flex-1 text-[14.5px] font-semibold text-ink">{option.label}</span>
                <span
                  className={cx(
                    'flex h-5 w-5 items-center justify-center rounded-full border-2',
                    method === option.id ? 'border-navy' : 'border-line',
                  )}
                >
                  {method === option.id && <span className="h-2.5 w-2.5 rounded-full bg-navy" />}
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-4 border-t border-line p-4">
            {method === 'CARD' && (
              <>
                <Field
                  label="Card number"
                  name="cardNumber"
                  inputMode="numeric"
                  placeholder="4111 1111 1111 1111"
                  value={cardNumber}
                  onChange={(e) =>
                    setCardNumber(
                      e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(),
                    )
                  }
                  error={errors.cardNumber}
                  prefix={<Icon name="card" size={17} />}
                  hint="Any test number works — nothing is charged or stored."
                />
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Expiry" name="expiry" placeholder="12/28" value={expiry}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
                    }}
                  />
                  <Field
                    label="CVV" name="cvv" inputMode="numeric" type="password" placeholder="•••"
                    value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
              </>
            )}

            {method === 'NETBANKING' && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-ink-muted">Choose your bank</span>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className="h-12 w-full rounded-xl border border-line bg-white px-3.5 text-[15px] focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/25"
                >
                  {BANKS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </label>
            )}

            {method === 'UPI' && (
              <Field
                label="UPI ID to debit" name="upiId" placeholder="yourname@okbank"
                value={upiId} onChange={(e) => setUpiId(e.target.value)} error={errors.upiId}
                prefix={<Icon name="scan" size={17} />}
              />
            )}
          </div>
        </section>

        <div className="rounded-card border border-dashed border-navy/25 bg-sky-50 px-4 py-3">
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-navy">
            <Icon name="info" size={16} className="mt-px shrink-0" />
            <span>
              This is a mock top-up. No bank, card network or payment gateway is contacted — the amount is
              simply credited to your local wallet and written to your passbook.
            </span>
          </p>
        </div>

        <div className="space-y-3 pb-6 pt-1">
          <Button type="submit" size="lg" full loading={submitting} disabled={!amount}>
            {submitting ? 'Adding money' : `Add ${amount ? `₹${amount}` : 'money'}`}
          </Button>
          <MockBadge />
        </div>
      </form>
    </>
  );
}
