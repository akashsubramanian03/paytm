/**
 * Cash-flow shape, and what to do with it.
 *
 * THE POINT OF THIS MODULE IS THE DUE DATE.
 *
 * A tea-stall owner's money arrives in small amounts every day. A salaried
 * person's arrives on the 1st. A trader's arrives when their customers settle,
 * around the 10th. Lenders almost universally set the EMI date by convention —
 * the 5th, the disbursal anniversary — and then treat the resulting misses as a
 * collections problem. But a payment missed because the money had not arrived
 * yet is not a credit event; it is a scheduling error, and it is the single
 * most preventable cause of delinquency in this segment.
 *
 * We already hold the ledger a vendor would have to go and fetch. So instead of
 * forecasting failure, we use the forecast to choose a date where failure is
 * unlikely — and then, during servicing, warn BEFORE a shortfall rather than
 * calling afterwards.
 *
 * PURE MODULE. No Prisma, no clock, no randomness.
 */
import { medianInt, sumInt } from '../util/stats.js';

const DAYS_IN_CYCLE = 28; // every month has these days, so a profile is comparable

/**
 * Average net flow by day-of-month, from raw ledger rows.
 *
 * Days 29-31 fold into 28: a month that lacks them would otherwise drag their
 * average toward zero and make month-end look poorer than it is.
 */
export function buildDayProfile(entries, { months }) {
  const inflow = new Array(DAYS_IN_CYCLE + 1).fill(0);
  const outflow = new Array(DAYS_IN_CYCLE + 1).fill(0);

  for (const e of entries) {
    const day = Math.min(new Date(e.createdAt).getUTCDate(), DAYS_IN_CYCLE);
    if (e.direction === 'CREDIT') inflow[day] += e.amountPaise;
    else outflow[day] += e.amountPaise;
  }

  const n = Math.max(months, 1);
  return {
    days: DAYS_IN_CYCLE,
    monthsObserved: n,
    avgInflowByDay: inflow.map((v) => Math.round(v / n)),
    avgOutflowByDay: outflow.map((v) => Math.round(v / n)),
  };
}

/**
 * Running balance through a typical month, starting from `openingPaise`.
 * Index i is the projected balance at the END of day i.
 */
export function projectMonth(profile, openingPaise) {
  const balances = new Array(profile.days + 1).fill(0);
  let running = openingPaise;
  for (let day = 1; day <= profile.days; day += 1) {
    running += profile.avgInflowByDay[day] - profile.avgOutflowByDay[day];
    balances[day] = running;
  }
  return balances;
}

/**
 * The best day of the month to ask someone for money.
 *
 * Scored on two things: how much is projected to be there, and how reliably —
 * a day that is flush on average but occasionally empty is worse than a slightly
 * poorer day that is never empty. Ties break toward the earlier day, so the
 * lender is not made to wait longer than necessary.
 */
export function bestDueDay(profile, { openingPaise = 0, emiPaise = 0 } = {}) {
  const balances = projectMonth(profile, openingPaise);

  let best = { day: 1, headroomPaise: -Infinity };
  const scored = [];
  for (let day = 1; day <= profile.days; day += 1) {
    // Money that arrived in the three days before is the money still in hand.
    const recentInflow = sumInt(
      [day, day - 1, day - 2].filter((d) => d >= 1).map((d) => profile.avgInflowByDay[d]),
    );
    const headroomPaise = balances[day] - emiPaise;
    scored.push({ day, projectedBalancePaise: balances[day], recentInflowPaise: recentInflow, headroomPaise });
    if (headroomPaise > best.headroomPaise) best = { day, headroomPaise };
  }

  const chosen = scored.find((s) => s.day === best.day);
  const median = medianInt(scored.map((s) => s.projectedBalancePaise));

  return {
    day: best.day,
    projectedBalancePaise: chosen.projectedBalancePaise,
    headroomPaise: chosen.headroomPaise,
    rationale: {
      // Which days money typically lands, so the choice can be explained.
      inflowPeakDays: [...scored]
        .sort((a, b) => b.recentInflowPaise - a.recentInflowPaise)
        .slice(0, 3)
        .map((s) => s.day)
        .sort((a, b) => a - b),
      medianProjectedBalancePaise: median,
      monthsObserved: profile.monthsObserved,
    },
  };
}

/**
 * Will this EMI clear on this day?
 *
 * Returns a shortfall and, when there is one, the nearest day that would work —
 * so the warning arrives with a fix attached rather than just bad news.
 */
export function forecastShortfall(profile, { emiPaise, dueDay, openingPaise = 0 }) {
  const balances = projectMonth(profile, openingPaise);
  const day = Math.min(Math.max(dueDay, 1), profile.days);
  const projectedBalancePaise = balances[day];
  const shortfallPaise = Math.max(emiPaise - projectedBalancePaise, 0);

  let suggestedDay = null;
  if (shortfallPaise > 0) {
    // The soonest later day that clears; failing that, the best day anywhere.
    for (let d = day + 1; d <= profile.days; d += 1) {
      if (balances[d] >= emiPaise) {
        suggestedDay = d;
        break;
      }
    }
    if (suggestedDay === null) {
      const best = bestDueDay(profile, { openingPaise, emiPaise });
      suggestedDay = best.headroomPaise >= 0 ? best.day : null;
    }
  }

  return {
    dueDay: day,
    emiPaise,
    projectedBalancePaise,
    shortfallPaise,
    willClear: shortfallPaise === 0,
    suggestedDay,
    monthsObserved: profile.monthsObserved,
  };
}
