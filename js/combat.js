// Weapon timers, per-weapon heat, and projectile motion. Meshes stay in the mission.
// Each weapon has its own gauge. Overheat locks that weapon until it cools
// under HEAT_UNLOCK. Other weapons on the same Zoid keep firing.

export const HEAT_MAX = 100;
export const HEAT_UNLOCK = 55;

export function addWeaponHeat(weapon, amount) {
  const add = amount == null ? Number(weapon.heat) || 0 : amount;
  weapon.heatGauge = Math.min(HEAT_MAX, (weapon.heatGauge || 0) + add);
  if (weapon.heatGauge >= HEAT_MAX - 1e-6) {
    weapon.heatGauge = HEAT_MAX;
    weapon.overheated = true;
    return true;
  }
  return false;
}

export function coolWeapon(weapon, dt, speed = 0) {
  const rate = (weapon.cooling == null ? 12 : weapon.cooling) + Math.abs(speed) * 0.05;
  weapon.heatGauge = Math.max(0, (weapon.heatGauge || 0) - rate * dt);
  if (weapon.overheated && weapon.heatGauge <= HEAT_UNLOCK) weapon.overheated = false;
  return !!weapon.overheated;
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

export function mountUsable(unit, weapon) {
  if (!unit || !unit.alive || !weapon) return false;
  if (unit.parts.core && (unit.parts.core.destroyed || unit.parts.core.structure <= 0)) return false;
  const mount = unit.parts[weapon.mount];
  if (!mount || mount.destroyed || mount.structure <= 0) return false;
  if (unit.def && unit.def.layout === "structure" && unit.parts.head && unit.parts.head.destroyed) return false;
  return true;
}

export function canOperateWeapon(unit, weapon) {
  if (!mountUsable(unit, weapon)) return false;
  if (weapon.overheated) return false;
  return true;
}

// Group dock state. Overheated only when every living weapon in the group is locked.
// A dead mount is disabled. An empty group stays empty. Shield lock is not a dock state.
export function groupHeatState(weapons, unit) {
  const list = weapons || [];
  if (!list.length) return { state: "empty", heat: 0, heats: [] };
  const heats = list.map((weapon) => ({
    name: weapon.name || weapon.id || "Weapon",
    heat: weapon.heatGauge || 0,
    overheated: !!weapon.overheated,
    dead: !mountUsable(unit, weapon),
  }));
  const heat = heats.reduce((max, row) => Math.max(max, row.dead ? 0 : row.heat), 0);
  const living = list.filter((weapon) => mountUsable(unit, weapon));
  if (!living.length) return { state: "disabled", heat, heats };
  if (living.every((weapon) => weapon.overheated)) return { state: "overheated", heat, heats };
  const usable = living.filter((weapon) => !weapon.overheated);
  if (usable.every((weapon) => weapon.cooldown > 0.03 || weapon.charging)) {
    return { state: "cooling", heat, heats };
  }
  return { state: "ready", heat, heats };
}
