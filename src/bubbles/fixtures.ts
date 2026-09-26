import { STEP, type BubbleWorld, type V3 } from './physics';

/** Named, deterministic development scenes. Imported only by the DEV branch;
 * diagnostics remain snapshots, with no runtime mutation API on window. */
export function loadBubbleFixture(
  world: BubbleWorld,
  name: string | null,
  mobile: boolean,
  progress?: number,
) {
  if (!name || !['pair', 'cluster', 'opening', 'fusion', 'settled', 'impact'].includes(name))
    return false;
  world.reset();
  world.wind = 0;
  const r = mobile ? 0.55 : 0.8;
  const center: V3 = mobile ? [0.7, -0.1, 0] : [2, 1.8, 0];
  const axis: V3 = [0.94, 0, Math.sqrt(1 - 0.94 ** 2)];
  const spawn = (offset: V3) => {
    const b = world.spawn(r, center.map((v, k) => v + offset[k] * r) as V3, false)!;
    b.velocity = [0, 0, 0];
    return b;
  };
  const a = spawn(axis.map((v) => -v * 0.95) as V3);
  spawn(axis.map((v) => v * 0.95) as V3);
  if (name === 'cluster' || name === 'impact') {
    spawn([0, 1.65, 0]);
    spawn([0, 0.6, -1.55]);
  }
  let elapsed = 0;
  const step = () => {
    world.advance(STEP);
    elapsed += STEP;
  };
  while (elapsed < 1.2) step();
  if (progress !== undefined && Number.isFinite(progress)) {
    while (elapsed < 8 && !world.fusions.length) step();
    const start = world.time - (world.fusions[0]?.progress ?? 0);
    const target = start + Math.max(0, Math.min(1.55, progress));
    while (world.time + 1e-8 < target) step();
  } else if (name === 'opening' || name === 'fusion' || name === 'settled') {
    const threshold = name === 'opening' ? 0.05 : name === 'fusion' ? 0.36 : 0.95;
    while (elapsed < 8 && !(world.fusions[0]?.progress >= threshold)) step();
    if (name === 'settled') while (world.fusions.length) step();
  }
  if (name === 'impact') {
    world.throwDart([a.position[0], a.position[1], a.position[2] + r + 0.08], [0, 0, -1]);
    const end = elapsed + 0.18;
    while (elapsed < end) step();
  }
  world.paused = true;
  return true;
}
