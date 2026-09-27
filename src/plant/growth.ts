export const GROWTH_SECONDS = 180;
export const SPEEDS = [1, 5, 20] as const;
export type GrowthSpeed = (typeof SPEEDS)[number];
export type Point = [number, number, number];
export const MAX_PLANTS = 12,
  MAX_ROOTS = 48,
  MAX_ROOT_POINTS = 64;
export const STEP = 1 / 30;
export const BED = {
  halfWidth: 6,
  bottom: -4,
  front: 0.78,
  depth: 1.44,
  plantingTop: -0.65,
  plantingBottom: -1.2,
};
export const STAGES = ['bulb', 'root', 'emergence', 'leaves', 'bud', 'bloom'] as const;
export type GrowthStage = (typeof STAGES)[number];
export type PlacementReason = 'bounds' | 'depth' | 'spacing' | 'capacity';
export type Placement = { ok: true } | { ok: false; reason: PlacementReason };
export const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const smooth = (n: number, lo: number, hi: number) => {
  const p = clamp((n - lo) / (hi - lo));
  return p * p * (3 - 2 * p);
};
export function seededRandom(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}
export interface RootPath {
  parent: number;
  attachment: number;
  points: Point[];
  radius: number;
  direction: Point;
  carry: number;
  nextBranch: number;
}
export interface IrisLeaf {
  length: number;
  targetLength: number;
  angle: number;
  lean: number;
  width: number;
  twist: number;
  droop: number;
}
export interface IrisForm {
  lean: [number, number];
  bend: [number, number];
  flowerSize: number;
  petalWidth: number;
  petalCurl: number;
  headTilt: [number, number];
  palette: number;
  tint: number;
  foliage: number;
  petalVariation: number[];
}
export interface IrisPlant {
  id: number;
  plantedAt: number;
  position: Point;
  rate: number;
  development: number;
  stage: GrowthStage;
  roots: RootPath[];
  leaves: IrisLeaf[];
  shoot: number;
  stalk: number;
  bud: number;
  opening: number;
  height: number;
  rotation: number;
  form: IrisForm;
  crowding: number;
  revision: number;
  rootRevision: number;
  randomState: number;
}
export interface Stone {
  position: Point;
  radius: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function normalized(a: Point): Point {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l) as Point;
}
function random(p: IrisPlant) {
  p.randomState = (Math.imul(p.randomState, 1664525) + 1013904223) >>> 0;
  return p.randomState / 4294967296;
}

// Immutable environmental field. This is resistance, not a hidden moisture mechanic.
export class SoilField {
  readonly stones: Stone[];
  private readonly values: Float32Array;
  constructor(seed = 719) {
    const rng = seededRandom(seed);
    this.values = Float32Array.from({ length: 97 * 33 }, () => rng());
    this.stones = Array.from({ length: 23 }, () => ({
      position: [(rng() - 0.5) * 11.5, -1.65 - rng() * 2, 0.58] as Point,
      radius: 0.05 + rng() * 0.12,
    }));
  }
  resistance(x: number, y: number) {
    const gx = clamp((x + 6) * 8, 0, 95.999),
      gy = clamp(-y * 8, 0, 31.999),
      ix = Math.floor(gx),
      iy = Math.floor(gy),
      u = gx - ix,
      v = gy - iy;
    const a = this.values[iy * 97 + ix] * (1 - u) + this.values[iy * 97 + ix + 1] * u;
    const b = this.values[(iy + 1) * 97 + ix] * (1 - u) + this.values[(iy + 1) * 97 + ix + 1] * u;
    return a * (1 - v) + b * v;
  }
}
class RootGrid {
  private cells = new Map<string, { point: Point; plant: number }[]>();
  private key(x: number, y: number) {
    return x + ',' + y;
  }
  add(point: Point, plant: number) {
    const key = this.key(Math.floor(point[0] / 0.35), Math.floor(point[1] / 0.35));
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push({ point, plant });
  }
  repel(point: Point, plant: number): Point {
    const x = Math.floor(point[0] / 0.35),
      y = Math.floor(point[1] / 0.35),
      out: Point = [0, 0, 0];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const n of this.cells.get(this.key(x + dx, y + dy)) || []) {
          if (n.plant === plant) continue;
          const d = distance(point, n.point);
          if (d < 0.28 && d > 0.001) {
            const force = ((0.28 - d) * 0.018) / d;
            for (let k = 0; k < 3; k++) out[k] += (point[k] - n.point[k]) * force;
          }
        }
    return out;
  }
}
export class PlantWorld {
  readonly soil: SoilField;
  readonly plants: IrisPlant[] = [];
  paused = false;
  speed: GrowthSpeed = 1;
  revision = 0;
  private ticks = 0;
  private accumulator = 0;
  private nextId = 1;
  constructor(readonly seed = 719) {
    this.soil = new SoilField(seed);
  }
  get elapsed() {
    return this.ticks * STEP;
  }
  canPlant(position: Point): Placement {
    if (
      position.length !== 3 ||
      !position.every(Number.isFinite) ||
      Math.abs(position[0]) > 5.6 ||
      position[2] < 0.54 ||
      position[2] > 0.67
    )
      return { ok: false, reason: 'bounds' };
    if (position[1] > BED.plantingTop || position[1] < BED.plantingBottom)
      return { ok: false, reason: 'depth' };
    if (this.plants.length >= MAX_PLANTS) return { ok: false, reason: 'capacity' };
    if (this.plants.some((p) => Math.abs(p.position[0] - position[0]) < 0.78))
      return { ok: false, reason: 'spacing' };
    return { ok: true };
  }
  plantBulb(position: Point): { ok: true; id: number } | { ok: false; reason: PlacementReason } {
    const result = this.canPlant(position);
    if (!result.ok) return result;
    const id = this.nextId++,
      rng = seededRandom(this.seed + id * 104729);
    const p: IrisPlant = {
      id,
      plantedAt: this.elapsed,
      position: [...position],
      rate: 0.85 + rng() * 0.3,
      development: 0,
      stage: 'bulb',
      roots: [],
      leaves: [],
      shoot: 0,
      stalk: 0,
      bud: 0,
      opening: 0,
      height: 3.8 + rng() * 1.9,
      rotation: rng() * 6.28,
      crowding: 1,
      revision: 0,
      rootRevision: 0,
      randomState: (rng() * 4294967296) >>> 0,
      form: {
        lean: [(rng() < 0.5 ? -1 : 1) * (0.085 + rng() * 0.18), (rng() - 0.5) * 0.24],
        bend: [(rng() - 0.5) * 0.85, (rng() - 0.5) * 0.5],
        flowerSize: 0.88 + rng() * 0.38,
        petalWidth: 0.82 + rng() * 0.36,
        petalCurl: 0.75 + rng() * 0.65,
        headTilt: [(rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3],
        palette: [2, 3, 0, 1, 4][Math.floor(rng() * 5)],
        tint: rng(),
        foliage: rng(),
        petalVariation: Array.from({ length: 9 }, () => rng()),
      },
    };
    const leafCount = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < leafCount; i++)
      p.leaves.push({
        length: 0,
        targetLength: (1.5 + rng() * 2.1) * (p.height / 4.7),
        angle: p.rotation + (i % 2 ? Math.PI : 0) + (rng() - 0.5) * 0.95,
        lean: 0.12 + rng() * 0.43,
        width: 0.065 + rng() * 0.08,
        twist: (rng() - 0.5) * 1.3,
        droop: 0.08 + rng() * 0.3,
      });
    this.plants.push(p);
    this.revision++;
    return { ok: true, id };
  }
  reset() {
    this.plants.length = 0;
    this.ticks = 0;
    this.accumulator = 0;
    this.nextId = 1;
    this.speed = 1;
    this.paused = false;
    this.revision++;
  }
  advance(deltaSeconds: number) {
    if (this.paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.accumulator += deltaSeconds * this.speed;
    const count = Math.floor((this.accumulator + 1e-9) / STEP);
    this.accumulator -= count * STEP;
    if (this.accumulator < 0) this.accumulator = 0;
    for (let i = 0; i < count; i++) this.step();
  }
  private step() {
    this.ticks++;
    if (!this.plants.some((p) => p.stage !== 'bloom')) return;
    const rootTick = this.ticks % 6 === 0;
    // Build once from the previous step, then commit every plant's growth.
    const grid = new RootGrid();
    if (rootTick)
      for (const p of this.plants)
        for (const r of p.roots)
          for (let j = 0; j < r.points.length; j += 2) grid.add(r.points[j], p.id);
    const neighbours = this.plants.map((p) =>
      this.plants.reduce(
        (n, q) =>
          n + (p === q ? 0 : Math.max(0, 1 - Math.abs(p.position[0] - q.position[0]) / 2.2)),
        0,
      ),
    );
    this.plants.forEach((p, index) => {
      if (p.stage === 'bloom') return;
      p.crowding = clamp(1 - neighbours[index] * 0.1, 0.75, 1);
      const dt = STEP * p.rate * p.crowding;
      p.development = Math.min(180, p.development + dt);
      const d = p.development;
      if (d > 12) p.shoot = Math.min(1.45, p.shoot + dt * 0.046);
      p.leaves.forEach((leaf, i) => {
        if (d > 28 + i * 9) leaf.length = Math.min(leaf.targetLength, leaf.length + dt * 0.04);
      });
      if (d > 64) p.stalk = Math.min(p.height, p.stalk + (dt * p.height) / 78);
      if (d > 125 && p.stalk > p.height * 0.7) p.bud = Math.min(1, p.bud + dt / 20);
      if (d > 145 && p.bud > 0.9) p.opening = Math.min(1, p.opening + dt / 34.5);
      if (rootTick && d > 3) this.growRoots(p, grid);
      p.stage =
        p.opening >= 1
          ? 'bloom'
          : p.bud > 0
            ? 'bud'
            : p.leaves[0].length > 0.6
              ? 'leaves'
              : p.shoot > -0.02 - p.position[1]
                ? 'emergence'
                : p.roots.length
                  ? 'root'
                  : 'bulb';
      p.revision++;
      this.revision++;
    });
  }
  private growRoots(p: IrisPlant, grid: RootGrid) {
    p.rootRevision++;
    const primaryCount = p.roots.filter((r) => r.parent < 0).length;
    if (primaryCount < 7 && p.development > 3 + primaryCount * 2.1) {
      const angle = (primaryCount / 7) * Math.PI * 2 + p.rotation;
      const start: Point = [
        p.position[0] + Math.cos(angle) * 0.085,
        p.position[1] - 0.28,
        clamp(p.position[2] + Math.sin(angle) * 0.035, 0.555, 0.655),
      ];
      p.roots.push({
        parent: -1,
        attachment: 0,
        points: [start],
        radius: 0.025,
        direction: normalized([Math.cos(angle) * 0.8, -1, Math.sin(angle) * 0.05]),
        carry: 0,
        nextBranch: 9 + Math.floor(random(p) * 7),
      });
    }
    const newRoots: RootPath[] = [];
    p.roots.forEach((r, rootIndex) => {
      if (r.points.length >= MAX_ROOT_POINTS) return;
      const tip = r.points[r.points.length - 1];
      if (tip[1] < -3.74) return;
      r.carry +=
        (0.2 * p.rate * p.crowding * (r.parent < 0 ? 0.031 : 0.023)) /
        (1 + this.soil.resistance(tip[0], tip[1]) * 0.22);
      if (r.carry < 0.055) return;
      r.carry -= 0.055;
      const rep = grid.repel(tip, p.id),
        eps = 0.1;
      const gradient =
        this.soil.resistance(tip[0] - eps, tip[1]) - this.soil.resistance(tip[0] + eps, tip[1]);
      let dir: Point = [
        r.direction[0] * 0.985 + gradient * 0.1 + (random(p) - 0.5) * 0.14 + rep[0],
        r.direction[1] * 0.98 - (r.parent < 0 ? 0.045 : 0.018) + rep[1],
        r.direction[2] * 0.7 + (random(p) - 0.5) * 0.035 + rep[2],
      ];
      for (const stone of this.soil.stones) {
        const dx = tip[0] - stone.position[0],
          dy = tip[1] - stone.position[1],
          d = Math.hypot(dx, dy);
        if (d < stone.radius + 0.17) {
          const f = (stone.radius + 0.17 - d) * 8;
          dir[0] += (dx / (d || 1)) * f;
          dir[1] += (dy / (d || 1)) * f;
        }
      }
      if (Math.abs(tip[0]) > 5.7) dir[0] -= Math.sign(tip[0]) * 0.6;
      dir[1] = Math.min(-0.08, dir[1]);
      dir = normalized(dir);
      const next: Point = [
        clamp(tip[0] + dir[0] * 0.055, -5.85, 5.85),
        clamp(tip[1] + dir[1] * 0.055, -3.87, -0.35),
        clamp(tip[2] + dir[2] * 0.055, 0.555, 0.655),
      ];
      if (
        this.soil.stones.some(
          (s) => Math.hypot(next[0] - s.position[0], next[1] - s.position[1]) < s.radius + 0.015,
        )
      )
        return;
      r.points.push(next);
      r.direction = dir;
      if (
        r.points.length >= r.nextBranch &&
        p.roots.length + newRoots.length < MAX_ROOTS &&
        r.radius > 0.01
      ) {
        const at = r.points.length - 3,
          origin = r.points[at];
        newRoots.push({
          parent: rootIndex,
          attachment: at,
          points: [[...origin]],
          radius: r.radius * 0.54,
          direction: normalized([
            (random(p) < 0.5 ? -1 : 1) * (0.7 + random(p) * 0.3),
            -0.35 - random(p) * 0.25,
            0,
          ]),
          carry: 0,
          nextBranch: 13 + Math.floor(random(p) * 9),
        });
        r.nextBranch += 9 + Math.floor(random(p) * 10);
      }
    });
    p.roots.push(...newRoots);
  }
  snapshot() {
    return {
      elapsed: this.elapsed,
      paused: this.paused,
      speed: this.speed,
      plants: structuredClone(this.plants).map((p) => ({ ...p, age: this.elapsed - p.plantedAt })),
    };
  }
}
