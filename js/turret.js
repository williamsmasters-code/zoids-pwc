// Turreted weapons. Pure math, no three.js, shared by the mission and tests.
//
// A turret weapon swings on its own yaw (relative to the chassis nose) inside
// a traverse arc at a limited speed. It only ever tracks the Zoid's LOCKED
// target: the player's Tab / R lock, or an AI pilot's own target. With no
// lock it swings back to its rest angle and holds fire. There is no
// nearest-enemy fallback.

import { wrapAngle, yawToFace } from "./frame.js";

// How close (radians) the barrel must be to the bearing before it fires.
export const TURRET_FIRE_TOLERANCE = 0.09;

// Effective turret spec for a mounted weapon, or null if it is fixed.
// The weapon's own `turret` wins, then the hardpoint's. Charge weapons
// (the charged particle cannon) need the whole body braced and never turret.
// Turrets only exist on the back mount.
export function turretSpecFor(def, weapon) {
  if (!weapon || weapon.mount !== "backMount") return null;
  if (weapon.chargeTime || weapon.delivery === "charge" || weapon.kind === "melee") return null;
  const hard = def && def.hardpoints ? def.hardpoints.find((h) => h.id === weapon.mount) : null;
  const spec = weapon.turret || (hard && hard.turret) || null;
  if (!spec) return null;
  return {
    arc: Math.min(Math.PI * 2, Math.max(0, spec.arc)),
    speed: Math.max(0.01, spec.speed),
    rest: spec.rest || 0,
  };
}

// Bearing of a world point relative to the chassis nose, in (-PI, PI].
// Same yaw convention as the chassis: 0 = straight ahead (-Z), +PI/2 = left.
export function relativeBearing(chassisYaw, fromX, fromZ, toX, toZ) {
  return wrapAngle(yawToFace(toX - fromX, toZ - fromZ) - chassisYaw);
}

function clampToArc(angle, arc) {
  if (arc >= Math.PI * 2 - 1e-6) return wrapAngle(angle);
  const half = arc / 2;
  return Math.max(-half, Math.min(half, wrapAngle(angle)));
}

// One tick. `state` holds { yaw } (relative to the chassis) and is mutated.
// `bearing` is the locked target's relative bearing, or null for no lock.
// Returns { yaw, onTarget, inArc }.
export function stepTurret(state, spec, bearing, dt) {
  if (state.yaw == null) state.yaw = spec.rest;
  const full = spec.arc >= Math.PI * 2 - 1e-6;
  const goal = bearing == null ? spec.rest : clampToArc(bearing, spec.arc);
  let diff;
  if (full) {
    diff = wrapAngle(goal - state.yaw);
  } else {
    // A limited arc cannot swing through the back; move linearly inside it.
    diff = goal - state.yaw;
  }
  const max = spec.speed * dt;
  state.yaw = Math.abs(diff) <= max ? goal : state.yaw + Math.sign(diff) * max;
  if (full) state.yaw = wrapAngle(state.yaw);
  const inArc = bearing != null && (full || Math.abs(wrapAngle(bearing)) <= spec.arc / 2 + 1e-6);
  const onTarget = inArc && Math.abs(wrapAngle(bearing - state.yaw)) <= TURRET_FIRE_TOLERANCE;
  return { yaw: state.yaw, onTarget, inArc };
}

// Turret trigger. Fires only with a live lock, inside range and arc, on target.
export function turretTrigger(lock, result, range) {
  if (!lock || !lock.alive) return false;
  if (!(lock.dist <= range)) return false;
  return !!(result && result.onTarget);
}
