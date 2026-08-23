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

  console.log('1. Capturing Welcome page...');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(PREVIEW_DIR, '01_welcome.png') });

  console.log('2. Logging in with yuejin@gmail.com...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(PREVIEW_DIR, '02_login.png') });

  // Fill credentials
  await page.fill('input[type="email"], input[name="email"]', 'yuejin@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'useruser');
  await page.click('button[type="submit"]');

  // Wait for dashboard
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('3. Capturing Dashboard Overview...');
  await page.screenshot({ path: path.join(PREVIEW_DIR, '03_overview_dashboard.png') });

  const routes = [
    { name: '04_live_activity.png', url: 'http://localhost:5173/live' },
    { name: '05_employees.png', url: 'http://localhost:5173/employees' },
    { name: '06_applications.png', url: 'http://localhost:5173/applications' },
    { name: '07_attendance.png', url: 'http://localhost:5173/attendance' },
    { name: '08_devices.png', url: 'http://localhost:5173/devices' },
    { name: '09_agent_health.png', url: 'http://localhost:5173/agent-health' },
    { name: '10_policies.png', url: 'http://localhost:5173/policies' },
    { name: '11_audit_logs.png', url: 'http://localhost:5173/audit' },
    { name: '12_settings.png', url: 'http://localhost:5173/settings' },
  ];

  for (const r of routes) {
    console.log(`Capturing ${r.name}...`);
    await page.goto(r.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(PREVIEW_DIR, r.name) });
  }

  // Also check if we can click into an employee detail
  console.log('Capturing Employee Detail...');
  await page.goto('http://localhost:5173/employees', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const employeeRow = page.locator('tbody tr, [data-testid="employee-row"]').first();
  if (await employeeRow.count() > 0) {
    await employeeRow.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(PREVIEW_DIR, '13_employee_detail.png') });
  }

  // Also capture themes
  console.log('Capturing Theme switch (Obsidian Midnight)...');
  await page.goto('http://localhost:5173/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const darkThemeCard = page.locator('text=Obsidian Midnight').first();
  if (await darkThemeCard.count() > 0) {
    await darkThemeCard.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(PREVIEW_DIR, '14_dark_theme_settings.png') });
    await page.goto('http://localhost:5173/dashboard', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(PREVIEW_DIR, '15_dark_theme_dashboard.png') });
    await page.goto('http://localhost:5173/live', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(PREVIEW_DIR, '16_dark_theme_live.png') });
  }

  console.log('Screenshots capture complete!');
  await browser.close();
}

capture().catch((err) => {
  console.error('Error during screenshot capture:', err);
  process.exit(1);
});
