// Speed rework: canon-relative speeds, 3 Speed Booster levels (+33% of
const __store = {}; globalThis.localStorage = { getItem: (k) => __store[k] ?? null, setItem: (k, v) => { __store[k] = String(v); }, removeItem: (k) => { delete __store[k]; } };
// standard each, 2x cap = canon), per-Zoid acceleration, tonnage on top.
import assert from "node:assert/strict";
import { ZOIDS, ZOID_ORDER, MODS, SPEED_SCALE, speedUpgradeMul, stockWeaponsFor } from "../js/catalog.js";
import { createParts, derivePerformance } from "../js/damage.js";
import { weightOf } from "../js/catalog.js";
import { freshState, changeMod } from "../js/state.js";
import { gameToKph, displaySpeed, displayKph, zeroTo100 } from "../js/units.js";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("ok", name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);
const mods = (speed) => ({ speed, maneuver: 0, booster: 0 });
const perfAt = (id, lvl, weight) => { const d = ZOIDS[id]; return derivePerformance(d, mods(lvl), createParts(d), weight ?? d.baseWeight); };

check("upgrade multiplier 0/1/2/3 = 1.0/1.33/1.66/2.0, 4+ has no effect", () => {
  near(speedUpgradeMul(0), 1); near(speedUpgradeMul(1), 1.33); near(speedUpgradeMul(2), 1.66); near(speedUpgradeMul(3), 2);
  near(speedUpgradeMul(4), 2); near(speedUpgradeMul(9), 2);
  assert.equal(MODS.speed.max, 3);
  assert.equal(MODS.speed.costs.length, 3);
});

check("a 4th Speed Booster can't be bought", () => {
  const st = freshState();
  const id = ZOID_ORDER.find((z) => st.hangar[z].owned);
  st.money = 10_000_000;
  // fit the maximum, dropping other mods so tonnage allows it
  for (let i = 0; i < 3; i++) { const r = changeMod(st, id, "speed", 1); assert.ok(r.ok, r.reason); }
  const before = st.money;
  const r = changeMod(st, id, "speed", 1);
  assert.ok(!r.ok);
  assert.equal(st.hangar[id].mods.speed, 3);
  assert.equal(st.money, before);
});

check("standard = half canon; full set = exactly canon; never above 2x", () => {
  for (const id of ZOID_ORDER) {
    const d = ZOIDS[id];
    assert.ok(d.canonKph > 0, id);
    near(gameToKph(d.speed), d.canonKph / 2, 0.5);
    const stock = perfAt(id, 0);
    const full = perfAt(id, 3);
    assert.ok(stock.speed < full.speed);
    near(gameToKph(full.speed), d.canonKph, 1);
    assert.ok(full.speed <= d.speed * 2 + 1e-9);
    assert.ok(perfAt(id, 7).speed <= d.speed * 2 + 1e-9);
  }
});

check("relative speeds follow canon (Berserk Fuhrer fastest ground, Gojulas slowest)", () => {
  const ground = ZOID_ORDER.filter((id) => !ZOIDS[id].flight);
  const byGame = [...ground].sort((a, b) => ZOIDS[b].speed - ZOIDS[a].speed);
  const byCanon = [...ground].sort((a, b) => ZOIDS[b].canonKph - ZOIDS[a].canonKph);
  assert.deepEqual(byGame.map((id) => ZOIDS[id].canonKph), byCanon.map((id) => ZOIDS[id].canonKph));
  assert.equal(byGame[0], "berserkFuhrer");
  assert.equal(byGame[byGame.length - 1], "gojulas");
});

check("tonnage zones still slow speed and acceleration after upgrades", () => {
  const d = ZOIDS.shieldLiger;
  const light = perfAt("shieldLiger", 3, d.baseWeight);
  const heavy = perfAt("shieldLiger", 3, d.maxTonnage * 1.1);
  assert.ok(heavy.speed < light.speed);
  assert.ok(heavy.accel < light.accel);
  assert.ok(zeroTo100(heavy) > zeroTo100(light));
});

check("acceleration: Command Wolf and Zaber Fang highest, heavies slowest", () => {
  const acc = (id) => ZOIDS[id].accel;
  const top = Math.max(...ZOID_ORDER.map(acc));
  assert.equal(acc("commandWolf"), top);
  assert.equal(acc("zaberFang"), top);
  for (const id of ZOID_ORDER) if (id !== "commandWolf" && id !== "zaberFang") assert.ok(acc(id) < top, id);
  for (const slow of ["ironKong", "elephander", "molga"]) for (const quick of ["bladeLiger", "berserkFuhrer"]) assert.ok(acc(slow) < acc(quick));
  for (const id of ZOID_ORDER) assert.ok(ZOIDS[id].brake > ZOIDS[id].accel);
  assert.ok(ZOIDS.pteras.flight.thrust > 0);
});

check("display units: km/h and mph", () => {
  near(displaySpeed(100 * SPEED_SCALE, "kmh"), 100);
  near(displaySpeed(100 * SPEED_SCALE, "mph"), 62);
  near(displayKph(250, "mph"), 155);
});

console.log(`speed tests passed: ${passed}`);
