import * as T from 'three';
import { AquariumWorld, NX, NZ, WIDTH, DEPTH } from './physics';
import { createDetailWaves, detailAmplitude, addDetailWave, detailWaveGLSL } from './wave-detail';

/** Physics stays on the CPU; optical detail is composed once per frame on the GPU. */
export class AquariumSurface {
  readonly heights = new Float32Array(NX * NZ);
  private readonly data = new Float32Array(NX * NZ * 4);
  private readonly cpuTexture = new T.DataTexture(this.data, NX, NZ, T.RGBAFormat, T.FloatType);
  private readonly source = new T.DataTexture(
    new Float32Array(NX * NZ),
    NX,
    NZ,
    T.RedFormat,
    T.FloatType,
  );
  private target?: T.WebGLRenderTarget;
  private scene?: T.Scene;
  private material?: T.ShaderMaterial;
  private geometry?: T.PlaneGeometry;
  private camera = new T.Camera();
  private lastTime = NaN;
  private detail = 1;
  private readonly detailWaves = createDetailWaves();
  private readonly waves = this.detailWaves.map((w) => new T.Vector4(w.kx, w.kz, w.speed, w.phase));
  private readonly amplitudes = new Float32Array(24);
  private readonly sample = new T.Vector3();
  get texture(): T.Texture {
    return this.target?.texture ?? this.cpuTexture;
  }
  constructor() {
    this.cpuTexture.minFilter = this.cpuTexture.magFilter = T.LinearFilter;
    this.source.minFilter = this.source.magFilter = T.NearestFilter;
    this.cpuTexture.name = 'Aquarium shared height and slope';
  }
  enableGPU() {
    this.target = new T.WebGLRenderTarget(301, 181, { type: T.HalfFloatType, depthBuffer: false });
    this.target.texture.name = 'Aquarium shared GPU height and slope';
    this.material = new T.ShaderMaterial({
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `
        varying vec2 vUv;uniform sampler2D source;
        uniform vec4 waves[24];uniform float amplitudes[24],time,detail;
        ${detailWaveGLSL}
        float heightAt(vec2 uv){
          vec2 p=clamp(uv,0.,1.)*vec2(100.,60.);vec2 cell=min(floor(p),vec2(99.,59.)),f=p-cell;
          vec2 a=(cell+.5)/vec2(101.,61.),d=1./vec2(101.,61.);
          return mix(mix(texture2D(source,a).r,texture2D(source,a+vec2(d.x,0.)).r,f.x),
            mix(texture2D(source,a+vec2(0.,d.y)).r,texture2D(source,a+d).r,f.x),f.y);
        }
        void main(){
          vec2 p=(vUv-.5)*vec2(6.,3.6);vec2 e=1./vec2(300.,180.);
          vec3 value=vec3(heightAt(vUv),
            (heightAt(vUv+vec2(e.x,0.))-heightAt(vUv-vec2(e.x,0.)))/.04,
            (heightAt(vUv+vec2(0.,e.y))-heightAt(vUv-vec2(0.,e.y)))/.04);
          for(int i=0;i<24;i++){
            value+=detailWave(waves[i],amplitudes[i]*detail,float(i),p,time);
          }
          gl_FragColor=vec4(value,1.);
        }`,
      uniforms: {
        source: { value: this.source },
        waves: { value: this.waves },
        amplitudes: { value: this.amplitudes },
        time: { value: 0 },
        detail: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.geometry = new T.PlaneGeometry(2, 2);
    this.scene = new T.Scene();
    this.scene.add(new T.Mesh(this.geometry, this.material));
  }
  update(world: AquariumWorld, renderer?: T.WebGLRenderer) {
    const dt = Number.isFinite(this.lastTime) ? Math.max(0, world.time - this.lastTime) : 0;
    if (!Number.isFinite(this.lastTime) || world.time < this.lastTime)
      this.detail = world.waveMaker ? 1 : 0;
    this.lastTime = world.time;
    this.detail += ((world.waveMaker ? 1 : 0) - this.detail) * (1 - Math.exp(-dt * 2));
    this.heights.set(world.heights);
    for (let i = 0; i < 24; i++)
      this.amplitudes[i] = detailAmplitude(this.detailWaves[i], world.time);
    if (this.target && this.scene && this.material && renderer) {
      this.source.image.data = world.heights;
      this.source.needsUpdate = true;
      this.material.uniforms.time.value = world.time;
      this.material.uniforms.detail.value = this.detail * world.strength;
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(this.target);
        renderer.render(this.scene, this.camera);
      } finally {
        renderer.setRenderTarget(previous);
      }
      return;
    }
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const x = (i * WIDTH) / (NX - 1) - WIDTH / 2,
          z = (j * DEPTH) / (NZ - 1) - DEPTH / 2;
        const k = j * NX + i;
        this.sample.set(
          world.heights[k],
          (world.heights[j * NX + Math.min(NX - 1, i + 1)] -
            world.heights[j * NX + Math.max(0, i - 1)]) /
            0.12,
          (world.heights[Math.min(NZ - 1, j + 1) * NX + i] -
            world.heights[Math.max(0, j - 1) * NX + i]) /
            0.12,
        );
        for (let w = 0; w < 6; w++)
          addDetailWave(
            this.sample,
            this.detailWaves[w],
            w,
            x,
            z,
            world.time,
            this.amplitudes[w] * this.detail * world.strength,
          );
        this.heights[k] = this.sample.x;
        this.data[k * 4] = this.sample.x;
        this.data[k * 4 + 1] = this.sample.y;
        this.data[k * 4 + 2] = this.sample.z;
      }
    this.cpuTexture.needsUpdate = true;
  }
  dispose() {
    this.cpuTexture.dispose();
    this.source.dispose();
    this.target?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
  }
}
