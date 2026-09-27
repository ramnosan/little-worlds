import { clamp, smooth, type IrisPlant, type Point } from './growth';

/** A fixed growth path: elongation reveals the curve without rotating the buried bulb. */
export function stemPoint(p: IrisPlant, height: number): Point {
  const h = Math.max(0, height),
    t = clamp(h / p.height);
  // The underground shoot stays inside the narrow soil volume. Curvature builds above it.
  const exposed = Math.max(0, h + p.position[1] + 0.24);
  const bow = Math.sin(Math.PI * t) * t * smooth(exposed, 0, 1);
  return [
    p.position[0] + p.form.lean[0] * exposed * (0.45 + 0.55 * t) + p.form.bend[0] * bow,
    p.position[1] + 0.24 + h,
    p.position[2] + p.form.lean[1] * exposed * (0.45 + 0.55 * t) + p.form.bend[1] * bow,
  ];
}

export function leafPoint(p: IrisPlant, n: number, u: number, v: number): Point {
  const leaf = p.leaves[n];
  if (!leaf) return stemPoint(p, 0);
  const length = leaf.length;
  const phi = leaf.angle + leaf.twist * u * u;
  const spread = length * leaf.lean * u * u;
  const width = leaf.width * Math.sin(Math.PI * u) ** 0.65 * (1 - 0.35 * u);
  const center = stemPoint(p, length * u * 0.94);
  return [
    center[0] + Math.cos(phi) * spread + Math.sin(phi) * v * width,
    center[1] - leaf.droop * length * u ** 3,
    center[2] +
      Math.sin(phi) * spread -
      Math.cos(phi) * v * width +
      Math.abs(v) * 0.045 * Math.sin(Math.PI * u),
  ];
}

export type PetalKind = 'standard' | 'fall' | 'arm';
/** Local flower coordinates. Three standards alternate with three falls and their style arms. */
export function petalPoint(p: IrisPlant, n: number, u: number, v: number, kind: PetalKind): Point {
  const variation = p.form.petalVariation[n + (kind === 'standard' ? 3 : kind === 'arm' ? 6 : 0)];
  const open = smooth(p.opening, 0.02 + variation * 0.09, 0.88 + variation * 0.12);
  const angle =
    p.rotation +
    (n * Math.PI * 2) / 3 +
    (kind === 'standard' ? Math.PI / 3 : 0) +
    (variation - 0.5) * 0.14;
  const wave = Math.sin(Math.PI * u);
  const blade = Math.sin(Math.PI * u ** 1.5) ** 0.52;
  const edge = Math.abs(v) ** 3;
  const curl = p.form.petalCurl;
  const pleats =
    open * wave * (0.006 * Math.cos(v * 29 + u * 3) + 0.003 * Math.sin(v * 53 - u * 5));
  let radial: number, y: number, width: number;
  if (kind === 'standard') {
    // Narrow claw, broad upright spoon, cupped sides, and an outward rolled tip.
    radial = 0.035 + 0.07 * u + open * (0.56 * Math.sin(Math.PI * u * 0.65) + 0.1 * u ** 4);
    y = 1.28 * u - open * 0.12 * u ** 4;
    width = (0.035 * wave + 0.31 * blade) * (0.12 + 0.88 * open);
    radial -= open * 0.11 * v * v * wave * curl;
    radial += pleats;
    y += open * 0.045 * edge * wave;
  } else if (kind === 'fall') {
    // The limb opens horizontally then folds down, with a broad rounded distal end.
    const drop = smooth(u, 0.4, 1);
    radial = 0.025 + 0.055 * u + open * (1.12 * Math.sin(u * Math.PI * 0.59));
    y = 0.94 * u * (1 - open) + open * (0.27 * Math.sin(Math.PI * u) - 0.48 * drop * curl);
    width = (0.045 * wave + 0.43 * blade) * (0.1 + 0.9 * open);
    y += open * (0.09 * v * v * wave - 0.055 * edge * drop);
    y += pleats;
  } else {
    radial = 0.02 + u * (0.04 + 0.6 * open);
    y = 0.72 * u * (1 - open) + open * (0.36 * Math.sin(Math.PI * u * 0.78) + 0.05 * u);
    width = 0.155 * blade * (0.16 + 0.84 * open);
    // A split, petaloid crest over the yellow signal; no bearded-iris fuzz.
    y += open * (0.065 * v * v * wave + 0.09 * Math.abs(v) * smooth(u, 0.72, 1));
  }
  const ruffle =
    open *
    curl *
    edge *
    wave *
    (0.016 * Math.sin(u * 37 + variation * 9 + v * 2) + 0.007 * Math.sin(u * 71 - v * 5));
  width *= p.form.petalWidth * (0.9 + variation * 0.2);
  const across = v * width + open * (variation - 0.5) * 0.08 * wave;
  y += ruffle + open * v * wave * (variation - 0.5) * 0.11;
  const scale = (0.15 + 0.85 * p.bud) * p.form.flowerSize * (0.94 + variation * 0.12);
  return [
    scale * (Math.sin(angle) * radial + Math.cos(angle) * across),
    scale * y,
    scale * (Math.cos(angle) * radial - Math.sin(angle) * across),
  ];
}
