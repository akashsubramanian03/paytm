import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  Field,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useDebounced } from '../../lib/hooks.js';
import { useEffect } from 'react';

const PURPOSES = [
  {
    value: 'SAVINGS',
    label: 'Savings circle',
    hint: 'Everyone contributes each cycle to the group’s collector.',
  },
  {
    value: 'ROTATING_SAVINGS',
    label: 'Rotating (chit)',
    hint: 'Each cycle, one member takes the pot in turn.',
  },
  {
    value: 'EMERGENCY_FUND',
    label: 'Emergency fund',
    hint: 'A shared buffer the group can draw on.',
  },
  {
    value: 'BUSINESS_POOL',
    label: 'Business pool',
    hint: 'For traders and vendors pooling working capital.',
  },
];

const CADENCES = [
  { value: 'MONTHLY', label: 'Every month' },
  { value: 'WEEKLY', label: 'Every week' },
];

function Chip({ selected, children, ...rest }) {
  return (
    <button
      type="button"
      className={cx(
        'rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors',
        selected
          ? 'border-navy bg-navy text-white'
          : 'border-line bg-white text-ink hover:border-sky hover:bg-sky-50',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export default function CreateGroup() {
  const navigate = useNavigate();
  const toast = useToast();

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('SAVINGS');
  const [cadence, setCadence] = useState('MONTHLY');
  const [amount, setAmount] = useState('');
  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const debounced = useDebounced(query, 250);

  useEffect(() => {
    if (debounced.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    api
      .searchUsers(debounced.trim(), controller.signal)
      .then((res) => setResults(res.users))
      .catch((err) => {
        if (err.name !== 'AbortError') setResults([]);
      })
      .finally(() => setSearching(false));
    return () => controller.abort();
  }, [debounced]);

  const toggleMember = (user) =>
    setMembers((prev) =>
      prev.some((m) => m.id === user.id)
        ? prev.filter((m) => m.id !== user.id)
        : [...prev, user],
    );

  async function submit(e) {
    e.preventDefault();
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await api.nambikai.createGroup({
        name: name.trim(),
        purpose,
        cadence,
        amount,
        memberUserIds: members.map((m) => m.id),
      });
      toast.success('Group created', `${res.group.name} is ready.`);
      navigate(`/nambikai/groups/${res.group.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        setFieldErrors(err.fieldErrors);
      } else {
        toast.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const activePurpose = PURPOSES.find((p) => p.value === purpose);

  return (
    <>
      <ScreenHeader title="Start a savings group" tone="brand" />

      <form onSubmit={submit} className="space-y-3 px-3 pt-3">
        <Card className="px-4 py-4">
          <Field
            label="Group name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anna Nagar Vendors Circle"
            error={fieldErrors.name}
            autoComplete="off"
          />

          <div className="mt-4">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-muted">
              What kind of group?
            </span>
            <div className="flex flex-wrap gap-2">
              {PURPOSES.map((p) => (
                <Chip
                  key={p.value}
                  selected={purpose === p.value}
                  onClick={() => setPurpose(p.value)}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
            {activePurpose && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                {activePurpose.hint}
              </p>
            )}
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink-muted">
              How often?
            </span>
            <div className="flex gap-2">
              {CADENCES.map((c) => (
                <Chip
                  key={c.value}
                  selected={cadence === c.value}
                  onClick={() => setCadence(c.value)}
                >
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>

          <Field
            className="mt-4"
            label="Contribution per member, per cycle"
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              if (/^\d{0,7}(\.\d{0,2})?$/.test(e.target.value)) setAmount(e.target.value);
            }}
            placeholder="500"
            prefix="₹"
            error={fieldErrors.amount}
          />
        </Card>

        {/* ---- members --------------------------------------------------- */}
        <Card>
          <CardHeader title="Add members" />
          <div className="px-4 pb-4">
            {members.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {members.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m)}
                    className="flex items-center gap-1.5 rounded-full border border-navy bg-navy py-1 pl-1 pr-2.5 text-[12.5px] font-semibold text-white"
                  >
                    <Avatar initials={m.initials} color={m.avatarColor} size={22} />
                    {m.name.split(' ')[0]}
                    <Icon name="close" size={13} />
                  </button>
                ))}
              </div>
            )}

            <Field
              name="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, mobile or UPI ID"
              prefix={<Icon name="search" size={17} />}
              suffix={searching ? <Spinner size={15} className="text-ink-faint" /> : null}
              autoComplete="off"
            />

            {results.length > 0 && (
              <div className="mt-2 divide-y divide-line rounded-tile border border-line">
                {results.map((user) => {
                  const selected = members.some((m) => m.id === user.id);
                  return (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => toggleMember(user)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-sky-50"
                    >
                      <Avatar initials={user.initials} color={user.avatarColor} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">
                          {user.name}
                        </span>
                        <span className="block truncate text-[12px] text-ink-muted">
                          {user.upiId}
                        </span>
                      </span>
                      <Icon
                        name={selected ? 'check' : 'plus'}
                        size={18}
                        className={selected ? 'text-credit' : 'text-navy'}
                      />
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
              You’ll be the group admin. Members can be added later too.
            </p>
          </div>
        </Card>

        <Button type="submit" full size="lg" loading={submitting} disabled={!name.trim() || !amount}>
          Create group
        </Button>

        <MockBadge className="pb-3 pt-1" />
      </form>
    </>
  );
}
