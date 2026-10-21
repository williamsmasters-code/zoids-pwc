#!/usr/bin/env node
// Paper DPS / time-to-kill comparison for the stock loadouts.
//   node tools/balance_report.mjs [path/to/catalog.js]
// Defaults to js/catalog.js. Pass an older copy to compare before/after.
//
// Model (deliberately simple, same for both versions):
//   burst DPS     damage * volley * rate (charge: damage / (chargeTime + 1/rate))
//   sustained DPS burst * min(1, cooling / (heat * rate))  (per-weapon heat gauge)
//   hit factor    beam .85, ballistic .65, rocket .9 (locked), charge .9, melee .75
//   effective     sustained * hit factor, counted only if the weapon reaches
//                 the engagement range
//   coreEHP       (armor + structure) of core * armorScale
//   TTK           enemy coreEHP * 1.6 / effective DPS (1.6 = hits spread over parts)
import path from "node:path";
import { pathToFileURL } from "node:url";

const file = path.resolve(process.argv[2] || new URL("../js/catalog.js", import.meta.url).pathname);
const cat = await import(pathToFileURL(file).href);
const { WEAPONS, ZOIDS, ZOID_ORDER, PART_BASE, stockWeaponsFor } = cat;
// Damage class vs armour (absent in older catalogs: treated as x1).
const VS = cat.DAMAGE_VS_ARMOR || {};
const classOf = cat.damageClassOf || (() => null);
const mulOf = (w, key) => (VS[classOf(w)] ? VS[classOf(w)][key] : 1);
const HIT = { beam: 0.85, ballistic: 0.65, rocket: 0.9, charge: 0.9, melee: 0.75 };
const RANGES = [10, 30, 60, 120, 200];
// Range bands (js/rangebands.js) when the catalog has them; otherwise the old
// linear falloff (full to optimal, 30% at max) so older catalogs still compare.
const bands = cat.RANGE_PROFILES ? await import(new URL("../js/rangebands.js", import.meta.url).href) : null;
function rangeFactor(w, r) {
  if (r > w.range) return 0;
  if (bands && w.longRange != null) return bands.rangeDamageMul(w, r) * bands.hitChanceMul(w, r);
  if (w.minRange && r < w.minRange) return 0;
  return r <= w.optimal ? 1 : 1 - 0.7 * (r - w.optimal) / (w.range - w.optimal);
}

function weaponStats(w) {
  const vol = w.volley || 1;
  const burst = w.chargeTime ? w.damage / (w.chargeTime + 1 / w.rate) : w.damage * vol * w.rate;
  const heatPerSec = w.chargeTime ? w.heat / (w.chargeTime + 1 / w.rate) : (w.heat || 0) * w.rate;
  const sustain = burst * Math.min(1, (w.cooling || 12) / Math.max(1e-6, heatPerSec));
  const hit = HIT[w.kind === "melee" ? "melee" : w.delivery] || 0.8;
  return { burst, sustain, hit, heatPerSec };
}

function zoidStats(id) {
  const def = ZOIDS[id];
  const loadout = stockWeaponsFor(def, () => 0.9).map((s) => {
    const hard = (def.hardpoints || []).find((h) => h.id === s.mount);
    const w = WEAPONS[s.type];
    const turret = s.mount === "backMount" && !w.chargeTime && (w.turret || (hard && hard.turret));
    return { ...w, mount: s.mount, turret: !!turret };
  });
  const core = (PART_BASE.core.armor + PART_BASE.core.structure) * def.armorScale;
  const byRange = {};
  const vsArmor = {};
  const vsInternal = {};
  for (const r of RANGES) {
    const sum = (key) => loadout.reduce((acc, w) => {
      const st = weaponStats(w);
      const fall = rangeFactor(w, r);
      return acc + st.sustain * st.hit * fall * mulOf(w, key);
    }, 0);
    vsArmor[r] = sum("armor");
    vsInternal[r] = sum("internal");
  }
  for (const r of RANGES) {
    byRange[r] = loadout.reduce((sum, w) => {
      const s = weaponStats(w);
      const fall = rangeFactor(w, r);
      return sum + s.sustain * s.hit * fall;
    }, 0);
  }
  const burst = loadout.reduce((s, w) => s + weaponStats(w).burst, 0);
  return { id, def, loadout, core, byRange, vsArmor, vsInternal, burst, maxRange: Math.max(...loadout.map((w) => w.range)) };
}

const rows = ZOID_ORDER.map(zoidStats);
// Armour half of the core EHP is chewed at the vs-armour rate, the structure
// half at the vs-component rate (same 1.6 spread factor as before).
function ttk(a, b) {
  const armor = PART_BASE.core.armor * b.def.armorScale * 1.6;
  const struct = PART_BASE.core.structure * b.def.armorScale * 1.6;
  if (!(a.vsArmor[60] > 0) || !(a.vsInternal[60] > 0)) return Infinity;
  return armor / a.vsArmor[60] + struct / a.vsInternal[60];
}
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6, d = 1) => v.toFixed(d).padStart(n);
console.log(`catalog: ${path.relative(process.cwd(), file)}`);
console.log("WEAPONS");
console.log(pad("id", 20) + "dmg  vol  rate  burstDPS  heat/s  cool  sustDPS  opt  range  speed lock");
for (const [id, w] of Object.entries(WEAPONS)) {
  const s = weaponStats(w);
  console.log(pad(id, 20) + num(w.damage, 4, 0) + num(w.volley || 1, 5, 0) + num(w.rate, 6, 2) + num(s.burst, 10) + num(s.heatPerSec, 8) + num(w.cooling || 12, 6, 0) + num(s.sustain, 9) + num(w.optimal, 5, 0) + num(w.range, 7, 0) + num(w.speed || 0, 7, 0) + num(w.lockTime || 0, 5, 1));
}
if (bands) {
  console.log("\nPER-WEAPON EFFECTIVE DPS by range (sustained x class hit x band damage x band hit chance)");
  console.log(pad("weapon", 20) + pad("class", 10) + RANGES.map((r) => pad(`@${r}`, 8)).join("") + "  bands");
  for (const [id, w] of Object.entries(WEAPONS)) {
    const st = weaponStats(w);
    console.log(pad(id, 20) + pad(bands.rangeClassOf(w), 10) + RANGES.map((r) => pad((st.sustain * st.hit * rangeFactor(w, r)).toFixed(1), 8)).join("") + "  " + bands.bandText(w));
  }
}
console.log(`\nZOIDS (stock loadout; effective DPS = sustained x hit factor x range factor, at ${RANGES.join(" / ")} m)`);
console.log(pad("zoid", 14) + "speed  coreEHP  burst" + RANGES.map((r) => pad(`  eff@${r}`, 9)).join("") + "  maxRange  loadout");
for (const r of rows) {
  console.log(pad(r.id, 14) + num(r.def.speed, 5, 0) + num(r.core, 9) + num(r.burst, 7) + RANGES.map((x) => num(r.byRange[x], 9)).join("") + num(r.maxRange, 10, 0) + "  " + r.loadout.map((w) => w.id + (w.turret ? "(T)" : "")).join(", "));
}
console.log("\nDAMAGE CLASS vs ARMOUR (armour x / component x)");
for (const [id, w] of Object.entries(WEAPONS)) {
  console.log(pad(id, 20) + pad(classOf(w) || "-", 10) + num(mulOf(w, "armor"), 5, 2) + num(mulOf(w, "internal"), 6, 2));
}
console.log("\nEFFECTIVE DPS at 60 m: raw (no class mods) / vs armour plating / vs exposed components");
console.log(pad("zoid", 14) + "   raw  armour  comps");
for (const r of rows) {
  console.log(pad(r.id, 14) + num(r.byRange[60], 6) + num(r.vsArmor[60], 8) + num(r.vsInternal[60], 7));
}
console.log("\nTTK matrix at 60 m, seconds (row attacks column)");
console.log(pad("", 14) + rows.map((r) => pad(r.id.slice(0, 9), 10)).join(""));
for (const a of rows) {
  console.log(pad(a.id, 14) + rows.map((b) => pad(ttk(a, b).toFixed(1), 10)).join(""));
}
