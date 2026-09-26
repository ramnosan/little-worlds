import { test, expect } from '@playwright/test';

test('clicking either visible fusion lobe bursts its single connected bubble', async ({ page }) => {
  for (const side of [-1, 1]) {
    await page.goto('/?level=bubbles&bubbleFixture=fusion');
    await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().fusions.length)).toBe(1);
    const state = await page.evaluate(() => window.__bubbleDebug());
    const point = state.bubbles[0].screen;
    await page.locator('#bubble-pause').click();
    await page.mouse.click(point.x + side * 55, point.y);
    await expect.poll(() => page.evaluate(() => window.__bubbleDebug().bubbles.length)).toBe(0);
    expect((await page.evaluate(() => window.__bubbleDebug())).fusions).toHaveLength(0);
  }
});

test('a dart hits the connected fusion surface without leaving a source lobe behind', async ({
  page,
}) => {
  await page.goto('/?level=bubbles&bubbleFixture=fusion');
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().fusions.length)).toBe(1);
  await page.locator('#bubble-darts').click();
  const point = (await page.evaluate(() => window.__bubbleDebug())).bubbles[0].screen;
  await page.locator('#bubble-pause').click();
  await page.mouse.click(point.x + 45, point.y);
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().dartHits)).toBe(1);
  const state = await page.evaluate(() => window.__bubbleDebug());
  expect(state.bubbles).toHaveLength(0);
  expect(state.fusions).toHaveLength(0);
  expect(state.created).toBe(0);
});

for (const mobile of [false, true]) {
  test(`stretch phases and slow playback (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const phases = [
      [0.1333333333, 'opening'],
      [0.15, 'neck'],
      [0.1666666667, 'neck'],
      [0.45, 'pulling'],
      [0.8, 'pulling'],
      [1.15, 'settling'],
      [1.3333333333, 'settling'],
      [1.35, undefined],
    ] as const;
    for (const [progress, phase] of phases) {
      await page.goto(`/?level=bubbles&bubbleFixture=fusion&bubbleProgress=${progress}`);
      await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().paused)).toBe(true);
      const state = await page.evaluate(() => window.__bubbleDebug());
      expect(state.fusions[0]?.visualPhase).toBe(phase);
      expect(state.created).toBe(0);
      await page.screenshot({
        path: `artifacts/stretch-${progress}-${mobile ? 'mobile' : 'desktop'}.png`,
      });
    }
    await page.goto('/?level=bubbles&bubbleFixture=cluster&bubbleProgress=0.15&bubbleSlow=1');
    await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().paused)).toBe(true);
    await page.locator('#bubble-pause').click();
    await expect
      .poll(() => page.evaluate(() => window.__bubbleDebug().fusions[0]?.visualPhase), {
        timeout: 15000,
      })
      .toBe('pulling');
    await page.locator('#bubble-pause').click();
    const cluster = await page.evaluate(() => window.__bubbleDebug());
    expect(cluster.fusionMotion.maxStepCorrectionRatio).toBeLessThanOrEqual(0.02000001);
    expect(cluster.sharedFilms.length).toBeGreaterThan(0);
    await page.screenshot({
      path: `artifacts/stretch-cluster-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    await page.locator('#bubble-pause').click();
    await expect
      .poll(() => page.evaluate(() => window.__bubbleDebug().fusions.length), { timeout: 15000 })
      .toBe(0);
    expect(errors).toEqual([]);
  });

  test(`shared films, fusion and local impact screenshots (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    for (const scene of ['pair', 'cluster', 'opening', 'fusion', 'settled', 'impact']) {
      await page.goto(`/?level=bubbles&bubbleFixture=${scene}`);
      await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().paused)).toBe(true);
      const state = await page.evaluate(() => window.__bubbleDebug());
      if (scene === 'pair') {
        expect(state.sharedFilms).toHaveLength(1);
        expect(state.bubbles).toHaveLength(2);
      }
      if (scene === 'cluster') {
        expect(state.sharedFilms.length).toBeGreaterThanOrEqual(3);
        expect(state.bubbles).toHaveLength(4);
      }
      if (scene === 'opening') {
        expect(state.fusions[0].phase).toBe('opening');
        expect(state.bubbles).toHaveLength(2);
        expect(state.sharedFilms[0].opening).toBeGreaterThan(0);
      }
      if (scene === 'fusion') {
        expect(state.fusions[0].phase).toBe('relaxing');
        expect(state.bubbles).toHaveLength(1);
        expect(state.sharedFilms).toHaveLength(0);
      }
      if (scene === 'settled') {
        expect(state.bubbles).toHaveLength(1);
        expect(state.fusions).toHaveLength(0);
      }
      if (scene === 'impact') {
        expect(state.dartHits).toBe(1);
        expect(state.bubbles).toHaveLength(3);
        expect(state.sharedFilms.length).toBeGreaterThan(0);
      }
      await page.screenshot({
        path: `artifacts/foam-${scene}-${mobile ? 'mobile' : 'desktop'}.png`,
      });
      const after = await page.evaluate(() => window.__bubbleDebug());
      expect(after.fusions).toEqual(state.fusions);
      expect(after.bubbles).toEqual(state.bubbles);
      expect(after.created).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        mobile ? 390 : 1440,
      );
    }
    expect(errors).toEqual([]);
  });
}

test('fusion resumes smoothly, picking uses the visible surface and reset/quality keep resources bounded', async ({
  page,
}) => {
  await page.goto('/?level=bubbles&bubbleFixture=fusion');
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug?.().fusions.length)).toBe(1);
  const initial = await page.evaluate(() => window.__bubbleDebug());
  await page.locator('#bubble-pause').click();
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().fusions.length)).toBe(0);
  await page.locator('#bubble-pause').click();
  expect((await page.evaluate(() => window.__bubbleDebug())).bubbles).toHaveLength(1);
  await page.locator('#bubble-pause').click();
  const screen = (await page.evaluate(() => window.__bubbleDebug())).bubbles[0].screen;
  await page.mouse.click(screen.x, screen.y);
  await expect.poll(() => page.evaluate(() => window.__bubbleDebug().bubbles.length)).toBe(0);
  for (let i = 0; i < 3; i++) {
    await page.locator('#bubble-reset').click();
    await page.locator('#bubble-quality').click();
    const state = await page.evaluate(() => window.__bubbleDebug());
    expect(state.fusions).toHaveLength(0);
    expect(state.fusionResources.queued).toHaveLength(0);
    expect(state.fusionResources.limit).toBe(1);
    expect(state.memory.geometries).toBeLessThanOrEqual(initial.memory.geometries + 2);
    expect(state.memory.textures).toBe(initial.memory.textures);
  }
  await page.goto('/?level=bubbles&bubbleFixture=fusion&bubbleQuality=light');
  await expect
    .poll(() => page.evaluate(() => window.__bubbleDebug?.().fusionResources.resolution))
    .toBe(24);
  const light = await page.evaluate(() => window.__bubbleDebug());
  expect(light.fusions[0].phase).toBe('relaxing');
  await page.screenshot({ path: 'artifacts/foam-fusion-light.png' });
});
