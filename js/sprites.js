'use strict';
/* =========================================================
   Pixel-art sprite maps (hand-authored) + compositor
   '.' = transparent; letters map to palette entries.
   ========================================================= */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Paint a string map into ctx at (ox, oy) using palette. */
function paintMap(ctx, rows, pal, ox, oy, scale) {
  scale = scale || 1;
  for (let y = 0; y < rows.length; y++) {
    const r = rows[y];
    for (let x = 0; x < r.length; x++) {
      const ch = r[x];
      if (ch === '.' || ch === ' ') continue;
      const col = pal[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect((ox + x) * scale, (oy + y) * scale, scale, scale);
    }
  }
}
/** Paint a list of [x, y, key] pixels. */
function paintPix(ctx, list, pal, ox, oy) {
  for (const p of list) {
    const col = pal[p[2]];
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.fillRect(ox + p[0], oy + p[1], 1, 1);
  }
}
function compileMap(rows, pal, scale) {
  scale = scale || 1;
  const c = makeCanvas(rows[0].length * scale, rows.length * scale);
  paintMap(c.getContext('2d'), rows, pal, 0, 0, scale);
  return c;
}

/* ---------------- Villagers ---------------- */
const VB_W = 26, VB_H = 26, VB_OX = 6, VB_OY = 8, VB_AX = 12; // canvas size, local origin, anchor x

const MALE_UP = [
  '....HHHH....',
  '...HHHHHH...',
  '..HHGGGGGH..',
  '..hhSSSSSS..',
  '...hSSSSeS..',
  '...SSSSSSS..',
  '....SSmmS...',
  '.....SSS....',
  '...CCCCCCC..',
  '..sCCCCCCC..',
  '..sCCCcCCC..',
  '..sCCCcCCC..',
  '..sCCCcCCC..',
  '...ccccccc..',
];
const MALE_LEGS = [
  '...DDDDDDD..',
  '...DDDdDDD..',
  '....SS..SS..',
  '...BBB.BBB..',
];
const MALE_LEGS_WALK = [
  '...DDDDDDD..',
  '..DDDdDDDDD.',
  '..SS....SS..',
  '.BBB....BBB.',
];
const FEMALE_UP = [
  '............',
  '....hhhhh...',
  '...hhhhhhh..',
  '..hhSSSbSS..',
  '..hhSSSSeS..',
  '.hhhSSSSSS..',
  '.hh..SSSS...',
  '.....SSS....',
  '...DDCCCCC..',
  '..sDDDCCCC..',
  '..sDDDDCCC..',
  '..s.DDDSSS..',
  '...DDDDDDD..',
  '...DDDDDDD..',
];
const FEMALE_LEGS = [
  '...DDDDDDD..',
  '..DDDDDDDDD.',
  '..ddddddddd.',
  '...SY..SY...',
];
const FEMALE_LEGS_WALK = [
  '..DDDDDDDD..',
  '..DDDDDDDDD.',
  '.dddddddddd.',
  '..SY....SY..',
];
const SIT_LEGS = [
  '..DDDDDDDD..',
  '.DDDDDDDDDD.',
  '.SDDDDDDDDS.',
];

// Front arm per pose (local coords)
const ARMS = {
  down: [[10, 9, 'C'], [10, 10, 'S'], [10, 11, 'S'], [10, 12, 'S']],
  up:   [[10, 9, 'C'], [10, 8, 'S'], [11, 7, 'S'], [11, 6, 'S']],
  fwd:  [[10, 9, 'C'], [11, 9, 'S'], [12, 9, 'S']],
};

function line(x0, y0, x1, y1, k) { // tiny helper for tool pixel lists
  const out = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    out.push([Math.round(lerp(x0, x1, n ? i / n : 0)), Math.round(lerp(y0, y1, n ? i / n : 0)), k]);
  }
  return out;
}

const TOOLS = {
  axe: {
    down: [...line(11, 8, 11, 13, 'w'), [12, 8, 'M'], [12, 9, 'M'], [13, 8, 'L'], [13, 9, 'M']],
    up:   [...line(11, 0, 11, 5, 'w'), [12, 0, 'M'], [12, 1, 'M'], [13, 0, 'L'], [13, 1, 'M']],
    fwd:  [...line(13, 9, 15, 9, 'w'), [16, 8, 'M'], [16, 9, 'M'], [16, 10, 'M'], [17, 9, 'L'], [17, 10, 'L'], [16, 11, 'M']],
  },
  pick: {
    down: [...line(11, 7, 11, 13, 'w'), [9, 7, 'N'], [10, 6, 'M'], [11, 6, 'M'], [12, 6, 'M'], [13, 7, 'N']],
    up:   [...line(11, 1, 11, 5, 'w'), [9, 1, 'N'], [10, 0, 'M'], [11, 0, 'M'], [12, 0, 'M'], [13, 1, 'N']],
    fwd:  [...line(13, 9, 15, 9, 'w'), [17, 6, 'N'], ...line(16, 7, 16, 11, 'M'), [17, 12, 'N']],
  },
  hammer: {
    down: [...line(11, 9, 11, 13, 'w'), [10, 7, 'N'], [11, 7, 'N'], [12, 7, 'N'], [10, 8, 'N'], [11, 8, 'M'], [12, 8, 'N']],
    up:   [...line(11, 2, 11, 5, 'w'), [10, 0, 'N'], [11, 0, 'N'], [12, 0, 'N'], [10, 1, 'N'], [11, 1, 'M'], [12, 1, 'N']],
    fwd:  [...line(13, 9, 14, 9, 'w'), [15, 8, 'N'], [16, 8, 'N'], [15, 9, 'M'], [16, 9, 'N'], [15, 10, 'N'], [16, 10, 'N']],
  },
  sickle: {
    down: [[11, 12, 'w'], [11, 13, 'w'], [11, 11, 'M'], [12, 10, 'M'], [12, 9, 'M'], [11, 8, 'L']],
    up:   [[11, 4, 'w'], [11, 5, 'w'], [11, 3, 'M'], [12, 2, 'M'], [12, 1, 'M'], [11, 0, 'L']],
    fwd:  [[13, 9, 'w'], [14, 9, 'w'], [15, 9, 'M'], [16, 10, 'M'], [16, 11, 'M'], [15, 12, 'L']],
  },
  sword: {
    down: [[11, 12, 'Y'], [11, 11, 'Y'], [12, 11, 'Y'], ...line(11, 7, 11, 10, 'L'), [12, 6, 'L'], [12, 5, 'L']],
    up:   [[11, 5, 'Y'], [12, 5, 'Y'], [11, 4, 'L'], [10, 3, 'L'], [10, 2, 'L'], [9, 1, 'L'], [9, 0, 'L']],
    fwd:  [[13, 9, 'Y'], [13, 8, 'Y'], [13, 10, 'Y'], ...line(14, 9, 17, 9, 'L'), [18, 8, 'L'], [19, 7, 'L']],
  },
  bow: {
    down: [[11, 5, 'w'], ...line(12, 6, 12, 13, 'w'), [11, 14, 'w'], ...line(11, 6, 11, 13, 'W')],
    up:   [[11, 5, 'w'], ...line(12, 6, 12, 13, 'w'), [11, 14, 'w'], ...line(11, 6, 11, 13, 'W')],
    fwd:  [[13, 4, 'w'], ...line(14, 5, 14, 13, 'w'), [13, 14, 'w'], ...line(13, 5, 13, 13, 'W'),
           ...line(9, 9, 15, 9, 'w'), [16, 9, 'M'], [9, 8, 'r'], [9, 10, 'r']],
  },
  thali: {
    down: [[11, 12, 'Y'], [12, 12, 'Y'], [13, 12, 'Y'], [12, 11, 'o'], [12, 10, 'y']],
    up:   [[11, 6, 'Y'], [12, 6, 'Y'], [13, 6, 'Y'], [12, 5, 'o'], [12, 4, 'y']],
    fwd:  [[12, 10, 'Y'], [13, 10, 'Y'], [14, 10, 'Y'], [13, 9, 'o'], [13, 8, 'y']],
  },
  sack: {
    down: [[11, 10, 'a'], [11, 11, 'A'], [12, 11, 'A'], [11, 12, 'A'], [12, 12, 'A'], [11, 13, 'a'], [12, 13, 'a']],
    up:   [[11, 3, 'a'], [11, 4, 'A'], [12, 4, 'A'], [11, 5, 'A'], [12, 5, 'A']],
    fwd:  [...line(12, 8, 16, 8, 'Y'), [14, 7, 'Y'], [12, 9, 'Y'], [16, 9, 'Y'], [11, 10, 'Y'], [12, 10, 'Y'], [13, 10, 'Y'], [15, 10, 'A'], [16, 10, 'A'], [17, 10, 'A']],
  },
};
const SHIELD = ['.YY.', 'YNYY', 'YYYY', 'YYNY', '.YY.'];
const QUIVER = [[1, 6, 'r'], [2, 6, 'W'], [1, 7, 'w'], [2, 7, 'w'], [1, 8, 'w'], [2, 8, 'w'], [1, 9, 'w'], [2, 9, 'w'], [1, 10, 'w']];

const LOADS = {
  wood:  { ox: 1, oy: -3, rows: ['.wwwwwwwW.', 'wwwwwwwwWo', '.wwwwwwwW.'] },
  stone: { ox: 3, oy: -3, rows: ['.NMML', 'NMMMM', 'NNMMN'] },
  food:  { ox: 3, oy: -4, rows: ['..a..', 'AAAAA', 'AAAAA', 'aAAAa'] },
  gold:  { ox: 4, oy: -4, rows: ['.YY.', 'YyYY', 'YYYY', '.YY.'] },
};

const BASE_PAL = {
  e: '#140c0c', B: '#4a2c1a', b: '#d01c1c', Y: '#e8b830', y: '#ffe066', N: '#4d4d57', M: '#b9bcc6',
  L: '#eef0f5', w: '#7a4b26', W: '#c89a5e', r: '#d33b2c', o: '#ff8a1f', A: '#c9a66b', a: '#9c7b45', k: '#111111', R: '#7a1f2b',
};

const JOB_LOOK = {
  warrior: { H: '#a3161f', G: '#e8b830', C: '#5b4a3d', c: '#c9962e', D: '#6b1d24', d: '#4a1218' },
  archer:  { H: '#2e7d32', G: '#a5d6a7', C: '#7b5a3a', c: '#5e4229' },
  brute:   { H: '#d84315', G: '#ffcc80', C: '#c68642', c: '#ff9933', D: '#ff9933', d: '#d84315' },
  spear:   { H: '#1565c0', G: '#e8b830', C: '#3e5f8a', c: '#c9962e', D: '#e6dbbf', d: '#3e5f8a' },
  priest:  { H: '#ff8f1f', G: '#ffb84d', C: '#ff8f1f', c: '#e07010', D: '#ffb84d', d: '#e07010' },
  farm:    { H: '#f4ecd8', G: '#c8453c' },
  build:   { H: '#8d6e63', G: '#5d4037' },
  vaidya:  { H: '#f4ecd8', G: '#2e7d32', C: '#f4ecd8', c: '#2e7d32', D: '#e6dbbf', d: '#2e7d32' },
  trader:  { H: '#ffd54f', G: '#e65100', C: '#6a1b9a', c: '#e8b830' },
  stone:   { H: '#78909c', G: '#546e7a' },
};

function makeLook(g) {
  g = g || (Math.random() < 0.5 ? 'm' : 'f');
  const skin = pick(SKINS);
  if (g === 'm') {
    const t = pick(TURBANS);
    return { g, skin, hair: pick(HAIRS), cloth: pick(KURTAS), lower: pick(DHOTIS), head: t, head2: Math.random() < 0.5 ? shade(t, -0.25) : '#e8b830', stache: Math.random() < 0.7, trim: '#d8cfb6' };
  }
  return { g, skin, hair: pick(HAIRS), cloth: pick(BLOUSES), lower: pick(SAREES), trim: Math.random() < 0.6 ? '#e8b830' : pick(BLOUSES), covered: Math.random() < 0.35 };
}

function lookPalette(look, job) {
  const p = Object.assign({}, BASE_PAL);
  p.S = look.skin; p.s = shade(look.skin, -0.22);
  p.h = look.hair; p.m = look.stache ? look.hair : look.skin;
  p.C = look.cloth; p.c = shade(look.cloth, -0.18);
  p.D = look.lower; p.d = look.g === 'f' ? look.trim : shade(look.lower, -0.12);
  p.H = look.head || look.hair; p.G = look.head2 || look.hair;
  if (look.g === 'f' && look.covered) p.h = look.lower;
  const o = JOB_LOOK[job];
  if (o) {
    for (const k in o) {
      if (look.g === 'f' && (k === 'H' || k === 'G')) continue;
      if (look.g === 'f' && k === 'D' && job !== 'priest' && job !== 'warrior') continue;
      p[k] = o[k];
    }
    if (look.g === 'f' && (job === 'priest' || job === 'warrior')) { p.D = o.D; p.d = o.d; if (look.covered) p.h = o.D; }
  }
  return p;
}

const _vCache = new Map();
/**
 * pose: stand | walk | work0 | work1 | sit | shoot
 * load: null | wood | stone | food | gold
 */
function villagerSprite(v, pose, load) {
  const key = v.id + '|' + v.job + '|' + pose + '|' + (load || '');
  let c = _vCache.get(key);
  if (c) return c;
  c = makeCanvas(VB_W, VB_H);
  const x = c.getContext('2d');
  const pal = lookPalette(v.look, v.job);
  const fem = v.look.g === 'f';
  const up = fem ? FEMALE_UP : MALE_UP;
  const ox = VB_OX, oy = VB_OY;
  const tool = JOBS[v.job].tool;
  if (pose === 'sit') {
    paintMap(x, up, pal, ox, oy + 3);
    paintMap(x, SIT_LEGS, pal, ox, oy + 15);
    paintPix(x, ARMS.down.map((p) => [p[0], p[1] + 3, p[2]]), pal, ox, oy);
  } else {
    const walk = pose === 'walk';
    if (v.job === 'archer') paintPix(x, QUIVER, pal, ox, oy);
    paintMap(x, up, pal, ox, oy);
    paintMap(x, fem ? (walk ? FEMALE_LEGS_WALK : FEMALE_LEGS) : (walk ? MALE_LEGS_WALK : MALE_LEGS), pal, ox, oy + 14);
    let arm = 'down';
    if (pose === 'work0') arm = 'up';
    else if (pose === 'work1' || pose === 'shoot') arm = 'fwd';
    if (load) arm = 'down';
    if (v.job === 'warrior') paintMap(x, SHIELD, pal, ox, oy + 8);
    paintPix(x, ARMS[arm], pal, ox, oy);
    if (tool && !load) paintPix(x, TOOLS[tool][arm], pal, ox, oy);
    if (load) {
      const L = LOADS[load];
      paintMap(x, L.rows, pal, ox + L.ox, oy + L.oy + (fem ? 1 : 0));
    }
  }
  _vCache.set(key, c);
  return c;
}
function clearVillagerCache(id) {
  for (const k of _vCache.keys()) if (k.startsWith(id + '|')) _vCache.delete(k);
}

/* ---------------- Demons ---------------- */
const BHOOT_A = [
  '....WWWW....',
  '..WWWWWWWW..',
  '.WWWWWWWWWW.',
  '.WWWWWWWWWw.',
  '.WWkkWWkkWw.',
  '.WWkkWWkkWw.',
  '.WWWWWWWWWw.',
  'WWWWWKKWWWww',
  'wWWWKKKKWWWw',
  '..WWWKKWWWw.',
  '..WWWWWWWWw.',
  '..WWWWWWWww.',
  '..WWWWWWWww.',
  '..WW.WWW.ww.',
  '..W...WW..w.',
];
const BHOOT_B = BHOOT_A.slice(0, 13).concat(['..WWW.WWW.w.', '...W...W....']);
const BHOOT_PAL = { W: '#e8eef8', w: '#aebbd4', k: '#0e1020', K: '#2a2f48' };

const RAK_BODY = [
  '..B......B....',
  '..BB.hhh.B....',
  '...BhhhhBB....',
  '...hSSSSSS....',
  '..hhSSrSSr....',
  '..hhSSSSSS....',
  '...hSKSSKS....',
  '....SSSSS.....',
  '..sSSSSSSSS...',
  '.sSSSKSKSSS...',
  '.sSSSSSSSSS...',
  '.sSSSSSSSSS...',
  '.s.SSSSSSSS...',
  '...TTkTTkTT...',
  '...TTTkTTTk...',
  '...TkTTTkTT...',
];
const RAK_LEGS_A = ['....SS..SS....', '....SS..SS....', '....SS..SS....', '....SS..SS....', '...NNN..NNN...'];
const RAK_LEGS_B = ['...SS....SS...', '...SS....SS...', '..SS......SS..', '..SS......SS..', '.NNN......NNN.'];
const RAK_HOLD = [[11, 9, 'S'], [11, 10, 'S'], [11, 11, 'S'], [11, 12, 'S'], ...line(12, 8, 12, 13, 'w'),
  [12, 3, 'K'], [11, 4, 'W'], [12, 4, 'W'], [13, 4, 'w'], [10, 5, 'K'], [11, 5, 'W'], [12, 5, 'W'], [13, 5, 'w'], [14, 5, 'K'],
  [11, 6, 'W'], [12, 6, 'w'], [13, 6, 'w'], [11, 7, 'w'], [12, 7, 'w'], [13, 7, 'w']];
const RAK_SMASH = [[11, 9, 'S'], [12, 9, 'S'], [13, 9, 'S'], ...line(14, 9, 16, 9, 'w'),
  [18, 6, 'K'], [17, 7, 'W'], [18, 7, 'W'], [19, 7, 'w'], [16, 8, 'K'], [17, 8, 'W'], [18, 8, 'W'], [19, 8, 'w'], [20, 8, 'K'],
  [17, 9, 'W'], [18, 9, 'w'], [19, 9, 'w'], [17, 10, 'w'], [18, 10, 'w'], [19, 10, 'w'], [18, 11, 'K']];
const RAK_PALS = [
  { S: '#3c7a62' }, { S: '#3b5a9a' }, { S: '#8a3340' }, { S: '#5d3f8a' },
].map((o) => Object.assign({ s: shade(o.S, -0.3), h: '#1b1020', B: '#efe3c4', K: '#efe3c4', r: '#ff3d2e', T: '#e48a2c', k: '#1a1010', N: '#2a1a1a', w: '#5a3820', W: '#8d5b32' }, o));
const DANAV_PAL = Object.assign({}, RAK_PALS[2], { S: '#5a1a2a', s: '#3a0f1a', T: '#3d3d3d', k: '#e8b830', h: '#0c0608' });

const VET_UP = [
  'kk............kk',
  '.kkk..P..P..kkk.',
  '..kkkk.PP.kkkk..',
  '...kkkPPPPkkk...',
  '....kPyPPyPk....',
  '.....PPPPPP.....',
  '......PPPP......',
  '......B..B......',
];
const VET_DOWN = [
  '................',
  '......P..P......',
  '.......PP.......',
  '...kkkPPPPkkk...',
  '.kkkkPyPPyPkkkk.',
  'kkk..PPPPPP..kkk',
  'kk....PPPP....kk',
  '......B..B......',
];
const VET_PAL = { k: '#2b1638', P: '#5e3380', y: '#ffe14a', B: '#d8cbb0' };

const ASURA_BODY = [
  'B................B',
  'BB..............BB',
  '.BBb..Y.YY.Y..bBB.',
  '..bBBYYYYYYYYBBb..',
  '....bSSSSSSSSb....',
  '....SSrrSSrrSS....',
  '....SSSSSSSSSS....',
  '....SSKSSSSKSS....',
  '.....SSSSSSSS.....',
  '...YYYSSSSSSYYY...',
  '..SSSYYYYYYYYSSS..',
  '.sSSSSSSSSSSSSSS..',
  '.sSSSSSSSSSSSSSS..',
  '.sSSSSSSSSSSSSS...',
  '.sS.SSSSSSSSSS....',
  '.s..YYYYYYYYYY....',
  '....RRRRRRRRRR....',
  '....RRRRYRRRRR....',
  '....RRRRRRRRRR....',
];
const ASURA_LEGS_A = ['.....SSS..SSS.....', '.....SSS..SSS.....', '.....SSS..SSS.....', '.....SSS..SSS.....', '....NNNN..NNNN....'];
const ASURA_LEGS_B = ['....SSS....SSS....', '....SSS....SSS....', '...SSS......SSS...', '...SSS......SSS...', '..NNNN......NNNN..'];
const ASURA_HOLD = [[16, 10, 'S'], [16, 11, 'S'], [16, 12, 'S'], [16, 13, 'S'], ...line(17, 5, 17, 15, 'w'),
  ...line(16, 0, 18, 0, 'Y'), ...line(15, 1, 19, 1, 'Y'), ...line(15, 2, 19, 2, 'y'), ...line(15, 3, 19, 3, 'Y'), ...line(16, 4, 18, 4, 'Y'), [17, -1, 'Y']];
const ASURA_SMASH = [[16, 10, 'S'], [17, 10, 'S'], [18, 10, 'S'], ...line(19, 10, 23, 10, 'w'),
  ...line(25, 7, 25, 13, 'Y'), ...line(24, 7, 24, 13, 'Y'), ...line(26, 7, 26, 13, 'y'), ...line(27, 8, 27, 12, 'Y'), ...line(23, 8, 23, 12, 'Y'), [28, 10, 'Y']];
const ASURA_PAL = { S: '#3b2a4f', s: '#271a36', B: '#d8cbb0', b: '#a89b80', Y: '#e8b830', y: '#fff0a0', r: '#ff4a1a', K: '#efe3c4', R: '#8e1b1b', N: '#1a1014', w: '#5a3820' };

const E_W = 36, E_H = 30, E_OX = 6, E_OY = 3;
function buildEnemySprites() {
  const S = {};
  const mk = (layers) => {
    const c = makeCanvas(E_W, E_H);
    const x = c.getContext('2d');
    for (const L of layers) {
      if (L.rows) paintMap(x, L.rows, L.pal, E_OX + (L.ox || 0), E_OY + (L.oy || 0));
      else paintPix(x, L.pix, L.pal, E_OX, E_OY);
    }
    return c;
  };
  S.bhoot = [mk([{ rows: BHOOT_A, pal: BHOOT_PAL, oy: 10 }]), mk([{ rows: BHOOT_B, pal: BHOOT_PAL, oy: 10 }])];
  S.rakshasa = RAK_PALS.map((pal) => ({
    walk: [
      mk([{ rows: RAK_BODY, pal, oy: 4 }, { rows: RAK_LEGS_A, pal, oy: 20 }, { pix: RAK_HOLD.map((p) => [p[0], p[1] + 4, p[2]]), pal }]),
      mk([{ rows: RAK_BODY, pal, oy: 4 }, { rows: RAK_LEGS_B, pal, oy: 20 }, { pix: RAK_HOLD.map((p) => [p[0], p[1] + 4, p[2]]), pal }]),
    ],
    atk: mk([{ rows: RAK_BODY, pal, oy: 4 }, { rows: RAK_LEGS_A, pal, oy: 20 }, { pix: RAK_SMASH.map((p) => [p[0], p[1] + 4, p[2]]), pal }]),
  }));
  const dp = DANAV_PAL;
  S.danav = {
    walk: [
      mk([{ rows: RAK_BODY, pal: dp, oy: 4 }, { rows: RAK_LEGS_A, pal: dp, oy: 20 }, { pix: RAK_HOLD.map((p) => [p[0], p[1] + 4, p[2]]), pal: dp }]),
      mk([{ rows: RAK_BODY, pal: dp, oy: 4 }, { rows: RAK_LEGS_B, pal: dp, oy: 20 }, { pix: RAK_HOLD.map((p) => [p[0], p[1] + 4, p[2]]), pal: dp }]),
    ],
    atk: mk([{ rows: RAK_BODY, pal: dp, oy: 4 }, { rows: RAK_LEGS_A, pal: dp, oy: 20 }, { pix: RAK_SMASH.map((p) => [p[0], p[1] + 4, p[2]]), pal: dp }]),
  };
  S.vetala = [mk([{ rows: VET_UP, pal: VET_PAL, oy: 0 }]), mk([{ rows: VET_DOWN, pal: VET_PAL, oy: 0 }])];
  S.boss = {
    walk: [
      mk([{ rows: ASURA_BODY, pal: ASURA_PAL, oy: 2 }, { rows: ASURA_LEGS_A, pal: ASURA_PAL, oy: 21 }, { pix: ASURA_HOLD.map((p) => [p[0], p[1] + 2, p[2]]), pal: ASURA_PAL }]),
      mk([{ rows: ASURA_BODY, pal: ASURA_PAL, oy: 2 }, { rows: ASURA_LEGS_B, pal: ASURA_PAL, oy: 21 }, { pix: ASURA_HOLD.map((p) => [p[0], p[1] + 2, p[2]]), pal: ASURA_PAL }]),
    ],
    atk: mk([{ rows: ASURA_BODY, pal: ASURA_PAL, oy: 2 }, { rows: ASURA_LEGS_A, pal: ASURA_PAL, oy: 21 }, { pix: ASURA_SMASH.map((p) => [p[0], p[1] + 2, p[2]]), pal: ASURA_PAL }]),
  };
  return S;
}
// Sprite anchors (local body center column, eyes) per enemy type, in canvas pixels
const ENEMY_ANCHOR = {
  bhoot:    { ax: E_OX + 6, eyes: [] },
  rakshasa: { ax: E_OX + 6, eyes: [[E_OX + 6, E_OY + 8], [E_OX + 9, E_OY + 8]] },
  danav:    { ax: E_OX + 6, eyes: [[E_OX + 6, E_OY + 8], [E_OX + 9, E_OY + 8]] },
  vetala:   { ax: E_OX + 8, eyes: [[E_OX + 6, E_OY + 4], [E_OX + 9, E_OY + 4]] },
  boss:     { ax: E_OX + 9, eyes: [[E_OX + 6, E_OY + 7], [E_OX + 7, E_OY + 7], [E_OX + 10, E_OY + 7], [E_OX + 11, E_OY + 7]] },
};
const ENEMY_SCALE = { bhoot: 1, rakshasa: 1, vetala: 1, danav: 1.5, boss: 2 };

/* ---------------- Animals ---------------- */
const COW_A = [
  '...............r..',
  '..............B..r',
  '..........WW..BB.B',
  '..WWWWWWWWWWW.WWWW',
  '.WWWWWWWWWWWWWWkWW',
  'tWWWWWWWWWWWWWWWWp',
  'tWWWWWWWWWWWWWYWp.',
  't.wWWWWWWWWWWwY...',
  '..WwWWWWWWWWw.....',
  '..WW.WW...WW.WW...',
  '..WW.WW...WW.WW...',
  '..kk.kk...kk.kk...',
];
const COW_B = COW_A.slice(0, 9).concat(['..WW..WW.WW..WW...', '.WW...WW.WW...WW..', '.kk...kk.kk...kk..']);
const COW_PAL = { W: '#efe9df', w: '#d6cdbd', k: '#3a2a1a', B: '#cfc2a0', r: '#e03c31', p: '#d9a08a', Y: '#e8b830', t: '#a89f8f' };

const PEA_A = [
  '............c...',
  '...........cBc..',
  '............BBk.',
  '............BBy.',
  '............BB..',
  '...........BBB..',
  'GGGGGGGGGGBBBB..',
  'GgGGgGGgGBBBBB..',
  '.GGGGGGGGBBBB...',
  '..........yy....',
  '..........y.y...',
  '.........yy.yy..',
];
const PEA_FAN = [
  '...G.g.G.g.G....',
  '..GgGGGgGGGgG...',
  '.GGGgGGGgGGGGG..',
  'GgGGGGgGGGGGgGG.',
  'GGGgGGGGgGGcGGG.',
  'GGGGGGGGGGcBcGG.',
  'GgGGgGGGGGGBBk..',
  'GGGGGGGgGGGBBy..',
  '.GGgGGGGGGBBB...',
  '..GGGGGGGBBBB...',
  '..........yy....',
  '.........yy.yy..',
];
const PEA_PAL = { B: '#1f5fbf', G: '#2b8a4f', g: '#e8b830', c: '#4fc3f7', k: '#111111', y: '#b5916a' };

/* ---------------- HUD icons ---------------- */
const ICONS = {
  wood: [
    '.........',
    '.wwwwwwWW',
    'wwwwwwWoW',
    'wwwwwwWWW',
    '.wwwwwwW.',
    'wwwwwwwWW',
    'wwwwwwWoW',
    '.wwwwwWWW',
    '.........',
  ],
  stone: [
    '.........',
    '...LLM...',
    '..LMMMM..',
    '.LMMMMMN.',
    '.MMMMMMN.',
    'MMMMMNNNN',
    '.MMNNNNN.',
    '.........',
  ],
  food: [
    '...y.y...',
    '..yy.yy..',
    '...aaa...',
    '..AAAAA..',
    '.AAAAAAA.',
    '.AAaAAAA.',
    '.AAAAAAA.',
    '..aAAAa..',
  ],
  gold: [
    '..YYYYY..',
    '.YyyyyyY.',
    'YyYYYYYyY',
    'YyYoooYyY',
    'YyYYYYYyY',
    '.YyyyyyY.',
    '..YYYYY..',
  ],
  pop: [
    '..HHHH...',
    '.HHHHHH..',
    '.HGGGGGH.',
    '.hSSSSSS.',
    '..SSSeS..',
    '..SSSSS..',
    '...SSS...',
    '.CCCCCCC.',
    'CCCCCCCCC',
  ],
  fire: [
    '....y....',
    '...yo....',
    '..ooy.o..',
    '..oyyoo..',
    '.ooyyyoo.',
    '.oyywyyo.',
    '.ooywyoo.',
    'rrrrrrrrr',
    'RRRRRRRRR',
  ],
  heart: [
    '.rr.rr.',
    'rRrrrrr',
    'rrrrrrr',
    '.rrrrr.',
    '..rrr..',
    '...r...',
  ],
  skull: [
    '.WWWWW.',
    'WWWWWWW',
    'WkkWkkW',
    'WWWWWWW',
    '.WWkWW.',
    '.W.W.W.',
  ],
};
const ICON_PAL = {
  w: '#8a5a2e', W: '#d9a86a', o: '#6e4320', L: '#e2ded6', M: '#a9a49a', N: '#6f6a62', y: '#f2c94c', a: '#9c7b45', A: '#d6b47a',
  Y: '#d9a21b', H: '#ff9933', G: '#e8b830', h: '#1a1212', S: '#b5784a', e: '#140c0c', C: '#c8453c', r: '#e03c31', R: '#8f3f22',
  k: '#111', };
ICON_PAL.o = '#6e4320';
const ICON_PAL_GOLD = Object.assign({}, ICON_PAL, { y: '#fff1a8', o: '#a8770e' });
const ICON_PAL_FIRE = Object.assign({}, ICON_PAL, { y: '#ffe066', o: '#ff8a1f', w: '#ffffff', r: '#b5532f', R: '#7a3218' });
const ICON_PAL_SKULL = Object.assign({}, ICON_PAL, { W: '#e8eef8', k: '#1a1010' });

function iconDataURL(name, scale) {
  const pal = name === 'gold' ? ICON_PAL_GOLD : name === 'fire' ? ICON_PAL_FIRE : name === 'skull' ? ICON_PAL_SKULL : ICON_PAL;
  return compileMap(ICONS[name], pal, scale || 3).toDataURL();
}

/* ---------------- Tiny pixel font (3x5) for floating numbers ---------------- */
const FONT3 = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  '+': '000010111010000', '-': '000000111000000', '!': '010010010000010',
};
function drawText3(ctx, str, x, y, color, shadow) {
  str = String(str);
  for (let pass = shadow ? 0 : 1; pass < 2; pass++) {
    ctx.fillStyle = pass === 0 ? shadow : color;
    const o = pass === 0 ? 1 : 0;
    let cx = x;
    for (const ch of str) {
      const g = FONT3[ch];
      if (g) {
        for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3) + o, y + ((i / 3) | 0) + o, 1, 1);
      }
      cx += 4;
    }
  }
}
