import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type HorizonStats = {
  running: boolean;
  hover: boolean;
  auto: boolean;
  speed: number;
  rpm: number;
  altitude: number;
  livery: string;
  mainAngle: number;
  tailAngle: number;
  camera: number[];
  target: number[];
  pixelRatio: number;
  rotorBounds: number[][];
  triangles: number;
  drawCalls: number;
  blockedApertureSamples: number;
};
declare global {
  interface Window {
    horizonDiagnostics: () => HorizonStats;
  }
}
const stats = (page: Page) => page.evaluate(() => window.horizonDiagnostics());
const distance = (s: HorizonStats) => Math.hypot(...s.camera.map((x, i) => x - s.target[i]));
async function open(page: Page) {
  await page.goto('/horizon-05.html?inspect');
  await expect(page.locator('#status')).toHaveText('On platform');
}
function errorsFrom(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}
function rotorFits(s: HorizonStats) {
  expect(
    s.rotorBounds.every(([x, y, z]) => Math.abs(x) < 0.96 && Math.abs(y) < 0.96 && z > -1 && z < 1),
  ).toBe(true);
}

test('liveries, spin-up/down, hover, soft landing and zero-speed interlock', async ({ page }) => {
  test.setTimeout(95_000);
  const errors = errorsFrom(page);
  await open(page);
  rotorFits(await stats(page));
  expect((await stats(page)).blockedApertureSamples).toBe(0);
  await page.screenshot({ path: 'artifacts/helicopter/desktop.png' });
  for (const [name, key] of [
    ['Rescue orange', 'rescue'],
    ['Graphite', 'graphite'],
    ['Glacier blue and white', 'glacier'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    expect((await stats(page)).livery).toBe(key);
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    if (key !== 'glacier') await page.screenshot({ path: `artifacts/helicopter/${key}.png` });
  }
  await page.locator('#rotors').click();
  await expect.poll(async () => (await stats(page)).rpm).toBeGreaterThan(0.08);
  expect((await stats(page)).rpm).toBeLessThan(0.7);
  const before = await stats(page);
  await expect.poll(async () => (await stats(page)).tailAngle).not.toBe(before.tailAngle);
  expect((await stats(page)).mainAngle).not.toBe(before.mainAngle);
  await page.locator('#speed').fill('100');
  await expect(page.locator('#speed-value')).toHaveText('100%');
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 12_000 }).toBeGreaterThan(0.94);
  await page.locator('#hover').click();
  await expect
    .poll(async () => (await stats(page)).altitude, { timeout: 12_000 })
    .toBeGreaterThan(1.5);
  await expect(page.locator('#status')).toHaveText('Hovering');
  await page.screenshot({ path: 'artifacts/helicopter/hover.png' });
  await page.locator('#hover').click();
  const landing = (await stats(page)).altitude;
  expect(landing).toBeGreaterThan(1.1);
  await expect.poll(async () => (await stats(page)).altitude, { timeout: 12_000 }).toBe(0);
  expect((await stats(page)).running).toBe(true);
  await page.locator('#rotors').click();
  expect((await stats(page)).rpm).toBeGreaterThan(0.5);
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 20_000 }).toBe(0);
  await page.locator('#hover').click();
  await expect
    .poll(async () => (await stats(page)).altitude, { timeout: 12_000 })
    .toBeGreaterThan(0.8);
  await page.locator('#speed').fill('0');
  expect((await stats(page)).hover).toBe(false);
  expect((await stats(page)).altitude).toBeGreaterThan(0.5);
  await expect.poll(async () => (await stats(page)).altitude, { timeout: 12_000 }).toBe(0);
  await expect.poll(async () => (await stats(page)).rpm, { timeout: 20_000 }).toBe(0);
  await page.locator('#speed').fill('70');
  await page.locator('#hover').click();
  await expect
    .poll(async () => (await stats(page)).altitude, { timeout: 12_000 })
    .toBeGreaterThan(0.8);
  await page.locator('#rotors').click();
  expect((await stats(page)).hover).toBe(false);
  await expect.poll(async () => (await stats(page)).altitude, { timeout: 12_000 }).toBe(0);
  expect(errors).toEqual([]);
});

test('camera presets, orbit, zoom, reset, keyboard and fullscreen', async ({ page }) => {
  const errors = errorsFrom(page);
  await open(page);
  const home = await stats(page);
  for (const [name, axis, sign] of [
    ['Front', 0, -1],
    ['Side', 2, 1],
    ['Tail', 0, 1],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(async () => {
        const s = await stats(page);
        return (s.camera[axis] - s.target[axis]) * sign;
      })
      .toBeGreaterThan(18);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `artifacts/helicopter/${name.toLowerCase()}.png` });
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
  const bounds = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.55, {
    steps: 12,
  });
  await page.mouse.up();
  expect((await stats(page)).camera).not.toEqual(home.camera);
  const zoomBefore = distance(await stats(page));
  await page.mouse.wheel(0, -250);
  await expect.poll(async () => distance(await stats(page))).toBeLessThan(zoomBefore - 1);
  await page.locator('canvas').focus();
  const keyBefore = (await stats(page)).camera;
  await page.keyboard.press('ArrowRight');
  expect((await stats(page)).camera).not.toEqual(keyBefore);
  await page.keyboard.press('Space');
  expect((await stats(page)).running).toBe(true);
  await page.keyboard.press('h');
  expect((await stats(page)).hover).toBe(true);
  await page.keyboard.press('h');
  expect((await stats(page)).hover).toBe(false);
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

test('mobile layout, touch orbit and pinch zoom keep controls outside the scene', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  const errors = errorsFrom(page);
  try {
    await open(page);
    rotorFits(await stats(page));
    expect((await stats(page)).pixelRatio).toBeLessThanOrEqual(1.75);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const canvas = (await page.locator('canvas').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    await page.screenshot({ path: 'artifacts/helicopter/mobile.png', fullPage: true });
    const session = await context.newCDPSession(page);
    const x = canvas.x + canvas.width / 2,
      y = canvas.y + canvas.height / 2;
    const initial = (await stats(page)).camera;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 8, y: y + i * 2, id: 1 }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await stats(page)).camera).not.toEqual(initial);
    const zoomBefore = distance(await stats(page));
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
    expect(distance(await stats(page))).toBeLessThan(zoomBefore - 1);
    await page.getByRole('button', { name: 'Rescue orange' }).tap();
    expect((await stats(page)).livery).toBe('rescue');
    await page.locator('#hover').tap();
    expect((await stats(page)).hover).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('single file opens offline with no asset requests; fallback explains absent WebGL', async ({
  page,
}) => {
  const errors = errorsFrom(page),
    requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const url = pathToFileURL(resolve('public/horizon-05.html')).href + '?inspect';
  await page.goto(url);
  await expect(page.locator('#status')).toHaveText('On platform');
  expect(requests.filter((request) => request !== url && !request.startsWith('data:'))).toEqual([]);
  expect(errors).toEqual([]);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).startsWith('webgl')) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('WebGL 2');
  await expect(page.locator('#status')).toHaveText('Unavailable');
  await expect(page.locator('#hover')).toBeDisabled();
  await expect(page.locator('#retry')).toBeEnabled();
});

test('new level navigation and query route; reduced motion begins at rest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?level=helicopter');
  await expect(page).toHaveURL(/\/horizon-05\.html$/);
  await expect(page.locator('#status')).toHaveText('On platform');
  await page.getByRole('link', { name: '← LITTLE WORLDS' }).click();
  await expect(page.getByRole('link', { name: '09 Horizon 05', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '09 Horizon 05', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('On platform');
});
