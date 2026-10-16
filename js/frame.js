// Spatial frame for the whole game.
//
// Three.js is Y-up and right-handed. An Object3D's local forward is -Z.
// rotation.y > 0 turns counter-clockwise seen from above.
//
// Canonical check (yaw 0):
//   forward = (0, 0, -1)
//   right   = forward × up = (1, 0, 0)
//
// yawToFace is the only conversion from a world XZ direction into a yaw,
// and it only writes Object3D.rotation.y. Movement never rebuilds a direction
// with sin/cos. It reads the object's matrix.
//
// Object3D.getWorldDirection is the local +Z axis. Camera.getWorldDirection
// negates that, because a camera looks down -Z. Zoids are not cameras: their
// nose is local -Z, so facing is the negation of getWorldDirection.
//
// Mech controls use two intentional frames:
//   chassis yaw  - legs, throttle, strafe
//   look yaw     - camera and weapon aim
// The chassis turns toward the look yaw at a limited rate. WASD is chassis
// relative, not camera relative.

export function wrapAngle(a) {
  const two = Math.PI * 2;
  let x = (a + Math.PI) % two;
  if (x < 0) x += two;
  return x - Math.PI;
}

// Local -Z after a yaw rotation: x = -sin(yaw), z = -cos(yaw).
// Used to predict the nose direction in tests. The sim itself does not call this.
export function forwardFromYaw(yaw) {
  return { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

// right = forward × up = (-fwd.z, 0, fwd.x)
export function rightFromForward(fwd) {
  return { x: -fwd.z, y: 0, z: fwd.x };
}

// Yaw that points local -Z at a world direction (dx, dz).
export function yawToFace(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export function stepYaw(current, target, maxStep) {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

export function headingFromYaw(yaw) {
  // yaw 0 faces -Z, which the compass calls north (0). Positive yaw is CCW,
  // so the compass heading (clockwise from north) is the negation.
  let deg = -yaw * (180 / Math.PI);
  deg = ((deg % 360) + 360) % 360;
  return Math.round(deg);
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function approach(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
