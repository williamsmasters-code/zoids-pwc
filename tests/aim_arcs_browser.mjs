// Free look and mount arcs in a live mission (swiftshader):
//   1) mouse look reaches well up and down in third person, cockpit and the
//      sniper scope; a crosshair in the sky gives a valid far aim point
//   2) a flyer overhead: an elevating back weapon hits it, a chin gun is
//      OUT OF ARC (reticle, marker, dock) and holds fire
//   3) barrels stay inside their arcs while the view looks past them
//   4) a back turret (Command Wolf) swings and elevates onto a flyer
//   5) AI parity: an AI Zoid under a hovering player fires only weapons
//      whose arcs reach it
// Screenshots: screenshots/targeting/aim-up-at-flyer.png,
//   out-of-arc-indicator.png, turret-elevated.png
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openMission, findLane } from "../tools/targeting_hitrate.mjs";
import { pitchReach, flyerRate } from "../tools/aim_up_probe.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "targeting");
fs.mkdirSync(shots, { recursive: true });
const port = 8237;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const step = (page, secs, dt = 0.05) => page.evaluate(({ secs, dt }) => { for (let t = 0; t < secs - 1e-9; t += dt) window.__ZOIDS__.stepSim(dt); }, { secs, dt });

// Hover a Pteras `range` m ahead of the lane start, `alt` m up, and steer
// the view onto it with mouse-style input for `secs` (no direct writes).
async function hoverAndAim(page, lane, range, alt, secs, side = 0) {
  return page.evaluate(({ lane, range, alt, secs, side }) => {
    const Z = window.__ZOIDS__;
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw), rx = Math.cos(lane.yaw), rz = -Math.sin(lane.yaw);
    const tx = lane.x + fx * range + rx * side, tz = lane.z + fz * range + rz * side;
    const tid = Z.spawnTarget("pteras", tx, tz, lane.yaw + Math.PI);
    window.__hold = () => Z.placeUnit(tid, tx, tz, lane.yaw + Math.PI, alt);
    window.__hold();
    Z.setLock(tid);
    window.__aimTick = (extra = {}) => {
      window.__hold();
      const c = Z.camInfo();
      const p = Z.unitBounds(tid).lockPoint;
      const to = { x: p.x - c.pos.x, y: p.y - c.pos.y, z: p.z - c.pos.z };
      const len = Math.hypot(to.x, to.y, to.z);
      let dyaw = Math.atan2(-to.x, -to.z) - Math.atan2(-c.dir.x, -c.dir.z);
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const dpitch = Math.asin(to.y / len) - Math.asin(c.dir.y);
      Z.simInput({ ...extra, dx: -dyaw / 0.0023 * 0.6, dy: -dpitch / 0.002 * 0.6 });
      Z.stepSim(0.05);
    };
    for (let t = 0; t < secs; t += 0.05) window.__aimTick();
    Z.simInput(null);
    return tid;
  }, { lane, range, alt, secs, side });
}

try {
  // 1) Pitch reach.
  let page = await openMission(browser, port, "shieldLiger");
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  const lane = await findLane(page);
  if (!lane) throw new Error("no open lane");
  await page.evaluate((l) => { const Z = window.__ZOIDS__; Z.placeUnit(Z.turretDebug().id, l.x, l.z, l.yaw); }, lane);
  const toggleCam = () => page.evaluate(() => { const Z = window.__ZOIDS__; Z.simInput({ camera: true }); Z.stepSim(0.05); Z.simInput(null); return Z.camInfo().mode; });
  const reach = [];
  reach.push(await pitchReach(page, "tps"));
  if ((await toggleCam()) !== "fps") note("V did not switch to the cockpit");
  reach.push(await pitchReach(page, "fps"));
  await toggleCam();
  reach.push(await pitchReach(page, "scope"));
  for (const r of reach) {
    console.log("reach", JSON.stringify({ mode: r.mode, up: r.upDeg.toFixed(1), down: r.downDeg.toFixed(1), zoom: r.zoom, sky: { d: Math.round(r.sky.aimDist), elev: r.sky.aimElevDeg.toFixed(1) } }));
    if (!(r.upDeg >= 60)) note(`${r.mode}: view only reaches ${r.upDeg.toFixed(1)} deg up`);
    if (!(r.downDeg <= -45)) note(`${r.mode}: view only reaches ${r.downDeg.toFixed(1)} deg down`);
    if (!(r.sky.aimDist > 900)) note(`${r.mode}: sky aim point only ${r.sky.aimDist.toFixed(0)} m out`);
    if (!(Math.abs(r.sky.aimElevDeg - r.upDeg) < 1.5)) note(`${r.mode}: sky aim point not on the view line (${r.sky.aimElevDeg.toFixed(1)} vs ${r.upDeg.toFixed(1)})`);
  }
  if (reach[2].zoom < 3.9) note(`scope not zoomed during the pitch test (${reach[2].zoom})`);

  // 2) Flyer overhead (60 m out, 45 m up). Back sniper rifle can elevate; the
  //    chin pulse laser (15 deg up) cannot.
  await page.evaluate((l) => { const Z = window.__ZOIDS__; Z.placeUnit(Z.turretDebug().id, l.x, l.z, l.yaw); }, lane);
  const back = await flyerRate(page, lane, "backMount", "sniperRifle", 60, 45);
  const chin = await flyerRate(page, lane, "headWeapon", "pulseLaser", 60, 45);
  const flank = await flyerRate(page, lane, "rightWeapon", "beamCannon", 60, 20);
  const pods = await flyerRate(page, lane, "leftWeapon", "missilePack", 60, 45);
  console.log("flyer", JSON.stringify({ back: `${back.unit}/${back.shots}`, chin: `${chin.unit}/${chin.shots}`, flank20: `${flank.unit}/${flank.shots}`, missiles: `${pods.unit}/${pods.shots}` }));
  if (!(back.shots >= 3 && back.unit / back.shots >= 0.75)) note(`back sniper rifle vs flyer ${back.unit}/${back.shots}`);
  if (chin.shots !== 0) note(`chin pulse laser fired ${chin.shots} shots out of its arc`);
  if (!(flank.shots > 0 && flank.unit / flank.shots >= 0.9)) note(`flank beam cannon vs low flyer ${flank.unit}/${flank.shots}`);
  if (!(pods.shots > 0 && pods.unit / pods.shots >= 0.75)) note(`missiles vs flyer ${pods.unit}/${pods.shots}`);

  // Out-of-arc feedback with the chin gun selected and the view on the flyer.
  await page.evaluate(() => { const Z = window.__ZOIDS__; Z.installWeapon("headWeapon", "pulseLaser"); Z.installWeapon("backMount", "beamCannon"); Z.selectWeapon("headWeapon"); });
  const tid = await hoverAndAim(page, lane, 50, 45, 2.5);
  const hud = await page.evaluate(() => window.__ZOIDS__.arcHud());
  const arcs = await page.evaluate(() => window.__ZOIDS__.arcInfo());
  const headArc = arcs.weapons.find((w) => w.mount === "headWeapon");
  console.log("out of arc", JSON.stringify({ hud, head: { out: headArc.out, barrelElev: headArc.barrel.elevDeg.toFixed(1), up: headArc.arc.up } }));
  if (!hud.warn || !/OUT OF ARC/.test(hud.warn)) note(`no OUT OF ARC warning (${hud.warn})`);
  if (!/ELEVATION/.test(hud.warn || "")) note(`OUT OF ARC should name elevation (${hud.warn})`);
  if (!hud.reticleOut) note("reticle not dimmed out of arc");
  if (!hud.mark) note("no clamped fire point marker");
  const selRow = hud.dock.find((r) => r.sel);
  if (!selRow || selRow.arc !== "out") note(`dock row not flagged OUT OF ARC (${JSON.stringify(selRow)})`);
  // 3) The chin barrel stops at the top of its arc.
  if (!(headArc.out && headArc.barrel.elevDeg <= headArc.arc.up + 1)) note(`chin barrel past its arc: ${headArc.barrel.elevDeg.toFixed(1)} > ${headArc.arc.up}`);
  // Fire held: no shots while out of arc.
  const before = headArc.shots;
  await page.evaluate(() => { for (let t = 0; t < 1.5; t += 0.05) window.__aimTick({ fire: true }); window.__ZOIDS__.simInput(null); });
  const after = (await page.evaluate(() => window.__ZOIDS__.arcInfo())).weapons.find((w) => w.mount === "headWeapon").shots;
  if (after !== before) note(`chin gun fired ${after - before} shots out of arc`);
  await page.evaluate(() => window.__ZOIDS__.skipRender(false));
  await page.evaluate(() => window.__aimTick());
  await page.screenshot({ path: path.join(shots, "out-of-arc-indicator.png") });
  // Back beam cannon selected: in arc, barrel up on the flyer, hits.
  await page.evaluate(() => { window.__ZOIDS__.selectWeapon("backMount"); window.__ZOIDS__.shotTally(true); });
  await page.evaluate(() => { for (let t = 0; t < 0.4; t += 0.05) window.__aimTick(); for (let t = 0; t < 1.6; t += 0.05) window.__aimTick({ fire: true }); });
  const hud2 = await page.evaluate(() => window.__ZOIDS__.arcHud());
  const backArc = (await page.evaluate(() => window.__ZOIDS__.arcInfo())).weapons.find((w) => w.mount === "backMount");
  const tally = await page.evaluate(() => window.__ZOIDS__.shotTally(true).beamCannon || null);
  console.log("in arc", JSON.stringify({ warn: hud2.warn, barrelElev: backArc.barrel.elevDeg.toFixed(1), tally }));
  if (hud2.warn) note(`back beam cannon in arc but HUD says ${hud2.warn}`);
  if (!(backArc.barrel.elevDeg > 30)) note(`back barrel not elevated (${backArc.barrel.elevDeg.toFixed(1)})`);
  if (!tally || !(tally.unit / Math.max(1, tally.shots) >= 0.9)) note(`back beam cannon on flyer ${JSON.stringify(tally)}`);
  await page.screenshot({ path: path.join(shots, "aim-up-at-flyer.png") });
  await page.evaluate(() => { window.__ZOIDS__.simInput(null); window.__ZOIDS__.skipRender(true); });
  await page.evaluate((id) => window.__ZOIDS__.removeUnit(id), tid);

  // Traverse: a target far off the nose with the camera twisted is out of
  // a flank gun's 30 deg traverse until the chassis comes round.
  const trav = await page.evaluate(() => {
    const Z = window.__ZOIDS__;
    Z.installWeapon("rightWeapon", "beamCannon");
    Z.selectWeapon("rightWeapon");
    Z.stepSim(0.3);
    const yaw0 = Z.arcInfo().chassisYaw;
    Z.simInput({ dx: -0.75 / 0.0023 / 0.05 * 0.05 });
    Z.stepSim(0.05);
    Z.simInput(null);
    const a = Z.arcInfo().weapons.find((w) => w.mount === "rightWeapon");
    const h = Z.arcHud();
    return { yaw0, yaw1: Z.arcInfo().chassisYaw, out: a.out, barrelYaw: a.barrel.yawDeg, warn: h.warn };
  });
  console.log("traverse", JSON.stringify(trav));
  if (!trav.out || !/TRAVERSE/.test(trav.warn || "")) note(`traverse out of arc not flagged (${JSON.stringify(trav)})`);
  if (!(Math.abs(trav.barrelYaw) <= 31)) note(`flank barrel past its traverse (${trav.barrelYaw})`);
  await page.close();

  // 4) Command Wolf back turret elevates onto a flyer off to the side.
  page = await openMission(browser, port, "commandWolf");
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.evaluate((l) => { const Z = window.__ZOIDS__; Z.placeUnit(Z.turretDebug().id, l.x, l.z, l.yaw); }, lane);
  await page.evaluate(() => { window.__ZOIDS__.installWeapon("backMount", "beamCannon"); window.__ZOIDS__.selectWeapon("backMount"); });
  const tid2 = await page.evaluate((lane) => {
    const Z = window.__ZOIDS__;
    // Let the chassis settle on the view heading, then put the flyer off its right side.
    for (let t = 0; t < 1.5; t += 0.05) Z.stepSim(0.05);
    const cy = Z.arcInfo().chassisYaw;
    const me = Z.turretDebug().pos;
    const rx = Math.cos(cy), rz = -Math.sin(cy), fx = -Math.sin(cy), fz = -Math.cos(cy);
    const tx = me.x + rx * 35 + fx * 10, tz = me.z + rz * 35 + fz * 10;
    const id = Z.spawnTarget("pteras", tx, tz, 0);
    window.__hold = () => Z.placeUnit(id, tx, tz, 0, 40);
    window.__hold();
    Z.setLock(id);
    for (let t = 0; t < 3; t += 0.05) { window.__hold(); Z.stepSim(0.05); }
    return id;
  }, lane);
  const tur = await page.evaluate(() => {
    const Z = window.__ZOIDS__;
    Z.shotTally(true);
    Z.simInput({ fire: true });
    for (let t = 0; t < 1.5; t += 0.05) { window.__hold(); Z.stepSim(0.05); }
    Z.simInput(null);
    const info = Z.arcInfo();
    const w = info.weapons.find((x) => x.mount === "backMount");
    const me = Z.turretDebug().pos;
    const tp = Z.unitBounds(Z.turretDebug().lockId).root;
    let bearing = Math.atan2(-(tp.x - me.x), -(tp.z - me.z)) - info.chassisYaw;
    bearing = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    return { w, bearing, chassisYaw: info.chassisYaw, tally: Z.shotTally(true).beamCannon || null };
  });
  console.log("turret", JSON.stringify({ pivotYaw: tur.w.pivotYaw && tur.w.pivotYaw.toFixed(2), bearing: tur.bearing.toFixed(2), barrelElev: tur.w.barrel.elevDeg.toFixed(1), out: tur.w.out, tally: tur.tally }));
  if (!(Math.abs(tur.bearing) > 0.6 && Math.abs((tur.w.pivotYaw || 0) - tur.bearing) < 0.15)) note(`turret did not swing onto the flyer (pivot ${tur.w.pivotYaw}, bearing ${tur.bearing})`);
  if (!(tur.w.barrel.elevDeg > 35)) note(`turret barrel not elevated (${tur.w.barrel.elevDeg})`);
  if (!tur.tally || !(tur.tally.unit / Math.max(1, tur.tally.shots) >= 0.9)) note(`turret vs flyer ${JSON.stringify(tur.tally)}`);
  // Side camera: the turret pivoted and its barrel raised.
  await page.evaluate((lane) => {
    const Z = window.__ZOIDS__;
    const me = Z.turretDebug().pos;
    const g = Z.groundAt(me.x, me.z);
    const cy = Z.arcInfo().chassisYaw;
    const rx = Math.cos(cy), rz = -Math.sin(cy), fx = -Math.sin(cy), fz = -Math.cos(cy);
    Z.skipRender(false);
    // From the far side, low: the raised barrels point up toward the flyer.
    Z.showcase({ x: me.x - rx * 11 - fx * 2, y: g + 2.2, z: me.z - rz * 11 - fz * 2, lx: me.x + rx * 3 + fx * 3, ly: g + 5.2, lz: me.z + rz * 3 + fz * 3 });
    document.querySelector("#hud").style.visibility = "hidden";
    window.__hold();
    Z.stepSim(0.05);
  }, lane);
  await page.screenshot({ path: path.join(shots, "turret-elevated.png") });
  await page.evaluate(() => { window.__ZOIDS__.showcase(null); window.__ZOIDS__.skipRender(true); document.querySelector("#hud").style.visibility = ""; });
  await page.evaluate((id) => window.__ZOIDS__.removeUnit(id), tid2);
  await page.close();

  // 5) AI parity: the player Pteras hovers 50 m above, 25 m ahead of an AI
  //    Shield Liger (about 60 deg up). Only weapons whose arcs reach fire.
  page = await openMission(browser, port, "pteras");
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  const ai = await page.evaluate((lane) => {
    const Z = window.__ZOIDS__;
    const me = Z.turretDebug();
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw);
    const hold = () => { Z.placeUnit(me.id, lane.x, lane.z, lane.yaw, 50); Z.repairPlayer(); };
    hold();
    const foe = Z.spawnFoe("shieldLiger", lane.x + fx * 25, lane.z + fz * 25, lane.yaw);
    Z.setPacified(false);
    const picks = {};
    const shots = {};
    const violations = [];
    let last = Object.fromEntries(Z.arcInfo(foe).weapons.map((w) => [w.mount, w.shots]));
    let minElev = 90;
    for (let t = 0; t < 9; t += 0.05) {
      hold();
      Z.stepSim(0.05);
      const info = Z.arcInfo(foe);
      if (!info) break;
      const fb = Z.unitBounds(foe).root;
      const pb = Z.unitBounds(me.id).lockPoint;
      const elev = Math.atan2(pb.y - (fb.y + 2), Math.hypot(pb.x - fb.x, pb.z - fb.z)) * 180 / Math.PI;
      minElev = Math.min(minElev, elev);
      for (const w of info.weapons) {
        if (w.selected) picks[w.mount] = (picks[w.mount] || 0) + 1;
        const d = w.shots - (last[w.mount] || 0);
        if (d > 0) {
          shots[w.mount] = (shots[w.mount] || 0) + d;
          if (w.arc && elev > w.arc.up + 6) violations.push({ mount: w.mount, id: w.id, elev: Math.round(elev), up: Math.round(w.arc.up) });
        }
        last[w.mount] = w.shots;
      }
    }
    Z.setPacified(true);
    const info = Z.arcInfo(foe);
    return { picks, shots, violations, minElev: Math.round(minElev), weapons: info.weapons.map((w) => ({ id: w.id, mount: w.mount, arcUp: Math.round(w.arc.up), kind: w.arc.kind })) };
  }, lane);
  console.log("ai parity", JSON.stringify(ai));
  if (ai.violations.length) note(`AI fired outside its arcs: ${JSON.stringify(ai.violations.slice(0, 4))}`);
  if (!Object.keys(ai.shots).length) note("AI fired nothing at a hovering target its missiles can reach");
  if (ai.picks.headWeapon && ai.picks.headWeapon > (ai.picks.backMount || 0)) note(`AI kept its chin gun selected against a target overhead (${JSON.stringify(ai.picks)})`);
  await page.close();
} catch (e) {
  note(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(`aim/arcs browser: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log("aim arcs browser ok");
