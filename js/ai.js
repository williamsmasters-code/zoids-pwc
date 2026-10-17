// Hostile pilots: close, circle, face the target, shoot when the nose is on it.

import { yawToFace } from "./frame.js";

export function createBrain(rng) {
  return {
    flank: rng() < 0.5 ? 1 : -1,
    nextFlank: 2.2 + rng() * 3.2,
    react: 1.15 + rng() * 1.35,
    preferred: 38 + rng() * 28,
    prefersObjective: rng() < 0.6,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    seen: false,
  };
}

function nearest(unit, list) {
  let best = null;
  let bestD = Infinity;
  const x = unit.model.root.position.x;
  const z = unit.model.root.position.z;
  for (const other of list) {
    if (!other.alive || other.id === unit.id) continue;
    const d = Math.hypot(other.model.root.position.x - x, other.model.root.position.z - z);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best ? { unit: best, dist: bestD } : null;
}

export function chooseTarget(unit, brain, units) {
  const foes = units.filter((u) => u.alive && u.team !== unit.team && u.def.layout !== "vehicle");
  const trucks = units.filter((u) => u.alive && u.team !== unit.team && u.def.layout === "vehicle");
  const objectives = units.filter((u) => u.alive && u.team !== unit.team && u.def.build === "generator");
  if (brain.prefersObjective && objectives.length) {
    const hit = nearest(unit, objectives);
    if (hit) return hit.unit;
  }
  if (brain.prefersObjective && trucks.length) {
    const hit = nearest(unit, trucks);
    if (hit) return hit.unit;
  }
  const foe = nearest(unit, foes);
  if (foe) return foe.unit;
  const truck = nearest(unit, trucks);
  return truck ? truck.unit : null;
}

export function updateBrain(unit, brain, ctx, dt) {
  brain.react -= dt;
  brain.nextFlank -= dt;
  if (brain.nextFlank <= 0) {
    brain.flank *= -1;
    brain.nextFlank = 2.4 + Math.random() * 3.4;
  }
  const target = chooseTarget(unit, brain, ctx.units);
  unit.aiTarget = target;
  if (!target || brain.react > 0) {
    unit.cmd = { throttle: brain.react > 0 ? 0.4 : 0, strafe: 0, yaw: null, fire: false, skill: false };
    return;
  }
  const x = unit.model.root.position.x;
  const z = unit.model.root.position.z;
  const tx = target.model.root.position.x;
  const tz = target.model.root.position.z;
  const dist = Math.hypot(tx - x, tz - z);
  let throttle = 0;
  let strafe = 0;
  if (unit.def.immobile) {
    throttle = 0;
    strafe = 0;
  } else if (dist > brain.preferred * 1.25) {
    throttle = 1;
    strafe = brain.flank * 0.2;
  } else if (dist < brain.preferred * 0.55) {
    throttle = -0.65;
    strafe = brain.flank;
  } else {
    throttle = 0.12;
    strafe = brain.flank;
  }
  const moved = Math.hypot(x - brain.lastX, z - brain.lastZ);
  if (Math.abs(throttle) > 0.5) {
    if (moved < 0.15 * dt * 60) brain.stuckT += dt;
    else brain.stuckT = 0;
  }
  brain.lastX = x;
  brain.lastZ = z;
  if (brain.stuckT > 0.8) {
    throttle = -0.8;
    strafe = -brain.flank;
    brain.flank *= -1;
    brain.stuckT = 0;
  }
  const maxRange = unit.weapons.reduce((m, w) => Math.max(m, w.range || 0), 40);
  const bracing = unit.weapons.some((weapon) => weapon.delivery === "charge" || weapon.chargeTime);
  if (bracing && dist < maxRange * 0.98) {
    throttle = 0;
    strafe = 0;
  }
  const face = yawToFace(tx - x, tz - z);
  const skill = unit.skill;
  const skillReady = !!(skill && skill.cooldown <= 0 && !skill.overheated && !skill.active);
  const inSkillRange = dist < Math.min(48, Math.max(28, maxRange));
  let useSkill = false;
  if (skillReady && inSkillRange) {
    if (!brain.skillHeld) useSkill = true;
    brain.skillHeld = true;
  } else {
    brain.skillHeld = false;
  }
  // Loose aim gate. The mission compares the chassis forward to the target.
  unit.cmd = {
    throttle,
    strafe,
    yaw: face,
    fire: dist < maxRange * 0.98,
    skill: useSkill,
    aim: {
      x: tx,
      y: target.model.root.position.y + (target.def.radius || 2) * 0.45,
      z: tz,
    },
  };
}
