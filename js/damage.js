// Per-part armor, structure, and the degradation that falls out of them.
// Pure data in, pure data out. The sim and the unit tests both call this.

import {
  PART_BASE,
  PART_LABELS,
  ARMOR_LEVEL_BONUS,
  partListFor,
} from "./catalog.js";

import { tonnageZone } from "./tonnage.js";

export function createParts(def, armorLevels = {}) {
  const parts = {};
  for (const id of partListFor(def)) {
    const base = PART_BASE[id];
    if (!base) throw new Error(`No part budget for ${id}`);
    const level = armorLevels[id] || 0;
    const maxArmor = base.armor * def.armorScale * (1 + ARMOR_LEVEL_BONUS * level);
    const maxStructure = base.structure * def.armorScale;
    parts[id] = {
      id,
      label: PART_LABELS[id] || id,
      maxArmor,
      armor: maxArmor,
      maxStructure,
      structure: maxStructure,
      destroyed: false,
      level,
    };
  }
  return parts;
}

export function partRatio(part) {
  if (!part) return 0;
  const max = part.maxArmor + part.maxStructure;
  if (max <= 0) return 0;
  return Math.max(0, (part.armor + part.structure) / max);
}

export function partColor(part) {
  if (!part || part.destroyed || part.structure <= 0) return "#141414";
  const r = partRatio(part);
  if (r > 0.72) return "#3dff7a";
  if (r > 0.45) return "#e6d23a";
  if (r > 0.18) return "#ff8a2a";
  return "#ff3344";
}

export function legIds(layout) {
  if (layout === "quad") return ["leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg"];
  if (layout === "biped") return ["leftLeg", "rightLeg"];
  return [];
}

export function mobilityFromParts(parts, layout) {
  const ids = legIds(layout);
  if (!ids.length) return { speedMul: 1, turnMul: 1, avg: 1, asymmetry: 0 };
  let sum = 0;
  for (const id of ids) sum += partRatio(parts[id]);
  const avg = sum / ids.length;
  const speedMul = 0.2 + 0.8 * avg;
  let asymmetry = 0;
  if (layout === "quad") {
    asymmetry = (
      Math.abs(partRatio(parts.leftFrontLeg) - partRatio(parts.rightFrontLeg))
      + Math.abs(partRatio(parts.leftRearLeg) - partRatio(parts.rightRearLeg))
    ) * 0.5;
  } else {
    asymmetry = Math.abs(partRatio(parts.leftLeg) - partRatio(parts.rightLeg));
  }
  const turnMul = Math.max(0.12, speedMul * (1 - 0.55 * asymmetry));
  return { speedMul, turnMul, avg, asymmetry };
}

export function sensorsFromHead(head) {
  if (!head) return { rangeMul: 1, scramble: 0, radar: true };
  if (head.destroyed || head.structure <= 0) {
    return { rangeMul: 0.25, scramble: 1, radar: false };
  }
  const armorR = head.maxArmor > 0 ? head.armor / head.maxArmor : 1;
  const structR = head.maxStructure > 0 ? head.structure / head.maxStructure : 1;
  const scramble = Math.max(0, Math.min(1, (1 - structR) * 0.9 + (1 - armorR) * 0.12));
  const rangeMul = Math.max(0.25, Math.min(1, 0.3 + 0.7 * (0.35 * armorR + 0.65 * structR)));
  return { rangeMul, scramble, radar: structR > 0.2 };
}

export function derivePerformance(def, mods, parts, weight) {
  const mobility = mobilityFromParts(parts, def.layout);
  const sensors = sensorsFromHead(parts.head);
  const over = Math.max(0, weight - def.maxTonnage);
  const load = tonnageZone(weight || 0, def.maxTonnage);
  const overMul = load.speedMul;
  const speed = def.speed * (1 + 0.08 * ((mods && mods.speed) || 0)) * mobility.speedMul * load.speedMul;
  const turn = def.turn * (1 + 0.1 * ((mods && mods.maneuver) || 0)) * mobility.turnMul * load.turnMul;
  const back = parts.backMount;
  const boosterInstalled = ((mods && mods.booster) || 0) > 0;
  const boosterReady = boosterInstalled && !!back && !back.destroyed && back.structure > 0;
  const backR = back ? partRatio(back) : 0;
  const boostMul = boosterReady ? (1.28 + 0.1 * mods.booster) * (0.6 + 0.4 * backR) : 1;
  return {
    speed,
    turn,
    boostMul,
    boosterInstalled,
    boosterReady,
    sensors,
    mobility,
    overweight: over > 0,
    overTons: over,
    overMul,
    load,
    accelMul: load.accelMul,
    coolMul: load.coolMul,
  };
}

export function livingWeapons(weapons, parts) {
  return weapons.filter((w) => {
    const part = parts[w.mount];
    return part && !part.destroyed && part.structure > 0;
  });
}

function damagePart(parts, partId, amount, ctx, events) {
  const part = parts[partId];
  if (!part || part.destroyed || part.structure <= 0) {
    if (partId !== "core" && parts.core && !parts.core.destroyed) {
      events.push({ type: "transfer", from: partId, to: "core" });
      damagePart(parts, "core", amount * 0.5, { ...ctx, transferred: true }, events);
    }
    return;
  }
  let left = amount;
  const armorTake = Math.min(part.armor, left);
  part.armor -= armorTake;
  left -= armorTake;
  if (armorTake > 0 && part.armor <= 0) events.push({ type: "armorGone", partId });
  if (left <= 0) return;
  const structBefore = part.structure;
  part.structure -= left;
  if (part.structure <= 0) {
    const excess = -part.structure;
    part.structure = 0;
    part.destroyed = true;
    events.push({ type: "destroyed", partId });
    if (partId === "core") events.push({ type: "kill" });
    else if (excess > 0 && parts.core && !parts.core.destroyed) {
      damagePart(parts, "core", excess * 0.4, { ...ctx, transferred: true }, events);
    }
    return;
  }
  if (structBefore >= part.maxStructure - 0.0001) events.push({ type: "structure", partId });
  else if (part.structure < part.maxStructure * 0.35) events.push({ type: "critical", partId });
}

export function applyHit(parts, partId, amount, ctx = {}) {
  const events = [];
  let amt = amount;
  if (!ctx.transferred && ctx.zoidId === "shieldLiger" && (ctx.forwardDot || 0) > 0.35) {
    const leg = parts.leftFrontLeg;
    if (leg && !leg.destroyed && leg.structure > 0) {
      const reduced = amt * 0.7;
      events.push({ type: "shield", reduced: amt - reduced });
      amt = reduced;
    }
  }
  damagePart(parts, partId, amt, ctx, events);
  const killed = !!(parts.core && (parts.core.destroyed || parts.core.structure <= 0));
  return { events, killed };
}

export function isCoreDestroyed(parts) {
  return !!(parts.core && (parts.core.destroyed || parts.core.structure <= 0));
}

export function repairCost(parts) {
  let cost = 0;
  for (const part of Object.values(parts)) {
    const armorMissing = Math.max(0, part.maxArmor - part.armor);
    const structMissing = Math.max(0, part.maxStructure - part.structure);
    cost += armorMissing * 28 + structMissing * 95;
    if (part.destroyed) cost += 650;
  }
  if (parts.core && parts.core.destroyed) cost += 12000;
  return Math.round(cost);
}

export function repairAll(parts) {
  for (const part of Object.values(parts)) {
    part.armor = part.maxArmor;
    part.structure = part.maxStructure;
    part.destroyed = false;
  }
  return parts;
}

export function serializeParts(parts) {
  const out = {};
  for (const [id, part] of Object.entries(parts)) {
    out[id] = {
      armor: part.armor,
      structure: part.structure,
      destroyed: part.destroyed,
      maxArmor: part.maxArmor,
      maxStructure: part.maxStructure,
      label: part.label,
      id,
    };
  }
  return out;
}

export function applyCondition(parts, condition) {
  if (!condition) return parts;
  for (const [id, saved] of Object.entries(condition)) {
    const part = parts[id];
    if (!part || !saved) continue;
    part.armor = Math.max(0, Math.min(part.maxArmor, saved.armor));
    part.structure = Math.max(0, Math.min(part.maxStructure, saved.structure));
    part.destroyed = !!saved.destroyed || part.structure <= 0;
    if (part.destroyed) part.structure = 0;
  }
  return parts;
}

export function describeDegradation(parts, perf) {
  const notes = [];
  if (!perf) return notes;
  if (perf.mobility.speedMul < 0.98) {
    notes.push(`Leg damage cuts speed to ${Math.round(perf.mobility.speedMul * 100)}%.`);
  }
  if (perf.mobility.turnMul < perf.mobility.speedMul - 0.04) {
    notes.push(`Uneven legs cut turn to ${Math.round(perf.mobility.turnMul * 100)}%.`);
  }
  if (perf.sensors.scramble >= 0.99) {
    notes.push("Head destroyed. Radar is offline, the HUD scrambles, and target range collapses.");
  } else if (perf.sensors.scramble > 0.18) {
    notes.push("Head damage. Targeting range is down and the HUD is unstable.");
  }
  const mounts = [
    ["headWeapon", "Head mount"],
    ["leftWeapon", "Left mount"],
    ["rightWeapon", "Right mount"],
    ["backMount", "Back mount"],
  ];
  for (const [id, label] of mounts) {
    if (parts[id] && parts[id].destroyed) notes.push(`${label} destroyed. Weapons on it are dead.`);
  }
  if (perf.boosterInstalled && !perf.boosterReady) notes.push("Boosters offline. The back mount is gone.");
  if (parts.core && parts.core.destroyed) notes.push("Core destroyed. This Zoid is down.");
  else if (parts.core && parts.core.structure < parts.core.maxStructure - 0.01) {
    notes.push("Core structure is open. Another core kill destroys the Zoid.");
  }
  return notes;
}
