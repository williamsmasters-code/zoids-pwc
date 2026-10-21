// Escort (Supply Push) in a real browser: difficulty slider UI, escort spawn
// distances, raiders switching to the player, and a bot-piloted run at
// difficulty 1, 3 and 5 to see whether the escort is winnable.
//   node tests/escort_browser.mjs
// Screenshots: screenshots/missions/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "missions");
await mkdir(shots, { recursive: true });
const port = 8094;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
process.on("exit", () => server.kill("SIGTERM"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];
const note = (kind, text) => { const line = `${kind}: ${text}`; if (!errors.includes(line)) { errors.push(line); console.error(line); } };

// Pilot loadout per run: a starter Shield Liger at D1, the same Liger with
// plating at D3, a plated Geno Saurer at D5 (what a player would bring).
function save(difficulty, pilot = "shieldLiger") {
  const ids = ["commandWolf", "zaberFang", "shieldLiger", "bladeLiger", "ironKong", "genoSaurer", "gojulas", "deathSaurer"];
  const hangar = {};
  for (const id of ids) {
    hangar[id] = { owned: id === "shieldLiger" || id === pilot, armorLevel: {}, mods: { speed: 0, maneuver: 0, booster: 0 }, condition: null,
      equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null } };
  }
  const plate = difficulty >= 3 ? 2 : 0;
  for (const part of ["head", "core", "leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg"]) hangar[pilot].armorLevel[part] = plate;
  if (pilot === "genoSaurer") {
    hangar[pilot].equipped = { headWeapon: "w1", leftWeapon: "w2", rightWeapon: "w3", backMount: "w4" };
  } else {
    hangar[pilot].equipped.headWeapon = "w1";
    hangar[pilot].equipped.leftWeapon = "w2";
    hangar[pilot].equipped.rightWeapon = "w3";
  }
  return {
    version: 1, money: 185000, selected: pilot, missionsDone: 4, wins: 4, reputation: 4,
    contractSeed: 1002, nextUid: 4, missionDifficulty: difficulty,
    inventory: [
      { uid: "w1", type: "pulseLaser", group: 1 },
      { uid: "w2", type: "beamCannon", group: 1 },
      { uid: "w3", type: "gatling", group: 1 },
      { uid: "w4", type: "chargedParticle", group: 2 },
    ],
    hangar,
  };
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  protocolTimeout: 600000, // long fixed-step batches on a slow swiftshader box
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
try {
  await sleep(800);
  for (const difficulty of [1, 3, 5]) {
    const page = await browser.newPage();
    page.on("pageerror", (err) => note("pageerror", err.message));
    page.on("dialog", (d) => d.accept());
    await page.setViewport(difficulty === 3 ? { width: 1024, height: 488 } : { width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), difficulty === 5 ? save(5, "genoSaurer") : save(difficulty === 3 ? 2 : difficulty));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    await page.click('.contract-btn[data-type="defend"]');
    await page.waitForSelector("#difficulty-slider");

    if (difficulty === 3) {
      // Slider UI: payout must update live and the choice must be remembered.
      const setSlider = (v) => page.evaluate((value) => {
        const el = document.querySelector("#difficulty-slider");
        el.value = String(value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return {
          pay: document.querySelector("#pop-payout").textContent,
          level: document.querySelector("#pop-level").textContent,
          enemies: document.querySelector("#pop-enemies").innerText,
          btnPay: document.querySelector('.contract-btn[data-type="defend"] .c-pay').textContent,
        };
      }, v);
      const seen = [];
      for (const v of [1, 2, 3, 4, 5]) seen.push(await setSlider(v));
      const pays = seen.map((s) => Number(s.pay.replace(/[^0-9]/g, "")));
      console.log("slider payouts", pays.join(" "), "|", seen.map((s) => s.level).join(" / "));
      for (let i = 1; i < pays.length; i++) if (!(pays[i] > pays[i - 1])) note("slider", `payout did not rise ${pays}`);
      if (seen[4].btnPay !== seen[4].pay) note("slider", "contract button payout not updated");
      await setSlider(3);
      await page.screenshot({ path: path.join(shots, "difficulty-slider-1024x488.png") });
      console.log("screenshot screenshots/missions/difficulty-slider-1024x488.png");
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("zoidMercs.save.v1")).missionDifficulty);
      if (stored !== 3) note("slider", `remembered ${stored}`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
      await page.click('.contract-btn[data-type="defend"]');
      const after = await page.$eval("#difficulty-slider", (el) => el.value);
      if (after !== "3") note("slider", `slider after reload ${after}`);
      if (await page.$(".c-diff")) {
        const dots = await page.$$eval(".contract-btn .c-diff", (els) => els.map((e) => e.textContent));
        if (dots.some((t) => /●/.test(t))) note("slider", "fixed dots still shown");
      }
      await page.setViewport({ width: 1280, height: 720 });
    }

    await page.click("#launch-go");
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.screen === "mission" && window.__ZOIDS__.escortInfo && window.__ZOIDS__.escortInfo(), { timeout: 60000 });
    const start = await page.evaluate(() => window.__ZOIDS__.escortInfo());
    const a = start.layout.ambush[0];
    const truckGap = start.layout.truckZ - a.z;
    const playerGap = Math.hypot(start.player.x - a.x, start.player.z - a.z);
    const nearestEnemy = Math.min(...start.enemies.map((e) => Math.min(...start.trucks.map((t) => Math.hypot(t.x - e.x, t.z - e.z)))));
    console.log(`D${difficulty} start: ambush at ${(a.fraction * 100).toFixed(0)}% route, ${truckGap.toFixed(0)} m from trucks, player ${playerGap.toFixed(0)} m, nearest raider to a truck ${nearestEnemy.toFixed(0)} m, ${start.enemies.length} raiders, truck core ${start.trucks[0].maxStructure.toFixed(0)}`);
    if (await page.evaluate(() => window.__ZOIDS__.difficulty) !== difficulty) note("difficulty", `mission difficulty ${difficulty}`);
    if (a.fraction < 0.4 || a.fraction > 0.7) note("escort", `ambush fraction ${a.fraction}`);
    if (nearestEnemy < 200) note("escort", `raider ${nearestEnemy} m from a truck at start`);
    if (playerGap < 220) note("escort", `player only ${playerGap} m from the ambush`);
    if (difficulty === 3) {
      await sleep(1200);
      await page.screenshot({ path: path.join(shots, "escort-start.png") });
      console.log("screenshot screenshots/missions/escort-start.png");
    }

    await page.evaluate(() => { window.__ZOIDS__.holdSim(true); window.__ZOIDS__.autopilot(true); });
    let info = start;
    let switched = null;
    let seenAt = null;
    let shotSeen = false;
    while (info.time < 240 && !info.ending) {
      info = await page.evaluate(() => {
        for (let i = 0; i < 20; i++) window.__ZOIDS__.stepSim(0.05);
        return window.__ZOIDS__.escortInfo();
      });
      if (info.seen && seenAt == null) seenAt = info.time;
      if (!switched) {
        const e = info.enemies.find((x) => x.alive && x.targetKind === "player");
        if (e) switched = { name: e.name, t: info.time, dist: Math.hypot(e.x - info.player.x, e.z - info.player.z), truckDist: Math.min(...info.trucks.filter((t) => t.alive).map((t) => Math.hypot(t.x - e.x, t.z - e.z))) };
      }
      if (difficulty === 3 && info.seen && !shotSeen) {
        shotSeen = true;
        await page.evaluate(() => window.__ZOIDS__.stepSim(0.016));
        await page.screenshot({ path: path.join(shots, "escort-ambush-spotted.png") });
        console.log("screenshot screenshots/missions/escort-ambush-spotted.png");
      }
    }
    for (let i = 0; i < 6 && !info.ending; i++) info = await page.evaluate(() => { window.__ZOIDS__.stepSim(0.05); return window.__ZOIDS__.escortInfo(); });
    const alive = info.trucks.filter((t) => t.alive).length;
    const kills = info.enemies.filter((e) => !e.alive).length;
    const r = { difficulty, victory: info.ending && info.victory, time: Math.round(info.time), trucksLeft: alive, kills, raiders: info.enemies.length, spotted: seenAt != null ? Math.round(seenAt) : null, switched };
    results.push(r);
    console.log(`D${difficulty} result`, JSON.stringify(r));
    if (!seenAt) note("escort", `D${difficulty} ambush was never spotted`);
    if (!switched) note("aggro", `D${difficulty} no raider ever switched to the player`);
    await page.close();
  }
  const d1 = results.find((r) => r.difficulty === 1);
  if (!d1 || !d1.victory) note("escort", "bot could not win the escort at difficulty 1");
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
console.log("escort summary", results.map((r) => `D${r.difficulty}:${r.victory ? "WIN" : "LOSS"}(${r.trucksLeft} trucks, ${r.kills}/${r.raiders} kills, ${r.time}s)`).join(" "));
if (errors.length) {
  console.error(`${errors.length} failure(s)`);
  process.exit(1);
}
console.log("escort browser ok");
