// Speed UI: hangar current/max speed + 0-100, KM/H <-> MPH toggle saved in
// localStorage, HUD speed in the chosen unit. Screenshots: screenshots/speed/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "speed");
fs.mkdirSync(shots, { recursive: true });
const port = 8212;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ready = (page) => page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
const stat = (page) => page.evaluate(() => ({
  cur: Number(document.querySelector("#stat-speed").textContent),
  max: Number(document.querySelector("#stat-maxspeed").textContent),
  unit: document.querySelector("#speed-unit-btn").textContent,
  accel: document.querySelector("#stat-accel").textContent,
}));
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  const kmh = await stat(page);
  console.log("hangar kmh", JSON.stringify(kmh));
  if (kmh.unit !== "KM/H") note("default unit should be KM/H");
  if (!(kmh.cur > 0 && kmh.cur < kmh.max)) note("stock speed should be below canon max");
  if (!/s$/.test(kmh.accel)) note("0-100 stat missing");
  await page.screenshot({ path: path.join(shots, "hangar-kmh.png") });
  await page.click("#speed-unit-btn");
  const mph = await stat(page);
  console.log("hangar mph", JSON.stringify(mph));
  if (mph.unit !== "MPH" || Math.abs(mph.max - kmh.max * 0.621371) > 1) note("mph conversion wrong");
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  const kept = await stat(page);
  if (kept.unit !== "MPH") note("unit choice not saved across reload");
  await page.screenshot({ path: path.join(shots, "hangar-mph.png") });

  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  await (await page.$(".contract-btn")).click();
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await sleep(500);
  await page.keyboard.down("KeyW");
  await sleep(2500);
  const hud = await page.evaluate(() => ({ v: Number(document.querySelector("#speed").textContent), u: document.querySelector("#speed-unit").textContent }));
  await page.screenshot({ path: path.join(shots, "hud-mph.png") });
  await page.keyboard.up("KeyW");
  console.log("hud", JSON.stringify(hud));
  if (hud.u !== "mph") note("HUD unit should follow the saved choice");
  if (!(hud.v > 0 && hud.v <= mph.cur + 1)) note(`HUD speed ${hud.v} out of range (hangar ${mph.cur})`);
} catch (e) {
  note(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(`speed_browser: ${errors.length} failure(s)`); process.exit(1); }
console.log("speed_browser: ok");
