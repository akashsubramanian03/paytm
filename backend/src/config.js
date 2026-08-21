/**
 * Central configuration.
 * Every secret and tunable is read from backend/.env — nothing is hardcoded here.
 * The process refuses to boot if something required is missing or malformed.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..');

// Resolve .env relative to the backend folder so the server can be started
// from any working directory.
dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (e.g. file:./paytm.db)'),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SIGNUP_BONUS_PAISE: z.coerce.number().int().min(0).default(1_000_000),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  MAX_TRANSFER_PAISE: z.coerce.number().int().positive().default(20_000_000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ---- Nambikai ----------------------------------------------------------
  // Every one of these is optional or defaulted on purpose. scripts/init-env.js
  // never overwrites an existing backend/.env, so a developer who set the file up
  // before Nambikai existed has none of these keys. A required var here would make
  // the whole wallet refuse to boot on their machine.
  ANTHROPIC_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  NAMBIKAI_AI_MODEL: z.string().trim().default('claude-opus-5'),
  NAMBIKAI_AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8000).default(1500),
  NAMBIKAI_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  NAMBIKAI_ENGINE_VERSION: z.string().trim().default('nbk-1.0.0'),
  NAMBIKAI_SCORE_TTL_MINUTES: z.coerce.number().int().min(1).default(360),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(
    `\n[config] Invalid backend configuration.\n` +
      `Copy backend/.env.example to backend/.env and fix the following:\n\n${issues}\n`,
  );
  process.exit(1);
}

const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isTest: env.NODE_ENV === 'test',
  databaseUrl: env.DATABASE_URL,
  server: {
    port: env.PORT,
    host: env.HOST,
  },
  cors: {
    origins: env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    bcryptRounds: env.BCRYPT_ROUNDS,
  },
  wallet: {
    signupBonusPaise: env.SIGNUP_BONUS_PAISE,
    maxTransferPaise: env.MAX_TRANSFER_PAISE,
    minTransferPaise: 100, // Rs 1.00
  },
  nambikai: {
    // The demo is fully functional without an API key: the AI layer falls back to
    // deterministic templates. A key only upgrades the prose, never the numbers.
    aiEnabled: Boolean(env.ANTHROPIC_API_KEY),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    model: env.NAMBIKAI_AI_MODEL,
    maxTokens: env.NAMBIKAI_AI_MAX_TOKENS,
    timeoutMs: env.NAMBIKAI_AI_TIMEOUT_MS,
    engineVersion: env.NAMBIKAI_ENGINE_VERSION,
    scoreTtlMinutes: env.NAMBIKAI_SCORE_TTL_MINUTES,
  },
};

export default config;
