import { test, expect, type Page } from '@playwright/test';
import { koiFixtureGlb } from '../fixtures/koi-glb';
import { writeFile } from 'node:fs/promises';

type Debug = {
  time: number;
  geometries: number;
  textures: number;
  koi: {
    status: string;
    count: number;
    quality: string;
    animationTimes: number[];
    skeletons: number[];
    morphs: { targets: number; active: number[] }[][];
    fish: { x: number; y: number; z: number; heading: number; animationTime: number }[];
  };
};
const debug = (p: Page) =>
  p.evaluate(() => (window as unknown as { __aquariumDebug: () => Debug }).__aquariumDebug());
const varieties = ['showa', 'tancho'];
const waitForOptics = (page: Page) =>
  page.waitForFunction(
    () =>
      (
        window as unknown as { __aquariumDebug: () => { rendering: { ready: boolean } } }
      ).__aquariumDebug?.().rendering.ready,
    undefined,
    { timeout: 30_000 },
  );

test('supplied koi load once, deform independently and retain state through pause and quality changes', async ({
  page,
}) => {
  // Real GLBs can take longer than the default five seconds during a cold dev-server read.
  test.setTimeout(120_000);
  const assetExpect = expect.configure({ timeout: 15_000 });
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    if (r.url().endsWith('.glb')) requests.push(r.url());
  });
  await page.goto('/?level=aquarium');
  await assetExpect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await waitForOptics(page);
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(0.5);
  const initial = await debug(page);
  expect(initial.koi.skeletons).toEqual([0, 0]);
  expect(initial.koi.morphs.map((m) => m[0].targets)).toEqual([75, 75]);
  expect(new Set(initial.koi.morphs.map((m) => JSON.stringify(m[0].active))).size).toBe(2);
  expect(requests).toHaveLength(1);
  await page.locator('#aq-pause').click();
  const paused = await debug(page);
  await page.waitForTimeout(150);
  expect((await debug(page)).koi).toEqual(paused.koi);
  await page.locator('#aq-quality').click();
  await assetExpect.poll(async () => (await debug(page)).koi.quality).toBe('low');
  const low = await debug(page);
  expect(low.koi.morphs.map((m) => m[0].targets)).toEqual([25, 25]);
  expect(low.koi.animationTimes).toEqual(paused.koi.animationTimes);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('#aq-quality').click();
    await assetExpect.poll(async () => (await debug(page)).koi.quality).toBe('high');
    await page.locator('#aq-quality').click();
    await assetExpect.poll(async () => (await debug(page)).koi.quality).toBe('low');
  }
  expect((await debug(page)).textures).toBe(low.textures);
  expect((await debug(page)).geometries).toBe(low.geometries);
  await page.locator('#aq-quality').click();
  await assetExpect.poll(async () => (await debug(page)).koi.quality).toBe('high');
  const requestCount = requests.length;
  const settled = await debug(page);
  for (let i = 0; i < 3; i++) await page.locator('#aq-reset').click();
  expect(requests).toHaveLength(requestCount);
  // The temporary raster warmup can allocate a morph texture that optics no longer needs.
  // Repeated low/high cycles above must still have exactly stable resource counts.
  expect(settled.textures).toBeLessThanOrEqual(initial.textures);
  expect(settled.geometries).toBeLessThanOrEqual(initial.geometries);
  expect((await debug(page)).textures).toBe(settled.textures);
  expect((await debug(page)).geometries).toBe(settled.geometries);
  expect((await debug(page)).koi.count).toBe(2);
  await expect(page.locator('.aq-footer a')).toHaveAttribute('href', './models/koi/credits.html');
  expect(errors).toEqual([]);
});
async function fixtures(page: Page) {
  await page.route('**/models/koi/manifest.json', (route) =>
    route.fulfill({
      json: {
        version: 1,
        assets: varieties.map((variety) => ({
          variety,
          high: `./test-${variety}.glb`,
          low: `./test-${variety}-low.glb`,
          swimClip: 'Swim',
        })),
      },
    }),
  );
  await page.route('**/models/koi/*.glb', (route) => {
    const url = route.request().url();
    const color: [number, number, number] = url.includes('showa')
      ? [0.95, 0.2, 0.08]
      : url.includes('tancho')
        ? [0.9, 0.9, 0.82]
        : [0.5, 0.24, 0.08];
    return route.fulfill({
      contentType: 'model/gltf-binary',
      body: koiFixtureGlb(color, url.includes('-low')),
    });
  });
}
test('missing production assets are reported honestly and water controls still work', async ({
  page,
}) => {
  await page.route('**/models/koi/manifest.json', (route) =>
    route.fulfill({ json: { version: 1, assets: [] } }),
  );
  await page.goto('/?level=aquarium');
  await expect(page.locator('#aq-koi-status')).toHaveText('Koi unavailable');
  expect((await debug(page)).koi.count).toBe(0);
  await page.locator('#aq-koi-retry').click();
  await expect(page.locator('#aq-koi-retry')).toBeVisible();
  await page.locator('#aq-ball').click();
  await expect(page.locator('#aq-count')).toHaveText('1 / 6 floating ball');
});
test('synthetic rigs animate independently, pause, reset and switch quality without leaks', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await fixtures(page);
  await page.goto('/?level=aquarium');
  await waitForOptics(page);
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(0.4);
  const first = await debug(page);
  expect(first.koi.skeletons).toEqual([1, 1]);
  expect(new Set(first.koi.animationTimes).size).toBe(2);
  await page.screenshot({ path: 'artifacts/koi-synthetic-oblique.png' });
  await page.locator('#aq-pause').click();
  const frozen = await debug(page);
  await page.waitForTimeout(200);
  expect((await debug(page)).koi.animationTimes).toEqual(frozen.koi.animationTimes);
  expect((await debug(page)).koi.fish).toEqual(frozen.koi.fish);
  await page.locator('#aq-quality').click();
  await expect.poll(async () => (await debug(page)).koi.quality).toBe('low');
  expect((await debug(page)).koi.animationTimes).toEqual(frozen.koi.animationTimes);
  await page.locator('#aq-quality').click();
  await expect.poll(async () => (await debug(page)).koi.quality).toBe('high');
  const settled = await debug(page);
  expect(settled.geometries).toBeLessThanOrEqual(first.geometries);
  expect(settled.textures).toBeLessThanOrEqual(first.textures);
  for (let i = 0; i < 3; i++) await page.locator('#aq-reset').click();
  await expect.poll(async () => (await debug(page)).geometries).toBe(settled.geometries);
  expect((await debug(page)).textures).toBe(settled.textures);
  expect((await debug(page)).koi.count).toBe(2);
  expect(errors).toEqual([]);
});
test('failed GLB can be retried and rapid quality changes do not install stale rigs', async ({
  page,
}) => {
  await fixtures(page);
  let failed = true;
  await page.route('**/models/koi/test-showa.glb', (route) =>
    failed
      ? route.fulfill({ contentType: 'model/gltf-binary', body: 'invalid glb' })
      : route.fallback(),
  );
  await page.goto('/?level=aquarium');
  await expect(page.locator('#aq-koi-retry')).toBeVisible();
  expect((await debug(page)).koi.status).toBe('error');
  failed = false;
  await page.locator('#aq-koi-retry').click();
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await page.locator('#aq-quality').click();
  await page.locator('#aq-quality').click();
  await expect.poll(async () => (await debug(page)).koi.quality).toBe('high');
  expect((await debug(page)).koi.count).toBe(2);
});
test('synthetic rig mobile rendering and measured frame times', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await fixtures(page);
  await page.goto('http://127.0.0.1:5173/?level=aquarium');
  await waitForOptics(page);
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  await page.locator('#aq-quality').click();
  await expect.poll(async () => (await debug(page)).koi.quality).toBe('low');
  await page.locator('#aquarium-world').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/koi-synthetic-mobile.png', fullPage: true });
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0,
          start = 0;
        function frame(now: number) {
          if (!start) start = now;
          if (++count >= 121) resolve(((count - 1) * 1000) / (now - start));
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
  );
  console.log('Emulated mobile, SYNTHETIC assets, light graphics FPS:', fps.toFixed(1));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test('record synthetic animation and inspect refraction from three camera angles', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await fixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5173/?level=aquarium');
  await expect(page.locator('#aq-koi-status')).toHaveText('2 koi');
  // Record the WebGL canvas with Chrome's own encoder; no external ffmpeg install.
  await page.evaluate(() => {
    const stream = document.querySelector('canvas')!.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }),
      chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    Object.assign(window, {
      __stopKoiTestRecording: () =>
        new Promise<number[]>((resolve) => {
          recorder.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            void new Blob(chunks)
              .arrayBuffer()
              .then((buffer) => resolve(Array.from(new Uint8Array(buffer))));
          };
          recorder.stop();
        }),
    });
    recorder.start();
  });
  const fps = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0,
          start = 0;
        function frame(now: number) {
          if (!start) start = now;
          if (++count >= 241) resolve(((count - 1) * 1000) / (now - start));
          else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }),
  );
  console.log('Desktop 1440x1000, SYNTHETIC assets, normal graphics FPS:', fps.toFixed(1));
  await page.screenshot({ path: 'artifacts/koi-synthetic-oblique.png' });
  const box = (await page.locator('#aquarium-world canvas').boundingBox())!,
    x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x, y + 170, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await page.screenshot({ path: 'artifacts/koi-synthetic-overhead.png' });
  await page.locator('#aq-reset').click();
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 110, y - 170, { steps: 24 });
  await page.mouse.up({ button: 'right' });
  await page.screenshot({ path: 'artifacts/koi-synthetic-side.png' });
  const video = await page.evaluate(() =>
    (
      window as unknown as { __stopKoiTestRecording: () => Promise<number[]> }
    ).__stopKoiTestRecording(),
  );
  await writeFile('artifacts/koi-synthetic-motion.webm', Buffer.from(video));
  expect(errors).toEqual([]);
  await context.close();
});
