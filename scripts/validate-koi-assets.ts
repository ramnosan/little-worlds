import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseKoiManifest } from '../src/aquarium/koi-assets';

/** Structural preflight; reports supplied-asset limitations separately from rigged acceptance. */
const manifestPath = resolve('public/models/koi/manifest.json');
const manifest = parseKoiManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
if (!manifest.assets.length)
  throw new Error(
    'Production koi assets are not installed. Asset clearance, purchase and conversion remain pending.',
  );
for (const entry of manifest.assets)
  for (const quality of ['high', 'low'] as const) {
    const path = resolve(dirname(manifestPath), entry[quality]);
    const bytes = await readFile(path);
    if (
      bytes.length < 28 ||
      bytes.readUInt32LE(0) !== 0x46546c67 ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length
    )
      throw new Error(`${path}: invalid GLB 2.0`);
    const jsonLength = bytes.readUInt32LE(12);
    if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes.length)
      throw new Error(`${path}: missing JSON chunk`);
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
    if (
      doc.buffers?.some((b: { uri?: string }) => b.uri) ||
      doc.images?.some((i: { uri?: string }) => i.uri)
    )
      throw new Error(`${path}: package buffers and images inside the GLB`);
    const morph = entry.deformation === 'morph';
    if (
      (!morph && !doc.skins?.length) ||
      !doc.animations?.some((a: { name: string }) => a.name === entry.swimClip)
    )
      throw new Error(`${path}: missing declared deformation or named swimming clip`);
    const primitives = doc.meshes?.flatMap((m: { primitives: unknown[] }) => m.primitives) ?? [];
    if (
      !morph &&
      !primitives.some(
        (p: { attributes: Record<string, number> }) =>
          p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined,
      )
    )
      throw new Error(`${path}: no skinned geometry`);
    if (morph && !primitives.some((p: { targets?: unknown[] }) => p.targets?.length))
      throw new Error(`${path}: no morph geometry`);
    if (
      primitives.some(
        (p: { attributes: Record<string, number> }) => p.attributes.NORMAL === undefined,
      )
    )
      throw new Error(`${path}: missing geometry normals`);
    if (!doc.images?.length) throw new Error(`${path}: production koi require baked textures`);
    // The preparation contract uses PNG so embedded dimensions can be checked without an image decoder.
    const binStart = 20 + jsonLength;
    if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942)
      throw new Error(`${path}: missing binary chunk`);
    const target = quality === 'high' ? (entry.textureSize ?? 4096) : 1024;
    let hasTarget = false;
    for (const image of doc.images) {
      const view = doc.bufferViews[image.bufferView];
      if (!view || image.mimeType !== 'image/png')
        throw new Error(`${path}: bake embedded PNG textures`);
      const start = binStart + 8 + (view.byteOffset ?? 0);
      if (bytes.subarray(start, start + 8).toString('hex') !== '89504e470d0a1a0a')
        throw new Error(`${path}: invalid PNG`);
      const width = bytes.readUInt32BE(start + 16),
        height = bytes.readUInt32BE(start + 20);
      if (width > target || height > target)
        throw new Error(`${path}: texture exceeds ${target}px ${quality} budget`);
      if (width === target && height === target) hasTarget = true;
    }
    if (!hasTarget) throw new Error(`${path}: expected a ${target} × ${target} texture set`);
    console.log(
      `${entry.variety} / ${quality}: ${morph ? 'morph animation' : 'skeleton'}, clip and ${target}px embedded textures verified (${(bytes.length / 1048576).toFixed(1)} MiB)`,
    );
  }
console.log(
  'Structural asset checks passed. In-app anatomy, material, deformation and performance review is still required.',
);
if (manifest.assets.some((a) => a.deformation === 'morph' || a.textureSize === 1024))
  console.log(
    'Supplied asset profile: does not meet the original skeletal rig / 4K realism acceptance.',
  );
