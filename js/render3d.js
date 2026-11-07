'use strict';
/* =========================================================
   Three.js renderer: island, sea, forest, buildings, units,
   day/night lighting, camera, picking and screen overlays.
   ========================================================= */

/* ---------- easing ---------- */
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
const easeOutBack = (x) => { x = clamp(x, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

/* ---------- time-of-day helpers ---------- */
function darknessAt(t) {
  if (t < 12) return lerp(0.7, 0, t / 12);
  if (t < DUSK_T - 4) return 0;
  if (t < NIGHT_T + 6) return lerp(0, 1, (t - (DUSK_T - 4)) / (NIGHT_T + 10 - DUSK_T));
  if (t < DAWN_T) return 1;
  return lerp(1, 0.7, (t - DAWN_T) / (DAY_LEN - DAWN_T));
}
function duskAmt(t) {
  if (t < 16) return 1 - t / 16;
  if (t > 126 && t < 142) return (t - 126) / 16;
  if (t >= 142 && t < 158) return 1 - (t - 142) / 16;
  if (t > 206) return (t - 206) / 14;
  return 0;
}
const _col = new THREE.Color(), _col2 = new THREE.Color();
/** Swap a mesh's geometry (and its outline twin's, when outlines are drawn). */
function setGeo(m, g) { m.geometry = g; for (const c of m.children) if (c.userData.outline) c.geometry = g; }
function lerpHex(a, b, t) { return _col.setHex(a).lerp(_col2.setHex(b), clamp(t, 0, 1)).getHex(); }

/**
 * Graphics tiers in one place.
 * pixelRatio: cap on screen pixels · lights: point lights for torches and lamps (each costs on every pixel)
 * lodDist: forest closer to the camera than this uses detailed trees, beyond it the light ones
 * farCull: leave the distant forest to the fog · post: occlusion, glow, colour grade
 */
const QUALITY = {
  low:  { pixelRatio: 1,    shadows: false, softShadows: false, shadowSize: 1024, lights: 2, decor: false, post: false, lodDist: -1, farCull: true },
  mid:  { pixelRatio: 1.25, shadows: true,  softShadows: false, shadowSize: 1024, lights: 4, decor: true,  post: false, lodDist: 22, farCull: false },
  high: { pixelRatio: 1.5,  shadows: true,  softShadows: true,  shadowSize: 2048, lights: 6, decor: true,  post: true,  lodDist: 28, farCull: false },
};

/** High graphics, final pass: a soft filmic contrast curve, a touch of warmth and a gentle vignette. */
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.55 }, uWarm: { value: 0.012 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uWarm; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.05);
      col += vec3(uWarm, uWarm * 0.5, -uWarm * 0.4) * (1.0 - l);
      vec2 d = vUv - 0.5;
      col *= 1.0 - dot(d, d) * uVig;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

function terrainBump(x, z) { return 0.22 * Math.sin(x * 0.31) * Math.cos(z * 0.27) + 0.14 * Math.sin(x * 0.11 + z * 0.13 + 1.7); }
function heightAt(x, z) {
  const r = Math.hypot(x, z), edge = islandR(x, z);
  const inland = clamp((r - 30) / 8, 0, 1);
  let h = terrainBump(x, z) * inland;
  if (r > edge - 3) h = lerp(h, -1.3, clamp((r - (edge - 3)) / 5, 0, 1));
  return h + pondDip(x, z);
}
/** Ponds sit in a soft basin: the ground dips under the water and rises back to the bank (0 elsewhere). */
function pondDip(x, z) {
  const ps = typeof S !== 'undefined' && S && S.ponds;
  if (!ps || !ps.length) return 0;
  let k = 0;
  for (const p of ps) { const dx = x - p.x, dz = z - p.z; if (Math.abs(dx) < p.r + 1 && Math.abs(dz) < p.r + 1) k = Math.max(k, clamp((p.r + 0.7 - Math.hypot(dx, dz)) / 1.3, 0, 1)); }
  return k ? -0.45 * k * k * (3 - 2 * k) : 0;
}

/* ---------- villager poses ----------
 * Joint values for the villager rig (see Models.villager). Angles in radians:
 *   armL, armR, legL, legR: shoulder / hip pitch, negative swings forward and up · armLz etc.: spread outward
 *   elb*: elbow bend (forearm forward) · knee*: knee bend (shin back) · lean: waist forward
 *   twist: chest turns toward the right (weapon) side · sway: hip roll · headX nod, headY look right
 *   toolR / toolL: where the tool in that hand points, measured from the body (0 forward, -π/2 up,
 *   +π/2 down) so a spear stays upright and a shield faces front whatever the arm does; or gripR /
 *   gripL: the wrist angle from the forearm, for swings where the blade follows the arm.
 *   lie: 0 standing … 1 lying on the side, asleep.
 */
const VJ_REST = { hipY: V_HIP, hipTw: 0, legL: 0, legR: 0, legLz: 0, legRz: 0, kneeL: 0.05, kneeR: 0.05, armL: 0.02, armR: -0.02, armLz: 0.07, armRz: 0.07, elbL: 0.15, elbR: 0.18, lean: 0, twist: 0, sway: 0, headX: 0, headY: 0, lie: 0, toolR: null, gripR: 0, toolL: null, gripL: 0 };
const VJ_EASE = ['hipY', 'hipTw', 'legL', 'legR', 'legLz', 'legRz', 'kneeL', 'kneeR', 'armL', 'armR', 'armLz', 'armRz', 'elbL', 'elbR', 'lean', 'twist', 'sway', 'headX', 'headY', 'lie', 'handR', 'handL'];
/** How each tool is carried when not in use (body-space pitch, and the arm that carries it). */
const TOOL_CARRY = {
  sword:  { toolR: 1.05 }, axe: { toolR: 1.25 }, pick: { toolR: 1.25 }, hammer: { toolR: 1.35 }, sickle: { toolR: 0.9 }, spade: { toolR: 1.3 },
  tongs:  { toolR: 1.1 }, mould: { toolR: 0, armR: -0.25, elbR: 0.7 }, sack: { toolR: 0 }, potli: { toolR: 0, armR: -0.2, elbR: 0.6 },
  thali:  { toolR: 0, armR: -0.45, elbR: 1.25 }, herbs: { toolR: 0, armR: -0.35, elbR: 1.1 },
  spear:  { toolR: -1.42, armR: -0.28, elbR: 0.95, armRz: 0.12 }, // upright at the side
  gada:   { toolR: -2.55, armR: -0.45, elbR: 2.15, armRz: 0.18 }, // resting on the shoulder
  khanda: { toolR: -2.4, armR: -0.4, elbR: 2.05, armRz: 0.16 }, // the broadsword on the shoulder
  urumi:  { toolR: 1.35 }, chakram: { toolR: 0, armR: -0.25, elbR: 0.7 },
  rod:    { toolR: -1.25, armR: -0.3, elbR: 0.9, armRz: 0.1 }, // the fishing rod held up at the side
};
const lerpN = (a, b, t) => a + (b - a) * t;
/** A work stroke: slow wind-up to 1 by h, a quick strike back to 0, then a short follow-through. */
function stroke(c, h) {
  if (c < h) return Math.sin((c / h) * Math.PI * 0.5);
  if (c < h + 0.13) return 1 - easeOutCubic((c - h) / 0.13);
  return 0;
}
function fightStance(v, t) {
  const b = Math.sin(t * 7 + v.id) * 0.01;
  const scan = Math.sin(t * 0.55 + v.id * 1.7), shift = Math.sin(t * 1.1 + v.id);
  const J = Object.assign({}, VJ_REST, { hipY: V_HIP - 0.04 + b, legL: -0.38, kneeL: 0.42 + shift * 0.06, legR: 0.3, kneeR: 0.38 - shift * 0.06, lean: 0.14, twist: 0.22 + shift * 0.05, sway: shift * 0.02, headY: -0.18 + scan * 0.3,
    armR: -0.75, armRz: 0.22, elbR: 1.25, toolR: -0.95, armL: -0.65, armLz: 0.05, elbL: 1.25, toolL: 0 });
  if (v.job === 'brute') Object.assign(J, { armR: -1.55, armL: -1.5, armRz: 0.05, armLz: -0.32, elbR: 1.15, elbL: 1.2, toolR: -2.1, toolL: null, gripL: 0, twist: 0.1 }); // the gada high in both hands
  else if (v.job === 'spear') Object.assign(J, { armR: -0.55, elbR: 0.75, armRz: 0.12, toolR: -0.12, twist: 0.32 }); // the bhala levelled over the dhaal
  else if (v.job === 'medic') Object.assign(J, { armR: -0.5, elbR: 1.0, toolR: 0, armL: -0.3, elbL: 0.8, toolL: null, twist: 0.05 });
  else if (v.job === 'archer' || v.job === 'longbow') Object.assign(J, { armL: -1.2, armLz: 0.55, elbL: 0.15, toolL: null, gripL: 0.15, armR: -1.0, armRz: -0.2, elbR: 1.6, toolR: null, gripR: 0, twist: 0.75, headY: -0.7, legL: -0.25, legR: 0.25 });
  else if (v.job === 'khadgi') Object.assign(J, { armR: -1.25, armL: -1.15, armRz: 0.1, armLz: -0.34, elbR: 1.2, elbL: 1.3, toolR: -1.15, toolL: null, gripL: 0, twist: 0.3 }); // two hands on the khanda, point up
  else if (v.job === 'urumi') Object.assign(J, { armR: -0.55, armRz: 0.35, elbR: 0.8, toolR: 0.45, armL: -0.5, elbL: 1.5, toolL: null, gripL: 0, twist: 0.35, lean: 0.18 }); // the whip-sword trailing, the other hand on guard
  else if (v.job === 'chakri') Object.assign(J, { armR: -0.95, armRz: 0.35, elbR: 1.8, toolR: 0, armL: -0.55, elbL: 1.1, toolL: null, gripL: 0, twist: 0.45 }); // a ring cocked by the shoulder
  return J;
}
/*
 * A swing has three key poses: ready → wound up → struck. The wind-up eases in up to the hit moment, then
 * the strike snaps through in a few frames. Values per joint: [ready, wound, struck].
 */
const SWING_POSES = {
  slash:  { armR: [-0.75, -2.7, -0.55], armRz: [0.22, 0.65, -0.45], elbR: [1.25, 1.45, 0.15], gripR: [1.0, 0.95, 1.15], twist: [0.22, 0.65, -0.5], lean: [0.14, -0.05, 0.32], hipY: [0.43, 0.44, 0.4], legL: [-0.38, -0.25, -0.6], kneeL: [0.42, 0.3, 0.55], armL: [-0.65, -0.5, -0.85], sided: true },
  thrust: { armR: [-0.55, -0.5, -1.5], elbR: [0.75, 1.55, 0.05], toolR: [-0.12, -0.12, 0.02], armRz: [0.12, 0.3, -0.05], twist: [0.32, 0.6, -0.3], lean: [0.14, -0.05, 0.42], legL: [-0.38, -0.2, -0.8], kneeL: [0.42, 0.3, 0.6], legR: [0.3, 0.2, 0.55], hipY: [0.43, 0.44, 0.39], armL: [-0.65, -0.45, -0.5] },
  smash:  { armR: [-1.55, -3.0, -0.6], armL: [-1.5, -2.95, -0.6], elbR: [1.15, 1.35, 0.1], elbL: [1.2, 1.4, 0.15], gripR: [1.0, 1.0, 1.25], armLz: [-0.32, -0.3, -0.3], lean: [0.1, -0.3, 0.58], hipY: [0.43, 0.45, 0.37], kneeL: [0.42, 0.2, 0.75], kneeR: [0.38, 0.2, 0.7], legL: [-0.38, -0.2, -0.6] },
  bash:   { armL: [-0.65, -0.35, -1.5], elbL: [1.25, 1.6, 0.25], armLz: [0.05, 0.2, -0.1], twist: [0.22, 0.55, -0.55], lean: [0.14, 0, 0.4], legL: [-0.38, -0.2, -0.85], kneeL: [0.42, 0.3, 0.6], armR: [-0.75, -0.9, -0.6] },
  slam:   { armR: [-1.55, -3.1, -0.3], armL: [-1.5, -3.0, -0.3], elbR: [1.15, 1.3, 0.05], elbL: [1.2, 1.3, 0.1], gripR: [1.0, 1.05, 1.35], armLz: [-0.32, -0.3, -0.3], lean: [0.1, -0.2, 0.65], hipY: [0.43, 0.45, 0.32], legL: [-0.38, -0.7, -0.75], kneeL: [0.42, 1.0, 0.9], legR: [0.3, 0.4, -0.5], kneeR: [0.38, 0.8, 0.95] },
  lunge:  { armR: [-0.55, -0.5, -1.55], elbR: [0.75, 1.4, 0.0], toolR: [-0.12, -0.1, 0.05], twist: [0.32, 0.45, -0.3], lean: [0.14, 0.2, 0.55], legL: [-0.38, -0.6, -1.15], kneeL: [0.42, 0.9, 1.15], legR: [0.3, 0.6, 0.85], kneeR: [0.38, 0.3, 0.1], hipY: [0.43, 0.4, 0.33], armL: [-0.65, -0.3, -0.4] },
  shoot:  { armR: [-1.05, -1.45, -1.25], armRz: [-0.2, -0.28, 0.25], elbR: [1.6, 2.35, 1.1], armL: [-1.25, -1.45, -1.4], twist: [0.75, 0.95, 0.9], lean: [-0.02, -0.06, 0.02] },
  volley: { armR: [-1.05, -2.0, -1.9], armRz: [-0.2, -0.3, 0.2], elbR: [1.6, 2.35, 1.1], armL: [-1.25, -2.0, -1.95], twist: [0.75, 0.95, 0.9], lean: [-0.02, -0.25, -0.12], headX: [0, -0.35, -0.3] },
  pulse:  { armR: [-0.5, -2.9, -1.3], armL: [-0.3, -2.9, -1.3], elbR: [1.0, 0.3, 0.2], elbL: [0.8, 0.3, 0.2], armRz: [0, 0.3, 1.0], armLz: [0, 0.3, 1.0], lean: [0.05, -0.15, 0.1], hipY: [0.45, 0.47, 0.44], headX: [0, -0.4, 0] },
  // ultimates
  whirl:  { armR: [-0.75, -0.3, -0.3], armRz: [0.22, 1.4, 1.4], elbR: [1.25, 0.15, 0.15], gripR: [1.0, 0.25, 0.25], armL: [-0.65, -0.3, -0.3], armLz: [0.05, 1.4, 1.4], elbL: [1.25, 0.2, 0.2], lean: [0.14, 0.05, 0.12], kneeL: [0.42, 0.4, 0.4], kneeR: [0.38, 0.4, 0.4] },
  leap:   { armR: [-1.55, -3.1, -0.25], armL: [-1.5, -3.0, -0.3], elbR: [1.15, 1.25, 0.05], elbL: [1.2, 1.25, 0.1], gripR: [1.0, 1.0, 1.35], armLz: [-0.32, -0.3, -0.3], lean: [0.1, -0.3, 0.72], hipY: [0.43, 0.45, 0.3], legL: [-0.38, -0.9, -0.8], kneeL: [0.42, 1.3, 1.0], legR: [0.3, 0.5, -0.6], kneeR: [0.38, 1.1, 1.0] },
  barrage: null, // uses the thrust, once per blow
  // the new blades and rings
  cleave: { armR: [-1.25, -2.0, -1.05], armL: [-1.15, -1.9, -0.95], armRz: [0.1, 1.05, -0.55], armLz: [-0.34, 0.55, -0.95], elbR: [1.2, 1.2, 0.25], elbL: [1.3, 1.35, 0.35], gripR: [1.1, 1.0, 1.25], twist: [0.3, 0.95, -0.7], lean: [0.14, -0.05, 0.3], hipY: [0.43, 0.44, 0.4], legL: [-0.38, -0.25, -0.6], kneeL: [0.42, 0.3, 0.55], sided: true },
  sunder: { armR: [-1.25, -3.05, -0.5], armL: [-1.15, -2.95, -0.5], armLz: [-0.34, -0.3, -0.3], elbR: [1.2, 1.3, 0.1], elbL: [1.3, 1.35, 0.15], gripR: [1.1, 1.0, 1.35], lean: [0.14, -0.3, 0.62], hipY: [0.43, 0.46, 0.36], kneeL: [0.42, 0.2, 0.8], kneeR: [0.38, 0.2, 0.75], legL: [-0.38, -0.2, -0.65] },
  lash:   { armR: [-0.55, -2.5, -0.85], armRz: [0.35, 0.85, -0.45], elbR: [0.8, 1.7, 0.0], gripR: [0.6, 1.5, 0.25], twist: [0.35, 0.75, -0.5], lean: [0.18, -0.05, 0.28], legL: [-0.38, -0.2, -0.6], kneeL: [0.42, 0.3, 0.55], sided: true },
  coil:   { armR: [-0.55, -0.35, -0.35], armRz: [0.35, 1.45, 1.45], elbR: [0.8, 0.1, 0.1], gripR: [0.6, 0.15, 0.15], armL: [-0.5, -0.3, -0.3], armLz: [0.05, 1.2, 1.2], elbL: [1.5, 0.3, 0.3], lean: [0.18, 0.05, 0.1], kneeL: [0.42, 0.45, 0.45], kneeR: [0.38, 0.45, 0.45] },
  throw:  { armR: [-0.95, -1.35, -1.6], armRz: [0.35, 1.0, -0.35], elbR: [1.8, 2.1, 0.1], toolR: [0, 0, 0], twist: [0.45, 1.0, -0.55], lean: [0.1, -0.05, 0.25], legL: [-0.38, -0.2, -0.6], kneeL: [0.42, 0.3, 0.5] },
  pierce: { armR: [-1.05, -1.5, -1.25], armRz: [-0.2, -0.3, 0.25], elbR: [1.6, 2.45, 1.1], armL: [-1.25, -1.5, -1.45], twist: [0.75, 1.0, 0.9], lean: [-0.02, -0.1, 0.04], kneeL: [0.3, 0.5, 0.45], legL: [-0.25, -0.45, -0.45] },
  rain:   { armR: [-1.05, -2.2, -2.05], armRz: [-0.2, -0.3, 0.2], elbR: [1.6, 2.4, 1.1], armL: [-1.25, -2.2, -2.1], twist: [0.75, 0.95, 0.9], lean: [-0.02, -0.3, -0.15], headX: [0, -0.45, -0.4] },
  storm:  null, serpent: null, ricochet: null, fan: null,
  astra:  { armR: [-1.05, -2.1, -1.95], armRz: [-0.2, -0.3, 0.2], elbR: [1.6, 2.45, 1.1], armL: [-1.25, -2.15, -2.05], twist: [0.75, 1.0, 0.95], lean: [-0.02, -0.3, -0.15], legL: [-0.25, -0.55, -0.5], kneeL: [0.3, 0.6, 0.55], legR: [0.25, 0.45, 0.45], headX: [0, -0.4, -0.35] },
  sanjeevani: { armR: [-0.5, -3.0, -1.0], armL: [-0.3, -3.0, -1.0], elbR: [1.0, 0.2, 0.2], elbL: [0.8, 0.2, 0.2], armRz: [0, 0.2, 1.3], armLz: [0, 0.2, 1.3], lean: [0.05, -0.25, 0.05], hipY: [0.45, 0.5, 0.45], headX: [0, -0.5, -0.1] },
};
SWING_POSES.barrage = SWING_POSES.thrust;
SWING_POSES.storm = SWING_POSES.cleave; SWING_POSES.serpent = SWING_POSES.coil; SWING_POSES.ricochet = SWING_POSES.throw;
SWING_POSES.fan = Object.assign({}, SWING_POSES.throw, { armL: [-0.55, -1.4, -1.6], armLz: [0.05, 0.9, -0.3], elbL: [1.1, 2.0, 0.1] });
function attackPose(v, a) {
  const S2 = SWING_POSES[a.kind] || SWING_POSES.slash;
  let p = clamp(a.t / a.dur, 0, 1), h = a.hit;
  if (a.hits && a.kind !== 'whirl' && a.kind !== 'coil' && a.kind !== 'serpent') { // several blows: wind up and strike again for each (spins just keep spinning)
    const k = Math.min(a.hi || 0, a.hits.length - 1), t0 = k === 0 ? 0 : a.hits[k - 1], t1 = a.hits[k];
    p = clamp((p - t0) / Math.max(0.01, (k === a.hits.length - 1 ? 1 : a.hits[k + 1]) - t0), 0, 1);
    h = clamp((t1 - t0) / Math.max(0.01, (k === a.hits.length - 1 ? 1 : a.hits[k + 1]) - t0), 0.2, 0.9);
  }
  const wind = p < h ? Math.sin((p / h) * Math.PI * 0.5) : 1;
  const strike = p < h ? 0 : easeOutCubic((p - h) / Math.min(0.32, 1 - h));
  const side = S2.sided ? a.side || 1 : 1;
  const J = fightStance(v, v.animT);
  if (S2.gripR) J.toolR = null; // the blade follows the wrist through the swing
  for (const key in S2) {
    if (key === 'sided') continue;
    const [r, w, s] = S2[key];
    const sg = side < 0 && (key === 'armRz' || key === 'twist') ? -1 : 1;
    J[key] = (strike > 0 ? w + (s - w) * strike : r + (w - r) * wind) * sg;
  }
  if (a.kind === 'slam' && p < h) J.hipY += Math.sin((p / h) * Math.PI) * 0.34; // the leap
  if (a.kind === 'leap' && p < h) J.hipY += Math.sin((p / h) * Math.PI) * 1.1; // Hanuman's leap: high through the air
  J.drawn = (a.kind === 'shoot' || a.kind === 'volley' || a.kind === 'astra' || a.kind === 'pierce' || a.kind === 'rain') && p < h; // the bowstring is pulled until the release
  return J;
}
/** Sparring in the Akhara: a soldier runs through the swings of their own combo, with a breath between bouts. */
const SPAR = { warrior: ['slash', 'slash', 'thrust', 'bash'], brute: ['smash', 'smash', 'slam'], spear: ['thrust', 'thrust', 'lunge'], khadgi: ['cleave', 'cleave', 'sunder'], urumi: ['lash', 'lash', 'coil'] };
function sparPose(v, t) {
  const list = SPAR[v.job] || SPAR.warrior, id = v.id || 0;
  const cyc = t * 0.9 + id * 0.37, n = Math.floor(cyc), f = cyc - n;
  if (n % 4 === 3) { const J = fightStance(v, t); J.headY += Math.sin(t * 1.3 + id) * 0.3; return J; } // circling, guard up
  const kind = list[n % list.length], S2 = SWINGS[kind] || SWINGS.slash;
  return attackPose(v, { kind, t: f * S2.dur * 1.6, dur: S2.dur * 1.6, hit: S2.hit, hits: S2.hits || null, hi: 0, side: n % 2 ? 1 : -1 });
}
/** An archer at the mark: draw, hold, loose, reach back for the next arrow. */
function aimPose(v, t) {
  const id = v.id || 0, per = 2.4, f = ((t + id * 0.53) % per) / per;
  if (v.job === 'chakri') { const S2 = SWINGS.throw; return f < 0.45 ? fightStance(v, t) : attackPose(v, { kind: 'throw', t: ((f - 0.45) / 0.55) * S2.dur, dur: S2.dur, hit: S2.hit }); } // wind up and throw
  const J = fightStance(v, t);
  const draw = f < 0.5 ? Math.sin((f / 0.5) * Math.PI * 0.5) : f < 0.62 ? 1 : 0; // the loose snaps the string forward
  const nock = f > 0.75 ? Math.sin(((f - 0.75) / 0.25) * Math.PI) : 0; // a hand back to the quiver
  Object.assign(J, { armL: -1.45, armLz: 0.95, twist: 0.92, headY: -0.85, lean: -0.03,
    armR: -1.05 - 0.4 * draw + 0.9 * nock, armRz: -0.2 - 0.08 * draw + 0.35 * nock, elbR: 1.5 + 0.85 * draw + 0.4 * nock });
  J.drawn = draw > 0.2;
  return J;
}
/** Once the elders have named the asura, people keep glancing toward the side he will come from. */
function omenGlance(v, J, t) {
  const om = typeof S !== 'undefined' && S && S.omen;
  if (!om || om.done || om.stage < 2 || Math.sin(t * 0.25 + (v.id || 0) * 1.3) < 0.15) return;
  let rel = Math.atan2(Math.sin(om.a), -Math.cos(om.a)) - (v.rot || 0);
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  J.headY = clamp(-rel, -1.1, 1.1); J.twist += clamp(-rel * 0.25, -0.3, 0.3); J.headX = -0.05;
}
/** Work strokes for each trade (anim 'work'), keyed by job. */
function workPose(v, J, t) {
  const id = v.id || 0;
  const job = v.job, tool = JOBS[job] && JOBS[job].tool;
  if (tool === 'axe') { // a two-handed overhead chop into the trunk
    const w = stroke((t * 1.1 + id * 0.13) % 1, 0.62);
    Object.assign(J, { armR: lerpN(-1.25, -2.6, w), armL: lerpN(-1.15, -2.45, w), elbR: lerpN(0.25, 1.3, w), elbL: lerpN(0.35, 1.4, w), armRz: lerpN(0.05, 0.3, w), armLz: lerpN(-0.38, -0.12, w),
      gripR: lerpN(1.3, 1.6, w), twist: lerpN(-0.2, 0.5, w), lean: lerpN(0.3, -0.12, w), legL: -0.28, kneeL: 0.3, legR: 0.22, kneeR: 0.25, hipY: V_HIP - 0.03, headX: lerpN(0.15, -0.1, w) });
  } else if (tool === 'pick') { // the gainti high over the head and down on the rock
    const w = stroke((t * 0.95 + id * 0.17) % 1, 0.6);
    Object.assign(J, { armR: lerpN(-0.85, -2.9, w), armL: lerpN(-0.75, -2.75, w), elbR: lerpN(0.1, 1.1, w), elbL: lerpN(0.2, 1.2, w), armLz: -0.3, armRz: 0.05, gripR: lerpN(1.25, 1.55, w),
      lean: lerpN(0.42, -0.15, w), kneeL: lerpN(0.4, 0.1, w), kneeR: lerpN(0.35, 0.1, w), legL: -0.25, legR: 0.2, hipY: V_HIP - lerpN(0.05, 0.0, w), headX: 0.2 });
  } else if (tool === 'hammer') { // quick hammer taps; every other Mistri kneels to it
    const w = stroke((t * 1.9 + id * 0.31) % 1, 0.55);
    Object.assign(J, { armR: lerpN(-1.0, -1.65, w), elbR: lerpN(0.7, 1.95, w), gripR: 1.75, armL: -0.95, elbL: 0.95, armLz: -0.15, lean: 0.2, headX: 0.25, kneeL: 0.12, kneeR: 0.12 });
    if (id % 2) Object.assign(J, { hipY: 0.27, legR: -1.5, kneeR: 1.5, legL: 0.15, kneeL: 1.85, lean: 0.3, armR: lerpN(-0.75, -1.45, w), gripR: 1.95 });
  } else if (tool === 'sickle') { // crouched in the crop: grab a fistful, sweep the sickle through
    const w = stroke((t * 1.0 + id * 0.21) % 1, 0.5);
    Object.assign(J, { hipY: 0.28, legL: -1.2, legR: -1.15, kneeL: 2.05, kneeR: 2.0, legLz: 0.32, legRz: 0.32, lean: 0.6, armL: -1.15, elbL: 0.35, armLz: lerpN(-0.15, 0.05, w),
      armR: lerpN(-0.85, -1.25, w), armRz: lerpN(-0.25, 0.45, w), elbR: 0.5, gripR: 0.25, headX: 0.35 });
  } else if (tool === 'spade') { // foot on the spade, lever the clay up
    const w = stroke((t * 0.8 + id * 0.19) % 1, 0.55);
    Object.assign(J, { legL: -0.55, kneeL: lerpN(0.7, 0.3, w), legR: 0.22, kneeR: 0.2, armR: lerpN(-0.7, -1.2, w), armL: lerpN(-0.9, -1.4, w), elbR: lerpN(0.6, 0.95, w), elbL: lerpN(0.55, 0.9, w),
      armLz: -0.25, lean: lerpN(0.42, 0.15, w), toolR: lerpN(1.25, 0.85, w), headX: 0.3 });
  } else if (tool === 'mould') { // squatting at the drying yard, pressing clay into the mould
    const w = Math.sin(t * 3 + id) * 0.5 + 0.5;
    Object.assign(J, { hipY: 0.28, legL: -1.2, legR: -1.15, kneeL: 2.05, kneeR: 2.0, legLz: 0.35, legRz: 0.35, lean: 0.45, armR: lerpN(-0.95, -1.15, w), armL: lerpN(-0.95, -1.15, w), elbR: lerpN(0.35, 0.85, w), elbL: lerpN(0.35, 0.85, w), armRz: -0.1, armLz: -0.1, toolR: 0, headX: 0.4 });
  } else if (tool === 'tongs') { // working the bellows and turning the bloom
    const w = Math.sin(t * 4 + id);
    Object.assign(J, { armR: -0.85 + w * 0.25, armL: -0.85 - w * 0.25, elbR: 0.8 - w * 0.3, elbL: 0.8 + w * 0.3, lean: 0.3, kneeL: 0.3, kneeR: 0.3, hipY: V_HIP - 0.03, toolR: 0.8, headX: 0.25 });
  } else if (tool === 'thali') { // aarti: circling the lamp before the deity, the other hand ringing a bell
    const a = t * 2.4 + id;
    Object.assign(J, { armR: -1.15 + Math.sin(a) * 0.25, armRz: 0.12 + Math.cos(a) * 0.22, elbR: 1.0, toolR: 0, armL: -0.55, elbL: 1.6 + Math.sin(t * 14) * 0.08, armLz: -0.1, lean: 0.04, headX: 0.08 });
  } else if (tool === 'sack') { // calling out prices, holding up a sack of grain
    Object.assign(J, { armR: -0.9, elbR: 0.85, toolR: 0, armL: -0.55 + Math.sin(t * 1.6 + id) * 0.3, elbL: 1.2, armLz: 0.25, headY: Math.sin(t * 0.7 + id) * 0.4, twist: Math.sin(t * 0.7 + id) * 0.15 });
  } else if (tool === 'herbs' || tool === 'potli') { // kneeling by a patient, rubbing in the herbs
    Object.assign(J, { hipY: 0.27, legL: -1.45, kneeL: 1.45, legR: 0.12, kneeR: 1.9, lean: 0.35, armR: -0.95 + Math.sin(t * 3) * 0.12, armL: -0.95 - Math.sin(t * 3) * 0.12, elbR: 0.5, elbL: 0.5, armLz: -0.12, armRz: -0.05, toolR: 0, headX: 0.35 });
  } else if (tool === 'rod') { // sitting on the bank, both hands on the rod held out over the water; now and then a bite and a tug
    const bite = Math.max(0, Math.sin(t * 0.9 + id * 1.3) - 0.88) * 8, bob = Math.sin(t * 1.7 + id) * 0.03;
    Object.assign(J, { hipY: 0.16, legL: -1.35, legR: -1.3, kneeL: 1.25, kneeR: 1.15, legLz: 0.22, legRz: 0.2, lean: 0.12 - bite * 0.1,
      armR: -0.9 - bite * 0.35 + bob, armRz: 0.05, elbR: 0.6, armL: -0.82 - bite * 0.3 + bob, armLz: -0.22, elbL: 0.75, toolR: -0.5 - bite * 0.3, headX: 0.18 + Math.sin(t * 0.4 + id) * 0.05 });
  } else { // a helping hand: lift, carry and set down materials
    const w = Math.sin(((t * 0.75 + id * 0.27) % 1) * Math.PI * 2) * 0.5 + 0.5;
    Object.assign(J, { armR: lerpN(-1.4, -0.65, w), armL: lerpN(-1.4, -0.65, w), elbR: lerpN(0.3, 1.4, w), elbL: lerpN(0.3, 1.4, w), armRz: -0.1, armLz: -0.1, lean: lerpN(0.38, 0.05, w), kneeL: lerpN(0.55, 0.12, w), kneeR: lerpN(0.55, 0.12, w), hipY: V_HIP - lerpN(0.06, 0, w), headX: 0.2 });
  }
}
/**
 * The pose for one villager this frame. o is the renderer's record (walk phase, speed).
 */
function villagerPose(v, o, t) {
  const anim = v.anim, tool = JOBS[v.job] && JOBS[v.job].tool, id = v.id || 0;
  const J = Object.assign({}, VJ_REST);
  const carry = TOOL_CARRY[tool];
  if (carry) Object.assign(J, carry);
  if (tool === 'bow' || tool === 'longbow') Object.assign(J, { armL: -0.15, elbL: 0.55, toolL: -1.3 });
  if (v.job === 'warrior' || v.job === 'spear') Object.assign(J, { armL: -0.2, elbL: 0.9, toolL: 0 }); // the dhaal on the forearm, face out
  const defender = isDefender(v);
  if (anim === 'walk') {
    const run = (o.spd || 0) > 3.1 || (v.combatT > 0 && !defender);
    const A = run ? 0.72 : 0.5, ph = o.ph || 0, sn = Math.sin(ph), cs = Math.cos(ph);
    J.legL = -sn * A; J.legR = sn * A; // the left leg leads when sn > 0
    J.kneeL = 0.1 + Math.max(0, cs) * (run ? 1.25 : 0.85); J.kneeR = 0.1 + Math.max(0, -cs) * (run ? 1.25 : 0.85);
    J.hipY = V_HIP - 0.012 - Math.abs(sn) * (run ? 0.03 : 0.018);
    J.sway = sn * 0.035; J.hipTw = -sn * 0.1; J.twist = sn * 0.12; J.lean = run ? 0.22 : 0.06; J.headX = run ? -0.1 : 0.02;
    if (!carry || !(carry.armR)) { J.armR = -J.legR * 0.8 * (run ? 1.2 : 1); J.elbR = (run ? 1.3 : 0.28) + Math.max(0, -J.armR) * 0.45; }
    if (tool !== 'bow' && tool !== 'longbow' && v.job !== 'warrior' && v.job !== 'spear') { J.armL = -J.legL * 0.8 * (run ? 1.2 : 1); J.elbL = (run ? 1.3 : 0.28) + Math.max(0, -J.armL) * 0.45; }
    if (v.carryAmt > 0) { // both hands on the tokri straps, the tool over the shoulder
      Object.assign(J, { armR: -0.35, elbR: 1.95, armRz: -0.12, armL: -0.35, elbL: 1.95, armLz: -0.12, lean: 0.14 });
      if (J.toolR != null) J.toolR = -2.3;
    }
    if (v.combatT > 0 && defender) { // charging with the weapon up
      const F = fightStance(v, t);
      for (const k of ['armR', 'armRz', 'elbR', 'toolR', 'gripR', 'armL', 'armLz', 'elbL', 'toolL', 'gripL']) J[k] = F[k];
      J.lean = 0.25;
    }
  } else if (anim === 'work' && defender && v.job !== 'medic') Object.assign(J, sparPose(v, t)); // soldiers in the Akhara spar: the swings of their own combo
  else if (anim === 'work') workPose(v, J, t);
  else if (anim === 'shoot') Object.assign(J, aimPose(v, t)); // drawing, holding, loosing and nocking again
  else if (anim === 'sit') { // cross-legged by the fire (women kneel-sit), hands on the knees
    if (v.look && v.look.g === 'f') Object.assign(J, { hipY: 0.15, legL: -1.25, legR: -1.25, kneeL: 2.6, kneeR: 2.6, legLz: 0.1, legRz: 0.1, lean: 0.12 });
    else Object.assign(J, { hipY: 0.14, legL: -1.4, legR: -1.4, kneeL: 2.35, kneeR: 2.35, legLz: 0.85, legRz: 0.85, lean: 0.12 });
    Object.assign(J, { armL: -0.55, armR: -0.55, elbL: 0.75, elbR: 0.75, armLz: 0.15, armRz: 0.15, headX: 0.12 + Math.sin(t * 0.5 + id) * 0.05, headY: Math.sin(t * 0.31 + id * 1.7) * 0.35 });
    if (J.toolR != null) J.toolR = 0.4;
    if (id % 3 === 0) Object.assign(J, { armR: -0.9, elbR: 1.6, armRz: 0.05, headX: 0.05, headY: 0.5 + Math.sin(t * 0.8 + id) * 0.2 }); // chatting with a neighbour
    omenGlance(v, J, t);
  } else if (anim === 'sleep') { // curled on the side by the fire
    Object.assign(J, { lie: 1, hipY: V_HIP - 0.02, legL: -0.95, legR: -0.8, kneeL: 1.45, kneeR: 1.3, armR: -1.35, elbR: 1.9, armRz: 0.1, armL: -0.7, elbL: 1.0, armLz: 0.1, lean: 0.25, headX: 0.25, toolR: 1.3, toolL: null, gripL: 0 });
  } else if (anim === 'fight') Object.assign(J, fightStance(v, t));
  else if (anim === 'heal') {
    if (v.job === 'vaidya') workPose(v, J, t);
    else Object.assign(J, { armR: -1.3, elbR: 0.45, toolR: -0.35, armL: -1.05 + Math.sin(t * 4) * 0.1, elbL: 0.55, armLz: 0.1, lean: 0.16, kneeL: 0.18, kneeR: 0.18, hipY: V_HIP - 0.01, headX: 0.2 });
  } else if (anim === 'atk' && v.atk) Object.assign(J, attackPose(v, v.atk));
  else { // standing: breathe, shift the weight, look around now and then
    const b = Math.sin(t * 1.3 + id);
    J.sway = b * 0.018; J.kneeL += Math.max(0, b) * 0.1; J.kneeR += Math.max(0, -b) * 0.1;
    J.armL += b * 0.04; J.armR -= b * 0.04;
    const look = Math.sin(t * 0.37 + id * 2.1);
    J.headY = Math.abs(look) > 0.6 ? Math.sign(look) * 0.45 : 0;
    J.headX = Math.sin(t * 0.23 + id) * 0.06;
    if (v.job === 'warrior') { J.armR = -0.35; J.elbR = 0.9; J.toolR = 0.35; } // the talwar held low and ready
    omenGlance(v, J, t);
  }
  if (v.blockT > 0) Object.assign(J, { armL: -1.25, elbL: 1.45, armLz: -0.15, toolL: 0, lean: J.lean - 0.1, twist: -0.2 }); // dhaal up
  if (v.hurtT > 0 && anim !== 'atk') J.lean -= 0.28 * (v.hurtT / 0.25); // flinch
  // the hands: a body-space tool angle becomes a wrist angle, so the tool points where it should
  J.handR = J.toolR != null ? J.toolR - J.lean - J.armR + J.elbR : J.gripR;
  J.handL = J.toolL != null ? J.toolL - J.lean - J.armL + J.elbL : J.gripL;
  return J;
}
/** Put a pose on the rig. */
function applyVillagerPose(obj, ud, P) {
  ud.hips.position.y = P.hipY + P.lie * 0.19;
  ud.hips.rotation.set(0, -P.hipTw, P.sway);
  ud.spine.rotation.set(P.lean, -P.twist, 0);
  ud.head.rotation.set(P.headX, -P.headY, 0);
  ud.legs[0].rotation.set(P.legR, 0, -P.legRz); ud.legs[0].userData.knee.rotation.x = P.kneeR;
  ud.legs[1].rotation.set(P.legL, 0, P.legLz); ud.legs[1].userData.knee.rotation.x = P.kneeL;
  ud.arms[0].rotation.set(P.armL, 0, P.armLz); ud.arms[0].userData.elbow.rotation.x = -P.elbL;
  ud.arms[1].rotation.set(P.armR, 0, -P.armRz); ud.arms[1].userData.elbow.rotation.x = -P.elbR;
  ud.grips[1].rotation.x = P.handR;
  ud.grips[0].rotation.x = P.handL;
  if (ud.skirt) { // the saree follows the legs
    const avg = (P.legL + P.legR) / 2, spread = Math.abs(P.legL - P.legR);
    ud.skirt.rotation.x = clamp(avg * 0.55, -1.1, 0.4);
    ud.skirt.scale.set(1 + Math.max(P.legLz, P.legRz) * 0.3, avg < -0.8 ? 0.62 : 1 - Math.max(0, -avg) * 0.25, 1 + spread * 0.4 + Math.max(0, -avg) * 0.35);
  }
}
/** A world piece that never moves (the forest and rocks only change their instances): skip its per-frame transform update. */
function still(o) {
  if (!o || !o.matrixAutoUpdate) return;
  o.matrixAutoUpdate = false; o.updateMatrix(); o.matrixWorldNeedsUpdate = true;
}

const R3 = {
  ok: false,
  cam: { x: 0, z: 1, dist: 24, yaw: 0.55, pitch: 0.95, tx: 0, tz: 1, tdist: 24, tyaw: 0.55, tpitch: 0.95 },
  ghostInfo: null, wallPreview: null,

  init(canvas) {
    if (typeof THREE === 'undefined') return false;
    this.canvas = canvas;
    initMaterials();
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.localClippingEnabled = true; // construction sites reveal buildings from the ground up
    const sc = (this.scene = new THREE.Scene());
    sc.fog = new THREE.Fog(SKY_DAY, 70, 175);
    sc.background = new THREE.Color(SKY_DAY);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 500);
    // lights: warm golden sun, cool periwinkle sky fill — warm light, cool shadows (complementary)
    this.hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, 0.6);
    sc.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(SUN_DAY, 0.9));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 140 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    sc.add(sun, sun.target);
    this.moon = new THREE.DirectionalLight(0x7f8cff, 0);
    sc.add(this.moon, this.moon.target);
    this.fireLight = new THREE.PointLight(0xff9a40, 1, 15, 2);
    this.fireLight.position.set(0, 1.8, 0);
    sc.add(this.fireLight);
    this.pool = [];
    for (let i = 0; i < 6; i++) { const L = new THREE.PointLight(0xffa050, 0, 6, 2); sc.add(L); this.pool.push(L); }
    this.buildSea(sc);
    this.buildSky(sc);
    // dynamic containers
    this.bObjs = new Map(); this.vObjs = new Map(); this.eObjs = new Map(); this.aObjs = [];
    this.arrows = [];
    this.arrowGeo = null;
    this.buildParticles();
    this.buildSelection();
    this.initFX();
    this.overlay = document.getElementById('overlay3d');
    this.floatEls = []; this.barEls = []; this.stockEls = [];
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.resize();
    this.ok = true;
    return true;
  },
  /*
   * Low-poly sea: a faceted sheet that heaves in slow waves (in the vertex shader, on the shared wind clock),
   * turquoise over the shallows by the beach and deepening to blue out at sea, over a plain deep-blue floor
   * that runs to the horizon.
   */
  buildSea(sc) {
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshLambertMaterial({ color: 0x2c7fb4 }));
    deep.rotation.x = -Math.PI / 2; deep.position.y = -0.62; deep.userData.noAO = true;
    sc.add(deep);
    const N = 70, SZ = 280, rnd = mulberry32(77);
    const base = new THREE.PlaneGeometry(SZ, SZ, N, N);
    base.rotateX(-Math.PI / 2);
    const bp = base.attributes.position, step = SZ / N;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), z = bp.getZ(i);
      if (Math.abs(x) < SZ / 2 - 0.1 && Math.abs(z) < SZ / 2 - 0.1) bp.setXYZ(i, x + (rnd() - 0.5) * step * 0.6, 0, z + (rnd() - 0.5) * step * 0.6);
    }
    const geo = base.toNonIndexed(); base.dispose();
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    geo.computeVertexNormals();
    this.seaShade = new Float32Array(geo.attributes.position.count / 3).map(() => (rnd() - 0.5) * 0.06);
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 55, specular: 0x9fd8e8, transparent: true, opacity: 0.94 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = MAT.windU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        transformed.y += 0.09 * sin(wp.x * 0.33 + uTime * 0.9) + 0.07 * sin(wp.z * 0.41 - uTime * 0.7) + 0.04 * sin((wp.x + wp.z) * 0.9 + uTime * 1.6);`);
    };
    mat.customProgramCacheKey = () => 'sea';
    const sea = new THREE.Mesh(geo, mat);
    sea.position.y = -0.38; sea.receiveShadow = true; sea.userData.noAO = true;
    sc.add(sea); this.sea = sea;
    this.colorSea();
  },
  /** Shallows by the beach, deep water further out (redone with each world, as the island's size can differ). */
  colorSea() {
    const geo = this.sea.geometry, pos = geo.attributes.position, col = geo.attributes.color, a = pos.array, c = new THREE.Color();
    for (let f = 0; f < pos.count / 3; f++) {
      const o = f * 9, x = (a[o] + a[o + 3] + a[o + 6]) / 3, z = (a[o + 2] + a[o + 5] + a[o + 8]) / 3;
      const d = Math.hypot(x, z) - islandR(x, z); // distance out from the beach
      c.setHex(lerpHex(lerpHex(0x5fd6cf, 0x37a9cf, clamp(d / 10, 0, 1)), 0x2a7db6, clamp((d - 10) / 45, 0, 1))).multiplyScalar(1 + this.seaShade[f]);
      for (let k = 0; k < 3; k++) col.setXYZ(f * 3 + k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  },
  /** Each pond: a faceted water surface that ripples gently, and its banks (reeds, lily pads, stones). */
  buildPonds(s) {
    if (!MAT.pond) {
      MAT.pond = new THREE.MeshPhongMaterial({ color: 0x4fb8c4, flatShading: true, shininess: 70, specular: 0xbfe8f0, transparent: true, opacity: 0.88 });
      MAT.pond.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = MAT.windU;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
          transformed.y += 0.025 * sin(wp.x * 1.7 + uTime * 1.3) + 0.02 * sin(wp.z * 2.1 - uTime * 1.1);`);
      };
      MAT.pond.customProgramCacheKey = () => 'pond';
    }
    for (const p of s.ponds || []) {
      const y = heightAt(p.x, p.z + p.r + 3) - 0.16; // the water stands a little below the surrounding ground
      const geo = new THREE.CircleGeometry(p.r + 0.2, 14, 0, Math.PI * 2);
      const pos = geo.attributes.position, rnd = mulberry32(p.id * 31 + 5);
      for (let i = 1; i < pos.count - 1; i++) { const k = 1 + (rnd() - 0.5) * 0.12; pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k); } // a less perfect shore
      pos.setXY(pos.count - 1, pos.getX(1), pos.getY(1));
      geo.rotateX(-Math.PI / 2);
      const w = new THREE.Mesh(geo, MAT.pond);
      w.position.set(p.x, y, p.z); w.rotation.y = p.rot || 0; w.receiveShadow = true; w.userData.noAO = true; w.raycast = () => {};
      const bank = new THREE.Mesh(Models.pondGeo(p.r, p.id), MAT.std);
      bank.position.set(p.x, y, p.z); bank.castShadow = true; bank.receiveShadow = true;
      this.worldGroup.add(w, bank);
      still(w); still(bank);
    }
  },
  /** A gradient sky dome that follows the camera: deep blue overhead, pale and hazy at the horizon (the fog colour). */
  buildSky(sc) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color(0x4f92dc) }, uHor: { value: new THREE.Color(SKY_DAY) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; varying vec3 vDir;
        void main() { float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(uHor, uTop, pow(h, 0.55)), 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(440, 24, 12), mat);
    sky.renderOrder = -10; sky.frustumCulled = false; sky.userData.noAO = true; sky.raycast = () => {};
    sc.add(sky); this.sky = sky;
  },
  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    // tall portrait screens: open the view a little and pull back, so the village still fits across
    const p = clamp((1 - w / h) / 0.55, 0, 1);
    this.camera.fov = 36 + p * 14;
    this.viewMul = 1 + p * 0.4;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const pr = this.renderer.getPixelRatio();
      this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
      if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    }
  },

  /* ---------- world (rebuilt for each new game / load) ---------- */
  buildWorld(s) {
    const sc = this.scene;
    this.postKey = null; this.postMeshes = []; this.roadKey = null; this.roadMesh = null; // outpost circles and roads live in the world group, rebuilt below
    if (this.worldGroup) {
      sc.remove(this.worldGroup);
      this.disposeTree(this.worldGroup);
      for (const g of this._treeGeos || []) g.dispose();
    }
    for (const [, o] of this.bObjs) this.removeObj(o.obj);
    for (const [, o] of this.vObjs) this.removeObj(o.obj);
    for (const [, o] of this.eObjs) this.removeObj(o.obj);
    for (const o of this.aObjs) this.removeObj(o);
    this.bObjs.clear(); this.vObjs.clear(); this.eObjs.clear(); this.aObjs = [];
    for (const d of this.dying) { if (d.obj.parent) d.obj.parent.remove(d.obj); if (!d.keepGeo) this.disposeTree(d.obj); }
    this.dying = [];
    this.treeWas = new Map();
    const g = (this.worldGroup = new THREE.Group());
    // the world never moves: three.js need not rebuild its transform (and every child's) each frame
    sc.matrixAutoUpdate = false; g.matrixAutoUpdate = false;
    sc.add(g);
    this.buildTerrain(s);
    this.colorSea();
    this.buildPonds(s);
    this.buildTrees(s);
    this.rockVer = -1;
    this.rockMeshes = null; // old ones belonged to the previous world group — rebuild them
    for (const [, o] of this.lootObjs || []) this.removeObj(o); // loot from the last village must not linger in the new one
    this.lootObjs = new Map();
    this.buildDecor(s);
    this.buildFireHeap(g);
    this.fireLevel = 0;
    this.radiusShown = 0;
    this.treeVer = s.treeVer;
  },
  removeObj(o) { if (o && o.parent) o.parent.remove(o); this.disposeTree(o); },
  disposeTree(o) {
    if (!o) return;
    o.traverse((c) => {
      if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
      if (c.material && c.material.userData && c.material.userData.own) c.material.dispose();
    });
  },
  /*
   * Low-poly ground: a coarse grid whose inner vertices are nudged off their grid lines and lifted a hair,
   * cut into triangles that each keep one face normal and one colour (with a little shade of its own),
   * so the land reads as hand-cut facets like everything standing on it.
   */
  buildTerrain(s) {
    const N = 104, SZ = 190, step = SZ / N, rnd = mulberry32(911);
    const base = new THREE.PlaneGeometry(SZ, SZ, N, N);
    base.rotateX(-Math.PI / 2);
    const bp = base.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      let x = bp.getX(i), z = bp.getZ(i);
      if (Math.abs(x) < SZ / 2 - 0.1 && Math.abs(z) < SZ / 2 - 0.1) { x += (rnd() - 0.5) * step * 0.6; z += (rnd() - 0.5) * step * 0.6; }
      const lift = (rnd() - 0.5) * 0.07 * clamp((Math.hypot(x, z) - 5) / 10, 0, 1); // no relief at the fire
      bp.setXYZ(i, x, heightAt(x, z) + lift, z);
    }
    const geo = base.toNonIndexed(); base.dispose();
    geo.computeVertexNormals(); // unindexed: one normal per facet
    const pos = geo.attributes.position;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    this.terrainShade = new Float32Array(pos.count / 3).map(() => (rnd() - 0.5) * 0.075);
    if (!MAT.terrain || MAT.terrain.userData.tier !== MAT.tier) { MAT.terrain = surfaceMat({ vertexColors: true, roughness: 1 }); MAT.terrain.userData.tier = MAT.tier; }
    const m = new THREE.Mesh(geo, MAT.terrain);
    m.receiveShadow = true;
    this.worldGroup.add(m);
    this.terrain = m;
    // forest-floor map: where trees stand thick, the ground turns a deeper, shadier olive
    const FD = (this.forestD = new Float32Array(76 * 76));
    for (const t of s.trees) {
      const i = Math.floor((t.x + 76) / 2), j = Math.floor((t.z + 76) / 2);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < 76 && jj < 76) FD[jj * 76 + ii] += a || b ? 0.35 : 1;
      }
    }
    this.colorTerrain(territory(s));
  },
  forestAt(x, z) {
    const FD = this.forestD;
    if (!FD) return 0;
    const i = Math.floor((x + 76) / 2), j = Math.floor((z + 76) / 2);
    return i < 0 || j < 0 || i >= 76 || j >= 76 ? 0 : clamp(FD[j * 76 + i] / 3.2, 0, 1);
  },
  colorTerrain(R) {
    const geo = this.terrain.geometry, pos = geo.attributes.position, col = geo.attributes.color, sh = this.terrainShade;
    const c = new THREE.Color(), a = pos.array;
    for (let f = 0, o = 0; f < pos.count / 3; f++, o += 9) {
      // each facet takes the colour at its middle
      const x = (a[o] + a[o + 3] + a[o + 6]) / 3, y = (a[o + 1] + a[o + 4] + a[o + 7]) / 3, z = (a[o + 2] + a[o + 5] + a[o + 8]) / 3;
      const r = Math.hypot(x, z), edge = islandR(x, z);
      const n = Math.sin(x * 0.21 + z * 0.13) * 0.5 + Math.sin(x * 0.09 - z * 0.23) * 0.5;
      let hex;
      // palette: sunny meadow green, warm trodden earth in the village, deep shady green under the trees, golden beach
      if (y < -0.5) hex = 0xd9bd84;
      else if (r > edge - 3.4) hex = lerpHex(0xf3dca6, 0xe6c68a, clamp((r - edge + 3.4) / 3, 0, 1));
      else {
        hex = lerpHex(0x86b843, 0x9cc54e, n * 0.5 + 0.5);
        if (r > 30) hex = lerpHex(hex, 0x7aad40, clamp((r - 30) / 12, 0, 1));
        hex = lerpHex(hex, 0x5e8f38, this.forestAt(x, z) * 0.65);
        if (r < R + 0.5) hex = lerpHex(hex, 0xc9b073, 0.5 + 0.12 * n);
        if (r > edge - 4.6) hex = lerpHex(hex, 0xe8d29a, clamp((r - edge + 4.6) / 1.2, 0, 1));
        for (const p of (typeof S !== 'undefined' && S && S.ponds) || []) { // muddy banks round a pond, darker under its water
          const pd = Math.hypot(x - p.x, z - p.z) - p.r;
          if (pd < 1.1) hex = lerpHex(hex, pd < 0 ? 0x6f6a48 : 0xb09464, clamp((1.1 - pd) / 0.8, 0, 1));
        }
      }
      c.setHex(hex).multiplyScalar(1 + (sh ? sh[f] : 0));
      for (let k = 0; k < 3; k++) col.setXYZ(f * 3 + k, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  },
  /** Ink outline twin for an instanced mesh (shares its instance matrices). */
  outlineFor(im, mat) {
    const o = new THREE.InstancedMesh(im.geometry, mat || MAT.outlineBig, im.count);
    o.instanceMatrix = im.instanceMatrix;
    o.frustumCulled = false;
    o.raycast = () => {};
    if (!MAT.useOutline) { o.visible = false; o.userData.off = true; } // the modern look draws no ink lines
    im.userData.outline = o;
    return o;
  },
  /*
   * The forest: one batch per tree kind. Every tree's place lives in a source list that is never drawn;
   * each frame the trees in view are packed into the batch, near ones at full detail and far ones as
   * their light twins (a third of the triangles, no shadow). So the whole forest is a couple of dozen
   * draw calls, and trees off the screen cost nothing.
   */
  buildTrees(s) {
    this.treeMeshes = {};
    this.stumpMeshes = {};
    this.forest = [];
    this.treeSlot = new Map();
    const groups = {}, stumps = {};
    for (const t of s.trees) {
      (groups[t.type + t.variant] = groups[t.type + t.variant] || []).push(t);
      (stumps[t.type] = stumps[t.type] || []).push(t);
    }
    const geos = {};
    const batch = (src, geo, geoLo, mat, olMat) => {
      const n = src.count;
      const near = new THREE.InstancedMesh(geo, mat, n);
      near.castShadow = true; near.receiveShadow = true; near.frustumCulled = false; near.count = 0;
      near.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ol = this.outlineFor(near, olMat);
      this.worldGroup.add(near, ol); still(near); still(ol);
      const F = { src, near, ol, n };
      if (geoLo) {
        const far = new THREE.InstancedMesh(geoLo, mat, n);
        far.castShadow = false; far.receiveShadow = true; far.frustumCulled = false; far.count = 0;
        far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        far.raycast = () => {}; far.userData.noAO = true;
        // the near trees drawn light, only for the occlusion pass (see setupPost)
        const nearLo = new THREE.InstancedMesh(geoLo, mat, n);
        nearLo.instanceMatrix = near.instanceMatrix;
        nearLo.castShadow = false; nearLo.frustumCulled = false; nearLo.visible = false; nearLo.count = 0;
        nearLo.raycast = () => {}; nearLo.userData.noAO = true;
        this.worldGroup.add(far, nearLo); still(far); still(nearLo);
        F.far = far; F.nearLo = nearLo;
      }
      this.forest.push(F);
    };
    for (const k in groups) {
      const list = groups[k];
      const geo = geos[k] || (geos[k] = Models.treeGeo(list[0].type, list[0].variant));
      const geoLo = geos[k + 'lo'] || (geos[k + 'lo'] = Models.treeGeo(list[0].type, list[0].variant, true));
      geo.userData.shared = true; geoLo.userData.shared = true;
      const src = new THREE.InstancedMesh(geo, MAT.tree, list.length); // (never added to the scene)
      list.forEach((t, i) => this.treeSlot.set(t.id, { m: src, i }));
      this.treeMeshes[k] = src;
      batch(src, geo, geoLo, MAT.tree, MAT.treeOutline);
    }
    for (const k in stumps) {
      const list = stumps[k];
      const geo = geos['stump' + k] || (geos['stump' + k] = Models.stumpGeo(k));
      geo.userData.shared = true;
      const src = new THREE.InstancedMesh(geo, MAT.std, list.length);
      list.forEach((t, i) => { const sl = this.treeSlot.get(t.id); sl.sm = src; sl.si = i; });
      this.stumpMeshes[k] = src;
      batch(src, geo, null, MAT.std, MAT.outline);
    }
    this._treeGeos = Object.values(geos);
    this.syncTrees(s, true);
  },
  _frustum: new THREE.Frustum(), _pm: new THREE.Matrix4(), _vs: new THREE.Sphere(new THREE.Vector3(), 3), _ts: new THREE.Sphere(new THREE.Vector3(), 1),
  cullChunks() {
    this.camera.updateMatrixWorld();
    this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    this._frOk = true; // (villagers test against this view on the next frame)
    // repack the forest only when the view or a tree changed
    const pe = this._pm.elements, last = this._pmLast || (this._pmLast = new Float32Array(16));
    let same = !this.forestDirty && this._forestQ === this.Q;
    for (let i = 0; i < 16 && same; i++) if (Math.abs(pe[i] - last[i]) > 1e-6) same = false;
    if (same) return;
    last.set(pe); this.forestDirty = false; this._forestQ = this.Q;
    const Q = this.Q, c = this.cam, cp = this.camera.position, fr = this._frustum, sph = this._ts;
    const far = c.dist * 1.25 + 14, far2 = far * far; // on Low, distant forest is left to the fog
    const ey = Math.max(0, cp.y - 2), lod = Q.lodDist + 4;
    for (const F of this.forest || []) {
      const a = F.src.instanceMatrix.array, NA = F.near.instanceMatrix.array, FA = F.far ? F.far.instanceMatrix.array : null;
      let nn = 0, nf = 0;
      for (let i = 0, o = 0; i < F.n; i++, o += 16) {
        const s2 = a[o] * a[o] + a[o + 1] * a[o + 1] + a[o + 2] * a[o + 2];
        if (s2 < 1e-6) continue; // felled (or not a stump yet)
        const x = a[o + 12], y = a[o + 13], z = a[o + 14], sc = Math.sqrt(s2);
        if (Q.farCull) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > far2) continue; }
        sph.center.set(x, y + 2 * sc, z); sph.radius = 4.5 * sc + 2; // (room for its shadow reaching into view)
        if (!fr.intersectsSphere(sph)) continue;
        // detail follows the real distance from the camera, so zooming out switches to the light trees
        let near = !FA;
        if (FA) { const ex = x - cp.x, ez = z - cp.z; near = ex * ex + ey * ey + ez * ez <= lod * lod; }
        if (near) { for (let j = 0; j < 16; j++) NA[nn * 16 + j] = a[o + j]; nn++; }
        else { for (let j = 0; j < 16; j++) FA[nf * 16 + j] = a[o + j]; nf++; }
      }
      const put = (m, n) => {
        m.count = n; m.visible = n > 0;
        if (n > 0) { const im = m.instanceMatrix; im.updateRange.offset = 0; im.updateRange.count = n * 16; im.needsUpdate = true; }
      };
      put(F.near, nn);
      F.ol.count = nn; F.ol.visible = nn > 0 && !Q.farCull && !F.ol.userData.off;
      if (F.far) { put(F.far, nf); F.nearLo.count = nn; }
    }
  },

  /* ---------- graphics quality ---------- */
  /*
   * Three tiers. Low: Lambert, no shadows, 1× pixels, no grass, near forest only.
   * Mid: soft matte shading, shadows, grass. High: Mid plus ambient occlusion, glow on bright
   * lights, a colour grade with vignette, and FXAA.
   */
  quality: 'high', Q: QUALITY.high,
  setQuality(q) {
    q = QUALITY[q] ? q : 'high';
    this.quality = q;
    const Q = (this.Q = QUALITY[q]);
    if (!this.renderer) return;
    this.resK = 1; this._ft = null; this._adT = 0; this.gpuMs = null; // the frame-rate governor starts fresh on each tier
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    const shadows = Q.shadows, type = Q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap, size = Q.shadowSize;
    for (let i = 0; i < this.pool.length; i++) this.pool[i].visible = i < Q.lights; // fewer lights = cheaper pixels everywhere
    const sm = this.renderer.shadowMap;
    const shadowChanged = sm.enabled !== shadows || sm.type !== type || this.sun.shadow.mapSize.x !== size;
    sm.enabled = shadows; sm.type = type;
    this.sun.shadow.mapSize.set(size, size);
    if (shadowChanged && this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.castShadow = false;
    if (MAT.tier !== q) { // new materials for the tier, so every model is rebuilt with them
      initMaterials(q);
      if (typeof S !== 'undefined' && S && this.worldGroup) this.buildWorld(S);
    } else if (shadowChanged) this.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    if (this.decor) for (const m of this.decor) m.visible = Q.decor;
    this.resize();
    this.setupPost();
  },
  /** High only: occlusion → bloom → colour grade + vignette → FXAA. Falls back to plain rendering if the scripts did not load. */
  setupPost() {
    if (this.composer) { for (const p of this.composer.passes) if (p.dispose) p.dispose(); this.composer = null; this.aoPass = this.fxaa = null; }
    if (!this.Q.post || !THREE.EffectComposer || !THREE.ShaderPass || !THREE.UnrealBloomPass) return;
    try {
      const w = window.innerWidth, h = window.innerHeight, r = this.renderer, pr = r.getPixelRatio();
      const comp = new THREE.EffectComposer(r);
      comp.setPixelRatio(pr); comp.setSize(w, h);
      if (THREE.SSAOPass && THREE.SimplexNoise) {
        const ao = new THREE.SSAOPass(this.scene, this.camera, w, h);
        ao.beautyRenderTarget.stencilBuffer = true; // (the see-through silhouettes use the stencil to draw as one shape)
        ao.kernelRadius = 0.55; ao.minDistance = 0.0004; ao.maxDistance = 0.02;
        // 16 samples instead of 32: the same soft contact shadows for half the work
        ao.kernelSize = 16; ao.generateSampleKernel();
        ao.ssaoMaterial.defines.KERNEL_SIZE = 16; ao.ssaoMaterial.uniforms.kernel.value = ao.kernel; ao.ssaoMaterial.needsUpdate = true;
        const base = ao.renderOverride.bind(ao);
        const hid = [];
        // the occlusion pass redraws the scene, so it skips what cannot cast visible occlusion:
        // glows, particles, see-through things, grass and flowers, and the far-away forest
        // (the list of things to hide is gathered by walking the scene only every 20 frames, not every frame)
        // and the forest goes in as its light far-away twins: occlusion is blurred anyway, a third of the triangles
        let skip = [], age = 99;
        const swapped = [];
        ao.overrideVisibility = ao.restoreVisibility = () => {}; // (its own scene walk; the list below already leaves out points and lines)
        ao.normalMaterial.skinning = true; // villagers occlude where they stand, not in their rest pose
        ao.renderOverride = (renderer, mat, target, cc, ca) => {
          if (++age > 20) {
            age = 0; skip = [];
            this.scene.traverse((o) => { if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO || (o.material && (o.material.transparent || o.material.isMeshBasicMaterial))) skip.push(o); });
          }
          hid.length = 0; swapped.length = 0;
          for (const o of skip) if (o.visible) { o.visible = false; hid.push(o); }
          if (mat === ao.normalMaterial) for (const F of this.forest || []) if (F.nearLo && F.near.visible) { F.near.visible = false; F.nearLo.visible = true; swapped.push(F); }
          base(renderer, mat, target, cc, ca);
          for (const F of swapped) { F.near.visible = true; F.nearLo.visible = false; }
          for (const o of hid) o.visible = true;
        };
        comp.addPass(ao); this.aoPass = ao;
      } else comp.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.2, 0.4, 0.97); // strength follows the night, see updateLights
      comp.addPass(this.bloomPass);
      comp.addPass(new THREE.ShaderPass(GRADE_SHADER));
      if (THREE.FXAAShader) { const fx = new THREE.ShaderPass(THREE.FXAAShader); fx.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); comp.addPass(fx); this.fxaa = fx; }
      this.composer = comp;
    } catch (e) { console.warn('Post effects unavailable:', e); this.composer = null; }
  },
  _m: new THREE.Matrix4(), _q: new THREE.Quaternion(), _p: new THREE.Vector3(), _s: new THREE.Vector3(), _e: new THREE.Euler(),
  setInst(im, i, x, y, z, ry, sc, tilt) {
    this._e.set(tilt || 0, ry, (tilt || 0) * 0.6);
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(sc, sc, sc);
    this._m.compose(this._p, this._q, this._s);
    im.setMatrixAt(i, this._m);
  },
  syncTrees(s, all) {
    const live = new Set();
    this.treeWas = this.treeWas || new Map();
    for (const t of s.trees) {
      live.add(t.id);
      const sl = this.treeSlot.get(t.id);
      if (!sl) continue;
      const was = this.treeWas.get(t.id);
      if (was === false && t.stump) this.fellTree(t, sl);
      this.treeWas.set(t.id, t.stump);
      const y = heightAt(t.x, t.z);
      const tilt = t.shake > 0 ? Math.sin(t.shake * 40) * 0.05 : 0;
      this.setInst(sl.m, sl.i, t.x, y, t.z, t.rot, t.stump ? 0 : t.scale, tilt);
      this.setInst(sl.sm, sl.si, t.x, y, t.z, t.rot, t.stump ? t.scale : 0, 0);
    }
    if (all) for (const [id, sl] of this.treeSlot) if (!live.has(id)) { this.setInst(sl.m, sl.i, 0, -50, 0, 0, 0, 0); this.setInst(sl.sm, sl.si, 0, -50, 0, 0, 0, 0); }
    this.forestDirty = true; // (the trees in view get packed again, see cullChunks)
  },
  /* ---------- fluid little animations: falling trees, sinking ruins, fading demons ---------- */
  dying: [],
  fellTree(t, sl) {
    const piv = new THREE.Group();
    piv.position.set(t.x, heightAt(t.x, t.z), t.z);
    piv.rotation.y = Math.random() * Math.PI * 2;
    const m = new THREE.Mesh(sl.m.geometry, MAT.std);
    m.scale.setScalar(t.scale);
    m.rotation.y = t.rot;
    m.castShadow = true;
    piv.add(m);
    this.scene.add(piv);
    this.dying.push({ obj: piv, t: 0, dur: 1.6, kind: 'tree', keepGeo: true });
  },
  retire(obj, kind, extra) {
    if (!obj) return;
    obj.traverse((c) => { if (c.userData.sil) c.visible = false; }); // no x-ray glow while sinking into the ground
    this.dying.push(Object.assign({ obj, t: 0, dur: kind === 'building' ? 0.9 : kind === 'loot' ? 0.45 : kind === 'villager' ? 1.2 : 0.7, kind, s0: obj.scale.x, y0: obj.position.y }, extra));
  },
  animateDying(dt) {
    for (const d of this.dying) {
      d.t += dt;
      const f = clamp(d.t / d.dur, 0, 1), o = d.obj;
      if (d.kind === 'tree') { // topple over, then sink away
        const fall = clamp(d.t / 0.9, 0, 1);
        o.rotation.z = Math.pow(fall, 2.2) * 1.45;
        if (d.t > 0.95) o.position.y -= dt * 1.4;
      } else if (d.kind === 'enemy') { // shrink, spin and sink into the earth
        o.scale.setScalar(d.s0 * (1 - f * 0.85));
        o.rotation.y += dt * 9;
        o.position.y = d.y0 - f * f * 1.2;
      } else if (d.kind === 'villager') { // fall back, then fade into the ground
        o.rotation.x = -Math.min(1, d.t / 0.35) * 1.45;
        if (d.t > 0.5) o.position.y -= dt * 0.9;
      } else if (d.kind === 'building') { // crumble down with a tilt
        o.position.y = d.y0 - f * f * 2.2;
        o.rotation.z = Math.sin(f * 6) * 0.04 * (1 - f) + f * 0.15;
        o.scale.y = 1 - f * 0.4;
      } else if (d.kind === 'loot') { // hop up and vanish when picked up
        o.position.y = d.y0 + Math.sin(f * Math.PI) * 0.7 + f * 0.3;
        o.scale.setScalar(Math.max(0.01, 1 - f));
        o.rotation.y += dt * 12;
      }
    }
    const done = this.dying.filter((d) => d.t >= d.dur);
    if (done.length) {
      for (const d of done) { if (d.obj.parent) d.obj.parent.remove(d.obj); if (!d.keepGeo) this.disposeTree(d.obj); }
      this.dying = this.dying.filter((d) => d.t < d.dur);
    }
  },
  /*
   * The rangoli on the swept earth around the Agnikund, drawn as a proper mandala in powder colours:
   * a dotted white border at the fire, a ring of lotus petals on indigo, a green band of zigzag teeth,
   * twelve large petals with nested colours, and a scalloped border with white dots. A sprinkle of grain
   * makes it read as coloured powder rather than paint. The plane is 9 units wide; the kund covers r < 1.55.
   */
  rangoliCanvas(N) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const x = cv.getContext('2d');
    x.translate(N / 2, N / 2);
    const R = (u) => (u * N) / 9;
    const TAU = Math.PI * 2;
    const C = { red: '#c8352e', saffron: '#f08a2c', yellow: '#f4c53c', green: '#2f9a5c', magenta: '#c4307c', indigo: '#33489c', white: '#f7f0e1', teal: '#1f8f8a', pink: '#f07aa0' };
    const sym = (n, fn, off) => { for (let i = 0; i < n; i++) { x.save(); x.rotate((i / n) * TAU + (off || 0)); fn(i); x.restore(); } };
    const band = (r0, r1, col) => { x.beginPath(); x.arc(0, 0, R(r1), 0, TAU); x.arc(0, 0, R(r0), 0, TAU, true); x.fillStyle = col; x.fill(); };
    const ring = (r, w, col) => { x.beginPath(); x.arc(0, 0, R(r), 0, TAU); x.strokeStyle = col; x.lineWidth = w; x.stroke(); };
    const dots = (r, n, rad, col, off) => sym(n, () => { x.beginPath(); x.arc(R(r), 0, rad, 0, TAU); x.fillStyle = col; x.fill(); }, off);
    const petal = (r0, r1, w, fill, stroke, lw) => { // a pointed petal along +x, from r0 to its tip at r1
      x.beginPath(); x.moveTo(R(r0), 0);
      x.bezierCurveTo(R(r0 + (r1 - r0) * 0.3), -R(w), R(r0 + (r1 - r0) * 0.75), -R(w) * 0.8, R(r1), 0);
      x.bezierCurveTo(R(r0 + (r1 - r0) * 0.75), R(w) * 0.8, R(r0 + (r1 - r0) * 0.3), R(w), R(r0), 0);
      x.closePath(); x.fillStyle = fill; x.fill();
      if (stroke) { x.strokeStyle = stroke; x.lineWidth = lw || N / 300; x.stroke(); }
    };
    const lw = N / 340;
    // the leeped earth floor, fading out at the edge
    const earth = x.createRadialGradient(0, 0, R(1.3), 0, 0, R(4.5));
    earth.addColorStop(0, 'rgba(164,114,70,0.95)'); earth.addColorStop(0.8, 'rgba(184,138,90,0.85)'); earth.addColorStop(1, 'rgba(184,138,90,0)');
    x.fillStyle = earth; x.beginPath(); x.arc(0, 0, R(4.5), 0, TAU); x.fill();
    // outer border: yellow scallops outlined in white, a row of white dots beyond
    sym(40, () => { x.beginPath(); x.arc(R(4.16), 0, R(0.13), -Math.PI / 2, Math.PI / 2); x.closePath(); x.fillStyle = C.yellow; x.fill(); x.strokeStyle = C.white; x.lineWidth = lw; x.stroke(); });
    dots(4.38, 40, R(0.035), C.white, Math.PI / 40);
    // twelve great petals, nested magenta → saffron → yellow, with small red petals between them
    sym(12, () => { petal(3.15, 3.82, 0.24, C.red, C.white, lw); petal(3.25, 3.65, 0.1, C.pink); }, Math.PI / 12);
    sym(12, () => {
      petal(3.1, 4.22, 0.42, C.magenta, C.white, lw * 1.4);
      petal(3.2, 4.0, 0.27, C.saffron, C.white, lw * 0.8);
      petal(3.3, 3.78, 0.12, C.yellow);
      x.beginPath(); x.arc(R(4.28), 0, R(0.045), 0, TAU); x.fillStyle = C.white; x.fill();
    });
    sym(24, () => { petal(3.05, 3.32, 0.06, C.green); }, Math.PI / 24); // little leaves at the base
    // green band of white zigzag teeth
    band(2.86, 3.1, C.green);
    sym(56, () => { x.beginPath(); x.moveTo(R(2.88), -R(0.12)); x.lineTo(R(3.08), 0); x.lineTo(R(2.88), R(0.12)); x.closePath(); x.fillStyle = C.white; x.fill(); });
    ring(2.86, lw, C.white); ring(3.1, lw, C.white);
    // lotus ring on indigo: saffron petals with yellow hearts, green buds between, dots at the tips
    band(1.96, 2.86, C.indigo);
    sym(16, () => { petal(2.0, 2.5, 0.09, C.green, C.white, lw * 0.7); }, Math.PI / 16);
    sym(16, () => {
      petal(1.98, 2.8, 0.2, C.saffron, C.white, lw);
      petal(2.08, 2.58, 0.09, C.yellow);
      x.beginPath(); x.arc(R(2.32), 0, R(0.035), 0, TAU); x.fillStyle = C.red; x.fill();
    });
    dots(2.8, 32, R(0.03), C.white, Math.PI / 16);
    // inner border at the kund: yellow with white edges and a necklace of white dots
    band(1.55, 1.96, C.yellow);
    ring(1.57, lw * 1.3, C.white); ring(1.96, lw * 1.3, C.white);
    dots(1.76, 36, R(0.04), C.red);
    dots(1.76, 36, R(0.018), C.white);
    // powder grain: darker and lighter specks, and a few scuffs where feet have passed
    const rnd = mulberry32(4242);
    for (let i = 0; i < (N > 600 ? 9000 : 3000); i++) {
      const a = rnd() * TAU, r = Math.sqrt(rnd()) * R(4.45);
      x.globalAlpha = 0.05 + rnd() * 0.1;
      x.fillStyle = rnd() < 0.5 ? '#2a1a10' : '#fff8ea';
      x.fillRect(Math.cos(a) * r, Math.sin(a) * r, N / 700, N / 700);
    }
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) {
      const a = rnd() * TAU, r = R(2 + rnd() * 2.3);
      x.globalAlpha = 0.05 + rnd() * 0.08;
      x.beginPath(); x.arc(Math.cos(a) * r, Math.sin(a) * r, R(0.08 + rnd() * 0.12), 0, TAU); x.fill();
    }
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    return cv;
  },
  syncRocks(s) {
    if (!this.rockMeshes) {
      this.rockMeshes = [];
      for (let k = 0; k < 16; k++) { // 8 stone shapes, then the same 8 as rusty iron-ore boulders
        const im = new THREE.InstancedMesh(Models.rockGeo(k % 8, k >= 8), MAT.std, 60);
        im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
        this.outlineFor(im, MAT.outline);
        this.rockMeshes.push(im);
      }
    }
    for (const im of this.rockMeshes) { if (!im.parent) this.worldGroup.add(im, im.userData.outline); im.count = 0; }
    for (const r of s.rocks) {
      const im = this.rockMeshes[(r.variant % 8) + (r.ore ? 8 : 0)];
      if (im.count >= 60) continue;
      const f = r.stone / r.maxStone;
      this.setInst(im, im.count++, r.x, heightAt(r.x, r.z) - 0.05, r.z, r.rot, r.scale * (0.5 + 0.5 * f), 0);
    }
    for (const im of this.rockMeshes) { im.instanceMatrix.needsUpdate = true; im.userData.outline.count = im.count; im.visible = im.count > 0; still(im); still(im.userData.outline); }
  },
  buildDecor(s) {
    const g = this.worldGroup;
    // grass tufts and flowers outside the village
    const rnd = mulberry32(s.seed + 99);
    const tuftGeo = new THREE.ConeGeometry(0.07, 0.26, 3);
    const tufts = new THREE.InstancedMesh(tuftGeo, withWind(surfaceMat({ color: 0xffffff, roughness: 1 }), 0.9, 'grass_' + MAT.tier), 2600);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 5, 4), surfaceMat({ color: 0xffffff }), 500); // a few pixels wide: 5×4 is plenty
    const cc = new THREE.Color();
    let nt = 0, nf = 0;
    for (let i = 0; i < 6000 && (nt < 2600 || nf < 500); i++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 58;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r > islandR(x, z) - 4) continue;
      if (r < 27 && rnd() < 0.7) continue;
      if (pondAt(s, x, z, 0.7)) continue; // nothing grows in the ponds
      const y = heightAt(x, z);
      if (nt < 2600) { this.setInst(tufts, nt, x, y, z, rnd() * 6, 0.7 + rnd() * 0.7, 0); tufts.setColorAt(nt, cc.setHex(pick([0x6fa83a, 0x82b843, 0x94c24c, 0xc4b85a]))); nt++; } // a few sun-dried golden tufts warm the meadow
      if (nf < 500 && rnd() < 0.2) { this.setInst(flowers, nf, x + 0.2, y + 0.06, z, 0, 1, 0); flowers.setColorAt(nf, cc.setHex(grade(pick([0xffb31a, 0xff7a1a, 0xf4ecd8, 0xe03c31, 0xc2185b, 0x9b7fd0])))); nf++; }
    }
    tufts.count = nt; flowers.count = nf; tufts.frustumCulled = false; flowers.frustumCulled = false;
    tufts.userData.noAO = flowers.userData.noAO = true;
    this.decor = [tufts, flowers];
    tufts.visible = flowers.visible = this.quality !== 'low';
    g.add(tufts, flowers);
    // low-poly bushes dotted over the meadow (outside the village, off the beach); four shapes, one draw each
    this._bushGeos = this._bushGeos || [0, 1, 2, 3].map((k) => { const b = Models.bushGeo(k); b.userData.shared = true; return b; });
    for (let k = 0; k < 4; k++) {
      const bm = new THREE.InstancedMesh(this._bushGeos[k], MAT.std, 80);
      let nb = 0;
      for (let i = 0; i < 400 && nb < 80; i++) {
        const a = rnd() * Math.PI * 2, r = 30 + rnd() * 40, x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (r > islandR(x, z) - 5 || pondAt(s, x, z, 0.9)) continue;
        this.setInst(bm, nb++, x, heightAt(x, z) - 0.04, z, rnd() * 6, 0.75 + rnd() * 0.6, 0);
      }
      bm.count = nb; bm.castShadow = true; bm.receiveShadow = true; bm.frustumCulled = false; bm.visible = this.quality !== 'low';
      g.add(bm); still(bm);
      this.decor.push(bm);
    }
    // what grows where a building now stands is hidden (see syncDecor)
    this.decorSets = this.decor.map((m) => ({ m, src: m.instanceMatrix.array.slice() }));
    this._decorVer = -1;
    // shoreline foam
    const seg = 160, fv = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const r0 = islandR(Math.cos(a0), Math.sin(a0)) + 0.3, r1 = islandR(Math.cos(a1), Math.sin(a1)) + 0.3;
      const p = (a, r) => [Math.cos(a) * r, -0.34, Math.sin(a) * r];
      const A = p(a0, r0 - 0.8), B = p(a0, r0 + 0.9), Cc = p(a1, r1 - 0.8), D = p(a1, r1 + 0.9);
      fv.push(...A, ...B, ...Cc, ...Cc, ...B, ...D);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fv), 3));
    this.foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    g.add(this.foam);
    // rangoli around the fire
    const tex = new THREE.CanvasTexture(this.rangoliCanvas(this.quality === 'low' ? 512 : 1024));
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy ? this.renderer.capabilities.getMaxAnisotropy() : 1);
    const rang = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshPhongMaterial({ map: tex, transparent: true, depthWrite: false, shininess: 0, specular: 0x000000 }));
    rang.rotation.x = -Math.PI / 2; rang.position.y = 0.025; rang.receiveShadow = true;
    g.add(rang);
    // diyas around the kund
    this.diyas = [];
    for (let i = 0; i < 10; i++) {
      const d = Models.diya();
      const a = (i / 10) * Math.PI * 2;
      d.position.set(Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05);
      g.add(d); this.diyas.push(d);
    }
    // Pavitra Van shrine at the edge of the sacred grove, facing the village
    this.shrine = null;
    if (s.grove) {
      const gr = s.grove, d = Math.hypot(gr.x, gr.z) || 1;
      const sh = Models.shrine();
      sh.position.set(gr.x - (gr.x / d) * (gr.r + 0.7), 0, gr.z - (gr.z / d) * (gr.r + 0.7));
      sh.rotation.y = Math.atan2(-gr.x, -gr.z);
      g.add(sh);
      this.shrine = sh;
    }
    // land boundary
    this.bounds = [];
    for (let i = 0; i < 28; i++) { const b = Models.boundary(); g.add(b); this.bounds.push(b); }
    this.ringMesh = null;
    // rain
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 6), 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb4c8e6, transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    this.rainDrops = [];
    for (let i = 0; i < 400; i++) this.rainDrops.push([rand(-30, 30), rand(0, 22), rand(-30, 30)]);
    g.add(this.rain);
  },
  buildParticles() {
    const mk = (n, additive, size) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      this.scene.add(p);
      return p;
    };
    this.pNormal = mk(1000, false, 0.16);
    this.pAdd = mk(1000, true, 0.2);
    this.pFly = mk(80, true, 0.12);
  },
  buildSelection() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 28), new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    this.selRing = ring;
    this.ghostGroup = new THREE.Group();
    this.scene.add(this.ghostGroup);
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x6dff8e, transparent: true, opacity: 0.35, depthWrite: false }));
    fp.rotation.x = -Math.PI / 2;
    this.footprint = fp;
  },

  /* ---------- camera ---------- */
  updateCamera(dt) {
    const c = this.cam;
    const k = Math.min(1, dt * 9);
    c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k;
    c.dist += (c.tdist - c.dist) * k;
    c.yaw += (c.tyaw - c.yaw) * k;
    c.pitch += (c.tpitch - c.pitch) * k;
    const D = c.dist * (this.viewMul || 1);
    const hd = Math.cos(c.pitch) * D, h = Math.sin(c.pitch) * D;
    this.camera.position.set(c.x + Math.sin(c.yaw) * hd, h, c.z + Math.cos(c.yaw) * hd);
    this.camera.lookAt(c.x, 0, c.z);
  },
  panBy(dxPx, dyPx) {
    const c = this.cam;
    const k = (2 * c.dist * (this.viewMul || 1) * Math.tan((this.camera.fov * Math.PI) / 360)) / window.innerHeight;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = Math.cos(c.yaw), rz = -Math.sin(c.yaw);
    c.tx += (-rx * dxPx + fx * dyPx / Math.sin(c.pitch)) * k;
    c.tz += (-rz * dxPx + fz * dyPx / Math.sin(c.pitch)) * k;
    this.clampTarget();
  },
  move(fwd, right, dt) {
    const c = this.cam, sp = c.dist * 0.9 * dt;
    c.tx += (-Math.sin(c.yaw) * fwd + Math.cos(c.yaw) * right) * sp;
    c.tz += (-Math.cos(c.yaw) * fwd - Math.sin(c.yaw) * right) * sp;
    this.clampTarget();
  },
  zoomBy(f) { this.cam.tdist = clamp(this.cam.tdist * f, 8, 70); },
  rotateBy(dyaw, dpitch) { this.cam.tyaw += dyaw; this.cam.tpitch = clamp(this.cam.tpitch + (dpitch || 0), 0.5, 1.45); },
  lookAt(x, z) { this.cam.tx = x; this.cam.tz = z; this.clampTarget(); },
  clampTarget() { const c = this.cam, r = Math.hypot(c.tx, c.tz); if (r > 64) { c.tx *= 64 / r; c.tz *= 64 / r; } },

  /* ---------- picking ---------- */
  ndc(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  },
  groundAt(clientX, clientY) {
    this.ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p) ? { x: p.x, z: p.z } : null;
  },
  _pv: new THREE.Vector3(),
  project(x, y, z) {
    const v = this._pv.set(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  },
  pick(clientX, clientY) {
    const s = S;
    if (!s) return null;
    let best = null, bd = 30;
    const test = (kind, ref, y) => {
      const p = this.project(ref.x, y, ref.z);
      if (!p) return;
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d < bd) { bd = d; best = { kind, ref }; }
    };
    for (const e of s.enemies) test('enemy', e, e.y + ENEMIES[e.type].h * 0.5);
    for (const v of s.villagers) if (!v.inside) test('villager', v, 0.6);
    for (const a of s.ambient) if (!a.hidden) test('animal', a, 0.5);
    for (const l of s.loot) test('loot', l, 0.25);
    if (best && bd < 26) return best;
    // buildings by ray
    this.ray.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const objs = [];
    for (const [, o] of this.bObjs) objs.push(o.obj);
    if (this.fireObj) objs.push(this.fireObj);
    const hits = this.ray.intersectObjects(objs, true);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.bid == null && !o.userData.isFire) o = o.parent;
      if (!o) continue;
      if (o.userData.isFire) return { kind: 'fire', ref: s.fire };
      const b = s.bById.get(o.userData.bid);
      if (b) return { kind: 'building', ref: b };
    }
    const g = this.groundAt(clientX, clientY);
    if (!g) return best;
    if (Math.hypot(g.x, g.z) < 1.6) return { kind: 'fire', ref: s.fire };
    const b = buildingAtPoint(s, g.x, g.z);
    if (b) return { kind: 'building', ref: b };
    let tb = null, td = 1.1;
    for (const t of s.trees) { const d = distXZ(t.x, t.z, g.x, g.z); if (d < td) { td = d; tb = t; } }
    let rb = null, rd = 1.0;
    for (const r of s.rocks) { const d = distXZ(r.x, r.z, g.x, g.z); if (d < rd) { rd = d; rb = r; } }
    if (rb && (!tb || rd < td)) return { kind: 'rock', ref: rb };
    if (tb) return { kind: 'tree', ref: tb };
    return best;
  },

  /* ---------- build ghost ---------- */
  setGhost(info) { // { type, cx, cz, ok, cells }
    const g = this.ghostGroup;
    // a tower being placed shows the circle of land it will claim
    if (!this.ghostLand) {
      this.ghostLand = new THREE.Mesh(new THREE.RingGeometry(0.965, 1.0, 72), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false }));
      this.ghostLand.rotation.x = -Math.PI / 2; this.ghostLand.visible = false; this.scene.add(this.ghostLand);
    }
    const landR = info && !info.cells && TOWER_LAND[info.type];
    this.ghostLand.visible = !!landR;
    if (landR) { const c = bCenterOf(info.type, info.cx, info.cz); this.ghostLand.position.set(c.x, 0.05, c.z); this.ghostLand.scale.setScalar(landR); this.ghostLand.material.color.setHex(info.ok ? 0xffd27a : 0xff6a50); }
    if (!info) { g.visible = false; this.ghostInfo = null; return; }
    g.visible = true;
    const key = info.type + (info.cells ? 'L' + info.cells.length : '');
    if (!this.ghostInfo || this.ghostInfo.key !== key) {
      while (g.children.length) { const c = g.children.pop(); this.disposeTree(c); }
      const count = info.cells ? info.cells.length : 1;
      for (let i = 0; i < count; i++) {
        const m = Models.building(info.type);
        m.traverse((c) => { if (c.isMesh) { if (c.userData.outline) c.visible = false; c.material = MAT.ghostOk; c.castShadow = false; } });
        g.add(m);
      }
      const fp = this.footprint.clone();
      fp.material = this.footprint.material.clone();
      fp.material.userData.own = true;
      g.add(fp);
      this.ghostInfo = { key };
    }
    const def = BUILDINGS[info.type];
    const kids = g.children;
    const cells = info.cells || [[info.cx, info.cz]];
    cells.forEach(([cx, cz], i) => {
      const m = kids[i];
      const c = bCenterOf(info.type, cx, cz);
      m.position.set(c.x, 0.02, c.z);
      m.rotation.y = info.rot != null ? info.rot : (def.fw !== def.fd ? (c.z > 0 ? Math.PI : 0) : faceFireRot(c.x, c.z));
      const ok = info.oks ? info.oks[i] : info.ok;
      m.traverse((c2) => { if (c2.isMesh && !c2.userData.outline) c2.material = ok ? MAT.ghostOk : MAT.ghostBad; });
    });
    const fp = kids[kids.length - 1];
    if (!info.cells) {
      const c = bCenterOf(info.type, info.cx, info.cz);
      fp.visible = true;
      fp.position.set(c.x, 0.04, c.z);
      fp.scale.set(def.fw, def.fd, 1);
      fp.material.color.setHex(info.ok ? 0x6dff8e : 0xff5040);
    } else fp.visible = false;
  },

  /* ---------- per-frame sync ---------- */
  render(dt) {
    const s = S;
    if (!this.ok || !s) return;
    const time = s.time, dark = darknessAt(s.t), lit = dark > 0.15 || (s.festival && dark > 0.05);
    this.windAcc = (this.windAcc == null ? time : this.windAcc) + dt * (s.weather === 'rain' ? 1.6 : 1) * (this.windMul || 1); // the wind rises before an asura comes
    MAT.windU.value = this.windAcc;
    this._dt = dt;
    if (this.fling && !App.drag) { // camera keeps gliding after a drag
      this.panBy(this.fling.x * dt, this.fling.y * dt);
      const decay = Math.pow(0.015, dt);
      this.fling.x *= decay; this.fling.y *= decay;
      if (Math.hypot(this.fling.x, this.fling.y) < 15) this.fling = null;
    }
    this.updateCamera(dt);
    // camera shake from heavy blows, explosions and the Demon King
    const sk = Math.max(this.shakeAmt || 0, s.shake || 0);
    s.shake = 0;
    if (sk > 0.004) {
      const a = sk * clamp(this.cam.dist / 22, 0.6, 1.6) * 0.55;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * a;
      this.shakeAmt = sk * Math.exp(-dt * 11);
    } else this.shakeAmt = 0;
    this.animateDying(dt);
    const c = this.cam;
    this.lightSrc = [];
    // territory changes
    const R = territory(s);
    if (this.radiusShown !== R) {
      this.radiusShown = R;
      this.colorTerrain(R);
      this.bounds.forEach((b, i) => { const a = (i / this.bounds.length) * Math.PI * 2; b.position.set(Math.cos(a) * (R + 0.4), 0, Math.sin(a) * (R + 0.4)); b.rotation.y = -a; });
      if (this.ringMesh) { this.worldGroup.remove(this.ringMesh); this.ringMesh.geometry.dispose(); }
      this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(R - 0.06, R + 0.06, 96), new THREE.MeshBasicMaterial({ color: 0xff9933, transparent: true, opacity: 0.35, depthWrite: false }));
      this.ringMesh.rotation.x = -Math.PI / 2; this.ringMesh.position.y = 0.035;
      this.worldGroup.add(this.ringMesh);
    }
    this.ringMesh.material.opacity = UI.buildType ? 0.8 : 0.3;
    // outposts: each finished tower's own little circle of land
    const posts = outposts(s), pkey = posts.map((o) => o.b.id + ':' + o.r).join('|');
    if (this.postKey !== pkey) {
      this.postKey = pkey;
      for (const m of this.postMeshes || []) { this.worldGroup.remove(m); m.geometry.dispose(); }
      this.postMeshes = [];
      for (const o of posts) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(o.r - 0.05, o.r + 0.05, 64), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.35, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, 0.04, o.z);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(o.r, 48), new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.07, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2; disc.position.set(o.x, 0.03, o.z);
        this.worldGroup.add(ring); this.worldGroup.add(disc);
        this.postMeshes.push(ring, disc);
      }
    }
    for (const m of this.postMeshes || []) m.material.opacity = m.geometry.type === 'RingGeometry' ? (UI.buildType ? 0.85 : 0.3) : (UI.buildType ? 0.12 : 0.05);
    for (const b of this.bounds) b.userData.flags[0].rotation.y = Math.sin(time * 3 + b.position.x) * 0.4;
    if (this.shrine) for (const f of this.shrine.userData.flags) f.rotation.y = Math.sin(time * 3 + f.position.x * 4) * 0.45;
    // trees / rocks
    if (this.treeVer !== s.treeVer) { this.treeVer = s.treeVer; this.syncTrees(s, true); }
    else if (s.trees.some((t) => t.shake > 0) || this._shaking) { this._shaking = s.trees.some((t) => t.shake > 0); this.syncTrees(s, false); }
    if (this.rockVer !== s.rockVer) { this.rockVer = s.rockVer; this.syncRocks(s); }
    // fire
    if (this.fireLevel !== s.fire.level) {
      if (this.fireObj) this.removeObj(this.fireObj);
      this.fireObj = Models.agnikund(s.fire.level);
      this.fireObj.userData.isFire = true;
      this.scene.add(this.fireObj);
      this.fireLevel = s.fire.level;
    }
    animateFlames(this.fireObj.userData.flame, time, s.fire.intensity * (s.fire.hurtT > 0 ? 0.8 : 1));
    for (const f of this.fireObj.userData.flags) f.rotation.y = Math.sin(time * 3) * 0.4;
    for (const f of this.fireObj.userData.lampFlames) f.scale.setScalar(0.85 + 0.25 * Math.sin(time * 13 + f.position.x * 5));
    for (const d of this.diyas) { d.userData.flame.visible = lit; d.userData.flame.scale.setScalar(0.8 + 0.3 * Math.sin(time * 12 + d.position.x * 9)); }
    this.syncBuildings(s, time, dark, lit);
    this.syncDecor(s);
    this.syncVillagers(s, time, dark, dt);
    this.syncZzz(s, dt);
    this.syncEnemies(s, time, dt);
    this.syncAmbient(s, time);
    this.syncLoot(s, time);
    this.syncArrows(s);
    this.updateFX(s, dt);
    this.syncBeams(s, time);
    this.syncParticles(s, time, dark, dt);
    this.syncSelection(s, time);
    this.updateLights(s, time, dark);
    // water & foam
    this.sea.position.y = -0.38 + Math.sin(time * 0.8) * 0.04;
    this.foam.material.opacity = 0.35 + 0.2 * Math.sin(time * 1.3);
    this.cullChunks();
    // shadows: three.js would redraw the shadow map on every pass (the occlusion effect renders the scene
    // twice more); draw it once a frame instead, and when the frame is heavy, every other frame
    const sm = this.renderer.shadowMap;
    if (sm.enabled) { sm.autoUpdate = false; this._shF = (this._shF || 0) + 1; sm.needsUpdate = this.sunShadowLive !== false && (!this.heavyLoad || this._shF % 2 === 0); }
    this.gpuBegin();
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.gpuEnd();
    this.syncOverlay(s);
  },
  /*
   * GPU timing (where the browser offers a GPU timer): how long the graphics card really spends on a
   * frame, so the resolution governor reacts to the GPU itself rather than guessing from frame times.
   */
  gpuBegin() {
    try {
      const gl = this._gl || (this._gl = this.renderer.getContext());
      if (this._tq === undefined) this._tq = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext && gl.getExtension('EXT_disjoint_timer_query_webgl2')) || null;
      const ext = this._tq;
      if (!ext) return;
      if (this._gq) { // the last frame's answer, once it is ready
        if (!gl.getQueryParameter(this._gq, gl.QUERY_RESULT_AVAILABLE)) return;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
          const ms = gl.getQueryParameter(this._gq, gl.QUERY_RESULT) / 1e6;
          this.gpuMs = this.gpuMs == null ? ms : this.gpuMs * 0.92 + ms * 0.08;
        }
        gl.deleteQuery(this._gq); this._gq = null;
      }
      this._gq = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, this._gq); this._gqOpen = true;
    } catch (e) { this._tq = null; this._gq = null; this._gqOpen = false; this.gpuMs = null; } // no timer: frame times will do
  },
  gpuEnd() {
    if (!this._gqOpen) return;
    this._gqOpen = false;
    try { this._gl.endQuery(this._tq.TIME_ELAPSED_EXT); } catch (e) { this._tq = null; }
  },
  /*
   * Steady frame rate: when frames run slow for a while the drawing resolution steps down (to as little as
   * 60% of the tier's), and climbs back when there is headroom. Called from the main loop with each frame's time.
   */
  adaptRes(frameMs) {
    if (!this.ok || !this.Q || !(frameMs > 0) || frameMs > 120) return; // pauses and one-off hitches say nothing
    this._ft = this._ft == null ? frameMs : this._ft * 0.95 + frameMs * 0.05; // smoothed frame time
    this._adT = (this._adT || 0) + frameMs / 1000;
    const g = this.gpuMs;
    this.heavyLoad = this._ft > 20 && (g == null || g > 9); // slow frames and a busy GPU: sun shadows every other frame
    const base = Math.min(window.devicePixelRatio || 1, this.Q.pixelRatio), cur = this.resK || 1;
    const floor = base > 1.2 ? 0.6 : 0.75; // never blurrier than this
    // With a GPU timer, act on the graphics card's own time: a phone capped at 30 fps to save battery is not
    // slow, and a busy CPU is not helped by fewer pixels. Without one, act on the frame time.
    // Sharpening again: the GPU time grows with the pixels, so step up only when the bigger picture still fits.
    const up = Math.min(1, cur + 0.05);
    const slow = g != null ? g > 12.5 : this._ft > 21, roomy = g != null ? g * (up / cur) * (up / cur) < 11 : this._ft < 17.6;
    let next = cur;
    if (this._adT > 2 && slow) next = Math.max(floor, cur - 0.1); // below ~48 fps: draw fewer pixels
    else if (cur < 1 && this._adT > (this._upWait || 4) && roomy) next = up; // room again: sharpen
    if (Math.abs(next - cur) < 0.001) return;
    const t = performance.now();
    // a step back up that could not hold: wait longer before the next try, so it does not see-saw
    if (next < cur && this._upAt && t - this._upAt < 6000) this._upWait = Math.min(40, (this._upWait || 4) * 2);
    this._upAt = next > cur ? t : 0;
    this.resK = next; this._adT = 0;
    this.renderer.setPixelRatio(base * next);
    this.resize(); // the effect passes follow the new size
  },
  /*
   * Roads are drawn as one mesh for the whole network, rebuilt when it changes: each cell joins up with its
   * neighbours, and kerbs (stones and grass for a dirt path, a stone kerb for a brick road) run along any
   * side where the road ends. Bricks are laid along the way the road runs.
   */
  /** Grass, flowers and bushes under a building (or a road) are tucked away; they grow back if it goes. */
  syncDecor(s) {
    if (!this.decorSets || this._decorVer === s.buildVer) return;
    this._decorVer = s.buildVer;
    for (const D of this.decorSets) {
      const a = D.m.instanceMatrix.array, src = D.src;
      for (let i = 0, o = 0; i < D.m.count; i++, o += 16) {
        const under = !!buildingAtPoint(s, src[o + 12], src[o + 14]);
        for (let j = 0; j < 16; j++) a[o + j] = under ? 0 : src[o + j];
      }
      D.m.instanceMatrix.needsUpdate = true;
    }
  },
  syncRoads(s) {
    const key = s.buildVer;
    if (this.roadKey === key) return;
    this.roadKey = key;
    if (this.roadMesh) { this.worldGroup.remove(this.roadMesh); this.roadMesh.geometry.dispose(); this.roadMesh = null; }
    const cells = new Map();
    for (const b of s.buildings) if (BUILDINGS[b.type].road) cells.set(b.cx + ',' + b.cz, b.type);
    if (!cells.size) return;
    const p = [], rnd = mulberry32(13);
    for (const [k, type] of cells) {
      const [cx, cz] = k.split(',').map(Number), x = cx + 0.5, z = cz + 0.5, y = heightAt(x, z) + 0.005;
      const n = { e: cells.has(cx + 1 + ',' + cz), w: cells.has(cx - 1 + ',' + cz), s: cells.has(cx + ',' + (cz + 1)), nn: cells.has(cx + ',' + (cz - 1)) };
      const brick = type === 'road', alongX = (n.e || n.w) && !(n.s || n.nn) ? true : (n.s || n.nn) && !(n.e || n.w) ? false : true;
      if (brick) {
        p.push(box(1.0, 0.035, 1.0, 0x8a4228, x, y, z));
        for (let r = 0; r < 4; r++) { // running-bond courses: whole bricks, then a row offset by half a brick
          const u = -0.375 + r * 0.25, segs = r % 2 ? [[-0.375, 0.21], [0, 0.46], [0.375, 0.21]] : [[-0.25, 0.46], [0.25, 0.46]];
          segs.forEach(([w, len], c) => {
            const col = [0xb5532f, 0xa84a2c, 0xc2603a][(r + c + cx + cz) % 3];
            if (alongX) p.push(box(len, 0.014, 0.21, col, x + w, y + 0.035, z + u)); else p.push(box(0.21, 0.014, len, col, x + u, y + 0.035, z + w));
          });
        }
        const kerb = (kx, kz, w, d) => p.push(box(w, 0.07, d, 0x9a958c, kx, y, kz));
        if (!n.e) kerb(x + 0.46, z, 0.08, 1.0); if (!n.w) kerb(x - 0.46, z, 0.08, 1.0);
        if (!n.s) kerb(x, z + 0.46, 1.0, 0.08); if (!n.nn) kerb(x, z - 0.46, 1.0, 0.08);
      } else {
        p.push(box(1.0, 0.025, 1.0, 0xb08a5a, x, y, z));
        p.push(box(0.6, 0.006, 0.6, 0xa07a4c, x + (rnd() - 0.5) * 0.2, y + 0.025, z + (rnd() - 0.5) * 0.2)); // a darker trodden middle
        for (let i = 0; i < 3; i++) p.push(sph(0.035 + rnd() * 0.02, [0x9a958c, 0x8a857c, 0xb8b2a6][i], x + (rnd() - 0.5) * 0.7, y + 0.02, z + (rnd() - 0.5) * 0.7, 1, 0.5, 1));
        const edge = (ex, ez, ax) => { for (let i = 0; i < 4; i++) { const t = -0.4 + i * 0.27 + (rnd() - 0.5) * 0.08; p.push(sph(0.05, i % 2 ? 0x9a958c : 0xb0aa9e, ex + (ax ? t : 0), y + 0.02, ez + (ax ? 0 : t), 1.2, 0.6, 1)); } p.push(cone(0.03, 0.1, 4, 0x6f9a45, ex + (ax ? 0.2 : 0), y, ez + (ax ? 0 : 0.2))); };
        if (!n.e) edge(x + 0.48, z, false); if (!n.w) edge(x - 0.48, z, false);
        if (!n.s) edge(x, z + 0.48, true); if (!n.nn) edge(x, z - 0.48, true);
      }
    }
    const m = new THREE.Mesh(merge(p), MAT.bld || MAT.std);
    m.receiveShadow = true; m.castShadow = false; m.userData.noAO = true;
    this.worldGroup.add(m);
    this.roadMesh = m;
  },
  syncBuildings(s, time, dark, lit) {
    const seen = new Set();
    this.syncRoads(s);
    // the emblems: clear when close, gone when the camera pulls far back, softer by night (they are unlit)
    const eA = (this._emblemA = clamp((42 - this.cam.dist) / 9, 0, 1));
    for (const k in MAT.emblems || {}) { const m = MAT.emblems[k]; m.opacity = eA; m.color.setScalar(1 - dark * 0.5); }
    for (const b of s.buildings) {
      if (BUILDINGS[b.type].road) continue; // drawn with the road network
      seen.add(b.id);
      let o = this.bObjs.get(b.id);
      const state = b.done ? 'done' : 'site';
      if (!o || o.type !== b.type || o.state !== state || o.level !== bLevel(b)) {
        if (o) { this.removeObj(o.obj); if (o.site) this.removeObj(o.site); }
        o = this.makeBuildingObj(b, state);
        this.bObjs.set(b.id, o);
      }
      const def = BUILDINGS[b.type];
      const ud = o.obj.userData;
      if (!b.done) {
        // Age-of-Empires-style construction: foundation and materials, scaffolding goes up, then the walls rise inside it
        const f = clamp(b.progress / def.time, 0, 1);
        const sd = o.site.userData;
        o.dropT = Math.min(1, (o.dropT || 0) + (this._dt || 0.016) / 0.35); // the foundation thumps into place
        o.site.scale.set(0.55 + 0.45 * easeOutBack(o.dropT), 1, 0.55 + 0.45 * easeOutBack(o.dropT));
        const buildF = clamp((f - 0.12) / 0.88, 0, 1);
        const clipY = def.ht * buildF;
        o.plane.constant = clipY + 0.001;
        if (sd.scaffold) sd.scaffold.scale.y = clamp(0.12 + f * 1.6, 0.12, 1);
        sd.level.position.y = Math.max(0.05, clipY);
        sd.level.visible = buildF > 0.01 && buildF < 0.99;
        if (sd.piles) sd.piles.scale.setScalar(clamp(1 - f * 0.85, 0.15, 1));
        o.obj.visible = buildF > 0.005;
      } else {
        const pop = b.popT > 0 ? Math.sin((b.popT / 0.5) * Math.PI) * 0.1 : 0;
        o.obj.scale.set(1 + pop, 1 + pop * 1.4, 1 + pop);
        // upgrades: scaffolding goes up around the working building
        if (b.upgrading && !o.upSite) {
          o.upSite = Models.site(b.type);
          o.upSite.position.set(b.x, 0, b.z); o.upSite.rotation.y = b.rot || 0;
          o.upSite.userData.level.visible = false;
          this.scene.add(o.upSite);
        }
        if (o.upSite) {
          if (!b.upgrading) { this.removeObj(o.upSite); o.upSite = null; }
          else {
            const L = def.levels[bLevel(b) + 1];
            const f = clamp((b.upProg || 0) / L.time, 0, 1);
            const sd = o.upSite.userData;
            if (sd.scaffold) sd.scaffold.scale.y = clamp(0.2 + f * 1.4, 0.2, 1);
            if (sd.piles) sd.piles.scale.setScalar(clamp(1 - f * 0.85, 0.15, 1));
          }
        }
        // towers come alive: the cannon aims and recoils, the bell swings, braziers blaze
        if (ud.gun) {
          const t = nearestEnemy(s, b.x, b.z, TOWERS.cannontower.range, false);
          if (t) ud.gunAim = Math.atan2(t.x - b.x, t.z - b.z) - (b.rot || 0);
          if (ud.gunAim != null) { let d = ud.gunAim - ud.gun.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; ud.gun.rotation.y += d * 0.12; }
          ud.gun.position.z = b.fireT > 0 ? -0.12 * (b.fireT / 0.35) : 0;
        }
        if (ud.bell) {
          ud.bell.rotation.z = b.ringT > 0 ? Math.sin(b.ringT * 14) * 0.45 * b.ringT : Math.sin(time * 1.3 + b.id) * 0.03;
          ud.wave.visible = b.ringT > 0;
          if (b.ringT > 0) { const k = 1 - b.ringT; ud.wave.scale.setScalar(1 + k * TOWERS.belltower.range); ud.wave.material.opacity = 0.6 * b.ringT; }
        }
        if (ud.bigFlame2) animateFlames(ud.bigFlame2, time + b.id, b.fireT > 0 ? 1.4 : 1);
        if (ud.bays) this.syncBays(b, ud.piles);
        else if (ud.piles) this.syncPiles(ud.piles, b.stock || {}, (r) => stockCap(b, r));
      }
      if (ud.emblem) ud.emblem.visible = b.done && eA > 0.02;
      if (isFieldType(b.type) && ud.crops) {
        const g = clamp(b.grow / 30, 0, 1);
        ud.crops.scale.set(1, 0.15 + g * 0.85, 1);
        ud.crops.material.color.setHex(g < 0.7 ? lerpHex(0x86ad4a, 0xacb656, g / 0.7) : lerpHex(0xacb656, 0xe2b84e, (g - 0.7) / 0.3));
        ud.crops.rotation.z = Math.sin(time * 1.5 + b.id) * 0.01;
      }
      for (const f of ud.flags) f.rotation.y = Math.sin(time * 3 + b.id) * 0.45;
      const isLamp = b.type === 'lamp';
      const fired = !(b.type === 'kiln' || b.type === 'smelter') || (b.activeT || -9) > s.time - 1.5; // furnaces glow only while worked
      for (const f of ud.flames) { f.visible = (!isLamp || lit) && fired; f.scale.setScalar(0.8 + 0.3 * Math.sin(time * 12 + f.position.x * 7 + f.position.y * 3)); }
      if (ud.bigFlame) { ud.bigFlame.visible = lit && b.done; animateFlames(ud.bigFlame, time, 1); }
      if (b.done) {
        for (const L of ud.lights) {
          if (L.active ? !fired : !L.always && !lit) continue;
          const p = localToWorld(b, L.x, L.z);
          this.lightSrc.push({ x: p.x, y: L.y, z: p.z, r: L.r * (s.festival && isHome(b.type) ? 1.4 : 1), c: L.c, k: L.strong ? 1.6 : 1 });
        }
      }
    }
    for (const [id, o] of this.bObjs) if (!seen.has(id)) { this.retire(o.obj, 'building'); if (o.site) this.retire(o.site, 'building'); if (o.upSite) this.removeObj(o.upSite); this.bObjs.delete(id); }
    if (this.fireHeap) this.syncPiles(this.fireHeap, s.fireStock || {}, (r) => FIRE_HEAP[r].vis);
  },
  /** The Agnikund heap: one pile per good on the four sides of the fire. */
  buildFireHeap(g) {
    this.fireHeap = RES_ORDER.map((r) => {
      const h = FIRE_HEAP[r];
      const m = meshOf(Models.pileGeo(r, 5));
      m.position.set(h.x, heightAt(h.x, h.z), h.z);
      m.rotation.y = Math.atan2(h.x, h.z);
      m.scale.setScalar(0.78);
      m.visible = false;
      g.add(m);
      return { res: r, mesh: m, lv: -1, fire: true };
    });
  },
  /** Grow or shrink stockpile heaps in five steps; a heap gives a little bounce when it changes. */
  syncPiles(piles, st, capOf) {
    for (const p of piles) this.setPile(p, Math.floor(st[p.res] || 0), capOf(p.res));
  },
  /** Bhandar bays: each heap shows the good its bay is set to; bays of the same good fill one after another. */
  syncBays(b, piles) {
    const bays = storeBays(b), cap = BAY_CAP[bLevel(b)] || 30, st = b.stock || {}, left = {};
    for (const r of RES_ORDER) left[r] = Math.floor(st[r] || 0);
    piles.forEach((p, i) => {
      const r = bays[i];
      if (!r) { this.setPile(p, 0, cap); return; }
      if (p.res !== r) { p.res = r; p.lv = -1; } // the bay now holds a different good: rebuild its heap
      const n = Math.min(cap, left[r]);
      left[r] -= n;
      this.setPile(p, n, cap);
    });
  },
  setPile(p, n, cap) {
    const lv = n <= 0 || !cap ? 0 : clamp(Math.ceil((n / cap) * 5), 1, 5);
    if (p.sc == null) p.sc = p.mesh.scale.x;
    if (p.lv !== lv) {
      if (p.lv >= 0 && lv > 0) p.pop = 0.3;
      p.lv = lv;
      p.mesh.visible = lv > 0;
      if (lv > 0) setGeo(p.mesh, Models.pileGeo(p.res, lv));
    }
    if (p.pop > 0) { p.pop = Math.max(0, p.pop - (this._dt || 0.016)); p.mesh.scale.setScalar(p.sc * (1 + Math.sin((p.pop / 0.3) * Math.PI) * 0.1)); }
    else if (p.mesh.scale.x !== p.sc) p.mesh.scale.setScalar(p.sc);
  },
  makeBuildingObj(b, state) {
    const prev = this.bObjs.get(b.id);
    if (prev && prev.upSite) { this.removeObj(prev.upSite); prev.upSite = null; }
    const obj = Models.building(b.type, bLevel(b));
    obj.userData.bid = b.id;
    obj.position.set(b.x, 0, b.z);
    obj.rotation.y = b.rot || 0;
    const shared = (m) => m === MAT.std || m === MAT.bld;
    obj.traverse((c) => { if (c.isMesh && c.material && !shared(c.material) && !c.material.isMeshBasicMaterial && !c.userData.outline) c.material.userData.own = true; });
    const o = { obj, type: b.type, state, site: null, plane: null, level: bLevel(b), upSite: null };
    if (state === 'site') {
      // clip the model at the current build height so it rises layer by layer
      const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      const clip = (m) => { m.clippingPlanes = [plane]; m.clipShadows = true; m.userData.own = true; return m; };
      const std = clip(MAT.std.clone());
      const bld = MAT.bld === MAT.std ? std : clip(texturize(MAT.bld.clone(), 0.14)); // clone() drops the shader hook, so add it back
      const out = outlineMat(0.028); out.clippingPlanes = [plane]; out.userData.own = true;
      obj.traverse((c) => {
        if (!c.isMesh) return;
        if (c.userData.outline) c.material = out;
        else if (c.material === MAT.std) c.material = std;
        else if (c.material === MAT.bld) c.material = bld;
        else if (c.material.isMeshBasicMaterial) c.visible = false; // no flames or lights until finished
        else { c.material = c.material.clone(); c.material.clippingPlanes = [plane]; c.material.userData.own = true; }
      });
      for (const f of obj.userData.flags) f.visible = false;
      const site = Models.site(b.type);
      site.position.set(b.x, 0, b.z);
      site.rotation.y = b.rot || 0;
      site.traverse((c) => { c.userData.bid = b.id; });
      site.userData.bid = b.id;
      this.scene.add(site);
      o.site = site;
      o.plane = plane;
    }
    this.scene.add(obj);
    return o;
  },
  /*
   * Omens of a coming asura (s.omen, on his day). ramp grows from the first sign at dawn to full at dusk.
   * Everyone: an uneasy overcast light, a rising wind, birds fleeing from his side, and (from the warning
   * at midday) a plume of smoke or dust rising over the forest exactly where he will come from.
   * Bakasura: crows wheeling in silence. Raktabija: a reddening sky, a blood moon, the wells turning red.
   * Kalanemi: a violet mist and phantom figures at the forest edge. Mahasura: tremors, dust, cracks in the
   * ground, a cowering flame.
   */
  softTex() {
    if (this._soft) return this._soft;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return (this._soft = new THREE.CanvasTexture(c));
  },
  omens(s, time, du, dark, bg) {
    const om = s.omen, dt = this._dt || 0.016;
    const str = om ? clamp(om.ramp || 0, 0, 1) : 0, type = str > 0.01 ? om.type : null, live = type && !om.done;
    const eve = clamp(du * 1.5 + dark * 0.9, 0, 1), R = territory(s);
    const dx = om ? Math.sin(om.a) : 0, dz = om ? -Math.cos(om.a) : 1; // his side
    // everyone: the light turns grey and uneasy, the wind rises
    if (type) {
      const f = str * (1 - dark * 0.6);
      this.sun.intensity *= 1 - 0.32 * f;
      this.hemi.intensity *= 1 - 0.12 * f;
      const c2 = lerpHex(this.scene.background.getHex(), dark > 0.5 ? 0x1a1a22 : 0x8c8e96, f * 0.45);
      this.scene.background.setHex(c2); this.scene.fog.color.setHex(c2);
      bg = c2;
    }
    this.windMul = 1 + str * 1.3;
    this.moon.color.setHex(type === 'raktabija' ? lerpHex(0x7f8cff, 0xff4030, str) : 0x7f8cff);
    if (type === 'raktabija') { // the light itself turns red: dusk glows like embers, the moon bleeds
      const f = str * (0.22 + 0.6 * eve);
      const c2 = lerpHex(bg, dark > 0.5 ? 0x420812 : 0xc8382c, f);
      this.scene.background.setHex(c2); this.scene.fog.color.setHex(c2);
      this.hemi.color.setHex(lerpHex(this.hemi.color.getHex(), 0xff4a3a, f * 0.65));
      this.hemi.groundColor.setHex(lerpHex(this.hemi.groundColor.getHex(), 0x3a0608, f * 0.5));
      this.sun.color.setHex(lerpHex(this.sun.color.getHex(), 0xff3a20, f * 0.6));
      this.moon.intensity *= 1 + str * 0.8;
    } else if (type === 'kalanemi') {
      const f = str * (0.35 + 0.65 * eve);
      const c2 = lerpHex(bg, 0x6e5e94, f * 0.75);
      this.scene.background.setHex(c2); this.scene.fog.color.setHex(c2);
      const near = this.scene.fog.near, cd = this.cam.dist;
      this.scene.fog.near = cd + (near - cd) * (1 - 0.7 * f);
      this.scene.fog.far = cd + (this.scene.fog.far - cd) * (1 - 0.55 * f);
    } else if (type === 'boss' && live) { // the earth shudders, more often as he nears; dust lifts off the roofs
      this.quakeT = (this.quakeT == null ? rand(3, 7) : this.quakeT) - dt;
      if (this.quakeT <= 0) {
        this.quakeT = rand(9, 18) / (0.4 + str);
        this.shakeAmt = Math.max(this.shakeAmt || 0, 0.06 + 0.16 * str);
        for (let i = 0; i < 6 + str * 8; i++) { const a = Math.random() * Math.PI * 2, r = rand(2, R); emit(s, Math.cos(a) * r, 0.1, Math.sin(a) * r, 3, { spread: 0.5, vx: 0.8, vyMin: 0.2, vyMax: 0.8, life: 1.4, colors: ['#b8a07a', '#9a8460'], g: 0.5 }); }
        sfx('stomp', this.cam.x, this.cam.z);
      }
    }
    this.omenPlume(s, time, dt, live && om.stage >= 2 ? str : 0, R, dx, dz, om);
    this.omenBirds(s, time, dt, live && om.stage >= 1 ? str : 0, R, dx, dz);
    this.omenMist(s, time, type === 'kalanemi' ? str * (0.4 + 0.6 * eve) : 0, R);
    this.omenPhantoms(s, time, dt, type === 'kalanemi' && live && om.stage >= 1 ? str : 0, R, om);
    this.omenCracks(s, type === 'boss' ? str : 0, R, dx, dz);
    this.omenWells(s, type === 'raktabija' ? str : 0);
    this.omenCrows(s, time, dt, type === 'bakasura' && dark < 0.85 ? str : 0, R, dx, dz, om);
    // a distant voice from his side now and then, once the elders have named him
    if (live && om.stage >= 2) {
      this.voiceT = (this.voiceT == null ? rand(6, 12) : this.voiceT) - dt;
      if (this.voiceT <= 0) { this.voiceT = rand(16, 28) / (0.5 + str); const es = ENEMY_SFX[om.type]; if (es) sfx(es.voice, dx * (R + 3), dz * (R + 3)); }
    }
  },
  /** A plume rising over the forest where he will come from: dust, blood-red, violet or black smoke. */
  omenPlume(s, time, dt, str, R, dx, dz, om) {
    if (str < 0.01 && !this.plume) return;
    if (!this.plume) {
      this.plume = [];
      for (let i = 0; i < 22; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex(), color: 0x444444, transparent: true, depthWrite: false, opacity: 0, fog: false }));
        sp.userData = { h: i / 22, ph: rand(0, 6.3), s: rand(2.6, 4) };
        sp.renderOrder = 4; this.scene.add(sp); this.plume.push(sp);
      }
    }
    const col = om && OMENS[om.type] ? OMENS[om.type].smoke : 0x888888, bx = dx * (R + 3), bz = dz * (R + 3);
    for (const sp of this.plume) {
      sp.visible = str > 0.01;
      if (!sp.visible) continue;
      const u = sp.userData, h = (u.h + time * 0.03) % 1, top = 3 + 8 * str;
      sp.position.set(bx + Math.sin(time * 0.7 + u.ph) * (0.6 + h * 2.5), 1 + h * top, bz + Math.cos(time * 0.6 + u.ph) * (0.6 + h * 2.5));
      sp.scale.setScalar(u.s * (0.9 + h * 2.0));
      sp.material.color.setHex(col);
      sp.material.opacity = Math.min(0.85, str * 0.85) * Math.sin(h * Math.PI) * (0.8 + 0.2 * Math.sin(time + u.ph));
    }
  },
  /** Flocks of small birds fleeing out of the forest on his side and away over the village. */
  omenBirds(s, time, dt, str, R, dx, dz) {
    if (!this.flee) {
      const geo = merge([P(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.08, -0.32, 0.04, -0.03, 0, 0, -0.08, 0, 0, 0.08, 0, 0, -0.08, 0.32, 0.04, -0.03]), 3)), 0x3a2a20)]);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.flee = { birds: [], t: rand(4, 8), run: null };
      for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.userData = { o: [rand(-2, 2), rand(-0.6, 0.6), rand(-2, 2)], fl: rand(0, 6.3) }; this.scene.add(m); this.flee.birds.push(m); }
    }
    const F = this.flee;
    if (!F.run && str > 0.05) { F.t -= dt; if (F.t <= 0) { F.t = rand(12, 22) / (0.5 + str); const side = rand(-0.5, 0.5); F.run = { t: 0, dur: 7, sx: dx * (R + 14) - dz * side * 8, sz: dz * (R + 14) + dx * side * 8, h: rand(5, 8) }; sfx('bird', dx * (R + 4), dz * (R + 4)); } }
    for (const m of F.birds) m.visible = false;
    if (!F.run) return;
    const r = F.run;
    r.t += dt;
    const f = r.t / r.dur;
    if (f >= 1) { F.run = null; return; }
    for (const m of F.birds) {
      const u = m.userData, x = r.sx - dx * f * (2 * R + 28) + u.o[0], z = r.sz - dz * f * (2 * R + 28) + u.o[2];
      m.visible = true;
      m.position.set(x, r.h + u.o[1] + Math.sin(time * 3 + u.fl) * 0.2, z);
      m.rotation.set(0, Math.atan2(-dx, -dz), 0);
      m.scale.set(1, 0.3 + Math.abs(Math.sin(time * 14 + u.fl)) * 1.2, 1);
    }
  },
  /** Kalanemi's mist: soft violet banks drifting in from the forest over the edge of the village. */
  omenMist(s, time, mist, R) {
    if (mist > 0.01 && !this.mist) {
      this.mist = [];
      for (let i = 0; i < 46; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.softTex(), color: 0xb8a8e0, transparent: true, depthWrite: false, opacity: 0 }));
        sp.userData = { a: (i / 46) * Math.PI * 2 + rand(-0.06, 0.06), d: rand(-6, 6), s: rand(5, 9), ph: rand(0, 6.3), y: rand(0.4, 1.3) };
        sp.renderOrder = 5; this.scene.add(sp); this.mist.push(sp);
      }
    }
    if (!this.mist) return;
    for (const sp of this.mist) {
      const u = sp.userData;
      sp.visible = mist > 0.01;
      if (!sp.visible) continue;
      const a = u.a + time * 0.012, d = R + u.d + Math.sin(time * 0.2 + u.ph) * 1.5;
      sp.position.set(Math.sin(a) * d, u.y, -Math.cos(a) * d);
      sp.scale.set(u.s * 1.6, u.s * 0.55, 1);
      sp.material.opacity = mist * 0.5 * (0.7 + 0.3 * Math.sin(time * 0.5 + u.ph));
    }
  },
  /** Kalanemi: tall crowned figures stand at the forest edge for a moment, and are gone when you look again. */
  omenPhantoms(s, time, dt, str, R, om) {
    if (str < 0.01 && !this.phantoms) return;
    if (!this.phantoms) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#1a1030';
      x.beginPath(); x.moveTo(32, 6); x.lineTo(40, 26); x.lineTo(24, 26); x.closePath(); x.fill(); // crown
      x.beginPath(); x.arc(32, 34, 10, 0, Math.PI * 2); x.fill(); // head
      x.beginPath(); x.moveTo(18, 46); x.lineTo(46, 46); x.lineTo(54, 124); x.lineTo(10, 124); x.closePath(); x.fill(); // robe
      x.fillStyle = '#d0a8ff'; x.fillRect(26, 32, 4, 3); x.fillRect(34, 32, 4, 3); // eyes
      const tex = new THREE.CanvasTexture(c);
      this.phantoms = [];
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
        sp.scale.set(1.3, 2.6, 1); sp.userData = { t: rand(0, 6), on: false, x: 0, z: 0 };
        this.scene.add(sp); this.phantoms.push(sp);
      }
    }
    for (const sp of this.phantoms) {
      const u = sp.userData;
      sp.visible = str > 0.01;
      if (!sp.visible) continue;
      u.t -= dt;
      if (u.t <= 0) { // appear somewhere along the forest edge on his side, or fade away again
        u.on = !u.on; u.t = u.on ? rand(1.5, 3.5) : rand(4, 10) / (0.4 + str);
        if (u.on) { const a = om.a + rand(-0.7, 0.7), d = R + rand(2.5, 5); u.x = Math.sin(a) * d; u.z = -Math.cos(a) * d; }
      }
      sp.position.set(u.x, 1.3 + heightAt(u.x, u.z), u.z);
      const target = u.on ? 0.55 * str : 0;
      sp.material.opacity += (target - sp.material.opacity) * Math.min(1, dt * 3);
    }
  },
  /** Mahasura: cracks spread across the ground at the edge of the village on his side. */
  omenCracks(s, str, R, dx, dz) {
    if (str < 0.01 && !this.cracks) return;
    if (!this.cracks) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d'), rnd = mulberry32(7);
      x.strokeStyle = 'rgba(30, 18, 12, 0.9)'; x.lineCap = 'round';
      const crack = (px, py, a, len, w) => { for (let i = 0; i < 12 && len > 4; i++) { const nx = px + Math.cos(a) * len / 6, ny = py + Math.sin(a) * len / 6; x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke(); px = nx; py = ny; a += (rnd() - 0.5) * 0.9; w *= 0.88; if (rnd() < 0.2) crack(px, py, a + (rnd() - 0.5) * 2, len * 0.5, w); } };
      for (let i = 0; i < 7; i++) crack(128, 128, (i / 7) * Math.PI * 2 + rnd(), 150, 5);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0 }));
      m.rotation.x = -Math.PI / 2; m.renderOrder = 1; this.scene.add(m);
      this.cracks = m;
    }
    const m = this.cracks, px = dx * (R + 1.5), pz = dz * (R + 1.5);
    m.visible = str > 0.01;
    m.position.set(px, heightAt(px, pz) + 0.04, pz);
    m.scale.setScalar(0.4 + 0.6 * str);
    m.material.opacity = Math.min(1, str * 1.3);
  },
  /** Raktabija: the water in every well darkens to the colour of blood. */
  omenWells(s, str) {
    if (str < 0.01 && !this.wellTint) return;
    const want = new Set();
    this.wellTint = this.wellTint || new Map();
    if (str > 0.01) for (const b of s.buildings) if (b.type === 'well' && b.done) {
      want.add(b.id);
      let m = this.wellTint.get(b.id);
      if (!m) { m = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x8a0a14, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; this.scene.add(m); this.wellTint.set(b.id, m); }
      m.position.set(b.x, heightAt(b.x, b.z) + 0.6, b.z);
      m.material.opacity = 0.85 * Math.min(1, str * 1.6);
    }
    for (const [id, m] of this.wellTint) if (!want.has(id)) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.wellTint.delete(id); }
  },
  /** Bakasura's crows: a silent flock wheeling over the forest on his side, more of them as the day goes on. */
  omenCrows(s, time, dt, str, R, dx, dz, om) {
    if (str > 0.01 && !this.crows) {
      const geo = merge([P(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.12, -0.5, 0.06, -0.05, 0, 0, -0.12, 0, 0, 0.12, 0, 0, -0.12, 0.5, 0.06, -0.05]), 3)), 0x15121a), sph(0.08, 0x15121a, 0, 0, 0, 0.8, 0.7, 2)]);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
      this.crows = [];
      for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(geo, mat); m.userData = { r: rand(2.5, 6.5), h: rand(4.5, 7.5), sp: rand(0.35, 0.6) * (i % 5 === 0 ? -1 : 1), ph: rand(0, 6.3), fl: rand(0, 6.3), k: i / 26 }; this.scene.add(m); this.crows.push(m); }
    }
    if (!this.crows) return;
    const cx = dx * (R + 3), cz = dz * (R + 3);
    for (const m of this.crows) {
      const u = m.userData;
      m.visible = str > 0.01 && u.k < 0.35 + str * 0.65; // the flock grows through the day
      if (!m.visible) continue;
      const th = time * u.sp + u.ph;
      m.position.set(cx + Math.cos(th) * u.r, u.h + Math.sin(time * 0.7 + u.ph) * 0.6, cz + Math.sin(th) * u.r);
      m.rotation.set(0, -th + (u.sp > 0 ? 0 : Math.PI), Math.sin(th * 2) * 0.25);
      m.scale.set(1.3, 0.35 + Math.abs(Math.sin(time * 7 + u.fl)) * 1.1, 1.3); // wings beating
    }
    if (str > 0.01) { this.cawT = (this.cawT || 0) - dt; if (this.cawT <= 0) { this.cawT = rand(5, 11) / Math.max(0.5, str); sfx('crow', cx, cz); } }
  },
  /** Sleep: little "z" letters drift up from every home with sleepers inside and from those asleep by the fire. */
  syncZzz(s, dt) {
    if (!this.zTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.font = 'bold 50px Rubik, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineWidth = 7; x.strokeStyle = 'rgba(40,30,70,0.85)'; x.strokeText('z', 32, 34);
      x.fillStyle = '#eef3ff'; x.fillText('z', 32, 34);
      this.zTex = new THREE.CanvasTexture(c);
      this.zs = []; this.zSrc = new Map();
    }
    // where the sleepers are: one source per home, one per sleeper by the fire
    const src = new Map();
    for (const v of s.villagers) {
      if (!v.sleep) continue;
      if (v.inside && v.home) { const b = getB(s, v.home); if (b) { const k = 'b' + b.id; const e = src.get(k); if (e) e.n++; else src.set(k, { x: b.x, y: BUILDINGS[b.type].ht + 0.15, z: b.z, n: 1, gap: 1.0 }); } }
      else if (v.anim === 'sleep') src.set('v' + v.id, { x: v.x, y: 0.55, z: v.z, n: 1, gap: 1.5 });
    }
    for (const [k, e] of src) {
      let t = this.zSrc.get(k);
      if (t == null) t = Math.random() * e.gap;
      t -= dt * (e.n > 2 ? 1.4 : 1);
      if (t <= 0) {
        t += e.gap;
        let z = this.zs.find((q) => !q.sprite.visible);
        if (!z && this.zs.length < 80) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.zTex, transparent: true, depthWrite: false, opacity: 0 }));
          sp.renderOrder = 6; this.scene.add(sp);
          z = { sprite: sp }; this.zs.push(z);
        }
        if (z) Object.assign(z, { x: e.x + rand(-0.15, 0.15), y: e.y, z0: e.z + rand(-0.15, 0.15), t: 0, life: 2.4, ph: Math.random() * 6, big: e.y > 1 ? 1.25 : 1 }), z.sprite.visible = true;
      }
      this.zSrc.set(k, t);
    }
    for (const k of this.zSrc.keys()) if (!src.has(k)) this.zSrc.delete(k);
    for (const z of this.zs) {
      if (!z.sprite.visible) continue;
      z.t += dt;
      const f = z.t / z.life;
      if (f >= 1) { z.sprite.visible = false; continue; }
      const sp = z.sprite;
      sp.position.set(z.x + Math.sin(z.t * 2.2 + z.ph) * 0.12 + f * 0.25, z.y + f * 1.0, z.z0);
      sp.scale.setScalar((0.16 + f * 0.26) * z.big);
      sp.material.opacity = Math.min(1, f * 5) * (1 - f) * 0.95;
      sp.material.rotation = Math.sin(z.t * 1.7 + z.ph) * 0.25;
    }
  },
  syncLoot(s, time) {
    const seen = new Set();
    for (const l of s.loot) {
      seen.add(l.id);
      let o = this.lootObjs.get(l.id);
      if (!o) { o = Models.loot(l.kind); addSilhouette(o, 0xffd84a, 0.25); this.scene.add(o); this.lootObjs.set(l.id, o); }
      const bob = Math.sin(time * 3 + l.id) * 0.06;
      o.position.set(l.x, heightAt(l.x, l.z) + 0.05 + Math.max(0, bob), l.z);
      o.rotation.y = time * 1.2 + l.id;
      o.userData.halo.material.opacity = 0.25 + 0.15 * Math.sin(time * 4 + l.id);
      if (l.kind === 'gem' || l.kind === 'chest') this.lightSrc.push({ x: l.x, y: 0.6, z: l.z, r: 2.2, c: o.userData.glow, k: 0.8 });
    }
    for (const [id, o] of this.lootObjs) if (!seen.has(id)) { this.retire(o, 'loot'); this.lootObjs.delete(id); }
  },
  syncVillagers(s, time, dark, dt) {
    const seen = new Set();
    for (const v of s.villagers) {
      seen.add(v.id);
      let o = this.vObjs.get(v.id);
      if (!o || o.job !== v.job || o.armour !== (v.armour || null)) { // (new clothes: a new job, or armour put on or taken off)
        if (o) this.removeObj(o.obj);
        const obj = Models.villager(v.look, v.job, v.armour);
        addSilhouette(obj, slotKey(v.job) === 'army' ? 0x8fd0ff : 0xfff0c8, 0.5); // seen through trees and huts
        this.scene.add(obj);
        o = { obj, job: v.job, armour: v.armour || null, rot: v.rot, pose: o && o.pose, lx: o && o.lx, lz: o && o.lz, born: o ? 1 : undefined };
        this.vObjs.set(v.id, o);
      }
      const obj = o.obj, ud = obj.userData;
      obj.visible = !v.inside;
      if (v.inside) continue;
      let dr = v.rot - o.rot;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      o.rot += dr * Math.min(1, dt * 12);
      obj.position.set(v.x, heightAt(v.x, v.z), v.z);
      // walk cycle follows the distance actually covered, so feet never slide
      const moved = o.lx == null ? 0 : Math.hypot(v.x - o.lx, v.z - o.lz);
      o.lx = v.x; o.lz = v.z;
      o.spd = (o.spd || 0) + ((dt > 0 ? moved / dt : 0) - (o.spd || 0)) * Math.min(1, dt * 8);
      o.ph = (o.ph || 0) + moved * (o.spd > 3.1 ? 5.4 : 6.8);
      const t = v.animT, anim = v.anim;
      // off the screen (with room for shadows reaching in): nobody sees the pose, so it is not worked out
      this._vs.center.set(v.x, 0.8, v.z);
      const unseen = o.pose && this._frOk && !this._frustum.intersectsSphere(this._vs) && !(UI.selected && UI.selected.ref === v);
      let J = null;
      if (!o.pose) { J = villagerPose(v, o, t); o.pose = Object.assign({}, J); }
      const P = o.pose;
      if (unseen) obj.rotation.y = o.rot;
      else {
        if (!J) J = villagerPose(v, o, t);
        const fast = anim === 'atk' || v.blockT > 0;
        // ease every joint toward its target so poses blend instead of snapping (swings snap fast)
        const k = 1 - Math.exp(-dt * (fast ? 34 : anim === 'walk' ? 22 : anim === 'sleep' ? 5 : 12));
        for (const key of VJ_EASE) P[key] += (J[key] - (P[key] || 0)) * k;
        applyVillagerPose(obj, ud, P);
        obj.rotation.set(0, o.rot, P.lie * Math.PI / 2);
        if (ud.bowDrawn) { ud.bowDrawn.visible = !!J.drawn; ud.bowRest.visible = !J.drawn; }
        ud.torso.scale.y = 1 + Math.sin(time * (anim === 'sleep' ? 1.2 : 2.2) + v.id) * (anim === 'sleep' ? 0.02 : 0.012); // breathing
      }
      // the tokri: gatherers always wear one; its contents show the good and how full it is (3 steps)
      let pk = null;
      if (v.carryAmt > 0 && v.carry) pk = v.carry + clamp(Math.ceil((v.carryAmt / carryCap(s, v.carry)) * 3), 1, 3);
      else if (v.job === 'wood' || v.job === 'stone' || v.job === 'farm' || v.job === 'clay' || v.job === 'fish') pk = 'empty';
      if (o.lastAmt !== undefined && v.carryAmt > o.lastAmt) o.packPop = 0.25; // a bounce for every log or stone added
      o.lastAmt = v.carryAmt;
      if (pk !== o.pk) {
        o.pk = pk;
        ud.pack.visible = !!pk;
        if (pk) { const geo = Models.packGeo(pk); setGeo(ud.pack, geo); }
      }
      if (o.packPop > 0) { o.packPop = Math.max(0, o.packPop - dt); const b = Math.sin((o.packPop / 0.25) * Math.PI) * 0.14; ud.pack.scale.set(1 + b, 1 - b * 0.6, 1 + b); }
      else if (ud.pack.scale.x !== 1) ud.pack.scale.set(1, 1, 1);
      ud.pouch.visible = v.gold > 0;
      if (ud.pouch.visible) ud.pouch.rotation.x = -P.legL * 0.3; // the potli swings as they walk
      if (ud.torch) {
        const on = dark > 0.25 && anim !== 'sit';
        ud.torch.visible = on;
        if (on) {
          animateFlames(ud.torch.userData.flame, time + v.id, 1);
          this.lightSrc.push({ x: v.x, y: 1.2, z: v.z, r: 4.2, c: 0xffa040, k: 1.1 });
        }
      }
      if (ud.toolFlame) ud.toolFlame.scale.setScalar(0.8 + 0.3 * Math.sin(time * 12 + v.id));
      if ((v.power || 0) >= 100) this.lightSrc.push({ x: v.x, y: 0.9, z: v.z, r: 2.2, c: 0xffd27a, k: 0.55 + 0.25 * Math.sin(time * 6 + v.id) }); // Shakti ready: a golden glow
      o.born = Math.min(1, (o.born == null ? 0 : o.born) + dt * 3);
      const hs = (v.hurtT > 0 ? 1 + Math.sin(v.hurtT * 40) * 0.08 : 1) * (0.6 + 0.4 * easeOutBack(o.born));
      obj.scale.set(hs, hs, hs);
    }
    for (const [id, o] of this.vObjs) if (!seen.has(id)) { this.retire(o.obj, 'villager'); this.vObjs.delete(id); }
  },
  syncEnemies(s, time, dt) {
    const seen = new Set();
    for (const e of s.enemies) {
      seen.add(e.id);
      let o = this.eObjs.get(e.id);
      const def = ENEMIES[e.type];
      if (!o) {
        const obj = Models.enemy(e.type === 'danav' ? 'danav' : e.type, e.variant);
        addSilhouette(obj, 0xff5a4a, 0.5 * def.scale); // demons glow red through whatever hides them
        obj.scale.setScalar(def.scale);
        // its own copy of the surface so it can flash white when hit and smoulder red while winding up
        // (a fresh character material, not a clone: clone() would drop the hide and cloth shader)
        const fm = MAT.char && MAT.char !== MAT.std ? charMat() : MAT.std.clone(); fm.userData.own = true;
        const fg = MAT.bhoot.clone ? (MAT.tier === 'low' ? MAT.bhoot.clone() : ghostMat()) : null;
        if (fg) fg.userData.own = true;
        obj.traverse((c) => {
          if (!c.isMesh) return;
          if (c.material === MAT.std || c.material === MAT.char) c.material = fm;
          else if (fg && c.material === MAT.bhoot) c.material = fg;
        });
        this.scene.add(obj);
        o = { obj, rot: e.rot, born: 0, pose: { legs: 0, armR: -0.2, armL: 0.1, lean: 0 }, fm, fg };
        this.eObjs.set(e.id, o);
      }
      const obj = o.obj, ud = obj.userData;
      // hit flash, wind-up glow, stunned
      const flash = e.flashT > 0 ? e.flashT / 0.12 : 0, wind = e.wind ? clamp(e.wind.t / e.wind.dur, 0, 1) : 0, stun = e.stunT > 0;
      if (flash > 0) o.fm.emissive.setRGB(flash, flash * 0.9, flash * 0.8);
      else if (wind > 0) o.fm.emissive.setRGB(0.42 * wind, 0.04 * wind, 0.02 * wind);
      else if (stun) o.fm.emissive.setRGB(0.14, 0.12, 0.02);
      else if (e.frenzyT > 0) o.fm.emissive.setRGB(0.22 + 0.08 * Math.sin(time * 10), 0.02, 0.0); // raging after a roar
      else if (o.fm.emissive.r || o.fm.emissive.g) o.fm.emissive.setRGB(0, 0, 0);
      if (o.fg) { if (flash > 0) o.fg.emissive.setRGB(flash, flash, flash); else o.fg.emissive.setHex(0x2a3848); } // ghosts flash too
      if (stun && !o.stars) { // three little stars circling the head
        o.stars = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color: 0xffe27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
          sp.material.userData.own = true;
          const a = (i / 3) * Math.PI * 2;
          sp.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3); sp.scale.setScalar(0.22);
          o.stars.add(sp);
        }
        o.stars.position.y = def.h / def.scale + 0.12;
        obj.add(o.stars);
      }
      if (o.stars) { o.stars.visible = stun; if (stun) o.stars.rotation.y = time * 7; }
      let dr = e.rot - o.rot;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      o.rot += dr * Math.min(1, dt * 8);
      obj.rotation.y = o.rot;
      // demons claw their way up out of the ground when they appear
      o.born = Math.min(1, o.born + dt / 0.9);
      const rise = def.fly ? 0 : (1 - easeOutCubic(o.born)) * -1.4 * def.scale;
      obj.position.set(e.x, (def.fly ? 0 : heightAt(e.x, e.z)) + e.y + rise, e.z);
      const moving = Math.hypot(e.vx || 0, e.vz || 0) > 0.05;
      const t = e.animT;
      const P = o.pose, k = 1 - Math.exp(-dt * 14);
      const atk = e.atkAnim > 0 ? e.atkAnim / 0.4 : 0;
      const tLegs = moving ? Math.sin(t * 8) * 0.5 : 0;
      let tArmR = atk > 0 ? -2.6 * Math.sin(atk * Math.PI * 0.5) + 0.3 : (moving ? -Math.sin(t * 8) * 0.4 : -0.2 + Math.sin(t * 2) * 0.06);
      let tArmL = moving ? Math.sin(t * 8) * 0.4 : 0.1 + Math.sin(t * 2.3) * 0.05;
      let tLean = atk > 0 ? 0.3 * atk : 0;
      if (wind > 0) { tArmR = -3.0 * easeOutCubic(wind); tArmL = -1.1 * wind; tLean = -0.28 * wind; } // the telegraph: rear back, arm high
      if (e.grab) { tArmR = -1.55; tArmL = -1.55; tLean = 0.25 + Math.sin(time * 18) * 0.04; } // both hands on the victim
      if (e.charge) { tLean = 0.45; tArmR = 0.4; tArmL = 0.4; } // head down, charging
      if (stun) { tArmR = 0.35; tArmL = 0.35; tLean = 0.12; }
      P.legs += (tLegs - P.legs) * k; P.armR += (tArmR - P.armR) * (atk > 0 ? 0.6 : k); P.armL += (tArmL - P.armL) * k; P.lean += (tLean - P.lean) * k;
      if (ud.legs.length === 4) { // a beast's trot: diagonal pairs move together, a little faster than a biped's stride
        const q = moving ? Math.sin(t * 11) * 0.6 : 0;
        ud.legs[0].rotation.x = q; ud.legs[3].rotation.x = q; ud.legs[1].rotation.x = -q; ud.legs[2].rotation.x = -q;
      } else if (ud.legs.length) { ud.legs[0].rotation.x = P.legs; ud.legs[1].rotation.x = -P.legs; }
      if (ud.head) ud.head.rotation.x = atk > 0 ? Math.sin(atk * Math.PI) * 0.55 : wind > 0 ? -0.3 * wind : Math.sin(t * 2.2 + e.id) * 0.06; // the bite (and rearing back to pounce)
      if (ud.tail) ud.tail.rotation.y = Math.sin(t * (moving ? 9 : 3) + e.id) * (moving ? 0.5 : 0.25);
      for (let i = 0; i < ud.wisps.length; i++) { const w = ud.wisps[i]; w.rotation.z = Math.sin(t * 3 + i * 0.9 + e.id) * 0.25; w.rotation.x = Math.cos(t * 2.4 + i * 0.7) * 0.18; } // the ghost's coil ripples
      if (ud.arms.length) { const base = ud.armBase || 0; ud.arms[1].rotation.x = P.armR * (base ? 0.4 : 1) + base; ud.arms[0].rotation.x = P.armL * (base ? 0.4 : 1) + base + (base ? Math.sin(t * 2) * 0.12 : 0); }
      if (ud.hips) {
        ud.hips.rotation.z = stun ? Math.sin(time * 9 + e.id) * 0.22 : moving ? Math.sin(t * 8) * 0.05 : Math.sin(t * 1.8) * 0.02;
        ud.hips.rotation.x = P.lean * (ud.legs.length === 4 ? 0.35 : 1); // (a beast only dips its shoulders)
        ud.hips.position.y = (ud.hipY || 0.5) + (moving ? Math.abs(Math.cos(t * 8)) * 0.04 : 0);
      }
      if (ud.neckFlame) ud.neckFlame.scale.set(1, 0.8 + 0.3 * Math.sin(t * 13 + e.id) + 0.1 * Math.sin(t * 29), 1);
      if (ud.halo) ud.halo.scale.setScalar(0.85 + 0.25 * Math.sin(t * 6 + e.id));
      obj.visible = !(e.hidden > 0); // Kalanemi, gone into his maya
      if (ud.orb) ud.orb.scale.setScalar(0.85 + 0.3 * Math.sin(t * 5 + e.id));
      if (def.glow && !e.burning && !e.dead) this.lightSrc.push({ x: e.x, y: e.y + def.h * 0.8, z: e.z, r: def.fly ? 2.6 : 2.2, c: def.glow, k: def.fly ? 0.7 : 0.45 });
      if (ud.neckFlame && !e.burning) this.lightSrc.push({ x: e.x, y: 2.2, z: e.z, r: 2.6, c: 0x6fa8ff, k: 0.55 });
      if (ud.wings.length) { const f = Math.sin(t * 16) * 0.7; ud.wings[0].rotation.z = f; ud.wings[1].rotation.z = -f; }
      if (ud.body) { ud.body.rotation.z = Math.sin(t * 2.5) * 0.08; ud.body.position.y = Math.sin(t * 3) * 0.05; }
      const hs = (e.hurtT > 0 ? 1.12 : 1) * def.scale * (0.4 + 0.6 * easeOutCubic(o.born));
      obj.scale.setScalar(obj.scale.x + (hs - obj.scale.x) * 0.5);
      if (e.type === 'bhoot') this.lightSrc.push({ x: e.x, y: 1, z: e.z, r: 2.2, c: 0x9ab8ff, k: 0.5 });
      if (e.burning) this.lightSrc.push({ x: e.x, y: 1, z: e.z, r: 3, c: 0xff7a30, k: 0.8 });
    }
    for (const [id, o] of this.eObjs) if (!seen.has(id)) { this.retire(o.obj, 'enemy'); this.eObjs.delete(id); }
  },
  syncAmbient(s, time) {
    while (this.aObjs.length < s.ambient.length) {
      const a = s.ambient[this.aObjs.length];
      const o = a.kind === 'cow' ? Models.cow() : Models.peacock();
      this.scene.add(o);
      this.aObjs.push(o);
    }
    s.ambient.forEach((a, i) => {
      const o = this.aObjs[i];
      o.visible = !a.hidden;
      const ty = heightAt(a.x, a.z) - (a.sit ? 0.22 : 0) + (a.walk ? Math.abs(Math.sin(time * 6)) * 0.02 : 0);
      o.position.set(a.x, o.position.y + (ty - o.position.y) * 0.15, a.z); // lie down / stand up smoothly
      let dr = (a.rot || 0) - o.rotation.y;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      o.rotation.y += dr * 0.08;
      if (o.userData.legs) { const w = a.walk ? Math.sin(time * 6) * 0.4 : 0; o.userData.legs.forEach((L, k) => (L.rotation.x += ((k % 2 ? w : -w) - L.rotation.x) * 0.3)); }
      if (o.userData.tail) o.userData.tail.rotation.x += ((a.fan > 0 ? -1.3 : -0.15) - o.userData.tail.rotation.x) * 0.08; // the peacock fans out slowly
    });
  },
  syncArrows(s) {
    if (!this.arrowGeo) {
      this.arrowGeo = Models.arrow();
      this.potGeo = merge([sph(0.15, 0xb5532f, 0, 0, 0), cyl(0.07, 0.09, 0.08, 10, 0x8f3f22, 0, 0.13, 0)]);
      this.ballGeo = merge([sph(0.17, 0x2a2a30, 0, 0, 0)]);
      this.rockGeo = merge([sph(0.26, 0x8a8681, 0, 0, 0, 1.1, 0.85, 1), sph(0.14, 0x76726d, 0.15, 0.1, 0.05)]);
      this.chakGeo = merge([P(new THREE.TorusGeometry(0.17, 0.028, 4, 20), 0xd8dde6, 0, 0, 0, Math.PI / 2), P(new THREE.TorusGeometry(0.13, 0.01, 3, 18), 0xe8b830, 0, 0.012, 0, Math.PI / 2)]);
      for (const g of [this.arrowGeo.geometry, this.potGeo, this.ballGeo, this.rockGeo, this.chakGeo]) g.userData.shared = true;
      this.shellPool = { pot: [], ball: [], rock: [], chakram: [] };
    }
    const arrows = [], shells = { pot: [], ball: [], rock: [], chakram: [] };
    for (const p of s.projectiles) (shells[p.kind] || arrows).push(p);
    if (!this.trailGeo) { // two crossed glowing ribbons behind each arrow, so a shot reads as a streak
      const a = new THREE.PlaneGeometry(0.07, 1).translate(0, -0.5, 0).rotateX(Math.PI / 2);
      const b = a.clone().rotateZ(Math.PI / 2);
      this.trailGeo = merge([a, b].map((g0) => { const g = g0.toNonIndexed(); const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < g.attributes.position.count; i++) { const k = 1 + g.attributes.position.getZ(i); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = clamp(k, 0, 1); } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
      this.trailGeo.userData.shared = true;
    }
    while (this.arrows.length < arrows.length) {
      const m = new THREE.Mesh(this.arrowGeo.geometry, MAT.std);
      m.castShadow = true;
      const tr = new THREE.Mesh(this.trailGeo, this.fxMat(true));
      tr.renderOrder = 5; tr.userData.noAO = true;
      m.add(tr); m.userData.trail = tr;
      this.scene.add(m);
      this.arrows.push(m);
    }
    this.arrows.forEach((m, i) => {
      const p = arrows[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, p.y, p.z);
      if (!p.stuck) m.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      const big = p.kind === 'astra' ? 2.4 : 1;
      if (m.scale.x !== big) m.scale.setScalar(big);
      if (big > 1) this.lightSrc.push({ x: p.x, y: p.y, z: p.z, r: 4, c: 0xff8a30, k: 1.2 });
      const tr = m.userData.trail;
      tr.visible = !p.stuck && !p.practice;
      if (tr.visible) {
        const col = p.fire ? 0xff8a1f : p.crit ? 0xffd84a : 0xfff2d0;
        if (tr.material.color.getHex() !== col) tr.material.color.setHex(col);
        tr.material.opacity = p.fire || p.crit ? 0.9 : 0.45;
        tr.scale.set(p.fire || p.crit ? 1.6 : 1, 1, Math.min(1.5, Math.hypot(p.vx, p.vy, p.vz) * 0.075));
      }
    });
    for (const k of ['pot', 'ball', 'rock', 'chakram']) {
      const pool = this.shellPool[k], list = shells[k];
      while (pool.length < list.length) {
        const m = new THREE.Mesh(k === 'pot' ? this.potGeo : k === 'rock' ? this.rockGeo : k === 'chakram' ? this.chakGeo : this.ballGeo, MAT.std);
        if (k === 'chakram') { const tr = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.3, 20).rotateX(-Math.PI / 2), this.fxMat(true)); tr.material.color.setHex(0xcfe4ff); tr.material.opacity = 0.35; tr.renderOrder = 5; m.add(tr); }
        m.castShadow = true;
        if (k === 'pot') { const fl = flameCluster(0.14); fl.position.y = 0.12; m.add(fl); m.userData.fl = fl; }
        this.scene.add(m);
        pool.push(m);
      }
      pool.forEach((m, i) => {
        const p = list[i];
        m.visible = !!p;
        if (!p) return;
        m.position.set(p.x, p.y, p.z);
        if (k === 'chakram') { m.rotation.set(0.25, (m.rotation.y || 0) + 0.9, 0); } else { m.rotation.x += 0.2; m.rotation.z += 0.13; } // a chakram spins flat as it flies
        if (m.userData.fl) { animateFlames(m.userData.fl, s.time * 2 + i, 1); this.lightSrc.push({ x: p.x, y: p.y, z: p.z, r: 3, c: 0xff7a30, k: 1 }); }
      });
    }
  },
  syncParticles(s, time, dark, dt) {
    const fill = (pts, list) => {
      const pos = pts.geometry.attributes.position, col = pts.geometry.attributes.color;
      const n = Math.min(list.length, pos.count);
      for (let i = 0; i < n; i++) {
        const p = list[i];
        pos.setXYZ(i, p[0], p[1], p[2]);
        col.setXYZ(i, p[3], p[4], p[5]);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      pts.geometry.setDrawRange(0, n);
    };
    const nrm = [], add = [];
    const cc = new THREE.Color();
    for (const p of s.particles) {
      cc.set(p.color);
      if (p.add) { const f = clamp(p.life / p.max, 0, 1); add.push([p.x, p.y, p.z, cc.r * f, cc.g * f, cc.b * f]); }
      else nrm.push([p.x, p.y, p.z, cc.r, cc.g, cc.b]);
    }
    fill(this.pNormal, nrm);
    fill(this.pAdd, add);
    // fireflies around the camera at night
    const fl = [];
    if (dark > 0.3) {
      const c = this.cam;
      for (let i = 0; i < 70; i++) {
        const bx = c.x + (hash(i * 3 + 1) - 0.5) * 50, bz = c.z + (hash(i * 7 + 2) - 0.5) * 50;
        if (Math.hypot(bx, bz) < territory(s)) continue;
        const a = 0.5 + 0.5 * Math.sin(time * 3 + i);
        fl.push([bx + Math.sin(time * 0.6 + i) * 1.2, 0.6 + Math.sin(time + i * 2) * 0.4 + hash(i) * 1.5, bz + Math.cos(time * 0.5 + i) * 1.2, 0.75 * a * dark, 1.0 * a * dark, 0.4 * a * dark]);
      }
    }
    fill(this.pFly, fl);
    // rain
    this.rain.visible = s.weather === 'rain';
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position, c = this.cam;
      this.rainDrops.forEach((d, i) => {
        d[1] -= dt * 18;
        if (d[1] < 0) { d[1] = 22; d[0] = rand(-30, 30); d[2] = rand(-30, 30); }
        const x = c.x + d[0], z = c.z + d[2];
        pos.setXYZ(i * 2, x, d[1], z);
        pos.setXYZ(i * 2 + 1, x + 0.1, d[1] - 0.7, z + 0.05);
      });
      pos.needsUpdate = true;
    }
  },
  syncSelection(s, time) {
    const sel = typeof UI !== 'undefined' ? UI.selected : null;
    const r = this.selRing;
    r.visible = false;
    if (!sel || !sel.ref) return;
    let x, z, sc = 1;
    if (sel.kind === 'villager' && sel.ref.inside) return;
    if (sel.kind === 'villager' || sel.kind === 'enemy' || sel.kind === 'animal' || sel.kind === 'tree' || sel.kind === 'rock' || sel.kind === 'loot') { x = sel.ref.x; z = sel.ref.z; if (sel.kind === 'enemy') sc = ENEMIES[sel.ref.type].r * 2.2; }
    else if (sel.kind === 'building') { x = sel.ref.x; z = sel.ref.z; const d = BUILDINGS[sel.ref.type]; sc = Math.max(d.fw, d.fd) * 0.85; }
    else if (sel.kind === 'fire') { x = 0; z = 0; sc = 2.4; }
    if (x == null) return;
    r.visible = true;
    r.position.set(x, heightAt(x, z) + 0.05, z);
    const p = 1 + Math.sin(time * 5) * 0.05;
    r.scale.set(sc * p, sc * p, 1);
  },
  updateLights(s, time, dark) {
    const c = this.cam;
    const rain = s.weather === 'rain';
    const t = s.t;
    const frac = clamp(t / (DUSK_T + 18), 0, 1);
    const el = Math.sin(frac * Math.PI);
    const az = lerp(-2.0, 2.0, frac);
    const sun = this.sun;
    // a sun that never climbs too high: long, sculpting shadows all day, like late-morning light
    sun.position.set(c.x + Math.cos(az) * 40 * (1 - el * 0.5), 13 + el * 34, c.z + Math.sin(az) * 30 - 20);
    sun.target.position.set(c.x, 0, c.z);
    const du = duskAmt(t);
    const modern = MAT.tier !== 'low';
    sun.intensity = (modern ? 0.92 : 0.76) * clamp(el * 3, 0, 1) * (1 - dark) * (rain ? 0.45 : 1);
    if (this.bloomPass) { // glow: a whisper by day, the fire and ghost lights bloom at night
      this.bloomPass.strength = lerp(0.12, 0.75, dark);
      this.bloomPass.threshold = lerp(0.97, 0.7, dark);
    }
    // The sun's shadow stays switched on all night: switching it off and on again made three.js rebuild
    // every material's shader at dusk and at dawn (a quarter-second freeze). At night it just stops being redrawn.
    if (sun.castShadow !== this.Q.shadows) sun.castShadow = this.Q.shadows;
    this.sunShadowLive = sun.intensity > 0.04;
    sun.color.setHex(lerpHex(SUN_DAY, 0xff9a50, du));
    const half = clamp(c.dist * 1.05, 18, 48);
    const sh = sun.shadow.camera;
    if (Math.abs(sh.right - half) > 2) { sh.left = -half; sh.right = half; sh.top = half; sh.bottom = -half; sh.updateProjectionMatrix(); }
    this.hemi.intensity = lerp(modern ? 0.5 : 0.6, modern ? 0.2 : 0.17, dark) * (rain ? 0.85 : 1);
    this.hemi.color.setHex(lerpHex(lerpHex(HEMI_SKY, 0xffd0a8, du), 0x4a5aa8, dark));
    this.hemi.groundColor.setHex(lerpHex(HEMI_GROUND, 0x141830, dark));
    // the moon calendar shows in the night: a full moon floods the village with cold light, the red moon
    // stains everything the colour of blood, the new moon (Deepavali) leaves it to the diyas
    const moon = moonOf(s.day), red = moon === 'red' ? dark : 0;
    this.moon.intensity = 0.24 * dark * (moon === 'full' ? 2.6 : moon === 'red' ? 2.8 : moon === 'new' ? 0.5 : 1);
    this.moon.color.setHex(moon === 'red' ? 0xff2a1a : moon === 'full' ? 0xc8d6ff : 0x7f8cff);
    this.moon.position.set(c.x - 25, 40, c.z + 15);
    this.moon.target.position.set(c.x, 0, c.z);
    if (red) { this.hemi.color.setHex(lerpHex(this.hemi.color.getHex(), 0xc41414, red * 0.95)); this.hemi.groundColor.setHex(lerpHex(this.hemi.groundColor.getHex(), 0x3a0606, red)); this.hemi.intensity *= 1 + red * 0.6; }
    else if (moon === 'full') { this.hemi.color.setHex(lerpHex(this.hemi.color.getHex(), 0x8a9ae0, dark * 0.7)); this.hemi.intensity *= 1 + dark * 0.5; }
    let bg = lerpHex(SKY_DAY, 0xf0a878, du);
    bg = lerpHex(bg, moon === 'red' ? 0x4a0810 : moon === 'full' ? 0x1e2c60 : 0x0b1030, dark);
    if (rain) bg = lerpHex(bg, 0x6a7484, 0.5);
    this.scene.background.setHex(bg);
    this.scene.fog.color.setHex(bg);
    const lowQ = this.Q.farCull;
    this.scene.fog.near = c.dist + lerp(lowQ ? 14 : 40, 6, dark);
    this.scene.fog.far = c.dist + lerp(lowQ ? 34 : 130, lowQ ? 30 : 45, dark);
    this.omens(s, time, du, dark, bg);
    if (this.sky) { // the dome: its horizon is the haze colour (after the omens have tinted it), deep blue overhead
      const u = this.sky.material.uniforms;
      u.uHor.value.copy(this.scene.background);
      u.uTop.value.setHex(lerpHex(lerpHex(lerpHex(0x4a8edc, 0x6a78b8, du), 0x060b26, dark), 0x5a6474, rain ? 0.65 : 0));
      this.sky.position.copy(this.camera.position);
    }
    const F = s.fire, FL = fireLv(s);
    const flick = 1 + Math.sin(time * 10) * 0.06 + Math.sin(time * 23) * 0.04;
    this.fireLight.intensity = (0.12 + 1.15 * dark) * (0.35 + 0.65 * F.intensity) * flick * (s.omen && s.omen.type === 'boss' ? 1 - 0.22 * (s.omen.ramp || 0) * (0.6 + 0.4 * Math.sin(time * 0.9)) : 1); // the flame cowers before Mahasura
    this.fireLight.distance = FL.light * (0.6 + 0.4 * F.intensity);
    this.fireLight.position.y = 1.6 + s.fire.level * 0.15;
    // pick the light sources nearest the view
    const src = this.lightSrc;
    for (const L of src) L.d = distXZ(L.x, L.z, c.x, c.z);
    src.sort((a, b) => a.d - b.d);
    const budget = this.Q.lights;
    this.pool.forEach((L, i) => {
      const S2 = i < budget ? src[i] : null;
      if (!S2) { L.intensity = 0; return; }
      L.position.set(S2.x, S2.y, S2.z);
      L.color.setHex(S2.c);
      L.distance = S2.r * 1.6;
      L.intensity = (0.08 + 0.55 * dark) * Math.min(S2.k || 1, 1.2) * (0.9 + 0.1 * Math.sin(time * 12 + i));
    });
  },

  /* ---------- combat effects ----------
   * The simulation drops events into s.fx; each becomes a short-lived glowing shape from a pool:
   * slash arcs, spear streaks, impact stars, ground shockwaves, warning glints and death bursts.
   */
  initFX() {
    // a soft four-point star for impacts, glints and stun stars
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.22, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 4; i++) {
      const L = i % 2 ? 20 : 31;
      g.save(); g.translate(32, 32); g.rotate((i * Math.PI) / 4);
      g.beginPath(); g.moveTo(-L, 0); g.lineTo(0, -2.4); g.lineTo(L, 0); g.lineTo(0, 2.4); g.closePath(); g.fill();
      g.restore();
    }
    this.starTex = new THREE.CanvasTexture(cv);
    // brightness baked into vertex colours: arcs glow at the leading edge and fade toward the tail
    const shade = (geo, fn) => {
      const p = geo.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const b = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = b; }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return geo;
    };
    const A0 = Math.PI / 2 - 1.2, AL = 2.4;
    const arc = shade(new THREE.RingGeometry(0.36, 0.82, 24, 1, A0, AL), (x, y) => {
      const a = (Math.atan2(y, x) - A0) / AL, r = (Math.hypot(x, y) - 0.36) / 0.46;
      return Math.pow(clamp(a, 0, 1), 1.6) * (0.3 + 0.7 * r);
    });
    const streak = shade(new THREE.PlaneGeometry(0.16, 1, 1, 6).translate(0, 0.5, 0), (x, y) => Math.pow(clamp(y, 0, 1), 1.3) * (1 - Math.abs(x) / 0.1 * 0.6)).rotateX(Math.PI / 2);
    const ring = shade(new THREE.RingGeometry(0.78, 1, 56, 1), (x, y) => clamp((Math.hypot(x, y) - 0.78) / 0.22, 0, 1)).rotateX(-Math.PI / 2);
    const beam = new THREE.CylinderGeometry(0.045, 0.045, 1, 6, 1, true).translate(0, 0.5, 0);
    for (const geo of [arc, streak, ring, beam]) geo.userData.shared = true;
    this.fxGeo = { arc, streak, ring, beam };
    this.fxPool = { arc: [], streak: [], ring: [], star: [], beam: [] };
    this.fxLive = [];
    this.beams = [];
  },
  fxMat(vc) { return new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: !!vc, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }); },
  fxGet(type) {
    let o = this.fxPool[type].pop();
    if (!o) {
      if (type === 'star') {
        o = { root: new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })) };
        o.mat = o.root.material;
      } else {
        o = { root: new THREE.Group(), tilt: new THREE.Group(), mat: this.fxMat(type !== 'beam') };
        o.mesh = new THREE.Mesh(this.fxGeo[type], o.mat);
        o.mesh.frustumCulled = false;
        o.root.add(o.tilt); o.tilt.add(o.mesh);
      }
      o.type = type;
      o.root.renderOrder = 5;
      o.root.userData.noAO = true;
      this.scene.add(o.root);
    }
    o.root.visible = true;
    return o;
  },
  fxPut(o) { o.root.visible = false; this.fxPool[o.type].push(o); },
  spawnFX(ev) {
    if (this.fxLive.length > 140 && (ev.kind === 'impact' || ev.kind === 'slash')) return;
    const gy = (x, z) => heightAt(x, z);
    const add = (o, life, data) => { this.fxLive.push(Object.assign({ o, t: 0, life }, data)); return o; };
    const c = ev.c != null ? ev.c : 0xffffff;
    switch (ev.kind) {
      case 'slash': case 'smash': {
        const o = this.fxGet('arc');
        o.root.position.set(ev.x, gy(ev.x, ev.z) + (ev.kind === 'smash' ? 0.75 : 0.85), ev.z);
        o.root.rotation.set(0, ev.rot, 0);
        const sc = (ev.len || 1.2) / 0.85 * (ev.heavy ? 1.15 : 1);
        if (ev.kind === 'smash') { o.tilt.rotation.set(0, 0, 0); o.mesh.rotation.set(0, Math.PI / 2, 0); o.mesh.scale.set(sc, sc, sc); }
        else { o.tilt.rotation.set(0, 0, (ev.side || 1) * 0.5); o.mesh.rotation.set(Math.PI / 2, 0, 0); o.mesh.scale.set(sc * (ev.side || 1), sc, sc); }
        o.mat.color.setHex(c);
        add(o, ev.heavy ? 0.26 : 0.2, { kind: ev.kind, rot: ev.rot, side: ev.side || 1, sc });
        break;
      }
      case 'thrust': {
        const o = this.fxGet('streak');
        o.root.position.set(ev.x, gy(ev.x, ev.z) + 0.95, ev.z);
        o.root.rotation.set(0, ev.rot, 0);
        o.tilt.rotation.set(0, 0, 0); o.mesh.rotation.set(0, 0, 0);
        o.mat.color.setHex(c);
        add(o, ev.heavy ? 0.22 : 0.16, { kind: 'thrust', len: ev.len || 1.4, w: ev.heavy ? 1.6 : 1 });
        break;
      }
      case 'impact': case 'telegraph': {
        const o = this.fxGet('star');
        o.root.position.set(ev.x, (ev.y || 0.8) + gy(ev.x, ev.z), ev.z);
        o.mat.color.setHex(c);
        o.mat.rotation = Math.random() * Math.PI;
        add(o, ev.kind === 'telegraph' ? ev.dur || 0.4 : 0.2, { kind: ev.kind, s: (ev.s || 1) * 0.85, a: ev.a || 0.85 });
        break;
      }
      case 'ring': {
        const o = this.fxGet('ring');
        o.root.position.set(ev.x, gy(ev.x, ev.z) + 0.07, ev.z);
        o.root.rotation.set(0, 0, 0); o.tilt.rotation.set(0, 0, 0); o.mesh.rotation.set(0, 0, 0);
        o.mat.color.setHex(c);
        add(o, ev.dur || 0.5, { kind: 'ring', r: ev.r || 2 });
        break;
      }
      case 'death': {
        this.spawnFX({ kind: 'impact', x: ev.x, y: ev.y, z: ev.z, c, s: 1.4 * (ev.s || 1), a: 0.7 });
        this.spawnFX({ kind: 'impact', x: ev.x, y: ev.y, z: ev.z, c: 0xffffff, s: 0.7 * (ev.s || 1), a: 0.6 });
        this.spawnFX({ kind: 'ring', x: ev.x, z: ev.z, r: 1.3 * (ev.s || 1), c, dur: 0.45 });
        break;
      }
    }
  },
  updateFX(s, dt) {
    if (s.fx && s.fx.length) { for (const ev of s.fx) this.spawnFX(ev); s.fx.length = 0; }
    for (const L of this.fxLive) {
      L.t += dt;
      const f = clamp(L.t / L.life, 0, 1), o = L.o;
      switch (L.kind) {
        case 'slash': // sweeps across in front of the soldier as it fades
          o.root.rotation.y = L.rot + L.side * (0.55 - f * 1.0);
          o.mat.opacity = f < 0.2 ? f / 0.2 : 1 - (f - 0.2) / 0.8;
          o.tilt.scale.setScalar(0.85 + f * 0.3);
          break;
        case 'smash': // a vertical arc chopping down in front
          o.tilt.rotation.x = -0.35 + f * 1.4;
          o.mat.opacity = f < 0.2 ? f / 0.2 : 1 - (f - 0.2) / 0.8;
          break;
        case 'thrust':
          o.mesh.scale.set(L.w, 1, L.len * (0.35 + 0.65 * easeOutCubic(f / 0.5)));
          o.mat.opacity = f < 0.5 ? 1 : 1 - (f - 0.5) / 0.5;
          break;
        case 'impact':
          o.root.scale.setScalar(L.s * (0.3 + 0.75 * easeOutCubic(f)));
          o.mat.opacity = L.a * (1 - f * f);
          break;
        case 'telegraph':
          o.root.scale.setScalar(L.s * (0.55 + 0.25 * Math.sin(f * Math.PI * 4)));
          o.mat.opacity = 0.95 * (1 - f * 0.4);
          break;
        case 'ring':
          o.root.scale.setScalar(L.r * (0.15 + 0.85 * easeOutCubic(f)));
          o.mat.opacity = 0.95 * (1 - f);
          break;
      }
    }
    if (this.fxLive.some((L) => L.t >= L.life)) {
      for (const L of this.fxLive) if (L.t >= L.life) this.fxPut(L.o);
      this.fxLive = this.fxLive.filter((L) => L.t < L.life);
    }
  },
  /** Field medics: a green thread of healing light from the medic to the person being healed. */
  syncBeams(s, time) {
    let n = 0;
    const up = this._up || (this._up = new THREE.Vector3(0, 1, 0)), d = this._bd || (this._bd = new THREE.Vector3());
    for (const v of s.villagers) {
      if (v.job !== 'medic' || !v.healTo || v.inside) continue;
      const t = s.villagers.find((o) => o.id === v.healTo);
      if (!t || t.inside) continue;
      let o = this.beams[n];
      if (!o) { o = this.fxGet('beam'); o.mat.color.setHex(0x7dff9a); this.beams.push(o); }
      o.root.visible = true;
      const y0 = heightAt(v.x, v.z) + 1.0, y1 = heightAt(t.x, t.z) + 0.85;
      d.set(t.x - v.x, y1 - y0, t.z - v.z);
      const len = d.length();
      if (len < 0.05) { o.root.visible = false; continue; }
      o.root.position.set(v.x, y0, v.z);
      o.root.quaternion.setFromUnitVectors(up, d.normalize());
      const w = 1 + Math.sin(time * 14 + n) * 0.35;
      o.mesh.scale.set(w, len, w);
      o.mat.opacity = 0.45 + 0.25 * Math.sin(time * 9 + n);
      this.lightSrc.push({ x: t.x, y: 1, z: t.z, r: 1.8, c: 0x7dff9a, k: 0.5 });
      n++;
    }
    for (let i = n; i < this.beams.length; i++) this.beams[i].root.visible = false;
  },

  /* ---------- HTML overlays: floating numbers and health bars ---------- */
  syncOverlay(s) {
    if (!this.overlay) return;
    let fi = 0, bi = 0;
    const getF = () => {
      let el = this.floatEls[fi];
      if (!el) { el = document.createElement('div'); el.className = 'float3d'; this.overlay.appendChild(el); this.floatEls.push(el); }
      fi++; return el;
    };
    const getB = () => {
      let el = this.barEls[bi];
      if (!el) { el = document.createElement('div'); el.className = 'bar3d'; el.innerHTML = '<i></i>'; this.overlay.appendChild(el); this.barEls.push(el); }
      bi++; return el;
    };
    for (const f of s.floaters) {
      const p = this.project(f.x, f.y, f.z);
      if (!p) continue;
      const el = getF();
      if (el._t !== f.text) { el.textContent = f.text; el._t = f.text; }
      const cls = 'float3d' + (f.cls ? ' ' + f.cls : '');
      if (el._c !== cls) { el.className = cls; el._c = cls; }
      el.style.color = f.color;
      // numbers pop in big and settle; everything fades out at the end
      const age = (f.max || 1.5) - f.life;
      const pop = !f.cls ? 1 : age < 0.08 ? 0.5 + (age / 0.08) * 0.9 : age < 0.18 ? 1.4 - ((age - 0.08) / 0.1) * 0.4 : 1;
      el.style.opacity = clamp(f.life / (f.cls ? 0.3 : 0.5), 0, 1).toFixed(2);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
      if (el._d !== 1) { el.style.display = 'block'; el._d = 1; }
    }
    const bar = (x, y, z, f, cls, w) => {
      const p = this.project(x, y, z);
      if (!p || p.x < -50 || p.x > window.innerWidth + 50 || p.y < -50 || p.y > window.innerHeight + 50) return;
      const el = getB();
      // only what changed is written: every style write makes the browser restyle the bar
      const c = 'bar3d ' + cls, fw = (clamp(f, 0, 1) * 100).toFixed(0) + '%';
      if (el._c !== c) { el.className = c; el._c = c; }
      if (el._w !== w) { el.style.width = w + 'px'; el._w = w; }
      if (el._f !== fw) { el.firstChild.style.width = fw; el._f = fw; }
      el.style.transform = `translate(${(p.x - w / 2).toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      if (el._d !== 1) { el.style.display = 'block'; el._d = 1; }
    };
    const sel = UI.selected;
    for (const v of s.villagers) {
      if (v.inside) continue;
      if (v.hp < v.maxHp - 0.5 || (sel && sel.ref === v)) bar(v.x, 1.55, v.z, v.hp / v.maxHp, 'hp', 26);
      if ((v.power || 0) > 1 && isDefender(v)) bar(v.x, 1.47, v.z, v.power / 100, v.power >= 100 ? 'pow full' : 'pow', 26); // Shakti
    }
    for (const e of s.enemies) if (e.hp < e.maxHp) { const d = ENEMIES[e.type]; bar(e.x, e.y + d.h + 0.35, e.z, e.hp / e.maxHp, 'ehp', d.boss ? 70 : 28); }
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (!b.done) bar(b.x, Math.min(d.ht, 2.4) + 0.4, b.z, b.progress / d.time, 'prog', 34);
      else if (b.upgrading && d.levels && d.levels[bLevel(b) + 1]) bar(b.x, Math.min(d.ht, 2.6) + 0.55, b.z, (b.upProg || 0) / d.levels[bLevel(b) + 1].time, 'prog up', 40);
      else if (b.hp < b.maxHp - 0.5) bar(b.x, d.ht + 0.3, b.z, b.hp / b.maxHp, 'hp', 34);
    }
    if (s.fire.hp < fireLv(s).hp - 0.5) bar(0, 3.4, 0, s.fire.hp / fireLv(s).hp, s.fire.hurtT > 0 ? 'fire hit' : 'fire', 56);
    // what lies in each stockpile (with fill bars), and what each worker carries in their tokri
    let si = 0;
    const W = window.innerWidth, Hh = window.innerHeight, dist = this.cam.dist;
    const label = (x, y, z, key, html, cls, alpha) => {
      const p = this.project(x, y, z);
      if (!p || p.x < -80 || p.x > W + 80 || p.y < -40 || p.y > Hh + 60) return;
      let el = this.stockEls[si];
      if (!el) { el = document.createElement('div'); this.overlay.appendChild(el); this.stockEls.push(el); }
      si++;
      if (el._k !== key) { el._k = key; el.className = 'stock3d ' + cls; el.innerHTML = html; }
      const op = alpha.toFixed(2);
      if (el._o !== op) { el.style.opacity = op; el._o = op; }
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      if (el._d !== 1) { el.style.display = 'flex'; el._d = 1; }
    };
    const chip = (r, n, cap) => {
      const full = cap !== Infinity && n >= cap - 0.5;
      const bar = cap === Infinity ? '' : `<u><em style="width:${Math.round(clamp(n / cap, 0, 1) * 100)}%"></em></u>`;
      return `<span class="sk${full ? ' full' : ''}">${UI.ico(r, true)}<b>${n}</b>${bar}</span>`;
    };
    const stockA = clamp((34 - dist) / 6, 0, 1); // fade out as the camera pulls back
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (!d.drop || !b.done) continue;
      const picked = sel && sel.ref === b;
      if (stockA <= 0 && !picked) continue;
      const list = stockList(s, b);
      if (!picked && list.every((it) => it.n <= 0)) continue; // empty fields stay quiet
      const key = 'b' + list.map((it) => it.r + it.n + '/' + it.cap).join(',');
      label(b.x, Math.min(d.ht, 2.2) + 0.55, b.z, key, list.map((it) => chip(it.r, it.n, it.cap)).join(''), 'store', picked ? 1 : stockA);
    }
    const heapA = clamp((24 - dist) / 5, 0, 1);
    if (heapA > 0) for (const r of RES_ORDER) {
      const n = Math.floor((s.fireStock && s.fireStock[r]) || 0);
      if (n <= 0) continue;
      const h = FIRE_HEAP[r];
      label(h.x, 1.0, h.z, 'h' + r + n, chip(r, n, Infinity), 'heap', heapA);
    }
    const carryA = clamp((17 - dist) / 4, 0, 1);
    for (const v of s.villagers) {
      if (v.inside || !(v.carryAmt > 0 && v.carry) && !(v.gold > 0)) continue;
      const picked = sel && sel.ref === v;
      if (carryA <= 0 && !picked) continue;
      let html = '', key = 'c';
      if (v.carryAmt > 0 && v.carry) { const cap = carryCap(s, v.carry); html += chip(v.carry, v.carryAmt, cap); key += v.carry + v.carryAmt + '/' + cap; }
      if (v.gold > 0) { html += chip('gold', v.gold, Infinity); key += 'g' + v.gold; }
      label(v.x, 1.72, v.z, key, html, 'carry', picked ? 1 : carryA);
    }
    const hide = (els, from) => { for (let i = from; i < els.length; i++) if (els[i]._d !== 0) { els[i].style.display = 'none'; els[i]._d = 0; } };
    hide(this.stockEls, si); hide(this.floatEls, fi); hide(this.barEls, bi);
  },

  /* ---------- thumbnails for the UI ---------- */
  thumb(obj, w, h, camPos, look) {
    if (!this.tr) {
      this.tCanvas = document.createElement('canvas');
      this.tr = new THREE.WebGLRenderer({ canvas: this.tCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.tScene = new THREE.Scene();
      this.tScene.add(new THREE.HemisphereLight(0xffffff, 0x806040, 0.75));
      const d = new THREE.DirectionalLight(0xfff0d0, 0.8); d.position.set(3, 6, 4); this.tScene.add(d);
      this.tCam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    }
    this.tr.setSize(w, h, false);
    this.tCam.aspect = w / h;
    this.tCam.position.set(camPos[0], camPos[1], camPos[2]);
    this.tCam.lookAt(look[0], look[1], look[2]);
    this.tCam.updateProjectionMatrix();
    this.tScene.add(obj);
    this.tr.setClearColor(0x000000, 0);
    this.tr.render(this.tScene, this.tCam);
    this.tScene.remove(obj);
    const url = this.tCanvas.toDataURL();
    this.disposeTree(obj);
    return url;
  },
  buildingThumb(type) {
    const d = BUILDINGS[type];
    const o = Models.building(type);
    for (const p of o.userData.piles || []) { const geo = Models.pileGeo(p.res, 3); setGeo(p.mesh, geo); p.mesh.visible = true; } // look stocked in the build menu
    if (o.userData.emblem) o.userData.emblem.visible = false; // (the plaque is for the village, not the card)
    const sz = Math.max(d.fw, d.fd, d.ht * 0.8);
    return this.thumb(o, 128, 88, [sz * 1.5, sz * 1.25 + d.ht * 0.3, sz * 1.9], [0, d.ht * 0.38, 0]);
  },
  villagerThumb(look, job) {
    const o = Models.villager(look, job), pk = { wood: 'wood2', stone: 'stone2', farm: 'food2' }[job];
    if (pk) { const ud = o.userData, geo = Models.packGeo(pk); setGeo(ud.pack, geo); ud.pack.visible = true; }
    const J = villagerPose({ id: 0, job, look, anim: 'stand', animT: 0.4 }, {}, 0.4);
    applyVillagerPose(o, o.userData, J);
    if (o.userData.bowRest) { o.userData.bowRest.visible = true; o.userData.bowDrawn.visible = false; }
    return this.thumb(o, 72, 88, [-0.5, 1.12, 1.5], [0, 0.8, 0]);
  },
};
