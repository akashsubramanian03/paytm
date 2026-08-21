import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { Button, Card } from '../primitives.jsx';

/**
 * The wall.
 *
 * Rendered when the API refuses with CONSENT_REQUIRED. It lists the exact
 * permissions the server said were missing — read from `error.details.missing`,
 * never from a hardcoded list — so what the user is asked for can never drift
 * from what the gate actually enforces.
 *
 * This deliberately does not look like an error. Not having granted permission
 * is a perfectly reasonable state to be in, and the honest response is to
 * explain what would be read and let the person decide.
 */
const LABELS = {
  WALLET_LEDGER: 'Your Paytm wallet activity',
  GROUP_CONTRIBUTIONS: 'Your savings group contributions',
  BILL_PAYMENTS: 'Your bill payment history',
  RECHARGE_HISTORY: 'Your mobile recharge history',
  CLUSTER_TRUST_SIGNAL: 'Your savings group’s overall reliability',
  BUSINESS_GST: 'Your business GST filings',
  BUSINESS_INVOICES: 'Your business invoices and receivables',
};

export default function ConsentGate({ error, title = 'Nambikai needs your permission first' }) {
  const missing = error?.details?.missing ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col items-center px-6 pt-7 text-center">
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-navy">
          <Icon name="shield" size={26} />
        </span>
        <p className="text-[16px] font-bold text-ink">{title}</p>
        <p className="mt-1.5 max-w-[36ch] text-[13px] leading-relaxed text-ink-muted">
          Nothing is read until you say so. Nambikai will not calculate anything
          about you from data you have not shared.
        </p>
      </div>

      {missing.length > 0 && (
        <div className="mt-5 px-4">
          <p className="text-2xs font-bold uppercase tracking-[0.09em] text-ink-faint">
            It would need to read
          </p>
          <ul className="mt-2 divide-y divide-line rounded-tile border border-line">
            {missing.map((dataType) => (
              <li key={dataType} className="flex items-center gap-2.5 px-3 py-2.5">
                <Icon name="lock" size={15} className="shrink-0 text-ink-faint" />
                <span className="text-[13.5px] font-semibold text-ink">
                  {LABELS[dataType] ?? dataType}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 pb-4 pt-4">
        <Link to="/nambikai/consent">
          <Button full>Choose what to share</Button>
        </Link>
        <p className="mt-2.5 text-center text-[12px] leading-relaxed text-ink-faint">
          You can withdraw any permission at any time, and see exactly what was
          read and when.
        </p>
      </div>
    </Card>
  );
}
