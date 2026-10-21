// Per-mission difficulty. No DOM. Run with: node tests/difficulty.test.mjs
import assert from "node:assert/strict";
import { ZOIDS } from "../js/catalog.js";
import { DIFFICULTY, payoutFor, enemyCountFor, aiTuning, clampDifficulty } from "../js/difficulty.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: () => null, length: 0 };
const { freshState, setMissionDifficulty, loadState, saveState } = await import("../js/state.js");
const { generateContracts, withDifficulty } = await import("../js/contracts.js");

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok", name); };
const weight = (c) => c.enemies.reduce((s, e) => s + ZOIDS[e.zoidId].maxTonnage, 0);

test("payout rises with difficulty for every type", () => {
  for (const type of ["destroy", "defend", "recon", "assault"]) {
    for (let d = 2; d <= 5; d++) assert.ok(payoutFor(d, type) > payoutFor(d - 1, type), `${type} D${d}`);
  }
});

test("AI gets sharper, quicker and more aggressive with difficulty", () => {
  for (let d = 2; d <= 5; d++) {
    const a = aiTuning(d - 1);
    const b = aiTuning(d);
    assert.ok(b.aimError < a.aimError && b.react < a.react && b.fireRate > a.fireRate && b.aggroRange > a.aggroRange && b.preferred < a.preferred);
  }
});

test("enemy count never drops and heavier pools at higher difficulty", () => {
  for (const type of ["destroy", "defend", "recon", "assault"]) {
    for (let d = 2; d <= 5; d++) assert.ok(enemyCountFor(d, type) >= enemyCountFor(d - 1, type));
  }
  const avg = (d) => DIFFICULTY[d].pool.reduce((s, id) => s + ZOIDS[id].maxTonnage, 0) / DIFFICULTY[d].pool.length;
  for (let d = 2; d <= 5; d++) assert.ok(avg(d) > avg(d - 1), `pool D${d}`);
});

test("withDifficulty rescales one contract and is deterministic", () => {
  const state = freshState();
  const base = generateContracts(state)[0];
  const d1 = withDifficulty(base, 1);
  const d5 = withDifficulty(base, 5);
  assert.equal(d1.difficulty, 1);
  assert.equal(d5.difficulty, 5);
  assert.ok(d5.payout > d1.payout);
  assert.ok(weight(d5) > weight(d1), "D5 lance should be heavier");
  assert.deepEqual(withDifficulty(base, 3).enemies, withDifficulty(base, 3).enemies);
  assert.equal(d5.name, base.name);
  assert.equal(d5.mapSeed, base.mapSeed);
  console.log(`  ${base.name}: D1 ${d1.payout} ${d1.enemies.map((e) => e.zoidId)} | D5 ${d5.payout} ${d5.enemies.map((e) => e.zoidId)}`);
});

test("the chosen difficulty is remembered and survives a reload", () => {
  const state = freshState();
  assert.equal(setMissionDifficulty(state, 4).ok, true);
  for (const c of generateContracts(state)) assert.equal(c.difficulty, 4);
  saveState(state);
  const back = loadState();
  assert.equal(back.missionDifficulty, 4);
  assert.equal(generateContracts(back)[1].difficulty, 4);
  assert.equal(setMissionDifficulty(state, 9).ok, false);
  assert.equal(clampDifficulty(0), 1);
  assert.equal(clampDifficulty(7), 5);
});

console.log(`difficulty tests passed: ${passed}`);
