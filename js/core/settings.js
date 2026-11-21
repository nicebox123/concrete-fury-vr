const KEY = 'concrete-fury-settings-v1';

const DEFAULTS = {
  // Gore
  goreIntensity: 2,     // 0 low .. 3 extreme
  blood: true,
  decals: true,
  ragdoll: true,
  dismember: true,
  perfMode: false,      // performance-friendly effects mode
  // Comfort
  locomotion: 'smooth', // 'smooth' | 'teleport'
  turn: 'snap',         // 'snap' | 'smooth'
  snapAngle: 45,
  vignette: true,
  gunAngle: 0,          // degrees, pitch offset for held items
  // General
  volume: 0.8,
  shadows: true,
  mouseSens: 1,
  // Sandbox
  aiMode: 'aggressive', // 'aggressive' | 'passive' | 'frozen'
  godMode: false,
};

const listeners = new Set();

export const Settings = {
  ...DEFAULTS,
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* storage unavailable */ }
  },
  save() {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
  },
  set(key, value) {
    this[key] = value;
    this.save();
    for (const fn of listeners) fn(key, value);
  },
  onChange(fn) { listeners.add(fn); },
  reset() { Object.assign(this, DEFAULTS); this.save(); for (const fn of listeners) fn('*'); },

  // Derived budgets
  get goreScale() { return [0.35, 0.7, 1, 1.5][this.goreIntensity] * (this.perfMode ? 0.6 : 1); },
  get maxDecals() { return this.perfMode ? 70 : 220; },
  get maxBloodParticles() { return this.perfMode ? 160 : 600; },
  get maxCorpses() { return this.perfMode ? 5 : 10; },
  get maxEnemies() { return this.perfMode ? 6 : 10; },
  get maxDebris() { return this.perfMode ? 10 : 24; },
  get physicsIterations() { return this.perfMode ? 3 : 5; },
};
