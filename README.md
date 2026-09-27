# Little Worlds

Small worlds. Play a little.

**[Play Little Worlds in your browser](https://ramnosan.github.io/little-worlds/)**

Little Worlds is a collection of eight warm, tactile 3D playgrounds. The original worlds use TypeScript and Three.js; Melon Jelly is a standalone native WebGPU study. Stretch a jelly, blow soap bubbles, disturb the surface of an aquarium, watch a model train, tend a campfire, fly a tiny aeroplane, grow an iris garden, or play with a watermelon gummy. There are no accounts, scores, or online services: each world is simply a small place to explore at your own pace.

All worlds support mouse and touch controls. The original worlds support English and German, with lighter graphics options where available; Melon Jelly follows its English material-study brief and uses native WebGPU.

## The worlds

### 01 · Jelly

![Three colourful soft-body jellies on a miniature playground](docs/screenshots/01-jelly.png)

Grab, stretch, toss, and stack glossy soft-body jellies in a pastel studio. Choose their colour and size, change gravity and softness, or pick up the mallet for a satisfying swing. Drag a jelly to squish it, drag empty space to orbit the scene, and scroll or pinch to zoom; **N** adds a jelly, **Space** pauses, and **R** resets the playground.

### 02 · Bubbles

![Iridescent soap bubbles floating in a garden scene](docs/screenshots/02-bubbles.png)

Hold the blow button and release it to make an iridescent bubble—the longer the breath, the larger it grows. Bubbles drift with the breeze, bump into one another, share films, and sometimes merge; tap one to pop it or throw darts for a trickier shot. Create twelve bubbles to complete the gentle goal, then keep playing for as long as you like.

### 03 · Aquarium

![A glass aquarium with animated koi and moving caustic light](docs/screenshots/03-aquarium.png)

Touch the water to send ripples across a glass tank filled with animated koi, shifting light, and buoyant balls. Adjust the waves, move through an eight-minute day-and-night cycle, and choose between the high-quality optical renderer and an efficient fallback. The aquarium's AI-assisted development used [CAUSTIC//VOLUME by ScottieFox](https://github.com/ScottieFox/caustic-volume) as inspiration and a technical reference; its optical equations, photon-area projection, and curved wave-detail ideas were adapted under the MIT License.

### 04 · Model Railway

![A miniature alpine railway winding through the village of Kleinwald](docs/screenshots/04-model-railway.png)

Follow a red locomotive and its carriages around the miniature Alpine village of Kleinwald. The route winds past timber houses, dense forests, rocky cuttings, a bridge, and warmly lit tunnels beneath the mountains. Set the train's speed, orbit and zoom around the tabletop, pause the journey with **Space**, or send it back to the beginning with **R**.

### 05 · Campfire

![A glowing campfire burning in a forest clearing at dusk](docs/screenshots/05-campfire.png)

Stay beside a procedural campfire as logs char, settle, and fade into embers in a dark forest clearing. Add wood, rekindle a cooling pile, change the evening wind, and turn on locally synthesized crackling after interacting with the page. The flames, smoke, sparks, firelight, bark, and ash are generated in real time without videos or imported fire effects.

### 06 · Model Flight

![A yellow model aeroplane waiting on a countryside runway](docs/screenshots/06-model-flight.png)

Fly a small yellow high-wing model aeroplane from a countryside airfield. Build speed, lift off, bank through the open sky, switch between ground and chase views, and return gently enough to keep the aircraft intact. Keyboard controls model throttle, elevator, ailerons, and rudder, while touchscreens provide a pair of familiar flight sticks.

### 07 · Plant

Plant up to twelve Dutch iris bulbs in a shallow glass soil tank. One starter bulb begins the garden; click in the planting band to add more, or select a plant to inspect its age and stage. Each bulb has its own growth rate and developing roots. Roots respond to soil resistance, stones, tank boundaries and neighbouring roots. Gentle crowding slows growth without preventing flowering.

An uncrowded iris takes about three minutes to bloom at **1×**, with **5× / 20×**, pause and elapsed time. Plants hold their first bloom while younger bulbs continue developing. **Restart clears the tank**. Left-drag to pan, right-drag to orbit around the glass soil tank, scroll or pinch to zoom, and use **Fit view** to restore the full tank. On touchscreens, two fingers pan/zoom. With the canvas focused, arrow keys move the bulb preview and Enter plants; **Space** pauses and **R** restarts.

The procedural scene uses a single high-quality renderer, bounded reusable geometry, soft shadows and translucent leaf/petal lighting. No watering, quality settings, timeline seeking or saved growth. The time and shallow root display are illustrative rather than a validated horticultural model. See the [visual guide](docs/plant-style.md) and [implementation and verification notes](docs/plant-simulation.md).

### 08 · Melon Jelly

A thick watermelon gummy with ruby flesh, pale pith, striped green rind and individually modeled seeds. Grab any part to stretch the tetrahedral soft body, release to wobble, or drag empty space to inspect both sides. Two touches can hold and twist separate parts. Colour presets, firmness, internal damping, quarter speed, mesh inspection and pause are available in the specimen panel. The canvas also supports arrow-key nudges, **Space** to pause and **R** to reset.

Open [Melon Jelly](public/melon-jelly.html), or visit `melon-jelly.html` on the running site (`?level=melon` also redirects there). **The single HTML file contains all JavaScript, CSS, geometry and WGSL**, with no external runtime dependencies. It requires genuine WebGPU and a supported graphics device; HTTPS or localhost is recommended. An explicit error explains unavailable WebGPU. Reduced-motion preferences start the simulation paused.

The CPU solves XPBD elastic and signed-volume constraints at 120 Hz with bounded catch-up, local grabs, inversion safeguards and frictional ground contact. The native WebGPU renderer uses measured back-face thickness, approximate absorption/refraction, Fresnel lighting and filtered shadow mapping. Readouts use the illustrative scale printed beneath the experiment. This level was created from a prompt by [Vib3Coded](https://x.com/vib3coded/status/2103741107225907467). See [implementation and validation notes](docs/melon-jelly.md).

## Run locally

Little Worlds requires Node.js 20.12 or newer and npm. Install the locked dependencies and start the development server:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) in a WebGL 2 browser with hardware acceleration. The most useful project commands are:

```sh
npm run build            # Type-check and create the production bundle
npm run preview          # Preview the production bundle locally
npm test                 # Run rendering-independent tests
npm run test:browser     # Run browser interaction and layout tests
npm run test:production  # Build and check all eight desktop/mobile layouts
```

GitHub Pages deployment is handled by [the included workflow](.github/workflows/deploy.yml). Set **Settings → Pages → Source** to **GitHub Actions**; pushes to `main` will build and publish the site under `/little-worlds/`.

## Credits

Little Worlds is built with [Three.js](https://threejs.org/) and is released under the [MIT License](LICENSE). The Aquarium adapts ideas and code from [CAUSTIC//VOLUME](https://github.com/ScottieFox/caustic-volume), also under the MIT License; its full notice is preserved in [`public/licenses/caustic-volume.txt`](public/licenses/caustic-volume.txt).

The aquarium's [Koi Fish](https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59) model is by [7PLUS](https://sketchfab.com/7plus) and is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Adaptation details are recorded in the [koi integration notes](docs/koi-integration.md).
