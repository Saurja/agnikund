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
/*
 * Goods. The four basics come straight from the land. Materials come in tiers: clay and iron ore are dug
 * and mined (raw), bricks and charcoal are made from them at the kiln (level 2), and iron is smelted from
 * ore and charcoal (level 3). Bricks build the second stage of the village, iron the third.
 */
const RES = {
  wood:     { name: 'Lakdi',  en: 'Wood',  color: '#c98a4b' },
  stone:    { name: 'Patthar', en: 'Stone', color: '#b8b4ab' },
  food:     { name: 'Anaj',   en: 'Grain', color: '#f2c94c' },
  gold:     { name: 'Sona',   en: 'Gold',  color: '#ffd84a' },
  clay:     { name: 'Mitti',  en: 'Clay',  color: '#c7794a', mat: true, raw: true, from: 'Dug at a Mitti Khaan (clay pit)' },
  ore:      { name: 'Kaccha Loha', en: 'Iron Ore', color: '#b06a48', mat: true, raw: true, from: 'Mined from rusty boulders: set a Khadaan to dig iron ore' },
  brick:    { name: 'Eent',   en: 'Bricks', color: '#d8643c', mat: true, tier: 2, from: 'Fired from clay and wood at an Eent Bhatta (brick kiln)' },
  charcoal: { name: 'Koyla',  en: 'Charcoal', color: '#8d8a88', mat: true, tier: 2, from: 'Burned from wood at an Eent Bhatta' },
  iron:     { name: 'Loha',   en: 'Iron',  color: '#b9c3cf', mat: true, tier: 3, from: 'Smelted from iron ore and charcoal at a Loha Bhatti' },
};
const RES_ORDER = ['wood', 'stone', 'food', 'gold', 'clay', 'ore', 'brick', 'charcoal', 'iron'];
const BASE_RES = ['wood', 'stone', 'food', 'gold'];
const MAT_RES = ['clay', 'ore', 'brick', 'charcoal', 'iron'];
/** How much a worker fits in the tokri (woven back basket). */
const CARRY_CAP = { wood: 6, stone: 5, food: 5, gold: 5, clay: 5, ore: 4, brick: 6, charcoal: 6, iron: 3 };
/** Room in each stockpile, per good. Anything extra goes to the heap beside the Agnikund, which never fills. */
const STOCK_CAP = {
  woodcamp: { wood: 60 },
  minecamp: { stone: 50, gold: 20, ore: 30 },
  store: { wood: 80, stone: 80, food: 80, gold: 40 },
  field: { food: 25 },
  bigfield: { food: 50 }, bigfieldV: { food: 50 },
  claypit: { clay: 40 },
  kiln: { brick: 45, charcoal: 30 },
  smelter: { iron: 25 },
};
/** The Agnikund heap: where each good is piled beside the fire, and how much makes a "full-looking" pile. */
const FIRE_HEAP = {
  wood: { x: 2.05, z: 0.35, vis: 60 }, stone: { x: -2.05, z: -0.35, vis: 50 }, food: { x: -0.35, z: 2.05, vis: 60 }, gold: { x: 0.35, z: -2.05, vis: 30 },
  clay: { x: 1.18, z: 1.67, vis: 40 }, brick: { x: -1.67, z: 1.18, vis: 50 }, ore: { x: -1.58, z: -1.31, vis: 30 }, charcoal: { x: -1.01, z: -1.78, vis: 40 }, iron: { x: 1.67, z: -1.18, vis: 20 },
};
/*
 * What the processing buildings make. in: goods brought into the hopper for one batch, out / n: what comes
 * out, time: work-seconds for one worker (two workers finish a batch in half the time).
 */
const RECIPES = {
  brick:    { at: 'kiln',    in: { clay: 3, wood: 1 },     out: 'brick',    n: 3, time: 8,  verb: 'Firing bricks' },
  charcoal: { at: 'kiln',    in: { wood: 3 },              out: 'charcoal', n: 2, time: 7,  verb: 'Burning charcoal' },
  iron:     { at: 'smelter', in: { ore: 2, charcoal: 2 },  out: 'iron',     n: 1, time: 10, verb: 'Smelting iron' },
};

/* ---------------- Jobs ---------------- */
const JOBS = {
  idle:    { name: 'Aaram',      en: 'Idle',       desc: 'Lends a hand as a Mistri: builds, upgrades and repairs (a little slower than a trained one). Rests by the Agnikund when there is nothing to build.' },
  // every job works from a building; `building` is the one to build for more places
  wood:    { name: 'Lakadhara',  en: 'Woodcutter', tool: 'axe',    desc: 'Chops trees near their Lakdi Taal. The fire eats wood!', building: 'woodcamp' },
  stone:   { name: 'Khanik',     en: 'Miner',      tool: 'pick',   desc: 'Breaks rocks near their Khadaan. Sometimes finds gold.', building: 'minecamp' },
  farm:    { name: 'Kisan',      en: 'Farmer',     tool: 'sickle', desc: 'Grows grain on a Khet.', building: 'field' },
  build:   { name: 'Mistri',     en: 'Builder',    tool: 'hammer', desc: 'Constructs and repairs buildings. The Agnikund has room for 2; a Mistri Adda adds more.', building: 'buildyard' },
  clay:    { name: 'Beldar',     en: 'Clay Digger', tool: 'spade', desc: 'Digs wet clay at a Mitti Khaan. The Eent Bhatta fires it into bricks.', building: 'claypit' },
  kiln:    { name: 'Kumhar',     en: 'Kiln Worker', tool: 'mould', desc: 'Brings clay and wood to the Eent Bhatta and fires bricks, or burns wood into charcoal.', building: 'kiln' },
  smelt:   { name: 'Agariya',    en: 'Smelter',     tool: 'tongs', desc: 'Brings iron ore and charcoal to the Loha Bhatti and smelts iron.', building: 'smelter' },
  vaidya:  { name: 'Vaidya',     en: 'Healer',     tool: 'herbs',  desc: 'Walks to wounded villagers and soldiers and heals them with herbal medicine. Works from a Vaidyashala.', building: 'vaidyashala' },
  // soldiers: train a plain Sainik first, then hand them a crafted weapon to make a special soldier
  warrior: { name: 'Sainik',     en: 'Foot Soldier', tool: 'sword', desc: 'Foot soldier with a sword. Give a Sainik a crafted weapon to turn them into a special soldier.', building: 'akhara', slot: 'army' },
  brute:   { name: 'Gadadhari',  en: 'Mace Brute', tool: 'gada',   desc: 'A Sainik given a Gada: huge health, smashes groups of demons and knocks them back.', building: 'akhara', slot: 'army', weapon: 'gada' },
  spear:   { name: 'Bhaladhari', en: 'Spearman',   tool: 'spear',  desc: 'A Sainik given a Bhala: long reach and double damage against giant Danav and Mahasura.', building: 'akhara', slot: 'army', weapon: 'bhala' },
  archer:  { name: 'Dhanurdhar', en: 'Archer',     tool: 'bow',    desc: 'A Sainik given a Dhanush (bow): shoots demons from behind the walls.', building: 'range', slot: 'army', weapon: 'dhanush' },
  medic:   { name: 'Chikitsak',  en: 'Field Medic', tool: 'potli', desc: 'A Sainik given an Aushadhi Potli (medicine kit): follows the soldiers into battle and heals the wounded, and now and then pours healing over everyone nearby.', building: 'akhara', slot: 'army', weapon: 'potli' },
  priest:  { name: 'Pujari',     en: 'Priest',     tool: 'thali',  desc: 'Heals nearby villagers, earns temple offerings.', building: 'temple' },
  trader:  { name: 'Vyapari',    en: 'Trader',     tool: 'sack',   desc: 'Sells grain for gold at the Bazaar.', building: 'bazaar' },
};
const AGNI_SLOTS = { build: 2 }; // work places the Agnikund itself provides
const JOB_ORDER = ['wood', 'stone', 'farm', 'clay', 'kiln', 'smelt', 'build', 'vaidya', 'warrior', 'brute', 'spear', 'archer', 'medic', 'priest', 'trader'];
const slotKey = (job) => (JOBS[job] && JOBS[job].slot) || job;
// fighting stats per soldier type
const SOLDIERS = {
  warrior: { hp: 80,  dmg: 10, cd: 0.85, reach: 0.75, speed: 1 },
  brute:   { hp: 140, dmg: 17, cd: 1.35, reach: 0.9,  speed: 0.85, splash: 1.0, knock: 0.55 },
  spear:   { hp: 90,  dmg: 9,  cd: 0.9,  reach: 1.55, speed: 1, bigBonus: 2 },
  archer:  { hp: 48 },
  medic:   { hp: 60, heal: 9 },
};
/*
 * How each soldier fights. atk: the swings of their combo, in order. dur / hit: how long one swing takes and
 * when in it the blow lands (a slow wind-up, a fast strike). Each has one special move on a cooldown.
 */
const SOLDIER_MOVES = {
  warrior: { atk: ['slash', 'slash', 'thrust'], crit: 0.15, block: 0.22, ability: { key: 'bash',   name: 'Dhaal Vaar',    en: 'Shield Bash',  cd: 8,  desc: 'stuns a demon' } },
  brute:   { atk: ['smash'],                    crit: 0.1,              ability: { key: 'slam',   name: 'Bhoomi Kampan', en: 'Earth Shaker', cd: 10, desc: 'smashes and stuns every demon around' } },
  spear:   { atk: ['thrust', 'thrust'],         crit: 0.12,             ability: { key: 'lunge',  name: 'Bhala Vaar',    en: 'Spear Lunge',  cd: 7,  desc: 'dashes through a line of demons' } },
  archer:  {                                    crit: 0.1,              ability: { key: 'volley', name: 'Baan Varsha',   en: 'Arrow Rain',   cd: 9,  desc: 'a volley of fire arrows' } },
  medic:   {                                                            ability: { key: 'pulse',  name: 'Amrit Varsha',  en: 'Healing Rain', cd: 12, desc: 'heals everyone nearby' } },
};
const SWINGS = { // dur: seconds per swing, hit: fraction of it when the blow lands
  slash: { dur: 0.4, hit: 0.5 }, thrust: { dur: 0.45, hit: 0.5 }, smash: { dur: 0.75, hit: 0.6 },
  bash: { dur: 0.42, hit: 0.45 }, slam: { dur: 1.0, hit: 0.62 }, lunge: { dur: 0.6, hit: 0.42 },
  shoot: { dur: 0.5, hit: 0.7 }, volley: { dur: 0.8, hit: 0.65 }, pulse: { dur: 0.7, hit: 0.5 },
};
/* ---------------- Weapons (crafted, kept in the armoury) ---------------- */
const WEAPONS = {
  gada:    { name: 'Gada',    en: 'Mace',  at: 'forge',   lvl: 1, cost: { iron: 3, stone: 4, gold: 2 }, job: 'brute' },
  dhanush: { name: 'Dhanush', en: 'Bow',   at: 'sawmill', lvl: 1, cost: { wood: 14 },          job: 'archer' },
  bhala:   { name: 'Bhala',   en: 'Spear', at: 'sawmill', lvl: 2, cost: { wood: 10, iron: 2 }, job: 'spear' },
  potli:   { name: 'Aushadhi Potli', en: 'Medicine Kit', at: 'vaidyashala', lvl: 1, cost: { food: 10, wood: 4 }, job: 'medic' },
};
const WEAPON_ORDER = ['gada', 'dhanush', 'bhala', 'potli'];

/* ---------------- Buildings ---------------- */
// fw × fd = footprint in grid cells, ht = model height (for bars and selection)
const BUILDINGS = {
  hut:      { name: 'Jhopdi',        en: 'Hut',           fw: 2, fd: 2, ht: 2.2, cost: { wood: 20 },                      hp: 120, lvl: 1, time: 12, housing: 3, merge: 'bighouse', desc: 'Round mud hut with a thatched roof. Houses 3 villagers. Build two side by side and they join into a Bada Ghar.' },
  woodcamp: { name: 'Lakdi Taal',    en: 'Woodcutter Camp', fw: 2, fd: 2, ht: 1.9, cost: { wood: 15 },                    hp: 150, lvl: 1, time: 8, slots: { wood: 3 }, drop: ['wood'], desc: 'Timber yard for 3 Lakadhara. They chop the trees nearest the camp and drop wood here.' },
  minecamp: { name: 'Khadaan',       en: 'Mining Camp',   fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 150, lvl: 1, time: 10, slots: { stone: 3 }, drop: ['stone', 'gold', 'ore'], desc: 'Stone camp for 3 Khanik. Build it next to boulders; miners drop stone here. From Agnikund level 2 it can dig iron ore from the rusty boulders instead.' },
  buildyard: { name: 'Mistri Adda',  en: "Builders' Yard", fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                     hp: 150, lvl: 1, time: 10, slots: { build: 3 }, desc: 'Workshop for 3 more Mistri (builders).' },
  field:    { name: 'Khet',          en: 'Field',         fw: 3, fd: 3, ht: 0.8, cost: { wood: 15 },                      hp: 80,  lvl: 1, time: 8,  slots: { farm: 2 }, merge: 'bigfield', drop: ['food'], desc: 'Farmland for 2 Kisan (farmers). Two fields side by side join into a Bada Khet.' },
  palisade: { name: 'Baans ki Baad', en: 'Bamboo Wall',   fw: 1, fd: 1, ht: 1.5, cost: { wood: 6 },                       hp: 220, lvl: 1, time: 3,  wall: true, desc: 'Blocks demons. Click and drag to build a whole line of wall.' },
  akhara:   { name: 'Akhara',        en: 'Training Pit',  fw: 3, fd: 3, ht: 2.4, cost: { wood: 25, stone: 10 },           hp: 150, lvl: 1, time: 14, slots: { army: 3 }, desc: 'Wrestling pit with a mallakhamb. Room for 3 soldiers. Train Sainik here, then arm them at the Lohar or Aara Mill.' },
  store:    { name: 'Bhandar',       en: 'Storehouse',    fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 140, lvl: 1, time: 10, drop: RES_ORDER.slice(), desc: 'Storehouse with 4 bays. Pick the good each bay holds; goods with no bay need another Bhandar. Upgrades add bays (6, then 8).' },
  // the materials chain: clay pit and brick kiln from the start, the iron smelter from Agnikund level 2
  claypit:  { name: 'Mitti Khaan',   en: 'Clay Pit',      fw: 2, fd: 2, ht: 1.1, cost: { wood: 20 },                      hp: 120, lvl: 1, time: 8,  slots: { clay: 2 }, drop: ['clay'], desc: 'A pit of wet clay. 2 Beldar dig here and stack the clay beside it.' },
  kiln:     { name: 'Eent Bhatta',   en: 'Brick Kiln',    fw: 2, fd: 2, ht: 3.0, cost: { wood: 30, stone: 15 },           hp: 170, lvl: 1, time: 12, slots: { kiln: 2 }, drop: ['brick', 'charcoal'], recipes: ['auto', 'brick', 'charcoal'], desc: '2 Kumhar fire clay and wood into bricks, or slow-burn wood into charcoal for the smelter.' },
  smelter:  { name: 'Loha Bhatti',   en: 'Iron Smelter',  fw: 2, fd: 2, ht: 2.5, cost: { brick: 20, stone: 15, wood: 10 }, hp: 200, lvl: 2, time: 16, slots: { smelt: 2 }, drop: ['iron'], recipes: ['iron'], desc: 'A clay shaft furnace with leather bellows. 2 Agariya smelt iron ore with charcoal into iron.' },
  range:    { name: 'Dhanush Shala', en: 'Archery Range', fw: 3, fd: 2, ht: 1.6, cost: { wood: 25, brick: 10 },           hp: 150, lvl: 2, time: 14, slots: { army: 3 }, desc: 'Archery range with room for 3 more soldiers. Dhanurdhar practise here.' },
  well:     { name: 'Kuan',          en: 'Well',          fw: 2, fd: 2, ht: 1.8, cost: { stone: 10, brick: 12 },          hp: 160, lvl: 2, time: 10, desc: 'Fields within 9 steps grow 50% faster.' },
  bazaar:   { name: 'Bazaar',        en: 'Market',        fw: 3, fd: 2, ht: 1.9, cost: { wood: 30, brick: 15 },           hp: 150, lvl: 2, time: 16, slots: { trader: 2 }, desc: 'Spice stall. 2 Vyapari trade grain for gold.' },
  lamp:     { name: 'Deep Stambh',   en: 'Lamp Pillar',   fw: 1, fd: 1, ht: 2.7, cost: { stone: 10, brick: 6, gold: 5 },  hp: 140, lvl: 2, time: 8,  desc: 'Holy lamps light the night. Demons nearby are slowed and burn.' },
  forge:    { name: 'Lohar',         en: 'Blacksmith',    fw: 2, fd: 2, ht: 2.0, cost: { wood: 25, brick: 20, gold: 10 }, hp: 180, lvl: 2, time: 16, desc: 'Forges Gada maces for Gadadhari, iron tools and steel upgrades.',
    levels: [null, null, { cost: { brick: 30, iron: 10, gold: 20 }, time: 62, unlocks: 'Talwar steel swords for Sainik' }, { cost: { brick: 40, iron: 30, gold: 45 }, time: 98, unlocks: 'Kavach armour for all fighters' }] },
  sawmill:  { name: 'Aara Mill',     en: 'Sawmill',       fw: 3, fd: 2, ht: 2.1, cost: { wood: 35, brick: 10 },           hp: 180, lvl: 2, time: 14, desc: 'Saw pit and bow-maker. Crafts Dhanush bows for archers.',
    levels: [null, null, { cost: { wood: 50, brick: 20, gold: 15 }, time: 58, unlocks: 'Bhala spears for Bhaladhari, and Longbows' }, { cost: { wood: 70, brick: 30, iron: 15, gold: 35 }, time: 92, unlocks: 'Agni Baan fire arrows' }] },
  wall:     { name: 'Qila Deewar',   en: 'Fort Wall',     fw: 1, fd: 1, ht: 1.7, cost: { stone: 8, brick: 3 },            hp: 600, lvl: 3, time: 5,  wall: true, desc: 'Sandstone and brick fort wall, very sturdy. Click and drag to build a line.' },
  tower:    { name: 'Burj',          en: 'Arrow Tower',   fw: 2, fd: 2, ht: 4.9, cost: { wood: 20, brick: 25, iron: 6, gold: 10 }, hp: 320, lvl: 3, time: 18, desc: 'Chhatri watchtower. Shoots arrows at demons by itself.' },
  belltower: { name: 'Ghanta Burj',  en: 'Bell Tower',    fw: 2, fd: 2, ht: 4.4, cost: { wood: 20, brick: 25, iron: 10, gold: 15 }, hp: 300, lvl: 3, time: 18, desc: 'A great temple bell cast in iron. Demons within 7 steps are slowed and take 25% more damage.' },
  firetower: { name: 'Agni Burj',    en: 'Fire Tower',    fw: 2, fd: 2, ht: 4.6, cost: { brick: 40, iron: 12, charcoal: 15, gold: 30 }, hp: 360, lvl: 4, time: 22, desc: 'Hurls burning pots that splash fire over groups of demons.' },
  cannontower: { name: 'Tope Burj',  en: 'Cannon Tower',  fw: 2, fd: 2, ht: 3.6, cost: { stone: 40, brick: 40, iron: 30, gold: 40 }, hp: 520, lvl: 5, time: 26, desc: 'A heavy iron fort cannon. Slow, but every shot smashes even giant demons.' },
  temple:   { name: 'Mandir',        en: 'Temple',        fw: 3, fd: 3, ht: 5.6, cost: { stone: 40, brick: 20, iron: 4, gold: 20 }, hp: 320, lvl: 3, time: 24, slots: { priest: 2 }, desc: 'Trains 2 Pujari, who heal villagers and collect offerings.' },
  // made by joining two of the same building side by side (not built directly)
  bighouse:  { name: 'Bada Ghar', en: 'Big House', fw: 4, fd: 2, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts).' },
  bighouseV: { name: 'Bada Ghar', en: 'Big House', fw: 2, fd: 4, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, model: 'bighouse', desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts).' },
  bigfield:  { name: 'Bada Khet', en: 'Big Field', fw: 6, fd: 3, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster.' },
  bigfieldV: { name: 'Bada Khet', en: 'Big Field', fw: 3, fd: 6, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, model: 'bigfield', desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster.' },
};
BUILDINGS.vaidyashala = { name: 'Vaidyashala', en: "Healer's Hut", fw: 2, fd: 2, ht: 2.0, cost: { wood: 25, food: 10 }, hp: 140, lvl: 1, time: 10, slots: { vaidya: 2 }, desc: 'Ayurvedic healer’s hut with a herb garden. Room for 2 Vaidya, who walk to the wounded and heal them. Also makes Aushadhi Potli kits: hand one to a Sainik for a Chikitsak field medic.' };
const BUILD_ORDER = ['hut', 'woodcamp', 'minecamp', 'buildyard', 'field', 'store', 'claypit', 'kiln', 'vaidyashala', 'palisade', 'akhara', 'smelter', 'range', 'well', 'bazaar', 'lamp', 'forge', 'sawmill', 'wall', 'tower', 'belltower', 'temple', 'firetower', 'cannontower'];

/*
 * Building levels. Every building except walls can be upgraded twice (the Lohar and Aara Mill keep their
 * own levels that unlock weapons). Each level: +40% strength, a better-looking model, and a perk for its job.
 */
const MAX_LEVEL = 3;
const STORE_BAYS = [0, 4, 6, 8];     // Bhandar bays per level; each bay holds one good the player picks
const BAY_CAP = [0, 30, 40, 50];     // how much one bay holds per level
const STOCK_MULT = [0, 1, 1.6, 2.3]; // storage multiplier for camps and fields per level
function levelPerk(type, lv) {
  const d = BUILDINGS[type], T = TOWERS[type];
  const bits = [];
  if (type === 'store') bits.push(`${STORE_BAYS[lv]} storage bays of ${BAY_CAP[lv]}`);
  else if (d.drop) bits.push(`${Math.round((STOCK_MULT[lv] - 1) * 100)}% more storage`);
  if (d.housing) bits.push(`room for ${d.housing + (lv - 1) * (d.housing > 3 ? 2 : 1)} villagers`);
  if (d.slots) { const k = Object.keys(d.slots)[0]; bits.push(`${k === 'army' ? 2 : 1} more ${k === 'army' ? 'soldier places' : JOBS[k] ? JOBS[k].name : 'worker'}`); }
  if (type === 'field' || type === 'bigfield' || type === 'bigfieldV') bits.push('crops grow 20% faster');
  if (type === 'well') bits.push('waters fields 2 steps further');
  if (type === 'lamp') bits.push('a wider, hotter holy light');
  if (type === 'vaidyashala') bits.push('Vaidya heal 30% faster');
  if (type === 'claypit' || type === 'kiln' || type === 'smelter') bits.push(`${Math.round(25 * (lv - 1))}% faster work`);
  if (T) bits.push('25% more damage and longer reach');
  bits.push('sturdier walls');
  return bits.join(', ');
}
/** Give every building without its own levels the standard two upgrades (run once, at the end of this file). */
function initBuildingLevels() { for (const type in BUILDINGS) {
  const d = BUILDINGS[type];
  if (d.levels || d.wall) continue;
  // level 2 is built with bricks, level 3 with bricks and iron (only the basic goods of the cost are scaled up)
  const size = d.fw * d.fd;
  const base = (k) => { const c = {}; for (const r in d.cost) if (!RES[r].mat) c[r] = Math.ceil((d.cost[r] * k) / 5) * 5; return c; };
  d.levels = [null, null,
    // work-seconds for one person: a Mistri alone needs about a minute for level 2; more hands finish sooner
    { cost: Object.assign(base(1.1), { brick: Math.max(6, Math.round(size * 2.5)) }), time: Math.round(30 + d.time * 2), unlocks: levelPerk(type, 2), generic: true },
    { cost: Object.assign(base(1.5), { brick: Math.max(8, Math.round(size * 3.5)), iron: Math.max(3, Math.round(size * 1.2)), gold: 10 }), time: Math.round(50 + d.time * 3), unlocks: levelPerk(type, 3), generic: true }];
} }
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
  axe:      { name: 'Loha Kulhadi', en: 'Iron Axes',     at: 'forge',   lvl: 1, cost: { iron: 6, gold: 8 },  desc: 'Woodcutters chop 60% faster.' },
  pick:     { name: 'Loha Gainti',  en: 'Iron Pickaxes', at: 'forge',   lvl: 1, cost: { iron: 6, wood: 10, gold: 6 },  desc: 'Miners and clay diggers dig 60% faster.' },
  plough:   { name: 'Loha Hal',     en: 'Iron Ploughs',  at: 'forge',   lvl: 1, cost: { iron: 8, wood: 20, gold: 10 },  desc: 'Each harvest gives 50% more grain.' },
  talwar:   { name: 'Talwar',       en: 'Steel Swords',  at: 'forge',   lvl: 2, cost: { iron: 15, charcoal: 10, gold: 20 }, desc: 'Sainik deal 60% more damage, +30 HP.' },
  kavach:   { name: 'Kavach',       en: 'Armour',        at: 'forge',   lvl: 3, cost: { iron: 30, gold: 30 }, desc: 'All fighters take 35% less damage.' },
  bow:      { name: 'Baans Dhanush', en: 'Longbows',     at: 'sawmill', lvl: 2, cost: { wood: 40, gold: 28 },  desc: 'Archers deal 50% more damage and shoot further.' },
  agnibaan: { name: 'Agni Baan',    en: 'Fire Arrows',   at: 'sawmill', lvl: 3, cost: { wood: 30, charcoal: 20, iron: 6, gold: 30 },  desc: 'Archer and tower arrows set demons on fire.' },
};
const UPGRADE_ORDER = ['axe', 'pick', 'plough', 'talwar', 'kavach', 'bow', 'agnibaan'];

/* ---------------- Agnikund (sacred fire) levels ---------------- */
const FIRE_LEVELS = [
  null,
  { radius: 10,  hp: 300,  housing: 4, fuelMax: 30, burn: 0.065, light: 15, cost: null },
  // level 2 needs bricks; level 3 and beyond need iron as well
  { radius: 13,  hp: 450,  housing: 5, fuelMax: 40, burn: 0.085, light: 18, cost: { wood: 70, stone: 30, brick: 20 } },
  { radius: 16.5, hp: 650, housing: 6, fuelMax: 50, burn: 0.10,  light: 21, cost: { wood: 120, stone: 80, brick: 40, iron: 15, gold: 35 } },
  { radius: 20,  hp: 900,  housing: 7, fuelMax: 60, burn: 0.12,  light: 24, cost: { wood: 200, stone: 140, brick: 70, iron: 35, gold: 90 } },
  { radius: 24,  hp: 1200, housing: 8, fuelMax: 70, burn: 0.14,  light: 27, cost: { wood: 300, stone: 220, brick: 100, iron: 60, gold: 170 } },
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

initBuildingLevels(); // every building type now has upgrade levels
