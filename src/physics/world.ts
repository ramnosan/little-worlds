import { BLOB_TOPOLOGY } from './topology';
import { Mallet } from './mallet';

export type Vec3 = [number, number, number];
export const MAX_BODIES = 8;
export const FIXED_DT = 1 / 60;
export const ARENA = { halfX: 5.7, halfZ: 3.65, corner: 0.6, ceiling: 8 };
export const RAMP = { minX: 2.25, maxX: 4.25, minZ: -2.8, maxZ: -0.6, slope: 0.5 };

interface Constraints {
  pairs: Uint16Array;
  rest: Float64Array;
  lambda: Float64Array;
}
export interface Grab {
  body: SoftBody;
  indices: number[];
  offsets: Vec3[];
  target: Vec3;
}

function constraints(pairs: Uint16Array, p: Float64Array): Constraints {
  const rest = new Float64Array(pairs.length / 2);
  for (let i = 0; i < rest.length; i++) {
    const a = pairs[i * 2] * 3,
      b = pairs[i * 2 + 1] * 3;
    rest[i] = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
  }
  return { pairs, rest, lambda: new Float64Array(rest.length) };
}

export class SoftBody {
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly velocities: Float64Array;
  readonly gradients: Float64Array;
  readonly contacts: Float64Array;
  readonly edges: Constraints;
  readonly bends: Constraints;
  readonly topology;
  readonly restVolume: number;
  readonly center: Vec3 = [0, 0, 0];
  readonly previousCenter: Vec3 = [0, 0, 0];
  readonly bounds = new Float64Array(6);
  volumeLambda = 0;
  impact = 0;
  constructor(
    public readonly id: number,
    public readonly radius: number,
    public readonly color: string,
    origin: Vec3,
  ) {
    this.topology = BLOB_TOPOLOGY;
    this.positions = this.topology.vertices.map((v, i) => v * radius + origin[i % 3]);
    this.previous = this.positions.slice();
    this.velocities = new Float64Array(this.positions.length);
    this.gradients = new Float64Array(this.positions.length);
    this.contacts = new Float64Array(this.positions.length);
    this.edges = constraints(this.topology.edges, this.positions);
    this.bends = constraints(this.topology.bends, this.positions);
    this.restVolume = this.volume();
    this.updateBounds();
    this.previousCenter.splice(0, 3, ...this.center);
  }
  volume(positions = this.positions): number {
    const p = positions,
      f = this.topology.faces;
    let v = 0;
    // Translation-invariant origin keeps volume accurate away from the world origin.
    const ox = p[0],
      oy = p[1],
      oz = p[2];
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3,
        b = f[i + 1] * 3,
        c = f[i + 2] * 3;
      const ax = p[a] - ox,
        ay = p[a + 1] - oy,
        az = p[a + 2] - oz;
      const bx = p[b] - ox,
        by = p[b + 1] - oy,
        bz = p[b + 2] - oz;
      const cx = p[c] - ox,
        cy = p[c + 1] - oy,
        cz = p[c + 2] - oz;
      v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }
  updateBounds() {
    const p = this.positions,
      b = this.bounds,
      c = this.center;
    b[0] = b[1] = b[2] = Infinity;
    b[3] = b[4] = b[5] = -Infinity;
    c[0] = c[1] = c[2] = 0;
    for (let i = 0; i < p.length; i += 3)
      for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], p[i + k]);
        b[k + 3] = Math.max(b[k + 3], p[i + k]);
        c[k] += p[i + k];
      }
    for (let k = 0; k < 3; k++) c[k] /= p.length / 3;
  }
}

/** Fixed-step extended position-based dynamics; all simulation units are meters/seconds. */
export class PhysicsWorld {
  readonly mallet = new Mallet();
  bodies: SoftBody[] = [];
  softness = 0.5;
  gravity = 1;
  paused = false;
  grab: Grab | null = null;
  private accumulator = 0;
  private nextId = 1;
  private pairCandidates: [SoftBody, SoftBody][] = [];

  spawn(radius: number, color: string, origin: Vec3): SoftBody | null {
    if (this.bodies.length >= MAX_BODIES) return null;
    const body = new SoftBody(this.nextId++, radius, color, origin);
    this.bodies.push(body);
    return body;
  }
  remove(id: number) {
    if (this.grab?.body.id === id) this.endGrab();
    this.bodies = this.bodies.filter((b) => b.id !== id);
  }
  clear() {
    this.mallet.enabled = false;
    this.mallet.end();
    this.bodies = [];
    this.endGrab();
    this.accumulator = 0;
  }
  advance(delta: number) {
    if (this.paused) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(Math.max(delta, 0), FIXED_DT * 4);
    let count = 0;
    while (this.accumulator + 1e-10 >= FIXED_DT && count++ < 4) {
      this.step(FIXED_DT / 2);
      this.step(FIXED_DT / 2);
      this.accumulator -= FIXED_DT;
    }
  }
  beginGrab(body: SoftBody, point: Vec3) {
    if (this.paused || !this.bodies.includes(body)) return;
    const ranked: { index: number; distance: number }[] = [];
    for (let i = 0; i < body.positions.length; i += 3)
      ranked.push({
        index: i,
        distance: Math.hypot(
          body.positions[i] - point[0],
          body.positions[i + 1] - point[1],
          body.positions[i + 2] - point[2],
        ),
      });
    ranked.sort((a, b) => a.distance - b.distance);
    const indices = ranked.slice(0, 7).map((v) => v.index);
    this.grab = {
      body,
      indices,
      offsets: indices.map((i) => [
        body.positions[i] - point[0],
        body.positions[i + 1] - point[1],
        body.positions[i + 2] - point[2],
      ]),
      target: [...point],
    };
  }
  moveGrab(point: Vec3) {
    if (!this.grab) return;
    this.grab.target = [
      Math.max(-5.4, Math.min(5.4, point[0])),
      Math.max(0.15, Math.min(6.5, point[1])),
      Math.max(-3.4, Math.min(3.4, point[2])),
    ];
  }
  endGrab() {
    this.grab = null;
  }

  private solveDistance(body: SoftBody, set: Constraints, compliance: number, dt: number) {
    const p = body.positions,
      alpha = compliance / (dt * dt);
    for (let i = 0; i < set.rest.length; i++) {
      const a = set.pairs[i * 2] * 3,
        b = set.pairs[i * 2 + 1] * 3;
      const dx = p[a] - p[b],
        dy = p[a + 1] - p[b + 1],
        dz = p[a + 2] - p[b + 2];
      const length = Math.hypot(dx, dy, dz);
      if (length < 1e-8) continue;
      const dl = (-(length - set.rest[i]) - alpha * set.lambda[i]) / (2 + alpha);
      set.lambda[i] += dl;
      const scale = dl / length;
      p[a] += dx * scale;
      p[a + 1] += dy * scale;
      p[a + 2] += dz * scale;
      p[b] -= dx * scale;
      p[b + 1] -= dy * scale;
      p[b + 2] -= dz * scale;
    }
  }
  private solveVolume(body: SoftBody, dt: number) {
    const p = body.positions,
      g = body.gradients,
      f = body.topology.faces;
    g.fill(0);
    const [ox, oy, oz] = body.center;
    for (let i = 0; i < f.length; i += 3) {
      const a = f[i] * 3,
        b = f[i + 1] * 3,
        c = f[i + 2] * 3;
      const ax = p[a] - ox,
        ay = p[a + 1] - oy,
        az = p[a + 2] - oz;
      const bx = p[b] - ox,
        by = p[b + 1] - oy,
        bz = p[b + 2] - oz;
      const cx = p[c] - ox,
        cy = p[c + 1] - oy,
        cz = p[c + 2] - oz;
      g[a] += (by * cz - bz * cy) / 6;
      g[a + 1] += (bz * cx - bx * cz) / 6;
      g[a + 2] += (bx * cy - by * cx) / 6;
      g[b] += (cy * az - cz * ay) / 6;
      g[b + 1] += (cz * ax - cx * az) / 6;
      g[b + 2] += (cx * ay - cy * ax) / 6;
      g[c] += (ay * bz - az * by) / 6;
      g[c + 1] += (az * bx - ax * bz) / 6;
      g[c + 2] += (ax * by - ay * bx) / 6;
    }
    let sum = 0;
    for (const v of g) sum += v * v;
    const alpha = 0.0000001 / (dt * dt);
    const dl = (-(body.volume() - body.restVolume) - alpha * body.volumeLambda) / (sum + alpha);
    body.volumeLambda += dl;
    for (let i = 0; i < p.length; i++) p[i] += Math.max(-0.06, Math.min(0.06, g[i] * dl));
  }
  private environment(body: SoftBody) {
    const p = body.positions,
      n = body.contacts;
    const margin = 0.035;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < margin) {
        p[i + 1] = margin;
        n[i + 1] = 1;
      }
      if (p[i + 1] > ARENA.ceiling) {
        p[i + 1] = ARENA.ceiling;
        n[i + 1] = -1;
      }
      // Signed distance to the inside of a rounded rectangle.
      const qx = Math.abs(p[i]) - (ARENA.halfX - ARENA.corner),
        qz = Math.abs(p[i + 2]) - (ARENA.halfZ - ARENA.corner);
      const ex = Math.max(qx, 0),
        ez = Math.max(qz, 0),
        length = Math.hypot(ex, ez);
      const outside = length + Math.min(Math.max(qx, qz), 0) - ARENA.corner + margin;
      if (outside > 0) {
        const nx = length > 0 ? (ex / length) * Math.sign(p[i]) : Math.sign(p[i]);
        const nz = length > 0 ? (ez / length) * Math.sign(p[i + 2]) : 0;
        p[i] -= nx * outside;
        p[i + 2] -= nz * outside;
        n[i] = -nx;
        n[i + 2] = -nz;
      }
      const { minX, maxX, minZ, maxZ, slope } = RAMP;
      if (
        p[i] > minX - margin &&
        p[i] < maxX + margin &&
        p[i + 2] > minZ - margin &&
        p[i + 2] < maxZ + margin
      ) {
        const h = (maxZ - p[i + 2]) * slope;
        if (p[i + 1] < h + margin) {
          const top = (h + margin - p[i + 1]) / Math.sqrt(1 + slope * slope);
          const left = p[i] - minX + margin,
            right = maxX - p[i] + margin,
            back = p[i + 2] - minZ + margin;
          if (top <= Math.min(left, right, back)) {
            const ny = 1 / Math.sqrt(1 + slope * slope),
              nz = slope * ny;
            p[i + 1] += top * ny;
            p[i + 2] += top * nz;
            n[i + 1] = ny;
            n[i + 2] = nz;
          } else if (left < right && left < back) {
            p[i] = minX - margin;
            n[i] = -1;
          } else if (right < back) {
            p[i] = maxX + margin;
            n[i] = 1;
          } else {
            p[i + 2] = minZ - margin;
            n[i + 2] = -1;
          }
        }
      }
    }
  }
  private broadPhase() {
    this.pairCandidates.length = 0;
    for (const b of this.bodies) b.updateBounds();
    for (let i = 0; i < this.bodies.length; i++)
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i],
          b = this.bodies[j];
        if (
          [0, 1, 2].every(
            (k) => a.bounds[k] < b.bounds[k + 3] + 0.12 && b.bounds[k] < a.bounds[k + 3] + 0.12,
          )
        )
          this.pairCandidates.push([a, b]);
      }
  }
  private bodyContacts(a: SoftBody, b: SoftBody) {
    // Project both complete surfaces onto opposite sides of one contact plane.
    // Nearest-vertex normals are ambiguous inside a deeply overlapping mesh;
    // they can push different patches in opposite directions and thread bodies.
    // Positive Loop-subdivision weights keep the rendered surfaces on their
    // respective sides too. Local compression still produces a soft contact patch.
    a.updateBounds();
    b.updateBounds();
    let nx = b.center[0] - a.center[0],
      ny = b.center[1] - a.center[1],
      nz = b.center[2] - a.center[2];
    const px = b.previousCenter[0] - a.previousCenter[0],
      py = b.previousCenter[1] - a.previousCenter[1],
      pz = b.previousCenter[2] - a.previousCenter[2];
    // Preserve the incoming ordering if a fast displacement crosses the centers.
    if (nx * px + ny * py + nz * pz < 0 || Math.hypot(nx, ny, nz) < 1e-7) {
      nx = px;
      ny = py;
      nz = pz;
    }
    let length = Math.hypot(nx, ny, nz);
    if (length < 1e-7) {
      nx = a.id < b.id ? 1 : -1;
      ny = nz = 0;
      length = 1;
    }
    nx /= length;
    ny /= length;
    nz /= length;
    const p = a.positions,
      q = b.positions;
    let supportA = -Infinity,
      supportB = Infinity;
    for (let i = 0; i < p.length; i += 3) {
      supportA = Math.max(supportA, p[i] * nx + p[i + 1] * ny + p[i + 2] * nz);
    }
    for (let i = 0; i < q.length; i += 3) {
      supportB = Math.min(supportB, q[i] * nx + q[i + 1] * ny + q[i + 2] * nz);
    }
    const margin = 0.07;
    const penetration = supportA - supportB + margin;
    if (penetration <= 0) return;
    const plane = (supportA + supportB) * 0.5;
    // Recover deep overlap with bulk displacement before compressing the skin.
    // This avoids flattening/inverting an entire blob to resolve one collision.
    const translation = Math.max(0, penetration - Math.min(a.radius, b.radius) * 0.35) * 0.5;
    for (let i = 0; i < p.length; i += 3) {
      const da =
        translation +
        Math.max(0, p[i] * nx + p[i + 1] * ny + p[i + 2] * nz - translation - plane + margin * 0.5);
      p[i] -= nx * da;
      p[i + 1] -= ny * da;
      p[i + 2] -= nz * da;
    }
    for (let i = 0; i < q.length; i += 3) {
      const db =
        translation +
        Math.max(
          0,
          plane + margin * 0.5 - (q[i] * nx + q[i + 1] * ny + q[i + 2] * nz + translation),
        );
      q[i] += nx * db;
      q[i + 1] += ny * db;
      q[i + 2] += nz * db;
    }
  }
  step(dt: number) {
    this.mallet.advance(dt);
    const edgeCompliance = 0.000002 + this.softness ** 2 * 0.00014;
    const bendCompliance = 0.00002 + this.softness ** 2 * 0.002;
    for (const b of this.bodies) {
      for (let k = 0; k < 3; k++) b.previousCenter[k] = b.center[k];
      b.previous.set(b.positions);
      b.contacts.fill(0);
      b.edges.lambda.fill(0);
      b.bends.lambda.fill(0);
      b.volumeLambda = 0;
      b.impact = 0;
      for (let i = 0; i < b.positions.length; i += 3) {
        b.velocities[i + 1] -= 9.81 * this.gravity * dt;
        for (let k = 0; k < 3; k++) b.positions[i + k] += b.velocities[i + k] * dt;
      }
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const b of this.bodies) {
        this.solveDistance(b, b.edges, edgeCompliance, dt);
        this.solveDistance(b, b.bends, bendCompliance, dt);
        this.solveVolume(b, dt);
      }
      if (this.grab) {
        const { body, indices, offsets, target } = this.grab;
        for (let j = 0; j < indices.length; j++) {
          const i = indices[j];
          const dx = target[0] + offsets[j][0] - body.positions[i],
            dy = target[1] + offsets[j][1] - body.positions[i + 1],
            dz = target[2] + offsets[j][2] - body.positions[i + 2];
          const s = Math.min(0.3, 0.075 / (Math.hypot(dx, dy, dz) + 1e-6));
          body.positions[i] += dx * s;
          body.positions[i + 1] += dy * s;
          body.positions[i + 2] += dz * s;
        }
      }
      for (const b of this.bodies) {
        this.mallet.collide(b);
        this.environment(b);
      }
      // Constraints and grabbing can create new contacts within this substep.
      this.broadPhase();
      for (const [a, b] of this.pairCandidates) this.bodyContacts(a, b);
    }
    // Resolve contact chains against neighboring bodies and the tray. Do not
    // re-expand volume or reapply a grab after the final nonpenetration passes.
    for (let pass = 0; pass < 6; pass++) {
      for (const b of this.bodies) {
        this.mallet.collide(b);
        this.environment(b);
      }
      this.broadPhase();
      for (const [a, b] of this.pairCandidates) this.bodyContacts(a, b);
    }
    for (const b of this.bodies) this.environment(b);
    const damping = Math.exp(-1.5 * dt);
    for (const b of this.bodies) {
      for (let i = 0; i < b.positions.length; i += 3) {
        const p = b.positions,
          v = b.velocities,
          old = b.previous,
          n = b.contacts;
        const incoming = v[i] * n[i] + v[i + 1] * n[i + 1] + v[i + 2] * n[i + 2];
        for (let k = 0; k < 3; k++) v[i + k] = ((p[i + k] - old[i + k]) / dt) * damping;
        const norm = Math.hypot(n[i], n[i + 1], n[i + 2]);
        if (norm > 0 && incoming < 0) {
          b.impact = Math.max(b.impact, -incoming);
          const vn = (v[i] * n[i] + v[i + 1] * n[i + 1] + v[i + 2] * n[i + 2]) / (norm * norm);
          for (let k = 0; k < 3; k++)
            v[i + k] =
              (v[i + k] - vn * n[i + k]) * 0.94 + (Math.min(2, -incoming * 0.16) * n[i + k]) / norm;
        }
        const speed = Math.hypot(v[i], v[i + 1], v[i + 2]);
        if (speed > 18) for (let k = 0; k < 3; k++) v[i + k] *= 18 / speed;
      }
      b.updateBounds();
    }
  }
}
