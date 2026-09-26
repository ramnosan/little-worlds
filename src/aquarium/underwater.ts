import * as T from 'three';

/** Gentle caustics and depth tint on the directly rendered fish. */
export class UnderwaterLighting {
  private configured = new WeakSet<T.Material>();
  constructor(
    private readonly heights: T.Texture,
    private readonly time: { value: number },
  ) {}
  prepare(material: T.MeshStandardMaterial) {
    if (this.configured.has(material)) return;
    this.configured.add(material);
    if (material.transparent) {
      material.alphaTest = Math.max(material.alphaTest, 0.08);
      material.depthWrite = true;
    }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.aqWaterHeights = { value: this.heights };
      shader.uniforms.aqTime = this.time;
      shader.vertexShader = 'varying vec3 aqWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        'aqWorld=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>',
      );
      shader.fragmentShader =
        `varying vec3 aqWorld;
        uniform sampler2D aqWaterHeights; uniform float aqTime;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `
        float aqSurface=1.65+texture2D(aqWaterHeights,clamp(aqWorld.xz/vec2(6.,3.6)+.5,0.,1.)).r;
        vec2 cp=aqWorld.xz*8.+vec2(sin(aqWorld.z*7.+aqTime*.6),cos(aqWorld.x*5.-aqTime*.5))*.4;
        float glimmer=pow(max(0.,1.-abs(sin(cp.x)+sin(cp.y))*.65),12.);
        outgoingLight*=.65*(1.+.12*glimmer);
        float waterDepth=max(0.,aqSurface-aqWorld.y);
        outgoingLight=mix(outgoingLight,vec3(.025,.18,.20),1.-exp(-waterDepth*.18));
        #include <opaque_fragment>
      `,
      );
    };
    material.customProgramCacheKey = () => 'aq-koi-direct-v1';
    material.needsUpdate = true;
  }
}
