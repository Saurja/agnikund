'use strict';
/* =========================================================
   Synthesised audio: tanpura drone (Karplus-Strong),
   bansuri phrases, dhol rhythms and sound effects.
   ========================================================= */

/*
 * Recorded sound effects (audio/sfx, all CC0 — see audio/CREDITS.txt).
 * f: clip variants (one is picked at random) · vol: loudness · pitch: random playback-rate range
 * verb: send to the reverb · gap: minimum seconds between two plays of this sound
 * If a clip cannot be decoded (e.g. Ogg on an old Safari), the synthesised version in play() is used.
 */
const SFX = {
  // work and village life
  chop: { f: ['chop1.ogg', 'chop2.ogg', 'chop3.ogg'], vol: 0.55, pitch: [0.9, 1.1], gap: 0.06 },
  mine: { f: ['mine1.ogg', 'mine2.ogg', 'mine3.ogg'], vol: 0.6, gap: 0.06 },
  hammer: { f: ['hammer1.ogg', 'hammer2.ogg', 'hammer3.ogg'], vol: 0.5, gap: 0.08 },
  treefall: { f: ['treefall.ogg'], vol: 0.8, pitch: [0.85, 1] },
  place: { f: ['place.ogg'], vol: 0.7 },
  built: { f: ['built.ogg'], vol: 0.45, verb: true, gap: 0.3 },
  crash: { f: ['crash1.ogg', 'crash2.ogg'], vol: 0.8, gap: 0.2 },
  demolish: { f: ['demolish.ogg'], vol: 0.7 },
  anvil: { f: ['anvil.ogg'], vol: 0.6, verb: true },
  coin: { f: ['coin1.ogg', 'coin2.ogg'], vol: 0.45, gap: 0.05 },
  bell: { f: ['bell.ogg'], vol: 0.55, verb: true },
  bellSoft: { f: ['built.ogg'], vol: 0.22, pitch: [1.15, 1.3], verb: true, gap: 0.5 },
  drop_wood: { f: ['drop_wood1.ogg', 'drop_wood2.ogg'], vol: 0.5, gap: 0.1 },
  drop_stone: { f: ['drop_stone1.ogg', 'drop_stone2.ogg'], vol: 0.55, gap: 0.1 },
  drop_food: { f: ['drop_food1.ogg', 'drop_food2.ogg'], vol: 0.5, pitch: [0.7, 0.85], gap: 0.1 },
  drop_gold: { f: ['drop_gold.ogg'], vol: 0.45, gap: 0.1 },
  drop_clay: { f: ['drop_food1.ogg', 'drop_food2.ogg'], vol: 0.45, pitch: [0.55, 0.65], gap: 0.1 }, // a wet slap
  drop_ore: { f: ['drop_stone1.ogg', 'drop_stone2.ogg'], vol: 0.55, pitch: [0.8, 0.9], gap: 0.1 },
  drop_brick: { f: ['drop_stone1.ogg', 'drop_stone2.ogg'], vol: 0.5, pitch: [1.15, 1.3], gap: 0.1 },
  drop_charcoal: { f: ['drop_wood1.ogg', 'drop_wood2.ogg'], vol: 0.35, pitch: [1.3, 1.5], gap: 0.1 },
  drop_iron: { f: ['anvil.ogg'], vol: 0.25, pitch: [1.5, 1.7], gap: 0.15 },
  heal: { f: ['aleya_twinkle2.ogg', 'aleya_twinkle1.ogg'], vol: 0.16, pitch: [1.3, 1.55], verb: true, gap: 1.2 },
  // combat
  sword: { f: ['blade1.ogg', 'blade2.ogg', 'blade3.ogg'], vol: 0.42, gap: 0.05 },
  bow: { f: ['bow1.wav', 'bow2.wav'], vol: 0.4, pitch: [1.05, 1.25], gap: 0.05 },
  thunk: { f: ['arrow_hit1.ogg', 'arrow_hit2.ogg'], vol: 0.45, gap: 0.05 },
  warcry: { f: ['warcry1.ogg', 'warcry2.ogg'], vol: 0.35, gap: 1.2 },
  cannon: { f: ['explosion.ogg'], vol: 0.85, pitch: [0.72, 0.82], verb: true },
  boom: { f: ['explosion.ogg'], vol: 0.55, pitch: [1, 1.15], gap: 0.1 },
  a_club: { f: ['swing.wav', 'demon_attack1.ogg', 'demon_attack2.ogg'], vol: 0.42, pitch: [0.8, 1], gap: 0.15 },
  demonHurt: { f: ['demon_hurt1.ogg', 'demon_hurt2.ogg'], vol: 0.3, gap: 0.3 },
  demonDie: { f: ['demon_die1.ogg', 'demon_die2.ogg', 'demon_die3.ogg'], vol: 0.5, gap: 0.05 },
  d_giant: { f: ['giant_die.ogg'], vol: 0.8, pitch: [0.75, 0.9], verb: true },
  d_ghost: { f: ['ghost_vanish.ogg'], vol: 0.45, pitch: [0.8, 1.1], verb: true, gap: 0.1 },
  d_aleya: { f: ['aleya_pop.ogg'], vol: 0.4, pitch: [1, 1.35], verb: true, gap: 0.05 },
  stomp: { f: ['stomp.ogg'], vol: 0.55, pitch: [0.8, 1], gap: 0.12 },
  // each demon's voice
  v_bhoot: { f: ['bhoot_moan1.mp3', 'bhoot_moan2.mp3'], vol: 0.35, pitch: [0.9, 1.2], verb: true, gap: 1.6 },
  v_rakshasa: { f: ['rakshasa_grunt1.ogg', 'rakshasa_grunt2.ogg', 'rakshasa_grunt3.ogg'], vol: 0.5, gap: 0.9 },
  v_vetala: { f: ['vetala_screech1.ogg', 'vetala_screech2.ogg', 'vetala_screech3.ogg'], vol: 0.3, pitch: [0.95, 1.2], gap: 0.8 },
  v_danav: { f: ['danav_roar1.ogg', 'danav_roar2.ogg', 'danav_roar3.ogg'], vol: 0.65, pitch: [0.75, 0.9], verb: true, gap: 1.5 },
  v_boss: { f: ['boss_roar1.ogg', 'boss_roar2.ogg'], vol: 0.9, pitch: [0.6, 0.7], verb: true, gap: 2 },
  v_aleya: { f: ['aleya_twinkle1.ogg', 'aleya_twinkle2.ogg', 'aleya_twinkle3.ogg'], vol: 0.3, pitch: [1, 1.4], verb: true, gap: 0.5 },
  v_shakchunni: { f: ['shakchunni_shriek1.ogg', 'shakchunni_shriek2.ogg'], vol: 0.28, pitch: [0.78, 0.92], verb: true, gap: 2.5 },
  bangles: { f: ['bangles1.ogg', 'bangles2.ogg', 'bangles3.ogg'], vol: 0.28, pitch: [1.1, 1.4], gap: 0.4 },
  v_mechho: { f: ['mechho_slurp1.ogg', 'mechho_slurp2.ogg', 'mechho_slurp3.ogg'], vol: 0.45, gap: 0.8 },
  splash: { f: ['splash1.ogg', 'splash2.ogg', 'splash3.ogg'], vol: 0.5, gap: 0.2 },
  v_nishi: { f: ['nishi_whisper.ogg'], vol: 0.6, pitch: [0.8, 0.9], verb: true, gap: 2 },
  v_skondhokata: { f: ['headless_moan1.ogg', 'headless_moan2.ogg', 'headless_moan3.ogg'], vol: 0.5, pitch: [0.7, 0.85], verb: true, gap: 1.5 },
  v_mamdo: { f: ['bhoot_moan1.mp3', 'bhoot_moan2.mp3'], vol: 0.45, pitch: [0.55, 0.65], verb: true, gap: 2.5 },
  // animals and the world
  moo: { f: ['moo1.wav', 'moo2.wav'], vol: 0.4, pitch: [0.92, 1.05], gap: 14 },
  peacock: { f: ['peacock1.wav', 'peacock2.wav', 'peacock.ogg'], vol: 0.32, verb: true, gap: 3 },
  bird: { f: ['bird1.wav', 'bird2.wav', 'sparrow1.wav', 'sparrow2.wav'], vol: 0.16, pitch: [0.92, 1.12], gap: 1.5 },
  owl: { f: ['owl.wav', 'owl_hoot1.wav'], vol: 0.24, verb: true, gap: 6 },
  frog: { f: ['frog.wav', 'frogs1.wav', 'frogs2.wav'], vol: 0.15, pitch: [0.9, 1.08], gap: 3 },
  // a Bengal village: recorded birds and animals (audio/CREDITS.txt)
  koel: { f: ['koel1.wav', 'koel2.wav'], vol: 0.26, pitch: [0.97, 1.03], verb: true, gap: 8 },
  myna: { f: ['myna1.wav'], vol: 0.18, pitch: [0.94, 1.08], gap: 4 },
  crow: { f: ['crow1.wav', 'crow2.wav'], vol: 0.2, pitch: [0.95, 1.05], gap: 4 },
  parakeet: { f: ['parakeet1.wav', 'parakeet2.wav'], vol: 0.15, pitch: [0.96, 1.06], gap: 5 },
  dove: { f: ['dove1.wav', 'dove2.wav'], vol: 0.22, gap: 8 },
  rooster: { f: ['rooster1.wav'], vol: 0.26, pitch: [0.95, 1.05], verb: true, gap: 4 },
  goat: { f: ['goat1.wav', 'goat2.wav', 'goat3.wav'], vol: 0.24, pitch: [0.9, 1.15], gap: 10 },
  dog: { f: ['dog1.wav', 'dog2.wav'], vol: 0.26, pitch: [0.95, 1.05], verb: true, gap: 6 },
  jackal: { f: ['jackal1.wav', 'jackal2.wav'], vol: 0.32, verb: true, gap: 20 },
  cricket: { f: ['cricket.wav'], vol: 0.1, pitch: [0.95, 1.1], gap: 0.8 },
  thunder: { f: ['thunder.ogg'], vol: 0.75, pitch: [0.75, 1], verb: true, gap: 4 },
};
/** Looping ambience: each loop's loudness follows Sound.amb (set every frame from the game). */
const AMB_LOOPS = { fire: 'loop_fire.ogg', night: 'loop_crickets.mp3', rain: 'loop_rain.ogg' };
const AMB_VOL = { fire: 0.5, night: 0.3, rain: 0.45 };
/** What each demon sounds like: its voice, the sound of its attack, its death and whether it stomps. */
const ENEMY_SFX = {
  bhoot: { voice: 'v_bhoot', die: 'd_ghost' },
  rakshasa: { voice: 'v_rakshasa', attack: 'a_club', die: 'demonDie' },
  vetala: { voice: 'v_vetala', attack: 'v_vetala', die: 'demonDie' },
  danav: { voice: 'v_danav', attack: 'a_club', die: 'd_giant', stomp: true },
  boss: { voice: 'v_boss', attack: 'a_club', die: 'bossDie', stomp: true },
  bakasura: { voice: 'v_boss', attack: 'a_club', die: 'bossDie', stomp: true },
  raktabija: { voice: 'v_danav', attack: 'a_club', die: 'bossDie', stomp: true },
  kalanemi: { voice: 'v_skondhokata', attack: 'a_club', die: 'bossDie' },
  rakta: { voice: 'v_rakshasa', attack: 'a_club', die: 'demonDie' },
  aleya: { voice: 'v_aleya', die: 'd_aleya' },
  shakchunni: { voice: 'v_shakchunni', attack: 'bangles', die: 'd_ghost', step: 'bangles' },
  mechho: { voice: 'v_mechho', die: 'splash' },
  nishi: { voice: 'v_nishi', die: 'd_ghost' },
  mamdo: { voice: 'v_mamdo', attack: 'a_club', die: 'd_ghost' },
  skondhokata: { voice: 'v_skondhokata', attack: 'a_club', die: 'd_giant', stomp: true },
  shiyal: { voice: 'v_vetala', die: 'd_ghost' },
  naag: { voice: 'v_nishi', die: 'd_ghost' },
  bagh: { voice: 'v_rakshasa', die: 'd_ghost' },
  shuar: { voice: 'v_danav', attack: 'a_club', die: 'demonDie', stomp: true },
};

const Sound = {
  buffers: {}, loops: {}, amb: { fire: 0, night: 0, day: 0, rain: 0, dawn: 0, foes: 0 },
  ctx: null, master: null, sfxBus: null, musicBus: null, verb: null,
  muted: false, musicOn: true, noise: null, tanpura: [], last: {},
  mode: 'day', threat: 0, nextTan: 0, tanStep: 0, nextFlute: 0, nextDrum: 0, drumStep: 0,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended' && !this.hidden) this.ctx.resume(); return; }
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
    this.loadSamples();
    setInterval(() => this.schedule(), 60);
    this.hidden = document.hidden;
    document.addEventListener('visibilitychange', () => this.onVisibility(document.hidden));
    window.addEventListener('pagehide', () => this.onVisibility(true));
    window.addEventListener('pageshow', () => this.onVisibility(document.hidden));
  },

  /* ---------- recorded effects ---------- */
  loadSamples() {
    const files = new Set(Object.values(AMB_LOOPS));
    for (const k in SFX) for (const f of SFX[k].f) files.add(f);
    for (const f of files) {
      fetch('audio/sfx/' + f)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
        .then((buf) => { this.buffers[f] = buf; })
        .catch(() => { /* not playable here: the synthesised sound stands in */ });
    }
  },
  /** Play a recorded effect; returns false when none is loaded so the synth can stand in. */
  playSample(name, vol, pan) {
    const def = SFX[name];
    if (!def) return false;
    let n = 0, pick = null;
    for (const f of def.f) { const b = this.buffers[f]; if (b && Math.random() * ++n < 1) pick = b; } // random loaded variant
    if (!pick) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = pick;
    const p = def.pitch || [0.94, 1.06];
    src.playbackRate.value = p[0] + Math.random() * (p[1] - p[0]);
    src.connect(this.out(pan, (def.vol || 0.5) * vol, def.verb));
    src.start();
    return true;
  },
  /** Ambience: fire crackle near the Agnikund, crickets at night, rain; plus birds, owls, frogs and thunder now and then. */
  updateAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;
    const on = !this.muted, now = ctx.currentTime;
    for (const k in AMB_LOOPS) {
      const buf = this.buffers[AMB_LOOPS[k]];
      if (!buf) continue;
      const target = on ? clamp(this.amb[k] || 0, 0, 1) * AMB_VOL[k] : 0;
      let L = this.loops[k];
      if (!L && target > 0.005) {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(g); g.connect(this.sfxBus);
        src.start(0, Math.random() * buf.duration);
        L = this.loops[k] = { src, g };
      }
      if (L) {
        L.g.gain.setTargetAtTime(target, now, 0.6);
        if (target <= 0.001 && L.g.gain.value < 0.004) { try { L.src.stop(); } catch (e) { /* already stopped */ } this.loops[k] = null; }
      }
    }
    if (!on) return;
    const one = (name, every, chance) => {
      const key = 'next_' + name;
      if (now < (this[key] || 0)) return;
      this[key] = now + every[0] + Math.random() * (every[1] - every[0]);
      if (Math.random() < chance) this.playSample(name, 1, (Math.random() - 0.5) * 1.4);
    };
    // a Bengal village: songbirds, the koel, mynas and crows by day, parakeets and doves, goats; dogs and
    // jackals out in the dark; a rooster at first light. Sounds that have no clip simply stay silent.
    const day = this.amb.day, night = this.amb.night;
    if (day > 0.3) {
      one('bird', [3, 8], day);
      one('koel', [16, 38], 0.8 * day);
      one('myna', [9, 20], 0.7 * day);
      one('crow', [11, 28], 0.6 * day);
      one('parakeet', [15, 34], 0.55 * day);
      one('dove', [20, 42], 0.65 * day);
      one('goat', [28, 65], 0.5 * day);
      one('peacock', [45, 95], 0.45 * day); // the peafowl's "may-awe" from the edge of the forest
    }
    if (this.amb.dawn > 0.5) one('rooster', [5, 12], 0.9);
    if (night > 0.4) {
      one('owl', [16, 32], 0.8); one('frog', [7, 15], this.amb.rain > 0.5 ? 0.95 : 0.7); one('cricket', [2, 5], 0.6);
      one('dog', [18, 45], this.amb.foes ? 0.8 : 0.45); // village dogs bark at what moves in the dark
      one('jackal', [40, 85], 0.6);
    }
    if (this.amb.rain > 0.5) one('thunder', [16, 38], 0.85);
  },

  /* ---------- recorded music (audio/ folder, see audio/CREDITS.txt) ---------- */
  // three moods: day (sitar), night while the village waits (dark tabla), and battle once the ghosts appear
  tracks: null, trackOK: false, trackVol: 0.5, TRACK_VOL: { day: 0.5, night: 0.42, battle: 0.55 },
  initTracks() {
    const ctx = this.ctx;
    const mk = (src, mode) => {
      const a = new Audio(src);
      a.loop = true; a.preload = mode === 'day' ? 'auto' : 'metadata';
      a._v = 0; a._tries = 0;
      // Fade through a gain node: iPhone browsers ignore element.volume, which left a track playing for good.
      // (Same-origin files only: a cross-origin source without CORS would come out silent.)
      try {
        if (new URL(a.src, location.href).origin !== location.origin) throw new Error('cross-origin');
        const node = ctx.createMediaElementSource(a);
        a._g = ctx.createGain(); a._g.gain.value = 0;
        node.connect(a._g); a._g.connect(ctx.destination);
      } catch (e) { a._g = null; a.volume = 0; }
      a.addEventListener('canplay', () => { a._ok = true; a._tries = 0; });
      a.addEventListener('error', () => {
        // A dropped connection or a decode hiccup: reload after a pause. Only a track that never loads at all
        // hands its mood to the synthesised music.
        a._tries++;
        if (!a._ok && a._tries > 3) { a._failed = true; return; }
        a._broken = true;
        setTimeout(() => { a._broken = false; try { a.load(); } catch (err) { /* retried on the next error */ } }, 3000 * a._tries);
      });
      return a;
    };
    const ogg = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="vorbis"'); } catch (e) { return false; } })();
    this.trackOK = true;
    this.tracks = {
      day: mk('audio/day_mystical_sitar.mp3', 'day'),
      night: mk('audio/night_calm_tabla.mp3', 'night'),
      battle: mk(ogg ? 'audio/night_battle_ritual.ogg' : 'audio/night_india_rythm.mp3', 'battle'), // older Safari cannot play Ogg
    };
    setInterval(() => { this.updateTracks(); this.updateAmbience(); }, 100);
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
      const target = on && !this.hidden && this.mode === k ? this.TRACK_VOL[k] : 0;
      const step = k === 'battle' && target > a._v ? 0.06 : 0.025; // the battle music cuts in fast, everything else crossfades over ~2 s
      a._v = clamp(a._v + clamp(target - a._v, -step, step), 0, 1); // our own copy: element.volume may not read back what we set
      if (a._g) a._g.gain.setTargetAtTime(a._v, this.ctx.currentTime, 0.03); else a.volume = a._v;
      if (target > 0 && a.paused && !a._pending && !a._broken) {
        a._pending = true;
        a.play().catch(() => { /* blocked or interrupted — retried on the next tick */ }).finally(() => { a._pending = false; });
      }
      if (target === 0 && a._v <= 0.001 && !a.paused) a.pause();
    }
  },
  /** Leaving the tab or app silences everything at once (the game itself stops while hidden). */
  onVisibility(hidden) {
    this.hidden = hidden;
    if (!this.ctx) return;
    if (hidden) {
      for (const k in this.tracks || {}) {
        const a = this.tracks[k];
        a._v = 0;
        if (a._g) a._g.gain.value = 0; else a.volume = 0;
        if (!a.paused) a.pause();
      }
      this.ctx.suspend().catch(() => {});
    } else this.ctx.resume().catch(() => {});
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
    const minGap = (SFX[name] && SFX[name].gap) || { chop: 0.06, mine: 0.06, hammer: 0.08, sword: 0.05, bow: 0.05, hurt: 0.08, thud: 0.08, coin: 0.05, thunk: 0.05, demonDie: 0.05, firehit: 0.15, whoosh: 0.2, harvest: 0.1 }[name] || 0;
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
    if (this.playSample(name, vol, pan)) return; // a recorded clip if we have one, otherwise the synth below
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
      const g = ctx.createGain(); g.gain.value = step === 3 ? 0.5 : 0.36;
      src.connect(g); g.connect(this.musicBus); g.connect(this.verb);
      src.start(this.nextTan);
      this.nextTan += step === 3 ? 1.5 : 0.75;
      this.tanStep++;
      if (this.tanStep % 12 === 0) this.nextTan += 8 + Math.random() * 6; // let it breathe: three rounds, then silence
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
