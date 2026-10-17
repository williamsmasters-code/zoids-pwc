// Every Zoid has a passive and an active. Shield Liger blocks, locks, and holds fire.

import assert from "node:assert/strict";
import { ZOIDS, ZOID_ORDER } from "../js/catalog.js";
import { createParts, applyHit } from "../js/damage.js";
import {
  SKILLS,
  initSkill,
  activateSkill,
  tickSkill,
  weaponsLocked,
  shieldBlocks,
  resolveIncoming,
  skillSpeedMul,
  radarMul,
} from "../js/skills.js";

assert.equal(Object.keys(SKILLS).length, 8);
assert.equal(ZOID_ORDER.length, 8);
for (const id of ZOID_ORDER) {
  const spec = SKILLS[id];
  assert.ok(spec, id);
  assert.ok(spec.passive.name, `${id} passive`);
  assert.ok(spec.passive.blurb, `${id} passive blurb`);
  assert.ok(spec.active.name, `${id} active`);
  assert.ok(spec.active.blurb, `${id} active blurb`);
  assert.equal(spec.active.key, "Q");
  assert.ok(spec.active.cost, `${id} cost`);
  assert.ok(spec.active.kind, `${id} kind`);
  const names = new Set(ZOID_ORDER.map((other) => SKILLS[other].active.name));
  assert.equal(names.size, 8);
}

function shieldUnit() {
  return {
    alive: true,
    speed: 0,
    def: ZOIDS.shieldLiger,
    skill: initSkill("shieldLiger"),
    parts: createParts(ZOIDS.shieldLiger),
  };
}

const unit = shieldUnit();
assert.equal(weaponsLocked(unit), false);
assert.equal(activateSkill(unit).type, "shield-on");
assert.equal(unit.skill.active, true);
assert.equal(weaponsLocked(unit), true);
assert.equal(shieldBlocks(unit, 0.5), true);
assert.equal(shieldBlocks(unit, 0.35), false);
assert.equal(shieldBlocks(unit, -0.2), false);
const blocked = resolveIncoming(unit, 40, 0.8);
assert.equal(blocked.blocked, true);
assert.equal(blocked.amount, 0);
const rear = resolveIncoming(unit, 40, -0.4);
assert.equal(rear.blocked, false);
assert.equal(rear.amount, 40);

tickSkill(unit, 2);
assert.equal(unit.skill.heat, 72);
assert.equal(unit.skill.active, true);
const lock = tickSkill(unit, 1);
assert.equal(lock.type, "lockout");
assert.equal(unit.skill.active, false);
assert.equal(unit.skill.overheated, true);
assert.equal(unit.skill.heat, 100);
assert.equal(weaponsLocked(unit), false);
assert.equal(activateSkill(unit).ok, false);

tickSkill(unit, 2.5);
assert.equal(unit.skill.cooldown, 0);
assert.ok(unit.skill.heat > 55);
assert.equal(unit.skill.overheated, true);
assert.equal(activateSkill(unit).reason, "locked");
tickSkill(unit, 0.5);
assert.ok(unit.skill.heat <= 55);
assert.equal(unit.skill.overheated, false);
assert.equal(activateSkill(unit).type, "shield-on");
assert.equal(activateSkill(unit).type, "shield-off");

const plate = createParts(ZOIDS.shieldLiger);
const front = applyHit(plate, "core", 30, { zoidId: "shieldLiger", forwardDot: 0.5 });
assert.ok(front.events.some((event) => event.type === "shield"));
const open = createParts(ZOIDS.shieldLiger);
applyHit(open, "core", 30, { zoidId: "shieldLiger", forwardDot: 0 });
assert.ok(open.core.armor < plate.core.armor);

const fang = { alive: true, speed: 0, def: ZOIDS.zaberFang, skill: initSkill("zaberFang") };
assert.equal(skillSpeedMul(fang), 1.12);
activateSkill(fang);
assert.ok(Math.abs(skillSpeedMul(fang) - 1.12 * 1.55) < 1e-6);

const wolf = { alive: true, speed: 0, def: ZOIDS.commandWolf, skill: initSkill("commandWolf") };
assert.equal(radarMul(wolf), 1.35);
activateSkill(wolf);
assert.equal(radarMul(wolf), 1.35 * 2);

const kong = { alive: true, speed: 0, def: ZOIDS.ironKong, skill: initSkill("ironKong") };
assert.ok(Math.abs(resolveIncoming(kong, 100, 0).amount - 90) < 1e-6);
activateSkill(kong);
assert.ok(Math.abs(resolveIncoming(kong, 100, 0).amount - 72) < 1e-6);

const saurer = { alive: true, speed: 0, def: ZOIDS.deathSaurer, skill: initSkill("deathSaurer") };
assert.ok(Math.abs(resolveIncoming(saurer, 100, 0).amount - 82) < 1e-6);

console.log("skills tests ok");
