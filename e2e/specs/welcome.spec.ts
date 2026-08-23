import { test, expect } from '@playwright/test';

/**
 * The pre-session welcome screen: create a company, sign in to an existing
 * one, or leave. Reached at `/`, before any authentication exists.
 */
test.describe('welcome screen', () => {
  test('shows all three options', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'WorkPulse' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Company' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login to Existing Company' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close App' })).toBeVisible();
  });

  test('"Login to Existing Company" goes to the sign-in form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Login to Existing Company' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('"Create Company" goes to the registration form', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create Company' }).click();

    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  });

  test('"Close App" explains itself when the browser will not let the tab close', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Close App' }).click();

    // A tab the user navigated to directly cannot be closed by script; the
    // page has to say so rather than silently doing nothing.
    await expect(page.getByRole('status')).toBeVisible();
  });

  test('creating a company signs the owner straight into the dashboard', async ({ page }) => {
    await page.goto('/register');

    const stamp = Date.now();
    await page.getByLabel('Company name').fill(`Test Co ${stamp}`);
    await page.getByLabel('Your name').fill('New Owner');
    await page.getByLabel('Your email').fill(`owner-${stamp}@e2e.test`);
    await page.getByLabel('Confirm password').fill('E2ePassword123!');
    await page.getByLabel('Password', { exact: true }).fill('E2ePassword123!');

    await page.getByRole('button', { name: 'Create company' }).click();

    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
    // The org name can also appear in the Latest Activity feed (this very
    // registration gets audited), so scope to the first occurrence — the
    // app-shell header — rather than asserting on bare text anywhere.
    await expect(page.getByText(`Test Co ${stamp}`).first()).toBeVisible();
  });

  test('rejects mismatched passwords before calling the server', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Company name').fill('Mismatch Co');
    await page.getByLabel('Your name').fill('Someone');
    await page.getByLabel('Your email').fill(`mismatch-${Date.now()}@e2e.test`);
    await page.getByLabel('Password', { exact: true }).fill('FirstPassword1!');
    await page.getByLabel('Confirm password').fill('DifferentPassword1!');
    await page.getByRole('button', { name: 'Create company' }).click();

    await expect(page.getByRole('alert')).toContainText(/do not match/i);
    await expect(page).toHaveURL(/\/register/);
  });
});
