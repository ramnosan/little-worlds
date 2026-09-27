import * as T from 'three';
import { RUNWAY } from './physics';
import { FIELDS, fieldShader } from './fields';

const noise = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
}`;

/** Static miniature scenery owns every resource it creates. No per-frame allocation. */
export class AirfieldScenery {
  readonly group = new T.Group();
  private detail = new T.Group();
  private geometries = new Set<T.BufferGeometry>();
  private materials = new Set<T.Material>();
  private cache = new Map<number, T.MeshStandardMaterial>();
  private boxGeometry = this.geometry(new T.BoxGeometry(1, 1, 1));
  private roundGeometry = this.geometry(new T.SphereGeometry(1, 12, 8));
  private seed = 6019;
  private light = false;
  readonly cameraObstacles: T.Box3[] = [];
  private vegetationCount = 0;

  constructor(scene: T.Scene) {
    this.group.name = 'countryside-airfield';
    this.detail.name = 'airfield-details';
    this.group.add(this.detail);
    scene.add(this.group);
    this.sky();
    this.land();
    this.runway();
    this.clubhouse();
    this.planting();
  }
  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  private geometry<G extends T.BufferGeometry>(g: G): G {
    this.geometries.add(g);
    return g;
  }
  private material(color: number) {
    if (!this.cache.has(color)) {
      const m = new T.MeshStandardMaterial({ color, roughness: 0.9 });
      this.materials.add(m);
      this.cache.set(color, m);
    }
    return this.cache.get(color)!;
  }
  private textured(color: number, scale: number, strength: number) {
    const m = this.material(color);
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vSurface;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSurface = (modelMatrix * vec4(position, 1.)).xyz;',
      );
      shader.fragmentShader = `varying vec3 vSurface;\n${noise}\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float grain = noise((vSurface.xz + vSurface.y * .7) * ${scale.toFixed(3)});
        diffuseColor.rgb *= 1. - ${strength.toFixed(3)} * (1. - grain);
      `,
      );
    };
    m.customProgramCacheKey = () => `${color}-${scale}-${strength}`;
    return m;
  }
  private mesh(g: T.BufferGeometry, m: T.Material, parent = this.group) {
    const mesh = new T.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private box(
    color: number,
    size: [number, number, number],
    at: [number, number, number],
    parent = this.group,
  ) {
    const m = this.mesh(this.boxGeometry, this.material(color), parent);
    m.scale.set(...size);
    m.position.set(...at);
    return m;
  }
  private round(
    color: number,
    size: [number, number, number],
    at: [number, number, number],
    parent = this.group,
  ) {
    const m = this.mesh(this.roundGeometry, this.material(color), parent);
    m.scale.set(...size);
    m.position.set(...at);
    return m;
  }
  private sky() {
    const material = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 vSky; void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `varying vec3 vSky; ${noise}
        void main(){
          vec3 d=normalize(vSky);
          vec3 color=mix(vec3(.66,.81,.84),vec3(.19,.49,.68),pow(max(0.,d.y),.5));
          vec2 p=d.xz/max(.1,d.y)*2.;
          float cloud=noise(p)*.68+noise(p*2.)*.22+noise(p*4.)*.1;
          float mask=smoothstep(.57,.75,cloud)*smoothstep(.015,.18,d.y);
          color=mix(color,vec3(.96,.94,.86),mask*.9);
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.materials.add(material);
    const sky = this.mesh(this.geometry(new T.SphereGeometry(10000, 32, 16)), material);
    sky.castShadow = false;
    sky.receiveShadow = false;
  }
  private land() {
    const ground = this.geometry(new T.PlaneGeometry(18000, 18000));
    ground.rotateX(-Math.PI / 2);
    this.mesh(ground, this.airfieldMaterial()).castShadow = false;
    this.fieldPlanting();
    for (const [x, z, w, h] of [
      [-340, -480, 170, 28],
      [20, -560, 240, 45],
      [360, -490, 210, 33],
      [-490, 120, 180, 25],
      [430, 270, 220, 38],
    ]) {
      this.round(0x829779, [w, h, w * 0.65], [x, -h * 0.4, z]);
      this.round(0x91a187, [w * 0.7, h * 0.75, w * 0.5], [x + w * 0.4, -h * 0.25, z - 40]);
    }
  }
  private fieldPlanting() {
    const foliage = this.geometry(new T.SphereGeometry(1, 10, 7));
    const vertices = foliage.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i),
        y = vertices.getY(i),
        z = vertices.getZ(i);
      const radius = 1 + 0.12 * Math.sin(x * 7 + y * 4) * Math.cos(z * 6 - y * 3);
      vertices.setXYZ(i, x * radius, y * radius, z * radius);
    }
    foliage.computeVertexNormals();
    const shrubs: T.Matrix4[][] = [[], [], []],
      crowns: T.Matrix4[][] = [[], [], []],
      trunks: T.Matrix4[] = [],
      dummy = new T.Object3D();
    FIELDS.forEach(({ corners }, parcel) => {
      // Plant selected boundaries only, leaving broad views and gaps for farm access.
      const edge = parcel % 3 === 0 ? 0 : 1;
      const a = new T.Vector3(corners[edge][0], 0, corners[edge][1]);
      const b = new T.Vector3(
        corners[(edge + 1) % corners.length][0],
        0,
        corners[(edge + 1) % corners.length][1],
      );
      const length = a.distanceTo(b);
      for (let distance = 7; distance < length - 7; distance += 2.2 + this.random() * 1.6) {
        const fraction = distance / length;
        if (fraction > 0.43 && fraction < 0.54) continue;
        dummy.position.copy(a).lerp(b, fraction);
        dummy.position.x += (this.random() - 0.5) * 1.4;
        dummy.position.z += (this.random() - 0.5) * 1.4;
        dummy.position.y = 0.55 + this.random() * 0.35;
        dummy.scale.set(1.2 + this.random(), 0.8 + this.random() * 0.7, 0.8 + this.random() * 0.5);
        dummy.rotation.set(0, this.random() * Math.PI, 0);
        dummy.updateMatrix();
        shrubs[Math.floor(this.random() * shrubs.length)].push(dummy.matrix.clone());
      }
      for (const fraction of parcel % 3 === 0 ? [0.13, 0.18, 0.7] : [0.15, 0.7]) {
        const position = a.clone().lerp(b, fraction),
          height = 4.5 + this.random() * 3.5;
        dummy.position.copy(position).add(new T.Vector3(0, height * 0.34, 0));
        dummy.scale.set(0.22, height * 0.68, 0.22);
        dummy.rotation.set(0, this.random() * 6, 0);
        dummy.updateMatrix();
        trunks.push(dummy.matrix.clone());
        for (let lobe = 0; lobe < 5; lobe++) {
          const angle = lobe * 2.4;
          dummy.position.set(
            position.x + Math.cos(angle) * height * 0.16,
            height * (0.65 + this.random() * 0.18),
            position.z + Math.sin(angle) * height * 0.16,
          );
          dummy.scale.set(height * 0.25, height * (0.22 + this.random() * 0.1), height * 0.24);
          dummy.updateMatrix();
          crowns[(parcel + lobe) % crowns.length].push(dummy.matrix.clone());
        }
      }
    });
    const colors = [0x576f47, 0x6b8052, 0x788755];
    shrubs.forEach((matrices, i) => this.instances(foliage, colors[i], matrices));
    crowns.forEach((matrices, i) => this.instances(foliage, colors[i], matrices));
    this.instances(this.geometry(new T.CylinderGeometry(0.7, 1, 1, 7)), 0x706149, trunks);
    this.vegetationCount += shrubs.reduce((sum, group) => sum + group.length, 0) + trunks.length;
  }
  private runway() {
    // Low runway markers read as miniature painted blocks, outside the landing surface.
    for (const x of [-88, -50, 0, 50, 88])
      for (const z of [-7, 7]) this.box(0xe7ddbf, [0.45, 0.17, 0.22], [x, 0.085, z]);
  }
  private airfieldMaterial() {
    // Fields, meadow and runway share one depth surface, including every marking.
    const material = this.textured(0x8d9a70, 0.035, 0.14),
      base = material.onBeforeCompile;
    const asphalt = new T.Color(0x555e59),
      shoulder = new T.Color(0xc7bd97),
      paint = new T.Color(0xe0dcc3);
    material.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer);
      shader.uniforms.asphaltColor = { value: asphalt };
      shader.uniforms.shoulderColor = { value: shoulder };
      shader.uniforms.paintColor = { value: paint };
      shader.fragmentShader =
        `uniform vec3 asphaltColor; uniform vec3 shoulderColor; uniform vec3 paintColor;
        float coverage(float distance,float aa){return 1.-smoothstep(-aa,aa,distance);}
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        vec2 p=vSurface.xz;
        vec2 footprint=max(fwidth(p),vec2(.001));
        float edge=max(footprint.x,footprint.y);
        ${fieldShader()}
        float shoulderMask=coverage(max(abs(p.x)-${RUNWAY.length / 2 + 2}.,abs(p.y)-${RUNWAY.width / 2 + 1.4}),edge);
        float asphaltMask=coverage(max(abs(p.x)-${RUNWAY.length / 2}.,abs(p.y)-${RUNWAY.width / 2}.),edge);
        float grainVisibility=1.-smoothstep(.2,1.5,edge*9.);
        vec3 road=asphaltColor*(.89+(noise(p*9.)-.5)*.22*grainVisibility);
        float dash=coverage(abs(mod(p.x+90.,12.)-6.)-2.5,footprint.x)*coverage(abs(p.y)-.085,footprint.y);
        float sidelines=coverage(abs(abs(p.y)-5.5)-.0425,footprint.y)*coverage(abs(p.x)-88.,footprint.x);
        float thresholds=coverage(abs(abs(p.x)-85.)-1.5,footprint.x)*max(coverage(abs(abs(p.y)-2.)-.25,footprint.y),coverage(abs(abs(p.y)-3.5)-.25,footprint.y));
        road=mix(road,paintColor,max(dash,max(sidelines,thresholds)));
        diffuseColor.rgb=mix(diffuseColor.rgb,shoulderColor,shoulderMask);
        diffuseColor.rgb=mix(diffuseColor.rgb,road,asphaltMask);
        #include <roughnessmap_fragment>
      `,
      );
    };
    material.customProgramCacheKey = () => 'airfield-single-surface-v2';
    return material;
  }
  private clubhouse() {
    const club = new T.Group();
    club.position.set(-29, 0, 11);
    this.group.add(club);
    this.textured(0x9b7958, 5, 0.17);
    this.box(0xbbae89, [7, 0.12, 5], [0, 0.06, 0], club);
    this.box(0x9b7958, [5.6, 2.5, 3.6], [0, 1.37, 0], club);
    const gable = this.geometry(new T.BufferGeometry());
    gable.setAttribute(
      'position',
      new T.Float32BufferAttribute(
        [
          2.8, 2.62, -1.8, 2.8, 2.62, 1.8, 2.8, 3.18, 0, -2.8, 2.62, -1.8, -2.8, 2.62, 1.8, -2.8,
          3.18, 0,
        ],
        3,
      ),
    );
    gable.setIndex([0, 2, 1, 3, 4, 5]);
    gable.computeVertexNormals();
    this.mesh(gable, this.material(0x9b7958), club);
    for (let z = -1.65; z < 1.8; z += 0.35)
      this.box(0x816a50, [0.04, 2.35, 0.035], [2.83, 1.4, z], club);
    this.box(0xe5d9b8, [0.08, 1.15, 1.45], [2.86, 1.58, 0], club);
    this.box(0x547d80, [0.09, 0.95, 1.25], [2.91, 1.58, 0], club);
    this.box(0xe5d9b8, [0.1, 0.95, 0.06], [2.96, 1.58, 0], club);
    for (let x = -2.65; x <= 2.7; x += 0.35)
      this.box(0x816a50, [0.035, 2.35, 0.04], [x, 1.4, 1.83], club);
    for (const x of [-1.75, 1.75]) {
      this.box(0xe5d9b8, [1.15, 1.1, 0.08], [x, 1.62, 1.85], club);
      this.box(0x547d80, [0.96, 0.88, 0.09], [x, 1.62, 1.91], club);
      this.box(0xe5d9b8, [0.05, 0.9, 0.1], [x, 1.62, 1.96], club);
    }
    this.box(0x355e5b, [0.9, 1.9, 0.1], [0, 1.05, 1.86], club);
    for (let x = -2.65; x <= 2.7; x += 0.35)
      this.box(0x816a50, [0.035, 2.35, 0.04], [x, 1.4, -1.83], club);
    for (const x of [-1.75, 1.75]) {
      this.box(0xe5d9b8, [1.15, 1.1, 0.08], [x, 1.62, -1.85], club);
      this.box(0x547d80, [0.96, 0.88, 0.09], [x, 1.62, -1.91], club);
      this.box(0xe5d9b8, [0.05, 0.9, 0.1], [x, 1.62, -1.96], club);
    }
    this.box(0x355e5b, [0.9, 1.9, 0.1], [0, 1.05, -1.86], club);
    this.round(0xd8c78c, [0.035, 0.035, 0.035], [0.3, 1.05, -1.94], club);
    const roofAngle = 0.3;
    for (const side of [-1, 1]) {
      const roof = this.box(0x416f6a, [6.4, 0.15, 2.22], [0, 2.91, side * 1.02], club);
      roof.rotation.x = side * roofAngle;
      for (let x = -3; x <= 3; x += 0.45) {
        const rib = this.box(0x557e71, [0.025, 0.035, 2.2], [x, 3.0, side * 1.02], club);
        rib.rotation.x = side * roofAngle;
      }
    }
    this.box(0x365e58, [6.45, 0.13, 0.12], [0, 3.23, 0], club);
    club.updateWorldMatrix(true, true);
    this.cameraObstacles.push(new T.Box3().setFromObject(club).expandByScalar(0.15));
    // Equipment bench and two small flight cases.
    const bench = new T.Group();
    bench.position.set(-24, 0.02, 10);
    this.group.add(bench);
    for (const x of [-1, 1])
      for (const z of [-0.35, 0.35]) this.box(0x6f705a, [0.09, 0.78, 0.09], [x, 0.39, z], bench);
    this.box(0xb29465, [2.5, 0.12, 0.95], [0, 0.83, 0], bench);
    for (const x of [-0.6, 0.5]) {
      this.box(0x527676, [0.6, 0.28, 0.36], [x, 1.03, 0], bench);
      this.box(0x314846, [0.2, 0.04, 0.06], [x, 1.19, 0], bench);
    }
    for (let x = -36; x <= -26; x += 2) {
      this.box(0xb7a179, [0.13, 0.9, 0.13], [x, 0.45, 9]);
      if (x < -26) for (const y of [0.34, 0.7]) this.box(0xc4ae87, [2, 0.09, 0.08], [x + 1, y, 9]);
    }
    // Calm windsock, hanging from the inland side of the strip.
    this.box(0xd4d1b9, [0.06, 4, 0.06], [3, 2, 10]);
    this.box(0xd4d1b9, [0.45, 0.055, 0.055], [3.2, 3.9, 10]);
    const hoop = this.mesh(
      this.geometry(new T.TorusGeometry(0.2, 0.018, 6, 16)),
      this.material(0xd4d1b9),
    );
    hoop.position.set(3.4, 3.84, 10);
    hoop.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const g = this.geometry(
        new T.CylinderGeometry(0.2 - i * 0.025, 0.175 - i * 0.025, 0.18, 12, 1, true),
      );
      const sock = this.mesh(g, this.material(i % 2 ? 0xece3c8 : 0xca7950));
      sock.position.set(3.4, 3.75 - i * 0.18, 10);
    }
  }
  private instances(g: T.BufferGeometry, color: number, transforms: T.Matrix4[], detail = false) {
    const mesh = new T.InstancedMesh(g, this.material(color), transforms.length);
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (detail ? this.detail : this.group).add(mesh);
    return mesh;
  }
  private planting() {
    const dummy = new T.Object3D(),
      trunks: T.Matrix4[] = [],
      crowns: T.Matrix4[] = [];
    for (const [cx, cz, count] of [
      [-115, 42, 16],
      [-65, 65, 13],
      [65, 48, 20],
      [160, 85, 23],
      [-230, 25, 22],
    ])
      for (let i = 0; i < count; i++) {
        const x = cx + (this.random() - 0.5) * 38,
          z = cz + (this.random() - 0.5) * 28,
          h = 3 + this.random() * 4;
        dummy.position.set(x, h * 0.4, z);
        dummy.scale.set(0.15, h * 0.8, 0.15);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunks.push(dummy.matrix.clone());
        for (let tier = 0; tier < 3; tier++) {
          dummy.position.set(x, h * (0.4 + tier * 0.21), z);
          dummy.scale.set(h * (0.3 - tier * 0.055), h * 0.52, h * (0.3 - tier * 0.055));
          dummy.rotation.y = this.random() * 6;
          dummy.updateMatrix();
          crowns.push(dummy.matrix.clone());
        }
      }
    this.instances(this.geometry(new T.CylinderGeometry(0.7, 1, 1, 7)), 0x7c7258, trunks);
    this.instances(this.geometry(new T.ConeGeometry(1, 1, 9)), 0x577b65, crowns);
    const stones: T.Matrix4[] = [],
      tufts: T.Matrix4[] = [];
    for (let i = 0; i < 260; i++) {
      const parcel = FIELDS[i % FIELDS.length],
        edge = i % parcel.corners.length;
      const a = parcel.corners[edge],
        b = parcel.corners[(edge + 1) % parcel.corners.length];
      const fraction = this.random();
      const x = a[0] + (b[0] - a[0]) * fraction + (this.random() - 0.5) * 3,
        z = a[1] + (b[1] - a[1]) * fraction + (this.random() - 0.5) * 3;
      if (i % 4 === 0) {
        dummy.position.set(x, 0.13, z);
        dummy.scale.set(
          0.22 + this.random() * 0.6,
          0.12 + this.random() * 0.2,
          0.2 + this.random() * 0.35,
        );
        dummy.rotation.set(0, this.random() * 6, 0);
        dummy.updateMatrix();
        stones.push(dummy.matrix.clone());
      }
      for (let blade = 0; blade < 3; blade++) {
        dummy.position.set(x + blade * 0.09, 0.17, z);
        dummy.scale.set(0.07, 0.25 + this.random() * 0.25, 0.05);
        dummy.rotation.set((this.random() - 0.5) * 0.7, this.random() * 6, (blade - 1) * 0.3);
        dummy.updateMatrix();
        tufts.push(dummy.matrix.clone());
      }
    }
    this.instances(this.geometry(new T.IcosahedronGeometry(1, 1)), 0xa4a496, stones);
    this.instances(this.geometry(new T.ConeGeometry(1, 1, 4)), 0x8a9566, tufts, true);
    this.vegetationCount += trunks.length + tufts.length;
  }
  quality(light: boolean) {
    this.light = light;
    this.detail.visible = !light;
  }
  stats() {
    return {
      geometries: this.geometries.size,
      materials: this.materials.size,
      vegetation: this.vegetationCount,
      detailVisible: this.detail.visible,

      light: this.light,
    };
  }
  dispose() {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      if (object instanceof T.InstancedMesh) object.dispose();
    });
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.cache.clear();
    this.group.clear();
  }
}
