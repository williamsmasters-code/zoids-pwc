// Objective direction: off-screen points sit on the screen edge, and the
// minimap keeps a far contact on the canvas instead of dropping it.

import assert from "node:assert/strict";
import { screenEdgeIndicator, minimapProject, clampFromCenter } from "../js/indicators.js";

const inside = clampFromCenter(40, 40, 4, 4, 146, 146);
assert.equal(inside.clamped, false);
assert.equal(inside.x, 40);
assert.equal(inside.y, 40);

const corner = clampFromCenter(0, 0, 4, 4, 146, 146);
assert.equal(corner.clamped, true);
assert.ok(Math.abs(corner.x - 4) < 1e-6);
assert.ok(Math.abs(corner.y - 4) < 1e-6);

const right = screenEdgeIndicator(1.5, 0.2, false, 1280, 720, 0.9, false);
assert.equal(right.clamped, true);
assert.ok(Math.abs(right.ndcX - 0.9) < 1e-6);
assert.ok(right.x > 1100 && right.x < 1280);
assert.ok(right.y > 0 && right.y < 720);

const visible = screenEdgeIndicator(0.2, 0.1, false, 1280, 720, 0.9, false);
assert.equal(visible.clamped, false);
assert.ok(Math.abs(visible.ndcX - 0.2) < 1e-6);

const forced = screenEdgeIndicator(0.2, 0.2, false, 1280, 720, 0.9, true);
assert.equal(forced.clamped, true);
assert.ok(Math.abs(Math.max(Math.abs(forced.ndcX), Math.abs(forced.ndcY)) - 0.9) < 1e-6);

const behind = screenEdgeIndicator(0.4, 0.2, true, 1280, 720, 0.9, false);
assert.equal(behind.clamped, true);
assert.ok(behind.ndcX < 0, "behind the camera, the arrow flips to the bearing edge");
assert.ok(Math.abs(Math.max(Math.abs(behind.ndcX), Math.abs(behind.ndcY)) - 0.9) < 1e-6);

const fwd = { x: 0, y: 0, z: -1 };
const far = minimapProject(fwd, 0, 0, 0, -500, 0.55, 150, 150, 4);
assert.equal(far.clamped, true);
assert.ok(Math.abs(far.x - 75) < 1e-6);
assert.ok(Math.abs(far.y - 4) < 1e-6, `ahead marker should pin to the top edge, y=${far.y}`);

const near = minimapProject(fwd, 0, 0, 0, -10, 0.55, 150, 150, 4);
assert.equal(near.clamped, false);
assert.ok(near.y < 75);

const flank = minimapProject(fwd, 0, 90, 400, 90, 0.55, 150, 150, 6);
assert.equal(flank.clamped, true);
assert.ok(flank.x > 140);

console.log("indicator tests ok");
