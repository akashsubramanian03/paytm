const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₹1,23,456.78" from an integer paise value. */
export const formatPaise = (paise) => INR.format((paise ?? 0) / 100);

/** Splits currency so the rupees can be set larger than the paise. */
export function splitAmount(paise) {
  const [whole, fraction] = INR.format((paise ?? 0) / 100).split('.');
  return { whole, fraction };
}

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const FULL = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today, 4:35 pm" / "Yesterday, 9:10 am" / "12 Aug, 7:45 pm". */
export function formatWhen(iso) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  const time = TIME.format(date).toLowerCase();
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${DAY.format(date)}, ${time}`;
}

/** Section headers in the passbook. */
export function formatDayGroup(iso) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'long', ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
  }).format(date);
}

export const formatFull = (iso) => FULL.format(new Date(iso));

/** Groups a flat, newest-first list into [{ label, items }] day buckets. */
export function groupByDay(transactions) {
  const groups = [];
  for (const item of transactions) {
    const label = formatDayGroup(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
