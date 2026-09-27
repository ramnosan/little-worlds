import { test, expect, type Page } from '@playwright/test';
import type { PlantWorld } from '../../src/plant/growth';
import type { PlantRenderer } from '../../src/plant/render';
type Snapshot = ReturnType<PlantWorld['snapshot']> &
  ReturnType<PlantRenderer['stats']> & { selected: number | null };
declare global {
  interface Window {
    __plantDebug: () => Snapshot;
    __plantTest: {
      advance: (seconds: number) => void;
      plant: (x: number, y?: number) => void;
      project: (x: number, y?: number) => { x: number; y: number };
      reset: () => void;
    };
  }
}
const stats = (page: Page) => page.evaluate(() => window.__plantDebug());
async function open(page: Page) {
  await page.goto('/?level=plant');
  await expect(page.locator('#level-loading')).toHaveCount(0);
  await expect(page.locator('#plant-world canvas')).toBeVisible();
  await page.locator('#plant-pause').click();
}
async function position(page: Page, x: number, y = -0.85) {
  const local = await page.evaluate(({ x, y }) => window.__plantTest.project(x, y), { x, y });
  const box = (await page.locator('canvas').boundingBox())!;
  return { x: box.x + local.x, y: box.y + local.y };
}
test('starter, pointer planting, selection, invalid placement and paused planting', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  expect((await stats(page)).plants).toHaveLength(1);
  const target = await position(page, 2);
  await page.mouse.click(target.x, target.y);
  expect((await stats(page)).plants).toHaveLength(2);
  const newPlant = (await stats(page)).plants[1];
  expect(newPlant.stage).toBe('bulb');
  expect(newPlant.age).toBe(0);
  await page.waitForTimeout(100);
  expect((await stats(page)).plants[1].development).toBe(0);
  await page.locator('#plant-select').selectOption('1');
  expect((await stats(page)).selected).toBe(1);
  await page.mouse.click(target.x, target.y);
  expect((await stats(page)).plants).toHaveLength(2);
  expect((await stats(page)).selected).toBe(2);
  const bad = await position(page, -2, -2);
  await page.mouse.click(bad.x, bad.y);
  await expect(page.locator('#plant-notice')).toContainText('band');
  const close = await position(page, 2.5);
  await page.mouse.click(close.x, close.y);
  await expect(page.locator('#plant-notice')).toContainText('space');
  await page.locator('#plant-tool').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  expect((await stats(page)).plants).toHaveLength(2);
  expect(errors).toEqual([]);
});
test('keyboard planting, controls, elapsed time, restart and shortcut focus guard', async ({
  page,
}) => {
  await open(page);
  await page.locator('#plant-reset').click();
  expect((await stats(page)).plants).toHaveLength(0);
  await page.locator('#plant-pause').click();
  await page.locator('#plant-tool').click();
  await page.keyboard.press('Enter');
  expect((await stats(page)).plants).toHaveLength(1);
  await page.getByRole('button', { name: '20×', exact: true }).click();
  expect((await stats(page)).speed).toBe(20);
  await page.locator('#plant-pause').click();
  await expect.poll(async () => (await stats(page)).elapsed).toBeGreaterThan(1);
  await page.locator('#plant-pause').click();
  const frozen = (await stats(page)).elapsed;
  await page.waitForTimeout(100);
  expect((await stats(page)).elapsed).toBe(frozen);
  await page.keyboard.press('r');
  expect((await stats(page)).plants).toHaveLength(1);
  await page.locator('canvas').focus();
  await page.keyboard.press('r');
  expect((await stats(page)).plants).toHaveLength(0);
  expect((await stats(page)).speed).toBe(1);
  await page.keyboard.press('Space');
  expect((await stats(page)).paused).toBe(true);
  await expect(page.locator('#plant-timeline')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Water', exact: true })).toHaveCount(0);
});
test('left drag pans, right drag orbits the tank, and fit restores the view', async ({ page }) => {
  await open(page);
  const before = await stats(page),
    canvas = page.locator('canvas'),
    target = await position(page, 2);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 50, target.y, { steps: 5 });
  await page.mouse.up();
  const panned = await stats(page);
  expect(panned.plants).toHaveLength(1);
  expect(panned.target).not.toEqual(before.target);
  panned.camera.forEach((value, i) =>
    expect(value - panned.target[i]).toBeCloseTo(before.camera[i] - before.target[i]),
  );
  await page.locator('#plant-fit').click();
  expect((await stats(page)).target).toEqual([0, -1.96, 0.04]);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(target.x + 60, target.y + 20, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const orbited = await stats(page);
  expect(orbited.plants).toHaveLength(1);
  expect(orbited.camera).not.toEqual(before.camera);
  expect(orbited.target).toEqual(before.target);
  expect(orbited.zoom).toBeCloseTo(before.zoom);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await stats(page)).zoom).toBeGreaterThan(1);
  const session = await page.context().newCDPSession(page),
    box = (await canvas.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height * 0.7;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: x - 30, y, id: 1 },
      { x: x + 30, y, id: 2 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: x - 60, y: y - 10, id: 1 },
      { x: x + 60, y: y - 10, id: 2 },
    ],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  expect((await stats(page)).plants).toHaveLength(1);
  await page.locator('#plant-fit').click();
  expect((await stats(page)).zoom).toBeCloseTo(1);
  (await stats(page)).camera.forEach((value, i) => expect(value).toBeCloseTo(before.camera[i]));
  expect((await stats(page)).target).toEqual(before.target);
});
test('hidden tab suspends without catch-up and context recovery preserves organs', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => window.__plantTest.advance(70));
  await page.locator('#plant-pause').click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await stats(page);
  await page.waitForTimeout(300);
  expect((await stats(page)).elapsed).toBe(hidden.elapsed);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
  expect((await stats(page)).elapsed - hidden.elapsed).toBeLessThan(0.2);
  await page.locator('#plant-pause').click();
  const before = await stats(page);
  await page.evaluate(() => {
    const c = document.querySelector('canvas')!;
    const ext = c.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 200);
  });
  await expect(page.locator('#plant-notice')).toContainText('The garden is ready');
  const after = await stats(page);
  expect(after.paused).toBe(true);
  expect(after.plants).toEqual(before.plants);
});
test('capacity, staggered growth, bloom hold and stable GPU resources after full restarts', async ({
  page,
}) => {
  test.setTimeout(90000);
  await open(page);
  const fill = () =>
    page.evaluate(() => {
      window.__plantTest.reset();
      for (let i = 0; i < 12; i++) window.__plantTest.plant(-5.3 + i * 0.95);
      window.__plantTest.advance(300);
    });
  await fill();
  let s = await stats(page);
  expect(s.plants).toHaveLength(12);
  expect(s.plants.every((p) => p.stage === 'bloom')).toBe(true);
  await page.evaluate(() => window.__plantTest.plant(5.6));
  await expect(page.locator('#plant-notice')).toContainText('12 bulbs');
  const organs = s.plants.map((p) => ({ roots: p.roots, opening: p.opening }));
  await page.evaluate(() => window.__plantTest.advance(40));
  expect((await stats(page)).plants.map((p) => ({ roots: p.roots, opening: p.opening }))).toEqual(
    organs,
  );
  const memory = await stats(page);
  for (let i = 0; i < 3; i++) await fill();
  s = await stats(page);
  expect(s.geometries).toBe(memory.geometries);
  expect(s.textures).toBe(memory.textures);
  await page.evaluate(() => {
    window.__plantTest.reset();
    window.__plantTest.plant(-3);
    window.__plantTest.advance(70);
    window.__plantTest.plant(0);
    window.__plantTest.advance(50);
    window.__plantTest.plant(3);
  });
  s = await stats(page);
  expect(s.plants[0].development).toBeGreaterThan(s.plants[1].development);
  expect(s.plants[2].stage).toBe('bulb');
});
for (const width of [1440, 390, 320]) {
  test('visual iris stages and accessible layout at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page);
    await expect(page.locator('.level-nav a')).toHaveCount(8);
    await expect(page.locator('.level-nav [aria-current="page"]')).toHaveText('07 Plant');
    for (const [label, seconds] of [
      ['bulb', 0],
      ['root', 12],
      ['emergence', 35],
      ['leaves', 80],
      ['bud', 151],
      ['bloom', 240],
    ] as const) {
      await page.evaluate((seconds) => {
        window.__plantTest.reset();
        window.__plantTest.plant(0);
        window.__plantTest.advance(seconds);
      }, seconds);
      await page.screenshot({ path: `artifacts/iris-${label}-${width}.png`, fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await page.locator('canvas').boundingBox())!.height).toBeGreaterThanOrEqual(420);
    await expect(page.getByRole('button', { name: /Graphics/ })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Language / Sprache' }).selectOption('de');
    await expect(page).toHaveTitle('Plant · Little Worlds');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('#plant-tool')).toHaveText('Zwiebel pflanzen');
  });
}
