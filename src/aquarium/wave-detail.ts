// Curved, slowly modulated crests adapted from CAUSTIC//LITE by Scottie (MIT).
// https://github.com/ScottieFox/caustic-volume/blob/main/lite/index.html
// Attribution and license: public/licenses/caustic-volume.txt.
export function createDetailWaves() {
  let seed = 5;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 24 }, (_, i) => {
    const length = 1.2 * 0.1 ** (i / 23),
      k = (2 * Math.PI) / length;
    const angle = i * 2.39996 + (random() - 0.5) * 0.9;
    return {
      kx: k * Math.cos(angle),
      kz: k * Math.sin(angle),
      speed: Math.sqrt(9.81 * k + 0.074 * k ** 3),
      phase: random() * Math.PI * 2,
      // Calibrated for our 45% default wave control; long swells stay restrained.
      amplitude: (Math.min(1, (0.55 / length) ** 2) / (k * k)) * (0.6 + 0.8 * random()),
      modulation: [
        0.05 + 0.22 * random(),
        0.09 + 0.3 * random(),
        random() * Math.PI * 2,
        random() * Math.PI * 2,
      ],
    };
  });
}
export type DetailWave = ReturnType<typeof createDetailWaves>[number];
export function detailAmplitude(w: DetailWave, time: number) {
  const m = w.modulation;
  return (
    w.amplitude *
    (1 + 0.625 * (0.6 * Math.sin(m[0] * time + m[2]) + 0.4 * Math.sin(m[1] * time + m[3])))
  );
}
/** Adds height and its exact spatial derivatives without per-sample allocation. */
export function addDetailWave(
  out: { x: number; y: number; z: number },
  w: DetailWave,
  index: number,
  x: number,
  z: number,
  time: number,
  amplitude: number,
) {
  const k = Math.hypot(w.kx, w.kz),
    sx = -w.kz / k,
    sz = w.kx / k,
    kb = 0.37 * k;
  const bend = kb * (sx * x + sz * z) + 0.9 * time + 7.1 * index;
  const phase = w.kx * x + w.kz * z - w.speed * time + w.phase + 1.6 * Math.sin(bend);
  const derivative = 1.6 * kb * Math.cos(bend),
    slope = amplitude * Math.cos(phase);
  out.x += amplitude * Math.sin(phase);
  out.y += slope * (w.kx + derivative * sx);
  out.z += slope * (w.kz + derivative * sz);
}
export const detailWaveGLSL = `
vec3 detailWave(vec4 w,float amplitude,float index,vec2 p,float time){
  vec2 side=vec2(-w.y,w.x)/length(w.xy);float kb=.37*length(w.xy);
  float bend=kb*dot(side,p)+.9*time+7.1*index;
  float phase=dot(w.xy,p)-w.z*time+w.w+1.6*sin(bend);
  return amplitude*vec3(sin(phase),cos(phase)*(w.xy+1.6*kb*cos(bend)*side));
}
`;
