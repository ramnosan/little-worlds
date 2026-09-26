import { WIDTH, DEPTH, WATER_Y } from './tank';

export type KoiVariety = 'showa' | 'tancho' | 'ochiba' | 'koi-1' | 'koi-2' | 'koi-3';
export interface KoiState {
  id: number;
  variety: KoiVariety;
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  speed: number;
  turnRate: number;
  swimEffort: number;
  /** Continuous swim cycles; the renderer maps these to the authored clip duration. */
  animationTime: number;
  target: { x: number; y: number; z: number };
  nextTarget: number;
  wakeTime: number;
}
export interface KoiObstacle {
  x: number;
  y: number;
  z: number;
  radius: number;
}
export interface KoiEnvironment {
  balls: readonly KoiObstacle[];
  sample: (x: number, z: number) => number;
  wake: (x: number, z: number, radius: number, force: number) => unknown;
}
export const KOI_ASSET_LENGTH = 0.48,
  KOI_LENGTH = 0.84,
  KOI_SCALE = KOI_LENGTH / KOI_ASSET_LENGTH,
  KOI_CLEARANCE = 0.27 * KOI_SCALE,
  KOI_MIN_TURN_RADIUS = KOI_LENGTH * 0.65,
  KOI_MAX_TURN = 0.65;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const angle = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
const STARTS = [
  [-1.35, 0.8, 0.1, 0.7],
  [0.1, 1.0, -0.7, 2.0],
];
const VARIETIES: KoiVariety[] = ['showa', 'tancho'];

/** Deterministic steering in metres. Called only from the aquarium's fixed timestep.
 * Conservative body-enclosing spheres scale with the complete fish, including fins.
 */
export class KoiSchool {
  readonly fish: KoiState[] = [];
  enabled = true;
  time = 0;
  private seed = 0x6b6f69;
  private varieties = [...VARIETIES];
  private ripples: { x: number; z: number; expires: number }[] = [];
  constructor() {
    this.reset();
  }
  setVarieties(varieties: KoiVariety[]) {
    if (varieties.length !== STARTS.length) throw new Error('Expected two fish identities');
    this.varieties = [...varieties];
    this.fish.forEach((fish, i) => (fish.variety = varieties[i]));
  }
  reset() {
    this.time = 0;
    this.seed = 0x6b6f69;
    this.ripples = [];
    this.fish.length = 0;
    STARTS.forEach(([x, y, z, heading], id) =>
      this.fish.push({
        id,
        variety: this.varieties[id],
        x,
        y,
        z,
        heading,
        pitch: 0,
        speed: 0.24 + id * 0.025,
        turnRate: 0,
        swimEffort: 0.75,
        animationTime: id * 0.71,
        target: { x: -x, y: 0.85 + id * 0.08, z: -z },
        nextTarget: 3 + id,
        wakeTime: id * 0.09,
      }),
    );
  }
  private random() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }
  respondToRipple(x: number, z: number) {
    if (!this.enabled || !Number.isFinite(x + z)) return;
    if (this.ripples.length === 8) this.ripples.shift();
    this.ripples.push({ x, z, expires: this.time + 2 });
  }
  update(dt: number, env: KoiEnvironment) {
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
    this.time += dt;
    this.ripples = this.ripples.filter((r) => r.expires > this.time);
    // Every fish observes the same snapshot, avoiding iteration-order steering bias.
    const previous = this.fish.map((f) => ({ x: f.x, y: f.y, z: f.z, radius: KOI_CLEARANCE }));
    const obstacles = env.balls;
    for (const f of this.fish) {
      if (
        this.time >= f.nextTarget ||
        Math.hypot(f.target.x - f.x, f.target.z - f.z) < KOI_LENGTH * 0.8
      ) {
        f.target = {
          x: (this.random() - 0.5) * (WIDTH - 1.6),
          y: KOI_CLEARANCE + 0.15 + this.random() * (WATER_Y - KOI_CLEARANCE * 2 - 0.3),
          z: (this.random() - 0.5) * (DEPTH - 1.4),
        };
        f.nextTarget = this.time + 8 + this.random() * 8;
      }
      const dx = f.target.x - f.x,
        dz = f.target.z - f.z,
        len = Math.hypot(dx, dz) || 1;
      let steerX = dx / len,
        steerZ = dz / len,
        vertical = f.target.y - f.y;
      const lookAhead = KOI_LENGTH * 0.65 + f.speed * 0.8,
        aheadX = f.x + Math.sin(f.heading) * lookAhead,
        aheadZ = f.z + Math.cos(f.heading) * lookAhead;
      for (const [axis, limit] of [
        ['x', WIDTH / 2 - KOI_CLEARANCE],
        ['z', DEPTH / 2 - KOI_CLEARANCE],
      ] as const) {
        const ahead = axis === 'x' ? aheadX : aheadZ;
        const force = -Math.sign(ahead) * Math.max(0, 1 - (limit - Math.abs(ahead)) / 0.6) * 3;
        if (axis === 'x') steerX += force;
        else steerZ += force;
      }
      for (const o of [...obstacles, ...previous.filter((_, i) => i !== f.id)]) {
        const ox = aheadX - o.x,
          oy = f.y - o.y,
          oz = aheadZ - o.z;
        const distance = Math.hypot(ox, oy, oz),
          range = o.radius + KOI_CLEARANCE + 0.45;
        if (distance >= range) continue;
        const weight = (1 - distance / range) * 3.5,
          denom = Math.max(distance, 0.03);
        steerX += (ox / denom) * weight;
        steerZ += (oz / denom) * weight;
        vertical += (oy / denom) * weight * 0.2;
        // A deterministic lateral preference prevents head-on stand-offs.
        steerX += Math.cos(f.heading) * weight * 0.4;
        steerZ -= Math.sin(f.heading) * weight * 0.4;
      }
      let startled = 0;
      for (const r of this.ripples) {
        const rx = f.x - r.x,
          rz = f.z - r.z,
          d = Math.hypot(rx, rz);
        const weight = Math.max(0, 1 - d / 1.3) * (r.expires - this.time) * 0.45;
        steerX += (rx / Math.max(d, 0.05)) * weight;
        steerZ += (rz / Math.max(d, 0.05)) * weight;
        startled = Math.max(startled, weight);
      }
      const desired = Math.atan2(steerX, steerZ),
        headingError = angle(desired - f.heading);
      // Ease between short powered swims and coasting. Each fish has its own rhythm;
      // steering and disturbances bring the tail back into action before accelerating.
      const coast = clamp((Math.sin(this.time * 0.75 + f.id * 2.1) - 0.25) / 0.6, 0, 1),
        effort = Math.max(1 - coast * 0.85, Math.min(1, Math.abs(headingError) * 0.55), startled);
      f.swimEffort += (clamp(effort, 0.15, 1) - f.swimEffort) * (1 - Math.exp(-dt * 2.5));
      const cruise = 0.27 + f.id * 0.025,
        speed = cruise * (0.55 + f.swimEffort * 0.45) + Math.min(startled * 0.06, 0.06);
      f.speed += clamp((speed - f.speed) * 1.2 * dt, -0.055 * dt, 0.085 * dt);
      // A speed-dependent radius prevents the body from spinning in place.
      const maxTurn = Math.min(KOI_MAX_TURN, f.speed / KOI_MIN_TURN_RADIUS),
        turn = clamp(headingError * 1.25, -maxTurn, maxTurn);
      f.turnRate += (turn - f.turnRate) * (1 - Math.exp(-dt * 2.8));
      f.turnRate = clamp(f.turnRate, -maxTurn, maxTurn);
      f.heading = angle(f.heading + f.turnRate * dt);
      f.pitch += (clamp(vertical * 0.35, -0.23, 0.23) - f.pitch) * (1 - Math.exp(-dt * 2));
      f.x += Math.sin(f.heading) * Math.cos(f.pitch) * f.speed * dt;
      f.z += Math.cos(f.heading) * Math.cos(f.pitch) * f.speed * dt;
      f.y += Math.sin(f.pitch) * f.speed * dt;
      f.animationTime += dt * (0.18 + f.swimEffort * (0.55 + f.speed * 0.8));
      // Hard contact projection is only a containment backstop; avoidance acts earlier.
      for (const o of obstacles) this.separate(f, o);
      this.contain(f, env);
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < this.fish.length; i++)
        for (let j = i + 1; j < this.fish.length; j++) {
          const a = this.fish[i],
            b = this.fish[j],
            dx = b.x - a.x,
            dy = b.y - a.y,
            dz = b.z - a.z,
            d = Math.hypot(dx, dy, dz);
          if (d >= KOI_CLEARANCE * 2) continue;
          const c = (KOI_CLEARANCE * 2 - d) * 0.5,
            inv = 1 / Math.max(d, 1e-8);
          const nx = d > 1e-8 ? dx * inv : 1,
            ny = dy * inv,
            nz = dz * inv;
          a.x -= nx * c;
          a.y -= ny * c;
          a.z -= nz * c;
          b.x += nx * c;
          b.y += ny * c;
          b.z += nz * c;
        }
      for (const f of this.fish) {
        for (const o of obstacles) this.separate(f, o);
        this.contain(f, env);
      }
    }
    for (const f of this.fish) {
      f.wakeTime -= dt;
      if (f.wakeTime <= 0) {
        f.wakeTime = 0.2;
        const gap = env.sample(f.x, f.z) - f.y;
        if (gap < 0.55)
          env.wake(f.x, f.z, 0.22, Math.min(0.025, Math.max(0, 0.55 - gap) * f.speed * 0.3));
      }
    }
  }
  private separate(f: KoiState, o: KoiObstacle) {
    const dx = f.x - o.x,
      dy = f.y - o.y,
      dz = f.z - o.z,
      d = Math.hypot(dx, dy, dz),
      r = KOI_CLEARANCE + o.radius;
    if (d >= r) return;
    const push = (r - d) / Math.max(d, 1e-8);
    if (d < 1e-8) f.x += r;
    else {
      f.x += dx * push;
      f.y += dy * push;
      f.z += dz * push;
    }
  }
  private contain(f: KoiState, env: KoiEnvironment) {
    f.x = clamp(f.x, -WIDTH / 2 + KOI_CLEARANCE, WIDTH / 2 - KOI_CLEARANCE);
    f.z = clamp(f.z, -DEPTH / 2 + KOI_CLEARANCE, DEPTH / 2 - KOI_CLEARANCE);
    const top =
      Math.min(
        env.sample(f.x, f.z),
        env.sample(f.x - KOI_LENGTH / 2, f.z),
        env.sample(f.x + KOI_LENGTH / 2, f.z),
        env.sample(f.x, f.z - KOI_LENGTH / 2),
        env.sample(f.x, f.z + KOI_LENGTH / 2),
        WATER_Y + 0.3,
      ) - KOI_CLEARANCE;
    f.y = clamp(f.y, KOI_CLEARANCE, top);
  }
  snapshot() {
    return this.fish.map((f) => ({ ...f, target: { ...f.target } }));
  }
}
