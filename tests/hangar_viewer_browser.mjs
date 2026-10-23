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
  if (dragged.lift <= v0.lift) note("vertical drag did not tilt the view");
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
  if (Math.abs(reset.zoom - 1) > 1e-6 || Math.abs(reset.lift - v0.lift) > 1e-6) note("double-click did not reset zoom/tilt");
  if (!reset.autoSpin) note("auto-spin should resume right after a reset");

  // Reset button
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 120, cy - 40, { steps: 5 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -300 });
  await page.click("#view-reset");
  const rb = await v(page);
  if (Math.abs(rb.yaw) > 1e-6 || Math.abs(rb.zoom - 1) > 1e-6 || Math.abs(rb.lift - v0.lift) > 1e-6) note("reset button did not reset");

  // Auto-spin resumes ~3 s after the last interaction
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy, { steps: 3 }); await page.mouse.up();
  const p1 = await v(page);
  if (p1.autoSpin) note("auto-spin should stay paused just after a drag");
  await sleep(3500);
  const p2 = await v(page);
  if (!p2.autoSpin) note("auto-spin did not resume after 3 s");
  console.log("resume", p1.autoSpin, "->", p2.autoSpin);

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
