import { BVHShaderGLSL } from 'three-mesh-bvh';
import { LAMP_COLOR, LAMP_INTENSITY, SUN_INTENSITY } from './lighting';

export const fullscreenVertex = `out vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

// Optical equations and photon-area projection follow CAUSTIC//VOLUME's approach.
// See public/licenses/caustic-volume.txt and docs/aquarium-research.md.
export const opticalCommon = `
precision highp sampler2DArray;
precision highp usampler2D;
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}
uniform BVH fishBvh;
uniform sampler2D fishNormals, fishUvs, surfaceMap;
uniform sampler2DArray fishMaps;
uniform vec4 fishColors[8], fishProperties[8];
uniform vec2 fishNormalScales[8];
uniform int fishCount, ballCount;
uniform vec4 balls[6];
uniform vec3 ballColors[6];
uniform vec3 sunDirection, lightColor, lampPosition;
uniform float sunPower, lampPower, ambient, daylight, sunset;
const vec3 ABSORB=vec3(.22,.052,.025);
const vec3 SCATTER=vec3(.017,.031,.036);
const float LEVEL=1.65, PI=3.14159265359;
const vec3 LAMP_COLOR=vec3(${LAMP_COLOR.join(',')});
const float SUN_INTENSITY=${SUN_INTENSITY.toFixed(1)}, LAMP_INTENSITY=${LAMP_INTENSITY.toFixed(1)};
vec2 hitMaterial=vec2(.6,0.);
vec3 surface(vec2 p){ return texture(surfaceMap,clamp(p/vec2(6.,3.6)+.5,0.,1.)).xyz; }
vec3 surfaceNormal(vec2 p){vec3 s=surface(p);return normalize(vec3(-s.y,1.,-s.z));}
float fresnel(float cosine,float a,float b){
  float si=a/b*sqrt(max(0.,1.-cosine*cosine)); if(si>=1.)return 1.;
  float ct=sqrt(max(0.,1.-si*si));
  float s=(a*cosine-b*ct)/(a*cosine+b*ct),p=(a*ct-b*cosine)/(a*ct+b*cosine);
  return .5*(s*s+p*p);
}
float sphereHit(vec3 ro,vec3 rd,vec4 s){vec3 o=ro-s.xyz;float b=dot(o,rd),h=b*b-dot(o,o)+s.w*s.w;if(h<0.)return 1e5;float t=-b-sqrt(h);return t>.001?t:1e5;}
vec3 sky(vec3 d){
  vec3 night=mix(vec3(.012,.019,.029),vec3(.002,.005,.013),max(d.y,0.));
  vec3 day=mix(vec3(.016,.055,.062),vec3(.11,.23,.30),smoothstep(-.15,.4,d.y));
  day=mix(day,vec3(.28,.12,.055)*(1.-.5*max(d.y,0.)),sunset*.75);
  vec3 c=mix(night,day,daylight);
  c+=lightColor*sunPower*(pow(max(0.,dot(d,sunDirection)),1200.)*5.+pow(max(0.,dot(d,sunDirection)),24.)*.12);
  return c;
}
vec3 lightDirection(vec3 p){return lampPower>0.?normalize(lampPosition-p):sunDirection;}
vec3 incident(vec3 p){
  vec3 d=p-lampPosition; float d2=max(dot(d,d),.02);
  float cone=smoothstep(.55,.88,-normalize(d).y);
  return lightColor*sunPower*SUN_INTENSITY+LAMP_COLOR*lampPower*LAMP_INTENSITY*cone/d2;
}
bool fishHit(vec3 ro,vec3 rd,inout float distance,out vec3 normal,out vec4 albedo){
  if(fishCount==0)return false;
  float moved=0.;
  for(int a=0;a<6;a++){
    uvec4 ids=uvec4(0); vec3 n=vec3(0),bc=vec3(0);float side=1.,d=1e5;
    bool hit=bvhIntersectFirstHit(fishBvh,ro+rd*moved,rd,ids,n,bc,side,d);
    if(!hit||d+moved>=distance)return false;
    vec3 uva=texelFetch1D(fishUvs,ids.x).xyz;
    vec2 uv=uva.xy*bc.x+texelFetch1D(fishUvs,ids.y).xy*bc.y+texelFetch1D(fishUvs,ids.z).xy*bc.z;
    int mat=clamp(int(uva.z+.5),0,7);
    if(fishProperties[mat].w>.5)uv.y=1.-uv.y;
    vec4 tex=texture(fishMaps,vec3(uv,float(mat*2)));
    tex.rgb=mix(tex.rgb/12.92,pow((tex.rgb+.055)/1.055,vec3(2.4)),step(vec3(.04045),tex.rgb));
    tex*=fishColors[mat];
    if(tex.a>=fishProperties[mat].z){
      normal=normalize(texelFetch1D(fishNormals,ids.x).xyz*bc.x+texelFetch1D(fishNormals,ids.y).xyz*bc.y+texelFetch1D(fishNormals,ids.z).xyz*bc.z);
      vec3 va=texelFetch1D(fishBvh.position,ids.x).xyz;
      vec3 e1=texelFetch1D(fishBvh.position,ids.y).xyz-va,e2=texelFetch1D(fishBvh.position,ids.z).xyz-va;
      vec2 u1=texelFetch1D(fishUvs,ids.y).xy-uva.xy,u2=texelFetch1D(fishUvs,ids.z).xy-uva.xy;
      float determinant=u1.x*u2.y-u1.y*u2.x;
      if(abs(determinant)>.000001){
        vec3 tangent=(e1*u2.y-e2*u1.y)/determinant;
        tangent=normalize(tangent-normal*dot(normal,tangent));
        vec3 bitangent=cross(normal,tangent)*sign(determinant);
        vec3 mapped=texture(fishMaps,vec3(uv,float(mat*2+1))).xyz*2.-1.;mapped.xy*=fishNormalScales[mat];
        normal=normalize(mat3(tangent,bitangent,normal)*mapped);
      }
      if(dot(normal,rd)>0.)normal=-normal;
      hitMaterial=fishProperties[mat].xy;
      distance=d+moved;albedo=tex;return true;
    }
    moved+=d+.002;
  }
  return false;
}
float objectDistance(vec3 ro,vec3 rd,float limit){
  float d=limit;vec3 n;vec4 c;fishHit(ro,rd,d,n,c);
  for(int i=0;i<6;i++){if(i>=ballCount)break;d=min(d,sphereHit(ro,rd,balls[i]));}return d;
}
vec2 boxRange(vec3 ro,vec3 rd,vec3 lo,vec3 hi){
  vec3 inv=sign(rd+vec3(1e-10))/max(abs(rd),vec3(1e-7));
  vec3 a=(lo-ro)*inv,b=(hi-ro)*inv;
  vec3 mn=min(a,b),mx=max(a,b);return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));
}
float waterHit(vec3 ro,vec3 rd){
  vec2 range=boxRange(ro,rd,vec3(-3.,1.15,-1.8),vec3(3.,2.15,1.8));
  float a=max(.002,range.x),b=range.y;if(b<a)return 1e5;
  float t=a;vec3 p=ro+rd*t;float old=p.y-LEVEL-surface(p.xz).x;
  for(int i=1;i<=40;i++){
    float q=mix(a,b,float(i)/40.);p=ro+rd*q;float h=p.y-LEVEL-surface(p.xz).x;
    if(old*h<=0.){float l=t,r=q;for(int j=0;j<6;j++){float m=(l+r)*.5;vec3 v=ro+rd*m;float f=v.y-LEVEL-surface(v.xz).x;if(f*old>0.)l=m;else r=m;}return(l+r)*.5;}
    old=h;t=q;
  }return 1e5;
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 sandColor(vec2 p){
  vec2 c=floor(p*6.),f=fract(p*6.);f=f*f*(3.-2.*f);
  float n=mix(mix(hash(c),hash(c+vec2(1,0)),f.x),mix(hash(c+vec2(0,1)),hash(c+1.),f.x),f.y);
  float ridges=sin(p.y*22.+sin(p.x*2.2)*1.4);
  return mix(vec3(.38,.29,.17),vec3(.69,.57,.36),.5+.35*n)*(1.+.045*ridges);
}
`;

export const photonFragment = `${opticalCommon}
in vec2 vUv;
layout(location=0)out vec4 entry;
layout(location=1)out vec4 direction;
void main(){
  vec2 xz=(vUv-.5)*vec2(6.,3.6);vec3 p=vec3(xz.x,LEVEL+surface(xz).x,xz.y),n=surfaceNormal(xz);
  vec3 L=lightDirection(p),d=refract(-L,n,1./1.333);
  float power=(1.-fresnel(max(0.,dot(n,L)),1.,1.333))*max(dot(n,L),0.);
  float lightDistance=lampPower>0.?length(lampPosition-p):40.;
  if(objectDistance(p+n*.003,L,lightDistance-.01)<lightDistance-.02)power=0.;
  float stop=objectDistance(p+d*.003,d,30.);
  entry=vec4(p,power);direction=vec4(d,stop);
}`;

export const causticVertex = `
uniform sampler2D photonEntry,photonDirection;
uniform sampler2D surfaceMap;
uniform vec3 sunDirection,lampPosition;
uniform float sliceHeight,ior,lampPower;
out vec2 oldPosition,newPosition;
out float weight,distanceTravelled;
out vec3 entryPosition;
void main(){
  vec4 a=texture(photonEntry,uv),b=texture(photonDirection,uv);
  vec3 s=texture(surfaceMap,uv).xyz,n=normalize(vec3(-s.y,1.,-s.z));
  vec3 ray=refract(lampPower>0.?normalize(a.xyz-lampPosition):-sunDirection,n,1./ior);
  float t=max(0.,(sliceHeight-a.y)/min(-.001,ray.y));vec3 p=a.xyz+ray*t;
  oldPosition=a.xz;newPosition=p.xz;entryPosition=a.xyz;
  weight=(t<b.w&&sliceHeight<a.y)?a.w:0.;distanceTravelled=t;
  gl_Position=vec4(p.x/3.,p.z/1.8,0.,1.);
}`;
export const causticFragment = `
uniform vec3 lightColor,lampPosition;
uniform vec3 spectralMask;
uniform float sunPower,lampPower;
in vec2 oldPosition,newPosition;
in float weight,distanceTravelled;
in vec3 entryPosition;
out vec4 color;
void main(){
  vec2 ox=dFdx(oldPosition),oy=dFdy(oldPosition),nx=dFdx(newPosition),ny=dFdy(newPosition);
  float area=abs(ox.x*oy.y-ox.y*oy.x)/max(abs(nx.x*ny.y-nx.y*ny.x),1e-8);
  vec3 d=entryPosition-lampPosition;
  vec3 light=lightColor*sunPower*${SUN_INTENSITY.toFixed(1)}+vec3(${LAMP_COLOR.join(',')})*lampPower*${LAMP_INTENSITY.toFixed(1)}*smoothstep(.55,.88,-normalize(d).y)/max(dot(d,d),.02);
  color=vec4(light*spectralMask*min(area,18.)*weight*exp(-vec3(.237,.083,.061)*distanceTravelled),1.);
}`;

export const traceFragment = `${opticalCommon}
in vec2 vUv;
layout(location=0)out vec4 result;
layout(location=1)out vec4 hitInfo;
uniform sampler2D backgroundMap,backgroundDepth,causticFloor,causticVolume;
uniform mat4 inverseProjection,cameraWorld,viewProjection;
uniform vec3 eye;
uniform int lightMode;
uniform vec2 resolution;
vec3 field(vec3 p){
  if(lightMode==1)return texture(causticFloor,p.xz/vec2(6.,3.6)+.5).rgb;
  float slice=clamp(p.y/1.95*23.,0.,23.);float a=floor(slice),b=min(23.,a+1.);
  vec2 uv=clamp(p.xz/vec2(6.,3.6)+.5,vec2(.004),vec2(.996));
  vec2 ua=(vec2(mod(a,4.),floor(a/4.))+uv)/vec2(4.,6.);
  vec2 ub=(vec2(mod(b,4.),floor(b/4.))+uv)/vec2(4.,6.);
  return mix(texture(causticVolume,ua).rgb,texture(causticVolume,ub).rgb,fract(slice));
}
vec3 shade(vec3 p,vec3 n,vec3 base,bool wet){
  vec3 L=lightDirection(p);vec3 lit;
  if(wet){vec3 underwaterL=-refract(-L,surfaceNormal(p.xz),1./1.333);lit=field(p)*(.18+.82*max(0.,dot(n,underwaterL)));}
  else{float vis=objectDistance(p+n*.004,L,lampPower>0.?length(lampPosition-p):40.);lit=incident(p)*max(0.,dot(n,L))*(vis<(lampPower>0.?length(lampPosition-p)-.02:39.)?0.:1.);}
  return base*(vec3(ambient)*vec3(.65,.85,1.)+lit);
}
vec3 reflectedAir(vec3 p,vec3 d){
  float lamp=sphereHit(p,d,vec4(lampPosition,.105));if(lamp<1e4)return LAMP_COLOR*(.1+lampPower*LAMP_INTENSITY*1.2);
  float dist=1e5;int id=-1;for(int i=0;i<6;i++){if(i>=ballCount)break;float t=sphereHit(p,d,balls[i]);if(t<dist){dist=t;id=i;}}
  if(id>=0){vec3 q=p+d*dist;if(q.y>LEVEL+surface(q.xz).x)return shade(q,normalize(q-balls[id].xyz),ballColors[id],false);}
  return sky(d);
}
// Nearest event: 1 surface, 2 glass wall, 3 sand, 4 fish, 5 ball.
int nearest(vec3 ro,vec3 rd,out float t,out vec3 n,out vec4 base){
  t=waterHit(ro,rd);int kind=t<1e4?1:0;n=vec3(0,1,0);base=vec4(1);
  if(kind==1)n=surfaceNormal((ro+rd*t).xz);
  for(int axis=0;axis<2;axis++)for(int side=0;side<2;side++){
    float extent=axis==0?3.:1.8;float o=axis==0?ro.x:ro.z,d=axis==0?rd.x:rd.z;
    if(abs(d)<1e-6)continue;float h=((side==0?-extent:extent)-o)/d;vec3 p=ro+rd*h;
    if(h>.002&&h<t&&p.y>0.&&p.y<2.35&&(axis==0?abs(p.z)<1.801:abs(p.x)<3.001)){
      t=h;kind=2;n=axis==0?vec3(side==0?-1.:1.,0,0):vec3(0,0,side==0?-1.:1.);
    }
  }
  if(rd.y<-.00001){float h=-ro.y/rd.y;vec3 p=ro+rd*h;if(h>.002&&h<t&&abs(p.x)<=3.&&abs(p.z)<=1.8){t=h;kind=3;n=vec3(0,1,0);base=vec4(sandColor(p.xz),1);}}
  vec3 fn;vec4 fc;if(fishHit(ro,rd,t,fn,fc)){kind=4;n=fn;base=fc;}
  for(int i=0;i<6;i++){if(i>=ballCount)break;float h=sphereHit(ro,rd,balls[i]);if(h<t){t=h;kind=5;n=normalize(ro+rd*h-balls[i].xyz);base=vec4(ballColors[i],1);}}
  return kind;
}
void main(){
  vec4 bg=texture(backgroundMap,vUv);
  vec4 unprojected=inverseProjection*vec4(vUv*2.-1.,1.,1.);
  vec3 rd=normalize(mat3(cameraWorld)*(unprojected.xyz/unprojected.w)),ro=eye;
  vec3 radiance=vec3(0),throughput=vec3(1);float primary=1e5;int primaryKind=0,terminalKind=0;
  bool wet=false,waterTravel=false;int events=lightMode==1?5:9;
  for(int bounce=0;bounce<9;bounce++){
    if(bounce>=events)break;
    float dist;vec3 n;vec4 base;int kind=nearest(ro,rd,dist,n,base);
    if(bounce==0){primary=dist;primaryKind=kind;
      if(kind==0){result=bg;hitInfo=vec4(0);return;}
      vec4 projected=viewProjection*vec4(ro+rd*dist,1.);float depth=projected.z/projected.w*.5+.5;
      if(depth>texture(backgroundDepth,vUv).r+.00001){result=bg;hitInfo=vec4(0);return;}
    }
    if(kind==0){
      if(!waterTravel){
        float opacity=clamp(1.-max(throughput.r,max(throughput.g,throughput.b)),.001,1.);
        float alpha=opacity+bg.a*(1.-opacity);
        result=vec4((radiance+throughput*bg.rgb*bg.a)/alpha,alpha);
        hitInfo=vec4(primary,float(primaryKind),0,1);return;
      }
      radiance+=throughput*sky(rd);break;
    }
    vec3 p=ro+rd*dist;
    if(wet){
      waterTravel=true;
      if(lightMode==0){
        float stepLength=dist/48.;vec3 scatter=vec3(0);
        for(int s=0;s<48;s++){
          float travel=(float(s)+.5)*stepLength;vec3 q=ro+rd*travel;
          float cosine=dot(lightDirection(q),-rd);float phase=.6+.4*cosine*cosine;
          scatter+=field(q)*SCATTER*phase*exp(-(ABSORB+SCATTER)*travel)*stepLength;
        }radiance+=throughput*scatter;
      }
      throughput*=exp(-(ABSORB+SCATTER)*dist);
    }
    if(kind>=3){
      terminalKind=kind;
      vec2 material=hitMaterial;
      vec3 lit=kind==3?base.rgb*(vec3(ambient)*vec3(.65,.85,1.)+texture(causticFloor,p.xz/vec2(6.,3.6)+.5).rgb):shade(p,n,base.rgb,wet);
      if(kind==4){
        vec3 L=wet?-refract(-lightDirection(p),surfaceNormal(p.xz),1./1.333):lightDirection(p);
        vec3 h=normalize(L-rd);float exponent=max(2.,2./pow(max(.12,material.x),4.)-2.);
        vec3 specular=mix(vec3(.04),base.rgb,material.y);
        lit=lit*(1.-material.y)+specular*(wet?field(p):incident(p))*pow(max(0.,dot(n,h)),exponent)*max(0.,dot(n,L));
      }
      if(kind==5){vec3 h=normalize(lightDirection(p)-rd);lit+=incident(p)*pow(max(0.,dot(n,h)),70.)*.35;}
      if(kind==4&&base.a<.98){radiance+=throughput*lit*base.a;throughput*=1.-base.a;ro=p+rd*.003;continue;}
      radiance+=throughput*lit;break;
    }
    if(dot(n,rd)>0.)n=-n;
    if(kind==2){
      // Parallel 12 mm glass pane: refract through both faces, retaining lateral displacement.
      bool inside=abs((p+rd*.006).x)<3.&&abs((p+rd*.006).z)<1.8;
      bool nextWet=inside&&p.y<LEVEL+surface(p.xz).x;
      float from=wet?1.333:1.,to=nextWet?1.333:1.;
      float F=fresnel(max(0.,-dot(n,rd)),from,1.5);
      vec3 glassRay=refract(rd,n,from/1.5);
      vec3 outRay=refract(glassRay,n,1.5/to);
      if(dot(outRay,outRay)<.1){rd=reflect(rd,n);ro=p+rd*.004;continue;}
      radiance+=throughput*F*reflectedAir(p+n*.006,reflect(rd,n));throughput*=1.-F;
      ro=p+glassRay*(.012/max(.15,abs(dot(n,glassRay))))+outRay*.014;rd=outRay;wet=nextWet;
    }else{
      float from=wet?1.333:1.,to=wet?1.:1.333;
      float F=fresnel(max(0.,-dot(n,rd)),from,to);
      vec3 transmitted=refract(rd,n,from/to);
      if(dot(transmitted,transmitted)<.1){rd=reflect(rd,n);ro=p+rd*.004;continue;}
      radiance+=throughput*F*reflectedAir(p+n*.004,reflect(rd,n));
      throughput*=1.-F;rd=transmitted;wet=!wet;ro=p+rd*.004;
    }
    if(max(throughput.r,max(throughput.g,throughput.b))<.005)break;
  }
  if(primaryKind==1){vec3 p=eye+normalize(mat3(cameraWorld)*(unprojected.xyz/unprojected.w))*primary;vec3 L=lightDirection(p);float glint=pow(max(0.,dot(reflect(-L,surfaceNormal(p.xz)),-normalize(p-eye))),lampPower>0.?180.:700.);radiance+=incident(p)*glint*.18;}
  result=vec4(max(radiance,vec3(0)),1.);
  hitInfo=vec4(primary<1e4?primary:0.,float(primaryKind),float(terminalKind),1.);
}`;

export const temporalFragment = `
in vec2 vUv;out vec4 color;
uniform sampler2D currentMap,historyMap,currentInfo,historyInfo;
uniform vec2 texel;
uniform float historyWeight;
void main(){vec4 now=texture(currentMap,vUv),old=texture(historyMap,vUv);
 vec3 hit=texture(currentInfo,vUv).xyz,previous=texture(historyInfo,vUv).xyz;
 vec3 lo=now.rgb,hi=now.rgb;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 c=texture(currentMap,vUv+vec2(x,y)*texel).rgb;lo=min(lo,c);hi=max(hi,c);}
 float valid=abs(hit.x-previous.x)<.006&&hit.y==previous.y&&hit.z==previous.z&&hit.z!=4.&&hit.z!=5.&&length(now.rgb-old.rgb)<.12?historyWeight:0.;
 color=vec4(mix(now.rgb,clamp(old.rgb,lo,hi),valid),now.a);
}`;
export const outputFragment = `
in vec2 vUv;uniform sampler2D colorMap;uniform vec2 texel;uniform float bloom;
void main(){vec4 c=texture(colorMap,vUv);vec3 glow=vec3(0.);
 for(int i=0;i<8;i++){float a=float(i)*.785398;vec3 s=texture(colorMap,vUv+vec2(cos(a),sin(a))*texel*5.).rgb;glow+=max(s-vec3(1.2),vec3(0.));}
 gl_FragColor=vec4(c.rgb+glow*(bloom/8.),c.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=gl_FragColor.a;
}`;
