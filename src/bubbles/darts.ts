import type { V3 } from './physics';

export const DART_LIMIT = 12;
export const DART_SPEED = 28;
export interface Dart {
  id: number;
  position: V3;
  velocity: V3;
  age: number;
}
interface Target {
  id: number;
  position: V3;
  radius: number;
}

/** Flying tips use swept relative motion so fast darts cannot skip small moving bubbles. */
export class DartSystem {
  projectiles: Dart[] = [];
  hits = 0;
  thrown = 0;
  private nextId = 1;

  launch(origin: V3, direction: V3): Dart | null {
    const length = Math.hypot(...direction);
    if (
      this.projectiles.length >= DART_LIMIT ||
      length < 1e-8 ||
      ![...origin, ...direction, length].every(Number.isFinite)
    )
      return null;
    const dart: Dart = {
      id: this.nextId++,
      position: [...origin],
      velocity: direction.map((v) => (v / length) * DART_SPEED) as V3,
      age: 0,
    };
    this.projectiles.push(dart);
    this.thrown++;
    return dart;
  }

  advance(
    dt: number,
    targets: Target[],
    previous: Map<number, V3>,
    pop: (id: number) => void,
    hitTest?: (id: number, start: V3, travel: V3) => number | undefined,
  ) {
    const alive = new Set(targets.map((b) => b.id));
    for (const dart of this.projectiles) {
      const start: V3 = [...dart.position];
      dart.age += dt;
      // Analytic constant-gravity flight per fixed step, with a small visible drop.
      dart.position[1] -= 1.2 * dt * dt;
      for (let k = 0; k < 3; k++) dart.position[k] += dart.velocity[k] * dt;
      dart.velocity[1] -= 2.4 * dt;
      const contacts: { id: number; time: number }[] = [];
      for (const b of targets) {
        if (!alive.has(b.id)) continue;
        const old = previous.get(b.id) ?? b.position;
        const relative = start.map((v, k) => v - old[k]) as V3;
        const travel = dart.position.map((v, k) => v - start[k] - (b.position[k] - old[k])) as V3;
        if (hitTest) {
          const time = hitTest(b.id, relative, travel);
          if (time !== undefined) contacts.push({ id: b.id, time });
          continue;
        }
        const r = b.radius + 0.012;
        const c = relative.reduce((s, v) => s + v * v, 0) - r * r;
        const a = travel.reduce((s, v) => s + v * v, 0);
        const halfB = relative.reduce((s, v, k) => s + v * travel[k], 0);
        const discriminant = halfB * halfB - a * c;
        if (c <= 0) contacts.push({ id: b.id, time: 0 });
        else if (a > 1e-12 && discriminant >= 0) {
          const time = (-halfB - Math.sqrt(discriminant)) / a;
          if (time >= 0 && time <= 1) contacts.push({ id: b.id, time });
        }
      }
      // A dart can pierce a row of bubbles. Only actual flight contacts count.
      contacts.sort((a, b) => a.time - b.time);
      for (const contact of contacts) {
        if (!alive.delete(contact.id)) continue;
        this.hits++;
        pop(contact.id);
      }
    }
    this.projectiles = this.projectiles.filter(
      (d) => d.age < 3 && d.position[1] > -8 && Math.hypot(...d.position) < 70,
    );
  }
  reset() {
    this.projectiles = [];
    this.hits = this.thrown = 0;
    this.nextId = 1;
  }
}
