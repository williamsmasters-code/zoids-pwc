// Weapons overhaul (js/weaponsys.js): fire modes and rates, spread bloom,
// ballistic zeroing / drop / holdover, damage falloff, beam refraction
// through hazards, targeting area and lock rules, missile arming. Plus the
// save fix (3rd Speed Booster survives a reload). No DOM.
import assert from "node:assert/strict";
import { BIOME_IDS, createField, LOOKS } from "../js/battlefield.js";
import { WEAPONS, MODS } from "../js/catalog.js";
import { stepBallistic } from "../js/ballistics.js";
import { rangeDamageMul } from "../js/rangebands.js";
import { aiTuning } from "../js/difficulty.js";
import {
  TARGET_BOX_DEG, LOCK_LOSS_GRACE, LOCK_BLOCK_PATH, MIN_TRANSMISSION, MAX_REFRACT, MISSILE_UNARMED_MUL,
  angleDeg, sensorRange, inSensor, pickUnderReticle, pickNearest, cycleTargets, stepTargetLock, lockConeOf,
  fireModeOf, burstOf, heatPerShot, stepFireControl, shotSpread, addBloom, recoverBloom,
  zeroedDir, impactAt, zeroedImpact, zeroOf, holdoverPoint,
  rayCylinder, hazardPath, beamTransmission, refractAngle, bendDir, lockBlocked, insideHazard, placeHazards,
  missileArmed, HAZARD_KINDS,
} from "../js/weaponsys.js";

let n = 0;
const ok = (m) => { n++; console.log("ok", m); };
const fresh = (id) => ({ ...WEAPONS[id], cooldown: 0, spin: 0, bloomNow: 0, burstLeft: 0, burstTimer: 0 });
// Hold the trigger for `secs` at 60 Hz; return shot times.
function hold(w, secs, dt = 1 / 60) {
  const times = [];
  for (let t = 0; t < secs - 1e-9; t += dt) {
    const shots = stepFireControl(w, dt, true, true);
    for (let k = 0; k < shots; k++) times.push(t);
  }
  return times;
}

// ---------- fire modes and rates ----------
assert.equal(fireModeOf(WEAPONS.gatling), "auto");
assert.equal(fireModeOf(WEAPONS.pulseLaser), "pulse");
assert.equal(fireModeOf(WEAPONS.beamCannon), "beam");
assert.equal(fireModeOf(WEAPONS.doubleBeamCannon), "beam");
assert.equal(fireModeOf(WEAPONS.missilePack), "salvo");
assert.equal(fireModeOf(WEAPONS.shockCannon), "single");
assert.equal(fireModeOf(WEAPONS.sniperRifle), "single");
assert.equal(fireModeOf(WEAPONS.chargedParticle), "charge");
assert.equal(fireModeOf(WEAPONS.laserBlade), "melee");
ok("every weapon has a fire mode: auto, pulse, beam, salvo, single, charge, melee");

{
  const g = fresh("gatling");
  const first = hold(g, 0.5).length;
  const warm = hold(g, 2).length / 2; // already spun up
  assert.ok(first < 0.5 * 16 * 0.85, `gatling starts slow (spin-up): ${first} shots in 0.5 s`);
  assert.ok(Math.abs(warm - 16) <= 1, `gatling spun up fires 16/s: ${warm}`);
  for (let i = 0; i < 120; i++) stepFireControl(g, 1 / 60, false, true);
  assert.equal(g.spin, 0, "gatling spins down when released");
  ok(`gatling spins up from 35% (${first} rounds in the first 0.5 s) to 16 rounds/s (${warm}/s warm)`);
}
{
  const p = fresh("pulseLaser");
  const t = hold(p, 1.95);
  assert.equal(burstOf(p), 3);
  assert.equal(t.length, 15, `pulse laser 2.5 cycles/s x 3 pulses = 15 in 1.95 s, got ${t.length}`);
  assert.ok(t[1] - t[0] > 0.05 && t[1] - t[0] < 0.1, "pulses 0.07 s apart");
  assert.ok(t[3] - t[0] > 0.38, "cycle gap 0.4 s");
  const dps = p.damage * burstOf(p) * p.rate;
  assert.ok(Math.abs(dps - 33.75) < 1e-9, "pulse laser keeps the old 33.75 DPS");
  assert.ok(Math.abs(heatPerShot(p) * 3 * p.rate - 52.5) < 1e-9, "and the old 52.5 heat/s");
  // A burst finishes after the trigger is released.
  const q = fresh("pulseLaser");
  let shots = stepFireControl(q, 1 / 60, true, true);
  for (let i = 0; i < 20; i++) shots += stepFireControl(q, 1 / 60, false, true);
  assert.equal(shots, 3, "a pulse burst completes once started");
  ok("pulse laser: 3-pulse bursts 0.07 s apart, 2.5 bursts/s, same DPS and heat as before; bursts complete");
}
{
  const m = fresh("missilePack");
  const t = hold(m, 2.4);
  assert.equal(t.length, 4, `one salvo of 4 in 2.5 s cycle, got ${t.length}`);
  assert.ok(Math.abs(t[3] - t[0] - 0.42) < 0.05, `salvo ripples over ~0.42 s: ${t[3] - t[0]}`);
  assert.ok(Math.abs(heatPerShot(m) - 3) < 1e-9, "salvo heat split per missile");
  ok("missile pack: 4-missile salvo rippled 0.14 s apart, one salvo per 2.5 s");
}
for (const [id, rate] of [["shockCannon", 0.5], ["sniperRifle", 0.55], ["beamCannon", 1.4]]) {
  const w = fresh(id);
  const t = hold(w, 10);
  assert.ok(Math.abs(t.length - Math.ceil(10 * rate)) <= 1, `${id} ${t.length} shots in 10 s`);
}
{
  const ai = fresh("shockCannon");
  ai.rateMul = 1.2;
  assert.ok(hold(ai, 10).length > hold(fresh("shockCannon"), 10).length, "AI fireRate multiplier speeds the cycle");
  const lost = fresh("pulseLaser");
  stepFireControl(lost, 1 / 60, true, true);
  stepFireControl(lost, 1 / 60, true, false);
  assert.equal(lost.burstLeft, 0, "losing the weapon (overheat / dead mount) cancels the rest of a burst");
}
ok("single shots: shock cannon 0.5/s, sniper 0.55/s, beam cannon 1.4 beams/s; AI rate multiplier applies; a lost weapon drops its burst");
assert.ok(WEAPONS.beamCannon.beamTime > 0.3 && WEAPONS.beamCannon.beamTime < 1 / WEAPONS.beamCannon.rate);
ok(`sustained beam: beam cannon holds its beam ${WEAPONS.beamCannon.beamTime} s of every ${(1 / WEAPONS.beamCannon.rate).toFixed(2)} s cycle`);

// ---------- spread ----------
{
  const g = fresh("gatling");
  const base = shotSpread(g, {});
  for (let i = 0; i < 40; i++) addBloom(g);
  const bloomed = shotSpread(g, {});
  assert.ok(Math.abs(g.bloomNow - g.bloom.max) < 1e-9, "bloom caps");
  assert.ok(bloomed > base * 2, `sustained fire blooms gatling spread: ${base.toFixed(3)} -> ${bloomed.toFixed(3)}`);
  for (let i = 0; i < 120; i++) recoverBloom(g, 1 / 60);
  assert.ok(g.bloomNow < g.bloom.max * 0.1, "bloom recovers when you stop");
  const s = fresh("sniperRifle");
  const still = shotSpread(s, { speedFrac: 0 });
  const running = shotSpread(s, { speedFrac: 1 });
  assert.ok(running > still * 5, `moving ruins the sniper: ${still} -> ${running}`);
  const b = fresh("pulseLaser");
  assert.ok(shotSpread(b, { speedFrac: 1 }) < shotSpread(fresh("gatling"), { speedFrac: 1 }), "beams hold accuracy on the move better than guns");
  assert.ok(shotSpread(b, { heatFrac: 1 }) > shotSpread(b, { heatFrac: 0.5 }), "heat haze above 60% heat widens spread");
  assert.equal(shotSpread(b, { heatFrac: 0.5 }), shotSpread(b, {}), "no haze below 60%");
  ok(`spread: gatling blooms ${base.toFixed(3)} -> ${bloomed.toFixed(3)} rad and recovers; sniper x${(running / still).toFixed(1)} on the move; heat haze over 60%`);
}

// ---------- ballistic zeroing, drop, holdover ----------
function fly(muzzle, dir, speed, gravity, horizontal) {
  const p = { ox: muzzle.x, oy: muzzle.y, oz: muzzle.z, vx0: dir.x * speed, vy0: dir.y * speed, vz0: dir.z * speed, gravity, life: 10 };
  const h = () => Math.hypot(p.x - muzzle.x, p.z - muzzle.z);
  p.x = muzzle.x; p.y = muzzle.y; p.z = muzzle.z;
  while (h() < horizontal) stepBallistic(p, 1 / 600);
  return p;
}
{
  const muzzle = { x: 0, y: 3, z: 0 };
  const results = [];
  for (const id of ["gatling", "shockCannon", "sniperRifle"]) {
    const w = WEAPONS[id];
    const z = zeroOf(w);
    assert.equal(z, w.optimal, `${id} zeroed at its optimal range`);
    // Inside zero: the shell meets the aim point.
    const near = { x: 0, y: 3, z: -z * 0.8 };
    const inside = zeroedImpact(muzzle, near, w);
    assert.ok(Math.abs(inside.drop) < 0.05, `${id} inside zero hits the crosshair (${inside.drop})`);
    // Past zero: drops, more with distance.
    const d1 = zeroedImpact(muzzle, { x: 0, y: 3, z: -(z + (w.range - z) * 0.5) }, w).drop;
    const d2 = zeroedImpact(muzzle, { x: 0, y: 3, z: -w.range }, w).drop;
    assert.ok(d1 > 0.1 && d2 > d1, `${id} drops past zero: ${d1.toFixed(2)} then ${d2.toFixed(2)} m`);
    // The analytic impact matches a stepped flight.
    const far = { x: 0, y: 3, z: -w.range };
    const sol = zeroedDir(muzzle, far, w.speed, w.gravity, z);
    const sim = fly(muzzle, sol.dir, w.speed, w.gravity, w.range);
    assert.ok(Math.abs(sim.y - (3 - d2)) < 0.15, `${id} stepped flight lands where the HUD says (${sim.y.toFixed(2)} vs ${(3 - d2).toFixed(2)})`);
    // Holdover: full skill lands on target, half skill about half the drop.
    const full = holdoverPoint(muzzle, far, w, 1);
    const fullHit = zeroedImpact(muzzle, full, w);
    assert.ok(Math.abs(fullHit.y - far.y) < 0.2, `${id} full holdover lands on the aim point (${(fullHit.y - far.y).toFixed(2)})`);
    const half = zeroedImpact(muzzle, holdoverPoint(muzzle, far, w, 0.5), w);
    const miss = far.y - half.y;
    assert.ok(miss > d2 * 0.3 && miss < d2 * 0.7, `${id} half holdover misses by about half (${miss.toFixed(2)} of ${d2.toFixed(2)})`);
    results.push(`${id} zero ${z} m, drop ${d1.toFixed(1)} m mid / ${d2.toFixed(1)} m at max`);
  }
  ok(`ballistics zeroed at optimal, drop past it: ${results.join("; ")}`);
  // Difficulty: holdover rises Green -> Ace.
  const hs = [1, 2, 3, 4, 5].map((l) => aiTuning(l).holdover);
  for (let i = 1; i < hs.length; i++) assert.ok(hs[i] > hs[i - 1]);
  assert.equal(hs[4], 1);
  ok(`AI holdover by difficulty ${hs.join(" / ")} (Green to Ace)`);
}

// ---------- damage falloff ----------
for (const id of ["pulseLaser", "beamCannon", "gatling", "shockCannon", "sniperRifle"]) {
  const w = WEAPONS[id];
  let prev = 1;
  for (let d = w.optimal; d <= w.range; d += 2) {
    const v = rangeDamageMul(w, d);
    assert.ok(v <= prev + 1e-9, `${id} never rises past optimal`);
    assert.ok(prev - v < 0.12, `${id} no cliff at ${d} m`);
    prev = v;
  }
  assert.equal(rangeDamageMul(w, w.range + 0.1), 0);
}
assert.ok(rangeDamageMul(WEAPONS.beamCannon, WEAPONS.beamCannon.range) < rangeDamageMul(WEAPONS.shockCannon, WEAPONS.shockCannon.range), "beams fade harder than shells at max range");
ok("damage falls smoothly past optimal to max range (no cliffs), zero beyond; beams fade harder than shells");

// ---------- hazards and refraction ----------
{
  const cloud = { kind: "dust", x: 0, z: -50, r: 10, y0: 0, h: 20 };
  const seg = rayCylinder({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 200, cloud);
  assert.ok(seg && Math.abs(seg[0] - 40) < 1e-6 && Math.abs(seg[1] - 60) < 1e-6, `ray crosses the cloud 40-60 m: ${seg}`);
  assert.equal(rayCylinder({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 30, cloud), null, "stops short of it");
  assert.equal(rayCylinder({ x: 0, y: 25, z: 0 }, { x: 0, y: 0, z: -1 }, 200, cloud), null, "passes over the top");
  assert.equal(rayCylinder({ x: 15, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 200, cloud), null, "passes beside it");
  const path = hazardPath({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 200, [cloud]);
  assert.ok(Math.abs(path.length - 20) < 1e-6 && path.first.t === 40 && path.kinds[0] === "dust");
  const tPulse = beamTransmission(path, WEAPONS.pulseLaser.refract);
  const tCpc = beamTransmission(path, WEAPONS.chargedParticle.refract);
  assert.ok(tPulse < 0.7 && tPulse > MIN_TRANSMISSION, `pulse laser through 20 m dust keeps ${tPulse.toFixed(2)}`);
  assert.ok(tCpc > tPulse && tCpc > 0.8, `particle beam punches through (${tCpc.toFixed(2)})`);
  assert.equal(beamTransmission(path, 0), 1, "refract 0 (shells) is unaffected");
  const thick = hazardPath({ x: 0, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 400, [cloud, { ...cloud, z: -90 }, { ...cloud, z: -130 }, { ...cloud, kind: "smoke", z: -170 }]);
  assert.ok(beamTransmission(thick, 1) >= MIN_TRANSMISSION - 1e-12, "transmission floors at MIN_TRANSMISSION");
  const ang = refractAngle(path, 1);
  assert.ok(ang > 0.02 && ang <= MAX_REFRACT, `beam bends ${ang.toFixed(3)} rad in 20 m of dust`);
  assert.ok(refractAngle(path, WEAPONS.chargedParticle.refract) < ang / 2);
  assert.ok(refractAngle(thick, 1) <= MAX_REFRACT + 1e-12, "bend is capped");
  const dir = { x: 0, y: 0, z: -1 };
  for (const [u, v] of [[0.1, 0.2], [0.6, 0.9], [0.95, 0]]) {
    const b = bendDir(dir, ang, u, v);
    const a = (angleDeg(dir, b) * Math.PI) / 180;
    assert.ok(Math.abs(Math.hypot(b.x, b.y, b.z) - 1) < 1e-9 && a >= ang * 0.25 - 1e-9 && a <= ang + 1e-9, `bend angle ${a}`);
  }
  assert.ok(HAZARD_KINDS.smoke.absorb > HAZARD_KINDS.snow.absorb, "smoke is the thickest, ice fog the thinnest");
  ok(`refraction: 20 m of dust leaves a pulse laser ${(tPulse * 100).toFixed(0)}% damage and bends it ${(ang * 57.3).toFixed(1)} deg; particle cannon keeps ${(tCpc * 100).toFixed(0)}%; shells unaffected`);
  assert.ok(lockBlocked(path) && LOCK_BLOCK_PATH <= 20, "20 m of cloud blocks a missile lock");
  assert.ok(!lockBlocked(hazardPath({ x: 9, y: 5, z: 0 }, { x: 0, y: 0, z: -1 }, 200, [cloud])), "a thin edge does not");
  assert.ok(insideHazard({ x: 2, y: 3, z: -48 }, [cloud]) && !insideHazard({ x: 2, y: 3, z: -20 }, [cloud]));
  ok("clouds block missile locks (12 m or more on the line of sight) and blind seekers on targets inside them");
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  void rng;
  // Battlefields: clouds come with the field (js/battlefield.js), kinds per
  // biome, off the spawn / convoy lane.
  for (const biome of BIOME_IDS) {
    const field = createField(biome, 1001);
    const list = field.hazards;
    assert.ok(list.length >= 3, `${biome} has 3+ clouds`);
    for (const h of list) {
      assert.ok(LOOKS[biome].hazard.includes(h.kind), `${biome} cloud kind ${h.kind}`);
      assert.ok(Math.abs(h.x) >= 20, "spawn / convoy lane clear");
      assert.ok(Math.hypot(h.x, h.z) >= 50 && Math.hypot(h.x, h.z) <= 340);
      assert.ok(HAZARD_KINDS[h.kind], "known hazard kind");
    }
  }
  ok("each battlefield gets 3-7 clouds of its own kind (city smoke and dust, jungle mist, pass dust) off the spawn lane");
}

// ---------- targeting area and lock rules ----------
{
  assert.equal(sensorRange(1, 1), 190);
  assert.ok(sensorRange(1.3, 1) > 240);
  const cands = [
    { id: "a", dist: 60, angle: 30 },
    { id: "b", dist: 120, angle: 4 },
    { id: "c", dist: 90, angle: 10 },
    { id: "d", dist: 230, angle: 1 },
  ];
  const live = inSensor(cands, 190);
  assert.deepEqual(live.map((c) => c.id), ["a", "b", "c"], "contacts past sensor range cannot be locked");
  assert.equal(pickUnderReticle(live, TARGET_BOX_DEG).id, "b", "R takes the one nearest the crosshair inside the box");
  assert.equal(pickUnderReticle([{ id: "a", dist: 60, angle: 30 }], TARGET_BOX_DEG), null, "nothing inside the box");
  assert.equal(pickNearest(live).id, "a", "fallback: nearest in range");
  const order = [];
  let cur = null;
  for (let i = 0; i < 4; i++) { cur = cycleTargets(live, cur && cur.id, 1); order.push(cur.id); }
  assert.deepEqual(order, ["a", "c", "b", "a"], "Tab cycles nearest first and wraps");
  let s = stepTargetLock(0, { alive: true, inSensor: false }, 1);
  assert.ok(s.keep && s.lostFor === 1);
  s = stepTargetLock(s.lostFor, { alive: true, inSensor: false }, LOCK_LOSS_GRACE);
  assert.ok(!s.keep, "lock drops after the grace outside sensor range");
  assert.ok(stepTargetLock(2.5, { alive: true, inSensor: true }, 0.1).lostFor === 0, "coming back into range resets the grace");
  assert.ok(!stepTargetLock(0, { alive: false, inSensor: true }, 0.01).keep, "a dead target drops at once");
  assert.equal(lockConeOf(WEAPONS.missilePack), 8);
  ok(`targeting: sensor range 190 m x sensors, ${TARGET_BOX_DEG} deg targeting box, Tab nearest-first, lock lost after ${LOCK_LOSS_GRACE} s out of range, missile cone ${lockConeOf(WEAPONS.missilePack)} deg`);
}

// ---------- missiles ----------
assert.ok(!missileArmed(10, 25) && missileArmed(25, 25) && missileArmed(3, 0));
assert.equal(MISSILE_UNARMED_MUL, rangeDamageMul(WEAPONS.missilePack, 10));
ok("missiles arm after 25 m; an unarmed hit does 25%");

// ---------- save fix ----------
{
  class Mem { constructor() { this.m = new Map(); } get length() { return this.m.size; } key(i) { return [...this.m.keys()][i] ?? null; } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
  globalThis.localStorage = new Mem();
  const { freshState, saveState, loadState } = await import("../js/state.js");
  const st = freshState();
  const id = st.selected;
  st.hangar[id].mods = { speed: 3, maneuver: 2, booster: 2 };
  saveState(st);
  const back = loadState();
  assert.equal(back.hangar[id].mods.speed, 3, "3rd Speed Booster survives a reload");
  assert.equal(MODS.speed.max, 3);
  st.hangar[id].mods = { speed: 9, maneuver: 9, booster: 9 };
  saveState(st);
  const capped = loadState().hangar[id].mods;
  assert.deepEqual(capped, { speed: 3, maneuver: 2, booster: 2 }, "levels still cap at each mod's max");
  ok("save fix: Speed Boosters load up to level 3 (was capped at 2); other mods keep their caps");
}

console.log(`weapons overhaul tests passed: ${n}`);
