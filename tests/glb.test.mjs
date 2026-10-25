// Loads the optimized GLBs with the vendored GLTFLoader and checks that
// every damage part is present, the head sits in front of the core, and a
// failed or forced-mock load falls back to the procedural model.

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "../vendor/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "../vendor/addons/libs/meshopt_decoder.module.js";
import { ZOIDS, partListFor } from "../js/catalog.js";
import {
  buildUnitModel,
  disposeTree,
  rememberGlbTemplate,
  clearGlbTemplates,
} from "../js/models.js";

const FILES = {
  commandWolf: "command-wolf",
  shieldLiger: "shield-liger",
  bladeLiger: "blade-liger",
  ironKong: "iron-kong",
  genoSaurer: "geno-saurer",
  deathSaurer: "death-saurer",
  deathStinger: "death-stinger",
  gunSniper: "gun-sniper",
  zaberFang: "zaber-fang",
  gojulas: "gojulas",
};
// Canon-relative size check (2026-10-25 models): ~0.31 game units per canon
// metre, same ratio as Geno Saurer (23 m) and Shield Liger (21.6 m).
const CANON_LENGTH_M = { genoSaurer: 23, shieldLiger: 21.6, deathSaurer: 32.4, deathStinger: 22, gunSniper: 11.9, zaberFang: 15.6, gojulas: 26 };
const sizes = {};

function center(meshes) {
  const box = new Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box.getCenter(new Vector3());
}

function parseGlb(slug) {
  const buf = readFileSync(new URL(`../assets/models/${slug}.glb`, import.meta.url));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", resolve, reject);
  });
}

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

clearGlbTemplates();
const scenes = {};
for (const [id, slug] of Object.entries(FILES)) {
  const started = performance.now();
  const gltf = await parseGlb(slug);
  scenes[id] = gltf.scene;
  rememberGlbTemplate(id, gltf.scene);
  const def = ZOIDS[id];
  const model = buildUnitModel(def, [], "player");
  const elapsed = performance.now() - started;
  for (const partId of partListFor(def)) {
    if (!model.partMeshes[partId] || model.partMeshes[partId].length === 0) {
      throw new Error(`${slug} is missing part ${partId}`);
    }
  }
  let glbMeshes = 0;
  model.root.traverse((obj) => {
    if (obj.isMesh && obj.userData && obj.userData.glbPart) glbMeshes += 1;
  });
  if (glbMeshes < partListFor(def).length) {
    throw new Error(`${slug} built a mock instead of the GLB`);
  }
  model.root.rotation.y = 0;
  model.root.updateMatrixWorld(true);
  const fwd = new Vector3();
  model.root.getWorldDirection(fwd);
  fwd.negate();
  fwd.y = 0;
  fwd.normalize();
  const rel = center(model.partMeshes.head).sub(center(model.partMeshes.core));
  rel.y = 0;
  rel.normalize();
  const dot = rel.dot(fwd);
  if (dot < 0.7) throw new Error(`${slug} head is not in front of the core (dot ${dot.toFixed(3)})`);
  if (!model.anchors.eye) throw new Error(`${slug} has no eye anchor`);
  for (const mount of ["headWeapon", "leftWeapon", "rightWeapon", "backMount"]) {
    if (!model.anchors[mount]) throw new Error(`${slug} is missing the ${mount} anchor`);
  }
  if (def.layout === "quad") {
    const left = center(model.partMeshes.leftFrontLeg);
    const right = center(model.partMeshes.rightFrontLeg);
    if (!(left.x < right.x)) throw new Error(`${slug} front legs are swapped`);
  }
  if (def.layout === "biped") {
    const left = center(model.partMeshes.leftLeg);
    const right = center(model.partMeshes.rightLeg);
    if (!(left.x < right.x)) throw new Error(`${slug} legs are swapped`);
  }
  // Orientation: up axis (feet on y = 0, legs below the core), centred,
  // forward along -Z (checked above via the head), and size.
  const whole = new Box3().setFromObject(model.visual);
  const size = whole.getSize(new Vector3());
  const mid = whole.getCenter(new Vector3());
  if (Math.abs(whole.min.y) > 0.05) throw new Error(`${slug} is not standing on y = 0 (min y ${whole.min.y.toFixed(3)})`);
  if (Math.abs(mid.x) > 0.05 || Math.abs(mid.z) > 0.05) throw new Error(`${slug} is not centred (${mid.x.toFixed(2)}, ${mid.z.toFixed(2)})`);
  const legIds = partListFor(def).filter((id) => /Leg$/.test(id));
  const legY = legIds.reduce((y, id) => y + center(model.partMeshes[id]).y, 0) / legIds.length;
  if (!(legY < center(model.partMeshes.core).y)) throw new Error(`${slug} legs are not below the core (upside down?)`);
  if (!(size.y < Math.max(size.x, size.z) * 1.6)) throw new Error(`${slug} looks stood on end (${size.toArray().map((n) => n.toFixed(1))})`);
  sizes[id] = size;
  if (CANON_LENGTH_M[id]) {
    const perM = size.z / CANON_LENGTH_M[id];
    if (perM < 0.25 || perM > 0.38) throw new Error(`${slug} length ${size.z.toFixed(2)} is off canon scale (${perM.toFixed(3)}/m)`);
  }
  model.animate(0.4, 0.8, null);
  disposeTree(model.root);
  console.log("glb ok", slug, "dot", dot.toFixed(3), "parse+build", elapsed.toFixed(0), "ms");
}

if (!(sizes.deathSaurer.z > sizes.genoSaurer.z * 1.2)) throw new Error("Death Saurer should be much longer than Geno Saurer");
if (!(sizes.deathSaurer.y > sizes.genoSaurer.y)) throw new Error("Death Saurer should stand taller than Geno Saurer");
console.log("canon sizes ok", Object.entries(sizes).map(([k, v]) => `${k} ${v.x.toFixed(1)}x${v.y.toFixed(1)}x${v.z.toFixed(1)}`).join(", "));

clearGlbTemplates();
rememberGlbTemplate("shieldLiger", null);
const failed = buildUnitModel(ZOIDS.shieldLiger, [], "player");
let leaked = false;
failed.root.traverse((obj) => {
  if (obj.userData && obj.userData.glbPart) leaked = true;
});
if (leaked) throw new Error("a failed GLB did not fall back to the mock");
if (!failed.partMeshes.head.length) throw new Error("mock fallback has no head");
disposeTree(failed.root);
console.log("glb fallback ok");

rememberGlbTemplate("bladeLiger", scenes.bladeLiger);
globalThis.__ZOIDS_FORCE_MOCK = true;
const forced = buildUnitModel(ZOIDS.bladeLiger, [], "player");
forced.root.traverse((obj) => {
  if (obj.userData && obj.userData.glbPart) leaked = true;
});
if (leaked) throw new Error("?mock=1 equivalent still used the GLB");
disposeTree(forced.root);
globalThis.__ZOIDS_FORCE_MOCK = false;
console.log("force mock ok");

clearGlbTemplates();
const cold = buildUnitModel(ZOIDS.commandWolf, [], "player");
cold.root.traverse((obj) => {
  if (obj.userData && obj.userData.glbPart) throw new Error("unloaded GLB was not a mock");
});
disposeTree(cold.root);
console.log("glb models ok");
