import { test, expect } from '../fixtures';

/**
 * The pages an admin actually uses.
 *
 * These assert that each view renders real data from the API rather than an
 * error or a permanent spinner — the failure mode a typecheck cannot catch
 * and the system tester (which never opens a browser) cannot see.
 */
test.describe('dashboard navigation', () => {
  test('renders every primary page without an error state', async ({ authed: page }) => {
    // The pill capsule holds the four busiest destinations directly; the
    // rest live behind "More" and need it opened first.
    const primary = [
      { link: 'Employees', heading: 'Employees' },
      { link: 'Live Activity', heading: 'Live Activity' },
      { link: 'Devices', heading: 'Devices' },
    ];
    const overflow = [
      { link: 'Attendance', heading: 'Attendance' },
      { link: 'Applications', heading: 'Applications' },
      { link: 'Agent Health', heading: 'Agent Health' },
      { link: 'Policies', heading: 'Policies' },
      { link: 'Audit Logs', heading: 'Audit Logs' },
      { link: 'Settings', heading: 'Settings' },
    ];

    for (const target of primary) {
      await page.getByRole('link', { name: target.link, exact: true }).click();
      await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();
      await expect(page.getByText('Could not load this view')).toHaveCount(0);
    }

    for (const target of overflow) {
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('link', { name: target.link, exact: true }).click();
      await expect(page.getByRole('heading', { name: target.heading })).toBeVisible();

      // "Could not load this view" is the ErrorState component; seeing it on
      // any page means the API call behind that page failed.
      await expect(page.getByText('Could not load this view')).toHaveCount(0);
    }
  });

  test('shows the live connection indicator', async ({ authed: page }) => {
    // The WebSocket authenticates with the same admin token as HTTP; if that
    // wiring breaks, this stays on "Offline".
    await expect(page.getByTitle('Live updates connected')).toBeVisible({ timeout: 15_000 });
  });

  test('live activity presence counts partition the workforce exactly once', async ({ authed: page }) => {
    await page.goto('/live');
    await expect(page.getByRole('heading', { name: 'Live Activity' })).toBeVisible();

    // The filter is a custom dropdown (a native <select>'s open menu is
    // painted by the OS and cannot be restyled), so open it and read the
    // per-state counts off its option buttons — computed from the same
    // presence map the cards render from.
    await page.getByRole('button', { name: 'Filter' }).click();
    const optionsText = await page.getByRole('option').allTextContents();
    // Dismiss via the dropdown's own backdrop — it covers the full viewport
    // while open, so clicking anything underneath it (like the heading)
    // never actually reaches that element.
    await page.locator('div[role="presentation"]').click();

    const parse = (label: string): number | null => {
      const match = optionsText.find((text) => text.startsWith(label));
      const count = match?.match(/\((\d+)\)/)?.[1];
      return count ? Number(count) : null;
    };

    const total = parse('Everyone');
    const active = parse('Active');
    const idle = parse('Idle');
    const locked = parse('Locked');
    const offline = parse('Offline');

    expect(total).not.toBeNull();

    // Nobody may be counted in two states, and nobody may be missed — the
    // failure that would make the board quietly wrong rather than broken.
    expect((active ?? 0) + (idle ?? 0) + (locked ?? 0) + (offline ?? 0)).toBe(total);
  });
});

test.describe('employees', () => {
  test('lists employees and opens a detail page', async ({ authed: page }) => {
    await page.getByRole('link', { name: 'Employees', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();

    const name = await firstRow.locator('td').first().locator('div').first().innerText();
    await firstRow.locator('a').first().click();

    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Activity timeline')).toBeVisible();
  });

  test('filters employees by search', async ({ authed: page }) => {
    await page.goto('/employees');

    await page.getByLabel('Search employees').fill('zzz-no-such-person');
    await expect(page.getByText('No matching employees')).toBeVisible();

    await page.getByLabel('Search employees').fill('');
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('policies', () => {
  test('shows the privacy defaults as off', async ({ authed: page }) => {
    await page.goto('/policies');
    await expect(page.getByRole('heading', { name: 'Policies' })).toBeVisible();

    // Screenshots and website tracking must be off and not switchable in V1.
    const screenshots = page.getByRole('switch', { name: 'Screenshots' });
    await expect(screenshots).toHaveAttribute('aria-checked', 'false');
    await expect(screenshots).toBeDisabled();

    const websites = page.getByRole('switch', { name: 'Website tracking' });
    await expect(websites).toHaveAttribute('aria-checked', 'false');
  });

  test('states the guarantees that no policy can turn on', async ({ authed: page }) => {
    await page.goto('/policies');

    await expect(
      page.getByText(/never records keystrokes, clipboard contents/i),
    ).toBeVisible();
  });

  test('saves a policy change and bumps the config version', async ({ authed: page }) => {
    await page.goto('/policies');

    const versionLine = page.getByText(/Config version \d+/);
    const before = await versionLine.innerText();

    const idleField = page.getByLabel('Idle threshold').or(
      page.locator('input[type="number"]').first(),
    );
    const current = await idleField.inputValue();
    const next = current === '900' ? '600' : '900';

    await idleField.fill(next);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(versionLine).not.toHaveText(before, { timeout: 15_000 });
    await expect(idleField).toHaveValue(next);

    // Put it back so the suite is re-runnable.
    await idleField.fill(current);
    await page.getByRole('button', { name: 'Save changes' }).click();
  });
});

test.describe('audit', () => {
  test('records that an employee record was viewed', async ({ authed: page }) => {
    await page.goto('/employees');
    await page.locator('tbody tr').first().locator('a').first().click();
    await expect(page.getByText('Activity timeline')).toBeVisible();

    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    // Scoped to the table: the same label also exists as a hidden <option>
    // in the filter dropdown, which would match a bare text lookup.
    await expect(
      page.locator('tbody').getByText('Employee record viewed').first(),
    ).toBeVisible();
  });
});
