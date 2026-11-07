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
/** The island is 25% bigger than it first was (MAP_SCALE); village land grew 10% (LAND_K, see FIRE_LEVELS). */
const MAP_SCALE = 1.25, LAND_K = 1.1;
function islandR(x, z) { const a = Math.atan2(z, x); return (50 + 5 * Math.sin(3 * a + 1) + 3 * Math.sin(5 * a + 2) + 2 * Math.sin(7 * a)) * MAP_SCALE; }
const COMPASS = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
function compassOf(x, z) { const a = Math.atan2(x, -z); return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }
function dirXZ(a) { return { x: Math.sin(a), z: -Math.cos(a) }; } // compass angle → unit vector (0 = north = -z)

/* ---------- state creation ---------- */
function newState(seed) {
  return {
    seed: seed || (Math.random() * 1e9) | 0,
    day: 1, t: 6, time: 0,
    res: { wood: 65, stone: 20, food: 45, gold: 10, clay: 0, ore: 0, brick: 0, charcoal: 0, iron: 0 },
    fire: { level: 1, hp: FIRE_LEVELS[1].hp, fuel: FIRE_LEVELS[1].fuelMax, dim: false, intensity: 1, hurtT: 0, feedT: 0 },
    villagers: [], buildings: [], trees: [], rocks: [], enemies: [], ponds: [],
    projectiles: [], particles: [], floaters: [], fx: [], shake: 0, hitStop: 0, ambient: [], loot: [], armory: {},
    spawnQueue: [], fronts: [], upgrades: {}, nextId: 1,
    stats: { killed: 0, lost: 0, built: 0, maxPop: 0, bosses: 0 },
    weather: 'clear', festival: false, hungry: false,
    over: false, won: false, tips: {}, tipT: 0, defT: 0,
    grid: new Int32Array(GRID * GRID), bById: new Map(), treeVer: 1, rockVer: 1, buildVer: 1,
  };
}

/**
 * Plant the forest: sparse round the village, thick beyond, palms on the beach. Only where the land lies
 * further out than minR (an older, smaller island's forest stays as it was when a save is loaded).
 */
function plantForest(s, rnd, minR) {
  const pickW = (w) => { let tot = 0; for (const k in w) tot += w[k]; let r = rnd() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return Object.keys(w)[0]; };
  const step = 1.9, ext = Math.ceil(61 * MAP_SCALE), K = LAND_K;
  for (let gx = -ext; gx <= ext; gx += step) {
    for (let gz = -ext; gz <= ext; gz += step) {
      const x = gx + (rnd() - 0.5) * step * 0.9, z = gz + (rnd() - 0.5) * step * 0.9;
      const r = Math.hypot(x, z), edge = islandR(x, z) - 4.5;
      if (r < 6 || r > edge || r < minR * (edge + 4.5) / MAP_SCALE) continue;
      const meadow = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.7) + Math.sin(x * 0.05 - z * 0.07) * 0.6;
      let p = r < 9 * K ? 0.12 : r < 13 * K ? 0.28 : r < 18 * K ? 0.5 : 0.82;
      if (meadow > 0.7 && r < 40) p *= 0.2;
      if (rnd() > p) continue;
      const beach = r > edge - 5;
      const type = beach ? pickW({ palm: 6, neem: 1 }) : r < 22 ? pickW({ mango: 3, neem: 3, palm: 3, banyan: 1 }) : pickW({ palm: 2, banyan: 2, neem: 3, mango: 2 });
      s.trees.push(makeTree(s, x, z, type, Math.floor(rnd() * 3), rnd));
    }
  }
}
function genWorld(s) {
  const rnd = mulberry32(s.seed);
  plantForest(s, rnd, 0);
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2, r = (i < 6 ? 6.6 : 9.9) + rnd() * (i < 6 ? 4.4 : 47);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (r > islandR(x, z) - 6) continue;
    s.trees = s.trees.filter((t) => distXZ(t.x, t.z, x, z) > 1.3);
    const rock = makeRock(s, x, z, Math.floor(rnd() * 8), 36 + Math.floor(rnd() * 40), rnd);
    if (r > 12 && rnd() < 0.3) rock.ore = true; // rusty iron boulders, out beyond the first clearing
    s.rocks.push(rock);
  }
  // make sure a few ore boulders lie within reach of a level-2 village
  if (!s.rocks.some((k) => k.ore && Math.hypot(k.x, k.z) < 19)) {
    for (const k of s.rocks.filter((q) => Math.hypot(q.x, q.z) > 10 && Math.hypot(q.x, q.z) < 19).slice(0, 3)) k.ore = true;
  }
  // Pavitra Van — the sacred grove where homeless villagers hide from demons
  const ga = rnd() * Math.PI * 2, gd = 19;
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
  genPonds(s, rnd);
  s.ambient.push({ kind: 'cow', x: -4, z: 5, rot: 0, t: 0, tx: -4, tz: 5, sit: false });
  s.ambient.push({ kind: 'cow', x: 5, z: -4, rot: 2, t: 3, tx: 5, tz: -4, sit: false });
  s.ambient.push({ kind: 'peacock', x: 15, z: 8, rot: 0, t: 0, tx: 15, tz: 8, fan: 0 });
}
/*
 * Ponds lie out in the meadows: nobody walks or builds on the water (see navGrid and canPlace), and a
 * Machhli Ghat on the bank lets Machhuare fish there. The first lies just past the first clearing, within
 * reach once the Agnikund reaches level 2; the rest further out (claim them with towers or a bigger fire).
 */
function genPonds(s, rnd) {
  s.ponds = s.ponds || [];
  for (let tries = 0; tries < 500 && s.ponds.length < 4; tries++) {
    const first = s.ponds.length === 0;
    const a = rnd() * Math.PI * 2, d = first ? 12.2 + rnd() * 2.8 : 17 + rnd() * 26;
    const x = Math.cos(a) * d, z = Math.sin(a) * d, r = first ? 2.4 + rnd() * 0.5 : 2.2 + rnd() * 1.3;
    if (d + r > islandR(x, z) - 9) continue;
    if (s.grove && distXZ(x, z, s.grove.x, s.grove.z) < s.grove.r + r + 3) continue;
    if (s.ponds.some((p) => distXZ(x, z, p.x, p.z) < p.r + r + 6)) continue;
    let clash = false;
    for (let i = Math.floor(x - r - 1); i <= Math.ceil(x + r + 1) && !clash; i++) for (let j = Math.floor(z - r - 1); j <= Math.ceil(z + r + 1); j++) { const k = cellIdx(i, j); if (k >= 0 && s.grid[k]) { clash = true; break; } }
    if (clash) continue;
    s.ponds.push({ id: s.nextId++, x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: Math.round(r * 100) / 100, rot: Math.round(rnd() * 314) / 100 });
    s.trees = s.trees.filter((t) => distXZ(t.x, t.z, x, z) > r + 1.1);
    s.rocks = s.rocks.filter((k) => distXZ(k.x, k.z, x, z) > r + 1.4);
  }
  s.treeVer++; s.rockVer++;
}
/** The pond whose water covers this point (m widens it), if any. */
function pondAt(s, x, z, m) { for (const p of s.ponds || []) if (distXZ(x, z, p.x, p.z) < p.r + (m || 0)) return p; return null; }
/** The pond with the nearest bank, if its bank is within reach. */
function pondNear(s, x, z, reach) { let best = null, bd = reach == null ? Infinity : reach; for (const p of s.ponds || []) { const d = distXZ(x, z, p.x, p.z) - p.r; if (d < bd) { bd = d; best = p; } } return best; }
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
/** Villagers a home holds: huts gain 1 bed per upgrade, big houses 2. */
function homeCap(b) { const h = BUILDINGS[b.type].housing || 0; return h ? h + (bLevel(b) - 1) * (h > 3 ? 2 : 1) : 0; }
function housing(s) {
  let h = fireLv(s).housing;
  for (const b of s.buildings) if (b.done && BUILDINGS[b.type].housing) h += homeCap(b);
  return h;
}
function canAfford(s, cost) { for (const k in cost) if ((s.res[k] || 0) < cost[k]) return false; return true; }
/** Pay a cost. Goods are taken from the stockpiles nearest to (x, z) — the build site — or nearest the Agnikund. */
function spend(s, cost, x, z) { for (const k in cost) { s.res[k] -= cost[k]; takeStock(s, k, cost[k], x || 0, z || 0); } }
function refund(s, cost, f) { for (const k in cost) s.res[k] += Math.floor(cost[k] * f); }
/** Floating text. cls: 'dmg' / 'dmg crit' / 'dmg hurt' / 'dmg heal' numbers, 'tag' (Blocked, Stunned), 'callout' (moves, streaks). */
function floater(s, x, y, z, text, color, cls) {
  const call = !!cls && cls.startsWith('callout');
  const life = !cls ? 1.5 : call ? (cls.includes('ult') ? 1.8 : 1.4) : cls === 'tag' ? 0.9 : 0.8;
  if (call || cls === 'tag') { // stack instead of printing on top of one another
    for (const f of s.floaters) if ((f.cls === cls || (call && f.cls.startsWith('callout'))) && Math.abs(f.x - x) < 1.6 && Math.abs(f.z - z) < 1.2 && Math.abs(f.y - y) < 0.45) y = f.y + 0.45;
  }
  s.floaters.push({ x, y, z, text, color, cls: cls || '', life, max: life, vx: cls && cls.startsWith('dmg') ? rand(-0.35, 0.35) : 0 });
  if (s.floaters.length > 70) { const i = s.floaters.findIndex((f) => f.cls.startsWith('dmg')); s.floaters.splice(i >= 0 ? i : 0, 1); }
}
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
/** Bhandar bays: each holds one good the player picks (4 at level 1, 6 at level 2, 8 at level 3). */
function storeBays(b) {
  const n = STORE_BAYS[bLevel(b)] || 4;
  if (!b.bays) b.bays = RES_ORDER.slice();
  while (b.bays.length < n) b.bays.push(RES_ORDER[b.bays.length % RES_ORDER.length]);
  if (b.bays.length > n) b.bays.length = n;
  return b.bays;
}
function stockCap(b, r) {
  if (!b) return Infinity;
  if (b.type === 'store') { let n = 0; for (const x of storeBays(b)) if (x === r) n++; return n * BAY_CAP[bLevel(b)]; }
  const c = STOCK_CAP[b.type];
  return c && c[r] ? Math.round(c[r] * (STOCK_MULT[bLevel(b)] || 1)) : 0;
}
/** Does this stockpile take this good? (a Bhandar only takes the goods its bays are set to) */
function acceptsRes(b, r) { const d = BUILDINGS[b.type]; return !!(d.drop && d.drop.includes(r) && (b.type !== 'store' || storeBays(b).includes(r))); }
/** Point one Bhandar bay at a different good; anything that no longer fits spills onto the Agnikund heap. */
function setBay(s, b, i, r) {
  const bays = storeBays(b);
  if (i < 0 || i >= bays.length || !RES[r]) return;
  bays[i] = r;
  const st = stockOf(s, b), heap = stockOf(s, null);
  for (const k of RES_ORDER) { const over = (st[k] || 0) - stockCap(b, k); if (over > 0) { st[k] -= over; heap[k] = (heap[k] || 0) + over; } }
}
function stockOf(s, b) { if (!b) return s.fireStock || (s.fireStock = {}); return b.stock || (b.stock = {}); }
function stockFree(b, r) { return stockCap(b, r) - ((b && b.stock && b.stock[r]) || 0); }
/** Every place holding a good: the Agnikund heap first, then finished stockpile buildings. */
function stockpiles(s, r) {
  const out = [{ b: null, x: FIRE_HEAP[r].x, z: FIRE_HEAP[r].z }];
  for (const b of s.buildings) { const d = BUILDINGS[b.type]; if (b.done && d.drop && d.drop.includes(r) && (acceptsRes(b, r) || (b.stock && b.stock[r] > 0))) out.push({ b, x: b.x, z: b.z }); }
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
  const goods = !b ? RES_ORDER.filter((r) => !RES[r].mat || (stockOf(s, null)[r] || 0) >= 1) : b.type === 'store' ? RES_ORDER.filter((r) => storeBays(b).includes(r) || (b.stock && b.stock[r] >= 1)) : BUILDINGS[b.type].drop || [];
  const st = stockOf(s, b);
  return goods.map((r) => ({ r, n: Math.floor(st[r] || 0), cap: b ? stockCap(b, r) : Infinity }));
}
const isDefender = (v) => slotKey(v.job) === 'army';
const isMelee = (v) => isDefender(v) && !RANGED_JOBS.has(v.job);
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
function bSlots(b, job) {
  const sl = BUILDINGS[b.type].slots, k = slotKey(job);
  if (!b.done || !sl || !sl[k]) return 0;
  return sl[k] + (bLevel(b) - 1) * (k === 'army' ? 2 : 1); // each upgrade adds a place (two for soldiers)
}
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
    if (e.hidden > 0) continue; // Kalanemi, vanished into his maya
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
  if (v.armour && slotKey(job) !== 'army') takeOffArmour(s, v); // only soldiers wear armour
  v.job = job; v.target = null; v.workplace = null; v.workT = 0; v.foe = null; v.atk = null; v.patient = null; v.healTo = null; v.abilT = 3;
  const st = SOLDIERS[job];
  const newMax = (st ? st.hp + (job === 'warrior' && s.upgrades.talwar ? 30 : 0) : 40) + (armourOf(v) ? armourOf(v).hp : 0);
  v.hp = Math.min(newMax, v.hp + Math.max(0, newMax - v.maxHp));
  v.maxHp = newMax;
}
function assignJob(s, job) {
  const J = JOBS[job];
  if (J.weapon) return equipSoldier(s, job);
  if (job === 'archer' && !s.buildings.some((b) => b.type === 'range' && b.done)) { toast('Build a Dhanush Shala (Archery Range) to train Dhanurdhar.', 'warn'); return false; }
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
    const base = weaponBase(J.weapon), list = s.villagers.filter((o) => o.job === base);
    if (!list.length) { toast(base === 'archer' ? `Train a Dhanurdhar at a Dhanush Shala first, then hand them the ${W.name}.` : `Train a Sainik at the Akhara first, then hand them the ${W.name}.`, 'danger', 5); sfx('error'); return false; }
    v = list[0];
  }
  if (v.job !== weaponBase(J.weapon)) { toast(weaponBase(J.weapon) === 'archer' ? `Only a Dhanurdhar (archer) can take up a ${W.name}.` : `Only a Sainik (foot soldier) can take up a ${W.name}.`, 'warn'); return false; }
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
  setJob(s, list[list.length - 1], JOBS[job].weapon ? weaponBase(JOBS[job].weapon) : 'idle'); // special soldiers step back down to Sainik or Dhanurdhar
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
  const herbal = W.at === 'vaidyashala';
  sfx(W.at === 'forge' ? 'anvil' : herbal ? 'heal' : 'saw', b.x, b.z);
  emit(s, b.x, 1.2, b.z, 10, { spread: 0.5, vx: 1.2, vyMin: 1, vyMax: 3, life: 0.6, colors: W.at === 'forge' ? ['#ffcc33', '#ff8a1f', '#fff3b0'] : herbal ? ['#8ef09a', '#d8ffd0', '#5fd36f'] : ['#e8c896', '#c89a5e'], g: herbal ? -0.5 : 6, add: W.at === 'forge' || herbal });
  tip('equip', `${W.name} ready! In Kaam, press + next to ${JOBS[W.job].name} to hand it to a ${JOBS[weaponBase(key)].name}.`);
  return made;
}
/* ---------- armour ---------- */
const armourOf = (v) => (v && v.armour && ARMOURS[v.armour]) || null;
const armourTier = (v) => (armourOf(v) ? armourOf(v).tier : 0);
/** Can the Lohar forge this armour now (a finished Lohar of high enough level)? */
function armourReady(s, key) { const A = ARMOURS[key]; return s.buildings.some((x) => x.type === 'forge' && x.done && bLevel(x) >= A.lvl); }
function craftArmour(s, key, n) {
  const A = ARMOURS[key];
  const b = s.buildings.find((x) => x.type === 'forge' && x.done && bLevel(x) >= A.lvl);
  if (!b) return 0;
  if (!canAfford(s, A.cost)) { notAfford(s, A.cost, `forge a ${A.name}`); return 0; }
  let made = 0;
  for (let i = 0; i < (n || 1) && canAfford(s, A.cost); i++) { spend(s, A.cost, b.x, b.z); made++; }
  s.armory[key] = (s.armory[key] || 0) + made;
  floater(s, b.x, 2.6, b.z, '+' + made + ' ' + A.name, '#e2e7ec', 'tag');
  sfx('anvil', b.x, b.z);
  emit(s, b.x, 1.2, b.z, 12, { spread: 0.5, vx: 1.2, vyMin: 1, vyMax: 3, life: 0.6, colors: ['#ffcc33', '#ff8a1f', '#e2e7ec'], g: -0.5, add: true });
  tip('armour', `${A.name} ready! Press “Fit armour” at the Lohar to dress your soldiers in the best armour you have, or fit it to one soldier from their panel.`);
  return made;
}
/** Put a piece from the armoury on a soldier (their old piece goes back). */
function wearArmour(s, v, key, quiet) {
  const A = ARMOURS[key];
  if (!A || !isDefender(v) || !(s.armory[key] > 0) || v.armour === key) return false;
  if (v.armour) takeOffArmour(s, v);
  s.armory[key]--;
  v.armour = key; v.maxHp += A.hp; v.hp += A.hp;
  if (!quiet) {
    toast(`${v.name} puts on the ${A.name} (${A.en}).`, 'good');
    sfx('anvil', v.x, v.z);
    emit(s, v.x, 1.0, v.z, 10, { spread: 0.3, vx: 1, vyMin: 1, vyMax: 2.5, life: 0.8, colors: ['#e2e7ec', '#fff3b0', '#b9c3cf'], g: -0.5, add: true });
  }
  return true;
}
function takeOffArmour(s, v) {
  const A = armourOf(v);
  if (!A) { v.armour = null; return; }
  s.armory[v.armour] = (s.armory[v.armour] || 0) + 1;
  v.armour = null;
  v.maxHp = Math.max(1, v.maxHp - A.hp); v.hp = Math.min(v.hp, v.maxHp);
}
/** The Lohar dresses the soldiers: the best pieces go to whoever wears the least, until the armoury runs out. */
function fitArmour(s, quiet) {
  let n = 0;
  for (let t = ARMOUR_ORDER.length - 1; t >= 0; t--) {
    const key = ARMOUR_ORDER[t], tier = ARMOURS[key].tier;
    while (s.armory[key] > 0) {
      let best = null;
      for (const v of s.villagers) if (isDefender(v) && armourTier(v) < tier && (!best || armourTier(v) < armourTier(best))) best = v;
      if (!best) break;
      wearArmour(s, best, key, true); n++;
    }
  }
  if (!quiet) {
    if (n) { toast(`The Lohar fitted ${n} soldier${n > 1 ? 's' : ''} with armour.`, 'good'); sfx('anvil'); }
    else toast(s.villagers.some(isDefender) ? 'Every soldier already wears the best armour in the armoury. Forge more at the Lohar.' : 'No soldiers to fit: train Sainik or Dhanurdhar first.', 'info');
  }
  return n;
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
  toast(`Upgrading the ${def.name} to level ${bLevel(b) + 1}. Its workers, your Mistri and any helpers you send will build it by day.`, 'info', 5);
  sfx('place', b.x, b.z);
  const own = s.villagers.some((v) => v.workplace === b.id) || s.villagers.some((v) => v.home === b.id && v.job === 'idle');
  if (!canBuildNow(s) && !own) toast('Nobody can work on it yet: assign a Mistri (builder), or free a villager from their job (idle villagers build too).', 'danger', 6);
  return true;
}
function finishUpgrade(s, b) {
  const def = BUILDINGS[b.type];
  const L = def.levels[bLevel(b) + 1];
  b.level = bLevel(b) + 1;
  b.upgrading = false;
  b.crew = null;
  for (const v of s.villagers) if (v.helpB === b.id) v.helpB = null; // helpers go back to what they were doing
  b.popT = 0.6;
  // every level makes the building sturdier (and fully repaired)
  b.maxHp = Math.round(def.hp * (1 + 0.4 * (b.level - 1)));
  b.hp = b.maxHp;
  if (b.type === 'store') storeBays(b); // new empty bays appear
  s.buildVer++;
  toast(L.generic ? `The ${def.name} is now level ${b.level}: ${L.unlocks}.` : `The ${def.name} is now level ${b.level}! Unlocked: ${L.unlocks}.`, 'good', 7);
  sfx('upgrade', b.x, b.z);
  emit(s, b.x, def.ht * 0.6, b.z, 20, { spread: def.fw / 2, spreadY: def.ht / 3, vx: 0.8, vyMin: 0.5, vyMax: 2, life: 1.2, colors: ['#ffcc33', '#ff9933', '#fff3b0'], g: -0.5, add: true });
}
/*
 * Outposts: a finished tower standing on (or right at the edge of) village land claims a small circle of
 * land of its own, so houses and workshops can go up round it, even past the village boundary.
 */
const TOWER_LAND = { tower: 5, belltower: 4.5, firetower: 5, cannontower: 5.5 };
const TOWER_EDGE = 1.4; // how far past the boundary a tower itself may stand
function outposts(s) {
  const R = territory(s), out = [];
  for (const b of s.buildings) if (TOWER_LAND[b.type] && b.done && Math.hypot(b.x, b.z) <= R + TOWER_EDGE + 0.6) out.push({ x: b.x, z: b.z, r: TOWER_LAND[b.type], b });
  return out;
}
function onOutpost(s, px, pz) { for (const o of outposts(s)) if (distXZ(px, pz, o.x, o.z) <= o.r - 0.3) return o; return null; }
function canPlace(s, type, cx, cz, ignoreCost) {
  const def = BUILDINGS[type];
  if (def.lvl > s.fire.level) return { ok: false, why: 'Needs Agnikund level ' + def.lvl };
  const R = territory(s);
  const fireClear = 2.7 + s.fire.level * 0.12;
  const posts = outposts(s), tower = !!TOWER_LAND[type];
  for (let i = 0; i < def.fw; i++) {
    for (let j = 0; j < def.fd; j++) {
      const px = cx + i + 0.5, pz = cz + j + 0.5, r = Math.hypot(px, pz);
      if (r > R - 0.3 && !(tower && r <= R + TOWER_EDGE) && !posts.some((o) => distXZ(px, pz, o.x, o.z) <= o.r - 0.3)) return { ok: false, why: tower ? 'Too far out: a tower can stand at most a step past the village edge' : 'Outside village land: upgrade the Agnikund, or put up a tower (Burj) to claim land round it' };
      if (r < fireClear) return { ok: false, why: 'Too close to the Agnikund' };
      if (s.grove && distXZ(px, pz, s.grove.x, s.grove.z) < s.grove.r + 0.9) return { ok: false, why: 'This is the Pavitra Van — the sacred grove cannot be built on' };
      if (pondAt(s, px, pz, 0.35)) return { ok: false, why: 'That is a pond: nothing can be built on the water' };
      const k = cellIdx(cx + i, cz + j);
      if (k < 0) return { ok: false, why: 'Out of bounds' };
      if (s.grid[k]) { const o = s.bById.get(s.grid[k]); if (!(o && BUILDINGS[o.type].road && !def.road)) return { ok: false, why: o && BUILDINGS[o.type].road ? 'There is already a road here' : 'Something is already built here' }; } // a building may go over a road
    }
  }
  if (def.pond) { // a fishing hut has to stand on the bank
    const c = bCenterOf(type, cx, cz), pd = pondNear(s, c.x, c.z);
    if (!pd || distXZ(c.x, c.z, pd.x, pd.z) - pd.r > Math.max(def.fw, def.fd) / 2 + 0.9) return { ok: false, why: 'A Machhli Ghat must stand on the bank of a pond' };
  }
  if (!ignoreCost && !canAfford(s, def.cost)) return { ok: false, why: 'Not enough resources', afford: false };
  return { ok: true };
}
/** Which way a building faces when placed: the Agnikund, except a fishing hut, which looks out over its pond. */
function autoRotFor(s, type, c) {
  const def = BUILDINGS[type];
  if (def.pond) { const pd = pondNear(s, c.x, c.z); if (pd) return Math.round(Math.atan2(pd.x - c.x, pd.z - c.z) / (Math.PI / 2)) * (Math.PI / 2); }
  return def.fw !== def.fd ? (c.z > 0 ? Math.PI : 0) : faceFireRot(c.x, c.z); // long buildings only turn 180°
}
function clearFootprint(s, type, cx, cz) {
  const def = BUILDINGS[type];
  const x0 = cx - 0.45, x1 = cx + def.fw + 0.45, z0 = cz - 0.45, z1 = cz + def.fd + 0.45;
  let wood = 0, stone = 0, tc = false, rc = false;
  s.trees = s.trees.filter((t) => { if (t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1) { if (!t.stump) wood += Math.floor(t.wood * 0.5); tc = true; return false; } return true; });
  s.rocks = s.rocks.filter((r) => { if (r.x > x0 - 0.3 && r.x < x1 + 0.3 && r.z > z0 - 0.3 && r.z < z1 + 0.3) { stone += Math.floor(r.stone * 0.5); rc = true; return false; } return true; });
  const c = bCenterOf(type, cx, cz);
  for (const o of s.buildings.slice()) if (BUILDINGS[o.type].road && !def.road && o.cx >= cx && o.cx < cx + def.fw && o.cz >= cz && o.cz < cz + def.fd) { refund(s, BUILDINGS[o.type].cost, 1); removeBuilding(s, o); } // the road under it is lifted
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
  const autoRot = autoRotFor(s, type, c);
  const b = { id: s.nextId++, type, cx, cz, x: c.x, z: c.z, rot: rot != null ? rot : autoRot, done: false, progress: 0, hp: 1, maxHp: def.hp, grow: 0, cd: 0, offerT: 0 };
  if (def.instant) { b.done = true; b.progress = def.time; b.hp = def.hp; } // a road is laid at once
  addBuilding(s, b);
  emit(s, c.x, 0.2, c.z, 10, { spread: def.fw / 2, vx: 1.2, vyMin: 1, vyMax: 3, life: 0.8, colors: ['#c8a46a', '#a77c4b', '#e0bf88'], g: 6 });
  if (!quiet) sfx('place', c.x, c.z);
  if (!def.instant && !canBuildNow(s)) tip('needBuilder', 'Construction sites need a builder. Assign a Mistri in the Kaam panel, or leave someone idle: idle villagers build too.');
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
  if (poor) toast(`Ran out of resources after ${n} pieces.`, 'warn');
  else if (!n) { toast(BUILDINGS[type].road ? 'The road cannot go there.' : 'Walls cannot go there.', 'warn'); sfx('error'); }
  return n;
}
function demolish(s, b) {
  const def = BUILDINGS[b.type];
  refund(s, def.cost, b.done ? 0.5 : 0.9);
  for (const r in b.hopper || {}) if (b.hopper[r] > 0) s.res[r] += b.hopper[r]; // whatever waited in the hopper goes back to the heap
  removeBuilding(s, b);
  emit(s, b.x, 0.5, b.z, 16, { spread: def.fw / 2, vx: 2, vyMin: 1, vyMax: 4, life: 0.9, colors: ['#8a8a8a', '#a77c4b', '#6b4a2e'], g: 9 });
  sfx('demolish', b.x, b.z);
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
    if (d) { putStock(s, b, v.carry, v.carryAmt); sfx('drop_' + v.carry, v.x, v.z); } // logs clack, stones clunk, sacks thump
    if (b) b.stockPop = 0.35;
  }
  if (v.gold > 0) {
    addRes(s, 'gold', v.gold, v.x, v.z, 2.1); sfx('coin', v.x, v.z);
    if (d) putStock(s, b && BUILDINGS[b.type].drop.includes('gold') ? b : null, 'gold', v.gold);
  }
  v.carryAmt = 0; v.carry = null; v.gold = 0;
}

/* ---------- movement ----------
 * Nobody walks through a building. A navigation grid marks every cell a building stands on (fields, the
 * Akhara pit and the archery range are open ground, and villagers slip through their own walls by the
 * little gates). Walkers go straight when the way is clear; otherwise they follow an A* path round the
 * buildings, smoothed into straight runs. The building a walker starts in or is heading into never
 * blocks them, so people can still step out of a hut or work inside a clay pit.
 */
const NAV_WALK = (type) => { const d = BUILDINGS[type]; return d.wall || isGround(type) || type === 'akhara' || type === 'range'; };
function navGrid(s) {
  if (s._nav && s._nav.ver === s.buildVer) return s._nav;
  const g = (s._nav && s._nav.g) || new Int32Array(GRID * GRID), rd = (s._nav && s._nav.rd) || new Float32Array(GRID * GRID);
  rd.fill(1); let roads = 0;
  for (const b of s.buildings) { const sp = BUILDINGS[b.type].road; if (sp) { const k = cellIdx(b.cx, b.cz); if (k >= 0) { rd[k] = 1 / sp; roads++; } } } // a road cell costs less to cross
  g.fill(0);
  for (const b of s.buildings) {
    if (NAV_WALK(b.type)) continue;
    const d = BUILDINGS[b.type];
    for (let i = 0; i < d.fw; i++) for (let j = 0; j < d.fd; j++) { const k = cellIdx(b.cx + i, b.cz + j); if (k >= 0) g[k] = b.id; }
  }
  for (const p of s.ponds || []) { // the water: everyone walks round it (marked -1, no building)
    for (let i = Math.floor(p.x - p.r); i <= Math.floor(p.x + p.r); i++) for (let j = Math.floor(p.z - p.r); j <= Math.floor(p.z + p.r); j++) {
      const k = cellIdx(i, j);
      if (k >= 0 && !g[k] && distXZ(i + 0.5, j + 0.5, p.x, p.z) < p.r - 0.15) g[k] = -1;
    }
  }
  s._nav = { ver: s.buildVer, g, rd, roads };
  return s._nav;
}
/** The building blocking this point for a walker, or 0. a / b: building ids the walker may pass through. */
function navBlock(nav, x, z, a, b) {
  const k = cellIdx(Math.floor(x), Math.floor(z));
  if (k < 0) return 0;
  const id = nav.g[k];
  return id && id !== a && id !== b ? id : 0;
}
/** Is the straight way from (x0, z0) to (x1, z1) clear for a body about 0.36 wide? */
function navClear(nav, x0, z0, x1, z1, a, b) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
  if (L < 0.01) return true;
  const n = Math.ceil(L / 0.22), px = (-dz / L) * 0.17, pz = (dx / L) * 0.17;
  for (let i = 1; i <= n; i++) {
    const x = x0 + (dx * i) / n, z = z0 + (dz * i) / n;
    if (navBlock(nav, x, z, a, b) || navBlock(nav, x + px, z + pz, a, b) || navBlock(nav, x - px, z - pz, a, b)) return false;
  }
  return true;
}
const _navOpen = new Float64Array(GRID * GRID), _navG = new Float32Array(GRID * GRID), _navFrom = new Int32Array(GRID * GRID), _navSeen = new Uint32Array(GRID * GRID);
let _navStamp = 0;
/** A* over the grid (8 directions, no cutting corners). Returns cell-centre points from start to goal, or null. */
function navPath(nav, x0, z0, x1, z1, a, b) {
  const g = nav.g;
  const free = (cx, cz) => { const k = cellIdx(cx, cz); if (k < 0) return false; const id = g[k]; return !id || id === a || id === b; };
  const sx = Math.floor(x0), sz = Math.floor(z0);
  let gx = Math.floor(x1), gz = Math.floor(z1);
  if (!free(gx, gz)) { // the goal is inside something: aim for the nearest open cell
    let best = null, bd = Infinity;
    for (let r = 1; r < 4 && !best; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (free(gx + i, gz + j)) { const d = Math.hypot(i, j); if (d < bd) { bd = d; best = [gx + i, gz + j]; } }
    if (!best) return null;
    [gx, gz] = best;
  }
  const S0 = cellIdx(sx, sz), G0 = cellIdx(gx, gz);
  if (S0 < 0 || G0 < 0) return null;
  _navStamp++;
  // binary heap of cell indices keyed by f
  const heap = [];
  const push = (k, f) => { _navOpen[k] = f; heap.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (_navOpen[heap[p]] <= f) break; heap[i] = heap[p]; i = p; } heap[i] = k; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; const f = _navOpen[last]; for (;;) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && _navOpen[heap[c + 1]] < _navOpen[heap[c]]) c++; if (_navOpen[heap[c]] >= f) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  const hk = nav.roads ? 0.66 : 1; // with roads about, a step can cost as little as a road step
  const h = (cx, cz) => { const ax = Math.abs(cx - gx), az = Math.abs(cz - gz); return (Math.max(ax, az) + 0.414 * Math.min(ax, az)) * hk; };
  _navSeen[S0] = _navStamp; _navG[S0] = 0; _navFrom[S0] = -1;
  push(S0, h(sx, sz));
  let found = false, n = 0;
  while (heap.length && n++ < 9000) {
    const k = pop();
    if (k === G0) { found = true; break; }
    const cx = (k % GRID) - GH, cz = Math.floor(k / GRID) - GH, gk = _navG[k];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!free(nx, nz)) continue;
      if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue; // no squeezing past a corner
      const nk = cellIdx(nx, nz), ng = gk + (dx && dz ? 1.414 : 1) * (nav.rd ? nav.rd[nk] : 1);
      if (_navSeen[nk] === _navStamp && _navG[nk] <= ng) continue;
      _navSeen[nk] = _navStamp; _navG[nk] = ng; _navFrom[nk] = k;
      push(nk, ng + h(nx, nz));
    }
  }
  if (!found) return null;
  const pts = [];
  for (let k = G0; k !== -1 && k !== S0; k = _navFrom[k]) pts.push({ x: (k % GRID) - GH + 0.5, z: Math.floor(k / GRID) - GH + 0.5 });
  pts.reverse();
  return pts;
}
/** Where to walk next on the way to (tx, tz): the target itself when the way is clear, else the next turn of a path. */
function navWaypoint(s, v, tx, tz) {
  const nav = navGrid(s);
  const a = nav.g[cellIdx(Math.floor(v.x), Math.floor(v.z))] || 0; // the building we are in, if any
  const ti = cellIdx(Math.floor(tx), Math.floor(tz)), b = ti >= 0 ? nav.g[ti] || 0 : 0;
  let P = v._nav;
  if (P && (P.ver !== nav.ver || Math.abs(P.tx - tx) + Math.abs(P.tz - tz) > 1.2)) P = v._nav = null;
  if (!P) {
    // with roads about, a longer trip is planned even across open ground, so walkers take the road when it is quicker
    const far = nav.roads > 0 && Math.abs(tx - v.x) + Math.abs(tz - v.z) > 7;
    if (!far && navClear(nav, v.x, v.z, tx, tz, a, b)) return null;
    const pts = navPath(nav, v.x, v.z, tx, tz, a, b);
    if (!pts) return null;
    for (const q of pts) q.r = nav.rd[cellIdx(Math.floor(q.x), Math.floor(q.z))] < 1;
    pts.push({ x: tx, z: tz, r: false });
    P = v._nav = { ver: nav.ver, tx, tz, pts, i: 0, road: pts.some((q) => q.r) };
  }
  P.pts[P.pts.length - 1].x = tx; P.pts[P.pts.length - 1].z = tz;
  // now and then skip ahead to the farthest point in sight (straight runs, not grid steps), never cutting off a road
  if (!(P.chk > s.time)) {
    P.chk = s.time + 0.2;
    for (let j = Math.min(P.pts.length - 1, P.i + 8); j > P.i; j--) {
      if (P.road) { let mixed = false; for (let k = P.i + 1; k <= j && !mixed; k++) if (P.pts[k].r !== P.pts[P.i].r) mixed = true; if (mixed) continue; }
      if (navClear(nav, v.x, v.z, P.pts[j].x, P.pts[j].z, a, b)) { P.i = j; break; }
    }
  }
  if (P.i === P.pts.length - 1) return null; // the last stretch is straight to the target
  if (distXZ(v.x, v.z, P.pts[P.i].x, P.pts[P.i].z) < 0.2) P.i++;
  return P.pts[P.i];
}
/** The nearest open spot to p (p itself when nothing stands there): for seats, wandering and waiting places. */
function freeSpot(s, p) {
  if (!s.buildings.length) return p;
  const nav = navGrid(s);
  const open = (x, z) => !navBlock(nav, x, z) && !navBlock(nav, x + 0.2, z) && !navBlock(nav, x - 0.2, z) && !navBlock(nav, x, z + 0.2) && !navBlock(nav, x, z - 0.2);
  if (open(p.x, p.z)) return p;
  for (let r = 0.5; r <= 4; r += 0.5) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.atan2(p.z, p.x), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (Math.hypot(x, z) > 1.9 && open(x, z)) return { x, z };
  }
  return p;
}
function moveTo(v, tx, tz, spd, dt) {
  if (S && S.buildings.length) { // a spot inside someone else's building (a tree right by a wall, say): stop at its edge instead
    const nav = navGrid(S), ti = cellIdx(Math.floor(tx), Math.floor(tz)), b = ti >= 0 ? nav.g[ti] : 0;
    if (b && b !== v.workplace && b !== v.home && !(v.target && v.target.id === b) && b !== nav.g[cellIdx(Math.floor(v.x), Math.floor(v.z))]) { const p = freeSpot(S, { x: tx, z: tz }); tx = p.x; tz = p.z; }
  }
  const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
  if (d <= spd * dt + 0.01) { v.x = tx; v.z = tz; v.anim = 'stand'; v._nav = null; return true; }
  let wx = tx, wz = tz;
  if (S && S.buildings.length) { const w = navWaypoint(S, v, tx, tz); if (w) { wx = w.x; wz = w.z; } }
  const ex = wx - v.x, ez = wz - v.z, ed = Math.hypot(ex, ez) || 1, st = Math.min(spd * dt, ed);
  const ox = v.x, oz = v.z;
  v.x += (ex / ed) * st;
  v.z += (ez / ed) * st;
  if (S && S._nav) { // never step into a building that was not on the way (a fresh one, a stale path): slide along it
    const nav = S._nav, a = nav.g[cellIdx(Math.floor(ox), Math.floor(oz))] || 0, ti = cellIdx(Math.floor(tx), Math.floor(tz)), b = ti >= 0 ? nav.g[ti] || 0 : 0;
    if (navBlock(nav, v.x, v.z, a, b)) {
      if (!navBlock(nav, v.x, oz, a, b)) v.z = oz;
      else if (!navBlock(nav, ox, v.z, a, b)) v.x = ox;
      else { v.x = ox; v.z = oz; }
      v._nav = null;
    }
  }
  // walk around the Agnikund, never through it
  const r = Math.hypot(v.x, v.z), keep = 1.75;
  if (r < keep && Math.hypot(tx, tz) >= keep - 0.05) {
    const a = Math.atan2(v.z, v.x) + (ex * v.z - ez * v.x > 0 ? -0.06 : 0.06);
    v.x = Math.cos(a) * keep; v.z = Math.sin(a) * keep;
  }
  v.rot = Math.atan2(ex, ez);
  v.anim = 'walk';
  return false;
}
function faceTo(v, x, z) { if (Math.abs(x - v.x) + Math.abs(z - v.z) > 0.01) v.rot = Math.atan2(x - v.x, z - v.z); }
function villagerSpeed(s, v) {
  let sp = V_SPEED;
  if (v.carryAmt > 0) sp *= 0.82;
  const rb = buildingAtPoint(s, v.x, v.z); if (rb && BUILDINGS[rb.type].road) sp *= BUILDINGS[rb.type].road; // quicker on a path or a road
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
  for (const group of [JOB_ORDER.filter((j) => slotKey(j) === 'army' && !RANGED_JOBS.has(j)), [...RANGED_JOBS]]) {
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
    const p = freeSpot(s, { x: Math.cos(a) * r, z: Math.sin(a) * r });
    v.wx = p.x; v.wz = p.z;
  }
  if (!v.task) v.task = 'Relaxing';
}
/** Places that accept a resource: the Agnikund takes everything, camps take their own goods, the Bhandar takes all. */
function dropPoints(s, res) {
  const h = res && FIRE_HEAP[res];
  const pts = [h ? { x: h.x, z: h.z, r: 0.7, fire: true } : { x: 0, z: 0, r: 2.1, fire: true }];
  for (const b of s.buildings) {
    const d = BUILDINGS[b.type];
    if (b.done && d.drop && (!res || acceptsRes(b, res))) pts.push({ x: b.x, z: b.z, r: Math.max(d.fw, d.fd) * 0.5 + 0.35, b });
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
/** Does this mining camp dig iron ore instead of stone? (from Agnikund level 2, set in its panel) */
const minesOre = (s, camp) => !!(camp && camp.mine === 'ore' && s.fire.level >= 2);
function findResource(s, v, kind, camp) {
  const list = kind === 'wood' ? s.trees : s.rocks;
  const base = camp || { x: 0, z: 0 };
  const ore = kind !== 'wood' && minesOre(s, camp);
  let best = null, bs = Infinity;
  for (const r of list) {
    if (kind === 'wood' ? (r.stump || r.wood <= 0 || r.sacred) : r.stone <= 0 || !!r.ore !== ore) continue;
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
  const camp = validWorkplace(s, v);
  const ore = !isWood && minesOre(s, camp);
  const good = isWood ? 'wood' : ore ? 'ore' : 'stone';
  if (v.carryAmt > 0 && v.carry !== good && v.carry) return deliverAI(s, v, dt, spd); // switched from stone to ore: drop the old load first
  const cap = CARRY_CAP[good];
  if (v.carryAmt >= cap) return deliverAI(s, v, dt, spd);
  if (!camp) {
    if (v.carryAmt > 0) return deliverAI(s, v, dt, spd);
    v.task = `Needs a ${BUILDINGS[JOBS[v.job].building].name} to work from`;
    return idleAI(s, v, dt, spd);
  }
  let r = v.target;
  const valid = r && (isWood ? (!r.stump && r.wood > 0 && s.trees.includes(r)) : (r.stone > 0 && s.rocks.includes(r) && !!r.ore === ore));
  if (!valid) r = v.target = findResource(s, v, kind, camp);
  if (!r) {
    if (v.carryAmt > 0) return deliverAI(s, v, dt, spd);
    v.task = isWood ? 'No trees left to chop!' : ore ? 'No iron ore boulders left in reach!' : 'No rocks left to mine!';
    return idleAI(s, v, dt, spd);
  }
  const d = distXZ(v.x, v.z, r.x, r.z) || 1;
  const off = isWood ? 0.6 : 0.75;
  const sx = r.x + ((v.x - r.x) / d) * off, sz = r.z + ((v.z - r.z) / d) * off;
  if (d > off + 0.05 && !moveTo(v, sx, sz, spd, dt)) {
    v.task = v.carryAmt > 0 ? `Fetching more ${RES[good].en.toLowerCase()}` : (isWood ? 'Walking to a tree' : ore ? 'Walking to the iron boulders' : 'Walking to the rocks');
    return;
  }
  faceTo(v, r.x, r.z);
  v.task = isWood ? `Chopping a ${TREE_INFO[r.type].name} (${r.wood} wood left)` : ore ? `Breaking iron ore (${r.stone} left)` : `Breaking stone (${r.stone} left)`;
  const rate = workRate(s) * (isWood ? (s.upgrades.axe ? 1.6 : 1) : (s.upgrades.pick ? 1.6 : 1));
  v.workT += dt * rate;
  v.anim = 'work';
  const interval = isWood ? 2.0 : ore ? 3.2 : 2.6;
  if (v.workT >= interval) {
    v.workT -= interval;
    v.carryAmt++;
    v.carry = good;
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
      emitChips(s, r.x, 0.4, r.z, r.ore ? '#b06a48' : '#b8b4ab');
      sfx('mine', v.x, v.z);
      if (!r.ore && Math.random() < 0.07) { v.gold++; floater(s, r.x, 1.4, r.z, '!', '#ffd84a'); sfx('coin', r.x, r.z); }
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
  const wide = cap > 6; // the Vishal Khet: two rows of farmers
  const p = wide ? localToWorld(f, ((i % 6) - 2.5) * 0.95, (Math.floor(i / 6) % 2 ? 1.3 : -1.3) + sw * 0.5) : localToWorld(f, (i - (cap - 1) / 2) * (cap > 2 ? 1.1 : 1.2), sw);
  if (!moveTo(v, p.x, p.z, spd, dt) && distXZ(v.x, v.z, p.x, p.z) > 0.6) { v.task = 'Walking to the Khet'; return; }
  v.anim = 'work';
  faceTo(v, f.x, f.z);
  let rate = workRate(s) * (f.type === 'field' ? 1 : f.type === 'vishalkhet' ? 1.3 : 1.15);
  if (s.buildings.some((b) => b.type === 'well' && b.done && dist(b, f) < 9 + (bLevel(b) - 1) * 2)) rate *= 1.5;
  rate *= 1 + 0.2 * (bLevel(f) - 1); // upgraded fields grow faster
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
/**
 * Machhuara: sit on the bank of the pond by the Machhli Ghat and fish; every few seconds a catch goes in
 * the basket, and a full basket is carried to the hut (or any store that takes food).
 */
function fishAI(s, v, dt, spd) {
  const cap = carryCap(s, 'food');
  if (v.carryAmt >= cap || (v.carryAmt > 0 && v.carry !== 'food')) return deliverAI(s, v, dt, spd);
  const hut = validWorkplace(s, v);
  const pd = hut && pondNear(s, hut.x, hut.z, 3.5);
  if (!hut || !pd) { if (v.carryAmt > 0) return deliverAI(s, v, dt, spd); v.task = hut ? 'The Machhli Ghat has no pond' : 'Needs a Machhli Ghat (fishing hut)'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  // each fisher has their own spot on the bank, either side of the hut's jetty
  const a = Math.atan2(hut.z - pd.z, hut.x - pd.x) + (i % 2 ? 0.55 : -0.55) * (1 + Math.floor(i / 2) * 0.8);
  const p = { x: pd.x + Math.cos(a) * (pd.r + 0.78), z: pd.z + Math.sin(a) * (pd.r + 0.78) };
  if (!moveTo(v, p.x, p.z, spd, dt) && distXZ(v.x, v.z, p.x, p.z) > 0.45) { v.task = 'Walking to the pond'; return; }
  faceTo(v, pd.x, pd.z);
  v.anim = 'work';
  v.workT += dt * workRate(s) * workBonus(hut) * (s.weather === 'rain' ? 1.2 : 1);
  v.task = `Fishing (${v.carryAmt} / ${cap} in the basket)`;
  if (v.workT >= 4.2) {
    v.workT = 0;
    v.carryAmt = Math.min(cap, v.carryAmt + 1); v.carry = 'food';
    const fx0 = v.x + Math.sin(v.rot) * 1.2, fz0 = v.z + Math.cos(v.rot) * 1.2;
    emit(s, fx0, 0.05, fz0, 8, { spread: 0.15, vx: 0.9, vyMin: 1, vyMax: 2.4, life: 0.6, colors: ['#bfeaf2', '#ffffff', '#7fd0e0'], g: 9 }); // the splash as the fish comes out
    floater(s, v.x, 1.7, v.z, '+1 fish', '#9fe0ff', 'tag');
    sfx('harvest', v.x, v.z);
    tip('fish', 'The Machhuare bring fish home as food. A full basket goes to the Machhli Ghat; Kisan and fishers together keep everyone fed.');
  }
}
/* ---------- materials: clay, bricks, charcoal, iron ---------- */
const workBonus = (b) => 1 + 0.25 * (bLevel(b) - 1); // upgraded workshops work faster
/** Beldar: dig clay in the pit, fill the tokri, stack it beside the pit (or carry it to storage when full). */
function clayAI(s, v, dt, spd) {
  const cap = carryCap(s, 'clay');
  if (v.carryAmt >= cap || (v.carryAmt > 0 && v.carry !== 'clay')) return deliverAI(s, v, dt, spd);
  const pit = validWorkplace(s, v);
  if (!pit) { if (v.carryAmt > 0) return deliverAI(s, v, dt, spd); v.task = 'Needs a Mitti Khaan (clay pit)'; return idleAI(s, v, dt, spd); }
  const i = workplaceIndex(s, v);
  const p = localToWorld(pit, i % 2 ? 0.35 : -0.35, -0.1);
  if (!moveTo(v, p.x, p.z, spd, dt) && distXZ(v.x, v.z, p.x, p.z) > 0.4) { v.task = 'Walking to the Mitti Khaan'; return; }
  faceTo(v, pit.x, pit.z);
  v.anim = 'work';
  v.task = `Digging clay (${v.carryAmt} / ${cap} in the tokri)`;
  v.workT += dt * workRate(s) * workBonus(pit) * (s.upgrades.pick ? 1.6 : 1) * (s.weather === 'rain' ? 1.2 : 1);
  if (v.workT >= 2.4) {
    v.workT -= 2.4;
    v.carryAmt++; v.carry = 'clay';
    emitChips(s, pit.x, 0.25, pit.z, '#a8603a');
    if (Math.random() < 0.35) sfx('splash', v.x, v.z); else sfx('drop_food', v.x, v.z);
  }
}
/** Which recipe a workshop is running. The kiln on 'auto' burns charcoal when the smelters run short, bricks otherwise. */
function recipeOf(s, b) {
  const def = BUILDINGS[b.type];
  const r = b.recipe || def.recipes[0];
  if (r !== 'auto') return r;
  const smelting = s.buildings.some((o) => o.type === 'smelter' && o.done);
  return smelting && (s.res.charcoal || 0) < 12 && (s.res.wood || 0) >= 6 ? 'charcoal' : 'brick';
}
/** The nearest stockpile holding at least one of a good (skipping the workshop itself). */
function nearestSource(s, x, z, r, not) {
  let best = null, bd = Infinity;
  for (const p of stockpiles(s, r)) {
    if (p.b && p.b === not) continue;
    if ((stockOf(s, p.b)[r] || 0) < 1) continue;
    const d = distXZ(p.x, p.z, x, z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
/**
 * Kumhar and Agariya: keep the hopper stocked by carrying in the inputs, then work batches at the furnace.
 * Inputs leave the village stock when picked up; the output lands in the workshop's own stock, or is
 * carried to the nearest storage with room when that is full.
 */
function processAI(s, v, dt, spd) {
  const b = validWorkplace(s, v);
  if (!b) {
    if (v.carryAmt > 0) { v.fetching = false; return deliverAI(s, v, dt, spd); }
    v.task = `Needs a ${BUILDINGS[JOBS[v.job].building].name}`;
    return idleAI(s, v, dt, spd);
  }
  const def = BUILDINGS[b.type];
  const hop = b.hopper || (b.hopper = {});
  if (v.carryAmt > 0 && !v.fetching) return deliverAI(s, v, dt, spd); // finished goods with no room at the workshop
  if (v.fetching && v.carryAmt > 0) { // bring an input to the hopper
    const door = edgePoint(b, v.x, v.z, 0.35);
    if (distToBuilding(b, v.x, v.z) > 0.6 && !moveTo(v, door.x, door.z, spd, dt)) { v.task = `Bringing ${v.carryAmt} ${RES[v.carry].en.toLowerCase()} to the ${def.name}`; return; }
    hop[v.carry] = (hop[v.carry] || 0) + v.carryAmt;
    sfx('drop_' + v.carry, v.x, v.z);
    v.carryAmt = 0; v.carry = null; v.fetching = false;
    return;
  }
  v.fetching = false;
  const R = RECIPES[recipeOf(s, b)];
  const short = Object.keys(R.in).find((r) => (hop[r] || 0) < R.in[r]);
  if (!short) { // enough for a batch: work the furnace
    const p = frontSpot(s, v, b, workplaceIndex(s, v) === 0 ? -0.45 : 0.45);
    if (!moveTo(v, p.x, p.z, spd, dt) && distXZ(v.x, v.z, p.x, p.z) > 0.4) { v.task = `Walking to the ${def.name}`; return; }
    faceTo(v, b.x, b.z);
    v.anim = 'work';
    b.batch = (b.batch || 0) + dt * workRate(s) * workBonus(b);
    b.activeT = s.time;
    v.task = `${R.verb} (${Math.floor((b.batch / R.time) * 100)}%)`;
    const top = localToWorld(b, b.type === 'kiln' ? 0.55 : -0.1, b.type === 'kiln' ? -0.5 : -0.15);
    if (Math.random() < dt * 5) emit(s, top.x, b.type === 'kiln' ? 3.1 : 1.95, top.z, 1, { spread: 0.12, vx: 0.25, vyMin: 0.5, vyMax: 1.1, life: 2.6, colors: ['#8a8790', '#a3a0a8', '#6f6c74'], g: -0.25 }); // chimney smoke
    if (Math.random() < dt * 3) { const m = localToWorld(b, 0, BUILDINGS[b.type].fd / 2 - 0.2); emitFire(s, m.x, 0.3, m.z); }
    v.workT += dt;
    if (v.workT > 1.1) { v.workT = 0; sfx(b.type === 'smelter' ? 'anvil' : 'hammer', v.x, v.z); }
    if (b.batch >= R.time) {
      b.batch = 0;
      for (const r in R.in) hop[r] -= R.in[r];
      if (stockFree(b, R.out) >= R.n) { addRes(s, R.out, R.n, b.x, b.z, def.ht + 0.4); putStock(s, b, R.out, R.n); b.stockPop = 0.35; }
      else { v.carry = R.out; v.carryAmt = R.n; } // the workshop's stack is full: carry this batch to storage
      emit(s, b.x, 1.0, b.z, 10, { spread: 0.4, vx: 1, vyMin: 1, vyMax: 2.5, life: 0.8, colors: b.type === 'smelter' ? ['#ffcc33', '#ff8a1f', '#fff3b0'] : ['#ff9a40', '#d8643c', '#ffcc33'], g: 4, add: true });
      sfx(b.type === 'smelter' ? 'anvil' : 'drop_stone', b.x, b.z);
    }
    return;
  }
  // fetch what the hopper is missing (enough for two batches when it can)
  const src = nearestSource(s, v.x, v.z, short, b);
  if (!src) {
    const p = frontSpot(s, v, b, workplaceIndex(s, v) === 0 ? -0.45 : 0.45);
    if (moveTo(v, p.x, p.z, spd, dt)) { v.anim = 'stand'; faceTo(v, b.x, b.z); }
    v.task = `Waiting for ${RES[short].en.toLowerCase()} (${RES[short].from})`;
    return;
  }
  const near = src.b ? distToBuilding(src.b, v.x, v.z) <= 0.6 : distXZ(v.x, v.z, src.x, src.z) <= 0.75;
  if (!near) {
    const tp = src.b ? edgePoint(src.b, v.x, v.z, 0.35) : { x: src.x + ((v.x - src.x) / (distXZ(v.x, v.z, src.x, src.z) || 1)) * 0.7, z: src.z + ((v.z - src.z) / (distXZ(v.x, v.z, src.x, src.z) || 1)) * 0.7 };
    moveTo(v, tp.x, tp.z, spd, dt);
    v.task = `Fetching ${RES[short].en.toLowerCase()} from the ${src.b ? BUILDINGS[src.b.type].name : 'Agnikund heap'}`;
    return;
  }
  const st = stockOf(s, src.b);
  const want = Math.max(1, R.in[short] * 2 - (hop[short] || 0));
  const n = Math.floor(Math.min(carryCap(s, short), want, st[short] || 0, s.res[short] || 0));
  if (n <= 0) return;
  st[short] -= n; s.res[short] -= n;
  v.carry = short; v.carryAmt = n; v.fetching = true;
  sfx('drop_' + short, v.x, v.z);
}
function findBuildJob(s, v) {
  let best = null, bs = Infinity;
  const idle = v.job !== 'build';
  for (const b of s.buildings) {
    if (b.done && b.hp >= b.maxHp - 0.5 && !b.upgrading) continue;
    if (idle && b.done && !b.upgrading) continue; // repairs are a Mistri's trade
    if (idle && needsMistri(b) && !mistriOn(s, b)) continue; // stone, brick and iron work waits for a Mistri to lead it
    let n = 0;
    for (const o of s.villagers) if (o !== v && (o.job === 'build' || o.job === 'idle') && o.target === b) n++;
    const score = dist(b, v) + n * 6 + (b.done && !b.upgrading ? 25 : 0);
    if (score < bs) { bs = score; best = b; }
  }
  return best;
}
/*
 * The Mistri's trade. A trained Mistri builds three times as fast as an idle villager lending a hand, is the
 * only one who repairs damaged buildings (by night too, when no demon is close), and has to lead the work
 * on anything built of stone, brick and iron: Agnikund level 3 buildings and every level 3 upgrade.
 */
const MISTRI_EFF = 1.5, IDLE_BUILD_EFF = 0.5;
function needsMistri(b) {
  if (!b.done) return BUILDINGS[b.type].lvl >= 3;
  return !!b.upgrading && bLevel(b) + 1 >= 3;
}
/** Is a Mistri hammering at this building right now? */
function mistriOn(s, b) { return b.mistriT != null && s.time - b.mistriT < 1.2; }
function completeBuilding(s, b) {
  const def = BUILDINGS[b.type];
  b.done = true; b.hp = b.maxHp = def.hp; b.progress = def.time;
  s.stats.built++;
  s.buildVer++;
  if (!def.wall) toast(`${def.name} (${def.en}) is ready!`, 'good');
  sfx(def.wall ? 'hammer' : 'built', b.x, b.z);
  emit(s, b.x, def.ht * 0.6, b.z, def.wall ? 4 : 16, { spread: def.fw / 2, spreadY: def.ht / 3, vx: 0.8, vyMin: 0.5, vyMax: 2, life: 1.1, colors: ['#ffcc33', '#ff9933', '#fff3b0'], g: -0.5, add: true });
  if (!def.wall) emit(s, b.x, 0.15, b.z, 24, { spread: Math.max(def.fw, def.fd) / 2 + 0.3, vx: 1.6, vyMin: 0.2, vyMax: 1, life: 1.3, colors: ['#e0cfae', '#cdb894', '#f0e2c4'], g: -0.1 }); // dust as the scaffolding comes down
  const jobFor = jobOfBuilding(b.type);
  if (jobFor) tip('slot_' + jobFor, `The ${def.name} has room for ${JOBS[jobFor].name} (${JOBS[jobFor].en})! Click it and press + Assign, or use the Kaam panel.`);
  b.popT = 0.5;
  tryMerge(s, b);
}
/**
 * Two finished huts (or fields) touching side by side join into one bigger building; and two of those,
 * laid side by side along their long sides, join again into a square one: four huts make a Haveli, four
 * fields a Vishal Khet.
 */
function tryMerge(s, b) {
  const def = BUILDINGS[b.type];
  if (!def.merge || !b.done) return false;
  for (const n of s.buildings) {
    if (n === b || n.type !== b.type || !n.done) continue;
    let horiz = null;
    if (n.cz === b.cz && Math.abs(n.cx - b.cx) === def.fw) horiz = true;
    else if (n.cx === b.cx && Math.abs(n.cz - b.cz) === def.fd) horiz = false;
    if (horiz === null) continue;
    let type = def.merge + (horiz ? '' : 'V');
    if (def.joined) { // already a pair: only a pair beside it along the long side makes a square
      if ((def.fw > def.fd) === horiz) continue; // end to end would be a long strip
      type = def.merge;
    }
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
    const rot = nd.square ? faceFireRot(c.x, c.z) : horiz ? (c.z > 0 ? Math.PI : 0) : (c.x > 0 ? -Math.PI / 2 : Math.PI / 2);
    const nb = { id: s.nextId++, type, cx, cz, x: c.x, z: c.z, rot, done: true, progress: nd.time, hp: nd.hp, maxHp: nd.hp, grow, cd: 0, offerT: 0, popT: 0.7 };
    addBuilding(s, nb);
    for (const old of [b, n]) for (const r in old.stock || {}) putStock(s, nb, r, old.stock[r]); // the grain sacks move over too
    for (const v of residents) { v.home = nb.id; if (hiding.has(v)) { v.inside = true; v.shelter = 'home'; v.x = nb.x; v.z = nb.z; } }
    for (const v of workers) v.workplace = nb.id;
    emit(s, nb.x, 0.6, nb.z, 30, { spread: nd.fw / 2, vx: 2, vyMin: 1, vyMax: 3.5, life: 1.1, colors: ['#e0c89a', '#c8a46a', '#fff3b0'], g: 4 });
    toast(`Two ${def.name}s joined into a ${nd.name} (${nd.en})! ${isHome(type) ? `It homes ${nd.housing} villagers.` : `Room for ${nd.slots.farm} Kisan.`}`, 'good', 6);
    sfx('upgrade', nb.x, nb.z);
    if (wasSel) UI.select({ kind: 'building', ref: nb });
    if (!nd.square && nd.merge) tip('merge4_' + nd.merge, `Join two more ${def.name}s right beside this ${nd.name}, along its long side, and the two ${nd.name}s become a ${BUILDINGS[nd.merge].name} (${BUILDINGS[nd.merge].en}).`);
    tryMerge(s, nb); // and the new pair may join the one beside it
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
/** Idle villagers lend a hand as builders, slower than a trained Mistri; they leave repairs to the Mistri. */
function builderAI(s, v, dt, spd, nightOnly) {
  const mistri = v.job === 'build';
  const eff = mistri ? MISTRI_EFF : IDLE_BUILD_EFF;
  let b = v.target && s.bById.get(v.target.id) === v.target ? v.target : null;
  if (b && b.done && b.hp >= b.maxHp - 0.5 && !b.upgrading) b = null;
  if (b && !mistri && ((b.done && !b.upgrading) || (needsMistri(b) && !mistriOn(s, b)))) b = null;
  if (b && nightOnly && !safeToRepair(s, b)) b = null;
  if (!b) b = v.target = nightOnly ? findNightRepair(s, v) : findBuildJob(s, v);
  if (!b) { v.target = null; if (nightOnly) return false; v.task = mistri ? 'Nothing to build — waiting' : 'Resting — nothing to build'; return idleAI(s, v, dt, spd); }
  const def = BUILDINGS[b.type];
  const p = edgePoint(b, v.x, v.z, 0.35);
  if (distToBuilding(b, v.x, v.z) > 0.55 && !moveTo(v, p.x, p.z, spd, dt)) { v.task = (b.done && !b.upgrading ? 'Going to repair the ' : 'Going to build the ') + def.name; return true; }
  faceTo(v, b.x, b.z);
  v.anim = 'work';
  if (mistri) b.mistriT = s.time;
  const rate = workRate(s) * eff;
  hammerAt(s, v, b, p, dt);
  const who = mistri ? '' : ' (lending a hand)';
  if (!b.done) {
    b.progress += dt * rate;
    b.hp = Math.max(b.hp, (def.hp * b.progress) / def.time);
    v.task = `Building the ${def.name} (${Math.floor((b.progress / def.time) * 100)}%)${who}`;
    if (b.progress >= def.time) completeBuilding(s, b);
  } else if (b.upgrading) {
    upgradeWork(s, v, b, dt, eff);
    v.task += who;
  } else {
    b.hp = Math.min(b.maxHp, b.hp + 12 * dt * rate);
    v.task = `Repairing the ${def.name} (${Math.floor((b.hp / b.maxHp) * 100)}%)${nightOnly ? ' by torchlight' : ''}`;
  }
  return true;
}
/** No demon close to this building (or to the path to it): a Mistri can slip out and mend it at night. */
function safeToRepair(s, b) { return !nearestEnemy(s, b.x, b.z, 7, false) && Math.hypot(b.x, b.z) < territory(s) + 1; }
function findNightRepair(s, v) {
  let best = null, bs = Infinity;
  for (const b of s.buildings) {
    if (!b.done || b.upgrading || b.hp >= b.maxHp * 0.92 || !safeToRepair(s, b)) continue;
    if (s.villagers.some((o) => o !== v && o.job === 'build' && o.target === b)) continue;
    const score = dist(b, v) - (BUILDINGS[b.type].wall ? 4 : 0) + (b.hp / b.maxHp) * 10; // broken walls first
    if (score < bs) { bs = score; best = b; }
  }
  return best;
}
/** Is anyone able to build? (Mistri, or idle villagers, who pitch in automatically) */
const canBuildNow = (s) => jobCount(s, 'build') > 0 || idleVillagers(s).length > 0;
/** Hammer blows, wood chips and dust while someone works on a building. */
function hammerAt(s, v, b, p, dt) {
  const def = BUILDINGS[b.type];
  v.workT += dt;
  if (v.workT <= 0.6) return;
  v.workT = 0;
  sfx('hammer', v.x, v.z);
  const hy = b.done ? 0.4 + Math.random() * def.ht * 0.5 : 0.15 + def.ht * clamp((b.progress / def.time - 0.12) / 0.88, 0, 1);
  emitChips(s, p.x, hy, p.z, b.done ? '#c8a46a' : pick(['#c8a46a', '#b5794a', '#d9ab55']));
  if ((!b.done || b.upgrading) && Math.random() < 0.5) emit(s, b.x, 0.1, b.z, 2, { spread: def.fw / 2, vx: 0.4, vyMin: 0.3, vyMax: 0.8, life: 1.2, colors: ['#d8c4a0', '#c8b08a'], g: -0.2 });
}
/*
 * Upgrades take real work: L.time is the work-seconds one person needs. Every pair of hands adds to it — a
 * Mistri counts fully, the building's own workers and helpers a little less — so more people finish sooner.
 */
const UPGRADE_EFF = { build: MISTRI_EFF, own: 0.7, helper: 0.7 };
function upgradeWork(s, v, b, dt, eff) {
  const def = BUILDINGS[b.type], L = def.levels[bLevel(b) + 1];
  if (!L) return;
  if (v.job === 'build') b.mistriT = s.time;
  else if (needsMistri(b) && !mistriOn(s, b)) { // level 3 work: helpers can only follow a Mistri's lead
    v.task = `Waiting for a Mistri to lead the level ${bLevel(b) + 1} work on the ${def.name}`;
    v.anim = 'stand';
    return;
  }
  b.upProg = (b.upProg || 0) + dt * workRate(s) * eff;
  (b.crew || (b.crew = {}))[v.id] = [s.time, eff];
  v.task = `Upgrading the ${def.name} to level ${bLevel(b) + 1} (${Math.floor((b.upProg / L.time) * 100)}%)`;
  if (b.upProg >= L.time) finishUpgrade(s, b);
}
/** Who is working on an upgrade right now, and how fast it goes (work-seconds per second). */
function upgradeCrew(s, b) {
  let n = 0, rate = 0;
  for (const id in b.crew || {}) { const [t, eff] = b.crew[id]; if (s.time - t < 0.6) { n++; rate += eff * workRate(s); } else delete b.crew[id]; }
  return { n, rate };
}
/** The upgrade this villager should lend a hand to, if any: one they were sent to, their workplace, or their home. */
function upgradeToHelp(s, v) {
  if (v.helpB) {
    const b = getB(s, v.helpB);
    if (b && b.done && b.upgrading) return b;
    v.helpB = null;
  }
  if (v.job === 'build' || v.carryAmt > 0) return null;
  if ((v.job === 'vaidya' || v.job === 'medic') && s.villagers.some((o) => o.hp < o.maxHp * 0.7 && !o.inside)) return null; // healing comes first
  const w = v.workplace != null ? getB(s, v.workplace) : null;
  if (w && w.done && w.upgrading) return w;
  if (v.job === 'idle' && v.home) { const h = getB(s, v.home); if (h && h.done && h.upgrading) return h; }
  return null;
}
function upgradeHelpAI(s, v, b, dt, spd) {
  const def = BUILDINGS[b.type];
  const p = edgePoint(b, v.x, v.z, 0.35);
  if (distToBuilding(b, v.x, v.z) > 0.55 && !moveTo(v, p.x, p.z, spd, dt)) { v.task = `Going to help upgrade the ${def.name}`; return; }
  faceTo(v, b.x, b.z);
  v.anim = 'work';
  hammerAt(s, v, b, p, dt);
  upgradeWork(s, v, b, dt, v.helpB === b.id ? UPGRADE_EFF.helper : UPGRADE_EFF.own);
}
/** Send an idle villager to help with an upgrade (the player's "Send helper" button). */
const MAX_HELPERS = 6;
function sendHelper(s, b) {
  if (!b || !b.upgrading) return false;
  if (s.villagers.filter((v) => v.helpB === b.id).length >= MAX_HELPERS) { toast(`The ${BUILDINGS[b.type].name} already has ${MAX_HELPERS} helpers.`, 'warn'); return false; }
  const idle = idleVillagers(s).filter((v) => !v.helpB).sort((a, c) => distXZ(a.x, a.z, b.x, b.z) - distXZ(c.x, c.z, b.x, b.z));
  if (!idle.length) { toast('No idle villagers to send. Free someone from their job, or invite a traveller.', 'warn'); sfx('error'); return false; }
  idle[0].helpB = b.id;
  toast(`${idle[0].name} goes to help upgrade the ${BUILDINGS[b.type].name}.`, 'info', 3);
  sfx('click');
  return true;
}
function recallHelper(s, b) {
  const list = s.villagers.filter((v) => v.helpB === b.id);
  if (!list.length) return false;
  list[list.length - 1].helpB = null;
  sfx('click');
  return true;
}
function priestHeal(s, v, dt) {
  for (const o of s.villagers) {
    if (o.hp < o.maxHp && distXZ(o.x, o.z, v.x, v.z) < 6) {
      o.hp = Math.min(o.maxHp, o.hp + 3 * dt);
      if (Math.random() < dt * 1.5) emit(s, o.x, 1.4, o.z, 1, { spread: 0.2, vx: 0.2, vyMin: 0.6, vyMax: 1.2, life: 0.9, colors: ['#ffe066', '#fff3b0'], add: true });
    }
  }
}
/* ---------- healing ---------- */
function healGlow(s, o) { emit(s, o.x, 1.2, o.z, 2, { spread: 0.25, vx: 0.2, vyMin: 0.5, vyMax: 1.3, life: 1, colors: ['#8ef09a', '#d8ffd0', '#5fd36f'], g: -0.6, add: true }); }
/**
 * Vaidya: walk to the most hurt villager or soldier inside the village and heal them with herbs.
 * By night they only treat people inside the village land and never go near a demon.
 * Returns true while busy with a patient.
 */
function healerAI(s, v, dt, spd, phase) {
  const hut = validWorkplace(s, v);
  if (!hut) return false;
  const R = territory(s);
  let best = null, bs = Infinity;
  for (const o of s.villagers) {
    if (o === v || o.inside || o.arriving || o.hp >= o.maxHp * 0.92) continue;
    const r = Math.hypot(o.x, o.z);
    if (r > R + (phase === 'day' ? 6 : -1)) continue;
    if (phase !== 'day' && nearestEnemy(s, o.x, o.z, 3.2, true)) continue; // too dangerous
    const score = (o.hp / o.maxHp) * 20 + distXZ(o.x, o.z, v.x, v.z) * 0.5;
    if (score < bs) { bs = score; best = o; }
  }
  if (!best) return false;
  best.healBy = v.name; best.healT = s.time + 0.6; // the patient's panel shows who is coming
  if (distXZ(best.x, best.z, v.x, v.z) > 0.85) {
    moveTo(v, best.x, best.z, spd * 1.1, dt);
    v.task = `Hurrying to heal ${best.name}`;
    best.healNear = false;
    return true;
  }
  best.healNear = true;
  faceTo(v, best.x, best.z);
  v.anim = 'work';
  const rate = 7 * (1 + 0.3 * (bLevel(hut) - 1)) * workRate(s);
  best.hp = Math.min(best.maxHp, best.hp + rate * dt);
  v.task = `Healing ${best.name} with herbs (${Math.ceil(best.hp)} / ${best.maxHp})`;
  if (Math.random() < dt * 4) healGlow(s, best);
  sfx('heal', v.x, v.z);
  return true;
}
function vaidyaAI(s, v, dt, spd, phase) {
  if (healerAI(s, v, dt, spd, phase)) return;
  const hut = validWorkplace(s, v);
  if (!hut) { v.task = 'Needs a Vaidyashala'; return idleAI(s, v, dt, spd); }
  if (phase !== 'day') return homeAI(s, v, dt, spd);
  const p = frontSpot(s, v, hut, workplaceIndex(s, v) === 0 ? -0.5 : 0.5);
  if (!moveTo(v, p.x, p.z, spd, dt)) { v.task = 'Walking to the Vaidyashala'; return; }
  v.anim = 'work';
  faceTo(v, hut.x, hut.z);
  v.task = 'Grinding herbs — ready to heal the wounded';
}
const HERB_COST = { food: 5 };
/** Player action: heal one villager with herbs right away (costs grain, short cooldown each). */
function healWithHerbs(s, v) {
  if (!v || v.hp >= v.maxHp - 0.5) return false;
  if ((v.herbT || 0) > s.time) { toast(`${v.name} was just treated. Try again in ${Math.ceil(v.herbT - s.time)} s.`, 'warn', 3); return false; }
  if (!canAfford(s, HERB_COST)) { notAfford(s, HERB_COST, 'make herbal medicine'); return false; }
  spend(s, HERB_COST, v.x, v.z);
  v.hp = Math.min(v.maxHp, v.hp + Math.max(40, v.maxHp * 0.6));
  v.herbT = s.time + 20;
  for (let i = 0; i < 4; i++) healGlow(s, v);
  floater(s, v.x, 1.8, v.z, 'Healed', '#8ef09a');
  sfx('heal', v.x, v.z);
  return true;
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
  // bedtime: anyone with a home sleeps in it; the rest sleep by the warm Agnikund
  if (validHome(s, v)) {
    const b = getB(s, v.home), d = homeDoor(b);
    if (v.carryAmt > 0 || v.gold > 0) { if (moveTo(v, v.seat.x, v.seat.z, spd * 1.1, dt)) deliver(s, v); v.task = 'Dropping off their tokri before bed'; return; }
    if (moveTo(v, d.x, d.z, spd * 1.1, dt)) {
      v.inside = true; v.shelter = 'home'; v.sleep = true; v.x = b.x; v.z = b.z;
      v.task = 'Asleep in their ' + BUILDINGS[b.type].name;
    } else v.task = 'Heading home for the night';
    return;
  }
  if (moveTo(v, v.seat.x, v.seat.z, spd * 1.1, dt)) {
    if (v.carryAmt > 0 || v.gold > 0) deliver(s, v);
    faceTo(v, 0, 0);
    if (phaseOf(s.t) === 'night') { v.anim = 'sleep'; v.sleep = true; v.task = 'Asleep by the Agnikund (no home yet)'; }
    else { v.anim = 'sit'; v.task = 'Resting by the Agnikund'; }
  } else v.task = 'Hurrying back to the fire';
}
/** Morning: sleepers wake up and come out to work. */
function wakeUp(s, v) {
  v.sleep = false;
  if (v.inside && v.shelter === 'home' && !(v.fearT > 0)) leaveShelter(s, v);
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
    if (v.sleep && v.shelter === 'home' && v.job === 'build' && !(v.fearT > 0) && (v.repT = (v.repT || 0) - dt) <= 0) { // a Mistri gets up when something needs mending
      v.repT = 2;
      if (findNightRepair(s, v)) { wakeUp(s, v); return false; }
    }
    if (v.sleep && v.shelter === 'home') { const b = getB(s, v.home); v.task =`Asleep in their ${b ? BUILDINGS[b.type].name : 'home'}${v.fearT > 0 ? ' (demons prowl outside)' : ''}`; return true; }
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

/* ---------- combat ----------
 * Every blow is a little sequence: a wind-up, the strike (damage lands here), recovery. Soldiers chain
 * combos and use one special move on a cooldown; demons telegraph their attacks, get knocked back and
 * stunned. Visual effects go out as events in s.fx for the renderer (slash arcs, impacts, shockwaves).
 */
function fx(s, kind, o) { if (s.fx && s.fx.length < 200) s.fx.push(Object.assign({ kind }, o)); }
function shake(s, a) { s.shake = Math.max(s.shake || 0, a); }
function hitStop(s, t) { if (!s.demo) s.hitStop = Math.max(s.hitStop || 0, t); }
const WEAPON_FX = { warrior: 0xf4f6ff, brute: 0xffb347, spear: 0x9fd0ff, archer: 0xffe9a8, medic: 0x8ef09a, khadgi: 0xffe0a0, urumi: 0xc8f0ff, longbow: 0xfff0c0, chakri: 0xd8e8ff };
/**
 * A soldier type's fighting numbers, for the info panel: damage per blow (with upgrades), blows a second,
 * damage a second, reach or range, how many demons one blow can hit, crit and block chance, armour.
 */
const TARGETS = { warrior: 'one demon; every third blow is a heavy thrust', brute: 'the target and everything around it', spear: 'one demon from far off, double damage to giants and asuras', khadgi: 'every demon in a wide arc in front', urumi: 'up to 3 demons in a wide arc', archer: 'one demon', longbow: 'a line of up to 3 demons (the arrow goes through)', chakri: 'up to 4 demons, the ring bouncing between them' };
function soldierStats(s, job, v) {
  const st = SOLDIERS[job] || SOLDIERS.warrior, M = SOLDIER_MOVES[job] || {}, ranged = RANGED_JOBS.has(job);
  const fest = s.festival ? 1.5 : 1, crit = M.crit || 0;
  const A = armourOf(v), armour = A ? A.def : 0, aHp = A ? A.hp : 0; // a particular soldier's armour (none for the job in general)
  let dmg, rate, reach;
  if (job === 'medic') return { heal: st.heal * workRate(s), hp: st.hp + aHp, block: 0, armour, armourName: A && A.name, crit: 0, special: M.ability, ult: ULTIMATES[job] };
  if (ranged) {
    dmg = (st.dmg || 6) * (job === 'chakri' ? (s.upgrades.talwar ? 1.3 : 1) : s.upgrades.bow ? 1.5 : 1) * fest;
    rate = 1 / (st.cd || 1.35);
    reach = (st.range || 10) + (s.upgrades.bow && job !== 'chakri' ? 2.5 : 0);
  } else {
    dmg = soldierDmg(s, { job });
    const swings = (M.atk || ['slash']).map((k) => SWINGS[k].dur);
    rate = 1 / Math.max(st.cd, swings.reduce((a, b) => a + b, 0) / swings.length);
    if (job === 'warrior') dmg *= (2 + 1.5) / 3; // the heavy thrust that ends the combo
    reach = st.reach;
  }
  const hp = (st.hp || 40) + (job === 'warrior' && s.upgrades.talwar ? 30 : 0) + aHp;
  return { dmg, rate, dps: dmg * rate * (1 + crit * 0.8), reach, ranged, crit, block: M.block || 0, armour, armourName: A && A.name, hp, speed: st.speed || 1, targets: TARGETS[job] || '', special: M.ability, ult: ULTIMATES[job] };
}
function soldierDmg(s, v) {
  const st = SOLDIERS[v.job] || SOLDIERS.warrior;
  return (st.dmg || 6) * ((v.job === 'warrior' || v.job === 'khadgi' || v.job === 'urumi') && s.upgrades.talwar ? 1.6 : 1) * (s.festival ? 1.5 : 1); // steel for every blade
}
const canReach = (v, o, reach) => !o.dead && !(ENEMIES[o.type].fly && o.y > 1.2) && distXZ(o.x, o.z, v.x, v.z) <= reach + ENEMIES[o.type].r;
function enemiesNear(s, x, z, r) { let n = 0; for (const e of s.enemies) if (!e.dead && !(ENEMIES[e.type].fly && e.y > 1.2) && distXZ(e.x, e.z, x, z) < r + ENEMIES[e.type].r) n++; return n; }
/** Shakti: a fighter's power bar fills with every blow given and taken; a full bar unleashes their ultimate. */
function addPower(s, v, n) {
  if (!isDefender(v) || n <= 0) return;
  const was = v.power || 0;
  v.power = Math.min(100, was + n);
  if (was < 100 && v.power >= 100) { floater(s, v.x, 2.05, v.z, 'Shakti full!', '#ffd27a', 'tag'); fx(s, 'ring', { x: v.x, z: v.z, r: 1.0, c: 0xffd27a, dur: 0.5 }); sfx('bellSoft', v.x, v.z); }
}
/** Start an ultimate: spends the whole bar, with a big callout. */
function startUltimate(s, v, kind, e, extra) {
  const U = ULTIMATES[v.job], S2 = SWINGS[kind];
  v.power = 0;
  v.atk = Object.assign({ kind, t: 0, dur: S2.dur, hit: S2.hit, hits: S2.hits || null, hi: 0, foe: e, mult: 1, side: 1, ab: true, ult: true, done: false }, extra || {});
  v.atkCd = S2.dur + 0.3;
  floater(s, v.x, 2.3, v.z, U.name + '!', '#ffcf5a', 'callout ult');
  fx(s, 'ring', { x: v.x, z: v.z, r: 1.6, c: 0xffd27a, dur: 0.45 });
  hitStop(s, 0.05);
  sfx('warcry', v.x, v.z);
}
/** The densest knot of demons within reach: where Hanuman's leap and the Agni Astra land. */
function densestEnemy(s, x, z, range, r) {
  let best = null, bn = 0;
  for (const e of s.enemies) {
    if (e.dead || (ENEMIES[e.type].fly && e.y > 1.2) || distXZ(e.x, e.z, x, z) > range) continue;
    const n = enemiesNear(s, e.x, e.z, r);
    if (n > bn) { bn = n; best = e; }
  }
  return best;
}
/** Begin a melee swing: the next move of the combo, or the special move when it is ready and worth it. */
function startMelee(s, v, e) {
  const M = SOLDIER_MOVES[v.job] || SOLDIER_MOVES.warrior, st = SOLDIERS[v.job] || SOLDIERS.warrior;
  const def = ENEMIES[e.type];
  if ((v.power || 0) >= 100 && ULTIMATES[v.job]) { // the ultimate, when the bar is full
    const k = ULTIMATES[v.job].key;
    if (k === 'leap') {
      const c = densestEnemy(s, v.x, v.z, 7, 2.6) || e;
      return startUltimate(s, v, 'leap', c, { sx: v.x, sz: v.z, tx: c.x - (c.x - v.x) * (0.6 / (distXZ(c.x, c.z, v.x, v.z) || 1)), tz: c.z - (c.z - v.z) * (0.6 / (distXZ(c.x, c.z, v.x, v.z) || 1)) });
    }
    return startUltimate(s, v, k, e);
  }
  let kind, mult = 1, ab = null;
  const big = def.boss || def.cost >= 6;
  if ((v.abilT || 0) <= 0 && M.ability) {
    const k = M.ability.key;
    if ((k === 'bash' && !(e.stunT > 0)) || (k === 'slam' && (enemiesNear(s, v.x, v.z, 2.2) >= 2 || big)) || k === 'lunge'
      || (k === 'sunder' && (big || enemiesNear(s, e.x, e.z, 1.6) >= 2)) || (k === 'coil' && enemiesNear(s, v.x, v.z, 2.4) >= 2)) { ab = M.ability; kind = k; }
  }
  if (!ab) {
    v.combo = ((v.combo || 0) + 1) % M.atk.length;
    kind = M.atk[v.combo];
    if (v.job === 'warrior' && v.combo === M.atk.length - 1) mult = 1.5; // the combo ends in a heavy thrust
  }
  const S2 = SWINGS[kind];
  v.atk = { kind, t: 0, dur: S2.dur, hit: S2.hit, foe: e, mult, side: v.combo % 2 ? 1 : -1, ab: !!ab, done: false };
  if (kind === 'lunge') { const d = distXZ(e.x, e.z, v.x, v.z) || 1; v.atk.dx = (e.x - v.x) / d; v.atk.dz = (e.z - v.z) / d; v.atk.dist = clamp(d - st.reach * 0.5, 0.3, 1.6); }
  v.atkCd = Math.max(st.cd, S2.dur) * (0.92 + Math.random() * 0.16);
  if (ab) { v.abilT = ab.cd; floater(s, v.x, 2.0, v.z, ab.name + '!', '#ffd27a', 'callout'); }
}
/** Advance a swing; the blow lands at its hit moment. Returns true while the soldier is committed to it. */
function tickAttack(s, v, dt) {
  const a = v.atk;
  if (!a) return false;
  a.t += dt;
  v.anim = 'atk';
  const hitT = a.dur * a.hit;
  if (a.kind === 'whirl' || a.kind === 'serpent' || a.kind === 'coil') v.rot += dt * (a.kind === 'coil' ? 9 : 15); // the hero's wheel and the urumi spin
  else if (!a.done && a.foe && !a.foe.dead && a.kind !== 'lunge' && a.kind !== 'leap') faceTo(v, a.foe.x, a.foe.z);
  if (a.kind === 'lunge' && a.t < hitT) { const step = (a.dist / hitT) * dt; v.x += a.dx * step; v.z += a.dz * step; v.rot = Math.atan2(a.dx, a.dz); }
  if (a.kind === 'leap' && a.t < hitT) { // Hanuman's leap: an arc through the air to the thick of the demons
    const f = easeInOut(a.t / hitT);
    v.x = a.sx + (a.tx - a.sx) * f; v.z = a.sz + (a.tz - a.sz) * f; faceTo(v, a.tx + (a.tx - a.sx), a.tz + (a.tz - a.sz));
  }
  if (a.hits) { // several blows in one move
    while (a.hi < a.hits.length && a.t >= a.dur * a.hits[a.hi]) { resolveAttack(s, v, a, a.hi); a.hi++; }
    if (a.hi >= a.hits.length) a.done = true;
  } else if (!a.done && a.t >= hitT) { a.done = true; resolveAttack(s, v, a); }
  if (a.t >= a.dur) v.atk = null;
  return true;
}
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
function resolveAttack(s, v, a) {
  const st = SOLDIERS[v.job] || SOLDIERS.warrior, M = SOLDIER_MOVES[v.job] || {};
  const base = soldierDmg(s, v) * a.mult;
  const crit = Math.random() < (M.crit || 0);
  const C = crit ? 1.8 : 1;
  const bonus = (o) => (st.bigBonus && (ENEMIES[o.type].boss || o.type === 'danav') ? st.bigBonus : 1);
  const col = WEAPON_FX[v.job] || 0xffffff;
  const e = a.foe;
  const reach = (st.reach || 0.75) + 0.45;
  let gained = 0; // demons struck, for the Shakti bar
  switch (a.kind) {
    case 'slash': case 'thrust': case 'smash': case 'bash': {
      fx(s, a.kind === 'thrust' ? 'thrust' : a.kind === 'smash' ? 'smash' : 'slash', { x: v.x, z: v.z, rot: v.rot, side: a.side, c: a.kind === 'bash' ? 0xffd27a : col, len: reach + 0.3, heavy: a.mult > 1 || crit });
      if (e && canReach(v, e, reach)) {
        gained = 1;
        const knock = a.kind === 'smash' ? 1.4 : a.kind === 'bash' ? 1.3 : a.mult > 1 ? 1.0 : 0.45;
        hitEnemy(s, e, base * C * bonus(e) * (a.kind === 'bash' ? 0.8 : 1), v, { crit, knock, stun: a.kind === 'bash' ? 1.5 : a.kind === 'smash' ? 0.35 : 0, big: a.kind === 'smash' || a.mult > 1 });
        if (a.kind === 'smash' && st.splash) {
          for (const o of s.enemies) if (o !== e && !o.dead && distXZ(o.x, o.z, e.x, e.z) < st.splash + ENEMIES[o.type].r) hitEnemy(s, o, base * 0.5, e, { knock: 1.0 });
          emit(s, e.x, 0.15, e.z, 10, { spread: 0.35, vx: 1.8, vyMin: 0.4, vyMax: 1.4, life: 0.6, colors: ['#d8c4a0', '#c8b08a', '#a89070'], g: 3 });
          shake(s, 0.08);
        }
        if (a.kind === 'bash') { floater(s, e.x, e.y + ENEMIES[e.type].h + 0.5, e.z, 'Stunned', '#ffe27a', 'tag'); sfx('thud', v.x, v.z); }
        sfx(v.job === 'brute' ? 'thud' : 'sword', v.x, v.z);
        if (crit) hitStop(s, 0.05);
      } else sfx('whoosh', v.x, v.z);
      break;
    }
    case 'slam': { // Gadadhari leaps and brings the gada down: a shockwave knocks back and stuns everything around
      const R = 2.4;
      let hit = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.2) || distXZ(o.x, o.z, v.x, v.z) > R + ENEMIES[o.type].r) continue;
        hitEnemy(s, o, base * 1.4 * C, v, { crit, knock: 2.0, stun: 1.1, big: true });
        hit++;
      }
      fx(s, 'ring', { x: v.x, z: v.z, r: R + 0.3, c: 0xffb347, dur: 0.55 });
      fx(s, 'ring', { x: v.x, z: v.z, r: 1.4, c: 0xfff0c0, dur: 0.3 });
      fx(s, 'impact', { x: v.x + Math.sin(v.rot) * 0.6, y: 0.2, z: v.z + Math.cos(v.rot) * 0.6, c: 0xffd27a, s: 1.8 });
      emit(s, v.x, 0.1, v.z, 26, { spread: 1.2, vx: 3, vyMin: 0.5, vyMax: 2.5, life: 0.9, colors: ['#d8c4a0', '#c8b08a', '#a89070', '#8a7a66'], g: 5 });
      shake(s, 0.32); hitStop(s, 0.07);
      sfx('boom', v.x, v.z); sfx('thud', v.x, v.z);
      if (hit >= 3) floater(s, v.x, 2.5, v.z, `×${hit}`, '#ffd27a', 'callout');
      gained = hit;
      break;
    }
    case 'lunge': case 'barrage': { // Bhaladhari dashes and skewers every demon along the line (Trishul Varsha: three times)
      if (a.kind === 'barrage') { const t2 = nearestEnemy(s, v.x, v.z, 4, true); if (t2) faceTo(v, t2.x, t2.z); v.x += Math.sin(v.rot) * 0.35; v.z += Math.cos(v.rot) * 0.35; }
      const fx0 = Math.sin(v.rot), fz0 = Math.cos(v.rot), L = (st.reach || 1.5) + 0.7;
      let n = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.2)) continue;
        const rx = o.x - v.x, rz = o.z - v.z, along = rx * fx0 + rz * fz0, side = Math.abs(rx * fz0 - rz * fx0);
        if (along < -0.2 || along > L + ENEMIES[o.type].r || side > 0.5 + ENEMIES[o.type].r) continue;
        hitEnemy(s, o, base * (a.kind === 'barrage' ? 2.0 : 1.8) * C * bonus(o), v, { crit, knock: 1.3, big: true });
        n++;
      }
      fx(s, 'thrust', { x: v.x - fx0 * 0.6, z: v.z - fz0 * 0.6, rot: v.rot, c: a.ult ? 0xffd27a : 0xbfe2ff, len: L + 0.9, heavy: true });
      sfx('sword', v.x, v.z); sfx('whoosh', v.x, v.z);
      if (crit || a.ult) hitStop(s, 0.04);
      gained = n;
      break;
    }
    case 'cleave': case 'storm': { // the Khanda cuts through every demon in a wide arc (Shamsher Toofan: three great steps of it)
      if (a.kind === 'storm') { const t2 = nearestEnemy(s, v.x, v.z, 4, true); if (t2) faceTo(v, t2.x, t2.z); v.x += Math.sin(v.rot) * 0.4; v.z += Math.cos(v.rot) * 0.4; }
      const R = reach + (a.kind === 'storm' ? 0.6 : 0.25), arc = st.arc || 1.2, fx0 = Math.sin(v.rot), fz0 = Math.cos(v.rot);
      let n = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.2)) continue;
        const rx = o.x - v.x, rz = o.z - v.z, d = Math.hypot(rx, rz);
        if (d > R + ENEMIES[o.type].r) continue;
        if (d > 0.5 && Math.acos(clamp((rx * fx0 + rz * fz0) / d, -1, 1)) > arc) continue;
        hitEnemy(s, o, base * (a.kind === 'storm' ? 1.6 : 1) * C * (n ? 0.8 : 1), v, { crit, knock: a.kind === 'storm' ? 1.4 : 0.8, big: a.kind === 'storm' || crit });
        n++;
      }
      fx(s, 'slash', { x: v.x, z: v.z, rot: v.rot, side: a.side, c: a.ult ? 0xffd27a : col, len: R + 0.2, heavy: true });
      sfx(n ? 'sword' : 'whoosh', v.x, v.z);
      if (n >= 3) floater(s, v.x, 2.4, v.z, `×${n}`, '#ffd27a', 'callout');
      if (crit || a.ult) hitStop(s, 0.04);
      if (a.kind === 'storm') shake(s, 0.08);
      gained = n;
      break;
    }
    case 'sunder': { // Dvidha Vaar: an overhead blow that splits one demon and throws back the ones beside it
      fx(s, 'smash', { x: v.x, z: v.z, rot: v.rot, side: 1, c: 0xffe0a0, len: reach + 0.4, heavy: true });
      const c = e && canReach(v, e, reach + 0.3) ? e : null;
      if (c) { hitEnemy(s, c, base * 2.6 * C * (ENEMIES[c.type].boss || ENEMIES[c.type].cost >= 6 ? 1.3 : 1), v, { crit, knock: 1.6, stun: 0.6, big: true }); gained = 1; }
      const cx = c ? c.x : v.x + Math.sin(v.rot) * reach, cz = c ? c.z : v.z + Math.cos(v.rot) * reach;
      for (const o of s.enemies) if (o !== c && !o.dead && !(ENEMIES[o.type].fly && o.y > 1.2) && distXZ(o.x, o.z, cx, cz) < 1.6 + ENEMIES[o.type].r) { hitEnemy(s, o, base * 0.6, { x: cx, z: cz }, { knock: 1.9 }); gained++; }
      fx(s, 'ring', { x: cx, z: cz, r: 1.7, c: 0xffe0a0, dur: 0.4 });
      emit(s, cx, 0.1, cz, 14, { spread: 0.4, vx: 2, vyMin: 0.4, vyMax: 1.6, life: 0.6, colors: ['#d8c4a0', '#c8b08a'], g: 4 });
      shake(s, 0.14); hitStop(s, 0.06); sfx('thud', v.x, v.z); sfx('sword', v.x, v.z);
      break;
    }
    case 'lash': { // the Urumi whips out: several demons in a wide arc, out to two steps away
      const R = st.reach + 0.35, arc = st.arc || 1.5, fx0 = Math.sin(v.rot), fz0 = Math.cos(v.rot);
      const hits = s.enemies.filter((o) => {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.6)) return false;
        const rx = o.x - v.x, rz = o.z - v.z, d = Math.hypot(rx, rz);
        return d <= R + ENEMIES[o.type].r && (d < 0.5 || Math.acos(clamp((rx * fx0 + rz * fz0) / d, -1, 1)) <= arc);
      }).sort((p1, p2) => distXZ(p1.x, p1.z, v.x, v.z) - distXZ(p2.x, p2.z, v.x, v.z)).slice(0, st.maxHit || 3);
      for (const o of hits) hitEnemy(s, o, base * C, v, { crit, knock: 0.3 });
      fx(s, 'slash', { x: v.x, z: v.z, rot: v.rot, side: a.side, c: col, len: R + 0.2, heavy: crit });
      sfx(hits.length ? 'sword' : 'whoosh', v.x, v.z);
      gained = hits.length;
      break;
    }
    case 'coil': case 'serpent': { // Kalari Chakra / Sarpa Nritya: the whip-sword spins round, cutting and slowing all it reaches
      const R = a.kind === 'serpent' ? 2.9 : 2.4;
      let n = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.6) || distXZ(o.x, o.z, v.x, v.z) > R + ENEMIES[o.type].r) continue;
        hitEnemy(s, o, base * (a.kind === 'serpent' ? 1.3 : 0.9) * C, v, { crit, knock: 0.7 });
        o.slowT = Math.max(o.slowT || 0, 2.5);
        n++;
      }
      for (let k = 0; k < 3; k++) fx(s, 'slash', { x: v.x, z: v.z, rot: v.rot + (k * Math.PI * 2) / 3, side: 1, c: a.ult ? 0xffd27a : col, len: R, heavy: true });
      fx(s, 'ring', { x: v.x, z: v.z, r: R + 0.2, c: a.ult ? 0xffd27a : col, dur: 0.35 });
      sfx('whoosh', v.x, v.z); if (n) sfx('sword', v.x, v.z);
      gained = n;
      break;
    }
    case 'whirl': { // Veer Chakra: the Sainik spins, cutting everything around him
      const R = 1.8;
      let n = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.2) || distXZ(o.x, o.z, v.x, v.z) > R + ENEMIES[o.type].r) continue;
        hitEnemy(s, o, base * 1.35 * C, v, { crit, knock: 1.1, big: true });
        n++;
      }
      for (let k = 0; k < 3; k++) fx(s, 'slash', { x: v.x, z: v.z, rot: v.rot + (k * Math.PI * 2) / 3, side: 1, c: 0xffd27a, len: R, heavy: true });
      fx(s, 'ring', { x: v.x, z: v.z, r: R + 0.2, c: 0xffd27a, dur: 0.35 });
      sfx('sword', v.x, v.z); sfx('whoosh', v.x, v.z); shake(s, 0.06);
      break;
    }
    case 'leap': { // Hanuman Kudaan: the Gadadhari lands among them and the earth itself breaks
      const R = 3.2;
      let n = 0;
      for (const o of s.enemies) {
        if (o.dead || (ENEMIES[o.type].fly && o.y > 1.2) || distXZ(o.x, o.z, v.x, v.z) > R + ENEMIES[o.type].r) continue;
        hitEnemy(s, o, base * 2.6 * C, v, { crit, knock: 2.6, stun: 2.0, big: true });
        n++;
      }
      fx(s, 'ring', { x: v.x, z: v.z, r: R + 0.5, c: 0xffd27a, dur: 0.7 });
      fx(s, 'ring', { x: v.x, z: v.z, r: R - 0.8, c: 0xffb347, dur: 0.5 });
      fx(s, 'ring', { x: v.x, z: v.z, r: 1.2, c: 0xfff0c0, dur: 0.3 });
      fx(s, 'impact', { x: v.x, y: 0.3, z: v.z, c: 0xffd27a, s: 2.8 });
      emit(s, v.x, 0.1, v.z, 46, { spread: 1.6, vx: 4, vyMin: 0.8, vyMax: 3.5, life: 1.1, colors: ['#d8c4a0', '#c8b08a', '#a89070', '#8a7a66'], g: 5 });
      shake(s, 0.6); hitStop(s, 0.1);
      sfx('boom', v.x, v.z); sfx('thud', v.x, v.z); sfx('cannon', v.x, v.z);
      if (n >= 3) floater(s, v.x, 2.6, v.z, `×${n}`, '#ffd27a', 'callout');
      break;
    }
  }
  if (!a.ult) addPower(s, v, Math.min(14, SHAKTI.hit * gained));
  if (Math.random() < 0.12) sfx('warcry', v.x, v.z); // "Har Har Mahadev!"
}
function warriorAI(s, v, dt, phase, spd) {
  const night = phase !== 'day';
  const R = territory(s);
  if (tickAttack(s, v, dt)) return; // committed to a swing
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
    // a spearman can start his lunge from further out
    const lungeOK = v.job === 'spear' && (v.abilT || 0) <= 0 && d < reach + 1.4 && d > reach * 0.6;
    const leapOK = v.job === 'brute' && (v.power || 0) >= 100 && d < 7; // Hanuman's leap starts from afar
    if (d > reach && !lungeOK && !leapOK) {
      const k = (d - reach + 0.1) / d;
      moveTo(v, v.x + (e.x - v.x) * k, v.z + (e.z - v.z) * k, spd * 1.25 * st.speed, dt);
      v.task = 'Charging the ' + def.name;
    } else {
      faceTo(v, e.x, e.z);
      v.anim = 'fight';
      v.task = 'Fighting the ' + def.name;
      if (v.atkCd <= 0) startMelee(s, v, e);
    }
    return;
  }
  if (night) {
    const p = postPos(s, v);
    if (moveTo(v, p.x, p.z, spd * 1.2, dt)) {
      v.anim = s.enemies.length ? 'fight' : 'stand'; // weapons up once demons are out
      v.rot = Math.atan2(p.x, p.z);
      v.task = 'Guarding the ' + compassOf(p.x, p.z);
    } else v.task = 'Taking position for the night';
    return;
  }
  const a = validWorkplace(s, v, 'akhara');
  if (!a) { v.task = 'Needs an Akhara'; return idleAI(s, v, dt, spd); }
  // sparring pairs on a 3×3 grid inside the pit (room for every place an upgraded Akhara gives)
  const i = workplaceIndex(s, v), col = i % 3, row = Math.floor(i / 3) % 3;
  const lx = -0.95 + col * 0.95, lz = -0.65 + row * 0.85;
  const p = localToWorld(a, lx, lz);
  if (moveTo(v, p.x, p.z, spd, dt)) {
    const q = localToWorld(a, col === 1 ? lx - 0.95 : lx + (col === 0 ? 0.95 : -0.95), lz); // face a sparring partner
    faceTo(v, q.x, q.z);
    v.anim = (Math.floor(v.animT * 0.5 + i) % 3 === 0) ? 'fight' : 'work';
    v.task = 'Training at the Akhara';
  } else v.task = 'Walking to the Akhara';
}
/** Loose an arrow from an archer or longbowman (crits fly gold; volleys and Agni Baan burn; longbow arrows pierce). */
function archerShot(s, v, target, o) {
  o = o || {};
  const M = SOLDIER_MOVES[v.job] || SOLDIER_MOVES.archer, st = SOLDIERS[v.job] || SOLDIERS.archer;
  const crit = Math.random() < (M.crit || 0);
  const dmg = (st.dmg || 6) * (s.upgrades.bow ? 1.5 : 1) * (s.festival ? 1.5 : 1) * (o.mult || 1) * (crit ? 1.8 : 1);
  const p = shootArrow(s, v.x, 1.0, v.z, target, dmg, false, o.kind || 'arrow', o.speed || (v.job === 'longbow' ? 23 : 17));
  p.crit = crit; p.fire = !!(o.fire || s.upgrades.agnibaan); p.byArcher = true; p.owner = v.id;
  if (o.pierce || st.pierce) p.pierce = o.pierce || st.pierce; // a longbow arrow goes on through the demons behind
  return p;
}
/** Throw a chakram: it flies flat to the target, bounces on to the next demon nearby, and comes back to the hand. */
function chakramThrow(s, v, target, bounces, mult) {
  const st = SOLDIERS.chakri, M = SOLDIER_MOVES.chakri;
  const crit = Math.random() < (M.crit || 0);
  const dmg = st.dmg * (s.upgrades.talwar ? 1.3 : 1) * (s.festival ? 1.5 : 1) * (mult || 1) * (crit ? 1.8 : 1);
  const p = { x: v.x + Math.sin(v.rot) * 0.3, y: 1.0, z: v.z + Math.cos(v.rot) * 0.3, vx: 0, vy: 0, vz: 0, dmg, life: 6, kind: 'chakram', flat: true, tgt: target, bounce: bounces, hit: new Set(), owner: v.id, crit, spd: 11, stuck: false, dead: false };
  s.projectiles.push(p);
  sfx('whoosh', v.x, v.z);
  return p;
}
function nextChakramTarget(s, p) {
  let best = null, bd = 3.8;
  for (const e of s.enemies) {
    if (e.dead || p.hit.has(e.id) || e.hidden > 0 || (ENEMIES[e.type].fly && e.y > 2.2)) continue;
    const d = distXZ(e.x, e.z, p.x, p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function chakramStep(s, p, dt) {
  p.life -= dt;
  if (p.life <= 0) { p.dead = true; return; }
  const owner = s.villagers.find((u) => u.id === p.owner);
  if (!p.returning && (!p.tgt || p.tgt.dead || p.tgt.hidden > 0)) { const n = p.bounce >= 0 ? nextChakramTarget(s, p) : null; if (n) p.tgt = n; else p.returning = true; }
  let tx, ty, tz;
  if (p.returning) { if (!owner || owner.inside) { p.dead = true; return; } tx = owner.x; ty = 1.0; tz = owner.z; }
  else { tx = p.tgt.x; ty = p.tgt.y + ENEMIES[p.tgt.type].h * 0.5; tz = p.tgt.z; }
  const dx = tx - p.x, dy = ty - p.y, dz = tz - p.z, d = Math.hypot(dx, dy, dz) || 1, step = p.spd * dt;
  p.vx = (dx / d) * p.spd; p.vy = (dy / d) * p.spd; p.vz = (dz / d) * p.spd;
  if (d > step + 0.2) { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; return; }
  p.x = tx; p.y = ty; p.z = tz;
  if (p.returning) { p.dead = true; return; } // caught again
  const e = p.tgt;
  hitEnemy(s, e, p.dmg, p, { crit: p.crit, knock: 0.45 });
  p.hit.add(e.id);
  if (owner) addPower(s, owner, SHAKTI.arrow);
  fx(s, 'impact', { x: p.x, y: p.y, z: p.z, c: 0xd8e8ff, s: 0.8 });
  sfx('sword', p.x, p.z);
  p.dmg *= 0.85;
  p.bounce--;
  if (p.bounce >= 0) { const n = nextChakramTarget(s, p); if (n) { p.tgt = n; return; } }
  p.returning = true;
}
/** How each ranged soldier shoots: their normal shot, their special, and the moment they loose it. */
const RANGED_KIT = {
  archer:  { shot: 'shoot', ab: 'volley',   abWhen: (s, v, t) => enemiesNear(s, t.x, t.z, 3) >= 3 },
  longbow: { shot: 'shoot', ab: 'pierce',   abWhen: (s, v, t) => enemiesNear(s, t.x, t.z, 3) >= 2 || ENEMIES[t.type].boss || ENEMIES[t.type].cost >= 6 },
  chakri:  { shot: 'throw', ab: 'ricochet', abWhen: (s, v, t) => enemiesNear(s, t.x, t.z, 3.5) >= 3 },
};
function rangedRelease(s, v, a, range) {
  const foe = a.foe && !a.foe.dead ? a.foe : null;
  switch (a.kind) {
    case 'volley': { // Baan Varsha: five fire arrows rain on the crowd around the target
      const c = foe || nearestEnemy(s, v.x, v.z, range, false);
      if (c) {
        const pool = s.enemies.filter((o) => !o.dead && distXZ(o.x, o.z, c.x, c.z) < 3).sort(() => Math.random() - 0.5);
        for (let i = 0; i < 5; i++) archerShot(s, v, pool[i % pool.length] || c, { fire: true, mult: 0.9 });
      }
      sfx('bow', v.x, v.z); sfx('whoosh', v.x, v.z);
      break;
    }
    case 'astra': { // Agni Astra: one great blazing arrow into the thick of them
      const c = densestEnemy(s, v.x, v.z, range + 2, 2.6) || foe;
      if (c) { const p = archerShot(s, v, c, { kind: 'astra', mult: 7, fire: true, speed: 15 }); p.splash = 2.6; p.burn = 7; }
      sfx('bow', v.x, v.z); sfx('whoosh', v.x, v.z);
      break;
    }
    case 'pierce': { // Bhedi Baan: a heavy shaft that drives through the whole line
      if (foe) { archerShot(s, v, foe, { mult: 3, pierce: 8, speed: 28 }); fx(s, 'thrust', { x: v.x, z: v.z, rot: v.rot, c: 0xfff0c0, len: 3.2, heavy: true }); }
      sfx('bow', v.x, v.z); sfx('whoosh', v.x, v.z); shake(s, 0.04);
      break;
    }
    case 'rain': { // Shara Varsha: a dozen arrows fall over the thickest knot of demons
      const c = densestEnemy(s, v.x, v.z, range + 2, 3) || foe;
      if (c) {
        const pool = s.enemies.filter((o) => !o.dead && distXZ(o.x, o.z, c.x, c.z) < 3.4);
        for (let i = 0; i < 12; i++) archerShot(s, v, pool[i % pool.length] || c, { mult: 1.3, speed: 15 + (i % 4) });
      }
      sfx('bow', v.x, v.z); sfx('whoosh', v.x, v.z);
      break;
    }
    case 'throw': if (foe) chakramThrow(s, v, foe, SOLDIERS.chakri.bounce, 1); break;
    case 'ricochet': if (foe) chakramThrow(s, v, foe, 6, 1.2); break;
    case 'fan': { // Chakra Toofan: five rings at once, each to its own demon
      const near = s.enemies.filter((o) => !o.dead && !(o.hidden > 0) && distXZ(o.x, o.z, v.x, v.z) < range + 1).sort((p1, p2) => distXZ(p1.x, p1.z, v.x, v.z) - distXZ(p2.x, p2.z, v.x, v.z));
      for (let i = 0; i < 5; i++) { const t = near[i % Math.max(1, near.length)] || foe; if (t) chakramThrow(s, v, t, 3, 1.4); }
      fx(s, 'ring', { x: v.x, z: v.z, r: 1.4, c: 0xd8e8ff, dur: 0.4 });
      break;
    }
    default: if (foe) { archerShot(s, v, foe); sfx('bow', v.x, v.z); }
  }
}
/** Archers, longbowmen and chakram throwers: they hold the second line and fight from range. */
function archerAI(s, v, dt, phase, spd) {
  const night = phase !== 'day';
  const st = SOLDIERS[v.job] || SOLDIERS.archer, kit = RANGED_KIT[v.job] || RANGED_KIT.archer;
  const range = (st.range || 10) + (s.upgrades.bow && v.job !== 'chakri' ? 2.5 : 0);
  if (v.atk) { // drawing (or winding up a throw): the shot flies at the release point
    const a = v.atk;
    a.t += dt;
    v.anim = 'atk';
    if (a.foe && !a.foe.dead) faceTo(v, a.foe.x, a.foe.z);
    if (!a.done && a.t >= a.dur * a.hit) { a.done = true; rangedRelease(s, v, a, range); }
    if (a.t >= a.dur) v.atk = null;
    return;
  }
  const close = nearestEnemy(s, v.x, v.z, 0.9, true);
  if (close && !(close.type === 'bhoot' && v.hp > 20)) {
    const d = distXZ(v.x, v.z, close.x, close.z) || 1;
    moveTo(v, v.x + ((v.x - close.x) / d) * 2, v.z + ((v.z - close.z) / d) * 2, spd * 1.3, dt);
    v.task = 'Falling back!';
    v.combatT = 1.5;
    return;
  }
  const target = nearestEnemy(s, v.x, v.z, range, false);
  const word = v.job === 'chakri' ? 'chakram ready' : 'bow ready';
  if (night && !target) {
    const p = postPos(s, v);
    if (moveTo(v, p.x, p.z, spd * 1.2, dt)) { v.anim = 'stand'; v.rot = Math.atan2(p.x, p.z); v.task = 'Watching the ' + compassOf(p.x, p.z) + ' with ' + word; }
    else v.task = 'Taking position for the night';
    return;
  }
  if (target) {
    faceTo(v, target.x, target.z);
    v.anim = 'shoot';
    v.combatT = 1.5;
    v.task = (v.job === 'chakri' ? 'Throwing chakrams at the ' : 'Shooting at the ') + ENEMIES[target.type].name;
    if (v.atkCd <= 0 && (v.power || 0) >= 100 && ULTIMATES[v.job]) { startUltimate(s, v, ULTIMATES[v.job].key, target); return; }
    if (v.atkCd <= 0) {
      const ab = SOLDIER_MOVES[v.job].ability;
      const special = (v.abilT || 0) <= 0 && kit.abWhen(s, v, target);
      const kind = special ? kit.ab : kit.shot;
      v.atk = { kind, t: 0, dur: SWINGS[kind].dur, hit: SWINGS[kind].hit, foe: target, done: false };
      v.atkCd = st.cd || 1.35;
      if (special) { v.abilT = ab.cd; floater(s, v.x, 2.0, v.z, ab.name + '!', '#ffd27a', 'callout'); }
    }
    return;
  }
  const rg = validWorkplace(s, v, 'range');
  if (!rg) { v.task = 'Needs a Dhanush Shala'; return idleAI(s, v, dt, spd); }
  // two ranks at the firing line under the shelter, each one on one of the three targets
  const i = workplaceIndex(s, v);
  const p = localToWorld(rg, -1.35 + (i >= 5 ? 0.45 : 0), -1.0 + (i % 5) * 0.5);
  if (!moveTo(v, p.x, p.z, spd, dt)) { v.task = 'Walking to the Dhanush Shala'; return; }
  const tg = localToWorld(rg, 1.55, [-0.9, 0, 0.9][i % 3]);
  faceTo(v, tg.x, tg.z);
  v.anim = 'shoot';
  v.task = v.job === 'chakri' ? 'Practising with the chakram' : v.job === 'longbow' ? 'Practising with the longbow' : 'Practising archery';
  v.offerT += dt;
  if (v.offerT > 2.6 + i * 0.4) { v.offerT = 0; shootArrow(s, v.x, 1.0, v.z, { x: tg.x, y: 0.95, z: tg.z, practice: true }, 0, true, v.job === 'chakri' ? 'chakram' : 'arrow'); }
}
function updateVillager(s, v, dt, phase) {
  v.animT += dt;
  if (v.hurtT > 0) v.hurtT -= dt;
  if (v.atkCd > 0) v.atkCd -= dt;
  if (v.combatT > 0) v.combatT -= dt;
  if (v.blockT > 0) v.blockT -= dt;
  if (v.abilT > 0) v.abilT -= dt;
  if (v.poisonT > 0) { // the Naag Pret's venom
    v.poisonT -= dt; v.hp -= (v.poisonDps || 2) * dt; v.combatT = Math.max(v.combatT || 0, 1);
    if (Math.random() < dt * 3) emit(s, v.x, 1.0, v.z, 1, { spread: 0.15, vx: 0.2, vyMin: 0.4, vyMax: 0.9, life: 0.7, colors: ['#8aff8a', '#4fd06a'], g: -0.5, add: true });
    if (v.hp <= 0) { killVillager(s, v); return; }
  }
  naturalHealing(s, v, dt);
  if (v.power > 0 && phase === 'day' && !(v.combatT > 0) && !s.enemies.length) v.power = Math.max(0, v.power - 3 * dt); // Shakti fades in peacetime
  v.task = '';
  if (v.sleep && (phase === 'day' || isDefender(v))) wakeUp(s, v);
  else if (v.sleep && !v.inside) v.sleep = false; // sleepers by the fire lie down again each moment they rest
  if (v.stunT > 0) { v.stunT -= dt; v.atk = null; v.anim = 'stand'; v.task = 'Staggered by a demon’s roar'; return; }
  if (v.heldBy) { // seized by a Mamdo Bhoot: helpless until someone breaks its grip
    const m = s.enemies.find((e) => e.id === v.heldBy && !e.dead && e.grab && e.grab.v === v);
    if (m) { v.inside = false; v.atk = null; v.anim = 'stand'; faceTo(v, m.x, m.z); v.task = 'Seized by a Mamdo Bhoot!'; return; }
    v.heldBy = null;
  }
  const spd = villagerSpeed(s, v);
  if (v.arriving) {
    v.task = 'Arriving at the village';
    if (moveTo(v, v.ax, v.az, spd, dt)) v.arriving = false;
    return;
  }
  if (v.entranced > 0) { // Nishi Dak is calling their name in a loved one's voice — they walk out toward it
    v.entranced -= dt;
    const n = s.enemies.find((e) => e.id === v.callBy && !e.dead);
    if (n && phase !== 'day') {
      // a Pujari's chant, a Mandir's bells or a soldier at their side breaks the spell
      const guard = s.villagers.find((o) => o !== v && ((o.job === 'priest' && distXZ(o.x, o.z, v.x, v.z) < 6) || (isDefender(o) && distXZ(o.x, o.z, v.x, v.z) < 1.4)))
        || s.buildings.find((b) => b.type === 'temple' && b.done && distXZ(b.x, b.z, v.x, v.z) < 8);
      if (guard) { breakNishiSpell(s, v, guard.job ? `${guard.name} pulls them back` : 'The Mandir bells drown out the voice'); return; }
      v.inside = false; v.shelter = null;
      v.task = `Answering a voice that calls their name… (${Math.ceil(distXZ(v.x, v.z, n.x, n.z))} steps from Nishi Dak)`;
      moveTo(v, n.x, n.z, spd * 0.55, dt);
      if (distXZ(v.x, v.z, n.x, n.z) < 0.9) return consumeSoul(s, v, n);
      return;
    }
    v.entranced = 0;
  }
  // by day, a building being upgraded gets help from its own workers, its idle residents and anyone sent there
  if (phase === 'day' && !(isDefender(v) && (v.atk || (v.foe && !v.foe.dead)))) {
    const ub = upgradeToHelp(s, v);
    if (ub && !nearestEnemy(s, v.x, v.z, 6, true)) return upgradeHelpAI(s, v, ub, dt, spd);
  }
  if (isMelee(v)) return warriorAI(s, v, dt, phase, spd);
  if (v.job === 'archer' || v.job === 'longbow' || v.job === 'chakri') return archerAI(s, v, dt, phase, spd);
  if (v.job === 'medic') return medicAI(s, v, dt, phase, spd);
  if (shelterAI(s, v, dt, spd)) return;
  if (v.job === 'priest') priestHeal(s, v, dt);
  if (v.job === 'vaidya') return vaidyaAI(s, v, dt, spd, phase); // healers keep working at night, inside the village
  if (v.job === 'build' && phase !== 'day' && !v.sleep && builderAI(s, v, dt, spd, true)) return; // a Mistri mends what the demons broke
  if (phase !== 'day') return homeAI(s, v, dt, spd);
  switch (v.job) {
    case 'wood': return gatherAI(s, v, dt, spd, 'wood');
    case 'stone': return gatherAI(s, v, dt, spd, 'stone');
    case 'farm': return farmAI(s, v, dt, spd);
    case 'fish': return fishAI(s, v, dt, spd);
    case 'clay': return clayAI(s, v, dt, spd);
    case 'kiln': case 'smelt': return processAI(s, v, dt, spd);
    case 'build': builderAI(s, v, dt, spd); return;
    case 'priest': return priestAI(s, v, dt, spd);
    case 'trader': return traderAI(s, v, dt, spd);
    default: if (lootAI(s, v, dt, spd)) return; return builderAI(s, v, dt, spd); // idle hands build, upgrade and repair
  }
}
function damageVillager(s, v, dmg, from) {
  const A = isDefender(v) && armourOf(v);
  if (A) dmg *= 1 - A.def; // armour takes its share off every blow
  v.combatT = 4; // no natural recovery until a few seconds after the last blow
  const M = SOLDIER_MOVES[v.job];
  if (M && M.block && !v.atk && Math.random() < M.block) { // a Sainik catches the blow on the dhaal
    dmg *= 0.15;
    v.blockT = 0.35;
    floater(s, v.x, 1.75, v.z, 'Blocked', '#9fd0ff', 'tag');
    fx(s, 'impact', { x: v.x + Math.sin(v.rot) * 0.3, y: 0.75, z: v.z + Math.cos(v.rot) * 0.3, c: 0xbfe2ff, s: 0.9 });
    sfx('thunk', v.x, v.z);
  } else {
    v.hurtT = 0.25;
    fx(s, 'impact', { x: v.x, y: 0.85, z: v.z, c: 0xff5a4a, s: 0.7 });
    emit(s, v.x, 0.8, v.z, 3, { spread: 0.1, vx: 1.5, vyMin: 1, vyMax: 3, life: 0.5, colors: ['#e03c31', '#a3161f'], g: 14 });
    sfx('hurt', v.x, v.z);
  }
  v.hp -= dmg;
  addPower(s, v, SHAKTI.struck); // pain feeds a fighter's Shakti
  if (dmg >= 1) floater(s, v.x + rand(-0.12, 0.12), 1.6, v.z, String(Math.round(dmg)), '#ff7a6b', 'dmg hurt');
  if (!isDefender(v)) v.scared = true;
  if (v.hp <= 0) killVillager(s, v);
}
/*
 * Natural recovery: quick by the warm Agnikund, steady while resting indoors, slow anywhere else as long as
 * no demon is near and the villager has not been hit for a few seconds.
 */
const REGEN = { fire: 4, home: 2.5, calm: 0.8 };
function naturalHealing(s, v, dt) {
  v.regenT = (v.regenT || 0) - dt;
  if (v.regenT <= 0) {
    v.regenT = 0.5;
    let kind = null;
    if (v.combatT > 0 || v.arriving) kind = null;
    else if (v.inside) kind = 'home';
    else if (Math.hypot(v.x, v.z) < scorchRadius(s) + 1.8) kind = 'fire';
    else if (!nearestEnemy(s, v.x, v.z, 7, false)) kind = 'calm';
    v.regen = kind;
  }
  if (!v.regen || v.hp >= v.maxHp) return;
  v.hp = Math.min(v.maxHp, v.hp + REGEN[v.regen] * dt);
  if (v.regen === 'fire' && !v.inside && Math.random() < dt * 1.5) emit(s, v.x, 0.9, v.z, 1, { spread: 0.25, vx: 0.15, vyMin: 0.5, vyMax: 1.1, life: 1, colors: ['#ffd27a', '#8ef09a', '#fff3b0'], g: -0.4, add: true });
}
/*
 * Chikitsak (field medic): follows the fighting at a safe distance, channels healing into the most hurt
 * person nearby, and every so often pours Amrit Varsha over everyone around.
 */
function medicAI(s, v, dt, phase, spd) {
  const night = phase !== 'day';
  const R = territory(s);
  const heal = (SOLDIERS.medic.heal || 9) * workRate(s);
  if (v.atk) { // the healing rain
    const a = v.atk;
    a.t += dt;
    v.anim = 'atk';
    if (!a.done && a.t >= a.dur * a.hit) {
      a.done = true;
      const big = a.kind === 'sanjeevani', R = big ? 6 : 3.6; // Sanjeevani: everyone near is made whole
      for (const o of s.villagers) {
        if (o.inside || distXZ(o.x, o.z, v.x, v.z) > R || o.hp >= o.maxHp) continue;
        const add = big ? o.maxHp - o.hp : 25;
        o.hp = Math.min(o.maxHp, o.hp + add);
        floater(s, o.x, 1.7, o.z, '+' + Math.round(add), '#8ef09a', 'dmg heal');
        for (let i = 0; i < (big ? 4 : 2); i++) healGlow(s, o);
      }
      fx(s, 'ring', { x: v.x, z: v.z, r: R, c: 0x8ef09a, dur: big ? 1.0 : 0.7 });
      if (big) fx(s, 'ring', { x: v.x, z: v.z, r: R * 0.6, c: 0xd8ffd0, dur: 0.7 });
      fx(s, 'impact', { x: v.x, y: 1.6, z: v.z, c: 0xb8ffc0, s: big ? 2.8 : 1.6 });
      emit(s, v.x, 2.2, v.z, big ? 50 : 24, { spread: R * 0.6, vx: 0.2, vyMin: -1.6, vyMax: -0.6, life: 1.1, colors: ['#8ef09a', '#d8ffd0', '#fff3b0'], g: 0.5, add: true });
      sfx('heal', v.x, v.z); sfx('bellSoft', v.x, v.z);
      if (!big) addPower(s, v, SHAKTI.pulse);
    }
    if (a.t >= a.dur) v.atk = null;
    return;
  }
  v.healTo = null;
  const close = nearestEnemy(s, v.x, v.z, 1.5, true);
  if (close) { // never stand in the melee
    const d = distXZ(v.x, v.z, close.x, close.z) || 1;
    moveTo(v, v.x + ((v.x - close.x) / d) * 2, v.z + ((v.z - close.z) / d) * 2, spd * 1.3, dt);
    v.task = 'Ducking away from the ' + ENEMIES[close.type].name;
    v.combatT = 1.5;
    return;
  }
  v.thinkT -= dt;
  if (v.thinkT <= 0 || (v.patient && (v.patient.hp >= v.patient.maxHp || !s.villagers.includes(v.patient)))) {
    v.thinkT = 0.3;
    let best = null, bs = Infinity, cur = Infinity;
    for (const o of s.villagers) {
      if (o === v || o.inside || o.arriving || o.hp >= o.maxHp * 0.95) continue;
      const d = distXZ(o.x, o.z, v.x, v.z);
      if (d > 14 || Math.hypot(o.x, o.z) > R + 4) continue;
      const score = (o.hp / o.maxHp) * 10 + d * 0.35 - (isDefender(o) ? 2 : 0);
      if (o === v.patient) cur = score;
      if (score < bs) { bs = score; best = o; }
    }
    if (!(cur < Infinity && bs > cur - 1.5)) v.patient = best; // stick with the patient unless someone is clearly worse off
  }
  const p = v.patient;
  if (p) {
    if ((v.power || 0) >= 100 && s.villagers.some((o) => !o.inside && o.hp < o.maxHp * 0.6 && distXZ(o.x, o.z, v.x, v.z) < 6)) { startUltimate(s, v, 'sanjeevani', null); return; }
    // Amrit Varsha when several around are hurt
    if ((v.abilT || 0) <= 0) {
      let hurt = 0;
      for (const o of s.villagers) if (!o.inside && o.hp < o.maxHp * 0.8 && distXZ(o.x, o.z, v.x, v.z) < 3.6) hurt++;
      if (hurt >= 2) {
        const ab = SOLDIER_MOVES.medic.ability;
        v.abilT = ab.cd;
        v.atk = { kind: 'pulse', t: 0, dur: SWINGS.pulse.dur, hit: SWINGS.pulse.hit, done: false };
        floater(s, v.x, 2.0, v.z, ab.name + '!', '#b8ffc0', 'callout');
        return;
      }
    }
    const d = distXZ(p.x, p.z, v.x, v.z);
    if (d > 2.6) { moveTo(v, p.x, p.z, spd * 1.15, dt); v.task = `Running to heal ${p.name}`; return; }
    faceTo(v, p.x, p.z);
    v.anim = 'heal';
    v.healTo = p.id;
    if (p.hp < p.maxHp) addPower(s, v, SHAKTI.healPerSec * dt);
    p.hp = Math.min(p.maxHp, p.hp + heal * dt);
    p.healBy = v.name; p.healT = s.time + 0.6; p.healNear = true;
    if (night) v.combatT = 1.5;
    v.task = `Healing ${p.name} (${Math.ceil(p.hp)} / ${p.maxHp})`;
    if (Math.random() < dt * 5) healGlow(s, p);
    sfx('heal', v.x, v.z);
    return;
  }
  if (night || s.enemies.length) {
    const pp = postPos(s, v);
    if (moveTo(v, pp.x, pp.z, spd * 1.2, dt)) { v.anim = 'stand'; v.rot = Math.atan2(pp.x, pp.z); v.task = 'Standing behind the soldiers with the medicine kit'; }
    else v.task = 'Following the soldiers';
    return;
  }
  const a = validWorkplace(s, v);
  if (!a) { v.task = 'Needs an Akhara'; return idleAI(s, v, dt, spd); }
  const sp = frontSpot(s, v, a, 0.9);
  if (!moveTo(v, sp.x, sp.z, spd, dt)) { v.task = 'Walking to the Akhara'; return; }
  faceTo(v, a.x, a.z);
  v.anim = 'work';
  v.task = 'Rolling bandages and mixing medicine';
}
function killVillager(s, v) {
  const i = s.villagers.indexOf(v);
  if (i < 0) return;
  s.villagers.splice(i, 1);
  s.stats.lost++;
  if (v.armour) s.armory[v.armour] = (s.armory[v.armour] || 0) + 1; // the fallen soldier's armour is carried back to the armoury
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
function rockImpact(s, p) {
  p.dead = true;
  for (const v of s.villagers) if (!v.inside && distXZ(v.x, v.z, p.x, p.z) < p.splash) damageVillager(s, v, p.dmg * (distXZ(v.x, v.z, p.x, p.z) < 0.6 ? 1 : 0.6), p);
  const b = buildingAtPoint(s, p.x, p.z);
  if (b && b.hp > 0 && !BUILDINGS[b.type].road) { b.hp -= p.dmg * 1.5; if (b.hp <= 0) destroyBuilding(s, b); }
  fx(s, 'ring', { x: p.x, z: p.z, r: p.splash + 0.3, c: 0xc8b08a, dur: 0.5 });
  emit(s, p.x, 0.2, p.z, 22, { spread: 0.5, vx: 2.6, vyMin: 1, vyMax: 3.5, life: 0.9, colors: ['#8a8a8a', '#6b6b6b', '#a89a86'], g: 8 });
  shake(s, 0.22); sfx('crash', p.x, p.z);
}
/** Fire pots and cannon balls burst where they land. */
function explode(s, p) {
  p.dead = true;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = distXZ(p.x, p.z, e.x, e.z);
    if (d > p.splash + ENEMIES[e.type].r || e.y > 2.5) continue;
    const fire = p.kind === 'pot' || p.kind === 'astra';
    hitEnemy(s, e, p.dmg * (d < 0.6 ? 1 : 0.6), p, { knock: p.kind === 'astra' ? 2 : 1.5, big: true, fire });
    if (fire) { e.fireT = p.kind === 'astra' ? 6 : 3; e.fireDps = p.burn || 4; }
  }
  const fireK = p.kind === 'pot' || p.kind === 'astra';
  fx(s, 'ring', { x: p.x, z: p.z, r: p.splash + 0.4, c: fireK ? 0xff8a1f : 0xd8c4a0, dur: p.kind === 'astra' ? 0.7 : 0.45 });
  fx(s, 'impact', { x: p.x, y: 0.5, z: p.z, c: fireK ? 0xffb347 : 0xfff0c0, s: p.kind === 'astra' ? 3 : 1.7 });
  shake(s, p.kind === 'ball' ? 0.22 : p.kind === 'astra' ? 0.3 : 0.1);
  if (p.kind === 'astra') emit(s, p.x, 0.3, p.z, 40, { spread: p.splash * 0.7, vx: 2.6, vyMin: 1.2, vyMax: 5, life: 1.2, colors: ['#ff8a1f', '#ffcc33', '#d8361c', '#fff3b0'], g: 1.5, add: true });
  if (fireK) {
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
    if (p.flat) { chakramStep(s, p, dt); continue; } // a thrown chakram homes in, bounces and returns
    p.vy -= GRAV3 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.life -= dt;
    if (p.kind === 'pot' && Math.random() < 0.6) emitFire(s, p.x, p.y, p.z);
    if (p.fire && Math.random() < 0.45) emitFire(s, p.x, p.y, p.z); // Agni Baan and volley arrows burn as they fly
    if (p.hostile) { // a demon's boulder: it crashes down on whoever stands where it lands
      if (p.y <= 0.05) { rockImpact(s, p); continue; }
    } else if (p.practice) {
      if (p.y < 1.1 && p.vy < 0 && p.life < 3.6) { p.stuck = true; p.life = 1.5; sfx('thunk', p.x, p.z); }
    } else {
      for (const e of s.enemies) {
        if (e.dead) continue;
        const d = ENEMIES[e.type];
        if (distXZ(p.x, p.z, e.x, e.z) < d.r + 0.2 && p.y > e.y - 0.1 && p.y < e.y + d.h + 0.1) {
          if (p.kind !== 'arrow') { explode(s, p); break; }
          if (p.passed && p.passed.has(e.id)) continue;
          hitEnemy(s, e, p.dmg, p, { crit: p.crit, knock: p.crit ? 0.6 : 0.25, fire: p.fire });
          if (p.fire || s.upgrades.agnibaan) { e.fireT = 2.5; e.fireDps = 3; }
          if (p.crit) hitStop(s, 0.03);
          if (p.owner) { const o = s.villagers.find((u) => u.id === p.owner); if (o) addPower(s, o, SHAKTI.arrow); }
          if (p.pierce > 1) { p.pierce--; (p.passed || (p.passed = new Set())).add(e.id); p.dmg *= 0.8; continue; } // on through the next one
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
const WAVE_CAP = 150;
/** How much tougher every demon is on a night when the host has hit WAVE_CAP (1 until then). */
function nightMight(d) { const raw = 3 + (d - 1) * 2.7 + Math.pow(Math.max(0, d - 6), 2) * 0.45; return raw > WAVE_CAP ? Math.sqrt(raw / WAVE_CAP) : 1; }
function makeWave(s) {
  const d = s.day;
  let budget = 3 + (d - 1) * 2.7 + Math.pow(Math.max(0, d - 6), 2) * 0.45;
  // endless nights: past a point the host stops growing in number (the village could not hold the crowd)
  // and grows in strength instead (see spawnEnemy and enemyStrike); a red moon brings a third more
  budget = Math.min(budget, WAVE_CAP);
  if (moonOf(d) === 'red') budget *= 1.3;
  const types = [];
  while (budget >= 1) {
    const opts = [['bhoot', Math.max(1, 6 - d * 0.5)]];
    if (d >= 2 && budget >= 2) opts.push(['rakshasa', 3 + d * 0.3]);
    if (d >= 4 && budget >= 2) opts.push(['vetala', 1.5 + d * 0.15]);
    if (d >= 6 && budget >= 6) opts.push(['danav', 0.6 + d * 0.1]);
    // Bengali ghosts join the nights one by one
    for (const k of ['aleya', 'shakchunni', 'mechho', 'nishi', 'mamdo', 'skondhokata']) {
      const E = ENEMIES[k];
      if (d >= E.from && budget >= E.cost) opts.push([k, k === 'skondhokata' ? 0.7 + d * 0.08 : k === 'nishi' ? 0.9 : k === 'mamdo' ? 0.8 + d * 0.06 : 1.6 + d * 0.12]);
    }
    // and the spirit beasts: a jackal pack, the ghost cobra, the ghost tiger, the thorn boar
    for (const [k, w] of [['shiyal', 1.3 + d * 0.1], ['naag', 1.0 + d * 0.08], ['bagh', 0.8 + d * 0.08], ['shuar', 0.7 + d * 0.07]]) {
      const E = ENEMIES[k];
      if (d >= E.from && budget >= E.cost) opts.push([k, w]);
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
  const bt = bossForDay(d);
  if (bt) { // a great asura comes tonight, from where his omen pointed
    q.push({ type: bt, front: 0, at: NIGHT_T + 14 }); fronts[0].w += 10;
    if (s.omen && s.omen.type === bt && s.omen.a != null) fronts[0].a = s.omen.a;
  }
  q.sort((a, b) => a.at - b.at);
  return { q, fronts };
}
function spawnEnemy(s, type, a) {
  const def = ENEMIES[type];
  const scale = (1 + (s.day - 1) * 0.07) * nightMight(s.day);
  const hp = Math.round(def.boss ? (def.hp * 0.84 + s.day * 70) * (moonOf(s.day) === 'red' && type === 'boss' ? 1.25 : 1) : def.minion ? def.hp : def.hp * scale);
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
  e.voiceT = rand(1.5, 6); // first growl / moan comes a moment after it appears
  s.enemies.push(e);
  const ES = ENEMY_SFX[type];
  if (ES && Math.random() < 0.6) sfx(ES.voice, e.x, e.z);
  if ((def.bengali || def.animal) && !s.demo) tip('ghost_' + type, `${def.name} — ${def.en}! ${ENEMY_LORE[type]}`); // introduce each new ghost once
  return e;
}
/**
 * Damage a demon. o: { crit, knock (push strength), stun (seconds), big (a heavy blow), quiet (no number) }.
 * Every hit flashes the demon, pops a damage number and an impact burst, and shoves it back by its weight.
 */
function hitEnemy(s, e, dmg, src, o) {
  if (e.dead) return 0;
  o = o || {};
  const def = ENEMIES[e.type];
  if (e.fake) { vanishFake(s, e, true); return dmg; } // one of Kalanemi's copies: smoke at the first blow
  const dealt = dmg * (e.vuln || 1);
  e.hp -= dealt;
  // the Kanta Shuar's spines: whoever strikes it up close is pricked in turn
  if (def.thorns && src && src.job && isDefender(src) && !RANGED_JOBS.has(src.job) && dealt >= 2 && distXZ(src.x, src.z, e.x, e.z) < def.r + 2.2 && s.villagers.includes(src)) {
    damageVillager(s, src, dealt * def.thorns, e);
    if (Math.random() < 0.3) floater(s, src.x, 1.95, src.z, 'Thorns!', '#e8a0a8', 'tag');
  }
  if (def.bloodseed && dealt >= 4 && e.hp > 0) { // Raktabija: where his blood falls, a demon rises (unless fire scorches it)
    if (o.fire || e.fireT > 0) { if (Math.random() < 0.15) floater(s, e.x, def.h + 0.4, e.z, 'Blood scorched!', '#ffb347', 'tag'); }
    else {
      e.bleed = (e.bleed || 0) + dealt;
      if (e.bleed >= 38) { e.bleed -= 38; spawnRakta(s, e, Math.random() * Math.PI * 2, 1.1 + Math.random() * 0.6); tip('raktabija', 'Each drop of Raktabija’s blood rises as a demon! Fire scorches his blood: hit him with fire pots and Agni Baan arrows, and kill him fast.'); }
    }
  }
  e.hurtT = 0.18;
  e.flashT = 0.12;
  if (Math.random() < 0.25 && !def.fly) sfx(def.ghost || def.float ? 'd_ghost' : 'demonHurt', e.x, e.z);
  if (!def.boss && src && src.x != null) {
    const d = distXZ(e.x, e.z, src.x, src.z) || 1, mass = def.fly ? 1.5 : Math.max(1, def.cost || 1);
    const k = ((o.knock != null ? o.knock : 0.4) * 4.5) / Math.sqrt(mass);
    e.kx = (e.kx || 0) + ((e.x - src.x) / d) * k; e.kz = (e.kz || 0) + ((e.z - src.z) / d) * k;
  }
  if (o.stun && !def.boss) { e.stunT = Math.max(e.stunT || 0, o.stun * (def.cost >= 6 ? 0.5 : 1)); e.wind = null; }
  const hy = e.y + def.h * 0.55;
  emit(s, e.x, hy, e.z, o.big ? 7 : 3, { spread: 0.1, vx: o.big ? 2.6 : 1.8, vyMin: 0, vyMax: 2.5, life: 0.45, colors: ['#7b3fa0', '#2b1638', '#c58af0'], g: 10 });
  fx(s, 'impact', { x: e.x, y: hy, z: e.z, c: o.crit ? 0xffd84a : o.fire ? 0xff9a40 : 0xfff2dc, s: o.crit ? 1.45 : o.big ? 1.15 : 0.75 });
  if (!o.quiet && dealt >= 0.5) {
    // quick hits on the same demon add up into one number instead of a pile of little ones
    const f = s.floaters.find((q) => q.eid === e.id && q.max - q.life < 0.3);
    if (f) {
      f.val += dealt; f.text = String(Math.round(f.val)); f.life = f.max; f.y = e.y + def.h + 0.2;
      if (o.crit) { f.cls = 'dmg crit'; f.color = '#ffd84a'; }
    } else {
      floater(s, e.x + rand(-0.18, 0.18), e.y + def.h + 0.2, e.z, String(Math.round(dealt)), o.crit ? '#ffd84a' : '#fff4e6', o.crit ? 'dmg crit' : 'dmg');
      const nf = s.floaters[s.floaters.length - 1]; nf.eid = e.id; nf.val = dealt;
    }
  }
  if (e.hp <= 0) killEnemy(s, e, true);
  return dealt;
}
const STREAK_CALLS = { 3: 'Shabash!', 5: 'Jai Ho!', 8: 'Har Har Mahadev!' };
function killEnemy(s, e, byHand) {
  if (e.dead) return;
  if (e.fake) return vanishFake(s, e, true); // a copy only ever was smoke
  e.dead = true;
  const def = ENEMIES[e.type];
  fx(s, 'death', { x: e.x, y: e.y + def.h * 0.5, z: e.z, c: def.glow || 0xb07ae0, s: def.scale });
  if (def.boss) { shake(s, 0.7); hitStop(s, 0.45); } else if (def.cost >= 6) shake(s, 0.18);
  if (byHand) { // kill streaks get a cheer
    s.streak = s.time - (s.lastKill || -9) < 1.6 ? (s.streak || 0) + 1 : 1;
    s.lastKill = s.time;
    if (STREAK_CALLS[s.streak]) floater(s, e.x, e.y + def.h + 0.9, e.z, `${STREAK_CALLS[s.streak]} ×${s.streak}`, '#ffb347', 'callout');
  }
  if (e.loot > 0) { // a caught Mechho Bhoot drops the stolen grain
    s.loot.push({ id: s.nextId++, kind: def.thief, amt: e.loot, x: e.x, z: e.z, t: 0 });
    floater(s, e.x, 1.6, e.z, 'Grain dropped!', RES[def.thief].color);
    e.loot = 0;
  }
  emit(s, e.x, e.y + def.h * 0.4, e.z, def.boss ? 60 : 16, { spread: def.r, spreadY: def.h / 3, vx: 1.4, vyMin: 1, vyMax: 3.5, life: 1.2, colors: ['#3d2552', '#5e3380', '#1a1020', '#8e5cb0'], g: -1 });
  if (byHand || !e.burning) {
    s.stats.killed++;
    dropLoot(s, e);
    sfx((ENEMY_SFX[e.type] && ENEMY_SFX[e.type].die) || 'demonDie', e.x, e.z);
    if (def.boss && !e.fake) { s.stats.bosses++; toast(`${def.name} is vanquished! The village rejoices — Jai ho!`, 'good', 8); }
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
/** How long a demon winds up before its blow lands: the bigger the demon, the clearer the warning. */
function windOf(def) { return def.wind != null ? def.wind : def.fly ? 0 : def.boss ? 0.8 : clamp(0.16 + (def.cost || 1) * 0.07, 0.2, 0.62); }
function enemyAttack(s, e, target, kind) {
  e.vx = 0; e.vz = 0;
  if (target) faceTo(e, target.x, target.z); else faceTo(e, 0, 0);
  if (e.atkCd > 0 || e.wind || e.stunT > 0) return;
  const def = ENEMIES[e.type];
  const w = windOf(def);
  if (w <= 0) return enemyStrike(s, e, target, kind);
  e.wind = { t: 0, dur: w, target, kind };
  if ((def.cost || 0) >= 2 || def.boss) fx(s, 'telegraph', { x: e.x, y: e.y + def.h * 0.95, z: e.z, c: 0xff4a3a, s: 0.55 * def.scale, dur: w });
}
/* ---------- demon power moves ---------- */
const nearestFoe = (s, x, z, r, pred) => { let best = null, bd = r; for (const v of s.villagers) { if (v.inside || v.arriving || (pred && !pred(v))) continue; const d = distXZ(v.x, v.z, x, z); if (d < bd) { bd = d; best = v; } } return best; };
/** Should this demon use its power move now? Starts the telegraph and returns true if so. */
function demonPowers(s, e, def, dt) {
  const P = DEMON_POWERS[e.type];
  if (def.summons) { // Mahasura also calls up a host of demons
    e.sumT = (e.sumT == null ? rand(8, 12) : e.sumT) - dt;
    if (e.sumT <= 0 && s.enemies.length < 45) {
      e.sumT = BOSS_SUMMON.cd;
      floater(s, e.x, def.h + 0.8, e.z, BOSS_SUMMON.name + '!', '#ff7a6b', 'callout');
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2, m = spawnEnemy(s, i === 0 ? 'rakshasa' : 'bhoot', 0); m.x = e.x + Math.cos(a) * 1.8; m.z = e.z + Math.sin(a) * 1.8; m.aggro = true; }
      fx(s, 'ring', { x: e.x, z: e.z, r: 3, c: 0x9a3aff, dur: 0.8 });
      sfx('roar', e.x, e.z);
    }
  }
  if (!P) return false;
  e.powT = (e.powT == null ? rand(4, 9) : e.powT) - dt;
  if (e.powT > 0 || e.atkCd > 0.6) return false;
  let target = null;
  if (P.key === 'roar') { if (enemiesNear(s, e.x, e.z, P.range) >= 2) target = nearestFoe(s, e.x, e.z, P.range); }
  else if (P.key === 'boulder') target = nearestFoe(s, e.x, e.z, P.range, (v) => distXZ(v.x, v.z, e.x, e.z) > 2.5) || null;
  else if (P.key === 'nova') { if (s.villagers.filter((v) => !v.inside && distXZ(v.x, v.z, e.x, e.z) < P.range).length >= 1) target = e; }
  else if (P.key === 'charge') target = nearestFoe(s, e.x, e.z, P.range, (v) => distXZ(v.x, v.z, e.x, e.z) > 2.5);
  else if (P.key === 'grab') target = nearestFoe(s, e.x, e.z, P.range + def.r, (v) => !v.heldBy);
  else if (P.key === 'bleed' || P.key === 'maya') { if (!e.fake && nearestFoe(s, e.x, e.z, P.range)) target = e; }
  if (!target) { e.powT = 1.2; return false; }
  e.powT = P.cd * rand(0.85, 1.15);
  if (P.key === 'grab') return startGrab(s, e, target);
  e.wind = { t: 0, dur: P.wind, target, kind: 'power', key: P.key, tx: target.x, tz: target.z };
  floater(s, e.x, def.h * def.scale + 0.7, e.z, P.name + '!', '#ff7a6b', 'callout');
  fx(s, 'telegraph', { x: e.x, y: def.h * 0.9, z: e.z, c: 0xff3a2a, s: 1.1 * def.scale, dur: P.wind });
  return true;
}
function usePower(s, e, w) {
  const def = ENEMIES[e.type];
  e.atkAnim = 0.4; e.atkCd = Math.max(e.atkCd, 0.6);
  switch (w.key) {
    case 'roar': { // Garjan: demons nearby rage, fighters nearby stagger, villagers flee
      for (const o of s.enemies) if (!o.dead && distXZ(o.x, o.z, e.x, e.z) < 5) o.frenzyT = 6;
      for (const v of s.villagers) {
        if (v.inside || distXZ(v.x, v.z, e.x, e.z) > 3.5) continue;
        if (isDefender(v)) { v.stunT = 0.8; floater(s, v.x, 1.8, v.z, 'Staggered', '#ff9a8a', 'tag'); } else v.scared = true;
      }
      fx(s, 'ring', { x: e.x, z: e.z, r: 5, c: 0xff3a2a, dur: 0.7 }); fx(s, 'ring', { x: e.x, z: e.z, r: 3, c: 0xff8a6a, dur: 0.5 });
      shake(s, 0.15); sfx('roar', e.x, e.z); sfx('v_rakshasa', e.x, e.z);
      break;
    }
    case 'boulder': { // Shila Prahaar: a boulder arcs onto where the target was
      const p = shootArrow(s, e.x, 2.0, e.z, { x: w.tx, y: 0.2, z: w.tz, practice: true }, 22, true, 'rock', 9);
      p.practice = false; p.hostile = true; p.splash = 1.5;
      sfx('whoosh', e.x, e.z);
      break;
    }
    case 'nova': { // Bhoot-agun: blue ghost-fire bursts from the headless neck
      for (const v of s.villagers) if (!v.inside && distXZ(v.x, v.z, e.x, e.z) < 2.6) damageVillager(s, v, 16, e);
      fx(s, 'ring', { x: e.x, z: e.z, r: 2.8, c: 0x6fa8ff, dur: 0.6 }); fx(s, 'impact', { x: e.x, y: 1.6, z: e.z, c: 0x9fd0ff, s: 2.4 });
      emit(s, e.x, 1.4, e.z, 30, { spread: 1.0, vx: 3, vyMin: 0.5, vyMax: 3, life: 0.9, colors: ['#6fa8ff', '#dcecff', '#3a6ad0'], g: -0.5, add: true });
      shake(s, 0.12); sfx('boom', e.x, e.z);
      break;
    }
    case 'charge': { // Mahish Dhakka: he lowers his horns and charges (the tiger's pounce and the boar's rush are shorter charges)
      const d = distXZ(w.tx, w.tz, e.x, e.z) || 1, P = DEMON_POWERS[e.type] || {};
      e.charge = { t: 0, dur: P.dur || 0.75, sp: P.speed || 9, dmg: P.dmg || 26, wreck: P.wreck == null ? 60 : P.wreck, dx: (w.tx - e.x) / d, dz: (w.tz - e.z) / d, hit: new Set() };
      sfx('roar', e.x, e.z); if (def.boss || P.wreck) sfx('stomp', e.x, e.z);
      break;
    }
    case 'bleed': { // Rakta Varsha: Raktabija tears his own skin and his blood rains round him
      const n = e.fireT > 0 ? 1 : 4;
      for (let i = 0; i < n; i++) spawnRakta(s, e, (i / n) * Math.PI * 2 + rand(-0.3, 0.3), 1.6 + rand(0, 0.8));
      if (n === 1) floater(s, e.x, ENEMIES[e.type].h + 0.6, e.z, 'The fire scorches his blood!', '#ffb347', 'tag');
      emit(s, e.x, 1.6, e.z, 26, { spread: 0.8, vx: 3, vyMin: 1, vyMax: 4, life: 0.9, colors: ['#b0101c', '#7a0a14', '#e8303a'], g: 12 });
      fx(s, 'ring', { x: e.x, z: e.z, r: 2.5, c: 0xc0101c, dur: 0.6 });
      sfx('splash', e.x, e.z); sfx('roar', e.x, e.z);
      break;
    }
    case 'maya': { // Maya Jaal: Kalanemi vanishes, and false Kalanemis step out of the smoke
      startMaya(s, e);
      break;
    }
  }
}
/* ---------- the great asuras' own ways ---------- */
/** One of Kalanemi's copies melts into violet smoke. */
function vanishFake(s, e, struck) {
  if (e.dead) return;
  e.dead = true;
  const def = ENEMIES[e.type];
  emit(s, e.x, def.h * 0.5, e.z, 26, { spread: def.r, spreadY: def.h / 3, vx: 1.2, vyMin: 0.3, vyMax: 1.8, life: 1.1, colors: ['#6b4aa8', '#b48cff', '#2a1a4a'], g: -0.8 });
  fx(s, 'ring', { x: e.x, z: e.z, r: 1.4, c: 0xb48cff, dur: 0.5 });
  if (struck) floater(s, e.x, def.h + 0.5, e.z, 'Only maya!', '#cdb4ff', 'tag');
  sfx('ghost_vanish', e.x, e.z);
}
/*
 * Omens. On the day a great asura will come, the land warns of him in three rising stages, each read
 * through the world itself first and the interface second:
 *   1 Sign (early morning): the first strange sign; a quiet line in the message history and an eye on the clock.
 *   2 Warning (midday): the signs are everywhere; the elders name him, the side he will come from, and how to meet him.
 *   3 Imminent (late afternoon until he comes): a banner and the war drums; the minimap marks his side.
 * s.omen.ramp (0..1) is how strongly the renderer changes the world; after he falls (or at dawn) it fades away.
 */
const OMEN_STAGE_T = [0, 3, 62, DUSK_T - 16];
function omenStageAt(t) { const ph = phaseOf(t); if (ph !== 'day') return 3; let st = 0; for (let i = 1; i <= 3; i++) if (t >= OMEN_STAGE_T[i]) st = i; return st; }
/** A new day (or a loaded game): is a great asura coming tonight? */
function updateOmen(s, quiet) {
  const bt = bossForDay(s.day);
  if (s.omen && s.omen.day === s.day && s.omen.type === bt) return;
  if (s.omen && s.omen.ramp > 0.02 && !bt) { s.omen.done = true; return; } // last night's omen is still fading
  s.omen = bt ? { type: bt, day: s.day, a: Math.random() * Math.PI * 2, stage: quiet ? omenStageAt(s.t) : 0, ramp: quiet && phaseOf(s.t) !== 'day' ? 1 : 0, done: false } : null;
}
function tickOmen(s, dt) {
  const o = s.omen;
  if (!o) return;
  if (o.done) { o.ramp -= dt * 0.08; if (o.ramp <= 0) s.omen = null; return; }
  const ph = phaseOf(s.t);
  const want = ph === 'day' ? clamp((s.t - OMEN_STAGE_T[1]) / (DUSK_T - 10 - OMEN_STAGE_T[1]), 0, 1) : 1;
  o.ramp += (want - o.ramp) * Math.min(1, dt * 0.6);
  const st = omenStageAt(s.t);
  if (st > o.stage) { o.stage = st; omenStage(s, o, st); }
  if (o.spawned && !s.enemies.some((e) => e.type === o.type && !e.dead && !e.fake)) o.done = true; // he has fallen
}
function omenStage(s, o, st) {
  if (s.demo) return;
  const B = ENEMIES[o.type], O = OMENS[o.type], d = dirXZ(o.a), side = compassOf(d.x, d.z);
  if (st === 1) { if (typeof UI !== 'undefined' && UI.logPush) UI.logPush(O.sign, 'info'); sfx('bellSoft'); }
  else if (st === 2) toast(`The elders read the omen: ${B.name}, the ${B.en}, will come tonight from the ${side}. ${O.counter}`, 'warn', 12);
  else if (st === 3) { if (typeof UI !== 'undefined' && UI.omenBanner) UI.omenBanner(o); sfx('drum'); }
}
/** A drop of Raktabija's blood rises as a little demon. */
function spawnRakta(s, e, a, r) {
  if (s.enemies.filter((o) => o.type === 'rakta' && !o.dead).length >= 16) return null;
  const m = spawnEnemy(s, 'rakta', 0);
  m.x = e.x + Math.cos(a) * r; m.z = e.z + Math.sin(a) * r; m.aggro = true; m.variant = 2;
  emit(s, m.x, 0.3, m.z, 8, { spread: 0.2, vx: 1.5, vyMin: 0.5, vyMax: 2, life: 0.6, colors: ['#b0101c', '#e8303a'], g: 8 });
  return m;
}
/** Kalanemi turns invisible for a while and leaves three copies that fight like him. */
function startMaya(s, e) {
  e.hidden = 3.5;
  e.wind = null;
  fx(s, 'ring', { x: e.x, z: e.z, r: 2.4, c: 0xb48cff, dur: 0.7 });
  emit(s, e.x, 1.4, e.z, 34, { spread: 0.9, spreadY: 1, vx: 1.2, vyMin: 0.3, vyMax: 1.6, life: 1.3, colors: ['#6b4aa8', '#b48cff', '#2a1a4a'], g: -0.6 });
  sfx('ghost_vanish', e.x, e.z);
  const copies = s.enemies.filter((o) => o.fake && !o.dead).length;
  for (let i = 0; i < Math.max(0, 3 - copies); i++) {
    const a = (i / 3) * Math.PI * 2 + rand(0, 1), f = spawnEnemy(s, e.type, 0);
    f.x = e.x + Math.cos(a) * 1.6; f.z = e.z + Math.sin(a) * 1.6; f.fake = 16; f.hp = f.maxHp = Math.round(e.maxHp * 0.35); f.aggro = true; f.powT = 99;
  }
  // he slips away to one side while everyone watches the copies
  const a = Math.random() * Math.PI * 2;
  e.x += Math.cos(a) * 2.5; e.z += Math.sin(a) * 2.5;
}
/** Bakasura goes for the food: the grain heap by the fire, then any store with grain in it. */
function devourAI(s, e, def, spd, dt) {
  if (e.tv && distXZ(e.tv.x, e.tv.z, e.x, e.z) < 2.2) return false; // a fighter in his face: he fights first
  e.foodT = (e.foodT || 0) - dt;
  if (e.foodT <= 0 || !e.food) {
    e.foodT = 1.5;
    const h = FIRE_HEAP.food;
    let best = (s.fireStock && s.fireStock.food > 0) || !s.buildings.some((b) => b.stock && b.stock.food > 0) ? { x: h.x, z: h.z, b: null } : null, bd = best ? distXZ(h.x, h.z, e.x, e.z) : Infinity;
    for (const b of s.buildings) if (b.done && b.stock && b.stock.food > 0) { const d = distXZ(b.x, b.z, e.x, e.z); if (d < bd) { bd = d; best = { x: b.x, z: b.z, b }; } }
    e.food = s.res.food > 0 ? best : null;
  }
  const f = e.food;
  if (!f) return false;
  const d = distXZ(f.x, f.z, e.x, e.z);
  if (d > 1.7 + def.r) {
    const ux = (f.x - e.x) / d, uz = (f.z - e.z) / d;
    if (f.b == null || distXZ(f.x, f.z, e.x, e.z) > 3) { // walk on (buildings in the way get smashed by the normal code)
      const probe = buildingAtPoint(s, e.x + ux * (def.r + 0.3), e.z + uz * (def.r + 0.3));
      if (probe && probe !== f.b && !isGround(probe.type) && probe.hp > 0) { enemyAttack(s, e, probe, 'building'); return true; }
    }
    e.vx = ux * spd; e.vz = uz * spd; e.x += e.vx * dt; e.z += e.vz * dt; e.rot = Math.atan2(ux, uz);
    return true;
  }
  // he eats: grain vanishes by the fistful, and every mouthful heals him
  e.vx = e.vz = 0; faceTo(e, f.x, f.z);
  e.eatT = (e.eatT || 0) - dt;
  if (e.eatT <= 0) {
    e.eatT = 1.4; e.atkAnim = 0.4;
    const n = Math.floor(Math.min(10, s.res.food));
    if (n > 0) {
      spend(s, { food: n }, f.x, f.z); // taken from the heap or store he is standing at
      e.hp = Math.min(e.maxHp, e.hp + 35);
      floater(s, e.x, def.h + 0.5, e.z, `-${n} grain`, RES.food.color, 'tag');
      emit(s, f.x, 0.6, f.z, 8, { spread: 0.4, vx: 1.2, vyMin: 0.5, vyMax: 2, life: 0.7, colors: ['#e6bd52', '#c29a62'], g: 8 });
      sfx('drop_food', e.x, e.z);
      tip('bakasura', 'Bakasura is eating your grain, and every mouthful heals him! Drive him off the food: send every fighter at him.');
      e.food = null;
    }
  }
  return true;
}
function tickCharge(s, e, dt) {
  const c = e.charge, def = ENEMIES[e.type];
  c.t += dt;
  const sp = c.sp || 9;
  if (pondAt(s, e.x + c.dx * 0.6, e.z + c.dz * 0.6)) { e.charge = null; return; } // pulls up at the water's edge
  e.x += c.dx * sp * dt; e.z += c.dz * sp * dt; e.vx = c.dx * sp; e.vz = c.dz * sp; e.rot = Math.atan2(c.dx, c.dz);
  if (Math.random() < 0.6) emit(s, e.x, 0.1, e.z, 2, { spread: 0.6, vx: 1.2, vyMin: 0.3, vyMax: 1.2, life: 0.6, colors: ['#8a7a66', '#6b5a48'], g: 4 });
  for (const v of s.villagers) {
    if (v.inside || c.hit.has(v.id) || distXZ(v.x, v.z, e.x, e.z) > def.r + 0.6) continue;
    c.hit.add(v.id);
    damageVillager(s, v, c.dmg || 26, e);
    v.x += c.dx * 0.9; v.z += c.dz * 0.9; v.stunT = 0.9;
    shake(s, def.boss ? 0.2 : 0.1);
  }
  const b = buildingAtPoint(s, e.x + c.dx * 0.8, e.z + c.dz * 0.8);
  if (b && b.hp > 0 && !isGround(b.type)) {
    if (!c.wreck) { e.charge = null; return; } // a pounce stops short of a wall
    b.hp -= c.wreck; sfx('crash', b.x, b.z); shake(s, 0.35); if (b.hp <= 0) destroyBuilding(s, b); e.charge = null; e.stunT = 0.6; return;
  }
  if (c.t >= c.dur) e.charge = null;
}
/* Mamdo Bhoot: seizes someone and twists their neck, unless they are freed in time. */
function startGrab(s, e, v) {
  e.grab = { v, t: 0, dur: 1.7, hp0: e.hp };
  v.heldBy = e.id; v.entranced = 0;
  floater(s, e.x, ENEMIES[e.type].h + 0.6, e.z, DEMON_POWERS.mamdo.name + '!', '#ff7a6b', 'callout');
  fx(s, 'telegraph', { x: v.x, y: 1.5, z: v.z, c: 0xff3a2a, s: 0.9, dur: 1.7 });
  toast(`A Mamdo Bhoot has seized ${v.name}! Strike it hard to break its grip.`, 'danger', 4);
  sfx('v_mamdo', e.x, e.z);
  return true;
}
function tickGrab(s, e, dt) {
  const g = e.grab, v = g.v;
  if (!s.villagers.includes(v)) { e.grab = null; return; }
  g.t += dt; e.vx = e.vz = 0;
  faceTo(e, v.x, v.z);
  // pull the victim close
  const d = distXZ(v.x, v.z, e.x, e.z) || 1;
  if (d > 0.7) { v.x += ((e.x - v.x) / d) * Math.min(d - 0.7, 2 * dt); v.z += ((e.z - v.z) / d) * Math.min(d - 0.7, 2 * dt); }
  if (g.hp0 - e.hp >= 20) return releaseGrab(s, e, true); // struck hard enough: it lets go
  if (g.t >= g.dur) {
    e.grab = null; v.heldBy = null; e.atkAnim = 0.4; e.atkCd = 2;
    sfx('crash', v.x, v.z);
    fx(s, 'impact', { x: v.x, y: 1.3, z: v.z, c: 0xff3a2a, s: 1.2 });
    if (isDefender(v)) { damageVillager(s, v, v.maxHp * 0.55, e); floater(s, v.x, 2, v.z, 'Neck wrenched!', '#ff7a6b', 'tag'); }
    else { toast(`A Mamdo Bhoot twisted ${v.name}'s neck.`, 'danger', 6); damageVillager(s, v, v.hp + 1, e); }
  }
}
function releaseGrab(s, e, forced) {
  const v = e.grab && e.grab.v;
  e.grab = null;
  if (!v) return;
  v.heldBy = null;
  if (forced && s.villagers.includes(v)) { floater(s, v.x, 1.9, v.z, 'Broke free!', '#9fd0ff', 'tag'); fx(s, 'impact', { x: v.x, y: 1.2, z: v.z, c: 0xbfe2ff, s: 1 }); }
}
/** The blow lands (if the target is still in reach). */
function enemyStrike(s, e, target, kind) {
  const def = ENEMIES[e.type];
  e.atkCd = Math.max(0.2, def.atkCd - windOf(def)); // the wind-up counts toward the cooldown: same hits per minute as before
  e.atkAnim = 0.4;
  if (kind === 'villager' && (!target || !s.villagers.includes(target) || target.inside || distXZ(target.x, target.z, e.x, e.z) > def.reach + def.r * 0.5 + 0.7)) { sfx('whoosh', e.x, e.z); return; } // it dodged
  const ES = ENEMY_SFX[e.type];
  if (ES && ES.attack) sfx(ES.attack, e.x, e.z);
  const dmg = def.dmg * (s.festival ? 0.75 : 1) * (e.frenzyT > 0 ? 1.3 : 1) * (def.boss ? 1 : 1 + Math.max(0, s.day - 20) * 0.025 * nightMight(s.day)); // a roar's rage hits harder; endless nights hit harder too
  if (e.frenzyT > 0) e.atkCd *= 0.75;
  if (def.boss || e.type === 'danav') { // giants pound the ground: everyone close by is caught in it
    e.pounds = (e.pounds || 0) + 1;
    if (def.boss ? e.pounds % 3 === 0 : true) {
      const R = def.boss ? 2.4 : 1.2;
      for (const o of s.villagers) if (o !== target && !o.inside && distXZ(o.x, o.z, e.x, e.z) < R) damageVillager(s, o, dmg * (def.boss ? 0.6 : 0.35), e);
      fx(s, 'ring', { x: e.x, z: e.z, r: R + 0.3, c: 0xff5a3a, dur: 0.5 });
      emit(s, e.x, 0.1, e.z, def.boss ? 24 : 10, { spread: R * 0.5, vx: 2.4, vyMin: 0.5, vyMax: 2, life: 0.8, colors: ['#6b5a48', '#8a7a66', '#3d2552'], g: 5 });
      shake(s, def.boss ? 0.45 : 0.12);
      sfx('stomp', e.x, e.z);
    }
  }
  if (kind === 'villager') {
    damageVillager(s, target, dmg, e);
    if (def.venom && s.villagers.includes(target)) { // the cobra's bite: poison works on for a few seconds
      if (!(target.poisonT > 0)) floater(s, target.x, 1.9, target.z, 'Poisoned!', '#8aff8a', 'tag');
      target.poisonT = def.venom.dur; target.poisonDps = def.venom.dps;
    }
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
      sfx('v_mechho', e.x, e.z); sfx('splash', e.x, e.z);
      toast(`A Mechho Bhoot stole ${n} grain! Catch him before he reaches the forest.`, 'danger', 5);
    }
    e.prey = null;
    return true;
  }
  e.vx = ((p.x - e.x) / d) * spd; e.vz = ((p.z - e.z) / d) * spd;
  e.x += e.vx * dt; e.z += e.vz * dt; e.rot = Math.atan2(e.vx, e.vz);
  return true;
}
/*
 * Nishi Dak: she calls a villager by name in the voice of someone they love. Whoever answers her first or
 * second call walks out to her, and if they reach her she takes their soul. Folk wisdom says to answer only
 * a third call, so nobody answers her a third time. The player can hold a called villager back.
 */
function nishiCall(s, e, dt, df) {
  e.callT = (e.callT == null ? rand(3, 5) : e.callT) - dt;
  if (e.callT > 0 || df > territory(s) + 8) return;
  e.callT = rand(8, 11);
  let best = null, bd = 18;
  for (const v of s.villagers) {
    if (isDefender(v) || v.entranced > 0 || v.arriving || (v.nishiCalls || 0) >= 2) continue;
    const d = distXZ(v.x, v.z, e.x, e.z) - (v.inside ? 4 : 0); // she prefers those hiding indoors
    if (d < bd) { bd = d; best = v; }
  }
  if (!best) return;
  best.nishiCalls = (best.nishiCalls || 0) + 1;
  best.entranced = 9; best.callBy = e.id;
  e.atkAnim = 0.4;
  floater(s, best.x, 1.95, best.z, `“${best.name}…”`, '#cfe0ff', 'callout');
  fx(s, 'ring', { x: best.x, z: best.z, r: 1.0, c: 0x9fb4ff, dur: 0.8 });
  sfx('nishi', e.x, e.z); sfx('v_nishi', e.x, e.z);
  toast(`Nishi Dak calls ${best.name} in a loved one's voice (call ${best.nishiCalls} of 2) — click ${best.name} and hold them back before they reach her!`, 'danger', 6);
}
function breakNishiSpell(s, v, why) {
  v.entranced = 0; v.callBy = null;
  floater(s, v.x, 1.9, v.z, 'Did not answer', '#cfe0ff', 'tag');
  if (why) toast(`${v.name} snaps out of it: ${why}.`, 'good', 4);
}
/** The one who answered reaches her: Nishi Dak takes their soul and grows stronger. */
function consumeSoul(s, v, n) {
  emit(s, v.x, 1.0, v.z, 24, { spread: 0.25, vx: 0.4, vyMin: 0.8, vyMax: 2.2, life: 1.6, colors: ['#cfe0ff', '#9fb4ff', '#ffffff'], g: -0.8, add: true });
  fx(s, 'death', { x: v.x, y: 1.0, z: v.z, c: 0x9fb4ff, s: 1.2 });
  n.hp = Math.min(n.maxHp * 1.5, n.hp + 40); n.maxHp = Math.max(n.maxHp, n.hp);
  toast(`Nishi Dak has taken ${v.name}'s soul.`, 'danger', 7);
  v.hp = 0;
  killVillager(s, v);
}
/** Growls, moans and footsteps while a demon roams (each sound is rate-limited in Sound.play). */
function enemySounds(s, e, dt) {
  const ES = ENEMY_SFX[e.type];
  if (!ES || e.burning) return;
  e.voiceT = (e.voiceT || 0) - dt;
  if (e.voiceT <= 0) { e.voiceT = rand(5, 11); sfx(ES.voice, e.x, e.z); }
  const sp = Math.hypot(e.vx || 0, e.vz || 0);
  if ((ES.stomp || ES.step) && sp > 0.1) {
    e.stepT = (e.stepT || 0) + sp * dt;
    if (e.stepT > (ES.stomp ? 1.1 : 1.6)) { e.stepT = 0; sfx(ES.stomp ? 'stomp' : ES.step, e.x, e.z); }
  }
}
function updateEnemy(s, e, dt) {
  const def = ENEMIES[e.type];
  e.animT += dt;
  enemySounds(s, e, dt);
  if (e.atkCd > 0) e.atkCd -= dt;
  if (e.hurtT > 0) e.hurtT -= dt;
  if (e.flashT > 0) e.flashT -= dt;
  if (e.atkAnim > 0) e.atkAnim -= dt;
  if (e.kx || e.kz) { // knockback slides and slows
    e.x += e.kx * dt; e.z += e.kz * dt;
    const f = Math.exp(-7 * dt); e.kx *= f; e.kz *= f;
    if (Math.abs(e.kx) + Math.abs(e.kz) < 0.04) e.kx = e.kz = 0;
  }
  if (e.fake) { // Kalanemi's copies fade when their maker falls or their time runs out
    e.fake -= dt;
    if (e.fake <= 0 || !s.enemies.some((o) => o.type === e.type && !o.fake && !o.dead)) return vanishFake(s, e, false);
  }
  if (e.hidden > 0) {
    e.hidden -= dt;
    if (e.hidden <= 0) { fx(s, 'ring', { x: e.x, z: e.z, r: 1.8, c: 0xb48cff, dur: 0.5 }); emit(s, e.x, 1.4, e.z, 16, { spread: 0.6, spreadY: 1, vx: 1, vyMin: 0.2, vyMax: 1.2, life: 0.9, colors: ['#6b4aa8', '#b48cff'], g: -0.6 }); }
  }
  const ph = phaseOf(s.t);
  if (ph === 'day' || ph === 'dawn') e.burning = true;
  if (e.burning) {
    e.hp -= (def.boss ? 70 : 28) * dt;
    if (Math.random() < 0.6) emitFire(s, e.x + rand(-def.r, def.r), e.y + rand(0, def.h), e.z + rand(-def.r, def.r));
  }
  let slow = 1;
  e.vuln = 1;
  if (e.slowT > 0) { e.slowT -= dt; slow = 0.55; } // tangled in the urumi's coils
  for (const b of s.buildings) {
    if (!b.done || b.hp <= 0) continue;
    if (b.type === 'lamp' && distXZ(b.x, b.z, e.x, e.z) < 4.5 + (bLevel(b) - 1)) { slow = Math.min(slow, 0.6); e.hp -= 2.5 * bLevel(b) * dt; }
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
  if (e.frenzyT > 0) e.frenzyT -= dt;
  if (e.stunT > 0) { e.stunT -= dt; e.wind = null; e.charge = null; if (e.grab) releaseGrab(s, e, true); e.vx = e.vz = 0; return; } // seeing stars
  if (e.burning) { e.wind = null; e.charge = null; if (e.grab) releaseGrab(s, e, false); }
  if (e.grab) return tickGrab(s, e, dt);
  if (e.charge) return tickCharge(s, e, dt);
  if (e.wind) { // winding up a blow (or a power move)
    const w = e.wind;
    w.t += dt; e.vx = e.vz = 0;
    if (w.target && (w.kind === 'villager' || w.kind === 'power') && w.target.x != null) faceTo(e, w.target.x, w.target.z);
    if (w.t >= w.dur) { e.wind = null; if (w.kind === 'power') usePower(s, e, w); else enemyStrike(s, e, w.target, w.kind); }
    return;
  }
  if (!e.burning && demonPowers(s, e, def, dt)) return;
  const spd = def.speed * slow * (e.frenzyT > 0 ? 1.35 : 1);
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
        if (bdef.wall || isGround(b.type) || b.hp <= 0) continue;
        const d = distToBuilding(b, e.x, e.z);
        if (d < bd) { bd = d; best = b; }
      }
      e.tb = best;
    }
  }
  if (e.tv && (e.tv.inside || !s.villagers.includes(e.tv))) e.tv = null;
  if (e.tb && !s.bById.has(e.tb.id)) e.tb = null;
  if (def.devour && !e.burning && devourAI(s, e, def, spd, dt)) return; // Bakasura heads for the grain
  if (e.tv && distXZ(e.tv.x, e.tv.z, e.x, e.z) <= def.reach + def.r * 0.5 + 0.2) return enemyAttack(s, e, e.tv, 'villager');
  if (!e.tv && df <= 1.6 + def.r + s.fire.level * 0.08) return enemyAttack(s, e, null, 'fire');
  if (e.tb && distToBuilding(e.tb, e.x, e.z) <= def.reach) return enemyAttack(s, e, e.tb, 'building');
  let tx = 0, tz = 0;
  if (e.tv) { tx = e.tv.x; tz = e.tv.z; } else if (e.tb) { tx = e.tb.x; tz = e.tb.z; }
  const d = distXZ(tx, tz, e.x, e.z) || 1;
  let dx = (tx - e.x) / d, dz = (tz - e.z) / d;
  if (!def.ghost) {
    const probe = buildingAtPoint(s, e.x + dx * (def.r + 0.3), e.z + dz * (def.r + 0.3));
    if (probe && !isGround(probe.type) && probe.hp > 0 && probe !== e.tb) return enemyAttack(s, e, probe, 'building');
  }
  // keep apart from other demons
  for (const o of s.enemies) {
    if (o === e || o.dead || ENEMIES[o.type].fly) continue;
    const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), min = (def.r + ENEMIES[o.type].r) * 0.85;
    if (od > 0.001 && od < min) { dx += (ox / od) * 0.6; dz += (oz / od) * 0.6; }
  }
  let dl = Math.hypot(dx, dz) || 1;
  if (s.buildings.length) { // a building in the way: demons batter it down, ghosts glide round it (and drift over walls)
    const nav = navGrid(s), look = def.r + 0.25;
    const blockedDir = (ux, uz) => navBlock(nav, e.x + ux * look, e.z + uz * look, 0, e.tb ? e.tb.id : 0);
    let ux = dx / dl, uz = dz / dl;
    const hit = blockedDir(ux, uz);
    if (hit > 0 && !def.ghost) { const hb = s.bById.get(hit); if (hb && hb.hp > 0) return enemyAttack(s, e, hb, 'building'); }
    if (hit && (def.ghost || hit < 0)) { // (and everyone goes round a pond: -1 in the nav grid)
      const sg = e.slide || (e.slide = Math.random() < 0.5 ? 1 : -1);
      let ok = false;
      for (const turn of [0.6, 1.1, 1.57, 2.1]) for (const k of [sg, -sg]) {
        const a = turn * k, c = Math.cos(a), sn = Math.sin(a), rx = ux * c - uz * sn, rz = ux * sn + uz * c;
        if (!ok && !blockedDir(rx, rz)) { ux = rx; uz = rz; ok = true; e.slide = k; }
      }
      if (!ok) { ux = -ux; uz = -uz; }
    } else if (!hit) e.slide = 0;
    dx = ux; dz = uz; dl = 1;
  }
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
      const afraid = s.omen && !s.omen.done && s.omen.stage >= 2; // the cattle feel it coming and huddle by the fire
      a.sit = ph !== 'day' || (afraid && distXZ(a.x, a.z, a.hx || 0, a.hz || 0) < 0.4);
      if (afraid && !a.sit && a.hx == null) { const ang = Math.atan2(a.z, a.x) + 0.3, p = freeSpot(s, { x: Math.cos(ang) * 3.6, z: Math.sin(ang) * 3.6 }); a.hx = p.x; a.hz = p.z; }
      if (!afraid) a.hx = a.hz = null;
      if (afraid && !a.sit) { a.walk = !moveTo(a, a.hx, a.hz, 0.7, dt); continue; }
      if (a.sit) { a.walk = false; continue; }
      if (a.t <= 0) {
        const ang = Math.random() * Math.PI * 2, r = rand(4.5, R - 1.5);
        const p = freeSpot(s, { x: Math.cos(ang) * r, z: Math.sin(ang) * r });
        a.tx = p.x; a.tz = p.z; a.t = rand(6, 14);
      }
      a.walk = !moveTo(a, a.tx, a.tz, 0.45, dt);
      a.mooT = (a.mooT == null ? rand(8, 20) : a.mooT) - dt;
      if (a.mooT <= 0) { a.mooT = rand(18, 40); sfx('moo', a.x, a.z); }
      const ar = Math.hypot(a.x, a.z);
      if (ar < 3.2) { a.x *= 3.2 / (ar || 1); a.z *= 3.2 / (ar || 1); }
    } else if (a.kind === 'peacock') {
      if (ph !== 'day' || (s.omen && !s.omen.done && s.omen.stage >= 2)) { a.hidden = true; continue; } // peafowl hide from what is coming
      if (a.hidden) { a.hidden = false; const ang = Math.random() * Math.PI * 2; a.x = Math.cos(ang) * (R + 3); a.z = Math.sin(ang) * (R + 3); a.tx = a.x; a.tz = a.z; }
      if (a.fan > 0) { a.fan -= dt; a.walk = false; continue; }
      if (a.t <= 0) {
        if (Math.random() < 0.3) { a.fan = rand(3, 5); a.t = 0; sfx('peacock', a.x, a.z); continue; }
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
  for (const v of s.villagers) v.nishiCalls = 0; // a new night, and Nishi Dak may call anyone again
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
  if (s.omen) s.omen.done = true; // the night is over: the land slowly settles
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
  const moon = moonOf(s.day), lastMoon = moonOf(s.day - 1);
  if (lastMoon === 'red') { s.stats.redMoons = (s.stats.redMoons || 0) + 1; toast(`The Rakt Chandra has set and the Agnikund still burns! ${s.stats.redMoons > 1 ? `That is ${s.stats.redMoons} red moons your village has outlasted.` : 'Bards will sing of this night.'} The next rises on day ${nextMoonNight(s.day, 'red')}.`, 'good', 9); }
  s.festival = moon === 'new'; // Deepavali falls on Amavasya, the new moon
  if (s.festival) toast('Amavasya: Deepavali! Diyas light every home. Tonight demons are weaker and villagers stronger.', 'good', 8);
  if (moon === 'full') toast('Purnima: the moon rises full tonight, and a great asura comes with it. Watch the land for his omens.', 'danger', 9);
  if (moon === 'red') toast('Rakt Chandra: tonight the moon rises red as blood, and Mahasura, the Demon King, leads a great host. Ready every fighter.', 'danger', 10);
  if (s.day > 2 && Math.random() < 0.14) {
    s.res.gold += 8;
    s.fire.hp = Math.min(fireLv(s).hp, s.fire.hp + 60);
    toast('A wandering sadhu blessed the Agnikund. +8 gold, and the flame is renewed.', 'good', 7);
  }
  s.fronts = [];
  arrivals(s);
  s.stats.bestDay = Math.max(s.stats.bestDay || 0, s.day); // endless: there is no last night, only how long the flame lasts
  if (s.day === 2) tip('day2', 'Build an Akhara to train Sainik (warriors). Drag Bamboo Walls (Baad) around the edge of your land to hold demons back.');
  if (s.day === 4) tip('day4', 'Vetala — flying spirits — fly over walls. Dhanurdhar (archers) can shoot them down.');
  updateOmen(s);
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
  if (s.day === 1 && s.t > 4) tip('jobs', 'Every job needs a workplace. Press + next to Mistri (2 builders work from the Agnikund), then press Build at the bottom and place a Lakdi Taal (woodcutter camp) near the trees for your Lakadhara.');
  if (s.day === 1 && s.t > 40 && !s.buildings.some((b) => isFieldType(b.type))) tip('field', 'Press Build at the bottom and choose a Khet (Field), then assign Kisan (farmers). Each villager eats 4 grain every evening.');
  if (s.buildings.some((b) => !b.done) && !canBuildNow(s) && s.t > 3) tip('needBuilder', 'Construction sites need a builder. Assign a Mistri in the Kaam panel, or leave someone idle: idle villagers build too.');
  if (s.fire.level < 5 && canAfford(s, FIRE_LEVELS[s.fire.level + 1].cost)) tip('fireUp' + s.fire.level, 'You can upgrade the Agnikund! Click the fire to grow your land and unlock new buildings.');
  if (s.villagers.length >= housing(s) && s.day >= 2 && ph === 'day') tip('housing', 'Your village is full. Build a Jhopdi (hut) so travellers can settle here.');
  // the materials chain, one step at a time
  const has = (t) => s.buildings.some((b) => b.type === t);
  if (s.fire.level === 1 && (s.day >= 2 || s.res.wood >= 60) && !has('kiln')) tip('bricks', 'The Agnikund needs bricks to grow. Build a Mitti Khaan (clay pit) and an Eent Bhatta (brick kiln), then assign Beldar and Kumhar. Bricks also pay for level 2 building upgrades.');
  if (has('kiln') && !has('claypit')) tip('clay', 'The Eent Bhatta fires clay. Build a Mitti Khaan and assign Beldar to dig it.');
  if (s.fire.level >= 2) tip('iron', 'Level 3 needs iron. Click a Khadaan and set it to dig iron ore from the rusty boulders, build a Loha Bhatti (smelter), and let the Eent Bhatta burn some charcoal. Iron also pays for level 3 upgrades, steel weapons and tools.');
}
function updateParticles(s, dt) {
  for (const p of s.particles) {
    p.life -= dt;
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.02 && p.g > 0) { p.y = 0.02; p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
  }
  s.particles = s.particles.filter((p) => p.life > 0);
  for (const f of s.floaters) { f.life -= dt; f.y += (f.cls && !f.cls.startsWith('callout') ? 0.5 + 2.2 * (f.life / f.max) : 0.8) * dt; f.x += f.vx * dt; }
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
    updateOmen(S);
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
        v: 2, mapScale: MAP_SCALE, seed: s.seed, day: s.day, t: s.t, res: s.res,
        fire: { level: s.fire.level, hp: s.fire.hp, fuel: s.fire.fuel },
        upgrades: s.upgrades, stats: s.stats, weather: s.weather, festival: s.festival, hungry: s.hungry, won: s.won,
        tips: s.tips, nextId: s.nextId, spawnQueue: s.spawnQueue, fronts: s.fronts, grove: s.grove,
        ponds: s.ponds,
        villagers: s.villagers.map((v) => ({ id: v.id, name: v.name, look: v.look, x: r2(v.x), z: r2(v.z), job: v.job, hp: v.hp, maxHp: v.maxHp, armour: v.armour || null, carry: v.carry, carryAmt: v.carryAmt, gold: v.gold, workplace: v.workplace, arriving: v.arriving, ax: v.ax, az: v.az, home: v.home, inside: v.inside, shelter: v.shelter, fearT: v.fearT })),
        buildings: s.buildings.map((b) => ({ id: b.id, type: b.type, cx: b.cx, cz: b.cz, rot: b.rot, done: b.done, progress: b.progress, hp: b.hp, maxHp: b.maxHp, grow: b.grow, level: b.level, upgrading: b.upgrading, upProg: b.upProg, stock: b.stock, bays: b.bays, hopper: b.hopper, recipe: b.recipe, batch: b.batch, mine: b.mine })),
        fireStock: s.fireStock,
        armory: s.armory,
        trees: s.trees.map((t) => [t.id, r2(t.x), r2(t.z), t.type, t.variant, t.wood, t.maxWood, t.stump ? 1 : 0, t.regrow, r2(t.rot), r2(t.scale), t.sacred ? 1 : 0]),
        rocks: s.rocks.map((r) => [r.id, r2(r.x), r2(r.z), r.variant, r.stone, r.maxStone, r2(r.rot), r2(r.scale), r.ore ? 1 : 0]),
        enemies: s.enemies.filter((e) => !e.dead && !e.fake).map((e) => ({ id: e.id, type: e.type, x: e.x, z: e.z, y: e.y, hp: e.hp, maxHp: e.maxHp, variant: e.variant, aggro: e.aggro, loot: e.loot || 0 })),
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
    // the Akhara and Dhanush Shala grew a tile: in older saves, slide one aside if it now overlaps a neighbour
    const rect = (b, cx, cz) => { const d = BUILDINGS[b.type]; return [cx, cz, cx + d.fw, cz + d.fd]; };
    const hits = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
    for (const b of s.buildings) {
      if (b.type !== 'akhara' && b.type !== 'range') continue;
      const clear = (cx, cz) => s.buildings.every((o) => o === b || !hits(rect(b, cx, cz), rect(o, o.cx, o.cz)));
      if (clear(b.cx, b.cz)) continue;
      for (const [dx, dz] of [[-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [-1, 1], [1, -1]]) {
        if (clear(b.cx + dx, b.cz + dz)) { b.cx += dx; b.cz += dz; Object.assign(b, bCenterOf(b.type, b.cx, b.cz)); break; }
      }
    }
    s.trees = data.trees.map((a) => ({ id: a[0], x: a[1], z: a[2], type: a[3], variant: a[4], wood: a[5], maxWood: a[6], stump: !!a[7], regrow: a[8], rot: a[9], scale: a[10], sacred: !!a[11], shake: 0 }));
    s.rocks = data.rocks.map((a) => ({ id: a[0], x: a[1], z: a[2], variant: a[3], stone: a[4], maxStone: a[5], rot: a[6], scale: a[7], ore: !!a[8] }));
    if (data.rocks.length && data.rocks[0].length < 9) { // a save from before iron: turn some outer boulders into ore
      for (const r of s.rocks) if (Math.hypot(r.x, r.z) > 11 && hash(r.id * 13 + 7) < 0.3) r.ore = true;
      if (!s.rocks.some((r) => r.ore)) for (const r of s.rocks.slice(0, 3)) r.ore = true;
    }
    for (const r of RES_ORDER) s.res[r] = s.res[r] || 0; // older saves have no materials yet
    if (!data.mapScale) plantForest(s, mulberry32((s.seed ^ 0x5eed) >>> 0), 1); // the island grew: new forest on the new land
    s.enemies = (data.enemies || []).map((d) => Object.assign({ vx: 0, vz: 0, rot: 0, atkCd: 1, animT: 0, hurtT: 0, atkAnim: 0, burning: false, dead: false, diveT: 0, bob: rand(0, 6), thinkT: 0, tv: null, tb: null }, d));
    s.ambient = (data.ambient || []).map((a) => ({ kind: a.kind, x: a.x, z: a.z, tx: a.x, tz: a.z, rot: 0, t: 0, fan: 0, sit: false }));
    s.loot = data.loot || [];
    s.armory = data.armory || {};
    if (s.armory.dhanush) { s.res.wood = (s.res.wood || 0) + 14 * s.armory.dhanush; delete s.armory.dhanush; } // archers need no crafted bow any more: old bows go back as wood
    s.fireStock = data.fireStock || {};
    rebuildGrid(s);
    if (data.ponds) s.ponds = data.ponds;
    else genPonds(s, mulberry32((s.seed ^ 0x90d5) >>> 0)); // older saves: ponds appear where there is open land
    if (s.upgrades.kavach) { // the old blanket Kavach upgrade becomes a suit of steel plate for every soldier
      delete s.upgrades.kavach;
      s.armory.kavach = (s.armory.kavach || 0) + s.villagers.filter((v) => slotKey(v.job) === 'army').length;
      fitArmour(s, true);
    }
    syncStock(s); // older saves: everything starts on the Agnikund heap
    S = s;
    fixJobOverflow(s); // older saves: jobs now need their workplace buildings
    updateOmen(s, true);
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
    tickOmen(s, dt);
    while (s.spawnQueue.length && s.spawnQueue[0].at <= s.t && ph === 'night') {
      const q = s.spawnQueue.shift();
      const f = s.fronts[q.front] || { a: Math.random() * Math.PI * 2 };
      spawnEnemy(s, q.type, f.a);
      if (s.omen && q.type === s.omen.type) s.omen.spawned = true;
      if (ENEMIES[q.type].boss) { const d = dirXZ(f.a), B = ENEMIES[q.type]; toast(`${B.name.toUpperCase()}, ${B.en}, rises in the ${compassOf(d.x, d.z)}!`, 'danger', 8); sfx('roar'); }
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
    for (const v of s.villagers) if (!isDefender(v)) v.seat = freeSpot(s, seatPos(ci++, civ)); // never a seat inside a hut
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
      const lvB = 1 + 0.25 * (bLevel(b) - 1); // upgraded towers hit harder and reach further
      const t = nearestEnemy(s, b.x, b.z, T.range + (bLevel(b) - 1), false);
      if (!t) continue;
      if (T.kind === 'arrow') { shootArrow(s, b.x, T.y, b.z, t, T.dmg * lvB * (s.upgrades.bow ? 1.5 : 1), false); sfx('bow', b.x, b.z); }
      else {
        const p = shootArrow(s, b.x, T.y, b.z, t, T.dmg * lvB, false, T.kind, T.kind === 'ball' ? 12 : 8);
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
