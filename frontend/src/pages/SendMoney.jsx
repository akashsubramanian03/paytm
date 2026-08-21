import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Card, EmptyState, Spinner } from '../components/primitives.jsx';
import { api } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import { useToast } from '../context/ToastContext.jsx';

export default function SendMoney() {
  const navigate = useNavigate();
  const toast = useToast();

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api
      .searchUsers(debounced, controller.signal)
      .then((data) => setResults(data.users))
      .catch((err) => {
        if (err.name !== 'AbortError') toast.error("Couldn't load people", err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <>
      <ScreenHeader title="Send money" subtitle="Search by name, email, mobile or UPI ID" />

      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 shadow-card focus-within:border-sky focus-within:ring-2 focus-within:ring-sky/25">
          <Icon name="search" size={19} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email, mobile or UPI ID"
            aria-label="Search people"
            className="h-12 w-full bg-transparent text-[15px] placeholder:text-ink-faint focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="rounded-md p-1 text-ink-faint hover:text-ink"
              aria-label="Clear search"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <button
          onClick={() => navigate('/scan')}
          className="mt-3 flex w-full items-center gap-3 rounded-card bg-white px-4 py-3.5 shadow-card transition-colors hover:bg-sky-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white">
            <Icon name="scan" size={20} />
          </span>
          <span className="flex-1 text-left">
            <span className="block text-[14.5px] font-semibold text-ink">Pay with a QR or UPI ID</span>
            <span className="block text-[12px] text-ink-muted">Scan a code or type it in</span>
          </span>
          <Icon name="chevronRight" size={18} className="text-ink-faint" />
        </button>

        <Card className="mt-3 overflow-hidden">
          <p className="px-4 pb-1 pt-3.5 text-2xs font-bold uppercase tracking-[0.09em] text-ink-faint">
            {debounced ? `Results for "${debounced}"` : 'People on Paytm'}
          </p>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner className="text-navy" />
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              icon="users"
              title="No one matched that"
              description="Try a different name, or the exact email, mobile number or UPI ID."
            />
          ) : (
            <ul className="divide-y divide-line">
              {results.map((person) => (
                <li key={person.id}>
                  <button
                    onClick={() => navigate(`/pay/${person.id}`)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sky-50 active:bg-sky-100"
                  >
                    <Avatar initials={person.initials} color={person.avatarColor} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-semibold text-ink">{person.name}</span>
                      <span className="block truncate text-[12.5px] text-ink-muted">{person.upiId}</span>
                      <span className="block truncate text-[11.5px] text-ink-faint">
                        {person.maskedPhone} · {person.maskedEmail}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-sky-50 px-3 py-1.5 text-[12.5px] font-bold text-navy">
                      Pay
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
