import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorld, type SoftBody } from '../src/physics/world';

// Independent ray/triangle parity check: volume and center distance alone can
// both look healthy while the two surfaces are actually threaded together.
function inside(point: Float64Array, index: number, body: SoftBody): boolean {
  const p = body.positions,
    faces = body.topology.faces;
  const x = point[index],
    y = point[index + 1],
    z = point[index + 2];
  if (
    x <= body.bounds[0] ||
    x >= body.bounds[3] ||
    y <= body.bounds[1] ||
    y >= body.bounds[4] ||
    z <= body.bounds[2] ||
    z >= body.bounds[5]
  )
    return false;
  let crossings = 0;
  const dx = 0.8273,
    dy = 0.3719,
    dz = 0.4217;
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f] * 3,
      b = faces[f + 1] * 3,
      c = faces[f + 2] * 3;
    const e1x = p[b] - p[a],
      e1y = p[b + 1] - p[a + 1],
      e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a],
      e2y = p[c + 1] - p[a + 1],
      e2z = p[c + 2] - p[a + 2];
    const hx = dy * e2z - dz * e2y,
      hy = dz * e2x - dx * e2z,
      hz = dx * e2y - dy * e2x;
    const determinant = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(determinant) < 1e-10) continue;
    const sx = x - p[a],
      sy = y - p[a + 1],
      sz = z - p[a + 2];
    const u = (sx * hx + sy * hy + sz * hz) / determinant;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y,
      qy = sz * e1x - sx * e1z,
      qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) / determinant;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) / determinant > 1e-7) crossings++;
  }
  return crossings % 2 === 1;
}

function intersections(world: PhysicsWorld): number {
  let count = 0;
  for (const a of world.bodies)
    for (const b of world.bodies) {
      if (a === b) continue;
      for (let i = 0; i < a.positions.length; i += 3) if (inside(a.positions, i, b)) count++;
    }
  return count;
}

test('deeply overlapping blobs recover without threaded surfaces', () => {
  for (const offset of [0, 0.3, 0.8]) {
    const world = new PhysicsWorld();
    world.softness = 1;
    world.spawn(1.15, '#fff', [-0.4, 1.2, 0]);
    world.spawn(0.9, '#fff', [-0.4 + offset, 1.2, 0]);
    for (let frame = 0; frame < 120; frame++) world.advance(1 / 60);
    assert.equal(intersections(world), 0, `interleaved particles after recovery, offset ${offset}`);
    for (const body of world.bodies)
      assert.ok(Math.abs(body.volume() / body.restVolume - 1) < 0.08);
  }
});

test('dragging a jelly repeatedly through a crowded pile cannot tangle its neighbors', () => {
  const world = new PhysicsWorld();
  world.softness = 1;
  world.gravity = 2;
  for (let i = 0; i < 8; i++)
    world.spawn(0.9, '#fff', [
      (i % 2) * 1.9 - 2,
      1 + Math.floor(i / 4) * 2,
      (Math.floor(i / 2) % 2) * 1.9 - 1,
    ]);
  for (let frame = 0; frame < 90; frame++) world.advance(1 / 60);
  const body = world.bodies[0];
  world.beginGrab(body, [body.center[0] + 0.6, body.center[1], body.center[2]]);
  let worst = 0;
  for (let frame = 0; frame < 300; frame++) {
    world.moveGrab([
      Math.sin(frame * 0.08) * 3.7,
      0.5 + Math.sin(frame * 0.04) ** 2 * 2.8,
      Math.cos(frame * 0.07) * 2.6,
    ]);
    world.advance(1 / 60);
    if (frame % 15 === 0) worst = Math.max(worst, intersections(world));
  }
  world.endGrab();
  for (let frame = 0; frame < 120; frame++) world.advance(1 / 60);
  assert.equal(intersections(world), 0, 'surfaces remain interleaved after releasing the grab');
  assert.equal(worst, 0, 'particles crossed into another blob during dragging');
});

test('opposing fast throws preserve separate surfaces at every frame', () => {
  const world = new PhysicsWorld();
  world.gravity = 0;
  world.softness = 1;
  const a = world.spawn(0.9, '#fff', [-2, 2, 0])!,
    b = world.spawn(0.65, '#fff', [2, 2, 0])!;
  for (let i = 0; i < a.velocities.length; i += 3) {
    a.velocities[i] = 18;
    b.velocities[i] = -18;
  }
  for (let frame = 0; frame < 120; frame++) {
    world.advance(1 / 60);
    assert.equal(intersections(world), 0, `surfaces cross at frame ${frame}`);
  }
});
