# Procedural campfire

The flame and smoke renderer is original code in `src/fire/shaders.ts`. It replaces the former footage player completely. It requires WebGL 2 and uses the existing Three.js dependency.

## Research and design

Research was completed before implementation. These sources informed the rendering model; their example code and media were not copied:

- [Crane, Llamas and Tariq: GPU Gems 3, Chapter 30](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-30-real-time-simulation-and-rendering-3d-fluids): volume ray marching, stopping at opaque scene depth, and front-to-back compositing.
- [Nguyen, Fedkiw and Jensen: Physically Based Modeling and Animation of Fire](https://graphics.stanford.edu/papers/fire-sg02/): buoyant hot products, luminous reaction regions, and temperature-dependent emission from soot.
- [Physically Based Rendering, Transmittance](https://pbr-book.org/4ed/Volume_Scattering/Transmittance): exponential attenuation accumulated along a ray.

The browser implementation uses an analytic, advected procedural flow field. It does not implement these papers' Navier-Stokes solvers or spectral blackbody rendering. Its linear-HDR temperature palette is an artistic approximation, not a Kelvin measurement.

## Field and motion

A heat-weighted center derived from the actual burning sticks anchors one shared plume. Capsule-shaped sources contribute short flames at the wood; the common column supplies the taller connected flame. Changing the fuel distribution, wind or pile position changes the field.

`src/fire/turbulence.ts` generates a seeded 32^3 RGBA half-float noise lattice in memory (256 KiB). Quintic interpolation and three spatial octaves provide smooth variation. Domain warping and slow lateral motion bend the column; advected detail rises through it. An irregular cross section and thin luminous reaction regions create folds around a dimmer interior. Smoke shares the wind and rising flow, spreads with height and fades at the volume boundary.

All motion uses simulation time. There are no discrete source frames, clip boundaries, frame-random noise or screen-space history. Pausing freezes the flame, smoke, heat distortion and firelight while camera movement remains possible. Hidden tabs do not accumulate catch-up time.

## Optical integration

For each camera ray, intersect a bounded world-space box and shorten the ray at opaque scene depth. At each midpoint sample, evaluate flame emission and smoke extinction. Integrate with `alpha = 1 - exp(-extinction * distance)` and accumulate front to back. The premultiplied result is composited with the opaque scene in linear HDR, followed by restrained bloom and tone mapping.

Desktop mode uses 224 integration samples at 70% drawing-buffer dimensions; light mode uses 88 at 45%. They use exactly the same combustion and flow field. A single generated noise texture is reused across reset/quality changes and disposed on teardown.

## Asset removal

The project copies of Motion Fire's AEP and source clips, the two generated atlases and manifest, the footage preparation script, the old player, and extracted source previews were deleted at the user's request. The production build contains no fire media. Original files outside the workspace, including Downloads, were not modified.

## Limits

This is a real-time visual approximation. Flow is prescribed rather than pressure-solved; smoke scattering and illumination are approximate. Opaque depth correctly hides volume behind visible wood, but the flow does not solve solid-boundary fluid collisions or multiple scattering. See [validation notes](fire-validation.md) for actual hardware measurements and checks.
