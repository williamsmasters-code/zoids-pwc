// Builds every mock Zoid and every biome without a browser.
// Confirms the head sits in front of the core along the chassis -Z.

import { ZOIDS, ZOID_ORDER, STRUCTURES, stockWeaponsFor } from "../js/catalog.js";
import { buildUnitModel, disposeTree } from "../js/models.js";
import { createMap } from "../js/maps.js";
import { Box3, Vector3 } from "three";

function center(meshes) {
  const box = new Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box.getCenter(new Vector3());
}

for (const id of ZOID_ORDER) {
  const def = ZOIDS[id];
  const model = buildUnitModel(def, stockWeaponsFor(def, () => 0.2), "player");
  model.root.rotation.y = 0;
  model.root.updateMatrixWorld(true);
  const fwd = new Vector3();
  // getWorldDirection is local +Z. The nose, and the head, are -Z.
  model.root.getWorldDirection(fwd);
  fwd.negate();
  fwd.y = 0;
  fwd.normalize();
  const rel = center(model.partMeshes.head).sub(center(model.partMeshes.core));
  rel.y = 0;
  rel.normalize();
  const dot = rel.dot(fwd);
  if (dot < 0.7) throw new Error(`${id} head is not in front of the core (dot ${dot.toFixed(3)})`);
  if (def.layout === "quad") {
    const left = center(model.partMeshes.leftFrontLeg);
    const right = center(model.partMeshes.rightFrontLeg);
    if (!(left.x < right.x)) throw new Error(`${id} front legs are swapped`);
  }
  if (def.layout === "biped") {
    const left = center(model.partMeshes.leftLeg);
    const right = center(model.partMeshes.rightLeg);
    if (!(left.x < right.x)) throw new Error(`${id} legs are swapped`);
  }
  model.animate(0.4, 0.8, null);
  disposeTree(model.root);
  console.log("model ok", id, "dot", dot.toFixed(3));
}

for (const def of Object.values(STRUCTURES)) {
  const weapons = def.hardpoints.length ? stockWeaponsFor(def, () => 0.2) : [];
  const model = buildUnitModel(def, weapons, "enemy");
  model.animate(0.2, 0, null);
  disposeTree(model.root);
  console.log("structure ok", def.id);
}

for (const biome of ["desert", "plains", "arctic"]) {
  const map = createMap(biome, 1001);
  if (!map.obstacles.length) throw new Error(`${biome} has no rock colliders`);
  for (const obstacle of map.obstacles) {
    if (!obstacle.mesh) throw new Error(`${biome} collider has no mesh`);
  }
  const y = map.heightAt(12, -40);
  if (!Number.isFinite(y)) throw new Error(`${biome} height is not finite`);
  disposeTree(map.group);
  console.log("map ok", biome, map.obstacles.length, "rocks");
}

console.log("models and maps ok");
