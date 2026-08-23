import { test as base, expect } from '@playwright/test';
import { admin, signIn } from '../fixtures';

/**
 * Authentication through the real browser.
 *
 * The API suite already proves the endpoints behave; what these add is that
 * the dashboard wires them up correctly — the redirect on an expired session,
 * and the fact that a reload does not throw a signed-in admin back to login.
 */
base.describe('authentication', () => {
  base('redirects an anonymous visitor to the login page', async ({ page }) => {
    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  base('rejects a wrong password without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('Email').fill(admin.email);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/invalid email or password/i);

    // Still on the login page, not partially signed in.
    await expect(page).toHaveURL(/\/login/);
  });

  base('signs in and lands on the overview', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByText('Acme Corporation')).toBeVisible();
  });

  base('keeps the session across a reload', async ({ page }) => {
    await signIn(page);
    await page.reload();

    // The access token lives in memory only, so this exercises the silent
    // refresh from the httpOnly cookie.
    await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  base('signs out and blocks the protected pages again', async ({ page }) => {
    await signIn(page);

    await page.getByRole('button', { name: /Acme Owner|admin/i }).first().click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login/);

    await page.goto('/employees');
    await expect(page).toHaveURL(/\/login/);
  });
});
