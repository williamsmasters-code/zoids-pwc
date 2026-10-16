// DOM HUD. There is no overall hit-point bar. Parts carry the damage.

import { partColor, partRatio } from "./damage.js";
import { rightFromForward, headingFromYaw } from "./frame.js";

const QUAD_BOXES = [
  { id: "headWeapon", x: 80, y: 4, w: 60, h: 24, short: "JAW" },
  { id: "head", x: 74, y: 32, w: 72, h: 40, short: "HEAD" },
  { id: "leftWeapon", x: 2, y: 78, w: 34, h: 48, short: "L" },
  { id: "leftFrontLeg", x: 40, y: 78, w: 44, h: 50, short: "LF" },
  { id: "core", x: 88, y: 74, w: 44, h: 76, short: "CORE" },
  { id: "rightFrontLeg", x: 136, y: 78, w: 44, h: 50, short: "RF" },
  { id: "rightWeapon", x: 184, y: 78, w: 34, h: 48, short: "R" },
  { id: "leftRearLeg", x: 40, y: 134, w: 44, h: 46, short: "LR" },
  { id: "rightRearLeg", x: 136, y: 134, w: 44, h: 46, short: "RR" },
  { id: "backMount", x: 86, y: 156, w: 48, h: 26, short: "BACK" },
  { id: "tail", x: 96, y: 186, w: 28, h: 52, short: "TAIL" },
];

const BIPED_BOXES = [
  { id: "headWeapon", x: 78, y: 4, w: 64, h: 24, short: "JAW" },
  { id: "head", x: 70, y: 32, w: 80, h: 42, short: "HEAD" },
  { id: "leftWeapon", x: 4, y: 80, w: 42, h: 70, short: "L ARM" },
  { id: "core", x: 58, y: 80, w: 104, h: 72, short: "CORE" },
  { id: "rightWeapon", x: 174, y: 80, w: 42, h: 70, short: "R ARM" },
  { id: "backMount", x: 78, y: 156, w: 64, h: 26, short: "BACK" },
  { id: "leftLeg", x: 46, y: 168, w: 52, h: 58, short: "L LEG" },
  { id: "rightLeg", x: 122, y: 168, w: 52, h: 58, short: "R LEG" },
  { id: "tail", x: 96, y: 214, w: 28, h: 32, short: "TAIL" },
];

const STRUCT_BOXES = [
  { id: "head", x: 60, y: 16, w: 100, h: 40, short: "SENSOR" },
  { id: "headWeapon", x: 70, y: 64, w: 80, h: 28, short: "GUN" },
  { id: "core", x: 40, y: 104, w: 140, h: 80, short: "CORE" },
];

function boxesFor(layout) {
  if (layout === "quad") return QUAD_BOXES;
  if (layout === "biped") return BIPED_BOXES;
  return STRUCT_BOXES;
}

function ink(fill) {
  if (fill === "#141414" || fill === "#ff3344" || fill === "#ff8a2a") return "#f7f7f7";
  return "#102018";
}

export function diagramSVG(layout, parts) {
  const boxes = boxesFor(layout).filter((box) => parts && parts[box.id]);
  const rects = boxes.map((box) => {
    const part = parts[box.id];
    const fill = partColor(part);
    const pct = part.destroyed ? "X" : String(Math.round(partRatio(part) * 100));
    return `<g>
      <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="3" fill="${fill}" stroke="#071018" stroke-width="2"></rect>
      <text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 - 1}" fill="${ink(fill)}" text-anchor="middle">${box.short}</text>
      <text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + 12}" fill="${ink(fill)}" text-anchor="middle">${pct}</text>
    </g>`;
  }).join("");
  return `<svg viewBox="0 0 220 250" class="paper">${rects}</svg>`;
}

function worldToMini(fwd, px, pz, x, z, scale, cx, cy) {
  const right = rightFromForward(fwd);
  const dx = x - px;
  const dz = z - pz;
  const localRight = dx * right.x + dz * right.z;
  const localFwd = dx * fwd.x + dz * fwd.z;
  return { x: cx + localRight * scale, y: cy - localFwd * scale };
}

export function createHUD(root) {
  root.innerHTML = `
    <div id="scramble"></div>
    <div id="vignette"></div>
    <div class="hit front"></div>
    <div class="hit back"></div>
    <div class="hit left"></div>
    <div class="hit right"></div>
    <div class="reticle"><span></span></div>
    <div class="compass"><span id="heading">000</span></div>
    <div class="objective" id="objective"></div>
    <div class="cam-mode" id="cam-mode">3RD</div>
    <section class="panel player-panel">
      <header id="player-name">Zoid</header>
      <div id="player-diagram"></div>
      <div class="speed-row"><span id="speed">0</span><small>SPD</small><div class="bar"><i id="speed-bar"></i></div></div>
      <div class="heat-row">HEAT <div class="bar heat"><i id="heat-bar"></i></div></div>
      <div id="boost-flag"></div>
    </section>
    <section class="panel target-panel">
      <header id="target-name">No target</header>
      <div id="target-range"></div>
      <div id="target-diagram"></div>
    </section>
    <section class="weapon-dock" id="weapon-dock"></section>
    <canvas id="minimap" width="150" height="150"></canvas>
    <div class="log" id="log"></div>
    <div class="strip" id="strip">WASD move · Mouse aim · LMB/RMB/1-4 weapons · Shift boost · V camera · Tab target · R nearest · H help · Esc pause</div>
    <div class="help hidden" id="help">
      <h2>Controls</h2>
      <ul>
        <li>Click the field to capture the mouse.</li>
        <li>W / S or arrow up / down — throttle. A / D — strafe.</li>
        <li>Mouse, or arrow left / right — look. The chassis turns to follow, slower as legs take damage.</li>
        <li>Shift — boost, if back boosters are fitted and the back mount still stands.</li>
        <li>Left mouse or 1 — weapon group 1. Right mouse or 2 — group 2. 3 and 4 — the other groups.</li>
        <li>V — first person / third person. Tab — cycle target. R — nearest hostile.</li>
        <li>H — this list. Esc — pause and release the mouse.</li>
      </ul>
      <p>There is no Zoid health bar. Green, yellow, orange, red, then black on the paper doll are armor and structure per part. Core destruction kills. Leg damage slows you. Head damage scrambles the HUD. A destroyed mount kills its weapons.</p>
    </div>
    <div class="lock-prompt" id="lock-prompt">Click the battlefield to take the controls</div>
    <div class="pause hidden" id="pause">
      <h2>Paused</h2>
      <button type="button" id="resume">Resume</button>
      <button type="button" id="abort">Abort mission</button>
    </div>
  `;
  const mini = root.querySelector("#minimap");
  const ctx = mini.getContext("2d");
  return {
    root,
    setPaused(on) {
      root.querySelector("#pause").classList.toggle("hidden", !on);
    },
    onResume(fn) {
      root.querySelector("#resume").addEventListener("click", fn);
    },
    onAbort(fn) {
      root.querySelector("#abort").addEventListener("click", fn);
    },
    update(data) {
      root.style.setProperty("--scramble", String(data.scramble || 0));
      root.querySelector("#scramble").style.opacity = String(Math.min(0.75, data.scramble || 0));
      if ((data.scramble || 0) > 0.45) {
        const jx = (Math.random() - 0.5) * data.scramble * 10;
        const jy = (Math.random() - 0.5) * data.scramble * 8;
        root.querySelector(".player-panel").style.transform = `translate(${jx}px, ${jy}px)`;
        root.querySelector(".target-panel").style.transform = `translate(${-jx}px, ${jy}px)`;
      } else {
        root.querySelector(".player-panel").style.transform = "";
        root.querySelector(".target-panel").style.transform = "";
      }
      root.querySelector("#vignette").style.opacity = String(data.vignette || 0);
      root.querySelector("#heading").textContent = String(data.heading).padStart(3, "0");
      root.querySelector("#objective").textContent = data.objective || "";
      root.querySelector("#cam-mode").textContent = data.cameraMode === "fps" ? "1ST" : "3RD";
      root.querySelector("#player-name").textContent = data.playerName;
      root.querySelector("#player-diagram").innerHTML = diagramSVG(data.layout, data.parts);
      root.querySelector("#speed").textContent = String(Math.round(data.speed));
      root.querySelector("#speed-bar").style.width = `${Math.max(0, Math.min(100, data.speedPct))}%`;
      root.querySelector("#heat-bar").style.width = `${Math.max(0, Math.min(100, data.heat))}%`;
      root.querySelector("#boost-flag").textContent = data.shutdown > 0
        ? "SHUTDOWN"
        : data.boosting ? "BOOST" : data.boostReady ? "BOOST READY" : "";
      const target = data.target;
      if (!target) {
        root.querySelector("#target-name").textContent = "No target";
        root.querySelector("#target-range").textContent = "";
        root.querySelector("#target-diagram").innerHTML = "";
      } else if (target.locked === false) {
        root.querySelector("#target-name").textContent = data.scramble > 0.8 ? "???" : target.name;
        root.querySelector("#target-range").textContent = "OUT OF SENSOR RANGE";
        root.querySelector("#target-diagram").innerHTML = "";
      } else {
        root.querySelector("#target-name").textContent = data.scramble > 0.85 ? "UNKNOWN" : target.name;
        root.querySelector("#target-range").textContent = `${Math.round(target.distance)} m`;
        root.querySelector("#target-diagram").innerHTML = diagramSVG(target.layout, target.parts);
      }
      root.querySelector("#weapon-dock").innerHTML = data.weapons.map((weapon) => {
        const pct = weapon.windup
          ? Math.round((weapon.charge / weapon.windup) * 100)
          : Math.round((1 - weapon.cooldown * weapon.rate) * 100);
        return `<div class="wep ${weapon.destroyed ? "dead" : ""} ${weapon.firing ? "hot" : ""}">
          <b>${weapon.group}</b>
          <span>${weapon.name}</span>
          <i style="width:${Math.max(0, Math.min(100, pct))}%; background:#${weapon.color.toString(16).padStart(6, "0")}"></i>
        </div>`;
      }).join("");
      root.querySelector("#log").innerHTML = data.messages.map((line) => `<div>${line}</div>`).join("");
      root.querySelector("#help").classList.toggle("hidden", !data.help);
      root.querySelector("#lock-prompt").classList.toggle("hidden", data.locked || data.paused);
      root.querySelector("#strip").classList.toggle("hidden", data.help);
      for (const side of ["front", "back", "left", "right"]) {
        root.querySelector(`.hit.${side}`).style.opacity = String((data.hits && data.hits[side]) || 0);
      }
      drawMini(ctx, data.mini);
    },
  };
}

function drawMini(ctx, mini) {
  if (!mini) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(6, 12, 16, 0.72)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(61, 214, 232, 0.8)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const cx = w / 2;
  const cy = h / 2;
  const scale = mini.scale || 0.28;
  for (const mark of mini.marks || []) {
    const p = worldToMini(mini.fwd, mini.px, mini.pz, mark.x, mark.z, scale, cx, cy);
    if (p.x < 4 || p.y < 4 || p.x > w - 4 || p.y > h - 4) continue;
    ctx.fillStyle = mark.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, mark.r || 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#e8f6ff";
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx + 4, cy + 5);
  ctx.lineTo(cx - 4, cy + 5);
  ctx.closePath();
  ctx.fill();
}

export function headingOf(yaw) {
  return headingFromYaw(yaw);
}
