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
};

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
  model.animate(0.4, 0.8, null);
  disposeTree(model.root);
  console.log("glb ok", slug, "dot", dot.toFixed(3), "parse+build", elapsed.toFixed(0), "ms");
}

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
