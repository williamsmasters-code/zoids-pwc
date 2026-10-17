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
  serializeParts,
  sensorsFromHead,
  repairCost,
} from "./damage.js";
import { createMap } from "./maps.js";
import { buildUnitModel, tagOwner, refreshPartColors, disposeTree } from "./models.js";
import { createInput } from "./input.js";
import { createHUD, headingOf } from "./hud.js";
import { createBrain, updateBrain } from "./ai.js";
import { addHeat, coolUnit, weaponWantsShot, stepProjectile, canOperateWeapon } from "./combat.js";
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
  let pacify = false;
  let helpOn = false;
  let cameraMode = "tps";
  let endTimer = 0;
  let endVictory = false;
  let missionTime = 0;
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

  const spawnZ = contract.type === "defend" ? 70 : 90;
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
  const beaconMeshes = [];
  if (contract.type === "recon") {
    for (const spot of [
      { x: 80, z: 10 },
      { x: -90, z: -80 },
      { x: 40, z: -190 },
    ]) {
      const beacon = { ...spot, progress: 0, done: false };
      beacons.push(beacon);
      const mesh = new Mesh(
        new CylinderGeometry(1.2, 1.2, 18, 8),
        new MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.28 }),
      );
      mesh.position.set(spot.x, map.heightAt(spot.x, spot.z) + 8, spot.z);
      scene.add(mesh);
      beaconMeshes.push(mesh);
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
    });
    spawnUnit(STRUCTURES.gunTurret, {
      team: "enemy",
      name: "Turret 2",
      x: 18,
      z: baseZ + 8,
      weapons: stockWeaponsFor(STRUCTURES.gunTurret, rng),
      brain: true,
    });
  }

  if (contract.type === "defend") {
    trucks = [-8, 8].map((x, i) => spawnUnit(STRUCTURES.supplyTruck, {
      team: "player",
      name: `Supply Truck ${i + 1}`,
      x,
      z: spawnZ + 28,
      yaw: 0,
      weapons: [],
      scripted: true,
    }));
    for (const truck of trucks) {
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

  const waves = contract.waves || [{ at: 0, enemies: contract.enemies }];
  const spawnedWaves = new Set();

  function runtimeWeapon(w) {
    const spec = WEAPONS[w.type];
    return {
      ...spec,
      uid: w.uid,
      mount: w.mount,
      group: w.group || 1,
      cooldown: rng() * 0.3,
      charge: 0,
      charging: false,
    };
  }

  function spawnUnit(def, opts) {
    const id = `u${uid++}`;
    const weapons = (opts.weapons || []).map(runtimeWeapon);
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
      brain: opts.brain ? createBrain(rng) : null,
      cmd: null,
      aiTarget: null,
      script: null,
      scripted: !!opts.scripted,
      radius: def.radius || 2,
      perf: null,
    };
    units.push(unit);
    return unit;
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
      const level = contract.difficulty >= 5 ? 2 : contract.difficulty >= 4 ? 1 : 0;
      const armorLevels = {};
      for (const id of partListFor(def)) armorLevels[id] = level;
      const weapons = stockWeaponsFor(def, rng);
      let x;
      let z;
      const side = (i - (wave.enemies.length - 1) / 2) * 18;
      if (contract.type === "assault" && generator) {
        x = generator.model.root.position.x + side;
        z = generator.model.root.position.z + 18 + i * 8;
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

  function resolveObstacles(unit) {
    const pos = unit.model.root.position;
    for (const obstacle of obstacles) {
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
    const boost = input.boost && input.forward > 0 && perf.boosterReady && player.shutdown <= 0;
    const shutdownMul = player.shutdown > 0 ? 0.35 : 1;
    const maxSpeed = perf.speed * (boost ? perf.boostMul : 1) * (input.forward < 0 ? 0.55 : 1) * shutdownMul;
    player.speed = approach(player.speed, input.forward * maxSpeed, 34 * dt);
    player.strafeVel = approach(player.strafeVel, input.strafe * perf.speed * 0.62 * shutdownMul, 28 * dt);
    moveChassis(player, dt);
    if (boost) {
      if (addHeat(player, 9 * dt)) {
        sfx("alarm");
        pushMessage("Heat shutdown");
      }
    }
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
    const shutdownMul = unit.shutdown > 0 ? 0.35 : 1;
    const maxSpeed = perf.speed * (cmd.throttle < 0 ? 0.55 : 1) * shutdownMul;
    unit.speed = approach(unit.speed, (cmd.throttle || 0) * maxSpeed, 28 * dt);
    unit.strafeVel = approach(unit.strafeVel, (cmd.strafe || 0) * perf.speed * 0.55 * shutdownMul, 22 * dt);
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
      dir = clampAim(chassisFwd, dir, 0.6);
    }
    if (anchor) aimNegZ(anchor, dir);
    return dir;
  }

  function trackWeapons(unit, dir) {
    for (const [mount, anchor] of Object.entries(unit.model.anchors)) {
      if (mount === "eye" || !unit.model.muzzles[mount] || !anchor.visible) continue;
      aimNegZ(anchor, dir);
    }
  }

  function trackPlayerWeapons(aimPoint) {
    for (const mount of Object.keys(player.model.muzzles)) {
      if (!player.model.muzzles[mount]) continue;
      mountAimDirection(player, mount, aimPoint);
    }
  }

  function shoot(unit, weapon, aimPoint) {
    const muzzleObj = unit.model.muzzles[weapon.mount];
    if (!muzzleObj) return;
    let point = aimPoint;
    if (!point) {
      if (unit.cmd && unit.cmd.aim) point = new Vector3(unit.cmd.aim.x, unit.cmd.aim.y, unit.cmd.aim.z);
      else {
        const fwd = facingDirection(unit.model.root, new Vector3());
        const origin = new Vector3();
        muzzleObj.getWorldPosition(origin);
        point = origin.clone().addScaledVector(fwd, 80);
      }
    }
    const dir = mountAimDirection(unit, weapon.mount, point);
    const muzzle = new Vector3();
    muzzleObj.getWorldPosition(muzzle);
    const volley = weapon.volley || 1;
    for (let i = 0; i < volley; i++) {
      const shotDir = dir.clone();
      if (weapon.spread) {
        shotDir.x += (rng() - 0.5) * weapon.spread * (volley > 1 ? 2 : 1);
        shotDir.y += (rng() - 0.5) * weapon.spread;
        shotDir.z += (rng() - 0.5) * weapon.spread * (volley > 1 ? 2 : 1);
        shotDir.normalize();
      }
      if (weapon.hitscan) hitscan(unit, weapon, muzzle, shotDir);
      else spawnProjectile(unit, weapon, muzzle, shotDir);
    }
    if (addHeat(unit, weapon.heat)) {
      sfx("alarm");
      if (unit === player) pushMessage("Heat shutdown");
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
    if (!hit) return;
    const hitData = hit.object.userData || {};
    if (hitData.block || hitData.ground || hit.object === map.ground) {
      flash(hit.point, 0xffcc88, 0.45);
      return;
    }
    const victim = units.find((u) => u.id === hit.object.userData.ownerId);
    if (!victim || !victim.alive) return;
    applyDamage(victim, hit.object.userData.partId, weapon.damage, unit);
    flash(hit.point, weapon.color, 0.4);
  }

  function spawnProjectile(unit, weapon, origin, dir) {
    const speed = weapon.speed || 70;
    const mesh = new Mesh(
      new SphereGeometry(weapon.id === "chargedParticle" ? 0.55 : 0.22, 8, 6),
      new MeshBasicMaterial({ color: weapon.color }),
    );
    mesh.position.copy(origin);
    scene.add(mesh);
    // Player rounds fly at the crosshair point. Homing would pull them off it.
    const homing = unit !== player && !!weapon.homing;
    const target = homing ? unit.aiTarget : null;
    projectiles.push({
      x: origin.x,
      y: origin.y,
      z: origin.z,
      vx: dir.x * speed,
      vy: dir.y * speed,
      vz: dir.z * speed,
      speed,
      damage: weapon.damage,
      color: weapon.color,
      ownerId: unit.id,
      life: weapon.range / speed + 0.35,
      traveled: 0,
      range: weapon.range,
      homing,
      turn: homing ? 2.6 : 0,
      targetId: target && target.alive ? target.id : null,
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
              applyDamage(victim, hit.object.userData.partId, shot.damage, attacker);
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

  function applyDamage(victim, partId, amount, attacker) {
    if (!partId || !victim.alive) return;
    const to = new Vector3(
      attacker.model.root.position.x - victim.model.root.position.x,
      0,
      attacker.model.root.position.z - victim.model.root.position.z,
    );
    if (to.lengthSq() > 1e-6) to.normalize();
    const fwd = facingDirection(victim.model.root, new Vector3());
    const forwardDot = fwd.dot(to);
    const result = applyHit(victim.parts, partId, amount, { zoidId: victim.def.id, forwardDot });
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
          beaconMeshes[i].material.color.setHex(0x3dff7a);
          beaconMeshes[i].material.opacity = 0.12;
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
      hudObjective = `Escort the trucks. ${rolling.length} still rolling.`;
      if (lead < spawnZ - 320) {
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

  function simulate(dt) {
    missionTime += dt;
    const input = paused ? {
      forward: 0, strafe: 0, turn: 0, boost: false, groups: [false, false, false, false],
      dx: 0, dy: 0, tab: false, nearest: false, camera: false, help: false,
    } : inputDevice.read();
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
          updateBrain(unit, unit.brain, { units }, dt);
          driveAI(unit, dt);
        }
      }
      separateUnits();
    }
    for (const unit of units) {
      if (!unit.alive) continue;
      resolveObstacles(unit);
      plant(unit);
    }

    for (const unit of units) {
      if (!unit.model.root.visible) continue;
      const speedNorm = Math.min(1, Math.abs(unit.speed) / Math.max(1, unit.def.speed || 1));
      unit.model.animate(missionTime, speedNorm, unit.parts);
      if (unit.alive) refreshPartColors(unit.model, unit.parts);
    }
    // Camera first, then fire, so the shot uses the view that is drawn.
    placeCamera();

    const playerAim = cameraAimPoint();
    trackPlayerWeapons(playerAim);
    for (const unit of units) {
      if (!unit.alive) continue;
      if (!liveBattle && unit !== player) continue;
      if (unit !== player) trackWeapons(unit, desiredAim(unit));
      coolUnit(unit, dt);
      for (const weapon of unit.weapons) {
        const trigger = unit === player
          ? !!input.groups[(weapon.group || 1) - 1]
          : !!(unit.cmd && unit.cmd.fire);
        if (weaponWantsShot(weapon, dt, trigger, canOperateWeapon(unit, weapon))) {
          shoot(unit, weapon, unit === player ? playerAim : null);
        }
      }
    }
    if (liveBattle) {
      updateProjectiles(dt);
      updateObjectives(dt);
    }
    updateEffects(dt);
    pushHud(input);
    renderer.render(scene, camera);
  }

  function groupRows() {
    const rows = [];
    for (let group = 1; group <= 4; group++) {
      const list = player.weapons.filter((weapon) => (weapon.group || 1) === group);
      if (!list.length) {
        rows.push({ group, name: "Empty", state: "empty", pct: 0, color: 0x334048 });
        continue;
      }
      const operable = list.filter((weapon) => canOperateWeapon(player, weapon));
      let state = "ready";
      if (!operable.length) state = "disabled";
      else if (operable.every((weapon) => weapon.cooldown > 0.03 || weapon.charging)) state = "cooling";
      const lead = operable[0] || list[0];
      const pct = lead.windup
        ? Math.round((lead.charge / Math.max(0.001, lead.windup)) * 100)
        : Math.round((1 - Math.min(1, lead.cooldown * (lead.rate || 1))) * 100);
      rows.push({
        group,
        name: list.map((weapon) => weapon.name).join(" + "),
        state,
        pct,
        color: lead.color,
      });
    }
    return rows;
  }

  function pushHud() {
    const perf = player.perf || derivePerformance(player.def, player.mods, player.parts, player.weight);
    const { fwd } = horizontalBasis(player.model.root);
    const target = currentTarget();
    let targetData = null;
    if (target) {
      const distance = target.model.root.position.distanceTo(player.model.root.position);
      const range = 190 * (perf.sensors.rangeMul || 1);
      targetData = {
        name: target.name,
        layout: target.def.layout,
        parts: target.parts,
        distance,
        locked: distance <= range,
      };
    }
    const radarRange = (perf.sensors.radar ? 230 : 42) * perf.sensors.rangeMul;
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
      });
    }
    for (const beacon of beacons) {
      marks.push({ x: beacon.x, z: beacon.z, color: beacon.done ? "#3dff7a" : "#ffd35a", r: 3.5 });
    }
    hud.update({
      scramble: perf.sensors.scramble,
      vignette,
      heading: headingOf(player.model.root.rotation.y),
      objective: hudObjective,
      cameraMode,
      playerName: player.name,
      layout: player.def.layout,
      parts: player.parts,
      speed: Math.abs(player.speed),
      speedPct: (Math.abs(player.speed) / Math.max(0.1, perf.speed)) * 100,
      heat: player.heat,
      shutdown: player.shutdown,
      boosting: player.boosting,
      boostReady: perf.boosterReady,
      target: targetData,
      weapons: groupRows(),
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
    for (const mesh of beaconMeshes) disposeTree(mesh);
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
        truck.model.root.position.z = spawnZ - 400;
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
  window.__ZOIDS__.weaponCooldowns = weaponCooldowns;
  window.__ZOIDS__.lastGroups = () => lastGroups.slice();
  window.__ZOIDS__.setGroup = setGroup;
  window.__ZOIDS__.setPacified = (value) => {
    pacify = !!value;
    return pacify;
  };
  window.__ZOIDS__.contract = contract.name;
  window.__ZOIDS__.contractType = contract.type;

  return { finish };
}
