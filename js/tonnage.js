// Weight zones. Load ratio = fitted weight / rated tonnage (def.maxTonnage).
// One table drives the movement penalties, the cooling penalty, the hangar
// bar bands and the fitting ceiling. Numbers documented in docs/HANGAR_NOTES.txt.
//
// Inside a zone the multipliers ease linearly from the zone's `from` values
// to its `to` values, so there is no cliff at a boundary.

export const TONNAGE_CEILING = 1.3; // fitting above 130% of rated tonnage is refused

export const TONNAGE_ZONES = [
  { id: "light", label: "Light", min: 0, max: 0.8, color: "#37d6e8",
    from: { speed: 1, accel: 1, turn: 1, cool: 1 }, to: { speed: 1, accel: 1, turn: 1, cool: 1 } },
  { id: "loaded", label: "Loaded", min: 0.8, max: 1.0, color: "#e8c537",
    from: { speed: 1, accel: 1, turn: 1, cool: 1 }, to: { speed: 0.9, accel: 0.85, turn: 0.9, cool: 1 } },
  { id: "overloaded", label: "Overloaded", min: 1.0, max: 1.2, color: "#ef8a2f",
    from: { speed: 0.9, accel: 0.85, turn: 0.9, cool: 0.85 }, to: { speed: 0.65, accel: 0.55, turn: 0.65, cool: 0.7 } },
  { id: "critical", label: "Critical", min: 1.2, max: TONNAGE_CEILING, color: "#e8473f",
    from: { speed: 0.65, accel: 0.55, turn: 0.65, cool: 0.7 }, to: { speed: 0.55, accel: 0.45, turn: 0.55, cool: 0.6 } },
];

export function tonnageZone(weight, rated) {
  const ratio = rated > 0 ? weight / rated : 0;
  const blocked = ratio > TONNAGE_CEILING + 1e-6;
  let zone = TONNAGE_ZONES[TONNAGE_ZONES.length - 1];
  for (const z of TONNAGE_ZONES) {
    if (ratio < z.max || z === zone) { zone = z; break; }
  }
  const t = Math.max(0, Math.min(1, (ratio - zone.min) / (zone.max - zone.min)));
  const lerp = (k) => zone.from[k] + (zone.to[k] - zone.from[k]) * t;
  return {
    ratio,
    zone: blocked ? "blocked" : zone.id,
    label: blocked ? "Over ceiling" : zone.label,
    color: blocked ? "#ff2d55" : zone.color,
    blocked,
    speedMul: lerp("speed"),
    accelMul: lerp("accel"),
    turnMul: lerp("turn"),
    coolMul: lerp("cool"),
  };
}
