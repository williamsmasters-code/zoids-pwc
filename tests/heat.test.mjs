// Per-weapon heat. One gun can lock without stopping the others.

import assert from "node:assert/strict";
import { ZOIDS } from "../js/catalog.js";
import { createParts } from "../js/damage.js";
import {
  HEAT_MAX,
  HEAT_UNLOCK,
  addWeaponHeat,
  coolWeapon,
  canOperateWeapon,
  groupHeatState,
} from "../js/combat.js";

const parts = createParts(ZOIDS.shieldLiger);
const unit = { alive: true, parts, def: ZOIDS.shieldLiger };

function gun(mount, heat, cooling) {
  return {
    id: mount,
    name: mount,
    mount,
    heat,
    cooling,
    heatGauge: 0,
    overheated: false,
    cooldown: 0,
    charging: false,
  };
}

const pulse = gun("headWeapon", 6, 22);
const beam = gun("leftWeapon", 18, 12);

assert.equal(addWeaponHeat(pulse, 100), true);
assert.equal(pulse.heatGauge, HEAT_MAX);
assert.equal(pulse.overheated, true);
assert.equal(canOperateWeapon(unit, pulse), false);
assert.equal(beam.heatGauge, 0);
assert.equal(canOperateWeapon(unit, beam), true);

addWeaponHeat(beam, 18);
assert.equal(beam.overheated, false);
assert.equal(beam.heatGauge, 18);
assert.equal(pulse.heatGauge, 100);

coolWeapon(pulse, 1, 0);
assert.equal(pulse.heatGauge, 78);
assert.equal(pulse.overheated, true, "still locked above the unlock threshold");
assert.equal(beam.heatGauge, 18, "cooling one weapon leaves the other alone");

pulse.heatGauge = HEAT_UNLOCK + 1;
coolWeapon(pulse, 0.2, 0);
assert.ok(pulse.heatGauge <= HEAT_UNLOCK);
assert.equal(pulse.overheated, false);
assert.equal(canOperateWeapon(unit, pulse), true);

const locked = gun("rightWeapon", 16, 9);
const idle = gun("backMount", 14, 10);
addWeaponHeat(locked, 100);
idle.cooldown = 0.2;
const mixed = groupHeatState([locked, idle], unit);
assert.equal(mixed.state, "cooling", "a hot partner does not lock the whole group");
assert.equal(groupHeatState([locked], unit).state, "overheated");
assert.equal(groupHeatState([], unit).state, "empty");

parts.leftWeapon.destroyed = true;
parts.leftWeapon.structure = 0;
assert.equal(groupHeatState([beam], unit).state, "disabled");
assert.equal(canOperateWeapon(unit, beam), false);
assert.equal(canOperateWeapon(unit, pulse), true);

console.log("heat tests ok");
