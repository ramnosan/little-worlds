import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';
import type { Topology } from '../physics/topology';
import type { SoftBody } from '../physics/world';

type Weight = Map<number, number>;
function blend(parts: [Weight, number][]): Weight {
  const out: Weight = new Map();
  for (const [weights, factor] of parts)
    for (const [index, weight] of weights) out.set(index, (out.get(index) ?? 0) + weight * factor);
  return out;
}

// Precomputed Loop-subdivision stencils smooth the physical mesh without adding simulation particles.
function subdivision(topology: Topology, levels: number) {
  let weights: Weight[] = Array.from(
    { length: topology.vertices.length / 3 },
    (_, i) => new Map([[i, 1]]),
  );
  let faces = Array.from(topology.faces);
  for (let level = 0; level < levels; level++) {
    const neighbors = weights.map(() => new Set<number>());
    const edges = new Map<string, { a: number; b: number; opposite: number[]; index: number }>();
    for (let i = 0; i < faces.length; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = faces[i + j],
          b = faces[i + ((j + 1) % 3)],
          c = faces[i + ((j + 2) % 3)];
        neighbors[a].add(b);
        neighbors[b].add(a);
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const edge = edges.get(key);
        if (edge) edge.opposite.push(c);
        else edges.set(key, { a, b, opposite: [c], index: 0 });
      }
    const next = weights.map((w, i) => {
      const adjacent = Array.from(neighbors[i]);
      const beta = adjacent.length === 3 ? 3 / 16 : 3 / (8 * adjacent.length);
      return blend([
        [w, 1 - adjacent.length * beta],
        ...adjacent.map((j) => [weights[j], beta] as [Weight, number]),
      ]);
    });
    for (const edge of edges.values()) {
      edge.index = next.length;
      next.push(
        blend([
          [weights[edge.a], 3 / 8],
          [weights[edge.b], 3 / 8],
          [weights[edge.opposite[0]], 1 / 8],
          [weights[edge.opposite[1]], 1 / 8],
        ]),
      );
    }
    const midpoint = (a: number, b: number) =>
      edges.get(`${Math.min(a, b)}:${Math.max(a, b)}`)!.index;
    const newFaces: number[] = [];
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i],
        b = faces[i + 1],
        c = faces[i + 2],
        ab = midpoint(a, b),
        bc = midpoint(b, c),
        ca = midpoint(c, a);
      newFaces.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    weights = next;
    faces = newFaces;
  }
  return { faces, weights: weights.map((w) => Array.from(w)) };
}
const cache = new Map<Topology, ReturnType<typeof subdivision>>();

export class JellySurface extends BufferGeometry {
  private coordinates: Float32Array;
  private smooth: ReturnType<typeof subdivision>;
  constructor(body: SoftBody) {
    super();
    if (!cache.has(body.topology)) cache.set(body.topology, subdivision(body.topology, 2));
    this.smooth = cache.get(body.topology)!;
    this.coordinates = new Float32Array(this.smooth.weights.length * 3);
    this.setAttribute(
      'position',
      new BufferAttribute(this.coordinates, 3).setUsage(DynamicDrawUsage),
    );
    this.setIndex(this.smooth.faces);
  }
  update(body: SoftBody) {
    const smooth = this.smooth;
    for (let i = 0; i < smooth.weights.length; i++) {
      let x = 0,
        y = 0,
        z = 0;
      for (const [j, w] of smooth.weights[i]) {
        x += body.positions[j * 3] * w;
        y += body.positions[j * 3 + 1] * w;
        z += body.positions[j * 3 + 2] * w;
      }
      this.coordinates[i * 3] = x;
      this.coordinates[i * 3 + 1] = y;
      this.coordinates[i * 3 + 2] = z;
    }
    this.getAttribute('position').needsUpdate = true;
    this.computeVertexNormals();
    this.computeBoundingSphere();
    this.computeBoundingBox();
  }
}
