import { Quaternion, Vector3 } from 'three';

// SI units. Body axes: +X nose, +Y up, +Z right wing.
export const STEP = 1 / 120;
export const MASS = 1.25;
export const RUNWAY = { length: 180, width: 12 };
export const GEAR = [
  new Vector3(0.2, -0.38, -0.32),
  new Vector3(0.2, -0.38, 0.32),
  new Vector3(-0.95, -0.17, 0),
];
const HULL = [
  new Vector3(0.8, -0.06, 0),
  new Vector3(-0.9, -0.04, 0),
  new Vector3(0, 0.16, -1.1),
  new Vector3(0, 0.16, 1.1),
  new Vector3(-0.8, 0.42, 0),
];
const INERTIA = new Vector3(0.18, 0.24, 0.12);
export interface FlightInput {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
}
export function controlResponse(value: number) {
  // RC transmitter exponential: precision around center, full travel at the stops.
  return 0.65 * value + 0.35 * value * value * value;
}
export type FlightState = 'ground' | 'flying' | 'stalled' | 'crashed';
export function liftCoefficient(alpha: number) {
  const a = alpha + 0.04,
    limit = 0.3;
  if (Math.abs(a) <= limit) return 4.5 * a;
  const blend = Math.min(1, (Math.abs(a) - limit) / 0.25);
  return (1 - blend) * Math.sign(a) * 1.35 + blend * 0.8 * Math.sin(2 * a);
}
export function onRunway(x: number, z: number) {
  return Math.abs(x) <= RUNWAY.length / 2 && Math.abs(z) <= RUNWAY.width / 2;
}

export class AirplaneWorld {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  readonly angularVelocity = new Vector3(); // body coordinates
  readonly input: FlightInput = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };
  readonly surfaces: FlightInput = { throttle: 0, pitch: 0, roll: 0, yaw: 0 };
  paused = false;
  state: FlightState = 'ground';
  time = 0;
  alpha = 0;
  private accumulator = 0;
  constructor() {
    this.reset();
  }
  reset() {
    this.position.set(-28, 0.34, 0);
    this.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.18);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.setInput({ throttle: 0, pitch: 0, roll: 0, yaw: 0 });
    Object.assign(this.surfaces, this.input);
    this.paused = false;
    this.state = 'ground';
    this.time = 0;
    this.accumulator = 0;
    this.alpha = 0;
  }
  setInput(values: Partial<FlightInput>) {
    for (const key of Object.keys(values) as (keyof FlightInput)[]) {
      const value = values[key]!;
      if (Number.isFinite(value))
        this.input[key] = Math.max(key === 'throttle' ? 0 : -1, Math.min(1, value));
    }
  }
  advance(seconds: number) {
    if (this.paused || this.state === 'crashed' || !Number.isFinite(seconds) || seconds <= 0)
      return;
    this.accumulator += Math.min(seconds, 0.1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
      if ((this.state as FlightState) === 'crashed') {
        this.accumulator = 0;
        break;
      }
    }
  }
  private crash() {
    this.state = 'crashed';
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.input.throttle = 0;
    this.surfaces.throttle = 0;
  }
  private step(dt: number) {
    for (const axis of ['throttle', 'pitch', 'roll', 'yaw'] as const) {
      const target = axis === 'throttle' ? this.input[axis] : controlResponse(this.input[axis]);
      const delta =
        (target - this.surfaces[axis]) * (1 - Math.exp(-dt / (axis === 'throttle' ? 0.25 : 0.12)));
      const limit = dt * (axis === 'throttle' ? 2 : 3);
      this.surfaces[axis] += Math.max(-limit, Math.min(limit, delta));
    }
    const inv = this.orientation.clone().invert();
    const local = this.velocity.clone().applyQuaternion(inv),
      speed = local.length();
    this.alpha = Math.atan2(-local.y, local.x);
    const beta = Math.atan2(local.z, Math.max(0.1, local.x));
    const q = 0.5 * 1.225 * speed * speed,
      area = 0.42;
    const wingQ = 0.5 * 1.225 * (local.x * local.x + local.y * local.y);
    const cl = liftCoefficient(this.alpha);
    const drag =
      0.045 + 0.065 * cl * cl + 0.9 * Math.sin(this.alpha) ** 2 + 0.25 * Math.sin(beta) ** 2;
    const force = local.clone().multiplyScalar((-q * area * drag) / Math.max(speed, 0.01));
    const lift = new Vector3(-local.y, local.x, 0).normalize().multiplyScalar(wingQ * area * cl);
    force.add(lift);
    force.z -= q * area * 0.5 * Math.sin(beta);
    force.x += 7.8 * this.surfaces.throttle * Math.max(0.15, 1 - Math.max(0, local.x) / 38);
    force.applyQuaternion(this.orientation);
    force.y -= MASS * 9.81;
    this.velocity.addScaledVector(force, dt / MASS);
    // Aerodynamic stability depends on relative airflow, never on world-level attitude.
    const controlQ = wingQ + this.surfaces.throttle * 5;
    const attached = 1 - 0.65 * Math.min(1, Math.max(0, (Math.abs(this.alpha + 0.04) - 0.3) / 0.3));
    const torque = new Vector3(
      wingQ * area * (0.06 * this.surfaces.roll * attached - 0.055 * beta) -
        0.075 * speed * this.angularVelocity.x,
      -controlQ * area * (0.07 * this.surfaces.yaw + 0.22 * beta) +
        wingQ * area * 0.012 * this.surfaces.roll * cl -
        0.09 * speed * this.angularVelocity.y,
      controlQ * area * 0.32 * (0.22 * this.surfaces.pitch - 0.7 * (this.alpha - 0.035)) -
        0.07 * speed * this.angularVelocity.z,
    );
    torque.sub(this.angularVelocity.clone().cross(this.angularVelocity.clone().multiply(INERTIA)));
    this.angularVelocity.add(torque.divide(INERTIA).multiplyScalar(dt));
    this.position.addScaledVector(this.velocity, dt);
    const rate = this.angularVelocity.length();
    if (rate > 1e-10)
      this.orientation
        .multiply(
          new Quaternion().setFromAxisAngle(
            this.angularVelocity.clone().divideScalar(rate),
            rate * dt,
          ),
        )
        .normalize();

    for (const point of HULL) {
      const contact = point.clone().applyQuaternion(this.orientation).add(this.position);
      if (contact.y < 0) {
        this.crash();
        return;
      }
    }
    let grounded = false;
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const point of GEAR) {
        const arm = point.clone().applyQuaternion(this.orientation);
        const contactX = this.position.x + arm.x,
          contactZ = this.position.z + arm.z;
        const height = this.position.y + arm.y;
        if (height > 0.004) continue;
        grounded = true;
        const omega = this.angularVelocity.clone().applyQuaternion(this.orientation);
        const contactVelocity = omega.cross(arm).add(this.velocity);
        if (contactVelocity.y < -3.5) {
          this.crash();
          return;
        }
        this.position.y += Math.max(0, -height) * 0.7;
        if (contactVelocity.y < 0) {
          const normal = new Vector3(0, 1, 0);
          const angular = arm
            .clone()
            .cross(normal)
            .applyQuaternion(this.orientation.clone().invert())
            .divide(INERTIA);
          const effective =
            1 / MASS + angular.clone().applyQuaternion(this.orientation).cross(arm).y;
          const impulse = -contactVelocity.y / effective;
          this.velocity.y += impulse / MASS;
          this.angularVelocity.addScaledVector(angular, impulse);
          // Tire side force, limited by wheel load. Only the tailwheel steers.
          const steering = point.x < 0 ? -0.35 * this.surfaces.yaw : 0;
          const side = new Vector3(-Math.sin(steering), 0, Math.cos(steering)).applyQuaternion(
            this.orientation,
          );
          side.y = 0;
          side.normalize();
          const sideAngular = arm
            .clone()
            .cross(side)
            .applyQuaternion(this.orientation.clone().invert())
            .divide(INERTIA);
          const sideMass =
            1 / MASS + sideAngular.clone().applyQuaternion(this.orientation).cross(arm).dot(side);
          const lateralSpeed = this.angularVelocity
            .clone()
            .applyQuaternion(this.orientation)
            .cross(arm)
            .add(this.velocity)
            .dot(side);
          const grip = (onRunway(contactX, contactZ) ? 0.75 : 0.55) * impulse;
          const sideImpulse = Math.max(-grip, Math.min(grip, -lateralSpeed / sideMass));
          this.velocity.addScaledVector(side, sideImpulse / MASS);
          this.angularVelocity.addScaledVector(sideAngular, sideImpulse);
        }
      }
    }
    if (grounded) {
      const resistance = onRunway(this.position.x, this.position.z) ? 0.32 : 1.7;
      const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
      const factor = Math.max(0, 1 - (resistance * dt) / Math.max(horizontal, 1e-6));
      this.velocity.x *= factor;
      this.velocity.z *= factor;
    }
    this.state = grounded
      ? 'ground'
      : Math.abs(this.alpha + 0.04) > 0.3 && speed > 3
        ? 'stalled'
        : 'flying';
    this.time += dt;
  }
  stats() {
    return {
      position: this.position.toArray(),
      velocity: this.velocity.toArray(),
      orientation: this.orientation.toArray(),
      angularVelocity: this.angularVelocity.toArray(),
      speed: this.velocity.length(),
      altitude: Math.max(0, this.position.y - 0.34),
      alpha: this.alpha,
      input: { ...this.input },
      surfaces: { ...this.surfaces },
      state: this.state,
      paused: this.paused,
      time: this.time,
    };
  }
}
