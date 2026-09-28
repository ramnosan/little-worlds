import { AlpineTerrain, channelCenter, clamp, randomSource, TERRAIN } from './terrain';

export type SnowKind = 'powder' | 'wet';
export type Phase = 'ready' | 'fracture' | 'flow' | 'settled';
export interface SnowParcel {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  originX: number;
  originZ: number;
  volume: number;
  radius: number;
  /** 0: slab, 1: moving, 2: deposited, 3: entrainable bed snow. */
  state: 0 | 1 | 2 | 3;
  releaseAt: number;
  speed: number;
  travel: number;
  cell: number;
}
const STEP = 1 / 90;
const CELL = 14,
  NX = 67,
  NZ = 86,
  CELLS = NX * NZ;
const SLAB_COUNT = 1600,
  BED_COUNT = 1000;
export const SNOW = {
  powder: { mu: 0.19, xi: 1350, density: 220, dust: 1 },
  wet: { mu: 0.34, xi: 650, density: 380, dust: 0.12 },
} as const;

/** Educational parcel model, inspired by Voellmy friction; not a RAMMS solver. */
export class AvalancheWorld {
  readonly terrain = new AlpineTerrain();
  readonly parcels: SnowParcel[] = [];
  kind: SnowKind = 'powder';
  depth = 1;
  phase: Phase = 'ready';
  paused = false;
  elapsed = 0;
  peakSpeed = 0;
  front = 0;
  moving = 0;
  entrainedVolume = 0;
  releasedVolume = 0;
  private accumulator = 0;
  private tick = 0;
  private readonly mass = new Float64Array(CELLS);
  private readonly mx = new Float64Array(CELLS);
  private readonly mz = new Float64Array(CELLS);
  private readonly added = new Float64Array(CELLS);
  private readonly ground = { height: 0, dx: 0, dz: 0 };

  constructor() {
    this.reset();
  }
  reset(depth = this.depth, kind = this.kind) {
    this.depth = clamp(Number.isFinite(depth) ? depth : 1, 0.5, 2);
    this.kind = kind;
    this.phase = 'ready';
    this.paused = false;
    this.elapsed =
      this.peakSpeed =
      this.front =
      this.moving =
      this.entrainedVolume =
      this.releasedVolume =
      this.accumulator =
      this.tick =
        0;
    this.parcels.length = 0;
    const random = randomSource(418);
    for (let i = 0; i < SLAB_COUNT + BED_COUNT; i++) {
      const slab = i < SLAB_COUNT;
      // Stratified coverage prevents holes in the release area.
      const z = slab ? -360 + (Math.floor(i / 40) + random()) * 2.3 : -260 + random() * 570;
      const width = slab ? 110 : 92 + (z + 260) * 0.075;
      const x =
        channelCenter(z) + (slab ? ((i % 40) + random()) / 40 - 0.5 : random() - 0.5) * width;
      const volume = slab
        ? (110 * 92 * this.depth) / SLAB_COUNT
        : (570 * 108 * this.depth * 0.22) / BED_COUNT;
      this.parcels.push({
        x,
        z,
        y: this.terrain.sample(x, z, this.ground).height,
        vx: 0,
        vz: 0,
        originX: x,
        originZ: z,
        volume,
        radius: Math.cbrt(volume) * 1.05,
        state: slab ? 0 : 3,
        releaseAt: 0.12 + Math.hypot(x + 35, (z + 320) * 0.65) / 85,
        speed: 0,
        travel: 0,
        cell: 0,
      });
    }
  }
  release() {
    if (this.phase !== 'ready') return false;
    this.phase = 'fracture';
    this.paused = false;
    return true;
  }
  advance(seconds: number) {
    if (
      this.paused ||
      this.phase === 'ready' ||
      this.phase === 'settled' ||
      !Number.isFinite(seconds) ||
      seconds <= 0
    )
      return;
    // Limit catch-up after backgrounding or a stalled frame.
    this.accumulator += Math.min(seconds, 0.2);
    while (this.accumulator + 1e-9 >= STEP) {
      this.step();
      this.accumulator -= STEP;
      if ((this.phase as Phase) === 'settled') {
        this.accumulator = 0;
        break;
      }
    }
  }
  private cellAt(x: number, z: number) {
    return (
      clamp(Math.floor((x - TERRAIN.minX) / CELL), 1, NX - 2) +
      clamp(Math.floor((z - TERRAIN.minZ) / CELL), 1, NZ - 2) * NX
    );
  }
  private step() {
    this.elapsed += STEP;
    this.tick++;
    this.mass.fill(0);
    this.mx.fill(0);
    this.mz.fill(0);
    this.added.fill(0);
    for (const p of this.parcels) {
      if (p.state === 0 && this.elapsed >= p.releaseAt) {
        p.state = 1;
        this.releasedVolume += p.volume;
      }
      p.cell = this.cellAt(p.x, p.z);
      if (p.state !== 1) continue;
      this.mass[p.cell] += p.volume;
      this.mx[p.cell] += p.vx * p.volume;
      this.mz[p.cell] += p.vz * p.volume;
    }
    if (this.tick % 4 === 0) {
      for (const p of this.parcels) {
        if (p.state !== 3) continue;
        const c = p.cell,
          m = this.mass[c];
        if (m > 4 && Math.hypot(this.mx[c], this.mz[c]) / m > 5) {
          p.state = 1;
          this.added[c] += p.volume;
          this.entrainedVolume += p.volume;
        }
      }
    }
    const material = SNOW[this.kind];
    this.moving = 0;
    for (const p of this.parcels) {
      if (p.state !== 1) continue;
      const c = p.cell;
      // Mix newly entrained, stationary snow with flow, conserving cell momentum.
      if (this.added[c] > 0) {
        p.vx = this.mx[c] / (this.mass[c] + this.added[c]);
        p.vz = this.mz[c] / (this.mass[c] + this.added[c]);
      }
      const g = this.terrain.sample(p.x, p.z, this.ground);
      const norm = Math.sqrt(1 + g.dx * g.dx + g.dz * g.dz);
      // Project gravity onto the surface; pressure spreads the dense core laterally.
      const pressureX = clamp(((this.mass[c - 1] - this.mass[c + 1]) / CELL ** 3) * 2.5, -0.9, 0.9);
      const pressureZ = clamp(
        ((this.mass[c - NX] - this.mass[c + NX]) / CELL ** 3) * 2.5,
        -0.9,
        0.9,
      );
      p.vx += ((-9.81 * g.dx) / (norm * norm) + pressureX) * STEP;
      p.vz += ((-9.81 * g.dz) / (norm * norm) + pressureZ) * STEP;
      const vy = g.dx * p.vx + g.dz * p.vz;
      const speed = Math.hypot(p.vx, p.vz, vy);
      const height = Math.max(this.depth * 0.5, (this.mass[c] + this.added[c]) / (CELL * CELL));
      const friction =
        (material.mu * 9.81) / norm + (9.81 * speed * speed) / (material.xi * height);
      const factor = speed > 0 ? Math.max(0, 1 - (friction * STEP) / speed) : 0;
      p.vx *= factor;
      p.vz *= factor;
      p.speed = speed * factor;
      p.x += p.vx * STEP;
      p.z += p.vz * STEP;
      p.y = this.terrain.sample(p.x, p.z, this.ground).height;
      p.travel += p.speed * STEP;
      this.front = Math.max(this.front, Math.hypot(p.x - p.originX, p.z - p.originZ));
      this.peakSpeed = Math.max(this.peakSpeed, p.speed);
      if (
        (p.speed < 0.22 && this.elapsed > 3 && Math.hypot(g.dx, g.dz) < material.mu) ||
        p.x < TERRAIN.minX + 5 ||
        p.x > TERRAIN.maxX - 5 ||
        p.z > TERRAIN.maxZ - 5
      ) {
        p.state = 2;
        p.vx = p.vz = p.speed = 0;
      } else this.moving++;
    }
    this.phase = this.elapsed < 1.6 ? 'fracture' : this.moving > 0 ? 'flow' : 'settled';
  }
  snapshot() {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      paused: this.paused,
      moving: this.moving,
      peakSpeed: this.peakSpeed,
      front: this.front,
      releasedVolume: this.releasedVolume,
      entrainedVolume: this.entrainedVolume,
      depositedVolume: this.parcels.reduce((sum, p) => sum + (p.state === 2 ? p.volume : 0), 0),
      totalVolume: this.parcels.reduce((sum, p) => sum + p.volume, 0),
      kind: this.kind,
      depth: this.depth,
    };
  }
}
