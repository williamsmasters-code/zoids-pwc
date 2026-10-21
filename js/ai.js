// Hostile pilots: close, circle, face the target, shoot when the nose is on it.

import { yawToFace } from "./frame.js";

// tune (js/difficulty.js aiTuning): aimError (m of scatter per 100 m),
// react (s before first move), preferred (stand-off m), aggroRange (m: the
// player inside this pulls aggro), guard ({x, z, radius}: hold an ambush
// spot until a foe comes inside radius or the unit is shot).
export function createBrain(rng, tune = {}) {
  return {
    flank: rng() < 0.5 ? 1 : -1,
    nextFlank: 2.2 + rng() * 3.2,
    react: (tune.react != null ? tune.react : 1.15) + rng() * 1.35,
    preferred: (tune.preferred != null ? tune.preferred - 10 : 38) + rng() * 20,
    aimError: tune.aimError || 0,
    aggroRange: tune.aggroRange || 0,
    guard: tune.guard || null,
    alerted: !tune.guard,
    jitterT: 0,
    jx: 0,
    jy: 0,
    jz: 0,
    rng,
    prefersObjective: tune.prefersObjective != null ? tune.prefersObjective : rng() < 0.6,
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

// Who is this pilot fighting? Order:
// 1. whoever shot it in the last few seconds (provokedBy / provokedUntil),
// 2. a non-vehicle foe inside aggroRange (the player getting close),
// 3. the objective (generator / trucks) if it prefers objectives,
// 4. the nearest foe.
export function chooseTarget(unit, brain, units, time = 0) {
  const p = unit.provokedBy;
  if (p && p.alive && p.team !== unit.team && (unit.provokedUntil || 0) > time) return p;
  if (brain.aggroRange > 0) {
    const close = nearest(unit, units.filter((u) => u.alive && u.team !== unit.team && u.def.layout !== "vehicle" && !u.def.immobile));
    if (close && close.dist <= brain.aggroRange) return close.unit;
  }
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
  const time = ctx.time || 0;
  if (!brain.alerted) {
    // Ambush: hold the spot until something walks in or we get shot.
    const g = brain.guard;
    const provoked = unit.provokedBy && (unit.provokedUntil || 0) > time;
    const intruder = nearest(unit, ctx.units.filter((u) => u.alive && u.team !== unit.team));
    if (provoked || (intruder && intruder.dist <= g.radius)) brain.alerted = true;
    else {
      unit.aiTarget = null;
      unit.cmd = { throttle: 0, strafe: 0, yaw: null, fire: false, skill: false };
      return;
    }
  }
  const target = chooseTarget(unit, brain, ctx.units, time);
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
  let face = yawToFace(tx - x, tz - z);
  let climb = 0;
  if (unit.flight) {
    // Flyer pilot: never hover (keep airspeed over the stall), hold a
    // cruise altitude, dive to attack height on the run in, and break off
    // past the target, then swing back for another strafing pass.
    const agl = unit.flight.agl || 0;
    const closing = dist > brain.preferred * 0.6;
    if (!closing) brain.breakT = 2.2;
    brain.breakT = Math.max(0, (brain.breakT || 0) - dt);
    const want = brain.breakT > 0 ? 24 : closing && dist > brain.preferred * 1.4 ? 22 : 13;
    climb = Math.max(-1, Math.min(1, (want - agl) / 6));
    throttle = 1;
    strafe = 0;
    if (brain.breakT > 0) face += brain.flank * 1.1;
  }
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
  // Pilot scatter: a wandering offset sized by aimError per 100 m of range.
  brain.jitterT -= dt;
  if (brain.jitterT <= 0) {
    const r = brain.rng || Math.random;
    brain.jitterT = 0.6;
    brain.jx = (r() * 2 - 1);
    brain.jy = (r() * 2 - 1) * 0.5;
    brain.jz = (r() * 2 - 1);
  }
  const scatter = brain.aimError * (dist / 100);
  // Loose aim gate. The mission compares the chassis forward to the target.
  unit.cmd = {
    throttle,
    strafe,
    yaw: face,
    climb,
    fire: dist < maxRange * 0.98,
    skill: useSkill,
    aim: {
      x: tx + brain.jx * scatter,
      y: target.model.root.position.y + (target.def.radius || 2) * 0.45 + brain.jy * scatter,
      z: tz + brain.jz * scatter,
    },
  };
}
