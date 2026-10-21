// Range-band UI: hangar weapon lines list the bands; in a mission the dock
// shows each group's band on the locked target and the reticle is tinted by
// group 1. Screenshots: screenshots/range-bands/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER, ZOIDS, stockWeaponsFor } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "range-bands");
fs.mkdirSync(shots, { recursive: true });
const port = 8201;
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
  const inventory = [];
  stockWeaponsFor(ZOIDS[id]).forEach((w, i) => { inventory.push({ uid: `s${i}`, type: w.type, group: w.group }); hangar[id].equipped[w.mount] = `s${i}`; });
  return { version: 1, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1005, nextUid: 20, inventory, hangar };
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
  await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await sleep(800);
  const lines = await page.evaluate(() => document.body.innerText.match(/ideal [^\n]*/g) || []);
  console.log("hangar band lines", JSON.stringify(lines.slice(0, 3)));
  if (!lines.length) note("hangar weapon lines do not show range bands");
  await page.screenshot({ path: path.join(shots, "hangar-weapon-bands.png") });
  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  const btn = (await page.$('.contract-btn[data-type="destroy"]')) || (await page.$(".contract-btn"));
  await btn.click();
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await page.evaluate(() => window.__ZOIDS__.holdSim(true));
  const info = await page.evaluate(() => window.__ZOIDS__.turretDebug());
  const foe = info.enemies[0];
  const pid = await page.evaluate(() => {
    const t = window.__ZOIDS__.turretDebug();
    return window.__ZOIDS__.lastGroups ? null : null;
  });
  void pid;
  await page.evaluate((fid) => window.__ZOIDS__.setLock(fid), foe.id);
  const results = {};
  for (const [label, d] of [["ideal", 40], ["long", 66], ["extreme", 85], ["out", 220]]) {
    // Put the target d m straight ahead of the player.
    await page.evaluate(({ fid, d }) => {
      const t = window.__ZOIDS__.turretDebug();
      const yaw = t.chassisYaw;
      return window.__ZOIDS__.placeUnit(fid, t.pos.x - Math.sin(yaw) * d, t.pos.z - Math.cos(yaw) * d, yaw + Math.PI);
    }, { fid: foe.id, d });
    await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__ZOIDS__.stepSim(0.05); });
    const ui = await page.evaluate(() => ({
      reticle: document.querySelector(".reticle").dataset.band,
      groups: [...document.querySelectorAll("#weapon-dock .wep")].map((el) => `${el.dataset.group}:${el.dataset.band || "-"}`),
    }));
    results[label] = ui;
    console.log(label, d, "m", JSON.stringify(ui));
    if (ui.reticle !== label) note(`reticle band at ${d} m is ${ui.reticle}, expected ${label}`);
    await page.screenshot({ path: path.join(shots, `combat-${label}-${d}m.png`) });
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`${errors.length} failure(s)`); process.exit(1); }
console.log("range bands browser ok");
