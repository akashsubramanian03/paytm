/**
 * Password hashing and token/session issuing.
 *
 * Auth is token-based but server-backed: the JWT only carries a user id and a
 * session id. Every request re-checks the Session row, so signing out (or
 * revoking a session) invalidates the token immediately.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import prisma from './db.js';
import { ApiError } from './errors.js';

const DURATION_PATTERN = /^(\d+)\s*([smhd])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function durationToMs(spec) {
  const match = DURATION_PATTERN.exec(String(spec).trim());
  if (!match) throw new Error(`Invalid duration "${spec}". Use forms like 30m, 12h, 7d.`);
  return Number(match[1]) * UNIT_MS[match[2].toLowerCase()];
}

export function hashPassword(plain) {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function issueSession(userId, userAgent) {
  const expiresAt = new Date(Date.now() + durationToMs(config.auth.jwtExpiresIn));
  const session = await prisma.session.create({
    data: { userId, expiresAt, userAgent: userAgent?.slice(0, 255) ?? null },
  });
  const token = jwt.sign({ sub: userId, sid: session.id }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
  return { token, expiresAt };
}

export async function revokeSession(sessionId) {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

const EXPIRED = 'Your session has expired. Please sign in again.';

/** Verifies a bearer token and returns the live user + session, or throws 401. */
export async function authenticateToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret);
  } catch {
    throw ApiError.unauthorized(EXPIRED);
  }
  if (!payload?.sub || !payload?.sid) throw ApiError.unauthorized(EXPIRED);

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { account: true } } },
  });

  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw ApiError.unauthorized(EXPIRED);
  }
  return { user: session.user, sessionId: session.id };
}
