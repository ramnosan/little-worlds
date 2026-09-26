import * as T from 'three';

/** A small, seeded 3D noise lattice, generated locally; no images or video. */
export function turbulenceTexture() {
  const size = 32;
  // Half floats avoid contour bands when thin emissive folds magnify the
  // quantization of an 8-bit noise lattice. WebGL 2 supports linear filtering.
  const data = new Uint16Array(size * size * size * 4);
  let seed = 0x51f15e;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = T.DataUtils.toHalfFloat((seed >>> 8) / 16777215);
  }
  const texture = new T.Data3DTexture(data, size, size, size);
  texture.format = T.RGBAFormat;
  texture.type = T.HalfFloatType;
  texture.minFilter = texture.magFilter = T.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = T.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
