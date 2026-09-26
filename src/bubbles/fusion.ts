import { MeshBasicMaterial, Ray, Vector3, type BufferAttribute } from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { ContactPlane, V3 } from './physics';

export const FILM_OPEN_TIME = 0.15;
export const NECK_TIME = 0.45;
export const SETTLE_TIME = 1.15;
export const FUSION_TIME = 1.35;
export const ATTACHMENT_BLEND_TIME = 0.2;
export const smooth5 = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (10 + t * (-15 + 6 * t));
};
export const visualPhase = (progress: number) =>
  progress + 1e-10 < FILM_OPEN_TIME
    ? 'opening'
    : progress + 1e-10 < NECK_TIME
      ? 'neck'
      : progress + 1e-10 < SETTLE_TIME
        ? 'pulling'
        : 'settling';
/** Starts with zero displacement AND velocity, then hands both to the normal oscillator. */
export function settlingMotion(progress: number) {
  const t = Math.max(0, progress - SETTLE_TIME),
    x = Math.min(1, t / 0.1);
  const envelope = smooth5(x),
    derivative = x < 1 ? (30 * x * x * (1 - x) * (1 - x)) / 0.1 : 0;
  const amplitude = 0.045 * Math.exp(-4 * t),
    wave = Math.sin(11 * t);
  return {
    value: amplitude * envelope * wave,
    velocity: amplitude * (derivative * wave + envelope * (11 * Math.cos(11 * t) - 4 * wave)),
  };
}
export interface SourceLobe {
  readonly id: number;
  readonly radius: number;
  readonly seed?: number;
  readonly age?: number;
  /** Offset from the mass centre at the instant the film opens, in metres. */
  readonly offset: V3;
}
export interface FusionSnapshot {
  readonly survivor: number;
  readonly partner: number;
  readonly phase: 'opening' | 'relaxing';
  readonly progress: number;
  readonly volume: number;
  readonly sourceLobes: readonly SourceLobe[];
  readonly visualPhase: ReturnType<typeof visualPhase>;
}

/** Stable pair hash: choice and drainage delay never depend on frame rate or Math.random. */
export function mergeChoice(a: number, b: number) {
  let h = Math.imul(Math.min(a, b), 73856093) ^ Math.imul(Math.max(a, b), 19349663);
  const random = () => {
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return { eligible: random() < 0.55, delay: 2 + 2 * random() };
}

const insidePlanes = (p: V3, planes: readonly ContactPlane[]) =>
  planes.every(
    ({ normal, offset, region }) =>
      normal.reduce((s, n, k) => s + n * p[k], 0) <= offset + 1e-6 ||
      (region !== undefined &&
        p.reduce((s, v, k) => s + (v - region.center[k]) ** 2, 0) > region.radius ** 2),
  );

/** Segment fraction against the clipped unit shell and its planar films. */
export function sphereHit(
  start: V3,
  travel: V3,
  planes: readonly ContactPlane[],
): number | undefined {
  const a = travel.reduce((s, v) => s + v * v, 0);
  if (a < 1e-16) return;
  const b = start.reduce((s, v, k) => s + v * travel[k], 0);
  const c = start.reduce((s, v) => s + v * v, 0) - 1;
  const discriminant = b * b - a * c;
  const candidates: number[] = [];
  if (c <= 0 && insidePlanes(start, planes)) candidates.push(0);
  if (discriminant >= 0)
    candidates.push((-b - Math.sqrt(discriminant)) / a, (-b + Math.sqrt(discriminant)) / a);
  for (const { normal, offset } of planes) {
    const speed = normal.reduce((s, n, k) => s + n * travel[k], 0);
    if (Math.abs(speed) > 1e-12)
      candidates.push((offset - normal.reduce((s, n, k) => s + n * start[k], 0)) / speed);
  }
  return candidates
    .sort((x, y) => x - y)
    .find((t) => {
      if (t < 0 || t > 1) return false;
      const p = start.map((v, k) => v + travel[k] * t) as V3;
      return Math.hypot(...p) <= 1 + 1e-6 && insidePlanes(p, planes);
    });
}

/** One pooled CPU mesh is the source of truth for rendering AND puncture tests.
 * Coordinates are in combined-radius units. No GPU or DOM is needed by physics tests. */
export class FusionSurface {
  readonly cubes: MarchingCubes;
  private material = new MeshBasicMaterial();
  private ray = new Ray();
  private a = new Vector3();
  private b = new Vector3();
  private c = new Vector3();
  private hit = new Vector3();
  private axisDistances: Float64Array;
  private supportCache = new Map<string, number>();
  private sampledLobes?: readonly SourceLobe[];
  private sampledRadius = 0;
  private sampledTick = -1;
  private centers: V3[] = [
    [0, 0, 0],
    [0, 0, 0],
  ];
  private radii = [1, 1];
  private smoothing = 0;
  private fieldScale = 1;
  private axis: V3 = [1, 0, 0];
  private parallel = 1;
  private transverse = 1;
  gridExtent = 1;
  sourceWeight = 1;
  readonly appearanceLobes: { center: V3; radius: number }[] = [
    { center: [0, 0, 0], radius: 1 },
    { center: [0, 0, 0], radius: 1 },
  ];
  volume = 0;
  bound = 1;
  revision = 0;
  constructor(readonly resolution: number) {
    this.axisDistances = new Float64Array(resolution * 6);
    this.cubes = new MarchingCubes(resolution, this.material, false, false, 12000);
    this.cubes.isolation = 0;
  }
  get geometry() {
    return this.cubes.geometry;
  }

  /** Geometry and puncture tests share a deterministic 60 Hz surface; forces and
   * timers remain at 120 Hz. Never rebuild the same surface for two substeps. */
  updateAtTime(lobes: readonly SourceLobe[], radius: number, progress: number) {
    const tick = Math.max(0, Math.floor((progress - FILM_OPEN_TIME) * 60 + 1e-8));
    if (lobes === this.sampledLobes && radius === this.sampledRadius && tick === this.sampledTick)
      return;
    this.sampledLobes = lobes;
    this.sampledRadius = radius;
    this.sampledTick = tick;
    this.update(lobes, radius, FILM_OPEN_TIME + tick / 60);
  }

  update(lobes: readonly SourceLobe[], radius: number, progress: number) {
    const neck = smooth5((progress - FILM_OPEN_TIME) / (NECK_TIME - FILM_OPEN_TIME));
    const pull = smooth5((progress - NECK_TIME) / (SETTLE_TIME - NECK_TIME));
    const centers = lobes.map(
      (l) => l.offset.map((v) => (v / radius) * (1 - 0.08 * neck) * (1 - pull)) as V3,
    );
    const radii = lobes.map((l) => (l.radius / radius) * (1 - pull) + pull);
    // Fixed for the entire transition, including the final sphere: no swimming grid.
    const extent =
      1.3 * Math.max(1.05, ...lobes.map((l) => (Math.hypot(...l.offset) + l.radius) / radius));
    const smooth = Math.max(1e-6, (0.004 + 0.28 * neck) * (1 - pull));
    this.centers = centers;
    this.radii = radii;
    this.smoothing = smooth;
    this.gridExtent = extent;
    this.sourceWeight = 1 - pull;
    const length = Math.hypot(...lobes[0].offset) || 1;
    this.axis = lobes[0].offset.map((v) => v / length) as V3;
    this.parallel = 1 - settlingMotion(progress).value;
    this.transverse = 1 / Math.sqrt(this.parallel);
    const n = this.resolution;
    const axes = this.axisDistances;
    // The grid is Cartesian: square the six axis offsets once per coordinate,
    // rather than recomputing them (and a general hypot) at every voxel.
    for (let i = 0; i < n; i++) {
      const coordinate = ((2 * i) / n - 1) * extent;
      for (let lobe = 0; lobe < 2; lobe++)
        for (let axis = 0; axis < 3; axis++) {
          const d = coordinate - centers[lobe][axis];
          axes[(lobe * 3 + axis) * n + i] = d * d;
        }
    }
    this.cubes.reset();
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++) {
        const yz0 = axes[n + y] + axes[2 * n + z],
          yz1 = axes[4 * n + y] + axes[5 * n + z];
        const row = y * n + z * n * n;
        for (let x = 0; x < n; x++) {
          const d0 = Math.sqrt(axes[x] + yz0) - radii[0];
          const d1 = Math.sqrt(axes[3 * n + x] + yz1) - radii[1];
          const h = Math.max(smooth - Math.abs(d0 - d1), 0) / smooth;
          this.cubes.field[x + row] = -(Math.min(d0, d1) - h * h * smooth * 0.25);
        }
      }
    this.cubes.update();
    const p = this.cubes.positionArray;
    let signedVolume = 0;
    for (let i = 0; i < this.cubes.count * 3; i += 9)
      signedVolume +=
        (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7]) +
          p[i + 1] * (p[i + 5] * p[i + 6] - p[i + 3] * p[i + 8]) +
          p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) /
        6;
    // Exact volume of the tessellated closed surface, rather than a bounding-sphere estimate.
    const scale = Math.cbrt((4 * Math.PI) / 3 / Math.max(Math.abs(signedVolume), 1e-12));
    this.fieldScale = scale / extent;
    for (let i = 0; i < 2; i++) {
      this.appearanceLobes[i].center = centers[i].map((v) => v * this.fieldScale) as V3;
      this.appearanceLobes[i].radius = radii[i] * this.fieldScale;
    }
    const normals = this.cubes.normalArray;
    let boundSquared = 0;
    for (let i = 0; i < this.cubes.count * 3; i += 3) {
      p[i] *= scale;
      p[i + 1] *= scale;
      p[i + 2] *= scale;
      if (this.parallel !== 1) {
        const dot = p[i] * this.axis[0] + p[i + 1] * this.axis[1] + p[i + 2] * this.axis[2];
        const normalDot =
          normals[i] * this.axis[0] + normals[i + 1] * this.axis[1] + normals[i + 2] * this.axis[2];
        for (let k = 0; k < 3; k++) {
          p[i + k] =
            p[i + k] * this.transverse + this.axis[k] * dot * (this.parallel - this.transverse);
          normals[i + k] =
            normals[i + k] / this.transverse +
            this.axis[k] * normalDot * (1 / this.parallel - 1 / this.transverse);
        }
      }
      boundSquared = Math.max(
        boundSquared,
        p[i] * p[i] + p[i + 1] * p[i + 1] + p[i + 2] * p[i + 2],
      );
    }
    this.bound = Math.sqrt(boundSquared);
    this.supportCache.clear();
    // Only the active triangle range needs uploading, not the entire pool capacity.
    for (const name of ['position', 'normal']) {
      const attribute = this.geometry.getAttribute(name) as BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.cubes.count * 3);
    }
    this.volume = Math.abs(signedVolume) * scale ** 3 * radius ** 3;
    this.geometry.boundingSphere!.radius = this.bound;
    this.revision++;
  }

  /** Signed distance and analytic gradient of the SAME normalized field as the mesh.
   * Local coordinates are in combined-radius units. Two square roots, no vertex scan. */
  sample(point: V3): { distance: number; normal: V3 } {
    const dot = point[0] * this.axis[0] + point[1] * this.axis[1] + point[2] * this.axis[2];
    const x =
      (point[0] / this.transverse +
        this.axis[0] * dot * (1 / this.parallel - 1 / this.transverse)) /
      this.fieldScale;
    const y =
      (point[1] / this.transverse +
        this.axis[1] * dot * (1 / this.parallel - 1 / this.transverse)) /
      this.fieldScale;
    const z =
      (point[2] / this.transverse +
        this.axis[2] * dot * (1 / this.parallel - 1 / this.transverse)) /
      this.fieldScale;
    const ax = x - this.centers[0][0],
      ay = y - this.centers[0][1],
      az = z - this.centers[0][2];
    const bx = x - this.centers[1][0],
      by = y - this.centers[1][1],
      bz = z - this.centers[1][2];
    const la = Math.sqrt(ax * ax + ay * ay + az * az),
      lb = Math.sqrt(bx * bx + by * by + bz * bz);
    const da = la - this.radii[0],
      db = lb - this.radii[1],
      k = this.smoothing;
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (db - da)) / k));
    const d = db * (1 - h) + da * h - k * h * (1 - h);
    let nx = (ax / Math.max(la, 1e-9)) * h + (bx / Math.max(lb, 1e-9)) * (1 - h);
    let ny = (ay / Math.max(la, 1e-9)) * h + (by / Math.max(lb, 1e-9)) * (1 - h);
    let nz = (az / Math.max(la, 1e-9)) * h + (bz / Math.max(lb, 1e-9)) * (1 - h);
    const nd = nx * this.axis[0] + ny * this.axis[1] + nz * this.axis[2];
    nx = nx / this.transverse + this.axis[0] * nd * (1 / this.parallel - 1 / this.transverse);
    ny = ny / this.transverse + this.axis[1] * nd * (1 / this.parallel - 1 / this.transverse);
    nz = nz / this.transverse + this.axis[2] * nd * (1 / this.parallel - 1 / this.transverse);
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-8) return { distance: d * this.fieldScale, normal: [1, 0, 0] };
    return {
      distance: (d * this.fieldScale) / length,
      normal: [nx / length, ny / length, nz / length],
    };
  }

  support(direction: V3) {
    const key = direction.join(',');
    const cached = this.supportCache.get(key);
    if (cached !== undefined) return cached;
    let maximum = 0;
    const p = this.cubes.positionArray;
    for (let i = 0; i < this.cubes.count * 3; i += 3)
      maximum = Math.max(
        maximum,
        p[i] * direction[0] + p[i + 1] * direction[1] + p[i + 2] * direction[2],
      );
    if (this.supportCache.size < 256) this.supportCache.set(key, maximum);
    return maximum;
  }

  intersect(start: V3, travel: V3, planes: readonly ContactPlane[] = []): number | undefined {
    const length = Math.hypot(...travel);
    if (length < 1e-12) return;
    // Conservative segment/sphere rejection only; actual hits still require triangles.
    const t = Math.max(
      0,
      Math.min(1, -start.reduce((s, v, k) => s + v * travel[k], 0) / (length * length)),
    );
    const x = start[0] + travel[0] * t,
      y = start[1] + travel[1] * t,
      z = start[2] + travel[2] * t;
    if (x * x + y * y + z * z > this.bound * this.bound + 1e-10) return;
    this.ray.origin.fromArray(start);
    this.ray.direction.fromArray(travel).divideScalar(length);
    const p = this.cubes.positionArray;
    let nearest = Infinity;
    for (let i = 0; i < this.cubes.count * 3; i += 9) {
      this.a.fromArray(p, i);
      this.b.fromArray(p, i + 3);
      this.c.fromArray(p, i + 6);
      if (!this.ray.intersectTriangle(this.a, this.b, this.c, false, this.hit)) continue;
      const distance = this.hit.distanceTo(this.ray.origin);
      if (
        distance <= length &&
        distance < nearest &&
        insidePlanes(this.hit.toArray() as V3, planes)
      )
        nearest = distance;
    }
    return Number.isFinite(nearest) ? nearest / length : undefined;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
