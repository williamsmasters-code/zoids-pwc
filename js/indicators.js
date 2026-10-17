// Pure screen and minimap placement for objectives that sit outside the view.
// NDC x/y are -1..1 with +y up, matching three.js projection. Screen y is down.

import { rightFromForward } from "./frame.js";

export function clampFromCenter(x, y, minX, minY, maxX, maxY) {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dx = x - cx;
  const dy = y - cy;
  const halfW = (maxX - minX) / 2;
  const halfH = (maxY - minY) / 2;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax <= halfW && ay <= halfH) return { x, y, clamped: false };
  const sx = ax > 1e-8 ? halfW / ax : Infinity;
  const sy = ay > 1e-8 ? halfH / ay : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s, clamped: true };
}

// Project a world point's NDC onto the screen. Off-screen and behind-camera
// points land on the inset edge. forceEdge pulls an on-screen point out to
// that same edge so a far objective still shows a direction.
export function screenEdgeIndicator(ndcX, ndcY, behind, width, height, margin = 0.9, forceEdge = false) {
  let x = Number.isFinite(ndcX) ? ndcX : 0;
  let y = Number.isFinite(ndcY) ? ndcY : 0;
  if (behind) {
    const mag = Math.hypot(x, y);
    if (mag < 1e-6) {
      x = 0;
      y = -1;
    } else {
      x = -(x / mag);
      y = -(y / mag);
    }
    x *= margin + 1;
    y *= margin + 1;
  }
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > margin || ay > margin) {
    const sx = ax > 1e-8 ? margin / ax : Infinity;
    const sy = ay > 1e-8 ? margin / ay : Infinity;
    const s = Math.min(sx, sy);
    x *= s;
    y *= s;
  } else if (forceEdge) {
    const peak = Math.max(ax, ay);
    if (peak < 1e-4) {
      x = 0;
      y = margin;
    } else {
      const s = margin / peak;
      x *= s;
      y *= s;
    }
  }
  const clamped = behind || forceEdge || ax > margin || ay > margin;
  const px = (x * 0.5 + 0.5) * width;
  const py = (0.5 - y * 0.5) * height;
  const angle = Math.atan2(x, y);
  return { x: px, y: py, ndcX: x, ndcY: y, clamped, angle };
}

// Player-forward minimap. Points outside the canvas are pulled to the edge.
export function minimapProject(fwd, px, pz, x, z, scale, width, height, pad = 4) {
  const right = rightFromForward(fwd);
  const dx = x - px;
  const dz = z - pz;
  const localRight = dx * right.x + dz * right.z;
  const localFwd = dx * fwd.x + dz * fwd.z;
  const cx = width / 2;
  const cy = height / 2;
  const rawX = cx + localRight * scale;
  const rawY = cy - localFwd * scale;
  const clamped = clampFromCenter(rawX, rawY, pad, pad, width - pad, height - pad);
  return { x: clamped.x, y: clamped.y, clamped: clamped.clamped, rawX, rawY };
}
