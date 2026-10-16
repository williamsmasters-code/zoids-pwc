// Loads the game in headless Chrome, screenshots hangar and mission,
// and checks controls, the part HUD, enemy movement, and the payout loop.
//
//   node tests/headless.mjs
//
// Requires /usr/bin/google-chrome and puppeteer-core.

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots");
await mkdir(shots, { recursive: true });

const port = 8080;
const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

function stopServer() {
  if (!server.killed) server.kill("SIGTERM");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) {
      throw new Error(`http.server exited ${server.exitCode}: ${serverLog}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  throw new Error(`server did not answer: ${serverLog}`);
}

const errors = [];
function note(kind, text) {
  const line = `${kind}: ${text}`;
  if (/favicon/i.test(text)) return;
  errors.push(line);
  console.error(line);
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
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
  const page = await browser.newPage();
  page.on("pageerror", (err) => note("pageerror", err.stack || err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // Chrome logs a generic line for the missing favicon. Real misses are caught below.
    if (/Failed to load resource/i.test(text)) return;
    note("console", text);
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    if (/favicon\.ico/.test(res.url())) return;
    note("http", `${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    if (/favicon\.ico/.test(req.url())) return;
    note("request", `${req.url()} ${req.failure()?.errorText || ""}`);
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready, { timeout: 20000 });
  const boot = await page.$("#boot-error");
  if (boot) note("boot", await page.$eval("#boot-error", (el) => el.textContent));

  await page.screenshot({ path: path.join(shots, "hangar.png") });
  console.log("screenshot screenshots/hangar.png");

  const ids = await page.$$eval(".zoid-card", (els) => els.map((el) => el.dataset.id));
  if (ids.length !== 8) note("hangar", `expected 8 Zoid cards, saw ${ids.length}`);
  for (const id of ids) {
    await page.click(`.zoid-card[data-id="${id}"]`);
    await page.waitForFunction(
      (zoidId) => document.querySelector(`.zoid-card[data-id="${zoidId}"]`)?.classList.contains("viewing"),
      { timeout: 5000 },
      id,
    );
  }
  await page.click('.zoid-card[data-id="shieldLiger"]');
  const moneyBefore = await page.$eval("#money", (el) => el.textContent);
  console.log("hangar money", moneyBefore);

  await page.click(".contract-card .launch");
  await page.waitForFunction(
    () => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission" && typeof window.__ZOIDS__.selfTest === "function",
    { timeout: 20000 },
  );
  await sleep(1200);
  await page.screenshot({ path: path.join(shots, "mission.png") });
  console.log("screenshot screenshots/mission.png");

  const hud = await page.evaluate(() => {
    const playerRects = document.querySelectorAll("#player-diagram rect").length;
    const targetRects = document.querySelectorAll("#target-diagram rect").length;
    return {
      playerRects,
      targetRects,
      targetName: document.querySelector("#target-name")?.textContent || "",
      cam: document.querySelector("#cam-mode")?.textContent || "",
      objective: document.querySelector("#objective")?.textContent || "",
      strip: document.querySelector("#strip")?.textContent || "",
      contract: window.__ZOIDS__.contract,
      contractType: window.__ZOIDS__.contractType,
    };
  });
  console.log("mission", hud.contract, hud.contractType, "target", hud.targetName);
  if (hud.playerRects < 8) note("hud", `player part diagram has ${hud.playerRects} boxes`);
  if (hud.cam !== "3RD") note("hud", `camera label is ${hud.cam}`);
  if (!hud.strip.includes("V camera")) note("hud", "controls strip missing");
  if (!hud.objective) note("hud", "objective empty");

  const before = await page.evaluate(() => window.__ZOIDS__.enemySnapshot());
  await sleep(2200);
  const after = await page.evaluate(() => window.__ZOIDS__.enemySnapshot());
  if (!before.length) note("ai", "no mobile enemy Zoids");
  const moved = after.some((unit) => {
    const start = before.find((other) => other.id === unit.id);
    if (!start) return false;
    return Math.hypot(unit.x - start.x, unit.z - start.z) > 1 || Math.abs(unit.speed) > 0.4;
  });
  if (!moved) note("ai", `enemies did not move ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  else console.log("ai moved", after.map((unit) => `${unit.name} speed ${unit.speed.toFixed(1)}`).join("; "));

  const selfTest = await page.evaluate(() => window.__ZOIDS__.selfTest());
  if (!selfTest.ok) note("selfTest", selfTest.failures.join(" | "));
  else console.log("selfTest ok");

  const damage = await page.evaluate(() => window.__ZOIDS__.damageTest());
  if (!damage.ok) note("damageTest", JSON.stringify(damage));
  else console.log("damageTest ok", damage.before.toFixed(1), "->", damage.after.toFixed(1));

  const cam = await page.evaluate(() => document.querySelector("#cam-mode")?.textContent);
  if (cam !== "3RD") note("camera", `expected to finish in 3RD, saw ${cam}`);

  await page.evaluate(() => window.__ZOIDS__.debugForceWin());
  await page.waitForFunction(
    () => {
      const host = document.querySelector("#debrief-root");
      return host && !host.classList.contains("hidden") && host.querySelector("h2");
    },
    { timeout: 8000 },
  );
  const debrief = await page.evaluate(() => ({
    title: document.querySelector(".debrief h2")?.textContent || "",
    text: document.querySelector(".debrief")?.innerText || "",
    rects: document.querySelectorAll(".debrief-paper rect").length,
  }));
  console.log("debrief", debrief.title);
  if (debrief.title !== "CONTRACT COMPLETE") note("debrief", debrief.title || debrief.text);
  if (!/Payout\s+[1-9]/.test(debrief.text)) note("debrief", `payout missing: ${debrief.text}`);
  if (debrief.rects < 4) note("debrief", "damage diagram missing");

  await page.click("#repair-return");
  await page.waitForFunction(
    () => window.__ZOIDS__ && window.__ZOIDS__.screen === "hangar" && window.__ZOIDS__.ready,
    { timeout: 8000 },
  );
  const record = await page.$eval("#record", (el) => el.textContent);
  const moneyAfter = await page.$eval("#money", (el) => el.textContent);
  console.log("returned", record, moneyAfter);
  if (!record.startsWith("1 wins")) note("loop", `record is ${record}`);
  if (moneyAfter === moneyBefore) note("loop", "money did not change after payout");

  await page.screenshot({ path: path.join(shots, "debrief-return.png") });
} finally {
  if (browser) await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\n${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nheadless ok");
