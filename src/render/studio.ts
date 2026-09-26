import { t } from '../i18n';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RAMP, type SoftBody } from '../physics/world';
import { JellySurface } from './surface';

export interface BlobView {
  body: SoftBody;
  mesh: THREE.Mesh<JellySurface, THREE.MeshPhysicalMaterial>;
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
}

export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  readonly views = new Map<number, BlobView>();
  readonly raycaster = new THREE.Raycaster();
  readonly mallet = new THREE.Group();
  readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly grabMarker: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private environment: THREE.WebGLRenderTarget;
  private shadowTexture: THREE.CanvasTexture;
  private lowQuality = false;
  private resizeObserver: ResizeObserver;
  private light: THREE.DirectionalLight;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      'aria-label',
      t('Interactive jelly playground. Drag a jelly to stretch it; drag the background to orbit.'),
    );
    this.renderer.domElement.setAttribute('tabindex', '0');
    this.renderer.domElement.addEventListener('blur', () => {
      delete this.renderer.domElement.dataset.pointerFocus;
    });
    container.append(this.renderer.domElement);
    this.camera.position.set(8.2, 10, 14);
    this.camera.lookAt(0, 0, 0);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.05);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.65;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xfffbec, 0x91aa94, 0.65));
    this.light = new THREE.DirectionalLight(0xfff5df, 2.6);
    this.light.position.set(-5, 12, 7);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    Object.assign(this.light.shadow.camera, {
      left: -10,
      right: 10,
      top: 10,
      bottom: -10,
      near: 0.5,
      far: 35,
    });
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.bias = -0.0002;
    this.light.shadow.radius = 4;
    this.scene.add(this.light);
    const fill = new THREE.DirectionalLight(0xe6eaff, 0.65);
    fill.position.set(6, 6, -5);
    this.scene.add(fill);
    this.makeStage();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(38,59,43,0.30)');
    gradient.addColorStop(0.45, 'rgba(38,59,43,0.16)');
    gradient.addColorStop(1, 'rgba(38,59,43,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    this.shadowTexture = new THREE.CanvasTexture(canvas);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 0.955, 80),
      new THREE.MeshBasicMaterial({
        color: 0x41614f,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.grabMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    this.grabMarker.visible = false;
    this.grabMarker.renderOrder = 10;
    this.scene.add(this.grabMarker);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.64, 32, 24),
      new THREE.MeshPhysicalMaterial({ color: '#e9b45e', roughness: 0.3, clearcoat: 0.8 }),
    );
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 1.65, 16),
      new THREE.MeshStandardMaterial({ color: '#486752', roughness: 0.6 }),
    );
    handle.position.y = 1.08;
    const grip = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 12),
      new THREE.MeshStandardMaterial({ color: '#f4dfb5', roughness: 0.5 }),
    );
    grip.position.y = 1.9;
    head.castShadow = handle.castShadow = grip.castShadow = true;
    this.mallet.add(head, handle, grip);
    this.mallet.visible = false;
    this.scene.add(this.mallet);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }
  private makeStage() {
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(12.1, 0.5, 8, 6, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x718e7b, roughness: 0.64 }),
    );
    base.position.y = -0.32;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);
    const inner = new THREE.Mesh(
      new RoundedBoxGeometry(11.48, 0.19, 7.38, 6, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xc3d0ba, roughness: 0.8 }),
    );
    inner.position.y = -0.085;
    inner.receiveShadow = true;
    this.scene.add(inner);
    // Soft outer shadow anchors the tray without a visible horizon.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ color: 0x58624b, opacity: 0.12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.59;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // Fine, sparse dot grid makes the physical space readable without visual noise.
    const positions: number[] = [];
    for (let x = -5; x <= 5; x += 0.5)
      for (let z = -3; z <= 3; z += 0.5) positions.push(x, 0.018, z);
    const dots = new THREE.BufferGeometry();
    dots.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.scene.add(
      new THREE.Points(
        dots,
        new THREE.PointsMaterial({
          color: 0x9aaa96,
          size: 0.022,
          transparent: true,
          opacity: 0.48,
        }),
      ),
    );
    const { minX, maxX, minZ, maxZ, slope } = RAMP,
      h = (maxZ - minZ) * slope;
    const points = [
      minX,
      0,
      minZ,
      maxX,
      0,
      minZ,
      minX,
      h,
      minZ,
      maxX,
      h,
      minZ,
      minX,
      0,
      maxZ,
      maxX,
      0,
      maxZ,
    ];
    const rampGeometry = new THREE.BufferGeometry();
    rampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    rampGeometry.setIndex([2, 4, 5, 2, 5, 3, 0, 2, 3, 0, 3, 1, 0, 4, 2, 1, 3, 5, 0, 1, 5, 0, 5, 4]);
    rampGeometry.computeVertexNormals();
    const ramp = new THREE.Mesh(
      rampGeometry,
      new THREE.MeshStandardMaterial({ color: 0xc6cdbb, roughness: 0.77, flatShading: true }),
    );
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    this.scene.add(ramp);
    // A small physical studio stamp on the front lip.
    const stamp = document.createElement('canvas');
    stamp.width = 512;
    stamp.height = 64;
    const context = stamp.getContext('2d')!;
    context.fillStyle = '#526553';
    context.font = '500 23px monospace';
    context.textAlign = 'center';
    context.fillText(t('J E L L Y   /   P L A Y G R O U N D   0 1'), 256, 40);
    const texture = new THREE.CanvasTexture(stamp);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 0.44),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    label.position.set(0, -0.27, 4.005);
    this.scene.add(label);
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width < 600 ? 48 : 36;
    this.camera.updateProjectionMatrix();
  }
  add(body: SoftBody) {
    const geometry = new JellySurface(body);
    geometry.update(body);
    const material = new THREE.MeshPhysicalMaterial({
      color: body.color,
      roughness: 0.27,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      transmission: this.lowQuality ? 0 : 0.12,
      thickness: 1.4,
      ior: 1.38,
      envMapIntensity: 0.65,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.bodyId = body.id;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    this.scene.add(mesh, shadow);
    this.views.set(body.id, { body, mesh, shadow });
  }
  remove(id: number) {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.remove(view.mesh, view.shadow);
    view.mesh.geometry.dispose();
    view.mesh.material.dispose();
    view.shadow.geometry.dispose();
    view.shadow.material.dispose();
    this.views.delete(id);
  }
  quality(reduced: boolean) {
    this.lowQuality = reduced;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, reduced ? 1 : 1.75));
    this.light.castShadow = !reduced;
    for (const v of this.views.values()) {
      v.mesh.material.transmission = reduced ? 0 : 0.12;
      v.mesh.material.needsUpdate = true;
    }
    this.resize();
  }
  sync(selected: number | null, hovered: number | null) {
    for (const view of this.views.values()) {
      view.mesh.geometry.update(view.body);
      view.mesh.material.emissive.set(view.body.id === hovered ? 0x172314 : 0x000000);
      view.mesh.material.emissiveIntensity = 0.13;
      const b = view.body;
      view.shadow.position.set(b.center[0], 0.025, b.center[2]);
      const lift = Math.max(0, b.bounds[1]);
      view.shadow.scale.set(
        (b.bounds[3] - b.bounds[0]) * 1.6 + lift * 0.3,
        (b.bounds[5] - b.bounds[2]) * 1.6 + lift * 0.3,
        1,
      );
      view.shadow.material.opacity = 0.6 / (1 + lift * 1.3);
    }
    const active = this.views.get(selected ?? hovered ?? -1);
    this.marker.visible = !!active;
    if (active) {
      this.marker.position.set(active.body.center[0], 0.03, active.body.center[2]);
      this.marker.scale.setScalar(active.body.radius * 1.2);
    }
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.resizeObserver.disconnect();
    for (const id of [...this.views.keys()]) this.remove(id);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
          if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.environment.dispose();
    this.shadowTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
