import * as T from 'three';

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paint(canvas.getContext('2d')!);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export function seededRandom(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export function soilTexture() {
  const random = seededRandom(3049);
  const texture = canvasTexture(1024, (ctx) => {
    ctx.fillStyle = '#30231b';
    ctx.fillRect(0, 0, 1024, 1024);
    // Multiple grain scales and organic fibres prevent a flat, uniformly noisy surface.
    for (let i = 0; i < 65000; i++) {
      const x = random() * 1024,
        y = random() * 1024;
      const r = i < 9000 ? 2 + random() * 13 : 0.3 + random() * 2.5;
      const c = Math.floor(24 + random() * 57);
      ctx.fillStyle = `rgb(${c + 12},${c * 0.75},${c * 0.52})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.35 + random() * 0.6), random() * 6, 0, Math.PI * 2);
      ctx.fill();
      if (i < 9000) {
        ctx.strokeStyle = '#130f0ba0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    for (let i = 0; i < 1400; i++) {
      const x = random() * 1024,
        y = random() * 1024;
      ctx.strokeStyle = random() < 0.7 ? '#b29b6b35' : '#09080780';
      ctx.lineWidth = 0.5 + random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 8, y - 4, x + random() * 24, y + random() * 9);
      ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(4, 2.2);
  texture.anisotropy = 8;
  return texture;
}

export function gardenTexture() {
  const random = seededRandom(31);
  return canvasTexture(1024, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, '#dbe0bd');
    gradient.addColorStop(0.5, '#99ac78');
    gradient.addColorStop(1, '#5f7753');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.filter = 'blur(35px)';
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#edf0c75a' : '#48644435';
      ctx.beginPath();
      ctx.ellipse(
        random() * 1024,
        random() * 1024,
        20 + random() * 90,
        40 + random() * 180,
        random() * 6,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });
}

export function leafTexture() {
  return canvasTexture(512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0, '#345449');
    g.addColorStop(0.45, '#6c9561');
    g.addColorStop(0.52, '#a4b679');
    g.addColorStop(1, '#3f6350');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const r = seededRandom(85);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = i % 3 ? '#d0d9a52b' : '#193b342b';
      ctx.lineWidth = 0.5 + r() * 1.2;
      ctx.beginPath();
      const x = r() * 512;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, 180, x - 4, 300, x, 512);
      ctx.stroke();
    }
  });
}
export function bulbTexture() {
  return canvasTexture(512, (ctx) => {
    ctx.fillStyle = '#997344';
    ctx.fillRect(0, 0, 512, 512);
    const r = seededRandom(27);
    for (let i = 0; i < 17000; i++) {
      const c = 80 + r() * 85;
      ctx.fillStyle = `rgba(${c + 25},${c * 0.76},${c * 0.45},.25)`;
      ctx.fillRect(r() * 512, r() * 512, r() * 15 + 1, r() * 3 + 1);
    }
    for (let i = 0; i < 95; i++) {
      ctx.strokeStyle = i % 3 ? '#efd3a640' : '#39211655';
      ctx.lineWidth = 0.5 + r() * 3;
      ctx.beginPath();
      const x = r() * 512;
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 35, 180, x - 25, 360, x + 10, 512);
      ctx.stroke();
    }
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = '#f0c99675';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const x = r() * 512,
        y = r() * 512;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 50, y + 15);
      ctx.lineTo(x + 90, y - 7);
      ctx.stroke();
    }
  });
}
// Tip, limb and throat. Blue/violet and silvery bicolours occur in Dutch iris cultivars.
const PETAL_PALETTES = [
  ['#8271d6', '#4936ad', '#e5dcfa', '#7978cf', '#4443ad'],
  ['#687fdf', '#304caf', '#e4e7ff', '#7a98eb', '#3c61bf'],
  ['#b18bd4', '#7640a3', '#f0def3', '#bfa5e3', '#8a61bd'],
  ['#edeafa', '#c2b5e3', '#fcf7df', '#8d99de', '#6574bb'],
  ['#eef0fc', '#d8dff1', '#fff5d5', '#edeaf7', '#c9cde5'],
];

export function petalTexture(kind: 'standard' | 'fall' | 'arm' = 'standard', palette = 0) {
  const fall = kind === 'fall',
    arm = kind === 'arm';
  const colors = PETAL_PALETTES[palette];
  const texture = canvasTexture(1024, (ctx) => {
    // Canvas top is UV v=1 (the petal tip); the attached claw is at the bottom.
    const g = ctx.createLinearGradient(0, 0, 0, 1024);
    g.addColorStop(0, arm ? colors[2] : colors[fall ? 3 : 0]);
    g.addColorStop(0.48, arm ? colors[0] : colors[fall ? 4 : 1]);
    g.addColorStop(0.82, colors[2]);
    g.addColorStop(1, '#d9dcb3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
    const r = seededRandom(61 + palette * 37 + (fall ? 7 : 0));
    const edgeLight = ctx.createLinearGradient(0, 0, 1024, 0);
    edgeLight.addColorStop(0, '#f2e6ff55');
    edgeLight.addColorStop(0.15, '#ffffff00');
    edgeLight.addColorStop(0.5, '#21164a19');
    edgeLight.addColorStop(0.85, '#ffffff00');
    edgeLight.addColorStop(1, '#f2e6ff55');
    ctx.fillStyle = edgeLight;
    ctx.fillRect(0, 0, 1024, 1024);
    // Branching longitudinal veins converge into the narrow claw.
    for (let i = 0; i < 145; i++) {
      const x = (i / 144) * 1024,
        bend = (r() - 0.5) * 45;
      ctx.strokeStyle = i % 4 === 0 ? '#f1e4ff46' : '#32217232';
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 0.55 + r() * 0.8;
      ctx.beginPath();
      ctx.moveTo(512 + (x - 512) * 0.18, 1024);
      ctx.bezierCurveTo(x + bend, 750, x - bend, 320, x, 0);
      ctx.stroke();
      if (i % 3 === 0) {
        ctx.beginPath();
        ctx.moveTo(x, 420);
        ctx.bezierCurveTo(x + 12, 300, x + 23, 200, x + 28, 70);
        ctx.stroke();
      }
    }
    if (fall) {
      // An ivory halo and long golden signal on the upper face of each fall.
      const halo = ctx.createRadialGradient(512, 555, 15, 512, 555, 270);
      halo.addColorStop(0, '#fff8d7ed');
      halo.addColorStop(0.6, '#f5efdbb0');
      halo.addColorStop(1, '#eee5fb00');
      ctx.fillStyle = halo;
      ctx.fillRect(200, 260, 624, 750);
      const gold = ctx.createLinearGradient(0, 370, 0, 1024);
      gold.addColorStop(0, '#ffc92e');
      gold.addColorStop(0.5, '#edb217');
      gold.addColorStop(1, '#fff0a1');
      ctx.fillStyle = gold;
      ctx.beginPath();
      ctx.moveTo(468, 1024);
      ctx.bezierCurveTo(450, 850, 398, 555, 438, 380);
      ctx.bezierCurveTo(450, 310, 482, 276, 512, 242);
      ctx.bezierCurveTo(571, 305, 593, 426, 580, 537);
      ctx.bezierCurveTo(568, 790, 553, 896, 553, 1024);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 21; i++) {
        const x = 476 + r() * 66;
        ctx.strokeStyle = i % 3 ? '#fff3a964' : '#ad741f40';
        ctx.lineWidth = 0.7 + r();
        ctx.beginPath();
        ctx.moveTo(x, 970);
        ctx.quadraticCurveTo(x + (r() - 0.5) * 45, 610, 512 + (x - 512) * 0.55, 293 + r() * 75);
        ctx.stroke();
      }
    }
    // Minute epidermal grain breaks up the otherwise perfectly smooth surface.
    for (let i = 0; i < 42000; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff0b' : '#261e500a';
      ctx.fillRect(r() * 1024, r() * 1024, 0.5 + r() * 1.5, 1 + r() * 2);
    }
  });
  texture.anisotropy = 8;
  return texture;
}

export function petalMaterial(map: T.Texture) {
  const material = new T.MeshPhysicalMaterial({
    map,
    side: T.DoubleSide,
    roughness: 0.57,
    metalness: 0,
    sheen: 0.65,
    sheenColor: new T.Color('#d5c5f5'),
    sheenRoughness: 0.72,
    bumpMap: map,
    bumpScale: 0.006,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      float petalBacklight = pow(max(0.0, dot(-normal, normalize(vec3(-0.6, 0.7, 0.4)))), 2.0);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * (0.08 + 0.32 * petalBacklight);`,
    );
  };
  return material;
}

export function leafMaterial(map: T.Texture) {
  const material = new T.MeshStandardMaterial({
    map,
    roughness: 0.69,
    side: T.DoubleSide,
    bumpMap: map,
    bumpScale: 0.008,
  });
  material.onBeforeCompile = (shader) => {
    // Warm light scattered through the thin blade; retain physically shaded front faces.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      float leafTransmission = pow(max(0.0, dot(-normal, normalize(vec3(-0.6, 0.7, 0.4)))), 2.0);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * (0.12 + 0.26 * leafTransmission);`,
    );
  };
  return material;
}
