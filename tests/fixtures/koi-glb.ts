/** Synthetic skinned cylinders for loader/render regression tests only.
 * Never installed in public/ and never presented as production koi assets. */
import * as T from 'three';
export function koiFixtureGlb(color: [number, number, number], low = false): Buffer {
  const geometry = new T.CylinderGeometry(0.055, 0.045, 0.48, low ? 8 : 16, 8).rotateX(Math.PI / 2);
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal;
  const joints = new Uint16Array(position.count * 4),
    weights = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const z = Math.min(2.999, Math.max(0, (position.getZ(i) + 0.24) / 0.16)),
      k = Math.floor(z),
      blend = z - k;
    joints.set([k, k + 1, 0, 0], i * 4);
    weights.set([1 - blend, blend, 0, 0], i * 4);
  }
  const inverse = new Float32Array(16 * 4);
  for (let i = 0; i < 4; i++)
    new T.Matrix4().makeTranslation(0, 0, -(-0.24 + i * 0.16)).toArray(inverse, i * 16);
  const times = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
  const rotations = new Float32Array(20);
  for (let i = 0; i < 5; i++)
    new T.Quaternion()
      .setFromAxisAngle(new T.Vector3(0, 1, 0), Math.sin(i * Math.PI * 0.5) * 0.5)
      .toArray(rotations, i * 4);
  const chunks: Buffer[] = [],
    views: Record<string, number>[] = [],
    accessors: Record<string, unknown>[] = [];
  let offset = 0;
  function add(
    data: ArrayBufferView,
    componentType: number,
    type: string,
    count: number,
    extra: Record<string, unknown> = {},
  ) {
    const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4);
    raw.copy(padded);
    views.push({ buffer: 0, byteOffset: offset, byteLength: raw.length });
    chunks.push(padded);
    offset += padded.length;
    accessors.push({ bufferView: views.length - 1, componentType, type, count, ...extra });
    return accessors.length - 1;
  }
  const p = add(position.array, 5126, 'VEC3', position.count, {
    min: [-0.06, -0.06, -0.24],
    max: [0.06, 0.06, 0.24],
  });
  const n = add(normal.array, 5126, 'VEC3', normal.count),
    j = add(joints, 5123, 'VEC4', position.count),
    w = add(weights, 5126, 'VEC4', position.count);
  const indices = geometry.index!,
    ind = add(new Uint16Array(indices.array), 5123, 'SCALAR', indices.count);
  const ibm = add(inverse, 5126, 'MAT4', 4),
    t = add(times, 5126, 'SCALAR', 5, { min: [0], max: [1] }),
    q = add(rotations, 5126, 'VEC4', 5);
  const doc = {
    asset: { version: '2.0', generator: 'Synthetic test fixture; not a koi asset' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'TestRoot', children: [1, 5] },
      { name: 'Spine0', translation: [0, 0, -0.24], children: [2] },
      { name: 'Spine1', translation: [0, 0, 0.16], children: [3] },
      { name: 'Spine2', translation: [0, 0, 0.16], children: [4] },
      { name: 'Tail', translation: [0, 0, 0.16] },
      { name: 'SyntheticCylinder', mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [1, 2, 3, 4], skeleton: 1, inverseBindMatrices: ibm }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: p, NORMAL: n, JOINTS_0: j, WEIGHTS_0: w },
            indices: ind,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [...color, 1],
          metallicFactor: 0,
          roughnessFactor: 0.35,
        },
      },
    ],
    animations: [
      {
        name: 'Swim',
        samplers: [{ input: t, output: q, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 3, path: 'rotation' } }],
      },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset }],
  };
  const json = Buffer.from(JSON.stringify(doc)),
    jsonChunk = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(jsonChunk);
  const bin = Buffer.concat(chunks),
    result = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonChunk.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(result, 20);
  const at = 20 + jsonChunk.length;
  result.writeUInt32LE(bin.length, at);
  result.writeUInt32LE(0x004e4942, at + 4);
  bin.copy(result, at + 8);
  geometry.dispose();
  return result;
}
