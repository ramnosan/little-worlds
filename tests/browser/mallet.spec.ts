import { test, expect } from '@playwright/test';

test('mallet hits jellies and releases on cancellation, pause, and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Pick up mallet', exact: true }).click();
  await expect(page.locator('#mallet')).toHaveAttribute('aria-pressed', 'true');
  const before = await page.evaluate(() => window.__jellyDebug());
  const p = before.bodies[0].screen;
  await page.mouse.move(p.x, p.y);
  const aim = (await page.evaluate(() => window.__jellyDebug())).mallet.position;
  expect((await page.evaluate(() => window.__jellyDebug())).mallet.active).toBe(false);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(true);
  await page.mouse.up();
  await page.waitForTimeout(320);
  const swinging = (await page.evaluate(() => window.__jellyDebug())).mallet;
  expect(swinging.active).toBe(true);
  expect(swinging.position[1]).toBe(aim[1]);
  expect(swinging.position).not.toEqual(aim);
  const after = await page.evaluate(() => window.__jellyDebug());
  expect(after.grabbed).toBeNull();
  expect(after.camera).toEqual(before.camera);
  // Wait for the physical response, rather than assuming a fixed number of
  // rendered simulation steps fit inside the 320 ms animation sample above.
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.__jellyDebug());
      return state.bodies.some(
        (b, i) => Math.hypot(...b.center.map((v, k) => v - before.bodies[i].center[k])) > 0.35,
      );
    })
    .toBe(true);
  await page.screenshot({ path: 'artifacts/mallet.png' });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(false);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(true);
  await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(false);
  await page.mouse.up();
  await page.mouse.down();
  await page.waitForTimeout(900);
  expect((await page.evaluate(() => window.__jellyDebug())).mallet.active).toBe(false);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  expect((await page.evaluate(() => window.__jellyDebug())).mallet.active).toBe(false);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#mallet')).toHaveAttribute('aria-pressed', 'false');
  expect((await page.evaluate(() => window.__jellyDebug())).mallet.visible).toBe(false);
  expect(errors).toEqual([]);
});

test('mallet works with touch in the narrow settings drawer', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Make it yours', exact: true }).tap();
  await page.getByRole('button', { name: 'Pick up mallet', exact: true }).tap();
  await page.getByRole('button', { name: 'Close settings' }).tap();
  const p = (await page.evaluate(() => window.__jellyDebug())).bodies[0].screen;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: p.x, y: p.y }],
  });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: p.x + 60, y: p.y }],
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/mallet-mobile.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().mallet.active)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await context.close();
});
