import { test, expect, type Page } from '@playwright/test';
import type { AirplaneWorld } from '../../src/airplane/physics';
import type { AirplaneRenderer } from '../../src/airplane/render';
type Snapshot = ReturnType<AirplaneWorld['stats']> & ReturnType<AirplaneRenderer['stats']>;
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __airplaneDebug(): Snapshot }).__airplaneDebug());

test('camera toggle works during flight and pause, persists through reset and respects focused controls', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?level=airplane&airplaneFixture=near');
  await page.waitForFunction(() => '__airplaneDebug' in window);
  const initial = await stats(page);
  expect(initial.cameraMode).toBe('ground');
  await page.locator('#flight-camera').click();
  await page.clock.runFor(100);
  const chase = await stats(page);
  expect(chase.cameraMode).toBe('chase');
  expect(chase.fov).toBe(55);
  expect(chase.position).toEqual(initial.position);
  expect(chase.orientation).toEqual(initial.orientation);
  expect(chase.time).toBe(initial.time);
  await expect(page.locator('#flight-camera')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'artifacts/airplane-chase-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: 'artifacts/airplane-chase-mobile.png', fullPage: true });
  await page.locator('canvas').focus();
  await page.keyboard.press('Space');
  await page.clock.runFor(200);
  await page.keyboard.press('c');
  expect((await stats(page)).cameraMode).toBe('ground');
  await page.keyboard.press('c');
  expect((await stats(page)).cameraMode).toBe('chase');
  await page.keyboard.press('r');
  expect((await stats(page)).cameraMode).toBe('chase');
  await page.locator('#flight-throttle').focus();
  await page.keyboard.press('c');
  expect((await stats(page)).cameraMode).toBe('chase');
  await page.reload();
  await page.waitForFunction(() => '__airplaneDebug' in window);
  expect((await stats(page)).cameraMode).toBe('ground');
});

test('camera toggle remains usable after a crash and translates on mobile', async ({ page }) => {
  await page.goto('/?level=airplane&airplaneFixture=crash');
  await page.locator('#flight-camera').click();
  expect((await stats(page)).cameraMode).toBe('chase');
  expect((await stats(page)).state).toBe('crashed');
  await page.locator('#flight-restart').click();
  expect((await stats(page)).cameraMode).toBe('chase');
  await page.getByRole('combobox', { name: 'Language / Sprache' }).selectOption('de');
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator('#flight-camera')).toHaveText('Verfolgeransicht');
  await page.locator('#flight-camera').click();
  await expect(page.locator('#flight-camera')).toHaveText('Bodenansicht');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('keyboard takeoff, fixed ground camera, pause, focus loss and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install();
  await page.goto('/?level=airplane');
  await page.locator('canvas').focus();
  await page.keyboard.down('Shift');
  await page.clock.runFor(2600);
  await page.keyboard.up('Shift');
  expect((await stats(page)).input.throttle).toBe(1);
  await page.clock.runFor(2200);
  await page.keyboard.down('s');
  await page.clock.runFor(300);
  await page.keyboard.up('s');
  await page.clock.runFor(700);
  const flying = await stats(page);
  expect(flying.altitude).toBeGreaterThan(0.5);
  expect(flying.state).toBe('flying');
  expect(flying.cameraPosition).toEqual([-12, 1.7, 19]);
  expect(Math.abs(flying.projected[0])).toBeLessThan(1);
  expect(Math.abs(flying.projected[1])).toBeLessThan(1);
  await page.keyboard.press('Space');
  const paused = await stats(page);
  await page.clock.runFor(1000);
  expect((await stats(page)).position).toEqual(paused.position);

  await page.keyboard.press('Space');
  await page.keyboard.down('a');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(200);
  expect((await stats(page)).paused).toBe(true);
  expect((await stats(page)).input.roll).toBe(0);
  await page.keyboard.up('a');
  await page.keyboard.press('r');
  await page.clock.runFor(20);
  expect((await stats(page)).input.throttle).toBe(0);
  expect((await stats(page)).state).toBe('ground');
  await expect(page.locator('#flight-quality')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('Shift and Ctrl throttle combine with WASD and QE without browser shortcuts', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?level=airplane');
  await page.locator('canvas').focus();
  await page.keyboard.down('Shift');
  await page.clock.runFor(1200);
  await page.keyboard.up('Shift');
  const gas = (await stats(page)).input.throttle;
  expect(gas).toBeGreaterThan(0.4);
  await page.keyboard.down('Control');
  await page.keyboard.down('w');
  await page.keyboard.down('e');
  await page.clock.runFor(300);
  const changed = await stats(page);
  expect(changed.input.throttle).toBeLessThan(gas);
  expect(changed.input.pitch).toBeLessThan(0);
  expect(changed.input.yaw).toBeGreaterThan(0);
  await page.keyboard.up('w');
  await page.keyboard.up('e');
  await page.keyboard.up('Control');
  await page.locator('#flight-throttle').focus();
  const focused = (await stats(page)).input.throttle;
  await page.keyboard.down('Control');
  await page.clock.runFor(400);
  await page.keyboard.up('Control');
  expect((await stats(page)).input.throttle).toBe(focused);
});

test('sustained climb and stall keep the page rendering and reset responsive', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => errors.push('page crashed'));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install();
  await page.goto('/?level=airplane');
  await page.locator('canvas').focus();
  await page.keyboard.press('c');
  await page.keyboard.down('Shift');
  await page.clock.runFor(2600);
  await page.keyboard.up('Shift');
  const baseline = (await stats(page)).memory;
  for (let i = 0; i < 6; i++) {
    await page.clock.runFor(3000);
    const s = await stats(page);
    expect(s.state).not.toBe('crashed');
    expect(s.position.every(Number.isFinite)).toBe(true);
    expect(s.cameraPosition.every(Number.isFinite)).toBe(true);
    expect(s.memory).toEqual(baseline);
  }
  await page.keyboard.down('s');
  await page.clock.runFor(7000);
  await page.keyboard.up('s');
  await page.keyboard.press('r');
  await page.clock.runFor(100);
  expect((await stats(page)).state).toBe('ground');
  await page.locator('#flight-camera').click();
  await expect(page.locator('#flight-camera')).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('graphics interruptions recover without losing the flight or locking controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?level=airplane&airplaneFixture=near');
  await page.locator('#flight-camera').click();
  const initial = await stats(page);
  let restoredMemory: Snapshot['memory'] | undefined;
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
      // Retain the extension until restoration; querying a lost context returns null.
      canvas.addEventListener(
        'webglcontextlost',
        () => {
          setTimeout(() => extension.restoreContext(), 500);
        },
        { once: true },
      );
      extension.loseContext();
    });
    await expect(page.locator('#flight-notice')).toContainText('Graphics interrupted');
    await expect(page.locator('#flight-reset')).toBeDisabled();
    await expect(page.locator('#flight-notice')).toContainText('Graphics restored');
    await expect(page.locator('#flight-reset')).toBeEnabled();
    await expect(page.locator('#flight-camera')).toBeEnabled();
    await expect(page.locator('#flight-pause')).toHaveText('Resume');
    const restored = await stats(page);
    expect(restored.position).toEqual(initial.position);
    expect(restored.time).toBe(initial.time);
    expect(restored.paused).toBe(true);
    expect(restored.cameraMode).toBe('chase');
    // Restoration uploads only currently visible geometry; the original ground view
    // may have uploaded additional scenery before switching to chase view.
    await expect.poll(async () => (await stats(page)).memory.geometries).toBeGreaterThan(0);
    const memory = (await stats(page)).memory;
    expect(memory.geometries).toBeLessThanOrEqual(initial.memory.geometries);
    expect(memory.textures).toBe(initial.memory.textures);
    if (restoredMemory) expect(memory).toEqual(restoredMemory);
    restoredMemory = memory;
  }
  await page.screenshot({ path: 'artifacts/airplane-graphics-restored.png' });
  await page.locator('#flight-pause').click();
  await expect.poll(async () => (await stats(page)).time).toBeGreaterThan(initial.time);
  await page.locator('#flight-reset').click();
  expect((await stats(page)).state).toBe('ground');
  expect(errors).toEqual([]);
});

test('short keyboard taps build partial deflection and releasing recenters smoothly', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/?level=airplane');
  await page.locator('canvas').focus();
  await page.keyboard.down('d');
  await page.clock.runFor(100);
  const tap = await stats(page);
  expect(tap.input.roll).toBeGreaterThan(0.1);
  expect(tap.input.roll).toBeLessThan(0.4);
  expect(tap.surfaces.roll).toBeGreaterThan(0);
  expect(tap.surfaces.roll).toBeLessThan(tap.input.roll);
  await page.keyboard.up('d');
  await page.clock.runFor(1000);
  const released = await stats(page);
  expect(released.input.roll).toBe(0);
  expect(Math.abs(released.surfaces.roll)).toBeLessThan(0.001);
});

test('crash restart, focus protection, graphics and resource stability', async ({ page }) => {
  await page.goto('/?level=airplane&airplaneFixture=crash');
  await expect(page.locator('#flight-crash')).toBeVisible();
  await page.locator('#flight-restart').click();
  await expect(page.locator('#flight-crash')).toBeHidden();
  const initial = (await stats(page)).memory;
  await page.locator('#flight-throttle').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  expect((await stats(page)).input.roll).toBe(0);
  for (let i = 0; i < 4; i++) {
    await page.locator('#flight-quality').click();
    expect((await stats(page)).scenery.detailVisible).toBe(false);
    await page.locator('#flight-reset').click();
  }
  expect((await stats(page)).scenery.detailVisible).toBe(true);
  expect((await stats(page)).memory).toEqual(initial);
});

for (const fixture of ['fields', 'field-pass'])
  test(`countryside renders ${fixture} in both graphics settings without shader errors`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(`/?level=airplane&airplaneFixture=${fixture}`);
    await page.locator('#flight-camera').click();
    await page.screenshot({ path: `artifacts/airplane-${fixture}-chase.png`, fullPage: true });
    const initial = await stats(page);
    await page.locator('#flight-quality').click();
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.screenshot({
      path: `artifacts/airplane-${fixture}-mobile-light.png`,
      fullPage: true,
    });
    expect((await stats(page)).position).toEqual(initial.position);
    expect((await stats(page)).scenery.geometries).toBe(initial.scenery.geometries);
    expect(errors).toEqual([]);
  });

for (const fixture of ['near', 'far', 'overhead'])
  test(`camera tracks ${fixture} from the same pilot position`, async ({ page }) => {
    await page.goto(`/?level=airplane&airplaneFixture=${fixture}`);
    await page.waitForFunction(() => '__airplaneDebug' in window);
    const s = await stats(page);
    expect(s.cameraPosition).toEqual([-12, 1.7, 19]);
    expect(s.cameraUp).toEqual([0, 1, 0]);
    expect(Math.abs(s.projected[0])).toBeLessThan(0.02);
    expect(Math.abs(s.projected[1])).toBeLessThan(0.02);
    await page.screenshot({ path: `artifacts/airplane-${fixture}.png` });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.screenshot({ path: `artifacts/airplane-${fixture}-mobile.png`, fullPage: true });
  });

test('desktop and German mobile layouts, dual touch sticks and cancellation', async ({ page }) => {
  await page.goto('/?level=airplane');
  await page.locator('canvas').waitFor();
  await page.screenshot({ path: 'artifacts/airplane-desktop.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Language / Sprache' }).selectOption('de');
  await expect(page).toHaveTitle('Modellflug · Little Worlds');
  await page.setViewportSize({ width: 390, height: 1000 });
  await expect(page.locator('.flight-touch')).toBeVisible();
  await page.locator('.flight-touch').scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  const points = [];
  for (const [id, name] of ['left', 'right'].entries()) {
    const box = (await page.locator(`[data-stick=${name}]`).boundingBox())!;
    points.push({ id, x: box.x + box.width * 0.8, y: box.y + box.height * 0.2 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...points] });
  }
  await page.waitForTimeout(100);
  const s = await stats(page);
  expect(s.input.throttle).toBeGreaterThan(0.7);
  expect(s.input.yaw).toBeGreaterThan(0.5);
  expect(s.input.roll).toBeGreaterThan(0.5);
  expect(s.input.pitch).toBeLessThan(-0.5);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await page.waitForTimeout(50);
  const released = await stats(page);
  expect(released.input.roll).toBe(0);
  expect(released.input.yaw).toBe(0);
  expect(released.input.throttle).toBe(s.input.throttle);
  await page.locator('#flight-reset').click();
  await page.screenshot({ path: 'artifacts/airplane-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('.level-nav a[aria-current=page]')).toContainText('Modellflug');
});
