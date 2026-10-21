// Supply Push / convoy escort layout. Pure numbers so tests can check them.
// The convoy drives north (-Z) from truckZ to exitZ. The player starts 20 m
// ahead of the trucks (so the trucks are never in the line of fire at spawn). The ambush spawns mid-route: the first group somewhere
// between 40% and 70% of the way, a second (reinforcement) group 15-25%
// further on. Enemies hold their spot (guard radius) until a foe comes close
// or shoots them, which gives the player time to scout ahead and engage.
import { mulberry32 } from "./catalog.js";

export const ESCORT = {
  truckZ: 310,
  playerZ: 290,
  exitZ: -300,
  window: [0.4, 0.7],
  secondGap: [0.15, 0.25],
  maxFraction: 0.88,
  lateral: 60,
  guardRadius: 120,
};

export function escortLayout(contract) {
  const rng = mulberry32(((contract.escortSeed || contract.mapSeed || 1) ^ 0x2c1b3c6d) >>> 0);
  const route = ESCORT.truckZ - ESCORT.exitZ;
  const f1 = ESCORT.window[0] + rng() * (ESCORT.window[1] - ESCORT.window[0]);
  const f2 = Math.min(ESCORT.maxFraction, f1 + ESCORT.secondGap[0] + rng() * (ESCORT.secondGap[1] - ESCORT.secondGap[0]));
  const side = rng() < 0.5 ? -1 : 1;
  const x1 = side * (12 + rng() * (ESCORT.lateral - 12));
  const x2 = -side * (12 + rng() * (ESCORT.lateral - 12));
  const at = (f, x) => ({ fraction: f, x, z: ESCORT.truckZ - f * route });
  return {
    truckZ: ESCORT.truckZ,
    playerZ: ESCORT.playerZ,
    exitZ: ESCORT.exitZ,
    route,
    guardRadius: ESCORT.guardRadius,
    ambush: [at(f1, x1), at(f2, x2)],
  };
}
