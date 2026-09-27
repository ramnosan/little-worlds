import { test, expect } from '@playwright/test';

test('undergrowth has bounded geometry, clears the rails, and supports light mode', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/vegetation-check', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body style="margin:0;background:#a6af98"><div id="scene" style="width:100vw;height:100vh"></div></body></html>',
    }),
  );
  await page.goto('/vegetation-check');
  const result = await page.evaluate(async () => {
    const rendererPath = '/src/railway/render.ts',
      physicsPath = '/src/railway/physics.ts';
    const threePath = '/node_modules/three/build/three.module.js';
    const { RailwayRenderer } = await import(rendererPath);
    const { RailwayWorld, nearestTrack } = await import(physicsPath);
    const { Matrix4, Vector3 } = await import(threePath);
    const view = new RailwayRenderer(document.getElementById('scene')!, new RailwayWorld());
    const plants: any[] = [];
    view.scene.traverse((object: any) => {
      if (object.name.startsWith('Undergrowth ')) plants.push(object);
    });
    let count = 0,
      triangles = 0,
      clearance = Infinity;
    const matrix = new Matrix4(),
      point = new Vector3(),
      center = new Vector3();
    let target = new Vector3(),
      best = -Infinity;
    for (const mesh of plants) {
      const position = mesh.geometry.attributes.position;
      count += mesh.count;
      triangles += (position.count / 3) * mesh.count;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        center.setFromMatrixPosition(matrix);
        let radius = 0;
        for (let vertex = 0; vertex < position.count; vertex++) {
          point.fromBufferAttribute(position, vertex).applyMatrix4(matrix);
          if (![point.x, point.y, point.z].every(Number.isFinite))
            throw new Error('Invalid plant vertex');
          radius = Math.max(radius, Math.hypot(point.x - center.x, point.z - center.z));
        }
        clearance = Math.min(clearance, nearestTrack(center.x, center.z).clearance - radius);
        if (mesh.name.includes('bush') && center.z > best) {
          best = center.z;
          target.copy(center);
        }
      }
    }
    view.quality(true);
    const hidden = plants.every((mesh) => !mesh.parent.visible);
    view.quality(false);
    const visible = plants.every((mesh) => mesh.parent.visible);
    view.controls.minDistance = 0.4;
    view.controls.target.copy(target).add(new Vector3(0, 0.08, 0));
    view.camera.position.copy(target).add(new Vector3(0.65, 0.45, 0.9));
    view.controls.update();
    view.render();
    Object.assign(window, { vegetationView: view });
    return { count, triangles, clearance, hidden, visible, batches: plants.length };
  });
  expect(result.batches).toBe(9);
  expect(result.count).toBeGreaterThan(75);
  expect(result.triangles).toBeLessThan(1_000_000);
  expect(result.clearance).toBeGreaterThan(0.4);
  expect(result.hidden && result.visible).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/railway-undergrowth-close.png' });
  console.log('Undergrowth budget and clearance:', result);
});
