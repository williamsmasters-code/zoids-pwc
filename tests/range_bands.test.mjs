// Range increments (js/rangebands.js + RANGE_PROFILES in js/catalog.js).
import assert from "node:assert/strict";
import { WEAPONS, WEAPON_ORDER, DAMAGE_VS_ARMOR, damageClassOf } from "../js/catalog.js";
import { bandOf, rangeClassOf, rangeDamageMul, rangeSpreadMul, rangeAimMul, rangeLockMul, hitChanceMul } from "../js/rangebands.js";

let n = 0;
const ok = (m) => { n++; console.log("ok", m); };
const mid = (w, band) => ({
  short: (w.minRange || 0) / 2,
  ideal: ((w.minRange || 0) + w.optimal) / 2,
  long: (w.optimal + w.longRange) / 2,
  extreme: (w.longRange + w.range) / 2,
}[band]);

for (const id of WEAPON_ORDER) {
  const w = WEAPONS[id];
  assert.ok(w.longRange != null && w.minRange != null, `${id} has bands`);
  if (rangeClassOf(w) !== "melee") assert.ok((w.minRange || 0) < w.optimal && w.optimal < w.longRange && w.longRange < w.range, `${id} band order`);
  assert.equal(bandOf(w, w.range + 1), "out");
  assert.equal(rangeDamageMul(w, w.range + 1), 0, `${id} nothing past max`);
}
ok("every weapon has ordered bands and nothing past max range");

const beams = WEAPON_ORDER.filter((id) => rangeClassOf(WEAPONS[id]) === "beam");
const ballistic = WEAPON_ORDER.filter((id) => rangeClassOf(WEAPONS[id]) === "ballistic");
assert.deepEqual(beams.sort(), ["beamCannon", "chargedParticle", "doubleBeamCannon", "pulseLaser"]);
assert.deepEqual(ballistic.sort(), ["gatling", "shockCannon", "sniperRifle"]);
assert.equal(rangeClassOf(WEAPONS.missilePack), "missile");
ok("classes: beams, ballistics, missile, melee");

for (const id of beams) {
  const w = WEAPONS[id];
  const [i, l, e] = ["ideal", "long", "extreme"].map((b) => rangeDamageMul(w, mid(w, b)));
  assert.equal(i, 1);
  assert.ok(l <= 0.5 && e <= 0.25 && e < l, `${id} beam damage drops drastically: ${l}, ${e}`);
  assert.ok(rangeSpreadMul(w, mid(w, "extreme")) <= 1.3, `${id} beam spread stays tight`);
}
ok("beams: steep damage falloff (x0.5 long, x0.2 extreme), spread at most x1.25");

for (const id of ballistic) {
  const w = WEAPONS[id];
  const l = rangeDamageMul(w, mid(w, "long"));
  const e = rangeDamageMul(w, mid(w, "extreme"));
  assert.ok(l >= 0.85 && e >= 0.7, `${id} ballistic damage carries: ${l}, ${e}`);
  const s = ["ideal", "long", "extreme"].map((b) => rangeSpreadMul(w, mid(w, b)));
  assert.ok(s[0] === 1 && s[1] >= 2 && s[2] >= 4, `${id} spread grows: ${s}`);
  assert.ok(hitChanceMul(w, mid(w, "extreme")) < 0.45, `${id} extreme hit chance`);
}
ok("ballistics: gentle damage falloff (x0.9 / x0.75), spread x2.5 long and x5 extreme");

const m = WEAPONS.missilePack;
assert.ok(rangeDamageMul(m, mid(m, "extreme")) >= 0.85);
assert.equal(rangeSpreadMul(m, mid(m, "extreme")), 1);
assert.ok(rangeLockMul(m, mid(m, "long")) > 1 && rangeLockMul(m, mid(m, "extreme")) > rangeLockMul(m, mid(m, "long")));
ok("missiles: damage holds, no spread growth, lock takes longer per band");

for (const id of ["strikeLaserClaw", "laserBlade"]) {
  const w = WEAPONS[id];
  assert.equal(rangeDamageMul(w, 1), 1);
  assert.equal(rangeDamageMul(w, w.range), 1);
  assert.equal(rangeDamageMul(w, w.range + 0.5), 0);
  assert.equal(rangeDamageMul(w, 30), 0);
}
ok("melee: full damage in reach, zero beyond");

for (const id of ["sniperRifle", "chargedParticle"]) {
  const w = WEAPONS[id];
  assert.equal(bandOf(w, 20), "short");
  assert.ok(rangeDamageMul(w, 20) < 1 && rangeDamageMul(w, 20) >= 0.7, `${id} short penalty is small`);
}
assert.equal(bandOf(WEAPONS.gatling, 5), "ideal", "no short band without a minRange");
ok("short-range penalty only for the sniper rifle and particle cannon");

// AI aim error: the mission adds aimError * dist/100 * (aimMul - 1) on top of
// the pilot's base scatter. Ballistic error must grow per increment, beams
// barely.
const scatter = (w, d, aimError = 4) => aimError * (d / 100) * rangeAimMul(w, d);
const g = WEAPONS.shockCannon;
const gs = ["ideal", "long", "extreme"].map((b) => scatter(g, mid(g, b)));
assert.ok(gs[1] > gs[0] * 2 && gs[2] > gs[1] * 1.8, `ballistic AI error grows: ${gs.map((v) => v.toFixed(2))}`);
const bc = WEAPONS.beamCannon;
assert.ok(rangeAimMul(bc, mid(bc, "extreme")) <= 1.25);
ok(`AI aim error grows per band for ballistics (${gs.map((v) => v.toFixed(2)).join(" -> ")} m), beams stay near base`);

// Bands stack with the armour multipliers (beam x0.7 / ballistic x1.3 vs plating).
const beamVsArmorLong = rangeDamageMul(WEAPONS.beamCannon, 110) * DAMAGE_VS_ARMOR[damageClassOf(WEAPONS.beamCannon)].armor;
const shellVsArmorLong = rangeDamageMul(WEAPONS.shockCannon, 60) * DAMAGE_VS_ARMOR[damageClassOf(WEAPONS.shockCannon)].armor;
assert.ok(Math.abs(beamVsArmorLong - 0.35) < 1e-9 && Math.abs(shellVsArmorLong - 1.17) < 1e-9);
ok("bands multiply with the armour class (beam long vs plating x0.35, shell long x1.17)");
console.log(`range band tests passed: ${n}`);
