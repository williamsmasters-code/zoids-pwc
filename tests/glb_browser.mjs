// Screenshots of the five real Zoids and the mocks they replace.
// Also checks part coverage, first-person luma, fallback, and frame time.
//
//   node tests/glb_browser.mjs

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "models");
await mkdir(shots, { recursive: true });

const PILOTS = [
  ["commandWolf", "command-wolf", "quad"],
  ["shieldLiger", "shield-liger", "quad"],
  ["bladeLiger", "blade-liger", "quad"],
  ["ironKong", "iron-kong", "biped"],
  ["genoSaurer", "geno-saurer", "biped"],
];

const QUAD = ["head", "core", "leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg", "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon"];
const BIPED = ["head", "core", "leftLeg", "rightLeg", "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon"];

const port = 8080;
const server = spawn("python3", ["-m", "http.server", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

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

function pilotSave(id) {
  const ids = ["commandWolf", "zaberFang", "shieldLiger", "bladeLiger", "ironKong", "genoSaurer", "gojulas", "deathSaurer"];
  const hangar = {};
  for (const zoidId of ids) {
    hangar[zoidId] = {
      owned: zoidId === id,
      armorLevel: {},
      mods: { speed: 0, maneuver: 0, booster: 0 },
      equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null },
      condition: null,
    };
  }
  hangar[id].equipped.headWeapon = "w1";
  hangar[id].equipped.leftWeapon = "w2";
  return {
    version: 1,
    money: 185000,
    selected: id,
    missionsDone: 0,
    wins: 0,
    reputation: 0,
    contractSeed: 1001,
    nextUid: 3,
    inventory: [
      { uid: "w1", type: "pulseLaser", group: 1 },
      { uid: "w2", type: "pulseLaser", group: 2 },
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
  const page = await browser.newPage();
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
    if (page.__ignoreGlb && /\.glb(\?|$)/.test(res.url())) return;
    note("http", `${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    if (/favicon\.ico/.test(req.url())) return;
    if (page.__ignoreGlb && /\.glb(\?|$)/.test(req.url())) return;
    note("request", `${req.url()} ${req.failure()?.errorText || ""}`);
  });

  async function open(url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready, { timeout: 60000 });
  }

  async function view(id) {
    await page.click(`button[data-act="view"][data-id="${id}"]`);
    await sleep(450);
  }

  await open(`http://127.0.0.1:${port}/?mock=1`);
  for (const [id, slug] of PILOTS) {
    await view(id);
    const info = await page.evaluate(() => window.__ZOIDS__.previewParts());
    if (!info || info.glb) note("mock", `${slug} preview is not the procedural model`);
    const file = path.join(shots, `${slug}-mock.png`);
    await page.screenshot({ path: file });
    console.log("screenshot", path.relative(root, file));
  }

  await open(`http://127.0.0.1:${port}/`);
  await page.click('button[data-act="credits"]');
  await sleep(100);
  const credits = await page.$eval("#credits-panel", (el) => el.innerText);
  if (!/CC-BY-4\.0/.test(credits) || !/guntuy3/.test(credits) || !/hdbanks1/.test(credits)) {
    note("credits", "credits panel is missing author or license text");
  }
  await page.click('button[data-act="close-credits"]');

  for (const [id, slug, layout] of PILOTS) {
    await view(id);
    const info = await page.evaluate(() => window.__ZOIDS__.previewParts());
    const need = layout === "quad" ? QUAD : BIPED;
    if (!info || !info.glb) note("hangar", `${slug} did not load the GLB`);
    for (const partId of need) {
      if (!info || !info.counts[partId]) note("parts", `${slug} hangar missing ${partId}`);
    }
    const file = path.join(shots, `${slug}-hangar.png`);
    await page.screenshot({ path: file });
    console.log("screenshot", path.relative(root, file));
  }

  let loggedFrame = false;
  for (const [id, slug] of PILOTS) {
    await page.evaluate((save) => {
      localStorage.setItem("zoidMercs.save.v1", JSON.stringify(save));
    }, pilotSave(id));
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    await page.evaluate(() => {
      window.__ZOIDS__.pacifyOnStart = true;
    });
    await page.click("button.launch");
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission", { timeout: 60000 });
    await sleep(600);
    if (!loggedFrame) {
      const avg = await page.evaluate(() => new Promise((resolve) => {
        const samples = [];
        let last = performance.now();
        let n = 0;
        function tick(now) {
          samples.push(now - last);
          last = now;
          n += 1;
          if (n < 40) requestAnimationFrame(tick);
          else {
            const body = samples.slice(1);
            resolve(body.reduce((sum, value) => sum + value, 0) / body.length);
          }
        }
        requestAnimationFrame(tick);
      }));
      console.log("avg frame ms", avg.toFixed(2));
      if (avg > 100) note("frame", `average frame ${avg.toFixed(1)} ms`);
      loggedFrame = true;
    }
    const tps = path.join(shots, `${slug}-tps.png`);
    await page.screenshot({ path: tps });
    console.log("screenshot", path.relative(root, tps));
    await page.keyboard.down("KeyV");
    await sleep(40);
    await page.keyboard.up("KeyV");
    await sleep(400);
    const fpv = path.join(shots, `${slug}-fpv.png`);
    await page.screenshot({ path: fpv });
    console.log("screenshot", path.relative(root, fpv));
    const luma = await centerLuma(fpv);
    console.log(slug, "fpv center", luma.avg.toFixed(1), "dark", luma.darkFrac.toFixed(3));
    if (luma.avg < 80 || luma.darkFrac > 0.12) {
      note("fpv", `${slug} center luma ${luma.avg.toFixed(1)} dark ${luma.darkFrac.toFixed(3)}`);
    }
    const hidden = await page.evaluate(() => {
      const vis = window.__ZOIDS__.bodyVisibility && window.__ZOIDS__.bodyVisibility();
      return vis;
    });
    if (hidden && hidden.body && hidden.body.some((row) => row.visible)) {
      note("fpv", `${slug} still draws a body mesh in first person`);
    }
  }

  page.__ignoreGlb = true;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/\.glb(\?|$)/.test(req.url())) req.abort();
    else req.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem("zoidMercs.save.v1"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready, { timeout: 60000 });
  const fallback = await page.evaluate(() => window.__ZOIDS__.previewParts());
  if (!fallback || fallback.glb) note("fallback", "blocked GLB still rendered as a real model");
  if (!fallback || !fallback.counts.head) note("fallback", "mock fallback has no head");
  console.log("browser fallback ok", fallback && fallback.id, fallback && fallback.glb);
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\n${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nglb browser ok");
