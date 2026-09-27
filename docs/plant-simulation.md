# Plant simulation

Level 07 (`?level=plant`) starts with one buried Dutch iris bulb. Players can plant up to twelve bulbs, inspect each plant, pause, choose 1×/5×/20×, and fit the camera. Restart deliberately empties the tank, clears selection and elapsed time, and restores running playback at 1×. Language changes reload the level using the existing application behaviour.

The [illustrated style guide](plant-style.html) remains the visual reference. Its generated images are design targets, not screenshots of the renderer.

## Model and timing

`src/plant/growth.ts` has no Three.js or DOM dependency. `PlantWorld` exposes `advance(deltaSeconds)`, `canPlant(position)`, `plantBulb(position)`, `reset()`, `snapshot()`, `paused` and `speed`. Placement returns a typed failure reason for bounds, depth, spacing or capacity. The constructor creates an empty garden; the level adds the initial bulb.

A retained accumulator drives fixed 1/30-second steps. Root extension runs every sixth fixed step using a 0.2-second increment. The garden has a fixed seed; each plant has its own random stream, age, growth rate, roots and above-ground organs. Snapshot reads clone state and consume no randomness. Identical placements at identical simulation times reproduce growth independently of render frame rate and playback speed.

Uncrowded plants reach their first bloom in approximately 180 simulated seconds, with ±15% growth-rate variation. Neighbour proximity reduces development speed to no less than 75%. Each organ stops developing at bloom while the garden clock and plant ages continue. Stages are derived from organs: bulb, rooting, emergence, leaves, bud and bloom.

Root tips extend through a seeded resistance field and steer around stones, nearby roots and tank walls. A spatial grid uses root positions from the preceding step, so plant iteration order does not determine interactions. Branches originate at existing parent samples. Each plant is limited to 48 paths of 64 samples; root budgets do not stop leaves or flowers. Multiple basal roots replace the old sunflower taproot.

This is an illustrative growth simulation, not a horticultural prediction. Suitable growing conditions are assumed. The exposed shallow root volume and compressed timing make growth visible; water, seasons, bulb propagation and saved progress are outside this version.

## Rendering and input

`src/plant/render.ts` pools twelve plant slots and shares procedural textures. Roots use one batched mesh per plant with bounded buffers and active index ranges. Leaves, three standards, three falls, separate style arms and bud sheaths use deformable surfaces. Organ revision/state checks avoid rewriting unchanged geometry. Soil details are instanced.

### Iris form and botanical detail

The flowers were revised against close-up [Dutch iris Blue Magic photographs](https://order.wholesalebulbs.nl/de/iris-hollandica/29385-iris-hollandica-blue-magic-reg-1189.html) and the [Kwantlen Polytechnic University plant reference](https://plantdatabase.kpu.ca/Plant/irho). Photographs are references only; all rendered surfaces and textures are procedural.

`src/plant/shape.ts` defines curved growth paths and organ surfaces independently of Three.js. Stems elongate along persistent, individually seeded curves, with lateral and depth lean above the soil. Bulbs and roots stay anchored. Flower heads follow the stem tangent with a little independent tilt. Mature plants retain their natural posture when growth stops.

Each bulb has a reproducible form: height, lean, curvature, flower size, petal breadth and curl, full flower rotation, head tilt, foliage colour, and four to eight leaves with individual length, spread, twist and droop. Nine organ variations break the flower's perfect rotational symmetry and slightly stagger unfurling. Five blue, violet, lavender, silvery bicolour and ivory palettes add colour variation without changing species.

The higher-resolution petal surfaces have narrow claws, cupped upright standards, broad rounded falls, pleats, gently rippled edges and raised style-arm crests. Three 1024px texture maps per palette supply branching veins, epidermal grain, pale throats and long golden signals on the falls. Texture orientation places the signals toward the attached throat. Petal-specific materials add soft sheen and backlit colour scattering. Dynamic surface bounds keep picking aligned with curved stems and displaced blooms. Fit allows room for lateral spread.

The open glass tank has front, back, side and bottom panes, with depth approximately 12% of width. Opaque textured soil, surface clumps, embedded stones and foreground fibres surround the visible bulbs and roots. Perspective, daylight, soft shadows and translucent leaf/petal shading use one fixed configuration with antialiasing, tone mapping and a DPR ceiling of 2.

The camera starts at a slightly elevated frontal angle and orbits around the midpoint of the glass soil tank. Wheel/pinch zoom, left-drag/two-finger pan, and right-drag orbit are available. Fit includes the entire mature garden. A gold bulb preview marks valid placement in the buried band; invalid positions use a contrasting colour and receive text feedback. Clicking a plant selects it. The sidebar selector offers the same selection without pointing at the scene. Arrow keys position a bulb and Enter plants on the focused canvas. Drag and multi-touch gestures cancel placement.

The level suspends simulation while hidden, discards hidden wall time, and preserves the model through WebGL context loss. Recovery rebuilds GPU state and leaves growth paused. Controls, observers, listeners, textures and pooled geometry are disposed when leaving the level.

## Verification — 2026-09-27

- Full unit suite, including deterministic stepping at 1×/5×/20×, staggered ages, root attachment, obstacles, crowding, placement, reset, stage order and bloom hold.
- Relevant browser suites cover loading failures, seven-level navigation, both languages and eight iris scenarios. Iris coverage includes keyboard and pointer planting, actual multi-touch pinch, pan, hidden-tab suspension, WebGL context loss/recovery and repeated twelve-plant fill/restart cycles.
- Warmed resource counts stay constant across repeated full-garden restarts; the botanical revision uses a larger geometry and texture pool.
- Production layout checks cover all seven levels at 1440px and 390px. Iris stage/layout captures additionally cover 320px. The mobile scene is 480px high and controls remain below it.
- Captured bulb, rooting, emergence, leaves, bud and bloom at 1440px, 390px and 320px. Reviewed single-plant, staggered four-plant and full twelve-plant compositions against the guide. Flowers and tank fit within the scene, roots remain visible, and narrow screens have no horizontal page overflow. Very young roots are small at fitted mobile scale; zoom exposes their detail.

Local screenshots are written to `artifacts/iris-*.png`, `artifacts/iris-review/` and `artifacts/production-layout/`. These generated test artifacts are ignored by Git.

### Performance sample (before the botanical revision)

These historical measurements describe the earlier, lower-detail renderer. The revised flowers prioritize visual detail; no new performance target is imposed.

Measured in headless Chrome 153 on the development computer, with DPR 1 and twelve growing plants at 20×. The 390px run is a viewport test, not a physical-phone benchmark. Samples cover 6.5 seconds beginning after 105 simulated seconds, including stalk, bud and flower development. Results vary with machine load.

| Viewport | Mean frame interval | 95th percentile | Recorded draw calls, median / max |
| -------- | ------------------- | --------------- | --------------------------------- |
| 1440px   | 10.3 ms             | 20.8 ms         | 120 / 120                         |
| 390px    | 10.4 ms             | 20.8 ms         | 120 / 120                         |

The completed sample contained 576 root paths and 22,079 root samples. Optimization retained the same visual detail: active root ranges, cached ring directions, and skipped unchanged or invisible organ buffers. No graphics modes were added.

### Reproduce checks

```sh
npm test
npm run build
npx playwright test tests/browser/plant.spec.ts tests/browser/loading.spec.ts tests/browser/language.spec.ts
node scripts/check-production-layout.mjs
```

For the optional performance capture, start the development server, then run `node scripts/check-plant-performance.mjs`. Set `PLANT_TEST_URL` if the server is not on port 5173. It writes machine-readable results to `artifacts/iris-review/performance.json`. Development-only inspection hooks are omitted from the production build.
