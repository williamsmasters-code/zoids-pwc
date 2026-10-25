// Browser check for the five new Zoids: 4-view, hangar preview and an
// in-game third-person shot each, with no page errors. Writes
// screenshots/new-zoids/<id>-{views,hangar,ingame}.png
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER, ZOIDS, stockWeaponsFor } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "new-zoids");
fs.mkdirSync(shots, { recursive: true });
const NEW = ["gunSniper", "elephander", "berserkFuhrer", "molga", "pteras", "deathStinger", "deathSaurer"];
const port = 8197;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error(t); };

function save(id) {
  const hangar = {};
  for (const z of ZOID_ORDER) hangar[z] = { owned: z === id || NEW.includes(z), armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  const inventory = [];
  stockWeaponsFor(ZOIDS[id], () => 0.2).forEach((w, i) => {
    inventory.push({ uid: `s${i}`, type: w.type, group: w.group });
    hangar[id].equipped[w.mount] = `s${i}`;
  });
  return { version: 1, money: 500000, selected: id, missionsDone: 0, wins: 0, reputation: 0, contractSeed: 1001, nextUid: 20, inventory, hangar };
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|GLB fallback/i.test(m.text())) note(`console: ${m.text()}`); });
  await page.setViewport({ width: 1200, height: 800 });
  for (const id of NEW) {
    await page.goto(`http://127.0.0.1:${port}/tools/zoid_views.html?id=${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__viewsReady, { timeout: 60000 });
    const f = path.join(shots, `${id}-views.png`);
    await page.screenshot({ path: f });
    console.log("screenshot", path.relative(root, f));
  }
  await page.setViewport({ width: 1280, height: 720 });
  for (const id of NEW) {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save(id));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    const opts = await page.$$eval("#zoid-select option", (o) => o.map((x) => x.value));
    if (!opts.includes(id)) note(`hangar: ${id} missing from dropdown`);
    await page.select("#zoid-select", id);
    await sleep(1500);
    const info = await page.evaluate(() => window.__ZOIDS__.previewParts());
    if (!info || !info.counts || !info.counts.core) note(`hangar: ${id} preview has no core`);
    let f = path.join(shots, `${id}-hangar.png`);
    await page.screenshot({ path: f });
    console.log("screenshot", path.relative(root, f));
    await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
    await page.click(".contract-btn");
    await page.click("#launch-go");
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
    await sleep(1500);
    f = path.join(shots, `${id}-ingame.png`);
    await page.screenshot({ path: f });
    console.log("screenshot", path.relative(root, f));
    const st = await page.evaluate(() => window.__ZOIDS__.selfTest && window.__ZOIDS__.selfTest());
    console.log(id, "mission selfTest", JSON.stringify(st).slice(0, 120));
    if (!st || !st.ok) note(`${id} mission selfTest failed: ${JSON.stringify(st && st.failures)}`);
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`${errors.length} failure(s)`); process.exit(1); }
console.log("new zoids browser ok");
