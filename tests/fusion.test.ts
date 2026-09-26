import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld, STEP, type V3 } from '../src/bubbles/physics';
import { FILM_OPEN_TIME, FusionSurface, mergeChoice } from '../src/bubbles/fusion';

function pair(skip = 0) {
  const w = new BubbleWorld();
  w.wind = 0;
  for (let i = 0; i < skip; i++) w.pop(w.spawn(0.2, [0, 3, 0], false)!.id);
  const a = w.spawn(0.6, [-0.595, 3, 0])!,
    b = w.spawn(0.6, [0.595, 3, 0])!;
  a.velocity = [0, 0, 0];
  b.velocity = [0, 0, 0];
  return { w, a, b };
}
function until(w: BubbleWorld, condition: () => boolean, steps = 1000) {
  for (let i = 0; i < steps && !condition(); i++) w.advance(STEP);
  assert.ok(condition(), 'expected simulation phase was reached');
}
function tick(w: BubbleWorld, seconds: number) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) w.advance(STEP);
}

test('drag ownership follows the partner into a merged bubble', () => {
  const { w } = pair();
  until(w, () => w.fusions.length > 0);
  const fusion = w.fusions[0];
  const partner = w.bubbles.find((b) => b.id === fusion.partner)!;
  assert.ok(w.beginDrag(partner.id, [...partner.position]));
  until(w, () => w.bubbles.length === 1);
  assert.equal(w.dragState?.id, fusion.survivor);
  w.dispose();
});

test('contact threshold, seeded 55% choice and 2–4 second delays are reproducible', () => {
  let eligible = 0;
  for (let i = 1; i <= 10000; i++) {
    const choice = mergeChoice(i, i + 1);
    assert.deepEqual(choice, mergeChoice(i + 1, i));
    assert.ok(choice.delay >= 2 && choice.delay <= 4);
    if (choice.eligible) eligible++;
  }
  assert.ok(eligible > 5300 && eligible < 5700);
  const { w } = pair();
  tick(w, 0.116);
  assert.equal(w.bonds.length, 0);
  w.advance(STEP);
  assert.equal(w.bonds.length, 1);
  const bond = w.bonds[0];
  assert.deepEqual({ eligible: bond.eligible, delay: bond.delay }, mergeChoice(1, 2));
  until(w, () => w.fusions.length > 0);
  assert.ok(w.time - bond.bondedAt >= bond.delay);
  assert.ok(w.time - bond.bondedAt < bond.delay + STEP);
  assert.equal(w.bubbles.length, 2);
  w.dispose();
});

test('nonmerging films persist in drifting clusters; extension and outward velocity break them', () => {
  const { w, a, b } = pair(1);
  w.wind = 0.45;
  tick(w, 8);
  assert.equal(w.bonds.length, 1);
  assert.equal(w.bonds[0].eligible, false);
  assert.equal(w.fusions.length, 0);
  assert.equal(w.sharedFilms.length, 1);
  b.position = [
    a.position[0] + a.radius + b.radius + 0.19 * Math.min(a.radius, b.radius),
    a.position[1],
    a.position[2],
  ];
  w.advance(STEP);
  assert.equal(w.bonds.length, 0);
  const other = pair(1);
  tick(other.w, 0.5);
  other.a.velocity = [-0.4, 0, 0];
  other.b.velocity = [0.4, 0, 0];
  other.w.advance(STEP);
  assert.equal(other.w.bonds.length, 0);
  w.dispose();
  other.w.dispose();
});

test('a stretched surviving bond keeps a finite shared film instead of showing an air gap', () => {
  const { w, a, b } = pair(1);
  tick(w, 0.5);
  b.position = [a.position[0] + 1.25, a.position[1], a.position[2]];
  a.velocity = [-0.1, 0, 0];
  b.velocity = [0.1, 0, 0];
  for (let i = 0; i < 120; i++) {
    w.advance(STEP);
    assert.equal(w.bonds.length, 1);
    assert.equal(w.sharedFilms.length, 1);
    assert.ok(w.sharedFilms[0].radius > 0);
  }
  w.dispose();
});

test('fusion conserves mass, momentum, air and creation count at film opening', () => {
  const { w, a, b } = pair();
  until(w, () => w.fusions.length > 0);
  tick(w, FILM_OPEN_TIME - STEP);
  assert.equal(w.bubbles.length, 2);
  const free = new BubbleWorld();
  free.wind = 0;
  const clones = [a, b].map((source) =>
    Object.assign(free.spawn(source.radius, [...source.position])!, {
      ...source,
      position: [...source.position],
      velocity: [...source.velocity],
      contacts: [],
    }),
  );
  // Compare to the same one-step external forces; contact impulses cancel in total momentum.
  clones[0].position[0] = -4;
  clones[1].position[0] = 4;
  free.advance(STEP);
  w.advance(STEP);
  assert.equal(w.bubbles.length, 1);
  const merged = w.bubbles[0],
    total = clones.reduce((s, b) => s + b.mass, 0);
  assert.equal(merged.mass, total);
  for (let k = 0; k < 3; k++)
    assert.ok(
      Math.abs(
        merged.velocity[k] * total - clones.reduce((s, b) => s + b.mass * b.velocity[k], 0),
      ) < 1e-10,
    );
  assert.ok(Math.abs(merged.radius ** 3 - 0.432) < 1e-12);
  const f = w.fusions[0];
  assert.equal(f.phase, 'relaxing');
  assert.equal(f.survivor, a.id);
  assert.ok(Math.abs(f.volume - ((4 * Math.PI) / 3) * 0.432) < 1e-12);
  assert.equal(w.created, 2);
  for (let step = 0; step < 200 && w.fusions.length; step++) {
    const surface = w.surfaceFor(a.id)!;
    assert.ok(Math.abs(surface.volume - f.volume) < 1e-10);
    w.advance(STEP);
  }
  assert.equal(w.fusions.length, 0);
  assert.ok(Math.abs(merged.deformationVelocity) > 0);
  w.dispose();
  free.dispose();
});

test('attachments transfer, duplicate films collapse and popping only disturbs surviving neighbors', () => {
  const { w, a, b } = pair();
  const c = w.spawn(0.6, [0, 4.02, 0])!;
  c.velocity = [0, 0, 0];
  until(w, () => w.bonds.length === 3);
  assert.equal(w.sharedFilms.length, 3);
  until(w, () => w.fusions.some((f) => f.phase === 'relaxing'));
  assert.equal(w.bubbles.length, 2);
  assert.equal(w.bonds.length, 1);
  assert.equal(new Set(w.bonds.map((p) => `${p.a}:${p.b}`)).size, 1);
  const survivor = w.fusions[0].survivor;
  const neighbor = w.bubbles.find((b) => b.id !== survivor)!;
  w.pop(survivor);
  assert.equal(w.bubbles.length, 1);
  assert.equal(w.bubbles[0], neighbor);
  assert.equal(w.bonds.length, 0);
  assert.equal(w.fusions.length, 0);
  assert.ok(Math.abs(neighbor.deformationVelocity) <= 0.25);
  assert.equal(w.created, 3);
  assert.ok(a.id !== b.id);
  w.dispose();
});

test('a dart can puncture either separate lobe before opening and the whole connected surface afterward', () => {
  for (const phase of ['opening', 'relaxing'] as const)
    for (const lobe of [0, 1]) {
      const { w } = pair();
      until(w, () => w.fusions.some((f) => f.phase === phase));
      const f = w.fusions[0];
      const bubble = w.bubbles.find(
        (b) => b.id === (phase === 'opening' ? f.sourceLobes[lobe].id : f.survivor),
      )!;
      const point =
        phase === 'opening'
          ? bubble.position
          : (bubble.position.map((v, k) => v + f.sourceLobes[lobe].offset[k]) as V3);
      w.throwDart([point[0], point[1], point[2] + 0.62], [0, 0, -1]);
      tick(w, 0.075);
      assert.equal(w.darts.hits, 1);
      assert.equal(w.bubbles.length, phase === 'opening' ? 1 : 0);
      assert.equal(w.fusions.length, 0);
      assert.equal(w.bonds.length, 0);
      w.dispose();
    }
});

test('triangulated union has conserved volume and narrow-phase misses empty bounding-sphere regions', () => {
  for (const resolution of [24, 32]) {
    const surface = new FusionSurface(resolution);
    surface.update(
      [
        { id: 1, radius: 0.6, offset: [-0.57, 0, 0] },
        { id: 2, radius: 0.6, offset: [0.57, 0, 0] },
      ],
      Math.cbrt(0.432),
      0.15,
    );
    const coords = surface.cubes.positionArray;
    let volume = 0;
    for (let i = 0; i < surface.cubes.count * 3; i += 9)
      volume +=
        (coords[i] * (coords[i + 4] * coords[i + 8] - coords[i + 5] * coords[i + 7]) +
          coords[i + 1] * (coords[i + 5] * coords[i + 6] - coords[i + 3] * coords[i + 8]) +
          coords[i + 2] * (coords[i + 3] * coords[i + 7] - coords[i + 4] * coords[i + 6])) /
        6;
    assert.ok(Math.abs(Math.abs(volume) - (4 * Math.PI) / 3) < 1e-6);
    assert.ok(surface.intersect([-0.75, 0, 3], [0, 0, -6]) !== undefined);
    assert.ok(surface.intersect([0.75, 0, 3], [0, 0, -6]) !== undefined);
    assert.equal(surface.intersect([0, 0.9, 3], [0, 0, -6]), undefined);
    assert.ok(surface.bound > 1.4);
    surface.dispose();
  }
});

test('pause and reset freeze and clear opening, relaxation and queued merges; snapshots cannot mutate the world', () => {
  for (const phase of ['opening', 'relaxing'] as const) {
    const { w } = pair();
    until(w, () => w.fusions.some((f) => f.phase === phase));
    const state = JSON.stringify([w.bubbles, w.fusions, w.bonds]);
    w.paused = true;
    w.advance(20);
    assert.equal(JSON.stringify([w.bubbles, w.fusions, w.bonds]), state);
    const snapshot = w.fusions;
    snapshot[0].sourceLobes[0].offset[0] = 999;
    assert.notEqual(w.fusions[0].sourceLobes[0].offset[0], 999);
    w.reset();
    assert.equal(w.fusions.length, 0);
    assert.equal(w.bonds.length, 0);
    assert.equal(w.sharedFilms.length, 0);
    assert.equal(w.fusionResources.queued.length, 0);
    w.dispose();
  }
});

test('fusion trajectories match at 30 and 144 Hz', () => {
  const run = (fps: number) => {
    const { w } = pair();
    for (let i = 0; i < fps * 4; i++) w.advance(1 / fps);
    return w;
  };
  const a = run(30),
    b = run(144);
  assert.deepEqual(a.bubbles, b.bubbles);
  assert.deepEqual(a.fusions, b.fusions);
  a.dispose();
  b.dispose();
});

test('fusion geometry is sampled at 60 Hz and picking uses that same conserved mesh', () => {
  const surface = new FusionSurface(32);
  const radius = Math.cbrt(0.432);
  const lobes = [
    { id: 1, radius: 0.6, offset: [-0.57, 0, 0] as V3 },
    { id: 2, radius: 0.6, offset: [0.57, 0, 0] as V3 },
  ];
  let builds = 0;
  for (let i = 0; i < 102; i++) {
    const previous = surface.revision;
    surface.updateAtTime(lobes, radius, FILM_OPEN_TIME + i * STEP);
    builds += surface.revision - previous;
    assert.ok(Math.abs(surface.volume - ((4 * Math.PI) / 3) * 0.432) < 1e-10);
    if (i === 1) {
      assert.equal(
        surface.revision,
        previous,
        'reuse the visible mesh on the intervening physics tick',
      );
      assert.ok(surface.intersect([-0.75, 0, 3], [0, 0, -6]) !== undefined);
      assert.equal(surface.intersect([0, 0.9, 3], [0, 0, -6]), undefined);
    }
  }
  assert.equal(builds, 51);
  const old = surface.revision;
  surface.updateAtTime(
    lobes.map((l) => ({ ...l })),
    radius,
    FILM_OPEN_TIME,
  );
  assert.equal(surface.revision, old + 1, 'a recycled pool slot must rebuild for the next pair');
  surface.dispose();
});

test('cached contact extents stay exact and invalidate when the mesh changes', () => {
  const surface = new FusionSurface(24);
  const lobes = [
    { id: 1, radius: 0.6, offset: [-0.57, 0, 0] as V3 },
    { id: 2, radius: 0.6, offset: [0.57, 0, 0] as V3 },
  ];
  const direction: V3 = [0.6, 0.8, 0];
  for (const progress of [0.15, 0.45, 0.9]) {
    surface.update(lobes, Math.cbrt(0.432), progress);
    let exact = 0;
    const points = surface.cubes.positionArray;
    for (let i = 0; i < surface.cubes.count * 3; i += 3)
      exact = Math.max(exact, points[i] * direction[0] + points[i + 1] * direction[1]);
    assert.equal(surface.support(direction), exact);
    assert.equal(surface.support(direction), exact);
    for (const name of ['position', 'normal']) {
      const attribute = surface.geometry.getAttribute(name) as import('three').BufferAttribute;
      assert.deepEqual(attribute.updateRanges, [{ start: 0, count: surface.cubes.count * 3 }]);
    }
  }
  surface.dispose();
});

test('distant neighbors never trigger fusion vertex scans in the contact solver', () => {
  const { w, a } = pair();
  for (let i = 0; i < 12; i++)
    w.spawn(0.2, [-5 + (i % 6) * 2, 7, 3 + Math.floor(i / 6) * 2])!.velocity = [0, 0, 0];
  until(w, () => w.fusions.some((f) => f.phase === 'relaxing'));
  const surface = w.surfaceFor(a.id)!;
  let calls = 0;
  const support = surface.support.bind(surface);
  surface.support = (direction) => {
    calls++;
    return support(direction);
  };
  tick(w, 0.1);
  assert.equal(calls, 0);
  w.dispose();
});

test('a quality change drains active work before replacing the pool, without losing bubbles', () => {
  const { w } = pair();
  until(w, () => w.fusions.some((f) => f.phase === 'relaxing'));
  const f = w.fusions[0];
  const geometry = w.surfaceFor(f.survivor)!.geometry;
  w.setQuality(true);
  assert.equal(w.surfaceFor(f.survivor)!.geometry, geometry);
  until(w, () => w.fusions.length === 0);
  assert.equal(w.fusionResources.limit, 1);
  assert.equal(w.fusionResources.resolution, 24);
  assert.equal(w.bubbles.length, 1);
  w.dispose();
});

test('overlapping candidate schedules queue deterministically within the normal/light resource bounds', () => {
  for (const reduced of [false, true]) {
    const w = new BubbleWorld();
    w.wind = 0;
    w.setQuality(reduced);
    // Four isolated seeded pairs with overlapping drainage schedules.
    for (let i = 0; i < 4; i++) {
      const x = i * 2.7 - 4;
      const a = w.spawn(0.6, [x, 3, 0])!,
        b = w.spawn(0.6, [x + 1.19, 3, 0])!;
      a.velocity = [0, 0, 0];
      b.velocity = [0, 0, 0];
    }
    let active = 0,
      queued = false;
    for (let i = 0; i < 840; i++) {
      w.advance(STEP);
      active = Math.max(active, w.fusions.length);
      queued ||= w.fusionResources.queued.length > 0;
      if (w.fusionResources.queued.length && i % 10 === 0) {
        const before = JSON.stringify([w.bubbles, w.bonds, w.fusions, w.fusionResources]);
        w.paused = true;
        w.advance(0.1);
        assert.equal(JSON.stringify([w.bubbles, w.bonds, w.fusions, w.fusionResources]), before);
        w.paused = false;
      }
      assert.ok(w.fusionResources.active + w.fusionResources.pooled <= (reduced ? 1 : 2));
      for (const f of w.fusions)
        if (f.phase === 'relaxing')
          assert.equal(w.surfaceFor(f.survivor)!.resolution, reduced ? 24 : 32);
    }
    assert.ok(active > 0);
    if (reduced) assert.ok(queued);
    w.reset();
    assert.equal(w.fusionResources.queued.length, 0);
    w.dispose();
  }
});
