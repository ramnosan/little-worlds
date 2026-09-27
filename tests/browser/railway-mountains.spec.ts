import { test, expect, type Page } from '@playwright/test';

async function mountainScene(page: Page) {
  await page.route('**/mountain-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#a6af98"><div id="scene" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/mountain-check');
  await page.evaluate(async () => {
    const rendererPath = '/src/railway/render.ts',
      physicsPath = '/src/railway/physics.ts';
    const { RailwayRenderer } = await import(rendererPath);
    const physics = await import(physicsPath);
    const world = new physics.RailwayWorld();
    const view = new RailwayRenderer(document.getElementById('scene')!, world);
    Object.assign(window, { mountainHarness: { view, world, physics } });
    view.render();
  });
}

test('complete mountain circuit, actual tunnel clearance, lights and disposal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mountainScene(page);
  const result = await page.evaluate(async () => {
    const { view, world, physics: p } = (window as any).mountainHarness;
    const threePath = '/node_modules/three/build/three.module.js';
    const { Raycaster, Vector3 } = await import(threePath);
    const scenery = view.scene.getObjectByName('Railway scenery');
    const surfaces = scenery.children.filter((mesh: any) =>
      ['Scenery grass', 'Scenery rock', 'Scenery tunnel'].includes(mesh.name),
    );
    const ray = new Raycaster(),
      from = new Vector3(),
      to = new Vector3();
    const collisions: string[] = [],
      visited = new Set<string>(),
      heights: number[] = [];
    for (let step = 0; step <= 150; step++) {
      world.reset();
      world.advance((step * p.LAP_SECONDS) / 150);
      view.render();
      const stats = world.stats();
      heights.push(stats.cars[0].y);
      for (const car of stats.cars) if (car.tunnel) visited.add(car.tunnel);
      for (let i = 1; i < stats.cars.length; i++) {
        const spacing = p.wrapDistance(stats.cars[i - 1].distance - stats.cars[i].distance);
        if (Math.abs(spacing - p.CAR_SPACING) > 1e-6) throw new Error('Car spacing changed');
      }
    }
    // Cast along the real rendered scenery, including both mouths of every tunnel.
    for (const section of p.ROUTE_SECTIONS.filter((s: any) => s.kind === 'tunnel')) {
      for (let distance = section.start - 0.25; distance < section.end + 0.25; distance += 0.12) {
        for (const line of [0, p.LINE_OFFSET])
          for (const side of [-0.072, 0, 0.072]) {
            const a = p.trackPose(distance, line + side),
              b = p.trackPose(distance + 0.13, line + side);
            for (const h of [0.08, 0.22, 0.294]) {
              from.set(a.x, a.y + h, a.z);
              to.set(b.x, b.y + h, b.z);
              ray.set(from, to.clone().sub(from).normalize());
              ray.far = from.distanceTo(to);
              const hits = ray.intersectObjects(surfaces, false);
              if (hits.length)
                collisions.push(
                  `${section.id} at ${distance.toFixed(2)} height ${h}: ${hits[0].object.name}`,
                );
            }
          }
      }
    }
    const lights: any[] = [];
    view.scene.traverse((obj: any) => {
      if (obj.isPointLight || obj.isSpotLight) lights.push(obj);
    });
    view.quality(true);
    view.render();
    view.quality(false);
    view.render();
    const baseline = view.stats();
    for (let i = 0; i < 4; i++) {
      world.reset();
      view.quality(true);
      view.render();
      view.quality(false);
      view.render();
    }
    const final = view.stats();
    view.dispose();
    return {
      collisions,
      visited: [...visited],
      range: Math.max(...heights) - Math.min(...heights),
      modelScale: baseline.modelScale,
      lights: lights.length,
      baseline: [baseline.geometries, baseline.textures],
      final: [final.geometries, final.textures],
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
  expect(result.collisions).toEqual([]);
  expect(result.visited.sort()).toEqual(['hochgrat', 'tannenfels']);
  expect(result.range).toBeGreaterThan(0.4);
  expect(result.modelScale).toBeCloseTo(1 / 3);
  expect(result.lights).toBe(5);
  expect(result.final).toEqual(result.baseline);
  expect(result.canvasCount).toBe(0);
  expect(errors).toEqual([]);
});

test('mountain portals, illuminated interiors and valley bridge views', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1200, height: 850 });
  await mountainScene(page);
  for (const id of ['hochgrat', 'tannenfels', 'talbruecke']) {
    await page.evaluate((id) => {
      const { view, world, physics: p } = (window as any).mountainHarness;
      const section = p.ROUTE_SECTIONS.find((s: any) => s.id === id);
      const s = section.kind === 'bridge' ? (section.start + section.end) / 2 : section.start;
      const pose = p.trackPose(s, p.LINE_OFFSET / 2);
      world.distance = s + 0.18;
      view.controls.enableDamping = false;
      view.controls.minDistance = 0.2;
      view.controls.target.set(pose.x, pose.y + 0.2, pose.z);
      view.camera.position.set(
        pose.x - pose.tx * 1.9 + pose.nx * 0.55,
        pose.y + 0.85,
        pose.z - pose.tz * 1.9 + pose.nz * 0.55,
      );
      if (section.kind === 'bridge') {
        view.camera.position.set(pose.x + pose.nx * 2.3, pose.y + 1.5, pose.z + pose.nz * 2.3);
      }
      view.render();
    }, id);
    await page.screenshot({ path: `artifacts/railway-${id}.png` });
  }
  await page.evaluate(() => {
    const { view, world, physics: p } = (window as any).mountainHarness;
    const s = p.ROUTE_SECTIONS[0].start + 0.3,
      pose = p.trackPose(s);
    world.distance = s + 0.7;
    view.controls.target.set(pose.x + pose.tx, pose.y + 0.23, pose.z + pose.tz);
    view.camera.position.set(pose.x, pose.y + 0.23, pose.z);
    view.render();
  });
  await page.screenshot({ path: 'artifacts/railway-tunnel-interior.png' });
  await page.evaluate(() => {
    (window as any).mountainHarness.view.quality(true);
    (window as any).mountainHarness.view.render();
  });
  await page.screenshot({ path: 'artifacts/railway-tunnel-light-mode.png' });
  const illumination = await page.evaluate(() => {
    const { view, world, physics: p } = (window as any).mountainHarness;
    view.quality(false);
    world.distance = p.ROUTE_SECTIONS[0].start + 1;
    const ahead = p.trackPose(world.distance + 0.65),
      camera = p.trackPose(world.distance - 0.2, p.LINE_OFFSET + 0.04);
    view.camera.position.set(camera.x, camera.y + 0.48, camera.z);
    view.controls.target.set(ahead.x, ahead.y + 0.035, ahead.z);
    const buffer = document.createElement('canvas');
    buffer.width = 160;
    buffer.height = 100;
    const ctx = buffer.getContext('2d')!;
    const brightness = () => {
      view.render();
      ctx.drawImage(view.renderer.domElement, 0, 0, buffer.width, buffer.height);
      const pixels = ctx.getImageData(0, 0, buffer.width, buffer.height).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      return sum;
    };
    const strength = view.headlight.intensity;
    view.headlight.intensity = 0;
    const unlit = brightness();
    view.headlight.intensity = strength;
    return { unlit, lit: brightness() };
  });
  expect(illumination.lit).toBeGreaterThan(illumination.unlit + 100);
  await page.screenshot({ path: 'artifacts/railway-headlight.png' });
  await page.evaluate(() => (window as any).mountainHarness.view.dispose());
});
