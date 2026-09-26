import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    waterlineFixture: {
      configure(axis: 'front' | 'side', low: boolean): Promise<void>;
      frame(distance: number): number;
      dispose(): void;
    };
  }
}

test('a koi appears progressively across the top/side boundary in both quality modes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1000, height: 750 });
  await page.goto('/tests/fixtures/koi-waterline.html');
  await page.waitForFunction(() => window.waterlineFixture);
  for (const low of [false, true]) {
    for (const axis of ['front', 'side'] as const) {
      await page.evaluate(({ axis, low }) => window.waterlineFixture.configure(axis, low), {
        axis,
        low,
      });
      // Compare final rendered pixels with an identical frame containing no fish.
      // Sample only the water's top face, excluding the directly visible side.
      const coverage = await page.evaluate(() =>
        Array.from({ length: 66 }, (_, i) => window.waterlineFixture.frame(i * 0.02)),
      );
      const peak = Math.max(...coverage);
      const largestChange = Math.max(...coverage.slice(1).map((n, i) => Math.abs(n - coverage[i])));
      const partialFrames = coverage.filter((n) => n > peak * 0.1 && n < peak * 0.7).length;
      console.log(JSON.stringify({ axis, low, peak, largestChange, partialFrames }));
      expect(peak).toBeGreaterThan(35);
      expect(coverage[0]).toBeLessThan(peak * 0.1);
      expect(partialFrames).toBeGreaterThan(5);
      expect(largestChange / peak).toBeLessThan(0.35);
      if (!low) {
        for (const [label, distance] of [
          ['entering', 0.2],
          ['partial', 0.4],
          ['visible', 0.8],
        ] as const) {
          await page.evaluate((distance) => window.waterlineFixture.frame(distance), distance);
          await page.screenshot({ path: `artifacts/koi-waterline-${axis}-${label}.png` });
        }
      }
    }
  }
  await page.evaluate(() => window.waterlineFixture.dispose());
  expect(errors).toEqual([]);
});
