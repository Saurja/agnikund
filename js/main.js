'use strict';
/* =========================================================
   App bootstrap: game flow, camera controls, input, loop
   Camera: drag / WASD = move · wheel = zoom ·
           right-drag or Q/E = rotate · pinch on touch
   ========================================================= */

const App = {
  mode: 'title', touch: false, keys: {}, last: 0, pointers: new Map(), drag: null, wallDrag: null, uiScale: 1,

  init() {
    try { this.uiScale = clamp(parseFloat(localStorage.getItem('agnikund_uiscale')) || 1, 0.5, 1.6); } catch (e) { this.uiScale = 1; }
    if (!R3.init($('view'))) {
      $('title').querySelector('.btns').innerHTML = '<p style="max-width:380px">The 3D engine (Three.js) could not be loaded. Please check your internet connection and refresh the page.</p>';
      return;
    }
    // phones start on Low graphics (no shadows) unless the player chose otherwise
    const phone = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches) && Math.min(window.innerWidth, window.innerHeight) < 900;
    let gfx = phone ? 'low' : 'high';
    try { gfx = localStorage.getItem('agnikund_gfx') || gfx; } catch (e) { /* default */ }
    R3.setQuality(gfx);
    UI.init();
    this.wireInput();
    window.addEventListener('resize', () => { R3.resize(); this.fitUI(); });
    window.addEventListener('orientationchange', () => setTimeout(() => { R3.resize(); this.fitUI(); }, 250)); // some phones report the new size late
    this.checkOrientation();
    this.fitUI();
    UI.syncMenu();
    this.showTitle();
    requestAnimationFrame((t) => { this.last = t; this.loop(t); });
  },

  /* ---------- flow ---------- */
  makeDemo() {
    const s = newState();
    s.demo = true;
    s.t = 96;
    s.fire.level = 2;
    genWorld(s);
    S = s;
    const add = (type, cx, cz) => placeDemo(s, type, cx, cz);
    add('hut', -6, 2); add('hut', 3, 4); add('hut', -2, -7); add('hut', 5, -5);
    add('field', 6, 0); add('akhara', -9, -3); add('store', -4, 6); add('lamp', 3, -2); add('range', -3, 8);
    add('well', 8, -4); add('woodcamp', -11, 5); add('minecamp', 8, 7);
    for (let i = -6; i <= 6; i++) { add('palisade', i, -12); add('palisade', i, 11); }
    for (let i = 0; i < 12; i++) s.villagers.push(makeVillager(s, seatPos(i).x, seatPos(i).z));
    const jobs = ['wood', 'wood', 'stone', 'farm', 'farm', 'build', 'warrior', 'warrior', 'archer', 'archer', 'idle', 'idle'];
    s.villagers.forEach((v, i) => setJob(s, v, jobs[i]));
    s.floaters.length = 0;
    s.particles.length = 0;
    R3.buildWorld(s);
    R3.cam.tx = R3.cam.x = 0; R3.cam.tz = R3.cam.z = 1;
  },
  showTitle() {
    this.mode = 'title';
    UI.cancelBuild();
    UI.select(null);
    UI.clearToasts();
    UI.setPaused(false);
    UI.hideTip();
    $('hud').classList.add('hidden');
    $('over').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('title').classList.remove('hidden');
    let saveDay = null;
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d) saveDay = d.day; } catch (e) { /* no save */ }
    $('btnContinue').classList.toggle('hidden', !saveDay);
    $('contDay').textContent = saveDay ? `Day ${saveDay}` : '';
    this.makeDemo();
    R3.cam.tdist = 30;
  },
  startNew() {
    Sound.init();
    UI.clearLog();
    Game.newGame();
    this.enterPlay();
  },
  continueGame() {
    Sound.init();
    if (!Game.load()) { this.startNew(); return; }
    UI.clearLog();
    this.enterPlay();
    toast(`Welcome back, Mukhiya. Day ${S.day} in your village.`, 'good');
  },
  enterPlay() {
    this.mode = 'play';
    R3.buildWorld(S);
    $('title').classList.add('hidden');
    $('over').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('howto').classList.add('hidden');
    $('hud').classList.remove('hidden');
    UI.clearToasts();
    UI.select(null);
    UI.cancelBuild();
    UI.toggleBuildTray(false);
    UI.setRemoveMode(false);
    UI.setSpeed(1);
    UI.prevRes = {};
    Object.assign(R3.cam, { tx: 0, tz: 1, tdist: 22, tyaw: 0.55, tpitch: 0.95 });
    this.perf.t = -3; this.perf.n = 0;
    UI.refresh(true);
  },
  /** Watch the frame rate for a while and suggest Low graphics if this computer struggles. */
  perf: { t: -3, n: 0, warned: false },
  watchPerf(dt) {
    const p = this.perf;
    if (p.warned || R3.quality === 'low' || document.visibilityState !== 'visible' || dt <= 0 || dt > 0.25) return;
    p.t += dt;
    if (p.t < 0) return;
    p.n++;
    if (p.t >= 8) {
      if (p.n / p.t < 28) {
        p.warned = true;
        toast('Running slowly? Press G or open the menu to switch Graphics to Low.', 'tip', 12);
      }
      p.t = 0; p.n = 0;
    }
  },
  lookAt(x, z) { R3.lookAt(x, z == null ? 1 : z); },

  uiScale: 1,
  /** Pick the layout (desktop / phone portrait / phone landscape) and an interface size that stays readable. */
  fitUI() {
    const w = window.innerWidth, h = window.innerHeight;
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const mobile = Math.min(w, h) < 600 || (coarse && w < 900);
    const portrait = h > w;
    const B = document.body.classList;
    B.toggle('touch', coarse);
    B.toggle('mobile', mobile);
    B.toggle('portrait', mobile && portrait);
    B.toggle('landscape', mobile && !portrait);
    // phones get their own compact layout, so the text never has to shrink to unreadable sizes
    const base = mobile ? clamp(Math.min(w, h) / (portrait ? 420 : 440), 0.8, 1) : clamp(Math.min(w / 1500, h / 1000), coarse ? 0.8 : 0.68, 1);
    const f = clamp(base * this.uiScale, 0.45, 1.8);
    this.uiZoom = f;
    $('hud').style.zoom = f;
    document.querySelectorAll('.screen').forEach((el) => { el.style.zoom = mobile ? clamp(f, 0.8, 1.2) : clamp(f * 1.1, 0.6, 1.5); });
    if (mobile !== this._wasMobile) { // entering phone layout: fold the jobs list away to free the screen
      this._wasMobile = mobile;
      UI.setJobsCollapsed(mobile);
    }
    document.querySelectorAll('.uiPct').forEach((el) => { el.textContent = Math.round(this.uiScale * 100) + '%'; });
  },
  setQuality(q) {
    R3.setQuality(q);
    try { localStorage.setItem('agnikund_gfx', R3.quality); } catch (e) { /* not saved */ }
    UI.syncMenu();
    toast({ low: 'Graphics: Low — fastest, no shadows, simpler forest.', mid: 'Graphics: Mid — smooth shading, shadows and grass.', high: 'Graphics: High — adds ambient occlusion, glow and colour grading.' }[R3.quality], 'info', 3);
    sfx('click');
  },
  changeUIScale(d) {
    this.uiScale = clamp(Math.round((this.uiScale + d) * 10) / 10, 0.5, 1.6);
    try { localStorage.setItem('agnikund_uiscale', String(this.uiScale)); } catch (e) { /* not saved */ }
    this.fitUI();
    sfx('click');
  },
  checkOrientation() { /* portrait and landscape are both supported; fitUI picks the layout */ },

  /* ---------- input ---------- */
  wireInput() {
    const cv = $('view');
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'play') return;
      Sound.init();
      this.touch = e.pointerType === 'touch';
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      UI.hideTip();
      if (this.pointers.size === 2) { this.drag = null; this.wallDrag = null; this.pinch = this.pinchState(); return; }
      const mode = e.button === 2 ? 'rotate' : e.button === 1 ? 'pan' : 'click';
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode, moved: false, shift: e.shiftKey, t: performance.now(), vx: 0, vy: 0 };
      R3.fling = null;
      if (mode === 'click' && UI.buildType && BUILDINGS[UI.buildType].wall && !this.touch) {
        const g = R3.groundAt(e.clientX, e.clientY);
        if (g) this.wallDrag = [Math.floor(g.x), Math.floor(g.z)];
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.mode !== 'play') return;
      const pt = this.pointers.get(e.pointerId);
      if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
      if (this.pinch && this.pointers.size === 2) { this.applyPinch(); return; }
      const d = this.drag;
      if (d && d.id === e.pointerId) {
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 6) d.moved = true;
        d.x = e.clientX; d.y = e.clientY;
        if (this.wallDrag) {
          const g = R3.groundAt(e.clientX, e.clientY);
          if (g) UI.dragWall(this.wallDrag, g.x, g.z);
          return;
        }
        if (d.moved) {
          if (d.mode === 'rotate') R3.rotateBy(-dx * 0.006, dy * 0.004);
          else {
            R3.panBy(dx, dy);
            const now = performance.now(), el = Math.max(1, now - d.t) / 1000;
            d.vx = d.vx * 0.6 + (dx / el) * 0.4; d.vy = d.vy * 0.6 + (dy / el) * 0.4; // smoothed drag speed for the glide
            d.t = now;
          }
          UI.hideTip();
          return;
        }
      }
      if (UI.buildType && e.pointerType !== 'touch') {
        const g = R3.groundAt(e.clientX, e.clientY);
        if (g) UI.moveGhost(g.x, g.z);
        UI.hideTip();
      } else if (!d && e.pointerType !== 'touch') {
        const hit = R3.pick(e.clientX, e.clientY);
        cv.style.cursor = hit ? 'pointer' : 'grab';
        UI.canvasTip(hit, e.clientX, e.clientY);
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (this.wallDrag) {
        const a = this.wallDrag;
        this.wallDrag = null;
        const g = R3.groundAt(e.clientX, e.clientY);
        if (g) {
          if (d.moved) UI.dragWall(a, g.x, g.z); else UI.moveGhost(g.x, g.z);
          UI.confirmPlace(true);
          UI.moveGhost(g.x, g.z);
        }
        return;
      }
      if (d.moved && d.mode !== 'rotate' && performance.now() - d.t < 90) R3.fling = { x: clamp(d.vx, -2500, 2500), y: clamp(d.vy, -2500, 2500) };
      if (d.moved || d.mode !== 'click') return;
      if (UI.removeMode) { // tap a building to tear it down
        const hit = R3.pick(e.clientX, e.clientY);
        if (hit && hit.kind === 'building') UI.askRemove(hit.ref, e.clientX, e.clientY); else UI.hideConfirm();
        return;
      }
      if (UI.buildType) {
        const g = R3.groundAt(e.clientX, e.clientY);
        if (!g) return;
        UI.moveGhost(g.x, g.z);
        if (this.touch) $('placeOk').classList.remove('hidden');
        else UI.confirmPlace(d.shift);
        return;
      }
      UI.select(R3.pick(e.clientX, e.clientY));
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.drag = null; this.pinch = null; this.wallDrag = null; });
    cv.addEventListener('pointerleave', () => UI.hideTip());
    cv.addEventListener('wheel', (e) => {
      if (this.mode !== 'play') return;
      e.preventDefault();
      R3.zoomBy(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'play') return;
      const k = e.key.toLowerCase();
      if (k === 'r' && UI.buildType) { UI.rotateGhost(); return; } // while placing, R turns the building instead of zooming
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e', 'r', 'f'].includes(k)) { this.keys[k] = true; if (k.startsWith('arrow')) e.preventDefault(); return; }
      if (k === ' ') { e.preventDefault(); if ($('menu').classList.contains('hidden')) UI.setPaused(!UI.paused); }
      else if (k === '1' || k === '2' || k === '3') UI.setSpeed(+k);
      else if (k === 'h') R3.lookAt(0, 1);
      else if (k === 'g') this.setQuality({ low: 'mid', mid: 'high', high: 'low' }[R3.quality]);
      else if (k === '-' || k === '_') this.changeUIScale(-0.1);
      else if (k === '=' || k === '+') this.changeUIScale(0.1);
      else if (k === 'm') $('btnSound').click();
      else if (k === 'j') $('jobsToggle').click();
      else if (k === 'n') UI.toggleLog();
      else if (k === 'b') UI.toggleBuildTray();
      else if (k === 'x') UI.setRemoveMode(!UI.removeMode);
      else if (k === 'escape') {
        if (!$('howto').classList.contains('hidden')) $('howto').classList.add('hidden');
        else if (UI.logOpen) UI.toggleLog(false);
        else if (UI.buildType) UI.cancelBuild();
        else if (UI.removeMode) UI.setRemoveMode(false);
        else if (UI.buildOpen) UI.toggleBuildTray(false);
        else if (UI.selected) UI.select(null);
        else if ($('menu').classList.contains('hidden')) UI.openMenu();
        else UI.closeMenu();
      }
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') Game.save(); });
    window.addEventListener('beforeunload', () => { if (this.mode === 'play') Game.save(); });
  },
  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },
  applyPinch() {
    const p = this.pinchState(), o = this.pinch;
    if (p.d > 10 && o.d > 10) R3.zoomBy(o.d / p.d);
    let da = p.ang - o.ang;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    R3.rotateBy(-da);
    R3.panBy(p.cx - o.cx, p.cy - o.cy);
    this.pinch = p;
  },

  /* ---------- loop ---------- */
  loop(now) {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      if (this.mode === 'title' && S) {
        Game.update(dt);
        R3.cam.tyaw += dt * 0.05;
      } else if (this.mode === 'play' && S) {
        if (!UI.paused && !S.over) {
          let total = dt * UI.speed;
          while (total > 1e-6) { const st = Math.min(1 / 30, total); Game.update(st); total -= st; }
        }
        const K = this.keys;
        const fwd = (K.w || K.arrowup ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0);
        const right = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0);
        if (fwd || right) R3.move(fwd, right, dt);
        if (K.q) R3.rotateBy(dt * 1.6);
        if (K.e) R3.rotateBy(-dt * 1.6);
        if (K.r) R3.zoomBy(1 - dt * 1.5);
        if (K.f) R3.zoomBy(1 + dt * 1.5);
        UI.frame(dt);
        this.watchPerf(dt);
      }
      if (S) {
        // music: day, a quiet night while the village waits, battle once the ghosts and demons are out
        const ph = phaseOf(S.t);
        let foes = 0, near = 0, boss = false;
        for (const e of S.enemies) { if (e.dead) continue; foes++; if (Math.hypot(e.x, e.z) < territory(S) + 4) near++; if (ENEMIES[e.type].boss) boss = true; }
        this.battleT = foes ? 4 : Math.max(0, (this.battleT || 0) - dt); // stay in battle a few seconds after the last one falls
        Sound.mode = ph === 'day' || ph === 'dawn' ? (foes ? 'battle' : 'day') : this.battleT > 0 ? 'battle' : 'night';
        Sound.threat = boss ? 1 : clamp(near / 8, 0, 1);
        // ambience: fire crackle when the camera is near the Agnikund, birds by day, crickets and owls at night, rain
        const dark = darknessAt(S.t), cd = Math.hypot(R3.cam.x, R3.cam.z) + R3.cam.dist * 0.35;
        Sound.amb.fire = clamp(1 - (cd - 8) / 22, 0, 1) * clamp(S.fire.intensity == null ? 1 : S.fire.intensity, 0.3, 1);
        Sound.amb.day = ph === 'day' ? (S.weather === 'rain' ? 0.2 : 1) : 0;
        Sound.amb.night = clamp(dark * 1.2 - 0.2, 0, 1) * (foes ? 0.5 : 1);
        Sound.amb.rain = S.weather === 'rain' ? 1 : 0;
        R3.render(dt);
      }
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((t) => this.loop(t));
  },
};

/** Place an already-finished building (title-screen demo village). */
function placeDemo(s, type, cx, cz) {
  if (!canPlace(s, type, cx, cz, true).ok) return null;
  const def = BUILDINGS[type];
  clearFootprint(s, type, cx, cz);
  const c = bCenterOf(type, cx, cz);
  const b = { id: s.nextId++, type, cx, cz, x: c.x, z: c.z, rot: def.wall ? 0 : def.fw !== def.fd ? (c.z > 0 ? Math.PI : 0) : faceFireRot(c.x, c.z), done: true, progress: def.time, hp: def.hp, maxHp: def.hp, grow: Math.random() * 25, cd: 0, offerT: 0 };
  addBuilding(s, b);
  return b;
}

window.addEventListener('load', () => App.init());
