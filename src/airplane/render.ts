import * as T from 'three';
import { AirplaneWorld } from './physics';
import { AirfieldScenery } from './scenery';
import { FlightCamera } from './camera';

export class AirplaneRenderer {
  readonly renderer = new T.WebGLRenderer({ antialias: true });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(38, 1, 0.05, 12000);
  readonly plane = new T.Group();
  private propeller = new T.Group();
  private displayedTime = 0;
  private elevator = new T.Group();
  private rudder = new T.Group();
  private ailerons: T.Group[] = [];
  private observer: ResizeObserver;
  readonly flightCamera: FlightCamera;
  private light = false;
  private sun = new T.DirectionalLight(0xffefd4, 3);
  private materials = new Map<number, T.MeshStandardMaterial>();
  private geometries = new Set<T.BufferGeometry>();
  private scenery: AirfieldScenery;

  constructor(
    readonly container: HTMLElement,
    readonly world: AirplaneWorld,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.append(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;
    this.scene.background = new T.Color(0xc8e2e9);
    this.scene.fog = new T.Fog(0xc8e2e9, 180, 1400);
    this.scene.add(new T.HemisphereLight(0xe2f5ff, 0x73874a, 2.1));
    this.sun.position.set(-35, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -100,
      right: 100,
      top: 90,
      bottom: -90,
      near: 1,
      far: 220,
    });
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
    this.scenery = new AirfieldScenery(this.scene);
    this.model();
    this.scene.add(this.plane);
    this.flightCamera = new FlightCamera(this.camera, this.scenery.cameraObstacles);
    this.resetCamera();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }
  private material(color: number) {
    if (!this.materials.has(color))
      this.materials.set(color, new T.MeshStandardMaterial({ color, roughness: 0.72 }));
    return this.materials.get(color)!;
  }
  private mesh(geometry: T.BufferGeometry, color: number, parent: T.Object3D, x = 0, y = 0, z = 0) {
    this.geometries.add(geometry);
    const mesh = new T.Mesh(geometry, this.material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private box(parent: T.Object3D, color: number, size: number[], position: number[]) {
    return this.mesh(
      new T.BoxGeometry(...(size as [number, number, number])),
      color,
      parent,
      ...(position as [number, number, number]),
    );
  }
  private rod(parent: T.Object3D, a: number[], b: number[], radius: number, color: number) {
    const from = new T.Vector3(...(a as [number, number, number])),
      to = new T.Vector3(...(b as [number, number, number]));
    const mesh = this.mesh(
      new T.CylinderGeometry(radius, radius, from.distanceTo(to), 8),
      color,
      parent,
    );
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.sub(from).normalize());
    return mesh;
  }
  private model() {
    const yellow = 0xf4c52d,
      dark = 0x263b39;
    // Tapered fuselage loft, with a broad cabin and slender tail.
    const stations = [
      [-1.04, 0.015, 0.04],
      [-0.65, 0.08, 0.08],
      [-0.22, 0.13, 0.14],
      [0.35, 0.12, 0.16],
      [0.63, 0.1, 0.12],
      [0.8, 0.075, 0.08],
    ];
    const vertices: number[] = [],
      indices: number[] = [];
    for (const [x, h, w] of stations)
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        vertices.push(x, Math.cos(a) * h, Math.sin(a) * w);
      }
    for (let i = 0; i < stations.length - 1; i++)
      for (let j = 0; j < 8; j++) {
        const a = i * 8 + j,
          b = i * 8 + ((j + 1) % 8);
        indices.push(a, b, a + 8, b, b + 8, a + 8);
      }
    const fuselage = new T.BufferGeometry();
    fuselage.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    fuselage.setIndex(indices);
    fuselage.computeVertexNormals();
    this.mesh(fuselage, yellow, this.plane);
    this.box(this.plane, 0x49747b, [0.43, 0.23, 0.255], [0.03, 0.16, 0]);
    for (const x of [-0.18, 0.22])
      for (const z of [-0.14, 0.14])
        this.rod(this.plane, [x, 0.03, z], [x - 0.04, 0.29, z], 0.014, yellow);
    for (const side of [-1, 1]) {
      const wing = new T.Group();
      wing.position.set(0.04, 0.29, 0);
      wing.rotation.x = -side * 0.035;
      this.plane.add(wing);
      this.box(wing, yellow, [0.38, 0.045, 1.1], [0.03, 0, side * 0.55]);
      // Dark bars underneath help distinguish inverted flight.
      for (const z of [0.65, 0.88])
        this.box(wing, dark, [0.36, 0.005, 0.09], [0.03, -0.026, side * z]);
      const aileron = new T.Group();
      aileron.position.set(-0.16, 0, side * 0.78);
      wing.add(aileron);
      this.box(aileron, yellow, [0.09, 0.027, 0.6], [-0.045, 0, 0]);
      this.ailerons.push(aileron);
      this.rod(this.plane, [0.12, -0.04, side * 0.1], [0.05, 0.3, side * 0.88], 0.009, dark);
      this.rod(this.plane, [0.24, -0.08, side * 0.11], [0.2, -0.28, side * 0.32], 0.015, dark);
      const wheel = this.mesh(
        new T.CylinderGeometry(0.1, 0.1, 0.065, 18),
        dark,
        this.plane,
        0.2,
        -0.28,
        side * 0.32,
      );
      wheel.rotation.x = Math.PI / 2;
      const hub = this.mesh(
        new T.CylinderGeometry(0.041, 0.041, 0.068, 12),
        0xc9c5b9,
        this.plane,
        0.2,
        -0.28,
        side * 0.32,
      );
      hub.rotation.x = Math.PI / 2;
      this.box(this.plane, dark, [0.62, 0.035, 0.003], [-0.42, 0.012, side * 0.09]);
    }
    this.box(this.plane, yellow, [0.22, 0.025, 0.67], [-0.84, 0.05, 0]);
    this.elevator.position.set(-0.95, 0.05, 0);
    this.plane.add(this.elevator);
    this.box(this.elevator, yellow, [0.12, 0.023, 0.65], [-0.06, 0, 0]);
    this.box(this.plane, yellow, [0.18, 0.32, 0.025], [-0.86, 0.2, 0]);
    this.rudder.position.set(-0.95, 0.2, 0);
    this.plane.add(this.rudder);
    this.box(this.rudder, yellow, [0.13, 0.32, 0.023], [-0.065, 0, 0]);
    const tailWheel = this.mesh(
      new T.CylinderGeometry(0.044, 0.044, 0.035, 12),
      dark,
      this.plane,
      -0.95,
      -0.126,
      0,
    );
    tailWheel.rotation.x = Math.PI / 2;
    this.rod(this.plane, [-0.9, 0, 0], [-0.95, -0.126, 0], 0.01, dark);
    this.propeller.position.x = 0.82;
    this.plane.add(this.propeller);
    this.box(this.propeller, dark, [0.025, 0.61, 0.038], [0, 0, 0]);
    this.mesh(new T.SphereGeometry(0.065, 12, 8), yellow, this.plane, 0.84, 0, 0);
  }
  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }
  resetCamera() {
    this.flightCamera.reset(this.world.position, this.world.orientation);
  }
  toggleCamera() {
    this.flightCamera.setMode(
      this.flightCamera.mode === 'ground' ? 'chase' : 'ground',
      this.world.position,
      this.world.orientation,
    );
  }
  quality(light: boolean) {
    this.light = light;
    this.scenery.quality(light);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, light ? 1 : 1.6));
    this.renderer.shadowMap.enabled = !light;
    this.sun.castShadow = !light;
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
    this.resize();
  }
  render(dt: number) {
    this.plane.position.copy(this.world.position);
    this.plane.quaternion.copy(this.world.orientation);
    const elapsed = this.world.time - this.displayedTime;
    this.propeller.rotation.x =
      elapsed < 0
        ? 0
        : (this.propeller.rotation.x + elapsed * this.world.surfaces.throttle * 105) %
          (Math.PI * 2);
    this.displayedTime = this.world.time;
    this.elevator.rotation.z = -this.world.surfaces.pitch * 0.35;
    this.rudder.rotation.y = this.world.surfaces.yaw * 0.4;
    this.ailerons.forEach((a, i) => (a.rotation.z = this.world.surfaces.roll * (i ? -0.32 : 0.32)));
    this.flightCamera.update(this.world.position, this.world.orientation, dt);
    this.renderer.render(this.scene, this.camera);
  }
  stats() {
    const p = this.world.position.clone().project(this.camera);
    return {
      ...this.flightCamera.stats(),
      cameraPosition: this.camera.position.toArray(),
      cameraUp: this.camera.up.toArray(),
      fov: this.camera.fov,
      projected: p.toArray(),
      light: this.light,
      scenery: this.scenery.stats(),
      memory: { ...this.renderer.info.memory },
      calls: this.renderer.info.render.calls,
    };
  }
  dispose() {
    this.observer.disconnect();
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.scenery.dispose();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
