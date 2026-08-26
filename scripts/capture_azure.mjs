import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const PREVIEW_DIRS = [
  path.resolve('D:/workpulse/preview'),
  path.resolve('D:/personal projects/Essentials/public/workpulse-preview'),
];

for (const dir of PREVIEW_DIRS) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function capture() {
  console.log('Launching Playwright for Azure Pulse theme capture...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
  });
  const page = await context.newPage();

  console.log('1. Logging in with yuejin@gmail.com...');
  await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.fill('input[type="email"], input[name="email"]', 'yuejin@gmail.com');
  await page.fill('input[type="password"], input[name="password"]', 'useruser');
  await page.click('button[type="submit"]');

  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Switch to Azure Pulse theme via localStorage and DOM attribute
  console.log('2. Applying Azure Pulse theme...');
  await page.evaluate(() => {
    localStorage.setItem('workpulse_theme_v1', 'azure-pulse');
    document.documentElement.setAttribute('data-theme', 'azure-pulse');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const targets = [
    { filename: '03_overview_dashboard.png', url: 'http://localhost:5173/dashboard' },
    { filename: 'theme_azure_pulse.png', url: 'http://localhost:5173/dashboard' },
    { filename: '04_live_activity.png', url: 'http://localhost:5173/live' },
    { filename: '06_applications.png', url: 'http://localhost:5173/applications' },
    { filename: '07_attendance.png', url: 'http://localhost:5173/attendance' },
    { filename: '08_devices.png', url: 'http://localhost:5173/devices' },
    { filename: '09_agent_health.png', url: 'http://localhost:5173/agent-health' },
    { filename: '10_policies.png', url: 'http://localhost:5173/policies' },
    { filename: '11_audit_logs.png', url: 'http://localhost:5173/audit' },
    { filename: '12_settings.png', url: 'http://localhost:5173/settings' },
  ];

  for (const target of targets) {
    console.log(`Capturing ${target.filename} from ${target.url}...`);
    await page.goto(target.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    for (const dir of PREVIEW_DIRS) {
      await page.screenshot({ path: path.join(dir, target.filename) });
    }
  }

  console.log('All Azure Pulse screenshots captured successfully!');
  await browser.close();
}

capture().catch((err) => {
  console.error('Error during screenshot capture:', err);
  process.exit(1);
});
