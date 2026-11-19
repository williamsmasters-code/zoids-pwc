// Targeting overhaul math (js/targeting.js), standard melee catalog and the
// range-scaled missile pop. No browser. Run with: node tests/targeting.test.mjs

import assert from "node:assert/strict";
import { HIT, buildHitBoxes, boundsOf, insideBox, centerOfMass, rayBox, rayHitBoxes, toLocal, toWorld, dirToLocal, assistAim, assistRadii, boxVolume } from "../js/targeting.js";
import { ZOIDS, ZOID_ORDER, STANDARD_MELEE, MELEE_STYLES, MELEE_TUNE, standardMeleeFor } from "../js/catalog.js";
import { rocketPopFor, rocketDiveBiasFor, ROCKET_POP_TIME } from "../js/ballistics.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const box = (partId, x0, y0, z0, x1, y1, z1) => ({ partId, min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });

// 1) A Gun Sniper-like sliver: 0.4 m wide core high on two thin legs.
{
  const r = 2.3;
  const meshes = [
    box("core", -0.2, 1.2, -0.6, 0.2, 1.7, 0.6),
    box("head", -0.15, 1.6, -1.1, 0.15, 1.9, -0.6),
    box("leftLeg", -0.3, 0, -0.1, -0.2, 1.2, 0.1),
    box("rightLeg", 0.2, 0, -0.1, 0.3, 1.2, 0.1),
    box("tail", -0.05, 1.3, 0.6, 0.05, 1.5, 2.2),
    box("backMount", -0.03, 1.8, -0.2, 0.03, 1.86, 1.0),
  ];
  const boxes = buildHitBoxes(meshes, r);
  const core = boxes.find((b) => b.partId === "core");
  assert.ok(core.max.x - core.min.x >= r * HIT.coreMinWidth - 1e-9, "thin core widened to the floor width");
  assert.ok(core.max.z - core.min.z >= r * HIT.coreMinDepth - 1e-9);
  assert.ok(core.min.y >= 0 - 1e-9, "widened core never sinks below the model's lowest point");
  const rod = boxes.find((b) => b.partId === "backMount");
  for (const k of ["x", "y", "z"]) assert.ok(rod.max[k] - rod.min[k] >= HIT.minThick - 1e-9, `thin rod padded to minThick on ${k}`);
  const legL = boxes.find((b) => b.partId === "leftLeg");
  assert.ok(near(legL.min.x, -0.3 - HIT.pad), "every mesh box padded");
  const cm = centerOfMass(boxes);
  assert.ok(boxes.some((b) => (b.partId === "core" || b.partId === "head") && insideBox(b, cm)), "centre of mass inside the core/head");
  assert.ok(cm.y > 1.1 && cm.y < 1.8, `centre of mass at body height (${cm.y})`);
  const all = boundsOf(boxes);
  assert.ok(all.min.y <= 0 && all.max.y >= 1.9);
  // A level shot at the centre of mass from 50 m ahead hits the body.
  const hit = rayHitBoxes({ x: 0, y: cm.y, z: -50 }, { x: 0, y: 0, z: 1 }, boxes);
  assert.ok(hit && (hit.partId === "core" || hit.partId === "head"), "level shot at the centre of mass hits the body");
  // 0.5 m off to the side still hits the widened core (spread tolerance).
  assert.ok(rayHitBoxes({ x: 0.5, y: cm.y, z: -50 }, { x: 0, y: 0, z: 1 }, boxes), "0.5 m off-centre still hits");
  assert.equal(rayHitBoxes({ x: 3, y: cm.y, z: -50 }, { x: 0, y: 0, z: 1 }, boxes), null, "3 m off misses");
}

// 2) Big Zoids keep their own volume (the floor does not inflate them).
{
  const meshes = [box("core", -2.2, 1, -2.5, 2.2, 4, 2.5)];
  const before = boxVolume(box("core", -2.2 - HIT.pad, 1 - HIT.pad, -2.5 - HIT.pad, 2.2 + HIT.pad, 4 + HIT.pad, 2.5 + HIT.pad));
  const boxes = buildHitBoxes(meshes, 4.5);
  assert.ok(near(boxVolume(boxes[0]), before, 1e-6), "big core is only padded");
}

// 3) Contained duplicates of the same part are dropped; other parts kept.
{
  const boxes = buildHitBoxes([box("core", -1, 0, -1, 1, 2, 1), box("core", -0.2, 0.5, -0.2, 0.2, 0.9, 0.2), box("head", -0.2, 0.5, -0.2, 0.2, 0.9, 0.2)], 2);
  assert.equal(boxes.filter((b) => b.partId === "core").length, 1);
  assert.equal(boxes.filter((b) => b.partId === "head").length, 1);
}

// 4) Centre of mass in a gap is pulled inside the nearest core/head box.
{
  const boxes = [box("core", -3, 0, -1, -2, 1, 1), box("core", 2, 0, -1, 3, 1, 1)];
  const cm = centerOfMass(boxes);
  assert.ok(boxes.some((b) => insideBox(b, cm)), "centre of mass moved off the empty middle");
}

// 5) Ray / box.
{
  const b = box("core", -1, -1, -1, 1, 1, 1);
  assert.ok(near(rayBox({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, b), 4));
  assert.equal(rayBox({ x: 0, y: 3, z: -5 }, { x: 0, y: 0, z: 1 }, b), null);
  assert.equal(rayBox({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 1 }, b, 3), null, "beyond max distance");
  assert.equal(rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, b), 0, "origin inside");
}

// 6) Frames: world <-> root round-trips for any yaw; -Z local is forward.
for (const yaw of [0, 0.7, -2.1, Math.PI]) {
  const root = { x: 10, y: 2, z: -4, yaw };
  const p = { x: 3.2, y: 1.1, z: -7.5 };
  const back = toWorld(toLocal(p, root), root);
  assert.ok(near(back.x, p.x) && near(back.y, p.y) && near(back.z, p.z), `round trip yaw ${yaw}`);
  const fwdWorld = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  const fl = dirToLocal(fwdWorld, yaw);
  assert.ok(near(fl.x, 0) && near(fl.z, -1), `facing is local -Z at yaw ${yaw}`);
}

// 7) Aim assist: snap near the centre, range-only inside the box, off outside.
{
  const { snap, box: boxR } = assistRadii(2.3);
  assert.ok(snap > 0.6 && snap < 1, `Gun Sniper snap radius modest (${snap})`);
  assert.ok(boxR > snap);
  const c = { x: 0, y: 1.4, z: -60 };
  const o = { x: 0, y: 3, z: 0 };
  const dirTo = (p) => { const d = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z }; const L = Math.hypot(d.x, d.y, d.z); return { x: d.x / L, y: d.y / L, z: d.z / L }; };
  const a = assistAim(o, dirTo({ x: 0.4, y: 1.6, z: -60 }), c, snap, boxR);
  assert.equal(a.mode, "snap");
  assert.deepEqual(a.point, c);
  const b = assistAim(o, dirTo({ x: 1.4, y: 1.4, z: -60 }), c, snap, boxR);
  assert.equal(b.mode, "range", "inside the lock box keeps the player's line at the target range");
  assert.ok(near(Math.hypot(b.point.x - o.x, b.point.y - o.y, b.point.z - o.z), 60, 0.2));
  assert.equal(assistAim(o, dirTo({ x: 8, y: 1.4, z: -60 }), c, snap, boxR).mode, null, "far off: no assist");
  assert.equal(assistAim(o, { x: 0, y: 0, z: 1 }, c, snap, boxR).mode, null, "target behind: no assist");
}

// 8) Standard melee: every combat Zoid, canon names, reach 8-20 m, damage by weight.
{
  const rows = [];
  for (const id of ZOID_ORDER) {
    const def = ZOIDS[id];
    const w = standardMeleeFor(def);
    assert.ok(STANDARD_MELEE[id], `${id} has a standard melee entry`);
    assert.ok(w && w.innate && w.mount === "melee", `${id} melee is innate`);
    assert.equal(w.id, `melee:${id}`);
    assert.ok(MELEE_STYLES[w.style], `${id} style ${w.style}`);
    assert.ok(w.range >= 8 && w.range <= 20, `${id} reach ${w.range} in 8-20 m`);
    assert.ok(!w.ammo, "no ammo");
    assert.ok(w.heat > 0 && w.heat <= 6, `${id} low heat ${w.heat}`);
    assert.ok(w.rate > 0 && w.rate <= 1.5, `${id} has a cooldown (rate ${w.rate}/s)`);
    rows.push({ id, w: def.baseWeight, d: w.damage, name: w.name });
  }
  // Heavier Zoids hit harder (same style multiplier aside).
  const sorted = rows.filter((r) => r.id !== "bladeLiger").sort((a, b) => a.w - b.w);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].d >= sorted[i - 1].d - 1e-9, `melee damage grows with weight (${sorted[i - 1].id} ${sorted[i - 1].d} -> ${sorted[i].id} ${sorted[i].d})`);
  assert.equal(standardMeleeFor(ZOIDS.gunSniper).name, "Strike Kick");
  assert.equal(standardMeleeFor(ZOIDS.shieldLiger).name, "Strike Claw");
  assert.equal(standardMeleeFor(ZOIDS.gojulas).style, "tail");
  assert.ok(MELEE_TUNE.baseDamage > 0);
  console.log("melee", rows.map((r) => `${r.id}:${r.name}:${r.d.toFixed(1)}`).join(" "));
}

// 9) Missile pop and dive bias scale with launch range (close shots dive in
// time instead of climbing over a short target and into the ground).
{
  assert.ok(rocketPopFor(25) < rocketPopFor(150), "short launch pops less");
  assert.ok(rocketPopFor(25) >= 0.16 - 1e-9);
  assert.ok(rocketPopFor(400) <= ROCKET_POP_TIME + 1e-9, "never above the stock pop");
  assert.ok(rocketDiveBiasFor(25) < rocketDiveBiasFor(150));
  assert.ok(rocketDiveBiasFor(5) >= 4 && rocketDiveBiasFor(500) <= 22);
}

console.log("targeting tests ok");
