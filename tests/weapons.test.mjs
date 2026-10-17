// Delivery rules: beams are instant, shells drop, rockets lock, charges need a still hold.

import assert from "node:assert/strict";
import { WEAPONS, WEAPON_ORDER } from "../js/catalog.js";
import { weaponWantsShot, stepProjectile } from "../js/combat.js";
import {
  BALLISTIC_GRAVITY,
  CHARGE_TIME,
  LOCK_BREAK_SPEED,
  LOCK_TIME,
  STATIONARY_SPEED,
  ballisticAim,
  ballisticPoint,
  dropPoint,
  impactDelay,
  leadPoint,
  lockStrength,
  rangeFalloff,
  rocketMayFire,
  rocketTurn,
  stepBallistic,
  stepCharge,
  stepLock,
  stepRocket,
} from "../js/ballistics.js";

const expectDelivery = {
  pulseLaser: "beam",
  beamCannon: "beam",
  gatling: "ballistic",
  shockCannon: "ballistic",
  missilePack: "rocket",
  chargedParticle: "charge",
};

const ranges = [];
for (const id of WEAPON_ORDER) {
  const weapon = WEAPONS[id];
  assert.equal(weapon.delivery, expectDelivery[id], id);
  assert.ok(weapon.optimal < weapon.range, `${id} optimal`);
  ranges.push(weapon.range);
  assert.equal(impactDelay(weapon, 40) === 0, weapon.delivery === "beam" || weapon.delivery === "charge", id);
}
assert.equal(new Set(ranges).size, WEAPON_ORDER.length, "each weapon has its own max range");
assert.equal(WEAPONS.pulseLaser.hitscan, true);
assert.equal(WEAPONS.beamCannon.hitscan, true);
assert.equal(WEAPONS.gatling.hitscan, false);
assert.equal(WEAPONS.shockCannon.hitscan, false);
assert.equal(WEAPONS.missilePack.homing, true);
assert.equal(WEAPONS.missilePack.lockTime, LOCK_TIME);
assert.equal(WEAPONS.chargedParticle.chargeTime, CHARGE_TIME);
assert.equal(WEAPONS.chargedParticle.hitscan, true);
assert.equal(impactDelay(WEAPONS.pulseLaser, 80), 0);
assert.ok(impactDelay(WEAPONS.shockCannon, 80) > 0.5);

const pulse = WEAPONS.pulseLaser;
assert.equal(rangeFalloff(10, pulse.optimal, pulse.range), 1);
assert.equal(rangeFalloff(pulse.optimal, pulse.optimal, pulse.range), 1);
const mid = rangeFalloff((pulse.optimal + pulse.range) / 2, pulse.optimal, pulse.range);
assert.ok(mid < 1 && mid > 0.3, `mid falloff ${mid}`);
assert.equal(rangeFalloff(pulse.range, pulse.optimal, pulse.range), 0);
assert.equal(rangeFalloff(pulse.range + 20, pulse.optimal, pulse.range), 0);
for (const id of WEAPON_ORDER) {
  const weapon = WEAPONS[id];
  assert.equal(rangeFalloff(weapon.range + 1, weapon.optimal, weapon.range), 0, id);
  assert.equal(rangeFalloff(weapon.optimal * 0.5, weapon.optimal, weapon.range), 1, id);
}

const muzzle = { x: 0, y: 3, z: 0 };
const aim = { x: 0, y: 1.5, z: -100 };
const speed = WEAPONS.shockCannon.speed;
const solved = ballisticAim(muzzle, aim, speed, BALLISTIC_GRAVITY);
assert.equal(solved.solved, true);
const landed = ballisticPoint(muzzle, solved.dir, speed, BALLISTIC_GRAVITY, solved.time);
assert.ok(Math.abs(landed.x - aim.x) < 0.05, `x ${landed.x}`);
assert.ok(Math.abs(landed.y - aim.y) < 0.05, `y ${landed.y}`);
assert.ok(Math.abs(landed.z - aim.z) < 0.05, `z ${landed.z}`);
assert.ok(solved.time > 100 / speed, "lofted flight is longer than a flat shot");

const near = ballisticAim(muzzle, { x: 0, y: 1.5, z: -40 }, speed, BALLISTIC_GRAVITY);
const far = ballisticAim(muzzle, aim, speed, BALLISTIC_GRAVITY);
assert.ok(far.time > near.time, "travel time grows with range");
const shell = {
  ox: muzzle.x,
  oy: muzzle.y,
  oz: muzzle.z,
  x: muzzle.x,
  y: muzzle.y,
  z: muzzle.z,
  vx0: solved.dir.x * speed,
  vy0: solved.dir.y * speed,
  vz0: solved.dir.z * speed,
  gravity: BALLISTIC_GRAVITY,
  t: 0,
  life: 10,
  traveled: 0,
};
stepBallistic(shell, solved.time);
assert.ok(Math.abs(shell.y - aim.y) < 0.05, `step y ${shell.y}`);
assert.ok(shell.traveled > 90, "shell covers the range");

const dropNear = dropPoint(muzzle, { x: 0, y: 3, z: -40 }, speed, BALLISTIC_GRAVITY);
const dropFar = dropPoint(muzzle, { x: 0, y: 3, z: -110 }, speed, BALLISTIC_GRAVITY);
assert.ok(dropNear.drop > 0, "shells drop");
assert.ok(dropFar.drop > dropNear.drop + 1, `drop should grow ${dropNear.drop} -> ${dropFar.drop}`);

const lead = leadPoint(
  { x: 0, y: 2, z: 0 },
  { x: 0, y: 2, z: -80 },
  { x: 12, y: 0, z: 0 },
  speed,
);
assert.ok(lead.point.x > 2, `lead ahead of a crossing target (${lead.point.x})`);
assert.ok(lead.time > 0.4 && lead.time < 2, `lead time ${lead.time}`);

assert.equal(lockStrength(0), 1);
assert.ok(Math.abs(lockStrength(LOCK_BREAK_SPEED / 2) - 0.5) < 1e-9);
assert.equal(lockStrength(LOCK_BREAK_SPEED), 0);
assert.equal(lockStrength(40), 0);

let lock = 0;
let ready = false;
for (let t = 0; t < LOCK_TIME - 0.02; t += 0.01) {
  const step = stepLock(lock, 0.01, 0, true);
  lock = step.lock;
  ready = step.ready;
}
assert.equal(ready, false, "lock is not done before 1.5 s");
assert.equal(rocketMayFire(lock), false);
const done = stepLock(lock, 0.03, 0, true);
assert.equal(done.ready, true);
assert.equal(rocketMayFire(done.lock), true);

let slow = 0;
let sim = 0;
while (sim < 2.9 - 1e-9) {
  const step = stepLock(slow, 0.05, 15, true);
  slow = step.lock;
  sim += 0.05;
  assert.equal(step.ready, false);
}
assert.ok(slow < 1, `15 m/s should still be locking at ${sim.toFixed(2)} s (${slow})`);
let slowReady = false;
while (sim < 3.05) {
  const step = stepLock(slow, 0.05, 15, true);
  slow = step.lock;
  sim += 0.05;
  slowReady = step.ready;
}
assert.equal(slowReady, true, "half-strength lock finishes at 3 s");

assert.equal(stepLock(0, 2, LOCK_BREAK_SPEED, true).lock, 0);
assert.equal(stepLock(1, 0.05, LOCK_BREAK_SPEED, true).lock, 0, "a fast target breaks the lock");
const decayed = stepLock(1, LOCK_TIME / 2, 0, false);
assert.ok(Math.abs(decayed.lock - 0.5) < 1e-6, "looking away decays the lock");
assert.equal(rocketTurn(0), 0);
assert.ok(rocketTurn(1) > rocketTurn(0.4));

const rocket = {
  x: 0, y: 2, z: 0,
  vx: 0, vy: 0, vz: -1,
  hx: 0, hz: -1,
  speed: WEAPONS.missilePack.speed,
  age: 0,
  life: 8,
  traveled: 0,
  popTime: WEAPONS.missilePack.popTime,
};
const y0 = rocket.y;
stepRocket(rocket, 0.2, null);
assert.equal(rocket.phase, "pop");
assert.ok(rocket.y > y0 + 5, `missile climbs first (${rocket.y})`);
const target = { x: 0, y: 1, z: -70, speed: 0 };
const before = Math.hypot(rocket.x - target.x, rocket.y - target.y, rocket.z - target.z);
for (let i = 0; i < 40; i++) stepRocket(rocket, 0.05, target);
assert.equal(rocket.phase, "dive");
assert.ok(rocket.turn > 2, "a still target is tracked hard");
const after = Math.hypot(rocket.x - target.x, rocket.y - target.y, rocket.z - target.z);
assert.ok(after < before, "the dive closes on the target");
const wild = {
  x: 0, y: 30, z: 0, vx: 0, vy: 20, vz: -10, hx: 0, hz: -1,
  speed: 68, age: 1, life: 4, traveled: 0, popTime: 0.52,
};
stepRocket(wild, 0.05, { x: 20, y: 0, z: -40, speed: 36 });
assert.equal(wild.turn, 0, "a fast target is not tracked");

const charge = { chargeTime: CHARGE_TIME, charge: 0, charging: false, cooldown: 0, rate: 0.18 };
assert.equal(stepCharge(charge, 2.9, true, false, true), false);
assert.ok(Math.abs(charge.charge - 2.9) < 1e-9);
assert.equal(stepCharge(charge, 0.05, false, false, true), false, "releasing early does not fire");
assert.equal(charge.charge, 0);
assert.equal(charge.charging, false);

const held = { chargeTime: CHARGE_TIME, charge: 0, charging: false, cooldown: 0, rate: 0.18 };
assert.equal(weaponWantsShot(held, 2.9, true, true, false), false);
assert.equal(weaponWantsShot(held, 0.1, true, true, false), true, "a full 3 s hold fires");
assert.ok(held.cooldown > 1);

const walking = { chargeTime: CHARGE_TIME, charge: 2.4, charging: true, cooldown: 0, rate: 0.18 };
assert.equal(stepCharge(walking, 0.1, true, true, true), false);
assert.equal(walking.charge, 0, "moving clears the charge");
assert.equal(STATIONARY_SPEED, 0.75);

const shot = {
  delivery: "ballistic",
  gravity: BALLISTIC_GRAVITY,
  ox: 0, oy: 4, oz: 0,
  x: 0, y: 4, z: 0,
  vx0: 0, vy0: 0, vz0: -speed,
  t: 0, life: 5, traveled: 0, speed,
};
const yStart = shot.y;
stepProjectile(shot, 0.4, null);
assert.ok(shot.y < yStart, "combat steps ballistic gravity");

console.log("weapons tests ok");
