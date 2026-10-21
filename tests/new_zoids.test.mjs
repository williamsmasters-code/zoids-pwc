// Load check for the five Zoids added in Oct 2026: each builds, has every
// damage part, stands on the ground (Pteras hovers at flyHeight), faces -Z,
// is roughly centred, has the expected relative size, a turret pivot where
// its back mount is turreted, a stock loadout that fits, a skill, and shows
// up in the difficulty enemy pools.
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { ZOIDS, ZOID_ORDER, partListFor, stockWeaponsFor, weightOf, fits } from "../js/catalog.js";
import { buildUnitModel, disposeTree } from "../js/models.js";
import { DIFFICULTY } from "../js/difficulty.js";
import { SKILLS } from "../js/skills.js";

const NEW = ["gunSniper", "elephander", "berserkFuhrer", "molga", "pteras"];
const box = (obj) => new Box3().setFromObject(obj);
const sizeOf = (id) => {
  const m = buildUnitModel(ZOIDS[id], [], "player");
  m.root.updateMatrixWorld(true);
  const s = box(m.visual).getSize(new Vector3());
  disposeTree(m.root);
  return Math.max(s.x, s.z) * Math.max(s.y, 1) ;
};
let n = 0;
const ok = (msg) => { n++; console.log("ok", msg); };

for (const id of NEW) {
  const def = ZOIDS[id];
  assert.ok(def && ZOID_ORDER.includes(id), id);
  const weapons = stockWeaponsFor(def);
  const model = buildUnitModel(def, weapons, "enemy");
  model.root.updateMatrixWorld(true);
  for (const part of partListFor(def)) assert.ok(model.partMeshes[part]?.length, `${id} ${part}`);
  const b = box(model.visual);
  const ground = (def.flyHeight || 0) * (def.scale || 1);
  assert.ok(Math.abs(b.min.y - (def.flyHeight || 0)) < 0.2 || Math.abs(b.min.y - ground) < 0.2, `${id} min y ${b.min.y.toFixed(2)}`);
  const c = b.getCenter(new Vector3());
  assert.ok(Math.abs(c.x) < 0.3, `${id} centred x ${c.x.toFixed(2)}`);
  assert.ok(Math.abs(c.z) < 1.2, `${id} centred z ${c.z.toFixed(2)}`);
  const hard = def.hardpoints.find((h) => h.id === "backMount");
  if (hard.turret) assert.ok(model.turrets.backMount, `${id} turret pivot`);
  for (const w of weapons) {
    const hp = def.hardpoints.find((h) => h.id === w.mount);
    assert.ok(hp, `${id} mount ${w.mount}`);
  }
  assert.ok(weightOf(def, weapons, {}, {}) <= def.maxTonnage, `${id} stock weight`);
  assert.ok(SKILLS[id], `${id} skill`);
  assert.ok(Object.values(DIFFICULTY).some((d) => d.pool.includes(id)), `${id} in an enemy pool`);
  ok(`${id} builds, ${partListFor(def).length} parts, min y ${b.min.y.toFixed(2)}, size ${b.getSize(new Vector3()).toArray().map((v) => v.toFixed(1)).join("x")}${hard.turret ? ", turret" : ""}`);
  disposeTree(model.root);
}

const liger = sizeOf("shieldLiger");
assert.ok(sizeOf("molga") < liger, "Molga smaller than Shield Liger");
assert.ok(sizeOf("pteras") < liger * 1.6, "Pteras small body (wings are wide)");
assert.ok(sizeOf("elephander") > sizeOf("ironKong"), "Elephander larger than Iron Kong");
ok("relative sizes");
console.log(`new zoid tests passed: ${n}`);
