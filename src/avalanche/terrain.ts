export const TERRAIN = { minX: -460, maxX: 460, minZ: -530, maxZ: 660, step: 5 };
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function randomSource(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export const channelCenter = (z: number) => 22 * Math.sin((z + 310) * 0.007);
const softplus = (v: number) => Math.log1p(Math.exp(clamp(v, -40, 40)));

/** Invented alpine basin in metres. The release face is approximately 35 degrees. */
export function terrainHeight(x: number, z: number) {
  const profile = 24 + 0.73 * (36 * softplus((190 - z) / 36) - 45 * softplus((-510 - z) / 45));
  const across = Math.abs(x - channelCenter(z));
  const valley =
    Math.pow(across / 250, 1.65) *
    102 *
    Math.exp(-Math.pow((z + 100) / 640, 4)) *
    clamp((520 - across) / 230, 0, 1);
  const left =
    175 *
    Math.exp(-Math.pow(Math.abs((x + 275) / 115), 1.25) - Math.pow(Math.abs((z + 265) / 180), 1.3));
  const right =
    235 *
    Math.exp(-Math.pow(Math.abs((x - 265) / 105), 1.2) - Math.pow(Math.abs((z + 350) / 155), 1.3));
  const ridge =
    ((1 - Math.abs(Math.sin(x * 0.031 + z * 0.018))) * 25 +
      (1 - Math.abs(Math.sin(x * 0.065 - z * 0.052))) * 11 +
      Math.sin(z * 0.15 + x * 0.12) * 2) *
    clamp((across - 85) / 130, 0, 1);
  return profile + valley + left + right + ridge;
}

export class AlpineTerrain {
  readonly nx = Math.round((TERRAIN.maxX - TERRAIN.minX) / TERRAIN.step) + 1;
  readonly nz = Math.round((TERRAIN.maxZ - TERRAIN.minZ) / TERRAIN.step) + 1;
  readonly heights = new Float32Array(this.nx * this.nz);
  constructor() {
    for (let iz = 0; iz < this.nz; iz++)
      for (let ix = 0; ix < this.nx; ix++)
        this.heights[iz * this.nx + ix] = terrainHeight(
          TERRAIN.minX + ix * TERRAIN.step,
          TERRAIN.minZ + iz * TERRAIN.step,
        );
  }
  /** Bilinear height and its exact derivatives; render and dynamics share this surface. */
  sample(x: number, z: number, out: { height: number; dx: number; dz: number }) {
    const fx = clamp((x - TERRAIN.minX) / TERRAIN.step, 0, this.nx - 1.001);
    const fz = clamp((z - TERRAIN.minZ) / TERRAIN.step, 0, this.nz - 1.001);
    const ix = Math.floor(fx),
      iz = Math.floor(fz),
      u = fx - ix,
      v = fz - iz;
    const i = iz * this.nx + ix;
    const a = this.heights[i],
      b = this.heights[i + 1],
      c = this.heights[i + this.nx],
      d = this.heights[i + this.nx + 1];
    out.height = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    out.dx = ((b - a) * (1 - v) + (d - c) * v) / TERRAIN.step;
    out.dz = ((c - a) * (1 - u) + (d - b) * u) / TERRAIN.step;
    return out;
  }
}
