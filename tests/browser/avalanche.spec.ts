import { test, expect } from '@playwright/test';
import type { AvalancheWorld } from '../../src/avalanche/physics';
declare global {
  interface Window {
    __avalancheDebug: () => ReturnType<AvalancheWorld['snapshot']> & {
      speed: number;
      camera: number[];
      calls: number;
    };
  }
}
test('release, pause, camera, snow controls and reset work without graphics errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?level=avalanche');
  await expect(page.locator('#level-loading')).toHaveCount(0);
  await expect(page.locator('.level-nav a[aria-current]')).toHaveText('10 Avalanche');
  await expect(page.locator('#avalanche-world canvas')).toBeVisible();
  expect((await page.evaluate(() => window.__avalancheDebug())).phase).toBe('ready');
  await page.getByRole('button', { name: 'Release avalanche', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__avalancheDebug().phase)).toBe('flow');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const frozen = await page.evaluate(() => window.__avalancheDebug());
  await page.waitForTimeout(250);
  expect((await page.evaluate(() => window.__avalancheDebug())).elapsed).toBe(frozen.elapsed);
  await page.getByRole('button', { name: '2×', exact: true }).click();
  expect((await page.evaluate(() => window.__avalancheDebug())).speed).toBe(2);
  await page.getByRole('button', { name: 'From above', exact: true }).click();
  expect((await page.evaluate(() => window.__avalancheDebug())).camera).not.toEqual(frozen.camera);
  await page.getByRole('button', { name: 'Wet snow', exact: false }).click();
  const fresh = await page.evaluate(() => window.__avalancheDebug());
  expect(fresh.phase).toBe('ready');
  expect(fresh.kind).toBe('wet');
  expect(fresh.elapsed).toBe(0);
  await page.locator('#avalanche-depth').fill('1.8');
  await expect(page.locator('#avalanche-depth-value')).toHaveText('1.8 m');
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.__avalancheDebug().elapsed))
    .toBeGreaterThan(0.2);
  await page.keyboard.press('Space');
  expect((await page.evaluate(() => window.__avalancheDebug())).paused).toBe(true);
  await page.keyboard.press('r');
  expect((await page.evaluate(() => window.__avalancheDebug())).phase).toBe('ready');
  await page.locator('#avalanche-depth').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#avalanche-depth-value')).toHaveText('1.9 m');
  expect(errors).toEqual([]);
});
test('German mobile layout, navigation and source notes remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('jelly-studio.language', 'de'));
  await page.goto('/?level=avalanche');
  await expect(page.locator('#level-loading')).toHaveCount(0);
  await expect(page).toHaveTitle('Lawine · Little Worlds');
  await expect(page.locator('.level-nav a')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Lawine auslösen' })).toBeVisible();
  const bounds = await page.locator('canvas').boundingBox();
  expect(bounds!.width).toBeGreaterThan(300);
  expect(bounds!.height).toBeGreaterThan(500);
  const panel = await page.locator('.avalanche-panel').boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('Hinter der Simulation', { exact: false }).click();
  await expect(
    page.getByRole('link', { name: 'SLF · Wie Lawinen entstehen', exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/avalanche-mobile.png', fullPage: true });
});
