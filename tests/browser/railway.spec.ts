import { test, expect, type Page } from '@playwright/test';

type Snapshot = {
  distance: number;
  travel: number;
  paused: boolean;
  speed: number;
  light: boolean;
  camera: number[];
  geometries: number;
  textures: number;
  cars: { distance: number; x: number; z: number }[];
};
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __railwayDebug: () => Snapshot }).__railwayDebug());
const setSpeed = async (page: Page, value: string) => {
  await page.locator('#rw-speed').fill(value);
  await expect(page.locator('#rw-speed-value')).toHaveText(`${value}%`);
};

test('railway motion, pause, speed, reset, keyboard and GPU resources', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world canvas')).toBeVisible();
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(0.1);
  const initial = await stats(page);
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const paused = await stats(page);
  await page.waitForTimeout(150);
  expect((await stats(page)).distance).toBe(paused.distance);
  await setSpeed(page, '200');
  expect((await stats(page)).speed).toBe(2);
  expect((await stats(page)).paused).toBe(true);
  await page.getByRole('button', { name: 'Resume simulation' }).click();
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(paused.travel);
  await setSpeed(page, '0');
  const stopped = await stats(page);
  await page.waitForTimeout(150);
  expect((await stats(page)).travel).toBe(stopped.travel);
  await page.locator('#rw-quality').click();
  expect((await stats(page)).light).toBe(true);
  await page.locator('#rw-reset').click();
  expect((await stats(page)).speed).toBe(1);
  expect((await stats(page)).light).toBe(false);
  expect((await stats(page)).paused).toBe(false);
  await page.locator('#railway-world canvas').focus();
  await page.keyboard.press('Space');
  expect((await stats(page)).paused).toBe(true);
  await page.keyboard.press('r');
  expect((await stats(page)).paused).toBe(false);
  await page.locator('#rw-speed').focus();
  await page.keyboard.press('Space');
  expect((await stats(page)).paused).toBe(false);
  await page.keyboard.press('End');
  expect((await stats(page)).speed).toBe(2);
  await page.keyboard.press('r');
  expect((await stats(page)).speed).toBe(2);
  // Warm both shader variants before comparing repeated reset/quality cycles.
  await page.locator('#rw-reset').click();
  await page.waitForTimeout(150);
  const baseline = await stats(page);
  for (let i = 0; i < 5; i++) {
    await page.locator('#rw-quality').click();
    await page.locator('#rw-reset').click();
  }
  await page.waitForTimeout(150);
  const end = await stats(page);
  expect(end.geometries).toBe(baseline.geometries);
  expect(end.textures).toBe(baseline.textures);
  end.camera.forEach((n, i) => expect(n).toBeCloseTo(initial.camera[i], 5));
  expect(errors).toEqual([]);
});

test('orbit and zoom remain available while paused; reset restores camera', async ({ page }) => {
  await page.goto('/?level=railway');
  await page.locator('#rw-pause').click();
  const initial = await stats(page),
    box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  for (const button of ['left', 'right'] as const) {
    const before = (await stats(page)).camera;
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    await page.mouse.move(x + 90, y + 25, { steps: 10 });
    await page.mouse.up({ button });
    await expect.poll(async () => (await stats(page)).camera).not.toEqual(before);
  }
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(200);
  expect(Math.hypot(...(await stats(page)).camera)).toBeLessThan(Math.hypot(...initial.camera));
  expect((await stats(page)).travel).toBe(initial.travel);
  await page.locator('#rw-reset').click();
  (await stats(page)).camera.forEach((n, i) => expect(n).toBeCloseTo(initial.camera[i], 5));
});

test('all five levels link to the railway with one current navigation entry', async ({ page }) => {
  for (const [url, canvas] of [
    ['/', '#world'],
    ['/?level=bubbles', '#bubble-world'],
    ['/?level=aquarium', '#aquarium-world'],
    ['/?level=fire', '#fire-world'],
  ]) {
    await page.goto('/?level=railway');
    await expect(page.locator('.level-nav a')).toHaveCount(5);
    await page.locator(`.level-nav a[href="${url === '/' ? './' : url.slice(1)}"]`).click();
    await expect(page.locator(`${canvas} canvas`)).toBeVisible();
    await page.getByRole('link', { name: '04 Model Railway' }).click();
    await expect(page.locator('#railway-world canvas')).toBeVisible();
    await expect(page.locator('.level-nav [aria-current="page"]')).toHaveText('04 Model Railway');
  }
});

for (const [width, height, label] of [
  [1440, 1000, 'desktop'],
  [1024, 900, 'tablet'],
  [390, 844, 'mobile'],
] as const) {
  test(`railway ${label} layout and screenshot`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/?level=railway');
    await page.locator('#rw-pause').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const canvas = (await page.locator('canvas').boundingBox())!;
    expect(canvas.width).toBeGreaterThan(300);
    expect(canvas.x).toBeGreaterThanOrEqual(0);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(width);
    const nav = (await page.locator('.level-nav').boundingBox())!;
    expect(nav.x).toBeGreaterThanOrEqual(0);
    expect(nav.x + nav.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/railway-${label}.png`, fullPage: true });
  });
}

test('mobile touch orbit, pinch and navigation remain usable', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await page.goto('/?level=railway');
    await page.locator('#rw-pause').tap();
    await page.locator('canvas').scrollIntoViewIfNeeded();
    const original = await stats(page),
      box = (await page.locator('canvas').boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 8, y, id: 1 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await stats(page)).camera).not.toEqual(original.camera);
    const beforePinch = Math.hypot(...(await stats(page)).camera);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 30 - i * 5, y, id: 1 },
          { x: x + 30 + i * 5, y, id: 2 },
        ],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Math.hypot(...(await stats(page)).camera)).toBeLessThan(beforePinch);
    expect((await stats(page)).travel).toBe(original.travel);
    await page.getByRole('link', { name: '03 Aquarium' }).tap();
    await expect(page.locator('#aquarium-world canvas')).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: '04 Model Railway' }).tap();
    await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
  } finally {
    await context.close();
  }
});

test('context loss pauses the railway and presents recovery instructions', async ({ page }) => {
  await page.goto('/?level=railway');
  await expect(page.locator('canvas')).toBeVisible();
  await page
    .locator('canvas')
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    );
  await expect(page.locator('#rw-notice')).toContainText('Reload the page');
  await expect(page.locator('#rw-speed')).toBeDisabled();
  await expect(page.locator('#rw-reset')).toBeDisabled();
  expect((await stats(page)).paused).toBe(true);
});

test('hidden tabs stop motion and return without a catch-up jump', async ({ page }) => {
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(0.1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await stats(page);
  await page.waitForTimeout(400);
  expect((await stats(page)).travel).toBe(hidden.travel);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(hidden.travel);
  expect((await stats(page)).travel - hidden.travel).toBeLessThan(0.3);
});

test('WebGL unavailable shows a useful fallback with working navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world [role="alert"]')).toContainText('WebGL 2');
  await expect(page.locator('#rw-pause')).toBeDisabled();
  await expect(page.getByRole('link', { name: '01 Jelly' })).toBeVisible();
});

test('train and carriages follow a curve without losing their spacing', async ({ page }) => {
  await page.goto('/?level=railway');
  await setSpeed(page, '200');
  await expect
    .poll(async () => (await stats(page)).travel, { timeout: 8000, intervals: [100] })
    .toBeGreaterThan(4.2);
  await page.locator('#rw-pause').click();
  const { cars } = await stats(page);
  for (let i = 1; i < cars.length; i++)
    expect(cars[i - 1].distance - cars[i].distance).toBeCloseTo(1.42, 5);
  await page.screenshot({ path: 'artifacts/railway-curve.png', fullPage: true });
  await page.locator('#rw-reset').click();
  await page.locator('#rw-pause').click();
  const canvas = page.locator('#railway-world canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -190);
  await page.waitForTimeout(200);
  await canvas.screenshot({ path: 'artifacts/railway-detail.png' });
});
