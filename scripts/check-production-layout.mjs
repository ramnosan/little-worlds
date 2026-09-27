import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

// Test the built site: the dev server does not exercise CSS preloading for chunks.
const remoteUrl = process.env.LAYOUT_TEST_URL;
const server = remoteUrl
  ? undefined
  : await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
const baseUrl = remoteUrl || 'http://127.0.0.1:4187/little-worlds/';
const outputDir = 'artifacts/production-layout';
await mkdir(outputDir, { recursive: true });
let browser;
let failures = 0;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1440, 390]) {
    for (const level of [
      'jelly',
      'bubbles',
      'aquarium',
      'railway',
      'fire',
      'airplane',
      'plant',
      'melon',
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      });
      try {
        await page.goto(`${baseUrl}${level === 'melon' ? 'melon-jelly.html' : `?level=${level}`}`, {
          waitUntil: 'networkidle',
        });
        const canvas = page.locator('canvas');
        await canvas.waitFor({ state: 'visible' });
        const bounds = await canvas.boundingBox();
        assert.ok(
          bounds && bounds.height >= 300 && bounds.width >= 300,
          `${level}: scene collapsed to ${bounds?.width} × ${bounds?.height}`,
        );
        const layout = await page.evaluate(() => ({
          headerDisplay: getComputedStyle(document.querySelector('header')).display,
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          levels: document.querySelectorAll('nav a').length,
          activeLevels: document.querySelectorAll('nav a[aria-current="page"]').length,
        }));
        assert.equal(
          layout.headerDisplay,
          level === 'melon' ? 'flex' : 'grid',
          `${level}: header layout missing`,
        );
        assert.ok(layout.pageWidth <= layout.viewport + 1, `${level}: horizontal overflow`);
        if (level === 'melon') {
          // Native pipeline compilation is asynchronous and can outlast network idle.
          await page.waitForFunction(() =>
            /WEBGPU · (LIVE|UNAVAILABLE)/.test(
              document.querySelector('#status')?.textContent || '',
            ),
          );
          assert.match(await page.locator('#status').innerText(), /WEBGPU · LIVE/);
          assert.equal(await page.locator('a.back').count(), 1, 'Melon: missing return navigation');
          const panel = await page.locator('.panel').boundingBox();
          if (width < 760)
            assert.ok(panel.y >= bounds.y + bounds.height, 'Melon: controls overlap the scene');
        } else {
          assert.equal(layout.levels, 8, `${level}: expected eight navigation entries`);
          assert.equal(layout.activeLevels, 1, `${level}: missing active level`);
        }
        if (level === 'plant') {
          assert.ok(bounds.height >= 420, 'Iris scene must be at least 420px high');
          assert.equal(await page.locator('input[type=range]').count(), 0, 'Obsolete timeline');
        }
        assert.deepEqual(errors, [], `${level}: browser errors`);
        console.log(
          `PASS ${level} at ${width}px (${Math.round(bounds.width)} × ${Math.round(bounds.height)} scene)`,
        );
      } catch (error) {
        failures++;
        console.error(`FAIL ${level} at ${width}px: ${error.message}`);
      } finally {
        await page.screenshot({ path: `${outputDir}/${level}-${width}.png`, fullPage: true });
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
if (failures) process.exitCode = 1;
