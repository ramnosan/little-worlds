import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld, BUBBLE_LIMIT } from '../src/bubbles/physics';
import { DartSystem, DART_LIMIT } from '../src/bubbles/darts';

test('mouse spring follows targets, bounds speed and preserves release momentum', () => {
  const w = new BubbleWorld();
  w.wind = 0;
  const b = w.spawn(0.7, [0, 3, 0])!;
  b.velocity = [0, 0, 0];
  assert.ok(w.beginDrag(b.id, [2, 3, 0]));
  for (let i = 0; i < 120; i++) w.advance(1 / 120);
  assert.ok(Math.abs(b.position[0] - 2) < 0.05);
  w.updateDrag([100, 3, 0]);
  for (let i = 0; i < 30; i++) {
    w.advance(1 / 120);
    assert.ok(Math.hypot(...b.velocity) <= 8 + 1e-10);
  }
  const velocity = [...b.velocity],
    x = b.position[0];
  w.endDrag();
  assert.deepEqual(b.velocity, velocity);
  w.advance(1 / 120);
  assert.ok(b.position[0] > x);
  assert.equal(w.dragState, null);
  w.dispose();
});

test('drag rejects paused or missing targets and clears on removal/reset', () => {
  const w = new BubbleWorld();
  const b = w.spawn(0.7, [0, 3, 0])!;
  w.paused = true;
  assert.equal(w.beginDrag(b.id, [1, 3, 0]), false);
  w.paused = false;
  assert.equal(w.beginDrag(-1, [1, 3, 0]), false);
  assert.ok(w.beginDrag(b.id, [1, 3, 0]));
  w.dragState!.target[0] = 999;
  assert.equal(w.dragState!.target[0], 1);
  w.pop(b.id);
  assert.equal(w.dragState, null);
  const c = w.spawn(0.7, [0, 3, 0])!;
  w.beginDrag(c.id, [1, 3, 0]);
  w.reset();
  assert.equal(w.dragState, null);
});

test('bubble motion is independent of render frequency', () => {
  const simulate = (fps: number) => {
    const world = new BubbleWorld();
    world.spawn(0.65, [0, 2, 0]);
    for (let i = 0; i < fps * 10; i++) world.advance(1 / fps);
    return world.bubbles[0];
  };
  const slow = simulate(30),
    fast = simulate(144);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(slow.position[k] - fast.position[k]) < 1e-8);
});

test('wind carries bubbles and still air damps launch momentum', () => {
  const calm = new BubbleWorld(),
    windy = new BubbleWorld();
  calm.wind = 0;
  windy.wind = 1;
  const a = calm.spawn(0.7, [0, 3, 0])!,
    b = windy.spawn(0.7, [0, 3, 0])!;
  for (let i = 0; i < 600; i++) {
    calm.advance(1 / 60);
    windy.advance(1 / 60);
  }
  assert.ok(Math.abs(a.velocity[0]) < 0.001);
  assert.ok(b.position[0] > a.position[0] + 1);
  assert.ok(Math.hypot(...b.velocity) < 1);
});

test('pause freezes, reset clears progress and cap never counts rejected spawns', () => {
  const world = new BubbleWorld();
  for (let i = 0; i < BUBBLE_LIMIT; i++) world.spawn(0.3, [i * 0.7, 2, 0]);
  assert.equal(world.spawn(0.3, [0, 2, 0]), null);
  assert.equal(world.created, BUBBLE_LIMIT);
  const before = JSON.stringify(world.bubbles);
  world.paused = true;
  world.advance(1);
  assert.equal(JSON.stringify(world.bubbles), before);
  world.reset();
  assert.equal(world.created, 0);
  assert.equal(world.bubbles.length, 0);
  assert.equal(world.paused, false);
});

test('contacts separate coincident bubbles and expired films pop once', () => {
  const world = new BubbleWorld();
  let pops = 0;
  world.onPop = () => pops++;
  const a = world.spawn(0.6, [0, 2, 0])!,
    b = world.spawn(0.6, [0, 2, 0])!;
  world.advance(1 / 60);
  assert.ok(Math.hypot(...a.position.map((v, k) => v - b.position[k])) >= 1.188);
  assert.equal(a.contacts.length, 0);
  assert.equal(b.contacts.length, 0);
  a.lifetime = 0.02;
  world.advance(1 / 30);
  assert.equal(pops, 1);
  world.pop(a.id);
  assert.equal(pops, 1);
  for (let i = 0; i < 4000; i++) world.advance(1 / 60);
  assert.equal(world.bubbles.length, 0);
  assert.equal(pops, 2);
});

test('gentle contacts bind, share a film and release cleanly when a bubble pops', () => {
  const world = new BubbleWorld();
  world.wind = 0;
  const a = world.spawn(0.6, [-0.595, 2, 0])!,
    b = world.spawn(0.6, [0.595, 2, 0])!;
  a.velocity = [0.02, 0, 0];
  b.velocity = [-0.02, 0, 0];
  for (let i = 0; i < 180; i++) world.advance(1 / 120);
  assert.equal(world.bonds.length, 1);
  assert.ok(a.contacts[0].offset < 0.99);
  const normal = a.contacts[0].normal;
  const capA =
    normal.reduce((s, n, k) => s + n * a.position[k], 0) + a.contacts[0].offset * a.radius;
  const capB =
    normal.reduce((s, n, k) => s + n * b.position[k], 0) - b.contacts[0].offset * b.radius;
  assert.ok(Math.abs(capA - capB) < 1e-9, 'shared film must have a common world plane');
  world.pop(a.id);
  assert.equal(world.bonds.length, 0);
  assert.equal(b.contacts.length, 0);
});

test('a glancing impact transfers mass-weighted momentum without locking tangential slip', () => {
  const world = new BubbleWorld(),
    free = new BubbleWorld();
  world.wind = free.wind = 0;
  const a = world.spawn(0.3, [-0.295, 2, 0])!,
    b = world.spawn(0.9, [0.895, 2, 0])!;
  const aa = free.spawn(0.3, [-4, 2, 0])!,
    bb = free.spawn(0.9, [4, 2, 0])!;
  a.velocity = aa.velocity = [0.9, 0, 0.25];
  b.velocity = bb.velocity = [-0.1, 0, -0.15];
  // Assign independent arrays because the worlds update them in place.
  aa.velocity = [...a.velocity];
  bb.velocity = [...b.velocity];
  world.advance(1 / 120);
  free.advance(1 / 120);
  const dvA = a.velocity[0] - aa.velocity[0],
    dvB = b.velocity[0] - bb.velocity[0];
  assert.ok(Math.abs(dvA) > Math.abs(dvB) * 4, 'smaller film yields more');
  assert.ok(Math.abs(dvA * a.mass + dvB * b.mass) < 1e-9, 'contact impulse conserves momentum');
  assert.ok(b.velocity[0] > a.velocity[0], 'impact rebounds');
  assert.ok(a.velocity[2] - b.velocity[2] > 0.3, 'tangent is not glued');
  assert.ok(a.deformationVelocity > 0, 'impact excites film oscillation');
  assert.equal(world.bonds.length, 0);
});

test('eligible shared films coalesce without gaining air, momentum or goal progress', () => {
  const world = new BubbleWorld();
  world.wind = 0;
  const a = world.spawn(0.6, [-0.595, 3, 0])!,
    b = world.spawn(0.6, [0.595, 3, 0])!;
  a.age = b.age = 0;
  a.lifetime = b.lifetime = 40;
  a.velocity = [0, 0, 0];
  b.velocity = [0, 0, 0];
  const volume = a.radius ** 3 + b.radius ** 3,
    mass = a.mass + b.mass;
  for (let i = 0; i < 720; i++) world.advance(1 / 120);
  assert.equal(world.bubbles.length, 1);
  assert.ok(Math.abs(world.bubbles[0].radius ** 3 - volume) < 1e-9);
  assert.equal(world.bubbles[0].mass, mass);
  assert.equal(world.created, 2);
  assert.equal(world.bonds.length, 0);
});

test('bonded contact trajectories are independent of rendering rate and freeze on pause', () => {
  const simulate = (fps: number) => {
    const w = new BubbleWorld();
    w.wind = 0;
    w.spawn(0.6, [-0.595, 2, 0]);
    w.spawn(0.6, [0.595, 2, 0]);
    for (let i = 0; i < fps * 2; i++) w.advance(1 / fps);
    return w;
  };
  const slow = simulate(30),
    fast = simulate(144);
  assert.deepEqual(slow.bubbles, fast.bubbles);
  assert.deepEqual(slow.bonds, fast.bonds);
  assert.equal(slow.bonds.length, 1);
  const state = JSON.stringify([slow.bubbles, slow.bonds]);
  slow.paused = true;
  slow.advance(10);
  assert.equal(JSON.stringify([slow.bubbles, slow.bonds]), state);
  slow.reset();
  assert.equal(slow.bonds.length, 0);
});

test('invalid deltas and long tab suspensions cannot corrupt or explode the simulation', () => {
  const world = new BubbleWorld();
  const b = world.spawn(1, [0, 2, 0])!;
  world.advance(NaN);
  world.advance(Infinity);
  world.advance(-1);
  assert.equal(world.time, 0);
  world.advance(1000);
  assert.ok(world.time <= 0.101);
  assert.ok([...b.position, ...b.velocity].every(Number.isFinite));
});

test('a full crowd of coincident spawns stays finite and resolves without deep overlaps', () => {
  const w = new BubbleWorld();
  w.wind = 0;
  for (let i = 0; i < BUBBLE_LIMIT; i++) w.spawn(0.3 + (i % 4) * 0.1, [0, 3, 0]);
  for (let i = 0; i < 120; i++) w.advance(1 / 120);
  assert.equal(w.bubbles.length, BUBBLE_LIMIT);
  for (const a of w.bubbles) {
    assert.ok([...a.position, ...a.velocity, a.deformation].every(Number.isFinite));
    assert.ok(Math.hypot(...a.velocity) < 2);
    for (const b of w.bubbles)
      if (a.id < b.id) {
        const distance = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
        assert.ok(distance > a.radius + b.radius - Math.min(a.radius, b.radius) * 0.13);
      }
  }
});

test('a swept dart pierces small bubbles in flight order without tunneling or double counting', () => {
  const darts = new DartSystem();
  const hits: number[] = [];
  darts.launch([0, 3, 0], [1, 0, 0]);
  darts.launch([0, 3, 0], [1, 0, 0]);
  darts.advance(
    0.05,
    [
      { id: 2, position: [0.9, 3, 0], radius: 0.12 },
      { id: 1, position: [0.4, 3, 0], radius: 0.12 },
    ],
    new Map(),
    (id) => hits.push(id),
  );
  assert.deepEqual(hits, [1, 2]);
  assert.equal(darts.hits, 2);
});

test('relative swept collision catches a moving bubble and ignores nearby misses', () => {
  const darts = new DartSystem();
  const hits: number[] = [];
  darts.launch([0, 3, 0], [1, 0, 0]);
  darts.advance(
    0.05,
    [
      { id: 1, position: [0.7, 3, 0.5], radius: 0.12 },
      { id: 2, position: [0.7, 3, 1], radius: 0.12 },
    ],
    new Map([[1, [0.7, 3, -0.5]]]),
    (id) => hits.push(id),
  );
  assert.deepEqual(hits, [1]);
});

test('dart flight is rate-independent, paused with the world, bounded and resettable', () => {
  const simulate = (fps: number) => {
    const w = new BubbleWorld();
    w.throwDart([0, 2, 10], [0, 0, -1]);
    for (let i = 0; i < fps / 2; i++) w.advance(1 / fps);
    return w;
  };
  const a = simulate(30),
    b = simulate(144);
  assert.deepEqual(a.darts.projectiles, b.darts.projectiles);
  const before = JSON.stringify(a.darts.projectiles);
  a.paused = true;
  a.advance(1);
  assert.equal(JSON.stringify(a.darts.projectiles), before);
  assert.equal(a.throwDart([0, 2, 10], [0, 0, -1]), null);
  a.paused = false;
  for (let i = 0; i < 240; i++) a.advance(1 / 60);
  assert.equal(a.darts.projectiles.length, 0);
  for (let i = 0; i < DART_LIMIT; i++) a.throwDart([0, 2, 10], [0, 0, -1]);
  assert.equal(a.throwDart([0, 2, 10], [0, 0, -1]), null);
  a.reset();
  assert.equal(a.darts.projectiles.length, 0);
  assert.equal(a.darts.thrown, 0);
  assert.equal(a.darts.hits, 0);
});

test('dart impacts use the normal bubble pop lifecycle and do not change creation progress', () => {
  const w = new BubbleWorld();
  let pops = 0;
  w.onPop = () => pops++;
  const bubble = w.spawn(0.6, [0, 2, 0])!;
  w.throwDart([0, 2, 2], [0, 0, -1]);
  for (let i = 0; i < 20; i++) w.advance(1 / 120);
  assert.ok(!w.bubbles.some((b) => b.id === bubble.id));
  assert.equal(pops, 1);
  assert.equal(w.darts.hits, 1);
  assert.equal(w.created, 1);
});
