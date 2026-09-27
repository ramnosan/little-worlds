import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.PLANT_TEST_URL || 'http://127.0.0.1:5173';
await mkdir('artifacts/iris-review', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/?level=plant');
    await page.waitForFunction(() => !!window.__plantTest);
    await page.evaluate(() => {
      window.__plantTest.reset();
      for (let i = 0; i < 12; i++) window.__plantTest.plant(-5.3 + i * 0.95);
      window.__plantTest.advance(105);
    });
    await page.getByRole('button', { name: '20×', exact: true }).click();
    await page.locator('#plant-pause').click();
    const timing = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const frames = [],
            calls = [];
          let previous = performance.now();
          const start = previous;
          const sample = (now) => {
            frames.push(now - previous);
            calls.push(window.__plantTest.stats().drawCalls);
            previous = now;
            if (now - start < 6500) requestAnimationFrame(sample);
            else {
              frames.sort((a, b) => a - b);
              calls.sort((a, b) => a - b);
              resolve({
                growingDrawCallsMedian: calls[Math.floor(calls.length * 0.5)],
                growingDrawCallsMax: Math.max(...calls),
                frames: frames.length,
                meanMs: frames.reduce((a, b) => a + b, 0) / frames.length,
                p50Ms: frames[Math.floor(frames.length * 0.5)],
                p95Ms: frames[Math.floor(frames.length * 0.95)],
                maxMs: frames.at(-1),
              });
            }
          };
          requestAnimationFrame(sample);
        }),
    );
    await page.evaluate(() => window.__plantTest.advance(200));
    const stats = await page.evaluate(() => {
      const s = window.__plantDebug();
      return {
        drawCalls: s.drawCalls,
        triangles: s.triangles,
        geometries: s.geometries,
        textures: s.textures,
        plants: s.plants.length,
        stages: s.plants.map((p) => p.stage),
        rootPaths: s.plants.reduce((n, p) => n + p.roots.length, 0),
        rootPoints: s.plants.reduce(
          (n, p) => n + p.roots.reduce((m, r) => m + r.points.length, 0),
          0,
        ),
        devicePixelRatio,
      };
    });
    await page.screenshot({ path: 'artifacts/iris-review/full-' + width + '.png', fullPage: true });
    await page.evaluate(() => {
      window.__plantTest.reset();
      window.__plantTest.plant(-4.2);
      window.__plantTest.advance(70);
      window.__plantTest.plant(-1.4);
      window.__plantTest.advance(40);
      window.__plantTest.plant(1.4);
      window.__plantTest.advance(30);
      window.__plantTest.plant(4.2);
      window.__plantTest.advance(70);
    });
    await page.screenshot({
      path: 'artifacts/iris-review/staggered-' + width + '.png',
      fullPage: true,
    });
    if (errors.length) throw Error(errors.join('\n'));
    const result = { width, browser: browser.version(), ...timing, ...stats };
    results.push(result);
    console.log(JSON.stringify(result));
    await page.close();
  }
  await writeFile(
    'artifacts/iris-review/performance.json',
    JSON.stringify(results, null, 2) + '\n',
  );
} finally {
  await browser.close();
}
