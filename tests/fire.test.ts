import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { FireWorld, STICK_LIMIT, ASH_LIMIT, segmentContact } from '../src/fire/physics';

function advance(world: FireWorld, seconds: number, hz = 30) {
  for (let i = 0; i < Math.round(seconds * hz); i++) world.advance(1 / hz);
}
function height(world: FireWorld) {
  return Math.max(...world.sticks.map((s) => Math.max(s.a.y, s.b.y) + s.radius), 0);
}
function assertContacts(world: FireWorld, tolerance = 0.015) {
  for (const s of world.sticks) {
    assert.ok(s.a.y >= s.radius - 1e-6 && s.b.y >= s.radius - 1e-6, 'wood stays above ground');
    assert.ok(Math.abs(s.a.distanceTo(s.b) - s.length) < tolerance, 'stick length is preserved');
    assert.ok([...s.a.toArray(), ...s.b.toArray()].every(Number.isFinite));
  }
  for (let i = 0; i < world.sticks.length; i++)
    for (let j = i + 1; j < world.sticks.length; j++) {
      const a = world.sticks[i],
        b = world.sticks[j],
        c = segmentContact(a.a, a.b, b.a, b.b);
      assert.ok(
        Math.hypot(c.dx, c.dy, c.dz) >= a.radius + b.radius - tolerance,
        'supports do not interpenetrate',
      );
    }
}

test('finite segment contacts handle parallel, crossing and endpoint pairs', () => {
  const v = (x: number, y: number, z = 0) => new Vector3(x, y, z);
  const parallel = segmentContact(v(-1, 0), v(1, 0), v(-1, 0.3), v(1, 0.3));
  assert.equal(Math.hypot(parallel.dx, parallel.dy, parallel.dz), 0.3);
  const crossing = segmentContact(v(-1, 0), v(1, 0), v(0, 0, -1), v(0, 0, 1));
  assert.equal(crossing.s, 0.5);
  assert.equal(crossing.t, 0.5);
  const endpoint = segmentContact(v(0, 0), v(1, 0), v(2, 1), v(2, 2));
  assert.equal(endpoint.s, 1);
  assert.equal(endpoint.t, 0);
  const point = segmentContact(v(-1, 0), v(1, 0), v(0, 0.3), v(0, 0.3));
  assert.equal(point.s, 0.5);
  assert.equal(point.t, 0);
  assert.equal(point.dy, -0.3);
});
test('initial crossed stack is stable and reset is deterministic', () => {
  const world = new FireWorld(),
    initial = world.stats();
  assert.equal(initial.count, 9);
  assert.ok(initial.intensity > 0.7);
  assertContacts(world);
  advance(world, 4);
  assertContacts(world);
  assert.ok(Math.abs(height(world) - height(new FireWorld())) < 0.04);
  world.addWood();
  world.setWind(1);
  world.paused = true;
  world.reset();
  assert.deepEqual(world.stats(), initial);
});
test('new fuel heats from adjacent wood, ignites, and respects capacity', () => {
  const world = new FireWorld();
  assert.equal(world.addWood(), true);
  const added = world.sticks.at(-1)!;
  assert.equal(added.heat, 0);
  advance(world, 25);
  assert.ok(added.heat > 0.48);
  assert.ok(added.fuel < 1);
  assertContacts(world, 0.03);
  while (world.sticks.length < STICK_LIMIT) assert.equal(world.addWood(), true);
  assert.equal(world.addWood(), false);
  advance(world, 6);
  assertContacts(world, 0.035);
});
test('fuel chars, supports shrink and settle, then embers cool within about four minutes', () => {
  const world = new FireWorld(),
    initialHeight = height(world);
  advance(world, 130);
  assert.ok(world.sticks.every((s) => s.char > 0.7 && s.fuel < 0.35));
  assert.ok(height(world) < initialHeight * 0.8);
  assertContacts(world);
  advance(world, 65);
  assert.equal(world.sticks.length, 0);
  assert.equal(world.ash.length, 9);
  assert.ok(world.glow > 0);
  advance(world, 65);
  assert.equal(world.glow, 0);
  assert.ok(world.ash.length <= ASH_LIMIT);
  assert.equal(world.ignite(), false);
  assert.equal(world.addWood(), true);
  assert.equal(world.ignite(), true);
  advance(world, 4);
  assert.ok(world.intensity > 0.05);
});
test('ignition propagates through a cold stack', () => {
  const world = new FireWorld();
  world.sticks.forEach((s) => {
    s.heat = 0;
    s.flame = 0;
    s.ember = 0;
    s.char = 0;
  });
  advance(world, 5);
  assert.equal(world.intensity, 0);
  assert.equal(world.ignite(), true);
  advance(world, 45);
  assert.ok(world.sticks.filter((s) => s.flame > 0.2).length >= 6);
});
test('hot ember bed can ignite newly added fuel without the ignition button', () => {
  const world = new FireWorld();
  advance(world, 193);
  assert.equal(world.sticks.length, 0);
  assert.equal(world.addWood(), true);
  advance(world, 18);
  assert.ok(world.sticks[0].heat > 0.48);
  assert.ok(world.sticks[0].fuel < 1);
});
test('pause freezes all simulation state and prevents fuel actions', () => {
  const world = new FireWorld();
  advance(world, 2);
  world.paused = true;
  const before = world.stats();
  world.advance(10);
  assert.equal(world.addWood(), false);
  assert.equal(world.ignite(), false);
  assert.deepEqual(world.stats(), before);
});
test('consumed fuel never grows the ash pool beyond its fixed capacity', () => {
  const world = new FireWorld();
  for (let cycle = 0; cycle < 6; cycle++) {
    while (world.addWood()) {
      /* fill available slots */
    }
    world.sticks.forEach((s) => {
      s.fuel = 0;
    });
    world.advance(1 / 120);
    assert.equal(world.sticks.length, 0);
    assert.ok(world.ash.length <= ASH_LIMIT);
  }
  assert.equal(world.ash.length, ASH_LIMIT);
});
test('fixed stepping is render-rate independent and bounded for long or invalid frames', () => {
  const slow = new FireWorld(),
    fast = new FireWorld();
  advance(slow, 3, 30);
  advance(fast, 3, 144);
  assert.deepEqual(slow.stats(), fast.stats());
  const before = slow.time;
  slow.advance(100);
  assert.ok(slow.time - before < 0.101);
  const snapshot = slow.stats();
  for (const delta of [NaN, Infinity, -1, 0]) slow.advance(delta);
  assert.deepEqual(slow.stats(), snapshot);
  slow.setWind(Infinity);
  assert.equal(slow.wind, 0.2);
  slow.setWind(2);
  assert.equal(slow.wind, 1);
  slow.setWind(-1);
  assert.equal(slow.wind, 0);
});
