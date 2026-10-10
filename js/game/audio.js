/**
 * Synthesized sound effects and music (Web Audio). No audio files needed.
 */
(function () {
  const Audio = {
    ctx: null,
    master: null, sfxBus: null, musicBus: null,
    noiseBuf: null,
    last: {},
    music: null,
    volumes: { master: 0.8, music: 0.5, sfx: 0.8 },

    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.setVolumes(this.volumes);
      if (this.wantMusic != null) this.startMusic(this.wantMusic);
    },

    setVolumes(v) {
      Object.assign(this.volumes, v);
      if (!this.ctx) return;
      this.master.gain.value = this.volumes.master;
      this.sfxBus.gain.value = this.volumes.sfx * 0.9;
      this.musicBus.gain.value = this.volumes.music * 0.45;
    },

    tone(type, f0, f1, dur, vol, when = 0, bus = this.sfxBus) {
      const ctx = this.ctx, t = ctx.currentTime + when;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus);
      o.start(t); o.stop(t + dur + 0.02);
    },

    noise(dur, vol, filter, f0, f1, when = 0, bus = this.sfxBus) {
      const ctx = this.ctx, t = ctx.currentTime + when;
      const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = this.noiseBuf;
      flt.type = filter; flt.frequency.setValueAtTime(f0, t);
      if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt).connect(g).connect(bus);
      src.start(t, Math.random() * 0.5); src.stop(t + dur);
    },

    sfx(name, variant = 0) {
      if (!this.ctx || this.ctx.state !== 'running') return;
      // Avoid stacking the same sound dozens of times in one frame.
      const now = this.ctx.currentTime, gap = { shot: 0.045, hit: 0.03, eshot: 0.08, kill: 0.04 }[name] || 0.02;
      if (now - (this.last[name] || 0) < gap) return;
      this.last[name] = now;
      const v = Math.max(0, variant | 0);
      switch (name) {
        case 'shot': this.tone('square', 920 + v * 90, 420, 0.07, 0.05); this.noise(0.04, 0.05, 'highpass', 3000); break;
        case 'hit': this.tone('sine', 300, 140, 0.06, 0.12); this.noise(0.05, 0.08, 'bandpass', 2000); break;
        case 'kill': this.noise(0.22, 0.22, 'lowpass', 2400, 200); this.tone('triangle', 330, 70, 0.2, 0.15); break;
        case 'hurt': this.tone('sawtooth', 220, 70, 0.25, 0.2); this.noise(0.15, 0.15, 'lowpass', 1200); break;
        case 'down': this.tone('triangle', 440, 110, 0.6, 0.2); this.tone('triangle', 330, 82, 0.6, 0.15, 0.1); break;
        case 'revive': [392, 523, 659, 784].forEach((f, i) => this.tone('triangle', f, f, 0.18, 0.13, i * 0.07)); break;
        case 'dash': this.noise(0.18, 0.18, 'bandpass', 600, 3000); break;
        case 'pickup': [660, 880, 1320].forEach((f, i) => this.tone('sine', f, f, 0.12, 0.14, i * 0.05)); break;
        case 'eshot': this.tone('triangle', 520, 260, 0.12, 0.06); break;
        case 'bossshot': this.tone('sawtooth', 160, 60, 0.4, 0.12); this.noise(0.3, 0.1, 'lowpass', 800, 100); break;
        case 'charge': this.tone('sawtooth', 90, 180, 0.4, 0.13); break;
        case 'wave': [523, 659, 784].forEach((f, i) => this.tone('square', f, f, 0.16, 0.07, i * 0.09)); break;
        case 'boss': this.tone('sawtooth', 55, 40, 1.6, 0.25); this.noise(1.2, 0.2, 'lowpass', 400, 60); break;
        case 'bossdie': this.noise(1.4, 0.35, 'lowpass', 3000, 60); this.tone('triangle', 200, 30, 1.2, 0.25); break;
        case 'cleared': [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.25, 0.1, i * 0.08)); break;
        case 'upgrade': [880, 1175, 1568].forEach((f, i) => this.tone('sine', f, f, 0.2, 0.1, i * 0.06)); break;
        case 'over': [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.4, 0.15, i * 0.22)); break;
        case 'click': this.tone('square', 1400, 1400, 0.03, 0.04); break;
        case 'hover': this.tone('sine', 1800, 1800, 0.02, 0.02); break;
      }
    },

    // ----------------------------------------------------------------- music
    // A small step sequencer: bass, arpeggio and (in game) drums, in A minor.
    startMusic(intense) {
      if (!this.ctx) { this.wantMusic = intense; return; }
      if (this.music) { this.music.intense = intense; return; }
      const bpm = 108, step = 60 / bpm / 4;
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
      const m = (this.music = { intense, n: 0, next: this.ctx.currentTime + 0.1 });
      const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
      m.timer = setInterval(() => {
        const ctx = this.ctx;
        while (m.next < ctx.currentTime + 0.2) {
          const bar = Math.floor(m.n / 16) % 4, s = m.n % 16, ch = chords[bar];
          const when = m.next - ctx.currentTime;
          if (s % 4 === 0) this.tone('sawtooth', midi(ch[0] - 24), midi(ch[0] - 24), step * 3.5, 0.09, when, this.musicBus);
          const arp = [0, 1, 2, 1, 0, 2, 1, 2][s % 8];
          if (s % 2 === 0 || m.intense) this.tone('triangle', midi(ch[arp] + 12), midi(ch[arp] + 12), step * 1.6, m.intense ? 0.05 : 0.04, when, this.musicBus);
          if (m.intense) {
            if (s % 4 === 0) this.tone('sine', 140, 40, 0.15, 0.25, when, this.musicBus);
            if (s % 8 === 4) this.noise(0.12, 0.09, 'bandpass', 1800, 900, when, this.musicBus);
            if (s % 2 === 1) this.noise(0.03, 0.03, 'highpass', 7000, 0, when, this.musicBus);
          }
          m.next += step;
          m.n++;
        }
      }, 50);
    },

    stopMusic() {
      if (!this.music) return;
      clearInterval(this.music.timer);
      this.music = null;
    },
  };

  window.EmberAudio = Audio;
})();
