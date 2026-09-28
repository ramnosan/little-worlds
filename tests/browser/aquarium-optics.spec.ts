import { test, expect, type Page } from '@playwright/test';
declare global {
  interface Window {
    aquariumOpticsFixture: {
      measure(
        waves?: boolean,
        ball?: boolean,
        phase?: number,
      ): { mean: number; deviation: number; peak: number; pixels: number[] };
      pausedDifference(): number;
      beamStability(phase?: number): {
        mean: number;
        contrast: number;
        detailRms: number;
        flickerRms: number;
        pausedDifference: number;
      };
      finCoverage(): number[];
      lampAlignment(): { center: number; ring: number };
      diffuseResponse(lamp?: boolean): {
        efficient: number[][];
        high: number[][];
        sourceIndependent: number[][];
        transmission: number[];
      };
      nightContrast(): {
        finite: boolean;
        dark: number;
        bright: number;
        clipping: number;
        displayDark: number;
        displayBright: number;
      };
      snapshot(): { mode: string; volumeSlices?: number; scatteringSamples?: number };
      quality(low: boolean): void;
      light(phase: number): void;
      dispose(): void;
    };
  }
}
test('diffuse shading is normalized and caustics replace direct illumination without clipping', async ({
  page,
}) => {
  const found = errors(page);
  await page.goto('/tests/fixtures/aquarium-optics.html');
  await page.waitForFunction(() => window.aquariumOpticsFixture);
  for (const lamp of [false, true]) {
    const result = await page.evaluate(
      (lamp) => window.aquariumOpticsFixture.diffuseResponse(lamp),
      lamp,
    );
    for (const [i, power] of [0, 1, 2, 8].entries())
      for (const [channel, albedo] of [0.5, 0.3, 0.2].entries()) {
        const expected = (albedo * power) / Math.PI;
        expect(result.high[i][channel]).toBeCloseTo(expected, 2);
        expect(result.efficient[i][channel]).toBeCloseTo(
          expected * result.transmission[channel],
          2,
        );
        expect(result.sourceIndependent[i][channel]).toBeCloseTo(result.efficient[i][channel], 3);
      }
  }
  expect(found).toEqual([]);
});
test('night caustics retain dark cells, bright folds and unclipped floor detail in both modes', async ({
  page,
}) => {
  const found = errors(page);
  await page.goto('/tests/fixtures/aquarium-optics.html');
  await page.waitForFunction(() => window.aquariumOpticsFixture);
  for (const low of [false, true]) {
    await page.evaluate((low) => window.aquariumOpticsFixture.quality(low), low);
    const result = await page.evaluate(() => window.aquariumOpticsFixture.nightContrast());
    console.log(JSON.stringify({ low, ...result }));
    expect(result.finite).toBe(true);
    expect(result.dark).toBeLessThan(0.7);
    expect(result.bright).toBeGreaterThan(1.4);
    expect(result.bright / result.dark).toBeGreaterThan(3);
    expect(result.clipping).toBeLessThan(0.01);
    expect(result.displayBright / result.displayDark).toBeGreaterThan(1.5);
  }
  expect(found).toEqual([]);
});
test('underwater beams suppress small moving specks while retaining light and contrast', async ({
  page,
}) => {
  const found = errors(page);
  await page.goto('/tests/fixtures/aquarium-optics.html');
  await page.waitForFunction(() => window.aquariumOpticsFixture);
  for (const phase of [0.5, 22 / 24]) {
    const result = await page.evaluate(
      (phase) => window.aquariumOpticsFixture.beamStability(phase),
      phase,
    );
    // Twelve fixed wave frames, with history disabled and no fish/surface/floor in the ROI.
    // Before filtering: daylight detail/flicker RMS = .475/.596, night = .285/.382.
    expect(result.detailRms).toBeLessThan(0.27);
    expect(result.flickerRms).toBeLessThan(0.35);
    expect(result.mean).toBeGreaterThan(phase === 0.5 ? 70 : 32);
    expect(result.mean).toBeLessThan(phase === 0.5 ? 85 : 40);
    expect(result.contrast).toBeGreaterThan(1.5);
    expect(result.pausedDifference).toBe(0);
  }
  expect(found).toEqual([]);
});

function errors(page: Page) {
  const found: string[] = [];
  page.on('pageerror', (e) => found.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /GL_INVALID|GL_OUT_OF_MEMORY/.test(m.text())) found.push(m.text());
  });
  return found;
}
test('photon caustics follow waves, respond to object occlusion, and freeze exactly', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const found = errors(page);
  await page.goto('/tests/fixtures/aquarium-optics.html');
  await page.waitForFunction(() => window.aquariumOpticsFixture);
  const result = await page.evaluate(() => {
    const f = window.aquariumOpticsFixture;
    return {
      flat: f.measure(),
      waves: f.measure(true),
      blocked: f.measure(false, true),
      pausedDifference: f.pausedDifference(),
      high: f.snapshot(),
    };
  });
  expect(result.flat.mean).toBeGreaterThan(0.2);
  expect(result.flat.deviation / result.flat.mean).toBeLessThan(0.08);
  expect(result.waves.deviation).toBeGreaterThan(result.flat.deviation + 0.1);
  expect(
    result.blocked.pixels.filter((p, i) => p < result.flat.pixels[i] * 0.6).length,
  ).toBeGreaterThan(20);
  expect(result.pausedDifference).toBe(0);
  expect(result.high.volumeSlices).toBe(48);
  expect(result.high.scatteringSamples).toBe(96);
  const lamp = await page.evaluate(() => window.aquariumOpticsFixture.lampAlignment());
  expect(lamp.center).toBeGreaterThan(0.75);
  expect(lamp.center - lamp.ring).toBeGreaterThan(0.1);
  await page.evaluate(() => {
    window.aquariumOpticsFixture.quality(true);
    window.aquariumOpticsFixture.measure(true, true, 0.92);
  });
  expect((await page.evaluate(() => window.aquariumOpticsFixture.snapshot())).volumeSlices).toBe(0);
  const efficient = await page.evaluate(() => {
    const f = window.aquariumOpticsFixture;
    return {
      flat: f.measure(),
      waves: f.measure(true),
      blocked: f.measure(false, true),
      lamp: f.lampAlignment(),
    };
  });
  expect(efficient.flat.mean).toBeGreaterThan(0.2);
  expect(efficient.flat.deviation / efficient.flat.mean).toBeLessThan(0.08);
  expect(efficient.waves.deviation).toBeGreaterThan(efficient.flat.deviation + 0.1);
  expect(
    efficient.blocked.pixels.filter((p, i) => p < efficient.flat.pixels[i] * 0.6).length,
  ).toBeGreaterThan(20);
  expect(efficient.lamp.center).toBeGreaterThan(0.2);
  expect(efficient.lamp.center - efficient.lamp.ring).toBeGreaterThan(0.04);
  const [opaque, cutout] = await page.evaluate(() => window.aquariumOpticsFixture.finCoverage());
  expect(opaque).toBeGreaterThan(100);
  expect(cutout / opaque).toBeGreaterThan(0.4);
  expect(cutout / opaque).toBeLessThan(0.6);
  expect(found).toEqual([]);
  await page.evaluate(() => window.aquariumOpticsFixture.dispose());
});
test('clock scrubbing, manual hold, resume and reset work while paused', async ({ page }) => {
  const found = errors(page);
  await page.goto('/?level=aquarium');
  await expect(page.locator('#aq-time')).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    () => (window as any).__aquariumDebug?.().rendering.activeMode === 'high',
    undefined,
    { timeout: 60000 },
  );
  await page.locator('#aq-pause').click();
  await page.locator('#aq-time').fill('1320');
  await expect(page.locator('#aq-time-value')).toHaveText('22:00');
  await expect(page.locator('#aq-cycle')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(200);
  await expect(page.locator('#aq-time')).toHaveValue('1320');
  await page.locator('#aq-cycle').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#aq-time')).toHaveValue('1320');
  await page.locator('#aq-pause').click();
  await expect
    .poll(async () => Number(await page.locator('#aq-time').inputValue()))
    .toBeGreaterThan(1320);
  await page.locator('#aq-reset').click();
  await expect(page.locator('#aq-cycle')).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(async () => Number(await page.locator('#aq-time').inputValue()))
    .toBeLessThan(910);
  expect(found).toEqual([]);
});
test('raster capability fallback still supports night lighting and quality changes', async ({
  page,
}) => {
  const found = errors(page);
  await page.goto('/tests/fixtures/aquarium-optics.html?fallback');
  await page.waitForFunction(() => window.aquariumOpticsFixture);
  expect((await page.evaluate(() => window.aquariumOpticsFixture.snapshot())).mode).toBe(
    'raster-fallback',
  );
  await page.evaluate(() => {
    const f = window.aquariumOpticsFixture;
    f.light(0.92);
    f.quality(true);
    f.light(0.5);
    f.dispose();
  });
  expect(found).toEqual([]);
});
