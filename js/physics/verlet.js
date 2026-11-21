// Lightweight position-based (Verlet) physics engine.
// Everything dynamic — ragdolls, props, doors, weapons, severed limbs — is a Body
// made of particles held together by distance constraints. This keeps the cost
// predictable on standalone headsets and makes dismemberment trivial
// (cut constraints, split the body).
import * as THREE from 'three';

let _pid = 0;

export class Particle {
  constructor(x, y, z, mass = 1, radius = 0.05) {
    this.id = _pid++;
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.mass = mass;
    this.radius = radius;
    this.body = null;
    this.friction = 0.6;
    this.bounce = 0.1;
    this.collide = true;
    this.gravityScale = 1;
    this.tag = null;        // e.g. bone name
  }
  setPos(x, y, z) { this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z; }
  vel(out, dt) { return out.set((this.x - this.px) / dt, (this.y - this.py) / dt, (this.z - this.pz) / dt); }
  addVel(vx, vy, vz, dt) { this.px -= vx * dt; this.py -= vy * dt; this.pz -= vz * dt; }
}

export class Constraint {
  constructor(a, b, stiffness = 1, mode = 0, rest = null) {
    this.a = a; this.b = b;
    this.rest = rest !== null ? rest : Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    this.stiffness = stiffness;
    this.mode = mode; // 0 = equal, 1 = min distance, 2 = max distance
  }
  solve() {
    const a = this.a, b = this.b;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 1e-12) return;
    const d = Math.sqrt(d2);
    if (this.mode === 1 && d >= this.rest) return;
    if (this.mode === 2 && d <= this.rest) return;
    const w = a.invMass + b.invMass;
    if (w === 0) return;
    const s = ((d - this.rest) / d) * this.stiffness / w;
    const wa = a.invMass * s, wb = b.invMass * s;
    a.x += dx * wa; a.y += dy * wa; a.z += dz * wa;
    b.x -= dx * wb; b.y -= dy * wb; b.z -= dz * wb;
  }
}

export class Body {
  constructor(type = 'prop') {
    this.type = type;
    this.particles = [];
    this.constraints = [];
    this.owner = null;          // game object that owns this body
    this.sleeping = false;
    this.sleepTimer = 0;
    this.canSleep = true;
    this.kinematic = false;     // positions driven externally (held items)
    this.active = true;
    this.damping = 0.995;
    this.obb = null;            // { hx, hy, hz } for 8-corner box bodies
    this.selfCollide = false;
    this.noCollideWith = null;  // another Body to ignore
    this.impactThreshold = 2.0; // m/s for onImpact callbacks
    this.onImpact = null;       // (particle, speed, nx, ny, nz, other) => void
    this.lastImpact = 0;
    // cached OBB frame
    this.center = new THREE.Vector3();
    this.axes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.bRadius = 0;
  }
  add(p) { p.body = this; this.particles.push(p); return p; }
  link(a, b, stiffness = 1, mode = 0, rest = null) {
    const c = new Constraint(a, b, stiffness, mode, rest);
    this.constraints.push(c);
    return c;
  }
  wake() { this.sleeping = false; this.sleepTimer = 0; }
  addVelocity(vx, vy, vz, dt) { for (const p of this.particles) p.addVel(vx, vy, vz, dt); this.wake(); }
  totalMass() { let m = 0; for (const p of this.particles) m += p.mass; return m; }
  computeCenter(out) {
    out.set(0, 0, 0);
    for (const p of this.particles) { out.x += p.x; out.y += p.y; out.z += p.z; }
    return out.multiplyScalar(1 / this.particles.length);
  }
  velocity(out, dt) {
    out.set(0, 0, 0);
    for (const p of this.particles) { out.x += p.x - p.px; out.y += p.y - p.py; out.z += p.z - p.pz; }
    return out.multiplyScalar(1 / (this.particles.length * dt));
  }
  // Updates center/axes for 8-corner box bodies. Corner i bits: 1=+x, 2=+y, 4=+z
  updateFrame() {
    const P = this.particles;
    if (this.obb && P.length > 8) {
      this.center.set(0, 0, 0);
      for (let i = 0; i < 8; i++) { this.center.x += P[i].x; this.center.y += P[i].y; this.center.z += P[i].z; }
      this.center.multiplyScalar(1 / 8);
    } else this.computeCenter(this.center);
    if (this.obb && P.length >= 8) {
      const ax = this.axes[0].set(0, 0, 0), ay = this.axes[1].set(0, 0, 0);
      for (let i = 0; i < 8; i++) {
        const p = P[i], sx = (i & 1) ? 1 : -1, sy = (i & 2) ? 1 : -1;
        ax.x += p.x * sx; ax.y += p.y * sx; ax.z += p.z * sx;
        ay.x += p.x * sy; ay.y += p.y * sy; ay.z += p.z * sy;
      }
      ax.normalize();
      ay.addScaledVector(ax, -ay.dot(ax)).normalize();
      this.axes[2].crossVectors(ax, ay);
    }
    let r = 0;
    for (const p of P) {
      const d = Math.hypot(p.x - this.center.x, p.y - this.center.y, p.z - this.center.z) + p.radius;
      if (d > r) r = d;
    }
    this.bRadius = r;
  }
}

// Static axis-aligned box collider used for level geometry.
export class StaticBox {
  constructor(min, max, material = 'concrete', opts = {}) {
    this.min = min; this.max = max;
    this.material = material;
    this.climbable = !!opts.climbable;
    this.enabled = true;
    this.owner = opts.owner || null;
    this.noNav = !!opts.noNav;
  }
}

const CELL = 0.45;      // particle hash cell
const SCELL = 2.0;      // static grid cell

export class PhysicsWorld {
  constructor() {
    this.bodies = [];
    this.statics = [];
    this.joints = [];       // cross-body constraints (grabs)
    this.gravity = -9.81;
    this.iterations = 5;
    this.prevDt = 1 / 72;
    this.dt = 1 / 72;
    this.time = 0;
    this.sgrid = new Map();
    this.sbounds = { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
    this.hash = new Map();
    this._hashPool = [];
    this._v = new THREE.Vector3();
    this._q = [];
  }

  clear() {
    this.bodies.length = 0; this.statics.length = 0; this.joints.length = 0;
    this.sgrid.clear();
  }

  addStatic(min, max, material, opts) {
    const b = new StaticBox(min, max, material, opts);
    this.statics.push(b);
    return b;
  }

  buildStaticGrid() {
    this.sgrid.clear();
    for (const b of this.statics) this._gridInsert(b);
  }
  _gridInsert(b) {
    const x0 = Math.floor(b.min.x / SCELL), x1 = Math.floor(b.max.x / SCELL);
    const z0 = Math.floor(b.min.z / SCELL), z1 = Math.floor(b.max.z / SCELL);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = x * 100003 + z;
      let arr = this.sgrid.get(k);
      if (!arr) { arr = []; this.sgrid.set(k, arr); }
      arr.push(b);
    }
  }
  staticsAt(x, z) { return this.sgrid.get(Math.floor(x / SCELL) * 100003 + Math.floor(z / SCELL)) || EMPTY; }
  staticsInRect(x0, z0, x1, z1, out) {
    out.length = 0;
    const cx0 = Math.floor(x0 / SCELL), cx1 = Math.floor(x1 / SCELL);
    const cz0 = Math.floor(z0 / SCELL), cz1 = Math.floor(z1 / SCELL);
    for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) {
      const arr = this.sgrid.get(x * 100003 + z);
      if (!arr) continue;
      for (const b of arr) if (b.enabled && !out.includes(b)) out.push(b);
    }
    return out;
  }

  addBody(b) { if (!this.bodies.includes(b)) this.bodies.push(b); return b; }
  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    this.joints = this.joints.filter(j => j.a.body !== b && j.b.body !== b);
  }

  // Highest walkable surface at (x,z) not higher than fromY + step
  groundHeight(x, z, fromY = 100, step = 0.4) {
    let h = -100;
    for (const b of this.staticsAt(x, z)) {
      if (!b.enabled) continue;
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      if (b.max.y <= fromY + step && b.max.y > h) h = b.max.y;
    }
    return h;
  }

  step(dt) {
    this.dt = dt;
    this.time += dt;
    const ratio = dt / this.prevDt;
    const gstep = this.gravity * dt * (dt + this.prevDt) * 0.5;
    const bodies = this.bodies;

    // Integrate
    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi];
      if (!b.active || b.sleeping || b.kinematic) continue;
      const damp = Math.pow(b.damping, dt * 72) * ratio;
      for (const p of b.particles) {
        if (p.invMass === 0) { p.px = p.x; p.py = p.y; p.pz = p.z; continue; }
        const vx = (p.x - p.px) * damp, vy = (p.y - p.py) * damp, vz = (p.z - p.pz) * damp;
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x += vx; p.y += vy + gstep * p.gravityScale; p.z += vz;
      }
    }

    // Solve constraints + static collisions
    const iters = this.iterations;
    for (let it = 0; it < iters; it++) {
      for (let bi = 0; bi < bodies.length; bi++) {
        const b = bodies[bi];
        if (!b.active || b.sleeping || b.kinematic) continue;
        const cs = b.constraints;
        for (let i = 0; i < cs.length; i++) cs[i].solve();
      }
      for (const j of this.joints) j.solve();
      if (it >= iters - 2) this._collideStatics(it === iters - 1);
    }

    this._collideParticles();
    this._collideOBBs();
    this._collideStatics(false);
    this._sleepCheck(dt);
    this.prevDt = dt;
  }

  _collideStatics(report) {
    const bodies = this.bodies, dt = this.dt;
    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi];
      if (!b.active || b.sleeping || b.kinematic) continue;
      for (const p of b.particles) {
        if (!p.collide || p.invMass === 0) continue;
        const list = this.staticsAt(p.x, p.z);
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (!s.enabled) continue;
          this._particleBox(p, s, report, dt);
        }
        // Absolute floor safety
        if (p.y < -20) { p.y = p.py = -20; }
      }
    }
  }

  _particleBox(p, s, report, dt) {
    const r = p.radius;
    if (p.x < s.min.x - r || p.x > s.max.x + r || p.y < s.min.y - r || p.y > s.max.y + r || p.z < s.min.z - r || p.z > s.max.z + r) return;
    // closest point
    const cx = p.x < s.min.x ? s.min.x : p.x > s.max.x ? s.max.x : p.x;
    const cy = p.y < s.min.y ? s.min.y : p.y > s.max.y ? s.max.y : p.y;
    const cz = p.z < s.min.z ? s.min.z : p.z > s.max.z ? s.max.z : p.z;
    let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz;
    let d2 = nx * nx + ny * ny + nz * nz;
    let pen;
    if (d2 > 1e-12) {
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2);
      nx /= d; ny /= d; nz /= d;
      pen = r - d;
    } else {
      // center inside: push out along smallest axis
      const dxn = p.x - s.min.x, dxp = s.max.x - p.x;
      const dyn = p.y - s.min.y, dyp = s.max.y - p.y;
      const dzn = p.z - s.min.z, dzp = s.max.z - p.z;
      let m = dyp; nx = 0; ny = 1; nz = 0;
      if (dxn < m) { m = dxn; nx = -1; ny = 0; nz = 0; }
      if (dxp < m) { m = dxp; nx = 1; ny = 0; nz = 0; }
      if (dyn < m) { m = dyn; nx = 0; ny = -1; nz = 0; }
      if (dzn < m) { m = dzn; nx = 0; ny = 0; nz = -1; }
      if (dzp < m) { m = dzp; nx = 0; ny = 0; nz = 1; }
      pen = m + r;
    }
    p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
    // velocity response
    const vx = p.x - p.px, vy = p.y - p.py, vz = p.z - p.pz;
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn < 0) {
      const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
      const f = p.friction;
      const nvx = tx * (1 - f) - vn * p.bounce * nx;
      const nvy = ty * (1 - f) - vn * p.bounce * ny;
      const nvz = tz * (1 - f) - vn * p.bounce * nz;
      p.px = p.x - nvx; p.py = p.y - nvy; p.pz = p.z - nvz;
      if (report) {
        const b = p.body;
        const speed = -vn / dt;
        if (b && b.onImpact && speed > b.impactThreshold && this.time - b.lastImpact > 0.06) {
          b.lastImpact = this.time;
          b.onImpact(p, speed, nx, ny, nz, s);
        }
      }
    }
  }

  _hashKey(ix, iy, iz) { return (ix * 92837111) ^ (iy * 689287499) ^ (iz * 283923481); }

  _buildHash() {
    const hash = this.hash;
    for (const arr of hash.values()) { arr.length = 0; this._hashPool.push(arr); }
    hash.clear();
    for (const b of this.bodies) {
      if (!b.active) continue;
      for (const p of b.particles) {
        if (!p.collide) continue;
        const k = this._hashKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL));
        let arr = hash.get(k);
        if (!arr) { arr = this._hashPool.pop() || []; hash.set(k, arr); }
        arr.push(p);
      }
    }
  }

  // Calls fn(p) for particles within radius of point
  queryParticles(x, y, z, radius, fn) {
    const r = Math.ceil(radius / CELL);
    const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL), iz = Math.floor(z / CELL);
    const r2 = radius * radius;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      const arr = this.hash.get(this._hashKey(ix + a, iy + b, iz + c));
      if (!arr) continue;
      for (const p of arr) {
        const dx = p.x - x, dy = p.y - y, dz = p.z - z;
        if (dx * dx + dy * dy + dz * dz <= r2) fn(p);
      }
    }
  }

  _collideParticles() {
    this._buildHash();
    const dt = this.dt;
    for (const arr of this.hash.values()) {
      for (const p of arr) {
        const pb = p.body;
        const ix = Math.floor(p.x / CELL), iy = Math.floor(p.y / CELL), iz = Math.floor(p.z / CELL);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          const cell = this.hash.get(this._hashKey(ix + a, iy + b, iz + c));
          if (!cell) continue;
          for (const q of cell) {
            if (q.id <= p.id) continue;
            const qb = q.body;
            if (qb === pb && !pb.selfCollide) continue;
            if (pb.sleeping && qb.sleeping) continue;
            if (pb.noCollideWith === qb || qb.noCollideWith === pb) continue;
            const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
            const rr = p.radius + q.radius;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr || d2 < 1e-12) continue;
            const w = p.invMass + q.invMass;
            if (w === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d, nz = dz / d;
            // relative normal velocity (for impact callbacks)
            const rvx = (q.x - q.px) - (p.x - p.px), rvy = (q.y - q.py) - (p.y - p.py), rvz = (q.z - q.pz) - (p.z - p.pz);
            const rvn = -(rvx * nx + rvy * ny + rvz * nz) / dt;
            const pen = (rr - d) / w;
            p.x -= nx * pen * p.invMass; p.y -= ny * pen * p.invMass; p.z -= nz * pen * p.invMass;
            q.x += nx * pen * q.invMass; q.y += ny * pen * q.invMass; q.z += nz * pen * q.invMass;
            if (pb.sleeping) pb.wake();
            if (qb.sleeping) qb.wake();
            if (rvn > 2.5) this._pairImpact(p, q, rvn, nx, ny, nz);
          }
        }
      }
    }
  }

  _pairImpact(p, q, speed, nx, ny, nz) {
    const pb = p.body, qb = q.body;
    if (pb.onPairImpact) pb.onPairImpact(p, q, speed, -nx, -ny, -nz);
    if (qb.onPairImpact) qb.onPairImpact(q, p, speed, nx, ny, nz);
  }

  _collideOBBs() {
    const v = this._v;
    for (const box of this.bodies) {
      if (!box.active || !box.obb) continue;
      box.updateFrame();
      const c = box.center, A = box.axes, o = box.obb;
      const boxW = 1 / box.totalMass();
      const boxKin = box.kinematic || box.particles.every(p => p.invMass === 0);
      // box velocity
      let bvx = 0, bvy = 0, bvz = 0;
      for (const bp of box.particles) { bvx += bp.x - bp.px; bvy += bp.y - bp.py; bvz += bp.z - bp.pz; }
      const n8 = 1 / box.particles.length; bvx *= n8; bvy *= n8; bvz *= n8;
      this.queryParticles(c.x, c.y, c.z, box.bRadius + 0.3, (p) => {
        const pb = p.body;
        if (pb === box || p.invMass === 0) return;
        if (pb.noCollideWith === box || box.noCollideWith === pb) return;
        if (box.sleeping && pb.sleeping) return;
        v.set(p.x - c.x, p.y - c.y, p.z - c.z);
        const lx = v.dot(A[0]), ly = v.dot(A[1]), lz = v.dot(A[2]);
        const r = p.radius;
        const px = o.hx + r - Math.abs(lx), py = o.hy + r - Math.abs(ly), pz = o.hz + r - Math.abs(lz);
        if (px <= 0 || py <= 0 || pz <= 0) return;
        let ax, pen, s;
        if (px < py && px < pz) { ax = A[0]; pen = px; s = Math.sign(lx) || 1; }
        else if (py < pz) { ax = A[1]; pen = py; s = Math.sign(ly) || 1; }
        else { ax = A[2]; pen = pz; s = Math.sign(lz) || 1; }
        const wp = p.invMass, wb = boxKin ? 0 : boxW;
        const tot = wp + wb;
        const kp = wp / tot, kb = wb / tot;
        const nx = ax.x * s, ny = ax.y * s, nz = ax.z * s;
        // relative velocity before
        const rvx = (p.x - p.px) - bvx, rvy = (p.y - p.py) - bvy, rvz = (p.z - p.pz) - bvz;
        const rvn = rvx * nx + rvy * ny + rvz * nz;
        p.x += nx * pen * kp; p.y += ny * pen * kp; p.z += nz * pen * kp;
        if (kb > 0) for (const bp of box.particles) {
          if (bp.invMass === 0) continue;
          bp.x -= nx * pen * kb; bp.y -= ny * pen * kb; bp.z -= nz * pen * kb;
        }
        // friction: damp tangential relative velocity
        const tx = rvx - rvn * nx, ty = rvy - rvn * ny, tz = rvz - rvn * nz;
        const f = 0.35;
        p.px += tx * f; p.py += ty * f; p.pz += tz * f;
        if (pb.sleeping) pb.wake();
        if (box.sleeping && kb > 0) box.wake();
        const speed = -rvn / this.dt;
        if (speed > 2.5) this._pairImpact(p, box.particles[0], speed, -nx, -ny, -nz);
      });
    }
  }

  _sleepCheck(dt) {
    for (const b of this.bodies) {
      if (!b.canSleep || b.sleeping || b.kinematic || !b.active) continue;
      let maxV = 0;
      for (const p of b.particles) {
        const v = Math.abs(p.x - p.px) + Math.abs(p.y - p.py) + Math.abs(p.z - p.pz);
        if (v > maxV) maxV = v;
      }
      if (maxV / dt < 0.12) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.8) {
          b.sleeping = true;
          for (const p of b.particles) { p.px = p.x; p.py = p.y; p.pz = p.z; }
        }
      } else b.sleepTimer = 0;
    }
  }

  // Radial impulse (explosions, shockwaves)
  radialImpulse(x, y, z, radius, strength, upBias = 0.4) {
    const dt = this.dt;
    for (const b of this.bodies) {
      if (!b.active || b.kinematic) continue;
      let touched = false;
      for (const p of b.particles) {
        if (p.invMass === 0) continue;
        const dx = p.x - x, dy = p.y - y, dz = p.z - z;
        const d = Math.hypot(dx, dy, dz);
        if (d > radius) continue;
        const f = strength * (1 - d / radius) / Math.max(0.3, d);
        p.addVel(dx * f, dy * f + upBias * strength * (1 - d / radius), dz * f, dt);
        touched = true;
      }
      if (touched) b.wake();
    }
  }

  // Ray vs static boxes. Returns {dist, point, normal, box} or null
  raycastStatic(o, d, maxDist, out = {}, skipSeeThrough = false) {
    let best = maxDist, bestBox = null, bnx = 0, bny = 0, bnz = 0;
    const idx = 1 / (d.x || 1e-12), idy = 1 / (d.y || 1e-12), idz = 1 / (d.z || 1e-12);
    for (const s of this.statics) {
      if (!s.enabled || (skipSeeThrough && s.seeThrough)) continue;
      let t1 = (s.min.x - o.x) * idx, t2 = (s.max.x - o.x) * idx;
      let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), nxa = t1 < t2 ? -1 : 1;
      let ax = 0;
      t1 = (s.min.y - o.y) * idy; t2 = (s.max.y - o.y) * idy;
      let ty0 = Math.min(t1, t2), ty1 = Math.max(t1, t2);
      if (ty0 > tmin) { tmin = ty0; ax = 1; nxa = t1 < t2 ? -1 : 1; }
      tmax = Math.min(tmax, ty1);
      t1 = (s.min.z - o.z) * idz; t2 = (s.max.z - o.z) * idz;
      let tz0 = Math.min(t1, t2), tz1 = Math.max(t1, t2);
      if (tz0 > tmin) { tmin = tz0; ax = 2; nxa = t1 < t2 ? -1 : 1; }
      tmax = Math.min(tmax, tz1);
      if (tmax < Math.max(tmin, 0) || tmin > best || tmin < 0) continue;
      best = tmin; bestBox = s;
      bnx = ax === 0 ? nxa : 0; bny = ax === 1 ? nxa : 0; bnz = ax === 2 ? nxa : 0;
    }
    if (!bestBox) return null;
    out.dist = best;
    out.point = (out.point || new THREE.Vector3()).set(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    out.normal = (out.normal || new THREE.Vector3()).set(bnx, bny, bnz);
    out.box = bestBox;
    out.kind = 'static';
    return out;
  }

  // Line of sight test between two points (static only)
  lineClear(a, b) {
    const d = this._v.subVectors(b, a);
    const len = d.length();
    if (len < 1e-6) return true;
    d.multiplyScalar(1 / len);
    const dir = d.clone();
    return !this.raycastStatic(a, dir, len - 0.05, {}, true);
  }

  // Ray vs OBB body (box props). Returns distance or -1 and fills normal
  rayOBB(body, o, d, maxDist, outN) {
    body.updateFrame();
    const c = body.center, A = body.axes, h = [body.obb.hx, body.obb.hy, body.obb.hz];
    let tmin = -Infinity, tmax = Infinity, nAxis = 0, nSign = 1;
    for (let i = 0; i < 3; i++) {
      const e = A[i].x * (c.x - o.x) + A[i].y * (c.y - o.y) + A[i].z * (c.z - o.z);
      const f = A[i].dot(d);
      if (Math.abs(f) > 1e-9) {
        let t1 = (e + h[i]) / f, t2 = (e - h[i]) / f;
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = i; nSign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax || tmax < 0) return -1;
      } else if (-e - h[i] > 0 || -e + h[i] < 0) return -1;
    }
    if (tmin < 0 || tmin > maxDist) return -1;
    if (outN) outN.copy(A[nAxis]).multiplyScalar(A[nAxis].dot(d) > 0 ? -1 : 1);
    return tmin;
  }
}

const EMPTY = [];

// ---- Geometry helpers shared by gameplay code ----

// Closest points between segments p1-q1 and p2-q2. Returns squared distance;
// writes parameters into res.s, res.t
export function segSegDist2(p1, q1, p2, q2, res) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  res.s = s; res.t = t;
  const cx = p1.x + d1x * s - (p2.x + d2x * t);
  const cy = p1.y + d1y * s - (p2.y + d2y * t);
  const cz = p1.z + d1z * s - (p2.z + d2z * t);
  return cx * cx + cy * cy + cz * cz;
}

// Ray vs capsule (segment a-b, radius r). Returns hit distance or -1
export function rayCapsule(o, d, a, b, r, maxDist) {
  // Approximate: closest point between ray segment and capsule axis, then sphere test
  const res = { s: 0, t: 0 };
  const end = { x: o.x + d.x * maxDist, y: o.y + d.y * maxDist, z: o.z + d.z * maxDist };
  const d2 = segSegDist2(o, end, a, b, res);
  if (d2 > r * r) return -1;
  const cx = a.x + (b.x - a.x) * res.t, cy = a.y + (b.y - a.y) * res.t, cz = a.z + (b.z - a.z) * res.t;
  // ray-sphere at that point
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const bq = ox * d.x + oy * d.y + oz * d.z;
  const cq = ox * ox + oy * oy + oz * oz - r * r;
  const disc = bq * bq - cq;
  if (disc < 0) return res.s * maxDist;
  const t = -bq - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

// Build an 8-corner rigid box body. Returns body; corners follow bit layout.
export function makeBoxBody(world, cx, cy, cz, hx, hy, hz, mass, quat = null, type = 'prop', radius = null) {
  const b = new Body(type);
  const m = mass / 8;
  const r = radius !== null ? radius : Math.min(0.06, Math.min(hx, hy, hz) * 0.9);
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set((i & 1) ? hx - r : -hx + r, (i & 2) ? hy - r : -hy + r, (i & 4) ? hz - r : -hz + r);
    if (quat) v.applyQuaternion(quat);
    b.add(new Particle(cx + v.x, cy + v.y, cz + v.z, m, r));
  }
  const P = b.particles;
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) b.link(P[i], P[j], 1);
  b.obb = { hx, hy, hz };
  if (world) world.addBody(b);
  return b;
}

// Rigid 'stick' body for elongated objects (weapons, limbs, bottles):
// 3 particles: back, front and an up-offset forming a frame.
export function makeTriBody(world, a, bpt, up, mass, radius, type = 'item') {
  const body = new Body(type);
  const pa = body.add(new Particle(a.x, a.y, a.z, mass * 0.4, radius));
  const pb = body.add(new Particle(bpt.x, bpt.y, bpt.z, mass * 0.4, radius));
  const pc = body.add(new Particle(up.x, up.y, up.z, mass * 0.2, radius * 0.6));
  body.link(pa, pb); body.link(pb, pc); body.link(pa, pc);
  if (world) world.addBody(body);
  return body;
}

// Frame utility for rendering rigid bodies from three reference particles.
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export function frameFromParticles(p0, p1, p2, out) {
  _x.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z).normalize();
  _y.set(p2.x - p0.x, p2.y - p0.y, p2.z - p0.z);
  _y.addScaledVector(_x, -_y.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  out.makeBasis(_x, _y, _z);
  out.setPosition(p0.x, p0.y, p0.z);
  return out;
}
export function frameFromBox(body, out) {
  body.updateFrame();
  out.makeBasis(body.axes[0], body.axes[1], body.axes[2]);
  out.setPosition(body.center);
  return out;
}

// Attach a mesh to a body: stores mesh transform relative to body frame.
export class BodyRenderer {
  constructor(body, object3d) {
    this.body = body; this.object = object3d;
    this.local = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this.rebind();
  }
  frame(out) {
    const P = this.body.particles;
    return this.body.obb ? frameFromBox(this.body, out) : frameFromParticles(P[0], P[1], P[2], out);
  }
  rebind() {
    this.object.updateMatrixWorld(true);
    this.frame(this._m);
    this.local.copy(this._m).invert().multiply(this.object.matrixWorld);
  }
  sync() {
    this.frame(this._m).multiply(this.local);
    this._m.decompose(this.object.position, this.object.quaternion, this.object.scale);
  }
  // Snap body particles so that object ends up at given world matrix
  placeAt(worldMatrix, keepVelocity = false) {
    // body frame target = worldMatrix * local^-1
    const target = this._m.copy(worldMatrix).multiply(_inv.copy(this.local).invert());
    const cur = _cur;
    this.frame(cur);
    const delta = _del.copy(target).multiply(cur.invert());
    for (const p of this.body.particles) {
      _p.set(p.x, p.y, p.z).applyMatrix4(delta);
      if (keepVelocity) { p.px = p.x; p.py = p.y; p.pz = p.z; p.x = _p.x; p.y = _p.y; p.z = _p.z; }
      else p.setPos(_p.x, _p.y, _p.z);
    }
  }
}
const _inv = new THREE.Matrix4(), _cur = new THREE.Matrix4(), _del = new THREE.Matrix4(), _p = new THREE.Vector3();
