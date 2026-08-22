/**
 * Mock identity verification.
 *
 * THIS PROVES NOTHING ABOUT WHO ANYONE IS. It checks that a PAN or Aadhaar
 * number is well-formed — the right shape, the right checksum — and stores the
 * masked result. No registry is contacted. `method` is recorded as
 * SIMULATED_FORMAT_CHECK on every row so nobody reading this table later can
 * mistake it for real KYC, and the UI says so on the screen.
 *
 * It exists because disbursement should be gated on something, and a gate that
 * is honest about being a placeholder is better than no gate or a fake one.
 */
import prisma from '../../lib/db.js';
import { ApiError } from '../../lib/errors.js';
import { KYC_ID_TYPE, KYC_STATUS } from '../constants.js';

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR = /^[0-9]{12}$/;

/** Verhoeff checksum — the real algorithm Aadhaar uses. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits) {
  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i += 1) c = D[c][P[i % 8][reversed[i]]];
  return c === 0;
}

/** Mask everything but the tail. The full number is never stored. */
export function maskId(idType, value) {
  return idType === KYC_ID_TYPE.PAN
    ? `${value.slice(0, 3)}${'X'.repeat(5)}${value.slice(-1)}`
    : `${'X'.repeat(8)}${value.slice(-4)}`;
}

export function checkFormat(idType, rawValue) {
  const value = String(rawValue ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (idType === KYC_ID_TYPE.PAN) {
    if (!PAN.test(value)) return { ok: false, reason: 'PAN must be 5 letters, 4 digits, then a letter.' };
    return { ok: true, value };
  }
  if (!AADHAAR.test(value)) return { ok: false, reason: 'Aadhaar must be 12 digits.' };
  if (!verhoeffValid(value)) return { ok: false, reason: 'That Aadhaar number fails its checksum.' };
  return { ok: true, value };
}

export async function submitKyc({ userId, idType, value }) {
  if (!Object.values(KYC_ID_TYPE).includes(idType)) {
    throw ApiError.badRequest('UNKNOWN_ID_TYPE', 'Choose PAN or Aadhaar.');
  }

  const check = checkFormat(idType, value);
  const record = await prisma.kycRecord.create({
    data: {
      userId,
      idType,
      maskedId: check.ok ? maskId(idType, check.value) : 'XXXXXXXX',
      status: check.ok ? KYC_STATUS.VERIFIED : KYC_STATUS.FAILED,
      failureReason: check.ok ? null : check.reason,
      verifiedAt: check.ok ? new Date() : null,
    },
  });

  return {
    record,
    ok: check.ok,
    // Stated on the way out, not just in the database.
    disclaimer:
      'This is a simulated format check. No identity registry was contacted and nothing here proves who you are.',
  };
}

export async function kycStatusFor(userId) {
  const verified = await prisma.kycRecord.findFirst({
    where: { userId, status: KYC_STATUS.VERIFIED },
    orderBy: { verifiedAt: 'desc' },
  });
  const latest = await prisma.kycRecord.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return {
    verified: Boolean(verified),
    record: verified ?? latest ?? null,
    disclaimer:
      'Simulated format check only. A real lender would verify against an identity registry.',
  };
}

export async function assertKycVerified(userId) {
  const { verified } = await kycStatusFor(userId);
  if (!verified) {
    throw new ApiError(
      403,
      'KYC_REQUIRED',
      'Identity details are needed before a partner can disburse.',
      { submitPath: '/api/v1/nambikai/lending/kyc' },
    );
  }
  return true;
}
