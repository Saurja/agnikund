'use strict';
/* =========================================================
   AGNIKUND — Village of the Sacred Flame
   Core constants, helpers and game data tables
   ========================================================= */

const VIEW_H = 270;           // internal (pixel-art) resolution height
const GROUND_Y = 208;       // screen-space y of the ground surface
const WORLD_MIN = -2600, WORLD_MAX = 2600;
const DAY_LEN = 220;          // seconds in one full day/night cycle
const DUSK_T = 140;           // work ends, villagers head to the fire
const NIGHT_T = 156;          // demons arrive
const DAWN_T = 212;           // sunrise — demons burn away
const GRAV = 230;
const WIN_DAY = 15;           // survive this many nights to win

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sgn = (v) => (v < 0 ? -1 : 1);

function hash(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _rgbCache = {};
function hexToRgb(h) {
  if (_rgbCache[h]) return _rgbCache[h];
  const n = parseInt(h.slice(1), 16);
  return (_rgbCache[h] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) | (clamp(r | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(b | 0, 0, 255)).toString(16).slice(1);
}
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
function shade(hex, f) { // f<0 darker, f>0 lighter
  return f < 0 ? mix(hex, '#000000', -f) : mix(hex, '#ffffff', f);
}
function rgba(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function phaseOf(t) {
  return t < DUSK_T ? 'day' : t < NIGHT_T ? 'dusk' : t < DAWN_T ? 'night' : 'dawn';
}

/* ---------------- Resources ---------------- */
const RES = {
  wood:  { name: 'Lakdi',  en: 'Wood',  color: '#c98a4b' },
  stone: { name: 'Patthar', en: 'Stone', color: '#b8b4ab' },
  food:  { name: 'Anaj',   en: 'Grain', color: '#f2c94c' },
  gold:  { name: 'Sona',   en: 'Gold',  color: '#ffd84a' },
};
const RES_ORDER = ['wood', 'stone', 'food', 'gold'];
/** How much a worker fits in the tokri (woven back basket). */
const CARRY_CAP = { wood: 6, stone: 5, food: 5, gold: 5 };
/** Room in each stockpile, per good. Anything extra goes to the heap beside the Agnikund, which never fills. */
const STOCK_CAP = {
  woodcamp: { wood: 60 },
  minecamp: { stone: 50, gold: 20 },
  store: { wood: 80, stone: 80, food: 80, gold: 40 },
  field: { food: 25 },
  bigfield: { food: 50 }, bigfieldV: { food: 50 },
};
/** The Agnikund heap: where each good is piled beside the fire, and how much makes a "full-looking" pile. */
const FIRE_HEAP = { wood: { x: 2.05, z: 0.35, vis: 60 }, stone: { x: -2.05, z: -0.35, vis: 50 }, food: { x: -0.35, z: 2.05, vis: 60 }, gold: { x: 0.35, z: -2.05, vis: 30 } };

/* ---------------- Jobs ---------------- */
const JOBS = {
  idle:    { name: 'Aaram',      en: 'Idle',       desc: 'Rests by the Agnikund and keeps it company.' },
  // every job works from a building; `building` is the one to build for more places
  wood:    { name: 'Lakadhara',  en: 'Woodcutter', tool: 'axe',    desc: 'Chops trees near their Lakdi Taal. The fire eats wood!', building: 'woodcamp' },
  stone:   { name: 'Khanik',     en: 'Miner',      tool: 'pick',   desc: 'Breaks rocks near their Khadaan. Sometimes finds gold.', building: 'minecamp' },
  farm:    { name: 'Kisan',      en: 'Farmer',     tool: 'sickle', desc: 'Grows grain on a Khet.', building: 'field' },
  build:   { name: 'Mistri',     en: 'Builder',    tool: 'hammer', desc: 'Constructs and repairs buildings. The Agnikund has room for 2; a Mistri Adda adds more.', building: 'buildyard' },
  // soldiers: train a plain Sainik first, then hand them a crafted weapon to make a special soldier
  warrior: { name: 'Sainik',     en: 'Foot Soldier', tool: 'sword', desc: 'Foot soldier with a sword. Give a Sainik a crafted weapon to turn them into a special soldier.', building: 'akhara', slot: 'army' },
  brute:   { name: 'Gadadhari',  en: 'Mace Brute', tool: 'gada',   desc: 'A Sainik given a Gada: huge health, smashes groups of demons and knocks them back.', building: 'akhara', slot: 'army', weapon: 'gada' },
  spear:   { name: 'Bhaladhari', en: 'Spearman',   tool: 'spear',  desc: 'A Sainik given a Bhala: long reach and double damage against giant Danav and Mahasura.', building: 'akhara', slot: 'army', weapon: 'bhala' },
  archer:  { name: 'Dhanurdhar', en: 'Archer',     tool: 'bow',    desc: 'A Sainik given a Dhanush (bow): shoots demons from behind the walls.', building: 'range', slot: 'army', weapon: 'dhanush' },
  priest:  { name: 'Pujari',     en: 'Priest',     tool: 'thali',  desc: 'Heals nearby villagers, earns temple offerings.', building: 'temple' },
  trader:  { name: 'Vyapari',    en: 'Trader',     tool: 'sack',   desc: 'Sells grain for gold at the Bazaar.', building: 'bazaar' },
};
const AGNI_SLOTS = { build: 2 }; // work places the Agnikund itself provides
const JOB_ORDER = ['wood', 'stone', 'farm', 'build', 'warrior', 'brute', 'spear', 'archer', 'priest', 'trader'];
const slotKey = (job) => (JOBS[job] && JOBS[job].slot) || job;
// fighting stats per soldier type
const SOLDIERS = {
  warrior: { hp: 80,  dmg: 10, cd: 0.85, reach: 0.75, speed: 1 },
  brute:   { hp: 140, dmg: 17, cd: 1.35, reach: 0.9,  speed: 0.85, splash: 1.0, knock: 0.55 },
  spear:   { hp: 90,  dmg: 9,  cd: 0.9,  reach: 1.55, speed: 1, bigBonus: 2 },
  archer:  { hp: 48 },
};
/* ---------------- Weapons (crafted, kept in the armoury) ---------------- */
const WEAPONS = {
  gada:    { name: 'Gada',    en: 'Mace',  at: 'forge',   lvl: 1, cost: { stone: 12, gold: 3 }, job: 'brute' },
  dhanush: { name: 'Dhanush', en: 'Bow',   at: 'sawmill', lvl: 1, cost: { wood: 14 },          job: 'archer' },
  bhala:   { name: 'Bhala',   en: 'Spear', at: 'sawmill', lvl: 2, cost: { wood: 10, stone: 5 }, job: 'spear' },
};
const WEAPON_ORDER = ['gada', 'dhanush', 'bhala'];

/* ---------------- Buildings ---------------- */
// fw × fd = footprint in grid cells, ht = model height (for bars and selection)
const BUILDINGS = {
  hut:      { name: 'Jhopdi',        en: 'Hut',           fw: 2, fd: 2, ht: 2.2, cost: { wood: 20 },                      hp: 120, lvl: 1, time: 12, housing: 3, merge: 'bighouse', desc: 'Round mud hut with a thatched roof. Houses 3 villagers. Build two side by side and they join into a Bada Ghar.' },
  woodcamp: { name: 'Lakdi Taal',    en: 'Woodcutter Camp', fw: 2, fd: 2, ht: 1.9, cost: { wood: 15 },                    hp: 150, lvl: 1, time: 8, slots: { wood: 3 }, drop: ['wood'], desc: 'Timber yard for 3 Lakadhara. They chop the trees nearest the camp and drop wood here.' },
  minecamp: { name: 'Khadaan',       en: 'Mining Camp',   fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 150, lvl: 1, time: 10, slots: { stone: 3 }, drop: ['stone', 'gold'], desc: 'Stone camp for 3 Khanik. Build it next to boulders; miners drop stone here.' },
  buildyard: { name: 'Mistri Adda',  en: "Builders' Yard", fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                     hp: 150, lvl: 1, time: 10, slots: { build: 3 }, desc: 'Workshop for 3 more Mistri (builders).' },
  field:    { name: 'Khet',          en: 'Field',         fw: 3, fd: 3, ht: 0.8, cost: { wood: 15 },                      hp: 80,  lvl: 1, time: 8,  slots: { farm: 2 }, merge: 'bigfield', drop: ['food'], desc: 'Farmland for 2 Kisan (farmers). Two fields side by side join into a Bada Khet.' },
  palisade: { name: 'Baans ki Baad', en: 'Bamboo Wall',   fw: 1, fd: 1, ht: 1.5, cost: { wood: 6 },                       hp: 220, lvl: 1, time: 3,  wall: true, desc: 'Blocks demons. Click and drag to build a whole line of wall.' },
  akhara:   { name: 'Akhara',        en: 'Training Pit',  fw: 3, fd: 3, ht: 2.4, cost: { wood: 25, stone: 10 },           hp: 150, lvl: 1, time: 14, slots: { army: 3 }, desc: 'Wrestling pit with a mallakhamb. Room for 3 soldiers. Train Sainik here, then arm them at the Lohar or Aara Mill.' },
  store:    { name: 'Bhandar',       en: 'Storehouse',    fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 140, lvl: 1, time: 10, drop: ['wood', 'stone', 'food', 'gold'], desc: 'Workers drop any goods here. Build it between your work camps and the forest.' },
  range:    { name: 'Dhanush Shala', en: 'Archery Range', fw: 3, fd: 2, ht: 1.6, cost: { wood: 30, stone: 10 },           hp: 150, lvl: 2, time: 14, slots: { army: 3 }, desc: 'Archery range with room for 3 more soldiers. Dhanurdhar practise here.' },
  well:     { name: 'Kuan',          en: 'Well',          fw: 2, fd: 2, ht: 1.8, cost: { stone: 20 },                     hp: 160, lvl: 2, time: 10, desc: 'Fields within 9 steps grow 50% faster.' },
  bazaar:   { name: 'Bazaar',        en: 'Market',        fw: 3, fd: 2, ht: 1.9, cost: { wood: 35, stone: 15 },           hp: 150, lvl: 2, time: 16, slots: { trader: 2 }, desc: 'Spice stall. 2 Vyapari trade grain for gold.' },
  lamp:     { name: 'Deep Stambh',   en: 'Lamp Pillar',   fw: 1, fd: 1, ht: 2.7, cost: { stone: 15, gold: 5 },            hp: 140, lvl: 2, time: 8,  desc: 'Holy lamps light the night. Demons nearby are slowed and burn.' },
  forge:    { name: 'Lohar',         en: 'Blacksmith',    fw: 2, fd: 2, ht: 2.0, cost: { wood: 30, stone: 30, gold: 10 }, hp: 180, lvl: 2, time: 16, desc: 'Forges Gada maces for Gadadhari, iron tools and steel upgrades.',
    levels: [null, null, { cost: { stone: 45, gold: 20 }, time: 14, unlocks: 'Talwar steel swords for Sainik' }, { cost: { stone: 80, gold: 45 }, time: 18, unlocks: 'Kavach armour for all fighters' }] },
  sawmill:  { name: 'Aara Mill',     en: 'Sawmill',       fw: 3, fd: 2, ht: 2.1, cost: { wood: 40, stone: 10 },           hp: 180, lvl: 2, time: 14, desc: 'Saw pit and bow-maker. Crafts Dhanush bows for archers.',
    levels: [null, null, { cost: { wood: 60, gold: 15 }, time: 14, unlocks: 'Bhala spears for Bhaladhari, and Longbows' }, { cost: { wood: 90, stone: 30, gold: 35 }, time: 18, unlocks: 'Agni Baan fire arrows' }] },
  wall:     { name: 'Qila Deewar',   en: 'Fort Wall',     fw: 1, fd: 1, ht: 1.7, cost: { stone: 12 },                     hp: 600, lvl: 3, time: 5,  wall: true, desc: 'Sandstone fort wall, very sturdy. Click and drag to build a line.' },
  tower:    { name: 'Burj',          en: 'Arrow Tower',   fw: 2, fd: 2, ht: 4.9, cost: { wood: 30, stone: 35, gold: 10 }, hp: 320, lvl: 3, time: 18, desc: 'Chhatri watchtower. Shoots arrows at demons by itself.' },
  belltower: { name: 'Ghanta Burj',  en: 'Bell Tower',    fw: 2, fd: 2, ht: 4.4, cost: { wood: 30, stone: 40, gold: 15 }, hp: 300, lvl: 3, time: 18, desc: 'A great temple bell. Demons within 7 steps are slowed and take 25% more damage.' },
  firetower: { name: 'Agni Burj',    en: 'Fire Tower',    fw: 2, fd: 2, ht: 4.6, cost: { wood: 25, stone: 50, gold: 30 }, hp: 360, lvl: 4, time: 22, desc: 'Hurls burning pots that splash fire over groups of demons.' },
  cannontower: { name: 'Tope Burj',  en: 'Cannon Tower',  fw: 2, fd: 2, ht: 3.6, cost: { wood: 20, stone: 80, gold: 60 }, hp: 520, lvl: 5, time: 26, desc: 'A heavy fort cannon. Slow, but every shot smashes even giant demons.' },
  temple:   { name: 'Mandir',        en: 'Temple',        fw: 3, fd: 3, ht: 5.6, cost: { wood: 20, stone: 50, gold: 20 }, hp: 320, lvl: 3, time: 24, slots: { priest: 2 }, desc: 'Trains 2 Pujari, who heal villagers and collect offerings.' },
  // made by joining two of the same building side by side (not built directly)
  bighouse:  { name: 'Bada Ghar', en: 'Big House', fw: 4, fd: 2, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts).' },
  bighouseV: { name: 'Bada Ghar', en: 'Big House', fw: 2, fd: 4, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, model: 'bighouse', desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts).' },
  bigfield:  { name: 'Bada Khet', en: 'Big Field', fw: 6, fd: 3, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster.' },
  bigfieldV: { name: 'Bada Khet', en: 'Big Field', fw: 3, fd: 6, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, model: 'bigfield', desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster.' },
};
const BUILD_ORDER = ['hut', 'woodcamp', 'minecamp', 'buildyard', 'field', 'palisade', 'akhara', 'store', 'range', 'well', 'bazaar', 'lamp', 'forge', 'sawmill', 'wall', 'tower', 'belltower', 'temple', 'firetower', 'cannontower'];
// how each tower fights
const TOWERS = {
  tower:       { kind: 'arrow', range: 12, cd: 1.5, dmg: 6, y: 3.6 },
  firetower:   { kind: 'pot',   range: 11, cd: 3.2, dmg: 12, splash: 1.8, burn: 5, y: 4.2 },
  cannontower: { kind: 'ball',  range: 16, cd: 4.5, dmg: 45, splash: 1.0, y: 2.9 },
  belltower:   { kind: 'aura',  range: 7 },
};
/** Which job a building gives places for (first one). */
function jobOfBuilding(type) { const s = BUILDINGS[type].slots; if (!s) return null; const k = Object.keys(s)[0]; return k === 'army' ? 'warrior' : k; }
const isHome = (type) => !!BUILDINGS[type].housing;
const isFieldType = (type) => type === 'field' || type === 'bigfield' || type === 'bigfieldV';

/* ---------------- Demon loot ---------------- */
const LOOT = {
  gold:  { name: 'Sone ke sikke', en: 'Gold coins',  res: 'gold' },
  wood:  { name: 'Lakdi ka gattha', en: 'Wood bundle', res: 'wood' },
  stone: { name: 'Patthar',       en: 'Stone chunks', res: 'stone' },
  food:  { name: 'Anaj ki bori',  en: 'Grain sack',  res: 'food' },
  gem:   { name: 'Asura Mani',    en: 'Demon gem',   res: 'gold' },
  chest: { name: 'Khazana',       en: 'Treasure chest', res: 'gold' },
};

/* ---------------- Trees ---------------- */
const TREE_INFO = {
  palm:   { name: 'Nariyal', en: 'Coconut Palm', wood: 18 },
  banyan: { name: 'Bargad',  en: 'Banyan Tree',  wood: 40 },
  mango:  { name: 'Aam',     en: 'Mango Tree',   wood: 24 },
  neem:   { name: 'Neem',    en: 'Neem Tree',    wood: 22 },
};
const TREE_TYPES = ['palm', 'banyan', 'mango', 'neem'];

/* ---------------- Blacksmith upgrades ---------------- */
// at / lvl: which building, and its level, offers the upgrade
const UPGRADES = {
  axe:      { name: 'Loha Kulhadi', en: 'Iron Axes',     at: 'forge',   lvl: 1, cost: { stone: 20, gold: 12 }, desc: 'Woodcutters chop 60% faster.' },
  pick:     { name: 'Loha Gainti',  en: 'Iron Pickaxes', at: 'forge',   lvl: 1, cost: { wood: 20, gold: 12 },  desc: 'Miners dig 60% faster.' },
  plough:   { name: 'Loha Hal',     en: 'Iron Ploughs',  at: 'forge',   lvl: 1, cost: { wood: 30, gold: 18 },  desc: 'Each harvest gives 50% more grain.' },
  talwar:   { name: 'Talwar',       en: 'Steel Swords',  at: 'forge',   lvl: 2, cost: { stone: 30, gold: 28 }, desc: 'Sainik deal 60% more damage, +30 HP.' },
  kavach:   { name: 'Kavach',       en: 'Armour',        at: 'forge',   lvl: 3, cost: { stone: 50, gold: 40 }, desc: 'All fighters take 35% less damage.' },
  bow:      { name: 'Baans Dhanush', en: 'Longbows',     at: 'sawmill', lvl: 2, cost: { wood: 40, gold: 28 },  desc: 'Archers deal 50% more damage and shoot further.' },
  agnibaan: { name: 'Agni Baan',    en: 'Fire Arrows',   at: 'sawmill', lvl: 3, cost: { wood: 50, gold: 40 },  desc: 'Archer and tower arrows set demons on fire.' },
};
const UPGRADE_ORDER = ['axe', 'pick', 'plough', 'talwar', 'kavach', 'bow', 'agnibaan'];

/* ---------------- Agnikund (sacred fire) levels ---------------- */
const FIRE_LEVELS = [
  null,
  { radius: 10,  hp: 300,  housing: 4, fuelMax: 30, burn: 0.065, light: 15, cost: null },
  { radius: 13,  hp: 450,  housing: 5, fuelMax: 40, burn: 0.085, light: 18, cost: { wood: 80, stone: 40 } },
  { radius: 16.5, hp: 650, housing: 6, fuelMax: 50, burn: 0.10,  light: 21, cost: { wood: 150, stone: 110, gold: 35 } },
  { radius: 20,  hp: 900,  housing: 7, fuelMax: 60, burn: 0.12,  light: 24, cost: { wood: 240, stone: 190, gold: 90 } },
  { radius: 24,  hp: 1200, housing: 8, fuelMax: 70, burn: 0.14,  light: 27, cost: { wood: 360, stone: 300, gold: 170 } },
];

/* ---------------- Demons ---------------- */
const ENEMIES = {
  // r = body radius, h = body height, scale = model scale (all in grid units)
  bhoot:    { name: 'Bhoot',    en: 'Ghost',         hp: 16,  dmg: 2.5, speed: 1.6,  atkCd: 1.0, gold: 1,  r: 0.35, h: 1.2, scale: 1,    reach: 0.75, cost: 1, ghost: true },
  rakshasa: { name: 'Rakshasa', en: 'Demon',         hp: 46,  dmg: 7,   speed: 1.2,  atkCd: 1.3, gold: 2,  r: 0.4,  h: 1.6, scale: 1,    reach: 0.85, cost: 2 },
  vetala:   { name: 'Vetala',   en: 'Flying Spirit', hp: 22,  dmg: 4,   speed: 2.2,  atkCd: 1.0, gold: 2,  r: 0.4,  h: 0.6, scale: 1,    reach: 0.8,  cost: 2, fly: true },
  danav:    { name: 'Danav',    en: 'Giant Demon',   hp: 150, dmg: 15,  speed: 0.85, atkCd: 1.8, gold: 6,  r: 0.6,  h: 2.3, scale: 1.45, reach: 1.15, cost: 6 },
  boss:     { name: 'Mahasura', en: 'Demon King',    hp: 500, dmg: 28,  speed: 0.7,  atkCd: 2.2, gold: 40, r: 0.95, h: 3.8, scale: 2.4,  reach: 1.7,  cost: 0, boss: true },
  // ghosts of Bengali folklore (bhoot-pret of Bangla tales)
  aleya:       { name: 'Aleya',       en: 'Marsh Light',     hp: 9,   dmg: 1.5, speed: 2.6,  atkCd: 0.9, gold: 1, r: 0.25, h: 0.5, scale: 1,    reach: 0.6,  cost: 2, fly: true, swarm: 3, glow: 0xd4ff7a, bengali: true, from: 2 },
  shakchunni:  { name: 'Shakchunni',  en: 'Bride Ghost',     hp: 30,  dmg: 4,   speed: 1.9,  atkCd: 1.0, gold: 2, r: 0.35, h: 1.4, scale: 1,    reach: 0.8,  cost: 2, ghost: true, float: true, drain: 0.6, glow: 0xffd6d6, bengali: true, from: 3 },
  mechho:      { name: 'Mechho Bhoot', en: 'Fish-thief Ghost', hp: 26, dmg: 2,  speed: 1.75, atkCd: 1.2, gold: 2, r: 0.35, h: 1.2, scale: 1,    reach: 0.75, cost: 2, ghost: true, thief: 'food', steal: 10, bengali: true, from: 3 },
  nishi:       { name: 'Nishi',       en: 'Night Caller',    hp: 34,  dmg: 3,   speed: 1.15, atkCd: 1.2, gold: 3, r: 0.35, h: 1.7, scale: 1,    reach: 0.8,  cost: 3, ghost: true, float: true, caller: true, glow: 0x9fb4ff, bengali: true, from: 5 },
  skondhokata: { name: 'Skondhokata', en: 'Headless Ghost',  hp: 110, dmg: 11,  speed: 0.95, atkCd: 1.5, gold: 4, r: 0.5,  h: 1.9, scale: 1.25, reach: 1.0,  cost: 4, wrecker: 2.2, bengali: true, from: 7 },
};
/** One line of lore per demon, shown in the info panel and when it first appears. */
const ENEMY_LORE = {
  bhoot: 'A restless ghost. Weak, but it drifts straight for your people.',
  rakshasa: 'A horned demon with a spiked club. Smashes walls in its way.',
  vetala: 'A bat-winged spirit. Flies over walls and swoops on villagers — archers can hit it.',
  danav: 'A giant demon. Very tough and hits hard.',
  boss: 'Mahasura, the buffalo-horned Demon King. Gather every warrior!',
  aleya: 'Ghost lights from the marshes that lead travellers astray. They drift in as a swarm over your walls, quick but frail.',
  shakchunni: 'The ghost of a married woman in a white saree with a red border and shell bangles. She drifts through walls, and every blow she lands heals her.',
  mechho: 'A fish-loving ghost from the ponds. He sneaks to your grain stores, steals what he can carry and runs for the forest. Kill him to get the grain back.',
  nishi: 'The Nishi calls sleepers by name in a loved one’s voice. Villagers hiding in their huts walk out toward her, so hunt her down quickly.',
  skondhokata: 'A headless ghost that wanders the night. Huge and slow, he smashes walls and buildings twice as hard as a demon.',
};

/* ---------------- Villager looks & names ---------------- */
const NAMES_M = ['Arjun', 'Ravi', 'Kabir', 'Mohan', 'Vikram', 'Suresh', 'Anil', 'Raju', 'Dev', 'Hari', 'Gopal', 'Bhim', 'Karan', 'Imran', 'Farhan', 'Harpreet', 'Joseph', 'Tenzin', 'Rohan', 'Aman', 'Sunil', 'Manoj', 'Ishaan', 'Yusuf', 'Balram', 'Madhav', 'Naveen', 'Om', 'Pranav', 'Shankar', 'Lakhan', 'Bhola', 'Chandu', 'Govind', 'Kishan'];
const NAMES_F = ['Sita', 'Meera', 'Priya', 'Lakshmi', 'Gita', 'Radha', 'Anjali', 'Kavya', 'Asha', 'Pooja', 'Fatima', 'Noor', 'Simran', 'Mary', 'Leela', 'Durga', 'Parvati', 'Kamla', 'Sunita', 'Rekha', 'Tara', 'Uma', 'Jaya', 'Savitri', 'Nandini', 'Bhavna', 'Ananya', 'Zoya', 'Gauri', 'Roshni', 'Champa', 'Basanti', 'Chameli', 'Rani'];
const SKINS = ['#8d5524', '#a0673a', '#c68642', '#7a4a2a', '#b5784a', '#9c6239', '#cf9561'];
const HAIRS = ['#1a1212', '#2b1b14', '#3a2618'];
const KURTAS = ['#f4ecd8', '#e8c85a', '#3d7cc9', '#c8453c', '#5d9b4a', '#9b59b6', '#e67e22', '#2e86ab', '#d35d8a'];
const DHOTIS = ['#f4ecd8', '#efe4c8', '#e6dbbf', '#f7f1e3'];
const TURBANS = ['#ff9933', '#e03c31', '#f4ecd8', '#d4a017', '#c2185b', '#1e88e5', '#ffffff', '#ff7043'];
const SAREES = ['#e03c31', '#c2185b', '#2a9d6f', '#ffb31a', '#7b3fa0', '#1f6f8b', '#ff6f61', '#e8731a', '#d81b60'];
const BLOUSES = ['#ffb31a', '#2a9d6f', '#c2185b', '#1e3a8a', '#f4ecd8', '#e03c31'];

function costText(cost) {
  return Object.keys(cost).map((k) => cost[k] + ' ' + RES[k].en.toLowerCase()).join(', ');
}
