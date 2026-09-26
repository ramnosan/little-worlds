import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld, STEP, type V3 } from '../src/bubbles/physics';
import { loadBubbleFixture } from '../src/bubbles/fixtures';
import {
  FusionSurface,
  FILM_OPEN_TIME,
  NECK_TIME,
  SETTLE_TIME,
  FUSION_TIME,
  settlingMotion,
  visualPhase,
} from '../src/bubbles/fusion';

const until = (w: BubbleWorld, condition: () => boolean) => {
  for (let i = 0; i < 1200 && !condition(); i++) w.advance(STEP);
  assert.equal(condition(), true, 'phase reached within ten simulation seconds');
};
const lobes = [
  { id: 1, radius: 0.6, offset: [-0.57, 0, 0] as V3 },
  { id: 2, radius: 0.6, offset: [0.57, 0, 0] as V3 },
];
const radius = Math.cbrt(0.432);

test('fixed sampling domain and field queries track the volume-normalized mesh in every phase', () => {
  for (const resolution of [24, 32]) {
    const surface = new FusionSurface(resolution);
    let extent = 0;
    for (const progress of [0.15, 0.3, 0.45, 0.6, 0.9, 1.15, 1.25, 1.35]) {
      surface.update(lobes, radius, progress);
      extent ||= surface.gridExtent;
      assert.equal(surface.gridExtent, extent);
      assert.ok(Math.abs(surface.volume - ((4 * Math.PI) / 3) * 0.432) < 1e-10);
      const positions = surface.cubes.positionArray;
      let maxError = 0;
      for (let i = 0; i < surface.cubes.count * 3; i += 57) {
        const point: V3 = [positions[i], positions[i + 1], positions[i + 2]];
        const sample = surface.sample(point);
        maxError = Math.max(maxError, Math.abs(sample.distance));
        assert.ok(Math.abs(Math.hypot(...sample.normal) - 1) < 1e-8);
      }
      assert.ok(
        maxError < 0.045,
        `grid ${resolution}, phase ${progress}: field/mesh error ${maxError}`,
      );
    }
    surface.update(lobes, radius, 0.15);
    const notch = surface.sample([0, 0.6, 0]);
    assert.ok(
      notch.distance > 0,
      'empty neck-side space is outside despite being inside the bound',
    );
    assert.ok(Math.hypot(0, 0.6, 0) < surface.bound);
    surface.dispose();
  }
});

test('neck and pull curves have no boundary velocity jumps, settling carries displacement and velocity', () => {
  const surface = new FusionSurface(32),
    epsilon = 1e-4;
  const point: V3 = [1.9, 0.1, 0.1];
  for (const boundary of [FILM_OPEN_TIME, NECK_TIME, SETTLE_TIME]) {
    surface.update(lobes, radius, boundary - epsilon);
    const before = surface.sample(point).distance;
    surface.update(lobes, radius, boundary);
    const at = surface.sample(point).distance;
    surface.update(lobes, radius, boundary + epsilon);
    const after = surface.sample(point).distance;
    assert.ok(Math.abs((at - before) / epsilon) < 0.02);
    assert.ok(Math.abs((after - at) / epsilon) < 0.02);
  }
  assert.deepEqual(settlingMotion(SETTLE_TIME), { value: 0, velocity: 0 });
  for (const t of [1.18, 1.24, 1.35]) {
    const numeric =
      (settlingMotion(t + epsilon).value - settlingMotion(t - epsilon).value) / (2 * epsilon);
    assert.ok(Math.abs(numeric - settlingMotion(t).velocity) < 1e-5);
  }
  assert.equal(visualPhase(0.15), 'neck');
  assert.equal(visualPhase(0.45), 'pulling');
  assert.equal(visualPhase(1.15), 'settling');
  surface.dispose();
});

test('unequal lobes keep world positions at ownership transfer and conserve mass, air and momentum', () => {
  const w = new BubbleWorld();
  w.wind = 0;
  const a = w.spawn(0.4, [-0.395, 3, 0])!,
    b = w.spawn(0.9, [0.895, 3, 0])!;
  a.velocity = [0.01, 0, 0];
  b.velocity = [-0.01, 0, 0];
  until(w, () => w.fusions.length > 0);
  until(w, () => w.fusions[0].progress + 1e-10 >= FILM_OPEN_TIME - STEP);
  const sources = [a, b].map((b) => ({
    id: b.id,
    radius: b.radius,
    mass: b.mass,
    age: b.age,
    position: [...b.position] as V3,
    velocity: [...b.velocity] as V3,
  }));
  const predicted = sources.map((b) => {
    const v = b.velocity.map(
      (v, k) =>
        v +
        ((-v * 1.6) / Math.sqrt(b.radius) +
          (k === 1 ? 0.37 * Math.exp(-(b.age + STEP) / 9) - 0.1 / b.radius : 0)) *
          STEP,
    ) as V3;
    return { position: b.position.map((p, k) => p + v[k] * STEP) as V3, velocity: v };
  });
  w.advance(STEP);
  const fusion = w.fusions[0],
    merged = w.bubbles[0];
  assert.equal(w.bubbles.length, 1);
  assert.equal(fusion.visualPhase, 'neck');
  assert.equal(merged.mass, sources[0].mass + sources[1].mass);
  assert.ok(Math.abs(merged.radius ** 3 - (0.4 ** 3 + 0.9 ** 3)) < 1e-10);
  for (let i = 0; i < 2; i++)
    for (let k = 0; k < 3; k++)
      assert.ok(
        Math.abs(merged.position[k] + fusion.sourceLobes[i].offset[k] - predicted[i].position[k]) <
          1e-10,
      );
  for (let k = 0; k < 3; k++)
    assert.ok(
      Math.abs(
        merged.velocity[k] * merged.mass -
          sources.reduce((s, b, i) => s + b.mass * predicted[i].velocity[k], 0),
      ) < 1e-10,
    );
  until(w, () => w.fusions.length === 0);
  const endpoint = settlingMotion(FUSION_TIME);
  assert.ok(Math.abs(merged.deformation - endpoint.value) < 1e-10);
  assert.ok(Math.abs(merged.deformationVelocity - endpoint.velocity) < 1e-10);
  const q = merged.deformation;
  w.advance(STEP);
  assert.ok(
    Math.abs(merged.deformation - q) < 0.004,
    'the existing oscillator continues without a new kick',
  );
  assert.equal(w.created, 2);
  w.dispose();
});

test('transferred films retain their world anchors and blend for 0.2 seconds', () => {
  const w = new BubbleWorld();
  loadBubbleFixture(w, 'cluster', false);
  w.paused = false;
  let oldFilms = w.sharedFilms;
  until(w, () => {
    if (w.fusions.some((f) => f.phase === 'relaxing')) return true;
    oldFilms = w.sharedFilms;
    return false;
  });
  const transfers = w.bonds.filter((p) => p.transfer);
  assert.ok(transfers.length > 0);
  for (const pair of transfers) {
    const a = w.bubbles.find((b) => b.id === pair.a)!,
      b = w.bubbles.find((b) => b.id === pair.b)!;
    const t = pair.transfer!;
    const ca = t.centerA.map((v, k) => v + a.position[k]) as V3,
      cb = t.centerB.map((v, k) => v + b.position[k]) as V3;
    assert.ok(Math.hypot(...ca.map((v, k) => v - cb[k])) < 0.003);
    assert.ok(
      Math.min(...oldFilms.map((f) => Math.hypot(...f.center.map((v, k) => v - ca[k])))) < 0.003,
    );
    // Snapshot edits must not mutate the simulation's transfer anchors.
    t.centerA[0] = 999;
    assert.notEqual(
      w.bonds.find((p) => p.a === pair.a && p.b === pair.b)!.transfer!.centerA[0],
      999,
    );
  }
  for (let i = 0; i < 12; i++) w.advance(STEP);
  assert.ok(w.bonds.some((p) => p.transfer));
  for (let i = 0; i < 14; i++) w.advance(STEP);
  assert.equal(
    w.bonds.some((p) => p.transfer),
    false,
  );
  w.dispose();
});

test('cluster and consecutive merges stay within a cumulative 2 percent correction budget', () => {
  const w = new BubbleWorld();
  loadBubbleFixture(w, 'cluster', false);
  w.paused = false;
  let merges = 0,
    worst = 0;
  for (let i = 0; i < 900; i++) {
    const before = new Map(
      w.bubbles.map((b) => [b.id, { p: [...b.position], v: [...b.velocity] }]),
    );
    const previous = w.fusions.filter((f) => f.phase === 'relaxing').map((f) => f.survivor);
    w.advance(STEP);
    const starts = w.fusions.filter(
      (f) => f.phase === 'relaxing' && !previous.includes(f.survivor),
    );
    merges += starts.length;
    assert.ok(w.fusionMotion.maxStepCorrectionRatio <= 0.0200000001);
    for (const b of w.bubbles) {
      const old = before.get(b.id);
      if (!old || starts.some((f) => f.survivor === b.id)) continue;
      worst = Math.max(
        worst,
        Math.hypot(...b.position.map((v, k) => v - old.p[k] - old.v[k] * STEP)),
      );
    }
  }
  assert.ok(merges >= 2);
  assert.ok(worst < 0.017, `largest correction: ${worst} m`);
  w.reset();
  assert.equal(w.fusionMotion.maxCorrection, 0);
  w.dispose();
});

test('pause, reset and local darts work in neck, pulling and settling phases', () => {
  for (const target of [0.3, 0.75, 1.25]) {
    const w = new BubbleWorld();
    w.wind = 0;
    w.spawn(0.6, [-0.595, 3, 0])!.velocity = [0, 0, 0];
    w.spawn(0.6, [0.595, 3, 0])!.velocity = [0, 0, 0];
    until(w, () => w.fusions.some((f) => f.progress >= target));
    w.paused = true;
    const before = JSON.stringify([w.bubbles, w.fusions, w.fusionMotion]);
    w.advance(10);
    assert.equal(JSON.stringify([w.bubbles, w.fusions, w.fusionMotion]), before);
    w.paused = false;
    const b = w.bubbles[0];
    w.throwDart([b.position[0] - 0.3, b.position[1], b.position[2] + 0.8], [0, 0, -1]);
    for (let i = 0; i < 10; i++) w.advance(STEP);
    assert.equal(w.darts.hits, 1);
    assert.equal(w.bubbles.length, 0);
    assert.equal(w.fusions.length, 0);
    w.reset();
    assert.equal(w.fusionResources.queued.length, 0);
    w.dispose();
  }
});

test('an attachment clips only its local fusion cap, leaving the distant lobe puncturable', () => {
  const w = new BubbleWorld();
  loadBubbleFixture(w, 'cluster', false, 0.5);
  const b = w.bubbles.find((b) => w.surfaceFor(b.id))!;
  const surface = w.surfaceFor(b.id)!;
  const positions = surface.cubes.positionArray;
  let checked = 0;
  for (let i = 0; i < surface.cubes.count * 3; i += 9) {
    const point = [0, 1, 2].map(
      (k) => (positions[i + k] + positions[i + 3 + k] + positions[i + 6 + k]) / 3,
    ) as V3;
    const beyond = b.contacts.filter(
      (c) => c.normal.reduce((s, n, k) => s + n * point[k], 0) > c.offset + 0.01,
    );
    if (
      !beyond.length ||
      !beyond.every(
        (c) =>
          c.region &&
          Math.hypot(...point.map((v, k) => v - c.region!.center[k])) > c.region!.radius + 0.02,
      )
    )
      continue;
    const u = point.map((_, k) => positions[i + 3 + k] - positions[i + k]),
      v = point.map((_, k) => positions[i + 6 + k] - positions[i + k]);
    const normal: V3 = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal);
    if (length < 1e-8) continue;
    const start = point.map((p, k) => p + (normal[k] / length) * 0.01) as V3;
    const travel = normal.map((n) => (-n / length) * 0.02) as V3;
    assert.notEqual(surface.intersect(start, travel, b.contacts), undefined);
    checked++;
  }
  assert.ok(checked > 10, 'covers a visible patch formerly removed by the infinite plane');
  w.dispose();
});
