import { MOUSE, TOUCH, Plane, Vector3 } from 'three';
import type { BubbleWorld, V3 } from './physics';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BubbleRenderer } from './render';

/** Keep orbit gestures separate from taps, including two-finger touch and cancellation. */
export class BubbleInteraction {
  readonly controls: OrbitControls;
  private dartMode = false;
  private abort = new AbortController();
  private grab: {
    pointerId: number;
    id: number;
    plane: Plane;
    offset: Vector3;
    active: boolean;
  } | null = null;
  private pointers = new Map<number, { x: number; y: number; dragged: boolean; tap: boolean }>();

  constructor(
    private view: BubbleRenderer,
    private pop: (id: number) => void,
    private throwDart: (x: number, y: number) => void,
    private world: BubbleWorld,
  ) {
    const canvas = view.renderer.domElement;
    const signal = this.abort.signal;
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch' && e.button !== 0 && e.button !== 2) return;
        if (this.grab) this.cancel();
        if (
          e.pointerType === 'mouse' &&
          e.button === 0 &&
          !this.dartMode &&
          !world.paused &&
          !this.pointers.size
        ) {
          const id = view.pick(e.clientX, e.clientY);
          const bubble = world.bubbles.find((b) => b.id === id);
          if (bubble) {
            const center = new Vector3().fromArray(bubble.position);
            const plane = new Plane().setFromNormalAndCoplanarPoint(
              view.camera.getWorldDirection(new Vector3()),
              center,
            );
            const point = view.pointerOnPlane(e.clientX, e.clientY, plane);
            if (point)
              this.grab = {
                pointerId: e.pointerId,
                id: bubble.id,
                plane,
                offset: center.sub(point),
                active: false,
              };
          }
        }
        this.pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          dragged: false,
          tap: e.button === 0,
        });
        if (this.pointers.size > 1) for (const p of this.pointers.values()) p.dragged = true;
      },
      { signal, capture: true },
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        const p = this.pointers.get(e.pointerId);
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6) p.dragged = true;
        const grab = this.grab;
        if (grab?.pointerId === e.pointerId && p?.dragged) {
          const point = view.pointerOnPlane(e.clientX, e.clientY, grab.plane)?.add(grab.offset);
          if (point) {
            const target = point.toArray() as V3;
            if (!grab.active) {
              if (!world.beginDrag(grab.id, target)) {
                this.cancel();
                return;
              }
              grab.active = true;
              this.controls.enableDamping = false;
              this.controls.update();
              this.controls.enableDamping = true;
              this.controls.enabled = false;
              canvas.setPointerCapture(e.pointerId);
            }
            world.updateDrag(target);
          }
        }
        if (e.pointerType === 'mouse')
          canvas.style.cursor = this.grab?.active
            ? 'grabbing'
            : this.dartMode
              ? 'crosshair'
              : !world.paused && view.pick(e.clientX, e.clientY) !== undefined
                ? 'grab'
                : '';
      },
      { signal, capture: true },
    );
    canvas.addEventListener(
      'pointerup',
      (e) => {
        const p = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        if (this.grab?.pointerId === e.pointerId) this.releaseGrab();
        if (!p || p.dragged || !p.tap) return;
        if (this.dartMode) {
          this.throwDart(e.clientX, e.clientY);
          return;
        }
        const id = view.pick(e.clientX, e.clientY);
        if (id !== undefined) this.pop(id);
      },
      { signal, capture: true },
    );
    canvas.addEventListener(
      'pointercancel',
      (e) => {
        this.pointers.delete(e.pointerId);
        if (this.grab?.pointerId === e.pointerId) this.releaseGrab();
      },
      {
        signal,
        capture: true,
      },
    );
    canvas.addEventListener(
      'lostpointercapture',
      (e) => {
        if (this.pointers.has(e.pointerId)) this.cancel();
      },
      { signal },
    );
    window.addEventListener('blur', () => this.cancel(), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.cancel();
      },
      { signal },
    );

    this.controls = new OrbitControls(view.camera, canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.rotateSpeed = 0.65;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 25;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI - 0.15;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };
    this.controls.update();
    this.controls.saveState();
  }
  update() {
    if (this.grab?.active && (!this.world.dragState || this.world.paused)) this.cancel();
    if (this.controls.enabled) this.controls.update();
  }
  private releaseGrab() {
    const grab = this.grab;
    this.grab = null;
    this.world.endDrag();
    this.controls.enabled = true;
    const canvas = this.view.renderer.domElement;
    if (grab && canvas.hasPointerCapture(grab.pointerId))
      canvas.releasePointerCapture(grab.pointerId);
    canvas.style.cursor = this.dartMode ? 'crosshair' : '';
  }
  setDartMode(enabled: boolean) {
    this.cancel();
    this.dartMode = enabled;
    this.view.renderer.domElement.style.cursor = enabled ? 'crosshair' : '';
  }
  cancel() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.releaseGrab();
    for (const pointerId of ids)
      this.view.renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
    // Drain any pending orbit damping so a cancelled drag cannot resume later.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
  }
  reset() {
    this.cancel();
    this.controls.reset();
  }
  dispose() {
    this.cancel();
    this.abort.abort();
    this.controls.dispose();
  }
}
