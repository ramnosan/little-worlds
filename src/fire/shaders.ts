export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const noiseGLSL = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1,0.2,0.3)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise(p)*0.57 + noise(p*2.03+4.1)*0.28 + noise(p*4.07+9.2)*0.15; }
`;

// Original procedural plume. The field is evaluated in world space, never on
// camera-facing sheets. Optical integration follows Beer-Lambert transmittance.
export const volumeFragment = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D tDepth;
uniform sampler3D turbulence;
uniform mat4 inverseProjection, cameraWorld;
uniform vec3 eye;
uniform vec4 plume;
uniform float time, wind, intensity, stepCount;
uniform vec4 sourceA[18], sourceB[18];

vec4 lattice(vec3 p) {
  vec3 cell=floor(p), f=fract(p);
  // Quintic interpolation gives continuous velocity/acceleration at cell edges.
  f=f*f*f*(f*(f*6.0-15.0)+10.0);
  return texture(turbulence,(cell+f+0.5)/32.0);
}
float detail(vec3 p) {
  return lattice(p).r*0.58+lattice(p*2.02+7.3).g*0.28+lattice(p*4.03+17.1).b*0.14;
}
vec3 fireColor(float temperature) {
  // Artist-exposed temperature ramp in linear HDR, inspired by hot soot emission.
  // This is not spectral Planck integration or a calibrated Kelvin measurement.
  vec3 orange=mix(vec3(1.6,0.045,0.001),vec3(3.8,0.65,0.018),smoothstep(0.0,0.5,temperature));
  return mix(orange,vec3(5.2,2.2,0.32),smoothstep(0.45,1.0,temperature));
}
void main() {
  vec4 farPoint=inverseProjection*vec4(vUv*2.0-1.0,1,1);
  vec3 ray=normalize((cameraWorld*vec4(farPoint.xyz/farPoint.w,1)).xyz-eye);
  vec4 opaque=inverseProjection*vec4(vUv*2.0-1.0,texture(tDepth,vUv).r*2.0-1.0,1);
  float opaqueDistance=length(opaque.xyz/opaque.w);
  vec3 safeRay=mix(vec3(-1.0),vec3(1.0),step(vec3(0),ray))*max(abs(ray),vec3(0.00001));
  vec3 t0=(vec3(-3,0.015,-3)-eye)/safeRay;
  vec3 t1=(vec3(5.5,6.8,3)-eye)/safeRay;
  vec3 nearAxis=min(t0,t1),farAxis=max(t0,t1);
  float start=max(0.0,max(nearAxis.x,max(nearAxis.y,nearAxis.z)));
  float end=min(opaqueDistance,min(farAxis.x,min(farAxis.y,farAxis.z)));
  if(end<=start || intensity<0.001) {fragColor=vec4(0);return;}
  float ds=(end-start)/stepCount;
  // Fixed stratification avoids stochastic per-frame brightness flashes.
  float jitter=0.5;
  float power=1.0-exp(-plume.w*0.32);
  float height=0.7+1.85*sqrt(power);
  vec3 origin=plume.xyz-vec3(0,0.18,0);
  vec3 radiance=vec3(0);
  float transmittance=1.0;
  for(int i=0;i<224;i++) {
    if(float(i)>=stepCount || transmittance<0.012)break;
    vec3 p=eye+ray*(start+(float(i)+jitter)*ds);
    float h=max(0.0,p.y-origin.y);
    float v=h/height;
    vec3 q=p-origin;
    q.x-=wind*h*h*0.13;
    // A slowly turning shared column; fine detail is carried upward with it.
    q.xz-=vec2(sin(h*1.8-time*0.85),sin(h*1.45-time*0.67+1.7))*min(h,2.5)*0.12;
    vec3 moving=q*vec3(3.8,1.85,3.8)-vec3(0,time*1.05,0);
    vec3 warp=lattice(moving*0.63+vec3(2,0,9)).rgb-0.5;
    vec3 flow=q;
    flow.xz+=warp.xz*(0.3+0.48*smoothstep(0.0,1.0,v));
    float n=detail(moving+warp*1.5);
    float fire=0.0,temperature=0.0;
    if(v<1.35) {
      float radius=(0.78-0.52*clamp(v,0.0,1.0))*sqrt(max(power,0.001));
      // The connected plume is irregular in all three dimensions. Noise erodes
      // its boundary into folds/tongues, while the lower body stays coherent.
      float radial=length(flow.xz/vec2(1.0,0.86));
      float angle=atan(flow.z,flow.x);
      float lobes=sin(angle*3.0+h*1.5-time*0.55)*0.13
        +sin(angle*5.0-h*2.0+time*0.37)*0.08;
      float envelope=1.0-radial/max(radius,0.02)-v*0.30+lobes;
      float mixture=envelope+(n-0.5)*(1.1+v*0.9);
      float upper=1.0-smoothstep(0.42,1.04,v+(n-0.5)*0.75);
      float root=smoothstep(-0.08,0.22,p.y-origin.y);
      float joined=smoothstep(0.2,2.4,plume.w);
      float body=smoothstep(-0.06,0.13,mixture)*upper*root*power*joined;
      // Luminous reaction surfaces around a less luminous fuel-rich interior.
      float sheet=exp(-abs(mixture-0.10)*7.0);
      fire=body*(0.025+sheet*1.1);
      // Small rooted flames follow the actual capsule surfaces and feed the plume.
      if(h<1.25) {
        float local=0.0;
        for(int j=0;j<18;j++) {
          float strength=sourceA[j].w;
          if(strength<0.005)continue;
          vec3 a=sourceA[j].xyz,b=sourceB[j].xyz;
          vec2 ab=b.xz-a.xz;
          float along=clamp(dot(p.xz-a.xz,ab)/max(dot(ab,ab),0.001),0.0,1.0);
          vec3 base=mix(a,b,along);
          float rise=p.y-base.y;
          vec2 offset=p.xz-base.xz-warp.xz*0.14;
          float width=sourceB[j].w*0.75+0.02+max(rise,0.0)*0.08;
          float fuel=exp(-dot(offset,offset)/(width*width));
          float lift=smoothstep(-0.05,0.12,rise)*(1.0-smoothstep(0.12,0.95,rise));
          local+=fuel*lift*strength*(0.65+0.35*sin(along*22.0+float(j)+rise*6.0-time*1.5));
        }
        fire+=max(0.0,local-0.12-n*0.35)*0.55;
      }
      temperature=clamp(0.8-v*0.55+(n-0.5)*0.75,0.0,1.0);
    }
    // Smoke uses the SAME wind, domain warp and rising flow as the flame.
    float smokeWidth=0.46+h*0.20;
    float smokeEnvelope=exp(-dot(flow.xz,flow.xz)/(smokeWidth*smokeWidth));
    float billow=detail(moving*0.65+vec3(6,0,12));
    float smoke=smokeEnvelope*smoothstep(height*0.43,height*0.92,h)
      *(1.0-smoothstep(4.4,6.4,p.y))*smoothstep(0.23,0.72,billow)*power*0.75;
    float extinction=fire*0.85+smoke;
    float alpha=1.0-exp(-extinction*ds);
    vec3 smokeLight=vec3(0.045,0.057,0.073)+vec3(0.35,0.12,0.025)*exp(-h*0.9)*power;
    vec3 emitted=fireColor(temperature)*fire*0.85+smokeLight*smoke;
    radiance+=transmittance*alpha*emitted/max(extinction,0.00001);
    transmittance*=1.0-alpha;
  }
  fragColor=vec4(radiance,1.0-transmittance);
}
`;

export const compositeFragment = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tScene, tFire;
uniform float time;
void main() {
  vec4 fire=texture2D(tFire,vUv);
  float heat=clamp(dot(fire.rgb,vec3(0.16,0.12,0.04)),0.0,1.0);
  vec2 distortion=vec2(sin(vUv.y*93.0-time*1.5),cos(vUv.x*81.0+time*1.1))*0.0007*heat;
  vec3 background=texture2D(tScene,clamp(vUv+distortion,vec2(0.001),vec2(0.999))).rgb;
  gl_FragColor=vec4(background*(1.0-fire.a)+fire.rgb,1.0);
}
`;
