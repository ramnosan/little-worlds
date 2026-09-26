# Lagerfeuer validation

The current implementation uses original procedural flames, smoke, scenery and audio. It loads no fire images or video. See [implementation and research](fire-rendering.md).

## Model and rendering

- A seeded `FireWorld` advances at 120 Hz with at most 0.1 seconds of catch-up per render. Fuel consumption scales with stick thickness and wind; heat transfers between sticks and from embers.
- Each stick uses Verlet endpoints, a fixed-length constraint and a shrinking capsule radius. Eight contact iterations and load-limited friction preserve the stack until supporting wood burns down. The approximation handles settling, not splitting or chemical combustion.
- Up to 18 burning segments feed a connected world-space flame and smoke field. Opaque depth stops volume integration at visible surfaces. Emission and absorption are composited in linear HDR before restrained bloom and output tone mapping.
- Desktop mode uses 224 volume samples at 70% drawing-buffer dimensions, pixel ratio capped at 1.5. Light mode uses 88 samples at 45%, pixel ratio capped at 1, 60 rather than 180 sparks and no firelight shadow map.
- The generated 3D turbulence texture, wood meshes, ash patches and particles are bounded and reused. Teardown disposes GPU resources, audio, observers and listeners.

## Reproducible review

Visit `/?level=fire&fireFixture=full` for a paused 35-second fire. Other fixtures are `ignition`, `collapse` (140 seconds), `embers` (200 seconds), and `cold` (270 seconds). These query parameters only work in development. Pause leaves orbit and zoom available; reset restores the live initial scene.

Run `npm test`, `npm run build`, and `npx playwright test`. Fire browser tests save desktop, tablet, mobile and burn-stage screenshots in `artifacts/fire-*.png`, plus a performance attachment for both modes. Diagnostics expose `fireRendering`, `animationTime`, `volumeSteps`, target size, camera, combustion state and GPU resource counts.

## Current validation

Validated on 2026-09-26 using Windows Chrome and an NVIDIA GeForce RTX 3060 Ti (ANGLE / Direct3D 11), at a 1440 x 1000 viewport:

| Mode    | Median frame interval | 95th percentile | Approximate observed rate |
| ------- | --------------------: | --------------: | ------------------------: |
| Desktop |               13.6 ms |         14.4 ms |                    74 fps |
| Lighter |                7.9 ms |         12.0 ms |                   127 fps |

- All 79 unit tests passed. The former footage timing/manifest test was removed with its deleted player; combustion, contacts, fuel depletion, ignition, pause/reset and frame-rate independence remain covered.
- TypeScript and the production build passed. Vite still reports the existing shared Three.js chunk size advisory.
- All 12 fire browser scenarios passed after the final sampling changes. They cover control interactions, keyboard focus, touch, visibility, context loss, layouts, burn fixtures, paused pixel stability, resource reuse and operation with all image/video requests blocked.
- The complete 56-scenario browser regression suite passed, including all five levels and their navigation.
- The new live-motion check samples upper-plume emission for 48 frames under 65% wind and rejects greater than 15% emission jumps between normal frames. It is a narrow regression against sudden whole-tip flashes, not a perceptual realism metric.
- Inspected 1440, 1024 and 390 pixel layouts, full fire from two viewpoints, light mode, ignition, collapse and embers. Wood depth remains coherent in front of the flame volume; light mode uses the same field with fewer integration samples.
- Source footage, AEP, atlases, preparation code and player are absent from the project and production output. A browser regression observes zero image/media requests for this level.

The headless visibility regression explicitly drives `document.hidden` and its event because Chrome's headless background pages do not consistently become hidden. Performance samples measure observed frame intervals including simulation and rendering, not isolated GPU time or cross-device performance.
