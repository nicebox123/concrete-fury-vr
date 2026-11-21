// Procedural textures + shared material library. All textures are generated on
// canvases at startup (no downloads) and kept small for Quest memory budgets.
import * as THREE from 'three';

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

// Smooth value noise by upscaling random low-res canvases (fast)
function noiseLayer(ctx, size, cells, alpha, r, light = 255) {
  const c = canvas(cells), x = c.getContext('2d');
  const img = x.createImageData(cells, cells);
  for (let i = 0; i < cells * cells; i++) {
    const v = r() * light;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  // draw tiled 3x3 so edges wrap
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) ctx.drawImage(c, a * size, b * size, size, size);
  ctx.globalAlpha = 1;
}

function speckle(ctx, size, n, r, color, maxR = 1.5) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) { ctx.globalAlpha = r() * 0.5; ctx.fillRect(r() * size, r() * size, r() * maxR + 0.5, r() * maxR + 0.5); }
  ctx.globalAlpha = 1;
}

function makeTex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function tint(ctx, size, color, mode = 'multiply') {
  ctx.globalCompositeOperation = mode; ctx.fillStyle = color; ctx.fillRect(0, 0, size, size); ctx.globalCompositeOperation = 'source-over';
}

const gen = {
  concrete(seed = 1, base = '#8a8782', panels = true) {
    const S = 512, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    noiseLayer(x, S, 6, 0.2, r); noiseLayer(x, S, 32, 0.12, r); noiseLayer(x, S, 160, 0.14, r);
    x.globalCompositeOperation = 'source-over';
    speckle(x, S, 1800, r, '#333', 1.3); speckle(x, S, 900, r, '#ccc', 1.0);
    // water stains running down
    for (let i = 0; i < 8; i++) {
      const sx = r() * S, w = 8 + r() * 30;
      const g = x.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(40,35,30,0.0)'); g.addColorStop(r(), 'rgba(40,35,30,0.18)'); g.addColorStop(1, 'rgba(40,35,30,0.0)');
      x.fillStyle = g; x.fillRect(sx, 0, w, S);
    }
    if (panels) {
      // board-formed panel seams and form-tie holes (brutalist)
      x.strokeStyle = 'rgba(30,30,30,0.45)'; x.lineWidth = 3;
      x.strokeRect(1.5, 1.5, S - 3, S - 3);
      x.strokeStyle = 'rgba(255,255,255,0.08)'; x.lineWidth = 1;
      x.strokeRect(4, 4, S - 8, S - 8);
      for (const px of [S * 0.18, S * 0.82]) for (const py of [S * 0.18, S * 0.5, S * 0.82]) {
        const g = x.createRadialGradient(px, py, 1, px, py, 9);
        g.addColorStop(0, 'rgba(15,15,15,0.9)'); g.addColorStop(1, 'rgba(15,15,15,0)');
        x.fillStyle = g; x.beginPath(); x.arc(px, py, 9, 0, 7); x.fill();
      }
    }
    return makeTex(c);
  },
  floor(seed = 2, base = '#6e6c68') {
    const S = 512, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    noiseLayer(x, S, 5, 0.22, r); noiseLayer(x, S, 48, 0.1, r); noiseLayer(x, S, 192, 0.14, r);
    x.globalCompositeOperation = 'source-over';
    speckle(x, S, 2200, r, '#2a2a2a', 1.2);
    // expansion joints + cracks
    x.strokeStyle = 'rgba(20,20,20,0.6)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, 1); x.lineTo(S, 1); x.moveTo(1, 0); x.lineTo(1, S); x.stroke();
    x.strokeStyle = 'rgba(25,25,25,0.4)'; x.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let px = r() * S, py = r() * S; x.beginPath(); x.moveTo(px, py);
      for (let j = 0; j < 8; j++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); }
      x.stroke();
    }
    // oil stains
    for (let i = 0; i < 4; i++) {
      const px = r() * S, py = r() * S, rr = 20 + r() * 50;
      const g = x.createRadialGradient(px, py, 2, px, py, rr);
      g.addColorStop(0, 'rgba(20,18,15,0.35)'); g.addColorStop(1, 'rgba(20,18,15,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rr, 0, 7); x.fill();
    }
    return makeTex(c);
  },
  metal(seed = 3, base = '#5d636a', tread = false) {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    noiseLayer(x, S, 16, 0.3, r); noiseLayer(x, S, 128, 0.2, r);
    x.globalCompositeOperation = 'source-over';
    // brushed streaks
    for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.05})`; x.fillRect(0, r() * S, S, 1); }
    if (tread) {
      for (let yy = 0; yy < S; yy += 32) for (let xx = 0; xx < S; xx += 32) {
        x.save(); x.translate(xx + 16 + ((yy / 32) % 2) * 16, yy + 16); x.rotate(((xx + yy) / 32) % 2 ? 0.8 : -0.8);
        x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(-9, -2, 18, 4);
        x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(-9, 2, 18, 1.5); x.restore();
      }
    } else {
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2; x.strokeRect(1, 1, S - 2, S - 2);
      x.fillStyle = 'rgba(0,0,0,0.4)';
      for (const p of [[10, 10], [S - 10, 10], [10, S - 10], [S - 10, S - 10]]) { x.beginPath(); x.arc(p[0], p[1], 3, 0, 7); x.fill(); }
    }
    return makeTex(c);
  },
  rust(seed = 4, base = '#6b4a35') {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    noiseLayer(x, S, 8, 0.35, r); noiseLayer(x, S, 64, 0.25, r);
    x.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 60; i++) {
      const px = r() * S, py = r() * S, rr = 4 + r() * 22;
      const g = x.createRadialGradient(px, py, 1, px, py, rr);
      g.addColorStop(0, `rgba(${120 + r() * 60},${50 + r() * 30},20,0.5)`); g.addColorStop(1, 'rgba(100,50,20,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rr, 0, 7); x.fill();
    }
    speckle(x, S, 1500, r, '#2a1a10', 2);
    return makeTex(c);
  },
  painted(seed = 5, base = '#3f5b5a', grime = 0.4) {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay';
    noiseLayer(x, S, 8, 0.25, r); noiseLayer(x, S, 64, 0.15, r);
    x.globalCompositeOperation = 'source-over';
    // chipped paint
    for (let i = 0; i < 40 * grime; i++) {
      x.fillStyle = `rgba(120,115,105,${0.4 + r() * 0.4})`;
      x.beginPath(); const px = r() * S, py = r() * S; x.moveTo(px, py);
      for (let j = 0; j < 6; j++) x.lineTo(px + (r() - 0.5) * 14, py + (r() - 0.5) * 14);
      x.fill();
    }
    const g = x.createLinearGradient(0, S * 0.6, 0, S); g.addColorStop(0, 'rgba(30,25,20,0)'); g.addColorStop(1, `rgba(30,25,20,${grime * 0.7})`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return makeTex(c);
  },
  wood(seed = 6, base = '#8a6a45', planks = 4) {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = base; x.fillRect(0, 0, S, S);
    const ph = S / planks;
    for (let p = 0; p < planks; p++) {
      x.fillStyle = `rgba(${r() * 40},${r() * 25},0,${0.15 + r() * 0.2})`; x.fillRect(0, p * ph, S, ph);
      for (let i = 0; i < 26; i++) {
        x.strokeStyle = `rgba(50,30,15,${0.1 + r() * 0.25})`; x.lineWidth = 0.5 + r() * 1.5;
        const yy = p * ph + r() * ph; x.beginPath(); x.moveTo(0, yy);
        for (let xx = 0; xx <= S; xx += 16) x.lineTo(xx, yy + Math.sin(xx * 0.03 + i) * 2 * r());
        x.stroke();
      }
      x.fillStyle = 'rgba(25,15,5,0.7)'; x.fillRect(0, p * ph, S, 2);
      x.fillStyle = 'rgba(30,20,10,0.8)';
      for (const nx of [10, S - 12]) { x.beginPath(); x.arc(nx, p * ph + ph / 2, 2, 0, 7); x.fill(); }
    }
    return makeTex(c);
  },
  tiles(seed = 7, base = '#b9b6ad', grout = '#4d4a45', n = 8) {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = grout; x.fillRect(0, 0, S, S);
    const ts = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 0.85 + r() * 0.15;
      x.fillStyle = base; x.globalAlpha = v; x.fillRect(i * ts + 1.5, j * ts + 1.5, ts - 3, ts - 3); x.globalAlpha = 1;
      if (r() < 0.08) { x.fillStyle = 'rgba(40,35,30,0.5)'; x.fillRect(i * ts + 2, j * ts + 2, ts - 4, ts - 4); }
    }
    x.globalCompositeOperation = 'multiply'; noiseLayer(x, S, 8, 0.25, r); x.globalCompositeOperation = 'source-over';
    return makeTex(c);
  },
  hazard() {
    const S = 128, c = canvas(S), x = c.getContext('2d');
    x.fillStyle = '#d9a91c'; x.fillRect(0, 0, S, S);
    x.fillStyle = '#1b1b1b';
    for (let i = -2; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64 + 32, 0); x.lineTo(i * 64 + 32 + S, S); x.lineTo(i * 64 + S, S); x.fill(); }
    x.globalCompositeOperation = 'multiply'; noiseLayer(x, S, 16, 0.3, rng(9)); x.globalCompositeOperation = 'source-over';
    return makeTex(c);
  },
  sand(seed = 8) {
    const S = 256, c = canvas(S), x = c.getContext('2d'), r = rng(seed);
    x.fillStyle = '#8c7a5e'; x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = 'overlay'; noiseLayer(x, S, 6, 0.22, r); noiseLayer(x, S, 64, 0.16, r); x.globalCompositeOperation = 'source-over';
    speckle(x, S, 4000, r, '#3a3025', 1); speckle(x, S, 2000, r, '#d8c8a8', 1);
    return makeTex(c);
  },
  grate() {
    const S = 128, c = canvas(S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    x.fillStyle = '#4a4e52';
    for (let i = 0; i < S; i += 16) { x.fillRect(i, 0, 4, S); x.fillRect(0, i, S, 3); }
    const t = makeTex(c); return t;
  },
  // Gun/weapon textures (small)
  gunmetal() { return gen.metal(11, '#2b2e31'); },
  polymer() {
    const S = 128, c = canvas(S), x = c.getContext('2d'), r = rng(12);
    x.fillStyle = '#1d1f20'; x.fillRect(0, 0, S, S);
    speckle(x, S, 2500, r, '#3a3d40', 1);
    return makeTex(c);
  },
  gripWood() { return gen.wood(13, '#5a3a22', 1); },
  sign(text, sub = '', w = 512, h = 256, bg = '#1c1f22', fg = '#e8e4dc', accent = '#e2502c') {
    const c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.fillStyle = accent; x.fillRect(0, 0, w, 10);
    x.fillStyle = fg; x.font = `900 ${Math.floor(h * 0.24)}px system-ui,sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h * 0.42);
    if (sub) { x.font = `600 ${Math.floor(h * 0.1)}px system-ui,sans-serif`; x.fillStyle = '#a8a49c'; wrapText(x, sub, w / 2, h * 0.68, w * 0.9, h * 0.12); }
    return makeTex(c, false);
  },
};

export function wrapText(x, text, cx, cy, maxW, lineH) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (x.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  const y0 = cy - (lines.length - 1) * lineH / 2;
  lines.forEach((l, i) => x.fillText(l, cx, y0 + i * lineH));
}

export const Tex = gen;

// ---- Material library ----
export const Mat = {};
export function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  Mat.concrete = std({ map: gen.concrete(1, '#8f8b84'), roughness: 0.92, metalness: 0 });
  Mat.concreteDark = std({ map: gen.concrete(21, '#5f5d59'), roughness: 0.95, metalness: 0 });
  Mat.concretePlain = std({ map: gen.concrete(31, '#7d7a75', false), roughness: 0.95, metalness: 0 });
  Mat.floor = std({ map: gen.floor(2), roughness: 0.85, metalness: 0 });
  Mat.floorDark = std({ map: gen.floor(22, '#4b4a47'), roughness: 0.9, metalness: 0 });
  Mat.metal = std({ map: gen.metal(3), roughness: 0.55, metalness: 0.6 });
  Mat.tread = std({ map: gen.metal(33, '#5a5f63', true), roughness: 0.5, metalness: 0.7 });
  Mat.rust = std({ map: gen.rust(4), roughness: 0.85, metalness: 0.3 });
  Mat.painted = std({ map: gen.painted(5), roughness: 0.8, metalness: 0.05 });
  Mat.paintedRed = std({ map: gen.painted(15, '#7a2b22', 0.5), roughness: 0.75, metalness: 0.1 });
  Mat.paintedYellow = std({ map: gen.painted(25, '#b88a1d', 0.5), roughness: 0.7, metalness: 0.1 });
  Mat.paintedBlue = std({ map: gen.painted(35, '#2c4560', 0.4), roughness: 0.75, metalness: 0.1 });
  Mat.paintedWhite = std({ map: gen.painted(45, '#c9c6bd', 0.25), roughness: 0.8, metalness: 0 });
  Mat.wood = std({ map: gen.wood(6), roughness: 0.85, metalness: 0 });
  Mat.woodDark = std({ map: gen.wood(16, '#5a4128'), roughness: 0.85, metalness: 0 });
  Mat.tiles = std({ map: gen.tiles(7), roughness: 0.4, metalness: 0 });
  Mat.tilesDirty = std({ map: gen.tiles(17, '#8d8a7e', '#3a3732', 6), roughness: 0.6, metalness: 0 });
  Mat.hazard = std({ map: gen.hazard(), roughness: 0.7, metalness: 0.1 });
  Mat.sand = std({ map: gen.sand(), roughness: 1, metalness: 0 });
  Mat.grate = std({ map: gen.grate(), roughness: 0.6, metalness: 0.7, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide });
  Mat.glass = new THREE.MeshStandardMaterial({ color: 0x9fc4cf, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25, depthWrite: false });
  Mat.black = std({ color: 0x111213, roughness: 0.8 });
  Mat.rubber = std({ color: 0x1a1a1a, roughness: 0.95 });
  Mat.lightPanel = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
  Mat.lightWarm = new THREE.MeshBasicMaterial({ color: 0xffc27a });
  Mat.lightCold = new THREE.MeshBasicMaterial({ color: 0xcfe6ff });
  Mat.lightRed = new THREE.MeshBasicMaterial({ color: 0xff3a22 });
  Mat.crate = std({ map: gen.wood(26, '#9a7a4e', 3), roughness: 0.85 });
  Mat.crateMetal = std({ map: gen.metal(36, '#3e5345'), roughness: 0.6, metalness: 0.5 });
  Mat.barrel = std({ map: gen.metal(46, '#2f4a6a'), roughness: 0.55, metalness: 0.5 });
  Mat.barrelRed = std({ map: gen.metal(56, '#a3241b'), roughness: 0.5, metalness: 0.4 });
  // weapons
  Mat.gunmetal = std({ map: gen.gunmetal(), roughness: 0.35, metalness: 0.85, color: 0xb0b0b0 });
  Mat.steel = std({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.95 });
  Mat.blade = std({ color: 0xd8dde2, roughness: 0.18, metalness: 1.0 });
  Mat.polymer = std({ map: gen.polymer(), roughness: 0.7, metalness: 0.05 });
  Mat.gripWood = std({ map: gen.gripWood(), roughness: 0.6, metalness: 0 });
  Mat.brass = std({ color: 0xc9a046, roughness: 0.3, metalness: 1 });
  Mat.shell = std({ color: 0xa8241c, roughness: 0.5, metalness: 0.1 });
  Mat.tape = std({ color: 0x2b2b2b, roughness: 0.9 });
  Mat.batWood = std({ map: gen.wood(66, '#b58d5c', 1), roughness: 0.55 });
  Mat.skinGlove = std({ color: 0x2a2724, roughness: 0.8 });
  Mat.gloveCuff = std({ color: 0x3d4a3a, roughness: 0.85 });
  return Mat;
}

// Per-material properties for gameplay (sound + effects)
export const SurfaceFX = {
  concrete: { sound: 'concrete', dust: 0x8a8580, spark: false },
  metal: { sound: 'metal', dust: 0x555555, spark: true },
  rust: { sound: 'metal', dust: 0x6b4a35, spark: true },
  wood: { sound: 'wood', dust: 0x8a6a45, spark: false },
  glass: { sound: 'glass', dust: 0xaaccdd, spark: false },
  sand: { sound: 'concrete', dust: 0x9c8a6a, spark: false },
  tiles: { sound: 'concrete', dust: 0xb0aca4, spark: false },
  flesh: { sound: 'flesh', dust: 0x7a0a0a, spark: false },
};
