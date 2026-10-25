// Per-mission difficulty, picked on the contract popover (1..5).
// One table drives enemy count and type pool, AI aim/aggression/fire rate,
// enemy plating, escort truck toughness, and the payout.
// Numbers documented in docs/MISSION_DIFFICULTY_NOTES.txt.

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

export const DIFFICULTY = {
  1: { label: "Green",   pay: 48000,  enemies: 2, pool: ["commandWolf", "commandWolf", "molga", "pteras"],
       aimError: 9,   react: 2.4, preferred: 62, aggro: 70,  fireRate: 0.65, armorLevel: 0, truckArmor: 2.0 },
  2: { label: "Regular", pay: 72000,  enemies: 2, pool: ["commandWolf", "zaberFang", "shieldLiger", "pteras", "gunSniper", "molga"],
       aimError: 6,   react: 1.9, preferred: 54, aggro: 85,  fireRate: 0.8,  armorLevel: 0, truckArmor: 1.7 },
  3: { label: "Veteran", pay: 110000, enemies: 3, pool: ["shieldLiger", "bladeLiger", "zaberFang", "ironKong", "gunSniper"],
       aimError: 4,   react: 1.4, preferred: 48, aggro: 100, fireRate: 1.0,  armorLevel: 0, truckArmor: 1.45 },
  4: { label: "Elite",   pay: 165000, enemies: 3, pool: ["bladeLiger", "zaberFang", "ironKong", "genoSaurer", "gojulas", "berserkFuhrer", "elephander", "deathStinger"],
       aimError: 2.5, react: 1.0, preferred: 44, aggro: 115, fireRate: 1.1,  armorLevel: 1, truckArmor: 1.25 },
  5: { label: "Ace",     pay: 260000, enemies: 4, pool: ["ironKong", "genoSaurer", "gojulas", "deathSaurer", "berserkFuhrer", "elephander", "deathStinger"],
       aimError: 1.5, react: 0.7, preferred: 40, aggro: 130, fireRate: 1.2,  armorLevel: 2, truckArmor: 1.1 },
};

export const TYPE_PAY = { destroy: 1, defend: 1.15, recon: 0.9, assault: 1.25 };

export function clampDifficulty(value, fallback = 2) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(DIFFICULTY_MIN, Math.min(DIFFICULTY_MAX, n));
}

export function difficultySpec(level) {
  return DIFFICULTY[clampDifficulty(level)];
}

export function payoutFor(level, type) {
  const spec = difficultySpec(level);
  return Math.round((spec.pay * (TYPE_PAY[type] || 1)) / 500) * 500;
}

export function enemyCountFor(level, type) {
  const base = difficultySpec(level).enemies;
  return type === "recon" || type === "assault" ? Math.max(1, base - 1) : base;
}

// AI pilot tuning for createBrain.
export function aiTuning(level) {
  const s = difficultySpec(level);
  return { aimError: s.aimError, react: s.react, preferred: s.preferred, aggroRange: s.aggro, fireRate: s.fireRate };
}
