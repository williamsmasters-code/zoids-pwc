// Static roster, weapons, and part budgets. No DOM and no three.js.

export const SIZE_RANK = { S: 1, M: 2, L: 3, XL: 4 };

export const QUAD_PARTS = [
  "head", "core",
  "leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg",
  "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon",
];

export const BIPED_PARTS = [
  "head", "core",
  "leftLeg", "rightLeg",
  "tail", "leftWeapon", "rightWeapon", "backMount", "headWeapon",
];

export const PART_LABELS = {
  head: "Head",
  core: "Core",
  leftFrontLeg: "L Front Leg",
  rightFrontLeg: "R Front Leg",
  leftRearLeg: "L Rear Leg",
  rightRearLeg: "R Rear Leg",
  leftLeg: "Left Leg",
  rightLeg: "Right Leg",
  tail: "Tail",
  leftWeapon: "Left Mount",
  rightWeapon: "Right Mount",
  backMount: "Back Mount",
  headWeapon: "Head Mount",
};

// armor / structure are scaled by the Zoid's armorScale. armorMass is tons per plating level.
export const PART_BASE = {
  head: { armor: 26, structure: 16, armorMass: 1.0 },
  core: { armor: 52, structure: 34, armorMass: 2.4 },
  leftFrontLeg: { armor: 30, structure: 18, armorMass: 1.3 },
  rightFrontLeg: { armor: 30, structure: 18, armorMass: 1.3 },
  leftRearLeg: { armor: 30, structure: 18, armorMass: 1.3 },
  rightRearLeg: { armor: 30, structure: 18, armorMass: 1.3 },
  leftLeg: { armor: 40, structure: 24, armorMass: 1.8 },
  rightLeg: { armor: 40, structure: 24, armorMass: 1.8 },
  tail: { armor: 20, structure: 14, armorMass: 0.8 },
  leftWeapon: { armor: 22, structure: 14, armorMass: 0.9 },
  rightWeapon: { armor: 22, structure: 14, armorMass: 0.9 },
  backMount: { armor: 24, structure: 16, armorMass: 1.1 },
  headWeapon: { armor: 14, structure: 10, armorMass: 0.5 },
};

export const ARMOR_LEVEL_BONUS = 0.28;
export const MAX_ARMOR_LEVEL = 3;

export const MODS = {
  speed: {
    name: "Speed Boosters",
    max: 2,
    weight: 4,
    blurb: "+8% top speed per level.",
    costs: [24000, 52000],
  },
  maneuver: {
    name: "Maneuver Gyros",
    max: 2,
    weight: 2.5,
    blurb: "+10% turn rate per level.",
    costs: [18000, 40000],
  },
  booster: {
    name: "Back Boosters",
    max: 2,
    weight: 5,
    blurb: "Hold Shift to sprint. Dies with the back mount.",
    costs: [32000, 60000],
  },
};

// delivery is how the round travels. range is the hard max. optimal is full damage.
// Past optimal, damage falls toward 30% at max and is zero beyond it.
export const WEAPONS = {
  pulseLaser: {
    id: "pulseLaser",
    name: "Pulse Laser",
    kind: "energy",
    delivery: "beam",
    hitscan: true,
    damage: 5,
    rate: 7.5,
    optimal: 50,
    range: 85,
    heat: 6,
    cooling: 22,
    weight: 2,
    size: "S",
    price: 16000,
    spread: 0.006,
    color: 0x66ffcc,
  },
  beamCannon: {
    id: "beamCannon",
    name: "Beam Cannon",
    kind: "energy",
    delivery: "beam",
    hitscan: true,
    damage: 16,
    rate: 1.6,
    optimal: 90,
    range: 150,
    heat: 18,
    cooling: 12,
    weight: 5.5,
    size: "M",
    price: 52000,
    spread: 0.003,
    color: 0x3aa0ff,
  },
  missilePack: {
    id: "missilePack",
    name: "Missile Pack",
    kind: "missile",
    delivery: "rocket",
    hitscan: false,
    damage: 7,
    volley: 4,
    rate: 0.5,
    optimal: 80,
    range: 200,
    heat: 14,
    cooling: 10,
    weight: 6,
    size: "M",
    price: 44000,
    spread: 0.05,
    speed: 68,
    popTime: 0.52,
    lockTime: 1.5,
    homing: true,
    color: 0xffcc66,
  },
  gatling: {
    id: "gatling",
    name: "Gatling Gun",
    kind: "ballistic",
    delivery: "ballistic",
    hitscan: false,
    damage: 2.3,
    rate: 16,
    optimal: 40,
    range: 110,
    heat: 1.8,
    cooling: 18,
    weight: 5,
    size: "M",
    price: 34000,
    spread: 0.03,
    speed: 170,
    gravity: 12,
    homing: false,
    color: 0xffe08a,
  },
  shockCannon: {
    id: "shockCannon",
    name: "Shock Cannon",
    kind: "ballistic",
    delivery: "ballistic",
    hitscan: false,
    damage: 30,
    rate: 0.7,
    optimal: 60,
    range: 130,
    heat: 16,
    cooling: 9,
    weight: 8,
    size: "L",
    price: 76000,
    spread: 0.01,
    speed: 82,
    gravity: 12,
    homing: false,
    color: 0xff8844,
  },
  chargedParticle: {
    id: "chargedParticle",
    name: "Charged Particle Cannon",
    kind: "energy",
    delivery: "charge",
    hitscan: true,
    damage: 88,
    rate: 0.18,
    optimal: 110,
    range: 220,
    heat: 55,
    cooling: 8,
    weight: 16,
    size: "XL",
    price: 190000,
    spread: 0.004,
    chargeTime: 3,
    color: 0xd56bff,
  },
};

export const WEAPON_ORDER = [
  "pulseLaser", "beamCannon", "missilePack", "gatling", "shockCannon", "chargedParticle",
];

export const ZOIDS = {
  commandWolf: {
    id: "commandWolf",
    name: "Command Wolf",
    layout: "quad",
    build: "wolf",
    role: "Light scout",
    speed: 26,
    turn: 1.5,
    armorScale: 0.72,
    baseWeight: 28,
    maxTonnage: 46,
    price: 240000,
    scale: 0.82,
    radius: 2.4,
    blurb: "Lean wolf frame. Fastest legs in the stable, thin armor, a sensor dish on the back.",
    colors: { primary: 0x6d7568, secondary: 0x2c342e, accent: 0xc4553a, dark: 0x171c18, eye: 0xff5533, plate: 0x9aa394 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Flank", size: "M" },
      { id: "rightWeapon", name: "Right Flank", size: "S" },
      { id: "backMount", name: "Back Dish", size: "M" },
    ],
  },
  zaberFang: {
    id: "zaberFang",
    name: "Zaber Fang",
    layout: "quad",
    build: "saber",
    role: "Fast attacker",
    speed: 24,
    turn: 1.36,
    armorScale: 0.86,
    baseWeight: 34,
    maxTonnage: 54,
    price: 310000,
    scale: 0.96,
    radius: 2.7,
    blurb: "Saber-toothed tiger. Long fangs, red and black hide, built to close and brawl.",
    colors: { primary: 0x8e1e22, secondary: 0x161616, accent: 0xf4f4f4, dark: 0x0e0e0e, eye: 0xff4422, plate: 0x5a1416 },
    hardpoints: [
      { id: "headWeapon", name: "Fangs", size: "S" },
      { id: "leftWeapon", name: "Left Shoulder", size: "M" },
      { id: "rightWeapon", name: "Right Shoulder", size: "M" },
      { id: "backMount", name: "Back", size: "M" },
    ],
  },
  shieldLiger: {
    id: "shieldLiger",
    name: "Shield Liger",
    layout: "quad",
    build: "lion",
    role: "Balanced striker",
    speed: 21,
    turn: 1.18,
    armorScale: 1,
    baseWeight: 40,
    maxTonnage: 64,
    price: 380000,
    scale: 1.12,
    radius: 3.1,
    blurb: "White and blue lion. While the left foreleg stands, the shield cuts frontal damage.",
    colors: { primary: 0xe7eef6, secondary: 0x1c4e9c, accent: 0x3ec6ff, dark: 0x1a2330, eye: 0xbff6ff, plate: 0x8fd8ff },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Shield Side", size: "M" },
      { id: "rightWeapon", name: "Right Flank", size: "M" },
      { id: "backMount", name: "Back", size: "L" },
    ],
  },
  bladeLiger: {
    id: "bladeLiger",
    name: "Blade Liger",
    layout: "quad",
    build: "blade",
    role: "Skirmisher",
    speed: 23,
    turn: 1.3,
    armorScale: 0.96,
    baseWeight: 42,
    maxTonnage: 68,
    price: 560000,
    scale: 1.14,
    radius: 3.15,
    blurb: "Blue liger with long silver flank blades. Quicker than the Shield Liger, a little lighter.",
    colors: { primary: 0x24508a, secondary: 0xd5dee8, accent: 0xf2f6fb, dark: 0x101820, eye: 0x9ad7ff, plate: 0xc5d4e4 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Blade", size: "M" },
      { id: "rightWeapon", name: "Right Blade", size: "M" },
      { id: "backMount", name: "Back", size: "L" },
    ],
  },
  ironKong: {
    id: "ironKong",
    name: "Iron Kong",
    layout: "biped",
    build: "gorilla",
    role: "Heavy arms",
    speed: 16,
    turn: 0.95,
    armorScale: 1.32,
    baseWeight: 62,
    maxTonnage: 92,
    price: 740000,
    scale: 1.22,
    radius: 3.5,
    blurb: "Upright armored gorilla. Long arm cannons, a thick chest, and short legs.",
    colors: { primary: 0x3e4c59, secondary: 0x8aa0b4, accent: 0xd27a2e, dark: 0x1b2228, eye: 0x88ddff, plate: 0xc5d0da },
    hardpoints: [
      { id: "headWeapon", name: "Brow", size: "S" },
      { id: "leftWeapon", name: "Left Arm", size: "L" },
      { id: "rightWeapon", name: "Right Arm", size: "L" },
      { id: "backMount", name: "Shoulders", size: "M" },
    ],
  },
  genoSaurer: {
    id: "genoSaurer",
    name: "Geno Saurer",
    layout: "biped",
    build: "raptor",
    role: "Particle striker",
    speed: 19,
    turn: 1.08,
    armorScale: 1.12,
    baseWeight: 58,
    maxTonnage: 86,
    price: 880000,
    scale: 1.28,
    radius: 3.4,
    blurb: "Red and black raptor. The back hardpoint can carry a charged particle cannon.",
    colors: { primary: 0xc4312a, secondary: 0x1a1a1a, accent: 0xf0c14a, dark: 0x120c0c, eye: 0xffe066, plate: 0x6a0e0e },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Arm", size: "M" },
      { id: "rightWeapon", name: "Right Arm", size: "M" },
      { id: "backMount", name: "Particle Mount", size: "XL" },
    ],
  },
  gojulas: {
    id: "gojulas",
    name: "Gojulas",
    layout: "biped",
    build: "tyrant",
    role: "Siege walker",
    speed: 13,
    turn: 0.7,
    armorScale: 1.65,
    baseWeight: 98,
    maxTonnage: 140,
    price: 1150000,
    scale: 1.48,
    radius: 4.3,
    blurb: "Massive olive tyrant. Slow, very thick structure, cannons on the arms and the back.",
    colors: { primary: 0x55624a, secondary: 0x2a3126, accent: 0x8d9a62, dark: 0x161910, eye: 0xffaa44, plate: 0x6d7848 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "M" },
      { id: "leftWeapon", name: "Left Cannon", size: "L" },
      { id: "rightWeapon", name: "Right Cannon", size: "L" },
      { id: "backMount", name: "Back Battery", size: "XL" },
    ],
  },
  deathSaurer: {
    id: "deathSaurer",
    name: "Death Saurer",
    layout: "biped",
    build: "death",
    role: "Super heavy",
    speed: 9,
    turn: 0.48,
    armorScale: 2.15,
    baseWeight: 168,
    maxTonnage: 230,
    price: 2100000,
    scale: 1.82,
    radius: 5.4,
    blurb: "Huge purple siege Zoid. Enormous armor and a back mount built for a particle cannon.",
    colors: { primary: 0x4a2468, secondary: 0x1a1020, accent: 0xc43b4e, dark: 0x100810, eye: 0xff3300, plate: 0x6e3a78 },
    hardpoints: [
      { id: "headWeapon", name: "Mouth Cannon", size: "L" },
      { id: "leftWeapon", name: "Left Plate", size: "M" },
      { id: "rightWeapon", name: "Right Plate", size: "M" },
      { id: "backMount", name: "Main Cannon", size: "XL" },
    ],
  },
};

export const ZOID_ORDER = [
  "commandWolf", "zaberFang", "shieldLiger", "bladeLiger",
  "ironKong", "genoSaurer", "gojulas", "deathSaurer",
];

export const STRUCTURES = {
  gunTurret: {
    id: "gunTurret",
    name: "Gun Turret",
    layout: "structure",
    build: "turret",
    partList: ["core", "head", "headWeapon"],
    armorScale: 0.85,
    speed: 0,
    turn: 1.4,
    baseWeight: 20,
    maxTonnage: 40,
    price: 0,
    scale: 1,
    radius: 2.2,
    immobile: true,
    hardpoints: [{ id: "headWeapon", name: "Barrel", size: "M" }],
    colors: { primary: 0x5c4636, secondary: 0x2a2118, accent: 0xff6633, dark: 0x1a120c, eye: 0xff3300, plate: 0x8a6a48 },
  },
  baseGenerator: {
    id: "baseGenerator",
    name: "Base Generator",
    layout: "structure",
    build: "generator",
    partList: ["core", "head"],
    armorScale: 1.45,
    speed: 0,
    turn: 0,
    baseWeight: 40,
    maxTonnage: 40,
    price: 0,
    scale: 1.3,
    radius: 4,
    immobile: true,
    hardpoints: [],
    colors: { primary: 0x3d4a55, secondary: 0x1c242c, accent: 0x35e0c0, dark: 0x101418, eye: 0x35e0c0, plate: 0x6a7a88 },
  },
  supplyTruck: {
    id: "supplyTruck",
    name: "Supply Truck",
    layout: "vehicle",
    build: "truck",
    partList: ["core", "head"],
    armorScale: 0.55,
    speed: 8,
    turn: 0,
    baseWeight: 12,
    maxTonnage: 20,
    price: 0,
    scale: 1,
    radius: 2.4,
    immobile: true,
    hardpoints: [],
    colors: { primary: 0xc2b48a, secondary: 0x6d6244, accent: 0x2f6f4e, dark: 0x3a3424, eye: 0xffeeaa, plate: 0x8d7e58 },
  },
};

export function partListFor(def) {
  if (def.partList) return def.partList;
  if (def.layout === "quad") return QUAD_PARTS;
  if (def.layout === "biped") return BIPED_PARTS;
  return ["core"];
}

export function fits(hardpointSize, weaponSize) {
  return SIZE_RANK[weaponSize] <= SIZE_RANK[hardpointSize];
}

export function armorUpgradeCost(partId, currentLevel, armorScale) {
  const mass = PART_BASE[partId].armorMass;
  return Math.round(1400 * mass * (currentLevel + 1) * (0.85 + armorScale * 0.15));
}

export function stockWeaponsFor(def, rng = Math.random) {
  const table = {
    commandWolf: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "gatling", mount: "leftWeapon", group: 1 },
      { type: "missilePack", mount: "backMount", group: 2 },
    ],
    zaberFang: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "pulseLaser", mount: "leftWeapon", group: 1 },
      { type: "gatling", mount: "rightWeapon", group: 2 },
    ],
    shieldLiger: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "beamCannon", mount: "rightWeapon", group: 2 },
      { type: "missilePack", mount: "backMount", group: 2 },
    ],
    bladeLiger: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "beamCannon", mount: "leftWeapon", group: 1 },
      { type: "gatling", mount: "rightWeapon", group: 2 },
    ],
    ironKong: [
      { type: "shockCannon", mount: "leftWeapon", group: 1 },
      { type: "gatling", mount: "rightWeapon", group: 2 },
      { type: "missilePack", mount: "backMount", group: 2 },
    ],
    genoSaurer: [
      { type: "chargedParticle", mount: "backMount", group: 1 },
      { type: "pulseLaser", mount: "leftWeapon", group: 2 },
      { type: "beamCannon", mount: "rightWeapon", group: 2 },
    ],
    gojulas: [
      { type: "shockCannon", mount: "leftWeapon", group: 1 },
      { type: "shockCannon", mount: "rightWeapon", group: 1 },
      { type: rng() > 0.45 ? "chargedParticle" : "beamCannon", mount: "backMount", group: 2 },
    ],
    deathSaurer: [
      { type: "chargedParticle", mount: "backMount", group: 1 },
      { type: "shockCannon", mount: "headWeapon", group: 2 },
      { type: "missilePack", mount: "leftWeapon", group: 2 },
    ],
    gunTurret: [
      { type: "shockCannon", mount: "headWeapon", group: 1 },
    ],
  };
  return (table[def.id] || []).map((w, i) => ({ ...w, uid: `${def.id}-stock-${i}` }));
}

export function weightOf(def, weapons, armorLevels, mods) {
  let w = def.baseWeight;
  for (const wep of weapons) {
    const spec = WEAPONS[wep.type];
    if (spec) w += spec.weight;
  }
  for (const id of partListFor(def)) {
    const level = (armorLevels && armorLevels[id]) || 0;
    w += PART_BASE[id].armorMass * level;
  }
  w += ((mods && mods.speed) || 0) * MODS.speed.weight;
  w += ((mods && mods.maneuver) || 0) * MODS.maneuver.weight;
  w += ((mods && mods.booster) || 0) * MODS.booster.weight;
  return w;
}

export const BIOMES = {
  desert: "Red Dune Expanse",
  plains: "Verdant Reach",
  arctic: "White Shelf",
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
