// Shield Liger skeletal clip: six named actions, damage-part names, mixer
// transitions, and the static / mock fallbacks.
//
//   node tests/shield_anim.test.mjs

import { readFileSync, statSync } from "node:fs";
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

const EXPECTED = {
  Idle: 48 / 24,
  Walk: 28 / 24,
  Run: 20 / 24,
  ShieldActivate: 18 / 24,
  ShieldMaintain: 48 / 24,
  Fire: 16 / 24,
};
const SHIELD_BONES = ["shieldChin", "shieldTop", "shieldLeft", "shieldRight"];

function fail(message) {
  throw new Error(message);
}

function parseGlb(loader, slug) {
  const buf = readFileSync(new URL(`../assets/models/${slug}.glb`, import.meta.url));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => {
    loader.parse(arrayBuffer, "", resolve, reject);
  });
}

function findBone(root, name) {
  let exact = null;
  let prefixed = null;
  root.traverse((obj) => {
    if (!obj.isBone) return;
    if (obj.name === name) exact = obj;
    else if (!prefixed && (obj.name.startsWith(`${name}_`) || obj.name.startsWith(`${name}.`))) prefixed = obj;
  });
  return exact || prefixed;
}

function trackBone(track) {
  const name = track.name || "";
  return name.split(".")[0];
}

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const animBytes = statSync(new URL("../assets/models/shield-liger-anim.glb", import.meta.url)).size;
const staticBytes = statSync(new URL("../assets/models/shield-liger.glb", import.meta.url)).size;
console.log("anim bytes", animBytes, "static bytes", staticBytes);
if (animBytes > 5 * 1024 * 1024) fail(`animated GLB is ${animBytes} bytes`);
if (staticBytes < 1000) fail("static shield-liger.glb is missing");

const gltf = await parseGlb(loader, "shield-liger-anim");
const clips = gltf.animations || [];
const byName = {};
for (const clip of clips) byName[clip.name] = clip;
for (const [name, duration] of Object.entries(EXPECTED)) {
  const clip = byName[name];
  if (!clip) fail(`missing clip ${name}; have ${clips.map((c) => c.name).join(",")}`);
  if (Math.abs(clip.duration - duration) > 0.2) {
    fail(`${name} duration ${clip.duration.toFixed(3)}s, expected ${duration.toFixed(3)}s`);
  }
  console.log("clip", name, "frames", Math.round(clip.duration * 24), "duration", clip.duration.toFixed(3), "tracks", clip.tracks.length);
}
for (const name of ["ShieldActivate", "ShieldMaintain"]) {
  const bones = new Set(byName[name].tracks.map(trackBone));
  for (const bone of SHIELD_BONES) {
    if (!bones.has(bone)) fail(`${name} does not drive ${bone}`);
  }
  for (const bone of bones) {
    if (!SHIELD_BONES.includes(bone)) fail(`${name} also drives ${bone}`);
  }
}
for (const name of ["Idle", "Walk", "Run"]) {
  const bones = byName[name].tracks.map(trackBone);
  if (bones.some((bone) => SHIELD_BONES.includes(bone))) {
    fail(`${name} still keys a shield plate`);
  }
  if (!bones.some((bone) => bone.includes("leftFrontLeg_paw") || bone.includes("leftFrontLeg_hip"))) {
    fail(`${name} does not move the left front leg`);
  }
}

let skinned = 0;
let tris = 0;
gltf.scene.traverse((obj) => {
  if (!obj.isSkinnedMesh) return;
  skinned += 1;
  const geo = obj.geometry;
  if (geo && geo.index) tris += geo.index.count / 3;
  else if (geo) tris += geo.attributes.position.count / 3;
});
console.log("skinned meshes", skinned, "tris", tris);
if (!skinned) fail("animated GLB has no skinned mesh");
if (tris < 50000 || tris > 85000) fail(`triangle count ${tris} is outside 60-80k`);

gltf.scene.updateMatrixWorld(true);
const bounds = new Box3().setFromObject(gltf.scene);
const size = bounds.getSize(new Vector3());
console.log("bounds", size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
if (!(size.z > 4.5 && size.z < 8 && size.y > 1 && size.y < 4 && size.z > size.x && size.z > size.y)) {
  fail(`animated bounds ${size.x.toFixed(2)} ${size.y.toFixed(2)} ${size.z.toFixed(2)} are not the normalized lion`);
}

clearGlbTemplates();
gltf.scene.userData.clips = gltf.animations;
gltf.scene.userData.skinned = true;
rememberGlbTemplate("shieldLiger", gltf.scene);
const model = buildUnitModel(ZOIDS.shieldLiger, [], "player");
if (model.anim.kind !== "skinned" || !model.anim.mixer) fail("build did not use the skinned mixer");
for (const partId of partListFor(ZOIDS.shieldLiger)) {
  if (!model.partMeshes[partId] || !model.partMeshes[partId].length) fail(`missing damage part ${partId}`);
}
let culled = 0;
model.root.traverse((obj) => {
  if (obj.isSkinnedMesh && obj.frustumCulled) culled += 1;
});
if (culled) fail(`${culled} skinned meshes still frustum cull`);
for (const mount of ["eye", "headWeapon", "leftWeapon", "rightWeapon", "backMount"]) {
  if (!model.anchors[mount]) fail(`missing anchor ${mount}`);
}
const eyeBone = model.anchors.eye.parent;
if (!eyeBone || !eyeBone.isBone) fail("eye anchor is not attached to a bone");

const paw = findBone(model.root, "leftFrontLeg_paw");
const chin = findBone(model.root, "shieldChin");
if (!paw || !chin) {
  const names = [];
  model.root.traverse((obj) => { if (obj.isBone) names.push(obj.name); });
  fail(`missing paw or shield bone; bones: ${names.join(",")}`);
}

let t = 0;
model.animate(t, 0, null);
if (model.anim.loco !== "Idle") fail(`expected Idle, got ${model.anim.loco}`);
model.root.updateMatrixWorld(true);
const paw0 = paw.getWorldPosition(new Vector3());
const chin0 = chin.quaternion.clone();

t += 1 / 24;
model.animate(t, 0.4, null);
if (model.anim.loco !== "Walk") fail(`speed 0.4 should walk, got ${model.anim.loco}`);
const walkScale = 0.55 + (0.4 / 0.8) * 0.9;
if (Math.abs(model.anim.actions.Walk.timeScale - walkScale) > 0.03) {
  fail(`walk timeScale ${model.anim.actions.Walk.timeScale}`);
}

t += 1 / 24;
model.animate(t, 0.95, null);
if (model.anim.loco !== "Run") fail(`speed 0.95 should run, got ${model.anim.loco}`);
const runScale = 0.85 + ((0.95 - 0.8) / 0.2) * 0.5;
if (Math.abs(model.anim.actions.Run.timeScale - runScale) > 0.03) {
  fail(`run timeScale ${model.anim.actions.Run.timeScale}`);
}
for (let i = 0; i < 14; i++) {
  t += 1 / 24;
  model.animate(t, 0.95, null);
}
model.root.updateMatrixWorld(true);
const pawMoved = paw0.distanceTo(paw.getWorldPosition(new Vector3()));
console.log("paw travel", pawMoved.toFixed(3));
if (pawMoved < 0.05) fail(`left front paw did not move (${pawMoved.toFixed(3)})`);

model.anim.shield = true;
let guard = 0;
while (model.anim.shieldPhase !== "maintain" && guard < 40) {
  t += 1 / 24;
  model.animate(t, 0, null);
  guard += 1;
}
if (model.anim.shieldPhase !== "maintain") fail(`shield stayed ${model.anim.shieldPhase}`);
model.root.updateMatrixWorld(true);
const chinAngle = chin0.angleTo(chin.quaternion);
console.log("shield chin rad", chinAngle.toFixed(3), "phase", model.anim.shieldPhase);
if (chinAngle < 0.7) fail(`shield chin only rotated ${chinAngle.toFixed(3)} rad`);

model.anim.firePulse = true;
t += 1 / 24;
model.animate(t, 0, null);
if (model.anim.actions.Fire.isRunning()) fail("Fire played while the shield was up");

model.anim.shield = false;
guard = 0;
while (model.anim.shieldPhase !== "off" && guard < 50) {
  t += 1 / 24;
  model.animate(t, 0, null);
  guard += 1;
}
if (model.anim.shieldPhase !== "off") fail(`shield did not retract (phase ${model.anim.shieldPhase})`);

model.anim.firePulse = true;
t += 1 / 24;
model.animate(t, 0, null);
if (!model.anim.actions.Fire.isRunning()) fail("Fire did not play");
console.log("mixer transitions ok");
disposeTree(model.root);

const staticGltf = await parseGlb(loader, "shield-liger");
if ((staticGltf.animations || []).length) fail("static shield-liger.glb should stay unanimated");
clearGlbTemplates();
rememberGlbTemplate("shieldLiger", staticGltf.scene);
const still = buildUnitModel(ZOIDS.shieldLiger, [], "player");
if (still.anim.kind !== "static") fail(`static template kind ${still.anim.kind}`);
if (still.anim.mixer) fail("static template created a mixer");
let staticMeshes = 0;
still.root.traverse((obj) => { if (obj.userData && obj.userData.glbPart) staticMeshes += 1; });
if (staticMeshes < partListFor(ZOIDS.shieldLiger).length) fail("static fallback built a mock");
disposeTree(still.root);

clearGlbTemplates();
rememberGlbTemplate("shieldLiger", null);
const mock = buildUnitModel(ZOIDS.shieldLiger, [], "player");
mock.root.traverse((obj) => {
  if (obj.userData && obj.userData.glbPart) fail("null template still used a GLB");
});
if (mock.anim.kind === "skinned") fail("mock was skinned");
if (!mock.partMeshes.head.length) fail("mock has no head");
disposeTree(mock.root);
console.log("shield anim ok");
