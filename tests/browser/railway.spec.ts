import { test, expect, type Page } from '@playwright/test';
import {
  nearestTrack,
  LINE_OFFSET,
  TUNNEL_HALF_WIDTH,
  TUNNEL_SPRING,
} from '../../src/railway/physics';

type Snapshot = {
  distance: number;
  travel: number;
  paused: boolean;
  speed: number;
  light: boolean;
  camera: number[];
  cameraMode: 'free' | 'follow';
  cameraTarget: number[];
  elapsed: number;
  geometries: number;
  textures: number;
  clouds: { positions: number[][]; steps: number; reducedMotion: boolean };
  cars: { distance: number; x: number; y: number; z: number; tx: number; tz: number }[];
};
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __railwayDebug: () => Snapshot }).__railwayDebug());
const setSpeed = async (page: Page, value: string) => {
  await page.locator('#rw-speed').fill(value);
  await expect(page.locator('#rw-speed-value')).toHaveText(`${value}%`);
};

test('follow camera switches, freezes, restores the free view and resets', async ({ page }) => {
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
  const follow = page.getByRole('button', { name: 'Follow train', exact: true });
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#rw-pause').click();
  const initial = await stats(page);
  const box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 20, { steps: 8 });
  await page.mouse.up();
  // Capture and switch in one task, including any orbit inertia still in flight.
  const free = await page.evaluate(() => {
    const snapshot = (window as unknown as { __railwayDebug: () => Snapshot }).__railwayDebug();
    document.getElementById('rw-follow')!.click();
    return snapshot;
  });
  expect(free.camera).not.toEqual(initial.camera);
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rw-camera-hint')).toContainText('Following the train');
  await expect(page.locator('canvas')).toHaveAttribute('aria-label', /Camera following/);
  const paused = await stats(page);
  expect(paused.cameraMode).toBe('follow');
  expect(paused.camera).not.toEqual(free.camera);
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const followBox = (await page.locator('canvas').boundingBox())!;
  const followX = followBox.x + followBox.width / 2,
    followY = followBox.y + followBox.height / 2;
  await page.mouse.move(followX, followY);
  await page.mouse.down();
  await page.mouse.move(followX + 100, followY + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(200);
  expect((await stats(page)).camera).toEqual(paused.camera);
  expect((await stats(page)).cameraTarget).toEqual(paused.cameraTarget);
  await page.locator('#rw-pause').click();
  await expect.poll(async () => (await stats(page)).camera).not.toEqual(paused.camera);
  await setSpeed(page, '0');
  const stopped = await stats(page);
  await page.waitForTimeout(200);
  expect((await stats(page)).camera).toEqual(stopped.camera);
  expect((await stats(page)).cameraTarget).toEqual(stopped.cameraTarget);
  await page.locator('#rw-quality').click();
  expect((await stats(page)).camera).toEqual(stopped.camera);
  expect((await stats(page)).cameraMode).toBe('follow');
  await setSpeed(page, '200');
  await expect.poll(async () => (await stats(page)).camera).not.toEqual(stopped.camera);
  await follow.click();
  const restored = await stats(page);
  expect(restored.cameraMode).toBe('free');
  restored.camera.forEach((v, i) => expect(v).toBeCloseTo(free.camera[i], 4));
  restored.cameraTarget.forEach((v, i) => expect(v).toBeCloseTo(free.cameraTarget[i], 5));
  await expect(page.locator('#rw-camera-hint')).toContainText('Drag to orbit');
  await follow.click();
  await page.locator('#rw-reset').click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  expect((await stats(page)).cameraMode).toBe('free');
  (await stats(page)).camera.forEach((v, i) => expect(v).toBeCloseTo(initial.camera[i], 5));
  await page.locator('canvas').hover();
  await page.mouse.wheel(0, -250);
  await expect.poll(async () => (await stats(page)).camera).not.toEqual(initial.camera);
});

test('follow camera stays behind the locomotive throughout a lap and on mobile', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?level=railway');
  await page.locator('#rw-follow').click();
  await setSpeed(page, '200');
  // Cover both tunnels, the bridge, tight curves and the wrapped route seam.
  const visitedTunnels = new Set<string>();
  for (const elapsed of [0, 25, 33, 43, 50, 57, 68, 76]) {
    await expect
      .poll(async () => (await stats(page)).elapsed, { timeout: 40_000 })
      .toBeGreaterThan(elapsed);
    const snapshot = await stats(page),
      car = snapshot.cars[0];
    expect(snapshot.cameraMode).toBe('follow');
    expect(snapshot.camera.every(Number.isFinite)).toBe(true);
    const route = nearestTrack(snapshot.camera[0], snapshot.camera[2]);
    if (route.section?.kind === 'tunnel') {
      visitedTunnels.add(route.section.id);
      const lateral = route.lateral - LINE_OFFSET / 2;
      expect(Math.abs(lateral)).toBeLessThan(TUNNEL_HALF_WIDTH - 0.05);
      const roof = route.y + TUNNEL_SPRING + Math.sqrt(TUNNEL_HALF_WIDTH ** 2 - lateral ** 2);
      expect(snapshot.camera[1]).toBeLessThan(roof - 0.05);
      expect(snapshot.camera[1]).toBeGreaterThan(route.y + 0.1);
    }
    expect(
      (snapshot.camera[0] - car.x) * car.tx + (snapshot.camera[2] - car.z) * car.tz,
    ).toBeLessThan(-0.6);
    expect(
      Math.hypot(snapshot.cameraTarget[0] - car.x, snapshot.cameraTarget[2] - car.z),
    ).toBeLessThan(1.3);
    await page
      .locator('canvas')
      .screenshot({ path: `artifacts/railway-follow-lap-${elapsed}.png` });
    if (elapsed === 33) {
      await page.locator('#rw-pause').click();
      const paused = await stats(page);
      await page.waitForTimeout(150);
      expect((await stats(page)).camera).toEqual(paused.camera);
      await page.locator('#rw-follow').click();
      await page.locator('#rw-follow').click();
      (await stats(page)).camera.forEach((v, i) => expect(v).toBeCloseTo(paused.camera[i], 5));
      await page.locator('#rw-quality').click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .locator('canvas')
        .screenshot({ path: 'artifacts/railway-tunnel-mobile-light.png' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('#rw-quality').click();
      await page.locator('#rw-pause').click();
    }
  }
  expect([...visitedTunnels].sort()).toEqual(['hochgrat', 'tannenfels']);
  await page.locator('#rw-pause').click();
  await page.screenshot({ path: 'artifacts/railway-follow-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/railway-follow-mobile.png', fullPage: true });
  await page.locator('#rw-follow').click();
  expect((await stats(page)).cameraMode).toBe('free');
  expect(errors).toEqual([]);
});

test('clouds drift, reset reproducibly, and respond to reduced motion', async ({ page }) => {
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world canvas')).toBeVisible();
  const first = (await stats(page)).clouds.positions;
  expect(first).toHaveLength(3);
  await expect.poll(async () => (await stats(page)).clouds.positions).not.toEqual(first);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => (await stats(page)).clouds.reducedMotion).toBe(true);
  // Wait for the new preference to be rendered, not just reported by matchMedia.
  await page.locator('#rw-pause').click();
  await page.waitForTimeout(100);
  const resting = (await stats(page)).clouds.positions;
  await page.locator('#rw-reset').click();
  await page.waitForTimeout(100);
  expect((await stats(page)).clouds.positions).toEqual(resting);
  const before = (await stats(page)).travel;
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(before);
  expect((await stats(page)).clouds.positions).toEqual(resting);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(async () => (await stats(page)).clouds.positions).not.toEqual(resting);
  await setSpeed(page, '0');
  const stopped = (await stats(page)).clouds.positions;
  await page.waitForTimeout(100);
  expect((await stats(page)).clouds.positions).toEqual(stopped);
});

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
  expect((await stats(page)).clouds.positions).toEqual(paused.clouds.positions);
  await setSpeed(page, '200');
  expect((await stats(page)).speed).toBe(2);
  expect((await stats(page)).paused).toBe(true);
  await page.getByRole('button', { name: 'Resume simulation' }).click();
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(paused.travel);
  await setSpeed(page, '0');
  const stopped = await stats(page);
  await page.waitForTimeout(150);
  expect((await stats(page)).travel).toBe(stopped.travel);
  expect((await stats(page)).clouds.positions).toEqual(stopped.clouds.positions);
  await page.locator('#rw-quality').click();
  expect((await stats(page)).light).toBe(true);
  await expect.poll(async () => (await stats(page)).clouds.steps).toBe(32);
  await page.locator('#rw-reset').click();
  expect((await stats(page)).speed).toBe(1);
  expect((await stats(page)).light).toBe(false);
  await expect.poll(async () => (await stats(page)).clouds.steps).toBe(64);
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

for (const [url, canvas, level] of [
  ['/', '#world', 'jelly'],
  ['/?level=bubbles', '#bubble-world', 'bubbles'],
  ['/?level=aquarium', '#aquarium-world', 'aquarium'],
  ['/?level=fire', '#fire-world', 'fire'],
  ['/?level=airplane', '#flight-world', 'airplane'],
] as const) {
  test(`railway navigation to ${level} and back`, async ({ page }) => {
    await page.goto('/?level=railway');
    await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.level-nav a')).toHaveCount(9);
    await page.locator(`.level-nav a[href="${url === '/' ? './' : url.slice(1)}"]`).click();
    await expect(page.locator(`${canvas} canvas`)).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: '04 Model Railway' }).click();
    await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.level-nav [aria-current="page"]')).toHaveText('04 Model Railway');
  });
}

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
    await page.locator('#rw-follow').tap();
    await expect(page.locator('#rw-follow')).toHaveAttribute('aria-pressed', 'true');
    expect((await stats(page)).cameraMode).toBe('follow');
    await page.locator('#rw-follow').tap();
    expect((await stats(page)).cameraMode).toBe('free');
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
  await expect(page.locator('#rw-follow')).toBeDisabled();
  expect((await stats(page)).paused).toBe(true);
});

test('hidden tabs stop motion and return without a catch-up jump', async ({ page }) => {
  await page.goto('/?level=railway');
  await expect(page.locator('#railway-world canvas')).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await stats(page)).travel).toBeGreaterThan(0.1);
  await page.locator('#rw-follow').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await stats(page);
  await page.waitForTimeout(400);
  expect((await stats(page)).travel).toBe(hidden.travel);
  expect((await stats(page)).camera).toEqual(hidden.camera);
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
    expect(cars[i - 1].distance - cars[i].distance).toBeCloseTo(1.42 / 3, 5);
  await page.screenshot({ path: 'artifacts/railway-curve.png', fullPage: true });
  await page.locator('#rw-reset').click();
  await page.locator('#rw-pause').click();
  const canvas = page.locator('#railway-world canvas');
  await canvas.hover();
  await page.mouse.wheel(0, -190);
  await page.waitForTimeout(200);
  await canvas.screenshot({ path: 'artifacts/railway-detail.png' });
});
