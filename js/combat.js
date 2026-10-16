// Weapon timers, heat, and projectile motion. Meshes stay in the mission.

export function addHeat(unit, amount) {
  unit.heat += amount;
  if (unit.heat >= 100 && unit.shutdown <= 0) {
    unit.shutdown = 2.6;
    unit.heat = 62;
    return true;
  }
  return false;
}

export function coolUnit(unit, dt) {
  if (unit.shutdown > 0) {
    unit.shutdown -= dt;
    unit.heat = Math.max(0, unit.heat - 18 * dt);
    return;
  }
  const bleed = 7.5 + Math.abs(unit.speed) * 0.08;
  unit.heat = Math.max(0, unit.heat - bleed * dt);
}

export function weaponWantsShot(weapon, dt, trigger, allowed) {
  weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  if (!trigger || !allowed) {
    weapon.charge = 0;
    weapon.charging = false;
    return false;
  }
  if (weapon.windup) {
    weapon.charging = true;
    weapon.charge += dt;
    if (weapon.charge >= weapon.windup && weapon.cooldown <= 0) {
      weapon.charge = 0;
      weapon.charging = false;
      weapon.cooldown = 1 / weapon.rate;
      return true;
    }
    return false;
  }
  if (weapon.cooldown <= 0) {
    weapon.cooldown = 1 / weapon.rate;
    return true;
  }
  return false;
}

export function stepProjectile(p, dt, target) {
  if (p.homing && target && p.life > 0.15) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dz = target.z - p.z;
    const mag = Math.hypot(dx, dy, dz) || 1;
    const tx = dx / mag;
    const ty = dy / mag;
    const tz = dz / mag;
    const sm = Math.hypot(p.vx, p.vy, p.vz) || 1;
    const blend = Math.min(1, (p.turn || 2) * dt);
    let nx = p.vx / sm + (tx - p.vx / sm) * blend;
    let ny = p.vy / sm + (ty - p.vy / sm) * blend;
    let nz = p.vz / sm + (tz - p.vz / sm) * blend;
    const nm = Math.hypot(nx, ny, nz) || 1;
    p.vx = (nx / nm) * p.speed;
    p.vy = (ny / nm) * p.speed;
    p.vz = (nz / nm) * p.speed;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  p.life -= dt;
  p.traveled += p.speed * dt;
}

export function canOperateWeapon(unit, weapon) {
  if (!unit.alive || unit.shutdown > 0) return false;
  if (unit.parts.core && (unit.parts.core.destroyed || unit.parts.core.structure <= 0)) return false;
  const mount = unit.parts[weapon.mount];
  if (!mount || mount.destroyed || mount.structure <= 0) return false;
  if (unit.def.layout === "structure" && unit.parts.head && unit.parts.head.destroyed) return false;
  return true;
}
