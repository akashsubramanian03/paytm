import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';
import { Card, CardHeader, cx } from '../primitives.jsx';

/**
 * THE ONLY COMPONENT PERMITTED TO RENDER A CLUSTER VALUE.
 *
 * Everything about it is designed so a group-level number can never be mistaken
 * for a personal one:
 *
 *  - It always renders its own heading saying the signal is shown separately.
 *  - It always renders the disclaimer, even when the number is flattering.
 *  - It always renders the opt-out and dispute links, so leaving is as visible
 *    as the signal itself.
 *  - When there is NO signal it renders the reason rather than disappearing.
 *    "We did not look" and "we looked and found nothing" are different
 *    disclosures, and a component that vanished would collapse them into one.
 *
 * It is deliberately placed away from the score on every screen that uses it.
 */
const BAND_TONE = {
  POSITIVE: 'text-credit',
  NEUTRAL: 'text-ink-muted',
  CAUTION: 'text-debit',
};

const OMISSION_TEXT = {
  NOT_CONSENTED: 'You have not turned on group-level scoring, so nothing about your group was used.',
  SUPPRESSED_APPEAL: 'You have an open dispute about this group signal, so it has been withheld from this report.',
  INSUFFICIENT_EVIDENCE: 'This group does not have enough history for a reliable group-level signal, so none was produced.',
  NO_CLUSTER: 'You are not in a group that qualifies for a group-level signal.',
};

export default function ClusterCard({ signal, omissionReason, showLinks = true }) {
  return (
    <Card className="border border-navy/15">
      <CardHeader title="Group signal — shown separately" />

      {signal ? (
        <div className="px-4 pb-3">
          <div className="flex items-baseline gap-2">
            <span className={cx('tnum text-[28px] font-bold leading-none', BAND_TONE[signal.band])}>
              {signal.reliability_score}%
            </span>
            <span className={cx('text-[13px] font-bold', BAND_TONE[signal.band])}>
              {signal.band.toLowerCase()}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {signal.cluster_name ?? 'Your savings circle'} · {signal.member_count} members ·{' '}
            {signal.observed_cycles} cycles observed
          </p>
          {signal.excluded_subject && (
            <p className="mt-1 text-[12px] text-ink-faint">
              Your own contributions are excluded from this figure, so it describes
              the others in the group rather than you.
            </p>
          )}
        </div>
      ) : (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2">
            <Icon name="slash" size={18} className="text-ink-faint" />
            <span className="text-[14px] font-semibold text-ink-muted">Not included</span>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            {OMISSION_TEXT[omissionReason] ?? OMISSION_TEXT.NOT_CONSENTED}
          </p>
        </div>
      )}

      {/* The disclaimer is unconditional. It is shown when the number is good,
          when it is bad, and when there is no number at all. */}
      <div className="border-t border-line bg-canvas/60 px-4 py-3">
        <p className="text-[12px] leading-relaxed text-ink-muted">
          <span className="font-bold text-ink">This describes a group, not you.</span> It is
          never blended into your own score, and one member’s behaviour never
          changes another member’s assessment.
        </p>
        {showLinks && (
          <div className="mt-2 flex gap-3">
            <Link
              to="/nambikai/cluster"
              className="text-[12.5px] font-bold text-navy hover:underline"
            >
              Manage or turn off
            </Link>
            <Link
              to="/nambikai/cluster"
              className="text-[12.5px] font-bold text-navy hover:underline"
            >
              Dispute this
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
