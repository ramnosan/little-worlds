import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PlantWorld,
  MAX_PLANTS,
  MAX_ROOTS,
  MAX_ROOT_POINTS,
  STAGES,
  type Point,
} from '../src/plant/growth';
import { stemPoint, leafPoint, petalPoint } from '../src/plant/shape';
const pos = (x = 0, y = -0.85): Point => [x, y, 0.6];
const start = () => {
  const w = new PlantWorld();
  w.plantBulb(pos());
  return w;
};
test('fixed steps reproduce plants across frame partitions and playback speeds', () => {
  const a = start(),
    b = start(),
    c = start();
  a.advance(90);
  for (let i = 0; i < 5400; i++) b.advance(1 / 60);
  c.speed = 20;
  c.advance(4.5);
  assert.deepEqual(a.plants, b.plants);
  assert.deepEqual(a.plants, c.plants);
  assert.equal(a.elapsed, b.elapsed);
  const five = start();
  five.speed = 5;
  five.advance(18);
  assert.deepEqual(five.plants, a.plants);
  const before = a.snapshot();
  a.snapshot();
  assert.deepEqual(a.snapshot(), before);
  const resumed = start();
  resumed.advance(0.012);
  resumed.paused = true;
  resumed.advance(20);
  resumed.paused = false;
  resumed.advance(0.988);
  const whole = start();
  whole.advance(1);
  assert.deepEqual(resumed.snapshot(), whole.snapshot());
});
test('placement validates burial, separation, finite input and twelve bulb capacity', () => {
  const w = new PlantWorld();
  assert.deepEqual(w.canPlant(pos(6)), { ok: false, reason: 'bounds' });
  assert.deepEqual(w.canPlant(pos(0, -0.1)), { ok: false, reason: 'depth' });
  assert.equal(w.plantBulb([NaN, -0.8, 0.6]).ok, false);
  for (let i = 0; i < MAX_PLANTS; i++) assert.equal(w.plantBulb(pos(-5.3 + i * 0.95)).ok, true);
  assert.deepEqual(w.canPlant(pos(5.6)), { ok: false, reason: 'capacity' });
  w.reset();
  w.plantBulb(pos());
  assert.deepEqual(w.canPlant(pos(0.2)), { ok: false, reason: 'spacing' });
});
test('staggered bulbs have their own ages, variation, pause, restart and bloom hold', () => {
  const w = start();
  w.advance(35);
  w.plantBulb(pos(3));
  let s = w.snapshot();
  assert.equal(s.plants[1].age, 0);
  assert.notEqual(s.plants[0].rate, s.plants[1].rate);
  w.paused = true;
  const before = w.snapshot();
  w.advance(30);
  assert.deepEqual(w.snapshot(), before);
  w.paused = false;
  w.speed = 20;
  w.advance(20);
  assert.ok(w.plants.every((p) => p.stage === 'bloom'));
  const organs = structuredClone(w.plants);
  w.advance(30);
  assert.deepEqual(w.plants, organs);
  w.reset();
  assert.equal(w.plants.length, 0);
  assert.equal(w.elapsed, 0);
  assert.equal(w.speed, 1);
  assert.equal(w.paused, false);
  w.plantBulb(pos());
  assert.deepEqual(w.plants, start().plants);
  for (const dt of [-1, NaN, Infinity]) w.advance(dt);
  assert.equal(w.elapsed, 0);
});
test('all developmental stages occur, including deeply planted bulbs', () => {
  for (const y of [-0.65, -0.85, -1.2]) {
    const w = new PlantWorld();
    w.plantBulb(pos(0, y));
    const stages: string[] = [];
    for (let i = 0; i < 9000; i++) {
      w.advance(1 / 30);
      const p = w.plants[0];
      if (stages.at(-1) !== p.stage) stages.push(p.stage);
    }
    assert.deepEqual(stages, STAGES);
  }
});
test('roots extend from attached bases, branch on existing nodes, avoid stones and stay bounded', () => {
  const w = start();
  w.advance(12);
  const early = structuredClone(w.plants[0].roots);
  w.advance(240);
  const p = w.plants[0];
  assert.ok(p.roots.length > early.length);
  assert.ok(p.roots.length <= MAX_ROOTS);
  p.roots.forEach((r, i) => {
    assert.ok(r.points.length <= MAX_ROOT_POINTS);
    if (r.parent >= 0) {
      assert.ok(r.parent < i);
      assert.deepEqual(r.points[0], p.roots[r.parent].points[r.attachment]);
    } else assert.equal(r.points[0][1], p.position[1] - 0.28);
    for (const n of r.points) {
      assert.ok(n.every(Number.isFinite));
      assert.ok(Math.abs(n[0]) <= 5.85 && n[1] >= -3.87 && n[2] >= 0.555 && n[2] <= 0.655);
      assert.ok(
        !w.soil.stones.some(
          (s) => Math.hypot(n[0] - s.position[0], n[1] - s.position[1]) < s.radius,
        ),
      );
    }
    if (i < early.length)
      assert.deepEqual(r.points.slice(0, early[i].points.length), early[i].points);
  });
});
test('gentle neighbours affect growth and paths while guaranteeing bloom', () => {
  const solo = start(),
    crowded = start();
  crowded.plantBulb(pos(0.8));
  solo.advance(100);
  crowded.advance(100);
  assert.ok(crowded.plants[0].development < solo.plants[0].development);
  assert.ok(crowded.plants[0].crowding >= 0.75);
  assert.notDeepEqual(crowded.plants[0].roots, solo.plants[0].roots);
  crowded.advance(240);
  assert.ok(crowded.plants.every((p) => p.stage === 'bloom'));
});
test('soil obstacles alter paths; previous-step interactions are independent of iteration order', () => {
  const a = start(),
    b = start();
  b.soil.stones.push({ position: [0, -1.4, 0.6], radius: 0.2 });
  a.advance(120);
  b.advance(120);
  assert.notDeepEqual(a.plants[0].roots, b.plants[0].roots);
  const c = start(),
    d = start();
  c.plantBulb(pos(1));
  d.plantBulb(pos(1));
  d.plants.reverse();
  c.advance(50);
  d.advance(50);
  assert.deepEqual(
    c.plants,
    [...d.plants].sort((p, q) => p.id - q.id),
  );
});

test('basal roots stay attached for every valid front-plane depth', () => {
  for (const z of [0.54, 0.6, 0.67]) {
    const w = new PlantWorld();
    assert.equal(w.plantBulb([0, -0.85, z]).ok, true);
    w.advance(25);
    for (const r of w.plants[0].roots.filter((r) => r.parent < 0)) {
      const [x, y, rz] = r.points[0];
      assert.equal(y, -0.85 - 0.28);
      assert.ok((x / 0.095) ** 2 + ((rz - z) / (0.095 * 0.55)) ** 2 <= 1);
      assert.ok(rz >= 0.555 && rz <= 0.655);
    }
  }
});

test('individual forms are reproducible, varied, and keep a curved lean at maturity', () => {
  const a = new PlantWorld(),
    b = new PlantWorld();
  for (let i = 0; i < MAX_PLANTS; i++) {
    a.plantBulb(pos(-5.3 + i * 0.95));
    b.plantBulb(pos(-5.3 + i * 0.95));
  }
  const forms = structuredClone(a.plants.map((p) => p.form));
  assert.deepEqual(
    forms,
    b.plants.map((p) => p.form),
  );
  assert.ok(new Set(forms.map((f) => f.palette)).size >= 4);
  assert.ok(new Set(a.plants.map((p) => p.leaves.length)).size >= 3);
  assert.ok(forms.some((f) => f.lean[0] < 0) && forms.some((f) => f.lean[0] > 0));
  a.advance(320);
  for (const p of a.plants) {
    const base = stemPoint(p, 0),
      tip = stemPoint(p, p.stalk);
    assert.deepEqual(base, [p.position[0], p.position[1] + 0.24, p.position[2]]);
    assert.ok(Math.abs(tip[0] - base[0]) > 0.2, 'mature stem retains its lean');
    const middle = stemPoint(p, p.stalk * 0.5);
    assert.ok(
      Math.hypot(middle[0] - (tip[0] + base[0]) / 2, middle[2] - (tip[2] + base[2]) / 2) > 0.001,
    );
    p.leaves.forEach((_, i) => assert.deepEqual(leafPoint(p, i, 0, 0), base));
  }
  const held = a.plants.map((p) => stemPoint(p, p.stalk));
  a.advance(60);
  assert.deepEqual(
    a.plants.map((p) => p.form),
    forms,
  );
  assert.deepEqual(
    a.plants.map((p) => stemPoint(p, p.stalk)),
    held,
  );
});

test('iris surfaces stay finite through unfurling and open into standards above drooping falls', () => {
  for (const seed of [1, 719, 104729]) {
    const w = new PlantWorld(seed);
    w.plantBulb(pos());
    w.advance(300);
    const p = w.plants[0];
    for (const opening of [0, 0.1, 0.4, 0.7, 1]) {
      p.opening = opening;
      for (const kind of ['standard', 'fall', 'arm'] as const)
        for (let n = 0; n < 3; n++)
          for (let i = 0; i <= 20; i++)
            for (const v of [-1, -0.5, 0, 0.5, 1]) {
              const point = petalPoint(p, n, i / 20, v, kind);
              assert.ok(point.every(Number.isFinite));
              assert.ok(Math.hypot(...point) < 2.2, 'organ stays inside fitted flower bounds');
            }
    }
    for (let n = 0; n < 3; n++) {
      assert.ok(petalPoint(p, n, 1, 0, 'standard')[1] > 0.8);
      assert.ok(petalPoint(p, n, 1, 0, 'fall')[1] < -0.25);
    }
  }
});
