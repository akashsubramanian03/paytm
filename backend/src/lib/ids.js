import crypto from 'node:crypto';

const HANDLE_SAFE = /[^a-z0-9]/g;

/** Builds a UPI-style virtual payment address, e.g. "sreeram.r4821@paytm". */
export function buildUpiId(firstName, lastName) {
  const base =
    [firstName, lastName]
      .filter(Boolean)
      .join('.')
      .toLowerCase()
      .replace(HANDLE_SAFE, (c) => (c === '.' ? '.' : ''))
      .replace(/\.+/g, '.')
      .replace(/^\.|\.$/g, '')
      .slice(0, 20) || 'user';
  const suffix = crypto.randomInt(1000, 9999);
  return `${base}${suffix}@paytm`;
}

/** Human-readable transaction reference, e.g. "NBK4F2A9C31D8E0". */
export function buildReferenceId() {
  return `NBK${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** Deterministic avatar colour so a user always gets the same chip colour. */
const AVATAR_COLORS = [
  '#012B72', '#00B9F1', '#E8442E', '#1C7C54', '#7A3E9D',
  '#C2410C', '#0F766E', '#B91C1C', '#4338CA', '#A16207',
];
export function pickAvatarColor(seed) {
  const hash = crypto.createHash('sha1').update(String(seed)).digest()[0];
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
