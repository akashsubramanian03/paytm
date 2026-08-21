import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ListRow,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

/**
 * The consent screen.
 *
 * Grouped by PURPOSE rather than by data type, because that is the decision a
 * person is actually making: "let Nambikai show me my own score" and "let
 * Nambikai send an assessment to a lender" are different questions, and a single
 * list of data types would collapse them into one.
 */
const PURPOSE_BLURB = {
  HEALTH_SCORE: 'Lets Nambikai work out your financial health score and show it to you. Nothing leaves Paytm.',
  UNDERWRITING: 'Lets you send an explainable assessment to a lending partner you pick. You choose the partner, every time.',
  ASSISTANT: 'Lets the assistant answer questions about your own money. It only ever sees summaries, never your transactions.',
  SME_UNDERWRITING: 'The same as above, for a business you own.',
};

function Toggle({ on, busy, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      role="switch"
      aria-checked={on}
      className={cx(
        'relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors disabled:opacity-50',
        on ? 'bg-credit' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'absolute top-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-card transition-all',
          on ? 'left-[23px]' : 'left-[3px]',
        )}
      >
        {busy && <Spinner size={11} className="text-ink-muted" />}
      </span>
    </button>
  );
}

export default function Consent() {
  const toast = useToast();
  const catalogue = useAsync(() => api.nambikai.consentCatalogue(), []);
  const consents = useAsync(() => api.nambikai.consents(), []);
  const [busyKey, setBusyKey] = useState(null);

  const active = new Map();
  for (const c of consents.data?.consents ?? []) {
    if (c.active) active.set(`${c.purpose}:${c.dataType}`, c);
  }

  async function toggle(purpose, dataType) {
    const key = `${purpose}:${dataType}`;
    const existing = active.get(key);
    setBusyKey(key);
    try {
      if (existing) {
        const res = await api.nambikai.revokeConsent(existing.id);
        const n = res.affectedArtifacts.scores + res.affectedArtifacts.reports;
        toast.info(
          'Permission withdrawn',
          n > 0
            ? `${n} existing ${n === 1 ? 'assessment is' : 'assessments are'} now marked unusable. They are kept as a record of what was shared.`
            : 'Nambikai will not read this again.',
        );
      } else {
        await api.nambikai.grantConsent({ dataType, purpose });
        toast.success('Permission granted', 'You can withdraw it at any time.');
      }
      await consents.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusyKey(null);
    }
  }

  const loading = catalogue.loading || consents.loading;
  const purposes = catalogue.data?.purposes ?? [];
  const labelOf = new Map((catalogue.data?.dataTypes ?? []).map((d) => [d.dataType, d.label]));

  return (
    <>
      <ScreenHeader title="Data & consent" subtitle="You decide what Nambikai can read" tone="brand" />

      <div className="space-y-3 px-3 pt-3">
        {/* ---- the promise, stated plainly ------------------------------- */}
        <Card className="px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
              <Icon name="shield" size={20} />
            </span>
            <div>
              <p className="text-[14.5px] font-bold text-ink">Nothing is read without permission</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                Each permission below is for one kind of data and one purpose. Turn
                any of them off and Nambikai stops reading it immediately — and you
                can see exactly what it read while it was on.
              </p>
            </div>
          </div>
        </Card>

        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {!loading &&
          purposes.map((p) => (
            <Card key={p.purpose}>
              <CardHeader title={p.label} />
              <p className="px-4 pb-3 text-[12.5px] leading-relaxed text-ink-muted">
                {PURPOSE_BLURB[p.purpose] ?? ''}
              </p>
              <div className="divide-y divide-line border-t border-line">
                {p.requires.map((dataType) => {
                  const key = `${p.purpose}:${dataType}`;
                  const on = active.has(key);
                  return (
                    <div key={key} className="flex items-center gap-3 px-4 py-3">
                      <span
                        className={cx(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                          on ? 'bg-credit/10 text-credit' : 'bg-canvas text-ink-faint',
                        )}
                      >
                        <Icon name={on ? 'check' : 'lock'} size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-ink">
                          {labelOf.get(dataType) ?? dataType}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-ink-muted">
                          {on ? 'Nambikai may read this' : 'Not shared'}
                        </span>
                      </span>
                      <Toggle
                        on={on}
                        busy={busyKey === key}
                        onClick={() => toggle(p.purpose, dataType)}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

        {!loading && purposes.length === 0 && (
          <Card>
            <EmptyState icon="alert" title="Couldn't load permissions" />
          </Card>
        )}

        <Card>
          <ListRow
            icon={
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                <Icon name="passbook" size={19} />
              </span>
            }
            title="What Nambikai has read"
            subtitle="Every read, refusal and change, with the date"
            onClick={() => {}}
            as="div"
            className="pointer-events-none"
          />
          <div className="px-4 pb-4">
            <Link to="/nambikai/consent/audit">
              <Button variant="outline" full>
                Open the record
              </Button>
            </Link>
          </div>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated data — no real financial records are involved
        </MockBadge>
      </div>
    </>
  );
}
