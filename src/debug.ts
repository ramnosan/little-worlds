import { Vector3 } from 'three';
import type { PhysicsWorld } from './physics/world';
import type { Studio } from './render/studio';

/** Read-only development diagnostics for repeatable interaction and resource tests. */
export function installDiagnostics(world: PhysicsWorld, studio: Studio) {
  const snapshot = () => {
    const rect = studio.renderer.domElement.getBoundingClientRect();
    return {
      grabbed: world.grab?.body.id ?? null,
      paused: world.paused,
      mallet: {
        active: world.mallet.active,
        position: [...world.mallet.position],
        visible: studio.mallet.visible,
      },
      memory: { ...studio.renderer.info.memory },
      camera: studio.camera.position.toArray(),
      bodies: world.bodies.map((b) => {
        const projected = new Vector3(...b.center).project(studio.camera);
        return {
          id: b.id,
          renderVertices: studio.views.get(b.id)?.mesh.geometry.getAttribute('position').count ?? 0,
          center: [...b.center],
          height: b.bounds[4] - b.bounds[1],
          volumeRatio: b.volume() / b.restVolume,
          finite: b.positions.every(Number.isFinite),
          minY: b.bounds[1],
          maxY: b.bounds[4],
          screen: {
            x: rect.left + ((projected.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - projected.y) * rect.height) / 2,
          },
        };
      }),
    };
  };
  Object.defineProperty(window, '__jellyDebug', { value: snapshot, configurable: true });
}

declare global {
  interface Window {
    __jellyDebug: () => {
      grabbed: number | null;
      paused: boolean;
      mallet: { active: boolean; position: number[]; visible: boolean };
      memory: { geometries: number; textures: number };
      camera: number[];
      bodies: {
        id: number;
        renderVertices: number;
        center: number[];
        height: number;
        volumeRatio: number;
        finite: boolean;
        minY: number;
        maxY: number;
        screen: { x: number; y: number };
      }[];
    };
  }
}
