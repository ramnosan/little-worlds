import { t } from '../i18n';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { AquariumWorld, WIDTH, DEPTH, WATER_Y, TANK_HEIGHT, NX, NZ } from './physics';
import { KoiVisuals } from './koi-assets';
import { UnderwaterLighting } from './underwater';
import { WaterReflection, waterReflectionFragment } from './reflection';

const vertex = `varying vec3 vWorld; varying vec3 vNormal;
void main(){ vec4 p=modelMatrix*vec4(position,1.); vWorld=p.xyz;
vNormal=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*p; }`;
const caustic = `
uniform float time; uniform sampler2D heightMap;
float lightPattern(vec2 p) {
  vec2 uv=p/vec2(6.,3.6)+.5;
  float h=texture2D(heightMap,clamp(uv,0.,1.)).r;
  p *= 3.4;
  p += vec2(sin(p.y*1.6+time*.7),cos(p.x*1.4-time*.6))*.45 + h*8.;
  float a=sin(p.x+sin(p.y+time*.45));
  float b=sin(p.y+cos(p.x-time*.37));
  return pow(max(0.,1.-abs(a+b)*.65),14.)*.65;
}`;
// Sand remains visible directly through the transparent water.
const sand = `
float sandHash(vec2 p) {
  return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
}
float sandNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(sandHash(cell),sandHash(cell+vec2(1.,0.)),f.x),
             mix(sandHash(cell+vec2(0.,1.)),sandHash(cell+vec2(1.,1.)),f.x),f.y);
}
vec3 sandColor(vec2 p) {
  float patches=sandNoise(p*2.1);
  float ripples=sin(p.y*24.+sin(p.x*2.8)*1.7+patches*2.);
  float grain=sandNoise(p*155.);
  float grainVisibility=1.-smoothstep(.35,1.5,max(fwidth(p.x),fwidth(p.y))*155.);
  vec3 color=mix(vec3(.43,.31,.16),vec3(.72,.59,.37),.45+patches*.35);
  color*=.96+ripples*.04+(grain-.5)*.24*grainVisibility;
  return color;
}`;

export class AquariumRenderer {
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
  private heightTexture: T.DataTexture;
  private timeUniform = { value: 0 };
  private observer: ResizeObserver;
  private raycaster = new T.Raycaster();
  private pointer = new T.Vector2();
  private waterPlane = new T.Plane(new T.Vector3(0, 1, 0), -WATER_Y);
  private hit = new T.Vector3();
  private lowQuality = false;
  private reflection = new WaterReflection();

  constructor(
    readonly container: HTMLElement,
    readonly world: AquariumWorld,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      t('Interactive aquarium. Drag: waves. Right-drag: orbit. Scroll: zoom.'),
    );
    container.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
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
    this.scene.add(new T.HemisphereLight(0xd6f8ff, 0x2a5359, 2.3));
    const sun = new T.DirectionalLight(0xf7e9c6, 3.5);
    sun.position.set(-3, 8, 4);
    this.scene.add(sun);
    const rim = new T.DirectionalLight(0x70dfeb, 2.2);
    rim.position.set(4, 3, -4);
    this.scene.add(rim);
    this.heightTexture = new T.DataTexture(world.heights, NX, NZ, T.RedFormat, T.FloatType);
    this.heightTexture.minFilter = T.NearestFilter;
    this.heightTexture.magFilter = T.NearestFilter;
    this.heightTexture.needsUpdate = true;
    const underwaterLighting = new UnderwaterLighting(this.heightTexture, this.timeUniform);
    this.koi = new KoiVisuals(world.koi, (m) => underwaterLighting.prepare(m));
    this.scene.add(this.koi.group);
    const floorMaterial = new T.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: `
      varying vec3 vWorld; varying vec3 vNormal; ${caustic} ${sand}
      void main(){
        float light=lightPattern(vWorld.xz);
        vec3 color=sandColor(vWorld.xz);
        color+=vec3(.42,.48,.3)*light;
        color*=.86+.14*dot(normalize(vNormal),normalize(vec3(-.3,1.,.4)));
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
      uniforms: { time: this.timeUniform, heightMap: { value: this.heightTexture } },
    });
    const floor = new T.Mesh(new T.BoxGeometry(WIDTH, 0.14, DEPTH), floorMaterial);
    floor.name = 'Sand bed';
    floor.position.y = -0.07;
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
        vertexShader: vertex,
        fragmentShader: waterReflectionFragment,
        uniforms: {
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
        vertexShader: vertex,
        fragmentShader: `
        varying vec3 vWorld; varying vec3 vNormal; ${caustic}
        void main(){
          float depth=clamp(1.-vWorld.y/1.65,0.,1.);
          vec3 color=mix(vec3(.15,.56,.58),vec3(.035,.24,.29),depth);
          float glimmer=lightPattern(vWorld.xz+vWorld.y*.25);
          color+=vec3(.28,.66,.56)*glimmer*.45;
          gl_FragColor=vec4(color,.23+depth*.23);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        uniforms: { time: this.timeUniform, heightMap: { value: this.heightTexture } },
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
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }
  resetCamera() {
    // Flush residual orbit momentum before restoring the initial pose.
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.set(7.7, 6.8, 10.4);
    this.controls.target.set(0, 0.85, 0);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  quality(low: boolean) {
    this.lowQuality = low;
    void this.koi.load(low);
    this.resize();
  }
  private resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.fov = w < h ? 48 : 36;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.lowQuality ? 1 : 1.6));
    this.renderer.setSize(w, h);
    this.reflection.resize(w, h, this.lowQuality);
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
  render() {
    this.koi.sync();
    this.timeUniform.value = this.world.time;
    this.heightTexture.needsUpdate = true;
    const positions = this.water.geometry.attributes.position;
    for (let i = 0; i < this.world.heights.length; i++) positions.setY(i, this.world.heights[i]);
    positions.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    for (const child of this.sides.children) {
      const mesh = child as T.Mesh<T.BufferGeometry>,
        side = mesh.userData.side as number,
        count = side < 2 ? NX : NZ;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < count; i++) {
        const k =
          side === 0 ? i : side === 1 ? (NZ - 1) * NX + i : side === 2 ? i * NX : i * NX + NX - 1;
        p.setY(i * 2 + 1, WATER_Y + this.world.heights[k]);
      }
      p.needsUpdate = true;
    }
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
        this.scene.add(mesh);
        this.ballMeshes.set(b.id, mesh);
      }
      mesh.position.set(b.x, b.y, b.z);
    }
    this.controls.update();
    this.reflection.render(this.renderer, this.scene, this.camera, this.water, this.sides);
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
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
    this.heightTexture.dispose();
    this.reflection.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
