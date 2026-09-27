import { CatmullRomCurve3, Vector3 } from 'three';

export const MODEL_SCALE = 1 / 3;
export const GROUND = 0.25;
export const GAUGE = 0.3 * MODEL_SCALE;
export const LINE_OFFSET = 0.52 * MODEL_SCALE;
export const CAR_SPACING = 1.42 * MODEL_SCALE;
export const WHEEL_RADIUS = 0.085 * MODEL_SCALE;
export const AXLE_OFFSET = 0.38 * MODEL_SCALE;
export const LAP_SECONDS = 75;
export const START_DISTANCE = 2;
export const TUNNEL_HALF_WIDTH = 0.27;
export const TUNNEL_SPRING = 0.31;
export const TUNNEL_ROOF = TUNNEL_SPRING + TUNNEL_HALF_WIDTH;

const curve = new CatmullRomCurve3(
  [
    [-2.7, 3.05],
    [0.4, 3.05],
    [3.6, 2.65],
    [5.35, 1.1],
    [4.75, -1.0],
    [3.1, -2.85],
    [0.65, -2.55],
    [-1.5, -3.05],
    [-3.6, -2.2],
    [-5.15, -0.45],
    [-4.7, 1.05],
    [-4.3, 2.5],
  ].map(([x, z]) => new Vector3(x, 0, z)),
  true,
  'centripetal',
);
curve.arcLengthDivisions = 4096;
const horizontalLength = curve.getLength();
const SAMPLE_COUNT = 4096;
const samples: { point: Vector3; distance: number }[] = [];
for (let i = 0; i <= SAMPLE_COUNT; i++) {
  const u = i / SAMPLE_COUNT;
  const p = curve.getPointAt(u);
  p.y = GROUND + 0.116 * MODEL_SCALE + 0.21 * (1 - Math.cos(u * Math.PI * 2));
  samples.push({
    point: p,
    distance: i ? samples[i - 1].distance + p.distanceTo(samples[i - 1].point) : 0,
  });
}
export const TRACK_LENGTH = samples[SAMPLE_COUNT].distance;
export const BASE_SPEED = TRACK_LENGTH / LAP_SECONDS;
export const ROUTE_SECTIONS = [
  { id: 'hochgrat', kind: 'tunnel', start: 0.395 * TRACK_LENGTH, end: 0.56 * TRACK_LENGTH },
  { id: 'talbruecke', kind: 'bridge', start: 0.595 * TRACK_LENGTH, end: 0.66 * TRACK_LENGTH },
  { id: 'tannenfels', kind: 'tunnel', start: 0.705 * TRACK_LENGTH, end: 0.795 * TRACK_LENGTH },
] as const;
export type RouteSection = (typeof ROUTE_SECTIONS)[number];
export function wrapDistance(distance: number) {
  return ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
}
export function sectionAt(distance: number) {
  const s = wrapDistance(distance);
  return ROUTE_SECTIONS.find((section) => s >= section.start && s <= section.end);
}

/** Distance is measured on the central 3D route; offset is perpendicular in plan view. */
export function trackPose(distance: number, offset = 0) {
  const s = wrapDistance(distance);
  let lo = 0,
    hi = SAMPLE_COUNT;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].distance <= s) lo = mid;
    else hi = mid;
  }
  const a = samples[lo],
    b = samples[hi];
  const f = (s - a.distance) / (b.distance - a.distance);
  const u = (lo + f) / SAMPLE_COUNT;
  const tangent = curve
    .getPointAt((u + 0.00001) % 1)
    .sub(curve.getPointAt((u - 0.00001 + 1) % 1))
    .normalize();
  const grade = (0.42 * Math.PI * Math.sin(u * Math.PI * 2)) / horizontalLength;
  const norm = Math.sqrt(1 + grade * grade);
  const nx = -tangent.z,
    nz = tangent.x;
  return {
    x: a.point.x + (b.point.x - a.point.x) * f + nx * offset,
    y: a.point.y + (b.point.y - a.point.y) * f,
    z: a.point.z + (b.point.z - a.point.z) * f + nz * offset,
    tx: tangent.x / norm,
    ty: grade / norm,
    tz: tangent.z / norm,
    nx,
    nz,
    yaw: Math.atan2(-tangent.z, tangent.x),
    pitch: Math.atan(grade),
  };
}

// Spatial bins bound terrain and vegetation clearance query cost.
const bins = new Map<string, number[]>();
const lookup = Array.from({ length: 1024 }, (_, i) => trackPose((i * TRACK_LENGTH) / 1024));
lookup.forEach((p, i) => {
  const key = `${Math.floor(p.x)},${Math.floor(p.z)}`;
  const bin = bins.get(key) ?? [];
  bin.push(i);
  bins.set(key, bin);
});
export function nearestTrack(x: number, z: number) {
  let best = Infinity,
    index = 0,
    fraction = 0;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      for (const i of bins.get(`${Math.floor(x) + dx},${Math.floor(z) + dz}`) ?? []) {
        const a = lookup[i],
          b = lookup[(i + 1) % lookup.length];
        const vx = b.x - a.x,
          vz = b.z - a.z;
        const f = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)));
        const d = (x - a.x - vx * f) ** 2 + (z - a.z - vz * f) ** 2;
        if (d < best) {
          best = d;
          index = i;
          fraction = f;
        }
      }
    }
  const a = lookup[index],
    b = lookup[(index + 1) % lookup.length];
  const distance = ((index + fraction) * TRACK_LENGTH) / lookup.length;
  return {
    distance,
    clearance: Math.sqrt(best),
    y: a.y + (b.y - a.y) * fraction,
    lateral: (x - a.x) * a.nx + (z - a.z) * a.nz,
    section: sectionAt(distance),
  };
}

export class RailwayWorld {
  distance = START_DISTANCE;
  travel = 0;
  elapsed = 0;
  speed = 1;
  paused = false;
  advance(seconds: number) {
    if (this.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    this.elapsed += seconds * this.speed;
    this.travel += seconds * BASE_SPEED * this.speed;
    this.distance = wrapDistance(START_DISTANCE + this.travel);
  }
  setSpeed(value: number) {
    if (Number.isFinite(value)) this.speed = Math.max(0, Math.min(2, value));
  }
  carDistance(index: number) {
    return wrapDistance(this.distance - index * CAR_SPACING);
  }
  reset() {
    this.distance = START_DISTANCE;
    this.travel = 0;
    this.elapsed = 0;
    this.speed = 1;
    this.paused = false;
  }
  stats() {
    return {
      distance: this.distance,
      travel: this.travel,
      elapsed: this.elapsed,
      speed: this.speed,
      paused: this.paused,
      cars: [0, 1, 2].map((i) => ({
        distance: this.carDistance(i),
        ...trackPose(this.carDistance(i)),
        tunnel:
          sectionAt(this.carDistance(i))?.kind === 'tunnel'
            ? sectionAt(this.carDistance(i))!.id
            : null,
      })),
    };
  }
}
