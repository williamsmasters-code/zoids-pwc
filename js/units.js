// Speed display units. Game speeds are m/s on a scaled map; the player sees
// the canon-equivalent figure (game m/s / SPEED_SCALE) in KM/H or MPH.
import { SPEED_SCALE } from "./catalog.js";

const KEY = "zoidMercs.speedUnit";
const MPH = 0.621371;

export function getSpeedUnit() {
  try { return localStorage.getItem(KEY) === "mph" ? "mph" : "kmh"; } catch { return "kmh"; }
}
export function setSpeedUnit(unit) {
  try { localStorage.setItem(KEY, unit === "mph" ? "mph" : "kmh"); } catch { /* private mode */ }
}
export function toggleSpeedUnit() { const next = getSpeedUnit() === "mph" ? "kmh" : "mph"; setSpeedUnit(next); return next; }
export function unitLabel(unit = getSpeedUnit()) { return unit === "mph" ? "mph" : "km/h"; }
// Canon-equivalent km/h for a game speed in m/s.
export function gameToKph(mps) { return mps / SPEED_SCALE; }
export function displaySpeed(mps, unit = getSpeedUnit()) {
  const kph = gameToKph(mps);
  return Math.round(unit === "mph" ? kph * MPH : kph);
}
export function displayKph(kph, unit = getSpeedUnit()) { return Math.round(unit === "mph" ? kph * MPH : kph); }
// Seconds to reach 100 km/h-equivalent (or the top speed if lower) from rest.
export function zeroTo100(perf) {
  const target = Math.min(100 * SPEED_SCALE, perf.speed);
  return target / Math.max(0.01, perf.accel);
}
