import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AquariumLighting,
  AFTERNOON,
  CYCLE_SECONDS,
  sampleLighting,
} from '../src/aquarium/lighting';

test('aquarium clock wraps deterministically and holds manual time', () => {
  const a = new AquariumLighting(),
    b = new AquariumLighting();
  a.advance(CYCLE_SECONDS);
  assert.ok(Math.abs(a.phase - AFTERNOON) < 1e-12);
  for (let i = 0; i < 480; i++) b.advance(1);
  assert.ok(Math.abs(a.phase - b.phase) < 1e-12);
  a.setTime(0.95);
  a.advance(200);
  assert.equal(a.phase, 0.95);
  a.automatic = true;
  a.advance(CYCLE_SECONDS * 0.1);
  assert.ok(Math.abs(a.phase - 0.05) < 1e-12);
});
test('pause and hidden tabs freeze the cycle while manual lighting remains available', () => {
  const clock = new AquariumLighting();
  clock.advance(60, true);
  clock.advance(60, false, true);
  assert.equal(clock.phase, AFTERNOON);
  clock.setTime(0.1);
  assert.ok(Math.abs(clock.phase - 0.1) < 1e-12);
  clock.advance(NaN);
  clock.advance(-1);
  assert.ok(Number.isFinite(clock.phase));
  clock.reset();
  assert.equal(clock.phase, AFTERNOON);
  assert.equal(clock.automatic, true);
});
test('sun and lamp never compete and the daylight curve is continuous', () => {
  let previous = sampleLighting(0);
  for (let i = 0; i <= 10000; i++) {
    const light = sampleLighting(i / 10000);
    assert.equal(light.sun * light.lamp, 0);
    assert.ok(Math.abs(light.daylight - previous.daylight) < 0.005);
    assert.ok(Math.abs(Math.hypot(...light.sunDirection) - 1) < 1e-10);
    previous = light;
  }
  assert.equal(sampleLighting(0.5).sun, 1);
  assert.equal(sampleLighting(0).lamp, 1);
});
