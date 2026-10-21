import { clamp, rand, choose } from '../core/utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.volume = 0.7;
    this.muted = false;
    this.started = false;
    this.musicTimer = null;
    this.padNodes = [];
    this.lastHit = 0;
    this.lastSwing = 0;
    this.step = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.36;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.74;
    this.sfxGain.connect(this.master);
    this.noiseBuffer = this._makeNoise(2.0);
    this.started = true;
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  _env(duration, gain, attack = 0.005) {
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    return g;
  }

  tone(freq, duration, type = 'sine', gain = 0.12, slide = 0, when = 0, dest = null) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(dest || this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  noise(duration, gain = 0.2, filterFreq = 1200, when = 0, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.3), now + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  click() { this.tone(720, 0.04, 'square', 0.035, 380); }

  swing(fighter, combo = 1) {
    if (!this.ctx || this.ctx.currentTime - this.lastSwing < 0.035) return;
    this.lastSwing = this.ctx.currentTime;
    this.noise(0.09 + combo * 0.015, 0.045, 2400 + combo * 500, 0, 'highpass');
    this.tone(180 + combo * 40, 0.07, 'triangle', 0.04, 100);
  }

  hit(fighter, dmg = 10) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.03) return;
    this.lastHit = now;
    const heavy = dmg > 55;
    this.tone(heavy ? 72 : 110, heavy ? 0.2 : 0.1, 'sine', heavy ? 0.4 : 0.22, 38);
    this.noise(heavy ? 0.2 : 0.08, heavy ? 0.3 : 0.14, heavy ? 900 : 1800, 0, 'lowpass');
    if (heavy) this.tone(260, 0.13, 'square', 0.08, 80);
  }

  cast(fighter) {
    this.tone(280, 0.35, 'sawtooth', 0.06, 880);
    this.noise(0.3, 0.06, 600, 0, 'bandpass');
    this.tone(700, 0.25, 'sine', 0.07, 1600);
  }

  explosion(heavy = false) {
    this.noise(heavy ? 0.8 : 0.35, heavy ? 0.48 : 0.25, heavy ? 500 : 900, 0, 'lowpass');
    this.tone(heavy ? 48 : 80, heavy ? 0.7 : 0.3, 'sine', heavy ? 0.5 : 0.24, 22);
    if (heavy) this.tone(110, 0.5, 'triangle', 0.1, 30);
  }

  jump(fighter) { this.tone(255, 0.11, 'triangle', 0.045, 480); }
  land(fighter) { this.noise(0.12, 0.08, 500, 0, 'lowpass'); this.tone(80, 0.1, 'sine', 0.1, 40); }
  dodge(fighter) { this.noise(0.2, 0.09, 2200, 0, 'highpass'); this.tone(480, 0.16, 'sine', 0.05, 1100); }
  shard() { this.tone(1400, 0.22, 'sine', 0.06, 2100); this.tone(2100, 0.2, 'triangle', 0.03, 2800); }
  shardGain() { this.tone(880, 0.12, 'sine', 0.05, 1320); }
  beam() { this.tone(1100, 0.22, 'sawtooth', 0.08, 240); this.noise(0.15, 0.07, 3000, 0, 'highpass'); }
  teleport() { this.tone(420, 0.2, 'sine', 0.08, 1700); this.noise(0.2, 0.08, 2200, 0, 'bandpass'); }
  freeze() {
    this.tone(1200, 0.8, 'sine', 0.1, 90);
    this.tone(600, 0.7, 'triangle', 0.07, 40);
    this.noise(0.5, 0.09, 3000, 0, 'highpass');
  }
  unfreeze() {
    this.noise(0.35, 0.25, 4000, 0, 'highpass');
    this.tone(60, 0.6, 'sine', 0.45, 25);
  }
  death() {
    this.tone(180, 0.5, 'sawtooth', 0.12, 45);
    this.noise(0.45, 0.15, 600, 0, 'lowpass');
  }
  ko() {
    this.tone(440, 0.22, 'square', 0.08, 220);
    this.tone(330, 0.3, 'square', 0.07, 165, 0.16);
    this.tone(220, 0.55, 'square', 0.07, 110, 0.32);
  }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.1, f, i * 0.13));
  }
  tick() { this.tone(1200, 0.03, 'square', 0.02); }

  startMusic() {
    this.init();
    if (!this.ctx || this.musicTimer) return;
    const now = this.ctx.currentTime;
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.035;
    padGain.connect(this.musicGain);
    const freqs = [55, 82.41, 110, 164.81];
    this.padNodes = [];
    for (const [i, f] of freqs.entries()) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      const g = this.ctx.createGain();
      g.gain.value = 0.22 / (i + 1);
      osc.type = i % 2 ? 'sawtooth' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = i * 3 - 4;
      osc.connect(filter); filter.connect(g); g.connect(padGain);
      osc.start(now);
      this.padNodes.push({ osc, filter, g });
    }
    // LFO 缓慢扫动滤波器
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    this.padNodes.forEach((p) => lfoGain.connect(p.filter.frequency));
    lfo.start(now);
    this.padNodes.push({ osc: lfo, filter: null, g: null });

    const scale = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
      this.step++;
      if (this.step % 2 === 0) {
        this.tone(55, 0.3, 'sine', 0.18, 48, 0, this.musicGain);
      }
      if (this.step % 4 === 0) {
        this.noise(0.05, 0.04, 6000, 0, 'highpass');
      }
      if (Math.random() > 0.4) {
        const f = choose(scale) * (Math.random() > 0.72 ? 2 : 1);
        this.tone(f, 0.22, 'triangle', 0.028, f * 0.995, 0, this.musicGain);
      }
      if (this.step % 8 === 0) {
        this.tone(110, 0.6, 'sawtooth', 0.018, 108, 0, this.musicGain);
      }
    }, 290);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    for (const node of this.padNodes) {
      try { node.osc.stop(); } catch (e) { /* noop */ }
    }
    this.padNodes = [];
  }

  setMusicIntensity(v) {
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(0.2 + v * 0.2, this.ctx.currentTime, 0.5);
  }
}
