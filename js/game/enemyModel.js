// Enemy skeleton definition, procedural skinned-mesh generation and the per-enemy
// damage atlas (wounds, torn clothing, bruises and burns painted at runtime).
import * as THREE from 'three';

export const PNAMES = ['head', 'neck', 'chest', 'pelvis', 'lSh', 'lEl', 'lHa', 'rSh', 'rEl', 'rHa', 'lHip', 'lKn', 'lFt', 'rHip', 'rKn', 'rFt'];

// Rest pose (scale 1), facing +Z, +X = character's left
export const REST = {
  head: [0, 1.68, 0.02], neck: [0, 1.5, 0], chest: [0, 1.28, 0], pelvis: [0, 0.98, 0],
  lSh: [0.2, 1.45, 0], lEl: [0.22, 1.17, 0], lHa: [0.22, 0.9, 0.02],
  rSh: [-0.2, 1.45, 0], rEl: [-0.22, 1.17, 0], rHa: [-0.22, 0.9, 0.02],
  lHip: [0.1, 0.95, 0], lKn: [0.1, 0.52, 0.02], lFt: [0.1, 0.08, 0],
  rHip: [-0.1, 0.95, 0], rKn: [-0.1, 0.52, 0.02], rFt: [-0.1, 0.08, 0],
};
export const PRADIUS = { head: 0.12, neck: 0.07, chest: 0.15, pelvis: 0.14, lSh: 0.07, rSh: 0.07, lEl: 0.06, rEl: 0.06, lHa: 0.06, rHa: 0.06, lHip: 0.08, rHip: 0.08, lKn: 0.07, rKn: 0.07, lFt: 0.07, rFt: 0.07 };
export const PMASS = { head: 5, neck: 3, chest: 15, pelvis: 14, lSh: 3, rSh: 3, lEl: 2, rEl: 2, lHa: 1, rHa: 1, lHip: 5, rHip: 5, lKn: 4, rKn: 4, lFt: 2, rFt: 2 };

// Bones: a -> b defines local +Y; tile = atlas tile; y0/y1 = UV v range in bone space
export const BONES = [
  { name: 'head', a: 'neck', b: 'head', r: 0.115, region: 'head', limb: 'head', tile: 0, y0: -0.03, y1: 0.28, fwd: 'torso' },
  { name: 'chest', a: 'chest', b: 'neck', r: 0.165, region: 'torso', tile: 1, y0: -0.08, y1: 0.26, fwd: 'torso' },
  { name: 'abdomen', a: 'pelvis', b: 'chest', r: 0.155, region: 'torso', tile: 2, y0: -0.16, y1: 0.3, fwd: 'torso' },
  { name: 'lUpperArm', a: 'lSh', b: 'lEl', r: 0.058, region: 'arm', limb: 'lArm', tile: 3, y0: -0.05, y1: 0.33, fwd: 'torso', stretch: true },
  { name: 'lForearm', a: 'lEl', b: 'lHa', r: 0.052, region: 'arm', limb: 'lForearm', tile: 4, y0: -0.05, y1: 0.4, fwd: 'torso', stretch: true },
  { name: 'rUpperArm', a: 'rSh', b: 'rEl', r: 0.058, region: 'arm', limb: 'rArm', tile: 5, y0: -0.05, y1: 0.33, fwd: 'torso', stretch: true },
  { name: 'rForearm', a: 'rEl', b: 'rHa', r: 0.052, region: 'arm', limb: 'rForearm', tile: 6, y0: -0.05, y1: 0.4, fwd: 'torso', stretch: true },
  { name: 'lThigh', a: 'lHip', b: 'lKn', r: 0.078, region: 'leg', limb: 'lLeg', tile: 7, y0: -0.07, y1: 0.48, fwd: 'pelvis', stretch: true },
  { name: 'lShin', a: 'lKn', b: 'lFt', r: 0.064, region: 'leg', limb: 'lShin', tile: 8, y0: -0.05, y1: 0.5, fwd: 'pelvis', stretch: true },
  { name: 'rThigh', a: 'rHip', b: 'rKn', r: 0.078, region: 'leg', limb: 'rLeg', tile: 9, y0: -0.07, y1: 0.48, fwd: 'pelvis', stretch: true },
  { name: 'rShin', a: 'rKn', b: 'rFt', r: 0.064, region: 'leg', limb: 'rShin', tile: 10, y0: -0.05, y1: 0.5, fwd: 'pelvis', stretch: true },
];
export const T_HAT = 11, T_BOOT = 12, T_HAND = 13, T_VEST = 14, T_GORE = 15;

// Dismemberment table: cut joint particle, particles that leave, bones that move
export const DISMEMBER = {
  head: { joint: 'neck', child: ['head'], bones: ['head'] },
  lArm: { joint: 'lSh', child: ['lEl', 'lHa'], bones: ['lUpperArm'] },
  rArm: { joint: 'rSh', child: ['rEl', 'rHa'], bones: ['rUpperArm'] },
  lForearm: { joint: 'lEl', child: ['lHa'], bones: ['lForearm'] },
  rForearm: { joint: 'rEl', child: ['rHa'], bones: ['rForearm'] },
  lLeg: { joint: 'lHip', child: ['lKn', 'lFt'], bones: ['lThigh'] },
  rLeg: { joint: 'rHip', child: ['rKn', 'rFt'], bones: ['rThigh'] },
  lShin: { joint: 'lKn', child: ['lFt'], bones: ['lShin'] },
  rShin: { joint: 'rKn', child: ['rFt'], bones: ['rShin'] },
};

export function boneLength(b, s) {
  const A = REST[b.a], B = REST[b.b];
  return Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * s;
}

// ---------------- Geometry ----------------
function cylUV(geo, tile, y0, y1, wrapCyl = true) {
  const pos = geo.attributes.position, n = pos.count;
  const uv = new Float32Array(n * 2);
  const tx = tile % 4, ty = Math.floor(tile / 4);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let u = wrapCyl ? Math.atan2(x, z) / (Math.PI * 2) + 0.5 : (x + 0.2) / 0.4;
    let v = (y - y0) / (y1 - y0);
    u = Math.min(0.995, Math.max(0.005, u)); v = Math.min(0.995, Math.max(0.005, v));
    uv[i * 2] = (tx + u) / 4; uv[i * 2 + 1] = (ty + v) / 4;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function piece(geo, boneIndex, tile, y0, y1, transform) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (transform) g.applyMatrix4(transform);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  cylUV(g, tile, y0, y1);
  const n = g.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = boneIndex; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return g;
}

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const geoCache = new Map();
export function buildEnemyGeometry(def) {
  const key = def.id;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = def.scale, w = def.bulk || 1;
  const parts = [];
  const bi = (n) => BONES.findIndex(b => b.name === n);
  const B = Object.fromEntries(BONES.map(b => [b.name, b]));
  const L = Object.fromEntries(BONES.map(b => [b.name, boneLength(b, s)]));
  const add = (g, bone, tile, m, yr) => {
    const b = B[bone];
    const y0 = yr ? yr[0] : b.y0 * s, y1 = yr ? yr[1] : b.y1 * s;
    parts.push(piece(g, bi(bone), tile, y0, y1, m));
  };
  const gore = (bone, y, r) => add(new THREE.SphereGeometry(r, 8, 6), bone, T_GORE, M(0, y, 0));

  // HEAD
  const hr = 0.105 * s;
  if (def.headShape === 'dummy') add(new THREE.SphereGeometry(hr, 14, 10), 'head', 0, M(0, 0.15 * s, 0, 0, 0, 0, 1, 1.15, 1));
  else {
    add(new THREE.SphereGeometry(hr, 16, 12), 'head', 0, M(0, 0.15 * s, 0, 0, 0, 0, 0.92, 1.1, 1.0));
    add(new THREE.SphereGeometry(hr * 0.72, 10, 8), 'head', 0, M(0, 0.1 * s, 0.025 * s, 0, 0, 0, 0.95, 0.8, 1.05)); // jaw
    add(new THREE.BoxGeometry(0.022 * s, 0.035 * s, 0.03 * s), 'head', 0, M(0, 0.145 * s, 0.1 * s, -0.3)); // nose
    add(new THREE.SphereGeometry(0.022 * s, 6, 5), 'head', 0, M(0.098 * s, 0.15 * s, 0, 0, 0, 0, 0.5, 1, 0.8)); // ears
    add(new THREE.SphereGeometry(0.022 * s, 6, 5), 'head', 0, M(-0.098 * s, 0.15 * s, 0, 0, 0, 0, 0.5, 1, 0.8));
  }
  add(new THREE.CylinderGeometry(0.048 * s * w, 0.055 * s * w, 0.1 * s, 10), 'head', 0, M(0, 0.03 * s, 0));
  // headwear
  switch (def.hat) {
    case 'beanie': add(new THREE.SphereGeometry(hr * 1.06, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), 'head', T_HAT, M(0, 0.165 * s, -0.005, 0, 0, 0, 0.95, 1.12, 1.05)); break;
    case 'hood': add(new THREE.SphereGeometry(hr * 1.2, 14, 10, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72), 'head', T_HAT, M(0, 0.15 * s, -0.012, 0, 0, 0, 1, 1.15, 1.05)); break;
    case 'helmet':
      add(new THREE.SphereGeometry(hr * 1.18, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 'head', T_HAT, M(0, 0.165 * s, -0.005, 0, 0, 0, 1, 1.0, 1.08));
      add(new THREE.CylinderGeometry(hr * 1.22, hr * 1.25, 0.018, 16), 'head', T_HAT, M(0, 0.165 * s, -0.005, 0, 0, 0, 1, 1, 1.08));
      break;
    case 'mask':
      add(new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.07 * s, 10), 'head', T_HAT, M(0, 0.1 * s, 0.11 * s, Math.PI / 2));
      add(new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.02, 10), 'head', T_HAT, M(0.035 * s, 0.17 * s, 0.092 * s, Math.PI / 2));
      add(new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.02, 10), 'head', T_HAT, M(-0.035 * s, 0.17 * s, 0.092 * s, Math.PI / 2));
      add(new THREE.BoxGeometry(0.2 * s, 0.02 * s, 0.2 * s), 'head', T_HAT, M(0, 0.15 * s, 0, 0, 0, 0)); // strap
      break;
  }
  // stump caps (hidden inside geometry until a limb leaves)
  gore('head', 0, 0.042 * s);

  // CHEST (a = chest, b = neck)
  add(new THREE.CylinderGeometry(0.2 * s * w, 0.165 * s * w, 0.31 * s, 14), 'chest', 1, M(0, 0.09 * s, 0, 0, 0, 0, 1, 1, 0.62));
  add(new THREE.SphereGeometry(0.075 * s * w, 10, 8), 'chest', 1, M(0.17 * s * w, 0.17 * s, 0)); // shoulder pads
  add(new THREE.SphereGeometry(0.075 * s * w, 10, 8), 'chest', 1, M(-0.17 * s * w, 0.17 * s, 0));
  if (def.vest) {
    add(new THREE.CylinderGeometry(0.212 * s * w, 0.185 * s * w, 0.3 * s, 12), 'chest', T_VEST, M(0, 0.06 * s, 0, 0, 0, 0, 1, 1, 0.7));
    add(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.05 * s), 'chest', T_VEST, M(0.07 * s, -0.02 * s, 0.14 * s));
    add(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.05 * s), 'chest', T_VEST, M(-0.07 * s, -0.02 * s, 0.14 * s));
  }
  gore('chest', L.chest, 0.04 * s); // neck stump
  // shoulder stumps in chest bone space: shoulder offset relative to chest particle
  const shY = (REST.lSh[1] - REST.chest[1]) * s;
  gore('chest', 0, 0.001); // placeholder keeps index stable
  parts.push(piece(new THREE.SphereGeometry(0.045 * s, 8, 6), bi('chest'), T_GORE, 0, 1, M(0.2 * s, shY, 0)));
  parts.push(piece(new THREE.SphereGeometry(0.045 * s, 8, 6), bi('chest'), T_GORE, 0, 1, M(-0.2 * s, shY, 0)));

  // ABDOMEN (a = pelvis, b = chest)
  add(new THREE.CylinderGeometry(0.165 * s * w, 0.155 * s * w, 0.34 * s, 14), 'abdomen', 2, M(0, 0.13 * s, 0, 0, 0, 0, 1, 1, 0.62));
  add(new THREE.CylinderGeometry(0.155 * s * w, 0.135 * s, 0.17 * s, 14), 'abdomen', 2, M(0, -0.06 * s, 0, 0, 0, 0, 1, 1, 0.7));
  const hipY = (REST.lHip[1] - REST.pelvis[1]) * s;
  parts.push(piece(new THREE.SphereGeometry(0.06 * s, 8, 6), bi('abdomen'), T_GORE, 0, 1, M(0.1 * s, hipY, 0)));
  parts.push(piece(new THREE.SphereGeometry(0.06 * s, 8, 6), bi('abdomen'), T_GORE, 0, 1, M(-0.1 * s, hipY, 0)));

  // ARMS
  for (const side of ['l', 'r']) {
    const ua = side + 'UpperArm', fa = side + 'Forearm';
    const ru = 0.058 * s * w, rf = 0.05 * s * w;
    add(new THREE.CapsuleGeometry(ru, L[ua], 4, 10), ua, B[ua].tile, M(0, L[ua] / 2, 0));
    gore(ua, 0, 0.04 * s); gore(ua, L[ua], 0.038 * s);
    add(new THREE.CapsuleGeometry(rf, L[fa], 4, 10), fa, B[fa].tile, M(0, L[fa] / 2, 0));
    gore(fa, 0, 0.036 * s);
    // hand (fist)
    add(new THREE.BoxGeometry(0.075 * s, 0.1 * s, 0.085 * s), fa, T_HAND, M(0, L[fa] + 0.045 * s, 0.01 * s));
    add(new THREE.BoxGeometry(0.03 * s, 0.05 * s, 0.03 * s), fa, T_HAND, M((side === 'l' ? -1 : 1) * 0.0, L[fa] + 0.03 * s, 0.05 * s));
  }
  // LEGS
  for (const side of ['l', 'r']) {
    const th = side + 'Thigh', sh = side + 'Shin';
    const rt = 0.078 * s * w, rs = 0.064 * s * w;
    add(new THREE.CapsuleGeometry(rt, L[th], 4, 10), th, B[th].tile, M(0, L[th] / 2, 0));
    gore(th, 0, 0.055 * s); gore(th, L[th], 0.05 * s);
    add(new THREE.CapsuleGeometry(rs, L[sh], 4, 10), sh, B[sh].tile, M(0, L[sh] / 2, 0));
    gore(sh, 0, 0.05 * s);
    // boot
    add(new THREE.BoxGeometry(0.11 * s, 0.1 * s, 0.26 * s), sh, T_BOOT, M(0, L[sh] + 0.01 * s, 0.05 * s));
    add(new THREE.CylinderGeometry(rs * 1.15, rs * 1.2, 0.14 * s, 10), sh, T_BOOT, M(0, L[sh] - 0.06 * s, 0));
  }

  const geo = mergeGeometries(parts, false);
  geo.computeBoundingSphere();
  geoCache.set(key, geo);
  return geo;
}

// ---------------- Atlas painting ----------------
export function tileRect(tile, size) {
  const T = size / 4, tx = tile % 4, ty = Math.floor(tile / 4);
  return [tx * T, (3 - ty) * T, T, T];
}

function noiseFill(x, rx, ry, w, h, base, amt, n = 400) {
  x.fillStyle = base; x.fillRect(rx, ry, w, h);
  for (let i = 0; i < n; i++) {
    x.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${Math.random() * amt})` : `rgba(255,255,255,${Math.random() * amt * 0.6})`;
    x.fillRect(rx + Math.random() * w, ry + Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function folds(x, rx, ry, w, h, n = 6) {
  for (let i = 0; i < n; i++) {
    const yy = ry + Math.random() * h;
    const g = x.createLinearGradient(rx, yy - 4, rx, yy + 4);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(rx + Math.random() * w * 0.3, yy - 4, w * (0.4 + Math.random() * 0.6), 8);
  }
}

const baseCache = new Map();
export function baseAtlas(def, size) {
  const key = def.id + size;
  if (baseCache.has(key)) return baseCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  const C = def.colors;
  const T = size / 4;
  const R = (t) => tileRect(t, size);
  // head (skin + painted face)
  {
    const [rx, ry] = R(0);
    noiseFill(x, rx, ry, T, T, C.skin, 0.06);
    const g = x.createLinearGradient(rx, ry, rx, ry + T);
    g.addColorStop(0, 'rgba(0,0,0,0.1)'); g.addColorStop(0.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    x.fillStyle = g; x.fillRect(rx, ry, T, T);
    if (def.headShape !== 'dummy') {
      // hair / scalp on top
      x.fillStyle = C.hair || '#2a221c'; x.fillRect(rx, ry, T, T * 0.22);
      // face centred at u = .5
      const fx = rx + T * 0.5, vToY = (v) => ry + (1 - v) * T;
      const eyeY = vToY(0.62), dx = T * 0.06;
      x.fillStyle = '#f0ece4';
      x.beginPath(); x.ellipse(fx - dx, eyeY, T * 0.03, T * 0.018, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(fx + dx, eyeY, T * 0.03, T * 0.018, 0, 0, 7); x.fill();
      x.fillStyle = '#1a1410';
      x.beginPath(); x.arc(fx - dx, eyeY, T * 0.015, 0, 7); x.fill();
      x.beginPath(); x.arc(fx + dx, eyeY, T * 0.015, 0, 7); x.fill();
      x.strokeStyle = C.hair || '#2a221c'; x.lineWidth = Math.max(1, T * 0.022);
      x.beginPath(); x.moveTo(fx - dx - T * 0.04, eyeY - T * 0.045); x.lineTo(fx - dx + T * 0.035, eyeY - T * 0.03); x.stroke();
      x.beginPath(); x.moveTo(fx + dx + T * 0.04, eyeY - T * 0.045); x.lineTo(fx + dx - T * 0.035, eyeY - T * 0.03); x.stroke();
      x.strokeStyle = 'rgba(70,30,25,0.8)'; x.lineWidth = Math.max(1, T * 0.015);
      x.beginPath(); x.moveTo(fx - T * 0.04, vToY(0.42)); x.lineTo(fx + T * 0.04, vToY(0.425)); x.stroke();
      if (C.stubble) { x.fillStyle = 'rgba(30,25,20,0.25)'; x.fillRect(rx + T * 0.3, vToY(0.45), T * 0.4, T * 0.2); }
    }
  }
  // shirt tiles
  const shirt = (t, withCollar) => {
    const [rx, ry] = R(t);
    noiseFill(x, rx, ry, T, T, C.shirt, 0.08);
    folds(x, rx, ry, T, T, 7);
    if (withCollar) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(rx, ry, T, T * 0.06); }
  };
  shirt(1, true);
  {
    const [rx, ry] = R(2);
    noiseFill(x, rx, ry, T, T, C.shirt, 0.08); folds(x, rx, ry, T, T * 0.6, 5);
    const beltY = ry + T * 0.62;
    noiseFill(x, rx, beltY + T * 0.06, T, T * 0.32, C.pants, 0.08);
    x.fillStyle = '#1b1612'; x.fillRect(rx, beltY, T, T * 0.07);
    x.fillStyle = '#8f8a7a'; x.fillRect(rx + T * 0.47, beltY + 1, T * 0.06, T * 0.05);
  }
  for (const t of [3, 5]) { if (C.bareArms) noiseFill(x, ...R(t).slice(0, 2), T, T, C.skin, 0.06); else { shirt(t, false); } }
  for (const t of [4, 6]) {
    const [rx, ry] = R(t);
    if (C.longSleeves) { shirt(t, false); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(rx, ry, T, T * 0.08); }
    else noiseFill(x, rx, ry, T, T, C.skin, 0.06);
  }
  for (const t of [7, 9, 8, 10]) {
    const [rx, ry] = R(t);
    noiseFill(x, rx, ry, T, T, C.pants, 0.1);
    folds(x, rx, ry, T, T, 4);
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(rx + T * 0.24, ry, 2, T); x.fillRect(rx + T * 0.74, ry, 2, T);
    if (t === 7 || t === 9) { x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(rx + T * 0.15, ry + T * 0.35, T * 0.18, T * 0.2); } // pocket
  }
  noiseFill(x, ...R(T_HAT).slice(0, 2), T, T, C.hat || '#333', 0.1);
  noiseFill(x, ...R(T_BOOT).slice(0, 2), T, T, C.boots, 0.12);
  noiseFill(x, ...R(T_HAND).slice(0, 2), T, T, C.gloves || C.skin, 0.06);
  {
    const [rx, ry] = R(T_VEST);
    noiseFill(x, rx, ry, T, T, C.vest || '#3d4433', 0.12);
    x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = 2;
    for (let i = 0; i < 4; i++) x.strokeRect(rx + 4 + i * T / 4, ry + T * 0.4, T / 4 - 8, T * 0.3);
  }
  {
    const [rx, ry] = R(T_GORE);
    noiseFill(x, rx, ry, T, T, '#5a0808', 0.25, 600);
    for (let i = 0; i < 10; i++) { x.fillStyle = `rgba(${150 + Math.random() * 60},${20 + Math.random() * 30},${20},0.6)`; x.beginPath(); x.arc(rx + Math.random() * T, ry + Math.random() * T, 2 + Math.random() * T * 0.08, 0, 7); x.fill(); }
    x.fillStyle = 'rgba(230,220,200,0.9)'; x.beginPath(); x.arc(rx + T / 2, ry + T / 2, T * 0.12, 0, 7); x.fill();
  }
  baseCache.set(key, c);
  return c;
}

// Paint damage onto an enemy's atlas. lp = hit point in bone-local space.
export function paintDamage(ctx, size, bone, lp, kind, scale, def) {
  const [rx, ry, T] = tileRect(bone.tile, size);
  let u = Math.atan2(lp.x, lp.z) / (Math.PI * 2) + 0.5;
  const v = (lp.y - bone.y0 * def.scale) / ((bone.y1 - bone.y0) * def.scale);
  const cx = rx + u * T, cy = ry + (1 - Math.min(1, Math.max(0, v))) * T;
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, ry, T, T); ctx.clip();
  const clothed = bone.region === 'torso' || bone.region === 'leg' || (bone.region === 'arm' && !def.colors.bareArms && bone.name.includes('Upper'));
  for (const off of [-T, 0, T]) {
    const x = cx + off, y = cy;
    if (x < rx - T * 0.3 || x > rx + T * 1.3) continue;
    const r = T * 0.06 * scale;
    // blood soaking into clothes
    let g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, 'rgba(70,0,0,0.55)'); g.addColorStop(1, 'rgba(70,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 4, 0, 7); ctx.fill();
    // torn clothing reveals skin
    if (clothed && kind !== 'blunt' && kind !== 'fist' && kind !== 'kick') {
      ctx.fillStyle = def.colors.skin;
      ctx.beginPath();
      for (let k = 0; k <= 9; k++) { const a = k / 9 * Math.PI * 2, rr = r * (1.2 + Math.random() * 1.3); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
    switch (kind) {
      case 'bullet': case 'pellet': {
        g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.3);
        g.addColorStop(0, 'rgba(15,0,0,1)'); g.addColorStop(0.45, 'rgba(110,5,5,1)'); g.addColorStop(1, 'rgba(110,5,5,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 1.3, 0, 7); ctx.fill();
        // drip streak
        ctx.fillStyle = 'rgba(100,0,0,0.75)';
        ctx.fillRect(x - r * 0.25, y, r * 0.5, r * (2 + Math.random() * 4));
        break;
      }
      case 'cut': case 'stab': {
        const a = Math.random() * Math.PI, len = kind === 'stab' ? r * 1.5 : r * 5;
        ctx.strokeStyle = 'rgba(130,8,8,1)'; ctx.lineWidth = r * 0.9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
        ctx.strokeStyle = 'rgba(25,0,0,1)'; ctx.lineWidth = r * 0.3;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * len * 0.9, y - Math.sin(a) * len * 0.9); ctx.lineTo(x + Math.cos(a) * len * 0.9, y + Math.sin(a) * len * 0.9); ctx.stroke();
        break;
      }
      case 'blunt': case 'fist': case 'kick': case 'impact': {
        g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, 'rgba(70,20,60,0.6)'); g.addColorStop(0.6, 'rgba(60,30,70,0.3)'); g.addColorStop(1, 'rgba(60,30,70,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, 7); ctx.fill();
        if (scale > 1.2) { ctx.fillStyle = 'rgba(120,10,10,0.8)'; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 7); ctx.fill(); }
        break;
      }
      case 'explosion': case 'burn': {
        g = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
        g.addColorStop(0, 'rgba(15,10,5,0.95)'); g.addColorStop(0.5, 'rgba(60,25,10,0.6)'); g.addColorStop(1, 'rgba(40,20,10,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 6, 0, 7); ctx.fill();
        break;
      }
    }
  }
  ctx.restore();
}
