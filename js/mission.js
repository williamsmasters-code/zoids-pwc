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
import { createMap } from "./maps.js";
import { buildUnitModel, tagOwner, refreshPartColors, disposeTree, setTurretYaw } from "./models.js";
import { turretSpecFor, relativeBearing, stepTurret, turretTrigger } from "./turret.js";
import { createInput } from "./input.js";
import { createHUD, headingOf } from "./hud.js";
import { createBrain, updateBrain } from "./ai.js";
import { aiTuning, difficultySpec } from "./difficulty.js";
import { escortLayout } from "./escort.js";
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
  ballisticAim,
  dropPoint,
  leadPoint,
  rangeFalloff,
  rocketMayFire,
  rocketTurn,
  stepLock,
} from "./ballistics.js";
import { screenEdgeIndicator, minimapProject } from "./indicators.js";
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
  clampAimYawPitch,
} from "./aim.js";

const UP = new Vector3(0, 1, 0);
const NEG_Z = new Vector3(0, 0, -1);

export function startMission(state, contract, hooks) {
  const hangar = document.getElementById("hangar-root");
  const host = document.getElementById("mission-root");
  hangar.classList.add("hidden");
  host.classList.remove("hidden");
  host.innerHTML = `<div id="view"></div><div id="hud"></div>`;

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.querySelector("#view").appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.15, 2500);
  const clock = new Clock();
  const map = createMap(contract.biome, contract.mapSeed);
  if (map.ground) map.ground.userData.ground = true;
  scene.add(map.group);
  scene.background = new Color(map.palette.sky);
  scene.fog = new FogExp2(map.palette.fog, map.palette.density);
  scene.add(new HemisphereLight(map.palette.hemiSky, map.palette.hemiGround, 0.9));
  const sun = new DirectionalLight(map.palette.sun, 1.45);
  sun.position.set(-90, 160, 70);
  scene.add(sun);
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
    player.lookPitch = -0.12;
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
  player.lookPitch = -0.42;

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
    };
  }

  function spawnUnit(def, opts) {
    const id = `u${uid++}`;
    const weapons = (opts.weapons || []).map((w) => runtimeWeapon(w, def));
    const armorLevels = opts.armorLevels || {};
    const parts = createParts(def, armorLevels);
    applyCondition(parts, opts.condition);
    const mods = opts.mods || { speed: 0, maneuver: 0, booster: 0 };
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
      lookPitch: -0.42,
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
    obstacles.push({ shape: "aabb", x, z, hw: w / 2, hd: d / 2, mesh });
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

  function rebuildHits() {
    hitMeshes = [];
    for (const obstacle of obstacles) {
      if (obstacle.mesh) hitMeshes.push(obstacle.mesh);
    }
    for (const unit of units) {
      if (!unit.alive) continue;
      unit.model.root.traverse((obj) => {
        if (obj.isMesh && obj.userData && obj.userData.partId) hitMeshes.push(obj);
      });
    }
  }

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
    const floor = floorAt(pos.x, pos.z, ground, obstacleTops(), unit.radius);
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

  function resolveObstacles(unit) {
    const pos = unit.model.root.position;
    for (const obstacle of obstacles) {
      // Flyers above an obstacle's top pass over it.
      if (unit.flight && obstacle.top != null && pos.y >= obstacle.top - 0.3) continue;
      if (obstacle.shape === "circle") {
        const dx = pos.x - obstacle.x;
        const dz = pos.z - obstacle.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const min = obstacle.r + unit.radius * 0.65;
        if (dist < min) {
          const push = (min - dist) / dist;
          pos.x += dx * push;
          pos.z += dz * push;
        }
      } else if (obstacle.shape === "aabb") {
        const hx = obstacle.hw + unit.radius * 0.7;
        const hz = obstacle.hd + unit.radius * 0.7;
        const dx = pos.x - obstacle.x;
        const dz = pos.z - obstacle.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
          const penX = hx - Math.abs(dx);
          const penZ = hz - Math.abs(dz);
          if (penX < penZ) pos.x += Math.sign(dx || 1) * penX;
          else pos.z += Math.sign(dz || 1) * penZ;
        }
      }
    }
    const limit = map.half - 28;
    pos.x = clamp(pos.x, -limit, limit);
    pos.z = clamp(pos.z, -limit, limit);
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
    player.lookYaw -= input.dx * 0.0023;
    player.lookYaw -= input.turn * Math.max(0.85, perf.turn) * dt;
    player.lookPitch = clamp(player.lookPitch - input.dy * 0.002, -1.05, 0.5);
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
    const maxSpeed = perf.speed * (boost ? perf.boostMul : 1) * (input.forward < 0 ? 0.55 : 1) * skillMul;
    if (player.flight && player.flight.airborne) {
      // In the air W/S trim airspeed (no reverse); it keeps what it has.
      const goal = input.forward > 0 ? maxSpeed : input.forward < 0 ? 0 : player.speed;
      player.speed = approach(player.speed, goal, 14 * perf.accelMul * dt);
    } else {
      player.speed = approach(player.speed, input.forward * maxSpeed, 34 * perf.accelMul * dt);
    }
    player.climbCmd = input.climb || 0;
    player.strafeVel = approach(player.strafeVel, input.strafe * perf.speed * 0.62 * skillMul, 28 * perf.accelMul * dt);
    moveChassis(player, dt);
    player.boosting = boost;
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
    const maxSpeed = perf.speed * (cmd.throttle < 0 ? 0.55 : 1) * skillMul;
    unit.speed = approach(unit.speed, (cmd.throttle || 0) * maxSpeed, 28 * perf.accelMul * dt);
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

  // AI barrels: clamp only the horizontal swing to the chassis; elevation
  // is free up to ~75 degrees so ground Zoids can shoot up at flyers and
  // flyers can shoot down.
  function clampAimYaw(forward, dir, maxYaw) {
    const r = clampAimYawPitch(forward, dir, maxYaw);
    return new Vector3(r.x, r.y, r.z);
  }

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

  function raycast(origin, dir, ignoreId, maxDist) {
    const direction = dir.clone();
    if (direction.lengthSq() < 1e-10) return null;
    direction.normalize();
    raycaster.set(origin, direction);
    raycaster.near = 0.15;
    raycaster.far = maxDist;
    const list = map.ground ? hitMeshes.concat([map.ground]) : hitMeshes;
    const raw = raycaster.intersectObjects(list, false);
    const tagged = raw.map((hit) => {
      const data = hit.object.userData || {};
      return {
        ownerId: data.ownerId || null,
        partId: data.partId || null,
        block: !!data.block,
        ground: !!(data.ground || hit.object === map.ground),
        hit,
      };
    });
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
    const point = aimPointAlongRay(origin, direction, hit ? hit.point : null, AIM_FAR);
    return new Vector3(point.x, point.y, point.z);
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
    if (unit !== player) {
      const chassisFwd = facingDirection(unit.model.root, new Vector3());
      dir = clampAimYaw(chassisFwd, dir, 0.6);
    }
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
  function ballisticDirFor(unit, weapon, muzzle, point) {
    const solved = ballisticAim(
      { x: muzzle.x, y: muzzle.y, z: muzzle.z },
      { x: point.x, y: point.y, z: point.z },
      weapon.speed || 80,
      weapon.gravity || BALLISTIC_GRAVITY,
    );
    let dir = new Vector3(solved.dir.x, solved.dir.y, solved.dir.z);
    if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
    if (unit !== player) {
      const chassisFwd = facingDirection(unit.model.root, new Vector3());
      dir = clampAimYaw(chassisFwd, dir, 0.6);
    }
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

  function shoot(unit, weapon, aimPoint) {
    const muzzleObj = unit.model.muzzles[weapon.mount];
    if (!muzzleObj) return;
    let point = aimPoint;
    if (!point) {
      if (unit.cmd && unit.cmd.aim) {
        point = new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z);
        // AI leads moving targets with travelling shots (3D, so it leads
        // climbing / diving flyers too). Hitscan needs no lead.
        const tgt = unit.aiTarget;
        if (tgt && tgt.alive && !weapon.hitscan && weapon.delivery !== "rocket" && weapon.speed) {
          const from = new Vector3();
          muzzleObj.getWorldPosition(from);
          const led = leadPoint(from, point, tgt.vel3, weapon.speed).point;
          point.set(led.x, led.y, led.z);
        }
      }
      else {
        const fwd = facingDirection(unit.model.root, new Vector3());
        const origin = new Vector3();
        muzzleObj.getWorldPosition(origin);
        point = origin.clone().addScaledVector(fwd, 80);
      }
    }
    const muzzle = new Vector3();
    muzzleObj.getWorldPosition(muzzle);
    if (unit.model && unit.model.anim && unit.model.anim.kind === "skinned") {
      unit.model.anim.firePulse = true;
    }
    let dir;
    if (weapon.turret) {
      // Turret: straight from the barrel to the lock, never clamped to the nose.
      if (weapon.delivery === "ballistic") {
        const solved = ballisticAim(
          { x: muzzle.x, y: muzzle.y, z: muzzle.z },
          { x: point.x, y: point.y, z: point.z },
          weapon.speed || 80,
          weapon.gravity || BALLISTIC_GRAVITY,
        );
        dir = new Vector3(solved.dir.x, solved.dir.y, solved.dir.z);
      } else {
        dir = point.clone().sub(muzzle);
      }
      if (dir.lengthSq() < 1e-8) facingDirection(unit.model.root, dir);
      dir.normalize();
      weapon.turretFired = (weapon.turretFired || 0) + 1;
    } else {
      dir = weapon.delivery === "ballistic"
        ? ballisticDirFor(unit, weapon, muzzle, point)
        : mountAimDirection(unit, weapon.mount, point);
    }
    const volley = weapon.volley || 1;
    for (let i = 0; i < volley; i++) {
      const shotDir = dir.clone();
      const spread = (weapon.spread || 0) * spreadMul(unit);
      if (spread) {
        shotDir.x += (rng() - 0.5) * spread * (volley > 1 ? 2 : 1);
        shotDir.y += (rng() - 0.5) * spread;
        shotDir.z += (rng() - 0.5) * spread * (volley > 1 ? 2 : 1);
        shotDir.normalize();
      }
      if (weapon.hitscan) hitscan(unit, weapon, muzzle, shotDir);
      else spawnProjectile(unit, weapon, muzzle, shotDir);
    }
    if (!weapon.skillShot && addWeaponHeat(weapon, (weapon.heat || 0) * heatGenMul(unit))) {
      sfx("alarm");
      if (unit === player) pushMessage(`${weapon.name} overheated`);
    }
    sfx(shotSound(weapon));
    flash(muzzle, weapon.color, 0.35);
  }

  function shotSound(weapon) {
    if (weapon.id === "gatling") return "gatling";
    if (weapon.id === "beamCannon") return "beam";
    if (weapon.id === "missilePack") return "missile";
    if (weapon.id === "shockCannon") return "shock";
    if (weapon.id === "chargedParticle") return "cpc";
    return "laser";
  }

  function hitscan(unit, weapon, origin, dir) {
    const hit = raycast(origin, dir, unit.id, weapon.range);
    const end = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, weapon.range);
    beam(origin, end, weapon.color);
    weapon.lastHit = hit
      ? { owner: (hit.object.userData || {}).ownerId || null, part: (hit.object.userData || {}).partId || null, ground: !!((hit.object.userData || {}).ground || hit.object === map.ground), block: !!(hit.object.userData || {}).block, dist: hit.distance }
      : null;
    if (!hit) return;
    const hitData = hit.object.userData || {};
    if (hitData.block || hitData.ground || hit.object === map.ground) {
      flash(hit.point, 0xffcc88, 0.45);
      return;
    }
    const victim = units.find((u) => u.id === hit.object.userData.ownerId);
    if (!victim || !victim.alive) return;
    const dist = origin.distanceTo(hit.point);
    const amount = weapon.damage * damageMul(unit) * rangeFalloff(dist, weapon.optimal, weapon.range);
    if (amount <= 0) return;
    applyDamage(victim, hit.object.userData.partId, amount, unit, damageCtxFor(weapon));
    flash(hit.point, weapon.color, 0.4);
  }

  function spawnProjectile(unit, weapon, origin, dir) {
    const speed = weapon.speed || 70;
    const rocket = weapon.delivery === "rocket";
    const gravity = rocket ? 0 : (weapon.gravity || 0);
    const mesh = new Mesh(
      new SphereGeometry(rocket ? 0.28 : 0.22, 8, 6),
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
      popTime: weapon.popTime,
      mesh,
    });
  }

  function updateProjectiles(dt) {
    for (const shot of projectiles) {
      const target = shot.targetId ? units.find((u) => u.id === shot.targetId && u.alive) : null;
      const prev = { x: shot.x, y: shot.y, z: shot.z };
      stepProjectile(shot, dt, target ? {
        x: target.model.root.position.x,
        y: target.model.root.position.y + target.radius * 0.4,
        z: target.model.root.position.z,
        speed: planarSpeed(target),
      } : null);
      shot.mesh.position.set(shot.x, shot.y, shot.z);
      if (shot.y <= map.heightAt(shot.x, shot.z) + 0.2) {
        shot.life = 0;
        flash(shot.mesh.position.clone(), shot.color, 0.5);
        continue;
      }
      const stepDir = new Vector3(shot.x - prev.x, shot.y - prev.y, shot.z - prev.z);
      const dist = stepDir.length();
      if (dist > 0.001) {
        stepDir.multiplyScalar(1 / dist);
        const hit = raycast(new Vector3(prev.x, prev.y, prev.z), stepDir, shot.ownerId, dist + 0.2);
        if (hit) {
          shot.life = 0;
          const hitData = hit.object.userData || {};
          if (hitData.block || hitData.ground || hit.object === map.ground) flash(hit.point, shot.color, 0.5);
          else {
            const victim = units.find((u) => u.id === hit.object.userData.ownerId);
            const attacker = units.find((u) => u.id === shot.ownerId);
            if (victim && victim.alive && attacker) {
              const dist = Math.hypot(hit.point.x - shot.ox, hit.point.y - shot.oy, hit.point.z - shot.oz);
              const amount = shot.damage * rangeFalloff(dist, shot.optimal, shot.range);
              if (amount > 0) applyDamage(victim, hit.object.userData.partId, amount, attacker, shot.dmgCtx);
            }
            flash(hit.point, shot.color, 0.55);
          }
        }
      }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const shot = projectiles[i];
      if (shot.life <= 0 || shot.traveled > shot.range + 10) {
        scene.remove(shot.mesh);
        shot.mesh.geometry.dispose();
        shot.mesh.material.dispose();
        projectiles.splice(i, 1);
      }
    }
  }

  function applyDamage(victim, partId, amount, attacker, dmgCtx = {}) {
    if (!partId || !victim.alive) return;
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
      return;
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

  function beam(from, to, color) {
    const dir = new Vector3().subVectors(to, from);
    const len = Math.max(0.2, dir.length());
    const mesh = new Mesh(new BoxGeometry(0.08, 0.08, 1), new MeshBasicMaterial({ color }));
    mesh.scale.set(1, 1, len);
    mesh.position.copy(from).addScaledVector(dir, 0.5);
    // The beam box is symmetric. lookAt aims its +Z along the shot.
    mesh.lookAt(to);
    mesh.userData.life = 0.07;
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

  function currentTarget() {
    const list = enemies();
    if (!list.length) return null;
    targetIndex = ((targetIndex % list.length) + list.length) % list.length;
    return list[targetIndex];
  }

  function cycleTarget(step) {
    const list = enemies();
    if (!list.length) return;
    targetIndex = (targetIndex + step + list.length) % list.length;
    player.lockId = list[targetIndex].id;
  }

  function targetNearest() {
    const list = enemies();
    let best = 0;
    let bestD = Infinity;
    list.forEach((unit, i) => {
      const d = unit.model.root.position.distanceTo(player.model.root.position);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    targetIndex = best;
    if (list[best]) player.lockId = list[best].id;
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
      if (anchor && anchor.visible) {
        let dir;
        if (lock && result.inArc) {
          const muzzle = new Vector3();
          anchor.getWorldPosition(muzzle);
          dir = lockAimPoint(lock).sub(muzzle);
        } else {
          const yaw = root.rotation.y + weapon.turretState.yaw;
          dir = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        }
        if (dir.lengthSq() > 1e-8) aimNegZ(anchor, dir.normalize());
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

  let hudObjective = contract.brief;

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
    const offset = fwd.clone().multiplyScalar(-dist).addScaledVector(UP, 1.5);
    // Positive lookPitch raises the view (camera drops). Negative lookPitch looks down.
    offset.applyAxisAngle(right, player.lookPitch);
    const lookTarget = yawRig.clone().addScaledVector(fwd, 16);
    if (cameraMode === "fps") {
      camera.position.copy(eye);
      const orbit = yawRig.clone().add(offset);
      const lookDir = lookTarget.clone().sub(orbit);
      if (lookDir.lengthSq() < 1e-6) lookDir.copy(fwd);
      lookDir.normalize();
      camera.lookAt(eye.clone().add(lookDir));
    } else {
      camera.position.copy(yawRig).add(offset);
      const minY = map.heightAt(camera.position.x, camera.position.z) + 1.5;
      if (camera.position.y < minY) camera.position.y = minY;
      camera.lookAt(lookTarget);
    }
    const spec = spectateId ? units.find((u) => u.id === spectateId && u.alive) : null;
    if (spec) {
      const sp = spec.model.root.position;
      const away = sp.clone().sub(player.model.root.position).setY(0).normalize();
      camera.position.copy(sp).addScaledVector(away, 14).add(new Vector3(0, 4, 0));
      camera.lookAt(player.model.root.position.clone().lerp(sp, 0.35));
    }
    // The eye sits inside the head and the shield plate. Hide those body meshes
    // while the view is first person. Raycasts ignore visibility, so hits still land.
    const showBody = cameraMode !== "fps";
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
    const fps = cameraMode === "fps";
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

  // Test hooks (browser flight test): scripted input, forced aim target and
  // a spectator camera on another unit looking at the player.
  let forcedInput = null;
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
    if (forcedInput) forcedInput = { ...forcedInput, camera: false, tab: false, nearest: false, skill: false };
    lastGroups = input.groups.slice();
    if (input.help) helpOn = !helpOn;
    if (input.camera) cameraMode = cameraMode === "fps" ? "tps" : "fps";
    if (input.tab) cycleTarget(1);
    if (input.nearest) targetNearest();

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
          updateBrain(unit, unit.brain, { units, time: missionTime }, dt);
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
      resolveObstacles(unit);
      if (unit.flight) flyUnit(unit, dt);
      else plant(unit);
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
        const mul = (weapon.kind === "energy" ? coolMul : 1) * loadCool;
        coolWeapon(weapon, dt * mul, unit.speed);
      }
      const locked = weaponsLocked(unit);
      const moving = planarSpeed(unit) >= STATIONARY_SPEED;
      updateTurrets(unit, dt);
      for (const weapon of unit.weapons) {
        if (weapon.turret) {
          // Auto-fire: only at the locked target, only when on it.
          let trigger = !!weapon.turretTrigger;
          if (weapon.delivery === "rocket") {
            trigger = trigger && rocketMayFire(unit.rocketLock || 0) && unit.rocketLockId === weapon.turretTargetId;
          }
          const lock = trigger ? lockTargetOf(unit) : null;
          if (weaponWantsShot(weapon, dt, trigger && !!lock, canOperateWeapon(unit, weapon) && !locked, moving)) {
            if (unit !== player && unit.fireRateMul !== 1) weapon.cooldown /= unit.fireRateMul;
            shoot(unit, weapon, lockAimPoint(lock));
          }
          continue;
        }
        let trigger = unit === player
          ? !!input.groups[(weapon.group || 1) - 1]
          : !!(unit.cmd && unit.cmd.fire);
        if (weapon.delivery === "rocket") {
          trigger = trigger && rocketMayFire(unit.rocketLock || 0) && !!unit.rocketLockId;
        }
        if (weaponWantsShot(weapon, dt, trigger, canOperateWeapon(unit, weapon) && !locked, moving)) {
          if (unit !== player && unit.fireRateMul !== 1) weapon.cooldown /= unit.fireRateMul;
          shoot(unit, weapon, unit === player ? playerAim : null);
        }
      }
    }
    if (liveBattle) {
      updateProjectiles(dt);
      updateObjectives(dt);
    }
    applyFpvWeapons();
    updateEffects(dt);
    pushHud(input);
    cullFarUnits();
    renderer.render(scene, camera);
  }

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

  const LOCK_CONE = Math.cos(6 * Math.PI / 180);

  function playerRocketTarget(aimPoint, maxRange) {
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
    const to = selected.model.root.position.clone();
    to.y += (selected.radius || 2) * 0.45;
    to.sub(origin);
    if (to.lengthSq() < 1e-6) return null;
    to.normalize();
    if (dir.dot(to) < LOCK_CONE) return null;
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
    const maxRange = rockets.reduce((max, weapon) => Math.max(max, weapon.range || 0), 0);
    const lockTime = rockets[0].lockTime || LOCK_TIME;
    let track = null;
    const turretRocket = rockets.some((weapon) => weapon.turret);
    if (turretRocket) {
      const lock = lockTargetOf(unit);
      if (lock) {
        const dist = lock.model.root.position.distanceTo(unit.model.root.position);
        if (dist <= maxRange) track = { id: lock.id, speed: planarSpeed(lock) };
      }
    } else if (unit === player) track = playerRocketTarget(aimPoint, maxRange);
    else if (unit.aiTarget && unit.aiTarget.alive) {
      const dist = unit.aiTarget.model.root.position.distanceTo(unit.model.root.position);
      if (dist <= maxRange) track = { id: unit.aiTarget.id, speed: planarSpeed(unit.aiTarget) };
    }
    const stepped = stepLock(unit.rocketLock || 0, dt, track ? track.speed : 0, !!track, lockTime);
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

  let lastAimMarkers = { impact: null, lead: null, drop: null };

  function ballisticHud(aimPoint) {
    const gun = player.weapons.find((weapon) => weapon.delivery === "ballistic" && mountUsable(player, weapon));
    if (!gun || !player.model.muzzles[gun.mount]) {
      lastAimMarkers = { impact: null, lead: null, drop: null };
      return lastAimMarkers;
    }
    const muzzle = new Vector3();
    player.model.muzzles[gun.mount].getWorldPosition(muzzle);
    const origin = { x: muzzle.x, y: muzzle.y, z: muzzle.z };
    const aim = { x: aimPoint.x, y: aimPoint.y, z: aimPoint.z };
    const speed = gun.speed || 80;
    const gravity = gun.gravity || BALLISTIC_GRAVITY;
    const solved = ballisticAim(origin, aim, speed, gravity);
    const impactWorld = solved.solved ? aim : dropPoint(origin, aim, speed, gravity);
    const dropped = dropPoint(origin, aim, speed, gravity);
    const impact = projectHudPoint(impactWorld.x, impactWorld.y, impactWorld.z);
    const drop = dropped.drop > 0.2 ? projectHudPoint(dropped.x, dropped.y, dropped.z) : null;
    let lead = null;
    const target = currentTarget();
    if (target && target.alive) {
      const pos = target.model.root.position;
      const aimAt = {
        x: pos.x,
        y: pos.y + (target.radius || 2) * 0.45,
        z: pos.z,
      };
      const leadWorld = leadPoint(origin, aimAt, target.vel3 || unitPlanarVelocity(target), speed).point;
      lead = projectHudPoint(leadWorld.x, leadWorld.y, leadWorld.z);
    }
    lastAimMarkers = {
      impact: impact ? { ...impact, label: solved.solved ? "IMPACT" : "SHORT" } : null,
      lead: lead ? { ...lead, label: "LEAD" } : null,
      drop: drop ? { ...drop, label: `DROP ${dropped.drop.toFixed(1)}m` } : null,
    };
    return lastAimMarkers;
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
      });
    }
    return rows;
  }

  const indicatorPoint = new Vector3();
  const indicatorDir = new Vector3();
  let lastProbe = { arrows: [], rows: [], radarRange: 0 };

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
      const range = 190 * (perf.sensors.rangeMul || 1) * radarMul(player);
      targetData = {
        name: target.name,
        layout: target.def.layout,
        parts: target.parts,
        distance,
        locked: distance <= range,
      };
    }
    const radarRange = (perf.sensors.radar ? 230 : 42) * perf.sensors.rangeMul * radarMul(player);
    const probe = objectiveReadout(radarRange);
    const marks = [];
    for (const unit of units) {
      if (unit === player || !unit.alive) continue;
      const distance = unit.model.root.position.distanceTo(player.model.root.position);
      if (distance > radarRange) continue;
      marks.push({
        x: unit.model.root.position.x,
        z: unit.model.root.position.z,
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
    const living = player.weapons.filter((weapon) => mountUsable(player, weapon));
    const reach = living.reduce((max, weapon) => Math.max(max, weapon.range || 0), 0);
    const outOfRange = !!(targetData && targetData.locked && reach > 0 && targetData.distance > reach);
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
      speed: Math.abs(player.speed),
      speedPct: (Math.abs(player.speed) / Math.max(0.1, perf.speed)) * 100,
      flight: player.flight ? {
        alt: player.flight.agl,
        airspeed: Math.max(0, player.speed) * 3.6,
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
      weapons: groupRows(),
      lock: rocket ? {
        value: player.rocketLock || 0,
        tracking: !!player.rocketTracking,
        strength: player.rocketStrength || 0,
      } : null,
      charge: charging ? {
        pct: (charging.charge || 0) / charging.chargeTime,
        name: charging.name,
      } : null,
      markers: aimMarkers,
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
      },
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
      player.lookPitch = -0.42;
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
    failTest(failures, forwardMove.length() > 1.5, `W did not move the Zoid (${forwardMove.length().toFixed(2)})`);
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
  targetNearest();
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
      for (let attempt = -0.75; attempt <= 0.4; attempt += 0.02) {
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

  return { finish };
}
