// Targeting geometry (pure math, no three.js, shared by the mission and node tests).
//
// Hit volumes: every Zoid is hit-tested against a compound set of boxes in the
// Zoid's own root frame, built once from its real part meshes (one box per
// mesh, padded a little so thin rods and barrels are not paper). A Zoid whose
// body is a thin sliver head-on (the Gun Sniper, the raptors) gets its core
// boxes widened to a minimum share of its footprint radius, so a gun with a
// sensible spread can hit it. Big Zoids already exceed that floor, so their
// volume is the model's own.
//
// Aim point: the volume-weighted centre of the body boxes (core and head
// count fully, legs 0.35, weapons and tails not at all), moved inside the
// nearest body box if it lands in a gap. Lock box, lead box, missiles and the
// AI all aim there.

export const HIT = {
  pad: 0.06,            // m added to every side of every mesh box
  minThick: 0.22,       // m minimum box thickness on any axis
  coreMinWidth: 0.5,    // core boxes at least radius x this wide (x) ...
  coreMinDepth: 0.5,    // ... and deep (z)
  coreMinHeight: 0.42,  // ... and tall (y)
};

const BODY_WEIGHT = { core: 1, head: 1, leftLeg: 0.35, rightLeg: 0.35, leftFrontLeg: 0.35, rightFrontLeg: 0.35, leftRearLeg: 0.35, rightRearLeg: 0.35 };

export function boxVolume(b) {
  return Math.max(0, b.max.x - b.min.x) * Math.max(0, b.max.y - b.min.y) * Math.max(0, b.max.z - b.min.z);
}

function grow(b, axis, size) {
  const lo = b.min[axis];
  const hi = b.max[axis];
  if (hi - lo >= size) return;
  const c = (lo + hi) / 2;
  b.min[axis] = c - size / 2;
  b.max[axis] = c + size / 2;
}

function contains(a, b) {
  return a.min.x <= b.min.x && a.min.y <= b.min.y && a.min.z <= b.min.z && a.max.x >= b.max.x && a.max.y >= b.max.y && a.max.z >= b.max.z;
}

// meshBoxes: [{ partId, min:{x,y,z}, max:{x,y,z} }] in the root frame.
export function buildHitBoxes(meshBoxes, radius, opts = {}) {
  const cfg = { ...HIT, ...opts };
  const r = radius || 2;
  const out = [];
  let floorY = Infinity;
  for (const m of meshBoxes || []) floorY = Math.min(floorY, m.min.y);
  for (const m of meshBoxes || []) {
    if (!m || !m.partId) continue;
    const b = { partId: m.partId, min: { ...m.min }, max: { ...m.max } };
    for (const k of ["x", "y", "z"]) { b.min[k] -= cfg.pad; b.max[k] += cfg.pad; grow(b, k, cfg.minThick); }
    out.push(b);
  }
  // Core floor: the biggest core box is widened to the minimum body size.
  const cores = out.filter((b) => b.partId === "core").sort((a, b) => boxVolume(b) - boxVolume(a));
  if (cores.length) {
    const main = cores[0];
    grow(main, "x", r * cfg.coreMinWidth);
    grow(main, "z", r * cfg.coreMinDepth);
    grow(main, "y", r * cfg.coreMinHeight);
    if (Number.isFinite(floorY) && main.min.y < floorY) { const lift = floorY - main.min.y; main.min.y += lift; main.max.y += lift; }
  }
  // Drop boxes fully inside another box of the same part.
  const kept = out.filter((b, i) => !out.some((o, j) => j !== i && o.partId === b.partId && contains(o, b) && (boxVolume(o) > boxVolume(b) || j < i)));
  return kept;
}

export function boundsOf(boxes) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const b of boxes) for (const k of ["x", "y", "z"]) { min[k] = Math.min(min[k], b.min[k]); max[k] = Math.max(max[k], b.max[k]); }
  return { min, max };
}

export function insideBox(b, p, eps = 1e-6) {
  return p.x >= b.min.x - eps && p.x <= b.max.x + eps && p.y >= b.min.y - eps && p.y <= b.max.y + eps && p.z >= b.min.z - eps && p.z <= b.max.z + eps;
}

function clampToBox(b, p) {
  return { x: Math.min(b.max.x, Math.max(b.min.x, p.x)), y: Math.min(b.max.y, Math.max(b.min.y, p.y)), z: Math.min(b.max.z, Math.max(b.min.z, p.z)) };
}

// Volume-weighted centre of mass of the body, guaranteed inside a body box.
export function centerOfMass(boxes) {
  let w = 0;
  const c = { x: 0, y: 0, z: 0 };
  const body = boxes.filter((b) => BODY_WEIGHT[b.partId]);
  for (const b of body) {
    const v = boxVolume(b) * BODY_WEIGHT[b.partId];
    w += v;
    c.x += ((b.min.x + b.max.x) / 2) * v;
    c.y += ((b.min.y + b.max.y) / 2) * v;
    c.z += ((b.min.z + b.max.z) / 2) * v;
  }
  if (!(w > 0)) {
    const all = boundsOf(boxes);
    return { x: (all.min.x + all.max.x) / 2, y: (all.min.y + all.max.y) / 2, z: (all.min.z + all.max.z) / 2 };
  }
  const p = { x: c.x / w, y: c.y / w, z: c.z / w };
  const solid = body.filter((b) => b.partId === "core" || b.partId === "head");
  const pool = solid.length ? solid : body;
  if (pool.some((b) => insideBox(b, p))) return p;
  let best = null;
  let bestD = Infinity;
  for (const b of pool) {
    const q = clampToBox(b, p);
    // Step a little inside so the point is not on a face.
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    const inner = { x: q.x + (cx - q.x) * 0.15, y: q.y + (cy - q.y) * 0.15, z: q.z + (cz - q.z) * 0.15 };
    const d = Math.hypot(inner.x - p.x, inner.y - p.y, inner.z - p.z);
    if (d < bestD) { bestD = d; best = inner; }
  }
  return best;
}

// Ray vs box (slab). Returns entry distance or null.
export function rayBox(o, d, b, maxDist = Infinity) {
  let t0 = 0;
  let t1 = maxDist;
  for (const k of ["x", "y", "z"]) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return null;
      continue;
    }
    const inv = 1 / d[k];
    let ta = (b.min[k] - o[k]) * inv;
    let tb = (b.max[k] - o[k]) * inv;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  return t0;
}

// Nearest box hit along a ray in the root frame: { t, partId } or null.
export function rayHitBoxes(o, d, boxes, maxDist = Infinity, near = 0) {
  let best = null;
  for (const b of boxes) {
    const t = rayBox(o, d, b, maxDist);
    if (t == null || t < near) continue;
    if (!best || t < best.t) best = { t, partId: b.partId };
  }
  return best;
}

// World <-> root frame for a root at (px, py, pz) turned by yaw about +Y
// (three.js rotation.y; the Zoid faces local -Z).
export function toLocal(p, root) {
  const dx = p.x - root.x, dy = p.y - root.y, dz = p.z - root.z;
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
  return { x: c * dx - s * dz, y: dy, z: s * dx + c * dz };
}
export function dirToLocal(d, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * d.x - s * d.z, y: d.y, z: s * d.x + c * d.z };
}
export function toWorld(p, root) {
  const c = Math.cos(root.yaw), s = Math.sin(root.yaw);
  return { x: root.x + c * p.x + s * p.z, y: root.y + p.y, z: root.z - s * p.x + c * p.z };
}

// Aim assist (modest). Given the crosshair ray and the locked target's centre
// of mass: if the ray passes within `snap` m of the centre, aim at the centre;
// if it passes within `box` m (the lock box), keep the player's line but set
// the convergence point at the target's range (no far-wall parallax).
// Returns { point, mode: "snap" | "range" | null, miss }.
export function assistAim(origin, dir, center, snap, box) {
  const to = { x: center.x - origin.x, y: center.y - origin.y, z: center.z - origin.z };
  const t = to.x * dir.x + to.y * dir.y + to.z * dir.z;
  if (!(t > 0)) return { point: null, mode: null, miss: Infinity };
  const q = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t };
  const miss = Math.hypot(q.x - center.x, q.y - center.y, q.z - center.z);
  if (miss <= snap) return { point: { ...center }, mode: "snap", miss };
  if (miss <= box) return { point: q, mode: "range", miss };
  return { point: null, mode: null, miss };
}

// Snap radius and lock-box radius for a target of footprint radius r.
export function assistRadii(r) {
  return { snap: 0.3 + 0.22 * (r || 2), box: 0.6 + 0.75 * (r || 2) };
}
