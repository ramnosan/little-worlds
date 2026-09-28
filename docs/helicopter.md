# Horizon 05

Level 09 is an English aviation design study. It is inspired by the proportions of modern light twins, not an engineering replica or a flight simulator.

The aircraft tabs also open [Raptor 22](raptor.md), a separate F-22 study in the same level. Each aircraft has its own self-contained HTML; `npm run build:helicopter` rebuilds both.

The [original prompt by Vib3Coded](https://x.com/vib3coded/status/2102215638311694336) is the source for this level's brief.

## Deliverable and source

- `public/horizon-05.html` is the standalone, offline deliverable.
- `src/helicopter/template.html` contains the interface and responsive styles.
- `src/helicopter/scene.js` generates the geometry, studio, materials, and interactions.
- `scripts/build-helicopter.mjs` bundles the installed Three.js and OrbitControls into a classic inline script, preserving the MIT notice. `npm run build` regenerates it; `npm run build:helicopter` rebuilds just this level.

The level selector links directly to the standalone page; `?level=helicopter` redirects there. Its return link opens the other worlds when the HTML is served as part of the site. A separately downloaded file contains the complete helicopter experience, but not the other worlds.

## Geometry and rendering

The hull is a smooth longitudinal loft. Paint bands, panel seams, door outlines, and glazing use its same surface parameterization. Window polygons are rounded and tessellated before being projected onto the hull; rubber seals are embedded in the hull surface. The dark tinted glazing uses an opaque reflective PBR finish rather than rendering a cabin interior.

Twin engine nacelles include intake lips, grille slats, side vents, open exhaust tubes, and recessed exhaust ends. Skid tubes sweep upward at the nose; four structural supports extend into the belly and both boarding steps have attached supports. The tapered boom overlaps the aft fuselage and joins the tail duct's lower forward edge. The annular tail housing has an actual extruded hole, a tunnel wall, stationary gearbox supports, and ten rotating blades. The main rotor has five shaped blades, five grips, bolts, pitch horns, and linkages connected to the swashplate. Its plane clears the fuselage, engines, and antennas; the high tail fin lies outside the rotor radius.

Three.js PBR materials use a locally generated, prefiltered RoomEnvironment for studio reflections. A shadow-casting key light, fill light, circular platform, and shadow catcher complete the studio. Shared primitive geometry and materials, instanced rivets, a pixel-ratio cap of 1.75, and bounded geometry keep the scene modest (approximately 145,000 rendered triangles and 280 draw calls at rest). No prebuilt models or remote assets are loaded.

## Interaction and accessibility

Both rotors accelerate and decelerate exponentially using elapsed seconds. Hover waits for lift power, eases to altitude, and adds a small sway. Landing keeps sufficient rotor power until touchdown before allowing full shutdown. A speed below 55% requests landing. These are presentation animations, not aerodynamic simulation.

Mouse and touch orbit/zoom use OrbitControls. Preset camera transitions, auto orbit, lift and rotor motion use delta time; background tabs suspend updates and unusually long frames are capped. The initial camera fits the full rotor span at desktop and mobile sizes. Mobile settings sit below the scene, with no overlay obstructing the aircraft. Controls have accessible names, visible focus, pressed states, and keyboard alternatives. Reduced motion removes sway and flashing; animation starts only by explicit interaction. WebGL initialization failure displays a useful fallback and disables scene controls. Context loss pauses rendering and resumes on restoration.

## Verification

`npx playwright test tests/browser/helicopter.spec.ts` checks:

- An open tail aperture, checked by 108 rays through the rotor area against the boom, fins and housing; all liveries; gradual rotor startup and shutdown; speed extremes; lift, hover, soft landing, and the low-speed landing interlock.
- Front, side, and tail cameras; pointer orbit, wheel zoom, reset, automatic orbit, keyboard shortcuts, and fullscreen entry/exit.
- A 390 px mobile layout with real touch orbit and two-finger pinch, a capped pixel ratio, no horizontal overflow, and controls outside the canvas.
- Loading the standalone HTML from `file://` with no external runtime requests, and a simulated missing WebGL context.
- Level navigation, the query route, reduced-motion startup, initial rotor framing, and console/page errors.

`node scripts/inspect-helicopter.mjs` records the front, side, rear, opposite side, top, default, and mobile views in `artifacts/helicopter/`. `npm run test:production` covers the new level and all eight existing levels in the built site. The scene exposes read-only diagnostic values only with `?inspect` for these tests.
