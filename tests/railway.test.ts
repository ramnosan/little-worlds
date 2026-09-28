import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXLE_OFFSET,
  CAR_SPACING,
  MODEL_SCALE,
  LAP_SECONDS,
  LINE_OFFSET,
  ROUTE_SECTIONS,
  TUNNEL_HALF_WIDTH,
  TUNNEL_ROOF,
  nearestTrack,
  sectionAt,
  RailwayWorld,
  START_DISTANCE,
  TRACK_LENGTH,
  trackPose,
  wrapDistance,
} from '../src/railway/physics';
import { GAUGE, GROUND, terrainHeight } from '../src/railway/scenery';
import { Vector3 } from 'three';
import { followCameraPose, TUNNEL_CAMERA_BACK, tunnelCameraBlend } from '../src/railway/camera';
import {
  CLOUD_DRIFT_PERIOD,
  CLOUD_LAYOUT,
  cloudDensity,
  cloudPosition,
} from '../src/railway/clouds';

test('cloud density is seeded, has volume, and fades to empty on every boundary', () => {
  const size = 24;
  const data = cloudDensity(17, size);
  assert.deepEqual(data, cloudDensity(17, size));
  assert.notDeepEqual(data, cloudDensity(43, size));
  assert.ok(data.some((value) => value > 180));
  assert.ok(data.some((value) => value > 0 && value < 100));
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if ([x, y, z].some((v) => v === 0 || v === size - 1))
          assert.equal(data[x + size * (y + size * z)], 0);
});

test('cloud drift stays above the scenery and within the tabletop for a complete cycle', () => {
  const position = new Vector3();
  CLOUD_LAYOUT.forEach((cloud, index) => {
    const start = cloudPosition(index, 0, new Vector3());
    assert.ok(start.distanceTo(cloudPosition(index, CLOUD_DRIFT_PERIOD, position)) < 1e-10);
    for (let seconds = 0; seconds <= CLOUD_DRIFT_PERIOD; seconds += 0.25) {
      cloudPosition(index, seconds, position);
      assert.ok(Math.abs(position.x) + cloud.scale[0] / 2 < 13.8 / 2);
      assert.ok(Math.abs(position.z) + cloud.scale[2] / 2 < 9 / 2);
      assert.ok(position.y - cloud.scale[1] / 2 > 3.5);
      const next = cloudPosition(index, seconds + 0.01, new Vector3());
      assert.ok(position.distanceTo(next) < 0.0002, 'drift must not jump');
    }
  });
});

const close = (a: number, b: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('track joins are closed and tangent-continuous, including negative distances', () => {
  for (const s of [0, TRACK_LENGTH, ...ROUTE_SECTIONS.flatMap((s) => [s.start, s.end])]) {
    const before = trackPose(s - 1e-7),
      after = trackPose(s + 1e-7);
    close(before.x, after.x, 3e-7);
    close(before.z, after.z, 3e-7);
    close(before.y, after.y, 3e-7);
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
    close(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), 0.001, 2e-6);
    close(Math.hypot(a.tx, a.ty, a.tz), 1);
    const left = trackPose(s, -GAUGE / 2),
      right = trackPose(s, GAUGE / 2);
    close(Math.hypot(right.x - left.x, right.z - left.z), GAUGE);
  }
});

test('mountain route clears both lines outdoors and covers both tunnel bores', () => {
  let highest = 0,
    lowest = Infinity,
    tunnels = new Set<string>();
  for (let s = 0; s < TRACK_LENGTH; s += 0.035) {
    const pose = trackPose(s);
    highest = Math.max(highest, pose.y);
    lowest = Math.min(lowest, pose.y);
    assert.ok(Math.abs(pose.ty / Math.hypot(pose.tx, pose.tz)) <= 0.06);
    close(nearestTrack(pose.x, pose.z).distance, s, 0.002);
    for (const line of [0, LINE_OFFSET])
      for (const offset of [-0.07, 0, 0.07]) {
        const p = trackPose(s, line + offset);
        if (sectionAt(s)?.kind === 'tunnel') {
          tunnels.add(sectionAt(s)!.id);
          assert.ok(terrainHeight(p.x, p.z) > p.y + TUNNEL_ROOF, `Tunnel roof uncovered at ${s}`);
          assert.ok(Math.abs(line + offset - LINE_OFFSET / 2) < TUNNEL_HALF_WIDTH - 0.03);
          assert.ok((0.796 + 0.085) * MODEL_SCALE < TUNNEL_ROOF - 0.1);
        } else {
          assert.ok(terrainHeight(p.x, p.z) < p.y - 0.01, `Terrain intersects track at ${s}`);
        }
      }
  }
  assert.equal(tunnels.size, 2);
  assert.ok(highest - lowest > 0.4);
  assert.ok(terrainHeight(1.4, -1.25) > GROUND + 1.5);
  for (const x of [-6.9, 6.9])
    for (let z = -4.5; z <= 4.5; z += 0.1) close(terrainHeight(x, z), GROUND);
});

test('one lap takes 75 seconds and carriage spacing survives wraparound', () => {
  const world = new RailwayWorld();
  for (let i = 0; i < LAP_SECONDS * 60; i++) {
    world.advance(1 / 60);
    for (let car = 1; car < 3; car++)
      close(wrapDistance(world.carDistance(car - 1) - world.carDistance(car)), CAR_SPACING);
    // A car must not collapse or flip across the seam; its axle chord stays almost full length.
    const front = trackPose(world.distance + AXLE_OFFSET),
      back = trackPose(world.distance - AXLE_OFFSET);
    assert.ok(Math.hypot(front.x - back.x, front.z - back.z) > 0.75 * MODEL_SCALE);
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
    close(distance, wrapDistance(START_DISTANCE + (TRACK_LENGTH * 18) / LAP_SECONDS)),
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

test('follow camera and its sightline fit both curved tunnel bores', () => {
  const position = new Vector3(),
    target = new Vector3(),
    point = new Vector3();
  for (const section of ROUTE_SECTIONS.filter((s) => s.kind === 'tunnel')) {
    for (let s = section.start; s <= section.end; s += 0.04) {
      // Sample by camera distance, including the exit after the locomotive is outside.
      const locomotive = s + TUNNEL_CAMERA_BACK;
      assert.equal(followCameraPose(locomotive, position, target), 1);
      const cameraTrack = trackPose(s);
      close(position.x, cameraTrack.x);
      close(position.z, cameraTrack.z);
      for (let f = 0; f <= 1; f += 0.1) {
        point.lerpVectors(position, target, f);
        const route = nearestTrack(point.x, point.z);
        const lateral = route.lateral - LINE_OFFSET / 2;
        assert.ok(Math.abs(lateral) < TUNNEL_HALF_WIDTH - 0.05, 'sightline clears the walls');
        assert.ok(point.y > route.y + 0.1, 'sightline clears the floor');
        assert.ok(point.y < route.y + 0.48, 'sightline stays below the arch');
      }
    }
  }
});

test('tunnel camera transitions are continuous across portals and lap wrap', () => {
  const position = new Vector3(),
    target = new Vector3(),
    previous = new Vector3();
  followCameraPose(-0.01, previous, target);
  for (let s = 0; s < TRACK_LENGTH + 0.02; s += 0.01) {
    const blend = followCameraPose(s, position, target);
    assert.ok(blend >= 0 && blend <= 1);
    assert.ok(position.distanceTo(previous) < 0.08, 'no jump at transitions');
    previous.copy(position);
  }
  assert.equal(tunnelCameraBlend(START_DISTANCE), 0);
});
