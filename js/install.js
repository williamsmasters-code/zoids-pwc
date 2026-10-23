// "Add to Home Screen" support: registers the service worker, captures
// beforeinstallprompt (Chrome/Edge/Android) and works out what the hangar
// button should do on this browser.
let deferred = null;
const listeners = new Set();

export function initInstall() {
  if (typeof window === "undefined") return;
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW register failed", e));
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((fn) => fn()); });
}

export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function isStandalone() {
  return (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches)) || navigator.standalone === true;
}

export function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// "prompt" | "ios" | "manual" | "installed"
export function installMode() {
  if (isStandalone()) return "installed";
  // iOS browsers never fire beforeinstallprompt; check iOS first.
  if (isIOS()) return "ios";
  if (deferred) return "prompt";
  return "manual";
}

export async function runInstallPrompt() {
  if (!deferred) return null;
  const e = deferred;
  deferred = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  listeners.forEach((fn) => fn());
  return choice && choice.outcome;
}

export function installHelpMarkup(mode) {
  const body = mode === "ios"
    ? `<p>1. Tap the <b>Share</b> button in Safari's toolbar (square with an up arrow).</p>
       <p>2. Scroll down and tap <b>Add to Home Screen</b>.</p>
       <p>3. Tap <b>Add</b>. Zoid Mercenaries opens full screen from your home screen.</p>`
    : `<p>Your browser didn't offer an install prompt.</p>
       <p>Open the browser menu and look for <b>Install app</b>, <b>Add to Home screen</b> or <b>Add to Dock</b>.
       Chrome, Edge and Safari support it; some browsers (e.g. Firefox desktop) don't.</p>`;
  return `<header><h3>Add to Home Screen</h3><button type="button" data-act="close-install" aria-label="Close">×</button></header>${body}`;
}
