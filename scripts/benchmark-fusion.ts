import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { BubbleWorld, STEP } from '../src/bubbles/physics';
import { FusionSurface } from '../src/bubbles/fusion';

// CPU-only, seeded workload. Render/GPU time is deliberately excluded.
let meshMs = 0,
  supportMs = 0,
  supportCalls = 0;
const update = FusionSurface.prototype.update,
  support = FusionSurface.prototype.support;
FusionSurface.prototype.update = function (...args) {
  const start = performance.now();
  const result = update.apply(this, args);
  meshMs += performance.now() - start;
  return result;
};
FusionSurface.prototype.support = function (...args) {
  const start = performance.now();
  const result = support.apply(this, args);
  supportMs += performance.now() - start;
  supportCalls++;
  return result;
};
function run(crowded: boolean) {
  const world = new BubbleWorld();
  world.wind = 0;
  for (let pair = 0; pair < (crowded ? 2 : 1); pair++) {
    const x = pair * 3 - 1;
    world.spawn(0.6, [x, 3, 0])!.velocity = [0, 0, 0];
    world.spawn(0.6, [x + 1.19, 3, 0])!.velocity = [0, 0, 0];
  }
  if (crowded)
    for (let i = 0; i < 28; i++)
      world.spawn(0.22, [
        -6 + (i % 7) * 2,
        6 + Math.floor(i / 7) * 0.9,
        (i % 2 ? 1 : -1) * 4,
      ])!.velocity = [0, 0, 0];
  meshMs = supportMs = supportCalls = 0;
  const samples: number[] = [];
  for (let i = 0; i < 600; i++) {
    const merging = world.fusions.some((f) => f.phase === 'relaxing');
    const start = performance.now();
    world.advance(STEP);
    if (merging) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  world.dispose();
  return {
    samples: samples.length,
    meanStepMs: samples.reduce((s, n) => s + n, 0) / samples.length,
    p95StepMs: samples[Math.floor(samples.length * 0.95)],
    meshMs,
    supportMs,
    supportCalls,
  };
}
run(true); // Warm the JIT and Marching Cubes paths before measuring.
const result = { pair: run(false), crowded: run(true) };
const json = JSON.stringify(result, null, 2);
if (process.argv[2]) writeFileSync(process.argv[2], json + '\n');
console.log(json);
