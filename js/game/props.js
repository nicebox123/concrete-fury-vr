// Interactive environment: physics props, breakables, explosive barrels,
// glass panes, hinged doors, pop-up steel targets and pickups.
import * as THREE from 'three';
import { G, rand } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { Mat } from '../core/materials.js';
import { makeBoxBody, Particle } from '../physics/verlet.js';
import { Item, mergeByMaterial } from './items.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

function bx(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; }
function cy(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat); m.position.set(x, y, z); return m; }

// Geometry builders return a merged group centred on the body centre
const BUILD = {
  crate(s) {
    const g = new THREE.Group();
    g.add(bx(s, s, s, Mat.crate));
    const e = s * 0.08, dark = Mat.woodDark;
    for (const y of [-1, 1]) for (const z of [-1, 1]) g.add(bx(s + 0.004, e, e, dark, 0, y * (s - e) / 2, z * (s - e) / 2));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(bx(e, s + 0.004, e, dark, x * (s - e) / 2, 0, z * (s - e) / 2));
    for (const x of [-1, 1]) for (const y of [-1, 1]) g.add(bx(e, e, s + 0.004, dark, x * (s - e) / 2, y * (s - e) / 2, 0));
    g.add(bx(s * 1.0, e, e, dark, 0, 0, s / 2 + 0.002, 0, 0, Math.PI / 4));
    g.add(bx(s * 1.0, e, e, dark, 0, 0, -s / 2 - 0.002, 0, 0, -Math.PI / 4));
    return g;
  },
  metalCrate(s) {
    const g = new THREE.Group();
    g.add(bx(s * 1.3, s, s, Mat.crateMetal));
    for (const x of [-1, 0, 1]) g.add(bx(0.03, s + 0.01, s + 0.01, Mat.metal, x * s * 0.6, 0, 0));
    return g;
  },
  barrel(r, h, mat) {
    const g = new THREE.Group();
    g.add(cy(r, r, h, mat));
    for (const y of [-0.33, 0, 0.33]) g.add(cy(r * 1.03, r * 1.03, 0.03, Mat.metal, 0, y * h, 0));
    g.add(cy(r * 0.98, r * 0.98, 0.01, Mat.metal, 0, h / 2, 0));
    return g;
  },
  explosive(r, h) {
    const g = BUILD.barrel(r, h, Mat.barrelRed);
    g.add(cy(r * 1.01, r * 1.01, h * 0.16, Mat.hazard, 0, h * 0.18, 0));
    g.add(cy(0.035, 0.035, 0.03, Mat.metal, r * 0.5, h / 2 + 0.015, 0, 8));
    return g;
  },
  cinder() {
    const g = new THREE.Group();
    g.add(bx(0.4, 0.2, 0.2, Mat.concretePlain));
    return g;
  },
  bottle() {
    const g = new THREE.Group();
    const glass = BUILD._glassMat || (BUILD._glassMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75 }));
    g.add(cy(0.035, 0.035, 0.18, glass, 0, -0.03, 0, 10));
    g.add(cy(0.012, 0.03, 0.06, glass, 0, 0.09, 0, 10));
    g.add(cy(0.012, 0.012, 0.04, glass, 0, 0.14, 0, 10));
    return g;
  },
  chair() {
    const g = new THREE.Group();
    g.add(bx(0.44, 0.04, 0.42, Mat.wood, 0, 0, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(bx(0.04, 0.45, 0.04, Mat.woodDark, x * 0.19, -0.24, z * 0.18));
    g.add(bx(0.44, 0.4, 0.04, Mat.wood, 0, 0.22, -0.19));
    return g;
  },
  table() {
    const g = new THREE.Group();
    g.add(bx(1.4, 0.05, 0.8, Mat.woodDark, 0, 0.35, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(bx(0.06, 0.72, 0.06, Mat.metal, x * 0.62, -0.02, z * 0.33));
    return g;
  },
  pallet() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) g.add(bx(1.1, 0.025, 0.14, Mat.wood, 0, 0.055, -0.42 + i * 0.21));
    for (const z of [-1, 0, 1]) g.add(bx(1.1, 0.09, 0.1, Mat.woodDark, 0, -0.01, z * 0.42));
    return g;
  },
  ammoBox() {
    const g = new THREE.Group();
    g.add(bx(0.34, 0.18, 0.18, Mat.crateMetal));
    g.add(bx(0.1, 0.03, 0.04, Mat.black, 0, 0.1, 0));
    g.add(bx(0.345, 0.05, 0.185, Mat.paintedYellow, 0, 0.03, 0));
    return g;
  },
  medkit() {
    const g = new THREE.Group();
    g.add(bx(0.3, 0.12, 0.2, Mat.paintedWhite));
    g.add(bx(0.06, 0.125, 0.02, Mat.lightRed, 0, 0, 0.1));
    g.add(bx(0.02, 0.125, 0.06, Mat.lightRed, 0, 0, 0.09));
    g.add(bx(0.18, 0.124, 0.02, Mat.lightRed, 0, 0, 0.101).rotateZ(Math.PI / 2).translateX(0));
    return g;
  },
  plank() { const g = new THREE.Group(); g.add(bx(0.5, 0.03, 0.1, Mat.crate)); return g; },
};

// Prop catalogue: half extents, mass, build, behaviour
export const PROPS = {
  crate: { name: 'Wooden Crate', he: [0.3, 0.3, 0.3], mass: 12, build: () => BUILD.crate(0.6), hp: 55, breakable: 'wood', surface: 'wood', sound: 'wood' },
  smallCrate: { name: 'Small Crate', he: [0.2, 0.2, 0.2], mass: 5, build: () => BUILD.crate(0.4), hp: 30, breakable: 'wood', surface: 'wood', sound: 'wood' },
  metalCrate: { name: 'Steel Case', he: [0.39, 0.3, 0.3], mass: 35, build: () => BUILD.metalCrate(0.6), surface: 'metal', sound: 'metal' },
  barrel: { name: 'Barrel', he: [0.28, 0.44, 0.28], mass: 22, build: () => BUILD.barrel(0.28, 0.88, Mat.barrel), surface: 'metal', sound: 'metal' },
  explosiveBarrel: { name: 'Explosive Barrel', he: [0.28, 0.44, 0.28], mass: 20, build: () => BUILD.explosive(0.28, 0.88), hp: 22, explosive: true, surface: 'metal', sound: 'metal' },
  cinderBlock: { name: 'Cinder Block', he: [0.2, 0.1, 0.1], mass: 9, build: () => BUILD.cinder(), surface: 'concrete', sound: 'concrete' },
  bottle: { name: 'Bottle', he: [0.035, 0.12, 0.035], mass: 0.5, build: () => BUILD.bottle(), hp: 1, breakable: 'glass', surface: 'glass', sound: 'glass', radius: 0.03 },
  chair: { name: 'Chair', he: [0.22, 0.44, 0.21], mass: 5, build: () => BUILD.chair(), hp: 35, breakable: 'wood', surface: 'wood', sound: 'wood', centerY: 0.0 },
  table: { name: 'Table', he: [0.7, 0.38, 0.4], mass: 22, build: () => BUILD.table(), hp: 90, breakable: 'wood', surface: 'wood', sound: 'wood' },
  pallet: { name: 'Pallet', he: [0.55, 0.06, 0.5], mass: 10, build: () => BUILD.pallet(), hp: 40, breakable: 'wood', surface: 'wood', sound: 'wood' },
  ammoBox: { name: 'Ammo Box', he: [0.17, 0.09, 0.09], mass: 4, build: () => BUILD.ammoBox(), pickup: 'ammo', surface: 'metal', sound: 'metal' },
  medkit: { name: 'Medkit', he: [0.15, 0.06, 0.1], mass: 1.5, build: () => BUILD.medkit(), pickup: 'heal', surface: 'metal', sound: 'thud' },
  plank: { name: 'Plank', he: [0.25, 0.015, 0.05], mass: 0.8, build: () => BUILD.plank(), surface: 'wood', sound: 'wood', debris: true, radius: 0.014 },
};

const geoCache = new Map();
function propMesh(type) {
  if (!geoCache.has(type)) geoCache.set(type, mergeByMaterial(PROPS[type].build()));
  const src = geoCache.get(type);
  const g = new THREE.Group();
  for (const c of src.children) { const m = new THREE.Mesh(c.geometry, c.material); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

export class PropItem extends Item {
  constructor(type, pos, quat) {
    const def = PROPS[type];
    const mesh = propMesh(type);
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    const [hx, hy, hz] = def.he;
    const body = makeBoxBody(G.physics, pos.x, pos.y, pos.z, hx, hy, hz, def.mass, quat || null, 'prop', def.radius !== undefined ? def.radius : null);
    for (const p of body.particles) { p.friction = 0.6; p.bounce = def.surface === 'metal' ? 0.15 : 0.05; }
    super(body, mesh, { kind: 'prop', name: def.name, radius: Math.hypot(hx, hy, hz), impactSound: def.sound });
    this.type = type;
    this.def = def;
    this.hp = def.hp || Infinity;
    this.surface = def.surface;
    this.isDebris = !!def.debris;
    if (def.mass > 40) this.grabbable = true;
  }
  onStaticImpact(p, speed, box) {
    if (speed > 1.8 && G.time - (this._snd || 0) > 0.08) { this._snd = G.time; G.audio.play(this.def.sound, p, Math.min(1, speed / 8)); }
    if (this.def.breakable && speed > (this.def.breakable === 'glass' ? 3.5 : 8)) this.damage(speed * 4, p, 'impact');
    if (this.def.explosive && speed > 11) this.damage(speed * 2, p, 'impact');
  }
  onPairImpact(p, q, speed, nx, ny, nz) {
    super.onPairImpact(p, q, speed, nx, ny, nz);
    if (this.def.breakable === 'glass' && speed > 3) this.damage(10, p, 'impact');
  }
  onGrab(hand) {
    super.onGrab(hand);
    if (this.def.pickup === 'heal') {
      G.player.heal(50); G.audio.play('heal'); G.hud && G.hud.flash('+50 HEALTH');
      setTimeout(() => this.destroy(), 0);
    } else if (this.def.pickup === 'ammo') {
      const W = G.weapons;
      W.addReserve('pistol', 2); W.addReserve('rifle', 2); W.addReserve('shell', 8); W.addReserve('speedloader', 2);
      G.audio.play('magIn', this.position, 1); G.hud && G.hud.flash('AMMO RESUPPLIED');
      setTimeout(() => this.destroy(), 0);
    }
  }
  onBulletHit(pt, dir, damage, normal) {
    const dt = G.physics.dt;
    const k = damage * 0.1 / Math.max(0.5, this.mass);
    let best = null, bd = 1e9;
    for (const p of this.body.particles) { const d = Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z); if (d < bd) { bd = d; best = p; } }
    for (const p of this.body.particles) p.addVel(dir.x * k * 0.6, dir.y * k * 0.6, dir.z * k * 0.6, dt);
    if (best) best.addVel(dir.x * k * 2.5, dir.y * k * 2.5, dir.z * k * 2.5, dt);
    this.body.wake();
    G.fx.bulletImpact(pt, normal || dir.clone().negate(), this.surface);
    G.audio.play(this.def.sound === 'glass' ? 'glass' : this.def.sound, pt, 0.5);
    this.damage(damage, pt, 'bullet');
  }
  damage(amount, pt, kind) {
    if (this.dead || this.hp === Infinity) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      if (this.def.explosive) G.props.queueExplosion(this.position.clone(), 0.12, this);
      else this.breakApart(pt);
    } else if (this.def.explosive && kind === 'bullet') {
      // punctured: hissing fire jet then boom
      this.burning = Math.max(this.burning || 0, 1.5);
    }
  }
  breakApart(pt) {
    const c = this.position.clone();
    const v = this.body.velocity(new THREE.Vector3(), G.physics.dt);
    if (this.def.breakable === 'wood') {
      G.audio.play('woodBreak', c, 1);
      G.fx.woodBurst(c, 22);
      const n = this.type === 'crate' || this.type === 'table' ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), rand(0, 3)));
        const d = G.props.spawn('plank', _a.set(c.x + rand(-0.2, 0.2), c.y + rand(-0.1, 0.25), c.z + rand(-0.2, 0.2)), q);
        d.body.addVelocity(v.x + rand(-2, 2), v.y + rand(0.5, 3), v.z + rand(-2, 2), G.physics.dt);
        d.despawnAt = G.time + 10;
      }
    } else if (this.def.breakable === 'glass') {
      G.audio.play('glass', c, 0.8);
      G.fx.glassBurst(c, 24, v.clone().multiplyScalar(0.2));
    }
    this.destroy();
  }
  update(dt) {
    super.update(dt);
    if (this.burning > 0 && !this.dead) {
      this.burning -= dt;
      const p = this.position;
      G.fx.sparks.emit(p.x, p.y + 0.4, p.z, rand(-1, 1), rand(2, 4), rand(-1, 1), 0.4);
      if (Math.random() < 0.3) G.fx.smoke(_b.set(p.x, p.y + 0.5, p.z), 0.1, 0.5, 1, 0.3, null, 0x444444);
      if (this.burning <= 0) G.props.queueExplosion(p.clone(), 0, this);
    }
  }
}

// ---------- Hinged door ----------
export class Door extends Item {
  constructor(hinge, width, height, yaw, mat = Mat.woodDark) {
    const t = 0.05;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const center = new THREE.Vector3(width / 2, height / 2, 0).applyQuaternion(q).add(hinge);
    const mesh = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, height - 0.02, t), mat);
    panel.castShadow = true; panel.receiveShadow = true;
    mesh.add(panel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), Mat.steel);
    handle.position.set(width / 2 - 0.12, -height / 2 + 1.0, t / 2 + 0.03); mesh.add(handle);
    const h2 = handle.clone(); h2.position.z = -t / 2 - 0.03; mesh.add(h2);
    const inset = new THREE.Mesh(new THREE.BoxGeometry(width * 0.7, height * 0.3, t + 0.005), Mat.wood);
    inset.position.set(0, height * 0.18, 0);
    mesh.add(inset);
    mesh.position.copy(center); mesh.quaternion.copy(q);
    const body = makeBoxBody(null, center.x, center.y, center.z, width / 2, height / 2, t / 2, 30, q, 'door', 0.03);
    // hinge axis particles (pinned) rigidly linked to every corner
    const top = new Particle(hinge.x, hinge.y + height - 0.05, hinge.z, 0, 0.01);
    const bot = new Particle(hinge.x, hinge.y + 0.05, hinge.z, 0, 0.01);
    top.collide = bot.collide = false;
    body.add(top); body.add(bot);
    for (let i = 0; i < 8; i++) { body.link(top, body.particles[i], 1); body.link(bot, body.particles[i], 1); }
    body.damping = 0.97;
    for (const p of body.particles) p.friction = 0.2;
    G.physics.addBody(body);
    super(body, mesh, { kind: 'door', name: 'Door', impactSound: 'wood' });
    this.grabMode = 'particle';
    this.isDoor = true;
  }
  onStaticImpact(p, speed) { if (speed > 1.5 && G.time - (this._snd || 0) > 0.15) { this._snd = G.time; G.audio.play('wood', p, Math.min(1, speed / 4)); } }
  onBulletHit(pt, dir, damage, normal) {
    for (const p of this.body.particles) p.addVel(dir.x * 0.4, 0, dir.z * 0.4, G.physics.dt);
    this.body.wake();
    G.fx.bulletImpact(pt, normal, 'wood');
    G.audio.play('wood', pt, 0.5);
  }
}

// ---------- Pop-up steel target ----------
export class PopTarget extends Item {
  constructor(pos, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const w = 0.42, h = 0.62, t = 0.02;
    const center = new THREE.Vector3(0, h / 2 + 0.02, 0).applyQuaternion(q).add(pos);
    const mesh = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), Mat.paintedWhite.clone());
    plate.castShadow = true; mesh.add(plate);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 24), Mat.lightRed); ring.position.z = t / 2 + 0.002; ring.position.y = 0.08; mesh.add(ring);
    const ring2 = ring.clone(); ring2.rotation.y = Math.PI; ring2.position.z = -t / 2 - 0.002; mesh.add(ring2);
    mesh.position.copy(center); mesh.quaternion.copy(q);
    const body = makeBoxBody(null, center.x, center.y, center.z, w / 2, h / 2, t / 2, 12, q, 'target', 0.01);
    G.physics.addBody(body);
    super(body, mesh, { kind: 'target', name: 'Target', grabbable: false, impactSound: 'metal' });
    this.plate = plate;
    this.home = body.particles.map(p => [p.x, p.y, p.z]);
    this.masses = body.particles.map(p => p.invMass);
    this.down = false;
    this.downT = 0;
    this.pin(true);
    // stand
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.3), Mat.metal);
    pole.position.copy(pos).y += 0.02; pole.quaternion.copy(q); G.scene.add(pole);
    this.pole = pole;
  }
  pin(on) {
    const P = this.body.particles;
    P.forEach((p, i) => { p.invMass = on ? 0 : this.masses[i]; });
    if (!on) {
      // keep bottom edge as hinge
      for (let i = 0; i < 8; i++) if (!(i & 2)) P[i].invMass = 0;
    }
  }
  onBulletHit(pt, dir, damage, normal) {
    G.audio.play('clang', pt, 1);
    G.fx.sparkBurst(pt, normal, 8);
    this.plate.material.color.setHex(0xff6b4a);
    if (this.down) return;
    this.down = true; this.downT = 0;
    this.pin(false);
    for (let i = 0; i < 8; i++) if (this.body.particles[i].invMass > 0) this.body.particles[i].addVel(dir.x * 4, 0.5, dir.z * 4, G.physics.dt);
    this.body.wake();
    G.modes.onTargetHit && G.modes.onTargetHit(this);
  }
  reset() {
    this.down = false;
    this.body.particles.forEach((p, i) => p.setPos(...this.home[i]));
    this.pin(true);
    this.plate.material.color.setHex(0xffffff);
  }
  update(dt) {
    if (this.down) { this.downT += dt; if (this.downT > 2.5 && this.autoReset !== false) this.reset(); }
  }
  destroy() { super.destroy(); G.scene.remove(this.pole); }
}

// ---------- Glass pane (static until broken) ----------
export class GlassPane {
  constructor(min, max) {
    this.box = G.physics.addStatic(min, max, 'glass', { owner: this });
    this.box.seeThrough = true;
    const size = new THREE.Vector3().subVectors(max, min);
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), Mat.glass);
    this.mesh.position.addVectors(min, max).multiplyScalar(0.5);
    this.mesh.renderOrder = 2;
    G.scene.add(this.mesh);
    this.broken = false;
    this.center = this.mesh.position.clone();
    this.half = size.clone().multiplyScalar(0.5);
  }
  shatter(dir) {
    if (this.broken) return;
    this.broken = true;
    this.box.enabled = false;
    this.mesh.visible = false;
    G.audio.play('glass', this.center, 1.2);
    const n = Math.min(70, Math.floor(this.half.x * this.half.y * 120 + 20));
    for (let i = 0; i < n; i++) {
      const d = dir || { x: 0, z: 0 };
      G.fx.glass.emit(this.center.x + rand(-this.half.x, this.half.x), this.center.y + rand(-this.half.y, this.half.y), this.center.z + rand(-this.half.z, this.half.z), d.x * rand(0.5, 3) + rand(-0.6, 0.6), rand(-0.5, 1), d.z * rand(0.5, 3) + rand(-0.6, 0.6), rand(0.8, 1.6));
    }
  }
  onBulletHit(pt, dir) { this.shatter(dir); }
  onMeleeHit(pt, dmg) { if (dmg > 4) this.shatter(null); }
  check() {
    if (this.broken) return;
    const c = this.center, h = this.half;
    const r = Math.hypot(h.x, h.y, h.z) + 0.2;
    G.physics.queryParticles(c.x, c.y, c.z, r, (p) => {
      if (this.broken || p.invMass === 0) return;
      if (Math.abs(p.x - c.x) > h.x + p.radius + 0.03 || Math.abs(p.y - c.y) > h.y + p.radius + 0.03 || Math.abs(p.z - c.z) > h.z + p.radius + 0.03) return;
      const v = Math.hypot(p.x - p.px, p.y - p.py, p.z - p.pz) / G.physics.dt;
      if (v > 3) this.shatter({ x: (p.x - p.px), z: (p.z - p.pz) });
    });
    // player hands punching through
    for (const hd of G.player.hands) {
      const p = hd.pos;
      if (Math.abs(p.x - c.x) < h.x + 0.05 && Math.abs(p.y - c.y) < h.y + 0.05 && Math.abs(p.z - c.z) < h.z + 0.05 && hd.vel.length() > 2.5) this.shatter(hd.vel);
    }
  }
  remove() { G.scene.remove(this.mesh); }
}

// ---------- Manager ----------
export class PropManager {
  constructor() { this.glass = []; this.pending = []; this.targets = []; }
  spawn(type, pos, quat = null) {
    const p = new PropItem(type, pos.clone(), quat);
    if (PROPS[type].debris) this.capDebris();
    return p;
  }
  capDebris() {
    const debris = G.items.filter(i => i.isDebris);
    while (debris.length > Settings.maxDebris) debris.shift().destroy();
  }
  door(hinge, width, height, yaw, mat) { return new Door(hinge, width, height, yaw, mat); }
  target(pos, yaw) { const t = new PopTarget(pos, yaw); this.targets.push(t); return t; }
  glassPane(min, max) { const g = new GlassPane(min, max); this.glass.push(g); return g; }
  queueExplosion(pos, delay, source) {
    if (source) { if (source._exploding) return; source._exploding = true; }
    this.pending.push({ pos, t: delay, source });
  }
  explode(pos, radius = 5.5, power = 140) {
    G.fx.explosion(pos, radius);
    G.audio.play('explosion', pos, 1);
    G.physics.radialImpulse(pos.x, pos.y, pos.z, radius, 10);
    G.enemies.explosion(pos, radius, power);
    // player
    const pl = G.player;
    const d = pl.headPos.distanceTo(pos);
    if (d < radius) {
      const f = 1 - d / radius;
      pl.damage(power * 0.45 * f, pos);
      _a.subVectors(pl.headPos, pos).setY(0).normalize();
      pl.shove(_a.x * 7 * f, 3 * f, _a.z * 7 * f);
    }
    for (const it of [...G.items]) {
      if (it.dead || it._exploding) continue;
      const p = it.position;
      const dd = p.distanceTo(pos);
      if (dd < radius && it.damage) it.damage(power * (1 - dd / radius), p, 'explosion');
    }
    for (const g of this.glass) if (g.center.distanceTo(pos) < radius * 1.4) g.shatter({ x: g.center.x - pos.x, z: g.center.z - pos.z });
  }
  update(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const e = this.pending[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.pending.splice(i, 1);
        if (e.source && !e.source.dead) e.source.destroy();
        this.explode(e.pos);
      }
    }
    for (const g of this.glass) g.check();
  }
  clear() { for (const g of this.glass) g.remove(); this.glass.length = 0; this.pending.length = 0; this.targets.length = 0; }
}
