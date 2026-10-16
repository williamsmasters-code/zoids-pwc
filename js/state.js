import {
  ZOIDS,
  ZOID_ORDER,
  WEAPONS,
  MODS,
  MAX_ARMOR_LEVEL,
  fits,
  armorUpgradeCost,
  weightOf,
  partListFor,
} from "./catalog.js";
import {
  createParts,
  applyCondition,
  serializeParts,
  repairCost,
  repairAll,
  derivePerformance,
  describeDegradation,
} from "./damage.js";

export const SAVE_KEY = "zoidMercs.save.v1";

function emptyEquip() {
  return { headWeapon: null, leftWeapon: null, rightWeapon: null, backMount: null };
}

function zeroArmor(def) {
  const levels = {};
  for (const id of partListFor(def)) levels[id] = 0;
  return levels;
}

export function freshState() {
  const hangar = {};
  for (const id of ZOID_ORDER) {
    const def = ZOIDS[id];
    hangar[id] = {
      owned: id === "shieldLiger",
      armorLevel: zeroArmor(def),
      mods: { speed: 0, maneuver: 0, booster: 0 },
      equipped: emptyEquip(),
      condition: null,
    };
  }
  hangar.shieldLiger.equipped.headWeapon = "w1";
  hangar.shieldLiger.equipped.leftWeapon = "w2";
  return {
    version: 1,
    money: 185000,
    selected: "shieldLiger",
    missionsDone: 0,
    wins: 0,
    reputation: 0,
    contractSeed: 1001,
    nextUid: 3,
    inventory: [
      { uid: "w1", type: "pulseLaser", group: 1 },
      { uid: "w2", type: "pulseLaser", group: 1 },
    ],
    hangar,
  };
}

function sanitize(raw) {
  const base = freshState();
  if (!raw || raw.version !== 1) return base;
  base.money = Number.isFinite(raw.money) ? raw.money : base.money;
  base.missionsDone = raw.missionsDone || 0;
  base.wins = raw.wins || 0;
  base.reputation = raw.reputation || 0;
  base.contractSeed = raw.contractSeed || base.contractSeed;
  base.nextUid = raw.nextUid || 3;
  base.inventory = Array.isArray(raw.inventory) ? raw.inventory.filter((w) => w && WEAPONS[w.type]) : base.inventory;
  if (ZOIDS[raw.selected]) base.selected = raw.selected;
  for (const id of ZOID_ORDER) {
    const saved = raw.hangar && raw.hangar[id];
    if (!saved) continue;
    const slot = base.hangar[id];
    slot.owned = !!saved.owned;
    slot.mods = {
      speed: clampLevel(saved.mods && saved.mods.speed, 2),
      maneuver: clampLevel(saved.mods && saved.mods.maneuver, 2),
      booster: clampLevel(saved.mods && saved.mods.booster, 2),
    };
    for (const partId of Object.keys(slot.armorLevel)) {
      slot.armorLevel[partId] = clampLevel(saved.armorLevel && saved.armorLevel[partId], MAX_ARMOR_LEVEL);
    }
    slot.equipped = emptyEquip();
    if (saved.equipped) {
      for (const mount of Object.keys(slot.equipped)) {
        const uid = saved.equipped[mount];
        if (uid && base.inventory.some((w) => w.uid === uid)) slot.equipped[mount] = uid;
      }
    }
    if (saved.condition && typeof saved.condition === "object") slot.condition = saved.condition;
  }
  if (!base.hangar[base.selected].owned) {
    base.selected = ZOID_ORDER.find((id) => base.hangar[id].owned) || "shieldLiger";
  }
  // A weapon can sit on only one mount.
  const seen = new Set();
  for (const id of ZOID_ORDER) {
    const eq = base.hangar[id].equipped;
    for (const mount of Object.keys(eq)) {
      if (!eq[mount]) continue;
      if (seen.has(eq[mount])) eq[mount] = null;
      else seen.add(eq[mount]);
    }
  }
  return base;
}

function clampLevel(value, max) {
  const n = Number(value) || 0;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return freshState();
    return sanitize(JSON.parse(raw));
  } catch {
    return freshState();
  }
}

export function saveState(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function resetState() {
  localStorage.removeItem(SAVE_KEY);
  return freshState();
}

export function formatC(n) {
  const sign = n < 0 ? "-" : "";
  const body = Math.abs(Math.round(n)).toLocaleString("en-US");
  return `${sign}${body} C`;
}

export function rankName(rep) {
  if (rep >= 15) return "Legend";
  if (rep >= 10) return "Ace";
  if (rep >= 6) return "Veteran";
  if (rep >= 3) return "Proven";
  return "Rookie";
}

export function equippedWeapons(state, zoidId) {
  const hangar = state.hangar[zoidId];
  const list = [];
  for (const [mount, uid] of Object.entries(hangar.equipped)) {
    if (!uid) continue;
    const item = state.inventory.find((w) => w.uid === uid);
    if (!item) continue;
    list.push({ uid: item.uid, type: item.type, group: item.group || 1, mount });
  }
  return list;
}

export function partsFor(state, zoidId) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  const parts = createParts(def, hangar.armorLevel);
  applyCondition(parts, hangar.condition);
  return parts;
}

export function totalWeight(state, zoidId) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  return weightOf(def, equippedWeapons(state, zoidId), hangar.armorLevel, hangar.mods);
}

export function performanceFor(state, zoidId) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  return derivePerformance(def, hangar.mods, partsFor(state, zoidId), totalWeight(state, zoidId));
}

export function launchBlockReason(state) {
  const id = state.selected;
  const hangar = state.hangar[id];
  if (!hangar || !hangar.owned) return "No active Zoid.";
  const parts = partsFor(state, id);
  if (parts.core.destroyed || parts.core.structure <= 0) return "Core destroyed. Repair before launch.";
  if (totalWeight(state, id) > ZOIDS[id].maxTonnage + 0.01) return "Over tonnage. Remove gear before launch.";
  return null;
}

function fail(reason) {
  return { ok: false, reason };
}

export function buyZoid(state, zoidId) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  if (!def || !hangar) return fail("Unknown Zoid.");
  if (hangar.owned) return fail("Already owned.");
  if (state.money < def.price) return fail("Not enough C-bills.");
  state.money -= def.price;
  hangar.owned = true;
  state.selected = zoidId;
  saveState(state);
  return { ok: true };
}

export function sellZoid(state, zoidId) {
  const owned = ZOID_ORDER.filter((id) => state.hangar[id].owned);
  if (owned.length <= 1) return fail("Keep at least one Zoid.");
  const hangar = state.hangar[zoidId];
  if (!hangar.owned) return fail("Not owned.");
  const refund = Math.round(ZOIDS[zoidId].price * 0.5);
  state.money += refund;
  hangar.owned = false;
  hangar.condition = null;
  hangar.mods = { speed: 0, maneuver: 0, booster: 0 };
  for (const id of Object.keys(hangar.armorLevel)) hangar.armorLevel[id] = 0;
  for (const mount of Object.keys(hangar.equipped)) hangar.equipped[mount] = null;
  if (state.selected === zoidId) state.selected = owned.find((id) => id !== zoidId);
  saveState(state);
  return { ok: true, refund };
}

export function setActive(state, zoidId) {
  if (!state.hangar[zoidId] || !state.hangar[zoidId].owned) return fail("Not owned.");
  state.selected = zoidId;
  saveState(state);
  return { ok: true };
}

export function buyWeapon(state, type) {
  const spec = WEAPONS[type];
  if (!spec) return fail("Unknown weapon.");
  if (state.money < spec.price) return fail("Not enough C-bills.");
  state.money -= spec.price;
  const uid = `w${state.nextUid++}`;
  state.inventory.push({ uid, type, group: 1 });
  saveState(state);
  return { ok: true, uid };
}

export function sellWeapon(state, uid) {
  const item = state.inventory.find((w) => w.uid === uid);
  if (!item) return fail("Missing weapon.");
  for (const hangar of Object.values(state.hangar)) {
    for (const mount of Object.keys(hangar.equipped)) {
      if (hangar.equipped[mount] === uid) return fail("Unequip it first.");
    }
  }
  const spec = WEAPONS[item.type];
  state.inventory = state.inventory.filter((w) => w.uid !== uid);
  state.money += Math.round(spec.price * 0.6);
  saveState(state);
  return { ok: true };
}

export function cycleGroup(state, uid) {
  const item = state.inventory.find((w) => w.uid === uid);
  if (!item) return fail("Missing weapon.");
  item.group = (item.group % 4) + 1;
  saveState(state);
  return { ok: true, group: item.group };
}

export function equip(state, zoidId, mount, uid) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  if (!hangar.owned) return fail("Buy this Zoid first.");
  if (!uid) {
    hangar.equipped[mount] = null;
    saveState(state);
    return { ok: true };
  }
  const item = state.inventory.find((w) => w.uid === uid);
  if (!item) return fail("Missing weapon.");
  const hardpoint = def.hardpoints.find((h) => h.id === mount);
  if (!hardpoint) return fail("No such hardpoint.");
  if (!fits(hardpoint.size, WEAPONS[item.type].size)) return fail("Too large for that hardpoint.");
  for (const other of Object.values(state.hangar)) {
    for (const key of Object.keys(other.equipped)) {
      if (other.equipped[key] === uid) other.equipped[key] = null;
    }
  }
  hangar.equipped[mount] = uid;
  saveState(state);
  return { ok: true };
}

export function changeArmor(state, zoidId, partId, dir) {
  const def = ZOIDS[zoidId];
  const hangar = state.hangar[zoidId];
  if (!hangar.owned) return fail("Buy this Zoid first.");
  if (!(partId in hangar.armorLevel)) return fail("No such part.");
  const current = hangar.armorLevel[partId];
  const next = current + dir;
  if (next < 0 || next > MAX_ARMOR_LEVEL) return fail("Plating limit reached.");
  if (dir > 0) {
    const cost = armorUpgradeCost(partId, current, def.armorScale);
    if (state.money < cost) return fail("Not enough C-bills.");
    state.money -= cost;
  } else {
    state.money += armorUpgradeCost(partId, next, def.armorScale);
  }
  const oldLevels = { ...hangar.armorLevel };
  hangar.armorLevel[partId] = next;
  if (hangar.condition) {
    const oldParts = createParts(def, oldLevels);
    applyCondition(oldParts, hangar.condition);
    const newParts = createParts(def, hangar.armorLevel);
    applyCondition(newParts, hangar.condition);
    const fresh = createParts(def, hangar.armorLevel);
    const added = fresh[partId].maxArmor - createParts(def, oldLevels)[partId].maxArmor;
    if (dir > 0) {
      newParts[partId].armor = Math.min(fresh[partId].maxArmor, oldParts[partId].armor + Math.max(0, added));
      newParts[partId].structure = Math.min(fresh[partId].maxStructure, oldParts[partId].structure);
    } else {
      newParts[partId].armor = Math.min(fresh[partId].maxArmor, oldParts[partId].armor);
      newParts[partId].structure = Math.min(fresh[partId].maxStructure, oldParts[partId].structure);
    }
    newParts[partId].destroyed = newParts[partId].structure <= 0;
    if (newParts[partId].destroyed) newParts[partId].structure = 0;
    hangar.condition = serializeParts(newParts);
  }
  saveState(state);
  return { ok: true };
}

export function changeMod(state, zoidId, key, dir) {
  const spec = MODS[key];
  const hangar = state.hangar[zoidId];
  if (!hangar.owned) return fail("Buy this Zoid first.");
  if (!spec) return fail("Unknown mod.");
  const current = hangar.mods[key] || 0;
  const next = current + dir;
  if (next < 0 || next > spec.max) return fail("Mod limit reached.");
  if (dir > 0) {
    const cost = spec.costs[current];
    if (state.money < cost) return fail("Not enough C-bills.");
    state.money -= cost;
  } else {
    state.money += spec.costs[next];
  }
  hangar.mods[key] = next;
  saveState(state);
  return { ok: true };
}

export function repairZoid(state, zoidId, opts = {}) {
  const hangar = state.hangar[zoidId];
  const parts = partsFor(state, zoidId);
  const cost = repairCost(parts);
  if (cost <= 0) return { ok: true, cost: 0 };
  const coreDead = parts.core.destroyed || parts.core.structure <= 0;
  if (state.money < cost && !(opts.allowDebt && coreDead)) {
    return fail("Not enough C-bills.");
  }
  state.money -= cost;
  repairAll(parts);
  hangar.condition = null;
  saveState(state);
  return { ok: true, cost };
}

export function applyMissionResult(state, result) {
  const hangar = state.hangar[result.zoidId];
  hangar.condition = result.parts;
  state.money += (result.payout || 0) + (result.salvage || 0);
  state.missionsDone += 1;
  if (result.victory) {
    state.wins += 1;
    state.reputation += 1;
  }
  state.contractSeed = (Math.imul(state.contractSeed, 17) + 13) >>> 0;
  saveState(state);
}

export function rerollSeed(state) {
  const cost = 5000;
  if (state.money < cost) return fail("Not enough C-bills.");
  state.money -= cost;
  state.contractSeed = (state.contractSeed + 997) >>> 0;
  saveState(state);
  return { ok: true };
}

export function notesFor(state, zoidId) {
  return describeDegradation(partsFor(state, zoidId), performanceFor(state, zoidId));
}
