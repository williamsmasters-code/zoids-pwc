// Weapon systems (overhaul, Nov 2026). Pure math, no three.js, so node tests
// and the mission share one rulebook. Player and AI use the same functions.
//
//   Targeting   sensor lock range, a targeting box around the reticle, lock
//               loss after a grace period, missile lock cones.
//   Fire        fire modes (auto / single / pulse / beam / salvo / charge /
//               melee), bursts, gatling spin-up, per-cycle heat.
//   Spread      base spread + bloom from sustained fire + movement + heat haze.
//   Ballistics  guns are zeroed at their optimal range. Inside it the shell
//               meets the crosshair; past it the shell drops below.
//   Beams       damage falls past optimal (js/rangebands.js) and refracts:
//               dust, smoke and ice fog bend, scatter and weaken a beam.
//   Missiles    lock cone, min arming range, hazards block the lock and blind
//               the seeker, fast targets break it.
// Numbers and reasoning: docs/WEAPONS_NOTES.txt.

// ---------- targeting ----------
export const SENSOR_LOCK_RANGE = 190;   // m, times the Zoid's sensor multiplier
export const TARGET_BOX_DEG = 12;       // R picks the enemy closest to the reticle inside this
export const LOCK_LOSS_GRACE = 3;       // s a target lock survives outside sensor range
export const LOCK_DECAY_MUL = 2;        // missile lock drains this much faster than it builds
export const DEFAULT_LOCK_CONE_DEG = 8; // missile seeker cone around the reticle
export const LOCK_BLOCK_PATH = 12;      // m of dust/smoke on the line of sight that blocks a missile lock

export function angleDeg(a, b) {
  const la = Math.hypot(a.x, a.y, a.z) || 1;
  const lb = Math.hypot(b.x, b.y, b.z) || 1;
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

export function sensorRange(rangeMul = 1, radarMul = 1) {
  return SENSOR_LOCK_RANGE * (rangeMul || 1) * (radarMul || 1);
}

// cands: [{ id, dist, angle }]. Only contacts inside sensor range are candidates.
export function inSensor(cands, range) {
  return (cands || []).filter((c) => c.dist <= range);
}

// The enemy closest to the reticle inside the targeting box, else null.
export function pickUnderReticle(cands, boxDeg = TARGET_BOX_DEG) {
  let best = null;
  for (const c of cands || []) {
    if (!(c.angle <= boxDeg)) continue;
    if (!best || c.angle < best.angle) best = c;
  }
  return best;
}

export function pickNearest(cands) {
  let best = null;
  for (const c of cands || []) if (!best || c.dist < best.dist) best = c;
  return best;
}

// Tab: next contact by distance (nearest first), wrapping.
export function cycleTargets(cands, currentId, step = 1) {
  const list = (cands || []).slice().sort((a, b) => a.dist - b.dist || String(a.id).localeCompare(String(b.id)));
  if (!list.length) return null;
  const i = list.findIndex((c) => c.id === currentId);
  if (i < 0) return list[step >= 0 ? 0 : list.length - 1];
  return list[(i + step + list.length * 4) % list.length];
}

// Lock upkeep. Dead drops at once; outside sensor range for longer than the
// grace drops it. Returns { keep, lostFor }.
export function stepTargetLock(lostFor, info, dt, grace = LOCK_LOSS_GRACE) {
  if (!info || !info.alive) return { keep: false, lostFor: 0 };
  if (info.inSensor) return { keep: true, lostFor: 0 };
  const next = (lostFor || 0) + dt;
  return { keep: next < grace, lostFor: next };
}

export function lockConeOf(weapon) {
  return (weapon && weapon.lockCone) || DEFAULT_LOCK_CONE_DEG;
}

// ---------- fire control ----------
export const MIN_SPIN = 0.35; // gatling fires at 35% rate from cold

export function fireModeOf(weapon) {
  if (!weapon) return "single";
  if (weapon.fireMode) return weapon.fireMode;
  if (weapon.kind === "melee") return "melee";
  if (weapon.chargeTime) return "charge";
  if (weapon.delivery === "rocket") return "salvo";
  if (weapon.delivery === "beam") return "beam";
  return "single";
}

export function burstOf(weapon) {
  const mode = fireModeOf(weapon);
  return mode === "pulse" || mode === "salvo" ? Math.max(1, weapon.burst || 1) : 1;
}

export function spinRate(weapon) {
  if (!weapon.spinUp) return weapon.rate;
  return weapon.rate * (MIN_SPIN + (1 - MIN_SPIN) * Math.max(0, Math.min(1, weapon.spin || 0)));
}

// Heat and damage are per CYCLE in the catalog; a pulse or salvo splits the
// heat across its shots (damage is per shot already).
export function heatPerShot(weapon) {
  return (weapon.heat || 0) / burstOf(weapon);
}

// Non-charge weapons. Returns how many shots leave the barrel this tick
// (bursts finish even if the trigger is let go, unless the weapon is lost).
// A "beam" shot starts a sustained beam the mission ticks for beamTime.
export function stepFireControl(weapon, dt, trigger, allowed) {
  let shots = 0;
  if (weapon.spinUp) {
    const up = trigger && allowed;
    weapon.spin = Math.max(0, Math.min(1, (weapon.spin || 0) + (up ? dt / weapon.spinUp : -dt / (weapon.spinUp * 0.6))));
  }
  if (!allowed) {
    weapon.burstLeft = 0;
  }
  if (weapon.burstLeft > 0) {
    weapon.burstTimer = (weapon.burstTimer || 0) - dt;
    while (weapon.burstLeft > 0 && weapon.burstTimer <= 1e-9) {
      shots++;
      weapon.burstLeft--;
      weapon.burstTimer += weapon.burstGap || 0.08;
    }
  }
  weapon.cooldown = (weapon.cooldown || 0) - dt;
  if (!trigger || !allowed) {
    weapon.cooldown = Math.max(0, weapon.cooldown);
    return shots;
  }
  let cycles = 0;
  while (weapon.cooldown <= 1e-9 && !(weapon.burstLeft > 0) && cycles < 4) {
    const rate = Math.max(0.01, spinRate(weapon) * (weapon.rateMul || 1));
    weapon.cooldown += 1 / rate;
    shots++;
    cycles++;
    const burst = burstOf(weapon);
    if (burst > 1) {
      weapon.burstLeft = burst - 1;
      weapon.burstTimer = weapon.burstGap || 0.08;
    }
  }
  if (weapon.cooldown < 0) weapon.cooldown = 0;
  return shots;
}

// ---------- spread ----------
export const CLASS_SPREAD = {
  // moveSpread: extra radians at full speed. haze: extra multiplier at max heat.
  ballistic: { moveSpread: 0.014, haze: 0.35 },
  beam: { moveSpread: 0.004, haze: 0.5 },
  missile: { moveSpread: 0, haze: 0 },
  melee: { moveSpread: 0, haze: 0 },
};

function spreadClass(weapon) {
  if (!weapon) return "beam";
  if (weapon.kind === "melee") return "melee";
  if (weapon.delivery === "rocket") return "missile";
  if (weapon.kind === "energy") return "beam";
  return "ballistic";
}

export function addBloom(weapon) {
  if (!weapon.bloom) return 0;
  weapon.bloomNow = Math.min(weapon.bloom.max, (weapon.bloomNow || 0) + weapon.bloom.perShot);
  weapon.bloomRest = weapon.bloom.delay == null ? 0.12 : weapon.bloom.delay;
  return weapon.bloomNow;
}

export function recoverBloom(weapon, dt) {
  if (!weapon.bloom || !weapon.bloomNow) return 0;
  if (weapon.bloomRest > 0) {
    weapon.bloomRest -= dt;
    return weapon.bloomNow;
  }
  weapon.bloomNow = Math.max(0, weapon.bloomNow - weapon.bloom.recover * dt);
  return weapon.bloomNow;
}

// Full cone width in radians (shots scatter +/- half of this).
// ctx: { speedFrac 0..1, heatFrac 0..1, rangeMul (band spread), skillMul }
export function shotSpread(weapon, ctx = {}) {
  const cls = CLASS_SPREAD[spreadClass(weapon)];
  const base = (weapon.spread || 0) * (ctx.rangeMul == null ? 1 : ctx.rangeMul);
  const move = (weapon.moveSpread != null ? weapon.moveSpread : cls.moveSpread) * Math.max(0, Math.min(1, ctx.speedFrac || 0));
  const heat = Math.max(0, Math.min(1, ctx.heatFrac || 0));
  const haze = 1 + cls.haze * Math.max(0, (heat - 0.6) / 0.4);
  return (base + (weapon.bloomNow || 0) + move) * haze * (ctx.skillMul == null ? 1 : ctx.skillMul);
}

// ---------- ballistics: zeroing and holdover ----------
export const DEFAULT_GRAVITY = 12;

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

// Low-arc launch angle (same as ballistics.js ballisticAngle).
function lowArc(speed, g, horizontal, height) {
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * horizontal * horizontal + 2 * height * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * horizontal));
}

// Barrel direction for a gun zeroed at `zero` m. Inside zero range the arc
// meets the aim point. Past it the barrel keeps the zero-range elevation, so
// the shell crosses the line of sight at `zero` and lands low.
export function zeroedDir(muzzle, aim, speed, gravity, zero) {
  const d = sub(aim, muzzle);
  const dist = Math.hypot(d.x, d.y, d.z) || 1;
  const los = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
  const g = gravity || DEFAULT_GRAVITY;
  const range = zero > 0 ? Math.min(dist, zero) : dist;
  const point = { x: los.x * range, y: los.y * range, z: los.z * range };
  const horizontal = Math.hypot(point.x, point.z);
  if (!(speed > 0) || horizontal < 0.25) return { dir: los, zeroed: dist <= (zero || dist), drop: 0 };
  const angle = lowArc(speed, g, horizontal, point.y);
  if (angle == null) return { dir: los, zeroed: false, drop: 0, short: true };
  const hx = point.x / horizontal;
  const hz = point.z / horizontal;
  const c = Math.cos(angle);
  const dir = { x: hx * c, y: Math.sin(angle), z: hz * c };
  return { dir, zeroed: dist <= zero + 1e-6 };
}

// Where a shot fired along `dir` is when it has covered the aim point's
// horizontal distance. drop = how far below the aim point it passes.
export function impactAt(muzzle, dir, speed, gravity, aim) {
  const d = sub(aim, muzzle);
  const horizontal = Math.hypot(d.x, d.z);
  const vh = speed * Math.hypot(dir.x, dir.z);
  if (!(vh > 0.5)) return { x: aim.x, y: aim.y, z: aim.z, drop: 0, t: 0 };
  const t = horizontal / vh;
  const g = gravity || DEFAULT_GRAVITY;
  const p = {
    x: muzzle.x + dir.x * speed * t,
    y: muzzle.y + dir.y * speed * t - 0.5 * g * t * t,
    z: muzzle.z + dir.z * speed * t,
  };
  return { ...p, drop: aim.y - p.y, t };
}

export function zeroedImpact(muzzle, aim, weapon) {
  const speed = weapon.speed || 80;
  const g = weapon.gravity || DEFAULT_GRAVITY;
  const z = zeroOf(weapon);
  const sol = zeroedDir(muzzle, aim, speed, g, z);
  return { ...impactAt(muzzle, sol.dir, speed, g, aim), zeroed: !!sol.zeroed, dir: sol.dir };
}

export function zeroOf(weapon) {
  return weapon.zero != null ? weapon.zero : weapon.optimal || 60;
}

// Pilot holdover: raise the aim point by `skill` x the predicted drop
// (0 = aims dead on and lands low, 1 = perfect compensation).
export function holdoverPoint(muzzle, aim, weapon, skill) {
  const s = Math.max(0, Math.min(1, skill || 0));
  if (!s) return { x: aim.x, y: aim.y, z: aim.z };
  let p = { x: aim.x, y: aim.y, z: aim.z };
  for (let i = 0; i < 3; i++) {
    const hit = zeroedImpact(muzzle, p, weapon);
    p = { x: p.x, y: p.y + (aim.y - hit.y) * s, z: p.z };
    if (s < 1) break;
  }
  return p;
}

// ---------- hazards and beam refraction ----------
export const HAZARD_KINDS = {
  dust: { label: "DUST", absorb: 0.024, scatter: 0.0014, color: 0xd9b98a },
  smoke: { label: "SMOKE", absorb: 0.03, scatter: 0.0018, color: 0x55595e },
  snow: { label: "ICE FOG", absorb: 0.02, scatter: 0.0012, color: 0xe6f2fa },
  mist: { label: "MIST", absorb: 0.026, scatter: 0.0017, color: 0xdfece4 },
  // Water (battlefields): beams that travel under the surface lose power fast.
  water: { label: "WATER", absorb: 0.09, scatter: 0.004, color: 0x7fc4e0 },
};
// Battlefields (js/battlefield.js): city smoke and dust, jungle mist, pass
// dust. Old ids kept so old saves and tests still resolve.
export const BIOME_HAZARD = {
  city: "smoke", denseJungle: "mist", sparseJungle: "mist", pass: "dust",
  desert: "dust", plains: "smoke", arctic: "snow",
};
export const MIN_TRANSMISSION = 0.2;
export const MAX_REFRACT = 0.08; // rad (about 4.6 degrees)

// Vertical cylinder { x, z, r, y0, h }. Returns [tIn, tOut] along origin+dir*t, clipped to [0, maxDist].
export function rayCylinder(origin, dir, maxDist, hz) {
  const ox = origin.x - hz.x;
  const oz = origin.z - hz.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t0 = 0;
  let t1 = maxDist;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > hz.r * hz.r) return null;
  } else {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - hz.r * hz.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - s) / (2 * a));
    t1 = Math.min(t1, (-b + s) / (2 * a));
  }
  const y0 = hz.y0 == null ? -Infinity : hz.y0;
  const y1 = y0 + (hz.h == null ? Infinity : hz.h);
  if (Math.abs(dir.y) < 1e-9) {
    if (origin.y < y0 || origin.y > y1) return null;
  } else {
    let ta = (y0 - origin.y) / dir.y;
    let tb = (y1 - origin.y) / dir.y;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t1 > t0 ? [t0, t1] : null;
}

// Box rotated by `yaw` about Y: { x, z, hw (along yaw), hd, yaw, y0, h }.
export function rayBox(origin, dir, maxDist, hz) {
  const c = Math.cos(hz.yaw || 0);
  const s = Math.sin(hz.yaw || 0);
  const ox = origin.x - hz.x;
  const oz = origin.z - hz.z;
  // local u along (cos, sin), v along (-sin, cos)
  const lo = { u: ox * c + oz * s, v: -ox * s + oz * c, y: origin.y };
  const ld = { u: dir.x * c + dir.z * s, v: -dir.x * s + dir.z * c, y: dir.y };
  const y0 = hz.y0 == null ? -Infinity : hz.y0;
  const y1 = y0 + (hz.h == null ? Infinity : hz.h);
  let t0 = 0;
  let t1 = maxDist;
  for (const [o, d, a, b] of [[lo.u, ld.u, -hz.hw, hz.hw], [lo.v, ld.v, -hz.hd, hz.hd], [lo.y, ld.y, y0, y1]]) {
    if (Math.abs(d) < 1e-9) {
      if (o < a || o > b) return null;
    } else {
      let ta = (a - o) / d;
      let tb = (b - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t1 <= t0) return null;
    }
  }
  return [t0, t1];
}

// Total hazard path along a ray. absorb / scatter are summed coefficient x length.
export function hazardPath(origin, dir, dist, hazards) {
  const out = { length: 0, absorb: 0, scatter: 0, first: null, kinds: [] };
  for (const hz of hazards || []) {
    const seg = hz.shape === "box" ? rayBox(origin, dir, dist, hz) : rayCylinder(origin, dir, dist, hz);
    if (!seg) continue;
    const len = seg[1] - seg[0];
    const kind = HAZARD_KINDS[hz.kind] || HAZARD_KINDS.dust;
    out.length += len;
    out.absorb += kind.absorb * len;
    out.scatter += kind.scatter * len;
    if (!out.kinds.includes(hz.kind)) out.kinds.push(hz.kind);
    if (!out.first || seg[0] < out.first.t) out.first = { t: seg[0], hazard: hz };
  }
  return out;
}

// Share of beam damage that gets through. refract = the weapon's sensitivity
// (pulse laser 1, beam cannon 0.8, particle cannon 0.35, ballistics 0).
export function beamTransmission(path, refract = 1) {
  if (!path || !path.length || !refract) return 1;
  return Math.max(MIN_TRANSMISSION, Math.exp(-path.absorb * refract));
}

export function refractAngle(path, refract = 1) {
  if (!path || !path.length || !refract) return 0;
  return Math.min(MAX_REFRACT, path.scatter * refract);
}

// Tip `dir` by `angle` rad toward a random side (u, v in [0, 1)).
export function bendDir(dir, angle, u, v) {
  if (!angle) return { ...dir };
  const d = dir;
  const helper = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ax = d.y * helper.z - d.z * helper.y;
  let ay = d.z * helper.x - d.x * helper.z;
  let az = d.x * helper.y - d.y * helper.x;
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; ay /= al; az /= al;
  const bx = d.y * az - d.z * ay;
  const by = d.z * ax - d.x * az;
  const bz = d.x * ay - d.y * ax;
  const phi = u * Math.PI * 2;
  const mag = angle * (0.25 + 0.75 * v);
  const s = Math.sin(mag);
  const c = Math.cos(mag);
  const px = Math.cos(phi) * ax + Math.sin(phi) * bx;
  const py = Math.cos(phi) * ay + Math.sin(phi) * by;
  const pz = Math.cos(phi) * az + Math.sin(phi) * bz;
  const out = { x: d.x * c + px * s, y: d.y * c + py * s, z: d.z * c + pz * s };
  const l = Math.hypot(out.x, out.y, out.z) || 1;
  return { x: out.x / l, y: out.y / l, z: out.z / l };
}

// Missile seeker: a thick enough cloud on the line of sight blocks the lock.
export function lockBlocked(path) {
  return !!(path && path.length >= LOCK_BLOCK_PATH);
}

// A target standing inside a cloud blinds missiles in flight (homing x0.3).
export function insideHazard(pos, hazards) {
  for (const hz of hazards || []) {
    const y0 = hz.y0 == null ? -Infinity : hz.y0;
    if (Math.hypot(pos.x - hz.x, pos.z - hz.z) <= hz.r && pos.y >= y0 && pos.y <= y0 + (hz.h || Infinity)) return hz;
  }
  return null;
}
export const SEEKER_BLIND_MUL = 0.3;

// Static clouds per biome. Rings 55-150 m from the centre, kept off the
// spawn and convoy lane (x near 0). rng: () => [0, 1).
export function placeHazards(biome, rng, count = 4) {
  const kind = BIOME_HAZARD[biome] || "dust";
  const list = [];
  let guard = 0;
  while (list.length < count && guard++ < 60) {
    const ang = rng() * Math.PI * 2;
    const dist = 55 + rng() * 95;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (Math.abs(x) < 20) continue; // keep the spawn / convoy lane (x near 0) clear
    if (list.some((h) => Math.hypot(h.x - x, h.z - z) < 45)) continue;
    list.push({ kind, x, z, r: 11 + rng() * 7, h: 16 + rng() * 8, y0: null });
  }
  return list;
}

// ---------- missiles ----------
export const MISSILE_UNARMED_MUL = 0.25;
export function missileArmed(traveled, armRange) {
  return !(armRange > 0) || traveled >= armRange;
}
