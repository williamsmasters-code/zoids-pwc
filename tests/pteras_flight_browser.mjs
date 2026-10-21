// Pteras flies in a real mission: take off, climb above 20 m, fly over an
// obstacle that blocks ground Zoids, shoot a ground target, and get hit by a
// ground Zoid. Fixed sim steps (stepSim). Screenshots: screenshots/pteras-flight/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER, ZOIDS, stockWeaponsFor } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "pteras-flight");
fs.mkdirSync(shots, { recursive: true });
const port = 8199;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };

function save(seed) {
  const hangar = {};
  for (const z of ZOID_ORDER) hangar[z] = { owned: z === "pteras", armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  const inventory = [];
  stockWeaponsFor(ZOIDS.pteras).forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar.pteras.equipped[w.mount] = `s${i}`; });
  return { version: 1, money: 500000, selected: "pteras", missionsDone: 0, wins: 0, reputation: 0, contractSeed: seed, nextUid: 20, inventory, hangar };
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save(1005));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
  await btn.click();
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await page.evaluate(() => window.__ZOIDS__.holdSim(true));
  const Z = (fn, arg) => page.evaluate(fn, arg);
  const steps = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.__ZOIDS__.stepSim(0.05); return window.__ZOIDS__.flightInfo(); }, n);

  // 1) Take off and climb.
  let f = await Z(() => window.__ZOIDS__.flightInfo());
  if (!f) throw new Error("player has no flight state");
  console.log("start", JSON.stringify({ agl: f.agl.toFixed(1), airborne: f.airborne }));
  await Z(() => window.__ZOIDS__.simInput({ forward: 1, climb: 1 }));
  f = await steps(30);
  console.log("after 1.5 s", JSON.stringify({ agl: f.agl.toFixed(1), speed: f.speed.toFixed(1), airborne: f.airborne }));
  f = await steps(60);
  console.log("after 4.5 s", JSON.stringify({ agl: f.agl.toFixed(1), speed: f.speed.toFixed(1), pitch: f.pitch.toFixed(2), airborne: f.airborne }));
  if (!(f.airborne && f.agl > 20)) note(`did not climb above 20 m (agl ${f.agl.toFixed(1)})`);
  await Z(() => window.__ZOIDS__.simInput({ forward: 1, climb: 0 }));
  await steps(10);
  const hud = await Z(() => ({ alt: document.querySelector("#alt")?.textContent, air: document.querySelector("#airspeed")?.textContent, hidden: document.querySelector("#flight-row")?.classList.contains("hidden") }));
  console.log("hud", JSON.stringify(hud));
  if (hud.hidden || !(Number(hud.alt) > 15)) note("HUD altitude row missing");
  await page.screenshot({ path: path.join(shots, "pteras-airborne-chase.png") });
  await Z(() => window.__ZOIDS__.simInput({ forward: 1, climb: 0, camera: true }));
  await steps(4);
  await page.screenshot({ path: path.join(shots, "pteras-airborne-first-person.png") });
  await Z(() => window.__ZOIDS__.simInput({ forward: 1, climb: 0, camera: true }));
  await steps(2);

  // 2) Fly over an obstacle that blocks ground Zoids.
  const obs = (await Z(() => window.__ZOIDS__.obstacleList())).filter((o) => o.top != null).sort((a, b) => (b.top - b.ground) - (a.top - a.ground))[0];
  const pid = (await Z(() => window.__ZOIDS__.flightInfo())).id;
  // Start 50 m south of it, heading north (-Z), 8 m above its top.
  const alt = obs.top - obs.ground + 8;
  await Z(({ pid, obs, alt }) => window.__ZOIDS__.placeUnit(pid, obs.x, obs.z + 50, 0, alt), { pid, obs, alt });
  await Z(() => window.__ZOIDS__.simInput({ forward: 1, climb: 0 }));
  let minClear = Infinity;
  let maxSide = 0;
  for (let i = 0; i < 70; i++) {
    f = await steps(1);
    if (Math.abs(f.z - obs.z) < (obs.r || obs.hd || 3)) minClear = Math.min(minClear, f.y - obs.top);
    maxSide = Math.max(maxSide, Math.abs(f.x - obs.x));
  }
  console.log("over obstacle", JSON.stringify({ top: obs.top.toFixed(1), height: (obs.top - obs.ground).toFixed(1), minClearOverTop: minClear.toFixed(1), endZ: (f.z - obs.z).toFixed(1), maxSideDrift: maxSide.toFixed(2) }));
  if (!(f.z < obs.z - 10)) note("did not get past the obstacle");
  if (!(minClear > -0.5) || maxSide > 1.5) note("flyer was blocked or pushed aside by the obstacle");

  // 3) Shoot a ground target from the air.
  const enemies = (await Z(() => window.__ZOIDS__.turretDebug())).enemies;
  if (!enemies.length) throw new Error("no enemy");
  const foe = enemies[0];
  await Z(({ pid, foe }) => { window.__ZOIDS__.placeUnit(foe.id, foe.x, foe.z, 0); return window.__ZOIDS__.placeUnit(pid, foe.x, foe.z + 70, 0, 22); }, { pid, foe });
  await Z((id) => { window.__ZOIDS__.forceAim(id); window.__ZOIDS__.setLock(id); }, foe.id);
  await Z(() => window.__ZOIDS__.simInput({ forward: 0.4, climb: 0, groups: [true, true, false, false] }));
  const hp0 = (await Z(() => window.__ZOIDS__.turretDebug())).enemies.find((e) => e.id === foe.id).armor;
  f = await steps(40);
  const hp1e = (await Z(() => window.__ZOIDS__.turretDebug())).enemies.find((e) => e.id === foe.id);
  console.log("air-to-ground", JSON.stringify({ foe: foe.zoid, alt: f.agl.toFixed(1), hp: `${hp0.toFixed(1)} -> ${hp1e ? hp1e.armor.toFixed(1) : "dead"}` }));
  if (hp1e && !(hp1e.armor < hp0)) note("Pteras did not damage the ground target");
  await Z(() => { window.__ZOIDS__.forceAim(null); });

  // 4) Get hit from the ground: AI live, Pteras circling 18 m up, 45 m out.
  await Z(() => window.__ZOIDS__.repairPlayer());
  const foe2 = (await Z(() => window.__ZOIDS__.turretDebug())).enemies[0];
  await Z(({ pid, foe2 }) => window.__ZOIDS__.placeUnit(pid, foe2.x + 45, foe2.z, Math.PI / 2, 18), { pid, foe2 });
  await Z(() => window.__ZOIDS__.setPacified(false));
  await Z(() => window.__ZOIDS__.simInput({ forward: 0.5, climb: 0, turn: 0.6 }));
  const p0 = (await Z(() => window.__ZOIDS__.flightInfo())).armor;
  let shot = false;
  let pHit = null;
  for (let i = 0; i < 20; i++) {
    f = await steps(10);
    if (!shot && f.armor < p0) {
      shot = true;
      await Z((id) => window.__ZOIDS__.spectate(id), foe2.id);
      await steps(1);
      await page.screenshot({ path: path.join(shots, "ground-zoid-shooting-up.png") });
      await Z(() => window.__ZOIDS__.spectate(null));
    }
    if (f.armor < p0) { pHit = f; break; }
  }
  console.log("ground-to-air", JSON.stringify({ shooter: foe2.zoid, agl: f.agl.toFixed(1), armor: `${p0.toFixed(1)} -> ${f.armor.toFixed(1)}`, alive: f.alive }));
  if (!pHit) note("ground Zoid never hit the airborne Pteras");
  else if (!(pHit.agl > 8)) note("hit landed but Pteras was not airborne high enough");
  await Z(() => window.__ZOIDS__.setPacified(true));
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`${errors.length} failure(s)`); process.exit(1); }
console.log("pteras flight browser ok");
