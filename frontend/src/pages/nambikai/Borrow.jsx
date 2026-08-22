import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ScreenHeader } from '../../components/AppLayout.jsx';
import Icon from '../../components/Icon.jsx';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  MockBadge,
  Spinner,
  cx,
} from '../../components/primitives.jsx';
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import AffordabilityBar from '../../components/nambikai/AffordabilityBar.jsx';
import CostBreakdown from '../../components/nambikai/CostBreakdown.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';

/**
 * "Not eligible" and "already at your safe limit" are different situations and
 * are shown differently. One is a problem to fix; the other is the product
 * protecting someone, and dressing it up as a rejection would be both wrong and
 * discouraging.
 */
const REASON_TONE = {
  AT_CAPACITY: { icon: 'shield', chip: 'bg-sky-100 text-navy', border: 'border-navy/20' },
  IN_ARREARS: { icon: 'alert', chip: 'bg-debit/10 text-debit', border: 'border-debit/25' },
  NOT_YET_ELIGIBLE: { icon: 'clock', chip: 'bg-warn/10 text-warn', border: 'border-warn/25' },
  BELOW_MINIMUM: { icon: 'info', chip: 'bg-canvas text-ink-muted', border: 'border-line' },
};

function DueDayCard({ offer }) {
  const peaks = offer.dueDayRationale?.inflowPeakDays ?? [];
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-credit/10 text-credit">
          <Icon name="clock" size={19} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink">
            Your instalment falls on the {offer.suggestedDueDay}
            {offer.suggestedDueDay === 1 ? 'st' : offer.suggestedDueDay === 2 ? 'nd' : offer.suggestedDueDay === 3 ? 'rd' : 'th'}
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            {peaks.length
              ? `Chosen from your own record: money usually reaches you around the ${peaks.join(', ')}. Asking before that is how payments get missed.`
              : 'Chosen from your own history of when money reaches you.'}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function Borrow() {
  const navigate = useNavigate();
  const toast = useToast();
  const [applying, setApplying] = useState(null);
  const { data, error, loading, reload } = useAsync(() => api.nambikai.lendingOffers(), []);
  const eligibility = useAsync(() => api.nambikai.lendingEligibility(), []);
  const kyc = useAsync(() => api.nambikai.kycStatus(), []);

  const blocked = error?.code === 'CONSENT_REQUIRED' || eligibility.error?.code === 'CONSENT_REQUIRED';
  const offers = data?.offers ?? [];
  const reason = data?.noOfferReason ?? eligibility.data?.noOfferReason;
  const score = eligibility.data?.score;

  async function apply(offer) {
    setApplying(offer.productKey);
    try {
      const res = await api.nambikai.applyForLoan({
        productKey: offer.productKey,
        purpose: offer.productType === 'EMERGENCY' ? 'EMERGENCY' : 'WORKING_CAPITAL',
      });
      if (!res.offer) {
        toast.error('That offer is no longer available');
        await reload();
        return;
      }
      if (!kyc.data?.verified) {
        navigate('/nambikai/borrow/kyc', {
          state: { applicationId: res.application.id, offerId: res.offer.id },
        });
        return;
      }
      const accepted = await api.nambikai.acceptOffer(res.application.id, { offerId: res.offer.id });
      toast.success('Money is in your wallet', accepted.disbursement.amountFormatted);
      navigate(`/nambikai/loans/${accepted.loan.id}`, { replace: true });
    } catch (err) {
      if (err.code === 'KYC_REQUIRED') navigate('/nambikai/borrow/kyc');
      else toast.error(err.message);
    } finally {
      setApplying(null);
    }
  }

  return (
    <>
      <ScreenHeader title="Borrow" subtitle="Priced on how you actually earn" tone="brand" />

      <div className="space-y-3 px-3 pt-3">
        {(loading || eligibility.loading) && (
          <div className="flex justify-center py-16">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {blocked && (
          <ConsentGate
            error={error?.code === 'CONSENT_REQUIRED' ? error : eligibility.error}
            title="Sharing with a lender needs permission"
          />
        )}

        {score && (
          <Card className="px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xs font-bold uppercase tracking-[0.11em] text-ink-faint">
                  Your Nambikai score
                </p>
                <p className="tnum mt-1 text-[24px] font-bold leading-none text-ink">{score.value}</p>
              </div>
              <Link to="/nambikai" className="text-[12.5px] font-bold text-navy hover:underline">
                See why
              </Link>
            </div>
          </Card>
        )}

        {/* ---- no offer: say which kind of "no" this is ------------------ */}
        {!loading && reason && (
          <Card className={cx('border', (REASON_TONE[reason.kind] ?? REASON_TONE.NOT_YET_ELIGIBLE).border)}>
            <div className="flex items-start gap-3 px-4 pb-3 pt-4">
              <span
                className={cx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                  (REASON_TONE[reason.kind] ?? REASON_TONE.NOT_YET_ELIGIBLE).chip,
                )}
              >
                <Icon name={(REASON_TONE[reason.kind] ?? REASON_TONE.NOT_YET_ELIGIBLE).icon} size={19} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-ink">{reason.headline}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{reason.detail}</p>
              </div>
            </div>

            {reason.kind === 'AT_CAPACITY' && (
              <div className="mx-4 mb-3 rounded-tile bg-canvas px-3 py-2.5">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-ink-muted">Committed each month</span>
                  <span className="tnum font-semibold text-ink">
                    ₹{Math.round(reason.committedPaise / 100).toLocaleString('en-IN')} of ₹
                    {Math.round(reason.ceilingPaise / 100).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{
                      width: `${Math.min(100, Math.round((reason.committedPaise * 100) / Math.max(reason.ceilingPaise, 1)))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {(reason.paths?.length > 0 || data?.whatWouldHelp?.scenarios?.length > 0) && (
              <div className="divide-y divide-line border-t border-line">
                {(reason.paths ?? []).map((path) => (
                  <div key={path.key} className="px-4 py-2.5">
                    <p className="text-[13.5px] font-semibold text-ink">{path.label}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{path.detail}</p>
                  </div>
                ))}
                {(data?.whatWouldHelp?.scenarios ?? []).map((sc) => (
                  <div key={sc.key} className="flex items-start gap-2 px-4 py-2.5">
                    <Icon name="trend" size={15} className="mt-0.5 shrink-0 text-credit" />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold text-ink">{sc.label}</p>
                      <p className="mt-0.5 text-[12px] text-ink-muted">
                        Would take your score to about {sc.projectedScore}
                        {sc.unlocksEligibility ? ' — enough to qualify' : ''} · roughly{' '}
                        {sc.horizonMonths} months
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ---- offers ----------------------------------------------------- */}
        {offers.map((offer, i) => (
          <Card key={offer.productKey + offer.tenureMonths}>
            <CardHeader
              title={offer.productName}
              action={<span className="text-[12px] text-ink-muted">{offer.partnerName}</span>}
            />
            <div className="px-4 pb-3">
              <p className="tnum text-[30px] font-bold leading-none text-ink">
                {offer.principal.formatted}
              </p>
              <p className="mt-1.5 text-[13px] text-ink-muted">
                <span className="tnum font-semibold text-ink">{offer.emi.formatted}</span> a month for{' '}
                {offer.tenureMonths} months
              </p>
            </div>

            <div className="px-4 pb-3">
              <AffordabilityBar affordability={offer.affordability} />
            </div>

            <div className="px-4 pb-3">
              <CostBreakdown offer={offer} />
            </div>

            <div className="px-4 pb-4">
              <Button
                full
                size="lg"
                loading={applying === offer.productKey}
                onClick={() => apply(offer)}
              >
                Take {offer.principal.formatted}
              </Button>
              {i === 0 && !kyc.data?.verified && (
                <p className="mt-2 text-center text-[11.5px] text-ink-faint">
                  You will be asked for identity details first.
                </p>
              )}
            </div>
          </Card>
        ))}

        {offers.length > 0 && <DueDayCard offer={offers[0]} />}

        {!loading && !blocked && !reason && offers.length === 0 && (
          <Card>
            <EmptyState icon="bank" title="No offers right now" />
          </Card>
        )}

        <Card>
          <Link to="/nambikai/loans" className="block">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                <Icon name="document" size={19} />
              </span>
              <span className="flex-1 text-[14.5px] font-semibold text-ink">Your loans</span>
              <Icon name="chevronRight" size={18} className="text-ink-faint" />
            </div>
          </Link>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated lending partner — no real credit is extended
        </MockBadge>
      </div>
    </>
  );
}
