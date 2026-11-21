// Active-ragdoll enemies. Each enemy is a Verlet skeleton pulled toward a
// procedurally animated target pose. Impacts displace particles physically;
// enough displacement or balance loss drops the enemy into a full ragdoll,
// from which it can blend back up. Rendering is one SkinnedMesh per enemy.
import * as THREE from 'three';
import { G, clamp, lerp, rand, pick, damp } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { Particle, Body, segSegDist2, rayCapsule } from '../physics/verlet.js';
import { haptic } from '../core/audio.js';
import { PNAMES, REST, PRADIUS, PMASS, BONES, DISMEMBER, boneLength, buildEnemyGeometry, baseAtlas, paintDamage } from './enemyModel.js';

export const ENEMY_TYPES = {
  grunt: {
    id: 'grunt', name: 'Brawler', hp: 110, speed: 3.1, scale: 1.0, bulk: 1.05, mass: 1.0, balance: 70, stiff: 0.34,
    attack: 'punch', reach: 1.05, damage: 11, cooldown: 0.9, downTime: 2.2, dodge: 0.15, lean: 0.12, stance: 0.13, crouch: 0.05, bounce: 1,
    voice: { pitch: 105, formants: [600, 1050] }, hat: 'beanie',
    colors: { skin: '#c79a7c', shirt: '#5b4636', pants: '#2c3036', boots: '#1d1915', hat: '#7c2a1f', hair: '#2a1d14', stubble: true, longSleeves: false },
  },
  stalker: {
    id: 'stalker', name: 'Stalker', hp: 65, speed: 4.7, scale: 0.96, bulk: 0.9, mass: 0.82, balance: 45, stiff: 0.38,
    attack: 'knife', reach: 1.1, damage: 15, cooldown: 0.75, downTime: 1.5, dodge: 0.85, lean: 0.38, stance: 0.12, crouch: 0.32, lunge: true,
    voice: { pitch: 150, formants: [700, 1400] }, hat: 'hood', weapon: 'knife',
    colors: { skin: '#b88a6e', shirt: '#2b2f2c', pants: '#1f2220', boots: '#141414', hat: '#2b2f2c', hair: '#111', longSleeves: true, gloves: '#151515' },
  },
  brute: {
    id: 'brute', name: 'Brute', hp: 330, speed: 2.2, scale: 1.22, bulk: 1.35, mass: 1.85, balance: 260, stiff: 0.44,
    attack: 'slam', reach: 1.45, damage: 28, cooldown: 1.9, downTime: 3.0, dodge: 0, lean: 0.18, stance: 0.18, crouch: 0.15, charge: true, armorHead: 0.75,
    voice: { pitch: 68, formants: [420, 800] }, hat: 'mask',
    colors: { skin: '#a77b62', shirt: '#4a4e3e', pants: '#3a3226', boots: '#201a14', hat: '#26292b', hair: '#3a2a1c', bareArms: true },
  },
  gunner: {
    id: 'gunner', name: 'Gunner', hp: 90, speed: 3.0, scale: 1.0, bulk: 1.0, mass: 1.0, balance: 60, stiff: 0.34,
    attack: 'gun', weapon: 'pistol', range: [4, 15], damage: 8, fireDelay: 0.42, burst: 3, aimTime: 0.55, spread: 0.035, downTime: 2.4, dodge: 0.25, lean: 0.05, stance: 0.12, crouch: 0.05, cover: true,
    voice: { pitch: 118, formants: [560, 1150] }, hat: 'helmet', vest: true,
    colors: { skin: '#d1a589', shirt: '#4b5240', pants: '#3a3f33', boots: '#1d1d1a', hat: '#3e4535', vest: '#2f3527', hair: '#4a3020', longSleeves: true, gloves: '#222' },
  },
  rifleman: {
    id: 'rifleman', name: 'Rifleman', hp: 125, speed: 2.7, scale: 1.03, bulk: 1.08, mass: 1.08, balance: 80, stiff: 0.36,
    attack: 'gun', weapon: 'rifle', range: [7, 24], damage: 7, fireDelay: 0.12, burst: 5, aimTime: 0.75, spread: 0.03, downTime: 2.6, dodge: 0.1, lean: 0.06, stance: 0.13, crouch: 0.08, cover: true,
    voice: { pitch: 96, formants: [520, 980] }, hat: 'helmet', vest: true,
    colors: { skin: '#8f6a52', shirt: '#2d3a4a', pants: '#232b36', boots: '#151515', hat: '#2a3340', vest: '#1f2733', hair: '#1a1410', longSleeves: true, gloves: '#1a1a1a' },
  },
  dummy: {
    id: 'dummy', name: 'Training Dummy', hp: 220, speed: 0, scale: 1.0, bulk: 1.0, mass: 1.0, balance: 90, stiff: 0.3,
    attack: 'none', downTime: 2.0, dodge: 0, lean: 0, stance: 0.12, crouch: 0, headShape: 'dummy', hat: 'none',
    voice: null,
    colors: { skin: '#b69b74', shirt: '#9a8463', pants: '#8a7556', boots: '#5a4a35', hat: '#555', bareArms: true },
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _res = { s: 0, t: 0 };
const _xv = new THREE.Vector3();
let _eid = 0;

// two-bone IK: writes mid joint into out. A start, C end (clamped in place), bend hint
function ik(A, C, L1, L2, bend, out) {
  _a.subVectors(C, A);
  let d = _a.length();
  const maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) + 0.01;
  if (d < 1e-5) { _a.set(0, -1, 0); d = minD; }
  _a.multiplyScalar(1 / d);
  if (d > maxD) { d = maxD; C.copy(A).addScaledVector(_a, d); }
  if (d < minD) { d = minD; C.copy(A).addScaledVector(_a, d); }
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _b.copy(bend).addScaledVector(_a, -bend.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 0, 1);
  _b.normalize();
  out.copy(A).addScaledVector(_a, a).addScaledVector(_b, h);
  return out;
}

export class Enemy {
  constructor(type, x, z, yaw = 0) {
    const def = this.def = ENEMY_TYPES[type];
    this.type = type;
    this.id = _eid++;
    this.isEnemy = true;
    this.alive = true;
    this.removed = false;
    this.health = def.hp;
    this.state = 'idle';
    this.stateT = 0;
    this.stiffness = 1;
    this.limbStiff = { lArm: 1, rArm: 1, lLeg: 1, rLeg: 1, head: 1 };
    const lm = Math.sqrt(def.mass);
    this.limbHP = { head: Math.max(90, def.hp * 0.8), lArm: 75 * lm, rArm: 75 * lm, lForearm: 60 * lm, rForearm: 60 * lm, lLeg: 100 * lm, rLeg: 100 * lm, lShin: 75 * lm, rShin: 75 * lm };
    this.severed = {};
    this.broken = {};
    this.balance = def.balance;
    this.bleed = 0;
    this.deathTime = 0;
    this.puddled = false;
    this.grabbedBy = new Set();
    this.lastVoice = -10;
    this.lastHitTime = -10;
    this.kills = 0;
    const s = def.scale;
    const gh = G.physics.groundHeight(x, z, 1.2, 0.5);
    this.root = { x, y: gh > -50 ? gh : 0, z, yaw, vx: 0, vz: 0 };
    this.anim = { phase: Math.random() * 6, speed: 0, mx: 0, mz: 1, crouch: def.crouch || 0, attackT: -1, attackKind: '', attackSide: 1, flinch: new THREE.Vector3(), aim: new THREE.Vector3(0, 0, 1), lookPitch: 0, twist: 0 };
    this.ai = { path: [], pathI: 0, repathT: Math.random() * 0.5, losT: Math.random() * 0.3, canSee: false, seenOnce: false, lastSeen: new THREE.Vector3(), cover: null, coverT: 0, peek: false, burst: 0, fireT: 0, aimT: 0, attackCd: rand(0.3, 1), dodgeT: 0, dodgeCd: 0, lungeT: 0, chargeT: 0, chargeCd: rand(2, 4), strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0 };

    // ---- physics skeleton ----
    const body = this.body = new Body('ragdoll');
    body.owner = this;
    body.damping = 0.993;
    body.canSleep = false;
    body.impactThreshold = 3;
    this.P = {};
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const n of PNAMES) {
      const r = REST[n];
      const lx = r[0] * s, ly = r[1] * s, lz = r[2] * s;
      const wx = x + lx * cy + lz * sy, wz = z - lx * sy + lz * cy;
      const p = new Particle(wx, this.root.y + ly, wz, PMASS[n] * def.mass, PRADIUS[n] * s * (n === 'chest' || n === 'pelvis' ? (def.bulk || 1) : 1));
      p.tag = n; p.friction = 0.7; p.bounce = 0.05;
      body.add(p);
      this.P[n] = p;
    }
    const P = this.P;
    const torso = ['neck', 'chest', 'pelvis', 'lSh', 'rSh', 'lHip', 'rHip'];
    for (let i = 0; i < torso.length; i++) for (let j = i + 1; j < torso.length; j++) body.link(P[torso[i]], P[torso[j]], 1);
    body.link(P.neck, P.head, 1);
    body.link(P.head, P.chest, 0.6);
    body.link(P.head, P.lSh, 1, 1, Math.hypot(0.2, 0.23) * s * 0.85);
    body.link(P.head, P.rSh, 1, 1, Math.hypot(0.2, 0.23) * s * 0.85);
    for (const sd of ['l', 'r']) {
      body.link(P[sd + 'Sh'], P[sd + 'El'], 1);
      body.link(P[sd + 'El'], P[sd + 'Ha'], 1);
      body.link(P[sd + 'Sh'], P[sd + 'Ha'], 1, 1, 0.22 * s);
      body.link(P[sd + 'Ha'], P.chest, 1, 1, 0.14 * s);
      body.link(P[sd + 'Hip'], P[sd + 'Kn'], 1);
      body.link(P[sd + 'Kn'], P[sd + 'Ft'], 1);
      body.link(P[sd + 'Hip'], P[sd + 'Ft'], 1, 1, 0.42 * s);
      body.link(P[sd + 'Kn'], P.chest, 1, 1, 0.4 * s);
    }
    body.link(P.lKn, P.rKn, 1, 1, 0.12 * s);
    body.link(P.lFt, P.rFt, 1, 1, 0.12 * s);
    body.onImpact = (p, speed, nx, ny, nz, box) => this.onStaticImpact(p, speed, nx, ny, nz, box);
    body.onPairImpact = (p, q, speed, nx, ny, nz) => this.onPairImpact(p, q, speed, nx, ny, nz);
    G.physics.addBody(body);
    this.pieces = [];
    this.extraParticles = [];

    // ---- bones / mesh ----
    this.bones = BONES.map((b) => ({
      ...b, pa: P[b.a], pb: P[b.b], L0: boneLength(b, s),
      lastZ: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
      dent: new THREE.Vector3(1, 1, 1), detached: false, hidden: false,
    }));
    this.boneOfParticle = new Map();
    for (const b of this.bones) {
      if (!this.boneOfParticle.has(b.pb)) this.boneOfParticle.set(b.pb, b);
      if (!this.boneOfParticle.has(b.pa)) this.boneOfParticle.set(b.pa, b);
    }
    this.boneOfParticle.set(P.chest, this.bones[1]);
    this.boneOfParticle.set(P.pelvis, this.bones[2]);
    const size = Settings.perfMode ? 256 : 512;
    this.atlasSize = size;
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.atlas.height = size;
    this.actx = this.atlas.getContext('2d');
    this.actx.drawImage(baseAtlas(def, size), 0, 0);
    this.tex = new THREE.CanvasTexture(this.atlas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = true;
    this.atlasDirty = false;
    this.material = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85, metalness: 0 });
    const geo = buildEnemyGeometry(def);
    this.skelBones = this.bones.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; b.matrixWorldAutoUpdate = false; return b; });
    const skeleton = new THREE.Skeleton(this.skelBones, this.bones.map(() => new THREE.Matrix4()));
    this.mesh = new THREE.SkinnedMesh(geo, this.material);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;
    G.scene.add(this.mesh);

    this.targets = new Float32Array(PNAMES.length * 3);
    this._T = {}; for (const n of PNAMES) this._T[n] = new THREE.Vector3();
    this.weapon = null;
    if (def.weapon && G.weapons) {
      this.weapon = G.weapons.spawn(def.weapon, _a.set(P.rHa.x, P.rHa.y, P.rHa.z));
      if (this.weapon) { this.weapon.enemyHolder = this; this.weapon.setKinematic(true); this.weapon.grabbable = false; this.weapon.body.noCollideWith = this.body; }
    }
    this.updateMesh();
  }

  get allParticles() { return [...this.body.particles, ...this.pieces.flatMap(p => p.particles)]; }
  boneByName(n) { return this.bones.find(b => b.name === n); }
  center(out) { return out.set(this.P.chest.x, this.P.chest.y, this.P.chest.z); }

  voice(kind, force = false) {
    const v = this.def.voice;
    if (!v || (!force && G.time - this.lastVoice < 0.5)) return;
    this.lastVoice = G.time;
    G.audio.play('voice', this.P.head, kind === 'death' ? 1 : 0.8, { kind, pitch: v.pitch, formants: v.formants });
  }

  // =============== AI ===============
  update(dt) {
    if (this.removed) return;
    this.stateT += dt;
    this.anim.flinch.multiplyScalar(Math.exp(-dt * 6));
    for (const k in this.limbStiff) this.limbStiff[k] = Math.min(this.broken[k] ? 0.05 : 1, this.limbStiff[k] + dt * 1.2);
    this.balance = Math.min(this.def.balance, this.balance + this.def.balance * 0.35 * dt);
    if (this.bleed > 0 && Settings.blood) {
      this.bleedAcc = (this.bleedAcc || 0) + dt * Math.min(6, this.bleed);
      if (this.bleedAcc > 1) { this.bleedAcc = 0; const p = this.alive ? this.P.chest : this.P.pelvis; G.fx.drip(p); }
      if (!this.alive) this.bleed = Math.max(0, this.bleed - dt * 0.3);
    }
    switch (this.state) {
      case 'dead': this.updateDead(dt); return;
      case 'ragdoll': this.updateRagdoll(dt); return;
      case 'held': this.updateHeld(dt); break;
      case 'getup': this.updateGetup(dt); break;
      case 'deathAnim': this.updateDeathAnim(dt); return;
      case 'stagger': this.anim.attackT = -1; this.moveRoot(0, 0, 0, dt, null); break;
      default: this.think(dt);
    }
    if (this.state !== 'getup' && this.state !== 'held') this.computePose(dt);
    this.drivePose(dt);
  }

  think(dt) {
    const def = this.def, A = this.ai, an = this.anim, R = this.root;
    const pl = G.player;
    const mode = Settings.aiMode;
    const sandbox = G.modes.current && G.modes.current.id === 'sandbox';
    let desiredX = 0, desiredZ = 0, speed = 0, faceYaw = null;
    const px = pl.headPos.x, pz = pl.headPos.z;
    const dx = px - R.x, dz = pz - R.z;
    const dist = Math.hypot(dx, dz);
    const toPlayerYaw = Math.atan2(dx, dz);
    if (def.attack === 'none' || (sandbox && mode === 'frozen') || !pl.alive) {
      an.attackT = -1;
      this.moveRoot(0, 0, 0, dt, null);
      return;
    }
    // perception (throttled)
    A.losT -= dt;
    if (A.losT <= 0) {
      A.losT = 0.25 + Math.random() * 0.1;
      _a.set(this.P.head.x, this.P.head.y, this.P.head.z);
      A.canSee = dist < 45 && G.physics.lineClear(_a, pl.headPos);
      if (A.canSee) {
        A.lastSeen.copy(pl.headPos);
        if (!A.seenOnce) { A.seenOnce = true; this.voice('grunt'); }
      }
    }
    const passive = sandbox && mode === 'passive';
    if (passive) { faceYaw = toPlayerYaw; this.moveRoot(0, 0, 0, dt, faceYaw); an.attackT = -1; return; }
    if (!A.seenOnce && dist > 18 && !this.hunt) { this.moveRoot(0, 0, 0, dt, null); return; }
    A.seenOnce = true;
    if (this.hunt && !A.canSee) A.lastSeen.copy(pl.headPos); // wave/survival enemies always know where you are

    // dodge (stalkers mostly): react when the player aims at us
    A.dodgeCd -= dt;
    if (A.dodgeT > 0) {
      A.dodgeT -= dt;
      const dsp = 5.5;
      this.moveRoot(A.dodgeX * dsp, A.dodgeZ * dsp, dsp, dt, toPlayerYaw, true);
      an.crouch = lerp(an.crouch, 0.5, 0.3);
      return;
    }
    if (def.dodge > 0 && A.dodgeCd <= 0 && an.attackT < 0 && this.playerAimingAtMe()) {
      if (Math.random() < def.dodge * dt * 4) {
        const side = Math.random() < 0.5 ? 1 : -1;
        A.dodgeX = Math.cos(toPlayerYaw) * side; A.dodgeZ = -Math.sin(toPlayerYaw) * side;
        // avoid dodging into walls
        if (!G.level.nav.walkable(R.x + A.dodgeX * 1.4, R.z + A.dodgeZ * 1.4)) { A.dodgeX *= -1; A.dodgeZ *= -1; }
        A.dodgeT = 0.28; A.dodgeCd = rand(1.2, 2.5);
        this.voice('attack');
        return;
      }
    }

    if (def.attack === 'gun' && this.weapon && !this.severed.rArm && !this.severed.rForearm) this.thinkGun(dt, dist, toPlayerYaw);
    else this.thinkMelee(dt, dist, toPlayerYaw);
  }

  playerAimingAtMe() {
    for (const h of G.player.hands) {
      const it = h.heldItem;
      if (!it || !it.isGun) continue;
      const o = it.muzzleWorld(_a), d = it.muzzleDir(_b);
      _c.set(this.P.chest.x, this.P.chest.y, this.P.chest.z).sub(o);
      const t = _c.dot(d);
      if (t < 1 || t > 20) continue;
      if (_c.addScaledVector(d, -t).length() < 0.55) return true;
    }
    return false;
  }

  thinkMelee(dt, dist, toYaw) {
    const def = this.def, A = this.ai, an = this.anim, R = this.root;
    A.attackCd -= dt;
    // ongoing attack
    if (an.attackT >= 0) {
      const dur = def.attack === 'slam' ? 1.15 : def.attack === 'knife' ? 0.6 : 0.55;
      an.attackT += dt / dur;
      const hitWin = def.attack === 'slam' ? [0.5, 0.62] : [0.38, 0.58];
      if (an.attackT >= hitWin[0] && an.attackT <= hitWin[1] && !A.hitDone) this.tryMeleeHit();
      let lv = 0, lz = 0;
      if (A.lungeT > 0) { A.lungeT -= dt; lv = 7; }
      if (lv) { lz = 1; }
      const fwdX = Math.sin(R.yaw), fwdZ = Math.cos(R.yaw);
      this.moveRoot(fwdX * lv * lz, fwdZ * lv * lz, lv, dt, toYaw);
      if (an.attackT >= 1) { an.attackT = -1; A.attackCd = def.cooldown * rand(0.8, 1.3); }
      return;
    }
    // brute charge
    if (def.charge) {
      A.chargeCd -= dt;
      if (A.chargeT > 0) {
        A.chargeT -= dt;
        const sp = 5.6;
        this.moveRoot(Math.sin(toYaw) * sp, Math.cos(toYaw) * sp, sp, dt, toYaw);
        if (dist < def.reach + 0.3) { A.chargeT = 0; this.startAttack(); }
        return;
      }
      if (A.canSee && A.chargeCd <= 0 && dist > 4 && dist < 10) { A.chargeT = 1.6; A.chargeCd = rand(5, 8); this.voice('attack', true); return; }
    }
    const reach = def.reach * (this.severed.rArm && this.severed.lArm ? 0.8 : 1);
    if (dist < reach && A.attackCd <= 0 && A.canSee) { this.startAttack(); return; }
    // stalker lunge
    if (def.lunge && A.canSee && dist > 1.6 && dist < 3.2 && A.attackCd <= 0 && Math.random() < dt * 2) { this.startAttack(); A.lungeT = 0.28; return; }
    if (dist < reach * 0.8) {
      // too close: circle / back off a little
      A.strafeT -= dt; if (A.strafeT <= 0) { A.strafeT = rand(0.8, 1.6); A.strafe *= -1; }
      const sx = Math.cos(toYaw) * A.strafe, sz = -Math.sin(toYaw) * A.strafe;
      this.moveRoot(sx * 1.2 - Math.sin(toYaw) * 0.5, sz * 1.2 - Math.cos(toYaw) * 0.5, 1.3, dt, toYaw);
      return;
    }
    this.chase(dt, A.canSee ? G.player.headPos : A.lastSeen, def.speed, dist, toYaw);
  }

  startAttack() {
    const an = this.anim;
    an.attackT = 0;
    an.attackSide = -an.attackSide;
    if (this.severed.rArm || this.severed.rForearm) an.attackSide = 1;
    if (this.severed.lArm || this.severed.lForearm) an.attackSide = -1;
    this.ai.hitDone = false;
    this.voice('attack');
  }

  tryMeleeHit() {
    const def = this.def, pl = G.player, A = this.ai;
    const hand = this.def.attack === 'slam' || this.def.attack === 'knife' ? this.P.rHa : (this.anim.attackSide > 0 ? this.P.lHa : this.P.rHa);
    if (hand.body !== this.body) return;
    _a.set(hand.x, hand.y, hand.z);
    // parry: player's held weapon intercepts the attacking hand
    for (const h of pl.hands) {
      const it = h.heldItem;
      if (!it || !it.segmentWorld) continue;
      const seg = it.segmentWorld();
      const d2 = segSegDist2(seg[0], seg[1], _a, _a, _res);
      if (d2 < 0.16 * 0.16) {
        A.hitDone = true;
        G.audio.play(it.isMelee ? 'clang' : 'metal', _a, 0.9);
        G.fx.sparkBurst(_a, _b.set(0, 1, 0), 8);
        haptic(h.gamepad, 0.9, 60);
        this.stagger(_b.subVectors(_a, pl.headPos).setY(0).normalize().multiplyScalar(2.5), 0.7);
        return;
      }
    }
    const headD = _a.distanceTo(pl.headPos);
    const bodyPt = _b.set(pl.headPos.x, Math.max(pl.feetY + 0.5, Math.min(pl.headPos.y - 0.3, hand.y)), pl.headPos.z);
    const bodyD = _a.distanceTo(bodyPt);
    const slam = def.attack === 'slam';
    const range = slam ? 1.0 : 0.32;
    let hitPt = null;
    if (slam) {
      const dx = pl.headPos.x - this.root.x, dz = pl.headPos.z - this.root.z;
      if (Math.hypot(dx, dz) < def.reach + 0.3) hitPt = bodyPt;
      G.fx.dustBurst(_c.set(hand.x, this.root.y + 0.05, hand.z), 14, 1.5);
      G.audio.play('blunt', _c, 1);
    } else if (headD < range || bodyD < range) hitPt = headD < bodyD ? pl.headPos : bodyPt;
    if (hitPt) {
      A.hitDone = true;
      pl.damage(def.damage * (G.modes.current ? G.modes.current.damageMul || 1 : 1), _a);
      const push = slam ? 6 : 1.5;
      _c.set(pl.headPos.x - this.root.x, 0, pl.headPos.z - this.root.z).normalize();
      pl.shove(_c.x * push, slam ? 3 : 0, _c.z * push);
      G.audio.play(def.attack === 'knife' ? 'slash' : 'blunt', hitPt, 0.9);
    }
  }

  thinkGun(dt, dist, toYaw) {
    const def = this.def, A = this.ai, an = this.anim, R = this.root;
    const [minR, maxR] = def.range;
    A.coverT -= dt;
    // choose cover periodically or when exposed
    if (def.cover && (A.coverT <= 0 || (A.cover && A.canSee && !A.peek && this.stateT > 1))) {
      A.coverT = rand(6, 10);
      A.cover = G.level.findCover(R.x, R.z, G.player.headPos, minR, maxR);
      A.path = []; A.peek = false;
    }
    let atCover = false;
    if (A.cover) {
      const cd = Math.hypot(A.cover.x - R.x, A.cover.z - R.z);
      if (cd > 0.5) { this.goTo(dt, A.cover.x, A.cover.z, def.speed * 1.1, A.canSee ? toYaw : null); an.crouch = lerp(an.crouch, 0.15, 0.1); if (A.canSee) this.fireLogic(dt, dist, toYaw, true); return; }
      atCover = true;
    }
    if (atCover) {
      // peek cycle: hide (crouch) / pop up and shoot
      A.peekT = (A.peekT || 0) - dt;
      if (A.peekT <= 0) { A.peek = !A.peek; A.peekT = A.peek ? rand(1.6, 2.6) : rand(1.0, 2.0); }
      an.crouch = lerp(an.crouch, A.peek ? 0.05 : 0.65, 1 - Math.exp(-dt * 8));
      this.moveRoot(0, 0, 0, dt, toYaw);
      if (A.peek) this.fireLogic(dt, dist, toYaw, false); else A.aimT = 0;
      return;
    }
    an.crouch = lerp(an.crouch, def.crouch, 0.1);
    if (!A.canSee || dist > maxR) { this.chase(dt, A.canSee ? G.player.headPos : A.lastSeen, def.speed, dist, A.canSee ? toYaw : null); if (A.canSee) this.fireLogic(dt, dist, toYaw, true); return; }
    if (dist < minR) {
      // back away while shooting
      this.moveRoot(-Math.sin(toYaw) * 2, -Math.cos(toYaw) * 2, 2, dt, toYaw);
    } else {
      A.strafeT -= dt; if (A.strafeT <= 0) { A.strafeT = rand(1.5, 3); A.strafe = Math.random() < 0.5 ? -1 : (Math.random() < 0.6 ? 1 : 0); }
      const sx = Math.cos(toYaw) * A.strafe, sz = -Math.sin(toYaw) * A.strafe;
      this.moveRoot(sx * 1.4, sz * 1.4, Math.abs(A.strafe) * 1.4, dt, toYaw);
    }
    this.fireLogic(dt, dist, toYaw, false);
  }

  fireLogic(dt, dist, toYaw, moving) {
    const def = this.def, A = this.ai;
    if (!A.canSee || !this.weapon) { A.aimT = 0; return; }
    const yawErr = Math.abs(Math.atan2(Math.sin(toYaw - this.root.yaw), Math.cos(toYaw - this.root.yaw)));
    if (yawErr > 0.5) return;
    A.aimT += dt;
    this.anim.aiming = true;
    if (A.aimT < def.aimTime) return;
    A.fireT -= dt;
    if (A.fireT > 0) return;
    if (A.burst <= 0) { A.burst = def.burst + Math.floor(Math.random() * 2); }
    // hold fire if an ally is in the line of fire
    const o = this.weapon.muzzleWorld(_c);
    const dir = _d.subVectors(G.player.headPos, o);
    const pd = dir.length(); dir.multiplyScalar(1 / pd);
    const ally = G.enemies.raycast(o, dir, pd, this);
    if (ally && ally.enemy.alive) { A.fireT = 0.3; A.strafeT = 0; return; }
    this.shoot(dist, moving);
    A.burst--;
    A.fireT = def.fireDelay * rand(0.85, 1.2);
    if (A.burst <= 0) { A.fireT = rand(1.0, 2.0); A.aimT = def.aimTime * 0.4; }
  }

  shoot(dist, moving) {
    const w = this.weapon, def = this.def, pl = G.player;
    const o = w.muzzleWorld(new THREE.Vector3());
    const target = _a.copy(pl.headPos);
    target.y -= Math.random() < 0.6 ? 0.35 : 0.05;
    const dir = _b.subVectors(target, o).normalize();
    const spread = def.spread * (1 + dist / 12) * (moving ? 1.8 : 1) * (pl.crouched ? 1.3 : 1);
    dir.x += rand(-spread, spread); dir.y += rand(-spread, spread) * 0.7; dir.z += rand(-spread, spread);
    dir.normalize();
    w.fireFX(o, dir);
    G.audio.play('gunEnemy', o, 1);
    const hitStatic = G.physics.raycastStatic(o, dir, 60);
    const maxD = hitStatic ? hitStatic.dist : 60;
    // other enemies in the line of fire
    const eh = G.enemies.raycast(o, dir, maxD, this);
    // player capsule
    _c.set(pl.headPos.x, pl.feetY + 0.3, pl.headPos.z);
    const pd = rayCapsule(o, dir, _c, pl.headPos, 0.22, maxD);
    let end = maxD;
    if (pd >= 0 && (!eh || pd < eh.dist)) {
      end = pd;
      const headshot = o.clone().addScaledVector(dir, pd).y > pl.headPos.y - 0.15;
      pl.damage(def.damage * (headshot ? 1.6 : 1) * (G.modes.current ? G.modes.current.damageMul || 1 : 1), o);
    } else if (eh) {
      end = eh.dist;
      eh.enemy.hit(eh.bone, eh.point, dir.clone().multiplyScalar(3), def.damage * 2, 'bullet');
    } else if (hitStatic) {
      G.fx.bulletImpact(hitStatic.point, hitStatic.normal, hitStatic.box.material);
      if (Math.random() < 0.3) G.audio.play('ricochet', hitStatic.point, 0.6);
    }
    G.fx.tracer(o, _d.copy(o).addScaledVector(dir, end));
  }

  chase(dt, target, speed, dist, faceYaw) {
    const A = this.ai, R = this.root;
    const nav = G.level.nav;
    // direct line on the nav grid?
    A.repathT -= dt;
    if (nav.lineWalkable(R.x, R.z, target.x, target.z)) {
      A.path = [];
      this.goToward(dt, target.x, target.z, speed, faceYaw);
      return;
    }
    if (A.repathT <= 0 || A.pathI >= A.path.length) {
      A.repathT = rand(0.5, 0.9);
      if (G.enemies.pathBudget > 0) {
        G.enemies.pathBudget--;
        A.path = nav.findPath(R.x, R.z, target.x, target.z) || [];
        A.pathI = 0;
      }
    }
    if (A.pathI < A.path.length) {
      const wp = A.path[A.pathI];
      if (Math.hypot(wp.x - R.x, wp.z - R.z) < 0.45) A.pathI++;
      if (A.pathI < A.path.length) { this.goToward(dt, A.path[A.pathI].x, A.path[A.pathI].z, speed, faceYaw); return; }
    }
    this.goToward(dt, target.x, target.z, speed * 0.6, faceYaw);
  }

  goTo(dt, x, z, speed, faceYaw) { this.chase(dt, { x, z }, speed, Math.hypot(x - this.root.x, z - this.root.z), faceYaw); }

  goToward(dt, x, z, speed, faceYaw) {
    const R = this.root;
    let dx = x - R.x, dz = z - R.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.moveRoot(0, 0, 0, dt, faceYaw); return; }
    dx /= d; dz /= d;
    const sp = Math.min(speed, d * 3);
    this.moveRoot(dx * sp, dz * sp, sp, dt, faceYaw);
  }

  // Integrate root motion with acceleration, wall sliding and crowd separation
  moveRoot(vx, vz, speed, dt, faceYaw, instant = false) {
    const R = this.root, def = this.def;
    const legPenalty = (this.limbStiff.lLeg + this.limbStiff.rLeg) / 2;
    const k = instant ? 1 : 1 - Math.exp(-dt * 6);
    R.vx = lerp(R.vx, vx * legPenalty, k);
    R.vz = lerp(R.vz, vz * legPenalty, k);
    // separation
    for (const o of G.enemies.list) {
      if (o === this || !o.alive || o.state === 'ragdoll') continue;
      const dx = R.x - o.root.x, dz = R.z - o.root.z;
      const d2 = dx * dx + dz * dz;
      const min = 0.65 * (def.scale + o.def.scale) / 2;
      if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2); R.vx += dx / d * (min - d) * 6; R.vz += dz / d * (min - d) * 6; }
    }
    let nx = R.x + R.vx * dt, nz = R.z + R.vz * dt;
    // wall slide against static boxes
    const rad = 0.28 * def.scale;
    const boxes = G.physics.staticsInRect(nx - 0.6, nz - 0.6, nx + 0.6, nz + 0.6, this._near || (this._near = []));
    for (const b of boxes) {
      if (b.max.y < R.y + 0.66 || b.min.y > R.y + 1.6) continue; // low obstacles are stepped over
      const cx = clamp(nx, b.min.x, b.max.x), cz = clamp(nz, b.min.z, b.max.z);
      const ddx = nx - cx, ddz = nz - cz, d2 = ddx * ddx + ddz * ddz;
      if (d2 < rad * rad) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2); nx += ddx / d * (rad - d); nz += ddz / d * (rad - d); }
        else { nx = R.x; nz = R.z; }
      }
    }
    R.x = nx; R.z = nz;
    const gh = G.physics.groundHeight(R.x, R.z, R.y, 0.68);
    if (gh > -50) R.y = lerp(R.y, gh, 1 - Math.exp(-dt * 12));
    const sp = Math.hypot(R.vx, R.vz);
    const an = this.anim;
    an.speed = sp;
    if (faceYaw === null && sp > 0.3) faceYaw = Math.atan2(R.vx, R.vz);
    if (faceYaw !== null && faceYaw !== undefined) {
      const turn = (def.id === 'brute' ? 3 : 7) * dt;
      let dy = Math.atan2(Math.sin(faceYaw - R.yaw), Math.cos(faceYaw - R.yaw));
      R.yaw += clamp(dy, -turn, turn);
    }
    // local move direction for the walk cycle
    if (sp > 0.05) {
      const c = Math.cos(R.yaw), s = Math.sin(R.yaw);
      an.mx = (R.vx * c - R.vz * s) / sp;
      an.mz = (R.vx * s + R.vz * c) / sp;
    }
  }

  // =============== POSE ===============
  computePose(dt) {
    const def = this.def, an = this.anim, R = this.root, s = def.scale;
    const T = this._T;
    const sp = an.speed;
    const cadence = def.id === 'brute' ? 1.6 : def.id === 'stalker' ? 2.6 : 2.1;
    an.phase += dt * (sp > 0.15 ? cadence * Math.PI * (0.6 + sp * 0.28) : 0);
    const moveAmt = clamp(sp / 3, 0, 1);
    const crouch = an.crouch;
    // ---- legs ----
    const stride = Math.min(0.42 * s, sp * 0.2);
    const stance = def.stance * s * (1 + crouch * 0.3);
    const lift = Math.min(0.15, sp * 0.05) * s;
    const bounce = def.bounce && an.attackT < 0 && sp < 0.5 ? Math.abs(Math.sin(G.time * 5)) * 0.025 : 0;
    const pelvisY = (0.97 - 0.018 - crouch * 0.4) * s - (sp > 0.15 ? Math.abs(Math.cos(an.phase)) * 0.035 * moveAmt : 0) - bounce;
    T.pelvis.set(0, pelvisY, -crouch * 0.05 * s);
    for (const side of [1, -1]) {
      const n = side > 0 ? 'l' : 'r';
      const ph = an.phase + (side > 0 ? 0 : Math.PI);
      const f = T[n + 'Ft'];
      if (sp > 0.15) {
        const sw = Math.sin(ph);
        f.set(side * stance + an.mx * sw * stride, 0.08 * s + Math.max(0, Math.cos(ph)) * lift, an.mz * sw * stride + 0.02);
      } else {
        f.set(side * stance, 0.08 * s, side * 0.04 * s * (def.id === 'grunt' ? 1 : 0.3));
      }
      T[n + 'Hip'].set(side * 0.1 * s, pelvisY - 0.03 * s, T.pelvis.z);
    }
    // ---- torso ----
    let lean = def.lean + moveAmt * 0.08 + crouch * 0.35;
    let twist = 0;
    const atk = an.attackT;
    if (atk >= 0) {
      if (def.attack === 'slam') lean += atk < 0.5 ? -0.25 * (atk / 0.5) : 0.5;
      else if (def.attack === 'knife') lean += atk > 0.3 && atk < 0.6 ? 0.35 : 0;
      else twist = an.attackSide * (atk < 0.35 ? -0.35 : atk < 0.6 ? 0.45 : 0.2);
    }
    const cl = Math.cos(lean), sl = Math.sin(lean);
    T.chest.set(0, T.pelvis.y + cl * 0.3 * s, T.pelvis.z + sl * 0.3 * s);
    T.neck.set(0, T.chest.y + cl * 0.22 * s, T.chest.z + sl * 0.22 * s);
    const ct = Math.cos(twist), st = Math.sin(twist);
    for (const side of [1, -1]) {
      const n = side > 0 ? 'lSh' : 'rSh';
      const ox = side * 0.2 * s * (def.bulk || 1) * 0.95;
      T[n].set(ox * ct, T.neck.y - 0.05 * s, T.neck.z - ox * st);
    }
    // head looks at player
    const pl = G.player;
    const lookPitch = this.ai.canSee ? clamp(Math.atan2(pl.headPos.y - (R.y + 1.6 * s), Math.max(0.5, Math.hypot(pl.headPos.x - R.x, pl.headPos.z - R.z))), -0.6, 0.6) : 0;
    T.head.set(0, T.neck.y + 0.17 * s * Math.cos(lookPitch * 0.5), T.neck.z + 0.03 * s + Math.sin(lookPitch) * 0.06);
    // ---- arms ----
    const sh = { l: T.lSh, r: T.rSh };
    const hands = { l: T.lHa, r: T.rHa };
    const chestY = T.chest.y, neckY = T.neck.y;
    const aimLocal = this.aimLocal(_d);
    const mode = this.armMode();
    for (const side of [1, -1]) {
      const n = side > 0 ? 'l' : 'r';
      const H = hands[n], S = sh[n];
      const swing = Math.sin(an.phase + (side > 0 ? Math.PI : 0)) * 0.2 * moveAmt;
      switch (mode) {
        case 'guard':
          H.set(side * 0.12 * s, neckY - 0.02 * s, 0.26 * s);
          if (sp > 1.5) H.set(side * 0.18 * s, chestY, 0.18 * s + swing * 0.5);
          break;
        case 'punch': {
          const striking = side === an.attackSide;
          if (striking) {
            if (atk < 0.35) H.set(side * 0.16 * s, chestY + 0.08 * s, 0.02);
            else if (atk < 0.6) H.set(side * 0.03 * s, neckY - 0.03 * s, 0.68 * s);
            else H.set(side * 0.12 * s, neckY - 0.02 * s, 0.3 * s);
          } else H.set(side * 0.11 * s, neckY - 0.02 * s, 0.24 * s);
          break;
        }
        case 'knife': {
          if (side < 0) {
            if (atk >= 0 && atk > 0.3 && atk < 0.62) H.set(-0.05 * s, chestY + 0.05 * s, 0.75 * s);
            else if (atk >= 0 && atk <= 0.3) H.set(-0.22 * s, chestY - 0.05 * s, -0.05);
            else H.set(-0.16 * s, chestY - 0.12 * s, 0.32 * s);
          } else H.set(0.14 * s, chestY + 0.02 * s, 0.25 * s);
          break;
        }
        case 'slam': {
          if (atk >= 0 && atk < 0.5) { const k = atk / 0.5; H.set(side * 0.12 * s, lerp(chestY, T.head.y + 0.35 * s, k), lerp(0.25 * s, 0.0, k)); }
          else if (atk >= 0.5 && atk < 0.75) H.set(side * 0.13 * s, 0.6 * s, 0.7 * s);
          else H.set(side * 0.3 * s, chestY - 0.3 * s, 0.2 * s + swing);
          break;
        }
        case 'gun1h': {
          const ext = 0.52 * s;
          if (side < 0) H.set(S.x + aimLocal.x * ext + 0.08 * s, S.y + aimLocal.y * ext - 0.02, S.z + aimLocal.z * ext);
          else H.set(T.rSh.x + aimLocal.x * (ext - 0.06) + 0.06 * s, T.rSh.y + aimLocal.y * (ext - 0.06) - 0.06, T.rSh.z + aimLocal.z * (ext - 0.06));
          break;
        }
        case 'gun2h': {
          if (side < 0) H.set(-0.1 * s + aimLocal.x * 0.25, chestY + 0.1 * s + aimLocal.y * 0.25, 0.22 * s + aimLocal.z * 0.15);
          else H.set(-0.04 * s + aimLocal.x * 0.55, chestY + 0.12 * s + aimLocal.y * 0.55, 0.12 * s + aimLocal.z * 0.45);
          break;
        }
        case 'carry': // weapon lowered while moving
          if (side < 0) H.set(-0.14 * s, chestY - 0.15 * s, 0.3 * s);
          else H.set(0.05 * s, chestY - 0.05 * s, 0.38 * s);
          break;
        default:
          H.set(S.x + side * 0.05 * s, S.y - 0.52 * s, S.z + swing * s);
      }
    }
    // ---- flinch & to world ----
    const fl = an.flinch;
    const c = Math.cos(R.yaw), sn = Math.sin(R.yaw);
    const toWorld = (v, k) => {
      const x = v.x * c + v.z * sn, z = -v.x * sn + v.z * c;
      v.set(R.x + x + fl.x * k, R.y + v.y + fl.y * k, R.z + z + fl.z * k);
    };
    const flk = { head: 1.6, neck: 1.3, chest: 1, lSh: 1, rSh: 1, lHa: 0.8, rHa: 0.8, pelvis: 0.3, lHip: 0.3, rHip: 0.3 };
    for (const n of ['pelvis', 'chest', 'neck', 'head', 'lSh', 'rSh', 'lHa', 'rHa', 'lHip', 'rHip', 'lFt', 'rFt']) toWorld(T[n], flk[n] || 0);
    // feet onto the ground
    for (const n of ['lFt', 'rFt']) {
      const gh = G.physics.groundHeight(T[n].x, T[n].z, R.y + 0.4, 0.5);
      if (gh > -50) T[n].y += gh - R.y;
    }
    // IK elbows / knees
    const fw = _x.set(sn, 0, c);
    for (const side of [1, -1]) {
      const n = side > 0 ? 'l' : 'r';
      const right = _y.set(c, 0, -sn).multiplyScalar(side); // character-left direction
      // knees bend forward
      ik(T[n + 'Hip'], T[n + 'Ft'], 0.43 * s, 0.44 * s, _z.copy(fw), T[n + 'Kn']);
      // elbows bend back/out/down
      const bend = _c.copy(fw).multiplyScalar(-0.8).addScaledVector(right, 0.6).add(_a.set(0, -0.5, 0));
      ik(T[n + 'Sh'], T[n + 'Ha'], 0.28 * s, 0.27 * s, bend, T[n + 'El']);
    }
  }

  armMode() {
    const def = this.def, an = this.anim;
    if (this.state === 'held') return 'flail';
    if (def.attack === 'none') return 'relaxed';
    if (def.attack === 'gun' && this.weapon) {
      if (an.aiming || this.ai.canSee) return def.weapon === 'rifle' ? 'gun2h' : 'gun1h';
      return 'carry';
    }
    if (def.attack === 'slam') return 'slam';
    if (def.attack === 'knife') return 'knife';
    return an.attackT >= 0 ? 'punch' : 'guard';
  }

  aimLocal(out) {
    const pl = G.player, R = this.root;
    out.set(pl.headPos.x - R.x, pl.headPos.y - 0.25 - (R.y + 1.4 * this.def.scale), pl.headPos.z - R.z).normalize();
    const c = Math.cos(R.yaw), s = Math.sin(R.yaw);
    const x = out.x * c - out.z * s, z = out.x * s + out.z * c;
    out.x = x; out.z = z;
    return out;
  }

  drivePose(dt) {
    const T = this._T, P = this.P;
    const base = this.def.stiff * this.stiffness;
    if (base <= 0.001) return;
    // carry: translate particles with the root's motion so walking doesn't lag
    const R = this.root;
    if (this._lastRoot && this.state !== 'getup') {
      const dx = R.x - this._lastRoot.x, dy = R.y - this._lastRoot.y, dz = R.z - this._lastRoot.z;
      if (Math.abs(dx) + Math.abs(dz) < 1) for (const p of this.body.particles) { p.x += dx; p.y += dy; p.z += dz; p.px += dx; p.py += dy; p.pz += dz; }
    }
    this._lastRoot = this._lastRoot || {};
    this._lastRoot.x = R.x; this._lastRoot.y = R.y; this._lastRoot.z = R.z;
    const LS = this.limbStiff;
    for (const n of PNAMES) {
      const p = P[n];
      if (p.body !== this.body) continue; // severed
      let k = base;
      if (n === 'lEl' || n === 'lHa') k *= LS.lArm;
      else if (n === 'rEl' || n === 'rHa') k *= LS.rArm;
      else if (n === 'lKn' || n === 'lFt') k *= LS.lLeg;
      else if (n === 'rKn' || n === 'rFt') k *= LS.rLeg;
      else if (n === 'head') k *= LS.head;
      if (n === 'pelvis' || n === 'chest' || n === 'lFt' || n === 'rFt') k *= 1.25;
      const kk = damp(Math.min(0.9, k), dt);
      const t = T[n];
      p.x += (t.x - p.x) * kk; p.y += (t.y - p.y) * kk; p.z += (t.z - p.z) * kk;
      const kd = kk * 0.6;
      p.px += (p.x - p.px) * kd; p.py += (p.y - p.py) * kd; p.pz += (p.z - p.pz) * kd;
    }
  }

  // After physics: balance check, root follow, mesh
  post(dt) {
    if (this.removed) return;
    const P = this.P, T = this._T;
    if (this.alive && (this.state === 'idle' || this.state === 'stagger')) {
      // root follows how far the pelvis was pushed off target
      const dx = P.pelvis.x - T.pelvis.x, dz = P.pelvis.z - T.pelvis.z;
      const dev = Math.hypot(dx, dz);
      this.root.x += dx * 0.3; this.root.z += dz * 0.3;
      const chestDev = Math.hypot(P.chest.x - T.chest.x, P.chest.z - T.chest.z);
      if (Settings.ragdoll && (dev > 0.42 * this.def.scale || chestDev > 0.6 * this.def.scale || this.balance <= 0)) this.knockDown();
      if (this.state === 'stagger' && this.stateT > this.staggerDur) this.setState('idle');
      // missing legs: can't stand
      if ((this.severed.lLeg || this.severed.rLeg || this.severed.lShin || this.severed.rShin)) this.knockDown(true);
    }
    // enemy weapon follows the hand
    if (this.weapon && this.weapon.enemyHolder === this) this.driveWeapon(dt);
    this.updateMesh();
    if (this.atlasDirty) { this.tex.needsUpdate = true; this.atlasDirty = false; }
  }

  driveWeapon(dt) {
    const w = this.weapon, P = this.P;
    const hand = P.rHa;
    _a.set(hand.x, hand.y, hand.z);
    if (this.state === 'idle' && this.alive && this.anim.aiming !== false && this.ai.canSee) {
      _b.copy(G.player.headPos).setY(G.player.headPos.y - 0.25).sub(_a).normalize();
    } else {
      _b.set(hand.x - P.rEl.x, hand.y - P.rEl.y, hand.z - P.rEl.z).normalize();
    }
    // Matrix4.lookAt makes -Z face the target: weapon forward is -Z
    _m.lookAt(_c.set(0, 0, 0), _b, UP);
    _q.setFromRotationMatrix(_m);
    _m.compose(_a, _q, _c.set(1, 1, 1));
    w.driveTo(_m, dt, 1, true);
    this.anim.aiming = undefined;
  }

  dropWeapon(vel) {
    const w = this.weapon;
    if (!w || w.enemyHolder !== this) return;
    w.enemyHolder = null;
    w.grabbable = true;
    w.setKinematic(false);
    if (vel) w.body.addVelocity(vel.x, vel.y + 1.5, vel.z, G.physics.dt);
    w.despawnAt = G.time + 60;
    this.weapon = null;
  }

  updateMesh() {
    const P = this.P;
    // torso frame
    const up = _y.set(P.neck.x - P.pelvis.x, P.neck.y - P.pelvis.y, P.neck.z - P.pelvis.z).normalize();
    const right = _x.set(P.rSh.x - P.lSh.x, P.rSh.y - P.lSh.y, P.rSh.z - P.lSh.z);
    const fT = _a.crossVectors(up, right).normalize();
    const hipR = _c.set(P.rHip.x - P.lHip.x, P.rHip.y - P.lHip.y, P.rHip.z - P.lHip.z);
    const fP = _d.crossVectors(up, hipR).normalize();
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const pa = b.pa, pb = b.pb;
      const Y = _b.set(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
      const len = Y.length();
      if (len < 1e-6) continue;
      Y.multiplyScalar(1 / len);
      let ref = b.detached ? b.lastZ : (b.fwd === 'pelvis' ? fP : fT);
      const Z = _z.copy(ref).addScaledVector(Y, -ref.dot(Y));
      if (Z.lengthSq() < 1e-6) Z.copy(b.lastZ).addScaledVector(Y, -b.lastZ.dot(Y));
      Z.normalize();
      b.lastZ.copy(Z);
      const X = _xv.crossVectors(Y, Z);
      const sy = b.stretch ? clamp(len / b.L0, 0.85, 1.2) : 1;
      const d = b.dent;
      const sc = b.hidden ? 0 : 1;
      _m.set(
        X.x * d.x * sc, Y.x * sy * d.y * sc, Z.x * d.z * sc, pa.x,
        X.y * d.x * sc, Y.y * sy * d.y * sc, Z.y * d.z * sc, pa.y,
        X.z * d.x * sc, Y.z * sy * d.y * sc, Z.z * d.z * sc, pa.z,
        0, 0, 0, 1);
      this.skelBones[i].matrixWorld.copy(_m);
    }
  }

  // =============== STATES ===============
  setState(s) { this.state = s; this.stateT = 0; }

  stagger(dv, dur = 0.6) {
    if (!this.alive || this.state === 'ragdoll') return;
    this.setState('stagger');
    this.staggerDur = dur;
    this.anim.attackT = -1;
    this.root.vx += dv.x; this.root.vz += dv.z;
    this.anim.flinch.add(_a.copy(dv).multiplyScalar(0.06));
  }

  knockDown(permanent = false) {
    if (this.state === 'ragdoll' || this.state === 'dead') return;
    if (!Settings.ragdoll) { if (!this.alive) this.setState('deathAnim'); return; }
    this.setState('ragdoll');
    this.stiffness = 0;
    this.anim.attackT = -1;
    this.permanentDown = permanent || this.permanentDown;
    // carry root momentum into the ragdoll
    const dt = G.physics.dt;
    for (const p of this.body.particles) p.addVel(this.root.vx * 0.8, 0, this.root.vz * 0.8, dt);
    this.root.vx = this.root.vz = 0;
    if (this.alive) this.voice('pain');
    if (this.weapon && Math.random() < 0.5) this.dropWeapon();
  }

  updateRagdoll(dt) {
    // slight muscle tone while alive: arms try to protect head (writhing)
    const P = this.P;
    if (this.alive && this.stateT > 0.5 && !this.permanentDown) {
      const vel = Math.abs(P.pelvis.x - P.pelvis.px) + Math.abs(P.pelvis.y - P.pelvis.py) + Math.abs(P.pelvis.z - P.pelvis.pz);
      const canStand = !this.severed.lLeg && !this.severed.rLeg && !this.severed.lShin && !this.severed.rShin && !(this.broken.lLeg && this.broken.rLeg);
      if (canStand && this.stateT > this.def.downTime && vel / dt < 0.6 && this.grabbedBy.size === 0) this.startGetup();
    }
    if (this.alive && this.permanentDown && this.stateT > 1) {
      // crawling bleed-out for legless enemies
      this.health -= dt * 6;
      if (this.health <= 0) this.die('bleed');
    }
  }

  startGetup() {
    const P = this.P;
    this.setState('getup');
    this.root.x = P.pelvis.x; this.root.z = P.pelvis.z;
    const gh = G.physics.groundHeight(P.pelvis.x, P.pelvis.z, P.pelvis.y + 0.3, 0.6);
    this.root.y = gh > -50 ? gh : this.root.y;
    this.root.yaw = Math.atan2(P.head.x - P.pelvis.x, P.head.z - P.pelvis.z);
    this.getupFrom = PNAMES.map(n => new THREE.Vector3(P[n].x, P[n].y, P[n].z));
    this.anim.speed = 0; this.anim.attackT = -1;
    this.anim.crouch = 0.8;
    this._lastRoot = null;
    this.balance = this.def.balance;
    this.voice('grunt');
  }

  updateGetup(dt) {
    const dur = this.def.id === 'brute' ? 1.6 : 1.15;
    const t = Math.min(1, this.stateT / dur);
    this.anim.crouch = lerp(0.8, this.def.crouch || 0, t);
    this.anim.speed = 0;
    this.computePose(dt);
    const e = t * t * (3 - 2 * t);
    const T = this._T;
    PNAMES.forEach((n, i) => T[n].lerpVectors(this.getupFrom[i], T[n], e));
    this.stiffness = lerp(0.35, 1, t);
    if (t >= 1) { this.setState('idle'); this.stiffness = 1; }
  }

  onGrabbed(on, hand) {
    if (on) this.grabbedBy.add(hand); else this.grabbedBy.delete(hand);
    if (!this.alive) return;
    if (on && this.state !== 'ragdoll') { this.setState('held'); this.voice('pain'); if (this.weapon && Math.random() < 0.6) this.dropWeapon(); }
    if (!on && this.grabbedBy.size === 0 && this.state === 'held') this.knockDown();
  }

  updateHeld(dt) {
    // partially limp while being dragged by the player, legs kick
    this.stiffness = 0.25;
    this.anim.speed = 0;
    this.computePose(dt);
    const P = this.P;
    this.root.x = P.pelvis.x; this.root.z = P.pelvis.z;
    this._lastRoot = null;
    const T = this._T;
    T.lHa.y += Math.sin(G.time * 13) * 0.2; T.rHa.y += Math.cos(G.time * 11) * 0.2;
    T.lFt.z += Math.sin(G.time * 9) * 0.2;
    if (this.stateT > 4) { this.grabbedBy.clear(); this.knockDown(); }
  }

  die(kind, dv) {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.deathTime = G.time;
    this.bleed = Math.max(this.bleed, 2);
    this.voice('death', true);
    this.dropWeapon(dv ? _a.copy(dv).multiplyScalar(0.3) : null);
    if (Settings.ragdoll) { this.state = 'ragdoll'; this.knockDownDead(dv); }
    else { this.setState('deathAnim'); this.deathFrom = PNAMES.map(n => new THREE.Vector3(this.P[n].x, this.P[n].y, this.P[n].z)); }
    G.modes.onEnemyKilled(this, kind);
    G.enemies.onDeath(this);
  }

  knockDownDead(dv) {
    this.setState('dead');
    this.stiffness = 0;
    const dt = G.physics.dt;
    for (const p of this.body.particles) p.addVel(this.root.vx * 0.8, 0, this.root.vz * 0.8, dt);
    this.body.canSleep = true;
  }

  updateDead(dt) {
    if (!this.puddled && G.time - this.deathTime > 1.5) {
      const P = this.P.pelvis;
      const v = Math.abs(P.x - P.px) + Math.abs(P.y - P.py) + Math.abs(P.z - P.pz);
      if (v / dt < 0.3) { this.puddled = true; G.fx.puddle(_a.set(this.P.chest.x, this.P.chest.y, this.P.chest.z), rand(0.7, 1.1) * this.def.scale); }
    }
  }

  // Ragdolls disabled: scripted collapse toward a lying pose, then freeze
  updateDeathAnim(dt) {
    const t = Math.min(1, this.stateT / 0.9);
    const R = this.root, s = this.def.scale;
    const c = Math.cos(R.yaw), sn = Math.sin(R.yaw);
    const T = this._T;
    PNAMES.forEach((n, i) => {
      const r = REST[n];
      // lying on the back, head pointing backward
      const lx = r[0] * s, lz = -(r[1] * s) * 0.95 + 0.4, ly = 0.08 + r[2] * s;
      T[n].set(R.x + lx * c + lz * sn, R.y + ly, R.z - lx * sn + lz * c);
      if (this.deathFrom) T[n].lerpVectors(this.deathFrom[i], T[n], t * t);
    });
    this.stiffness = 1;
    for (const n of PNAMES) { const p = this.P[n]; if (p.body !== this.body) continue; const tt = T[n]; p.setPos(tt.x, tt.y, tt.z); }
    if (t >= 1) { this.setState('dead'); this.body.canSleep = true; this.body.sleeping = true; }
  }

  // =============== DAMAGE ===============
  // bone: bone data, point: world hit point, dv: velocity change vector (m/s)
  hit(bone, point, dv, damage, kind, opts = {}) {
    if (this.removed || !bone) return;
    const gore = Settings.goreScale;
    const region = bone.region;
    const firstHit = this.alive;
    this.lastHitTime = G.time;
    // ---- physical reaction ----
    const ragdollOn = Settings.ragdoll;
    const react = ragdollOn ? 1 : 0.25;
    const segT = this._closestT(bone, point);
    const pa = bone.pa, pb = bone.pb;
    const dt = G.physics.dt;
    const wa = (1 - segT), wb = segT;
    pa.addVel(dv.x * wa * react, dv.y * wa * react, dv.z * wa * react, dt);
    pb.addVel(dv.x * wb * react, dv.y * wb * react, dv.z * wb * react, dt);
    pa.body.wake(); pb.body.wake();
    // spread a little to the whole body for big hits
    const mag = dv.length();
    if (mag > 5 && ragdollOn) for (const p of pa.body.particles) p.addVel(dv.x * 0.12, dv.y * 0.12, dv.z * 0.12, dt);
    // ---- damage ----
    const mulTable = kind === 'bullet' || kind === 'pellet' ? { head: 3.2, torso: 1, arm: 0.55, leg: 0.65 } : { head: 1.8, torso: 1, arm: 0.6, leg: 0.7 };
    let dmg = damage * mulTable[region] * (region === 'head' ? (this.def.armorHead || 1) : 1);
    if (this.alive) {
      this.health -= dmg;
      this.balance -= mag * 6 * (kind === 'blunt' || kind === 'kick' ? 2 : 1) / (this.def.mass);
      if (opts.headshot !== false && region === 'head' && (kind === 'bullet')) G.stats.headshots++;
    }
    // limb damage -> dismember / break
    const limb = bone.limb;
    if (limb && this.limbHP[limb] !== undefined) {
      this.limbHP[limb] -= damage * (kind === 'cut' ? 1.3 : kind === 'explosion' ? 2 : kind === 'pellet' ? 1.2 : 1);
    }
    // ---- effects ----
    const dir = _c.copy(dv).normalize();
    const intensity = clamp(damage / 25, 0.4, 3);
    const sharp = kind === 'bullet' || kind === 'pellet' || kind === 'cut' || kind === 'stab' || kind === 'explosion';
    if (sharp || mag > 6) G.fx.bloodBurst(point, dir, intensity * (sharp ? 1 : 0.5), { spray: kind === 'bullet' || kind === 'pellet' });
    else if (Settings.blood && Math.random() < 0.4) G.fx.bloodBurst(point, dir, 0.3);
    if (sharp) this.bleed += kind === 'cut' ? 0.8 : 0.4;
    // paint wound onto the atlas (bone-local coordinates == geometry space)
    if (!bone.hidden) {
      _mi.copy(this.skelBones[this.bones.indexOf(bone)].matrixWorld).invert();
      const lp = _d.copy(point).applyMatrix4(_mi);
      paintDamage(this.actx, this.atlasSize, bone, lp, kind, clamp(intensity, 0.7, 2) * (kind === 'pellet' ? 0.7 : 1), this.def);
      this.atlasDirty = true;
    }
    this.lastHitRegion = region;
    // body deformation (blunt trauma)
    if ((kind === 'blunt' || kind === 'impact') && mag > 4) {
      const d = bone.dent;
      const amt = Math.min(0.06, mag * 0.004) * (region === 'head' ? 1.5 : 1);
      if (region === 'head') { d.y = Math.max(0.72, d.y - amt); d.x = Math.min(1.18, d.x + amt * 0.6); d.z = Math.max(0.8, d.z - amt * 0.5); }
      else if (region === 'torso') { d.z = Math.max(0.85, d.z - amt * 0.5); }
      else if (limb && mag > 7 && !this.broken[limb]) {
        // broken limb: goes limp
        const key = limb.startsWith('l') ? (limb.includes('Arm') || limb.includes('Fore') ? 'lArm' : 'lLeg') : (limb.includes('Arm') || limb.includes('Fore') ? 'rArm' : 'rLeg');
        if (this.limbHP[limb] < 20) { this.broken[key] = true; this.limbStiff[key] = 0.05; G.audio.play('bone', point, 1); if (key === 'rArm') this.dropWeapon(); }
      }
    }
    // sounds
    const snd = kind === 'cut' || kind === 'stab' ? 'slash' : kind === 'bullet' || kind === 'pellet' ? 'flesh' : kind === 'blunt' ? (mag > 7 ? 'bone' : 'blunt') : 'blunt';
    G.audio.play(snd, point, Math.min(1, 0.4 + damage / 40));
    if (sharp && damage > 30) G.audio.play('splat', point, 0.7);

    // ---- gameplay reaction ----
    if (this.alive) {
      this.voice('pain');
      // hit-location specific reactions
      if (region === 'head') { this.anim.flinch.addScaledVector(dir, 0.15 + mag * 0.02); this.limbStiff.head = 0.15; }
      else if (region === 'leg') {
        const key = bone.name[0] === 'l' ? 'lLeg' : 'rLeg';
        this.limbStiff[key] = 0.15;
        this.balance -= 15;
      } else if (region === 'arm') {
        const key = bone.name[0] === 'l' ? 'lArm' : 'rArm';
        this.limbStiff[key] = 0.1;
        if (key === 'rArm' && this.weapon && (kind !== 'fist' && Math.random() < (kind === 'blunt' ? 0.8 : 0.45))) this.dropWeapon(dv);
      } else this.anim.flinch.addScaledVector(dir, 0.06 + mag * 0.012);
      if (this.state === 'idle' && mag > 2.5 && this.def.id !== 'brute') this.stagger(_a.copy(dir).setY(0).multiplyScalar(Math.min(4, mag * 0.35)), 0.25 + mag * 0.04);
      else if (this.state === 'idle' && mag > 7) this.stagger(_a.copy(dir).setY(0).multiplyScalar(Math.min(3, mag * 0.2)), 0.4);
      if (this.ai) { this.ai.seenOnce = true; this.ai.coverT = Math.min(this.ai.coverT, Math.random() < 0.4 ? 0 : 3); }
    }
    // ---- dismemberment ----
    if (Settings.dismember && limb && this.limbHP[limb] <= 0 && !this.severed[limb]) {
      const allowed = kind === 'cut' || kind === 'explosion' || kind === 'pellet' || (kind === 'blunt' && mag > 9 && region !== 'torso') ||
        (kind === 'bullet' && (opts.heavy || damage >= 45)) || kind === 'impact' && mag > 12;
      if (allowed) {
        if (limb === 'head' && (kind === 'bullet' || kind === 'pellet' || kind === 'blunt') && Settings.goreIntensity >= 2 && damage >= 40) this.headBurst(point, dir);
        else this.dismember(limb, dv);
      }
    }
    if (this.alive && this.health <= 0) this.die(kind, dv);
    else if (this.alive && this.balance <= 0 && Settings.ragdoll) this.knockDown();
    if (firstHit && !this.alive && region === 'head') this.killedByHeadshot = true;
  }

  _closestT(bone, p) {
    const a = bone.pa, b = bone.pb;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    return clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz + 1e-9), 0, 1);
  }

  headBurst(point, dir) {
    const b = this.boneByName('head');
    if (this.severed.head) return;
    this.severed.head = true;
    b.hidden = true;
    for (let i = 0; i < 3; i++) G.fx.bloodBurst(point, _a.set(dir.x + rand(-0.6, 0.6), dir.y + rand(0, 0.8), dir.z + rand(-0.6, 0.6)).normalize(), 3, { spray: true });
    for (let i = 0; i < 18; i++) G.fx.blood.emit(point.x, point.y, point.z, dir.x * rand(1, 5) + rand(-2, 2), rand(0, 4), dir.z * rand(1, 5) + rand(-2, 2), rand(0.6, 1.4), 1);
    G.audio.play('splat', point, 1); G.audio.play('bone', point, 1);
    const neck = this.P.neck;
    G.fx.spurt(neck, (out) => out.set(neck.x - this.P.chest.x, neck.y - this.P.chest.y, neck.z - this.P.chest.z).normalize(), 3);
    this.P.head.collide = false;
    G.stats.dismembers++;
    if (this.alive) this.die('headshot', dir);
  }

  dismember(key, dv) {
    const D = DISMEMBER[key];
    if (!D || this.severed[key]) return;
    const P = this.P;
    const J = P[D.joint];
    const body = J.body;
    const child = D.child.map(n => P[n]);
    if (child.some(c => c.body !== body)) return; // already separated higher up
    this.severed[key] = true;
    // also mark sub-limbs as gone from the main body
    if (key === 'lArm') this.severed.lForearm = this.severed.lForearm || 'carried';
    if (key === 'rArm') this.severed.rForearm = this.severed.rForearm || 'carried';
    if (key === 'lLeg') this.severed.lShin = this.severed.lShin || 'carried';
    if (key === 'rLeg') this.severed.rShin = this.severed.rShin || 'carried';
    const J2 = new Particle(J.x, J.y, J.z, J.mass * 0.4, J.radius * 0.8);
    J2.px = J.px; J2.py = J.py; J2.pz = J.pz;
    J2.friction = 0.7; J2.tag = D.joint + '_cut';
    const piece = new Body('ragdoll');
    piece.owner = this;
    piece.damping = 0.993;
    piece.impactThreshold = 3;
    piece.add(J2);
    const set = new Set(child);
    for (const c of child) {
      const i = body.particles.indexOf(c);
      if (i >= 0) body.particles.splice(i, 1);
      piece.add(c);
    }
    body.constraints = body.constraints.filter(c => {
      const aIn = set.has(c.a), bIn = set.has(c.b);
      if (!aIn && !bIn) return true;
      if (aIn && bIn) { piece.constraints.push(c); return false; }
      const other = aIn ? c.b : c.a;
      if (other === J) { if (aIn) c.b = J2; else c.a = J2; piece.constraints.push(c); }
      return false;
    });
    for (const bn of D.bones) { const b = this.boneByName(bn); if (b.pa === J) b.pa = J2; b.detached = true; }
    // descendants bones also detached
    for (const b of this.bones) if (set.has(b.pa)) b.detached = true;
    piece.onImpact = (p, speed, nx, ny, nz, box) => { if (speed > 3) { G.audio.play('flesh', p, Math.min(1, speed / 8)); if (Settings.decals && speed > 4) G.fx.bloodDecal(_a.set(p.x, p.y - p.radius, p.z), _b.set(nx, ny, nz), 0.15); } };
    piece.onPairImpact = (p, q, speed) => { };
    G.physics.addBody(piece);
    this.pieces.push(piece);
    this.extraParticles.push(J2);
    const dt = G.physics.dt;
    if (dv) for (const p of piece.particles) p.addVel(dv.x * 0.7 + rand(-0.5, 0.5), dv.y * 0.7 + rand(0.5, 1.5), dv.z * 0.7 + rand(-0.5, 0.5), dt);
    // gore effects
    const stumpDir = (out) => out.set(J.x - P.chest.x, J.y - P.chest.y, J.z - P.chest.z).normalize();
    G.fx.spurt(J, stumpDir, 2.8);
    const nextChild = child[0];
    G.fx.spurt(J2, (out) => out.set(J2.x - nextChild.x, J2.y - nextChild.y, J2.z - nextChild.z).normalize(), 1.2);
    G.fx.bloodBurst(_a.set(J.x, J.y, J.z), stumpDir(_b), 2.5, { spray: true });
    G.audio.play('splat', J, 1); G.audio.play('bone', J, 0.8);
    this.bleed += 3;
    G.stats.dismembers++;
    // gameplay consequences
    if (key === 'head') { if (this.alive) this.die('decap', dv); }
    else if (this.alive) {
      this.health -= this.def.hp * 0.3;
      if (key.startsWith('r') && (key.includes('Arm') || key.includes('Fore'))) this.dropWeapon(dv);
      if (key.includes('Leg') || key.includes('Shin')) this.knockDown(true);
      else this.stagger(dv ? _a.copy(dv).setY(0).multiplyScalar(0.3) : _a.set(0, 0, 0), 0.8);
      if (this.health <= 0) this.die('dismember', dv);
    }
  }

  // Thrown object / weapon hits this enemy
  onObjectImpact(myP, item, itemP, speed, nx, ny, nz) {
    if (G.time - (this._lastObj || 0) < 0.12) return;
    this._lastObj = G.time;
    const bone = this.boneOfParticle.get(myP) || this.bones[1];
    const v = item.body.velocity(new THREE.Vector3(), G.physics.dt);
    const prof = item.impactProfile ? item.impactProfile(speed, v, itemP) : { damage: item.mass * speed * 1.4, kind: 'impact' };
    if (prof.damage < 3) return;
    const dv = v.clone().normalize().multiplyScalar(Math.min(12, speed * Math.min(2, item.mass / 2)));
    this.hit(bone, new THREE.Vector3(myP.x, myP.y, myP.z), dv, prof.damage, prof.kind);
    if (prof.stick && item.stickInto) item.stickInto(this, bone, myP);
  }

  onStaticImpact(p, speed, nx, ny, nz, box) {
    if (this.state !== 'ragdoll' && this.state !== 'dead' && this.state !== 'held') return;
    if (speed > 4) G.audio.play('thud', p, Math.min(1, speed / 10));
    if (speed > 6.5) {
      const bone = this.boneOfParticle.get(p) || this.bones[1];
      if (Settings.decals) G.fx.bloodDecal(_a.set(p.x - nx * p.radius, p.y - ny * p.radius, p.z - nz * p.radius), _b.set(nx, ny, nz), 0.25 + speed * 0.03);
      this.hit(bone, _c.set(p.x, p.y, p.z), _d.set(0, 0, 0), (speed - 6) * 9, 'impact');
    }
  }

  onPairImpact(p, q, speed, nx, ny, nz) {
    const other = q.body.owner;
    if (other && other.isEnemy && other !== this && speed > 6 && (this.state === 'ragdoll' || this.state === 'dead' || this.state === 'held')) {
      // body thrown into another enemy
      if (G.time - (other._lastBody || 0) > 0.3) {
        other._lastBody = G.time;
        const bone = other.boneOfParticle.get(q) || other.bones[1];
        other.hit(bone, new THREE.Vector3(q.x, q.y, q.z), new THREE.Vector3(-nx, -ny, -nz).multiplyScalar(speed * 0.6), speed * 3, 'impact');
      }
    }
  }

  explosionDamage(center, radius, power) {
    const d = Math.hypot(this.P.chest.x - center.x, this.P.chest.y - center.y, this.P.chest.z - center.z);
    if (d > radius) return;
    const f = 1 - d / radius;
    // limbs closest to the blast take the most
    let best = null, bd = 1e9;
    for (const b of this.bones) {
      if (b.detached) continue;
      const dd = Math.hypot(b.pb.x - center.x, b.pb.y - center.y, b.pb.z - center.z);
      if (dd < bd) { bd = dd; best = b; }
    }
    const dir = new THREE.Vector3(this.P.chest.x - center.x, this.P.chest.y - center.y + 0.5, this.P.chest.z - center.z).normalize();
    this.hit(best, new THREE.Vector3(best.pb.x, best.pb.y, best.pb.z), dir.multiplyScalar(4 + 10 * f), power * f, 'explosion');
    if (Settings.dismember && f > 0.55) {
      for (const k of ['lArm', 'rArm', 'lLeg', 'rLeg']) if (Math.random() < f * 0.5) this.dismember(k, dir.clone().multiplyScalar(6));
    }
    if (this.alive && f > 0.3) this.knockDown();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    G.physics.removeBody(this.body);
    for (const p of this.pieces) G.physics.removeBody(p);
    G.scene.remove(this.mesh);
    this.material.dispose();
    this.tex.dispose();
    for (const h of [...this.grabbedBy]) h.forceRelease && h.forceRelease();
    if (this.weapon && this.weapon.enemyHolder === this) this.weapon.destroy();
  }
}

// ======================= MANAGER =======================
export class EnemyManager {
  constructor() {
    this.list = [];
    this.pathBudget = 2;
  }
  spawn(type, x, z, yaw = 0) {
    // never spawn inside geometry: snap to the nearest open nav cell
    const nav = G.level && G.level.nav;
    if (nav && !nav.walkable(x, z)) {
      const c = nav.nearestOpen(...nav.cellOf(x, z));
      if (c) { const p = nav.center(c[0], c[1]); x = p.x; z = p.z; }
    }
    const e = new Enemy(type, x, z, yaw);
    this.list.push(e);
    return e;
  }
  get aliveCount() { return this.list.filter(e => e.alive).length; }
  clear() { for (const e of this.list) e.remove(); this.list.length = 0; }

  onDeath(e) {
    // corpse budget
    const dead = this.list.filter(x => !x.alive && !x.removed);
    while (dead.length > Settings.maxCorpses) {
      const old = dead.shift();
      G.fx.dustBurst(_a.set(old.P.chest.x, old.P.chest.y, old.P.chest.z), 8, 0.6);
      old.remove();
    }
    this.list = this.list.filter(x => !x.removed);
  }

  update(dt) {
    this.pathBudget = 2;
    for (const e of this.list) e.update(dt);
  }
  post(dt) { for (const e of this.list) e.post(dt); }

  forEachBone(fn) {
    for (const e of this.list) {
      if (e.removed) continue;
      for (const b of e.bones) if (!b.hidden) fn(e, b);
    }
  }

  // Ray vs every bone capsule. Returns closest {enemy, bone, dist, point}
  raycast(o, d, maxDist, ignore = null) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (e.removed || e === ignore) continue;
      // broadphase on chest
      const c = e.P.chest;
      _a.set(c.x - o.x, c.y - o.y, c.z - o.z);
      const t = _a.dot(d);
      if (t < -2 || t > bd + 2) {
        if (!e.pieces.length) continue;
      } else if (_a.addScaledVector(d, -t).length() > 1.4 * e.def.scale && !e.pieces.length) continue;
      for (const b of e.bones) {
        if (b.hidden) continue;
        const r = b.r * e.def.scale * (b.region === 'torso' ? (e.def.bulk || 1) : 1);
        const hd = rayCapsule(o, d, b.pa, b.pb, r, bd);
        if (hd >= 0 && hd < bd) { bd = hd; best = { enemy: e, bone: b, dist: hd }; }
      }
    }
    if (best) best.point = new THREE.Vector3().copy(o).addScaledVector(d, best.dist);
    return best;
  }

  // Segment (melee weapon) vs bone capsules. Returns list of hits
  segmentHits(p0, p1, radius, out = []) {
    out.length = 0;
    for (const e of this.list) {
      if (e.removed) continue;
      const c = e.P.chest;
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, mz = (p0.z + p1.z) / 2;
      if (Math.hypot(c.x - mx, c.y - my, c.z - mz) > 2.2 * e.def.scale && !e.pieces.length) continue;
      let best = null, bd = Infinity, bs = 0;
      for (const b of e.bones) {
        if (b.hidden) continue;
        const r = b.r * e.def.scale + radius;
        const d2 = segSegDist2(p0, p1, b.pa, b.pb, _res);
        if (d2 < r * r && d2 < bd) { bd = d2; best = b; bs = _res.s; }
      }
      if (best) out.push({ enemy: e, bone: best, s: bs });
    }
    return out;
  }

  pointHit(p, radius) {
    let best = null, bd = Infinity;
    this.forEachBone((e, b) => {
      const r = b.r * e.def.scale + radius;
      const d2 = segSegDist2(p, p, b.pa, b.pb, _res);
      if (d2 < r * r && d2 < bd) { bd = d2; best = { enemy: e, bone: b }; }
    });
    return best;
  }

  nearestParticle(p, maxD) {
    let best = null, bd = maxD;
    for (const e of this.list) {
      if (e.removed) continue;
      for (const q of e.allParticles) {
        const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) - q.radius * 0.7;
        if (d < bd) { bd = d; best = { particle: q, enemy: e }; }
      }
    }
    return best;
  }

  rayParticle(o, d, maxD) {
    const h = this.raycast(o, d, maxD);
    if (!h) return null;
    const pa = h.bone.pa, pb = h.bone.pb;
    const da = h.point.distanceTo(_a.set(pa.x, pa.y, pa.z)), db = h.point.distanceTo(_b.set(pb.x, pb.y, pb.z));
    return { particle: da < db ? pa : pb, enemy: h.enemy, dist: h.dist };
  }

  explosion(center, radius, power) {
    for (const e of [...this.list]) if (!e.removed) e.explosionDamage(center, radius, power);
  }
}
