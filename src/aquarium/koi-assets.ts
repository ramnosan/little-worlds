import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { KoiSchool, KoiVariety } from './koi-school';
import { KOI_SCALE } from './koi-school';

export type KoiAssetStatus = 'loading' | 'ready' | 'unavailable' | 'error';
export interface KoiAssetEntry {
  variety: KoiVariety;
  high: string;
  low: string;
  swimClip: string;
  deformation?: 'skeletal' | 'morph';
  textureSize?: 1024 | 4096;
}
export interface KoiManifest {
  version: 1;
  assets: KoiAssetEntry[];
}
type KoiInstance = {
  root: T.Object3D;
  mixer: T.AnimationMixer;
  clip: T.AnimationClip;
  variety: KoiVariety;
};
const VARIETIES: KoiVariety[] = ['showa', 'tancho', 'ochiba', 'koi-1', 'koi-2', 'koi-3'];
export function parseKoiManifest(value: unknown): KoiManifest {
  const m = value as KoiManifest;
  if (!m || m.version !== 1 || !Array.isArray(m.assets)) throw new Error('Invalid koi manifest');
  if (m.assets.length === 0) return m;
  if (m.assets.length !== 2 || new Set(m.assets.map((a) => a.variety)).size !== 2)
    throw new Error('Expected two koi varieties');
  for (const a of m.assets) {
    if (!VARIETIES.includes(a.variety) || typeof a.swimClip !== 'string' || !a.swimClip)
      throw new Error('Invalid koi entry');
    if (a.deformation !== undefined && !['skeletal', 'morph'].includes(a.deformation))
      throw new Error('Invalid koi deformation type');
    if (a.textureSize !== undefined && ![1024, 4096].includes(a.textureSize))
      throw new Error('Invalid koi texture size');
    for (const path of [a.high, a.low])
      if (
        typeof path !== 'string' ||
        !/^\.\/[a-z0-9_./-]+\.glb$/i.test(path) ||
        path.includes('..')
      )
        throw new Error('Koi assets must be local GLB files');
  }
  return m;
}

/** Release shared GLTF resources exactly once, including decoded image bitmaps. */
export function disposeKoiObjects(objects: readonly T.Object3D[]) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>(),
    skeletons = new Set<T.Skeleton>();
  for (const root of objects)
    root.traverse((o) => {
      const mesh = o as T.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          materials.add(m);
      if ((o as T.SkinnedMesh).isSkinnedMesh) skeletons.add((o as T.SkinnedMesh).skeleton);
    });
  for (const m of materials) {
    for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    m.dispose();
  }
  const images = new Set<unknown>();
  for (const texture of textures) {
    images.add(texture.source.data);
    texture.dispose();
  }
  for (const data of images)
    if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close();
  geometries.forEach((g) => g.dispose());
  skeletons.forEach((s) => s.dispose());
}

export class KoiVisuals {
  readonly group = new T.Group();
  status: KoiAssetStatus = 'loading';
  private loadError: string | null = null;
  activeQuality: 'high' | 'low' | null = null;
  onStatus: () => void = () => {};
  private instances: KoiInstance[] = [];
  private sources: T.Object3D[] = [];
  private request: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private manifestUrl = new URL(
    `${import.meta.env.BASE_URL}models/koi/manifest.json`,
    location.href,
  ).href;
  constructor(
    private readonly school: KoiSchool,
    private readonly prepareMaterial: (m: T.MeshStandardMaterial) => void,
  ) {}
  async load(low = false) {
    if (this.disposed) return;
    const quality = low ? 'low' : 'high';
    this.loadError = null;
    this.request?.abort();
    const generation = ++this.generation;
    if (this.activeQuality === quality) {
      this.status = 'ready';
      this.onStatus();
      return;
    }
    const controller = new AbortController();
    this.request = controller;
    this.status = 'loading';
    this.onStatus();
    const loaded: GLTF[] = [];
    const cache = new Map<string, GLTF>();
    try {
      const response = await fetch(this.manifestUrl, {
        signal: controller.signal,
        cache: 'no-cache',
      });
      if (!response.ok) throw new Error('Koi manifest unavailable');
      const manifest = parseKoiManifest(await response.json());
      if (generation !== this.generation) return;
      if (!manifest.assets.length) {
        this.status = 'unavailable';
        this.onStatus();
        return;
      }
      // Sequential parsing bounds peak decoding memory and simplifies cancellation cleanup.
      const loader = new GLTFLoader();
      for (const entry of manifest.assets) {
        const url = new URL(entry[quality], this.manifestUrl);
        let gltf = cache.get(url.href);
        if (!gltf) {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error(`Koi ${entry.variety} unavailable`);
          gltf = await loader.parseAsync(await response.arrayBuffer(), new URL('.', url).href);
          cache.set(url.href, gltf);
        }
        loaded.push(gltf);
        if (generation !== this.generation || this.disposed) {
          disposeKoiObjects(loaded.map((g) => g.scene));
          return;
        }
        let skinned = false,
          morph = false;
        gltf.scene.traverse((o) => {
          if ((o as T.SkinnedMesh).isSkinnedMesh) skinned = true;
          if ((o as T.Mesh).morphTargetInfluences?.length) morph = true;
        });
        const clip = gltf.animations.find((a) => a.name === entry.swimClip && a.duration > 0);
        if (
          !(entry.deformation === 'morph' ? morph : skinned) ||
          !clip ||
          (entry.deformation === 'morph' &&
            !clip.tracks.some((t) => t.name.includes('morphTargetInfluences')))
        )
          throw new Error('Koi must include the declared deformation and swim clip');
      }
      const instances: KoiInstance[] = loaded.map((gltf, i) => {
        const entry = manifest.assets[i],
          model = clone(gltf.scene),
          root = new T.Group(),
          mixer = new T.AnimationMixer(model);
        root.add(model);
        root.scale.setScalar(KOI_SCALE);
        const clip = gltf.animations.find((a) => a.name === entry.swimClip)!;
        root.traverse((o) => {
          const mesh = o as T.Mesh;
          if ((o as T.SkinnedMesh).isSkinnedMesh || mesh.morphTargetInfluences?.length)
            mesh.frustumCulled = false;
          if (mesh.material)
            for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              if ((m as T.MeshStandardMaterial).isMeshStandardMaterial)
                this.prepareMaterial(m as T.MeshStandardMaterial);
            }
        });
        mixer.clipAction(clip).play();
        return { root, mixer, clip, variety: entry.variety };
      });
      const wasReady = this.instances.length > 0;
      this.release();
      this.sources = loaded.map((g) => g.scene);
      this.instances = instances;
      this.group.add(...instances.map((i) => i.root));
      this.activeQuality = quality;
      if (!wasReady) this.school.reset();
      this.school.setVarieties(manifest.assets.map((a) => a.variety));
      this.school.enabled = true;
      this.status = 'ready';
      this.sync();
      this.onStatus();
    } catch (error) {
      disposeKoiObjects(loaded.map((g) => g.scene));
      if (generation !== this.generation || this.disposed) return;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.loadError = error instanceof Error ? error.message : String(error);
      this.status = 'error';
      this.onStatus();
    }
  }
  sync() {
    for (const i of this.instances) {
      const f = this.school.fish.find((f) => f.variety === i.variety)!;
      i.root.position.set(f.x, f.y, f.z);
      // Export contract: +Z forward, +Y up, metre units, centered at the body.
      i.root.rotation.set(-f.pitch, f.heading, -f.turnRate * f.speed * 0.3, 'YXZ');
      i.mixer.setTime(f.animationTime * i.clip.duration);
    }
  }
  snapshot() {
    return {
      status: this.status,
      error: this.loadError,
      count: this.instances.length,
      quality: this.activeQuality,
      animationTimes: this.instances.map((i) => i.mixer.time),
      morphs: this.instances.map((i) => {
        const meshes: { targets: number; active: number[] }[] = [];
        i.root.traverse((o) => {
          const weights = (o as T.Mesh).morphTargetInfluences;
          if (weights?.length) meshes.push({ targets: weights.length, active: [...weights] });
        });
        return meshes;
      }),
      skeletons: this.instances.map((i) => {
        let n = 0;
        i.root.traverse((o) => {
          if ((o as T.SkinnedMesh).isSkinnedMesh) n++;
        });
        return n;
      }),
    };
  }
  private release() {
    for (const i of this.instances) {
      i.mixer.stopAllAction();
      i.mixer.uncacheRoot(i.mixer.getRoot());
      this.group.remove(i.root);
    }
    disposeKoiObjects([...this.sources, ...this.instances.map((i) => i.root)]);
    this.sources = [];
    this.instances = [];
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    this.request?.abort();
    this.release();
    this.school.enabled = false;
  }
}
