import * as T from 'three';
import { AquariumWorld, WATER_Y } from '../../src/aquarium/physics';
import { AquariumRenderer } from '../../src/aquarium/render';

const world = new AquariumWorld();
world.paused = true;
world.heights.fill(0);
const view = new AquariumRenderer(document.querySelector<HTMLElement>('#tank')!, world);
view.controls.enableDamping = false;
view.camera.position.set(0, 5, 9);
view.controls.target.set(0, WATER_Y, 0);
const marker = new T.Mesh(
  new T.BoxGeometry(0.6, 0.6, 0.6),
  new T.MeshBasicMaterial({ color: 0xff00ff }),
);
view.scene.add(marker);
// Read the actual production reflection texture, independent of direct scene visibility.
const capture = new T.WebGLRenderTarget(400, 300);
const scene = new T.Scene();
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 2);
camera.position.z = 1;
const quad = new T.Mesh(
  new T.PlaneGeometry(2, 2),
  new T.MeshBasicMaterial({
    map: view.water.material.uniforms.reflectionMap.value,
    toneMapped: false,
  }),
);
scene.add(quad);
function pixels() {
  view.render();
  view.renderer.setRenderTarget(capture);
  view.renderer.render(scene, camera);
  const result = new Uint8Array(400 * 300 * 4);
  view.renderer.readRenderTargetPixels(capture, 0, 0, 400, 300, result);
  view.renderer.setRenderTarget(null);
  return result;
}
function inspect(height: number, x = 0) {
  marker.visible = false;
  const baseline = pixels();
  marker.visible = true;
  marker.position.set(x, height, 0);
  const image = pixels();
  let count = 0,
    sumX = 0;
  for (let i = 0; i < image.length; i += 4) {
    if (Math.max(...[0, 1, 2].map((c) => Math.abs(image[i + c] - baseline[i + c]))) > 15) {
      count++;
      sumX += (i / 4) % 400;
    }
  }
  const texture = view.water.material.uniforms.reflectionMap.value as T.Texture;
  return {
    count,
    centerX: sumX / Math.max(1, count),
    width: texture.image.width,
    height: texture.image.height,
  };
}
Object.assign(window, {
  reflectionFixture: {
    inspect,
    quality: (low: boolean) => view.quality(low),
    dispose() {
      marker.geometry.dispose();
      marker.material.dispose();
      view.scene.remove(marker);
      quad.geometry.dispose();
      quad.material.dispose();
      capture.dispose();
      view.dispose();
    },
  },
});
