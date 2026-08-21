import { useLocation } from 'react-router-dom';
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
import RiskBandChip from '../../components/nambikai/RiskBandChip.jsx';
import ClusterCard from '../../components/nambikai/ClusterCard.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Link } from 'react-router-dom';

function SignalList({ signals, tone }) {
  if (!signals?.length) {
    return (
      <p className="px-4 pb-3.5 pt-1 text-[13px] text-ink-muted">
        {tone === 'POSITIVE' ? 'None recorded.' : 'Nothing counted against this applicant.'}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {signals.map((s) => (
        <li key={s.code} className="flex items-start gap-3 px-4 py-2.5">
          <Icon
            name={tone === 'POSITIVE' ? 'check' : 'alert'}
            size={15}
            className={cx('mt-1 shrink-0', tone === 'POSITIVE' ? 'text-credit' : 'text-debit')}
          />
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-ink">{s.label}</p>
            <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">
              {s.code}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Report() {
  const location = useLocation();
  const passed = location.state?.report ?? null;

  // A freshly generated report arrives in router state; otherwise show the most
  // recent one.
  const latest = useAsync(async () => {
    if (passed) return null;
    const list = await api.nambikai.reports({ limit: 1 });
    if (!list.reports.length) return null;
    return api.nambikai.report(list.reports[0].id);
  }, []);

  const r = passed ?? latest.data?.report ?? null;
  const usable = passed ? true : (latest.data?.usable ?? true);

  if (latest.loading) {
    return (
      <>
        <ScreenHeader title="Lender assessment" />
        <div className="flex justify-center py-20">
          <Spinner size={26} className="text-navy" />
        </div>
      </>
    );
  }

  if (!r) {
    return (
      <>
        <ScreenHeader title="Lender assessment" />
        <div className="px-3 pt-3">
          <Card>
            <EmptyState
              icon="document"
              title="No assessment yet"
              description="Generate one to see exactly what a lending partner would be shown about you."
              action={
                <Link to="/nambikai/report/new">
                  <Button>Create one</Button>
                </Link>
              }
            />
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title="Lender assessment"
        subtitle="Exactly what a partner would see"
        tone="brand"
      />

      <div className="space-y-3 px-3 pt-3">
        {!usable && (
          <Card className="border border-warn/30 px-4 py-3.5">
            <p className="text-[13px] leading-relaxed text-ink-muted">
              <span className="font-bold text-warn">Consent withdrawn.</span> This
              assessment is kept as a record of what was shared, but it can no
              longer be used.
            </p>
          </Card>
        )}

        {/* ---- the verdict, in a lender's vocabulary --------------------- */}
        <Card className="px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-2xs font-bold uppercase tracking-[0.11em] text-ink-faint">
                Risk category
              </p>
              <div className="mt-1.5">
                <RiskBandChip band={r.risk_category} />
              </div>
            </div>
            <div className="text-right">
              <p className="tnum text-[30px] font-bold leading-none text-ink">{r.score.value}</p>
              <p className="mt-1 text-[11.5px] text-ink-muted">Nambikai score</p>
            </div>
          </div>
          {r.eligible === false && (
            <p className="mt-3 rounded-tile bg-warn/5 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
              Nambikai does not consider this applicant assessable yet, and says so
              rather than estimating.
            </p>
          )}
          {r.score.band_before_gates !== r.risk_category && (
            <p className="mt-2 text-[12px] text-ink-muted">
              Scored {r.score.band_before_gates}, then held at {r.risk_category} by a rule below.
            </p>
          )}
        </Card>

        {/* ---- the prose ------------------------------------------------- */}
        <Card className="px-4 py-4">
          <p className="text-[14px] leading-relaxed text-ink">{r.recommendation_text}</p>
          <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            <Icon name={r.explainer_source === 'LLM' ? 'sparkle' : 'document'} size={13} />
            {r.explainer_source === 'LLM'
              ? 'Written by Claude from the computed signals'
              : 'Written from the computed signals'}
            {' · the score and risk category were fixed before this was written'}
          </p>
        </Card>

        <Card>
          <CardHeader title="What supports this applicant" />
          <SignalList signals={r.individual_positive_signals} tone="POSITIVE" />
        </Card>

        <Card>
          <CardHeader title="What counts against them" />
          <SignalList signals={r.individual_risk_signals} tone="NEGATIVE" />
        </Card>

        {/* ---- the cluster signal, deliberately far from the score ------- */}
        <ClusterCard signal={r.cluster_signal} omissionReason={r.cluster_omission_reason} />

        {/* ---- relationships -------------------------------------------- */}
        {r.relationships?.length > 0 && (
          <Card>
            <CardHeader title="Verified relationships" />
            <ul className="divide-y divide-line">
              {r.relationships.map((rel, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-navy">
                    <Icon name={rel.type === 'GROUP' ? 'users' : 'store'} size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] text-ink">
                    {rel.relation.replace(/_/g, ' ').toLowerCase()}
                    <span className="text-ink-muted"> · {rel.observations} dealings</span>
                  </span>
                  <span className="tnum shrink-0 text-[13px] font-semibold text-navy">
                    {rel.strength_pct}%
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-ink-faint">
              Participation and verification only. These show that relationships are
              real; they never move a score, and no one is judged by their associates.
            </p>
          </Card>
        )}

        {/* ---- reason codes, with attribution visible ------------------- */}
        <Card>
          <CardHeader title="Reason codes" />
          <ul className="divide-y divide-line">
            {r.reason_codes.map((c) => (
              <li key={c.code} className="flex items-center gap-2 px-4 py-2">
                <span
                  className={cx(
                    'shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide',
                    c.attribution === 'CLUSTER'
                      ? 'bg-navy/10 text-navy'
                      : 'bg-canvas text-ink-muted',
                  )}
                >
                  {c.attribution}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink">
                  {c.code}
                </span>
                {c.affects_score === false && (
                  <span className="shrink-0 text-[10.5px] text-ink-faint">no score effect</span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="px-4 py-3.5">
          <dl className="space-y-1.5 text-[11.5px] text-ink-faint">
            <div className="flex justify-between gap-3">
              <dt>Partner</dt>
              <dd className="font-semibold text-ink-muted">{r.requested_by_partner_id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Consent reference</dt>
              <dd className="truncate font-mono">{r.consent_ref}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Engine / inputs</dt>
              <dd className="truncate font-mono">
                {r.score.engine_version} · {r.score.inputs_hash?.slice(0, 10)}…
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Generated</dt>
              <dd>{new Date(r.generated_at).toLocaleString('en-IN')}</dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-muted">
            {r.partner_disclaimer}
          </p>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated assessment — nothing was transmitted to any lender
        </MockBadge>
      </div>
    </>
  );
}
