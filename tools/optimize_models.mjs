#!/usr/bin/env node
// Optimize the five Sketchfab Zoid GLBs into assets/models/<slug>.glb.
//
// What it does, in order:
//   1. Drops helper nodes (Lamp, Plane, lights, cameras) and their meshes.
//   2. Bakes node world matrices into vertex positions.
//   3. Welds and simplifies to about 60–150k triangles.
//   4. Yaws the model so the measured nose (+Z in these files) lies on -Z,
//      drops the feet onto y = 0, centers XZ, and uniformly scales the
//      largest dimension to the unscaled mock bbox (js/models.js, scale 1).
//      The game then applies ZOIDS[id].scale, same as the procedural mocks.
//   5. Splits triangles by centroid into the damage parts the game expects
//      (head, core, legs, tail, weapon mounts, back mount).
//   6. Clamps metalness/roughness so the mesh is visible without an env map,
//      generates normals, and meshopt-compresses the file.
//
// These sources have no textures. Shield Liger's KHR_materials_clearcoat
// extension is dropped on rewrite. Output meshes are double-sided.
//
// Run (packages install into /tmp/gltf-tools, not the game repo):
//
//   node tools/optimize_models.mjs
//
// Sources (CC-BY-4.0) are read from /workspace/zoids_models/. See CREDITS.txt.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = "/tmp/gltf-tools";
const TOOLS = path.join(TOOLS_DIR, "node_modules");
const OUT_DIR = path.join(ROOT, "assets", "models");
const SRC_DIR = "/workspace/zoids_models";

// Unscaled mock AABB (visual.scale forced to 1). Largest axis is the fit target.
const MOCK_SIZE = {
  "blade-liger": [3.41, 2.85, 5.89],
  "shield-liger": [2.65, 2.92, 5.89],
  "geno-saurer": [1.59, 3.77, 5.7],
  "command-wolf": [1.54, 3.01, 5.54],
  "iron-kong": [3.4, 4.79, 2.48],
  // Not mock-matched: fitted so (largest axis x ZOIDS[id].scale) gives a
  // canon-relative game size (~0.31 game units per canon metre, the same
  // ratio as Geno Saurer and Shield Liger). Death Saurer 32.4 m long ->
  // 10.0 units at scale 1.82; Death Stinger ~22 m (tail curled) -> 6.8 at 1.5.
  "death-saurer": [5.5, 5.5, 5.5],
  "death-stinger": [4.55, 4.55, 4.55],
  // Gun Sniper 11.9 m (rifle included) -> 3.7 units at scale 0.92.
  "gun-sniper": [4.0, 4.0, 4.0],
  // Zaber Fang 15.6 m -> 4.84 units at scale 0.96.
  "zaber-fang": [5.04, 5.04, 5.04],
  // Gojulas 26 m long (canon depth) -> 8.06 units at scale 1.48. The file is
  // posed upright (taller than long), so the largest axis is height: 6.19.
  "gojulas": [6.19, 6.19, 6.19],
};

// Side-view splats (camera on +X, image-right = +Z) put the head on +Z
// for every file. A half-turn about Y sends that nose to local -Z.
const FACING_YAW = {
  "blade-liger": Math.PI,
  "shield-liger": Math.PI,
  "geno-saurer": Math.PI,
  "command-wolf": Math.PI,
  "iron-kong": Math.PI,
  // After the Z-up fix these two have the nose on +X; a quarter turn puts it on -Z.
  "death-saurer": Math.PI / 2,
  "death-stinger": Math.PI / 2,
  "gun-sniper": Math.PI / 2,
  "zaber-fang": Math.PI / 2,
  "gojulas": Math.PI / 2,
};

const SOURCE = {
  "blade-liger": "m_01M542FS5WFKW0XW5HM8PP9FRS.glb",
  "shield-liger": "m_01M542FS6N6H6CWBDH7AKB6HS7.glb",
  "geno-saurer": "m_01M542FS767EPGE6TRXJCXAMGY.glb",
  "command-wolf": "m_01M542FS7F361CT01EZKCDE8W8.glb",
  "iron-kong": "m_01M542FS8BC1JVABHG2R5JP24R.glb",
  // Supplied by Daniel 2026-10-25 (Anderson455, CC-BY-4.0, see CREDITS.txt).
  "death-saurer": "death_saurer_zoids_free.glb",
  "death-stinger": "death_stinger_zoids_free.glb",
  // Supplied by Daniel 2026-10-25. No author/licence metadata (trimesh export).
  // Replaced 2026-10-25 15:19 by Daniel's second file (also trimesh, no metadata).
  "gun-sniper": "gun_sniper.glb",
  // Supplied by Daniel 2026-10-25. No author/licence metadata (trimesh export).
  "zaber-fang": "zaber_fang.glb",
  // Supplied by Daniel 2026-10-25 15:53. No author/licence metadata (trimesh).
  "gojulas": "gojulas.glb",
};

const TRI_TARGET = {
  "blade-liger": 70000,
  "shield-liger": 80000,
  "geno-saurer": 110000,
  "command-wolf": 90000,
  "iron-kong": 110000,
  "death-saurer": 110000,
  "death-stinger": 110000,
  "gun-sniper": 20000,
  "zaber-fang": 20000,
  "gojulas": 20000,
};

const QUAD = [
  "head", "core",
  "leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg",
  "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon",
];
const BIPED = [
  "head", "core", "leftLeg", "rightLeg",
  "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon",
];

const LAYOUT = {
  "blade-liger": "quad",
  "shield-liger": "quad",
  "command-wolf": "quad",
  "geno-saurer": "biped",
  "iron-kong": "biped",
  "death-saurer": "biped",
  "death-stinger": "quad",
  "gun-sniper": "biped",
  "zaber-fang": "quad",
  "gojulas": "biped",
};

function targetsFor(slug) {
  const quad = [
    { part: "head", u: 0.5, v: 0.74, w: 0.12, su: 0.22, sv: 0.18, sw: 0.12 },
    { part: "headWeapon", u: 0.5, v: 0.5, w: 0.03, su: 0.14, sv: 0.16, sw: 0.07 },
    { part: "core", u: 0.5, v: 0.58, w: 0.46, su: 0.24, sv: 0.2, sw: 0.22 },
    { part: "tail", u: 0.5, v: 0.5, w: 0.92, su: 0.18, sv: 0.2, sw: 0.12 },
    { part: "backMount", u: 0.5, v: 0.9, w: 0.48, su: 0.22, sv: 0.1, sw: 0.18 },
    { part: "leftWeapon", u: 0.06, v: 0.58, w: 0.4, su: 0.1, sv: 0.22, sw: 0.28 },
    { part: "rightWeapon", u: 0.94, v: 0.58, w: 0.4, su: 0.1, sv: 0.22, sw: 0.28 },
    { part: "leftFrontLeg", u: 0.28, v: 0.14, w: 0.3, su: 0.14, sv: 0.16, sw: 0.16 },
    { part: "rightFrontLeg", u: 0.72, v: 0.14, w: 0.3, su: 0.14, sv: 0.16, sw: 0.16 },
    { part: "leftRearLeg", u: 0.3, v: 0.14, w: 0.72, su: 0.14, sv: 0.16, sw: 0.16 },
    { part: "rightRearLeg", u: 0.7, v: 0.14, w: 0.72, su: 0.14, sv: 0.16, sw: 0.16 },
  ];
  if (slug === "shield-liger") {
    quad.push({ part: "leftFrontLeg", u: 0.1, v: 0.55, w: 0.32, su: 0.14, sv: 0.28, sw: 0.2 });
  }
  if (slug === "blade-liger") {
    // Lion: head and jaw forward, chest and back, folding blades on each
    // flank (left/rightWeapon), back gun pods (backMount), four legs, and a
    // long tail that rises from the hips (lowered later in POST).
    return [
      { part: "head", u: 0.5, v: 0.58, w: 0.08, su: 0.16, sv: 0.16, sw: 0.09 },
      { part: "headWeapon", u: 0.5, v: 0.4, w: 0.02, su: 0.12, sv: 0.08, sw: 0.04 },
      { part: "core", u: 0.5, v: 0.55, w: 0.45, su: 0.14, sv: 0.16, sw: 0.18 },
      { part: "backMount", u: 0.5, v: 0.78, w: 0.42, su: 0.1, sv: 0.1, sw: 0.16 },
      { part: "tail", u: 0.5, v: 0.75, w: 0.92, su: 0.12, sv: 0.35, sw: 0.16 },
      { part: "leftWeapon", u: 0.06, v: 0.68, w: 0.45, su: 0.14, sv: 0.25, sw: 0.3 },
      { part: "rightWeapon", u: 0.94, v: 0.68, w: 0.45, su: 0.14, sv: 0.25, sw: 0.3 },
      { part: "leftFrontLeg", u: 0.36, v: 0.2, w: 0.28, su: 0.1, sv: 0.2, sw: 0.12 },
      { part: "rightFrontLeg", u: 0.64, v: 0.2, w: 0.28, su: 0.1, sv: 0.2, sw: 0.12 },
      { part: "leftRearLeg", u: 0.36, v: 0.2, w: 0.62, su: 0.1, sv: 0.2, sw: 0.12 },
      { part: "rightRearLeg", u: 0.64, v: 0.2, w: 0.62, su: 0.1, sv: 0.2, sw: 0.12 },
    ];
  }
  if (slug === "command-wolf") {
    // Smaller wolf: long snout and jaw, slim body, side armour plates as
    // flank mounts, the long twin-barrel cannon on top of the back
    // (backMount), four thin legs, and a low tail.
    return [
      { part: "head", u: 0.5, v: 0.55, w: 0.1, su: 0.3, sv: 0.18, sw: 0.1 },
      { part: "headWeapon", u: 0.5, v: 0.4, w: 0.03, su: 0.2, sv: 0.08, sw: 0.04 },
      { part: "core", u: 0.5, v: 0.66, w: 0.45, su: 0.22, sv: 0.12, sw: 0.18 },
      { part: "backMount", u: 0.5, v: 0.92, w: 0.45, su: 0.25, sv: 0.08, sw: 0.4 },
      { part: "tail", u: 0.5, v: 0.55, w: 0.9, su: 0.2, sv: 0.15, sw: 0.12 },
      { part: "leftWeapon", u: 0.08, v: 0.68, w: 0.32, su: 0.1, sv: 0.12, sw: 0.12 },
      { part: "rightWeapon", u: 0.92, v: 0.68, w: 0.32, su: 0.1, sv: 0.12, sw: 0.12 },
      { part: "leftFrontLeg", u: 0.25, v: 0.22, w: 0.36, su: 0.15, sv: 0.22, sw: 0.1 },
      { part: "rightFrontLeg", u: 0.75, v: 0.22, w: 0.36, su: 0.15, sv: 0.22, sw: 0.1 },
      { part: "leftRearLeg", u: 0.25, v: 0.22, w: 0.66, su: 0.15, sv: 0.22, sw: 0.1 },
      { part: "rightRearLeg", u: 0.75, v: 0.22, w: 0.66, su: 0.15, sv: 0.22, sw: 0.1 },
    ];
  }
  if (slug === "geno-saurer") {
    // Raptor stance after the upright fix: head and jaw far forward, two big
    // hind legs mid-body, tiny clawed arms under the chest, a long tail behind
    // and the twin back cannons / charged particle cannon mount on top.
    return [
      { part: "head", u: 0.5, v: 0.76, w: 0.08, su: 0.24, sv: 0.18, sw: 0.13 },
      { part: "headWeapon", u: 0.5, v: 0.66, w: 0.02, su: 0.16, sv: 0.1, sw: 0.04 },
      { part: "core", u: 0.5, v: 0.6, w: 0.38, su: 0.28, sv: 0.2, sw: 0.14 },
      { part: "tail", u: 0.5, v: 0.6, w: 0.82, su: 0.3, sv: 0.3, sw: 0.18 },
      { part: "backMount", u: 0.5, v: 0.95, w: 0.4, su: 0.24, sv: 0.1, sw: 0.22 },
      { part: "leftWeapon", u: 0.3, v: 0.5, w: 0.2, su: 0.12, sv: 0.12, sw: 0.08 },
      { part: "rightWeapon", u: 0.7, v: 0.5, w: 0.2, su: 0.12, sv: 0.12, sw: 0.08 },
      { part: "leftLeg", u: 0.22, v: 0.2, w: 0.45, su: 0.18, sv: 0.2, sw: 0.2 },
      { part: "rightLeg", u: 0.78, v: 0.2, w: 0.45, su: 0.18, sv: 0.2, sw: 0.2 },
    ];
  }
  if (slug === "iron-kong") {
    // Upright gorilla: head and brow up front, broad chest, long arms
    // reaching to the ground on each side, short legs under the hips, and the
    // shoulder missile pack across the upper back. "tail" is the rear hip
    // armour (Iron Kong has no tail), kept small.
    return [
      { part: "head", u: 0.5, v: 0.82, w: 0.12, su: 0.2, sv: 0.15, sw: 0.16 },
      { part: "headWeapon", u: 0.5, v: 0.76, w: 0.06, su: 0.12, sv: 0.08, sw: 0.05 },
      { part: "core", u: 0.5, v: 0.6, w: 0.38, su: 0.2, sv: 0.18, sw: 0.18 },
      { part: "tail", u: 0.5, v: 0.38, w: 0.8, su: 0.14, sv: 0.12, sw: 0.12 },
      { part: "backMount", u: 0.5, v: 0.92, w: 0.55, su: 0.24, sv: 0.12, sw: 0.22 },
      { part: "leftWeapon", u: 0.1, v: 0.45, w: 0.35, su: 0.12, sv: 0.4, sw: 0.4 },
      { part: "rightWeapon", u: 0.9, v: 0.45, w: 0.35, su: 0.12, sv: 0.4, sw: 0.4 },
      { part: "leftLeg", u: 0.3, v: 0.16, w: 0.7, su: 0.14, sv: 0.18, sw: 0.2 },
      { part: "rightLeg", u: 0.7, v: 0.16, w: 0.7, su: 0.14, sv: 0.18, sw: 0.2 },
    ];
  }
  if (slug === "death-saurer") {
    // Horizontal tyrant pose, spine at u ~0.65 (the tail curls off to the
    // left in top view, so the box is not centred on the body). Head and
    // mouth (charged particle cannon) up front, clawed arms reaching forward
    // either side of the head, thighs at w ~0.45, spikes/intake fans on the
    // back, long tail behind that curls left.
    return [
      { part: "head", u: 0.65, v: 0.55, w: 0.08, su: 0.07, sv: 0.2, sw: 0.09 },
      { part: "headWeapon", u: 0.65, v: 0.45, w: 0.0, su: 0.05, sv: 0.1, sw: 0.03 },
      { part: "core", u: 0.65, v: 0.55, w: 0.38, su: 0.09, sv: 0.25, sw: 0.14 },
      { part: "tail", u: 0.62, v: 0.5, w: 0.85, su: 0.08, sv: 0.3, sw: 0.12 },
      { part: "tail", u: 0.2, v: 0.5, w: 0.95, su: 0.25, sv: 0.4, sw: 0.08 },
      { part: "backMount", u: 0.65, v: 0.92, w: 0.38, su: 0.15, sv: 0.12, sw: 0.14 },
      { part: "leftWeapon", u: 0.46, v: 0.6, w: 0.17, su: 0.05, sv: 0.25, sw: 0.12 },
      { part: "rightWeapon", u: 0.86, v: 0.6, w: 0.17, su: 0.05, sv: 0.25, sw: 0.12 },
      { part: "leftLeg", u: 0.49, v: 0.22, w: 0.45, su: 0.06, sv: 0.3, sw: 0.12 },
      { part: "rightLeg", u: 0.81, v: 0.22, w: 0.45, su: 0.06, sv: 0.3, sw: 0.12 },
    ];
  }
  if (slug === "death-stinger") {
    // Scorpion: low face and laser fangs at the front, big pincers out front
    // on each side (left/rightWeapon), legs in rows along the flanks grouped
    // into front/rear pairs, segmented tail rising at the back, charged
    // particle cannon in the tail tip pointing forward (backMount).
    return [
      { part: "head", u: 0.5, v: 0.3, w: 0.2, su: 0.1, sv: 0.15, sw: 0.1 },
      { part: "headWeapon", u: 0.5, v: 0.25, w: 0.03, su: 0.08, sv: 0.1, sw: 0.05 },
      { part: "core", u: 0.5, v: 0.4, w: 0.55, su: 0.1, sv: 0.25, sw: 0.15 },
      { part: "tail", u: 0.5, v: 0.55, w: 0.93, su: 0.1, sv: 0.3, sw: 0.08 },
      { part: "backMount", u: 0.5, v: 0.9, w: 0.84, su: 0.12, sv: 0.1, sw: 0.09 },
      { part: "leftWeapon", u: 0.15, v: 0.3, w: 0.17, su: 0.12, sv: 0.3, sw: 0.14 },
      { part: "rightWeapon", u: 0.85, v: 0.3, w: 0.17, su: 0.12, sv: 0.3, sw: 0.14 },
      { part: "leftFrontLeg", u: 0.18, v: 0.3, w: 0.52, su: 0.12, sv: 0.3, sw: 0.06 },
      { part: "rightFrontLeg", u: 0.82, v: 0.3, w: 0.52, su: 0.12, sv: 0.3, sw: 0.06 },
      { part: "leftRearLeg", u: 0.18, v: 0.3, w: 0.68, su: 0.12, sv: 0.3, sw: 0.06 },
      { part: "rightRearLeg", u: 0.82, v: 0.3, w: 0.68, su: 0.12, sv: 0.3, sw: 0.06 },
      { part: "leftRearLeg", u: 0.32, v: 0.3, w: 0.86, su: 0.06, sv: 0.3, sw: 0.08 },
      { part: "rightRearLeg", u: 0.68, v: 0.3, w: 0.86, su: 0.06, sv: 0.3, sw: 0.08 },
    ];
  }
  return quad;
}

function ensureTools() {
  const marker = path.join(TOOLS, "@gltf-transform/core/package.json");
  if (existsSync(marker) && existsSync(path.join(TOOLS, "meshoptimizer/package.json"))) return;
  mkdirSync(TOOLS_DIR, { recursive: true });
  if (!existsSync(path.join(TOOLS_DIR, "package.json"))) {
    writeFileSync(path.join(TOOLS_DIR, "package.json"), '{"private":true,"type":"module"}\n');
  }
  execSync(
    "npm install --no-audit --no-fund @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer",
    { cwd: TOOLS_DIR, stdio: "inherit" },
  );
}

function modUrl(rel) {
  return pathToFileURL(path.join(TOOLS, rel)).href;
}

function isHelperName(name) {
  return /(^|[^a-z0-9])(lamp|plane|light|camera|helper)([^a-z0-9]|$)/i.test(name || "");
}

function ancestorHelper(node) {
  let cursor = node;
  while (cursor && cursor.getName) {
    if (isHelperName(cursor.getName())) return true;
    cursor = cursor.getParentNode ? cursor.getParentNode() : null;
  }
  return false;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

// Some sources are not authored Y-up. These rotations (radians, applied X then
// Y then Z, before the facing yaw) stand them upright on their feet.
const PRE_ROT = {
  "blade-liger": [0, 0, 0],
  "shield-liger": [0, 0, 0],
  "command-wolf": [0, 0, 0],
  "geno-saurer": [-Math.PI / 2, 0, 0],
  "iron-kong": [-Math.PI / 2, -Math.PI / 2, 0],
  // Authored Z-up (Sketchfab export), nose on +X.
  "death-saurer": [-Math.PI / 2, 0, 0],
  "death-stinger": [-Math.PI / 2, 0, 0],
  "gun-sniper": [0, 0, 0],
  "zaber-fang": [0, 0, 0],
  "gojulas": [0, 0, 0],
};

function preRotFor(slug) {
  const env = process.env[`PREROT_${slug.replace(/-/g, "_").toUpperCase()}`];
  if (env) return env.split(",").map((n) => Number(n) * Math.PI / 180);
  return PRE_ROT[slug];
}

function eulerPoint(x, y, z, [ax, ay, az]) {
  let c = Math.cos(ax), s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay); s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az); s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

function yawPoint(x, y, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * x + s * z, y, -s * x + c * z];
}

function triArea(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const cxr = aby * acz - abz * acy;
  const cyr = abz * acx - abx * acz;
  const czr = abx * acy - aby * acx;
  return Math.hypot(cxr, cyr, czr);
}

// Daniel's second-round files (gun_sniper.glb, zaber_fang.glb) carry 512px
// panel-line PNGs per material instead of colour factors. The game renders
// flat per-part colours, so each texture is replaced by its mean colour
// (linear, measured with PIL 2026-10-25). Saves ~2.3 MB per file.
const GOJ_MEAN = {"frame": [0.0166, 0.0166, 0.0203, 1], "white": [0.6906, 0.6658, 0.5803, 1], "grey": [0.1722, 0.1982, 0.2334, 1], "cap": [0.0052, 0.0052, 0.0062, 1], "canopy": [0.8751, 0.0869, 0.009, 1], "teeth": [0.6983, 0.6598, 0.5512, 1], "steel": [0.3017, 0.329, 0.3774, 1], "claw": [0.011, 0.011, 0.0125, 1]};
const TEX_MEAN = {
  "gun-sniper": {"frame": [0.0624, 0.0523, 0.0403, 1], "blue": [0.0341, 0.0424, 0.2314, 1], "white": [0.7263, 0.7263, 0.7897, 1], "silver": [0.4819, 0.4934, 0.5656, 1], "canopy": [1.0, 0.2195, 0.0055, 1], "sensor": [0.1011, 0.7519, 0.1166, 1], "yellow": [0.8569, 0.5732, 0.0291, 1], "orange": [0.848, 0.3279, 0.0457, 1], "gold": [0.6023, 0.3642, 0.0424, 1], "claw": [0.0392, 0.0364, 0.0337, 1], "purple": [0.1243, 0.0775, 0.1965, 1]},
  "gojulas": GOJ_MEAN,
  "zaber-fang": {"gunmetal": [0.0761, 0.0683, 0.0575, 1], "plate": [0.2797, 0.2635, 0.2327, 1], "dark": [0.0194, 0.0176, 0.0158, 1], "steel": [0.389, 0.3992, 0.4305, 1], "red": [0.345, 0.013, 0.013, 1], "canopy": [0.0415, 0.586, 0.0781, 1], "eye": [0.0415, 0.586, 0.0781, 1], "ivory": [0.6432, 0.5821, 0.3893, 1], "salmon": [0.641, 0.1788, 0.1535, 1]},
};
let CURRENT_SLUG = null;

function matKey(material) {
  if (!material) return "default";
  let base = material.getBaseColorFactor ? material.getBaseColorFactor() : [0.7, 0.7, 0.7, 1];
  const tm = TEX_MEAN[CURRENT_SLUG];
  if (tm && material.getBaseColorTexture && material.getBaseColorTexture() && tm[material.getName()]) base = tm[material.getName()];
  const metal = material.getMetallicFactor ? material.getMetallicFactor() : 0.4;
  const rough = material.getRoughnessFactor ? material.getRoughnessFactor() : 0.5;
  const emit = material.getEmissiveFactor ? material.getEmissiveFactor() : [0, 0, 0];
  return JSON.stringify({
    name: material.getName ? material.getName() : "mat",
    base,
    metal,
    rough,
    emit,
  });
}

function parseKey(key) {
  if (key === "default") {
    return { name: "mat", base: [0.72, 0.72, 0.72, 1], metal: 0.4, rough: 0.5, emit: [0, 0, 0] };
  }
  return JSON.parse(key);
}

function clampMat(spec) {
  return {
    name: spec.name || "mat",
    base: spec.base || [0.72, 0.72, 0.72, 1],
    metal: Math.min(spec.metal ?? 0.45, 0.55),
    rough: Math.max(spec.rough ?? 0.45, 0.4),
    emit: spec.emit || [0, 0, 0],
  };
}

function extract(doc) {
  const groups = new Map();
  let tris = 0;
  let skipped = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (ancestorHelper(node) || isHelperName(mesh.getName())) {
      skipped += 1;
      continue;
    }
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute("POSITION");
      if (!posAcc) continue;
      const pos = posAcc.getArray();
      const idx = prim.getIndices() ? prim.getIndices().getArray() : null;
      const key = matKey(prim.getMaterial());
      if (!groups.has(key)) groups.set(key, []);
      const dest = groups.get(key);
      const triCount = idx ? idx.length / 3 : pos.length / 9;
      for (let t = 0; t < triCount; t++) {
        const ids = idx
          ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
          : [t * 3, t * 3 + 1, t * 3 + 2];
        const verts = [];
        for (const id of ids) {
          const p = transformPoint(world, pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
          verts.push(p[0], p[1], p[2]);
        }
        if (!verts.every((n) => Number.isFinite(n))) continue;
        if (triArea(...verts) < 1e-8) continue;
        dest.push(verts);
        tris += 1;
      }
    }
  }
  return { groups, tris, skipped };
}

function countTris(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) n += idx.getCount() / 3;
      else n += (prim.getAttribute("POSITION")?.getCount() || 0) / 3;
    }
  }
  return n;
}

async function simplifyGroups(groups, target, api) {
  const { Document } = api;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  for (const [key, tris] of groups) {
    if (!tris.length) continue;
    const spec = clampMat(parseKey(key));
    const material = doc.createMaterial(spec.name.slice(0, 40))
      .setBaseColorFactor(spec.base)
      .setMetallicFactor(spec.metal)
      .setRoughnessFactor(spec.rough)
      .setEmissiveFactor(spec.emit)
      .setDoubleSided(true);
    const floats = new Float32Array(tris.length * 9);
    const indices = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      floats.set(tris[i], i * 9);
      indices[i * 3] = i * 3;
      indices[i * 3 + 1] = i * 3 + 1;
      indices[i * 3 + 2] = i * 3 + 2;
    }
    const pos = doc.createAccessor().setType("VEC3").setArray(floats).setBuffer(buffer);
    const ind = doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(ind).setMaterial(material);
    const mesh = doc.createMesh().addPrimitive(prim);
    scene.addChild(doc.createNode(spec.name.slice(0, 40)).setMesh(mesh));
  }
  const radius = (() => {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const tris of groups.values()) {
      for (const tri of tris) {
        for (let k = 0; k < 9; k += 3) {
          for (let a = 0; a < 3; a++) {
            const v = tri[k + a];
            if (v < min[a]) min[a] = v;
            if (v > max[a]) max[a] = v;
          }
        }
      }
    }
    return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  })();
  await doc.transform(
    api.weld({ tolerance: radius * 1e-5 }),
  );
  let guard = 0;
  let error = 0.04;
  while (countTris(doc) > target * 1.08 && guard < 4) {
    const have = countTris(doc);
    const ratio = Math.max(0.05, Math.min(0.85, target / have));
    await doc.transform(api.simplify({ simplifier: api.MeshoptSimplifier, ratio, error }));
    error += 0.04;
    guard += 1;
    if (countTris(doc) >= have * 0.98 && error > 0.2) break;
  }
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      const idx = prim.getIndices()?.getArray();
      const spec = clampMat({
        name: prim.getMaterial()?.getName?.() || "mat",
        base: prim.getMaterial()?.getBaseColorFactor?.() || [0.72, 0.72, 0.72, 1],
        metal: prim.getMaterial()?.getMetallicFactor?.(),
        rough: prim.getMaterial()?.getRoughnessFactor?.(),
        emit: prim.getMaterial()?.getEmissiveFactor?.(),
      });
      const triCount = idx ? idx.length / 3 : pos.length / 9;
      for (let t = 0; t < triCount; t++) {
        const ids = idx ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2];
        const verts = [];
        for (const id of ids) verts.push(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
        if (!verts.every((n) => Number.isFinite(n))) continue;
        if (triArea(...verts) < 1e-10) continue;
        out.push({ v: verts, spec });
      }
    }
  }
  return out;
}

function normalize(tris, slug) {
  const yaw = FACING_YAW[slug];
  const pre = preRotFor(slug);
  if (pre.some((a) => a !== 0)) {
    for (const tri of tris) {
      for (let i = 0; i < 9; i += 3) {
        const p = eulerPoint(tri.v[i], tri.v[i + 1], tri.v[i + 2], pre);
        tri.v[i] = p[0];
        tri.v[i + 1] = p[1];
        tri.v[i + 2] = p[2];
      }
    }
    console.log(`  pre-rotation xyz ${pre.map((a) => (a * 180 / Math.PI).toFixed(0)).join(" ")} deg`);
  }
  for (const tri of tris) {
    for (let i = 0; i < 9; i += 3) {
      const p = yawPoint(tri.v[i], tri.v[i + 1], tri.v[i + 2], yaw);
      tri.v[i] = p[0];
      tri.v[i + 1] = p[1];
      tri.v[i + 2] = p[2];
    }
  }
  const box = boundsOf(tris);
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  for (const tri of tris) {
    for (let i = 0; i < 9; i += 3) {
      tri.v[i] -= cx;
      tri.v[i + 1] -= box.min[1];
      tri.v[i + 2] -= cz;
    }
  }
  if (LAYOUT[slug] === "quad") {
    const box2 = boundsOf(tris);
    let left = 0;
    let right = 0;
    for (const tri of tris) {
      const c = centroid(tri.v);
      const u = (c[0] - box2.min[0]) / (box2.size[0] || 1);
      const v = c[1] / (box2.size[1] || 1);
      if (v < 0.3) continue;
      if (u < 0.28) left += 1;
      else if (u > 0.72) right += 1;
    }
    if (right > left * 1.25) {
      for (const tri of tris) {
        for (let i = 0; i < 9; i += 3) tri.v[i] = -tri.v[i];
        const x0 = tri.v[0], y0 = tri.v[1], z0 = tri.v[2];
        tri.v[0] = tri.v[3]; tri.v[1] = tri.v[4]; tri.v[2] = tri.v[5];
        tri.v[3] = x0; tri.v[4] = y0; tri.v[5] = z0;
      }
      console.log("  mirrored X so the heavier flank sits on the left");
    }
  }
  const fitted = boundsOf(tris);
  const mock = MOCK_SIZE[slug];
  const scale = Math.max(...mock) / Math.max(...fitted.size);
  for (const tri of tris) {
    for (let i = 0; i < 9; i++) tri.v[i] *= scale;
  }
  return { scale, yaw, size: boundsOf(tris).size };
}

function boundsOf(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    for (let i = 0; i < 9; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = tri.v[i + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  return { min, max, size: min.map((v, i) => max[i] - v) };
}

function centroid(v) {
  return [
    (v[0] + v[3] + v[6]) / 3,
    (v[1] + v[4] + v[7]) / 3,
    (v[2] + v[5] + v[8]) / 3,
  ];
}

// These layouts score by distance only; the generic quad bonuses below were
// tuned for lions and pulled the raptor arms and the gorilla split apart.
const CUSTOM_SPLIT = new Set(["geno-saurer", "iron-kong", "blade-liger", "command-wolf", "death-saurer", "death-stinger"]);

function legPart(part) {
  return part.endsWith("Leg");
}

function scoreAt(slug, part, u, v, w, targets) {
  let best = -1e9;
  for (const t of targets) {
    if (t.part !== part) continue;
    const d = ((u - t.u) / t.su) ** 2 + ((v - t.v) / t.sv) ** 2 + ((w - t.w) / t.sw) ** 2;
    let score = -d;
    if (CUSTOM_SPLIT.has(slug)) {
      if (score > best) best = score;
      continue;
    }
    if (legPart(part) && v < 0.36) score += 2.4;
    if (legPart(part) && v > 0.52) score -= 3.2;
    if (part === "head" && w < 0.28 && v > 0.42) score += 1.3;
    if (part === "tail" && w > 0.78) score += 1.6;
    if (part === "backMount" && v > 0.72 && w > 0.25 && w < 0.75) score += 1.3;
    if ((part === "leftWeapon" || part === "rightWeapon") && (u < 0.18 || u > 0.82) && v > 0.25) score += 1.4;
    if (part === "headWeapon" && w < 0.14 && v > 0.25 && v < 0.75) score += 1.6;
    if (slug === "shield-liger" && part === "leftFrontLeg" && u < 0.36 && w < 0.6 && v > 0.18) score += 2.8;
    if (slug === "iron-kong" && (part === "leftWeapon" || part === "rightWeapon") && (u < 0.22 || u > 0.78)) score += 1.2;
    if (score > best) best = score;
  }
  return best;
}

// Files with meaningful node names are split by name, not by position.
// Gun Sniper (Daniel's file): 132 named meshes, Y-up, nose on +X, _L = left.
const NAMED_PARTS = {
  "gun-sniper": (name) => {
    if (/^rifle_/.test(name)) return "backMount";
    if (/^tail_/.test(name)) return "tail";
    if (/^chest_(beam_gun|gun_housing)/.test(name)) return "headWeapon";
    const side = /_L(_|$)/.test(name) ? "left" : /_R(_|$)/.test(name) ? "right" : null;
    if (side && /^(missile_|thruster_|back_fin)/.test(name)) return `${side}Weapon`;
    if (side && /^(thigh|shin|piston|metatarsus|hip_joint|knee_joint|ankle_joint|foot|toe|sickle_claw|heel_spur)/.test(name)) return `${side}Leg`;
    if (/^(head|jaw|tooth|canopy|eye_sensor|multi_blade)/.test(name)) return "head";
    return "core";
  },
  // Zaber Fang (Daniel's file): Y-up, nose on +X, legs suffixed FL/FR/RL/RR.
  "zaber-fang": (name) => {
    if (/^killer_sabre/.test(name)) return "headWeapon";
    if (/^(weapon_mount|shock_cannon|beam_cannon|ssm_pod)/.test(name)) return "backMount";
    if (/^(tail_seg|linear_laser_gun)/.test(name)) return "tail";
    if (/^strike_claw_FL/.test(name)) return "leftWeapon";
    if (/^strike_claw_FR/.test(name)) return "rightWeapon";
    const leg = name.match(/_(FL|FR|RL|RR)(_|$)/);
    if (leg) return { FL: "leftFrontLeg", FR: "rightFrontLeg", RL: "leftRearLeg", RR: "rightRearLeg" }[leg[1]];
    if (/^(head|snout|eye|jaw|tooth|canopy)/.test(name)) return "head";
    return "core";
  },
  // Gojulas (Daniel's file): Y-up, upright pose, nose on +X, _L/_R sides.
  "gojulas": (name) => {
    if (/^buster_/.test(name)) return "backMount";
    if (/^(tail_|dorsal_spike)/.test(name)) return "tail";
    if (/^(lower_jaw|upper_tooth|lower_tooth)/.test(name)) return "headWeapon";
    if (/^(skull|canopy|upper_jaw|jaw_hinge|head_side)/.test(name)) return "head";
    const side = /_L(_|$)/.test(name) ? "left" : /_R(_|$)/.test(name) ? "right" : null;
    if (side && /^(hmg_|shoulder_|upper_arm|elbow_|forearm|crusher_claw)/.test(name)) return `${side}Weapon`;
    if (side && /^(thigh|hip_cap|knee_cap|shin|ankle_cap|foot|toe|heel_claw)/.test(name)) return `${side}Leg`;
    return "core";
  },
};

function extractNamed(doc, slug) {
  const out = [];
  const pick = NAMED_PARTS[slug];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const part = pick(node.getName() || mesh.getName() || "");
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      const idx = prim.getIndices() ? prim.getIndices().getArray() : null;
      const spec = clampMat(parseKey(matKey(prim.getMaterial())));
      const triCount = idx ? idx.length / 3 : pos.length / 9;
      for (let t = 0; t < triCount; t++) {
        const ids = idx ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]] : [t * 3, t * 3 + 1, t * 3 + 2];
        const v = [];
        for (const id of ids) v.push(...transformPoint(world, pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]));
        if (!v.every((n) => Number.isFinite(n)) || triArea(...v) < 1e-10) continue;
        out.push({ v, spec, part });
      }
    }
  }
  return out;
}

function splitParts(tris, slug) {
  if (NAMED_PARTS[slug]) {
    const parts = LAYOUT[slug] === "quad" ? QUAD : BIPED;
    const buckets = Object.fromEntries(parts.map((id) => [id, []]));
    for (const tri of tris) buckets[tri.part].push(tri);
    return buckets;
  }
  const parts = LAYOUT[slug] === "quad" ? QUAD : BIPED;
  const targets = targetsFor(slug);
  const box = boundsOf(tris);
  const buckets = Object.fromEntries(parts.map((id) => [id, []]));
  for (const tri of tris) {
    const c = centroid(tri.v);
    const u = (c[0] - box.min[0]) / (box.size[0] || 1);
    const v = (c[1] - box.min[1]) / (box.size[1] || 1);
    const w = (c[2] - box.min[2]) / (box.size[2] || 1);
    tri.uvw = [u, v, w];
    let best = parts[0];
    let bestScore = -1e9;
    for (const part of parts) {
      const score = scoreAt(slug, part, u, v, w, targets);
      if (score > bestScore) {
        bestScore = score;
        best = part;
      }
    }
    buckets[best].push(tri);
  }
  if (process.env.DUMP_UVW) {
    const sample = tris.filter((_, i) => i % 6 === 0).map((t) => t.uvw.map((n) => +n.toFixed(3)));
    writeFileSync(`/tmp/glb-views/uvw-${slug}.json`, JSON.stringify(sample));
  }
  const minCount = Math.max(36, Math.floor(tris.length * 0.006));
  const primary = Object.fromEntries(targets.map((t) => [t.part, t]));
  for (const part of parts) {
    if (buckets[part].length >= minCount) continue;
    const target = primary[part];
    const donors = parts
      .filter((id) => id !== part)
      .sort((a, b) => buckets[b].length - buckets[a].length);
    const need = minCount - buckets[part].length;
    const pool = [];
    for (const donor of donors) {
      if (donor === "head" || donor === "core") {
        for (let i = 0; i < buckets[donor].length; i++) pool.push({ donor, i, tri: buckets[donor][i] });
      }
    }
    if (pool.length < need) {
      for (const donor of donors) {
        if (donor === "head" || donor === "core") continue;
        for (let i = 0; i < buckets[donor].length; i++) pool.push({ donor, i, tri: buckets[donor][i] });
      }
    }
    pool.sort((a, b) => {
      const du = a.tri.uvw[0] - target.u;
      const dv = a.tri.uvw[1] - target.v;
      const dw = a.tri.uvw[2] - target.w;
      const eu = b.tri.uvw[0] - target.u;
      const ev = b.tri.uvw[1] - target.v;
      const ew = b.tri.uvw[2] - target.w;
      return du * du + dv * dv + dw * dw - (eu * eu + ev * ev + ew * ew);
    });
    const taken = new Map();
    for (let n = 0; n < need && n < pool.length; n++) {
      const hit = pool[n];
      if (!taken.has(hit.donor)) taken.set(hit.donor, new Set());
      taken.get(hit.donor).add(hit.i);
      buckets[part].push(hit.tri);
    }
    for (const [donor, set] of taken) {
      buckets[donor] = buckets[donor].filter((_, i) => !set.has(i));
    }
  }
  return buckets;
}

function partCenter(list) {
  const c = [0, 0, 0];
  if (!list.length) return c;
  for (const tri of list) {
    const p = centroid(tri.v);
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  return c.map((v) => v / list.length);
}

function assertParts(slug, buckets) {
  const parts = LAYOUT[slug] === "quad" ? QUAD : BIPED;
  for (const id of parts) {
    if (!buckets[id] || !buckets[id].length) throw new Error(`${slug} has no triangles for ${id}`);
  }
  const head = partCenter(buckets.head);
  const core = partCenter(buckets.core);
  if (!(head[2] < core[2] - 0.02)) {
    throw new Error(`${slug} head is not in front of core (${head[2].toFixed(2)} vs ${core[2].toFixed(2)})`);
  }
  if (LAYOUT[slug] === "quad") {
    const lf = partCenter(buckets.leftFrontLeg);
    const rf = partCenter(buckets.rightFrontLeg);
    const lr = partCenter(buckets.leftRearLeg);
    if (!(lf[0] < rf[0])) throw new Error(`${slug} front legs swapped`);
    if (!(lf[2] < lr[2])) throw new Error(`${slug} front leg is not ahead of the rear`);
  } else {
    const l = partCenter(buckets.leftLeg);
    const r = partCenter(buckets.rightLeg);
    if (!(l[0] < r[0])) throw new Error(`${slug} legs swapped`);
  }
}

function writeDoc(buckets, api) {
  const { Document } = api;
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("Zoid");
  const root = doc.createNode("zoid");
  scene.addChild(root);
  const materials = new Map();
  for (const [part, tris] of Object.entries(buckets)) {
    if (!tris.length) continue;
    const byMat = new Map();
    for (const tri of tris) {
      const key = JSON.stringify(tri.spec);
      if (!byMat.has(key)) byMat.set(key, []);
      byMat.get(key).push(tri);
    }
    for (const [key, group] of byMat) {
      const spec = JSON.parse(key);
      if (!materials.has(key)) {
        materials.set(key, doc.createMaterial(spec.name || part)
          .setBaseColorFactor(spec.base)
          .setMetallicFactor(spec.metal)
          .setRoughnessFactor(spec.rough)
          .setEmissiveFactor(spec.emit)
          .setDoubleSided(true));
      }
      const floats = new Float32Array(group.length * 9);
      const indices = new Uint32Array(group.length * 3);
      for (let i = 0; i < group.length; i++) {
        floats.set(group[i].v, i * 9);
        indices[i * 3] = i * 3;
        indices[i * 3 + 1] = i * 3 + 1;
        indices[i * 3 + 2] = i * 3 + 2;
      }
      const pos = doc.createAccessor().setType("VEC3").setArray(floats).setBuffer(buffer);
      const ind = doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer);
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", pos)
        .setIndices(ind)
        .setMaterial(materials.get(key));
      const mesh = doc.createMesh(part).addPrimitive(prim);
      root.addChild(doc.createNode(part).setMesh(mesh).setExtras({ partId: part }));
    }
  }
  return doc;
}

// Per-Zoid fixes applied after the split.
//   tint:     base colour per part (the Geno and Kong sources are untextured
//             single white materials and read as bleached in game).
//   scale:    grow a part about its rear attachment point.
//   pitch:    rotate a part about its front root (radians, + tips the free end down).
const POST = {
  "geno-saurer": {
    tint: {
      head: [0.42, 0.05, 0.05], core: [0.38, 0.05, 0.05], tail: [0.36, 0.05, 0.05],
      leftLeg: [0.3, 0.05, 0.05], rightLeg: [0.3, 0.05, 0.05],
      leftWeapon: [0.2, 0.2, 0.22], rightWeapon: [0.2, 0.2, 0.22],
      backMount: [0.24, 0.24, 0.26], headWeapon: [0.12, 0.12, 0.13],
    },
    scale: { head: 1.45, headWeapon: 1.45 },
  },
  "iron-kong": {
    tint: {
      head: [0.16, 0.16, 0.18], core: [0.13, 0.13, 0.15], tail: [0.13, 0.13, 0.15],
      leftLeg: [0.18, 0.18, 0.2], rightLeg: [0.18, 0.18, 0.2],
      leftWeapon: [0.2, 0.2, 0.22], rightWeapon: [0.2, 0.2, 0.22],
      backMount: [0.5, 0.12, 0.05], headWeapon: [0.55, 0.3, 0.05],
    },
  },
  "blade-liger": {
    pitch: { tail: 0.5 },
  },
  // Untextured white sources: canon-style tints (purple Death Saurer with
  // dark claws/fans; gunmetal Death Stinger with gold cutters and a dark tail
  // cannon).
  "death-saurer": {
    tint: {
      head: [0.3, 0.14, 0.42], core: [0.27, 0.12, 0.38], tail: [0.27, 0.12, 0.38],
      leftLeg: [0.22, 0.1, 0.32], rightLeg: [0.22, 0.1, 0.32],
      leftWeapon: [0.16, 0.12, 0.18], rightWeapon: [0.16, 0.12, 0.18],
      backMount: [0.55, 0.16, 0.2], headWeapon: [0.6, 0.12, 0.1],
    },
  },
  "death-stinger": {
    tint: {
      head: [0.32, 0.34, 0.38], core: [0.3, 0.32, 0.36], tail: [0.3, 0.32, 0.36],
      leftFrontLeg: [0.18, 0.19, 0.22], rightFrontLeg: [0.18, 0.19, 0.22],
      leftRearLeg: [0.18, 0.19, 0.22], rightRearLeg: [0.18, 0.19, 0.22],
      leftWeapon: [0.6, 0.45, 0.15], rightWeapon: [0.6, 0.45, 0.15],
      backMount: [0.12, 0.12, 0.14], headWeapon: [0.6, 0.2, 0.12],
    },
  },
};

// POST edits (tail pitch, head scale) can shift the footprint; put the
// pivot back at the XZ centre and the feet back on y = 0.
function recenterXZ(slug, buckets) {
  const all = Object.values(buckets).flat();
  const b = boundsOf(all);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  if (Math.abs(cx) < 1e-3 && Math.abs(cz) < 1e-3 && Math.abs(y0) < 1e-3) return;
  for (const tri of all) {
    for (let i = 0; i < 9; i += 3) { tri.v[i] -= cx; tri.v[i + 1] -= y0; tri.v[i + 2] -= cz; }
  }
  console.log(`  recentred pivot by ${(-cx).toFixed(2)}, ${(-y0).toFixed(2)}, ${(-cz).toFixed(2)}`);
}

function postProcess(slug, buckets) {
  const cfg = POST[slug];
  if (!cfg) return;
  const all = Object.values(buckets).flat();
  const box = boundsOf(all);
  for (const [part, factor] of Object.entries(cfg.scale || {})) {
    // Anchor on the head's attachment (rear, lower edge), so it grows forward and up.
    const b = boundsOf(buckets.head);
    const ax = (b.min[0] + b.max[0]) / 2, ay = b.min[1] + b.size[1] * 0.3, az = b.max[2];
    for (const tri of buckets[part]) {
      for (let i = 0; i < 9; i += 3) {
        tri.v[i] = ax + (tri.v[i] - ax) * factor;
        tri.v[i + 1] = ay + (tri.v[i + 1] - ay) * factor;
        tri.v[i + 2] = az + (tri.v[i + 2] - az) * factor;
      }
    }
    console.log(`  scaled ${part} x${factor}`);
  }
  for (const [part, angle] of Object.entries(cfg.pitch || {})) {
    const b = boundsOf(buckets[part]);
    // Root = the front-most tail triangles (where it meets the hips).
    let ry = 0, n = 0;
    for (const tri of buckets[part]) {
      const c = centroid(tri.v);
      if (c[2] < b.min[2] + b.size[2] * 0.08) { ry += c[1]; n += 1; }
    }
    ry = n ? ry / n : b.min[1];
    const rz = b.min[2];
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const tri of buckets[part]) {
      for (let i = 0; i < 9; i += 3) {
        const dy = tri.v[i + 1] - ry, dz = tri.v[i + 2] - rz;
        tri.v[i + 1] = ry + dy * c - dz * s;
        tri.v[i + 2] = rz + dy * s + dz * c;
      }
    }
    const after = boundsOf(buckets[part]);
    console.log(`  pitched ${part} ${(angle * 180 / Math.PI).toFixed(0)} deg, top ${b.max[1].toFixed(2)} -> ${after.max[1].toFixed(2)} (body top ${box.max[1].toFixed(2)})`);
  }
  for (const [part, rgb] of Object.entries(cfg.tint || {})) {
    for (const tri of buckets[part] || []) {
      tri.spec = { ...tri.spec, name: `${slug}-${part}`, base: [...rgb, 1], metal: 0.5, rough: 0.5 };
    }
  }
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function writeSide(slug, buckets, view = "side") {
  const W = 420;
  const H = 280;
  const img = Buffer.alloc(W * H * 3, 8);
  const tris = Object.values(buckets).flat();
  const box = boundsOf(tris);
  const span = Math.max(box.size[1], box.size[2], view === "top" ? box.size[0] : 0) * 1.12 || 1;
  const midY = (box.min[1] + box.max[1]) / 2;
  const midZ = (box.min[2] + box.max[2]) / 2;
  const colors = {
    head: [240, 60, 60],
    headWeapon: [255, 180, 40],
    core: [180, 190, 200],
    tail: [40, 200, 120],
    backMount: [180, 80, 255],
    leftWeapon: [255, 80, 180],
    rightWeapon: [80, 160, 255],
    leftFrontLeg: [60, 120, 255],
    rightFrontLeg: [80, 80, 220],
    leftRearLeg: [40, 80, 180],
    rightRearLeg: [30, 50, 140],
    leftLeg: [60, 120, 255],
    rightLeg: [80, 80, 220],
  };
  for (const [part, list] of Object.entries(buckets)) {
    const col = colors[part] || [200, 200, 200];
    for (const tri of list) {
      const c = centroid(tri.v);
      const su = view === "top" ? c[0] - (box.min[0] + box.max[0]) / 2 : c[2] - midZ;
      const sv = view === "top" ? -(c[2] - midZ) : c[1] - midY;
      const px = Math.floor((su / span + 0.5) * (W - 10)) + 4;
      const py = Math.floor((0.5 - sv / span) * (H - 10)) + 4;
      if (px < 1 || py < 1 || px >= W - 2 || py >= H - 2) continue;
      const i = (py * W + px) * 3;
      img[i] = col[0];
      img[i + 1] = col[1];
      img[i + 2] = col[2];
    }
  }
  for (let y = 0; y < H; y++) {
    const i = (y * W + (W - 2)) * 3;
    img[i] = 0;
    img[i + 1] = 255;
    img[i + 2] = 80;
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
  mkdirSync("/tmp/glb-views", { recursive: true });
  writeFileSync(`/tmp/glb-views/out-${slug}-${view}.png`, png);
}

function mb(file) {
  return statSync(file).size / (1024 * 1024);
}

async function main() {
  ensureTools();
  const core = await import(modUrl("@gltf-transform/core/dist/index.js"));
  const fn = await import(modUrl("@gltf-transform/functions/dist/index.js"));
  const ext = await import(modUrl("@gltf-transform/extensions/dist/index.js"));
  const { MeshoptSimplifier } = await import(modUrl("meshoptimizer/meshopt_simplifier.js"));
  const { MeshoptEncoder } = await import(modUrl("meshoptimizer/meshopt_encoder.js"));
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new core.NodeIO()
    .registerExtensions([ext.EXTMeshoptCompression])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const api = {
    Document: core.Document,
    weld: fn.weld,
    simplify: fn.simplify,
    normals: fn.normals,
    dedup: fn.dedup,
    prune: fn.prune,
    meshopt: fn.meshopt,
    MeshoptSimplifier,
    MeshoptEncoder,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const report = [];
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  for (const [slug, file] of Object.entries(SOURCE)) {
    if (only && !only.includes(slug)) continue;
    CURRENT_SLUG = slug;
    const src = path.join(SRC_DIR, file);
    const before = mb(src);
    console.log(`\n== ${slug}  source ${before.toFixed(2)} MB`);
    const doc = await io.read(src);
    const extracted = NAMED_PARTS[slug] ? null : extract(doc);
    if (extracted) console.log(`  tris ${extracted.tris}  helper nodes skipped ${extracted.skipped}  materials ${extracted.groups.size}`);
    // Named files are small and low-poly: keep every triangle and the part names.
    const simplified = extracted ? await simplifyGroups(extracted.groups, TRI_TARGET[slug], api) : extractNamed(doc, slug);
    console.log(`  simplified tris ${simplified.length}`);
    const fit = normalize(simplified, slug);
    console.log(`  yaw ${fit.yaw.toFixed(3)} scale ${fit.scale.toFixed(4)} size ${fit.size.map((n) => n.toFixed(2)).join(" x ")}`);
    const buckets = splitParts(simplified, slug);
    for (const [part, list] of Object.entries(buckets)) {
      const c = partCenter(list);
      console.log(`  ${part.padEnd(16)} ${String(list.length).padStart(6)}  center ${c.map((n) => Number.isFinite(n) ? n.toFixed(2) : "nan").join(", ")}`);
    }
    postProcess(slug, buckets);
    recenterXZ(slug, buckets);
    writeSide(slug, buckets);
    writeSide(slug, buckets, "top");
    assertParts(slug, buckets);
    const finalDoc = writeDoc(buckets, api);
    await finalDoc.transform(
      api.weld({ tolerance: 1e-4 }),
      api.normals({ overwrite: true }),
      api.dedup(),
      api.prune(),
      api.meshopt({ encoder: MeshoptEncoder, level: "high" }),
    );
    const out = path.join(OUT_DIR, `${slug}.glb`);
    await io.write(out, finalDoc);
    const after = mb(out);
    const tris = Object.values(buckets).reduce((n, list) => n + list.length, 0);
    console.log(`  wrote ${out}  ${after.toFixed(2)} MB  ${tris} tris`);
    report.push({ slug, before: Number(before.toFixed(2)), after: Number(after.toFixed(2)), sourceTris: extracted ? extracted.tris : simplified.length, tris, size: fit.size.map((n) => Number(n.toFixed(2))) });
  }
  writeFileSync("/tmp/glb-opt-report.json", JSON.stringify(report, null, 2));
  console.log("\nreport /tmp/glb-opt-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
