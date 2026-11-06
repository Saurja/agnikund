'use strict';
/* =========================================================
   Synthesised audio: tanpura drone (Karplus-Strong),
   bansuri phrases, dhol rhythms and sound effects.
   ========================================================= */

const Sound = {
  ctx: null, master: null, sfxBus: null, musicBus: null, verb: null,
  muted: false, musicOn: true, noise: null, tanpura: [], last: {},
  mode: 'day', threat: 0, nextTan: 0, tanStep: 0, nextFlute: 0, nextDrum: 0, drumStep: 0,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.65; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicOn ? 0.32 : 0; this.musicBus.connect(this.master);
    // simple reverb
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    this.verb = ctx.createConvolver(); this.verb.buffer = ir;
    const vg = ctx.createGain(); vg.gain.value = 0.35; this.verb.connect(vg); vg.connect(this.master);
    // noise
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    // tanpura strings: Pa, Sa', Sa', Sa
    const SA = 146.83;
    this.tanpura = [SA * 0.75, SA, SA, SA / 2].map((f) => this.pluck(f, 3.6));
    this.nextTan = ctx.currentTime + 0.3;
    this.nextFlute = ctx.currentTime + 4;
    this.nextDrum = ctx.currentTime + 1;
    this.initTracks();
    setInterval(() => this.schedule(), 60);
  },

  /* ---------- recorded music (audio/ folder, see audio/CREDITS.txt) ---------- */
  // three moods: day (sitar), night while the village waits (dark tabla), and battle once the ghosts appear
  tracks: null, trackOK: false, trackVol: 0.5, TRACK_VOL: { day: 0.5, night: 0.42, battle: 0.55 },
  initTracks() {
    const mk = (src, mode) => {
      const a = new Audio(src);
      a.loop = true; a.preload = mode === 'day' ? 'auto' : 'metadata'; a.volume = 0;
      a.addEventListener('error', () => { a._failed = true; }); // only this mood falls back to synthesised music
      return a;
    };
    const ogg = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
    this.trackOK = true;
    this.tracks = {
      day: mk('audio/day_mystical_sitar.mp3', 'day'),
      night: mk('audio/night_calm_tabla.mp3', 'night'),
      battle: mk(ogg ? 'audio/night_battle_ritual.ogg' : 'audio/night_india_rythm.mp3', 'battle'), // older Safari cannot play Ogg
    };
    setInterval(() => this.updateTracks(), 100);
  },
  /** Is a recorded track carrying the current mood? (if not, the synth plays instead) */
  trackFor(mode) { const a = this.tracks && this.tracks[mode]; return !!(a && !a._failed); },
  updateTracks() {
    if (!this.tracks) return;
    const on = this.musicOn && !this.muted;
    if (this.mode === 'battle' && this._lastMode && this._lastMode !== 'battle') this.play('ghosts'); // the warning sting
    if (this.mode === 'battle' && this._lastMode !== 'battle') { const b = this.tracks.battle; if (b && !b._failed && b.paused) try { b.currentTime = 0; } catch (e) { /* not seekable yet */ } }
    this._lastMode = this.mode;
    for (const k of ['day', 'night', 'battle']) {
      const a = this.tracks[k];
      if (a._failed) continue;
      const target = on && this.mode === k ? this.TRACK_VOL[k] : 0;
      const step = k === 'battle' && target > a.volume ? 0.06 : 0.025; // the battle music cuts in fast, everything else crossfades over ~2 s
      a.volume = clamp(a.volume + clamp(target - a.volume, -step, step), 0, 1);
      if (target > 0 && a.paused && !a._pending) {
        a._pending = true;
        a.play().catch(() => { /* blocked or interrupted — retried on the next tick */ }).finally(() => { a._pending = false; });
      }
      if (target === 0 && a.volume <= 0.001 && !a.paused) a.pause();
    }
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); },
  setMusic(on) { this.musicOn = on; if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2); },

  pluck(freq, dur) {
    const ctx = this.ctx, sr = ctx.sampleRate, N = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, N, sr), d = buf.getChannelData(0);
    const P = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(P);
    for (let i = 0; i < P; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0;
    for (let i = 0; i < N; i++) {
      const cur = ring[idx], nxt = ring[(idx + 1) % P];
      ring[idx] = 0.9986 * (cur * 0.72 + nxt * 0.28);
      d[i] = cur;
      idx = (idx + 1) % P;
    }
    // jawari buzz + fades
    for (let i = 0; i < N; i++) {
      const x = d[i];
      const env = Math.min(1, i / (sr * 0.004)) * Math.min(1, (N - i) / (sr * 0.3));
      d[i] = Math.tanh(x * 1.8 + 0.25 * x * Math.abs(x)) * 0.5 * env;
    }
    return buf;
  },

  /* ---------- low level ---------- */
  out(pan, vol, toVerb) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = vol;
    let node = g;
    if (ctx.createStereoPanner && pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(this.sfxBus);
    if (toVerb) node.connect(this.verb);
    return g;
  },
  tone(o) { // {f, f2, type, t, dur, vol, attack, dest, vib}
    const ctx = this.ctx, t = o.t || ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur));
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vibRate || 5; lg.gain.value = o.vib;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.1);
    }
    const g = ctx.createGain();
    const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + a);
    if (o.hold) g.gain.setValueAtTime(o.vol || 0.2, t + a + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.filter) { const f = ctx.createBiquadFilter(); f.type = o.filter; f.frequency.value = o.ff || 1000; f.Q.value = o.q || 1; osc.connect(f); node = f; }
    node.connect(g);
    g.connect(o.dest);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  },
  hiss(o) { // {t, dur, vol, type, f, f2, q, dest}
    const ctx = this.ctx, t = o.t || ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); f.Q.value = o.q || 1;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.dest);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  },
  bellAt(t, f, vol, dest) {
    for (const [m, a, d] of [[1, 1, 1.8], [2.0, 0.5, 1.2], [2.76, 0.35, 0.9], [5.4, 0.15, 0.5]]) this.tone({ f: f * m, t, dur: d, vol: vol * a, attack: 0.003, dest });
  },

  /* ---------- sound effects ---------- */
  play(name, x, z) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const minGap = { chop: 0.06, mine: 0.06, hammer: 0.08, sword: 0.05, bow: 0.05, hurt: 0.08, thud: 0.08, coin: 0.05, thunk: 0.05, demonDie: 0.05, firehit: 0.15, whoosh: 0.2, harvest: 0.1 }[name] || 0;
    if (minGap && this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    let vol = 1, pan = 0;
    if (x != null && typeof R3 !== 'undefined' && R3.ok) {
      const c = R3.cam, dx = x - c.x, dz = (z || 0) - c.z;
      const d = Math.hypot(dx, dz), near = c.dist * 0.6;
      if (d > near + 40) return;
      vol = d < near ? 1 : clamp(1 - (d - near) / 40, 0.06, 1);
      pan = clamp((dx * Math.cos(c.yaw) - dz * Math.sin(c.yaw)) / 16, -1, 1) * 0.6;
    }
    const D = (v, verb) => this.out(pan, v * vol, verb);
    const t = now;
    switch (name) {
      case 'click': this.tone({ f: 880, f2: 660, dur: 0.06, vol: 0.12, dest: D(1) }); break;
      case 'error': this.tone({ f: 160, type: 'square', dur: 0.14, vol: 0.06, dest: D(1) }); break;
      case 'chop': this.hiss({ f: 1400, q: 2, dur: 0.08, vol: 0.25, dest: D(0.6) }); this.tone({ f: 190, f2: 120, type: 'triangle', dur: 0.07, vol: 0.25, dest: D(0.6) }); break;
      case 'mine': this.tone({ f: 1900, f2: 1300, type: 'square', dur: 0.05, vol: 0.05, dest: D(0.6) }); this.hiss({ type: 'highpass', f: 4000, dur: 0.05, vol: 0.15, dest: D(0.6) }); break;
      case 'hammer': this.tone({ f: 620, type: 'triangle', dur: 0.05, vol: 0.18, dest: D(0.5) }); this.hiss({ f: 2600, q: 3, dur: 0.04, vol: 0.1, dest: D(0.5) }); break;
      case 'treefall': this.hiss({ type: 'lowpass', f: 900, f2: 150, dur: 0.7, vol: 0.3, dest: D(0.8) }); this.tone({ f: 90, f2: 50, dur: 0.4, vol: 0.3, t: t + 0.4, dest: D(0.8) }); break;
      case 'harvest': this.hiss({ type: 'highpass', f: 2500, dur: 0.25, vol: 0.12, attack: 0.08, dest: D(0.6) }); break;
      case 'place': this.tone({ f: 130, f2: 70, dur: 0.18, vol: 0.35, dest: D(1) }); this.hiss({ type: 'lowpass', f: 800, dur: 0.2, vol: 0.15, dest: D(1) }); break;
      case 'bell': this.bellAt(t, 880, 0.18, D(1, true)); break;
      case 'bellSoft': this.bellAt(t, 1175, 0.05, D(0.6, true)); break;
      case 'chime': [587, 740, 880, 1175].forEach((f, i) => this.tone({ f, t: t + i * 0.09, dur: 0.6, vol: 0.08, dest: D(1, true) })); break;
      case 'coin': this.tone({ f: 1320, type: 'square', dur: 0.06, vol: 0.04, dest: D(0.8) }); this.tone({ f: 1760, type: 'square', t: t + 0.06, dur: 0.12, vol: 0.04, dest: D(0.8) }); break;
      case 'bow': this.hiss({ f: 3200, f2: 1200, q: 4, dur: 0.14, vol: 0.12, dest: D(0.6) }); this.tone({ f: 300, f2: 180, type: 'triangle', dur: 0.06, vol: 0.08, dest: D(0.6) }); break;
      case 'thunk': this.tone({ f: 320, f2: 200, type: 'triangle', dur: 0.06, vol: 0.12, dest: D(0.5) }); break;
      case 'sword': this.hiss({ type: 'highpass', f: 3000, dur: 0.08, vol: 0.14, dest: D(0.7) }); this.tone({ f: 1500, f2: 800, type: 'sawtooth', dur: 0.07, vol: 0.03, dest: D(0.7) }); break;
      case 'hurt': this.tone({ f: 240, f2: 140, type: 'square', dur: 0.12, vol: 0.05, dest: D(0.8) }); break;
      case 'death': this.tone({ f: 440, f2: 110, dur: 0.9, vol: 0.12, dest: D(1, true) }); this.tone({ f: 660, f2: 220, dur: 0.9, vol: 0.05, dest: D(1, true) }); break;
      case 'demonDie': this.tone({ f: 220, f2: 55, type: 'sawtooth', dur: 0.4, vol: 0.06, filter: 'lowpass', ff: 900, dest: D(0.8) }); this.hiss({ type: 'lowpass', f: 1200, f2: 200, dur: 0.4, vol: 0.12, dest: D(0.8) }); break;
      case 'bossDie': this.tone({ f: 140, f2: 30, type: 'sawtooth', dur: 2.2, vol: 0.14, filter: 'lowpass', ff: 700, dest: D(1, true) }); this.hiss({ type: 'lowpass', f: 900, f2: 100, dur: 2, vol: 0.25, dest: D(1, true) }); setTimeout(() => this.play('victoryShort'), 900); break;
      case 'roar': this.tone({ f: 80, f2: 60, type: 'sawtooth', dur: 1.6, vol: 0.2, attack: 0.15, filter: 'lowpass', ff: 500, vib: 8, vibRate: 11, dest: D(1, true) }); this.hiss({ type: 'lowpass', f: 600, dur: 1.4, vol: 0.2, attack: 0.2, dest: D(1, true) }); break;
      case 'thud': this.tone({ f: 95, f2: 55, dur: 0.2, vol: 0.3, dest: D(0.7) }); this.hiss({ type: 'lowpass', f: 600, dur: 0.12, vol: 0.12, dest: D(0.7) }); break;
      case 'crash': this.hiss({ type: 'lowpass', f: 1800, f2: 150, dur: 0.9, vol: 0.35, dest: D(1) }); this.tone({ f: 70, f2: 40, dur: 0.6, vol: 0.35, dest: D(1) }); break;
      case 'firehit': this.hiss({ f: 600, q: 1, dur: 0.25, vol: 0.18, dest: D(0.8) }); break;
      case 'whoosh': this.hiss({ f: 400, f2: 1400, q: 1.5, dur: 0.35, vol: 0.1, attack: 0.1, dest: D(0.6) }); break;
      case 'upgrade': [294, 370, 440, 587, 740].forEach((f, i) => this.tone({ f, t: t + i * 0.1, dur: 0.8, vol: 0.09, type: 'triangle', dest: D(1, true) })); this.bellAt(t + 0.55, 587, 0.15, D(1, true)); break;
      case 'anvil': this.bellAt(t, 1250, 0.1, D(1, true)); this.bellAt(t + 0.25, 1250, 0.07, D(1, true)); break;
      case 'saw': for (let i = 0; i < 4; i++) this.hiss({ f: 1800 + (i % 2) * 600, q: 3, t: t + i * 0.12, dur: 0.1, vol: 0.12, dest: D(0.8) }); break;
      case 'cannon': this.tone({ f: 70, f2: 35, dur: 0.6, vol: 0.5, dest: D(1, true) }); this.hiss({ type: 'lowpass', f: 1400, f2: 150, dur: 0.7, vol: 0.4, dest: D(1, true) }); break;
      case 'boom': this.tone({ f: 90, f2: 40, dur: 0.4, vol: 0.35, dest: D(0.9) }); this.hiss({ type: 'lowpass', f: 1200, f2: 200, dur: 0.5, vol: 0.3, dest: D(0.9) }); break;
      case 'drum': [0, 0.42, 0.72, 0.94, 1.12, 1.26].forEach((d, i) => this.dhol(t + d, i % 3 === 2 ? 'ta' : 'dha', 0.9, this.out(0, 0.9 * vol, true))); break;
      case 'night': this.tone({ f: 55, dur: 3, vol: 0.18, attack: 0.3, dest: D(1, true) }); this.tone({ f: 82.5, dur: 3, vol: 0.08, attack: 0.5, dest: D(1, true) }); break;
      case 'ghosts': // the first ghosts appear: a deep boom, a dissonant swell and a rattle of drums
        this.tone({ f: 65, f2: 40, dur: 1.6, vol: 0.4, attack: 0.02, dest: D(1, true) });
        this.hiss({ type: 'lowpass', f: 300, f2: 2400, dur: 1.4, vol: 0.12, attack: 0.9, dest: D(1, true) });
        [233, 247, 349].forEach((f) => this.tone({ f, type: 'sawtooth', dur: 1.8, vol: 0.025, attack: 0.8, filter: 'lowpass', ff: 1500, vib: 4, vibRate: 6, dest: D(1, true) }));
        [0, 0.12, 0.22, 0.3, 0.37, 0.43].forEach((d, i) => this.dhol(t + 1.2 + d, i % 2 ? 'ta' : 'dha', 0.8, this.out(0, 0.8, true)));
        break;
      case 'nishi': // a voice calling across the dark: two falling, breathy notes
        [[660, 520, 0], [700, 560, 0.55]].forEach(([f, f2, d]) => { this.tone({ f, f2, t: t + d, dur: 0.5, vol: 0.06, attack: 0.08, vib: 6, vibRate: 5, filter: 'bandpass', ff: 900, q: 2, dest: D(1, true) }); this.hiss({ f: 1200, q: 3, t: t + d, dur: 0.45, vol: 0.03, attack: 0.1, dest: D(1, true) }); });
        break;
      case 'conch': this.conch(t, D(1, true)); break;
      case 'gameover': [392, 349, 311, 262].forEach((f, i) => this.tone({ f, t: t + i * 0.45, dur: 1.4, vol: 0.12, type: 'triangle', dest: D(1, true) })); break;
      case 'victory': case 'victoryShort': [294, 370, 440, 587].forEach((f, i) => this.tone({ f, t: t + i * 0.16, dur: 1, vol: 0.1, type: 'triangle', dest: D(1, true) })); this.bellAt(t + 0.7, 880, 0.15, D(1, true)); break;
    }
  },
  dhol(t, kind, vol, dest) {
    if (kind === 'dha') {
      this.tone({ f: 110, f2: 55, t, dur: 0.35, vol: 0.5 * vol, dest });
      this.hiss({ type: 'lowpass', f: 400, t, dur: 0.08, vol: 0.2 * vol, dest });
    } else if (kind === 'dhin') {
      this.tone({ f: 180, f2: 150, t, dur: 0.25, vol: 0.25 * vol, dest });
    } else {
      this.tone({ f: 520, f2: 480, type: 'triangle', t, dur: 0.12, vol: 0.18 * vol, dest });
      this.hiss({ f: 2500, q: 2, t, dur: 0.05, vol: 0.12 * vol, dest });
    }
  },
  conch(t, dest) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.linearRampToValueAtTime(233, t + 0.5);
    osc.frequency.setValueAtTime(233, t + 2.0);
    osc.frequency.linearRampToValueAtTime(247, t + 2.6);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 2.5; lfo.connect(lg); lg.connect(osc.frequency);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2100; f2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
    g.gain.setValueAtTime(0.5, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    osc.connect(f1); osc.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest);
    osc.start(t); lfo.start(t); osc.stop(t + 3.1); lfo.stop(t + 3.1);
  },

  /* ---------- music ---------- */
  schedule() {
    if (!this.ctx || !this.musicOn || this.muted) return;
    const ctx = this.ctx, now = ctx.currentTime, ahead = now + 0.25;
    const night = this.mode !== 'day';
    if (this.trackFor(this.mode)) { // recorded music carries the mood; add war drums when the threat is high
      this.nextTan = this.nextFlute = now + 0.2;
      if (this.mode === 'battle' && this.threat > 0.55 && this.nextDrum < ahead) {
        const pat = ['dha', 'ta', 'ta', 'dha', null, 'ta', 'dhin', 'ta'];
        const k = pat[this.drumStep % pat.length];
        if (k) this.dhol(Math.max(this.nextDrum, now), k, 0.22 * this.threat, this.musicBus);
        this.nextDrum = Math.max(this.nextDrum, now) + 0.18;
        this.drumStep++;
      } else if (this.nextDrum < now) this.nextDrum = now + 0.2;
      return;
    }
    // tanpura
    while (this.nextTan < ahead) {
      const step = this.tanStep % 4;
      const src = ctx.createBufferSource();
      src.buffer = this.tanpura[step];
      src.playbackRate.value = night ? 0.94387 : 1; // drop a semitone at night
      const g = ctx.createGain(); g.gain.value = step === 3 ? 0.7 : 0.5;
      src.connect(g); g.connect(this.musicBus); g.connect(this.verb);
      src.start(this.nextTan);
      this.nextTan += step === 3 ? 1.5 : 0.75;
      this.tanStep++;
    }
    if (this.nextTan < now) this.nextTan = now + 0.1;
    // bansuri phrases by day, dhol by night
    if (!night && this.nextFlute < ahead) {
      this.flutePhrase(Math.max(this.nextFlute, now + 0.05));
      this.nextFlute = now + 9 + Math.random() * 9;
    }
    if (night && this.nextDrum < ahead) {
      const pat = ['dha', null, 'ta', 'dhin', null, 'ta', 'dha', 'ta'];
      const k = pat[this.drumStep % pat.length];
      if (k) this.dhol(Math.max(this.nextDrum, now), k, 0.35, this.musicBus);
      this.nextDrum = Math.max(this.nextDrum, now) + 0.3;
      this.drumStep++;
    }
  },
  flutePhrase(t) {
    // Raga Bhupali (Sa Re Ga Pa Dha) around Sa = D4
    const scale = [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33];
    let i = 2 + Math.floor(Math.random() * 3);
    const n = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const dur = pick([0.35, 0.5, 0.7, 1.0]) * (k === n - 1 ? 2 : 1);
      this.flute(t, scale[i], dur);
      t += dur * 0.95;
      i = clamp(i + pick([-2, -1, -1, 1, 1, 2]), 0, scale.length - 1);
    }
  },
  flute(t, f, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 0.985, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.008, t + dur * 0.6);
    lfo.connect(lg); lg.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.09);
    g.gain.setValueAtTime(0.14, t + Math.max(0.1, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    const g2 = ctx.createGain(); g2.gain.value = 0.08;
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.musicBus); g.connect(this.verb);
    this.hiss({ f: f * 3, q: 2, t, dur: dur * 0.6, vol: 0.015, attack: 0.05, dest: this.musicBus });
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + dur + 0.2); o2.stop(t + dur + 0.2); lfo.stop(t + dur + 0.2);
  },
};
