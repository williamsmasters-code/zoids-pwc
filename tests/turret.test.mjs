// Turret rules: track the LOCKED target only, anywhere in the arc, at the
// traverse speed, and fire while the chassis moves. No lock = no fire.
import assert from "node:assert/strict";
import { WEAPONS, ZOIDS, stockWeaponsFor } from "../js/catalog.js";
import { turretSpecFor, relativeBearing, stepTurret, turretTrigger, TURRET_FIRE_TOLERANCE } from "../js/turret.js";
import { forwardFromYaw, wrapAngle } from "../js/frame.js";

const wolf = ZOIDS.commandWolf;
const dbc = { ...WEAPONS.doubleBeamCannon, mount: "backMount" };
const spec = turretSpecFor(wolf, dbc);
assert.ok(spec, "Command Wolf back cannon is a turret");
assert.ok(Math.abs(spec.arc - Math.PI * 2) < 1e-9, "360 degree arc");
assert.ok(stockWeaponsFor(wolf).some((w) => w.type === "doubleBeamCannon" && w.mount === "backMount"), "wolf stock turret");

// Charge weapons and non-back mounts never turret.
assert.equal(turretSpecFor(ZOIDS.genoSaurer, { ...WEAPONS.chargedParticle, mount: "backMount" }), null);
assert.ok(turretSpecFor(ZOIDS.genoSaurer, { ...WEAPONS.beamCannon, mount: "backMount" }), "geno back beam turret");
assert.equal(turretSpecFor(wolf, { ...WEAPONS.doubleBeamCannon, mount: "leftWeapon" }), null);
assert.equal(turretSpecFor(ZOIDS.shieldLiger, { ...WEAPONS.missilePack, mount: "backMount" }), null, "shield liger untouched");
assert.ok(turretSpecFor(ZOIDS.ironKong, { ...WEAPONS.missilePack, mount: "backMount" }), "kong missile turret");
assert.ok(turretSpecFor(ZOIDS.bladeLiger, { ...WEAPONS.pulseLaser, mount: "backMount" }), "blade gun pods turret");

// Bearing convention: yaw 0 faces -Z; a point at +Z is directly behind.
assert.ok(Math.abs(Math.abs(relativeBearing(0, 0, 0, 0, 10)) - Math.PI) < 1e-9, "behind = PI");
assert.ok(Math.abs(relativeBearing(0, 0, 0, -10, 0) - Math.PI / 2) < 1e-9, "left = +PI/2");

// Simulate: wolf runs forward at 27 m/s while weaving; the locked enemy
// starts directly behind, then is passed on the right side.
function run({ lock, enemy, t = 4, dt = 1 / 60, chassisTurn = 0.4, arcSpec = spec, range = dbc.range }) {
  const state = { yaw: arcSpec.rest };
  let x = 0, z = 0, yaw = 0, fired = 0, firedWhileMoving = 0, maxAbsBearing = 0, firstFire = null;
  for (let i = 0; i < t / dt; i++) {
    yaw = wrapAngle(yaw + chassisTurn * Math.sin(i * dt) * dt);
    const f = forwardFromYaw(yaw);
    x += f.x * 27 * dt;
    z += f.z * 27 * dt;
    const bearing = lock ? relativeBearing(yaw, x, z, enemy.x, enemy.z) : null;
    const dist = Math.hypot(enemy.x - x, enemy.z - z);
    const r = stepTurret(state, arcSpec, bearing, dt);
    const trig = turretTrigger(lock ? { alive: true, dist } : null, r, range);
    if (trig) {
      fired += 1;
      firedWhileMoving += 1;
      if (firstFire == null) firstFire = i * dt;
      if (bearing != null) maxAbsBearing = Math.max(maxAbsBearing, Math.abs(bearing));
      assert.ok(Math.abs(wrapAngle(bearing - state.yaw)) <= TURRET_FIRE_TOLERANCE + 1e-9);
    }
  }
  return { fired, firedWhileMoving, maxAbsBearing, firstFire, state };
}

const behind = run({ lock: true, enemy: { x: 0, z: 30 } });
assert.ok(behind.fired > 0, "fires at a locked target behind while moving");
assert.ok(behind.firstFire < Math.PI / spec.speed + 0.1, `swings 180 deg in time (${behind.firstFire})`);
assert.ok(behind.maxAbsBearing > Math.PI * 0.75, `fired rearward (max |bearing| ${behind.maxAbsBearing.toFixed(2)})`);

const beside = run({ lock: true, enemy: { x: 40, z: -20 } });
assert.ok(beside.fired > 0, "fires at a locked target beside while moving");
assert.ok(beside.maxAbsBearing > Math.PI / 3, "fired off the nose");

// No lock: never fires, even with an enemy 6 m away, and returns to rest.
const noLock = run({ lock: false, enemy: { x: 3, z: 5 } });
assert.equal(noLock.fired, 0, "no lock = no fire, even when an enemy is close");
assert.ok(Math.abs(noLock.state.yaw - spec.rest) < 1e-9, "holds at rest without a lock");

// A locked target out of range does not fire.
const far = run({ lock: true, enemy: { x: 0, z: 900 }, t: 2 });
assert.equal(far.fired, 0, "out of range = no fire");

// A limited arc (Blade Liger pods, 180 deg forward) cannot shoot straight back.
const pods = turretSpecFor(ZOIDS.bladeLiger, { ...WEAPONS.pulseLaser, mount: "backMount" });
const podsBehind = run({ lock: true, enemy: { x: 0, z: 30 }, chassisTurn: 0, arcSpec: pods, t: 1 });
assert.equal(podsBehind.fired, 0, "limited arc holds fire on a target behind");

// Traverse speed is respected.
const st = { yaw: 0 };
stepTurret(st, spec, Math.PI * 0.9, 0.1);
assert.ok(Math.abs(st.yaw - spec.speed * 0.1) < 1e-9, "traverse speed limit");

console.log("turret tests ok");
