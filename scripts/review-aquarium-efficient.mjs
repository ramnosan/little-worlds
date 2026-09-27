import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const output = process.argv[2] ?? 'artifacts/aquarium-efficient';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || /GL_INVALID/.test(m.text())) errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5174/?level=aquarium');
  const wait = (mode) =>
    page.waitForFunction(
      (mode) => {
        const d = window.__aquariumDebug?.();
        return (
          d?.rendering.activeMode === mode &&
          d.koi.status === 'ready' &&
          d.koi.quality === (mode === 'high' ? 'high' : 'low')
        );
      },
      mode,
      { timeout: 90000 },
    );
  await wait('high');
  const hardware = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
  const measure = async () => {
    await page.waitForTimeout(1200);
    const a = await page.evaluate(() => ({ wall: performance.now(), ...window.__aquariumDebug() }));
    await page.waitForTimeout(4000);
    const b = await page.evaluate(() => ({ wall: performance.now(), ...window.__aquariumDebug() }));
    // World time in the snapshot is simulation seconds; use a separate wall-clock measurement.
    const seconds = (b.wall - a.wall) / 1000;
    const frames = b.rendering.frames - a.rendering.frames;
    const gpuSamples = b.rendering.gpu.samples - a.rendering.gpu.samples;
    return {
      fps: frames / seconds,
      frames,
      cpuMsPerFrame: (b.rendering.cpuTotalMs - a.rendering.cpuTotalMs) / frames,
      gpuMsPerFrame: gpuSamples
        ? (b.rendering.gpu.totalMs - a.rendering.gpu.totalMs) / gpuSamples
        : null,
      gpuMsPerSecond: gpuSamples
        ? (b.rendering.gpu.totalMs - a.rendering.gpu.totalMs) / seconds
        : null,
      rendering: b.rendering,
      geometries: b.geometries,
      textures: b.textures,
      drawCalls: b.drawCalls,
    };
  };
  await mkdir(output, { recursive: true });
  const measurements = {};
  for (const mode of ['high', 'efficient']) {
    if (mode === 'efficient') {
      await page.locator('#aq-quality').click();
      await wait(mode);
    }
    for (const [phase, minutes] of [
      ['noon', 720],
      ['sunset', 1065],
      ['night', 1320],
    ]) {
      await page.locator('#aq-reset').click();
      await page.locator('#aq-pause').click();
      await page.locator('#aq-time').fill(String(minutes));
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${output}/${mode}-${phase}-oblique.png` });
      const box = await page.locator('canvas').boundingBox(),
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      for (const [angle, dx, dy] of [
        ['overhead', 0, 150],
        ['shallow', 80, -235],
      ]) {
        await page.mouse.move(x, y);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(x + dx, y + dy, { steps: 12 });
        await page.mouse.up({ button: 'right' });
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `${output}/${mode}-${phase}-${angle}.png`,
        });
      }
    }
    await page.locator('#aq-reset').click();
    await page.locator('#aq-time').fill('1320');
    await page.locator('#aq-strength').fill('100');
    for (let i = 0; i < 6; i++) await page.locator('#aq-ball').click();
    measurements[mode] = await measure();
    await page.screenshot({ path: `${output}/${mode}-stress.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  measurements.mobileViewport = await measure();
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  const report = { hardware, measurements, errors };
  await writeFile(`${output}/review.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) throw new Error('Browser errors during visual review');
} finally {
  await browser.close();
}
