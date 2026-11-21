// Level builder: static geometry is merged per material (few draw calls),
// colliders are axis-aligned boxes, plus nav grid, cover points and spawns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, rand } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { Mat, Tex } from '../core/materials.js';

const SURFACE = (key) => {
  if (key.startsWith('concrete') || key.startsWith('floor') || key.startsWith('painted') || key === 'hazard' || key === 'black') return 'concrete';
  if (key === 'metal' || key === 'tread' || key === 'crateMetal' || key === 'barrel' || key === 'barrelRed' || key === 'grate' || key === 'steel') return 'metal';
  if (key === 'rust') return 'rust';
  if (key.startsWith('wood') || key === 'crate') return 'wood';
  if (key.startsWith('tiles')) return 'tiles';
  if (key === 'sand') return 'sand';
  if (key === 'glass') return 'glass';
  return 'concrete';
};

function boxGeoUV(w, h, d, scale, ox, oy, oz) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [[d, h, oz, oy], [d, h, oz, oy], [w, d, ox, oz], [w, d, ox, oz], [w, h, ox, oy], [w, h, ox, oy]];
  for (let f = 0; f < 6; f++) {
    const [du, dv, ou, ov] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * du + ou) / scale, (uv.getY(k) * dv + ov) / scale);
    }
  }
  return g;
}

// ---------------- Navigation grid ----------------
export class NavGrid {
  constructor(minX, minZ, maxX, maxZ, cell = 0.5) {
    this.cell = cell; this.minX = minX; this.minZ = minZ;
    this.w = Math.ceil((maxX - minX) / cell); this.h = Math.ceil((maxZ - minZ) / cell);
    this.grid = new Uint8Array(this.w * this.h);
    this.g = new Float32Array(this.w * this.h);
    this.f = new Float32Array(this.w * this.h);
    this.parent = new Int32Array(this.w * this.h);
    this.stamp = new Uint32Array(this.w * this.h);
    this.closed = new Uint32Array(this.w * this.h);
    this.run = 1;
  }
  build(statics) {
    const R = 0.28, c = this.cell;
    this.grid.fill(1);
    for (const b of statics) {
      if (!b.enabled || b.noNav) continue;
      if (b.max.y < 0.66 || b.min.y > 1.7) continue; // enemies step onto low platforms
      const x0 = Math.max(0, Math.floor((b.min.x - R - this.minX) / c)), x1 = Math.min(this.w - 1, Math.floor((b.max.x + R - this.minX) / c));
      const z0 = Math.max(0, Math.floor((b.min.z - R - this.minZ) / c)), z1 = Math.min(this.h - 1, Math.floor((b.max.z + R - this.minZ) / c));
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        // cell centre must actually be inside the expanded box
        const cx = this.minX + (x + 0.5) * c, cz = this.minZ + (z + 0.5) * c;
        if (cx > b.min.x - R && cx < b.max.x + R && cz > b.min.z - R && cz < b.max.z + R) this.grid[x + z * this.w] = 0;
      }
    }
  }
  cellOf(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  ok(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.w && iz < this.h && this.grid[ix + iz * this.w] === 1; }
  walkable(x, z) { const [i, j] = this.cellOf(x, z); return this.ok(i, j); }
  center(ix, iz) { return { x: this.minX + (ix + 0.5) * this.cell, z: this.minZ + (iz + 0.5) * this.cell }; }
  lineWalkable(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.ceil(d / (this.cell * 0.5));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.walkable(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }
  nearestOpen(ix, iz) {
    if (this.ok(ix, iz)) return [ix, iz];
    for (let r = 1; r < 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
      if (this.ok(ix + dx, iz + dz)) return [ix + dx, iz + dz];
    }
    return null;
  }
  findPath(sx, sz, tx, tz) {
    let s = this.nearestOpen(...this.cellOf(sx, sz)), t = this.nearestOpen(...this.cellOf(tx, tz));
    if (!s || !t) return null;
    const W = this.w, run = ++this.run;
    const si = s[0] + s[1] * W, ti = t[0] + t[1] * W;
    const heap = [si];
    this.g[si] = 0; this.f[si] = this.heur(si, ti); this.stamp[si] = run; this.parent[si] = -1;
    let iter = 0;
    const SQ2 = Math.SQRT2;
    while (heap.length && iter++ < 6000) {
      // pop min f
      let bi = 0;
      for (let i = 1; i < heap.length; i++) if (this.f[heap[i]] < this.f[heap[bi]]) bi = i;
      const cur = heap[bi]; heap[bi] = heap[heap.length - 1]; heap.pop();
      if (cur === ti) break;
      if (this.closed[cur] === run) continue;
      this.closed[cur] = run;
      const cx = cur % W, cz = (cur / W) | 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!this.ok(nx, nz)) continue;
        if (dx && dz && (!this.ok(cx + dx, cz) || !this.ok(cx, cz + dz))) continue;
        const ni = nx + nz * W;
        if (this.closed[ni] === run) continue;
        const ng = this.g[cur] + (dx && dz ? SQ2 : 1);
        if (this.stamp[ni] !== run || ng < this.g[ni]) {
          this.stamp[ni] = run; this.g[ni] = ng; this.f[ni] = ng + this.heur(ni, ti); this.parent[ni] = cur;
          heap.push(ni);
        }
      }
    }
    if (this.stamp[ti] !== run) return null;
    const cells = [];
    for (let c = ti; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    // string pulling
    const pts = cells.map(c => this.center(c % W, (c / W) | 0));
    const out = [];
    let anchor = { x: sx, z: sz };
    for (let i = 1; i < pts.length; i++) {
      if (!this.lineWalkable(anchor.x, anchor.z, pts[i].x, pts[i].z)) { out.push(pts[i - 1]); anchor = pts[i - 1]; }
    }
    out.push({ x: tx, z: tz });
    return out;
  }
  heur(a, b) { const W = this.w; const dx = Math.abs(a % W - b % W), dz = Math.abs(((a / W) | 0) - ((b / W) | 0)); return Math.max(dx, dz) + 0.41 * Math.min(dx, dz); }
}

// ---------------- Level ----------------
export class Level {
  constructor(id, name) {
    this.id = id; this.name = name;
    this.group = new THREE.Group();
    this.buckets = new Map();
    this.lights = [];
    this.flicker = [];
    this.playerSpawn = { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
    this.enemySpawns = [];
    this.weaponSpots = [];
    this.propSpots = [];
    this.dummySpots = [];
    this.targetSpots = [];
    this.coverPoints = [];
    this.bounds = { minX: -20, minZ: -20, maxX: 20, maxZ: 20 };
    this.texScale = 2.5;
    this.extra = [];
    this.fog = { color: 0x111214, near: 15, far: 70 };
    this.hemi = { sky: 0x8a8f99, ground: 0x2a2622, intensity: 0.6 };
    this.sun = { dir: new THREE.Vector3(-0.4, -1, -0.3), color: 0xfff2e0, intensity: 1.4 };
    this.reverb = 0.25;
  }

  // ---- geometry primitives ----
  box(x0, y0, z0, x1, y1, z1, mat = 'concrete', opts = {}) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return null;
    if (!opts.noRender) {
      const g = boxGeoUV(w, h, d, opts.uvScale || this.texScale, x0, y0, z0);
      g.translate(x0 + w / 2, y0 + h / 2, z0 + d / 2);
      this._bucket(mat, g, opts.noShadow);
    }
    if (opts.noCollide) return null;
    return G.physics.addStatic(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1), SURFACE(mat), opts);
  }
  boxC(cx, cy, cz, w, h, d, mat, opts) { return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, mat, opts); }
  _bucket(mat, g, noShadow) {
    const key = mat + (noShadow ? '#ns' : '');
    if (!this.buckets.has(key)) this.buckets.set(key, { mat, geos: [], noShadow });
    const geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    this.buckets.get(key).geos.push(geo);
  }
  deco(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, noShadow = false) {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    this._bucket(mat, geo, noShadow);
  }
  floor(x0, z0, x1, z1, mat = 'floor', y = 0) { return this.box(x0, y - 0.5, z0, x1, y, z1, mat, { uvScale: 3 }); }
  ceiling(x0, z0, x1, z1, h, mat = 'concreteDark') { return this.box(x0, h, z0, x1, h + 0.4, z1, mat, { noShadow: true }); }
  // wall running along X at z, openings: [[centerX, width, height]]
  wallX(z, x0, x1, h, t, mat, openings = [], y0 = 0) {
    const segs = this._split(x0, x1, openings);
    for (const [a, b] of segs) this.box(a, y0, z - t / 2, b, y0 + h, z + t / 2, mat);
    for (const [c, w, oh] of openings) if (oh < h) this.box(c - w / 2, y0 + oh, z - t / 2, c + w / 2, y0 + h, z + t / 2, mat);
  }
  wallZ(x, z0, z1, h, t, mat, openings = [], y0 = 0) {
    const segs = this._split(z0, z1, openings);
    for (const [a, b] of segs) this.box(x - t / 2, y0, a, x + t / 2, y0 + h, b, mat);
    for (const [c, w, oh] of openings) if (oh < h) this.box(x - t / 2, y0 + oh, c - w / 2, x + t / 2, y0 + h, c + w / 2, mat);
  }
  _split(a, b, openings) {
    const cuts = openings.map(([c, w]) => [c - w / 2, c + w / 2]).sort((p, q) => p[0] - q[0]);
    const segs = []; let cur = a;
    for (const [s, e] of cuts) { if (s > cur) segs.push([cur, s]); cur = Math.max(cur, e); }
    if (cur < b) segs.push([cur, b]);
    return segs;
  }
  room(x0, z0, x1, z1, h, wallMat, t = 0.4, floorMat = 'floor', ceilMat = 'concreteDark') {
    this.floor(x0 - t, z0 - t, x1 + t, z1 + t, floorMat);
    if (ceilMat) this.ceiling(x0 - t, z0 - t, x1 + t, z1 + t, h, ceilMat);
    this.wallX(z0 - t / 2, x0 - t, x1 + t, h, t, wallMat);
    this.wallX(z1 + t / 2, x0 - t, x1 + t, h, t, wallMat);
    this.wallZ(x0 - t / 2, z0, z1, h, t, wallMat);
    this.wallZ(x1 + t / 2, z0, z1, h, t, wallMat);
    this.bounds = { minX: x0 - 1, minZ: z0 - 1, maxX: x1 + 1, maxZ: z1 + 1 };
  }
  pillar(x, z, w, h, mat = 'concrete', d = w) { return this.box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, mat); }
  // ladder against a wall; face: direction the climber faces (unit x/z)
  ladder(x, z, h, fx, fz, width = 0.5) {
    const px = -fz, pz = fx; // along-wall direction
    for (const s of [-1, 1]) {
      const cx = x + px * s * width / 2, cz = z + pz * s * width / 2;
      this.box(cx - 0.025, 0, cz - 0.025, cx + 0.025, h + 0.8, cz + 0.025, 'metal', { climbable: true, noNav: false });
    }
    for (let y = 0.3; y <= h + 0.6; y += 0.3) {
      const hw = width / 2;
      this.box(Math.min(x - px * hw, x + px * hw) - 0.015, y - 0.015, Math.min(z - pz * hw, z + pz * hw) - 0.015, Math.max(x - px * hw, x + px * hw) + 0.015, y + 0.015, Math.max(z - pz * hw, z + pz * hw) + 0.015, 'metal', { climbable: true });
    }
  }
  stairs(x, z, dx, dz, width, steps, stepH = 0.25, stepD = 0.32, mat = 'concrete') {
    for (let i = 0; i < steps; i++) {
      const cx = x + dx * (i + 0.5) * stepD, cz = z + dz * (i + 0.5) * stepD;
      const w = dx ? stepD : width, d = dz ? stepD : width;
      this.box(cx - w / 2, 0, cz - d / 2, cx + w / 2, (i + 1) * stepH, cz + d / 2, mat);
    }
  }
  railing(x0, z0, x1, z1, y, mat = 'metal') {
    const h = 1.0;
    if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) {
      this.box(Math.min(x0, x1), y + h - 0.05, z0 - 0.03, Math.max(x0, x1), y + h, z0 + 0.03, mat, { climbable: true, noNav: true });
      this.box(Math.min(x0, x1), y + 0.45, z0 - 0.02, Math.max(x0, x1), y + 0.5, z0 + 0.02, mat, { noCollide: true });
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1.5) this.box(x - 0.025, y, z0 - 0.025, x + 0.025, y + h, z0 + 0.025, mat, { noNav: true });
    } else {
      this.box(x0 - 0.03, y + h - 0.05, Math.min(z0, z1), x0 + 0.03, y + h, Math.max(z0, z1), mat, { climbable: true, noNav: true });
      this.box(x0 - 0.02, y + 0.45, Math.min(z0, z1), x0 + 0.02, y + 0.5, Math.max(z0, z1), mat, { noCollide: true });
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z += 1.5) this.box(x0 - 0.025, y, z - 0.025, x0 + 0.025, y + h, z + 0.025, mat, { noNav: true });
    }
  }
  pipe(x0, y0, z0, x1, y1, z1, r = 0.12, mat = 'metal') {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    const m = a.add(b).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    this._bucket(mat, g, true);
    // flanges
    for (let t = 0.1; t < 1; t += 0.3) {
      const f = new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.06, 10); f.applyQuaternion(q);
      const p = new THREE.Vector3(x0, y0, z0).lerp(new THREE.Vector3(x1, y1, z1), t);
      f.translate(p.x, p.y, p.z);
      this._bucket(mat, f, true);
    }
  }
  light(x, y, z, color = 0xfff0d8, intensity = 1, distance = 18, fixture = 'panel', flicker = false) {
    const budget = Settings.perfMode ? 2 : 4;
    if (this.lights.filter(l => l.isPointLight).length < budget) {
      const l = new THREE.PointLight(color, intensity * 12, distance, 1.6);
      l.position.set(x, y - 0.25, z);
      this.lights.push(l);
      if (flicker) this.flicker.push({ light: l, base: l.intensity, t: rand(0, 10) });
    }
    if (fixture === 'panel') this.box(x - 0.6, y - 0.06, z - 0.2, x + 0.6, y, z + 0.2, color === 0xff3a22 ? 'lightRed' : (color < 0xffd000 ? 'lightWarm' : 'lightPanel'), { noCollide: true, noShadow: true });
    else if (fixture === 'lamp') {
      this.deco(new THREE.CylinderGeometry(0.35, 0.5, 0.25, 12), 'metal', x, y + 0.1, z, 0, 0, 0, true);
      this.deco(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12), color < 0xffd000 ? 'lightWarm' : 'lightPanel', x, y - 0.03, z, 0, 0, 0, true);
    }
  }
  // fixtures without a dynamic light (cheap ambience)
  fixture(x, y, z, mat = 'lightPanel', w = 1.2, d = 0.4) { this.box(x - w / 2, y - 0.06, z - d / 2, x + w / 2, y, z + d / 2, mat, { noCollide: true, noShadow: true }); }
  sign(x, y, z, yaw, w, h, text, sub, colors) {
    const tex = Tex.sign(text, sub, 512, Math.round(512 * h / w), ...(colors || []));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    m.position.set(x, y, z); m.rotation.y = yaw;
    this.extra.push(m);
    this.group.add(m);
  }
  decal(x, y, z, w, d, mat = 'hazard') { this.box(x - w / 2, y, z - d / 2, x + w / 2, y + 0.005, z + d / 2, mat, { noCollide: true, noShadow: true, uvScale: 1 }); }
  glass(x0, y0, z0, x1, y1, z1) { this.extra.push({ glass: [new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)] }); }
  door(x, z, width, yaw, height = 2.1, mat) { this.extra.push({ door: [new THREE.Vector3(x, 0.01, z), width, height, yaw, mat] }); }
  prop(type, x, y, z, yaw = 0) { this.propSpots.push({ type, pos: new THREE.Vector3(x, y, z), yaw }); }
  weapon(id, x, y, z, yaw = 0) { this.weaponSpots.push({ id, pos: new THREE.Vector3(x, y, z), yaw }); }
  spawn(x, z) { this.enemySpawns.push(new THREE.Vector3(x, 0, z)); }

  // ---- finish ----
  finish() {
    for (const [, b] of this.buckets) {
      const mat = Mat[b.mat] || Mat.concrete;
      const mesh = new THREE.Mesh(mergeGeometries(b.geos, false), mat);
      mesh.receiveShadow = !b.mat.startsWith('light');
      mesh.castShadow = !b.noShadow && !b.mat.startsWith('light');
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.buckets.clear();
    for (const l of this.lights) this.group.add(l);
    G.scene.add(this.group);
    G.physics.buildStaticGrid();
    // interactive pieces
    for (const e of this.extra) {
      if (e.glass) G.props.glassPane(...e.glass);
      if (e.door) G.props.door(...e.door);
    }
    const B = this.bounds;
    this.nav = new NavGrid(B.minX, B.minZ, B.maxX, B.maxZ, 0.5);
    this.nav.build(G.physics.statics);
    this.buildCover();
  }

  buildCover() {
    const nav = this.nav;
    const pts = [];
    for (let x = 1; x < nav.w - 1; x++) for (let z = 1; z < nav.h - 1; z++) {
      if (!nav.ok(x, z)) continue;
      let blocked = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!nav.ok(x + dx, z + dz)) blocked++;
      if (blocked === 0 || blocked > 2) continue;
      const c = nav.center(x, z);
      if (pts.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 1.6)) continue;
      pts.push(c);
    }
    this.coverPoints = pts;
  }

  findCover(ex, ez, target, minR, maxR) {
    let best = null, bestScore = Infinity;
    const lo = new THREE.Vector3(), hi = new THREE.Vector3();
    let checks = 0;
    for (const p of this.coverPoints) {
      const de = Math.hypot(p.x - ex, p.z - ez);
      if (de > 14) continue;
      const dt = Math.hypot(p.x - target.x, p.z - target.z);
      if (dt < minR || dt > maxR) continue;
      if (++checks > 30) break;
      lo.set(p.x, 0.95, p.z); hi.set(p.x, 1.55, p.z);
      const hidden = !G.physics.lineClear(lo, target);
      if (!hidden) continue;
      const peek = G.physics.lineClear(hi, target);
      const score = de + (peek ? 0 : 6) + Math.random() * 2;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  update(dt) {
    for (const f of this.flicker) {
      f.t += dt;
      const on = Math.sin(f.t * 1.3) > -0.85 || Math.random() < 0.3;
      f.light.intensity = on ? f.base * (0.85 + Math.random() * 0.15) : f.base * 0.1;
    }
  }

  dispose() {
    G.scene.remove(this.group);
    this.group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
}
