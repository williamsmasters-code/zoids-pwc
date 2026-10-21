// Flyer physics (js/flight.js) and ground-to-air fire maths.
import assert from "node:assert/strict";
import { FLIGHT_DEFAULTS, flightSpec, createFlight, stepFlight, floorAt, shouldFall, meleeReaches } from "../js/flight.js";
import { ballisticAim, leadPoint } from "../js/ballistics.js";
import { clampAimYawPitch, rayPassesThrough } from "../js/aim.js";
import { ZOIDS } from "../js/catalog.js";

let n = 0;
const ok = (m) => { n++; console.log("ok", m); };
const spec = flightSpec(ZOIDS.pteras);
assert.ok(spec && spec.ceiling >= 60 && spec.ceiling <= 80, "pteras has a flight block, ceiling 60-80");
assert.equal(flightSpec(ZOIDS.shieldLiger), null);
const run = (st, ctrl, secs, floor = 0, ground = 0) => { for (let t = 0; t < secs; t += 0.05) stepFlight(st, spec, ctrl, floor, ground, 0.05); return st; };

// Take-off and climb.
let st = createFlight(0);
run(st, { climb: 1, airspeed: 3 }, 2);
assert.equal(st.y, 0, "too slow to take off");
assert.equal(st.airborne, false);
run(st, { climb: 1, airspeed: 25 }, 3);
assert.ok(st.airborne && st.y > 20, `climbed to ${st.y.toFixed(1)}`);
assert.ok(st.pitch > 0.1, "nose pitches up in the climb");
ok(`take-off and climb: ${st.y.toFixed(1)} m after 3 s, pitch ${st.pitch.toFixed(2)}`);

// Level flight holds altitude.
const y0 = st.y;
run(st, { climb: 0, airspeed: 25 }, 3);
assert.ok(Math.abs(st.y - y0) < 3, "holds altitude with no input");
ok("level flight holds altitude");

// Ceiling.
run(st, { climb: 1, airspeed: 25 }, 20, 0, 5);
assert.ok(Math.abs(st.y - (5 + spec.ceiling)) < 1e-6, `ceiling ${st.y}`);
ok(`ceiling at ${spec.ceiling} m above terrain`);

// Stall: no hover, cannot climb, sinks, then lands.
st = createFlight(0);
run(st, { climb: 1, airspeed: 25 }, 3);
const yS = st.y;
run(st, { climb: 1, airspeed: 4 }, 1);
assert.ok(st.stalled && st.y < yS, "stall: climbs no more and sinks");
run(st, { climb: 1, airspeed: 4 }, 20);
assert.equal(st.y, 0);
assert.equal(st.airborne, false, "stalled flyer lands");
ok("stall below minimum airspeed: sinks and lands (no hover)");

// Floor: terrain and obstacle tops; it skims at speed, cannot go below.
st = createFlight(0);
run(st, { climb: 1, airspeed: 25 }, 0.6);
run(st, { climb: -1, airspeed: 25 }, 10, 3, 3);
assert.equal(st.y, 3, "never below the floor");
assert.equal(st.airborne, true, "fast flyer skims the floor instead of landing");
const obstacles = [{ shape: "circle", x: 10, z: 0, r: 4, top: 12 }, { shape: "aabb", x: -20, z: 0, hw: 5, hd: 5, top: 30 }];
assert.equal(floorAt(10, 0, 1, obstacles), 12);
assert.equal(floorAt(-20, 2, 1, obstacles), 30);
assert.equal(floorAt(50, 50, 1, obstacles), 1);
ok("terrain / obstacle floor and skimming");

// Bank follows the turn.
st = createFlight(0);
run(st, { climb: 1, airspeed: 25, turnRate: 1.2 }, 2);
assert.ok(st.bank > 0.3, `banks into a left turn (${st.bank.toFixed(2)})`);
ok("banking turn");

// Crash rule.
const parts = (dead) => Object.fromEntries(["core", "leftWeapon", "rightWeapon", "leftLeg", "rightLeg"].map((id) => [id, { destroyed: dead.includes(id) }]));
assert.equal(shouldFall(parts([])), false);
assert.equal(shouldFall(parts(["leftWeapon"])), false);
assert.equal(shouldFall(parts(["leftWeapon", "rightWeapon"])), true);
assert.equal(shouldFall(parts(["leftLeg", "rightLeg"])), true);
st = createFlight(0);
run(st, { climb: 1, airspeed: 25 }, 3);
for (let t = 0; t < 6 && !st.crashed; t += 0.05) stepFlight(st, spec, { climb: 1, airspeed: 25 }, 0, 0, 0.05, true);
assert.ok(st.crashed && st.y === 0, "falls and crashes");
ok("losing both wings or legs drops it and it crashes");

// Melee height rule.
assert.equal(meleeReaches(0, 3, spec), true);
assert.equal(meleeReaches(0, 20, spec), false);
ok("melee cannot reach above meleeHeight");

// Ground fire at an airborne, moving target: the AI barrel clamp keeps the
// elevation, a beam ray passes through the flyer, and a led shell meets it.
const fwd = { x: 0, y: 0, z: -1 };
const muzzle = { x: 0, y: 2, z: 0 };
const flyer = { x: 10, y: 32, z: -60 };
const up = clampAimYawPitch(fwd, { x: flyer.x - muzzle.x, y: flyer.y - muzzle.y, z: flyer.z - muzzle.z }, 0.6);
assert.ok(up.y > 0.4, "AI barrel elevates toward the flyer");
assert.ok(rayPassesThrough(muzzle, up, flyer, 1e-3), "beam ray passes through the flyer");
const vel = { x: 20, y: 3, z: 0 };
const speed = 170, g = 12;
const led = leadPoint(muzzle, flyer, vel, speed).point;
const sol = ballisticAim(muzzle, led, speed, g);
assert.ok(sol.solved);
let best = Infinity;
for (let t = 0; t < 2; t += 0.002) {
  const sx = muzzle.x + sol.dir.x * speed * t, sy = muzzle.y + sol.dir.y * speed * t - 0.5 * g * t * t, sz = muzzle.z + sol.dir.z * speed * t;
  const tx = flyer.x + vel.x * t, ty = flyer.y + vel.y * t, tz = flyer.z + vel.z * t;
  best = Math.min(best, Math.hypot(sx - tx, sy - ty, sz - tz));
}
assert.ok(best < 2.0, `led shell passes within ${best.toFixed(2)} m of the flyer`);
ok(`ground fire hits an airborne target (beam ray through it; led shell miss distance ${best.toFixed(2)} m)`);
console.log(`flight tests passed: ${n}`);
