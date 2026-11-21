// Game modes: Sandbox, Survival, Wave Arena, Training.
import * as THREE from 'three';
import { G, rand, pick } from '../core/context.js';
import { Settings } from '../core/settings.js';
import { buildMap } from '../world/maps.js';

export const MODES = {
  sandbox: { id: 'sandbox', name: 'Sandbox', short: 'spawn anything', desc: 'No objective. Spawn enemies, weapons and objects from the spawn menu (X / Tab). Infinite ammo; God mode and AI behaviour are in the menu.' },
  survival: { id: 'survival', name: 'Survival', short: 'endless, escalating', desc: 'Enemies keep coming and get tougher over time. Ammo is limited: grab ammo boxes and enemy guns. Health regenerates when out of combat.' },
  waves: { id: 'waves', name: 'Wave Arena', short: 'clear every wave', desc: 'Fight escalating waves in the pit. Between waves you heal, restock and get a new weapon drop.', defaultMap: 'arena' },
  training: { id: 'training', name: 'Training', short: 'range + dummies', desc: 'Learn the controls: firing range with steel targets, every weapon on the armory bench, melee dummies, climbing tower. You cannot die here.', forceMap: 'training' },
};

function spawnPointFar(minDist = 9) {
  const L = G.level, pl = G.player;
  const pts = L.enemySpawns.slice().sort(() => Math.random() - 0.5);
  let fallback = null;
  for (const p of pts) {
    const d = Math.hypot(p.x - pl.headPos.x, p.z - pl.headPos.z);
    if (d < minDist) continue;
    fallback = fallback || p;
    const eye = new THREE.Vector3(p.x, 1.6, p.z);
    if (!G.physics.lineClear(eye, pl.headPos)) return p;
  }
  return fallback || pts[0];
}

function enemyLimit() { return Settings.maxEnemies; }

class BaseMode {
  constructor(def) { Object.assign(this, def); this.time = 0; this.regen = true; this.infiniteAmmo = true; this.damageMul = 1; }
  start() { }
  update(dt) { this.time += dt; }
  hud() { return []; }
  onKill(e, kind) { }
  onDeath() { }
}

class Sandbox extends BaseMode {
  start() {
    G.hud.flash(G.isVR ? 'PRESS X FOR THE SPAWN MENU' : 'PRESS TAB FOR THE SPAWN MENU', 3.5);
    this.respawnT = -1;
  }
  update(dt) {
    super.update(dt);
    if (this.respawnT > 0) { this.respawnT -= dt; if (this.respawnT <= 0) { const s = G.level.playerSpawn; G.player.reset(s.pos, s.yaw); } }
  }
  onDeath() { G.hud.flash('YOU DIED', 2.5); this.respawnT = 3; }
  hud() { return [`SANDBOX · AI ${Settings.aiMode.toUpperCase()}${Settings.godMode ? ' · GOD' : ''}`, `Kills ${G.stats.kills}`]; }
}

const SURVIVAL_TABLE = [
  { t: 0, types: { grunt: 3, stalker: 1 } },
  { t: 45, types: { grunt: 3, stalker: 2, gunner: 2 } },
  { t: 100, types: { grunt: 2, stalker: 2, gunner: 3, brute: 1 } },
  { t: 170, types: { grunt: 2, stalker: 3, gunner: 3, brute: 1, rifleman: 2 } },
  { t: 260, types: { grunt: 2, stalker: 3, gunner: 3, brute: 2, rifleman: 3 } },
];
function weighted(types) {
  const tot = Object.values(types).reduce((a, b) => a + b, 0);
  let r = Math.random() * tot;
  for (const [k, w] of Object.entries(types)) { r -= w; if (r <= 0) return k; }
  return Object.keys(types)[0];
}

class Survival extends BaseMode {
  start() {
    this.infiniteAmmo = false;
    this.regen = true;
    G.weapons.setReserves({ pistol: 3, rifle: 2, shell: 12, speedloader: 2 });
    this.spawnT = 3;
    this.over = false;
    G.hud.flash('SURVIVE', 2.5);
  }
  update(dt) {
    super.update(dt);
    if (this.over) return;
    const t = this.time;
    const tier = SURVIVAL_TABLE.filter(s => s.t <= t).pop();
    const maxAlive = Math.min(enemyLimit(), 2 + Math.floor(t / 35));
    this.spawnT -= dt;
    if (this.spawnT <= 0 && G.enemies.aliveCount < maxAlive) {
      this.spawnT = Math.max(1.8, 6 - t / 50);
      const p = spawnPointFar();
      if (p) G.enemies.spawn(weighted(tier.types), p.x + rand(-0.5, 0.5), p.z + rand(-0.5, 0.5), rand(0, 6.28)).hunt = true;
    }
  }
  onKill(e) {
    const r = Math.random();
    const p = new THREE.Vector3(e.P.pelvis.x, e.P.pelvis.y + 0.4, e.P.pelvis.z);
    if (r < 0.14) G.props.spawn('medkit', p);
    else if (r < 0.32) G.props.spawn('ammoBox', p);
  }
  score() { const s = G.stats; return s.kills * 100 + s.headshots * 50 + s.dismembers * 25 + Math.floor(this.time) * 2; }
  onDeath() {
    this.over = true;
    const s = G.stats;
    setTimeout(() => G.ui.openResults({
      title: 'YOU DIED', sub: `Survival · ${G.level.name}`,
      rows: [['Time survived', fmtTime(this.time)], ['Kills', s.kills], ['Headshots', s.headshots], ['Dismemberments', s.dismembers], ['Accuracy', acc()], ['Score', this.score()]],
    }), 1500);
  }
  hud() { return [`SURVIVAL  ${fmtTime(this.time)}`, `Kills ${G.stats.kills} · Score ${this.score()}`]; }
}

function waveComposition(n) {
  const list = [];
  const count = 3 + n * 2;
  for (let i = 0; i < count; i++) {
    let t = 'grunt';
    const r = Math.random();
    if (n >= 2 && r < 0.25) t = 'stalker';
    if (n >= 3 && r > 0.65) t = 'gunner';
    if (n >= 5 && r > 0.85) t = 'rifleman';
    list.push(t);
  }
  if (n >= 4) for (let i = 0; i < Math.floor((n - 2) / 2); i++) list.push('brute');
  return list.sort(() => Math.random() - 0.5);
}

class Waves extends BaseMode {
  start() {
    this.infiniteAmmo = false;
    this.regen = false;
    G.weapons.setReserves({ pistol: 4, rifle: 2, shell: 16, speedloader: 3 });
    this.wave = 0;
    this.state = 'intermission';
    this.stateT = 4;
    this.queue = [];
    this.over = false;
    G.hud.flash('WAVE 1 INCOMING', 3);
  }
  update(dt) {
    super.update(dt);
    if (this.over) return;
    this.stateT -= dt;
    if (this.state === 'intermission') {
      if (this.stateT <= 0) {
        this.wave++;
        this.queue = waveComposition(this.wave);
        this.total = this.queue.length;
        this.state = 'fight';
        this.spawnT = 0;
        G.audio.play('wave');
        G.hud.flash(`WAVE ${this.wave}`, 2.5);
      }
    } else {
      this.spawnT -= dt;
      if (this.queue.length && this.spawnT <= 0 && G.enemies.aliveCount < enemyLimit()) {
        this.spawnT = Math.max(0.8, 2.6 - this.wave * 0.15);
        const n = Math.min(2, this.queue.length);
        for (let i = 0; i < n; i++) {
          const p = spawnPointFar(6);
          if (p) G.enemies.spawn(this.queue.shift(), p.x + rand(-0.6, 0.6), p.z + rand(-0.6, 0.6), 0).hunt = true;
        }
      }
      if (!this.queue.length && G.enemies.aliveCount === 0) {
        this.state = 'intermission';
        this.stateT = 10;
        G.player.heal(45);
        G.weapons.addReserve('pistol', 2); G.weapons.addReserve('rifle', 1); G.weapons.addReserve('shell', 8); G.weapons.addReserve('speedloader', 1);
        G.audio.play('heal');
        G.hud.flash(`WAVE ${this.wave} CLEARED`, 3);
        const c = G.level.playerSpawn.pos;
        const ids = ['pistol', 'revolver', 'shotgun', 'rifle', 'machete', 'sledgehammer', 'bat'];
        G.weapons.spawn(pick(ids), new THREE.Vector3(c.x + rand(-2, 2), 1.6, c.z + rand(-2, 2)));
        if (this.wave % 2 === 0) G.props.spawn('medkit', new THREE.Vector3(c.x + rand(-2, 2), 1.5, c.z + rand(-2, 2)));
        G.props.spawn('ammoBox', new THREE.Vector3(c.x + rand(-2, 2), 1.5, c.z + rand(-2, 2)));
      }
    }
  }
  onDeath() {
    this.over = true;
    const s = G.stats;
    setTimeout(() => G.ui.openResults({
      title: 'DEFEATED', sub: `Wave Arena · ${G.level.name}`,
      rows: [['Wave reached', this.wave], ['Kills', s.kills], ['Headshots', s.headshots], ['Dismemberments', s.dismembers], ['Accuracy', acc()], ['Time', fmtTime(this.time)]],
    }), 1500);
  }
  hud() {
    if (this.state === 'intermission') return [`WAVE ${this.wave + 1} IN ${Math.ceil(Math.max(0, this.stateT))}`, `Kills ${G.stats.kills}`];
    return [`WAVE ${this.wave}`, `Enemies left ${this.queue.length + G.enemies.aliveCount}`];
  }
}

class Training extends BaseMode {
  start() {
    this.hits = 0;
    this.dummies = [];
    for (const p of G.level.dummySpots) this.dummies.push({ pos: p, enemy: G.enemies.spawn('dummy', p.x, p.z, Math.PI), t: 0 });
    G.hud.flash('TRAINING FACILITY', 2.5);
  }
  update(dt) {
    super.update(dt);
    for (const d of this.dummies) {
      if (!d.enemy.alive || d.enemy.removed) {
        d.t += dt;
        if (d.t > 5) { if (!d.enemy.removed) d.enemy.remove(); G.enemies.list = G.enemies.list.filter(e => !e.removed); d.enemy = G.enemies.spawn('dummy', d.pos.x, d.pos.z, Math.PI); d.t = 0; }
      }
    }
  }
  onTargetHit() { this.hits++; }
  hud() { return ['TRAINING', `Steel hits ${this.hits} · Dummies down ${G.stats.kills}`]; }
}

function fmtTime(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function acc() { const s = G.stats; return s.shots ? Math.round(100 * s.hits / s.shots) + '%' : '-'; }

const CLASSES = { sandbox: Sandbox, survival: Survival, waves: Waves, training: Training };

export class ModeManager {
  constructor() { this.current = null; this.mapId = null; }

  start(modeId, mapId) {
    const def = MODES[modeId];
    if (def.forceMap) mapId = def.forceMap;
    // tear down
    for (const h of G.player.hands) h.release(true);
    G.enemies.clear();
    for (const it of [...G.items]) it.destroy();
    G.items.length = 0;
    G.props.clear();
    G.fx.clear();
    if (G.level) G.level.dispose();
    G.physics.clear();
    // build
    G.level = buildMap(mapId);
    G.applyLevelEnvironment(G.level);
    this.mapId = mapId;
    for (const s of G.level.propSpots) G.props.spawn(s.type, s.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw));
    for (const s of G.level.weaponSpots) G.weapons.spawn(s.id, s.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw));
    for (const s of G.level.targetSpots) G.props.target(s.pos, s.yaw);
    const sp = G.level.playerSpawn;
    G.player.reset(sp.pos, sp.yaw);
    G.stats = { kills: 0, shots: 0, hits: 0, headshots: 0, dismembers: 0 };
    G.weapons.setReserves({});
    this.current = new CLASSES[modeId](def);
    this.current.start();
    G.started = true;
  }

  update(dt) { if (this.current) this.current.update(dt); }
  onEnemyKilled(e, kind) {
    G.stats.kills++;
    if (this.current) this.current.onKill(e, kind);
  }
  onPlayerDeath() { if (this.current) this.current.onDeath(); }
  onTargetHit(t) { if (this.current && this.current.onTargetHit) this.current.onTargetHit(t); }
}
