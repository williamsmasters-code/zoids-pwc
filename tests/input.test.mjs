// Weapon selection input (fire / alt / wheel / 1-9). No DOM library. Run with: node tests/input.test.mjs

import assert from "node:assert/strict";
import { createInput } from "../js/input.js";
import { weaponWantsShot } from "../js/combat.js";

function createTarget() {
  const map = new Map();
  return {
    addEventListener(type, fn, capture) {
      const key = `${type}:${(capture && typeof capture === "object" ? capture.capture : capture) ? 1 : 0}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(fn);
    },
    removeEventListener(type, fn, capture) {
      const key = `${type}:${(capture && typeof capture === "object" ? capture.capture : capture) ? 1 : 0}`;
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

// Selected-weapon model: LMB is `fire`, RMB is `alt` (scope zoom on a sniper
// weapon, else a second trigger). Keyboard / mouse never set legacy groups.
assert.equal(mouse("mousedown", 2), true, "right mouse should preventDefault");
{
  const r = input.read();
  assert.equal(r.alt, true, "RMB is alt");
  assert.equal(r.fire, false);
  assert.deepEqual(r.groups, [false, false, false, false], "no legacy groups from the mouse");
}
mouse("mouseup", 2);
assert.equal(input.read().alt, false);

assert.equal(mouse("mousedown", 0), false);
assert.equal(input.read().fire, true, "LMB fires the selected weapon");
mouse("mouseup", 0);
assert.equal(input.read().fire, false);

// Number keys: a one-shot select edge 1-9, not a held group.
for (let i = 1; i <= 9; i++) {
  key(`Digit${i}`, "keydown");
  const r = input.read();
  assert.equal(r.select, i, `Digit${i} selects slot ${i}`);
  assert.equal(r.groups.filter(Boolean).length, 0);
  assert.equal(input.read().select, null, "select edge clears after a read");
  key(`Digit${i}`, "keyup");
}

// Mouse wheel: down = +1 (next), up = -1 (previous); 100 px per step, page
// scroll prevented, steps accumulate until read.
{
  let prevented = 0;
  const wheelEvt = (deltaY, deltaMode = 0) => windowTarget.dispatch("wheel", { deltaY, deltaMode, preventDefault() { prevented += 1; } }, false);
  wheelEvt(100);
  assert.equal(input.read().wheel, 1, "wheel down = next");
  assert.equal(input.read().wheel, 0, "wheel clears after a read");
  wheelEvt(-100);
  assert.equal(input.read().wheel, -1, "wheel up = previous");
  wheelEvt(100); wheelEvt(100);
  assert.equal(input.read().wheel, 2, "two notches = two steps");
  wheelEvt(20);
  assert.equal(input.read().wheel, 0, "a tiny trackpad delta is not a step");
  assert.ok(prevented >= 5, "wheel does not scroll the page in battle");
}

// weaponWantsShot still gates on the trigger it is given.
{
  const weapon = { cooldown: 0, charge: 0, charging: false, rate: 4 };
  assert.equal(weaponWantsShot(weapon, 1 / 60, true, true), true, "held trigger fires");
  assert.ok(weapon.cooldown > 0);
  const idle = { cooldown: 0, charge: 0, charging: false, rate: 4 };
  assert.equal(weaponWantsShot(idle, 1 / 60, false, true), false, "released trigger does not");
}

windowTarget.dispatch("mousemove", { movementX: 8, movementY: -3 }, false);
assert.equal(input.read().dx, 0, "look ignored without pointer lock");
document.pointerLockElement = {};
windowTarget.dispatch("mousemove", { movementX: 8, movementY: -3 }, false);
const look = input.read();
assert.equal(look.dx, 8);
assert.equal(look.dy, -3);

key("KeyQ", "keydown");
assert.equal(input.read().skill, true, "Q edges the active skill");
assert.equal(input.read().skill, false, "skill edge clears after a read");
key("KeyQ", "keyup");

input.unmount();
assert.equal(documentTarget.listenerCount("mousedown", true), 0);
assert.equal(documentTarget.listenerCount("contextmenu", true), 0);
assert.equal(canvas.listenerCount("contextmenu", true), 0);
assert.equal(windowTarget.listenerCount("wheel"), 0, "wheel listener removed on unmount");

console.log("input tests ok");
