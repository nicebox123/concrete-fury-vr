// Weapons: firearms with physical reloading (magazines, speedloader, shells,
// slide racking, pump action) and velocity-driven melee weapons.
import * as THREE from 'three';
import { G, clamp, rand } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { Mat, SurfaceFX } from '../core/materials.js';
import { makeTriBody, makeBoxBody } from '../physics/verlet.js';
import { haptic } from '../core/audio.js';
import { Item, mergeByMaterial } from './items.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();

function box(w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function cyl(rt, rb, len, mat, x, y, z, rx = Math.PI / 2, ry = 0, rz = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m;
}
function bladeGeo(len, w, tipLen, curve = 0, thick = 0.004) {
  const s = new THREE.Shape();
  s.moveTo(0, -w * 0.45);
  s.lineTo(len - tipLen, -w * 0.45 - curve);
  s.quadraticCurveTo(len, -w * 0.3 - curve, len, w * 0.3);
  s.lineTo(len - tipLen * 1.4, w * 0.55);
  s.lineTo(0, w * 0.55);
  s.lineTo(0, -w * 0.45);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.PI / 2); // shape +x -> world -z
  return g;
}

// ---------------- Definitions ----------------
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Pistol', kind: 'gun', mass: 0.9, follow: 45, holster: ['small'], len: 0.2, radius: 0.035,
    damage: 34, dv: 3.2, fireDelay: 0.11, auto: false, pellets: 1, spread: 0.004, recoil: 0.16, recoilBack: 0.03, sound: 'gunPistol',
    reload: 'mag', ammo: 'pistol', magSize: 12, reloadTime: 1.1, muzzle: V(0, 0.055, -0.165), magwell: V(0, -0.075, 0.03), rack: V(0, 0.058, 0.03), eject: V(0.02, 0.06, -0.03),
    melee: { a: V(0, 0.03, 0.0), b: V(0, 0.05, -0.17), radius: 0.03, dmg: 10, sharp: false }, sightHeight: 0.065,
  },
  revolver: {
    id: 'revolver', name: 'Revolver', kind: 'gun', mass: 1.3, follow: 36, holster: ['small'], len: 0.25, radius: 0.035,
    damage: 70, dv: 6, fireDelay: 0.32, auto: false, pellets: 1, spread: 0.003, recoil: 0.45, recoilBack: 0.05, sound: 'gunRevolver', heavy: true,
    reload: 'cylinder', ammo: 'speedloader', magSize: 6, reloadTime: 1.8, muzzle: V(0, 0.058, -0.225), cylinder: V(0, 0.042, -0.035),
    melee: { a: V(0, 0.03, 0.0), b: V(0, 0.06, -0.22), radius: 0.03, dmg: 12, sharp: false }, sightHeight: 0.07,
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Shotgun', kind: 'gun', mass: 3.4, follow: 22, holster: ['long'], twoHanded: true, len: 0.95, radius: 0.04,
    damage: 18, dv: 2.6, fireDelay: 0.25, auto: false, pellets: 9, spread: 0.055, recoil: 0.5, recoilBack: 0.08, sound: 'gunShotgun',
    reload: 'shell', ammo: 'shell', magSize: 6, reloadTime: 0.5, muzzle: V(0, 0.05, -0.72), secondary: V(0, 0.022, -0.34), port: V(0, 0.0, -0.06),
    melee: { a: V(0, 0.03, -0.1), b: V(0, 0.05, -0.7), radius: 0.035, dmg: 16, sharp: false }, sightHeight: 0.07,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', kind: 'gun', mass: 3.2, follow: 24, holster: ['long'], twoHanded: true, len: 0.9, radius: 0.04,
    damage: 32, dv: 3.6, fireDelay: 0.095, auto: true, pellets: 1, spread: 0.008, recoil: 0.07, recoilBack: 0.025, sound: 'gunRifle', pierce: true,
    reload: 'mag', ammo: 'rifle', magSize: 30, reloadTime: 1.6, muzzle: V(0, 0.035, -0.64), magwell: V(0, -0.1, -0.11), secondary: V(0, 0.03, -0.3), rack: V(0, 0.072, 0.07), eject: V(0.025, 0.04, -0.08),
    melee: { a: V(0, 0.03, 0.15), b: V(0, 0.04, -0.6), radius: 0.035, dmg: 15, sharp: false }, sightHeight: 0.085,
  },
  knife: {
    id: 'knife', name: 'Combat Knife', kind: 'melee', mass: 0.35, follow: 55, holster: ['small'], len: 0.3, radius: 0.025, gripPitch: 0.25,
    melee: { a: V(0, 0, -0.04), b: V(0, 0.003, -0.21), radius: 0.02, dmg: 24, sharp: true, minSpeed: 1.6 }, swing: 'stab',
  },
  machete: {
    id: 'machete', name: 'Machete', kind: 'melee', mass: 0.8, follow: 38, holster: ['small', 'long'], len: 0.6, radius: 0.025, gripPitch: 0.35,
    melee: { a: V(0, 0, -0.08), b: V(0, 0.005, -0.52), radius: 0.025, dmg: 30, sharp: true, minSpeed: 2.2 }, swing: 'h',
  },
  bat: {
    id: 'bat', name: 'Baseball Bat', kind: 'melee', mass: 1.0, follow: 30, holster: ['long'], len: 0.85, radius: 0.04, gripPitch: 0.4, secondary: V(0, 0, -0.14),
    melee: { a: V(0, 0, -0.25), b: V(0, 0, -0.72), radius: 0.04, dmg: 22, sharp: false, minSpeed: 2.2 }, swing: 'h',
  },
  sledgehammer: {
    id: 'sledgehammer', name: 'Sledgehammer', kind: 'melee', mass: 5.0, follow: 8, holster: ['long'], len: 0.95, radius: 0.05, gripPitch: 0.45, twoHanded: true, secondary: V(0, 0, -0.42),
    melee: { a: V(0, 0, -0.74), b: V(0, 0, -0.9), radius: 0.075, dmg: 48, sharp: false, minSpeed: 2.0, heavy: true }, swing: 'v',
  },
};

function buildModel(def) {
  const g = new THREE.Group();
  const parts = {};
  const keep = (m, name) => { m.userData.keep = true; parts[name] = m; m.userData.base = m.position.clone(); m.userData.baseRot = m.rotation.clone(); return m; };
  switch (def.id) {
    case 'pistol': {
      g.add(box(0.026, 0.024, 0.17, Mat.polymer, 0, 0.028, -0.06));
      g.add(box(0.029, 0.112, 0.044, Mat.polymer, 0, -0.03, 0.018, -0.26));
      g.add(box(0.006, 0.006, 0.055, Mat.polymer, 0, -0.004, -0.03));
      g.add(box(0.006, 0.028, 0.006, Mat.polymer, 0, 0.008, -0.058));
      g.add(box(0.004, 0.018, 0.006, Mat.steel, 0, 0.008, -0.02, 0.3));
      const slide = new THREE.Group();
      slide.add(box(0.03, 0.034, 0.188, Mat.gunmetal, 0, 0, 0));
      slide.add(box(0.008, 0.008, 0.008, Mat.black, 0, 0.021, -0.088));
      slide.add(box(0.016, 0.008, 0.008, Mat.black, 0, 0.021, 0.088));
      for (let i = 0; i < 5; i++) slide.add(box(0.031, 0.026, 0.003, Mat.black, 0, 0, 0.06 + i * 0.006));
      slide.position.set(0, 0.055, -0.065);
      g.add(cyl(0.0065, 0.0065, 0.01, Mat.black, 0, 0.055, -0.16));
      // the slide is a group; merge its children first
      const sm = mergeByMaterial(slide); sm.position.copy(slide.position);
      g.add(keep(sm, 'slide'));
      g.add(keep(box(0.022, 0.1, 0.034, Mat.gunmetal, 0, -0.035, 0.02, -0.26), 'mag'));
      break;
    }
    case 'revolver': {
      g.add(box(0.028, 0.052, 0.085, Mat.steel, 0, 0.04, -0.035));
      g.add(cyl(0.011, 0.011, 0.155, Mat.steel, 0, 0.058, -0.15));
      g.add(cyl(0.006, 0.006, 0.13, Mat.steel, 0, 0.038, -0.14));
      g.add(box(0.004, 0.012, 0.004, Mat.steel, 0, 0.072, -0.22));
      g.add(box(0.03, 0.105, 0.044, Mat.gripWood, 0, -0.03, 0.035, -0.32));
      g.add(box(0.006, 0.006, 0.05, Mat.steel, 0, 0.0, -0.02));
      g.add(box(0.008, 0.02, 0.012, Mat.steel, 0, 0.07, 0.012, -0.5));
      const cylG = new THREE.Group();
      cylG.add(cyl(0.021, 0.021, 0.05, Mat.steel, 0, 0, 0));
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cylG.add(cyl(0.0045, 0.0045, 0.051, Mat.black, Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0)); }
      const cm = mergeByMaterial(cylG); cm.position.set(0, 0.042, -0.035);
      g.add(keep(cm, 'cylinder'));
      break;
    }
    case 'shotgun': {
      g.add(box(0.045, 0.06, 0.2, Mat.gunmetal, 0, 0.03, -0.06));
      g.add(cyl(0.012, 0.012, 0.56, Mat.gunmetal, 0, 0.05, -0.44));
      g.add(cyl(0.011, 0.011, 0.44, Mat.gunmetal, 0, 0.022, -0.38));
      g.add(box(0.004, 0.01, 0.004, Mat.steel, 0, 0.066, -0.7));
      g.add(box(0.036, 0.085, 0.06, Mat.gripWood, 0, -0.02, 0.05, -0.35));
      g.add(box(0.04, 0.075, 0.28, Mat.gripWood, 0, -0.025, 0.22, 0.12));
      g.add(box(0.044, 0.09, 0.02, Mat.rubber, 0, -0.045, 0.36, 0.12));
      g.add(box(0.006, 0.006, 0.05, Mat.gunmetal, 0, -0.008, -0.01));
      const pump = new THREE.Group();
      pump.add(cyl(0.023, 0.023, 0.16, Mat.polymer, 0, 0, 0, Math.PI / 2, 0, 0, 10));
      for (let i = 0; i < 6; i++) pump.add(cyl(0.0235, 0.0235, 0.006, Mat.black, 0, 0, -0.06 + i * 0.024, Math.PI / 2, 0, 0, 10));
      const pm = mergeByMaterial(pump); pm.position.set(0, 0.022, -0.34);
      g.add(keep(pm, 'pump'));
      break;
    }
    case 'rifle': {
      g.add(box(0.04, 0.07, 0.3, Mat.gunmetal, 0, 0.03, -0.06));
      g.add(box(0.05, 0.056, 0.26, Mat.polymer, 0, 0.034, -0.32));
      for (let i = 0; i < 5; i++) g.add(box(0.052, 0.01, 0.025, Mat.black, 0, 0.034, -0.22 - i * 0.05));
      g.add(cyl(0.0095, 0.0095, 0.2, Mat.gunmetal, 0, 0.035, -0.54));
      g.add(cyl(0.014, 0.014, 0.05, Mat.black, 0, 0.035, -0.62));
      g.add(box(0.038, 0.075, 0.24, Mat.polymer, 0, 0.005, 0.24, 0.05));
      g.add(box(0.03, 0.105, 0.04, Mat.polymer, 0, -0.04, 0.03, -0.3));
      g.add(box(0.012, 0.03, 0.2, Mat.gunmetal, 0, 0.08, -0.06));
      g.add(box(0.03, 0.025, 0.035, Mat.black, 0, 0.1, -0.03));
      g.add(box(0.006, 0.006, 0.05, Mat.gunmetal, 0, -0.012, -0.0));
      g.add(keep(box(0.028, 0.15, 0.058, Mat.gunmetal, 0, -0.065, -0.115, 0.18), 'mag'));
      g.add(keep(box(0.035, 0.012, 0.022, Mat.black, 0, 0.068, 0.075), 'charge'));
      break;
    }
    case 'knife': {
      g.add(cyl(0.013, 0.015, 0.11, Mat.rubber, 0, 0, 0.025));
      g.add(box(0.05, 0.012, 0.012, Mat.steel, 0, 0, -0.033));
      g.add(cyl(0.016, 0.016, 0.012, Mat.steel, 0, 0, 0.083));
      const blade = new THREE.Mesh(bladeGeo(0.17, 0.03, 0.05), Mat.blade.clone());
      blade.position.set(0, 0.002, -0.038);
      g.add(keep(blade, 'blade'));
      break;
    }
    case 'machete': {
      g.add(cyl(0.015, 0.016, 0.13, Mat.woodDark, 0, 0, 0.03));
      g.add(box(0.012, 0.03, 0.012, Mat.steel, 0, 0, -0.036));
      const blade = new THREE.Mesh(bladeGeo(0.46, 0.05, 0.12, 0.008, 0.003), Mat.blade.clone());
      blade.position.set(0, 0.004, -0.04);
      g.add(keep(blade, 'blade'));
      break;
    }
    case 'bat': {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.019, 0.72, 14), Mat.batWood.clone());
      b.geometry.rotateX(-Math.PI / 2); b.position.set(0, 0, -0.3);
      g.add(keep(b, 'blade'));
      g.add(cyl(0.02, 0.02, 0.2, Mat.tape, 0, 0, 0.0));
      g.add(cyl(0.028, 0.024, 0.03, Mat.batWood, 0, 0, 0.1));
      break;
    }
    case 'sledgehammer': {
      g.add(cyl(0.017, 0.019, 0.9, Mat.woodDark, 0, 0, -0.38));
      g.add(cyl(0.02, 0.02, 0.14, Mat.tape, 0, 0, 0.0));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.2), Mat.steel.clone());
      head.position.set(0, 0, -0.83); head.rotation.y = Math.PI / 2;
      g.add(keep(head, 'blade'));
      break;
    }
  }
  const merged = mergeByMaterial(g);
  merged.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: merged, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, merged.children.find(c => c === v) || v])) };
}

export class WeaponItem extends Item {
  constructor(def, pos, quat) {
    const { group, parts } = buildModel(def);
    group.position.copy(pos);
    if (quat) group.quaternion.copy(quat);
    group.updateMatrixWorld(true);
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
    const back = L(0, 0.0, 0.06), front = L(0, 0.02, -def.len * 0.85), up = L(0, 0.1, 0);
    const body = makeTriBody(G.physics, back, front, up, def.mass, def.radius, 'item');
    body.damping = 0.997;
    for (const p of body.particles) { p.friction = 0.7; p.bounce = 0.15; }
    const H = new THREE.Matrix4().makeRotationX(def.gripPitch || 0);
    super(body, group, {
      kind: 'weapon', name: def.name, follow: def.follow, holdMatrix: H,
      secondaryLocal: def.secondary || null, twoHanded: def.twoHanded, holsterable: def.holster,
      radius: Math.max(0.12, def.len * 0.4), impactSound: def.kind === 'melee' && def.melee.sharp ? 'metal' : 'thud',
    });
    this.def = def;
    this.parts = parts;
    this.isGun = def.kind === 'gun';
    this.isMelee = def.kind === 'melee';
    this.grabRadius = 0.06;
    this.muzzleLocal = def.muzzle || null;
    this.rackLocal = def.rack || null;
    this.sightHeight = def.sightHeight;
    this.bloodiness = 0;
    this.meleeCd = new Map();
    this.prevA = new THREE.Vector3(); this.prevB = new THREE.Vector3();
    this.curA = new THREE.Vector3(); this.curB = new THREE.Vector3();
    this.havePrev = false;
    this.staticCd = 0;
    this.fireT = 0;
    // ammo state
    if (this.isGun) {
      this.mag = def.reload === 'mag' ? { rounds: def.magSize } : null;
      this.chambered = true;
      this.slideLocked = false;
      this.cyl = def.reload === 'cylinder' ? new Array(6).fill(1) : null;
      this.cylIndex = 0;
      this.cylOpen = false;
      this.tube = def.reload === 'shell' ? def.magSize - 1 : 0;
      this.needPump = false;
      this.pumpState = 0;
      this.rackArmed = false;
      this.desktopReloadT = -1;
    }
    if (def.holster && def.holster.includes('long')) this.holsterOffset = new THREE.Matrix4().makeTranslation(0, 0, def.len * 0.3);
    else this.holsterOffset = new THREE.Matrix4().makeTranslation(0, 0, 0.05);
    this.showHand = true;
  }

  muzzleWorld(out) { return out.copy(this.muzzleLocal || V(0, 0, -this.def.len)).applyMatrix4(this.worldMatrix(_m)); }
  muzzleDir(out) { return out.set(0, 0, -1).transformDirection(this.worldMatrix(_m)); }
  localToWorld(v, out) { return out.copy(v).applyMatrix4(this.worldMatrix(_m)); }

  segmentWorld() {
    const me = this.def.melee;
    this.worldMatrix(_m);
    return [this.curA.copy(me.a).applyMatrix4(_m), this.curB.copy(me.b).applyMatrix4(_m)];
  }

  // ---------- Firing ----------
  canFire() {
    if (this.def.reload === 'cylinder') return !this.cylOpen && this.cyl[this.cylIndex] === 1;
    if (this.def.reload === 'shell') return this.chambered && !this.needPump;
    return this.chambered;
  }

  onTrigger(hand, down, pressed) {
    if (!this.isGun) return;
    this.fireT -= G.dt;
    if (this.desktopReloadT >= 0) return;
    const want = this.def.auto ? down : pressed;
    if (!want || this.fireT > 0) return;
    this.fireT = this.def.fireDelay;
    if (this.def.reload === 'cylinder' && !this.cylOpen) {
      // double action: cylinder advances every pull
      const loaded = this.cyl[this.cylIndex] === 1;
      if (loaded) { this.cyl[this.cylIndex] = 2; this.fire(hand); }
      else G.audio.play('dryFire', this.position, 1);
      this.cylIndex = (this.cylIndex + 1) % 6;
      if (this.parts.cylinder) this.parts.cylinder.rotation.z += Math.PI / 3;
      return;
    }
    if (!this.canFire()) { G.audio.play('dryFire', this.position, 1); haptic(hand.gamepad, 0.1, 15); return; }
    this.fire(hand);
    // cycle action
    if (this.def.reload === 'mag') {
      if (this.mag && this.mag.rounds > 0) { this.mag.rounds--; this.chambered = true; }
      else { this.chambered = false; this.slideLocked = true; }
      this.ejectCasing(false);
      this.slideKick = 1;
    } else if (this.def.reload === 'shell') {
      this.needPump = true; this.chambered = false; this.spentInChamber = true;
      if (!G.isVR) this.autoPumpT = 0.38;
    }
  }

  fire(hand) {
    const def = this.def;
    const o = this.muzzleWorld(new THREE.Vector3());
    const dir0 = this.muzzleDir(new THREE.Vector3());
    G.stats.shots++;
    this.fireFX(o, dir0);
    G.audio.play(def.sound, o, 1);
    this.recoilRot = (this.recoilRot || 0) + def.recoil * (this.secondaryHand ? 0.55 : 1);
    this.recoilBack = (this.recoilBack || 0) + def.recoilBack;
    if (!G.isVR) G.player.desk.recoilPitch += def.recoil * 0.12;
    if (hand) { haptic(hand.gamepad, Math.min(1, 0.4 + def.recoil), 60); if (this.secondaryHand) haptic(this.secondaryHand.gamepad, 0.5, 50); }
    // alert nearby enemies
    for (const e of G.enemies.list) {
      if (!e.alive) continue;
      if (Math.hypot(e.root.x - o.x, e.root.z - o.z) < 28) { e.ai.seenOnce = true; e.ai.lastSeen.copy(G.player.headPos); }
    }
    let hitAny = false;
    for (let i = 0; i < def.pellets; i++) {
      const dir = dir0.clone();
      if (def.spread > 0) { dir.x += rand(-1, 1) * def.spread; dir.y += rand(-1, 1) * def.spread; dir.z += rand(-1, 1) * def.spread; dir.normalize(); }
      if (this.traceShot(o, dir, def.damage, def.pellets > 1 ? 'pellet' : 'bullet', def.pierce ? 1 : 0)) hitAny = true;
    }
    if (hitAny) G.stats.hits++;
  }

  // returns true if an enemy was hit
  traceShot(o, dir, damage, kind, pierce, ignore = null) {
    const hs = G.physics.raycastStatic(o, dir, 80);
    let maxD = hs ? hs.dist : 80;
    const eh = G.enemies.raycast(o, dir, maxD, ignore);
    // dynamic props (OBB items)
    let ph = null, phD = eh ? eh.dist : maxD;
    const n = new THREE.Vector3();
    for (const it of G.items) {
      if (it === this || it.heldBy || !it.body.obb || it.holster) continue;
      const c = it.position;
      _a.subVectors(c, o); const t = _a.dot(dir);
      if (t < 0 || t > phD + 1) continue;
      if (_a.addScaledVector(dir, -t).length() > it.body.bRadius + 0.1) continue;
      const d = G.physics.rayOBB(it.body, o, dir, phD, n);
      if (d >= 0 && d < phD) { phD = d; ph = { item: it, dist: d, normal: n.clone() }; }
    }
    let endD = maxD, enemyHit = false;
    if (ph) {
      endD = ph.dist;
      const pt = o.clone().addScaledVector(dir, ph.dist);
      ph.item.onBulletHit ? ph.item.onBulletHit(pt, dir, damage, ph.normal) : this.pushItem(ph.item, pt, dir, damage);
    } else if (eh) {
      endD = eh.dist;
      enemyHit = true;
      const dmg = damage;
      eh.enemy.hit(eh.bone, eh.point, dir.clone().multiplyScalar(this.def.dv * (kind === 'pellet' ? 1 : 1)), dmg, kind, { heavy: this.def.heavy });
      if (pierce > 0) {
        const o2 = eh.point.clone().addScaledVector(dir, 0.35);
        this.traceShot(o2, dir, damage * 0.5, kind, pierce - 1, eh.enemy);
      }
    } else if (hs) {
      const mat = hs.box.material;
      G.fx.bulletImpact(hs.point, hs.normal, mat);
      const sfx = (SurfaceFX[mat] || SurfaceFX.concrete).sound;
      G.audio.play(sfx === 'metal' ? 'metal' : sfx, hs.point, 0.35);
      if (hs.box.owner && hs.box.owner.onBulletHit) hs.box.owner.onBulletHit(hs.point, dir, damage, hs.normal);
    }
    if (Math.random() < (kind === 'pellet' ? 0.25 : 0.8)) G.fx.tracer(o.clone().addScaledVector(dir, 0.1), o.clone().addScaledVector(dir, endD));
    return enemyHit;
  }

  pushItem(it, pt, dir, damage) {
    const dt = G.physics.dt;
    let best = null, bd = Infinity;
    for (const p of it.body.particles) { const d = Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z); if (d < bd) { bd = d; best = p; } }
    const k = damage * 0.12 / Math.max(0.3, it.mass);
    for (const p of it.body.particles) p.addVel(dir.x * k * 0.5, dir.y * k * 0.5, dir.z * k * 0.5, dt);
    if (best) best.addVel(dir.x * k * 2, dir.y * k * 2, dir.z * k * 2, dt);
    it.body.wake();
    G.fx.bulletImpact(pt, dir.clone().negate(), it.surface || 'metal');
    if (it.damage) it.damage(damage, pt, 'bullet');
  }

  fireFX(o, dir) {
    _q.setFromUnitVectors(V(0, 0, -1), dir);
    G.fx.muzzleFlash(o, _q, this.def.pellets > 1 ? 1.5 : this.def.id === 'revolver' ? 1.3 : 1);
    if (this.enemyHolder && this.def.reload === 'mag') this.ejectCasing(false);
  }

  ejectCasing(shell) {
    const loc = this.def.eject || this.def.port || V(0.02, 0.05, -0.05);
    this.worldMatrix(_m);
    const p = loc.clone().applyMatrix4(_m);
    const right = V(1, 0, 0).transformDirection(_m), up = V(0, 1, 0).transformDirection(_m);
    const v = right.multiplyScalar(rand(1.5, 2.6)).addScaledVector(up, rand(1, 2));
    if (this.heldBy) v.add(this.heldBy.vel);
    G.fx.casing(p, v, shell);
  }

  // ---------- Reloading (VR) ----------
  onButtonA(hand) {
    if (!this.isGun) return;
    const def = this.def;
    if (def.reload === 'mag' && this.mag) {
      // drop the magazine
      const p = this.localToWorld(def.magwell, new THREE.Vector3());
      const m = G.weapons.spawnAmmo(def.ammo, p, this.mag.rounds, this.worldQuat());
      if (m) m.body.addVelocity(0, -1.2, 0, G.physics.dt);
      this.mag = null;
      G.audio.play('magOut', p, 1);
      haptic(hand.gamepad, 0.2, 20);
    } else if (def.reload === 'cylinder') this.toggleCylinder();
  }
  onButtonB(hand) {
    if (!this.isGun) return;
    const def = this.def;
    if (def.reload === 'mag') this.rackSlide(true);
    else if (def.reload === 'cylinder') { if (this.cylOpen) this.toggleCylinder(); }
    else if (def.reload === 'shell') this.pumpCycle();
  }

  worldQuat() { this.worldMatrix(_m); return new THREE.Quaternion().setFromRotationMatrix(_m); }

  rackSlide(fromButton) {
    if (this.chambered && !this.slideLocked && fromButton) {
      // eject a live round
      if (this.mag && this.mag.rounds > 0) { this.mag.rounds--; this.ejectCasing(false); }
      else return;
    }
    if (this.mag && this.mag.rounds > 0) {
      if (!this.chambered) this.mag.rounds--;
      this.chambered = true;
    }
    this.slideLocked = false;
    G.audio.play('rack', this.position, 1);
  }
  onRack(disp) {
    const slide = this.parts.slide || this.parts.charge;
    if (!slide) return;
    const d = clamp(disp, 0, 0.05);
    slide.position.z = slide.userData.base.z + d;
    if (d > 0.035 && !this.rackArmed) { this.rackArmed = true; if (this.chambered) { this.chambered = false; this.ejectCasing(false); } G.audio.play('magOut', this.position, 0.5); }
    if (this.rackArmed && d < 0.012) { this.rackArmed = false; this.chamberFromMag(); }
  }
  onRackRelease() {
    if (this.rackArmed) { this.rackArmed = false; this.chamberFromMag(); }
  }
  chamberFromMag() {
    if (this.mag && this.mag.rounds > 0) { this.mag.rounds--; this.chambered = true; }
    this.slideLocked = false;
    G.audio.play('rack', this.position, 1);
  }

  onSecondaryMove(disp, hand) {
    if (this.def.reload !== 'shell') return;
    const pump = this.parts.pump;
    const d = clamp(disp, 0, 0.09);
    if (pump) pump.position.z = pump.userData.base.z + d;
    if (this.pumpState === 0 && d > 0.07) { this.pumpState = 1; this.pumpBack(); }
    else if (this.pumpState === 1 && d < 0.02) { this.pumpState = 0; this.pumpForward(); }
  }
  onSecondaryRelease() { if (this.parts.pump) this.parts.pump.position.z = this.parts.pump.userData.base.z; if (this.pumpState === 1) { this.pumpState = 0; this.pumpForward(); } }
  pumpBack() {
    if (this.spentInChamber || this.chambered) { this.ejectCasing(true); this.spentInChamber = false; this.chambered = false; }
    G.audio.play('pump', this.position, 1);
  }
  pumpForward() {
    if (this.tube > 0) { this.tube--; this.chambered = true; }
    this.needPump = false;
  }
  pumpCycle() { this.pumpBack(); this.pumpForward(); }

  toggleCylinder() {
    this.cylOpen = !this.cylOpen;
    const c = this.parts.cylinder;
    if (c) { c.position.x = c.userData.base.x + (this.cylOpen ? -0.03 : 0); c.rotation.y = this.cylOpen ? -0.6 : 0; }
    G.audio.play('cylinder', this.position, 1);
    if (this.cylOpen) {
      // spent casings fall out
      for (let i = 0; i < 6; i++) if (this.cyl[i] === 2) { this.cyl[i] = 0; this.ejectCasingDown(); }
    }
  }
  ejectCasingDown() {
    const p = this.localToWorld(this.def.cylinder, new THREE.Vector3());
    G.fx.casing(p, V(rand(-0.3, 0.3), -0.5, rand(-0.3, 0.3)), false);
  }

  ammoInfo() {
    const d = this.def;
    if (d.reload === 'mag') return `${(this.chambered ? 1 : 0) + (this.mag ? this.mag.rounds : 0)}${this.mag ? '' : ' (no mag)'}`;
    if (d.reload === 'cylinder') return `${this.cyl.filter(c => c === 1).length}/6${this.cylOpen ? ' (open)' : ''}`;
    return `${this.tube + (this.chambered ? 1 : 0)}${this.needPump ? ' (pump)' : ''}`;
  }

  // Desktop reload: timed
  desktopReload() {
    if (!this.isGun || this.desktopReloadT >= 0) return;
    const d = this.def;
    const res = G.weapons.reserve(d.ammo);
    if (res <= 0) { G.audio.play('dryFire', this.position, 1); return; }
    if (d.reload === 'mag' && this.mag && this.mag.rounds >= d.magSize) return;
    if (d.reload === 'shell' && this.tube >= d.magSize) return;
    if (d.reload === 'cylinder' && this.cyl.every(c => c === 1)) return;
    this.desktopReloadT = d.reloadTime;
    G.audio.play(d.reload === 'mag' ? 'magOut' : d.reload === 'cylinder' ? 'cylinder' : 'shellIn', this.position, 1);
  }
  updateDesktopReload(dt) {
    if (this.desktopReloadT < 0) return;
    this.desktopReloadT -= dt;
    this.recoilRot = Math.max(this.recoilRot || 0, -0.0);
    const d = this.def;
    if (this.desktopReloadT <= 0) {
      this.desktopReloadT = -1;
      if (d.reload === 'mag') {
        const need = d.magSize - (this.mag ? this.mag.rounds : 0);
        const got = G.weapons.takeReserve(d.ammo, d.ammo === 'pistol' || d.ammo === 'rifle' ? 1 : need);
        if (got > 0) {
          if (this.mag) this.spawnDroppedMag();
          this.mag = { rounds: d.magSize };
          if (!this.chambered) { this.mag.rounds--; this.chambered = true; }
          this.slideLocked = false;
          G.audio.play('magIn', this.position, 1);
          setTimeout(() => G.audio.play('rack', this.position, 1), 150);
        }
      } else if (d.reload === 'cylinder') {
        if (G.weapons.takeReserve('speedloader', 1)) { this.cyl.fill(1); for (let i = 0; i < 6; i++) this.ejectCasingDown(); G.audio.play('cylinder', this.position, 1); }
      } else if (d.reload === 'shell') {
        if (G.weapons.takeReserve('shell', 1)) {
          this.tube++;
          G.audio.play('shellIn', this.position, 1);
          if (!this.chambered && !this.needPump) { this.pumpCycle(); }
          if (this.tube < d.magSize && G.weapons.reserve('shell') > 0) this.desktopReloadT = d.reloadTime;
          else if (!this.chambered) this.pumpCycle();
        }
      }
    }
  }
  spawnDroppedMag() {
    const p = this.localToWorld(this.def.magwell, new THREE.Vector3());
    const m = G.weapons.spawnAmmo(this.def.ammo, p, 0, this.worldQuat());
    if (m) m.despawnAt = G.time + 8;
  }

  // ---------- Thrown impact ----------
  impactProfile(speed, v, itemP) {
    const me = this.def.melee;
    if (me && me.sharp && speed > 4.5) {
      // blade-first?
      const P = this.body.particles;
      const bladeDir = _a.set(P[1].x - P[0].x, P[1].y - P[0].y, P[1].z - P[0].z).normalize();
      if (bladeDir.dot(_b.copy(v).normalize()) > 0.55 && itemP === P[1]) return { damage: me.dmg * 1.8, kind: 'stab' };
      return { damage: me.dmg * 0.6, kind: 'cut' };
    }
    return { damage: this.mass * speed * (me && me.heavy ? 3 : 1.6), kind: 'blunt' };
  }

  // ---------- Per frame ----------
  update(dt) {
    super.update(dt);
    if (this.dead) return;
    // blood on blades fades slowly
    if (this.bloodiness > 0) {
      this.bloodiness = Math.max(0, this.bloodiness - dt * 0.006);
      const blade = this.parts.blade;
      if (blade && blade.material) {
        if (!blade.userData.baseColor) blade.userData.baseColor = blade.material.color.clone();
        blade.material.color.copy(blade.userData.baseColor).lerp(BLOOD, this.bloodiness * 0.85);
        blade.material.roughness = 0.2 + this.bloodiness * 0.4;
      }
    }
    if (!this.isGun) { if (this.heldBy) this.meleeUpdate(dt); else this.havePrev = false; return; }
    // slide visuals
    const slide = this.parts.slide;
    if (slide && !(this.secondaryHand && this.secondaryHand.held && this.secondaryHand.held.kind === 'rack')) {
      this.slideKick = Math.max(0, (this.slideKick || 0) - dt * 25);
      slide.position.z = slide.userData.base.z + (this.slideLocked ? 0.04 : this.slideKick * 0.035);
    }
    if (this.parts.mag) this.parts.mag.visible = !!this.mag;
    if (this.autoPumpT > 0) { this.autoPumpT -= dt; if (this.autoPumpT <= 0) this.pumpCycle(); }
    this.updateDesktopReload(dt);
    if (this.heldBy) {
      this.checkAmmoInsert();
      this.meleeUpdate(dt); // pistol whip
    } else this.havePrev = false;
  }

  checkAmmoInsert() {
    const other = this.heldBy.other;
    const ammo = other.heldItem;
    if (!ammo || !ammo.isAmmo) return;
    const def = this.def;
    const ap = ammo.position;
    if (def.reload === 'mag' && !this.mag && ammo.ammoType === def.ammo) {
      const mw = this.localToWorld(def.magwell, _c);
      if (mw.distanceTo(ap) < 0.11) {
        this.mag = { rounds: ammo.rounds };
        ammo.destroy();
        G.audio.play('magIn', mw, 1);
        haptic(this.heldBy.gamepad, 0.4, 30); haptic(other.gamepad, 0.4, 30);
      }
    } else if (def.reload === 'shell' && ammo.ammoType === 'shell' && this.tube < def.magSize) {
      const pp = this.localToWorld(def.port, _c);
      if (pp.distanceTo(ap) < 0.12) {
        this.tube++;
        ammo.destroy();
        G.audio.play('shellIn', pp, 1);
        haptic(other.gamepad, 0.3, 20);
      }
    } else if (def.reload === 'cylinder' && ammo.ammoType === 'speedloader' && this.cylOpen) {
      const cp = this.localToWorld(def.cylinder, _c);
      if (cp.distanceTo(ap) < 0.12) {
        for (let i = 0; i < 6; i++) if (this.cyl[i] !== 1) this.cyl[i] = 1;
        ammo.destroy();
        G.audio.play('shellIn', cp, 1);
        haptic(other.gamepad, 0.3, 20);
      }
    }
  }

  // Velocity-based melee damage along the weapon's strike segment
  meleeUpdate(dt) {
    const me = this.def.melee;
    if (!me) return;
    this.worldMatrix(_m);
    this.curA.copy(me.a).applyMatrix4(_m);
    this.curB.copy(me.b).applyMatrix4(_m);
    if (!this.havePrev) { this.prevA.copy(this.curA); this.prevB.copy(this.curB); this.havePrev = true; return; }
    const vB = _b.subVectors(this.curB, this.prevB).divideScalar(Math.max(dt, 1e-4));
    const speed = vB.length();
    const minSpeed = me.minSpeed || 2.4;
    if (speed > minSpeed) {
      const hits = G.enemies.segmentHits(this.curA, this.curB, me.radius);
      for (const h of hits) {
        const last = this.meleeCd.get(h.enemy) || 0;
        if (G.time - last < 0.3) continue;
        this.meleeCd.set(h.enemy, G.time);
        const point = new THREE.Vector3().lerpVectors(this.curA, this.curB, h.s);
        const vPoint = new THREE.Vector3().subVectors(this.curA, this.prevA).divideScalar(dt).lerp(vB, h.s);
        const sp = vPoint.length();
        if (sp < minSpeed * 0.8) continue;
        const dir = vPoint.clone().normalize();
        const bladeDir = _a.subVectors(this.curB, this.curA).normalize();
        let kind = me.sharp ? (dir.dot(bladeDir) > 0.65 ? 'stab' : 'cut') : 'blunt';
        const power = clamp((sp - minSpeed * 0.7) / 5, 0.25, 2.4);
        let dmg = me.dmg * power * (this.isGun ? 0.8 : 1);
        if (kind === 'stab') dmg *= 1.3;
        const massK = Math.min(2.2, 0.5 + this.mass * 0.4);
        const dv = dir.multiplyScalar(Math.min(me.heavy ? 16 : 11, sp * massK * (kind === 'blunt' ? 1 : 0.45)));
        h.enemy.hit(h.bone, point, dv, dmg, kind);
        this.bloodiness = Math.min(1, this.bloodiness + (me.sharp ? 0.25 : 0.12) * Settings.goreScale);
        const hand = this.heldBy;
        if (hand) haptic(hand.gamepad, Math.min(1, 0.3 + power * 0.35), 50);
        if (this.secondaryHand) haptic(this.secondaryHand.gamepad, 0.5, 40);
        // heavy weapons slow down when they connect
        this.recoilRot = (this.recoilRot || 0) - Math.min(0.2, power * 0.06);
      }
      // props and static surfaces at the tip
      this.staticCd -= dt;
      if (this.staticCd <= 0) {
        const tip = this.curB;
        for (const b of G.physics.staticsAt(tip.x, tip.z)) {
          if (!b.enabled) continue;
          const r = me.radius + 0.01;
          if (tip.x > b.min.x - r && tip.x < b.max.x + r && tip.y > b.min.y - r && tip.y < b.max.y + r && tip.z > b.min.z - r && tip.z < b.max.z + r) {
            this.staticCd = 0.25;
            const mat = b.material;
            G.audio.play(mat === 'metal' || mat === 'rust' ? 'clang' : me.sharp ? 'metal' : (SurfaceFX[mat] || SurfaceFX.concrete).sound, tip, Math.min(1, speed / 8));
            if (mat === 'metal' || mat === 'rust' || me.sharp) G.fx.sparkBurst(tip, _a.copy(vB).normalize().negate(), 6, 2);
            else G.fx.dustBurst(tip, 5, 0.6);
            if (this.heldBy) haptic(this.heldBy.gamepad, 0.6, 40);
            if (b.owner && b.owner.onMeleeHit) b.owner.onMeleeHit(tip, me.dmg * (speed / 6), me.sharp);
            break;
          }
        }
        G.physics.queryParticles(tip.x, tip.y, tip.z, me.radius + 0.12, (p) => {
          const bd = p.body;
          if (bd === this.body || bd.type === 'ragdoll' || bd.type === 'hand' || bd.kinematic || p.invMass === 0) return;
          const owner = bd.owner;
          if (owner && owner._meleeT && G.time - owner._meleeT < 0.25) return;
          if (owner) owner._meleeT = G.time;
          const k = Math.min(8, speed * this.mass / Math.max(0.5, owner ? owner.mass : 1));
          for (const q of bd.particles) q.addVel(vB.x / speed * k, vB.y / speed * k + 0.5, vB.z / speed * k, dt);
          bd.wake();
          if (owner && owner.damage) owner.damage(me.dmg * clamp(speed / 6, 0.3, 2), tip, me.sharp ? 'cut' : 'blunt');
          G.audio.play(owner && owner.impactSound ? owner.impactSound : 'thud', tip, 0.8);
        });
      }
    }
    this.prevA.copy(this.curA); this.prevB.copy(this.curB);
  }
}
const BLOOD = new THREE.Color(0x4a0303);

// ---------------- Ammo items ----------------
const AMMO_SHAPES = {
  pistol: { size: [0.022, 0.1, 0.034], mat: () => Mat.gunmetal, mass: 0.2 },
  rifle: { size: [0.028, 0.15, 0.058], mat: () => Mat.gunmetal, mass: 0.4 },
  shell: { size: [0.022, 0.022, 0.065], mat: () => Mat.shell, mass: 0.05 },
  speedloader: { size: [0.045, 0.045, 0.04], mat: () => Mat.brass, mass: 0.15 },
};
export class AmmoItem extends Item {
  constructor(type, pos, rounds, quat) {
    const S = AMMO_SHAPES[type];
    const [w, h, d] = S.size;
    let mesh;
    if (type === 'shell') {
      mesh = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.05, 10), Mat.shell); c.rotation.x = Math.PI / 2; c.position.z = -0.006;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.014, 10), Mat.brass); b.rotation.x = Math.PI / 2; b.position.z = 0.025;
      mesh.add(c, b);
    } else if (type === 'speedloader') {
      mesh = new THREE.Group();
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), Mat.black); c.rotation.x = Math.PI / 2;
      mesh.add(c);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 6), Mat.brass); r.rotation.x = Math.PI / 2; r.position.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.018); mesh.add(r); }
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), S.mat());
      if (rounds > 0) { const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.008, d * 0.7), Mat.brass); top.position.y = h / 2 + 0.003; mesh.add(top); }
    }
    mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
    mesh.position.copy(pos);
    if (quat) mesh.quaternion.copy(quat);
    const body = makeBoxBody(G.physics, pos.x, pos.y, pos.z, w / 2, h / 2, d / 2, S.mass, quat || null, 'item', Math.min(w, h, d) * 0.45);
    super(body, mesh, { kind: 'ammo', name: type, follow: 60, radius: 0.08, impactSound: 'casing' });
    this.isAmmo = true;
    this.ammoType = type;
    this.rounds = rounds;
    this.despawnAt = G.time + 25;
    this.showHand = true;
  }
  onStaticImpact(p, speed) { if (speed > 1.5) G.audio.play('casing', p, Math.min(1, speed / 6)); }
}

// ---------------- Manager ----------------
export class WeaponManager {
  constructor() { this.reserves = {}; }
  spawn(id, pos, quat = null) {
    const def = WEAPONS[id];
    if (!def) return null;
    return new WeaponItem(def, pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z), quat);
  }
  spawnAmmo(type, pos, rounds, quat) { return new AmmoItem(type, pos.clone(), rounds, quat); }
  setReserves(r) { this.reserves = { ...r }; }
  reserve(type) {
    if (G.modes.current && G.modes.current.infiniteAmmo) return 999;
    return this.reserves[type] || 0;
  }
  // takes up to n units (rounds for shells, magazines/loaders otherwise)
  takeReserve(type, n) {
    if (G.modes.current && G.modes.current.infiniteAmmo) return n;
    const have = this.reserves[type] || 0;
    const got = Math.min(have, n);
    this.reserves[type] = have - got;
    return got;
  }
  addReserve(type, n) { this.reserves[type] = (this.reserves[type] || 0) + n; }
  spawnAmmoFor(gun, pos) {
    const d = gun.def;
    if (this.takeReserve(d.ammo, 1) <= 0) { G.audio.play('dryFire', pos, 0.6); return null; }
    const rounds = d.ammo === 'shell' ? 1 : d.magSize;
    return this.spawnAmmo(d.ammo, pos, rounds, null);
  }
  update(dt) {
    for (let i = G.items.length - 1; i >= 0; i--) { const it = G.items[i]; if (it) it.update(dt); }
  }
}
