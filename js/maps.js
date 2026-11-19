// Battlefield meshes. The layout itself (terrain, cover, water, hazards) is
// pure data from js/battlefield.js; this file only draws it. Everything is
// procedural geometry and canvas textures made here (no external assets).
// Hard cover is drawn with merged or instanced meshes for few draw calls;
// shots test the cover analytically (battlefield.rayBlockers), not these meshes.

import {
  Group,
  Mesh,
  InstancedMesh,
  Object3D,
  MeshLambertMaterial,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  CircleGeometry,
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  BackSide,
  DoubleSide,
  Color,
  Matrix4,
  Euler,
  Vector3,
  Quaternion,
} from "three";
import { mulberry32 } from "./catalog.js";
import { createField, passWall, passExcess, PASS_WALL_STEP, passCenter, passHalfWidth, GROUND_EXTENT, PLAY_LIMIT, ROAD } from "./battlefield.js";

const WATER_COLOR = { city: 0x3d4d4a, denseJungle: 0x3f5f4a, sparseJungle: 0x4a7f92, pass: 0x6fa6c2 };

export function createMap(biomeIn, seed) {
  const field = createField(biomeIn, seed || 1);
  const biome = field.biome;
  const look = field.look;
  const rng = mulberry32(((seed || 1) ^ 0x7f4a7c15) >>> 0);
  const heightAt = field.heightAt;
  const group = new Group();
  const tmp = new Object3D();
  const col = new Color();
  const animated = [];

  // ---------- ground ----------
  // Detailed ground over the play box, a coarse skirt beyond it (tiny far
  // triangles are what cost on software GL).
  const inner = PLAY_LIMIT + 28;
  const segs = biome === "pass" ? 160 : 72; // pass: 7.7 m cells so the 9-20 m side gullies read;
  const geo = new PlaneGeometry(inner * 2, inner * 2, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new Color(look.low);
  const high = new Color(look.high);
  const cliff = new Color(look.cliff);
  const snow = new Color(look.snow || 0xffffff);
  const mud = new Color(0x4a3d2c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const n = Math.sin(x * 0.13 + z * 0.07) * 0.5 + Math.sin(x * 0.031 - z * 0.047) * 0.5;
    const t = Math.max(0, Math.min(1, 0.45 + n * 0.35 + (biome === "pass" ? 0 : y * 0.04)));
    col.copy(low).lerp(high, t);
    if (biome === "pass") {
      const wall = passExcess(x, z);
      if (wall > 2) col.lerp(cliff, Math.min(1, (wall - 2) / 6));
      if (y > 104) col.lerp(snow, Math.min(1, (y - 104) / 14));
    }
    const wet = field.waterAt(x, z).depth;
    if (wet > 0) col.lerp(mud, Math.min(0.85, 0.35 + wet * 0.25));
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  let upSum = 0;
  let samples = 0;
  for (let i = 0; i < normals.count; i += 17) {
    upSum += normals.getY(i);
    samples += 1;
  }
  if (upSum / samples < 0.2) throw new Error("Ground normals do not face up");
  const ground = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: biome === "pass" }));
  ground.name = "ground";
  // Draw order on software GL: Zoids (0), cover (1), ground (2), skirt (3),
  // sky (1000). Cover first lets the depth test skip hidden ground pixels.
  ground.renderOrder = 2;
  group.add(ground);
  {
    const sg = new PlaneGeometry(GROUND_EXTENT * 2, GROUND_EXTENT * 2, 24, 24);
    sg.rotateX(-Math.PI / 2);
    const spos = sg.attributes.position;
    const scol = new Float32Array(spos.count * 3);
    for (let i = 0; i < spos.count; i++) {
      const x = spos.getX(i);
      const z = spos.getZ(i);
      const y = heightAt(x, z);
      spos.setY(i, y - 0.8);
      col.copy(low).lerp(high, 0.5);
      if (biome === "pass" && passExcess(x, z) > 2) col.lerp(cliff, 0.8);
      if (biome === "pass" && y > 104) col.lerp(snow, Math.min(1, (y - 104) / 14));
      scol[i * 3] = col.r;
      scol[i * 3 + 1] = col.g;
      scol[i * 3 + 2] = col.b;
    }
    sg.setAttribute("color", new BufferAttribute(scol, 3));
    sg.computeVertexNormals();
    // Drop the skirt quads under the detailed ground (no hidden overdraw).
    const idx = sg.index.array;
    const keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      let insideAll = true;
      for (let k = 0; k < 3; k++) {
        const v = idx[i + k];
        if (Math.abs(spos.getX(v)) > inner + 1 || Math.abs(spos.getZ(v)) > inner + 1) insideAll = false;
      }
      if (!insideAll) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    sg.setIndex(keep);
    const skirt = new Mesh(sg, new MeshLambertMaterial({ vertexColors: true, flatShading: biome === "pass" }));
    skirt.name = "ground-skirt";
    skirt.renderOrder = 3;
    group.add(skirt);
  }

  // ---------- sky ----------
  const skyGeo = new SphereGeometry(1800, 32, 16);
  const sp = skyGeo.attributes.position;
  const skyCols = new Float32Array(sp.count * 3);
  const top = new Color(look.skyTop);
  const hor = new Color(look.skyHorizon);
  const fogC = new Color(look.fog);
  for (let i = 0; i < sp.count; i++) {
    const v = sp.getY(i) / 1800;
    if (v < 0.04) col.copy(hor).lerp(fogC, Math.min(1, (0.04 - v) * 6));
    else col.copy(hor).lerp(top, Math.pow(Math.min(1, (v - 0.04) / 0.7), 0.7));
    skyCols[i * 3] = col.r;
    skyCols[i * 3 + 1] = col.g;
    skyCols[i * 3 + 2] = col.b;
  }
  skyGeo.setAttribute("color", new BufferAttribute(skyCols, 3));
  // Drawn after the opaque scene with depth test on, so only the pixels
  // that really show sky are shaded (a full-screen dome costs ~14 ms on
  // software GL).
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  sky.name = "sky";
  sky.renderOrder = 1000;
  group.add(sky);
  const sunDir = new Vector3(...look.sunDir).normalize();
  const sunDisc = new Mesh(new SphereGeometry(38, 12, 8), new MeshBasicMaterial({ color: look.sun, fog: false }));
  sunDisc.position.copy(sunDir).multiplyScalar(1650);
  sunDisc.renderOrder = 1001;
  group.add(sunDisc);

  // ---------- water ----------
  const waterMat = new MeshLambertMaterial({
    color: WATER_COLOR[biome], transparent: true, opacity: 0.82,
    emissive: WATER_COLOR[biome], emissiveIntensity: 0.18, depthWrite: false, side: DoubleSide,
  });
  for (const w of field.water) {
    if (w.shape === "pool") {
      const disc = new Mesh(new CircleGeometry(w.r + 4, 28), waterMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(w.x, w.surface, w.z);
      disc.name = "water";
      group.add(disc);
      continue;
    }
    const verts = [];
    const pts = [];
    for (let i = 0; i < w.points.length - 1; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      for (let k = 0; k < 4; k++) pts.push({ x: a.x + (b.x - a.x) * (k / 4), z: a.z + (b.z - a.z) * (k / 4) });
    }
    pts.push(w.points[w.points.length - 1]);
    const half = w.halfWidth + 3;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l;
      const nz = dx / l;
      const ya = w.surfaceAt(a.x, a.z);
      const yb = w.surfaceAt(b.x, b.z);
      const a1 = [a.x + nx * half, ya, a.z + nz * half];
      const a2 = [a.x - nx * half, ya, a.z - nz * half];
      const b1 = [b.x + nx * half, yb, b.z + nz * half];
      const b2 = [b.x - nx * half, yb, b.z - nz * half];
      verts.push(...a1, ...b1, ...a2, ...a2, ...b1, ...b2);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    const strip = new Mesh(g, waterMat);
    strip.name = "water";
    group.add(strip);
  }

  // ---------- city avenue (the convoy road): cracked asphalt strip ----------
  if (biome === "city") {
    const tex = asphaltTexture(seed);
    const hw = ROAD.halfWidth + 1;
    const z0 = PLAY_LIMIT;
    const z1 = -PLAY_LIMIT;
    const segs = Math.ceil((z0 - z1) / 8);
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= segs; i++) {
      const z = z0 - ((z0 - z1) * i) / segs;
      for (const [k, x] of [[0, -hw], [1, hw]]) {
        pos.push(x, Math.max(heightAt(x, z), heightAt(0, z)) + 0.12, z);
        uv.push(k, (z0 - z) / 32);
      }
      if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); // faces up
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const road = new Mesh(g, new MeshLambertMaterial({ map: tex, color: tex ? 0xffffff : 0x55524d, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    road.name = "city-road";
    road.renderOrder = 1;
    group.add(road);
  }

  // ---------- merged box geometry (city) ----------
  function boxBuffer() {
    return { p: [], n: [], c: [], uv: [] };
  }
  const corner = new Vector3();
  const quat = new Quaternion();
  const euler = new Euler();
  // Box centred at (x, y, z), size w x h x d, yaw then tilt about local X.
  // Side faces go to `walls` (UV in metres / 32, for the window texture),
  // top and bottom to `plain` (or everything to plain when walls is null).
  function pushBox(walls, plain, x, y, z, w, h, d, color, yaw = 0, tilt = 0) {
    euler.set(tilt, yaw, 0, "YXZ");
    quat.setFromEuler(euler);
    col.set(color);
    const faces = [
      { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], s: [w / 2, h, d], side: true },
      { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], s: [w / 2, h, d], side: true },
      { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], s: [d / 2, h, w], side: true },
      { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], s: [d / 2, h, w], side: true },
      { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], s: [h / 2, d, w], side: false },
      { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], s: [h / 2, d, w], side: false },
    ];
    for (const f of faces) {
      const out = f.side && walls ? walls : plain;
      const [off, vLen, uLen] = f.s;
      const nrm = new Vector3(...f.n).applyQuaternion(quat);
      const quad = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
      for (const [su, sv] of quad) {
        corner.set(
          f.n[0] * off + f.u[0] * su * (uLen / 2) + f.v[0] * sv * (vLen / 2),
          f.n[1] * off + f.u[1] * su * (uLen / 2) + f.v[1] * sv * (vLen / 2),
          f.n[2] * off + f.u[2] * su * (uLen / 2) + f.v[2] * sv * (vLen / 2),
        ).applyQuaternion(quat);
        out.p.push(x + corner.x, y + corner.y, z + corner.z);
        out.n.push(nrm.x, nrm.y, nrm.z);
        out.c.push(col.r, col.g, col.b);
        out.uv.push(((su + 1) / 2) * uLen / 32, ((sv + 1) / 2) * vLen / 32);
      }
    }
  }
  function meshFrom(buf, material, name) {
    if (!buf.p.length) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(buf.p, 3));
    g.setAttribute("normal", new Float32BufferAttribute(buf.n, 3));
    g.setAttribute("color", new Float32BufferAttribute(buf.c, 3));
    g.setAttribute("uv", new Float32BufferAttribute(buf.uv, 2));
    g.computeBoundingSphere();
    const m = new Mesh(g, material);
    m.name = name;
    m.userData.block = true;
    group.add(m);
    return m;
  }

  const coverMeshes = {}; // kind -> mesh (for obstacle.mesh and destructibles)
  const P = field.props;

  // ---------- Abandoned City ----------
  if (biome === "city") {
    const walls = boxBuffer();
    const plain = boxBuffer();
    const CONCRETE = [0x8b8378, 0x7a7469, 0x9a9184, 0x6c665f, 0x857a6c, 0x7d6f62];
    for (const b of P.buildings) {
      const base = heightAt(b.x, b.z) - 0.4;
      const tint = CONCRETE[Math.floor(b.tint * CONCRETE.length) % CONCRETE.length];
      const mainH = b.broken ? b.h * 0.82 : b.h;
      pushBox(walls, plain, b.x, base + mainH / 2, b.z, b.hw * 2, mainH, b.hd * 2, tint);
      if (b.broken) {
        // Jagged, blown-out top floors and a dangling beam.
        const r2 = mulberry32(b.seed);
        for (let k = 0; k < 3; k++) {
          const w = b.hw * (0.5 + r2() * 0.7);
          const d = b.hd * (0.5 + r2() * 0.7);
          const h = b.h * 0.18 * (0.3 + r2());
          pushBox(walls, plain, b.x + (r2() - 0.5) * (b.hw * 2 - w), base + mainH + h / 2, b.z + (r2() - 0.5) * (b.hd * 2 - d), w, h, d, tint);
        }
        pushBox(null, plain, b.x + b.hw * 0.6, base + mainH + 1.5, b.z, 1.2, 1.2, b.hd * 1.6, 0x3c3a37, 0.3, 0.35);
      } else if (b.h > 30) {
        pushBox(null, plain, b.x, base + mainH + 1.6, b.z, b.hw * 0.6, 3.2, b.hd * 0.6, 0x5a5650);
      }
    }
    for (const r of P.rubble) {
      const base = heightAt(r.x, r.z);
      const r2 = mulberry32(Math.floor(r.x * 31 + r.z * 17) >>> 0);
      for (let k = 0; k < 9; k++) {
        const w = 4 + r2() * 9;
        const h = 1.5 + r2() * (r.h * 0.7);
        pushBox(null, plain, r.x + (r2() - 0.5) * r.hw * 1.5, base + h * 0.35, r.z + (r2() - 0.5) * r.hd * 1.5, w, h, 3 + r2() * 7,
          CONCRETE[k % CONCRETE.length], r2() * 6.28, (r2() - 0.5) * 0.6);
      }
      const s = r.slab;
      pushBox(walls, plain, r.x, base + (s.h / 2) * Math.cos(s.tilt), r.z, s.w, s.h, 1.6, 0x8a8174, s.yaw, s.tilt);
    }
    for (const b of P.skyline) {
      pushBox(walls, plain, b.x, b.base + b.h / 2, b.z, b.w, b.h, b.d, 0x5b5852);
    }
    // Canal walls.
    for (const w of field.water) {
      if (w.name !== "canal") continue;
      for (const side of [-1, 1]) {
        pushBox(null, plain, 0, heightAt(0, w.points[0].z + side * (w.halfWidth + 1)) - 0.5, w.points[0].z + side * (w.halfWidth + 1.5), GROUND_EXTENT * 2, 1.6, 1.4, 0x6f685f);
      }
    }
    const wallMat = new MeshLambertMaterial({ vertexColors: true, map: facadeTexture(seed) });
    const plainMat = new MeshLambertMaterial({ vertexColors: true });
    coverMeshes.building = meshFrom(walls, wallMat, "city-walls");
    coverMeshes.rubble = meshFrom(plain, plainMat, "city-plain");
    // Wrecked cars and barriers (instanced, destructible).
    if (P.cars.length) {
      const g = new BoxGeometry(1, 1, 1);
      g.translate(0, 0.5, 0);
      const cars = new InstancedMesh(g, new MeshLambertMaterial(), P.cars.length);
      P.cars.forEach((c, i) => {
        tmp.position.set(c.x, heightAt(c.x, c.z) - 0.1, c.z);
        tmp.rotation.set(0, 0, 0);
        tmp.scale.set(c.hw * 2, c.h, c.hd * 2);
        tmp.updateMatrix();
        cars.setMatrixAt(i, tmp.matrix);
        cars.setColorAt(i, col.set(c.barrier ? 0x9b9488 : [0x7a3b2a, 0x51585c, 0x6b5a3a, 0x3e4a3d, 0x8a8a84][Math.floor(c.tint * 5)]));
        if (c.blocker) c.blocker.vis = { mesh: cars, index: i };
      });
      cars.name = "city-cars";
      cars.userData.block = true;
      group.add(cars);
      coverMeshes.car = cars;
      coverMeshes.barrier = cars;
    }
    // Fires (emissive flames; no point lights, they cost every pixel).
    const flameGeo = new ConeGeometry(1.4, 4, 6);
    flameGeo.translate(0, 2, 0);
    const flameMat = new MeshBasicMaterial({ color: 0xff8a2a, fog: true });
    for (const f of P.fires) {
      const flame = new Mesh(flameGeo, flameMat);
      flame.position.set(f.x, heightAt(f.x, f.z), f.z);
      flame.userData.phase = rng() * 6.28;
      group.add(flame);
      animated.push((t) => {
        const s = 0.8 + Math.sin(t * 9 + flame.userData.phase) * 0.18 + Math.sin(t * 23 + flame.userData.phase) * 0.08;
        flame.scale.set(1, s, 1);
      });
    }
  }

  // ---------- trees, saplings, undergrowth ----------
  if (P.trees.length) {
    const trunkGeo = new CylinderGeometry(0.72, 1, 1, 6, 1, true);
    trunkGeo.translate(0, 0.5, 0);
    const trunks = new InstancedMesh(trunkGeo, new MeshLambertMaterial({ flatShading: true }), P.trees.length);
    const canopyGeo = new IcosahedronGeometry(1, 0);
    const blobs = 1; // one blob per tree: a second one cost ~8 ms/frame on software GL
    const canopy = new InstancedMesh(canopyGeo, new MeshLambertMaterial({ flatShading: true }), P.trees.length * blobs);
    const LEAF = biome === "denseJungle" ? [0x2f5a23, 0x3b6b2a, 0x274d1e, 0x46772f] : [0x4b7f2f, 0x5d8f36, 0x6f9a3a, 0x3e6e2a];
    P.trees.forEach((t, i) => {
      tmp.position.set(t.x, t.base - 0.3, t.z);
      tmp.rotation.set(t.lean, t.tint * 6, 0);
      tmp.scale.set(t.r, t.trunkH + t.canopy * 0.4, t.r);
      tmp.updateMatrix();
      trunks.setMatrixAt(i, tmp.matrix);
      trunks.setColorAt(i, col.set(0x5a4632).offsetHSL(0, 0, (t.tint - 0.5) * 0.08));
      for (let k = 0; k < blobs; k++) {
        const c = t.canopy * (k ? 0.75 : biome === "denseJungle" ? 1.15 : 1);
        tmp.position.set(t.x + (k ? (t.tint - 0.5) * c : 0), t.base + t.trunkH + c * (k ? 0.9 : 0.35), t.z + (k ? (0.5 - t.tint) * c : 0));
        tmp.rotation.set(0, t.tint * 9 + k, 0);
        tmp.scale.set(c, c * 0.72, c);
        tmp.updateMatrix();
        canopy.setMatrixAt(i * blobs + k, tmp.matrix);
        canopy.setColorAt(i * blobs + k, col.set(LEAF[(i + k) % LEAF.length]));
      }
      if (t.blocker) t.blocker.vis = { mesh: trunks, index: i };
    });
    trunks.name = "tree-trunks";
    canopy.name = "tree-canopy";
    group.add(trunks, canopy);
    coverMeshes.tree = trunks;
  }
  if (P.saplings.length) {
    const sTrunk = new CylinderGeometry(0.6, 0.9, 1, 5, 1, true);
    sTrunk.translate(0, 0.5, 0);
    const sTop = new ConeGeometry(1, 1, 6);
    sTop.translate(0, 0.5, 0);
    const trunks = new InstancedMesh(sTrunk, new MeshLambertMaterial({ color: 0x6a543a }), P.saplings.length);
    const tops = new InstancedMesh(sTop, new MeshLambertMaterial({ flatShading: true }), P.saplings.length);
    P.saplings.forEach((s, i) => {
      tmp.position.set(s.x, s.base, s.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(s.r, s.h, s.r);
      tmp.updateMatrix();
      trunks.setMatrixAt(i, tmp.matrix);
      tmp.position.set(s.x, s.base + s.h * 0.45, s.z);
      tmp.scale.set(2.4 + s.tint * 1.4, s.h * 0.75, 2.4 + s.tint * 1.4);
      tmp.updateMatrix();
      tops.setMatrixAt(i, tmp.matrix);
      tops.setColorAt(i, col.set(biome === "denseJungle" ? 0x3d7a2c : 0x5f9a38).offsetHSL(0, 0, (s.tint - 0.5) * 0.1));
      s.blocker.vis = { mesh: trunks, index: i, extra: { mesh: tops, index: i } };
    });
    trunks.name = "sapling-trunks";
    tops.name = "sapling-tops";
    group.add(trunks, tops);
    coverMeshes.sapling = trunks;
  }
  if (P.bushes.length) {
    const g = new IcosahedronGeometry(1, 0);
    const bushes = new InstancedMesh(g, new MeshLambertMaterial({ flatShading: true }), P.bushes.length);
    P.bushes.forEach((b, i) => {
      tmp.position.set(b.x, b.base + b.s * 0.3, b.z);
      tmp.rotation.set(0, b.tint * 6, 0);
      tmp.scale.set(b.s * 1.3, b.s * 0.7, b.s * 1.3);
      tmp.updateMatrix();
      bushes.setMatrixAt(i, tmp.matrix);
      bushes.setColorAt(i, col.set(biome === "denseJungle" ? 0x335f26 : 0x5b8a34).offsetHSL(0, 0, (b.tint - 0.5) * 0.12));
    });
    bushes.name = "undergrowth";
    group.add(bushes);
  }
  if (P.grass.length) {
    const g = new ConeGeometry(0.5, 1, 4);
    g.translate(0, 0.5, 0);
    const grass = new InstancedMesh(g, new MeshLambertMaterial({ flatShading: true }), P.grass.length);
    P.grass.forEach((b, i) => {
      tmp.position.set(b.x, b.base, b.z);
      tmp.rotation.set(0, b.tint * 6, 0);
      tmp.scale.set(b.s * 2.2, b.s * 1.6, b.s * 2.2);
      tmp.updateMatrix();
      grass.setMatrixAt(i, tmp.matrix);
      grass.setColorAt(i, col.set(0x8aa64e).offsetHSL(0, 0, (b.tint - 0.5) * 0.15));
    });
    grass.name = "tall-grass";
    group.add(grass);
  }

  // ---------- rocks ----------
  if (P.boulders.length) {
    const g = new DodecahedronGeometry(1, 0);
    const rocks = new InstancedMesh(g, new MeshLambertMaterial({ flatShading: true }), P.boulders.length);
    const ROCK = biome === "pass" ? [0x7d705f, 0x8f8270, 0x6c6052] : [0x6e6a62, 0x7c776c, 0x5f5b54];
    P.boulders.forEach((b, i) => {
      tmp.position.set(b.x, b.base + b.h / 2, b.z);
      tmp.rotation.set(b.tint * 0.4, b.yaw, 0);
      tmp.scale.set(b.r, b.h / 2 + 0.3, b.r * (0.85 + b.tint * 0.3));
      tmp.updateMatrix();
      rocks.setMatrixAt(i, tmp.matrix);
      rocks.setColorAt(i, col.set(ROCK[i % ROCK.length]));
      if (b.blocker) b.blocker.vis = { mesh: rocks, index: i };
    });
    rocks.name = "boulders";
    group.add(rocks);
    coverMeshes.boulder = rocks;
  }
  if (P.spires.length) {
    const g = new CylinderGeometry(0.5, 1, 1, 7, 4);
    const gp = g.attributes.position;
    const r2 = mulberry32(((seed || 1) ^ 0x1234) >>> 0);
    for (let i = 0; i < gp.count; i++) {
      const y = gp.getY(i);
      if (Math.abs(y) < 0.49) gp.setXYZ(i, gp.getX(i) * (0.85 + r2() * 0.3), y, gp.getZ(i) * (0.85 + r2() * 0.3));
    }
    g.translate(0, 0.5, 0);
    g.computeVertexNormals();
    const spires = new InstancedMesh(g, new MeshLambertMaterial({ color: 0x7a6c5a, flatShading: true }), P.spires.length);
    P.spires.forEach((s, i) => {
      tmp.position.set(s.x, s.base, s.z);
      tmp.rotation.set(0, s.yaw, 0);
      tmp.scale.set(s.r, s.h, s.r);
      tmp.updateMatrix();
      spires.setMatrixAt(i, tmp.matrix);
      s.blocker.vis = { mesh: spires, index: i };
    });
    spires.name = "rock-spires";
    group.add(spires);
    coverMeshes.spire = spires;
  }

  // ---------- backdrop ----------
  if (biome === "pass") {
    // Snow-capped peaks above the canyon rim.
    const peakGeo = new ConeGeometry(1, 1, 6);
    peakGeo.translate(0, 0.5, 0);
    const peaks = new InstancedMesh(peakGeo, new MeshLambertMaterial({ color: 0x8b8a8c, flatShading: true }), 22);
    const caps = new InstancedMesh(peakGeo, new MeshLambertMaterial({ color: 0xf2f4f6, flatShading: true }), 22);
    for (let i = 0; i < 22; i++) {
      const z = -900 + i * 85 + rng() * 30;
      const side = i % 2 ? 1 : -1;
      const x = passCenter(z) + side * (passHalfWidth(z) + 220 + rng() * 240);
      const h = 150 + rng() * 140;
      const r = 90 + rng() * 70;
      const base = heightAt(x, z) - 20;
      tmp.position.set(x, base, z);
      tmp.rotation.set(0, rng() * 6, 0);
      tmp.scale.set(r, h, r);
      tmp.updateMatrix();
      peaks.setMatrixAt(i, tmp.matrix);
      tmp.position.set(x, base + h * 0.7, z);
      tmp.scale.set(r * 0.31, h * 0.3, r * 0.31);
      tmp.updateMatrix();
      caps.setMatrixAt(i, tmp.matrix);
    }
    group.add(peaks, caps);
  } else if (biome !== "city") {
    const hillGeo = new ConeGeometry(1, 1, 7);
    hillGeo.translate(0, 0.5, 0);
    const hills = new InstancedMesh(hillGeo, new MeshLambertMaterial({ color: biome === "denseJungle" ? 0x2e4d2a : 0x557a45, flatShading: true }), 16);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
      const d = 820 + rng() * 120;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      tmp.position.set(x, heightAt(x, z) - 10, z);
      tmp.rotation.set(0, rng() * 6, 0);
      const r = 120 + rng() * 80;
      tmp.scale.set(r, 70 + rng() * 80, r);
      tmp.updateMatrix();
      hills.setMatrixAt(i, tmp.matrix);
    }
    group.add(hills);
  }

  // Obstacles for the mission: the field's blockers, each pointing at the
  // mesh that draws it (models_check and flyers use .mesh / .top).
  for (const b of field.blockers) b.mesh = coverMeshes[b.kind] || ground;
  for (const o of group.children) {
    if (o.renderOrder === 0 && o !== ground && o.name !== "water") o.renderOrder = 1;
  }
  const obstacles = field.blockers;

  function update(t) {
    for (const fn of animated) fn(t);
  }

  // Hide a destroyed prop instance.
  const zero = new Matrix4().makeScale(0, 0, 0);
  function hideProp(blocker) {
    const v = blocker.vis;
    if (!v) return;
    for (const part of [v, v.extra].filter(Boolean)) {
      part.mesh.setMatrixAt(part.index, zero);
      part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  const palette = { ...look, sky: look.skyHorizon };
  return { group, ground, heightAt, obstacles, half: PLAY_LIMIT + 28, biome, palette, field, update, hideProp, sunDir };
}

// Procedural facade: 32 m x 32 m of concrete with 8 floors of windows, some
// lit, some blown out or boarded. Canvas only (no external image).
function facadeTexture(seed) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  const r = mulberry32(((seed || 1) ^ 0x2468ace) >>> 0);
  ctx.fillStyle = "#e9e5de";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(60,55,50,${0.05 + r() * 0.08})`;
    ctx.fillRect(r() * 256, r() * 256, 2 + r() * 10, 2 + r() * 14);
  }
  for (let fy = 0; fy < 8; fy++) {
    ctx.fillStyle = "rgba(90,85,80,0.35)";
    ctx.fillRect(0, fy * 32 + 29, 256, 3);
    for (let fx = 0; fx < 8; fx++) {
      const roll = r();
      ctx.fillStyle = roll < 0.03 ? "#e8b860" : roll < 0.3 ? "#151515" : roll < 0.36 ? "#6b5136" : "#2e3a44";
      ctx.fillRect(fx * 32 + 7, fy * 32 + 8, 18, 16);
      if (roll >= 0.36) {
        ctx.fillStyle = "rgba(160,190,210,0.25)";
        ctx.fillRect(fx * 32 + 8, fy * 32 + 9, 7, 6);
      }
    }
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// Procedural asphalt for the avenue: 2 lanes, dashed centre line, worn
// edge lines, cracks and patches. Canvas only.
function asphaltTexture(seed) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d");
  const r = mulberry32(((seed || 1) ^ 0x13579b) >>> 0);
  ctx.fillStyle = "#97938b"; // sun-bleached, dusty asphalt
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) {
    const v = 120 + Math.floor(r() * 50);
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 5},0.35)`;
    ctx.fillRect(r() * 128, r() * 256, 1 + r() * 3, 1 + r() * 3);
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = `rgba(105,100,92,${0.35 + r() * 0.3})`;
    ctx.fillRect(r() * 110, r() * 240, 10 + r() * 22, 8 + r() * 26);
  }
  ctx.fillStyle = "rgba(225,220,200,0.75)";
  ctx.fillRect(6, 0, 3, 256);
  ctx.fillRect(119, 0, 3, 256);
  ctx.fillStyle = "rgba(220,190,90,0.8)";
  for (let y = 0; y < 256; y += 64) ctx.fillRect(62, y + 8, 4, 36);
  ctx.strokeStyle = "rgba(60,57,52,0.6)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = r() * 128;
    let y = r() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (r() - 0.5) * 24;
      y += (r() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

// Static minimap layer: cover, cliffs and water drawn once at 0.5 px per m.
export const MINIMAP_PPM = 0.5;
export function minimapLayer(field) {
  if (typeof document === "undefined") return null;
  const size = Math.round(PLAY_LIMIT * 2 * MINIMAP_PPM) + 8;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const o = size / 2;
  const S = MINIMAP_PPM;
  if (field.biome === "pass") {
    ctx.fillStyle = "rgba(120, 104, 86, 0.55)";
    // Rock (cliffs and mountain tops) sampled every 4 m, so the side
    // branches show as lighter channels through it.
    for (let z = -PLAY_LIMIT; z <= PLAY_LIMIT; z += 4) {
      for (let x = -PLAY_LIMIT; x <= PLAY_LIMIT; x += 4) {
        if (passExcess(x, z) > PASS_WALL_STEP) ctx.fillRect(o + x * S, o + z * S, 4 * S + 0.5, 4 * S + 0.5);
      }
    }
  }
  ctx.fillStyle = "rgba(80, 150, 200, 0.55)";
  for (const w of field.water) {
    if (w.shape === "pool") {
      ctx.beginPath();
      ctx.arc(o + w.x * S, o + w.z * S, w.r * S, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(80, 150, 200, 0.55)";
      ctx.lineWidth = w.halfWidth * 2 * S;
      ctx.beginPath();
      w.points.forEach((p, i) => (i ? ctx.lineTo(o + p.x * S, o + p.z * S) : ctx.moveTo(o + p.x * S, o + p.z * S)));
      ctx.stroke();
    }
  }
  for (const b of field.blockers) {
    if (b.hp) continue;
    ctx.fillStyle = b.kind === "building" ? "rgba(170, 170, 160, 0.55)" : b.kind === "tree" ? "rgba(70, 130, 60, 0.6)" : "rgba(150, 130, 110, 0.6)";
    if (b.shape === "circle") {
      ctx.beginPath();
      ctx.arc(o + b.x * S, o + b.z * S, Math.max(0.8, b.r * S), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(o + (b.x - b.hw) * S, o + (b.z - b.hd) * S, b.hw * 2 * S, b.hd * 2 * S);
    }
  }
  return { canvas: c, ppm: S, origin: o };
}
