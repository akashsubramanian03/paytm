/**
 * Engine tests: pure, no database, no server, milliseconds.
 *
 * These assert the PROPERTIES that make the score defensible rather than any
 * particular number. A scorecard whose weights were retuned should still pass
 * every one of these; a scorecard that had quietly become non-deterministic,
 * non-monotonic, unexplainable, or unfair to people with missing data should
 * fail immediately.
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreUser } from '../src/nambikai/engine/scorecard.js';
import { applyRules } from '../src/nambikai/engine/rules.js';
import { computeSignals } from '../src/nambikai/engine/signals.js';
import { bandRank, scoreToBand, scoreToGrade, worseOf } from '../src/nambikai/engine/bands.js';
import { REASON_CODES, isKnownCode } from '../src/nambikai/engine/reasonCodes.js';
import {
  CATEGORY_KEYS,
  CATEGORY_WEIGHTS_BPS,
  SME_CATEGORY_WEIGHTS_BPS,
} from '../src/nambikai/constants.js';
import { canonicalJson, hashInputs } from '../src/nambikai/util/hash.js';
import { redistributeWeights } from '../src/nambikai/util/stats.js';

const ENGINE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'nambikai',
  'engine',
);

/** A complete, frozen FeatureVector. Every test builds from this. */
function fixture(overrides = {}) {
  const months = 12;
  return {
    schemaVersion: 'nbk-fv-1',
    subjectType: 'USER',
    windowMonths: months,
    asOf: '2026-08-21T00:00:00.000Z',
    accountTenureMonths: 18,
    ledger: {
      windowMonths: months,
      activeMonths: 12,
      firstActivityAt: '2025-03-01T00:00:00.000Z',
      lastActivityAt: '2026-08-20T00:00:00.000Z',
      daysSinceLastActivity: 1,
      currentBalancePaise: 400_000,
      monthlyInflowPaise: Array(months).fill(1_500_000),
      monthlyOutflowPaise: Array(months).fill(1_300_000),
      monthlyGroupInPaise: Array(months).fill(0),
      monthlyGroupOutPaise: Array(months).fill(200_000),
      monthEndBalancePaise: Array(months).fill(400_000),
      monthsWithIncome: Array(months).fill(1),
      monthsWithBill: Array(months).fill(1),
      monthsWithRecharge: Array(months).fill(1),
      entryCount: 900,
      failedCount: 0,
      lowBalanceCount: 2,
      distinctCounterparties: 9,
      borrowLikeEvents: 4,
      repaidEvents: 4,
      billerVariety: null,
      ...(overrides.ledger ?? {}),
    },
    group: {
      dueCount: 43,
      paidCount: 43,
      onTimeCount: 43,
      lateCount: 0,
      missedCount: 0,
      totalDaysLate: 0,
      avgDaysLate: 0,
      openCount: 1,
      recentDueCount: 6,
      recentMissedCount: 0,
      activeGroupCount: 2,
      everGroupCount: 2,
      monthsInAnyGroup: 15,
      firstContributionDueAt: '2025-05-05T10:00:00.000Z',
      savedPaise: 3_650_000,
      committedPerCyclePaise: 250_000,
      ...(overrides.group ?? {}),
    },
    ...(overrides.top ?? {}),
  };
}

/* ============================================================ determinism == */

describe('engine determinism', () => {
  test('the same vector produces the same score, 100 times running', () => {
    const fv = fixture();
    const first = scoreUser(fv);
    for (let i = 0; i < 100; i += 1) {
      const again = scoreUser(fixture());
      assert.equal(again.score, first.score);
      assert.equal(again.band, first.band);
      assert.equal(again.grade, first.grade);
      assert.deepEqual(
        again.breakdown.map((b) => [b.category, b.rawBps, b.weightBps, b.contributionBps]),
        first.breakdown.map((b) => [b.category, b.rawBps, b.weightBps, b.contributionBps]),
      );
      assert.deepEqual(
        again.reasonCodes.map((c) => c.code),
        first.reasonCodes.map((c) => c.code),
        'reason codes must come out in a stable order',
      );
    }
  });

  test('key order does not change the inputs hash', () => {
    const fv = fixture();
    // Rebuild every object with reversed key order.
    const reorder = (value) => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.keys(value)
            .reverse()
            .map((k) => [k, reorder(value[k])]),
        );
      }
      return value;
    };
    assert.equal(hashInputs(fv), hashInputs(reorder(fv)));
    assert.notEqual(hashInputs(fv), hashInputs({ ...fv, accountTenureMonths: 17 }));
  });

  test('canonical json is stable and array order still matters', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });

  test('ARCHITECTURAL: nothing in engine/ touches the database, the clock or randomness', () => {
    const offenders = [];
    for (const file of fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(ENGINE_DIR, file), 'utf8');
      // Strip comments so prose about Date.now() does not trip the check.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const [pattern, what] of [
        [/from\s+['"].*db\.js['"]/, 'imports db.js'],
        [/@prisma\/client/, 'imports @prisma/client'],
        [/Date\.now\(\)/, 'reads the clock'],
        [/new Date\(\)/, 'reads the clock'],
        [/Math\.random\(\)/, 'uses randomness'],
      ]) {
        if (pattern.test(code)) offenders.push(`${file} ${what}`);
      }
    }
    assert.deepEqual(offenders, [], 'engine/ must stay pure and reproducible');
  });

  test('ARCHITECTURAL: the scorecard cannot see cluster data', () => {
    const src = fs.readFileSync(path.join(ENGINE_DIR, 'scorecard.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !/from\s+['"]\.\/cluster\.js['"]/.test(code),
      'scorecard.js must never import cluster.js — the individual score is not allowed to see the group',
    );
    assert.equal(
      scoreUser(fixture()).computedWithoutClusterData,
      true,
      'the scorecard must assert it saw no cluster data',
    );
  });
});

/* ============================================================== arithmetic = */

describe('scorecard arithmetic', () => {
  test('both weight vectors sum to exactly 10000', () => {
    assert.equal(Object.values(CATEGORY_WEIGHTS_BPS).reduce((a, b) => a + b, 0), 10_000);
    assert.equal(Object.values(SME_CATEGORY_WEIGHTS_BPS).reduce((a, b) => a + b, 0), 10_000);
  });

  test('the score is exactly the sum of its parts', () => {
    for (const fv of [fixture(), fixture({ group: { dueCount: 0 } }), fixture({ ledger: { activeMonths: 2 } })]) {
      const result = scoreUser(fv);
      const summed = result.breakdown.reduce((a, b) => a + b.contributionBps, 0);
      assert.equal(
        result.score,
        Math.max(0, Math.min(100, Math.round(summed / 100))),
        'the published score must be reproducible by hand from the breakdown',
      );
      assert.equal(
        result.breakdown.reduce((a, b) => a + b.weightBps, 0),
        10_000,
        'weights must still sum to 10000 after any redistribution',
      );
    }
  });

  test('every category contribution is within its own weight', () => {
    const result = scoreUser(fixture());
    for (const b of result.breakdown) {
      assert.ok(b.contributionBps >= 0 && b.contributionBps <= b.weightBps, b.category);
      assert.ok(b.rawBps >= 0 && b.rawBps <= 10_000, `${b.category} rawBps out of range`);
    }
  });

  test('MONOTONIC: keeping more contributions never lowers the score', () => {
    let previous = -1;
    for (let onTime = 0; onTime <= 40; onTime += 1) {
      const result = scoreUser(
        fixture({
          group: {
            dueCount: 40,
            paidCount: onTime,
            onTimeCount: onTime,
            lateCount: 0,
            missedCount: 40 - onTime,
            recentDueCount: 6,
            recentMissedCount: 0,
          },
        }),
      );
      assert.ok(
        result.score >= previous,
        `score fell from ${previous} to ${result.score} at ${onTime}/40 on time`,
      );
      previous = result.score;
    }
  });

  test('MONOTONIC: a bigger buffer never lowers the score', () => {
    let previous = -1;
    for (let balance = 0; balance <= 2_000_000; balance += 100_000) {
      const result = scoreUser(fixture({ ledger: { currentBalancePaise: balance } }));
      assert.ok(result.score >= previous, `score fell at balance ${balance}`);
      previous = result.score;
    }
  });
});

/* ================================================================= fairness = */

describe('fairness properties', () => {
  test('a missing category is unmeasured, not scored zero', () => {
    const withGroup = scoreUser(fixture());
    const withoutGroup = scoreUser(fixture({ group: { dueCount: 0, onTimeCount: 0, paidCount: 0, missedCount: 0, activeGroupCount: 0, monthsInAnyGroup: 0, savedPaise: 0 } }));

    const commitments = withoutGroup.breakdown.find((b) => b.category === 'COMMITMENTS');
    assert.equal(commitments.measured, false);
    assert.equal(commitments.weightBps, 0, 'an unmeasured category carries no weight');
    assert.equal(commitments.contributionBps, 0);

    // The weight went somewhere, and the total is still 10000.
    assert.equal(withoutGroup.breakdown.reduce((a, b) => a + b.weightBps, 0), 10_000);
    const income = withoutGroup.breakdown.find((b) => b.category === 'INCOME_STABILITY');
    assert.ok(
      income.weightBps > CATEGORY_WEIGHTS_BPS.INCOME_STABILITY,
      'freed weight must move to categories that have evidence',
    );

    // And the person is told, rather than silently marked down.
    const codes = withoutGroup.reasonCodes.map((c) => c.code);
    assert.ok(codes.includes('NO_GROUP_HISTORY'));
    assert.ok(codes.includes('WEIGHT_REDISTRIBUTED'));

    // The whole point: not having a group must not be worse than having a bad one.
    const badGroup = scoreUser(
      fixture({ group: { dueCount: 40, paidCount: 5, onTimeCount: 5, missedCount: 35, recentMissedCount: 5 } }),
    );
    assert.ok(
      withoutGroup.score > badGroup.score,
      'no history must never score worse than a poor history',
    );
    assert.ok(withGroup.score > withoutGroup.score, 'a good history must still be worth having');
  });

  test('weight redistribution is pro-rata and exact', () => {
    const measured = new Set(CATEGORY_KEYS.filter((k) => k !== 'COMMITMENTS'));
    const { weights, redistributed } = redistributeWeights(
      CATEGORY_KEYS,
      CATEGORY_WEIGHTS_BPS,
      measured,
    );
    assert.deepEqual(redistributed, ['COMMITMENTS']);
    assert.equal(Object.values(weights).reduce((a, b) => a + b, 0), 10_000);
    assert.equal(weights.COMMITMENTS, 0);
  });

  test('an uncertain inference cannot punish on thin evidence', () => {
    // Two loan-shaped transfers, neither returned. Below the evidence floor, so
    // the sub-signal must step aside rather than mark the person down.
    const thin = scoreUser(fixture({ ledger: { borrowLikeEvents: 2, repaidEvents: 0 } }));
    const none = scoreUser(fixture({ ledger: { borrowLikeEvents: 0, repaidEvents: 0 } }));
    assert.equal(
      thin.score,
      none.score,
      'two ambiguous transfers must not be treated as evidence of anything',
    );
    assert.ok(!thin.reasonCodes.some((c) => c.code === 'PEER_REPAYMENT_WEAK'));
  });

  test('savings-circle money is treated as saving, not spending', () => {
    // Identical earnings and everyday spending; one person also pays into a
    // circle. Their score must not fall for it.
    const base = fixture({ group: { savedPaise: 0, dueCount: 0, onTimeCount: 0, paidCount: 0, activeGroupCount: 0, monthsInAnyGroup: 0 } });
    const saver = fixture({
      ledger: { monthlyGroupOutPaise: Array(12).fill(200_000) },
      group: { savedPaise: 2_400_000 },
    });
    assert.ok(
      scoreUser(saver).score > scoreUser(base).score,
      'putting money into a savings circle must never lower a score',
    );
  });

  test('nothing in the vector is a proxy for something a person cannot change', () => {
    // The engine only ever sees the FeatureVector. If that object carries no
    // identity, location or demographic field, the engine cannot discriminate on
    // one — not as policy, but because the data is not there to discriminate with.
    const fv = fixture();

    const keys = [];
    const values = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          keys.push(k);
          walk(v);
        }
        return undefined;
      }
      if (typeof node === 'string') values.push(node);
      return undefined;
    };
    walk(fv);

    // Match on camelCase word parts, so "monthlyGroupInPaise" is not mistaken for
    // a UPI id by naive substring search.
    const words = new Set(
      keys.flatMap((k) => k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)),
    );
    for (const forbidden of [
      'name', 'email', 'phone', 'mobile', 'upi', 'vpa', 'address', 'city',
      'pincode', 'gender', 'age', 'caste', 'religion', 'device', 'ip',
      'counterparty', 'note', 'id',
    ]) {
      assert.ok(!words.has(forbidden), `FeatureVector must not carry a "${forbidden}" field`);
    }

    // Free-text values are the other way identity leaks. Everything here should
    // be a timestamp or a fixed enum-like token.
    for (const value of values) {
      const allowed =
        /^\d{4}-\d{2}-\d{2}T/.test(value) || ['USER', 'BUSINESS', 'nbk-fv-1'].includes(value);
      assert.ok(allowed, `unexpected free-text value in the FeatureVector: "${value}"`);
    }
  });

  test('the consumer never sees a risk word', () => {
    for (let score = 0; score <= 100; score += 1) {
      const grade = scoreToGrade(score);
      assert.ok(['BUILDING', 'FAIR', 'GOOD', 'STRONG'].includes(grade));
      assert.ok(!/risk|high|bad|poor|reject/i.test(grade), `grade "${grade}" reads as a verdict`);
    }
  });
});

/* ==================================================== rules only ever worsen */

describe('rule engine', () => {
  test('a gate can never improve a band', () => {
    // Sweep a wide space of vectors rather than a handful of hand-picked ones.
    for (let i = 0; i < 200; i += 1) {
      const fv = fixture({
        ledger: {
          activeMonths: 1 + (i % 12),
          currentBalancePaise: (i % 20) * 50_000,
          daysSinceLastActivity: i % 90,
          monthlyInflowPaise: Array(12).fill(200_000 * (1 + (i % 8))),
          monthlyOutflowPaise: Array(12).fill(200_000 * (1 + ((i + 3) % 8))),
        },
        group: {
          dueCount: i % 40,
          onTimeCount: Math.max(0, (i % 40) - (i % 7)),
          missedCount: i % 7,
          recentMissedCount: i % 4,
          recentDueCount: 6,
        },
      });
      const scored = scoreUser(fv);
      const ruled = applyRules(scored, fv);
      assert.ok(
        bandRank(ruled.band) >= bandRank(scored.band),
        `gates improved a band at iteration ${i}: ${scored.band} -> ${ruled.band}`,
      );
      if (ruled.downgraded) assert.ok(ruled.gates.some((g) => g.triggered), 'a downgrade must name a gate');
    }
  });

  test('worseOf is a one-way ratchet', () => {
    assert.equal(worseOf('LOW', 'HIGH'), 'HIGH');
    assert.equal(worseOf('HIGH', 'LOW'), 'HIGH');
    assert.equal(worseOf('MEDIUM', 'LOW'), 'MEDIUM');
    assert.equal(worseOf('LOW', 'LOW'), 'LOW');
  });

  test('every triggered gate carries its evidence and is announced', () => {
    const fv = fixture({ ledger: { activeMonths: 2 } });
    const ruled = applyRules(scoreUser(fv), fv);
    const fired = ruled.gates.filter((g) => g.triggered);

    assert.ok(fired.length > 0);
    for (const gate of fired) {
      assert.ok(gate.evidence && Object.keys(gate.evidence).length > 0, `${gate.code} has no evidence`);
      assert.ok(gate.effect, `${gate.code} does not say what it did`);
      assert.ok(
        ruled.reasonCodes.some((c) => c.code === gate.code),
        `${gate.code} fired without telling the person`,
      );
    }
    assert.equal(ruled.eligible, false, 'insufficient history must say so outright');
  });

  test('bands and grades are consistent across the whole range', () => {
    for (let score = 0; score <= 100; score += 1) {
      assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(scoreToBand(score)));
    }
    assert.equal(scoreToBand(70), 'LOW');
    assert.equal(scoreToBand(69), 'MEDIUM');
    assert.equal(scoreToBand(45), 'MEDIUM');
    assert.equal(scoreToBand(44), 'HIGH');
  });
});

/* ============================================================ explainability */

describe('explainability', () => {
  test('every emitted code exists in the catalogue with a label and polarity', () => {
    const seen = new Set();
    const collect = (fv) => {
      const scored = scoreUser(fv);
      const ruled = applyRules(scored, fv);
      for (const c of [...scored.reasonCodes, ...ruled.reasonCodes]) seen.add(c.code);
    };

    collect(fixture());
    collect(fixture({ group: { dueCount: 0, onTimeCount: 0, paidCount: 0, missedCount: 0, activeGroupCount: 0, monthsInAnyGroup: 0, savedPaise: 0 } }));
    collect(fixture({ ledger: { activeMonths: 2, daysSinceLastActivity: 120, currentBalancePaise: 0, failedCount: 4, lowBalanceCount: 400 } }));
    collect(fixture({ group: { dueCount: 40, onTimeCount: 4, missedCount: 30, lateCount: 6, avgDaysLate: 5, recentMissedCount: 4 } }));
    collect(fixture({ ledger: { monthlyInflowPaise: [0, 9_000_000, 0, 200_000, 0, 4_000_000, 0, 0, 100_000, 8_000_000, 0, 300_000], monthsWithIncome: [0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1] } }));

    assert.ok(seen.size >= 15, `expected broad code coverage, saw ${seen.size}`);
    for (const code of seen) {
      assert.ok(isKnownCode(code), `orphan code "${code}" would render as a bare identifier`);
      const meta = REASON_CODES[code];
      assert.ok(meta.label && meta.label.length > 5, `${code} has no readable label`);
      assert.ok(['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(meta.polarity));
      assert.ok(['INDIVIDUAL', 'CLUSTER'].includes(meta.attribution));
    }
  });

  test('every emitted code carries the numbers it came from', () => {
    const scored = scoreUser(fixture());
    for (const code of scored.reasonCodes) {
      assert.ok(
        code.evidence && Object.keys(code.evidence).length > 0,
        `${code.code} is an assertion with no evidence behind it`,
      );
    }
  });

  test('the individual scorecard never emits a cluster-attributed code', () => {
    const scored = scoreUser(fixture());
    for (const c of scored.reasonCodes) {
      assert.equal(c.attribution, 'INDIVIDUAL', `${c.code} is attributed to a cluster`);
      assert.ok(!c.code.startsWith('CLUSTER_'), `${c.code} leaked into the individual score`);
    }
  });

  test('the catalogue never contradicts itself on attribution', () => {
    for (const [code, meta] of Object.entries(REASON_CODES)) {
      if (code.startsWith('CLUSTER_')) {
        assert.equal(meta.attribution, 'CLUSTER', `${code} is named cluster but attributed individual`);
        assert.equal(meta.affectsScore, false, `${code} must never affect an individual score`);
      } else {
        assert.equal(meta.attribution, 'INDIVIDUAL', `${code} is attributed to a cluster`);
      }
    }
  });

  test('signals are computable and bounded', () => {
    const signals = computeSignals(fixture());
    for (const [key, signal] of Object.entries(signals)) {
      assert.ok(signal.valueBps >= 0 && signal.valueBps <= 10_000, `${key} out of range`);
      assert.ok(Number.isInteger(signal.valueBps), `${key} is not an integer`);
      assert.ok(signal.evidence && Object.keys(signal.evidence).length > 0, `${key} has no evidence`);
    }
  });
});
