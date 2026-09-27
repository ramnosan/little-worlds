export type AquariumMode = 'high' | 'efficient';
export const MODE_KEY = 'little-worlds.aquarium.graphics';
export function readMode(storage?: Pick<Storage, 'getItem'>): AquariumMode {
  try {
    return storage?.getItem(MODE_KEY) === 'efficient' ? 'efficient' : 'high';
  } catch {
    return 'high';
  }
}
export function saveMode(mode: AquariumMode, storage?: Pick<Storage, 'setItem'>) {
  try {
    storage?.setItem(MODE_KEY, mode);
  } catch {
    /* Session selection still works. */
  }
}
/** Rendering only: physics and the lighting clock keep their own fixed-step time. */
export class AquariumFrameSchedule {
  private last = -Infinity;
  due(now: number, efficient: boolean, paused: boolean, dirty: boolean) {
    if (paused && !dirty) return false;
    const interval = 1000 / 30;
    if (efficient && !paused && now - this.last < interval - 0.1) return false;
    this.last =
      !Number.isFinite(this.last) || paused || !efficient || now - this.last > interval * 2
        ? now
        : this.last + Math.max(1, Math.floor((now - this.last + 0.1) / interval)) * interval;
    return true;
  }
}
