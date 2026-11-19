// Mountain pass branch network + radar occlusion + AI search (Node, pure).
import {
  createField, PASS_BRANCHES, CLEAR_ZONES, passShape, passCenter, passHalfWidth,
  findPath, walkClear, terrainBlocked, lineBlocked, radarBlocked, findFreeSpot,
} from "../js/battlefield.js";
import { SENSOR, stealthMul, detects, updateTrack, trackState } from "../js/sensors.js";
import { createBrain, updateBrain, SEARCH_TIME, SEARCH_RADIUS } from "../js/ai.js";
import { ZOIDS } from "../js/catalog.js";

let fails = 0;
function check(cond, msg) {
  if (!cond) {
    fails++;
    console.log("FAIL", msg);
  }
}
const NORMAL_R = 3.1;
const SUPER_R = Math.max(ZOIDS.gojulas.radius, ZOIDS.deathSaurer.radius);
const EYE = 4;

function along(br, t) {
  // Point at fraction t of a branch polyline.
  const pts = br.points;
  let total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(l);
    total += l;
  }
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]) {
      const k = d / seg[i];
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k };
    }
    d -= seg[i];
  }
  const last = pts[pts.length - 1];
  return { x: last[0], z: last[1] };
}
function pathOk(f, a, b, r) {
  if (walkClear(f, a, b, r)) return true;
  const p = findPath(f, a, b, r);
  if (!p || !p.length) return false;
  const end = p[p.length - 1];
  return Math.hypot(end.x - b.x, end.z - b.z) < 12;
}

for (const seed of [1001, 7]) {
  const f = createField("pass", seed);
  const tag = `pass/${seed}`;
  // 1. Branches exist, are walkable for a normal Zoid along their length,
  //    and are out of sight of the main canyon.
  check(PASS_BRANCHES.length >= 4, `${tag} branch count ${PASS_BRANCHES.length}`);
  const mains = [];
  for (let z = -440; z <= 440; z += 20) mains.push({ x: passCenter(z), z });
  for (const br of PASS_BRANCHES) {
    let onBranch = 0;
    let hidden = 0;
    let mids = 0;
    for (let t = 0.2; t <= 0.8001; t += 0.05) {
      const p = along(br, t);
      if (passShape(p.x, p.z).route === br.id) onBranch++;
      mids++;
      const y = f.heightAt(p.x, p.z) + EYE;
      const seen = mains.some((m) => Math.hypot(m.x - p.x, m.z - p.z) < 260 && !lineBlocked(f, { x: p.x, y, z: p.z }, { x: m.x, y: f.heightAt(m.x, m.z) + EYE, z: m.z }));
      if (!seen) hidden++;
    }
    if (seed === 1001) console.log(`${br.name}: half-width ${br.hw} m, superheavy ${br.superheavy}, ${hidden}/${mids} mid points hidden from the main canyon, ${onBranch}/${mids} on the branch floor`);
    check(onBranch >= mids - 1, `${tag} ${br.id} floor carved (${onBranch}/${mids})`);
    check(hidden / mids >= 0.6, `${tag} ${br.id} hidden from main route (${hidden}/${mids})`);
    // Walkable end to end for a normal Zoid (via its own floor).
    const a = along(br, 0.1);
    const mid = along(br, 0.5);
    const b = along(br, 0.9);
    check(pathOk(f, a, mid, NORMAL_R) && pathOk(f, mid, b, NORMAL_R), `${tag} ${br.id} walkable for normal Zoids`);
    if (!br.superheavy) {
      // Too narrow for superheavies: most interior points are blocked at their radius.
      let blocked = 0;
      let n = 0;
      for (let t = 0.3; t <= 0.7001; t += 0.05) {
        const p = along(br, t);
        n++;
        if (terrainBlocked(f, p.x, p.z, SUPER_R)) blocked++;
      }
      if (seed === 1001) console.log(`${br.name}: ${blocked}/${n} interior points blocked at superheavy radius ${SUPER_R} m`);
      check(blocked / n >= 0.6, `${tag} ${br.id} keeps superheavies out (${blocked}/${n})`);
      check(!terrainBlocked(f, mid.x, mid.z, NORMAL_R) || !terrainBlocked(f, along(br, 0.45).x, along(br, 0.45).z, NORMAL_R), `${tag} ${br.id} open for normal Zoids`);
    }
  }
  // 2. Every objective / spawn zone is reachable by both classes from spawn.
  const spawn = { x: 0, z: 60 };
  for (const r of [NORMAL_R, SUPER_R]) {
    let ok = 0;
    for (const c of CLEAR_ZONES) {
      const s = findFreeSpot(f, c.x, c.z, r, 40);
      if (pathOk(f, spawn, s, r)) ok++;
      else console.log(`${tag} r${r} cannot reach ${c.why} (${c.x},${c.z})`);
    }
    check(ok === CLEAR_ZONES.length, `${tag} r${r} objectives reachable ${ok}/${CLEAR_ZONES.length}`);
    if (seed === 1001) console.log(`${tag} r${r}: ${ok}/${CLEAR_ZONES.length} objectives/spawns reachable`);
  }
  // Main canyon still fits superheavies and the convoy (unchanged width).
  let narrowest = Infinity;
  for (let z = -400; z <= 400; z += 10) narrowest = Math.min(narrowest, passHalfWidth(z));
  check(narrowest * 2 >= 4 * SUPER_R, `${tag} main canyon width ${narrowest * 2}`);
  if (seed === 1001) console.log(`${tag} main canyon narrowest width ${Math.round(narrowest * 2)} m`);

  // 3. Radar line: terrain between the West Gully and the main canyon blocks,
  //    an open stretch of canyon does not, trees never block.
  const g = along(PASS_BRANCHES[0], 0.5);
  const m = { x: passCenter(g.z), z: g.z };
  const gy = f.heightAt(g.x, g.z) + EYE;
  const my = f.heightAt(m.x, m.z) + EYE;
  const rb = radarBlocked(f, { x: g.x, y: gy, z: g.z }, { x: m.x, y: my, z: m.z });
  check(rb && rb.by === "terrain", `${tag} gully-to-canyon radar line blocked by terrain (${rb && rb.by})`);
  const c1 = { x: passCenter(40), y: f.heightAt(passCenter(40), 40) + 8, z: 40 };
  const c2 = { x: passCenter(-20), y: f.heightAt(passCenter(-20), -20) + 8, z: -20 };
  const open = radarBlocked(f, c1, c2);
  check(!open || open.by === "spire", `${tag} open canyon radar line (${open && open.by})`);
}

// Radar line ignores trees, keeps tall buildings and spires.
{
  const j = createField("denseJungle", 1001);
  const tree = j.blockers.find((b) => b.kind === "tree");
  const a = { x: tree.x - 12, y: j.heightAt(tree.x - 12, tree.z) + 4, z: tree.z };
  const b = { x: tree.x + 12, y: j.heightAt(tree.x + 12, tree.z) + 4, z: tree.z };
  const viaTree = lineBlocked(j, a, b);
  const rad = radarBlocked(j, a, b);
  check(!(rad && rad.by === "tree"), "trees never block radar");
  console.log(`jungle tree: LOS ${viaTree ? viaTree.by : "clear"}, radar ${rad ? rad.by : "clear"}`);
  const city = createField("city", 1001);
  const tall = city.blockers.find((b) => b.kind === "building" && b.top - b.base >= 40);
  const low = city.blockers.find((b) => b.kind === "building" && b.top - b.base < 25);
  const across = (bk) => {
    const p = { x: bk.x - bk.hw - 3, y: city.heightAt(bk.x - bk.hw - 3, bk.z) + 4, z: bk.z };
    const q = { x: bk.x + bk.hw + 3, y: city.heightAt(bk.x + bk.hw + 3, bk.z) + 4, z: bk.z };
    return radarBlocked(city, p, q);
  };
  if (tall) check(across(tall) && across(tall).by === "building", "tall city building blocks radar");
  if (low) check(!across(low) || across(low).by !== "building" || across(low).blocker !== low, "low building does not block radar");
  console.log(`city: tall (>=40 m) buildings ${city.blockers.filter((b) => b.kind === "building" && b.top - b.base >= 40).length}/${city.blockers.filter((b) => b.kind === "building").length}`);
}

// 4. Sensor rule (pure).
check(stealthMul(10, 0.6) === 1 && stealthMul(0, 0.6) === 0.8 && stealthMul(10, 0.1) === 0.9 && Math.abs(stealthMul(0, 0.1) - 0.72) < 1e-9, "stealth multipliers");
check(detects({ dist: 150, range: 230, blocked: false }), "open line detected");
check(!detects({ dist: 150, range: 230, blocked: true }), "behind terrain hidden");
check(detects({ dist: 40, range: 230, blocked: true }), "close detection through terrain");
check(!detects({ dist: 40, range: 230, blocked: true, stealth: 0.72 }), "still + cool target slips inside 45 m (32 m radius)");
check(!detects({ dist: 300, range: 230, blocked: false }), "beyond range hidden");
let tr = updateTrack(null, true, 10, 20, 0);
check(trackState(tr, 1).state === "live", "fresh track live");
tr = updateTrack(tr, false, 99, 99, 2);
check(tr.x === 10 && tr.z === 20, "last known kept");
check(trackState(tr, SENSOR.freshTime + 0.5).state === "memory", "memory after fresh time");
const fadeMid = trackState(tr, (SENSOR.freshTime + SENSOR.memoryTime) / 2).fade;
check(fadeMid > 0.4 && fadeMid < 0.6, `marker fades (${fadeMid.toFixed(2)})`);
check(trackState(tr, SENSOR.memoryTime + 0.1).state === "lost", "lost after memory time");

// 5. AI: loses track behind terrain, goes to the last-known spot, searches,
//    then reacquires when the target is seen again.
{
  const mk = (id, team, x, z) => ({
    id, team, alive: true, def: { layout: "raptor", speed: 20, radius: 3 }, radius: 3,
    model: { root: { position: { x, y: 0, z } } }, weapons: [{ range: 80, heatGauge: 0 }],
  });
  const ai = mk("ai", "enemy", 0, 0);
  const tgt = mk("p", "player", 0, 150);
  let seedv = 3;
  const brain = createBrain(() => ((seedv = (seedv * 16807) % 2147483647) / 2147483647));
  brain.alerted = true;
  brain.react = 0;
  let hidden = false;
  let lastSeen = { x: 0, z: 150 };
  const nav = {
    sense() {
      if (!hidden) {
        lastSeen = { x: tgt.model.root.position.x, z: tgt.model.root.position.z };
        return { state: "live", x: lastSeen.x, z: lastSeen.z };
      }
      return { state: "memory", x: lastSeen.x, z: lastSeen.z };
    },
    los: () => !hidden, heatFrac: () => 0, cover: () => null, steer: (u, yaw) => ({ yaw, offset: 0 }), route: () => null,
  };
  const ctx = { units: [ai, tgt], nav, time: 0 };
  updateBrain(ai, brain, ctx, 0.1);
  check(brain.contact === "live" && ai.cmd.fire === false, "AI tracking live target");
  // Target ducks behind a ridge and moves away.
  hidden = true;
  tgt.model.root.position.x = 220;
  tgt.model.root.position.z = -100;
  let t = 0;
  let pos = ai.model.root.position;
  const moveTo = () => {
    // Integrate the brain's yaw/throttle (forward = -sin, -cos).
    const c = ai.cmd;
    if (c.yaw == null) return;
    pos.x += -Math.sin(c.yaw) * c.throttle * 20 * 0.1;
    pos.z += -Math.cos(c.yaw) * c.throttle * 20 * 0.1;
  };
  let reachedLastKnown = false;
  let searchStarted = null;
  let minToTrue = Infinity;
  for (let i = 0; i < 400; i++) {
    t += 0.1;
    ctx.time = t;
    updateBrain(ai, brain, ctx, 0.1);
    moveTo();
    if (Math.hypot(pos.x - lastSeen.x, pos.z - lastSeen.z) < SEARCH_RADIUS) reachedLastKnown = true;
    if (brain.search && brain.search.until && searchStarted === null) searchStarted = t;
    if (!brain.gaveUp) minToTrue = Math.min(minToTrue, Math.hypot(pos.x - 220, pos.z + 100));
    if (ai.cmd.fire) check(false, "AI fired at a hidden target");
    if (brain.gaveUp) break;
  }
  console.log(`AI search: lost track ${brain.lostTracks}, reached last-known ${reachedLastKnown}, search started at ${searchStarted && searchStarted.toFixed(1)} s, gave up at ${t.toFixed(1)} s (search ${SEARCH_TIME} s within ${SEARCH_RADIUS} m), closest to true hidden position before giving up ${minToTrue.toFixed(0)} m`);
  check(brain.lostTracks === 1, "AI registered the lost track");
  check(reachedLastKnown && searchStarted !== null, "AI went to the last-known position and searched");
  check(minToTrue > 100, "AI did not home on the hidden true position while searching");
  check(brain.gaveUp && t - searchStarted >= SEARCH_TIME - 0.2, "AI searched for the full search time");
  hidden = false;
  updateBrain(ai, brain, { ...ctx, time: t + 0.1 }, 0.1);
  check(brain.contact === "live" && !brain.search, "AI reacquires when seen again");
}

if (fails) {
  console.log(`pass_radar: ${fails} failure(s)`);
  process.exit(1);
}
console.log("pass_radar: all checks passed");
