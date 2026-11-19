// Weapons overhaul in a live mission: targeting box + Tab / R + lock loss,
// reticle bloom and range readout, ballistic drop marks and shell tracers,
// beam refraction through a dust cloud (less damage, BEAM SCATTER), and a
// cloud blocking the missile seeker. Screenshots: screenshots/weapons-overhaul/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "weapons-overhaul");
fs.mkdirSync(shots, { recursive: true });
const port = 8213;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const id = "shieldLiger";
function save() {
  const hangar = {};
  for (const z of ZOID_ORDER) hangar[z] = { owned: z === id, armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  // Four mounts filled so every mount has a muzzle (the test swaps types later).
  const kit = [
    { type: "gatling", mount: "leftWeapon", group: 1 },
    { type: "pulseLaser", mount: "headWeapon", group: 2 },
    { type: "missilePack", mount: "backMount", group: 3 },
    { type: "beamCannon", mount: "rightWeapon", group: 4 },
  ];
  const inventory = [];
  kit.forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar[id].equipped[w.mount] = `s${i}`; });
  return { version: 1, missionDifficulty: 3, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1005, nextUid: 20, inventory, hangar };
}
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
  await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await sleep(500);
  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
  await btn.click();
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await page.evaluate(() => window.__ZOIDS__.holdSim(true));
  const Z = (fn, arg) => page.evaluate(fn, arg);
  const step = (secs, dt = 0.05) => Z(({ secs, dt }) => { for (let t = 0; t < secs - 1e-9; t += dt) window.__ZOIDS__.stepSim(dt); }, { secs, dt });
  const hazardsAtStart = await Z(() => window.__ZOIDS__.hazardList());
  console.log("map clouds", hazardsAtStart.length, hazardsAtStart.map((h) => h.kind).join(","));
  if (hazardsAtStart.length < 3) note(`expected 3-4 map clouds, got ${hazardsAtStart.length}`);
  await Z(() => window.__ZOIDS__.clearHazards());
  const info = await Z(() => window.__ZOIDS__.turretDebug());
  const foes = info.enemies.map((e) => e.id);
  const foe = foes[0];
  const second = foes[1] || null;
  // Put a unit d m in front of the player (along chassis yaw), side m to the right.
  const place = (fid, d, side = 0) => Z(({ fid, d, side }) => {
    const t = window.__ZOIDS__.turretDebug();
    const y = t.chassisYaw;
    const fx = -Math.sin(y), fz = -Math.cos(y), rx = Math.cos(y), rz = -Math.sin(y);
    return window.__ZOIDS__.placeUnit(fid, t.pos.x + fx * d + rx * side, t.pos.z + fz * d + rz * side, y + Math.PI);
  }, { fid, d, side });
  const ahead = (d) => Z((d) => { const t = window.__ZOIDS__.turretDebug(); const y = t.chassisYaw; return { x: t.pos.x - Math.sin(y) * d, z: t.pos.z - Math.cos(y) * d }; }, d);
  const parkOthers = async (keep) => {
    for (const [i, f] of foes.entries()) if (!keep.includes(f)) await place(f, -240 - i * 30, 200);
  };
  const fire = (groups) => Z((g) => window.__ZOIDS__.simInput({ groups: g }), groups);
  const ceaseFire = () => Z(() => window.__ZOIDS__.simInput(null));
  await Z(() => window.__ZOIDS__.installWeapon("leftWeapon", "shockCannon"));


  // 1) Targeting: Tab nearest-first, R = under the reticle, box + range.
  await parkOthers([foe, second].filter(Boolean));
  await place(foe, 60, -6);
  if (second) await place(second, 110, 30);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await Z(() => window.__ZOIDS__.setLock(null));
  const tab1 = await Z(() => window.__ZOIDS__.lockKey("tab"));
  const tab2 = await Z(() => window.__ZOIDS__.lockKey("tab"));
  console.log("tab", tab1, tab2);
  if (tab1 !== foe) note(`Tab should lock the nearest contact first (${tab1} vs ${foe})`);
  if (second && tab2 !== second) note(`second Tab should go to the next contact (${tab2})`);
  await Z(() => window.__ZOIDS__.setLock(null));
  const rLock = await Z(() => window.__ZOIDS__.lockKey("r"));
  if (rLock !== foe) note(`R should lock the enemy under the reticle (${rLock})`);
  await step(0.2);
  const hud1 = await Z(() => ({
    box: !document.querySelector("#target-box").classList.contains("hidden"),
    boxText: document.querySelector("#target-box span").textContent,
    range: document.querySelector("#aim-range").textContent,
    pips: [...document.querySelectorAll("#group-pips i")].map((i) => i.dataset.band),
    reticleW: parseFloat(document.querySelector(".reticle").style.width),
    ring: !document.querySelector("#lock-ring").classList.contains("hidden"),
  }));
  console.log("hud", JSON.stringify(hud1));
  if (!hud1.box || !/\d+ m/.test(hud1.boxText)) note("target box missing on the locked enemy");
  if (!/\d+ m/.test(hud1.range)) note("no range readout under the reticle");
  // One reticle pip per weapon slot (fitted weapons + standard melee).
  const slotCount = await Z(() => window.__ZOIDS__.weaponSlots().slots.length);
  if (hud1.pips.length !== slotCount) note(`expected ${slotCount} slot pips, got ${hud1.pips}`);
  if (!hud1.ring) note("missile seeker circle not shown with a missile pack fitted");
  await page.screenshot({ path: path.join(shots, "hud-reticle-lock.png") });

  // 2) Bloom: hold the gatling for 1.5 s; the reticle grows.
  await Z(() => window.__ZOIDS__.installWeapon("leftWeapon", "gatling"));
  await Z(() => (window.__ZOIDS__.setGroup("leftWeapon", 1), window.__ZOIDS__.selectWeapon("leftWeapon")));
  // Inside the gatling's optimal range, so the reticle shows the weapon's own
  // bloom rather than its range spread (the lock assist now reads the range to
  // the locked target, 60 m, which is past optimal).
  await place(foe, 30, 0);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(0.1);
  const before = await Z(() => window.__ZOIDS__.fireDebug().reticle.spread);
  await fire([true, false, false, false]);
  await step(1.5, 1 / 30);
  const during = await Z(() => window.__ZOIDS__.fireDebug());
  await page.screenshot({ path: path.join(shots, "reticle-bloom-gatling.png") });
  await ceaseFire();
  const gat = during.weapons.find((w) => w.id === "gatling");
  console.log("bloom", before.toFixed(4), "->", during.reticle.spread.toFixed(4), "spin", gat.spin.toFixed(2));
  if (!(during.reticle.spread > before * 1.5)) note(`reticle did not bloom under sustained fire (${before} -> ${during.reticle.spread})`);
  if (!(gat.spin > 0.95)) note(`gatling did not spin up (${gat.spin})`);
  await step(1.5);
  const after = await Z(() => window.__ZOIDS__.fireDebug().reticle.spread);
  if (!(after <= before * 1.05)) note(`bloom did not recover (${before} -> ${during.reticle.spread} -> ${after})`);
  await Z(() => window.__ZOIDS__.repairPlayer());

  // 3) Ballistic drop: shock cannon (zero 45 m) at ~100 m. First person so
  // the player's own hull does not hide the shell.
  await Z(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.02); window.__ZOIDS__.simInput(null); });
  await Z(() => window.__ZOIDS__.installWeapon("leftWeapon", "shockCannon"));
  await Z(() => (window.__ZOIDS__.setGroup("leftWeapon", 1), window.__ZOIDS__.selectWeapon("leftWeapon")));
  await place(foe, 100, 0);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(0.1);
  const marks = await Z(() => window.__ZOIDS__.weaponDebug().markers);
  const aimInfo = await Z(() => window.__ZOIDS__.fireDebug().reticle.aimDist);
  console.log("aim distance", aimInfo.toFixed(1));
  console.log("ballistic marks", JSON.stringify({ impact: marks.impact && marks.impact.label, drop: marks.drop && marks.drop.label }));
  if (!marks.drop || !/DROP/.test(marks.drop.label) || !(marks.drop.value > 1)) note(`shock cannon at 100 m should show a DROP over 1 m (${JSON.stringify(marks.drop)})`);
  if (!marks.impact) note("no IMPACT mark");
  else {
    const ret = await Z(() => ({ w: window.innerWidth, h: window.innerHeight }));
    if (!(marks.impact.y > ret.h / 2 + 2)) note(`IMPACT mark should sit below the crosshair (${marks.impact.y})`);
  }
  await page.screenshot({ path: path.join(shots, "ballistic-drop-hud.png") });
  // Side view of the same shot: red line = crosshair line of sight, the
  // orange tracer = the shell, crossing the line at the 45 m zero, then low.
  const sight = await Z(() => window.__ZOIDS__.aimInfo());
  const side = (m, a) => {
    const mx = (m.x + a.x) / 2, mz = (m.z + a.z) / 2;
    const dx = a.x - m.x, dz = a.z - m.z, L = Math.hypot(dx, dz) || 1;
    return { x: mx + (-dz / L) * 62, y: m.y + 1.5, z: mz + (dx / L) * 62, lx: mx, ly: m.y - 2, lz: mz };
  };
  await fire([true, false, false, false]);
  await step(0.05);
  await ceaseFire();
  const inFlight = await Z(() => window.__ZOIDS__.fireDebug());
  if (inFlight.projectiles < 1) note("shock cannon shell did not leave the barrel");
  await Z((s) => { window.__ZOIDS__.drawLine(s.muzzle, s.aim, 0xff3344, 3); }, sight);
  await Z((v) => window.__ZOIDS__.showcase(v), side(sight.muzzle, sight.aim));
  await page.evaluate(() => { document.querySelector("#hud").style.visibility = "hidden"; });
  for (let i = 0; i < 26; i++) {
    await step(0.05);
    if (i === 19) await page.screenshot({ path: path.join(shots, "ballistic-drop-side.png") });
  }
  await Z(() => window.__ZOIDS__.showcase(null));
  await page.evaluate(() => { document.querySelector("#hud").style.visibility = ""; });
  // Inside zero range: no drop.
  await place(foe, 35, 0);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(0.1);
  const near = await Z(() => window.__ZOIDS__.weaponDebug().markers);
  console.log("inside zero", near.drop && near.drop.label);
  if (!near.drop || !/ZERO/.test(near.drop.label)) note(`inside zero range the HUD should say ZERO (${JSON.stringify(near.drop)})`);
  await step(2);

  // 4) Beam refraction: pulse laser at 60 m, with and without a dust cloud between.
  await place(foe, 60, 0);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  const burst = async () => {
    const a0 = await Z((f) => window.__ZOIDS__.unitArmor(f), foe);
    await fire([false, true, false, false]);
    await step(2, 1 / 30);
    await ceaseFire();
    await step(0.3);
    return a0 - (await Z((f) => window.__ZOIDS__.unitArmor(f), foe));
  };
  const clear = await burst();
  await step(5); // let the pulse laser cool so both bursts start cold
  const mid = await ahead(32);
  await Z((m) => window.__ZOIDS__.addHazard({ kind: "dust", x: m.x, z: m.z, r: 10, h: 24 }), mid);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(0.1);
  const warn = await Z(() => document.querySelector("#hazard-warn").textContent);
  console.log("warn", warn);
  if (!/BEAM SCATTER/.test(warn)) note(`no BEAM SCATTER warning through the cloud (${warn})`);
  const hazy = await burst();
  console.log("pulse laser 2 s damage: clear", clear.toFixed(1), "through dust", hazy.toFixed(1));
  if (!(clear > 0)) note("pulse laser did no damage in clear air");
  if (!(hazy < clear * 0.8)) note(`dust should cut beam damage (${hazy} vs ${clear})`);
  // Sustained beam cannon through the cloud: HUD view, then a side view
  // showing the bend and the scatter rays where the beam enters the dust.
  await step(4);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await fire([false, false, false, true]);
  let refr = null;
  for (let i = 0; i < 6; i++) {
    await step(1 / 30, 1 / 30);
    const dbg = await Z(() => window.__ZOIDS__.fireDebug());
    const bc = dbg.weapons.find((w) => w.id === "beamCannon");
    if (bc.lastRefraction) refr = bc.lastRefraction;
    if (i === 3) await page.screenshot({ path: path.join(shots, "beam-scatter-hud.png") });
  }
  await ceaseFire();
  await step(1.5);
  const sight2 = await Z(() => window.__ZOIDS__.aimInfo());
  const me = await Z(() => window.__ZOIDS__.turretDebug().pos);
  const view = (() => {
    const a = sight2.aim; const dx = a.x - me.x, dz = a.z - me.z, L = Math.hypot(dx, dz) || 1;
    const cx = me.x + dx * 0.55, cz = me.z + dz * 0.55;
    return { x: cx + (-dz / L) * 38, y: a.y + 7, z: cz + (dx / L) * 38, lx: cx, ly: a.y, lz: cz };
  })();
  await Z((v) => window.__ZOIDS__.showcase(v), view);
  await page.evaluate(() => { document.querySelector("#hud").style.visibility = "hidden"; });
  await fire([false, false, false, true]);
  for (let i = 0; i < 5; i++) {
    await step(1 / 30, 1 / 30);
    if (i === 3) await page.screenshot({ path: path.join(shots, "beam-scatter-side.png") });
  }
  await ceaseFire();
  await Z(() => window.__ZOIDS__.showcase(null));
  await page.evaluate(() => { document.querySelector("#hud").style.visibility = ""; });
  console.log("refraction", JSON.stringify(refr));
  if (!refr || !(refr.transmission < 1)) note(`beam cannon was not refracted by the cloud (${JSON.stringify(refr)})`);

  // 5) Missile seeker: the cloud blocks the lock; clear air locks.
  await step(3);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(2.5, 1 / 30);
  const blocked = await Z(() => window.__ZOIDS__.fireDebug());
  console.log("seeker through cloud", blocked.rocketLock.toFixed(2), blocked.rocketBlocked);
  if (blocked.rocketLock > 0.2 || !blocked.rocketBlocked) note(`cloud should block the missile lock (${blocked.rocketLock}, ${blocked.rocketBlocked})`);
  await page.screenshot({ path: path.join(shots, "seeker-blocked.png") });
  await Z(() => window.__ZOIDS__.clearHazards());
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await step(3, 1 / 30);
  const clearLock = await Z(() => window.__ZOIDS__.fireDebug().rocketLock);
  console.log("seeker clear air", clearLock.toFixed(2));
  if (clearLock < 0.99) note(`missile lock should complete in clear air (${clearLock})`);

  // 6) Lock loss: 3 s grace outside sensor range.
  await Z(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.02); window.__ZOIDS__.simInput(null); });
  await Z((f) => window.__ZOIDS__.setLock(f), foe);
  const sensor = await Z(() => window.__ZOIDS__.fireDebug().sensorRange);
  await place(foe, sensor + 40, 0);
  await step(2);
  const held = await Z(() => window.__ZOIDS__.fireDebug().lockId);
  await step(1.5);
  const dropped = await Z(() => window.__ZOIDS__.fireDebug().lockId);
  console.log("sensor", Math.round(sensor), "lock after 2 s out", held, "after 3.5 s", dropped);
  if (held !== foe) note("lock should survive 2 s outside sensor range");
  if (dropped) note("lock should drop after 3 s outside sensor range");
  await place(foe, 70, 0);
  await Z(() => window.__ZOIDS__.aimAtEnemy(0, null));
  await Z(() => window.__ZOIDS__.lockKey("r"));
  await step(0.2);
  await page.screenshot({ path: path.join(shots, "hud-overview.png") });
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`${errors.length} failure(s)`); process.exit(1); }
console.log("weapons overhaul browser ok");
