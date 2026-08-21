/**
 * All money in this app is an integer number of paise (1 rupee = 100 paise).
 * We never store or compute balances as floats.
 */
import { ApiError } from './errors.js';

const RUPEE_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * Converts a client-supplied rupee amount ("1250.75", 1250.75, 1250) into an
 * exact integer paise value using string math — no floating point rounding.
 */
export function rupeesToPaise(input) {
  if (input === null || input === undefined || input === '') {
    throw ApiError.badRequest('INVALID_AMOUNT', 'Enter an amount.');
  }
  const raw = typeof input === 'number' ? input.toFixed(2) : String(input).trim();
  const normalised = raw.replace(/^\+/, '').replace(/,/g, '');

  if (!RUPEE_PATTERN.test(normalised)) {
    throw ApiError.badRequest(
      'INVALID_AMOUNT',
      'Enter a valid amount in rupees with at most 2 decimal places.',
    );
  }
  const [whole, frac = ''] = normalised.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function paiseToRupees(paise) {
  return Number((paise / 100).toFixed(2));
}

/** "₹1,23,456.78" — Indian digit grouping. */
export function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}
