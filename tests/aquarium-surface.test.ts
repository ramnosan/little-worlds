import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetailWaves, detailAmplitude, addDetailWave } from '../src/aquarium/wave-detail';
import { AquariumSurface } from '../src/aquarium/surface-field';
import { AquariumWorld } from '../src/aquarium/physics';

test('curved wave slopes match numerical height derivatives across positions and times', () => {
  const waves = createDetailWaves();
  assert.deepEqual(waves, createDetailWaves());
  const sample = (x: number, z: number, t: number) => {
    const out = { x: 0, y: 0, z: 0 };
    waves.forEach((w, i) => addDetailWave(out, w, i, x, z, t, detailAmplitude(w, t)));
    return out;
  };
  for (const t of [0, 8, 120])
    for (const [x, z] of [
      [0, 0],
      [-2.5, 1.6],
      [1.43, -0.72],
    ]) {
      const v = sample(x, z, t),
        e = 1e-5;
      assert.ok(Math.abs(v.y - (sample(x + e, z, t).x - sample(x - e, z, t).x) / (2 * e)) < 1e-6);
      assert.ok(Math.abs(v.z - (sample(x, z + e, t).x - sample(x, z - e, t).x) / (2 * e)) < 1e-6);
    }
  assert.notDeepEqual(sample(0.3, 0.4, 0), sample(0.3, 0.4, 8));
});

test('bounded CPU detail freezes, fades out, and resets deterministically without changing physics', () => {
  const world = new AquariumWorld(),
    surface = new AquariumSurface();
  world.heights.fill(0);
  const textureData = () => Array.from((surface.texture.image as { data: Float32Array }).data);
  surface.update(world);
  const initial = textureData();
  assert.ok(initial.some((v) => v !== 0));
  world.paused = true;
  surface.update(world);
  assert.deepEqual(textureData(), initial);
  world.waveMaker = false;
  surface.update(world);
  assert.deepEqual(textureData(), initial); // fading also waits for simulation time
  world.time = 20;
  surface.update(world);
  assert.ok(Math.max(...surface.heights.map(Math.abs)) < 1e-8);
  assert.ok(world.heights.every((v) => v === 0));
  world.time = 0;
  world.waveMaker = true;
  surface.update(world);
  assert.deepEqual(textureData(), initial);
  surface.dispose();
});
