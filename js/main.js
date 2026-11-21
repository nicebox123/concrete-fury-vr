// Entry point: renderer, WebXR session, lighting, main loop.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { G, clamp } from './core/context.js';
import { Settings } from './core/settings.js';
import { initAudio } from './core/audio.js';
import { buildMaterials } from './core/materials.js';
import { PhysicsWorld } from './physics/verlet.js';
import { Effects } from './fx/effects.js';
import { Input } from './game/input.js';
import { Player } from './game/player.js';
import { WeaponManager } from './game/weapons.js';
import { PropManager } from './game/props.js';
import { EnemyManager } from './game/enemies.js';
import { ModeManager } from './game/modes.js';
import { UI } from './ui/ui.js';
import { HUD } from './ui/hud.js';

const status = document.getElementById('status');
const btnVR = document.getElementById('btnVR');
const btnDesktop = document.getElementById('btnDesktop');
const overlay = document.getElementById('overlay');

Settings.load();
G.items = [];
window.G = G; // handy for debugging in the console

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
G.renderer = renderer;

const scene = new THREE.Scene();
G.scene = scene;
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.03, 140);
camera.rotation.order = 'YXZ';
G.camera = camera;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.castShadow = true;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);

G.applyLevelEnvironment = (L) => {
  scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
  scene.background = new THREE.Color(L.fog.color);
  hemi.color.setHex(L.hemi.sky); hemi.groundColor.setHex(L.hemi.ground); hemi.intensity = L.hemi.intensity;
  sun.color.setHex(L.sun.color); sun.intensity = L.sun.intensity;
  const B = L.bounds, cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
  const span = Math.max(B.maxX - B.minX, B.maxZ - B.minZ) / 2 + 2;
  const dir = L.sun.dir.clone().normalize();
  sun.position.set(cx - dir.x * 30, 30, cz - dir.z * 30);
  sun.target.position.set(cx, 0, cz);
  const sc = sun.shadow.camera;
  sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = 80;
  sc.updateProjectionMatrix();
  G.audio.setReverb(L.reverb, 1.2 + L.reverb * 2);
  G.decalLight = L.hemi.intensity;
  G.fx.decals.mat.uniforms.uLight.value = Math.min(1, 0.55 + L.hemi.intensity * 0.6);
  applyQuality();
};

let lastShadows = null;
function applyQuality() {
  const shadows = Settings.shadows && !Settings.perfMode;
  renderer.shadowMap.enabled = shadows;
  sun.castShadow = shadows;
  const size = G.isVR ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (!G.isVR) renderer.setPixelRatio(Math.min(window.devicePixelRatio, Settings.perfMode ? 1 : 1.5));
  if (lastShadows !== null && lastShadows !== shadows) {
    // shader programs depend on shadow state: force recompilation once
    scene.traverse(o => { if (o.isMesh && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  }
  lastShadows = shadows;
  G.physics.iterations = Settings.physicsIterations;
}
G.applyQuality = applyQuality;

// ---------- systems ----------
buildMaterials();
initAudio();
G.physics = new PhysicsWorld();
G.fx = new Effects(scene);
G.input = new Input(renderer, renderer.domElement);
G.player = new Player(camera);
G.weapons = new WeaponManager();
G.props = new PropManager();
G.enemies = new EnemyManager();
G.modes = new ModeManager();
G.ui = new UI();
G.hud = new HUD();

// Lobby: load the training facility so menus have a backdrop
G.modes.start('training', 'training');
G.modes.current = null; // not "in game" until the player presses Start
G.started = false;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- start buttons ----------
function begin() {
  overlay.classList.add('hidden');
  G.audio.init();
  G.started = true;
  G.ui.openMain();
}

btnDesktop.addEventListener('click', () => {
  G.isVR = false;
  camera.position.set(0, 1.65, 0);
  begin();
});

// ?play=sandbox&map=warehouse jumps straight into a desktop game
const params = new URLSearchParams(location.search);
if (params.get('play')) {
  G.isVR = false;
  camera.position.set(0, 1.65, 0);
  overlay.classList.add('hidden');
  G.started = true;
  G.modes.start(params.get('play'), params.get('map') || 'training');
}

G.input.onClickUnlocked =() => { if (!G.isVR && G.started && !G.ui.isOpen()) G.input.lock(); };

async function startVR() {
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    renderer.xr.setFramebufferScaleFactor(Settings.perfMode ? 0.8 : 1.0);
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(1);
    G.isVR = true;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    applyQuality();
    session.addEventListener('end', () => {
      G.isVR = false;
      overlay.classList.remove('hidden');
      camera.position.set(0, 1.65, 0);
      G.ui.close();
      G.input.unlock();
      applyQuality();
    });
    begin();
    // re-place the menu once the headset pose is known
    setTimeout(() => { if (G.ui.isOpen()) G.ui.place(); }, 400);
  } catch (e) {
    status.textContent = 'Could not start VR: ' + e.message;
  }
}

(async () => {
  let vrOK = false;
  if (navigator.xr) { try { vrOK = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { } }
  if (vrOK) { btnVR.disabled = false; btnVR.textContent = 'Enter VR'; btnVR.addEventListener('click', startVR); status.textContent = 'Headset detected. Put it on and press Enter VR.'; }
  else {
    btnVR.textContent = 'VR not available';
    status.textContent = window.isSecureContext ? 'No WebXR headset found. You can play on desktop, or open this page in the Meta Quest Browser.' : 'WebXR needs HTTPS or localhost. Desktop mode works here.';
  }
})();

// ---------- main loop ----------
let last = performance.now();
const fpsEl = { t: 0, n: 0, fps: 0 };
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = clamp((now - last) / 1000, 1 / 144, 1 / 20);
  last = now;
  frame(dt, true);
});
// Debug hook: advance the simulation manually (used for automated tests)
G.stepFrame = (dt = 1 / 72, n = 1, render = false) => { for (let i = 0; i < n; i++) frame(dt, render && i === n - 1); };

function frame(dt, render) {
  G.dt = dt;
  G.time += dt;
  G.frame++;
  fpsEl.t += dt; fpsEl.n++; if (fpsEl.t > 1) { fpsEl.fps = Math.round(fpsEl.n / fpsEl.t); fpsEl.t = 0; fpsEl.n = 0; G.fps = fpsEl.fps; }

  const input = G.input;
  input.update();

  if (G.started) {
    // desktop shortcuts
    if (!G.isVR && input.keyPressed('Tab') && G.modes.current && G.modes.current.id === 'sandbox') {
      if (G.ui.screen === 'spawn') G.ui.close(); else G.ui.openSpawn();
    }
    G.ui.update(dt);
    G.player.update(dt);
    if (!G.paused) {
      G.enemies.update(dt);
      const steps = dt > 1 / 40 ? 2 : 1;
      for (let i = 0; i < steps; i++) G.physics.step(dt / steps);
      G.enemies.post(dt);
      G.weapons.update(dt);
      G.props.update(dt);
      G.modes.update(dt);
      if (G.level) G.level.update(dt);
    }
  } else {
    // idle lobby: still settle physics so the backdrop looks alive
    G.physics.step(dt);
    G.enemies.post(dt);
  }
  for (const it of G.items) it.sync();
  G.fx.update(dt);
  G.hud.update(dt);
  G.audio.updateListener(camera);
  if (render) renderer.render(scene, camera);
  input.endFrame();
}

status.textContent = status.textContent === 'Loading…' ? 'Ready.' : status.textContent;
