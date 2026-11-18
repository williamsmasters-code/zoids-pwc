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

// Continuous curve through the profile values (see RANGE_PROFILES):
// short at 0 m ramping to ideal at minRange (flat for shortFlat profiles),
// ideal to optimal, then straight lines to long at longRange and extreme at
// max range. null past max range.
export function rangeCurve(weapon, distance, table, shortFlat = false) {
  const d = Math.max(0, Number(distance) || 0);
  const max = weapon.range;
  if (d > max) return null;
  if (rangeClassOf(weapon) === "melee") return table.ideal;
  const minR = weapon.minRange || 0;
  if (minR && d < minR) return shortFlat ? table.short : table.short + (table.ideal - table.short) * (d / minR);
  const opt = weapon.optimal;
  // Skill shots carry no bands: full damage out to their range.
  if (opt == null || d <= opt) return table.ideal;
  const long = weapon.longRange ?? max;
  if (d <= long) return table.ideal + (table.long - table.ideal) * ((d - opt) / Math.max(1e-6, long - opt));
  return table.long + (table.extreme - table.long) * ((d - long) / Math.max(1e-6, max - long));
}

export function rangeDamageMul(weapon, distance) {
  const p = profileOf(weapon);
  const v = rangeCurve(weapon, distance, p.damage, !!p.shortFlat);
  return v == null ? 0 : v;
}

export function rangeSpreadMul(weapon, distance) {
  const p = profileOf(weapon);
  const v = rangeCurve(weapon, distance, p.spread, !!p.shortFlat);
  return v == null ? p.spread.extreme : v;
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
