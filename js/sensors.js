// Radar and sensor contacts (pure; shared by the player HUD, target lock
// and the AI, and tested in Node).
//
// Rule: a contact is VISIBLE when it is inside radar range AND either the
// radar line from the observer is clear of terrain (mountains, canyon walls,
// ridges), rock spires and very tall buildings, or it is inside the short
// close-detection radius. A contact that drops out of sight stays tracked
// (live position) for FRESH_TIME seconds, then shows as a fading
// last-known-position marker until MEMORY_TIME, then is lost.
// Stealth: a target that stands still and/or runs cool shrinks both the
// radar range and the close radius used against it.

export const SENSOR = {
  closeRadius: 45, // m: always detected inside this, even behind a mountain
  freshTime: 2.5, // s: live track kept after line of sight breaks
  memoryTime: 12, // s: last-known marker fades out by this age
  stillSpeed: 1, // m/s: "standing still" below this
  stillMul: 0.8, // detection range x0.8 when still
  coolHeat: 0.3, // heat fraction: "running cool" below this
  coolMul: 0.9, // detection range x0.9 when cool
  buildingBlocks: 40, // m: only buildings at least this tall block radar
  recheck: 0.2, // s: radar line re-tested at most this often per pair
};

// Detection multiplier for a target (1, 0.9, 0.8 or 0.72).
export function stealthMul(speed, heatFrac) {
  let m = 1;
  if (Math.abs(speed || 0) < SENSOR.stillSpeed) m *= SENSOR.stillMul;
  if ((heatFrac || 0) < SENSOR.coolHeat) m *= SENSOR.coolMul;
  return m;
}

// Is the target detected right now? range = observer radar range (m).
export function detects({ dist, range, blocked, stealth = 1 }) {
  if (dist > range * stealth) return false;
  if (dist <= SENSOR.closeRadius * stealth) return true;
  return !blocked;
}

// Update a track ({ seenAt, x, z } or null) with this frame's result.
export function updateTrack(track, seen, x, z, time) {
  const t = track || { seenAt: -Infinity, x, z };
  if (seen) {
    t.seenAt = time;
    t.x = x;
    t.z = z;
  }
  return t;
}

// "live" (visible or fresh), "memory" (last-known marker) or "lost".
// fade: 1 at the start of memory down to 0 at MEMORY_TIME.
export function trackState(track, time) {
  if (!track) return { state: "lost", age: Infinity, fade: 0 };
  const age = time - track.seenAt;
  if (age <= SENSOR.freshTime) return { state: "live", age, fade: 1 };
  if (age <= SENSOR.memoryTime) return { state: "memory", age, fade: 1 - (age - SENSOR.freshTime) / (SENSOR.memoryTime - SENSOR.freshTime) };
  return { state: "lost", age, fade: 0 };
}
