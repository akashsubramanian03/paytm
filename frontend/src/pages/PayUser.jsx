import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import AmountEntry from '../components/AmountEntry.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Button, Field, MockBadge, Spinner } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatPaise } from '../lib/format.js';

export default function PayUser() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { account, refreshBalance } = useAuth();

  const recipient = useAsync(() => api.user(userId), [userId]);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const person = recipient.data?.user;

  async function handlePay(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await api.transfer({ toUserId: userId, amount, note: note || undefined });
      await refreshBalance();
      toast.success('Payment successful', result.message);
      navigate('/success', {
        replace: true,
        state: {
          kind: 'TRANSFER',
          transaction: result.transaction,
          headline: `Paid to ${result.recipient.name}`,
          subline: result.recipient.upiId,
          balancePaise: result.account.balancePaise,
        },
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Please try again.';
      setError(message);
      toast.error('Payment failed', message);
    } finally {
      setSubmitting(false);
    }
  }

  if (recipient.loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={24} className="text-navy" />
      </div>
    );
  }

  if (!person) {
    return (
      <>
        <ScreenHeader title="Send money" />
        <div className="px-4 py-16 text-center">
          <p className="text-[15px] font-bold text-ink">We couldn't find that person</p>
          <p className="mt-1 text-[13px] text-ink-muted">They may have left Paytm.</p>
          <Button className="mt-5" onClick={() => navigate('/send')}>
            Back to search
          </Button>
        </div>
      </>
    );
  }

  const available = formatPaise(account?.balancePaise ?? 0);

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <ScreenHeader title="Send money" />

      <form onSubmit={handlePay} className="flex flex-1 flex-col">
        <div className="flex flex-col items-center gap-2 px-5 pb-1 pt-7">
          <Avatar initials={person.initials} color={person.avatarColor} size={64} />
          <p className="mt-1 text-[17px] font-bold text-ink">{person.name}</p>
          <p className="text-[13px] text-ink-muted">{person.upiId}</p>
        </div>

        <div className="px-5 pt-6">
          <AmountEntry value={amount} onChange={setAmount} error={error} max={available} />
        </div>

        <div className="px-5 pt-7">
          <Field
            label="Add a note (optional)"
            name="note"
            maxLength={120}
            placeholder="What is this for?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            prefix={<Icon name="edit" size={17} />}
          />
        </div>

        <div className="mt-auto space-y-3 px-5 pb-7 pt-8">
          <Button type="submit" size="lg" full loading={submitting} disabled={!amount}>
            {submitting ? 'Paying' : `Pay ${amount ? `₹${amount}` : ''}`.trim()}
          </Button>
          <MockBadge />
        </div>
      </form>
    </div>
  );
}
