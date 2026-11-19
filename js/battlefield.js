// Battlefield layouts: pure data and maths, no three.js, so node tests and the
// game share the same terrain, cover, water and navigation rules.
//
// Four biomes (Daniel, Nov 2026): Abandoned City, Dense Jungle, Sparse Jungle
// and Rocky Mountain Pass. They replace the old desert / plains / arctic set;
// old ids in a save are mapped through BIOME_ALIAS.
//
// A field is { biome, seed, look, heightAt, blockedAt, blockers, water,
// waterVolumes, hazards, props, near, ... }. Blockers are hard cover: they stop
// Zoids, shells and beams and break line of sight (missile locks, AI fire).
// Coordinates: x right, z south, the convoy road runs along x = 0 toward -Z.
import { mulberry32 } from "./catalog.js";

export const BIOME_IDS = ["city", "denseJungle", "sparseJungle", "pass"];
export const BIOME_ALIAS = { desert: "pass", plains: "sparseJungle", arctic: "pass" };
export function biomeId(biome) {
  if (BIOME_IDS.includes(biome)) return biome;
  return BIOME_ALIAS[biome] || "sparseJungle";
}

export const HALF = 640; // ground half size, m
export const PLAY_LIMIT = HALF - 28; // units are clamped inside +-PLAY_LIMIT
export const GROUND_EXTENT = 1000; // drawn ground half size (backdrop beyond the play box)

// The convoy road (escort contracts) and the places the mission uses at
// fixed coordinates (spawns, recon beacons, the assault outpost, convoy start
// and exit). No hard cover is generated inside these circles.
export const ROAD = { halfWidth: 14, z0: 340, z1: -330 };
export const CLEAR_ZONES = [
  { x: 0, z: 60, r: 82, why: "player spawn and the opening fight" },
  { x: 0, z: 0, r: 42, why: "map centre" },
  { x: 80, z: 10, r: 26, why: "recon beacon 1" },
  { x: -90, z: -80, r: 26, why: "recon beacon 2" },
  { x: 40, z: -190, r: 26, why: "recon beacon 3" },
  { x: 0, z: -80, r: 58, why: "assault outpost" },
  { x: 0, z: 300, r: 44, why: "convoy start" },
  { x: 0, z: -300, r: 30, why: "convoy exit" },
];

// Wading. Depth is water surface minus the ground under the Zoid.
export const WATER = {
  minSpeedMul: 0.6, // fully waded light Zoid moves at 60%
  coolMul: 1.5, // weapons shed heat 50% faster while wading (at 0.3 m or deeper)
  coolDepth: 0.3,
  absorb: 0.09, // beam loss per metre of water travelled
  scatter: 0.004, // beam bend per metre of water travelled
};
export function wadeSpeedMul(depth, radius = 2.5) {
  if (!(depth > 0.05)) return 1;
  const frac = Math.min(1, depth / Math.max(1.5, radius * 0.9));
  return 1 - (1 - WATER.minSpeedMul) * frac;
}
export function wadeCoolMul(depth) {
  return depth >= WATER.coolDepth ? WATER.coolMul : 1;
}

// Look per biome: ground colours, sky gradient, fog, light, hazard clouds.
export const LOOKS = {
  city: {
    label: "Abandoned City",
    low: 0x8a857d, high: 0xa49d92, plate: 0x9a948a, cliff: 0x6e675e,
    skyTop: 0x5d6673, skyHorizon: 0xcdb293, fog: 0xa7988a, density: 0.0052,
    hemiSky: 0xe0d6c8, hemiGround: 0x5e574e, sun: 0xffd9ae, sunIntensity: 1.45, sunDir: [-140, 95, 60],
    hazard: ["smoke", "dust"], hazardCount: 6,
  },
  denseJungle: {
    label: "Dense Jungle",
    low: 0x4c6a33, high: 0x6f8a3e, plate: 0x5a7234, cliff: 0x5e5843,
    skyTop: 0x6f9a92, skyHorizon: 0xd2e2c6, fog: 0x9db596, density: 0.0078,
    hemiSky: 0xe4f3da, hemiGround: 0x3a4a2c, sun: 0xfff0c6, sunIntensity: 1.3, sunDir: [-60, 170, 40],
    hazard: ["mist"], hazardCount: 7,
  },
  sparseJungle: {
    label: "Sparse Jungle",
    low: 0x4a7834, high: 0x96ae5c, plate: 0x6d8a40, cliff: 0x6b6450,
    skyTop: 0x4f93d6, skyHorizon: 0xd8eef6, fog: 0xc6dfe6, density: 0.0036,
    hemiSky: 0xd6ebf7, hemiGround: 0x3a5226, sun: 0xfff4da, sunIntensity: 1.5, sunDir: [-90, 160, 70],
    hazard: ["mist"], hazardCount: 3,
  },
  pass: {
    label: "Rocky Mountain Pass",
    low: 0x87785f, high: 0xb3a385, plate: 0x9a8b70, cliff: 0x6f6355, snow: 0xe6e8ea,
    skyTop: 0x3f7cc4, skyHorizon: 0xdde7ef, fog: 0xc8d2db, density: 0.0034,
    hemiSky: 0xe0eaf4, hemiGround: 0x5c5042, sun: 0xffffff, sunIntensity: 1.6, sunDir: [-110, 150, -40],
    hazard: ["dust"], hazardCount: 5,
  },
};

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function zoneHit(x, z, pad, scale = 1) {
  for (const c of CLEAR_ZONES) if (Math.hypot(x - c.x, z - c.z) < c.r * scale + pad) return c;
  return null;
}
function rectZoneHit(x, z, hw, hd, pad) {
  for (const c of CLEAR_ZONES) {
    const dx = Math.max(Math.abs(c.x - x) - hw, 0);
    const dz = Math.max(Math.abs(c.z - z) - hd, 0);
    if (Math.hypot(dx, dz) < c.r + pad) return c;
  }
  return null;
}
const onRoad = (x, pad = 0) => Math.abs(x) < ROAD.halfWidth + pad;

// Distance from (x, z) to a polyline [{x, z}...].
function polyDist(points, x, z) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
    if (d < best) best = d;
  }
  return best;
}

// ---------- the mountain pass valley ----------
// Centre line and half width of the walkable valley floor. Fixed (not
// seeded) so the mission's fixed objective spots always sit on the floor.
export function passCenter(z) {
  return 26 * Math.sin(z * 0.0065 + 0.8);
}
export function passHalfWidth(z) {
  return 105 + 28 * Math.sin(z * 0.012 + 2.1)
    - 22 * Math.exp(-(((z - 200) / 42) ** 2))
    - 22 * Math.exp(-(((z + 270) / 42) ** 2));
}
// Side routes of the pass (fixed, not seeded): narrower gullies, a ledge
// switchback and a raised ridge trail that split off the main canyon and
// rejoin it further on. Rock walls 60+ m high stand between them and the
// main canyon, so they are out of sight (and radar) of it.
//   hw: half width of the flat floor (plus an 8 m talus that is walkable).
//   rise: floor height reached mid-route (ramps of `ramp` m at each end).
//   superheavy: true if a Death Saurer (radius 5.4) fits.
export const PASS_BRANCHES = [
  { id: "westGully", name: "West Gully", hw: 10, superheavy: true,
    points: [[-40, 255], [-150, 235], [-235, 170], [-262, 60], [-258, -40], [-232, -120], [-160, -185], [-50, -205]] },
  { id: "eastLedge", name: "East Ledge switchback", hw: 3.4, talus: 1, superheavy: false,
    points: [[60, 175], [150, 168], [205, 135], [222, 85], [190, 45], [232, 5], [235, -45], [175, -95], [90, -120]] },
  { id: "ridgeTrail", name: "High Ridge Trail", hw: 7, rise: 24, ramp: 150, superheavy: true,
    points: [[70, 330], [190, 345], [300, 290], [350, 170], [362, 40], [352, -90], [318, -200], [230, -280], [120, -320], [10, -320]] },
  { id: "southBypass", name: "South Bypass", hw: 8, superheavy: true,
    points: [[-70, -170], [-185, -235], [-215, -330], [-170, -425], [-40, -455]] },
];
for (const b of PASS_BRANCHES) {
  b.pts = b.points.map(([x, z]) => ({ x, z }));
  let acc = 0;
  b.cum = [0];
  for (let i = 1; i < b.pts.length; i++) {
    acc += Math.hypot(b.pts[i].x - b.pts[i - 1].x, b.pts[i].z - b.pts[i - 1].z);
    b.cum.push(acc);
  }
  b.length = acc;
  const xs = b.pts.map((p) => p.x);
  const zs = b.pts.map((p) => p.z);
  const m = b.hw + 30;
  b.box = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m };
}
// Distance to a branch centre line and the distance along it.
function branchProject(b, x, z) {
  let best = Infinity;
  let along = 0;
  for (let i = 0; i < b.pts.length - 1; i++) {
    const a = b.pts[i];
    const c = b.pts[i + 1];
    const vx = c.x - a.x;
    const vz = c.z - a.z;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
    if (d < best) {
      best = d;
      along = b.cum[i] + t * Math.sqrt(l2);
    }
  }
  return { d: best, along };
}
// Raised branches stay at the main floor for their first and last 70 m
// (so they leave the canyon level), then ramp up over `ramp` m.
function branchFloor(b, along) {
  if (!b.rise) return 0;
  const r = b.ramp || 120;
  return b.rise * smooth((Math.min(along, b.length - along) - 70) / r);
}
// Wall profile: a short talus slope, then cliffs. d = distance past the
// flat floor edge.
function wallProfile(d, x, z, talus = 8) {
  if (d <= -talus) return 0;
  if (d < 0) return ((d + talus) / talus) ** 2 * 2.2;
  const rough = (Math.sin(x * 0.07 + z * 0.05) * 0.5 + Math.sin(z * 0.11 - x * 0.03) * 0.5) * Math.min(1, d / 12) * 7;
  return 2.2 + Math.min(92, 3.4 * d + 0.03 * d * d) + rough;
}
// Terrain the pass adds at (x, z) and how much of it is wall above the
// floor of the route the point belongs to (main canyon or a branch).
export const PASS_WALL_STEP = 3; // wall part above this is a cliff ground Zoids cannot climb
export function passShape(x, z) {
  let wall = wallProfile(Math.abs(x - passCenter(z)) - passHalfWidth(z), x, z);
  let height = wall;
  let route = wall <= PASS_WALL_STEP ? "main" : null;
  for (const b of PASS_BRANCHES) {
    if (x < b.box.x0 || x > b.box.x1 || z < b.box.z0 || z > b.box.z1) continue;
    const pr = branchProject(b, x, z);
    const w = wallProfile(pr.d - b.hw, x, z, b.talus);
    const h = branchFloor(b, pr.along) + w;
    if (h < height) {
      height = h;
      wall = w;
      route = w <= PASS_WALL_STEP ? b.id : route;
    }
  }
  return { height, wall, route };
}
export function passWall(x, z) {
  return passShape(x, z).height;
}
// Wall height above the local route floor (cliff test, cliff colouring).
export function passExcess(x, z) {
  return passShape(x, z).wall;
}

// ---------- terrain ----------
function makeTerrain(biome, rng, water) {
  const p1 = rng() * 6.283;
  const p2 = rng() * 6.283;
  const p3 = rng() * 6.283;
  const ridges = [];
  if (biome === "pass") {
    // Two flanking rock ridges across part of the valley: walkable
    // elevation that breaks line of sight, with a gap at the road.
    ridges.push({ z: 140 + rng() * 20, side: -1, h: 5.5 + rng() * 2 });
    ridges.push({ z: -230 - rng() * 20, side: 1, h: 5.5 + rng() * 2 });
  }
  function base(x, z) {
    if (biome === "city") return 0.3 * Math.sin(x * 0.017 + p1) * Math.cos(z * 0.015 + p2);
    if (biome === "denseJungle") {
      return 2.4 * Math.sin(x * 0.012 + p1) * Math.cos(z * 0.01 + p2)
        + 1.1 * Math.sin((x - z) * 0.027 + p3)
        + 0.5 * Math.sin(x * 0.06) * Math.sin(z * 0.05);
    }
    if (biome === "sparseJungle") {
      return 1.8 * Math.sin(x * 0.009 + p1) * Math.cos(z * 0.011 + p2) + 0.7 * Math.sin((x + z) * 0.022 + p3);
    }
    // pass floor
    let h = 1.4 * Math.sin(x * 0.016 + p1) * Math.cos(z * 0.014 + p2) + 0.5 * Math.sin((x + z) * 0.05 + p3);
    for (const r of ridges) {
      const across = (x - passCenter(z)) * r.side; // >0 on the ridge's side
      const reach = smooth((across - 20) / 25);
      h += r.h * Math.exp(-(((z - r.z) / 9) ** 2)) * reach;
    }
    return h;
  }
  // Rising rim beyond the play box so the world edge reads as land.
  function rim(x, z) {
    const e = Math.max(Math.abs(x), Math.abs(z)) - (PLAY_LIMIT - 20);
    return e > 0 ? e * 0.18 + e * e * 0.0012 : 0;
  }
  function carve(x, z) {
    let c = 0;
    for (const w of water) {
      if (w.shape === "pool") {
        const d = Math.hypot(x - w.x, z - w.z);
        if (d < w.r + 6) c = Math.max(c, w.depth * smooth((w.r + 6 - d) / 9));
      } else {
        if (z < w.minZ - 30 || z > w.maxZ + 30 || x < w.minX - 30 || x > w.maxX + 30) continue;
        const d = polyDist(w.points, x, z);
        if (d < w.halfWidth + 6) c = Math.max(c, w.depth * smooth((w.halfWidth + 6 - d) / 9));
      }
    }
    return c;
  }
  function heightAt(x, z) {
    let h = base(x, z) - carve(x, z);
    if (biome === "pass") h += passWall(x, z);
    else h += rim(x, z);
    return h;
  }
  return { heightAt, base };
}

// ---------- water ----------
function makeWater(biome, rng) {
  const list = [];
  const river = (points, halfWidth, depth, name) => {
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    list.push({ shape: "river", name, points, halfWidth, depth,
      minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  };
  if (biome === "city") {
    const pts = [];
    for (let x = -760; x <= 760; x += 80) pts.push({ x, z: -150 });
    river(pts, 11, 2.6, "canal");
  } else if (biome === "denseJungle") {
    const ph = rng() * 6.283;
    const pts = [];
    for (let x = -760; x <= 760; x += 32) pts.push({ x, z: 195 + 35 * Math.sin(x * 0.009 + ph) });
    river(pts, 13, 2.4, "river");
    list.push({ shape: "pool", name: "pool", x: -230 + rng() * 40, z: -150 + rng() * 40, r: 22, depth: 2.2 });
  } else if (biome === "sparseJungle") {
    list.push({ shape: "pool", name: "pond", x: -175, z: -10, r: 30, depth: 2.4 });
    list.push({ shape: "pool", name: "pond", x: 190, z: 150, r: 24, depth: 2.0 });
    const ph = rng() * 6.283;
    const a = [];
    for (let x = -200; x >= -760; x -= 40) a.push({ x, z: -10 + 30 * Math.sin(x * 0.012 + ph) });
    river(a, 7, 1.6, "stream");
    const b = [];
    for (let x = 210; x <= 760; x += 40) b.push({ x, z: 150 + (x - 210) * 0.25 + 20 * Math.sin(x * 0.015 + ph) });
    river(b, 6, 1.5, "stream");
  } else if (biome === "pass") {
    // Meltwater pools at the foot of the cliffs.
    for (const [z, side] of [[60 + rng() * 40, rng() < 0.5 ? -1 : 1], [-160 - rng() * 40, rng() < 0.5 ? -1 : 1]]) {
      const x = passCenter(z) + side * (passHalfWidth(z) - 30);
      list.push({ shape: "pool", name: "meltwater", x, z, r: 19, depth: 2.0 });
    }
  }
  return list;
}

// ---------- spatial grid ----------
const CELL = 32;
function makeGrid() {
  const cells = new Map();
  let stamp = 1;
  const key = (i, j) => i * 100003 + j;
  function insert(b) {
    const ex = b.shape === "circle" ? b.r : b.hw;
    const ez = b.shape === "circle" ? b.r : b.hd;
    for (let i = Math.floor((b.x - ex) / CELL); i <= Math.floor((b.x + ex) / CELL); i++) {
      for (let j = Math.floor((b.z - ez) / CELL); j <= Math.floor((b.z + ez) / CELL); j++) {
        const k = key(i, j);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(b);
      }
    }
  }
  function near(x, z, r, out = []) {
    stamp += 1;
    out.length = 0;
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (const b of list) {
          if (b.dead || b._stamp === stamp) continue;
          b._stamp = stamp;
          out.push(b);
        }
      }
    }
    return out;
  }
  return { insert, near };
}

// ---------- generation ----------
export function createField(biomeIn, seed = 1) {
  const biome = biomeId(biomeIn);
  const rng = mulberry32(((seed || 1) ^ 0x51ed270b) >>> 0);
  const look = LOOKS[biome];
  let field = null;
  // Dense jungle crowds the clear zones (only their inner 55% stays open)
  // so the spawn is not a lawn; the sparse jungle keeps them clear.
  let zoneScale = 1;
  const water = makeWater(biome, rng);
  const terrain = makeTerrain(biome, rng, water);
  const { heightAt } = terrain;
  const blockers = [];
  const grid = makeGrid();
  const props = { buildings: [], rubble: [], plates: [], trees: [], saplings: [], bushes: [], boulders: [], spires: [], cars: [], fires: [], grass: [], skyline: [] };

  function waterDist(x, z) {
    let best = Infinity;
    for (const w of water) {
      const d = w.shape === "pool" ? Math.hypot(x - w.x, z - w.z) - w.r : polyDist(w.points, x, z) - w.halfWidth;
      if (d < best) best = d;
    }
    return best;
  }
  function blockedAt(x, z) {
    if (Math.abs(x) > PLAY_LIMIT || Math.abs(z) > PLAY_LIMIT) return true;
    return biome === "pass" && passExcess(x, z) > PASS_WALL_STEP;
  }
  function addBlocker(b) {
    b.base = b.base == null ? heightAt(b.x, b.z) : b.base;
    b.top = b.base + b.h;
    blockers.push(b);
    grid.insert(b);
    if (field) field.nav = null; // path grid rebuilt on next request
    return b;
  }
  function circleFree(x, z, r, pad = 0) {
    for (const b of grid.near(x, z, r + pad + 16)) {
      if (b.shape === "circle") {
        if (Math.hypot(x - b.x, z - b.z) < r + b.r + pad) return false;
      } else if (Math.abs(x - b.x) < b.hw + r + pad && Math.abs(z - b.z) < b.hd + r + pad) return false;
    }
    return true;
  }

  if (biome === "city") buildCity();
  else if (biome === "denseJungle") buildJungle(true);
  else if (biome === "sparseJungle") buildJungle(false);
  else buildPass();

  // ----- Abandoned City -----
  function buildCity() {
    const PITCH = 70;
    const BH = 22; // block half size; streets are 26 m, the avenue 34+ m
    const canalZ = -150;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const bx = side * (56 + PITCH * i);
        for (let j = 0; j < 18; j++) {
          const bz = -595 + PITCH * j;
          if (Math.abs(bz - canalZ) < BH + 15) continue;
          const inside = Math.abs(bx) + BH < PLAY_LIMIT - 4 && Math.abs(bz) + BH < PLAY_LIMIT - 4;
          if (!inside) {
            // Skyline beyond the play box: tall dark shells, drawn only.
            if (Math.abs(bx) < GROUND_EXTENT - 40 && Math.abs(bz) < GROUND_EXTENT - 40) {
              props.skyline.push({ x: bx, z: bz, w: 30 + rng() * 12, d: 30 + rng() * 12, h: 30 + rng() * 45, base: heightAt(bx, bz) });
            }
            continue;
          }
          if (rectZoneHit(bx, bz, BH, BH, -6)) {
            // Most of the block is a plaza; keep only the corners clear of zones.
            continue;
          }
          props.plates.push({ x: bx, z: bz, w: BH * 2 + 4, d: BH * 2 + 4 });
          const roll = rng();
          if (roll < 0.1) {
            // Empty lot: wrecks only (added with the street props below).
            continue;
          }
          if (roll < 0.28) {
            // Collapsed building: a rubble mound (low cover) and a fallen slab.
            const hw = 12 + rng() * 8;
            const hd = 12 + rng() * 8;
            // The fallen slab leans low (60-75 degrees from upright), so the
            // mound collider covers it.
            const slab = { w: 12 + rng() * 8, h: 14 + rng() * 8, tilt: 1.05 + rng() * 0.25, yaw: rng() * 6.28 };
            const h = Math.max(3 + rng() * 3, slab.h * Math.cos(slab.tilt) + 1.5);
            addBlocker({ shape: "aabb", x: bx, z: bz, hw, hd, h, kind: "rubble" });
            props.rubble.push({ x: bx, z: bz, hw, hd, h, slab });
            if (rng() < 0.6) props.fires.push({ x: bx + (rng() - 0.5) * hw, z: bz + (rng() - 0.5) * hd });
            continue;
          }
          const parts = roll < 0.55
            ? [{ x: bx, z: bz, hw: 13 + rng() * 6, hd: 13 + rng() * 6, h: 32 + rng() * 26 }]
            : splitBlock(bx, bz, BH);
          for (const p of parts) {
            if (rectZoneHit(p.x, p.z, p.hw, p.hd, 2)) continue;
            const broken = rng() < 0.4;
            addBlocker({ shape: "aabb", x: p.x, z: p.z, hw: p.hw, hd: p.hd, h: p.h, kind: "building", base: heightAt(p.x, p.z) - 0.4 });
            props.buildings.push({ ...p, broken, tint: rng(), seed: Math.floor(rng() * 1e6) });
          }
        }
      }
    }
    // Wrecked cars and jersey barriers in the streets: small, destructible
    // cover; superheavies crush them underfoot.
    let guard = 0;
    while (props.cars.length < 70 && guard++ < 3000) {
      const x = (rng() * 2 - 1) * (PLAY_LIMIT - 10);
      const z = (rng() * 2 - 1) * (PLAY_LIMIT - 10);
      if (onRoad(x, 3) || zoneHit(x, z, 2) || waterDist(x, z) < 3) continue;
      const barrier = rng() < 0.3;
      const along = rng() < 0.5;
      const hw = barrier ? (along ? 0.5 : 3) : (along ? 1.1 : 2.3);
      const hd = barrier ? (along ? 3 : 0.5) : (along ? 2.3 : 1.1);
      if (!circleFree(x, z, Math.max(hw, hd), 2)) continue;
      const b = addBlocker({ shape: "aabb", x, z, hw, hd, h: barrier ? 1.2 : 1.6, kind: barrier ? "barrier" : "car", hp: barrier ? 60 : 30, crush: barrier ? 3.4 : 3.0 });
      props.cars.push({ x, z, hw, hd, h: b.h, barrier, tint: rng(), blocker: b });
    }
  }
  function splitBlock(bx, bz, BH) {
    const out = [];
    const n = 2 + Math.floor(rng() * 3);
    const alongX = rng() < 0.5;
    const span = BH * 2 - 2;
    let cursor = -BH + 1;
    for (let k = 0; k < n; k++) {
      const len = k === n - 1 ? BH - 1 - cursor : (span / n) * (0.8 + rng() * 0.4);
      const mid = cursor + len / 2;
      const thick = 8 + rng() * (BH - 9);
      const h = 10 + rng() * 18;
      if (len > 6) {
        out.push(alongX
          ? { x: bx + mid, z: bz + (rng() - 0.5) * (BH * 2 - thick * 2), hw: len / 2 - 1, hd: thick, h }
          : { x: bx + (rng() - 0.5) * (BH * 2 - thick * 2), z: bz + mid, hw: thick, hd: len / 2 - 1, h });
      }
      cursor += len;
    }
    return out;
  }

  // ----- jungles -----
  function treeSpotOk(x, z, r, minGap, list) {
    if (Math.abs(x) > PLAY_LIMIT + 60 || Math.abs(z) > PLAY_LIMIT + 60) return false;
    if (onRoad(x, zoneScale < 1 ? 3 : 5) || zoneHit(x, z, 4, zoneScale) || waterDist(x, z) < 4) return false;
    for (const t of list) if (Math.hypot(t.x - x, t.z - z) < minGap) return false;
    return true;
  }
  function addTree(x, z, r, trunkH) {
    const inPlay = Math.abs(x) < PLAY_LIMIT && Math.abs(z) < PLAY_LIMIT;
    const tree = { x, z, r, trunkH, canopy: 4.5 + r * 2.2 + rng() * 2, lean: (rng() - 0.5) * 0.08, tint: rng(), base: heightAt(x, z) };
    if (inPlay) tree.blocker = addBlocker({ shape: "circle", x, z, r, h: trunkH, kind: "tree", base: tree.base - 0.3 });
    props.trees.push(tree);
    return tree;
  }
  function buildJungle(dense) {
    zoneScale = dense ? 0.55 : 1;
    const big = [];
    let guard = 0;
    const wantBig = dense ? 340 : 0;
    while (big.length < wantBig && guard++ < 9000) {
      const x = (rng() * 2 - 1) * (PLAY_LIMIT + 50);
      const z = (rng() * 2 - 1) * (PLAY_LIMIT + 50);
      if (!treeSpotOk(x, z, 2, 14, big)) continue;
      big.push(addTree(x, z, 1.6 + rng() * 1.1, 12 + rng() * 5));
    }
    if (!dense) {
      // Sparse: tree clusters around open clearings, plus lone giants.
      for (let c = 0; c < 26; c++) {
        const cx = (rng() * 2 - 1) * (PLAY_LIMIT - 20);
        const cz = (rng() * 2 - 1) * (PLAY_LIMIT - 20);
        if (zoneHit(cx, cz, 10) || onRoad(cx, 14)) continue;
        const n = 3 + Math.floor(rng() * 5);
        for (let k = 0; k < n * 3 && big.length < 400; k++) {
          const a = rng() * 6.283;
          const d = rng() * 17;
          const x = cx + Math.cos(a) * d;
          const z = cz + Math.sin(a) * d;
          if (!treeSpotOk(x, z, 2, 8, big)) continue;
          big.push(addTree(x, z, 1.4 + rng() * 1.0, 11 + rng() * 5));
          if (big.filter((t) => Math.hypot(t.x - cx, t.z - cz) < 20).length >= n) break;
        }
      }
      for (let k = 0, g = 0; k < 40 && g < 2000; g++) {
        const x = (rng() * 2 - 1) * (PLAY_LIMIT + 50);
        const z = (rng() * 2 - 1) * (PLAY_LIMIT + 50);
        if (!treeSpotOk(x, z, 2, 30, big)) continue;
        big.push(addTree(x, z, 1.8 + rng() * 1.0, 13 + rng() * 4));
        k++;
      }
    }
    // Saplings: thin, destructible, crushed by superheavies.
    const wantSap = dense ? 180 : 70;
    guard = 0;
    while (props.saplings.length < wantSap && guard++ < 6000) {
      const x = (rng() * 2 - 1) * (PLAY_LIMIT - 4);
      const z = (rng() * 2 - 1) * (PLAY_LIMIT - 4);
      if (onRoad(x, 3) || zoneHit(x, z, 2, zoneScale) || waterDist(x, z) < 2) continue;
      const r = 0.6 + rng() * 0.35;
      if (!circleFree(x, z, r, 3.5)) continue;
      const h = 6 + rng() * 4;
      const b = addBlocker({ shape: "circle", x, z, r, h, kind: "sapling", hp: 35, crush: 3.0, base: heightAt(x, z) - 0.2 });
      props.saplings.push({ x, z, r, h, tint: rng(), base: b.base, blocker: b });
    }
    // Undergrowth and boulders.
    const wantBush = dense ? 260 : 140;
    for (let k = 0, g = 0; k < wantBush && g < 4000; g++) {
      const x = (rng() * 2 - 1) * (PLAY_LIMIT + 40);
      const z = (rng() * 2 - 1) * (PLAY_LIMIT + 40);
      if (onRoad(x, 2) || waterDist(x, z) < 1) continue;
      if (zoneHit(x, z, -20) && rng() < 0.8) continue;
      props.bushes.push({ x, z, s: 1.4 + rng() * (dense ? 2.6 : 1.8), tint: rng(), base: heightAt(x, z) });
      k++;
    }
    if (!dense) {
      for (let k = 0, g = 0; k < 260 && g < 3000; g++) {
        const x = (rng() * 2 - 1) * (PLAY_LIMIT + 40);
        const z = (rng() * 2 - 1) * (PLAY_LIMIT + 40);
        if (onRoad(x, 1) || waterDist(x, z) < 1) continue;
        props.grass.push({ x, z, s: 0.8 + rng() * 1.2, tint: rng(), base: heightAt(x, z) });
        k++;
      }
    }
    scatterBoulders(dense ? 18 : 26, 2, 4.5);
  }
  function scatterBoulders(count, rMin, rMax, inValley = false) {
    let guard = 0;
    let made = 0;
    while (made < count && guard++ < 4000) {
      const x = (rng() * 2 - 1) * (PLAY_LIMIT - 10);
      const z = (rng() * 2 - 1) * (PLAY_LIMIT - 10);
      const r = rMin + rng() * (rMax - rMin);
      if (inValley && Math.abs(x - passCenter(z)) > passHalfWidth(z) - r - 6) continue;
      if (onRoad(x, r + 2) || zoneHit(x, z, r + 2) || waterDist(x, z) < r + 2) continue;
      if (!circleFree(x, z, r, 6)) continue;
      const small = r < 2.8;
      const b = addBlocker({ shape: "circle", x, z, r, h: r * (0.8 + rng() * 0.6), kind: "boulder",
        hp: small ? 90 : undefined, crush: small ? 4.0 : undefined, base: heightAt(x, z) - r * 0.25 });
      props.boulders.push({ x, z, r, h: b.h, base: b.base, yaw: rng() * 6.28, tint: rng(), blocker: b });
      made++;
    }
  }

  // ----- Rocky Mountain Pass -----
  function buildPass() {
    // Rock spires: tall permanent cover inside the valley.
    let guard = 0;
    let made = 0;
    while (made < 8 && guard++ < 3000) {
      const z = (rng() * 2 - 1) * (PLAY_LIMIT - 30);
      const r = 7 + rng() * 6;
      const off = (rng() * 2 - 1) * (passHalfWidth(z) - r - 14);
      const x = passCenter(z) + off;
      if (onRoad(x, r + 8) || zoneHit(x, z, r + 6) || waterDist(x, z) < r + 4) continue;
      if (!circleFree(x, z, r, 30)) continue;
      const b = addBlocker({ shape: "circle", x, z, r, h: 24 + rng() * 22, kind: "spire", base: heightAt(x, z) - 1 });
      props.spires.push({ x, z, r, h: b.h, base: b.base, yaw: rng() * 6.28, tint: rng(), blocker: b });
      made++;
    }
    scatterBoulders(64, 2.2, 6.5, true);
    // Boulders on the canyon rim (drawn; outside the walkable floor).
    for (let k = 0; k < 40; k++) {
      const z = (rng() * 2 - 1) * (PLAY_LIMIT + 200);
      const side = rng() < 0.5 ? -1 : 1;
      const x = passCenter(z) + side * (passHalfWidth(z) + 30 + rng() * 120);
      const r = 4 + rng() * 9;
      props.boulders.push({ x, z, r, h: r, base: heightAt(x, z) - r * 0.3, yaw: rng() * 6.28, tint: rng(), blocker: null });
    }
  }

  // ----- hazard clouds -----
  const hazards = [];
  {
    const kinds = look.hazard;
    let guard = 0;
    const wanted = look.hazardCount;
    const ringMax = biome === "denseJungle" ? 320 : 260;
    const spots = props.fires.filter((f) => { const d = Math.hypot(f.x, f.z); return d > 55 && d < 330; });
    while (hazards.length < wanted && guard++ < 400) {
      let x;
      let z;
      if (spots.length && biome === "city") {
        const s = spots.shift();
        x = s.x;
        z = s.z;
      } else {
        const ang = rng() * 6.283;
        const dist = 55 + rng() * (ringMax - 55);
        x = Math.cos(ang) * dist;
        z = Math.sin(ang) * dist;
      }
      if (Math.abs(x) < 20 || blockedAt(x, z)) continue;
      if (hazards.some((h) => Math.hypot(h.x - x, h.z - z) < 45)) continue;
      const kind = kinds[hazards.length % kinds.length];
      hazards.push({ kind, x, z, r: 11 + rng() * 7, h: 16 + rng() * 8, y0: null });
      if (biome === "city" && !props.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 8)) props.fires.push({ x, z });
    }
  }

  // Water volumes for beam attenuation (boxes along rivers, cylinders for pools).
  const waterVolumes = [];
  for (const w of water) {
    if (w.shape === "pool") {
      const surface = terrain.base(w.x, w.z) - 0.45 + (biome === "pass" ? passWall(w.x, w.z) : 0);
      w.surface = surface;
      waterVolumes.push({ kind: "water", shape: "cylinder", x: w.x, z: w.z, r: w.r, y0: surface - w.depth - 1, h: w.depth + 1 });
    } else {
      w.surfaceAt = (x, z) => terrain.base(x, z) - 0.45;
      for (let i = 0; i < w.points.length - 1; i++) {
        const a = w.points[i];
        const b = w.points[i + 1];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const s = w.surfaceAt(mx, mz);
        waterVolumes.push({ kind: "water", shape: "box", x: mx, z: mz, hw: Math.hypot(b.x - a.x, b.z - a.z) / 2 + 1, hd: w.halfWidth,
          yaw: Math.atan2(b.z - a.z, b.x - a.x), y0: s - w.depth - 1, h: w.depth + 1 });
      }
    }
  }
  function surfaceOf(w, x, z) {
    return w.shape === "pool" ? w.surface : w.surfaceAt(x, z);
  }
  // Water depth under (x, z) (0 when dry) and the body.
  function waterAt(x, z) {
    for (const w of water) {
      let inside;
      if (w.shape === "pool") inside = Math.hypot(x - w.x, z - w.z) < w.r + 2;
      else inside = !(z < w.minZ - 20 || z > w.maxZ + 20 || x < w.minX - 20 || x > w.maxX + 20) && polyDist(w.points, x, z) < w.halfWidth + 2;
      if (!inside) continue;
      const depth = surfaceOf(w, x, z) - heightAt(x, z);
      if (depth > 0) return { depth, body: w.name, surface: surfaceOf(w, x, z) };
    }
    return { depth: 0, body: null, surface: null };
  }

  let maxHeight = -Infinity;
  for (const b of blockers) maxHeight = Math.max(maxHeight, b.top);
  const terrainMax = biome === "pass" ? 110 : 30;

  field = {
    biome, seed, look, heightAt, blockedAt, blockers, water, waterVolumes, waterAt, hazards, props,
    near: grid.near, addBlocker, maxHeight: Math.max(maxHeight, terrainMax),
    surfaceOf, nav: null,
  };
  return field;
}

// ---------- queries shared by the game and the tests ----------

// True if a Zoid of `radius` cannot stand at (x, z): outside the play box,
// on a cliff, or overlapping hard cover (same margins as the mission's
// collision push-out).
const scratch = [];
// Terrain only (cliffs, play box) for a Zoid of `radius` at (x, z).
export function terrainBlocked(field, x, z, radius = 2.5) {
  if (field.blockedAt(x, z)) return true;
  const k = radius * 0.7;
  return field.blockedAt(x + k, z) || field.blockedAt(x - k, z) || field.blockedAt(x, z + k) || field.blockedAt(x, z - k);
}
export function pointBlocked(field, x, z, radius = 2.5) {
  if (field.blockedAt(x, z)) return true;
  for (const [ox, oz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    if (field.blockedAt(x + ox * 0.7, z + oz * 0.7)) return true;
  }
  for (const b of field.near(x, z, radius + 16, scratch)) {
    if (b.shape === "circle") {
      if (Math.hypot(x - b.x, z - b.z) < b.r + radius * 0.65) return true;
    } else if (Math.abs(x - b.x) < b.hw + radius * 0.7 && Math.abs(z - b.z) < b.hd + radius * 0.7) return true;
  }
  return false;
}

// Nearest free, dry-ish spot to (x, z) on a spiral (spawn validity).
export function findFreeSpot(field, x, z, radius = 2.5, maxDist = 120) {
  // Superheavies never start in a pocket of a branch too narrow for them.
  const narrowFor = (px, pz) => {
    if (field.biome !== "pass" || radius <= 4) return false;
    const route = passShape(px, pz).route;
    const br = route && PASS_BRANCHES.find((b) => b.id === route);
    return !!(br && !br.superheavy);
  };
  const ok = (px, pz) => !pointBlocked(field, px, pz, radius + 1.5) && field.waterAt(px, pz).depth < 1.2 && !narrowFor(px, pz);
  if (ok(x, z)) return { x, z, moved: 0 };
  for (let d = 4; d <= maxDist; d += 4) {
    const n = Math.max(8, Math.round((d * 2 * Math.PI) / 6));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (ok(px, pz)) return { x: px, z: pz, moved: d };
    }
  }
  return { x, z, moved: -1 };
}

// Line of sight between two 3D points. Terrain (sampled every 4 m) and hard
// cover both block. Returns null when clear, else { by, t }.
const losScratch = [];
export function lineBlocked(field, a, b, opts = {}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(len / 4));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    if (a.y + dy * t < field.heightAt(x, z) - 0.3) return { by: "terrain", t };
  }
  const seen = new Set();
  const span = Math.max(1, Math.ceil(len / 24));
  for (let s = 0; s <= span; s++) {
    const t = s / span;
    for (const blk of field.near(a.x + dx * t, a.z + dz * t, 20, losScratch)) {
      if (seen.has(blk)) continue;
      seen.add(blk);
      if (opts.ignoreLow && blk.h < opts.ignoreLow) continue;
      const seg = segment2D(a.x, a.z, dx, dz, blk);
      if (!seg) continue;
      const y0 = a.y + dy * seg[0];
      const y1 = a.y + dy * seg[1];
      if (Math.min(y0, y1) < blk.top && Math.max(y0, y1) > blk.base - 1) return { by: blk.kind, t: seg[0], blocker: blk };
    }
  }
  return null;
}
// Param range [t0, t1] in [0, 1] where the 2D segment crosses a blocker.
function segment2D(ax, az, dx, dz, b) {
  if (b.shape === "circle") {
    const ox = ax - b.x;
    const oz = az - b.z;
    const A = dx * dx + dz * dz;
    if (A < 1e-9) return Math.hypot(ox, oz) < b.r ? [0, 1] : null;
    const B = 2 * (ox * dx + oz * dz);
    const C = ox * ox + oz * oz - b.r * b.r;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - s) / (2 * A));
    const t1 = Math.min(1, (-B + s) / (2 * A));
    return t1 > t0 ? [t0, t1] : null;
  }
  let t0 = 0;
  let t1 = 1;
  for (const [o, d, lo, hi] of [[ax, dx, b.x - b.hw, b.x + b.hw], [az, dz, b.z - b.hd, b.z + b.hd]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let ta = (lo - o) / d;
      let tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t1 <= t0) return null;
    }
  }
  return [t0, t1];
}

// Local avoidance: the first heading within +-2.1 rad of `yaw` whose probe
// points are free. Yaw convention as the mission (forward = -sin, -cos).
const STEER_OFFSETS = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.5, -1.5, 2.1, -2.1];
export function steerYaw(field, x, z, yaw, radius = 2.5, look = 14, prefer = 1) {
  // First heading with every feeler free; failing that (narrow ledges and
  // gullies), the first heading whose near feelers are free.
  let near = null;
  for (const raw of STEER_OFFSETS) {
    const off = raw * prefer;
    const y = yaw + off;
    const fx = -Math.sin(y);
    const fz = -Math.cos(y);
    let free = 0;
    for (const d of [1.5, 3.5, look * 0.45, look]) {
      if (pointBlocked(field, x + fx * d, z + fz * d, radius)) break;
      free++;
    }
    if (free === 4) return { yaw: y, offset: off };
    if (free >= 2 && !near) near = { yaw: y, offset: off, near: true };
  }
  return near;
}

// A spot behind hard cover from `threat`, within maxDist of `pos`.
export function coverPoint(field, pos, threat, radius = 2.5, maxDist = 70) {
  let best = null;
  let bestD = Infinity;
  for (const b of field.near(pos.x, pos.z, maxDist, [])) {
    if (b.hp || b.top - b.base < 4) continue; // too low or destructible
    const ext = b.shape === "circle" ? b.r : Math.max(b.hw, b.hd);
    const vx = b.x - threat.x;
    const vz = b.z - threat.z;
    const vl = Math.hypot(vx, vz) || 1;
    const px = b.x + (vx / vl) * (ext + radius + 3);
    const pz = b.z + (vz / vl) * (ext + radius + 3);
    const d = Math.hypot(px - pos.x, pz - pos.z);
    if (d > maxDist || d >= bestD) continue;
    if (pointBlocked(field, px, pz, radius)) continue;
    const chest = field.heightAt(px, pz) + Math.min(4, b.top - b.base - 0.5);
    if (!lineBlocked(field, { x: threat.x, y: threat.y, z: threat.z }, { x: px, y: chest, z: pz })) continue;
    best = { x: px, z: pz, blocker: b };
    bestD = d;
  }
  return best;
}

// Summary for docs and tests.
export function fieldStats(field) {
  const count = (k) => field.blockers.filter((b) => b.kind === k).length;
  return {
    biome: field.biome,
    blockers: field.blockers.length,
    buildings: count("building"),
    rubble: count("rubble"),
    trees: count("tree"),
    saplings: count("sapling"),
    boulders: count("boulder"),
    spires: count("spire"),
    cars: count("car") + count("barrier"),
    water: field.water.length,
    hazards: field.hazards.length,
    tallest: Math.round(Math.max(0, ...field.blockers.map((b) => b.top - b.base))),
  };
}

// Ray against hard cover (analytic, through the grid; far cheaper than
// raycasting the merged city mesh). dir must be normalised. Returns the
// nearest { t, blocker, point } within maxDist, or null.
const rayScratch = [];
export function rayBlockers(field, o, dir, maxDist) {
  const STEP = 20;
  const seen = new Set();
  let best = null;
  for (let s = 0; s * STEP <= maxDist + STEP; s++) {
    const t = Math.min(maxDist, s * STEP);
    if (best && best.t < t - STEP) break;
    const x = o.x + dir.x * t;
    const z = o.z + dir.z * t;
    for (const b of field.near(x, z, STEP + 4, rayScratch)) {
      if (seen.has(b)) continue;
      seen.add(b);
      const hit = rayBlocker(o, dir, maxDist, b);
      if (hit != null && (!best || hit < best.t)) best = { t: hit, blocker: b };
    }
    if (t >= maxDist) break;
  }
  if (best) best.point = { x: o.x + dir.x * best.t, y: o.y + dir.y * best.t, z: o.z + dir.z * best.t };
  return best;
}
function rayBlocker(o, d, maxDist, b) {
  let t0 = 0;
  let t1 = maxDist;
  if (b.shape === "circle") {
    const ox = o.x - b.x;
    const oz = o.z - b.z;
    const A = d.x * d.x + d.z * d.z;
    if (A < 1e-9) {
      if (ox * ox + oz * oz > b.r * b.r) return null;
    } else {
      const B = 2 * (ox * d.x + oz * d.z);
      const C = ox * ox + oz * oz - b.r * b.r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      t0 = Math.max(t0, (-B - s) / (2 * A));
      t1 = Math.min(t1, (-B + s) / (2 * A));
      if (t1 <= t0) return null;
    }
  } else {
    for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x - b.hw, b.x + b.hw], [o.z, d.z, b.z - b.hd, b.z + b.hd]]) {
      if (Math.abs(dd) < 1e-9) {
        if (oo < lo || oo > hi) return null;
      } else {
        let ta = (lo - oo) / dd;
        let tb = (hi - oo) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t1 <= t0) return null;
      }
    }
  }
  // vertical extent
  const lo = b.base;
  const hi = b.top;
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < lo || o.y > hi) return null;
  } else {
    let ta = (lo - o.y) / d.y;
    let tb = (hi - o.y) / d.y;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t1 > t0 ? t0 : null;
}

// Ray against the terrain heightfield: march in 3 m steps, then bisect.
export function rayGround(field, o, d, maxDist, near = 0.15) {
  const h = field.heightAt;
  let prevT = near;
  let prevF = o.y + d.y * near - h(o.x + d.x * near, o.z + d.z * near);
  if (prevF < 0) return { t: near, point: { x: o.x + d.x * near, y: o.y + d.y * near, z: o.z + d.z * near } };
  const STEP = 3;
  for (let t = near + STEP; ; t += STEP) {
    const tt = Math.min(t, maxDist);
    const y = o.y + d.y * tt;
    if (d.y >= 0 && y > field.maxHeight + 5) return null; // rising above everything
    const f = y - h(o.x + d.x * tt, o.z + d.z * tt);
    if (f < 0) {
      let a = prevT;
      let b = tt;
      for (let i = 0; i < 7; i++) {
        const m = (a + b) / 2;
        const fm = o.y + d.y * m - h(o.x + d.x * m, o.z + d.z * m);
        if (fm < 0) b = m;
        else a = m;
      }
      return { t: b, point: { x: o.x + d.x * b, y: o.y + d.y * b, z: o.z + d.z * b } };
    }
    prevT = tt;
    prevF = f;
    if (tt >= maxDist) return null;
  }
}

// ---------- path finding (AI routes around blocks, canyon walls, rivers) ----------
// Coarse 8 m occupancy grid per size class, built lazily (about 25k cells,
// a few ms) and dropped when cover is added. A* with 8 neighbours, deep
// water costs extra, then string-pulled to a few waypoints.
export const NAV_CELL = 8;
function navGrid(field, radius) {
  const key = radius > 4 ? "L" : "S";
  // A little wider than the Zoid so routes keep off walls (the pass uses
  // the real sizes so its 7 m ledge stays open to normal Zoids only).
  const r = field.biome === "pass" ? (radius > 4 ? 5.6 : 3.4) : radius > 4 ? 6.2 : 4.2;
  if (!field.nav) field.nav = {};
  if (field.nav[key]) return field.nav[key];
  const n = Math.ceil((PLAY_LIMIT * 2) / NAV_CELL);
  const cost = new Uint8Array(n * n);
  const sx = new Float32Array(n * n); // free spot inside each open cell (waypoint)
  const sz = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -PLAY_LIMIT + (i + 0.5) * NAV_CELL;
      const z = -PLAY_LIMIT + (j + 0.5) * NAV_CELL;
      let px = x;
      let pz = z;
      let open = !pointBlocked(field, x, z, r);
      // Pass: narrow ledges and gullies can miss a cell centre, so look for
      // any free spot in the cell (7 x 7 samples) unless it is deep rock.
      if (!open && field.biome === "pass" && passExcess(x, z) < 40) {
        for (let sj = -3; sj <= 3 && !open; sj++) {
          for (let si = -3; si <= 3; si++) {
            const qx = x + si * (NAV_CELL / 7);
            const qz = z + sj * (NAV_CELL / 7);
            if (!pointBlocked(field, qx, qz, r)) { open = true; px = qx; pz = qz; break; }
          }
        }
      }
      sx[j * n + i] = px;
      sz[j * n + i] = pz;
      if (!open) cost[j * n + i] = 0;
      else cost[j * n + i] = field.waterAt(px, pz).depth > 1.2 ? 3 : 1;
    }
  }
  const g = { n, cost, r, sx, sz };
  field.nav[key] = g;
  return g;
}
function cellOf(g, x, z) {
  const i = Math.max(0, Math.min(g.n - 1, Math.floor((x + PLAY_LIMIT) / NAV_CELL)));
  const j = Math.max(0, Math.min(g.n - 1, Math.floor((z + PLAY_LIMIT) / NAV_CELL)));
  return [i, j];
}
function nearestOpen(g, i0, j0) {
  if (g.cost[j0 * g.n + i0]) return [i0, j0];
  for (let d = 1; d < 12; d++) {
    for (let dj = -d; dj <= d; dj++) {
      for (let di = -d; di <= d; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i >= 0 && j >= 0 && i < g.n && j < g.n && g.cost[j * g.n + i]) return [i, j];
      }
    }
  }
  return null;
}
// Straight walk between two points crosses only open cells.
function gridClear(g, ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / (NAV_CELL * 0.5)));
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const [i, j] = cellOf(g, ax + (bx - ax) * t, az + (bz - az) * t);
    if (!g.cost[j * g.n + i]) return false;
  }
  return true;
}
// Exact straight-walk test against cover, cliffs and deep water.
export function walkClear(field, a, b, radius = 2.5) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / 3));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (pointBlocked(field, x, z, radius * 1.1) || field.waterAt(x, z).depth > 1.6) return false;
  }
  return true;
}
// Index of the waypoint to head for: the furthest one (up to 3 ahead) the
// Zoid can walk to straight, so corners are not cut into walls.
export function nextWaypoint(field, pos, pts, i, radius = 2.5) {
  let best = i;
  for (let k = Math.min(pts.length - 1, i + 3); k > i; k--) {
    if (walkClear(field, pos, pts[k], radius)) { best = k; break; }
  }
  if (best === i && i < pts.length - 1 && Math.hypot(pts[i].x - pos.x, pts[i].z - pos.z) < 3) best = i + 1;
  return best;
}
// Waypoints from a to b (excluding a), or null when unreachable.
export function findPath(field, a, b, radius = 2.5, maxExpand = 30000) {
  const g = navGrid(field, radius);
  const s = nearestOpen(g, ...cellOf(g, a.x, a.z));
  const e = nearestOpen(g, ...cellOf(g, b.x, b.z));
  if (!s || !e) return null;
  const n = g.n;
  const start = s[1] * n + s[0];
  const goal = e[1] * n + e[0];
  const gScore = new Float32Array(n * n).fill(Infinity);
  const from = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  const heap = [];
  const hf = (c) => {
    const dx = Math.abs((c % n) - e[0]);
    const dz = Math.abs(Math.floor(c / n) - e[1]);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  };
  const push = (c, f) => {
    heap.push([f, c]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  gScore[start] = 0;
  push(start, hf(start));
  let expanded = 0;
  let found = false;
  while (heap.length && expanded < maxExpand) {
    const [, c] = pop();
    if (closed[c]) continue;
    closed[c] = 1;
    expanded++;
    if (c === goal) { found = true; break; }
    const ci = c % n;
    const cj = Math.floor(c / n);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const nc = j * n + i;
        const w = g.cost[nc];
        if (!w || closed[nc]) continue;
        if (di && dj && (!g.cost[cj * n + i] || !g.cost[j * n + ci])) continue; // no corner cutting
        const tg = gScore[c] + w * (di && dj ? 1.414 : 1);
        if (tg < gScore[nc]) {
          gScore[nc] = tg;
          from[nc] = c;
          push(nc, tg + hf(nc));
        }
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = goal; c !== -1; c = from[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: g.sx[c], z: g.sz[c] }));
  pts[pts.length - 1] = { x: b.x, z: b.z };
  // String pulling: keep only the turns.
  const out = [];
  let cur = { x: a.x, z: a.z };
  let k = 0;
  while (k < pts.length - 1) {
    let far = k;
    // Exact straight-walk test, up to 16 cells ahead.
    for (let m = Math.min(pts.length - 1, k + 16); m > k; m--) {
      if (walkClear(field, cur, pts[m], g.r * 0.8)) { far = m; break; }
    }
    if (far === k) far = k + 1;
    out.push(pts[far]);
    cur = pts[far];
    k = far;
  }
  if (!out.length) out.push({ x: b.x, z: b.z });
  return out;
}
