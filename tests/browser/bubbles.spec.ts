import { test, expect } from '@playwright/test';

test('mouse dragging pulls without popping or orbiting and releases cleanly', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?level=bubbles');
  await expect(page.locator('canvas')).toBeVisible();
  const before = await page.evaluate(() => window.__bubbleDebug());
  const bubble = before.bubbles[0];
  await page.mouse.move(bubble.screen.x, bubble.screen.y);
  await page.mouse.down();
  await page.mouse.move(bubble.screen.x + 100, bubble.screen.y + 30, { steps: 12 });
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().drag?.id)).toBe(bubble.id);
  await page.waitForTimeout(500);
  const during = await page.evaluate(() => window.__bubbleDebug());
  expect(during.bubbles.find((b) => b.id === bubble.id)!.position[0]).toBeGreaterThan(
    bubble.position[0] + 0.5,
  );
  during.camera.forEach((v, k) => expect(v).toBeCloseTo(before.camera[k], 10));
  await page.mouse.up();
  expect(await page.evaluate(() => window.__bubbleDebug().drag)).toBeNull();
  const next = await page.evaluate(() =>
    window.__bubbleDebug().bubbles.find((b) => b.id === window.__bubbleDebug().bubbles[0].id)!,
  );
  await page.mouse.move(next.screen.x, next.screen.y);
  await page.mouse.down();
  await page.mouse.move(next.screen.x - 70, next.screen.y, { steps: 8 });
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().drag !== null)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await page.evaluate(() => window.__bubbleDebug().drag)).toBeNull();
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('drag works after orbit and zoom; pause, Escape and darts cancel it', async ({ page }) => {
  await page.goto('/?level=bubbles');
  await expect(page.locator('canvas')).toBeVisible();
  await page.mouse.move(900, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(940, 460, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(600);
  for (const key of ['Escape', 'p', 'd']) {
    const b = await page.evaluate(() => window.__bubbleDebug().bubbles[0]);
    await page.mouse.move(b.screen.x, b.screen.y);
    await page.mouse.down();
    await page.mouse.move(b.screen.x + 35, b.screen.y + 10, { steps: 6 });
    await expect.poll(() => page.evaluate(() => window.__bubbleDebug().drag !== null)).toBe(true);
    await page.keyboard.press(key);
    expect(await page.evaluate(() => window.__bubbleDebug().drag)).toBeNull();
    await page.mouse.up();
    if (key === 'p') {
      const before = await page.evaluate(() => window.__bubbleDebug().bubbles);
      await page.mouse.move(b.screen.x, b.screen.y);
      await page.mouse.down();
      await page.mouse.move(b.screen.x + 50, b.screen.y);
      await page.mouse.up();
      expect(await page.evaluate(() => window.__bubbleDebug().bubbles)).toEqual(before);
      await page.keyboard.press('p');
    }
  }
});

test('right drag orbits a fixed center, wheel zooms, reset restores and left click pops', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/?level=bubbles');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const before = await page.evaluate(() => window.__bubbleDebug());
  const point = before.bubbles[0].screen;
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x + 210, point.y + 65, { steps: 16 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__bubbleDebug());
  expect(after.camera).not.toEqual(before.camera);
  expect(after.target).toEqual(before.target);
  const distance = (camera: number[], target: number[]) =>
    Math.hypot(...camera.map((v, k) => v - target[k]));
  expect(distance(after.camera, after.target)).toBeCloseTo(
    distance(before.camera, before.target),
    6,
  );
  expect(after.bubbles.map((b) => b.position)).toEqual(before.bubbles.map((b) => b.position));
  await page.screenshot({ path: 'artifacts/bubbles-orbit.png' });
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(250);
  const zoom = await page.evaluate(() => window.__bubbleDebug());
  expect(distance(zoom.camera, zoom.target)).toBeLessThan(distance(after.camera, after.target));
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x + 240, point.y + 90, { steps: 3 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const cancelled = await page.evaluate(() => window.__bubbleDebug().camera);
  await page.mouse.move(point.x + 320, point.y + 130);
  await page.mouse.up({ button: 'right' });
  const stopped = await page.evaluate(() => window.__bubbleDebug().camera);
  // OrbitControls' spherical conversion can round the same position by a few ulps.
  stopped.forEach((value, k) => expect(value).toBeCloseTo(cancelled[k], 12));
  await page.getByRole('button', { name: 'Reset' }).click();
  const restored = await page.evaluate(() => window.__bubbleDebug());
  restored.camera.forEach((value, k) => expect(value).toBeCloseTo(before.camera[k], 6));
  await page.mouse.click(restored.bubbles[0].screen.x, restored.bubbles[0].screen.y);
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().bubbles.length)).toBe(5);
  expect(errors).toEqual([]);
});

test('newly blown bubbles make visible contact patches and stable clusters', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/?level=bubbles');
  await expect(page.locator('#blow')).toBeVisible();
  for (let i = 0; i < 3; i++) {
    const button = await page.locator('#blow').boundingBox();
    await page.mouse.move(button!.x + 100, button!.y + 25);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
  }
  await expect
    .poll(() => page.evaluate(() => window.__bubbleDebug().sharedFilms.length))
    .toBeGreaterThan(0);
  const debug = await page.evaluate(() => window.__bubbleDebug());
  expect(debug.created).toBe(3);
  expect(debug.bubbles.some((b) => b.contacts.length > 0)).toBe(true);
  await page.screenshot({ path: 'artifacts/bubbles-contacts.png' });
  expect(errors).toEqual([]);
});

test('bubble level: film rendering, held inflation, goal, pause and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.goto('/?level=bubbles');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/bubbles-desktop.png' });
  await expect(page.locator('#goal-count')).toHaveText('0 / 12');
  const button = await page.locator('#blow').boundingBox();
  await page.mouse.move(button!.x + button!.width / 2, button!.y + button!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  expect((await page.evaluate(() => window.__bubbleDebug())).holding).toBe(true);
  await page.screenshot({ path: 'artifacts/bubbles-inflating.png' });
  await page.mouse.up();
  await expect(page.locator('#goal-count')).toHaveText('1 / 12');
  const grown = (await page.evaluate(() => window.__bubbleDebug())).bubbles.at(-1)!;
  expect(grown.radius).toBeGreaterThan(0.6);
  await page.locator('#blow').press('Space');
  await expect(page.locator('#goal-count')).toHaveText('2 / 12');
  for (let i = 0; i < 10; i++) await page.locator('#blow').click();
  await expect(page.locator('#goal-message')).toContainText('Goal reached');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const paused = await page.evaluate(() => window.__bubbleDebug());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__bubbleDebug().bubbles)).toEqual(paused.bubbles);
  await expect(page.locator('#blow')).toBeDisabled();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.locator('#goal-count')).toHaveText('0 / 12');
  expect((await page.evaluate(() => window.__bubbleDebug())).bubbles).toHaveLength(6);
  const baseline = (await page.evaluate(() => window.__bubbleDebug())).memory;
  for (let i = 0; i < 4; i++) {
    await page.locator('#blow').click();
    await page.getByRole('button', { name: 'Reset' }).click();
  }
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => window.__bubbleDebug())).memory).toEqual(baseline);
  expect(errors).toEqual([]);
});

test('mobile bubbles, pointer cancellation, wind and navigation', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('/?level=bubbles');
  await expect(page.locator('#blow')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/bubbles-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.locator('#blow').tap();
  await expect(page.locator('#goal-count')).toHaveText('1 / 12');
  await page.locator('#bubble-wind').fill('100');
  await expect(page.locator('#wind-value')).toHaveText('Lively');
  const box = await page.locator('#blow').boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box!.x + 50, y: box!.y + 25 }],
  });
  expect((await page.evaluate(() => window.__bubbleDebug())).holding).toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect((await page.evaluate(() => window.__bubbleDebug())).holding).toBe(false);
  await expect(page.locator('#goal-count')).toHaveText('1 / 12');
  await page.getByRole('link', { name: '01 Jelly' }).click();
  await expect(page.locator('#body-count')).toHaveText('3 jellies');
  await page.getByRole('link', { name: '02 Bubbles' }).click();
  await expect(page.locator('#goal-count')).toHaveText('0 / 12');
  await context.close();
});
