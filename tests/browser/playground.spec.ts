import { test, expect, chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('desktop controls, full playground, reset and visual review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(2500);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/desktop.png' });
  await expect(page.locator('#body-count')).toHaveText('3 jellies');
  await page.getByRole('button', { name: 'Lavender', exact: true }).click();
  await expect(page.locator('#color-name')).toHaveText('Lavender');
  await page.getByRole('button', { name: 'Large', exact: true }).click();
  await page.locator('#softness').fill('100');
  await page.locator('#gravity').fill('200');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Add a jelly' }).click();
  await expect(page.locator('#body-count')).toHaveText('8 jellies · full');
  await expect(page.getByRole('button', { name: 'Add a jelly' })).toBeDisabled();
  await page.waitForTimeout(7000);
  console.log('Eight-blob browser performance:', await page.locator('#performance').textContent());
  const stress = await page.evaluate(() => window.__jellyDebug());
  expect(stress.bodies).toHaveLength(8);
  for (const body of stress.bodies) {
    expect(body.finite).toBe(true);
    expect(body.volumeRatio).toBeGreaterThan(0.85);
    expect(body.volumeRatio).toBeLessThan(1.15);
    expect(body.minY).toBeGreaterThanOrEqual(0.034);
  }
  await page.screenshot({ path: 'artifacts/eight-jellies.png' });
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.locator('#live-label')).toHaveText('Taking a breather');
  await page.getByRole('button', { name: 'Delete selected jelly' }).click();
  await expect(page.locator('#body-count')).toHaveText('7 jellies');
  await page.getByRole('switch', { name: 'Lighter graphics' }).click();
  await expect(page.getByRole('switch', { name: 'Lighter graphics' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('button', { name: 'Turn sound on' }).click();
  await expect(page.getByRole('button', { name: 'Turn sound off' })).toBeVisible();
  for (let i = 0; i < 3; i++)
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#body-count')).toHaveText('3 jellies');
  await expect(page.locator('#softness')).toHaveValue('50');
  await expect(page.locator('#gravity')).toHaveValue('100');
  await expect(page.getByRole('switch', { name: 'Lighter graphics' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('grab, throw, cancellation, camera controls, keyboard and resource stability', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => window.__jellyDebug());
  const { x, y } = before.bodies[0].screen;
  await page.mouse.move(x, y - 12);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).not.toBeNull();
  await page.mouse.move(x + 30, y - 160, { steps: 15 });
  await page.screenshot({ path: 'artifacts/stretch.png' });
  const stretched = await page.evaluate(() => window.__jellyDebug());
  expect(stretched.camera).toEqual(before.camera);
  expect(stretched.bodies[0].center[1]).toBeGreaterThan(before.bodies[0].center[1] + 0.3);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).toBeNull();
  await page.keyboard.press('Delete');
  await expect(page.locator('#body-count')).toHaveText('2 jellies');
  await page.keyboard.press('n');
  await expect(page.locator('#body-count')).toHaveText('3 jellies');
  await page.keyboard.press('Space');
  await expect(page.locator('#live-label')).toHaveText('Taking a breather');
  const paused = await page.evaluate(() => window.__jellyDebug().bodies.map((b) => b.center));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__jellyDebug().bodies.map((b) => b.center))).toEqual(
    paused,
  );
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas!.x + 30, canvas!.y + 80);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(canvas!.x + 180, canvas!.y + 100, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  expect((await page.evaluate(() => window.__jellyDebug())).camera).not.toEqual(before.camera);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForTimeout(300);
  const cancelPoint = (await page.evaluate(() => window.__jellyDebug())).bodies[0].screen;
  await page.mouse.move(cancelPoint.x, cancelPoint.y);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).not.toBeNull();
  await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).toBeNull();
  await page.mouse.up();
  await page.mouse.move(cancelPoint.x, cancelPoint.y);
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).not.toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).toBeNull();
  await page.mouse.up();
  const memory = (await page.evaluate(() => window.__jellyDebug())).memory;
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Add a jelly' }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
  }
  await page.waitForTimeout(300);
  expect((await page.evaluate(() => window.__jellyDebug())).memory).toEqual(memory);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: 'artifacts/compact-desktop.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
});

test('narrow layout and touch settings', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForTimeout(1500);
  await expect(page.locator('#settings')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'artifacts/mobile.png' });
  await page.getByRole('button', { name: 'Make it yours', exact: true }).tap();
  await expect(page.locator('#settings')).toBeVisible();
  await page.getByRole('button', { name: 'Peach', exact: true }).tap();
  await page.getByRole('button', { name: 'Add a jelly' }).tap();
  await expect(page.locator('#body-count')).toHaveText('4 jellies');
  await page.screenshot({ path: 'artifacts/mobile-settings.png' });
  await page.getByRole('button', { name: 'Close settings' }).tap();
  await expect(page.locator('#settings')).not.toBeVisible();
  const touchPoint = (await page.evaluate(() => window.__jellyDebug())).bodies[0].screen;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: touchPoint.x, y: touchPoint.y }],
  });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).not.toBeNull();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: touchPoint.x, y: touchPoint.y - 65 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.__jellyDebug().grabbed)).toBeNull();
  await context.close();
});

test('readable WebGL fallback when graphics are unavailable', async () => {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-webgl'] });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:5173/');
    await expect(page.getByRole('alert')).toContainText('Little Worlds needs WebGL 2');
    await expect(page.getByRole('button', { name: 'Add a jelly' })).toBeDisabled();
  } finally {
    await browser.close();
  }
});
