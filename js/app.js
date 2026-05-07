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
let noteColorMap = {}; // note -> hex color (for per-note colors in future)
const pointerToNote = new Map();
const noteTouchCount = new Map();
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let readoutNote = null;

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
    const fluidSpeedFactor = settings.get('fluidSpeed') / 100;
    const velY = -(speed / H) * fluidSpeedFactor * intensity;
    const fluidRadius = settings.get('fluidRadius');
    const fluidSource = settings.get('fluidSource');
    // Multiply dye by dt so accumulation is frame-rate independent;
    // equilibrium density = intensity (not 60× intensity at 60 fps).
    const dr = r * intensity * dt;
    const dg = g * intensity * dt;
    const db = b * intensity * dt;

    for (const t of highway.activeTrails()) {
      const normX = (t.x + t.width / 2) / W;
      const radius = Math.max(0.005, (t.width / W) * fluidRadius);

      if (fluidSource === 'head' || fluidSource === 'both') {
        const normY = ((H - kh) - t.topY) / H;
        fluid.addSplat(normX, normY, 0, velY, dr, dg, db, radius);
      }
      if (fluidSource === 'base' || fluidSource === 'both') {
        const baseNormY = (H - kh) / H;
        fluid.addSplat(normX, baseNormY, 0, velY, dr, dg, db, radius);
      }
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
