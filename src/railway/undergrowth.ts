import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type UndergrowthKind = 'bush' | 'scrub' | 'grass';

/** Small reusable, rooted plant meshes. All variation is deterministic. */
export function undergrowthGeometry(kind: UndergrowthKind, variant: number) {
  const pieces: T.BufferGeometry[] = [];
  const transform = new T.Object3D();
  const random = (seed: number) => {
    const n = Math.sin(seed * 127.1 + variant * 47.7 + 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const add = (geometry: T.BufferGeometry, color: T.Color) => {
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
    // Use non-indexed pieces so stems, leaves and blades share an attribute layout.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.deleteAttribute('uv');
    pieces.push(flat);
  };
  const stem = (a: T.Vector3, b: T.Vector3, radius: number) => {
    const geometry = new T.CylinderGeometry(radius * 0.45, radius, a.distanceTo(b), 4);
    transform.position.copy(a).add(b).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    transform.scale.setScalar(1);
    transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);
    add(geometry, new T.Color('#66513a'));
  };

  if (kind === 'grass') {
    for (let blade = 0; blade < 28; blade++) {
      const angle = blade * 2.4 + variant;
      const height = 0.3 + random(blade + 8) * 0.65;
      const lean = 0.15 + random(blade + 48) * 0.55;
      const root = new T.Vector3(Math.cos(angle) * 0.07, 0, Math.sin(angle) * 0.07);
      const positions: number[] = [];
      const point = (t: number, side: number) => {
        const width = 0.018 * (1 - t) * side;
        return new T.Vector3(
          root.x + Math.cos(angle) * lean * t * t - Math.sin(angle) * width,
          height * (t - 0.2 * t * t),
          root.z + Math.sin(angle) * lean * t * t + Math.cos(angle) * width,
        );
      };
      for (let segment = 0; segment < 4; segment++) {
        const a = point(segment / 4, -1),
          b = point(segment / 4, 1);
        const c = point((segment + 1) / 4, -1),
          d = point((segment + 1) / 4, 1);
        // Both faces remain visible from every orbit angle without a transparent material.
        for (const v of [a, b, c, b, d, c, c, b, a, c, d, b]) positions.push(v.x, v.y, v.z);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      add(
        geometry,
        new T.Color(blade % 7 === 0 ? '#9b9059' : ['#526337', '#738346', '#65753b'][blade % 3]),
      );
    }
  } else {
    const low = kind === 'scrub';
    for (let branch = 0; branch < 7; branch++) {
      const angle = branch * 2.4 + variant * 0.7;
      const height = (low ? 0.23 : 0.6) + random(branch + 4) * (low ? 0.23 : 0.45);
      const reach = (low ? 0.5 : 0.22) + random(branch + 16) * 0.28;
      const root = new T.Vector3(0, -0.035, 0);
      const elbow = new T.Vector3(
        Math.cos(angle) * reach * 0.45,
        height * 0.44,
        Math.sin(angle) * reach * 0.45,
      );
      const tip = new T.Vector3(Math.cos(angle) * reach, height, Math.sin(angle) * reach);
      stem(root, elbow, 0.022);
      stem(elbow, tip, 0.013);
      for (let twig = 0; twig < 3; twig++) {
        const base = elbow.clone().lerp(tip, 0.18 + twig * 0.26);
        const direction = angle + (twig % 2 ? -1 : 1) * 0.9;
        const end = base
          .clone()
          .add(new T.Vector3(Math.cos(direction) * 0.24, 0.12, Math.sin(direction) * 0.24));
        stem(base, end, 0.006);
        for (let leaf = 0; leaf < 9; leaf++) {
          const side = leaf % 2 ? -1 : 1;
          const geometry = new T.OctahedronGeometry(1, 0);
          transform.position.copy(base).lerp(end, 0.2 + Math.floor(leaf / 2) * 0.18);
          transform.position.x += Math.cos(direction + side * 1.1) * 0.055;
          transform.position.z += Math.sin(direction + side * 1.1) * 0.055;
          transform.rotation.set(0.2 + random(leaf + branch * 9), -direction - side * 0.7, 0.35);
          const size = 0.8 + random(leaf + twig * 13 + branch * 31) * 0.5;
          transform.scale.set(0.085 * size, 0.016 * size, 0.035 * size);
          transform.updateMatrix();
          geometry.applyMatrix4(transform.matrix);
          add(
            geometry,
            new T.Color(
              ['#435b31', '#59713b', '#728345', '#63783e'][(leaf + twig + branch + variant) % 4],
            ),
          );
        }
      }
    }
  }
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach((piece) => piece.dispose());
  geometry.computeBoundingSphere();
  return geometry;
}
