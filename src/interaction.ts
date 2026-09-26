import { Plane, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PhysicsWorld, type Vec3 } from './physics/world';
import { Studio } from './render/studio';

export class Interaction {
  readonly controls: OrbitControls;
  hovered: number | null = null;
  private malletMode = false;
  private pointer = new Vector2();
  private plane = new Plane();
  private point = new Vector3();
  private direction = new Vector3();
  private activePointer: number | null = null;
  private abort = new AbortController();
  constructor(
    private world: PhysicsWorld,
    private studio: Studio,
    private select: (id: number | null) => void,
    private onGrab: () => void,
    private onRelease: () => void,
  ) {
    const canvas = studio.renderer.domElement;
    // Capture phase gets first refusal on a jelly; background gestures reach OrbitControls.
    canvas.addEventListener('pointerdown', this.down, { capture: true, signal: this.abort.signal });
    canvas.addEventListener('pointermove', this.move, { capture: true, signal: this.abort.signal });
    canvas.addEventListener('pointerup', this.up, { signal: this.abort.signal });
    canvas.addEventListener('pointercancel', this.cancel, { signal: this.abort.signal });
    canvas.addEventListener('lostpointercapture', this.cancel, { signal: this.abort.signal });
    canvas.addEventListener(
      'pointerleave',
      () => {
        this.hovered = null;
      },
      { signal: this.abort.signal },
    );
    window.addEventListener('blur', this.cancel, { signal: this.abort.signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.cancel();
      },
      { signal: this.abort.signal },
    );
    this.controls = new OrbitControls(studio.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 30;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.target.set(0, 0.15, 0);
    this.controls.mouseButtons.RIGHT = this.controls.mouseButtons.LEFT;
    this.controls.update();
  }
  private ray(event: PointerEvent) {
    const rect = this.studio.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.studio.raycaster.setFromCamera(this.pointer, this.studio.camera);
  }
  private hit() {
    return this.studio.raycaster.intersectObjects(
      [...this.studio.views.values()].map((v) => v.mesh),
      false,
    )[0];
  }
  private aimMallet() {
    this.plane.set(new Vector3(0, 1, 0), -1);
    if (!this.studio.raycaster.ray.intersectPlane(this.plane, this.point)) return;
    this.direction.setFromMatrixColumn(this.studio.camera.matrixWorld, 0);
    this.world.mallet.aim(this.point.toArray() as Vec3, this.direction.toArray() as Vec3);
  }
  private down = (event: PointerEvent) => {
    if (event.button !== 0 || this.activePointer !== null) return;
    this.ray(event);
    if (this.malletMode) {
      event.stopImmediatePropagation();
      event.preventDefault();
      this.aimMallet();
      if (!this.world.paused) {
        this.world.mallet.swing();
        this.onGrab();
      }
      return;
    }
    const hit = this.hit();
    if (!hit) {
      this.select(null);
      return;
    }
    const id = hit.object.userData.bodyId as number;
    this.select(id);
    this.studio.renderer.domElement.dataset.pointerFocus = 'true';
    this.studio.renderer.domElement.focus({ preventScroll: true });
    if (this.world.paused) return;
    const body = this.studio.views.get(id)!.body;
    event.stopImmediatePropagation();
    event.preventDefault();
    this.activePointer = event.pointerId;
    this.controls.enabled = false;
    this.studio.renderer.domElement.setPointerCapture(event.pointerId);
    this.studio.camera.getWorldDirection(this.direction);
    this.plane.setFromNormalAndCoplanarPoint(this.direction, hit.point);
    this.world.beginGrab(body, hit.point.toArray() as Vec3);
    this.studio.grabMarker.position.copy(hit.point);
    this.studio.grabMarker.visible = true;
    this.studio.renderer.domElement.style.cursor = 'grabbing';
    this.onGrab();
  };
  private move = (event: PointerEvent) => {
    this.ray(event);
    if (this.malletMode && event.buttons !== 2) {
      this.aimMallet();
      this.studio.renderer.domElement.style.cursor = 'crosshair';
      return;
    }
    if (this.activePointer !== null) {
      if (event.pointerId !== this.activePointer) return;
      event.stopImmediatePropagation();
      if (this.studio.raycaster.ray.intersectPlane(this.plane, this.point)) {
        this.world.moveGrab(this.point.toArray() as Vec3);
        if (this.world.grab) this.studio.grabMarker.position.fromArray(this.world.grab.target);
      }
      return;
    }
    const hit = this.hit();
    this.hovered = hit ? (hit.object.userData.bodyId as number) : null;
    this.studio.renderer.domElement.style.cursor = this.malletMode
      ? 'crosshair'
      : this.hovered !== null
        ? 'grab'
        : 'default';
  };
  private up = (event: PointerEvent) => {
    if (event.pointerId === this.activePointer) {
      this.onRelease();
      this.cancel();
    }
  };
  cancel = () => {
    const pointer = this.activePointer;
    this.activePointer = null;
    this.world.endGrab();
    this.world.mallet.end();
    this.controls.enabled = true;
    this.studio.grabMarker.visible = false;
    const canvas = this.studio.renderer.domElement;
    if (pointer !== null && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
    canvas.style.cursor = 'default';
  };
  setMalletMode(enabled: boolean) {
    if (enabled === this.malletMode) return;
    this.cancel();
    this.malletMode = enabled;
    this.world.mallet.enabled = enabled;
    this.studio.mallet.visible = enabled;
  }
  resetCamera() {
    this.controls.target.set(0, 0.15, 0);
    this.studio.camera.position.set(8.2, 10, 14);
    this.controls.update();
  }
  focus(id: number) {
    const view = this.studio.views.get(id);
    if (!view) return;
    this.cancel();
    const b = view.body.bounds;
    this.controls.target.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    const span = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    const distance = Math.max(5, span * 1.85);
    this.studio.camera.position
      .copy(this.controls.target)
      .add(new Vector3(0.22, 0.14, 1).normalize().multiplyScalar(distance));
    this.controls.update();
  }
  dispose() {
    this.cancel();
    this.abort.abort();
    this.controls.dispose();
  }
}
