import { test, expect } from '@playwright/test';

test('cloud volume views, reset, disposal and rendering cost', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Isolate the real railway renderer from the application's animation loop.
  await page.route('**/cloud-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#f4f1e7"><div id="scene" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/cloud-check');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/railway/render.ts';
    const physicsPath = '/src/railway/physics.ts';
    const { RailwayRenderer } = await import(rendererPath);
    const { RailwayWorld } = await import(physicsPath);
    const world = new RailwayWorld();
    const view = new RailwayRenderer(document.getElementById('scene')!, world);
    // This harness exists only on the isolated test page.
    Object.assign(window, { cloudHarness: { view, world } });
    view.render();
    const initial = view.stats().clouds.positions;
    world.advance(30);
    view.render();
    const moved = view.stats().clouds.positions;
    world.reset();
    view.render();
    const reset = view.stats().clouds.positions;
    const clouds = view.scene.getObjectByName('Miniature clouds');
    const gl = view.renderer.getContext();
    const samples: Record<string, number[]> = {
      normal: [],
      normalWithout: [],
      light: [],
      lightWithout: [],
    };
    // Alternate paired runs; finish includes GPU work instead of timing command submission only.
    for (let round = 0; round < 3; round++) {
      for (const light of [false, true]) {
        view.quality(light);
        for (const visible of round % 2 ? [true, false] : [false, true]) {
          clouds.visible = visible;
          for (let i = 0; i < 8; i++) {
            view.render();
            gl.finish();
          }
          const name = `${light ? 'light' : 'normal'}${visible ? '' : 'Without'}`;
          for (let i = 0; i < 20; i++) {
            const start = performance.now();
            view.render();
            gl.finish();
            samples[name].push(performance.now() - start);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    const median = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const timings = Object.fromEntries(
      Object.entries(samples).map(([name, values]) => [name, median(values)]),
    );
    clouds.visible = true;
    view.quality(false);
    view.render();
    return {
      initial,
      moved,
      reset,
      timings,
      renderer: gl.getParameter(gl.RENDERER),
      stats: view.stats(),
    };
  });
  expect(result.moved).not.toEqual(result.initial);
  expect(result.reset).toEqual(result.initial);
  expect(result.stats.clouds.steps).toBe(64);
  console.log('Cloud synchronized frame timings (ms):', JSON.stringify(result.timings));
  await testInfo.attach('cloud-render-timings', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: 'artifacts/railway-clouds-overview.png' });
  for (const [name, position] of [
    ['opposite', [-10.6, 11.15, -13.95]],
    ['above', [0, 19, 0.1]],
    ['close', [4.4, 5.5, 7.5]],
    ['inside', [-3.6, 4.65, -1.2775]],
  ] as const) {
    await page.evaluate((position) => {
      const { view } = (window as any).cloudHarness;
      view.camera.position.fromArray(position);
      view.render();
    }, position);
    await page.screenshot({ path: `artifacts/railway-clouds-${name}.png` });
  }
  const disposed = await page.evaluate(() => {
    const { view } = (window as any).cloudHarness;
    const group = view.scene.getObjectByName('Miniature clouds');
    let textures = 0,
      materials = 0,
      geometry = 0;
    group.children[0].geometry.addEventListener('dispose', () => geometry++);
    for (const mesh of group.children) {
      mesh.material.addEventListener('dispose', () => materials++);
      mesh.material.uniforms.densityMap.value.addEventListener('dispose', () => textures++);
    }
    view.dispose();
    return {
      textures,
      materials,
      geometry,
      attached: !!group.parent,
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
  expect(disposed).toEqual({
    textures: 3,
    materials: 3,
    geometry: 1,
    attached: false,
    canvasCount: 0,
  });
  expect(errors).toEqual([]);
});
