import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AquariumWorld } from '../src/aquarium/physics';
import {
  KoiSchool,
  KOI_CLEARANCE,
  KOI_MAX_TURN,
  KOI_MIN_TURN_RADIUS,
  type KoiEnvironment,
} from '../src/aquarium/koi-school';
import { WIDTH, DEPTH, WATER_Y } from '../src/aquarium/tank';
import { parseKoiManifest } from '../src/aquarium/koi-assets';

const environment = (): KoiEnvironment => ({ balls: [], sample: () => WATER_Y, wake: () => {} });
test('koi remain contained, separated and turn smoothly over a long swim', () => {
  const school = new KoiSchool(),
    env = environment();
  env.balls = [{ x: 0, y: 1.25, z: 0, radius: 0.22 }];
  for (let step = 0; step < 120 * 180; step++) {
    const before = school.snapshot();
    school.update(1 / 120, env);
    for (const f of school.fish) {
      assert.ok(Number.isFinite(f.x + f.y + f.z + f.heading + f.animationTime));
      assert.ok(Math.abs(f.x) <= WIDTH / 2 - KOI_CLEARANCE + 1e-7);
      assert.ok(Math.abs(f.z) <= DEPTH / 2 - KOI_CLEARANCE + 1e-7);
      assert.ok(f.y >= KOI_CLEARANCE - 1e-7 && f.y <= WATER_Y - KOI_CLEARANCE + 1e-7);
      const turn = Math.atan2(
        Math.sin(f.heading - before[f.id].heading),
        Math.cos(f.heading - before[f.id].heading),
      );
      assert.ok(Math.abs(turn) <= KOI_MAX_TURN / 120 + 1e-7);
      assert.ok(Math.abs(f.turnRate) <= f.speed / KOI_MIN_TURN_RADIUS + 1e-7);
      assert.ok(Math.abs(f.speed - before[f.id].speed) <= 0.085 / 120 + 1e-7);
      for (const o of env.balls)
        assert.ok(Math.hypot(f.x - o.x, f.y - o.y, f.z - o.z) >= KOI_CLEARANCE + o.radius - 1e-3);
      for (const b of school.fish)
        if (b.id !== f.id)
          assert.ok(Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z) >= KOI_CLEARANCE * 2 - 1e-3);
    }
  }
});
test('fixed aquarium timesteps produce identical fish at 30 and 144 fps', () => {
  const a = new AquariumWorld(),
    b = new AquariumWorld();
  a.koi.enabled = b.koi.enabled = true;
  for (let i = 0; i < 180; i++) a.advance(1 / 30);
  for (let i = 0; i < 864; i++) b.advance(1 / 144);
  assert.deepEqual(a.koi.snapshot(), b.koi.snapshot());
  assert.deepEqual(a.heights, b.heights);
});
test('pause, hidden-asset state and reset do not animate invisible fish', () => {
  const w = new AquariumWorld();
  const initial = w.koi.snapshot();
  w.advance(0.1);
  assert.deepEqual(w.koi.snapshot(), initial);
  w.koi.enabled = true;
  w.advance(0.1);
  w.paused = true;
  const paused = w.koi.snapshot();
  w.advance(0.1);
  w.ripple(0, 0);
  assert.deepEqual(w.koi.snapshot(), paused);
  w.reset();
  assert.deepEqual(w.koi.snapshot(), initial);
  assert.equal(w.koi.enabled, true);
});
test('ripple response is local and bounded; wakes do not count as user input', () => {
  const a = new KoiSchool(),
    b = new KoiSchool(),
    env = environment();
  for (let i = 0; i < 100; i++) a.respondToRipple(a.fish[0].x + 0.2, a.fish[0].z);
  for (let i = 0; i < 240; i++) {
    a.update(1 / 120, env);
    b.update(1 / 120, env);
  }
  assert.notDeepEqual(a.fish[0].heading, b.fish[0].heading);
  assert.ok(a.fish.every((f) => f.speed < 0.39));
  const w = new AquariumWorld();
  w.koi.enabled = true;
  w.koi.fish[0].y = 1.3;
  for (let i = 0; i < 60; i++) w.advance(1 / 60);
  assert.equal(w.interactions, 0);
  w.ripple(0, 0);
  assert.equal(w.interactions, 1);
});
test('koi manifest requires two named local skeletal assets, or an explicit empty set', () => {
  assert.deepEqual(parseKoiManifest({ version: 1, assets: [] }), { version: 1, assets: [] });
  assert.throws(() => parseKoiManifest({ version: 1, assets: [{ variety: 'showa' }] }));
  const assets = ['showa', 'tancho'].map((variety) => ({
    variety,
    high: `./${variety}.glb`,
    low: `./${variety}-low.glb`,
    swimClip: 'Swim',
  }));
  assert.equal(parseKoiManifest({ version: 1, assets }).assets.length, 2);
  assets[0].high = 'https://example.com/fish.glb';
  assert.throws(() => parseKoiManifest({ version: 1, assets }));
});

test('supplied morph assets declare their profile and fish identities survive reset', () => {
  const identities = ['koi-1', 'koi-2'] as const;
  const school = new KoiSchool();
  school.setVarieties([...identities]);
  school.update(1 / 120, environment());
  school.reset();
  assert.deepEqual(
    school.fish.map((f) => f.variety),
    identities,
  );
  const assets = identities.map((variety) => ({
    variety,
    high: './7plus-high.glb',
    low: './7plus-low.glb',
    swimClip: 'Swim',
    deformation: 'morph',
    textureSize: 1024,
  }));
  assert.equal(parseKoiManifest({ version: 1, assets }).assets.length, 2);
  assert.throws(() =>
    parseKoiManifest({ version: 1, assets: assets.map((a) => ({ ...a, deformation: 'unknown' })) }),
  );
});
