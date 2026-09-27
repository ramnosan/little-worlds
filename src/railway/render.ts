import { t } from '../i18n';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  AXLE_OFFSET,
  RailwayWorld,
  WHEEL_RADIUS,
  MODEL_SCALE,
  ROUTE_SECTIONS,
  trackPose,
} from './physics';
import { GAUGE, RailwayScenery } from './scenery';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RailwayClouds } from './clouds';

export class RailwayRenderer {
  readonly renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(36, 1, 0.1, 100);
  readonly controls: OrbitControls;
  private observer: ResizeObserver;
  private scenery: RailwayScenery;
  private clouds: RailwayClouds;
  private environment: T.WebGLRenderTarget;
  private floorMaterial = new T.ShadowMaterial({ opacity: 0.16 });
  private materials = new Map<string, T.MeshStandardMaterial>();
  private geometries = new Map<string, T.BufferGeometry>();
  private cars: { body: T.Group; axles: T.Group[]; wheels: T.Group[] }[] = [];
  private couplings: T.Mesh[] = [];
  private sun = new T.DirectionalLight(0xfff5e9, 2.5);
  private lowQuality = false;
  private headlight = new T.SpotLight(0xffe2ad, 1.5, 1.5, Math.PI / 7, 0.65, 2);
  private from = new T.Vector3();
  private to = new T.Vector3();
  private direction = new T.Vector3();
  private up = new T.Vector3(0, 1, 0);

  constructor(
    readonly container: HTMLElement,
    readonly world: RailwayWorld,
  ) {
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', t('Model railway. Drag to orbit. Scroll or pinch to zoom.'));
    container.append(canvas);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 29;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.36;
    this.controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
    this.scene.add(new T.HemisphereLight(0xdde7ef, 0x545846, 1.25));
    const room = new RoomEnvironment(),
      pmrem = new T.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.28;
    room.dispose();
    pmrem.dispose();
    this.sun.position.set(-3, 11, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -10,
      right: 10,
      top: 9,
      bottom: -9,
      near: 0.5,
      far: 30,
    });
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.bias = -0.0002;
    this.scene.add(this.sun);
    this.scenery = new RailwayScenery(this.scene);
    this.clouds = new RailwayClouds(this.scene);
    const floor = new T.Mesh(
      this.geometry('floor', () => new T.PlaneGeometry(200, 200)),
      this.floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.36;
    floor.receiveShadow = true;
    this.scene.add(floor);
    [0, 1, 2].forEach((i) => this.buildCar(i));
    for (let i = 0; i < 2; i++) {
      const coupling = this.mesh(
        this.geometry(
          'coupling',
          () => new T.CylinderGeometry(0.025 * MODEL_SCALE, 0.025 * MODEL_SCALE, 1, 8),
        ),
        '#393f38',
      );
      this.couplings.push(coupling);
    }
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.resetCamera();
  }

  private material(color: string) {
    let material = this.materials.get(color);
    if (!material) {
      material = new T.MeshStandardMaterial({ color, roughness: 0.72 });
      this.materials.set(color, material);
    }
    return material;
  }

  private geometry(key: string, build: () => T.BufferGeometry) {
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = build();
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  private mesh(geometry: T.BufferGeometry, color: string, parent: T.Object3D = this.scene) {
    const mesh = new T.Mesh(geometry, this.material(color));
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
    color: string,
    parent: T.Object3D = this.scene,
    round = false,
  ) {
    const mesh = this.mesh(
      this.geometry(`box:${w}:${h}:${d}:${round}`, () =>
        round
          ? new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.15)
          : new T.BoxGeometry(w, h, d),
      ),
      color,
      parent,
    );
    mesh.position.set(x, y, z);
    return mesh;
  }

  private cylinder(
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: string,
    parent: T.Object3D = this.scene,
    top = r,
  ) {
    const mesh = this.mesh(
      this.geometry(`cylinder:${r}:${h}:${top}`, () => new T.CylinderGeometry(top, r, h, 16)),
      color,
      parent,
    );
    mesh.position.set(x, y, z);
    return mesh;
  }

  private buildCar(index: number) {
    const body = new T.Group();
    this.scene.add(body);
    body.scale.setScalar(MODEL_SCALE);
    const carColor = '#a92524';
    this.material(carColor).roughness = 0.37;
    const glazing = this.material('#253940');
    const windows = this.material('#e8c886');
    windows.emissive.set('#ffca70');
    windows.emissiveIntensity = 0.8;
    glazing.metalness = 0.5;
    glazing.roughness = 0.16;
    this.box(1.3, 0.09, 0.39, 0, 0.13, 0, '#343a39', body);
    this.box(1.26, 0.38, 0.41, 0, 0.355, 0, carColor, body, true);
    this.box(1.27, 0.055, 0.41, 0, 0.572, 0, '#90918a', body, true);
    this.box(1.25, 0.035, 0.421, 0, 0.22, 0, '#e2dfd4', body);
    for (const z of [-0.211, 0.211]) {
      if (index === 0) {
        // Electric locomotive cab glazing, side grilles and access steps.
        for (const x of [-0.49, 0.49]) {
          this.box(0.18, 0.14, 0.008, x, 0.44, z, '#253940', body);
          this.box(0.009, 0.15, 0.012, x, 0.44, z, '#b6b9ad', body);
          this.box(0.1, 0.015, 0.04, x - 0.06, 0.16, z, '#76786f', body);
        }
        for (let i = 0; i < 16; i++)
          this.box(0.014, 0.16, 0.012, -0.3 + i * 0.04, 0.415, z, '#663735', body);
        this.box(0.15, 0.057, 0.009, 0, 0.29, z, '#dedbd0', body);
      } else {
        for (let i = 0; i < 6; i++)
          this.box(0.123, 0.16, 0.009, -0.435 + i * 0.174, 0.421, z, '#e8c886', body, true);
        for (const x of [-0.56, 0.56]) {
          this.box(0.075, 0.3, 0.012, x, 0.347, z, '#c7c8ba', body);
          this.box(0.048, 0.11, 0.015, x, 0.43, z, '#253940', body);
        }
      }
    }
    for (const end of [-1, 1]) {
      const x = end * 0.635;
      this.box(0.012, 0.147, 0.3, x, 0.451, 0, '#253940', body);
      this.box(0.014, 0.147, 0.012, x, 0.451, 0, '#959f98', body);
      for (const z of [-0.135, 0.135]) {
        this.box(
          0.014,
          0.031,
          0.048,
          x + end * 0.008,
          0.273,
          z,
          index === 0 && end === 1 ? '#fff0ca' : '#b04f38',
          body,
        );
        this.box(0.04, 0.033, 0.048, x + end * 0.023, 0.14, z, '#414844', body);
      }
    }
    if (index === 0) {
      this.material('#fff0ca').emissive.set('#ffe5b0');
      this.material('#fff0ca').emissiveIntensity = 2;
      this.headlight.position.set(0.67, 0.27, 0);
      this.headlight.target.position.set(3.7, 0.12, 0);
      this.headlight.castShadow = true;
      this.headlight.shadow.mapSize.set(512, 512);
      this.headlight.shadow.camera.near = 0.015;
      this.headlight.shadow.bias = -0.0002;
      body.add(this.headlight, this.headlight.target);
    }
    // Roof equipment and raised pantograph, aligned beneath the contact wire.
    if (index === 0) {
      this.box(0.47, 0.045, 0.21, 0, 0.61, 0, '#616b66', body);
      for (const z of [-0.06, 0.06]) {
        for (const direction of [-1, 1]) {
          const arm = this.box(0.014, 0.2, 0.014, direction * 0.06, 0.714, z, '#4c554f', body);
          arm.rotation.z = direction * 0.62;
        }
      }
      this.box(0.05, 0.013, 0.24, 0, 0.796, 0, '#424c46', body);
    } else {
      this.box(0.38, 0.045, 0.22, 0.03, 0.62, 0, '#a4a59b', body, true);
    }
    const wheels: T.Group[] = [],
      axles: T.Group[] = [];
    for (let axle = 0; axle < 2; axle++) {
      const group = new T.Group();
      this.scene.add(group);
      group.scale.setScalar(MODEL_SCALE);
      axles.push(group);
      const rod = this.cylinder(0.021, 0.34, 0, 0, 0, '#333e35', group);
      rod.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) {
        const wheel = new T.Group();
        wheel.position.z = (side * GAUGE) / (2 * MODEL_SCALE);
        group.add(wheel);
        wheels.push(wheel);
        const disk = this.cylinder(WHEEL_RADIUS / MODEL_SCALE, 0.033, 0, 0, 0, '#344238', wheel);
        disk.rotation.x = Math.PI / 2;
        const hub = this.cylinder(0.028, 0.04, 0, 0, 0, '#606965', wheel);
        hub.rotation.x = Math.PI / 2;
        for (let j = 0; j < 3; j++) {
          const spoke = this.box(0.01, 0.1, 0.008, 0, 0, side * 0.021, '#59615a', wheel);
          spoke.rotation.z = (j * Math.PI) / 3;
        }
      }
    }
    this.cars.push({ body, axles, wheels });
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    // Widen the vertical view on portrait screens to retain the entire table.
    this.camera.fov = this.camera.aspect < 1 ? 49 : 38;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(Math.max(1, width), Math.max(1, height));
  }

  resetCamera() {
    this.controls.enableDamping = false;
    // Consume any remaining orbit inertia before restoring the starting pose.
    this.controls.update();
    this.controls.target.set(0, 0.6, 0);
    this.camera.position.set(10.6, 11.15, 13.95);
    this.controls.update();
    this.controls.enableDamping = true;
  }

  quality(light: boolean) {
    this.lowQuality = light;
    this.scenery.quality(light);
    this.clouds.quality(light);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, light ? 1 : 1.6));
    this.renderer.shadowMap.enabled = !light;
    this.sun.castShadow = !light;
    this.headlight.castShadow = !light;
    this.materials.forEach((material) => {
      material.needsUpdate = true;
    });
  }

  render() {
    this.cars.forEach((car, i) => {
      const distance = this.world.carDistance(i);
      const front = trackPose(distance + AXLE_OFFSET),
        back = trackPose(distance - AXLE_OFFSET);
      car.body.position.set(
        (front.x + back.x) / 2,
        (front.y + back.y) / 2 + WHEEL_RADIUS,
        (front.z + back.z) / 2,
      );
      const yaw = Math.atan2(back.z - front.z, front.x - back.x);
      const pitch = Math.atan2(front.y - back.y, Math.hypot(front.x - back.x, front.z - back.z));
      car.body.rotation.set(0, yaw, pitch, 'YXZ');
      [front, back].forEach((p, j) => {
        car.axles[j].position.set(p.x, p.y + WHEEL_RADIUS, p.z);
        car.axles[j].rotation.set(0, p.yaw, p.pitch, 'YXZ');
      });
      car.wheels.forEach((wheel) => {
        wheel.rotation.z = -this.world.travel / WHEEL_RADIUS;
      });
      car.body.updateMatrixWorld();
    });
    this.couplings.forEach((mesh, i) => {
      this.from.set(-0.59, 0.15, 0);
      this.cars[i].body.localToWorld(this.from);
      this.to.set(0.59, 0.15, 0);
      this.cars[i + 1].body.localToWorld(this.to);
      this.direction.subVectors(this.to, this.from);
      mesh.position.copy(this.from).add(this.to).multiplyScalar(0.5);
      mesh.scale.y = this.direction.length();
      mesh.quaternion.setFromUnitVectors(this.up, this.direction.normalize());
    });
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.clouds.update(this.camera, this.world.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  stats() {
    return {
      camera: this.camera.position.toArray(),
      light: this.lowQuality,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      modelScale: MODEL_SCALE,
      tunnels: ROUTE_SECTIONS.filter((s) => s.kind === 'tunnel'),
      headlight: {
        position: this.headlight.getWorldPosition(new T.Vector3()).toArray(),
        intensity: this.headlight.intensity,
      },
      drawCalls: this.renderer.info.render.calls,
      clouds: this.clouds.stats(),
    };
  }

  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.scenery.dispose();
    this.clouds.dispose();
    this.environment.dispose();
    this.floorMaterial.dispose();
    this.scene.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    this.sun.shadow.dispose();
    this.headlight.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
