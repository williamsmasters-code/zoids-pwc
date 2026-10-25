// Service worker: precaches the app shell; models are cached on first use.
// Bump CACHE_VERSION whenever shipped files change so players get updates.
// Shell files use network-first (fresh when online, cached when offline);
// models and icons use cache-first within the current version.
const CACHE_VERSION = "zoids-v7";
const SHELL = [
    "./",
    "index.html",
    "manifest.webmanifest",
    "css/style.css",
    "js/ai.js",
    "js/aim.js",
    "js/audio.js",
    "js/ballistics.js",
    "js/catalog.js",
    "js/combat.js",
    "js/contracts.js",
    "js/credits.js",
    "js/damage.js",
    "js/difficulty.js",
    "js/escort.js",
    "js/flight.js",
    "js/frame.js",
    "js/hangar.js",
    "js/hud.js",
    "js/indicators.js",
    "js/input.js",
    "js/main.js",
    "js/maps.js",
    "js/mission.js",
    "js/models.js",
    "js/rangebands.js",
    "js/skills.js",
    "js/state.js",
    "js/tonnage.js",
    "js/turret.js",
    "js/units.js",
    "vendor/three.module.js",
    "vendor/addons/loaders/GLTFLoader.js",
    "vendor/addons/libs/meshopt_decoder.module.js",
    "vendor/addons/utils/SkeletonUtils.js",
    "assets/icons/icon-192.png",
    "assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const heavy = /\.(glb|gltf|bin|png|jpg|webp|ktx2)$/i.test(url.pathname);
  event.respondWith(heavy ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
