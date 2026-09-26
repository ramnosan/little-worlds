/** Closed-tank wave equation. SI units; fixed 120 Hz steps satisfy the CFL limit.
 * Independent implementation; research and limitations in docs/aquarium-research.md.
 */
import { WIDTH, DEPTH, WATER_Y } from './tank';
import { KoiSchool } from './koi-school';
export { WIDTH, DEPTH, WATER_Y, TANK_HEIGHT } from './tank';
export const NX = 101,
  NZ = 61,
  STEP = 1 / 120,
  BALL_LIMIT = 6;
const DX = WIDTH / (NX - 1),
  DZ = DEPTH / (NZ - 1);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export interface FloatBall {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  color: number;
}
export class AquariumWorld {
  readonly koi = new KoiSchool();
  readonly heights = new Float32Array(NX * NZ);
  readonly velocities = new Float32Array(NX * NZ);
  readonly balls: FloatBall[] = [];
  paused = false;
  waveMaker = true;
  strength = 0.45;
  damping = 0.55;
  time = 0;
  interactions = 0;
  private accumulator = 0;
  private nextId = 0;
  constructor() {
    this.koi.enabled = false; // No invisible fish or wakes while production assets are absent.
    this.reset();
  }
  reset() {
    this.koi.reset();
    this.heights.fill(0);
    this.velocities.fill(0);
    this.balls.length = 0;
    this.time = 0;
    this.accumulator = 0;
    this.nextId = 0;
    this.interactions = 0;
    this.paused = false;
    this.waveMaker = true;
    this.strength = 0.45;
    this.damping = 0.55;
    // Small standing modes present an already moving surface on entry.
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const x = (Math.PI * i) / (NX - 1),
          z = (Math.PI * j) / (NZ - 1);
        this.heights[j * NX + i] =
          0.028 * Math.cos(5 * x) * Math.cos(3 * z) +
          0.018 * Math.cos(9 * x) * Math.cos(5 * z) +
          0.012 * Math.cos(3 * x) * Math.cos(7 * z);
      }
    this.impulse(-1.25, 0.3, 0.48, 1.6);
    this.impulse(1.0, -0.7, 0.6, -1.1);
  }
  /** Zero-net-volume velocity impulse: subtracting its mean prevents water-level drift. */
  impulse(x: number, z: number, radius = 0.3, force = 1) {
    if (this.paused || !Number.isFinite(x + z + radius + force) || radius <= 0) return false;
    if (Math.abs(x) > WIDTH / 2 || Math.abs(z) > DEPTH / 2) return false;
    force = clamp(force, -4, 4);
    let total = 0;
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const r = Math.hypot(i * DX - WIDTH / 2 - x, j * DZ - DEPTH / 2 - z) / radius;
        if (r >= 1) continue;
        const amount = force * 0.5 * (1 + Math.cos(Math.PI * r));
        this.velocities[j * NX + i] += amount;
        total += amount;
      }
    const mean = total / this.heights.length;
    for (let i = 0; i < this.velocities.length; i++) this.velocities[i] -= mean;
    return true;
  }
  ripple(x: number, z: number, charge = 0) {
    if (!Number.isFinite(charge)) return;
    charge = clamp(charge, 0, 1);
    // A wider impulse carries more energy without exceeding the solver's force limit.
    const radius = 0.38 + charge * 1.12;
    const force = 1.3 + this.strength * 2;
    if (this.impulse(x, z, radius, force + (4 - force) * charge)) {
      this.interactions++;
      this.koi.respondToRipple(x, z);
    }
  }
  addBall() {
    if (this.paused || this.balls.length >= BALL_LIMIT) return false;
    const id = this.nextId++;
    this.balls.push({
      id,
      x: -1.8 + (id % 3) * 1.8,
      z: id % 2 ? -0.8 : 0.65,
      y: 2.9,
      vx: 0.12,
      vy: 0,
      vz: -0.08,
      radius: 0.22,
      color: [0xf1bd78, 0xd8e7da, 0xe89079, 0x8cd2d1, 0xc3addc, 0xf1d8a1][id % 6],
    });
    return true;
  }
  sample(x: number, z: number) {
    const gx = clamp((x + WIDTH / 2) / DX, 0, NX - 1.001);
    const gz = clamp((z + DEPTH / 2) / DZ, 0, NZ - 1.001);
    const i = Math.floor(gx),
      j = Math.floor(gz),
      u = gx - i,
      v = gz - j,
      k = j * NX + i;
    return (
      WATER_Y +
      (this.heights[k] * (1 - u) + this.heights[k + 1] * u) * (1 - v) +
      (this.heights[k + NX] * (1 - u) + this.heights[k + NX + 1] * u) * v
    );
  }
  advance(delta: number) {
    if (this.paused || !Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.step();
      this.accumulator -= STEP;
    }
  }
  private step() {
    this.time += STEP;
    const h = this.heights,
      v = this.velocities;
    const damping = Math.exp(-(0.12 + this.damping * 1.4) * STEP);
    // Reflective (zero normal gradient) walls, implemented as missing outward flux.
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const k = j * NX + i,
          c = h[k];
        const lap =
          ((i ? h[k - 1] : c) + (i < NX - 1 ? h[k + 1] : c) - 2 * c) / (DX * DX) +
          ((j ? h[k - NX] : c) + (j < NZ - 1 ? h[k + NX] : c) - 2 * c) / (DZ * DZ);
        const drive = this.waveMaker
          ? Math.cos((Math.PI * i) / (NX - 1)) *
            (Math.sin(this.time * 3.0) + 0.3 * Math.sin(this.time * 5.2 + j * 0.08)) *
            this.strength *
            0.5
          : 0;
        v[k] = (v[k] + (3.24 * lap + drive) * STEP) * damping;
      }
    let mean = 0;
    for (let k = 0; k < h.length; k++) {
      h[k] += v[k] * STEP;
      if (Math.abs(h[k]) > 0.3) {
        h[k] = clamp(h[k], -0.3, 0.3);
        v[k] *= 0.4;
      }
      mean += h[k];
    }
    mean /= h.length;
    for (let k = 0; k < h.length; k++) h[k] -= mean;
    for (const b of this.balls) {
      const surface = this.sample(b.x, b.z);
      const submerged = clamp(surface - (b.y - b.radius), 0, 2 * b.radius);
      // Spherical-cap volume / sphere volume; density ratio 0.55.
      const fraction = (submerged * submerged * (3 * b.radius - submerged)) / (4 * b.radius ** 3);
      b.vy += (-9.81 + (9.81 * fraction) / 0.55 - 4 * fraction * b.vy) * STEP;
      b.vx +=
        (-(this.sample(b.x + DX, b.z) - this.sample(b.x - DX, b.z)) / (2 * DX)) *
        fraction *
        STEP *
        3;
      b.vz +=
        (-(this.sample(b.x, b.z + DZ) - this.sample(b.x, b.z - DZ)) / (2 * DZ)) *
        fraction *
        STEP *
        3;
      b.vx *= Math.exp(-fraction * STEP);
      b.vz *= Math.exp(-fraction * STEP);
      const oldY = b.y;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.z += b.vz * STEP;
      if (oldY - b.radius >= surface && b.y - b.radius < surface)
        this.impulse(b.x, b.z, b.radius * 2.8, clamp(-b.vy * 0.65, 0, 3));
      if (fraction > 0.02 && Math.abs(b.vy) > 0.05)
        this.impulse(b.x, b.z, b.radius * 1.8, -b.vy * STEP * 1.6);
      for (const [axis, speed, limit] of [
        ['x', 'vx', WIDTH / 2 - b.radius],
        ['z', 'vz', DEPTH / 2 - b.radius],
      ] as const) {
        if (Math.abs(b[axis]) > limit) {
          b[axis] = clamp(b[axis], -limit, limit);
          b[speed] *= -0.5;
        }
      }
      if (b.y < b.radius) {
        b.y = b.radius;
        b.vy = Math.abs(b.vy) * 0.3;
      }
    }
    for (let i = 0; i < this.balls.length; i++)
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i],
          b = this.balls[j],
          dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z;
        const distance = Math.hypot(dx, dy, dz),
          radius = a.radius + b.radius;
        if (distance >= radius) continue;
        const nx = distance > 1e-6 ? dx / distance : 1,
          ny = distance > 1e-6 ? dy / distance : 0,
          nz = distance > 1e-6 ? dz / distance : 0;
        const correction = (radius - distance) * 0.5;
        a.x -= nx * correction;
        a.y -= ny * correction;
        a.z -= nz * correction;
        b.x += nx * correction;
        b.y += ny * correction;
        b.z += nz * correction;
        const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
        if (speed < 0) {
          const impulse = -speed * 0.65;
          a.vx -= nx * impulse;
          a.vy -= ny * impulse;
          a.vz -= nz * impulse;
          b.vx += nx * impulse;
          b.vy += ny * impulse;
          b.vz += nz * impulse;
        }
      }
    this.koi.update(STEP, {
      balls: this.balls,
      sample: (x, z) => this.sample(x, z),
      wake: (x, z, radius, force) => this.impulse(x, z, radius, force),
    });
  }
  stats() {
    let peak = 0,
      mean = 0,
      energy = 0;
    for (let i = 0; i < this.heights.length; i++) {
      const h = this.heights[i];
      peak = Math.max(peak, Math.abs(h));
      mean += h;
      energy += h * h + this.velocities[i] ** 2;
    }
    return {
      time: this.time,
      paused: this.paused,
      waveMaker: this.waveMaker,
      interactions: this.interactions,
      balls: this.balls.length,
      peak,
      mean: mean / this.heights.length,
      energy: energy / this.heights.length,
    };
  }
}
