// Hangar showcase viewer: drag rotates, wheel / pinch zoom within limits,
// double-click and the reset button restore the view, auto-spin pauses while
// interacting, wheel doesn't scroll the page. Screenshots: screenshots/hangar-viewer/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "hangar-viewer");
fs.mkdirSync(shots, { recursive: true });
const port = 8213;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const v = (page) => page.evaluate(() => window.__ZOIDS__.previewView());
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
  await sleep(600);
  const box = await (await page.$("#preview-canvas")).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const v0 = await v(page);
  console.log("start", JSON.stringify(v0));
  if (!v0.autoSpin) note("auto-spin should run when idle");

  // Rotate + tilt by drag
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy + 50, { steps: 8 });
  const mid = await v(page);
  if (mid.autoSpin || !mid.dragging) note("auto-spin should pause while dragging");
  await sleep(400);
  const midLater = await v(page);
  if (Math.abs(midLater.spin - mid.spin) > 1e-6) note("model kept spinning during drag");
  await page.mouse.up();
  const dragged = await v(page);
  console.log("after drag", JSON.stringify(dragged));
  if (Math.abs(dragged.yaw - v0.yaw) < 1) note("drag did not rotate the model");
  if (dragged.pitch <= v0.pitch) note("vertical drag did not raise the camera pitch");
  await page.screenshot({ path: path.join(shots, "rotated.png") });

  // Wheel zoom in, limits, page doesn't scroll
  const scrollBefore = await page.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
  for (let i = 0; i < 12; i++) await page.mouse.wheel({ deltaY: -200 });
  await sleep(200);
  const zin = await v(page);
  console.log("zoom in", zin.zoom.toFixed(3), "dist", zin.dist.toFixed(2));
  if (Math.abs(zin.zoom - zin.zoomMin) > 1e-6) note("zoom-in should clamp at the minimum");
  await page.screenshot({ path: path.join(shots, "zoomed-in.png") });
  for (let i = 0; i < 20; i++) await page.mouse.wheel({ deltaY: 200 });
  await sleep(200);
  const zout = await v(page);
  console.log("zoom out", zout.zoom.toFixed(3), "dist", zout.dist.toFixed(2));
  if (Math.abs(zout.zoom - zout.zoomMax) > 1e-6) note("zoom-out should clamp at the maximum");
  const scrollAfter = await page.evaluate(() => [window.scrollY, document.scrollingElement.scrollTop]);
  if (JSON.stringify(scrollBefore) !== JSON.stringify(scrollAfter)) note("wheel leaked to page scroll");

  // Pinch (two touch pointers moving apart = zoom in)
  await page.evaluate(() => window.__ZOIDS__ && null);
  const pinched = await page.evaluate(async (x, y) => {
    const c = document.querySelector("#preview-canvas");
    const ev = (type, id, px) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: px, clientY: y, bubbles: true, cancelable: true }));
    const before = window.__ZOIDS__.previewView().zoom;
    ev("pointerdown", 11, x - 20); ev("pointerdown", 12, x + 20);
    for (let i = 1; i <= 5; i++) { ev("pointermove", 11, x - 20 - i * 20); ev("pointermove", 12, x + 20 + i * 20); }
    ev("pointerup", 11, x - 120); ev("pointerup", 12, x + 120);
    return { before, after: window.__ZOIDS__.previewView().zoom };
  }, cx, cy);
  console.log("pinch", JSON.stringify(pinched));
  if (!(pinched.after < pinched.before)) note("pinch-out did not zoom in");

  // Double-click resets
  await page.mouse.click(cx, cy, { clickCount: 2 });
  await sleep(100);
  const reset = await v(page);
  console.log("after dblclick", JSON.stringify(reset));
  if (Math.abs(reset.yaw) > 1e-6) note("double-click did not reset the orbit");
  if (Math.abs(reset.zoom - 1) > 1e-6 || Math.abs(reset.pitch - v0.pitch) > 1e-6 || reset.panX !== 0) note("double-click did not reset zoom/tilt");
  if (!reset.autoSpin) note("auto-spin should resume right after a reset");

  // Reset button
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 120, cy - 40, { steps: 5 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -300 });
  await page.click("#view-reset");
  const rb = await v(page);
  if (Math.abs(rb.yaw) > 1e-6 || Math.abs(rb.zoom - 1) > 1e-6 || Math.abs(rb.pitch - v0.pitch) > 1e-6) note("reset button did not reset");

  // Auto-spin resumes ~3 s after the last interaction
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy, { steps: 3 }); await page.mouse.up();
  const p1 = await v(page);
  if (p1.autoSpin) note("auto-spin should stay paused just after a drag");
  await sleep(3500);
  const p2 = await v(page);
  if (!p2.autoSpin) note("auto-spin did not resume after 3 s");
  console.log("resume", p1.autoSpin, "->", p2.autoSpin);

  // Any angle: drag far down -> top-down clamp at +85, far up -> underside -85
  const dragTo = async (dx, dy, button = "left") => {
    await page.mouse.move(cx, cy); await page.mouse.down({ button });
    await page.mouse.move(cx + dx, cy + dy, { steps: 12 }); await page.mouse.up({ button });
  };
  await dragTo(0, 260); await dragTo(0, 200);
  const top = await v(page);
  console.log("top", top.pitchDeg.toFixed(1), "camY", top.camY.toFixed(2), "centerY", top.centerY.toFixed(2));
  if (Math.abs(top.pitchDeg - 85) > 0.01) note("top view should clamp at +85 deg");
  if (!(top.camY > top.centerY + top.dist * 0.95)) note("top view camera not above the model");
  await sleep(150);
  await page.screenshot({ path: path.join(shots, "top.png") });
  await dragTo(0, -260); await dragTo(0, -260); await dragTo(0, -200);
  const under = await v(page);
  console.log("underside", under.pitchDeg.toFixed(1), "camY", under.camY.toFixed(2), "floor", under.floorVisible);
  if (Math.abs(under.pitchDeg + 85) > 0.01) note("underside should clamp at -85 deg");
  if (!(under.camY < 0) || under.floorVisible) note("underside: camera should be below and floor hidden");
  await sleep(150);
  await page.screenshot({ path: path.join(shots, "underside.png") });
  // Full 360 yaw: a long horizontal drag keeps going, no wrap limit
  await page.evaluate(() => window.__ZOIDS__.previewView());
  const y0 = (await v(page)).yaw;
  await dragTo(320, 0); await dragTo(320, 0);
  const y1 = (await v(page)).yaw;
  if (Math.abs(y1 - y0) < 6) note(`yaw should pass a full turn (${(y1 - y0).toFixed(2)} rad)`);
  // Rear view (drag-driven yaw, then exact via debug setter for the screenshot)
  await page.evaluate(() => window.__ZOIDS__.previewSetView({ yaw: Math.PI - Math.atan2(0.38, 1), pitch: 0.25, zoom: 1 }));
  await sleep(200);
  const rear = await v(page);
  console.log("rear tailSide", rear.tailSide.toFixed(3));
  if (rear.tailSide < 0.95) note("rear view camera is not behind the tail");
  await page.screenshot({ path: path.join(shots, "rear.png") });
  // Zoom bounds and no clipping
  await page.evaluate(() => window.__ZOIDS__.previewSetView({ zoom: 0.01 }));
  await sleep(200);
  const zmin = await v(page);
  await page.evaluate(() => window.__ZOIDS__.previewSetView({ zoom: 99 }));
  await sleep(200);
  const zmax = await v(page);
  console.log("zoom bounds", zmin.zoom, zmax.zoom, "min dist", zmin.dist.toFixed(2), "radius", zmin.radius.toFixed(2));
  if (zmin.zoom !== 0.35 || zmax.zoom !== 2.5) note("zoom bounds should be 0.35..2.5");
  if (!(zmin.dist > zmin.radius)) note("closest zoom clips into the model");
  if (!(zmax.dist > zmin.dist * 5)) note("zoom range should widen distance a lot");
  // Right-drag pans
  await page.evaluate(() => window.__ZOIDS__.previewSetView({ zoom: 1 }));
  await dragTo(80, 40, "right");
  const pan = await v(page);
  console.log("pan", pan.panX.toFixed(2), pan.panY.toFixed(2));
  if (pan.panX === 0 && pan.panY === 0) note("right-drag did not pan");
  await page.click("#view-reset");

  // Hangar controls still work (dropdown, credits)
  await page.click('[data-act="credits"]');
  const creditsOpen = await page.$eval("#credits-panel", (p) => !p.classList.contains("hidden"));
  if (!creditsOpen) note("credits button stopped working");
  await page.click('[data-act="close-credits"]').catch(() => {});
  await page.screenshot({ path: path.join(shots, "reset.png") });
} catch (e) {
  note(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(`hangar_viewer_browser: ${errors.length} failure(s)`); process.exit(1); }
console.log("hangar_viewer_browser: ok");
