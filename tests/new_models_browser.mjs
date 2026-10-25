// 2026-10-25 models: Geno Saurer, Death Saurer and Death Stinger load their
// GLBs (not the mock) in the hangar, stand upright and face forward. Hangar
// screenshots (front 3/4 and side): screenshots/new-models-20261025/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZOID_ORDER } from "../js/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "new-models-20261025");
// Second batch (Daniel, 25 Oct 15:19): replacement Gun Sniper + Zaber Fang.
const shotsB = path.join(root, "screenshots", "new-models-20261025b");
const BATCH_B = new Set(["gunSniper", "zaberFang"]);
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(shotsB, { recursive: true });
// Third batch (Daniel, 25 Oct 15:53): Gojulas.
const shotsC = path.join(root, "screenshots", "new-models-20261025c");
fs.mkdirSync(shotsC, { recursive: true });
const port = 8214;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const IDS = { genoSaurer: "geno-saurer", deathSaurer: "death-saurer", deathStinger: "death-stinger", gunSniper: "gun-sniper", zaberFang: "zaber-fang", gojulas: "gojulas" };
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  const opts = await page.$$eval("#zoid-select option", (o) => o.map((x) => x.value));
  for (const id of Object.keys(IDS)) if (!opts.includes(id)) note(`${id} missing from the dropdown`);
  if (opts.length !== ZOID_ORDER.length) note(`dropdown has ${opts.length} Zoids, catalog ${ZOID_ORDER.length}`);
  for (const [id, slug] of Object.entries(IDS)) {
    await page.select("#zoid-select", id);
    await sleep(1500);
    const info = await page.evaluate(() => window.__ZOIDS__.previewParts());
    console.log(id, JSON.stringify(info));
    if (!info || info.id !== id || !info.glb) note(`${id} hangar preview is not the GLB`);
    // Default view = front 3/4 (nose toward the camera)
    await page.evaluate(() => window.__ZOIDS__.previewSetView({ yaw: 0, pitch: 0.29, zoom: 1 }));
    await sleep(300);
    const v = await page.evaluate(() => window.__ZOIDS__.previewView());
    if (!(v.tailSide < -0.5)) note(`${id}: front view does not face the camera (tailSide ${v.tailSide.toFixed(2)})`);
    await page.screenshot({ path: path.join(id === "gojulas" ? shotsC : BATCH_B.has(id) ? shotsB : shots, `${slug}-front34.png`) });
    // Side: camera 90 degrees round from the nose, low angle
    await page.evaluate(() => window.__ZOIDS__.previewSetView({ yaw: Math.PI / 2 - Math.atan2(0.38, 1), pitch: 0.12, zoom: 1 }));
    await sleep(300);
    const s = await page.evaluate(() => window.__ZOIDS__.previewView());
    if (Math.abs(s.tailSide) > 0.2) note(`${id}: side view is not side-on (tailSide ${s.tailSide.toFixed(2)})`);
    await page.screenshot({ path: path.join(id === "gojulas" ? shotsC : BATCH_B.has(id) ? shotsB : shots, `${slug}-side.png`) });
    console.log("screenshots", `${slug}-front34.png`, `${slug}-side.png`);
  }
  await page.evaluate(() => window.__ZOIDS__.previewSetView({ yaw: 0, pitch: 0.29, zoom: 1 }));
  await page.click('[data-act="credits"]');
  const credits = await page.$eval("#credits-panel", (p) => p.innerText);
  for (const t of ["Death saurer Zoids (free)", "Death Stinger Zoids (free)", "Genosaurer Zoids (free)", "Anderson455", "Zaber Fang (supplied by Daniel Williams", "Gojulas (supplied by Daniel Williams"]) {
    if (!credits.includes(t)) note(`credits panel missing "${t}"`);
  }
} catch (e) {
  note(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(`new_models_browser: ${errors.length} failure(s)`); process.exit(1); }
console.log("new_models_browser: ok");
