// Tiny synthesized cues. No audio files.

let ctx = null;

function ac() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

export function unlockAudio() {
  ac();
}

function tone(freq, dur, type, gain, slide) {
  const c = ac();
  if (!c) return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  if (slide) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), c.currentTime + dur);
  }
  amp.gain.value = gain;
  amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(amp);
  amp.connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

export function sfx(name) {
  try {
    if (name === "laser") tone(920, 0.06, "square", 0.03, -500);
    else if (name === "beam") tone(320, 0.12, "sawtooth", 0.04, -80);
    else if (name === "gatling") tone(180, 0.03, "square", 0.02, -40);
    else if (name === "missile") tone(140, 0.16, "sawtooth", 0.04, 60);
    else if (name === "shock") tone(90, 0.18, "square", 0.05, -30);
    else if (name === "cpc") tone(70, 0.35, "sawtooth", 0.06, -40);
    else if (name === "hit") tone(240, 0.05, "square", 0.03, -100);
    else if (name === "hurt") tone(120, 0.1, "sawtooth", 0.04, -60);
    else if (name === "alarm") tone(640, 0.14, "square", 0.04, 0);
    else if (name === "ui") tone(520, 0.05, "square", 0.02, 80);
    else if (name === "boom") tone(60, 0.4, "sawtooth", 0.07, -30);
  } catch {
    // Audio is optional.
  }
}
