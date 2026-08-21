import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card, CardHeader, MockBadge, Spinner, cx } from '../../components/primitives.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api, ApiError } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

/**
 * Choosing who to share an assessment with.
 *
 * The partner is picked by the person, one at a time. There is no route by which
 * a lender can request a report about someone — that asymmetry is the product.
 */
export default function RequestReport() {
  const navigate = useNavigate();
  const toast = useToast();
  const partners = useAsync(() => api.nambikai.partners(), []);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gateError, setGateError] = useState(null);

  async function generate() {
    if (!selected) return;
    setBusy(true);
    setGateError(null);
    try {
      const res = await api.nambikai.createReport({ partnerId: selected });
      toast.success('Assessment generated');
      navigate('/nambikai/report', { state: { report: res.report }, replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONSENT_REQUIRED') setGateError(err);
      else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Share an assessment" tone="brand" />

      <div className="space-y-3 px-3 pt-3">
        {gateError && <ConsentGate error={gateError} title="Sharing needs its own permission" />}

        <Card className="px-4 py-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Nambikai will produce an explainable assessment of your financial
            behaviour and show you exactly what it contains before anything is
            shared. <span className="font-semibold text-ink">You pick the partner.</span> No
            lender can request this about you.
          </p>
        </Card>

        <Card>
          <CardHeader title="Choose a lending partner" />
          {partners.loading && (
            <div className="flex justify-center py-8">
              <Spinner size={22} className="text-navy" />
            </div>
          )}
          <div className="divide-y divide-line">
            {(partners.data?.partners ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sky-50"
              >
                <span
                  className={cx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                    selected === p.id ? 'bg-navy text-white' : 'bg-sky-50 text-navy',
                  )}
                >
                  <Icon name={selected === p.id ? 'check' : 'bank'} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold text-ink">{p.displayName}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">{p.blurb}</span>
                </span>
              </button>
            ))}
          </div>
          {partners.data?.disclaimer && (
            <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-ink-faint">
              {partners.data.disclaimer}
            </p>
          )}
        </Card>

        <Button full size="lg" disabled={!selected} loading={busy} onClick={generate}>
          Generate assessment
        </Button>

        <MockBadge className="pb-3 pt-1">
          Simulated partners — nothing is transmitted anywhere
        </MockBadge>
      </div>
    </>
  );
}
