# Avalanche · Level 10

Open `?level=avalanche`. Release a slab on an invented alpine mountain, follow the dense snow through a gully, and inspect the deposit in the valley. Dry powder and wet snow, slab depths from 0.5 to 2 metres, ¼× / 1× / 2× playback, pause, reset and two camera views are available in English and German. Drag or touch to orbit; scroll or pinch to zoom. With the canvas focused, Enter releases, Space pauses, R resets, and arrow keys orbit. Settings prepare a fresh slope. Nothing starts automatically, including for reduced-motion users.

## Research first

Research performed on 28 September 2026, before implementation, using primary sources:

- [WSL Institute for Snow and Avalanche Research SLF — Avalanche types](https://www.slf.ch/en/avalanches/avalanche-science-and-prevention/avalanche-types/): a cohesive slab over a weak layer can detach after fracture propagation on a sufficiently steep slope (at least about 30°). Powder clouds can develop from slab avalanches. This informed the connected initial slab, delayed release across its footprint, visible crown and separate airborne effect.
- [SLF — Avalanche dynamics](https://www.slf.ch/en/avalanches/avalanche-dynamics-how-avalanches-move/): dense granular flow and a suspension of snow in turbulent air have different dynamics; terrain and snow properties affect motion. The level therefore separates terrain-following snow parcels from the visual powder cloud.
- [RAMMS — Mathematical model](https://ramms.ch/ramms-avalanche/mathematical-model/): the Voellmy approach combines velocity-independent Coulomb friction with speed-dependent turbulent resistance. RAMMS also describes entrainment/deposition in the mass balance. These ideas informed the acceleration, slowdown and pickup of bed snow; this implementation does **not** reproduce the RAMMS depth-averaged PDE solver.
- [RAMMS — Friction parameters](https://ramms.ch/ramms-avalanche/friction-parameters/): professional parameters depend on terrain and calibrated scenarios. The constants below are chosen for this illustrative fictional scene, not copied as calibrated hazard parameters.

## Model and limitations

The shared, bilinearly sampled heightfield uses metres. Gravity is projected onto its local tangent plane. Fixed 1/90-second integration steps apply Coulomb resistance and a quadratic drag term, `mu * g / normalLength + g * speed² / (xi * effectiveDepth)`, opposite motion. A coarse grid adds bounded lateral pressure spreading. The dry preset uses μ = 0.19, ξ = 1350 m/s²; the wet preset uses μ = 0.34, ξ = 650 m/s². These are illustrative presets, not universal properties of wet and dry avalanches.

There are 1,600 initial slab parcels and 1,000 stationary bed parcels. A deterministic fracture delay releases the slab. Passing flow activates bed parcels; momentum is mixed with the stationary added volume in each affected grid cell. Parcel volume remains constant, including snow still on the bed. Slow parcels on terrain below the friction threshold deposit permanently. The visible snow clods exaggerate parcel dimensions for legibility; the model has no full grain collisions, fracture stress solver, compaction or fluid-air coupling. The billowing cloud is a bounded visual particle pool, not additional simulated mass. Trees and huts provide scale and do not participate in the solver.

Readouts are elapsed model seconds, maximum surface speed reached by a parcel, maximum horizontal displacement from a parcel's starting position, and released plus entrained volume. These are illustrative simulation values in invented terrain, unsuitable for hazard assessment or runout forecasting.

The level is lazy-loaded, uses only procedural geometry and shaders, and requires WebGL 2. It makes no asset, map, font or texture requests. It suspends simulation while hidden, bounds frame catch-up, handles lost graphics contexts and frees graphics resources on normal navigation/HMR. Mobile controls sit beneath the scene.

## Verification

- `node --import tsx --test tests/avalanche.test.ts`: fracture timing, deterministic reset, pause, frame-rate independence, conserved volume, entrainment, finite state, frictional runout before the terrain boundary, material differences and depth extremes.
- `npx playwright test tests/browser/avalanche.spec.ts`: release/pause/reset, keyboard focus guards, snow and camera settings, German mobile layout, source links, and graphics-console errors.
- Set `PLAYWRIGHT_PORT` if another application occupies port 5173; the Vite test server uses the selected port strictly.
- `node scripts/inspect-avalanche.mjs [baseURL]`: screenshots of the ready slope, active avalanche and mobile layout, plus console and rendering statistics. Default URL: `http://127.0.0.1:5174/`.
- `npm run build` and `npm run test:production`: production compilation and shared desktop/mobile navigation/layout coverage, including the tenth level.

Validated on 28 September 2026: all 133 simulation/unit tests passed, both avalanche browser tests passed, and all 22 desktop/mobile production-layout cases passed. Chrome screenshots were reviewed at 1440 × 1000 and 390 × 844. The active avalanche rendered in 18 draw calls with no browser or shader errors. The production build passed; Vite retains its existing warning about the shared Three.js chunk size.
