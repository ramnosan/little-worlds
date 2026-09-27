# Koi integration — supplied animated asset installed

## Current status

The user supplied `koi_fish.glb` on 26 September 2026. Its embedded provenance identifies [Koi Fish by 7PLUS](https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59), CC BY 4.0. Two independently animated copies are now installed locally. The app footer links to the distributed source credit, license and modification notice.

The file contains **522 triangles, 519 vertices, two 1024px textures, 150 baked morph poses and no skeletal rig**. It is not the previously researched HuyKhoi2407 model. Its authored coloration and surface detail are preserved; no 4K detail or independent gill/fin bones are claimed. The original high-detail skeletal realism target remains unmet by this supplied model.

`scripts/prepare-provided-koi.py` normalizes the animated envelope to 0.48m, centers it, faces it along +Z and converts embedded images to PNG. The source contains two identical 75-pose cycles; the normal export retains one cycle, while the lighter export retains 25 poses. Both loop over 3.125 seconds with an exact duplicate first pose at the endpoint. The 1K textures are retained in both modes without upscaling. Source SHA256: `487d5062b04de9112dc67e285e6cbf2535ccf516c666131501a4e29b50d74b6e`.

Reproduce with `python scripts/prepare-provided-koi.py path/to/koi_fish.glb` (Python, NumPy and Pillow). Source input is read-only. Exports are `public/models/koi/7plus-high.glb` and `7plus-low.glb`. The two manifest identities are `koi-1`, `koi-2`, so diagnostics do not mislabel the copies as Tancho or Ochiba. Each quality is fetched/decoded once and shared between two meshes with independent morph weights and mixers.

Synthetic skinned cylinders exist only in the automated test fixtures. Playwright serves them through intercepted requests; they are never copied into public assets or production bundles. Their screenshots and timings validate integration mechanics, not koi realism or production performance.

## Earlier asset research

Preferred source: [Jurrian0304, Koi Carp Pack, product 1841640](https://www.turbosquid.com/FullPreview/1841640). The listing describes Showa, Tancho and Ochiba variants, a 0.48 m model, Blender source, skeletal swimming and 4K maps. The preview uses subdivision and Cycles materials; FBX lacks those materials and advanced controls. The current checkout price could not be verified. No price or purchase approval is inferred.

Checked the [TurboSquid Royalty Free License](https://www.turbosquid.com/help/en/articles/9937422-royalty-free-license), section II.7(b), on 25 September 2026. It restricts open-format model distribution and specifies conditions for WebGL usage. Do not assume that serving this pack as ordinary GLB files through Three.js is permitted. Obtain explicit written clearance covering the intended GLB/texture delivery before purchasing for this integration. Compression or renaming a GLB is not clearance. No messages have been sent to the vendor.

The user chose to find a replacement licensed for browser delivery and subsequently supplied the 7PLUS model described above. The preferred TurboSquid acquisition is no longer the active route. See [replacement research](koi-asset-research.md) for alternatives if higher detail is needed.

## Future high-detail skeletal export contract

After clearance and acquisition, use the native Blender files so the source rig and materials are preserved. Inspect the actual armature and material graph before conversion; their names and driver dependencies have not been verified from source files.

1. Normalize each fish to 0.48 m total length, centered around its body, with **+Z forward and +Y up**. Apply model scale before export. Exclude source cameras, lights and floor. Export the fish body, eyes, gills, fins and their armature together.
2. Bake the source swim action and rig drivers to deformation-bone keyframes. Make the exported action an in-place, seamless loop named `Swim`. Keep independent fin and gill motion. Avoid root translation and heading changes within the loop; navigation controls those transforms.
3. Bake the material graph into embedded PNG base-color, tangent-space normal and roughness textures. Preserve scale relief, patch coloration, eyes and fin opacity. Convert unsupported Cycles subsurface/transmission effects to a restrained real-time PBR approximation; do not assume offline material parity.
4. Prepare a normal-quality mesh with a smooth silhouette and 4096-pixel body textures. Prepare a separately reduced mesh with 1024-pixel textures for lighter graphics. Keep both exports in the same coordinates, with equivalent rigs and the same clip timing. Prefer shared maps for eyes/fins where appropriate. All geometry needs normals and skin weights; all resources must be embedded, with no decoder/CDN dependencies.
5. Save `showa-high.glb`, `showa-low.glb`, `tancho-high.glb`, `tancho-low.glb` beside the manifest. Fill the manifest as below, retain the acquisition/license record outside publicly served assets, and run `npm run validate:koi`.

```json
{
  "version": 1,
  "assets": [
    {
      "variety": "showa",
      "high": "./showa-high.glb",
      "low": "./showa-low.glb",
      "swimClip": "Swim"
    },
    {
      "variety": "tancho",
      "high": "./tancho-high.glb",
      "low": "./tancho-low.glb",
      "swimClip": "Swim"
    }
  ]
}
```

The preflight checks GLB structure, embedded resources, the declared deformation type, normals, named clips and PNG dimensions. Skeletal/4096px is the default profile. The supplied model explicitly declares morph animation and 1024px maps; passing that profile does not satisfy the original skeletal/4K acceptance. It cannot certify the license, anatomy, visual quality, bone influence quality or animation seams.

## Runtime behavior

`KoiSchool` uses the aquarium's fixed 120 Hz clock. Two independently seeded swimmers follow wandering destinations with acceleration limits, bounded angular speed, gliding and depth variation. Conservative 0.27 m body-enclosing collision bounds account for the full 0.48 m fish. Avoidance uses glass, floor, shared stone data, balls and a snapshot of the other fish. Contact projection is a containment backstop; it is not a fluid/animal biomechanics simulation.

At most eight short-lived user-ripple stimuli affect steering. Near-surface wakes are emitted at bounded intervals through the water impulse API and do not increment the user interaction counter. Assets must be loaded before the school is enabled.

`KoiVisuals` loads all required assets before replacing the visible school. Repeated URLs share geometry, textures and materials; per-fish deformation state remains independent. Quality changes preserve simulation state and animation phase; failure preserves the old models and exposes retry. Generations and abort signals prevent stale requests from installing assets after reset/quality changes/disposal. Reset does not reload assets when the current quality already matches. Each fish has an independent mixer and either skeleton or morph weights, driven by absolute simulation animation time, inside a navigation transform.

The optical renderer bakes current morph/skinned poses with `three-mesh-bvh`'s `StaticGeometryGenerator`, refits one reusable BVH and uploads its query textures. It retains UVs, base color, normal maps, scalar roughness/metalness and alpha. The original raster fish are hidden during tank composition, so visible fish use one refracted optical path. Photon caustics illuminate their animated surfaces. The earlier transparent surface and clipped planar reflection remain the capability fallback. See [current optics architecture and validation](aquarium-optics.md).

`koi-waterline.spec.ts` measures actual rendered fish pixels across 100 small movements at the front and side boundaries, in both quality modes at noon and night. Optical hit IDs exclude moving caustic shadows from fish coverage. It requires multiple partially visible frames and limits sudden coverage changes.

Read-only development diagnostics include asset status and loading error, loaded count, quality, skeleton count, morph targets/weights, animation times and movement state. Missing assets display `Koi nicht verfügbar`, never `2 Koi`.

## Acceptance still required

The supplied asset has been checked from overhead, oblique and side views, with a short canvas recording. These captures show its authored morph deformation and preserved coloration; there are no skeletal bones or independent gill controls. Shared mesh/texture resources stay stable through repeated quality changes and resets. The production build, 61 unit tests and all 10 aquarium/koi browser checks passed, including a dedicated supplied-asset test. A broader browser run passed 27/29: a mobile bubble interaction failed during navigation, and the supplied asset download exceeded the test's default five-second wait. The real-asset test now allows 15 seconds for asynchronous loading. All 11 targeted reruns passed, including both previously failing cases, without a concurrent build. The required in-app browser connection was unavailable, so visual review used installed Chrome.

Measured on development-desktop Chrome, 1440 x 1000, normal mode, over 360 animation frames while recording: **141.9 fps**, 95th-percentile frame interval **7.1 ms**. Light mode at 390 x 844 in Chrome mobile emulation on the same desktop: **143.5 fps**, 95th-percentile interval **7.0 ms**. These are requestAnimationFrame throughput measurements, not GPU timings. A real mobile device was not tested. Reproduce with `node scripts/review-koi.mjs` while Vite runs on port 5174; captures and the JSON report are written to `artifacts/koi-provided-*`.

The earlier high-detail skeletal asset, distinct three-variety textures, independent fin/gill rig controls and real-mobile 30 fps acceptance remain outstanding. Installing the supplied lower-detail morph model does not certify those requirements.
