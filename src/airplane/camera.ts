import { Box3, MathUtils, PerspectiveCamera, Quaternion, Ray, Vector3 } from 'three';

export type CameraMode = 'ground' | 'chase';
const PILOT = new Vector3(-12, 1.7, 19);
/** Camera state is independent of simulation state, including while paused. */
export class FlightCamera {
  mode: CameraMode = 'ground';
  private heading = 0;
  private target = new Vector3();
  private ray = new Ray();
  constructor(
    readonly camera: PerspectiveCamera,
    private obstacles: readonly Box3[] = [],
  ) {}
  setMode(mode: CameraMode, position: Vector3, orientation: Quaternion) {
    this.mode = mode;
    this.reset(position, orientation);
  }
  reset(position: Vector3, orientation: Quaternion) {
    const forward = new Vector3(1, 0, 0).applyQuaternion(orientation);
    this.heading = Math.hypot(forward.x, forward.z) > 0.15 ? Math.atan2(forward.z, forward.x) : 0;
    this.target.copy(position);
    if (this.mode === 'ground') {
      this.camera.position.copy(PILOT);
      this.camera.fov = this.groundFov(position);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(position);
    } else this.chase(position, orientation, 0, true);
    this.camera.updateProjectionMatrix();
  }
  private groundFov(position: Vector3) {
    return MathUtils.clamp(750 / Math.max(16, PILOT.distanceTo(position)), 8, 48);
  }
  update(position: Vector3, orientation: Quaternion, dt: number) {
    if (this.mode === 'chase') this.chase(position, orientation, dt);
    else {
      this.camera.position.copy(PILOT);
      const distance = PILOT.distanceTo(position);
      this.target.lerp(position, 1 - Math.exp(-12 * dt));
      const lag = this.target.clone().sub(position);
      if (lag.length() > distance * 0.04)
        this.target.copy(position).add(lag.setLength(distance * 0.04));
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.target);
      this.camera.fov += (this.groundFov(position) - this.camera.fov) * (1 - Math.exp(-2 * dt));
    }
    this.camera.updateProjectionMatrix();
  }
  private avoidObstacles(origin: Vector3, desired: Vector3) {
    desired.y = Math.max(1, desired.y);
    const direction = desired.clone().sub(origin),
      length = direction.length();
    if (length < 1e-6) return;
    this.ray.set(origin, direction.divideScalar(length));
    let allowed = length;
    for (const box of this.obstacles) {
      const hit = this.ray.intersectBox(box, new Vector3());
      if (hit) allowed = Math.min(allowed, Math.max(0.3, origin.distanceTo(hit) - 0.35));
    }
    desired.copy(origin).addScaledVector(this.ray.direction, allowed);
    desired.y = Math.max(1, desired.y);
  }
  private chase(position: Vector3, orientation: Quaternion, dt: number, snap = false) {
    const forward = new Vector3(1, 0, 0).applyQuaternion(orientation);
    if (Math.hypot(forward.x, forward.z) > 0.15) {
      const wanted = Math.atan2(forward.z, forward.x);
      const difference = Math.atan2(
        Math.sin(wanted - this.heading),
        Math.cos(wanted - this.heading),
      );
      this.heading += snap
        ? difference
        : MathUtils.clamp(difference * (1 - Math.exp(-4 * dt)), -2.5 * dt, 2.5 * dt);
    }
    const heading = new Vector3(Math.cos(this.heading), 0, Math.sin(this.heading));
    const desired = position
      .clone()
      .addScaledVector(heading, -8)
      .add(new Vector3(0, 3, 0));
    this.avoidObstacles(position, desired);
    if (snap) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-7 * dt));
    // Recheck the smoothed segment as the aircraft passes beside buildings.
    this.avoidObstacles(position, this.camera.position);
    this.target.copy(position).addScaledVector(heading, 1.5);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.fov = 55;
  }
  stats() {
    return { cameraMode: this.mode, cameraHeading: this.heading };
  }
}
