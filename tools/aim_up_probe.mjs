// Aim-up probe: how far the player can look / aim up and down (third
// person, cockpit, sniper scope) with real mouse-style input, what the
// crosshair ray gives when it points into the sky, and hit rates against a
// hovering Pteras with a pilot-style mouse loop (no direct camera writes).
//
//   node tools/aim_up_probe.mjs [treeRoot] [port] [--out file.json]
//
// treeRoot defaults to this repo; pass an older checkout for "before"
// numbers (it needs the read-only camInfo hook).
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openMission, findLane } from "./targeting_hitrate.mjs";

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pitch reach with mouse input only: dy per 0.05 s tick, 3 s each way.
export async function pitchReach(page, mode) {
  return page.evaluate(async (mode) => {
    const Z = window.__ZOIDS__;
    const step = (s) => { for (let t = 0; t < s - 1e-9; t += 0.05) Z.stepSim(0.05); };
    const base = mode === "scope" ? { alt: true } : {};
    if (mode === "scope") { Z.installWeapon("backMount", "sniperRifle"); Z.selectWeapon("backMount"); step(0.3); }
    Z.simInput({ ...base, dy: -120 });
    step(3);
    const up = Z.camInfo();
    const upAim = Z.aimInfo();
    const upView = Z.viewState();
    Z.simInput({ ...base, dy: 120 });
    step(4);
    const down = Z.camInfo();
    Z.simInput({ ...base, dy: 0 });
    step(0.2);
    Z.simInput(null);
    step(0.4);
    const toAim = { x: upAim.aim.x - up.pos.x, y: upAim.aim.y - up.pos.y, z: upAim.aim.z - up.pos.z };
    const aimDist = Math.hypot(toAim.x, toAim.y, toAim.z);
    return {
      mode, upDeg: up.elevDeg, downDeg: down.elevDeg, upPitch: up.lookPitch, downPitch: down.lookPitch,
      zoom: upView.zoom, scope: upView.scope,
      sky: { aimDist, aimElevDeg: Math.asin(toAim.y / Math.max(1e-6, aimDist)) * 180 / Math.PI },
    };
  }, mode);
}

// Pilot-style aim at a hovering flyer: each tick, mouse dx/dy proportional
// to the angle between the view and the target's centre of mass.
export async function flyerRate(page, lane, shooterMount, weapon, range, alt, secs = 6) {
  return page.evaluate(({ lane, shooterMount, weapon, range, alt, secs }) => {
    const Z = window.__ZOIDS__;
    const me = Z.turretDebug();
    Z.placeUnit(me.id, lane.x, lane.z, lane.yaw);
    Z.repairPlayer();
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw);
    const tx = lane.x + fx * range, tz = lane.z + fz * range;
    const tid = Z.spawnTarget("pteras", tx, tz, lane.yaw + Math.PI);
    const hold = () => Z.placeUnit(tid, tx, tz, lane.yaw + Math.PI, alt);
    hold();
    Z.installWeapon(shooterMount, weapon);
    Z.selectWeapon(shooterMount);
    Z.setLock(tid);
    let reach = 0;
    let n = 0;
    const tick = (fire) => {
      hold();
      const c = Z.camInfo();
      const b = Z.unitBounds(tid);
      const p = b.lockPoint;
      const to = { x: p.x - c.pos.x, y: p.y - c.pos.y, z: p.z - c.pos.z };
      const len = Math.hypot(to.x, to.y, to.z);
      const tYaw = Math.atan2(-to.x, -to.z), vYaw = Math.atan2(-c.dir.x, -c.dir.z);
      let dyaw = tYaw - vYaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const dpitch = Math.asin(to.y / len) - Math.asin(c.dir.y);
      Z.simInput({ fire, dx: -dyaw / 0.0023 * 0.6, dy: -dpitch / 0.002 * 0.6 });
      Z.stepSim(0.05);
      return Math.abs(dpitch) * 180 / Math.PI;
    };
    Z.clearProjectiles();
    for (let t = 0; t < 2.0; t += 0.05) tick(false);
    Z.shotTally(true);
    let err = 0;
    for (let t = 0; t < secs; t += 0.05) { err += tick(true); n++; }
    Z.simInput({});
    for (let t = 0; t < 4; t += 0.05) { hold(); Z.stepSim(0.05); }
    Z.simInput(null);
    const tally = Z.shotTally(true)[weapon] || { shots: 0, unit: 0, ground: 0, cover: 0, miss: 0 };
    const c = Z.camInfo();
    Z.removeUnit(tid);
    const elev = Math.atan2(alt, range) * 180 / Math.PI;
    return { weapon, mount: shooterMount, range, alt, elevDeg: elev, ...tally, rate: tally.shots ? tally.unit / tally.shots : null, meanPitchErrDeg: err / Math.max(1, n), finalViewDeg: c.elevDeg };
  }, { lane, shooterMount, weapon, range, alt, secs });
}

export const FLYER_CASES = [
  // shooter, mount, weapon
  ["shieldLiger", "headWeapon", "pulseLaser"],
  ["shieldLiger", "rightWeapon", "beamCannon"],
  ["shieldLiger", "leftWeapon", "missilePack"],
  ["shieldLiger", "backMount", "sniperRifle"],
  ["gunSniper", "backMount", "sniperRifle"],
  ["ironKong", "leftWeapon", "gatling"],
  ["commandWolf", "backMount", "beamCannon"],
];
export const FLYER_SPOTS = [[60, 20], [60, 45], [40, 50], [120, 65]];
// (Pteras ceiling is 70 m above the terrain, so every spot sits under it.)

export async function run(treeRoot = here, port = 8241) {
  const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: treeRoot, stdio: "ignore" });
  await sleep(900);
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 900000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const out = { reach: [], flyer: [] };
  try {
    let page = await openMission(browser, port, "shieldLiger");
    const lane = await findLane(page);
    out.lane = lane;
    await page.evaluate((l) => { const Z = window.__ZOIDS__; Z.placeUnit(Z.turretDebug().id, l.x, l.z, l.yaw); }, lane);
    out.reach.push(await pitchReach(page, "tps"));
    await page.evaluate(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.05); window.__ZOIDS__.simInput(null); });
    out.reach.push(await pitchReach(page, "fps"));
    await page.evaluate(() => { window.__ZOIDS__.simInput({ camera: true }); window.__ZOIDS__.stepSim(0.05); window.__ZOIDS__.simInput(null); });
    out.reach.push(await pitchReach(page, "scope"));
    for (const r of out.reach) console.log("reach", JSON.stringify(r));
    let current = "shieldLiger";
    for (const [shooter, mount, weapon] of FLYER_CASES) {
      if (shooter !== current) { await page.close(); page = await openMission(browser, port, shooter); current = shooter; }
      for (const [range, alt] of FLYER_SPOTS) {
        const r = await flyerRate(page, lane, mount, weapon, range, alt);
        r.shooter = shooter;
        out.flyer.push(r);
        console.log(`flyer ${shooter} ${weapon}@${mount} ${range} m out, ${alt} m up (${r.elevDeg.toFixed(0)} deg): ${r.unit}/${r.shots} hit, ground ${r.ground}, past ${r.miss}, view ${r.finalViewDeg.toFixed(1)} deg, pitch err ${r.meanPitchErrDeg.toFixed(1)} deg`);
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a, i, all) => a !== "--out" && all[i - 1] !== "--out");
  const tree = args[0] ? path.resolve(args[0]) : here;
  const port = Number(args[1] || 8241);
  const res = await run(tree, port);
  const oi = process.argv.indexOf("--out");
  if (oi > 0) fs.writeFileSync(process.argv[oi + 1], JSON.stringify(res, null, 2));
}
