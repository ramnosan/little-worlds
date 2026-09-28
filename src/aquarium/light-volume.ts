// Shared by atlas rendering and GLSL sampling so their layout stays in sync.
export const LIGHT_VOLUME = {
  sliceWidth: 256,
  sliceHeight: 160,
  slices: 48,
  columns: 8,
  rows: 6,
  height: 1.95,
  scatteringSamples: 96,
} as const;
