// Mount arcs (js/arcs.js): table coverage, clamp math, missile / charge /
// turret rules, and the free-look pitch limits in js/mission.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import { ZOIDS, WEAPONS } from "../js/catalog.js";
import { ARC_TABLE, weaponArc, clampToArc, pointInArc, ARC_TOLERANCE, ROCKET_ARC, CHARGE_ARC, arcDegrees } from "../js/arcs.js";
import { turretSpecFor } from "../js/turret.js";

const D = Math.PI / 180;
let n = 0;
const ok = (name) => { n++; console.log("ok", name); };
const MOUNTS = ["headWeapon", "leftWeapon", "rightWeapon", "backMount"];

// 1) Every playable Zoid has an arc for every hardpoint it has.
for (const [id, def] of Object.entries(ZOIDS)) {
  if (def.build === "turret" || def.layout === "vehicle" || def.immobile || !(def.hardpoints || []).length) continue;
  assert.ok(ARC_TABLE[id], `no arc row for ${id}`);
  for (const h of def.hardpoints) {
    const a = ARC_TABLE[id][h.id];
    assert.ok(Array.isArray(a) && a.length === 3, `${id}.${h.id} arc`);
    assert.ok(a[0] > 0 && a[0] <= 180 && a[1] >= 0 && a[1] <= 90 && a[2] >= 0 && a[2] <= 90, `${id}.${h.id} arc range ${a}`);
  }
}
ok("arc table covers every Zoid hardpoint");

// 2) Mount classes: chin guns narrow, back turrets wide and high.
for (const [id, row] of Object.entries(ARC_TABLE)) {
  if (id === "elephander") continue; // trunk claw swings
  assert.ok(row.headWeapon[0] <= 20 && row.headWeapon[1] <= 25, `${id} head arc should be a narrow forward cone`);
}
for (const id of ["gunSniper", "commandWolf", "shieldLiger", "gojulas", "ironKong"]) {
  const def = ZOIDS[id];
  const w = { mount: "backMount", delivery: "ballistic" };
  w.turret = turretSpecFor(def, w);
  const arc = weaponArc(def, w);
  assert.ok(arc.yaw >= 45 * D - 1e-9, `${id} back mount traverse ${arc.yaw / D}`);
  assert.ok(arc.up >= 55 * D - 1e-9, `${id} back mount elevation ${arc.up / D}`);
  const head = weaponArc(def, { mount: "headWeapon", delivery: "beam" });
  assert.ok(arc.up > head.up && arc.yaw > head.yaw, `${id} back wider than chin`);
}
// Gun Sniper tail rifle: wide traverse (catalog turret arc PI, +/-90).
assert.equal(Math.round(weaponArc(ZOIDS.gunSniper, { mount: "backMount", turret: turretSpecFor(ZOIDS.gunSniper, { mount: "backMount" }) }).yaw / D), 90);
ok("chin guns narrow, back mounts wide and high");

// 3) Missiles widen, charge weapons narrow, melee is a front arc.
const rocket = weaponArc(ZOIDS.shieldLiger, { mount: "headWeapon", delivery: "rocket" });
assert.ok(rocket.yaw >= ROCKET_ARC[0] * D - 1e-9 && rocket.up >= ROCKET_ARC[1] * D - 1e-9 && rocket.kind === "missile");
const charge = weaponArc(ZOIDS.genoSaurer, { mount: "backMount", ...WEAPONS.chargedParticle });
assert.ok(charge.yaw <= CHARGE_ARC[0] * D + 1e-9 && charge.up <= CHARGE_ARC[1] * D + 1e-9 && charge.kind === "braced");
const melee = weaponArc(ZOIDS.ironKong, { innate: true, mount: "headWeapon" });
assert.equal(melee.kind, "melee");
ok("missile / charge / melee arcs");

// 4) clampToArc: inside passes through; outside stops at the edge.
const arc = { yaw: 30 * D, up: 20 * D, down: 25 * D };
const dir = (yawDeg, elevDeg) => { const y = yawDeg * D, e = elevDeg * D; return { x: -Math.sin(y) * Math.cos(e), y: Math.sin(e), z: -Math.cos(y) * Math.cos(e) }; };
let r = clampToArc(0, dir(10, 10), arc);
assert.equal(r.out, false);
assert.ok(Math.abs(Math.asin(r.dir.y) - 10 * D) < 1e-9);
r = clampToArc(0, dir(0, 50), arc);
assert.equal(r.out, true);
assert.ok(Math.abs(Math.asin(r.dir.y) - 20 * D) < 1e-9, "elevation clamps to the top of the arc");
r = clampToArc(0, dir(80, 0), arc);
assert.equal(r.out, true);
assert.ok(Math.abs(Math.atan2(-r.dir.x, -r.dir.z) - 30 * D) < 1e-9, "traverse clamps to the edge");
// Chassis yaw is respected (a chassis facing +90 deg, aim at +100 deg is fine).
assert.equal(clampToArc(90 * D, dir(100, 0), arc).out, false);
// Tolerance: just over the edge still counts as in arc.
assert.equal(clampToArc(0, dir(0, 20 + (ARC_TOLERANCE / D) * 0.5), arc).out, false);
// Full traverse never clamps yaw.
assert.equal(clampToArc(0, dir(179, 0), { yaw: Math.PI, up: 1, down: 1 }).out, false);
// pointInArc from a mount position: a flyer 40 m up, 40 m out = 45 deg.
assert.equal(pointInArc(0, { x: 0, y: 2, z: 0 }, { x: 0, y: 42, z: -40 }, arc), false);
assert.equal(pointInArc(0, { x: 0, y: 2, z: 0 }, { x: 0, y: 42, z: -40 }, weaponArc(ZOIDS.ironKong, { mount: "leftWeapon" })), true);
ok("clampToArc and pointInArc");

// 5) arcDegrees for the docs table.
assert.deepEqual(arcDegrees(weaponArc(ZOIDS.commandWolf, { mount: "headWeapon" })), { yaw: 15, up: 15, down: 25, kind: "forward" });
ok("arcDegrees");

// 6) Free look: the mission's view pitch limits allow looking well up.
const src = fs.readFileSync(new URL("../js/mission.js", import.meta.url), "utf8");
const up = Number((src.match(/const PITCH_UP = ([0-9.]+)/) || [])[1]);
const down = Number((src.match(/const PITCH_DOWN = (-[0-9.]+)/) || [])[1]);
assert.ok(up >= 1.0 && up <= 1.45, `PITCH_UP ${up}`);
assert.ok(down <= -0.6, `PITCH_DOWN ${down}`);
assert.ok(/lookPitch - input\.dy \* 0\.002 \* sens, PITCH_DOWN, PITCH_UP/.test(src), "mouse look clamps to PITCH_DOWN..PITCH_UP");
assert.ok(!/clampAimYaw\(chassisFwd/.test(src), "old AI-only yaw clamp is gone (arcs for everyone)");
ok("free look pitch limits");

console.log(`arcs tests ok (${n})`);
