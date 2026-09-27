import { t } from '../i18n';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AquariumWorld, WIDTH, DEPTH, WATER_Y, TANK_HEIGHT, NX, NZ } from './physics';
import { KoiVisuals } from './koi-assets';
import { UnderwaterLighting } from './underwater';
import { WaterReflection, waterReflectionFragment } from './reflection';
import {
  AquariumLighting,
  LAMP_POSITION,
  LAMP_COLOR,
  LAMP_INTENSITY,
  SUN_INTENSITY,
} from './lighting';
import { AquariumSurface } from './surface-field';
import { AquariumOptics } from './optics';
import { AquariumGpuTiming } from './gpu-timing';
import { EfficientCaustics, rasterWaterVertex } from './efficient';
import { AquariumFrameSchedule, type AquariumMode } from './mode';

export class AquariumRenderer {
  readonly lighting = new AquariumLighting();
  private pending = Promise.resolve();
  private preparations = new Set<Promise<void>>();
  get ready() {
    return this.pending;
  }
  mode: AquariumMode = 'high';
  private generation = 0;
  private disposed = false;
  private supported = false;
  private dirty = true;
  private frames = 0;
  private schedule = new AquariumFrameSchedule();
  private lastEffects = -Infinity;
  private lastState = '';
  private efficient!: EfficientCaustics;
  private cpuMs = 0;
  private cpuTotalMs = 0;
  private timing?: AquariumGpuTiming;
  readonly renderer = new T.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(36, 1, 0.1, 80);
  readonly controls: OrbitControls;
  readonly water: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  readonly koi: KoiVisuals;
  private glass = new T.Group();
  private sides = new T.Group();
  private ballMeshes = new Map<number, T.Mesh<T.SphereGeometry, T.MeshPhysicalMaterial>>();
  private environment: T.WebGLRenderTarget;
  private observer: ResizeObserver;
  private raycaster = new T.Raycaster();
  private pointer = new T.Vector2();
  private waterPlane = new T.Plane(new T.Vector3(0, 1, 0), -WATER_Y);
  private hit = new T.Vector3();
  private lowQuality = false;
  private reflection = new WaterReflection();
  private surface = new AquariumSurface();
  private optics?: AquariumOptics;
  private floor!: T.Mesh;
  private sun = new T.DirectionalLight(0xffffff, 3);
  private fill = new T.HemisphereLight(0xd6e8ff, 0x162a30, 0.4);
  private lamp = new T.SpotLight(0xffbf7d, 0, 12, Math.acos(0.55), 0.5, 2);
  private lampEmitter!: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>;
  private lightingRevision = -1;
  private fallbackLight = { value: 1 };

  constructor(
    readonly container: HTMLElement,
    readonly world: AquariumWorld,
    options: { forceRaster?: boolean; mode?: AquariumMode } = {},
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.supported = !options.forceRaster && AquariumOptics.supported(this.renderer);
    if (this.supported) this.surface.enableGPU();
    this.efficient = new EfficientCaustics(this.surface.texture, this.supported);
    if (import.meta.env.DEV)
      this.timing = new AquariumGpuTiming(this.renderer.getContext() as WebGL2RenderingContext);
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      t('Interactive aquarium. Drag: waves. Right-drag: orbit. Scroll: zoom.'),
    );
    container.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.addEventListener('change', () => {
      this.dirty = true;
    });
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 19;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.36;
    this.controls.mouseButtons = {
      LEFT: null as unknown as T.MOUSE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
    this.resetCamera();
    const room = new RoomEnvironment(),
      pmrem = new T.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.8;
    room.dispose();
    pmrem.dispose();
    this.scene.add(this.sun, this.fill, this.lamp);
    this.lamp.position.set(...LAMP_POSITION);
    this.lamp.target.position.set(LAMP_POSITION[0], 0, LAMP_POSITION[2]);
    this.scene.add(this.lamp.target);
    for (const source of [this.sun, this.lamp]) {
      source.shadow.mapSize.set(512, 512);
      source.shadow.bias = -0.0003;
      source.shadow.normalBias = 0.015;
      source.shadow.camera.near = 0.1;
      source.shadow.camera.far = 30;
    }
    Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 3, bottom: -3 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.lampEmitter = new T.Mesh(
      new T.SphereGeometry(0.105, 16, 10),
      new T.MeshBasicMaterial({ color: 0xffbd73 }),
    );
    this.lampEmitter.position.copy(this.lamp.position);
    this.scene.add(this.lampEmitter);
    const shade = new T.Mesh(
      new T.CylinderGeometry(0.18, 0.29, 0.17, 24, 1, true),
      new T.MeshStandardMaterial({
        color: 0x294547,
        metalness: 0.65,
        roughness: 0.28,
        side: T.DoubleSide,
      }),
    );
    shade.position.copy(this.lamp.position).add(new T.Vector3(0, 0.12, 0));
    this.scene.add(shade);
    const cable = new T.Mesh(
      new T.CylinderGeometry(0.009, 0.009, 2, 6),
      new T.MeshStandardMaterial({ color: 0x243236 }),
    );
    cable.position.copy(this.lamp.position).add(new T.Vector3(0, 1.2, 0));
    this.scene.add(cable);
    const underwaterLighting = new UnderwaterLighting(this.surface.texture, this.efficient.uniform);
    this.koi = new KoiVisuals(world.koi, (m) => underwaterLighting.prepare(m));
    this.scene.add(this.koi.group);
    const floorMaterial = new T.MeshStandardMaterial({ color: 0xb6a580, roughness: 0.95 });
    underwaterLighting.prepare(floorMaterial, true);
    const floor = new T.Mesh(new T.BoxGeometry(WIDTH, 0.14, DEPTH), floorMaterial);
    floor.name = 'Sand bed';
    floor.receiveShadow = true;
    floor.position.y = -0.07;
    this.floor = floor;
    this.scene.add(floor);
    const plinth = new T.Mesh(
      new RoundedBoxGeometry(6.28, 0.28, 3.88, 3, 0.06),
      new T.MeshStandardMaterial({ color: 0x1e3b40, roughness: 0.28, metalness: 0.4 }),
    );
    plinth.position.y = -0.22;
    this.scene.add(plinth);
    const trim = new T.Mesh(
      new RoundedBoxGeometry(6.32, 0.045, 3.92, 2, 0.02),
      new T.MeshStandardMaterial({ color: 0x8da4a0, roughness: 0.3, metalness: 0.65 }),
    );
    trim.position.y = -0.36;
    this.scene.add(trim);
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(0,0,0,.65)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadow = new T.Mesh(
      new T.PlaneGeometry(10, 7),
      new T.MeshBasicMaterial({
        map: new T.CanvasTexture(shadowCanvas),
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.4;
    this.scene.add(shadow);

    // Glass remains optically subtle, with solid edges that keep the tank readable.
    const glassMaterial = new T.MeshPhysicalMaterial({
      color: 0xb3ecdf,
      transparent: true,
      opacity: 0.075,
      roughness: 0.06,
      metalness: 0.1,
      side: T.DoubleSide,
      depthWrite: false,
    });
    for (const z of [-DEPTH / 2, DEPTH / 2]) {
      const mesh = new T.Mesh(new T.PlaneGeometry(WIDTH, TANK_HEIGHT), glassMaterial);
      mesh.position.set(0, TANK_HEIGHT / 2, z);
      this.glass.add(mesh);
    }
    for (const x of [-WIDTH / 2, WIDTH / 2]) {
      const mesh = new T.Mesh(new T.PlaneGeometry(DEPTH, TANK_HEIGHT), glassMaterial);
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(x, TANK_HEIGHT / 2, 0);
      this.glass.add(mesh);
    }
    const edgeBox = new T.BoxGeometry(WIDTH + 0.025, TANK_HEIGHT, DEPTH + 0.025);
    const edges = new T.LineSegments(
      new T.EdgesGeometry(edgeBox),
      new T.LineBasicMaterial({ color: 0xc5eee5, transparent: true, opacity: 0.44 }),
    );
    edgeBox.dispose();
    edges.position.y = TANK_HEIGHT / 2;
    this.glass.add(edges);
    this.scene.add(this.glass);
    const waterGeometry = new T.PlaneGeometry(WIDTH, DEPTH, NX - 1, NZ - 1);
    waterGeometry.rotateX(-Math.PI / 2);
    // PlaneGeometry's rows run from -z to +z after rotation, matching the solver.
    this.water = new T.Mesh(
      waterGeometry,
      new T.ShaderMaterial({
        vertexShader: rasterWaterVertex,
        fragmentShader: waterReflectionFragment,
        uniforms: {
          surfaceMap: { value: this.surface.texture },
          sideSurface: { value: 0 },
          reflectionMap: { value: this.reflection.texture },
          reflectionMatrix: { value: this.reflection.matrix },
          reflectionView: { value: this.reflection.viewMatrix },
        },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    this.water.position.y = WATER_Y;
    this.water.frustumCulled = false;
    this.water.renderOrder = 2;
    this.scene.add(this.water);
    // Each side's upper edge uses the same live height field as the surface.
    for (let side = 0; side < 4; side++) {
      const count = side < 2 ? NX : NZ,
        positions = new Float32Array(count * 6),
        indices: number[] = [];
      for (let i = 0; i < count; i++) {
        const x =
          side < 2 ? -WIDTH / 2 + (i * WIDTH) / (count - 1) : side === 2 ? -WIDTH / 2 : WIDTH / 2;
        const z =
          side < 2 ? (side === 0 ? -DEPTH / 2 : DEPTH / 2) : -DEPTH / 2 + (i * DEPTH) / (count - 1);
        positions.set([x, 0, z, x, WATER_Y, z], i * 6);
        if (i < count - 1)
          indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(positions, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new T.ShaderMaterial({
        vertexShader: rasterWaterVertex,
        fragmentShader: `
        varying vec3 vWorld;varying vec3 vNormal;uniform float lightLevel;
        void main(){float depth=clamp(1.-vWorld.y/1.65,0.,1.);
          vec3 color=mix(vec3(.10,.33,.35),vec3(.025,.13,.17),depth)*lightLevel;
          gl_FragColor=vec4(color,.055+depth*.09);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        uniforms: {
          surfaceMap: { value: this.surface.texture },
          sideSurface: { value: 1 },
          lightLevel: this.fallbackLight,
        },
        transparent: true,
        side: T.DoubleSide,
        depthWrite: false,
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.userData.side = side;
      mesh.renderOrder = 3;
      this.sides.add(mesh);
    }
    this.scene.add(this.sides);
    this.glass.renderOrder = 4;
    this.glass.children.forEach((m) => (m.renderOrder = 4));
    if (!this.supported) this.reflection.useByteTarget();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.pending = this.setMode(options.mode ?? 'high', false);
  }
  invalidate() {
    this.dirty = true;
    this.optics?.invalidate();
  }
  setMode(mode: AquariumMode, loadAssets = true): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.mode === mode && (mode === 'efficient' || this.optics)) {
      this.invalidate();
      return this.pending;
    }
    const generation = ++this.generation;
    this.mode = mode;
    this.lowQuality = mode === 'efficient' || !this.supported;
    this.optics?.dispose();
    this.optics = undefined;
    if (mode === 'high' && this.supported) this.optics = new AquariumOptics(this.surface.texture);
    this.resize();
    this.invalidate();
    this.lastEffects = -Infinity;
    const optics = this.optics;
    const preparation = optics?.prepare(this.renderer) ?? Promise.resolve();
    this.preparations.add(preparation);
    const complete = () => this.preparations.delete(preparation);
    void preparation.then(complete, complete);
    const assets = loadAssets ? this.koi.load(this.lowQuality) : Promise.resolve();
    this.pending = Promise.all([preparation, assets]).then(() => {
      if (!this.disposed && generation === this.generation) this.invalidate();
    });
    return this.pending;
  }
  resetCamera() {
    this.optics?.invalidate();
    // Flush residual orbit momentum before restoring the initial pose.
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.set(7.7, 6.8, 10.4);
    this.controls.target.set(0, 0.85, 0);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  quality(low: boolean) {
    void this.setMode(low ? 'efficient' : 'high');
  }
  private resize() {
    this.invalidate();
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.fov = w < h ? 48 : 36;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowQuality ? 1 : 1.6));
    this.renderer.setSize(w, h);
    this.reflection.resize(w, h, true);
    this.optics?.resize(
      w * this.renderer.getPixelRatio(),
      h * this.renderer.getPixelRatio(),
      this.lowQuality,
    );
  }
  pick(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      (-(clientY - r.top) / r.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.waterPlane, this.hit)) return null;
    return Math.abs(this.hit.x) <= WIDTH / 2 && Math.abs(this.hit.z) <= DEPTH / 2
      ? { x: this.hit.x, z: this.hit.z }
      : null;
  }
  render(now?: number) {
    const start = performance.now();
    this.controls.update();
    const state = `${this.world.paused}/${this.world.strength}/${this.world.waveMaker}/${this.koi.status}/${this.koi.activeQuality}/${this.lighting.revision}/${this.world.time < this.lastEffects}`;
    if (state !== this.lastState) {
      this.dirty = true;
      this.lastState = state;
    }
    const raster = !this.optics?.ready;
    if (now !== undefined && !this.schedule.due(now, raster, this.world.paused, this.dirty)) return;
    const refresh =
      this.dirty || now === undefined || this.world.time - this.lastEffects >= 1 / 15 - 0.0001;
    this.dirty = false;

    this.timing?.begin();
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.koi.sync();
    const light = this.lighting.snapshot();
    if (this.lightingRevision !== this.lighting.revision) {
      this.optics?.invalidate();
      this.lightingRevision = this.lighting.revision;
    }
    this.sun.position.fromArray(light.sunDirection).multiplyScalar(10);
    this.sun.color.setRGB(...light.color);
    this.sun.intensity = light.sun * SUN_INTENSITY;
    this.fill.intensity = light.ambient * 2;
    this.lamp.color.setRGB(...LAMP_COLOR);
    this.lamp.intensity = light.lamp * LAMP_INTENSITY;
    this.lampEmitter.material.color
      .setRGB(...LAMP_COLOR)
      .multiplyScalar(0.1 + LAMP_INTENSITY * 1.2 * light.lamp);
    this.scene.environmentIntensity = light.ambient;
    this.fallbackLight.value = 0.12 + 0.88 * light.daylight + 0.2 * light.lamp;
    this.container
      .closest<HTMLElement>('.aquarium-app')
      ?.style.setProperty('--aq-day', String(light.daylight));
    this.container
      .closest<HTMLElement>('.aquarium-app')
      ?.style.setProperty('--aq-sunset', String(light.sunset));
    this.surface.update(this.world, this.renderer);
    for (const [id, mesh] of this.ballMeshes)
      if (!this.world.balls.some((b) => b.id === id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this.ballMeshes.delete(id);
      }
    for (const b of this.world.balls) {
      let mesh = this.ballMeshes.get(b.id);
      if (!mesh) {
        mesh = new T.Mesh(
          new T.SphereGeometry(b.radius, 32, 20),
          new T.MeshPhysicalMaterial({ color: b.color, roughness: 0.25, clearcoat: 1 }),
        );
        mesh.castShadow = mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.ballMeshes.set(b.id, mesh);
      }
      mesh.position.set(b.x, b.y, b.z);
    }
    this.renderer.shadowMap.enabled = raster;
    this.sun.castShadow = raster && light.sun > 0;
    this.lamp.castShadow = raster && light.lamp > 0;
    this.koi.group.traverse((o) => {
      if ((o as T.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (this.optics?.ready)
      this.optics.render(
        this.renderer,
        this.scene,
        this.camera,
        this.world,
        light,
        this.koi.group,
        [
          this.water,
          this.sides,
          ...this.glass.children.filter((o) => !(o as T.LineSegments).isLineSegments),
          this.floor,
          this.koi.group,
          ...this.ballMeshes.values(),
        ],
      );
    else {
      if (refresh) {
        this.efficient.render(this.renderer, this.world, light);
        // Reflector suppresses shadow updates, so generate the active shadow in the main pass.
        this.reflection.render(
          this.renderer,
          this.scene,
          this.camera,
          this.water,
          this.sides,
          light,
          this.koi.group,
        );
        this.renderer.shadowMap.needsUpdate = true;
        this.lastEffects = this.world.time;
      }
      this.renderer.render(this.scene, this.camera);
    }
    this.timing?.end();
    this.frames++;
    this.cpuMs = performance.now() - start;
    this.cpuTotalMs += this.cpuMs;
  }
  renderingSnapshot() {
    return {
      ...(this.optics?.ready
        ? this.optics.snapshot()
        : {
            mode: this.supported ? 'raster-efficient' : 'raster-fallback',
            ready: true,
            quality: 'efficient',
            volumeSlices: 0,
            scatteringSamples: 0,
            passes: ['surface', 'floor-caustics-15hz', 'reflection-15hz', 'shadow-15hz', 'raster'],
          }),
      requestedMode: this.mode,
      activeMode: this.optics?.ready ? 'high' : 'efficient',
      frames: this.frames,
      frameLimit: this.optics?.ready ? null : 30,
      bvh: !!this.optics,
      causticUpdates: this.efficient.updates,
      cpuSubmitMs: this.cpuMs,
      cpuTotalMs: this.cpuTotalMs,
      gpu: this.timing?.snapshot(),
    };
  }
  readOpticalHits() {
    if (import.meta.env.DEV) return this.optics?.readHits(this.renderer);
  }
  readOpticalCaustics() {
    if (import.meta.env.DEV)
      return this.optics?.ready
        ? this.optics.readCaustics(this.renderer)
        : this.efficient.read(this.renderer);
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.koi.dispose();
    this.scene.remove(this.koi.group);
    this.observer.disconnect();
    this.controls.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      const mesh = o as T.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          materials.add(m);
    });
    for (const m of materials) {
      const map = (m as T.MeshBasicMaterial).map;
      if (map) textures.add(map);
      m.dispose();
    }
    geometries.forEach((g) => g.dispose());
    textures.forEach((t) => t.dispose());
    this.timing?.dispose();
    this.efficient.dispose();
    this.sun.shadow.dispose();
    this.lamp.shadow.dispose();
    this.optics?.dispose();
    this.surface.dispose();
    this.reflection.dispose();
    this.environment.dispose();
    // Preserve material properties used by any outstanding compileAsync poll.
    void Promise.allSettled([...this.preparations]).then(() => this.renderer.dispose());
    this.renderer.domElement.remove();
  }
}
