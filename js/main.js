import { loadState } from "./state.js";
import { showHangar, showDebrief } from "./hangar.js";
import { startMission } from "./mission.js";
import { unlockAudio } from "./audio.js";

let state = loadState();
let closeHangar = null;

function showBootError(err) {
  const pre = document.createElement("pre");
  pre.id = "boot-error";
  pre.textContent = err && err.stack ? err.stack : String(err);
  document.body.appendChild(pre);
}

function toHangar() {
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
      if (closeHangar) closeHangar();
      closeHangar = null;
      startMission(state, contract, {
        onExit(result) {
          showDebrief(state, result, () => toHangar());
        },
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

try {
  toHangar();
} catch (err) {
  console.error(err);
  showBootError(err);
}
