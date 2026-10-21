// Escort layout and raider target choice. No DOM. Run with: node tests/escort.test.mjs
import assert from "node:assert/strict";
import { ESCORT, escortLayout } from "../js/escort.js";
import { createBrain, updateBrain, chooseTarget } from "../js/ai.js";
import { mulberry32 } from "../js/catalog.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok", name); };

test("ambush is mid-route (40-70%) and far ahead of the convoy", () => {
  let minGap = Infinity;
  for (let seed = 1; seed <= 400; seed++) {
    const L = escortLayout({ escortSeed: seed * 2654435761 });
    const [a, b] = L.ambush;
    assert.ok(a.fraction >= 0.4 && a.fraction <= 0.7, `first at ${a.fraction}`);
    assert.ok(b.fraction > a.fraction && b.fraction <= ESCORT.maxFraction);
    const gap = L.truckZ - a.z;
    minGap = Math.min(minGap, gap);
    assert.ok(gap >= 0.4 * L.route - 1e-6);
    assert.ok(Math.abs(L.playerZ - L.truckZ) <= 30, "player starts with the trucks");
    assert.ok(L.playerZ < L.truckZ, "player starts ahead of the trucks, not shooting through them");
    assert.ok(Math.hypot(a.x, L.playerZ - a.z) > 220, "player starts well out of contact");
  }
  console.log(`  closest ambush to the trucks at start: ${minGap.toFixed(0)} m (${(minGap / 8).toFixed(0)} s of truck travel)`);
  assert.ok(minGap >= 240);
});

function unit(id, team, x, z, extra = {}) {
  return {
    id, team, alive: true, name: id,
    def: { layout: extra.layout || "quad", radius: 2, immobile: !!extra.immobile },
    model: { root: { position: { x, y: 0, z } } },
    weapons: [{ range: 100 }], skill: null, ...extra.unit,
  };
}

test("ambush holds its spot until something comes close", () => {
  const raider = unit("r", "enemy", 0, 0);
  const truck = unit("t", "player", 0, 300, { layout: "vehicle", immobile: true });
  const player = unit("p", "player", 0, 330);
  const brain = createBrain(mulberry32(1), { react: 0, guard: { x: 0, z: 0, radius: 120 }, aggroRange: 90, prefersObjective: true });
  brain.react = 0;
  updateBrain(raider, brain, { units: [raider, truck, player], time: 0 }, 0.1);
  assert.equal(raider.aiTarget, null);
  assert.equal(raider.cmd.fire, false);
  truck.model.root.position.z = 100;
  updateBrain(raider, brain, { units: [raider, truck, player], time: 1 }, 0.1);
  assert.equal(brain.alerted, true);
  assert.equal(raider.aiTarget, truck, "with the player far away it goes for the trucks");
});

test("raider switches to the player when the player comes close", () => {
  const raider = unit("r", "enemy", 0, 0);
  const truck = unit("t", "player", 0, 60, { layout: "vehicle", immobile: true });
  const player = unit("p", "player", 0, 200);
  const brain = createBrain(mulberry32(2), { react: 0, aggroRange: 90, prefersObjective: true });
  assert.equal(chooseTarget(raider, brain, [raider, truck, player], 0), truck);
  player.model.root.position.z = -70;
  assert.equal(chooseTarget(raider, brain, [raider, truck, player], 0), player);
});

test("raider switches to the player when shot from long range, then lets go", () => {
  const raider = unit("r", "enemy", 0, 0);
  const truck = unit("t", "player", 0, 40, { layout: "vehicle", immobile: true });
  const player = unit("p", "player", 0, -220);
  const brain = createBrain(mulberry32(3), { react: 0, aggroRange: 90, prefersObjective: true });
  assert.equal(chooseTarget(raider, brain, [raider, truck, player], 0), truck);
  raider.provokedBy = player; // what mission.applyDamage sets
  raider.provokedUntil = 10 + 8;
  assert.equal(chooseTarget(raider, brain, [raider, truck, player], 10), player);
  assert.equal(chooseTarget(raider, brain, [raider, truck, player], 19), truck, "aggro fades if the player stops engaging");
});

test("aim scatter grows with aimError", () => {
  const spread = (err) => {
    const r = unit("r", "enemy", 0, 0);
    const p = unit("p", "player", 0, -80);
    const b = createBrain(mulberry32(5), { react: 0, aimError: err });
    b.react = 0;
    let sum = 0;
    for (let i = 0; i < 40; i++) {
      b.jitterT = 0;
      updateBrain(r, b, { units: [r, p], time: i }, 0.1);
      sum += Math.hypot(r.cmd.aim.x - 0, r.cmd.aim.z + 80);
    }
    return sum / 40;
  };
  assert.equal(spread(0), 0);
  assert.ok(spread(9) > spread(1.5) * 3);
});

console.log(`escort tests passed: ${passed}`);
