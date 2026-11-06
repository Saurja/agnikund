'use strict';
/* =========================================================
   Simulation on an open 2D map (x, z): villagers, jobs,
   grid buildings, demons from every side, day / night.
   The sacred Agnikund sits at (0, 0).
   ========================================================= */

let S = null; // the live game state
const SAVE_KEY = 'agnikund3d_save_v1';
const GRID = 128, GH = 64;
const GRAV3 = 12;
const V_SPEED = 2.4;

/* ---------- hooks to UI / audio (safe if absent) ---------- */
function toast(msg, kind, dur) { if (S && S.demo) return; if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg, kind, dur); }
function sfx(name, x, z) { if (S && S.demo) return; if (typeof Sound !== 'undefined' && Sound.play) Sound.play(name, x, z); }
function tip(id, msg) {
  if (!S || S.demo || S.tips[id]) return;
  S.tips[id] = 1;
  toast(msg, 'tip', 9);
}

/* ---------- geometry helpers ---------- */
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const distXZ = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
function islandR(x, z) { const a = Math.atan2(z, x); return 50 + 5 * Math.sin(3 * a + 1) + 3 * Math.sin(5 * a + 2) + 2 * Math.sin(7 * a); }
const COMPASS = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
function compassOf(x, z) { const a = Math.atan2(x, -z); return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }
function dirXZ(a) { return { x: Math.sin(a), z: -Math.cos(a) }; } // compass angle → unit vector (0 = north = -z)

/* ---------- state creation ---------- */
function newState(seed) {
  return {
    seed: seed || (Math.random() * 1e9) | 0,
    day: 1, t: 6, time: 0,
    res: { wood: 65, stone: 20, food: 45, gold: 10 },
    fire: { level: 1, hp: FIRE_LEVELS[1].hp, fuel: FIRE_LEVELS[1].fuelMax, dim: false, intensity: 1, hurtT: 0, feedT: 0 },
    villagers: [], buildings: [], trees: [], rocks: [], enemies: [],
    projectiles: [], particles: [], floaters: [], ambient: [], loot: [], armory: {},
    spawnQueue: [], fronts: [], upgrades: {}, nextId: 1,
    stats: { killed: 0, lost: 0, built: 0, maxPop: 0, bosses: 0 },
    weather: 'clear', festival: false, hungry: false,
    over: false, won: false, tips: {}, tipT: 0, defT: 0,
    grid: new Int32Array(GRID * GRID), bById: new Map(), treeVer: 1, rockVer: 1, buildVer: 1,
  };
}

function genWorld(s) {
  const rnd = mulberry32(s.seed);
  const pickW = (w) => { let tot = 0; for (const k in w) tot += w[k]; let r = rnd() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
  const step = 1.9;
  for (let gx = -60; gx <= 60; gx += step) {
    for (let gz = -60; gz <= 60; gz += step) {
      const x = gx + (rnd() - 0.5) * step * 0.9, z = gz + (rnd() - 0.5) * step * 0.9;
      const r = Math.hypot(x, z), edge = islandR(x, z) - 4.5;
      if (r < 5.5 || r > edge) continue;
      const meadow = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.7) + Math.sin(x * 0.05 - z * 0.07) * 0.6;
      let p = r < 9 ? 0.12 : r < 13 ? 0.28 : r < 18 ? 0.5 : 0.82;
      if (meadow > 0.7 && r < 34) p *= 0.2;
      if (rnd() > p) continue;
      const beach = r > edge - 5;
      const type = beach ? pickW({ palm: 6, neem: 1 }) : r < 20 ? pickW({ mango: 3, neem: 3, palm: 3, banyan: 1 }) : pickW({ palm: 2, banyan: 2, neem: 3, mango: 2 });
      s.trees.push(makeTree(s, x, z, type, Math.floor(rnd() * 3), rnd));
    }
  }
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2, r = (i < 6 ? 6 : 9) + rnd() * (i < 6 ? 4 : 36);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (r > islandR(x, z) - 6) continue;
    s.trees = s.trees.filter((t) => distXZ(t.x, t.z, x, z) > 1.3);
    s.rocks.push(makeRock(s, x, z, Math.floor(rnd() * 8), 36 + Math.floor(rnd() * 40), rnd));
  }
  // Pavitra Van — the sacred grove where homeless villagers hide from demons
  const ga = rnd() * Math.PI * 2, gd = 17;
  const grove = (s.grove = { x: Math.cos(ga) * gd, z: Math.sin(ga) * gd, r: 4.2 });
  s.trees = s.trees.filter((t) => distXZ(t.x, t.z, grove.x, grove.z) > grove.r + 1.2);
  s.rocks = s.rocks.filter((r) => distXZ(r.x, r.z, grove.x, grove.z) > grove.r + 1.5);
  [[1.5, 6, 'banyan'], [2.6, 11, 'neem'], [3.7, 16, 'mango']].forEach(([rr, n, type], k) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.4 + rnd() * 0.2;
      const t = makeTree(s, grove.x + Math.cos(a) * rr, grove.z + Math.sin(a) * rr, k === 0 ? 'banyan' : rnd() < 0.5 ? type : 'neem', Math.floor(rnd() * 3), rnd);
      t.sacred = true;
      t.scale *= 1.15;
      s.trees.push(t);
    }
  });
  s.ambient.push({ kind: 'cow', x: -4, z: 5, rot: 0, t: 0, tx: -4, tz: 5, sit: false });
  s.ambient.push({ kind: 'cow', x: 5, z: -4, rot: 2, t: 3, tx: 5, tz: -4, sit: false });
  s.ambient.push({ kind: 'peacock', x: 15, z: 8, rot: 0, t: 0, tx: 15, tz: 8, fan: 0 });
}
function makeTree(s, x, z, type, variant, rnd) {
  const info = TREE_INFO[type];
  const r = rnd || Math.random;
  return { id: s.nextId++, x, z, type, variant, wood: info.wood, maxWood: info.wood, stump: false, regrow: 0, shake: 0, rot: r() * Math.PI * 2, scale: 0.85 + r() * 0.35 };
}
function makeRock(s, x, z, variant, stone, rnd) {
  const r = rnd || Math.random;
  return { id: s.nextId++, x, z, variant, stone, maxStone: stone, rot: r() * Math.PI * 2, scale: 0.9 + r() * 0.5 };
}
function makeVillager(s, x, z, g) {
  const look = makeLook(g);
  const pool = look.g === 'm' ? NAMES_M : NAMES_F;
  const used = new Set(s.villagers.map((v) => v.name));
  let name = pick(pool);
  for (let i = 0; i < 20 && used.has(name); i++) name = pick(pool);
  return Object.assign(makeVillagerRaw(), { id: s.nextId++, name, look, x, z, rot: Math.atan2(-x, -z), job: 'idle', hp: 40, maxHp: 40, wx: x, wz: z });
}
function makeVillagerRaw() {
  return { home: null, inside: false, shelter: null, fearT: 0, scanT: 0, scared: false, rot: 0, target: null, task: '', anim: 'stand', animT: Math.random() * 2, workT: 0, atkCd: 0, hurtT: 0, combatT: 0, arriving: false, ax: 0, az: 0, wx: 0, wz: 0, wanderT: 0, idleSit: false, front: 0, slot: 0, seat: { x: 0, z: 0 }, offerT: 0, carry: null, carryAmt: 0, gold: 0, retreat: false, thinkT: 0, foe: null };
}

/* ---------- queries ---------- */
const fireLv = (s) => FIRE_LEVELS[s.fire.level];
const territory = (s) => fireLv(s).radius;
const getB = (s, id) => s.bById.get(id);
function housing(s) {
  let h = fireLv(s).housing;
  for (const b of s.buildings) if (b.done && BUILDINGS[b.type].housing) h += BUILDINGS[b.type].housing;
  return h;
}
function canAfford(s, cost) { for (const k in cost) if ((s.res[k] || 0) < cost[k]) return false; return true; }
/** Pay a cost. Goods are taken from the stockpiles nearest to (x, z) — the build site — or nearest the Agnikund. */
function spend(s, cost, x, z) { for (const k in cost) { s.res[k] -= cost[k]; takeStock(s, k, cost[k], x || 0, z || 0); } }
function refund(s, cost, f) { for (const k in cost) s.res[k] += Math.floor(cost[k] * f); }
function floater(s, x, y, z, text, color) { s.floaters.push({ x, y, z, text, color, life: 1.5 }); }
function addRes(s, k, n, x, z, y) {
  if (n <= 0) return;
  s.res[k] += n;
  if (x != null) floater(s, x, y || 1.6, z, '+' + n, RES[k].color);
}

/* ---------- stockpiles: each drop point holds its own share of the village goods ----------
   s.res stays the village total; b.stock / s.fireStock say where those goods physically lie.
   syncStock() keeps the two in step, so any gain without a place goes to the Agnikund heap
   and anything eaten or burned comes out of the heap first, then the nearest stockpile. */
const carryCap = (s, r) => (r === 'food' && s.upgrades.plough ? 8 : CARRY_CAP[r] || 5);
function stockCap(b, r) { if (!b) return Infinity; const c = STOCK_CAP[b.type]; return (c && c[r]) || 0; }
function stockOf(s, b) { if (!b) return s.fireStock || (s.fireStock = {}); return b.stock || (b.stock = {}); }
function stockFree(b, r) { return stockCap(b, r) - ((b && b.stock && b.stock[r]) || 0); }
/** Every place holding a good: the Agnikund heap first, then finished stockpile buildings. */
function stockpiles(s, r) {
  const out = [{ b: null, x: FIRE_HEAP[r].x, z: FIRE_HEAP[r].z }];
  for (const b of s.buildings) { const d = BUILDINGS[b.type]; if (b.done && d.drop && d.drop.includes(r)) out.push({ b, x: b.x, z: b.z }); }
  return out;
}
/** Put goods into one stockpile; whatever does not fit spills onto the Agnikund heap. */
function putStock(s, b, r, n) {
  if (n <= 0) return;
  const st = stockOf(s, b), fit = b ? Math.max(0, Math.min(n, stockFree(b, r))) : n;
  st[r] = (st[r] || 0) + fit;
  if (n - fit > 0) { const f = stockOf(s, null); f[r] = (f[r] || 0) + (n - fit); }
}
function takeStock(s, r, n, x, z) {
  if (n <= 0) return;
  const list = stockpiles(s, r).sort((a, c) => distXZ(a.x, a.z, x, z) - distXZ(c.x, c.z, x, z));
  for (const p of list) {
    if (n <= 0) break;
    const st = stockOf(s, p.b), have = st[r] || 0, t = Math.min(have, n);
    st[r] = have - t; n -= t;
  }
}
function syncStock(s) {
  for (const r of RES_ORDER) {
    let sum = 0;
    for (const p of stockpiles(s, r)) sum += stockOf(s, p.b)[r] || 0;
    const diff = (s.res[r] || 0) - sum;
    if (diff > 1e-6) { const f = stockOf(s, null); f[r] = (f[r] || 0) + diff; }
    else if (diff < -1e-6) takeStock(s, r, -diff, 0, 0);
  }
}
/** What a stockpile holds, for the UI: [{ r, n, cap }] for every good it takes. */
function stockList(s, b) {
  const goods = b ? BUILDINGS[b.type].drop || [] : RES_ORDER;
  const st = stockOf(s, b);
  return goods.map((r) => ({ r, n: Math.floor(st[r] || 0), cap: b ? stockCap(b, r) : Infinity }));
}
const isDefender = (v) => slotKey(v.job) === 'army';
const isMelee = (v) => isDefender(v) && v.job !== 'archer';
function jobCount(s, job) { let n = 0; for (const v of s.villagers) if (v.job === job) n++; return n; }
/** Total places for a job (soldiers of every kind share the same 'army' places). */
function jobSlots(s, job) {
  if (job === 'idle') return Infinity;
  let n = AGNI_SLOTS[slotKey(job)] || 0;
  for (const b of s.buildings) n += bSlots(b, job);
  return n;
}
function usedSlots(s, job) { const k = slotKey(job); let n = 0; for (const v of s.villagers) if (slotKey(v.job) === k) n++; return n; }
/** Work places a finished building offers for a job. */
function bSlots(b, job) { const sl = BUILDINGS[b.type].slots; return b.done && sl ? sl[slotKey(job)] || 0 : 0; }
function workersAt(s, b, job, except) { const k = slotKey(job); let n = 0; for (const o of s.villagers) if (o !== except && slotKey(o.job) === k && o.workplace === b.id) n++; return n; }
const bLevel = (b) => b.level || 1;
/** What resources are still missing for a cost, e.g. "20 wood, 5 gold" ('' when affordable). */
function missingText(s, cost) {
  return Object.keys(cost).filter((k) => (s.res[k] || 0) < cost[k]).map((k) => `${Math.ceil(cost[k] - (s.res[k] || 0))} ${RES[k].en.toLowerCase()}`).join(', ');
}
function notAfford(s, cost, what) {
  toast(`Can't ${what} — you still need ${missingText(s, cost)}.`, 'danger', 5);
  sfx('error');
}
function idleVillagers(s) { return s.villagers.filter((v) => v.job === 'idle' && !v.arriving); }
function scorchRadius(s) { return (3.2 + s.fire.level * 0.5) * (s.fire.dim ? 0.6 : 1); }

function nearestEnemy(s, x, z, range, groundOnly) {
  let best = null, bd = range;
  for (const e of s.enemies) {
    if (e.dead) continue;
    if (groundOnly && ENEMIES[e.type].fly && e.y > 1.2) continue;
    const d = distXZ(e.x, e.z, x, z) - ENEMIES[e.type].r;
    if (d <= bd) { bd = d; best = e; }
  }
  return best;
}
function nearestVillager(s, x, z, range) {
  let best = null, bd = range;
  const R = territory(s);
  for (const v of s.villagers) {
    if (v.inside) continue; // hiding in a hut or the sacred grove
    if (v.arriving && Math.hypot(v.x, v.z) > R + 3) continue;
    const d = distXZ(v.x, v.z, x, z);
    if (d <= bd) { bd = d; best = v; }
  }
  return best;
}

/* ---------- building grid ---------- */
function cellIdx(cx, cz) { if (cx < -GH || cx >= GH || cz < -GH || cz >= GH) return -1; return (cz + GH) * GRID + (cx + GH); }
function buildingAtPoint(s, x, z) { const i = cellIdx(Math.floor(x), Math.floor(z)); if (i < 0) return null; const id = s.grid[i]; return id ? s.bById.get(id) || null : null; }
function markBuilding(s, b, on) {
  const d = BUILDINGS[b.type];
  for (let i = 0; i < d.fw; i++) for (let j = 0; j < d.fd; j++) { const k = cellIdx(b.cx + i, b.cz + j); if (k >= 0) s.grid[k] = on ? b.id : 0; }
}
function addBuilding(s, b) { s.buildings.push(b); s.bById.set(b.id, b); markBuilding(s, b, true); s.buildVer++; }
function removeBuilding(s, b) {
  const i = s.buildings.indexOf(b);
  if (i < 0) return false;
  s.buildings.splice(i, 1);
  s.bById.delete(b.id);
  markBuilding(s, b, false);
  s.buildVer++;
  for (const v of s.villagers) { // anyone hiding inside has to get out
    if (v.home !== b.id) continue;
    v.home = null;
    if (v.inside && v.shelter === 'home') { v.inside = false; v.shelter = null; v.x = b.x + rand(-0.5, 0.5); v.z = b.z + rand(-0.5, 0.5); v.fearT = 5; }
  }
  return true;
}
function rebuildGrid(s) {
  s.grid.fill(0);
  s.bById.clear();
  for (const b of s.buildings) { s.bById.set(b.id, b); markBuilding(s, b, true); }
}
function faceFireRot(x, z) { const a = Math.atan2(-x, -z); return Math.round(a / (Math.PI / 2)) * (Math.PI / 2); }
/** Point on the building's rectangle edge nearest to (x, z), pushed out by pad. */
function edgePoint(b, x, z, pad) {
  const d = BUILDINGS[b.type];
  const hw = d.fw / 2 + pad, hd = d.fd / 2 + pad;
  let dx = x - b.x, dz = z - b.z;
  if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) dx = 1;
  const k = Math.min(hw / Math.max(0.001, Math.abs(dx)), hd / Math.max(0.001, Math.abs(dz)));
  return { x: b.x + dx * k, z: b.z + dz * k };
}
function distToBuilding(b, x, z) {
  const d = BUILDINGS[b.type];
  const dx = Math.max(0, Math.abs(x - b.x) - d.fw / 2), dz = Math.max(0, Math.abs(z - b.z) - d.fd / 2);
  return Math.hypot(dx, dz);
}
function localToWorld(b, lx, lz) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

/* ---------- player actions ---------- */
function setJob(s, v, job) {
  if (v.carryAmt > 0) deliver(s, v);
  const old = JOBS[v.job];
  if (old && old.weapon && v.job !== job) s.armory[old.weapon] = (s.armory[old.weapon] || 0) + 1; // the weapon goes back to the armoury
  v.job = job; v.target = null; v.workplace = null; v.workT = 0; v.foe = null;
  const st = SOLDIERS[job];
  const newMax = st ? st.hp + (job === 'warrior' && s.upgrades.talwar ? 30 : 0) : 40;
  v.hp = Math.min(newMax, v.hp + Math.max(0, newMax - v.maxHp));
  v.maxHp = newMax;
}
function assignJob(s, job) {
  const J = JOBS[job];
  if (J.weapon) return equipSoldier(s, job);
  if (usedSlots(s, job) >= jobSlots(s, job)) {
    toast(`Build a ${BUILDINGS[J.building].name} (${BUILDINGS[J.building].en}) to make room for more ${J.name}.`, 'warn');
    return false;
  }
  const idle = idleVillagers(s);
  if (!idle.length) { toast('No idle villagers. Build Jhopdis so more people come.', 'warn'); return false; }
  idle.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  setJob(s, idle[0], job);
  sfx('click');
  return true;
}
/** Hand a crafted weapon to a Sainik, turning them into a special soldier. */
function equipSoldier(s, job, v) {
  const J = JOBS[job], W = WEAPONS[J.weapon];
  if (!(s.armory[J.weapon] > 0)) {
    const at = BUILDINGS[W.at];
    toast(`No ${W.name} (${W.en}) in the armoury. Craft one at the ${at.name}${W.lvl > 1 ? ` (level ${W.lvl})` : ''} first.`, 'danger', 5);
    sfx('error');
    return false;
  }
  if (!v) {
    const list = s.villagers.filter((o) => o.job === 'warrior');
    if (!list.length) { toast(`Train a Sainik at the Akhara first, then hand them the ${W.name}.`, 'danger', 5); sfx('error'); return false; }
    v = list[0];
  }
  if (v.job !== 'warrior') { toast(`Only a Sainik (foot soldier) can take up a ${W.name}.`, 'warn'); return false; }
  s.armory[J.weapon]--;
  setJob(s, v, job);
  toast(`${v.name} takes up the ${W.name} and becomes a ${J.name} (${J.en})!`, 'good');
  sfx('anvil', v.x, v.z);
  emit(s, v.x, 1.0, v.z, 12, { spread: 0.3, vx: 1, vyMin: 1, vyMax: 2.5, life: 0.9, colors: ['#ffe066', '#fff3b0', '#ffcc33'], g: -0.5, add: true });
  return true;
}
function unassignJob(s, job) {
  const list = s.villagers.filter((v) => v.job === job);
  if (!list.length) return false;
  setJob(s, list[list.length - 1], JOBS[job].weapon ? 'warrior' : 'idle'); // special soldiers step back down to Sainik
  sfx('click');
  return true;
}
/** Is there a finished workshop able to craft this weapon? */
function weaponReady(s, key) {
  const W = WEAPONS[key];
  return s.buildings.some((x) => x.type === W.at && x.done && bLevel(x) >= W.lvl);
}
/** Craft weapons at the Lohar or Aara Mill into the armoury. */
function craftWeapon(s, key, n) {
  const W = WEAPONS[key];
  const b = s.buildings.find((x) => x.type === W.at && x.done && bLevel(x) >= W.lvl);
  if (!b) return 0;
  if (!canAfford(s, W.cost)) { notAfford(s, W.cost, `craft a ${W.name}`); return 0; }
  let made = 0;
  for (let i = 0; i < (n || 1) && canAfford(s, W.cost); i++) { spend(s, W.cost, b.x, b.z); made++; }
  s.armory[key] = (s.armory[key] || 0) + made;
  floater(s, b.x, 2.6, b.z, '+' + made, '#ffe0a0');
  sfx(W.at === 'forge' ? 'anvil' : 'saw', b.x, b.z);
  emit(s, b.x, 1.2, b.z, 10, { spread: 0.5, vx: 1.2, vyMin: 1, vyMax: 3, life: 0.6, colors: W.at === 'forge' ? ['#ffcc33', '#ff8a1f', '#fff3b0'] : ['#e8c896', '#c89a5e'], g: 6, add: W.at === 'forge' });
  tip('equip', `${W.name} ready! In Kaam, press + next to ${JOBS[W.job].name} to hand it to a Sainik.`);
  return made;
}
/** Upgrade the Lohar or Aara Mill to its next level (a Mistri does the work). */
function startUpgrade(s, b) {
  const def = BUILDINGS[b.type];
  const L = def.levels && def.levels[bLevel(b) + 1];
  if (!L || b.upgrading || !b.done) return false;
  if (!canAfford(s, L.cost)) { notAfford(s, L.cost, `upgrade the ${def.name}`); return false; }
  spend(s, L.cost, b.x, b.z);
  b.upgrading = true;
  b.upProg = 0;
  toast(`Upgrading the ${def.name} to level ${bLevel(b) + 1}. A Mistri will build it.`, 'info');
  sfx('place', b.x, b.z);
  if (jobCount(s, 'build') === 0) toast('You have no Mistri (builder) — assign one or the upgrade will never finish!', 'danger', 6);
  return true;
}
function finishUpgrade(s, b) {
  const def = BUILDINGS[b.type];
  const L = def.levels[bLevel(b) + 1];
  b.level = bLevel(b) + 1;
  b.upgrading = false;
  b.popT = 0.6;
  s.buildVer++;
  toast(`The ${def.name} is now level ${b.level}! Unlocked: ${L.unlocks}.`, 'good', 7);
  sfx('upgrade', b.x, b.z);
  emit(s, b.x, def.ht * 0.6, b.z, 20, { spread: def.fw / 2, spreadY: def.ht / 3, vx: 0.8, vyMin: 0.5, vyMax: 2, life: 1.2, colors: ['#ffcc33', '#ff9933', '#fff3b0'], g: -0.5, add: true });
}
function canPlace(s, type, cx, cz, ignoreCost) {
  const def = BUILDINGS[type];
  if (def.lvl > s.fire.level) return { ok: false, why: 'Needs Agnikund level ' + def.lvl };
  const R = territory(s);
  const fireClear = 2.7 + s.fire.level * 0.12;
  for (let i = 0; i < def.fw; i++) {
    for (let j = 0; j < def.fd; j++) {
      const px = cx + i + 0.5, pz = cz + j + 0.5, r = Math.hypot(px, pz);
      if (r > R - 0.3) return { ok: false, why: 'Outside village land — upgrade the Agnikund for more' };
      if (r < fireClear) return { ok: false, why: 'Too close to the Agnikund' };
      if (s.grove && distXZ(px, pz, s.grove.x, s.grove.z) < s.grove.r + 0.9) return { ok: false, why: 'This is the Pavitra Van — the sacred grove cannot be built on' };
      const k = cellIdx(cx + i, cz + j);
      if (k < 0) return { ok: false, why: 'Out of bounds' };
      if (s.grid[k]) return { ok: false, why: 'Something is already built here' };
    }
  }
  if (!ignoreCost && !canAfford(s, def.cost)) return { ok: false, why: 'Not enough resources', afford: false };
  return { ok: true };
}
function clearFootprint(s, type, cx, cz) {
  const def = BUILDINGS[type];
  const x0 = cx - 0.45, x1 = cx + def.fw + 0.45, z0 = cz - 0.45, z1 = cz + def.fd + 0.45;
  let wood = 0, stone = 0, tc = false, rc = false;
  s.trees = s.trees.filter((t) => { if (t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1) { if (!t.stump) wood += Math.floor(t.wood * 0.5); tc = true; return false; } return true; });
  s.rocks = s.rocks.filter((r) => { if (r.x > x0 - 0.3 && r.x < x1 + 0.3 && r.z > z0 - 0.3 && r.z < z1 + 0.3) { stone += Math.floor(r.stone * 0.5); rc = true; return false; } return true; });
  const c = bCenterOf(type, cx, cz);
  if (wood) addRes(s, 'wood', wood, c.x, c.z);
  if (stone) addRes(s, 'stone', stone, c.x, c.z, 2.2);
  if (tc) s.treeVer++;
  if (rc) s.rockVer++;
}
function bCenterOf(type, cx, cz) { const d = BUILDINGS[type]; return { x: cx + d.fw / 2, z: cz + d.fd / 2 }; }
function placeBuilding(s, type, cx, cz, rot, quiet) {
  const chk = canPlace(s, type, cx, cz);
  if (!chk.ok) {
    if (!quiet) { if (chk.afford === false) notAfford(s, BUILDINGS[type].cost, `build a ${BUILDINGS[type].name}`); else { toast(chk.why, 'warn'); sfx('error'); } }
    return null;
  }
  const def = BUILDINGS[type];
  const c = bCenterOf(type, cx, cz);
  spend(s, def.cost, c.x, c.z);
  clearFootprint(s, type, cx, cz);
  const autoRot = def.fw !== def.fd ? (c.z > 0 ? Math.PI : 0) : faceFireRot(c.x, c.z); // long buildings only turn 180°
  const b = { id: s.nextId++, type, cx, cz, x: c.x, z: c.z, rot: rot != null ? rot : autoRot, done: false, progress: 0, hp: 1, maxHp: def.hp, grow: 0, cd: 0, offerT: 0 };
  addBuilding(s, b);
  emit(s, c.x, 0.2, c.z, 10, { spread: def.fw / 2, vx: 1.2, vyMin: 1, vyMax: 3, life: 0.8, colors: ['#c8a46a', '#a77c4b', '#e0bf88'], g: 6 });
  if (!quiet) sfx('place', c.x, c.z);
  if (jobCount(s, 'build') === 0) tip('needBuilder', 'Construction sites need a Mistri (builder). Assign one in the Kaam panel.');
  return b;
}
/** Cells on a straight line between two cells (for dragging walls). */
function lineCells(c0x, c0z, c1x, c1z) {
  const out = [];
  const n = Math.max(Math.abs(c1x - c0x), Math.abs(c1z - c0z));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    const cx = Math.round(c0x + (c1x - c0x) * t), cz = Math.round(c0z + (c1z - c0z) * t);
    if (!out.length || out[out.length - 1][0] !== cx || out[out.length - 1][1] !== cz) out.push([cx, cz]);
  }
  return out;
}
function placeWallLine(s, type, cells, rot) {
  let n = 0, skipped = 0, poor = false;
  for (const [cx, cz] of cells) {
    if (!canAfford(s, BUILDINGS[type].cost)) { poor = true; break; }
    if (placeBuilding(s, type, cx, cz, rot, true)) n++; else skipped++;
  }
  if (n) sfx('place');
  if (poor) toast(`Ran out of resources after ${n} wall pieces.`, 'warn');
  else if (!n) { toast('Walls cannot go there.', 'warn'); sfx('error'); }
  return n;
}
function demolish(s, b) {
  const def = BUILDINGS[b.type];
  refund(s, def.cost, b.done ? 0.5 : 0.9);
  removeBuilding(s, b);
  emit(s, b.x, 0.5, b.z, 16, { spread: def.fw / 2, vx: 2, vyMin: 1, vyMax: 4, life: 0.9, colors: ['#8a8a8a', '#a77c4b', '#6b4a2e'], g: 9 });
  sfx('thud', b.x, b.z);
  fixJobOverflow(s);
}
function fixJobOverflow(s) {
  for (const job of JOB_ORDER) {
    const slots = jobSlots(s, job);
    let n = usedSlots(s, job);
    if (n > slots) {
      const list = s.villagers.filter((v) => v.job === job);
      if (!list.length) continue;
      while (n > slots && list.length) { setJob(s, list.pop(), 'idle'); n--; }
      toast(`Some ${JOBS[job].name} lost their workplace and are now idle.`, 'warn');
    }
  }
  for (const v of s.villagers) if (v.workplace && !getB(s, v.workplace)) v.workplace = null;
}
function upgradeFire(s) {
  const lv = s.fire.level;
  if (lv >= 5) return false;
  const next = FIRE_LEVELS[lv + 1];
  if (!canAfford(s, next.cost)) { notAfford(s, next.cost, 'upgrade the Agnikund'); return false; }
  spend(s, next.cost);
  s.fire.level++;
  s.fire.hp = next.hp;
  s.fire.fuel = next.fuelMax;
  emit(s, 0, 1.2, 0, 60, { spread: 0.8, vx: 3, vyMin: 3, vyMax: 9, life: 1.6, colors: ['#ffcc33', '#ff8a1f', '#fff3b0', '#ff5a1a'], g: -1, add: true });
  const newB = BUILD_ORDER.filter((t) => BUILDINGS[t].lvl === s.fire.level);
  const newJ = JOB_ORDER.filter((j) => newB.includes(JOBS[j].building));
  toast(`The Agnikund roars to level ${s.fire.level}! The village land grows.${newB.length ? ' Unlocked: ' + newB.map((t) => BUILDINGS[t].name).join(', ') + '.' : ''}${newJ.length ? ' New jobs: ' + newJ.map((j) => JOBS[j].name).join(', ') + '.' : ''}`, 'good', 9);
  sfx('upgrade');
  if (s.fire.level >= 4 && s.ambient.filter((a) => a.kind === 'cow').length < 4) s.ambient.push({ kind: 'cow', x: 6, z: 6, rot: 0, t: 0, tx: 6, tz: 6, sit: false });
  return true;
}
const INVITE_COST = { food: 15, gold: 5 };
function inviteVillager(s) {
  if (s.villagers.length >= housing(s)) { toast('No room! Build a Jhopdi first.', 'warn'); sfx('error'); return false; }
  if (!canAfford(s, INVITE_COST)) { notAfford(s, INVITE_COST, 'invite a traveller'); return false; }
  spend(s, INVITE_COST);
  const v = spawnTraveller(s, 0);
  toast(`${v.name} accepted your invitation and is walking to the village.`, 'good');
  sfx('chime');
  return true;
}
function spawnTraveller(s, i) {
  const a = Math.random() * Math.PI * 2;
  const r = territory(s) + 4 + i;
  const v = makeVillager(s, Math.cos(a) * r, Math.sin(a) * r);
  v.arriving = true;
  v.ax = Math.cos(a) * rand(3.5, 6); v.az = Math.sin(a) * rand(3.5, 6);
  s.villagers.push(v);
  return v;
}
function buyUpgrade(s, key) {
  if (s.upgrades[key]) return false;
  const u = UPGRADES[key];
  if (!s.buildings.some((b) => b.type === u.at && b.done && bLevel(b) >= u.lvl)) {
    toast(`Needs a ${BUILDINGS[u.at].name} at level ${u.lvl}.`, 'danger'); sfx('error'); return false;
  }
  if (!canAfford(s, u.cost)) { notAfford(s, u.cost, `make ${u.name}`); return false; }
  spend(s, u.cost);
  s.upgrades[key] = true;
  if (key === 'talwar') for (const v of s.villagers) if (v.job === 'warrior') { v.maxHp += 30; v.hp += 30; }
  toast(`The ${BUILDINGS[u.at].name} made ${u.name} (${u.en})! ${u.desc}`, 'good');
  sfx(u.at === 'forge' ? 'anvil' : 'saw');
  return true;
}
const STONE_WALL_COST = { stone: 12 };
function fortifyWall(s, b) {
  if (b.type !== 'palisade' || s.fire.level < 3) return false;
  if (!canAfford(s, STONE_WALL_COST)) { toast('Needs 12 stone.', 'warn'); sfx('error'); return false; }
  spend(s, STONE_WALL_COST, b.x, b.z);
  b.type = 'wall'; b.done = false; b.progress = 0; b.maxHp = BUILDINGS.wall.hp; b.hp = Math.max(1, b.hp);
  s.buildVer++;
  sfx('place', b.x, b.z);
  return true;
}
/** Fortify every bamboo wall at once. */
function fortifyAll(s) {
  let n = 0;
  for (const b of s.buildings) if (b.type === 'palisade' && b.done && canAfford(s, STONE_WALL_COST)) { spend(s, STONE_WALL_COST, b.x, b.z); b.type = 'wall'; b.done = false; b.progress = 0; b.maxHp = BUILDINGS.wall.hp; n++; }
  if (n) { s.buildVer++; sfx('place'); toast(`${n} bamboo walls will be rebuilt in stone.`, 'good'); }
  return n;
}

/* ---------- particles ---------- */
function emit(s, x, y, z, n, o) {
  if (s.particles.length > 900) return;
  for (let i = 0; i < n; i++) {
    const life = rand(o.life * 0.6, o.life);
    const sp = o.spread || 0;
    s.particles.push({
      x: x + rand(-sp, sp), y: y + rand(-(o.spreadY || 0), o.spreadY || 0), z: z + rand(-sp, sp),
      vx: rand(-(o.vx || 0), o.vx || 0) + (o.bx || 0), vy: rand(o.vyMin || 0, o.vyMax || 0), vz: rand(-(o.vx || 0), o.vx || 0),
      life, max: life, color: pick(o.colors), g: o.g || 0, add: !!o.add,
    });
  }
}
const emitChips = (s, x, y, z, c) => emit(s, x, y, z, 4, { spread: 0.15, vx: 1.6, vyMin: 1.5, vyMax: 3.5, life: 0.6, colors: [c, shade(c, -0.2)], g: 12 });
function emitFire(s, x, y, z) { emit(s, x, y, z, 1, { spread: 0.15, vx: 0.4, vyMin: 1, vyMax: 2.5, life: 0.7, colors: ['#ff8a1f', '#ffcc33', '#d8361c'], g: -0.4, add: true }); }

/* ---------- delivering ---------- */
/** Empty the tokri. With a drop point the goods land on that stockpile; otherwise on the Agnikund heap. */
function deliver(s, v, d) {
  const b = d && d.b && getB(s, d.b.id) ? d.b : null;
  if (v.carryAmt > 0 && v.carry) {
    addRes(s, v.carry, v.carryAmt, v.x, v.z);
    if (d) putStock(s, b, v.carry, v.carryAmt);
    if (b) b.stockPop = 0.35;
  }
  if (v.gold > 0) {
    addRes(s, 'gold', v.gold, v.x, v.z, 2.1); sfx('coin', v.x, v.z);
    if (d) putStock(s, b && BUILDINGS[b.type].drop.includes('gold') ? b : null, 'gold', v.gold);
  }
  v.carryAmt = 0; v.carry = null; v.gold = 0;
}

/* ---------- movement ---------- */
function moveTo(v, tx, tz, spd, dt) {
  const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
  if (d <= spd * dt + 0.01) { v.x = tx; v.z = tz; v.anim = 'stand'; return true; }
  v.x += (dx / d) * spd * dt;
  v.z += (dz / d) * spd * dt;
  // walk around the Agnikund, never through it
  const r = Math.hypot(v.x, v.z), keep = 1.75;
  if (r < keep && Math.hypot(tx, tz) >= keep - 0.05) {
    const a = Math.atan2(v.z, v.x) + (dx * v.z - dz * v.x > 0 ? -0.06 : 0.06);
    v.x = Math.cos(a) * keep; v.z = Math.sin(a) * keep;
  }
  v.rot = Math.atan2(dx, dz);
  v.anim = 'walk';
  return false;
}
function faceTo(v, x, z) { if (Math.abs(x - v.x) + Math.abs(z - v.z) > 0.01) v.rot = Math.atan2(x - v.x, z - v.z); }
function villagerSpeed(s, v) {
  let sp = V_SPEED;
  if (v.carryAmt > 0) sp *= 0.82;
  if (s.hungry) sp *= 0.8;
  if (s.fire.dim) sp *= 0.9;
  if (phaseOf(s.t) === 'dusk') sp *= 1.3;
  return sp;
}
function workRate(s) {
  let r = 1;
  if (s.hungry) r *= 0.7;
  if (s.fire.dim) r *= 0.75;
  if (s.festival) r *= 1.2;
  return r;
}

/* ---------- villager AI ---------- */
/** Seat i of `total` villagers around the fire, spread evenly ring by ring. */
function seatPos(i, total) {
  total = Math.max(total || 1, i + 1);
  let start = 0;
  for (let ring = 0; ring < 12; ring++) {
    const r = 2.7 + ring * 0.75, cap = Math.floor((2 * Math.PI * r) / 0.72);
    const inRing = Math.min(cap, total - start);
    if (i < start + inRing) { const a = ((i - start) / inRing) * Math.PI * 2 + ring * 0.35 + 0.2; return { x: Math.sin(a) * r, z: Math.cos(a) * r }; }
    start += cap;
  }
  return { x: 0, z: 3 };
}
function assignDefenders(s) {
  const fronts = s.fronts.length ? s.fronts : [{ a: 0, w: 1 }, { a: Math.PI / 2, w: 1 }, { a: Math.PI, w: 1 }, { a: -Math.PI / 2, w: 1 }];
  const W = (f) => f.w || 0.001;
  const tot = fronts.reduce((a, f) => a + W(f), 0);
  for (const group of [['warrior', 'brute', 'spear'], ['archer']]) {
    const list = s.villagers.filter((v) => group.includes(v.job)).sort((a, b) => a.id - b.id);
    const n = list.length;
    const counts = fronts.map((f) => Math.floor((n * W(f)) / tot));
    let left = n - counts.reduce((a, c) => a + c, 0);
    const order = fronts.map((f, i) => i).sort((a, b) => W(fronts[b]) - W(fronts[a]));
    for (let k = 0; left > 0; k++, left--) counts[order[k % order.length]]++;
    let idx = 0;
    fronts.forEach((f, fi) => { for (let k = 0; k < counts[fi]; k++) { const v = list[idx++]; v.front = fi; v.slot = k; v.frontN = counts[fi]; } });
  }
  s._fronts = fronts;
}
function postPos(s, v) {
  const fronts = s._fronts || [{ a: 0 }];
  const f = fronts[v.front % fronts.length];
  const R = territory(s);
  const rr = isMelee(v) ? R - 0.8 - (v.job === 'spear' ? 0.6 : 0) : R - 3.6;
  const d = dirXZ(f.a);
  const lat = (v.slot - ((v.frontN || 1) - 1) / 2) * (isMelee(v) ? 0.95 : 1.1);
  return { x: d.x * rr - d.z * lat, z: d.z * rr + d.x * lat };
}
/** Find a building with a free place for this villager's job. */
function pickWorkplace(s, v) {
  let best = null, bs = Infinity;
  for (const b of s.buildings) {
    const cap = bSlots(b, v.job);
    if (!cap) continue;
    const n = workersAt(s, b, v.job, v);
    if (n >= cap) continue;
    // soldiers prefer their own training ground (archers the range, fighters the Akhara)
    const score = (n / cap) * 10 + dist(b, v) * 0.05 + (b.type === JOBS[v.job].building ? 0 : 6);
    if (score < bs) { bs = score; best = b; }
  }
  v.workplace = best ? best.id : null;
  return best;
}
function workplaceIndex(s, v) {
  let i = 0;
  for (const o of s.villagers) { if (o === v) break; if (o.job === v.job && o.workplace === v.workplace) i++; }
  return i;
}
function validWorkplace(s, v) {
  const b = v.workplace != null ? getB(s, v.workplace) : null;
  if (b && bSlots(b, v.job)) return b;
  return pickWorkplace(s, v);
}
/** Put an idle villager to work at this particular building. */
function assignToBuilding(s, b, job) {
  job = job || jobOfBuilding(b.type);
  if (JOBS[job] && JOBS[job].weapon) return equipSoldier(s, job);
  if (!job || !b.done) return false;
  if (workersAt(s, b, job) >= bSlots(b, job)) { toast(`The ${BUILDINGS[b.type].name} is full.`, 'warn'); return false; }
  const idle = idleVillagers(s);
  if (!idle.length) { toast('No idle villagers. Build Jhopdis so more people come.', 'warn'); return false; }
  idle.sort((a, c) => dist(a, b) - dist(c, b));
  setJob(s, idle[0], job);
  idle[0].workplace = b.id;
  sfx('click');
  return true;
}
function unassignFromBuilding(s, b, job) {
  job = job || jobOfBuilding(b.type);
  const k = slotKey(job);
  const list = s.villagers.filter((v) => slotKey(v.job) === k && v.workplace === b.id);
  if (!list.length) return false;
  setJob(s, list[list.length - 1], 'idle');
  sfx('click');
  return true;
}

function idleAI(s, v, dt, spd) {
  if (v.wanderT > 0) {
    v.wanderT -= dt;
    v.anim = v.idleSit ? 'sit' : 'stand';
    if (v.idleSit) faceTo(v, 0, 0);
    return;
  }
  if (moveTo(v, v.wx, v.wz, spd * 0.5, dt)) {
    v.wanderT = rand(3, 8);
    v.idleSit = Math.random() < 0.6;
    const a = Math.random() * Math.PI * 2, r = rand(3, Math.min(7, territory(s) - 1));
    v.wx = Math.cos(a) * r; v.wz = Math.sin(a) * r;
  }
  if (!v.task) v.task = 'Relaxing';
}
/** Places that accept a resource: the Agnikund takes everything, camps take their own goods, the Bhandar takes all. */
function dropPoints(s, res) {
  const h = res && FIRE_HEAP[res];
  const pts = [h ? { x: h.x, z: h.z, r: 0.7, fire: true } : { x: 0, z: 0, r: 2.1, fire: true }];
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (b.done && d.drop && (!res || d.drop.includes(res))) pts.push({ x: b.x, z: b.z, r: Math.max(d.fw, d.fd) * 0.5 + 0.35, b });
  }
  return pts;
}
/** Nearest place to drop a good. Full stockpiles are skipped — the Agnikund heap always has room. */
function nearestDrop(s, x, z, res) {
  let best = null, bd = Infinity;
  for (const p of dropPoints(s, res)) {
    if (res && p.b && stockFree(p.b, res) < 1) continue;
    const d = distXZ(p.x, p.z, x, z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function deliverAI(s, v, dt, spd) {
  const d = nearestDrop(s, v.x, v.z, v.carry);
  const dd = distXZ(v.x, v.z, d.x, d.z) || 1;
  const tx = d.x + ((v.x - d.x) / dd) * d.r, tz = d.z + ((v.z - d.z) / dd) * d.r;
  v.task = `Carrying ${v.carryAmt} ${RES[v.carry].en.toLowerCase()} to the ${d.fire ? 'Agnikund heap' : BUILDINGS[d.b.type].name}`;
  if (moveTo(v, tx, tz, spd, dt)) deliver(s, v, d);
}
function findResource(s, v, kind, camp) {
  const list = kind === 'wood' ? s.trees : s.rocks;
  const base = camp || { x: 0, z: 0 };
  let best = null, bs = Infinity;
  for (const r of list) {
    if (kind === 'wood' ? (r.stump || r.wood <= 0 || r.sacred) : r.stone <= 0) continue;
    const score = distXZ(base.x, base.z, r.x, r.z) * 0.85 + distXZ(r.x, r.z, v.x, v.z) * 0.15;
    if (score >= bs) continue;
    let n = 0;
    for (const o of s.villagers) if (o !== v && o.target === r) n++;
    const limit = kind === 'wood' ? (r.type === 'banyan' ? 2 : 1) : 2;
    if (n >= limit) continue;
    bs = score; best = r;
  }
  return best;
}
function gatherAI(s, v, dt, spd, kind) {
  const isWood = kind === 'wood';
  const cap = CARRY_CAP[kind];
  if (v.carryAmt >= cap) return deliverAI(s, v, dt, spd);
  const camp = validWorkplace(s, v);
  if (!camp) {
    if (v.carryAmt > 0) return deliverAI(s, v, dt, spd);
    v.task = `Needs a ${BUILDINGS[JOBS[v.job].building].name} to work from`;
    return idleAI(s, v, dt, spd);
  }
  let r = v.target;
  const valid = r && (isWood ? (!r.stump && r.wood > 0 && s.trees.includes(r)) : (r.stone > 0 && s.rocks.includes(r)));
  if (!valid) r = v.target = findResource(s, v, kind, camp);
  if (!r) {
    if (v.carryAmt > 0) return deliverAI(s, v, dt, spd);
    v.task = isWood ? 'No trees left to chop!' : 'No rocks left to mine!';
    return idleAI(s, v, dt, spd);
  }
  const d = distXZ(v.x, v.z, r.x, r.z) || 1;
  const off = isWood ? 0.6 : 0.75;
  const sx = r.x + ((v.x - r.x) / d) * off, sz = r.z + ((v.z - r.z) / d) * off;
  if (d > off + 0.05 && !moveTo(v, sx, sz, spd, dt)) {
    v.task = v.carryAmt > 0 ? (isWood ? 'Fetching more wood' : 'Fetching more stone') : (isWood ? 'Walking to a tree' : 'Walking to the rocks');
    return;
  }
  faceTo(v, r.x, r.z);
  v.task = isWood ? `Chopping a ${TREE_INFO[r.type].name} (${r.wood} wood left)` : `Breaking stone (${r.stone} left)`;
  const rate = workRate(s) * (isWood ? (s.upgrades.axe ? 1.6 : 1) : (s.upgrades.pick ? 1.6 : 1));
  v.workT += dt * rate;
  v.anim = 'work';
  const interval = isWood ? 2.0 : 2.6;
  if (v.workT >= interval) {
    v.workT -= interval;
    v.carryAmt++;
    v.carry = kind;
    if (isWood) {
      r.wood--; r.shake = 0.3;
      emitChips(s, r.x, 0.8, r.z, '#c89a5e');
      sfx('chop', v.x, v.z);
      if (r.wood <= 0) {
        r.stump = true; r.regrow = randi(2, 3); v.target = null; s.treeVer++;
        sfx('treefall', r.x, r.z);
        emit(s, r.x, 2, r.z, 16, { spread: 1, spreadY: 0.5, vx: 1, vyMin: -1, vyMax: 1, life: 1.4, colors: ['#3f8a3a', '#55a145', '#2a5e2b'], g: 3 });
      }
    } else {
      r.stone--;
      emitChips(s, r.x, 0.4, r.z, '#b8b4ab');
      sfx('mine', v.x, v.z);
      if (Math.random() < 0.07) { v.gold++; floater(s, r.x, 1.4, r.z, '!', '#ffd84a'); sfx('coin', r.x, r.z); }
      if (r.stone <= 0) { s.rocks.splice(s.rocks.indexOf(r), 1); v.target = null; }
      s.rockVer++;
    }
  }
}
function farmAI(s, v, dt, spd) {
  if (v.carryAmt > 0) return deliverAI(s, v, dt, spd);
  const f = validWorkplace(s, v);
  if (!f) { v.task = 'Needs a Khet (field)'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v), cap = bSlots(f, 'farm');
  const sw = Math.sin(s.time * 0.25 + i * 2) * 0.6;
  const p = localToWorld(f, (i - (cap - 1) / 2) * (cap > 2 ? 1.1 : 1.2), sw);
  if (!moveTo(v, p.x, p.z, spd, dt) && distXZ(v.x, v.z, p.x, p.z) > 0.6) { v.task = 'Walking to the Khet'; return; }
  v.anim = 'work';
  faceTo(v, f.x, f.z);
  let rate = workRate(s) * (f.type === 'field' ? 1 : 1.15);
  if (s.buildings.some((b) => b.type === 'well' && b.done && dist(b, f) < 9)) rate *= 1.5;
  if (s.weather === 'rain') rate *= 1.5;
  f.grow += dt * rate;
  v.task = f.grow < 22 ? 'Tending the crops' : 'Harvesting the grain';
  if (f.grow >= 30) {
    f.grow = 0;
    v.carryAmt = carryCap(s, 'food');
    v.carry = 'food';
    sfx('harvest', v.x, v.z);
    emit(s, f.x, 0.5, f.z, 14, { spread: 1.2, vx: 0.8, vyMin: 1, vyMax: 3, life: 0.9, colors: ['#f2d16b', '#e0b84a', '#a6cc4a'], g: 8 });
  }
}
function findBuildJob(s, v) {
  let best = null, bs = Infinity;
  for (const b of s.buildings) {
    if (b.done && b.hp >= b.maxHp - 0.5 && !b.upgrading) continue;
    let n = 0;
    for (const o of s.villagers) if (o !== v && o.job === 'build' && o.target === b) n++;
    const score = dist(b, v) + n * 6 + (b.done && !b.upgrading ? 25 : 0);
    if (score < bs) { bs = score; best = b; }
  }
  return best;
}
function completeBuilding(s, b) {
  const def = BUILDINGS[b.type];
  b.done = true; b.hp = b.maxHp = def.hp; b.progress = def.time;
  s.stats.built++;
  s.buildVer++;
  if (!def.wall) toast(`${def.name} (${def.en}) is ready!`, 'good');
  sfx(def.wall ? 'hammer' : 'bell', b.x, b.z);
  emit(s, b.x, def.ht * 0.6, b.z, def.wall ? 4 : 16, { spread: def.fw / 2, spreadY: def.ht / 3, vx: 0.8, vyMin: 0.5, vyMax: 2, life: 1.1, colors: ['#ffcc33', '#ff9933', '#fff3b0'], g: -0.5, add: true });
  if (!def.wall) emit(s, b.x, 0.15, b.z, 24, { spread: Math.max(def.fw, def.fd) / 2 + 0.3, vx: 1.6, vyMin: 0.2, vyMax: 1, life: 1.3, colors: ['#e0cfae', '#cdb894', '#f0e2c4'], g: -0.1 }); // dust as the scaffolding comes down
  const jobFor = jobOfBuilding(b.type);
  if (jobFor) tip('slot_' + jobFor, `The ${def.name} has room for ${JOBS[jobFor].name} (${JOBS[jobFor].en})! Click it and press + Assign, or use the Kaam panel.`);
  b.popT = 0.5;
  tryMerge(s, b);
}
/** Two finished huts (or fields) touching side by side join into one bigger building. */
function tryMerge(s, b) {
  const def = BUILDINGS[b.type];
  if (!def.merge || !b.done) return false;
  for (const n of s.buildings) {
    if (n === b || n.type !== b.type || !n.done) continue;
    let horiz = null;
    if (n.cz === b.cz && Math.abs(n.cx - b.cx) === def.fw) horiz = true;
    else if (n.cx === b.cx && Math.abs(n.cz - b.cz) === def.fd) horiz = false;
    if (horiz === null) continue;
    const type = def.merge + (horiz ? '' : 'V');
    const nd = BUILDINGS[type];
    const cx = Math.min(n.cx, b.cx), cz = Math.min(n.cz, b.cz);
    const ids = [b.id, n.id];
    const residents = s.villagers.filter((v) => ids.includes(v.home));
    const hiding = new Set(residents.filter((v) => v.inside));
    const workers = s.villagers.filter((v) => ids.includes(v.workplace));
    const grow = Math.max(b.grow || 0, n.grow || 0);
    const wasSel = typeof UI !== 'undefined' && UI.selected && ids.includes(UI.selected.ref && UI.selected.ref.id);
    removeBuilding(s, b);
    removeBuilding(s, n);
    const c = bCenterOf(type, cx, cz);
    const rot = horiz ? (c.z > 0 ? Math.PI : 0) : (c.x > 0 ? -Math.PI / 2 : Math.PI / 2);
    const nb = { id: s.nextId++, type, cx, cz, x: c.x, z: c.z, rot, done: true, progress: nd.time, hp: nd.hp, maxHp: nd.hp, grow, cd: 0, offerT: 0, popT: 0.7 };
    addBuilding(s, nb);
    for (const old of [b, n]) for (const r in old.stock || {}) putStock(s, nb, r, old.stock[r]); // the grain sacks move over too
    for (const v of residents) { v.home = nb.id; if (hiding.has(v)) { v.inside = true; v.shelter = 'home'; v.x = nb.x; v.z = nb.z; } }
    for (const v of workers) v.workplace = nb.id;
    emit(s, nb.x, 0.6, nb.z, 30, { spread: nd.fw / 2, vx: 2, vyMin: 1, vyMax: 3.5, life: 1.1, colors: ['#e0c89a', '#c8a46a', '#fff3b0'], g: 4 });
    toast(`Two ${def.name}s joined into a ${nd.name} (${nd.en})! ${isHome(type) ? `It homes ${nd.housing} villagers.` : `Room for ${nd.slots.farm} Kisan.`}`, 'good', 6);
    sfx('upgrade', nb.x, nb.z);
    if (wasSel) UI.select({ kind: 'building', ref: nb });
    return true;
  }
  return false;
}

/* ---------- demon loot ---------- */
function dropLoot(s, e) {
  const def = ENEMIES[e.type];
  const add = (kind, amt) => s.loot.push({ id: s.nextId++, kind, amt: Math.round(amt), x: e.x + rand(-0.6, 0.6), z: e.z + rand(-0.6, 0.6), t: 0 });
  add('gold', def.gold);
  if (def.boss) { add('chest', 40 + s.day * 3); add('gem', 25); add('wood', 30); add('stone', 30); add('food', 30); return; }
  const r = Math.random();
  if (r < 0.04 * def.cost) add('gem', 6 + def.cost * 3);
  else if (r < 0.4) add(pick(['wood', 'stone', 'food']), randi(3, 5) * Math.max(1, def.cost));
  tip('loot', 'Demons drop loot! Idle villagers (Aaram) collect it in daylight — keep one or two villagers idle.');
}
function collectLoot(s, l, v) {
  const L = LOOT[l.kind];
  s.loot.splice(s.loot.indexOf(l), 1);
  addRes(s, L.res, l.amt, l.x, l.z, 1.4);
  if (l.kind === 'gem' || l.kind === 'chest') toast(`${v ? v.name + ' found' : 'Found'} ${L.name} (${L.en}): +${l.amt} gold!`, 'good');
  sfx('coin', l.x, l.z);
}
function updateLoot(s, dt) {
  const day = phaseOf(s.t) === 'day';
  for (const l of s.loot.slice()) {
    l.t += dt;
    if (l.t > DAY_LEN * 4) { s.loot.splice(s.loot.indexOf(l), 1); continue; }
    if (!day) continue;
    for (const v of s.villagers) if (!v.inside && distXZ(v.x, v.z, l.x, l.z) < 0.7) { collectLoot(s, l, v); break; }
  }
}
/** Idle villagers fetch loot by day. */
function lootAI(s, v, dt, spd) {
  if (!s.loot.length || phaseOf(s.t) !== 'day') return false;
  let l = v.lootT && s.loot.includes(v.lootT) ? v.lootT : null;
  if (!l) {
    let bd = territory(s) + 14;
    for (const o of s.loot) {
      if (s.villagers.some((u) => u !== v && u.lootT === o)) continue;
      const d = distXZ(o.x, o.z, v.x, v.z);
      if (d < bd) { bd = d; l = o; }
    }
    v.lootT = l;
  }
  if (!l) return false;
  v.task = `Collecting ${LOOT[l.kind].en.toLowerCase()} left by a demon`;
  if (moveTo(v, l.x, l.z, spd * 1.1, dt)) { collectLoot(s, l, v); v.lootT = null; }
  return true;
}
function builderAI(s, v, dt, spd) {
  let b = v.target && s.bById.get(v.target.id) === v.target ? v.target : null;
  if (b && b.done && b.hp >= b.maxHp - 0.5 && !b.upgrading) b = null;
  if (!b) b = v.target = findBuildJob(s, v);
  if (!b) { v.task = 'Nothing to build — waiting'; return idleAI(s, v, dt, spd); }
  const def = BUILDINGS[b.type];
  const p = edgePoint(b, v.x, v.z, 0.35);
  if (distToBuilding(b, v.x, v.z) > 0.55 && !moveTo(v, p.x, p.z, spd, dt)) { v.task = (b.done ? 'Going to repair the ' : 'Going to build the ') + def.name; return; }
  faceTo(v, b.x, b.z);
  v.anim = 'work';
  const rate = workRate(s);
  v.workT += dt;
  if (v.workT > 0.6) {
    v.workT = 0;
    sfx('hammer', v.x, v.z);
    const hy = b.done ? 0.4 + Math.random() * def.ht * 0.5 : 0.15 + def.ht * clamp((b.progress / def.time - 0.12) / 0.88, 0, 1);
    emitChips(s, p.x, hy, p.z, b.done ? '#c8a46a' : pick(['#c8a46a', '#b5794a', '#d9ab55']));
    if (!b.done && Math.random() < 0.5) emit(s, b.x, 0.1, b.z, 2, { spread: BUILDINGS[b.type].fw / 2, vx: 0.4, vyMin: 0.3, vyMax: 0.8, life: 1.2, colors: ['#d8c4a0', '#c8b08a'], g: -0.2 });
  }
  if (!b.done) {
    b.progress += dt * rate;
    b.hp = Math.max(b.hp, (def.hp * b.progress) / def.time);
    v.task = `Building the ${def.name} (${Math.floor((b.progress / def.time) * 100)}%)`;
    if (b.progress >= def.time) completeBuilding(s, b);
  } else if (b.upgrading) {
    const L = def.levels[bLevel(b) + 1];
    b.upProg = (b.upProg || 0) + dt * rate;
    v.task = `Upgrading the ${def.name} to level ${bLevel(b) + 1} (${Math.floor((b.upProg / L.time) * 100)}%)`;
    if (b.upProg >= L.time) finishUpgrade(s, b);
  } else {
    b.hp = Math.min(b.maxHp, b.hp + 12 * dt * rate);
    v.task = `Repairing the ${def.name}`;
  }
}
function priestHeal(s, v, dt) {
  for (const o of s.villagers) {
    if (o.hp < o.maxHp && distXZ(o.x, o.z, v.x, v.z) < 6) {
      o.hp = Math.min(o.maxHp, o.hp + 3 * dt);
      if (Math.random() < dt * 1.5) emit(s, o.x, 1.4, o.z, 1, { spread: 0.2, vx: 0.2, vyMin: 0.6, vyMax: 1.2, life: 0.9, colors: ['#ffe066', '#fff3b0'], add: true });
    }
  }
}
function frontSpot(s, v, b, lateral) {
  const p = localToWorld(b, lateral, BUILDINGS[b.type].fd / 2 + 0.45);
  return p;
}
function priestAI(s, v, dt, spd) {
  const tpl = validWorkplace(s, v, 'temple');
  if (!tpl) { v.task = 'Needs a Mandir'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  const p = frontSpot(s, v, tpl, i === 0 ? -0.5 : 0.5);
  if (!moveTo(v, p.x, p.z, spd, dt)) { v.task = 'Walking to the Mandir'; return; }
  v.anim = 'work';
  faceTo(v, tpl.x, tpl.z);
  v.task = 'Performing aarti — healing and collecting offerings';
  v.offerT += dt * workRate(s);
  if (v.offerT >= 9) { v.offerT = 0; addRes(s, 'gold', 1, v.x, v.z, 2); sfx('bellSoft', v.x, v.z); }
}
function traderAI(s, v, dt, spd) {
  const bz = validWorkplace(s, v, 'bazaar');
  if (!bz) { v.task = 'Needs a Bazaar'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  const p = frontSpot(s, v, bz, i === 0 ? -0.7 : 0.7);
  if (!moveTo(v, p.x, p.z, spd, dt)) { v.task = 'Walking to the Bazaar'; return; }
  faceTo(v, p.x + (p.x - bz.x), p.z + (p.z - bz.z));
  if (s.res.food < 12) { v.anim = 'stand'; v.task = 'Waiting for grain to sell (needs 12+)'; return; }
  v.anim = 'work';
  v.task = 'Selling grain for gold';
  v.offerT += dt * workRate(s);
  if (v.offerT >= 8) {
    v.offerT = 0;
    s.res.food -= 3;
    floater(s, v.x - 0.3, 1.6, v.z, '-3', RES.food.color);
    addRes(s, 'gold', 2, v.x + 0.3, v.z, 2);
    sfx('coin', v.x, v.z);
  }
}
function homeAI(s, v, dt, spd) {
  const e = nearestEnemy(s, v.x, v.z, 0.9, true);
  if (e && v.hp < v.maxHp * 0.45 && Math.hypot(v.x, v.z) > 1.8) {
    const ae = Math.atan2(e.z, e.x) + Math.PI; // the far side of the holy fire
    moveTo(v, Math.cos(ae) * 1.9, Math.sin(ae) * 1.9, spd * 1.3, dt);
    v.task = 'Fleeing to the fire!';
    v.combatT = 2;
    return;
  }
  if (e) {
    faceTo(v, e.x, e.z);
    v.anim = 'work';
    v.task = 'Fighting for their life!';
    v.combatT = 2;
    if (v.atkCd <= 0) { hitEnemy(s, e, 4, v); v.atkCd = 1.0; }
    return;
  }
  if (moveTo(v, v.seat.x, v.seat.z, spd * 1.1, dt)) {
    if (v.carryAmt > 0 || v.gold > 0) deliver(s, v);
    v.anim = 'sit';
    faceTo(v, 0, 0);
    v.task = 'Resting by the Agnikund';
  } else v.task = 'Hurrying back to the fire';
}
/* ---------- shelter: huts and the Pavitra Van (sacred grove) ---------- */
function assignHomes(s) {
  const huts = s.buildings.filter((b) => b.done && isHome(b.type));
  const cap = (h) => BUILDINGS[h.type].housing;
  const count = new Map(huts.map((h) => [h.id, 0]));
  for (const v of s.villagers) {
    const h = v.home && getB(s, v.home);
    if (h && count.has(v.home) && count.get(v.home) < cap(h)) count.set(v.home, count.get(v.home) + 1);
    else if (!v.inside || v.shelter !== 'home') v.home = null;
  }
  for (const v of s.villagers) {
    if (v.home) continue;
    let best = null, bd = Infinity;
    for (const h of huts) { if (count.get(h.id) >= cap(h)) continue; const d = dist(h, v); if (d < bd) { bd = d; best = h; } }
    if (best) { v.home = best.id; count.set(best.id, count.get(best.id) + 1); }
  }
}
function validHome(s, v) { const b = v.home && getB(s, v.home); return !!(b && b.done && isHome(b.type)); }
function homeDoor(b) { return localToWorld(b, 0, BUILDINGS[b.type].fd / 2 + 0.3); }
function groveSpot(s, v) {
  const g = s.grove, a = (v.id * 2.399) % (Math.PI * 2), r = 0.3 + (v.id % 3) * 0.35;
  return { x: g.x + Math.cos(a) * r, z: g.z + Math.sin(a) * r };
}
function leaveShelter(s, v) {
  v.inside = false;
  if (v.shelter === 'home') { const b = getB(s, v.home); if (b) { const d = homeDoor(b); v.x = d.x; v.z = d.z; } }
  v.shelter = null;
}
/** Civilians run from nearby demons: into their Jhopdi if they have one, otherwise into the sacred grove. */
function shelterAI(s, v, dt, spd) {
  v.fearT = (v.fearT || 0) - dt;
  v.scanT = (v.scanT || 0) - dt;
  if (v.scanT <= 0) {
    v.scanT = 0.3;
    if (nearestEnemy(s, v.x, v.z, v.inside ? 8 : 6.5, false)) v.fearT = 5;
  }
  if (v.scared) { v.scared = false; v.fearT = 5; }
  if (v.fearT <= 0 && !v.shelter) return false; // once running for shelter, they keep going until inside
  if (!v.shelter || (v.shelter === 'home' && !validHome(s, v))) {
    v.shelter = validHome(s, v) ? 'home' : s.grove ? 'grove' : null;
    if (!v.shelter) return false;
    tip('hide', 'Demons are near! Villagers with a Jhopdi hide inside it; the rest run to the Pavitra Van, the sacred grove. Build more huts to keep everyone safe.');
  }
  if (v.inside) {
    v.anim = 'stand';
    v.hp = Math.min(v.maxHp, v.hp + 1.2 * dt);
    v.task = v.shelter === 'home' ? 'Hiding inside their Jhopdi' : 'Hiding in the Pavitra Van';
    if (v.fearT <= 0) leaveShelter(s, v);
    return true;
  }
  const p = v.shelter === 'home' ? homeDoor(getB(s, v.home)) : groveSpot(s, v);
  v.task = v.shelter === 'home' ? 'Running home to hide!' : 'Running to hide in the Pavitra Van!';
  v.combatT = 1;
  if (moveTo(v, p.x, p.z, spd * 1.35, dt)) {
    v.inside = true;
    if (v.shelter === 'home') { const b = getB(s, v.home); v.x = b.x; v.z = b.z; }
    sfx('click', v.x, v.z);
  }
  return true;
}

function warriorAI(s, v, dt, phase, spd) {
  const night = phase !== 'day';
  const R = territory(s);
  if (v.hp < v.maxHp * 0.3) v.retreat = true;
  if (v.retreat) {
    if (v.hp > v.maxHp * 0.75 || !s.enemies.length) v.retreat = false;
    else {
      const a = Math.atan2(v.z, v.x);
      if (moveTo(v, Math.cos(a) * 2.2, Math.sin(a) * 2.2, spd * 1.2, dt)) { v.anim = 'sit'; faceTo(v, 0, 0); }
      v.task = 'Wounded — healing by the fire';
      return;
    }
  }
  v.thinkT -= dt;
  if (v.thinkT <= 0 || !v.foe || v.foe.dead) {
    v.thinkT = 0.4;
    let best = null, bs = Infinity;
    for (const e of s.enemies) {
      if (e.dead || (ENEMIES[e.type].fly && e.y > 1.2)) continue;
      const df = Math.hypot(e.x, e.z), dv = distXZ(e.x, e.z, v.x, v.z);
      if (df > R + 7 && dv > 5) continue;
      let n = 0;
      for (const o of s.villagers) if (o !== v && o.foe === e) n++;
      const score = dv + df * 0.5 + n * 3;
      if (score < bs) { bs = score; best = e; }
    }
    v.foe = best;
  }
  const e = v.foe;
  const st = SOLDIERS[v.job] || SOLDIERS.warrior;
  if (e && !e.dead) {
    v.combatT = 1.5;
    const def = ENEMIES[e.type];
    const reach = st.reach + def.r;
    const d = distXZ(e.x, e.z, v.x, v.z);
    if (d > reach) {
      const k = (d - reach + 0.1) / d;
      moveTo(v, v.x + (e.x - v.x) * k, v.z + (e.z - v.z) * k, spd * 1.25 * st.speed, dt);
      v.task = 'Charging the ' + def.name;
    } else {
      faceTo(v, e.x, e.z);
      v.anim = 'work';
      v.task = 'Fighting the ' + def.name;
      if (v.atkCd <= 0) {
        let dmg = st.dmg * (v.job === 'warrior' && s.upgrades.talwar ? 1.6 : 1) * (s.festival ? 1.5 : 1);
        if (st.bigBonus && (def.boss || e.type === 'danav')) dmg *= st.bigBonus; // spears skewer the giants
        hitEnemy(s, e, dmg, v);
        if (st.splash) { // the gada smashes everything around the target
          for (const o of s.enemies) if (o !== e && !o.dead && distXZ(o.x, o.z, e.x, e.z) < st.splash) hitEnemy(s, o, dmg * 0.5, v);
          if (!def.boss) { const kk = st.knock / (d || 1); e.x += (e.x - v.x) * kk; e.z += (e.z - v.z) * kk; }
          emit(s, e.x, 0.2, e.z, 8, { spread: 0.3, vx: 1.5, vyMin: 0.3, vyMax: 1.2, life: 0.6, colors: ['#d8c4a0', '#c8b08a'], g: 2 });
        }
        v.atkCd = st.cd;
        sfx(v.job === 'brute' ? 'thud' : 'sword', v.x, v.z);
      }
    }
    return;
  }
  if (night) {
    const p = postPos(s, v);
    if (moveTo(v, p.x, p.z, spd * 1.2, dt)) {
      v.anim = 'stand';
      v.rot = Math.atan2(p.x, p.z);
      v.task = 'Guarding the ' + compassOf(p.x, p.z);
    } else v.task = 'Taking position for the night';
    return;
  }
  const a = validWorkplace(s, v, 'akhara');
  if (!a) { v.task = 'Needs an Akhara'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  const p = localToWorld(a, -0.6 + i * 0.6, 0.3 - (i % 2) * 0.6);
  if (moveTo(v, p.x, p.z, spd, dt)) {
    faceTo(v, a.x - 0.85, a.z - 0.85);
    v.anim = (Math.floor(v.animT * 0.4 + i) % 3 === 0) ? 'stand' : 'work';
    v.task = 'Training at the Akhara';
  } else v.task = 'Walking to the Akhara';
}
function archerAI(s, v, dt, phase, spd) {
  const night = phase !== 'day';
  const range = 10 + (s.upgrades.bow ? 2.5 : 0);
  const close = nearestEnemy(s, v.x, v.z, 0.9, true);
  if (close && !(close.type === 'bhoot' && v.hp > 20)) {
    const d = distXZ(v.x, v.z, close.x, close.z) || 1;
    moveTo(v, v.x + ((v.x - close.x) / d) * 2, v.z + ((v.z - close.z) / d) * 2, spd * 1.3, dt);
    v.task = 'Falling back!';
    v.combatT = 1.5;
    return;
  }
  const target = nearestEnemy(s, v.x, v.z, range, false);
  if (night && !target) {
    const p = postPos(s, v);
    if (moveTo(v, p.x, p.z, spd * 1.2, dt)) { v.anim = 'stand'; v.rot = Math.atan2(p.x, p.z); v.task = 'Watching the ' + compassOf(p.x, p.z) + ' with bow ready'; }
    else v.task = 'Taking position for the night';
    return;
  }
  if (target) {
    faceTo(v, target.x, target.z);
    v.anim = 'shoot';
    v.combatT = 1.5;
    v.task = 'Shooting at the ' + ENEMIES[target.type].name;
    if (v.atkCd <= 0) {
      shootArrow(s, v.x, 1.0, v.z, target, 6 * (s.upgrades.bow ? 1.5 : 1) * (s.festival ? 1.5 : 1), false);
      v.atkCd = 1.35;
      sfx('bow', v.x, v.z);
    }
    return;
  }
  const rg = validWorkplace(s, v, 'range');
  if (!rg) { v.task = 'Needs a Dhanush Shala'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  const p = localToWorld(rg, -1.2, -0.5 + i * 0.5);
  if (!moveTo(v, p.x, p.z, spd, dt)) { v.task = 'Walking to the Dhanush Shala'; return; }
  const tg = localToWorld(rg, 1.1, 0.05);
  faceTo(v, tg.x, tg.z);
  v.anim = 'shoot';
  v.task = 'Practising archery';
  v.offerT += dt;
  if (v.offerT > 2.6 + i * 0.4) { v.offerT = 0; shootArrow(s, v.x, 1.0, v.z, { x: tg.x, y: 0.95, z: tg.z, practice: true }, 0, true); }
}
function updateVillager(s, v, dt, phase) {
  v.animT += dt;
  if (v.hurtT > 0) v.hurtT -= dt;
  if (v.atkCd > 0) v.atkCd -= dt;
  if (v.combatT > 0) v.combatT -= dt;
  if (v.combatT <= 0 && v.hp < v.maxHp) v.hp = Math.min(v.maxHp, v.hp + (Math.hypot(v.x, v.z) < 4.5 ? 2.2 : 0.3) * dt);
  v.task = '';
  const spd = villagerSpeed(s, v);
  if (v.arriving) {
    v.task = 'Arriving at the village';
    if (moveTo(v, v.ax, v.az, spd, dt)) v.arriving = false;
    return;
  }
  if (v.entranced > 0) { // a Nishi is calling their name — they walk toward the voice
    v.entranced -= dt;
    const n = s.enemies.find((e) => e.id === v.callBy && !e.dead);
    if (n && phase !== 'day') {
      v.inside = false; v.shelter = null;
      v.task = 'Walking toward a voice calling their name…';
      moveTo(v, n.x, n.z, spd * 0.55, dt);
      return;
    }
    v.entranced = 0;
  }
  if (isMelee(v)) return warriorAI(s, v, dt, phase, spd);
  if (v.job === 'archer') return archerAI(s, v, dt, phase, spd);
  if (shelterAI(s, v, dt, spd)) return;
  if (v.job === 'priest') priestHeal(s, v, dt);
  if (phase !== 'day') return homeAI(s, v, dt, spd);
  switch (v.job) {
    case 'wood': return gatherAI(s, v, dt, spd, 'wood');
    case 'stone': return gatherAI(s, v, dt, spd, 'stone');
    case 'farm': return farmAI(s, v, dt, spd);
    case 'build': return builderAI(s, v, dt, spd);
    case 'priest': return priestAI(s, v, dt, spd);
    case 'trader': return traderAI(s, v, dt, spd);
    default: if (lootAI(s, v, dt, spd)) return; return idleAI(s, v, dt, spd);
  }
}
function damageVillager(s, v, dmg) {
  if (isDefender(v) && s.upgrades.kavach) dmg *= 0.65;
  v.hp -= dmg;
  v.hurtT = 0.25;
  v.combatT = 3;
  if (!isDefender(v)) v.scared = true;
  emit(s, v.x, 0.8, v.z, 3, { spread: 0.1, vx: 1.5, vyMin: 1, vyMax: 3, life: 0.5, colors: ['#e03c31', '#a3161f'], g: 14 });
  sfx('hurt', v.x, v.z);
  if (v.hp <= 0) killVillager(s, v);
}
function killVillager(s, v) {
  const i = s.villagers.indexOf(v);
  if (i < 0) return;
  s.villagers.splice(i, 1);
  s.stats.lost++;
  emit(s, v.x, 0.6, v.z, 14, { spread: 0.2, vx: 0.4, vyMin: 1.2, vyMax: 3, life: 1.8, colors: ['#e8eef8', '#c8d4ea', '#fff3b0'], g: -0.3, add: true });
  toast(`${v.name} the ${JOBS[v.job].en} has fallen. Their spirit returns to the stars.`, 'danger');
  sfx('death', v.x, v.z);
  if (typeof UI !== 'undefined' && UI.selected && UI.selected.ref === v) UI.select(null);
  if (s.villagers.length === 0) gameOver(s, 'people');
}

/* ---------- projectiles ---------- */
function shootArrow(s, x, y, z, target, dmg, practice, kind, speed) {
  const th = practice ? target.y : target.y + ENEMIES[target.type].h * 0.55;
  const D = distXZ(target.x, target.z, x, z);
  const T = clamp(D / (speed || 14), 0.25, kind && kind !== 'arrow' ? 1.5 : 1.0);
  const px = target.x + (target.vx || 0) * T, pz = target.z + (target.vz || 0) * T;
  const p = { x, y, z, vx: (px - x) / T, vy: (th - y + 0.5 * GRAV3 * T * T) / T, vz: (pz - z) / T, dmg, practice: !!practice, life: 4, stuck: false, dead: false, kind: kind || 'arrow' };
  s.projectiles.push(p);
  return p;
}
/** Fire pots and cannon balls burst where they land. */
function explode(s, p) {
  p.dead = true;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = distXZ(p.x, p.z, e.x, e.z);
    if (d > p.splash + ENEMIES[e.type].r || e.y > 2.5) continue;
    hitEnemy(s, e, p.dmg * (d < 0.6 ? 1 : 0.6), p);
    if (p.kind === 'pot') { e.fireT = 3; e.fireDps = p.burn || 4; }
  }
  if (p.kind === 'pot') {
    emit(s, p.x, 0.3, p.z, 26, { spread: p.splash * 0.6, vx: 2.2, vyMin: 1, vyMax: 4, life: 0.9, colors: ['#ff8a1f', '#ffcc33', '#d8361c', '#fff3b0'], g: 2, add: true });
    emit(s, p.x, 0.5, p.z, 8, { spread: 0.5, vx: 0.6, vyMin: 0.8, vyMax: 1.6, life: 1.8, colors: ['#5a5a66', '#6b6b78'], g: -0.3 });
  } else {
    emit(s, p.x, 0.2, p.z, 22, { spread: 0.5, vx: 2.8, vyMin: 1, vyMax: 4, life: 1.0, colors: ['#8a7a66', '#6b5a48', '#a89a86'], g: 8 });
    emit(s, p.x, 0.5, p.z, 10, { spread: 0.6, vx: 0.8, vyMin: 0.8, vyMax: 1.8, life: 2.0, colors: ['#7d7d88', '#9a9aa4'], g: -0.3 });
  }
  sfx('boom', p.x, p.z);
}
function updateProjectiles(s, dt) {
  for (const p of s.projectiles) {
    if (p.stuck) { p.life -= dt; if (p.life <= 0) p.dead = true; continue; }
    p.vy -= GRAV3 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.life -= dt;
    if (p.kind === 'pot' && Math.random() < 0.6) emitFire(s, p.x, p.y, p.z);
    if (p.practice) {
      if (p.y < 1.1 && p.vy < 0 && p.life < 3.6) { p.stuck = true; p.life = 1.5; sfx('thunk', p.x, p.z); }
    } else {
      for (const e of s.enemies) {
        if (e.dead) continue;
        const d = ENEMIES[e.type];
        if (distXZ(p.x, p.z, e.x, e.z) < d.r + 0.2 && p.y > e.y - 0.1 && p.y < e.y + d.h + 0.1) {
          if (p.kind !== 'arrow') { explode(s, p); break; }
          hitEnemy(s, e, p.dmg, p);
          if (s.upgrades.agnibaan) { e.fireT = 2.5; e.fireDps = 3; }
          p.dead = true;
          break;
        }
      }
    }
    if (!p.dead && !p.stuck && p.y <= 0.02) {
      if (p.kind !== 'arrow' && !p.practice) explode(s, p);
      else { p.y = 0.02; p.stuck = true; p.life = 2; }
    }
    if (p.life <= 0) p.dead = true;
  }
  s.projectiles = s.projectiles.filter((p) => !p.dead);
}

/* ---------- demons ---------- */
function makeWave(s) {
  const d = s.day;
  let budget = 3 + (d - 1) * 2.7 + Math.pow(Math.max(0, d - 6), 2) * 0.45;
  const types = [];
  while (budget >= 1) {
    const opts = [['bhoot', Math.max(1, 6 - d * 0.5)]];
    if (d >= 2 && budget >= 2) opts.push(['rakshasa', 3 + d * 0.3]);
    if (d >= 4 && budget >= 2) opts.push(['vetala', 1.5 + d * 0.15]);
    if (d >= 6 && budget >= 6) opts.push(['danav', 0.6 + d * 0.1]);
    // Bengali ghosts join the nights one by one
    for (const k of ['aleya', 'shakchunni', 'mechho', 'nishi', 'skondhokata']) {
      const E = ENEMIES[k];
      if (d >= E.from && budget >= E.cost) opts.push([k, k === 'skondhokata' ? 0.7 + d * 0.08 : k === 'nishi' ? 0.9 : 1.6 + d * 0.12]);
    }
    const tot = opts.reduce((a, o) => a + o[1], 0);
    let r = Math.random() * tot, ch = opts[0][0];
    for (const o of opts) { r -= o[1]; if (r <= 0) { ch = o[0]; break; } }
    types.push(ch);
    budget -= ENEMIES[ch].cost;
  }
  const nf = d <= 2 ? 1 : d <= 6 ? 2 : 3;
  const base = Math.random() * Math.PI * 2;
  const fronts = [];
  for (let i = 0; i < nf; i++) fronts.push({ a: base + (i / nf) * Math.PI * 2 + rand(-0.4, 0.4), w: 0 });
  const q = [];
  types.forEach((type, i) => {
    const fi = Math.random() < 0.55 ? 0 : randi(0, nf - 1);
    fronts[fi].w += ENEMIES[type].cost;
    const at = NIGHT_T + 1 + (i / Math.max(1, types.length)) * 26 + rand(0, 2);
    for (let k = 0; k < (ENEMIES[type].swarm || 1); k++) q.push({ type, front: fi, at: at + k * 0.35 }); // Aleya drift in as a swarm
  });
  if (d % 5 === 0) { q.push({ type: 'boss', front: 0, at: NIGHT_T + 14 }); fronts[0].w += 10; }
  q.sort((a, b) => a.at - b.at);
  return { q, fronts };
}
function spawnEnemy(s, type, a) {
  const def = ENEMIES[type];
  const scale = 1 + (s.day - 1) * 0.07;
  const hp = Math.round(type === 'boss' ? 420 + s.day * 70 : def.hp * scale);
  const aa = a + rand(-0.3, 0.3);
  const dd = dirXZ(aa);
  let r = territory(s) + 12 + rand(0, 4);
  r = Math.min(r, islandR(dd.x * r, dd.z * r) - 3);
  const e = {
    id: s.nextId++, type, x: dd.x * r, z: dd.z * r, y: def.fly ? 2.6 + rand(0, 0.6) : 0,
    vx: 0, vz: 0, rot: Math.atan2(-dd.x, -dd.z), hp, maxHp: hp, atkCd: rand(0, 1), animT: rand(0, 1), hurtT: 0, atkAnim: 0,
    variant: randi(0, 3), aggro: !!def.wrecker || Math.random() < 0.2, burning: false, dead: false, diveT: 0, bob: rand(0, 6), thinkT: 0, tv: null, tb: null,
  };
  if (def.fly && def.swarm) e.y = 1.2 + rand(0, 0.8);
  s.enemies.push(e);
  if (def.bengali && !s.demo) tip('ghost_' + type, `${def.name} — ${def.en}! ${ENEMY_LORE[type]}`); // introduce each new ghost once
  return e;
}
function hitEnemy(s, e, dmg, src) {
  if (e.dead) return;
  e.hp -= dmg * (e.vuln || 1);
  e.hurtT = 0.15;
  const def = ENEMIES[e.type];
  if (!def.boss && !def.fly && src && src.x != null) {
    const d = distXZ(e.x, e.z, src.x, src.z) || 1, k = def.cost >= 6 ? 0.04 : 0.15;
    e.x += ((e.x - src.x) / d) * k; e.z += ((e.z - src.z) / d) * k;
  }
  emit(s, e.x, e.y + def.h * 0.5, e.z, 3, { spread: 0.1, vx: 1.8, vyMin: 0, vyMax: 2.5, life: 0.45, colors: ['#7b3fa0', '#2b1638', '#c58af0'], g: 10 });
  if (e.hp <= 0) killEnemy(s, e, true);
}
function killEnemy(s, e, byHand) {
  if (e.dead) return;
  e.dead = true;
  const def = ENEMIES[e.type];
  if (e.loot > 0) { // a caught Mechho Bhoot drops the stolen grain
    s.loot.push({ id: s.nextId++, kind: def.thief, amt: e.loot, x: e.x, z: e.z, t: 0 });
    floater(s, e.x, 1.6, e.z, 'Grain dropped!', RES[def.thief].color);
    e.loot = 0;
  }
  emit(s, e.x, e.y + def.h * 0.4, e.z, def.boss ? 60 : 16, { spread: def.r, spreadY: def.h / 3, vx: 1.4, vyMin: 1, vyMax: 3.5, life: 1.2, colors: ['#3d2552', '#5e3380', '#1a1020', '#8e5cb0'], g: -1 });
  if (byHand || !e.burning) {
    s.stats.killed++;
    dropLoot(s, e);
    sfx(def.boss ? 'bossDie' : 'demonDie', e.x, e.z);
    if (def.boss) { s.stats.bosses++; toast('Mahasura is vanquished! The village rejoices — Jai ho!', 'good', 8); }
  }
}
function destroyBuilding(s, b) {
  const def = BUILDINGS[b.type];
  if (!removeBuilding(s, b)) return;
  emit(s, b.x, def.ht * 0.5, b.z, 30, { spread: def.fw / 2, spreadY: def.ht / 3, vx: 2.5, vyMin: 1, vyMax: 5, life: 1.2, colors: ['#6b4a2e', '#8a8a8a', '#a77c4b', '#3a2416'], g: 10 });
  toast(`The demons destroyed the ${def.name} (${def.en})!`, 'danger');
  sfx('crash', b.x, b.z);
  if (typeof UI !== 'undefined' && UI.selected && UI.selected.ref === b) UI.select(null);
  fixJobOverflow(s);
}
function enemyAttack(s, e, target, kind) {
  e.vx = 0; e.vz = 0;
  if (target) faceTo(e, target.x, target.z); else faceTo(e, 0, 0);
  if (e.atkCd > 0) return;
  const def = ENEMIES[e.type];
  e.atkCd = def.atkCd;
  e.atkAnim = 0.4;
  const dmg = def.dmg * (s.festival ? 0.75 : 1);
  if (kind === 'villager') {
    damageVillager(s, target, dmg);
    if (def.drain) { // Shakchunni feeds on the blow
      e.hp = Math.min(e.maxHp, e.hp + dmg * def.drain * 2);
      emit(s, e.x, 1.0, e.z, 4, { spread: 0.2, vx: 0.4, vyMin: 0.5, vyMax: 1.5, life: 0.7, colors: ['#ff6b6b', '#ffd6d6'], g: -1, add: true });
    }
  } else if (kind === 'building') {
    target.hp -= dmg * (def.wrecker || 1);
    sfx('thud', target.x, target.z);
    emitChips(s, (e.x + target.x) / 2, 0.6, (e.z + target.z) / 2, '#a77c4b');
    if (target.hp <= 0) destroyBuilding(s, target);
  } else {
    s.fire.hp -= dmg;
    s.fire.hurtT = 0.3;
    sfx('firehit', 0, 0);
    tip('fireHit', 'The demons are attacking the Agnikund! If it is extinguished, the village is lost.');
    if (s.fire.hp <= 0) gameOver(s, 'fire');
  }
}
/** Mechho Bhoot: sneak to the nearest grain stockpile, grab what he can carry, run for the forest. */
function thiefAI(s, e, def, spd, dt, df) {
  if (e.loot > 0) {
    const k = (spd * 1.1) / (df || 1);
    e.vx = e.x * k; e.vz = e.z * k;
    e.x += e.vx * dt; e.z += e.vz * dt; e.rot = Math.atan2(e.vx, e.vz);
    if (df > territory(s) + 14) { e.dead = true; toast(`The Mechho Bhoot got away with ${e.loot} grain!`, 'warn', 5); }
    return true;
  }
  e.stealT = (e.stealT || 0) - dt;
  if (!e.prey || e.stealT <= 0) {
    e.stealT = 1;
    let best = null, bd = Infinity;
    for (const p of stockpiles(s, def.thief)) {
      if ((stockOf(s, p.b)[def.thief] || 0) < 1) continue;
      const d = distXZ(p.x, p.z, e.x, e.z);
      if (d < bd) { bd = d; best = p; }
    }
    e.prey = best;
  }
  if (!e.prey) return false; // nothing to steal: he haunts people like any bhoot
  const p = e.prey, reach = (p.b ? Math.max(BUILDINGS[p.b.type].fw, BUILDINGS[p.b.type].fd) * 0.5 : 0.4) + 0.8;
  const d = distXZ(p.x, p.z, e.x, e.z) || 1;
  if (d <= reach) {
    const st = stockOf(s, p.b && s.bById.has(p.b.id) ? p.b : null);
    const n = Math.min(def.steal, Math.floor(st[def.thief] || 0), Math.floor(s.res[def.thief]));
    if (n > 0) {
      st[def.thief] -= n; s.res[def.thief] -= n; e.loot = n;
      floater(s, e.x, 1.8, e.z, '-' + n, RES[def.thief].color);
      sfx('whoosh', e.x, e.z);
      toast(`A Mechho Bhoot stole ${n} grain! Catch him before he reaches the forest.`, 'danger', 5);
    }
    e.prey = null;
    return true;
  }
  e.vx = ((p.x - e.x) / d) * spd; e.vz = ((p.z - e.z) / d) * spd;
  e.x += e.vx * dt; e.z += e.vz * dt; e.rot = Math.atan2(e.vx, e.vz);
  return true;
}
/** Nishi: every few seconds she calls a hiding villager by name, drawing them out into the night. */
function nishiCall(s, e, dt, df) {
  e.callT = (e.callT == null ? rand(3, 5) : e.callT) - dt;
  if (e.callT > 0 || df > territory(s) + 8) return;
  e.callT = rand(8, 11);
  let best = null, bd = 18;
  for (const v of s.villagers) {
    if (isDefender(v) || v.entranced > 0 || v.arriving) continue;
    const d = distXZ(v.x, v.z, e.x, e.z) - (v.inside ? 4 : 0); // she prefers those hiding indoors
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return;
  best.entranced = 5; best.callBy = e.id;
  e.atkAnim = 0.4;
  sfx('nishi', e.x, e.z);
  toast(`${best.name} hears the Nishi call their name and walks out into the night!`, 'danger', 5);
}
function updateEnemy(s, e, dt) {
  const def = ENEMIES[e.type];
  e.animT += dt;
  if (e.atkCd > 0) e.atkCd -= dt;
  if (e.hurtT > 0) e.hurtT -= dt;
  if (e.atkAnim > 0) e.atkAnim -= dt;
  const ph = phaseOf(s.t);
  if (ph === 'day' || ph === 'dawn') e.burning = true;
  if (e.burning) {
    e.hp -= (def.boss ? 70 : 28) * dt;
    if (Math.random() < 0.6) emitFire(s, e.x + rand(-def.r, def.r), e.y + rand(0, def.h), e.z + rand(-def.r, def.r));
  }
  let slow = 1;
  e.vuln = 1;
  for (const b of s.buildings) {
    if (!b.done || b.hp <= 0) continue;
    if (b.type === 'lamp' && distXZ(b.x, b.z, e.x, e.z) < 4.5) { slow = 0.6; e.hp -= 2.5 * dt; }
    else if (b.type === 'belltower' && distXZ(b.x, b.z, e.x, e.z) < TOWERS.belltower.range) { slow = Math.min(slow, 0.6); e.vuln = 1.25; }
  }
  if (e.fireT > 0) { // set alight by fire pots or Agni Baan arrows
    e.fireT -= dt;
    e.hp -= (e.fireDps || 3) * dt;
    if (Math.random() < 0.5) emitFire(s, e.x + rand(-def.r, def.r), e.y + rand(0.2, def.h), e.z + rand(-def.r, def.r));
  }
  const df = Math.hypot(e.x, e.z);
  if (df < scorchRadius(s) + def.r && e.y < 2) {
    e.hp -= (5 + s.fire.level * 2) * (s.fire.dim ? 0.4 : 1) * dt;
    if (Math.random() < dt * 3) emitFire(s, e.x, e.y + rand(0.2, def.h), e.z);
  }
  if (e.hp <= 0) return killEnemy(s, e, false);
  const spd = def.speed * slow;
  if (e.burning && !def.boss) { // flee at dawn
    const k = (spd * 0.8 * dt) / (df || 1);
    e.x += e.x * k; e.z += e.z * k; e.rot = Math.atan2(e.x, e.z); e.vx = e.vz = 0;
    return;
  }
  if (def.fly) {
    const tgt = nearestVillager(s, e.x, e.z, 11);
    e.diveT -= dt;
    let tx = 0, tz = 0, wantY = 1.6;
    if (tgt) { tx = tgt.x; tz = tgt.z; const d = distXZ(tx, tz, e.x, e.z); wantY = e.diveT <= 0 && d < 2.5 ? 0.5 : 2.6; }
    e.y += clamp(wantY - e.y, -3.5 * dt, 3.5 * dt);
    const d = distXZ(tx, tz, e.x, e.z);
    if (d > 0.35) { e.vx = ((tx - e.x) / d) * spd; e.vz = ((tz - e.z) / d) * spd; e.x += e.vx * dt; e.z += e.vz * dt; e.rot = Math.atan2(e.vx, e.vz); }
    if (tgt && d <= 0.7 && e.y <= 0.9) { const before = e.atkCd; enemyAttack(s, e, tgt, 'villager'); if (before <= 0) e.diveT = 1.3; }
    if (!tgt && df < 1.6) enemyAttack(s, e, null, 'fire');
    return;
  }
  e.y = e.type === 'bhoot' || def.float ? (def.caller ? 0.3 : 0.15) + Math.sin(e.animT * 3 + e.bob) * 0.12 : 0;
  if (def.thief && thiefAI(s, e, def, spd, dt, df)) return;
  if (def.caller) nishiCall(s, e, dt, df);
  e.thinkT -= dt;
  if (e.thinkT <= 0) {
    e.thinkT = 0.35 + Math.random() * 0.2;
    e.tv = nearestVillager(s, e.x, e.z, 4.5);
    e.tb = null;
    if (!e.tv && e.aggro && !def.ghost) {
      let best = null, bd = 6;
      for (const b of s.buildings) {
        const bdef = BUILDINGS[b.type];
        if (bdef.wall || isFieldType(b.type) || b.hp <= 0) continue;
        const d = distToBuilding(b, e.x, e.z);
        if (d < bd) { bd = d; best = b; }
      }
      e.tb = best;
    }
  }
  if (e.tv && (e.tv.inside || !s.villagers.includes(e.tv))) e.tv = null;
  if (e.tb && !s.bById.has(e.tb.id)) e.tb = null;
  if (e.tv && distXZ(e.tv.x, e.tv.z, e.x, e.z) <= def.reach + def.r * 0.5 + 0.2) return enemyAttack(s, e, e.tv, 'villager');
  if (!e.tv && df <= 1.6 + def.r + s.fire.level * 0.08) return enemyAttack(s, e, null, 'fire');
  if (e.tb && distToBuilding(e.tb, e.x, e.z) <= def.reach) return enemyAttack(s, e, e.tb, 'building');
  let tx = 0, tz = 0;
  if (e.tv) { tx = e.tv.x; tz = e.tv.z; } else if (e.tb) { tx = e.tb.x; tz = e.tb.z; }
  const d = distXZ(tx, tz, e.x, e.z) || 1;
  let dx = (tx - e.x) / d, dz = (tz - e.z) / d;
  if (!def.ghost) {
    const probe = buildingAtPoint(s, e.x + dx * (def.r + 0.3), e.z + dz * (def.r + 0.3));
    if (probe && !isFieldType(probe.type) && probe.hp > 0 && probe !== e.tb) return enemyAttack(s, e, probe, 'building');
  }
  // keep apart from other demons
  for (const o of s.enemies) {
    if (o === e || o.dead || ENEMIES[o.type].fly) continue;
    const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), min = (def.r + ENEMIES[o.type].r) * 0.85;
    if (od > 0.001 && od < min) { dx += (ox / od) * 0.6; dz += (oz / od) * 0.6; }
  }
  const dl = Math.hypot(dx, dz) || 1;
  e.vx = (dx / dl) * spd; e.vz = (dz / dl) * spd;
  e.x += e.vx * dt; e.z += e.vz * dt;
  e.rot = Math.atan2(e.vx, e.vz);
}

/* ---------- ambient life ---------- */
function updateAmbient(s, dt) {
  const ph = phaseOf(s.t);
  const R = territory(s);
  for (const a of s.ambient) {
    a.t -= dt;
    if (a.kind === 'cow') {
      a.sit = ph !== 'day';
      if (a.sit) { a.walk = false; continue; }
      if (a.t <= 0) {
        const ang = Math.random() * Math.PI * 2, r = rand(4.5, R - 1.5);
        a.tx = Math.cos(ang) * r; a.tz = Math.sin(ang) * r; a.t = rand(6, 14);
      }
      a.walk = !moveTo(a, a.tx, a.tz, 0.45, dt);
      const ar = Math.hypot(a.x, a.z);
      if (ar < 3.2) { a.x *= 3.2 / (ar || 1); a.z *= 3.2 / (ar || 1); }
    } else if (a.kind === 'peacock') {
      if (ph !== 'day') { a.hidden = true; continue; }
      if (a.hidden) { a.hidden = false; const ang = Math.random() * Math.PI * 2; a.x = Math.cos(ang) * (R + 3); a.z = Math.sin(ang) * (R + 3); a.tx = a.x; a.tz = a.z; }
      if (a.fan > 0) { a.fan -= dt; a.walk = false; continue; }
      if (a.t <= 0) {
        if (Math.random() < 0.3) { a.fan = rand(3, 5); a.t = 0; continue; }
        const ang = Math.atan2(a.z, a.x) + rand(-0.3, 0.3), r = rand(R + 1.5, R + 9);
        a.tx = Math.cos(ang) * r; a.tz = Math.sin(ang) * r; a.t = rand(4, 9);
      }
      a.walk = !moveTo(a, a.tx, a.tz, 0.7, dt);
    }
  }
}

/* ---------- day cycle events ---------- */
function onDusk(s) {
  if (s.demo) { s.spawnQueue = []; return; }
  const need = s.villagers.length * 4;
  if (s.res.food >= need) {
    s.res.food -= need;
    s.hungry = false;
    floater(s, 0, 3, 0, '-' + need, RES.food.color);
  } else {
    s.res.food = 0;
    s.hungry = true;
    for (const v of s.villagers) v.hp = Math.max(1, v.hp - 8);
    toast('Not enough grain for the evening meal! The hungry villagers work slower.', 'warn', 7);
  }
  const w = makeWave(s);
  s.spawnQueue = w.q;
  s.fronts = w.fronts;
  const names = [];
  s.fronts.forEach((f, i) => {
    const n = s.spawnQueue.filter((q) => q.front === i).length;
    if (n) { const d = dirXZ(f.a); names.push(`${n} from the ${compassOf(d.x, d.z)}`); }
  });
  toast(`Sandhya — dusk falls. Demons gather: ${names.join(', ')}. Everyone to the fire!`, 'danger', 8);
  sfx('drum');
  s.defT = 0;
  if (s.day === 1) tip('night1', 'At night demons come out of the dark forest. The holy fire scorches demons that come close — but train Sainik (warriors) to defend!');
}
function onNight(s) { sfx('night'); }
function onDawn(s) {
  sfx('conch');
  if (s.enemies.length) toast('Dawn breaks! The sun burns the demons away.', 'good');
  else toast('Dawn breaks over the village. Shubh prabhat!', 'good');
}
function arrivals(s) {
  const cap = housing(s), pop = s.villagers.length;
  if (pop >= cap) { if (pop < 50) toast('Travellers passed by, but there was no shelter for them. Build more Jhopdis!', 'info', 6); return; }
  if (s.hungry) { toast('Travellers heard your village is hungry and kept walking.', 'warn'); return; }
  const n = Math.min(cap - pop, randi(1, 2 + Math.floor(s.fire.level / 2)));
  const names = [];
  for (let i = 0; i < n; i++) names.push(spawnTraveller(s, i).name);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  toast(`${list} ${names.length > 1 ? 'have' : 'has'} arrived seeking shelter.`, 'good', 6);
  sfx('chime');
}
function onNewDay(s) {
  s.day++;
  for (const t of s.trees) if (t.stump) { t.regrow--; if (t.regrow <= 0) { t.stump = false; t.wood = t.maxWood; s.treeVer++; } }
  const R = territory(s);
  if (Math.random() < 0.6) {
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(R + 3, 42);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r > islandR(x, z) - 6 || s.rocks.some((o) => distXZ(o.x, o.z, x, z) < 3) || s.trees.some((t) => distXZ(t.x, t.z, x, z) < 1.2)) continue;
      s.rocks.push(makeRock(s, x, z, randi(0, 7), randi(36, 70)));
      s.rockVer++;
      break;
    }
  }
  s.weather = s.day >= 3 && s.weather !== 'rain' && Math.random() < 0.22 ? 'rain' : 'clear';
  if (s.weather === 'rain') toast('Monsoon rains! The fields flourish, but the Agnikund burns wood faster.', 'info', 7);
  s.festival = s.day % 7 === 0;
  if (s.festival) toast('Deepavali! Diyas light every home. Tonight demons are weaker and villagers stronger.', 'good', 8);
  if (s.day > 2 && Math.random() < 0.14) {
    s.res.gold += 8;
    s.fire.hp = Math.min(fireLv(s).hp, s.fire.hp + 60);
    toast('A wandering sadhu blessed the Agnikund. +8 gold, and the flame is renewed.', 'good', 7);
  }
  s.fronts = [];
  arrivals(s);
  if (s.day - 1 >= WIN_DAY && !s.won) {
    s.won = true;
    if (typeof UI !== 'undefined') UI.victory();
  }
  if (s.day === 2) tip('day2', 'Build an Akhara to train Sainik (warriors). Drag Bamboo Walls (Baad) around the edge of your land to hold demons back.');
  if (s.day === 4) tip('day4', 'Vetala — flying spirits — fly over walls. Dhanurdhar (archers) can shoot them down.');
  if (s.day % 5 === 4) toast('The elders warn: Mahasura, the Demon King, will rise tomorrow night!', 'danger', 8);
  Game.save();
}
function gameOver(s, reason) {
  if (s.over || s.demo) return;
  s.over = true;
  s.overReason = reason;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
  sfx('gameover');
  if (typeof UI !== 'undefined') setTimeout(() => UI.gameOver(reason), 1200);
}

/* ---------- main update ---------- */
function updateFire(s, dt) {
  const FL = fireLv(s);
  const f = s.fire;
  f.fuel = Math.max(0, f.fuel - FL.burn * (s.weather === 'rain' ? 1.6 : 1) * dt);
  f.feedT -= dt;
  if (f.fuel <= FL.fuelMax - 6 && s.res.wood >= 6 && f.feedT <= 0) {
    s.res.wood -= 6;
    f.fuel = Math.min(FL.fuelMax, f.fuel + 6);
    f.feedT = 1;
    floater(s, 0, 2.6, 0, '-6', RES.wood.color);
    emit(s, 0, 1.0, 0, 14, { spread: 0.4, vx: 1.5, vyMin: 2.5, vyMax: 6, life: 0.9, colors: ['#ffcc33', '#ff8a1f', '#fff3b0'], g: 2, add: true });
    sfx('whoosh', 0, 0);
  }
  const wasDim = f.dim;
  f.dim = f.fuel <= 0.01;
  if (f.dim && !wasDim) toast('The Agnikund is starving for wood! Its light weakens. Assign more Lakadhara.', 'danger', 7);
  const target = f.dim ? 0.35 : 0.72 + 0.28 * (f.fuel / FL.fuelMax);
  f.intensity += (target - f.intensity) * Math.min(1, dt * 2);
  if (f.hurtT > 0) f.hurtT -= dt;
  if (phaseOf(s.t) === 'day' && !f.dim) f.hp = Math.min(FL.hp, f.hp + 3 * dt);
  if (Math.random() < dt * (6 + s.fire.level * 2) * f.intensity) emit(s, rand(-0.25, 0.25), 1.6 + 0.6 * f.intensity, rand(-0.25, 0.25), 1, { spread: 0.1, vx: 0.4, vyMin: 1.5, vyMax: 3.2, life: 1.3, colors: ['#ffcc33', '#ff8a1f', '#fff3b0'], g: -0.4, add: true });
  if (Math.random() < dt * 2.5) emit(s, rand(-0.2, 0.2), 2.4 + 0.6 * f.intensity, rand(-0.2, 0.2), 1, { spread: 0.1, vx: 0.15, vyMin: 0.5, vyMax: 1.0, life: 3.5, colors: ['#6b6b78', '#7d7d88', '#585862'], bx: 0.25 });
}
function updateTips(s, dt) {
  s.tipT += dt;
  if (s.tipT < 1) return;
  s.tipT = 0;
  const ph = phaseOf(s.t);
  if (s.day === 1 && s.t > 9) tip('camera', 'Look around: drag or WASD to move, mouse wheel to zoom, right-drag or Q / E to rotate the view.');
  if (s.day === 1 && s.t > 4) tip('jobs', 'Every job needs a workplace. Press + next to Mistri (2 builders work from the Agnikund), then press Build at the top and place a Lakdi Taal (woodcutter camp) near the trees for your Lakadhara.');
  if (s.day === 1 && s.t > 40 && !s.buildings.some((b) => isFieldType(b.type))) tip('field', 'Press Build at the top and choose a Khet (Field), then assign Kisan (farmers). Each villager eats 4 grain every evening.');
  if (s.buildings.some((b) => !b.done) && jobCount(s, 'build') === 0 && s.t > 3) tip('needBuilder', 'Construction sites need a Mistri (builder). Assign one in the Kaam panel.');
  if (s.fire.level < 5 && canAfford(s, FIRE_LEVELS[s.fire.level + 1].cost)) tip('fireUp' + s.fire.level, 'You can upgrade the Agnikund! Click the fire to grow your land and unlock new buildings.');
  if (s.villagers.length >= housing(s) && s.day >= 2 && ph === 'day') tip('housing', 'Your village is full. Build a Jhopdi (hut) so travellers can settle here.');
}
function updateParticles(s, dt) {
  for (const p of s.particles) {
    p.life -= dt;
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.02 && p.g > 0) { p.y = 0.02; p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
  }
  s.particles = s.particles.filter((p) => p.life > 0);
  for (const f of s.floaters) { f.life -= dt; f.y += 0.8 * dt; }
  s.floaters = s.floaters.filter((f) => f.life > 0);
  for (const t of s.trees) if (t.shake > 0) t.shake -= dt;
}

const Game = {
  newGame() {
    S = newState();
    genWorld(S);
    for (let i = 0; i < 4; i++) {
      const p = seatPos(i * 5);
      S.villagers.push(makeVillager(S, p.x, p.z, i % 2 ? 'f' : 'm'));
    }
    S.stats.maxPop = S.villagers.length;
    setTimeout(() => toast('Namaste, Mukhiya! Keep the sacred Agnikund burning and protect your people from the demons of the night.', 'tip', 9), 600);
    return S;
  },
  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  },
  save() {
    if (!S || S.over || S.demo) return;
    try {
      const s = S;
      const r2 = (n) => Math.round(n * 100) / 100;
      const data = {
        v: 2, seed: s.seed, day: s.day, t: s.t, res: s.res,
        fire: { level: s.fire.level, hp: s.fire.hp, fuel: s.fire.fuel },
        upgrades: s.upgrades, stats: s.stats, weather: s.weather, festival: s.festival, hungry: s.hungry, won: s.won,
        tips: s.tips, nextId: s.nextId, spawnQueue: s.spawnQueue, fronts: s.fronts, grove: s.grove,
        villagers: s.villagers.map((v) => ({ id: v.id, name: v.name, look: v.look, x: r2(v.x), z: r2(v.z), job: v.job, hp: v.hp, maxHp: v.maxHp, carry: v.carry, carryAmt: v.carryAmt, gold: v.gold, workplace: v.workplace, arriving: v.arriving, ax: v.ax, az: v.az, home: v.home, inside: v.inside, shelter: v.shelter, fearT: v.fearT })),
        buildings: s.buildings.map((b) => ({ id: b.id, type: b.type, cx: b.cx, cz: b.cz, rot: b.rot, done: b.done, progress: b.progress, hp: b.hp, maxHp: b.maxHp, grow: b.grow, level: b.level, upgrading: b.upgrading, upProg: b.upProg, stock: b.stock })),
        fireStock: s.fireStock,
        armory: s.armory,
        trees: s.trees.map((t) => [t.id, r2(t.x), r2(t.z), t.type, t.variant, t.wood, t.maxWood, t.stump ? 1 : 0, t.regrow, r2(t.rot), r2(t.scale), t.sacred ? 1 : 0]),
        rocks: s.rocks.map((r) => [r.id, r2(r.x), r2(r.z), r.variant, r.stone, r.maxStone, r2(r.rot), r2(r.scale)]),
        enemies: s.enemies.filter((e) => !e.dead).map((e) => ({ id: e.id, type: e.type, x: e.x, z: e.z, y: e.y, hp: e.hp, maxHp: e.maxHp, variant: e.variant, aggro: e.aggro, loot: e.loot || 0 })),
        ambient: s.ambient.map((a) => ({ kind: a.kind, x: a.x, z: a.z })),
        loot: s.loot,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { /* storage unavailable — game continues unsaved */ }
  },
  load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
    if (!data || data.v !== 2) return false;
    const s = newState(data.seed);
    Object.assign(s, { day: data.day, t: data.t, res: data.res, upgrades: data.upgrades || {}, stats: data.stats, weather: data.weather, festival: data.festival, hungry: data.hungry, won: data.won, tips: data.tips || {}, nextId: data.nextId, spawnQueue: data.spawnQueue || [], fronts: data.fronts || [], grove: data.grove || null });
    s.fire.level = data.fire.level; s.fire.hp = data.fire.hp; s.fire.fuel = data.fire.fuel;
    s.villagers = data.villagers.map((d) => Object.assign(makeVillagerRaw(), d, { wx: d.x, wz: d.z }));
    s.buildings = data.buildings.map((b) => Object.assign({ cd: 0, offerT: 0 }, b, bCenterOf(b.type, b.cx, b.cz)));
    s.trees = data.trees.map((a) => ({ id: a[0], x: a[1], z: a[2], type: a[3], variant: a[4], wood: a[5], maxWood: a[6], stump: !!a[7], regrow: a[8], rot: a[9], scale: a[10], sacred: !!a[11], shake: 0 }));
    s.rocks = data.rocks.map((a) => ({ id: a[0], x: a[1], z: a[2], variant: a[3], stone: a[4], maxStone: a[5], rot: a[6], scale: a[7] }));
    s.enemies = (data.enemies || []).map((d) => Object.assign({ vx: 0, vz: 0, rot: 0, atkCd: 1, animT: 0, hurtT: 0, atkAnim: 0, burning: false, dead: false, diveT: 0, bob: rand(0, 6), thinkT: 0, tv: null, tb: null }, d));
    s.ambient = (data.ambient || []).map((a) => ({ kind: a.kind, x: a.x, z: a.z, tx: a.x, tz: a.z, rot: 0, t: 0, fan: 0, sit: false }));
    s.loot = data.loot || [];
    s.armory = data.armory || {};
    s.fireStock = data.fireStock || {};
    rebuildGrid(s);
    syncStock(s); // older saves: everything starts on the Agnikund heap
    S = s;
    fixJobOverflow(s); // older saves: jobs now need their workplace buildings
    S = s;
    return true;
  },
  update(dt) {
    const s = S;
    if (!s || s.over) return;
    s.time += dt;
    const prev = s.t;
    s.t += dt;
    if (prev < DUSK_T && s.t >= DUSK_T) onDusk(s);
    if (prev < NIGHT_T && s.t >= NIGHT_T) onNight(s);
    if (prev < DAWN_T && s.t >= DAWN_T) onDawn(s);
    if (s.t >= DAY_LEN) { s.t -= DAY_LEN; onNewDay(s); }
    const ph = phaseOf(s.t);
    while (s.spawnQueue.length && s.spawnQueue[0].at <= s.t && ph === 'night') {
      const q = s.spawnQueue.shift();
      const f = s.fronts[q.front] || { a: Math.random() * Math.PI * 2 };
      spawnEnemy(s, q.type, f.a);
      if (q.type === 'boss') { const d = dirXZ(f.a); toast(`MAHASURA, the Demon King, rises in the ${compassOf(d.x, d.z)}!`, 'danger', 8); sfx('roar'); }
    }
    if (ph === 'dawn' || ph === 'day') s.spawnQueue.length = 0;
    updateFire(s, dt);
    if (s.over) return;
    s.stockT = (s.stockT || 0) - dt;
    if (s.stockT <= 0) { s.stockT = 0.2; syncStock(s); } // reconcile stockpiles five times a second, not every frame
    s.defT -= dt;
    if (s.defT <= 0) { s.defT = 0.5; assignDefenders(s); }
    s.homeT = (s.homeT || 0) - dt;
    if (s.homeT <= 0) { s.homeT = 1; assignHomes(s); }
    let ci = 0;
    const civ = s.villagers.filter((v) => !isDefender(v)).length;
    for (const v of s.villagers) if (!isDefender(v)) v.seat = seatPos(ci++, civ);
    for (const v of s.villagers.slice()) updateVillager(s, v, dt, ph);
    for (const b of s.buildings) {
      const T = TOWERS[b.type];
      if (!T || !b.done || b.hp <= 0) continue;
      b.cd -= dt;
      if (b.cd > 0) continue;
      if (T.kind === 'aura') { // the bell rings out while demons are near
        if (nearestEnemy(s, b.x, b.z, T.range, false)) { b.cd = 3; b.ringT = 1; sfx('bell', b.x, b.z); }
        continue;
      }
      const t = nearestEnemy(s, b.x, b.z, T.range, false);
      if (!t) continue;
      if (T.kind === 'arrow') { shootArrow(s, b.x, T.y, b.z, t, T.dmg * (s.upgrades.bow ? 1.5 : 1), false); sfx('bow', b.x, b.z); }
      else {
        const p = shootArrow(s, b.x, T.y, b.z, t, T.dmg, false, T.kind, T.kind === 'ball' ? 12 : 8);
        p.splash = T.splash; p.burn = T.burn;
        sfx(T.kind === 'ball' ? 'cannon' : 'whoosh', b.x, b.z);
        if (T.kind === 'ball') emit(s, b.x, T.y, b.z, 10, { spread: 0.3, vx: 0.8, vyMin: 0.5, vyMax: 1.5, life: 1.5, colors: ['#9a9aa4', '#7d7d88', '#c8c8d0'], g: -0.4 });
      }
      b.cd = T.cd;
      b.fireT = 0.35;
    }
    for (const e of s.enemies) if (!e.dead) updateEnemy(s, e, dt);
    s.enemies = s.enemies.filter((e) => !e.dead);
    updateProjectiles(s, dt);
    updateLoot(s, dt);
    for (const b of s.buildings) { if (b.popT > 0) b.popT -= dt; if (b.fireT > 0) b.fireT -= dt; if (b.ringT > 0) b.ringT -= dt; }
    updateParticles(s, dt);
    updateAmbient(s, dt);
    updateTips(s, dt);
    s.stats.maxPop = Math.max(s.stats.maxPop, s.villagers.length);
  },
};
