#!/usr/bin/env node
// Bake a "Melee" clip (Strike Claw swipe) into the skinned Shield Liger GLB,
// on its own rig, and write it back meshopt-compressed.
//
//   node tools/add_melee_clip.mjs [in.glb] [out.glb]
//   (default: assets/models/shield-liger-anim.glb in place)
//
// Keys at 24 fps over 0.62 s, the same wind-up / strike / recover envelope as
// js/models.js meleeEnvelope. Each keyed bone turns about the world lateral
// axis (+X) expressed in its parent frame, so a positive angle swings a
// hanging limb forward and tips a forward-pointing head up:
//   rightFrontLeg_hip +1.3a, _knee +0.45a, _paw +0.6a  (paw raised, slashed down)
//   spine3 -0.12a, spine1 +0.05a, neck -0.12a, head -0.22a, jaw -0.45 max(a,0)
// The mission plays it additively over Idle / Walk / Run (models.js).
// Packages install into /tmp/gltf-tools (same as tools/compress_shield_anim.mjs).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = "/tmp/gltf-tools";
const TOOLS = path.join(TOOLS_DIR, "node_modules");
if (!existsSync(path.join(TOOLS, "@gltf-transform/core/package.json"))) {
  mkdirSync(TOOLS_DIR, { recursive: true });
  if (!existsSync(path.join(TOOLS_DIR, "package.json"))) writeFileSync(path.join(TOOLS_DIR, "package.json"), '{"private":true,"type":"module"}\n');
  execSync("npm install --no-audit --no-fund @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions meshoptimizer", { cwd: TOOLS_DIR, stdio: "inherit" });
}
const mod = (rel) => import(pathToFileURL(path.join(TOOLS, rel)).href);
const core = await mod("@gltf-transform/core/dist/index.js");
const functions = await mod("@gltf-transform/functions/dist/index.js");
const extensions = await mod("@gltf-transform/extensions/dist/index.js");
const { MeshoptEncoder } = await mod("meshoptimizer/meshopt_encoder.js");
const { MeshoptDecoder } = await mod("meshoptimizer/meshopt_decoder.mjs");
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const input = process.argv[2] || path.join(root, "assets/models/shield-liger-anim.glb");
const output = process.argv[3] || input;
const io = new core.NodeIO()
  .registerExtensions([extensions.EXTMeshoptCompression])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(input);
const rootDoc = doc.getRoot();

// --- tiny quaternion helpers ([x, y, z, w]) ---
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [p[0], p[1], p[2]]; };
const qaxis = (axis, ang) => { const s = Math.sin(ang / 2); const n = Math.hypot(...axis) || 1; return [axis[0] / n * s, axis[1] / n * s, axis[2] / n * s, Math.cos(ang / 2)]; };
function worldQuat(node) {
  let q = [0, 0, 0, 1];
  const chain = [];
  for (let n = node; n; n = n.getParentNode ? n.getParentNode() : null) chain.unshift(n);
  for (const n of chain) q = qmul(q, n.getRotation());
  return q;
}

const SMOOTH = (t) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
function envelope(u) {
  if (u <= 0) return 0;
  if (u < 0.3) return -0.5 * SMOOTH(u / 0.3);
  if (u < 0.45) return -0.5 + 1.5 * SMOOTH((u - 0.3) / 0.15);
  if (u < 1) return 1 - SMOOTH((u - 0.45) / 0.55);
  return 0;
}
const KEYS = {
  rightFrontLeg_hip: (a) => 1.3 * a,
  rightFrontLeg_knee: (a) => 0.45 * a,
  rightFrontLeg_paw: (a) => 0.6 * a,
  spine3: (a) => -0.12 * a,
  spine1: (a) => 0.05 * a,
  neck: (a) => -0.12 * a,
  head: (a) => -0.22 * a,
  jaw: (a) => -0.45 * Math.max(0, a),
};
const DUR = 0.62;
const FPS = 24;
const frames = Math.round(DUR * FPS);

for (const old of rootDoc.listAnimations()) if (old.getName() === "Melee") old.dispose();
const anim = doc.createAnimation("Melee");
const buffer = rootDoc.listBuffers()[0];
const times = new Float32Array(frames + 1).map((_, i) => i / FPS);
const timeAcc = doc.createAccessor("melee_t").setType("SCALAR").setArray(times).setBuffer(buffer);
let keyed = 0;
for (const [name, fn] of Object.entries(KEYS)) {
  // Bones, not the same-named meshes: a joint of some skin.
  const joints = new Set(rootDoc.listSkins().flatMap((s) => s.listJoints()));
  const node = rootDoc.listNodes().find((n) => joints.has(n) && (n.getName() === name || n.getName().startsWith(`${name}_`) || n.getName().startsWith(`${name}.`)));
  if (!node) { console.warn("no bone", name); continue; }
  const parent = node.getParentNode ? node.getParentNode() : null;
  const pq = parent ? worldQuat(parent) : [0, 0, 0, 1];
  const axis = qrot(qconj(pq), [1, 0, 0]);
  const rest = node.getRotation();
  const out = new Float32Array((frames + 1) * 4);
  for (let i = 0; i <= frames; i++) {
    const q = qmul(qaxis(axis, fn(envelope(i / frames))), rest);
    out.set(q, i * 4);
  }
  const valAcc = doc.createAccessor(`melee_${name}`).setType("VEC4").setArray(out).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(timeAcc).setOutput(valAcc).setInterpolation("LINEAR");
  const channel = doc.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(sampler);
  anim.addSampler(sampler).addChannel(channel);
  keyed += 1;
}
console.log("Melee clip channels", keyed, "frames", frames + 1);
if (keyed < 6) throw new Error("too few bones keyed");
await doc.transform(functions.dedup(), functions.prune(), functions.meshopt({ encoder: MeshoptEncoder, level: "high" }));
await io.write(output, doc);
console.log("wrote", output, (statSync(output).size / 1048576).toFixed(2), "MB", "animations:", rootDoc.listAnimations().map((a) => a.getName()).join(","));
