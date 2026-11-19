// Targeting overhaul in a live mission (swiftshader):
//   hit volumes + centre of mass, lock assist, hit rates on the small Gun
//   Sniper (and the big Iron Kong for comparison), weapon selection with the
//   real mouse wheel and number keys (fire only the selected weapon), the
//   sniper scope on RMB, standard melee (in reach hits, out of reach misses,
//   animation plays, AI uses it).
// Screenshots: screenshots/targeting/ and screenshots/melee/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openMission, findLane, measure } from "../tools/targeting_hitrate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotsT = path.join(root, "screenshots", "targeting");
const shotsM = path.join(root, "screenshots", "melee");
fs.mkdirSync(shotsT, { recursive: true });
fs.mkdirSync(shotsM, { recursive: true });
const port = 8236;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

try {
  const page = await openMission(browser, port, "shieldLiger");
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  const Z = (fn, arg) => page.evaluate(fn, arg);
  const step = (secs, dt = 0.05) => Z(({ secs, dt }) => { for (let t = 0; t < secs - 1e-9; t += dt) window.__ZOIDS__.stepSim(dt); }, { secs, dt });
  const lane = await findLane(page);
  if (!lane) throw new Error("no open lane");
  // A spot `d` m ahead along the lane, `side` m to the right, facing back.
  const spot = (d, side = 0) => {
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw), rx = Math.cos(lane.yaw), rz = -Math.sin(lane.yaw);
    return { x: lane.x + fx * d + rx * side, z: lane.z + fz * d + rz * side, yaw: lane.yaw + Math.PI };
  };
  const home = () => Z((lane) => { const Z = window.__ZOIDS__; Z.placeUnit(Z.turretDebug().id, lane.x, lane.z, lane.yaw); Z.repairPlayer(); }, lane);

  // 1) Hit volume and centre of mass of the Gun Sniper.
  await home();
  const gs = spot(50);
  const gsId = await Z((s) => window.__ZOIDS__.spawnTarget("gunSniper", s.x, s.z, s.yaw), gs);
  const vol = await Z((id) => ({ v: window.__ZOIDS__.hitVolume(id), b: window.__ZOIDS__.unitBounds(id) }), gsId);
  const aim = vol.v.aim;
  const inBody = vol.v.boxes.some((b) => (b.partId === "core" || b.partId === "head") && aim.x >= b.min.x && aim.x <= b.max.x && aim.y >= b.min.y && aim.y <= b.max.y && aim.z >= b.min.z && aim.z <= b.max.z);
  const core = vol.v.boxes.filter((b) => b.partId === "core").map((b) => b.max.x - b.min.x).reduce((a, b) => Math.max(a, b), 0);
  console.log("gun sniper volume", JSON.stringify({ boxes: vol.v.boxes.length, aimY: aim.y.toFixed(2), coreWidth: core.toFixed(2), height: (vol.b.all.max.y - vol.b.all.min.y).toFixed(2) }));
  if (!inBody) note("Gun Sniper centre of mass is not inside its core/head");
  if (!(aim.y > 0.6 && aim.y < 1.8)) note(`Gun Sniper aim height ${aim.y}`);
  if (!(core >= 1.0)) note(`Gun Sniper core box not widened (${core})`);

  // 2) Lock assist: a crosshair a little off the centre snaps to it; off turns it off.
  await Z((id) => window.__ZOIDS__.setLock(id), gsId);
  await Z((b) => window.__ZOIDS__.aimCameraAt({ x: b.lockPoint.x + 0.3, y: b.lockPoint.y + 0.25, z: b.lockPoint.z }), vol.b);
  await step(0.1);
  const snap = await Z(() => window.__ZOIDS__.assistState());
  await Z(() => window.__ZOIDS__.setAssist("off"));
  await step(0.1);
  const off = await Z(() => window.__ZOIDS__.assistState());
  await Z(() => window.__ZOIDS__.setAssist("on"));
  console.log("assist", JSON.stringify({ snap: snap && snap.mode, off: off && off.mode }));
  if (!snap || snap.mode !== "snap") note(`assist did not snap to the centre of mass (${JSON.stringify(snap)})`);
  if (off && off.mode === "snap") note("assist still snapping when switched off");
  // Screenshot: locked Gun Sniper, reticle on the centre of mass.
  await Z(() => window.__ZOIDS__.skipRender(false));
  await Z((b) => window.__ZOIDS__.aimCameraAt(b.lockPoint), vol.b);
  await step(0.1);
  await page.screenshot({ path: path.join(shotsT, "gun-sniper-locked-50m.png") });
  await Z(() => window.__ZOIDS__.skipRender(true));
  await Z((id) => window.__ZOIDS__.removeUnit(id), gsId);

  // 3) Hit rates (player-style: lock, crosshair on the lock box, trigger held).
  const cases = [
    ["gunSniper", "pulseLaser", 80, 0.9, "headWeapon"],
    ["gunSniper", "beamCannon", 50, 0.9, "rightWeapon"],
    ["gunSniper", "beamCannon", 120, 0.9, "rightWeapon"],
    ["gunSniper", "shockCannon", 50, 0.75, "leftWeapon"],
    ["gunSniper", "missilePack", 25, 0.75, "backMount"],
    ["gunSniper", "sniperRifle", 160, 0.75, "backMount"],
    ["ironKong", "beamCannon", 120, 0.9, "rightWeapon"],
    ["ironKong", "missilePack", 120, 0.75, "backMount"],
  ];
  for (const [target, weapon, range, min, mount] of cases) {
    await home();
    const r = await measure(page, lane, target, weapon, range, 3, { mount });
    console.log("hit rate", target, weapon, `${range} m`, `${r.unit}/${r.shots}`, JSON.stringify({ ground: r.ground, cover: r.cover, past: r.miss }));
    if (!r.shots) note(`${weapon} fired no shots at ${target} ${range} m`);
    else if (r.rate < min) note(`${weapon} hit ${target} at ${range} m only ${(r.rate * 100).toFixed(0)}% (min ${min * 100}%)`);
  }
  await Z(() => window.__ZOIDS__.restoreWeapons && window.__ZOIDS__.restoreWeapons());
  await home();

  // 4) Selection with the real wheel and number keys; fire only the selected.
  await Z(() => { window.__ZOIDS__.simInput(null); window.__ZOIDS__.skipRender(false); });
  await page.mouse.move(640, 360);
  const sel = () => Z(() => window.__ZOIDS__.weaponSlots());
  const info = await sel();
  const n = info.slots.length;
  console.log("slots", info.slots.map((s) => `${s.slot}:${s.id}@${s.mount}`).join(" "));
  if (!info.slots[n - 1].innate) note("standard melee is not the last slot");
  const tick = () => step(1 / 60, 1 / 60);
  await page.keyboard.press("Digit2");
  await tick();
  if ((await sel()).selected !== 2) note("Digit2 did not select slot 2");
  await page.mouse.wheel({ deltaY: 100 });
  await tick();
  if ((await sel()).selected !== 3) note("wheel down did not select the next slot");
  await page.mouse.wheel({ deltaY: -100 });
  await tick();
  if ((await sel()).selected !== 2) note("wheel up did not select the previous slot");
  await page.keyboard.press("Digit1");
  await tick();
  await page.mouse.wheel({ deltaY: -100 });
  await tick();
  if ((await sel()).selected !== n) note("wheel up from slot 1 did not wrap to the last slot");
  await page.mouse.wheel({ deltaY: 100 });
  await tick();
  if ((await sel()).selected !== 1) note("wheel down from the last slot did not wrap to slot 1");
  await step(0.1);
  const dockSel = await Z(() => [...document.querySelectorAll("#weapon-dock .wep")].map((el) => el.dataset.selected));
  if (dockSel[0] !== "1" || dockSel.filter((s) => s === "1").length !== 1) note(`dock selection ${dockSel}`);
  await step(0.4);
  await page.mouse.down({ button: "left" });
  await step(0.15, 1 / 60);
  await page.mouse.up({ button: "left" });
  const cds = await Z(() => window.__ZOIDS__.weaponCooldowns());
  const sel1 = (await sel()).slots[0];
  const mine = cds.filter((c) => c.mount === sel1.mount);
  const others = cds.filter((c) => c.mount !== sel1.mount && c.mount !== "melee");
  console.log("fire selected", JSON.stringify(cds.map((c) => [c.mount, +c.cooldown.toFixed(2)])));
  if (!mine.some((c) => c.cooldown > 0.02)) note("LMB did not fire the selected weapon");
  if (others.some((c) => c.cooldown > 0.02)) note("LMB fired a weapon that was not selected");
  await page.screenshot({ path: path.join(shotsT, "weapon-dock-selection.png") });

  // 5) Sniper scope on RMB.
  await Z(() => window.__ZOIDS__.installWeapon("backMount", "sniperRifle"));
  await Z(() => window.__ZOIDS__.selectWeapon("sniperRifle"));
  const ks = spot(160);
  const ksId = await Z((s) => window.__ZOIDS__.spawnTarget("gunSniper", s.x, s.z, s.yaw), ks);
  await Z((id) => { window.__ZOIDS__.setLock(id); window.__ZOIDS__.aimCameraAt(window.__ZOIDS__.unitBounds(id).lockPoint); }, ksId);
  await step(0.3);
  const v0 = await Z(() => window.__ZOIDS__.viewState());
  await page.mouse.down({ button: "right" });
  await step(0.4, 1 / 60);
  const v1 = await Z(() => window.__ZOIDS__.viewState());
  await page.screenshot({ path: path.join(shotsT, "sniper-scope-4x.png") });
  console.log("scope", JSON.stringify({ fov0: v0.fov, fov1: +v1.fov.toFixed(2), overlay: v1.overlay, read: v1.readout }));
  if (!(Math.abs(v1.fov - v0.fov / 4) < 0.6)) note(`RMB scope did not zoom to ~4x (fov ${v0.fov} -> ${v1.fov})`);
  if (!v1.overlay) note("scope overlay not shown");
  if (!/\d+\s*m/.test(v1.readout || "")) note(`scope readout has no range (${v1.readout})`);
  const cdScope = await Z(() => window.__ZOIDS__.weaponCooldowns().find((c) => c.mount === "backMount"));
  if (cdScope && cdScope.cooldown > 0.05) note("RMB fired the sniper rifle instead of zooming");
  await page.mouse.up({ button: "right" });
  await step(0.4, 1 / 60);
  const vOut = await Z(() => window.__ZOIDS__.viewState());
  if (Math.abs(vOut.fov - v0.fov) > 0.6 || vOut.overlay) note(`releasing RMB did not leave the scope (fov ${vOut.fov})`);
  // Lower sensitivity: the same mouse move turns the view less while zoomed.
  const turn = (alt) => Z((alt) => {
    const Z = window.__ZOIDS__;
    Z.simInput({ alt });
    for (let i = 0; i < 24; i++) Z.stepSim(1 / 60);
    const a = Z.viewState().lookYaw;
    Z.simInput({ alt, dx: 60 });
    Z.stepSim(1 / 60);
    const b = Z.viewState().lookYaw;
    Z.simInput(null);
    for (let i = 0; i < 24; i++) Z.stepSim(1 / 60);
    return Math.abs(b - a);
  }, alt);
  const scopedTurn = await turn(true);
  const freeTurn = await turn(false);
  console.log("sensitivity", JSON.stringify({ scoped: +scopedTurn.toFixed(4), free: +freeTurn.toFixed(4) }));
  if (!(scopedTurn < freeTurn * 0.5)) note(`scoped look not slower (${scopedTurn} vs ${freeTurn})`);
  // 8x: hold RMB, then a second press while scoped.
  const z8 = await Z((id) => {
    const Z = window.__ZOIDS__;
    Z.simInput({ alt: true }); for (let i = 0; i < 20; i++) Z.stepSim(1 / 60);
    const z4 = Z.viewState().zoom;
    Z.simInput({ alt: true, altEdge: true }); Z.stepSim(1 / 60);
    Z.simInput({ alt: true }); for (let i = 0; i < 20; i++) Z.stepSim(1 / 60);
    // Re-aim through the scope (first-person sight) for the screenshot.
    Z.aimCameraAt(Z.unitBounds(id).lockPoint);
    for (let i = 0; i < 3; i++) Z.stepSim(1 / 60);
    return { z4, z8: Z.viewState().zoom, fov: Z.viewState().fov };
  }, ksId);
  console.log("zoom step", JSON.stringify(z8));
  if (!(z8.z4 > 3.5 && z8.z4 < 4.5)) note(`first zoom not 4x (${z8.z4})`);
  if (!(z8.z8 > 7)) note(`second right click did not step to 8x (${JSON.stringify(z8)})`);
  await page.screenshot({ path: path.join(shotsT, "sniper-scope-8x.png") });
  // Switching weapon with the wheel exits the scope even with RMB held.
  await Z(() => window.__ZOIDS__.simInput(null));
  await page.mouse.down({ button: "right" });
  await step(0.3, 1 / 60);
  await page.mouse.wheel({ deltaY: 100 });
  await step(0.3, 1 / 60);
  const vWheel = await Z(() => window.__ZOIDS__.viewState());
  // RMB held through the switch did not fire the new weapon (latched).
  const latched = await Z(() => window.__ZOIDS__.weaponSlots());
  const latchedSlot = latched.slots[latched.selected - 1];
  if (latchedSlot && latchedSlot.cooldown > 0.05) note(`RMB held through a wheel switch fired ${latchedSlot.id}`);
  await page.mouse.up({ button: "right" });
  if (vWheel.held || Math.abs(vWheel.fov - v0.fov) > 0.6) note(`wheel switch did not exit the scope (${JSON.stringify(vWheel)})`);
  await Z((id) => window.__ZOIDS__.removeUnit(id), ksId);
  await step(0.3);

  // 6) Standard melee: in reach hits, out of reach misses, the clip plays.
  await home();
  await Z(() => window.__ZOIDS__.selectWeapon("melee"));
  await step(1);
  const mSpot = spot(9);
  const dummy = await Z((s) => window.__ZOIDS__.spawnTarget("commandWolf", s.x, s.z, s.yaw + Math.PI / 2), mSpot);
  await Z((id) => { window.__ZOIDS__.setLock(id); window.__ZOIDS__.aimCameraAt(window.__ZOIDS__.unitBounds(id).lockPoint); }, dummy);
  await step(0.3);
  const chk = await Z((id) => window.__ZOIDS__.meleeCheck(id), dummy);
  const ret = await Z(() => window.__ZOIDS__.fireDebug().reticle.melee);
  console.log("melee check", JSON.stringify(chk), "reticle", JSON.stringify(ret));
  if (!chk || !chk.ok) note(`target 9 m ahead not in melee reach (${JSON.stringify(chk)})`);
  if (!ret || !ret.inReach) note("reticle does not show IN REACH");
  const pre = await Z(() => { const w = window.__ZOIDS__.weaponSlots(); return { sel: w.selected, ready: w.ready, slot: w.slots[w.selected - 1] }; });
  console.log("melee pre", JSON.stringify(pre));
  const swing = await Z((id) => {
    const Z = window.__ZOIDS__;
    Z.simInput({ fire: true });
    let maxU = 0, minRig = 0, clip = null;
    for (let i = 0; i < 24; i++) {
      Z.stepSim(1 / 40);
      const s = Z.meleeState();
      if (s) { maxU = Math.max(maxU, s.u); if (s.rig) minRig = Math.min(minRig, s.rig.z); clip = clip || s.clip; }
      if (i === 2) Z.simInput(null);
    }
    return { maxU, minRig, clip, dmg: Z.dummyDamage(id) };
  }, dummy);
  console.log("melee swing", JSON.stringify({ maxU: +swing.maxU.toFixed(2), rig: +swing.minRig.toFixed(2), clip: swing.clip, dmg: swing.dmg }));
  if (!(swing.dmg > 0)) note("melee in reach did no damage");
  if (!(swing.maxU > 0.6)) note("melee animation did not play through");
  if (swing.clip !== "Melee") note(`Shield Liger did not play its skinned Melee clip (${swing.clip})`);
  if (!(swing.minRig < -0.3)) note("no lunge on the melee rig");
  // Mid-swing screenshot from the side.
  await step(1);
  await home();
  await Z((s) => window.__ZOIDS__.placeUnit(s.id, s.x, s.z, s.yaw + Math.PI / 2), { ...mSpot, id: dummy });
  await Z((lane) => {
    const Z = window.__ZOIDS__;
    const p = Z.turretDebug().pos; const g = Z.groundAt(p.x, p.z);
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw), rx = Math.cos(lane.yaw), rz = -Math.sin(lane.yaw);
    Z.showcase({ x: p.x + rx * 13 + fx * 4, y: g + 3.5, z: p.z + rz * 13 + fz * 4, lx: p.x + fx * 4, ly: g + 1.6, lz: p.z + fz * 4 });
    document.querySelector("#hud").style.visibility = "hidden";
    Z.simInput({ fire: true });
    for (let i = 0; i < 40; i++) { Z.stepSim(1 / 40); const s = Z.meleeState(); if (s && s.u >= 0.42) break; if (i === 2) Z.simInput(null); }
    Z.simInput(null);
  }, lane);
  await page.screenshot({ path: path.join(shotsM, "shield-liger-strike-claw-mid-swing.png") });
  await Z(() => { window.__ZOIDS__.showcase(null); document.querySelector("#hud").style.visibility = ""; });
  await step(1);
  // Out of reach: 40 m, no damage.
  const far = spot(40);
  await home();
  await Z((s) => window.__ZOIDS__.placeUnit(s.id, s.x, s.z, s.yaw), { ...far, id: dummy });
  await step(0.2);
  const before = await Z((id) => window.__ZOIDS__.dummyDamage(id), dummy);
  const farChk = await Z((id) => window.__ZOIDS__.meleeCheck(id), dummy);
  await Z(() => window.__ZOIDS__.simInput({ fire: true }));
  await step(1.5, 1 / 40);
  await Z(() => window.__ZOIDS__.simInput(null));
  await step(0.5);
  const afterFar = await Z((id) => window.__ZOIDS__.dummyDamage(id), dummy);
  const farRet = await Z(() => window.__ZOIDS__.fireDebug().reticle.melee);
  console.log("melee far", JSON.stringify({ check: farChk, dmg: afterFar - before, reticle: farRet }));
  if (farChk && farChk.ok) note("40 m target reported in reach");
  if (afterFar - before > 0) note("melee out of reach still did damage");
  if (farRet && farRet.inReach) note("reticle shows IN REACH at 40 m");
  await Z((id) => window.__ZOIDS__.removeUnit(id), dummy);

  // 7) AI uses melee up close.
  await home();
  const foeSpot = spot(7);
  const foe = await Z((s) => window.__ZOIDS__.spawnFoe("commandWolf", s.x, s.z, s.yaw), foeSpot);
  await Z(() => window.__ZOIDS__.setPacified(false));
  const ai = await Z((id) => {
    const Z = window.__ZOIDS__;
    let swung = false, picked = null, style = null;
    for (let i = 0; i < 200 && !swung; i++) {
      Z.stepSim(1 / 40);
      const w = Z.weaponSlots(id);
      if (w) { const s = w.slots[w.selected - 1]; if (s && s.innate) picked = s.name; }
      const m = Z.meleeState(id);
      if (m) { swung = true; style = m.style; }
    }
    return { swung, picked, style };
  }, foe);
  await Z(() => window.__ZOIDS__.setPacified(true));
  console.log("ai melee", JSON.stringify(ai));
  if (!ai.picked) note("AI never selected its standard melee up close");
  if (!ai.swung) note("AI never swung its melee up close");
  await Z((id) => window.__ZOIDS__.removeUnit(id), foe);
  await page.close();

  // 8) Procedural melee on a non-skinned Zoid (Gojulas tail).
  const p2 = await openMission(browser, port, "gojulas");
  p2.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  const lane2 = await findLane(p2);
  const goj = await p2.evaluate((lane) => {
    const Z = window.__ZOIDS__;
    Z.placeUnit(Z.turretDebug().id, lane.x, lane.z, lane.yaw);
    Z.skipRender(false);
    Z.selectWeapon("melee");
    const p = Z.turretDebug().pos; const g = Z.groundAt(p.x, p.z);
    const fx = -Math.sin(lane.yaw), fz = -Math.cos(lane.yaw), rx = Math.cos(lane.yaw), rz = -Math.sin(lane.yaw);
    Z.showcase({ x: p.x + rx * 26 + fx * 2, y: g + 7, z: p.z + rz * 26 + fz * 2, lx: p.x + fx * 2, ly: g + 4, lz: p.z + fz * 2 });
    document.querySelector("#hud").style.visibility = "hidden";
    Z.simInput({ fire: true });
    let maxSwing = 0, parts = null;
    for (let i = 0; i < 40; i++) {
      Z.stepSim(1 / 40);
      const s = Z.meleeState();
      if (s) { parts = s.parts; maxSwing = Math.max(maxSwing, ...s.swing, 0); if (s.u >= 0.42) break; }
      if (i === 2) Z.simInput(null);
    }
    Z.simInput(null);
    return { parts, maxSwing };
  }, lane2);
  await p2.screenshot({ path: path.join(shotsM, "gojulas-tail-smash-mid-swing.png") });
  console.log("gojulas melee", JSON.stringify(goj));
  if (!goj.parts || !goj.parts.includes("tail")) note("Gojulas melee did not swing its tail");
  if (!(goj.maxSwing > 0.2)) note(`Gojulas tail swing too small (${goj.maxSwing})`);
  await p2.close();
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.log(`${errors.length} failure(s)`); process.exit(1); }
console.log("targeting browser ok");
