// Keyboard and mouse. Pointer-lock deltas drive look. Keys and mouse buttons
// drive the chassis and the selected weapon (js/mission.js weapon slots):
//   left mouse  fire the selected weapon
//   right mouse scope zoom when a sniper weapon is selected, else fire too
//   mouse wheel switch weapon (down = next, up = previous, wraps around)
//   1-9         select that weapon slot directly
// The right-click context menu is cancelled on the document and the canvas,
// and the wheel is taken (no page scroll) while the mission input is mounted.

export function createInput() {
  const down = new Set();
  const edges = new Set();
  let dx = 0;
  let dy = 0;
  let lmb = false;
  let rmb = false;
  let mounted = false;
  let wheel = 0;
  let wheelAcc = 0;
  let target = null;

  function onKeyDown(e) {
    if (e.repeat) return;
    down.add(e.code);
    edges.add(e.code);
    if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  }
  function onKeyUp(e) {
    down.delete(e.code);
  }
  function onMouseDown(e) {
    // Button 2 must be taken even if pointer lock drops as the menu opens.
    if (e.button === 2 && e.preventDefault) e.preventDefault();
    if (e.button === 0) lmb = true;
    if (e.button === 2) rmb = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) lmb = false;
    if (e.button === 2) rmb = false;
  }
  function onMove(e) {
    if (document.pointerLockElement == null) return;
    dx += e.movementX || 0;
    dy += e.movementY || 0;
  }
  // One notch (about 100 px of deltaY, or one line) is one weapon step.
  function onWheel(e) {
    if (e.preventDefault) e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1;
    wheelAcc += (e.deltaY || 0) * unit;
    while (wheelAcc >= 50) { wheel += 1; wheelAcc -= 100; }
    while (wheelAcc <= -50) { wheel -= 1; wheelAcc += 100; }
    if (Math.abs(wheelAcc) < 50) wheelAcc = 0;
  }
  function onContext(e) {
    if (e.preventDefault) e.preventDefault();
  }

  return {
    mount(canvas) {
      if (mounted) return;
      mounted = true;
      target = canvas || null;
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mouseup", onMouseUp, true);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("wheel", onWheel, { passive: false });
      document.addEventListener("contextmenu", onContext, true);
      window.addEventListener("contextmenu", onContext, true);
      if (target) target.addEventListener("contextmenu", onContext, true);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("contextmenu", onContext, true);
      if (target) target.removeEventListener("contextmenu", onContext, true);
      target = null;
      down.clear();
      edges.clear();
      lmb = false;
      rmb = false;
      dx = 0;
      dy = 0;
      wheel = 0;
      wheelAcc = 0;
    },
    read() {
      let select = null;
      for (let i = 1; i <= 9; i++) if (edges.has(`Digit${i}`)) select = i;
      const snap = {
        forward: ((down.has("KeyW") || down.has("ArrowUp")) ? 1 : 0)
          - ((down.has("KeyS") || down.has("ArrowDown")) ? 1 : 0),
        strafe: (down.has("KeyD") ? 1 : 0) - (down.has("KeyA") ? 1 : 0),
        turn: (down.has("ArrowRight") ? 1 : 0) - (down.has("ArrowLeft") ? 1 : 0),
        boost: down.has("ShiftLeft") || down.has("ShiftRight"),
        // Flyers only: Space climbs, C descends.
        climb: (down.has("Space") ? 1 : 0) - (down.has("KeyC") ? 1 : 0),
        // Legacy group triggers (scripted input and the test autopilot only).
        groups: [false, false, false, false],
        fire: lmb,
        alt: rmb,
        wheel,
        select,
        dx,
        dy,
        tab: edges.has("Tab"),
        nearest: edges.has("KeyR"),
        camera: edges.has("KeyV"),
        help: edges.has("KeyH"),
        skill: edges.has("KeyQ"),
      };
      dx = 0;
      dy = 0;
      wheel = 0;
      edges.clear();
      return snap;
    },
  };
}
