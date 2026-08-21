/**
 * Zod schemas for the Nambikai routes.
 *
 * Reuses the wallet's existing primitives (lib/validators.js) rather than
 * redefining them, so a rupee amount is parsed to integer paise by exactly the
 * same string-math transform everywhere in the app.
 */
import { z } from 'zod';
import { cuidSchema, rupeeAmountToPaise } from '../lib/validators.js';
import {
  CADENCE,
  CLUSTER_TYPE,
  DATA_TYPE,
  GROUP_PURPOSE,
  PURPOSE,
  SUBJECT_TYPE,
  BUSINESS_SECTOR,
} from './constants.js';
import { partnerIdSchema } from './partners.js';

const enumOf = (obj) => z.enum(Object.values(obj));

export const subjectTypeSchema = enumOf(SUBJECT_TYPE);
export const dataTypeSchema = enumOf(DATA_TYPE);
export const purposeSchema = enumOf(PURPOSE);
export const clusterTypeSchema = enumOf(CLUSTER_TYPE);
export { partnerIdSchema };

export const groupNameSchema = z
  .string()
  .trim()
  .min(3, 'Give the group a name of at least 3 characters.')
  .max(48, 'Keep the group name under 48 characters.');

export const createGroupSchema = z.object({
  name: groupNameSchema,
  purpose: enumOf(GROUP_PURPOSE).default(GROUP_PURPOSE.SAVINGS),
  cadence: enumOf(CADENCE).default(CADENCE.MONTHLY),
  amount: rupeeAmountToPaise,
  plannedCycles: z.coerce.number().int().min(0).max(60).default(0),
  startedAt: z.coerce.date().optional(),
  // The creator is always a member; these are the others.
  memberUserIds: z.array(cuidSchema).max(19, 'A group can hold at most 20 members.').default([]),
  // Rotating groups pay out to one member per cycle, in join order unless the
  // creator supplies an explicit rotation.
  rotation: z.array(cuidSchema).max(20).optional(),
});

export const addMemberSchema = z.object({
  userId: cuidSchema,
  payoutOrder: z.coerce.number().int().min(1).max(60).optional(),
});

export const listContributionsSchema = z.object({
  cycleIndex: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['PENDING', 'PAID', 'LATE', 'MISSED', 'WAIVED']).optional(),
});

export const idParamSchema = z.object({ id: cuidSchema });

export const groupContributionParamsSchema = z.object({
  id: cuidSchema,
  contributionId: cuidSchema,
});

export const grantConsentSchema = z.object({
  dataType: dataTypeSchema,
  purpose: purposeSchema,
  windowDays: z.coerce.number().int().min(30).max(1095).default(365),
  partnerIds: z.array(partnerIdSchema).max(10).default([]),
  clusterId: cuidSchema.optional(),
  expiresInDays: z.coerce.number().int().min(1).max(1095).optional(),
});

export const clusterGroupSchema = z.object({ groupId: cuidSchema });

export const createAppealSchema = z.object({
  groupId: cuidSchema,
  reason: z
    .string()
    .trim()
    .min(10, 'Tell us briefly why you are contesting this, in at least 10 characters.')
    .max(500, 'Keep this under 500 characters.'),
});

export const createReportSchema = z.object({
  applicantType: subjectTypeSchema.default(SUBJECT_TYPE.USER),
  applicantId: cuidSchema.optional(),
  partnerId: partnerIdSchema,
});

export const askSchema = z.object({
  question: z
    .string()
    .trim()
    .min(2, 'Ask a question.')
    .max(400, 'Keep your question under 400 characters.'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().max(2000),
      }),
    )
    .max(12)
    .default([]),
  businessId: cuidSchema.optional(),
});

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(60),
  sector: enumOf(BUSINESS_SECTOR),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN.')
    .optional(),
  city: z.string().trim().min(2).max(40).default('Chennai'),
  employeeCount: z.coerce.number().int().min(0).max(9999).default(0),
  monthlyRevenue: rupeeAmountToPaise,
  monthlyInflow: rupeeAmountToPaise,
  receivables: rupeeAmountToPaise,
  existingDebt: rupeeAmountToPaise,
});

export const updateBusinessSchema = createBusinessSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Send at least one field to update.' },
);

export const scoreQuerySchema = z.object({
  refresh: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(12),
});

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().min(6).max(64).optional(),
});
