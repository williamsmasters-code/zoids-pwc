import { loadState } from "./state.js";
import { initInstall } from "./install.js";

initInstall();
import { showHangar, showDebrief } from "./hangar.js";
import { startMission } from "./mission.js";
import { unlockAudio } from "./audio.js";
import { preloadModels, showLoading, hideLoading } from "./models.js";

let state = loadState();
let closeHangar = null;

function showBootError(err) {
  const pre = document.createElement("pre");
  pre.id = "boot-error";
  pre.textContent = err && err.stack ? err.stack : String(err);
  document.body.appendChild(pre);
}

function closeCurrentHangar() {
  if (!closeHangar) return;
  const close = closeHangar;
  closeHangar = null;
  close();
}

function toHangar() {
  closeCurrentHangar();
  const debrief = document.getElementById("debrief-root");
  if (debrief) {
    debrief.classList.add("hidden");
    debrief.innerHTML = "";
  }
  const mission = document.getElementById("mission-root");
  if (mission) mission.classList.add("hidden");
  closeHangar = showHangar(state, {
    onLaunch(contract) {
      unlockAudio();
      closeCurrentHangar();
      showLoading("Dropping into the field…");
      requestAnimationFrame(() => {
        startMission(state, contract, {
          onExit(result) {
            showDebrief(state, result, () => toHangar());
          },
        });
        requestAnimationFrame(() => hideLoading());
      });
    },
    onReset(next) {
      state = next;
      toHangar();
    },
  });
}

window.addEventListener("error", (event) => {
  if (document.getElementById("boot-error")) return;
  showBootError(event.error || event.message);
});

showLoading("Preparing the hangar…");
preloadModels((frac, slug) => {
  const pct = Math.round(frac * 100);
  showLoading(slug ? `Loading ${slug} ${pct}%` : "Preparing the hangar…");
}).then(() => {
  hideLoading();
  toHangar();
}).catch((err) => {
  console.error(err);
  hideLoading();
  showBootError(err);
  toHangar();
});
