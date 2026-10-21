// Pure aim math. The screen-center ray is the camera's forward ray.
// Each weapon then aims from its own mount through that world point.

export const AIM_FAR = 1000;

export function normalize3(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: -1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function screenCenterRay(cameraPosition, cameraForward) {
  return {
    origin: { x: cameraPosition.x, y: cameraPosition.y, z: cameraPosition.z },
    direction: normalize3(cameraForward),
  };
}

// Hit point wins. Otherwise a point `far` meters along the ray.
export function aimPointAlongRay(origin, direction, hitPoint, far = AIM_FAR) {
  if (hitPoint) return { x: hitPoint.x, y: hitPoint.y, z: hitPoint.z };
  const dir = normalize3(direction);
  const distance = far > 0 ? far : AIM_FAR;
  return {
    x: origin.x + dir.x * distance,
    y: origin.y + dir.y * distance,
    z: origin.z + dir.z * distance,
  };
}

export function directionToPoint(from, to) {
  return normalize3({
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  });
}

// The ray `from + t * dir` passes through `point` for some t > 0.
export function rayPassesThrough(from, dir, point, epsilon = 1e-4) {
  const to = { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z };
  const len = Math.hypot(to.x, to.y, to.z);
  if (len < 1e-8) return true;
  const n = { x: to.x / len, y: to.y / len, z: to.z / len };
  const d = normalize3(dir);
  return n.x * d.x + n.y * d.y + n.z * d.z > 1 - epsilon;
}

// Hits are nearest-first. Skip the player's own Zoid. Keep targets, terrain, and obstacles.
export function selectAimHit(hits, ignoreOwnerId) {
  for (const hit of hits || []) {
    if (!hit) continue;
    if (ignoreOwnerId && hit.ownerId === ignoreOwnerId) continue;
    if (hit.ground || hit.block || hit.partId) return hit;
  }
  return null;
}

// AI barrel clamp: the horizontal swing is limited to maxYaw around the
// chassis forward; elevation is kept (up to maxPitch) so ground Zoids can
// shoot up at flyers and flyers can shoot down. Plain {x,y,z} in and out.
export function clampAimYawPitch(forward, dir, maxYaw, maxPitch = 1.3) {
  const d = normalize3(dir);
  const horiz = Math.hypot(d.x, d.z);
  const pitch = Math.max(-maxPitch, Math.min(maxPitch, Math.atan2(d.y, horiz)));
  const fYaw = Math.atan2(-forward.x, -forward.z);
  let dYaw = horiz > 1e-6 ? Math.atan2(-d.x, -d.z) : fYaw;
  let rel = dYaw - fYaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  rel = Math.max(-maxYaw, Math.min(maxYaw, rel));
  const yaw = fYaw + rel;
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
