import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AvalancheWorld, SNOW } from './physics';
import { channelCenter, clamp, randomSource, TERRAIN } from './terrain';

type Puff = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  duration: number;
  size: number;
};
const PUFFS = 850;
export class AvalancheRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 2, 7000);
  readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly chunks: THREE.InstancedMesh;
  private readonly slab: THREE.Mesh;
  private readonly crown: THREE.Line;
  private readonly marker: THREE.Group;
  private readonly powder: THREE.Points;
  private readonly dummy = new THREE.Object3D();
  private readonly ground = { height: 0, dx: 0, dz: 0 };
  private readonly positions = new Float32Array(PUFFS * 3);
  private readonly sizes = new Float32Array(PUFFS);
  private readonly opacity = new Float32Array(PUFFS);
  private readonly puffs: Puff[] = Array.from({ length: PUFFS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vz: 0,
    life: 0,
    duration: 1,
    size: 1,
  }));
  private random = randomSource(72);
  private puffIndex = 0;
  private previousTime = 0;
  private emission = 0;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private world: AvalancheWorld,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.setClearColor('#e5edf0');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    host.append(canvas);
    this.scene.fog = new THREE.Fog('#e5edf0', 2200, 4800);
    this.scene.add(new THREE.HemisphereLight('#e1f4ff', '#728894', 2.6));
    const sun = new THREE.DirectionalLight('#fff2dc', 3.8);
    sun.position.set(-650, 1100, -150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -900,
      right: 900,
      top: 1000,
      bottom: -900,
      near: 10,
      far: 2500,
    });
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 1.4;
    this.scene.add(sun, sun.target);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18000, 18000),
      new THREE.MeshStandardMaterial({ color: '#d4e0e4', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -30;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.makeTerrain();
    this.makeForest();
    this.makeCabin(-238, 355);
    this.makeCabin(-275, 383);
    this.makeSurveyMarkers();

    const slabGeometry = this.surfacePatch(-56, 56, -362, -267, 28, 24, 1.7);
    this.slab = new THREE.Mesh(
      slabGeometry,
      new THREE.MeshStandardMaterial({ color: '#f9fcff', roughness: 0.88, side: THREE.DoubleSide }),
    );
    this.slab.receiveShadow = true;
    this.scene.add(this.slab);
    const crownPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const x = -56 + (i * 112) / 60 + channelCenter(-362),
        z = -362 + Math.sin(i * 1.7) * 0.7;
      crownPoints.push(new THREE.Vector3(x, this.height(x, z) + 2, z));
    }
    this.crown = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(crownPoints),
      new THREE.LineBasicMaterial({ color: '#49758b' }),
    );
    this.crown.visible = false;
    this.scene.add(this.crown);
    this.chunks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: '#edf7ff', roughness: 0.95 }),
      this.world.parcels.length,
    );
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chunks.frustumCulled = false;
    this.chunks.receiveShadow = true;
    this.chunks.castShadow = true;
    this.scene.add(this.chunks);

    const puffGeometry = new THREE.BufferGeometry();
    puffGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    puffGeometry.setAttribute(
      'size',
      new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    puffGeometry.setAttribute(
      'opacity',
      new THREE.BufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.powder = new THREE.Points(
      puffGeometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { pixelScale: { value: 700 } },
        vertexShader: `attribute float size; attribute float opacity; varying float alpha; uniform float pixelScale;
        void main(){ vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(size*pixelScale/-p.z,1.,180.); alpha=opacity; }`,
        fragmentShader: `varying float alpha;
        void main(){ vec2 p=gl_PointCoord*2.-1.; float r=length(p);
        float lobes=.065*sin(p.x*16.+p.y*7.)+.055*cos(p.y*19.-p.x*9.);
        float a=(1.-smoothstep(.32,1.,r+lobes))*alpha;
        if(a<.006) discard;
        vec3 col=mix(vec3(.38,.51,.60),vec3(.95,.975,1.),smoothstep(-1.,.8,-p.y));
        gl_FragColor=vec4(col,a);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }`,
      }),
    );
    this.powder.frustumCulled = false;
    this.powder.renderOrder = 2;
    this.scene.add(this.powder);
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(10, 1, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#dc653e' }),
    );
    ring.rotation.x = -Math.PI / 2;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 32, 6),
      new THREE.MeshBasicMaterial({ color: '#dc653e' }),
    );
    stem.position.y = 16;
    this.marker.add(ring, stem);
    this.marker.position.set(-35, this.height(-35, -320) + 4, -320);
    this.scene.add(this.marker);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = 0.15;
    this.controls.minDistance = 480;
    this.controls.maxDistance = 3300;
    this.controls.enablePan = false;
    this.fit();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }
  private height(x: number, z: number) {
    return this.world.terrain.sample(x, z, this.ground).height;
  }
  private makeTerrain() {
    const { nx, nz, heights } = this.world.terrain;
    const positions = [],
      colors = [],
      indices = [];
    const snow = new THREE.Color('#e5edf0'),
      rock = new THREE.Color('#617582'),
      tint = new THREE.Color();
    for (let iz = 0; iz < nz; iz++)
      for (let ix = 0; ix < nx; ix++) {
        const x = TERRAIN.minX + ix * TERRAIN.step,
          z = TERRAIN.minZ + iz * TERRAIN.step;
        const y = heights[iz * nx + ix];
        positions.push(x, y, z);
        const g = this.world.terrain.sample(x, z, this.ground);
        const slope = Math.hypot(g.dx, g.dz);
        const ridge = clamp((Math.abs(x - channelCenter(z)) - 95) / 120, 0, 1);
        const bands = Math.sin(y * 0.23 + x * 0.033) * 0.15 + Math.sin(x * 0.08 - z * 0.065) * 0.15;
        const exposure = clamp((slope - 0.86 + bands) * 1.5, 0, 0.94) * ridge;
        tint.copy(snow).lerp(rock, exposure);
        tint.multiplyScalar(0.97 + Math.sin(x * 0.2 + z * 0.11) * 0.018);
        colors.push(tint.r, tint.g, tint.b);
        if (ix < nx - 1 && iz < nz - 1) {
          const a = iz * nx + ix,
            b = a + 1,
            c = a + nx,
            d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }),
    );
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.scene.add(mesh);
    // Exposed cut of the mountain model, with a snow lip at its upper edge.
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i < nx; i++)
      edge.push(new THREE.Vector3(TERRAIN.minX + i * 5, heights[i], TERRAIN.minZ));
    for (let i = 1; i < nz; i++)
      edge.push(new THREE.Vector3(TERRAIN.maxX, heights[i * nx + nx - 1], TERRAIN.minZ + i * 5));
    for (let i = nx - 2; i >= 0; i--)
      edge.push(new THREE.Vector3(TERRAIN.minX + i * 5, heights[(nz - 1) * nx + i], TERRAIN.maxZ));
    for (let i = nz - 2; i >= 0; i--)
      edge.push(new THREE.Vector3(TERRAIN.minX, heights[i * nx], TERRAIN.minZ + i * 5));
    const wall = [],
      wallColors = [];
    const topColor = new THREE.Color('#9baeb5'),
      bottomColor = new THREE.Color('#657f8c');
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i],
        b = edge[(i + 1) % edge.length];
      wall.push(
        a.x,
        a.y,
        a.z,
        a.x,
        -25,
        a.z,
        b.x,
        b.y,
        b.z,
        b.x,
        b.y,
        b.z,
        a.x,
        -25,
        a.z,
        b.x,
        -25,
        b.z,
      );
      for (const col of [topColor, bottomColor, topColor, topColor, bottomColor, bottomColor])
        wallColors.push(col.r, col.g, col.b);
    }
    const wallGeometry = new THREE.BufferGeometry();
    wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
    wallGeometry.setAttribute('color', new THREE.Float32BufferAttribute(wallColors, 3));
    wallGeometry.computeVertexNormals();
    const sides = new THREE.Mesh(
      wallGeometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    );
    sides.castShadow = true;
    this.scene.add(sides);
  }
  private surfacePatch(
    left: number,
    right: number,
    back: number,
    front: number,
    nx: number,
    nz: number,
    lift: number,
  ) {
    const geo = new THREE.PlaneGeometry(right - left, front - back, nx, nz);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const z = (back + front) / 2 - p.getY(i),
        x = p.getX(i) + (left + right) / 2 + channelCenter(z);
      p.setXYZ(i, x, this.height(x, z) + lift, z);
    }
    geo.computeVertexNormals();
    return geo;
  }
  private makeForest() {
    const random = randomSource(86),
      treeParts: THREE.BufferGeometry[] = [],
      capParts: THREE.BufferGeometry[] = [];
    for (let j = 0; j < 4; j++) {
      const r = 4.6 - j * 0.9,
        y = 5 + j * 2.8;
      treeParts.push(new THREE.ConeGeometry(r, 8 - j * 0.7, 7).translate(0, y, 0));
      capParts.push(new THREE.ConeGeometry(r * 0.83, 6.2 - j * 0.45, 7).translate(0, y + 1, 0));
    }
    const greenGeo = mergeGeometries(treeParts),
      whiteGeo = mergeGeometries(capParts);
    treeParts.concat(capParts).forEach((g) => g.dispose());
    const trees = new THREE.InstancedMesh(
      greenGeo,
      new THREE.MeshStandardMaterial({ color: '#244c51', roughness: 1 }),
      700,
    );
    const caps = new THREE.InstancedMesh(
      whiteGeo,
      new THREE.MeshStandardMaterial({ color: '#dae9ed', roughness: 1 }),
      700,
    );
    let n = 0;
    for (let i = 0; i < 4000 && n < 700; i++) {
      const z = -90 + random() * 665,
        x = (random() - 0.5) * 830;
      if (Math.abs(x - channelCenter(z)) < 90 + Math.max(0, z) * 0.1) continue;
      if (Math.hypot((x + 250) / 1.3, z - 370) < 52) continue;
      const g = this.world.terrain.sample(x, z, this.ground);
      if (Math.hypot(g.dx, g.dz) > 0.95 || random() < (z < 0 ? 0.45 : 0.08)) continue;
      this.dummy.position.set(x, g.height - 1, z);
      this.dummy.rotation.set(0, random() * 6.28, 0);
      this.dummy.scale.setScalar(0.65 + random() * 0.9);
      this.dummy.updateMatrix();
      trees.setMatrixAt(n, this.dummy.matrix);
      caps.setMatrixAt(n, this.dummy.matrix);
      n++;
    }
    trees.count = caps.count = n;
    trees.castShadow = caps.castShadow = true;
    trees.receiveShadow = caps.receiveShadow = true;
    this.scene.add(trees, caps);
  }
  private makeCabin(x: number, z: number) {
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#6d5443', roughness: 1 });
    const house = new THREE.Mesh(new THREE.BoxGeometry(20, 13, 16), wood);
    house.position.y = 6.5;
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(15.5, 15.5, 24, 3),
      new THREE.MeshStandardMaterial({ color: '#eef6f7', roughness: 1 }),
    );
    roof.rotation.set(0, Math.PI / 2, Math.PI / 2);
    roof.scale.z = 0.65;
    roof.position.y = 14;
    const window = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({
        color: '#f6c87d',
        emissive: '#efab53',
        emissiveIntensity: 0.4,
      }),
    );
    window.position.set(4, 7, 8.05);
    group.add(house, roof, window);
    group.position.set(x, this.height(x, z), z);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.scene.add(group);
  }
  private makeSurveyMarkers() {
    const points: THREE.Vector3[] = [];
    for (let z = -390; z <= 480; z += 8) {
      const x = channelCenter(z);
      points.push(new THREE.Vector3(x, this.height(x, z) + 1, z));
    }
    const guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: '#8da6b0',
        dashSize: 5,
        gapSize: 7,
        transparent: true,
        opacity: 0.4,
      }),
    );
    guide.computeLineDistances();
    this.scene.add(guide);
    for (const z of [-370, -100, 220]) {
      const x = -84 + channelCenter(z);
      const stake = new THREE.Mesh(
        new THREE.CylinderGeometry(0.65, 0.65, 14, 6),
        new THREE.MeshStandardMaterial({ color: '#bd6344' }),
      );
      stake.position.set(x, this.height(x, z) + 7, z);
      this.scene.add(stake);
    }
  }
  fit(top = false) {
    this.controls.target.set(0, 260, -25);
    if (top) this.camera.position.set(80, 2150, 650);
    else this.camera.position.set(1270, 1220, 1750);
    this.controls.update();
  }
  private resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.fov = w < 600 ? 55 : 40;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    (this.powder.material as THREE.ShaderMaterial).uniforms.pixelScale.value =
      (h * this.renderer.getPixelRatio()) /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)));
  }
  reset() {
    this.previousTime = this.emission = this.puffIndex = 0;
    this.random = randomSource(72);
    this.puffs.forEach((p) => (p.life = 0));
  }
  stats() {
    return {
      clouds: this.puffs.filter((p) => p.life > 0).length,
      cloudScale: (this.powder.material as THREE.ShaderMaterial).uniforms.pixelScale.value,
      calls: this.renderer.info.render.calls,
    };
  }
  render(frameSeconds = 0) {
    if (this.disposed) return;
    const world = this.world,
      dt = Math.max(0, Math.min(0.2, world.elapsed - this.previousTime));
    this.previousTime = world.elapsed;
    this.marker.visible = world.phase === 'ready';
    this.slab.visible = world.elapsed < 1.4;
    this.crown.visible = world.phase !== 'ready';
    this.crown.scale.x = Math.min(1, world.elapsed * 1.5);
    const slabPositions = this.slab.geometry.getAttribute('position');
    if (world.phase === 'fracture') {
      // Peel the connected snow surface away as the fracture reaches each strip.
      for (let i = 0; i < slabPositions.count; i++) {
        const x = slabPositions.getX(i),
          z = slabPositions.getZ(i);
        const arrival = 0.12 + Math.hypot(x + 35, (z + 320) * 0.65) / 85;
        slabPositions.setY(i, this.height(x, z) + (world.elapsed > arrival ? 0.04 : 1.7));
      }
      slabPositions.needsUpdate = true;
    } else if (world.phase === 'ready') {
      for (let i = 0; i < slabPositions.count; i++)
        slabPositions.setY(
          i,
          this.height(slabPositions.getX(i), slabPositions.getZ(i)) + 1.7 * world.depth,
        );
      slabPositions.needsUpdate = true;
    }
    let count = 0;
    this.emission += dt * 135 * SNOW[world.kind].dust;
    for (let i = 0; i < world.parcels.length; i++) {
      const p = world.parcels[i];
      if (p.state === 0 || p.state === 3) continue;
      const moving = p.state === 1;
      this.dummy.position.set(p.x, p.y + p.radius * 0.32, p.z);
      this.dummy.scale.set(p.radius * 1.15, p.radius * (moving ? 0.65 : 0.38), p.radius * 1.15);
      this.dummy.rotation.set(p.travel * 0.015, i * 2.4, moving ? p.travel * 0.024 : 0);
      this.dummy.updateMatrix();
      this.chunks.setMatrixAt(count++, this.dummy.matrix);
      if (dt > 0 && moving && p.speed > 7 && this.emission >= 1 && this.random() < 0.08) {
        const puff = this.puffs[this.puffIndex++ % PUFFS];
        puff.x = p.x + (this.random() - 0.5) * 10;
        puff.z = p.z;
        puff.y = p.y + 8;
        puff.vx = p.vx * 0.6 + (this.random() - 0.5) * 4;
        puff.vz = p.vz * 0.8;
        puff.duration = 4 + this.random() * 3;
        puff.life = puff.duration;
        puff.size = 22 + p.speed * 1.5 + this.random() * 18;
        this.emission--;
      }
    }
    this.emission = Math.min(this.emission, 12);
    this.chunks.count = count;
    this.chunks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < PUFFS; i++) {
      const p = this.puffs[i];
      // Continue dissipating once the dense flow has settled, while respecting pause.
      const delta = world.phase === 'settled' && !world.paused ? clamp(frameSeconds, 0, 0.2) : dt;
      p.life = Math.max(0, p.life - delta);
      if (p.life > 0) {
        const oldGround = this.height(p.x, p.z);
        p.x += p.vx * delta;
        p.z += p.vz * delta;
        const newGround = this.height(p.x, p.z);
        p.y = Math.max(newGround + 3, p.y + (newGround - oldGround) * 0.8 + delta * 2.8);
        p.vx *= Math.exp(-delta * 0.3);
        p.vz *= Math.exp(-delta * 0.2);
      }
      const age = 1 - p.life / p.duration;
      this.positions.set([p.x, p.y, p.z], i * 3);
      this.sizes[i] = p.size * (1 + age * 2.5);
      this.opacity[i] = p.life > 0 ? Math.sin(Math.PI * age) * 0.48 : 0;
    }
    this.powder.geometry.getAttribute('position').needsUpdate = true;
    this.powder.geometry.getAttribute('size').needsUpdate = true;
    this.powder.geometry.getAttribute('opacity').needsUpdate = true;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
