import { z } from 'zod';
import { rupeesToPaise } from './money.js';

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'This field is required.')
  .max(40, 'Keep this under 40 characters.')
  .regex(/^[\p{L}][\p{L}\s.'-]*$/u, 'Use letters, spaces, apostrophes, hyphens or dots only.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(120, 'Email is too long.')
  .email('Enter a valid email address.');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter.')
  .regex(/\d/, 'Password must contain at least one number.');

export const upiIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.\-_]{3,32}@[a-z]{3,16}$/, 'Enter a valid UPI ID, e.g. name1234@paytm');

/**
 * Accepts a rupee amount from the client ("500", "500.50", 500) and converts it
 * to exact integer paise. The resulting value is what the server uses; the
 * client never supplies paise or balances directly.
 */
export const rupeeAmountToPaise = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    try {
      return rupeesToPaise(value);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err.message });
      return z.NEVER;
    }
  });

export const noteSchema = z
  .string()
  .trim()
  .max(120, 'Note must be under 120 characters.')
  .optional()
  .transform((v) => (v ? v : null));

export const cuidSchema = z.string().trim().min(10).max(64);

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
});
