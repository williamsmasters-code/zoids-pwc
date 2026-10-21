// Tonnage weight zones. No DOM. Run with: node tests/tonnage.test.mjs

import assert from "node:assert/strict";
import { ZOIDS, ZOID_ORDER } from "../js/catalog.js";
import { TONNAGE_ZONES, TONNAGE_CEILING, tonnageZone } from "../js/tonnage.js";
import { createParts, derivePerformance } from "../js/damage.js";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { freshState, equip, buyWeapon, changeArmor, launchBlockReason, totalWeight } = await import("../js/state.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok", name);
}

test("zones tile 0..ceiling with no gaps", () => {
  assert.equal(TONNAGE_ZONES[0].min, 0);
  for (let i = 1; i < TONNAGE_ZONES.length; i++) assert.equal(TONNAGE_ZONES[i].min, TONNAGE_ZONES[i - 1].max);
  assert.equal(TONNAGE_ZONES.at(-1).max, TONNAGE_CEILING);
  assert.equal(TONNAGE_CEILING, 1.3);
});

test("zone ids by load ratio", () => {
  const at = (r) => tonnageZone(r * 100, 100).zone;
  assert.equal(at(0.5), "light");
  assert.equal(at(0.79), "light");
  assert.equal(at(0.9), "loaded");
  assert.equal(at(1.1), "overloaded");
  assert.equal(at(1.25), "critical");
  assert.equal(at(1.3), "critical");
  assert.equal(at(1.31), "blocked");
});

test("no penalty under 80%, mild 80-100%, heavy 100-120%", () => {
  const light = tonnageZone(79, 100);
  assert.deepEqual([light.speedMul, light.accelMul, light.turnMul, light.coolMul], [1, 1, 1, 1]);
  const full = tonnageZone(100, 100);
  assert.ok(full.speedMul >= 0.89 && full.speedMul <= 0.91);
  assert.equal(tonnageZone(99.9, 100).coolMul, 1, "loaded does not touch cooling");
  const heavy = tonnageZone(120, 100);
  assert.ok(Math.abs(heavy.speedMul - 0.65) < 1e-9 && Math.abs(heavy.turnMul - 0.65) < 1e-9);
  assert.ok(heavy.coolMul < 0.75, "overloaded cuts heat dissipation");
});

test("multipliers never rise as weight rises (continuous across boundaries)", () => {
  let prev = tonnageZone(0, 100);
  for (let w = 0.5; w <= 130; w += 0.5) {
    const z = tonnageZone(w, 100);
    for (const k of ["speedMul", "accelMul", "turnMul", "coolMul"]) {
      assert.ok(z[k] <= prev[k] + 1e-9, `${k} rose at ${w}`);
      // Cooling has one deliberate step: it drops to x0.85 the moment the Zoid is overloaded.
      if (!(k === "coolMul" && w === 100)) assert.ok(prev[k] - z[k] < 0.02, `${k} jumped at ${w}`);
    }
    prev = z;
  }
});

test("derivePerformance applies the zone to speed and turn", () => {
  const def = ZOIDS.shieldLiger;
  const parts = createParts(def, {});
  const light = derivePerformance(def, {}, parts, def.maxTonnage * 0.7);
  const over = derivePerformance(def, {}, parts, def.maxTonnage * 1.1);
  assert.ok(Math.abs(light.speed - def.speed) < 1e-9);
  assert.ok(Math.abs(over.speed / light.speed - over.load.speedMul) < 1e-9);
  assert.ok(Math.abs(over.turn / light.turn - over.load.turnMul) < 1e-9);
  assert.ok(over.accelMul < 1 && over.coolMul < 1);
  assert.equal(over.overweight, true);
});

test("overloaded launches, fitting past 130% is refused", () => {
  const state = freshState();
  const id = "shieldLiger";
  state.selected = id;
  const def = ZOIDS[id];
  state.money = 1e9;
  for (const mount of ["rightWeapon", "backMount"]) {
    const bought = buyWeapon(state, mount === "backMount" ? "shockCannon" : "missilePack");
    assert.equal(equip(state, id, mount, bought.uid).ok, true);
  }
  let refused = null;
  let sawOverloadedLaunch = false;
  const parts = Object.keys(state.hangar[id].armorLevel);
  for (let round = 0; round < 4 && !refused; round++) {
    for (const part of parts) {
      const r = changeArmor(state, id, part, 1);
      if (!r.ok && /ceiling/.test(r.reason)) { refused = r; break; }
      const ratio = totalWeight(state, id) / def.maxTonnage;
      if (ratio > 1 && ratio <= TONNAGE_CEILING) {
        assert.equal(launchBlockReason(state), null, `overloaded ${ratio.toFixed(2)} should still launch`);
        sawOverloadedLaunch = true;
      }
    }
  }
  assert.ok(sawOverloadedLaunch, "never reached the overloaded zone");
  assert.ok(refused, "expected plating to be refused at the ceiling");
  assert.ok(totalWeight(state, id) / def.maxTonnage <= TONNAGE_CEILING + 1e-9);
  console.log("  refused at", (totalWeight(state, id) / def.maxTonnage).toFixed(3), "-", refused.reason);
  // Legacy save already past the ceiling: launch is blocked.
  for (const part of parts) state.hangar[id].armorLevel[part] = 3;
  state.hangar[id].mods = { speed: 3, maneuver: 3, booster: 3 };
  assert.match(launchBlockReason(state) || "", /ceiling/);
});

test("fresh company launches with no tonnage block", () => {
  const state = freshState();
  assert.equal(launchBlockReason(state), null);
  for (const id of ZOID_ORDER) assert.ok(tonnageZone(totalWeight(state, id), ZOIDS[id].maxTonnage).zone !== "blocked");
});

console.log(`tonnage tests passed: ${passed}`);
