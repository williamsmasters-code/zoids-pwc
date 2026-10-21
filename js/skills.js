// One passive and one active skill per playable Zoid. Q triggers the active.
// Numbers live here so the hangar, the HUD, and the tests read the same data.

import { ZOIDS, ZOID_ORDER } from "./catalog.js";

export const SKILLS = {
  commandWolf: {
    passive: {
      name: "Pack Sensors",
      blurb: "Radar and target lock reach 35% farther, and HUD scramble is cut by a third.",
      radarMul: 1.35,
      scrambleMul: 0.67,
    },
    active: {
      name: "Sensor Lock",
      key: "Q",
      kind: "duration",
      blurb: "For 6 seconds, radar and target lock reach twice as far again.",
      cost: "cooldown 14s",
      duration: 6,
      cooldown: 14,
      radarMul: 2,
    },
  },
  zaberFang: {
    passive: {
      name: "Predator Stride",
      blurb: "Top speed is 12% higher.",
      speedMul: 1.12,
    },
    active: {
      name: "Speed Burst",
      key: "Q",
      kind: "duration",
      blurb: "For 4 seconds, speed is multiplied by 1.55.",
      cost: "cooldown 9s",
      duration: 4,
      cooldown: 9,
      speedMul: 1.55,
    },
  },
  shieldLiger: {
    passive: {
      name: "Shield Plate",
      blurb: "While the left foreleg stands, hits from the front arc deal 70% damage.",
    },
    active: {
      name: "Energy Shield",
      key: "Q",
      kind: "toggle-heat",
      blurb: "Toggle a frontal energy shield. It blocks all damage from the front arc. Heat rises while it is up and the shield locks when the gauge maxes, until it cools below 55. Weapons cannot fire while it is up.",
      cost: "heat 36/s, lockout until below 55 plus 2.5s",
      blocksFire: true,
      arc: 0.35,
      heatPerSec: 36,
      coolPerSec: 16,
      unlock: 55,
      lockout: 2.5,
    },
  },
  bladeLiger: {
    passive: {
      name: "Blade Tempo",
      blurb: "While moving faster than 8 m/s, incoming damage is reduced by 12%.",
      swift: { speed: 8, mul: 0.88 },
    },
    active: {
      name: "Laser Blade",
      key: "Q",
      kind: "dash",
      blurb: "Dash 18 m forward and slash a front cone for 32 damage.",
      cost: "cooldown 7s",
      cooldown: 7,
      dash: 18,
      range: 10,
      slash: 32,
      arc: 0.35,
    },
  },
  ironKong: {
    passive: {
      name: "Plate Armor",
      blurb: "Incoming damage is reduced by 10%.",
      incomingMul: 0.9,
    },
    active: {
      name: "Ground Pound",
      key: "Q",
      kind: "slam",
      blurb: "Slam for 24 damage within 12 m, then take 20% less damage for 4 seconds.",
      cost: "cooldown 11s",
      cooldown: 11,
      duration: 4,
      radius: 12,
      damage: 24,
      incomingMul: 0.8,
    },
  },
  genoSaurer: {
    passive: {
      name: "Particle Vent",
      blurb: "Energy weapons cool 30% faster.",
      energyCoolMul: 1.3,
    },
    active: {
      name: "Particle Cannon",
      key: "Q",
      kind: "cannon",
      blurb: "Instant bolt for 70 damage out to 160 m. Q is a tap, so this is not the mounted cannon's 3 second stationary charge.",
      cost: "70 skill heat, locked until below 40, cooldown 4s",
      cooldown: 4,
      damage: 70,
      range: 160,
      heatCost: 70,
      unlock: 40,
      coolPerSec: 12,
      color: 0xd56bff,
    },
  },
  gojulas: {
    passive: {
      name: "Siege Brace",
      blurb: "Below 6 m/s, incoming damage is cut by 15% and weapon spread tightens.",
      braced: { speed: 6, incomingMul: 0.85, spreadMul: 0.6 },
    },
    active: {
      name: "Artillery Barrage",
      key: "Q",
      kind: "barrage",
      blurb: "Launch 5 shells at the aim point for 16 damage each.",
      cost: "cooldown 12s",
      cooldown: 12,
      shots: 5,
      damage: 16,
      range: 150,
      speed: 62,
      color: 0xffcc66,
    },
  },
  deathSaurer: {
    passive: {
      name: "Super Heavy Frame",
      blurb: "Incoming damage is reduced by 18%.",
      incomingMul: 0.82,
    },
    active: {
      name: "Overload",
      key: "Q",
      kind: "duration",
      blurb: "For 6 seconds weapons hit 40% harder and build heat 50% faster, and incoming damage drops a further 15%.",
      cost: "cooldown 10s",
      duration: 6,
      cooldown: 10,
      damageMul: 1.4,
      heatMul: 1.5,
      incomingMul: 0.85,
    },
  },
  gunSniper: {
    passive: {
      name: "Sniper Optics",
      blurb: "Radar and target lock reach 25% farther.",
      radarMul: 1.25,
    },
    active: {
      name: "Steady Aim",
      key: "Q",
      kind: "duration",
      blurb: "For 5 seconds, weapons hit 30% harder.",
      cost: "cooldown 12s",
      duration: 5,
      cooldown: 12,
      damageMul: 1.3,
    },
  },
  elephander: {
    passive: {
      name: "Elephant Hide",
      blurb: "Incoming damage is reduced by 14%.",
      incomingMul: 0.86,
    },
    active: {
      name: "Stampede",
      key: "Q",
      kind: "slam",
      blurb: "Stamp for 30 damage within 14 m, then take 20% less damage for 4 seconds.",
      cost: "cooldown 12s",
      cooldown: 12,
      duration: 4,
      radius: 14,
      damage: 30,
      incomingMul: 0.8,
    },
  },
  berserkFuhrer: {
    passive: {
      name: "Berserk Drive",
      blurb: "Top speed is 8% higher.",
      speedMul: 1.08,
    },
    active: {
      name: "Buster Claw Charge",
      key: "Q",
      kind: "dash",
      blurb: "Dash 16 m forward and rake a front cone with both Buster Claws for 36 damage.",
      cost: "cooldown 8s",
      cooldown: 8,
      dash: 16,
      range: 10,
      slash: 36,
      arc: 0.35,
    },
  },
  molga: {
    passive: {
      name: "Segmented Armor",
      blurb: "Below 6 m/s, incoming damage is cut by 15% and weapon spread tightens.",
      braced: { speed: 6, incomingMul: 0.85, spreadMul: 0.6 },
    },
    active: {
      name: "Ram",
      key: "Q",
      kind: "dash",
      blurb: "Charge 14 m forward and ram a front cone for 26 damage.",
      cost: "cooldown 9s",
      cooldown: 9,
      dash: 14,
      range: 8,
      slash: 26,
      arc: 0.4,
    },
  },
  pteras: {
    passive: {
      name: "Sky Eye",
      blurb: "Radar and target lock reach 30% farther, and HUD scramble is cut by a quarter.",
      radarMul: 1.3,
      scrambleMul: 0.75,
    },
    active: {
      name: "Bombing Run",
      key: "Q",
      kind: "barrage",
      blurb: "Drop 4 bombs at the aim point for 14 damage each.",
      cost: "cooldown 11s",
      cooldown: 11,
      shots: 4,
      damage: 14,
      range: 120,
      speed: 55,
      color: 0xffaa33,
    },
  },
};

export function skillOf(zoidId) {
  return SKILLS[zoidId] || null;
}

export function initSkill(zoidId) {
  if (!SKILLS[zoidId]) return null;
  return { heat: 0, overheated: false, cooldown: 0, active: false, timer: 0 };
}

export function weaponsLocked(unit) {
  const spec = SKILLS[unit?.def?.id];
  return !!(spec && spec.active.blocksFire && unit.skill && unit.skill.active);
}

export function shieldBlocks(unit, forwardDot) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || spec.active.kind !== "toggle-heat" || !unit.skill?.active) return false;
  return (forwardDot || 0) > (spec.active.arc ?? 0.35);
}

export function skillSpeedMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec) return 1;
  let mul = spec.passive.speedMul || 1;
  if (unit.skill?.active && spec.active.speedMul) mul *= spec.active.speedMul;
  return mul;
}

export function radarMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec) return 1;
  let mul = spec.passive.radarMul || 1;
  if (unit.skill?.active && spec.active.radarMul) mul *= spec.active.radarMul;
  return mul;
}

export function scrambleMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !spec.passive.scrambleMul) return 1;
  return spec.passive.scrambleMul;
}

export function energyCoolMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  return spec?.passive?.energyCoolMul || 1;
}

export function heatGenMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !unit.skill?.active || !spec.active.heatMul) return 1;
  return spec.active.heatMul;
}

export function damageMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !unit.skill?.active || !spec.active.damageMul) return 1;
  return spec.active.damageMul;
}

export function spreadMul(unit) {
  const spec = SKILLS[unit?.def?.id];
  const braced = spec?.passive?.braced;
  if (!braced || !braced.spreadMul) return 1;
  if (Math.abs(unit.speed || 0) >= braced.speed) return 1;
  return braced.spreadMul;
}

export function incomingFactor(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec) return 1;
  let mul = spec.passive.incomingMul || 1;
  const speed = Math.abs(unit.speed || 0);
  if (spec.passive.swift && speed > spec.passive.swift.speed) mul *= spec.passive.swift.mul;
  if (spec.passive.braced && speed < spec.passive.braced.speed) mul *= spec.passive.braced.incomingMul;
  if (unit.skill?.active && spec.active.incomingMul) mul *= spec.active.incomingMul;
  return mul;
}

export function resolveIncoming(unit, amount, forwardDot) {
  if (shieldBlocks(unit, forwardDot)) return { amount: 0, blocked: true, factor: 0 };
  const factor = incomingFactor(unit);
  return { amount: amount * factor, blocked: false, factor };
}

export function tickSkill(unit, dt) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !unit.skill) return null;
  const skill = unit.skill;
  const active = spec.active;
  if (skill.cooldown > 0) skill.cooldown = Math.max(0, skill.cooldown - dt);
  if (active.kind === "toggle-heat" && skill.active) {
    skill.heat = Math.min(100, skill.heat + active.heatPerSec * dt);
    if (skill.heat >= 100 - 1e-6) {
      skill.heat = 100;
      skill.active = false;
      skill.overheated = true;
      skill.cooldown = Math.max(skill.cooldown, active.lockout || 0);
      return { type: "lockout" };
    }
    return null;
  }
  if (active.coolPerSec && skill.heat > 0) {
    skill.heat = Math.max(0, skill.heat - active.coolPerSec * dt);
  }
  if (skill.overheated && skill.heat <= (active.unlock ?? 55) && skill.cooldown <= 0) {
    skill.overheated = false;
  }
  if (skill.active && skill.timer > 0) {
    skill.timer = Math.max(0, skill.timer - dt);
    if (skill.timer <= 0) skill.active = false;
  }
  return null;
}

export function activateSkill(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !unit.skill || !unit.alive) return { ok: false, reason: "none" };
  const skill = unit.skill;
  const active = spec.active;
  if (active.kind === "toggle-heat") {
    if (skill.active) {
      skill.active = false;
      return { ok: true, type: "shield-off" };
    }
    if (skill.overheated || skill.cooldown > 0) return { ok: false, reason: "locked" };
    skill.active = true;
    return { ok: true, type: "shield-on" };
  }
  if (skill.overheated) return { ok: false, reason: "locked" };
  if (skill.cooldown > 0 || skill.active) return { ok: false, reason: "cooldown" };
  if (active.kind === "duration" || active.kind === "slam") {
    skill.active = true;
    skill.timer = active.duration || 0;
    skill.cooldown = active.cooldown || 0;
    return { ok: true, type: active.kind, spec: active };
  }
  if (active.kind === "dash" || active.kind === "barrage") {
    skill.cooldown = active.cooldown || 0;
    return { ok: true, type: active.kind, spec: active };
  }
  if (active.kind === "cannon") {
    skill.cooldown = active.cooldown || 0;
    skill.heat = Math.min(100, skill.heat + (active.heatCost || 0));
    if (skill.heat >= 100 - 1e-6) {
      skill.heat = 100;
      skill.overheated = true;
    }
    return { ok: true, type: "cannon", spec: active };
  }
  return { ok: false, reason: "unknown" };
}

export function skillHud(unit) {
  const spec = SKILLS[unit?.def?.id];
  if (!spec || !unit.skill) return null;
  const skill = unit.skill;
  const active = spec.active;
  let state = "ready";
  let pct = 0;
  if (skill.overheated) {
    state = "locked";
    pct = skill.heat;
  } else if (skill.active) {
    state = "active";
    if (active.kind === "toggle-heat") pct = skill.heat;
    else if (active.duration) pct = (skill.timer / active.duration) * 100;
    else pct = skill.heat;
  } else if (skill.cooldown > 0) {
    state = "cooling";
    pct = active.cooldown ? (1 - skill.cooldown / active.cooldown) * 100 : 0;
  }
  return {
    name: active.name,
    passive: spec.passive.name,
    key: active.key || "Q",
    state,
    heat: Math.round(skill.heat),
    cooldown: skill.cooldown,
    pct: Math.max(0, Math.min(100, pct)),
    hold: active.blocksFire && skill.active ? "Weapons cannot fire — shield is up" : "",
    cost: active.cost,
  };
}

export function skillBlock(zoidId) {
  const spec = SKILLS[zoidId];
  const zoid = ZOIDS[zoidId];
  if (!spec || !zoid) return "";
  return `<div class="skill-list" id="skill-list" data-zoid="${zoidId}">
    <h3>Skills</h3>
    <p data-kind="passive" data-name="${spec.passive.name}"><b>Passive</b> ${spec.passive.name}<small>${spec.passive.blurb}</small></p>
    <p data-kind="active" data-name="${spec.active.name}"><b>Active Q</b> ${spec.active.name}<small>${spec.active.blurb} Cost: ${spec.active.cost}.</small></p>
  </div>`;
}

export function skillHelpItems() {
  return ZOID_ORDER.map((id) => {
    const spec = SKILLS[id];
    const name = ZOIDS[id].name;
    return `${name} — passive ${spec.passive.name}: ${spec.passive.blurb} Active ${spec.active.name} (Q): ${spec.active.blurb} Cost: ${spec.active.cost}.`;
  });
}
