import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type RaptorStats = {
  running: boolean;
  flight: boolean;
  auto: boolean;
  throttle: number;
  rpm: number;
  progress: number;
  altitude: number;
  gear: number;
  door: number;
  bank: number;
  pitch: number;
  finish: string;
  camera: number[];
  target: number[];
  pixelRatio: number;
  airframeBounds: number[][];
  gearVisible: boolean[];
  wheelBottoms: number[];
  nozzleAngles: number[];
  controlAngles: number[][];
  reducedMotion: boolean;
  intakeClearances: number[];
  exhaustCores: { name: string; depth: number }[];
};
declare global {
  interface Window {
    raptorDiagnostics: () => RaptorStats;
  }
}
const stats = (page: Page) => page.evaluate(() => window.raptorDiagnostics());
const distance = (s: RaptorStats) => Math.hypot(...s.camera.map((n, i) => n - s.target[i]));
function errorsFrom(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  return errors;
}
async function open(page: Page) {
  await page.goto('/raptor-22.html?inspect');
  await expect(page.locator('#status')).toHaveText('On platform');
}
function fits(s: RaptorStats) {
  expect(
    s.airframeBounds.every(
      ([x, y, z]) => Math.abs(x) < 0.96 && Math.abs(y) < 0.96 && z > -1 && z < 1,
    ),
  ).toBe(true);
}

test('finishes, gradual engine spool, throttle extremes and shutdown', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = errorsFrom(page);
  await open(page);
  fits(await stats(page));
  expect((await stats(page)).wheelBottoms.every((y) => Math.abs(y - 0.24) < 0.001)).toBe(true);
  expect((await stats(page)).intakeClearances.every((depth) => depth > 1)).toBe(true);
  expect(
    (await stats(page)).exhaustCores.every(
      (core) => core.name === 'Exhaust core' && core.depth > 1,
    ),
  ).toBe(true);
  for (const [name, key] of [
    ['Arctic demonstrator', 'arctic'],
    ['Dark graphite concept', 'graphite'],
    ['Air-superiority gray', 'gray'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    expect((await stats(page)).finish).toBe(key);
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('#finish-name')).toHaveText(name);
  }
  await page.locator('#engines').click();
  await expect.poll(async () => (await stats(page)).rpm).toBeGreaterThan(0.02);
  expect((await stats(page)).rpm).toBeLessThan(0.65);
  await page.locator('#throttle').fill('100');
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 12_000 }).toBeGreaterThan(0.95);
  await page.locator('#throttle').fill('0');
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 15_000 }).toBeLessThan(0.25);
  expect((await stats(page)).running).toBe(true);
  expect((await stats(page)).rpm).toBeGreaterThan(0.21);
  await page.locator('#engines').click();
  expect((await stats(page)).rpm).toBeGreaterThan(0.1);
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 18_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('flight sequence, articulated surfaces, reversible gear and soft landing before shutdown', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = errorsFrom(page);
  await open(page);
  await page.locator('#flight').click();
  expect((await stats(page)).running).toBe(true);
  await expect.poll(async () => (await stats(page)).progress).toBeGreaterThan(0.1);
  let state = await stats(page);
  expect(state.altitude).toBeGreaterThan(0);
  expect(state.gear).toBe(0);
  // Reverse a transition while the wheels are still down.
  await page.locator('#flight').click();
  await expect.poll(async () => (await stats(page)).progress).toBe(0);
  expect((await stats(page)).gearVisible).toEqual([true, true, true]);
  await page.locator('#flight').click();
  await expect.poll(async () => (await stats(page)).progress, { timeout: 15_000 }).toBe(1);
  state = await stats(page);
  fits(state);
  expect(state.gear).toBe(1);
  expect(state.door).toBe(0);
  expect(state.gearVisible).toEqual([false, false, false]);
  expect(state.altitude).toBeGreaterThan(2.5);
  const surfaces = state.controlAngles;
  // Mirrored spanwise axes require opposite hinge angles for symmetric pitch,
  // and equal hinge angles for differential aileron movement.
  expect(surfaces[0][0]).toBeCloseTo(-surfaces[4][0], 8);
  expect(surfaces[2][0]).toBeCloseTo(surfaces[6][0], 8);
  await expect.poll(async () => (await stats(page)).controlAngles).not.toEqual(surfaces);
  await expect
    .poll(async () => Math.abs((await stats(page)).nozzleAngles[0]))
    .toBeGreaterThan(0.005);
  // Landing by the flight button keeps the engines running.
  await page.locator('#flight').click();
  await expect.poll(async () => (await stats(page)).progress, { timeout: 15_000 }).toBe(0);
  expect((await stats(page)).running).toBe(true);
  await page.locator('#flight').click();
  await expect.poll(async () => (await stats(page)).progress, { timeout: 15_000 }).toBe(1);
  // Engine stop in flight must open the doors before extending the gear.
  await page.locator('#engines').click();
  expect((await stats(page)).flight).toBe(false);
  await expect.poll(async () => (await stats(page)).progress).toBeLessThan(0.7);
  state = await stats(page);
  expect(state.door).toBeGreaterThan(0.95);
  expect(state.gear).toBeGreaterThan(0.9);
  await expect.poll(async () => (await stats(page)).progress).toBeLessThan(0.25);
  state = await stats(page);
  expect(state.gear).toBe(0);
  expect(state.gearVisible).toEqual([true, true, true]);
  expect(state.rpm).toBeGreaterThan(0.4);
  expect(state.altitude).toBeGreaterThan(0);
  await expect.poll(async () => (await stats(page)).progress).toBe(0);
  state = await stats(page);
  expect(state.bank).toBe(0);
  expect(state.pitch).toBe(0);
  expect(state.wheelBottoms.every((y) => Math.abs(y - 0.24) < 0.001)).toBe(true);
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 20_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('all camera presets, drag, zoom, auto orbit, keyboard, reset and fullscreen', async ({
  page,
}) => {
  const errors = errorsFrom(page);
  await open(page);
  const home = await stats(page);
  for (const [name, axis, sign] of [
    ['Front', 2, -1],
    ['Side', 0, -1],
    ['Rear', 2, 1],
    ['Top', 1, 1],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(async () => {
        const s = await stats(page);
        return (s.camera[axis] - s.target[axis]) * sign;
      })
      .toBeGreaterThan(30);
  }
  await page.locator('#auto').click();
  expect((await stats(page)).auto).toBe(true);
  const orbit = (await stats(page)).camera;
  await expect.poll(async () => (await stats(page)).camera).not.toEqual(orbit);
  await page.locator('#auto').click();
  const stopped = (await stats(page)).camera;
  await page.waitForTimeout(150);
  (await stats(page)).camera.forEach((value, i) => expect(value).toBeCloseTo(stopped[i], 9));
  await page.locator('#reset').click();
  await expect
    .poll(async () => Math.abs((await stats(page)).camera[0] - home.camera[0]))
    .toBeLessThan(0.02);
  const b = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.55, { steps: 10 });
  await page.mouse.up();
  expect((await stats(page)).camera).not.toEqual(home.camera);
  const beforeZoom = distance(await stats(page));
  await page.mouse.wheel(0, -250);
  await expect.poll(async () => distance(await stats(page))).toBeLessThan(beforeZoom - 1);
  await page.locator('canvas').focus();
  const beforeKeys = (await stats(page)).camera;
  await page.keyboard.press('ArrowRight');
  expect((await stats(page)).camera).not.toEqual(beforeKeys);
  await page.keyboard.press('Space');
  expect((await stats(page)).running).toBe(true);
  await page.keyboard.press('f');
  expect((await stats(page)).flight).toBe(true);
  await page.keyboard.press('f');
  expect((await stats(page)).flight).toBe(false);
  await page.keyboard.press('r');
  await expect
    .poll(async () => Math.abs((await stats(page)).camera[0] - home.camera[0]))
    .toBeLessThan(0.02);
  await page.getByRole('button', { name: 'Enter fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  expect(errors).toEqual([]);
});

test('mobile touch orbit and pinch, narrow layout, full airframe and capped pixel ratio', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage(),
    errors = errorsFrom(page);
  try {
    await open(page);
    fits(await stats(page));
    expect((await stats(page)).pixelRatio).toBeLessThanOrEqual(1.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const c = (await page.locator('canvas').boundingBox())!,
      p = (await page.locator('.panel').boundingBox())!;
    expect(p.y).toBeGreaterThanOrEqual(c.y + c.height);
    const session = await context.newCDPSession(page),
      x = c.x + c.width / 2,
      y = c.y + c.height / 2;
    const before = (await stats(page)).camera;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 7, y: y + i, id: 1 }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await stats(page)).camera).not.toEqual(before);
    const beforeZoom = distance(await stats(page));
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 35, y, id: 1 },
        { x: x + 35, y, id: 2 },
      ],
    });
    for (let i = 1; i <= 8; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: x - 35 - i * 5, y, id: 1 },
          { x: x + 35 + i * 5, y, id: 2 },
        ],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(distance(await stats(page))).toBeLessThan(beforeZoom - 1);
    await page.getByRole('button', { name: 'Arctic demonstrator' }).tap();
    expect((await stats(page)).finish).toBe('arctic');
    await page.locator('#flight').tap();
    expect((await stats(page)).flight).toBe(true);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('offline file has no runtime requests and missing WebGL has a helpful fallback', async ({
  page,
}) => {
  const errors = errorsFrom(page),
    requests: string[] = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(resolve('public/raptor-22.html')).href + '?inspect');
  await expect(page.locator('#status')).toHaveText('On platform');
  await page.locator('#engines').click();
  await expect.poll(async () => (await stats(page)).rpm).toBeGreaterThan(0.02);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type === 'webgl2') return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.reload();
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#fallback')).toContainText('hardware acceleration');
  await expect(page.locator('#engines')).toBeDisabled();
  await expect(page.locator('#retry')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Horizon aircraft navigation and reduced-motion display', async ({ page }) => {
  const errors = errorsFrom(page);
  await page.goto('/horizon-05.html');
  await page.getByRole('link', { name: 'Raptor 22 · Fighter jet ↗' }).click();
  await expect(page).toHaveURL(/raptor-22\.html$/);
  await expect(page.getByRole('heading', { name: 'Raptor 22.' })).toBeVisible();
  await page.getByRole('link', { name: 'Horizon 05 · Helicopter' }).click();
  await expect(page).toHaveURL(/horizon-05\.html$/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  expect((await stats(page)).running).toBe(false);
  expect((await stats(page)).auto).toBe(false);
  await page.locator('#flight').click();
  await expect.poll(async () => (await stats(page)).progress, { timeout: 15_000 }).toBe(1);
  expect((await stats(page)).bank).toBe(0);
  expect((await stats(page)).pitch).toBe(0);
  expect(errors).toEqual([]);
});
