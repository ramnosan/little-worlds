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
export function petalTexture(fall = false) {
  return canvasTexture(512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, fall ? '#acaae6' : '#6951bb');
    g.addColorStop(0.55, fall ? '#c4c2ef' : '#7962da');
    g.addColorStop(1, fall ? '#8273cc' : '#5146a3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const r = seededRandom(61);
    for (let i = 0; i < 65; i++) {
      ctx.strokeStyle = fall ? '#5043ab50' : '#d5c4ff65';
      ctx.lineWidth = 0.6 + r();
      const x = r() * 512;
      ctx.beginPath();
      ctx.moveTo(256 + (x - 256) * 0.3, 0);
      ctx.bezierCurveTo(x, 180, x + 15, 330, x, 512);
      ctx.stroke();
    }
    if (fall) {
      ctx.fillStyle = '#edbf30';
      ctx.beginPath();
      ctx.moveTo(229, 0);
      ctx.bezierCurveTo(212, 75, 199, 180, 254, 245);
      ctx.bezierCurveTo(301, 180, 300, 75, 284, 0);
      ctx.fill();
    }
  });
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
