import { ZOIDS, BIOMES, mulberry32 } from "./catalog.js";

const NAMES = {
  destroy: ["Wolf Hunt", "Broken Fang", "Lance Breaker", "Red Sand Cleanup", "No Survivors"],
  defend: ["Convoy Escort", "Supply Push", "Last Trucks Through", "Road Open"],
  recon: ["Beacon Survey", "Signal Walk", "Quiet Grid", "Three Pings"],
  assault: ["Outpost Breaker", "Generator Strike", "Hardpoint Assault", "Basefall"],
};

const POOL = {
  1: ["commandWolf", "commandWolf", "zaberFang"],
  2: ["commandWolf", "zaberFang", "shieldLiger"],
  3: ["shieldLiger", "bladeLiger", "zaberFang", "ironKong"],
  4: ["bladeLiger", "ironKong", "genoSaurer", "gojulas"],
  5: ["ironKong", "genoSaurer", "gojulas", "deathSaurer"],
};

function shuffle(items, rng) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = arr[i];
    arr[i] = arr[j];
    arr[j] = swap;
  }
  return arr;
}

function rollEnemies(type, difficulty, rng) {
  const pool = POOL[difficulty];
  let count = difficulty >= 3 ? 3 : 2;
  if (type === "recon" || type === "assault") count = Math.max(1, count - 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    let zoidId = pool[Math.floor(rng() * pool.length)];
    if (zoidId === "deathSaurer" && out.some((e) => e.zoidId === "deathSaurer")) zoidId = "gojulas";
    out.push({ zoidId, name: `${ZOIDS[zoidId].name} ${i + 1}` });
  }
  if (out.some((e) => e.zoidId === "deathSaurer") && out.length > 2) out.length = 2;
  return out;
}

function wavesFor(type, enemies) {
  if (type !== "defend") return [{ at: 0, enemies }];
  const first = enemies.slice(0, Math.max(1, enemies.length - 1));
  let second = enemies.slice(first.length);
  if (!second.length) second = [{ zoidId: "commandWolf", name: "Command Wolf R" }];
  return [
    { at: 0, enemies: first },
    { at: 36, enemies: second },
  ];
}

function payoutFor(difficulty, type) {
  const base = { 1: 48000, 2: 72000, 3: 110000, 4: 165000, 5: 260000 }[difficulty];
  const mul = { destroy: 1, defend: 1.15, recon: 0.9, assault: 1.25 }[type];
  return Math.round((base * mul) / 500) * 500;
}

function briefFor(type, biome, enemies, difficulty) {
  const place = BIOMES[biome];
  const who = enemies.map((e) => ZOIDS[e.zoidId].name).join(", ");
  if (type === "destroy") {
    return `Drop into the ${place} and destroy the hostile lance (${who}). Difficulty ${difficulty}.`;
  }
  if (type === "defend") {
    return `Escort the supply trucks across the ${place}. Hostiles in the area: ${who}.`;
  }
  if (type === "recon") {
    return `Scan three beacons in the ${place}. Stay inside each ring until it locks. Patrol: ${who}.`;
  }
  return `Assault the outpost in the ${place}. Destroy the generator. Defenders: ${who}.`;
}

export function generateContracts(state) {
  const rng = mulberry32((state.contractSeed + state.wins * 17) >>> 0);
  const diffCenter = Math.min(5, 1 + Math.floor(state.wins / 2));
  const types = shuffle(["destroy", "defend", "recon", "assault"], rng).slice(0, 3);
  const biomes = shuffle(["desert", "plains", "arctic"], rng);
  return types.map((type, i) => {
    let difficulty = Math.max(1, Math.min(5, diffCenter + (i === 2 ? 1 : 0)));
    if (state.wins < 2) difficulty = Math.min(difficulty, 2);
    const biome = biomes[i % biomes.length];
    const enemies = rollEnemies(type, difficulty, rng);
    return {
      id: `${state.contractSeed}-${type}-${i}`,
      name: NAMES[type][Math.floor(rng() * NAMES[type].length)],
      type,
      biome,
      difficulty,
      payout: payoutFor(difficulty, type),
      enemies,
      waves: wavesFor(type, enemies),
      mapSeed: (state.contractSeed + i * 101 + difficulty * 13) >>> 0,
      brief: briefFor(type, biome, enemies, difficulty),
    };
  });
}
