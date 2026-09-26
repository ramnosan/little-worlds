import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function measure(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const frames = [];
        let previous;
        function frame(now) {
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          if (frames.length < 240) requestAnimationFrame(frame);
          else {
            const sorted = [...frames].sort((a, b) => a - b);
            resolve({
              fps: 1000 / (frames.reduce((a, b) => a + b) / frames.length),
              p95ms: sorted[Math.floor(sorted.length * 0.95)],
            });
          }
        }
        requestAnimationFrame(frame);
      }),
  );
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5174/?level=aquarium');
  await page.waitForFunction(() => window.__aquariumDebug?.().koi.status === 'ready');
  await page.locator('#aq-ball').click();
  await page.locator('#aq-ripple').click();
  const normal = await measure(page);
  await page.screenshot({ path: 'artifacts/reflection-oblique.png' });
  const box = await page.locator('#aquarium-world canvas').boundingBox();
  const x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x, y + 170, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/reflection-overhead.png' });
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 100, y - 245, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  await page.locator('#aq-ripple').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/reflection-side-waves.png' });
  await page.locator('#aq-quality').click();
  await page.waitForFunction(() => window.__aquariumDebug?.().koi.status === 'ready');
  const lighter = await measure(page);
  await page.screenshot({ path: 'artifacts/reflection-lighter.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#aq-reset').click();
  await page.locator('#aq-quality').click();
  await page.waitForFunction(() => window.__aquariumDebug?.().koi.status === 'ready');
  const mobileViewport = await measure(page);
  await page.screenshot({ path: 'artifacts/reflection-mobile.png' });
  const report = { normal, lighter, mobileViewport, errors };
  await writeFile('artifacts/reflection-review.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (errors.length) throw new Error('Browser errors during reflection review');
} finally {
  await browser.close();
}
