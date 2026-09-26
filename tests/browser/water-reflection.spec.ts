import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    reflectionFixture: {
      inspect(
        height: number,
        x?: number,
      ): { count: number; centerX: number; width: number; height: number };
      quality(low: boolean): void;
      dispose(): void;
    };
  }
}

test('reflection clips submerged geometry per fragment and tracks above-water objects', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/tests/fixtures/water-reflection.html');
  await page.waitForFunction(() => window.reflectionFixture);
  for (const low of [false, true, false]) {
    const result = await page.evaluate((low) => {
      const f = window.reflectionFixture;
      f.quality(low);
      return {
        submerged: f.inspect(1.1),
        crossing: f.inspect(1.65),
        above: f.inspect(2.1),
        left: f.inspect(2.1, -0.4),
        right: f.inspect(2.1, 0.4),
      };
    }, low);
    console.log(JSON.stringify({ low, ...result }));
    expect(result.submerged.count).toBe(0);
    expect(result.above.count).toBeGreaterThan(100);
    expect(result.crossing.count).toBeGreaterThan(30);
    expect(result.crossing.count).toBeLessThan(result.above.count * 0.85);
    // The reflected camera's up vector is mirrored, reversing texture-space X.
    expect(result.left.centerX - result.right.centerX).toBeGreaterThan(15);
    expect(result.above.width).toBe(low ? 400 : 650);
    expect(result.above.height).toBe(low ? 300 : 488);
  }
  await page.evaluate(() => window.reflectionFixture.dispose());
  expect(errors).toEqual([]);
});
