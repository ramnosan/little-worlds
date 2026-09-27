import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { AquariumLight } from './lighting';
import { WATER_Y } from './tank';

/** Three.js's mirrored camera / oblique clip plane, independent of the wave mesh. */
export class WaterReflection {
  private readonly mirror = new Reflector(new T.PlaneGeometry(1, 1), {
    textureWidth: 1,
    textureHeight: 1,
    multisample: 0,
    clipBias: 0,
  });
  readonly matrix = new T.Matrix4();
  readonly viewMatrix = new T.Matrix4();
  readonly texture = this.mirror.getRenderTarget().texture;
  private readonly inverse = new T.Matrix4();

  constructor() {
    this.mirror.rotation.x = -Math.PI / 2;
    this.mirror.position.y = WATER_Y;
    this.mirror.updateMatrixWorld();
    this.inverse.copy(this.mirror.matrixWorld).invert();
    this.texture.name = 'Aquarium above-water reflection';
  }
  useByteTarget() {
    this.mirror.getRenderTarget().dispose();
    this.texture.type = T.UnsignedByteType;
  }

  resize(width: number, height: number, low: boolean) {
    // Resolution follows the viewport aspect and has a fixed GPU budget.
    const scale = Math.min(low ? 0.4 : 0.65, (low ? 512 : 1024) / Math.max(width, height, 1));
    this.mirror
      .getRenderTarget()
      .setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  }

  render(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.PerspectiveCamera,
    water: T.Object3D,
    sides: T.Object3D,
    light?: AquariumLight,
    submergedFish?: T.Object3D,
  ) {
    const background = scene.background;
    const intensity = scene.backgroundIntensity;
    const blur = scene.backgroundBlurriness;
    const waterVisible = water.visible,
      sidesVisible = sides.visible;
    const fishVisible = submergedFish?.visible;
    const target = renderer.getRenderTarget();
    const xr = renderer.xr.enabled,
      shadows = renderer.shadowMap.autoUpdate;
    try {
      water.visible = sides.visible = false;
      // Fish remain below the waterline; skip submitting them to the mirror pass.
      if (submergedFish) submergedFish.visible = false;
      // Keep the reflected sky in step with the tank's day/night lighting.
      scene.background = light
        ? new T.Color().setRGB(
            0.012 + light.daylight * 0.08 + light.sunset * 0.13,
            0.019 + light.daylight * 0.15 + light.sunset * 0.025,
            0.035 + light.daylight * 0.2,
          )
        : scene.environment;
      scene.backgroundIntensity = Math.min(0.65, scene.environmentIntensity);
      scene.backgroundBlurriness = 0.08;
      camera.updateMatrixWorld();
      this.mirror.onBeforeRender(
        renderer,
        scene,
        camera,
        this.mirror.geometry,
        this.mirror.material as T.Material,
        null as unknown as T.Group,
      );
      const material = this.mirror.material as T.ShaderMaterial;
      this.matrix.copy(material.uniforms.textureMatrix.value).multiply(this.inverse);
      this.viewMatrix.copy(this.mirror.camera.matrixWorldInverse);
    } finally {
      scene.background = background;
      scene.backgroundIntensity = intensity;
      scene.backgroundBlurriness = blur;
      water.visible = waterVisible;
      sides.visible = sidesVisible;
      if (submergedFish) submergedFish.visible = fishVisible!;
      renderer.xr.enabled = xr;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.setRenderTarget(target);
    }
  }

  dispose() {
    this.mirror.geometry.dispose();
    this.mirror.dispose();
  }
}

export const waterReflectionFragment = `
uniform sampler2D reflectionMap;
uniform mat4 reflectionMatrix;
uniform mat4 reflectionView;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n=normalize(vNormal);
  vec3 eye=normalize(cameraPosition-vWorld);
  float cosine=clamp(dot(n,eye),0.,1.);
  // Schlick approximation for the air/water interface (IOR 1.333).
  float fresnel=.02037+.97963*pow(1.-cosine,5.);
  vec4 projected=reflectionMatrix*vec4(vWorld,1.);
  vec2 uv=projected.xy/projected.w;
  vec3 viewSlope=mat3(reflectionView)*vec3(n.x,0.,n.z);
  vec2 offset=viewSlope.xy*.035;
  vec2 border=min(uv,1.-uv);
  float edge=smoothstep(0.,.045,min(border.x,border.y));
  uv=clamp(uv+offset*edge,vec2(.001),vec2(.999));
  vec3 reflected=texture2D(reflectionMap,uv).rgb;
  // Transparent transmission keeps the real fish visible, without a second fish image.
  float tint=.055*(1.-fresnel);
  float alpha=fresnel+tint;
  vec3 color=(reflected*fresnel+vec3(.045,.28,.30)*tint)/alpha;
  gl_FragColor=vec4(color,alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
