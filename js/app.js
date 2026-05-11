import { FluidSimulation } from './fluid.js';
import { MidiInput } from './midi.js';
import { noteCenterX, noteWidth, drawKeyboard, noteAtPoint } from './piano.js';
import { Highway } from './highway.js';
import { Settings, bindSettingsUI } from './settings.js';

// ── Canvas setup ──────────────────────────────────────────────────────────

const fluidCanvas  = document.getElementById('fluid-canvas');
const highwayCanvas = document.getElementById('highway-canvas');
const pianoCanvas  = document.getElementById('piano-canvas');
const noteReadout = document.getElementById('note-readout');
const hCtx  = highwayCanvas.getContext('2d');
const pCtx  = pianoCanvas.getContext('2d');

const settings = new Settings();
const highway  = new Highway();
const midi     = new MidiInput();

let fluid = null;
let lastTime = performance.now();
let simAccumulator = 0;
const SIM_FIXED_DT  = 1 / 60; // physics step size — never changes, preserves eddy character
const SIM_MAX_STEPS = 8;       // safety cap per real frame
const MAX_DYE_TIGHTNESS_REDUCTION = 0.75;
const MIN_DYE_RADIUS = 0.002;
let noteColorMap = {}; // note -> hex color (for per-note colors in future)
const pointerToNote = new Map();
const noteTouchCount = new Map();
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let readoutNote = null;

// ── Resize ────────────────────────────────────────────────────────────────

function resize () {
  const dpr = window.devicePixelRatio || 1;
  const vv  = window.visualViewport;
  const W   = window.innerWidth;
  // Use the visual viewport on mobile so the canvas matches the *visible*
  // area, not the layout viewport (which includes the address-bar region).
  // Mismatching this with CSS `100%` on #ui shifts the piano relative to
  // the fluid by the address-bar height.
  const H   = vv ? vv.height : window.innerHeight;
  const kh = settings.get('keyboardHeight');

  for (const c of [fluidCanvas, highwayCanvas]) {
    c.width  = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
  }

  pianoCanvas.width  = Math.floor(W * dpr);
  pianoCanvas.height = Math.floor(kh * dpr);
  pianoCanvas.style.width  = W + 'px';
  pianoCanvas.style.height = kh + 'px';

  if (fluid) fluid.resize();
}

window.addEventListener('resize', resize);
// iOS address bar show/hide doesn't fire 'resize' — use visualViewport.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
}

// ── Fluid init ────────────────────────────────────────────────────────────

function initFluid () {
  try {
    fluid = new FluidSimulation(fluidCanvas, {
      SIM_RESOLUTION: 128,
      DYE_RESOLUTION: 512,
      DENSITY_DISSIPATION: settings.get('densityDissipation'),
      VELOCITY_DISSIPATION: settings.get('velocityDissipation'),
      PRESSURE: 0.8,
      PRESSURE_ITERATIONS: 20,
      CURL: settings.get('curl'),
      BLOOM: settings.get('fluidBloom'),
      BLOOM_INTENSITY: settings.get('fluidBloomIntensity'),
      SUNRAYS: settings.get('fluidSunrays'),
      SUNRAYS_WEIGHT: settings.get('fluidSunraysWeight'),
    });
  } catch (e) {
    console.warn('WebGL fluid init failed:', e);
    fluid = null;
  }
}

// ── MIDI ───────────────────────────────────────────────────────────────────

const statusDot = document.getElementById('midi-status');

midi.onConnect(() => {
  statusDot.className = 'status-dot connected';
  const list = document.getElementById('midi-inputs-list');
  if (list) {
    list.innerHTML = midi.inputs
      .map(i => `<div>${i.name}</div>`)
      .join('') || 'No MIDI devices found';
  }
});

function handleNoteOn (note, velocity) {
  if (settings.get('monophonic')) {
    for (const t of highway.activeTrails()) {
      if (t.note !== note) handleNoteOff(t.note);
    }
  }
  const W = fluidCanvas.width;
  const color = settings.get('noteColor');
  const nw = noteWidth(note, W) * (settings.get('noteWidth') / 12);
  const cx = noteCenterX(note, W) - nw / 2;
  noteColorMap[note] = color;
  highway.noteOn(note, velocity, cx, nw, color);
  setNoteReadout(note);
}

function handleNoteOff (note) {
  highway.noteOff(note);
  delete noteColorMap[note];
  if (readoutNote === note) showFirstActiveNote();
}

midi.onNoteOn(handleNoteOn);
midi.onNoteOff(handleNoteOff);

document.getElementById('midi-btn').addEventListener('click', async () => {
  const ok = await midi.requestAccess();
  if (!ok) alert('Web MIDI not available — use keyboard (A-L keys)');
});

// ── On-screen keyboard pointer input ────────────────────────────────────────

function getPointerNote (e) {
  if (!settings.get('showKeyboard')) return null;
  const rect = pianoCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = (e.clientX - rect.left) * (pianoCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (pianoCanvas.height / rect.height);
  return noteAtPoint(x, y, pianoCanvas.width, pianoCanvas.height);
}

function noteLabel (note) {
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${octave} · MIDI ${note}`;
}

function setNoteReadout (note) {
  if (!noteReadout) return;
  readoutNote = note;
  if (note === null) {
    noteReadout.textContent = '';
    noteReadout.classList.remove('visible');
    return;
  }
  noteReadout.textContent = noteLabel(note);
  noteReadout.classList.add('visible');
}

function showFirstActiveNote () {
  for (const trail of highway.activeTrails()) {
    setNoteReadout(trail.note);
    return;
  }
  setNoteReadout(null);
}

function releasePointerNote (pointerId) {
  const oldNote = pointerToNote.get(pointerId);
  if (oldNote == null) return;
  pointerToNote.delete(pointerId);
  const currentCount = noteTouchCount.get(oldNote);
  if (currentCount == null) return;
  const count = currentCount - 1;
  if (count <= 0) {
    noteTouchCount.delete(oldNote);
    handleNoteOff(oldNote);
  } else {
    noteTouchCount.set(oldNote, count);
  }
}

function setPointerNote (pointerId, note) {
  const oldNote = pointerToNote.get(pointerId);
  if (oldNote === note) return;
  releasePointerNote(pointerId);
  if (note == null) return;
  pointerToNote.set(pointerId, note);
  const count = noteTouchCount.get(note) ?? 0;
  if (count === 0) handleNoteOn(note, 100);
  noteTouchCount.set(note, count + 1);
}

function releaseAllPointerNotes () {
  for (const pointerId of [...pointerToNote.keys()]) {
    releasePointerNote(pointerId);
  }
}

pianoCanvas.addEventListener('pointerdown', e => {
  const note = getPointerNote(e);
  if (note == null) return;
  if (pianoCanvas.setPointerCapture) {
    try {
      pianoCanvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // Some mobile browsers throw here; note handling still works without capture.
    }
  }
  setPointerNote(e.pointerId, note);
  e.preventDefault();
});

pianoCanvas.addEventListener('pointermove', e => {
  if (!pointerToNote.has(e.pointerId)) return;
  setPointerNote(e.pointerId, getPointerNote(e));
  e.preventDefault();
});

pianoCanvas.addEventListener('pointerup', e => {
  releasePointerNote(e.pointerId);
  e.preventDefault();
});

pianoCanvas.addEventListener('pointercancel', e => {
  releasePointerNote(e.pointerId);
  e.preventDefault();
});

if (!window.PointerEvent) {
  pianoCanvas.addEventListener('touchstart', e => {
    for (const touch of e.changedTouches) {
      const touchId = `touch-${touch.identifier}`;
      const note = getPointerNote(touch);
      if (note != null) setPointerNote(touchId, note);
    }
    e.preventDefault();
  }, { passive: false });

  pianoCanvas.addEventListener('touchmove', e => {
    for (const touch of e.changedTouches) {
      const touchId = `touch-${touch.identifier}`;
      if (!pointerToNote.has(touchId)) continue;
      setPointerNote(touchId, getPointerNote(touch));
    }
    e.preventDefault();
  }, { passive: false });

  pianoCanvas.addEventListener('touchend', e => {
    for (const touch of e.changedTouches) {
      releasePointerNote(`touch-${touch.identifier}`);
    }
    e.preventDefault();
  }, { passive: false });

  pianoCanvas.addEventListener('touchcancel', e => {
    for (const touch of e.changedTouches) {
      releasePointerNote(`touch-${touch.identifier}`);
    }
    e.preventDefault();
  }, { passive: false });
}

window.addEventListener('blur', releaseAllPointerNotes);

// ── Settings UI ───────────────────────────────────────────────────────────

const settingsPanel = document.getElementById('settings-panel');
document.getElementById('settings-btn').addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});
document.getElementById('settings-close').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

bindSettingsUI(settings, (key, val) => {
  if (key === 'keyboardHeight') { resize(); return; }
  if (key === 'showKeyboard' && !val) releaseAllPointerNotes();
  if (key === 'densityDissipation' && fluid) fluid.updateConfig({ DENSITY_DISSIPATION: val });
  if (key === 'velocityDissipation' && fluid) fluid.updateConfig({ VELOCITY_DISSIPATION: val });
  if (key === 'curl' && fluid) fluid.updateConfig({ CURL: val });
  if (key === 'fluidBloom' && fluid) fluid.updateConfig({ BLOOM: val });
  if (key === 'fluidBloomIntensity' && fluid) fluid.updateConfig({ BLOOM_INTENSITY: val });
  if (key === 'fluidSunrays' && fluid) fluid.updateConfig({ SUNRAYS: val });
  if (key === 'fluidSunraysWeight' && fluid) fluid.updateConfig({ SUNRAYS_WEIGHT: val });
});

// ── Main loop ─────────────────────────────────────────────────────────────

function frame (now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const W   = fluidCanvas.width;
  const H   = fluidCanvas.height;
  const kh  = settings.get('keyboardHeight') * (window.devicePixelRatio || 1);
  const speed     = settings.get('speed') * (window.devicePixelRatio || 1);
  const fluidOn   = settings.get('fluidEnabled');
  const intensity = settings.get('fluidIntensity') / 100;

  // — Fluid splats + fixed-timestep sim —
  if (fluid && fluidOn) {
    const fluidRadius = settings.get('fluidRadius');
    const tightness = settings.get('fluidTightness') / 100;
    // Tightness only constrains dye spread; velocity radius stays unchanged to
    // preserve the original vortex/flow dynamics.
    const dyeRadiusScale = 1 - tightness * MAX_DYE_TIGHTNESS_REDUCTION;
    const fluidColorMode = settings.get('fluidColorMode');
    const fluidSource = settings.get('fluidSource');
    // Upward velocity recreates the rising-stream visual from before flow-speed
    // was added. At this scale the steady-state reaches the vorticity clamp
    // (~1000), matching the original dynamics. velX stays 0 to avoid lateral drift.
    const velY = -intensity * 0.002;

    // Flow speed multiplier advances the accumulator; physics always uses
    // SIM_FIXED_DT so eddy character is identical at any speed setting.
    simAccumulator += dt * (settings.get('fluidSpeed') / 10);

    let steps = 0;
    while (simAccumulator >= SIM_FIXED_DT && steps < SIM_MAX_STEPS) {
      for (const t of highway.activeTrails()) {
        const normX  = (t.x + t.width / 2) / W;
        const velocityRadius = Math.max(0.005, (t.width / W) * fluidRadius);
        // Dye can go smaller than velocity splats so the visual stays attached
        // to the played note without changing fluid momentum injection.
        const dyeRadius = Math.max(MIN_DYE_RADIUS, velocityRadius * dyeRadiusScale);
        const [r, g, b] = getFluidColorForNote(t.note, fluidColorMode);
        const dr = r * intensity * SIM_FIXED_DT;
        const dg = g * intensity * SIM_FIXED_DT;
        const db = b * intensity * SIM_FIXED_DT;
        if (fluidSource === 'head' || fluidSource === 'both') {
          fluid.addSplat(normX, ((H - kh) - t.topY) / H, 0, velY, dr, dg, db, velocityRadius, dyeRadius);
        }
        if (fluidSource === 'base' || fluidSource === 'both') {
          fluid.addSplat(normX, (H - kh) / H, 0, velY, dr, dg, db, velocityRadius, dyeRadius);
        }
      }
      fluid.step(SIM_FIXED_DT);
      simAccumulator -= SIM_FIXED_DT;
      steps++;
    }

    fluid.render();
  } else if (fluid) {
    // Still step to dissipate if disabled, but clear canvas
    const gl = fluid.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // — Highway update + draw —
  highway.update(dt, speed, H, kh);

  hCtx.clearRect(0, 0, W, H);
  highway.draw(hCtx, H, kh);

  // — Piano keyboard —
  if (settings.get('showKeyboard')) {
    const dpr = window.devicePixelRatio || 1;
    const kpx = settings.get('keyboardHeight') * dpr;
    pCtx.clearRect(0, 0, pianoCanvas.width, pianoCanvas.height);
    const activeSet = new Set([...highway.activeTrails()].map(t => t.note));
    drawKeyboard(pCtx, activeSet, kpx, noteColorMap);
  } else {
    pCtx.clearRect(0, 0, pianoCanvas.width, pianoCanvas.height);
  }
}

function hexToRgb (hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 0xff) / 255, (n >> 8 & 0xff) / 255, (n & 0xff) / 255];
}

function getFluidColorForNote (note, mode) {
  if (mode === 'perNote') return noteToRgb(note);
  return hexToRgb(settings.get('fluidColor'));
}

function noteToRgb (note) {
  const hue = ((note % 12) / 12) * 360;
  return hslToRgb(hue / 360, 0.95, 0.62);
}

function hslToRgb (h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToChannel(p, q, h + 1 / 3),
    hueToChannel(p, q, h),
    hueToChannel(p, q, h - 1 / 3),
  ];
}

function hueToChannel (p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// ── Boot ────────────────────────────────────────────────────────────────────

resize();
initFluid();
requestAnimationFrame(frame);

// Auto-request MIDI on load (fails silently if denied/unavailable)
midi.requestAccess().catch(() => {});
