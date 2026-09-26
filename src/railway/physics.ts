// Arc-length parameterized stadium oval, shared by the scenery and moving train.
export const STRAIGHT = 5.8;
export const RADIUS = 2.7;
export const TRACK_LENGTH = STRAIGHT * 2 + Math.PI * RADIUS * 2;
export const CAR_SPACING = 1.42;
export const WHEEL_RADIUS = 0.085;
export const AXLE_OFFSET = 0.38;
export const START_DISTANCE = 3.9;

export function wrapDistance(distance: number) {
  return ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
}

export function trackPose(distance: number, offset = 0) {
  let s = wrapDistance(distance);
  let x: number, z: number, tx: number, tz: number;
  if (s < STRAIGHT) {
    x = -STRAIGHT / 2 + s;
    z = RADIUS;
    tx = 1;
    tz = 0;
  } else if ((s -= STRAIGHT) < Math.PI * RADIUS) {
    const a = s / RADIUS;
    x = STRAIGHT / 2 + RADIUS * Math.sin(a);
    z = RADIUS * Math.cos(a);
    tx = Math.cos(a);
    tz = -Math.sin(a);
  } else if ((s -= Math.PI * RADIUS) < STRAIGHT) {
    x = STRAIGHT / 2 - s;
    z = -RADIUS;
    tx = -1;
    tz = 0;
  } else {
    const a = (s - STRAIGHT) / RADIUS;
    x = -STRAIGHT / 2 - RADIUS * Math.sin(a);
    z = -RADIUS * Math.cos(a);
    tx = -Math.cos(a);
    tz = Math.sin(a);
  }
  return { x: x - tz * offset, z: z + tx * offset, tx, tz, yaw: Math.atan2(-tz, tx) };
}

export class RailwayWorld {
  distance = START_DISTANCE;
  travel = 0;
  speed = 1;
  paused = false;

  advance(seconds: number) {
    if (this.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    const step = seconds * (TRACK_LENGTH / 25) * this.speed;
    this.travel += step;
    this.distance = wrapDistance(this.distance + step);
  }

  setSpeed(value: number) {
    if (Number.isFinite(value)) this.speed = Math.max(0, Math.min(2, value));
  }

  carDistance(index: number) {
    return wrapDistance(this.distance - index * CAR_SPACING);
  }

  reset() {
    this.distance = START_DISTANCE;
    this.travel = 0;
    this.speed = 1;
    this.paused = false;
  }

  stats() {
    return {
      distance: this.distance,
      travel: this.travel,
      speed: this.speed,
      paused: this.paused,
      cars: [0, 1, 2].map((i) => ({
        distance: this.carDistance(i),
        ...trackPose(this.carDistance(i)),
      })),
    };
  }
}
