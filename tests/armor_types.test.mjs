// Damage class vs armour. No DOM. Run with: node tests/armor_types.test.mjs
import assert from "node:assert/strict";
import { ZOIDS, WEAPONS, DAMAGE_VS_ARMOR, damageClassOf } from "../js/catalog.js";
import { createParts, applyHit, damageCtxFor } from "../js/damage.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok", name); };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const fresh = () => createParts(ZOIDS.commandWolf, {});

test("every weapon has a damage class", () => {
  const seen = {};
  for (const [id, w] of Object.entries(WEAPONS)) {
    const c = damageClassOf(w);
    assert.ok(DAMAGE_VS_ARMOR[c], `${id} -> ${c}`);
    seen[id] = c;
  }
  assert.equal(seen.pulseLaser, "beam");
  assert.equal(seen.beamCannon, "beam");
  assert.equal(seen.chargedParticle, "beam");
  assert.equal(seen.gatling, "ballistic");
  assert.equal(seen.shockCannon, "ballistic");
  assert.equal(seen.missilePack, "ballistic");
  assert.equal(seen.laserBlade, "melee");
  console.log("  ", JSON.stringify(seen));
});

test("beam vs armour: x0.7 on plating", () => {
  const parts = fresh();
  const before = parts.core.armor;
  applyHit(parts, "core", 10, { ...damageCtxFor(WEAPONS.pulseLaser), zoidId: "commandWolf" });
  close(before - parts.core.armor, 7, "beam armour damage");
  assert.equal(parts.core.structure, parts.core.maxStructure);
});

test("ballistic vs armour: x1.3 on plating", () => {
  const parts = fresh();
  const before = parts.core.armor;
  applyHit(parts, "core", 10, { ...damageCtxFor(WEAPONS.gatling), zoidId: "commandWolf" });
  close(before - parts.core.armor, 13, "ballistic armour damage");
});

test("beam and ballistic vs exposed component: unchanged", () => {
  for (const type of ["pulseLaser", "beamCannon", "gatling", "missilePack", "laserBlade"]) {
    const parts = fresh();
    parts.leftFrontLeg.armor = 0;
    const before = parts.leftFrontLeg.structure;
    applyHit(parts, "leftFrontLeg", 10, { ...damageCtxFor(WEAPONS[type]), zoidId: "commandWolf" });
    close(before - parts.leftFrontLeg.structure, 10, `${type} structure damage`);
  }
});

test("a hit that breaks through plating carries the raw remainder inward", () => {
  const parts = fresh();
  parts.core.armor = 7; // beam needs 10 raw to strip 7
  const s0 = parts.core.structure;
  const res = applyHit(parts, "core", 30, { ...damageCtxFor(WEAPONS.beamCannon), zoidId: "commandWolf" });
  assert.equal(parts.core.armor, 0);
  close(s0 - parts.core.structure, 20, "beam remainder on structure");
  assert.ok(res.events.some((e) => e.type === "armorGone"));
  const p2 = fresh();
  p2.core.armor = 13; // ballistic needs 10 raw to strip 13
  const s1 = p2.core.structure;
  applyHit(p2, "core", 30, { ...damageCtxFor(WEAPONS.shockCannon), zoidId: "commandWolf" });
  close(s1 - p2.core.structure, 20, "ballistic remainder on structure");
});

test("melee is neutral", () => {
  const parts = fresh();
  const before = parts.core.armor;
  applyHit(parts, "core", 10, { ...damageCtxFor(WEAPONS.strikeLaserClaw), zoidId: "commandWolf" });
  close(before - parts.core.armor, 10, "melee armour damage");
});

console.log(`armor type tests passed: ${passed}`);
