import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const apiPort = process.env.API_PORT ?? '4000';
const adminPort = '5173';

/**
 * Browser tests against the real dashboard.
 *
 * `verify.mjs` starts the API, so this config only owns the Vite server. The
 * dashboard proxies /api and /ws to the API in dev, which means the browser
 * sees a single origin and the refresh cookie behaves exactly as it does in
 * production behind a reverse proxy.
 */
export default defineConfig({
  testDir: path.join(here, 'specs'),
  outputDir: path.join(here, '.results'),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { outputFolder: path.join(here, '.report'), open: 'never' }]],

  use: {
    baseURL: `http://localhost:${adminPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev:admin',
    cwd: repoRoot,
    url: `http://localhost:${adminPort}`,
    // Reuse a dev server the developer already has running.
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_API_URL: `http://localhost:${apiPort}`,
      VITE_WS_URL: `ws://localhost:${apiPort}`,
    },
  },
});
