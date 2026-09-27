import * as T from 'three';
import { AquariumWorld, NX, NZ } from '../../src/aquarium/physics';
import { AquariumRenderer } from '../../src/aquarium/render';
import { LAMP_POSITION } from '../../src/aquarium/lighting';

const world = new AquariumWorld();
world.heights.fill(0);
world.waveMaker = false;
world.strength = 0;
world.paused = true;
const view = new AquariumRenderer(document.querySelector<HTMLElement>('#tank')!, world, {
  forceRaster: new URLSearchParams(location.search).has('fallback'),
});
await view.ready;
view.controls.enableDamping = false;
view.lighting.setTime(0.5);
view.render();
function measure(waves = false, ball = false, phase = 0.5) {
  view.lighting.setTime(phase);
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++)
      world.heights[j * NX + i] = waves ? 0.024 * Math.sin(i * 0.35) * Math.cos(j * 0.31) : 0;
  world.balls.length = 0;
  if (ball)
    world.balls.push({
      id: 0,
      x: 0,
      y: 1.85,
      z: 0,
      radius: 0.3,
      color: 0xffaa66,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  view.render();
  const data = view.readOpticalCaustics();
  if (!data) return { mean: 0, deviation: 0, peak: 0, pixels: [] };
  const pixels: number[] = [];
  for (let y = Math.round(data.height * 0.35); y < data.height * 0.65; y += 3)
    for (let x = Math.round(data.width * 0.35); x < data.width * 0.65; x += 3) {
      pixels.push(T.DataUtils.fromHalfFloat(data.data[(y * data.width + x) * 4 + 1]));
    }
  const mean = pixels.reduce((a, b) => a + b, 0) / pixels.length;
  const deviation = Math.sqrt(pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / pixels.length);
  return { mean, deviation, peak: Math.max(...pixels), pixels };
}
function framePixels() {
  view.render();
  const size = view.renderer.getDrawingBufferSize(new T.Vector2());
  const pixels = new Uint8Array(size.x * size.y * 4);
  const gl = view.renderer.getContext();
  gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}
function pausedDifference() {
  const a = framePixels(),
    b = framePixels();
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  return changed;
}
function finCoverage() {
  measure();
  view.camera.position.set(0, 7, 0.01);
  view.controls.target.set(0, 0.8, 0);
  const coverage: number[] = [];
  for (const cutout of [false, true]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e74023';
    context.fillRect(0, 0, cutout ? 16 : 32, 32);
    const map = new T.CanvasTexture(canvas);
    const material = new T.MeshStandardMaterial({ map, alphaTest: 0.5, side: T.DoubleSide });
    const fin = new T.Mesh(new T.PlaneGeometry(1, 1), material);
    fin.rotation.x = -Math.PI / 2;
    fin.position.y = 1;
    view.koi.group.add(fin);
    view.render();
    const hits = view.readOpticalHits();
    let count = 0;
    if (hits) {
      for (let i = 2; i < hits.data.length; i += 4)
        if (T.DataUtils.fromHalfFloat(hits.data[i]) === 4) count++;
    } else {
      const pixels = framePixels();
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > pixels[i + 1] * 1.25 && pixels[i] > 60) count++;
    }
    coverage.push(count);
    view.koi.group.remove(fin);
    fin.geometry.dispose();
    material.dispose();
    map.dispose();
  }
  view.render();
  return coverage;
}
function lampAlignment() {
  view.resetCamera();
  measure(false, false, 0.92);
  const pixels = framePixels(),
    size = view.renderer.getDrawingBufferSize(new T.Vector2());
  const virtual = new T.Vector3(LAMP_POSITION[0], 3.3 - LAMP_POSITION[1], LAMP_POSITION[2]).project(
    view.camera,
  );
  const x = Math.round((virtual.x * 0.5 + 0.5) * size.x),
    y = Math.round((virtual.y * 0.5 + 0.5) * size.y);
  const brightness = (dx: number, dy: number) => {
    const i = ((y + dy) * size.x + x + dx) * 4;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 765;
  };
  let center = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) center = Math.max(center, brightness(dx, dy));
  return {
    center,
    ring: (brightness(18, 0) + brightness(-18, 0) + brightness(0, 18) + brightness(0, -18)) / 4,
  };
}
Object.assign(window, {
  aquariumOpticsFixture: {
    measure,
    pausedDifference,
    finCoverage,
    lampAlignment,
    quality: (low: boolean) => view.quality(low),
    snapshot: () => view.renderingSnapshot(),
    light: (phase: number) => {
      view.lighting.setTime(phase);
      view.render();
    },
    dispose: () => view.dispose(),
  },
});
