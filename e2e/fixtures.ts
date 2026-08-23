import { test as base, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '..', '.env') });

export const admin = {
  email: process.env.SEED_ADMIN_EMAIL ?? 'admin@acme.test',
  password: process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!pass',
};

/** Signs in through the real form; there is no back-door auth in these tests. */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/login');

  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The overview fires several parallel queries the instant it mounts; under
  // load (this fixture runs once per spec) the first paint can lag past the
  // default expect timeout even though nothing is actually broken.
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: 15_000 });
}

/** A page that is already signed in, for specs that are not about auth. */
export const test = base.extend<{ authed: Page }>({
  authed: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

export { expect };
