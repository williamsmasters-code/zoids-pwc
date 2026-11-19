// Time-to-kill probe: each Zoid with its stock loadout fires at a stationary
// dummy for SECS seconds; prints damage per second on target.
//   New build: one row per weapon slot (the trigger fires only the selected
//   weapon). Old build (no selectWeapon hook): "lmb" = group 1 held, "all" =
//   all four groups held at once.
//   node tools/ttk_probe.mjs [treeRoot] [port] [shooters] [targets] [ranges]
// treeRoot defaults to this repo; point it at an older checkout (with the
// same test hooks) for a before / after comparison.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [rootArg, port = "8262", shooters = "shieldLiger,gunSniper,ironKong,gojulas,commandWolf", targets = "gunSniper,ironKong", ranges = "25,60"] = process.argv.slice(2);
const treeRoot = rootArg || here;
const cat = await import(`${treeRoot}/js/catalog.js`);
const SECS = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function save(id) {
  const hangar = {};
  for (const z of cat.ZOID_ORDER) hangar[z] = { owned: z === id, armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null, equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  const inventory = [];
  cat.stockWeaponsFor(cat.ZOIDS[id], () => 0.5).forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar[id].equipped[w.mount] = `s${i}`; });
  return { version: 1, missionDifficulty: 1, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1005, nextUid: 20, inventory, hangar };
}
const server = spawn("python3", ["-m", "http.server", port], { cwd: treeRoot, stdio: "ignore" });
await sleep(900);
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 900000, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const { findLane } = await import("./targeting_hitrate.mjs");
const out = [];
try {
  for (const shooter of shooters.split(",")) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("pageerror:", e.message));
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save(shooter));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    await sleep(300);
    await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; window.__ZOIDS__.forceBiome = "sparseJungle"; });
    const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
    await btn.click(); await page.click("#launch-go");
    await page.waitForFunction(() => window.__ZOIDS__.screen === "mission", { timeout: 60000 });
    await page.evaluate(() => { const Z = window.__ZOIDS__; Z.holdSim(true); Z.skipRender && Z.skipRender(true); for (const u of Z.unitNav()) if (u.team !== "player") Z.removeUnit(u.id); });
    const lane = await findLane(page);
    for (const target of targets.split(",")) for (const range of ranges.split(",").map(Number)) {
      const r = await page.evaluate(({ lane, target, range, SECS }) => {
        const Z = window.__ZOIDS__;
        const me = Z.turretDebug();
        const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw);
        const run = (input, select) => {
          Z.placeUnit(me.id, lane.x, lane.z, lane.yaw); Z.repairPlayer();
          const tid = Z.spawnTarget(target, lane.x + fx * range, lane.z + fz * range, lane.yaw + Math.PI);
          Z.setLock(tid); const aim = Z.unitBounds(tid).lockPoint; Z.aimCameraAt(aim); Z.clearProjectiles();
          for (let t = 0; t < 3; t += 0.05) Z.stepSim(0.05); // cool down / cooldowns
          if (select != null) Z.selectWeapon(select);
          Z.simInput(input);
          for (let t = 0; t < SECS; t += 0.05) { Z.aimCameraAt(aim); Z.stepSim(0.05); }
          Z.simInput(null); for (let t = 0; t < 3; t += 0.05) Z.stepSim(0.05);
          const d = Z.dummyDamage(tid);
          Z.removeUnit(tid);
          return d;
        };
        const res = {};
        if (Z.selectWeapon) {
          for (const s of Z.weaponSlots().slots) res[`slot${s.slot}:${s.id}`] = run({ fire: true }, s.slot);
        } else {
          res.lmb = run({ fire: true, groups: [true, false, false, false] });
          res.all = run({ fire: true, groups: [true, true, true, true] });
        }
        return res;
      }, { lane, target, range, SECS });
      out.push({ shooter, target, range, r });
      console.log(shooter, target, range, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +(v / SECS).toFixed(2)]))));
    }
    await page.close();
  }
} finally { await browser.close(); server.kill(); }
