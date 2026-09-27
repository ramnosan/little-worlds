import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { AirplaneWorld, liftCoefficient, STEP, controlResponse } from '../src/airplane/physics';
import { AirfieldScenery } from '../src/airplane/scenery';
import { Scene, Mesh } from 'three';
import { Box3, PerspectiveCamera, Quaternion } from 'three';
import { FlightCamera } from '../src/airplane/camera';
const run = (w: AirplaneWorld, seconds: number, dt = STEP) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) w.advance(dt);
};
function airborne() {
  const w = new AirplaneWorld();
  w.position.set(0, 30, 0);
  w.orientation.identity();
  w.velocity.set(12, 0, 0);
  w.state = 'flying';
  return w;
}

test('former sea area supports ordinary grass landings', () => {
  for (const z of [-40, -100, -400]) {
    const w = new AirplaneWorld();
    w.position.set(0, 0.6, z);
    w.velocity.set(7, -0.5, 0);
    run(w, 20);
    assert.equal(w.state, 'ground');
    assert.ok(w.position.y > 0.3);
    assert.ok(w.velocity.length() < 0.03);
  }
});
test('scenery quality reuses resources and disposal releases each owned GPU resource', () => {
  const scene = new Scene(),
    scenery = new AirfieldScenery(scene);
  const counts = scenery.stats();
  let geometries = 0,
    materials = 0;
  const seenGeometry = new Set(),
    seenMaterial = new Set();
  scenery.group.traverse((o) => {
    if (o instanceof Mesh) {
      if (!seenGeometry.has(o.geometry)) {
        seenGeometry.add(o.geometry);
        o.geometry.addEventListener('dispose', () => geometries++);
      }
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (!seenMaterial.has(m)) {
          seenMaterial.add(m);
          m.addEventListener('dispose', () => materials++);
        }
    }
  });

  scenery.quality(true);

  assert.equal(scenery.stats().detailVisible, false);
  scenery.quality(false);
  assert.equal(scenery.stats().geometries, counts.geometries);
  scenery.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(geometries, counts.geometries);
  assert.equal(materials, counts.materials);
});

test('camera defaults to ground and reset preserves selected chase perspective', () => {
  const view = new PerspectiveCamera(),
    camera = new FlightCamera(view),
    w = airborne();
  camera.reset(w.position, w.orientation);
  assert.deepEqual(view.position.toArray(), [-12, 1.7, 19]);
  const before = w.stats();
  camera.setMode('chase', w.position, w.orientation);
  assert.equal(view.fov, 55);
  assert.ok(view.position.distanceTo(w.position.clone().add(new Vector3(-8, 3, 0))) < 1e-8);
  assert.deepEqual(w.stats(), before);
  w.reset();
  camera.reset(w.position, w.orientation);
  assert.equal(camera.mode, 'chase');
  camera.setMode('ground', w.position, w.orientation);
  assert.deepEqual(view.position.toArray(), [-12, 1.7, 19]);
});

test('chase view stays level, finite and framed through rolls and vertical maneuvers', () => {
  const view = new PerspectiveCamera(55, 1, 0.05, 12000),
    camera = new FlightCamera(view);
  const p = new Vector3(0, 15, 0),
    q = new Quaternion();
  camera.setMode('chase', p, q);
  for (let i = 0; i < 240; i++) {
    q.setFromAxisAngle(new Vector3(1, 0, 0), (i / 120) * Math.PI);
    p.x += 0.1;
    camera.update(p, q, 1 / 60);
    view.updateMatrixWorld();
    const projected = p.clone().project(view);
    assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
    assert.deepEqual(view.up.toArray(), [0, 1, 0]);
    assert.ok(view.position.y >= 1);
  }
  const heading = camera.stats().cameraHeading;
  q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  for (let i = 0; i < 60; i++) camera.update(p, q, 1 / 60);
  assert.equal(camera.stats().cameraHeading, heading);
  q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2 + 0.3);
  camera.update(p, q, 1 / 60);
  assert.ok(Math.abs(camera.stats().cameraHeading - heading) <= 2.5 / 60 + 1e-8);
});

test('chase camera clears the ground and contracts before building obstruction', () => {
  const view = new PerspectiveCamera(),
    box = new Box3(new Vector3(-6, 0, -2), new Vector3(-4, 4, 2)),
    obstacles = [box];
  const camera = new FlightCamera(view, obstacles),
    p = new Vector3(0, 0.34, 0),
    q = new Quaternion();
  camera.setMode('chase', p, q);
  assert.ok(view.position.x > -4);
  assert.ok(view.position.y >= 1);
  assert.ok(!box.containsPoint(view.position));
  const close = view.position.distanceTo(p);
  obstacles.length = 0;
  camera.update(p, q, 1 / 60);
  assert.ok(view.position.distanceTo(p) > close);
  assert.ok(view.position.distanceTo(p) < 8.54);
  for (let i = 0; i < 120; i++) camera.update(p, q, 1 / 60);
  assert.ok(Math.abs(view.position.distanceTo(p) - Math.sqrt(73)) < 0.01);
});

test('airplane rests on its three wheels with the motor off', () => {
  const w = new AirplaneWorld();
  run(w, 20);
  assert.equal(w.state, 'ground');
  assert.ok(w.position.distanceTo(new Vector3(-28, 0.34, 0)) < 0.03);
  assert.ok(w.velocity.length() < 0.03);
});
test('full power and a brief elevator input take off within the runway', () => {
  const w = new AirplaneWorld();
  w.setInput({ throttle: 1 });
  run(w, 3);
  w.setInput({ pitch: 0.3 });
  run(w, 0.4);
  w.setInput({ pitch: 0 });
  run(w, 1.5);
  assert.equal(w.state, 'flying');
  assert.ok(w.position.y > 1);
  assert.ok(Math.abs(w.position.x) < 90);
});
test('each flight control turns the intended body axis', () => {
  for (const [control, axis, sign] of [
    ['roll', 'x', 1],
    ['pitch', 'z', 1],
    ['yaw', 'y', -1],
  ] as const) {
    const w = airborne();
    w.setInput({ [control]: 0.6 });
    run(w, 0.2);
    assert.ok(w.angularVelocity[axis] * sign > 0.08);
  }
});

test('servo travel, transmitter expo and motor spool-up avoid instant full authority', () => {
  const w = airborne();
  w.setInput({ roll: 1, throttle: 1 });
  w.advance(STEP);
  assert.ok(w.surfaces.roll > 0 && w.surfaces.roll < 0.04);
  assert.ok(w.surfaces.throttle > 0 && w.surfaces.throttle < 0.03);
  assert.ok(controlResponse(0.5) < 0.5);
  assert.equal(controlResponse(1), 1);
  run(w, 0.5);
  assert.ok(w.surfaces.roll > 0.9);
  w.setInput({ roll: 0 });
  const before = w.angularVelocity.x;
  w.advance(STEP);
  assert.ok(w.surfaces.roll > 0);
  assert.ok(w.angularVelocity.x > before * 0.5);
});

test('ailerons need airflow, and higher airspeed gives stronger control forces', () => {
  const slow = airborne(),
    fast = airborne();
  slow.velocity.x = 6;
  fast.velocity.x = 16;
  for (const w of [slow, fast]) {
    w.setInput({ roll: 0.5 });
    run(w, 0.25);
  }
  assert.ok(fast.angularVelocity.x > slow.angularVelocity.x * 1.5);
  const still = airborne();
  still.velocity.set(0, 0, 0);
  still.setInput({ throttle: 1, roll: 1 });
  still.advance(STEP);
  assert.ok(Math.abs(still.angularVelocity.x) < 1e-8);
});

test('banked lift curves the flight path and ailerons introduce adverse yaw', () => {
  const bank = airborne();
  bank.orientation.setFromAxisAngle(new Vector3(1, 0, 0), 0.45);
  run(bank, 0.3);
  assert.ok(bank.velocity.z > 0.05);
  const roll = airborne();
  roll.setInput({ roll: 0.6 });
  run(roll, 0.08);
  assert.ok(roll.angularVelocity.x > 0);
  assert.ok(roll.angularVelocity.y > 0);
});

test('tailwheel cannot pivot a stationary plane and steers a moving rollout', () => {
  const stationary = new AirplaneWorld();
  stationary.setInput({ yaw: 0.6 });
  run(stationary, 2);
  assert.ok(Math.abs(stationary.angularVelocity.y) < 0.015);
  const rolling = new AirplaneWorld();
  rolling.velocity.x = 4;
  rolling.setInput({ yaw: 0.6 });
  run(rolling, 1);
  assert.equal(rolling.state, 'ground');
  assert.ok(rolling.velocity.z > 0.03);
});
test('stall loses lift and lowering angle of attack restores attached flow', () => {
  assert.ok(liftCoefficient(0.6) < liftCoefficient(0.26) * 0.7);
  const w = airborne();
  w.orientation.setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
  w.advance(STEP);
  assert.equal(w.state, 'stalled');
  w.setInput({ pitch: -0.5 });
  run(w, 0.7);
  assert.ok(Math.abs(w.alpha) < 0.3);
  assert.equal(w.state, 'flying');
});
test('a gentle wheels-first landing settles without crashing', () => {
  for (const speed of [4, 7, 9, 11]) {
    const w = new AirplaneWorld();
    w.position.y = 0.6;
    w.velocity.set(speed, -0.5, 0);
    run(w, 40);
    assert.equal(w.state, 'ground', `Landing at ${speed} m/s`);
    assert.ok(w.velocity.length() < 0.2);
  }
});
test('hard impacts and inverted hull contacts end the flight', () => {
  const hard = new AirplaneWorld();
  hard.position.y = 0.45;
  hard.velocity.y = -5;
  run(hard, 0.2);
  assert.equal(hard.state, 'crashed');
  const hull = new AirplaneWorld();
  hull.orientation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  hull.position.y = 0.2;
  hull.advance(STEP);
  assert.equal(hull.state, 'crashed');
  const snapshot = hard.stats();
  run(hard, 2);
  assert.deepEqual(hard.stats(), snapshot);
});
test('grass slows the same rollout sooner than the runway', () => {
  const runway = new AirplaneWorld(),
    grass = new AirplaneWorld();
  grass.position.z = 20;
  for (const w of [runway, grass]) {
    w.velocity.x = 4;
    run(w, 1);
  }
  assert.ok(grass.velocity.x < runway.velocity.x - 0.7);
});
test('pause is exact, reset restores defaults and invalid inputs stay finite', () => {
  const w = airborne();
  w.setInput({ throttle: 2, roll: NaN });
  assert.equal(w.input.throttle, 1);
  assert.equal(w.input.roll, 0);
  w.paused = true;
  const snapshot = w.stats();
  run(w, 2);
  assert.deepEqual(w.stats(), snapshot);
  w.reset();
  assert.deepEqual(w.stats(), new AirplaneWorld().stats());
  w.advance(NaN);
  assert.deepEqual(w.stats(), new AirplaneWorld().stats());
});
test('fixed stepping produces the same flight at 30, 60 and 144 Hz', () => {
  const worlds = [30, 60, 144].map((hz) => {
    const w = airborne();
    w.setInput({ throttle: 0.65, roll: 0.05 });
    run(w, 3, 1 / hz);
    return w;
  });
  for (const w of worlds.slice(1)) {
    assert.ok(w.position.distanceTo(worlds[0].position) < 1e-8);
    assert.ok(w.orientation.angleTo(worlds[0].orientation) < 1e-6);
  }
});
