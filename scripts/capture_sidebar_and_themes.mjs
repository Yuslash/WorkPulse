import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const PREVIEW_DIR = path.resolve('d:/workpulse/preview');
if (!fs.existsSync(PREVIEW_DIR)) {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  console.log('Logging in with yuejin@gmail.com...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"], input[name="email"]', 'yuejin@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'useruser');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Capture Sidebar Mode in Warm Cream (Light)
  console.log('Capturing Sidebar Mode (Warm Cream)...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_layout_mode', 'sidebar');
    localStorage.setItem('workpulse_theme_v1', 'warm-cream');
    window.location.reload();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, 'sidebar_layout_light.png') });

  // 2. Capture Sidebar Mode in Obsidian Midnight (Dark)
  console.log('Capturing Sidebar Mode (Obsidian Midnight)...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_theme_v1', 'obsidian-midnight');
    window.location.reload();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, 'sidebar_layout_dark.png') });

  // 3. Capture Nordic Frost Theme
  console.log('Capturing Nordic Frost Theme...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_layout_mode', 'topbar');
    localStorage.setItem('workpulse_theme_v1', 'nordic-frost');
    window.location.reload();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, 'theme_nordic_frost.png') });

  // 4. Capture Emerald Forest Theme
  console.log('Capturing Emerald Forest Theme...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_theme_v1', 'emerald-forest');
    window.location.reload();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, 'theme_emerald_forest.png') });

  // 5. Capture Cyberpunk Sunset Theme
  console.log('Capturing Cyberpunk Sunset Theme...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_theme_v1', 'cyberpunk-sunset');
    window.location.reload();
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, 'theme_cyberpunk_sunset.png') });

  // Reset back to topbar warm-cream
  await page.evaluate(() => {
    localStorage.setItem('workpulse_layout_mode', 'topbar');
    localStorage.setItem('workpulse_theme_v1', 'warm-cream');
  });

  console.log('Sidebar & theme previews captured successfully!');
  await browser.close();
}

capture().catch((err) => {
  console.error('Error during capture:', err);
  process.exit(1);
});
