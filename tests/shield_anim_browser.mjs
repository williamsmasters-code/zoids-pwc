// In-game Shield Liger clips: moving, shield, fire, first person, and fallback.
//
//   node tests/shield_anim_browser.mjs

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "shield-liger-anim");
await mkdir(shots, { recursive: true });

const port = 8080;
const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const pa = Math.abs(estimate - left);
  const pb = Math.abs(estimate - up);
  const pc = Math.abs(estimate - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

async function centerLuma(file) {
  const buf = await readFile(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prev = y === 0 ? -1 : row - stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = prev >= 0 ? pixels[prev + x] : 0;
      const upLeft = prev >= 0 && x >= channels ? pixels[prev + x - channels] : 0;
      const value = raw[src++];
      let decoded = value;
      if (filter === 1) decoded = (value + left) & 255;
      else if (filter === 2) decoded = (value + up) & 255;
      else if (filter === 3) decoded = (value + ((left + up) >> 1)) & 255;
      else if (filter === 4) decoded = (value + paeth(left, up, upLeft)) & 255;
      pixels[row + x] = decoded;
    }
  }
  const x0 = Math.floor(width * 0.4);
  const x1 = Math.floor(width * 0.6);
  const y0 = Math.floor(height * 0.35);
  const y1 = Math.floor(height * 0.65);
  let sum = 0;
  let dark = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = (y * width + x) * channels;
      const luma = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
      sum += luma;
      if (luma < 32) dark += 1;
      count += 1;
    }
  }
  return { avg: sum / count, darkFrac: dark / count };
}

function pilotSave() {
  const ids = ["commandWolf", "zaberFang", "shieldLiger", "bladeLiger", "ironKong", "genoSaurer", "gojulas", "deathSaurer"];
  const hangar = {};
  for (const zoidId of ids) {
    hangar[zoidId] = {
      owned: zoidId === "shieldLiger",
      armorLevel: {},
      mods: { speed: 0, maneuver: 0, booster: 0 },
      condition: null,
      equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null },
    };
  }
  hangar.shieldLiger.equipped.headWeapon = "w1";
  hangar.shieldLiger.equipped.rightWeapon = "w2";
  return {
    version: 1,
    money: 185000,
    selected: "shieldLiger",
    missionsDone: 0,
    wins: 0,
    reputation: 0,
    contractSeed: 1001,
    nextUid: 3,
    inventory: [
      { uid: "w1", type: "pulseLaser", group: 1 },
      { uid: "w2", type: "beamCannon", group: 1 },
    ],
    hangar,
  };
}

const errors = [];
function note(kind, text) {
  const line = `${kind}: ${text}`;
  if (errors.some((item) => item === line)) return;
  errors.push(line);
  console.error(line);
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`http.server exited ${server.exitCode}: ${serverLog}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error("http.server did not start");
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--window-size=1280,720",
  ],
  defaultViewport: { width: 1280, height: 720 },
});

try {
  await waitForServer();
  const page = await browser.newPage();
  page.__blockAnim = false;
  page.__blockAllGlb = false;
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (err) => note("pageerror", err.stack || err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
    if (/GLB fallback/i.test(text)) return;
    note("console", text);
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (/favicon\.ico/.test(res.url())) return;
    if ((page.__blockAnim || page.__blockAllGlb) && /\.glb(\?|$)/.test(res.url())) return;
    note("http", `${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    if (/favicon\.ico/.test(req.url())) return;
    if ((page.__blockAnim || page.__blockAllGlb) && /\.glb(\?|$)/.test(req.url())) return;
    note("request", `${req.url()} ${req.failure()?.errorText || ""}`);
  });

  async function openHangar() {
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  }

  await openHangar();
  await page.click('button[data-act="credits"]');
  await sleep(150);
  const credits = await page.$eval("#credits-panel", (el) => el.innerText);
  if (!/hdbanks1/.test(credits) || !/CC-BY-4\.0/.test(credits)) note("credits", "missing author or license");
  if (!/rigged with armature, split into segments, animated/.test(credits)) {
    note("credits", "hangar credits do not mention the rig");
  }
  await page.click('button[data-act="close-credits"]');

  await page.evaluate((save) => {
    localStorage.setItem("zoidMercs.save.v1", JSON.stringify(save));
  }, pilotSave());
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  const hangar = await page.evaluate(() => window.__ZOIDS__.previewParts());
  if (!hangar || hangar.anim !== "skinned") note("hangar", `preview anim is ${hangar && hangar.anim}`);
  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  await page.click("button.launch");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await sleep(400);

  // First person at the spawn, before the Zoid walks into a hostile.
  await page.keyboard.press("KeyV");
  await sleep(450);
  const fpv = path.join(shots, "fpv.png");
  await page.screenshot({ path: fpv });
  console.log("screenshot", path.relative(root, fpv));
  const luma = await centerLuma(fpv);
  console.log("fpv center", luma.avg.toFixed(1), "dark", luma.darkFrac.toFixed(3));
  if (luma.avg < 80 || luma.darkFrac > 0.12) {
    note("fpv", `center luma ${luma.avg.toFixed(1)} dark ${luma.darkFrac.toFixed(3)}`);
  }
  const hidden = await page.evaluate(() => window.__ZOIDS__.bodyVisibility && window.__ZOIDS__.bodyVisibility());
  if (hidden && hidden.body && hidden.body.some((row) => row.visible)) {
    note("fpv", "body mesh still visible in first person");
  }
  await page.keyboard.press("KeyV");
  await sleep(250);

  const avg = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let last = performance.now();
    let n = 0;
    function tick(now) {
      samples.push(now - last);
      last = now;
      n += 1;
      if (n < 40) requestAnimationFrame(tick);
      else resolve(samples.slice(1).reduce((sum, value) => sum + value, 0) / (samples.length - 1));
    }
    requestAnimationFrame(tick);
  }));
  console.log("avg frame ms", avg.toFixed(2));
  if (avg > 100) note("frame", `average frame ${avg.toFixed(1)} ms`);

  await page.keyboard.down("KeyW");
  await sleep(1100);
  const moving = await page.evaluate(() => window.__ZOIDS__.animState());
  console.log("moving", JSON.stringify(moving));
  if (!moving || moving.kind !== "skinned" || (moving.loco !== "Walk" && moving.loco !== "Run")) {
    note("loco", `expected walk or run, got ${JSON.stringify(moving)}`);
  }
  const tps = path.join(shots, "tps-moving.png");
  await page.screenshot({ path: tps });
  console.log("screenshot", path.relative(root, tps));
  await page.keyboard.up("KeyW");

  await page.keyboard.press("KeyQ");
  await sleep(1200);
  const shielded = await page.evaluate(() => window.__ZOIDS__.animState());
  console.log("shield", JSON.stringify(shielded));
  if (!shielded || shielded.shieldPhase !== "maintain") {
    note("shield", `expected ShieldMaintain, got ${JSON.stringify(shielded)}`);
  }
  if (shielded && shielded.firePlaying) note("shield", "Fire is playing while the shield is up");
  const shieldShot = path.join(shots, "shield-up.png");
  await page.screenshot({ path: shieldShot });
  console.log("screenshot", path.relative(root, shieldShot));

  await page.keyboard.press("KeyQ");
  await sleep(1200);
  const lowered = await page.evaluate(() => window.__ZOIDS__.animState());
  console.log("lowered", JSON.stringify(lowered));
  if (!lowered || lowered.shieldPhase !== "off") {
    note("shield", `shield did not lower (${JSON.stringify(lowered)})`);
  }

  await page.keyboard.down("Digit1");
  await sleep(250);
  const firing = await page.evaluate(() => window.__ZOIDS__.animState());
  console.log("firing", JSON.stringify(firing));
  if (!firing || !firing.firePlaying) note("fire", `Fire is not playing (${JSON.stringify(firing)})`);
  const fireShot = path.join(shots, "firing.png");
  await page.screenshot({ path: fireShot });
  console.log("screenshot", path.relative(root, fireShot));
  await page.keyboard.up("Digit1");

  page.__blockAnim = true;
  page.on("request", (req) => {
    const url = req.url();
    if (page.__blockAllGlb && /\.glb(\?|$)/.test(url)) req.abort();
    else if (page.__blockAnim && /shield-liger-anim\.glb/.test(url)) req.abort();
    else req.continue();
  });
  await page.setRequestInterception(true);
  await openHangar();
  const staticPreview = await page.evaluate(() => window.__ZOIDS__.previewParts());
  console.log("static fallback", JSON.stringify(staticPreview));
  if (!staticPreview || !staticPreview.glb || staticPreview.anim !== "static") {
    note("fallback", `blocked anim GLB did not use the static model (${JSON.stringify(staticPreview)})`);
  }

  page.__blockAllGlb = true;
  await page.evaluate(() => localStorage.removeItem("zoidMercs.save.v1"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready, { timeout: 60000 });
  await page.click('button[data-act="view"][data-id="shieldLiger"]');
  await sleep(300);
  const mockPreview = await page.evaluate(() => window.__ZOIDS__.previewParts());
  console.log("mock fallback", JSON.stringify(mockPreview));
  if (!mockPreview || mockPreview.glb) note("fallback", "blocked GLBs still rendered a file");
  if (!mockPreview || !mockPreview.counts || !mockPreview.counts.head) note("fallback", "mock has no head");
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\n${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nshield anim browser ok");
