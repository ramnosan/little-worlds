import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

type MelonSnapshot = {
  volume: number;
  energy: number;
  minRatio: number;
  minY: number;
  strain: number;
  steps: number;
  rejectedSteps: number;
  paused: boolean;
  slow: boolean;
  showMesh: boolean;
  preset: number;
  firmness: number;
  damping: number;
  grabs: number;
  running: boolean;
  project: (point: number[]) => { x: number; y: number };
};
declare global {
  interface Window {
    melonDiagnostics: () => MelonSnapshot;
  }
}
const stats = (page: Page) =>
  page.evaluate(() => {
    const { project: _project, ...data } = window.melonDiagnostics();
    return data;
  });
const position = (page: Page, point: number[]) =>
  page.evaluate((p) => window.melonDiagnostics().project(p), point);
async function open(page: Page) {
  await page.goto('/melon-jelly.html');
  await expect(page.locator('#status')).toContainText('WEBGPU · LIVE');
  await expect.poll(async () => (await stats(page)).steps).toBeGreaterThan(30);
}
function healthy(s: Awaited<ReturnType<typeof stats>>) {
  expect(s.minRatio).toBeGreaterThan(0.03);
  expect(s.minY).toBeGreaterThanOrEqual(0.06499);
  expect(s.volume).toBeGreaterThan(0.92);
  expect(s.volume).toBeLessThan(1.08);
}

test('native GPU, tip/flesh/rind/corner grabs, pointer capture, release and controls', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await open(page);
  for (const point of [
    [0, 2.38, 0.53],
    [0.3, 1.3, 0.57],
    [0, 0.25, 0.53],
    [-1.35, 0.91, 0.51],
  ]) {
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    const p = await position(page, point);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    expect((await stats(page)).grabs).toBe(1);
    await page.mouse.move(p.x + 140, p.y - 160, { steps: 20 });
    await expect.poll(async () => (await stats(page)).strain).toBeGreaterThan(0.1);
    healthy(await stats(page));
    await page.screenshot({ path: 'artifacts/melon/stretched.png' });
    await page.mouse.move(15, 15, { steps: 10 });
    expect((await stats(page)).grabs).toBe(1);
    await page.mouse.up();
    expect((await stats(page)).grabs).toBe(0);
    await expect.poll(async () => (await stats(page)).minY, { timeout: 10_000 }).toBeLessThan(0.07);
  }
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  for (const [i, name] of ['Ruby summer', 'Peach picnic', 'Golden hour'].entries()) {
    await page.getByRole('button', { name, exact: true }).click();
    expect((await stats(page)).preset).toBe(i);
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  for (const value of ['0', '100', '45']) {
    await page.locator('#firmness').fill(value);
    await expect(page.locator('#firmness-value')).toHaveText(value + '%');
    expect((await stats(page)).firmness).toBe(+value / 100);
  }
  for (const value of ['0', '100', '35']) {
    await page.locator('#damping').fill(value);
    await expect(page.locator('#damping-value')).toHaveText(value + '%');
    expect((await stats(page)).damping).toBe(+value / 100);
  }
  await page.getByLabel('Show mesh', { exact: true }).check();
  expect((await stats(page)).showMesh).toBe(true);
  await page.getByLabel('¼ speed', { exact: true }).check();
  expect((await stats(page)).slow).toBe(true);
  const start = (await stats(page)).steps;
  await page.waitForTimeout(800);
  const quarterSteps = (await stats(page)).steps - start;
  expect(quarterSteps).toBeGreaterThan(10);
  expect(quarterSteps).toBeLessThan(38);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const frozen = (await stats(page)).steps;
  await page.waitForTimeout(250);
  expect((await stats(page)).steps).toBe(frozen);
  await expect(page.getByRole('button', { name: 'Give it a nudge ↗' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  expect((await stats(page)).volume).toBe(1);
  expect((await stats(page)).energy).toBe(0);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByLabel('¼ speed', { exact: true }).uncheck();
  await page.getByLabel('Show mesh', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Give it a nudge ↗' }).click();
  await expect.poll(async () => (await stats(page)).energy).toBeGreaterThan(0.02);
  await expect
    .poll(async () => (await stats(page)).energy, { timeout: 20_000 })
    .toBeLessThan(0.002);
  await page.getByRole('button', { name: 'Ruby summer', exact: true }).click();
  await page.screenshot({ path: 'artifacts/melon/desktop.png', fullPage: true });
  healthy(await stats(page));
  expect(errors).toEqual([]);
});

test('mobile layout, real touch grabs and simultaneous twisting', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const canvas = (await page.locator('canvas').boundingBox())!,
      panel = (await page.locator('.panel').boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    const session = await context.newCDPSession(page);
    const a = await position(page, [-0.55, 1.35, 0.56]),
      b = await position(page, [0.55, 1.35, 0.56]);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { ...a, id: 1 },
        { ...b, id: 2 },
      ],
    });
    expect((await stats(page)).grabs).toBe(2);
    for (let i = 1; i <= 12; i++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: a.x - i * 3, y: a.y - i * 4, id: 1 },
          { x: b.x + i * 3, y: b.y + i * 3, id: 2 },
        ],
      });
    await expect.poll(async () => (await stats(page)).strain).toBeGreaterThan(0.1);
    healthy(await stats(page));
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await stats(page)).grabs).toBe(0);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.screenshot({ path: 'artifacts/melon/mobile.png', fullPage: true });
  } finally {
    await context.close();
  }
});

test('reduced motion starts paused, and absent WebGPU has an honest explanation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/melon-jelly.html');
  await expect(page.locator('#status')).toContainText('WEBGPU · PAUSED');
  expect((await stats(page)).steps).toBe(0);
  await expect(page.locator('#motion-note')).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(async () => (await stats(page)).steps).toBeGreaterThan(3);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('This browser does not expose WebGPU');
  await expect(page.locator('#status')).toContainText('UNAVAILABLE');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
});

test('level navigation and query route reach the self-contained page', async ({ page }) => {
  await page.goto('/?level=melon');
  await expect(page).toHaveURL(/\/melon-jelly\.html$/);
  await expect(page.locator('#status')).toContainText('WEBGPU · LIVE');
  await page.getByRole('link', { name: '← LITTLE WORLDS' }).click();
  await expect(page.getByRole('link', { name: '08 Melon Jelly', exact: true })).toBeVisible();
});

test('the downloaded HTML runs by itself without requesting runtime assets', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const url = pathToFileURL(resolve('public/melon-jelly.html')).href;
  await page.goto(url);
  await expect(page.locator('#status')).toContainText('WEBGPU · LIVE');
  await expect.poll(async () => (await stats(page)).steps).toBeGreaterThan(10);
  expect(requests.filter((request) => request !== url && !request.startsWith('data:'))).toEqual([]);
});
