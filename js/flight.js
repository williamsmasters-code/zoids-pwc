// Generic "flyer" movement mode. Pure maths, no three.js, so it is unit
// tested in node (tests/flight.test.mjs). Any Zoid whose catalog entry has a
// `flight` block flies with it (Pteras now; Raynos / Storm Sworder later).
//
// Rules (docs/NEW_ZOIDS_NOTES.txt, "Real flight"):
// - The flyer's physics position has a true altitude (root.position.y).
// - Minimum-airspeed rule, no hover: below stallSpeed while airborne it
//   stalls, cannot climb and sinks at stallSink m/s until it lands or speeds
//   up again. On the ground it walks; it lifts off once airspeed reaches
//   takeoffSpeed and the pilot climbs.
// - Climb / descend at climbRate m/s (input -1..1). No input holds altitude.
// - Ceiling: at most `ceiling` m above the terrain under it.
// - Floor: terrain or the top of any obstacle under it (it flies over rocks
//   and buildings that block ground Zoids). Touching the floor while slower
//   than stallSpeed lands it; faster it skims.
// - Pitch follows the climb (atan of vertical over airspeed); bank follows
//   the turn rate. Both are visual (model.visual), the physics stays upright.
// - Crash: losing the core or both wings / both legs drops it (falling).

export const FLIGHT_DEFAULTS = {
  ceiling: 70,
  stallSpeed: 9,
  takeoffSpeed: 9,
  climbRate: 10,
  stallSink: 7,
  fallAccel: 18,
  bankMax: 0.65,
  pitchMax: 0.5,
  meleeHeight: 4,
};

export function flightSpec(def) {
  if (!def || !def.flight) return null;
  return { ...FLIGHT_DEFAULTS, ...def.flight };
}

export function createFlight(y = 0) {
  return { y, vy: 0, airborne: false, stalled: false, falling: false, crashed: false, bank: 0, pitch: 0, agl: 0 };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

// ctrl: { climb: -1..1, airspeed: m/s forward, turnRate: rad/s (signed) }
// floorY: highest surface under the flyer. groundY: terrain under it (for
// the ceiling). falling: forced fall (crash rule).
export function stepFlight(state, spec, ctrl, floorY, groundY, dt, falling = false) {
  const airspeed = Math.abs(ctrl.airspeed || 0);
  const climb = clamp(ctrl.climb || 0, -1, 1);
  const onFloor = state.y <= floorY + 0.05;
  state.falling = falling;
  if (falling) {
    state.stalled = true;
    state.vy -= spec.fallAccel * dt;
  } else if (onFloor && !state.airborne) {
    // Grounded: lift off only with enough airspeed and a climb input.
    state.vy = airspeed >= spec.takeoffSpeed && climb > 0 ? climb * spec.climbRate : 0;
    state.stalled = false;
  } else if (airspeed < spec.stallSpeed) {
    state.stalled = true;
    state.vy = approach(state.vy, -spec.stallSink, spec.climbRate * 2 * dt);
  } else {
    state.stalled = false;
    state.vy = approach(state.vy, climb * spec.climbRate, spec.climbRate * 2.5 * dt);
  }
  state.y += state.vy * dt;
  const top = groundY + spec.ceiling;
  if (state.y > top) {
    state.y = top;
    state.vy = Math.min(0, state.vy);
  }
  if (state.y <= floorY) {
    const impact = state.vy;
    state.y = floorY;
    state.vy = 0;
    if (falling) {
      state.crashed = state.crashed || impact < -6;
      state.airborne = false;
    } else if (airspeed < spec.stallSpeed || climb < 0 && airspeed < spec.takeoffSpeed) {
      state.airborne = false;
    }
  } else if (state.y > floorY + 0.3) {
    state.airborne = true;
  }
  state.agl = state.y - floorY;
  const pitchTarget = state.airborne ? clamp(Math.atan2(state.vy, Math.max(airspeed, 4)), -spec.pitchMax, spec.pitchMax) : 0;
  state.pitch = approach(state.pitch, pitchTarget, 2.5 * dt);
  const bankTarget = state.airborne ? clamp((ctrl.turnRate || 0) * 0.45, -spec.bankMax, spec.bankMax) : 0;
  state.bank = approach(state.bank, bankTarget, 2.2 * dt);
  return state;
}

// Floor height at (x, z): terrain, or the top of an obstacle the flyer's
// footprint overlaps. obstacles: { shape, x, z, r | hw, hd, top }.
export function floorAt(x, z, groundY, obstacles, radius = 0) {
  let floor = groundY;
  for (const o of obstacles) {
    if (o.top == null) continue;
    let over = false;
    if (o.shape === "circle") over = Math.hypot(x - o.x, z - o.z) < o.r + radius * 0.5;
    else if (o.shape === "aabb") over = Math.abs(x - o.x) < o.hw + radius * 0.5 && Math.abs(z - o.z) < o.hd + radius * 0.5;
    if (over && o.top > floor) floor = o.top;
  }
  return floor;
}

// Crash rule: lose the core, both wings (left/right mounts) or both legs.
export function shouldFall(parts) {
  const dead = (id) => !parts[id] || parts[id].destroyed;
  if (parts.core && parts.core.destroyed) return true;
  if (dead("leftWeapon") && dead("rightWeapon")) return true;
  if (dead("leftLeg") && dead("rightLeg")) return true;
  return false;
}

// Melee needs both ends within meleeHeight of each other vertically.
export function meleeReaches(attackerY, targetY, spec) {
  return Math.abs(attackerY - targetY) <= (spec ? spec.meleeHeight : FLIGHT_DEFAULTS.meleeHeight);
}
