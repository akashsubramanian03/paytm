import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BrandBar } from '../../components/AppLayout.jsx';
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
import ConsentGate from '../../components/nambikai/ConsentGate.jsx';
import ScoreRing from '../../components/nambikai/ScoreRing.jsx';
import CategoryBars from '../../components/nambikai/CategoryBars.jsx';
import ReasonCodeList from '../../components/nambikai/ReasonCodeList.jsx';
import ScoreSparkline from '../../components/nambikai/ScoreSparkline.jsx';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useToast } from '../../context/ToastContext.jsx';

const GRADE_MESSAGE = {
  BUILDING: 'You are building a financial record. There is not much history here yet.',
  FAIR: 'You have a real record. A few habits would strengthen it noticeably.',
  GOOD: 'You have a solid record of managing money and keeping commitments.',
  STRONG: 'You have a strong, consistent record across everything Nambikai can see.',
};

export default function NambikaiHome() {
  const toast = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const score = useAsync(() => api.nambikai.score(), []);
  const history = useAsync(() => api.nambikai.scoreHistory(12), []);

  const blocked = score.error?.code === 'CONSENT_REQUIRED';
  const s = score.data?.score;

  async function recompute() {
    setRefreshing(true);
    try {
      await api.nambikai.recomputeScore();
      await Promise.all([score.reload(), history.reload()]);
      toast.success('Score updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Gates are the one place the engine caps a result outright. Showing them is
  // the difference between "your score is 50" and "your score is 50, and here is
  // the specific thing that held it there".
  const firedGates = (s?.gates?.gates ?? []).filter((g) => g.triggered);

  return (
    <>
      <BrandBar />

      <div className="space-y-3 px-3 pt-3">
        {score.loading && (
          <div className="flex justify-center py-20">
            <Spinner size={26} className="text-navy" />
          </div>
        )}

        {blocked && <ConsentGate error={score.error} title="Nambikai hasn’t read anything yet" />}

        {score.error && !blocked && (
          <Card>
            <EmptyState icon="alert" title="Couldn’t load your score" description={score.error.message} />
          </Card>
        )}

        {s && (
          <>
            {/* ---- the score ------------------------------------------- */}
            <section className="overflow-hidden rounded-card bg-brand-card px-5 pb-5 pt-6 shadow-lift">
              <div className="flex flex-col items-center">
                <p className="text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
                  Nambikai score
                </p>
                <ScoreRing value={s.value} grade={s.grade} className="mt-3" />
                <p className="mt-3 text-[15px] font-bold text-white">
                  {s.grade.charAt(0) + s.grade.slice(1).toLowerCase()}
                </p>
                <p className="mt-1 max-w-[34ch] text-center text-[12.5px] leading-relaxed text-sky-200">
                  {GRADE_MESSAGE[s.grade]}
                </p>
              </div>
            </section>

            {/* ---- gates, stated outright ------------------------------ */}
            {firedGates.length > 0 && (
              <Card className="border border-warn/30">
                <CardHeader title="What’s holding this back" />
                <div className="divide-y divide-line">
                  {firedGates.map((gate) => {
                    const reason = s.reasonCodes.find((r) => r.code === gate.code);
                    return (
                      <div key={gate.code} className="flex items-start gap-3 px-4 py-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warn/10 text-warn">
                          <Icon name="alert" size={16} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-ink">
                            {reason?.label ?? gate.code}
                          </p>
                          {reason?.guidance && (
                            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
                              {reason.guidance}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {s.gates?.eligible === false && (
                  <p className="border-t border-line px-4 py-3 text-[12.5px] leading-relaxed text-ink-muted">
                    Nambikai would rather say <span className="font-semibold text-ink">“not yet”</span> than
                    guess. Keep using Paytm and this will open up.
                  </p>
                )}
              </Card>
            )}

            {/* ---- what helped and what held back --------------------- */}
            <Card>
              <CardHeader title="What’s helping" />
              <ReasonCodeList
                reasonCodes={s.reasonCodes}
                filter={(r) => r.polarity === 'POSITIVE'}
              />
            </Card>

            <Card>
              <CardHeader title="What’s holding you back" />
              <ReasonCodeList
                reasonCodes={s.reasonCodes}
                filter={(r) => r.polarity === 'NEGATIVE'}
              />
            </Card>

            {/* ---- the arithmetic, in the open ------------------------ */}
            <Card>
              <CardHeader title="How the score is made up" />
              <CategoryBars breakdown={s.breakdown} />
              <p className="border-t border-line px-4 py-3 text-[11.5px] leading-relaxed text-ink-faint">
                Each category is scored out of 100 and then weighted. Nothing here
                is a judgement about who you are — every input is something you did.
              </p>
            </Card>

            {/* ---- context codes -------------------------------------- */}
            <Card>
              <CardHeader title="Worth knowing" />
              <ReasonCodeList
                reasonCodes={s.reasonCodes}
                filter={(r) => r.polarity === 'NEUTRAL'}
              />
            </Card>

            {history.data?.points?.length > 1 && (
              <Card className="px-4 py-4">
                <p className="section-title">Over time</p>
                <div className="mt-3">
                  <ScoreSparkline points={history.data.points} />
                </div>
              </Card>
            )}

            <Card className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink-muted">
                    Computed {new Date(s.computedAt).toLocaleString('en-IN')}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                    engine {s.engineVersion} · inputs {s.inputsHash.slice(0, 12)}…
                  </p>
                </div>
                <Button size="sm" variant="outline" loading={refreshing} onClick={recompute}>
                  <Icon name="refresh" size={15} />
                  Refresh
                </Button>
              </div>
            </Card>
          </>
        )}

        <Card>
          <Link to="/nambikai/groups" className="block">
            <ListRow
              icon={
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                  <Icon name="users" size={19} />
                </span>
              }
              title="Savings groups"
              subtitle="Every contribution you keep becomes evidence"
              onClick={() => {}}
            />
          </Link>
          <div className="hairline" />
          <Link to="/nambikai/consent" className="block">
            <ListRow
              icon={
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-navy">
                  <Icon name="shield" size={19} />
                </span>
              }
              title="Data & consent"
              subtitle="See and change what Nambikai may read"
              onClick={() => {}}
            />
          </Link>
        </Card>

        <MockBadge className="pb-3 pt-1">
          Simulated data — Nambikai does not lend and makes no credit decision
        </MockBadge>
      </div>
    </>
  );
}
