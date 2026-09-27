# Aquarium caustic correction

Implemented 27 September 2026 in both High quality and Efficient. Sand is retained with a shared neutral, pale material. The original warm lamp position, color and power, exposure, bloom strength, controls, deterministic simulation and mode preference are unchanged.

## What changed

Traced floor and object diffuse shading now use `albedo × irradiance / π`. Specular response and emitter radiance remain separate. Efficient replaces the underwater sun/lamp irradiance before Three.js applies shadows and its material BRDF; caustics no longer multiply already-lit color or get clipped at an arbitrary brightness of five. Ambient and environment fill remain separate and subdued.

Photon launch weighting uses the horizontal grid area. Additive HDR projection has finite-value checks and a per-triangle compression ceiling of 40, preserving bright folds without unbounded singularities. Shared RGB absorption is `[0.5, 0.075, 0.035]` per metre; scattering remains `[0.017, 0.031, 0.036]`. Photon maps include the light-path attenuation. The traced renderer then attenuates actual underwater viewing segments. Efficient approximates the straight viewing segment to the water surface or tank wall. Its projected fish lighting removes only the extra fish-to-floor attenuation already present in the floor map; it remains an approximation, not a volume or refracted shadow solution.

The shared height/slope field now includes 24 seeded curved wave crests with slow amplitude modulation, adapted from [CAUSTIC//LITE](https://github.com/ScottieFox/caustic-volume/blob/main/lite/index.html). Analytical slopes include the crest-bending derivative. Detail is calibrated for the existing 45% default wave control; long swells stay restrained. The six-wave CPU capability fallback uses the same equations. All detail follows simulation time, including pause, reset and gentle-wave fading. The reference MIT attribution is retained in the source and distributed license.

Efficient retains its 128 × 80 photon grid, 512 × 320 light texture, 15 Hz effects and 30 fps frame limit. No new render targets, BVH work, tracing, volume passes or bloom were added to Efficient.

## Validation

- All **110 unit tests passed**, including numerical checks of curved-wave derivatives, deterministic generation/reset, pause, detail fading and unchanged CPU simulation heights.
- All **22 aquarium/koi/reflection/aquarium-localization browser tests passed** across the final runs. Coverage includes both sun and lamp HDR diffuse response, photon occlusion/ripples, flat water, transparent fins, lamp alignment, front/side waterline visibility at noon/night, failed assets, paused lighting, mode switching and stable GPU resources.
- The HDR test measures zero, one, two and eight units of caustic irradiance before tone mapping, verifies `albedo × irradiance / π` plus the represented viewing attenuation, and confirms that the original raster light is not multiplied into the result again.
- At fixed 22:00, simulation time eight seconds and 45% waves, the photon-map 90th/10th percentile ratio, normalized against flat water at each location, is **3.65 High / 3.35 Efficient**. Final central-floor luminance ratios are **2.44 / 1.88**, with **zero white-clipped pixels** in that sampled region. These are scene-specific contrast checks, not universal image-quality metrics.
- Production build, TypeScript, changed-file formatting and all **12 desktop/mobile production layout checks passed**. The existing large Three.js bundle warning remains.
- The broader localization run has **one unrelated failure**: the existing loading-screen changes expose two alerts after WebGL initialization fails, while the test expects one. It fails on Model Flight before reaching the aquarium. Those checkout changes and the localization test were left intact. A koi test interrupted by a development-server reload passed on a clean rerun.

## Captures and performance

Reproduce with Vite on port 5174:

```sh
node scripts/review-aquarium-efficient.mjs artifacts/aquarium-caustics-final
```

The output includes both modes at noon, sunset and night from oblique, overhead and shallow angles, six balls at 100% waves, a mobile-sized viewport, and `review.json`. Earlier before-correction captures remain in `artifacts/aquarium-efficient`. These artifact directories are intentionally ignored by Git. Visual inspection confirms cooler underwater color, brighter caustic folds separated by darker cells, the retained warm lamp and authored koi markings; fish outside the lamp pool are naturally darker. Efficient's lower photon resolution remains visible at close views. The final capture run reported no browser/WebGL errors.

Measured on Windows 10, Chrome 153, NVIDIA GeForce RTX 3060 Ti through ANGLE D3D11. Desktop viewport 1440 × 1000, night, six balls, 100% waves; warm four-second samples with asynchronous GPU timer queries:

| Mode         | Rendered fps | CPU submission / frame | GPU / frame | GPU time / second | Geometries / textures |
| ------------ | -----------: | ---------------------: | ----------: | ----------------: | --------------------: |
| High quality |        143.9 |                0.99 ms |     5.78 ms |          830.3 ms |               22 / 28 |
| Efficient    |         30.1 |                1.34 ms |     3.63 ms |          109.2 ms |               26 / 11 |

Efficient used **86.9% less GPU time per second**, exceeding the 50% target. GPU cost per rendered frame fell by about 37%; the frame cap supplies the rest of the per-second reduction. CPU submission excludes simulation. These short measurements are hardware/browser dependent, not electrical power measurements. The mobile-sized viewport achieved 30.0 fps on the same desktop GPU; **physical-mobile performance remains unverified**.
