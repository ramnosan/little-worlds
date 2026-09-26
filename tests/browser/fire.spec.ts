import { test, expect, type Page } from '@playwright/test';

type Snapshot = {
  time: number;
  paused: boolean;
  wind: number;
  count: number;
  fuel: number;
  intensity: number;
  glow: number;
  muted: boolean;
  light: boolean;
  hidden: boolean;
  camera: number[];
  textures: number;
  geometries: number;
  frameMs: number;
  p95FrameMs: number;
  ashCount: number;
  fireRendering: 'procedural-volume';
  animationTime: number;
  volumeSteps: number;
  sticks: { a: number[]; b: number[]; fuel: number; char: number; phase: string }[];
};
const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fireDebug: () => Snapshot }).__fireDebug());
async function openFire(page: Page, url = '/?level=fire') {
  await page.goto(url);
  await page.waitForFunction(
    () => typeof (window as unknown as { __fireDebug?: unknown }).__fireDebug === 'function',
  );
  await expect.poll(async () => (await stats(page)).fireRendering).toBe('procedural-volume');
}
function errors(page: Page) {
  const result: string[] = [];
  page.on('pageerror', (e) => result.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') result.push(m.text());
  });
  return result;
}

test('fire controls, pause, reset, shortcuts, audio and bounded GPU resources', async ({
  page,
}) => {
  const failures = errors(page);
  await openFire(page);
  await expect(page.locator('#fire-world canvas')).toBeVisible();
  await expect.poll(async () => (await stats(page)).time).toBeGreaterThan(0.2);
  await page.locator('#fire-add').click();
  expect((await stats(page)).count).toBe(10);
  await page.locator('#fire-wind').fill('80');
  expect((await stats(page)).wind).toBe(0.8);
  await page.locator('#fire-audio').click();
  await expect.poll(async () => (await stats(page)).muted).toBe(false);
  await page.locator('#fire-pause').click();
  const paused = await stats(page);
  await page.waitForTimeout(250);
  expect((await stats(page)).time).toBe(paused.time);
  expect((await stats(page)).animationTime).toBe(paused.animationTime);
  await expect(page.locator('#fire-add')).toBeDisabled();
  await expect(page.locator('#fire-ignite')).toBeDisabled();
  await page.locator('#fire-world canvas').focus();
  await page.keyboard.press('Space');
  expect((await stats(page)).paused).toBe(false);
  await page.keyboard.press('n');
  expect((await stats(page)).count).toBe(11);
  await page.locator('#fire-wind').focus();
  await page.keyboard.press('r');
  expect((await stats(page)).count).toBe(11);
  await page.locator('#fire-quality').click();
  expect((await stats(page)).light).toBe(true);
  await page.locator('#fire-reset').click();
  let state = await stats(page);
  expect(state.count).toBe(9);
  expect(state.wind).toBe(0.2);
  expect(state.muted).toBe(true);
  expect(state.light).toBe(false);
  expect(state.animationTime).toBeLessThan(0.5);
  // Warm both quality modes and all eighteen wood slots before leak checks.
  for (let i = 0; i < 9; i++) await page.locator('#fire-add').click();
  await expect(page.locator('#fire-add')).toBeDisabled();
  await page.locator('#fire-reset').click();
  await page.waitForTimeout(100);
  const baseline = await stats(page);
  for (let i = 0; i < 3; i++) {
    await page.locator('#fire-add').click();
    await page.locator('#fire-quality').click();
    await page.locator('#fire-reset').click();
  }
  state = await stats(page);
  expect(state.textures).toBe(baseline.textures);
  expect(state.geometries).toBe(baseline.geometries);
  expect(failures).toEqual([]);
});

test('fire orbit, zoom, hidden-tab suspension and reset camera', async ({ page }) => {
  await openFire(page);
  await page.locator('#fire-pause').click();
  const initial = await stats(page),
    box = (await page.locator('#fire-world canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width * 0.4 + 100, box.y + box.height * 0.5 + 25, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => (await stats(page)).camera).not.toEqual(initial.camera);
  await page.mouse.wheel(0, -250);
  await page.waitForTimeout(150);
  expect((await stats(page)).time).toBe(initial.time);
  await page.locator('#fire-reset').click();
  (await stats(page)).camera.forEach((n, i) => expect(n).toBeCloseTo(initial.camera[i], 5));
  // Headless Chrome keeps background pages visible. Drive the visibility event explicitly
  // so this check never silently skips the level's suspension and no-catch-up contract.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = await stats(page);
  await page.waitForTimeout(350);
  expect((await stats(page)).time).toBe(before.time);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect((await stats(page)).time - before.time).toBeLessThan(0.15);
  await expect.poll(async () => (await stats(page)).time).toBeGreaterThan(before.time);
});

test('paused volume is pixel-stable and occlusion remains coherent from other viewpoints', async ({
  page,
}) => {
  await openFire(page, '/?level=fire&fireFixture=full');
  const canvas = page.locator('#fire-world canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  // Let ResizeObserver and the first shadow-map/compositor frames settle before comparison.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const before = await stats(page);
  const first = await canvas.screenshot({ path: 'artifacts/fire-paused-before.png' });
  await page.waitForTimeout(200);
  const after = await stats(page);
  expect(after.time).toBe(before.time);
  expect(after.camera).toEqual(before.camera);
  const second = await canvas.screenshot({ path: 'artifacts/fire-paused-after.png' });
  const difference = await page.evaluate(
    async ({ a, b }) => {
      const decode = async (src: string) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const surface = new OffscreenCanvas(image.width, image.height),
          ctx = surface.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, image.width, image.height).data;
      };
      const [left, right] = await Promise.all([decode(a), decode(b)]);
      let max = 0,
        changed = 0;
      if (left.length !== right.length) return { max: 255, fraction: 1 };
      for (let i = 0; i < left.length; i += 4) {
        const delta = Math.max(
          Math.abs(left[i] - right[i]),
          Math.abs(left[i + 1] - right[i + 1]),
          Math.abs(left[i + 2] - right[i + 2]),
        );
        max = Math.max(max, delta);
        if (delta) changed++;
      }
      return { max, fraction: changed / (left.length / 4) };
    },
    {
      a: `data:image/png;base64,${first.toString('base64')}`,
      b: `data:image/png;base64,${second.toString('base64')}`,
    },
  );
  // HDR/browser capture can differ by one 8-bit rounding value at a handful of edges.
  // Actual flame movement changes thousands of pixels by much more than this tolerance.
  expect(difference.max).toBeLessThanOrEqual(1);
  expect(difference.fraction).toBeLessThan(0.001);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35 + 210, box.y + box.height * 0.65 - 50, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/fire-orbit.png', fullPage: true });
  await page.locator('#fire-quality').click();
  await expect(page.locator('#fire-quality')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'artifacts/fire-light.png', fullPage: true });
});

test('context loss pauses the fire and offers recovery while navigation remains available', async ({
  page,
}) => {
  await openFire(page);
  await expect(page.locator('#fire-world canvas')).toBeVisible();
  const lost = await page.evaluate(() => {
    const gl = document
      .querySelector<HTMLCanvasElement>('#fire-world canvas')!
      .getContext('webgl2')!;
    const extension = gl.getExtension('WEBGL_lose_context');
    extension?.loseContext();
    return !!extension;
  });
  expect(lost).toBe(true);
  await expect(page.locator('#fire-notice')).toContainText('Reload the page');
  expect((await stats(page)).paused).toBe(true);
  await expect(page.locator('#fire-reset')).toBeDisabled();
  await expect(page.getByRole('link', { name: '04 Model Railway' })).toBeEnabled();
});

for (const [width, height, label] of [
  [1440, 1000, 'desktop'],
  [1024, 900, 'tablet'],
  [390, 844, 'mobile'],
] as const) {
  test(`fire ${label} layout, navigation and screenshot`, async ({ page }) => {
    const failures = errors(page);
    await page.setViewportSize({ width, height });
    await openFire(page, '/?level=fire&fireFixture=full');
    await expect(page.locator('#fire-world canvas')).toBeVisible();
    await expect(page.locator('.level-nav a')).toHaveCount(5);
    await expect(page.locator('.level-nav [aria-current="page"]')).toHaveText('05 Campfire');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    for (const selector of ['.level-nav', '#fire-world', '.fire-settings']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({ path: `artifacts/fire-${label}.png`, fullPage: true });
    expect(failures).toEqual([]);
  });
}

test('burn-stage fixtures, ignition and cold-fuel restart', async ({ page }) => {
  test.setTimeout(120000);
  const failures = errors(page);
  for (const fixture of ['ignition', 'collapse', 'embers', 'cold']) {
    await openFire(page, `/?level=fire&fireFixture=${fixture}`);
    await expect(page.locator('#fire-world canvas')).toBeVisible();
    const state = await stats(page);
    expect(state.paused).toBe(true);
    if (fixture === 'collapse') expect(state.sticks.every((s) => s.char > 0.7)).toBe(true);
    if (fixture === 'embers') {
      expect(state.ashCount).toBe(9);
      expect(state.glow).toBeGreaterThan(0);
    }
    if (fixture === 'cold') expect(state.glow).toBe(0);
    await page.screenshot({ path: `artifacts/fire-${fixture}.png`, fullPage: true });
  }
  await page.locator('#fire-pause').click();
  await page.locator('#fire-add').click();
  await page.locator('#fire-ignite').click();
  await expect.poll(async () => (await stats(page)).intensity).toBeGreaterThan(0.03);
  expect(failures).toEqual([]);
});

test('touch orbit and pinch leave paused fire unchanged', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await openFire(page, '/?level=fire&fireFixture=full&fireQuality=light');
    await page.locator('#fire-world canvas').scrollIntoViewIfNeeded();
    const initial = await stats(page),
      box = (await page.locator('#fire-world canvas').boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2,
      cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 6; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 8, y, id: 1 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await stats(page)).camera).not.toEqual(initial.camera);
    const before = await stats(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: x - 70, y, id: 1 },
        { x: x + 70, y, id: 2 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await stats(page)).camera).not.toEqual(before.camera);
    expect((await stats(page)).time).toBe(initial.time);
  } finally {
    await context.close();
  }
});

test('desktop performance samples for both quality modes', async ({ page }, testInfo) => {
  await openFire(page);
  await expect(page.locator('#fire-world canvas')).toBeVisible();
  const results = [];
  for (const light of [false, true]) {
    if (light) await page.locator('#fire-quality').click();
    await page.waitForTimeout(3500);
    const state = await stats(page);
    results.push({
      mode: light ? 'light' : 'high',
      medianFrameMs: state.frameMs,
      p95FrameMs: state.p95FrameMs,
    });
  }
  const gpu = await page.evaluate(() => {
    const canvas = document.createElement('canvas'),
      gl = canvas.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  });
  const report = JSON.stringify({ viewport: page.viewportSize(), gpu, results }, null, 2);
  console.log(report);
  await testInfo.attach('fire-performance', { body: report, contentType: 'application/json' });
});

test('procedural fire needs no media requests and reuses its generated volume', async ({
  page,
}) => {
  const requests: string[] = [];
  const failures = errors(page);
  page.on('request', (request) => {
    if (['image', 'media'].includes(request.resourceType())) requests.push(request.url());
  });
  await page.route(/\.(webp|png|jpg|mp4|webm)(\?|$)/, (route) => route.abort());
  await openFire(page, '/?level=fire&fireFixture=full');
  const initial = await stats(page);
  expect(initial.volumeSteps).toBe(224);
  for (let i = 0; i < 3; i++) {
    await page.locator('#fire-quality').click();
    expect((await stats(page)).volumeSteps).toBe(88);
    await page.locator('#fire-reset').click();
  }
  expect(requests).toEqual([]);
  expect((await stats(page)).textures).toBe(initial.textures);
  expect(failures).toEqual([]);
});

test('live upper plume has continuous emission under wind', async ({ page }, testInfo) => {
  await openFire(page, '/?level=fire&fireFixture=full');
  await page.locator('#fire-wind').fill('65');
  await page.locator('#fire-pause').click();
  const samples = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#fire-world canvas')!;
    const gl = canvas.getContext('webgl2')!;
    const width = gl.drawingBufferWidth,
      height = gl.drawingBufferHeight;
    // Upper central volume, above the wood: ignore ground lighting and UI.
    const x = Math.floor(width * 0.4),
      y = Math.floor(height * 0.48);
    const w = Math.floor(width * 0.28),
      h = Math.floor(height * 0.32);
    const pixels = new Uint8Array(w * h * 4);
    const result: { time: number; energy: number }[] = [];
    for (let frame = 0; frame < 48; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let energy = 0;
          for (let i = 0; i < pixels.length; i += 4)
            energy += Math.max(0, pixels[i] - pixels[i + 2] * 1.5);
          const state = (window as unknown as { __fireDebug: () => Snapshot }).__fireDebug();
          result.push({ time: state.animationTime, energy });
          resolve();
        }),
      );
    }
    return result;
  });
  const changes = samples.slice(1).flatMap((sample, i) => {
    const previous = samples[i],
      dt = sample.time - previous.time;
    return dt > 0 && dt <= 1 / 15
      ? [Math.abs(sample.energy - previous.energy) / Math.max(sample.energy, previous.energy, 1)]
      : [];
  });
  expect(samples.every((sample) => sample.energy > 1000)).toBe(true);
  expect(changes.length).toBeGreaterThan(12);
  // Reject whole-tip flashing between ordinary frames; natural shape variation remains.
  expect(Math.max(...changes)).toBeLessThan(0.15);
  await testInfo.attach('plume-continuity', {
    body: JSON.stringify({ maxRelativeChange: Math.max(...changes), samples }, null, 2),
    contentType: 'application/json',
  });
});
