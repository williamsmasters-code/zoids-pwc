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
};

// Side-view splats (camera on +X, image-right = +Z) put the head on +Z
// for every file. A half-turn about Y sends that nose to local -Z.
const FACING_YAW = {
  "blade-liger": Math.PI,
  "shield-liger": Math.PI,
  "geno-saurer": Math.PI,
  "command-wolf": Math.PI,
  "iron-kong": Math.PI,
};

const SOURCE = {
  "blade-liger": "m_01M542FS5WFKW0XW5HM8PP9FRS.glb",
  "shield-liger": "m_01M542FS6N6H6CWBDH7AKB6HS7.glb",
  "geno-saurer": "m_01M542FS767EPGE6TRXJCXAMGY.glb",
  "command-wolf": "m_01M542FS7F361CT01EZKCDE8W8.glb",
  "iron-kong": "m_01M542FS8BC1JVABHG2R5JP24R.glb",
};

const TRI_TARGET = {
  "blade-liger": 70000,
  "shield-liger": 80000,
  "geno-saurer": 110000,
  "command-wolf": 90000,
  "iron-kong": 110000,
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
  if (slug === "geno-saurer") {
    return [
      { part: "head", u: 0.5, v: 0.84, w: 0.16, su: 0.2, sv: 0.14, sw: 0.14 },
      { part: "headWeapon", u: 0.5, v: 0.62, w: 0.04, su: 0.16, sv: 0.14, sw: 0.08 },
      { part: "core", u: 0.5, v: 0.55, w: 0.42, su: 0.2, sv: 0.18, sw: 0.18 },
      { part: "tail", u: 0.5, v: 0.42, w: 0.9, su: 0.18, sv: 0.2, sw: 0.14 },
      { part: "backMount", u: 0.5, v: 0.78, w: 0.4, su: 0.18, sv: 0.12, sw: 0.16 },
      { part: "leftWeapon", u: 0.12, v: 0.5, w: 0.36, su: 0.12, sv: 0.18, sw: 0.16 },
      { part: "rightWeapon", u: 0.88, v: 0.5, w: 0.36, su: 0.12, sv: 0.18, sw: 0.16 },
      { part: "leftLeg", u: 0.34, v: 0.16, w: 0.5, su: 0.14, sv: 0.16, sw: 0.18 },
      { part: "rightLeg", u: 0.66, v: 0.16, w: 0.5, su: 0.14, sv: 0.16, sw: 0.18 },
    ];
  }
  if (slug === "iron-kong") {
    return [
      { part: "head", u: 0.5, v: 0.86, w: 0.22, su: 0.2, sv: 0.12, sw: 0.16 },
      { part: "headWeapon", u: 0.5, v: 0.7, w: 0.06, su: 0.16, sv: 0.12, sw: 0.1 },
      { part: "core", u: 0.5, v: 0.55, w: 0.45, su: 0.18, sv: 0.16, sw: 0.18 },
      { part: "tail", u: 0.5, v: 0.4, w: 0.9, su: 0.16, sv: 0.16, sw: 0.12 },
      { part: "backMount", u: 0.5, v: 0.78, w: 0.58, su: 0.2, sv: 0.12, sw: 0.16 },
      { part: "leftWeapon", u: 0.08, v: 0.4, w: 0.4, su: 0.12, sv: 0.22, sw: 0.22 },
      { part: "rightWeapon", u: 0.92, v: 0.4, w: 0.4, su: 0.12, sv: 0.22, sw: 0.22 },
      { part: "leftLeg", u: 0.36, v: 0.12, w: 0.55, su: 0.12, sv: 0.14, sw: 0.16 },
      { part: "rightLeg", u: 0.64, v: 0.12, w: 0.55, su: 0.12, sv: 0.14, sw: 0.16 },
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

function matKey(material) {
  if (!material) return "default";
  const base = material.getBaseColorFactor ? material.getBaseColorFactor() : [0.7, 0.7, 0.7, 1];
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

function legPart(part) {
  return part.endsWith("Leg");
}

function scoreAt(slug, part, u, v, w, targets) {
  let best = -1e9;
  for (const t of targets) {
    if (t.part !== part) continue;
    const d = ((u - t.u) / t.su) ** 2 + ((v - t.v) / t.sv) ** 2 + ((w - t.w) / t.sw) ** 2;
    let score = -d;
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

function splitParts(tris, slug) {
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
function writeSide(slug, buckets) {
  const W = 420;
  const H = 280;
  const img = Buffer.alloc(W * H * 3, 8);
  const tris = Object.values(buckets).flat();
  const box = boundsOf(tris);
  const span = Math.max(box.size[1], box.size[2]) * 1.12 || 1;
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
      const su = c[2] - midZ;
      const sv = c[1] - midY;
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
  writeFileSync(`/tmp/glb-views/out-${slug}-side.png`, png);
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
  for (const [slug, file] of Object.entries(SOURCE)) {
    const src = path.join(SRC_DIR, file);
    const before = mb(src);
    console.log(`\n== ${slug}  source ${before.toFixed(2)} MB`);
    const doc = await io.read(src);
    const extracted = extract(doc);
    console.log(`  tris ${extracted.tris}  helper nodes skipped ${extracted.skipped}  materials ${extracted.groups.size}`);
    const simplified = await simplifyGroups(extracted.groups, TRI_TARGET[slug], api);
    console.log(`  simplified tris ${simplified.length}`);
    const fit = normalize(simplified, slug);
    console.log(`  yaw ${fit.yaw.toFixed(3)} scale ${fit.scale.toFixed(4)} size ${fit.size.map((n) => n.toFixed(2)).join(" x ")}`);
    const buckets = splitParts(simplified, slug);
    for (const [part, list] of Object.entries(buckets)) {
      const c = partCenter(list);
      console.log(`  ${part.padEnd(16)} ${String(list.length).padStart(6)}  center ${c.map((n) => Number.isFinite(n) ? n.toFixed(2) : "nan").join(", ")}`);
    }
    writeSide(slug, buckets);
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
    report.push({ slug, before: Number(before.toFixed(2)), after: Number(after.toFixed(2)), sourceTris: extracted.tris, tris, size: fit.size.map((n) => Number(n.toFixed(2))) });
  }
  writeFileSync("/tmp/glb-opt-report.json", JSON.stringify(report, null, 2));
  console.log("\nreport /tmp/glb-opt-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
