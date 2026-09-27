import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    waterlineFixture: {
      configure(axis: 'front' | 'side', low: boolean, phase?: number): Promise<void>;
      frame(distance: number): number;
      dispose(): void;
    };
  }
}

for (const phase of [0.5, 0.92])
  test(`a koi appears progressively across the top/side boundary in both quality modes at ${phase}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' || /GL_INVALID|GL_OUT_OF_MEMORY/.test(m.text()))
        errors.push(m.text());
    });
    await page.setViewportSize({ width: 1000, height: 750 });
    await page.goto('/tests/fixtures/koi-waterline.html');
    await page.waitForFunction(() => window.waterlineFixture);
    for (const low of [false, true]) {
      for (const axis of ['front', 'side'] as const) {
        await page.evaluate(
          ({ axis, low, phase }) => window.waterlineFixture.configure(axis, low, phase),
          {
            axis,
            low,
            phase,
          },
        );
        // Compare final rendered pixels with an identical frame containing no fish.
        // Sample only the top face, using the ray hit mask to exclude cast shadows.
        const coverage = await page.evaluate(() =>
          Array.from({ length: 100 }, (_, i) => window.waterlineFixture.frame(i * 0.02)),
        );
        const peak = Math.max(...coverage);
        const largestChange = Math.max(
          ...coverage.slice(1).map((n, i) => Math.abs(n - coverage[i])),
        );
        const partialFrames = coverage.filter((n) => n > peak * 0.1 && n < peak * 0.7).length;
        console.log(JSON.stringify({ axis, low, peak, largestChange, partialFrames }));
        expect(peak).toBeGreaterThan(35);
        expect(coverage[0]).toBeLessThan(peak * 0.1);
        expect(partialFrames).toBeGreaterThan(5);
        expect(largestChange / peak).toBeLessThan(0.35);
        if (!low) {
          for (const [label, distance] of [
            ['entering', 0.4],
            ['partial', 0.8],
            ['visible', 1.6],
          ] as const) {
            await page.evaluate((distance) => window.waterlineFixture.frame(distance), distance);
            await page.screenshot({
              path: `artifacts/koi-waterline-${phase}-${axis}-${label}.png`,
            });
          }
        }
      }
    }
    await page.evaluate(() => window.waterlineFixture.dispose());
    expect(errors).toEqual([]);
  });
