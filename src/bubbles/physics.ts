import { DartSystem } from './darts';
import {
  FILM_OPEN_TIME,
  FUSION_TIME,
  ATTACHMENT_BLEND_TIME,
  smooth5,
  settlingMotion,
  visualPhase,
  FusionSurface,
  mergeChoice,
  sphereHit,
  type FusionSnapshot,
  type SourceLobe,
} from './fusion';

export type V3 = [number, number, number];
export interface ContactPlane {
  normal: V3;
  offset: number;
  /** A concave fusion shell must only lose the cap inside its neighbor,
   * not a distant lobe that happens to cross the infinite plane. */
  region?: { center: V3; radius: number };
}
// Every possible neighbor at the 32-bubble cap must also clip the shell.
export const MAX_CONTACT_PLANES = 31;
export interface Bubble {
  id: number;
  position: V3;
  velocity: V3;
  radius: number;
  age: number;
  lifetime: number;
  seed: number;
  mass: number;
  contacts: ContactPlane[];
  deformation: number;
  deformationVelocity: number;
  deformationAxis: V3;
  fusionReleaseTime?: number;
}
export const BUBBLE_LIMIT = 32;
export const STEP = 1 / 120;
export interface PairContact {
  a: number;
  b: number;
  duration: number;
  bonded: boolean;
  eligible: boolean;
  delay: number;
  bondedAt: number;
  phase: 'contact' | 'film' | 'queued' | 'opening';
  transfer?: {
    startedAt: number;
    pointA: V3;
    pointB: V3;
    normal: V3;
    centerA: V3;
    centerB: V3;
    filmRadius: number;
  };
}
interface ContactGeometry {
  normal: V3;
  gap: number;
  pointA: V3;
  pointB: V3;
}
export interface SharedFilm {
  readonly a: number;
  readonly b: number;
  readonly center: V3;
  readonly normal: V3;
  readonly radius: number;
  readonly opening: number;
}
interface Fusion {
  survivor: number;
  partner: number;
  progress: number;
  volume: number;
  sourceLobes: SourceLobe[];
  phase: 'opening' | 'relaxing';
  surface: FusionSurface;
}
const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

function separationNormal(a: Bubble, b: Bubble, delta: V3, distance: number): V3 {
  if (distance > 1e-8) return delta.map((v) => v / distance) as V3;
  // Coincident spawns disperse in 3D instead of forming a long one-axis chain.
  const angle = (a.id * 17 + b.id * 31) * 2.399963;
  const y = Math.sin(angle * 0.73) * 0.8,
    radial = Math.sqrt(1 - y * y);
  return [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
}

/** Metre-scale, fixed-step air/film approximation. Warm breath cools, the film drains,
 * and drag couples the very light shell to a continuous spatial wind field. */
export class BubbleWorld {
  readonly darts = new DartSystem();
  bubbles: Bubble[] = [];
  time = 0;
  wind = 0.45;
  paused = false;
  created = 0;
  onPop?: (bubble: Bubble) => void;
  private accumulator = 0;
  private drag: { id: number; target: V3 } | null = null;

  get dragState() {
    return this.drag ? { id: this.drag.id, target: [...this.drag.target] as V3 } : null;
  }
  beginDrag(id: number, target: V3) {
    if (this.paused || !target.every(Number.isFinite) || !this.bubbles.some((b) => b.id === id))
      return false;
    this.drag = { id, target: [...target] };
    return true;
  }
  updateDrag(target: V3) {
    if (this.drag && !this.paused && target.every(Number.isFinite)) this.drag.target = [...target];
  }
  endDrag() {
    this.drag = null;
  }
  private nextId = 1;
  private transitions: Fusion[] = [];
  private pool: FusionSurface[] = [];
  private reduced = false;
  private pendingQuality: boolean | undefined;
  private films: SharedFilm[] = [];
  private pairs = new Map<string, PairContact>();
  private stepCorrection = 0;
  private peakCorrection = 0;
  private stepCorrectionRatio = 0;

  get bonds() {
    return [...this.pairs.values()]
      .filter((pair) => pair.bonded)
      .map((pair) => ({
        ...pair,
        ...(pair.transfer
          ? {
              transfer: {
                ...pair.transfer,
                pointA: [...pair.transfer.pointA] as V3,
                pointB: [...pair.transfer.pointB] as V3,
                normal: [...pair.transfer.normal] as V3,
                centerA: [...pair.transfer.centerA] as V3,
                centerB: [...pair.transfer.centerB] as V3,
              },
            }
          : {}),
      }));
  }

  get fusions(): readonly FusionSnapshot[] {
    return this.transitions.map(({ surface: _surface, ...f }) => ({
      ...f,
      visualPhase: visualPhase(f.progress),
      sourceLobes: f.sourceLobes.map((l) => ({ ...l, offset: [...l.offset] as V3 })),
    }));
  }
  get fusionMotion() {
    return {
      maxStepCorrection: this.stepCorrection,
      maxCorrection: this.peakCorrection,
      maxStepCorrectionRatio: this.stepCorrectionRatio,
    };
  }
  fusionAppearanceFor(id: number) {
    const f = this.transitions.find((f) => f.survivor === id && f.phase === 'relaxing');
    return f
      ? {
          weight: f.surface.sourceWeight,
          lobes: f.surface.appearanceLobes,
          sources: f.sourceLobes,
          elapsed: f.progress - FILM_OPEN_TIME,
        }
      : undefined;
  }
  get sharedFilms(): readonly SharedFilm[] {
    return this.films.map((f) => ({
      ...f,
      center: [...f.center] as V3,
      normal: [...f.normal] as V3,
    }));
  }
  get fusionResources() {
    return {
      active: this.transitions.length,
      pooled: this.pool.length,
      resolution: this.reduced ? 24 : 32,
      limit: this.reduced ? 1 : 2,
      queued: this.bonds.filter((p) => p.phase === 'queued').map((p) => [p.a, p.b]),
    };
  }
  surfaceFor(id: number) {
    return this.transitions.find((f) => f.survivor === id && f.phase === 'relaxing')?.surface;
  }
  setQuality(reduced: boolean) {
    if (this.transitions.length) {
      this.pendingQuality = reduced;
      return;
    }
    this.pendingQuality = undefined;
    this.reduced = reduced;
    // Quality changes take effect for new transitions. Active ones keep their reserved
    // surfaces until completion, avoiding a discontinuity or a lost connected bubble.
    for (const surface of this.pool) surface.dispose();
    this.pool = [];
  }
  /** start/travel are relative to the bubble centre, in metres. */
  hitBubble(id: number, start: V3, travel: V3): number | undefined {
    const b = this.bubbles.find((b) => b.id === id);
    if (!b) return;
    const local = start.map((v) => v / b.radius) as V3;
    const direction = travel.map((v) => v / b.radius) as V3;
    const surface = this.surfaceFor(id);
    let nearest = surface
      ? surface.intersect(local, direction, b.contacts)
      : sphereHit(local, direction, b.contacts);
    // A transition can retain external planar films. Test the same finite discs
    // that are drawn, as well as the clipped outer triangles.
    if (surface)
      for (const film of this.films) {
        if (film.a !== id && film.b !== id) continue;
        const speed = film.normal.reduce((s, n, k) => s + n * travel[k], 0);
        if (Math.abs(speed) < 1e-12) continue;
        const center = film.center.map((v, k) => v - b.position[k]) as V3;
        const t = film.normal.reduce((s, n, k) => s + n * (center[k] - start[k]), 0) / speed;
        if (t < 0 || t > 1 || (nearest !== undefined && t >= nearest)) continue;
        const distance = Math.hypot(...start.map((v, k) => v + travel[k] * t - center[k]));
        if (distance <= film.radius && distance >= film.radius * film.opening) nearest = t;
      }
    return nearest;
  }
  private releaseFusion(f: Fusion) {
    this.transitions.splice(this.transitions.indexOf(f), 1);
    if (
      f.surface.resolution === (this.reduced ? 24 : 32) &&
      this.pool.length + this.transitions.length < (this.reduced ? 1 : 2)
    )
      this.pool.push(f.surface);
    else f.surface.dispose();
  }
  private boundRadius(b: Bubble) {
    return b.radius * (this.surfaceFor(b.id)?.bound ?? 1);
  }

  private fieldAt(b: Bubble, point: V3) {
    const surface = this.surfaceFor(b.id);
    const relative = point.map((v, k) => (v - b.position[k]) / b.radius) as V3;
    if (surface) {
      const sample = surface.sample(relative);
      return { distance: sample.distance * b.radius, normal: sample.normal };
    }
    const length = Math.hypot(...relative);
    return {
      distance: (length - 1) * b.radius,
      normal: (length > 1e-9 ? relative.map((v) => v / length) : [1, 0, 0]) as V3,
    };
  }

  private contactGeometry(a: Bubble, b: Bubble, pair?: PairContact): ContactGeometry {
    const sa = this.surfaceFor(a.id),
      sb = this.surfaceFor(b.id);
    let result: ContactGeometry;
    if (!sa && !sb) {
      const delta = b.position.map((v, k) => v - a.position[k]) as V3;
      const length = Math.hypot(...delta),
        normal = separationNormal(a, b, delta, length);
      result = {
        normal,
        gap: length - a.radius - b.radius,
        pointA: a.position.map((v, k) => v + normal[k] * a.radius) as V3,
        pointB: b.position.map((v, k) => v - normal[k] * b.radius) as V3,
      };
    } else if (!sa) {
      const reverse = this.contactGeometry(b, a);
      result = {
        normal: reverse.normal.map((v) => -v) as V3,
        gap: reverse.gap,
        pointA: reverse.pointB,
        pointB: reverse.pointA,
      };
    } else if (!sb) {
      const { distance, normal } = this.fieldAt(a, b.position);
      result = {
        normal,
        gap: distance - b.radius,
        pointA: b.position.map((v, k) => v - normal[k] * distance) as V3,
        pointB: b.position.map((v, k) => v - normal[k] * b.radius) as V3,
      };
    } else {
      // Alternating local projections handle two neighboring nonconvex fusion fields.
      let pointB: V3 = [...b.position],
        pointA: V3 = [...a.position];
      for (let i = 0; i < 3; i++) {
        const sampleA = this.fieldAt(a, pointB);
        pointA = pointB.map((v, k) => v - sampleA.normal[k] * sampleA.distance) as V3;
        const sampleB = this.fieldAt(b, pointA);
        pointB = pointA.map((v, k) => v - sampleB.normal[k] * sampleB.distance) as V3;
      }
      const sample = this.fieldAt(a, pointB);
      result = {
        normal: sample.normal,
        gap: sample.distance,
        pointA: pointB.map((v, k) => v - sample.normal[k] * sample.distance) as V3,
        pointB,
      };
    }
    if (pair?.transfer) {
      const transfer = pair.transfer;
      const t = smooth5((this.time - transfer.startedAt) / ATTACHMENT_BLEND_TIME);
      if (t >= 1) delete pair.transfer;
      else {
        const normal = result.normal.map((v, k) => transfer.normal[k] * (1 - t) + v * t) as V3;
        const length = Math.hypot(...normal) || 1;
        result.normal = normal.map((v) => v / length) as V3;
        result.pointA = result.pointA.map(
          (v, k) => (a.position[k] + transfer.pointA[k]) * (1 - t) + v * t,
        ) as V3;
        result.pointB = result.pointB.map(
          (v, k) => (b.position[k] + transfer.pointB[k]) * (1 - t) + v * t,
        ) as V3;
        result.gap = result.normal.reduce(
          (s, n, k) => s + n * (result.pointB[k] - result.pointA[k]),
          0,
        );
      }
    }
    return result;
  }

  spawn(radius: number, position: V3, count = true): Bubble | null {
    if (this.bubbles.length >= BUBBLE_LIMIT) return null;
    const id = this.nextId++;
    const seed = (((id * 16807) % 2147483647) / 2147483647) * 10000;
    radius = Math.max(0.12, Math.min(1.25, radius));
    const bubble: Bubble = {
      id,
      seed,
      radius,
      // Relative film mass plus entrained-air inertia. Kept additive during coalescence.
      mass: radius * radius + 0.2 * radius ** 3,
      contacts: [],
      deformation: 0,
      deformationVelocity: 0,
      deformationAxis: [1, 0, 0],
      position: [...position],
      velocity: [0.12, 0.24, -0.18],
      age: 0,
      lifetime: 26 + (Math.sin(seed * 7.3) * 0.5 + 0.5) * 20,
    };
    this.bubbles.push(bubble);
    if (count) this.created++;
    return bubble;
  }

  pop(id: number) {
    if (this.drag?.id === id) this.endDrag();
    const index = this.bubbles.findIndex((b) => b.id === id);
    if (index < 0) return;
    for (const pair of this.bonds) {
      if (pair.a !== id && pair.b !== id) continue;
      const neighbor = this.bubbles.find((b) => b.id === (pair.a === id ? pair.b : pair.a));
      if (neighbor)
        neighbor.deformationVelocity = Math.max(
          -0.25,
          Math.min(0.25, neighbor.deformationVelocity + 0.16),
        );
    }
    for (const f of [...this.transitions])
      if (f.survivor === id || (f.phase === 'opening' && f.partner === id)) this.releaseFusion(f);
    const [bubble] = this.bubbles.splice(index, 1);
    this.forgetContacts(bubble.id);
    this.onPop?.(bubble);
  }

  advance(delta: number) {
    if (this.paused || !Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
  }

  private step(dt: number) {
    const previous = new Map<number, V3>();
    const openingCenters = new Map<number, V3>();
    if (this.darts.projectiles.length)
      for (const b of this.bubbles) previous.set(b.id, [...b.position]);
    if (this.darts.projectiles.length)
      for (const f of this.transitions) {
        if (f.phase !== 'opening') continue;
        const a = this.bubbles.find((b) => b.id === f.survivor)!,
          b = this.bubbles.find((b) => b.id === f.partner)!;
        openingCenters.set(
          a.id,
          a.position.map((v, k) => (v * a.mass + b.position[k] * b.mass) / (a.mass + b.mass)) as V3,
        );
      }
    this.time += dt;
    for (const b of [...this.bubbles]) {
      b.deformationVelocity += (-110 * b.deformation - 9 * b.deformationVelocity) * dt;
      b.deformation = Math.max(-0.07, Math.min(0.14, b.deformation + b.deformationVelocity * dt));
      b.age += dt;
      const [x, y, z] = b.position;
      const t = this.time;
      // Smooth eddies, shared by nearby bubbles; no per-frame random acceleration.
      const air: V3 = [
        this.wind * (0.34 + 0.28 * Math.sin(y * 0.65 + t * 0.31) + 0.16 * Math.cos(z + t * 0.21)),
        this.wind * (0.14 + 0.15 * Math.sin(x * 0.55 + t * 0.37)),
        this.wind * 0.22 * Math.cos(x * 0.4 + y * 0.3 + t * 0.27),
      ];
      const relaxation = 1.6 / Math.sqrt(b.radius);
      // Initial thermal lift decays; a soap film is heavier than the displaced air.
      const verticalAcceleration = 0.37 * Math.exp(-b.age / 9) - 0.1 / b.radius;
      const pull =
        this.drag?.id === b.id
          ? this.drag.target.map((v, k) => 65 * (v - b.position[k]) - 12 * b.velocity[k])
          : [0, 0, 0];
      const pullScale = Math.min(1, 60 / (Math.hypot(...pull) || 1));
      for (let axis = 0; axis < 3; axis++) {
        b.velocity[axis] +=
          ((air[axis] - b.velocity[axis]) * relaxation +
            (axis === 1 ? verticalAcceleration : 0) +
            pull[axis] * pullScale) *
          dt;
      }
      if (this.drag?.id === b.id) {
        const scale = Math.min(1, 8 / (Math.hypot(...b.velocity) || 1));
        b.velocity = b.velocity.map((v) => v * scale) as V3;
      }
      for (let axis = 0; axis < 3; axis++) {
        b.position[axis] += b.velocity[axis] * dt;
      }
      if (
        b.age >= b.lifetime ||
        y - b.radius < -2.9 ||
        Math.abs(x) > 13 ||
        y > 12 ||
        Math.abs(z) > 12
      )
        this.pop(b.id);
    }
    this.solveContacts(dt);
    this.advanceFusions(dt);
    this.projectContacts();
    this.updateContactPlanes();
    // Ownership changes to the mass centre at opening; that change of coordinates
    // must not look like a fast translation to the swept dart test.
    for (const f of this.transitions)
      if (f.phase === 'relaxing' && openingCenters.has(f.survivor))
        previous.set(f.survivor, openingCenters.get(f.survivor)!);
    this.darts.advance(
      dt,
      [...this.bubbles],
      previous,
      (id) => this.pop(id),
      (id, start, travel) => this.hitBubble(id, start, travel),
    );
  }

  throwDart(origin: V3, direction: V3) {
    return this.paused ? null : this.darts.launch(origin, direction);
  }

  private forgetContacts(id: number) {
    for (const [key, pair] of this.pairs)
      if (pair.a === id || pair.b === id) this.pairs.delete(key);
    this.updateContactPlanes();
  }

  private merge(a: Bubble, b: Bubble, fusion: Fusion) {
    if (this.drag?.id === b.id) this.drag.id = a.id;
    const attachments = new Map<string, ContactGeometry>();
    const attachmentFilms = new Map(this.films.map((f) => [pairKey(f.a, f.b), f]));
    for (const [key, pair] of this.pairs) {
      if (!pair.bonded || ![pair.a, pair.b].some((id) => id === a.id || id === b.id)) continue;
      const x = this.bubbles.find((b) => b.id === pair.a)!,
        y = this.bubbles.find((b) => b.id === pair.b)!;
      attachments.set(key, this.contactGeometry(x, y, pair));
    }
    const mass = a.mass + b.mass;
    const center = a.position.map((v, k) => (v * a.mass + b.position[k] * b.mass) / mass) as V3;
    fusion.sourceLobes = [a, b].map((l) => ({
      id: l.id,
      radius: l.radius,
      seed: l.seed,
      age: l.age,
      offset: l.position.map((v, k) => v - center[k]) as V3,
    }));
    for (let k = 0; k < 3; k++) {
      a.position[k] = center[k];
      a.velocity[k] = (a.velocity[k] * a.mass + b.velocity[k] * b.mass) / mass;
    }
    a.radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
    const remaining = Math.min(a.lifetime - a.age, b.lifetime - b.age);
    a.age = (a.age * a.mass + b.age * b.mass) / mass;
    a.lifetime = a.age + remaining;
    a.mass = mass;
    a.deformation = a.deformationVelocity = 0;
    this.bubbles.splice(this.bubbles.indexOf(b), 1);
    const transferred = [...this.pairs.values()].sort(
      (p, q) => p.bondedAt - q.bondedAt || p.a - q.a || p.b - q.b,
    );
    this.pairs.clear();
    for (const pair of transferred) {
      const x = pair.a === b.id ? a.id : pair.a,
        y = pair.b === b.id ? a.id : pair.b;
      if (x === y) continue;
      const key = pairKey(x, y);
      const existing = this.pairs.get(key);
      if (!existing || (!existing.bonded && pair.bonded)) {
        const next = { ...pair, a: Math.min(x, y), b: Math.max(x, y) };
        const old = attachments.get(pairKey(pair.a, pair.b));
        if (old) {
          const first = this.bubbles.find((b) => b.id === next.a)!,
            second = this.bubbles.find((b) => b.id === next.b)!;
          const pa = x < y ? old.pointA : old.pointB,
            pb = x < y ? old.pointB : old.pointA;
          const film = attachmentFilms.get(pairKey(pair.a, pair.b));
          const filmCenter = film?.center ?? (pa.map((v, k) => (v + pb[k]) * 0.5) as V3);
          next.transfer = {
            startedAt: this.time,
            pointA: pa.map((v, k) => v - first.position[k]) as V3,
            pointB: pb.map((v, k) => v - second.position[k]) as V3,
            normal: old.normal.map((v) => (x < y ? v : -v)) as V3,
            centerA: filmCenter.map((v, k) => v - first.position[k]) as V3,
            centerB: filmCenter.map((v, k) => v - second.position[k]) as V3,
            filmRadius: film?.radius ?? 0,
          };
        }
        this.pairs.set(key, next);
      }
    }
    fusion.phase = 'relaxing';
  }

  private advanceFusions(dt: number) {
    for (const f of [...this.transitions]) {
      const a = this.bubbles.find((b) => b.id === f.survivor);
      const b = this.bubbles.find((b) => b.id === f.partner);
      if (!a || (f.phase === 'opening' && (!b || !this.pairs.has(pairKey(a.id, b.id))))) {
        this.releaseFusion(f);
        continue;
      }
      f.progress = Math.min(FUSION_TIME, f.progress + dt);
      if (f.phase === 'opening' && f.progress + 1e-10 >= FILM_OPEN_TIME) this.merge(a, b!, f);
      if (f.phase === 'relaxing') {
        const motion = settlingMotion(f.progress);
        a.deformation = motion.value;
        a.deformationVelocity = motion.velocity;
        const length = Math.hypot(...f.sourceLobes[0].offset) || 1;
        a.deformationAxis = f.sourceLobes[0].offset.map((v) => v / length) as V3;
      }
      if (f.progress + 1e-10 >= FUSION_TIME) {
        a.fusionReleaseTime = this.time;
        a.deformationAxis = [...f.sourceLobes[0].offset];
        const length = Math.hypot(...a.deformationAxis) || 1;
        a.deformationAxis = a.deformationAxis.map((v) => v / length) as V3;
        this.releaseFusion(f);
      } else if (f.phase === 'relaxing')
        f.surface.updateAtTime(f.sourceLobes, a.radius, f.progress);
    }
    if (this.pendingQuality !== undefined) {
      if (this.transitions.length) return;
      this.setQuality(this.pendingQuality);
    }
    const busy = new Set(this.transitions.flatMap((f) => [f.survivor, f.partner]));
    const queue = [...this.pairs.values()]
      .filter(
        (p) => p.bonded && p.eligible && p.phase !== 'opening' && this.time - p.bondedAt >= p.delay,
      )
      .sort((p, q) => p.bondedAt + p.delay - (q.bondedAt + q.delay) || p.a - q.a || p.b - q.b);
    for (const p of queue) {
      p.phase = 'queued';
      if (this.transitions.length >= (this.reduced ? 1 : 2) || busy.has(p.a) || busy.has(p.b))
        continue;
      const a = this.bubbles.find((b) => b.id === p.a)!,
        b = this.bubbles.find((b) => b.id === p.b)!;
      const center = a.position.map(
        (v, k) => (v * a.mass + b.position[k] * b.mass) / (a.mass + b.mass),
      ) as V3;
      this.transitions.push({
        survivor: a.id,
        partner: b.id,
        progress: 0,
        phase: 'opening',
        volume: ((4 * Math.PI) / 3) * (a.radius ** 3 + b.radius ** 3),
        sourceLobes: [a, b].map((l) => ({
          id: l.id,
          radius: l.radius,
          offset: l.position.map((v, k) => v - center[k]) as V3,
        })),
        surface: this.pool.pop() ?? new FusionSurface(this.reduced ? 24 : 32),
      });
      p.phase = 'opening';
      busy.add(p.a);
      busy.add(p.b);
    }
  }

  private solveContacts(dt: number) {
    const seen = new Set<string>();
    for (let i = 0; i < this.bubbles.length; i++) {
      for (let j = i + 1; j < this.bubbles.length; j++) {
        const a = this.bubbles[i],
          b = this.bubbles[j];
        const d = b.position.map((v, k) => v - a.position[k]) as V3;
        const distance = Math.hypot(...d);
        const small = Math.min(a.radius, b.radius);
        const key = pairKey(a.id, b.id);
        let pair = this.pairs.get(key);
        if (
          distance >
          this.boundRadius(a) + this.boundRadius(b) + (pair?.bonded ? small * 0.18 : 0.002)
        ) {
          this.pairs.delete(key);
          continue;
        }
        const { normal, gap } = this.contactGeometry(a, b, pair);
        const relative = normal.reduce((s, n, k) => s + n * (b.velocity[k] - a.velocity[k]), 0);
        if (gap > (pair?.bonded ? small * 0.18 : 0.002) || (pair?.bonded && relative > 0.65)) {
          this.pairs.delete(key);
          continue;
        }
        seen.add(key);
        if (!pair) {
          pair = {
            a: a.id,
            b: b.id,
            duration: 0,
            bonded: false,
            ...mergeChoice(a.id, b.id),
            bondedAt: 0,
            phase: 'contact',
          };
          this.pairs.set(key, pair);
          if (relative < -0.03) {
            const impulse = -relative * 0.65;
            a.deformationAxis = [...normal];
            b.deformationAxis = [...normal];
            a.deformationVelocity += (impulse * b.mass) / (a.mass + b.mass);
            b.deformationVelocity += (impulse * a.mass) / (a.mass + b.mass);
          }
        }
        // Adhesion only forms after a sustained, gentle meeting, never at a distance.
        if (Math.abs(relative) < 0.24) pair.duration += dt;
        else if (!pair.bonded) pair.duration = 0;
        if (!pair.bonded && pair.duration + 1e-10 >= 0.12) {
          pair.bonded = true;
          pair.bondedAt = this.time;
          pair.phase = 'film';
        }
        const inverseMass = 1 / a.mass + 1 / b.mass;
        // Drainage dissipates normal motion; tangential velocity is free to slide.
        let impulse = relative < 0 ? (-(1 + (pair.bonded ? 0 : 0.16)) * relative) / inverseMass : 0;
        if (pair.bonded) {
          const acceleration = Math.max(-2, Math.min(2, (gap + small * 0.1) * 38 + relative * 7));
          impulse -= (acceleration * dt) / inverseMass;
        }
        for (let k = 0; k < 3; k++) {
          a.velocity[k] -= (normal[k] * impulse) / a.mass;
          b.velocity[k] += (normal[k] * impulse) / b.mass;
        }
      }
    }
    for (const key of this.pairs.keys()) if (!seen.has(key)) this.pairs.delete(key);
  }

  private projectContacts() {
    this.stepCorrection = this.stepCorrectionRatio = 0;
    const affected = new Set(
      this.bubbles
        .filter((b) => this.surfaceFor(b.id) || this.time - (b.fusionReleaseTime ?? -10) < 0.2)
        .map((b) => b.id),
    );
    // Include the attached component: a correction cannot escape the limit through a neighbor.
    if (affected.size)
      for (let pass = 0; pass < this.bubbles.length; pass++) {
        let changed = false;
        for (const p of this.pairs.values())
          if (p.bonded && (affected.has(p.a) || affected.has(p.b))) {
            if (!affected.has(p.a) || !affected.has(p.b)) changed = true;
            affected.add(p.a);
            affected.add(p.b);
          }
        if (!changed) break;
      }
    const budgets = new Map<number, number>(),
      spent = new Map<number, number>();
    if (affected.size)
      for (let i = 0; i < this.bubbles.length; i++)
        for (let j = i + 1; j < this.bubbles.length; j++) {
          const a = this.bubbles[i],
            b = this.bubbles[j];
          if (!affected.has(a.id) && !affected.has(b.id)) continue;
          const distance = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
          const bonded = this.pairs.get(pairKey(a.id, b.id))?.bonded;
          if (
            !bonded &&
            distance >
              this.boundRadius(a) + this.boundRadius(b) + 0.18 * Math.min(a.radius, b.radius)
          )
            continue;
          const limit = 0.02 * Math.min(a.radius, b.radius);
          budgets.set(a.id, Math.min(budgets.get(a.id) ?? Infinity, limit));
          budgets.set(b.id, Math.min(budgets.get(b.id) ?? Infinity, limit));
        }
    for (let pass = 0; pass < 8; pass++)
      for (let i = 0; i < this.bubbles.length; i++)
        for (let j = i + 1; j < this.bubbles.length; j++) {
          const a = this.bubbles[i],
            b = this.bubbles[j],
            pair = this.pairs.get(pairKey(a.id, b.id));
          const distance = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
          if (!pair?.bonded && distance > this.boundRadius(a) + this.boundRadius(b)) continue;
          const { normal, gap } = this.contactGeometry(a, b, pair);
          const small = Math.min(a.radius, b.radius);
          let correction = -gap - small * (pair?.bonded ? 0.1 : 0.018);
          if (correction <= 0) {
            if (!pair?.bonded || gap <= -small * 0.01) continue;
            correction = -gap - small * 0.01;
          }
          const wa = b.mass / (a.mass + b.mass),
            wb = 1 - wa;
          let fraction = 1;
          for (const [body, weight] of [
            [a, wa],
            [b, wb],
          ] as const) {
            const limit = budgets.get(body.id);
            if (limit !== undefined)
              fraction = Math.min(
                fraction,
                Math.max(0, limit - (spent.get(body.id) ?? 0)) / (Math.abs(correction) * weight),
              );
          }
          correction *= fraction;
          for (let k = 0; k < 3; k++) {
            a.position[k] -= normal[k] * correction * wa;
            b.position[k] += normal[k] * correction * wb;
          }
          for (const [body, weight] of [
            [a, wa],
            [b, wb],
          ] as const)
            if (budgets.has(body.id)) {
              const total = (spent.get(body.id) ?? 0) + Math.abs(correction) * weight;
              spent.set(body.id, total);
              this.stepCorrection = Math.max(this.stepCorrection, total);
              this.stepCorrectionRatio = Math.max(
                this.stepCorrectionRatio,
                total / (budgets.get(body.id)! / 0.02),
              );
            }
        }
    this.peakCorrection = Math.max(this.peakCorrection, this.stepCorrection);
  }

  private updateContactPlanes() {
    for (const b of this.bubbles) b.contacts = [];
    this.films = [];
    for (const pair of this.pairs.values()) {
      if (!pair.bonded) continue;
      const a = this.bubbles.find((b) => b.id === pair.a),
        b = this.bubbles.find((b) => b.id === pair.b);
      if (!a || !b) continue;
      const { normal, gap, pointA, pointB } = this.contactGeometry(a, b, pair);
      if (gap >= 0) continue;
      const reverse = normal.map((v) => -v) as V3;
      let center = pointA.map(
        (v, k) => (v * b.radius + pointB[k] * a.radius) / (a.radius + b.radius),
      ) as V3;
      const effectiveRadius = (a.radius * b.radius) / (a.radius + b.radius);
      let filmRadius = Math.sqrt(Math.max(0, -2 * effectiveRadius * gap - gap * gap * 0.25));
      if (!this.surfaceFor(a.id) && !this.surfaceFor(b.id)) {
        const distance = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
        if (distance < 1e-8) continue;
        const plane =
          (distance * distance + a.radius * a.radius - b.radius * b.radius) / (2 * distance);
        if (Math.abs(plane) >= a.radius || Math.abs(distance - plane) >= b.radius) continue;
        center = a.position.map((v, k) => v + normal[k] * plane) as V3;
        filmRadius = Math.sqrt(Math.max(0, a.radius * a.radius - plane * plane));
      }
      if (pair.transfer) {
        const t = smooth5((this.time - pair.transfer.startedAt) / ATTACHMENT_BLEND_TIME);
        center = center.map(
          (v, k) =>
            v * t +
            (1 - t) *
              ((a.position[k] +
                pair.transfer!.centerA[k] +
                b.position[k] +
                pair.transfer!.centerB[k]) *
                0.5),
        ) as V3;
        filmRadius = filmRadius * t + pair.transfer.filmRadius * (1 - t);
      }
      const offsetA = normal.reduce((s, n, k) => s + n * (center[k] - a.position[k]), 0) / a.radius;
      const offsetB =
        reverse.reduce((s, n, k) => s + n * (center[k] - b.position[k]), 0) / b.radius;
      const region = (self: Bubble, other: Bubble) =>
        this.surfaceFor(self.id)
          ? {
              center: other.position.map((v, k) => (v - self.position[k]) / self.radius) as V3,
              radius: this.boundRadius(other) / self.radius,
            }
          : undefined;
      a.contacts.push({ normal, offset: offsetA, region: region(a, b) });
      b.contacts.push({ normal: reverse, offset: offsetB, region: region(b, a) });
      const fusion = this.transitions.find(
        (f) => f.phase === 'opening' && f.survivor === a.id && f.partner === b.id,
      );
      this.films.push({
        a: a.id,
        b: b.id,
        normal,
        center,
        radius: filmRadius,
        opening: fusion ? fusion.progress / FILM_OPEN_TIME : 0,
      });
    }
    for (const b of this.bubbles)
      b.contacts.sort((a, c) => a.offset - c.offset).splice(MAX_CONTACT_PLANES);
  }

  dispose() {
    this.reset();
    for (const surface of this.pool) surface.dispose();
    this.pool = [];
  }

  reset() {
    this.endDrag();
    for (const f of [...this.transitions]) this.releaseFusion(f);
    this.films = [];
    this.stepCorrection = this.peakCorrection = this.stepCorrectionRatio = 0;
    if (this.pendingQuality !== undefined) this.setQuality(this.pendingQuality);
    this.darts.reset();
    this.bubbles = [];
    this.time = this.accumulator = this.created = 0;
    this.nextId = 1;
    this.pairs.clear();
    this.paused = false;
    this.wind = 0.45;
  }
}
