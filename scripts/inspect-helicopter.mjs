import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts/helicopter', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.error(e.message);
});
page.on('console', (e) => {
  if (e.type() === 'error') {
    errors.push(e.text());
    console.error(e.text());
  }
});
try {
  await page.goto('http://127.0.0.1:5173/horizon-05.html?inspect');
  await page.screenshot({ path: 'artifacts/helicopter/startup.png' });
  await page.waitForFunction(() => window.horizonDiagnostics);
  await page.screenshot({ path: 'artifacts/helicopter/desktop.png' });
  for (const view of ['Front', 'Side', 'Tail']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await page.waitForTimeout(1700);
    await page.screenshot({ path: `artifacts/helicopter/${view.toLowerCase()}.png` });
  }
  await page.getByRole('button', { name: 'Side', exact: true }).click();
  await page.waitForTimeout(1700);
  await page.locator('canvas').focus();
  for (let i = 0; i < 26; i++) await page.keyboard.press('ArrowRight');
  await page.screenshot({ path: 'artifacts/helicopter/opposite.png' });
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: 'artifacts/helicopter/above.png' });
  const { rotorBounds: _bounds, ...stats } = await page.evaluate(() => window.horizonDiagnostics());
  assert.equal(stats.blockedApertureSamples, 0, 'The tail rotor must have a clear aperture');
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  console.log(JSON.stringify({ errors, stats }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Reset camera' }).click();
  await page.waitForTimeout(1700);
  await page.screenshot({ path: 'artifacts/helicopter/mobile.png', fullPage: true });
} finally {
  await browser.close();
}
