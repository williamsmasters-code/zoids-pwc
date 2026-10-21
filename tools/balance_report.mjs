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
const HIT = { beam: 0.85, ballistic: 0.65, rocket: 0.9, charge: 0.9, melee: 0.75 };
const RANGES = [10, 60, 120];

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
  for (const r of RANGES) {
    byRange[r] = loadout.reduce((sum, w) => {
      if (w.range < r || (w.minRange && r < w.minRange)) return sum;
      const s = weaponStats(w);
      const fall = r <= w.optimal ? 1 : 1 - 0.7 * (r - w.optimal) / (w.range - w.optimal);
      return sum + s.sustain * s.hit * fall;
    }, 0);
  }
  const burst = loadout.reduce((s, w) => s + weaponStats(w).burst, 0);
  return { id, def, loadout, core, byRange, burst, maxRange: Math.max(...loadout.map((w) => w.range)) };
}

const rows = ZOID_ORDER.map(zoidStats);
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6, d = 1) => v.toFixed(d).padStart(n);
console.log(`catalog: ${path.relative(process.cwd(), file)}`);
console.log("WEAPONS");
console.log(pad("id", 20) + "dmg  vol  rate  burstDPS  heat/s  cool  sustDPS  opt  range  speed lock");
for (const [id, w] of Object.entries(WEAPONS)) {
  const s = weaponStats(w);
  console.log(pad(id, 20) + num(w.damage, 4, 0) + num(w.volley || 1, 5, 0) + num(w.rate, 6, 2) + num(s.burst, 10) + num(s.heatPerSec, 8) + num(w.cooling || 12, 6, 0) + num(s.sustain, 9) + num(w.optimal, 5, 0) + num(w.range, 7, 0) + num(w.speed || 0, 7, 0) + num(w.lockTime || 0, 5, 1));
}
console.log("\nZOIDS (stock loadout; effective DPS = sustained x hit factor x falloff, at 10 / 60 / 120 m)");
console.log(pad("zoid", 14) + "speed  coreEHP  burst  eff@10  eff@60  eff@120  maxRange  loadout");
for (const r of rows) {
  console.log(pad(r.id, 14) + num(r.def.speed, 5, 0) + num(r.core, 9) + num(r.burst, 7) + num(r.byRange[10], 8) + num(r.byRange[60], 8) + num(r.byRange[120], 9) + num(r.maxRange, 10, 0) + "  " + r.loadout.map((w) => w.id + (w.turret ? "(T)" : "")).join(", "));
}
console.log("\nTTK matrix at 60 m, seconds (row attacks column)");
console.log(pad("", 14) + rows.map((r) => pad(r.id.slice(0, 9), 10)).join(""));
for (const a of rows) {
  console.log(pad(a.id, 14) + rows.map((b) => pad((a.byRange[60] > 0 ? (b.core * 1.6) / a.byRange[60] : Infinity).toFixed(1), 10)).join(""));
}
