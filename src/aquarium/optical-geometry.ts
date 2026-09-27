import * as T from 'three';
import {
  MeshBVH,
  MeshBVHUniformStruct,
  StaticGeometryGenerator,
  FloatVertexAttributeTexture,
} from 'three-mesh-bvh';

/** CPU pose baking uses the same mixers as raster rendering, including test skins. */
export class OpticalGeometry {
  readonly bvh = new MeshBVHUniformStruct();
  readonly normals = new FloatVertexAttributeTexture();
  readonly uvs = new FloatVertexAttributeTexture();
  readonly colors = Array.from({ length: 8 }, () => new T.Vector4(1, 1, 1, 1));
  readonly properties = Array.from({ length: 8 }, () => new T.Vector4(0.6, 0, 0.08, 0));
  readonly normalScales = Array.from({ length: 8 }, () => new T.Vector2(1, 1));
  maps = new T.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
  count = 0;
  revision = 0;
  private signature = '';
  private generator?: StaticGeometryGenerator;
  private geometry?: T.BufferGeometry;
  private tree?: MeshBVH;
  private morphWeights = new WeakMap<T.Mesh, Float32Array>();
  constructor() {
    this.maps.needsUpdate = true;
    // Valid integer BVH samplers are required even when the no-fish branch executes.
    const dummy = new T.BufferGeometry();
    dummy.setAttribute(
      'position',
      new T.Float32BufferAttribute([100, 100, 100, 101, 100, 100, 100, 101, 100], 3),
    );
    dummy.setAttribute('normal', new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    this.bvh.updateFrom(new MeshBVH(dummy));
    this.normals.updateFrom(dummy.getAttribute('normal') as T.BufferAttribute);
    this.uvs.updateFrom(new T.Float32BufferAttribute(new Float32Array(9), 3));
    dummy.dispose();
  }
  update(group: T.Group) {
    group.updateWorldMatrix(true, true);
    const meshes: T.Mesh[] = [];
    group.traverseVisible((o) => {
      if ((o as T.Mesh).isMesh) meshes.push(o as T.Mesh);
    });
    for (const mesh of meshes)
      if (mesh.morphTargetInfluences) {
        const weights = mesh.morphTargetInfluences;
        let previous = this.morphWeights.get(mesh);
        if (!previous || previous.length !== weights.length) {
          previous = new Float32Array(weights.length).fill(NaN);
          this.morphWeights.set(mesh, previous);
        }
        let changed = false;
        for (let i = 0; i < weights.length; i++)
          if (Math.abs(previous[i] - weights[i]) > 1e-7 || Number.isNaN(previous[i])) {
            previous[i] = weights[i];
            changed = true;
          }
        // StaticGeometryGenerator watches geometry versions, not morph influences.
        if (changed) mesh.geometry.getAttribute('position').needsUpdate = true;
      }
    const signature = meshes.map((m) => m.uuid).join(',');
    if (signature !== this.signature) {
      this.signature = signature;
      this.geometry?.dispose();
      this.generator = undefined;
      this.tree = undefined;
      this.count = 0;
      this.revision++;
      if (meshes.length) {
        for (const mesh of meshes) {
          if (!mesh.geometry.getAttribute('uv'))
            mesh.geometry.setAttribute(
              'uv',
              new T.Float32BufferAttribute(
                new Float32Array(mesh.geometry.getAttribute('position').count * 2),
                2,
              ),
            );
          if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
          if ((mesh as T.SkinnedMesh).isSkinnedMesh) (mesh as T.SkinnedMesh).skeleton.update();
        }
        this.generator = new StaticGeometryGenerator(meshes);
        this.generator.attributes = ['position', 'normal', 'uv'];
        this.geometry = this.generator.generate();
        const materials = this.generator.getMaterials() as T.MeshStandardMaterial[];
        if (materials.length > 8)
          throw new Error('Aquarium optical materials exceed the eight-material budget');
        const uv = this.geometry.getAttribute('uv');
        const packed = new Float32Array(uv.count * 3);
        for (let i = 0; i < uv.count; i++) {
          packed[i * 3] = uv.getX(i);
          packed[i * 3 + 1] = uv.getY(i);
        }
        for (const g of this.geometry.groups)
          for (let i = g.start; i < g.start + g.count; i++) {
            const vertex = this.geometry.index ? this.geometry.index.getX(i) : i;
            packed[vertex * 3 + 2] = g.materialIndex ?? 0;
          }
        this.uvs.updateFrom(new T.BufferAttribute(packed, 3));
        this.geometry.clearGroups(); // one BVH root; material identity lives per vertex
        this.tree = new MeshBVH(this.geometry, { targetLeafSize: 6 });
        this.installMaps(materials);
      }
    }
    if (!this.generator || !this.geometry || !this.tree) return;
    for (const mesh of meshes)
      if ((mesh as T.SkinnedMesh).isSkinnedMesh) (mesh as T.SkinnedMesh).skeleton.update();
    this.generator.generate(this.geometry);
    this.geometry.clearGroups();
    this.tree.refit();
    this.bvh.updateFrom(this.tree);
    this.normals.updateFrom(this.geometry.getAttribute('normal') as T.BufferAttribute);
    this.count = meshes.length;
  }
  private installMaps(materials: T.MeshStandardMaterial[]) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const pixels = new Uint8Array(size * size * 4 * materials.length * 2);
    materials.forEach((m, i) => {
      ctx.fillStyle = '#fff';
      if (m.map?.image) {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(m.map.image as CanvasImageSource, 0, 0, size, size);
      } else ctx.fillRect(0, 0, size, size);
      pixels.set(ctx.getImageData(0, 0, size, size).data, i * 2 * size * size * 4);
      ctx.fillStyle = '#8080ff';
      ctx.fillRect(0, 0, size, size);
      if (m.normalMap?.image)
        ctx.drawImage(m.normalMap.image as CanvasImageSource, 0, 0, size, size);
      pixels.set(ctx.getImageData(0, 0, size, size).data, (i * 2 + 1) * size * size * 4);
      this.colors[i].set(m.color.r, m.color.g, m.color.b, m.opacity);
      this.properties[i].set(m.roughness, m.metalness, m.alphaTest || 0.08, m.map?.flipY ? 1 : 0);
      this.normalScales[i].copy(m.normalScale);
    });
    this.maps.dispose();
    this.maps = new T.DataArrayTexture(pixels, size, size, materials.length * 2);
    this.maps.magFilter = this.maps.minFilter = T.LinearFilter;
    // Color layers decode sRGB in GLSL; normal layers must stay linear.
    this.maps.colorSpace = T.NoColorSpace;
    this.maps.needsUpdate = true;
  }
  dispose() {
    this.geometry?.dispose();
    this.bvh.dispose();
    this.normals.dispose();
    this.uvs.dispose();
    this.maps.dispose();
  }
}
