# Little Worlds

Small worlds. Play a little.

## Publish on GitHub Pages

Repository: https://github.com/ramnosan/little-worlds

Play after deployment: https://ramnosan.github.io/little-worlds/

In repository **Settings → Pages**, select **GitHub Actions** as the deployment source.
The workflow in `.github/workflows/deploy.yml` builds and publishes `dist/` on every
push to `main`. It can also be run manually from the Actions tab.

Production builds use `/little-worlds/` as the base path. After `npm run build`,
run `npm run preview` and open http://127.0.0.1:4173/little-worlds/ to check that build.
The development server continues to use http://127.0.0.1:5173/.

## About

A warm, tactile soft-body playground built with TypeScript and Three.js. Grab, stretch, toss, and spawn glossy jelly blobs in a little pastel studio. No accounts, scores, or runtime network services. Environments and audio are procedural; aquarium koi use a locally served, credited model and the campfire is generated entirely in code.

## Run locally

Requires Node.js 20.12 or newer and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. A WebGL 2 browser with hardware acceleration is recommended. Chrome, Edge, Firefox, and Safari should support the application; automated browser validation uses installed Google Chrome.

```sh
npm run build       # TypeScript check and optimized production bundle in dist/
npm run preview     # Serve the production build locally
npm run typecheck
npm test            # Rendering-independent physics tests
npm run test:browser # Chrome interaction, layout, touch, and resource tests
npm run test:production # Build and check all five level layouts on desktop/mobile
```

The browser suite starts the development server if one is not running. It uses the locally installed Chrome channel, so a separate Playwright browser download is unnecessary. Screenshots and failure traces are written under `artifacts/`.

The production layout check serves the optimized build under `/little-worlds/` and
checks all five scenes at 1440px and 390px. It catches missing styles caused by
production chunk loading, which the development server cannot expose. Screenshots
are saved in `artifacts/production-layout/`. Set `LAYOUT_TEST_URL` when running
`node scripts/check-production-layout.mjs` to check a deployed site instead.

## Play

All five levels support **English** and **German**. English is the default, regardless of your browser's language. Use **Language / Sprache** in the header to choose **English** or **Deutsch**. Changing language restarts the current level and remembers your choice for future visits and other levels. The game's Reset action keeps your language preference. If browser storage is blocked, the game defaults to English and explains why the selection cannot be saved.

### Level 05: Lagerfeuer

Open **05 · Lagerfeuer** from any level, or visit `/?level=fire`. Nine crossed wooden sticks burn in an outdoor clearing at dusk. An original ray-marched flame volume rises from the burning wood; wind bends the flames, smoke and sparks, while firelight illuminates the ground and stones. The sticks gradually char, lose thickness and settle as their supports burn away. Without replenishment, the opening fire becomes an ember bed and cools in roughly four minutes.

**Holz nachlegen** (or **N**) drops another stick onto the pile, up to 18 active sticks. Nearby fire or sufficiently hot embers can ignite it. **Entzünden** supplies an ignition source to remaining wood. Adjust **Abendwind**, orbit with either mouse button, and scroll to zoom. Touch supports orbit and pinch zoom. **Space** pauses; **R** resets the wood, wind, camera, graphics and muted audio. The **Knistern** button enables locally synthesized crackling after a user gesture. Pause freezes the fire, fuel, movement, smoke, sparks, light animation and audio while leaving camera controls available. Hidden tabs suspend without catching up.

The desktop graphics mode uses an original world-space volume for connected flames and smoke, HDR bloom, subtle heat distortion, procedural bark/end grain/char shaders and shadowed firelight. All fire detail comes from a seeded 3D noise lattice generated at startup; there are no flame cards, video loops, imported presets or external fire assets. **Leichte Grafik** reduces volume resolution and integration samples, pixel density and sparks, and disables real-time shadows. See [procedural fire implementation and research](docs/fire-rendering.md). This is an artistic combustion/flow approximation with 120 Hz capsule-contact physics and load-limited friction, not a calibrated fluid, chemical or structural-fracture solver. Consumed sticks leave pooled ash patches; the simulation does not split sticks into rigid fragments.

Development builds expose read-only `window.__fireDebug()` snapshots. Reproducible paused stages are available through `&fireFixture=ignition`, `full`, `collapse`, `embers` and `cold`; add `&fireQuality=light` for reduced graphics. Fixtures and diagnostics are excluded from production. Tests cover heat transfer, ember ignition, fuel depletion, support collapse, contacts, capacity, frame-rate independence, pause/reset, controls, audio, touch, layouts, WebGL errors and resource stability. See [fire validation notes](docs/fire-validation.md) for screenshots and measured performance.

### Level 04: Modelleisenbahn

Open **04 · Modelleisenbahn** in any level's navigation, or visit `/?level=railway`. A tabletop scale model holds the Alpine village of Kleinwald: textured grassy hills, rocky cuttings, dense conifers, timber-and-plaster houses, a station, and a steel road bridge. A red electric locomotive and two passenger carriages circle on an oval railway with a parallel scenic track and overhead contact wires. Their wheel axles follow the same track path as the rails.

Drag with either mouse button to orbit and scroll to zoom. On touchscreens, drag to orbit and pinch to zoom. Set speed from 0–200%; 100% completes a circuit in 25 seconds. **Space** pauses and **R** resets the train, speed, camera, and graphics. Camera controls remain available while paused, and shortcuts leave focused controls alone. Lighter graphics reduces pixel density, disables real-time shadows, and hides small gravel and scrub details. Hidden tabs suspend the scene without catching up when restored.

The fixed layout, surface textures, and models are generated locally with Three.js, without new dependencies or downloaded assets. Static scenery is batched by material; trees, rock, sleepers, and small scenery use instancing. This is a scenic model railway, with no track editing, objectives, or audio. Development builds expose read-only `window.__railwayDebug()` snapshots. Unit tests cover path continuity, rail gauge, terrain clearance, carriage spacing, frame-rate independence, speed, pause, and reset; browser checks cover controls, navigation, touch, responsive layouts, and GPU resource stability.

### Level 03: Aquarium

Open **Level 03 · Aquarium** in either level's navigation, or visit `/?level=aquarium`. A small glass tank contains interactive turquoise water with ripples, a clear transparent surface, underwater light patterns and floating balls. Click or drag on the surface to create waves; right-drag to orbit and scroll to zoom. On touch, tap for ripples, drag to orbit and use two fingers to zoom.

Adjust wave strength and damping, toggle the wave maker, or drop up to six buoyant balls. **Space** pauses, **N** adds a ball, and **R** resets. The ripple button is keyboard accessible. Pause freezes the simulation and lighting animation; reset restores the initial scene and camera. Lighter graphics lowers pixel density. The level is lazy-loaded and uses no new dependencies or downloaded assets.

The water uses a fixed-step 120 Hz height-field solver with reflective tank walls. This models surface waves; it does not support pouring or overturning waves. A mirrored camera captures above-water objects and the studio lighting, with reflections distorted by live waves and strengthened at shallow viewing angles. Fish remain directly visible through the transparent surface. Lighter graphics reduces reflection resolution. Underwater caustics remain a visual approximation. See [research, source links and implementation tradeoffs](docs/aquarium-research.md). Development builds provide read-only `window.__aquariumDebug()` snapshots.

**Three animated koi are installed using the user-supplied 7PLUS model (CC BY 4.0).** They swim independently, respond to nearby ripples and support pause/reset and lighter graphics. The model has 522 triangles, 1K textures and baked morph animation, rather than a skeleton. Its original colors are preserved; these are three copies, not three distinct varieties. The loader still supports future skeletal assets. See [asset details and remaining realism requirements](docs/koi-integration.md). `npm run validate:koi` checks the installed assets against their declared profile and reports the remaining skeletal/4K limitations.

### Level 02: Seifenblasen

Open **Level 02 · Seifenblasen** in the header, or visit `/?level=bubbles`. Hold the blow button (mouse or touch) or **Space**, then release to create a bubble. Longer holds produce larger bubbles. **N** makes a small bubble; **P** pauses. Create twelve bubbles to complete the level, then keep playing. The six opening display bubbles do not count toward the goal.

Tap a bubble to burst it into droplets, adjust the breeze, or restart with **Neu beginnen**. Up to 32 bubbles can float at once. Pause freezes the film, flight and droplets; pointer cancellation, focus loss and hidden tabs cancel inflation. A lighter graphics setting lowers pixel density, uses a 24-cell fusion grid and permits one fusion at a time; normal mode uses 32 cells and two concurrent fusions. Changing quality during fusion waits for the active transitions to finish before switching their grid and concurrency limit.

**Hold the right mouse button and drag** to orbit around the fixed scene center. **Scroll** to zoom. On touchscreens, drag to orbit and use two fingers to orbit/zoom; a short tap pops a bubble. Camera navigation remains available while paused. Reset restores the original camera as well as the simulation.

**Darts werfen** equips a dart and changes the pointer to a crosshair. Click or tap the scene to throw toward that point; bubbles keep moving during the flight, so lead your target. Darts have a small gravity drop and can pierce several bubbles in a row. Right-drag still orbits; a touch drag rotates instead of throwing. **Darts ablegen** returns to direct bubble popping. **D** toggles darts when a form control is not focused; **Escape** puts them away. Pause freezes darts and prevents throws, and reset clears darts and the hit count. The creation goal stays unchanged. At most twelve darts fly at once and misses retire automatically after three seconds.

Dart tips use swept relative motion against clipped spheres and shared films. During fusion, picking and dart collision use the same generated triangles as rendering, so the empty parts of a bounding sphere cannot cause phantom hits. Small free-sphere shading oscillations remain a visual approximation. Projectile models share geometry/materials across throws; impacts use the existing burst and contact-cleanup lifecycle.

The `src/bubbles/` level uses a 120 Hz air-drag simulation with spatially continuous wind, decaying thermal lift and film weight. Collisions transfer mass-weighted normal impulses while allowing tangential sliding, and excite damped surface oscillations. Contact below 0.24 m/s for 0.12 seconds forms a spring-damped adhesive bond. Bonds break beyond touching distance plus 18% of the smaller radius, or above 0.65 m/s outward normal speed. Each bond has a deterministic seeded 55% chance to drain after 2-4 seconds; the others remain shared films until separation or popping. Each bonded patch has one transparent planar membrane with an iridescent rim, and neighboring outer caps are discarded.

Fusion lasts 1.35 seconds: the film opens over 0.15 seconds, a connecting neck develops until 0.45 seconds, the lobes pull together until 1.15 seconds, and a small elastic finish carries into the normal damped wobble. Quintic curves keep phase boundaries smooth. A pooled Three.js Marching Cubes mesh samples a smooth union of two sphere fields on a fixed grid at 60 Hz; physics remains at 120 Hz. Its triangle volume is normalized to the sum of the source air volumes. Before the film finishes opening, the lobes are independently puncturable; afterward either lobe belongs to the same bubble. Mass and linear momentum are conserved at that ownership change. Surviving external bonds transfer and deduplicate, retaining their contact anchors and blending over 0.2 seconds. Neighbors settle against the normalized fusion field's distance and normal, with fusion-induced position corrections limited to 2% of the smaller radius across all eight solver passes per step. Contact caps on a concave fusion surface are restricted to the neighboring bubble's region, so a plane cannot clip a distant lobe. Pop effects remain local, and attached survivors receive a bounded wobble. Creation progress never increases on fusion. Eligible pairs wait in a deterministic queue when surfaces or participants are busy; pause freezes all phases and reset clears active transitions and queued merges.

The shared-film behavior is inspired by [OVGU's description of soap-bubble contact and film fusion](https://www.soft-matter.ovgu.de/softmatter_media/Projekte%2BMitarbeiter/Patricia%2BESF/Coalescence%2Bof%2Bbubbles%2Bin%2Bair%2Band%2Bnon_Newtonian%2Bfluids-p-1264.pdf). Adhesion thresholds and film-drainage times are tuned for play, not experimentally calibrated. Contact caps are planar approximations; this does not solve the curved pressure-balanced films and junction angles of real foam.

The transparent film shader uses angle-dependent Fresnel reflection and wavelength-dependent thin-film interference, animated drainage, smooth highlights, and damped shape oscillations. A procedural garden panorama supplies the backdrop and reflections as the camera orbits; no image downloads or runtime services are needed. This is a real-time visual approximation, not a full fluid or spectral optics solver.

Development builds expose read-only `window.__bubbleDebug()` snapshots including bond eligibility/delay/phase, shared films, source lobes, survivor identity, conserved volume, fusion progress, visual phase, correction limits and pool counts. Named reproducible scenes are available at `/?level=bubbles&bubbleFixture=pair` (also `cluster`, `opening`, `fusion`, `settled`, `impact`); add `&bubbleQuality=light` for the reduced grid. `&bubbleProgress=0.45` seeks to that time in the first merge; `&bubbleSlow=1` resumes at one-fifth speed. They start paused and resume with the usual control. Diagnostics and fixtures are omitted from production.

Bubble regressions cover triangle-volume normalization, momentum conservation, deterministic merge scheduling, attachment transfer, local punctures in both phases, bounded pooling, desktop/mobile phase screenshots, and frame-rate independence (including bonded contacts), wind response, mass-weighted impacts, tangential sliding, shared films, coalescence, crowded spawns, lifetime, capacity, pause, reset, fixed-center orbit, zoom, gesture cancellation, held inflation, goal completion and GPU resource stability.

### Level 01: Jelly

- **Left-drag a jelly:** grab a local patch and stretch it. Move and release to throw.
- **Drag empty space / right-drag:** orbit the stage. **Scroll:** zoom.
- **Touch:** drag a jelly to stretch, or drag empty space to rotate the camera.
- **Pick up mallet:** move the mouse to aim the head, then left-click for a horizontal swing. Each click plays a wind-up, contact stroke, and recovery; holding the button does not repeat. Right-drag to orbit; **Put down mallet** returns to grabbing. On touchscreens, tap the tray to aim and swing. The equipped head always collides with jellies, including while aiming, winding up, and recovering. Pause, cancellation, or losing focus cancels the stroke.
- **Color and size:** choose the next jelly, then press **Add a jelly**. Up to eight can share the tray.
- **Focus selected body:** use the magnifying-glass button beside Delete to inspect the selected shape up close. Reset restores the original camera.
- **Softness and gravity:** affect every jelly. Zero gravity lets them float.
- **N:** add a jelly. **Space:** pause/resume. **Delete / Backspace:** remove the selected jelly. **Escape:** release and deselect.
- **Pause:** freezes the simulation but leaves camera navigation available. Newly spawned jellies wait until resumed.
- **Reset:** restores the initial three jellies, camera, and every setting, including muted audio.
- **Lighter graphics:** reduces pixel density, removes real-time directional shadows and optical transmission, and retains the soft contact shadows.

Shortcuts do not override sliders, focused buttons, or the help dialog. Audio is synthesized locally and starts muted. On narrow screens, **Make it yours** opens a scrollable settings drawer.

## Implementation

- `src/physics/`: a welded 162-particle icosphere with XPBD distance, opposite-vertex bending, and signed-volume constraints. A 60 Hz accumulator drives two 120 Hz substeps with five solver iterations, damping, bounded catch-up, and velocity/grab limits.
- The tray uses analytic floor and rounded-rectangle boundary collisions; the ramp uses a finite wedge. Inter-body contacts refresh AABB candidates after deformation and place complete surfaces on opposite sides of a shared contact plane. Deep overlaps receive bulk separation before local compression; final contact passes resolve chains against the tray without reapplying grabs. This conservative contact approximation prevents bodies from threading through one another while preserving soft contact patches.
- `src/render/`: two levels of precomputed Loop-subdivision weights map simulation particles to smooth surfaces. Vertex positions, normals, and bounds update with deformation. The stage, reflection environment, contact shadows, and icons are generated locally.
- `src/interaction.ts`: ray-picked local grabs on a camera-facing plane, pointer capture, cancellation, and OrbitControls arbitration.
- `src/ui.ts`, `src/main.ts`, and `src/audio.ts`: interface state, lifecycle, scene actions, and gesture-activated Web Audio synthesis.
- Development builds expose a **read-only** `window.__jellyDebug()` snapshot for geometry, volume, projection, and resource checks. It is omitted from the production bundle.

This is a playful surface-based approximation, not a scientific material simulation. It intentionally excludes tearing, fluid dynamics, self-collision, and persistent saves. The bounded arena also constrains high throws to keep jellies in reach.

## Validation

Physics tests cover closed topology, volume preservation, drop/settling behavior, transient stretching and recovery, render-rate independence, pause/delete/reset semantics, ramp/wall contacts, stacking, and eight-body stress at the gravity/softness extremes. Collision regressions independently check mesh containment after deep overlap, during repeated dragging through a crowded pile, and on every frame of fast opposing throws. These detect actual interleaved surfaces, which volume and center-distance checks alone cannot catch.

Browser tests cover the eight-jelly cap, all controls, mouse and touch grabbing, camera gestures, pointer cancellation and focus loss, keyboard shortcuts, pause behavior, reset defaults, resource stability across repeated spawn/reset cycles, and 1440px, 1024px, and 390px layouts.

On the local Windows Chrome test environment, the eight-jelly scene reported approximately **69 fps** at a 1440 × 1000 viewport. This is an observed in-app frame counter, not a cross-device performance guarantee. During the physics tests, settled drop and grab-recovery volume errors were below **0.02%**. Repeated browser resets returned geometry and texture counts to baseline.
