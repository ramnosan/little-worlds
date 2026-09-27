import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Ad-hoc visual inspection companion; the regression tests are in tests/browser.
await mkdir('artifacts/melon', { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') console.log('CONSOLE ERROR:', e.text());
  });
  await page.goto('http://127.0.0.1:5173/melon-jelly.html');
  await page.waitForFunction(
    () => window.melonDiagnostics?.().running || !document.getElementById('error').hidden,
  );
  console.log(await page.locator('#status').innerText());
  console.log(await page.locator('#error-detail').textContent());
  if (await page.locator('#error').isHidden()) {
    await page.waitForFunction(() => window.melonDiagnostics().steps > 180);
    console.log(
      await page.evaluate(() => {
        const d = window.melonDiagnostics();
        delete d.project;
        return d;
      }),
    );
    console.log(
      'Animation-frame cadence (headless Chrome, this machine only)',
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const intervals = [];
            let previous = 0;
            const sample = (time) => {
              if (previous) intervals.push(time - previous);
              previous = time;
              if (intervals.length < 120) requestAnimationFrame(sample);
              else {
                intervals.sort((a, b) => a - b);
                resolve({ medianMs: intervals[60], p95Ms: intervals[114] });
              }
            };
            requestAnimationFrame(sample);
          }),
      ),
    );
  }
  await page.screenshot({ path: 'artifacts/melon/desktop.png', fullPage: true });
} finally {
  await browser.close();
}
