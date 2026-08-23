import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// The tester drives a running system, so it reads the same root .env the API
// and dashboard use rather than carrying its own configuration.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const port = process.env.API_PORT ?? '4000';

export const apiUrl = process.env.TESTER_API_URL ?? `http://localhost:${port}`;
export const wsUrl = process.env.TESTER_WS_URL ?? `ws://localhost:${port}`;

export const adminCredentials = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@acme.test',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!pass',
};

export const mongoUri = process.env.MONGODB_URI ?? '';
export const databaseName = process.env.MONGODB_DB ?? 'workpulse';
