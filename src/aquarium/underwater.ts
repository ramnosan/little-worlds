import * as T from 'three';
import { extinctionGLSL, sandGLSL } from './appearance';

// The photon map stores horizontal irradiance including light-path attenuation.
// Convert to perpendicular irradiance before Three's BRDF applies N dot L and 1/pi.
const causticLightGLSL = `
void aquariumKeyLight(inout IncidentLight light,vec3 sourceColor){
  vec2 uv=clamp(aqWorld.xz/vec2(6.,3.6)+.5,0.,1.);
  vec3 surface=texture2D(aqWaterHeights,uv).xyz;
  if(aqWorld.y>=1.65+surface.x||max(sourceColor.r,max(sourceColor.g,sourceColor.b))<=0.)return;
  vec3 air=inverseTransformDirection(light.direction,viewMatrix);
  vec3 ray=refract(-air,normalize(vec3(-surface.y,1.,-surface.z)),1./1.333);
  float vertical=max(.2,-ray.y),extra=max(0.,aqWorld.y)/vertical;
  vec2 floorUv=(aqWorld+ray*extra).xz/vec2(6.,3.6)+.5;
  vec3 flux=texture2D(aqCaustics,clamp(floorUv,0.,1.)).rgb;
  // Fish use a projected floor field; undo only the extra fish-to-floor segment.
  light.color=flux*exp(${extinctionGLSL}*extra)/vertical;
  light.direction=normalize(mat3(viewMatrix)*(-ray));
  light.visible=true;
}
float aquariumViewDistance(float level){
  vec3 d=normalize(cameraPosition-aqWorld);
  float t=length(cameraPosition-aqWorld);
  if(d.y>1e-5)t=min(t,max(0.,(level-aqWorld.y)/d.y));
  if(abs(d.x)>1e-5)t=min(t,max(0.,((d.x>0.?3.:-3.)-aqWorld.x)/d.x));
  if(abs(d.z)>1e-5)t=min(t,max(0.,((d.z>0.?1.8:-1.8)-aqWorld.z)/d.z));
  return aqWorld.y<level?t:0.;
}
`;

/** Raster caustics preserve the fish's authored material and transparency. */
export class UnderwaterLighting {
  private configured = new WeakSet<T.Material>();
  constructor(
    private readonly heights: T.Texture,
    private readonly caustics: T.IUniform<T.Texture>,
  ) {}
  prepare(material: T.MeshStandardMaterial, floor = false) {
    if (this.configured.has(material)) return;
    this.configured.add(material);
    if (material.transparent) {
      material.alphaTest = Math.max(material.alphaTest, 0.08);
      material.depthWrite = true;
    }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.aqWaterHeights = { value: this.heights };
      shader.uniforms.aqCaustics = this.caustics;
      shader.vertexShader = 'varying vec3 aqWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        'aqWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>',
      );
      shader.fragmentShader =
        'varying vec3 aqWorld;uniform sampler2D aqWaterHeights,aqCaustics;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_pars_begin>',
        '#include <lights_pars_begin>\n' + causticLightGLSL + (floor ? sandGLSL : ''),
      );
      // Replace each active key's irradiance BEFORE its shadow and material response.
      // An inactive source stays black; ambient/IBL are never multiplied by caustics.
      let lights = T.ShaderChunk.lights_fragment_begin;
      for (const [type, variable] of [
        ['Spot', 'spotLight'],
        ['Directional', 'directionalLight'],
      ] as const) {
        const call =
          type === 'Spot'
            ? 'getSpotLightInfo( spotLight, geometryPosition, directLight );'
            : 'getDirectionalLightInfo( directionalLight, directLight );';
        lights = lights.replace(call, call + `\n aquariumKeyLight(directLight,${variable}.color);`);
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        lights,
      );
      if (floor)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n diffuseColor.rgb*=sandColor(aqWorld.xz);',
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        vec2 aqUv=clamp(aqWorld.xz/vec2(6.,3.6)+.5,0.,1.);
        float aqLevel=1.65+texture2D(aqWaterHeights,aqUv).r;
        outgoingLight*=exp(-${extinctionGLSL}*aquariumViewDistance(aqLevel));
        #include <opaque_fragment>
      `,
      );
    };
    material.customProgramCacheKey = () => 'aq-raster-caustics-v3-' + floor;
    material.needsUpdate = true;
  }
}
