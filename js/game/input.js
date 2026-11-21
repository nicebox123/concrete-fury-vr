// Unified input: polls WebXR gamepads (Meta Quest Touch, xr-standard mapping)
// and keyboard/mouse, exposing edge-detected button states per hand.
import { G } from '../core/context.js';

function makeHandState() {
  return {
    connected: false, gamepad: null, source: null,
    trigger: 0, grip: 0, a: false, b: false, stickClick: false, sx: 0, sy: 0,
    prev: { trigger: false, grip: false, a: false, b: false, stickClick: false },
    down: { trigger: false, grip: false, a: false, b: false, stickClick: false },
    pressed: { trigger: false, grip: false, a: false, b: false, stickClick: false },
    released: { trigger: false, grip: false, a: false, b: false, stickClick: false },
  };
}

export class Input {
  constructor(renderer, canvas) {
    this.renderer = renderer;
    this.canvas = canvas;
    this.hands = { left: makeHandState(), right: makeHandState() };
    this.controllers = [];   // {ray, grip, side}
    this.keys = new Set();
    this.keysPressed = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, pressed: 0, released: 0, x: 0, y: 0 };
    this.locked = false;
    this.wantLock = false;
    this.onClickUnlocked = null;

    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const c = { ray, grip, side: null, source: null, index: i };
      ray.addEventListener('connected', (e) => { c.source = e.data; c.side = e.data.handedness; });
      ray.addEventListener('disconnected', () => { c.source = null; c.side = null; });
      this.controllers.push(c);
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; }
      this.mouse.buttons |= (1 << e.button); this.mouse.pressed |= (1 << e.button);
      if (!this.locked && this.onClickUnlocked) this.onClickUnlocked(e);
    });
    window.addEventListener('mouseup', (e) => { this.mouse.buttons &= ~(1 << e.button); this.mouse.released |= (1 << e.button); });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && G.started && !G.isVR && !G.paused && G.ui) G.ui.openPause();
    });
  }

  lock() { if (!G.isVR) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { } } }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(code) { return this.keys.has(code); }
  keyPressed(code) { return this.keysPressed.has(code); }
  mouseDown(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  mousePressed(b) { return (this.mouse.pressed & (1 << b)) !== 0; }
  mouseReleased(b) { return (this.mouse.released & (1 << b)) !== 0; }

  controllerFor(side) { return this.controllers.find(c => c.side === side) || null; }

  update() {
    for (const side of ['left', 'right']) {
      const h = this.hands[side];
      const c = this.controllerFor(side);
      const gp = c && c.source && c.source.gamepad;
      h.connected = !!gp; h.gamepad = gp || null; h.source = c ? c.source : null;
      if (gp) {
        const B = gp.buttons;
        h.trigger = B[0] ? B[0].value : 0;
        h.grip = B[1] ? B[1].value : 0;
        h.stickClick = !!(B[3] && B[3].pressed);
        h.a = !!(B[4] && B[4].pressed);
        h.b = !!(B[5] && B[5].pressed);
        const ax = gp.axes;
        h.sx = ax.length >= 4 ? ax[2] : (ax[0] || 0);
        h.sy = ax.length >= 4 ? ax[3] : (ax[1] || 0);
        if (Math.abs(h.sx) < 0.15) h.sx = 0;
        if (Math.abs(h.sy) < 0.15) h.sy = 0;
      } else {
        h.trigger = h.grip = 0; h.a = h.b = h.stickClick = false; h.sx = h.sy = 0;
      }
      const cur = { trigger: h.trigger > 0.55, grip: h.grip > 0.5, a: h.a, b: h.b, stickClick: h.stickClick };
      for (const k in cur) {
        h.pressed[k] = cur[k] && !h.prev[k];
        h.released[k] = !cur[k] && h.prev[k];
        h.down[k] = cur[k];
        h.prev[k] = cur[k];
      }
    }
  }

  // Call at end of frame
  endFrame() {
    this.keysPressed.clear();
    this.mouse.dx = this.mouse.dy = 0;
    this.mouse.pressed = this.mouse.released = 0;
  }
}
