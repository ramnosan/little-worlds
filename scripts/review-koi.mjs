import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Local development review of the installed assets, using the installed Chrome browser.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { asset: '7PLUS supplied morph koi', desktop: null, mobileEmulation: null };
async function benchmark(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let last;
        function tick(now) {
          if (last !== undefined) samples.push(now - last);
          last = now;
          if (samples.length < 360) requestAnimationFrame(tick);
          else {
            const ordered = [...samples].sort((a, b) => a - b);
            resolve({
              fps: 1000 / (samples.reduce((a, b) => a + b, 0) / samples.length),
              p95ms: ordered[Math.floor(samples.length * 0.95)],
            });
          }
        }
        requestAnimationFrame(tick);
      }),
  );
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5174/?level=aquarium');
  await page.waitForFunction(() => window.__aquariumDebug?.().koi.count === 2);
  await page.evaluate(() => {
    const stream = document.querySelector('canvas').captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    window.stopReviewRecording = () =>
      new Promise((resolve) => {
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
        };
        recorder.stop();
      });
    recorder.start();
  });
  report.desktop = await benchmark(page);
  await page.screenshot({ path: 'artifacts/koi-provided-oblique.png' });
  const box = await page.locator('canvas').boundingBox(),
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/koi-provided-close.png' });
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x, y + 170, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/koi-provided-overhead.png' });
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 120, y - 300, { steps: 30 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/koi-provided-side.png' });
  const video = await page.evaluate(() => window.stopReviewRecording());
  await writeFile('artifacts/koi-provided-motion.webm', Buffer.from(video));
  if (errors.length) throw new Error(errors.join('\n'));
  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  await mobile.goto('http://127.0.0.1:5174/?level=aquarium');
  await mobile.waitForFunction(() => window.__aquariumDebug?.().koi.count === 2);
  await mobile.locator('#aq-quality').click();
  await mobile.waitForFunction(() => window.__aquariumDebug().koi.quality === 'low');
  report.mobileEmulation = await benchmark(mobile);
  await mobile.screenshot({ path: 'artifacts/koi-provided-mobile.png', fullPage: true });
  await writeFile('artifacts/koi-provided-performance.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
