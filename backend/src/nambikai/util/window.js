/**
 * Time bucketing for the behaviour engine.
 *
 * EVERYTHING HERE IS UTC, DELIBERATELY.
 *
 * The wallet's seed helper (`daysAgo`) builds dates in local time, which is right
 * for a passbook a human reads. It is wrong for scoring. If months were bucketed
 * by local calendar, the same database would split a transaction near midnight
 * into a different month depending on the machine's timezone — so the same user,
 * same data, same engine version would score differently on a laptop in Chennai
 * and one in San Francisco, and the engine determinism tests would pass locally
 * and fail in review. Bucketing in UTC makes the score a property of the data.
 *
 * Pure module: no Prisma, no Date.now(). Callers pass `asOf` explicitly.
 */

/** "2026-08-21" — the UTC day a date falls in. */
export function utcDayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/** "2026-08" — the UTC month a date falls in. */
export function utcMonthKey(date) {
  const d = new Date(date);
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}-${month}`;
}

/** First instant of a UTC month, offset by `delta` months. */
export function utcMonthStart(date, delta = 0) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1, 0, 0, 0, 0));
}

/**
 * The last `months` UTC month keys ending with the month containing `asOf`,
 * oldest first. Fixed length regardless of whether data exists in each month —
 * a month with no activity is a real observation, not a gap to skip.
 */
export function monthKeys(asOf, months) {
  const keys = [];
  for (let i = months - 1; i >= 0; i -= 1) keys.push(utcMonthKey(utcMonthStart(asOf, -i)));
  return keys;
}

/**
 * Bucket rows into the last `months` UTC months.
 * Returns a fixed-length array (oldest first) of { key, rows }, so downstream
 * variance and coverage maths always divides by the same N.
 */
export function monthBuckets(rows, { asOf, months, dateField = 'createdAt' }) {
  const keys = monthKeys(asOf, months);
  const index = new Map(keys.map((key, i) => [key, i]));
  const buckets = keys.map((key) => ({ key, rows: [] }));

  for (const row of rows) {
    const i = index.get(utcMonthKey(row[dateField]));
    if (i !== undefined) buckets[i].rows.push(row);
  }
  return buckets;
}

/** Inclusive-start, exclusive-end window ending at `asOf`. */
export function windowFor(days, asOf) {
  const end = new Date(asOf);
  const start = new Date(end.getTime() - days * 86_400_000);
  return { start, end, days };
}

/** Whole days between two instants, truncated. Never negative. */
export function daysBetween(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms <= 0 ? 0 : Math.trunc(ms / 86_400_000);
}

/** Whole UTC months between two instants, truncated. Never negative. */
export function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months <= 0 ? 0 : months;
}

/**
 * How many complete UTC months of history a subject actually has, capped at
 * `max`. This is the `N` every scorecard formula divides by. Capping matters:
 * without it a five-year-old account and a one-year-old account are scored over
 * different denominators and their numbers stop being comparable.
 */
export function historyMonths({ firstActivityAt, asOf, max }) {
  if (!firstActivityAt) return 0;
  return Math.min(monthsBetween(firstActivityAt, asOf) + 1, max);
}
