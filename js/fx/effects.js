// Pooled visual effects. Nothing here allocates per-hit: particle systems are
// fixed-size buffers, decals are a single InstancedMesh ring buffer whose fade
// and growth run in the shader, meshes (tracers, casings, smoke) are recycled.
import * as THREE from 'three';
import { G, rand } from '../core/context.js';
import { Settings } from '../core/settings.js';

function circleTex(soft = false) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (soft) { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.7, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

// ---------- Particle system (Points) ----------
class ParticleSystem {
  constructor(max, color, size, opts = {}) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.flags = new Uint8Array(max); // 1 = spawns decal when landing
    this.count = 0;
    this.cursor = 0;
    this.geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({
      color, size, sizeAttenuation: true, map: circleTex(opts.soft), alphaTest: opts.additive ? 0 : 0.4,
      transparent: !!opts.additive, depthWrite: !opts.additive,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.gravity = opts.gravity !== undefined ? opts.gravity : -9.8;
    this.drag = opts.drag || 0.0;
    this.onLand = opts.onLand || null;
    for (let i = 0; i < max; i++) this.life[i] = 0;
  }
  setBudget(n) { this.budget = Math.min(n, this.max); }
  emit(x, y, z, vx, vy, vz, life, flag = 0) {
    const lim = this.budget || this.max;
    const i = this.cursor; this.cursor = (this.cursor + 1) % lim;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.flags[i] = flag;
    if (i + 1 > this.count) this.count = i + 1;
  }
  update(dt) {
    const P = this.pos, V = this.vel, L = this.life, phys = G.physics;
    let alive = 0;
    const drag = Math.pow(1 - this.drag, dt * 60);
    for (let i = 0; i < this.count; i++) {
      if (L[i] <= 0) { P[i * 3 + 1] = -999; continue; }
      L[i] -= dt;
      alive++;
      V[i * 3 + 1] += this.gravity * dt;
      V[i * 3] *= drag; V[i * 3 + 1] *= drag; V[i * 3 + 2] *= drag;
      const nx = P[i * 3] + V[i * 3] * dt, ny = P[i * 3 + 1] + V[i * 3 + 1] * dt, nz = P[i * 3 + 2] + V[i * 3 + 2] * dt;
      if (this.onLand && V[i * 3 + 1] < 0 && (i + G.frame) % 2 === 0) {
        const gh = phys.groundHeight(nx, nz, P[i * 3 + 1], 0.05);
        if (ny <= gh + 0.01) {
          this.onLand(nx, gh, nz, this.flags[i], V[i * 3], V[i * 3 + 2]);
          L[i] = 0; P[i * 3 + 1] = -999; continue;
        }
      }
      P[i * 3] = nx; P[i * 3 + 1] = ny; P[i * 3 + 2] = nz;
    }
    if (alive === 0) this.count = 0;
    this.geo.setDrawRange(0, this.count);
    this.attr.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.count = 0; this.cursor = 0; }
}

// ---------- Decals (single instanced draw) ----------
const DECAL_VS = `
attribute vec4 aData; // x: tile, y: alpha, z: grow seconds, w: birth time
attribute vec3 aColor;
uniform float uTime;
uniform float uLife;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_vertex>
void main(){
  float age = uTime - aData.w;
  float grow = aData.z > 0.0 ? mix(0.25, 1.0, clamp(age / aData.z, 0.0, 1.0)) : 1.0;
  float fade = clamp((uLife - age) / 6.0, 0.0, 1.0);
  vAlpha = aData.y * fade;
  vColor = aColor;
  float tile = aData.x;
  vec2 cell = vec2(mod(tile, 4.0), floor(tile / 4.0));
  vUv = (uv + cell) / vec2(4.0, 2.0);
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position * grow, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const DECAL_FS = `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(t.rgb * vColor * uLight, a);
  #include <fog_fragment>
}`;

function decalAtlas() {
  const W = 1024, H = 512, T = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const r = Math.random;
  const blood = (cx, cy, scale, drops) => {
    x.fillStyle = 'rgba(255,255,255,1)';
    x.beginPath(); x.arc(cx, cy, 34 * scale, 0, 7); x.fill();
    for (let i = 0; i < drops; i++) {
      const a = r() * Math.PI * 2, d = (30 + r() * 80) * scale, rr = (3 + r() * 14) * scale;
      x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, 7); x.fill();
      // streak toward center
      x.lineWidth = rr * 0.8; x.strokeStyle = 'rgba(255,255,255,1)';
      x.beginPath(); x.moveTo(cx + Math.cos(a) * d * 0.4, cy + Math.sin(a) * d * 0.4); x.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); x.stroke();
    }
  };
  // tiles 0-3: blood splats (white mask; tinted by instance color)
  for (let i = 0; i < 4; i++) {
    const tx = (i % 4) * T, ty = 0;
    x.save(); x.beginPath(); x.rect(tx, ty, T, T); x.clip();
    blood(tx + T / 2, ty + T / 2, 0.8 + i * 0.12, 10 + i * 6);
    // inner darker variation done via alpha noise
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 120; k++) { x.fillStyle = `rgba(0,0,0,${r() * 0.25})`; x.beginPath(); x.arc(tx + r() * T, ty + r() * T, r() * 10, 0, 7); x.fill(); }
    x.globalCompositeOperation = 'source-over';
    x.restore();
  }
  // tile 4: bullet hole
  {
    const cx = T / 2, cy = T + T / 2;
    let g = x.createRadialGradient(cx, cy, 0, cx, cy, 70);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.15, 'rgba(60,60,60,0.9)'); g.addColorStop(0.5, 'rgba(90,90,90,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 70, 0, 7); x.fill();
    g = x.createRadialGradient(cx, cy, 0, cx, cy, 16);
    g.addColorStop(0, 'rgba(5,5,5,1)'); g.addColorStop(1, 'rgba(10,10,10,0.95)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 14, 0, 7); x.fill();
    x.strokeStyle = 'rgba(20,20,20,0.7)'; x.lineWidth = 2;
    for (let k = 0; k < 7; k++) { const a = r() * 7; x.beginPath(); x.moveTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14); x.lineTo(cx + Math.cos(a) * (30 + r() * 30), cy + Math.sin(a) * (30 + r() * 30)); x.stroke(); }
  }
  // tile 5: scorch
  {
    const cx = T + T / 2, cy = T + T / 2;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, 125);
    g.addColorStop(0, 'rgba(10,8,6,0.95)'); g.addColorStop(0.5, 'rgba(20,16,12,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 125, 0, 7); x.fill();
  }
  // tile 6: drip trail (small drops)
  {
    x.fillStyle = '#fff';
    for (let k = 0; k < 9; k++) { x.beginPath(); x.arc(2 * T + 60 + r() * 136, T + 60 + r() * 136, 4 + r() * 10, 0, 7); x.fill(); }
  }
  // tile 7: puddle (smooth blob)
  {
    const cx = 3 * T + T / 2, cy = T + T / 2;
    x.fillStyle = '#fff'; x.beginPath();
    for (let k = 0; k <= 24; k++) { const a = k / 24 * Math.PI * 2, rr = 90 + Math.sin(a * 3) * 12 + r() * 14; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; k ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.fill();
    // glossy highlight
    x.globalCompositeOperation = 'source-atop';
    const g = x.createRadialGradient(cx - 30, cy - 30, 0, cx - 30, cy - 30, 60);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(200,200,200,1)');
    x.fillStyle = g; x.fillRect(3 * T, T, T, T);
    x.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class DecalPool {
  constructor(max) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.data.setUsage(THREE.DynamicDrawUsage); this.color.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aData', this.data);
    geo.setAttribute('aColor', this.color);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VS, fragmentShader: DECAL_FS,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: decalAtlas() }, uTime: { value: 0 }, uLife: { value: 90 }, uLight: { value: 1 } }]),
      transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.cursor = 0;
    this.count = 0;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.count = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 0, 1); this._rot = new THREE.Quaternion(); this._ax = new THREE.Vector3();
    this.dirty = false;
  }
  add(pos, normal, size, tile, color, alpha = 1, grow = 0) {
    const lim = Math.min(this.max, Settings.maxDecals);
    const i = this.cursor; this.cursor = (this.cursor + 1) % lim;
    this._q.setFromUnitVectors(this._up, normal);
    this._rot.setFromAxisAngle(this._ax.set(0, 0, 1), Math.random() * Math.PI * 2);
    this._q.multiply(this._rot);
    this._p.copy(pos).addScaledVector(normal, 0.004 + Math.random() * 0.003);
    this._m.compose(this._p, this._q, this._s.set(size, size, size));
    this.mesh.setMatrixAt(i, this._m);
    this.data.setXYZW(i, tile, alpha, grow, G.time);
    this.color.setXYZ(i, color.r, color.g, color.b);
    if (i + 1 > this.count) this.count = i + 1;
    this.mesh.count = this.count;
    this.dirty = true;
  }
  update() {
    this.mat.uniforms.uTime.value = G.time;
    this.mat.uniforms.uLife.value = Settings.perfMode ? 35 : 90;
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.data.needsUpdate = true; this.color.needsUpdate = true;
      this.dirty = false;
    }
  }
  clear() { this.count = 0; this.cursor = 0; this.mesh.count = 0; }
}

// ---------- Main FX manager ----------
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.blood = new ParticleSystem(700, 0x6a0000, 0.028, {
      onLand: (x, y, z, flag, vx, vz) => this._bloodLand(x, y, z, flag, vx, vz),
    });
    this.mist = new ParticleSystem(200, 0x8a0a0a, 0.06, { gravity: -1.5, drag: 0.08, soft: true });
    this.sparks = new ParticleSystem(220, 0xffc060, 0.022, { additive: true, gravity: -9 });
    this.dust = new ParticleSystem(260, 0x9a948c, 0.05, { gravity: -2.5, drag: 0.06, soft: true });
    this.glass = new ParticleSystem(200, 0xbfe0ea, 0.022, { gravity: -9.8 });
    this.debris = new ParticleSystem(160, 0x5d574f, 0.035, { gravity: -9.8 });
    for (const s of [this.blood, this.mist, this.sparks, this.dust, this.glass, this.debris]) scene.add(s.points);
    this.decals = new DecalPool(260);
    scene.add(this.decals.mesh);
    this.landDecalsThisFrame = 0;
    this.spurts = [];
    this.bloodColor = new THREE.Color(0x5a0000);
    this.holeColor = new THREE.Color(0xffffff);

    // Muzzle flash
    const flashTex = this._starTex();
    const fm = new THREE.MeshBasicMaterial({ map: flashTex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
        p.rotation.set(k === 0 ? 0 : Math.PI / 2, k === 2 ? Math.PI / 2 : 0, 0);
        if (k > 0) { p.scale.set(0.7, 1.6, 1); p.position.z = -0.08; }
        g.add(p);
      }
      g.visible = false; g.userData.t = 0;
      scene.add(g); this.flashes.push(g);
    }
    this.flashLight = new THREE.PointLight(0xffb060, 0, 8, 2);
    scene.add(this.flashLight);
    this.flashLightT = 0;

    // Tracers
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const tg = new THREE.BoxGeometry(0.008, 0.008, 1); tg.translate(0, 0, -0.5);
    this.tracers = [];
    for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(tg, tm); m.visible = false; m.userData.t = 0; scene.add(m); this.tracers.push(m); }
    this.tracerI = 0;

    // Casings
    const cg = new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 6); cg.rotateZ(Math.PI / 2);
    const sg = new THREE.CylinderGeometry(0.009, 0.009, 0.06, 8); sg.rotateZ(Math.PI / 2);
    this.casingMats = { brass: new THREE.MeshStandardMaterial({ color: 0xc9a046, metalness: 1, roughness: 0.3 }), shell: new THREE.MeshStandardMaterial({ color: 0xa8241c, roughness: 0.5 }) };
    this.casings = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(cg, this.casingMats.brass); m.visible = false;
      m.userData = { v: new THREE.Vector3(), spin: new THREE.Vector3(), t: 0, bounced: 0, geoSmall: cg, geoShell: sg };
      scene.add(m); this.casings.push(m);
    }
    this.casingI = 0;

    // Smoke puffs
    const smokeTex = circleTex(true);
    this.smokes = [];
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x8a8a8a, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; s.userData = { t: 0, life: 1, v: new THREE.Vector3(), s0: 0.1, s1: 0.5, o: 0.4 };
      scene.add(s); this.smokes.push(s);
    }
    this.smokeI = 0;

    // Explosion fireballs
    this.fireballs = [];
    const fbm = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), fbm.clone()); m.visible = false; m.userData.t = 0;
      scene.add(m); this.fireballs.push(m);
    }
    this.explLight = new THREE.PointLight(0xff8a30, 0, 18, 2);
    scene.add(this.explLight);

    this.applySettings();
    Settings.onChange(() => this.applySettings());
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }

  applySettings() {
    this.blood.setBudget(Settings.maxBloodParticles);
    this.mist.setBudget(Settings.perfMode ? 60 : 200);
    this.sparks.setBudget(Settings.perfMode ? 80 : 220);
    this.dust.setBudget(Settings.perfMode ? 90 : 260);
  }

  _starTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,200,120,0.8)'); g.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(255,230,180,0.9)';
    for (let i = 0; i < 6; i++) { x.save(); x.translate(64, 64); x.rotate(i / 6 * Math.PI * 2 + Math.random() * 0.4); x.beginPath(); x.moveTo(-5, 0); x.lineTo(0, -62); x.lineTo(5, 0); x.fill(); x.restore(); }
    return new THREE.CanvasTexture(c);
  }

  clear() {
    for (const s of [this.blood, this.mist, this.sparks, this.dust, this.glass, this.debris]) s.clear();
    this.decals.clear();
    this.spurts.length = 0;
  }

  // ---- Blood ----
  // dir: impact direction (normalized). intensity ~ 0.5 .. 3
  bloodBurst(pos, dir, intensity = 1, opts = {}) {
    if (!Settings.blood) return;
    const gs = Settings.goreScale;
    const n = Math.floor((8 + 18 * intensity) * gs);
    for (let i = 0; i < n; i++) {
      const sp = rand(0.6, 3.2) * (0.6 + intensity * 0.4);
      const back = Math.random() < 0.35 ? -0.5 : 1; // some splash back toward attacker
      this.blood.emit(
        pos.x, pos.y, pos.z,
        dir.x * sp * back + rand(-1.2, 1.2), dir.y * sp * back + rand(-0.3, 1.8), dir.z * sp * back + rand(-1.2, 1.2),
        rand(0.6, 1.6), Math.random() < 0.45 ? 1 : 0);
    }
    const mists = Math.floor(4 * gs * intensity);
    for (let i = 0; i < mists; i++) this.mist.emit(pos.x, pos.y, pos.z, dir.x * rand(0.3, 1.2) + rand(-0.4, 0.4), rand(-0.1, 0.5), dir.z * rand(0.3, 1.2) + rand(-0.4, 0.4), rand(0.25, 0.6));
    // Exit spray onto the surface behind the target
    if (opts.spray && Settings.decals) {
      const hit = G.physics.raycastStatic(pos, dir, 2.5);
      if (hit) {
        this.decals.add(hit.point, hit.normal, rand(0.25, 0.55) * gs * intensity, Math.floor(rand(0, 4)), this._surfaceBlood(hit.box.material), 0.95);
      }
    }
  }

  _surfaceBlood(material) {
    // Blood reads darker/glossier on metal and tiles, absorbed/brownish on concrete & wood.
    const c = this._tmpColor || (this._tmpColor = new THREE.Color());
    switch (material) {
      case 'metal': case 'rust': case 'tiles': return c.setRGB(0.62, 0.02, 0.02);
      case 'wood': case 'sand': return c.setRGB(0.45, 0.06, 0.03);
      default: return c.setRGB(0.55, 0.03, 0.02);
    }
  }

  _bloodLand(x, y, z, flag, vx, vz) {
    if (!flag || !Settings.decals || this.landDecalsThisFrame > 2) return;
    this.landDecalsThisFrame++;
    this._v.set(x, y, z);
    const box = null;
    const sp = Math.hypot(vx, vz);
    this.decals.add(this._v, this._n.set(0, 1, 0), rand(0.09, 0.22) * Settings.goreScale * (1 + sp * 0.15), sp > 2 ? Math.floor(rand(0, 4)) : 6, this._surfaceBlood(box), 0.9);
  }

  bloodDecal(pos, normal, size, tile = -1) {
    if (!Settings.decals || !Settings.blood) return;
    const surface = G.physics.raycastStatic(this._v.copy(pos).addScaledVector(normal, 0.2), this._n.copy(normal).negate(), 0.5);
    this.decals.add(pos, normal, size * Settings.goreScale, tile < 0 ? Math.floor(rand(0, 4)) : tile, this._surfaceBlood(surface ? surface.box.material : null), 0.95);
  }

  puddle(pos, size = 0.8) {
    if (!Settings.decals || !Settings.blood) return;
    const gh = G.physics.groundHeight(pos.x, pos.z, pos.y + 0.3, 0.6);
    if (gh < -50) return;
    this._v.set(pos.x, gh, pos.z);
    this.decals.add(this._v, this._n.set(0, 1, 0), size * Math.min(1.3, Settings.goreScale), 7, this._surfaceBlood(null), 0.92, 8);
  }

  drip(pos) {
    if (!Settings.blood) return;
    this.blood.emit(pos.x + rand(-0.03, 0.03), pos.y, pos.z + rand(-0.03, 0.03), rand(-0.1, 0.1), -0.5, rand(-0.1, 0.1), 2, Math.random() < 0.6 ? 1 : 0);
  }

  // continuous spurt from a stump (particle p, direction function)
  spurt(particle, dirFn, duration = 2.5) {
    if (!Settings.blood) return;
    if (this.spurts.length > 6) this.spurts.shift();
    this.spurts.push({ p: particle, dirFn, t: duration, acc: 0 });
  }

  // ---- Impacts ----
  bulletImpact(point, normal, material) {
    const surf = material;
    if (Settings.decals && surf !== 'glass') this.decals.add(point, normal, rand(0.05, 0.075), 4, this.holeColor, 0.95);
    const spark = surf === 'metal' || surf === 'rust';
    const col = spark ? 6 : 4;
    for (let i = 0; i < col; i++) {
      const vx = normal.x * rand(0.5, 2) + rand(-1, 1), vy = normal.y * rand(0.5, 2) + rand(0, 1.5), vz = normal.z * rand(0.5, 2) + rand(-1, 1);
      if (spark) this.sparks.emit(point.x, point.y, point.z, vx * 2, vy * 2, vz * 2, rand(0.1, 0.35));
      else this.debris.emit(point.x, point.y, point.z, vx, vy, vz, rand(0.3, 0.8));
    }
    for (let i = 0; i < 3; i++) this.dust.emit(point.x, point.y, point.z, normal.x * rand(0.2, 0.8) + rand(-0.2, 0.2), normal.y * rand(0.2, 0.8) + rand(0, 0.4), normal.z * rand(0.2, 0.8) + rand(-0.2, 0.2), rand(0.4, 0.9));
  }

  sparkBurst(point, normal, n = 10, speed = 3) {
    for (let i = 0; i < n; i++) this.sparks.emit(point.x, point.y, point.z, normal.x * speed * Math.random() + rand(-1.5, 1.5), normal.y * speed * Math.random() + rand(0, 2), normal.z * speed * Math.random() + rand(-1.5, 1.5), rand(0.1, 0.4));
  }

  dustBurst(point, n = 10, spread = 1) {
    for (let i = 0; i < n; i++) this.dust.emit(point.x + rand(-0.1, 0.1), point.y + rand(0, 0.2), point.z + rand(-0.1, 0.1), rand(-spread, spread), rand(0, spread), rand(-spread, spread), rand(0.5, 1.4));
  }

  glassBurst(point, n = 40, dir = null) {
    for (let i = 0; i < n; i++) {
      const d = dir || { x: 0, y: 0, z: 0 };
      this.glass.emit(point.x + rand(-0.4, 0.4), point.y + rand(-0.4, 0.4), point.z + rand(-0.4, 0.4), d.x * 2 + rand(-1.5, 1.5), rand(-0.5, 2), d.z * 2 + rand(-1.5, 1.5), rand(0.8, 1.6));
    }
  }

  woodBurst(point, n = 18) {
    for (let i = 0; i < n; i++) this.debris.emit(point.x + rand(-0.2, 0.2), point.y + rand(-0.2, 0.2), point.z + rand(-0.2, 0.2), rand(-2.5, 2.5), rand(0, 3.5), rand(-2.5, 2.5), rand(0.6, 1.4));
    this.dustBurst(point, 8, 0.8);
  }

  muzzleFlash(pos, quat, scale = 1) {
    const f = this.flashes.find(f => !f.visible) || this.flashes[0];
    f.position.copy(pos); f.quaternion.copy(quat);
    f.rotateZ(Math.random() * Math.PI);
    f.scale.setScalar(scale * rand(0.8, 1.2));
    f.visible = true; f.userData.t = 0.045;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 6 * scale;
    this.flashLightT = 0.05;
    this.smoke(pos, 0.04, 0.25 * scale, 0.6, 0.25);
  }

  tracer(from, to) {
    const m = this.tracers[this.tracerI]; this.tracerI = (this.tracerI + 1) % this.tracers.length;
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    m.position.copy(from);
    m.lookAt(to);
    m.rotateY(Math.PI);
    m.scale.set(1, 1, Math.min(len, 6));
    m.userData.from = m.userData.from || new THREE.Vector3();
    m.userData.dir = m.userData.dir || new THREE.Vector3();
    m.userData.from.copy(from); m.userData.dir.subVectors(to, from).normalize();
    m.userData.len = len; m.userData.d = 0;
    m.visible = true; m.userData.t = 0.12;
  }

  casing(pos, vel, shell = false) {
    const c = this.casings[this.casingI]; this.casingI = (this.casingI + 1) % this.casings.length;
    c.geometry = shell ? c.userData.geoShell : c.userData.geoSmall;
    c.material = shell ? this.casingMats.shell : this.casingMats.brass;
    c.position.copy(pos);
    c.userData.v.copy(vel);
    c.userData.spin.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
    c.userData.t = 4; c.userData.bounced = 0;
    c.visible = true;
  }

  smoke(pos, s0, s1, life, opacity = 0.4, vel = null, color = 0x8a8a8a) {
    const s = this.smokes[this.smokeI]; this.smokeI = (this.smokeI + 1) % this.smokes.length;
    s.position.copy(pos);
    const u = s.userData;
    u.t = 0; u.life = life; u.s0 = s0; u.s1 = s1; u.o = opacity;
    u.v.set(rand(-0.1, 0.1), rand(0.2, 0.5), rand(-0.1, 0.1));
    if (vel) u.v.add(vel);
    s.material.color.setHex(color);
    s.visible = true;
  }

  explosion(pos, radius = 5) {
    const fb = this.fireballs.find(f => !f.visible) || this.fireballs[0];
    fb.position.copy(pos); fb.visible = true; fb.userData.t = 0; fb.userData.r = radius * 0.45;
    this.explLight.position.copy(pos); this.explLight.intensity = 30;
    for (let i = 0; i < 40; i++) this.sparks.emit(pos.x, pos.y, pos.z, rand(-8, 8), rand(0, 9), rand(-8, 8), rand(0.3, 1.0));
    for (let i = 0; i < 30; i++) this.debris.emit(pos.x, pos.y + 0.2, pos.z, rand(-6, 6), rand(1, 8), rand(-6, 6), rand(0.8, 1.8));
    for (let i = 0; i < 6; i++) this.smoke(this._v.set(pos.x + rand(-0.8, 0.8), pos.y + rand(0, 1), pos.z + rand(-0.8, 0.8)), 0.6, 2.8, rand(1.8, 3), 0.55, null, 0x3a3734);
    if (Settings.decals) {
      const gh = G.physics.groundHeight(pos.x, pos.z, pos.y + 0.5, 1);
      this.decals.add(this._v.set(pos.x, gh, pos.z), this._n.set(0, 1, 0), radius * 0.7, 5, this.holeColor, 1);
    }
  }

  update(dt) {
    this.landDecalsThisFrame = 0;
    // spurts
    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const s = this.spurts[i];
      s.t -= dt;
      if (s.t <= 0) { this.spurts.splice(i, 1); continue; }
      s.acc += dt * 60 * Settings.goreScale * Math.min(1, s.t);
      const d = s.dirFn(this._n);
      while (s.acc > 1) {
        s.acc -= 1;
        const pulse = 0.6 + 0.4 * Math.sin(G.time * 14);
        const sp = rand(1.0, 2.6) * pulse;
        this.blood.emit(s.p.x, s.p.y, s.p.z, d.x * sp + rand(-0.3, 0.3), d.y * sp + rand(0, 0.5), d.z * sp + rand(-0.3, 0.3), rand(0.6, 1.3), Math.random() < 0.3 ? 1 : 0);
      }
    }
    this.blood.update(dt); this.mist.update(dt); this.sparks.update(dt);
    this.dust.update(dt); this.glass.update(dt); this.debris.update(dt);
    this.decals.update();

    for (const f of this.flashes) if (f.visible) { f.userData.t -= dt; if (f.userData.t <= 0) f.visible = false; }
    if (this.flashLightT > 0) { this.flashLightT -= dt; if (this.flashLightT <= 0) this.flashLight.intensity = 0; }
    for (const m of this.tracers) if (m.visible) {
      const u = m.userData; u.t -= dt;
      u.d += dt * 260;
      if (u.t <= 0 || u.d > u.len) { m.visible = false; continue; }
      m.position.copy(u.from).addScaledVector(u.dir, u.d);
      m.scale.z = Math.min(3, u.len - u.d);
    }
    const phys = G.physics;
    for (const c of this.casings) if (c.visible) {
      const u = c.userData; u.t -= dt;
      if (u.t <= 0) { c.visible = false; continue; }
      u.v.y -= 9.8 * dt;
      c.position.addScaledVector(u.v, dt);
      c.rotation.x += u.spin.x * dt; c.rotation.y += u.spin.y * dt; c.rotation.z += u.spin.z * dt;
      const gh = phys.groundHeight(c.position.x, c.position.z, c.position.y, 0.05);
      if (c.position.y < gh + 0.005) {
        c.position.y = gh + 0.005;
        if (u.v.y < -0.4 && u.bounced < 3) { G.audio.play('casing', c.position, 0.6 / (u.bounced + 1)); u.bounced++; }
        u.v.y = -u.v.y * 0.35; u.v.x *= 0.5; u.v.z *= 0.5; u.spin.multiplyScalar(0.5);
      }
    }
    for (const s of this.smokes) if (s.visible) {
      const u = s.userData; u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { s.visible = false; continue; }
      s.position.addScaledVector(u.v, dt);
      s.scale.setScalar(u.s0 + (u.s1 - u.s0) * Math.sqrt(k));
      s.material.opacity = u.o * (1 - k);
    }
    for (const f of this.fireballs) if (f.visible) {
      f.userData.t += dt;
      const k = f.userData.t / 0.45;
      if (k >= 1) { f.visible = false; continue; }
      f.scale.setScalar(f.userData.r * (0.3 + k));
      f.material.opacity = 1 - k;
      f.material.color.setRGB(1, 0.65 - k * 0.4, 0.25 - k * 0.2);
    }
    if (this.explLight.intensity > 0) this.explLight.intensity = Math.max(0, this.explLight.intensity - dt * 80);
  }
}
