// The five combat environments. Each builder lays out static geometry,
// lights, interactive pieces (doors, glass), prop/weapon spots and spawns.
import * as THREE from 'three';
import { Level } from './level.js';

const PI = Math.PI;

function training(L) {
  L.fog = { color: 0x1a1d20, near: 20, far: 80 };
  L.hemi = { sky: 0xd8dde6, ground: 0x4a4a48, intensity: 0.75 };
  L.sun = { dir: new THREE.Vector3(-0.3, -1, -0.45), color: 0xffffff, intensity: 1.2 };
  L.reverb = 0.3;
  L.room(-18, -15, 18, 15, 6, 'paintedWhite', 0.4, 'floor', 'concreteDark');
  // lower wall band
  L.box(-18, 0, -15, 18, 1.2, -14.9, 'paintedBlue', { noCollide: true });
  L.box(-18, 0, 14.9, 18, 1.2, 15, 'paintedBlue', { noCollide: true });
  L.box(-18, 0, -15, -17.9, 1.2, 15, 'paintedBlue', { noCollide: true });
  L.box(17.9, 0, -15, 18, 1.2, 15, 'paintedBlue', { noCollide: true });
  // shooting range
  L.box(-12, 0, -4.4, 12, 1.05, -3.8, 'woodDark');
  L.box(-12.05, 1.05, -4.45, 12.05, 1.1, -3.75, 'metal');
  for (const x of [-6, 0, 6]) L.box(x - 0.08, 0, -6, x + 0.08, 2.3, -4.4, 'paintedBlue');
  L.box(-12, 0, -15, 12, 1.6, -14, 'concreteDark'); // bullet trap berm
  L.box(-12.4, 0, -15, -12, 3, -4.4, 'concrete');
  L.box(12, 0, -15, 12.4, 3, -4.4, 'concrete');
  for (const [x, z] of [[-9, -8], [-3, -11], [3, -8], [9, -11], [-9, -13], [3, -13.4], [-3, -7], [9, -7]]) L.targetSpots.push({ pos: new THREE.Vector3(x, 0, z), yaw: 0 });
  for (const x of [-9, -3, 3, 9]) L.decal(x, 0.002, -4.9, 1.6, 0.08, 'hazard');
  // armory bench (west)
  L.box(-17.6, 0, -2.5, -16.2, 0.9, 6.5, 'woodDark');
  L.box(-17.65, 0.9, -2.55, -16.15, 0.94, 6.55, 'metal');
  const ws = ['pistol', 'revolver', 'shotgun', 'rifle', 'knife', 'machete', 'bat', 'sledgehammer'];
  ws.forEach((id, i) => L.weapon(id, -16.9, 1.06, -2 + i * 1.05, -PI / 2));
  L.prop('ammoBox', -16.9, 1.05, 6.1); L.prop('medkit', -16.9, 1.05, 5.4);
  // climbing tower + parkour
  L.box(15, 0, -3, 18, 3.5, 1, 'concrete');
  L.railing(15, -3, 15, 1, 3.5);
  L.ladder(14.93, -1, 3.5, 1, 0);
  L.box(10.5, 0, 2, 12, 0.5, 3.5, 'concretePlain');
  L.box(12, 0, 2, 13.5, 1.0, 3.5, 'concretePlain');
  L.box(13.5, 0, 1.0, 15, 1.5, 3.5, 'concretePlain');
  L.box(15, 0, 1.0, 18, 2.4, 3.5, 'concretePlain', { climbable: true });
  // breach room (south-west) with door + window
  L.wallX(8, -17.6, -9, 3, 0.2, 'painted', [[-13, 1.0, 2.15]]);
  L.wallZ(-9, 8, 14.6, 3, 0.2, 'painted', [[11.3, 2.0, 2.2]]);
  L.box(-9.1, 0, 10.3, -8.9, 1.0, 12.3, 'painted');
  L.glass(-9.03, 1.0, 10.3, -8.97, 2.2, 12.3);
  L.box(-17.6, 3, 8, -8.9, 3.2, 14.6, 'concreteDark');
  L.door(-13.5, 8, 1.0, 0);
  L.prop('crate', -16, 0.31, 13); L.prop('smallCrate', -16, 0.82, 13.1); L.prop('table', -12, 0.39, 12); L.prop('chair', -11, 0.45, 11);
  // free-standing glass wall to smash
  L.box(-4.2, 0, 2.95, -4, 2.5, 3.15, 'metal'); L.box(0, 0, 2.95, 0.2, 2.5, 3.15, 'metal');
  L.box(-4.2, 2.5, 2.95, 0.2, 2.6, 3.15, 'metal');
  L.glass(-4, 0, 3.02, 0, 2.5, 3.08);
  // melee dummies area
  L.decal(11, 0.003, 7, 8, 6.5, 'tread');
  for (const [x, z] of [[8.5, 5], [11.5, 5], [14.5, 5], [10, 9], [13, 9]]) L.dummySpots.push(new THREE.Vector3(x, 0, z));
  // demo zone (north-east, behind the range wall)
  L.prop('explosiveBarrel', 15, 0.45, -9); L.prop('explosiveBarrel', 16.2, 0.45, -8.4);
  L.prop('crate', 14.5, 0.31, -12); L.prop('crate', 15.2, 0.92, -12.2); L.prop('barrel', 16.5, 0.45, -12.5);
  L.prop('cinderBlock', 13.5, 0.11, -7); L.prop('cinderBlock', 13.6, 0.32, -7);
  for (let i = 0; i < 5; i++) L.prop('bottle', -10 + i * 4.8, 1.25, -4.05);
  L.prop('crate', -14, 0.31, -6); L.prop('barrel', -15, 0.45, -8);
  // lights
  L.light(-6, 5.95, -9, 0xfff4e0, 1.2, 22); L.light(6, 5.95, -9, 0xfff4e0, 1.2, 22);
  L.light(-8, 5.95, 6, 0xfff4e0, 1.1, 22); L.light(9, 5.95, 6, 0xfff4e0, 1.1, 22);
  for (const x of [-12, 0, 12]) for (const z of [-12, 0, 10]) L.fixture(x, 5.95, z);
  // signs
  L.sign(0, 4.0, -14.55, 0, 7, 1.4, 'SHOOTING RANGE', 'Grab a gun from the armory bench on the left wall. Steel targets reset by themselves.');
  L.sign(-17.55, 2.6, 2, PI / 2, 4, 1.2, 'ARMORY', 'Grip a gun, then grip at your belt with the other hand for ammo. Drop a gun near your hip or shoulder to holster it.');
  L.sign(17.55, 3.2, 7, -PI / 2, 4.5, 1.4, 'MELEE DUMMIES', 'Swing hard: damage scales with speed. Blades cut limbs, blunt weapons break bones and knock enemies down.');
  L.sign(0, 2.6, 14.55, PI, 7.5, 2.2, 'CONTROLS', 'Left stick: move  |  Right stick: turn, up = jump, down = crouch\nGrip: grab / climb / pull distant items   Trigger: fire\nA/X on gun: drop mag   B/Y on gun: rack slide   Y: menu   X: spawn menu (sandbox)\nDesktop: WASD  Mouse  LMB fire  E grab  RMB throw  R reload  Q holster  F kick  Tab spawn');
  L.sign(16.5, 2.6, -2.9, PI, 2.4, 0.8, 'CLIMB', 'Grip the ladder rungs and pull.');
  L.playerSpawn = { pos: new THREE.Vector3(3, 0, 7), yaw: 0 };
  for (const [x, z] of [[-14, 11], [14, 11], [14, -1], [-14, -1], [0, 12], [-6, 0], [8, -1]]) L.spawn(x, z);
}

function industrial(L) {
  L.fog = { color: 0x15130f, near: 12, far: 60 };
  L.hemi = { sky: 0x9c9080, ground: 0x2a2620, intensity: 0.45 };
  L.sun = { dir: new THREE.Vector3(-0.5, -1, 0.3), color: 0xffd8a8, intensity: 1.3 };
  L.reverb = 0.5;
  L.room(-22, -16, 22, 16, 10, 'concrete', 0.5, 'floorDark', 'concreteDark');
  for (let x = -18; x <= 18; x += 6) { L.box(x - 0.5, 0, -16, x + 0.5, 10, -15.3, 'concrete'); L.box(x - 0.5, 0, 15.3, x + 0.5, 10, 16, 'concrete'); }
  for (let z = -12; z <= 12; z += 6) { L.box(-22, 0, z - 0.5, -21.3, 10, z + 0.5, 'concrete'); L.box(21.3, 0, z - 0.5, 22, 10, z + 0.5, 'concrete'); }
  // catwalks
  L.box(-22, 3.4, -16, 22, 3.6, -13.5, 'tread');
  L.railing(-22, -13.5, -10.6, -13.5, 3.6); L.railing(-9.4, -13.5, 7.4, -13.5, 3.6); L.railing(8.6, -13.5, 19.5, -13.5, 3.6);
  L.box(19.5, 3.4, -13.5, 22, 3.6, 16, 'tread');
  L.railing(19.5, -13.5, 19.5, 9.5, 3.6);
  for (let x = -18; x <= 18; x += 6) L.box(x - 0.12, 0, -13.75, x + 0.12, 3.4, -13.5, 'metal');
  for (let z = -8; z <= 14; z += 6) L.box(19.5, 0, z - 0.12, 19.75, 3.4, z + 0.12, 'metal');
  L.ladder(-10, -13.42, 3.6, 0, -1);
  L.ladder(8, -13.42, 3.6, 0, -1);
  L.stairs(18.5, 15.6, 0, -1, 2, 14, 0.25, 0.32, 'metal');
  // machinery
  L.box(-14, 0, -6, -10, 2.6, -3, 'rust'); L.box(-13.5, 2.6, -5.5, -10.5, 4.6, -3.5, 'metal');
  L.box(-12.3, 4.6, -4.8, -11.7, 8, -4.2, 'metal');
  L.box(6, 0, -8, 10, 2.2, -5, 'metal'); L.box(6.5, 2.2, -7.5, 9.5, 3, -5.5, 'rust');
  L.box(-4, 0, -10, -1, 1.3, -8.5, 'crateMetal');
  // conveyor line
  L.box(-8, 0.85, 2, 8, 1.0, 3.2, 'metal');
  L.box(-8, 1.0, 2.1, 8, 1.03, 3.1, 'tread', { noCollide: true });
  for (let x = -7.5; x <= 7.5; x += 2.5) L.box(x - 0.08, 0, 2.1, x + 0.08, 0.85, 3.1, 'metal');
  L.box(-8, 0, 2, 8, 0.85, 3.2, 'metal', { noRender: true });
  // tanks
  for (const z of [5.5, 11]) {
    L.box(12.6, 0, z - 1.5, 15.6, 6, z + 1.5, 'rust', { noRender: true });
    L.deco(new THREE.CylinderGeometry(1.5, 1.5, 6, 20), 'rust', 14.1, 3, z);
    L.deco(new THREE.SphereGeometry(1.5, 20, 8, 0, PI * 2, 0, PI / 2), 'rust', 14.1, 6, z);
    L.pipe(14.1, 7, z, 14.1, 9.8, z, 0.18);
  }
  // containers
  L.box(-20, 0, 4, -14, 2.6, 6.4, 'paintedRed');
  L.box(-20, 0, 7, -14, 2.6, 9.4, 'paintedBlue');
  L.box(-19.5, 2.6, 4.5, -13.5, 5.2, 6.9, 'paintedYellow', { climbable: true });
  L.box(2, 0, 7.5, 3.4, 1.15, 8.9, 'crate'); L.box(-5, 0, 6.5, -3.6, 1.15, 7.9, 'crate'); L.box(-5, 1.15, 6.6, -3.8, 2.2, 7.8, 'crate');
  // control room
  L.wallX(11, -21.5, -14, 3, 0.2, 'painted', [[-15.5, 1.1, 2.15]]);
  L.wallZ(-14, 11, 15.5, 3, 0.2, 'painted', [[13.25, 2.6, 2.2]]);
  L.box(-14.1, 0, 11.95, -13.9, 1.0, 14.55, 'painted');
  L.glass(-14.03, 1.0, 11.95, -13.97, 2.2, 14.55);
  L.box(-21.5, 3, 11, -13.9, 3.2, 15.5, 'concreteDark');
  L.door(-16.05, 11, 1.1, 0);
  L.box(-21, 0, 14, -17, 0.95, 15.3, 'metal'); L.box(-20.5, 0.95, 14.8, -17.5, 1.5, 15.2, 'black', { noCollide: true });
  L.prop('chair', -19, 0.45, 13.2); L.prop('chair', -17.5, 0.45, 12.8);
  L.light(-17.8, 2.95, 13.2, 0xcfe6ff, 0.6, 8, 'panel');
  // pipes
  L.pipe(-21.4, 7, -15, 21.4, 7, -15, 0.25, 'rust');
  L.pipe(-21.4, 6.2, -14.9, 21.4, 6.2, -14.9, 0.15, 'metal');
  L.pipe(21.3, 6, -15, 21.3, 6, 15, 0.22, 'rust');
  for (const x of [-12, 3, 15]) L.pipe(x, 0.2, -15.2, x, 7, -15.2, 0.18, 'metal');
  // floor markings
  L.decal(0, 0.002, -1.2, 18, 0.25, 'hazard'); L.decal(0, 0.002, 4.6, 18, 0.25, 'hazard');
  L.decal(-9.3, 0.002, -4.5, 0.25, 4, 'hazard');
  // workbench near spawn
  L.box(-2.2, 0, 12.4, 2.2, 0.92, 13.3, 'metal');
  ['pistol', 'shotgun', 'bat', 'knife'].forEach((id, i) => L.weapon(id, -1.6 + i * 1.05, 1.06, 12.85, PI));
  L.prop('ammoBox', 3, 0.1, 13); L.prop('medkit', -3, 0.07, 13);
  // props
  L.prop('explosiveBarrel', -9, 0.45, -2); L.prop('explosiveBarrel', -8.3, 0.45, -1.2); L.prop('explosiveBarrel', 5, 0.45, -4);
  L.prop('explosiveBarrel', 11, 0.45, 9);
  L.prop('barrel', 10.5, 0.45, -3.5); L.prop('barrel', 11.2, 0.45, -2.8); L.prop('barrel', -18, 0.45, 1);
  L.prop('crate', 0, 0.31, -6); L.prop('crate', 0.7, 0.31, -6.2); L.prop('crate', 0.3, 0.92, -6.1);
  L.prop('metalCrate', -6, 0.31, 9.5); L.prop('pallet', 6, 0.07, 10); L.prop('pallet', 6, 0.2, 10);
  L.prop('cinderBlock', -2, 0.11, 0); L.prop('cinderBlock', -1.5, 0.11, 0.3); L.prop('smallCrate', 4, 0.21, -1);
  // lights
  for (const [x, z] of [[-12, -5], [12, -5], [-12, 8], [9, 8]]) L.light(x, 9.6, z, 0xffbf78, 1.6, 26, 'lamp');
  L.light(0, 3.35, -14.8, 0xff3a22, 0.2, 6, 'panel');
  L.playerSpawn = { pos: new THREE.Vector3(0, 0, 10), yaw: 0 };
  for (const [x, z] of [[-18, -10], [18, -10], [-18, -1], [10, -12], [0, -12], [17, 2], [-8, -12], [8, 14]]) L.spawn(x, z);
}

function abandoned(L) {
  L.fog = { color: 0x0b0a09, near: 5, far: 32 };
  L.hemi = { sky: 0x6a6e78, ground: 0x1a1612, intensity: 0.28 };
  L.sun = { dir: new THREE.Vector3(0.35, -1, 0.2), color: 0xd8c8b0, intensity: 0.55 };
  L.reverb = 0.35;
  L.room(-16, -14, 16, 14, 3.2, 'painted', 0.3, 'floorDark', 'concreteDark');
  // corridor walls
  L.wallX(-1.5, -16, 16, 3.2, 0.2, 'painted', [[-11, 1.0, 2.15], [-1, 2.4, 3.2], [9, 1.0, 2.15]]);
  L.wallX(1.5, -16, 16, 3.2, 0.2, 'painted', [[-8, 1.0, 2.15], [3, 1.0, 2.15], [12, 1.8, 3.2]]);
  L.wallZ(-6, -14, -1.6, 3.2, 0.2, 'painted', [[-8, 1.0, 2.15]]);
  L.wallZ(4, -14, -1.6, 3.2, 0.2, 'painted', [[-10, 1.8, 3.2]]);
  L.wallZ(-2, 1.6, 14, 3.2, 0.2, 'painted', [[8, 1.0, 2.15]]);
  L.wallZ(7, 1.6, 14, 3.2, 0.2, 'painted', [[5, 1.0, 2.15]]);
  // doors
  L.door(-11.5, -1.5, 1.0, 0); L.door(8.5, -1.5, 1.0, 0); L.door(-8.5, 1.5, 1.0, 0); L.door(2.5, 1.5, 1.0, 0);
  L.door(-6, -8.5, 1.0, -PI / 2); L.door(-2, 7.5, 1.0, -PI / 2); L.door(7, 4.5, 1.0, -PI / 2);
  // bathroom tiles
  L.box(7.1, 0, 1.6, 16, 0.01, 14, 'tilesDirty', { noCollide: true, uvScale: 1.5 });
  L.box(15.85, 0, 1.6, 16, 1.4, 14, 'tilesDirty', { noCollide: true, uvScale: 1.5 });
  for (const z of [4, 7, 10]) { L.box(14.2, 0, z - 0.6, 16, 1.8, z - 0.55, 'paintedWhite'); L.box(15.2, 0, z, 15.9, 0.45, z + 0.6, 'paintedWhite'); }
  // rubble at the broken walls
  L.box(-1.8, 0, -2.4, -0.4, 0.35, -0.7, 'concretePlain'); L.box(-0.6, 0, -2.2, 0.3, 0.2, -1.0, 'concretePlain');
  L.box(11.2, 0, 1.0, 12.4, 0.3, 2.2, 'concretePlain');
  L.box(3.2, 0, -10.5, 4.8, 0.4, -9.4, 'concretePlain');
  L.prop('cinderBlock', -1.2, 0.5, -1.6); L.prop('cinderBlock', 0.5, 0.11, -2.6); L.prop('cinderBlock', 12.6, 0.11, 2.6);
  // furniture
  L.box(-15.6, 0, -13.6, -13, 2.0, -12.9, 'woodDark'); // shelf
  L.box(-15.7, 0, 9, -14.7, 0.5, 13, 'paintedRed'); // mattress
  L.box(9, 0, -13.6, 14, 1.0, -12.8, 'woodDark'); // counter
  L.box(-5.6, 0, 12.6, -2.4, 0.85, 13.6, 'woodDark');
  L.prop('table', -13, 0.39, -5); L.prop('chair', -12, 0.45, -6); L.prop('chair', -14, 0.45, -4);
  L.prop('table', 0, 0.39, -9); L.prop('chair', 1, 0.45, -8);
  L.prop('table', -10, 0.39, 9); L.prop('bottle', -10.2, 0.92, 9); L.prop('bottle', -9.6, 0.92, 9.2);
  L.prop('crate', 10, 0.31, -6); L.prop('crate', 11, 0.31, -6.3); L.prop('smallCrate', 10.5, 0.82, -6.1);
  L.prop('pallet', 3, 0.07, 10); L.prop('barrel', 5.5, 0.45, 12); L.prop('explosiveBarrel', 13, 0.45, -10);
  L.prop('chair', 5, 0.45, 8); L.prop('bottle', 9.8, 1.13, -13.2); L.prop('bottle', 11, 1.13, -13.2);
  // boarded windows on outer walls
  for (const x of [-10, 0, 10]) for (let i = 0; i < 3; i++) L.box(x - 0.9, 1.1 + i * 0.35, -14.02, x + 0.9, 1.3 + i * 0.35, -13.95, 'wood', { noCollide: true });
  for (const x of [-12, 2, 12]) for (let i = 0; i < 3; i++) L.box(x - 0.9, 1.1 + i * 0.35, 13.95, x + 0.9, 1.3 + i * 0.35, 14.02, 'wood', { noCollide: true });
  // weapons on the first table
  L.weapon('pistol', -13.3, 0.84, -5.1, 0); L.weapon('knife', -12.6, 0.84, -4.9, 0); L.weapon('machete', -13.2, 0.84, -4.6, 0.3);
  L.weapon('bat', 0, 0.84, -9, 1.2); L.weapon('shotgun', -10, 0.84, 8.7, 0);
  L.prop('medkit', 12, 1.07, -13.2); L.prop('ammoBox', -15, 2.1, -13.2);
  // flickering lights
  L.light(-11, 3.15, -8, 0xffc890, 0.7, 11, 'panel', true);
  L.light(0, 3.15, 0, 0xffd8a8, 0.6, 12, 'panel', false);
  L.light(10, 3.15, -8, 0xffc890, 0.6, 11, 'panel', true);
  L.light(-8, 3.15, 8, 0xffd0a0, 0.7, 11, 'panel', true);
  for (const [x, z] of [[-10, 0], [10, 0], [3, 8], [12, 8], [-4, -8]]) L.fixture(x, 3.15, z, 'lightWarm');
  L.playerSpawn = { pos: new THREE.Vector3(-14, 0, 0), yaw: -PI / 2 };
  for (const [x, z] of [[14, 0], [12, -8], [12, 9], [-10, 10], [0, -11], [-3, 10], [5, -4]]) L.spawn(x, z);
}

function arena(L) {
  L.fog = { color: 0x0d0c0b, near: 18, far: 60 };
  L.hemi = { sky: 0x8a8070, ground: 0x2a2018, intensity: 0.4 };
  L.sun = { dir: new THREE.Vector3(0.15, -1, 0.1), color: 0xfff0d8, intensity: 1.6 };
  L.reverb = 0.6;
  L.floor(-19, -19, 19, 19, 'sand');
  const H = 4.5, T = 0.4;
  L.wallX(-14.2, -10, 10, H, T, 'concreteDark', [[0, 2.4, 3.0]]);
  L.wallX(14.2, -10, 10, H, T, 'concreteDark', [[0, 2.4, 3.0]]);
  L.wallZ(-14.2, -10, 10, H, T, 'concreteDark', [[0, 2.4, 3.0]]);
  L.wallZ(14.2, -10, 10, H, T, 'concreteDark', [[0, 2.4, 3.0]]);
  // stepped chamfered corners
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = sx * (10 + 4.2 * t), z = sz * (14.2 - 4.2 * t);
      L.box(x - 0.5, 0, z - 0.5, x + 0.5, H, z + 0.5, 'concreteDark');
    }
  }
  // spectator ring (unreachable) with seats; gaps where the gate tunnels pass
  for (let k = 0; k < 4; k++) {
    const y = H + k * 0.45, o = 14.4 + k * 0.8, o2 = o + 0.8;
    for (const s of [-1, 1]) {
      const a = s < 0 ? -o2 : o, b = s < 0 ? -o : o2;
      L.box(-o2, 0, a, -1.6, y, b, 'concrete'); L.box(1.6, 0, a, o2, y, b, 'concrete'); L.box(-1.6, 3.4, a, 1.6, y, b, 'concrete');
      L.box(a, 0, -o, b, y, -1.6, 'concrete'); L.box(a, 0, 1.6, b, y, o, 'concrete'); L.box(a, 3.4, -1.6, b, y, 1.6, 'concrete');
    }
  }
  L.railing(-14.4, -14.4, 14.4, -14.4, H); L.railing(-14.4, 14.4, 14.4, 14.4, H);
  L.railing(-14.4, -14.4, -14.4, 14.4, H); L.railing(14.4, -14.4, 14.4, 14.4, H);
  // gate tunnels
  const tunnel = (dx, dz) => {
    const along = dx !== 0;
    for (const s of [-1, 1]) {
      if (along) L.box(Math.min(dx * 14.4, dx * 18.5), 0, s * 1.4 - 0.15, Math.max(dx * 14.4, dx * 18.5), 3.2, s * 1.4 + 0.15, 'concreteDark');
      else L.box(s * 1.4 - 0.15, 0, Math.min(dz * 14.4, dz * 18.5), s * 1.4 + 0.15, 3.2, Math.max(dz * 14.4, dz * 18.5), 'concreteDark');
    }
    if (along) { L.box(Math.min(dx * 14.4, dx * 18.5), 3.0, -1.6, Math.max(dx * 14.4, dx * 18.5), 3.4, 1.6, 'concreteDark'); L.box(dx * 18.5 - 0.2, 0, -1.6, dx * 18.5 + 0.2, 3.2, 1.6, 'concreteDark'); }
    else { L.box(-1.6, 3.0, Math.min(dz * 14.4, dz * 18.5), 1.6, 3.4, Math.max(dz * 14.4, dz * 18.5), 'concreteDark'); L.box(-1.6, 0, dz * 18.5 - 0.2, 1.6, 3.2, dz * 18.5 + 0.2, 'concreteDark'); }
    // raised portcullis
    if (along) for (let z = -1.0; z <= 1.0; z += 0.25) L.box(dx * 14.35 - 0.03, 2.5, z - 0.02, dx * 14.35 + 0.03, 3.0, z + 0.02, 'rust', { noCollide: true });
    else for (let x = -1.0; x <= 1.0; x += 0.25) L.box(x - 0.02, 2.5, dz * 14.35 - 0.03, x + 0.02, 3.0, dz * 14.35 + 0.03, 'rust', { noCollide: true });
    L.light(dx * 16.5, 2.95, dz * 16.5, 0xff3a22, 0.35, 6, 'panel');
  };
  tunnel(0, -1); tunnel(0, 1); tunnel(1, 0); tunnel(-1, 0);
  // cover
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { L.pillar(x, z, 1.6, H, 'concrete'); }
  L.box(-2, 0, -8.6, 2, 1.1, -7.9, 'concretePlain'); L.box(-2, 0, 7.9, 2, 1.1, 8.6, 'concretePlain');
  L.box(7.9, 0, -2, 8.6, 1.1, 2, 'concretePlain'); L.box(-8.6, 0, -2, -7.9, 1.1, 2, 'concretePlain');
  L.box(-2, 0, -2, 2, 0.6, 2, 'concrete'); L.box(-1.9, 0.6, -1.9, 1.9, 0.62, 1.9, 'tread', { noCollide: true });
  L.decal(0, 0.003, 0, 0.3, 22, 'hazard'); L.decal(0, 0.003, 0, 22, 0.3, 'hazard');
  // weapon pedestals
  for (const [x, z, id] of [[-11, -3, 'pistol'], [11, 3, 'shotgun'], [3, -11, 'machete'], [-3, 11, 'bat'], [11, -3, 'rifle'], [-11, 3, 'revolver']]) {
    L.box(x - 0.35, 0, z - 0.35, x + 0.35, 1.0, z + 0.35, 'concretePlain');
    L.weapon(id, x, 1.15, z, 0);
  }
  L.prop('explosiveBarrel', 9.5, 0.45, 9.5); L.prop('explosiveBarrel', -9.5, 0.45, -9.5);
  L.prop('crate', -9.5, 0.31, 9.5); L.prop('crate', 9.5, 0.31, -9.5); L.prop('medkit', 0, 0.68, 0.5); L.prop('ammoBox', 0, 0.71, -0.5);
  for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) L.light(x, 9, z, 0xfff2e0, 1.8, 30, 'lamp');
  L.playerSpawn = { pos: new THREE.Vector3(0, 0.6, 0.5), yaw: 0 };
  for (const [x, z] of [[0, -16.5], [0, 16.5], [16.5, 0], [-16.5, 0]]) L.spawn(x, z);
  L.bounds = { minX: -19, minZ: -19, maxX: 19, maxZ: 19 };
}

function warehouse(L) {
  L.fog = { color: 0x121416, near: 14, far: 65 };
  L.hemi = { sky: 0x9aa4b0, ground: 0x2c2a26, intensity: 0.5 };
  L.sun = { dir: new THREE.Vector3(-0.35, -1, -0.25), color: 0xfff4e0, intensity: 1.2 };
  L.reverb = 0.55;
  L.room(-24, -18, 24, 18, 9, 'concretePlain', 0.5, 'floor', 'concreteDark');
  for (let x = -20; x <= 20; x += 8) L.box(x - 0.15, 0, -18, x + 0.15, 9, -17.8, 'metal');
  // racks
  for (const rx of [-16, -10, -4]) {
    for (let z = -12; z <= 6; z += 2.5) for (const s of [-1, 1]) L.box(rx + s * 0.55 - 0.05, 0, z - 0.05, rx + s * 0.55 + 0.05, 5.6, z + 0.05, 'paintedBlue');
    for (const y of [1.6, 3.2, 4.8]) L.box(rx - 0.62, y - 0.07, -12.05, rx + 0.62, y, 6.05, 'paintedYellow', { climbable: true });
    // goods
    for (let z = -11.4; z <= 5.5; z += 1.25) {
      const h = (Math.abs(Math.sin(z * 3.1 + rx)) * 0.5 + 0.5);
      if (Math.sin(z * 7 + rx) > -0.5) L.box(rx - 0.5, 0, z - 0.5, rx + 0.5, Math.min(1.5, h * 1.4), z + 0.5, 'crate');
      if (Math.cos(z * 5 + rx) > -0.2) L.box(rx - 0.5, 1.6, z - 0.5, rx + 0.5, 1.6 + h * 1.1, z + 0.5, Math.sin(z) > 0 ? 'crate' : 'crateMetal');
      if (Math.sin(z * 2 + rx * 3) > 0) L.box(rx - 0.5, 3.2, z - 0.5, rx + 0.5, 3.2 + h, z + 0.5, 'crate');
    }
  }
  // containers
  L.box(6, 0, -14, 12, 2.6, -11.6, 'paintedRed');
  L.box(6, 0, -10.5, 12, 2.6, -8.1, 'paintedBlue');
  L.box(14, 0, -6, 16.4, 2.6, 0, 'paintedYellow');
  L.box(6.3, 2.6, -13.8, 12.3, 5.2, -11.4, 'paintedBlue', { climbable: true });
  for (let x = 6.2; x < 12; x += 0.3) { L.box(x, 0.05, -14.02, x + 0.12, 2.55, -13.98, 'black', { noCollide: true }); }
  // loading dock
  L.box(-24, 0, 12, 24, 1.2, 18, 'concrete');
  L.box(-24, 1.2, 12, 24, 1.22, 12.4, 'hazard', { noCollide: true, uvScale: 1 });
  L.stairs(0, 7.9, 0, 1, 3, 5, 0.24, 0.82, 'concrete');
  L.stairs(18, 7.9, 0, 1, 3, 5, 0.24, 0.82, 'concrete');
  for (const x of [-14, -4, 8]) L.box(x - 2, 1.2, 17.4, x + 2, 5.4, 17.75, 'metal', { noCollide: true });
  L.prop('pallet', -10, 1.27, 14); L.prop('crate', -12, 1.51, 15); L.prop('crate', -12.7, 1.51, 15.3); L.prop('barrel', 4, 1.65, 15);
  // forklift
  L.box(-1, 0, -3, 0.4, 1.2, -1, 'paintedYellow'); L.box(-0.9, 1.2, -2.2, 0.3, 2.2, -1.1, 'black', { noCollide: true });
  L.box(-0.9, 0, -3.35, 0.3, 2.8, -3.05, 'metal'); L.box(-0.8, 0.08, -4.4, 0.2, 0.14, -3.35, 'metal');
  // office
  L.wallX(-11, 16, 23.5, 3, 0.2, 'paintedWhite', [[17.5, 1.0, 2.15], [21, 3, 2.2]]);
  L.box(19.5, 0, -11.1, 22.5, 1.0, -10.9, 'paintedWhite'); L.glass(19.5, 1.0, -11.03, 22.5, 2.2, -10.97);
  L.wallZ(16, -17.5, -11.1, 3, 0.2, 'paintedWhite', [[-14.25, 3, 2.2]]);
  L.box(15.9, 0, -15.75, 16.1, 1.0, -12.75, 'paintedWhite'); L.glass(15.97, 1.0, -15.75, 16.03, 2.2, -12.75);
  L.box(16, 3, -17.5, 23.5, 3.2, -11, 'concreteDark');
  L.door(17, -11, 1.0, 0);
  L.prop('table', 20, 0.39, -15); L.prop('chair', 20, 0.45, -13.8); L.prop('bottle', 19.6, 0.92, -15.1);
  L.light(20, 2.95, -14, 0xfff4e0, 0.5, 8, 'panel');
  // props
  for (const [x, z] of [[2, -6], [3, 2], [-7, 9], [10, 5], [-20, 0]]) { L.prop('pallet', x, 0.07, z); L.prop('crate', x, 0.45, z); }
  L.prop('explosiveBarrel', 13, 0.45, 3); L.prop('explosiveBarrel', 13.6, 0.45, 3.7); L.prop('explosiveBarrel', -20, 0.45, -15);
  L.prop('barrel', 5, 0.45, -3); L.prop('barrel', -21, 0.45, 10); L.prop('metalCrate', 8, 0.31, 0); L.prop('cinderBlock', 0, 0.11, 6);
  L.prop('smallCrate', 2.8, 0.21, -5.6); L.prop('ammoBox', 0, 0.1, -16); L.prop('medkit', 22, 1.27, 14);
  // weapon table
  L.box(-2.5, 0, 9.6, 2.5, 0.9, 10.5, 'woodDark');
  ['rifle', 'pistol', 'machete', 'sledgehammer'].forEach((id, i) => L.weapon(id, -1.8 + i * 1.2, 1.04, 10.05, PI));
  for (const [x, z] of [[-10, -6], [10, -6], [-10, 8], [10, 8]]) L.light(x, 8.6, z, 0xffd9a0, 1.5, 26, 'lamp');
  for (const x of [-16, -10, -4]) L.fixture(x, 8.95, -3, 'lightPanel', 0.4, 6);
  L.playerSpawn = { pos: new THREE.Vector3(0, 0, 5), yaw: 0 };
  for (const [x, z] of [[-20, -15], [0, -15], [20, -5], [-20, 8], [-13, -14], [5, -16], [-7, 0]]) L.spawn(x, z);
}

export const MAPS = {
  training: { name: 'Training Facility', desc: 'Firing range, armory, dummies and climbing tower.', build: training },
  industrial: { name: 'Industrial Facility', desc: 'Machinery hall with catwalks, tanks and a control room.', build: industrial },
  abandoned: { name: 'Abandoned Building', desc: 'Dark corridors, doors, rubble and flickering lights.', build: abandoned },
  arena: { name: 'Underground Arena', desc: 'Sand pit with pillars, four gates and a crowd ring.', build: arena },
  warehouse: { name: 'Warehouse', desc: 'Tall racks, containers, loading dock and an office.', build: warehouse },
};

export function buildMap(id) {
  const def = MAPS[id];
  const L = new Level(id, def.name);
  def.build(L);
  L.finish();
  return L;
}
