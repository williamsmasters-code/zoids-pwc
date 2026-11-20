// Battlefield: movement, weapons, AI, objectives, camera.
// Chassis forward is the Zoid's local -Z. Object3D.getWorldDirection is +Z,
// so facingDirection negates it. Cameras already look down -Z and are not negated.
// Look yaw is a second frame for the camera and the aim point only.

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  FogExp2,
  Color,
  Vector3,
  Quaternion,
  Raycaster,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Clock,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Box3,
  Vector2,
  Group,
} from "three";
import {
  ZOIDS,
  STRUCTURES,
  WEAPONS,
  PART_LABELS,
  partListFor,
  stockWeaponsFor,
  weightOf,
  mulberry32,
  BIOMES,
  standardMeleeFor,
} from "./catalog.js";
import {
  createParts,
  applyCondition,
  applyHit,
  derivePerformance,
  damageCtxFor,
  serializeParts,
  sensorsFromHead,
  repairCost,
} from "./damage.js";
import { createMap, minimapLayer } from "./maps.js";
import {
  biomeId,
  pointBlocked,
  findFreeSpot,
  terrainBlocked,
  findPath,
  walkClear,
  nextWaypoint,
  lineBlocked,
  radarBlocked,
  steerYaw,
  coverPoint,
  rayBlockers,
  rayGround,
  wadeSpeedMul,
  wadeCoolMul,
  PLAY_LIMIT,
} from "./battlefield.js";
import { SENSOR, stealthMul, updateTrack, trackState } from "./sensors.js";
import { buildHitBoxes, centerOfMass, rayHitBoxes, toLocal, dirToLocal, toWorld, assistAim, assistRadii, boundsOf } from "./targeting.js";
import { buildUnitModel, tagOwner, refreshPartColors, disposeTree, setTurretYaw, meleeState } from "./models.js";
import { turretSpecFor, relativeBearing, stepTurret, turretTrigger } from "./turret.js";
import { weaponArc, clampToArc } from "./arcs.js";
import { createInput } from "./input.js";
import { createHUD, headingOf } from "./hud.js";
import { createBrain, updateBrain } from "./ai.js";
import { aiTuning, difficultySpec } from "./difficulty.js";
import { escortLayout } from "./escort.js";
import { bandOf, rangeDamageMul, rangeSpreadMul, rangeAimMul, rangeLockMul } from "./rangebands.js";
import { displaySpeed, unitLabel } from "./units.js";
import { probeRenderQuality } from "./quality.js";
import { flightSpec, createFlight, stepFlight, floorAt, shouldFall, meleeReaches } from "./flight.js";
import {
  addWeaponHeat,
  coolWeapon,
  weaponWantsShot,
  stepProjectile,
  canOperateWeapon,
  mountUsable,
  groupHeatState,
} from "./combat.js";
import {
  BALLISTIC_GRAVITY,
  LOCK_TIME,
  STATIONARY_SPEED,
  leadPoint,
  rocketMayFire,
  rocketTurn,
  rocketPopFor,
  rocketDiveBiasFor,
  stepLock,
} from "./ballistics.js";
import { screenEdgeIndicator, minimapProject } from "./indicators.js";
import {
  TARGET_BOX_DEG,
  LOCK_DECAY_MUL,
  HAZARD_KINDS,
  angleDeg,
  sensorRange,
  inSensor,
  pickUnderReticle,
  pickNearest,
  cycleTargets,
  stepTargetLock,
  lockConeOf,
  fireModeOf,
  heatPerShot,
  stepFireControl,
  shotSpread,
  addBloom,
  recoverBloom,
  zeroedDir,
  zeroedImpact,
  zeroOf,
  holdoverPoint,
  hazardPath,
  beamTransmission,
  refractAngle,
  bendDir,
  lockBlocked,
  insideHazard,
} from "./weaponsys.js";
import {
  initSkill,
  tickSkill,
  activateSkill,
  weaponsLocked,
  resolveIncoming,
  skillHud,
  skillSpeedMul,
  energyCoolMul,
  heatGenMul,
  damageMul,
  spreadMul,
  radarMul,
  scrambleMul,
} from "./skills.js";
import { sfx } from "./audio.js";
import { wrapAngle, stepYaw, yawToFace, forwardFromYaw, clamp, approach } from "./frame.js";
import {
  AIM_FAR,
  aimPointAlongRay,
  directionToPoint,
  selectAimHit,
} from "./aim.js";

const UP = new Vector3(0, 1, 0);
const NEG_Z = new Vector3(0, 0, -1);

export function startMission(state, contract, hooks) {
  const hangar = document.getElementById("hangar-root");
  const host = document.getElementById("mission-root");
  hangar.classList.add("hidden");
  host.classList.remove("hidden");
  host.innerHTML = `<div id="view"></div><div id="hud"></div>`;

  // MSAA off on software GL and high-DPI phones (js/quality.js).
  const quality = probeRenderQuality();
  const renderer = new WebGLRenderer({ antialias: quality.antialias, powerPreference: "high-performance" });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.querySelector("#view").appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.15, 2500);
  const clock = new Clock();
  // Test-only biome override (window.__ZOIDS__.forceBiome), like pacifyOnStart.
  const forcedBiome = window.__ZOIDS__ && window.__ZOIDS__.forceBiome;
  if (window.__ZOIDS__) window.__ZOIDS__.forceBiome = null;
  const biome = biomeId(forcedBiome || contract.biome);
  const map = createMap(biome, contract.mapSeed);
  const field = map.field;
  if (map.ground) map.ground.userData.ground = true;
  scene.add(map.group);
  scene.background = new Color(map.palette.sky);
  scene.fog = new FogExp2(map.palette.fog, map.palette.density);
  scene.add(new HemisphereLight(map.palette.hemiSky, map.palette.hemiGround, 0.9));
  const sun = new DirectionalLight(map.palette.sun, map.palette.sunIntensity || 1.45);
  sun.position.copy(map.sunDir).multiplyScalar(200);
  scene.add(sun);
  const miniLayer = minimapLayer(field);
  const fill = new DirectionalLight(0x9eb4c8, 0.35);
  fill.position.set(50, 40, -30);
  scene.add(fill);

  const rng = mulberry32(contract.mapSeed ^ 0x9e3779b9);
  // Separate stream for weapon cooldown jitter, so the number of weapons on a
  // Zoid does not shift the AI brain rolls that follow it in `rng`.
  const weaponRng = mulberry32(contract.mapSeed ^ 0x5bd1e995);
  const units = [];
  const obstacles = map.obstacles;
  const projectiles = [];
  const effects = [];
  // Beam-refracting clouds (js/weaponsys.js): static per biome, plus smoke
  // columns from wrecks. Vertical cylinders; meshes are soft puffs only.
  const hazards = [];
  const hazardRng = mulberry32((contract.mapSeed || 1) ^ 0x2c1b3c6d);
  // Fire-control computer on player turrets: how much of the shell drop it
  // compensates (AI turrets use the pilot's holdover).
  const TURRET_HOLDOVER = 0.9;
  const hazardGroup = new Group();
  scene.add(hazardGroup);

  function addHazard(spec, life = 0) {
    const kind = HAZARD_KINDS[spec.kind] || HAZARD_KINDS.dust;
    const ground = map.heightAt(spec.x, spec.z);
    const hz = { ...spec, y0: ground - 2, life, maxLife: life, puffs: [] };
    const count = life ? 6 : 9;
    for (let i = 0; i < count; i++) {
      const a = hazardRng() * Math.PI * 2;
      const rr = Math.sqrt(hazardRng()) * hz.r * 0.62;
      const size = hz.r * (0.42 + hazardRng() * 0.3);
      const mat = new MeshBasicMaterial({ color: kind.color, transparent: true, opacity: life ? 0.42 : 0.3, depthWrite: false });
      const puff = new Mesh(new SphereGeometry(1, 10, 8), mat);
      puff.scale.set(size, size * (0.7 + hazardRng() * 0.4), size);
      const y = ground + size * 0.5 + hazardRng() * Math.max(1, hz.h - size);
      puff.position.set(hz.x + Math.cos(a) * rr, y, hz.z + Math.sin(a) * rr);
      puff.userData.baseY = y;
      puff.userData.phase = hazardRng() * Math.PI * 2;
      puff.renderOrder = 2;
      hazardGroup.add(puff);
      hz.puffs.push(puff);
    }
    hazards.push(hz);
    return hz;
  }

  function removeHazard(hz) {
    for (const puff of hz.puffs) {
      hazardGroup.remove(puff);
      puff.geometry.dispose();
      puff.material.dispose();
    }
    hazards.splice(hazards.indexOf(hz), 1);
  }

  function updateHazards(dt) {
    for (let i = hazards.length - 1; i >= 0; i--) {
      const hz = hazards[i];
      for (const puff of hz.puffs) {
        puff.userData.phase += dt * 0.6;
        puff.position.y = puff.userData.baseY + Math.sin(puff.userData.phase) * 0.6 + (hz.maxLife ? (hz.maxLife - hz.life) * 0.35 : 0);
      }
      if (!hz.maxLife) continue;
      hz.life -= dt;
      const fade = Math.max(0, Math.min(1, hz.life / 6));
      for (const puff of hz.puffs) puff.material.opacity = 0.42 * fade;
      if (hz.life <= 0) removeHazard(hz);
    }
  }

  // Biome clouds come with the battlefield (city smoke and dust over fires,
  // jungle mist, pass dust). Water volumes refract beams but never blind
  // seekers, so they live in their own list (js/battlefield.js).
  for (const spec of field.hazards) addHazard(spec);
  const waterVolumes = field.waterVolumes;
  const beamVolumes = () => (waterVolumes.length ? hazards.concat(waterVolumes) : hazards);
  let hitMeshes = [];
  let uid = 1;
  let ended = false;
  let paused = false;
  let manual = false;
  let isolate = false;
  let pacify = !!(window.__ZOIDS__ && window.__ZOIDS__.pacifyOnStart);
  if (window.__ZOIDS__) window.__ZOIDS__.pacifyOnStart = false;
  let helpOn = false;
  let cameraMode = "tps";
  // View elevation limits (radians): about +69 deg up, -52 deg down.
  const PITCH_UP = 1.2;
  const PITCH_DOWN = -0.9;
  const DEFAULT_PITCH = -0.14;
  // Sniper scope (hold RMB with a sniper weapon selected): 4x, a second click 8x.
  const BASE_FOV = 60;
  const SCOPE_STEPS = [4, 8];
  let scopeHeld = false;
  let lastAlt = false;
  let altLatch = false;
  let scopeStep = 0;
  let scopeMix = 0;
  let endTimer = 0;
  let endVictory = false;
  let missionTime = 0;
  // Test-only bot pilot (window.__ZOIDS__.autopilot): scout to the nearest
  // hostile, lock it, close to ~60 m and fire every group. Used by the escort
  // winnability sim; never on in normal play.
  let autopilot = false;
  let autoTarget = null;
  function autopilotInput() {
    const idle = {
      forward: 0, strafe: 0, turn: 0, boost: false, groups: [false, false, false, false],
      dx: 0, dy: 0, tab: false, nearest: false, camera: false, help: false, skill: false,
    };
    if (!player.alive) return idle;
    const px = player.model.root.position.x;
    const pz = player.model.root.position.z;
    let best = null;
    let bestD = Infinity;
    for (const u of units) {
      if (!u.alive || u.team !== "enemy") continue;
      const d = Math.hypot(u.model.root.position.x - px, u.model.root.position.z - pz);
      if (d < bestD) { bestD = d; best = u; }
    }
    autoTarget = best;
    if (!best) {
      // Nothing left: shadow the convoy.
      const lead = trucks.find((t) => t.alive);
      if (lead) {
        const dz = lead.model.root.position.z - 25 - pz;
        player.lookYaw = yawToFace(lead.model.root.position.x - px, dz);
        return { ...idle, forward: Math.abs(dz) > 15 ? 1 : 0 };
      }
      return idle;
    }
    player.lockId = best.id;
    const bx = best.model.root.position.x;
    const bz = best.model.root.position.z;
    player.lookYaw = yawToFace(bx - px, bz - pz);
    player.lookPitch = DEFAULT_PITCH;
    // Stand off just inside the longest fitted gun, back-pedal and strafe when
    // a raider closes, so it fights like a cautious pilot rather than charging.
    const reach = Math.max(60, ...player.weapons.map((w) => w.optimal || 0));
    const fire = bestD < Math.max(...player.weapons.map((w) => w.range || 0));
    const forward = bestD > reach + 20 ? 1 : bestD < reach * 0.7 ? -1 : 0;
    const strafe = Math.sin(missionTime * 0.6) > 0 ? 1 : -1;
    return { ...idle, forward, strafe: bestD < reach + 30 ? strafe : 0, boost: bestD > reach + 120, groups: [fire, fire, fire, fire] };
  }
  let kills = 0;
  const messages = [];
  const hits = { front: 0, back: 0, left: 0, right: 0 };
  let vignette = 0;
  let targetIndex = 0;
  const yawRig = new Vector3();
  const raycaster = new Raycaster();
  const inputDevice = createInput();
  inputDevice.mount(renderer.domElement);
  let lastGroups = [false, false, false, false];
  const screenCenterNdc = new Vector2(0, 0);
  const hud = createHUD(host.querySelector("#hud"));

  const zoidId = state.selected;
  const hangarSlot = state.hangar[zoidId];
  const playerWeapons = [];
  for (const [mount, wid] of Object.entries(hangarSlot.equipped)) {
    if (!wid) continue;
    const item = state.inventory.find((w) => w.uid === wid);
    if (item) playerWeapons.push({ uid: item.uid, type: item.type, group: item.group || 1, mount });
  }

  // Escort: long route, ambush spawned mid-route (js/escort.js).
  const escort = contract.type === "defend" ? escortLayout(contract) : null;
  const spawnZ = escort ? escort.playerZ : 90;
  const tuning = aiTuning(contract.difficulty || 1);
  const diffSpec = difficultySpec(contract.difficulty || 1);
  let ambushSeen = false;
  const player = spawnUnit(ZOIDS[zoidId], {
    team: "player",
    name: ZOIDS[zoidId].name,
    x: 0,
    z: spawnZ,
    yaw: 0,
    weapons: playerWeapons,
    armorLevels: hangarSlot.armorLevel,
    condition: hangarSlot.condition,
    mods: hangarSlot.mods,
    weight: undefined,
  });
  player.lookYaw = 0;
  player.lookPitch = DEFAULT_PITCH;

  const beacons = [];
  let trucks = [];
  const markers = [];
  if (contract.type === "recon") {
    for (const spot of [
      { x: 80, z: 10 },
      { x: -90, z: -80 },
      { x: 40, z: -190 },
    ]) {
      const beacon = { ...spot, progress: 0, done: false, label: "SCAN" };
      beacons.push(beacon);
    }
  }

  let generator = null;
  if (contract.type === "assault") {
    const baseZ = spawnZ - 170;
    addBuilding(0, baseZ + 24, 16, 8, 6, 0x6a5a48);
    addBuilding(-22, baseZ - 6, 10, 10, 5, 0x5c5144);
    addBuilding(22, baseZ - 4, 12, 8, 7, 0x4e453c);
    generator = spawnUnit(STRUCTURES.baseGenerator, {
      team: "enemy",
      name: "Base Generator",
      x: 0,
      z: baseZ,
      weapons: [],
    });
    spawnUnit(STRUCTURES.gunTurret, {
      team: "enemy",
      name: "Turret 1",
      x: -16,
      z: baseZ + 16,
      weapons: stockWeaponsFor(STRUCTURES.gunTurret, rng),
      brain: true,
      brainTune: tuning,
    });
    spawnUnit(STRUCTURES.gunTurret, {
      team: "enemy",
      name: "Turret 2",
      x: 18,
      z: baseZ + 8,
      weapons: stockWeaponsFor(STRUCTURES.gunTurret, rng),
      brain: true,
      brainTune: tuning,
    });
  }

  if (contract.type === "defend") {
    trucks = [-8, 8].map((x, i) => spawnUnit(STRUCTURES.supplyTruck, {
      team: "player",
      name: `Supply Truck ${i + 1}`,
      x,
      z: escort.truckZ,
      yaw: 0,
      weapons: [],
      scripted: true,
    }));
    for (const truck of trucks) {
      // Tougher trucks on easier contracts (difficulty table truckArmor).
      for (const part of Object.values(truck.parts)) {
        part.maxArmor *= diffSpec.truckArmor;
        part.armor *= diffSpec.truckArmor;
        part.maxStructure *= diffSpec.truckArmor;
        part.structure *= diffSpec.truckArmor;
      }
      truck.script = (unit, dt) => {
        if (!unit.alive) return;
        unit.model.root.rotation.y = 0;
        unit.model.root.updateMatrixWorld(true);
        const fwd = facingDirection(unit.model.root, new Vector3());
        unit.model.root.position.addScaledVector(fwd, unit.def.speed * dt);
        unit.speed = unit.def.speed;
      };
    }
  }

  if (contract.type === "recon") {
    for (const beacon of beacons) {
      beacon.marker = addObjectiveMarker({
        x: beacon.x,
        z: beacon.z,
        color: 0xffdd66,
        css: "#ffd35a",
        label: "SCAN",
        kind: "survey",
      });
    }
  }
  if (contract.type === "assault" && generator) {
    addObjectiveMarker({
      x: generator.model.root.position.x,
      z: generator.model.root.position.z,
      color: 0xff4455,
      css: "#ff6677",
      label: "GEN",
      kind: "assault",
    });
  }
  if (contract.type === "defend") {
    addObjectiveMarker({
      x: 0,
      z: escort.exitZ,
      color: 0x7dffb2,
      css: "#7dffb2",
      label: "EXIT",
      kind: "escort",
    });
  }

  const waves = contract.waves || [{ at: 0, enemies: contract.enemies }];
  const spawnedWaves = new Set();

  function runtimeWeapon(w, def) {
    const spec = WEAPONS[w.type];
    const turret = turretSpecFor(def, { ...spec, mount: w.mount });
    return {
      ...spec,
      turret,
      arc: weaponArc(def, { ...spec, mount: w.mount, turret }),
      turretState: turret ? { yaw: turret.rest } : null,
      turretFired: 0,
      uid: w.uid,
      mount: w.mount,
      group: w.group || 1,
      cooldown: weaponRng() * 0.3,
      charge: 0,
      charging: false,
      heatGauge: 0,
      overheated: false,
      spin: 0,
      bloomNow: 0,
      burstLeft: 0,
      burstTimer: 0,
      beamLeft: 0,
    };
  }

  function runtimeMelee(def) {
    return {
      ...standardMeleeFor(def),
      turret: null,
      arc: weaponArc(def, { innate: true, mount: "headWeapon" }),
      turretState: null,
      turretFired: 0,
      uid: `melee-${def.id}`,
      group: 0,
      cooldown: 0,
      charge: 0,
      charging: false,
      heatGauge: 0,
      overheated: false,
      spin: 0,
      bloomNow: 0,
      burstLeft: 0,
      burstTimer: 0,
      beamLeft: 0,
      swing: null,
    };
  }

  function spawnUnit(def, opts) {
    const id = `u${uid++}`;
    const weapons = (opts.weapons || []).map((w) => runtimeWeapon(w, def));
    // Standard melee (js/catalog.js STANDARD_MELEE): free, always fitted.
    if (!def.immobile && def.layout !== "structure") weapons.push(runtimeMelee(def));
    const armorLevels = opts.armorLevels || {};
    const parts = createParts(def, armorLevels);
    applyCondition(parts, opts.condition);
    const mods = opts.mods || { speed: 0, maneuver: 0, booster: 0 };
    // Spawn validity: never inside cover, on a cliff or in deep water.
    if (!opts.scripted && !opts.exact) {
      const spot = findFreeSpot(field, opts.x, opts.z, def.radius || 2);
      opts = { ...opts, x: spot.x, z: spot.z };
    }
    const model = buildUnitModel(def, opts.weapons || [], opts.team);
    tagOwner(model.root, id);
    model.root.position.set(opts.x, map.heightAt(opts.x, opts.z), opts.z);
    model.root.rotation.y = opts.yaw || 0;
    scene.add(model.root);
    const unit = {
      id,
      name: opts.name || def.name,
      def,
      team: opts.team,
      parts,
      model,
      weapons,
      mods,
      weight: opts.weight != null ? opts.weight : weightOf(def, weapons, armorLevels, mods),
      speed: 0,
      strafeVel: 0,
      lookYaw: opts.yaw || 0,
      lookPitch: DEFAULT_PITCH,
      alive: true,
      heat: 0,
      shutdown: 0,
      boosting: false,
      skill: initSkill(def.id),
      brain: opts.brain ? createBrain(rng, opts.brainTune || {}) : null,
      fireRateMul: opts.brain && opts.brainTune ? opts.brainTune.fireRate || 1 : 1,
      provokedBy: null,
      provokedUntil: 0,
      cmd: null,
      aiTarget: null,
      lockId: null,
      script: null,
      scripted: !!opts.scripted,
      radius: def.radius || 2,
      perf: null,
      flightSpec: flightSpec(def),
      flight: flightSpec(def) ? createFlight(model.root.position.y) : null,
      climbCmd: 0,
      vel3: { x: 0, y: 0, z: 0 },
    };
    computeHitVolume(unit);
    units.push(unit);
    return unit;
  }

  function paintMarker(marker, text) {
    // Re-upload the label texture only when the text changes.
    if (marker.lastText === text) return;
    marker.lastText = text;
    const ctx = marker.canvas.getContext("2d");
    ctx.clearRect(0, 0, marker.canvas.width, marker.canvas.height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(8, 8, 240, 48);
    ctx.fillStyle = marker.css;
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 32);
    marker.sprite.material.map.needsUpdate = true;
  }

  function addObjectiveMarker(spec) {
    const groundY = map.heightAt(spec.x, spec.z);
    const height = 76;
    const pillar = new Mesh(
      new CylinderGeometry(0.85, 1.35, height, 10),
      new MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.72,
        fog: false,
        depthWrite: false,
      }),
    );
    pillar.position.set(spec.x, groundY + height * 0.5, spec.z);
    scene.add(pillar);
    const cap = new Mesh(
      new SphereGeometry(1.8, 12, 8),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        fog: false,
        depthTest: false,
      }),
    );
    cap.position.set(spec.x, groundY + height + 1.2, spec.z);
    cap.renderOrder = 20;
    scene.add(cap);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({
      map: texture,
      transparent: true,
      fog: false,
      depthTest: false,
    }));
    sprite.position.set(spec.x, groundY + height * 0.62, spec.z);
    sprite.scale.set(18, 4.5, 1);
    sprite.renderOrder = 30;
    scene.add(sprite);
    const marker = {
      ...spec,
      y: groundY + height * 0.72,
      pillar,
      cap,
      sprite,
      canvas,
      height,
    };
    markers.push(marker);
    paintMarker(marker, spec.label);
    return marker;
  }

  function addBuilding(x, z, w, d, h, color) {
    const mesh = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.05 }),
    );
    const y = map.heightAt(x, z);
    mesh.position.set(x, y + h / 2, z);
    mesh.userData.block = true;
    scene.add(mesh);
    field.addBlocker({ shape: "aabb", x, z, hw: w / 2, hd: d / 2, h, base: y, kind: "building", mesh });
  }

  function spawnWave(wave, index) {
    const fwd = facingDirection(player.model.root, new Vector3());
    const right = new Vector3().crossVectors(fwd, UP);
    wave.enemies.forEach((entry, i) => {
      const def = ZOIDS[entry.zoidId];
      if (!def) return;
      const level = diffSpec.armorLevel;
      const armorLevels = {};
      for (const id of partListFor(def)) armorLevels[id] = level;
      const weapons = stockWeaponsFor(def, rng);
      let x;
      let z;
      const side = (i - (wave.enemies.length - 1) / 2) * 18;
      let guard = null;
      if (contract.type === "assault" && generator) {
        x = generator.model.root.position.x + side;
        z = generator.model.root.position.z + 18 + i * 8;
      } else if (escort) {
        const spot = escort.ambush[Math.min(escort.ambush.length - 1, (wave.ambush || 1) - 1)];
        x = spot.x + side;
        z = spot.z - i * 6;
        guard = { x: spot.x, z: spot.z, radius: escort.guardRadius };
      } else {
        const dist = 32 + index * 10 + i * 12;
        x = player.model.root.position.x + fwd.x * dist + right.x * side;
        z = player.model.root.position.z + fwd.z * dist + right.z * side;
      }
      const unit = spawnUnit(def, {
        team: "enemy",
        name: entry.name,
        x,
        z,
        weapons,
        armorLevels,
        brain: true,
        brainTune: { ...tuning, guard, prefersObjective: escort ? true : undefined },
      });
      const face = yawToFace(player.model.root.position.x - x, player.model.root.position.z - z);
      unit.model.root.rotation.y = face;
      unit.lookYaw = face;
    });
    rebuildHits();
  }

  // Hit volume (js/targeting.js): compound boxes from the real part meshes in
  // the root frame, measured once at spawn (and again when a weapon is swapped).
  function computeHitVolume(unit) {
    const root = unit.model.root;
    const pos = root.position.clone();
    const rot = root.rotation.clone();
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const meshBoxes = [];
    const b = new Box3();
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.userData || !obj.userData.partId || obj.name === "iff") return;
      b.makeEmpty();
      b.expandByObject(obj, true);
      if (b.isEmpty()) return;
      meshBoxes.push({ partId: obj.userData.partId, min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } });
    });
    root.position.copy(pos);
    root.rotation.copy(rot);
    root.updateMatrixWorld(true);
    const boxes = buildHitBoxes(meshBoxes, unit.radius);
    unit.hitBoxes = boxes;
    unit.aimLocal = centerOfMass(boxes);
    const all = boundsOf(boxes);
    unit.hitBounds = all;
    unit.hitSphere = Math.max(...[all.min, all.max].flatMap((q) => [Math.abs(q.x), Math.abs(q.z)])) + Math.max(Math.abs(all.min.y), Math.abs(all.max.y));
  }
  const hitStandIns = new Map();
  function hitStandIn(ownerId, partId) {
    const key = `${ownerId}|${partId}`;
    let o = hitStandIns.get(key);
    if (!o) { o = { userData: { ownerId, partId } }; hitStandIns.set(key, o); }
    return o;
  }
  function rootFrame(unit) {
    const p = unit.model.root.position;
    return { x: p.x, y: p.y, z: p.z, yaw: unit.model.root.rotation.y };
  }
  // Nearest Zoid hit volume along a ray (world). { distance, point, object }.
  function rayUnits(origin, dir, ignoreId, maxDist, near) {
    let best = null;
    for (const unit of units) {
      if (!unit.alive || unit.id === ignoreId || !unit.hitBoxes) continue;
      const p = unit.model.root.position;
      // Sphere reject around the root.
      const ox = p.x - origin.x, oy = p.y - origin.y, oz = p.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      const R = unit.hitSphere || 10;
      if (t < -R || t > maxDist + R) continue;
      const cx = origin.x + dir.x * t - p.x, cy = origin.y + dir.y * t - p.y, cz = origin.z + dir.z * t - p.z;
      if (cx * cx + cy * cy + cz * cz > R * R) continue;
      const frame = rootFrame(unit);
      const lo = toLocal(origin, frame);
      const ld = dirToLocal(dir, frame.yaw);
      const hit = rayHitBoxes(lo, ld, unit.hitBoxes, best ? best.distance : maxDist, near);
      if (hit && (!best || hit.t < best.distance)) {
        best = { distance: hit.t, point: new Vector3(origin.x + dir.x * hit.t, origin.y + dir.y * hit.t, origin.z + dir.z * hit.t), object: hitStandIn(unit.id, hit.partId) };
      }
    }
    return best;
  }

  function rebuildHits() {
    // Only Zoid part meshes are raycast; terrain and hard cover are tested
    // analytically (js/battlefield.js rayGround / rayBlockers).
    hitMeshes = [];
    for (const unit of units) {
      if (!unit.alive) continue;
      unit.model.root.traverse((obj) => {
        if (obj.isMesh && obj.userData && obj.userData.partId) hitMeshes.push(obj);
      });
    }
  }

  // AI battlefield helpers (js/ai.js ctx.nav). Line of sight is cached per
  // unit for 0.25 s; steering probes ahead for cover, cliffs and the map edge.
  function eyeOf(unit) {
    const p = unit.model.root.position;
    return { x: p.x, y: p.y + (unit.radius || 2) * 0.9, z: p.z };
  }
  function losBetween(a, b) {
    const t = lockAimPoint(b);
    return !lineBlocked(field, eyeOf(a), { x: t.x, y: t.y, z: t.z });
  }
  // Radar contacts (js/sensors.js): terrain, spires and very tall buildings
  // hide a contact unless it is inside the close-detection radius; a lost
  // contact stays live for SENSOR.freshTime, then leaves a fading
  // last-known marker until SENSOR.memoryTime. Player and AI share the rule.
  const AI_RADAR_RANGE = 230;
  function playerRadarRange() {
    const perf = player.perf || derivePerformance(player.def, player.mods, player.parts, player.weight);
    return (perf.sensors.radar ? 230 : 42) * perf.sensors.rangeMul * radarMul(player);
  }
  function radarEye(unit) {
    const p = unit.model.root.position;
    return { x: p.x, y: p.y + (unit.radius || 2) * 0.9 + 1.5, z: p.z };
  }
  let radarChecks = 0;
  function senseContact(obs, tgt) {
    if (!obs.tracks) obs.tracks = new Map();
    let tr = obs.tracks.get(tgt.id);
    const q = tgt.model.root.position;
    if (!tr || missionTime - tr.checkedAt >= SENSOR.recheck || missionTime < tr.checkedAt) {
      const p = obs.model.root.position;
      const dist = Math.hypot(q.x - p.x, q.z - p.z);
      const range = obs === player ? playerRadarRange() : AI_RADAR_RANGE;
      const stealth = stealthMul(tgt.speed, nav.heatFrac(tgt));
      let seen = false;
      let blocked = false;
      if (tgt.alive && dist <= range * stealth) {
        if (dist <= SENSOR.closeRadius * stealth) seen = true;
        else {
          const a = lockAimPoint(tgt);
          radarChecks++;
          blocked = !!radarBlocked(field, radarEye(obs), { x: a.x, y: a.y, z: a.z });
          seen = !blocked;
        }
      }
      tr = updateTrack(tr, seen, q.x, q.z, missionTime);
      Object.assign(tr, { checkedAt: missionTime, visible: seen, blocked, dist, stealth });
      obs.tracks.set(tgt.id, tr);
    }
    const st = trackState(tr, missionTime);
    if (st.state === "live" && tgt.alive) {
      // Fresh track: the radar still follows it for a moment.
      tr.x = q.x;
      tr.z = q.z;
    }
    return { state: st.state, fade: st.fade, age: st.age, visible: tr.visible, blocked: tr.blocked, x: tr.x, z: tr.z, stealth: tr.stealth };
  }
  const nav = {
    sense: (unit, target) => senseContact(unit, target),
    // Centre of mass (js/targeting.js), the same point the player's lock uses.
    aimPoint: (target) => lockAimPoint(target),
    los(unit, target) {
      const c = unit.losCache;
      if (c && c.id === target.id && missionTime - c.t < 0.25) return c.v;
      const v = losBetween(unit, target);
      unit.losCache = { id: target.id, t: missionTime, v };
      return v;
    },
    heatFrac(unit) {
      let m = 0;
      for (const w of unit.weapons) m = Math.max(m, (w.heatGauge || 0) / 100);
      return m;
    },
    cover(unit, target) {
      const p = unit.model.root.position;
      const t = target.model.root.position;
      return coverPoint(field, { x: p.x, z: p.z }, { x: t.x, y: t.y + (target.radius || 2), z: t.z }, unit.radius || 2.5, 70);
    },
    steer(unit, yaw, prefer) {
      const p = unit.model.root.position;
      return steerYaw(field, p.x, p.z, yaw, unit.radius || 2.5, 10 + (unit.radius || 2.5) * 2, prefer || 1);
    },
    // Next waypoint toward (gx, gz) when the straight walk is blocked
    // (city blocks, canyon walls, deep water); null when the way is clear.
    // Routes are re-planned at most every 1.5 s or when the goal moves 25 m.
    route(unit, gx, gz) {
      const p = unit.model.root.position;
      let r = unit.navRoute;
      if (!r || missionTime > r.until || Math.hypot(r.gx - gx, r.gz - gz) > 25) {
        const direct = walkClear(field, p, { x: gx, z: gz }, unit.radius || 2.5);
        r = unit.navRoute = { until: missionTime + 1.5, gx, gz, pts: direct ? null : findPath(field, p, { x: gx, z: gz }, unit.radius || 2.5), i: 0 };
        if (r.pts) unit.navRoutes = (unit.navRoutes || 0) + 1;
      }
      if (!r.pts) return null;
      if (missionTime >= (r.nextCheck || 0)) {
        r.i = nextWaypoint(field, p, r.pts, r.i, unit.radius || 2.5);
        r.nextCheck = missionTime + 0.3;
      }
      return r.pts[r.i];
    },
  };

  function plant(unit) {
    const pos = unit.model.root.position;
    pos.y = map.heightAt(pos.x, pos.z);
  }

  // Obstacle tops (world y), measured once from their meshes, so flyers can
  // pass over rocks and buildings.
  const topBox = new Box3();
  function obstacleTops() {
    for (const o of obstacles) {
      if (o.top != null || !o.mesh) continue;
      o.mesh.updateMatrixWorld(true);
      o.top = topBox.setFromObject(o.mesh).max.y;
    }
    return obstacles;
  }

  // Generic flyer step (js/flight.js). Physics altitude lives in
  // root.position.y; pitch and bank tilt only the visual group.
  function flyUnit(unit, dt) {
    const spec = unit.flightSpec;
    const st = unit.flight;
    const pos = unit.model.root.position;
    st.y = pos.y;
    const ground = map.heightAt(pos.x, pos.z);
    const floor = floorAt(pos.x, pos.z, ground, field.near(pos.x, pos.z, unit.radius + 20, []), unit.radius);
    if (st.y < floor - 0.5 && !st.airborne) st.y = floor;
    const yaw = unit.model.root.rotation.y;
    const turnRate = dt > 0 ? wrapAngle(yaw - (unit.prevYaw ?? yaw)) / dt : 0;
    unit.prevYaw = yaw;
    const falling = !unit.alive || shouldFall(unit.parts);
    stepFlight(st, spec, { climb: unit.climbCmd || 0, airspeed: Math.max(0, unit.speed), turnRate }, floor, ground, dt, falling);
    pos.y = st.y;
    unit.model.visual.rotation.set(st.pitch, 0, st.bank);
    if (st.crashed && unit.alive && !unit.crashApplied) {
      unit.crashApplied = true;
      if (unit === player) pushMessage("Wings gone. Crashed!");
      killUnit(unit, unit.provokedBy || null);
    }
  }

  const nearScratch = [];
  function resolveObstacles(unit) {
    const pos = unit.model.root.position;
    const airborne = unit.flight && unit.flight.airborne;
    for (const obstacle of field.near(pos.x, pos.z, unit.radius + 20, nearScratch)) {
      // Flyers above an obstacle's top pass over it.
      if (unit.flight && obstacle.top != null && pos.y >= obstacle.top - 0.3) continue;
      let overlap = false;
      if (obstacle.shape === "circle") {
        const dx = pos.x - obstacle.x;
        const dz = pos.z - obstacle.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const min = obstacle.r + unit.radius * 0.65;
        if (dist < min) {
          overlap = true;
          if (!crushProp(unit, obstacle)) {
            const push = (min - dist) / dist;
            pos.x += dx * push;
            pos.z += dz * push;
          }
        }
      } else if (obstacle.shape === "aabb") {
        const hx = obstacle.hw + unit.radius * 0.7;
        const hz = obstacle.hd + unit.radius * 0.7;
        const dx = pos.x - obstacle.x;
        const dz = pos.z - obstacle.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          overlap = true;
          if (!crushProp(unit, obstacle)) {
            const penX = hx - Math.abs(dx);
            const penZ = hz - Math.abs(dz);
            if (penX < penZ) pos.x += Math.sign(dx || 1) * penX;
            else pos.z += Math.sign(dz || 1) * penZ;
          }
        }
      }
      if (overlap) unit.bumped = missionTime;
    }
    // Canyon walls: ground Zoids cannot climb cliffs, and a Zoid only fits
    // where its body does (superheavies stay out of the narrow ledge).
    // Slide back along the free axis, else stay where we were.
    const rr = unit.radius || 2.5;
    if (!airborne && !unit.scripted && unit.prevPos && Math.hypot(pos.x - unit.prevPos.x, pos.z - unit.prevPos.z) < 10
      && terrainBlocked(field, pos.x, pos.z, rr) && !terrainBlocked(field, unit.prevPos.x, unit.prevPos.z, rr)) {
      const px = unit.prevPos.x;
      const pz = unit.prevPos.z;
      if (!terrainBlocked(field, px, pos.z, rr)) pos.x = px;
      else if (!terrainBlocked(field, pos.x, pz, rr)) pos.z = pz;
      else {
        pos.x = px;
        pos.z = pz;
      }
      unit.bumped = missionTime;
    }
    const limit = PLAY_LIMIT;
    pos.x = clamp(pos.x, -limit, limit);
    pos.z = clamp(pos.z, -limit, limit);
  }

  // Destructible props (cars, barriers, saplings, small boulders).
  let propsDestroyed = 0;
  function destroyProp(blocker, by) {
    if (blocker.dead) return;
    blocker.dead = true;
    propsDestroyed += 1;
    map.hideProp(blocker);
    const at = new Vector3(blocker.x, blocker.base + Math.min(3, blocker.h * 0.5), blocker.z);
    flash(at, blocker.kind === "sapling" ? 0x7aa04a : 0xffaa55, blocker.kind === "car" ? 1.6 : 0.9);
    if (blocker.kind === "car") burst(at);
    if (by === player && blocker.kind !== "sapling") pushMessage(`${blocker.kind === "car" ? "Wreck" : blocker.kind === "barrier" ? "Barrier" : "Boulder"} destroyed`);
  }
  function damageProp(blocker, amount, by) {
    if (!blocker || !blocker.hp || blocker.dead) return;
    blocker.hp -= amount;
    if (blocker.hp <= 0) destroyProp(blocker, by);
  }
  // Superheavies (and anything at least the prop's crush radius) walk
  // straight through small props.
  function crushProp(unit, blocker) {
    if (!blocker.crush || blocker.dead || (unit.flight && unit.flight.airborne)) return false;
    if ((unit.radius || 0) < blocker.crush) return false;
    destroyProp(blocker, unit);
    return true;
  }

  function separateUnits() {
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i];
        const b = units[j];
        if (!a.alive || !b.alive) continue;
        if (Math.abs(b.model.root.position.y - a.model.root.position.y) > 5) continue;
        const dx = b.model.root.position.x - a.model.root.position.x;
        const dz = b.model.root.position.z - a.model.root.position.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const min = (a.radius + b.radius) * 0.72;
        if (dist >= min) continue;
        const push = ((min - dist) / dist) * 0.5;
        if (!a.def.immobile && !a.scripted) {
          a.model.root.position.x -= dx * push;
          a.model.root.position.z -= dz * push;
        }
        if (!b.def.immobile && !b.scripted) {
          b.model.root.position.x += dx * push;
          b.model.root.position.z += dz * push;
        }
      }
    }
  }

  // Nose direction. getWorldDirection is local +Z (the tail); the nose is -Z.
  function facingDirection(object, target) {
    object.updateWorldMatrix(true, false);
    object.getWorldDirection(target);
    target.negate();
    target.y = 0;
    if (target.lengthSq() < 1e-8) target.set(0, 0, -1);
    else target.normalize();
    return target;
  }

  function horizontalBasis(object) {
    const fwd = facingDirection(object, new Vector3());
    // right = forward × up. At yaw 0, forward (0,0,-1) gives right (1,0,0).
    const right = new Vector3().crossVectors(fwd, UP);
    return { fwd, right };
  }

  function moveChassis(unit, dt) {
    const { fwd, right } = horizontalBasis(unit.model.root);
    unit.model.root.position.addScaledVector(fwd, unit.speed * dt);
    unit.model.root.position.addScaledVector(right, unit.strafeVel * dt);
    unit._fwd = fwd;
  }

  function drivePlayer(dt, input) {
    if (!player.alive) return;
    const perf = derivePerformance(player.def, player.mods, player.parts, player.weight);
    player.perf = perf;
    // Scoped: mouse look slows with the zoom (about 1 / zoom^0.8).
    const sens = 1 / Math.pow(scopeZoom(), 0.8);
    player.lookYaw -= input.dx * 0.0023 * sens;
    player.lookYaw -= input.turn * Math.max(0.85, perf.turn) * dt;
    player.lookPitch = clamp(player.lookPitch - input.dy * 0.002 * sens, PITCH_DOWN, PITCH_UP);
    const maxTwist = 0.82;
    let diff = wrapAngle(player.lookYaw - player.model.root.rotation.y);
    player.model.root.rotation.y = wrapAngle(
      player.model.root.rotation.y + clamp(diff, -perf.turn * dt, perf.turn * dt),
    );
    diff = wrapAngle(player.lookYaw - player.model.root.rotation.y);
    if (Math.abs(diff) > maxTwist) {
      player.lookYaw = wrapAngle(player.model.root.rotation.y + Math.sign(diff) * maxTwist);
    }
    const boost = input.boost && input.forward > 0 && perf.boosterReady;
    const skillMul = skillSpeedMul(player);
    const maxSpeed = perf.speed * (boost ? perf.boostMul : 1) * (input.forward < 0 ? 0.55 : 1) * skillMul * (player.wadeMul || 1);
    if (player.flight && player.flight.airborne) {
      // In the air W/S trim airspeed (no reverse); it keeps what it has.
      const goal = input.forward > 0 ? maxSpeed : input.forward < 0 ? 0 : player.speed;
      const thrust = ((player.flightSpec && player.flightSpec.thrust) || 14) * perf.accelMul;
      player.speed = approach(player.speed, goal, (goal > player.speed ? thrust : thrust * 1.3) * dt);
    } else {
      player.speed = approach(player.speed, input.forward * maxSpeed, speedRate(player.speed, input.forward * maxSpeed, perf) * dt);
    }
    player.climbCmd = input.climb || 0;
    player.strafeVel = approach(player.strafeVel, input.strafe * perf.speed * 0.62 * skillMul * (player.wadeMul || 1), 28 * perf.accelMul * dt);
    moveChassis(player, dt);
    player.boosting = boost;
  }

  // Per-Zoid acceleration when speeding up, braking when slowing or reversing.
  function speedRate(current, goal, perf) {
    const speedingUp = Math.abs(goal) > Math.abs(current) && Math.sign(goal || 1) === Math.sign(current || goal || 1);
    return speedingUp ? perf.accel : perf.brake;
  }

  function driveAI(unit, dt) {
    const perf = derivePerformance(unit.def, unit.mods, unit.parts, unit.weight);
    unit.perf = perf;
    const cmd = unit.cmd || { throttle: 0, strafe: 0, yaw: null, fire: false };
    if (cmd.yaw != null && unit.def.build !== "generator") {
      unit.model.root.rotation.y = stepYaw(unit.model.root.rotation.y, cmd.yaw, Math.max(0.2, perf.turn) * dt);
    }
    unit.lookYaw = unit.model.root.rotation.y;
    if (unit.def.immobile) {
      unit.speed = 0;
      unit.strafeVel = 0;
      return;
    }
    const skillMul = skillSpeedMul(unit);
    const maxSpeed = perf.speed * (cmd.throttle < 0 ? 0.55 : 1) * skillMul * (unit.wadeMul || 1);
    const goal = (cmd.throttle || 0) * maxSpeed;
    unit.speed = approach(unit.speed, goal, speedRate(unit.speed, goal, perf) * 0.85 * dt);
    unit.climbCmd = cmd.climb || 0;
    unit.strafeVel = approach(unit.strafeVel, (cmd.strafe || 0) * perf.speed * 0.55 * skillMul, 22 * perf.accelMul * dt);
    moveChassis(unit, dt);
  }

  function aimNegZ(object, dirWorld) {
    const parent = object.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const parentQ = new Quaternion();
    parent.getWorldQuaternion(parentQ);
    const worldQ = new Quaternion().setFromUnitVectors(NEG_Z, dirWorld.clone().normalize());
    object.quaternion.copy(parentQ.invert()).multiply(worldQ);
  }

  // (The old AI-only clamp, +/-0.6 rad yaw and ~75 deg elevation for every
  // mount, is replaced by the per-mount arcs in js/arcs.js for everyone.)

  function clampAim(forward, dir, maxAngle) {
    const f = forward.clone().normalize();
    const d = dir.clone().normalize();
    const dot = clamp(f.dot(d), -1, 1);
    const ang = Math.acos(dot);
    if (ang <= maxAngle || ang < 1e-4) return d;
    const axis = new Vector3().crossVectors(f, d);
    if (axis.lengthSq() < 1e-6) return f;
    axis.normalize();
    return f.applyAxisAngle(axis, maxAngle);
  }

  // Nearest hit along a ray: Zoid parts (three.js raycast), hard cover and
  // terrain (analytic). Cover and ground hits carry a stand-in object whose
  // userData marks block / ground, so callers keep one code path.
  const coverHitObject = { userData: { block: true } };
  function raycast(origin, dir, ignoreId, maxDist) {
    const direction = dir.clone();
    if (direction.lengthSq() < 1e-10) return null;
    direction.normalize();
    raycaster.set(origin, direction);
    raycaster.near = 0.15;
    raycaster.far = maxDist;
    const unitHit = rayUnits(origin, direction, ignoreId, maxDist, 0.15);
    const raw = unitHit ? [unitHit] : [];
    const tagged = raw.map((hit) => {
      const data = hit.object.userData || {};
      return {
        ownerId: data.ownerId || null,
        partId: data.partId || null,
        block: !!data.block,
        ground: !!data.ground,
        hit,
      };
    });
    const cover = rayBlockers(field, origin, direction, maxDist);
    if (cover && cover.t >= 0.15) {
      tagged.push({ ownerId: null, partId: null, block: true, ground: false, hit: {
        distance: cover.t, point: new Vector3(cover.point.x, cover.point.y, cover.point.z), object: coverHitObject, blocker: cover.blocker,
      } });
    }
    const g = rayGround(field, origin, direction, maxDist);
    if (g) {
      tagged.push({ ownerId: null, partId: null, block: false, ground: true, hit: {
        distance: g.t, point: new Vector3(g.point.x, g.point.y, g.point.z), object: map.ground,
      } });
    }
    tagged.sort((a, b) => a.hit.distance - b.hit.distance);
    const chosen = selectAimHit(tagged, ignoreId);
    return chosen ? chosen.hit : null;
  }

  // Screen-center ray. The player's own Zoid is ignored so a third-person
  // camera behind the hull still aims at the point the crosshair covers.
  function cameraAimPoint() {
    if (autopilot && autoTarget && autoTarget.alive) return lockAimPoint(autoTarget);
    if (forcedAimId) {
      const t = units.find((u) => u.id === forcedAimId && u.alive);
      if (t) return lockAimPoint(t);
    }
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(screenCenterNdc, camera);
    const origin = raycaster.ray.origin.clone();
    const direction = raycaster.ray.direction.clone();
    const hit = raycast(origin, direction, player.id, AIM_FAR);
    lastAssist = null;
    // Lock assist (js/targeting.js assistAim): with a locked target under the
    // lock box, the weapons converge at the target's range instead of on
    // whatever is behind it, and a crosshair close to the centre of mass
    // settles on it. Anything solid in front of the target still wins.
    const locked = player.lockId ? units.find((u) => u.id === player.lockId && u.alive) : null;
    if (locked && assistMode !== "off") {
      const cm = lockAimPoint(locked);
      const radii = assistRadii(locked.radius);
      const a = assistAim(origin, direction, cm, radii.snap, radii.box);
      if (a.point) {
        const range = origin.distanceTo(new Vector3(a.point.x, a.point.y, a.point.z));
        const blocker = hit && hit.distance < range - (locked.radius || 2) && !(hit.object.userData && hit.object.userData.ownerId === locked.id);
        if (!blocker) {
          lastAssist = { mode: a.mode, miss: a.miss };
          return new Vector3(a.point.x, a.point.y, a.point.z);
        }
      }
    }
    const point = aimPointAlongRay(origin, direction, hit ? hit.point : null, AIM_FAR);
    return new Vector3(point.x, point.y, point.z);
  }
  let lastAssist = null;
  // "on" (default) or "off" (test probe: the pre-overhaul crosshair rule).
  let assistMode = "on";

  // The arc of the weapon on a mount (the mount's own arc if it is empty).
  function mountArc(unit, mount) {
    const w = unit.weapons.find((x) => x.mount === mount && !x.innate);
    return (w && w.arc) || weaponArc(unit.def, { mount });
  }
  // Clamp a barrel direction to its mount arc and remember, per mount,
  // whether the requested direction was outside it (and where it stops).
  function arcClampDir(unit, mount, dir) {
    const r = clampToArc(unit.model.root.rotation.y, dir, mountArc(unit, mount));
    if (!unit.arcState) unit.arcState = {};
    unit.arcState[mount] = { out: r.out, dir: { x: r.dir.x, y: r.dir.y, z: r.dir.z }, yawOff: r.yawOff, pitchOff: r.pitchOff };
    return new Vector3(r.dir.x, r.dir.y, r.dir.z);
  }
  function outOfArc(unit, weapon) {
    const st = unit.arcState && unit.arcState[weapon.mount];
    return !!(st && st.out);
  }
  // Can this mount reach a world point at all (AI weapon choice)?
  function arcReaches(unit, weapon, point) {
    const anchor = unit.model.anchors[weapon.mount] || unit.model.muzzles[weapon.mount];
    if (!anchor || !weapon.arc) return true;
    const from = new Vector3();
    anchor.getWorldPosition(from);
    return !clampToArc(unit.model.root.rotation.y, { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z }, weapon.arc).out;
  }

  // Barrel local -Z passes through `aimPoint`. The muzzle sits on that axis,
  // so a shot from the muzzle along the returned direction hits the point.
  // Only AI fire is clamped to the chassis. Player shots follow the crosshair.
  function mountAimDirection(unit, mount, aimPoint) {
    const anchor = unit.model.anchors[mount];
    const from = new Vector3();
    if (anchor) anchor.getWorldPosition(from);
    else unit.model.muzzles[mount].getWorldPosition(from);
    const plain = directionToPoint(from, aimPoint);
    let dir = new Vector3(plain.x, plain.y, plain.z);
    if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
    // Mount arc (js/arcs.js), player and AI alike: the barrel stops at the
    // edge of its traverse / elevation and the mount is flagged out of arc.
    dir = arcClampDir(unit, mount, dir);
    if (anchor) aimNegZ(anchor, dir);
    return dir;
  }

  function trackWeapons(unit, dir) {
    for (const [mount, anchor] of Object.entries(unit.model.anchors)) {
      if (mount === "eye" || !unit.model.muzzles[mount] || !anchor.visible) continue;
      if (isTurretMount(unit, mount)) continue;
      aimNegZ(anchor, dir);
    }
  }

  // Hitscan barrels point at the crosshair point. Ballistic barrels rise by the
  // drop solution so the arc meets that same point. aimCheck still uses the
  // direct mountAimDirection, which is the hitscan convergence test.
  // Guns are zeroed at their optimal range (js/weaponsys.js zeroedDir):
  // inside it the arc meets the point, past it the shell lands low.
  function ballisticDirFor(unit, weapon, muzzle, point) {
    const solved = zeroedDir(
      { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      { x: point.x, y: point.y, z: point.z },
      weapon.speed || 80,
      weapon.gravity || BALLISTIC_GRAVITY,
      zeroOf(weapon),
    );
    let dir = new Vector3(solved.dir.x, solved.dir.y, solved.dir.z);
    if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
    dir = arcClampDir(unit, weapon.mount, dir);
    const anchor = unit.model.anchors[weapon.mount];
    if (anchor) aimNegZ(anchor, dir);
    return dir;
  }

  function trackPlayerWeapons(aimPoint) {
    for (const mount of Object.keys(player.model.muzzles)) {
      if (!player.model.muzzles[mount]) continue;
      if (isTurretMount(player, mount)) continue;
      const gun = player.weapons.find((weapon) => weapon.mount === mount && weapon.delivery === "ballistic");
      if (gun) {
        const muzzle = new Vector3();
        player.model.muzzles[mount].getWorldPosition(muzzle);
        ballisticDirFor(player, gun, muzzle, aimPoint);
      } else {
        mountAimDirection(player, mount, aimPoint);
      }
    }
  }

  function trackUnitWeapons(unit, aimPoint) {
    if (unit === player) {
      trackPlayerWeapons(aimPoint);
      return;
    }
    const aim = unit.cmd && unit.cmd.aim
      ? new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z)
      : null;
    if (!aim) {
      trackWeapons(unit, desiredAim(unit));
      return;
    }
    let aimed = false;
    for (const mount of Object.keys(unit.model.muzzles)) {
      if (!unit.model.muzzles[mount]) continue;
      if (isTurretMount(unit, mount)) continue;
      const gun = unit.weapons.find((weapon) => weapon.mount === mount && weapon.delivery === "ballistic");
      if (gun) {
        const muzzle = new Vector3();
        unit.model.muzzles[mount].getWorldPosition(muzzle);
        ballisticDirFor(unit, gun, muzzle, aim);
      } else {
        mountAimDirection(unit, mount, aim);
      }
      aimed = true;
    }
    if (!aimed) trackWeapons(unit, desiredAim(unit));
  }

  // Speed share for movement spread (0 standing, 1 at full stock speed).
  function speedFrac(unit) {
    const top = Math.max(1, (unit.perf && unit.perf.speed) || unit.def.speed || 1);
    return Math.min(1, planarSpeed(unit) / top);
  }

  // Where this unit's weapon is pointed this tick (before spread). Player:
  // the crosshair point. Turret: the locked target. AI: its aim command,
  // led for travelling shots and held over for drop by pilot skill.
  function weaponAimPoint(unit, weapon, aimPoint, muzzle) {
    let point = aimPoint ? aimPoint.clone() : null;
    const ballistic = weapon.delivery === "ballistic";
    if (!point) {
      if (unit.cmd && unit.cmd.aim) {
        point = new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z);
        // AI leads moving targets with travelling shots (3D, so it leads
        // climbing / diving flyers too). Hitscan needs no lead.
        const tgt = unit.aiTarget;
        if (tgt && tgt.alive && !weapon.hitscan && weapon.delivery !== "rocket" && weapon.speed) {
          const led = leadPoint(muzzle, point, tgt.vel3, weapon.speed).point;
          point.set(led.x, led.y, led.z);
        }
      } else {
        const fwd = facingDirection(unit.model.root, new Vector3());
        point = muzzle.clone().addScaledVector(fwd, 80);
      }
    }
    // Turrets lead their locked target with travelling shots too (player and
    // AI): without it a turret gun could not touch a circling flyer.
    if (aimPoint && weapon.turret && !weapon.hitscan && weapon.delivery !== "rocket" && weapon.speed) {
      const tgt = lockTargetOf(unit);
      if (tgt && tgt.alive && tgt.vel3) {
        const led = leadPoint(muzzle, point, tgt.vel3, weapon.speed).point;
        point.set(led.x, led.y, led.z);
      }
    }
    const shotDist = muzzle.distanceTo(point);
    if (unit.brain && unit !== player) {
      // AI aim error grows with the band (ballistics most), on top of the
      // pilot's base scatter (aimError m per 100 m).
      const extra = (unit.brain.aimError || 0) * (shotDist / 100) * (rangeAimMul(weapon, shotDist) - 1);
      if (extra > 0) {
        point.x += (rng() * 2 - 1) * extra;
        point.y += (rng() * 2 - 1) * extra * 0.5;
        point.z += (rng() * 2 - 1) * extra;
      }
    }
    if (ballistic) {
      // Holdover: AI pilots by skill, the player's turret computer at 0.9.
      // The player's own guns get none: the HUD IMPACT mark shows the drop.
      const skill = unit === player ? (weapon.turret ? TURRET_HOLDOVER : 0) : (unit.brain ? unit.brain.holdover : TURRET_HOLDOVER);
      if (skill > 0) {
        const held = holdoverPoint(muzzle, point, weapon, skill);
        point.set(held.x, held.y, held.z);
      }
    }
    return point;
  }

  function shotDirection(unit, weapon, muzzle, point) {
    let dir;
    if (weapon.turret) {
      // Turret: straight from the barrel to the lock, never clamped to the nose.
      if (weapon.delivery === "ballistic") {
        const solved = zeroedDir(muzzle, point, weapon.speed || 80, weapon.gravity || BALLISTIC_GRAVITY, zeroOf(weapon));
        dir = new Vector3(solved.dir.x, solved.dir.y, solved.dir.z);
      } else {
        dir = point.clone().sub(muzzle);
      }
      if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
      dir.normalize();
    } else {
      dir = weapon.delivery === "ballistic"
        ? ballisticDirFor(unit, weapon, muzzle, point)
        : mountAimDirection(unit, weapon.mount, point);
    }
    return dir;
  }

  function jitter(dir, spread, wide) {
    const out = dir.clone();
    if (spread > 0) {
      out.x += (rng() - 0.5) * spread * (wide ? 2 : 1);
      out.y += (rng() - 0.5) * spread;
      out.z += (rng() - 0.5) * spread * (wide ? 2 : 1);
      out.normalize();
    }
    return out;
  }

  function spreadFor(unit, weapon, dist) {
    return shotSpread(weapon, {
      speedFrac: speedFrac(unit),
      heatFrac: (weapon.heatGauge || 0) / 100,
      rangeMul: rangeSpreadMul(weapon, dist),
      skillMul: spreadMul(unit),
    });
  }

  function shoot(unit, weapon, aimPoint) {
    const muzzleObj = unit.model.muzzles[weapon.mount];
    if (!muzzleObj) return;
    const muzzle = new Vector3();
    muzzleObj.getWorldPosition(muzzle);
    const point = weaponAimPoint(unit, weapon, aimPoint, muzzle);
    const shotDist = muzzle.distanceTo(point);
    if (unit.model && unit.model.anim && unit.model.anim.kind === "skinned") {
      unit.model.anim.firePulse = true;
    }
    const dir = shotDirection(unit, weapon, muzzle, point);
    weapon.shots = (weapon.shots || 0) + 1;
    if (weapon.turret) weapon.turretFired = (weapon.turretFired || 0) + 1;
    const mode = fireModeOf(weapon);
    if (mode === "beam") {
      // Sustained beam: the mission ticks it for beamTime (updateBeams).
      weapon.beamLeft = weapon.beamTime || 0.3;
    } else {
      const volley = weapon.volley || 1;
      const spread = spreadFor(unit, weapon, shotDist);
      for (let i = 0; i < volley; i++) {
        const shotDir = jitter(dir, spread, volley > 1);
        if (weapon.hitscan) hitscan(unit, weapon, muzzle, shotDir);
        else spawnProjectile(unit, weapon, muzzle, shotDir);
      }
      addBloom(weapon);
    }
    if (!weapon.skillShot && addWeaponHeat(weapon, heatPerShot(weapon) * heatGenMul(unit))) {
      sfx("alarm");
      if (unit === player) pushMessage(`${weapon.name} overheated`);
    }
    sfx(shotSound(weapon));
    flash(muzzle, weapon.color, 0.35);
  }

  // One tick of every live sustained beam on this unit. Damage is
  // weapon.damage x (tick / beamTime), so a held beam deals its full damage.
  function updateBeams(unit, dt, playerAim) {
    for (const weapon of unit.weapons) {
      if (!(weapon.beamLeft > 0)) continue;
      if (!mountUsable(unit, weapon) || !unit.alive) {
        weapon.beamLeft = 0;
        continue;
      }
      const muzzleObj = unit.model.muzzles[weapon.mount];
      if (!muzzleObj) {
        weapon.beamLeft = 0;
        continue;
      }
      const tick = Math.min(dt, weapon.beamLeft);
      weapon.beamLeft -= tick;
      const frac = tick / Math.max(0.01, weapon.beamTime || 0.3);
      const muzzle = new Vector3();
      muzzleObj.getWorldPosition(muzzle);
      let aim = unit === player && !weapon.turret ? playerAim : null;
      if (weapon.turret) {
        const lock = lockTargetOf(unit);
        if (!lock) { weapon.beamLeft = 0; continue; }
        aim = lockAimPoint(lock);
      }
      const point = weaponAimPoint(unit, weapon, aim, muzzle);
      const dir = shotDirection(unit, weapon, muzzle, point);
      // A held beam swept out of its arc cuts off at the edge.
      if (!weapon.turret && outOfArc(unit, weapon)) { weapon.beamLeft = 0; continue; }
      const spread = spreadFor(unit, weapon, muzzle.distanceTo(point));
      const volley = weapon.volley || 1;
      for (let i = 0; i < volley; i++) hitscan(unit, weapon, muzzle, jitter(dir, spread * 0.5, volley > 1), frac);
    }
  }

  // Shots leaving this weapon this tick. Charge weapons keep the braced
  // full-charge rule; everything else runs the fire-control state machine
  // (bursts, salvos, gatling spin-up, sustained beams).
  function weaponShotCount(unit, weapon, dt, trigger, allowed, moving) {
    if (weapon.chargeTime) {
      const fired = weaponWantsShot(weapon, dt, trigger, allowed, moving);
      if (fired && weapon.rateMul && weapon.rateMul !== 1) weapon.cooldown /= weapon.rateMul;
      return fired ? 1 : 0;
    }
    return stepFireControl(weapon, dt, trigger, allowed);
  }

  function shotSound(weapon) {
    if (weapon.id === "gatling") return "gatling";
    if (weapon.id === "beamCannon") return "beam";
    if (weapon.id === "missilePack") return "missile";
    if (weapon.id === "shockCannon") return "shock";
    if (weapon.id === "chargedParticle") return "cpc";
    return "laser";
  }

  function hitInfo(hit) {
    if (!hit) return null;
    const data = hit.object.userData || {};
    return { owner: data.ownerId || null, part: data.partId || null, ground: !!(data.ground || hit.object === map.ground), block: !!data.block, cover: hit.blocker ? hit.blocker.kind : null, dist: hit.distance };
  }

  // Instant shot (beams, claws). Beams refract through hazards: the beam
  // bends where it enters the cloud and loses damage along the cloud path
  // (js/weaponsys.js). frac scales damage for sustained-beam ticks.
  function hitscan(unit, weapon, origin, dir, frac = 1) {
    const range = weapon.range;
    const refract = weapon.kind === "energy" ? (weapon.refract == null ? 1 : weapon.refract) : 0;
    let path = refract ? hazardPath(origin, dir, range, beamVolumes()) : null;
    let hit = null;
    let start = origin;
    let travel = dir;
    let bent = false;
    if (path && path.length > 0 && path.first) {
      const entryT = path.first.t;
      const pre = raycast(origin, dir, unit.id, entryT);
      if (pre) {
        hit = pre;
        path = null;
      } else {
        const angle = refractAngle(path, refract);
        const bentDir = bendDir({ x: dir.x, y: dir.y, z: dir.z }, angle, rng(), rng());
        start = origin.clone().addScaledVector(dir, entryT);
        travel = new Vector3(bentDir.x, bentDir.y, bentDir.z);
        bent = true;
        hit = raycast(start, travel, unit.id, Math.max(0.5, range - entryT));
        // Damage loss is measured along the bent path actually travelled.
        const remaining = hit ? hit.distance : range - entryT;
        path = hazardPath(start, travel, remaining, beamVolumes());
      }
    } else {
      hit = raycast(origin, dir, unit.id, range);
      path = null;
    }
    const end = hit ? hit.point.clone() : start.clone().addScaledVector(travel, range - origin.distanceTo(start));
    const thin = frac < 1;
    if (bent) {
      beam(origin, start, weapon.color, thin);
      beam(start, end, weapon.color, thin, 0.55);
      scatterFx(start, travel, weapon.color, thin ? 2 : 5);
    } else {
      beam(origin, end, weapon.color, thin);
    }
    const transmission = path ? beamTransmission(path, refract) : 1;
    weapon.lastHit = hit ? { ...hitInfo(hit), refracted: bent, transmission } : null;
    weapon.lastRefraction = bent ? { transmission, path: path ? path.length : 0, kinds: path ? path.kinds : [] } : null;
    if (!hit) { tallyShot(unit.id, weapon.id, "miss"); return; }
    const hitData = hit.object.userData || {};
    tallyShot(unit.id, weapon.id, hitData.ownerId ? "unit" : hitData.block ? "cover" : "ground");
    if (hitData.block || hitData.ground || hit.object === map.ground) {
      if (!thin || rng() < 0.3) flash(hit.point, 0xffcc88, 0.45);
      if (hit.blocker) damageProp(hit.blocker, weapon.damage * frac * transmission, unit);
      return;
    }
    const victim = units.find((u) => u.id === hit.object.userData.ownerId);
    if (!victim || !victim.alive) return;
    const dist = origin.distanceTo(hit.point);
    const amount = weapon.damage * frac * damageMul(unit) * rangeDamageMul(weapon, dist) * transmission;
    if (amount <= 0) return;
    const outcome = applyDamage(victim, hit.object.userData.partId, amount, unit, damageCtxFor(weapon));
    // Energy shields refract beams: a spray of scattered light at the shield.
    if (outcome === "blocked" && weapon.kind === "energy") scatterFx(hit.point, travel.clone().negate(), weapon.color, thin ? 2 : 6);
    if (!thin || rng() < 0.35) flash(hit.point, weapon.color, 0.4);
  }

  // Short faint rays fanning out from a point: the visible beam scatter.
  function scatterFx(point, dir, color, count) {
    for (let i = 0; i < count; i++) {
      const d = bendDir({ x: dir.x, y: dir.y, z: dir.z }, 0.35 + rng() * 0.5, rng(), rng());
      const len = 3 + rng() * 7;
      const to = point.clone().add(new Vector3(d.x, d.y, d.z).multiplyScalar(len));
      beam(point, to, color, false, 0.7, 0.12);
    }
    flash(point, color, 0.6);
  }

  function spawnProjectile(unit, weapon, origin, dir) {
    const speed = weapon.speed || 70;
    const rocket = weapon.delivery === "rocket";
    const gravity = rocket ? 0 : (weapon.gravity || 0);
    const heavy = !rocket && (weapon.damage || 0) >= 20;
    const mesh = new Mesh(
      new SphereGeometry(rocket ? 0.28 : heavy ? 0.34 : 0.22, 8, 6),
      new MeshBasicMaterial({ color: weapon.color }),
    );
    mesh.position.copy(origin);
    scene.add(mesh);
    // Beams and shells stay on the crosshair solution. Only rockets home, and
    // only onto the locked target. Other player rounds are unguided.
    const homing = rocket || (unit !== player && !!weapon.homing);
    const targetId = rocket
      ? (unit.rocketLockId || null)
      : (homing && unit.aiTarget && unit.aiTarget.alive ? unit.aiTarget.id : null);
    const vx = rocket ? dir.x * speed * 0.22 : dir.x * speed;
    const vy = rocket ? speed * 0.96 : dir.y * speed;
    const vz = rocket ? dir.z * speed * 0.22 : dir.z * speed;
    projectiles.push({
      dmgCtx: damageCtxFor(weapon),
      weaponRef: weapon,
      x: origin.x,
      y: origin.y,
      z: origin.z,
      ox: origin.x,
      oy: origin.y,
      oz: origin.z,
      vx,
      vy,
      vz,
      vx0: vx,
      vy0: vy,
      vz0: vz,
      hx: dir.x,
      hz: dir.z,
      t: 0,
      speed,
      gravity,
      delivery: rocket ? "rocket" : (gravity ? "ballistic" : "shell"),
      damage: weapon.damage * damageMul(unit),
      color: weapon.color,
      ownerId: unit.id,
      life: (weapon.range / speed) * (rocket ? 2.6 : 1.7) + 0.5,
      traveled: 0,
      range: weapon.range,
      optimal: weapon.optimal,
      homing,
      turn: rocket ? rocketTurn(unit.rocketStrength || 0) : (homing ? 2.6 : 0),
      targetId,
      age: 0,
      phase: rocket ? "pop" : "",
      popTime: rocketLaunchPop(unit, weapon, targetId, origin),
      diveBias: rocketLaunchBias(unit, targetId, origin),
      mesh,
      // Shell tracer: heavy guns every round, the gatling every 4th.
      trail: !rocket && !!gravity && (weapon.id !== "gatling" || (tracerCount++ % 4 === 0)),
      trailLife: heavy ? 0.9 : 0.35,
    });
  }

  function rocketLaunchRange(targetId, origin) {
    const t = targetId ? units.find((u) => u.id === targetId && u.alive) : null;
    if (!t) return null;
    const p = t.model.root.position;
    return Math.hypot(p.x - origin.x, p.z - origin.z);
  }
  function rocketLaunchPop(unit, weapon, targetId, origin) {
    if (weapon.delivery !== "rocket") return weapon.popTime;
    const d = rocketLaunchRange(targetId, origin);
    return d == null ? weapon.popTime : rocketPopFor(d, weapon.popTime == null ? undefined : weapon.popTime);
  }
  function rocketLaunchBias(unit, targetId, origin) {
    const d = rocketLaunchRange(targetId, origin);
    return d == null ? undefined : rocketDiveBiasFor(d);
  }
  // Proximity fuse: an armed missile that passes within this distance of the
  // target's hit volume bursts on it (it would otherwise slip past a thin
  // target or bury itself just short of a low one).
  function proximityFuse(shot, target, prev) {
    if (!target || !target.hitBoxes) return null;
    const armed = Math.hypot(shot.x - shot.ox, shot.y - shot.oy, shot.z - shot.oz) >= (shot.weaponRef && shot.weaponRef.minRange || 0);
    if (!armed) return null;
    const fuse = 0.6 + 0.12 * (target.radius || 2);
    const frame = rootFrame(target);
    const a = toLocal(prev, frame);
    const b = toLocal({ x: shot.x, y: shot.y, z: shot.z }, frame);
    let best = null;
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
      for (const box of target.hitBoxes) {
        const dx = Math.max(box.min.x - q.x, 0, q.x - box.max.x);
        const dy = Math.max(box.min.y - q.y, 0, q.y - box.max.y);
        const dz = Math.max(box.min.z - q.z, 0, q.z - box.max.z);
        const d = Math.hypot(dx, dy, dz);
        if (d <= fuse && (!best || d < best.d)) best = { d, partId: box.partId, t };
      }
    }
    if (!best) return null;
    const t = best.t;
    return { partId: best.partId, point: new Vector3(prev.x + (shot.x - prev.x) * t, prev.y + (shot.y - prev.y) * t, prev.z + (shot.z - prev.z) * t) };
  }

  function updateProjectiles(dt) {
    for (const shot of projectiles) {
      const target = shot.targetId ? units.find((u) => u.id === shot.targetId && u.alive) : null;
      const prev = { x: shot.x, y: shot.y, z: shot.z };
      const seek = target ? lockAimPoint(target) : null;
      stepProjectile(shot, dt, target ? {
        x: seek.x,
        y: seek.y,
        z: seek.z,
        speed: planarSpeed(target),
        // A target standing in dust / smoke blinds the seeker (homing x0.3).
        blind: !!insideHazard(target.model.root.position, hazards),
      } : null);
      shot.mesh.position.set(shot.x, shot.y, shot.z);
      if (shot.delivery === "rocket" && target && shot.phase === "dive") {
        const fz = proximityFuse(shot, target, prev);
        if (fz) {
          shot.life = 0;
          shot.tallied = true;
          tallyShot(shot.ownerId, shot.weaponRef && shot.weaponRef.id, "unit");
          const attacker = units.find((u) => u.id === shot.ownerId);
          if (attacker) {
            const dist = Math.hypot(fz.point.x - shot.ox, fz.point.y - shot.oy, fz.point.z - shot.oz);
            const amount = shot.damage * rangeDamageMul(shot.weaponRef, dist);
            if (amount > 0) applyDamage(target, fz.partId, amount, attacker, shot.dmgCtx);
          }
          flash(fz.point, shot.color, 0.6);
          continue;
        }
      }
      if (shot.trail) beam(new Vector3(prev.x, prev.y, prev.z), shot.mesh.position, shot.color, true, 0.75, shot.trailLife || 0.35, shot.trailLife > 0.5 ? 0.16 : 0);
      const stepDir = new Vector3(shot.x - prev.x, shot.y - prev.y, shot.z - prev.z);
      const dist = stepDir.length();
      if (dist > 0.001) {
        stepDir.multiplyScalar(1 / dist);
        const hit = raycast(new Vector3(prev.x, prev.y, prev.z), stepDir, shot.ownerId, dist + 0.2);
        if (hit) {
          shot.life = 0;
          const hitData = hit.object.userData || {};
          shot.tallied = true;
          tallyShot(shot.ownerId, shot.weaponRef && shot.weaponRef.id, hitData.ownerId ? "unit" : hitData.block ? "cover" : "ground");
          if (hitData.block || hitData.ground || hit.object === map.ground) {
            flash(hit.point, shot.color, 0.5);
            if (hit.blocker) damageProp(hit.blocker, shot.damage, units.find((u) => u.id === shot.ownerId));
          } else {
            const victim = units.find((u) => u.id === hit.object.userData.ownerId);
            const attacker = units.find((u) => u.id === shot.ownerId);
            if (victim && victim.alive && attacker) {
              const dist = Math.hypot(hit.point.x - shot.ox, hit.point.y - shot.oy, hit.point.z - shot.oz);
              const amount = shot.damage * rangeDamageMul(shot.weaponRef, dist);
              if (amount > 0) applyDamage(victim, hit.object.userData.partId, amount, attacker, shot.dmgCtx);
            }
            flash(hit.point, shot.color, 0.55);
          }
          continue;
        }
      }
      // Ground after the segment test: a fast or steep shot whose step ends
      // below the terrain may already have passed through a low target on the
      // way (a tall Zoid's back gun firing down at a Gun Sniper).
      if (shot.y <= map.heightAt(shot.x, shot.z) + 0.2) {
        shot.life = 0;
        shot.tallied = true;
        tallyShot(shot.ownerId, shot.weaponRef && shot.weaponRef.id, "ground");
        flash(shot.mesh.position.clone(), shot.color, 0.5);
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const shot = projectiles[i];
      if (shot.life <= 0 || shot.traveled > shot.range + 10) {
        if (!shot.tallied) tallyShot(shot.ownerId, shot.weaponRef && shot.weaponRef.id, "miss");
        scene.remove(shot.mesh);
        shot.mesh.geometry.dispose();
        shot.mesh.material.dispose();
        projectiles.splice(i, 1);
      }
    }
  }

  function applyDamage(victim, partId, amount, attacker, dmgCtx = {}) {
    if (!partId || !victim.alive) return "none";
    if (victim.dummy) { victim.dummyDamage = (victim.dummyDamage || 0) + amount; return "hit"; }
    if (attacker && attacker.team !== victim.team && victim.brain) {
      // Getting shot pulls aggro: escort raiders turn on whoever engages them.
      victim.provokedBy = attacker;
      victim.provokedUntil = missionTime + 8;
      if (victim.brain.guard) victim.brain.alerted = true;
    }
    const to = new Vector3(
      attacker.model.root.position.x - victim.model.root.position.x,
      0,
      attacker.model.root.position.z - victim.model.root.position.z,
    );
    if (to.lengthSq() > 1e-6) to.normalize();
    const fwd = facingDirection(victim.model.root, new Vector3());
    const forwardDot = fwd.dot(to);
    const incoming = resolveIncoming(victim, amount, forwardDot);
    if (incoming.blocked) {
      if (victim === player) {
        sfx("alarm");
        pushMessage("Energy shield blocked the hit");
        noteHit(attacker);
      }
      return "blocked";
    }
    const result = applyHit(victim.parts, partId, incoming.amount, { ...dmgCtx, zoidId: victim.def.id, forwardDot });
    refreshPartColors(victim.model, victim.parts);
    const label = PART_LABELS[partId] || partId;
    if (victim === player) {
      sfx("hurt");
      vignette = Math.min(1, vignette + 0.45);
      noteHit(attacker);
      if (result.events.some((e) => e.type === "shield")) pushMessage("Shield caught part of a frontal hit");
      if (result.events.some((e) => e.type === "destroyed")) pushMessage(`${label} destroyed`);
      else if (result.events.some((e) => e.type === "structure")) pushMessage(`${label} structure breached`);
    } else if (attacker === player) {
      sfx("hit");
      if (result.events.some((e) => e.type === "destroyed")) pushMessage(`${victim.name} ${label} destroyed`);
    }
    // Only the blow that actually destroys the core ends the Zoid.
    // Later hits on a dead core still report killed, and must not re-trigger.
    if (result.events.some((e) => e.type === "kill")) killUnit(victim, attacker);
    return "hit";
  }

  function noteHit(attacker) {
    const { fwd, right } = horizontalBasis(player.model.root);
    const rel = new Vector3(
      attacker.model.root.position.x - player.model.root.position.x,
      0,
      attacker.model.root.position.z - player.model.root.position.z,
    );
    if (rel.lengthSq() < 1e-6) return;
    rel.normalize();
    const f = rel.dot(fwd);
    const r = rel.dot(right);
    if (Math.abs(f) > Math.abs(r)) {
      if (f >= 0) hits.front = 1;
      else hits.back = 1;
    } else if (r >= 0) hits.right = 1;
    else hits.left = 1;
  }

  function killUnit(unit, attacker) {
    if (!unit.alive) return;
    unit.alive = false;
    unit.speed = 0;
    sfx("boom");
    burst(unit.model.root.position.clone().setY(unit.model.root.position.y + unit.radius * 0.4));
    unit.model.root.visible = false;
    // Wrecks burn: a smoke column that refracts beams and blinds missile
    // seekers for ~25 s. At most 4 burning at once.
    {
      const burning = hazards.filter((h) => h.maxLife);
      if (burning.length >= 4) removeHazard(burning[0]);
      const p = unit.model.root.position;
      addHazard({ kind: "smoke", x: p.x, z: p.z, r: Math.max(6, (unit.radius || 3) * 1.6), h: 20 }, 25);
    }
    if (attacker === player && unit.team === "enemy" && !unit.def.immobile) kills += 1;
    if (unit.def.immobile && unit.team === "enemy" && attacker === player && unit.def.build !== "generator") {
      kills += 0;
    }
    if (unit === player) {
      pushMessage("Core destroyed. Zoid down.");
      endTimer = 1.5;
      endVictory = false;
    }
    rebuildHits();
  }

  function beam(from, to, color, thin = false, opacity = 1, life = 0, width = 0) {
    const dir = new Vector3().subVectors(to, from);
    const len = Math.max(0.2, dir.length());
    const w = width || (thin ? 0.06 : 0.08);
    const mat = opacity < 1 ? new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }) : new MeshBasicMaterial({ color });
    const mesh = new Mesh(new BoxGeometry(w, w, 1), mat);
    mesh.scale.set(1, 1, len);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    // The beam box is symmetric. lookAt aims its +Z along the shot.
    mesh.lookAt(to);
    mesh.userData.life = life || (thin ? 0.05 : 0.07);
    scene.add(mesh);
    effects.push(mesh);
  }

  function flash(pos, color, size) {
    const mesh = new Mesh(new SphereGeometry(size, 6, 6), new MeshBasicMaterial({ color }));
    mesh.position.copy(pos);
    mesh.userData.life = 0.12;
    mesh.userData.grow = 0;
    scene.add(mesh);
    effects.push(mesh);
  }

  function burst(pos) {
    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(
        new SphereGeometry(0.35 + rng() * 0.4, 6, 6),
        new MeshBasicMaterial({ color: i % 2 ? 0xff7722 : 0xffe08a }),
      );
      mesh.position.copy(pos);
      mesh.userData.life = 0.45;
      mesh.userData.grow = 5 + rng() * 4;
      scene.add(mesh);
      effects.push(mesh);
    }
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const mesh = effects[i];
      mesh.userData.life -= dt;
      if (mesh.userData.grow) mesh.scale.addScalar(mesh.userData.grow * dt);
      if (mesh.userData.life <= 0) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        effects.splice(i, 1);
      }
    }
    for (const key of Object.keys(hits)) hits[key] = Math.max(0, hits[key] - dt * 1.4);
    vignette = Math.max(0, vignette - dt * 0.8);
  }

  function enemies() {
    return units.filter((u) => u.alive && u.team === "enemy");
  }

  // The locked target when there is one, else the cycled contact (HUD only).
  function currentTarget() {
    const list = enemies();
    if (!list.length) return null;
    if (player.lockId) {
      const locked = list.find((u) => u.id === player.lockId);
      if (locked) return locked;
    }
    targetIndex = ((targetIndex % list.length) + list.length) % list.length;
    return list[targetIndex];
  }

  function playerSensorRange() {
    const perf = player.perf || derivePerformance(player.def, player.mods, player.parts, player.weight);
    return sensorRange((perf.sensors && perf.sensors.rangeMul) || 1, radarMul(player));
  }

  // Contacts the player can lock: enemies inside sensor range, with their
  // distance and the angle between the crosshair ray and each one.
  function lockCandidates() {
    camera.updateMatrixWorld(true);
    const view = new Vector3();
    camera.getWorldDirection(view);
    const range = playerSensorRange();
    const cands = enemies().map((u) => {
      const to = lockAimPoint(u).sub(camera.position);
      return { id: u.id, unit: u, dist: u.model.root.position.distanceTo(player.model.root.position), angle: angleDeg(view, to) };
    });
    // Radar-hidden contacts (behind terrain, not fresh) cannot be locked.
    return inSensor(cands.filter((c) => senseContact(player, c.unit).state === "live"), range);
  }

  function setPlayerLock(cand, quiet = false) {
    if (!cand) {
      if (!quiet) pushMessage("No contacts in sensor range");
      return;
    }
    player.lockId = cand.id;
    player.lockLost = 0;
    const idx = enemies().findIndex((u) => u.id === cand.id);
    if (idx >= 0) targetIndex = idx;
  }

  // Tab: next contact in sensor range, nearest first.
  function cycleTarget(step) {
    setPlayerLock(cycleTargets(lockCandidates(), player.lockId, step));
  }

  // R: the contact closest to the crosshair inside the targeting box
  // (TARGET_BOX_DEG), else the nearest contact in sensor range.
  function targetNearest(quiet = false) {
    const cands = lockCandidates();
    setPlayerLock(pickUnderReticle(cands, TARGET_BOX_DEG) || pickNearest(cands), quiet);
  }

  // Lock upkeep: a dead target drops at once; outside sensor range the lock
  // holds for LOCK_LOSS_GRACE seconds, then drops.
  function upkeepPlayerLock(dt) {
    if (!player.lockId) return;
    const t = units.find((u) => u.id === player.lockId);
    const info = t ? { alive: t.alive, inSensor: t.model.root.position.distanceTo(player.model.root.position) <= playerSensorRange() && senseContact(player, t).state === "live" } : null;
    const res = stepTargetLock(player.lockLost || 0, info, dt);
    player.lockLost = res.lostFor;
    if (!res.keep) {
      if (t && t.alive) pushMessage("Target lock lost");
      player.lockId = null;
      player.lockLost = 0;
    }
  }

  // The unit's LOCKED target, the only thing turrets track and fire at.
  // Player: the Tab / R lock. AI: its own chosen target. No fallback.
  function lockTargetOf(unit) {
    if (unit === player) {
      if (!player.lockId) return null;
      const hit = units.find((u) => u.id === player.lockId);
      if (!hit || !hit.alive) {
        player.lockId = null;
        return null;
      }
      return hit;
    }
    return unit.aiTarget && unit.aiTarget.alive && unit.aiTarget.team !== unit.team ? unit.aiTarget : null;
  }

  // Aim at the centre of the target's core meshes (legs leave gaps under a
  // fixed root-height offset), falling back to root + radius height.
  const lockBox = new Box3();
  function lockAimPoint(target) {
    if (target.aimLocal) {
      const w = toWorld(target.aimLocal, rootFrame(target));
      return new Vector3(w.x, w.y, w.z);
    }
    const core = target.model.partMeshes && target.model.partMeshes.core;
    if (core && core.length) {
      lockBox.makeEmpty();
      for (const mesh of core) lockBox.expandByObject(mesh);
      if (!lockBox.isEmpty()) return lockBox.getCenter(new Vector3());
    }
    const p = target.model.root.position;
    return new Vector3(p.x, p.y + (target.radius || 2) * 0.45, p.z);
  }

  function isTurretMount(unit, mount) {
    return unit.weapons.some((weapon) => weapon.turret && weapon.mount === mount);
  }

  // Swing every turret toward the lock (or back to rest) and decide whether it
  // fires this tick. Runs for the player and AI alike, moving or not.
  function updateTurrets(unit, dt) {
    const lock = lockTargetOf(unit);
    const root = unit.model.root;
    for (const weapon of unit.weapons) {
      if (!weapon.turret) continue;
      let bearing = null;
      let dist = Infinity;
      if (lock) {
        const tp = lock.model.root.position;
        bearing = relativeBearing(root.rotation.y, root.position.x, root.position.z, tp.x, tp.z);
        dist = Math.hypot(tp.x - root.position.x, tp.y - root.position.y, tp.z - root.position.z);
      }
      const result = stepTurret(weapon.turretState, weapon.turret, bearing, dt);
      setTurretYaw(unit.model, weapon.mount, weapon.turretState.yaw);
      const anchor = unit.model.anchors[weapon.mount];
      // Elevation: the turret barrel tilts toward the lock inside its
      // elevation window (js/arcs.js); past it, it stops and holds fire.
      let elevOut = false;
      if (anchor && lock) {
        const muzzle = new Vector3();
        anchor.getWorldPosition(muzzle);
        const to = lockAimPoint(lock).sub(muzzle);
        const el = Math.asin(clamp(to.y / Math.max(1e-6, to.length()), -1, 1));
        const arc = weapon.arc || { up: 1.2, down: 0.3 };
        elevOut = el > arc.up + 0.026 || el < -arc.down - 0.026;
      }
      if (elevOut && result) result.onTarget = false;
      if (!unit.arcState) unit.arcState = {};
      unit.arcState[weapon.mount] = { out: !!lock && (!result.inArc || elevOut), dir: null, turret: true };
      if (anchor && anchor.visible) {
        let dir;
        if (lock && result.inArc) {
          const muzzle = new Vector3();
          anchor.getWorldPosition(muzzle);
          dir = lockAimPoint(lock).sub(muzzle);
          const yaw = root.rotation.y + weapon.turretState.yaw;
          const arc = weapon.arc || { up: 1.2, down: 0.3 };
          const r = clampToArc(yaw, dir, { yaw: 0.2, up: arc.up, down: arc.down });
          dir.set(r.dir.x, r.dir.y, r.dir.z);
        } else {
          const yaw = root.rotation.y + weapon.turretState.yaw;
          dir = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        }
        if (dir.lengthSq() > 1e-8) aimNegZ(anchor, dir.normalize());
        if (unit.arcState[weapon.mount]) unit.arcState[weapon.mount].dir = { x: dir.x, y: dir.y, z: dir.z };
      }
      weapon.turretTrigger = turretTrigger(lock ? { alive: lock.alive, dist } : null, result, weapon.range);
      weapon.turretTargetId = lock ? lock.id : null;
      weapon.turretResult = result;
    }
  }

  function pushMessage(text) {
    messages.unshift(text);
    if (messages.length > 4) messages.pop();
  }

  function livingZoids(team) {
    return units.filter((u) => u.alive && u.team === team && !u.def.immobile && u.def.layout !== "vehicle");
  }

  function updateObjectives(dt) {
    if (endTimer > 0) {
      endTimer -= dt;
      if (endTimer <= 0) finish(endVictory);
      return;
    }
    if (!player.alive) return;
    if (contract.type === "destroy") {
      const left = livingZoids("enemy");
      const pending = waves.length - spawnedWaves.size;
      hudObjective = pending > 0
        ? `Destroy hostiles. ${left.length} in the field.`
        : `Destroy hostiles. ${left.length} left.`;
      if (pending <= 0 && left.length === 0) {
        endTimer = 1.1;
        endVictory = true;
        pushMessage("Lance destroyed.");
      }
    } else if (contract.type === "assault") {
      const up = generator && generator.alive;
      hudObjective = up ? "Destroy the base generator." : "Generator down.";
      if (!up) {
        endTimer = 1.1;
        endVictory = true;
        pushMessage("Generator destroyed.");
      }
    } else if (contract.type === "recon") {
      let done = 0;
      for (let i = 0; i < beacons.length; i++) {
        const beacon = beacons[i];
        if (beacon.done) {
          done += 1;
          if (beacon.marker && beacon.marker.css !== "#3dff7a") {
            beacon.marker.css = "#3dff7a";
            beacon.marker.pillar.material.color.setHex(0x3dff7a);
            beacon.marker.pillar.material.opacity = 0.28;
            beacon.marker.cap.material.color.setHex(0x3dff7a);
          }
          continue;
        }
        const dist = Math.hypot(
          player.model.root.position.x - beacon.x,
          player.model.root.position.z - beacon.z,
        );
        if (dist < 16) beacon.progress += dt;
        else beacon.progress = Math.max(0, beacon.progress - dt);
        if (beacon.progress >= 2.5) {
          beacon.done = true;
          pushMessage("Beacon locked.");
        }
      }
      hudObjective = `Scan beacons ${done}/3. Hold inside the column.`;
      if (done === beacons.length) {
        endTimer = 1;
        endVictory = true;
      }
    } else if (contract.type === "defend") {
      const rolling = trucks.filter((t) => t.alive);
      if (!rolling.length) {
        hudObjective = "Convoy lost.";
        endTimer = 1.2;
        endVictory = false;
        pushMessage("Both trucks are gone.");
        return;
      }
      const lead = Math.min(...rolling.map((t) => t.model.root.position.z));
      const ahead = Math.round(Math.max(0, lead - escort.ambush[0].z));
      hudObjective = ambushSeen
        ? `Escort the trucks. ${rolling.length} rolling. Ambush ${ahead} m ahead of the convoy.`
        : `Escort the trucks. ${rolling.length} rolling. Scout ahead for the ambush.`;
      if (!ambushSeen) {
        // Spotted once the player's radar (or the lead truck) reaches it.
        const radar = player.perf && player.perf.sensors ? (player.perf.sensors.radar ? 230 : 42) * player.perf.sensors.rangeMul : 230;
        const spot = escort.ambush[0];
        const pd = Math.hypot(player.model.root.position.x - spot.x, player.model.root.position.z - spot.z);
        if (pd <= radar || ahead <= 150) {
          ambushSeen = true;
          for (const a of escort.ambush) {
            addObjectiveMarker({ x: a.x, z: a.z, color: 0xff3344, css: "#ff5566", label: "AMBUSH", kind: "ambush" });
          }
          pushMessage(`Ambush spotted ${Math.round(pd)} m out. Trucks are ${ahead} m from it.`);
        }
      }
      if (lead < escort.exitZ) {
        endTimer = 1;
        endVictory = true;
        pushMessage("Convoy is through.");
      }
    }
  }

  // A forced biome (tests) or an old-biome contract: name the field actually loaded.
  let hudObjective = String(contract.brief || "").replace(BIOMES[contract.biome] || "\u0000", map.palette.label || "");

  function viewMode() {
    return cameraMode === "fps" || scopeMix > 0.35 ? "fps" : "tps";
  }
  // Free look. lookPitch is the view elevation itself (radians, + = up),
  // PITCH_DOWN..PITCH_UP in third person, cockpit and scope alike. The
  // crosshair ray follows the view, so it reaches flyers, ridges and roofs.
  // Third person: looking down lifts the camera on its orbit; looking up
  // keeps it behind and a little above the hull (it never drops under the
  // Zoid, which would put the hull over the crosshair).
  // (Before: the camera orbited a fixed point 16 m ahead at eye height and
  // looking up only lowered the camera, so the view topped out near +1 deg
  // in third person and +11 deg in the cockpit.)
  function viewDirection(out) {
    const yaw = player.lookYaw;
    const c = Math.cos(player.lookPitch);
    return out.set(-Math.sin(yaw) * c, Math.sin(player.lookPitch), -Math.cos(yaw) * c);
  }
  const camLook = new Vector3();
  function placeCamera() {
    const eye = new Vector3();
    player.model.anchors.eye.getWorldPosition(eye);
    yawRig.copy(player.model.root.position);
    yawRig.y = eye.y;
    rig.position.copy(yawRig);
    rig.rotation.set(0, player.lookYaw, 0);
    rig.updateMatrixWorld(true);
    const { fwd, right } = horizontalBasis(rig);
    const dist = 8 + player.def.scale * 5.5;
    viewDirection(camLook);
    // A sniper scope looks from the cockpit (first person), so the player's
    // own hull never fills a zoomed third-person view.
    if (viewMode() === "fps") {
      camera.position.copy(eye);
    } else {
      const p = player.lookPitch;
      const offset = fwd.clone().multiplyScalar(-dist).addScaledVector(UP, 1.5);
      if (p < 0) offset.applyAxisAngle(right, p * 0.85);
      else offset.multiplyScalar(1 - 0.22 * Math.sin(p)).addScaledVector(UP, dist * 0.18 * Math.sin(p));
      camera.position.copy(yawRig).add(offset);
      const minY = map.heightAt(camera.position.x, camera.position.z) + 1.5;
      if (camera.position.y < minY) camera.position.y = minY;
    }
    camera.lookAt(camera.position.clone().add(camLook));
    const spec = spectateId ? units.find((u) => u.id === spectateId && u.alive) : null;
    if (spec) {
      const sp = spec.model.root.position;
      const away = sp.clone().sub(player.model.root.position).setY(0).normalize();
      camera.position.copy(sp).addScaledVector(away, 14).add(new Vector3(0, 4, 0));
      camera.lookAt(player.model.root.position.clone().lerp(sp, 0.35));
    }
    // The eye sits inside the head and the shield plate. Hide those body meshes
    // while the view is first person. Raycasts ignore visibility, so hits still land.
    const showBody = viewMode() !== "fps";
    for (const meshes of Object.values(player.model.partMeshes)) {
      for (const mesh of meshes) {
        const part = player.parts[mesh.userData.partId];
        const destroyed = !!(part && (part.destroyed || part.structure <= 0));
        mesh.visible = showBody && !(mesh.isSkinnedMesh && destroyed);
      }
    }
  }

  const fpvCenter = new Vector3();
  const fpvScale = new Vector3();
  const fpvTo = new Vector3();
  const fpvDir = new Vector3();
  let weaponMeshList = null;

  function weaponMeshes() {
    if (weaponMeshList) return weaponMeshList;
    const body = new Set();
    for (const meshes of Object.values(player.model.partMeshes)) {
      for (const mesh of meshes) body.add(mesh);
    }
    weaponMeshList = [];
    player.model.root.traverse((obj) => {
      if (obj.isMesh && obj.userData && obj.userData.partId && !body.has(obj)) weaponMeshList.push(obj);
    });
    return weaponMeshList;
  }

  // A gun mounted on the jaw sits on the first-person center ray. Drawing it
  // puts a dark plate on the crosshair. Leave guns the center ray misses.
  function weaponBlocksCenter(mesh) {
    const geometry = mesh.geometry;
    if (!geometry) return false;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) return false;
    mesh.updateWorldMatrix(true, false);
    fpvCenter.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
    mesh.getWorldScale(fpvScale);
    const radius = sphere.radius * Math.max(fpvScale.x, fpvScale.y, fpvScale.z);
    camera.getWorldDirection(fpvDir);
    fpvTo.copy(fpvCenter).sub(camera.position);
    const along = fpvTo.dot(fpvDir);
    if (along < 0.05 || along > 6) return false;
    const lateralSq = Math.max(0, fpvTo.lengthSq() - along * along);
    const limit = radius + 0.05;
    return lateralSq < limit * limit;
  }

  function applyFpvWeapons() {
    const fps = viewMode() === "fps";
    for (const mesh of weaponMeshes()) {
      mesh.visible = !fps || !weaponBlocksCenter(mesh);
    }
  }

  const rig = new Mesh();
  scene.add(rig);
  rig.visible = false;

  function desiredAim(unit) {
    if (unit === player) {
      const aim = cameraAimPoint();
      const origin = new Vector3();
      const anchor = player.model.anchors.headWeapon || player.model.anchors.eye;
      anchor.getWorldPosition(origin);
      const plain = directionToPoint(origin, aim);
      return new Vector3(plain.x, plain.y, plain.z);
    }
    if (unit.cmd && unit.cmd.aim) {
      const origin = unit.model.root.position.clone();
      origin.y += 1.5;
      const dir = new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z).sub(origin);
      const chassisFwd = facingDirection(unit.model.root, new Vector3());
      if (dir.lengthSq() < 1e-6) return chassisFwd;
      return clampAim(chassisFwd, dir, 0.7);
    }
    return facingDirection(unit.model.root, new Vector3());
  }

  // ---------- weapon slots and selection ----------
  // Every weapon is aimed and fired on its own from its own hardpoint. The
  // player (and each AI pilot) has one selected weapon; the trigger fires
  // only that one. Slots run head, left, right, back, then the standard
  // melee. Mouse wheel down = next, up = previous (wraps); 1-9 pick a slot.
  const MOUNT_ORDER = ["headWeapon", "leftWeapon", "rightWeapon", "backMount"];
  const SWITCH_TIME = 0.18;
  function weaponSlots(unit) {
    const list = unit.weapons.filter((w) => !w.innate).sort((a, b) => MOUNT_ORDER.indexOf(a.mount) - MOUNT_ORDER.indexOf(b.mount));
    for (const w of unit.weapons) if (w.innate) list.push(w);
    return list;
  }
  function selectedWeapon(unit = player) {
    const slots = weaponSlots(unit);
    if (!slots.length) return null;
    const i = (((unit.selIdx || 0) % slots.length) + slots.length) % slots.length;
    unit.selIdx = i;
    return slots[i];
  }
  function selectWeapon(unit, idx) {
    const slots = weaponSlots(unit);
    if (!slots.length) return null;
    const i = ((idx % slots.length) + slots.length) % slots.length;
    if (i === (unit.selIdx || 0)) return slots[i];
    unit.selIdx = i;
    unit.selReadyAt = missionTime + SWITCH_TIME;
    unit.switches = (unit.switches || 0) + 1;
    if (unit === player) {
      scopeHeld = false;
      // RMB still held through a switch: it neither re-zooms nor fires the
      // new weapon until it is released (no surprise melee swing or shot).
      if (lastAlt) altLatch = true;
      sfx("switch");
    }
    return slots[i];
  }
  function selectionReady(unit) {
    return missionTime >= (unit.selReadyAt || 0);
  }
  // Sniper-class weapons get the right-mouse scope.
  function isScoped(weapon) {
    return !!(weapon && (weapon.scope || weapon.id === "sniperRifle"));
  }

  // ---------- scope zoom (sniper weapons, hold right mouse) ----------
  // (state declared with the camera mode near the top of the mission)
  function scopeZoom() {
    return 1 + (SCOPE_STEPS[scopeStep] - 1) * scopeMix;
  }
  function updateScope(dt, input) {
    const sel = selectedWeapon(player);
    const want = !!(input.alt && !altLatch && isScoped(sel) && player.alive);
    if (want && !scopeHeld) { scopeStep = 0; sfx("zoom"); }
    // A second right click while scoped steps to 8x (release resets).
    if (want && input.altEdge && scopeHeld) { scopeStep = (scopeStep + 1) % SCOPE_STEPS.length; sfx("zoom"); }
    scopeHeld = want;
    scopeMix = approach(scopeMix, scopeHeld ? 1 : 0, dt / 0.18);
    const fov = BASE_FOV / scopeZoom();
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // ---------- standard melee ----------
  // Contact point: the front face of the hit volume at centre-of-mass height.
  function meleeContact(unit) {
    const b = unit.hitBounds;
    const y = unit.aimLocal ? unit.aimLocal.y : (unit.radius || 2) * 0.45;
    const w = toWorld({ x: 0, y, z: b ? b.min.z : -(unit.radius || 2) }, rootFrame(unit));
    return new Vector3(w.x, w.y, w.z);
  }
  // Can `unit` strike `target` now? Reach is measured from the contact point
  // to the target's hit volume, inside the style's arc in front, with clear
  // line of sight (cover and terrain block a swing).
  function meleeCheck(unit, weapon, target) {
    if (!target || !target.alive || !target.hitBoxes) return { ok: false, reason: "none" };
    const contact = meleeContact(unit);
    const cm = lockAimPoint(target);
    const fwd = facingDirection(unit.model.root, new Vector3());
    const to = cm.clone().sub(unit.model.root.position).setY(0);
    const ang = to.lengthSq() > 1e-6 ? (Math.acos(clamp(fwd.dot(to.clone().normalize()), -1, 1)) * 180) / Math.PI : 0;
    const dir = cm.clone().sub(contact);
    const len = dir.length();
    let surface = len;
    let partId = "core";
    if (len > 1e-6) {
      dir.multiplyScalar(1 / len);
      const frame = rootFrame(target);
      const lo = toLocal(contact, frame);
      const hit = rayHitBoxes(lo, dirToLocal(dir, frame.yaw), target.hitBoxes, len + 1, 0);
      if (hit) { surface = hit.t; partId = hit.partId; }
    }
    const dist = Math.max(0, surface);
    if (!meleeReaches(unit.model.root.position.y, target.model.root.position.y, unit.flightSpec || target.flightSpec)) return { ok: false, reason: "height", dist, ang };
    if (dist > weapon.range) return { ok: false, reason: "reach", dist, ang };
    if (ang > (weapon.arc || 50)) return { ok: false, reason: "arc", dist, ang };
    const end = contact.clone().addScaledVector(dir, Math.max(0, surface - 0.05));
    const blocked = lineBlocked(field, { x: contact.x, y: contact.y, z: contact.z }, { x: end.x, y: end.y, z: end.z });
    if (blocked) return { ok: false, reason: "blocked", dist, ang };
    return { ok: true, dist, ang, partId, point: end };
  }
  function meleeTargetFor(unit, weapon) {
    if (unit === player) {
      const locked = player.lockId ? units.find((u) => u.id === player.lockId && u.alive) : null;
      if (locked && meleeCheck(unit, weapon, locked).ok) return locked;
      let best = null;
      let bestD = Infinity;
      for (const u of units) {
        if (!u.alive || u.team === unit.team) continue;
        const c = meleeCheck(unit, weapon, u);
        if (c.ok && c.dist < bestD) { bestD = c.dist; best = u; }
      }
      return best || locked;
    }
    return lockTargetOf(unit);
  }
  function startMelee(unit, weapon) {
    weapon.swing = { t: 0, hitAt: weapon.windup || 0.2, dur: weapon.swingTime || 0.6, done: false };
    unit.lunge = { v: (weapon.lunge || 2) * 4.5, t: 0.22 };
    if (unit.model.playMelee) unit.model.playMelee(weapon.style, weapon.swingTime || 0.6);
    if (addWeaponHeat(weapon, heatPerShot(weapon) * heatGenMul(unit)) && unit === player) pushMessage(`${weapon.name} overheated`);
    sfx("swing");
  }
  function resolveMelee(unit, weapon) {
    const target = meleeTargetFor(unit, weapon);
    const check = target ? meleeCheck(unit, weapon, target) : { ok: false, reason: "none" };
    weapon.lastMelee = { hit: !!check.ok, reason: check.ok ? "hit" : check.reason, dist: check.dist, target: target ? target.id : null, t: missionTime };
    if (!check.ok) {
      tallyShot(unit.id, weapon.id, "miss");
      return;
    }
    tallyShot(unit.id, weapon.id, "unit");
    const amount = weapon.damage * damageMul(unit);
    applyDamage(target, check.partId, amount, unit, damageCtxFor(weapon));
    // Knockback and stagger scale with the weight ratio.
    const ratio = clamp((unit.weight || 30) / Math.max(1, target.weight || 30), 0.35, 2.2);
    const push = target.model.root.position.clone().sub(unit.model.root.position).setY(0);
    if (push.lengthSq() > 1e-6) push.normalize();
    target.knock = { x: push.x * 5 * ratio, z: push.z * 5 * ratio, t: 0.25 };
    target.staggerT = 0.3 + 0.2 * Math.min(1, ratio);
    flash(check.point, weapon.color, 0.9);
    sfx("melee");
    if (unit === player) vignette = Math.min(1, vignette + 0.05);
  }
  // Swing timing, lunge and knockback motion (each frame, every unit).
  function updateMelee(unit, dt) {
    for (const w of unit.weapons) {
      if (!w.swing) continue;
      w.swing.t += dt;
      if (!w.swing.done && w.swing.t >= w.swing.hitAt) {
        w.swing.done = true;
        if (unit.alive && mountUsable(unit, w)) resolveMelee(unit, w);
      }
      if (w.swing.t >= w.swing.dur) w.swing = null;
    }
    const root = unit.model.root;
    if (unit.lunge && unit.lunge.t > 0) {
      const fwd = facingDirection(root, new Vector3());
      const step = unit.lunge.v * dt;
      root.position.x += fwd.x * step;
      root.position.z += fwd.z * step;
      unit.lunge.t -= dt;
      unit.lunge.v *= Math.max(0, 1 - dt * 6);
    }
    if (unit.knock && unit.knock.t > 0) {
      root.position.x += unit.knock.x * dt;
      root.position.z += unit.knock.z * dt;
      unit.knock.t -= dt;
    }
    if (unit.staggerT > 0) {
      unit.staggerT -= dt;
      unit.speed *= Math.max(0, 1 - dt * 5);
      unit.strafeVel = (unit.strafeVel || 0) * Math.max(0, 1 - dt * 5);
    }
  }

  // AI weapon choice: the best damage for the range among weapons that can
  // fire now; the standard melee when the target is inside its reach.
  function weaponDps(w) {
    return (w.damage || 1) * (w.rate || 1) * (w.volley || 1) * (w.burst || 1);
  }
  // Rough share of rounds that land: the spread cone's half-width at this
  // range against the target's half-width / half-height (a wide gatling
  // cone is worthless on a thin Gun Sniper or a Pteras at 45 m; homing
  // rockets ignore spread).
  function aiHitChance(unit, w, target, dist) {
    if (w.delivery === "rocket") return 1;
    const b = target.hitBounds;
    const hw = b ? Math.max(0.3, Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2) : target.radius * 0.5;
    const hh = b ? Math.max(0.3, (b.max.y - b.min.y) / 2) : target.radius * 0.5;
    const cone = Math.max(1e-3, dist * spreadFor(unit, w, dist) / 2);
    return Math.min(1, hw / cone) * Math.min(1, hh / cone);
  }

  function aiPickWeapon(unit, target, dist) {
    if (!target || (unit.aiPickAt || 0) > missionTime) return;
    unit.aiPickAt = missionTime + 0.5;
    const slots = weaponSlots(unit);
    let best = -1;
    let bestScore = 0;
    slots.forEach((w, i) => {
      if (!canOperateWeapon(unit, w)) return;
      let score;
      if (w.innate) {
        if (!meleeCheck(unit, w, target).ok) return;
        score = 1e6;
      } else {
        if (dist > w.range) return;
        if (w.delivery === "rocket" && w.minRange && dist < w.minRange) return;
        score = weaponDps(w) * Math.max(0.05, rangeDamageMul(w, dist)) * (1 - Math.min(0.9, (w.heatGauge || 0) / 120))
          * aiHitChance(unit, w, target, dist);
        // Same mount arcs as the player: a gun that cannot bear is not picked
        // (a forward chin gun against a flyer overhead, say).
        if (!w.turret && !arcReaches(unit, w, lockAimPoint(target))) score *= 0.02;
        if (w.chargeTime && planarSpeed(unit) >= STATIONARY_SPEED) score *= 0.2;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) selectWeapon(unit, best);
  }

  // Test hooks (browser flight test): scripted input, forced aim target and
  // a spectator camera on another unit looking at the player.
  let forcedInput = null;
  let lastFireInput = { fire: false, alt: false };
  let showcaseView = null;
  let forcedAimId = null;
  let spectateId = null;

  function simulate(dt) {
    missionTime += dt;
    const input = paused ? {
      forward: 0, strafe: 0, turn: 0, boost: false, groups: [false, false, false, false],
      dx: 0, dy: 0, tab: false, nearest: false, camera: false, help: false, skill: false,
    } : forcedInput ? {
      forward: 0, strafe: 0, turn: 0, boost: false, groups: [false, false, false, false],
      dx: 0, dy: 0, tab: false, nearest: false, camera: false, help: false, skill: false, climb: 0,
      ...forcedInput,
    } : autopilot ? autopilotInput() : inputDevice.read();
    if (forcedInput) forcedInput = { ...forcedInput, camera: false, tab: false, nearest: false, skill: false, wheel: 0, select: null, altEdge: false };
    lastGroups = input.groups.slice();
    // Weapon selection: wheel down = next, wheel up = previous; 1-9 direct.
    if (player.alive) {
      if (input.wheel) selectWeapon(player, (player.selIdx || 0) + Math.sign(input.wheel) * Math.min(3, Math.abs(input.wheel)));
      if (input.select != null) selectWeapon(player, input.select - 1);
    }
    input.altEdge = input.altEdge || (!!input.alt && !lastAlt);
    lastAlt = !!input.alt;
    if (!input.alt) altLatch = false;
    updateScope(dt, input);
    lastFireInput = { fire: !!input.fire, alt: !!input.alt };
    if (input.help) helpOn = !helpOn;
    if (input.camera) cameraMode = cameraMode === "fps" ? "tps" : "fps";
    if (input.tab) cycleTarget(1);
    if (input.nearest) targetNearest();
    upkeepPlayerLock(dt);

    for (const wave of waves) {
      if (missionTime >= wave.at && !spawnedWaves.has(wave)) {
        spawnedWaves.add(wave);
        spawnWave(wave, spawnedWaves.size - 1);
      }
    }

    drivePlayer(dt, input);
    const liveBattle = !isolate && !pacify;
    if (liveBattle) {
      for (const unit of units) {
        if (unit === player || !unit.alive) continue;
        if (unit.script) unit.script(unit, dt);
        else if (unit.brain) {
          updateBrain(unit, unit.brain, { units, time: missionTime, nav }, dt);
          if (unit.cmd && unit.cmd.skill) resolveSkillAction(unit, activateSkill(unit), null);
          driveAI(unit, dt);
        }
      }
      separateUnits();
    }
    for (const unit of units) {
      if (!unit.alive) {
        continue;
      }
      const p0 = unit.model.root.position;
      updateMelee(unit, dt);
      resolveObstacles(unit);
      if (unit.flight) flyUnit(unit, dt);
      else plant(unit);
      // Wading: slower legs, faster weapon cooling (js/battlefield.js WATER).
      const wet = unit.flight && unit.flight.airborne ? 0 : field.waterAt(p0.x, p0.z).depth;
      unit.wade = wet;
      unit.wadeMul = wadeSpeedMul(wet, unit.radius);
      if (dt > 0 && unit.prevPos) {
        unit.vel3.x = (p0.x - unit.prevPos.x) / dt;
        unit.vel3.y = (p0.y - unit.prevPos.y) / dt;
        unit.vel3.z = (p0.z - unit.prevPos.z) / dt;
      }
      unit.prevPos = { x: p0.x, y: p0.y, z: p0.z };
    }

    for (const unit of units) {
      if (!unit.model.root.visible) continue;
      const speedNorm = Math.min(1, Math.abs(unit.speed) / Math.max(1, unit.def.speed || 1));
      if (unit.model.anim) {
        unit.model.anim.shield = unit.def.id === "shieldLiger" && !!(unit.skill && unit.skill.active);
      }
      unit.model.animate(missionTime, speedNorm, unit.parts);
      if (unit.alive) refreshPartColors(unit.model, unit.parts);
    }
    // Camera first, then fire, so the shot uses the view that is drawn.
    placeCamera();

    const playerAim = cameraAimPoint();
    trackUnitWeapons(player, playerAim);
    if (input.skill && player.alive) resolveSkillAction(player, activateSkill(player), playerAim);
    for (const unit of units) {
      if (!unit.alive) continue;
      if (!liveBattle && unit !== player) continue;
      if (unit !== player) trackUnitWeapons(unit, null);
      updateRocketLock(unit, dt, unit === player ? playerAim : null);
      const lockout = tickSkill(unit, dt);
      if (lockout && lockout.type === "lockout" && unit === player) {
        sfx("alarm");
        pushMessage("Energy shield overheated");
      }
      const coolMul = energyCoolMul(unit);
      // Overloaded chassis shed heat slower (tonnage zones, js/tonnage.js).
      const loadCool = (unit.perf && unit.perf.coolMul) || 1;
      for (const weapon of unit.weapons) {
        const mul = (weapon.kind === "energy" ? coolMul : 1) * loadCool * wadeCoolMul(unit.wade || 0);
        coolWeapon(weapon, dt * mul, unit.speed);
        recoverBloom(weapon, dt);
        weapon.rateMul = unit !== player ? (unit.fireRateMul || 1) : 1;
      }
      // AI fire discipline: each weapon fires only with the target inside its
      // own max range (and missiles outside their 25 m arming range).
      const aiLock = unit !== player ? lockTargetOf(unit) : null;
      const aiDist = aiLock ? aiLock.model.root.position.distanceTo(unit.model.root.position) : Infinity;
      const locked = weaponsLocked(unit);
      const moving = planarSpeed(unit) >= STATIONARY_SPEED;
      updateTurrets(unit, dt);
      if (unit !== player && aiLock) aiPickWeapon(unit, aiLock, aiDist);
      const sel = selectedWeapon(unit);
      const selReady = selectionReady(unit);
      // Player trigger: left mouse, or right mouse when the selected weapon
      // has no scope. Legacy group triggers stay for scripted input only.
      const held = unit === player && (input.fire || (input.alt && !altLatch && !isScoped(sel)));
      const wants = (weapon) => (unit === player
        ? !!input.groups[(weapon.group || 1) - 1] || (held && weapon === sel && selReady)
        : weapon === sel && selReady && !!(unit.cmd && unit.cmd.fire));
      for (const weapon of unit.weapons) {
        if (weapon.innate) {
          const trig = wants(weapon) && !weapon.swing && (unit === player || meleeCheck(unit, weapon, aiLock).ok);
          const n = weaponShotCount(unit, weapon, dt, trig, canOperateWeapon(unit, weapon) && !locked, moving);
          if (n > 0) startMelee(unit, weapon);
          continue;
        }
        if (weapon.turret) {
          // Turret: keeps its own traverse and its own aim (straight from its
          // barrel to the locked target's centre of mass), but like every
          // other weapon it fires only while it is the selected weapon and the
          // trigger is held (it no longer fires on its own). Without a lock,
          // or while still slewing onto it, it holds fire.
          let trigger = !!weapon.turretTrigger && wants(weapon);
          if (weapon.delivery === "rocket") {
            trigger = trigger && rocketMayFire(unit.rocketLock || 0) && unit.rocketLockId === weapon.turretTargetId;
          }
          const lock = trigger ? lockTargetOf(unit) : null;
          const n = weaponShotCount(unit, weapon, dt, trigger && !!lock, canOperateWeapon(unit, weapon) && !locked, moving);
          const turretLock = lockTargetOf(unit);
          for (let k = 0; k < n && turretLock; k++) shoot(unit, weapon, lockAimPoint(turretLock));
          continue;
        }
        let trigger = wants(weapon);
        if (weapon.delivery === "rocket") {
          trigger = trigger && rocketMayFire(unit.rocketLock || 0) && !!unit.rocketLockId;
        }
        // Outside its mount arc the weapon holds fire (player and AI): the
        // reticle reads OUT OF ARC and marks where the barrel stopped.
        if (trigger && outOfArc(unit, weapon)) trigger = false;
        if (unit !== player && trigger) {
          trigger = aiDist <= weapon.range && !(weapon.delivery === "rocket" && weapon.minRange && aiDist < weapon.minRange);
        }
        const n = weaponShotCount(unit, weapon, dt, trigger, canOperateWeapon(unit, weapon) && !locked, moving);
        for (let k = 0; k < n; k++) shoot(unit, weapon, unit === player ? playerAim : null);
      }
      updateBeams(unit, dt, unit === player ? playerAim : null);
    }
    // Pacified test missions still fly the player's shells (AI does not fire).
    if (liveBattle || (pacify && !isolate)) updateProjectiles(dt);
    if (liveBattle) updateObjectives(dt);
    updateHazards(dt);
    applyFpvWeapons();
    updateEffects(dt);
    map.update(missionTime);
    pushHud(input);
    cullFarUnits();
    if (showcaseView) {
      // Test-only side camera for screenshots; aim and HUD keep the real view.
      const pos = camera.position.clone();
      const quat = camera.quaternion.clone();
      camera.position.set(showcaseView.x, showcaseView.y, showcaseView.z);
      camera.lookAt(showcaseView.lx, showcaseView.ly, showcaseView.lz);
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);
      camera.position.copy(pos);
      camera.quaternion.copy(quat);
      camera.updateMatrixWorld(true);
    } else if (!skipRender) {
      renderer.render(scene, camera);
    }
  }
  // Test-only: headless probes step the sim without drawing every tick.
  let skipRender = false;

  // Units deep in the fog (FogExp2 leaves ~10% at 330 m) still cost a full
  // draw; skip them. The escort ambush sits 250-430 m out at the start, and
  // drawing it there took glb_browser's frame from ~70 to ~105 ms.
  const CULL_DIST = 330;
  function cullFarUnits() {
    const cx = camera.position.x;
    const cz = camera.position.z;
    for (const unit of units) {
      if (unit === player || !unit.alive) continue;
      const p = unit.model.root.position;
      unit.model.root.visible = Math.hypot(p.x - cx, p.z - cz) < CULL_DIST + (unit.radius || 2);
    }
  }

  function planarSpeed(unit) {
    return Math.hypot(unit.speed || 0, unit.strafeVel || 0);
  }

  function unitPlanarVelocity(unit) {
    const { fwd, right } = horizontalBasis(unit.model.root);
    return {
      x: fwd.x * (unit.speed || 0) + right.x * (unit.strafeVel || 0),
      y: 0,
      z: fwd.z * (unit.speed || 0) + right.z * (unit.strafeVel || 0),
    };
  }

  // Missile seeker: the enemy under the crosshair, or the selected target
  // inside the weapon's lock cone (lockCone degrees around the crosshair).
  function playerRocketTarget(aimPoint, maxRange, coneDeg) {
    const cone = Math.cos(((coneDeg || 8) * Math.PI) / 180);
    camera.updateMatrixWorld(true);
    const origin = camera.position;
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    const hit = raycast(origin, dir, player.id, Math.min(AIM_FAR, maxRange));
    if (hit && hit.object.userData && hit.object.userData.ownerId) {
      const hitUnit = units.find((u) => u.id === hit.object.userData.ownerId && u.alive && u.team === "enemy");
      if (hitUnit) {
        const dist = hitUnit.model.root.position.distanceTo(player.model.root.position);
        if (dist <= maxRange) return { id: hitUnit.id, speed: planarSpeed(hitUnit) };
      }
    }
    const selected = currentTarget();
    if (!selected || !aimPoint) return null;
    const dist = selected.model.root.position.distanceTo(player.model.root.position);
    if (dist > maxRange) return null;
    const to = lockAimPoint(selected);
    to.sub(origin);
    if (to.lengthSq() < 1e-6) return null;
    to.normalize();
    if (dir.dot(to) < cone) return null;
    return { id: selected.id, speed: planarSpeed(selected) };
  }

  function updateRocketLock(unit, dt, aimPoint) {
    const rockets = unit.weapons.filter((weapon) => weapon.delivery === "rocket" && mountUsable(unit, weapon));
    if (!rockets.length) {
      unit.rocketLock = 0;
      unit.rocketLockId = null;
      unit.rocketStrength = 0;
      unit.rocketTracking = false;
      return;
    }
    let maxRange = rockets.reduce((max, weapon) => Math.max(max, weapon.range || 0), 0);
    if (unit === player) maxRange = Math.min(maxRange, playerSensorRange());
    const lockTime = rockets[0].lockTime || LOCK_TIME;
    let track = null;
    const turretRocket = rockets.some((weapon) => weapon.turret);
    if (turretRocket) {
      const lock = lockTargetOf(unit);
      if (lock) {
        const dist = lock.model.root.position.distanceTo(unit.model.root.position);
        if (dist <= maxRange) track = { id: lock.id, speed: planarSpeed(lock) };
      }
    } else if (unit === player) track = playerRocketTarget(aimPoint, maxRange, lockConeOf(rockets[0]));
    else if (unit.aiTarget && unit.aiTarget.alive) {
      const dist = unit.aiTarget.model.root.position.distanceTo(unit.model.root.position);
      if (dist <= maxRange) track = { id: unit.aiTarget.id, speed: planarSpeed(unit.aiTarget) };
    }
    // Missiles: the further the band, the longer the lock (homing does the
    // accuracy; spread does not grow).
    let bandLock = lockTime;
    unit.rocketBlocked = null;
    if (track) {
      const tu = units.find((u) => u.id === track.id);
      if (tu) {
        bandLock = lockTime * rangeLockMul(rockets[0], tu.model.root.position.distanceTo(unit.model.root.position));
        // Countermeasure: a thick cloud on the line of sight blocks the seeker.
        const eye = unit.model.root.position.clone();
        eye.y += (unit.radius || 2) * 0.6;
        const to = lockAimPoint(tu).sub(eye);
        const d = to.length();
        if (d > 1e-3) {
          const tp = lockAimPoint(tu);
          const solid = lineBlocked(field, { x: eye.x, y: eye.y, z: eye.z }, { x: tp.x, y: tp.y, z: tp.z });
          const path = hazardPath(eye, to.multiplyScalar(1 / d), d, hazards);
          if (solid) {
            // Seekers need line of sight: terrain or hard cover breaks the track.
            unit.rocketBlocked = solid.by === "terrain" ? "TERRAIN" : "COVER";
            track = null;
          } else if (lockBlocked(path)) {
            unit.rocketBlocked = path.kinds.map((k) => (HAZARD_KINDS[k] || {}).label || k).join("/");
            track = null;
          }
        }
      }
    }
    // Off target the lock drains LOCK_DECAY_MUL times faster than it builds.
    const stepDt = track ? dt : dt * LOCK_DECAY_MUL;
    const stepped = stepLock(unit.rocketLock || 0, stepDt, track ? track.speed : 0, !!track, bandLock);
    unit.rocketLock = stepped.lock;
    unit.rocketStrength = track ? stepped.strength : 0;
    unit.rocketTracking = !!track;
    unit.rocketLockId = track ? track.id : (stepped.lock > 0 ? unit.rocketLockId : null);
  }

  function projectHudPoint(x, y, z) {
    indicatorPoint.set(x, y, z);
    camera.getWorldDirection(indicatorDir);
    const ahead = indicatorPoint.clone().sub(camera.position).dot(indicatorDir);
    if (ahead <= 0.5) return null;
    const ndc = indicatorPoint.clone().project(camera);
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;
    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (-ndc.y * 0.5 + 0.5) * height,
    };
  }

  // A world point on the HUD; behind the camera or off screen, pinned to
  // the screen edge in its direction (edge: true).
  function edgeHudPoint(x, y, z) {
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;
    camera.updateMatrixWorld(true);
    const v = new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    let nx;
    let ny;
    let edge = false;
    if (v.z < -0.5) {
      const ndc = new Vector3(x, y, z).project(camera);
      nx = ndc.x;
      ny = ndc.y;
    } else {
      // Behind the view: point the way it lies (camera space x / y).
      nx = v.x;
      ny = v.y;
      const m = Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
      nx /= m;
      ny /= m;
      edge = true;
    }
    // Keep it inside the view, clear of the weapon dock along the bottom.
    const limX = 0.85;
    const limY = 0.6;
    const k = Math.max(Math.abs(nx) / limX, Math.abs(ny) / limY);
    if (k > 1) {
      nx /= k;
      ny /= k;
      edge = true;
    }
    return { x: (nx * 0.5 + 0.5) * width, y: (-ny * 0.5 + 0.5) * height, edge };
  }

  let lastAimMarkers = { impact: null, lead: null, drop: null };
  let lastReticle = null;
  let tracerCount = 0;
  // Test-only shot outcome tally for the player's weapons (targeting probes).
  let shotTally = {};
  function tallyShot(ownerId, weaponId, outcome) {
    if (ownerId !== player.id || !weaponId) return;
    const t = shotTally[weaponId] || (shotTally[weaponId] = { shots: 0, unit: 0, ground: 0, cover: 0, miss: 0 });
    t.shots += 1;
    t[outcome] += 1;
  }

  // The gun the HUD marks: group 1's first ballistic, else any fitted one.
  // The selected weapon, when it is a ballistic gun the HUD can solve for.
  function hudGun() {
    const w = selectedWeapon(player);
    if (w && w.delivery === "ballistic" && !w.turret && mountUsable(player, w) && player.model.muzzles[w.mount]) return w;
    return null;
  }

  // The selected weapon's own aim from its own hardpoint: AIM where its shot
  // line converges, or BLOCKED where cover / terrain / ground cuts that line
  // first (a low chin gun behind a rock, a back cannon over a wall).
  function ownAimMarker(aimPoint) {
    const w = selectedWeapon(player);
    if (!w || w.innate || !player.model.muzzles[w.mount] || !mountUsable(player, w)) return null;
    const muzzle = new Vector3();
    player.model.muzzles[w.mount].getWorldPosition(muzzle);
    const to = aimPoint.clone().sub(muzzle);
    const dist = to.length();
    // Outside the mount arc: mark where the barrel stopped (at the edge of
    // its traverse / elevation), pinned to the screen edge when off view.
    const st = player.arcState && player.arcState[w.mount];
    if (st && st.out) {
      let p = null;
      if (st.dir) {
        const far = Math.max(25, Math.min(w.range || 200, dist || 100));
        p = edgeHudPoint(muzzle.x + st.dir.x * far, muzzle.y + st.dir.y * far, muzzle.z + st.dir.z * far);
      }
      const why = st.turret ? (w.turretResult && !w.turretResult.inArc ? "TRAVERSE" : "ELEVATION")
        : (st.pitchOff || 0) > (st.yawOff || 0) ? "ELEVATION" : "TRAVERSE";
      const cx = (window.innerWidth || 1280) / 2;
      const cy = (window.innerHeight || 720) / 2;
      return { ...(p || { x: cx, y: cy, edge: true }), label: "OUT OF ARC", out: true, why, blocked: false, mount: w.mount, dist };
    }
    if (dist < 1) return null;
    const hit = raycast(muzzle, to, player.id, Math.min(dist + 1, w.range || dist));
    const data = hit ? hit.object.userData || {} : {};
    if (hit && !data.ownerId && hit.distance < dist - 1.5) {
      const p = projectHudPoint(hit.point.x, hit.point.y, hit.point.z);
      return p ? { ...p, label: "BLOCKED", blocked: true, mount: w.mount, dist: hit.distance } : null;
    }
    const p = projectHudPoint(aimPoint.x, aimPoint.y, aimPoint.z);
    return p ? { ...p, label: "AIM", blocked: false, mount: w.mount, dist } : null;
  }

  // IMPACT: where the zeroed shell really lands at the crosshair distance.
  // DROP / ZERO: how far below the crosshair that is (or that you are inside
  // zero range). LEAD: where to put the crosshair to hit the locked target,
  // with travel time AND drop worked in.
  function ballisticHud(aimPoint) {
    const gun = hudGun();
    if (!gun) {
      lastAimMarkers = { impact: null, lead: null, drop: null };
      return lastAimMarkers;
    }
    const muzzle = new Vector3();
    player.model.muzzles[gun.mount].getWorldPosition(muzzle);
    const origin = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
    const aim = { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z };
    const speed = gun.speed || 80;
    const zi = zeroedImpact(origin, aim, gun);
    const impact = projectHudPoint(zi.x, zi.y, zi.z);
    const dropM = Math.max(0, zi.drop);
    let lead = null;
    const target = player.lockId ? currentTarget() : null;
    if (target && target.alive) {
      const aimAt = lockAimPoint(target);
      const led = leadPoint(origin, { x: aimAt.x, y: aimAt.y, z: aimAt.z }, target.vel3 || unitPlanarVelocity(target), speed).point;
      const held = holdoverPoint(origin, led, gun, 1);
      lead = projectHudPoint(held.x, held.y, held.z);
    }
    lastAimMarkers = {
      impact: impact ? { ...impact, label: "IMPACT", gun: gun.name } : null,
      lead: lead ? { ...lead, label: "LEAD" } : null,
      drop: impact ? { ...impact, label: dropM > 0.3 ? `DROP ${dropM.toFixed(1)}m` : `ZERO ${Math.round(zeroOf(gun))}m`, value: dropM } : null,
    };
    return lastAimMarkers;
  }

  function focalPx() {
    const height = window.innerHeight || 720;
    return (height / 2) / Math.tan((camera.fov * Math.PI) / 360);
  }

  // Reticle state: spread bloom circle (group 1), range to the crosshair
  // point, missile lock cone size, the box on the locked target, and hazard
  // warnings for beams and seekers.
  function reticleHud(aimPoint, rows) {
    const f = focalPx();
    const aimDist = player.model.root.position.distanceTo(aimPoint);
    const selW = selectedWeapon(player);
    const pool = selW && selW.kind !== "melee" && mountUsable(player, selW) ? [selW] : [];
    let spread = 0;
    for (const w of pool) spread = Math.max(spread, spreadFor(player, w, aimDist));
    const bloomPx = Math.max(22, Math.min(170, 2 * Math.tan(spread / 2) * f + 18));
    const rocket = selW && selW.delivery === "rocket" && mountUsable(player, selW) ? selW : null;
    const conePx = rocket ? Math.max(40, Math.min(360, 2 * Math.tan((lockConeOf(rocket) * Math.PI) / 180) * f)) : 0;
    let box = null;
    const locked = player.lockId ? units.find((u) => u.id === player.lockId && u.alive) : null;
    if (locked) {
      const c = lockAimPoint(locked);
      const sp = projectHudPoint(c.x, c.y, c.z);
      const dist = locked.model.root.position.distanceTo(player.model.root.position);
      if (sp) {
        const size = Math.max(34, Math.min(260, ((locked.radius || 3) * 2.2 / Math.max(1, camera.position.distanceTo(c))) * f));
        const g1row = (rows || []).find((r) => r.selected && r.band);
        box = { x: sp.x, y: sp.y, size, dist, name: locked.name, band: g1row ? g1row.band : "" };
      }
    }
    // Beam path from the camera to the crosshair point.
    camera.updateMatrixWorld(true);
    const view = new Vector3();
    camera.getWorldDirection(view);
    const camDist = camera.position.distanceTo(aimPoint);
    const path = hazardPath(camera.position, view, Math.min(camDist, 260), beamVolumes());
    const hasBeam = player.weapons.some((w) => w.kind === "energy" && mountUsable(player, w));
    const warns = [];
    if (hasBeam && path.length > 1) warns.push(`BEAM SCATTER · ${path.kinds.map((k) => (HAZARD_KINDS[k] || {}).label || k).join("/")} ${Math.round(path.length)} m`);
    if (player.rocketBlocked) warns.push(`SEEKER BLOCKED · ${player.rocketBlocked}`);
    const warn = warns.join("  |  ");
    // Melee reach readout when the standard melee is selected.
    let melee = null;
    if (selW && selW.innate) {
      const tgt = meleeTargetFor(player, selW) || currentTarget();
      const c = tgt ? meleeCheck(player, selW, tgt) : { ok: false, reason: "none" };
      melee = { reach: selW.range, inReach: !!c.ok, dist: c.dist == null ? null : c.dist, reason: c.ok ? "hit" : c.reason, name: selW.name };
    }
    const own = ownAimMarker(aimPoint);
    const scope = scopeMix > 0.01 ? { zoom: scopeZoom(), step: SCOPE_STEPS[scopeStep], mix: scopeMix } : null;
    return { bloomPx, spread, aimDist, conePx, box, warn, melee, own, scope, assist: lastAssist, selected: selW ? { name: selW.name, mount: selW.mount, slot: (player.selIdx || 0) + 1, ready: selectionReady(player) } : null };
  }

  const BAND_RANK = { ideal: 4, long: 3, short: 2, extreme: 1, out: 0 };
  function bestBand(list, dist) {
    let best = "out";
    for (const weapon of list) {
      if (!mountUsable(player, weapon)) continue;
      const b = bandOf(weapon, dist);
      if (BAND_RANK[b] > BAND_RANK[best]) best = b;
    }
    return best;
  }

  // One dock row per weapon slot (1..N), the selected one flagged.
  function weaponRows() {
    const target = currentTarget();
    const dist = target ? target.model.root.position.distanceTo(player.model.root.position) : null;
    const sel = selectedWeapon(player);
    const mc = sel && sel.innate && target ? meleeCheck(player, sel, target) : null;
    return weaponSlots(player).map((w, i) => {
      const heat = groupHeatState([w], player);
      const pct = w.chargeTime
        ? Math.round((w.charge / Math.max(0.001, w.chargeTime)) * 100)
        : Math.round((1 - Math.min(1, w.cooldown * (w.rate || 1))) * 100);
      const far = w.innate ? !!(mc && !mc.ok && w === sel) : dist != null && dist > (w.range || 0);
      return {
        group: i + 1,
        slot: i + 1,
        selected: w === sel,
        mount: w.mount,
        name: w.name,
        state: w === sel && !selectionReady(player) ? "switching" : heat.state,
        pct,
        color: w.color,
        heat: heat.heat,
        heats: heat.heats,
        maxRange: w.range || 0,
        delivery: w.delivery || "",
        far,
        arcOut: !w.innate && !!(player.arcState && player.arcState[w.mount] && player.arcState[w.mount].out),
        arc: w.arc ? { yaw: Math.round(w.arc.yaw * 57.2958), up: Math.round(w.arc.up * 57.2958), down: Math.round(w.arc.down * 57.2958), kind: w.arc.kind } : null,
        melee: !!w.innate,
        band: dist == null ? null : w.innate ? (mc ? (mc.ok ? "ideal" : "out") : null) : bestBand([w], dist),
      };
    });
  }

  function groupRows() {
    const rows = [];
    const target = currentTarget();
    const dist = target ? target.model.root.position.distanceTo(player.model.root.position) : null;
    for (let group = 1; group <= 4; group++) {
      const list = player.weapons.filter((weapon) => (weapon.group || 1) === group);
      const heat = groupHeatState(list, player);
      if (!list.length) {
        rows.push({ group, name: "Empty", state: heat.state, pct: 0, color: 0x334048, heat: 0, heats: [] });
        continue;
      }
      const lead = list.find((weapon) => !weapon.overheated) || list[0];
      const pct = lead.chargeTime
        ? Math.round((lead.charge / Math.max(0.001, lead.chargeTime)) * 100)
        : Math.round((1 - Math.min(1, lead.cooldown * (lead.rate || 1))) * 100);
      const maxRange = list.reduce((max, weapon) => Math.max(max, weapon.range || 0), 0);
      rows.push({
        group,
        name: list.map((weapon) => weapon.name).join(" + "),
        state: heat.state,
        pct,
        color: lead.color,
        heat: heat.heat,
        heats: heat.heats,
        maxRange,
        delivery: lead.delivery || "",
        far: dist != null && dist > maxRange,
        // Best range band any weapon in the group has on the target.
        band: dist == null ? null : bestBand(list, dist),
      });
    }
    return rows;
  }

  const indicatorPoint = new Vector3();
  const indicatorDir = new Vector3();
  let lastProbe = { arrows: [], rows: [], radarRange: 0 };
  let radarView = { live: [], memory: [], hidden: [] };

  // Keep direction arrows off the objective banner, the minimap, and the weapon dock.
  function parkArrow(edge, width, height) {
    const x = Math.min(width - 48, Math.max(48, edge.x));
    let y = Math.min(height - 140, Math.max(100, edge.y));
    if (x > width - 180 && y < 220) y = 220;
    return { ...edge, x, y };
  }

  function markerNdc(marker) {
    indicatorPoint.set(marker.x, marker.y, marker.z);
    camera.getWorldDirection(indicatorDir);
    const toCam = indicatorPoint.clone().sub(camera.position);
    const ahead = toCam.dot(indicatorDir);
    if (ahead > 0.5) {
      const ndc = indicatorPoint.clone().project(camera);
      return { x: ndc.x, y: ndc.y, behind: false };
    }
    const flat = indicatorDir.clone();
    flat.y = 0;
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    else flat.normalize();
    const rightX = -flat.z;
    const rightZ = flat.x;
    const localRight = toCam.x * rightX + toCam.z * rightZ;
    const localFwd = toCam.x * flat.x + toCam.z * flat.z;
    const mag = Math.hypot(localRight, localFwd) || 1;
    return { x: localRight / mag, y: localFwd / mag, behind: true };
  }

  function objectiveReadout(radarRange) {
    camera.updateMatrixWorld(true);
    const width = window.innerWidth || 1280;
    const height = window.innerHeight || 720;
    const px = player.model.root.position.x;
    const pz = player.model.root.position.z;
    const { fwd } = horizontalBasis(player.model.root);
    const arrows = [];
    const rows = [];
    for (const marker of markers) {
      const dist = Math.hypot(marker.x - px, marker.z - pz);
      paintMarker(marker, `${marker.label} ${Math.round(dist)}m`);
      const ndc = markerNdc(marker);
      const beyond = dist > radarRange;
      const open = marker.kind !== "survey" || !beacons.some((beacon) => beacon.marker === marker && beacon.done);
      const edge = parkArrow(
        screenEdgeIndicator(ndc.x, ndc.y, ndc.behind, width, height, 0.88, beyond && open && !ndc.behind),
        width,
        height,
      );
      const mini = minimapProject(fwd, px, pz, marker.x, marker.z, 0.55, 150, 150, 6);
      rows.push({
        label: marker.label,
        kind: marker.kind,
        dist,
        beyond,
        arrow: !!(open && edge.clamped),
        miniClamped: mini.clamped,
        x: edge.x,
        y: edge.y,
        fog: marker.pillar.material.fog,
        markerDepth: marker.cap.material.depthTest,
        spriteDepth: marker.sprite.material.depthTest,
      });
      if (open && edge.clamped) {
        arrows.push({
          x: edge.x,
          y: edge.y,
          angle: edge.angle,
          dist,
          label: marker.label,
          color: marker.css,
        });
      }
    }
    lastProbe = { arrows, rows, radarRange };
    return lastProbe;
  }

  function skillAimPoint(unit, aimPoint) {
    if (aimPoint) return aimPoint;
    if (unit.cmd && unit.cmd.aim) return new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z);
    const fwd = facingDirection(unit.model.root, new Vector3());
    const origin = unit.model.root.position.clone();
    origin.y += 1.6;
    return origin.addScaledVector(fwd, 80);
  }

  function muzzlePoint(unit, mounts) {
    for (const name of mounts) {
      const obj = (unit.model.muzzles && unit.model.muzzles[name]) || (unit.model.anchors && unit.model.anchors[name]);
      if (!obj) continue;
      const pos = new Vector3();
      obj.getWorldPosition(pos);
      return pos;
    }
    const pos = unit.model.root.position.clone();
    pos.y += 1.8;
    return pos;
  }

  function resolveSkillAction(unit, action, aimPoint) {
    if (!action || !action.ok) {
      if (unit === player && action && action.reason === "locked") pushMessage("Skill locked");
      return;
    }
    if (action.type === "shield-on") {
      if (unit === player) pushMessage("Energy shield up. Weapons cannot fire.");
      sfx("alarm");
      return;
    }
    if (action.type === "shield-off") {
      if (unit === player) pushMessage("Energy shield down");
      return;
    }
    if (action.type === "duration") {
      if (unit === player) pushMessage(action.spec.name);
      return;
    }
    if (action.type === "dash") {
      const fwd = facingDirection(unit.model.root, new Vector3());
      unit.model.root.position.addScaledVector(fwd, action.spec.dash || 0);
      const reach = action.spec.range || 8;
      for (const other of units) {
        if (!other.alive || other === unit || other.team === unit.team) continue;
        const rel = other.model.root.position.clone().sub(unit.model.root.position);
        // Melee cannot reach a flyer above meleeHeight (or a flyer swing at
        // the ground unless it swoops low).
        if (!meleeReaches(unit.model.root.position.y, other.model.root.position.y, unit.flightSpec || other.flightSpec)) continue;
        rel.y = 0;
        const dist = rel.length();
        if (dist > reach || dist < 0.01) continue;
        rel.multiplyScalar(1 / dist);
        if (rel.dot(fwd) < (action.spec.arc ?? 0.2)) continue;
        applyDamage(other, "core", action.spec.slash || 0, unit);
      }
      if (unit === player) pushMessage("Laser blade");
      sfx("beam");
      return;
    }
    if (action.type === "slam") {
      const radius = action.spec.radius || 10;
      for (const other of units) {
        if (!other.alive || other === unit || other.team === unit.team) continue;
        const dist = other.model.root.position.distanceTo(unit.model.root.position);
        if (dist <= radius) applyDamage(other, "core", action.spec.damage || 0, unit);
      }
      if (unit === player) pushMessage("Ground pound");
      sfx("shock");
      return;
    }
    if (action.type === "cannon") {
      const muzzle = muzzlePoint(unit, ["headWeapon", "eye"]);
      const point = skillAimPoint(unit, aimPoint);
      const plain = directionToPoint(muzzle, point);
      const dir = new Vector3(plain.x, plain.y, plain.z);
      if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
      hitscan(unit, {
        damage: action.spec.damage,
        range: action.spec.range,
        color: action.spec.color || 0xd56bff,
        id: "skillCannon",
        hitscan: true,
        skillShot: true,
        heat: 0,
        name: action.spec.name,
      }, muzzle, dir);
      if (unit === player) pushMessage("Charged particle cannon");
      return;
    }
    if (action.type === "barrage") {
      const muzzle = muzzlePoint(unit, ["backMount", "headWeapon", "eye"]);
      const point = skillAimPoint(unit, aimPoint);
      const plain = directionToPoint(muzzle, point);
      const base = new Vector3(plain.x, plain.y, plain.z);
      if (base.lengthSq() < 1e-8) facingDirection(unit.model.root, base);
      const shots = action.spec.shots || 5;
      for (let i = 0; i < shots; i++) {
        const dir = base.clone();
        dir.x += (i - (shots - 1) / 2) * 0.08;
        dir.y += 0.18 + i * 0.02;
        dir.normalize();
        spawnProjectile(unit, {
          id: "barrage",
          damage: action.spec.damage,
          range: action.spec.range || 150,
          speed: action.spec.speed || 62,
          color: action.spec.color || 0xffcc66,
          spread: 0,
          skillShot: true,
          heat: 0,
          name: action.spec.name,
          homing: false,
        }, muzzle, dir);
      }
      if (unit === player) pushMessage("Artillery barrage");
      sfx("shock");
    }
  }

  function pushHud() {
    const perf = player.perf || derivePerformance(player.def, player.mods, player.parts, player.weight);
    const { fwd } = horizontalBasis(player.model.root);
    const target = currentTarget();
    let targetData = null;
    if (target) {
      const distance = target.model.root.position.distanceTo(player.model.root.position);
      const range = playerSensorRange();
      targetData = {
        name: target.name,
        layout: target.def.layout,
        parts: target.parts,
        distance,
        locked: distance <= range,
      };
    }
    const radarRange = playerRadarRange();
    const probe = objectiveReadout(radarRange);
    const marks = [];
    radarView = { live: [], memory: [], hidden: [] };
    for (const unit of units) {
      if (unit === player || !unit.alive) continue;
      const distance = unit.model.root.position.distanceTo(player.model.root.position);
      let px = unit.model.root.position.x;
      let pz = unit.model.root.position.z;
      if (unit.team === "enemy") {
        // Enemy contacts follow radar occlusion; allies share a datalink.
        const c = senseContact(player, unit);
        if (c.state === "memory") {
          marks.push({ x: c.x, z: c.z, color: "#ff4455", r: 4, ghost: c.fade });
          radarView.memory.push({ id: unit.id, x: c.x, z: c.z, fade: c.fade });
          continue;
        }
        if (c.state !== "live") {
          if (distance <= radarRange) radarView.hidden.push(unit.id);
          continue;
        }
        radarView.live.push(unit.id);
      } else if (distance > radarRange) continue;
      marks.push({
        x: px,
        z: pz,
        color: unit.team === "enemy" ? "#ff4455" : "#7dffb2",
        r: unit.def.immobile ? 4 : 3,
        air: !!(unit.flight && unit.flight.airborne),
      });
    }
    for (const marker of markers) {
      marks.push({ x: marker.x, z: marker.z, color: marker.css, r: 4 });
    }
    const peak = player.weapons.reduce((max, weapon) => Math.max(max, weapon.heatGauge || 0), 0);
    const aimNow = cameraAimPoint();
    const aimMarkers = ballisticHud(aimNow);
    const rowsNow = weaponRows();
    const reticle = reticleHud(aimNow, rowsNow);
    lastReticle = reticle;
    // Out of range for the selected weapon (melee: outside its reach check).
    const selNow = selectedWeapon(player);
    const reach = selNow && mountUsable(player, selNow) ? selNow.range || 0 : 0;
    const outOfRange = selNow && selNow.innate
      ? !!(targetData && targetData.locked && reticle.melee && !reticle.melee.inReach)
      : !!(targetData && targetData.locked && reach > 0 && targetData.distance > reach);
    const charging = player.weapons.find((weapon) => weapon.chargeTime && (weapon.charging || weapon.charge > 0));
    const rocket = player.weapons.some((weapon) => weapon.delivery === "rocket");
    hud.update({
      scramble: perf.sensors.scramble * scrambleMul(player),
      vignette,
      heading: headingOf(player.model.root.rotation.y),
      objective: hudObjective,
      cameraMode,
      playerName: player.name,
      layout: player.def.layout,
      parts: player.parts,
      speed: displaySpeed(Math.abs(player.speed)),
      speedRaw: Math.abs(player.speed),
      speedUnit: unitLabel(),
      speedPct: (Math.abs(player.speed) / Math.max(0.1, perf.speed)) * 100,
      flight: player.flight ? {
        alt: player.flight.agl,
        airspeed: displaySpeed(Math.max(0, player.speed)),
        stalled: player.flight.stalled && player.flight.airborne,
        airborne: player.flight.airborne,
        ceiling: player.flightSpec.ceiling,
      } : null,
      heat: peak,
      shutdown: player.shutdown,
      boosting: player.boosting,
      boostReady: perf.boosterReady,
      target: targetData,
      outOfRange,
      weapons: rowsNow,
      reticle,
      lock: rocket ? {
        value: player.rocketLock || 0,
        tracking: !!player.rocketTracking,
        strength: player.rocketStrength || 0,
      } : null,
      charge: charging ? {
        pct: (charging.charge || 0) / charging.chargeTime,
        name: charging.name,
      } : null,
      markers: { ...aimMarkers, own: reticle.own },
      skill: skillHud(player),
      indicators: probe.arrows,
      messages,
      help: helpOn,
      locked: document.pointerLockElement === renderer.domElement,
      paused,
      hits,
      mini: {
        fwd: { x: fwd.x, y: 0, z: fwd.z },
        px: player.model.root.position.x,
        pz: player.model.root.position.z,
        scale: 0.55,
        marks,
        layer: miniLayer,
      },
      wading: player.alive && (player.wade || 0) > 0.3,
    });
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener("resize", resize);

  function onLock() {
    const locked = document.pointerLockElement === renderer.domElement;
    if (!locked && !ended) paused = true;
    if (locked) paused = false;
    hud.setPaused(paused);
  }
  document.addEventListener("pointerlockchange", onLock);
  function captureMouse() {
    if (ended || document.pointerLockElement) return;
    const lock = renderer.domElement.requestPointerLock;
    if (!lock) return;
    const pending = lock.call(renderer.domElement);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  }
  renderer.domElement.addEventListener("click", captureMouse);
  hud.onResume(captureMouse);
  hud.onAbort(() => finish(false, true));

  function step(dt) {
    if (ended) return;
    if (paused && !manual) {
      renderer.render(scene, camera);
      pushHud();
      return;
    }
    simulate(dt);
  }

  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (ended || manual) return;
    const dt = Math.min(0.05, clock.getDelta());
    step(dt);
  }

  function cleanup() {
    cancelAnimationFrame(raf);
    inputDevice.unmount();
    document.removeEventListener("pointerlockchange", onLock);
    window.removeEventListener("resize", resize);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    disposeTree(map.group);
    for (const unit of units) disposeTree(unit.model.root);
    for (const mesh of effects) disposeTree(mesh);
    for (const shot of projectiles) disposeTree(shot.mesh);
    for (const marker of markers) {
      scene.remove(marker.pillar);
      scene.remove(marker.cap);
      scene.remove(marker.sprite);
      disposeTree(marker.pillar);
      disposeTree(marker.cap);
      disposeTree(marker.sprite);
    }
    renderer.dispose();
    host.classList.add("hidden");
    host.innerHTML = "";
  }

  function finish(victory, aborted = false) {
    if (ended) return;
    ended = true;
    const result = {
      victory: victory && !aborted,
      aborted,
      contract,
      time: missionTime,
      kills,
      payout: victory && !aborted ? contract.payout : 0,
      salvage: victory && !aborted ? Math.round(contract.payout * (0.06 + rng() * 0.08)) : 0,
      parts: serializeParts(player.parts),
      zoidId,
      repair: repairCost(player.parts),
      coreDestroyed: !!(player.parts.core && player.parts.core.destroyed),
      layout: player.def.layout,
    };
    cleanup();
    hooks.onExit(result);
  }

  function failTest(list, cond, msg) {
    if (!cond) list.push(msg);
  }

  function selfTest() {
    const failures = [];
    manual = true;
    isolate = true;
    paused = false;
    for (const shot of [...projectiles]) {
      scene.remove(shot.mesh);
      disposeTree(shot.mesh);
    }
    projectiles.length = 0;

    for (const yaw of [0, Math.PI / 2, -1, 2.2]) {
      player.model.root.rotation.y = yaw;
      player.model.root.updateMatrixWorld(true);
      const dir = new Vector3();
      facingDirection(player.model.root, dir);
      const expect = forwardFromYaw(yaw);
      const dot = dir.x * expect.x + dir.z * expect.z;
      failTest(failures, dot > 0.999, `chassis yaw ${yaw.toFixed(2)} does not match -Z forward (${dot.toFixed(3)})`);
    }

    function resetPose(yaw = 0) {
      player.model.root.position.set(0, map.heightAt(0, 0), 0);
      player.model.root.rotation.set(0, yaw, 0);
      player.lookYaw = yaw;
      player.lookPitch = DEFAULT_PITCH;
      player.speed = 0;
      player.strafeVel = 0;
      player.model.root.updateMatrixWorld(true);
    }

    resetPose(0);
    player.model.updateMatrixWorld?.(true);
    player.model.root.updateMatrixWorld(true);
    const headBox = new Vector3();
    const coreBox = new Vector3();
    const headCenter = meshCenter(player.model.partMeshes.head, headBox);
    const coreCenter = meshCenter(player.model.partMeshes.core, coreBox);
    const facing = new Vector3();
    facingDirection(player.model.root, facing);
    facing.y = 0;
    facing.normalize();
    const headRel = headCenter.clone().sub(coreCenter);
    headRel.y = 0;
    headRel.normalize();
    failTest(failures, headRel.dot(facing) > 0.7, `head is not in front of the core (${headRel.dot(facing).toFixed(2)})`);
    if (player.def.layout === "quad") {
      const left = meshCenter(player.model.partMeshes.leftFrontLeg, new Vector3());
      const right = meshCenter(player.model.partMeshes.rightFrontLeg, new Vector3());
      failTest(failures, left.x < right.x, "left front leg is not on -X");
    }

    function press(code, ms) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
      const frames = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let i = 0; i < frames; i++) step(1 / 60);
      window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
    }

    function displacementDuring(code, ms) {
      resetPose(0);
      const start = player.model.root.position.clone();
      press(code, ms);
      const delta = player.model.root.position.clone().sub(start);
      delta.y = 0;
      return delta;
    }

    const forwardMove = displacementDuring("KeyW", 500);
    player.model.root.updateMatrixWorld(true);
    const fwdNow = new Vector3();
    facingDirection(player.model.root, fwdNow);
    fwdNow.y = 0;
    fwdNow.normalize();
    // Heavy stock Zoids (Death Saurer 45 km/h, accel 8) cover ~1 m in 0.5 s
    // after the speed rework, so the bar scales with top speed.
    const pf = derivePerformance(player.def, player.mods, player.parts, player.weight);
    const tRamp = Math.min(0.5, pf.speed / Math.max(0.1, pf.accel));
    const ideal = 0.5 * pf.accel * tRamp * tRamp + pf.speed * (0.5 - tRamp);
    const moveBar = Math.min(1.5, 0.6 * ideal);
    failTest(failures, forwardMove.length() > moveBar, `W did not move the Zoid (${forwardMove.length().toFixed(2)} < ${moveBar.toFixed(2)})`);
    if (forwardMove.length() > 0.2) {
      failTest(failures, forwardMove.clone().normalize().dot(fwdNow) > 0.85, "W did not move along chassis forward");
    }

    const backMove = displacementDuring("KeyS", 500);
    const fwdBack = new Vector3();
    facingDirection(player.model.root, fwdBack);
    fwdBack.y = 0;
    fwdBack.normalize();
    if (backMove.length() > 0.2) {
      failTest(failures, backMove.clone().normalize().dot(fwdBack) < -0.85, "S did not reverse along chassis forward");
    }

    resetPose(0);
    const startD = player.model.root.position.clone();
    press("KeyD", 450);
    const strafe = player.model.root.position.clone().sub(startD);
    strafe.y = 0;
    const basis = horizontalBasis(player.model.root);
    if (strafe.length() > 0.2) {
      failTest(failures, strafe.clone().normalize().dot(basis.right) > 0.85, "D did not strafe to chassis right");
    }

    resetPose(0);
    press("ArrowRight", 700);
    const turned = new Vector3();
    facingDirection(player.model.root, turned);
    failTest(failures, turned.x > 0.25, `ArrowRight should yaw toward +X (x=${turned.x.toFixed(2)})`);

    resetPose(0);
    cameraMode = "tps";
    step(1 / 60);
    const behind = camera.position.clone().sub(player.model.root.position);
    behind.y = 0;
    behind.normalize();
    const camFwd = new Vector3();
    facingDirection(player.model.root, camFwd);
    camFwd.y = 0;
    camFwd.normalize();
    failTest(failures, behind.dot(camFwd) < -0.65, "third-person camera is not behind the chassis");

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", bubbles: true }));
    step(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", bubbles: true }));
    const eyePos = new Vector3();
    player.model.anchors.eye.getWorldPosition(eyePos);
    failTest(
      failures,
      camera.position.distanceTo(eyePos) < 1.2,
      `first-person camera is ${camera.position.distanceTo(eyePos).toFixed(2)} from the eye`,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", bubbles: true }));
    step(1 / 60);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", bubbles: true }));

    // Release anything still held.
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowRight", "ArrowLeft", "KeyV"]) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
    }
    isolate = false;
    manual = false;
    clock.getDelta();
    return { ok: failures.length === 0, failures };
  }

  function meshCenter(meshes, target) {
    const box = new Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    return box.getCenter(target);
  }

  let snapshotParts = null;

  function damageTest() {
    snapshotParts = serializeParts(player.parts);
    const before = derivePerformance(player.def, player.mods, player.parts, player.weight).speed;
    const ids = player.def.layout === "quad"
      ? ["leftFrontLeg", "rightFrontLeg", "leftRearLeg", "rightRearLeg"]
      : ["leftLeg", "rightLeg"];
    for (const id of ids) applyHit(player.parts, id, 99999, { zoidId: player.def.id });
    const after = derivePerformance(player.def, player.mods, player.parts, player.weight).speed;
    applyHit(player.parts, "head", 99999, { zoidId: player.def.id });
    const sensors = sensorsFromHead(player.parts.head);
    const mountId = player.weapons[0] ? player.weapons[0].mount : "leftWeapon";
    if (player.parts[mountId]) applyHit(player.parts, mountId, 99999, { zoidId: player.def.id });
    const disabled = player.weapons.length
      ? !canOperateWeapon(player, player.weapons[0])
      : true;
    refreshPartColors(player.model, player.parts);
    pushHud();
    const dock = [...document.querySelectorAll("#weapon-dock .wep")].map((el) => ({
      group: el.dataset.group,
      state: el.dataset.state,
    }));
    const result = {
      ok: after < before * 0.6 && sensors.scramble >= 0.99 && sensors.rangeMul <= 0.3 && sensors.radar === false && disabled,
      before,
      after,
      sensors,
      disabled,
      dock,
    };
    // Put the live Zoid back so the contract can still finish.
    applyCondition(player.parts, serializeParts(snapshotParts));
    refreshPartColors(player.model, player.parts);
    return result;
  }

  function debugForceWin() {
    if (contract.type === "recon") {
      for (const beacon of beacons) {
        beacon.done = true;
        beacon.progress = 2.5;
      }
      return;
    }
    if (contract.type === "defend") {
      for (const truck of trucks) {
        if (!truck.alive) continue;
        truck.model.root.position.z = escort.exitZ - 20;
      }
      return;
    }
    for (const unit of units) {
      if (unit.team === "enemy" && unit.alive) {
        unit.alive = false;
        unit.model.root.visible = false;
      }
    }
  }

  function bodyVisibility() {
    const body = [];
    const bodySet = new Set();
    for (const [id, meshes] of Object.entries(player.model.partMeshes)) {
      for (const mesh of meshes) {
        bodySet.add(mesh);
        body.push({ id, visible: mesh.visible });
      }
    }
    const weapons = [];
    player.model.root.traverse((obj) => {
      if (!obj.isMesh || !obj.userData || !obj.userData.partId || bodySet.has(obj)) return;
      weapons.push({ id: obj.userData.partId, visible: obj.visible });
    });
    return { mode: cameraMode, body, weapons };
  }

  function weaponCooldowns() {
    return player.weapons.map((weapon) => ({
      mount: weapon.mount,
      group: weapon.group,
      cooldown: weapon.cooldown,
      name: weapon.name,
    }));
  }

  function setGroup(mount, group) {
    const weapon = player.weapons.find((item) => item.mount === mount);
    if (!weapon) return null;
    weapon.group = group;
    return weaponCooldowns();
  }

  function aimCheck() {
    placeCamera();
    const point = cameraAimPoint();
    const camDir = new Vector3();
    camera.getWorldDirection(camDir);
    const to = point.clone().sub(camera.position);
    const far = to.length();
    if (far > 1e-8) to.multiplyScalar(1 / far);
    const errors = [];
    for (const mount of Object.keys(player.model.muzzles)) {
      const muzzleObj = player.model.muzzles[mount];
      if (!muzzleObj) continue;
      const dir = mountAimDirection(player, mount, point);
      const muzzle = new Vector3();
      muzzleObj.getWorldPosition(muzzle);
      const toPoint = point.clone().sub(muzzle);
      const along = toPoint.dot(dir);
      const closest = muzzle.clone().addScaledVector(dir, along);
      const error = closest.distanceTo(point);
      errors.push({ mount, error, along, passes: error < 0.05 && along > 0 });
    }
    const hit = raycast(camera.position.clone(), camDir, player.id, AIM_FAR);
    let hitKind = "far";
    if (hit) {
      const data = hit.object.userData || {};
      if (data.ownerId === player.id) hitKind = "self";
      else if (data.ground || hit.object === map.ground) hitKind = "ground";
      else if (data.block) hitKind = "block";
      else hitKind = "part";
    }
    return {
      mode: cameraMode,
      align: to.dot(camDir),
      far,
      hitKind,
      errors,
      point: { x: point.x, y: point.y, z: point.z },
    };
  }

  function enemySnapshot() {
    return units
      .filter((unit) => unit.team === "enemy" && !unit.def.immobile)
      .map((unit) => ({
        id: unit.id,
        name: unit.name,
        x: unit.model.root.position.x,
        z: unit.model.root.position.z,
        alive: unit.alive,
        speed: unit.speed,
      }));
  }

  rebuildHits();
  // Start locked only if something is already inside sensor range.
  targetNearest(true);
  resize();
  step(1 / 60);
  clock.getDelta();
  frame();

  window.__ZOIDS__ = window.__ZOIDS__ || {};
  window.__ZOIDS__.screen = "mission";
  window.__ZOIDS__.selfTest = selfTest;
  window.__ZOIDS__.damageTest = damageTest;
  window.__ZOIDS__.debugForceWin = debugForceWin;
  window.__ZOIDS__.enemySnapshot = enemySnapshot;
  window.__ZOIDS__.aimCheck = aimCheck;
  window.__ZOIDS__.bodyVisibility = bodyVisibility;
  window.__ZOIDS__.weaponCooldowns = weaponCooldowns;
  window.__ZOIDS__.lastGroups = () => lastGroups.slice();
  window.__ZOIDS__.setGroup = setGroup;
  window.__ZOIDS__.setPacified = (value) => {
    pacify = !!value;
    return pacify;
  };
  window.__ZOIDS__.weaponHeat = () => player.weapons.map((weapon) => ({
    mount: weapon.mount,
    group: weapon.group,
    name: weapon.name,
    heat: weapon.heatGauge || 0,
    overheated: !!weapon.overheated,
    cooling: weapon.cooling,
  }));
  window.__ZOIDS__.animState = () => {
    const anim = player.model && player.model.anim;
    if (!anim) return null;
    const fire = anim.actions && anim.actions.Fire;
    const deploy = anim.actions && anim.actions.ShieldActivate;
    return {
      kind: anim.kind,
      loco: anim.loco || null,
      shieldPhase: anim.shieldPhase || "off",
      shieldTime: deploy ? deploy.time : null,
      shieldDuration: deploy ? deploy.getClip().duration : null,
      firePlaying: !!(fire && fire.isRunning()),
      clips: anim.actions ? Object.keys(anim.actions) : [],
    };
  };
  // Headless frames are slow, and the mission caps each step at 50 ms, so a
  // wall-clock sleep does not advance a 0.75 s clip. Tests freeze the render
  // loop and step simulate() themselves.
  window.__ZOIDS__.difficulty = contract.difficulty || 1;
  window.__ZOIDS__.autopilot = (on) => {
    autopilot = !!on;
    return autopilot;
  };
  window.__ZOIDS__.escortInfo = () => {
    if (!escort) return null;
    const pos = (u) => ({ x: u.model.root.position.x, z: u.model.root.position.z });
    return {
      layout: escort,
      seen: ambushSeen,
      player: pos(player),
      trucks: trucks.map((t) => ({ ...pos(t), alive: t.alive, structure: t.parts.core.structure, maxStructure: t.parts.core.maxStructure })),
      enemies: units.filter((u) => u.team === "enemy").map((u) => ({
        id: u.id, name: u.name, alive: u.alive, ...pos(u),
        alerted: !!(u.brain && u.brain.alerted),
        target: u.aiTarget && u.aiTarget.alive ? u.aiTarget.id : null,
        targetKind: u.aiTarget ? (u.aiTarget === player ? "player" : u.aiTarget.def.layout === "vehicle" ? "truck" : "other") : null,
        aimError: u.brain ? u.brain.aimError : null,
        fireRateMul: u.fireRateMul,
      })),
      playerId: player.id,
      objective: hudObjective,
      time: missionTime,
      ending: endTimer > 0 || ended,
      victory: endVictory,
    };
  };
  window.__ZOIDS__.holdSim = (held) => {
    manual = !!held;
    if (manual) paused = false;
    return manual;
  };
  window.__ZOIDS__.stepSim = (dt) => {
    manual = true;
    paused = false;
    const stepDt = Math.min(0.05, Math.max(1 / 240, Number(dt) || 1 / 60));
    simulate(stepDt);
    return window.__ZOIDS__.animState();
  };
  window.__ZOIDS__.skillState = () => {
    const hudSkill = skillHud(player);
    return {
      active: !!(player.skill && player.skill.active),
      heat: player.skill ? player.skill.heat : 0,
      overheated: !!(player.skill && player.skill.overheated),
      cooldown: player.skill ? player.skill.cooldown : 0,
      locked: weaponsLocked(player),
      name: hudSkill ? hudSkill.name : "",
      state: hudSkill ? hudSkill.state : "",
      hold: hudSkill ? hudSkill.hold : "",
    };
  };
  window.__ZOIDS__.frameSurveyShot = () => {
    if (!markers.length) return lastProbe;
    let far = markers[0];
    let farD = -1;
    const px = player.model.root.position.x;
    const pz = player.model.root.position.z;
    for (const marker of markers) {
      const dist = Math.hypot(marker.x - px, marker.z - pz);
      if (dist > farD) {
        far = marker;
        farD = dist;
      }
    }
    const yaw = yawToFace(far.x - px, far.z - pz) + 0.35;
    player.lookYaw = yaw;
    player.model.root.rotation.y = yaw;
    placeCamera();
    pushHud();
    return lastProbe;
  };
  window.__ZOIDS__.contract = contract.name;
  window.__ZOIDS__.contractType = contract.type;
  const savedLoadout = player.weapons.map((weapon) => ({ ...weapon }));
  window.__ZOIDS__.installWeapon = (mount, typeId) => {
    const spec = WEAPONS[typeId];
    if (!spec || !player.model.muzzles[mount]) return null;
    const prev = player.weapons.find((weapon) => weapon.mount === mount);
    const next = runtimeWeapon({ uid: `demo-${typeId}`, type: typeId, mount, group: prev ? prev.group : 1 }, player.def);
    next.cooldown = 0;
    next.charge = 0;
    next.charging = false;
    next.heatGauge = 0;
    next.overheated = false;
    if (prev) player.weapons.splice(player.weapons.indexOf(prev), 1, next);
    else player.weapons.push(next);
    player.rocketLock = 0;
    player.rocketLockId = null;
    player.rocketStrength = 0;
    player.rocketTracking = false;
    pushHud();
    return { id: next.id, mount, group: next.group, delivery: next.delivery, range: next.range };
  };
  window.__ZOIDS__.restoreWeapons = () => {
    player.weapons = savedLoadout.map((weapon) => ({ ...weapon, cooldown: 0, charge: 0, charging: false }));
    player.rocketLock = 0;
    player.rocketLockId = null;
    pushHud();
  };
  window.__ZOIDS__.turretDebug = () => ({
    id: player.id,
    lockId: player.lockId || null,
    chassisYaw: player.model.root.rotation.y,
    speed: planarSpeed(player),
    pos: { x: player.model.root.position.x, z: player.model.root.position.z },
    turrets: player.weapons.filter((w) => w.turret).map((w) => ({
      name: w.name,
      mount: w.mount,
      yaw: w.turretState.yaw,
      pivotYaw: player.model.turrets && player.model.turrets[w.mount] ? player.model.turrets[w.mount].rotation.y : null,
      fired: w.turretFired || 0,
      onTarget: !!(w.turretResult && w.turretResult.onTarget),
      targetId: w.turretTargetId || null,
      lastHit: w.lastHit || null,
    })),
    enemies: units.filter((u) => u.alive && u.team === "enemy").map((u) => ({
      id: u.id,
      zoid: u.def.id,
      lockId: u.aiTarget && u.aiTarget.alive ? u.aiTarget.id : null,
      turrets: u.weapons.filter((w) => w.turret).map((w) => ({ name: w.name, yaw: w.turretState.yaw, fired: w.turretFired || 0 })),
      y: u.model.root.position.y,
      x: u.model.root.position.x,
      z: u.model.root.position.z,
      armor: Object.values(u.parts).reduce((sum, part) => sum + part.armor + part.structure, 0),
    })),
  });
  // Test hooks: set or clear the player's lock, place a unit, freeze AI.
  // Test hook: restore the player's parts (headless lets the AI fight for a
  // few real-time seconds before it pacifies them).
  window.__ZOIDS__.repairPlayer = () => {
    for (const part of Object.values(player.parts)) {
      part.armor = part.maxArmor;
      part.structure = part.maxStructure;
      part.destroyed = false;
    }
    refreshPartColors(player.model, player.parts);
    return true;
  };
  window.__ZOIDS__.setLock = (id) => {
    player.lockId = id || null;
    return player.lockId;
  };
  window.__ZOIDS__.simInput = (inp) => { forcedInput = inp ? { ...inp } : null; return !!forcedInput; };
  window.__ZOIDS__.forceAim = (id) => { forcedAimId = id || null; return forcedAimId; };
  window.__ZOIDS__.spectate = (id) => { spectateId = id || null; return spectateId; };
  window.__ZOIDS__.obstacleList = () => obstacleTops().map((o) => ({ shape: o.shape, x: o.x, z: o.z, r: o.r, hw: o.hw, hd: o.hd, top: o.top, ground: map.heightAt(o.x, o.z) }));
  window.__ZOIDS__.flightInfo = (id) => {
    const u = id ? units.find((x) => x.id === id) : player;
    if (!u || !u.flight) return null;
    const p = u.model.root.position;
    return { id: u.id, x: p.x, y: p.y, z: p.z, agl: u.flight.agl, airborne: u.flight.airborne, stalled: u.flight.stalled,
      pitch: u.flight.pitch, bank: u.flight.bank, speed: u.speed, alive: u.alive, ground: map.heightAt(p.x, p.z),
      armor: Object.values(u.parts).reduce((sum, part) => sum + part.armor + part.structure, 0) };
  };
  window.__ZOIDS__.placeUnit = (id, x, z, yaw, alt) => {
    const unit = units.find((u) => u.id === id);
    if (!unit) return null;
    unit.model.root.position.set(x, map.heightAt(x, z) + (unit.flight && alt ? alt : 0), z);
    if (unit.flight && alt) { unit.flight.airborne = true; unit.flight.y = unit.model.root.position.y; unit.prevPos = null; }
    if (yaw != null) unit.model.root.rotation.y = yaw;
    unit.model.root.updateMatrixWorld(true);
    return { x, z };
  };
  window.__ZOIDS__.weaponDebug = () => ({
    lock: player.rocketLock || 0,
    lockId: player.rocketLockId || null,
    strength: player.rocketStrength || 0,
    tracking: !!player.rocketTracking,
    moving: planarSpeed(player),
    weapons: player.weapons.map((weapon) => ({
      id: weapon.id,
      mount: weapon.mount,
      group: weapon.group,
      delivery: weapon.delivery,
      range: weapon.range,
      optimal: weapon.optimal,
      charge: weapon.charge || 0,
      charging: !!weapon.charging,
      cooldown: weapon.cooldown,
      speed: weapon.speed || 0,
    })),
    markers: lastAimMarkers,
  });
  // Weapons-overhaul test hooks: hazard clouds, fire-control state, lock.
  window.__ZOIDS__.hazardList = () => hazards.map((h) => ({ kind: h.kind, x: h.x, z: h.z, r: h.r, h: h.h, y0: h.y0, life: h.life || 0 }));
  window.__ZOIDS__.clearHazards = () => { while (hazards.length) removeHazard(hazards[0]); return 0; };
  window.__ZOIDS__.addHazard = (spec) => { const hz = addHazard({ kind: "dust", r: 10, h: 20, ...spec }); return { x: hz.x, z: hz.z, r: hz.r }; };
  window.__ZOIDS__.fireDebug = () => ({
    lockId: player.lockId || null,
    sensorRange: playerSensorRange(),
    rocketBlocked: player.rocketBlocked || null,
    rocketLock: player.rocketLock || 0,
    reticle: lastReticle,
    projectiles: projectiles.length,
    weapons: player.weapons.map((w) => ({
      id: w.id, mount: w.mount, group: w.group, mode: fireModeOf(w), cooldown: w.cooldown, spin: w.spin || 0,
      bloom: w.bloomNow || 0, beamLeft: w.beamLeft || 0, burstLeft: w.burstLeft || 0, heat: w.heatGauge || 0,
      lastHit: w.lastHit || null, lastRefraction: w.lastRefraction || null,
    })),
  });
  window.__ZOIDS__.unitArmor = (id) => {
    const u = units.find((x) => x.id === id);
    return u ? Object.values(u.parts).reduce((sum, part) => sum + part.armor + part.structure, 0) : null;
  };
  // Battlefields (js/battlefield.js).
  window.__ZOIDS__.battlefield = () => {
    const f = field;
    const count = (k) => f.blockers.filter((b) => b.kind === k && !b.dead).length;
    return {
      biome: f.biome,
      label: f.look.label,
      blockers: f.blockers.filter((b) => !b.dead).length,
      kinds: { building: count("building"), rubble: count("rubble"), tree: count("tree"), sapling: count("sapling"), boulder: count("boulder"), spire: count("spire"), car: count("car") + count("barrier") },
      water: f.water.map((w) => ({ name: w.name, shape: w.shape, x: w.x, z: w.z, r: w.r, points: w.points ? w.points.map((p) => [p.x, p.z]) : null, halfWidth: w.halfWidth })),
      hazards: hazards.map((h) => h.kind),
      propsDestroyed,
      fog: scene.fog.density,
      quality: { antialias: quality.antialias, pixelRatio: quality.pixelRatio, software: quality.software, gpu: quality.gpu },
    };
  };
  window.__ZOIDS__.coverList = (x, z, r = 200) => field.near(x, z, r, []).map((b) => ({ kind: b.kind, shape: b.shape, x: b.x, z: b.z, r: b.r, hw: b.hw, hd: b.hd, base: b.base, top: b.top, hp: b.hp || 0, dead: !!b.dead }));
  window.__ZOIDS__.waterAt = (x, z) => field.waterAt(x, z);
  window.__ZOIDS__.losCheck = (a, b) => {
    const r = lineBlocked(field, a, b);
    return r ? { by: r.by, t: r.t, x: r.blocker ? r.blocker.x : null, z: r.blocker ? r.blocker.z : null } : null;
  };
  window.__ZOIDS__.pointBlocked = (x, z, r) => pointBlocked(field, x, z, r);
  // Radar occlusion probes for the tests.
  window.__ZOIDS__.radar = () => ({ ...radarView, checks: radarChecks, range: playerRadarRange(), close: SENSOR.closeRadius });
  window.__ZOIDS__.radarLine = (a, b) => {
    const r = radarBlocked(field, a, b);
    return r ? { by: r.by } : null;
  };
  window.__ZOIDS__.sense = (obsId, tgtId) => {
    const o = units.find((u) => u.id === obsId);
    const t = units.find((u) => u.id === tgtId);
    return o && t ? senseContact(o, t) : null;
  };
  window.__ZOIDS__.groundAt = (x, z) => map.heightAt(x, z);
  // The game's own shot ray (units + cover + terrain) from a to b.
  window.__ZOIDS__.shotTest = (a, b, ignoreId = null) => {
    const o = new Vector3(a.x, a.y, a.z);
    const d = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    const hit = raycast(o, d, ignoreId, d.length() + 5);
    return hit ? hitInfo(hit) : null;
  };
  window.__ZOIDS__.damageCover = (x, z, amount = 999) => {
    const b = field.near(x, z, 12, []).filter((k) => k.hp).sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))[0];
    if (!b) return null;
    damageProp(b, amount, player);
    return { kind: b.kind, dead: !!b.dead, x: b.x, z: b.z };
  };
  window.__ZOIDS__.unitNav = () => units.filter((u) => u.alive).map((u) => ({
    id: u.id, name: u.name, team: u.team, x: u.model.root.position.x, z: u.model.root.position.z, y: u.model.root.position.y,
    radius: u.radius, wade: u.wade || 0, wadeMul: u.wadeMul || 1, speed: u.speed,
    inside: !u.flight && pointBlocked(field, u.model.root.position.x, u.model.root.position.z, u.radius * 0.6),
    brain: u.brain ? { stuck: u.brain.stuckEvents || 0, detours: u.brain.detours || 0, routes: u.navRoutes || 0, cover: u.brain.coverUses || 0, unseen: u.brain.unseenT || 0, contact: u.brain.contact || null, search: u.brain.search ? { x: u.brain.search.x, z: u.brain.search.z, sweeping: !!u.brain.search.until } : null, lost: u.brain.lostTracks || 0, gaveUp: !!u.brain.gaveUp } : null,
    rocketBlocked: u.rocketBlocked || null,
  }));
  window.__ZOIDS__.mapParts = (hide) => map.group.children.map((o, i) => { if (hide && hide.includes(o.name || `#${i}`)) o.visible = false; return `${o.name || `#${i}`}:${o.visible ? 1 : 0}`; });
  window.__ZOIDS__.debugScene = () => ({ scene, map, renderer, camera });
  window.__ZOIDS__.setLive = (on) => { pacify = !on; return !pacify; };
  window.__ZOIDS__.alertUnit = (id) => { const u = units.find((k) => k.id === id); if (u && u.brain) { u.brain.alerted = true; u.brain.react = 0; } return !!(u && u.brain); };
  window.__ZOIDS__.showcase = (view) => { showcaseView = view || null; return !!showcaseView; };
  window.__ZOIDS__.drawLine = (a, b, color = 0xff3344, life = 2) => { beam(new Vector3(a.x, a.y, a.z), new Vector3(b.x, b.y, b.z), color, true, 0.6, life); return true; };
  window.__ZOIDS__.aimInfo = () => {
    const aim = cameraAimPoint();
    const gun = hudGun();
    const m = new Vector3();
    if (gun) player.model.muzzles[gun.mount].getWorldPosition(m);
    return { aim: { x: aim.x, y: aim.y, z: aim.z }, muzzle: gun ? { x: m.x, y: m.y, z: m.z } : null };
  };
  window.__ZOIDS__.lockKey = (which) => { if (which === "tab") cycleTarget(1); else targetNearest(); pushHud(); return player.lockId || null; };
  window.__ZOIDS__.aimAtEnemy = (yawOffset = 0, pitch = null) => {
    let best = null;
    let bestD = Infinity;
    for (const unit of enemies()) {
      const dist = unit.model.root.position.distanceTo(player.model.root.position);
      if (dist < bestD) {
        bestD = dist;
        best = unit;
      }
    }
    if (!best) return null;
    const pos = best.model.root.position;
    player.speed = 0;
    player.strafeVel = 0;
    player.lookYaw = yawToFace(
      pos.x - player.model.root.position.x,
      pos.z - player.model.root.position.z,
    ) + yawOffset;
    player.model.root.rotation.y = player.lookYaw;
    if (pitch != null) player.lookPitch = pitch;
    else {
      const goal = pos.clone();
      goal.y += (best.radius || 2) * 0.5;
      let bestPitch = player.lookPitch;
      let bestErr = Infinity;
      for (let attempt = -0.8; attempt <= 1.0; attempt += 0.02) {
        player.lookPitch = attempt;
        placeCamera();
        const view = new Vector3();
        camera.getWorldDirection(view);
        const to = goal.clone().sub(camera.position);
        if (to.lengthSq() < 1e-8) continue;
        to.normalize();
        const err = 1 - view.dot(to);
        if (err < bestErr) {
          bestErr = err;
          bestPitch = attempt;
        }
      }
      player.lookPitch = bestPitch;
    }
    placeCamera();
    const aim = cameraAimPoint();
    trackPlayerWeapons(aim);
    updateRocketLock(player, 0, aim);
    pushHud();
    return { name: best.name, dist: bestD, err: player.lookPitch, debug: window.__ZOIDS__.weaponDebug() };
  };

  // Targeting probes: spawn a stationary target Zoid, read its bounds, tally shots.
  window.__ZOIDS__.spawnTarget = (zoidId, x, z, yaw = 0, team = "enemy") => {
    const def = ZOIDS[zoidId];
    if (!def) return null;
    const u = spawnUnit(def, { team, name: `${def.name} target`, x, z, yaw, weapons: [], exact: true });
    u.dummy = true;
    rebuildHits();
    return u.id;
  };
  window.__ZOIDS__.dummyDamage = (id) => { const u = units.find((k) => k.id === id); return u ? u.dummyDamage || 0 : null; };
  // A live AI enemy with its stock loadout (melee / weapon-pick tests).
  window.__ZOIDS__.spawnFoe = (zoidId, x, z, yaw = 0) => {
    const def = ZOIDS[zoidId];
    if (!def) return null;
    const u = spawnUnit(def, { team: "enemy", name: `${def.name} foe`, x, z, yaw, weapons: stockWeaponsFor(def, rng), brain: true, brainTune: {}, exact: true });
    if (u.brain) { u.brain.alerted = true; u.brain.react = 0; }
    rebuildHits();
    return u.id;
  };
  window.__ZOIDS__.camInfo = () => { camera.updateMatrixWorld(true); const d = new Vector3(); camera.getWorldDirection(d);
    return { pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, dir: { x: d.x, y: d.y, z: d.z }, elevDeg: Math.asin(d.y) * 180 / Math.PI, lookPitch: player.lookPitch, mode: cameraMode, view: viewMode(),
      limits: { upDeg: PITCH_UP * 180 / Math.PI, downDeg: PITCH_DOWN * 180 / Math.PI } }; };
  // Mount arcs: per weapon its arc (degrees), whether the current aim is
  // outside it, and where its barrel (anchor -Z) points in the world.
  window.__ZOIDS__.arcInfo = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    if (!u) return null;
    const q = new Quaternion();
    return { id: u.id, zoid: u.def.id, chassisYaw: u.model.root.rotation.y, weapons: u.weapons.filter((w) => !w.innate).map((w) => {
      const a = u.model.anchors[w.mount];
      let barrel = null;
      if (a) { a.getWorldQuaternion(q); const d = new Vector3(0, 0, -1).applyQuaternion(q); barrel = { x: d.x, y: d.y, z: d.z, elevDeg: Math.asin(clamp(d.y, -1, 1)) * 180 / Math.PI, yawDeg: wrapAngle(Math.atan2(-d.x, -d.z) - u.model.root.rotation.y) * 180 / Math.PI }; }
      const st = u.arcState && u.arcState[w.mount];
      return { id: w.id, mount: w.mount, turret: !!w.turret, arc: w.arc ? { yaw: w.arc.yaw * 180 / Math.PI, up: w.arc.up * 180 / Math.PI, down: w.arc.down * 180 / Math.PI, kind: w.arc.kind } : null,
        out: !!(st && st.out), barrel, pivotYaw: u.model.turrets && u.model.turrets[w.mount] ? u.model.turrets[w.mount].rotation.y : null, fired: w.turretFired || 0, shots: w.shots || 0, selected: selectedWeapon(u) === w };
    }) };
  };
  window.__ZOIDS__.arcHud = () => {
    const aw = document.querySelector("#arc-warn");
    const ret = document.querySelector(".reticle");
    const mark = document.querySelector(".aim-mark.own.out");
    return { warn: aw && !aw.classList.contains("hidden") ? aw.textContent : null, reticleOut: !!(ret && ret.classList.contains("arc-out")),
      mark: mark ? { x: parseFloat(mark.style.left), y: parseFloat(mark.style.top), edge: mark.classList.contains("edge") } : null,
      dock: [...document.querySelectorAll(".wep")].map((r) => ({ mount: r.dataset.mount, arc: r.dataset.arc, sel: r.dataset.selected === "1" })) };
  };
  window.__ZOIDS__.viewState = () => ({ fov: camera.fov, lookYaw: player.lookYaw, lookPitch: player.lookPitch, scope: scopeMix, zoom: scopeZoom(), held: scopeHeld,
    overlay: !!document.querySelector("#scope") && !document.querySelector("#scope").classList.contains("hidden"),
    readout: document.querySelector("#scope-read") ? document.querySelector("#scope-read").textContent : "" });
  window.__ZOIDS__.removeUnit = (id) => {
    const u = units.find((k) => k.id === id);
    if (!u) return false;
    u.alive = false;
    scene.remove(u.model.root);
    units.splice(units.indexOf(u), 1);
    rebuildHits();
    return true;
  };
  window.__ZOIDS__.unitBounds = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    if (!u) return null;
    u.model.root.updateMatrixWorld(true);
    const all = new Box3();
    const parts = {};
    u.model.root.traverse((obj) => {
      if (!obj.isMesh || !obj.userData || !obj.userData.partId) return;
      const b = new Box3().expandByObject(obj);
      all.union(b);
      const pid = obj.userData.partId;
      parts[pid] = parts[pid] ? parts[pid].union(b) : b;
    });
    const box = (b) => ({ min: { x: b.min.x, y: b.min.y, z: b.min.z }, max: { x: b.max.x, y: b.max.y, z: b.max.z } });
    const p = u.model.root.position;
    const a = lockAimPoint(u);
    return { id: u.id, zoid: u.def.id, root: { x: p.x, y: p.y, z: p.z }, radius: u.radius, all: box(all), parts: Object.fromEntries(Object.entries(parts).map(([k, b]) => [k, box(b)])),
      lockPoint: { x: a.x, y: a.y, z: a.z }, aiAimY: p.y + (u.def.radius || 2) * 0.45, seekerY: p.y + u.radius * 0.4 };
  };
  // Turn the player's view so the screen-centre ray passes through a world
  // point (what a player does with the crosshair). Returns the error in rad.
  window.__ZOIDS__.aimCameraAt = (pt) => {
    const goal = new Vector3(pt.x, pt.y, pt.z);
    const view = new Vector3();
    let err = Infinity;
    player.speed = 0;
    player.strafeVel = 0;
    for (let i = 0; i < 40; i++) {
      placeCamera();
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(view);
      const to = goal.clone().sub(camera.position).normalize();
      const dyaw = Math.atan2(-to.x, -to.z) - Math.atan2(-view.x, -view.z);
      const yawErr = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const pitchErr = Math.asin(clamp(to.y, -1, 1)) - Math.asin(clamp(view.y, -1, 1));
      err = Math.acos(clamp(view.dot(to), -1, 1));
      if (err < 1e-4) break;
      player.lookYaw += yawErr;
      player.model.root.rotation.y = player.lookYaw;
      player.model.root.updateMatrixWorld(true);
      player.lookPitch = clamp(player.lookPitch + pitchErr, PITCH_DOWN, PITCH_UP);
    }
    placeCamera();
    const aim = cameraAimPoint();
    trackPlayerWeapons(aim);
    return { err, aim: { x: aim.x, y: aim.y, z: aim.z } };
  };
  // Weapon selection probes: by slot number (1..N) or mount name ("melee" for the standard melee).
  window.__ZOIDS__.selectWeapon = (which, id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    if (!u) return null;
    const slots = weaponSlots(u);
    const i = typeof which === "number" ? which - 1 : slots.findIndex((w) => w.mount === which || w.id === which);
    if (i < 0) return null;
    selectWeapon(u, i);
    u.selReadyAt = missionTime;
    // An AI unit keeps a test-forced pick (its own picker pauses for 60 s).
    if (u !== player) u.aiPickAt = missionTime + 60;
    return window.__ZOIDS__.weaponSlots(id);
  };
  window.__ZOIDS__.weaponSlots = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    if (!u) return null;
    const sel = selectedWeapon(u);
    return { selected: (u.selIdx || 0) + 1, switches: u.switches || 0, ready: selectionReady(u), scope: scopeMix, fov: camera.fov, fireCmd: !!(u.cmd && u.cmd.fire),
      slots: weaponSlots(u).map((w, i) => ({ slot: i + 1, id: w.id, name: w.name, mount: w.mount, selected: w === sel, innate: !!w.innate, range: w.range, damage: w.damage, style: w.style || null, part: w.part || null, cooldown: w.cooldown, heat: w.heatGauge || 0, lastMelee: w.lastMelee || null, swinging: !!w.swing, turretTrigger: w.turret ? !!w.turretTrigger : null })) };
  };
  window.__ZOIDS__.bonePos = (name, id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    let bone = null;
    u.model.root.traverse((o) => { if (!bone && o.isBone && (o.name === name || o.name.startsWith(`${name}_`))) bone = o; });
    if (!bone) return null;
    u.model.root.updateMatrixWorld(true);
    const w = bone.getWorldPosition(new Vector3());
    return toLocal(w, rootFrame(u));
  };
  window.__ZOIDS__.meleeState = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    return u ? meleeState(u.model) : null;
  };
  window.__ZOIDS__.meleeCheck = (targetId, id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    const t = units.find((k) => k.id === targetId);
    const w = u ? u.weapons.find((k) => k.innate) : null;
    if (!u || !t || !w) return null;
    const c = meleeCheck(u, w, t);
    return { ok: c.ok, reason: c.reason || "hit", dist: c.dist, ang: c.ang, reach: w.range };
  };
  window.__ZOIDS__.hitVolume = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    return u ? { boxes: u.hitBoxes, aim: u.aimLocal, bounds: u.hitBounds } : null;
  };
  window.__ZOIDS__.muzzles = (id) => {
    const u = id ? units.find((k) => k.id === id) : player;
    if (!u) return null;
    const out = {};
    u.model.root.updateMatrixWorld(true);
    for (const [mount, m] of Object.entries(u.model.muzzles)) {
      if (!m) continue;
      const w = m.getWorldPosition(new Vector3());
      const l = toLocal(w, rootFrame(u));
      out[mount] = { x: l.x, y: l.y, z: l.z };
    }
    return out;
  };
  window.__ZOIDS__.skipRender = (on) => { skipRender = !!on; return skipRender; };
  window.__ZOIDS__.setAssist = (mode) => { assistMode = mode === "off" ? "off" : "on"; return assistMode; };
  window.__ZOIDS__.assistState = () => lastAssist;
  window.__ZOIDS__.shotTally = (reset) => { const out = JSON.parse(JSON.stringify(shotTally)); if (reset) shotTally = {}; return out; };
  window.__ZOIDS__.clearProjectiles = () => { for (const s of projectiles) s.life = 0; return projectiles.length; };

  return { finish };
}
