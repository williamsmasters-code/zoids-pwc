// Recognizable mock Zoids built from boxes, cylinders, and cones.
// Every Zoid faces local -Z. Left is -X. Feet rest on y = 0.
// Part meshes are named and tagged with userData.partId.

import {
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  Box3,
  Vector3,
  Color,
} from "three";
import { partListFor } from "./catalog.js";

// Real meshes for five Zoids. The others stay procedural.
// Files are normalized to the mock's unscaled size and face local -Z.
const GLB_SLUG = {
  commandWolf: "command-wolf",
  shieldLiger: "shield-liger",
  bladeLiger: "blade-liger",
  ironKong: "iron-kong",
  genoSaurer: "geno-saurer",
};

const glbTemplates = new Map();

export function forceMockModels() {
  if (globalThis.__ZOIDS_FORCE_MOCK) return true;
  try {
    if (typeof location !== "undefined" && /(?:^|[?&])mock=1(?:&|$)/.test(location.search || "")) return true;
  } catch {
    // Node has no location.
  }
  if (typeof window !== "undefined" && window.__ZOIDS__ && window.__ZOIDS__.forceMock) return true;
  return false;
}

export function rememberGlbTemplate(id, scene) {
  glbTemplates.set(id, scene || null);
}

export function clearGlbTemplates() {
  glbTemplates.clear();
}

export function glbSlugFor(id) {
  return GLB_SLUG[id] || null;
}

function modelUrl(slug) {
  return new URL(`../assets/models/${slug}.glb`, import.meta.url).href;
}

// Warm the cache before the hangar or a mission builds a unit. A failed file
// is stored as null so buildUnitModel falls back to the mock.
export async function preloadModels(onProgress) {
  const ids = Object.keys(GLB_SLUG);
  if (forceMockModels()) {
    for (const id of ids) glbTemplates.set(id, null);
    if (onProgress) onProgress(1, "");
    return;
  }
  const { GLTFLoader } = await import("../vendor/addons/loaders/GLTFLoader.js");
  const { MeshoptDecoder } = await import("../vendor/addons/libs/meshopt_decoder.module.js");
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    const slug = GLB_SLUG[id];
    try {
      const gltf = await loader.loadAsync(modelUrl(slug));
      glbTemplates.set(id, gltf.scene);
    } catch (err) {
      console.warn(`GLB fallback for ${slug}`, err);
      glbTemplates.set(id, null);
    }
    done += 1;
    if (onProgress) onProgress(done / ids.length, slug);
  }));
}

export function showLoading(text) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("load-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "load-overlay";
    el.innerHTML = `<div class="load-card"><b>Loading Zoids</b><span id="load-text"></span><i></i></div>`;
    document.body.appendChild(el);
  }
  el.classList.remove("hidden");
  const span = el.querySelector("#load-text");
  if (span) span.textContent = text || "Preparing the hangar…";
}

export function hideLoading() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("load-overlay");
  if (el) el.classList.add("hidden");
}

function mat(color, opts = {}) {
  return new MeshStandardMaterial({
    color,
    metalness: opts.metalness ?? 0.6,
    roughness: opts.roughness ?? 0.38,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissive ? (opts.emissiveIntensity ?? 0.9) : 0,
  });
}

function track(mesh, partId, store, color, emissive = 0, emissiveIntensity = 0) {
  mesh.userData.partId = partId;
  mesh.userData.baseColor = color;
  mesh.userData.baseEmissive = emissive;
  mesh.userData.baseEmissiveIntensity = emissiveIntensity;
  mesh.name = partId;
  mesh.castShadow = false;
  if (!store[partId]) store[partId] = [];
  store[partId].push(mesh);
  return mesh;
}

function addBox(parent, store, partId, w, h, d, x, y, z, color, opts = {}) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), mat(color, opts));
  mesh.position.set(x, y, z);
  if (opts.rot) mesh.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
  parent.add(mesh);
  return track(mesh, partId, store, color, opts.emissive || 0, opts.emissiveIntensity || 0);
}

function addConeForward(parent, store, partId, radius, length, x, y, z, color, opts = {}) {
  // ConeGeometry tip starts at +Y. rotateX(-90 deg) sends the tip to -Z (forward).
  const geo = new ConeGeometry(radius, length, opts.seg || 7);
  geo.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geo, mat(color, opts));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return track(mesh, partId, store, color, opts.emissive || 0, opts.emissiveIntensity || 0);
}

function addConeUp(parent, store, partId, radius, length, x, y, z, color, opts = {}) {
  const mesh = new Mesh(new ConeGeometry(radius, length, opts.seg || 6), mat(color, opts));
  mesh.position.set(x, y + length / 2, z);
  parent.add(mesh);
  return track(mesh, partId, store, color, opts.emissive || 0, opts.emissiveIntensity || 0);
}

function addBarrel(parent, store, partId, radius, length, x, y, zRear, color, opts = {}) {
  // Cylinder is along +Y. rotateX(+90 deg) sends +Y to +Z, so the rear end stays at zRear
  // and the muzzle reaches toward -Z.
  const geo = new CylinderGeometry(radius, opts.radius2 ?? radius, length, opts.seg || 8);
  geo.rotateX(Math.PI / 2);
  const mesh = new Mesh(geo, mat(color, opts));
  mesh.position.set(x, y, zRear - length / 2);
  parent.add(mesh);
  return track(mesh, partId, store, color, opts.emissive || 0, opts.emissiveIntensity || 0);
}

function addAnchor(parent, anchors, id, x, y, z) {
  const g = new Group();
  g.name = id;
  g.position.set(x, y, z);
  parent.add(g);
  anchors[id] = g;
  return g;
}

function addLeg(parent, store, anim, partId, x, y, z, spec, colors) {
  const g = new Group();
  g.name = partId;
  g.position.set(x, y, z);
  addBox(g, store, partId, spec.tw, spec.th, spec.td, 0, -spec.th / 2, 0, colors.primary);
  addBox(g, store, partId, spec.sw, spec.sh, spec.sd, 0, -spec.th - spec.sh / 2, spec.knee || 0, colors.secondary);
  addBox(
    g, store, partId,
    spec.fw, spec.fh, spec.fd,
    0,
    -spec.th - spec.sh - spec.fh / 2,
    (spec.knee || 0) - spec.fd * 0.12,
    colors.dark,
  );
  parent.add(g);
  anim.legs[partId] = g;
  return g;
}

function buildQuad(visual, def, store, anim, anchors) {
  const c = def.colors;
  const wolf = def.build === "wolf";
  const saber = def.build === "saber";
  const bodyL = wolf ? 3.7 : 4.15;
  const bodyW = wolf ? 1.05 : saber ? 1.4 : 1.5;
  const bodyH = wolf ? 0.82 : 1.02;
  const thigh = wolf ? 0.78 : 0.88;
  const shin = wolf ? 0.72 : 0.8;
  const foot = wolf ? 0.2 : 0.24;
  const hipY = thigh + shin + foot;
  const leg = {
    tw: wolf ? 0.28 : 0.38,
    th: thigh,
    td: wolf ? 0.32 : 0.42,
    sw: wolf ? 0.22 : 0.3,
    sh: shin,
    sd: 0.32,
    knee: wolf ? 0.08 : 0.1,
    fw: wolf ? 0.34 : 0.46,
    fh: foot,
    fd: wolf ? 0.72 : 0.9,
  };
  const fz = wolf ? -1.05 : -1.2;
  const rz = wolf ? 1.0 : 1.15;
  const lx = wolf ? 0.58 : 0.72;
  addLeg(visual, store, anim, "leftFrontLeg", -lx, hipY, fz, leg, c);
  addLeg(visual, store, anim, "rightFrontLeg", lx, hipY, fz, leg, c);
  addLeg(visual, store, anim, "leftRearLeg", -lx * 0.92, hipY, rz, leg, c);
  addLeg(visual, store, anim, "rightRearLeg", lx * 0.92, hipY, rz, leg, c);

  const torso = new Group();
  visual.add(torso);
  anim.torso = torso;
  addBox(torso, store, "core", bodyW, bodyH, bodyL * 0.58, 0, hipY + 0.22, -0.05, c.primary);
  addBox(torso, store, "core", bodyW * 0.9, bodyH * 0.78, 0.72, 0, hipY + 0.08, -bodyL * 0.26, c.secondary);
  addBox(torso, store, "core", bodyW * 0.92, bodyH * 0.7, 0.75, 0, hipY + 0.12, bodyL * 0.24, c.dark);
  addBox(torso, store, "core", 0.22, 0.38, 0.85, -bodyW * 0.55, hipY + 0.42, -0.15, c.plate);
  addBox(torso, store, "core", 0.22, 0.38, 0.85, bodyW * 0.55, hipY + 0.42, -0.15, c.plate);

  const headZ = -bodyL * 0.5;
  const headY = hipY + (wolf ? 0.48 : 0.62);
  addBox(torso, store, "head", 0.4, 0.38, 0.42, 0, headY - 0.02, headZ + 0.42, c.secondary);
  addBox(torso, store, "head", wolf ? 0.58 : 0.78, wolf ? 0.5 : 0.62, wolf ? 0.95 : 0.82, 0, headY, headZ, c.primary);
  addBox(torso, store, "head", wolf ? 0.34 : 0.46, 0.26, wolf ? 0.72 : 0.52, 0, headY - 0.1, headZ - 0.62, c.secondary);
  const eyeOpts = { emissive: c.eye, emissiveIntensity: 1.3, metalness: 0.15, roughness: 0.25 };
  addBox(torso, store, "head", 0.1, 0.1, 0.08, -0.18, headY + 0.08, headZ - 0.28, c.eye, eyeOpts);
  addBox(torso, store, "head", 0.1, 0.1, 0.08, 0.18, headY + 0.08, headZ - 0.28, c.eye, eyeOpts);

  const tail = new Group();
  tail.position.set(0, hipY + 0.25, bodyL * 0.3);
  torso.add(tail);
  anim.tail = tail;
  addBox(tail, store, "tail", 0.28, 0.26, 0.7, 0, 0, 0.35, c.secondary);
  addBox(tail, store, "tail", 0.2, 0.18, 0.6, 0, 0.04, 0.95, c.dark);
  addBox(tail, store, "tail", 0.14, 0.14, 0.4, 0, 0.08, 1.4, c.primary);

  addBox(torso, store, "headWeapon", 0.22, 0.14, 0.24, 0, headY - 0.24, headZ - 0.85, c.dark);
  addBox(torso, store, "leftWeapon", 0.24, 0.22, 0.36, -bodyW * 0.62, hipY + 0.28, -0.2, c.dark);
  addBox(torso, store, "rightWeapon", 0.24, 0.22, 0.36, bodyW * 0.62, hipY + 0.28, -0.2, c.dark);
  addBox(torso, store, "backMount", 0.72, 0.16, 0.7, 0, hipY + bodyH * 0.55 + 0.18, 0.2, c.secondary);

  addAnchor(torso, anchors, "headWeapon", 0, headY - 0.22, headZ - 1.0);
  addAnchor(torso, anchors, "leftWeapon", -bodyW * 0.78, hipY + 0.32, -0.25);
  addAnchor(torso, anchors, "rightWeapon", bodyW * 0.78, hipY + 0.32, -0.25);
  addAnchor(torso, anchors, "backMount", 0, hipY + bodyH * 0.55 + 0.32, 0.05);

  const eye = new Group();
  eye.name = "eye";
  eye.position.set(0, headY + 0.02, headZ + 0.08);
  torso.add(eye);
  anchors.eye = eye;

  if (def.build === "lion") {
    addBox(torso, store, "head", 1.2, 0.72, 0.28, 0, headY + 0.02, headZ + 0.2, c.secondary);
    addBox(visual, store, "leftFrontLeg", 0.14, 1.5, 1.3, -bodyW * 0.95, hipY + 0.25, -0.45, c.plate, { metalness: 0.75, roughness: 0.22 });
    addBox(visual, store, "leftFrontLeg", 0.06, 1.15, 0.95, -bodyW * 1.05, hipY + 0.25, -0.45, c.accent);
  } else if (def.build === "blade") {
    const bladeOpts = { metalness: 0.82, roughness: 0.18 };
    addBox(torso, store, "leftWeapon", 0.08, 0.62, 2.6, -bodyW * 1.02, hipY + 0.55, -0.4, c.accent, { ...bladeOpts, rot: [0, 0.06, 0.18] });
    addBox(torso, store, "rightWeapon", 0.08, 0.62, 2.6, bodyW * 1.02, hipY + 0.55, -0.4, c.accent, { ...bladeOpts, rot: [0, -0.06, -0.18] });
  } else if (def.build === "saber") {
    addConeForward(torso, store, "head", 0.07, 0.95, -0.12, headY - 0.28, headZ - 0.55, c.accent, { metalness: 0.8, roughness: 0.2 });
    addConeForward(torso, store, "head", 0.07, 0.95, 0.12, headY - 0.28, headZ - 0.55, c.accent, { metalness: 0.8, roughness: 0.2 });
    addBox(torso, store, "core", bodyW + 0.04, 0.08, 0.16, 0, hipY + 0.55, -0.45, c.dark);
    addBox(torso, store, "core", bodyW + 0.04, 0.08, 0.16, 0, hipY + 0.55, 0.2, c.dark);
    addConeUp(torso, store, "head", 0.1, 0.28, -0.22, headY + 0.28, headZ + 0.05, c.dark);
    addConeUp(torso, store, "head", 0.1, 0.28, 0.22, headY + 0.28, headZ + 0.05, c.dark);
  } else if (def.build === "wolf") {
    addConeUp(torso, store, "head", 0.11, 0.55, -0.16, headY + 0.28, headZ + 0.1, c.dark);
    addConeUp(torso, store, "head", 0.11, 0.55, 0.16, headY + 0.28, headZ + 0.1, c.dark);
    const dish = new Mesh(
      new TorusGeometry(0.32, 0.045, 8, 16),
      mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.55, metalness: 0.4 }),
    );
    dish.position.set(0, hipY + 1.05, 0.45);
    dish.rotation.x = 0.9;
    torso.add(dish);
    track(dish, "backMount", store, c.accent, c.accent, 0.55);
    addBox(torso, store, "backMount", 0.08, 0.35, 0.08, 0, hipY + 0.78, 0.45, c.dark);
  }
}

function buildBipedLegs(visual, store, anim, colors, hipY, legX, thigh, shin, foot) {
  const leg = {
    tw: thigh[0], th: thigh[1], td: thigh[2],
    sw: shin[0], sh: shin[1], sd: shin[2], knee: 0.12,
    fw: foot[0], fh: foot[1], fd: foot[2],
  };
  addLeg(visual, store, anim, "leftLeg", -legX, hipY, 0.15, leg, colors);
  addLeg(visual, store, anim, "rightLeg", legX, hipY, 0.15, leg, colors);
}

function buildTheropod(visual, def, store, anim, anchors) {
  const c = def.colors;
  const kind = def.build;
  const heavy = kind === "tyrant";
  const death = kind === "death";
  const thigh = death ? [0.9, 1.5, 0.9] : heavy ? [0.72, 1.35, 0.72] : [0.42, 1.2, 0.48];
  const shin = death ? [0.72, 1.25, 0.7] : heavy ? [0.55, 1.15, 0.55] : [0.32, 1.05, 0.34];
  const foot = death ? [1.1, 0.32, 1.45] : heavy ? [0.85, 0.28, 1.15] : [0.5, 0.22, 0.95];
  const hipY = thigh[1] + shin[1] + foot[1];
  const legX = death ? 1.15 : heavy ? 0.9 : 0.52;
  buildBipedLegs(visual, store, anim, c, hipY, legX, thigh, shin, foot);

  const torso = new Group();
  visual.add(torso);
  anim.torso = torso;
  const bw = death ? 2.8 : heavy ? 2.2 : 1.25;
  const bh = death ? 1.9 : heavy ? 1.6 : 1.1;
  const bd = death ? 3.2 : heavy ? 2.6 : 2.45;
  const bodyY = hipY + bh * 0.35;
  addBox(torso, store, "core", bw, bh, bd, 0, bodyY, 0.05, c.primary);
  addBox(torso, store, "core", bw * 0.78, bh * 0.55, 0.5, 0, bodyY + bh * 0.15, -bd * 0.32, c.secondary);
  addBox(torso, store, "core", bw * 1.04, 0.22, bd * 0.7, 0, bodyY + bh * 0.45, 0.1, c.plate);
  if (death) {
    addBox(torso, store, "core", 0.35, 0.8, 0.8, -bw * 0.48, bodyY + 0.2, -0.2, c.plate);
    addBox(torso, store, "core", 0.35, 0.8, 0.8, bw * 0.48, bodyY + 0.2, -0.2, c.plate);
    addConeUp(torso, store, "core", 0.16, 0.7, -0.8, bodyY + bh * 0.4, -0.4, c.accent);
    addConeUp(torso, store, "core", 0.16, 0.7, 0.8, bodyY + bh * 0.4, -0.4, c.accent);
    addConeUp(torso, store, "core", 0.18, 0.85, 0, bodyY + bh * 0.45, 0.6, c.accent);
  }

  const headY = bodyY + bh * 0.55;
  const headZ = death ? -bd * 0.62 : heavy ? -bd * 0.58 : -bd * 0.62;
  const hw = death ? 1.25 : heavy ? 1.0 : 0.68;
  const hh = death ? 0.95 : heavy ? 0.8 : 0.52;
  const hd = death ? 1.55 : heavy ? 1.3 : 1.1;
  addBox(torso, store, "head", hw * 0.7, hh * 0.7, 0.55, 0, headY - 0.1, headZ + 0.55, c.secondary);
  addBox(torso, store, "head", hw, hh, hd, 0, headY, headZ, c.primary);
  addBox(torso, store, "head", hw * 0.62, hh * 0.4, hd * 0.55, 0, headY - hh * 0.2, headZ - hd * 0.55, c.secondary);
  const eyeOpts = { emissive: c.eye, emissiveIntensity: 1.4, metalness: 0.1 };
  addBox(torso, store, "head", 0.12, 0.12, 0.08, -hw * 0.28, headY + hh * 0.15, headZ - hd * 0.35, c.eye, eyeOpts);
  addBox(torso, store, "head", 0.12, 0.12, 0.08, hw * 0.28, headY + hh * 0.15, headZ - hd * 0.35, c.eye, eyeOpts);
  if (kind === "raptor") {
    addConeForward(torso, store, "head", 0.08, 0.55, -0.2, headY + hh * 0.45, headZ - 0.1, c.accent);
    addConeForward(torso, store, "head", 0.08, 0.55, 0.2, headY + hh * 0.45, headZ - 0.1, c.accent);
  }
  if (death) {
    addConeUp(torso, store, "head", 0.12, 0.55, -0.35, headY + hh * 0.4, headZ + 0.1, c.accent);
    addConeUp(torso, store, "head", 0.12, 0.55, 0.35, headY + hh * 0.4, headZ + 0.1, c.accent);
    addConeUp(torso, store, "head", 0.14, 0.7, 0, headY + hh * 0.45, headZ + 0.2, c.accent);
  }

  const tail = new Group();
  tail.position.set(0, bodyY - 0.1, bd * 0.4);
  torso.add(tail);
  anim.tail = tail;
  const tailLen = death ? 1.3 : heavy ? 1.05 : 0.9;
  addBox(tail, store, "tail", death ? 0.7 : 0.4, death ? 0.55 : 0.32, tailLen, 0, 0, tailLen * 0.5, c.secondary);
  addBox(tail, store, "tail", death ? 0.45 : 0.28, death ? 0.36 : 0.22, tailLen, 0, 0.08, tailLen * 1.4, c.dark);
  addBox(tail, store, "tail", death ? 0.28 : 0.18, death ? 0.22 : 0.16, tailLen * 0.8, 0, 0.14, tailLen * 2.15, c.primary);

  const armLen = death ? 0.7 : heavy ? 0.9 : 0.65;
  const armY = bodyY + 0.1;
  const armZ = -bd * 0.28;
  const armX = bw * 0.55;
  for (const side of [-1, 1]) {
    const id = side < 0 ? "leftWeapon" : "rightWeapon";
    const g = new Group();
    g.position.set(side * armX, armY, armZ);
    torso.add(g);
    anim.legs[id] = g;
    addBox(g, store, id, heavy ? 0.38 : 0.22, armLen, heavy ? 0.38 : 0.22, 0, -armLen / 2, 0, c.secondary);
    if (heavy) {
      addBarrel(g, store, id, 0.16, 1.1, 0, -armLen * 0.2, -0.2, c.dark);
    } else {
      addBox(g, store, id, 0.2, 0.2, 0.45, 0, -armLen, -0.2, c.dark);
    }
    addAnchor(torso, anchors, id, side * (armX + 0.1), armY - 0.2, armZ - 0.4);
  }

  addBox(torso, store, "headWeapon", death ? 0.5 : 0.28, 0.2, 0.35, 0, headY - hh * 0.35, headZ - hd * 0.65, c.dark);
  addAnchor(torso, anchors, "headWeapon", 0, headY - hh * 0.35, headZ - hd * 0.9);
  const backY = bodyY + bh * 0.55;
  addBox(torso, store, "backMount", bw * 0.55, 0.2, bd * 0.35, 0, backY, 0.15, c.dark);
  addAnchor(torso, anchors, "backMount", 0, backY + 0.2, -0.2);

  const eye = new Group();
  eye.name = "eye";
  eye.position.set(0, headY + 0.05, headZ + 0.1);
  torso.add(eye);
  anchors.eye = eye;
  anim.kind = "biped";
}

function buildGorilla(visual, def, store, anim, anchors) {
  const c = def.colors;
  const thigh = [0.55, 0.78, 0.55];
  const shin = [0.48, 0.7, 0.48];
  const foot = [0.7, 0.26, 0.9];
  const hipY = thigh[1] + shin[1] + foot[1];
  buildBipedLegs(visual, store, anim, c, hipY, 0.62, thigh, shin, foot);

  const torso = new Group();
  visual.add(torso);
  anim.torso = torso;
  const bodyY = hipY + 1.35;
  addBox(torso, store, "core", 2.5, 1.85, 1.45, 0, bodyY, 0.05, c.primary);
  addBox(torso, store, "core", 2.15, 1.2, 0.28, 0, bodyY + 0.1, -0.72, c.secondary);
  addBox(torso, store, "core", 0.7, 0.45, 0.4, -0.7, bodyY + 0.85, -0.15, c.plate);
  addBox(torso, store, "core", 0.7, 0.45, 0.4, 0.7, bodyY + 0.85, -0.15, c.plate);
  addBox(torso, store, "head", 0.9, 0.7, 0.85, 0, bodyY + 1.35, -0.72, c.primary);
  addBox(torso, store, "head", 0.95, 0.28, 0.35, 0, bodyY + 1.55, -0.95, c.dark);
  const eyeOpts = { emissive: c.eye, emissiveIntensity: 1.2, metalness: 0.1 };
  addBox(torso, store, "head", 0.12, 0.1, 0.08, -0.22, bodyY + 1.4, -1.08, c.eye, eyeOpts);
  addBox(torso, store, "head", 0.12, 0.1, 0.08, 0.22, bodyY + 1.4, -1.08, c.eye, eyeOpts);
  addBox(torso, store, "headWeapon", 0.4, 0.16, 0.2, 0, bodyY + 1.15, -1.15, c.dark);

  for (const side of [-1, 1]) {
    const id = side < 0 ? "leftWeapon" : "rightWeapon";
    const g = new Group();
    g.position.set(side * 1.45, bodyY + 0.7, -0.15);
    torso.add(g);
    anim.legs[id] = g;
    addBox(g, store, id, 0.48, 1.15, 0.48, 0, -0.55, 0, c.primary);
    addBox(g, store, id, 0.42, 1.05, 0.42, 0, -1.55, -0.05, c.secondary);
    addBox(g, store, id, 0.5, 0.38, 0.55, 0, -2.15, -0.1, c.dark);
    addAnchor(torso, anchors, id, side * 1.55, bodyY + 0.15, -0.45);
  }

  const tail = new Group();
  tail.position.set(0, bodyY - 0.3, 0.75);
  torso.add(tail);
  anim.tail = tail;
  addBox(tail, store, "tail", 0.4, 0.32, 0.55, 0, 0, 0.2, c.dark);

  addBox(torso, store, "backMount", 1.4, 0.28, 0.7, 0, bodyY + 1.05, 0.35, c.secondary);
  addAnchor(torso, anchors, "backMount", 0, bodyY + 1.25, 0.2);
  addAnchor(torso, anchors, "headWeapon", 0, bodyY + 1.15, -1.3);
  const eye = new Group();
  eye.name = "eye";
  eye.position.set(0, bodyY + 1.42, -0.85);
  torso.add(eye);
  anchors.eye = eye;
  anim.kind = "gorilla";
}

function buildStructure(visual, def, store, anim, anchors) {
  const c = def.colors;
  if (def.build === "turret") {
    const base = new Mesh(new CylinderGeometry(1.25, 1.45, 1.4, 10), mat(c.primary));
    base.position.set(0, 0.7, 0.35);
    visual.add(base);
    track(base, "core", store, c.primary);
    addBox(visual, store, "core", 1.6, 0.25, 1.6, 0, 1.45, 0.45, c.dark);
    addBox(visual, store, "head", 0.8, 0.55, 0.8, 0, 1.95, -0.35, c.secondary);
    addBox(visual, store, "head", 0.2, 0.2, 0.2, 0, 2.3, -0.45, c.eye, { emissive: c.eye, emissiveIntensity: 1 });
    addBarrel(visual, store, "headWeapon", 0.16, 1.5, 0, 1.95, 0.05, c.dark);
    addAnchor(visual, anchors, "headWeapon", 0, 1.95, -1.45);
    const eye = new Group();
    eye.position.set(0, 2.05, 0.05);
    visual.add(eye);
    anchors.eye = eye;
    anim.kind = "structure";
    return;
  }
  if (def.build === "generator") {
    addBox(visual, store, "core", 4.2, 2.2, 3.2, 0, 1.3, 0, c.primary);
    addBox(visual, store, "core", 1.2, 1.4, 1.2, -1.3, 1.2, 0.2, c.dark);
    addBox(visual, store, "core", 1.2, 1.4, 1.2, 1.3, 1.2, 0.2, c.dark);
    const core = new Mesh(
      new CylinderGeometry(0.55, 0.55, 1.6, 10),
      mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.8 }),
    );
    core.position.set(0, 2.4, 0);
    visual.add(core);
    track(core, "core", store, c.accent, c.accent, 0.8);
    const dish = new Mesh(new TorusGeometry(0.7, 0.08, 8, 16), mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.5 }));
    dish.position.set(0, 3.15, -1.15);
    dish.rotation.x = Math.PI / 2.4;
    visual.add(dish);
    track(dish, "head", store, c.accent, c.accent, 0.5);
    addBox(visual, store, "head", 0.2, 0.45, 0.7, 0, 2.7, -0.7, c.dark);
    const eye = new Group();
    eye.position.set(0, 3.05, -0.9);
    visual.add(eye);
    anchors.eye = eye;
    anim.kind = "structure";
    return;
  }
  // Supply truck. Cab is the head and sits at -Z.
  addBox(visual, store, "core", 1.8, 1.35, 2.6, 0, 1.15, 0.55, c.primary);
  addBox(visual, store, "head", 1.6, 1.25, 1.3, 0, 1.15, -1.35, c.secondary);
  addBox(visual, store, "head", 1.2, 0.55, 0.08, 0, 1.3, -1.95, c.eye, { emissive: c.eye, emissiveIntensity: 0.4 });
  for (const side of [-1, 1]) {
    for (const wz of [-1.5, 0.2, 1.3]) {
      const wheel = new Mesh(new CylinderGeometry(0.38, 0.38, 0.28, 10), mat(c.dark));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.95, 0.38, wz);
      visual.add(wheel);
      track(wheel, "core", store, c.dark);
    }
  }
  const eye = new Group();
  eye.position.set(0, 1.45, -1.5);
  visual.add(eye);
  anchors.eye = eye;
  anim.kind = "vehicle";
}

function emptyAnim() {
  return { legs: {}, tail: null, torso: null, kind: "quad" };
}

function centerOf(meshes) {
  const box = new Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box.getCenter(new Vector3());
}

function assertModel(root, def, store) {
  root.updateMatrixWorld(true);
  for (const id of partListFor(def)) {
    if (!store[id] || store[id].length === 0) {
      throw new Error(`${def.id} is missing a mesh for ${id}`);
    }
  }
  const head = centerOf(store.head);
  const core = centerOf(store.core);
  const headL = root.worldToLocal(head.clone());
  const coreL = root.worldToLocal(core.clone());
  if (headL.z >= coreL.z - 0.05) {
    throw new Error(`${def.id} head is not in front of the core (head z ${headL.z.toFixed(2)}, core z ${coreL.z.toFixed(2)})`);
  }
  if (def.layout === "quad") {
    const lf = root.worldToLocal(centerOf(store.leftFrontLeg).clone());
    const rf = root.worldToLocal(centerOf(store.rightFrontLeg).clone());
    const lr = root.worldToLocal(centerOf(store.leftRearLeg).clone());
    if (lf.x >= rf.x) throw new Error(`${def.id} left and right front legs are swapped`);
    if (lf.z >= lr.z) throw new Error(`${def.id} front leg is not ahead of the rear leg`);
  }
  if (def.layout === "biped") {
    const l = root.worldToLocal(centerOf(store.leftLeg).clone());
    const r = root.worldToLocal(centerOf(store.rightLeg).clone());
    if (l.x >= r.x) throw new Error(`${def.id} left and right legs are swapped`);
  }
}

function makeWeaponVisual(type) {
  const g = new Group();
  const housing = 0x2a3038;
  const dark = 0x14181d;
  if (type === "pulseLaser") {
    addBarrel(g, {}, null, 0.05, 0.7, -0.08, 0, 0, 0x9fffe8, { emissive: 0x66ffcc, emissiveIntensity: 0.6 });
    addBarrel(g, {}, null, 0.05, 0.7, 0.08, 0, 0, 0x9fffe8, { emissive: 0x66ffcc, emissiveIntensity: 0.6 });
    addBox(g, {}, null, 0.28, 0.16, 0.3, 0, 0, -0.05, housing);
  } else if (type === "beamCannon") {
    addBarrel(g, {}, null, 0.1, 1.15, 0, 0, 0, 0x3aa0ff, { emissive: 0x1a66cc, emissiveIntensity: 0.45 });
    addBox(g, {}, null, 0.28, 0.22, 0.35, 0, 0, -0.05, housing);
  } else if (type === "missilePack") {
    addBox(g, {}, null, 0.46, 0.32, 0.7, 0, 0, -0.2, dark);
    for (const xo of [-0.14, 0.14]) {
      for (const yo of [-0.08, 0.08]) {
        addBarrel(g, {}, null, 0.05, 0.62, xo, yo, -0.05, 0xd8d2c4);
      }
    }
  } else if (type === "gatling") {
    addBox(g, {}, null, 0.32, 0.32, 0.4, 0, 0, -0.05, housing);
    const spin = new Group();
    g.add(spin);
    g.userData.spin = spin;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addBarrel(spin, {}, null, 0.035, 0.85, Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0, 0xc8c2b4);
    }
  } else if (type === "shockCannon") {
    addBarrel(g, {}, null, 0.16, 1.05, 0, 0, 0, 0x4a4038, { radius2: 0.2 });
    addBox(g, {}, null, 0.4, 0.32, 0.4, 0, 0, -0.05, housing);
  } else if (type === "chargedParticle") {
    addBarrel(g, {}, null, 0.22, 1.8, 0, 0.05, 0.2, 0x6a3c86, { emissive: 0x7a2ea8, emissiveIntensity: 0.45, radius2: 0.28 });
    addBox(g, {}, null, 0.55, 0.4, 0.4, 0, 0.05, 0.05, dark);
    const ring = new Mesh(new TorusGeometry(0.3, 0.04, 6, 12), mat(0xd56bff, { emissive: 0xd56bff, emissiveIntensity: 0.8 }));
    ring.position.set(0, 0.05, -0.7);
    g.add(ring);
  } else {
    addBox(g, {}, null, 0.2, 0.2, 0.4, 0, 0, -0.2, housing);
  }
  // addBarrel/addBox with a null part id still called track(). Guard that.
  const muzzle = new Group();
  muzzle.name = "muzzle";
  let reach = 0.8;
  if (type === "beamCannon" || type === "shockCannon") reach = 1.15;
  if (type === "chargedParticle") reach = 1.7;
  if (type === "missilePack") reach = 0.75;
  muzzle.position.set(0, 0, -reach);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.traverse((obj) => {
    if (obj.isMesh) obj.userData.partId = obj.userData.partId || undefined;
  });
  return g;
}

// addBox/addBarrel with store {} and partId null still pushes under key "null".
// That is harmless. Strip userData.partId so shots do not credit a fake part
// until attachWeapons stamps the real mount.
function stripLoosePartIds(root) {
  root.traverse((obj) => {
    if (obj.userData && (obj.userData.partId == null || obj.userData.partId === "null")) {
      delete obj.userData.partId;
    }
  });
}

export function attachWeapons(model, weapons) {
  for (const anchor of Object.values(model.anchors)) {
    if (anchor.name === "eye") continue;
    for (const child of [...anchor.children]) {
      anchor.remove(child);
      disposeTree(child);
    }
  }
  model.muzzles = {};
  for (const weapon of weapons || []) {
    const anchor = model.anchors[weapon.mount];
    if (!anchor) continue;
    const visual = makeWeaponVisual(weapon.type);
    stripLoosePartIds(visual);
    visual.traverse((obj) => {
      if (obj.isMesh) obj.userData.partId = weapon.mount;
    });
    visual.userData.mount = weapon.mount;
    anchor.add(visual);
    model.muzzles[weapon.mount] = visual.userData.muzzle;
  }
}

export function tagOwner(root, ownerId) {
  root.traverse((obj) => {
    if (obj.userData && obj.userData.partId) obj.userData.ownerId = ownerId;
  });
}

function damagedTint(hex) {
  return new Color(hex);
}

function parkDestroyedGlb(mesh, destroyed) {
  if (!mesh.userData.glbPart) return;
  if (destroyed) {
    if (!mesh.userData.parked) {
      mesh.userData.parked = {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        rx: mesh.rotation.x,
        ry: mesh.rotation.y,
        rz: mesh.rotation.z,
      };
      mesh.position.y -= 0.22;
      mesh.rotation.x += 0.45;
    }
    return;
  }
  if (!mesh.userData.parked) return;
  const parked = mesh.userData.parked;
  mesh.position.set(parked.x, parked.y, parked.z);
  mesh.rotation.set(parked.rx, parked.ry, parked.rz);
  delete mesh.userData.parked;
}

export function refreshPartColors(model, parts) {
  for (const [id, meshes] of Object.entries(model.partMeshes)) {
    const part = parts[id];
    if (!part) continue;
    const ratio = (part.armor + part.structure) / Math.max(1, part.maxArmor + part.maxStructure);
    const destroyed = part.destroyed || part.structure <= 0;
    for (const mesh of meshes) {
      parkDestroyedGlb(mesh, destroyed);
      const material = mesh.material;
      if (!material || !material.color) continue;
      if (destroyed) {
        material.color.setHex(0x2c2626);
        if (material.emissive) {
          material.emissive.setHex(0x000000);
          material.emissiveIntensity = 0;
        }
      } else if (ratio < 0.45) {
        material.color.setHex(mesh.userData.baseColor);
        material.color.lerp(damagedTint(0x6a221c), 0.5);
        if (material.emissive) {
          material.emissive.setHex(0x3a0000);
          material.emissiveIntensity = (0.45 - ratio) * 1.4;
        }
      } else {
        material.color.setHex(mesh.userData.baseColor);
        if (material.emissive) {
          material.emissive.setHex(mesh.userData.baseEmissive || 0x000000);
          material.emissiveIntensity = mesh.userData.baseEmissiveIntensity || 0;
        }
      }
    }
  }
  for (const [mount, anchor] of Object.entries(model.anchors)) {
    if (!parts[mount]) continue;
    anchor.visible = !parts[mount].destroyed;
  }
  if (model.anchors.eye) model.anchors.eye.visible = true;
}

function animateModel(model, time, speedNorm, parts) {
  const anim = model.anim;
  const moving = Math.min(1, Math.max(0, speedNorm));
  const phase = time * (6.5 + moving * 3);
  const amp = moving * (anim.kind === "gorilla" ? 0.35 : 0.5);
  const swing = (id, phaseOffset, side) => {
    const group = anim.legs[id];
    if (!group) return;
    const part = parts && parts[id];
    if (part && part.destroyed) {
      group.rotation.x = 1.05;
      group.rotation.z = side * 0.4;
      return;
    }
    group.rotation.z = 0;
    group.rotation.x = Math.sin(phase + phaseOffset) * amp;
  };
  if (anim.kind === "quad") {
    swing("leftFrontLeg", 0, -1);
    swing("rightRearLeg", 0, 1);
    swing("rightFrontLeg", Math.PI, 1);
    swing("leftRearLeg", Math.PI, -1);
  } else if (anim.kind === "biped" || anim.kind === "gorilla") {
    swing("leftLeg", 0, -1);
    swing("rightLeg", Math.PI, 1);
    swing("leftWeapon", Math.PI, -1);
    swing("rightWeapon", 0, 1);
  }
  if (anim.tail) anim.tail.rotation.y = Math.sin(time * 2.2) * 0.2;
  if (anim.torso) {
    anim.torso.position.y = Math.abs(Math.sin(phase)) * 0.045 * moving;
  }
  model.root.traverse((obj) => {
    if (obj.userData && obj.userData.spin) {
      obj.userData.spin.rotation.z += 0.4 + moving;
    }
  });
}

function unionBox(meshes) {
  const box = new Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box;
}

function buildGlb(visual, def, store, anim, anchors, template) {
  const savedScale = visual.scale.x;
  visual.scale.setScalar(1);
  const clone = template.clone(true);
  visual.add(clone);
  clone.traverse((obj) => {
    if (!obj.isMesh) return;
    const partId = partIdFromObject(def, obj);
    obj.geometry = obj.geometry.clone();
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const cloned = list.map((material) => (material && material.clone ? material.clone() : material));
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
    const material = cloned[0];
    const color = material && material.color ? material.color.getHex() : 0x888888;
    const emissive = material && material.emissive ? material.emissive.getHex() : 0;
    track(obj, partId, store, color, emissive, material ? material.emissiveIntensity || 0 : 0);
    obj.userData.glbPart = true;
  });
  visual.updateMatrixWorld(true);
  placeGlbAnchors(visual, store, anchors);
  visual.scale.setScalar(savedScale || def.scale || 1);
  anim.kind = "static";
}

function storeAllowed(def, name) {
  return !!name && partListFor(def).includes(name);
}

// GLTFLoader renames duplicate nodes to "head_1", "head_2", and so on.
function partIdFromObject(def, obj) {
  const hinted = obj.userData && obj.userData.partId;
  if (storeAllowed(def, hinted)) return hinted;
  const raw = String(obj.name || "");
  const base = raw.replace(/_\d+$/, "");
  if (storeAllowed(def, base)) return base;
  if (storeAllowed(def, raw)) return raw;
  return "core";
}

function placeGlbAnchors(visual, store, anchors) {
  const place = (id, pick) => {
    if (!store[id] || !store[id].length) return;
    const box = unionBox(store[id]);
    const center = box.getCenter(new Vector3());
    const point = pick(box, center);
    addAnchor(visual, anchors, id, point.x, point.y, point.z);
  };
  place("headWeapon", (box, center) => new Vector3(center.x, center.y, box.min.z));
  place("leftWeapon", (box, center) => new Vector3(box.min.x, center.y, Math.min(center.z, box.min.z + (box.max.z - box.min.z) * 0.35)));
  place("rightWeapon", (box, center) => new Vector3(box.max.x, center.y, Math.min(center.z, box.min.z + (box.max.z - box.min.z) * 0.35)));
  place("backMount", (box, center) => new Vector3(center.x, box.max.y, center.z));
  if (store.head && store.head.length) {
    const head = unionBox(store.head);
    const size = head.getSize(new Vector3());
    const eye = new Group();
    eye.name = "eye";
    eye.position.set(
      (head.min.x + head.max.x) / 2,
      head.max.y - size.y * 0.28,
      head.min.z + Math.max(0.05, size.z * 0.22),
    );
    visual.add(eye);
    anchors.eye = eye;
  }
}

export function buildUnitModel(def, weapons, team = "player") {
  const root = new Group();
  root.name = def.id;
  const visual = new Group();
  visual.scale.setScalar(def.scale || 1);
  root.add(visual);
  const store = {};
  const anim = emptyAnim();
  const anchors = {};
  const glb = !forceMockModels() && glbTemplates.get(def.id);
  if (glb) {
    buildGlb(visual, def, store, anim, anchors, glb);
  } else if (def.build === "wolf" || def.build === "lion" || def.build === "saber" || def.build === "blade") {
    anim.kind = "quad";
    buildQuad(visual, def, store, anim, anchors);
  } else if (def.build === "gorilla") {
    buildGorilla(visual, def, store, anim, anchors);
  } else if (def.build === "raptor" || def.build === "tyrant" || def.build === "death") {
    buildTheropod(visual, def, store, anim, anchors);
  } else {
    buildStructure(visual, def, store, anim, anchors);
  }
  if (team === "enemy" && store.core) {
    const iff = addBox(visual, store, "core", 0.12, 0.35, 0.12, 0, (def.radius || 2) * 1.1, 0.2, 0xff3344, {
      emissive: 0xff2200,
      emissiveIntensity: 1,
    });
    iff.name = "iff";
  }
  const model = { root, visual, partMeshes: store, anim, anchors, muzzles: {}, def };
  assertModel(root, def, store);
  attachWeapons(model, weapons || []);
  model.animate = (time, speedNorm, parts) => animateModel(model, time, speedNorm, parts);
  return model;
}

export function disposeTree(obj) {
  if (!obj) return;
  const geos = new Set();
  const mats = new Set();
  obj.traverse((node) => {
    if (node.geometry) geos.add(node.geometry);
    if (node.material) {
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of list) mats.add(material);
    }
  });
  for (const geo of geos) geo.dispose();
  for (const material of mats) {
    if (material.map) material.map.dispose();
    material.dispose();
  }
}
