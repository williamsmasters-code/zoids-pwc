// Loads the game in headless Chrome, screenshots hangar and mission,
// and checks controls, the part HUD, enemy movement, and the payout loop.
//
//   node tests/headless.mjs
//
// Requires /usr/bin/google-chrome and puppeteer-core.

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
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

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const pa = Math.abs(estimate - left);
  const pb = Math.abs(estimate - up);
  const pc = Math.abs(estimate - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

// Average luma of a center window. Puppeteer writes 8-bit RGB PNGs.
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
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    return dialog.accept();
  });
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
  await page.screenshot({ path: path.join(shots, "hangar-skills.png") });
  console.log("screenshot screenshots/hangar-skills.png");

  const ids = await page.$$eval(".zoid-card", (els) => els.map((el) => el.dataset.id));
  if (ids.length !== 8) note("hangar", `expected 8 Zoid cards, saw ${ids.length}`);
  const seenSkills = [];
  for (const id of ids) {
    await page.click(`.zoid-card[data-id="${id}"]`);
    await page.waitForFunction(
      (zoidId) => document.querySelector(`.zoid-card[data-id="${zoidId}"]`)?.classList.contains("viewing"),
      { timeout: 5000 },
      id,
    );
    const skill = await page.$eval("#skill-list", (el) => ({
      zoid: el.dataset.zoid,
      passive: el.querySelector("[data-kind='passive']")?.dataset.name || "",
      active: el.querySelector("[data-kind='active']")?.dataset.name || "",
      text: el.innerText,
    }));
    if (skill.zoid !== id || !skill.passive || !skill.active || !/Passive/.test(skill.text) || !/Active/.test(skill.text)) {
      note("skills", `${id} skill list ${JSON.stringify(skill)}`);
    }
    seenSkills.push(skill.active);
  }
  if (new Set(seenSkills).size !== 8) note("skills", `active names ${seenSkills.join(", ")}`);
  await page.click('.zoid-card[data-id="shieldLiger"]');
  const heatLine = await page.$eval("#weapon-heat", (el) => el.innerText);
  if (!/heat\/shot/.test(heatLine) || !/cool /.test(heatLine)) note("heat", `hangar heat line ${heatLine}`);
  const shopLine = await page.$eval(".shop-row", (el) => el.innerText);
  if (!/heat\/shot/.test(shopLine) || !/cool /.test(shopLine)) note("heat", `shop row ${shopLine}`);
  const freshTitles = await page.$$eval(".contract-card h4", (els) => els.map((el) => el.textContent));
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

  await page.evaluate(() => window.__ZOIDS__.setPacified(true));
  const dock = await page.evaluate(() => [...document.querySelectorAll("#weapon-dock .wep")].map((el) => ({
    group: el.dataset.group,
    state: el.dataset.state,
    text: el.innerText,
  })));
  console.log("weapon dock", dock.map((row) => `${row.group}:${row.state}`).join(" "));
  if (dock.length !== 4) note("weapons", `expected 4 group rows, saw ${dock.length}`);
  for (const row of dock) {
    if (!["ready", "cooling", "disabled", "empty"].includes(row.state)) {
      note("weapons", `group ${row.group} state ${row.state}`);
    }
  }
  if (dock[0] && dock[0].state === "empty") note("weapons", "group 1 is empty");
  if (dock[1] && dock[1].state === "empty") note("weapons", "group 2 is empty");
  if (dock[2] && dock[2].state !== "empty") note("weapons", `group 3 is ${dock[2].state}`);
  if (dock[3] && dock[3].state !== "empty") note("weapons", `group 4 is ${dock[3].state}`);

  function checkAim(label, aim) {
    console.log("aim", label, aim.mode, "align", aim.align.toFixed(4), "far", aim.far.toFixed(1), aim.hitKind);
    if (aim.align < 0.999) note("aim", `${label} crosshair align ${aim.align}`);
    if (aim.hitKind === "self") note("aim", `${label} ray hit the player's own Zoid`);
    const minFar = label === "tps" ? 15 : 3;
    if (aim.far < minFar) note("aim", `${label} aim point is only ${aim.far.toFixed(1)} m out`);
    if (!aim.errors.length) note("aim", `${label} has no weapon mounts`);
    for (const row of aim.errors) {
      if (!row.passes) note("aim", `${label} ${row.mount} misses by ${row.error.toFixed(3)} along ${row.along.toFixed(2)}`);
    }
  }
  checkAim("tps", await page.evaluate(() => window.__ZOIDS__.aimCheck()));
  await page.keyboard.down("KeyV");
  await sleep(90);
  await page.keyboard.up("KeyV");
  await sleep(50);
  const fpsLabel = await page.$eval("#cam-mode", (el) => el.textContent);
  if (fpsLabel !== "1ST") note("aim", `expected 1ST after V, saw ${fpsLabel}`);
  checkAim("fps", await page.evaluate(() => window.__ZOIDS__.aimCheck()));
  const fpvShot = path.join(shots, "fpv-after.png");
  await page.screenshot({ path: fpvShot });
  console.log("screenshot screenshots/fpv-after.png");
  const fpvBody = await page.evaluate(() => window.__ZOIDS__.bodyVisibility());
  if (fpvBody.mode !== "fps") note("fpv", `mode is ${fpvBody.mode}`);
  if (!fpvBody.body.length) note("fpv", "no body meshes");
  const shownBody = fpvBody.body.filter((mesh) => mesh.visible).map((mesh) => mesh.id);
  if (shownBody.length) note("fpv", `body still drawn: ${shownBody.join(",")}`);
  if (!fpvBody.weapons.length) note("fpv", "weapon meshes missing");
  const fpvCenter = await centerLuma(fpvShot);
  console.log("fpv center", fpvCenter.avg.toFixed(1), "dark", fpvCenter.darkFrac.toFixed(3));
  if (fpvCenter.avg < 80 || fpvCenter.darkFrac > 0.12) {
    note("fpv", `center is near-black avg ${fpvCenter.avg.toFixed(1)} dark ${fpvCenter.darkFrac.toFixed(3)}`);
  }
  await page.keyboard.down("KeyV");
  await sleep(90);
  await page.keyboard.up("KeyV");
  await sleep(50);
  const tpsLabel = await page.$eval("#cam-mode", (el) => el.textContent);
  if (tpsLabel !== "3RD") note("aim", `expected 3RD after second V, saw ${tpsLabel}`);
  const tpsBody = await page.evaluate(() => window.__ZOIDS__.bodyVisibility());
  if (tpsBody.mode !== "tps") note("fpv", `back in mode ${tpsBody.mode}`);
  const hiddenBody = tpsBody.body.filter((mesh) => !mesh.visible).map((mesh) => mesh.id);
  if (!tpsBody.body.length || hiddenBody.length) note("fpv", `third person hid body: ${hiddenBody.join(",")}`);
  const hiddenGuns = tpsBody.weapons.filter((mesh) => !mesh.visible).map((mesh) => mesh.id);
  if (hiddenGuns.length) note("fpv", `third person hid weapons: ${hiddenGuns.join(",")}`);

  async function waitCool() {
    const deadline = Date.now() + 900;
    while (Date.now() < deadline) {
      const hot = await page.evaluate(() => window.__ZOIDS__.weaponCooldowns().some((row) => row.cooldown > 0.02));
      if (!hot) return;
      await sleep(30);
    }
    note("weapons", "cooldown did not clear");
  }

  async function fireGroup(code, groupIndex) {
    await waitCool();
    if (code === "MouseRight") await page.mouse.move(640, 360);
    if (code === "MouseRight") await page.mouse.down({ button: "right" });
    else await page.keyboard.down(code);
    const deadline = Date.now() + 600;
    let sample = null;
    while (Date.now() < deadline) {
      sample = await page.evaluate((index) => {
        const rows = window.__ZOIDS__.weaponCooldowns();
        const groups = window.__ZOIDS__.lastGroups();
        const mine = rows.filter((row) => row.group === index + 1);
        const others = rows.filter((row) => row.group !== index + 1);
        const state = document.querySelector(`#weapon-dock .wep[data-group="${index + 1}"]`)?.dataset.state || "";
        return {
          held: !!groups[index],
          mine: mine.map((row) => row.cooldown),
          otherMax: others.reduce((max, row) => Math.max(max, row.cooldown), 0),
          state,
        };
      }, groupIndex);
      if (sample.held && sample.mine.some((cd) => cd > 0.04) && sample.otherMax < 0.02 && sample.state === "cooling") break;
      await sleep(20);
    }
    if (code === "MouseRight") await page.mouse.up({ button: "right" });
    else await page.keyboard.up(code);
    console.log("fired", code, JSON.stringify(sample));
    if (!sample || !sample.held) note("weapons", `${code} did not hold group ${groupIndex + 1}`);
    else if (!sample.mine.some((cd) => cd > 0.04)) note("weapons", `${code} did not fire group ${groupIndex + 1}`);
    else if (sample.otherMax >= 0.02) note("weapons", `${code} also cooled another group (${sample.otherMax})`);
    else if (sample.state !== "cooling") note("weapons", `${code} dock state ${sample.state}`);
  }

  await fireGroup("Digit1", 0);
  await fireGroup("Digit2", 1);
  const toGroup3 = await page.evaluate(() => window.__ZOIDS__.setGroup("leftWeapon", 3));
  if (!toGroup3 || !toGroup3.some((row) => row.mount === "leftWeapon" && row.group === 3)) {
    note("weapons", `setGroup 3 failed ${JSON.stringify(toGroup3)}`);
  }
  await fireGroup("Digit3", 2);
  const toGroup4 = await page.evaluate(() => window.__ZOIDS__.setGroup("leftWeapon", 4));
  if (!toGroup4 || !toGroup4.some((row) => row.mount === "leftWeapon" && row.group === 4)) {
    note("weapons", `setGroup 4 failed ${JSON.stringify(toGroup4)}`);
  }
  await fireGroup("Digit4", 3);
  await page.evaluate(() => window.__ZOIDS__.setGroup("leftWeapon", 2));
  await fireGroup("MouseRight", 1);

  await page.keyboard.down("Digit1");
  let heatSample = null;
  const heatDeadline = Date.now() + 8000;
  while (Date.now() < heatDeadline) {
    heatSample = await page.evaluate(() => {
      const rows = window.__ZOIDS__.weaponHeat();
      const dock = [...document.querySelectorAll("#weapon-dock .wep")].map((el) => ({
        group: el.dataset.group,
        state: el.dataset.state,
        heat: el.dataset.heat,
      }));
      return { rows, dock, peak: document.querySelector("#heat-bar")?.style.width || "" };
    });
    const hot = heatSample.rows.find((row) => row.group === 1);
    const other = heatSample.rows.find((row) => row.group === 2);
    const dock1 = heatSample.dock.find((row) => row.group === "1");
    if (hot && hot.overheated && other && !other.overheated && dock1 && dock1.state === "overheated") break;
    await sleep(40);
  }
  await page.keyboard.up("Digit1");
  console.log("weapon heat", JSON.stringify(heatSample));
  const group1 = heatSample && heatSample.rows.find((row) => row.group === 1);
  const group2 = heatSample && heatSample.rows.find((row) => row.group === 2);
  if (!group1 || !group1.overheated) note("heat", `group 1 did not overheat ${JSON.stringify(heatSample)}`);
  if (!group2 || group2.overheated || group2.heat > 40) note("heat", `group 2 was not independent ${JSON.stringify(group2)}`);
  const dock1 = heatSample && heatSample.dock.find((row) => row.group === "1");
  const dock2 = heatSample && heatSample.dock.find((row) => row.group === "2");
  if (!dock1 || dock1.state !== "overheated") note("heat", `dock group 1 ${dock1 && dock1.state}`);
  if (!dock2 || dock2.state === "overheated" || dock2.state === "disabled") {
    note("heat", `dock group 2 ${dock2 && dock2.state}`);
  }
  if (!heatSample || !heatSample.peak.startsWith("100")) note("heat", `peak bar ${heatSample && heatSample.peak}`);
  await page.screenshot({ path: path.join(shots, "heat-dock.png") });
  console.log("screenshot screenshots/heat-dock.png");

  await page.keyboard.down("KeyQ");
  await sleep(90);
  await page.keyboard.up("KeyQ");
  await sleep(120);
  const shield = await page.evaluate(() => ({
    skill: window.__ZOIDS__.skillState(),
    text: document.querySelector("#skill-hud")?.innerText || "",
    state: document.querySelector("#skill-hud")?.dataset.state || "",
  }));
  console.log("skill", shield.state, shield.skill.hold);
  if (shield.skill.name !== "Energy Shield" || !shield.skill.active || shield.state !== "active") {
    note("skills", `shield did not arm ${JSON.stringify(shield)}`);
  }
  if (!/cannot fire/i.test(shield.text)) note("skills", `missing hold message ${shield.text}`);
  await page.screenshot({ path: path.join(shots, "skills-hud.png") });
  console.log("screenshot screenshots/skills-hud.png");
  const beforeShot = await page.evaluate(() => window.__ZOIDS__.weaponCooldowns().find((row) => row.group === 2));
  await page.keyboard.down("Digit2");
  await sleep(180);
  await page.keyboard.up("Digit2");
  const afterShot = await page.evaluate(() => window.__ZOIDS__.weaponCooldowns().find((row) => row.group === 2));
  if (!beforeShot || !afterShot || afterShot.cooldown > beforeShot.cooldown + 0.02) {
    note("skills", `shield let group 2 fire ${beforeShot && beforeShot.cooldown} -> ${afterShot && afterShot.cooldown}`);
  }
  await page.keyboard.down("KeyQ");
  await sleep(90);
  await page.keyboard.up("KeyQ");
  await sleep(80);
  const shieldDown = await page.evaluate(() => window.__ZOIDS__.skillState());
  if (shieldDown.active || shieldDown.locked) note("skills", `shield stayed up ${JSON.stringify(shieldDown)}`);

  await page.evaluate(() => window.__ZOIDS__.setPacified(false));

  const selfTest = await page.evaluate(() => window.__ZOIDS__.selfTest());
  if (!selfTest.ok) note("selfTest", selfTest.failures.join(" | "));
  else console.log("selfTest ok");

  const damage = await page.evaluate(() => window.__ZOIDS__.damageTest());
  if (!damage.ok) note("damageTest", JSON.stringify(damage));
  else console.log("damageTest ok", damage.before.toFixed(1), "->", damage.after.toFixed(1));
  if (!damage.dock || !damage.dock.some((row) => row.state === "disabled")) {
    note("weapons", `destroyed mount did not show disabled ${JSON.stringify(damage.dock)}`);
  }
  if (!damage.dock || !damage.dock.some((row) => row.state === "empty")) {
    note("weapons", `missing empty group while damaged ${JSON.stringify(damage.dock)}`);
  }

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

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("zoidMercs.save.v1"));
    raw.money = 1234;
    raw.wins = 9;
    raw.reputation = 9;
    raw.missionsDone = 9;
    raw.hangar.commandWolf.owned = true;
    localStorage.setItem("zoidMercs.save.v1", JSON.stringify(raw));
    localStorage.setItem("zoidMercs.other", "x");
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready, { timeout: 20000 });
  const dirty = await page.evaluate(() => ({
    money: document.querySelector("#money")?.textContent || "",
    record: document.querySelector("#record")?.textContent || "",
    wolf: document.querySelector('.zoid-card[data-id="commandWolf"] small')?.textContent || "",
  }));
  console.log("dirty company", dirty.money, dirty.record, dirty.wolf);
  if (!dirty.money.includes("1,234")) note("reset", `dirty money is ${dirty.money}`);
  if (!dirty.record.startsWith("9 wins")) note("reset", `dirty record is ${dirty.record}`);
  if (!dirty.wolf.includes("owned")) note("reset", `wolf was not owned after reload (${dirty.wolf})`);

  dialogs.length = 0;
  await page.click("#reset-btn");
  await page.waitForFunction(
    () => document.querySelector("#money")?.textContent === "185,000 C",
    { timeout: 8000 },
  );
  const reset = await page.evaluate(() => ({
    money: document.querySelector("#money")?.textContent || "",
    record: document.querySelector("#record")?.textContent || "",
    wolf: document.querySelector('.zoid-card[data-id="commandWolf"] small')?.textContent || "",
    groups: [...document.querySelectorAll('button[data-act="group"]')].map((el) => el.textContent),
    titles: [...document.querySelectorAll(".contract-card h4")].map((el) => el.textContent),
    save: localStorage.getItem("zoidMercs.save.v1"),
    other: localStorage.getItem("zoidMercs.other"),
    screen: window.__ZOIDS__ && window.__ZOIDS__.screen,
  }));
  console.log("reset company", reset.money, reset.record, reset.groups.join(","));
  if (!dialogs.some((message) => /Reset the company/.test(message))) note("reset", `confirm text: ${dialogs.join(" | ")}`);
  if (reset.money !== "185,000 C") note("reset", `money is ${reset.money}`);
  if (!reset.record.startsWith("0 wins")) note("reset", `record is ${reset.record}`);
  if (reset.wolf.includes("owned")) note("reset", `wolf still owned (${reset.wolf})`);
  if (!reset.groups.includes("Group 1") || !reset.groups.includes("Group 2")) {
    note("reset", `groups ${reset.groups.join(",")}`);
  }
  if (JSON.stringify(reset.titles) !== JSON.stringify(freshTitles)) {
    note("reset", `contracts ${reset.titles.join(" | ")} vs ${freshTitles.join(" | ")}`);
  }
  if (reset.save !== null) note("reset", "save key still present");
  if (reset.other !== null) note("reset", "zoidMercs.other still present");
  if (reset.screen !== "hangar") note("reset", `screen is ${reset.screen}`);

  await page.screenshot({ path: path.join(shots, "debrief-return.png") });

  await page.evaluate(() => {
    window.__ZOIDS__.pacifyOnStart = true;
  });
  await page.click('.contract-card[data-type="recon"] .launch');
  await page.waitForFunction(
    () => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission" && window.__ZOIDS__.contractType === "recon",
    { timeout: 20000 },
  );
  await page.evaluate(() => window.__ZOIDS__.setPacified(true));
  await sleep(400);
  const survey = await page.evaluate(() => window.__ZOIDS__.frameSurveyShot());
  await sleep(250);
  await page.screenshot({ path: path.join(shots, "survey-objectives.png") });
  console.log("screenshot screenshots/survey-objectives.png");
  console.log("survey", JSON.stringify(survey));
  if (!survey || survey.rows.length < 3) note("survey", `expected 3 beacons, saw ${survey && survey.rows.length}`);
  if (!survey.rows.some((row) => row.beyond)) note("survey", "no beacon past radar range");
  if (!survey.rows.some((row) => row.arrow)) note("survey", "no edge indicator");
  if (!survey.rows.some((row) => row.miniClamped)) note("survey", "minimap did not clamp a far objective");
  if (survey.rows.some((row) => row.fog !== false || row.markerDepth !== false || row.spriteDepth !== false)) {
    note("survey", "beacon fog or depthTest was left on");
  }
  const arrows = await page.$$eval(".obj-arrow", (els) => els.map((el) => el.innerText));
  if (!arrows.length) note("survey", "screen arrow missing");
  else if (!arrows.some((text) => /\d+\s*m/.test(text))) note("survey", `arrow has no distance ${arrows.join(" | ")}`);
  const objective = await page.$eval("#objective", (el) => el.textContent);
  if (!/beacon/i.test(objective)) note("survey", `objective text ${objective}`);
} finally {
  if (browser) await browser.close();
  stopServer();
}

if (errors.length) {
  console.error(`\n${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nheadless ok");
