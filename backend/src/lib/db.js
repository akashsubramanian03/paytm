import { PrismaClient } from '@prisma/client';
import config from '../config.js';

export const prisma = new PrismaClient({
  log: config.isDev ? ['warn', 'error'] : ['error'],
});

export default prisma;

/**
 * SQLite tuning applied once at boot.
 * WAL lets readers run while a write transaction is open, and busy_timeout
 * makes concurrent writers wait their turn instead of failing instantly.
 */
export async function initDatabase() {
  // These PRAGMAs return a row, so they must go through $queryRaw, not $executeRaw.
  const [{ journal_mode: journalMode }] = await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
  return { journalMode };
}
