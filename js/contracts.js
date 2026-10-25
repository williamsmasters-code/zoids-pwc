import { ZOIDS, BIOMES, mulberry32 } from "./catalog.js";
import { DIFFICULTY, clampDifficulty, payoutFor, enemyCountFor } from "./difficulty.js";

const NAMES = {
  destroy: ["Wolf Hunt", "Broken Fang", "Lance Breaker", "Red Sand Cleanup", "No Survivors"],
  defend: ["Convoy Escort", "Supply Push", "Last Trucks Through", "Road Open"],
  recon: ["Beacon Survey", "Signal Walk", "Quiet Grid", "Three Pings"],
  assault: ["Outpost Breaker", "Generator Strike", "Hardpoint Assault", "Basefall"],
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

export function rollEnemies(type, difficulty, rng) {
  const pool = DIFFICULTY[difficulty].pool;
  const count = enemyCountFor(difficulty, type);
  const out = [];
  for (let i = 0; i < count; i++) {
    let zoidId = pool[Math.floor(rng() * pool.length)];
    // Superheavies (Death Saurer, Death Stinger, Gojulas): at most one per mission.
    const boss = (id) => id === "deathSaurer" || id === "deathStinger" || id === "gojulas";
    if (boss(zoidId) && out.some((e) => boss(e.zoidId))) zoidId = zoidId === "deathSaurer" ? "ironKong" : "genoSaurer";
    out.push({ zoidId, name: `${ZOIDS[zoidId].name} ${i + 1}` });
  }
  // One superheavy is a lance on its own: cap the escort at 3 total.
  if (out.some((e) => e.zoidId === "deathSaurer" || e.zoidId === "deathStinger" || e.zoidId === "gojulas") && out.length > 3) out.length = 3;
  return out;
}

function wavesFor(type, enemies) {
  if (type !== "defend") return [{ at: 0, enemies }];
  const first = enemies.slice(0, Math.max(1, enemies.length - 1));
  let second = enemies.slice(first.length);
  if (!second.length) second = [{ zoidId: "commandWolf", name: "Command Wolf R" }];
  return [
    { at: 0, enemies: first },
    { at: 0, enemies: second, ambush: 2 },
  ];
}

function briefFor(type, biome, enemies, difficulty) {
  const place = BIOMES[biome];
  const who = enemies.map((e) => ZOIDS[e.zoidId].name).join(", ");
  if (type === "destroy") {
    return `Drop into the ${place} and destroy the hostile lance (${who}). Difficulty ${difficulty}.`;
  }
  if (type === "defend") {
    return `Escort the supply trucks across the ${place}. A hostile ambush (${who}) waits somewhere mid-route. Scout ahead and clear or distract it before the trucks arrive.`;
  }
  if (type === "recon") {
    return `Scan three beacons in the ${place}. Stay inside each ring until it locks. Patrol: ${who}.`;
  }
  return `Assault the outpost in the ${place}. Destroy the generator. Defenders: ${who}.`;
}

// Rebuild a contract's enemies, waves, payout and brief at a chosen difficulty.
// Deterministic per contract id + level, so the slider preview matches the launch.
export function withDifficulty(contract, level) {
  const difficulty = clampDifficulty(level, contract.suggested || contract.difficulty);
  let h = 2166136261;
  for (const ch of `${contract.id}:${difficulty}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rng = mulberry32(h);
  const enemies = rollEnemies(contract.type, difficulty, rng);
  return {
    ...contract,
    difficulty,
    payout: payoutFor(difficulty, contract.type),
    enemies,
    waves: wavesFor(contract.type, enemies),
    escortSeed: h,
    brief: briefFor(contract.type, contract.biome, enemies, difficulty),
  };
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
    const base = {
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
      suggested: difficulty,
    };
    const chosen = state.missionDifficulty ? clampDifficulty(state.missionDifficulty) : difficulty;
    return withDifficulty(base, chosen);
  });
}
