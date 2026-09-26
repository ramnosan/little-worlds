import type { SoftBody, Vec3 } from './world';

/** A timed horizontal stroke. The equipped head collides throughout aiming and every swing phase. */
export class Mallet {
  readonly radius = 0.64;
  readonly position: Vec3 = [0, 1, 2.7];
  readonly target: Vec3 = [...this.position];
  active = false;
  enabled = false;

  readonly handleDirection: Vec3 = [0, 0, 1];
  private readonly right: Vec3 = [1, 0, 0];
  private readonly swingRight: Vec3 = [1, 0, 0];
  private readonly anchor: Vec3 = [0, 1, 2.7];
  private elapsed = 0;

  aim(point: Vec3, right: Vec3 = [1, 0, 0]) {
    this.target[0] = Math.max(-4.9, Math.min(4.9, point[0]));
    this.target[1] = 1;
    this.target[2] = Math.max(-2.9, Math.min(2.9, point[2]));
    const length = Math.hypot(right[0], right[2]) || 1;
    this.right.splice(0, 3, right[0] / length, 0, right[2] / length);
    if (!this.active) this.pose(this.target, this.right, 0);
  }
  swing() {
    if (this.active) return;
    this.anchor.splice(0, 3, ...this.target);
    this.swingRight.splice(0, 3, ...this.right);
    this.elapsed = 0;
    this.active = true;
  }
  end() {
    this.active = false;
    this.pose(this.target, this.right, 0);
  }
  private pose(anchor: Vec3, right: Vec3, angle: number) {
    // Rotate about a grip behind the cursor, entirely within the horizontal plane.
    const side = Math.sin(angle),
      back = Math.cos(angle);
    const towardX = -right[2],
      towardZ = right[0];
    this.position[0] = anchor[0] + 1.5 * (right[0] * side + towardX * (1 - back));
    this.position[1] = 1;
    this.position[2] = anchor[2] + 1.5 * (right[2] * side + towardZ * (1 - back));
    this.handleDirection.splice(
      0,
      3,
      towardX * back - right[0] * side,
      0,
      towardZ * back - right[2] * side,
    );
  }
  advance(dt: number) {
    if (!this.active) return;
    this.elapsed += dt;
    const t = this.elapsed;
    const ease = (v: number) => v * v * (3 - 2 * v);
    const angle =
      t < 0.16
        ? -0.95 * ease(t / 0.16)
        : t < 0.46
          ? -0.95 + 1.9 * ((t - 0.16) / 0.3)
          : 0.95 * (1 - ease(Math.min(1, (t - 0.46) / 0.24)));
    this.pose(this.anchor, this.swingRight, angle);
    if (t >= 0.7) this.end();
  }
  collide(body: SoftBody) {
    if (!this.enabled) return;
    const p = body.positions;
    const radius = this.radius + 0.035;
    for (let i = 0; i < p.length; i += 3) {
      let x = p[i] - this.position[0];
      const y = p[i + 1] - this.position[1],
        z = p[i + 2] - this.position[2];
      let distance = Math.hypot(x, y, z);
      if (distance >= radius) continue;
      if (distance < 1e-8) {
        x = 1;
        distance = 1;
      }
      const correction =
        Math.min(0.12, radius - Math.hypot(p[i] - this.position[0], y, z)) / distance;
      p[i] += x * correction;
      p[i + 1] += y * correction;
      p[i + 2] += z * correction;
    }
  }
}
