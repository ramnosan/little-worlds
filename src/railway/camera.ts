import { MathUtils, Vector3 } from 'three';
import { CAR_SPACING, ROUTE_SECTIONS, WHEEL_RADIUS, trackPose, wrapDistance } from './physics';

export const TUNNEL_CAMERA_BACK = 2 * CAR_SPACING + 0.55;

/** Lower outside the portal; stay low until even the outdoor camera clears the exit. */
export function tunnelCameraBlend(distance: number) {
  let blend = 0;
  for (const section of ROUTE_SECTIONS) {
    if (section.kind !== 'tunnel') continue;
    const relative = wrapDistance(distance - section.start + 3.5) - 3.5;
    const length = section.end - section.start;
    blend = Math.max(
      blend,
      MathUtils.smoothstep(relative, -3.5, -1.8) *
        (1 - MathUtils.smoothstep(relative, length + 3.5, length + 5)),
    );
  }
  return blend;
}

/** Caller-owned vectors avoid allocating camera vectors on every frame. */
export function followCameraPose(distance: number, position: Vector3, target: Vector3) {
  const pose = trackPose(distance);
  const blend = tunnelCameraBlend(distance);
  const rear = trackPose(distance - 2 * CAR_SPACING);
  const inside = trackPose(distance - TUNNEL_CAMERA_BACK);
  position.set(
    MathUtils.lerp(pose.x - 3 * pose.tx, inside.x, blend),
    MathUtils.lerp(pose.y + WHEEL_RADIUS + 2 - 3 * pose.ty, inside.y + 0.36, blend),
    MathUtils.lerp(pose.z - 3 * pose.tz, inside.z, blend),
  );
  target.set(
    MathUtils.lerp(pose.x, rear.x, blend),
    MathUtils.lerp(pose.y + WHEEL_RADIUS + 0.2, rear.y + WHEEL_RADIUS + 0.16, blend),
    MathUtils.lerp(pose.z, rear.z, blend),
  );
  return blend;
}
