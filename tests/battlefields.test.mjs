// Battlefield data checks (pure, no browser): spawn validity, LOS blocking by
// cover and terrain, water rules, AI steering progress, superheavy street
// width, Pteras ceiling clearance, hazards per biome.
import {
  BIOME_IDS, biomeId, CLEAR_ZONES, ROAD, PLAY_LIMIT, WATER,
  createField, pointBlocked, findFreeSpot, lineBlocked, steerYaw, coverPoint,
  fieldStats, rayBlockers, rayGround, wadeSpeedMul, wadeCoolMul, passCenter, passHalfWidth,
  findPath, walkClear, nextWaypoint, terrainBlocked, passShape, passExcess, PASS_BRANCHES,
} from "../js/battlefield.js";
import { escortLayout } from "../js/escort.js";
import { hazardPath, beamTransmission, BIOME_HAZARD } from "../js/weaponsys.js";
import { FLIGHT_DEFAULTS } from "../js/flight.js";
import { ZOIDS } from "../js/catalog.js";

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures += 1;
    console.log("FAIL", msg);
  }
}

const SEEDS = [1001, 7, 424242];
const SUPER_R = Math.max(ZOIDS.gojulas.radius, ZOIDS.deathSaurer.radius);

// Old biome ids still resolve (old saves / contracts).
check(biomeId("desert") === "pass" && biomeId("plains") === "sparseJungle" && biomeId("arctic") === "pass", "old biome aliases");
check(biomeId("city") === "city", "new id passes through");

// Wading rules.
check(wadeSpeedMul(0, 3) === 1, "dry = full speed");
check(Math.abs(wadeSpeedMul(10, 3) - WATER.minSpeedMul) < 1e-9, "deep water = min speed");
check(wadeSpeedMul(1, 3) < 1 && wadeSpeedMul(1, 3) > WATER.minSpeedMul, "shallow water partial slow");
check(wadeSpeedMul(1.2, 5.4) > wadeSpeedMul(1.2, 2.4), "big Zoids wade better");
check(wadeCoolMul(0) === 1 && wadeCoolMul(1) === WATER.coolMul, "wading cools faster");

for (const biome of BIOME_IDS) {
  for (const seed of SEEDS) {
    const t0 = Date.now();
    const f = createField(biome, seed);
    const ms = Date.now() - t0;
    const st = fieldStats(f);
    const tag = `${biome}/${seed}`;
    if (seed === SEEDS[0]) console.log(tag, JSON.stringify(st), `${ms} ms`);
    check(ms < 1500, `${tag} generation ${ms} ms`);
    check(st.blockers > 40, `${tag} has hard cover (${st.blockers})`);
    check(st.hazards >= 3, `${tag} has hazards (${st.hazards})`);
    const kinds = new Set(f.hazards.map((h) => h.kind));
    for (const k of kinds) check((BIOME_HAZARD[biome] || []).includes(k) || ["smoke", "dust", "mist"].includes(k), `${tag} hazard kind ${k}`);
    check(f.water.length >= 1, `${tag} has water`);
    check(f.waterVolumes.length >= 1, `${tag} has water volumes`);

    // Pteras can fly over everything that is cover.
    check(st.tallest < FLIGHT_DEFAULTS.ceiling - 5, `${tag} tallest cover ${st.tallest} under Pteras ceiling`);

    // Clear zones (spawn, beacons, outpost, convoy ends) are free for a superheavy.
    for (const z of CLEAR_ZONES) {
      check(!pointBlocked(f, z.x, z.z, SUPER_R), `${tag} clear zone ${z.x},${z.z} blocked`);
      check(f.waterAt(z.x, z.z).depth < 1.2, `${tag} clear zone ${z.x},${z.z} under water`);
    }
    // Escort road free of cover along its length for the widest Zoid.
    for (let z = ROAD.z0; z >= ROAD.z1; z -= 5) {
      check(!pointBlocked(f, 0, z, SUPER_R), `${tag} road blocked at z=${z}`);
    }
    // Every place the missions spawn units resolves to a free, dry spot
    // close to the request: wave lines ahead of the player start, the
    // assault outpost, beacons, and escort ambush spots for many seeds.
    const requests = [];
    for (let d = 32; d <= 140; d += 12) for (const side of [-36, -18, 0, 18, 36]) requests.push({ x: side, z: 60 - d });
    for (let i = 0; i < 6; i++) for (const side of [-27, -9, 9, 27]) requests.push({ x: side, z: -80 + 18 + i * 8 });
    for (let es = 1; es <= 40; es++) {
      const lay = escortLayout({ escortSeed: es * 7919 });
      for (const a of lay.ambush) for (let i = 0; i < 4; i++) requests.push({ x: a.x + (i - 1.5) * 18, z: a.z - i * 6 });
    }
    let bad = 0;
    let far = 0;
    for (const q of requests) {
      const sp = findFreeSpot(f, q.x, q.z, SUPER_R);
      if (sp.moved < 0 || pointBlocked(f, sp.x, sp.z, SUPER_R) || f.waterAt(sp.x, sp.z).depth >= 1.2 || Math.abs(sp.x) > PLAY_LIMIT || Math.abs(sp.z) > PLAY_LIMIT) bad++;
      else if (sp.moved > 40) far++;
    }
    check(bad === 0, `${tag} ${bad}/${requests.length} invalid spawn spots`);
    check(far <= requests.length * 0.05, `${tag} ${far} spawns moved over 40 m`);
    // Spawned units can reach the player start (no sealed pockets).
    let sealed = 0;
    for (const q of requests.filter((_, i) => i % 9 === 0)) {
      const sp = findFreeSpot(f, q.x, q.z, 3.1);
      if (!walkClear(f, sp, { x: 0, z: 60 }, 3.1) && !findPath(f, sp, { x: 0, z: 60 }, 3.1)) sealed++;
    }
    check(sealed === 0, `${tag} ${sealed} spawn spots cannot reach the player`);

    // Water: beams through a water volume lose damage; depth reported inside it.
    const wv = f.waterVolumes[0];
    const wy = wv.y0 + wv.h - 0.5;
    const o = { x: wv.x - 40, y: wy, z: wv.z };
    const path = hazardPath(o, { x: 1, y: 0, z: 0 }, 80, [wv]);
    check(path.length > 0 && beamTransmission(path, 1) < 1, `${tag} beam through water weakened (len ${path.length.toFixed(1)})`);
    const wb = f.water[0];
    const probe = wb.shape === "pool" ? { x: wb.x, z: wb.z } : wb.points[Math.floor(wb.points.length / 2)];
    check(f.waterAt(probe.x, probe.z).depth > 0.5, `${tag} water depth at ${wb.name}`);
  }
}

// LOS: a building blocks a chest-height line; terrain blocks across a ridge.
{
  const f = createField("city", 1001);
  const b = f.blockers.find((k) => k.kind === "building" && k.top - k.base > 20 && Math.abs(k.x) < 400 && Math.abs(k.z) < 400);
  const y = f.heightAt(b.x, b.z) + 4;
  const a = { x: b.x - b.hw - 30, y, z: b.z };
  const c = { x: b.x + b.hw + 30, y, z: b.z };
  const hit = lineBlocked(f, a, c);
  check(hit && hit.by === "building", "city building blocks LOS");
  const r = rayBlockers(f, a, { x: 1, y: 0, z: 0 }, 200);
  check(r && r.blocker === b && Math.abs(r.t - (30)) < 1.5, `shot ray stops at the building face (t=${r && r.t.toFixed(2)})`);
  const over = lineBlocked(f, { ...a, y: b.top + 20 }, { ...c, y: b.top + 20 });
  check(!over || over.blocker !== b, "LOS over the roof is clear of that building");
  const cp = coverPoint(f, { x: b.x - b.hw - 20, z: b.z }, { x: b.x - b.hw - 120, y: y, z: b.z }, 3, 80);
  check(cp, "cover point found next to a building");
}
{
  const f = createField("pass", 1001);
  // Across the canyon wall: from the valley floor to a point beyond the cliff.
  const z = 0;
  const cx = passCenter(z);
  const w = passHalfWidth(z);
  const a = { x: cx, y: f.heightAt(cx, z) + 4, z };
  const c = { x: cx + w + 60, y: f.heightAt(cx + w + 60, z) + 4, z };
  const lb = lineBlocked(f, { ...c }, { x: cx + w * 2 + 120, y: f.heightAt(cx + w * 2 + 120, z) - 30, z });
  const hit = lineBlocked(f, a, { x: cx + w + 40, y: a.y, z });
  check(hit && hit.by === "terrain", `canyon wall blocks LOS (${hit && hit.by})`);
  const g = rayGround(f, a, { x: 1, y: 0, z: 0 }, 400);
  check(g && g.t < w + 50, `shell ray hits the canyon wall (t=${g && g.t.toFixed(1)})`);
  check(lb === null || lb.by, "far LOS query returns a value");
  // Chokepoints stay wide enough for a superheavy; cliffs stop ground Zoids.
  for (let zz = -320; zz <= 320; zz += 10) {
    const c2 = passCenter(zz);
    check(passHalfWidth(zz) > 40, `pass width at z=${zz}`);
    const cx2 = c2 + passHalfWidth(zz) + 40;
    if (!passShape(cx2, zz).route) check(pointBlocked(f, cx2, zz, 3), `cliff blocks ground Zoids at z=${zz}`);
  }
  // Superheavy fits through the chokes.
  for (const zz of [200, -270]) check(!pointBlocked(f, passCenter(zz), zz, SUPER_R), `choke z=${zz} passable`);
}
{
  // Street width: city streets leave room for a Death Saurer to pass.
  const f = createField("city", 1001);
  let open = 0;
  let total = 0;
  for (let x = -280; x <= 280; x += 70) {
    for (let z = -280; z <= 280; z += 7) {
      total++;
      if (!pointBlocked(f, x + 35, z, SUPER_R)) open++;
    }
  }
  check(open / total > 0.55, `city N-S streets mostly open for superheavies (${(100 * open / total).toFixed(0)}%)`);
}

// AI steering: a point agent following steerYaw reaches far targets in every
// biome without sticking (escape: reverse the preferred side after 2 s still).
for (const [biome, seed, R] of BIOME_IDS.flatMap((b) => [[b, 1001, 3.1], [b, 7, SUPER_R]])) {
  const f = createField(biome, seed);
  const pairs = [[{ x: 0, z: 60 }, { x: 0, z: -260 }], [{ x: -200, z: 200 }, { x: 200, z: -200 }], [{ x: 220, z: 0 }, { x: -220, z: 40 }], [{ x: 0, z: -80 }, { x: 150, z: 250 }]];
  for (let i = 0; i < 4; i++) {
    const a = seed * 0.37 + i * 1.7;
    pairs.push([{ x: Math.cos(a) * 300, z: Math.sin(a) * 300 }, { x: -Math.cos(a + 0.6) * 280, z: -Math.sin(a + 0.6) * 280 }]);
  }
  let reached = 0;
  let stuckEvents = 0;
  for (const [s0, goal] of pairs) {
    const s = findFreeSpot(f, s0.x, s0.z, R, 400);
    const g = findFreeSpot(f, goal.x, goal.z, R, 400);
    let x = s.x;
    let z = s.z;
    let prefer = 1;
    let still = 0;
    let lastX = x;
    let lastZ = z;
    const dt = 0.1;
    const speed = R > 4 ? 9 : 12;
    let ok = false;
    let route = null;
    let ri = 0;
    for (let step = 0; step < 2400; step++) {
      if (step % 15 === 0) { route = walkClear(f, { x, z }, g, R) ? null : findPath(f, { x, z }, g, R); ri = 0; }
      if (route && step % 3 === 0) ri = nextWaypoint(f, { x, z }, route, ri, R);
      const aim = route ? route[ri] : g;
      const want = Math.atan2(-(aim.x - x), -(aim.z - z));
      const st = steerYaw(f, x, z, want, R, 10 + 2 * R, prefer);
      const yaw = st ? st.yaw : want + Math.PI;
      const nx = x - Math.sin(yaw) * speed * dt;
      const nz = z - Math.cos(yaw) * speed * dt;
      if (!pointBlocked(f, nx, nz, R * 0.8) && !terrainBlocked(f, nx, nz, R)) { x = nx; z = nz; }
      if (step % 20 === 19) {
        if (Math.hypot(x - lastX, z - lastZ) < 2) { still++; stuckEvents++; prefer = -prefer; if (process.env.BF_DEBUG) console.log("   stall", biome, x.toFixed(1), z.toFixed(1), route ? JSON.stringify(route.slice(ri, ri + 2)) : "direct"); } else still = 0;
        lastX = x;
        lastZ = z;
      }
      if (Math.hypot(g.x - x, g.z - z) < 15) { ok = true; break; }
    }
    if (ok) reached++;
    else console.log(`  ${biome} agent stopped at ${x.toFixed(0)},${z.toFixed(0)} heading for ${g.x.toFixed(0)},${g.z.toFixed(0)}`);
  }
  console.log(`${biome}/${seed} r${R} steering: ${reached}/${pairs.length} reached, ${stuckEvents} stall checks`);
  check(reached === pairs.length, `${biome} AI steering reached ${reached}/${pairs.length}`);
}

if (failures) {
  console.log(`battlefields: ${failures} failure(s)`);
  process.exit(1);
}
console.log("battlefields: all checks passed");
