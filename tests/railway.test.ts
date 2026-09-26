import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXLE_OFFSET,
  CAR_SPACING,
  RADIUS,
  RailwayWorld,
  START_DISTANCE,
  STRAIGHT,
  TRACK_LENGTH,
  trackPose,
  wrapDistance,
} from '../src/railway/physics';
import { GAUGE, GROUND, RAIL_TOP, terrainHeight } from '../src/railway/scenery';

const close = (a: number, b: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('track joins are closed and tangent-continuous, including negative distances', () => {
  for (const s of [
    0,
    STRAIGHT,
    STRAIGHT + Math.PI * RADIUS,
    2 * STRAIGHT + Math.PI * RADIUS,
    TRACK_LENGTH,
  ]) {
    const before = trackPose(s - 1e-7),
      after = trackPose(s + 1e-7);
    close(before.x, after.x, 3e-7);
    close(before.z, after.z, 3e-7);
    close(before.tx, after.tx, 3e-7);
    close(before.tz, after.tz, 3e-7);
  }
  const p = trackPose(-0.5),
    wrapped = trackPose(TRACK_LENGTH - 0.5);
  close(p.x, wrapped.x);
  close(p.z, wrapped.z);
});

test('track arc length has unit speed and rails retain their gauge', () => {
  for (let s = 0; s < TRACK_LENGTH; s += 0.037) {
    const a = trackPose(s),
      b = trackPose(s + 0.001);
    close(Math.hypot(b.x - a.x, b.z - a.z), 0.001, 1e-9);
    close(Math.hypot(a.tx, a.tz), 1);
    const left = trackPose(s, -GAUGE / 2),
      right = trackPose(s, GAUGE / 2);
    close(Math.hypot(right.x - left.x, right.z - left.z), GAUGE);
  }
});

test('terrain leaves both railway lines clear of hills and contains elevated scenery', () => {
  for (let s = 0; s < TRACK_LENGTH; s += 0.035) {
    for (const line of [0, 0.52])
      for (const offset of [-0.2, 0, 0.2]) {
        const p = trackPose(s, line + offset);
        assert.ok(
          terrainHeight(p.x, p.z) < RAIL_TOP - 0.01,
          `Terrain intersects the track at ${s}`,
        );
      }
  }
  assert.ok(terrainHeight(1.4, -0.3) > GROUND + 1.4);
  for (const x of [-6.9, 6.9])
    for (let z = -4.5; z <= 4.5; z += 0.1) close(terrainHeight(x, z), GROUND);
});

test('one lap takes 25 seconds and carriage spacing survives wraparound', () => {
  const world = new RailwayWorld();
  for (let i = 0; i < 1500; i++) {
    world.advance(1 / 60);
    for (let car = 1; car < 3; car++)
      close(wrapDistance(world.carDistance(car - 1) - world.carDistance(car)), CAR_SPACING);
    // A car must not collapse or flip across the seam; its axle chord stays almost full length.
    const front = trackPose(world.distance + AXLE_OFFSET),
      back = trackPose(world.distance - AXLE_OFFSET);
    assert.ok(Math.hypot(front.x - back.x, front.z - back.z) > 0.75);
  }
  close(world.distance, START_DISTANCE);
  close(world.travel, TRACK_LENGTH);
});

test('motion is independent of render rate and scales with speed', () => {
  const distances = [30, 60, 144].map((fps) => {
    const world = new RailwayWorld();
    world.setSpeed(1.5);
    for (let frame = 0; frame < fps * 12; frame++) world.advance(1 / fps);
    return world.distance;
  });
  distances.forEach((distance) =>
    close(distance, wrapDistance(START_DISTANCE + (TRACK_LENGTH * 18) / 25)),
  );
});

test('pause, zero speed, invalid input, speed limits and reset are deterministic', () => {
  const world = new RailwayWorld();
  world.advance(2);
  world.paused = true;
  const paused = world.stats();
  world.advance(100);
  assert.deepEqual(world.stats(), paused);
  world.paused = false;
  world.setSpeed(0);
  world.advance(100);
  close(world.travel, paused.travel);
  world.setSpeed(9);
  assert.equal(world.speed, 2);
  world.setSpeed(NaN);
  assert.equal(world.speed, 2);
  world.setSpeed(-1);
  assert.equal(world.speed, 0);
  world.advance(NaN);
  world.advance(-1);
  close(world.travel, paused.travel);
  world.reset();
  assert.deepEqual(world.stats(), new RailwayWorld().stats());
  const snapshot = world.stats();
  snapshot.cars[0].x = 999;
  assert.notEqual(world.stats().cars[0].x, 999);
});
