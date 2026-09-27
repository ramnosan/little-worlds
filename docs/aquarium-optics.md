# Aquarium optics and day–night cycle

Implemented 27 September 2026. The deterministic CPU simulation, fish navigation and animation, charged ripples, six-ball limit and camera controls are retained. Three.js stays at the existing r180 version. Assets remain local.

## Source basis

- Scottie Fox's [CAUSTIC//VOLUME photon projection](https://github.com/ScottieFox/caustic-volume/blob/main/sandbox/src/20_caustic.js) and [optical renderer](https://github.com/ScottieFox/caustic-volume/blob/main/sandbox/src/30_trace.js): refracted photon grids, area-compression intensity, horizontal light-field slices and absorption/scattering along optical paths. These techniques are adapted for this finite tank and its existing scene, rather than embedding the reference application. Its MIT notice is distributed in `public/licenses/caustic-volume.txt` and linked from the shader source.
- [three-mesh-bvh API](https://github.com/gkjohnson/three-mesh-bvh/blob/master/API.md): animated-geometry baking, refitting and GPU BVH query helpers. Version 0.9.15 is pinned; its MIT notice is distributed alongside the reference notice.

## Pipeline

1. `lighting.ts` supplies normalized time, automatic/manual state, sun direction, daylight/sunset strength, source color and ambient illumination. The eight-minute cycle starts at 15:00. Sun and lamp direct-light weights never overlap. Hidden frames are skipped without catch-up; pause freezes automatic time, but scrubbing remains active. Reset restores afternoon and automatic mode.
2. `surface-field.ts` combines CPU heights with 24 deterministic multidirectional waves into a 301 × 181 half-float height/slope texture. All optical intersections, refraction normals, photon emission and side waterlines use that field. Detail fades when gentle waves stop and follows simulation time, so pause freezes it. The fallback computes its lower-resolution field on the CPU. Physics never depends on GPU readback.
3. `optical-geometry.ts` bakes the actual animated fish into reused buffers, refits their BVH and uploads normals. UV/material data and base-color/normal texture arrays rebuild only when mesh assets change. Morph changes explicitly invalidate baking; synthetic skinned fixtures exercise the skeletal path. Alpha cutouts skip intersections and partially transparent fins composite along the same path.
4. A photon pass refracts the active source through the surface, recording entry, direction and the first fish/ball obstruction. Projected triangles deposit HDR illumination weighted by area compression and distance attenuation. High quality produces a 1024 × 640 floor map and 24 slices in a 512 × 480 atlas, with three nearby IORs for restrained floor dispersion.
5. The tank pass traces the moving surface, parallel glass interfaces, sand, spheres and animated fish. It handles dielectric Fresnel, Snell refraction, total internal reflection and RGB absorption. It integrates 48 light-field samples per underwater segment. Raster depth preserves the surrounding plinth, frame and visible lamp; fish, floor, balls and transparent water layers are excluded from that background.
6. High quality filters stationary-view history with neighborhood clamping and depth/material rejection. Fish and ball hits reject history; camera movement, scrubbing, resize, reset and quality changes invalidate it. Bloom is restrained, and ACES/color output runs once at final composition. Paused frames disable accumulation for exact repeatability.

The visible lamp and optical highlight share source position, color and intensity constants. The moving daylight source and night lamp also drive the raster fallback. The backdrop transitions through teal daylight, warm sunset and dark blue night. English/German controls preserve manual time when automatic mode is re-enabled.

## Quality, ownership and limits

High quality caps optical resolution at 1440 on the long edge and traverses up to nine interfaces. The former reduced-resolution optical mode has been replaced by [Efficient mode](aquarium-efficient.md), a separate 30 fps raster path with no mesh tracing. Optical targets and acceleration structures are released when entering Efficient mode and recreated asynchronously on return. Efficient rendering also runs during shader preparation and when half-float MRT creation fails; its reflection and caustic targets can use unsigned bytes.

This is a bounded real-time optical approximation, not an unbiased path tracer. Reflection branches approximate the sky, lamp and above-water balls; refracted/TIR paths continue through tank geometry. There is no diffuse multi-bounce illumination, full reflected room geometry or general mesh scene tracing. Light occlusion uses the first obstruction; partially transparent fins do not produce spectrally transmitted shadows. The material bridge retains the current assets' 1K base-color/normal maps and scalar material properties; arbitrary future emissive, roughness-map or transmission extensions require additional support. Glass panes approximate 12 mm parallel interfaces, including corner traversal limits. The existing surface solver still cannot overturn or spray water.

## Validation

Automated checks cover deterministic clock wrapping/hold/resume/pause/hidden/reset; day/night waterline coverage across front/side views and both qualities; smooth flat-water illumination, ripple-dependent caustics, floating-object light occlusion and exact paused frames; fallback lighting; supplied morph assets and synthetic skins; loading failures, quality changes, resets and resource stability; English/German controls and production layouts.

Run `npm test`, `npx playwright test tests/browser/aquarium.spec.ts tests/browser/aquarium-optics.spec.ts tests/browser/koi.spec.ts tests/browser/koi-waterline.spec.ts tests/browser/water-reflection.spec.ts`, `npx playwright test tests/browser/language.spec.ts --grep aquarium`, and `npm run test:production`.

With Vite on port 5174, `node scripts/review-aquarium-optics.mjs` captures fixed noon/sunset/night from oblique, overhead and shallow views, plus strong waves with six balls and a mobile viewport. It records hardware, actual optical-frame advancement, frame intervals and GPU resource counts in `artifacts/aquarium-optics/review.json`. These are Chrome animation-frame measurements, not GPU timer queries. A real mobile device and the live reference appearance have not been verified; the in-app browser connection failed, so local visual validation uses installed Chrome.

Development-checkout checks passed: **106 unit tests, 18 aquarium/koi/reflection/localization browser tests, TypeScript/build, and all 12 desktop/mobile production layouts**. That checkout included separate, unfinished sixth-level work. Before publication, the aquarium-only staged snapshot was exported independently and passed its production build and **86 unit tests**. The optical pixel fixture also verifies that transparent fin texels retain about half the opaque silhouette and that a flat-water lamp reflection appears at the projection of the mirrored emitter. Eight waterline sweeps each retain 13–15 partial-visibility frames; the largest frame-to-frame coverage change stays below 8% of peak coverage. No browser/WebGL errors occurred during the final capture run. Vite retains the existing large Three.js chunk warning.

Measured on Windows 10, Chrome 153, NVIDIA GeForce RTX 3060 Ti via ANGLE D3D11, 12 logical CPU cores. Each sample covers 180 frame intervals and confirms 181 actual optical renders. Desktop viewport: 1440 × 1000; high optical target: 1175 × 724. Warm shader/asset state is measured; compilation and loading are excluded.

| Scene                               |   FPS | p95 interval | GPU geometries / textures | Draw calls |
| ----------------------------------- | ----: | -----------: | ------------------------: | ---------: |
| High, default afternoon             | 143.9 |       7.1 ms |                   22 / 27 |         40 |
| High, night, six balls, 100% waves  | 143.9 |       7.1 ms |                   22 / 27 |         40 |
| Lighter, same stress scene          | 134.9 |      13.8 ms |                   21 / 20 |         12 |
| Lighter, 390 × 844 desktop viewport | 137.1 |       7.2 ms |                   21 / 20 |         12 |

The desktop exceeds the 60 fps target in this run. Values approach the display's 144 Hz ceiling and include browser scheduling variation; they do not establish relative GPU pass cost. An earlier capture run measured about 130 fps for both desktop qualities. Resource counts include temporary raster warmup resources; a first quality replacement can release them, after which repeated quality changes/resets retain stable counts. Mobile viewport emulation uses the same desktop GPU: the **30 fps real-mobile target remains unverified**.
