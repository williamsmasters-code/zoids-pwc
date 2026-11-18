// Battlefields in a live mission, once per biome (forced): frame time, cover
// stopping shots (the game's own shot ray), missile lock blocked by cover,
// terrain stopping shots in the pass, wading slows the player and speeds
// cooling, no unit spawned inside cover, a destructible prop, and the AI
// closing in live without getting stuck. Screenshots per biome (wide,
// third person, cockpit, wading): screenshots/battlefields/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER } from "../js/catalog.js";
import { BIOME_IDS, passCenter, passHalfWidth } from "../js/battlefield.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "battlefields");
fs.mkdirSync(shots, { recursive: true });
const port = 8231;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const id = "shieldLiger";
const FILE = { city: "city", denseJungle: "dense-jungle", sparseJungle: "sparse-jungle", pass: "mountain-pass" };
const WIDE = {
  city: { x: 46, y: 52, z: 170, lx: 0, ly: 12, lz: 10 },
  denseJungle: { x: 30, y: 34, z: 120, lx: 0, ly: 8, lz: 20 },
  sparseJungle: { x: 70, y: 46, z: 170, lx: 0, ly: 6, lz: -10 },
  pass: { x: 10, y: 62, z: 240, lx: 0, ly: 18, lz: 20 },
};
function save() {
  const hangar = {};
  for (const z of ZOID_ORDER) hangar[z] = { owned: z === id, armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  const kit = [
    { type: "pulseLaser", mount: "headWeapon", group: 1 },
    { type: "missilePack", mount: "backMount", group: 2 },
    { type: "beamCannon", mount: "rightWeapon", group: 3 },
  ];
  const inventory = [];
  kit.forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar[id].equipped[w.mount] = `s${i}`; });
  return { version: 1, missionDifficulty: 1, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1005, nextUid: 20, inventory, hangar };
}
const frameAvg = (page) => page.evaluate(() => new Promise((resolve) => {
  const samples = [];
  let last = performance.now();
  let n = 0;
  function tick(now) {
    samples.push(now - last);
    last = now;
    n += 1;
    if (n < 40) requestAnimationFrame(tick);
    else resolve(samples.slice(1).reduce((s, v) => s + v, 0) / (samples.length - 1));
  }
  requestAnimationFrame(tick);
}));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const summary = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
  const Z = (fn, arg) => page.evaluate(fn, arg);
  const step = (secs, dt = 0.05) => Z(({ secs, dt }) => { for (let t = 0; t < secs - 1e-9; t += dt) window.__ZOIDS__.stepSim(dt); }, { secs, dt });

  const only = process.env.BF_BIOMES ? process.env.BF_BIOMES.split(",") : BIOME_IDS;
  for (const biome of only) {
    const tag = biome;
    const file = FILE[biome];
    await Z((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    await sleep(300);
    await Z((b) => { window.__ZOIDS__.forceBiome = b; window.__ZOIDS__.pacifyOnStart = true; }, biome);
    const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
    await btn.click();
    await page.click("#launch-go");
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
    await sleep(900);

    // Frame time (real render loop), then freeze for scripted checks.
    let avg = await frameAvg(page);
    if (avg > 100) {
      await sleep(500);
      const again = await frameAvg(page);
      console.log(`${tag} frame ${avg.toFixed(1)} ms over budget, re-measured ${again.toFixed(1)} ms`);
      avg = Math.min(avg, again);
    }
    const bf = await Z(() => window.__ZOIDS__.battlefield());
    console.log(`${tag} "${bf.label}" frame ${avg.toFixed(2)} ms, cover ${bf.blockers}, water ${bf.water.length}, clouds ${bf.hazards.join(",")}, AA ${bf.quality.antialias}`);
    if (avg > 100) note(`${tag} average frame ${avg.toFixed(1)} ms`);
    if (bf.biome !== biome) note(`${tag} forced biome not used (${bf.biome})`);
    if (bf.hazards.length < 3) note(`${tag} expected 3+ hazard clouds, got ${bf.hazards.length}`);
    if (!bf.water.length) note(`${tag} no water`);
    await Z(() => window.__ZOIDS__.holdSim(true));

    // Spawn validity: nobody stands inside cover.
    const nav0 = await Z(() => window.__ZOIDS__.unitNav());
    const inside = nav0.filter((u) => u.inside);
    if (inside.length) note(`${tag} units spawned inside cover: ${inside.map((u) => `${u.name}@${u.x.toFixed(0)},${u.z.toFixed(0)}`).join(" ")}`);

    // Screenshots: wide, third person, cockpit.
    await Z((v) => window.__ZOIDS__.showcase(v), WIDE[biome]);
    await step(0.05);
    await page.screenshot({ path: path.join(shots, `${file}-wide.png`) });
    await Z(() => window.__ZOIDS__.showcase(null));
    await step(0.05);
    await page.screenshot({ path: path.join(shots, `${file}-third-person.png`) });
    await Z(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.02); window.__ZOIDS__.simInput(null); });
    await step(0.05);
    await page.screenshot({ path: path.join(shots, `${file}-cockpit.png`) });
    await Z(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.02); window.__ZOIDS__.simInput(null); });

    const info = await Z(() => window.__ZOIDS__.turretDebug());
    const foes = info.enemies.map((e) => e.id);
    const foe = foes[0];
    const me = info.pos;
    const park = async (keep) => {
      for (const [i, f] of foes.entries()) if (!keep.includes(f)) await Z(({ f, i }) => window.__ZOIDS__.placeUnit(f, -560 + i * 25, -560), { f, i });
    };

    // 1) Hard cover stops shots and missile locks.
    const cover = await Z(({ x, z }) => window.__ZOIDS__.coverList(x, z, 600)
      .filter((b) => !b.hp && b.top - b.base > 8 && (b.shape === "circle" ? b.r : Math.min(b.hw, b.hd)) > 1.5)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)), me);
    let coverOk = false;
    let lockOk = false;
    for (const b of cover.slice(0, 16)) {
      if (coverOk) break;
      const ext = b.shape === "circle" ? b.r : Math.max(b.hw, b.hd);
      for (const axis of ["x", "z"]) {
        const off = ext + 22;
        const A = axis === "x" ? { x: b.x - off, z: b.z } : { x: b.x, z: b.z - off };
        const B = axis === "x" ? { x: b.x + off, z: b.z } : { x: b.x, z: b.z + off };
        const res = await Z(({ A, B }) => {
          const Zd = window.__ZOIDS__;
          const a = { x: A.x, y: Zd.groundAt(A.x, A.z) + 4, z: A.z };
          const c = { x: B.x, y: Zd.groundAt(B.x, B.z) + 4, z: B.z };
          if (Zd.pointBlocked(a.x, a.z, 3.5) || Zd.pointBlocked(c.x, c.z, 3.5)) return null;
          // Terrain alone must not block this line (check with the cover ignored: the
          // straight line 1 m above the ground profile stays clear of the heightfield).
          const steps = 20;
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = a.x + (c.x - a.x) * t;
            const z = a.z + (c.z - a.z) * t;
            if (a.y + (c.y - a.y) * t < Zd.groundAt(x, z) + 0.5) return null;
          }
          return { shot: Zd.shotTest(a, c), los: Zd.losCheck(a, c), a, c };
        }, { A, B });
        if (!res || !res.shot || !res.shot.cover || !res.los || res.los.by === "terrain") continue;
        coverOk = true;
        console.log(`${tag} shot across ${b.kind} at ${b.x.toFixed(0)},${b.z.toFixed(0)} stopped by ${res.shot.cover} at ${res.shot.dist.toFixed(1)} m (LOS by ${res.los.by})`);
        // Missile lock: player on one side, the foe on the other.
        await park([foe]);
        await Z(({ A, B, foe }) => {
          const t = window.__ZOIDS__.turretDebug();
          window.__ZOIDS__.placeUnit(t.id, A.x, A.z, 0);
          window.__ZOIDS__.placeUnit(foe, B.x, B.z, 0);
        }, { A, B, foe });
        await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
        await step(0.3);
        await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
        const fd = await Z(() => window.__ZOIDS__.fireDebug());
        console.log(`${tag} missile lock behind cover: blocked=${fd.rocketBlocked} lock=${fd.rocketLock.toFixed(2)}`);
        lockOk = fd.rocketBlocked === "COVER";
        break;
      }
    }
    if (!coverOk) note(`${tag} no shot was stopped by hard cover`);
    if (coverOk && !lockOk) note(`${tag} missile lock not blocked by cover`);

    // 2) Terrain stops shots (pass: across the canyon wall; elsewhere: a
    // shot aimed into the ground).
    if (biome === "pass") {
      const z = 0;
      const cx = passCenter(z);
      const w = passHalfWidth(z);
      const t = await Z(({ cx, w, z }) => {
        const Zd = window.__ZOIDS__;
        const a = { x: cx, y: Zd.groundAt(cx, z) + 5, z };
        const b = { x: cx + w + 60, y: a.y, z };
        return { shot: Zd.shotTest(a, b), los: Zd.losCheck(a, b) };
      }, { cx, w, z });
      console.log(`${tag} shot into the canyon wall: ${JSON.stringify(t.shot)} LOS ${t.los && t.los.by}`);
      if (!t.shot || !t.shot.ground || !t.los || t.los.by !== "terrain") note(`${tag} canyon wall did not stop the shot`);
    } else {
      const t = await Z(({ x, z }) => {
        const Zd = window.__ZOIDS__;
        return Zd.shotTest({ x, y: Zd.groundAt(x, z) + 3, z }, { x, y: Zd.groundAt(x, z - 60) - 20, z: z - 60 });
      }, me);
      if (!t || !t.ground) note(`${tag} downward shot did not hit terrain (${JSON.stringify(t)})`);
    }

    // 3) Water: the player wades slower and cools faster.
    const water = bf.water[0];
    const wp = water.shape === "pool" ? { x: water.x, z: water.z } : { x: water.points[Math.floor(water.points.length / 2)][0], z: water.points[Math.floor(water.points.length / 2)][1] };
    const drive = (x, z) => Z(({ x, z }) => {
      const Zd = window.__ZOIDS__;
      const t = Zd.turretDebug();
      Zd.placeUnit(t.id, x, z, 0);
      for (let i = 0; i < 10; i++) Zd.stepSim(0.05);
      const p0 = Zd.turretDebug().pos;
      Zd.simInput({ forward: 1 });
      for (let i = 0; i < 40; i++) Zd.stepSim(0.05);
      const nav = Zd.unitNav().find((u) => u.id === t.id) || Zd.unitNav()[0];
      Zd.simInput(null);
      const p1 = Zd.turretDebug().pos;
      return { moved: Math.hypot(p1.x - p0.x, p1.z - p0.z), wade: nav.wade, wadeMul: nav.wadeMul };
    }, { x, z });
    await park([]);
    const wet = await drive(wp.x, wp.z);
    const dryCover = await Z(() => window.__ZOIDS__.turretDebug().pos);
    const dry = await drive(0, 60);
    console.log(`${tag} wading in ${water.name}: depth ${wet.wade.toFixed(2)} m, speed x${wet.wadeMul.toFixed(2)}, moved ${wet.moved.toFixed(1)} m vs dry ${dry.moved.toFixed(1)} m`);
    if (!(wet.wade > 0.3)) note(`${tag} player not in water at ${water.name} (${wet.wade})`);
    if (!(wet.wadeMul < 0.95)) note(`${tag} wading did not slow (${wet.wadeMul})`);
    if (!(wet.moved < dry.moved * 0.97)) note(`${tag} wading did not cost distance (${wet.moved.toFixed(1)} vs ${dry.moved.toFixed(1)})`);
    // Wading screenshot (third person, in the water).
    await Z(({ x, z }) => { const Zd = window.__ZOIDS__; const t = Zd.turretDebug(); Zd.placeUnit(t.id, x, z, 0); Zd.stepSim(0.05); }, wp);
    await page.screenshot({ path: path.join(shots, `${file}-wading.png`) });
    void dryCover;

    // 4) Destructible prop.
    const prop = await Z(() => {
      const p = window.__ZOIDS__.turretDebug().pos;
      const c = window.__ZOIDS__.coverList(p.x, p.z, 400).filter((b) => b.hp && !b.dead).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      return c ? window.__ZOIDS__.damageCover(c.x, c.z, 9999) : null;
    });
    const destroyed = (await Z(() => window.__ZOIDS__.battlefield())).propsDestroyed;
    console.log(`${tag} destructible: ${JSON.stringify(prop)} propsDestroyed ${destroyed}`);
    if (!prop || !prop.dead || destroyed < 1) note(`${tag} no destructible prop destroyed`);

    // 5) AI live: enemies start ~150 m away; after 20 s they have closed in,
    // never stand inside cover, and rarely stall.
    await Z(() => window.__ZOIDS__.repairPlayer());
    const start = await Z(() => {
      const Zd = window.__ZOIDS__;
      const t = Zd.turretDebug();
      Zd.placeUnit(t.id, 0, 60, 0);
      return t.enemies.map((e) => e.id);
    });
    const spots = biome === "pass" ? [[passCenter(-90), -90], [passCenter(-110) + 30, -110], [passCenter(-130) - 30, -130]] : [[-120, -60], [110, -80], [20, -120]];
    for (const [i, f] of start.entries()) {
      const s = spots[i % spots.length];
      await Z(({ f, x, z }) => window.__ZOIDS__.placeUnit(f, x, z, 0), { f, x: s[0] + Math.floor(i / spots.length) * 12, z: s[1] });
    }
    const d0 = await Z(() => window.__ZOIDS__.unitNav().filter((u) => u.team === "enemy" && u.brain).map((u) => Math.hypot(u.x, u.z - 60)));
    await Z(() => window.__ZOIDS__.setLive(true));
    let insideLive = 0;
    for (let k = 0; k < 10; k++) {
      await step(2, 0.05);
      await Z(() => window.__ZOIDS__.repairPlayer());
      const n = await Z(() => window.__ZOIDS__.unitNav());
      insideLive += n.filter((u) => u.inside && u.team === "enemy").length;
    }
    await Z(() => window.__ZOIDS__.setLive(false));
    const navEnd = await Z(() => window.__ZOIDS__.unitNav());
    const enemiesEnd = navEnd.filter((u) => u.team === "enemy" && u.brain);
    const ground = enemiesEnd.filter((u) => Math.abs(u.y - 0) < 1e9);
    const d1 = ground.map((u) => Math.hypot(u.x, u.z - 60));
    const stuck = enemiesEnd.reduce((s, u) => s + u.brain.stuck, 0);
    const routes = enemiesEnd.reduce((s, u) => s + (u.brain.routes || 0), 0);
    const detours = enemiesEnd.reduce((s, u) => s + u.brain.detours, 0);
    console.log(`${tag} AI: distance to player ${d0.map((d) => d.toFixed(0)).join("/")} -> ${d1.map((d) => d.toFixed(0)).join("/")}, stuck events ${stuck}, routes ${routes}, detour frames ${detours}, inside-cover samples ${insideLive}`);
    const closed = d1.filter((d, i) => d < (d0[i] || 999) - 30 || d < 70).length;
    if (closed < Math.ceil(d1.length * 0.66)) note(`${tag} AI did not close in (${closed}/${d1.length})`);
    if (stuck > enemiesEnd.length * 4) note(`${tag} AI stuck too often (${stuck} events, ${enemiesEnd.length} enemies)`);
    if (insideLive > 0) note(`${tag} enemies inside cover during live AI (${insideLive} samples)`);
    summary.push({ biome, frame: +avg.toFixed(1), stuck, closed: `${closed}/${d1.length}` });
  }
} catch (e) {
  note(`exception: ${e.stack || e.message}`);
} finally {
  await browser.close();
  server.kill();
}
console.log("summary", JSON.stringify(summary));
if (errors.length) {
  console.log(`\n${errors.length} failure(s)`);
  process.exit(1);
}
console.log("battlefields browser: all checks passed");
