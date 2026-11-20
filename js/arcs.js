// Weapon mount arcs. Pure math, no three.js, shared by the mission and tests.
//
// Every hardpoint has a traverse (yaw, +/- from the chassis nose) and an
// elevation window (up / down from the chassis horizontal plane), set by how
// the weapon is mounted on that Zoid: chin and jaw guns are a narrow forward
// cone (the body has to turn and the view has to come round), flank and arm
// guns swing wider and higher, back turrets traverse wide and elevate high,
// missile pods launch upward and guide (wide effective arc), charge weapons
// (particle cannons) need the whole body braced (narrow). A shot the reticle
// asks for outside the arc cannot be made: the mount stops at the arc edge,
// the HUD says OUT OF ARC and the weapon holds fire (player and AI alike).
//
// Degrees in the table; weaponArc() returns radians.

const D = Math.PI / 180;

// Per Zoid, per mount: [yaw +/-, up, down] in degrees.
// Turreted back mounts take their traverse from the catalog turret arc
// (js/catalog.js, js/turret.js) and their elevation from here.
export const ARC_TABLE = {
  commandWolf:  { headWeapon: [15, 15, 25], leftWeapon: [30, 30, 25], rightWeapon: [30, 30, 25], backMount: [180, 60, 15] },
  zaberFang:    { headWeapon: [15, 15, 25], leftWeapon: [25, 25, 30], rightWeapon: [25, 25, 30], backMount: [45, 50, 15] },
  shieldLiger:  { headWeapon: [15, 15, 25], leftWeapon: [30, 30, 25], rightWeapon: [30, 30, 25], backMount: [90, 65, 15] },
  bladeLiger:   { headWeapon: [15, 15, 25], leftWeapon: [20, 20, 25], rightWeapon: [20, 20, 25], backMount: [90, 55, 15] },
  ironKong:     { headWeapon: [20, 25, 20], leftWeapon: [45, 70, 40], rightWeapon: [45, 70, 40], backMount: [135, 80, 15] },
  genoSaurer:   { headWeapon: [15, 20, 25], leftWeapon: [35, 50, 40], rightWeapon: [35, 50, 40], backMount: [67, 40, 15] },
  gojulas:      { headWeapon: [15, 20, 25], leftWeapon: [40, 55, 45], rightWeapon: [40, 55, 45], backMount: [45, 60, 25] },
  deathSaurer:  { headWeapon: [12, 20, 25], leftWeapon: [35, 45, 40], rightWeapon: [35, 45, 40], backMount: [108, 75, 15] },
  deathStinger: { headWeapon: [15, 15, 25], leftWeapon: [40, 40, 30], rightWeapon: [40, 40, 30], backMount: [54, 70, 30] },
  gunSniper:    { headWeapon: [15, 15, 25], leftWeapon: [25, 45, 20], rightWeapon: [25, 45, 20], backMount: [90, 70, 15] },
  elephander:   { headWeapon: [30, 40, 45], leftWeapon: [30, 35, 25], rightWeapon: [30, 35, 25], backMount: [135, 60, 15] },
  berserkFuhrer:{ headWeapon: [15, 20, 25], leftWeapon: [35, 50, 40], rightWeapon: [35, 50, 40], backMount: [20, 30, 15] },
  molga:        { headWeapon: [10, 10, 15], leftWeapon: [20, 20, 20], rightWeapon: [20, 20, 20], backMount: [180, 65, 15] },
  pteras:       { headWeapon: [12, 15, 35], leftWeapon: [10, 12, 40], rightWeapon: [10, 12, 40], backMount: [45, 5, 80] },
};

// Fallback by hardpoint for Zoids not in the table (turret emplacements etc.).
const DEFAULT_ARC = {
  headWeapon: [15, 15, 25],
  leftWeapon: [30, 30, 25],
  rightWeapon: [30, 30, 25],
  backMount: [90, 55, 15],
};

// Missiles launch upward then guide: at least this wide.
export const ROCKET_ARC = [90, 85, 40];
// Charge weapons brace the whole body: at most this wide.
export const CHARGE_ARC = [12, 25, 25];
// Within this much of the edge a shot still goes (to the edge).
export const ARC_TOLERANCE = 1.5 * D;

export function baseArc(zoidId, mount, build) {
  if (build === "turret" && mount === "headWeapon") return [180, 70, 15];
  const row = ARC_TABLE[zoidId];
  return (row && row[mount]) || DEFAULT_ARC[mount] || [30, 30, 25];
}

// Effective arc (radians) for a weapon on a mount of a Zoid.
//   def: catalog Zoid; weapon: { mount, delivery, chargeTime, kind, turret }
// Returns { yaw, up, down, kind } where yaw is the half traverse.
export function weaponArc(def, weapon) {
  const mount = weapon.mount;
  let [yaw, up, down] = baseArc(def && def.id, mount, def && def.build);
  let kind = mount === "backMount" ? "back" : mount === "headWeapon" ? "forward" : "flank";
  if (weapon.kind === "melee" || weapon.innate) {
    // Melee: a front arc (meleeCheck owns the exact reach / angle test).
    return { yaw: 60 * D, up: 45 * D, down: 45 * D, kind: "melee" };
  }
  if (weapon.delivery === "rocket") {
    yaw = Math.max(yaw, ROCKET_ARC[0]);
    up = Math.max(up, ROCKET_ARC[1]);
    down = Math.max(down, ROCKET_ARC[2]);
    kind = "missile";
  }
  if (weapon.chargeTime || weapon.delivery === "charge") {
    yaw = Math.min(yaw, CHARGE_ARC[0]);
    up = Math.min(up, CHARGE_ARC[1]);
    down = Math.min(down, CHARGE_ARC[2]);
    kind = "braced";
  }
  if (weapon.turret && weapon.turret.arc != null) {
    yaw = Math.min(180, (weapon.turret.arc / 2) / D);
    kind = "turret";
  }
  return { yaw: yaw * D, up: up * D, down: down * D, kind };
}

function wrap(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

// Bearing (yaw of a direction, 0 = -Z, +PI/2 = -X i.e. left) like frame.js.
export function dirYaw(d) {
  return Math.atan2(-d.x, -d.z);
}

// Clamp a world direction to an arc on a chassis facing `chassisYaw`.
// Returns { dir, out, yawOff, pitchOff, bearing, elev } where out is true
// when the direction lies outside the arc by more than ARC_TOLERANCE.
export function clampToArc(chassisYaw, dir, arc) {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const elev = Math.asin(Math.max(-1, Math.min(1, d.y)));
  const bearing = wrap(dirYaw(d) - chassisYaw);
  const full = arc.yaw >= Math.PI - 1e-6;
  const cb = full ? bearing : Math.max(-arc.yaw, Math.min(arc.yaw, bearing));
  const ce = Math.max(-arc.down, Math.min(arc.up, elev));
  const yawOff = Math.abs(bearing - cb);
  const pitchOff = Math.abs(elev - ce);
  const out = yawOff > ARC_TOLERANCE || pitchOff > ARC_TOLERANCE;
  if (yawOff < 1e-9 && pitchOff < 1e-9) return { dir: d, out: false, yawOff: 0, pitchOff: 0, bearing, elev };
  const y = chassisYaw + cb;
  const c = Math.cos(ce);
  return { dir: { x: -Math.sin(y) * c, y: Math.sin(ce), z: -Math.cos(y) * c }, out, yawOff, pitchOff, bearing, elev };
}

// Is a world point reachable from a mount position for this arc?
export function pointInArc(chassisYaw, from, to, arc) {
  const r = clampToArc(chassisYaw, { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }, arc);
  return !r.out;
}

export function arcDegrees(arc) {
  return { yaw: Math.round(arc.yaw / D), up: Math.round(arc.up / D), down: Math.round(arc.down / D), kind: arc.kind };
}
