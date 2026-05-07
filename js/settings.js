// Persistent settings via localStorage

const KEY = 'piano-viz-settings';

const DEFAULTS = {
  noteColor: '#4488ff',
  speed: 300,
  noteWidth: 12,
  fluidEnabled: true,
  fluidIntensity: 100,
  fluidRadius: 2,
  fluidSpeed: 30,
  fluidSource: 'head',
  monophonic: false,
  densityDissipation: 1.0,
  velocityDissipation: 0.2,
  curl: 30,
  showKeyboard: true,
  keyboardHeight: 80,
};

export class Settings {
  constructor () {
    this._data = { ...DEFAULTS };
    this._load();
  }

  get (key) { return this._data[key]; }

  set (key, value) {
    this._data[key] = value;
    this._save();
  }

  all () { return { ...this._data }; }

  _load () {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this._data, JSON.parse(raw));
    } catch {}
  }

  _save () {
    try {
      localStorage.setItem(KEY, JSON.stringify(this._data));
    } catch {}
  }
}

// ─ UI wiring ────────────────────────────────────────────────────────────

export function bindSettingsUI (settings, onChange) {
  const $ = id => document.getElementById(id);

  function wire (id, key, transform = v => v) {
    const el = $(id);
    if (!el) return;
    // Set initial value
    if (el.type === 'checkbox') el.checked = settings.get(key);
    else if (el.type === 'color') el.value = settings.get(key);
    else el.value = settings.get(key);

    // Update display span if present
    const span = $(`${id}-val`);
    if (span) span.textContent = _formatVal(id, settings.get(key));

    el.addEventListener('input', () => {
      const raw = el.type === 'checkbox' ? el.checked : el.value;
      const val = transform(raw);
      settings.set(key, val);
      if (span) span.textContent = _formatVal(id, val);
      onChange(key, val);
    });
  }

  wire('note-color',            'noteColor');
  wire('speed',                 'speed',              v => Number(v));
  wire('note-width',            'noteWidth',          v => Number(v));
  wire('fluid-enabled',         'fluidEnabled');
  wire('fluid-intensity',       'fluidIntensity',     v => Number(v));
  wire('fluid-radius',          'fluidRadius',        v => Number(v));
  wire('fluid-speed',           'fluidSpeed',         v => Number(v));
  wire('fluid-source',          'fluidSource');
  wire('monophonic',            'monophonic');
  wire('density-dissipation',   'densityDissipation', v => Number(v) / 10);
  wire('velocity-dissipation',  'velocityDissipation',v => Number(v) / 10);
  wire('curl',                  'curl',               v => Number(v));
  wire('show-keyboard',         'showKeyboard');
  wire('keyboard-height',       'keyboardHeight',     v => Number(v));
}

function _formatVal (id, val) {
  if (id === 'fluid-intensity') return Math.round(val) + '%';
  if (id === 'fluid-radius') return Number(val).toFixed(1);
  if (id === 'density-dissipation' || id === 'velocity-dissipation') return val.toFixed(1);
  return val;
}
