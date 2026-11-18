// Render quality picked once per mission from the GPU and screen.
// MSAA is cheap on real GPUs but about doubles the frame on software GL
// (SwiftShader / llvmpipe, measured ~35 ms of a ~100 ms frame at 1280x720
// in the battlefield city), and costs a lot of fill on high-DPI phones.
// Overrides: ?aa=1 / ?aa=0 in the URL.

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export function pickRenderQuality({ gpu = "", coarse = false, dpr = 1, shortSide = 1080, override = null } = {}) {
  const software = SOFTWARE_GL.test(gpu);
  const phone = coarse && shortSide < 900;
  let antialias = !software && !(phone && dpr >= 2.5);
  if (override === "1") antialias = true;
  if (override === "0") antialias = false;
  const pixelRatio = Math.min(dpr || 1, phone ? 2 : 1.5);
  return { antialias, pixelRatio, software, phone };
}

// Browser probe (unmasked renderer string when the browser exposes it).
export function probeRenderQuality() {
  let gpu = "";
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  } catch (e) {
    gpu = "";
  }
  let override = null;
  try {
    override = new URLSearchParams(location.search).get("aa");
  } catch (e) {
    override = null;
  }
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(screen.width || 1080, screen.height || 1080);
  return { gpu, ...pickRenderQuality({ gpu, coarse, dpr: window.devicePixelRatio || 1, shortSide, override }) };
}
