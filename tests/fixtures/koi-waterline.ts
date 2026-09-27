import * as T from 'three';
import { AquariumWorld } from '../../src/aquarium/physics';
import { AquariumRenderer } from '../../src/aquarium/render';

// A stationary, flat surface isolates visibility from waves and fish steering.
// Uses the shipped renderer and model, with no application-only debug controls.
const world = new AquariumWorld();
world.heights.fill(0);
world.waveMaker = false;
world.paused = true;
const view = new AquariumRenderer(document.querySelector<HTMLElement>('#tank')!, world);
await view.koi.load();
await view.ready;
if (view.koi.status !== 'ready') throw new Error('Waterline fixture could not load koi');
view.controls.enableDamping = false;
const fish = world.koi.fish[0];
Object.assign(fish, {
  x: 0,
  y: 0.85,
  z: 0,
  heading: Math.PI,
  pitch: 0,
  turnRate: 0,
  animationTime: 0.4,
});
const size = view.renderer.getDrawingBufferSize(new T.Vector2());
const gl = view.renderer.getContext();
const topPixels: number[] = [];
const raycaster = new T.Raycaster();
const plane = new T.Plane(new T.Vector3(0, 1, 0), -1.65);
const hit = new T.Vector3();
const background = new Uint8Array(size.x * size.y * 4);
const pixels = new Uint8Array(background.length);
let side = false;
async function configure(axis: 'front' | 'side', low: boolean, phase = 0.5) {
  view.lighting.setTime(phase);
  side = axis === 'side';
  await view.setMode(low ? 'efficient' : 'high');
  await view.koi.load(low);
  if (view.koi.status !== 'ready') throw new Error('Waterline quality load failed');
  view.renderer.shadowMap.autoUpdate = false;
  view.koi.group.children.slice(1).forEach((o) => (o.visible = false));
  view.controls.target.set(0, 0.85, 0);
  view.camera.position.set(side ? 9 : 0, 4, side ? 0 : 9);
  view.controls.update();
  view.camera.updateMatrixWorld();
  Object.assign(fish, {
    x: side ? 1.6 : 0,
    z: 0,
    heading: side ? -Math.PI / 2 : Math.PI,
  });
  topPixels.length = 0;
  for (let y = 0; y < size.y; y++) {
    for (let x = Math.floor(size.x * 0.4); x < size.x * 0.6; x++) {
      raycaster.setFromCamera(
        new T.Vector2(((x + 0.5) / size.x) * 2 - 1, ((y + 0.5) / size.y) * 2 - 1),
        view.camera,
      );
      if (
        raycaster.ray.intersectPlane(plane, hit) &&
        Math.abs(hit.x) < 2.99 &&
        Math.abs(hit.z) < 1.79
      )
        topPixels.push((y * size.x + x) * 4);
    }
  }
  view.koi.group.visible = false;
  view.render();
  gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, background);
  view.koi.group.visible = true;
}
function frame(distance: number) {
  if (side) fish.x = 2.8 - distance;
  else fish.z = 1.6 - distance;
  view.render();
  gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let visible = 0;
  const hits = view.readOpticalHits();
  for (const p of topPixels)
    if (
      (!hits ||
        T.DataUtils.fromHalfFloat(
          hits.data[
            (Math.floor(((p / 4 / size.x) * hits.height) / size.y) * hits.width +
              Math.floor((((p / 4) % size.x) * hits.width) / size.x)) *
              4 +
              2
          ],
        ) === 4) &&
      Math.max(...[0, 1, 2].map((c) => Math.abs(pixels[p + c] - background[p + c]))) > 8
    )
      visible++;
  return visible;
}
await configure('front', false);
Object.assign(window, { waterlineFixture: { configure, frame, dispose: () => view.dispose() } });
