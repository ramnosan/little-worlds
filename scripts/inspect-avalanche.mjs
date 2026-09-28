import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts/avalanche', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => localStorage.setItem('jelly-studio.language', 'de'));
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:5174/'}?level=avalanche`);
  await page.locator('#level-loading').waitFor({ state: 'detached' });
  await page.screenshot({ path: 'artifacts/avalanche/ready.png', fullPage: true });
  await page.getByRole('button', { name: '2×', exact: true }).click();
  await page.getByRole('button', { name: 'Lawine auslösen' }).click();
  await page.waitForTimeout(8500);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.screenshot({ path: 'artifacts/avalanche/flow.png', fullPage: true });
  console.log(
    JSON.stringify({ errors, stats: await page.evaluate(() => window.__avalancheDebug?.()) }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/avalanche/mobile.png', fullPage: true });
} finally {
  await browser.close();
}
