# Aquarium research and implementation

Researched 25 September 2026. The attached image was used as a visual reference: a compact rectangular glass tank, turquoise water, visible waterline and bright underwater light patterns. No instructions from external material were treated as task instructions.

## Sources considered

- [Matthias Müller / Ten Minute Physics, tutorial 20](https://matthias-research.github.io/pages/tenMinutePhysics/index.html), [source](https://github.com/matthias-research/pages/blob/master/tenMinutePhysics/20-heightFieldWater.html): height-field waves and two-way coupling with solid objects. Best fit for a compact, closed tank and a rendering-independent, testable solver.
- [Evan Wallace / WebGL Water](https://github.com/evanw/webgl-water): visual reference for interactive waves, refraction and caustics.
- [Yong Su / threejs-water](https://github.com/jeantimex/threejs-water): a modern Three.js port describing GPU ping-pong waves, ray-traced optics, buoyancy and differential-area caustics. Its multi-pass rendering is useful context, but adopting an entire separate application would add unnecessary integration scope.
- [Martin Renou / threejs-water](https://github.com/martinRenou/threejs-water): another Three.js implementation of Wallace's demo, with a related caustics project.
- [Official Three.js GPGPU water example](https://threejs.org/examples/webgl_gpgpu_water.html): a GPU alternative for larger grids.

## Decision

Use an independently written CPU height field (101 × 61 samples, 120 Hz) and the project's existing Three.js dependency. At this scale the CPU approach is small, deterministic and straightforward to test; it does not need floating-point render targets for the solver. The wave speed is 1.8 m/s and the grid spacing is 0.06 m, comfortably satisfying the two-dimensional CFL condition at 1/120 s. Missing outward neighbor flux gives reflective walls. Impulses subtract their spatial mean; the surface mean is corrected every step to keep the tank's resting volume fixed. Damping is exponential in time. Long frames are capped at 0.1 seconds and hidden tabs are skipped.

Floating balls use spherical-cap submerged volume, gravity, buoyancy at density ratio 0.55, water drag, slope forces, wall and pair collisions, entry impulses and bounded vertical wake feedback. Up to six are permitted. Their displacement feeds waves but does not raise the resting water level.

The water surface transmits the directly rendered fish and floor, with a subtle tint and angle-dependent planar reflections described below. Reconstructed mesh normals and light patterns respond to the simulated heights. Side meshes share exact edge heights with the top surface. The camera stays above the waterline. The tank is generated locally; the supplied koi model is installed locally with attribution. No dependencies were added. See [koi integration status](koi-integration.md).

## Practical limits

This is a surface-wave model, not a volumetric fluid solver: no overturning waves, pouring, splashes leaving the tank or internal fluid currents. Caustics and the studio environment are artistic approximations, not physically traced light transport. Reflection uses the mean water plane with normal-based distortion, so large waves do not produce exact curved-mirror reflections. Transmission and glass use alpha blending, without physical refraction or tracing multiple interfaces. Ball-to-water feedback is approximate and is not an exactly energy-conserving fluid/solid solve. Surface excursions are bounded for stable repeated input.

## Surface reflections 26 September 2026

Research used primary sources: [Three.js Water r180](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/objects/Water.js), [Three.js Reflector](https://threejs.org/docs/pages/Reflector.html), and [NVIDIA GPU Gems, Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models). Water demonstrates a mirrored camera, clipping and angle-dependent reflection. Reflector exposes the camera, custom shader and render target. GPU Gems explains using surface normals for reflection and wave detail.

For this compact tank, the chosen implementation reuses the installed Three.js Reflector helper for its mirrored camera and oblique clipping plane. It renders one half-float color target at the mean water height. Geometry below that plane is clipped per fragment, including partially submerged balls, so underwater koi never become a second reflected fish image. The surface and side water are hidden during this pass. The existing PMREM studio environment is temporarily used as its background. All visibility, background and renderer state changes are restored afterward.

The surface shader projects this texture in world space, distorts it using the live height-field normals, and uses Schlick Fresnel with normal-incidence reflectance 0.02037 (water IOR 1.333). A restrained transparent tint preserves directly rendered fish and floor detail. Reflection distortion fades at image borders to avoid clamped streaks. This approach does not restore the previous screen-space underwater refraction pass. A static environment map alone would miss nearby floating objects; screen-space reflection would depend on what the main camera could see.

Normal mode uses 65% viewport resolution capped at 1024 pixels on its longest edge; lighter mode uses 40% capped at 512. The target is reused across frames and resets, resized on quality/viewport changes, and disposed with the level. Wave/pause/reset behavior is unchanged; orbiting while paused still updates the reflection viewpoint.

Validation: production build and six targeted browser tests pass (four aquarium controls/layout/resource tests, the fish waterline regression across two angles and both quality modes, and a dedicated reflection pixel test). The reflection test finds zero changed pixels for a fully submerged marker, a partial image at the waterline, a full image above water, and correct movement through normal/light/normal quality changes. Chrome screenshots cover oblique, overhead, shallow-angle waves and a mobile viewport. No browser errors were observed.

Measured desktop Chrome animation-frame throughput over 240 frames: normal 115.9 fps (p95 11.6 ms); lighter 133.4 fps (p95 9.8 ms). A 390 × 844 viewport on the same desktop achieved 143.9 fps; this is not a real mobile-device measurement or a GPU timer. Reproduce visual checks with `node scripts/review-water-reflection.mjs` while the app runs on port 5174. Captures and measurements are in `artifacts/reflection-*`. The in-app browser connection failed, so review used the installed Chrome browser.

## Interaction

Visit `/?level=aquarium`, or use Level 03 in either other level. Left click/drag disturbs the water. Right drag orbits, the mouse wheel zooms. On touch, tap makes a ripple, one-finger drag orbits, two fingers orbit/zoom. Keyboard: Space pauses, N drops a ball, R resets (shortcuts do not intercept focused controls). The wave button also provides a keyboard-accessible ripple. Pause freezes simulation and shader time, while camera navigation remains available. Reset restores physics, controls, quality, balls and camera. Context loss disables controls and asks for reload. Hot replacement disposes listeners, camera controls, geometry, textures and rendering targets.
