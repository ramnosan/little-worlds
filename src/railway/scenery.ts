import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RADIUS, STRAIGHT, TRACK_LENGTH, trackPose } from './physics';

export const GROUND = 0.25;
export const RAIL_TOP = 0.366;
export const GAUGE = 0.3;
const WIDTH = 13.8,
  DEPTH = 9;

function random(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function smooth(a: number, b: number, v: number) {
  const t = T.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function noise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = smooth(0, 1, x - ix),
    fz = smooth(0, 1, z - iz);
  return T.MathUtils.lerp(
    T.MathUtils.lerp(random(ix + iz * 113), random(ix + 1 + iz * 113), fx),
    T.MathUtils.lerp(random(ix + (iz + 1) * 113), random(ix + 1 + (iz + 1) * 113), fx),
    fz,
  );
}
export function trackClearance(x: number, z: number) {
  // Signed distance to the oval; the outer parallel track is 0.52 units away.
  return Math.hypot(x - T.MathUtils.clamp(x, -STRAIGHT / 2, STRAIGHT / 2), z) - RADIUS;
}

export function terrainHeight(x: number, z: number) {
  const hill = (cx: number, cz: number, sx: number, sz: number, height: number) =>
    height * Math.exp(-(((x - cx) / sx) ** 2 + ((z - cz) / sz) ** 2));
  const hills =
    hill(1.4, -0.3, 2.3, 1.6, 1.9) +
    hill(-3.35, 0.3, 1.25, 1.4, 0.85) +
    hill(3.0, -3.9, 2.3, 1.3, 1.65) +
    hill(-1.8, -3.9, 1.2, 0.7, 1.45) +
    hill(-1.8, -0.95, 0.8, 0.9, 1.4);
  const cut = smooth(0.39, 0.93, Math.abs(trackClearance(x, z) - 0.26));
  const edge = smooth(0, 0.6, WIDTH / 2 - Math.abs(x)) * smooth(0, 0.48, DEPTH / 2 - Math.abs(z));
  const variation = 0.88 + noise(x * 2.1, z * 2.1) * 0.17 + noise(x * 6, z * 6) * 0.025;
  return GROUND + hills * variation * cut * edge;
}

/** Static, seeded model-railway scenery. Meshes are batched by material after construction. */
export class RailwayScenery {
  readonly group = new T.Group();
  private geometries = new Map<string, T.BufferGeometry>();
  private materials = new Map<string, T.MeshStandardMaterial>();
  private textures: T.Texture[] = [];
  private detail = new T.Group();
  private instances: T.InstancedMesh[] = [];
  private matrix = new T.Object3D();

  constructor(scene: T.Scene) {
    scene.add(this.group);
    this.group.add(this.detail);
    this.makeMaterials();
    this.table();
    this.landscape();
    this.track(0);
    this.track(0.52);
    this.village();
    this.bridge();
    this.vegetation();
    this.electrification();
    this.batchStaticMeshes();
  }

  private geometry(key: string, create: () => T.BufferGeometry) {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = create();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }
  private material(key: string) {
    let material = this.materials.get(key);
    if (!material) {
      material = new T.MeshStandardMaterial({ color: key, roughness: 0.85 });
      this.materials.set(key, material);
    }
    return material;
  }
  private mesh(geometry: T.BufferGeometry, material: string, parent: T.Object3D = this.group) {
    const mesh = new T.Mesh(geometry, this.material(material));
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: string,
    parent: T.Object3D = this.group,
  ) {
    const mesh = this.mesh(
      this.geometry('box', () => new T.BoxGeometry(1, 1, 1)),
      material,
      parent,
    );
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    return mesh;
  }
  private beam(
    a: T.Vector3,
    b: T.Vector3,
    thickness: number,
    material: string,
    parent: T.Object3D = this.group,
  ) {
    const mesh = this.box(
      thickness,
      a.distanceTo(b),
      thickness,
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      (a.z + b.z) / 2,
      material,
      parent,
    );
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return mesh;
  }
  private texture(kind: 'grass' | 'rock' | 'ballast' | 'wood' | 'roof' | 'wall') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!,
      data = context.createImageData(512, 512);
    const palette = {
      grass: [86, 105, 43],
      rock: [113, 117, 113],
      ballast: [120, 116, 106],
      wood: [86, 60, 39],
      roof: [91, 70, 65],
      wall: [202, 194, 170],
    }[kind];
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const coarse = noise(x / 45, y / 45),
          grain = random(x + y * 512);
        let shade = 0.7 + coarse * 0.4 + grain * 0.27;
        if (kind === 'grass')
          shade = 0.83 + noise(x / 19, y / 19) * 0.16 + grain * 0.48 + noise(x / 3, y / 3) * 0.13;
        if (kind === 'wood') shade = 0.62 + noise(x / 140, y / 3) * 0.5 + grain * 0.11;
        if (kind === 'rock')
          shade = 0.64 + coarse * 0.45 + noise(x / 9, y / 4) * 0.24 + grain * 0.13;
        if (kind === 'roof') {
          const row = Math.floor(y / 24),
            tileX = (x + (row % 2) * 16) % 32;
          shade =
            (y % 24 < 2 || tileX < 2 ? 0.45 : 0.85 + Math.sin((tileX / 32) * Math.PI) * 0.2) +
            grain * 0.1;
        }
        const at = (y * 512 + x) * 4;
        for (let c = 0; c < 3; c++) data.data[at + c] = Math.min(255, palette[c] * shade);
        data.data[at + 3] = 255;
      }
    context.putImageData(data, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = 4;
    this.textures.push(texture);
    return texture;
  }
  private makeMaterials() {
    for (const kind of ['grass', 'rock', 'ballast', 'wood', 'roof', 'wall'] as const) {
      const map = this.texture(kind);
      if (kind === 'grass') map.repeat.set(4, 3);
      if (kind === 'ballast') map.repeat.set(1, 16);
      const material = new T.MeshStandardMaterial({
        map,
        bumpMap: map,
        bumpScale: kind === 'grass' ? 0.009 : 0.025,
        roughness: 0.95,
      });
      if (kind === 'grass') material.vertexColors = true;
      this.materials.set(kind, material);
    }
    this.materials.set(
      'steel',
      new T.MeshStandardMaterial({ color: '#929997', metalness: 0.8, roughness: 0.38 }),
    );
    this.materials.set(
      'glass',
      new T.MeshStandardMaterial({ color: '#394b50', metalness: 0.25, roughness: 0.25 }),
    );
    this.materials.set(
      'needles',
      new T.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 1 }),
    );
  }

  private table() {
    this.box(WIDTH + 0.14, 0.22, DEPTH + 0.14, 0, 0.08, 0, 'wood');
    this.box(WIDTH, 0.065, DEPTH, 0, 0.2, 0, '#4b493b');
    for (const x of [-5.75, 5.75])
      for (const z of [-3.4, 3.4]) {
        this.box(0.2, 1.35, 0.2, x, -0.65, z, '#403c34');
        this.box(0.22, 0.045, 0.22, x, -1.33, z, '#282c28');
      }
    for (const z of [-3.4, 3.4]) this.box(11.7, 0.19, 0.1, 0, -0.23, z, '#504636');
  }

  private landscape() {
    const geometry = new T.PlaneGeometry(WIDTH, DEPTH, 230, 150);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position,
      colors: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i),
        z = position.getZ(i),
        h = terrainHeight(x, z);
      position.setY(i, h);
      const color = new T.Color().setRGB(
        0.76 + noise(x * 1.8, z * 1.8) * 0.24,
        0.78 + noise(x, z) * 0.22,
        0.66 + noise(x + 10, z) * 0.27,
      );
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.geometries.set('terrain', geometry);
    this.mesh(geometry, 'grass');

    // Rock ledges follow steep cuttings instead of sitting like boulders on a flat board.
    for (let variant = 0; variant < 3; variant++) {
      const rock = new T.IcosahedronGeometry(1, 1);
      const pos = rock.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i);
        const scale = 0.76 + noise(x * 6 + variant * 9, z * 6 + y * 4) * 0.42;
        pos.setXYZ(i, x * scale, (Math.round(y * 9) / 9) * scale, z * scale);
      }
      rock.computeVertexNormals();
      this.geometries.set(`rock${variant}`, rock);
      const transforms: T.Matrix4[] = [];
      for (let i = variant; i < 950; i += 3) {
        const x = random(i * 4 + 8) * 12.7 - 6.35,
          z = random(i * 4 + 9) * 7.8 - 3.9;
        const h = terrainHeight(x, z),
          slopeX = (terrainHeight(x + 0.07, z) - terrainHeight(x - 0.07, z)) / 0.14;
        const slopeZ = (terrainHeight(x, z + 0.07) - terrainHeight(x, z - 0.07)) / 0.14;
        if (
          h < 0.52 ||
          Math.hypot(slopeX, slopeZ) < 0.9 ||
          Math.abs(trackClearance(x, z) - 0.26) < 0.85
        )
          continue;
        this.matrix.position.set(x, h - 0.08, z);
        this.matrix.rotation.set(0.1, random(i) * 6, 0.1);
        const size = 0.12 + random(i + 44) * 0.22;
        this.matrix.scale.set(size * 1.8, size * 1.3, size);
        this.matrix.updateMatrix();
        transforms.push(this.matrix.matrix.clone());
      }
      this.instance(rock, 'rock', transforms);
    }
  }

  private instance(
    geometry: T.BufferGeometry,
    material: string,
    matrices: T.Matrix4[],
    detail = false,
  ) {
    const mesh = new T.InstancedMesh(geometry, this.material(material), matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.castShadow = mesh.receiveShadow = true;
    (detail ? this.detail : this.group).add(mesh);
    this.instances.push(mesh);
    return mesh;
  }

  private track(offset: number) {
    const count = 420,
      positions: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= count; i++)
      for (let edge = 0; edge < 4; edge++) {
        const lateral = [-0.29, -0.22, 0.22, 0.29][edge],
          p = trackPose((i / count) * TRACK_LENGTH, offset + lateral);
        positions.push(p.x, edge === 0 || edge === 3 ? GROUND + 0.005 : GROUND + 0.042, p.z);
        uvs.push(edge / 3, (i / count) * 12);
      }
    for (let i = 0; i < count; i++)
      for (let j = 0; j < 3; j++) {
        const k = i * 4 + j;
        indices.push(k, k + 1, k + 4, k + 1, k + 5, k + 4);
      }
    const ballast = new T.BufferGeometry();
    ballast.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    ballast.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    ballast.setIndex(indices);
    ballast.computeVertexNormals();
    this.geometries.set(`ballast${offset}`, ballast);
    this.mesh(ballast, 'ballast');
    const sleepers: T.Matrix4[] = [],
      gravel: T.Matrix4[] = [];
    for (let i = 0; i < 270; i++) {
      const p = trackPose((i / 270) * TRACK_LENGTH, offset);
      this.matrix.position.set(p.x, 0.31, p.z);
      this.matrix.rotation.set(0, p.yaw, 0);
      this.matrix.scale.set(0.052, 0.038, 0.46);
      this.matrix.updateMatrix();
      sleepers.push(this.matrix.matrix.clone());
    }
    this.instance(
      this.geometry('box', () => new T.BoxGeometry(1, 1, 1)),
      '#5c5244',
      sleepers,
    );
    for (let i = 0; i < 1700; i++) {
      const p = trackPose((i / 1700) * TRACK_LENGTH, offset + (random(i + 100) - 0.5) * 0.56);
      this.matrix.position.set(p.x, 0.291, p.z);
      this.matrix.rotation.set(i, i * 0.23, 0);
      this.matrix.scale.setScalar(0.009 + random(i) * 0.01);
      this.matrix.updateMatrix();
      gravel.push(this.matrix.matrix.clone());
    }
    this.instance(
      this.geometry('stone', () => new T.IcosahedronGeometry(1, 0)),
      '#9d988b',
      gravel,
      true,
    );
    for (const gauge of [-GAUGE / 2, GAUGE / 2]) {
      // Flat steel rail head over a thin, rust-darkened web.
      for (const [width, height, y, material] of [
        [0.022, 0.014, 0.359, 'steel'],
        [0.01, 0.032, 0.338, '#665440'],
      ] as const) {
        const vertices: number[] = [],
          uv: number[] = [],
          index: number[] = [];
        for (let i = 0; i <= count; i++)
          for (const [dx, dy] of [
            [-width / 2, -height / 2],
            [-width / 2, height / 2],
            [width / 2, height / 2],
            [width / 2, -height / 2],
          ]) {
            const p = trackPose((i / count) * TRACK_LENGTH, offset + gauge + dx);
            vertices.push(p.x, y + dy, p.z);
            uv.push(i / count, dy);
          }
        for (let i = 0; i < count; i++)
          for (let j = 0; j < 4; j++) {
            const a = i * 4 + j,
              b = i * 4 + ((j + 1) % 4);
            index.push(a, b, a + 4, b, b + 4, a + 4);
          }
        const rail = new T.BufferGeometry();
        rail.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
        rail.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        rail.setIndex(index);
        rail.computeVertexNormals();
        this.geometries.set(`rail${offset}${gauge}${y}`, rail);
        this.mesh(rail, material);
      }
    }
  }

  private house(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    angle = 0,
    station = false,
  ) {
    const group = new T.Group();
    group.position.set(x, terrainHeight(x, z) + 0.015, z);
    group.rotation.y = angle;
    this.group.add(group);
    const foundation = group.position.y > 0.65 ? 0.6 : 0.12;
    this.box(width + 0.1, foundation, depth + 0.1, 0, 0.06 - foundation / 2, 0, 'rock', group);
    this.box(width, height, depth, 0, height / 2, 0, 'wall', group);
    // Plaster lower walls, timber upper storey, tiled roof, glazed windows and shutters.
    const roofShape = new T.Shape();
    roofShape.moveTo(-depth / 2 - 0.1, 0);
    roofShape.lineTo(0, depth * 0.6);
    roofShape.lineTo(depth / 2 + 0.1, 0);
    roofShape.closePath();
    const roof = this.geometry(
      `roof:${width}:${depth}`,
      () => new T.ExtrudeGeometry(roofShape, { depth: width + 0.2, bevelEnabled: false }),
    );
    const roofMesh = this.mesh(roof, 'roof', group);
    roofMesh.rotation.y = Math.PI / 2;
    roofMesh.position.set(-width / 2 - 0.1, height, 0);
    for (const side of [-1, 1]) {
      const front = side * (depth / 2 + 0.008);
      this.box(width, 0.04, 0.028, 0, height * 0.55, front, '#514535', group);
      this.box(width + 0.06, 0.06, 0.065, 0, height - 0.03, front, '#4b4031', group);
      for (const sx of [-1, 1])
        this.box(0.04, height, 0.03, sx * (width / 2 - 0.03), height / 2, front, '#514535', group);
      for (const wx of [-width * 0.31, 0, width * 0.31])
        for (const wy of [height * 0.29, height * 0.76]) {
          this.box(0.17, 0.24, 0.02, wx, wy, front, '#dfdacc', group);
          this.box(0.125, 0.19, 0.026, wx, wy, front, 'glass', group);
          this.box(0.01, 0.2, 0.03, wx, wy, front, '#d8d2bd', group);
          this.box(0.13, 0.009, 0.03, wx, wy, front, '#d8d2bd', group);
          for (const sign of [-1, 1])
            this.box(0.043, 0.22, 0.026, wx + sign * 0.11, wy, front, '#5b6554', group);
        }
    }
    this.box(0.18, 0.34, 0.035, width * 0.12, 0.17, depth / 2 + 0.03, '#4d4435', group);
    this.box(0.15, 0.36, 0.16, width * 0.28, height + depth * 0.39, 0, 'rock', group);
    this.box(0.19, 0.025, 0.2, width * 0.28, height + depth * 0.39 + 0.19, 0, '#5e5b53', group);
    if (station) {
      this.box(width + 0.22, 0.045, 0.55, 0, 0.5, depth / 2 + 0.22, '#51594d', group);
      for (const dx of [-width / 2, width / 2])
        this.box(0.025, 0.5, 0.025, dx, 0.25, depth / 2 + 0.43, '#57594c', group);
      this.sign('KLEINWALD', 0.7, 0.11, 0, height * 0.55, depth / 2 + 0.03, group);
    }
  }

  private sign(
    text: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    parent = this.group,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#eee9d8';
    ctx.fillRect(0, 0, 512, 80);
    ctx.fillStyle = '#303f3a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '500 44px Arial';
    ctx.fillText(text, 256, 43);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    this.textures.push(texture);
    const material = new T.MeshStandardMaterial({ map: texture, roughness: 0.8 });
    this.materials.set(`sign:${text}`, material);
    const sign = this.mesh(
      this.geometry(`sign:${text}`, () => new T.PlaneGeometry(w, h)),
      `sign:${text}`,
      parent,
    );
    sign.position.set(x, y, z);
  }

  private village() {
    this.house(2.1, -3.94, 0.98, 0.88, 0.63, -0.13);
    this.house(3.35, -3.85, 1.08, 1.12, 0.72, 0.11);
    this.house(4.62, -3.66, 0.85, 0.77, 0.65, -0.2);
    this.house(-3.55, 3.6, 0.8, 0.68, 0.63, 0.08);
    // The station sits on the flat outer side of the front straight.
    this.box(3.7, 0.1, 0.43, 0.2, 0.3, 3.69, 'rock');
    this.box(3.7, 0.02, 0.035, 0.2, 0.36, 3.49, '#d8d2b7');
    this.house(0.3, 4.1, 1.6, 0.6, 0.51, Math.PI, true);
    for (const x of [-0.8, 1.35]) {
      this.box(0.34, 0.032, 0.1, x, 0.46, 3.68, '#665640');
      this.box(0.34, 0.1, 0.022, x, 0.53, 3.73, '#665640');
      for (const dx of [-0.12, 0.12]) this.box(0.023, 0.1, 0.07, x + dx, 0.4, 3.68, '#494b43');
    }
    for (let i = 0; i < 25; i++)
      this.box(0.027, 0.18, 0.027, -1.1 + i * 0.14, 0.35, 4.42, '#73766a');
    for (const y of [0.33, 0.41]) this.box(3.5, 0.02, 0.02, 0.58, y, 4.42, '#73766a');
    // Gravel footpaths climb to the hilltop houses.
    for (let i = 0; i < 90; i++) {
      const x = 0.95 + (i / 90) * 4.5,
        z = -3.72 + Math.sin((i / 90) * 5) * 0.19;
      const piece = this.box(0.085, 0.018, 0.17, x, terrainHeight(x, z) + 0.01, z, 'ballast');
      piece.rotation.z = Math.atan2(terrainHeight(x + 0.05, z) - terrainHeight(x - 0.05, z), 0.1);
    }
  }

  private bridge() {
    const x = -1.8,
      y = 1.52,
      start = -3.7,
      end = -1.02;
    this.box(0.63, 0.1, end - start, x, y, (start + end) / 2, '#414c46');
    this.box(0.49, 0.02, end - start, x, y + 0.06, (start + end) / 2, '#777467');
    for (const z of [start + 0.05, end - 0.05]) {
      this.box(0.76, 1.17, 0.27, x, 0.88, z, 'rock');
      this.box(0.82, 0.085, 0.34, x, y - 0.08, z, '#aaa798');
    }
    for (const side of [-1, 1]) {
      const bx = x + side * 0.3;
      for (const by of [y + 0.12, y + 0.48])
        this.box(0.035, 0.035, end - start, bx, by, (start + end) / 2, '#425149');
      for (let i = 0; i < 7; i++) {
        const z = start + (i / 7) * (end - start),
          next = start + ((i + 1) / 7) * (end - start);
        this.box(0.027, 0.39, 0.027, bx, y + 0.29, z, '#425149');
        this.beam(
          new T.Vector3(bx, y + 0.12, z),
          new T.Vector3(bx, y + 0.48, next),
          0.025,
          '#425149',
        );
        this.beam(
          new T.Vector3(bx, y + 0.48, z),
          new T.Vector3(bx, y + 0.12, next),
          0.018,
          '#425149',
        );
      }
    }
  }

  private conifer(variant: number) {
    const pieces: T.BufferGeometry[] = [],
      foliage = new T.OctahedronGeometry(1, 0);
    // Hundreds of uneven, drooping sprays create an open silhouette, with no solid cone.
    for (let layer = 0; layer < 13; layer++) {
      const t = layer / 13,
        radius = Math.pow(1 - t, 0.9) * 0.32;
      for (let branch = 0; branch < 7; branch++) {
        const a = (branch / 7) * Math.PI * 2 + layer * 1.7 + variant;
        const length = radius * (0.7 + random(layer * 11 + branch + variant * 7) * 0.5);
        for (let spray = 0; spray < 4; spray++) {
          const r = ((spray + 1) / 4) * length;
          this.matrix.position.set(Math.cos(a) * r, 0.15 + t * 0.97 - r * 0.22, Math.sin(a) * r);
          this.matrix.rotation.set(0.2, -a, -0.17);
          this.matrix.scale.set(
            length * 0.45 + 0.025,
            0.036 + (1 - t) * 0.027,
            0.075 * (1 - t) + 0.016,
          );
          this.matrix.updateMatrix();
          const piece = foliage.clone();
          piece.applyMatrix4(this.matrix.matrix);
          const colors: number[] = [],
            color = new T.Color().setHSL(
              0.27 + variant * 0.012,
              0.25 + random(branch + layer) * 0.15,
              0.13 + random(layer * 3 + spray + variant) * 0.14,
              T.SRGBColorSpace,
            );
          for (let v = 0; v < piece.attributes.position.count; v++)
            colors.push(color.r, color.g, color.b);
          piece.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
          pieces.push(piece);
        }
      }
    }
    foliage.dispose();
    const geometry = mergeGeometries(pieces)!;
    pieces.forEach((piece) => piece.dispose());
    this.geometries.set(`fir${variant}`, geometry);
    return geometry;
  }

  private vegetation() {
    const trees: { x: number; z: number; size: number }[] = [];
    for (let i = 0; i < 1100 && trees.length < 115; i++) {
      const x = random(i * 3 + 10) * 12.6 - 6.3,
        z = random(i * 3 + 11) * 8.15 - 4.075;
      if (Math.abs(trackClearance(x, z) - 0.26) < 0.87) continue;
      if (z > 3.2 || (z < -3.2 && x > 0.7) || (Math.abs(x + 1.8) < 0.72 && z < 0.15)) continue;
      if (x > 0.1 && x < 3.7 && z > 0.35 && random(i + 99) > 0.18) continue;
      if (trees.some((tree) => Math.hypot(tree.x - x, tree.z - z) < 0.3)) continue;
      trees.push({ x, z, size: 0.65 + random(i * 3 + 12) * 0.75 });
    }
    const trunks: T.Matrix4[] = [];
    for (let variant = 0; variant < 4; variant++) {
      const matrices: T.Matrix4[] = [];
      trees.forEach((tree, i) => {
        if (i % 4 !== variant) return;
        const y = terrainHeight(tree.x, tree.z);
        this.matrix.position.set(tree.x, y, tree.z);
        this.matrix.rotation.set(0, i * 2.4, (random(i) - 0.5) * 0.06);
        this.matrix.scale.set(tree.size, tree.size * (0.95 + random(i + 72) * 0.22), tree.size);
        this.matrix.updateMatrix();
        matrices.push(this.matrix.matrix.clone());
        this.matrix.position.y += tree.size * 0.45;
        this.matrix.scale.set(0.021 * tree.size, tree.size * 0.9, 0.021 * tree.size);
        this.matrix.updateMatrix();
        trunks.push(this.matrix.matrix.clone());
      });
      this.instance(this.conifer(variant), 'needles', matrices);
    }
    this.instance(
      this.geometry('trunk', () => new T.CylinderGeometry(0.45, 1, 1, 5)),
      '#574a35',
      trunks,
    );
    // Small scrub and grass tufts blend the rock outcrops into the terrain.
    const scrub: T.Matrix4[] = [];
    for (let i = 0; i < 1600; i++) {
      const x = random(i * 5 + 71) * 13 - 6.5,
        z = random(i * 5 + 72) * 8.4 - 4.2;
      if (Math.abs(trackClearance(x, z) - 0.26) < 0.6 || z > 3.3 || (z < -3.45 && x > 0.5))
        continue;
      const s = 0.025 + random(i) * 0.085;
      this.matrix.position.set(x, terrainHeight(x, z), z);
      this.matrix.rotation.set(0, i, 0);
      this.matrix.scale.set(s, s * 0.6, s);
      this.matrix.updateMatrix();
      scrub.push(this.matrix.matrix.clone());
    }
    this.instance(
      this.geometry('scrub', () => new T.IcosahedronGeometry(1, 1)),
      '#687439',
      scrub,
      true,
    );
  }

  private electrification() {
    const wirePoints: T.Vector3[] = [];
    for (let i = 0; i < 24; i++) {
      const s = (i / 24) * TRACK_LENGTH,
        pole = trackPose(s, 0.99);
      // The road bridge spans above both tracks; leave its opening free of masts.
      if (Math.abs(pole.x + 1.8) < 0.48 && pole.z < -2) continue;
      const group = new T.Group();
      group.position.set(pole.x, GROUND, pole.z);
      group.rotation.y = pole.yaw;
      this.group.add(group);
      this.box(0.095, 0.09, 0.1, 0, 0.045, 0, 'rock', group);
      this.box(0.029, 1.01, 0.029, 0, 0.55, 0, '#5e6559', group);
      this.box(0.025, 0.025, 1.12, 0, 1.01, -0.49, '#5e6559', group);
      this.beam(new T.Vector3(0, 0.74, 0), new T.Vector3(0, 1.01, -0.8), 0.014, '#677063', group);
      for (const z of [-0.48, -1.0]) this.box(0.035, 0.065, 0.035, 0, 1.015, z, '#b0aa88', group);
    }
    for (const offset of [0, 0.52]) {
      for (let i = 0; i < 240; i++) {
        const a = trackPose((i / 240) * TRACK_LENGTH, offset),
          b = trackPose(((i + 1) / 240) * TRACK_LENGTH, offset);
        const sagA = Math.sin(((i % 10) / 10) * Math.PI) * 0.027,
          sagB = Math.sin((((i + 1) % 10) / 10) * Math.PI) * 0.027;
        wirePoints.push(
          new T.Vector3(a.x, 1.255 - sagA, a.z),
          new T.Vector3(b.x, 1.255 - sagB, b.z),
        );
      }
    }
    // Wire segments use thin physical geometry and participate in the static batch.
    for (let i = 0; i < wirePoints.length; i += 2)
      this.beam(wirePoints[i], wirePoints[i + 1], 0.006, '#5d6257');
  }

  private batchStaticMeshes() {
    this.group.updateMatrixWorld(true);
    const batches = new Map<T.Material, T.BufferGeometry[]>(),
      originals: T.Mesh[] = [];
    this.group.traverse((object) => {
      if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh) return;
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      const material = object.material as T.Material;
      const batch = batches.get(material) ?? [];
      batch.push(geometry);
      batches.set(material, batch);
      originals.push(object);
    });
    originals.forEach((mesh) => mesh.removeFromParent());
    let i = 0;
    batches.forEach((geometries, material) => {
      const geometry = mergeGeometries(geometries)!;
      geometries.forEach((g) => g.dispose());
      this.geometries.set(`batch${i++}`, geometry);
      const mesh = new T.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }
  quality(light: boolean) {
    this.detail.visible = !light;
  }
  dispose() {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.textures.forEach((texture) => texture.dispose());
    this.instances.forEach((mesh) => mesh.dispose());
    this.group.removeFromParent();
  }
}
