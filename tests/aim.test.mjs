// Aim-point math. No three.js. Run with: node tests/aim.test.mjs

import assert from "node:assert/strict";
import {
  AIM_FAR,
  normalize3,
  screenCenterRay,
  aimPointAlongRay,
  directionToPoint,
  rayPassesThrough,
  selectAimHit,
} from "../js/aim.js";

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const origin = { x: 0, y: 8, z: 14 };
const forward = { x: 0, y: -3, z: -14 };
const ray = screenCenterRay(origin, forward);
const unit = normalize3(forward);
assert.ok(Math.abs(Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z) - 1) < 1e-9);

const miss = aimPointAlongRay(ray.origin, ray.direction, null);
assert.ok(Math.abs(dist(origin, miss) - AIM_FAR) < 1e-6);
assert.ok(rayPassesThrough(origin, unit, miss));
assert.ok(Math.abs(miss.x - (origin.x + unit.x * AIM_FAR)) < 1e-6);
assert.ok(Math.abs(miss.y - (origin.y + unit.y * AIM_FAR)) < 1e-6);
assert.ok(Math.abs(miss.z - (origin.z + unit.z * AIM_FAR)) < 1e-6);

const hitPoint = { x: 4, y: 1.5, z: -30 };
const hit = aimPointAlongRay(origin, ray.direction, hitPoint);
assert.deepEqual(hit, hitPoint);

const skipped = selectAimHit([
  { ownerId: "player", partId: "core", point: { x: 0, y: 2, z: 1 } },
  { ownerId: "player", partId: "head", point: { x: 0, y: 3, z: 0 } },
  { ownerId: "enemy", partId: "head", point: { x: 1, y: 2, z: -40 } },
], "player");
assert.equal(skipped.ownerId, "enemy");
assert.equal(skipped.partId, "head");

const ground = selectAimHit([
  { ownerId: "player", partId: "tail" },
  { ground: true, point: { x: 0, y: 0, z: -12 } },
], "player");
assert.equal(ground.ground, true);

const block = selectAimHit([
  null,
  { ownerId: "player", partId: "core" },
  { block: true, point: { x: 2, y: 1, z: -8 } },
], "player");
assert.equal(block.block, true);

assert.equal(selectAimHit([{ ownerId: "player", partId: "core" }], "player"), null);
assert.equal(selectAimHit([{ ownerId: "scenery" }], "player"), null);
assert.equal(selectAimHit(null, "player"), null);

// Third person: camera behind and above, two mounts off the center line.
const camera = { x: 0, y: 8, z: 14 };
const aim = aimPointAlongRay(camera, forward, null, 1000);
const mounts = [
  { x: -2, y: 1.5, z: 0 },
  { x: 2, y: 1.5, z: 0 },
];
const dirs = mounts.map((mount) => directionToPoint(mount, aim));
for (let i = 0; i < mounts.length; i++) {
  assert.ok(rayPassesThrough(mounts[i], dirs[i], aim), `mount ${i} misses the aim point`);
  assert.ok(dist(mounts[i], aim) > 10);
}
const parallel = dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y + dirs[0].z * dirs[1].z;
const cross = Math.hypot(
  dirs[0].y * dirs[1].z - dirs[0].z * dirs[1].y,
  dirs[0].z * dirs[1].x - dirs[0].x * dirs[1].z,
  dirs[0].x * dirs[1].y - dirs[0].y * dirs[1].x,
);
assert.ok(cross > 1e-4, `far mount rays are the same direction (${parallel})`);
assert.ok(rayPassesThrough(camera, forward, aim));

// A supplied hit is used unchanged, and both mounts still meet there.
// At 25 m the mounts are not aimed along the same line.
const shared = { x: 1, y: 0, z: -25 };
assert.deepEqual(aimPointAlongRay(camera, forward, shared), shared);
const nearDirs = mounts.map((mount) => directionToPoint(mount, shared));
for (let i = 0; i < mounts.length; i++) {
  assert.ok(rayPassesThrough(mounts[i], nearDirs[i], shared));
}
const nearDot = nearDirs[0].x * nearDirs[1].x + nearDirs[0].y * nearDirs[1].y + nearDirs[0].z * nearDirs[1].z;
assert.ok(nearDot < 0.99, `close mounts did not converge (${nearDot})`);

console.log("aim tests ok");
