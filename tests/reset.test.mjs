// Company reset. No DOM. Run with: node tests/reset.test.mjs

import assert from "node:assert/strict";
import { ZOIDS, ZOID_ORDER, stockWeaponsFor } from "../js/catalog.js";
import { freshState, resetState, saveState, loadState, SAVE_KEY } from "../js/state.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(index) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();

const starter = freshState();
assert.equal(starter.money, 185000);
assert.equal(starter.inventory.length, 2);
assert.equal(starter.inventory[0].group, 1);
assert.equal(starter.inventory[1].group, 2);
assert.equal(starter.hangar.shieldLiger.equipped.headWeapon, "w1");
assert.equal(starter.hangar.shieldLiger.equipped.leftWeapon, "w2");

for (const id of ZOID_ORDER) {
  const weapons = stockWeaponsFor(ZOIDS[id], () => 0);
  if (weapons.length > 1) {
    assert.ok(weapons.some((weapon) => weapon.group === 2), `${id} has more than one weapon but no group 2`);
  }
}

const state = freshState();
state.money = 1234;
state.wins = 9;
state.reputation = 4;
state.missionsDone = 7;
state.contractSeed = 50;
state.selected = "commandWolf";
state.hangar.commandWolf.owned = true;
state.hangar.shieldLiger.condition = { core: { armor: 0, structure: 0 } };
state.inventory.push({ uid: "w9", type: "gatling", group: 3 });
saveState(state);
localStorage.setItem("zoidMercs.other", "x");
localStorage.setItem("unrelated", "keep");

const next = resetState();
assert.notEqual(next, state);
assert.equal(next.money, 185000);
assert.equal(next.wins, 0);
assert.equal(next.reputation, 0);
assert.equal(next.missionsDone, 0);
assert.equal(next.contractSeed, 1001);
assert.equal(next.selected, "shieldLiger");
assert.equal(next.hangar.commandWolf.owned, false);
assert.equal(next.hangar.shieldLiger.owned, true);
assert.equal(next.hangar.shieldLiger.condition, null);
assert.equal(next.hangar.shieldLiger.equipped.headWeapon, "w1");
assert.equal(next.hangar.shieldLiger.equipped.leftWeapon, "w2");
assert.equal(next.inventory.length, 2);
assert.equal(next.inventory[1].group, 2);
assert.equal(localStorage.getItem(SAVE_KEY), null);
assert.equal(localStorage.getItem("zoidMercs.other"), null);
assert.equal(localStorage.getItem("unrelated"), "keep");

const loaded = loadState();
assert.equal(loaded.money, 185000);
assert.equal(loaded.wins, 0);
assert.equal(loaded.hangar.commandWolf.owned, false);
assert.notEqual(loaded, next);

console.log("reset tests ok");
