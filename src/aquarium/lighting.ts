/** Aquarium clock, independent of Three.js and wall-clock time. */
export const CYCLE_SECONDS = 480;
export const AFTERNOON = 15 / 24;
export const LAMP_POSITION = [0.3, 3.05, -1.15] as const;
export const LAMP_COLOR = [1, 0.72, 0.43] as const;
export const SUN_INTENSITY = 1.4;
export const LAMP_INTENSITY = 10;
const smooth = (a: number, b: number, x: number) => {
  const v = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return v * v * (3 - 2 * v);
};
export interface AquariumLight {
  phase: number;
  daylight: number;
  sunset: number;
  sun: number;
  lamp: number;
  sunDirection: [number, number, number];
  color: [number, number, number];
  ambient: number;
}
export function sampleLighting(phase: number): AquariumLight {
  const angle = (phase - 0.25) * Math.PI * 2;
  const elevation = Math.sin(angle);
  const daylight = smooth(-0.16, 0.38, elevation);
  const sun = smooth(0.01, 0.18, elevation);
  const lamp = 1 - smooth(-0.18, -0.015, elevation);
  const warm = smooth(0, 0.5, elevation);
  const x = Math.cos(angle),
    y = Math.max(0.025, elevation),
    z = 0.4;
  const length = Math.hypot(x, y, z);
  return {
    phase,
    daylight,
    sunset: smooth(-0.2, 0, elevation) * (1 - smooth(0.05, 0.5, elevation)),
    sun,
    lamp,
    sunDirection: [x / length, y / length, z / length],
    color: [1, 0.57 + 0.37 * warm, 0.3 + 0.57 * warm],
    ambient: 0.06 + 0.245 * daylight,
  };
}
export class AquariumLighting {
  phase = AFTERNOON;
  automatic = true;
  revision = 0;
  advance(seconds: number, paused = false, hidden = false) {
    if (paused || hidden || !this.automatic || !Number.isFinite(seconds) || seconds <= 0) return;
    this.phase = (this.phase + seconds / CYCLE_SECONDS) % 1;
  }
  setTime(phase: number) {
    if (!Number.isFinite(phase)) return;
    this.phase = ((phase % 1) + 1) % 1;
    this.automatic = false;
    this.revision++;
  }
  reset() {
    this.phase = AFTERNOON;
    this.automatic = true;
    this.revision++;
  }
  snapshot() {
    return { ...sampleLighting(this.phase), automatic: this.automatic };
  }
}
