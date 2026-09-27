import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /GL_INVALID|GL_OUT_OF_MEMORY/.test(m.text())) errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5174/?level=aquarium');
  await page.waitForFunction(
    () =>
      window.__aquariumDebug?.().koi.status === 'ready' &&
      window.__aquariumDebug?.().rendering.ready,
    undefined,
    { timeout: 60000 },
  );
  await page.waitForTimeout(500);
  await mkdir('artifacts/aquarium-optics', { recursive: true });
  for (const [name, minutes] of [
    ['day', 720],
    ['sunset', 1065],
    ['night', 1320],
  ]) {
    await page.locator('#aq-reset').click();
    await page.locator('#aq-pause').click();
    await page.locator('#aq-time').fill(String(minutes));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `artifacts/aquarium-optics/${name}.png` });
    const box = await page.locator('canvas').boundingBox();
    const x = box.x + box.width * 0.5,
      y = box.y + box.height * 0.5;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x, y + 150, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `artifacts/aquarium-optics/${name}-overhead.png` });
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 80, y - 235, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `artifacts/aquarium-optics/${name}-shallow.png` });
  }
  await page.locator('#aq-reset').click();
  const hardware = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  const measure = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const times = [];
          const startFrame = window.__aquariumDebug().rendering.frames;
          let previous;
          function frame(now) {
            if (previous !== undefined) times.push(now - previous);
            previous = now;
            if (times.length < 180) requestAnimationFrame(frame);
            else {
              const sorted = [...times].sort((a, b) => a - b);
              resolve({
                fps: 1000 / (times.reduce((a, b) => a + b) / times.length),
                p95ms: sorted[Math.floor(times.length * 0.95)],
                opticalFrames: window.__aquariumDebug().rendering.frames - startFrame,
                resources: (() => {
                  const d = window.__aquariumDebug();
                  return {
                    geometries: d.geometries,
                    textures: d.textures,
                    drawCalls: d.drawCalls,
                    rendering: d.rendering,
                  };
                })(),
              });
            }
          }
          requestAnimationFrame(frame);
        }),
    );
  await page.waitForTimeout(500);
  const high = await measure();
  await page.locator('#aq-strength').fill('100');
  for (let i = 0; i < 6; i++) await page.locator('#aq-ball').click();
  await page.locator('#aq-time').fill('1320');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/aquarium-optics/night-six-balls.png' });
  const highSixBalls = await measure();
  await page.locator('#aq-quality').click();
  await page.waitForFunction(() => window.__aquariumDebug().koi.quality === 'low');
  const light = await measure();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#aq-time').fill('1320');
  await page.waitForTimeout(350);
  const mobileViewport = await measure();
  await page.screenshot({ path: 'artifacts/aquarium-optics/mobile-night.png', fullPage: true });
  const snapshot = await page.evaluate(() => {
    const d = window.__aquariumDebug();
    return {
      lighting: d.lighting,
      rendering: d.rendering,
      geometries: d.geometries,
      textures: d.textures,
      drawCalls: d.drawCalls,
    };
  });
  const report = { hardware, high, highSixBalls, light, mobileViewport, snapshot, errors };
  console.log(JSON.stringify(report, null, 2));
  await writeFile('artifacts/aquarium-optics/review.json', JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('Browser errors during aquarium optical review');
} finally {
  await browser.close();
}
