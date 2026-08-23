import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The repo root holds the single .env; every workspace reads from it so there
// is exactly one place to change a secret.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().min(1).default('workpulse'),
  MONGODB_TEST_DB: z.string().min(1).default('workpulse_test'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  ADMIN_ACCESS_TTL: z.string().default('15m'),
  ADMIN_REFRESH_TTL: z.string().default('7d'),
  AGENT_ACCESS_TTL: z.string().default('15m'),
  AGENT_REFRESH_TTL: z.string().default('30d'),

  /**
   * Rate limiting is on everywhere except the integration suite, which logs
   * in dozens of times from one address. `rate-limit.test.ts` builds an app
   * with it explicitly re-enabled so the protection itself stays tested.
   */
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  PRESENCE_OFFLINE_AFTER_SEC: z.coerce.number().int().min(15).default(90),
  PRESENCE_SWEEP_INTERVAL_SEC: z.coerce.number().int().min(5).default(15),

  ROLLUP_INTERVAL_SEC: z.coerce.number().int().min(10).default(60),
  RETENTION_INTERVAL_SEC: z.coerce.number().int().min(60).default(3600),

  SEED_ORG_NAME: z.string().default('Acme Corporation'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@acme.test'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('Admin123!pass'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const isTest = raw.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const env = {
  ...raw,
  isTest,
  isProduction: raw.NODE_ENV === 'production',
  /**
   * Tests must never touch the real database. This is the only place the
   * database name is chosen, and `db/client.ts` additionally refuses to run a
   * destructive reset against anything but the test name.
   */
  databaseName: isTest ? raw.MONGODB_TEST_DB : raw.MONGODB_DB,
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitEnabled: isTest ? false : raw.RATE_LIMIT_ENABLED,
} as const;

export type Env = typeof env;
