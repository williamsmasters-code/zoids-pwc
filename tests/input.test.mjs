// Weapon-group input. No DOM library. Run with: node tests/input.test.mjs

import assert from "node:assert/strict";
import { createInput } from "../js/input.js";
import { weaponWantsShot } from "../js/combat.js";

function createTarget() {
  const map = new Map();
  return {
    addEventListener(type, fn, capture) {
      const key = `${type}:${capture ? 1 : 0}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const key = `${type}:${capture ? 1 : 0}`;
      const list = map.get(key) || [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event, capture = false) {
      const key = `${type}:${capture ? 1 : 0}`;
      for (const fn of [...(map.get(key) || [])]) fn(event);
    },
    listenerCount(type, capture = false) {
      return (map.get(`${type}:${capture ? 1 : 0}`) || []).length;
    },
  };
}

const windowTarget = createTarget();
const documentTarget = createTarget();
const canvas = createTarget();
globalThis.window = windowTarget;
globalThis.document = documentTarget;
document.pointerLockElement = null;

function key(code, type) {
  windowTarget.dispatch(type, { code, repeat: false, preventDefault() {} }, false);
}

function mouse(type, button) {
  let prevented = false;
  documentTarget.dispatch(type, {
    button,
    preventDefault() { prevented = true; },
  }, true);
  return prevented;
}

const input = createInput();
input.mount(canvas);

let menuPrevented = 0;
const menu = { preventDefault() { menuPrevented += 1; } };
documentTarget.dispatch("contextmenu", menu, true);
windowTarget.dispatch("contextmenu", menu, true);
canvas.dispatch("contextmenu", menu, true);
assert.equal(menuPrevented, 3, "context menu was not cancelled on document, window, and canvas");

assert.equal(mouse("mousedown", 2), true, "right mouse should preventDefault");
assert.deepEqual(input.read().groups, [false, true, false, false]);
mouse("mouseup", 2);
assert.equal(input.read().groups[1], false);

assert.equal(mouse("mousedown", 0), false);
assert.equal(input.read().groups[0], true);
mouse("mouseup", 0);
assert.equal(input.read().groups[0], false);

assert.equal(document.pointerLockElement, null);
assert.equal(mouse("mousedown", 2), true);
assert.equal(input.read().groups[1], true);
mouse("mouseup", 2);

const codes = ["Digit1", "Digit2", "Digit3", "Digit4"];
for (let i = 0; i < 4; i++) {
  for (const code of codes) key(code, "keyup");
  key(codes[i], "keydown");
  const groups = input.read().groups;
  assert.equal(groups.filter(Boolean).length, 1, `only group ${i + 1} is held`);
  assert.equal(groups[i], true);
  const weapon = { cooldown: 0, charge: 0, charging: false, rate: 4 };
  assert.equal(weaponWantsShot(weapon, 1 / 60, groups[i], true), true, `group ${i + 1} fires`);
  assert.ok(weapon.cooldown > 0);
  const idle = { cooldown: 0, charge: 0, charging: false, rate: 4 };
  assert.equal(weaponWantsShot(idle, 1 / 60, groups[(i + 1) % 4], true), false);
  key(codes[i], "keyup");
}

mouse("mousedown", 2);
{
  const groups = input.read().groups;
  const weapon = { cooldown: 0, charge: 0, charging: false, rate: 4 };
  assert.equal(groups[1], true);
  assert.equal(weaponWantsShot(weapon, 1 / 60, groups[1], true), true, "right mouse fires group 2");
}
mouse("mouseup", 2);

windowTarget.dispatch("mousemove", { movementX: 8, movementY: -3 }, false);
assert.equal(input.read().dx, 0, "look ignored without pointer lock");
document.pointerLockElement = {};
windowTarget.dispatch("mousemove", { movementX: 8, movementY: -3 }, false);
const look = input.read();
assert.equal(look.dx, 8);
assert.equal(look.dy, -3);

input.unmount();
assert.equal(documentTarget.listenerCount("mousedown", true), 0);
assert.equal(documentTarget.listenerCount("contextmenu", true), 0);
assert.equal(canvas.listenerCount("contextmenu", true), 0);

console.log("input tests ok");
