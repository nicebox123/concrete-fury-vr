// HUD: DOM overlay on desktop; wrist display, floating banner and grab
// markers in VR.
import * as THREE from 'three';
import { G } from '../core/context.js';

export class HUD {
  constructor() {
    this.el = {
      root: document.getElementById('hud'), tl: document.getElementById('hudTL'), hp: document.getElementById('hpfill'),
      ammo: document.getElementById('ammo'), hint: document.getElementById('hint'), banner: document.getElementById('banner'),
    };
    this.bannerT = 0;
    this.bannerText = '';
    this.t = 0;
    // wrist display (VR)
    this.wc = document.createElement('canvas'); this.wc.width = 384; this.wc.height = 224;
    this.wx = this.wc.getContext('2d');
    this.wtex = new THREE.CanvasTexture(this.wc); this.wtex.colorSpace = THREE.SRGBColorSpace;
    this.wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.07), new THREE.MeshBasicMaterial({ map: this.wtex, transparent: true, fog: false }));
    this.wrist.visible = false;
    G.scene.add(this.wrist);
    // floating banner (VR)
    this.bc = document.createElement('canvas'); this.bc.width = 1024; this.bc.height = 160;
    this.bx = this.bc.getContext('2d');
    this.btex = new THREE.CanvasTexture(this.bc); this.btex.colorSpace = THREE.SRGBColorSpace;
    this.bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.22), new THREE.MeshBasicMaterial({ map: this.btex, transparent: true, depthTest: false, fog: false }));
    this.bannerMesh.renderOrder = 998;
    this.bannerMesh.position.set(0, 0.25, -1.6);
    this.bannerMesh.visible = false;
    G.camera.add(this.bannerMesh);
    // grab markers
    const mm = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.85, depthTest: false });
    this.markers = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 24), mm); m.renderOrder = 997; m.visible = false; G.scene.add(m); return m; });
  }

  flash(text, dur = 2) {
    this.bannerText = text; this.bannerT = dur;
    this.el.banner.textContent = text;
    const x = this.bx;
    x.clearRect(0, 0, 1024, 160);
    x.font = '900 72px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 10; x.strokeStyle = 'rgba(0,0,0,0.75)'; x.strokeText(text, 512, 80);
    x.fillStyle = '#fff'; x.fillText(text, 512, 80);
    this.btex.needsUpdate = true;
  }

  heldAmmo() {
    const out = [];
    for (const h of G.player.hands) {
      const it = h.heldItem;
      if (it && it.isGun) out.push(`${it.def.name}: ${it.ammoInfo()}  [${fmtRes(it.def.ammo)}]`);
      else if (it && it.isMelee) out.push(it.def.name);
    }
    return out;
  }

  update(dt) {
    this.t += dt;
    const pl = G.player;
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.textContent = ''; }
    const mode = G.modes.current;
    const lines = mode ? mode.hud() : [];
    // desktop DOM
    if (!G.isVR) {
      this.el.root.classList.toggle('hidden', !G.started);
      this.el.hp.style.width = `${Math.max(0, pl.health / pl.maxHealth * 100)}%`;
      this.el.ammo.textContent = this.heldAmmo().join('  ');
      if (Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this.el.tl.textContent = lines.join('\n');
      const h = pl.right;
      let hint = '';
      if (G.ui.isOpen()) hint = '';
      else if (h.hover) hint = `E  pick up ${h.hover.name}`;
      else if (h.heldItem && h.heldItem.isGun) hint = '';
      else if (h.held && h.held.kind === 'particle') hint = 'E release · RMB throw';
      this.el.hint.textContent = hint;
      this.bannerMesh.visible = false;
      this.wrist.visible = false;
      for (const m of this.markers) m.visible = false;
      return;
    }
    this.el.root.classList.add('hidden');
    // VR banner
    this.bannerMesh.visible = this.bannerT > 0;
    this.bannerMesh.material.opacity = Math.min(1, this.bannerT * 2);
    // wrist (left hand, back of wrist)
    const L = pl.left;
    this.wrist.visible = G.started;
    if (this.wrist.visible) {
      const q = L.quat;
      const off = new THREE.Vector3(0, 0.05, 0.08).applyQuaternion(q);
      this.wrist.position.copy(L.pos).add(off);
      this.wrist.quaternion.copy(q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.5, 0, 0)));
      if (Math.floor(this.t * 5) !== Math.floor((this.t - dt) * 5)) this.drawWrist(lines);
    }
    // grab markers on force-pull targets
    pl.hands.forEach((h, i) => {
      const m = this.markers[i];
      const it = h.hover;
      m.visible = !!it && !h.held && !G.ui.isOpen();
      if (m.visible) {
        m.position.copy(it.position);
        m.lookAt(G.player.headPos);
        const s = 1 + 0.15 * Math.sin(this.t * 8);
        m.scale.setScalar(s * Math.max(1, it.radius * 3));
      }
    });
  }

  drawWrist(lines) {
    const x = this.wx, pl = G.player;
    x.clearRect(0, 0, 384, 224);
    x.fillStyle = 'rgba(14,16,18,0.88)'; x.fillRect(0, 0, 384, 224);
    x.fillStyle = '#e2502c'; x.fillRect(0, 0, 384, 6);
    x.fillStyle = '#333'; x.fillRect(16, 22, 352, 22);
    x.fillStyle = pl.health > 35 ? '#e2502c' : '#ff2020'; x.fillRect(16, 22, 352 * Math.max(0, pl.health / pl.maxHealth), 22);
    x.fillStyle = '#fff'; x.font = '700 18px system-ui'; x.textBaseline = 'middle'; x.fillText(`${Math.ceil(pl.health)} HP`, 22, 33);
    x.font = '700 22px system-ui';
    lines.forEach((l, i) => x.fillText(l, 16, 72 + i * 30));
    x.font = '600 18px system-ui'; x.fillStyle = '#cfcac0';
    this.heldAmmo().forEach((l, i) => x.fillText(l, 16, 144 + i * 26));
    this.wtex.needsUpdate = true;
  }
}

function fmtRes(type) {
  const n = G.weapons.reserve(type);
  return n >= 999 ? '∞' : String(n);
}
