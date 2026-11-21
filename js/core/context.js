// Shared game context. Systems register themselves here so modules can talk
// to each other without circular imports.
export const G = {
  scene: null, camera: null, renderer: null,
  physics: null, fx: null, audio: null, input: null,
  player: null, level: null, weapons: null, props: null,
  enemies: null, ui: null, modes: null, hud: null,
  time: 0, dt: 1 / 72, frame: 0,
  isVR: false, started: false, paused: false,
  stats: { kills: 0, shots: 0, hits: 0, headshots: 0, dismembers: 0 },
};

// Small shared temp vectors helpers (avoid allocations in hot loops)
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function damp(k, dt) { return 1 - Math.pow(1 - k, dt * 72); } // frame-rate independent lerp factor
