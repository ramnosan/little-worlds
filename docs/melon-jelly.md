# Melon Jelly

The eighth Little Worlds level is presented as **Material Studies / No. 009**, as requested by its art direction. Its complete implementation is [`public/melon-jelly.html`](../public/melon-jelly.html). Copying this file is sufficient to distribute the experiment: all styles, JavaScript, WGSL, geometry and the favicon are embedded. No font, texture, library or model downloads occur. Vite copies it unchanged into the production site.

Open `/melon-jelly.html`, select **08 Melon Jelly** from any other world, or use `?level=melon`. The study has a return link to Little Worlds. For standalone use, serve the file over HTTPS or localhost in a WebGPU-capable browser with hardware acceleration. The return link simply goes to the containing directory. This level preserves the brief's English editorial copy independently of the other levels' language selector.

## Interaction

- Grab the tip, a corner, flesh or rind with a mouse or touch. Pointer capture continues the gesture outside the canvas; release, cancellation, blur, visibility changes, reset and pause clear grabs.
- Two simultaneous touches hold different material points, allowing stretching and twisting. Drag empty space to orbit; a wheel changes the inspection distance.
- The focused canvas accepts arrow-key nudges, **Space** for pause/resume, and **R** for reset. Controls retain normal keyboard behavior.
- Reset restores the body and camera while preserving the chosen material, sliders, playback rate, mesh overlay and pause state.
- Reduced-motion preference starts paused, with an explanation and explicit Resume action. No autonomous camera animation or repeated nudging occurs.

## Physics

There are 330 particles and 1,200 consistently oriented tetrahedra. A rounded triangular cross-section is extruded through five thickness layers with matching prism diagonals. Its closed surface has 440 triangles before two precomputed subdivision passes. Subdivision weights and all GPU vertex/index buffers are reused during interaction.

The CPU implements [XPBD](https://matthias-research.github.io/pages/publications/XPBD.pdf) with edge elasticity and signed tetrahedral volume constraints. Multipliers reset each substep and accumulate across seven iterations. Rind-edge compliance is 38% of flesh compliance. Firmness changes elasticity over a 25-fold compliance range. Internal damping removes relative edge velocity while preserving rigid rotation; mild environmental drag and ground friction dissipate the remaining motion.

The fixed step is 1/120 s, with at most six steps per rendered frame and a 50 ms elapsed-time cap. Quarter speed changes accumulated time, not the solver timestep. A moving grab target is speed-limited and acts on a barycentric surface location and its immediate material neighborhood. No rest-position tether or rigid shape scaling substitutes for deformation.

Signed-volume barriers resist flattening. Any substep that would leave a nonfinite or inverted cell is rejected in favor of its last valid deformed state, with damped velocity. This rare safeguard does not reset the specimen to its rest shape. Floor projections, a small collision margin, friction and low restitution keep the surface above the studio floor. Nonadjacent surface self-collision is not solved; this is a small interactive specimen, not a general cloth/soft-body engine.

Each vertex of the 22 modeled seeds and 12 tiny bubbles is bound to tetrahedral material coordinates, so local rotation, bending and stretch transform the entire detail. Seeds on both exposed faces are partially embedded in the surface.

The readouts are derived from lumped tetrahedral masses, current signed volume and particle kinetic energy. The stated illustrative conversion is 1 scene unit = 4 cm, density = 1.05 g/cm³; the undeformed slice is approximately 411 g. These are not calibrated material measurements.

## Native WebGPU rendering

The browser uses `navigator.gpu`, a `webgpu` canvas context and WGSL render pipelines directly. No Three.js, WebGL, canvas drawing imitation or fallback image is used.

1. Render the deformed surface into a light-space depth map for filtered shadows.
2. Render back faces to a floating-point world-position texture, measuring the current exit position along each view ray.
3. Render the studio, seeds and bubbles into an offscreen colour/depth buffer.
4. Shade the front surface using measured thickness, Beer–Lambert absorption, screen-space refraction, Fresnel environment reflections, direct gloss and edge transmission. Interior depth distinguishes short paths to near seeds from long paths to far seeds. Flesh, pale pith and irregularly striped skin have different optical responses.
5. Render exposed portions of the modeled seeds/bubbles and the optional tetrahedral edge overlay.

The studio environment and microdetail are procedural. Refraction is a screen-space approximation; it is not multiple-scattering path tracing. Strong folds can expose the usual limitations of a single exit-depth pass. The device-pixel ratio is capped at 1.7, and framebuffer textures are rebuilt only on size changes. Shader compilation and geometry topology construction happen at startup, never while dragging.

Missing WebGPU, missing adapters, shader errors, validation errors and device loss display a clear explanation and disable unavailable controls. The renderer never reports live before successful initialization.

## Validation

`npm test` includes `tests/melon.test.mjs`, which extracts and executes the actual embedded physics implementation. It checks closed topology, positive volumes, normalized skin weights, repeated strong tip/corner/rind pulls at three firmness values, release recovery, ground contact, opposing grabs, damping, firmness and affine seed attachment. It also checks that any inversion rollback is rare and cannot stall recovery.

`npx playwright test tests/browser/melon.spec.ts` checks actual WebGPU startup and errors, four mouse grab locations, pointer capture outside the canvas, strong stretches, releases, every control, settling, real CDP touch input including two simultaneous grabs, a 390 px mobile layout, reduced motion, missing-WebGPU messaging and level navigation. Screenshots are saved in `artifacts/melon/`.

`npm run test:production` checks all eight built levels at desktop and mobile sizes, including WebGPU status and unobscured mobile controls for Melon Jelly.

Verified on 2026-09-27 with local Chrome: 125 simulation tests, all five Melon browser tests (including direct `file://` opening with zero runtime asset requests), and all 16 desktop/mobile production layout checks passed. TypeScript compilation and the production build passed. The inspection companion `node scripts/inspect-melon.mjs` measured 6.9 ms median / 7.1 ms p95 animation-frame intervals across 120 frames at 1440 × 1000 on this machine; this is an observed frame cadence, not a hardware-independent performance guarantee.
