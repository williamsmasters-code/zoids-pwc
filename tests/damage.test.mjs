// Per-part damage, degradation, and the frame helpers the sim relies on.
// No three.js. Run with: node tests/damage.test.mjs

import assert from "node:assert/strict";
import {
  createParts,
  applyHit,
  mobilityFromParts,
  sensorsFromHead,
  derivePerformance,
  livingWeapons,
  repairCost,
  repairAll,
  serializeParts,
  applyCondition,
  partColor,
  partRatio,
  isCoreDestroyed,
  describeDegradation,
} from "../js/damage.js";
import {
  ZOIDS,
  ZOID_ORDER,
  WEAPONS,
  STRUCTURES,
  fits,
  weightOf,
  stockWeaponsFor,
  partListFor,
} from "../js/catalog.js";
import { forwardFromYaw, rightFromForward, yawToFace, wrapAngle } from "../js/frame.js";
import { canOperateWeapon } from "../js/combat.js";
import { freshState, launchBlockReason, repairZoid, partsFor } from "../js/state.js";

globalThis.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  },
  setItem(key, value) {
    this.store.set(key, String(value));
  },
  removeItem(key) {
    this.store.delete(key);
  },
};

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log("ok", name);
}

function near(actual, expected, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} != ${expected}`);
}

check("yaw 0 forward is -Z and right is +X", () => {
  const fwd = forwardFromYaw(0);
  near(fwd.x, 0);
  near(fwd.z, -1);
  const right = rightFromForward(fwd);
  near(right.x, 1);
  near(right.z, 0);
  near(yawToFace(0, -1), 0);
  near(yawToFace(1, 0), -Math.PI / 2);
  const east = forwardFromYaw(-Math.PI / 2);
  near(east.x, 1);
  near(east.z, 0);
  const northTurn = forwardFromYaw(Math.PI / 2);
  near(northTurn.x, -1);
  near(northTurn.z, 0);
  near(Math.abs(wrapAngle(Math.PI * 3)), Math.PI);
  near(wrapAngle(0.4), 0.4);
});

check("shield cuts a frontal hit once, then excess leaks 40% into the core", () => {
  const def = ZOIDS.shieldLiger;
  const parts = createParts(def);
  const raw = 80;
  const coreArmor = parts.core.armor;
  const res = applyHit(parts, "head", raw, { zoidId: "shieldLiger", forwardDot: 0.5 });
  const reduced = raw * 0.7;
  const excess = reduced - (26 + 16);
  assert.ok(res.events.some((e) => e.type === "shield"));
  assert.equal(parts.head.destroyed, true);
  assert.equal(parts.head.structure, 0);
  near(parts.core.armor, coreArmor - excess * 0.4);
  assert.equal(parts.core.destroyed, false);
  assert.equal(isCoreDestroyed(parts), false);
});

check("shield does not apply from the side, from behind, or with the foreleg gone", () => {
  const open = createParts(ZOIDS.shieldLiger);
  applyHit(open, "head", 80, { zoidId: "shieldLiger", forwardDot: 0.35 });
  near(open.core.armor, 52 - (80 - 42) * 0.4);

  const behind = createParts(ZOIDS.shieldLiger);
  applyHit(behind, "head", 30, { zoidId: "shieldLiger", forwardDot: -1 });
  near(behind.head.armor, 0);
  near(behind.head.structure, 12);

  const broken = createParts(ZOIDS.shieldLiger);
  applyHit(broken, "leftFrontLeg", 30 + 18, { zoidId: "shieldLiger", forwardDot: 0 });
  assert.equal(broken.leftFrontLeg.destroyed, true);
  assert.equal(broken.core.armor, 52);
  applyHit(broken, "head", 80, { zoidId: "shieldLiger", forwardDot: 0.9 });
  near(broken.core.armor, 52 - (80 - 42) * 0.4);
});

check("a later hit on a destroyed part transfers half to the core", () => {
  const parts = createParts(ZOIDS.shieldLiger);
  applyHit(parts, "tail", 20 + 14, { zoidId: "shieldLiger" });
  assert.equal(parts.tail.destroyed, true);
  assert.equal(parts.core.armor, 52);
  applyHit(parts, "tail", 20, { zoidId: "shieldLiger" });
  near(parts.core.armor, 42);
  assert.equal(parts.core.destroyed, false);
});

check("destroying the core is a kill and further core hits do not leak", () => {
  const parts = createParts(ZOIDS.commandWolf);
  const res = applyHit(parts, "core", 99999, { zoidId: "commandWolf" });
  assert.ok(res.killed);
  assert.ok(res.events.some((e) => e.type === "kill"));
  assert.equal(parts.core.structure, 0);
  const again = applyHit(parts, "core", 50, { zoidId: "commandWolf" });
  assert.equal(again.events.some((e) => e.type === "kill"), false);
  assert.ok(isCoreDestroyed(parts));
});

check("leg damage slows speed and uneven legs slow the turn more", () => {
  const def = ZOIDS.commandWolf;
  const parts = createParts(def);
  const full = mobilityFromParts(parts, "quad");
  near(full.speedMul, 1);
  near(full.turnMul, 1);
  const leg = parts.leftFrontLeg;
  applyHit(parts, "leftFrontLeg", leg.maxArmor + leg.maxStructure, { zoidId: def.id });
  const one = mobilityFromParts(parts, "quad");
  near(one.speedMul, 0.8);
  near(one.turnMul, 0.8 * (1 - 0.55 * 0.5));
  assert.ok(one.turnMul < one.speedMul);
  for (const id of ["leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg"]) {
    if (!parts[id].destroyed) applyHit(parts, id, 99999, { zoidId: def.id, forwardDot: 0 });
  }
  const dead = derivePerformance(def, { speed: 0, maneuver: 0, booster: 0 }, parts, def.baseWeight);
  assert.ok(dead.speed < def.speed * 0.6);
  near(dead.mobility.speedMul, 0.2);
});

check("biped legs use the two-leg set", () => {
  const def = ZOIDS.ironKong;
  const parts = createParts(def);
  applyHit(parts, "leftLeg", parts.leftLeg.maxArmor + parts.leftLeg.maxStructure, { zoidId: def.id });
  const mob = mobilityFromParts(parts, "biped");
  near(mob.avg, 0.5);
  near(mob.speedMul, 0.6);
  assert.ok(mob.asymmetry > 0.9);
});

check("head destruction scrambles sensors and a wounded head only degrades them", () => {
  const parts = createParts(ZOIDS.shieldLiger);
  parts.head.armor = 0;
  const wounded = sensorsFromHead(parts.head);
  near(wounded.scramble, 0.12);
  near(wounded.rangeMul, 0.3 + 0.7 * 0.65);
  assert.equal(wounded.radar, true);
  applyHit(parts, "head", 99999, { zoidId: "shieldLiger", forwardDot: 0 });
  const dead = sensorsFromHead(parts.head);
  near(dead.scramble, 1);
  near(dead.rangeMul, 0.25);
  assert.equal(dead.radar, false);
  assert.equal(partColor(parts.head), "#141414");
  assert.equal(partColor(createParts(ZOIDS.shieldLiger).head), "#3dff7a");
});

check("a destroyed mount disables its weapons and boosters die with the back", () => {
  const def = ZOIDS.shieldLiger;
  const parts = createParts(def);
  const weapons = [
    { type: "pulseLaser", mount: "headWeapon", group: 1 },
    { type: "beamCannon", mount: "leftWeapon", group: 2 },
  ];
  assert.equal(livingWeapons(weapons, parts).length, 2);
  applyHit(parts, "headWeapon", parts.headWeapon.maxArmor + parts.headWeapon.maxStructure, { zoidId: def.id });
  const living = livingWeapons(weapons, parts);
  assert.deepEqual(living.map((w) => w.mount), ["leftWeapon"]);
  const unit = {
    alive: true,
    shutdown: 0,
    parts,
    def,
  };
  assert.equal(canOperateWeapon(unit, weapons[0]), false);
  assert.equal(canOperateWeapon(unit, weapons[1]), true);

  const mods = { speed: 1, maneuver: 0, booster: 2 };
  const ready = derivePerformance(def, mods, createParts(def), 40);
  near(ready.boostMul, 1.48);
  assert.equal(ready.boosterReady, true);
  applyHit(parts, "backMount", 99999, { zoidId: def.id, forwardDot: 0 });
  const down = derivePerformance(def, mods, parts, 40);
  assert.equal(down.boosterReady, false);
  assert.equal(down.boostMul, 1);
  const notes = describeDegradation(parts, down);
  assert.ok(notes.some((line) => line.includes("Back mount")));
  assert.ok(notes.some((line) => line.includes("Boosters")));
});

check("repair cost and a full repair restore every part", () => {
  const parts = createParts(ZOIDS.shieldLiger);
  applyHit(parts, "head", 26 + 16, { zoidId: "shieldLiger", forwardDot: 0 });
  const cost = repairCost(parts);
  assert.equal(cost, Math.round(26 * 28 + 16 * 95 + 650));
  repairAll(parts);
  assert.equal(parts.head.destroyed, false);
  near(parts.head.armor, parts.head.maxArmor);
  assert.equal(repairCost(parts), 0);
  assert.equal(partRatio(parts.head), 1);
});

check("condition round-trips and armor level raises the max", () => {
  const parts = createParts(ZOIDS.bladeLiger, { head: 2 });
  near(parts.head.maxArmor, 26 * 0.96 * (1 + 0.28 * 2));
  near(parts.head.maxStructure, 16 * 0.96);
  applyHit(parts, "core", 10, { zoidId: "bladeLiger" });
  const saved = serializeParts(parts);
  assert.equal(saved.core.id, "core");
  assert.ok(saved.core.maxArmor > 0);
  const fresh = createParts(ZOIDS.bladeLiger, { head: 2 });
  applyCondition(fresh, saved);
  near(fresh.core.armor, parts.core.armor);
  const plated = createParts(ZOIDS.genoSaurer, { core: 3 });
  assert.ok(plated.core.maxArmor > createParts(ZOIDS.genoSaurer).core.maxArmor);
});

check("eight Zoids have distinct stats and stock weapons fit", () => {
  assert.equal(ZOID_ORDER.length, 8);
  const speeds = new Set(ZOID_ORDER.map((id) => ZOIDS[id].speed));
  assert.equal(speeds.size, 8);
  for (const id of ZOID_ORDER) {
    const def = ZOIDS[id];
    assert.ok(def.price > 0);
    assert.ok(def.maxTonnage > def.baseWeight);
    assert.ok(partListFor(def).includes("core"));
    assert.ok(partListFor(def).includes("head"));
    for (const weapon of stockWeaponsFor(def, () => 0.1)) {
      const hp = def.hardpoints.find((h) => h.id === weapon.mount);
      assert.ok(hp, `${id} missing ${weapon.mount}`);
      assert.equal(fits(hp.size, WEAPONS[weapon.type].size), true, `${id} ${weapon.type}`);
    }
    const weight = weightOf(def, stockWeaponsFor(def, () => 0.9), {}, { speed: 0, maneuver: 0, booster: 0 });
    assert.ok(weight <= def.maxTonnage + 0.01, `${id} stock overweight ${weight}`);
  }
  assert.equal(fits("S", "M"), false);
  assert.equal(fits("XL", "XL"), true);
  assert.ok(STRUCTURES.gunTurret.immobile);
  assert.equal(Object.keys(WEAPONS).length, 9);
});

check("launch is blocked by a dead core or by tonnage, and a field loan can repair", () => {
  const state = freshState();
  assert.equal(launchBlockReason(state), null);
  assert.equal(state.money, 185000);
  for (const id of Object.keys(state.hangar.shieldLiger.armorLevel)) {
    state.hangar.shieldLiger.armorLevel[id] = 3;
  }
  state.hangar.shieldLiger.mods = { speed: 2, maneuver: 2, booster: 2 };
  assert.match(launchBlockReason(state), /tonnage/i);
  state.hangar.shieldLiger.armorLevel = Object.fromEntries(
    Object.keys(state.hangar.shieldLiger.armorLevel).map((id) => [id, 0]),
  );
  state.hangar.shieldLiger.mods = { speed: 0, maneuver: 0, booster: 0 };
  const parts = partsFor(state, "shieldLiger");
  applyHit(parts, "core", 99999, { zoidId: "shieldLiger" });
  state.hangar.shieldLiger.condition = serializeParts(parts);
  assert.match(launchBlockReason(state), /Core/);
  state.money = 10;
  const refused = repairZoid(state, "shieldLiger");
  assert.equal(refused.ok, false);
  const loan = repairZoid(state, "shieldLiger", { allowDebt: true });
  assert.equal(loan.ok, true);
  assert.ok(state.money < 0);
  assert.equal(launchBlockReason(state), null);
});

console.log(`\n${passed} checks passed`);
