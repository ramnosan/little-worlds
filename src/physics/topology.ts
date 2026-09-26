export interface Topology {
  vertices: Float64Array;
  faces: Uint16Array;
  edges: Uint16Array;
  bends: Uint16Array;
}

/** A welded, consistently wound icosphere. No rendering dependency. */
export function makeIcosphere(detail = 2): Topology {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices: number[] = [
    -1,
    t,
    0,
    1,
    t,
    0,
    -1,
    -t,
    0,
    1,
    -t,
    0,
    0,
    -1,
    t,
    0,
    1,
    t,
    0,
    -1,
    -t,
    0,
    1,
    -t,
    t,
    0,
    -1,
    t,
    0,
    1,
    -t,
    0,
    -1,
    -t,
    0,
    1,
  ];
  const normalize = (i: number) => {
    const length = Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]);
    for (let k = 0; k < 3; k++) vertices[i + k] /= length;
  };
  for (let i = 0; i < vertices.length; i += 3) normalize(i);
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
    8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];
  for (let level = 0; level < detail; level++) {
    const cache = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const existing = cache.get(key);
      if (existing !== undefined) return existing;
      const index = vertices.length / 3;
      for (let k = 0; k < 3; k++) vertices.push((vertices[a * 3 + k] + vertices[b * 3 + k]) / 2);
      normalize(index * 3);
      cache.set(key, index);
      return index;
    };
    const next: number[] = [];
    for (let i = 0; i < faces.length; i += 3) {
      const [a, b, c] = faces.slice(i, i + 3);
      const ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }
  return makeTopology(vertices, faces);
}

export function makeTopology(vertices: number[], faces: number[]): Topology {
  const edges: number[] = [],
    bends: number[] = [];
  const opposite = new Map<string, number>();
  for (let i = 0; i < faces.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = faces[i + j],
        b = faces[i + ((j + 1) % 3)],
        c = faces[i + ((j + 2) % 3)];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const other = opposite.get(key);
      if (other === undefined) {
        opposite.set(key, c);
        edges.push(a, b);
      } else bends.push(other, c);
    }
  }
  return {
    vertices: new Float64Array(vertices),
    faces: new Uint16Array(faces),
    edges: new Uint16Array(edges),
    bends: new Uint16Array(bends),
  };
}

export const BLOB_TOPOLOGY = makeIcosphere();
