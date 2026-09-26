import { t } from '../i18n';
import * as THREE from 'three';
import type { Bubble, BubbleWorld } from './physics';
import { MAX_CONTACT_PLANES } from './physics';
import type { V3 } from './physics';
import { DartRenderer } from './dart-render';
import { smooth5 } from './fusion';

const vertexShader = /* glsl */ `
  uniform float uTime, uSeed, uAge, uWobble, uShape;
  uniform vec4 uContacts[${MAX_CONTACT_PLANES}];
  uniform vec3 uDeformationAxis;
  uniform float uDeformation;
  uniform int uContactCount;
  varying vec3 vWorld, vLocal, vNormal;
  void main() {
    vec3 p = position;
    float a = sin(uAge * 8.0 + uSeed) * uWobble * (1.0-uShape);
    // The quadrupole mode approximately conserves volume as surface tension relaxes.
    p *= vec3(1.0 + a, 1.0 - a * 0.65, 1.0 - a * 0.35);
    p += normal * (sin(position.y * 5.0 + uTime * 1.4 + uSeed) *
      sin(position.x * 4.0 - uTime * 0.7) * 0.006 * (1.0-uShape));
    vec3 n = normal / vec3(1.0+a, 1.0-a*0.65, 1.0-a*0.35);
    // Surface-tension oscillation follows the impact axis, approximately preserving volume.
    float parallel = 1.0-uDeformation;
    float transverse = inversesqrt(parallel);
    p = p*transverse + uDeformationAxis*dot(p,uDeformationAxis)*(parallel-transverse);
    n = n/transverse + uDeformationAxis*dot(n,uDeformationAxis)*(1.0/parallel-1.0/transverse);
    // Attached neighbors can wobble, but the shared rim stays pinned to its plane.
    float freeFilm=1.0;
    for (int i=0; i<${MAX_CONTACT_PLANES}; i++) {
      if (i>=uContactCount) break;
      freeFilm=min(freeFilm,smoothstep(0.0,0.24,uContacts[i].w-dot(position,uContacts[i].xyz)));
    }
    p=mix(position,p,freeFilm);
    n=mix(normal,n,freeFilm);
    vLocal = p;
    vNormal = mat3(modelMatrix) * n;
    vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime, uSeed, uAge, uLife, uOpacity, uFilm, uOpening;
  uniform float uSourceWeight;
  uniform vec4 uSourceLobes[2];
  uniform vec2 uSourceSeeds, uSourceAges;
  uniform vec4 uContacts[${MAX_CONTACT_PLANES}];
  uniform vec4 uContactRegions[${MAX_CONTACT_PLANES}];
  uniform int uContactCount;
  uniform sampler2D uEnvironment;
  varying vec3 vWorld, vLocal, vNormal;
  const float PI = 3.14159265359;
  vec3 environment(vec3 r) {
    vec2 uv = vec2(atan(r.z, r.x) / (2.0 * PI) + 0.5, asin(clamp(r.y,-1.0,1.0)) / PI + 0.5);
    return pow(texture2D(uEnvironment, uv).rgb, vec3(2.2));
  }
  float filmThickness(vec3 p,float seed,float age) {
    float flow=uTime*0.16;
    float swirl=sin(p.x*7.0+sin(p.y*8.0+flow)+seed+flow)*sin(p.z*5.0-p.y*6.0-flow*0.7);
    swirl+=0.35*sin(p.y*22.0+sin(p.x*11.0+flow)*2.0+seed);
    return (290.0+(1.0-p.y)*185.0+swirl*75.0)*exp(-age*0.012);
  }
  void main() {
    for (int i=0; i<${MAX_CONTACT_PLANES}; i++) {
      if (i>=uContactCount) break;
      vec3 relative=vLocal-uContactRegions[i].xyz;
      if (dot(vLocal,uContacts[i].xyz)>uContacts[i].w &&
          dot(relative,relative)<uContactRegions[i].w*uContactRegions[i].w) discard;
    }
    float filmRadius=length(vLocal.xy);
    if (uFilm>0.5 && filmRadius<uOpening) discard;
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    if (dot(n,v) < 0.0) n = -n;
    float cosI = clamp(dot(n,v), 0.001, 1.0);
    float cosT = sqrt(1.0 - (1.0 - cosI*cosI) / (1.333*1.333));
    float rs = (cosI - 1.333*cosT) / (cosI + 1.333*cosT);
    float rp = (1.333*cosI - cosT) / (1.333*cosI + cosT);
    float fresnel = 0.5 * (rs*rs + rp*rp);
    float thickness = filmThickness(normalize(vLocal),uSeed,uAge);
    if(uSourceWeight>0.0) {
      vec3 a=vLocal-uSourceLobes[0].xyz,b=vLocal-uSourceLobes[1].xyz;
      float da=length(a)-uSourceLobes[0].w,db=length(b)-uSourceLobes[1].w;
      float blend=smoothstep(-0.06,0.06,da-db);
      float source=mix(filmThickness(normalize(a),uSourceSeeds.x,uSourceAges.x),
        filmThickness(normalize(b),uSourceSeeds.y,uSourceAges.y),blend);
      thickness=mix(thickness,source,uSourceWeight);
    }
    vec3 phase = 4.0 * PI * 1.333 * thickness * cosT / vec3(650.0, 510.0, 475.0);
    vec3 interference = 0.5 + 0.5*cos(phase + PI);
    vec3 reflectance = 4.0*fresnel*interference /
      (vec3((1.0-fresnel)*(1.0-fresnel)) + 4.0*fresnel*interference);
    vec3 reflected = environment(reflect(-v,n));
    vec3 sun = normalize(vec3(-0.65,0.75,0.9));
    float glint = pow(max(dot(reflect(-sun,n),v),0.0),420.0);
    float halo = pow(max(dot(reflect(-sun,n),v),0.0),38.0);
    // Broad sky reflections and two small light catches make the film read as hollow.
    float sky = smoothstep(0.42,0.49,n.y) * (1.0-smoothstep(0.56,0.68,n.y));
    sky *= smoothstep(-0.85,-0.5,n.x) * (1.0-smoothstep(-0.05,0.30,n.x));
    float catchlight = exp(-pow((n.x+0.40)/0.045,2.0)-pow((n.y-0.44)/0.16,2.0));
    float rim = pow(1.0-cosI, 5.0);
    float strength = max(reflectance.r,max(reflectance.g,reflectance.b));
    vec3 tint = reflectance / max(strength,0.001);
    vec3 color = mix(vec3(0.8,0.88,0.9), tint, 0.90) * (0.38 + reflected*1.8);
    color += vec3(1.0,0.9,0.7)*(glint*2.5 + halo*0.22) + vec3(0.8,0.94,1.0)*(sky*0.95+catchlight*2.0);
    float alpha = 0.012 + strength*0.88 + rim*0.16 + glint*0.8 + sky*0.32 + catchlight*0.75;
    if (uFilm>0.5) {
      float edge=smoothstep(0.93,1.0,filmRadius);
      float openingEdge=(1.0-smoothstep(uOpening,uOpening+0.045,filmRadius))*step(0.001,uOpening);
      color=mix(color,vec3(0.88,0.74,1.0)+tint*0.35,edge*0.45);
      alpha=0.055+strength*0.25+edge*0.32+openingEdge*0.4;
    }
    float fade = 1.0-smoothstep(uLife-1.5,uLife,uAge);
    gl_FragColor = vec4(color,clamp(alpha,0.0,0.94)*fade*uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Locally painted defocused garden: also supplies coherent environment reflections. */
function gardenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  let seed = 923;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const base = ctx.createLinearGradient(0, 0, 0, 1024);
  base.addColorStop(0, '#61736a');
  base.addColorStop(0.32, '#79846a');
  base.addColorStop(0.64, '#394e39');
  base.addColorStop(1, '#1b322d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 2048, 1024);
  // Several depth layers of leaves, distant trunks, and warm apertures of sky.
  for (let layer = 0; layer < 3; layer++) {
    ctx.filter = `blur(${24 - layer * 6}px)`;
    for (let i = 0; i < 95; i++) {
      const x = random() * 2300 - 100,
        y = random() * 1200 - 100;
      const r = 25 + random() * 130;
      ctx.fillStyle = ['#182e2c', '#304b38', '#708057', '#afaf77', '#c5bc8b'][
        Math.floor(random() * 5)
      ];
      ctx.globalAlpha = 0.18 + random() * 0.25;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.4 + random()), random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 0.24;
  ctx.filter = 'blur(18px)';
  ctx.strokeStyle = '#182e2a';
  ctx.lineWidth = 35;
  for (const x of [110, 570, 1540, 1890]) {
    ctx.beginPath();
    ctx.moveTo(x, 1100);
    ctx.bezierCurveTo(x - 50, 700, x + 100, 240, x + 40, -100);
    ctx.stroke();
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  const glow = ctx.createRadialGradient(1300, 140, 10, 1300, 140, 830);
  glow.addColorStop(0, 'rgba(255,238,180,.67)');
  glow.addColorStop(0.27, 'rgba(238,214,149,.24)');
  glow.addColorStop(1, 'rgba(221,202,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 100; i++) {
    const x = random() * 2048,
      y = random() * 900,
      r = 3 + random() * 29;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,242,194,.13)');
    g.addColorStop(0.7, 'rgba(248,232,170,.1)');
    g.addColorStop(1, 'rgba(245,238,189,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

interface Burst {
  mesh: THREE.Points;
  origin: THREE.Vector3;
  age: number;
  directions: Float32Array;
}
export class BubbleRenderer {
  dartMode = false;
  private dartRenderer: DartRenderer;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(39, 1, 0.1, 80);
  readonly views = new Map<number, THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>();
  readonly wand = new THREE.Group();
  readonly preview: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private world?: BubbleWorld;
  private filmGeometry = new THREE.CircleGeometry(1, 96);
  private filmViews = new Map<string, THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>>();
  private geometry = new THREE.SphereGeometry(1, 80, 56);
  private environment = gardenTexture();
  private observer: ResizeObserver;
  private bursts: Burst[] = [];
  private raycaster = new THREE.Raycaster();
  private target = new THREE.Vector3(0, 1.0, 0);

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.setAttribute(
      'aria-label',
      t(
        'Bubbles in the evening light. Right-drag to orbit, scroll to zoom. Tap bubbles to pop them.',
      ),
    );
    container.append(this.renderer.domElement);
    this.scene.background = this.environment;
    this.camera.position.set(0, 2, 14);
    this.camera.lookAt(this.target);
    this.dartRenderer = new DartRenderer(this.scene, this.camera);
    this.scene.add(new THREE.HemisphereLight(0xfff1d5, 0x385c50, 3));
    const light = new THREE.DirectionalLight(0xffe7b9, 4);
    light.position.set(-3, 7, 6);
    this.scene.add(light);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.37, 0.018, 12, 96),
      new THREE.MeshStandardMaterial({ color: 0xdfc794, metalness: 0.72, roughness: 0.24 }),
    );
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.007, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0xfff0ca, metalness: 0.6, roughness: 0.2 }),
    );
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, 1.45, 16),
      new THREE.MeshStandardMaterial({ color: 0xb5a475, metalness: 0.65, roughness: 0.32 }),
    );
    handle.position.y = -1.08;
    this.wand.add(ring, inner, handle);
    this.wand.position.set(1.0, -1.0, 2);
    this.wand.rotation.z = -0.22;
    this.scene.add(this.wand);
    this.preview = new THREE.Mesh(this.geometry, this.material(2));
    this.preview.visible = false;
    this.scene.add(this.preview);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }
  private material(seed: number) {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uShape: { value: 0 },
        uSourceWeight: { value: 0 },
        uSourceLobes: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uSourceSeeds: { value: new THREE.Vector2() },
        uSourceAges: { value: new THREE.Vector2() },
        uFilm: { value: 0 },
        uOpening: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: seed },
        uAge: { value: 0 },
        uLife: { value: 100 },
        uWobble: { value: 0.01 },
        uOpacity: { value: 1 },
        uEnvironment: { value: this.environment },
        uContacts: {
          value: Array.from({ length: MAX_CONTACT_PLANES }, () => new THREE.Vector4(0, 0, 0, 1)),
        },
        uContactRegions: {
          value: Array.from({ length: MAX_CONTACT_PLANES }, () => new THREE.Vector4(0, 0, 0, 1000)),
        },
        uContactCount: { value: 0 },
        uDeformationAxis: { value: new THREE.Vector3(1, 0, 0) },
        uDeformation: { value: 0 },
      },
    });
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.fov = width < 700 ? 53 : 39;
    this.camera.updateProjectionMatrix();
    this.wand.position.x = width < 700 ? -0.9 : 0.1;
    this.wand.position.y = width < 700 ? -1.0 : -0.25;
  }
  origin(): [number, number, number] {
    return [this.wand.position.x, this.wand.position.y, this.wand.position.z - 0.1];
  }
  setPreview(radius: number, time: number) {
    this.preview.visible = radius > 0;
    this.preview.position.fromArray(this.origin());
    this.preview.position.y += radius * 0.22;
    this.preview.position.z -= radius * 0.35;
    this.preview.scale.set(radius, radius, radius * 0.8);
    this.preview.material.uniforms.uTime.value = time;
    this.preview.material.uniforms.uAge.value = time;
    this.preview.material.uniforms.uWobble.value = 0.022;
  }
  sync(world: BubbleWorld, delta: number) {
    this.world = world;
    this.dartRenderer.sync(world.darts.projectiles, this.dartMode);
    for (const [id, mesh] of this.views)
      if (!world.bubbles.some((b) => b.id === id)) {
        this.scene.remove(mesh);
        mesh.material.dispose();
        this.views.delete(id);
      }
    for (const b of world.bubbles) {
      let mesh = this.views.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material(b.seed));
        mesh.userData.id = b.id;
        this.views.set(b.id, mesh);
        this.scene.add(mesh);
      }
      const surface = world.surfaceFor(b.id);
      mesh.geometry = surface?.geometry ?? this.geometry;
      mesh.position.fromArray(b.position);
      mesh.scale.setScalar(b.radius);
      const u = mesh.material.uniforms;
      u.uTime.value = world.time;
      u.uAge.value = b.age;
      u.uLife.value = b.lifetime;
      u.uWobble.value = 0.006 + 0.046 * Math.exp(-b.age * 1.6);
      const constrained = !!surface || b.contacts.length > 0;
      u.uShape.value = constrained
        ? 1
        : 1 - smooth5((world.time - (b.fusionReleaseTime ?? -10)) / 0.2);
      const appearance = world.fusionAppearanceFor(b.id);
      u.uSourceWeight.value = appearance?.weight ?? 0;
      if (appearance) {
        for (let i = 0; i < 2; i++)
          u.uSourceLobes.value[i].set(...appearance.lobes[i].center, appearance.lobes[i].radius);
        u.uSourceSeeds.value.set(
          appearance.sources[0].seed ?? b.seed,
          appearance.sources[1].seed ?? b.seed,
        );
        u.uSourceAges.value.set(
          (appearance.sources[0].age ?? b.age) + appearance.elapsed,
          (appearance.sources[1].age ?? b.age) + appearance.elapsed,
        );
      }
      u.uDeformation.value = surface ? 0 : b.deformation;
      u.uDeformationAxis.value.fromArray(b.deformationAxis);
      u.uContactCount.value = b.contacts.length;
      for (let i = 0; i < b.contacts.length; i++) {
        const { normal, offset, region } = b.contacts[i];
        u.uContacts.value[i].set(...normal, offset);
        if (region) u.uContactRegions.value[i].set(...region.center, region.radius);
        else u.uContactRegions.value[i].set(0, 0, 0, 1000);
      }
    }
    const films = world.sharedFilms;
    const keys = new Set(films.map((f) => `${f.a}:${f.b}`));
    for (const [key, mesh] of this.filmViews)
      if (!keys.has(key)) {
        this.scene.remove(mesh);
        mesh.material.dispose();
        this.filmViews.delete(key);
      }
    for (const film of films) {
      const key = `${film.a}:${film.b}`;
      let mesh = this.filmViews.get(key);
      if (!mesh) {
        const material = this.material(film.a * 0.73);
        material.side = THREE.DoubleSide;
        material.forceSinglePass = true;
        material.uniforms.uShape.value = 1;
        material.uniforms.uFilm.value = 1;
        mesh = new THREE.Mesh(this.filmGeometry, material);
        this.filmViews.set(key, mesh);
        this.scene.add(mesh);
      }
      mesh.position.fromArray(film.center);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(...film.normal),
      );
      mesh.scale.setScalar(film.radius);
      mesh.material.uniforms.uTime.value = world.time;
      mesh.material.uniforms.uOpening.value = film.opening;
    }
    for (const burst of [...this.bursts]) {
      burst.age += delta;
      if (burst.age > 0.7) {
        this.scene.remove(burst.mesh);
        burst.mesh.geometry.dispose();
        (burst.mesh.material as THREE.PointsMaterial).dispose();
        this.bursts.splice(this.bursts.indexOf(burst), 1);
        continue;
      }
      const pos = burst.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const s = 1 + burst.age * 1.2;
        pos.setXYZ(
          i,
          burst.directions[i * 3] * s,
          burst.directions[i * 3 + 1] * s - burst.age * burst.age * 2,
          burst.directions[i * 3 + 2] * s,
        );
      }
      pos.needsUpdate = true;
      (burst.mesh.material as THREE.PointsMaterial).opacity = (1 - burst.age / 0.7) * 0.75;
    }
    this.renderer.render(this.scene, this.camera);
  }
  pop(b: Bubble) {
    // Bounded bursts share the scene lifecycle; they also freeze with the simulation.
    if (this.bursts.length >= 12) return;
    const directions = new Float32Array(60 * 3);
    for (let i = 0; i < 60; i++) {
      const y = 1 - (2 * (i + 0.5)) / 60,
        theta = i * 2.39996;
      const r = Math.sqrt(1 - y * y) * b.radius;
      directions.set([Math.cos(theta) * r, y * b.radius, Math.sin(theta) * r], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(directions.slice(), 3));
    const mesh = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffebca,
        size: 0.022,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    mesh.position.fromArray(b.position);
    this.scene.add(mesh);
    this.bursts.push({ mesh, origin: mesh.position.clone(), age: 0, directions });
  }
  pointerOnPlane(x: number, y: number, plane: THREE.Plane) {
    this.aimRay(x, y);
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }
  private aimRay(x: number, y: number) {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((x - box.left) / box.width) * 2 - 1,
        (-(y - box.top) / box.height) * 2 + 1,
      ),
      this.camera,
    );
  }
  dartShot(x: number, y: number): { origin: V3; direction: V3 } {
    this.aimRay(x, y);
    const hit = this.rayHit();
    const target = this.raycaster.ray.at(hit ? hit.distance + 0.1 : 14, new THREE.Vector3());
    const origin = new THREE.Vector3(0.18, -0.14, -Math.min(1.8, hit ? hit.distance * 0.3 : 1.8))
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);
    return {
      origin: origin.toArray() as V3,
      direction: target.sub(origin).normalize().toArray() as V3,
    };
  }
  pick(x: number, y: number) {
    this.aimRay(x, y);
    return this.rayHit()?.id;
  }
  private rayHit() {
    if (!this.world) return;
    const ray = this.raycaster.ray;
    const travel = ray.direction.clone().multiplyScalar(80).toArray() as V3;
    let nearest: { id: number; distance: number } | undefined;
    for (const b of this.world.bubbles) {
      const relative = ray.origin.toArray().map((v, k) => v - b.position[k]) as V3;
      const t = this.world.hitBubble(b.id, relative, travel);
      if (t !== undefined && (!nearest || t * 80 < nearest.distance))
        nearest = { id: b.id, distance: t * 80 };
    }
    return nearest;
  }
  quality(reduced: boolean) {
    this.renderer.setPixelRatio(reduced ? 1 : Math.min(devicePixelRatio, 1.75));
    this.resize();
  }
  clear() {
    this.dartRenderer.clear();
    for (const mesh of this.views.values()) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    this.views.clear();
    for (const mesh of this.filmViews.values()) {
      this.scene.remove(mesh);
      mesh.material.dispose();
    }
    this.filmViews.clear();
    for (const b of this.bursts) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.bursts = [];
    this.preview.visible = false;
  }
  dispose() {
    this.dartRenderer.dispose();
    this.observer.disconnect();
    this.clear();
    this.geometry.dispose();
    this.filmGeometry.dispose();
    this.environment.dispose();
    this.preview.material.dispose();
    this.wand.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
