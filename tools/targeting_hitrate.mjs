// Targeting hit-rate probe. Fires every ranged weapon at a stationary target
// Zoid at several ranges, the way a player does it: lock the target (R), put
// the crosshair on the lock box, hold the trigger. Reports the share of shots
// (beam ticks for sustained beams) that strike the target, and where the rest
// went (ground, cover, sailed past).
//
//   node tools/targeting_hitrate.mjs [--shooter shieldLiger] [--targets gunSniper,ironKong]
//                                    [--ranges 25,50,80,120,160,200] [--secs 6] [--out file.json]
//
// Exported run() is reused by tests/targeting_browser.mjs.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER, WEAPONS } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RANGED = ["pulseLaser", "beamCannon", "doubleBeamCannon", "missilePack", "gatling", "sniperRifle", "shockCannon", "chargedParticle"];
const MOUNT_FOR = { S: "headWeapon", M: "leftWeapon", L: "backMount", XL: "backMount" };

function save(id) {
  const hangar = {};
  for (const z of ZOID_ORDER) hangar[z] = { owned: z === id, armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  const kit = [
    { type: "pulseLaser", mount: "headWeapon", group: 2 },
    { type: "gatling", mount: "leftWeapon", group: 3 },
    { type: "beamCannon", mount: "rightWeapon", group: 4 },
    { type: "missilePack", mount: "backMount", group: 4 },
  ];
  const inventory = [];
  kit.forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar[id].equipped[w.mount] = `s${i}`; });
  return { version: 1, missionDifficulty: 1, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1005, nextUid: 20, inventory, hangar };
}

export async function openMission(browser, port, shooter, biome = "sparseJungle") {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())));
  await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save(shooter));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await sleep(400);
  await page.evaluate((b) => { window.__ZOIDS__.pacifyOnStart = true; window.__ZOIDS__.forceBiome = b; }, biome);
  const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
  await btn.click();
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await page.evaluate(() => { window.__ZOIDS__.holdSim(true); if (window.__ZOIDS__.skipRender) window.__ZOIDS__.skipRender(true); });
  // Clear the field: only the probe's target stays.
  await page.evaluate(() => {
    for (const u of window.__ZOIDS__.unitNav()) if (u.team !== "player") window.__ZOIDS__.removeUnit(u.id);
  });
  return page;
}

// A flat, open lane 230 m long from the player's position (searches a grid).
export async function findLane(page) {
  return page.evaluate(() => {
    const Z = window.__ZOIDS__;
    const me = Z.turretDebug();
    const start = { x: me.pos.x, z: me.pos.z };
    for (let ring = 0; ring < 14; ring++) {
      for (let k = 0; k < Math.max(1, ring * 8); k++) {
        const a0 = (k / Math.max(1, ring * 8)) * Math.PI * 2;
        const ox = start.x + Math.cos(a0) * ring * 40;
        const oz = start.z + Math.sin(a0) * ring * 40;
        if (Z.pointBlocked(ox, oz, 4)) continue;
        for (let y = 0; y < 16; y++) {
          const yaw = (y / 16) * Math.PI * 2;
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
          const g0 = Z.groundAt(ox, oz);
          let ok = true;
          for (let d = 0; d <= 240 && ok; d += 5) {
            const x = ox + fx * d, z = oz + fz * d;
            if (Math.abs(Z.groundAt(x, z) - g0) > 1.0) ok = false;
            else if (d > 0 && Z.pointBlocked(x, z, 3.5)) ok = false;
            else if (Z.waterAt(x, z).depth > 0.05) ok = false;
          }
          if (!ok) continue;
          const a = { x: ox, y: g0 + 2.5, z: oz };
          const b = { x: ox + fx * 240, y: g0 + 1.0, z: oz + fz * 240 };
          if (Z.losCheck(a, b)) continue;
          return { x: ox, z: oz, yaw, ground: g0 };
        }
      }
    }
    return null;
  });
}

export async function measure(page, lane, target, weapon, range, secs, opts = {}) {
  return page.evaluate(({ lane, target, weapon, range, secs, mount, facing }) => {
    const Z = window.__ZOIDS__;
    const me = Z.turretDebug();
    Z.placeUnit(me.id, lane.x, lane.z, lane.yaw);
    Z.repairPlayer();
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw);
    const tid = Z.spawnTarget(target, lane.x + fx * range, lane.z + fz * range, lane.yaw + Math.PI + (facing || 0));
    Z.installWeapon(mount, weapon);
    for (const w of Z.weaponCooldowns ? Z.fireDebug().weapons : []) Z.setGroup(w.mount, w.mount === mount ? 1 : 4);
    Z.setLock(tid);
    const b = Z.unitBounds(tid);
    const aimAt = b.lockPoint;
    Z.aimCameraAt(aimAt);
    Z.clearProjectiles();
    for (let t = 0; t < 1.0; t += 0.05) Z.stepSim(0.05);
    Z.shotTally(true);
    // New build: select the weapon and pull the trigger. Old build: group 1.
    const modern = !!Z.selectWeapon;
    if (modern) Z.selectWeapon(mount);
    Z.simInput(modern ? { fire: true } : { groups: [true, false, false, false] });
    for (let t = 0; t < secs; t += 0.05) { Z.aimCameraAt(aimAt); Z.stepSim(0.05); }
    Z.simInput(null);
    for (let t = 0; t < 4; t += 0.05) Z.stepSim(0.05);
    const tally = Z.shotTally(true)[weapon] || { shots: 0, unit: 0, ground: 0, cover: 0, miss: 0 };
    Z.removeUnit(tid);
    return { target, weapon, range, ...tally, rate: tally.shots ? tally.unit / tally.shots : null, lockY: aimAt.y - b.root.y, height: b.all.max.y - b.all.min.y };
  }, { lane, target, weapon, range, secs, mount: opts.mount || MOUNT_FOR[WEAPONS[weapon].size] || "leftWeapon", facing: opts.facing || 0 });
}

export async function run({ shooter = "shieldLiger", targets = ["gunSniper", "ironKong"], ranges = [25, 50, 80, 120, 160, 200], weapons = RANGED, secs = 6, port = 8231, log = console.log } = {}) {
  const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
  await sleep(900);
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 600000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const rows = [];
  try {
    const page = await openMission(browser, port, shooter);
    const lane = await findLane(page);
    if (!lane) throw new Error("no open lane found");
    log(`lane ${JSON.stringify(lane)}`);
    for (const target of targets) {
      for (const weapon of weapons) {
        for (const range of ranges) {
          if (range > WEAPONS[weapon].range) continue;
          const r = await measure(page, lane, target, weapon, range, secs);
          rows.push({ shooter, ...r });
          log(`${shooter} -> ${target} ${weapon} @${range} m: ${r.unit}/${r.shots} hit (ground ${r.ground}, cover ${r.cover}, past ${r.miss})`);
        }
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  return rows;
}

export function summarize(rows) {
  // Hit rate per weapon and target over ranges inside the weapon's long-range mark.
  const out = {};
  for (const r of rows) {
    const w = WEAPONS[r.weapon];
    const key = `${r.shooter}|${r.target}|${r.weapon}`;
    const o = out[key] || (out[key] = { shooter: r.shooter, target: r.target, weapon: r.weapon, effShots: 0, effHits: 0, byRange: {} });
    o.byRange[r.range] = r.rate;
    if (r.range <= (w.optimal + w.range) / 2) { o.effShots += r.shots; o.effHits += r.unit; }
  }
  return Object.values(out).map((o) => ({ ...o, effRate: o.effShots ? o.effHits / o.effShots : null }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const rows = await run({
    shooter: arg("shooter", "shieldLiger"),
    targets: arg("targets", "gunSniper,ironKong").split(","),
    ranges: arg("ranges", "25,50,80,120,160,200").split(",").map(Number),
    weapons: arg("weapons", RANGED.join(",")).split(","),
    secs: Number(arg("secs", 6)),
    port: Number(arg("port", 8231)),
  });
  const sum = summarize(rows);
  console.log("\nweapon            target       " + "range rates".padEnd(40) + " effective");
  for (const s of sum) {
    console.log(`${s.weapon.padEnd(17)} ${s.target.padEnd(12)} ${Object.entries(s.byRange).map(([k, v]) => `${k}:${v == null ? "-" : Math.round(v * 100) + "%"}`).join(" ").padEnd(40)} ${s.effRate == null ? "-" : Math.round(s.effRate * 100) + "%"}`);
  }
  const out = arg("out", null);
  if (out) fs.writeFileSync(out, JSON.stringify({ rows, summary: sum }, null, 2));
}
