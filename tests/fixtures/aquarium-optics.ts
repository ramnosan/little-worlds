import * as T from 'three';
import { AquariumWorld, NX, NZ } from '../../src/aquarium/physics';
import { AquariumRenderer } from '../../src/aquarium/render';
import { LAMP_POSITION } from '../../src/aquarium/lighting';
import { UnderwaterLighting } from '../../src/aquarium/underwater';
import { EXTINCTION, diffuseGLSL } from '../../src/aquarium/appearance';

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

// Actual GPU material responses, read in linear HDR before exposure/tone mapping.
function diffuseResponse(lamp = false) {
  const renderer = view.renderer,
    previous = renderer.getRenderTarget(),
    tone = renderer.toneMapping;
  const target = new T.WebGLRenderTarget(8, 8, { type: T.HalfFloatType });
  const field = new T.DataTexture(new Float32Array([0, 0, 0, 1]), 1, 1, T.RGBAFormat, T.FloatType);
  const data = new Float32Array([1, 1, 1, 1]);
  const caustic = new T.DataTexture(data, 1, 1, T.RGBAFormat, T.FloatType);
  field.needsUpdate = caustic.needsUpdate = true;
  const material = new T.MeshStandardMaterial({ color: new T.Color(0.5, 0.3, 0.2), roughness: 1 });
  new UnderwaterLighting(field, { value: caustic }).prepare(material);
  const prepare = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prepare(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n reflectedLight.directSpecular=vec3(0.);',
    );
  };
  const geometry = new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mesh = new T.Mesh<T.PlaneGeometry, T.Material>(geometry, material),
    scene = new T.Scene();
  const light = lamp
    ? new T.SpotLight(0xffffff, 1, 0, 0.8, 0, 2)
    : new T.DirectionalLight(0xffffff, 1);
  light.position.set(0, 4, 0);
  scene.add(mesh, light);
  const camera = new T.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
  camera.position.set(0, 4, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const pixels = new Uint16Array(4);
  const read = () => {
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixels);
    return Array.from(pixels.subarray(0, 3), T.DataUtils.fromHalfFloat);
  };
  const traced = new T.ShaderMaterial({
    uniforms: { energy: { value: 1 } },
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:
      diffuseGLSL +
      'uniform float energy;void main(){gl_FragColor=vec4(aquariumDiffuse(vec3(.5,.3,.2),vec3(energy)),1.);}',
    toneMapped: false,
  });
  try {
    renderer.toneMapping = T.NoToneMapping;
    renderer.setRenderTarget(target);
    const efficient: number[][] = [],
      high: number[][] = [],
      sourceIndependent: number[][] = [];
    for (const power of [0, 1, 2, 8]) {
      data.set([power, power, power, 1]);
      caustic.needsUpdate = true;
      mesh.material = material;
      efficient.push(read());
      light.intensity = 4;
      sourceIndependent.push(read());
      light.intensity = 1;
      mesh.material = traced;
      traced.uniforms.energy.value = power;
      high.push(read());
    }
    return {
      efficient,
      high,
      sourceIndependent,
      transmission: EXTINCTION.map((v) => Math.exp(-v * 1.65)),
    };
  } finally {
    renderer.setRenderTarget(previous);
    renderer.toneMapping = tone;
    target.dispose();
    field.dispose();
    caustic.dispose();
    material.dispose();
    traced.dispose();
    geometry.dispose();
  }
}
function nightContrast() {
  measure(false, false, 22 / 24);
  const flat = view.readOpticalCaustics()!;
  world.waveMaker = true;
  world.strength = 0.45;
  world.time = -1;
  view.render();
  world.time = 8;
  view.render();
  const wavy = view.readOpticalCaustics()!;
  const ratios: number[] = [];
  let finite = true;
  for (let i = 1; i < wavy.data.length; i += 4) {
    const a = T.DataUtils.fromHalfFloat(flat.data[i]),
      b = T.DataUtils.fromHalfFloat(wavy.data[i]);
    finite &&= Number.isFinite(b);
    if (a > 0.15) ratios.push(b / a);
  }
  ratios.sort((a, b) => a - b);
  view.koi.group.visible = false;
  view.camera.position.set(0, 8, 0.01);
  view.controls.target.set(0, 0, 0);
  view.controls.update();
  const pixels = framePixels(),
    size = view.renderer.getDrawingBufferSize(new T.Vector2());
  const luminance: number[] = [];
  let clipped = 0;
  // The central floor region excludes the lamp, rim and glass edges in this fixed view.
  for (let y = Math.floor(size.y * 0.37); y < size.y * 0.63; y++)
    for (let x = Math.floor(size.x * 0.3); x < size.x * 0.7; x++) {
      const i = (y * size.x + x) * 4;
      luminance.push(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
      if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 250) clipped++;
    }
  luminance.sort((a, b) => a - b);
  view.koi.group.visible = true;
  world.waveMaker = false;
  world.strength = 0;
  world.time = -2;
  view.render();
  view.resetCamera();
  return {
    finite,
    dark: ratios[Math.floor(ratios.length * 0.1)],
    bright: ratios[Math.floor(ratios.length * 0.9)],
    clipping: clipped / luminance.length,
    displayDark: luminance[Math.floor(luminance.length * 0.1)],
    displayBright: luminance[Math.floor(luminance.length * 0.9)],
  };
}
Object.assign(window, {
  aquariumOpticsFixture: {
    measure,
    pausedDifference,
    finCoverage,
    lampAlignment,
    diffuseResponse,
    nightContrast,
    quality: (low: boolean) => view.quality(low),
    snapshot: () => view.renderingSnapshot(),
    light: (phase: number) => {
      view.lighting.setTime(phase);
      view.render();
    },
    dispose: () => view.dispose(),
  },
});
