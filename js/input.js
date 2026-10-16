// Keyboard and mouse. Pointer-lock deltas drive look. Keys drive the chassis.

export function createInput() {
  const down = new Set();
  const edges = new Set();
  let dx = 0;
  let dy = 0;
  let lmb = false;
  let rmb = false;
  let mounted = false;

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
    if (document.pointerLockElement == null) return;
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
  function onContext(e) {
    e.preventDefault();
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("contextmenu", onContext);
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("contextmenu", onContext);
      down.clear();
      edges.clear();
      lmb = false;
      rmb = false;
      dx = 0;
      dy = 0;
    },
    read() {
      const snap = {
        forward: ((down.has("KeyW") || down.has("ArrowUp")) ? 1 : 0)
          - ((down.has("KeyS") || down.has("ArrowDown")) ? 1 : 0),
        strafe: (down.has("KeyD") ? 1 : 0) - (down.has("KeyA") ? 1 : 0),
        turn: (down.has("ArrowRight") ? 1 : 0) - (down.has("ArrowLeft") ? 1 : 0),
        boost: down.has("ShiftLeft") || down.has("ShiftRight"),
        groups: [
          down.has("Digit1") || lmb,
          down.has("Digit2") || rmb,
          down.has("Digit3"),
          down.has("Digit4"),
        ],
        dx,
        dy,
        tab: edges.has("Tab"),
        nearest: edges.has("KeyR"),
        camera: edges.has("KeyV"),
        help: edges.has("KeyH"),
      };
      dx = 0;
      dy = 0;
      edges.clear();
      return snap;
    },
  };
}
