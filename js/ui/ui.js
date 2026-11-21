// World-space UI: a canvas-textured panel operated by VR laser pointers or the
// desktop mouse. Menus are rebuilt declaratively whenever state changes.
import * as THREE from 'three';
import { G } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { MAPS } from '../world/maps.js';
import { ENEMY_TYPES } from '../game/enemies.js';
import { WEAPONS } from '../game/weapons.js';
import { PROPS } from '../game/props.js';
import { MODES } from '../game/modes.js';

const W = 1024, H = 720;
const C = { bg: 'rgba(16,18,20,0.94)', panel: '#1e2124', line: '#34383c', fg: '#ece8e0', mute: '#8f8b84', accent: '#e2502c', accentDim: '#5a2a1e', good: '#4caf6a' };

class Panel {
  constructor(width = 1.5) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const h = width * H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: true, fog: false }));
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.widgets = [];
    this.hover = null;
  }
  clear() { this.widgets = []; }
  add(w) { this.widgets.push(w); return w; }
  button(x, y, w, h, label, onClick, o = {}) { return this.add({ type: 'button', x, y, w, h, label, onClick, ...o }); }
  label(x, y, text, o = {}) { return this.add({ type: 'label', x, y, text, ...o }); }
  toggle(x, y, w, label, value, onChange) { return this.add({ type: 'toggle', x, y, w, h: 54, label, value, onClick: () => onChange(!value) }); }
  slider(x, y, w, label, value, min, max, step, onChange, fmt = (v) => v) {
    return this.add({ type: 'slider', x, y, w, h: 64, label, value, min, max, step, fmt, onDrag: (u) => { let v = min + (max - min) * Math.min(1, Math.max(0, u)); v = Math.round(v / step) * step; onChange(Math.round(v * 1000) / 1000); } });
  }
  draw() {
    const x = this.ctx;
    x.clearRect(0, 0, W, H);
    x.fillStyle = C.bg; roundRect(x, 4, 4, W - 8, H - 8, 18); x.fill();
    x.strokeStyle = C.line; x.lineWidth = 3; x.stroke();
    x.fillStyle = C.accent; x.fillRect(24, 4, 120, 6);
    for (const w of this.widgets) {
      const hov = this.hover === w;
      x.textBaseline = 'middle';
      switch (w.type) {
        case 'label':
          x.fillStyle = w.color || C.fg; x.textAlign = w.align || 'left';
          x.font = `${w.weight || 600} ${w.size || 26}px system-ui, sans-serif`;
          if (w.maxW) wrap(x, w.text, w.x, w.y, w.maxW, (w.size || 26) * 1.3); else x.fillText(w.text, w.x, w.y);
          break;
        case 'button': {
          const act = w.active;
          x.fillStyle = act ? C.accent : hov ? '#2c3034' : C.panel;
          roundRect(x, w.x, w.y, w.w, w.h, 10); x.fill();
          x.strokeStyle = act ? C.accent : hov ? C.accent : C.line; x.lineWidth = 2; x.stroke();
          x.fillStyle = w.disabled ? C.mute : C.fg; x.textAlign = 'center';
          x.font = `700 ${w.size || 26}px system-ui, sans-serif`;
          x.fillText(w.label, w.x + w.w / 2, w.y + w.h / 2 + (w.sub ? -10 : 0));
          if (w.sub) { x.font = `500 17px system-ui, sans-serif`; x.fillStyle = act ? '#ffe' : C.mute; x.fillText(w.sub, w.x + w.w / 2, w.y + w.h / 2 + 16); }
          break;
        }
        case 'toggle': {
          x.fillStyle = hov ? '#2c3034' : C.panel; roundRect(x, w.x, w.y, w.w, w.h, 10); x.fill();
          x.strokeStyle = hov ? C.accent : C.line; x.lineWidth = 2; x.stroke();
          x.fillStyle = C.fg; x.textAlign = 'left'; x.font = '600 24px system-ui, sans-serif';
          x.fillText(w.label, w.x + 18, w.y + w.h / 2);
          const sx = w.x + w.w - 86, sy = w.y + 13;
          x.fillStyle = w.value ? C.accent : '#3a3e42'; roundRect(x, sx, sy, 66, 28, 14); x.fill();
          x.fillStyle = '#fff'; x.beginPath(); x.arc(w.value ? sx + 52 : sx + 14, sy + 14, 11, 0, 7); x.fill();
          break;
        }
        case 'slider': {
          x.fillStyle = C.fg; x.textAlign = 'left'; x.font = '600 23px system-ui, sans-serif';
          x.fillText(w.label, w.x, w.y + 14);
          x.textAlign = 'right'; x.fillStyle = C.accent; x.fillText(String(w.fmt(w.value)), w.x + w.w, w.y + 14);
          const ty = w.y + 46, u = (w.value - w.min) / (w.max - w.min);
          x.fillStyle = '#3a3e42'; roundRect(x, w.x, ty - 5, w.w, 10, 5); x.fill();
          x.fillStyle = C.accent; roundRect(x, w.x, ty - 5, Math.max(10, w.w * u), 10, 5); x.fill();
          x.fillStyle = hov ? '#fff' : '#ddd'; x.beginPath(); x.arc(w.x + w.w * u, ty, 13, 0, 7); x.fill();
          break;
        }
      }
    }
    this.tex.needsUpdate = true;
  }
  hit(px, py) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.type === 'label' || w.disabled) continue;
      if (px >= w.x && px <= w.x + w.w && py >= w.y && py <= w.y + w.h) return w;
    }
    return null;
  }
}

function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function wrap(x, text, cx, cy, maxW, lh) {
  const words = text.split(' '); let line = '', y = cy;
  for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (x.measureText(t).width > maxW && line) { x.fillText(line, cx, y); line = wd; y += lh; } else line = t; }
  x.fillText(line, cx, y);
}

export class UI {
  constructor() {
    this.panel = new Panel(1.5);
    G.scene.add(this.panel.mesh);
    this.screen = null;
    this.sel = { mode: 'sandbox', map: 'training' };
    this.settingsTab = 'gore';
    this.spawnTab = 'enemies';
    this.prevScreen = null;
    this.ray = new THREE.Raycaster();
    this.dragging = null;
    this.results = null;
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.ndc = new THREE.Vector2();
    Settings.onChange(() => { if (this.screen === 'settings') this.render(); });
  }

  isOpen() { return this.screen !== null; }

  place() {
    const cam = G.camera;
    cam.getWorldPosition(this._v);
    const yaw = G.player.headYaw();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const p = this._v.clone().addScaledVector(fwd, G.isVR ? 1.25 : 1.05);
    p.y = this._v.y - (G.isVR ? 0.15 : 0.0);
    this.panel.mesh.position.copy(p);
    this.panel.mesh.rotation.set(0, yaw, 0);
  }

  open(screen) {
    const wasOpen = this.isOpen();
    this.screen = screen;
    if (!wasOpen) this.place();
    this.panel.mesh.visible = true;
    G.paused = (screen === 'pause' || screen === 'settings' || screen === 'results') && G.started && G.modes.current !== null;
    if (screen === 'main') G.paused = false;
    G.input.unlock();
    this.render();
    G.audio.play('ui', null, 1, {});
  }
  close() {
    this.screen = null;
    this.panel.mesh.visible = false;
    G.paused = false;
    for (const h of G.player.hands) h.laser.visible = false;
    if (!G.isVR) G.input.lock();
  }
  openPause() { if (this.screen === 'main') return; this.open('pause'); }
  openMain() { this.open('main'); }
  openSpawn() { this.open('spawn'); }
  openResults(r) { this.results = r; this.open('results'); }

  render() {
    const P = this.panel;
    P.clear();
    switch (this.screen) {
      case 'main': this.mainMenu(P); break;
      case 'pause': this.pauseMenu(P); break;
      case 'settings': this.settingsMenu(P); break;
      case 'spawn': this.spawnMenu(P); break;
      case 'results': this.resultsMenu(P); break;
    }
    P.draw();
  }

  title(P, text, sub) {
    P.label(40, 52, text, { size: 40, weight: 900 });
    if (sub) P.label(40, 92, sub, { size: 20, color: C.mute, weight: 500 });
  }

  mainMenu(P) {
    this.title(P, 'CONCRETE FURY', 'VR PHYSICS COMBAT SANDBOX');
    P.label(40, 140, 'MODE', { size: 20, color: C.accent, weight: 800 });
    const modes = Object.values(MODES);
    modes.forEach((m, i) => P.button(40, 160 + i * 78, 420, 70, m.name, () => {
      this.sel.mode = m.id;
      if (m.forceMap) this.sel.map = m.forceMap;
      else if (m.defaultMap && !this._mapChosen) this.sel.map = m.defaultMap;
      this.render();
    }, { active: this.sel.mode === m.id, sub: m.short }));
    P.label(500, 140, 'MAP', { size: 20, color: C.accent, weight: 800 });
    const forced = MODES[this.sel.mode].forceMap;
    Object.entries(MAPS).forEach(([id, m], i) => P.button(500, 160 + i * 68, 480, 60, m.name, () => { this.sel.map = id; this._mapChosen = true; this.render(); }, { active: this.sel.map === id, disabled: !!forced && forced !== id, size: 24 }));
    P.label(500, 518, MAPS[this.sel.map].desc, { size: 19, color: C.mute, weight: 500, maxW: 480 });
    P.label(40, 494, MODES[this.sel.mode].desc, { size: 18, color: C.mute, weight: 500, maxW: 420 });
    P.button(40, 600, 300, 80, 'START', () => { G.modes.start(this.sel.mode, this.sel.map); this.close(); }, { active: true, size: 32 });
    P.button(360, 600, 260, 80, 'SETTINGS', () => { this.prevScreen = 'main'; this.open('settings'); });
    if (G.modes.current) P.button(640, 600, 340, 80, 'RESUME', () => this.close());
  }

  pauseMenu(P) {
    const m = G.modes.current;
    this.title(P, 'PAUSED', m ? `${m.name} · ${MAPS[G.modes.mapId].name}` : '');
    let y = 150;
    P.button(312, y, 400, 76, 'RESUME', () => this.close(), { active: true }); y += 92;
    if (m && m.id === 'sandbox') { P.button(312, y, 400, 76, 'SPAWN MENU', () => this.open('spawn')); y += 92; }
    P.button(312, y, 400, 76, 'RESTART', () => { G.modes.start(G.modes.current.id, G.modes.mapId); this.close(); }); y += 92;
    P.button(312, y, 400, 76, 'SETTINGS', () => { this.prevScreen = 'pause'; this.open('settings'); }); y += 92;
    P.button(312, y, 400, 76, 'MAIN MENU', () => this.open('main')); y += 92;
    P.label(512, 680, G.isVR ? 'Hold Y or press Y with an empty left hand to open this menu' : 'Esc opens this menu · click the game to resume', { size: 18, color: C.mute, align: 'center', weight: 500 });
  }

  settingsMenu(P) {
    this.title(P, 'SETTINGS');
    const tabs = [['gore', 'GORE & EFFECTS'], ['comfort', 'COMFORT'], ['general', 'GENERAL']];
    tabs.forEach(([id, l], i) => P.button(40 + i * 320, 120, 300, 56, l, () => { this.settingsTab = id; this.render(); }, { active: this.settingsTab === id, size: 22 }));
    const S = Settings, set = (k) => (v) => S.set(k, v);
    const x1 = 40, x2 = 540, w = 444;
    if (this.settingsTab === 'gore') {
      P.slider(x1, 205, w, 'Gore intensity', S.goreIntensity, 0, 3, 1, set('goreIntensity'), (v) => ['Low', 'Medium', 'High', 'Extreme'][v]);
      P.toggle(x1, 295, w, 'Blood effects', S.blood, set('blood'));
      P.toggle(x1, 365, w, 'Blood decals', S.decals, set('decals'));
      P.toggle(x2, 205, w, 'Ragdoll physics', S.ragdoll, set('ragdoll'));
      P.toggle(x2, 275, w, 'Dismemberment', S.dismember, set('dismember'));
      P.toggle(x2, 345, w, 'Performance mode', S.perfMode, (v) => { S.set('perfMode', v); G.applyQuality && G.applyQuality(); });
      P.label(x1, 470, 'Performance mode lowers particle and decal budgets, shortens decal lifetime, turns off shadows and reduces render resolution and lights (applies fully on the next map load).', { size: 19, color: C.mute, weight: 500, maxW: 944 });
    } else if (this.settingsTab === 'comfort') {
      P.toggle(x1, 205, w, `Locomotion: ${S.locomotion === 'smooth' ? 'Smooth' : 'Teleport'}`, S.locomotion === 'teleport', (v) => S.set('locomotion', v ? 'teleport' : 'smooth'));
      P.toggle(x1, 275, w, `Turning: ${S.turn === 'snap' ? 'Snap' : 'Smooth'}`, S.turn === 'smooth', (v) => S.set('turn', v ? 'smooth' : 'snap'));
      P.slider(x1, 350, w, 'Snap angle', S.snapAngle, 15, 90, 15, set('snapAngle'), (v) => v + '°');
      P.toggle(x2, 205, w, 'Comfort vignette', S.vignette, set('vignette'));
      P.slider(x2, 280, w, 'Held item angle', S.gunAngle, -40, 40, 5, set('gunAngle'), (v) => v + '°');
      P.label(x1, 470, 'Teleport: push the right stick forward, aim the arc, release. Left stick still moves in smooth mode. Crouch toggles with right stick down; physical crouching always works.', { size: 19, color: C.mute, weight: 500, maxW: 944 });
    } else {
      P.slider(x1, 205, w, 'Master volume', S.volume, 0, 1, 0.05, set('volume'), (v) => Math.round(v * 100) + '%');
      P.toggle(x1, 295, w, 'Shadows', S.shadows, (v) => { S.set('shadows', v); G.applyQuality && G.applyQuality(); });
      P.slider(x2, 205, w, 'Mouse sensitivity', S.mouseSens, 0.2, 3, 0.1, set('mouseSens'), (v) => v.toFixed(1));
      P.button(x2, 295, w, 54, 'Reset all settings', () => { S.reset(); G.applyQuality && G.applyQuality(); this.render(); }, { size: 22 });
    }
    P.button(40, 610, 300, 74, 'BACK', () => this.open(this.prevScreen || 'main'), { active: true });
  }

  spawnMenu(P) {
    this.title(P, 'SPAWN MENU', 'Items appear where you are looking');
    const tabs = [['enemies', 'ENEMIES'], ['weapons', 'WEAPONS'], ['objects', 'OBJECTS'], ['world', 'SANDBOX']];
    tabs.forEach(([id, l], i) => P.button(40 + i * 240, 120, 226, 56, l, () => { this.spawnTab = id; this.render(); }, { active: this.spawnTab === id, size: 22 }));
    const grid = (items, fn) => items.forEach(([id, name, sub], i) => {
      const c = i % 3, r = Math.floor(i / 3);
      P.button(40 + c * 320, 200 + r * 92, 300, 80, name, () => fn(id), { sub, size: 24 });
    });
    if (this.spawnTab === 'enemies') {
      grid(Object.values(ENEMY_TYPES).map(e => [e.id, e.name, `${e.hp} HP · ${e.attack === 'gun' ? e.weapon : e.attack}`]), (id) => this.spawnAtAim('enemy', id));
    } else if (this.spawnTab === 'weapons') {
      grid(Object.values(WEAPONS).map(w => [w.id, w.name, w.kind === 'gun' ? `${w.magSize} rounds` : (w.melee.sharp ? 'blade' : 'blunt')]), (id) => this.spawnAtAim('weapon', id));
    } else if (this.spawnTab === 'objects') {
      const list = ['crate', 'smallCrate', 'metalCrate', 'barrel', 'explosiveBarrel', 'cinderBlock', 'bottle', 'chair', 'table', 'pallet', 'ammoBox', 'medkit'];
      list.forEach((id, i) => { const c = i % 4, r = Math.floor(i / 4); P.button(40 + c * 240, 200 + r * 92, 226, 80, PROPS[id].name, () => this.spawnAtAim('prop', id), { size: 21 }); });
    } else {
      const S = Settings;
      P.label(40, 215, 'Enemy AI', { size: 22, color: C.accent, weight: 800 });
      [['aggressive', 'Aggressive'], ['passive', 'Passive'], ['frozen', 'Frozen']].forEach(([id, l], i) => P.button(40 + i * 230, 240, 214, 64, l, () => { S.set('aiMode', id); this.render(); }, { active: S.aiMode === id, size: 22 }));
      P.toggle(40, 330, 444, 'God mode', S.godMode, (v) => { S.set('godMode', v); this.render(); });
      P.button(540, 240, 444, 64, 'Kill all enemies', () => { for (const e of [...G.enemies.list]) if (e.alive) e.die('admin'); }, { size: 22 });
      P.button(540, 320, 444, 64, 'Remove bodies', () => { for (const e of [...G.enemies.list]) if (!e.alive) e.remove(); G.enemies.list = G.enemies.list.filter(e => !e.removed); }, { size: 22 });
      P.button(540, 400, 444, 64, 'Clear loose objects', () => { for (const it of [...G.items]) if (!it.heldBy && !it.holster && it.kind !== 'door' && it.kind !== 'target' && !it.enemyHolder) it.destroy(); }, { size: 22 });
      P.button(540, 480, 444, 64, 'Clear blood & decals', () => G.fx.clear(), { size: 22 });
    }
    P.button(40, 610, 300, 74, 'CLOSE', () => this.close(), { active: true });
    P.label(984, 647, `Enemies: ${G.enemies.aliveCount}/${Settings.maxEnemies}  ·  Objects: ${G.items.length}`, { size: 19, color: C.mute, align: 'right', weight: 500 });
  }

  spawnAtAim(kind, id) {
    const cam = G.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const yaw = G.player.headYaw();
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    let dist = kind === 'enemy' ? 4 : 2;
    const hit = G.physics.raycastStatic(o, fwd, dist + 0.5);
    if (hit) dist = Math.max(0.8, hit.dist - 0.6);
    const p = o.clone().addScaledVector(fwd, dist);
    const gh = G.physics.groundHeight(p.x, p.z, o.y, 0.2);
    p.y = (gh > -50 ? gh : 0);
    if (kind === 'enemy') {
      if (G.enemies.aliveCount >= Settings.maxEnemies) { G.hud.flash('ENEMY LIMIT REACHED'); return; }
      G.enemies.spawn(id, p.x, p.z, yaw + Math.PI);
    } else if (kind === 'weapon') {
      p.y += 1.0;
      G.weapons.spawn(id, p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    } else {
      p.y += PROPS[id].he[1] + 0.3;
      G.props.spawn(id, p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
    }
    G.audio.play('pickup', p, 0.8);
    this.render();
  }

  resultsMenu(P) {
    const r = this.results || {};
    this.title(P, r.title || 'GAME OVER', r.sub || '');
    const rows = r.rows || [];
    rows.forEach(([k, v], i) => {
      P.label(260, 170 + i * 52, k, { size: 26, color: C.mute, weight: 600 });
      P.label(764, 170 + i * 52, String(v), { size: 30, weight: 800, align: 'right' });
    });
    P.button(160, 600, 330, 80, 'RETRY', () => { G.modes.start(G.modes.current.id, G.modes.mapId); this.close(); }, { active: true });
    P.button(534, 600, 330, 80, 'MAIN MENU', () => this.open('main'));
  }

  // ---- pointer handling ----
  update(dt) {
    if (!this.isOpen()) return;
    const P = this.panel;
    const mesh = P.mesh;
    mesh.updateMatrixWorld(true);
    let hovered = null, clicked = false, dragU = null;
    if (G.isVR) {
      for (const h of G.player.hands) {
        const c = G.input.controllerFor(h.side);
        if (!c) { h.laser.visible = false; continue; }
        c.ray.updateMatrixWorld(true);
        const o = c.ray.getWorldPosition(new THREE.Vector3());
        const d = new THREE.Vector3(0, 0, -1).applyQuaternion(c.ray.getWorldQuaternion(new THREE.Quaternion()));
        this.ray.set(o, d);
        const hit = this.ray.intersectObject(mesh, false)[0];
        h.laser.visible = true;
        h.laser.position.copy(o);
        h.laser.quaternion.copy(c.ray.getWorldQuaternion(new THREE.Quaternion()));
        h.laser.scale.set(1, 1, hit ? hit.distance : 3);
        if (hit) {
          const w = P.hit(hit.uv.x * W, (1 - hit.uv.y) * H);
          if (w) hovered = w;
          if (h.input.pressed.trigger) { clicked = true; if (w && w.type === 'slider') this.dragging = { w, hand: h }; }
          if (this.dragging && this.dragging.hand === h) {
            if (h.input.down.trigger) dragU = (hit.uv.x * W - this.dragging.w.x) / this.dragging.w.w;
            else this.dragging = null;
          }
        }
      }
    } else {
      const I = G.input;
      this.ndc.set((I.mouse.x / window.innerWidth) * 2 - 1, -(I.mouse.y / window.innerHeight) * 2 + 1);
      this.ray.setFromCamera(this.ndc, G.camera);
      const hit = this.ray.intersectObject(mesh, false)[0];
      if (hit) {
        hovered = P.hit(hit.uv.x * W, (1 - hit.uv.y) * H);
        if (I.mousePressed(0)) { clicked = true; if (hovered && hovered.type === 'slider') this.dragging = { w: hovered }; }
        if (this.dragging && I.mouseDown(0)) dragU = (hit.uv.x * W - this.dragging.w.x) / this.dragging.w.w;
      }
      if (!I.mouseDown(0)) this.dragging = null;
      if (I.keyPressed('Escape') && this.screen !== 'main') this.close();
    }
    if (hovered !== P.hover) { P.hover = hovered; P.draw(); if (hovered) G.audio.play('ui', null, 0.4, { hover: true }); }
    if (dragU !== null && this.dragging) { this.dragging.w.onDrag(dragU); this.render(); return; }
    if (clicked && hovered && hovered.onClick) { G.audio.play('ui', null, 1, {}); hovered.onClick(); if (this.isOpen()) this.render(); }
  }
}
