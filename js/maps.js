// Large open biomes. Ground height, rock meshes, and rock colliders share one record.

import {
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  DodecahedronGeometry,
  ConeGeometry,
  BufferAttribute,
  Color,
} from "three";
import { mulberry32 } from "./catalog.js";

const PALETTE = {
  desert: {
    low: 0xc4a36a,
    high: 0xe7d3a4,
    rock: 0x8a6240,
    ridge: 0xb08960,
    fog: 0xe7c99a,
    sky: 0xf0d7b0,
    hemiSky: 0xf3d7ae,
    hemiGround: 0x8a6244,
    sun: 0xfff1d6,
    density: 0.0048,
  },
  plains: {
    low: 0x4c6a3a,
    high: 0x8aa85e,
    rock: 0x6e6a62,
    ridge: 0x6d8a4e,
    fog: 0xb7d0ea,
    sky: 0xc5dff5,
    hemiSky: 0xc9def2,
    hemiGround: 0x3e5230,
    sun: 0xfff6e4,
    density: 0.0042,
  },
  arctic: {
    low: 0xd5e2ea,
    high: 0xf7fbfd,
    rock: 0x8e9aa3,
    ridge: 0xc5d0d6,
    fog: 0xd5e4ee,
    sky: 0xe7f1f6,
    hemiSky: 0xe7f2f8,
    hemiGround: 0x9aabba,
    sun: 0xffffff,
    density: 0.0052,
  },
};

// Fixed offsets keep the ridges off the play center without a second yaw formula.
const RIDGE_OFFSETS = [
  [0.92, 0.1],
  [-0.88, 0.2],
  [0.15, 0.9],
  [-0.2, -0.9],
  [0.7, 0.7],
  [-0.72, 0.68],
  [0.68, -0.7],
  [-0.66, -0.72],
];

function keptClear(x, z) {
  if (Math.hypot(x, z - 70) < 90) return false;
  if (Math.hypot(x, z + 180) < 80) return false;
  if (Math.hypot(x, z) < 50) return false;
  return true;
}

export function createMap(biome, seed) {
  const pal = PALETTE[biome] || PALETTE.plains;
  const rng = mulberry32(seed || 1);
  const hills = [];
  for (let i = 0; i < 7; i++) {
    const x = (rng() - 0.5) * 980;
    const z = (rng() - 0.5) * 980;
    if (!keptClear(x, z)) continue;
    hills.push({ x, z, r: 80 + rng() * 60, h: 5 + rng() * 9 });
  }

  function heightAt(x, z) {
    let h = 0;
    if (biome === "desert") {
      h += Math.sin(x * 0.011 + seed * 0.0001) * Math.cos(z * 0.009) * 2.8;
      h += Math.sin((x + z) * 0.028) * 0.55;
    } else if (biome === "arctic") {
      h += Math.sin(x * 0.007) * 2.2;
      h += Math.cos(z * 0.018 + x * 0.004) * 1.4;
    } else {
      h += Math.sin(x * 0.014) * Math.cos(z * 0.012) * 1.4;
      h += Math.sin(x * 0.035 + z * 0.028) * 0.4;
    }
    for (const hill of hills) {
      const dx = x - hill.x;
      const dz = z - hill.z;
      h += hill.h * Math.exp(-(dx * dx + dz * dz) / (2 * hill.r * hill.r));
    }
    return h;
  }

  const half = 640;
  const geo = new PlaneGeometry(half * 2, half * 2, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new Color(pal.low);
  const high = new Color(pal.high);
  const tint = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const t = Math.max(0, Math.min(1, (y + 1) / 10));
    tint.copy(low).lerp(high, t);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
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

  const ground = new Mesh(
    geo,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }),
  );
  ground.name = "ground";
  const group = new Group();
  group.add(ground);

  const obstacles = [];
  for (let i = 0; i < 16; i++) {
    const x = (rng() - 0.5) * half * 1.7;
    const z = (rng() - 0.5) * half * 1.7;
    if (!keptClear(x, z)) continue;
    const baseR = 3.2 + rng() * 5.5;
    const rockGeo = new DodecahedronGeometry(baseR, 0);
    const rp = rockGeo.attributes.position;
    for (let v = 0; v < rp.count; v++) {
      rp.setXYZ(
        v,
        rp.getX(v) * (0.9 + rng() * 0.18),
        rp.getY(v) * (0.75 + rng() * 0.3),
        rp.getZ(v) * (0.9 + rng() * 0.18),
      );
    }
    rockGeo.computeVertexNormals();
    let reach = 0;
    for (let v = 0; v < rp.count; v++) {
      reach = Math.max(reach, Math.hypot(rp.getX(v), rp.getZ(v)));
    }
    const mesh = new Mesh(rockGeo, new MeshStandardMaterial({ color: pal.rock, roughness: 0.92, metalness: 0.04 }));
    mesh.position.set(x, heightAt(x, z) - baseR * 0.2, z);
    mesh.rotation.y = rng() * 6.2;
    mesh.userData.block = true;
    group.add(mesh);
    obstacles.push({ shape: "circle", x, z, r: reach, mesh });
  }

  RIDGE_OFFSETS.forEach((offset, i) => {
    const x = offset[0] * half;
    const z = offset[1] * half;
    const h = 28 + (i % 3) * 12;
    const cone = new Mesh(
      new ConeGeometry(16 + (i % 4) * 4, h, 5),
      new MeshStandardMaterial({ color: pal.ridge, roughness: 1, metalness: 0 }),
    );
    cone.position.set(x, heightAt(x, z) + h * 0.28, z);
    cone.name = "ridge";
    group.add(cone);
  });

  return { group, ground, heightAt, obstacles, half, biome, palette: pal };
}
