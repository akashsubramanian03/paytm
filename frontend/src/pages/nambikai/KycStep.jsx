import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import { Button, Card, Field, MockBadge, cx } from '../../components/primitives.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';

/**
 * Identity, before a partner pays out.
 *
 * This checks the FORMAT of a number and nothing else. The screen says so
 * plainly rather than implying a verification that did not happen — a demo that
 * pretends to have checked an identity registry is worse than one that admits it
 * has not.
 */
export default function KycStep() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { applicationId, offerId } = location.state ?? {};

  const [idType, setIdType] = useState('PAN');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await api.nambikai.submitKyc({ idType, value: value.trim() });
      if (!res.verified) {
        setFailure(res.failureReason ?? 'That does not look right.');
        return;
      }
      toast.success('Details accepted');

      if (applicationId && offerId) {
        const accepted = await api.nambikai.acceptOffer(applicationId, { offerId });
        toast.success('Money is in your wallet', accepted.disbursement.amountFormatted);
        navigate(`/nambikai/loans/${accepted.loan.id}`, { replace: true });
      } else {
        navigate('/nambikai/borrow', { replace: true });
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenHeader title="Identity details" tone="brand" />
      <form onSubmit={submit} className="space-y-3 px-3 pt-3">
        <Card className="px-4 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
              <Icon name="shield" size={20} />
            </span>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              A lending partner needs to know who they are paying. Nambikai stores
              only a masked version — never the full number.
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            {['PAN', 'AADHAAR'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setIdType(t); setValue(''); setFailure(null); }}
                className={cx(
                  'flex-1 rounded-full border px-3 py-2 text-[13px] font-semibold transition-colors',
                  idType === t
                    ? 'border-navy bg-navy text-white'
                    : 'border-line bg-white text-ink hover:border-sky hover:bg-sky-50',
                )}
              >
                {t === 'PAN' ? 'PAN' : 'Aadhaar'}
              </button>
            ))}
          </div>

          <Field
            className="mt-4"
            label={idType === 'PAN' ? 'PAN number' : 'Aadhaar number'}
            name="idValue"
            value={value}
            onChange={(e) => { setValue(e.target.value.toUpperCase()); setFailure(null); }}
            placeholder={idType === 'PAN' ? 'ABCDE1234F' : '234123412346'}
            error={failure}
            autoComplete="off"
            inputMode={idType === 'PAN' ? 'text' : 'numeric'}
          />
        </Card>

        <Button type="submit" full size="lg" loading={busy} disabled={value.trim().length < 6}>
          {applicationId ? 'Verify and receive the money' : 'Verify'}
        </Button>

        {/* The honest caveat, on the screen rather than in a footnote. */}
        <Card className="border border-warn/25 px-4 py-3">
          <p className="text-[12px] leading-relaxed text-ink-muted">
            <span className="font-bold text-warn">This is a simulated check.</span> Nambikai
            verifies the format of the number only. No identity registry is
            contacted and nothing here proves who you are.
          </p>
        </Card>

        <MockBadge className="pb-3 pt-1" />
      </form>
    </>
  );
}
