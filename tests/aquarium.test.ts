import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AquariumWorld, BALL_LIMIT, WATER_Y, WIDTH, DEPTH } from '../src/aquarium/physics';

test('water stays finite, contained and volume-neutral under sustained input', () => {
  const w = new AquariumWorld();
  w.strength = 1;
  w.damping = 0;
  for (let i = 0; i < 900; i++) {
    if (i % 3 === 0) w.ripple((Math.sin(i) * WIDTH) / 2, (Math.cos(i * 0.7) * DEPTH) / 2);
    w.advance(1 / 60);
  }
  assert.ok(w.heights.every(Number.isFinite));
  assert.ok(w.velocities.every(Number.isFinite));
  assert.ok(w.stats().peak < 0.31);
  assert.ok(Math.abs(w.stats().mean) < 1e-7);
  assert.equal(w.impulse(NaN, 0), false);
  assert.equal(w.impulse(100, 0), false);
});
test('fixed steps give the same waves and buoyancy at different frame rates', () => {
  const a = new AquariumWorld(),
    b = new AquariumWorld();
  a.addBall();
  b.addBall();
  for (let i = 0; i < 240; i++) a.advance(1 / 30);
  for (let i = 0; i < 1152; i++) b.advance(1 / 144);
  assert.deepEqual(a.heights, b.heights);
  assert.deepEqual(a.balls, b.balls);
});
test('ripples travel away from their source and settle without the wave maker', () => {
  const w = new AquariumWorld();
  w.waveMaker = false;
  w.heights.fill(0);
  w.velocities.fill(0);
  w.ripple(0, 0);
  let travelled = 0;
  for (let i = 0; i < 180; i++) {
    w.advance(1 / 60);
    travelled = Math.max(travelled, Math.abs(w.sample(1, 0) - WATER_Y));
  }
  assert.ok(travelled > 0.001);
  const active = w.stats().energy;
  for (let i = 0; i < 1200; i++) w.advance(1 / 60);
  assert.ok(w.stats().energy < active * 0.01);
});
test('balls displace the water and settle near their buoyancy equilibrium', () => {
  const w = new AquariumWorld();
  w.waveMaker = false;
  w.heights.fill(0);
  w.velocities.fill(0);
  w.addBall();
  let peak = 0;
  for (let i = 0; i < 900; i++) {
    w.advance(1 / 60);
    peak = Math.max(peak, w.stats().peak);
  }
  assert.ok(peak > 0.002);
  assert.ok(Math.abs(w.balls[0].y - WATER_Y) < 0.08);
  assert.ok(Math.abs(w.balls[0].vy) < 0.03);
  for (let i = 1; i < BALL_LIMIT; i++) assert.equal(w.addBall(), true);
  assert.equal(w.addBall(), false);
});

test('charged ripples grow in height and reach while keeping water stable', () => {
  const results = [0, 0.5, 1].map((charge) => {
    const w = new AquariumWorld();
    w.waveMaker = false;
    w.heights.fill(0);
    w.velocities.fill(0);
    w.ripple(0, 0, charge);
    assert.equal(w.interactions, 1);
    let peak = 0,
      reach = 0;
    for (let i = 0; i < 60; i++) {
      w.advance(1 / 120);
      peak = Math.max(peak, w.stats().peak);
      reach = Math.max(reach, Math.abs(w.sample(0.8, 0) - WATER_Y));
    }
    assert.ok(w.heights.every(Number.isFinite));
    assert.ok(peak < 0.31);
    assert.ok(Math.abs(w.stats().mean) < 1e-7);
    return { peak, reach };
  });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].peak > results[i - 1].peak);
    assert.ok(results[i].reach > results[i - 1].reach);
  }
});
test('pause freezes water, balls and time; reset restores defaults', () => {
  const w = new AquariumWorld();
  w.addBall();
  w.advance(0.1);
  w.paused = true;
  const before = w.stats(),
    heights = w.heights.slice(),
    balls = structuredClone(w.balls);
  w.advance(0.5);
  w.ripple(0, 0);
  assert.equal(w.addBall(), false);
  assert.deepEqual(w.stats(), before);
  assert.deepEqual(w.heights, heights);
  assert.deepEqual(w.balls, balls);
  w.reset();
  const clean = new AquariumWorld();
  assert.deepEqual(w.stats(), clean.stats());
  assert.deepEqual(w.heights, clean.heights);
});
