#!/usr/bin/env node
// Hangar screenshots at Daniel's viewport (1024x488) and 1280x800.
//   node tools/hangar_shots.mjs <prefix>      e.g. before / after
// Save: rich company, several Zoids owned, Death Saurer ACTIVE, viewing
// Shield Liger (the state in his screenshot).
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prefix = process.argv[2] || "shot";
const out = path.join(root, "screenshots", "hangar-rework");
const port = 8093;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 900));

const ids = ["commandWolf", "zaberFang", "shieldLiger", "bladeLiger", "ironKong", "genoSaurer", "gojulas", "deathSaurer"];
const hangar = {};
for (const id of ids) {
  hangar[id] = {
    owned: id !== "bladeLiger",
    armorLevel: {},
    mods: { speed: 0, maneuver: 0, booster: 0 },
    condition: null,
    equipped: { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null },
  };
}
hangar.shieldLiger.equipped.headWeapon = "w1";
hangar.shieldLiger.equipped.rightWeapon = "w2";
hangar.shieldLiger.equipped.backMount = "w3";
const save = {
  version: 1, money: 3478682, selected: "deathSaurer", missionsDone: 40, wins: 36, reputation: 36,
  contractSeed: 1001, nextUid: 4,
  inventory: [
    { uid: "w1", type: "pulseLaser", group: 1 },
    { uid: "w2", type: "beamCannon", group: 2 },
    { uid: "w3", type: "missilePack", group: 2 },
  ],
  hangar,
};

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  for (const [w, h] of [[1024, 488], [1280, 800]]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("zoidMercs.save.v1", JSON.stringify(s)), save);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
    if (await page.$("#zoid-select")) await page.select("#zoid-select", "shieldLiger");
    else await page.click('[data-act="view"][data-id="shieldLiger"]');
    await new Promise((r) => setTimeout(r, 2500));
    const file = path.join(out, `${prefix}-hangar-${w}x${h}.png`);
    await page.screenshot({ path: file });
    console.log("screenshot", path.relative(root, file));
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
