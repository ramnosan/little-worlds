import * as T from 'three';
import type { AquariumWorld } from './physics';
import type { AquariumLight } from './lighting';
import { LAMP_POSITION, LAMP_COLOR, LAMP_INTENSITY, SUN_INTENSITY } from './lighting';

// Photon-area projection adapted from CAUSTIC//VOLUME; see public/licenses/caustic-volume.txt.
// This pass has no mesh queries or animated-geometry bridge.
export class EfficientCaustics {
  readonly target: T.WebGLRenderTarget;
  readonly uniform: T.IUniform<T.Texture>;
  updates = 0;
  private geometry = new T.PlaneGeometry(2, 2, 127, 79);
  private material: T.ShaderMaterial;
  private scene = new T.Scene();
  private camera = new T.Camera();
  constructor(surface: T.Texture, hdr: boolean) {
    this.target = new T.WebGLRenderTarget(512, 320, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
      depthBuffer: false,
    });
    this.uniform = { value: this.target.texture };
    this.material = new T.ShaderMaterial({
      uniforms: {
        surfaceMap: { value: surface },
        sun: { value: new T.Vector3() },
        color: { value: new T.Color() },
        sunPower: { value: 1 },
        lampPower: { value: 0 },
        balls: { value: Array.from({ length: 6 }, () => new T.Vector4()) },
        ballCount: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D surfaceMap;uniform vec3 sun;uniform float lampPower;
        uniform vec4 balls[6];uniform int ballCount;
        varying vec2 original,projected;varying vec3 entry;varying float weight,travel;
        float sphere(vec3 p,vec3 d,vec4 s){vec3 o=p-s.xyz;float b=dot(o,d),h=b*b-dot(o,o)+s.w*s.w;return h>0.?-b-sqrt(h):1e5;}
        void main(){
          vec3 s=texture2D(surfaceMap,uv).xyz;vec2 xz=(uv-.5)*vec2(6.,3.6);
          entry=vec3(xz.x,1.65+s.x,xz.y);vec3 n=normalize(vec3(-s.y,1.,-s.z));
          vec3 lamp=vec3(${LAMP_POSITION.join(',')});
          vec3 L=lampPower>0.?normalize(lamp-entry):sun;
          vec3 d=refract(-L,n,1./1.333);travel=(.005-entry.y)/min(-.001,d.y);
          original=xz;projected=(entry+d*travel).xz;
          weight=max(0.,dot(n,L))*(1.-(.02037+.97963*pow(1.-max(0.,dot(n,L)),5.)));
          for(int i=0;i<6;i++){if(i>=ballCount)break;
            float air=sphere(entry+n*.003,L,balls[i]),wet=sphere(entry+d*.003,d,balls[i]);
            if((air>0.&&air<(lampPower>0.?length(lamp-entry):40.))||(wet>0.&&wet<travel))weight=0.;
          }
          gl_Position=vec4(projected/vec2(3.,1.8),0.,1.);
        }`,
      fragmentShader: `
        uniform vec3 color;uniform float sunPower,lampPower;
        varying vec2 original,projected;varying vec3 entry;varying float weight,travel;
        void main(){
          vec2 a=dFdx(original),b=dFdy(original),c=dFdx(projected),d=dFdy(projected);
          float compression=abs(a.x*b.y-a.y*b.x)/max(abs(c.x*d.y-c.y*d.x),1e-8);
          vec3 lampDelta=entry-vec3(${LAMP_POSITION.join(',')});
          vec3 light=color*sunPower*${SUN_INTENSITY.toFixed(1)}+vec3(${LAMP_COLOR.join(',')})*lampPower*${LAMP_INTENSITY.toFixed(1)}*smoothstep(.55,.88,-normalize(lampDelta).y)/max(.02,dot(lampDelta,lampDelta));
          gl_FragColor=vec4(light*min(compression,12.)*weight*exp(-vec3(.237,.083,.061)*travel),1.);
        }`,
      depthWrite: false,
      depthTest: false,
      transparent: true,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
      toneMapped: false,
    });
    const mesh = new T.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  render(renderer: T.WebGLRenderer, world: AquariumWorld, light: AquariumLight) {
    const u = this.material.uniforms;
    u.sun.value.fromArray(light.sunDirection);
    u.color.value.setRGB(...light.color);
    u.sunPower.value = light.sun;
    u.lampPower.value = light.lamp;
    u.ballCount.value = world.balls.length;
    world.balls.forEach((b, i) => u.balls.value[i].set(b.x, b.y, b.z, b.radius));
    const target = renderer.getRenderTarget(),
      color = renderer.getClearColor(new T.Color()),
      alpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0, 0);
      renderer.render(this.scene, this.camera);
      this.updates++;
    } finally {
      renderer.setRenderTarget(target);
      renderer.setClearColor(color, alpha);
    }
  }
  read(renderer: T.WebGLRenderer) {
    const data =
      this.target.texture.type === T.HalfFloatType
        ? new Uint16Array(512 * 320 * 4)
        : new Uint8Array(512 * 320 * 4);
    renderer.readRenderTargetPixels(this.target, 0, 0, 512, 320, data);
    return { data, width: 512, height: 320 };
  }
  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const rasterWaterVertex = `
  uniform sampler2D surfaceMap;uniform float sideSurface;
  varying vec3 vWorld;varying vec3 vNormal;
  void main(){vec3 p=position;vec4 world=modelMatrix*vec4(p,1.);
    vec3 field=texture2D(surfaceMap,clamp(world.xz/vec2(6.,3.6)+.5,0.,1.)).xyz;
    if(sideSurface<.5)p.y=field.x;else if(p.y>.5)p.y=1.65+field.x;
    vWorld=(modelMatrix*vec4(p,1.)).xyz;
    vNormal=sideSurface<.5?normalize(vec3(-field.y,1.,-field.z)):normalize(mat3(modelMatrix)*normal);
    gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
  }`;
