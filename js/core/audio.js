// Procedural positional audio. Every sound is synthesized with WebAudio, so the
// game ships with no audio files. Voices are capped to keep CPU usage low.
import * as THREE from 'three';
import { Settings } from './settings.js';
import { G, rand } from './context.js';

const MAX_VOICES = 28;

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.voices = 0;
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this.reverbAmount = 0.25;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = Settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = this.reverbAmount;
    this.reverb.connect(this.reverbGain); this.reverbGain.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    Settings.onChange((k) => { if (k === 'volume' || k === '*') this.master.gain.value = Settings.volume; });
  }

  setReverb(amount, seconds = 1.6) {
    this.reverbAmount = amount;
    if (!this.ctx) return;
    this.reverb.buffer = this._impulse(seconds, 2.4);
    this.reverbGain.gain.value = amount;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    camera.getWorldPosition(this._pos);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(this._pos.x, t, 0.01); L.positionY.setTargetAtTime(this._pos.y, t, 0.01); L.positionZ.setTargetAtTime(this._pos.z, t, 0.01);
      L.forwardX.value = this._fwd.x; L.forwardY.value = this._fwd.y; L.forwardZ.value = this._fwd.z;
      L.upX.value = this._up.x; L.upY.value = this._up.y; L.upZ.value = this._up.z;
    } else {
      L.setPosition(this._pos.x, this._pos.y, this._pos.z);
      L.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }

  // Creates the output chain for a voice: gain -> panner -> master (+reverb)
  _out(pos, vol, dur, reverb = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    let node = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = Settings.perfMode ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.2; p.rolloffFactor = 1.1; p.maxDistance = 60;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p);
      node = p;
    }
    node.connect(this.master);
    if (reverb > 0) {
      const s = ctx.createGain(); s.gain.value = reverb;
      node.connect(s); s.connect(this.reverb);
    }
    this.voices++;
    setTimeout(() => { this.voices--; try { g.disconnect(); node.disconnect(); } catch (e) { } }, (dur + 0.3) * 1000);
    return g;
  }

  _noise(out, t, dur, type, freq, q, a, peak, decay, freqEnd) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5, dur + 0.1);
  }

  _tone(out, t, type, f0, f1, a, peak, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + a + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + a + decay + 0.05);
  }

  play(name, pos = null, vol = 1, opt = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const important = opt.important || name.startsWith('gun') || name === 'explosion';
    if (this.voices >= MAX_VOICES && !important) return;
    if (this.voices >= MAX_VOICES + 8) return;
    const fn = this['s_' + name];
    if (!fn) return;
    fn.call(this, pos, vol, opt, this.ctx.currentTime);
  }

  // ---- Weapons ----
  s_gunPistol(pos, vol) { this._gun(pos, vol, 1.0, 0.18, 1600, 140); }
  s_gunRevolver(pos, vol) { this._gun(pos, vol * 1.25, 0.8, 0.28, 1200, 95); }
  s_gunShotgun(pos, vol) { this._gun(pos, vol * 1.4, 0.6, 0.38, 900, 70); }
  s_gunRifle(pos, vol) { this._gun(pos, vol * 1.05, 1.2, 0.16, 2200, 120); }
  s_gunEnemy(pos, vol) { this._gun(pos, vol * 0.8, 1.1, 0.16, 1700, 130); }
  _gun(pos, vol, rate, decay, filt, thump) {
    const t = this.ctx.currentTime, out = this._out(pos, vol, 1.2, 1.4);
    this._noise(out, t, 0.02, 'highpass', 2500, 0.7, 0.001, 0.9, 0.03);
    this._noise(out, t, decay + 0.2, 'lowpass', filt * rate, 0.8, 0.002, 1.0, decay, 300);
    this._tone(out, t, 'sine', thump * 1.8, thump * 0.5, 0.002, 0.9, decay * 0.8);
    this._noise(out, t + 0.03, 0.6, 'bandpass', 500, 0.5, 0.05, 0.12, 0.5);
  }
  s_dryFire(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.5, 0.2, 0.2); this._noise(o, t, 0.03, 'bandpass', 3500, 4, 0.001, 0.8, 0.03); }
  s_magOut(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.6, 0.3, 0.2); this._noise(o, t, 0.05, 'bandpass', 1800, 3, 0.001, 0.7, 0.05); this._tone(o, t, 'square', 600, 300, 0.001, 0.1, 0.05); }
  s_magIn(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.7, 0.3, 0.2); this._noise(o, t, 0.04, 'bandpass', 2400, 3, 0.001, 0.9, 0.04); this._noise(o, t + 0.05, 0.04, 'bandpass', 3200, 4, 0.001, 0.6, 0.03); }
  s_rack(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.7, 0.4, 0.2); this._noise(o, t, 0.06, 'bandpass', 1500, 2, 0.002, 0.8, 0.06); this._noise(o, t + 0.12, 0.05, 'bandpass', 2800, 3, 0.001, 1, 0.05); }
  s_pump(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.8, 0.5, 0.2); this._noise(o, t, 0.08, 'bandpass', 900, 2, 0.004, 0.8, 0.08, 1600); this._noise(o, t + 0.16, 0.06, 'bandpass', 1400, 2, 0.002, 0.9, 0.07); }
  s_shellIn(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.6, 0.2, 0.2); this._noise(o, t, 0.04, 'bandpass', 1200, 3, 0.002, 0.8, 0.05); }
  s_cylinder(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.6, 0.3, 0.2); for (let i = 0; i < 3; i++) this._noise(o, t + i * 0.035, 0.02, 'bandpass', 3000, 5, 0.001, 0.6, 0.02); }
  s_casing(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.25, 0.3, 0.3); this._tone(o, t, 'sine', rand(3800, 5200), 0, 0.001, 0.5, 0.12); this._tone(o, t, 'sine', rand(6500, 7500), 0, 0.001, 0.2, 0.06); }
  s_whoosh(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.5, 0.4, 0.1); this._noise(o, t, 0.25, 'bandpass', 500, 1.2, 0.05, 0.8, 0.18, 1800); }
  s_ricochet(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.35, 0.5, 0.5); this._tone(o, t, 'sine', rand(2200, 3200), rand(900, 1400), 0.002, 0.3, 0.3); }

  // ---- Impacts ----
  s_flesh(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.5, 0.3);
    this._noise(o, t, 0.12, 'lowpass', 900, 1, 0.002, 1.0, 0.1, 200);
    this._tone(o, t, 'sine', 120, 50, 0.002, 0.7, 0.12);
  }
  s_splat(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.6, 0.3);
    this._noise(o, t, 0.18, 'lowpass', 1400, 2, 0.003, 1.0, 0.16, 250);
    this._noise(o, t + 0.04, 0.12, 'bandpass', 700, 3, 0.003, 0.6, 0.1);
    this._tone(o, t, 'sine', 90, 40, 0.002, 0.6, 0.15);
  }
  s_bone(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.4, 0.3);
    this._noise(o, t, 0.04, 'highpass', 2000, 1, 0.001, 1.0, 0.04);
    this._noise(o, t + 0.01, 0.06, 'bandpass', 1100, 4, 0.001, 0.8, 0.06);
  }
  s_slash(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.4, 0.2);
    this._noise(o, t, 0.12, 'highpass', 1800, 1, 0.002, 0.9, 0.1, 5000);
    this._noise(o, t, 0.1, 'lowpass', 800, 1, 0.002, 0.6, 0.08);
  }
  s_blunt(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.5, 0.4);
    this._tone(o, t, 'sine', 140, 45, 0.001, 1, 0.16);
    this._noise(o, t, 0.08, 'lowpass', 1200, 1, 0.001, 0.8, 0.07);
  }
  s_metal(pos, vol, opt) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 0.7, 1.2, 0.5);
    const base = opt.pitch || rand(380, 620);
    const ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach((r, i) => this._tone(o, t, 'sine', base * r, 0, 0.001, 0.4 / (i + 1), 0.5 + 0.4 / (i + 1)));
    this._noise(o, t, 0.03, 'highpass', 3000, 1, 0.001, 0.6, 0.03);
  }
  s_clang(pos, vol) { this.s_metal(pos, vol * 1.3, { pitch: rand(700, 950) }); }
  s_wood(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 0.8, 0.4, 0.3);
    this._noise(o, t, 0.08, 'bandpass', rand(500, 800), 3, 0.001, 1, 0.08);
    this._tone(o, t, 'triangle', rand(180, 260), 120, 0.001, 0.5, 0.08);
  }
  s_woodBreak(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 0.8, 0.4);
    for (let i = 0; i < 5; i++) this._noise(o, t + i * rand(0.01, 0.04), 0.08, 'bandpass', rand(400, 1400), 3, 0.001, 0.8, 0.09);
    this._tone(o, t, 'sine', 110, 50, 0.001, 0.6, 0.2);
  }
  s_concrete(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 0.8, 0.4, 0.3);
    this._noise(o, t, 0.08, 'lowpass', 2200, 1, 0.001, 0.9, 0.06);
    this._noise(o, t + 0.01, 0.15, 'highpass', 3000, 0.7, 0.01, 0.15, 0.12);
  }
  s_glass(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol, 1.2, 0.5);
    this._noise(o, t, 0.25, 'highpass', 3500, 1, 0.001, 1, 0.25);
    for (let i = 0; i < 9; i++) this._tone(o, t + rand(0, 0.25), 'sine', rand(2500, 7000), 0, 0.001, 0.15, rand(0.05, 0.25));
  }
  s_thud(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 0.7, 0.4, 0.3);
    this._tone(o, t, 'sine', 90, 40, 0.002, 0.8, 0.12);
    this._noise(o, t, 0.06, 'lowpass', 600, 1, 0.002, 0.5, 0.06);
  }
  s_step(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 0.25, 0.2, 0.2);
    this._noise(o, t, 0.06, 'lowpass', rand(500, 900), 1, 0.004, 0.8, 0.05);
  }
  s_explosion(pos, vol) {
    const t = this.ctx.currentTime, o = this._out(pos, vol * 1.6, 3, 1.6);
    this._noise(o, t, 2.2, 'lowpass', 1800, 0.7, 0.005, 1.0, 1.8, 80);
    this._tone(o, t, 'sine', 70, 25, 0.005, 1.0, 1.2);
    this._noise(o, t, 0.08, 'highpass', 1500, 0.7, 0.001, 0.8, 0.08);
  }
  s_hurt() { // player hurt (non-positional)
    const t = this.ctx.currentTime, o = this._out(null, 0.5, 0.4, 0);
    this._tone(o, t, 'sine', 70, 40, 0.005, 0.8, 0.25);
    this._noise(o, t, 0.15, 'lowpass', 400, 1, 0.005, 0.5, 0.15);
  }
  s_ui(pos, vol, opt) { const t = this.ctx.currentTime, o = this._out(null, 0.25 * vol, 0.15, 0); this._tone(o, t, 'sine', opt.hover ? 1400 : 900, 0, 0.001, 0.4, 0.06); }
  s_pickup(pos, vol) { const t = this.ctx.currentTime, o = this._out(pos, vol * 0.4, 0.2, 0.1); this._noise(o, t, 0.04, 'bandpass', 1200, 2, 0.001, 0.6, 0.04); }
  s_wave() { const t = this.ctx.currentTime, o = this._out(null, 0.5, 1.5, 0.5); [220, 277, 330].forEach((f, i) => this._tone(o, t + i * 0.12, 'sawtooth', f, 0, 0.01, 0.15, 0.6)); }
  s_heal() { const t = this.ctx.currentTime, o = this._out(null, 0.4, 0.8, 0.2); [523, 659, 784].forEach((f, i) => this._tone(o, t + i * 0.07, 'sine', f, 0, 0.01, 0.25, 0.3)); }

  // ---- Voices ---- (formant-filtered sawtooth "grunts")
  s_voice(pos, vol, opt) {
    const ctx = this.ctx, t = ctx.currentTime;
    const kind = opt.kind || 'grunt';
    const pitch = (opt.pitch || 110) * rand(0.92, 1.08);
    const dur = kind === 'death' ? rand(0.5, 0.8) : kind === 'pain' ? rand(0.2, 0.35) : kind === 'attack' ? 0.3 : 0.25;
    const out = this._out(pos, vol * 0.55, dur + 0.2, 0.6);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const p0 = kind === 'pain' ? pitch * 1.5 : pitch;
    o.frequency.setValueAtTime(p0, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'death' ? pitch * 0.55 : pitch * 0.8, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = rand(5, 9);
    const vg = ctx.createGain(); vg.gain.value = pitch * 0.04;
    vib.connect(vg); vg.connect(o.frequency);
    const formants = opt.formants || (kind === 'pain' ? [800, 1300] : [550, 1000]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.03);
    g.gain.setValueAtTime(1, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of formants) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * rand(0.9, 1.1); bp.Q.value = 6;
      o.connect(bp); bp.connect(g);
    }
    // breath noise
    this._noise(out, t, dur, 'bandpass', 1800, 1, 0.02, 0.15, dur);
    g.connect(out);
    o.start(t); o.stop(t + dur + 0.05); vib.start(t); vib.stop(t + dur + 0.05);
  }
}

export function haptic(hand, intensity = 0.5, ms = 40) {
  try {
    const gp = hand && hand.gamepad;
    const h = gp && gp.hapticActuators && gp.hapticActuators[0];
    if (h && h.pulse) h.pulse(Math.min(1, intensity), ms);
  } catch (e) { /* ignore */ }
}

export function surfaceSound(material) {
  switch (material) {
    case 'metal': case 'rust': case 'grate': return 'metal';
    case 'wood': return 'wood';
    case 'glass': return 'glass';
    default: return 'concrete';
  }
}

export function initAudio() { G.audio = new AudioSystem(); return G.audio; }
