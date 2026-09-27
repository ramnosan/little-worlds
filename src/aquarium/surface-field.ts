import * as T from 'three';
import { AquariumWorld, NX, NZ, WIDTH, DEPTH } from './physics';

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
  private readonly waves = Array.from({ length: 24 }, (_, i) => {
    const angle = i * 2.399963 + Math.sin(i * 7.1) * 0.3;
    const k = (2 * Math.PI) / (1.2 * Math.pow(0.1, i / 23));
    return new T.Vector4(Math.cos(angle) * k, Math.sin(angle) * k, Math.sqrt(9.81 * k), i * 1.73);
  });
  private readonly amplitudes = this.waves.map((w) => 0.7 / (w.x * w.x + w.y * w.y));
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
            vec4 w=waves[i];float phase=dot(w.xy,p)-w.z*time+w.w,a=amplitudes[i]*detail;
            value+=vec3(sin(phase),w.x*cos(phase),w.y*cos(phase))*a;
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
        let h = world.heights[j * NX + i];
        for (let w = 0; w < this.waves.length; w++) {
          const wave = this.waves[w];
          h +=
            Math.sin(wave.x * x + wave.y * z - wave.z * world.time + wave.w) *
            this.amplitudes[w] *
            this.detail *
            world.strength;
        }
        this.heights[j * NX + i] = h;
        this.data[(j * NX + i) * 4] = h;
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
