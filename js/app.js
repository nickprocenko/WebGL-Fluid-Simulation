import { FluidSimulation } from './fluid.js';
import { MidiInput } from './midi.js';
import { noteCenterX, noteWidth, drawKeyboard, noteAtPoint } from './piano.js';
import { Highway } from './highway.js';
import { Settings, bindSettingsUI } from './settings.js';

// ── Canvas setup ──────────────────────────────────────────────────────────

const fluidCanvas  = document.getElementById('fluid-canvas');
const highwayCanvas = document.getElementById('highway-canvas');
const pianoCanvas  = document.getElementById('piano-canvas');
const hCtx  = highwayCanvas.getContext('2d');
const pCtx  = pianoCanvas.getContext('2d');

const settings = new Settings();
const highway  = new Highway();
const midi     = new MidiInput();

let fluid = null;
let lastTime = performance.now();
let noteColorMap = {}; // note -> hex color (for per-note colors in future)
const pointerToNote = new Map();
const noteTouchCount = new Map();

// ── Resize ────────────────────────────────────────────────────────────────

function resize () {
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
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
  const W = fluidCanvas.width;
  const color = settings.get('noteColor');
  const nw = noteWidth(note, W) * (settings.get('noteWidth') / 12);
  const cx = noteCenterX(note, W) - nw / 2;
  noteColorMap[note] = color;
  highway.noteOn(note, velocity, cx, nw, color);
}

function handleNoteOff (note) {
  highway.noteOff(note);
  delete noteColorMap[note];
}

midi.onNoteOn(handleNoteOn);
midi.onNoteOff(handleNoteOff);

document.getElementById('midi-btn').addEventListener('click', async () => {
  const ok = await midi.requestAccess();
  if (!ok) alert('Web MIDI not available — use keyboard (A-L keys)');
});

// ── On-screen keyboard pointer input ────────────────────────────────────────

pianoCanvas.style.touchAction = 'none';

function getPointerNote (e) {
  if (!settings.get('showKeyboard')) return null;
  const rect = pianoCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = (e.clientX - rect.left) * (pianoCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (pianoCanvas.height / rect.height);
  return noteAtPoint(x, y, pianoCanvas.width, pianoCanvas.height);
}

function releasePointerNote (pointerId) {
  const oldNote = pointerToNote.get(pointerId);
  if (oldNote == null) return;
  pointerToNote.delete(pointerId);
  const count = (noteTouchCount.get(oldNote) || 0) - 1;
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
  const count = noteTouchCount.get(note) || 0;
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
  pianoCanvas.setPointerCapture(e.pointerId);
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

  // — Fluid splats from active note heads —
  if (fluid && fluidOn) {
    const color = settings.get('noteColor');
    const [r, g, b] = hexToRgb(color);
    const velY = -(speed / H) * 0.30 * intensity;

    for (const t of highway.activeTrails()) {
      const normX  = (t.x + t.width / 2) / W;
      const normY  = t.topY / (H - kh); // top of head, 0=keyboard, 1=top
      const radius = Math.max(0.03, (t.width / W) * 5.0);
      fluid.addSplat(normX, normY, 0, velY, r * intensity, g * intensity, b * intensity, radius);
    }

    fluid.step(dt);
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

// ── Boot ────────────────────────────────────────────────────────────────────

resize();
initFluid();
requestAnimationFrame(frame);

// Auto-request MIDI on load (fails silently if denied/unavailable)
midi.requestAccess().catch(() => {});
