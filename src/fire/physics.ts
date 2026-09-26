import { Vector3 } from 'three';

export const STICK_LIMIT = 18;
export const ASH_LIMIT = 36;
export const STEP = 1 / 120;
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));

export interface FireStick {
  id: number;
  a: Vector3;
  b: Vector3;
  previousA: Vector3;
  previousB: Vector3;
  length: number;
  radius: number;
  originalRadius: number;
  fuel: number;
  heat: number;
  char: number;
  ember: number;
  flame: number;
}
export interface AshPatch {
  x: number;
  z: number;
  angle: number;
  length: number;
  ember: number;
}

// Closest points on finite line segments, including parallel/degenerate pairs.
const u = new Vector3(),
  v = new Vector3(),
  w = new Vector3();
export function segmentContact(a: Vector3, b: Vector3, c: Vector3, d: Vector3) {
  u.subVectors(b, a);
  v.subVectors(d, c);
  w.subVectors(a, c);
  const aa = u.dot(u),
    bb = u.dot(v),
    cc = v.dot(v),
    dd = u.dot(w),
    ee = v.dot(w);
  const denominator = aa * cc - bb * bb;
  let s = aa < 1e-10 ? 0 : denominator > 1e-10 ? clamp((bb * ee - cc * dd) / denominator) : 0;
  if (cc < 1e-10 && aa >= 1e-10) s = clamp(-dd / aa);
  let t = cc < 1e-10 ? 0 : (bb * s + ee) / cc;
  if (t < 0) {
    t = 0;
    s = aa < 1e-10 ? 0 : clamp(-dd / aa);
  }
  if (t > 1) {
    t = 1;
    s = aa < 1e-10 ? 0 : clamp((bb - dd) / aa);
  }
  return {
    s,
    t,
    dx: a.x + u.x * s - c.x - v.x * t,
    dy: a.y + u.y * s - c.y - v.y * t,
    dz: a.z + u.z * s - c.z - v.z * t,
  };
}

export class FireWorld {
  sticks: FireStick[] = [];
  ash: AshPatch[] = [];
  time = 0;
  paused = false;
  wind = 0.2;
  private accumulator = 0;
  private seed = 517;
  private nextId = 0;
  private heatInputs = new Float64Array(STICK_LIMIT);

  constructor() {
    this.reset();
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private create(center: Vector3, angle: number, burning: boolean) {
    const length = 1.55 + this.random() * 0.55;
    const radius = 0.105 + this.random() * 0.03;
    const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(length / 2);
    const a = center.clone().sub(dir),
      b = center.clone().add(dir);
    const stick: FireStick = {
      id: this.nextId++,
      a,
      b,
      previousA: a.clone(),
      previousB: b.clone(),
      length,
      radius,
      originalRadius: radius,
      fuel: 1,
      heat: burning ? 0.83 : 0,
      char: burning ? 0.12 : 0,
      ember: burning ? 0.7 : 0,
      flame: burning ? 0.8 : 0,
    };
    this.sticks.push(stick);
    return stick;
  }
  reset() {
    this.sticks = [];
    this.ash = [];
    this.seed = 517;
    this.nextId = 0;
    this.time = 0;
    this.accumulator = 0;
    this.paused = false;
    this.wind = 0.2;
    for (let layer = 0; layer < 3; layer++) {
      for (let row = 0; row < 3; row++) {
        const offset = (row - 1) * 0.57;
        this.create(
          new Vector3(layer === 1 ? offset : 0, 0.15 + layer * 0.29, layer === 1 ? 0 : offset),
          layer === 1 ? Math.PI / 2 + 0.08 : -0.08,
          true,
        );
      }
    }
    // Settle supports before showing the initial frame, without aging the fuel.
    for (let i = 0; i < 180; i++) this.integrate();
    for (const s of this.sticks) {
      s.previousA.copy(s.a);
      s.previousB.copy(s.b);
    }
  }
  addWood() {
    if (this.paused || this.sticks.length >= STICK_LIMIT) return false;
    const top = Math.max(0.4, ...this.sticks.map((s) => Math.max(s.a.y, s.b.y) + s.radius));
    this.create(
      new Vector3((this.random() - 0.5) * 0.4, top + 0.45, (this.random() - 0.5) * 0.4),
      this.random() * Math.PI,
      false,
    );
    return true;
  }
  ignite() {
    if (this.paused) return false;
    const fuel = this.sticks.filter((s) => s.fuel > 0.001);
    if (!fuel.length) return false;
    // A short ignition source reaches the base and lets heat spread upward.
    const lowest = fuel.reduce((a, b) => (a.a.y + a.b.y < b.a.y + b.b.y ? a : b));
    lowest.heat = 0.95;
    lowest.ember = 0.65;
    return true;
  }
  setWind(value: number) {
    if (Number.isFinite(value)) this.wind = clamp(value);
  }
  advance(seconds: number) {
    if (this.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    this.accumulator += Math.min(seconds, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      this.burn();
      this.integrate();
    }
  }
  private burn() {
    // Heat input is gathered before mutation so propagation is independent of array order.
    this.sticks.forEach((s, i) => {
      let input = 0;
      for (const other of this.sticks) {
        if (s === other || other.heat < 0.35) continue;
        const contact = segmentContact(s.a, s.b, other.a, other.b);
        const distance = Math.hypot(contact.dx, contact.dy, contact.dz);
        input += Math.max(0, 1 - distance / 1.4) * (other.flame + other.ember * 0.12);
      }
      for (const ash of this.ash) {
        const x = (s.a.x + s.b.x) * 0.5 - ash.x,
          y = (s.a.y + s.b.y) * 0.5,
          z = (s.a.z + s.b.z) * 0.5 - ash.z;
        input += Math.max(0, 1 - Math.hypot(x, y, z) / 1.5) * ash.ember * 1.2;
      }
      this.heatInputs[i] = input;
    });
    this.sticks.forEach((s, i) => {
      const burning = s.heat > 0.48 && s.fuel > 0;
      s.heat = clamp(
        s.heat + STEP * (this.heatInputs[i] * 0.048 + (burning ? 0.1 : 0) - s.heat * 0.06),
      );
      if (burning) {
        const surfaceToMass = 0.12 / s.originalRadius;
        s.fuel = Math.max(
          0,
          s.fuel - STEP * 0.0064 * surfaceToMass * (0.85 + this.wind * 0.35) * s.heat,
        );
        s.char = clamp(s.char + STEP * 0.011 * s.heat);
      }
      const target = burning ? Math.min(1, s.fuel * 9) * s.heat : 0;
      s.flame += (target - s.flame) * STEP * 3;
      s.ember = burning ? Math.min(1, s.ember + STEP * 0.04) : Math.max(0, s.ember - STEP / 55);
      s.radius = s.originalRadius * (0.3 + 0.7 * Math.sqrt(s.fuel));
    });
    for (let i = this.sticks.length - 1; i >= 0; i--) {
      const s = this.sticks[i];
      if (s.fuel <= 0) {
        this.ash.push({
          x: (s.a.x + s.b.x) / 2,
          z: (s.a.z + s.b.z) / 2,
          angle: Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x),
          length: s.length,
          ember: s.ember,
        });
        if (this.ash.length > ASH_LIMIT) this.ash.shift();
        this.sticks.splice(i, 1);
      }
    }
    for (const ash of this.ash) ash.ember = Math.max(0, ash.ember - STEP / 55);
  }
  private integrate() {
    for (const s of this.sticks) {
      for (const [p, previous] of [
        [s.a, s.previousA],
        [s.b, s.previousB],
      ]) {
        const x = p.x,
          y = p.y,
          z = p.z;
        p.x += (p.x - previous.x) * 0.985;
        p.y += (p.y - previous.y) * 0.985 - 9.81 * STEP * STEP;
        p.z += (p.z - previous.z) * 0.985;
        previous.set(x, y, z);
      }
    }
    for (let iteration = 0; iteration < 8; iteration++) {
      for (const s of this.sticks) {
        const dx = s.b.x - s.a.x,
          dy = s.b.y - s.a.y,
          dz = s.b.z - s.a.z;
        const distance = Math.hypot(dx, dy, dz);
        const correction = ((distance - s.length) / Math.max(distance, 1e-8)) * 0.5;
        s.a.x += dx * correction;
        s.a.y += dy * correction;
        s.a.z += dz * correction;
        s.b.x -= dx * correction;
        s.b.y -= dy * correction;
        s.b.z -= dz * correction;
      }
      for (let i = 0; i < this.sticks.length; i++)
        for (let j = i + 1; j < this.sticks.length; j++) {
          const a = this.sticks[i],
            b = this.sticks[j];
          const c = segmentContact(a.a, a.b, b.a, b.b);
          const distance = Math.hypot(c.dx, c.dy, c.dz),
            overlap = a.radius + b.radius - distance;
          if (overlap <= 0) continue;
          const nx = distance > 1e-8 ? c.dx / distance : 0;
          const ny = distance > 1e-8 ? c.dy / distance : -1;
          const nz = distance > 1e-8 ? c.dz / distance : 0;
          const weights = [1 - c.s, c.s, 1 - c.t, c.t];
          const denominator = weights.reduce((sum, n) => sum + n * n, 0);
          [a.a, a.b, b.a, b.b].forEach((p, k) => {
            const amount = ((overlap * weights[k]) / denominator) * (k < 2 ? 1 : -1);
            p.x += nx * amount;
            p.y += ny * amount;
            p.z += nz * amount;
          });
          // Coulomb friction at the contact prevents round sticks rolling off their supports
          // before combustion removes those supports. Corrections are capped by normal load.
          const endpoints = [a.a, a.b, b.a, b.b],
            previous = [a.previousA, a.previousB, b.previousA, b.previousB];
          let tx = 0,
            ty = 0,
            tz = 0;
          endpoints.forEach((p, k) => {
            const weight = weights[k] * (k < 2 ? 1 : -1);
            tx += (p.x - previous[k].x) * weight;
            ty += (p.y - previous[k].y) * weight;
            tz += (p.z - previous[k].z) * weight;
          });
          const normal = tx * nx + ty * ny + tz * nz;
          tx -= normal * nx;
          ty -= normal * ny;
          tz -= normal * nz;
          const friction = Math.min(1, (overlap * 0.85) / Math.max(Math.hypot(tx, ty, tz), 1e-9));
          endpoints.forEach((p, k) => {
            const amount = ((friction * weights[k]) / denominator) * (k < 2 ? 1 : -1);
            p.x -= tx * amount;
            p.y -= ty * amount;
            p.z -= tz * amount;
          });
        }
      for (const s of this.sticks)
        for (const [p, prev] of [
          [s.a, s.previousA],
          [s.b, s.previousB],
        ]) {
          if (p.y < s.radius) {
            p.y = s.radius;
            prev.y = p.y;
            prev.x += (p.x - prev.x) * 0.7;
            prev.z += (p.z - prev.z) * 0.7;
          }
          // Keep fuel in the clearing and within the rendering volume.
          p.x = clamp(p.x, -2.1, 2.1);
          p.z = clamp(p.z, -2.1, 2.1);
          p.y = Math.min(p.y, 3.4);
        }
    }
  }
  get intensity() {
    return this.sticks.reduce((sum, s) => sum + s.flame, 0) / 9;
  }
  get glow() {
    return (
      this.sticks.reduce((sum, s) => sum + s.ember, 0) / 9 +
      this.ash.reduce((sum, a) => sum + a.ember, 0) / 12
    );
  }
  stats() {
    return {
      time: this.time,
      paused: this.paused,
      wind: this.wind,
      intensity: this.intensity,
      glow: this.glow,
      count: this.sticks.length,
      fuel: this.sticks.reduce((sum, s) => sum + s.fuel, 0),
      ashCount: this.ash.length,
      sticks: this.sticks.map((s) => ({
        id: s.id,
        a: s.a.toArray(),
        b: s.b.toArray(),
        radius: s.radius,
        fuel: s.fuel,
        heat: s.heat,
        char: s.char,
        ember: s.ember,
        phase: s.flame > 0.05 ? 'burning' : s.heat > 0.1 ? 'heating' : 'fresh',
      })),
    };
  }
}
