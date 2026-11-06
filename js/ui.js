'use strict';
/* =========================================================
   DOM user interface: HUD, jobs, build bar, info panel,
   toasts and screens.
   ========================================================= */

const $ = (id) => document.getElementById(id);
const SAMPLE_LOOKS = {
  idle:    { g: 'm', skin: '#a0673a', hair: '#1a1212', cloth: '#e8c85a', lower: '#f4ecd8', head: '#f4ecd8', head2: '#d8cfb6', stache: true, trim: '#d8cfb6' },
  wood:    { g: 'm', skin: '#8d5524', hair: '#1a1212', cloth: '#c8453c', lower: '#efe4c8', head: '#ff9933', head2: '#e8b830', stache: true, trim: '#d8cfb6' },
  stone:   { g: 'm', skin: '#7a4a2a', hair: '#1a1212', cloth: '#3d7cc9', lower: '#e6dbbf', head: '#78909c', head2: '#546e7a', stache: false, trim: '#d8cfb6' },
  farm:    { g: 'f', skin: '#b5784a', hair: '#1a1212', cloth: '#ffb31a', lower: '#2a9d6f', trim: '#e8b830', covered: true },
  build:   { g: 'm', skin: '#9c6239', hair: '#2b1b14', cloth: '#5d9b4a', lower: '#f4ecd8', head: '#8d6e63', head2: '#5d4037', stache: true, trim: '#d8cfb6' },
  warrior: { g: 'm', skin: '#a0673a', hair: '#1a1212', cloth: '#5b4a3d', lower: '#6b1d24', head: '#a3161f', head2: '#e8b830', stache: true, trim: '#d8cfb6' },
  archer:  { g: 'f', skin: '#c68642', hair: '#1a1212', cloth: '#7b5a3a', lower: '#1f6f8b', trim: '#e8b830', covered: false },
  brute:   { g: 'm', skin: '#a0673a', hair: '#1a1212', cloth: '#a0673a', lower: '#ff9933', head: '#d84315', head2: '#ffcc80', stache: true, trim: '#d8cfb6' },
  spear:   { g: 'm', skin: '#8d5524', hair: '#1a1212', cloth: '#3e5f8a', lower: '#e6dbbf', head: '#1565c0', head2: '#e8b830', stache: true, trim: '#d8cfb6' },
  vaidya:  { g: 'm', skin: '#a0673a', hair: '#e8e2d8', cloth: '#f4ecd8', lower: '#e6dbbf', head: '#f4ecd8', head2: '#2e7d32', stache: true, trim: '#2e7d32' },
  medic:   { g: 'f', skin: '#b5784a', hair: '#1a1212', cloth: '#3f8a4a', lower: '#f4ecd8', trim: '#e8b830', covered: false },
  clay:    { g: 'm', skin: '#8d5524', hair: '#1a1212', cloth: '#c9a66b', lower: '#e6dbbf', head: '#a8603a', head2: '#e8c896', stache: true, trim: '#8c4e2c' },
  kiln:    { g: 'f', skin: '#a0673a', hair: '#1a1212', cloth: '#b9482a', lower: '#8c5a34', trim: '#e8b830', covered: true },
  smelt:   { g: 'm', skin: '#7a4a2a', hair: '#1a1212', cloth: '#5d4037', lower: '#4e342e', head: '#37474f', head2: '#ff8a1f', stache: true, trim: '#d8cfb6' },
  priest:  { g: 'm', skin: '#cf9561', hair: '#1a1212', cloth: '#ff8f1f', lower: '#ffb84d', head: '#ff8f1f', head2: '#ffb84d', stache: false, trim: '#d8cfb6' },
  trader:  { g: 'm', skin: '#b5784a', hair: '#1a1212', cloth: '#6a1b9a', lower: '#f4ecd8', head: '#ffd54f', head2: '#e65100', stache: true, trim: '#d8cfb6' },
};
const BUILD_VIS_H = { temple: 66, tower: 60, akhara: 30, lamp: 40, field: 24, range: 22, bazaar: 28 };

/** One consistent stroke icon set (24×24 grid) instead of emoji and text glyphs. */
const SVG_PATHS = {
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  sound: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  chevUp: '<path d="m6.5 14.5 5.5-5.5 5.5 5.5"/>',
  chevDown: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
  textMinus: '<path d="M3 18.5 7.5 6h1L13 18.5M4.6 14h6.8"/><path d="M16 12h5"/>',
  textPlus: '<path d="M3 18.5 7.5 6h1L13 18.5M4.6 14h6.8"/><path d="M16 12h5M18.5 9.5v5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4.5v4h-4"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  flame: '<path d="M12 3c.8 3 4.5 5 4.5 9.5a4.5 4.5 0 0 1-9 0c0-2.3 1.2-3.4 1.8-5.2.8 1.4 1.6 1.9 2.7 1.9-.4-2.2-.9-4.1 0-6.2z"/>',
  home: '<path d="M4 11 12 4.5l8 6.5"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5h4v5"/>',
  tree: '<path d="M12 3.5 6.5 11h3l-4 6.5h13l-4-6.5h3z"/><path d="M12 17.5v3"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8.5 4v4.5h6V4M8 20v-6h8v6"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.3 2.4c-.6.3-.9.7-.9 1.4v.4"/><path d="M12 16.8h.01"/>',
  exit: '<path d="M10 4.5H5.5v15H10"/><path d="m14.5 8 4 4-4 4M18.5 12H9.5"/>',
  music: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="11.5" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17h.01"/>',
  okc: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.6 2.6 5-5.2"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V17h5v-.6c0-.8.4-1.5 1-2A6 6 0 0 0 12 3.5z"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  hammer: '<path d="m13.5 6.5 4 4"/><path d="M12 8 4.5 15.5a2.1 2.1 0 0 0 3 3L15 11"/><path d="m10.5 4.5 2-1.5 7.5 7.5-1.5 2z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7"/><path d="M6.5 7 7.5 20h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/><path d="M12 10.5v4.5M9.75 12.75h4.5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
};
const svgIcon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${SVG_PATHS[name] || ''}</svg>`;
const TOAST_ICON = { good: 'okc', warn: 'alert', danger: 'alert', tip: 'bulb', info: 'info' };

const UI = {
  selected: null, buildType: null, speed: 1, paused: false,
  icons: {}, jobIcons: {}, lastInfo: '', prevRes: {}, refreshT: 0, lastToast: {},

  init() {
    for (const id of ['verTitle', 'verMenu']) { const el = document.getElementById(id); if (el) el.textContent = `Version ${GAME_VERSION}`; }
    for (const k of Object.keys(ICONS)) this.icons[k] = iconDataURL(k, 3);
    document.querySelectorAll('[data-ico]').forEach((el) => { el.style.backgroundImage = `url(${this.icons[el.dataset.ico]})`; });
    this.paintIcons(document);
    for (const job of ['idle', ...JOB_ORDER]) this.jobIcons[job] = this.portraitURL({ id: 'J' + job, job, look: SAMPLE_LOOKS[job] }, job === 'archer' ? 'shoot' : 'stand');
    this.toastBox = $('toasts');
    this.buildJobs();
    this.buildCards();
    this.wire();
    this.initTips();
  },
  /** Fill every [data-icon] element with its SVG (and an optional text label). */
  paintIcons(root) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = svgIcon(el.dataset.icon) + (el.dataset.label ? `<span>${el.dataset.label}</span>` : '');
    });
  },
  setIcon(el, name) { el.dataset.icon = name; el.innerHTML = svgIcon(name) + (el.dataset.label ? `<span>${el.dataset.label}</span>` : ''); },
  /* ---------- tooltips ---------- */
  initTips() {
    const tip = (this.tipEl = document.createElement('div'));
    tip.id = 'tooltip';
    tip.className = 'hidden';
    document.body.appendChild(tip);
    // move static title="" text into data-tip so the browser's slow native tooltip never doubles up
    document.querySelectorAll('[title]').forEach((el) => { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); });
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest && e.target.closest('[data-tip], .bcard');
      if (!el) { this.domTip = null; if (e.target.id !== 'view') this.hideTip(); return; }
      this.domTip = el;
      this.showTip(el.classList.contains('bcard') ? this.buildTip(el.dataset.type) : el.dataset.tip, e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', (e) => { if (!tip.classList.contains('hidden')) this.placeTip(e.clientX, e.clientY); });
    document.addEventListener('pointerout', (e) => {
      if (this.domTip && (!e.relatedTarget || !this.domTip.contains(e.relatedTarget))) { this.domTip = null; this.hideTip(); }
    });
    document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.hideTip(); });
  },
  showTip(html, x, y) {
    if (!html) { this.hideTip(); return; }
    if (this.tipEl.innerHTML !== html) this.tipEl.innerHTML = html;
    this.tipEl.classList.remove('hidden');
    this.placeTip(x, y);
  },
  hideTip() { if (this.tipEl) this.tipEl.classList.add('hidden'); },
  placeTip(x, y) {
    const t = this.tipEl, w = t.offsetWidth, h = t.offsetHeight;
    let left = x + 14, top = y + 18;
    if (left + w > window.innerWidth - 6) left = x - w - 10;
    if (top + h > window.innerHeight - 6) top = y - h - 12;
    t.style.left = Math.max(6, left) + 'px';
    t.style.top = Math.max(6, top) + 'px';
  },
  buildTip(type) {
    const def = BUILDINGS[type];
    let h = `<b>${def.name}</b> <small>· ${def.en}</small><br>${def.desc}`;
    if (S) {
      h += `<br>${this.costHTML(def.cost)}`;
      if (!canAfford(S, def.cost)) h += `<br><span class="miss">Missing ${missingText(S, def.cost)}</span>`;
      h += '<br><small>Click, then click your land to place. A Mistri builds it.</small>';
    }
    return h;
  },
  /** Tooltip for things in the game world under the mouse. */
  canvasTip(hit, x, y) {
    if (this.domTip) return;
    if (!hit || !S) { this.hideTip(); return; }
    const r = hit.ref;
    let h = '';
    switch (hit.kind) {
      case 'villager': h = `<b>${r.name}</b> · ${JOBS[r.job].name} <small>(${JOBS[r.job].en})</small><br>${r.task || ''}<br><small>Click to see details or change job</small>`; break;
      case 'enemy': h = `<b>${ENEMIES[r.type].name}</b> <small>${ENEMIES[r.type].en}</small><br>Health ${Math.ceil(r.hp)} / ${r.maxHp}`; break;
      case 'fire': h = `<b>Agnikund</b> · level ${S.fire.level}<br>The sacred fire. It eats wood; if demons put it out, you lose.<br><small>Click to upgrade it or invite travellers</small>`; break;
      case 'building': if (this.removeMode) { h = `<b>Destroy ${BUILDINGS[r.type].name}</b><br>You get back ${this.refundText(r)}<br><small>Click to ${BUILDINGS[r.type].wall ? 'destroy it' : 'choose'}</small>`; break; } { const d = BUILDINGS[r.type]; h =`<b>${d.name}</b> <small>${d.en}</small><br>${d.desc}<br><small>${r.done ? `Strength ${Math.ceil(r.hp)} / ${r.maxHp}` : `Under construction ${Math.floor((r.progress / d.time) * 100)}%`} · click for options</small>`; break; }
      case 'tree': h = r.sacred ? '<b>Pavitra Van</b> <small>sacred grove</small><br>Villagers without a hut hide here from demons. Never cut.' : `<b>${TREE_INFO[r.type].name}</b> <small>${TREE_INFO[r.type].en}</small><br>${r.stump ? 'Stump — regrowing' : r.wood + ' wood'} · chopped by Lakadhara`; break;
      case 'rock': h = `<b>Chattan</b> <small>Boulder</small><br>${r.stone} stone · mined by Khanik from a Khadaan`; break;
      case 'loot': h = `<b>${LOOT[r.kind].name}</b> <small>${LOOT[r.kind].en}</small><br>+${r.amt} ${RES[LOOT[r.kind].res].en.toLowerCase()} · dropped by a demon<br><small>Idle villagers collect it in daylight</small>`; break;
      case 'animal': h = r.kind === 'cow' ? '<b>Gau Mata</b> <small>the village cow</small>' : '<b>Mor</b> <small>peacock</small>'; break;
    }
    this.showTip(h, x, y);
  },
  ico(k, sm) { return `<i class="ico${sm ? ' sm' : ''}" style="background-image:url(${this.icons[k]})"></i>`; },
  _portraits: new Map(),
  portraitURL(v) {
    const key = v.id + '|' + v.job;
    let url = this._portraits.get(key);
    if (!url) { url = R3.villagerThumb(v.look, v.job); this._portraits.set(key, url); }
    return url;
  },
  /** Red line listing what is still missing for a cost ('' when affordable). */
  missHTML(cost, inline) {
    const m = S ? missingText(S, cost) : '';
    if (!m) return '';
    return inline ? `<br><span class="miss">Missing ${m}</span>` : `<p class="miss">Missing ${m}</p>`;
  },
  /** Game seconds as "40 s" or "2 min". */
  fmtSecs(x) { return !isFinite(x) ? '—' : x < 90 ? `${Math.max(1, Math.ceil(x))} s` : `${Math.round(x / 60)} min`; },
  costHTML(cost, sm) {
    return '<span class="cost">' + Object.keys(cost).map((k) => `<span class="${S && S.res[k] >= cost[k] ? '' : 'no'}">${this.ico(k, sm !== false)}${cost[k]}</span>`).join('') + '</span>';
  },

  /* ---------- jobs panel ---------- */
  buildJobs() {
    const box = $('jobRows');
    box.innerHTML = JOB_ORDER.map((job) => {
      const J = JOBS[job];
      return `<div class="job" data-job="${job}" data-tip="${J.name} (${J.en}) — ${J.desc}">
        <i class="ico" style="background-image:url(${this.jobIcons[job]})"></i>
        <div class="nm"><b>${J.name}</b><small>${J.en}</small></div>
        <span class="ct">0</span>
        <div class="bt"><button data-act="dec" data-tip="${J.weapon ? `Take the ${WEAPONS[J.weapon].name} back; one ${J.name} becomes a plain Sainik` : `Send one ${J.name} back to idle`}">${svgIcon('minus')}</button><button data-act="inc" data-tip="${J.weapon ? `Hand a <b>${WEAPONS[J.weapon].name}</b> from the armoury to a Sainik, making a <b>${J.name}</b>` : `Give an idle villager the job of <b>${J.name}</b>${J.building ? `<br><small>Each ${BUILDINGS[J.building].name} has room for ${BUILDINGS[J.building].slots[slotKey(job)]}</small>` : ''}`}">${svgIcon('plus')}</button></div>
      </div>`;
    }).join('');
    box.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button');
      const row = ev.target.closest('.job');
      if (!btn || !row || !S) return;
      Sound.init();
      if (btn.dataset.act === 'inc') assignJob(S, row.dataset.job);
      else unassignJob(S, row.dataset.job);
      this.refresh(true);
    });
  },
  updateJobs() {
    const idle = idleVillagers(S).length;
    $('idleCount').textContent = idle;
    $('idleCount').parentElement.classList.toggle('has', idle > 0 && phaseOf(S.t) === 'day');
    for (const row of document.querySelectorAll('.job')) {
      const job = row.dataset.job;
      const J = JOBS[job];
      const n = jobCount(S, job);
      // jobs stay hidden until the Agnikund (or, for special soldiers, their weapon workshop) unlocks them
      let unlocked = BUILDINGS[J.building].lvl <= S.fire.level;
      if (J.weapon) unlocked = unlocked && (weaponReady(S, J.weapon) || n > 0 || (S.armory[J.weapon] || 0) > 0);
      row.classList.toggle('hidden', !unlocked);
      if (!unlocked) continue;
      const slots = jobSlots(S, job), used = usedSlots(S, job);
      const ct = row.querySelector('.ct');
      const small = row.querySelector('small');
      if (J.weapon) {
        const have = S.armory[J.weapon] || 0;
        ct.textContent = String(n);
        small.textContent = `${have} ${WEAPONS[J.weapon].name} in armoury`;
        row.querySelector('[data-act=inc]').disabled = !have || jobCount(S, 'warrior') === 0;
      } else {
        ct.textContent = slots === Infinity ? String(n) : slotKey(job) === 'army' ? `${n} · ${used}/${slots}` : `${n}/${slots}`;
        small.textContent = slots === 0 ? `needs ${BUILDINGS[J.building].name}` : J.en;
        row.querySelector('[data-act=inc]').disabled = idle === 0 || used >= slots;
      }
      ct.classList.toggle('full', slots !== Infinity && used >= slots && slots > 0);
      row.classList.toggle('locked', slots === 0);
      row.querySelector('[data-act=dec]').disabled = n === 0;
    }
  },

  /* ---------- build bar ---------- */
  buildCards() {
    const box = $('buildCards');
    box.innerHTML = '';
    for (const type of BUILD_ORDER) {
      const def = BUILDINGS[type];
      const card = document.createElement('div');
      card.className = 'bcard';
      card.dataset.type = type;
      const img = document.createElement('img');
      img.src = R3.buildingThumb(type);
      img.alt = def.en;
      img.draggable = false;
      card.appendChild(img);
      card.insertAdjacentHTML('beforeend', `<b>${def.name}</b><small>${def.en}</small><div class="cw"></div><span class="newtag hidden">New</span>`);
      box.appendChild(card);
    }
    box.addEventListener('click', (ev) => {
      const card = ev.target.closest('.bcard');
      if (!card || !S) return;
      Sound.init();
      const type = card.dataset.type;
      if (BUILDINGS[type].lvl > S.fire.level) return;
      S.tips['seen_' + type] = 1;
      if (this.buildType === type) { this.cancelBuild(); return; }
      this.startBuild(type);
    });
  },
  updateCards() {
    for (const card of document.querySelectorAll('.bcard')) {
      const type = card.dataset.type, def = BUILDINGS[type];
      const locked = def.lvl > S.fire.level;
      card.classList.toggle('hidden', locked); // not shown at all until unlocked
      if (locked) continue;
      card.querySelector('.newtag').classList.toggle('hidden', def.lvl === 1 || !!S.tips['seen_' + type]);
      card.classList.toggle('poor', !canAfford(S, def.cost));
      card.classList.toggle('sel', this.buildType === type);
      const html = this.costHTML(def.cost);
      const cw = card.querySelector('.cw');
      if (cw.innerHTML !== html) cw.innerHTML = html;
    }
  },
  /* ---------- Build tray and Remove mode (top bar) ---------- */
  buildOpen: false, removeMode: false,
  toggleBuildTray(open) {
    this.buildOpen = open == null ? !this.buildOpen : open;
    if (this.buildOpen) this.setRemoveMode(false);
    else if (this.buildType) this.cancelBuild();
    document.body.classList.toggle('build-open', this.buildOpen);
    const bb2 = $('btnBuild');
    bb2.classList.toggle('on', this.buildOpen);
    bb2.dataset.label = this.buildOpen ? 'Close' : 'Build';
    this.setIcon(bb2, this.buildOpen ? 'x' : 'hammer');
    if (this.buildOpen) { const bb = $('buildbar'); bb.classList.remove('rise'); void bb.offsetWidth; bb.classList.add('rise'); this.refresh(true); }
  },
  setRemoveMode(on) {
    this.removeMode = !!on;
    if (on) { this.toggleBuildTray(false); this.select(null); }
    this.hideConfirm();
    document.body.classList.toggle('remove-mode', this.removeMode);
    const rb = $('btnRemove');
    rb.classList.toggle('on', this.removeMode);
    rb.dataset.label = this.removeMode ? 'Done' : 'Destroy';
    this.setIcon(rb, this.removeMode ? 'check' : 'trash');
    $('removeBar').classList.toggle('hidden', !this.removeMode);
  },
  refundText(b) {
    const def = BUILDINGS[b.type], f = b.done ? 0.5 : 0.9;
    const parts = Object.keys(def.cost).map((k) => Math.floor(def.cost[k] * f) > 0 ? this.ico(k, true) + Math.floor(def.cost[k] * f) : '').filter(Boolean);
    return parts.length ? `<span class="cost">${parts.join(' ')}</span>` : 'nothing';
  },
  /** Remove mode: walls go at once; anything bigger asks first in a small pop-up. */
  askRemove(b, x, y) {
    const def = BUILDINGS[b.type];
    if (def.wall) { demolish(S, b); this.hideConfirm(); this.refresh(true); return; }
    let pop = this._pop;
    if (!pop) {
      pop = this._pop = document.createElement('div');
      pop.id = 'confirmPop';
      pop.className = 'hidden';
      $('app').appendChild(pop);
      pop.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.act === 'yes' && this._popFor && S.buildings.includes(this._popFor)) {
          const d = BUILDINGS[this._popFor.type];
          demolish(S, this._popFor);
          toast(`${d.name} destroyed.`, 'info', 3);
        }
        this.hideConfirm();
        this.refresh(true);
      });
    }
    this._popFor = b;
    const inside = b.type && isHome(b.type) ? S.villagers.filter((v) => v.home === b.id).length : 0;
    pop.innerHTML = `<b>Destroy ${def.name}?</b><p>You get back ${this.refundText(b)}${b.done ? ' (half the cost)' : ' (most of the cost)'}.${inside ? ` ${inside} villager${inside > 1 ? 's' : ''} will lose their home.` : ''}</p><div class="pb"><button data-act="no">Keep</button><button data-act="yes" class="dangerfill">${svgIcon('trash')}Destroy</button></div>`;
    pop.classList.remove('hidden');
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = clamp(x - w / 2, 8, window.innerWidth - w - 8) + 'px';
    pop.style.top = clamp(y - h - 16, 8, window.innerHeight - h - 8) + 'px';
    sfx('click');
  },
  hideConfirm() { if (this._pop) this._pop.classList.add('hidden'); this._popFor = null; },
  startBuild(type) {
    this.buildType = type;
    this.select(null);
    const def = BUILDINGS[type];
    const cx = Math.round(R3.cam.x - def.fw / 2), cz = Math.round(R3.cam.z - def.fd / 2);
    this.ghost = { type, cx, cz, ok: canPlace(S, type, cx, cz).ok, wall: !!def.wall };
    R3.setGhost(this.ghost);
    $('placeBar').classList.remove('hidden');
    const touch = App.touch || document.body.classList.contains('touch');
    const how = def.wall ? (touch ? 'tap a spot, then Place — repeat for more pieces' : 'click, or click-and-drag to build a line') : (touch ? 'tap the ground, Rotate if you like, then Place' : 'click your land to place · R to rotate');
    $('placeMsg').textContent = `${def.name}: ${how}`;
    $('placeOk').classList.toggle('hidden', !touch);
    sfx('click');
    this.refresh(true);
  },
  cancelBuild() {
    this.buildType = null;
    this.ghost = null;
    if (R3.ok) R3.setGhost(null);
    $('placeBar').classList.add('hidden');
    this.refresh(true);
  },
  /** Turn the building being placed: square ones by 90°, long ones end to end (their footprint stays the same). */
  rotateGhost() {
    const g = this.ghost;
    if (!g) return;
    const def = BUILDINGS[g.type];
    const step = def.fw === def.fd ? Math.PI / 2 : Math.PI;
    const c = bCenterOf(g.type, g.cx, g.cz);
    const cur = g.userRot != null ? g.userRot : g.rot != null ? g.rot : def.fw !== def.fd ? (c.z > 0 ? Math.PI : 0) : faceFireRot(c.x, c.z);
    g.userRot = (cur + step) % (Math.PI * 2);
    g.rot = g.userRot;
    R3.setGhost(g);
    sfx('click');
  },
  /** Move the placement ghost to the ground point (x, z). */
  moveGhost(x, z) {
    const g = this.ghost;
    if (!g) return;
    const def = BUILDINGS[g.type];
    g.cx = Math.round(x - def.fw / 2);
    g.cz = Math.round(z - def.fd / 2);
    const chk = canPlace(S, g.type, g.cx, g.cz);
    g.ok = chk.ok;
    g.cells = null;
    g.rot = g.userRot != null ? g.userRot : def.wall ? Math.atan2(-g.cx - 0.5, -g.cz - 0.5) : null;
    R3.setGhost(g);
    $('placeMsg').textContent = chk.ok ? `${def.name}: good spot!` : `${def.name}: ${chk.why}`;
  },
  /** Preview a dragged line of wall pieces from cell a to the ground point (x, z). */
  dragWall(a, x, z) {
    const g = this.ghost;
    if (!g) return;
    const c1x = Math.floor(x), c1z = Math.floor(z);
    const cells = lineCells(a[0], a[1], c1x, c1z).slice(0, 60);
    const dx = c1x - a[0], dz = c1z - a[1];
    g.cells = cells;
    g.rot = dx || dz ? Math.atan2(-dz, dx) : Math.atan2(-a[0] - 0.5, -a[1] - 0.5);
    let cost = 0;
    const per = BUILDINGS[g.type].cost;
    const key = Object.keys(per)[0];
    g.oks = cells.map(([cx, cz]) => { const ok = canPlace(S, g.type, cx, cz, true).ok && S.res[key] >= cost + per[key]; if (ok) cost += per[key]; return ok; });
    R3.setGhost(g);
    $('placeMsg').textContent = `${BUILDINGS[g.type].name}: ${g.oks.filter(Boolean).length} pieces · ${cost} ${RES[key].en.toLowerCase()}`;
  },
  confirmPlace(keep) {
    const g = this.ghost;
    if (!g) return;
    let ok;
    if (g.cells && g.cells.length > 1) ok = placeWallLine(S, g.type, g.cells, g.rot) > 0;
    else ok = !!placeBuilding(S, g.type, g.cx, g.cz, g.userRot != null ? g.userRot : g.wall ? g.rot : null);
    g.cells = null;
    if (ok && !keep && !g.wall) this.cancelBuild();
    else if (this.ghost) R3.setGhost(Object.assign(g, { ok: canPlace(S, g.type, g.cx, g.cz).ok }));
    this.refresh(true);
  },

  /* ---------- selection & info ---------- */
  select(sel) {
    if (sel && this.logOpen && document.body.classList.contains('mobile')) this.toggleLog(false);
    this.selected = sel;
    this.lastInfo = '';
    if (sel) sfx('click');
    this.renderInfo();
  },
  /** A labelled bar: name on the left, value on the right, a thin track underneath. */
  meter(cls, f, label, value) {
    return `<div class="meter ${cls}"><div class="ml"><span>${label}</span>${value != null ? `<em>${value}</em>` : ''}</div><div class="mt"><i style="width:${(clamp(f, 0, 1) * 100).toFixed(1)}%"></i></div></div>`;
  },
  sec(title, body, extra) { return `<div class="sec"><h4>${title}${extra || ''}</h4>${body}</div>`; },
  /** One fill bar per good a stockpile holds (no bar for the bottomless Agnikund heap). */
  stockHTML(list, title, note) {
    let h = '';
    for (const it of list) {
      const name = RES[it.r].en;
      if (it.cap === Infinity) { h += `<div class="stockrow">${this.ico(it.r, true)}${this.meter('stock', it.n > 0 ? 1 : 0, name, it.n)}</div>`; continue; }
      const full = it.n >= it.cap;
      h += `<div class="stockrow">${this.ico(it.r, true)}${this.meter('stock' + (full ? ' full' : ''), it.n / it.cap, name, `${it.n} / ${it.cap}`)}</div>`;
    }
    const anyFull = list.some((it) => it.cap !== Infinity && it.n >= it.cap);
    return this.sec(title, h + (note ? `<p><small>${note}</small></p>` : ''), anyFull ? '<span class="tag bad">Full</span>' : '');
  },
  /** Kiln and smelter: what it makes (and a picker on the kiln), the recipe, the hopper, the batch and what holds it up. */
  productionHTML(s, b) {
    const def = BUILDINGS[b.type], key = recipeOf(s, b), R = RECIPES[key], hop = b.hopper || {};
    const st = (icon, text) => `<div class="status">${svgIcon(icon)}<span>${text}</span></div>`;
    let h = '';
    if (def.recipes.length > 1) {
      const cur = b.recipe || def.recipes[0];
      h += '<div class="seg recipes">' + def.recipes.map((k) => `<button data-action="recipe" data-k="${k}" class="${cur === k ? 'on' : ''}" data-tip="${k === 'auto' ? 'Burns charcoal when the smelters run low, fires bricks the rest of the time' : RECIPES[k].verb}">${k === 'auto' ? 'Auto' : this.ico(RECIPES[k].out, true) + RES[RECIPES[k].out].en}</button>`).join('') + '</div>';
    }
    h += `<p class="recipe">${Object.keys(R.in).map((r) => `<span>${this.ico(r, true)}${R.in[r]}</span>`).join('<em>+</em>')}<em>→</em><span>${this.ico(R.out, true)}${R.n}</span><small>${R.time} s of work${(b.recipe || def.recipes[0]) === 'auto' ? ' · auto' : ''}</small></p>`;
    h += `<div class="hopper"><small>Hopper</small>${Object.keys(R.in).map((r) => { const n = Math.floor(hop[r] || 0); return `<span class="${n >= R.in[r] ? 'ok' : ''}">${this.ico(r, true)}${n}<i>/${R.in[r]}</i></span>`; }).join('')}</div>`;
    h += this.meter('prog', (b.batch || 0) / R.time, 'This batch', `${Math.floor(((b.batch || 0) / R.time) * 100)}%`);
    const workers = s.villagers.filter((v) => v.workplace === b.id).length;
    const out = Object.keys(R.in).find((r) => (hop[r] || 0) < R.in[r] && (s.res[r] || 0) < 1);
    if (!workers) h += `<p class="miss">Nobody works here: assign ${JOBS[jobOfBuilding(b.type)].name}.</p>`;
    else if (out) h += `<p class="miss">Out of ${RES[out].en.toLowerCase()}. ${RES[out].from}.</p>`;
    else if ((b.activeT || -9) > s.time - 1.5) h += st('flame', `${R.verb}…`);
    else h += st('info', phaseOf(s.t) === 'day' ? 'Workers are bringing in the inputs' : 'The fire is banked for the night');
    return this.sec('Production', h);
  },
  /** Khadaan: break grey boulders for stone, or rusty ones for iron ore (from Agnikund level 2). */
  mineHTML(s, b) {
    const ore = b.mine === 'ore';
    let h = `<div class="seg recipes"><button data-action="mine" data-k="stone" class="${ore ? '' : 'on'}">${this.ico('stone', true)}Stone</button><button data-action="mine" data-k="ore" class="${ore ? 'on' : ''}">${this.ico('ore', true)}Iron ore</button></div>`;
    const near = s.rocks.filter((r) => r.ore && distXZ(r.x, r.z, b.x, b.z) < 16).length;
    h += `<p><small>${ore ? `Khanik break the rusty boulders for iron ore: ${near} within reach.${near ? '' : ' Build a Khadaan nearer to them.'}` : 'Khanik break grey boulders for stone, and now and then find gold.'}</small></p>`;
    return this.sec('Dig for', h);
  },
  /** Bhandar bays: one tile per bay showing its good and how full it is; tap one to pick a different good. */
  baysHTML(s, b) {
    const bays = storeBays(b), cap = BAY_CAP[bLevel(b)] || 30, st = b.stock || {}, left = {};
    for (const r of RES_ORDER) left[r] = Math.floor(st[r] || 0);
    const pick = this.bayPick && this.bayPick.b === b.id ? this.bayPick.i : -1;
    let h = '<div class="bays">';
    bays.forEach((r, i) => {
      const n = Math.min(cap, left[r]); left[r] -= n;
      h += `<button class="bay${i === pick ? ' cur' : ''}${n >= cap ? ' full' : ''}" data-action="bay" data-i="${i}" data-tip="Bay ${i + 1}: ${RES[r].en}. Tap to change">${this.ico(r, true)}<span>${RES[r].en}</span><em>${n}/${cap}</em><b class="fill" style="width:${((n / cap) * 100).toFixed(0)}%"></b></button>`;
    });
    h += '</div>';
    if (pick >= 0) {
      h += `<p class="baypick"><small>Bay ${pick + 1} holds</small>`;
      for (const r of RES_ORDER) h += `<button data-action="bayset" data-i="${pick}" data-r="${r}" class="${bays[pick] === r ? 'cur' : ''}">${this.ico(r, true)}${RES[r].en}</button>`;
      h += '</p>';
    }
    const missing = RES_ORDER.filter((r) => !bays.includes(r)).map((r) => RES[r].en.toLowerCase());
    h += `<p><small>Tap a bay to pick its good. ${missing.length ? `No bay for ${missing.join(' or ')}: build another Bhandar for that. ` : ''}What no longer fits goes to the Agnikund heap.</small></p>`;
    const full = RES_ORDER.some((r) => bays.includes(r) && (st[r] || 0) >= stockCap(b, r));
    return this.sec('Storage bays', h, `<span class="tag${full ? ' bad' : ''}">${bays.length} × ${cap}</span>`);
  },
  renderInfo() {
    const box = $('info');
    const sel = this.selected;
    if (!sel || !S) { box.classList.add('hidden'); document.body.classList.remove('info-open'); this.lastInfo = ''; return; }
    let html = '';
    const head = (pic, title, sub) => `<div class="info-head">${pic ? `<img class="pic" src="${pic}" alt="">` : ''}<div class="ttl"><b>${title}</b><small>${sub}</small></div><button class="ib sm x" data-action="close" data-tip="Close <kbd>Esc</kbd>">${svgIcon('x')}</button></div>`;
    const status = (icon, text) => `<div class="status">${svgIcon(icon)}<span>${text}</span></div>`;
    const s = S;
    if (sel.kind === 'villager') {
      const v = sel.ref;
      if (!s.villagers.includes(v)) { this.select(null); return; }
      const J = JOBS[v.job];
      html += head(this.portraitURL(v), v.name, `${J.name} · ${J.en}`);
      html += '<div class="info-body">';
      html += `<p class="task">${v.task || 'Thinking…'}</p>`;
      html += this.meter('', v.hp / v.maxHp, 'Health', `${Math.ceil(v.hp)} / ${v.maxHp}`);
      if (ULTIMATES[v.job]) { // the Shakti bar and the ultimate it unleashes
        const U = ULTIMATES[v.job], full = (v.power || 0) >= 100;
        html += this.meter('pow' + (full ? ' full' : ''), (v.power || 0) / 100, `Shakti · ${U.name}`, full ? 'Ready!' : `${Math.floor(v.power || 0)}%`);
        html += `<p><small><b>${U.name}</b> (${U.en}): ${U.desc}. Fills as they fight and take blows.</small></p>`;
      }
      if (v.entranced > 0 && v.callBy) html += `<div class="actions"><button data-action="holdback" class="primary" data-tip="Folk wisdom: never answer the first or second call">${svgIcon('alert')}Hold ${v.name} back from Nishi Dak</button></div>`;
      if (v.heldBy) html += `<p class="miss">Seized by a Mamdo Bhoot! Strike it hard or stun it to break its grip.</p>`;
      if (v.hp < v.maxHp - 0.5) { // hurt: natural recovery, a healer on the way, and herbs to heal them at once
        const RG = { fire: ['flame', 'Recovering by the Agnikund'], home: ['home', 'Resting at home'], calm: ['heart', 'Recovering slowly'] }[v.regen];
        if (RG) html += status(RG[0], `${RG[1]} · <b>+${REGEN[v.regen]}</b> health a second`);
        else if (v.combatT > 0) html += status('alert', 'In the fight: no recovery until it is over');
        else html += status('alert', 'Demons nearby: no recovery here');
        if (v.healBy && (v.healT || 0) > s.time) html += status('heart', v.healNear ? `${v.healBy} is healing them` : `${v.healBy} is coming to heal them`);
        else if (!s.buildings.some((b) => b.type === 'vaidyashala' && b.done)) html += '<p><small>Build a Vaidyashala and its Vaidya will walk to the wounded and heal them.</small></p>';
        const wait = Math.ceil((v.herbT || 0) - s.time), ok = canAfford(s, HERB_COST);
        html += `<div class="actions"><button data-action="herbs" class="${wait > 0 ? '' : ok ? 'primary' : 'poorbtn'}" ${wait > 0 ? 'disabled' : ''} data-tip="Heal 60% of their health at once">${svgIcon('heart')}${wait > 0 ? `Herbs again in ${wait} s` : `Heal with herbs ${this.costHTML(HERB_COST)}`}</button></div>`;
      }
      if (v.carryAmt > 0 && v.carry) {
        const cap = carryCap(s, v.carry);
        html += `<div class="stockrow">${this.ico(v.carry, true)}${this.meter('stock' + (v.carryAmt >= cap ? ' full' : ''), v.carryAmt / cap, `Tokri · ${RES[v.carry].en.toLowerCase()}`, `${v.carryAmt} / ${cap}`)}</div>`;
      } else if (['wood', 'stone', 'farm', 'clay'].includes(v.job)) html += `<div class="stockrow">${this.ico(v.job === 'farm' ? 'food' : v.job, true)}${this.meter('stock', 0, 'Tokri', 'empty')}</div>`;
      if (v.gold > 0) html += status('info', `<b>${v.gold}</b> gold in the hip pouch`);
      if (!isDefender(v)) html += validHome(s, v) ? status('home', 'Hides in their Jhopdi when demons come') : status('tree', 'No hut — hides in the sacred grove');
      if (v.job === 'warrior') { // hand this Sainik a weapon
        const arm = WEAPON_ORDER.filter((w) => (s.armory[w] || 0) > 0);
        if (arm.length) {
          let b = '<div class="actions">';
          for (const w of arm) b += `<button data-action="equip" data-job="${WEAPONS[w].job}" data-tip="${JOBS[WEAPONS[w].job].desc}">${WEAPONS[w].name} → ${JOBS[WEAPONS[w].job].name} <span class="tag">${s.armory[w]}</span></button>`;
          html += this.sec('Give a weapon', b + '</div>');
        } else if (WEAPON_ORDER.some((w) => weaponReady(s, w))) html += '<p><small>Craft a weapon at the Lohar or Aara Mill to make this Sainik a special soldier.</small></p>';
      }
      if (JOBS[v.job].weapon) html += `<div class="actions"><button data-action="disarm" data-tip="Return the ${WEAPONS[JOBS[v.job].weapon].name} to the armoury">Back to Sainik</button></div>`;
      let g = '<div class="jobgrid">';
      for (const job of ['idle', ...JOB_ORDER]) {
        if (JOBS[job].weapon) continue; // special soldiers are made by handing a Sainik a weapon
        if (job !== 'idle' && BUILDINGS[JOBS[job].building].lvl > s.fire.level) continue;
        const full = job !== v.job && slotKey(job) !== slotKey(v.job) && usedSlots(s, job) >= jobSlots(s, job);
        g += `<button data-action="job" data-job="${job}" class="${job === v.job ? 'cur' : ''}" ${full ? 'disabled' : ''} data-tip="${JOBS[job].desc}">${JOBS[job].name}<small>${JOBS[job].en}</small></button>`;
      }
      html += this.sec('Change job', g + '</div>') + '</div>';
    } else if (sel.kind === 'fire') {
      const F = s.fire, L = fireLv(s);
      html += head(this.icons.fire, 'Agnikund', `Sacred fire · level ${F.level}`);
      html += '<div class="info-body">';
      html += this.meter('', F.hp / L.hp, 'Flame', `${Math.ceil(F.hp)} / ${L.hp}`);
      html += this.meter('fuel' + (F.dim ? ' full' : ''), F.fuel / L.fuelMax, F.dim ? 'Fuel — starving!' : 'Fuel', `${F.fuel.toFixed(1)} / ${L.fuelMax}`);
      html += `<p>Burns about <b>${Math.round(L.burn * DAY_LEN * (s.weather === 'rain' ? 1.6 : 1))} wood</b> a day from your stock and scorches demons that come close. Land reaches <b>${L.radius}</b> steps; <b>${L.housing}</b> can sleep by the fire.</p>`;
      if (F.level < 5) {
        const N = FIRE_LEVELS[F.level + 1];
        const unlocks = BUILD_ORDER.filter((t) => BUILDINGS[t].lvl === F.level + 1).map((t) => BUILDINGS[t].name);
        let b = `<p>Land grows to ${N.radius} steps and the flame grows stronger${unlocks.length ? `. Unlocks <b>${unlocks.join(', ')}</b>` : ''}.</p><p>${this.costHTML(N.cost)}</p>${this.missHTML(N.cost)}`;
        b += `<div class="actions"><button data-action="upfire" class="${canAfford(s, N.cost) ? 'primary' : 'poorbtn'}" data-tip="Spend the cost to grow the Agnikund">${svgIcon('flame')}Upgrade to level ${F.level + 1}</button></div>`;
        html += this.sec('Upgrade', b);
      } else html += this.sec('Upgrade', '<p>The Agnikund burns at its mightiest.</p>');
      html += this.stockHTML(stockList(s, null), 'Agnikund heap', 'Overflow from full stockpiles. It never fills.');
      html += `<div class="actions"><button class="${canAfford(s, INVITE_COST) ? '' : 'poorbtn'}" data-action="invite" ${s.villagers.length < housing(s) ? '' : 'disabled'} data-tip="Invite a traveller to join now">${svgIcon('user')}Invite traveller ${this.costHTML(INVITE_COST)}</button></div>`;
      html += '</div>';
    } else if (sel.kind === 'building') {
      const b = sel.ref;
      if (!s.buildings.includes(b)) { this.select(null); return; }
      const def = BUILDINGS[b.type];
      html += head(null, def.name, def.en + (def.levels ? ` · level ${bLevel(b)}` : ''));
      html += '<div class="info-body">';
      html += `<p>${def.desc}</p>`;
      if (!b.done) {
        html += this.meter('prog', b.progress / def.time, 'Construction', `${Math.floor((b.progress / def.time) * 100)}%`);
        html += canBuildNow(s) ? status('info', jobCount(s, 'build') ? 'A Mistri is on the way' : 'Idle villagers are building it') : '<p class="miss">Nobody to build it: assign a Mistri, or free a villager (idle villagers build too).</p>';
      } else {
        html += this.meter('', b.hp / b.maxHp, 'Strength', `${Math.ceil(b.hp)} / ${b.maxHp}`);
        if (isFieldType(b.type)) html += this.meter('prog', b.grow / 30, 'Crop', `${Math.floor((b.grow / 30) * 100)}%`);
        if (def.recipes) html += this.productionHTML(s, b);
        if (b.type === 'minecamp' && s.fire.level >= 2) html += this.mineHTML(s, b);
        const job = jobOfBuilding(b.type);
        if (job) {
          const k = slotKey(job);
          const ws = s.villagers.filter((v) => slotKey(v.job) === k && v.workplace === b.id);
          const cap = bSlots(b, job);
          const army = k === 'army';
          let w = ws.length ? `<p>${ws.map((v) => v.name + (army ? ` <small>(${JOBS[v.job].name})</small>` : '')).join(', ')}</p>` : '<p><small>Nobody works here yet.</small></p>';
          w += `<div class="actions"><button class="${idleVillagers(s).length && ws.length < cap ? 'primary' : ''}" data-action="bassign" data-tip="Send an idle villager to work here as ${JOBS[job].name}" ${idleVillagers(s).length && ws.length < cap ? '' : 'disabled'}>${svgIcon('plus')}${army ? 'Train Sainik' : 'Assign'}</button>`;
          w += `<button data-action="bremove" data-tip="Send one worker back to idle" ${ws.length ? '' : 'disabled'}>${svgIcon('minus')}Remove</button></div>`;
          if (army) w += '<p><small>Soldiers start as Sainik. Craft weapons at the Lohar or Aara Mill to make Gadadhari, Bhaladhari or Dhanurdhar.</small></p>';
          html += this.sec(army ? 'Soldiers' : JOBS[job].name, w, `<span class="tag">${ws.length} / ${cap}</span>`);
        }
        // building levels (Lohar, Aara Mill): upgrade, craft weapons, research
        if (def.levels) {
          const lv = bLevel(b), max = def.levels.length - 1;
          let u = '';
          if (b.upgrading) {
            const L = def.levels[lv + 1];
            u += this.meter('prog', (b.upProg || 0) / L.time, `To level ${lv + 1}`, `${Math.floor(((b.upProg || 0) / L.time) * 100)}%`);
            const crew = upgradeCrew(s, b), left = Math.max(0, L.time - (b.upProg || 0)), day = phaseOf(s.t) === 'day';
            const helpers = s.villagers.filter((v) => v.helpB === b.id).length, freeIdle = idleVillagers(s).some((v) => !v.helpB);
            if (crew.n) u += status('user', `<b>${crew.n}</b> working on it · about <b>${this.fmtSecs(left / crew.rate)}</b> left`);
            else u += `<p class="miss">${day ? 'Nobody is working on it yet. Send a helper, or assign a Mistri.' : 'Work stops for the night and carries on at dawn.'}</p>`;
            u += `<div class="actions"><button data-action="uphelp" class="${freeIdle && day ? 'primary' : ''}" ${freeIdle ? '' : 'disabled'} data-tip="Send an idle villager to help. More hands finish sooner">${svgIcon('plus')}Send helper</button><button data-action="upunhelp" ${helpers ? '' : 'disabled'} data-tip="Call one helper back">${svgIcon('minus')}Call back</button></div>`;
            u += `<p><small>By day its own workers, your Mistri, idle villagers and helpers${helpers ? ` (${helpers} sent)` : ''} build it. The more people, the sooner it is done.</small></p>`;
          } else if (lv < max) {
            const L = def.levels[lv + 1];
            u += `<p>Unlocks <b>${L.unlocks}</b>.</p><p>${this.costHTML(L.cost)} <small>· about ${this.fmtSecs(L.time)} of work for one person</small></p>${this.missHTML(L.cost)}`;
            u += `<div class="actions"><button data-action="bupgrade" class="${canAfford(s, L.cost) ? 'primary' : 'poorbtn'}" data-tip="A Mistri will build the upgrade">${svgIcon('up')}Upgrade to level ${lv + 1}</button></div>`;
          } else u += '<p>Fully upgraded.</p>';
          html += this.sec('Level', u, `<span class="tag">${lv} / ${max}</span>`);
          const ws2 = WEAPON_ORDER.filter((w) => WEAPONS[w].at === b.type && WEAPONS[w].lvl <= lv);
          if (ws2.length) {
            let c = '<div class="uplist">';
            for (const w of ws2) {
              const W = WEAPONS[w], J = JOBS[W.job];
              c += `<div class="up"><div class="d"><b>${W.name} <small>${W.en}</small></b>Makes a ${J.name} · in armoury <b>${s.armory[w] || 0}</b><br>${this.costHTML(W.cost)}${this.missHTML(W.cost, true)}</div><div class="bt2"><button data-action="craft" data-key="${w}" data-n="1" class="${canAfford(s, W.cost) ? 'primary' : 'poorbtn'}" data-tip="Craft one ${W.name}">Make</button><button data-action="craft" data-key="${w}" data-n="5" data-tip="Craft up to five">×5</button>${s.armory[w] ? `<button data-action="equip" data-job="${W.job}" data-tip="Give a ${W.name} to a Sainik now">Arm</button>` : ''}</div></div>`;
            }
            html += this.sec(b.type === 'vaidyashala' ? 'Medicine kits' : 'Weapons', c + '</div>');
          }
          const techs = UPGRADE_ORDER.filter((k) => UPGRADES[k].at === b.type && UPGRADES[k].lvl <= lv);
          if (techs.length) {
            let c = '<div class="uplist">';
            for (const k of techs) {
              const u2 = UPGRADES[k], own = s.upgrades[k];
              c += `<div class="up ${own ? 'owned' : ''}"><div class="d"><b>${u2.name} <small>${u2.en}</small></b>${u2.desc}${own ? '' : '<br>' + this.costHTML(u2.cost) + this.missHTML(u2.cost, true)}</div>${own ? `<span class="tag good">${svgIcon('check')}Done</span>` : `<button data-action="upgrade" data-key="${k}" class="${canAfford(s, u2.cost) ? 'primary' : 'poorbtn'}" data-tip="${u2.name}: ${u2.desc}">Make</button>`}</div>`;
            }
            html += this.sec('Research', c + '</div>');
          }
        }
        if (b.type === 'store') html += this.baysHTML(s, b);
        else if (def.drop) html += this.stockHTML(stockList(s, b), 'In stock', 'When full, workers take the rest to the next stockpile or the Agnikund heap.');
        if (isHome(b.type)) {
          const res = s.villagers.filter((v) => v.home === b.id);
          const inn = res.filter((v) => v.inside).length;
          let r = `<p>${res.length ? res.map((v) => v.name).join(', ') : 'Nobody yet'}${inn ? ` <small>· ${inn} hiding inside</small>` : ''}</p>`;
          if (b.type === 'hut') r += '<p><small>Build another Jhopdi touching this one and they join into a Bada Ghar for 7.</small></p>';
          html += this.sec('Residents', r, `<span class="tag">${res.length} / ${def.housing}</span>`);
        }
        if (b.type === 'field') html += '<p><small>Build another Khet edge to edge and they join into a Bada Khet for 5 Kisan.</small></p>';
      }
      html += '<div class="actions">';
      if (b.type === 'palisade' && b.done && s.fire.level >= 3) html += `<button data-action="fortify" class="${canAfford(s, STONE_WALL_COST) ? '' : 'poorbtn'}" data-tip="Rebuild as a sandstone fort wall">Fortify ${this.costHTML(STONE_WALL_COST)}</button>`;
      html += `<button class="danger" data-action="demolish" data-tip="Tear it down and get part of the cost back">${svgIcon('trash')}Destroy · ${b.done ? '50' : '90'}% back</button>`;
      html += '</div></div>';
    } else if (sel.kind === 'enemy') {
      const e = sel.ref;
      if (!s.enemies.includes(e)) { this.select(null); return; }
      const d = ENEMIES[e.type];
      html += head(this.icons.skull, d.name, d.en);
      html += '<div class="info-body">';
      html += this.meter('ehp', e.hp / e.maxHp, 'Health', `${Math.ceil(e.hp)} / ${e.maxHp}`);
      html += `<p>${ENEMY_LORE[e.type] || ''}</p>`;
      if (e.loot > 0) html += `<p class="miss">Carrying ${e.loot} stolen grain — kill him to get it back.</p>`;
      html += `<p>Hits for <b>${d.dmg}</b> · drops <b>${d.gold}</b> gold${d.bengali ? ' · <small>from Bengali folklore</small>' : ''}</p></div>`;
    } else if (sel.kind === 'tree') {
      const t = sel.ref, inf = TREE_INFO[t.type];
      html += head(null, t.sacred ? 'Pavitra Van' : inf.name, t.sacred ? 'Sacred grove' : inf.en);
      if (t.sacred) html += '<div class="info-body"><p>These trees are never cut. Villagers without a Jhopdi hide here when demons come, where demons cannot find them.</p></div>';
      else html += `<div class="info-body"><p>${t.stump ? `A stump. Regrows in about ${t.regrow} day${t.regrow === 1 ? '' : 's'}.` : `<b>${t.wood}</b> wood left.`}</p><p><small>Lakadhara chop the trees nearest their camp first.</small></p></div>`;
    } else if (sel.kind === 'rock') {
      const r = sel.ref;
      html += head(this.icons.stone, 'Chattan', 'Boulder');
      html += `<div class="info-body"><p><b>${r.stone}</b> stone left. Khanik sometimes find gold inside.</p></div>`;
    } else if (sel.kind === 'loot') {
      const l = sel.ref;
      if (!s.loot.includes(l)) { this.select(null); return; }
      const L = LOOT[l.kind];
      html += head(this.icons[L.res], L.name, L.en);
      html += `<div class="info-body"><p>Worth <b>+${l.amt} ${RES[L.res].en.toLowerCase()}</b>, left by a defeated demon.</p><p><small>Idle villagers collect loot in daylight; anyone passing picks it up too.</small></p></div>`;
    } else if (sel.kind === 'animal') {
      const a = sel.ref;
      if (a.kind === 'cow') html += head(null, 'Gau Mata', 'The village cow') + '<div class="info-body"><p>She wanders the village and naps by the huts. Demons leave her alone.</p></div>';
      else html += head(null, 'Mor', 'Peacock') + '<div class="info-body"><p>A proud peacock at the edge of the forest. Now and then he dances.</p></div>';
    }
    if (html !== this.lastInfo) {
      box.innerHTML = html;
      this.lastInfo = html;
    }
    if (box.classList.contains('hidden') || this._infoFor !== sel.ref) {
      box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop'); // slide in when a new thing is selected
      this._infoFor = sel.ref;
    }
    box.classList.remove('hidden');
    document.body.classList.add('info-open'); // phones move the minimap / job list out of the panel's way
  },
  onInfoClick(ev) {
    const btn = ev.target.closest('button');
    if (!btn || !S) return;
    Sound.init();
    const sel = this.selected;
    switch (btn.dataset.action) {
      case 'close': this.select(null); return;
      case 'job': if (sel && sel.ref) {
        const job = btn.dataset.job, v = sel.ref;
        if (slotKey(job) !== slotKey(v.job) && usedSlots(S, job) >= jobSlots(S, job)) { toast(`No room — build a ${BUILDINGS[JOBS[job].building].name} first.`, 'danger'); sfx('error'); break; }
        setJob(S, v, job); sfx('click');
      } break;
      case 'equip': equipSoldier(S, btn.dataset.job, sel && sel.kind === 'villager' ? sel.ref : null); break;
      case 'disarm': if (sel && sel.ref) { setJob(S, sel.ref, 'warrior'); sfx('click'); } break;
      case 'craft': craftWeapon(S, btn.dataset.key, +btn.dataset.n || 1); break;
      case 'bupgrade': startUpgrade(S, sel.ref); break;
      case 'upfire': upgradeFire(S); break;
      case 'invite': inviteVillager(S); break;
      case 'assign': assignJob(S, btn.dataset.job); break;
      case 'bassign': assignToBuilding(S, sel.ref); break;
      case 'bremove': unassignFromBuilding(S, sel.ref); break;
      case 'upgrade': buyUpgrade(S, btn.dataset.key); break;
      case 'fortify': fortifyWall(S, sel.ref); break;
      case 'herbs': if (sel && sel.kind === 'villager') healWithHerbs(S, sel.ref); break;
      case 'holdback': if (sel && sel.kind === 'villager') { sel.ref.nishiCalls = 2; breakNishiSpell(S, sel.ref, 'you held them back'); sfx('bell'); } break;
      case 'recipe': if (sel && sel.kind === 'building') { sel.ref.recipe = btn.dataset.k; sfx('click'); } break;
      case 'mine': if (sel && sel.kind === 'building') {
        sel.ref.mine = btn.dataset.k;
        for (const v of S.villagers) if (v.workplace === sel.ref.id) v.target = null; // miners pick new boulders
        sfx('click');
      } break;
      case 'uphelp': if (sel && sel.kind === 'building') sendHelper(S, sel.ref); break;
      case 'upunhelp': if (sel && sel.kind === 'building') recallHelper(S, sel.ref); break;
      case 'bay': if (sel && sel.kind === 'building') { const i = +btn.dataset.i; this.bayPick = this.bayPick && this.bayPick.b === sel.ref.id && this.bayPick.i === i ? null : { b: sel.ref.id, i }; sfx('click'); } break;
      case 'bayset': if (sel && sel.kind === 'building') {
        const i = +btn.dataset.i, r = btn.dataset.r, b = sel.ref, was = storeBays(b)[i];
        if (r !== was) { setBay(S, b, i, r); toast(`Bay ${i + 1} of the Bhandar now holds ${RES[r].en.toLowerCase()}.`, 'info', 3); }
        this.bayPick = null; sfx('click');
      } break;
      case 'demolish': demolish(S, sel.ref); this.select(null); break;
    }
    this.lastInfo = '';
    this.refresh(true);
  },

  /* ---------- toasts ---------- */
  toast(msg, kind, dur) {
    if (!this.toastBox) return;
    const now = performance.now();
    if (this.lastToast[msg] && now - this.lastToast[msg] < 2500) return;
    this.lastToast[msg] = now;
    this.logPush(msg, kind);
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.innerHTML = svgIcon(TOAST_ICON[kind] || 'info');
    const t = document.createElement('span');
    t.textContent = msg;
    el.appendChild(t);
    const x = document.createElement('button');
    x.className = 'tx'; x.setAttribute('aria-label', 'Dismiss'); x.innerHTML = svgIcon('x');
    x.onclick = (ev) => { ev.stopPropagation(); el.classList.add('fade'); setTimeout(() => el.remove(), 250); };
    el.appendChild(x);
    this.toastBox.appendChild(el);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild.remove();
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 500); }, (dur || 4.5) * 1000);
  },
  clearToasts() { if (this.toastBox) this.toastBox.innerHTML = ''; },

  /* ---------- message history ---------- */
  history: [], unread: 0, logOpen: false,
  logPush(msg, kind) {
    const s = S;
    const ph = s ? phaseOf(s.t) : 'day';
    const when = s && !s.demo ? `Day ${s.day} · ${{ day: 'Day', dusk: 'Dusk', night: 'Night', dawn: 'Dawn' }[ph]}` : '';
    this.history.unshift({ msg, kind: kind || 'info', when });
    if (this.history.length > 120) this.history.length = 120;
    if (this.logOpen) this.renderLog(); else { this.unread++; this.updateLogBadge(); }
  },
  clearLog() { this.history = []; this.unread = 0; this.updateLogBadge(); if (this.logOpen) this.renderLog(); },
  updateLogBadge() {
    const b = $('btnLog');
    if (!b) return;
    let badge = b.querySelector('.badge');
    if (!badge) { badge = document.createElement('span'); badge.className = 'badge'; b.appendChild(badge); }
    badge.textContent = this.unread > 99 ? '99+' : String(this.unread);
    badge.classList.toggle('hidden', this.unread === 0);
    b.classList.toggle('on', this.logOpen);
  },
  renderLog() {
    const list = $('logList');
    if (!this.history.length) list.innerHTML = '<p class="log-empty">No messages yet. Warnings, tips and news from the village will collect here.</p>';
    else {
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      list.innerHTML = this.history.map((h) => `<div class="logrow ${h.kind}">${svgIcon(TOAST_ICON[h.kind] || 'info')}<div><p>${esc(h.msg)}</p>${h.when ? `<small>${h.when}</small>` : ''}</div></div>`).join('');
    }
    $('logCount').textContent = this.history.length ? `${this.history.length}` : '';
    $('logCount').classList.toggle('hidden', !this.history.length);
  },
  toggleLog(open) {
    this.logOpen = open == null ? !this.logOpen : open;
    $('logPanel').classList.toggle('hidden', !this.logOpen);
    document.body.classList.toggle('log-open', this.logOpen);
    if (this.logOpen) {
      if (document.body.classList.contains('mobile')) this.select(null); // one sheet at a time on phones
      this.unread = 0; this.renderLog();
      $('logPanel').classList.remove('pop'); void $('logPanel').offsetWidth; $('logPanel').classList.add('pop');
    }
    this.updateLogBadge();
  },

  /* ---------- HUD refresh ---------- */
  drawDial() {
    const c = $('dial'), x = c.getContext('2d');
    // a thin ring split into day / dusk / night / dawn, a dot for "now", and a sun or moon in the middle
    const W = c.width, cx = W / 2, r = W / 2 - 8, lw = 7;
    x.clearRect(0, 0, W, W);
    x.lineCap = 'butt';
    const A = (t) => -Math.PI / 2 + (t / DAY_LEN) * Math.PI * 2;
    const arc = (a, b, col) => { x.beginPath(); x.arc(cx, cx, r, A(a) + 0.03, A(b) - 0.03); x.strokeStyle = col; x.lineWidth = lw; x.stroke(); };
    arc(0, DUSK_T, 'rgba(134, 183, 216, 0.9)'); arc(DUSK_T, NIGHT_T, '#f29a3e'); arc(NIGHT_T, DAWN_T, 'rgba(143, 150, 232, 0.75)'); arc(DAWN_T, DAY_LEN, '#f2a98a');
    const ph = phaseOf(S.t);
    if (ph === 'night') { // crescent moon
      x.fillStyle = '#d9dcff'; x.beginPath(); x.arc(cx, cx, r * 0.42, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'destination-out'; x.beginPath(); x.arc(cx + r * 0.2, cx - r * 0.14, r * 0.36, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'source-over';
    } else { // sun, warmer toward dusk
      x.fillStyle = ph === 'dusk' ? '#f29a3e' : ph === 'dawn' ? '#f2a98a' : '#f4d27a';
      x.beginPath(); x.arc(cx, cx, r * 0.3, 0, Math.PI * 2); x.fill();
      x.strokeStyle = x.fillStyle; x.lineWidth = 3; x.lineCap = 'round';
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; x.beginPath(); x.moveTo(cx + Math.cos(a) * r * 0.45, cx + Math.sin(a) * r * 0.45); x.lineTo(cx + Math.cos(a) * r * 0.58, cx + Math.sin(a) * r * 0.58); x.stroke(); }
    }
    const a = A(S.t);
    x.fillStyle = '#fff'; x.strokeStyle = 'rgba(20, 14, 10, 0.9)'; x.lineWidth = 3;
    x.beginPath(); x.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 6, 0, Math.PI * 2); x.stroke(); x.fill();
  },
  refresh(force) {
    if (!S) return;
    const s = S;
    for (const k of RES_ORDER) {
      const el = document.querySelector(`.res[data-res="${k}"]`);
      const v = Math.floor(s.res[k]);
      this.resTarget = this.resTarget || {};
      this.resTarget[k] = v; // the number rolls toward this in frame()
      const p = this.prevRes[k];
      if (p != null && p !== v) {
        el.classList.remove('up', 'down');
        void el.offsetWidth;
        el.classList.add(v > p ? 'up' : 'down');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('up', 'down'), 450);
      }
      this.prevRes[k] = v;
      el.classList.toggle('low', (k === 'food' && v < s.villagers.length * 4) || (k === 'wood' && v < 6 && s.fire.fuel < fireLv(s).fuelMax * 0.4));
    }
    // materials appear once the village can make them (or has some); phones fold them into a dropdown
    const has = (t) => s.buildings.some((b) => b.type === t);
    const shown = {
      clay: has('claypit') || has('kiln') || s.res.clay >= 1,
      brick: true,
      charcoal: has('kiln') || s.res.charcoal >= 1,
      ore: s.fire.level >= 2 || s.res.ore >= 1,
      iron: s.fire.level >= 2 || has('smelter') || s.res.iron >= 1,
    };
    for (const r of MAT_RES) document.querySelector(`.res[data-res="${r}"]`).classList.toggle('hidden', !shown[r]);
    $('matBtn').querySelector('b').textContent = String(Math.floor(s.res.brick || 0));
    $('popRes').querySelector('b').textContent = `${s.villagers.length}/${housing(s)}`;
    const ph = phaseOf(s.t);
    $('dayText').textContent = `Day ${s.day}${s.weather === 'rain' ? ' · Rain' : ''}${s.festival ? ' · Diwali' : ''}`;
    const txt = ph === 'day' ? `Dusk in ${fmtTime(DUSK_T - s.t)}` : ph === 'dusk' ? `Demons in ${fmtTime(NIGHT_T - s.t)}` : ph === 'night' ? `Night · dawn in ${fmtTime(DAWN_T - s.t)}` : 'Dawn';
    $('phaseText').textContent = txt;
    const ck = $('clock').classList;
    ck.toggle('night', ph === 'night'); ck.toggle('dusk', ph === 'dusk');
    this.drawDial();
    this.updateJobs();
    this.updateCards();
    const boss = s.enemies.find((e) => e.type === 'boss');
    $('bossbar').classList.toggle('hidden', !boss);
    if (boss) $('bossbar').querySelector('i').style.width = (boss.hp / boss.maxHp) * 100 + '%';
    this.renderInfo();
    $('pausedTag').classList.toggle('hidden', !this.paused || !$('menu').classList.contains('hidden'));
    void force;
  },
  frame(dt) {
    // rolling resource counters
    if (this.resTarget) {
      this.resShown = this.resShown || {};
      for (const k of RES_ORDER) {
        const tgt = this.resTarget[k];
        if (tgt == null) continue;
        let cur = this.resShown[k] == null ? tgt : this.resShown[k];
        cur += (tgt - cur) * Math.min(1, dt * 9);
        if (Math.abs(tgt - cur) < 0.5) cur = tgt;
        this.resShown[k] = cur;
        const el = this._resEls ? this._resEls[k] : null;
        const b = el || (this._resEls = this._resEls || {}, this._resEls[k] = document.querySelector(`.res[data-res="${k}"] b`));
        const txt = String(Math.round(cur));
        if (b.textContent !== txt) b.textContent = txt;
      }
    }
    this.refreshT -= dt;
    if (this.refreshT <= 0) { this.refreshT = 0.15; this.refresh(); }
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 0.1; this.drawMinimap(); }
  },

  /* ---------- round top-down minimap ---------- */
  MM_SCALE: 60, // world units from the centre to the map edge
  mmBase(s) {
    const mm = $('minimap'), N = mm.width;
    const c = makeCanvas(N, N), x = c.getContext('2d');
    const img = x.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const wx = ((i + 0.5) / N - 0.5) * 2 * this.MM_SCALE, wz = ((j + 0.5) / N - 0.5) * 2 * this.MM_SCALE;
        const r = Math.hypot(wx, wz), edge = islandR(wx, wz);
        let col = [52, 140, 190];
        if (r < edge - 3) col = [96, 158, 70];
        else if (r < edge + 0.5) col = [226, 204, 150];
        const k = (j * N + i) * 4;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    x.fillStyle = 'rgba(30, 80, 35, 0.85)';
    for (const t of s.trees) { const p = this.mmPos(t.x, t.z, N); x.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    if (s.grove) {
      const p = this.mmPos(s.grove.x, s.grove.z, N), r = (s.grove.r / (2 * this.MM_SCALE)) * N;
      x.fillStyle = '#1d4d22'; x.beginPath(); x.arc(p[0], p[1], r + 1, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#b6ff8a'; x.lineWidth = 1.2; x.stroke();
    }
    this._mmBase = c;
    this._mmSeed = s.seed;
  },
  mmPos(wx, wz, N) { return [(wx / (2 * this.MM_SCALE) + 0.5) * N, (wz / (2 * this.MM_SCALE) + 0.5) * N]; },
  drawMinimap() {
    const s = S;
    if (!s || !R3.ok) return;
    const mm = $('minimap'), N = mm.width, x = mm.getContext('2d');
    if (!this._mmBase || this._mmSeed !== s.seed || this._mmTreeVer !== s.treeVer) { this.mmBase(s); this._mmTreeVer = s.treeVer; }
    x.clearRect(0, 0, N, N);
    x.save();
    x.beginPath(); x.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2); x.clip();
    x.drawImage(this._mmBase, 0, 0);
    const dark = darknessAt(s.t);
    if (dark > 0) { x.fillStyle = `rgba(10, 12, 40, ${dark * 0.45})`; x.fillRect(0, 0, N, N); }
    const k = N / (2 * this.MM_SCALE);
    x.strokeStyle = 'rgba(255, 153, 51, 0.95)'; x.lineWidth = 1.5;
    x.beginPath(); x.arc(N / 2, N / 2, territory(s) * k, 0, Math.PI * 2); x.stroke();
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type], p = this.mmPos(b.x, b.z, N);
      x.fillStyle = d.wall ? '#f4ecd8' : b.done ? '#e8b060' : '#b89060';
      x.fillRect(p[0] - (d.fw * k) / 2, p[1] - (d.fd * k) / 2, Math.max(1.5, d.fw * k), Math.max(1.5, d.fd * k));
    }
    x.fillStyle = '#ffd84a';
    x.beginPath(); x.arc(N / 2, N / 2, 2.6, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#7dff7d';
    for (const v of s.villagers) { if (v.inside) continue; const p = this.mmPos(v.x, v.z, N); x.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    x.fillStyle = '#fff176';
    for (const l of s.loot) { const p = this.mmPos(l.x, l.z, N); x.beginPath(); x.arc(p[0], p[1], 1.8, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#ff3b2f';
    for (const e of s.enemies) { const p = this.mmPos(e.x, e.z, N), r = ENEMIES[e.type].boss ? 3 : 1.6; x.fillRect(p[0] - r, p[1] - r, r * 2, r * 2); }
    // what the camera sees
    const corners = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([cx, cy]) => R3.groundAt(cx, cy));
    if (corners.every(Boolean)) {
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1;
      x.beginPath();
      corners.forEach((g, i) => { const p = this.mmPos(clamp(g.x, -200, 200), clamp(g.z, -200, 200), N); if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); });
      x.closePath(); x.stroke();
    }
    x.restore();
    x.fillStyle = '#fff'; x.font = 'bold 11px Mukta, sans-serif'; x.textAlign = 'center';
    x.fillText('N', N / 2, 11);
  },

  setSpeed(n) {
    this.speed = n;
    this.setPaused(false);
    document.querySelectorAll('.spd').forEach((b) => b.classList.toggle('active', +b.dataset.spd === n));
    const sb = $('btnSpeed');
    if (sb) sb.textContent = n + '×';
  },
  setPaused(p) {
    this.paused = p;
    this.setIcon($('btnPause'), p ? 'play' : 'pause');
    $('btnPause').classList.toggle('paused', p);
  },
  /* ---------- full screen (optional: some phones and app views do not allow it) ---------- */
  fsSupported() {
    const d = document.documentElement;
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled) && !!(d.requestFullscreen || d.webkitRequestFullscreen);
  },
  isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },
  toggleFullscreen() {
    const fail = () => toast('Full screen is not available in this browser.', 'warn', 3);
    try {
      if (this.isFull()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const el = document.documentElement;
      const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(fail);
    } catch (e) { fail(); }
  },
  syncFullscreen() {
    const ok = this.fsSupported(), full = this.isFull();
    for (const id of ['btnFull', 'mFull']) {
      const b = $(id);
      if (!b) continue;
      b.classList.toggle('hidden', !ok);
      b.dataset.label = id === 'mFull' ? (full ? 'Exit full screen' : 'Full screen') : '';
      this.setIcon(b, full ? 'shrink' : 'expand');
      b.dataset.tip = full ? 'Exit full screen' : 'Full screen';
    }
  },
  setJobsCollapsed(c) {
    const j = $('jobs');
    if (!j) return;
    j.classList.toggle('collapsed', c);
    this.setIcon($('jobsToggle'), c ? 'chevDown' : 'chevUp');
  },
  /** Reflect sound / music / graphics state in the menu's switches and segmented control. */
  syncMenu() {
    const sw = (el, on) => { if (el) { el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); } };
    sw($('mMusic'), !!Sound.musicOn);
    sw($('mSound'), !Sound.muted);
    document.querySelectorAll('#mGfx button').forEach((b) => b.classList.toggle('on', b.dataset.q === R3.quality));
    document.body.classList.toggle('lowgfx', R3.quality === 'low');
  },
  openMenu() {
    this.setPaused(true);
    this.syncMenu();
    $('menu').classList.remove('hidden');
  },
  closeMenu() { $('menu').classList.add('hidden'); this.setPaused(false); },

  wire() {
    $('info').addEventListener('pointerdown', (e) => { if (e.button === 0) this.onInfoClick(e); });
    $('btnPause').onclick = () => { Sound.init(); this.setPaused(!this.paused); };
    document.querySelectorAll('.spd').forEach((b) => (b.onclick = () => { Sound.init(); this.setSpeed(+b.dataset.spd); }));
    $('btnHome').onclick = () => R3.lookAt(0, 1);
    $('btnSound').onclick = () => { Sound.init(); Sound.setMuted(!Sound.muted); this.setIcon($('btnSound'), Sound.muted ? 'mute' : 'sound'); };
    $('btnMenu').onclick = () => this.openMenu();
    $('btnUiMinus').onclick = () => App.changeUIScale(-0.1);
    $('btnUiPlus').onclick = () => App.changeUIScale(0.1);
    $('mUiMinus').onclick = () => App.changeUIScale(-0.1);
    $('mUiPlus').onclick = () => App.changeUIScale(0.1);
    $('jobsToggle').onclick = (e) => { e.stopPropagation(); this.setJobsCollapsed(!$('jobs').classList.contains('collapsed')); };
    $('jobs').querySelector('.panel-head').onclick = () => { if (document.body.classList.contains('mobile')) this.setJobsCollapsed(!$('jobs').classList.contains('collapsed')); }; // a big tap target on phones
    $('btnBuild').onclick = () => { Sound.init(); this.toggleBuildTray(); sfx('click'); };
    $('btnRemove').onclick = () => { Sound.init(); this.setRemoveMode(!this.removeMode); sfx('click'); };
    $('btnSpeed').onclick = () => { Sound.init(); this.setSpeed(this.paused ? this.speed : (this.speed % 3) + 1); };
    $('btnLog').onclick = () => this.toggleLog();
    $('matBtn').onclick = (e) => { e.stopPropagation(); Sound.init(); document.body.classList.toggle('mat-open'); sfx('click'); };
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#matBtn, #matGroup')) document.body.classList.remove('mat-open'); });
    $('logClose').onclick = () => this.toggleLog(false);
    $('logClear').onclick = () => this.clearLog();
    this.updateLogBadge();
    $('btnFull').onclick = () => { Sound.init(); this.toggleFullscreen(); };
    $('mFull').onclick = () => this.toggleFullscreen();
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, () => { this.syncFullscreen(); setTimeout(() => { R3.resize(); App.fitUI(); }, 60); });
    this.syncFullscreen();
    $('mSound').onclick = () => { Sound.init(); Sound.setMuted(!Sound.muted); this.setIcon($('btnSound'), Sound.muted ? 'mute' : 'sound'); this.syncMenu(); };
    $('placeOk').onclick = () => this.confirmPlace(false);
    $('placeRot').onclick = () => this.rotateGhost();
    $('placeCancel').onclick = () => this.cancelBuild();
    $('mResume').onclick = () => this.closeMenu();
    $('mSave').onclick = () => { Game.save(); toast('Village saved.', 'good'); this.closeMenu(); };
    $('mMusic').onclick = () => { Sound.init(); Sound.setMusic(!Sound.musicOn); this.syncMenu(); };
    $('mGfx').onclick = (e) => { const b = e.target.closest('button'); if (b && b.dataset.q !== R3.quality) App.setQuality(b.dataset.q); };
    $('btnHowX').onclick = () => $('howto').classList.add('hidden');
    $('mHow').onclick = () => { $('howto').classList.remove('hidden'); };
    $('mQuit').onclick = () => { Game.save(); $('menu').classList.add('hidden'); App.showTitle(); };
    $('btnNew').onclick = () => App.startNew();
    $('btnContinue').onclick = () => App.continueGame();
    $('btnHow').onclick = () => { Sound.init(); $('howto').classList.remove('hidden'); };
    $('btnHowClose').onclick = () => $('howto').classList.add('hidden');
    $('oRetry').onclick = () => App.startNew();
    $('oTitle').onclick = () => App.showTitle();
    $('oContinue').onclick = () => { $('over').classList.add('hidden'); this.setPaused(false); };
    const mm = $('minimap');
    const jump = (ev) => {
      const r = mm.getBoundingClientRect();
      const fx = (ev.clientX - r.left) / r.width - 0.5, fz = (ev.clientY - r.top) / r.height - 0.5;
      R3.lookAt(fx * 2 * this.MM_SCALE, fz * 2 * this.MM_SCALE);
    };
    mm.addEventListener('pointerdown', (ev) => { jump(ev); mm.setPointerCapture(ev.pointerId); mm._drag = true; });
    mm.addEventListener('pointermove', (ev) => { if (mm._drag) jump(ev); });
    mm.addEventListener('pointerup', () => { mm._drag = false; });
  },

  statsHTML() {
    const st = S.stats;
    return `<div><b>${S.day}</b><span>Days</span></div><div><b>${st.killed}</b><span>Demons defeated</span></div><div><b>${st.maxPop}</b><span>Most villagers</span></div><div><b>${st.built}</b><span>Buildings raised</span></div>`;
  },
  gameOver(reason) {
    $('overDev').textContent = reason === 'fire' ? 'अग्नि बुझ गई' : 'गाँव सूना हो गया';
    $('overTitle').textContent = reason === 'fire' ? 'The Flame is Extinguished' : 'The Village Lies Empty';
    $('overText').textContent = reason === 'fire'
      ? `The demons smothered the sacred Agnikund on night ${S.day}. Without its light the village is lost.`
      : `No one is left to tend the Agnikund. The village fell on day ${S.day}.`;
    $('overStats').innerHTML = this.statsHTML();
    $('oContinue').classList.add('hidden');
    $('over').classList.remove('hidden');
  },
  victory() {
    this.setPaused(true);
    $('overDev').textContent = 'विजय!';
    $('overTitle').textContent = 'Victory';
    $('overText').textContent = `You kept the Agnikund burning for ${WIN_DAY} nights. Bards will sing of your village for generations. The demons will keep coming — will you keep the flame alive?`;
    $('overStats').innerHTML = this.statsHTML();
    $('oContinue').classList.remove('hidden');
    $('over').classList.remove('hidden');
    sfx('victory');
  },
};
