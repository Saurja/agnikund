'use strict';
/* =========================================================
   AGNIKUND — Village of the Sacred Flame
   Core constants, helpers and game data tables
   ========================================================= */

/** Shown on the title screen and in the pause menu. Bump with each release. */
const GAME_VERSION = '1.14.0';
const VIEW_H = 270;           // internal (pixel-art) resolution height
const GROUND_Y = 208;       // screen-space y of the ground surface
const WORLD_MIN = -2600, WORLD_MAX = 2600;
const DAY_LEN = 220;          // seconds in one full day/night cycle
const DUSK_T = 140;           // work ends, villagers head to the fire
const NIGHT_T = 156;          // demons arrive
const DAWN_T = 212;           // sunrise — demons burn away
const GRAV = 230;
const WIN_DAY = Infinity;     // endless: there is no last night (see the moon calendar)

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
  bigfield: { food: 50 }, bigfieldV: { food: 50 }, vishalkhet: { food: 100 },
  fishhut: { food: 30 },
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
  idle:    { name: 'Aaram',      en: 'Idle',       desc: 'Lends a hand on building sites and upgrades at a third of a Mistri’s speed. Repairs, and anything of stone, brick and iron, need a trained Mistri. Rests by the Agnikund when there is nothing to build.' },
  // every job works from a building; `building` is the one to build for more places
  wood:    { name: 'Lakadhara',  en: 'Woodcutter', tool: 'axe',    desc: 'Chops trees near their Lakdi Taal. The fire eats wood!', building: 'woodcamp' },
  stone:   { name: 'Khanik',     en: 'Miner',      tool: 'pick',   desc: 'Breaks rocks near their Khadaan. Sometimes finds gold.', building: 'minecamp' },
  farm:    { name: 'Kisan',      en: 'Farmer',     tool: 'sickle', desc: 'Grows grain on a Khet.', building: 'field' },
  fish:    { name: 'Machhuara',  en: 'Fisher',     tool: 'rod',    desc: 'Sits on the bank of the pond by a Machhli Ghat with a bamboo rod, and brings the catch back as food.', building: 'fishhut' },
  build:   { name: 'Mistri',     en: 'Builder',    tool: 'hammer', desc: 'Builds three times as fast as an idle helper, is the only one who repairs (at night too, when no demon is near), and must lead every level 3 building and level 3 upgrade. The Agnikund has room for 2; a Mistri Adda adds more.', building: 'buildyard' },
  clay:    { name: 'Beldar',     en: 'Clay Digger', tool: 'spade', desc: 'Digs wet clay at a Mitti Khaan. The Eent Bhatta fires it into bricks.', building: 'claypit' },
  kiln:    { name: 'Kumhar',     en: 'Kiln Worker', tool: 'mould', desc: 'Brings clay and wood to the Eent Bhatta and fires bricks, or burns wood into charcoal.', building: 'kiln' },
  smelt:   { name: 'Agariya',    en: 'Smelter',     tool: 'tongs', desc: 'Brings iron ore and charcoal to the Loha Bhatti and smelts iron.', building: 'smelter' },
  vaidya:  { name: 'Vaidya',     en: 'Healer',     tool: 'herbs',  desc: 'Walks to wounded villagers and soldiers and heals them with herbal medicine. Works from a Vaidyashala.', building: 'vaidyashala' },
  // soldiers: train a plain Sainik first, then hand them a crafted weapon to make a special soldier
  warrior: { name: 'Sainik',     en: 'Foot Soldier', tool: 'sword', desc: 'Foot soldier with a sword. Give a Sainik a crafted weapon to turn them into a special soldier.', building: 'akhara', slot: 'army' },
  brute:   { name: 'Gadadhari',  en: 'Mace Brute', tool: 'gada',   desc: 'A Sainik given a Gada: huge health, smashes groups of demons and knocks them back.', building: 'akhara', slot: 'army', weapon: 'gada' },
  spear:   { name: 'Bhaladhari', en: 'Spearman',   tool: 'spear',  desc: 'A Sainik given a Bhala: long reach and double damage against giant Danav and Mahasura.', building: 'akhara', slot: 'army', weapon: 'bhala' },
  archer:  { name: 'Dhanurdhar', en: 'Archer',     tool: 'bow',    desc: 'Trained at a Dhanush Shala with a plain bow: shoots demons from behind the walls. Hand a Dhanurdhar a Lamba Dhanush or Chakrams for a longbowman or a chakram thrower.', building: 'range', slot: 'army' },
  medic:   { name: 'Chikitsak',  en: 'Field Medic', tool: 'potli', desc: 'A Sainik given an Aushadhi Potli (medicine kit): follows the soldiers into battle and heals the wounded, and now and then pours healing over everyone nearby.', building: 'akhara', slot: 'army', weapon: 'potli' },
  khadgi:  { name: 'Khadgadhari', en: 'Broadsword Fighter', tool: 'khanda', desc: 'A Sainik given a Khanda, the broad double-edged sword: every swing cleaves through all the demons in front of them.', building: 'akhara', slot: 'army', weapon: 'khanda' },
  urumi:   { name: 'Urumidhari',  en: 'Whip-sword Fighter', tool: 'urumi',  desc: 'A Sainik given an Urumi, the flexible whip-sword of Kalaripayattu: lashes demons from two steps away, several at once.', building: 'akhara', slot: 'army', weapon: 'urumi' },
  longbow: { name: 'Dirghadhanvi', en: 'Longbowman',       tool: 'longbow', desc: 'A Dhanurdhar given a Lamba Dhanush, the great longbow: shoots further than any archer, and the heavy arrows pass through a line of demons.', building: 'range', slot: 'army', weapon: 'longbow' },
  chakri:  { name: 'Chakri',       en: 'Chakram Thrower',  tool: 'chakram', desc: 'A Dhanurdhar given steel Chakrams: throws razor rings that bounce from demon to demon and fly back to the hand.', building: 'range', slot: 'army', weapon: 'chakram' },
  priest:  { name: 'Pujari',     en: 'Priest',     tool: 'thali',  desc: 'Heals nearby villagers, earns temple offerings.', building: 'temple' },
  trader:  { name: 'Vyapari',    en: 'Trader',     tool: 'sack',   desc: 'Sells grain for gold at the Bazaar.', building: 'bazaar' },
};
const AGNI_SLOTS = { build: 2 }; // work places the Agnikund itself provides
const JOB_ORDER = ['wood', 'stone', 'farm', 'fish', 'clay', 'kiln', 'smelt', 'build', 'vaidya', 'warrior', 'brute', 'spear', 'khadgi', 'urumi', 'archer', 'longbow', 'chakri', 'medic', 'priest', 'trader'];
/** Soldiers who fight from a distance (they hold the second line, behind the melee fighters). */
const RANGED_JOBS = new Set(['archer', 'longbow', 'chakri', 'medic']);
const slotKey = (job) => (JOBS[job] && JOBS[job].slot) || job;
// fighting stats per soldier type
const SOLDIERS = {
  warrior: { hp: 80,  dmg: 10, cd: 0.85, reach: 0.75, speed: 1 },
  brute:   { hp: 140, dmg: 17, cd: 1.35, reach: 0.9,  speed: 0.85, splash: 1.0, knock: 0.55 },
  spear:   { hp: 90,  dmg: 9,  cd: 0.9,  reach: 1.55, speed: 1, bigBonus: 2 },
  medic:   { hp: 60, heal: 9 },
  khadgi:  { hp: 110, dmg: 13, cd: 1.05, reach: 0.95, speed: 0.95, arc: 1.25 },
  urumi:   { hp: 75,  dmg: 7,  cd: 0.8,  reach: 1.9,  speed: 1.05, arc: 1.6, maxHit: 3 },
  longbow: { hp: 52,  dmg: 11, cd: 2.0,  range: 14, pierce: 3 },
  chakri:  { hp: 58,  dmg: 8,  cd: 1.15, range: 7.5, bounce: 3 },
  archer:  { hp: 48, dmg: 6, cd: 1.35, range: 10 },
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
  khadgi:  { atk: ['cleave', 'cleave'],      crit: 0.15,             ability: { key: 'sunder', name: 'Dvidha Vaar',   en: 'Splitting Blow', cd: 9,  desc: 'an overhead blow that splits one demon and throws back the rest' } },
  urumi:   { atk: ['lash', 'lash', 'lash'],  crit: 0.12,             ability: { key: 'coil',   name: 'Kalari Chakra', en: 'Coiling Spin',  cd: 8,  desc: 'spins the whip-sword round, cutting and slowing every demon near' } },
  longbow: {                                 crit: 0.2,              ability: { key: 'pierce', name: 'Bhedi Baan',    en: 'Piercing Shot', cd: 8,  desc: 'a heavy arrow through a whole line of demons' } },
  chakri:  {                                 crit: 0.12,             ability: { key: 'ricochet', name: 'Chakra Bhram', en: 'Ricochet',     cd: 7,  desc: 'a chakram that bounces through six demons' } },
};
const SWINGS = { // dur: seconds per swing, hit: fraction of it when the blow lands
  slash: { dur: 0.4, hit: 0.5 }, thrust: { dur: 0.45, hit: 0.5 }, smash: { dur: 0.75, hit: 0.6 },
  bash: { dur: 0.42, hit: 0.45 }, slam: { dur: 1.0, hit: 0.62 }, lunge: { dur: 0.6, hit: 0.42 },
  shoot: { dur: 0.5, hit: 0.7 }, volley: { dur: 0.8, hit: 0.65 }, pulse: { dur: 0.7, hit: 0.5 },
  // ultimates (hits: several blows in one move)
  whirl: { dur: 1.05, hit: 0.25, hits: [0.25, 0.55, 0.85] }, leap: { dur: 1.0, hit: 0.72 }, barrage: { dur: 1.2, hit: 0.22, hits: [0.22, 0.5, 0.8] },
  astra: { dur: 0.9, hit: 0.72 }, sanjeevani: { dur: 1.0, hit: 0.55 },
  cleave: { dur: 0.55, hit: 0.55 }, sunder: { dur: 0.85, hit: 0.62 }, lash: { dur: 0.5, hit: 0.5 }, coil: { dur: 0.8, hit: 0.3, hits: [0.3, 0.65] },
  throw: { dur: 0.5, hit: 0.55 }, ricochet: { dur: 0.6, hit: 0.55 }, pierce: { dur: 0.9, hit: 0.75 },
  storm: { dur: 1.3, hit: 0.25, hits: [0.25, 0.55, 0.85] }, serpent: { dur: 1.4, hit: 0.2, hits: [0.2, 0.42, 0.64, 0.86] }, rain: { dur: 1.0, hit: 0.7 }, fan: { dur: 0.8, hit: 0.55 },
};
/*
 * Shakti: every fighter's power bar fills as they land blows, take hits and heal. When it is full they
 * call their ultimate at the next good moment.
 */
const SHAKTI = { hit: 6, struck: 4, arrow: 4, healPerSec: 7, pulse: 12 };
const ULTIMATES = {
  warrior: { key: 'whirl',      name: 'Veer Chakra',    en: "Hero's Wheel",   desc: 'spins through every demon around, three times' },
  brute:   { key: 'leap',       name: 'Hanuman Kudaan', en: "Hanuman's Leap", desc: 'leaps into the thick of them and shatters the ground' },
  spear:   { key: 'barrage',    name: 'Trishul Varsha', en: 'Trident Storm',  desc: 'three lunges in a row, each through a line of demons' },
  archer:  { key: 'astra',      name: 'Agni Astra',     en: 'Fire Weapon',    desc: 'a blazing arrow that bursts into a sea of flame' },
  medic:   { key: 'sanjeevani', name: 'Sanjeevani',     en: 'Herb of Life',   desc: 'heals everyone nearby to full' },
  khadgi:  { key: 'storm',   name: 'Shamsher Toofan', en: 'Sword Storm',     desc: 'three great cleaves, stepping forward through the demons' },
  urumi:   { key: 'serpent', name: 'Sarpa Nritya',    en: 'Serpent Dance',   desc: 'four whirling lashes that reach far round them' },
  longbow: { key: 'rain',    name: 'Shara Varsha',    en: 'Shower of Arrows', desc: 'a dozen arrows fall over the thickest knot of demons' },
  chakri:  { key: 'fan',     name: 'Chakra Toofan',   en: 'Ring Storm',      desc: 'five chakrams at once, each bouncing through three demons' },
};
/*
 * Power moves for the stronger demons, used between ordinary blows. cd: seconds between uses, wind:
 * how long they telegraph it, range: how near a target must be.
 */
const DEMON_POWERS = {
  rakshasa:    { key: 'roar',    name: 'Garjan',       en: 'War Roar',      cd: 14, wind: 0.7, range: 5,  desc: 'roars: nearby demons rage, nearby fighters stagger' },
  danav:       { key: 'boulder', name: 'Shila Prahaar', en: 'Boulder Throw', cd: 11, wind: 0.9, range: 9,  desc: 'hurls a boulder from afar' },
  skondhokata: { key: 'nova',    name: 'Bhoot-agun',   en: 'Ghost Fire',    cd: 12, wind: 0.8, range: 2.6, desc: 'bursts with blue ghost-fire' },
  boss:        { key: 'charge',  name: 'Mahish Dhakka', en: 'Buffalo Charge', cd: 15, wind: 1.0, range: 9, desc: 'charges through everything in his path' },
  mamdo:       { key: 'grab',    name: 'Ghaar Motkano', en: 'Neck Twist',   cd: 9,  wind: 0,   range: 1.1, desc: 'seizes someone and twists their neck' },
};
DEMON_POWERS.bakasura = { key: 'roar', name: 'Bhookh Garjan', en: 'Hunger Roar', cd: 16, wind: 0.9, range: 6, desc: 'bellows with hunger: demons nearby rage, fighters stagger' };
DEMON_POWERS.raktabija = { key: 'bleed', name: 'Rakta Varsha', en: 'Rain of Blood', cd: 18, wind: 0.9, range: 7, desc: 'sprays his blood: each drop rises as a demon' };
DEMON_POWERS.kalanemi = { key: 'maya', name: 'Maya Jaal', en: 'Web of Illusion', cd: 15, wind: 0.6, range: 12, desc: 'vanishes and leaves false copies of himself' };
const BOSS_SUMMON = { cd: 26, name: 'Asura Sena', en: 'Demon Host' };
/*
 * Boss nights. Each great asura comes on his own night (and, after the fifteenth, they return in turn
 * every fourth night). On his day the land itself warns of him, more clearly as the day goes on (see tickOmen).
 */
/*
 * The moon calendar (the game never ends: keep the flame alive as long as you can). Every 7th night the
 * moon is full (Purnima) and one of the lesser great asuras comes, in turn; every 15th night the moon
 * rises red (Rakt Chandra) and Mahasura himself comes, which outranks a full moon on the same night.
 * Deepavali falls on the new moon (Amavasya), halfway between full moons.
 */
const FULL_MOON_EVERY = 7, RED_MOON_EVERY = 15;
const SMALL_BOSSES = ['bakasura', 'raktabija', 'kalanemi'];
function moonOf(d) {
  if (d % RED_MOON_EVERY === 0) return 'red';
  if (d % FULL_MOON_EVERY === 0) return 'full';
  if (d % FULL_MOON_EVERY === 4) return 'new';
  return (d % FULL_MOON_EVERY) < 4 ? 'waning' : 'waxing'; // shrinking after the full moon, growing after the new
}
/** How far through the month the moon is, 0 new … 0.5 full … 1 new again (for drawing its phase). */
function moonPhase(d) { return ((d % FULL_MOON_EVERY) / FULL_MOON_EVERY + 0.5) % 1; }
/** The next night (from day d on) with a full or a red moon. */
function nextMoonNight(d, kind) { for (let k = d; k < d + 200; k++) { const m = moonOf(k); if (kind === 'red' ? m === 'red' : m === 'full' || m === 'red') return k; } return d; }
function bossForDay(d) {
  const m = moonOf(d);
  if (m === 'red') return 'boss';
  if (m === 'full') return SMALL_BOSSES[(Math.floor(d / FULL_MOON_EVERY) - 1) % SMALL_BOSSES.length]; // in turn: Bakasura, Raktabija, Kalanemi
  return null;
}
const OMENS = {
  bakasura:  { sign: 'The crows have gone quiet. A great flock circles over the forest and will not settle, and the cattle will not graze.', counter: 'He hunts grain: guard the grain heap by the fire and the stores, and keep fighters near the food.', kind: 'crows', smoke: 0xb89c70 },
  raktabija: { sign: 'The sky has a red tinge this morning, and the water in the wells looks dark, like old blood.', counter: 'Fire scorches his blood before it falls: Agni Burj towers, Agni Baan arrows and fire pots stop new demons rising.', kind: 'blood', smoke: 0xc0303a },
  kalanemi:  { sign: 'A strange violet mist hangs among the trees, and people swear they saw someone standing at the forest edge who was not there.', counter: 'His copies burst at the first blow: archers, chakrams and towers clear them fast, and the real one soon shows himself again.', kind: 'mist', smoke: 0xa486e0 },
  boss:      { sign: 'The ground trembled at dawn, and the Agnikund’s flame shrank back as if afraid.', counter: 'His charge breaks through walls: gather every fighter where he comes, and Bhaladhari deal double damage to him.', kind: 'quake', smoke: 0x8a7a76 },
};
/* ---------------- Weapons (crafted, kept in the armoury) ---------------- */
const WEAPONS = {
  gada:    { name: 'Gada',    en: 'Mace',  at: 'forge',   lvl: 1, cost: { iron: 3, stone: 4, gold: 2 }, job: 'brute' },
  // (archers no longer need a crafted Dhanush: the Dhanush Shala trains them with a plain bow)
  bhala:   { name: 'Bhala',   en: 'Spear', at: 'sawmill', lvl: 2, cost: { wood: 10, iron: 2 }, job: 'spear' },
  potli:   { name: 'Aushadhi Potli', en: 'Medicine Kit', at: 'vaidyashala', lvl: 1, cost: { food: 10, wood: 4 }, job: 'medic' },
  khanda:  { name: 'Khanda',  en: 'Broadsword',  at: 'forge',   lvl: 2, cost: { iron: 6, charcoal: 4, gold: 4 }, job: 'khadgi' },
  urumi:   { name: 'Urumi',   en: 'Whip-sword',  at: 'forge',   lvl: 3, cost: { iron: 8, gold: 8 }, job: 'urumi' },
  longbow: { name: 'Lamba Dhanush', en: 'Longbow', at: 'sawmill', lvl: 2, cost: { wood: 22, iron: 2 }, job: 'longbow', base: 'archer' },
  chakram: { name: 'Chakram', en: 'Throwing Rings', at: 'forge', lvl: 2, cost: { iron: 4, gold: 3 }, job: 'chakri', base: 'archer' },
};
const WEAPON_ORDER = ['gada', 'khanda', 'urumi', 'bhala', 'potli', 'longbow', 'chakram'];
/*
 * Armour, forged at the Lohar and kept in the armoury like the weapons. Each tier needs a higher Lohar
 * level. Any soldier can wear one piece: it takes a share off every blow (def) and adds health (hp).
 * Fit it from a soldier's panel, or let the Lohar fit the best armour to everyone at once.
 */
const ARMOURS = {
  chamda: { name: 'Chamda Kavach', en: 'Leather Armour', tier: 1, lvl: 1, cost: { wood: 6, food: 8, gold: 4 }, def: 0.15, hp: 10, desc: 'Hardened buffalo-hide jerkin and shoulder guards.' },
  zirah:  { name: 'Zirah Bakhtar', en: 'Chainmail',      tier: 2, lvl: 2, cost: { iron: 6, charcoal: 3, gold: 6 }, def: 0.27, hp: 20, desc: 'A shirt of riveted iron rings over a padded coat, with steel shoulders.' },
  kavach: { name: 'Char-aina',     en: 'Steel Plate',    tier: 3, lvl: 3, cost: { iron: 12, charcoal: 6, gold: 12 }, def: 0.4, hp: 35, desc: 'The "four mirrors": polished steel plates over mail, a spiked khud helmet and bracers.' },
};
const ARMOUR_ORDER = ['chamda', 'zirah', 'kavach'];
/** Who a weapon is handed to: melee weapons and kits to a Sainik, ranged ones to a Dhanurdhar. */
const weaponBase = (w) => (WEAPONS[w] && WEAPONS[w].base) || 'warrior';

/* ---------------- Buildings ---------------- */
// fw × fd = footprint in grid cells, ht = model height (for bars and selection)
const BUILDINGS = {
  hut:      { name: 'Jhopdi',        en: 'Hut',           fw: 2, fd: 2, ht: 2.2, cost: { wood: 20 },                      hp: 120, lvl: 1, time: 12, housing: 3, merge: 'bighouse', desc: 'Mud cottage with a steep thatched roof. Houses 3 villagers. Build two side by side and they join into a Bada Ghar; two Bada Ghar side by side become a Haveli.' },
  woodcamp: { name: 'Lakdi Taal',    en: 'Woodcutter Camp', fw: 2, fd: 2, ht: 1.9, cost: { wood: 15 },                    hp: 150, lvl: 1, time: 8, slots: { wood: 3 }, drop: ['wood'], desc: 'Timber yard for 3 Lakadhara. They chop the trees nearest the camp and drop wood here.' },
  minecamp: { name: 'Khadaan',       en: 'Mining Camp',   fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 150, lvl: 1, time: 10, slots: { stone: 3 }, drop: ['stone', 'gold', 'ore'], desc: 'Stone camp for 3 Khanik. Build it next to boulders; miners drop stone here. From Agnikund level 2 it can dig iron ore from the rusty boulders instead.' },
  buildyard: { name: 'Mistri Adda',  en: "Builders' Yard", fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                     hp: 150, lvl: 1, time: 10, slots: { build: 3 }, desc: 'Workshop for 3 more Mistri (builders).' },
  field:    { name: 'Khet',          en: 'Field',         fw: 3, fd: 3, ht: 0.8, cost: { wood: 15 },                      hp: 80,  lvl: 1, time: 8,  slots: { farm: 2 }, merge: 'bigfield', drop: ['food'], desc: 'Farmland for 2 Kisan (farmers). Two fields side by side join into a Bada Khet.' },
  palisade: { name: 'Baans ki Baad', en: 'Bamboo Wall',   fw: 1, fd: 1, ht: 1.5, cost: { wood: 6 },                       hp: 220, lvl: 1, time: 3,  wall: true, desc: 'Blocks demons. Click and drag to build a whole line of wall.' },
  akhara:   { name: 'Akhara',        en: 'Training Pit',  fw: 4, fd: 4, ht: 2.4, cost: { wood: 30, stone: 12 },           hp: 170, lvl: 1, time: 16, slots: { army: 3 }, desc: 'Wrestling pit with a mallakhamb. Room for 3 soldiers. Train Sainik here, then arm them at the Lohar or Aara Mill.' },
  store:    { name: 'Bhandar',       en: 'Storehouse',    fw: 2, fd: 2, ht: 1.8, cost: { wood: 25 },                      hp: 140, lvl: 1, time: 10, drop: RES_ORDER.slice(), desc: 'Storehouse with 4 bays. Pick the good each bay holds; goods with no bay need another Bhandar. Upgrades add bays (6, then 8).' },
  // the materials chain: clay pit and brick kiln from the start, the iron smelter from Agnikund level 2
  claypit:  { name: 'Mitti Khaan',   en: 'Clay Pit',      fw: 2, fd: 2, ht: 1.1, cost: { wood: 20 },                      hp: 120, lvl: 1, time: 8,  slots: { clay: 2 }, drop: ['clay'], desc: 'A pit of wet clay. 2 Beldar dig here and stack the clay beside it.' },
  kiln:     { name: 'Eent Bhatta',   en: 'Brick Kiln',    fw: 2, fd: 2, ht: 3.0, cost: { wood: 30, stone: 15 },           hp: 170, lvl: 1, time: 12, slots: { kiln: 2 }, drop: ['brick', 'charcoal'], recipes: ['auto', 'brick', 'charcoal'], desc: '2 Kumhar fire clay and wood into bricks, or slow-burn wood into charcoal for the smelter.' },
  smelter:  { name: 'Loha Bhatti',   en: 'Iron Smelter',  fw: 2, fd: 2, ht: 2.5, cost: { brick: 20, stone: 15, wood: 10 }, hp: 200, lvl: 2, time: 16, slots: { smelt: 2 }, drop: ['iron'], recipes: ['iron'], desc: 'A clay shaft furnace with leather bellows. 2 Agariya smelt iron ore with charcoal into iron.' },
  range:    { name: 'Dhanush Shala', en: 'Archery Range', fw: 4, fd: 3, ht: 1.6, cost: { wood: 25, brick: 10 },           hp: 150, lvl: 2, time: 14, slots: { army: 3 }, desc: 'Archery range that trains Dhanurdhar (archers) straight away, room for 3. Longbowmen and chakram throwers practise here too.' },
  well:     { name: 'Kuan',          en: 'Well',          fw: 2, fd: 2, ht: 1.8, cost: { stone: 10, brick: 12 },          hp: 160, lvl: 2, time: 10, desc: 'Fields within 9 steps grow 50% faster.' },
  bazaar:   { name: 'Bazaar',        en: 'Market',        fw: 3, fd: 2, ht: 1.9, cost: { wood: 30, brick: 15 },           hp: 150, lvl: 2, time: 16, slots: { trader: 2 }, desc: 'Spice stall. 2 Vyapari trade grain for gold.' },
  lamp:     { name: 'Deep Stambh',   en: 'Lamp Pillar',   fw: 1, fd: 1, ht: 2.7, cost: { stone: 10, brick: 6, gold: 5 },  hp: 140, lvl: 2, time: 8,  desc: 'Holy lamps light the night. Demons nearby are slowed and burn.' },
  forge:    { name: 'Lohar',         en: 'Blacksmith',    fw: 2, fd: 2, ht: 2.0, cost: { wood: 25, brick: 20, gold: 10 }, hp: 180, lvl: 2, time: 16, desc: 'Forges Gada maces for Gadadhari, iron tools, steel upgrades and armour for your soldiers.',
    levels: [null, null, { cost: { brick: 30, iron: 10, gold: 20 }, time: 62, unlocks: 'Talwar steel swords, Khanda, Chakrams and Zirah chainmail' }, { cost: { brick: 40, iron: 30, gold: 45 }, time: 98, unlocks: 'Urumi whip-swords and Char-aina steel plate armour' }] },
  sawmill:  { name: 'Aara Mill',     en: 'Sawmill',       fw: 3, fd: 2, ht: 2.1, cost: { wood: 35, brick: 10 },           hp: 180, lvl: 2, time: 14, desc: 'Saw pit and bow-maker. Crafts Dhanush bows for archers.',
    levels: [null, null, { cost: { wood: 50, brick: 20, gold: 15 }, time: 58, unlocks: 'Bhala spears for Bhaladhari, and Longbows' }, { cost: { wood: 70, brick: 30, iron: 15, gold: 35 }, time: 92, unlocks: 'Agni Baan fire arrows' }] },
  wall:     { name: 'Qila Deewar',   en: 'Fort Wall',     fw: 1, fd: 1, ht: 1.7, cost: { stone: 8, brick: 3 },            hp: 600, lvl: 3, time: 5,  wall: true, desc: 'Sandstone and brick fort wall, very sturdy. Click and drag to build a line.' },
  tower:    { name: 'Burj',          en: 'Arrow Tower',   fw: 2, fd: 2, ht: 4.9, cost: { wood: 20, brick: 25, iron: 6, gold: 10 }, hp: 320, lvl: 3, time: 18, desc: 'Chhatri watchtower. Shoots arrows at demons by itself. Claims a small circle of land round it: you can build there, even past the village edge.' },
  belltower: { name: 'Ghanta Burj',  en: 'Bell Tower',    fw: 2, fd: 2, ht: 4.4, cost: { wood: 20, brick: 25, iron: 10, gold: 15 }, hp: 300, lvl: 3, time: 18, desc: 'A great temple bell cast in iron. Demons within 7 steps are slowed and take 25% more damage. Claims a small circle of land round it: you can build there, even past the village edge.' },
  firetower: { name: 'Agni Burj',    en: 'Fire Tower',    fw: 2, fd: 2, ht: 4.6, cost: { brick: 40, iron: 12, charcoal: 15, gold: 30 }, hp: 360, lvl: 4, time: 22, desc: 'Hurls burning pots that splash fire over groups of demons. Claims a small circle of land round it: you can build there, even past the village edge.' },
  cannontower: { name: 'Tope Burj',  en: 'Cannon Tower',  fw: 2, fd: 2, ht: 3.6, cost: { stone: 40, brick: 40, iron: 30, gold: 40 }, hp: 520, lvl: 5, time: 26, desc: 'A heavy iron fort cannon. Slow, but every shot smashes even giant demons. Claims a small circle of land round it: you can build there, even past the village edge.' },
  temple:   { name: 'Mandir',        en: 'Temple',        fw: 3, fd: 3, ht: 5.6, cost: { stone: 40, brick: 20, iron: 4, gold: 20 }, hp: 320, lvl: 3, time: 24, slots: { priest: 2 }, desc: 'Trains 2 Pujari, who heal villagers and collect offerings.' },
  // made by joining two of the same building side by side (not built directly)
  bighouse:  { name: 'Bada Ghar', en: 'Big House', fw: 4, fd: 2, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, merge: 'haveli', desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts). Two Bada Ghar side by side become a Haveli.' },
  bighouseV: { name: 'Bada Ghar', en: 'Big House', fw: 2, fd: 4, ht: 2.4, cost: { wood: 40 }, hp: 280, lvl: 1, time: 1, housing: 7, joined: true, merge: 'haveli', model: 'bighouse', desc: 'Two Jhopdis joined into one family house. Homes 7 villagers (one more than two huts). Two Bada Ghar side by side become a Haveli.' },
  bigfield:  { name: 'Bada Khet', en: 'Big Field', fw: 6, fd: 3, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, merge: 'vishalkhet', desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster. Two Bada Khet side by side become a Vishal Khet.' },
  bigfieldV: { name: 'Bada Khet', en: 'Big Field', fw: 3, fd: 6, ht: 0.8, cost: { wood: 30 }, hp: 160, lvl: 1, time: 1, slots: { farm: 5 }, drop: ['food'], joined: true, merge: 'vishalkhet', model: 'bigfield', desc: 'Two fields joined into one. Room for 5 Kisan, and they work it 15% faster. Two Bada Khet side by side become a Vishal Khet.' },
  // and four: two joined buildings side by side make a square one
  haveli:     { name: 'Haveli', en: 'Mansion', fw: 4, fd: 4, ht: 3.3, cost: { wood: 80 }, hp: 620, lvl: 1, time: 1, housing: 16, joined: true, square: true, desc: 'Four Jhopdis grown into a two-storey haveli round a courtyard. Homes 16 villagers (four more than four huts), and its walls are very strong.' },
  vishalkhet: { name: 'Vishal Khet', en: 'Great Field', fw: 6, fd: 6, ht: 0.8, cost: { wood: 60 }, hp: 300, lvl: 1, time: 1, slots: { farm: 11 }, drop: ['food'], joined: true, square: true, desc: 'Four fields joined into one great field with a well-fed irrigation channel. Room for 11 Kisan, and they work it 30% faster.' },
  // fishing: a hut on the bank of a pond (see game.js ponds)
  fishhut:    { name: 'Machhli Ghat', en: 'Fishing Hut', fw: 2, fd: 2, ht: 2.0, cost: { wood: 20 }, hp: 130, lvl: 1, time: 9, slots: { fish: 2 }, drop: ['food'], pond: true, desc: 'A fisher’s hut with a little jetty, built on the bank of a pond. 2 Machhuare catch fish there and keep the catch here as food. Must touch a pond.' },
};
// roads: laid at once along a dragged line, no builder needed; people walk faster on them (road = speed factor)
BUILDINGS.path = { name: 'Kachcha Rasta', en: 'Dirt Path', fw: 1, fd: 1, ht: 0.05, cost: { stone: 1 }, hp: 400, lvl: 1, time: 1, line: true, road: 1.25, instant: true, desc: 'A beaten earth path edged with stones. Villagers walk a quarter faster on it and take it when it saves them time. Buildings can go over it. Click and drag to lay a line.' };
BUILDINGS.road = { name: 'Pakki Sadak', en: 'Brick Road', fw: 1, fd: 1, ht: 0.06, cost: { brick: 1, stone: 1 }, hp: 600, lvl: 2, time: 1, line: true, road: 1.5, instant: true, desc: 'A paved road of fired brick between stone kerbs. Villagers move half again as fast on it. Buildings can go over it. Click and drag to lay a line.' };
BUILDINGS.palisade.line = true; BUILDINGS.wall.line = true;
BUILDINGS.vaidyashala = { name: 'Vaidyashala', en: "Healer's Hut", fw: 2, fd: 2, ht: 2.0, cost: { wood: 25, food: 10 }, hp: 140, lvl: 1, time: 10, slots: { vaidya: 2 }, desc: 'Ayurvedic healer’s hut with a herb garden. Room for 2 Vaidya, who walk to the wounded and heal them. Also makes Aushadhi Potli kits: hand one to a Sainik for a Chikitsak field medic.' };
const BUILD_ORDER = ['hut', 'woodcamp', 'minecamp', 'buildyard', 'field', 'fishhut', 'store', 'path', 'claypit', 'kiln', 'vaidyashala', 'palisade', 'akhara', 'smelter', 'range', 'road', 'well', 'bazaar', 'lamp', 'forge', 'sawmill', 'wall', 'tower', 'belltower', 'temple', 'firetower', 'cannontower'];

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
  if (isFieldType(type)) bits.push('crops grow 20% faster');
  if (type === 'fishhut') bits.push('fishers catch 25% faster');
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
  if (d.levels || d.wall || d.line) continue;
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
function jobOfBuilding(type) { const s = BUILDINGS[type].slots; if (!s) return null; const k = Object.keys(s)[0]; return k === 'army' ? (type === 'range' ? 'archer' : 'warrior') : k; } // the Dhanush Shala trains archers, the Akhara Sainik
const isHome = (type) => !!BUILDINGS[type].housing;
const isFieldType = (type) => type === 'field' || type === 'bigfield' || type === 'bigfieldV' || type === 'vishalkhet';
/** Flat ground anyone can cross and demons ignore: fields and roads. */
const isGround = (type) => isFieldType(type) || !!BUILDINGS[type].road;

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
  talwar:   { name: 'Talwar',       en: 'Steel Swords',  at: 'forge',   lvl: 2, cost: { iron: 15, charcoal: 10, gold: 20 }, desc: 'Steel for every blade: Sainik, Khadgadhari and Urumidhari deal 60% more damage, chakrams 30% more, and Sainik get +30 HP.' },
  bow:      { name: 'Shringa Dhanush', en: 'Horn Bows',  at: 'sawmill', lvl: 2, cost: { wood: 40, gold: 28 },  desc: 'Archers and longbowmen deal 50% more damage and shoot further.' },
  agnibaan: { name: 'Agni Baan',    en: 'Fire Arrows',   at: 'sawmill', lvl: 3, cost: { wood: 30, charcoal: 20, iron: 6, gold: 30 },  desc: 'Archer and tower arrows set demons on fire.' },
};
const UPGRADE_ORDER = ['axe', 'pick', 'plough', 'talwar', 'bow', 'agnibaan']; // (armour is forged piece by piece now: see ARMOURS)

/* ---------------- Agnikund (sacred fire) levels ---------------- */
const FIRE_LEVELS = [
  null,
  { radius: 11,  hp: 300,  housing: 4, fuelMax: 30, burn: 0.065, light: 15, cost: null },
  // level 2 needs bricks; level 3 and beyond need iron as well
  { radius: 14.5, hp: 450,  housing: 5, fuelMax: 40, burn: 0.085, light: 18, cost: { wood: 70, stone: 30, brick: 20 } },
  { radius: 18,  hp: 650, housing: 6, fuelMax: 50, burn: 0.10,  light: 21, cost: { wood: 120, stone: 80, brick: 40, iron: 15, gold: 35 } },
  { radius: 22,  hp: 900,  housing: 7, fuelMax: 60, burn: 0.12,  light: 24, cost: { wood: 200, stone: 140, brick: 70, iron: 35, gold: 90 } },
  { radius: 26.5, hp: 1200, housing: 8, fuelMax: 70, burn: 0.14,  light: 27, cost: { wood: 300, stone: 220, brick: 100, iron: 60, gold: 170 } },
];

/* ---------------- Demons ---------------- */
const ENEMIES = {
  // r = body radius, h = body height, scale = model scale (all in grid units)
  bhoot:    { name: 'Bhoot',    en: 'Ghost',         hp: 16,  dmg: 2.5, speed: 1.6,  atkCd: 1.0, gold: 1,  r: 0.35, h: 1.2, scale: 1,    reach: 0.75, cost: 1, ghost: true },
  rakshasa: { name: 'Rakshasa', en: 'Demon',         hp: 46,  dmg: 7,   speed: 1.2,  atkCd: 1.3, gold: 2,  r: 0.4,  h: 1.6, scale: 1,    reach: 0.85, cost: 2 },
  vetala:   { name: 'Vetala',   en: 'Flying Spirit', hp: 22,  dmg: 4,   speed: 2.2,  atkCd: 1.0, gold: 2,  r: 0.4,  h: 0.6, scale: 1,    reach: 0.8,  cost: 2, fly: true },
  danav:    { name: 'Danav',    en: 'Giant Demon',   hp: 150, dmg: 15,  speed: 0.85, atkCd: 1.8, gold: 6,  r: 0.6,  h: 2.3, scale: 1.45, reach: 1.15, cost: 6 },
  boss:     { name: 'Mahasura', en: 'Demon King',    hp: 500, dmg: 28,  speed: 0.7,  atkCd: 2.2, gold: 40, r: 0.95, h: 3.8, scale: 2.4,  reach: 1.7,  cost: 0, boss: true, summons: true },
  // more great asuras: each comes on its own night, foretold by an omen two days before (see BOSS_NIGHTS)
  bakasura:  { name: 'Bakasura',  en: 'Devourer of Grain',  hp: 560, dmg: 22, speed: 0.72, atkCd: 2.0, gold: 40, r: 0.95, h: 3.5, scale: 2.25, reach: 1.6, cost: 0, boss: true, devour: true },
  raktabija: { name: 'Raktabija', en: 'Blood-seed Asura',   hp: 520, dmg: 19, speed: 0.9,  atkCd: 1.6, gold: 40, r: 0.8,  h: 3.1, scale: 2.0,  reach: 1.4, cost: 0, boss: true, bloodseed: true },
  kalanemi:  { name: 'Kalanemi',  en: 'Lord of Illusions',  hp: 470, dmg: 17, speed: 1.0,  atkCd: 1.5, gold: 40, r: 0.72, h: 3.0, scale: 1.9,  reach: 1.3, cost: 0, boss: true, illusion: true, glow: 0xb48cff },
  rakta:     { name: 'Rakta Bindu', en: 'Blood-born Demon', hp: 20, dmg: 4,  speed: 1.7,  atkCd: 1.0, gold: 0,  r: 0.3,  h: 1.0, scale: 0.62, reach: 0.7, cost: 0, minion: true },
  // ghosts of Bengali folklore (bhoot-pret of Bangla tales)
  aleya:       { name: 'Aleya',       en: 'Marsh Light',     hp: 9,   dmg: 1.5, speed: 2.6,  atkCd: 0.9, gold: 1, r: 0.25, h: 0.5, scale: 1,    reach: 0.6,  cost: 2, fly: true, swarm: 3, glow: 0xd4ff7a, bengali: true, from: 2 },
  shakchunni:  { name: 'Shakchunni',  en: 'Bride Ghost',     hp: 30,  dmg: 4,   speed: 1.9,  atkCd: 1.0, gold: 2, r: 0.35, h: 1.4, scale: 1,    reach: 0.8,  cost: 2, ghost: true, float: true, drain: 0.6, glow: 0xffd6d6, bengali: true, from: 3 },
  mechho:      { name: 'Mechho Bhoot', en: 'Fish-thief Ghost', hp: 26, dmg: 2,  speed: 1.75, atkCd: 1.2, gold: 2, r: 0.35, h: 1.2, scale: 1,    reach: 0.75, cost: 2, ghost: true, thief: 'food', steal: 10, bengali: true, from: 3 },
  nishi:       { name: 'Nishi Dak',   en: 'Deadly Night Caller', hp: 40, dmg: 3, speed: 1.05, atkCd: 1.2, gold: 4, r: 0.35, h: 1.7, scale: 1,    reach: 0.8,  cost: 3, ghost: true, float: true, caller: true, glow: 0x9fb4ff, bengali: true, from: 5 },
  mamdo:       { name: 'Mamdo Bhoot', en: 'Neck-twister',    hp: 72,  dmg: 6,   speed: 1.4,  atkCd: 1.4, gold: 4, r: 0.38, h: 1.95, scale: 1.05, reach: 0.9, cost: 4, bengali: true, from: 6 },
  skondhokata: { name: 'Skondhokata', en: 'Headless Ghost',  hp: 110, dmg: 11,  speed: 0.95, atkCd: 1.5, gold: 4, r: 0.5,  h: 1.9, scale: 1.25, reach: 1.0,  cost: 4, wrecker: 2.2, bengali: true, from: 7 },
  // spirit beasts: animals that died wronged in the forest and came back hungry
  shiyal: { name: 'Shiyal Pret', en: 'Ghost Jackals',  hp: 14, dmg: 2.5, speed: 2.5,  atkCd: 0.8, gold: 1, r: 0.28, h: 0.6,  scale: 1,    reach: 0.6,  cost: 3, ghost: true, swarm: 3, glow: 0x9fe8c8, animal: true, from: 3 },
  naag:   { name: 'Naag Pret',   en: 'Ghost Cobra',    hp: 38, dmg: 4,   speed: 1.5,  atkCd: 1.1, gold: 2, r: 0.32, h: 1.0,  scale: 1.1,  reach: 0.9,  cost: 3, ghost: true, venom: { dps: 2.5, dur: 5 }, glow: 0x8affa0, animal: true, from: 4 },
  bagh:   { name: 'Bagh Bhoot',  en: 'Ghost Tiger',    hp: 70, dmg: 9,   speed: 1.9,  atkCd: 1.1, gold: 4, r: 0.45, h: 0.95, scale: 1.15, reach: 0.95, cost: 4, ghost: true, glow: 0xffb060, animal: true, from: 5 },
  shuar:  { name: 'Kanta Shuar', en: 'Thorn Boar',     hp: 95, dmg: 8,   speed: 1.15, atkCd: 1.4, gold: 4, r: 0.5,  h: 1.0,  scale: 1.2,  reach: 0.95, cost: 4, thorns: 0.3, wrecker: 1.8, animal: true, from: 6 },
};
DEMON_POWERS.bagh = { key: 'charge', name: 'Jhapat', en: 'Pounce', cd: 7, wind: 0.45, range: 6, dur: 0.4, speed: 11, dmg: 16, wreck: 0, desc: 'crouches low and pounces on someone from afar' };
DEMON_POWERS.shuar = { key: 'charge', name: 'Danta Dhakka', en: 'Tusk Charge', cd: 10, wind: 0.8, range: 8, dur: 0.7, speed: 8, dmg: 18, wreck: 80, desc: 'lowers its tusks and rushes, through walls if it must' };
/** One line of lore per demon, shown in the info panel and when it first appears. */
const ENEMY_LORE = {
  bhoot: 'A restless ghost. Weak, but it drifts straight for your people.',
  rakshasa: 'A horned demon with a spiked club. Smashes walls in its way.',
  vetala: 'A bat-winged spirit. Flies over walls and swoops on villagers — archers can hit it.',
  danav: 'A giant demon. Very tough and hits hard.',
  boss: 'Mahasura, the buffalo-horned Demon King. Gather every warrior!',
  bakasura: 'Bakasura, the giant of the old tale who made a village feed him a cartload of food every day. He lumbers straight for your grain heaps and stores and gorges himself, and every mouthful heals him. Keep him away from the food.',
  raktabija: 'Raktabija, the asura whose every drop of blood that touches the earth rises as another demon. Hard blows make him bleed new demons. Fire scorches his blood before it falls: burn him with fire pots and Agni Baan arrows, and kill him fast.',
  kalanemi: 'Kalanemi, the master of maya. Again and again he vanishes and leaves false copies of himself that fight like the real one. A copy bursts into smoke at the first blow; the real Kalanemi shows himself again a few moments later.',
  rakta: 'A demon sprung from a drop of Raktabija’s blood. Small and weak, but there are always more.',
  aleya: 'Ghost lights from the marshes that lead travellers astray. They drift in as a swarm over your walls, quick but frail.',
  shakchunni: 'The ghost of a married woman in a white saree with a red border and shell bangles. She drifts through walls, and every blow she lands heals her.',
  mechho: 'A fish-loving ghost from the ponds. He sneaks to your grain stores, steals what he can carry and runs for the forest. Kill him to get the grain back.',
  nishi: 'Nishi Dak, the deadly night caller, calls people by name in the voice of someone they love. Whoever answers her first or second call walks out to her, and if they reach her she takes their soul. Folk wisdom says answer only a third call. Click a called villager to hold them back; a Pujari, a Mandir or a soldier at their side also breaks her spell.',
  mamdo: 'In Bengali folk tales, the Mamdo Bhoot is the ghost of a man who died an unnatural death, said to be the restless spirit of a Muslim. Tall and bearded, it is feared for seizing people and twisting their necks. Strike or stun it hard to break its grip before it finishes.',
  skondhokata: 'A headless ghost that wanders the night. Huge and slow, he smashes walls and buildings twice as hard as a demon.',
  shiyal: 'Ghost jackals that howl at the edge of the village and hunt as a pack. Each one is frail, but they are quick, they slip round walls, and there are always three.',
  naag: 'The spirit of a cobra killed on its own path. It rears up and strikes, and its bite keeps poisoning for a few seconds after. Healers and the fire cure what it leaves behind.',
  bagh: 'The ghost of a man-eating tiger. It stalks in and crouches, then pounces on someone from several steps away; it glides round walls like any ghost.',
  shuar: 'A boar demon with a crest of bone spines. It charges straight through walls, and every blow struck at it up close pricks the striker on its thorns: archers and towers are the safe way to bring it down.',
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
