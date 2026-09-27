import * as T from 'three';

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
        '#include <opaque_fragment>',
        `
        vec2 aqUv=clamp(aqWorld.xz/vec2(6.,3.6)+.5,0.,1.);
        float aqDepth=max(0.,1.65+texture2D(aqWaterHeights,aqUv).r-aqWorld.y);
        vec3 aqLight=texture2D(aqCaustics,aqUv).rgb;
        outgoingLight*=vec3(.8)+min(aqLight,vec3(5.))*.45;
        outgoingLight*=exp(-vec3(.12,.025,.015)*aqDepth);
        ${floor ? 'outgoingLight*=.94+.06*sin(aqWorld.z*24.+sin(aqWorld.x*2.8));' : ''}
        #include <opaque_fragment>
      `,
      );
    };
    material.customProgramCacheKey = () => 'aq-raster-caustics-v2-' + floor;
    material.needsUpdate = true;
  }
}
