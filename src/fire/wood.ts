import * as T from 'three';
import { noiseGLSL } from './shaders';

export function woodGeometry(seed: number) {
  const geometry = new T.CylinderGeometry(1, 1, 1, 20, 18);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const angle = Math.atan2(z, x);
    const r = 1 + 0.035 * Math.sin(angle * 7 + seed) + 0.025 * Math.sin(y * 31 + angle * 3 + seed);
    position.setXYZ(i, x * r, y, z * r);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function woodMaterial(seed: number, end: boolean) {
  const uniforms = { charring: { value: 0 }, ember: { value: 0 }, clock: { value: 0 } };
  const material = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWood;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWood=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
      varying vec3 vWood; uniform float charring,ember,clock; ${noiseGLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      vec3 p=vWood+vec3(${seed.toFixed(2)},0,0);
      float angle=atan(vWood.z,vWood.x);
      float grain=fbm(vec3(angle*16.0,vWood.y*3.0,${seed.toFixed(2)}));
      float ridges=pow(abs(sin(angle*39.0+noise(p*5.0)*5.0)),8.0);
      float rings=0.5+0.5*sin(length(vWood.xz)*70.0+noise(p*4.0)*4.0);
      vec3 bark=mix(vec3(0.085,0.034,0.013),vec3(0.32,0.17,0.073),grain);
      bark*=0.65+ridges*0.65;
      ${end ? 'bark=mix(vec3(0.28,0.13,0.043),vec3(0.52,0.31,0.14),rings*0.3+grain*0.7);' : ''}
      float crack=smoothstep(0.97,0.998,abs(sin(angle*9.0+noise(p*4.0)*2.0)));
      crack*=smoothstep(0.4,0.7,noise(vec3(angle*3.0,vWood.y*11.0,${seed.toFixed(2)})));
      float coal=clamp(charring*1.35+noise(p*6.0)*0.3-0.15,0.0,1.0);
      diffuseColor.rgb=mix(bark,vec3(0.012,0.009,0.008)*(0.4+grain),coal);
      diffuseColor.rgb*=1.0-crack*0.65;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      float pulse=0.8+0.2*sin(clock*2.0+vWood.y*14.0+${seed.toFixed(2)});
      totalEmissiveRadiance+=vec3(1.7,0.07,0.002)*crack*ember*coal*pulse*smoothstep(0.4,0.85,charring);
      totalEmissiveRadiance+=vec3(0.035,0.001,0.0001)*ember*coal;`,
      );
  };
  material.customProgramCacheKey = () => `wood-${seed}-${end}`;
  return { material, uniforms };
}
