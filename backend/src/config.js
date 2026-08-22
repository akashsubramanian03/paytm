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
  OPENAI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
  NAMBIKAI_AI_MODEL: z.string().trim().default('gpt-4o'),
  // Optional. Set it to reach an OpenAI-compatible endpoint instead — Azure
  // OpenAI, a gateway, or a local mock. The AI tests use it to exercise the real
  // request and response shape without a real key or a network call.
  NAMBIKAI_AI_BASE_URL: z
    .string()
    .trim()
    .url()
    .optional()
    .transform((v) => (v ? v : undefined)),
  NAMBIKAI_AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8000).default(500),
  NAMBIKAI_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),

  // Spend controls. The model is called on five surfaces, so an uncapped key in
  // a demo that anyone can click through is a real bill. Every one of these
  // degrades to the deterministic template rather than to an error, which is why
  // they can be this blunt without hurting the product.
  NAMBIKAI_AI_DAILY_CALL_BUDGET: z.coerce.number().int().min(0).default(150),
  NAMBIKAI_AI_USER_CALL_BUDGET: z.coerce.number().int().min(0).default(25),
  NAMBIKAI_AI_CACHE_SIZE: z.coerce.number().int().min(0).max(10_000).default(500),
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
    aiEnabled: Boolean(env.OPENAI_API_KEY),
    openaiApiKey: env.OPENAI_API_KEY,
    baseUrl: env.NAMBIKAI_AI_BASE_URL,
    model: env.NAMBIKAI_AI_MODEL,
    maxTokens: env.NAMBIKAI_AI_MAX_TOKENS,
    timeoutMs: env.NAMBIKAI_AI_TIMEOUT_MS,
    dailyCallBudget: env.NAMBIKAI_AI_DAILY_CALL_BUDGET,
    userCallBudget: env.NAMBIKAI_AI_USER_CALL_BUDGET,
    cacheSize: env.NAMBIKAI_AI_CACHE_SIZE,
    engineVersion: env.NAMBIKAI_ENGINE_VERSION,
    scoreTtlMinutes: env.NAMBIKAI_SCORE_TTL_MINUTES,
  },
};

export default config;
