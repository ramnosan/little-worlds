import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AvalancheWorld, type SnowKind } from '../src/avalanche/physics';
import { TERRAIN } from '../src/avalanche/terrain';

function run(world: AvalancheWorld, seconds: number, dt = 0.1) {
  for (let i = 0; i < Math.round(seconds / dt); i++) world.advance(dt);
}
test('snow waits for release; a fracture takes time to cross the slab', () => {
  const w = new AvalancheWorld();
  const before = w.parcels.map((p) => [p.x, p.z]);
  run(w, 2);
  assert.equal(w.elapsed, 0);
  assert.deepEqual(
    w.parcels.map((p) => [p.x, p.z]),
    before,
  );
  assert.equal(w.release(), true);
  assert.equal(w.release(), false);
  run(w, 0.4);
  assert.equal(w.phase, 'fracture');
  assert.ok(w.parcels.some((p) => p.state === 0));
  assert.ok(w.parcels.some((p) => p.state === 1));
  run(w, 3);
  assert.equal(w.phase, 'flow');
  assert.ok(!w.parcels.some((p) => p.state === 0));
});
test('pause freezes state and reset reproduces the initial event', () => {
  const w = new AvalancheWorld();
  w.release();
  run(w, 8);
  const snapshot = w.snapshot();
  const positions = w.parcels.map((p) => [p.x, p.y, p.z, p.vx, p.vz]);
  w.paused = true;
  run(w, 10);
  assert.deepEqual(
    w.parcels.map((p) => [p.x, p.y, p.z, p.vx, p.vz]),
    positions,
  );
  assert.equal(w.elapsed, snapshot.elapsed);
  w.reset();
  w.release();
  run(w, 8);
  assert.deepEqual(w.snapshot(), snapshot);
  assert.deepEqual(
    w.parcels.map((p) => [p.x, p.y, p.z, p.vx, p.vz]),
    positions,
  );
});
test('fixed steps give the same evolution across different frame rates', () => {
  const a = new AvalancheWorld(),
    b = new AvalancheWorld();
  a.release();
  b.release();
  run(a, 12, 1 / 30);
  run(b, 12, 1 / 120);
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.parcels, b.parcels);
});
test('flow entrains snow, conserves volume and deposits inside the valley for both materials', () => {
  const results = [];
  for (const kind of ['powder', 'wet'] as SnowKind[]) {
    const w = new AvalancheWorld();
    w.reset(1, kind);
    const volume = w.snapshot().totalVolume;
    w.release();
    run(w, 120);
    const s = w.snapshot();
    results.push(s);
    assert.equal(s.phase, 'settled');
    assert.equal(s.moving, 0);
    assert.equal(s.totalVolume, volume);
    assert.ok(s.entrainedVolume > 1000);
    assert.ok(Math.abs(s.depositedVolume - s.releasedVolume - s.entrainedVolume) < 1e-6);
    for (const p of w.parcels) {
      assert.ok([p.x, p.y, p.z, p.vx, p.vz, p.speed].every(Number.isFinite));
      assert.ok(p.x > TERRAIN.minX + 10 && p.x < TERRAIN.maxX - 10);
      assert.ok(
        p.z < TERRAIN.maxZ - 10,
        'snow must stop from friction before reaching the boundary',
      );
    }
  }
  assert.ok(results[0].peakSpeed > results[1].peakSpeed);
  assert.ok(results[0].front > results[1].front);
});
test('depth extremes remain finite and thicker snow carries more volume', () => {
  const fronts = [];
  for (const depth of [0.5, 2]) {
    const w = new AvalancheWorld();
    w.reset(depth);
    w.release();
    run(w, 150);
    assert.equal(w.phase, 'settled');
    assert.ok(Math.abs(w.releasedVolume - 110 * 92 * depth) < 1e-6);
    assert.ok(w.parcels.every((p) => Number.isFinite(p.y) && p.z < TERRAIN.maxZ - 10));
    fronts.push(w.front);
  }
  assert.ok(fronts[1] > fronts[0]);
});
test('invalid deltas cannot poison state and a long frame has bounded catch-up', () => {
  const w = new AvalancheWorld();
  w.release();
  for (const dt of [NaN, Infinity, -1, 0]) w.advance(dt);
  assert.equal(w.elapsed, 0);
  w.advance(600);
  assert.ok(w.elapsed <= 0.201);
});
