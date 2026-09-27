import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  MAX_PLANTS,
  MAX_ROOTS,
  MAX_ROOT_POINTS,
  clamp,
  smooth,
  type IrisPlant,
  type PlantWorld,
  type Point,
} from './growth';
import {
  gardenTexture,
  soilTexture,
  leafTexture,
  bulbTexture,
  petalTexture,
  leafMaterial,
  seededRandom,
} from './materials';

const SIDES = 6;
const RING_COS = Array.from({ length: SIDES }, (_, j) => Math.cos((j / SIDES) * Math.PI * 2));
const RING_SIN = Array.from({ length: SIDES }, (_, j) => Math.sin((j / SIDES) * Math.PI * 2));
class RootMesh {
  readonly geometry = new T.BufferGeometry();
  readonly mesh: T.Mesh;
  readonly positions = new Float32Array(MAX_ROOTS * MAX_ROOT_POINTS * SIDES * 3);
  readonly normals = new Float32Array(this.positions.length);
  readonly indices = new Uint16Array(MAX_ROOTS * (MAX_ROOT_POINTS - 1) * SIDES * 6);
  constructor(material: T.Material) {
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute(
      'normal',
      new T.BufferAttribute(this.normals, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setIndex(new T.BufferAttribute(this.indices, 1).setUsage(T.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new T.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }
  update(p: IrisPlant) {
    // Pack only active rings into the bounded buffers: no invisible duplicate triangles.
    let vertex = 0,
      index = 0;
    for (const root of p.roots) {
      const points = root.points;
      const rings = Math.min(MAX_ROOT_POINTS, points.length + 1);
      for (let i = 0; i < rings; i++) {
        const idx = Math.min(i, points.length - 1),
          c = points[idx];
        const a = points[Math.max(0, idx - 1)],
          b = points[Math.min(points.length - 1, idx + 1)];
        let dx = b[0] - a[0],
          dy = b[1] - a[1];
        if (Math.hypot(dx, dy) < 1e-8) {
          dx = root.direction[0];
          dy = root.direction[1];
        }
        const l = Math.hypot(dx, dy) || 1;
        const radius =
          i === rings - 1
            ? 0
            : root.radius * (0.18 + 0.82 * Math.sqrt(1 - i / Math.max(2, points.length)));
        const extra = idx === points.length - 1 ? root.carry : 0;
        for (let j = 0; j < SIDES; j++) {
          const k = (vertex + j) * 3,
            cos = RING_COS[j],
            sin = RING_SIN[j];
          this.positions[k] = c[0] + root.direction[0] * extra + cos * (-dy / l) * radius;
          this.positions[k + 1] = c[1] + root.direction[1] * extra + cos * (dx / l) * radius;
          this.positions[k + 2] = c[2] + sin * radius;
          this.normals[k] = cos * (-dy / l);
          this.normals[k + 1] = cos * (dx / l);
          this.normals[k + 2] = sin;
          if (i < rings - 1) {
            const a = vertex + j,
              b = vertex + ((j + 1) % SIDES);
            this.indices[index++] = a;
            this.indices[index++] = b;
            this.indices[index++] = a + SIDES;
            this.indices[index++] = b;
            this.indices[index++] = b + SIDES;
            this.indices[index++] = a + SIDES;
          }
        }
        vertex += SIDES;
      }
    }
    this.geometry.setDrawRange(0, index);
    for (const name of ['position', 'normal']) {
      const attribute = this.geometry.getAttribute(name) as T.BufferAttribute;
      attribute.clearUpdateRanges();
      if (vertex) attribute.addUpdateRange(0, vertex * 3);
      attribute.needsUpdate = true;
    }
    const attribute = this.geometry.index!;
    attribute.clearUpdateRanges();
    if (index) attribute.addUpdateRange(0, index);
    attribute.needsUpdate = true;
  }
}
type Surface = (organ: number, u: number, v: number) => Point;
class Ribbons {
  readonly geometry = new T.BufferGeometry();
  readonly mesh: T.Mesh;
  readonly positions: Float32Array;
  constructor(
    readonly count: number,
    material: T.Material,
    readonly rows = 28,
    readonly cols = 8,
  ) {
    this.positions = new Float32Array(count * (rows + 1) * (cols + 1) * 3);
    const uv: number[] = [],
      indices: number[] = [];
    for (let k = 0; k < count; k++)
      for (let i = 0; i <= rows; i++)
        for (let j = 0; j <= cols; j++) {
          uv.push(j / cols, i / rows);
          if (i < rows && j < cols) {
            const a = k * (rows + 1) * (cols + 1) + i * (cols + 1) + j,
              b = a + cols + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    this.geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    this.geometry.setIndex(indices);
    this.mesh = new T.Mesh(this.geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }
  update(sample: Surface) {
    let k = 0;
    for (let n = 0; n < this.count; n++)
      for (let i = 0; i <= this.rows; i++)
        for (let j = 0; j <= this.cols; j++) {
          const p = sample(n, i / this.rows, (j / this.cols) * 2 - 1);
          this.positions[k++] = p[0];
          this.positions[k++] = p[1];
          this.positions[k++] = p[2];
        }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
interface Slot {
  group: T.Group;
  bulb: T.Mesh;
  stem: T.Mesh;
  roots: RootMesh;
  leaves: Ribbons;
  standards: Ribbons;
  falls: Ribbons;
  arms: Ribbons;
  sheath: Ribbons;
  revision: number;
  rootRevision?: number;
  leafGrowth?: number;
  flowerGrowth?: number;
  id: number;
}
export class PlantRenderer {
  readonly renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(32, 1, 0.1, 100);
  readonly controls: OrbitControls;
  readonly slots: Slot[] = [];
  private textures: T.Texture[] = [];
  private observer: ResizeObserver;
  private disposed = false;
  private preview: T.Mesh;
  private selected = new T.Mesh(
    new T.TorusGeometry(0.31, 0.012, 6, 48),
    new T.MeshBasicMaterial({ color: 0xc99a36, transparent: true, opacity: 0.8, depthTest: false }),
  );
  private fitDistance = 24;
  private raycaster = new T.Raycaster();
  private interactionPlane = new T.Plane(new T.Vector3(0, 0, 1), -0.6);
  private selection: number | null = null;
  private fitTarget = new T.Vector3(0, 0.65, 0);
  private direction = new T.Vector3(0.2, 0.1, 1).normalize();
  constructor(
    readonly container: HTMLElement,
    readonly world: PlantWorld,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.07;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0xb2bb98);
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    container.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableRotate = false;
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.PAN,
    };
    this.controls.touches = { ONE: null, TWO: T.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => this.clampCamera());
    this.environment();
    const bulbMap = bulbTexture(),
      leafMap = leafTexture(),
      standardMap = petalTexture(),
      fallMap = petalTexture(true);
    this.textures.push(bulbMap, leafMap, standardMap, fallMap);
    const bulbMaterial = new T.MeshStandardMaterial({
      map: bulbMap,
      bumpMap: bulbMap,
      bumpScale: 0.018,
      roughness: 0.94,
    });
    const rootMaterial = new T.MeshStandardMaterial({ color: 0xe8ddc0, roughness: 0.87 });
    const foliage = leafMaterial(leafMap),
      standards = leafMaterial(standardMap),
      falls = leafMaterial(fallMap);
    standards.emissive.setHex(0x34265c);
    standards.emissiveIntensity = 0.18;
    falls.emissive.setHex(0x565075);
    falls.emissiveIntensity = 0.12;
    const bulbGeometry = new T.LatheGeometry(
      [
        new T.Vector2(0, -0.28),
        new T.Vector2(0.095, -0.28),
        new T.Vector2(0.09, -0.27),
        new T.Vector2(0.18, -0.18),
        new T.Vector2(0.21, -0.03),
        new T.Vector2(0.16, 0.13),
        new T.Vector2(0.065, 0.24),
        new T.Vector2(0.022, 0.34),
        new T.Vector2(0, 0.36),
      ],
      32,
    );
    const stemGeometry = new T.CylinderGeometry(0.022, 0.041, 1, 12);
    const stemMaterial = new T.MeshStandardMaterial({ color: 0x799552, roughness: 0.7 });
    for (let i = 0; i < MAX_PLANTS; i++) {
      const group = new T.Group(),
        roots = new RootMesh(rootMaterial),
        leaves = new Ribbons(6, foliage);
      const slot: Slot = {
        group,
        bulb: new T.Mesh(bulbGeometry, bulbMaterial),
        stem: new T.Mesh(stemGeometry, stemMaterial),
        roots,
        leaves,
        standards: new Ribbons(3, standards),
        falls: new Ribbons(3, falls),
        arms: new Ribbons(3, standards, 20, 6),
        sheath: new Ribbons(2, foliage, 20, 6),
        revision: -1,
        id: 0,
      };
      group.add(
        slot.bulb,
        slot.stem,
        roots.mesh,
        leaves.mesh,
        slot.standards.mesh,
        slot.falls.mesh,
        slot.arms.mesh,
        slot.sheath.mesh,
      );
      slot.bulb.castShadow = true;
      slot.stem.castShadow = true;
      group.visible = false;
      this.scene.add(group);
      this.slots.push(slot);
    }
    this.preview = new T.Mesh(
      bulbGeometry,
      new T.MeshBasicMaterial({
        color: 0xc99a36,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        depthTest: false,
      }),
    );
    this.preview.scale.z = 0.55;
    const bandGeometry = new T.BufferGeometry().setFromPoints([
      new T.Vector3(-5.6, -0.65, 0.72),
      new T.Vector3(5.6, -0.65, 0.72),
      new T.Vector3(-5.6, -1.2, 0.72),
      new T.Vector3(5.6, -1.2, 0.72),
    ]);
    const band = new T.LineSegments(
      bandGeometry,
      new T.LineDashedMaterial({
        color: 0xc99a36,
        transparent: true,
        opacity: 0.23,
        dashSize: 0.07,
        gapSize: 0.1,
      }),
    );
    band.computeLineDistances();
    this.scene.add(band);
    this.preview.visible = false;
    this.preview.renderOrder = 4;
    this.selected.visible = false;
    this.selected.renderOrder = 4;
    this.scene.add(this.preview, this.selected);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.fit();
  }
  private environment() {
    const garden = gardenTexture(),
      soil = soilTexture();
    this.textures.push(garden, soil);
    soil.repeat.set(2, 1);
    const bg = new T.Mesh(new T.PlaneGeometry(70, 45), new T.MeshBasicMaterial({ map: garden }));
    bg.position.set(0, 6, -6);
    this.scene.add(bg);
    const earthMaterial = new T.MeshStandardMaterial({
      map: soil,
      bumpMap: soil,
      bumpScale: 0.055,
      roughness: 1,
      color: 0x9c8b75,
    });
    const earth = new T.Mesh(new T.BoxGeometry(12, 4, 1.28, 120, 1, 1), earthMaterial);
    earth.position.set(0, -2, -0.08);
    earth.receiveShadow = true;
    this.scene.add(earth);
    const rng = seededRandom(237),
      dummy = new T.Object3D(),
      color = new T.Color();
    const clumps = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 1),
      new T.MeshStandardMaterial({ roughness: 1 }),
      5200,
    );
    for (let i = 0; i < 5200; i++) {
      const top = i < 1200,
        r = 0.012 + rng() ** 2 * 0.065;
      dummy.position.set(
        (rng() - 0.5) * 11.96,
        top ? -0.015 + rng() * 0.05 : -rng() * 3.96,
        top ? -0.64 + rng() * 1.25 : 0.56 + rng() * 0.045,
      );
      dummy.scale.set(r * (0.6 + rng()), r * 0.55, r * 0.5);
      dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      dummy.updateMatrix();
      clumps.setMatrixAt(i, dummy.matrix);
      color.setHSL(0.065, 0.25 + rng() * 0.2, 0.045 + rng() * 0.065);
      clumps.setColorAt(i, color);
    }
    clumps.castShadow = true;
    clumps.receiveShadow = true;
    this.scene.add(clumps);
    const stones = new T.InstancedMesh(
      new T.IcosahedronGeometry(1, 2),
      new T.MeshStandardMaterial({ color: 0x706557, roughness: 0.92 }),
      this.world.soil.stones.length,
    );
    this.world.soil.stones.forEach((s, i) => {
      dummy.position.set(...s.position);
      dummy.scale.set(s.radius, s.radius, s.radius * 0.55);
      dummy.rotation.set(i, i * 0.8, i * 0.3);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
    });
    stones.castShadow = true;
    stones.receiveShadow = true;
    this.scene.add(stones);
    // Sparse fibres sit between the roots and the glass to establish soil contact.
    const fibres: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const x = (rng() - 0.5) * 12,
        y = -rng() * 4,
        z = 0.66;
      fibres.push(x, y, z, x + 0.025 + rng() * 0.07, y + 0.02 - rng() * 0.04, z);
    }
    const fibreGeo = new T.BufferGeometry();
    fibreGeo.setAttribute('position', new T.Float32BufferAttribute(fibres, 3));
    this.scene.add(
      new T.LineSegments(
        fibreGeo,
        new T.LineBasicMaterial({ color: 0x7b6445, transparent: true, opacity: 0.3 }),
      ),
    );
    const glass = new T.MeshPhysicalMaterial({
      color: 0xdcece4,
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
      side: T.DoubleSide,
    });
    const edgeMaterial = new T.MeshStandardMaterial({
      color: 0x9ebdb0,
      roughness: 0.18,
      metalness: 0.2,
      transparent: true,
      opacity: 0.65,
    });
    for (const [size, pos] of [
      [
        [12.12, 4.16, 0.035],
        [0, -1.96, 0.78],
      ],
      [
        [12.12, 4.16, 0.035],
        [0, -1.96, -0.7],
      ],
      [
        [0.035, 4.16, 1.48],
        [-6.04, -1.96, 0.04],
      ],
      [
        [0.035, 4.16, 1.48],
        [6.04, -1.96, 0.04],
      ],
      [
        [12.12, 0.06, 1.48],
        [0, -4.04, 0.04],
      ],
    ]) {
      const mesh = new T.Mesh(new T.BoxGeometry(...(size as [number, number, number])), glass);
      mesh.position.set(...(pos as Point));
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      const edges = new T.LineSegments(
        new T.EdgesGeometry(mesh.geometry),
        new T.LineBasicMaterial({ color: 0xddece1, transparent: true, opacity: 0.65 }),
      );
      edges.position.copy(mesh.position);
      edges.renderOrder = 4;
      this.scene.add(edges);
    }
    const base = new T.Mesh(new T.BoxGeometry(12.18, 0.07, 1.5), edgeMaterial);
    base.position.set(0, -4.07, 0.04);
    this.scene.add(base);
    const ground = new T.Mesh(
      new T.PlaneGeometry(90, 90),
      new T.MeshStandardMaterial({ color: 0xd4c6aa, roughness: 0.94 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -4.14;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.add(new T.HemisphereLight(0xf5f0d9, 0x675a45, 2.1));
    const sun = new T.DirectionalLight(0xfff0d6, 3.2);
    sun.position.set(-7, 10, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -9,
      right: 9,
      top: 10,
      bottom: -7,
      near: 0.1,
      far: 40,
    });
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.015;
    this.scene.add(sun);
    const back = new T.DirectionalLight(0xdfe9bd, 1.5);
    back.position.set(3, 7, -3);
    this.scene.add(back);
  }
  private update(slot: Slot, p: IrisPlant) {
    slot.bulb.position.set(...p.position);
    slot.bulb.scale.set(1, 1, 0.55);
    // Keep the basal plate aligned with the model root origins.
    slot.bulb.rotation.set(0, 0, 0);
    const force = slot.revision < 0 || slot.id !== p.id;
    if (force || slot.rootRevision !== p.rootRevision) {
      slot.roots.update(p);
      slot.rootRevision = p.rootRevision;
    }
    const x = p.position[0],
      z = p.position[2],
      baseY = p.position[1] + 0.24;
    const stemHeight = Math.max(p.shoot, p.stalk);
    slot.stem.visible = stemHeight > 0.001;
    slot.stem.position.set(x, baseY + stemHeight / 2, z);
    slot.stem.scale.y = stemHeight;
    const leafGrowth = p.leaves.reduce((sum, leaf) => sum + leaf.length, 0);
    slot.leaves.mesh.visible = leafGrowth > 0;
    if (slot.leaves.mesh.visible && (force || slot.leafGrowth !== leafGrowth))
      slot.leaves.update((n, u, v) => {
        const leaf = p.leaves[n],
          length = leaf.length;
        const phi = p.rotation * 0.25 + n * 0.23,
          side = n % 2 ? 1 : -1;
        const spread = side * (0.15 + leaf.lean) * length * u * u;
        const width = leaf.width * Math.sin(Math.PI * u) ** 0.45 * (1 - u * 0.35);
        const y = baseY + length * u * 0.98;
        return [
          x + spread * Math.cos(phi) + v * width * Math.cos(phi),
          y - Math.abs(spread) * 0.15,
          z +
            spread * Math.sin(phi) * 0.5 +
            v * width * Math.sin(phi) +
            Math.abs(v) * 0.025 * Math.sin(Math.PI * u),
        ];
      });
    slot.leafGrowth = leafGrowth;
    const flowerBase: Point = [x, baseY + p.stalk, z];
    const scale = 0.15 + 0.85 * p.bud,
      open = smooth(p.opening, 0, 1);
    function petal(n: number, u: number, v: number, kind: 'standard' | 'fall' | 'arm'): Point {
      const angle =
        (p.rotation - 3.14) * 0.12 +
        (n * Math.PI * 2) / 3 +
        (kind === 'standard' ? Math.PI / 3 : 0);
      let radial: number, y: number, width: number;
      if (kind === 'standard') {
        radial = 0.05 + u * (0.045 + 0.29 * open);
        y = u * 0.87 - 0.07 * open * u * u;
        width = 0.28 * Math.sin(Math.PI * u) ** 0.7 * (0.15 + 0.85 * open);
      } else if (kind === 'fall') {
        radial = 0.025 + u * (0.045 + 0.9 * open);
        y = u * 0.78 * (1 - open) + open * (0.17 * Math.sin(Math.PI * u) - 0.48 * u * u);
        width = 0.34 * Math.sin(Math.PI * u) ** 0.7 * (0.12 + 0.88 * open);
      } else {
        radial = 0.025 + u * (0.04 + 0.43 * open);
        y = u * 0.55 * (1 - open) + open * (0.2 + 0.18 * Math.sin(Math.PI * u) - 0.12 * u);
        width = 0.11 * Math.sin(Math.PI * u) ** 0.7 * (0.2 + 0.8 * open);
      }
      const ripple = 0.018 * Math.sin(u * 30 + n) * v * v * open;
      return [
        flowerBase[0] + scale * (Math.sin(angle) * radial + Math.cos(angle) * v * width),
        flowerBase[1] + scale * (y + ripple),
        flowerBase[2] + scale * (Math.cos(angle) * radial - Math.sin(angle) * v * width),
      ];
    }
    slot.standards.mesh.visible = slot.falls.mesh.visible = slot.arms.mesh.visible = p.bud > 0.18;
    const flowerGrowth = p.stalk + p.bud + p.opening;
    const flowerChanged = force || slot.flowerGrowth !== flowerGrowth;
    if (slot.standards.mesh.visible && flowerChanged) {
      slot.standards.update((n, u, v) => petal(n, u, v, 'standard'));
      slot.falls.update((n, u, v) => petal(n, u, v, 'fall'));
      slot.arms.update((n, u, v) => petal(n, u, v, 'arm'));
    }
    slot.sheath.mesh.visible = p.bud > 0.01;
    if (slot.sheath.mesh.visible && flowerChanged)
      slot.sheath.update((n, u, v) => {
        const phi = p.rotation + n * Math.PI,
          radial = (0.1 * Math.sin(Math.PI * u) + open * 0.25 * u) * scale,
          width = 0.12 * Math.sin(Math.PI * u);
        return [
          x + Math.cos(phi) * radial + Math.sin(phi) * v * width,
          flowerBase[1] + u * 0.82 * scale * (1 - open * 0.6),
          z + Math.sin(phi) * radial - Math.cos(phi) * v * width,
        ];
      });
    slot.flowerGrowth = flowerGrowth;
    slot.revision = p.revision;
    slot.id = p.id;
  }
  private resize() {
    this.camera.aspect =
      Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.fit();
  }
  fit() {
    const halfHeight = 5.4,
      halfWidth = 6.6,
      tan = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
    this.fitDistance = Math.max(halfHeight / tan, halfWidth / (tan * this.camera.aspect)) * 1.1;
    this.camera.far = Math.max(100, this.fitDistance * 3);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = this.fitDistance / 4;
    this.controls.maxDistance = this.fitDistance * 1.1;
    this.controls.target.copy(this.fitTarget);
    this.camera.position.copy(this.fitTarget).addScaledVector(this.direction, this.fitDistance);
    this.controls.update();
  }
  private clampCamera() {
    const target = this.controls.target,
      delta = new T.Vector3(
        clamp(target.x, -6, 6) - target.x,
        clamp(target.y, -3, 5) - target.y,
        -target.z,
      );
    target.add(delta);
    this.camera.position.add(delta);
  }
  pointAt(clientX: number, clientY: number): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(
      new T.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const point = this.raycaster.ray.intersectPlane(this.interactionPlane, new T.Vector3());
    return point ? [point.x, point.y, 0.6] : null;
  }
  project(point: Point) {
    const p = new T.Vector3(...point).project(this.camera);
    return {
      x: ((p.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - p.y) / 2) * this.container.clientHeight,
    };
  }
  pick(clientX: number, clientY: number): number | null {
    this.pointAt(clientX, clientY);
    this.scene.updateMatrixWorld(true);
    const objects = this.slots
      .filter((s) => s.group.visible)
      .flatMap((s) => [s.bulb, s.stem, s.leaves.mesh, s.standards.mesh, s.falls.mesh]);
    const hit = this.raycaster.intersectObjects(objects, false).find((h) => h.object.visible);
    if (!hit) return null;
    return this.slots.find((s) => s.group === hit.object.parent)?.id || null;
  }
  showPreview(point: Point | null) {
    this.preview.visible = !!point;
    if (point) {
      this.preview.position.set(...point);
      (this.preview.material as T.MeshBasicMaterial).color.setHex(
        this.world.canPlant(point).ok ? 0xc99a36 : 0xa9523c,
      );
    }
  }
  select(id: number | null) {
    this.selection = id;
  }
  invalidate() {
    for (const s of this.slots) s.revision = -1;
    this.renderer.shadowMap.needsUpdate = true;
  }
  render() {
    if (this.disposed) return;
    let changed = false;
    this.slots.forEach((slot, i) => {
      const p = this.world.plants[i];
      if (!p) {
        if (slot.group.visible) changed = true;
        slot.group.visible = false;
        slot.revision = -1;
        return;
      }
      slot.group.visible = true;
      if (slot.revision !== p.revision || slot.id !== p.id) {
        this.update(slot, p);
        changed = true;
      }
    });
    const selected = this.world.plants.find((p) => p.id === this.selection);
    this.selected.visible = !!selected;
    if (selected) this.selected.position.set(selected.position[0], selected.position[1], 0.8);
    if (changed) this.renderer.shadowMap.needsUpdate = true;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  stats() {
    return {
      camera: this.camera.position.toArray(),
      zoom: this.fitDistance / this.camera.position.distanceTo(this.controls.target),
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.LineSegments) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
      }
      if (o instanceof T.DirectionalLight) o.shadow.dispose();
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
