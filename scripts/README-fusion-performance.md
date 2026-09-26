# Fusion CPU benchmark

Run `npm run benchmark:fusion` (optionally `-- artifacts/fusion-profile.json`).
The seeded workload measures an isolated pair, then a 32-bubble scene with two
overlapping merge schedules and distant neighbors. It warms the code before
measuring, reports average and 95th-percentile physics-step CPU time during
relaxation, and separates mesh generation from support-query time. Rendering,
GPU time, and browser frame rate are not included; timings depend on the machine.

The optimization keeps the 32/24 grids and 120 Hz forces/timers. Mesh generation
and triangle picking share deterministic 60 Hz samples. Cartesian squared
distances are reused during field generation. Conservative bounding spheres
reject distant contacts and missed dart segments before vertex/triangle scans;
they never generate a hit. Exact directional extents are cached per surface
revision, and GPU uploads cover only the active triangle range.

On the local benchmark, mean step time changed from 4.51 to 1.03 ms for the pair
and 27.61 to 2.06 ms for the crowded scene. Crowded-scene vertex support queries
fell from 102,051 to zero because those neighbors were outside contact range.
Raw captures are in `artifacts/fusion-baseline.json` and
`artifacts/fusion-optimized.json`.

The smoother 1.35-second transition retains those sampling rates, grid resolutions,
resource pools and early rejection. Close contacts now sample the normalized
two-lobe field directly instead of scanning vertex support extents. The grid stays
fixed throughout each merge; attachment anchors blend over 0.2 seconds and each
body's fusion-related positional correction has a cumulative per-step budget.

A fresh comparison on the same machine measured mean step times of 1.032 to
0.875 ms for the pair (-15.2%) and 1.923 to 2.035 ms for the crowded scene (+5.8%),
within the 20% additional mean CPU cost target. The longer animation has more
sampled steps (144/231 versus 102/189), so total work per completed merge increases.
These are CPU timings, not a GPU or end-to-end frame-rate guarantee. Captures:
`artifacts/fusion-before-smoothing.json` and `artifacts/fusion-smooth-final.json`.

The deterministic cluster replay's largest single-step positional correction
dropped from 0.1161 m to 0.0127 m, excluding the logical center-of-mass ownership
change. `tests/smooth-fusion.test.ts` verifies the cumulative 2%-of-radius limit,
unequal lobes, attachment anchors, phase continuity, consecutive merges, volume,
pause/reset and local dart hits. Browser tests capture both handoffs and the neck,
pulling and settling phases on desktop/mobile, including a slow cluster replay.
