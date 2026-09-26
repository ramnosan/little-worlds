import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, SoftBody, ARENA, RAMP } from '../src/physics/world';
import { BLOB_TOPOLOGY } from '../src/physics/topology';

function simulate(world: PhysicsWorld, seconds: number, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) world.advance(1 / fps);
}

test('mallet strikes transfer momentum and recover without unstable stretching', () => {
  for (const softness of [0, 1]) {
    const world = new PhysicsWorld();
    world.softness = softness;
    world.gravity = 0;
    const body = world.spawn(0.9, '#fff', [0, 1, 0])!;
    world.mallet.enabled = true;
    world.mallet.aim([-0.6, 1, 0]);
    world.mallet.swing();
    simulate(world, 0.45);
    // Wind-up contact can launch softer jellies before the forward stroke arrives.
    assert.ok(
      Math.hypot(body.center[0], body.center[2]) > 0.4,
      'the moving head must bat the jelly away',
    );
    assert.ok(
      body.velocities.some((v, i) => i % 3 === 0 && Math.abs(v) > 1),
      'strike transfers velocity',
    );
    world.mallet.end();
    simulate(world, 3);
    finite(body);
    assert.ok(Math.abs(body.volume() / body.restVolume - 1) < 0.08);
    assert.ok(body.bounds[3] - body.bounds[0] < 3.5);
  }
});

test('equipped mallet collides while idle and throughout every swing phase', () => {
  for (const time of [0, 0.08, 0.3, 0.57, 0.8]) {
    const world = new PhysicsWorld();
    world.mallet.enabled = true;
    world.mallet.aim([0, 1, 0]);
    if (time > 0) {
      world.mallet.swing();
      world.mallet.advance(time);
    }
    const p = world.mallet.position;
    const body = world.spawn(0.9, '#fff', [p[0] + 0.9, p[1], p[2]])!;
    const before = body.positions.slice();
    world.mallet.collide(body);
    assert.notDeepEqual(body.positions, before, `contact must resolve at swing time ${time}`);
    world.mallet.enabled = false;
    const after = body.positions.slice();
    world.mallet.collide(body);
    assert.deepEqual(body.positions, after, 'putting down the mallet disables its collider');
  }
});

test('mallet is bounded, freezes while paused and clears on reset', () => {
  const world = new PhysicsWorld();
  world.mallet.enabled = true;
  world.mallet.aim([999, 999, 999]);
  world.mallet.swing();
  const start = [...world.mallet.position];
  world.paused = true;
  simulate(world, 1);
  assert.deepEqual(world.mallet.position, start);
  world.paused = false;
  simulate(world, 1);
  assert.deepEqual(world.mallet.position, [4.9, 1, 2.9]);
  world.clear();
  assert.equal(world.mallet.active, false);
  assert.equal(world.mallet.enabled, false);
});
function finite(body: SoftBody) {
  assert.ok(body.positions.every(Number.isFinite), 'all particle positions must be finite');
  assert.ok(body.velocities.every(Number.isFinite), 'all velocities must be finite');
  assert.ok(body.volume() > 0, 'surface must keep outward orientation');
}
function diagnostics(body: SoftBody) {
  return {
    volumeRatio: body.volume() / body.restVolume,
    center: body.center,
    height: body.bounds[4] - body.bounds[1],
    width: body.bounds[3] - body.bounds[0],
  };
}

test('closed welded topology has positive volume and two faces per edge', () => {
  assert.equal(BLOB_TOPOLOGY.vertices.length / 3, 162);
  const edges = new Map<string, number>();
  for (let i = 0; i < BLOB_TOPOLOGY.faces.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = BLOB_TOPOLOGY.faces[i + j],
        b = BLOB_TOPOLOGY.faces[i + ((j + 1) % 3)],
        key = [Math.min(a, b), Math.max(a, b)].join(':');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  assert.ok([...edges.values()].every((v) => v === 2));
  const b = new SoftBody(1, 1, '#fff', [0, 0, 0]);
  assert.ok(b.restVolume > 4 && b.restVolume < 4.2);
});

test('drop preserves volume and settles on the floor', () => {
  const w = new PhysicsWorld(),
    b = w.spawn(0.9, '#fff', [0, 4, 0])!;
  simulate(w, 6);
  finite(b);
  const d = diagnostics(b);
  console.log('drop', d);
  assert.ok(Math.abs(d.volumeRatio - 1) < 0.06);
  assert.ok(b.bounds[1] >= 0.034);
  assert.ok(b.center[1] < 1.1);
  assert.ok(d.width > d.height, 'resting jelly should visibly flatten');
});

test('local grab deforms mesh and release recovers without volume collapse', () => {
  const w = new PhysicsWorld(),
    b = w.spawn(0.9, '#fff', [0, 1, 0])!;
  simulate(w, 1);
  w.beginGrab(b, [0, b.bounds[4], 0]);
  w.moveGrab([1, 3.7, 0]);
  let peakHeight = 0;
  for (let i = 0; i < 15; i++) {
    w.advance(1 / 60);
    peakHeight = Math.max(peakHeight, b.bounds[4] - b.bounds[1]);
  }
  finite(b);
  assert.ok(peakHeight > 2.1, 'local pull stretches the body before its center follows');
  w.endGrab();
  simulate(w, 7);
  finite(b);
  console.log('grab recovery', diagnostics(b));
  assert.ok(Math.abs(b.volume() / b.restVolume - 1) < 0.06);
  assert.ok(b.bounds[4] - b.bounds[1] < 2.2);
});

test('simulation is independent of render frame rate and clamps long catch-up', () => {
  const worlds = [30, 60, 120].map((fps) => {
    const w = new PhysicsWorld();
    w.spawn(0.9, '#fff', [-1, 4, 0]);
    simulate(w, 2, fps);
    return w;
  });
  for (const w of worlds.slice(1))
    for (let i = 0; i < w.bodies[0].positions.length; i++)
      assert.ok(Math.abs(w.bodies[0].positions[i] - worlds[0].bodies[0].positions[i]) < 1e-9);
  worlds[0].advance(100);
  finite(worlds[0].bodies[0]);
});

test('spawn cap, delete while grabbed, pause, and clear are coherent', () => {
  const w = new PhysicsWorld();
  for (let i = 0; i < 9; i++) w.spawn(0.65, '#fff', [(i % 3) - 1, 2 + Math.floor(i / 3) * 1.4, 0]);
  assert.equal(w.bodies.length, 8);
  const b = w.bodies[0];
  w.beginGrab(b, [...b.center]);
  w.remove(b.id);
  assert.equal(w.grab, null);
  assert.equal(w.bodies.length, 7);
  const original = w.bodies[0].positions.slice();
  w.paused = true;
  simulate(w, 1);
  assert.deepEqual(w.bodies[0].positions, original);
  w.clear();
  assert.equal(w.bodies.length, 0);
  assert.equal(w.grab, null);
});

test('ramp supports a body and bounded walls survive a fast throw', () => {
  const w = new PhysicsWorld(),
    b = w.spawn(0.65, '#fff', [3.25, 2, -1.9])!;
  simulate(w, 0.5);
  finite(b);
  for (let i = 0; i < b.positions.length; i += 3) {
    const p = b.positions;
    if (p[i] > RAMP.minX && p[i] < RAMP.maxX && p[i + 2] > RAMP.minZ && p[i + 2] < RAMP.maxZ)
      assert.ok(p[i + 1] >= (RAMP.maxZ - p[i + 2]) * RAMP.slope - 0.001);
  }
  for (let i = 0; i < b.velocities.length; i += 3) b.velocities[i] = 18;
  simulate(w, 2);
  assert.ok(b.bounds[3] <= ARENA.halfX);
  finite(b);
});

test('two bodies in a vertical stack remain separated', () => {
  const w = new PhysicsWorld(),
    a = w.spawn(0.9, '#fff', [0, 0.95, 0])!,
    b = w.spawn(0.9, '#fff', [0, 3, 0])!;
  simulate(w, 4);
  finite(a);
  finite(b);
  const distance = Math.hypot(...a.center.map((v, i) => v - b.center[i]));
  console.log('two-body separation', distance, diagnostics(a), diagnostics(b));
  assert.ok(distance > 1.25, 'bodies should not collapse into one another');
  for (const body of [a, b]) assert.ok(Math.abs(body.volume() / body.restVolume - 1) < 0.1);
});

test('eight-body stress remains bounded at extreme softness and gravity', () => {
  const start = performance.now();
  for (const [softness, gravity] of [
    [0, 0],
    [1, 0],
    [0, 2],
    [1, 2],
  ]) {
    const w = new PhysicsWorld();
    w.softness = softness;
    w.gravity = gravity;
    for (let i = 0; i < 8; i++)
      w.spawn(0.65 + (i % 3) * 0.2, '#fff', [
        ((i % 4) - 1.5) * 2,
        1.3 + Math.floor(i / 4) * 2.7,
        i % 2 === 0 ? -0.9 : 0.9,
      ]);
    simulate(w, 5);
    for (const b of w.bodies) {
      finite(b);
      assert.ok(b.bounds[1] >= 0.034);
      assert.ok(b.bounds[4] <= ARENA.ceiling + 0.001);
      assert.ok(
        Math.abs(b.volume() / b.restVolume - 1) < 0.15,
        JSON.stringify({ softness, gravity, ...diagnostics(b) }),
      );
    }
  }
  console.log(
    `Eight-body stress: ${(performance.now() - start).toFixed(0)} ms for 20 simulated seconds.`,
  );
});
