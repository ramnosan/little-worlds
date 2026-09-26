import { t } from '../i18n';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ASH_LIMIT, FireWorld, STICK_LIMIT } from './physics';
import { compositeFragment, fullscreenVertex, noiseGLSL, volumeFragment } from './shaders';
import { woodGeometry, woodMaterial } from './wood';
import { turbulenceTexture } from './turbulence';

export class FireRenderer {
  readonly renderer = new T.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
  });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(43, 1, 0.08, 90);
  readonly controls: OrbitControls;
  private observer: ResizeObserver;
  private opaque = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, depthBuffer: true });
  private volume = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, depthBuffer: false });
  private volumeScene = new T.Scene();
  private screenCamera = new T.Camera();
  private composer: EffectComposer;
  private bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.16, 0.5, 1.3);
  private composite: ShaderPass;
  private volumeMaterial: T.ShaderMaterial;
  private turbulence = turbulenceTexture();
  private plume = new T.Vector4();
  private sourceA = Array.from({ length: STICK_LIMIT }, () => new T.Vector4());
  private sourceB = Array.from({ length: STICK_LIMIT }, () => new T.Vector4());
  private wood = Array.from({ length: STICK_LIMIT }, (_, i) => {
    // Three shape/material variants retain variation without compiling 36 shader programs.
    const bark = woodMaterial((i % 3) + 1, false),
      ends = woodMaterial((i % 3) + 1, true);
    const mesh = new T.Mesh(woodGeometry((i % 3) + 1), [
      bark.material,
      ends.material,
      ends.material,
    ]);
    mesh.castShadow = mesh.receiveShadow = true;
    return { mesh, bark, ends };
  });
  private ashes: T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>[] = [];
  private firelight = new T.PointLight(0xff8d39, 38, 13, 2);
  private bounce = new T.PointLight(0xff4b16, 5, 7, 2);
  private sparkPositions = new Float32Array(180 * 3);
  private sparkColors = new Float32Array(180 * 3);
  private sparks: T.Points;
  private lowQuality = false;
  private axis = new T.Vector3(0, 1, 0);
  private direction = new T.Vector3();
  private size = new T.Vector2();
  private frames: number[] = [];
  private previousFrame = 0;

  constructor(
    readonly container: HTMLElement,
    readonly world: FireWorld,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', t('Campfire. Drag to orbit. Scroll or pinch to zoom.'));
    container.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 3.3;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = 1.47;
    this.controls.mouseButtons = {
      LEFT: T.MOUSE.ROTATE,
      MIDDLE: T.MOUSE.DOLLY,
      RIGHT: T.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_ROTATE };
    this.scene.fog = new T.FogExp2(0x141b21, 0.055);
    this.environment();
    this.wood.forEach((w) => this.scene.add(w.mesh));
    const ashGeometry = new T.SphereGeometry(1, 12, 6);
    for (let i = 0; i < ASH_LIMIT; i++) {
      const ashMaterial = new T.MeshStandardMaterial({
        color: 0x24211e,
        roughness: 1,
        emissive: 0xf34a08,
      });
      ashMaterial.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vAsh;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAsh=position;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vAsh;\n${noiseGLSL}`)
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            float coalNoise=noise(vAsh*vec3(24.0,5.0,4.0));
            float ashGrain=noise(vAsh*vec3(80.0,18.0,18.0));
            diffuseColor.rgb=mix(vec3(0.015,0.012,0.009),vec3(0.18,0.17,0.15),smoothstep(0.5,0.8,coalNoise))*(0.5+ashGrain*0.5);`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float hot=(1.0-smoothstep(0.07,0.16,abs(coalNoise-0.48)))*smoothstep(0.2,0.5,ashGrain);
            totalEmissiveRadiance*=hot*2.5;`,
          );
      };
      const mesh = new T.Mesh(ashGeometry, ashMaterial);
      mesh.receiveShadow = true;
      this.ashes.push(mesh);
      this.scene.add(mesh);
    }
    this.firelight.position.set(0, 1.5, 0);
    this.firelight.castShadow = true;
    this.firelight.shadow.mapSize.set(1024, 1024);
    this.firelight.shadow.camera.near = 0.1;
    this.firelight.shadow.camera.far = 14;
    this.firelight.shadow.bias = -0.001;
    this.firelight.shadow.normalBias = 0.025;
    this.bounce.position.set(0, 0.24, 0);
    this.scene.add(this.firelight, this.bounce, new T.HemisphereLight(0x94adce, 0x242018, 0.42));
    const moon = new T.DirectionalLight(0xabc9fa, 0.6);
    moon.position.set(-4, 8, -5);
    this.scene.add(moon);

    const sparkGeometry = new T.BufferGeometry();
    sparkGeometry.setAttribute('position', new T.BufferAttribute(this.sparkPositions, 3));
    sparkGeometry.setAttribute('color', new T.BufferAttribute(this.sparkColors, 3));
    const sparkMaterial = new T.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `varying vec3 vColor; uniform float pixelRatio;
        void main(){vColor=color;vec4 p=modelViewMatrix*vec4(position,1);gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(14.0*pixelRatio/-p.z,1.0,5.0);}`,
      fragmentShader: `varying vec3 vColor;void main(){vec2 p=gl_PointCoord*2.0-1.0;
        float a=exp(-dot(p,p)*3.8)*(1.0-smoothstep(0.6,1.0,length(p)));
        gl_FragColor=vec4(vColor,a);}`,
    });
    this.sparks = new T.Points(sparkGeometry, sparkMaterial);
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);

    this.opaque.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
    this.volumeMaterial = new T.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: volumeFragment,
      glslVersion: T.GLSL3,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDepth: { value: this.opaque.depthTexture },
        inverseProjection: { value: this.camera.projectionMatrixInverse },
        cameraWorld: { value: this.camera.matrixWorld },
        eye: { value: this.camera.position },
        time: { value: 0 },
        wind: { value: world.wind },
        intensity: { value: world.intensity },
        stepCount: { value: 224 },
        turbulence: { value: this.turbulence },
        plume: { value: this.plume },
        sourceA: { value: this.sourceA },
        sourceB: { value: this.sourceB },
      },
    });
    this.volumeScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.volumeMaterial));
    this.composer = new EffectComposer(
      this.renderer,
      new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, depthBuffer: false }),
    );
    this.composite = new ShaderPass({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      uniforms: {
        tScene: { value: null },
        tFire: { value: null },
        time: { value: 0 },
      },
    });
    // ShaderPass clones uniforms; render-target textures must retain their live identities.
    this.composite.uniforms.tScene.value = this.opaque.texture;
    this.composite.uniforms.tFire.value = this.volume.texture;
    this.composer.addPass(this.composite);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resetCamera();
    this.resize();
  }

  private environment() {
    const sky = new T.Mesh(
      new T.SphereGeometry(65, 24, 16),
      new T.ShaderMaterial({
        side: T.BackSide,
        depthWrite: false,
        vertexShader: `varying vec3 vSky;void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1);}`,
        fragmentShader: `varying vec3 vSky;void main(){float h=normalize(vSky).y;
        vec3 c=mix(vec3(0.013,0.019,0.027),vec3(0.003,0.008,0.018),smoothstep(0.0,0.55,h));
        gl_FragColor=vec4(c,1.0);}`,
      }),
    );
    this.scene.add(sky);
    const ground = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    ground.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvGround=(modelMatrix*vec4(position,1)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vGround;\n${noiseGLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float dirt=fbm(vGround*9.0), grit=noise(vGround*175.0);
          float burn=1.0-smoothstep(0.5,1.65,length(vGround.xz));
          diffuseColor.rgb=mix(vec3(0.055,0.043,0.03),vec3(0.20,0.16,0.11),dirt)*(0.6+grit*0.6);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.025,0.021,0.02)*(0.4+grit),burn*0.8);`,
        );
    };
    const terrain = new T.PlaneGeometry(150, 150, 100, 100);
    const terrainPositions = terrain.attributes.position;
    for (let i = 0; i < terrainPositions.count; i++) {
      const x = terrainPositions.getX(i),
        z = terrainPositions.getY(i);
      const rise = Math.min(1, Math.max(0, (Math.hypot(x, z) - 6) / 12));
      terrainPositions.setZ(
        i,
        rise * (0.8 + Math.sin(x * 0.23) * 0.65 + Math.cos(z * 0.19 + x * 0.1) * 0.5),
      );
    }
    terrain.computeVertexNormals();
    const floor = new T.Mesh(terrain, ground);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.008;
    floor.receiveShadow = true;
    this.scene.add(floor);
    let seed = 17;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const rockGeometry = new T.SphereGeometry(1, 32, 20);
    const rockPositions = rockGeometry.attributes.position;
    for (let i = 0; i < rockPositions.count; i++) {
      const x = rockPositions.getX(i),
        y = rockPositions.getY(i),
        z = rockPositions.getZ(i);
      const radius =
        1 + 0.1 * Math.sin(x * 9 + z * 5) * Math.cos(y * 7) + 0.04 * Math.sin(z * 23 + x * 11);
      rockPositions.setXYZ(i, x * radius, y * radius, z * radius);
    }
    rockGeometry.computeVertexNormals();
    const stoneMaterial = new T.MeshStandardMaterial({ color: 0x706b61, roughness: 1 });
    stoneMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vStone;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone=position;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vStone;\n${noiseGLSL}`)
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb*=0.55+noise(vStone*95.0)*0.65+noise(vStone*13.0)*0.3;',
        );
    };
    const rocks = new T.InstancedMesh(rockGeometry, stoneMaterial, 130);
    const transform = new T.Object3D();
    for (let i = 0; i < 130; i++) {
      const angle = i < 20 ? (i / 20) * Math.PI * 2 : random() * Math.PI * 2,
        radius = i < 20 ? 1.62 + random() * 0.1 : 1.9 + random() * 10;
      const size = i < 20 ? 0.16 + random() * 0.1 : 0.025 + random() * 0.1;
      transform.position.set(Math.cos(angle) * radius, size * 0.22, Math.sin(angle) * radius);
      transform.scale.set(size * 1.5, size * 0.7, size);
      transform.rotation.set(random(), random() * 6, random());
      transform.updateMatrix();
      rocks.setMatrixAt(i, transform.matrix);
      rocks.setColorAt(i, new T.Color().setScalar(0.5 + random() * 0.45));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    this.scene.add(rocks);
    const branchGeometry = new T.ConeGeometry(1, 1, 36, 4);
    const branches = branchGeometry.attributes.position;
    for (let i = 0; i < branches.count; i++) {
      const x = branches.getX(i),
        y = branches.getY(i),
        z = branches.getZ(i),
        a = Math.atan2(z, x);
      const ragged = 0.82 + 0.18 * Math.sin(a * 17 + Math.floor(y * 4) * 2.3);
      branches.setXYZ(i, x * ragged, y + Math.sin(a * 17) * 0.11 * (0.5 - y), z * ragged);
    }
    branchGeometry.computeVertexNormals();
    const trees = new T.InstancedMesh(
      branchGeometry,
      new T.MeshStandardMaterial({ color: 0x172721, roughness: 1 }),
      1920,
    );
    for (let i = 0; i < 160; i++) {
      const angle = random() * Math.PI * 2,
        radius = 21 + random() * 25,
        height = 6 + random() * 8;
      for (let layer = 0; layer < 12; layer++) {
        transform.position.set(
          Math.cos(angle) * radius,
          height * (0.2 + layer * 0.066),
          Math.sin(angle) * radius,
        );
        transform.rotation.set(0, random() * 6, 0);
        transform.scale.set(
          height * (0.17 - layer * 0.013) * (0.8 + random() * 0.3),
          height * 0.17,
          height * (0.17 - layer * 0.013) * (0.8 + random() * 0.3),
        );
        transform.updateMatrix();
        trees.setMatrixAt(i * 12 + layer, transform.matrix);
      }
    }
    this.scene.add(trees);
    const grass = new T.InstancedMesh(
      new T.ConeGeometry(0.008, 0.28, 3),
      new T.MeshStandardMaterial({ color: 0x55533b, roughness: 1 }),
      600,
    );
    for (let i = 0; i < 600; i++) {
      const angle = random() * Math.PI * 2,
        radius = 2.0 + random() * 9;
      transform.position.set(Math.cos(angle) * radius, 0.1, Math.sin(angle) * radius);
      transform.scale.setScalar(0.3 + random() * 0.8);
      transform.rotation.set(random() * 0.5, random() * 6, random() * 0.5);
      transform.updateMatrix();
      grass.setMatrixAt(i, transform.matrix);
    }
    this.scene.add(grass);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth),
      height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 52 : 43;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.getDrawingBufferSize(this.size);
    this.opaque.setSize(this.size.x, this.size.y);
    const scale = this.lowQuality ? 0.45 : 0.7;
    this.volume.setSize(
      Math.max(1, Math.round(this.size.x * scale)),
      Math.max(1, Math.round(this.size.y * scale)),
    );
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }
  resetCamera() {
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.set(0, 1.1, 0);
    this.camera.position.set(3.9, 2.65, 5.2);
    this.controls.update();
    this.controls.enableDamping = true;
  }
  quality(light: boolean) {
    this.lowQuality = light;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, light ? 1 : 1.5));
    this.renderer.shadowMap.enabled = !light;
    this.firelight.castShadow = !light;
    this.volumeMaterial.uniforms.stepCount.value = light ? 88 : 224;
    (this.sparks.material as T.ShaderMaterial).uniforms.pixelRatio.value =
      this.renderer.getPixelRatio();
    this.sparks.geometry.setDrawRange(0, light ? 60 : 180);
    this.scene.traverse((object) => {
      if (object instanceof T.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((m) => {
          m.needsUpdate = true;
        });
      }
    });
    this.frames = [];
    this.previousFrame = 0;
    this.resize();
  }
  render() {
    const now = performance.now();
    if (this.previousFrame && !document.hidden) {
      this.frames.push(now - this.previousFrame);
      if (this.frames.length > 120) this.frames.shift();
    }
    this.previousFrame = now;
    const time = this.world.time;
    this.wood.forEach((w, i) => {
      const s = this.world.sticks[i];
      w.mesh.visible = !!s;
      this.sourceA[i].set(0, 0, 0, 0);
      if (!s) return;
      w.mesh.position.copy(s.a).add(s.b).multiplyScalar(0.5);
      this.direction.subVectors(s.b, s.a);
      w.mesh.quaternion.setFromUnitVectors(this.axis, this.direction.normalize());
      w.mesh.scale.set(s.radius, s.length + s.radius * 0.5, s.radius);
      for (const part of [w.bark, w.ends]) {
        part.uniforms.charring.value = s.char;
        part.uniforms.ember.value = s.ember;
        part.uniforms.clock.value = time;
      }
      this.sourceA[i].set(s.a.x, s.a.y, s.a.z, s.flame);
      this.sourceB[i].set(s.b.x, s.b.y, s.b.z, s.radius);
    });
    this.ashes.forEach((mesh, i) => {
      const a = this.world.ash[i];
      mesh.visible = !!a;
      if (!a) return;
      mesh.position.set(a.x, 0.025, a.z);
      mesh.rotation.y = -a.angle;
      mesh.scale.set(a.length * 0.52, 0.045, 0.13);
      mesh.material.emissiveIntensity = a.ember * (0.6 + 0.15 * Math.sin(time * 2 + i));
    });
    for (let i = 0; i < 180; i++) {
      const life = 2.2 + (i % 7) * 0.3,
        age = (time * (0.7 + (i % 11) * 0.057) + i * 0.391) % life;
      const fraction = age / life,
        theta = i * 2.399 + age * 1.3;
      const source = this.world.sticks[i % Math.max(1, this.world.sticks.length)];
      const baseX = source ? (source.a.x + source.b.x) * 0.5 : 0,
        baseZ = source ? (source.a.z + source.b.z) * 0.5 : 0;
      this.sparkPositions[i * 3] =
        baseX + Math.sin(theta) * (0.2 + fraction * 0.3) + this.world.wind * age * age * 0.12;
      this.sparkPositions[i * 3 + 1] =
        (source ? (source.a.y + source.b.y) * 0.5 : 0.1) + age * 0.85;
      this.sparkPositions[i * 3 + 2] = baseZ + Math.cos(theta * 0.7) * (0.15 + fraction * 0.25);
      const glow =
        Math.pow(1 - fraction, 1.5) * Math.min(1, this.world.intensity) * (i % 5 === 0 ? 1 : 0.35);
      this.sparkColors.set([glow * 4, glow * 0.65, glow * 0.035], i * 3);
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
    const flicker = 1 + 0.025 * Math.sin(time * 2.1) + 0.012 * Math.sin(time * 4.7);
    this.firelight.intensity =
      (Math.min(1.7, this.world.intensity) * 34 + this.world.glow * 3) * flicker;
    this.firelight.position.set(
      Math.sin(time * 1.2) * 0.035,
      1.3 + Math.sin(time * 1.7) * 0.035,
      Math.cos(time * 1.4) * 0.03,
    );
    this.bounce.intensity = this.world.glow * 4;
    this.volumeMaterial.uniforms.time.value = time;
    this.volumeMaterial.uniforms.wind.value = this.world.wind;
    this.volumeMaterial.uniforms.intensity.value = this.world.intensity;
    // Heat-weighted plume origin joins the wood sources into one buoyant column.
    this.plume.set(0, 0, 0, 0);
    for (const s of this.world.sticks) {
      this.plume.x += (s.a.x + s.b.x) * 0.5 * s.flame;
      this.plume.y += (s.a.y + s.b.y) * 0.5 * s.flame;
      this.plume.z += (s.a.z + s.b.z) * 0.5 * s.flame;
      this.plume.w += s.flame;
    }
    const power = this.plume.w;
    this.plume.multiplyScalar(1 / Math.max(power, 0.0001));
    this.plume.w = power;
    this.composite.uniforms.time.value = time;
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.renderer.info.reset();
    this.renderer.setRenderTarget(this.opaque);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(this.volume);
    this.renderer.render(this.volumeScene, this.screenCamera);
    this.renderer.setRenderTarget(null);
    this.composer.render();
  }
  stats() {
    const sorted = [...this.frames].sort((a, b) => a - b);
    return {
      camera: this.camera.position.toArray(),
      light: this.lowQuality,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      drawCalls: this.renderer.info.render.calls,
      frameMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      p95FrameMs: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
      volumeSize: [this.volume.width, this.volume.height],
      fireRendering: 'procedural-volume',
      animationTime: this.world.time,
      volumeSteps: this.volumeMaterial.uniforms.stepCount.value,
    };
  }
  dispose() {
    this.observer.disconnect();
    this.controls.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    for (const scene of [this.scene, this.volumeScene])
      scene.traverse((object) => {
        if (object instanceof T.Mesh || object instanceof T.Points) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) =>
            materials.add(m),
          );
        }
        if (object instanceof T.InstancedMesh) object.dispose();
      });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.firelight.shadow.dispose();
    this.opaque.dispose();
    this.volume.dispose();
    this.turbulence.dispose();
    this.composer.passes.forEach((p) => p.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
