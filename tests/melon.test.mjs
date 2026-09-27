import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/melon-jelly.html', import.meta.url), 'utf8');
const core = html.match(/<script id="melon-core">([\s\S]*?)<\/script>/)[1];
const { MelonBody, buildSkin, bindPoint, point } = new Function(
  core + ';return { MelonBody, buildSkin, bindPoint, point };',
)();
const advance = (body, steps) => {
  for (let i = 0; i < steps; i++) body.step();
};
function grabNear(body, target, id = 1) {
  const center = (face) =>
    face.reduce((p, i) => p.map((v, c) => v + body.p[3 * i + c] / 3), [0, 0, 0]);
  const distance = (face) => Math.hypot(...center(face).map((v, i) => v - target[i]));
  const face = body.faces.reduce((a, b) => (distance(a) < distance(b) ? a : b));
  body.grab(id, face, [1 / 3, 1 / 3, 1 / 3], center(face));
}
function healthy(body) {
  const stats = body.stats();
  assert.ok(stats.minRatio > 0.03, `inverted or collapsed cell: ${stats.minRatio}`);
  assert.ok(stats.volume > 0.92 && stats.volume < 1.08, `volume: ${stats.volume}`);
  assert.ok(stats.minY >= 0.065 - 1e-9, `floor penetration: ${stats.minY}`);
  assert.ok(Number.isFinite(stats.energy) && stats.energy < 1000);
  return stats;
}

test('Melon is a closed volumetric mesh with normalized subdivision bindings', () => {
  const body = new MelonBody(),
    skin = buildSkin(body);
  assert.equal(body.tets.length, 1200);
  assert.equal(body.weights.length, 330);
  assert.ok(body.volumes.every((v) => v > 0));
  const edges = new Map();
  for (const face of body.faces)
    for (let i = 0; i < 3; i++) {
      const key = [face[i], face[(i + 1) % 3]].sort((a, b) => a - b).join(',');
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  assert.ok(
    [...edges.values()].every((count) => count === 2),
    'nonmanifold boundary',
  );
  for (const binding of skin.weights)
    assert.ok(Math.abs(binding.reduce((sum, [, w]) => sum + w, 0) - 1) < 1e-12);
  assert.ok(body.stats().mass > 400 && body.stats().mass < 420);
});

test('tip, corner and rind survive repeated extreme pulls, releases and floor impacts', () => {
  for (const firmness of [0, 0.45, 1]) {
    const body = new MelonBody();
    body.firmness = firmness;
    advance(body, 240);
    for (const [i, location] of [
      [0, [0, 2.5, 0.5]],
      [1, [-1.4, 0.85, 0.5]],
      [2, [0, 0.22, 0.5]],
    ]) {
      grabNear(body, location);
      body.moveGrab(1, [i % 2 ? -3.6 : 3.6, 4.7, i % 2 ? -2 : 2]);
      for (let j = 0; j < 150; j++) {
        body.step();
        if (j % 15 === 0) healthy(body);
      }
      assert.ok(body.stats().strain > 0.06, 'grab only moved the body rigidly');
      body.release(1);
      advance(body, 360);
      healthy(body);
    }
    advance(body, 900);
    const rest = healthy(body);
    assert.ok(rest.energy < 0.005, `did not settle: ${rest.energy}`);
    assert.ok(rest.strain < 0.12, `permanently collapsed: ${rest.strain}`);
    assert.ok(
      rest.rejectedSteps < rest.steps * 0.005,
      'inversion safeguard must not stall recovery',
    );
  }
});

test('opposing touch grabs remain admissible and release without stored forces', () => {
  const body = new MelonBody();
  body.firmness = 0;
  body.damping = 0;
  advance(body, 180);
  grabNear(body, [-0.9, 1.2, 0.5], 1);
  grabNear(body, [0.9, 1.2, -0.5], 2);
  body.moveGrab(1, [-9, 9, 9]);
  body.moveGrab(2, [9, -9, -9]);
  for (let i = 0; i < 300; i++) {
    body.step();
    if (i % 15 === 0) healthy(body);
  }
  body.release(1);
  body.release(2);
  advance(body, 1200);
  assert.ok(healthy(body).energy < 0.03);
  body.reset();
  assert.equal(body.grabs.size, 0);
  assert.deepEqual(body.p, body.rest);
  assert.ok(body.v.every((v) => v === 0));
});

test('firmness changes compliance and damping controls the decay of internal motion', () => {
  const strains = [];
  for (const firmness of [0, 1]) {
    const body = new MelonBody();
    body.firmness = firmness;
    advance(body, 180);
    // Compare the sustained load after the initial lift, not two different phases
    // of the soft and firm bodies' oscillations.
    grabNear(body, [0, 2.5, 0.5]);
    body.moveGrab(1, [1.4, 4.7, 0.9]);
    advance(body, 600);
    strains.push(healthy(body).strain);
  }
  assert.ok(strains[0] > strains[1] * 1.5, `firmness ineffective: ${strains}`);
  const energy = [];
  for (const damping of [0, 1]) {
    const body = new MelonBody();
    body.damping = damping;
    advance(body, 300);
    body.nudge();
    advance(body, 180);
    energy.push(healthy(body).energy);
  }
  assert.ok(energy[1] < energy[0], `damping ineffective: ${energy}`);
});

test('embedded points reproduce translation, rotation and local affine deformation', () => {
  const body = new MelonBody(),
    seed = [0.4, 1.35, 0.56],
    binding = bindPoint(body, seed);
  const deform = (p) => [
    p[0] * 0.8 - p[2] * 0.6 + 0.3,
    p[1] * 1.15 + 0.2,
    p[0] * 0.6 + p[2] * 0.8 - 0.1,
  ];
  for (let i = 0; i < body.weights.length; i++) body.p.set(deform(point(body.rest, i)), i * 3);
  const actual = binding.reduce(
    (out, [i, weight]) => out.map((v, c) => v + body.p[i * 3 + c] * weight),
    [0, 0, 0],
  );
  const expected = deform(seed);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(actual[c] - expected[c]) < 1e-10);
});
