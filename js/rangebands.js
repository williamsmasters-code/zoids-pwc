// Range increments: which band a distance falls in, and what that band does
// to damage, spread and AI aim error. Data: RANGE_PROFILES and the per-weapon
// minRange / optimal / longRange / range fields in js/catalog.js.
// Distances are 3D (flyers included). Works on top of the armour multipliers
// (DAMAGE_VS_ARMOR): damage = base x band damage x armour/internal mul.
import { RANGE_PROFILES } from "./catalog.js";

export const BANDS = ["short", "ideal", "long", "extreme"];

export function rangeClassOf(weapon) {
  if (!weapon) return "beam";
  if (weapon.kind === "melee") return "melee";
  if (weapon.delivery === "rocket" || weapon.kind === "missile") return "missile";
  if (weapon.kind === "energy") return "beam";
  return "ballistic";
}

export function profileOf(weapon) {
  return RANGE_PROFILES[rangeClassOf(weapon)];
}

// "short" | "ideal" | "long" | "extreme" | "out"
export function bandOf(weapon, distance) {
  const d = Math.max(0, Number(distance) || 0);
  const max = weapon.range;
  if (d > max) return "out";
  if (rangeClassOf(weapon) === "melee") return "ideal";
  if (weapon.minRange && d < weapon.minRange) return "short";
  if (d <= weapon.optimal) return "ideal";
  if (d <= (weapon.longRange ?? max)) return "long";
  return "extreme";
}

export function rangeDamageMul(weapon, distance) {
  const band = bandOf(weapon, distance);
  if (band === "out") return 0;
  return profileOf(weapon).damage[band];
}

export function rangeSpreadMul(weapon, distance) {
  const band = bandOf(weapon, distance);
  return profileOf(weapon).spread[band === "out" ? "extreme" : band];
}

export function rangeAimMul(weapon, distance) {
  const band = bandOf(weapon, distance);
  return profileOf(weapon).aim[band === "out" ? "extreme" : band];
}

export function rangeLockMul(weapon, distance) {
  const lock = profileOf(weapon).lock;
  if (!lock) return 1;
  const band = bandOf(weapon, distance);
  return lock[band === "out" ? "extreme" : band];
}

// Paper hit chance used by tools/balance_report.mjs: base class hit factor
// divided by spread^0.6 (x2.5 spread -> 58% of base, x5 -> 38%).
export function hitChanceMul(weapon, distance) {
  return 1 / Math.pow(rangeSpreadMul(weapon, distance), 0.6);
}

export function bandText(weapon) {
  if (rangeClassOf(weapon) === "melee") return `melee 0-${weapon.range} m only`;
  const parts = [];
  if (weapon.minRange) parts.push(`short <${weapon.minRange}`);
  parts.push(`ideal ${weapon.minRange || 0}-${weapon.optimal}`);
  parts.push(`long -${weapon.longRange}`);
  parts.push(`extreme -${weapon.range} m`);
  return parts.join(" · ");
}
