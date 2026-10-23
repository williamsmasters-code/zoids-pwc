// Add to Home Screen: button in the hangar, manifest fields, service worker
// registration, iOS popup with an iPhone UA. Screenshots: screenshots/home-screen/
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shots = path.join(root, "screenshots", "home-screen");
fs.mkdirSync(shots, { recursive: true });
const port = 8211;
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: root, stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(900);
const errors = [];
const note = (t) => { errors.push(t); console.error("FAIL", t); };
const base = `http://127.0.0.1:${port}/`;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true, protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ready = (page) => page.waitForFunction(() => window.__ZOIDS__ && window.__ZOIDS__.ready && window.__ZOIDS__.screen === "hangar", { timeout: 60000 });
try {
  // Desktop Chrome
  const page = await browser.newPage();
  page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await ready(page);
  const btn = await page.$("#install-btn");
  if (!btn) note("install button missing");
  const visible = await page.evaluate(() => { const b = document.querySelector("#install-btn"); return !!b && b.offsetParent !== null; });
  if (!visible) note("install button not visible");
  if (!(await page.$('[data-act="credits"]'))) note("credits button missing");

  const man = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async (i) => ({ ...i, ok: (await fetch(new URL(i.src, href))).ok })));
    return { ...m, icons };
  });
  console.log("manifest", man.name, man.short_name, man.display, man.orientation, man.start_url, man.scope);
  if (!man.name || !man.short_name) note("manifest name/short_name");
  if (!["standalone", "fullscreen"].includes(man.display)) note("manifest display");
  if (man.orientation !== "landscape") note("manifest orientation");
  if (man.start_url !== "./" || man.scope !== "./") note("start_url/scope must be relative ./");
  for (const s of ["192x192", "512x512"]) {
    const i = man.icons.find((x) => x.sizes === s);
    if (!i || !i.ok) note(`icon ${s} missing or not loading`);
  }

  const sw = await page.evaluate(async () => {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 15000))]);
    return reg ? { scope: reg.scope, active: !!reg.active } : null;
  });
  console.log("service worker", JSON.stringify(sw));
  if (!sw || !sw.active) note("service worker did not register/activate");
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); return { keys, n: (await c.keys()).length }; });
  console.log("caches", JSON.stringify(cached));
  if (!cached.keys.length || cached.n < 10) note("app shell not cached");

  // Chrome may fire beforeinstallprompt once the manifest + SW are in place;
  // then the click calls prompt() (no popup). Otherwise the fallback popup shows.
  const bip = await page.evaluate(() => window.__ZOIDS__.installMode());
  console.log("desktop install mode before click", bip);
  await page.click("#install-btn");
  await sleep(300);
  const mode = await page.$eval("#install-pop", (p) => p.classList.contains("hidden") ? "hidden" : p.dataset.mode);
  console.log("desktop popup after click", mode);
  if (bip === "prompt" ? mode !== "hidden" : mode !== "manual") note(`unexpected desktop click result ${bip} -> ${mode}`);
  if (mode !== "hidden") await page.click('[data-act="close-install"]');
  await page.screenshot({ path: path.join(shots, "hangar-install-button.png") });
  await page.close();

  // iOS Safari
  const ios = await browser.newPage();
  ios.on("pageerror", (e) => note(`ios pageerror: ${e.message}`));
  await ios.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
  await ios.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await ios.goto(base, { waitUntil: "domcontentloaded" });
  await ready(ios);
  await ios.click("#install-btn");
  const iosPop = await ios.$eval("#install-pop", (p) => ({ hidden: p.classList.contains("hidden"), mode: p.dataset.mode, text: p.innerText }));
  console.log("ios popup", iosPop.mode, iosPop.hidden ? "hidden" : "shown");
  if (iosPop.hidden || iosPop.mode !== "ios" || !/Share/.test(iosPop.text) || !/Add to Home Screen/.test(iosPop.text)) note("iOS popup wrong");
  await ios.screenshot({ path: path.join(shots, "ios-popup.png") });
} catch (e) {
  note(`exception: ${e.stack || e}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(`home_screen_browser: ${errors.length} failure(s)`); process.exit(1); }
console.log("home_screen_browser: ok");
