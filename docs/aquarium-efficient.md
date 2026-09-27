# Aquarium Efficient mode

The graphics button switches between High quality and Efficient. High quality is the first-visit default. `little-worlds.aquarium.graphics` stores the selection; blocked storage keeps a session-only choice. Reset retains graphics quality while resetting the simulation and afternoon lighting. Switching preserves the camera, current waves, balls, fish navigation/animation and time of day.

## Rendering and lifecycle

Efficient mode rasterizes the actual lighter koi assets, using their authored textures, normals and fin alpha. It uses clear alpha transmission and depth tint instead of physical refraction. There is no BVH pose baking/upload, optical traversal, light volume, temporal filter or bloom. High quality retains those effects.

The existing shared GPU height/slope field displaces the top surface and side edges directly in vertex shaders. There is no GPU height readback or full-detail CPU wave evaluation. Without floating-point targets, the CPU fallback evaluates six bounded detail waves and computes slopes on the coarse simulation grid.

A 128 × 80 photon grid projects surface-refraction caustics into a 512 × 320 texture. Ball spheres interrupt photons; fish and the sand receive the projected light pattern. The same active sun/lamp lighting snapshot drives standard raster shading. A 512-pixel shadow map captures fish/ball shadows from the active source. The lamp uses a downward spotlight matching the optical cone. These shadows approximate straight light paths rather than tracing refracted fish occlusion.

The planar reflection is capped at 512 pixels on the long edge, contains the actual lamp and above-water objects, and clips submerged fish. Its background uses day/night sky colors. Reflection, caustics and active-source shadows update at 15 Hz, with immediate refresh when a rendered camera/lighting change requires it. Native CSS resolution and pixel ratio capped at 1 keep geometry crisp.

`AquariumRenderer.setMode('high' | 'efficient')` returns the preparation promise; `quality(boolean)` remains an adapter. Mode generations reject stale completion after rapid switches/disposal. Entering Efficient mode disposes the optical targets and BVH resources; returning to High quality shows Efficient rendering until asynchronous compilation completes. Pending shader materials and the renderer's program cache are released after compilation settles, because Three.js still polls those programs during compilation. `ready` reflects the current preparation promise.

The frame scheduler limits Efficient rendering to 30 fps, independently of the unchanged fixed-step 120 Hz simulation. It drops missed renders instead of catching up. Paused frames render only after changes, including camera movement, lighting, settings, resize and completed asset loads. Development diagnostics expose requested/active mode, frame limit/count, passes, BVH ownership, caustic updates, CPU submission totals and optional asynchronous WebGL GPU timers. Queries never wait synchronously for the GPU and discard disjoint results.

## Visual and performance checks

Run `node scripts/review-aquarium-efficient.mjs` with Vite on port 5174. Captures cover noon, sunset and night from oblique, overhead and shallow views in both modes, strong waves with six balls, and a 390 × 844 viewport. The JSON report includes actual rendered-frame counts and CPU/GPU timing totals, rather than measuring only requestAnimationFrame frequency.

Measured 27 September 2026 on Windows 10, Chrome 153, NVIDIA GeForce RTX 3060 Ti through ANGLE D3D11. Desktop viewport 1440 × 1000, six balls, 100% waves, night lighting; approximately four seconds per warm sample:

| Mode         | Rendered fps | CPU submission / frame | GPU / frame | GPU time / second | GPU textures |
| ------------ | -----------: | ---------------------: | ----------: | ----------------: | -----------: |
| High quality |        143.8 |                1.35 ms |     6.62 ms |          953.3 ms |           28 |
| Efficient    |         29.9 |                2.06 ms |     2.36 ms |           70.7 ms |           11 |

Efficient mode used about **92.6% less measured GPU time per second** and 64% less GPU time per rendered frame in this run. CPU submission time per second also decreased, despite more submission work per raster frame. Physics is excluded from CPU submission measurements and remains unchanged. These timings are workload measurements, not electrical power measurements. The same desktop GPU maintained 30.1 rendered fps at a mobile-sized viewport; **real mobile hardware remains untested**.

The browser tests cover preference persistence, unchanged state on switching, paused redraw suppression, manual lighting, rapid switches/resets, released tracing resources, transparent-fin coverage, loading failures, lamp alignment and caustic occlusion. Day/night waterline tests exercise front/side views in both modes. Scheduler unit tests cover 60/120/144 Hz displays, long gaps, pause and blocked storage. Existing optical rendering tests remain active for High quality.

Validation passed: 108 unit tests, 20 aquarium/koi/reflection/localization browser tests, the production build and 12 desktop/mobile production layout checks. The hidden-tab regression simulates the browser visibility event and checks that physics, lighting and rendered-frame counters stay frozen without catch-up. Both modes pass flat-water uniformity, ripple response, ball occlusion and lamp-alignment checks. High quality initializes both temporal buffers on its first frame, keeping texture counts stable when resuming from pause or resetting after a mode switch.
