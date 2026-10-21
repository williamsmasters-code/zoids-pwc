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

// BALANCE TABLE. Every weapon number lives here; docs/BALANCE_NOTES.txt has
// the before/after table and the reasoning (flavour from the Zoids Fanon
// Weapons Guide, https://zoidsfanon.fandom.com/wiki/Weapons_Guide).
//
// delivery is how the round travels. range is the hard max. optimal is full damage.
// Past optimal, damage falls toward 30% at max and is zero beyond it.
// heat is per shot (per volley) into that weapon's own 0-100 gauge; cooling is per second.
// kind "melee" weapons are short hitscan strikes (claws, blades).
// turret (optional): { arc: radians up to 2*PI, speed: rad/s }. Only honoured
// on the back mount; tracks and fires at the locked target only (js/turret.js).
// Damage class vs armour. armor = multiplier while the hit is eaten by armour
// plating; internal = multiplier on whatever reaches structure/components.
//   beam      energy weapons (lasers, beam cannons, charged particle): x0.7 on
//             plating (it ablates), unchanged once the plating is gone.
//   ballistic kinetic rounds and rockets (gatling, shock cannon, missiles):
//             x1.3 on plating (it cracks), unchanged on components.
//   melee     claws and blades: x1.0 both. They already pay with 8-14 m reach
//             and per-swing heat; a plating bonus would make them dominate.
// Classes come from weapon kind (energy -> beam, ballistic/missile ->
// ballistic, melee -> melee) unless a weapon sets damageClass.
export const DAMAGE_VS_ARMOR = {
  beam: { armor: 0.7, internal: 1 },
  ballistic: { armor: 1.3, internal: 1 },
  melee: { armor: 1, internal: 1 },
};

export function damageClassOf(weapon) {
  if (!weapon) return null;
  if (weapon.damageClass) return weapon.damageClass;
  if (weapon.kind === "melee") return "melee";
  if (weapon.kind === "energy") return "beam";
  if (weapon.kind === "ballistic" || weapon.kind === "missile") return "ballistic";
  return null;
}

export const WEAPONS = {
  pulseLaser: {
    // Guide: standard gun / beam. Beams are faster than shells, a little weaker.
    id: "pulseLaser",
    name: "Pulse Laser",
    kind: "energy",
    delivery: "beam",
    hitscan: true,
    damage: 4.5,
    rate: 7.5,
    optimal: 55,
    range: 90,
    heat: 7,
    cooling: 22,
    weight: 2,
    size: "S",
    price: 16000,
    spread: 0.006,
    color: 0x66ffcc,
  },
  beamCannon: {
    // Guide: cannon = a bit less accurate, hits harder. Long beam reach.
    id: "beamCannon",
    name: "Beam Cannon",
    kind: "energy",
    delivery: "beam",
    hitscan: true,
    damage: 18,
    rate: 1.4,
    optimal: 95,
    range: 160,
    heat: 12,
    cooling: 14,
    weight: 5.5,
    size: "M",
    price: 52000,
    spread: 0.004,
    color: 0x3aa0ff,
  },
  doubleBeamCannon: {
    // Command Wolf back turret. Guide: twin-linked = paired barrels converge
    // for more damage, at a shorter range.
    id: "doubleBeamCannon",
    name: "Double-Barreled Beam Cannon",
    kind: "energy",
    delivery: "beam",
    hitscan: true,
    damage: 9,
    volley: 2,
    rate: 1.5,
    optimal: 70,
    range: 120,
    heat: 10,
    cooling: 15,
    weight: 5.5,
    size: "M",
    price: 48000,
    spread: 0.004,
    turret: { arc: Math.PI * 2, speed: 2.8 },
    color: 0x58b8ff,
  },
  missilePack: {
    // Guide: missiles lock in 2-4 s (3 avg), near-certain hits once locked,
    // the standard explosive. Slower in flight than rockets.
    id: "missilePack",
    name: "Missile Pack",
    kind: "missile",
    delivery: "rocket",
    hitscan: false,
    damage: 10,
    volley: 4,
    rate: 0.4,
    optimal: 90,
    range: 200,
    heat: 12,
    cooling: 10,
    weight: 6,
    size: "M",
    price: 44000,
    spread: 0.05,
    speed: 60,
    popTime: 0.52,
    lockTime: 2.2,
    homing: true,
    color: 0xffcc66,
  },
  gatling: {
    // Guide: very high rate, very inaccurate past close range.
    id: "gatling",
    name: "Gatling Gun",
    kind: "ballistic",
    delivery: "ballistic",
    hitscan: false,
    damage: 2.2,
    rate: 16,
    optimal: 35,
    range: 100,
    heat: 1.4,
    cooling: 18,
    weight: 5,
    size: "M",
    price: 34000,
    spread: 0.04,
    speed: 170,
    gravity: 12,
    homing: false,
    color: 0xffe08a,
  },
  sniperRifle: {
    // Guide "Rifles": long-barrelled solid-shot guns, accurate at long range,
    // slow to cycle. Gun Sniper's signature weapon. Fast, flat shell.
    id: "sniperRifle",
    name: "Sniper Rifle",
    kind: "ballistic",
    delivery: "ballistic",
    hitscan: false,
    damage: 40,
    rate: 0.55,
    optimal: 140,
    range: 230,
    heat: 14,
    cooling: 10,
    weight: 7,
    size: "L",
    price: 98000,
    spread: 0.004,
    speed: 220,
    gravity: 4,
    homing: false,
    color: 0xfff0a0,
  },
  shockCannon: {
    // Guide: shock / impact cannons are short ranged, terribly inaccurate,
    // among the most powerful close-range guns, and slow to fire.
    id: "shockCannon",
    name: "Shock Cannon",
    kind: "ballistic",
    delivery: "ballistic",
    hitscan: false,
    damage: 46,
    rate: 0.5,
    optimal: 45,
    range: 105,
    heat: 20,
    cooling: 10,
    weight: 8,
    size: "L",
    price: 76000,
    spread: 0.02,
    speed: 75,
    gravity: 12,
    homing: false,
    color: 0xff8844,
  },
  chargedParticle: {
    // Guide: particle weapons are the most advanced, heavy surface damage and
    // armour penetration. Long charge, braced, longest reach.
    id: "chargedParticle",
    name: "Charged Particle Cannon",
    kind: "energy",
    delivery: "charge",
    hitscan: true,
    damage: 120,
    rate: 0.18,
    optimal: 130,
    range: 240,
    heat: 55,
    cooling: 8,
    weight: 16,
    size: "XL",
    price: 190000,
    spread: 0.004,
    chargeTime: 3,
    color: 0xd56bff,
  },
  strikeLaserClaw: {
    // Guide: energy-charged melee cuts deeper than hardened alloy, but the
    // charge must rest (heat). Zaber Fang / Command Wolf style claws.
    id: "strikeLaserClaw",
    name: "Strike Laser Claw",
    kind: "melee",
    delivery: "beam",
    hitscan: true,
    damage: 14,
    rate: 1.5,
    optimal: 8,
    range: 12,
    heat: 9,
    cooling: 16,
    weight: 1.5,
    size: "S",
    price: 22000,
    spread: 0.02,
    color: 0xff9a55,
  },
  laserBlade: {
    // Guide: laser-charged melee does the most damage of all close-combat
    // weapons, "usually only on the Blade Liger", and must recover.
    id: "laserBlade",
    name: "Laser Blade",
    kind: "melee",
    delivery: "beam",
    hitscan: true,
    damage: 26,
    rate: 1.2,
    optimal: 10,
    range: 14,
    heat: 14,
    cooling: 15,
    weight: 4,
    size: "M",
    price: 64000,
    spread: 0.02,
    color: 0x9fe6ff,
  },
};

export const WEAPON_ORDER = [
  "pulseLaser", "beamCannon", "doubleBeamCannon", "missilePack", "gatling", "shockCannon",
  "sniperRifle", "chargedParticle", "strikeLaserClaw", "laserBlade",
];

export const ZOIDS = {
  commandWolf: {
    id: "commandWolf",
    name: "Command Wolf",
    layout: "quad",
    build: "wolf",
    role: "Light scout",
    speed: 27,
    turn: 1.55,
    armorScale: 0.84,
    baseWeight: 28,
    maxTonnage: 50,
    price: 240000,
    scale: 0.82,
    radius: 2.4,
    blurb: "Lean wolf frame. Fastest legs in the stable, light armor, a 360-degree twin beam turret on the back that fires at the locked target on the run.",
    colors: { primary: 0x6d7568, secondary: 0x2c342e, accent: 0xc4553a, dark: 0x171c18, eye: 0xff5533, plate: 0x9aa394 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Flank", size: "M" },
      { id: "rightWeapon", name: "Right Flank", size: "S" },
      { id: "backMount", name: "Back Turret", size: "M", turret: { arc: Math.PI * 2, speed: 2.8 } },
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
      { id: "backMount", name: "Back Gun Pods", size: "L", turret: { arc: Math.PI, speed: 2.2 } },
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
      { id: "backMount", name: "Missile Pack", size: "M", turret: { arc: Math.PI * 1.5, speed: 1.5 } },
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
      { id: "backMount", name: "Particle Mount", size: "XL", turret: { arc: Math.PI * 0.75, speed: 1.6 } },
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
  gunSniper: {
    id: "gunSniper",
    name: "Gun Sniper",
    layout: "biped",
    build: "sniper",
    role: "Long-range sniper",
    speed: 25,
    turn: 1.45,
    armorScale: 0.8,
    baseWeight: 30,
    maxTonnage: 52,
    price: 420000,
    scale: 0.92,
    radius: 2.3,
    blurb: "Fast blue-grey raptor. A long sniper rifle above the tail, missile pods on the thighs. Hits from far away, folds up close.",
    colors: { primary: 0x5f7fa6, secondary: 0x2b3542, accent: 0xd8dde3, dark: 0x15191f, eye: 0x66ff88, plate: 0x8fa9c6 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Thigh Pod", size: "M" },
      { id: "rightWeapon", name: "Right Thigh Pod", size: "M" },
      { id: "backMount", name: "Tail Rifle", size: "L", turret: { arc: Math.PI * 0.5, speed: 1.9 } },
    ],
  },
  elephander: {
    id: "elephander",
    name: "Elephander",
    layout: "quad",
    build: "elephant",
    role: "Heavy assault",
    speed: 11,
    turn: 0.6,
    armorScale: 1.8,
    baseWeight: 110,
    maxTonnage: 160,
    price: 1250000,
    scale: 1.55,
    radius: 4.6,
    blurb: "Huge armoured elephant. Trunk claw, tusks, shoulder guns and a twin back cannon turret.",
    colors: { primary: 0x8a8f96, secondary: 0x3b3f45, accent: 0xe8d8a8, dark: 0x1c1e22, eye: 0x44ddff, plate: 0xb0b6bd },
    hardpoints: [
      { id: "headWeapon", name: "Trunk Claw", size: "M" },
      { id: "leftWeapon", name: "Left Shoulder", size: "L" },
      { id: "rightWeapon", name: "Right Shoulder", size: "M" },
      { id: "backMount", name: "Back Cannons", size: "L", turret: { arc: Math.PI * 1.5, speed: 1.2 } },
    ],
  },
  berserkFuhrer: {
    id: "berserkFuhrer",
    name: "Berserk Fuhrer",
    layout: "biped",
    build: "fuhrer",
    role: "Agile duelist",
    speed: 22,
    turn: 1.5,
    armorScale: 1.18,
    baseWeight: 60,
    maxTonnage: 90,
    price: 1050000,
    scale: 1.3,
    radius: 3.5,
    blurb: "Black and red tyrant. Two Buster Claws on back arms, a charged particle cannon, and very quick on its feet.",
    colors: { primary: 0x1a1a1e, secondary: 0x2e2e34, accent: 0xc8202a, dark: 0x0b0b0d, eye: 0x33ff66, plate: 0x8a1018 },
    hardpoints: [
      { id: "headWeapon", name: "Jaw", size: "S" },
      { id: "leftWeapon", name: "Left Buster Claw", size: "M" },
      { id: "rightWeapon", name: "Right Buster Claw", size: "M" },
      { id: "backMount", name: "Particle Cannon", size: "XL" },
    ],
  },
  molga: {
    id: "molga",
    name: "Molga",
    layout: "quad",
    build: "molga",
    role: "Armoured transport",
    speed: 10,
    turn: 0.85,
    armorScale: 1.4,
    baseWeight: 44,
    maxTonnage: 66,
    price: 180000,
    scale: 0.9,
    radius: 2.6,
    blurb: "Low, segmented armoured caterpillar. Slow, tough, rams with its plated head and carries small guns.",
    colors: { primary: 0x7a6a3c, secondary: 0x4a4026, accent: 0xb8a060, dark: 0x221d10, eye: 0xffcc33, plate: 0x9c8a54 },
    hardpoints: [
      { id: "headWeapon", name: "Ram Head", size: "S" },
      { id: "leftWeapon", name: "Left Gun", size: "S" },
      { id: "rightWeapon", name: "Right Gun", size: "S" },
      { id: "backMount", name: "Top Gun", size: "M", turret: { arc: Math.PI * 2, speed: 2.0 } },
    ],
  },
  pteras: {
    id: "pteras",
    name: "Pteras",
    layout: "biped",
    build: "pteras",
    role: "Air raider",
    speed: 30,
    turn: 1.7,
    armorScale: 0.66,
    baseWeight: 20,
    maxTonnage: 36,
    price: 290000,
    scale: 0.9,
    radius: 2.4,
    // Flies at a low fixed height above the ground (metres, before scale).
    // Movement, collision and hits work as for ground Zoids; only the model
    // is raised. Tunable here. See docs/NEW_ZOIDS_NOTES.txt.
    flyHeight: 3.2,
    blurb: "Light red pterosaur. Flies low and fast, bombs and missiles under the wings, thin armour.",
    colors: { primary: 0xb8322e, secondary: 0xe8e2d6, accent: 0xf0b030, dark: 0x2a1a18, eye: 0x66eeff, plate: 0xd8d0c0 },
    hardpoints: [
      { id: "headWeapon", name: "Beak", size: "S" },
      { id: "leftWeapon", name: "Left Wing", size: "S" },
      { id: "rightWeapon", name: "Right Wing", size: "S" },
      { id: "backMount", name: "Belly Rack", size: "M" },
    ],
  },
};

export const ZOID_ORDER = [
  "commandWolf", "zaberFang", "shieldLiger", "bladeLiger",
  "ironKong", "genoSaurer", "gojulas", "deathSaurer",
  "gunSniper", "elephander", "berserkFuhrer", "molga", "pteras",
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
      { type: "strikeLaserClaw", mount: "rightWeapon", group: 2 },
      { type: "doubleBeamCannon", mount: "backMount", group: 3 },
    ],
    zaberFang: [
      { type: "strikeLaserClaw", mount: "headWeapon", group: 2 },
      { type: "pulseLaser", mount: "leftWeapon", group: 1 },
      { type: "gatling", mount: "rightWeapon", group: 1 },
      { type: "beamCannon", mount: "backMount", group: 2 },
    ],
    shieldLiger: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "beamCannon", mount: "rightWeapon", group: 2 },
      { type: "missilePack", mount: "backMount", group: 2 },
    ],
    bladeLiger: [
      { type: "pulseLaser", mount: "headWeapon", group: 1 },
      { type: "laserBlade", mount: "leftWeapon", group: 2 },
      { type: "laserBlade", mount: "rightWeapon", group: 2 },
      { type: "pulseLaser", mount: "backMount", group: 3 },
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
    gunSniper: [
      { type: "sniperRifle", mount: "backMount", group: 1 },
      { type: "missilePack", mount: "leftWeapon", group: 2 },
      { type: "pulseLaser", mount: "headWeapon", group: 2 },
    ],
    elephander: [
      { type: "strikeLaserClaw", mount: "headWeapon", group: 3 },
      { type: "shockCannon", mount: "leftWeapon", group: 1 },
      { type: "pulseLaser", mount: "rightWeapon", group: 1 },
      { type: "doubleBeamCannon", mount: "backMount", group: 2 },
    ],
    berserkFuhrer: [
      { type: "laserBlade", mount: "leftWeapon", group: 2 },
      { type: "laserBlade", mount: "rightWeapon", group: 2 },
      { type: "chargedParticle", mount: "backMount", group: 1 },
      { type: "pulseLaser", mount: "headWeapon", group: 3 },
    ],
    molga: [
      { type: "strikeLaserClaw", mount: "headWeapon", group: 2 },
      { type: "pulseLaser", mount: "leftWeapon", group: 1 },
      { type: "gatling", mount: "backMount", group: 1 },
    ],
    pteras: [
      { type: "pulseLaser", mount: "leftWeapon", group: 1 },
      { type: "pulseLaser", mount: "rightWeapon", group: 1 },
      { type: "missilePack", mount: "backMount", group: 2 },
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
