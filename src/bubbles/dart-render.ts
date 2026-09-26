import * as THREE from 'three';
import type { Dart } from './darts';

/** One shared dart model keeps repeated throws and resets cheap. Local +Y is the tip. */
export class DartRenderer {
  private model = new THREE.Group();
  private views = new Map<number, THREE.Group>();
  private held: THREE.Group;
  private up = new THREE.Vector3(0, 1, 0);
  private direction = new THREE.Vector3();
  private trailGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.72, 0),
    new THREE.Vector3(0, -1.9, 0),
  ]);
  private trailMaterial = new THREE.LineBasicMaterial({
    color: 0xffe0a0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const metal = new THREE.MeshStandardMaterial({
      color: 0xdbe7e6,
      metalness: 0.75,
      roughness: 0.24,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xe1ae5e,
      metalness: 0.65,
      roughness: 0.3,
    });
    const feather = new THREE.MeshStandardMaterial({
      color: 0xe4f1cf,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2, 12), metal);
    tip.position.y = -0.1;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.029, 0.25, 12), brass);
    barrel.position.y = -0.325;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.27, 10), metal);
    shaft.position.y = -0.58;
    const finGeometry = new THREE.BufferGeometry();
    finGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, -0.46, 0, 0.14, -0.65, 0, 0, -0.76, 0], 3),
    );
    finGeometry.computeVertexNormals();
    this.model.add(tip, barrel, shaft);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(finGeometry, feather);
      fin.rotation.y = (i * Math.PI) / 2;
      this.model.add(fin);
    }
    this.held = this.model.clone();
    this.held.scale.setScalar(0.45);
    this.held.visible = false;
    scene.add(this.held);
  }
  sync(darts: Dart[], equipped: boolean) {
    this.held.visible = equipped;
    const handX = Math.min(
      0.32,
      Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect * 1.6 * 0.58,
    );
    this.held.position
      .set(handX, -0.2, -1.6)
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);
    this.direction.set(-0.12, 0.28, -1).normalize().applyQuaternion(this.camera.quaternion);
    this.held.quaternion.setFromUnitVectors(this.up, this.direction);
    for (const [id, group] of this.views)
      if (!darts.some((d) => d.id === id)) {
        this.scene.remove(group);
        this.views.delete(id);
      }
    for (const dart of darts) {
      let group = this.views.get(dart.id);
      if (!group) {
        group = this.model.clone();
        group.scale.setScalar(0.65);
        group.add(new THREE.Line(this.trailGeometry, this.trailMaterial));
        this.views.set(dart.id, group);
        this.scene.add(group);
      }
      group.position.fromArray(dart.position);
      group.quaternion.setFromUnitVectors(
        this.up,
        this.direction.fromArray(dart.velocity).normalize(),
      );
    }
  }
  clear() {
    for (const group of this.views.values()) this.scene.remove(group);
    this.views.clear();
    this.held.visible = false;
  }
  dispose() {
    this.clear();
    this.scene.remove(this.held);
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        materials.add(o.material);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
  }
}
