import { test, expect } from '@playwright/test';

const snapshot = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__aquariumDebug());
test('efficient graphics persist, cap rendering, freeze while paused and release tracing resources', async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /GL_INVALID/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/?level=aquarium');
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: High quality');
  await page.waitForFunction(
    () => (window as any).__aquariumDebug?.().rendering.activeMode === 'high',
    undefined,
    { timeout: 60000 },
  );
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await page.locator('#aq-pause').click();
  const before = await snapshot(page);
  await page.locator('#aq-quality').click();
  await expect.poll(async () => (await snapshot(page)).koi.quality).toBe('low');
  const efficient = await snapshot(page);
  expect(efficient.time).toBe(before.time);
  expect(efficient.camera).toEqual(before.camera);
  expect(efficient.koi.animationTimes).toEqual(before.koi.animationTimes);
  expect(efficient.rendering.activeMode).toBe('efficient');
  expect(efficient.rendering.bvh).toBe(false);
  expect(efficient.rendering.passes).not.toContain('tank-optics');
  await page.waitForTimeout(200);
  const frozen = await snapshot(page);
  await page.waitForTimeout(350);
  expect((await snapshot(page)).rendering.frames).toBe(frozen.rendering.frames);
  await page.locator('#aq-time').fill('1320');
  await expect
    .poll(async () => (await snapshot(page)).rendering.frames)
    .toBeGreaterThan(frozen.rendering.frames);
  await page.locator('#aq-pause').click();
  const start = await snapshot(page);
  await page.waitForTimeout(2000);
  const end = await snapshot(page);
  expect(end.rendering.frames - start.rendering.frames).toBeGreaterThan(45);
  expect(end.rendering.frames - start.rendering.frames).toBeLessThan(68);
  expect(end.time).toBeGreaterThan(start.time + 1.5);
  await page.locator('#aq-reset').click();
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: Efficient');
  await page.reload();
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: Efficient');
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await page.locator('#aq-pause').click();
  for (let i = 0; i < 3; i++) {
    await page.locator('#aq-quality').click();
    await page.locator('#aq-quality').click();
  }
  await expect.poll(async () => (await snapshot(page)).koi.quality).toBe('low');
  await page.waitForTimeout(300);
  const settled = await snapshot(page);
  for (let i = 0; i < 3; i++) await page.locator('#aq-reset').click();
  expect((await snapshot(page)).textures).toBe(settled.textures);
  expect((await snapshot(page)).rendering.bvh).toBe(false);
  expect(errors).toEqual([]);
});

test('efficient controls work with blocked storage and hidden time never catches up', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/?level=aquarium');
  await page.locator('#aq-quality').click();
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: Efficient');
  await expect.poll(async () => (await snapshot(page)).koi.quality).toBe('low');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await snapshot(page);
  await page.waitForTimeout(750);
  const later = await snapshot(page);
  expect(later.time).toBe(hidden.time);
  expect(later.lighting.phase).toBe(hidden.lighting.phase);
  expect(later.rendering.frames).toBe(hidden.rendering.frames);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  const resumed = await snapshot(page);
  expect(resumed.time - hidden.time).toBeLessThan(0.4);
  expect(resumed.rendering.frames).toBeGreaterThan(hidden.rendering.frames);
  await page.locator('#aq-reset').click();
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: Efficient');
  await page.locator('#aq-quality').click();
  await expect(page.locator('#aq-quality')).toHaveText('Graphics: High quality');
});
