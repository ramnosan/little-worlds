/** Linear optical/material values shared by traced and raster water. */
export const ABSORPTION = [0.5, 0.075, 0.035] as const;
export const SCATTERING = [0.017, 0.031, 0.036] as const;
export const EXTINCTION = ABSORPTION.map((v, i) => v + SCATTERING[i]);
export const extinctionGLSL = `vec3(${EXTINCTION.join(',')})`;
export const diffuseGLSL = `
vec3 aquariumDiffuse(vec3 albedo,vec3 irradiance){return albedo*irradiance/3.14159265359;}
`;
export const sandGLSL = `
float sandHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 sandColor(vec2 p){
  vec2 c=floor(p*6.),f=fract(p*6.);f=f*f*(3.-2.*f);
  float n=mix(mix(sandHash(c),sandHash(c+vec2(1,0)),f.x),mix(sandHash(c+vec2(0,1)),sandHash(c+1.),f.x),f.y);
  float ridges=sin(p.y*22.+sin(p.x*2.2)*1.4);
  return mix(vec3(.52,.51,.46),vec3(.76,.74,.68),.5+.35*n)*(1.+.025*ridges);
}
`;
