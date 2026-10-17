#!/usr/bin/env node
// Compress the raw skinned Shield Liger GLB written by tools/rig_shield_liger.py.
//
//   node tools/compress_shield_anim.mjs /tmp/shield-liger-anim-raw.glb assets/models/shield-liger-anim.glb
//
// Dedup, prune, clamp materials, and meshopt-compress. Does not simplify:
// the triangles are already skinned. Packages install into /tmp/gltf-tools.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS_DIR = "/tmp/gltf-tools";
const TOOLS = path.join(TOOLS_DIR, "node_modules");

function ensureTools() {
  if (existsSync(path.join(TOOLS, "@gltf-transform/core/package.json"))
    && existsSync(path.join(TOOLS, "meshoptimizer/package.json"))) return;
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

ensureTools();
const core = await import(modUrl("@gltf-transform/core/dist/index.js"));
const functions = await import(modUrl("@gltf-transform/functions/dist/index.js"));
const extensions = await import(modUrl("@gltf-transform/extensions/dist/index.js"));
const encoderMod = await import(modUrl("meshoptimizer/meshopt_encoder.js"));

const { NodeIO } = core;
const { dedup, prune, meshopt } = functions;
const { EXTMeshoptCompression } = extensions;
const MeshoptEncoder = encoderMod.MeshoptEncoder;
await MeshoptEncoder.ready;

const raw = process.argv[2];
const out = process.argv[3];
if (!raw || !out) {
  console.error("usage: node tools/compress_shield_anim.mjs <raw.glb> <out.glb>");
  process.exit(1);
}

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const doc = await io.read(raw);
let tris = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += idx ? idx.getCount() / 3 : (prim.getAttribute("POSITION")?.getCount() || 0) / 3;
  }
}
for (const material of doc.getRoot().listMaterials()) {
  const metal = material.getMetallicFactor();
  const rough = material.getRoughnessFactor();
  material.setMetallicFactor(Math.min(metal ?? 0.4, 0.55));
  material.setRoughnessFactor(Math.max(rough ?? 0.45, 0.4));
  material.setDoubleSided(true);
}

const skins = doc.getRoot().listSkins().length;
const anims = doc.getRoot().listAnimations().map((a) => a.getName());
console.log("raw tris", tris, "skins", skins, "anims", anims.join(","));
if (!skins) throw new Error("raw GLB has no skin");
if (anims.length < 6) throw new Error(`expected 6 animations, got ${anims.join(",")}`);

// Shield clips only drive the mane plates. Legs and spine stay on the
// locomotion clips, so the Zoid can walk while the shield is up.
// Locomotion must not key those plates: AnimationMixer normalizes weights,
// and a rest-pose track would hold the deploy at half.
const SHIELD_BONES = new Set(["shieldChin", "shieldTop", "shieldLeft", "shieldRight"]);
const LOCO = new Set(["Idle", "Walk", "Run", "Fire"]);
for (const anim of doc.getRoot().listAnimations()) {
  const clip = anim.getName();
  if (clip === "ShieldActivate" || clip === "ShieldMaintain") {
    let kept = 0;
    for (const channel of [...anim.listChannels()]) {
      const node = channel.getTargetNode();
      const name = node ? node.getName() : "";
      if (!SHIELD_BONES.has(name)) anim.removeChannel(channel);
      else kept += 1;
    }
    console.log(clip, "shield channels", kept);
    if (!kept) throw new Error(`${clip} lost every shield channel`);
  } else if (LOCO.has(clip)) {
    let removed = 0;
    for (const channel of [...anim.listChannels()]) {
      const node = channel.getTargetNode();
      const name = node ? node.getName() : "";
      if (!SHIELD_BONES.has(name)) continue;
      anim.removeChannel(channel);
      removed += 1;
    }
    console.log(clip, "dropped shield channels", removed);
  }
}

try {
  await doc.transform(
    dedup(),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  console.log("meshopt ok");
} catch (err) {
  console.warn("meshopt skipped", err);
  await doc.transform(dedup(), prune());
}

await io.write(out, doc);
const mb = statSync(out).size / (1024 * 1024);
console.log("wrote", out, mb.toFixed(2), "MB");
if (mb > 50) throw new Error("compressed GLB is over 50 MB");
