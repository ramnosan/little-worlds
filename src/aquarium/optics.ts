import * as T from 'three';
import type { AquariumWorld } from './physics';
import type { AquariumLight } from './lighting';
import { LAMP_POSITION } from './lighting';
import { OpticalGeometry } from './optical-geometry';
import {
  fullscreenVertex,
  photonFragment,
  causticVertex,
  causticFragment,
  traceFragment,
  temporalFragment,
  outputFragment,
} from './optical-shaders';

type Uniforms = Record<string, T.IUniform>;
const target = (w = 1, h = 1, count = 1) =>
  new T.WebGLRenderTarget(w, h, {
    type: T.HalfFloatType,
    format: T.RGBAFormat,
    minFilter: T.LinearFilter,
    magFilter: T.LinearFilter,
    depthBuffer: false,
    count,
  });

export class AquariumOptics {
  ready = false;
  readonly fish = new OpticalGeometry();
  readonly floor = target(1024, 640);
  private readonly volume = target(512, 480);
  private readonly photons = target(256, 156, 2);
  private readonly background = target();
  private readonly current = target(1, 1, 2);
  private readonly history = [target(), target()];
  private readonly oldInfo = target();
  private readonly scene = new T.Scene();
  private readonly camera = new T.Camera();
  private readonly triangle = new T.PlaneGeometry(2, 2);
  private readonly quad = new T.Mesh(this.triangle, new T.ShaderMaterial());
  private readonly photonMaterial: T.ShaderMaterial;
  private readonly causticMaterial: T.ShaderMaterial;
  private readonly traceMaterial: T.ShaderMaterial;
  private readonly temporalMaterial: T.ShaderMaterial;
  private readonly copyMaterial: T.ShaderMaterial;
  private readonly outputMaterial: T.ShaderMaterial;
  private readonly photonGrid = new T.PlaneGeometry(2, 2, 255, 155);
  private readonly causticMesh: T.Mesh;
  private readonly causticScene = new T.Scene();
  private readonly uniforms: Uniforms;
  private low = false;
  private validHistory = false;
  private historyIndex = 0;
  private previousCamera = new T.Matrix4();
  private frame = 0;
  private lastFishRevision = -1;
  private disposed = false;
  private compiling = false;

  static supported(renderer: T.WebGLRenderer) {
    if (!renderer.extensions.has('EXT_color_buffer_float')) return false;
    const gl = renderer.getContext(),
      previous = renderer.getRenderTarget();
    const probe = target(2, 2, 2);
    try {
      renderer.setRenderTarget(probe);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    } catch {
      return false;
    } finally {
      renderer.setRenderTarget(previous);
      probe.dispose();
    }
  }
  constructor(surface: T.Texture) {
    this.background.depthBuffer = true;
    this.background.depthTexture = new T.DepthTexture(1, 1, T.UnsignedIntType);
    this.background.depthTexture.minFilter = this.background.depthTexture.magFilter =
      T.NearestFilter;
    this.current.textures[1].minFilter = this.current.textures[1].magFilter = T.NearestFilter;
    this.oldInfo.texture.minFilter = this.oldInfo.texture.magFilter = T.NearestFilter;
    this.uniforms = {
      surfaceMap: { value: surface },
      fishBvh: { value: this.fish.bvh },
      fishNormals: { value: this.fish.normals },
      fishUvs: { value: this.fish.uvs },
      fishMaps: { value: this.fish.maps },
      fishColors: { value: this.fish.colors },
      fishProperties: { value: this.fish.properties },
      fishCount: { value: 0 },
      fishNormalScales: { value: this.fish.normalScales },
      balls: { value: Array.from({ length: 6 }, () => new T.Vector4()) },
      ballColors: { value: Array.from({ length: 6 }, () => new T.Color()) },
      ballCount: { value: 0 },
      sunDirection: { value: new T.Vector3() },
      lightColor: { value: new T.Color() },
      lampPosition: { value: new T.Vector3(...LAMP_POSITION) },
      sunPower: { value: 0 },
      lampPower: { value: 0 },
      daylight: { value: 1 },
      sunset: { value: 0 },
      ambient: { value: 0.2 },
    };
    const material = (fragmentShader: string, uniforms: Uniforms) =>
      new T.ShaderMaterial({
        glslVersion: T.GLSL3,
        vertexShader: fullscreenVertex,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false,
      });
    this.photonMaterial = material(photonFragment, this.uniforms);
    this.causticMaterial = new T.ShaderMaterial({
      glslVersion: T.GLSL3,
      vertexShader: causticVertex,
      fragmentShader: causticFragment,
      uniforms: {
        ...this.uniforms,
        photonEntry: { value: this.photons.textures[0] },
        photonDirection: { value: this.photons.textures[1] },
        sliceHeight: { value: 0 },
        ior: { value: 1.333 },
        spectralMask: { value: new T.Vector3(1, 1, 1) },
      },
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
    });
    this.traceMaterial = material(traceFragment, {
      ...this.uniforms,
      backgroundMap: { value: this.background.texture },
      backgroundDepth: { value: this.background.depthTexture },
      causticFloor: { value: this.floor.texture },
      causticVolume: { value: this.volume.texture },
      inverseProjection: { value: new T.Matrix4() },
      cameraWorld: { value: new T.Matrix4() },
      viewProjection: { value: new T.Matrix4() },
      eye: { value: new T.Vector3() },
      lightMode: { value: 0 },
      resolution: { value: new T.Vector2() },
    });
    this.temporalMaterial = material(temporalFragment, {
      currentMap: { value: this.current.texture },
      historyMap: { value: this.history[0].texture },
      currentInfo: { value: this.current.textures[1] },
      historyInfo: { value: this.oldInfo.texture },
      texel: { value: new T.Vector2() },
      historyWeight: { value: 0 },
    });
    this.copyMaterial = material(
      'in vec2 vUv;out vec4 color;uniform sampler2D source;void main(){color=texture(source,vUv);}',
      { source: { value: this.current.textures[1] } },
    );
    this.outputMaterial = material(
      'out vec4 outputColor;\n#define gl_FragColor outputColor\n' + outputFragment,
      {
        colorMap: { value: this.current.texture },
        texel: { value: new T.Vector2() },
        bloom: { value: 0.1 },
      },
    );
    this.quad.material.dispose();
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.causticMesh = new T.Mesh(this.photonGrid, this.causticMaterial);
    this.causticMesh.frustumCulled = false;
    this.causticScene.add(this.causticMesh);
  }
  invalidate() {
    this.validHistory = false;
  }
  async prepare(renderer: T.WebGLRenderer) {
    this.compiling = true;
    const previousTarget = renderer.getRenderTarget(),
      tone = renderer.toneMapping;
    const programs = new T.Scene();
    for (const m of [
      this.photonMaterial,
      this.traceMaterial,
      this.temporalMaterial,
      this.copyMaterial,
    ])
      programs.add(new T.Mesh(this.triangle, m));
    programs.add(new T.Mesh(this.photonGrid, this.causticMaterial));
    const output = new T.Scene();
    output.add(new T.Mesh(this.triangle, this.outputMaterial));
    let pending: Promise<unknown>[];
    try {
      renderer.toneMapping = T.NoToneMapping;
      renderer.setRenderTarget(this.current);
      const internal = renderer.compileAsync(programs, this.camera);
      renderer.toneMapping = tone;
      renderer.setRenderTarget(null);
      pending = [internal, renderer.compileAsync(output, this.camera)];
    } finally {
      renderer.toneMapping = tone;
      renderer.setRenderTarget(previousTarget);
    }
    try {
      await Promise.all(pending);
    } finally {
      this.compiling = false;
      if (this.disposed) this.disposeMaterials();
    }
    if (!this.disposed) this.ready = true;
  }
  readHits(renderer: T.WebGLRenderer) {
    const data = new Uint16Array(this.current.width * this.current.height * 4);
    renderer.readRenderTargetPixels(
      this.current,
      0,
      0,
      this.current.width,
      this.current.height,
      data,
      undefined,
      1,
    );
    return { data, width: this.current.width, height: this.current.height };
  }
  resize(width: number, height: number, low: boolean) {
    this.low = low;
    const scale = Math.min(low ? 0.65 : 1, (low ? 800 : 1440) / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale)),
      h = Math.max(1, Math.round(height * scale));
    for (const t of [this.background, this.current, ...this.history, this.oldInfo]) t.setSize(w, h);
    this.floor.setSize(low ? 512 : 1024, low ? 320 : 640);
    this.photons.setSize(low ? 128 : 256, low ? 78 : 156);
    this.temporalMaterial.uniforms.texel.value.set(1 / w, 1 / h);
    this.outputMaterial.uniforms.texel.value.set(1 / w, 1 / h);
    this.outputMaterial.uniforms.bloom.value = low ? 0 : 0.1;
    this.traceMaterial.uniforms.lightMode.value = low ? 1 : 0;
    this.traceMaterial.uniforms.resolution.value.set(w, h);
    this.invalidate();
  }
  render(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.PerspectiveCamera,
    world: AquariumWorld,
    light: AquariumLight,
    fish: T.Group,
    hidden: T.Object3D[],
  ) {
    const previousTarget = renderer.getRenderTarget(),
      previousTone = renderer.toneMapping;
    const clear = renderer.getClearColor(new T.Color()),
      alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    const visibility = hidden.map((o) => o.visible);
    try {
      // A paused view may draw only once. Allocate both ping-pong buffers together,
      // including after resize, so resuming does not allocate another texture.
      if (!this.low) for (const target of this.history) renderer.initRenderTarget(target);
      this.fish.update(fish);
      if (this.lastFishRevision !== this.fish.revision) {
        this.invalidate();
        this.lastFishRevision = this.fish.revision;
      }
      this.uniforms.fishCount.value = this.fish.count;
      this.uniforms.fishMaps.value = this.fish.maps;
      this.uniforms.sunDirection.value.fromArray(light.sunDirection);
      this.uniforms.lightColor.value.setRGB(...light.color);
      this.uniforms.sunPower.value = light.sun;
      this.uniforms.lampPower.value = light.lamp;
      this.uniforms.ambient.value = light.ambient;
      this.uniforms.daylight.value = light.daylight;
      this.uniforms.sunset.value = light.sunset;
      this.uniforms.ballCount.value = world.balls.length;
      world.balls.forEach((b, i) => {
        this.uniforms.balls.value[i].set(b.x, b.y, b.z, b.radius);
        this.uniforms.ballColors.value[i].set(b.color);
      });
      camera.updateMatrixWorld();
      if (!camera.matrixWorld.equals(this.previousCamera)) this.invalidate();
      this.previousCamera.copy(camera.matrixWorld);
      this.traceMaterial.uniforms.eye.value.copy(camera.position);
      this.traceMaterial.uniforms.cameraWorld.value.copy(camera.matrixWorld);
      this.traceMaterial.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
      this.traceMaterial.uniforms.viewProjection.value.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      );
      renderer.toneMapping = T.NoToneMapping;
      renderer.autoClear = true;
      renderer.setClearColor(0, 0);
      hidden.forEach((o) => {
        o.visible = false;
      });
      renderer.setRenderTarget(this.background);
      renderer.render(scene, camera);
      hidden.forEach((o, i) => {
        o.visible = visibility[i];
      });
      this.pass(renderer, this.photonMaterial, this.photons);
      renderer.setRenderTarget(this.floor);
      renderer.clear();
      this.causticMaterial.uniforms.sliceHeight.value = 0.005;
      renderer.autoClear = false;
      if (this.low) renderer.render(this.causticScene, this.camera);
      else
        for (let channel = 0; channel < 3; channel++) {
          this.causticMaterial.uniforms.ior.value = [1.331, 1.333, 1.337][channel];
          this.causticMaterial.uniforms.spectralMask.value.set(
            channel === 0 ? 1 : 0,
            channel === 1 ? 1 : 0,
            channel === 2 ? 1 : 0,
          );
          renderer.render(this.causticScene, this.camera);
        }
      this.causticMaterial.uniforms.ior.value = 1.333;
      this.causticMaterial.uniforms.spectralMask.value.set(1, 1, 1);
      renderer.autoClear = true;
      if (!this.low) {
        this.volume.viewport.set(0, 0, 512, 480);
        renderer.setRenderTarget(this.volume);
        renderer.clear();
        renderer.autoClear = false;
        for (let s = 0; s < 24; s++) {
          this.volume.viewport.set((s % 4) * 128, Math.floor(s / 4) * 80, 128, 80);
          renderer.setRenderTarget(this.volume);
          this.causticMaterial.uniforms.sliceHeight.value = (s / 23) * 1.95;
          renderer.render(this.causticScene, this.camera);
        }
        renderer.autoClear = true;
      }
      this.pass(renderer, this.traceMaterial, this.current);
      let color = this.current.texture;
      if (!this.low) {
        this.temporalMaterial.uniforms.historyMap.value = this.history[this.historyIndex].texture;
        this.temporalMaterial.uniforms.historyWeight.value =
          this.validHistory && !world.paused ? 0.55 : 0;
        this.historyIndex = 1 - this.historyIndex;
        this.pass(renderer, this.temporalMaterial, this.history[this.historyIndex]);
        this.pass(renderer, this.copyMaterial, this.oldInfo);
        color = this.history[this.historyIndex].texture;
      }
      this.outputMaterial.uniforms.colorMap.value = color;
      renderer.toneMapping = previousTone;
      this.pass(renderer, this.outputMaterial, previousTarget);
      this.validHistory = !world.paused;
      this.frame++;
    } finally {
      hidden.forEach((o, i) => {
        o.visible = visibility[i];
      });
      renderer.toneMapping = previousTone;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(previousTarget);
    }
  }
  private pass(
    renderer: T.WebGLRenderer,
    material: T.ShaderMaterial,
    destination: T.WebGLRenderTarget | null,
  ) {
    this.quad.material = material;
    renderer.setRenderTarget(destination);
    renderer.render(this.scene, this.camera);
  }
  readCaustics(renderer: T.WebGLRenderer) {
    const data = new Uint16Array(this.floor.width * this.floor.height * 4);
    renderer.readRenderTargetPixels(this.floor, 0, 0, this.floor.width, this.floor.height, data);
    return { data, width: this.floor.width, height: this.floor.height };
  }
  snapshot() {
    return {
      mode: 'optical',
      ready: this.ready,
      quality: this.low ? 'light' : 'high',
      frames: this.frame,
      volumeSlices: this.low ? 0 : 24,
      scatteringSamples: this.low ? 0 : 48,
      width: this.current.width,
      height: this.current.height,
      fishMeshes: this.fish.count,
      passes: this.low
        ? ['surface', 'background', 'photons', 'floor-caustics', 'tank-optics', 'output']
        : [
            'surface',
            'background',
            'photons',
            'floor-caustics',
            'volume',
            'tank-optics',
            'temporal',
            'history-depth',
            'bloom-output',
          ],
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fish.dispose();
    this.triangle.dispose();
    this.photonGrid.dispose();
    for (const t of [
      this.floor,
      this.volume,
      this.photons,
      this.background,
      this.current,
      ...this.history,
      this.oldInfo,
    ])
      t.dispose();
    // Three.js compileAsync polls material properties until linking completes.
    // Disposing those materials early removes the program that its poll needs.
    if (!this.compiling) this.disposeMaterials();
  }
  private disposeMaterials() {
    for (const m of [
      this.photonMaterial,
      this.causticMaterial,
      this.traceMaterial,
      this.temporalMaterial,
      this.copyMaterial,
      this.outputMaterial,
    ])
      m.dispose();
  }
}
