import { test, expect } from '../fixtures';

/**
 * Visual identity: the warm cream / coral theme, Bricolage Grotesque for
 * display type, Plus Jakarta Sans for body text. One theme only — the
 * source design has no dark variant, so there is no toggle to test.
 */
test.describe('visual identity', () => {
  test('uses Plus Jakarta Sans for body text', async ({ authed: page }) => {
    const fontFamily = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).fontFamily);

    expect(fontFamily).toContain('Plus Jakarta Sans');
  });

  test('uses Bricolage Grotesque for headings', async ({ authed: page }) => {
    const fontFamily = await page
      .getByRole('heading', { name: /Welcome back/i })
      .evaluate((element) => getComputedStyle(element).fontFamily);

    expect(fontFamily).toContain('Bricolage Grotesque');
  });

  test('actually loads both self-hosted-via-Google font files', async ({ authed: page }) => {
    // A failed font fetch would silently fall back to the platform default
    // and still satisfy the computed-style checks above.
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        body: document.fonts.check('500 14px "Plus Jakarta Sans"'),
        display: document.fonts.check('700 20px "Bricolage Grotesque"'),
      };
    });

    expect(loaded.body).toBe(true);
    expect(loaded.display).toBe(true);
  });

  test('renders the warm cream ground, not a neutral grey one', async ({ authed: page }) => {
    const background = await page
      .locator('body')
      .evaluate((element) => getComputedStyle(element).backgroundColor);

    // --bg is 233 231 226: warm and off-white. A neutral admin-grey (e.g.
    // 250 250 250) would have r === g === b; this palette does not.
    const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(r).toBe(233);
    expect(g).toBe(231);
    expect(b).toBe(226);
  });

  test('has no theme toggle', async ({ authed: page }) => {
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveCount(0);
  });
});
