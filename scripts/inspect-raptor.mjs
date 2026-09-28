import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts/raptor', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text());
});
try {
  await page.goto('http://127.0.0.1:5173/raptor-22.html?inspect');
  await page.waitForFunction(() => window.raptorDiagnostics);
  await page.screenshot({ path: 'artifacts/raptor/desktop.png' });
  for (const view of ['Front', 'Side', 'Rear', 'Top']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `artifacts/raptor/${view.toLowerCase()}.png` });
  }
  await page.getByRole('button', { name: 'Side', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.locator('canvas').focus();
  for (let i = 0; i < 26; i++) await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: 'artifacts/raptor/opposite.png' });
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
  await page.screenshot({ path: 'artifacts/raptor/underside.png' });
  await page.getByRole('button', { name: 'Reset camera' }).click();
  await page.locator('#flight').click();
  await page.waitForFunction(() => window.raptorDiagnostics().progress === 1);
  await page.screenshot({ path: 'artifacts/raptor/flight.png' });
  for (const finish of ['Arctic demonstrator', 'Dark graphite concept']) {
    await page.getByRole('button', { name: finish, exact: true }).click();
    await page.screenshot({ path: `artifacts/raptor/${finish.split(' ')[0].toLowerCase()}.png` });
  }
  const stats = await page.evaluate(() => window.raptorDiagnostics());
  console.log(JSON.stringify({ errors, stats }));
  await page.locator('#engines').click();
  await page.waitForFunction(() => window.raptorDiagnostics().progress === 0);
  await page.getByRole('button', { name: 'Air-superiority gray', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Reset camera' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'artifacts/raptor/mobile.png', fullPage: true });
  assert.deepEqual(errors, [], 'Unexpected browser errors');
} finally {
  await browser.close();
}
