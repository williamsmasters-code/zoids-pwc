// Hangar, shop, contracts, and the post-mission ledger.

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Color,
  Mesh,
  MeshStandardMaterial,
  CircleGeometry,
  SRGBColorSpace,
  ACESFilmicToneMapping,
  Vector3,
  Box3,
} from "three";
import {
  ZOIDS,
  ZOID_ORDER,
  WEAPONS,
  WEAPON_ORDER,
  MODS,
  MAX_ARMOR_LEVEL,
  BIOMES,
  partListFor,
  fits,
  armorUpgradeCost,
} from "./catalog.js";
import { repairCost } from "./damage.js";
import { TONNAGE_ZONES, TONNAGE_CEILING } from "./tonnage.js";
import { skillBlock } from "./skills.js";
import { creditsMarkup } from "./credits.js";
import { displaySpeed, displayKph, unitLabel, toggleSpeedUnit, getSpeedUnit, zeroTo100 } from "./units.js";
import { installMode, runInstallPrompt, installHelpMarkup, onInstallChange } from "./install.js";
import { bandText } from "./rangebands.js";

function weaponFacts(spec) {
  return `${spec.delivery} · ${bandText(spec)} · ${spec.heat} heat/shot · cool ${spec.cooling}/s`;
}
import { diagramSVG } from "./hud.js";
import { buildUnitModel, disposeTree } from "./models.js";
import { generateContracts } from "./contracts.js";
import { DIFFICULTY, DIFFICULTY_MIN, DIFFICULTY_MAX } from "./difficulty.js";
import {
  formatC,
  rankName,
  equippedWeapons,
  partsFor,
  totalWeight,
  performanceFor,
  notesFor,
  launchBlockReason,
  buyZoid,
  sellZoid,
  setActive,
  buyWeapon,
  sellWeapon,
  cycleGroup,
  equip,
  changeArmor,
  changeMod,
  repairZoid,
  applyMissionResult,
  rerollSeed,
  resetState,
  setMissionDifficulty,
} from "./state.js";

const UP = new Vector3(0, 1, 0);

export function showHangar(state, hooks) {
  const root = document.getElementById("hangar-root");
  root.classList.remove("hidden");
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <strong>ZOID MERCENARIES</strong>
        <span>Rogue Fang Company</span>
      </div>
      <label class="zoid-pick">
        <span>Viewing</span>
        <select id="zoid-select" aria-label="Zoid to view"></select>
      </label>
      <span id="active-chip" title="The active Zoid is the one that launches on contracts."></span>
      <div class="top-stats">
        <span id="rank"></span>
        <span id="record"></span>
        <b id="money"></b>
      </div>
      <button type="button" data-act="reset" id="reset-btn">Reset company</button>
    </header>
    <div class="hangar-main">
      <section class="stage">
        <div id="view-banner"></div>
        <div class="stage-view"><canvas id="preview-canvas" title="Drag to rotate · scroll or pinch to zoom · double-click to reset"></canvas><button type="button" id="view-reset" class="view-reset" title="Reset view">⟲</button></div>
        <div class="stage-readout" id="dossier">
          <div class="dossier-row">
            <div class="dossier-id">
              <h2 id="preview-name"></h2>
              <p id="preview-role"></p>
            </div>
            <div id="stats"></div>
            <button type="button" data-act="toggle-details" id="details-btn">Details</button>
          </div>
          <div id="tonnage-slot"></div>
          <div id="dossier-details" class="hidden">
            <p id="preview-blurb"></p>
            <div id="warnings"></div>
            <div id="detail-weapons"></div>
          </div>
        </div>
      </section>
      <aside id="loadout"></aside>
    </div>
    <section id="contracts"></section>
    <footer class="hangar-foot">
      <button type="button" data-act="credits">Model credits</button>
      <button type="button" data-act="install" id="install-btn" class="install-btn" title="Install the game as an app">Add to Home Screen</button>
      <span class="muted">Sketchfab meshes under CC-BY-4.0. ?mock=1 uses the procedural models.</span>
    </footer>
    <div id="launch-pop" class="launch-pop hidden" role="dialog" aria-label="Launch contract"></div>
    <div id="credits-panel" class="credits hidden"></div>
    <div id="install-pop" class="install-pop hidden" role="dialog" aria-label="Add to Home Screen"></div>
    <div id="status"></div>
  `;

  function syncInstallBtn() {
    const btn = root.querySelector("#install-btn");
    if (btn) btn.classList.toggle("hidden", installMode() === "installed");
  }
  syncInstallBtn();
  const offInstall = onInstallChange(syncInstallBtn);

  let viewing = state.selected;
  let picker = null;
  let status = "";
  let detailsOpen = false;
  let pending = null; // contract index whose launch popover is open
  const preview = createPreview(root.querySelector("#preview-canvas"));

  function flash(result) {
    if (result && result.ok === false) status = result.reason;
    else status = "";
  }

  function render() {
    const def = ZOIDS[viewing];
    const hangar = state.hangar[viewing];
    const parts = partsFor(state, viewing);
    const weight = totalWeight(state, viewing);
    const perf = performanceFor(state, viewing);
    const notes = notesFor(state, viewing);
    const block = launchBlockReason(state);
    const weapons = equippedWeapons(state, viewing);
    root.querySelector("#rank").textContent = rankName(state.reputation);
    root.querySelector("#record").textContent = `${state.wins} wins · rep ${state.reputation}`;
    root.querySelector("#money").textContent = formatC(state.money);
    root.querySelector("#money").classList.toggle("debt", state.money < 0);
    const activeId = state.selected;
    const isActive = activeId === viewing;
    root.querySelector("#preview-name").textContent = def.name;
    root.querySelector("#preview-role").textContent = `${def.role} · ${hangar.owned ? (isActive ? "ACTIVE" : "owned") : formatC(def.price)}`;
    root.querySelector("#preview-blurb").textContent = def.blurb;
    const speedKph = displaySpeed(perf.speed);
    const maxKph = displayKph(def.canonKph || 0);
    const uLabel = unitLabel();
    const turnDeg = Math.round(perf.turn * (180 / Math.PI));
    const load = perf.load;
    const heatLines = weapons.map((weapon) => {
      const spec = WEAPONS[weapon.type];
      return `<span>${spec.name}: ${weaponFacts(spec)}</span>`;
    }).join("");
    const rangeKey = WEAPON_ORDER.map((type) => {
      const spec = WEAPONS[type];
      return `<span data-weapon="${spec.id}" data-delivery="${spec.delivery}" data-range="${spec.range}">${spec.name} ${spec.delivery} ${spec.range}m</span>`;
    }).join("");
    root.querySelector("#stats").innerHTML = `
      <div class="stat speed-stat" title="Current top speed / canon top speed (all 3 Speed Boosters)"><b><em id="stat-speed">${speedKph}</em><small> / <em id="stat-maxspeed">${maxKph}</em></small></b><span>${uLabel} <button type="button" data-act="speed-unit" id="speed-unit-btn" class="unit-btn" title="Switch km/h / mph">${getSpeedUnit() === "mph" ? "MPH" : "KM/H"}</button></span></div>
      <div class="stat" title="0-100 km/h (canon-equivalent) at this load"><b id="stat-accel">${zeroTo100(perf).toFixed(1)}s</b><span>0-100</span></div>
      <div class="stat"><b>${turnDeg}</b><span>deg/s</span></div>
      <div class="stat"><b>${perf.boosterReady ? perf.boostMul.toFixed(2) + "x" : "—"}</b><span>boost</span></div>
      <div class="stat"><b>${Math.round(perf.sensors.rangeMul * 100)}%</b><span>sensors</span></div>
    `;
    root.querySelector("#tonnage-slot").innerHTML = tonnageBar(weight, def, load, speedKph, turnDeg);
    root.querySelector("#detail-weapons").innerHTML = `
      <div class="weapon-heat" id="weapon-heat">${heatLines || "<span>No weapons fitted.</span>"}</div>
      <div class="weapon-heat range-key" id="weapon-ranges">${rangeKey}</div>
    `;
    let skillHost = root.querySelector("#skill-slot");
    if (!skillHost) {
      skillHost = document.createElement("div");
      skillHost.id = "skill-slot";
      root.querySelector("#detail-weapons").insertAdjacentElement("afterend", skillHost);
    }
    skillHost.innerHTML = skillBlock(viewing);
    root.querySelector("#warnings").innerHTML = notes.map((note) => `<p>${note}</p>`).join("");
    root.querySelector("#dossier-details").classList.toggle("hidden", !detailsOpen);
    root.querySelector("#details-btn").textContent = detailsOpen ? "Hide details" : `Details${notes.length ? " (!)" : ""}`;

    const select = root.querySelector("#zoid-select");
    select.innerHTML = ZOID_ORDER.map((id) => {
      const z = ZOIDS[id];
      const owned = state.hangar[id].owned;
      const tag = id === activeId ? "owned · ACTIVE" : owned ? "owned" : formatC(z.price);
      return `<option value="${id}" data-id="${id}" data-owned="${owned}" ${id === viewing ? "selected" : ""}>${z.name} — ${z.role} — ${tag}</option>`;
    }).join("");
    select.value = viewing;
    root.querySelector("#active-chip").innerHTML = `Active: <b>${ZOIDS[activeId].name}</b>`;
    root.querySelector("#view-banner").innerHTML = isActive
      ? `<span class="tag active">ACTIVE</span> This Zoid launches on contracts.`
      : hangar.owned
        ? `<span class="tag">VIEWING</span> Not active. Contracts launch with ${ZOIDS[activeId].name}. <button type="button" data-act="activate" data-id="${viewing}">Set ${def.name} active</button>`
        : `<span class="tag">NOT OWNED</span> ${formatC(def.price)}. <button type="button" data-act="buy-zoid" data-id="${viewing}">Buy ${def.name}</button>`;
    root.querySelector("#view-banner").dataset.state = isActive ? "active" : hangar.owned ? "viewing" : "unowned";

    const hardpoints = def.hardpoints.map((hp) => {
      const uid = hangar.equipped[hp.id];
      const item = uid ? state.inventory.find((w) => w.uid === uid) : null;
      const spec = item ? WEAPONS[item.type] : null;
      const open = picker === hp.id;
      const choices = state.inventory.filter((inv) => fits(hp.size, WEAPONS[inv.type].size));
      return `<div class="slot">
        <div class="slot-head">
          <span>${hp.name} <small>${hp.size}</small></span>
          ${item ? `<button type="button" data-act="group" data-uid="${item.uid}">Group ${item.group}</button>` : ""}
        </div>
        <button type="button" class="slot-main" data-act="toggle-picker" data-mount="${hp.id}" ${hangar.owned ? "" : "disabled"}>
          ${spec ? `${spec.name} · ${weaponFacts(spec)}` : "Empty"}
        </button>
        ${open ? `<div class="picker">
          <button type="button" data-act="equip" data-mount="${hp.id}" data-uid="">Empty</button>
          ${choices.map((inv) => `<button type="button" data-act="equip" data-mount="${hp.id}" data-uid="${inv.uid}">${WEAPONS[inv.type].name} · G${inv.group}</button>`).join("")}
        </div>` : ""}
      </div>`;
    }).join("");

    const armorRows = partListFor(def).map((id) => {
      const level = hangar.armorLevel[id] || 0;
      const part = parts[id];
      const cost = level < MAX_ARMOR_LEVEL ? armorUpgradeCost(id, level, def.armorScale) : 0;
      return `<div class="armor-row">
        <span>${part.label} <small>${Math.round(part.armor)}/${Math.round(part.maxArmor)} a</small></span>
        <span>Lv ${level}</span>
        <button type="button" data-act="armor" data-part="${id}" data-dir="-1" ${level <= 0 ? "disabled" : ""}>-</button>
        <button type="button" data-act="armor" data-part="${id}" data-dir="1" ${level >= MAX_ARMOR_LEVEL ? "disabled" : ""}>+ ${cost ? formatC(cost) : ""}</button>
      </div>`;
    }).join("");

    const modRows = Object.entries(MODS).map(([key, spec]) => {
      const level = hangar.mods[key] || 0;
      const cost = level < spec.max ? spec.costs[level] : 0;
      return `<div class="armor-row">
        <span>${spec.name}<small>${spec.blurb}</small></span>
        <span>Lv ${level}</span>
        <button type="button" data-act="mod" data-key="${key}" data-dir="-1" ${level <= 0 ? "disabled" : ""}>-</button>
        <button type="button" data-act="mod" data-key="${key}" data-dir="1" ${level >= spec.max ? "disabled" : ""}>+ ${cost ? formatC(cost) : ""}</button>
      </div>`;
    }).join("");

    const shop = WEAPON_ORDER.map((type) => {
      const spec = WEAPONS[type];
      return `<button type="button" class="shop-row" data-act="buy-weapon" data-type="${type}">
        <span>${spec.name} <small>${spec.size} · ${spec.weight}t · ${weaponFacts(spec)}</small></span>
        <b>${formatC(spec.price)}</b>
      </button>`;
    }).join("");

    const bag = state.inventory.map((inv) => {
      const spec = WEAPONS[inv.type];
      return `<div class="bag-row">
        <span>${spec.name} <small>G${inv.group}</small></span>
        <button type="button" data-act="sell-weapon" data-uid="${inv.uid}">Sell ${formatC(Math.round(spec.price * 0.6))}</button>
      </div>`;
    }).join("");

    const repair = repairCost(parts);
    const coreDead = parts.core.destroyed;
    root.querySelector("#loadout").innerHTML = `
      <div class="panel-title">
        <h3>Loadout</h3>
        ${hangar.owned && state.selected !== viewing ? `<button type="button" data-act="activate" data-id="${viewing}">Set active</button>` : ""}
        ${hangar.owned ? "" : `<button type="button" data-act="buy-zoid" data-id="${viewing}">Buy ${formatC(def.price)}</button>`}
        ${hangar.owned ? `<button type="button" data-act="sell-zoid" data-id="${viewing}">Sell</button>` : ""}
      </div>
      <div class="paper-wrap">${diagramSVG(def.layout, parts)}</div>
      <div class="repair-row">
        <button type="button" data-act="repair" ${repair <= 0 ? "disabled" : ""}>Repair ${formatC(repair)}</button>
        ${coreDead ? `<button type="button" data-act="loan">Field loan</button>` : ""}
      </div>
      <h4>Hardpoints</h4>
      ${hardpoints}
      <h4>Armor plating</h4>
      ${armorRows}
      <h4>Mods</h4>
      ${modRows}
      <h4>Buy weapons</h4>
      ${shop}
      <h4>Inventory</h4>
      ${bag || "<p class='muted'>No loose weapons.</p>"}
    `;

    const contracts = generateContracts(state);
    root.querySelector("#contracts").innerHTML = `
      <header>
        <h3>Contracts</h3>
        <p class="${block ? "blocked" : ""}">${block ? block : `Launches with <b>${ZOIDS[activeId].name}</b>${isActive ? "" : ` (you are viewing ${def.name})`}`}</p>
        <button type="button" data-act="reroll">Reroll 5,000 C</button>
      </header>
      <div class="contract-row">
        ${contracts.map((contract, index) => {
          const spec = DIFFICULTY[contract.difficulty];
          const tip = `${contract.name} (${labelType(contract.type)}, ${BIOMES[contract.biome]})\n${contract.brief}\nClick to pick difficulty and launch with ${ZOIDS[activeId].name}.`;
          return `<button type="button" class="contract-btn" data-act="pick-contract" data-index="${index}" data-type="${contract.type}" title="${escapeAttr(tip)}" ${block ? "disabled" : ""}><span class="c-grid">
            <span class="c-name">${contract.name}</span>
            <b class="c-pay">${formatC(contract.payout)}</b>
            <span class="c-meta">${labelType(contract.type)} · ${BIOMES[contract.biome]}</span>
            <span class="c-diff" data-level="${contract.difficulty}">D${contract.difficulty} ${spec.label}</span>
          </span></button>`;
        }).join("")}
      </div>
    `;
    renderPopover(contracts, block, activeId);
    root.querySelector("#status").textContent = status;
    root.querySelector("#reset-btn").textContent = "Reset company";
    preview.show(def, weapons);
  }

  function renderPopover(contracts, block, activeId) {
    const pop = root.querySelector("#launch-pop");
    if (pending == null || !contracts[pending]) {
      pop.classList.add("hidden");
      pop.innerHTML = "";
      return;
    }
    const c = contracts[pending];
    pop.classList.remove("hidden");
    pop.innerHTML = `
      <header><h3>${c.name}</h3><button type="button" data-act="close-pop" aria-label="Close">×</button></header>
      <p class="muted">${labelType(c.type)} · ${BIOMES[c.biome]} · suggested D${c.suggested}</p>
      <p class="pop-brief" id="pop-brief">${c.brief}</p>
      <label class="diff-row">
        <span>Difficulty <b id="pop-level">${c.difficulty} · ${DIFFICULTY[c.difficulty].label}</b></span>
        <input type="range" id="difficulty-slider" min="${DIFFICULTY_MIN}" max="${DIFFICULTY_MAX}" step="1" value="${c.difficulty}">
      </label>
      <p class="pop-enemies" id="pop-enemies">${enemyLine(c)}</p>
      <div class="pop-foot">
        <b class="pop-pay" id="pop-payout">${formatC(c.payout)}</b>
        <button type="button" class="launch" id="launch-go" data-act="launch" data-index="${pending}" ${block ? "disabled" : ""}>Launch with ${ZOIDS[activeId].name}</button>
      </div>
    `;
  }

  function onInput(event) {
    if (event.target.id !== "difficulty-slider") return;
    setMissionDifficulty(state, event.target.value);
    // Refresh in place so the slider keeps focus while dragging.
    const contracts = generateContracts(state);
    const c = contracts[pending];
    if (!c) return;
    root.querySelector("#pop-level").textContent = `${c.difficulty} · ${DIFFICULTY[c.difficulty].label}`;
    root.querySelector("#pop-payout").textContent = formatC(c.payout);
    root.querySelector("#pop-enemies").innerHTML = enemyLine(c);
    root.querySelector("#pop-brief").textContent = c.brief;
    root.querySelectorAll(".contract-btn").forEach((btn, i) => {
      const k = contracts[i];
      btn.querySelector(".c-pay").textContent = formatC(k.payout);
      const d = btn.querySelector(".c-diff");
      d.textContent = `D${k.difficulty} ${DIFFICULTY[k.difficulty].label}`;
      d.dataset.level = k.difficulty;
    });
  }
  root.addEventListener("input", onInput);

  function onClick(event) {
    const target = event.target.closest("[data-act]");
    if (!target || !root.contains(target)) return;
    const act = target.dataset.act;
    const id = target.dataset.id;
    if (act === "credits") {
      const panel = root.querySelector("#credits-panel");
      panel.innerHTML = creditsMarkup();
      panel.classList.remove("hidden");
      return;
    }
    if (act === "speed-unit") {
      toggleSpeedUnit();
      render();
      return;
    }
    if (act === "install") {
      const mode = installMode();
      const pop = root.querySelector("#install-pop");
      if (mode === "prompt") { runInstallPrompt().then(syncInstallBtn); return; }
      pop.dataset.mode = mode;
      pop.innerHTML = installHelpMarkup(mode);
      pop.classList.remove("hidden");
      return;
    }
    if (act === "close-install") {
      root.querySelector("#install-pop").classList.add("hidden");
      return;
    }
    if (act === "close-credits") {
      root.querySelector("#credits-panel").classList.add("hidden");
      return;
    }
    if (act === "pick-contract") {
      pending = Number(target.dataset.index);
      render();
      return;
    }
    if (act === "close-pop") {
      pending = null;
      render();
      return;
    }
    if (act === "toggle-details") {
      detailsOpen = !detailsOpen;
      render();
      return;
    }
    if (act === "view") {
      viewing = id;
      picker = null;
      status = "";
      render();
      return;
    }
    if (act === "activate") flash(setActive(state, id));
    else if (act === "buy-zoid") {
      const result = buyZoid(state, id);
      flash(result);
      if (result.ok) viewing = id;
    } else if (act === "sell-zoid") {
      const result = sellZoid(state, id);
      flash(result);
      if (result.ok) viewing = state.selected;
    } else if (act === "toggle-picker") {
      picker = picker === target.dataset.mount ? null : target.dataset.mount;
      render();
      return;
    } else if (act === "equip") {
      flash(equip(state, viewing, target.dataset.mount, target.dataset.uid || null));
      picker = null;
    } else if (act === "group") flash(cycleGroup(state, target.dataset.uid));
    else if (act === "armor") flash(changeArmor(state, viewing, target.dataset.part, Number(target.dataset.dir)));
    else if (act === "mod") flash(changeMod(state, viewing, target.dataset.key, Number(target.dataset.dir)));
    else if (act === "buy-weapon") flash(buyWeapon(state, target.dataset.type));
    else if (act === "sell-weapon") flash(sellWeapon(state, target.dataset.uid));
    else if (act === "repair") flash(repairZoid(state, viewing));
    else if (act === "loan") flash(repairZoid(state, viewing, { allowDebt: true }));
    else if (act === "reroll") {
      pending = null;
      flash(rerollSeed(state));
    }
    else if (act === "reset") {
      const ok = window.confirm(
        "Reset the company? This wipes money, Zoids, weapons, and contract progress saved in this browser.",
      );
      if (!ok) return;
      const next = resetState();
      hooks.onReset(next);
      return;
    } else if (act === "launch") {
      const reason = launchBlockReason(state);
      if (reason) {
        status = reason;
        render();
        return;
      }
      const contract = generateContracts(state)[Number(target.dataset.index)];
      hooks.onLaunch(contract);
      return;
    }
    render();
  }
  root.addEventListener("click", onClick);
  function onChange(event) {
    if (event.target.id !== "zoid-select") return;
    viewing = event.target.value;
    picker = null;
    status = "";
    render();
  }
  root.addEventListener("change", onChange);

  render();
  window.__ZOIDS__ = window.__ZOIDS__ || {};
  window.__ZOIDS__.screen = "hangar";
  window.__ZOIDS__.ready = true;
  window.__ZOIDS__.previewParts = () => preview.parts();
  window.__ZOIDS__.previewView = () => preview.viewState();
  window.__ZOIDS__.installMode = installMode;

  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    offInstall();
    root.removeEventListener("click", onClick);
    root.removeEventListener("change", onChange);
    root.removeEventListener("input", onInput);
    preview.dispose();
  };
}

function enemyLine(c) {
  const spec = DIFFICULTY[c.difficulty];
  const names = c.enemies.map((e) => ZOIDS[e.zoidId].name).join(", ");
  return `${c.enemies.length} hostile${c.enemies.length === 1 ? "" : "s"}: ${names}<br><small>AI aim ±${spec.aimError} m/100 m · fire rate ×${spec.fireRate} · plating +${spec.armorLevel}${c.type === "defend" ? ` · truck armour ×${spec.truckArmor}` : ""}</small>`;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Banded tonnage bar: 0..130% of rated tonnage, one band per weight zone.
function tonnageBar(weight, def, load, speedKph, turnDeg) {
  const scale = TONNAGE_CEILING * 100;
  const bands = TONNAGE_ZONES.map((z) => `<i class="band" data-zone="${z.id}" style="left:${(z.min * 100 / scale) * 100}%;width:${((z.max - z.min) * 100 / scale) * 100}%;background:${z.color}" title="${z.label} ${Math.round(z.min * 100)}–${Math.round(z.max * 100)}%"></i>`).join("");
  const pct = load.ratio * 100;
  const fill = Math.min(100, (pct / scale) * 100);
  const mul = (v) => `×${v.toFixed(2)}`;
  return `<div class="tonnage" data-zone="${load.zone}" id="tonnage">
    <div class="tonnage-head">
      <label>Tonnage ${weight.toFixed(1)} / ${def.maxTonnage} t · ${Math.round(pct)}%</label>
      <b class="zone-label" style="color:${load.color}">${load.label}</b>
      <span class="eff" id="tonnage-effect">speed ${speedKph} ${unitLabel()} ${mul(load.speedMul)} · turn ${turnDeg}°/s ${mul(load.turnMul)} · accel ${mul(load.accelMul)} · cooling ${mul(load.coolMul)}</span>
    </div>
    <div class="zone-bar">${bands}<i class="rated" style="left:${(100 / scale) * 100}%" title="Rated tonnage"></i><i class="fill" style="width:${fill}%"></i><i class="pointer" style="left:${fill}%"></i></div>
  </div>`;
}

function labelType(type) {
  if (type === "destroy") return "Destroy";
  if (type === "defend") return "Escort";
  if (type === "recon") return "Recon";
  return "Assault";
}

function createPreview(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new Scene();
  scene.background = new Color(0x101820);
  const camera = new PerspectiveCamera(32, 1, 0.1, 200);
  scene.add(new HemisphereLight(0xd7e6f2, 0x1c140e, 0.85));
  const key = new DirectionalLight(0xfff4e0, 1.6);
  key.position.set(-4, 8, 6);
  scene.add(key);
  const rim = new DirectionalLight(0x6ec8ff, 0.6);
  rim.position.set(6, 3, -4);
  scene.add(rim);
  const floor = new Mesh(
    new CircleGeometry(18, 40),
    new MeshStandardMaterial({ color: 0x1a222c, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  let model = null;
  const SPIN0 = Math.PI - 0.55;
  const LIFT0 = 0.32;
  let spin = SPIN0;
  let running = true;

  // Showcase controls (custom; three's OrbitControls isn't vendored).
  // Drag = rotate (yaw) and tilt (camera lift), wheel / pinch = zoom within
  // limits scaled by the Zoid's size, double-click / double-tap / reset button
  // = default view. Auto-spin pauses while interacting, resumes after 3 s.
  const ZOOM_MIN = 0.55;
  const ZOOM_MAX = 1.8;
  const LIFT_MIN = -0.05;
  const LIFT_MAX = 1.1;
  const RESUME_MS = 3000;
  const view = { yaw: 0, zoom: 1, lift: LIFT0, lastInput: -Infinity, dragging: false };
  const pointers = new Map();
  let pinchDist = 0;
  let lastTap = 0;
  let tapX = 0;
  let tapY = 0;
  let justReset = false;
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const touch = () => { view.lastInput = performance.now(); };
  function resetView() {
    spin = SPIN0;
    view.yaw = 0;
    view.zoom = 1;
    view.lift = LIFT0;
    view.lastInput = -Infinity;
  }
  function zoomBy(factor) {
    view.zoom = clampN(view.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    touch();
  }
  function onDown(e) {
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.dragging = true;
    touch();
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    if (pointers.size === 1) {
      // Double-tap / double-click (own detection so touch and mouse match).
      const now = performance.now();
      if (now - lastTap < 320 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 24) {
        resetView();
        justReset = true;
        lastTap = 0;
      } else {
        lastTap = now;
      }
      tapX = e.clientX;
      tapY = e.clientY;
    }
  }
  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();
    if (justReset) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d);
      pinchDist = d;
      return;
    }
    view.yaw -= (cur.x - prev.x) * 0.01;
    view.lift = clampN(view.lift + (cur.y - prev.y) * 0.004, LIFT_MIN, LIFT_MAX);
    touch();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    view.dragging = pointers.size > 0;
    if (justReset) { justReset = false; return; }
    touch();
  }
  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    zoomBy(Math.exp(clampN(e.deltaY, -200, 200) * 0.0015));
  }
  function onDbl(e) { e.preventDefault(); resetView(); }
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  const resetBtn = canvas.parentElement && canvas.parentElement.querySelector("#view-reset");
  const onResetBtn = (e) => { e.stopPropagation(); resetView(); };
  if (resetBtn) resetBtn.addEventListener("click", onResetBtn);

  function resize() {
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function show(def, weapons) {
    if (model) {
      scene.remove(model.root);
      disposeTree(model.root);
    }
    try {
      model = buildUnitModel(def, weapons, "player");
    } catch (err) {
      console.error(err);
      model = null;
      return;
    }
    scene.add(model.root);
  }

  let last = performance.now();
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const idle = !view.dragging && now - view.lastInput > RESUME_MS;
    if (idle) spin += dt * 0.35;
    if (model) {
      // The face is local -Z. Object3D.getWorldDirection is the tail (+Z).
      // Sitting on -tail keeps the nose pointed at the camera while the model spins.
      model.root.rotation.y = spin;
      model.animate(now / 1000, 0.75, null);
      model.root.updateMatrixWorld(true);
      const fwd = new Vector3();
      model.root.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      // User orbit: swing the camera around the Zoid by view.yaw.
      fwd.applyAxisAngle(UP, view.yaw);
      const right = new Vector3().crossVectors(fwd, UP);
      // Pulled in ~20% now the stage has the whole centre column to itself.
      // Big frames (Elephander) also back the camera off by their real size.
      if (!model.frameSize) {
        const size = new Box3().setFromObject(model.visual).getSize(new Vector3());
        model.frameSize = Math.max(size.x, size.y, size.z);
      }
      // Zoom limits follow the Zoid's size because dist does.
      const dist = Math.max((8 + (model.def.scale || 1) * 4.2) * 0.8, model.frameSize * 1.75) * view.zoom;
      view.dist = dist;
      camera.position.copy(model.root.position)
        .addScaledVector(fwd, -dist)
        .addScaledVector(right, dist * 0.38)
        .add(new Vector3(0, dist * view.lift, 0));
      camera.lookAt(0, 1.6 * (model.def.scale || 1), 0);
    }
    resize();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    show,
    viewState() {
      return { spin, yaw: view.yaw, zoom: view.zoom, lift: view.lift, dist: view.dist || 0, dragging: view.dragging,
        autoSpin: !view.dragging && performance.now() - view.lastInput > RESUME_MS, zoomMin: ZOOM_MIN, zoomMax: ZOOM_MAX };
    },
    resetView,
    parts() {
      if (!model) return null;
      const counts = {};
      let glb = false;
      for (const [id, meshes] of Object.entries(model.partMeshes)) {
        counts[id] = meshes.length;
        if (meshes.some((mesh) => mesh.userData && mesh.userData.glbPart)) glb = true;
      }
      return { id: model.def.id, counts, glb, real: glb, anim: model.anim.kind };
    },
    dispose() {
      running = false;
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
      if (resetBtn) resetBtn.removeEventListener("click", onResetBtn);
      if (model) disposeTree(model.root);
      disposeTree(floor);
      renderer.dispose();
    },
  };
}

export function showDebrief(state, result, onDone) {
  const host = document.getElementById("debrief-root");
  host.classList.remove("hidden");
  const gross = (result.payout || 0) + (result.salvage || 0);
  const after = state.money + gross;
  const title = result.aborted ? "ABORTED" : result.victory ? "CONTRACT COMPLETE" : "CONTRACT FAILED";
  host.innerHTML = `
    <div class="debrief">
      <p class="eyebrow">${result.contract.name} · ${BIOMES[result.contract.biome]}</p>
      <h2 class="${result.victory ? "good" : "bad"}">${title}</h2>
      <ul class="ledger">
        <li>Time ${Math.round(result.time)}s</li>
        <li>Hostile Zoids destroyed ${result.kills}</li>
        <li>Payout ${formatC(result.payout || 0)}</li>
        <li>Salvage ${formatC(result.salvage || 0)}</li>
        <li>Balance after payout ${formatC(after)}</li>
        <li>Repair bill ${formatC(result.repair || 0)}</li>
      </ul>
      <div class="paper-wrap debrief-paper">${diagramSVG(result.layout, result.parts)}</div>
      <div class="debrief-actions">
        <button type="button" id="repair-return" ${(result.repair || 0) > after && !result.coreDestroyed ? "disabled" : ""}>Repair and return</button>
        ${result.coreDestroyed && result.repair > after ? `<button type="button" id="loan-return">Field loan repair</button>` : ""}
        <button type="button" id="skip-return">Return damaged</button>
      </div>
    </div>
  `;
  function done(mode) {
    applyMissionResult(state, result);
    if (mode === "repair") repairZoid(state, result.zoidId);
    if (mode === "loan") repairZoid(state, result.zoidId, { allowDebt: true });
    host.classList.add("hidden");
    host.innerHTML = "";
    onDone();
  }
  host.querySelector("#repair-return").addEventListener("click", () => done("repair"));
  const loan = host.querySelector("#loan-return");
  if (loan) loan.addEventListener("click", () => done("loan"));
  host.querySelector("#skip-return").addEventListener("click", () => done("skip"));
}
