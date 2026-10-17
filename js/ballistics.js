// Pure weapon math. No three.js, so node tests and the mission share one solution.
// Beams and a finished charge are instant. Ballistics use a low arc so the shell
// passes through the crosshair point. Rockets need a full lock before they launch.

export const BALLISTIC_GRAVITY = 12;
export const LOCK_TIME = 1.5;
export const LOCK_BREAK_SPEED = 30;
export const CHARGE_TIME = 3;
export const STATIONARY_SPEED = 0.75;
export const ROCKET_POP_TIME = 0.52;
export const FALLOFF_FLOOR = 0.3;

export function rangeFalloff(distance, optimal, maxRange) {
  const max = Number(maxRange);
  if (!Number.isFinite(max)) return 1;
  if (distance >= max) return 0;
  const opt = Number.isFinite(Number(optimal)) ? Number(optimal) : max;
  if (distance <= opt || max <= opt) return 1;
  const t = (distance - opt) / (max - opt);
  return 1 - (1 - FALLOFF_FLOOR) * t;
}

export function impactDelay(weapon, distance) {
  if (!weapon || weapon.delivery === "beam" || weapon.delivery === "charge" || weapon.hitscan) return 0;
  const speed = weapon.speed || 1;
  return Math.max(0, distance) / speed;
}

export function rocketMayFire(lock) {
  return lock >= 1 - 1e-6;
}

// Low arc. Height is the aim point minus the muzzle. Null when the speed cannot reach.
export function ballisticAngle(speed, gravity, horizontal, height) {
  if (!(speed > 0) || !(gravity > 0) || !(horizontal > 1e-4)) return null;
  const v2 = speed * speed;
  const v4 = v2 * v2;
  const disc = v4 - gravity * (gravity * horizontal * horizontal + 2 * height * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (gravity * horizontal));
}

export function ballisticAim(muzzle, aim, speed, gravity) {
  const dx = aim.x - muzzle.x;
  const dy = aim.y - muzzle.y;
  const dz = aim.z - muzzle.z;
  const horizontal = Math.hypot(dx, dz);
  const directLen = Math.hypot(dx, dy, dz) || 1;
  const direct = { x: dx / directLen, y: dy / directLen, z: dz / directLen };
  if (!(speed > 0) || !(gravity > 0) || horizontal < 0.25) {
    return { dir: direct, solved: false, angle: 0, time: directLen / Math.max(speed, 1) };
  }
  const angle = ballisticAngle(speed, gravity, horizontal, dy);
  if (angle == null || !Number.isFinite(angle)) {
    return { dir: direct, solved: false, angle: 0, time: directLen / speed };
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dir = { x: (dx / horizontal) * cos, y: sin, z: (dz / horizontal) * cos };
  const mag = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= mag;
  dir.y /= mag;
  dir.z /= mag;
  const time = horizontal / (speed * Math.max(0.05, cos));
  return { dir, solved: true, angle, time };
}

export function ballisticPoint(origin, dir, speed, gravity, time) {
  return {
    x: origin.x + dir.x * speed * time,
    y: origin.y + dir.y * speed * time - 0.5 * gravity * time * time,
    z: origin.z + dir.z * speed * time,
  };
}

// Where a shot aimed straight at the point would be when it has covered that horizontal range.
export function dropPoint(origin, aim, speed, gravity) {
  const dx = aim.x - origin.x;
  const dy = aim.y - origin.y;
  const dz = aim.z - origin.z;
  const horizontal = Math.hypot(dx, dz);
  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  const vh = speed * Math.hypot(dir.x, dir.z);
  if (!(vh > 1) || !(gravity > 0)) {
    return { x: aim.x, y: aim.y, z: aim.z, drop: 0, t: 0 };
  }
  const t = horizontal / vh;
  const point = ballisticPoint(origin, dir, speed, gravity, t);
  return { ...point, drop: aim.y - point.y, t };
}

export function stepBallistic(p, dt) {
  p.t = (p.t || 0) + dt;
  const t = p.t;
  const g = p.gravity || 0;
  const prevX = p._px == null ? p.ox : p._px;
  const prevY = p._py == null ? p.oy : p._py;
  const prevZ = p._pz == null ? p.oz : p._pz;
  p.x = p.ox + p.vx0 * t;
  p.y = p.oy + p.vy0 * t - 0.5 * g * t * t;
  p.z = p.oz + p.vz0 * t;
  p.vx = p.vx0;
  p.vy = p.vy0 - g * t;
  p.vz = p.vz0;
  p.life -= dt;
  p.traveled = (p.traveled || 0) + Math.hypot(p.x - prevX, p.y - prevY, p.z - prevZ);
  p._px = p.x;
  p._py = p.y;
  p._pz = p.z;
}

export function leadPoint(from, target, velocity, speed, iterations = 4) {
  let point = { x: target.x, y: target.y, z: target.z };
  let time = 0;
  const spd = Math.max(1, speed);
  const vel = velocity || { x: 0, y: 0, z: 0 };
  for (let i = 0; i < iterations; i++) {
    time = Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z) / spd;
    point = {
      x: target.x + vel.x * time,
      y: target.y + (vel.y || 0) * time,
      z: target.z + vel.z * time,
    };
  }
  return { point, time };
}

export function lockStrength(speed) {
  return Math.max(0, 1 - Math.max(0, speed) / LOCK_BREAK_SPEED);
}

export function stepLock(lock, dt, speed, tracking, lockTime = LOCK_TIME) {
  const span = Math.max(0.05, lockTime);
  if (!tracking) {
    const next = Math.max(0, lock - dt / span);
    return { lock: next, strength: 0, ready: false };
  }
  const strength = lockStrength(speed);
  if (strength <= 0) return { lock: 0, strength: 0, ready: false };
  const next = Math.min(1, lock + (dt * strength) / span);
  return { lock: next, strength, ready: next >= 1 - 1e-9 };
}

export function rocketTurn(strength) {
  if (!(strength > 0)) return 0;
  return 0.6 + strength * 3.2;
}

// Pop straight up, then home. Early in the dive the aim point sits above the target.
export function stepRocket(p, dt, target) {
  p.age = (p.age || 0) + dt;
  const pop = p.popTime == null ? ROCKET_POP_TIME : p.popTime;
  const cruise = p.speed || 68;
  if (p.age < pop) {
    p.phase = "pop";
    const hx = p.hx != null ? p.hx : p.vx;
    const hz = p.hz != null ? p.hz : p.vz;
    const hm = Math.hypot(hx, hz) || 1;
    p.vx = (hx / hm) * cruise * 0.22;
    p.vy = cruise * 0.96;
    p.vz = (hz / hm) * cruise * 0.22;
    p.turn = 0;
  } else {
    p.phase = "dive";
    const speed = target && target.speed != null ? target.speed : 0;
    const strength = target ? lockStrength(speed) : 0;
    p.strength = strength;
    p.turn = rocketTurn(strength);
    if (target && p.turn > 0) {
      const bias = Math.max(0, 1 - (p.age - pop) / 0.85);
      const dx = target.x - p.x;
      const dy = target.y + bias * 22 - p.y;
      const dz = target.z - p.z;
      const mag = Math.hypot(dx, dy, dz) || 1;
      const sm = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const blend = Math.min(1, p.turn * dt);
      let nx = p.vx / sm + (dx / mag - p.vx / sm) * blend;
      let ny = p.vy / sm + (dy / mag - p.vy / sm) * blend;
      let nz = p.vz / sm + (dz / mag - p.vz / sm) * blend;
      const nm = Math.hypot(nx, ny, nz) || 1;
      p.vx = (nx / nm) * cruise;
      p.vy = (ny / nm) * cruise;
      p.vz = (nz / nm) * cruise;
    } else {
      p.vy -= 14 * dt;
      const sm = Math.hypot(p.vx, p.vy, p.vz) || 1;
      p.vx = (p.vx / sm) * cruise;
      p.vy = (p.vy / sm) * cruise;
      p.vz = (p.vz / sm) * cruise;
    }
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  p.life -= dt;
  p.traveled = (p.traveled || 0) + cruise * dt;
}

// Full charge only. Moving or releasing clears the gauge and does not fire.
export function stepCharge(weapon, dt, trigger, moving, allowed) {
  const need = weapon.chargeTime || CHARGE_TIME;
  weapon.cooldown = Math.max(0, (weapon.cooldown || 0) - dt);
  if (moving || !trigger || !allowed || weapon.cooldown > 1e-6) {
    weapon.charge = 0;
    weapon.charging = false;
    return false;
  }
  weapon.charging = true;
  weapon.charge = (weapon.charge || 0) + dt;
  if (weapon.charge + 1e-9 >= need) {
    weapon.charge = 0;
    weapon.charging = false;
    weapon.cooldown = 1 / Math.max(0.01, weapon.rate || 0.2);
    return true;
  }
  return false;
}
