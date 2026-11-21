// Base class for everything the player can grab: weapons, props, ammo, pickups.
// An Item owns a physics Body and a mesh synced to it. When held, the body is
// kinematic and placed every frame with weight-based smoothing, so releasing
// it naturally keeps the hand's linear and angular velocity (throwing).
import * as THREE from 'three';
import { G } from '../core/context.js';
import { BodyRenderer } from '../physics/verlet.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _tp = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3();

export class Item {
  constructor(body, mesh, opts = {}) {
    this.body = body;
    body.owner = this;
    this.mesh = mesh;
    G.scene.add(mesh);
    this.renderer = new BodyRenderer(body, mesh);
    this.kind = opts.kind || 'prop';
    this.name = opts.name || 'Object';
    this.mass = body.totalMass();
    this.follow = opts.follow || Math.max(6, 40 / Math.max(0.5, this.mass));
    this.grabbable = opts.grabbable !== false;
    this.holdMatrix = opts.holdMatrix || null;  // snap grip: item-local hand pose (inverse applied)
    this.secondaryLocal = opts.secondaryLocal || null; // two-hand grip point (item local)
    this.twoHanded = !!opts.twoHanded;
    this.holsterable = opts.holsterable || null;  // array of slot types
    this.heldBy = null;
    this.secondaryHand = null;
    this.holster = null;
    this.dead = false;
    this.despawnAt = opts.despawnAt || 0;
    this.radius = opts.radius || 0.3;
    this.savedInvMass = null;
    this.impactSound = opts.impactSound || 'thud';
    this.recoil = new THREE.Vector3(); // recoil offset (local rot/pos)
    this.recoilRot = 0;
    this.lastHeld = 0;
    this.incoming = null; // force-pull state
    body.onImpact = (p, speed, nx, ny, nz, box) => this.onStaticImpact(p, speed, box);
    body.onPairImpact = (p, q, speed, nx, ny, nz) => this.onPairImpact(p, q, speed, nx, ny, nz);
    G.items.push(this);
  }

  get position() { this.body.computeCenter(_p); return _p; }

  worldMatrix(out) {
    this.renderer.frame(out).multiply(this.renderer.local);
    return out;
  }

  setKinematic(on) {
    const b = this.body;
    if (on && !b.kinematic) {
      b.kinematic = true;
      this.savedInvMass = b.particles.map(p => p.invMass);
      for (const p of b.particles) p.invMass = 0;
    } else if (!on && b.kinematic) {
      b.kinematic = false;
      if (this.savedInvMass) b.particles.forEach((p, i) => p.invMass = this.savedInvMass[i]);
      b.wake();
    }
  }

  // Place the item following a target world matrix with weight lag
  driveTo(target, dt, followMul = 1, snap = false) {
    target.decompose(_tp, _tq, _ts);
    this.worldMatrix(_m).decompose(_p, _q, _s);
    let k = snap ? 1 : 1 - Math.exp(-dt * this.follow * followMul);
    const dist = _p.distanceTo(_tp);
    if (dist > 0.6) k = 1; // never lose it
    _p.lerp(_tp, k);
    _q.slerp(_tq, Math.min(1, k * 1.15));
    _m.compose(_p, _q, _ts.set(1, 1, 1));
    this.renderer.placeAt(_m, true);
  }

  // Distance from a point to the item's surface (approximate)
  surfaceDistance(pt) {
    const b = this.body;
    if (b.obb) {
      b.updateFrame();
      _p.subVectors(pt, b.center);
      const o = b.obb;
      const lx = Math.max(0, Math.abs(_p.dot(b.axes[0])) - o.hx);
      const ly = Math.max(0, Math.abs(_p.dot(b.axes[1])) - o.hy);
      const lz = Math.max(0, Math.abs(_p.dot(b.axes[2])) - o.hz);
      return Math.hypot(lx, ly, lz);
    }
    // stick bodies: distance to the segment between the first two particles
    const a = b.particles[0], c = b.particles[1];
    const abx = c.x - a.x, aby = c.y - a.y, abz = c.z - a.z;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby + (pt.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz + 1e-9)));
    const d = Math.hypot(a.x + abx * t - pt.x, a.y + aby * t - pt.y, a.z + abz * t - pt.z);
    return Math.max(0, d - (this.grabRadius || 0.05));
  }
  nearestFreeParticle(pt, maxD) {
    let best = null, bd = maxD;
    for (const p of this.body.particles) {
      if (p.invMass === 0) continue;
      const d = Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best && this.body.obb && this.surfaceDistance(pt) < 0.08) {
      // grabbed the surface: use the closest movable particle
      bd = Infinity;
      for (const p of this.body.particles) {
        if (p.invMass === 0) continue;
        const d = Math.hypot(p.x - pt.x, p.y - pt.y, p.z - pt.z);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }
  rayParticle(o, d, maxD) {
    if (!this.body.obb) return null;
    const t = G.physics.rayOBB(this.body, o, d, maxD, null);
    if (t < 0) return null;
    const hp = new THREE.Vector3().copy(o).addScaledVector(d, t);
    return this.nearestFreeParticle(hp, 10);
  }

  onGrab(hand) { this.lastHeld = G.time; this.despawnAt = 0; }
  onRelease(hand) { this.lastHeld = G.time; }
  onTrigger(hand, down, pressed) { }
  onButtonA(hand) { }
  onButtonB(hand) { }
  onStaticImpact(p, speed, box) {
    if (speed > 2.2) G.audio.play(this.impactSound === 'auto' && box ? box.material : this.impactSound, p, Math.min(1, speed / 9));
  }
  onPairImpact(p, q, speed, nx, ny, nz) {
    const other = q.body.owner;
    if (other && other.isEnemy && speed > 3.5) other.onObjectImpact(q, this, p, speed, -nx, -ny, -nz);
  }
  update(dt) {
    if (this.despawnAt && G.time > this.despawnAt && !this.heldBy && !this.holster) this.destroy();
  }
  sync() { this.renderer.sync(); }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.heldBy) this.heldBy.forceRelease();
    if (this.secondaryHand) this.secondaryHand.forceRelease();
    if (this.holster) G.player && G.player.clearHolster(this);
    G.physics.removeBody(this.body);
    G.scene.remove(this.mesh);
    const i = G.items.indexOf(this);
    if (i >= 0) G.items.splice(i, 1);
  }
}

// Helper to compute a hold matrix: where the hand sits in item-local space.
export function gripMatrix(pos, euler) {
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(euler), new THREE.Vector3(1, 1, 1));
  return m.invert(); // item-local -> hand-local transform for target = hand * this
}

// Merge child meshes of a group by material into as few draw calls as possible.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// Objects flagged userData.keep (moving parts) stay separate. Transforms are
// taken relative to the group itself.
export function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const rel = new THREE.Matrix4();
  const buckets = new Map();
  const keep = [];
  const visit = (o) => {
    for (const c of o.children) {
      if (c.userData.keep) { keep.push(c); continue; }
      if (c.isMesh) {
        const g = c.geometry.clone();
        g.applyMatrix4(rel.multiplyMatrices(inv, c.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const geo = g.index ? g.toNonIndexed() : g;
        if (!buckets.has(c.material)) buckets.set(c.material, []);
        buckets.get(c.material).push(geo);
      }
      visit(c);
    }
  };
  visit(group);
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.castShadow = true;
    out.add(m);
  }
  for (const k of keep) {
    const mw = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
    k.removeFromParent();
    mw.decompose(k.position, k.quaternion, k.scale);
    if (k.userData.base) { k.userData.base = k.position.clone(); k.userData.baseRot = k.rotation.clone(); }
    out.add(k);
  }
  return out;
}
