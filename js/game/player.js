// Player rig: VR + desktop locomotion, hands, grabbing, climbing, holsters.
import * as THREE from 'three';
import { G, clamp, lerp } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { Particle, Body, Constraint } from '../physics/verlet.js';
import { haptic } from '../core/audio.js';
import { Mat } from '../core/materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const BODY_R = 0.24;

function buildGlove(side) {
  const g = new THREE.Group();
  const s = side === 'left' ? -1 : 1;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.09), Mat.skinGlove);
  palm.position.set(0, 0, 0.0);
  g.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.06, 10), Mat.gloveCuff);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, 0.075);
  g.add(cuff);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set((-0.027 + i * 0.018) * s, 0, -0.045);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.018, 0.06), Mat.skinGlove);
    seg.position.z = -0.028;
    f.add(seg); g.add(f); fingers.push(f);
  }
  const thumb = new THREE.Group();
  thumb.position.set(-0.04 * s, -0.005, -0.01);
  const ts = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.05), Mat.skinGlove);
  ts.position.z = -0.022; thumb.add(ts);
  thumb.rotation.y = 0.6 * s;
  g.add(thumb);
  g.userData = { fingers, thumb };
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

export class Hand {
  constructor(player, side) {
    this.player = player;
    this.side = side;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.held = null;
    this.hover = null;
    this.yHold = 0;
    this.mesh = buildGlove(side);
    G.scene.add(this.mesh);
    // kinematic particle for grabbing ragdolls/doors
    this.pBody = new Body('hand');
    this.pBody.kinematic = true;
    this.particle = this.pBody.add(new Particle(0, 0, 0, 0, 0.04));
    this.particle.collide = false;
    // laser pointer
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0.8 }));
    this.laser.visible = false;
    G.scene.add(this.laser);
    this.punchCooldown = 0;
  }
  get input() { return G.input.hands[this.side]; }
  get gamepad() { return this.input.gamepad; }
  get other() { return this.side === 'left' ? this.player.right : this.player.left; }
  get heldItem() { return this.held && (this.held.kind === 'item') ? this.held.item : null; }

  setPose(pos, quat, dt) {
    this.prevPos.copy(this.pos);
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.matrix.compose(this.pos, this.quat, _v3.set(1, 1, 1));
    if (dt > 0) {
      _v.subVectors(this.pos, this.prevPos).divideScalar(dt);
      if (_v.length() < 30) this.vel.lerp(_v, 0.6);
    }
    this.particle.setPos(pos.x, pos.y, pos.z);
  }

  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }

  forceRelease() { this.release(true); }

  release(silent = false) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    if (h.kind === 'item') {
      const it = h.item;
      if (it.secondaryHand && it.secondaryHand !== this) {
        // hand the item over to the secondary hand
        const sec = it.secondaryHand;
        it.secondaryHand = null;
        sec.held = null;
        it.heldBy = null;
        sec.grabItem(it);
        return;
      }
      it.heldBy = null;
      // holster?
      if (!silent && G.player.tryHolster(it, this)) return;
      it.setKinematic(false);
      // throw assist: boost hand velocity a little
      const boost = G.isVR ? 0.25 : 0;
      if (boost > 0) it.body.addVelocity(this.vel.x * boost, this.vel.y * boost, this.vel.z * boost, G.physics.dt);
      it.onRelease(this);
    } else if (h.kind === 'secondary' || h.kind === 'rack') {
      h.item.secondaryHand = null;
      if (h.kind === 'rack' && h.item.onRackRelease) h.item.onRackRelease();
      if (h.item.onSecondaryRelease) h.item.onSecondaryRelease();
    } else if (h.kind === 'particle') {
      const j = G.physics.joints.indexOf(h.joint);
      if (j >= 0) G.physics.joints.splice(j, 1);
      if (h.enemy) h.enemy.onGrabbed(false, this);
    } else if (h.kind === 'climb') {
      if (!this.other.held || this.other.held.kind !== 'climb') {
        // fling: body moves opposite to hand motion
        const p = this.player;
        p.velY = clamp(-this.vel.y * 1.1, -3, 6);
        p.flingVel.set(-this.vel.x, 0, -this.vel.z).multiplyScalar(0.8);
      }
    }
  }

  grabItem(item) {
    if (item.heldBy && item.heldBy !== this) {
      const prev = item.heldBy;
      prev.held = null; item.heldBy = null;
    }
    if (item.secondaryHand === this) item.secondaryHand = null;
    if (item.holster) this.player.clearHolster(item);
    item.incoming = null;
    item.setKinematic(true);
    let H;
    if (item.holdMatrix) {
      H = item.holdMatrix.clone();
    } else {
      item.worldMatrix(_m);
      H = _m2.copy(this.matrix).invert().multiply(_m).clone();
      if (!G.isVR) {
        // desktop: keep relative orientation, but center the item on the hand
        const relQ = new THREE.Quaternion();
        H.decompose(_v, relQ, _v3);
        const cL = item.body.computeCenter(new THREE.Vector3()).applyMatrix4(_m.clone().invert());
        cL.applyQuaternion(relQ).negate();
        H.compose(cL, relQ, _v3.set(1, 1, 1));
      }
    }
    this.held = { kind: 'item', item, H };
    item.heldBy = this;
    item.onGrab(this);
    G.audio.play('pickup', this.pos, 0.6);
    haptic(this.gamepad, 0.3, 30);
  }

  grabParticle(particle, enemy) {
    const j = new Constraint(this.particle, particle, enemy && enemy.alive ? 0.35 : 0.6, 0, 0);
    G.physics.joints.push(j);
    particle.body.wake();
    this.held = { kind: 'particle', particle, joint: j, enemy };
    if (enemy) enemy.onGrabbed(true, this);
    haptic(this.gamepad, 0.4, 40);
    G.audio.play('flesh', this.pos, 0.3);
  }

  // Tries every grab type in priority order
  tryGrab() {
    const P = this.player, pos = this.pos, other = this.other;
    // 1. holster
    const hs = P.holsterNear(pos);
    if (hs && hs.item) { this.grabItem(hs.item); return true; }
    const otherItem = other.heldItem;
    // 2. secondary / rack / pump on item held by other hand
    if (otherItem) {
      if (otherItem.rackLocal && !otherItem.secondaryHand) {
        _v.copy(otherItem.rackLocal).applyMatrix4(otherItem.worldMatrix(_m));
        if (_v.distanceTo(pos) < 0.09) {
          this.held = { kind: 'rack', item: otherItem, start: this.alongGun(otherItem, other), lastDisp: 0 };
          otherItem.secondaryHand = this;
          haptic(this.gamepad, 0.2, 20);
          return true;
        }
      }
      if (otherItem.secondaryLocal && !otherItem.secondaryHand) {
        _v.copy(otherItem.secondaryLocal).applyMatrix4(otherItem.worldMatrix(_m));
        if (_v.distanceTo(pos) < 0.14) {
          this.held = { kind: 'secondary', item: otherItem, start: this.pos.distanceTo(other.pos) };
          otherItem.secondaryHand = this;
          haptic(this.gamepad, 0.2, 20);
          return true;
        }
      }
      // 3. ammo from belt
      if (otherItem.isGun && P.inBeltZone(pos)) {
        const ammo = G.weapons.spawnAmmoFor(otherItem, pos);
        if (ammo) { this.grabItem(ammo); return true; }
      }
    }
    // 4. items in reach
    let best = null, bestD = 0.11;
    for (const it of G.items) {
      if (!it.grabbable || it.holster || it.dead || it.grabMode === 'particle') continue;
      if (it.heldBy === this) continue;
      const d = it.surfaceDistance(pos);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (best) { this.grabItem(best); return true; }
    // 5. ragdolls / particle-grab props (doors)
    const hit = G.enemies.nearestParticle(pos, 0.16);
    if (hit) { this.grabParticle(hit.particle, hit.enemy); return true; }
    for (const it of G.items) {
      if (it.grabMode !== 'particle' || !it.grabbable) continue;
      const p = it.nearestFreeParticle(pos, 0.2);
      if (p) { this.grabParticle(p, null); return true; }
    }
    // 6. climbing
    const box = P.climbableNear(pos, 0.1);
    if (box) { this.held = { kind: 'climb', anchor: pos.clone(), box }; haptic(this.gamepad, 0.2, 20); return true; }
    // 7. force pull
    if (this.hover && !this.hover.dead && !this.hover.heldBy) {
      const it = this.hover;
      it.setKinematic(true);
      it.incoming = { hand: this, t: 0 };
      if (it.holster) P.clearHolster(it);
      G.audio.play('whoosh', it.position, 0.4);
      return true;
    }
    return false;
  }

  // Offset of this hand from the primary hand, projected on the gun's backward (+Z) axis.
  // Independent of how the gun is rotating, so aiming never registers as racking.
  alongGun(item, primary) {
    item.worldMatrix(_m);
    const back = _v2.set(0, 0, 1).transformDirection(_m);
    return _v3.subVectors(this.pos, primary.pos).dot(back);
  }

  // Find a force-pull target along the hand's pointing direction
  updateHover(origin, dir, maxDist = 7, tol = 0.13) {
    let best = null, bestA = tol;
    for (const it of G.items) {
      if (!it.grabbable || it.heldBy || it.dead || it.incoming || it.grabMode === 'particle' || it.holster) continue;
      const c = it.position;
      _v.subVectors(c, origin);
      const t = _v.dot(dir);
      if (t < 0.25 || t > maxDist) continue;
      const perp = _v.addScaledVector(dir, -t).length();
      const a = Math.max(0, perp - it.radius * 0.5) / t;
      if (a < bestA) { bestA = a; best = it; }
    }
    if (best && !G.physics.lineClear(origin, best.position)) best = null;
    this.hover = best;
    return best;
  }

  updateGlove(gripAmount) {
    const visible = !this.heldItem || this.heldItem.showHand !== false;
    this.mesh.visible = visible;
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    const curl = this.held ? 1 : gripAmount;
    for (const f of this.mesh.userData.fingers) f.rotation.x = -curl * 1.5;
    this.mesh.userData.thumb.rotation.x = -curl * 0.6;
  }
}

export class Player {
  constructor(camera) {
    this.rig = new THREE.Group();
    this.rig.name = 'rig';
    G.scene.add(this.rig);
    this.camera = camera;
    this.rig.add(camera);
    this.left = new Hand(this, 'left');
    this.right = new Hand(this, 'right');
    this.hands = [this.left, this.right];
    for (const c of G.input.controllers) { this.rig.add(c.ray); this.rig.add(c.grip); }
    this.feetY = 0;
    this.velY = 0;
    this.flingVel = new THREE.Vector3();
    this.onGround = true;
    this.crouched = false;
    this.health = 100;
    this.maxHealth = 100;
    this.alive = true;
    this.lastDamage = -10;
    this.yaw = 0; this.pitch = 0;
    this.headPos = new THREE.Vector3();
    this.bodyPos = new THREE.Vector3();
    this.snapLatch = false;
    this.jumpLatch = false;
    this.crouchLatch = false;
    this.sprint = false;
    this.stepTimer = 0;
    this.teleport = { aiming: false, valid: false, point: new THREE.Vector3() };
    this.holsters = {
      hipR: { item: null, types: ['small'], pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      hipL: { item: null, types: ['small'], pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      back: { item: null, types: ['long', 'small'], pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    };
    this.desk = { swingT: -1, swingType: 'h', swingDir: 1, ads: 0, kickT: 0, recoilPitch: 0, punchSide: 1 };
    this._buildVisuals();
  }

  _buildVisuals() {
    // teleport arc + marker
    const pts = new Float32Array(40 * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.arc = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x55ccff }));
    this.arc.visible = false; this.arc.frustumCulled = false;
    G.scene.add(this.arc);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x55ccff, transparent: true, opacity: 0.8 }));
    this.marker.visible = false;
    G.scene.add(this.marker);
    // screen-space overlays (comfort vignette + damage) parented to camera
    const vtex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      const gr = x.createRadialGradient(128, 128, 40, 128, 128, 128);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
      x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const mk = (color) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: vtex, color, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      m.position.z = -0.12; m.renderOrder = 999; m.frustumCulled = false; m.visible = false;
      this.camera.add(m);
      return m;
    };
    this.vignette = mk(0x000000);
    this.hurtOverlay = mk(0xaa0000);
    this.hurtOverlay.scale.setScalar(0.85);
    this.vignetteAmt = 0;
    this.hurtAmt = 0;
    // holster indicators (VR only)
    this.holsterMarkers = {};
    const hm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
    for (const k of Object.keys(this.holsters)) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), hm.clone());
      m.visible = false; G.scene.add(m); this.holsterMarkers[k] = m;
    }
  }

  reset(pos, yaw = 0) {
    for (const h of this.hands) h.release(true);
    for (const k in this.holsters) this.holsters[k].item = null;
    this.rig.position.set(pos.x, pos.y, pos.z);
    this.feetY = pos.y;
    this.velY = 0;
    this.flingVel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.rig.rotation.set(0, yaw, 0);
    this.health = this.maxHealth;
    this.alive = true;
    this.crouched = false;
    this.lastDamage = -10;
    if (!G.isVR) { this.camera.position.set(0, 1.65, 0); this.camera.rotation.set(0, 0, 0); }
  }

  get eyeHeight() { return G.isVR ? this.headPos.y - this.feetY : (this.crouched ? 1.0 : 1.65); }

  inBeltZone(p) {
    const dx = p.x - this.headPos.x, dz = p.z - this.headPos.z;
    return p.y < this.headPos.y - 0.45 && p.y > this.feetY + 0.4 && dx * dx + dz * dz < 0.42 * 0.42;
  }

  climbableNear(p, dist) {
    const list = G.physics.staticsAt(p.x, p.z);
    for (const b of list) {
      if (!b.enabled || !b.climbable) continue;
      const cx = clamp(p.x, b.min.x, b.max.x), cy = clamp(p.y, b.min.y, b.max.y), cz = clamp(p.z, b.min.z, b.max.z);
      if (Math.hypot(p.x - cx, p.y - cy, p.z - cz) < dist) return b;
    }
    return null;
  }

  // ---------------- Holsters ----------------
  updateHolsterPoses() {
    const yawQ = _q.setFromAxisAngle(UP, this.headYaw());
    const base = this.headPos;
    const set = (h, x, y, z, rx, ry, rz) => {
      h.pos.set(x, y, z).applyQuaternion(yawQ).add(base);
      h.quat.copy(yawQ).multiply(_q2.setFromEuler(_e.set(rx, ry, rz)));
    };
    const hipY = -Math.min(0.68, Math.max(0.45, (this.headPos.y - this.feetY) * 0.42));
    set(this.holsters.hipR, 0.22, hipY, 0.02, -Math.PI / 2, 0, 0);
    set(this.holsters.hipL, -0.22, hipY, 0.02, -Math.PI / 2, 0, 0);
    set(this.holsters.back, 0.14, -0.15, 0.2, Math.PI / 2 + 0.3, 0, 0.4);
  }
  headYaw() {
    if (!G.isVR) return this.yaw;
    this.camera.getWorldDirection(_v);
    return Math.atan2(-_v.x, -_v.z);
  }
  holsterNear(p) {
    if (!G.isVR) return null;
    let best = null, bd = 0.2;
    for (const k in this.holsters) {
      const h = this.holsters[k];
      const d = h.pos.distanceTo(p);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  tryHolster(item, hand) {
    if (!item.holsterable) return false;
    let slot = null;
    if (G.isVR) {
      const h = this.holsterNear(hand.pos);
      if (h && !h.item && item.holsterable.some(t => h.types.includes(t))) slot = h;
    }
    if (!slot) return false;
    this.putInHolster(item, slot);
    return true;
  }
  putInHolster(item, slot) {
    slot.item = item;
    item.holster = slot;
    item.setKinematic(true);
    G.audio.play('pickup', slot.pos, 0.5);
  }
  clearHolster(item) {
    for (const k in this.holsters) if (this.holsters[k].item === item) this.holsters[k].item = null;
    item.holster = null;
  }
  driveHolstered(dt) {
    for (const k in this.holsters) {
      const h = this.holsters[k];
      const m = this.holsterMarkers[k];
      m.visible = G.isVR && !G.paused;
      if (m.visible) {
        m.position.copy(h.pos);
        const near = this.hands.some(hd => hd.pos.distanceTo(h.pos) < 0.2);
        m.material.opacity = near ? 0.35 : (h.item ? 0.0 : 0.1);
      }
      if (!h.item) continue;
      if (h.item.dead) { h.item = null; continue; }
      _m.compose(h.pos, h.quat, _v3.set(1, 1, 1));
      if (h.item.holsterOffset) _m.multiply(h.item.holsterOffset);
      h.item.driveTo(_m, dt, 1, true);
    }
  }

  // ---------------- Damage ----------------
  damage(amount, from) {
    if (!this.alive) return;
    if (Settings.godMode && G.modes.current && G.modes.current.id === 'sandbox') amount = 0;
    if (G.modes.current && G.modes.current.id === 'training') amount = 0;
    this.lastDamage = G.time;
    this.hurtAmt = Math.min(1, this.hurtAmt + 0.35 + amount / 60);
    G.audio.play('hurt');
    for (const h of this.hands) haptic(h.gamepad, 0.8, 80);
    if (amount <= 0) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      for (const h of this.hands) h.release(true);
      G.modes.onPlayerDeath();
    }
  }
  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }

  // Push the player (brute slams, explosions)
  shove(vx, vy, vz) {
    this.flingVel.x += vx; this.flingVel.z += vz;
    this.velY = Math.max(this.velY, vy);
  }

  // ---------------- Per-frame ----------------
  update(dt) {
    this.rig.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.headPos);
    if (G.isVR) this.updateVRHands(dt); else this.updateDesktopHands(dt);

    if (!G.paused && this.alive) {
      if (G.isVR) this.vrLocomotion(dt); else this.desktopLocomotion(dt);
      this.applyBodyPhysics(dt);
      this.rig.updateMatrixWorld(true);
      this.camera.getWorldPosition(this.headPos);
      if (G.isVR) this.updateVRHands(0); else this.updateDesktopHands(0);
    }
    this.updateHolsterPoses();
    if (!G.paused) {
      if (G.isVR) this.vrInteract(dt); else this.desktopInteract(dt);
      this.driveHeld(dt);
      this.driveHolstered(dt);
      this.fistHits(dt);
    }
    for (const h of this.hands) h.updateGlove(G.isVR ? h.input.grip : (h.side === 'right' && h.held ? 1 : 0.3));
    if (!G.isVR) { this.left.mesh.visible = false; if (this.right.held) this.right.mesh.visible = false; }
    // overlays
    this.hurtAmt = Math.max(0, this.hurtAmt - dt * 1.4);
    const lowHp = this.alive && this.health < 35 ? (0.25 + 0.1 * Math.sin(G.time * 5)) : 0;
    const hurt = Math.max(this.hurtAmt, lowHp, this.alive ? 0 : 0.8);
    this.hurtOverlay.visible = G.isVR && hurt > 0.01;
    this.hurtOverlay.material.opacity = hurt;
    const hd = document.getElementById('hurt');
    if (hd) hd.style.opacity = G.isVR ? 0 : hurt;
    this.vignette.visible = G.isVR && this.vignetteAmt > 0.01;
    this.vignette.material.opacity = this.vignetteAmt;
    // health regen in survival-type modes
    if (this.alive && G.time - this.lastDamage > 6 && G.modes.current && G.modes.current.regen) this.heal(dt * 4);
  }

  // ---------------- VR ----------------
  updateVRHands(dt) {
    const offQ = _q2.setFromEuler(_e.set(THREE.MathUtils.degToRad(Settings.gunAngle), 0, 0));
    for (const h of this.hands) {
      const c = G.input.controllerFor(h.side);
      if (!c) continue;
      c.grip.updateMatrixWorld(true); c.ray.updateMatrixWorld(true);
      c.grip.getWorldPosition(_v);
      c.ray.getWorldQuaternion(_q);
      _q.multiply(offQ);
      h.setPose(_v, _q, dt);
    }
  }

  vrLocomotion(dt) {
    const L = G.input.hands.left, R = G.input.hands.right;
    let moving = 0;
    // smooth move
    if (Settings.locomotion === 'smooth' || true) {
      if (L.pressed.stickClick) this.sprint = !this.sprint;
      const mag = Math.hypot(L.sx, L.sy);
      if (mag > 0.05) {
        const yaw = this.headYaw();
        const speed = (this.sprint ? 4.6 : 2.8) * (this.crouched ? 0.6 : 1);
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const mx = (rx * L.sx - fx * L.sy) * speed * dt;
        const mz = (rz * L.sx - fz * L.sy) * speed * dt;
        if (Settings.locomotion === 'smooth') { this.moveBy(mx, mz); moving = mag; }
      } else this.sprint = false;
    }
    // turning
    if (Settings.turn === 'snap') {
      if (Math.abs(R.sx) > 0.7 && !this.snapLatch) { this.turnBy(-Math.sign(R.sx) * THREE.MathUtils.degToRad(Settings.snapAngle)); this.snapLatch = true; }
      if (Math.abs(R.sx) < 0.3) this.snapLatch = false;
    } else if (Math.abs(R.sx) > 0.1) { this.turnBy(-R.sx * 2.2 * dt); moving = Math.max(moving, Math.abs(R.sx)); }
    // jump / crouch / teleport on right stick Y
    const anyClimb = this.hands.some(h => h.held && h.held.kind === 'climb');
    if (Settings.locomotion === 'teleport') {
      this.updateTeleport(R.sy < -0.6, dt);
      if (R.pressed.stickClick && this.onGround && !anyClimb) { this.velY = 4.4; this.onGround = false; }
    } else {
      if ((R.sy < -0.75 && !this.jumpLatch) || R.pressed.stickClick) {
        if (this.onGround && !anyClimb) { this.velY = 4.4; this.onGround = false; }
        this.jumpLatch = true;
      }
      if (R.sy > -0.3) this.jumpLatch = false;
    }
    if (R.sy > 0.75 && !this.crouchLatch && Math.abs(R.sx) < 0.5) { this.crouched = !this.crouched; this.crouchLatch = true; }
    if (R.sy < 0.3) this.crouchLatch = false;
    // climbing
    const climbing = this.hands.filter(h => h.held && h.held.kind === 'climb');
    if (climbing.length) {
      _v.set(0, 0, 0);
      for (const h of climbing) _v.add(_v2.subVectors(h.held.anchor, h.pos));
      _v.multiplyScalar(1 / climbing.length);
      this.rig.position.add(_v);
      this.feetY += _v.y;
      this.velY = 0;
      this.flingVel.set(0, 0, 0);
      this.climbing = true;
    } else this.climbing = false;
    const target = Settings.vignette ? Math.min(0.85, moving * 0.9) : 0;
    this.vignetteAmt = lerp(this.vignetteAmt, target, 1 - Math.exp(-dt * 8));
  }

  turnBy(angle) {
    // rotate rig around the head position
    this.rig.updateMatrixWorld(true);
    this.camera.getWorldPosition(_v);
    this.rig.position.sub(_v).applyAxisAngle(UP, angle).add(_v);
    this.rig.rotation.y += angle;
    this.yaw += angle;
  }

  moveBy(dx, dz) { this.rig.position.x += dx; this.rig.position.z += dz; }

  updateTeleport(aiming, dt) {
    const T = this.teleport, h = this.right;
    if (aiming) {
      T.aiming = true;
      const pts = this.arc.geometry.attributes.position;
      const p = _v.copy(h.pos), v = this.right.forward(_v2).multiplyScalar(9);
      T.valid = false;
      let n = 0;
      const dir = new THREE.Vector3();
      for (let i = 0; i < 40; i++) {
        pts.setXYZ(i, p.x, p.y, p.z); n = i + 1;
        const np = _v3.copy(p).addScaledVector(v, 0.035);
        v.y -= 9.8 * 0.035;
        dir.subVectors(np, p); const len = dir.length(); dir.normalize();
        const hit = G.physics.raycastStatic(p, dir, len);
        if (hit) {
          if (hit.normal.y > 0.7) { T.valid = true; T.point.copy(hit.point); }
          pts.setXYZ(i + 1 < 40 ? i + 1 : i, hit.point.x, hit.point.y, hit.point.z); n = Math.min(40, i + 2);
          break;
        }
        p.copy(np);
      }
      for (let i = n; i < 40; i++) pts.setXYZ(i, p.x, p.y, p.z);
      pts.needsUpdate = true;
      this.arc.visible = true;
      this.arc.material.color.setHex(T.valid ? 0x55ccff : 0xff5544);
      this.marker.visible = T.valid;
      if (T.valid) this.marker.position.copy(T.point).y += 0.02;
    } else if (T.aiming) {
      T.aiming = false;
      this.arc.visible = false; this.marker.visible = false;
      if (T.valid) {
        this.camera.getWorldPosition(_v);
        this.rig.position.x += T.point.x - _v.x;
        this.rig.position.z += T.point.z - _v.z;
        this.rig.position.y += T.point.y - this.feetY;
        this.feetY = T.point.y;
        this.velY = 0;
        this.hurtAmt = Math.max(this.hurtAmt, 0); // (blink handled by vignette)
        this.vignetteAmt = 1;
      }
    }
  }

  vrInteract(dt) {
    const ui = G.ui;
    for (const h of this.hands) {
      const inp = h.input;
      // UI pointer takes the trigger when a menu is open
      if (ui.isOpen()) { h.hover = null; continue; }
      // menu buttons on an empty left hand
      if (h.side === 'left') {
        const holdingGun = h.heldItem && h.heldItem.isGun;
        if (inp.down.b) { h.yHold += dt; if (h.yHold > 0.8) { h.yHold = -100; ui.openPause(); } }
        else h.yHold = 0;
        if (!holdingGun && inp.pressed.b) { ui.openPause(); continue; }
        if (!holdingGun && inp.pressed.a && G.modes.current && G.modes.current.id === 'sandbox') { ui.openSpawn(); continue; }
      }
      if (inp.pressed.grip && !h.held) h.tryGrab();
      if (inp.released.grip && h.held) h.release();
      // force pull hover when empty
      if (!h.held) h.updateHover(h.pos, h.forward(_v), 7);
      else h.hover = null;
      const it = h.heldItem;
      if (it) {
        it.onTrigger(h, inp.down.trigger, inp.pressed.trigger);
        if (inp.pressed.a) it.onButtonA(h);
        if (inp.pressed.b) it.onButtonB(h);
      }
    }
    // left stick click handled in locomotion; incoming items
    this.updateIncoming(dt);
  }

  updateIncoming(dt) {
    for (const it of G.items) {
      if (!it.incoming) continue;
      const inc = it.incoming, h = inc.hand;
      const stillWanted = G.isVR ? h.input.down.grip : true;
      if (!stillWanted || h.held) { it.incoming = null; it.setKinematic(false); continue; }
      inc.t += dt;
      const target = h.matrix.clone();
      if (it.holdMatrix) target.multiply(it.holdMatrix);
      const k = Math.min(1, inc.t / 0.22);
      it.worldMatrix(_m);
      _m.decompose(_v, _q, _v3);
      const tp = new THREE.Vector3(), tq = new THREE.Quaternion();
      target.decompose(tp, tq, _v3);
      _v.lerp(tp, k * 0.5 + 0.1);
      _q.slerp(tq, k * 0.5 + 0.1);
      _m.compose(_v, _q, _v3.set(1, 1, 1));
      it.renderer.placeAt(_m, true);
      if (_v.distanceTo(tp) < 0.06 || inc.t > 0.6) { it.incoming = null; h.grabItem(it); }
    }
  }

  // Drive held items to hands each frame
  driveHeld(dt) {
    for (const h of this.hands) {
      const H = h.held;
      if (!H) continue;
      if (H.kind === 'item') {
        const it = H.item;
        if (it.dead) { h.held = null; continue; }
        _m.copy(h.matrix);
        _m.multiply(H.H);
        // two-handed aiming
        const sec = it.secondaryHand;
        let followMul = 1;
        if (sec && sec.held && sec.held.kind === 'secondary' && it.secondaryLocal) {
          _m.decompose(_v, _q, _v3);
          // direction from primary hand to secondary hand defines forward
          const fwd = _v2.subVectors(sec.pos, h.pos).normalize();
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quat);
          const look = _m2.lookAt(_v3.set(0, 0, 0), fwd, up);
          // compensate for secondary grip not being straight ahead of the grip
          const gripOff = it.secondaryLocal;
          const ang = Math.atan2(gripOff.y, -gripOff.z);
          look.multiply(new THREE.Matrix4().makeRotationX(-ang));
          _q.setFromRotationMatrix(look);
          _m.compose(h.pos, _q, _v3.set(1, 1, 1));
          followMul = 2;
          // pump: pulling the support hand back toward the grip hand
          if (it.onSecondaryMove) it.onSecondaryMove(sec.held.start - sec.pos.distanceTo(h.pos), sec);
        }
        if (sec && sec.held && sec.held.kind === 'rack' && it.onRack) {
          it.onRack(sec.alongGun(it, h) - sec.held.start, sec);
        }
        // recoil
        if (it.recoilRot > 0.0001 || it.recoilBack > 0.0001) {
          _m.multiply(_m2.makeRotationX(it.recoilRot));
          _m.multiply(_m2.makeTranslation(0, 0, it.recoilBack || 0));
          it.recoilRot *= Math.exp(-dt * 14);
          it.recoilBack = (it.recoilBack || 0) * Math.exp(-dt * 16);
        }
        it.driveTo(_m, dt, followMul * (G.isVR ? 1 : 2.5));
      } else if (H.kind === 'particle') {
        if (H.enemy && H.enemy.removed) { h.release(true); continue; }
        H.particle.body.wake();
      }
    }
  }

  // Empty hands punch enemies (VR) when moving fast
  fistHits(dt) {
    for (const h of this.hands) {
      h.punchCooldown -= dt;
      if (h.held || h.punchCooldown > 0) continue;
      if (!G.isVR && (h.side === 'left' || this.desk.swingT < 0 || this.desk.swingType !== 'punch')) continue;
      const speed = h.vel.length();
      if (speed < 2.6) continue;
      const hit = G.enemies.pointHit(h.pos, 0.07);
      if (hit) {
        h.punchCooldown = 0.25;
        const dir = h.vel.clone().normalize();
        hit.enemy.hit(hit.bone, h.pos, dir.multiplyScalar(Math.min(9, speed * 1.2)), 4 + speed * 2.2, 'fist');
        haptic(h.gamepad, 0.7, 50);
      }
    }
  }

  // ---------------- Body physics (collision with world) ----------------
  applyBodyPhysics(dt) {
    const head = this.headPos;
    const bx = head.x, bz = head.z;
    // horizontal collision
    let px = bx + this.flingVel.x * dt, pz = bz + this.flingVel.z * dt;
    this.flingVel.multiplyScalar(this.onGround ? Math.exp(-dt * 8) : Math.exp(-dt * 1));
    const height = Math.max(1.0, this.eyeHeight + 0.1);
    const lowY = this.feetY + 0.38, highY = this.feetY + height;
    const boxes = G.physics.staticsInRect(px - 0.5, pz - 0.5, px + 0.5, pz + 0.5, this._near || (this._near = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const b of boxes) {
        if (b.max.y < lowY || b.min.y > highY) continue;
        const cx = clamp(px, b.min.x, b.max.x), cz = clamp(pz, b.min.z, b.max.z);
        let dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= BODY_R * BODY_R) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = BODY_R - d;
          px += dx / d * push; pz += dz / d * push;
        } else {
          // inside: push along shortest axis
          const l = px - b.min.x, r = b.max.x - px, f = pz - b.min.z, bk = b.max.z - pz;
          const m = Math.min(l, r, f, bk);
          if (m === l) px = b.min.x - BODY_R; else if (m === r) px = b.max.x + BODY_R; else if (m === f) pz = b.min.z - BODY_R; else pz = b.max.z + BODY_R;
        }
      }
    }
    // push against dynamic props / enemies
    this.pushDynamics(px, pz, dt);
    this.rig.position.x += px - bx;
    this.rig.position.z += pz - bz;
    // vertical
    if (!this.climbing) {
      this.velY -= 9.8 * dt;
      this.feetY += this.velY * dt;
    }
    const ground = G.physics.groundHeight(px, pz, this.feetY, 0.42);
    // also stand on props
    const propTop = this.propGround(px, pz);
    const g = Math.max(ground, propTop);
    if (this.feetY <= g + 0.001 && this.velY <= 0.01) {
      if (g - this.feetY > 0.02) this.feetY = lerp(this.feetY, g, 1 - Math.exp(-dt * 20)); else this.feetY = g;
      if (this.velY < -7) this.damage(Math.floor((-this.velY - 7) * 8), null);
      if (!this.onGround && this.velY < -2) G.audio.play('step', head, 1);
      this.velY = 0;
      this.onGround = true;
    } else if (this.feetY > g + 0.05) this.onGround = this.climbing;
    // ceiling
    const ceilHit = G.physics.raycastStatic(_v.set(px, this.feetY + 0.5, pz), _v2.set(0, 1, 0), height - 0.4);
    if (ceilHit && this.velY > 0) this.velY = 0;
    if (this.feetY < -15) { // fell out of the world
      const sp = G.level && G.level.playerSpawn;
      if (sp) this.reset(sp.pos, sp.yaw);
    }
    const crouchOff = G.isVR && this.crouched ? -0.5 : 0;
    this.rig.position.y = this.feetY + crouchOff + (G.isVR ? 0 : 0);
    // footsteps
    const moved = Math.hypot(px - bx, pz - bz) / Math.max(dt, 1e-4);
    if (this.onGround && moved > 1.2) {
      this.stepTimer -= dt * moved;
      if (this.stepTimer <= 0) { this.stepTimer = 1.4; G.audio.play('step', _v.set(px, this.feetY, pz), 0.8); }
    }
  }

  propGround(x, z) {
    let top = -100;
    for (const it of G.items) {
      const b = it.body;
      if (!b.obb || it.heldBy || it.holster || b.kinematic) continue;
      if (it.mass < 4) continue;
      b.updateFrame();
      const c = b.center;
      if (Math.abs(c.x - x) > b.bRadius || Math.abs(c.z - z) > b.bRadius) continue;
      // top surface height (approx: highest corner)
      if (Math.abs(b.axes[1].y) < 0.8) continue;
      const t = c.y + b.obb.hy * Math.abs(b.axes[1].y);
      const lx = (x - c.x) * b.axes[0].x + (z - c.z) * b.axes[0].z;
      const lz = (x - c.x) * b.axes[2].x + (z - c.z) * b.axes[2].z;
      if (Math.abs(lx) < b.obb.hx + 0.05 && Math.abs(lz) < b.obb.hz + 0.05 && t <= this.feetY + 0.45 && t > top) top = t;
    }
    return top;
  }

  pushDynamics(px, pz, dt) {
    // Shove light objects/enemies the player walks into
    const R = BODY_R + 0.05;
    G.physics.queryParticles(px, this.feetY + 0.6, pz, 0.9, (p) => {
      const b = p.body;
      if (b.kinematic || p.invMass === 0 || b.type === 'hand') return;
      if (p.y < this.feetY + 0.15 || p.y > this.feetY + this.eyeHeight) return;
      const dx = p.x - px, dz = p.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > R + p.radius || d < 1e-5) return;
      const push = (R + p.radius - d) * 0.5;
      p.x += dx / d * push; p.z += dz / d * push;
      b.wake();
    });
  }

  // ---------------- Desktop ----------------
  desktopLocomotion(dt) {
    const I = G.input;
    const sens = 0.0022 * Settings.mouseSens;
    if (I.locked) {
      this.yaw -= I.mouse.dx * sens;
      this.pitch = clamp(this.pitch - I.mouse.dy * sens, -1.45, 1.45);
    }
    this.desk.recoilPitch *= Math.exp(-dt * 10);
    this.rig.rotation.set(0, this.yaw, 0);
    this.camera.rotation.set(this.pitch + this.desk.recoilPitch, 0, 0, 'YXZ');
    if (I.keyPressed('KeyC') || I.keyPressed('ControlLeft')) this.crouched = !this.crouched;
    const eye = this.crouched ? 1.0 : 1.65;
    this.camera.position.y = lerp(this.camera.position.y, eye, 1 - Math.exp(-dt * 12));
    let mx = 0, mz = 0;
    if (I.key('KeyW')) mz -= 1; if (I.key('KeyS')) mz += 1;
    if (I.key('KeyA')) mx -= 1; if (I.key('KeyD')) mx += 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const speed = (I.key('ShiftLeft') ? 5.2 : 3.2) * (this.crouched ? 0.55 : 1);
      mx /= len; mz /= len;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.moveBy((mx * c + mz * s) * speed * dt, (-mx * s + mz * c) * speed * dt);
    }
    if (I.keyPressed('Space')) {
      if (this.onGround) { this.velY = 4.6; this.onGround = false; }
      this.tryMantle();
    }
  }

  tryMantle() {
    // climb onto ledges up to 1.6 m (desktop substitute for hand climbing)
    const fwd = _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const probe = _v2.copy(this.headPos).addScaledVector(fwd, 0.55);
    const top = G.physics.groundHeight(probe.x, probe.z, this.feetY + 1.7, 0);
    if (top > this.feetY + 0.45 && top < this.feetY + 1.75) {
      // must have head room
      const clear = !G.physics.raycastStatic(_v3.set(probe.x, top + 0.05, probe.z), new THREE.Vector3(0, 1, 0), 1.5);
      if (clear) {
        this.rig.position.x = probe.x - (this.headPos.x - this.rig.position.x);
        this.rig.position.z = probe.z - (this.headPos.z - this.rig.position.z);
        this.feetY = top; this.velY = 0;
        G.audio.play('step', probe, 1);
      }
    }
  }

  desktopHandPose(out, quatOut, dt) {
    const D = this.desk;
    const it = this.right.heldItem;
    const camQ = this.camera.getWorldQuaternion(_q2);
    const camP = this.camera.getWorldPosition(_v3);
    let lp = new THREE.Vector3(0.24, -0.26, -0.42);
    let le = new THREE.Euler(0, 0, 0);
    const aimed = it && it.isGun;
    if (it && it.isMelee) { lp.set(0.3, -0.3, -0.45); le.set(0.9, 0.15, -0.2); }
    else if (it && !it.isGun) {
      const big = it.mass > 6 || it.radius > 0.35;
      lp.set(big ? 0 : 0.25, big ? -0.2 : -0.22, big ? -0.85 : -0.55);
    } else if (this.right.held && this.right.held.kind === 'particle') lp.set(0.15, -0.15, -0.75);
    if (aimed) {
      D.ads = lerp(D.ads, G.input.mouseDown(2) ? 1 : 0, 1 - Math.exp(-dt * 14));
      lp.set(lerp(0.2, 0, D.ads), lerp(-0.2, -0.09 - (it.sightHeight || 0.04), D.ads), lerp(-0.42, -0.33, D.ads));
    } else D.ads = lerp(D.ads, 0, 0.3);
    // melee/punch swing animation
    if (D.swingT >= 0) {
      D.swingT += dt;
      const S = SWINGS[D.swingType];
      const t = D.swingT;
      let a, b, k;
      if (t < S.wind) { a = S.rest || null; b = S.k0; k = t / S.wind; }
      else if (t < S.wind + S.strike) { a = S.k0; b = S.k1; k = (t - S.wind) / S.strike; }
      else if (t < S.total) { a = S.k1; b = null; k = (t - S.wind - S.strike) / (S.total - S.wind - S.strike); }
      else { D.swingT = -1; }
      if (D.swingT >= 0) {
        const ease = k * k * (3 - 2 * k);
        const A = a || { p: lp.toArray(), e: [le.x, le.y, le.z] }, B = b || { p: lp.toArray(), e: [le.x, le.y, le.z] };
        const mir = D.swingDir;
        lp.set(lerp(A.p[0] * (a ? mir : 1), B.p[0] * (b ? mir : 1), ease), lerp(A.p[1], B.p[1], ease), lerp(A.p[2], B.p[2], ease));
        le.set(lerp(A.e[0], B.e[0], ease), lerp(A.e[1] * (a ? mir : 1), B.e[1] * (b ? mir : 1), ease), lerp(A.e[2] * (a ? mir : 1), B.e[2] * (b ? mir : 1), ease));
      }
    }
    out.copy(lp).applyQuaternion(camQ).add(camP);
    quatOut.copy(camQ).multiply(new THREE.Quaternion().setFromEuler(le));
    if (aimed) {
      // converge on crosshair point
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camQ);
      const hit = G.physics.raycastStatic(camP, dir, 60);
      const dist = hit ? Math.max(1.5, hit.dist) : 60;
      const target = camP.clone().addScaledVector(dir, dist);
      const muzzleOff = it.muzzleLocal ? it.muzzleLocal.y : 0;
      _m2.lookAt(out, target, new THREE.Vector3(0, 1, 0).applyQuaternion(camQ));
      quatOut.setFromRotationMatrix(_m2);
      void muzzleOff;
    }
  }

  updateDesktopHands(dt) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    this.desktopHandPose(p, q, dt);
    this.right.setPose(p, q, dt);
    // left hand stays out of view (used only for two-handed visuals)
    const camQ = this.camera.getWorldQuaternion(_q2);
    const lp = new THREE.Vector3(-0.25, -0.35, -0.3).applyQuaternion(camQ).add(this.camera.getWorldPosition(_v3));
    this.left.setPose(lp, camQ, dt);
  }

  desktopInteract(dt) {
    const I = G.input, R = this.right, D = this.desk;
    const camP = this.camera.getWorldPosition(new THREE.Vector3());
    const camDir = this.camera.getWorldDirection(new THREE.Vector3());
    if (G.ui.isOpen()) return;
    // hover / pickup target
    if (!R.held) R.updateHover(camP, camDir, 3.2, 0.09); else R.hover = null;
    if (I.keyPressed('KeyE')) {
      if (R.held) R.release();
      else {
        const eh = G.enemies.rayParticle(camP, camDir, 2.4);
        if (R.hover && (!eh || camP.distanceTo(R.hover.position) < eh.dist)) R.grabItem(R.hover);
        else if (eh) R.grabParticle(eh.particle, eh.enemy);
        else {
          for (const it of G.items) {
            if (it.grabMode !== 'particle') continue;
            const pp = it.rayParticle ? it.rayParticle(camP, camDir, 2.4) : null;
            if (pp) { R.grabParticle(pp, null); break; }
          }
        }
      }
    }
    const it = R.heldItem;
    // fire / swing
    if (it && it.isGun) {
      it.onTrigger(R, I.mouseDown(0), I.mousePressed(0));
      if (I.keyPressed('KeyR')) it.desktopReload && it.desktopReload();
      if (I.keyPressed('KeyG')) this.desktopThrow();
    } else if (I.mousePressed(0) && D.swingT < 0) {
      if (it && it.isMelee) {
        D.swingType = it.def.swing || 'h';
        D.swingDir = D.swingType === 'v' || D.swingType === 'stab' ? 1 : -D.swingDir || 1;
        D.swingT = 0;
        G.audio.play('whoosh', R.pos, 0.8);
      } else if (!it) {
        D.swingType = 'punch'; D.swingDir = 1; D.swingT = 0;
      } else {
        // non-weapon item: swing it too
        D.swingType = 'h'; D.swingDir = -D.swingDir || 1; D.swingT = 0;
      }
    }
    if (I.mousePressed(2) && it && !it.isGun) this.desktopThrow();
    if (I.keyPressed('KeyQ')) this.desktopSwap();
    if (I.keyPressed('KeyF')) this.kick();
    this.updateIncoming(dt);
  }

  desktopThrow() {
    const R = this.right, it = R.heldItem;
    if (!it) { if (R.held) R.release(); return; }
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    R.release(true);
    const sp = clamp(14 / Math.sqrt(Math.max(0.5, it.mass)), 4, 16);
    const dt = G.physics.dt;
    for (const p of it.body.particles) { p.px = p.x - (dir.x * sp) * dt; p.py = p.y - (dir.y * sp + 1.5) * dt; p.pz = p.z - (dir.z * sp) * dt; }
    // spin
    if (it.isMelee || it.isGun) {
      const P = it.body.particles;
      P[1].px -= dir.x * 0.0 + 0; P[1].py += 3 * dt;
    }
    it.body.wake();
    G.audio.play('whoosh', R.pos, 0.6);
  }

  desktopSwap() {
    const R = this.right;
    const cur = R.heldItem;
    const slots = ['hipR', 'back', 'hipL'];
    let next = null;
    for (const k of slots) if (this.holsters[k].item && this.holsters[k].item !== cur) { next = this.holsters[k].item; break; }
    if (cur && cur.holsterable) {
      const free = slots.map(k => this.holsters[k]).find(h => !h.item && cur.holsterable.some(t => h.types.includes(t)));
      if (free) { R.held = null; cur.heldBy = null; this.putInHolster(cur, free); }
      else if (!next) return;
      else return;
    }
    if (next) R.grabItem(next);
  }

  kick() {
    const D = this.desk;
    if (G.time - D.kickT < 0.6) return;
    D.kickT = G.time;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const origin = new THREE.Vector3(this.headPos.x, this.feetY + 0.7, this.headPos.z);
    G.audio.play('whoosh', origin, 0.6);
    let hitAny = false;
    for (const e of G.enemies.list) {
      if (e.removed) continue;
      const pel = e.P.pelvis;
      const dx = pel.x - origin.x, dz = pel.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5 || (dx * fwd.x + dz * fwd.z) / Math.max(d, 1e-4) < 0.5) continue;
      e.hit(e.boneByName('abdomen'), new THREE.Vector3(pel.x, pel.y, pel.z), fwd.clone().multiplyScalar(8).setY(1.5), 12, 'kick');
      hitAny = true;
    }
    // push props
    G.physics.queryParticles(origin.x + fwd.x * 0.8, origin.y - 0.2, origin.z + fwd.z * 0.8, 0.8, (p) => {
      if (p.body.type === 'ragdoll' || p.invMass === 0 || p.body.kinematic) return;
      p.addVel(fwd.x * 5, 1.5, fwd.z * 5, G.physics.dt); p.body.wake(); hitAny = true;
    });
    if (hitAny) G.audio.play('blunt', origin, 0.8);
  }
}

// Desktop swing keyframes (camera space), mirrored by swingDir for alternating swings
const SWINGS = {
  h: { wind: 0.14, strike: 0.13, total: 0.5, k0: { p: [0.45, -0.02, -0.2], e: [0.2, -1.35, -0.3] }, k1: { p: [-0.4, -0.22, -0.5], e: [0.05, 1.2, 0.3] } },
  v: { wind: 0.22, strike: 0.15, total: 0.65, k0: { p: [0.18, 0.28, -0.12], e: [1.9, 0, 0] }, k1: { p: [0.02, -0.4, -0.6], e: [-0.7, 0, 0] } },
  stab: { wind: 0.1, strike: 0.08, total: 0.36, k0: { p: [0.22, -0.18, -0.15], e: [0, 0, 0] }, k1: { p: [0.04, -0.08, -0.82], e: [0, 0, 0] } },
  punch: { wind: 0.06, strike: 0.08, total: 0.3, k0: { p: [0.26, -0.22, -0.25], e: [0, 0, 0] }, k1: { p: [0.06, -0.1, -0.78], e: [0, 0, 0] } },
};
