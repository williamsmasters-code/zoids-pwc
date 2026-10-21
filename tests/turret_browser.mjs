// Command Wolf back turret in game: tracks the LOCKED target behind and
// beside while running, fires, rotates the back mount, and holds fire with
// no lock even when an enemy is close. Screenshots in screenshots/balance/.
//
//   node tests/turret_browser.mjs

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "balance");
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
      owned: zoidId === "commandWolf",
      armorLevel: {},
      mods: { speed: 0, maneuver: 0, booster: 0 },
      condition: null,
      equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null },
    };
  }
  hangar.commandWolf.equipped.headWeapon = "w1";
  hangar.commandWolf.equipped.backMount = "w2";
  return {
    version: 1, money: 185000, selected: "commandWolf", missionsDone: 0, wins: 0, reputation: 0,
    contractSeed: 1001, nextUid: 3,
    inventory: [
      { uid: "w1", type: "pulseLaser", group: 1 },
      { uid: "w2", type: "doubleBeamCannon", group: 3 },
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
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (err) => note("pageerror", err.stack || err.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((save) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(save)), pilotSave());
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await page.evaluate(() => { window.__ZOIDS__.pacifyOnStart = true; });
  await page.click(".contract-btn");
  await page.click("#launch-go");
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
  await page.evaluate(() => window.__ZOIDS__.holdSim(true));
  const info = await page.evaluate(() => window.__ZOIDS__.turretDebug());
  if (!info.turrets.length) throw new Error("no turret on the Command Wolf");
  if (!info.enemies.length) throw new Error("no enemies to lock");
  const enemyId = info.enemies[0].id;

  // Place the enemy relative to the wolf's current pose (yaw 0 faces -Z).
  async function placeRelative(forward, right) {
    return page.evaluate(({ id, forward, right }) => {
      const d = window.__ZOIDS__.turretDebug();
      const yaw = d.chassisYaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = -fz, rz = fx;
      return window.__ZOIDS__.placeUnit(id, d.pos.x + fx * forward + rx * right, d.pos.z + fz * forward + rz * right);
    }, { id: enemyId, forward, right });
  }
  async function run(frames, follow) {
    let last = null;
    for (let i = 0; i < frames; i++) {
      if (follow) await follow();
      await page.evaluate(() => window.__ZOIDS__.stepSim(1 / 30));
    }
    last = await page.evaluate(() => window.__ZOIDS__.turretDebug());
    return last;
  }

  // 1) No lock: enemy 7 m to the right, running. Turret must not fire.
  await page.evaluate(() => window.__ZOIDS__.setLock(null));
  await page.keyboard.down("KeyW");
  const before0 = (await page.evaluate(() => window.__ZOIDS__.turretDebug())).turrets[0].fired;
  const noLock = await run(45, () => placeRelative(0, 7));
  const noLockFired = noLock.turrets[0].fired - before0;
  console.log("no lock", JSON.stringify({ fired: noLockFired, yaw: noLock.turrets[0].yaw.toFixed(2), speed: noLock.speed.toFixed(1) }));
  if (noLockFired !== 0) note("nolock", `turret fired ${noLockFired} times without a lock`);
  if (Math.abs(noLock.turrets[0].yaw) > 0.05) note("nolock", `turret left rest without a lock (${noLock.turrets[0].yaw})`);

  // 2) Locked target directly behind (25 m) while running.
  await page.evaluate((id) => window.__ZOIDS__.setLock(id), enemyId);
  const startFired = noLock.turrets[0].fired;
  const armor0 = noLock.enemies.find((e) => e.id === enemyId).armor;
  let fired = startFired;
  let rearShot = null;
  for (let i = 0; i < 60; i++) {
    await placeRelative(-25, 0);
    await page.evaluate(() => window.__ZOIDS__.stepSim(1 / 30));
    const d = await page.evaluate(() => window.__ZOIDS__.turretDebug());
    if (d.turrets[0].fired > fired && !rearShot) {
      rearShot = d;
      await page.screenshot({ path: path.join(shots, "command-wolf-turret-firing-backwards.png") });
    }
    fired = d.turrets[0].fired;
  }
  const behind = await page.evaluate(() => window.__ZOIDS__.turretDebug());
  const tb = behind.turrets[0];
  console.log("behind", JSON.stringify({ fired: tb.fired - startFired, yaw: tb.yaw.toFixed(2), pivotYaw: tb.pivotYaw == null ? null : tb.pivotYaw.toFixed(2), speed: behind.speed.toFixed(1) }));
  if (!(tb.fired - startFired > 0)) note("behind", "turret never fired at the locked target behind");
  if (!(Math.abs(tb.yaw) > 2.6)) note("behind", `turret yaw ${tb.yaw} is not pointing back`);
  if (tb.pivotYaw != null && Math.abs(tb.pivotYaw - tb.yaw) > 1e-6) note("pivot", "back mount mesh did not follow the turret yaw");
  if (tb.pivotYaw == null) note("pivot", "no back mount pivot on the model");
  if (!(behind.speed > 5)) note("moving", `wolf was not moving (${behind.speed})`);
  const armor1 = behind.enemies.find((e) => e.id === enemyId);
  if (armor1 && !(armor1.armor < armor0)) note("damage", "locked target took no damage");
  console.log("lastHit", JSON.stringify(tb.lastHit));
  console.log("enemy hp", armor0.toFixed(1), "->", armor1 ? armor1.armor.toFixed(1) : "dead");

  // 3) Locked target beside (right, 30 m) while running.
  const sideStart = tb.fired;
  let sideShot = false;
  for (let i = 0; i < 45; i++) {
    await placeRelative(4, 30);
    await page.evaluate(() => window.__ZOIDS__.stepSim(1 / 30));
    const d = await page.evaluate(() => window.__ZOIDS__.turretDebug());
    if (!sideShot && d.turrets[0].fired > fired && Math.abs(d.turrets[0].yaw + Math.PI / 2) < 0.4) {
      sideShot = true;
      await page.screenshot({ path: path.join(shots, "command-wolf-turret-firing-sideways.png") });
    }
    fired = d.turrets[0].fired;
  }
  const side = await page.evaluate(() => window.__ZOIDS__.turretDebug());
  console.log("beside", JSON.stringify({ fired: side.turrets[0].fired - sideStart, yaw: side.turrets[0].yaw.toFixed(2), speed: side.speed.toFixed(1) }));
  if (!(side.turrets[0].fired - sideStart > 0)) note("beside", "turret never fired at the locked target beside");
  await page.keyboard.up("KeyW");

  // 4) Lock released: turret returns to rest and stops firing.
  await page.evaluate(() => window.__ZOIDS__.setLock(null));
  const rest = await run(40, () => placeRelative(0, 8));
  console.log("released", JSON.stringify({ fired: rest.turrets[0].fired - side.turrets[0].fired, yaw: rest.turrets[0].yaw.toFixed(2) }));
  if (rest.turrets[0].fired !== side.turrets[0].fired) note("release", "turret kept firing after the lock was released");
  await page.screenshot({ path: path.join(shots, "command-wolf-turret-no-lock-rest.png") });

  // 5) AI Zoids use their own turrets on their own lock target.
  const ai = (await page.evaluate(() => window.__ZOIDS__.turretDebug())).enemies.filter((e) => e.turrets.length);
  if (ai.length) {
    await page.evaluate(() => window.__ZOIDS__.setPacified(false));
    const aiStart = Object.fromEntries(ai.map((e) => [e.id, e.turrets[0].fired]));
    for (const e of ai) await page.evaluate(({ id }) => {
      const d = window.__ZOIDS__.turretDebug();
      return window.__ZOIDS__.placeUnit(id, d.pos.x + 20, d.pos.z + 25);
    }, { id: e.id });
    for (let i = 0; i < 150; i++) await page.evaluate(() => window.__ZOIDS__.stepSim(1 / 30));
    const after = (await page.evaluate(() => window.__ZOIDS__.turretDebug())).enemies;
    for (const e of ai) {
      const now = after.find((x) => x.id === e.id);
      if (!now) { console.log("ai turret", e.zoid, "destroyed during check"); continue; }
      const shots = now.turrets[0].fired - aiStart[e.id];
      console.log("ai turret", e.zoid, JSON.stringify({ lockId: now.lockId, fired: shots, yaw: now.turrets[0].yaw.toFixed(2) }));
      if (now.lockId && !(shots > 0)) note("ai", `${e.zoid} turret did not fire at its lock`);
    }
    await page.evaluate(() => window.__ZOIDS__.setPacified(true));
  } else {
    console.log("ai turret: no turreted enemy in this contract");
  }
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`turret browser FAILED (${errors.length})`);
  process.exit(1);
}
console.log("\nturret browser ok");
