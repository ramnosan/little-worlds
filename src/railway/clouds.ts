import * as T from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const CLOUD_DRIFT_PERIOD = 120;
export const CLOUD_DRIFT = 0.35;
export const CLOUD_LAYOUT = [
  { position: [-3.6, 4.65, -1.4], scale: [3.3, 1.7, 1.9], seed: 17, phase: 0 },
  { position: [-0.8, 5.2, -3], scale: [2.9, 1.8, 1.8], seed: 43, phase: 2.1 },
  { position: [3.65, 4.8, -1.6], scale: [2.7, 1.5, 1.65], seed: 89, phase: 4.2 },
] as const;

const sunlight = new T.Vector3(-3, 11, 5).normalize();
const smooth = (a: number, b: number, x: number) => T.MathUtils.smoothstep(x, a, b);

/** Seeded density with an empty border; independent of the browser and GPU. */
export function cloudDensity(seed: number, size = 64): Uint8Array {
  const noise = new ImprovedNoise();
  const data = new Uint8Array(size ** 3);
  const lobes = [
    [-0.03, -0.16, 0, 0.39, 0.19, 0.34],
    [-0.23, -0.04, 0.01, 0.2, 0.25, 0.27],
    [-0.06, 0.08, -0.02, 0.23, 0.33, 0.29],
    [0.16, 0.015, 0.025, 0.24, 0.28, 0.32],
    [0.3, -0.105, -0.035, 0.15, 0.17, 0.23],
  ];
  const offset = seed * 0.731;
  lobes.forEach((lobe, i) => {
    // Vary the larger billows as well as their surface detail between clouds.
    lobe[1] += noise.noise(offset, i * 2.7, 1.3) * 0.06;
    lobe[4] *= 1 + noise.noise(i * 3.1, offset, 2.6) * 0.24;
  });
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = x / (size - 1) - 0.5;
        const py = y / (size - 1) - 0.5;
        const pz = z / (size - 1) - 0.5;
        let shape = -1;
        for (const [cx, cy, cz, rx, ry, rz] of lobes) {
          shape = Math.max(shape, 1 - Math.hypot((px - cx) / rx, (py - cy) / ry, (pz - cz) / rz));
        }
        const billows =
          noise.noise(px * 9 + offset, py * 9, pz * 9 - offset) * 0.2 +
          noise.noise(px * 21, py * 21 + offset, pz * 21) * 0.085 +
          noise.noise(px * 43 - offset, py * 43, pz * 43) * 0.035;
        const border = smooth(0, 0.065, 0.5 - Math.max(Math.abs(px), Math.abs(py), Math.abs(pz)));
        const base = smooth(-0.36, -0.23, py);
        data[x + size * (y + size * z)] = Math.round(
          255 * smooth(-0.025, 0.25, shape + billows) * border * base,
        );
      }
    }
  }
  return data;
}

/** Write into a reusable vector to keep the animation allocation-free. */
export function cloudPosition(index: number, seconds: number, target: T.Vector3) {
  const cloud = CLOUD_LAYOUT[index];
  const angle = (seconds * Math.PI * 2) / CLOUD_DRIFT_PERIOD + cloud.phase;
  return target.set(
    cloud.position[0] + CLOUD_DRIFT * Math.sin(angle),
    cloud.position[1],
    cloud.position[2] + CLOUD_DRIFT * 0.35 * Math.cos(angle),
  );
}

// Bake sun transmittance alongside density: one texture lookup per view-ray step.
function cloudTexture(index: number) {
  const size = 64;
  const cloud = CLOUD_LAYOUT[index];
  const density = cloudDensity(cloud.seed, size);
  const data = new Uint8Array(size ** 3 * 2);
  const step = 0.16;
  const dx = ((sunlight.x * step) / cloud.scale[0]) * (size - 1);
  const dy = ((sunlight.y * step) / cloud.scale[1]) * (size - 1);
  const dz = ((sunlight.z * step) / cloud.scale[2]) * (size - 1);
  const sample = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= size - 1 || y >= size - 1 || z >= size - 1) return 0;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    const fx = x - ix,
      fy = y - iy,
      fz = z - iz;
    const at = (a: number, b: number, c: number) => density[a + size * (b + size * c)] / 255;
    return T.MathUtils.lerp(
      T.MathUtils.lerp(
        T.MathUtils.lerp(at(ix, iy, iz), at(ix + 1, iy, iz), fx),
        T.MathUtils.lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), fx),
        fy,
      ),
      T.MathUtils.lerp(
        T.MathUtils.lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), fx),
        T.MathUtils.lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), fx),
        fy,
      ),
      fz,
    );
  };
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = x + size * (y + size * z);
        let opticalDepth = 0;
        for (let s = 1; s <= 10; s++)
          opticalDepth += sample(x + dx * s, y + dy * s, z + dz * s) * step;
        data[i * 2] = density[i];
        data[i * 2 + 1] = Math.round(255 * Math.exp(-opticalDepth * 4.2));
      }
    }
  }
  const texture = new T.Data3DTexture(data, size, size, size);
  texture.format = T.RGFormat;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */ `
  uniform vec3 localCamera;
  out vec3 rayOrigin;
  out vec3 rayDirection;
  void main() {
    rayOrigin = localCamera;
    rayDirection = position - localCamera;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  out vec4 cloudColor;
  #define gl_FragColor cloudColor
  precision highp sampler3D;
  uniform sampler3D densityMap;
  uniform int steps;
  uniform vec3 volumeScale;
  in vec3 rayOrigin;
  in vec3 rayDirection;
  void main() {
    vec3 direction = normalize(rayDirection);
    // Keep parallel rays finite, including cameras exactly above a cloud.
    vec3 inverseDirection = 1.0 / mix(vec3(0.000001), direction, greaterThan(abs(direction), vec3(0.000001)));
    vec3 a = (-0.5 - rayOrigin) * inverseDirection;
    vec3 b = (0.5 - rayOrigin) * inverseDirection;
    vec3 nearPlane = min(a, b);
    vec3 farPlane = max(a, b);
    float entry = max(0.0, max(nearPlane.x, max(nearPlane.y, nearPlane.z)));
    float exitPoint = min(farPlane.x, min(farPlane.y, farPlane.z));
    if (exitPoint <= entry) discard;
    float delta = (exitPoint - entry) / float(steps);
    float worldStep = length(direction * volumeScale) * delta;
    vec3 p = rayOrigin + direction * (entry + delta * 0.5) + 0.5;
    vec4 accumulated = vec4(0.0);
    for (int i = 0; i < 64; i++) {
      if (i >= steps) break;
      vec2 sampleValue = texture(densityMap, p).rg;
      float opacity = 1.0 - exp(-sampleValue.r * worldStep * 8.0);
      vec3 shade = mix(vec3(0.3, 0.37, 0.47), vec3(1.45, 1.42, 1.35), sampleValue.g);
      accumulated.rgb += (1.0 - accumulated.a) * opacity * shade;
      accumulated.a += (1.0 - accumulated.a) * opacity;
      if (accumulated.a > 0.99) break;
      p += direction * delta;
    }
    if (accumulated.a < 0.002) discard;
    // Three's normal blending expects straight alpha; tone map before compositing.
    gl_FragColor = vec4(accumulated.rgb / accumulated.a, accumulated.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class RailwayClouds {
  readonly group = new T.Group();
  private geometry = new T.BoxGeometry(1, 1, 1);
  private clouds: T.Mesh<T.BoxGeometry, T.ShaderMaterial>[] = [];
  private textures: T.Data3DTexture[] = [];
  private motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private inverse = new T.Matrix4();
  private steps = 64;

  constructor(scene: T.Scene) {
    this.group.name = 'Miniature clouds';
    CLOUD_LAYOUT.forEach((cloud, index) => {
      const texture = cloudTexture(index);
      this.textures.push(texture);
      const material = new T.ShaderMaterial({
        glslVersion: T.GLSL3,
        uniforms: {
          localCamera: { value: new T.Vector3() },
          densityMap: { value: texture },
          volumeScale: { value: new T.Vector3(...cloud.scale) },
          steps: { value: this.steps },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: T.BackSide,
      });
      const mesh = new T.Mesh(this.geometry, material);
      mesh.scale.fromArray(cloud.scale);
      cloudPosition(index, 0, mesh.position);
      this.clouds.push(mesh);
      this.group.add(mesh);
    });
    scene.add(this.group);
  }

  update(camera: T.Camera, elapsed: number) {
    const seconds = this.motion.matches ? 0 : elapsed;
    for (let i = 0; i < this.clouds.length; i++) {
      const cloud = this.clouds[i];
      cloudPosition(i, seconds, cloud.position);
      cloud.updateMatrixWorld();
      this.inverse.copy(cloud.matrixWorld).invert();
      cloud.material.uniforms.localCamera.value
        .setFromMatrixPosition(camera.matrixWorld)
        .applyMatrix4(this.inverse);
    }
  }

  quality(light: boolean) {
    this.steps = light ? 32 : 64;
    for (const cloud of this.clouds) cloud.material.uniforms.steps.value = this.steps;
  }

  stats() {
    return {
      positions: this.clouds.map((cloud) => cloud.position.toArray()),
      steps: this.steps,
      reducedMotion: this.motion.matches,
    };
  }

  dispose() {
    this.group.removeFromParent();
    this.geometry.dispose();
    for (const cloud of this.clouds) cloud.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
