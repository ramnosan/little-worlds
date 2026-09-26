import { test, expect } from '@playwright/test';

test('darts fly before impact, pop targets, pause, retain orbit and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/?level=bubbles');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Throw darts', exact: true }).click();
  await expect(page.locator('#bubble-darts')).toHaveAttribute('aria-pressed', 'true');
  const target = (await page.evaluate(() => window.__bubbleDebug())).bubbles[0];
  await page.mouse.click(target.screen.x, target.screen.y);
  const flying = await page.evaluate(() => window.__bubbleDebug());
  expect(flying.dartsThrown).toBe(1);
  expect(flying.darts.length).toBe(1);
  expect(flying.bubbles.some((b) => b.id === target.id)).toBe(true);
  await page.screenshot({ path: 'artifacts/bubbles-dart-flight.png' });
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().dartHits)).toBeGreaterThan(0);
  expect(
    (await page.evaluate(() => window.__bubbleDebug())).bubbles.some((b) => b.id === target.id),
  ).toBe(false);
  await expect(page.locator('#dart-count')).toContainText('1 dart hit');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const paused = await page.evaluate(() => window.__bubbleDebug());
  await page.mouse.click(1100, 650);
  await page.waitForTimeout(120);
  expect((await page.evaluate(() => window.__bubbleDebug())).darts).toEqual(paused.darts);
  expect((await page.evaluate(() => window.__bubbleDebug())).dartsThrown).toBe(1);
  await page.mouse.move(1100, 650);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1250, 690, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  expect((await page.evaluate(() => window.__bubbleDebug())).camera).not.toEqual(paused.camera);
  expect((await page.evaluate(() => window.__bubbleDebug())).dartsThrown).toBe(1);
  await page.getByRole('button', { name: 'Reset' }).click();
  const reset = await page.evaluate(() => window.__bubbleDebug());
  expect(reset.dartMode).toBe(false);
  expect(reset.dartHits).toBe(0);
  expect(reset.darts).toHaveLength(0);
  await expect(page.locator('#bubble-darts')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('touch throws darts, drag cancels throws, and shared dart resources remain bounded', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?level=bubbles');
  await expect(page.locator('#blow')).toBeVisible();
  await page.getByRole('button', { name: 'Throw darts', exact: true }).tap();
  const p = (await page.evaluate(() => window.__bubbleDebug())).bubbles[0].screen;
  await page.touchscreen.tap(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().dartHits)).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/bubbles-darts-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 300, y: 450 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 330, y: 480 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await page.evaluate(() => window.__bubbleDebug())).dartsThrown).toBe(1);
  // Let the burst retire, then compare repeated throw/reset cycles after resources are warm.
  await page.getByRole('button', { name: 'Reset' }).tap();
  await expect(page.locator('#bubble-darts')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(100);
  const baseline = (await page.evaluate(() => window.__bubbleDebug())).memory;
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Throw darts', exact: true }).tap();
    await page.touchscreen.tap(300, 570);
    await page.getByRole('button', { name: 'Reset' }).tap();
    await expect(page.locator('#bubble-darts')).toHaveAttribute('aria-pressed', 'false');
  }
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => window.__bubbleDebug())).memory).toEqual(baseline);
  expect(errors).toEqual([]);
  await context.close();
});
