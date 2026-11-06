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
  const inland = clamp((r - 27) / 8, 0, 1);
  let h = terrainBump(x, z) * inland;
  if (r > edge - 3) h = lerp(h, -1.3, clamp((r - (edge - 3)) / 5, 0, 1));
  return h;
}

/* ---------- fighting poses ---------- */
/** Ready stance between blows: knees bent, weapon up, shield forward, a light bounce. */
function fightStance(v, t) {
  const b = Math.sin(t * 7 + v.id) * 0.012;
  const J = { hipY: 0.33 + b, legL: 0.38, legR: -0.32, armR: -1.05, armRz: 0.25, armL: -0.75, armLz: -0.2, lean: 0.16, twist: -0.15, sway: 0 };
  if (v.job === 'brute') Object.assign(J, { armR: -1.9, armL: -1.75, armRz: 0, armLz: 0, twist: 0 }); // gada held high in both hands
  else if (v.job === 'spear') Object.assign(J, { armR: -1.35, armRz: 0.1, twist: -0.3 });
  return J;
}
/*
 * A swing has three key poses: ready → wound up → struck. The wind-up eases in up to the hit moment, then
 * the strike snaps through in a few frames. Values per joint: [ready, wound, struck].
 */
const SWING_POSES = {
  slash:  { armR: [-1.0, -2.5, -0.55], armRz: [0.2, 0.9, -0.7], twist: [0, 0.55, -0.5], lean: [0.12, -0.05, 0.3], hipY: [0.34, 0.35, 0.31], legL: [0.3, 0.2, 0.5], legR: [-0.3, -0.2, -0.4], armL: [-0.7, -0.5, -0.9], sided: true },
  thrust: { armR: [-1.0, -0.6, -1.7], armRz: [0.2, 0.35, 0], twist: [0, 0.45, -0.35], lean: [0.12, -0.05, 0.4], legL: [0.3, 0.1, 0.75], legR: [-0.3, -0.2, -0.55], hipY: [0.34, 0.35, 0.3], armL: [-0.7, -0.4, -0.5] },
  smash:  { armR: [-1.9, -3.0, -0.3], armL: [-1.7, -2.9, -0.4], lean: [0.1, -0.3, 0.55], hipY: [0.34, 0.37, 0.29], legL: [0.3, 0.2, 0.5], legR: [-0.3, -0.2, -0.45] },
  bash:   { armL: [-0.7, -0.5, -1.6], armLz: [-0.2, -0.5, 0.1], twist: [0, 0.5, -0.55], lean: [0.12, 0, 0.38], armR: [-1.0, -1.2, -0.8], legL: [0.3, 0.2, 0.7], legR: [-0.3, -0.2, -0.5] },
  slam:   { armR: [-1.9, -3.1, -0.15], armL: [-1.7, -3.0, -0.25], lean: [0.1, -0.2, 0.6], hipY: [0.34, 0.36, 0.24], legL: [0.3, -0.5, 0.7], legR: [-0.3, 0.5, -0.6] },
  lunge:  { armR: [-1.3, -0.9, -1.65], twist: [0, 0.3, -0.3], lean: [0.12, 0.2, 0.55], legL: [0.3, 0.6, 1.0], legR: [-0.3, -0.6, -0.8], hipY: [0.34, 0.31, 0.28], armL: [-0.7, -0.3, -0.4] },
  shoot:  { armR: [-1.5, -1.5, -1.5], armL: [-1.35, -1.45, -1.35], armRz: [0, -0.4, 0.12], twist: [0, 0.25, -0.05], lean: [-0.04, -0.08, 0.02] },
  volley: { armR: [-1.5, -2.3, -2.2], armL: [-1.35, -2.2, -2.1], armRz: [0, -0.4, 0.1], lean: [-0.04, -0.2, -0.1] },
  pulse:  { armR: [-0.9, -2.9, -1.3], armL: [-0.9, -2.9, -1.3], armRz: [0, 0.35, 1.0], armLz: [0, -0.35, -1.0], lean: [0.05, -0.15, 0.1], hipY: [0.35, 0.37, 0.34] },
  // ultimates
  whirl:  { armR: [-1.0, -1.57, -1.57], armRz: [0.2, 1.25, 1.25], armL: [-0.7, -1.57, -1.57], armLz: [-0.2, -1.25, -1.25], lean: [0.12, 0.05, 0.12], legL: [0.3, 0.35, 0.35], legR: [-0.3, -0.35, -0.35] },
  leap:   { armR: [-1.9, -3.1, -0.2], armL: [-1.7, -3.0, -0.3], lean: [0.1, -0.3, 0.7], hipY: [0.34, 0.36, 0.22], legL: [0.3, -0.7, 0.8], legR: [-0.3, 0.7, -0.7] },
  barrage: null, // uses the thrust, once per blow
  astra:  { armR: [-1.5, -2.5, -2.3], armL: [-1.35, -2.4, -2.2], armRz: [0, -0.55, 0.1], lean: [-0.04, -0.3, -0.12], legL: [0.2, 0.45, 0.45], legR: [-0.2, -0.4, -0.4] },
  sanjeevani: { armR: [-0.9, -3.0, -1.0], armL: [-0.9, -3.0, -1.0], armRz: [0, 0.2, 1.3], armLz: [0, -0.2, -1.3], lean: [0.05, -0.25, 0.05], hipY: [0.35, 0.4, 0.35] },
};
SWING_POSES.barrage = SWING_POSES.thrust;
function attackPose(v, a) {
  const S2 = SWING_POSES[a.kind] || SWING_POSES.slash;
  let p = clamp(a.t / a.dur, 0, 1), h = a.hit;
  if (a.hits && a.kind !== 'whirl') { // several blows: wind up and strike again for each
    const k = Math.min(a.hi || 0, a.hits.length - 1), t0 = k === 0 ? 0 : a.hits[k - 1], t1 = a.hits[k];
    p = clamp((p - t0) / Math.max(0.01, (k === a.hits.length - 1 ? 1 : a.hits[k + 1]) - t0), 0, 1);
    h = clamp((t1 - t0) / Math.max(0.01, (k === a.hits.length - 1 ? 1 : a.hits[k + 1]) - t0), 0.2, 0.9);
  }
  const wind = p < h ? Math.sin((p / h) * Math.PI * 0.5) : 1;
  const strike = p < h ? 0 : easeOutCubic((p - h) / Math.min(0.32, 1 - h));
  const side = S2.sided ? a.side || 1 : 1;
  const J = Object.assign(fightStance(v, v.animT), { twist: 0, armRz: 0, armLz: 0 });
  for (const key in S2) {
    if (key === 'sided') continue;
    const [r, w, s] = S2[key];
    const sg = side < 0 && (key === 'armRz' || key === 'twist') ? -1 : 1;
    J[key] = (strike > 0 ? w + (s - w) * strike : r + (w - r) * wind) * sg;
  }
  if (a.kind === 'slam' && p < h) J.hipY += Math.sin((p / h) * Math.PI) * 0.34; // the leap
  if (a.kind === 'leap' && p < h) J.hipY += Math.sin((p / h) * Math.PI) * 1.1; // Hanuman's leap: high through the air
  return J;
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
    sc.fog = new THREE.Fog(SKY_DAY, 60, 150);
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
    // sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshPhongMaterial({ color: 0x4aaebf, shininess: 70, specular: 0xcfeae6 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.38; sea.receiveShadow = true;
    sc.add(sea); this.sea = sea;
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
    sc.add(g);
    this.buildTerrain(s);
    this.buildTrees(s);
    this.rockVer = -1;
    this.rockMeshes = null; // old ones belonged to the previous world group — rebuild them
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
  buildTerrain(s) {
    const geo = new THREE.PlaneGeometry(150, 150, 100, 100);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
    geo.computeVertexNormals();
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
    const geo = this.terrain.geometry, pos = geo.attributes.position, col = geo.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const r = Math.hypot(x, z), edge = islandR(x, z);
      const n = Math.sin(x * 0.21 + z * 0.13) * 0.5 + Math.sin(x * 0.09 - z * 0.23) * 0.5;
      let hex;
      // palette: warm sage meadow, dusty khaki village ground, shady olive forest floor, cream beach
      if (y < -0.5) hex = 0xd2bc8c;
      else if (r > edge - 3.4) hex = lerpHex(0xf0ddb0, 0xe2c996, clamp((r - edge + 3.4) / 3, 0, 1));
      else {
        hex = lerpHex(0x86a352, 0x96ad5f, n * 0.5 + 0.5);
        if (r > 30) hex = lerpHex(hex, 0x76944c, clamp((r - 30) / 12, 0, 1));
        hex = lerpHex(hex, 0x62763f, this.forestAt(x, z) * 0.6);
        if (r < R + 0.5) hex = lerpHex(hex, 0xb7b276, 0.42);
        if (r > edge - 4.6) hex = lerpHex(hex, 0xe2d3a0, clamp((r - edge + 4.6) / 1.2, 0, 1));
      }
      c.setHex(hex);
      col.setXYZ(i, c.r, c.g, c.b);
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
  buildTrees(s) {
    // The forest is split into square chunks so only the chunks the camera can see get drawn.
    this.treeMeshes = {};
    this.stumpMeshes = {};
    this.chunks = [];
    this.treeSlot = new Map();
    const CH = 18;
    const chunkOf = (t) => Math.floor((t.x + 64) / CH) + '_' + Math.floor((t.z + 64) / CH);
    const groups = {}, stumps = {};
    for (const t of s.trees) {
      const c = chunkOf(t);
      (groups[t.type + t.variant + '|' + c] = groups[t.type + t.variant + '|' + c] || []).push(t);
      (stumps[t.type + '|' + c] = stumps[t.type + '|' + c] || []).push(t);
    }
    const geos = {};
    const box = (c) => {
      const [i, j] = c.split('_').map(Number);
      return new THREE.Box3(new THREE.Vector3(i * CH - 64 - 3, -2, j * CH - 64 - 3), new THREE.Vector3((i + 1) * CH - 64 + 3, 7, (j + 1) * CH - 64 + 3));
    };
    for (const k in groups) {
      const list = groups[k];
      const gk = list[0].type + list[0].variant;
      const geo = geos[gk] || (geos[gk] = Models.treeGeo(list[0].type, list[0].variant));
      const geoLo = geos[gk + 'lo'] || (geos[gk + 'lo'] = Models.treeGeo(list[0].type, list[0].variant, true));
      geo.userData.shared = true; geoLo.userData.shared = true;
      const im = new THREE.InstancedMesh(geo, MAT.tree, list.length);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      const ol = this.outlineFor(im, MAT.treeOutline);
      // the far-away twin: same instances, a third of the triangles, and it casts no shadow
      const lo = new THREE.InstancedMesh(geoLo, MAT.tree, list.length);
      lo.instanceMatrix = im.instanceMatrix;
      lo.frustumCulled = false; lo.castShadow = false; lo.receiveShadow = true; lo.visible = false;
      lo.raycast = () => {}; lo.userData.noAO = true;
      this.worldGroup.add(im, ol, lo);
      list.forEach((t, i) => this.treeSlot.set(t.id, { m: im, i }));
      this.treeMeshes[k] = im;
      this.chunks.push({ meshes: [im, ol, lo], box: box(k.split('|')[1]) });
    }
    for (const k in stumps) {
      const list = stumps[k];
      const type = list[0].type;
      const geo = geos['stump' + type] || (geos['stump' + type] = Models.stumpGeo(type));
      geo.userData.shared = true;
      const im = new THREE.InstancedMesh(geo, MAT.std, list.length);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      const ol = this.outlineFor(im, MAT.outline);
      this.worldGroup.add(im, ol);
      list.forEach((t, i) => { const sl = this.treeSlot.get(t.id); sl.sm = im; sl.si = i; });
      this.stumpMeshes[k] = im;
      this.chunks.push({ meshes: [im, ol], box: box(k.split('|')[1]) });
    }
    this._treeGeos = Object.values(geos);
    this.syncTrees(s, true);
  },
  _frustum: new THREE.Frustum(), _pm: new THREE.Matrix4(),
  cullChunks() {
    this.camera.updateMatrixWorld();
    this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    const Q = this.Q, c = this.cam, cp = this.camera.position;
    const far = c.dist * 1.25 + 14; // on Low, distant forest is left to the fog
    for (const ch of this.chunks) {
      let vis = this._frustum.intersectsBox(ch.box);
      let d3 = 0;
      if (vis) {
        const b = ch.box;
        if (Q.farCull) { // distance from the view centre to the nearest edge of the chunk
          const dx = Math.max(b.min.x - c.x, 0, c.x - b.max.x), dz = Math.max(b.min.z - c.z, 0, c.z - b.max.z);
          vis = Math.hypot(dx, dz) < far;
        }
        // detail follows the real distance from the camera, so zooming out switches to the light trees
        const ex = Math.max(b.min.x - cp.x, 0, cp.x - b.max.x), ez = Math.max(b.min.z - cp.z, 0, cp.z - b.max.z), ey = Math.max(0, cp.y - 2);
        d3 = Math.hypot(ex, ey, ez);
      }
      const lo = ch.meshes[2];
      const detailed = vis && (!lo || d3 <= Q.lodDist);
      ch.meshes[0].visible = detailed;
      ch.meshes[1].visible = detailed && !Q.farCull && !ch.meshes[1].userData.off;
      if (lo) lo.visible = vis && !detailed;
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
        ao.kernelRadius = 0.55; ao.minDistance = 0.0004; ao.maxDistance = 0.02;
        // 16 samples instead of 32: the same soft contact shadows for half the work
        ao.kernelSize = 16; ao.generateSampleKernel();
        ao.ssaoMaterial.defines.KERNEL_SIZE = 16; ao.ssaoMaterial.uniforms.kernel.value = ao.kernel; ao.ssaoMaterial.needsUpdate = true;
        const base = ao.renderOverride.bind(ao);
        const hid = [];
        // the occlusion pass redraws the scene, so it skips what cannot cast visible occlusion:
        // glows, particles, see-through things, grass and flowers, and the far-away forest
        ao.renderOverride = (renderer, mat, target, cc, ca) => {
          hid.length = 0;
          this.scene.traverse((o) => {
            if (!o.visible) return;
            if (o.isPoints || o.isLine || o.isSprite || o.userData.noAO || (o.material && (o.material.transparent || o.material.isMeshBasicMaterial))) { o.visible = false; hid.push(o); }
          });
          base(renderer, mat, target, cc, ca);
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
    for (const k in this.treeMeshes) this.treeMeshes[k].instanceMatrix.needsUpdate = true;
    for (const k in this.stumpMeshes) this.stumpMeshes[k].instanceMatrix.needsUpdate = true;
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
    for (const im of this.rockMeshes) { im.instanceMatrix.needsUpdate = true; im.userData.outline.count = im.count; }
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
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 46;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (r > islandR(x, z) - 4) continue;
      if (r < 25 && rnd() < 0.7) continue;
      const y = heightAt(x, z);
      if (nt < 2600) { this.setInst(tufts, nt, x, y, z, rnd() * 6, 0.7 + rnd() * 0.7, 0); tufts.setColorAt(nt, cc.setHex(pick([0x6f8f45, 0x7f9c4e, 0x8ea457, 0xa9a65e]))); nt++; } // a few sun-dried golden tufts warm the meadow
      if (nf < 500 && rnd() < 0.2) { this.setInst(flowers, nf, x + 0.2, y + 0.06, z, 0, 1, 0); flowers.setColorAt(nf, cc.setHex(grade(pick([0xffb31a, 0xff7a1a, 0xf4ecd8, 0xe03c31, 0xc2185b, 0x9b7fd0])))); nf++; }
    }
    tufts.count = nt; flowers.count = nf; tufts.frustumCulled = false; flowers.frustumCulled = false;
    tufts.userData.noAO = flowers.userData.noAO = true;
    this.decor = [tufts, flowers];
    tufts.visible = flowers.visible = this.quality !== 'low';
    g.add(tufts, flowers);
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
  clampTarget() { const c = this.cam, r = Math.hypot(c.tx, c.tz); if (r > 52) { c.tx *= 52 / r; c.tz *= 52 / r; } },

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
    MAT.windU.value = time * (s.weather === 'rain' ? 1.6 : 1);
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
    this.syncVillagers(s, time, dark, dt);
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
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.syncOverlay(s);
  },
  syncBuildings(s, time, dark, lit) {
    const seen = new Set();
    for (const b of s.buildings) {
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
      if (!o || o.job !== v.job) {
        if (o) this.removeObj(o.obj);
        const obj = Models.villager(v.look, v.job);
        addSilhouette(obj, slotKey(v.job) === 'army' ? 0x8fd0ff : 0xfff0c8, 0.5); // seen through trees and huts
        this.scene.add(obj);
        o = { obj, job: v.job, rot: v.rot };
        this.vObjs.set(v.id, o);
      }
      const obj = o.obj, ud = obj.userData;
      obj.visible = !v.inside;
      if (v.inside) continue;
      let dr = v.rot - o.rot;
      while (dr > Math.PI) dr -= Math.PI * 2;
      while (dr < -Math.PI) dr += Math.PI * 2;
      o.rot += dr * Math.min(1, dt * 12);
      obj.rotation.y = o.rot;
      obj.position.set(v.x, heightAt(v.x, v.z), v.z);
      // walk cycle follows the distance actually covered, so feet never slide
      const moved = o.lx == null ? 0 : Math.hypot(v.x - o.lx, v.z - o.lz);
      o.lx = v.x; o.lz = v.z;
      o.ph = (o.ph || 0) + moved * 5.2;
      const t = v.animT, anim = v.anim;
      const J = { hipY: 0.36, legL: 0, legR: 0, armL: 0, armR: 0, lean: 0, sway: 0, twist: 0, armRz: 0, armLz: 0 };
      let fast = false;
      if (anim === 'walk') {
        const w = Math.sin(o.ph);
        J.legL = w * 0.62; J.legR = -w * 0.62; J.armL = -w * 0.5; J.armR = w * 0.5;
        J.hipY += Math.abs(Math.cos(o.ph)) * 0.035; J.lean = 0.07; J.sway = Math.sin(o.ph) * 0.05;
        if (v.combatT > 0 && isDefender(v)) { J.armR = -0.9 + w * 0.2; J.lean = 0.2; } // charging with the weapon up
      } else if (anim === 'work') {
        // wind up slowly, strike fast (eased swing)
        const c = (t * 1.15) % 1, e = c < 0.65 ? Math.sin((c / 0.65) * Math.PI * 0.5) : 1 - Math.pow((c - 0.65) / 0.35, 2);
        J.armR = -0.45 - e * 2.0; J.armL = -0.3 - e * 0.35; J.lean = 0.12 - e * 0.18;
      } else if (anim === 'shoot') { J.armR = -1.5; J.armL = -1.35 - Math.sin(t * 3) * 0.05; J.lean = -0.04; }
      else if (anim === 'sit') { J.hipY = 0.13; J.legL = J.legR = -1.45; J.armL = J.armR = -0.45; J.lean = 0.08; }
      else if (anim === 'fight') Object.assign(J, fightStance(v, t));
      else if (anim === 'heal') { J.armR = -1.45; J.armL = -0.95 + Math.sin(t * 4) * 0.1; J.lean = 0.1; J.hipY = 0.35; J.armRz = 0.1; }
      else if (anim === 'atk' && v.atk) { fast = true; Object.assign(J, attackPose(v, v.atk)); }
      else { const b = Math.sin(t * 1.6 + v.id); J.armL = b * 0.05; J.armR = -J.armL; J.sway = b * 0.015; }
      if (v.blockT > 0) { J.armL = -1.65; J.armLz = 0.25; J.lean -= 0.12; J.twist = -0.25; fast = true; } // dhaal up
      if (v.hurtT > 0 && anim !== 'atk') J.lean -= 0.28 * (v.hurtT / 0.25); // flinch
      // ease every joint toward its target so poses blend instead of snapping (swings snap fast)
      const P = o.pose || (o.pose = Object.assign({}, J));
      const k = 1 - Math.exp(-dt * (fast ? 34 : anim === 'walk' ? 22 : 12));
      for (const key in J) P[key] += (J[key] - (P[key] || 0)) * k;
      ud.hips.position.y = P.hipY;
      ud.hips.rotation.set(P.lean, P.twist, P.sway);
      ud.legs[0].rotation.x = P.legL;
      ud.legs[1].rotation.x = P.legR;
      ud.arms[0].rotation.set(P.armL, 0, P.armLz);
      ud.arms[1].rotation.set(P.armR, 0, P.armRz);
      ud.torso.scale.y = 1 + Math.sin(time * 2.2 + v.id) * 0.012; // breathing
      // the tokri: gatherers always wear one; its contents show the good and how full it is (3 steps)
      let pk = null;
      if (v.carryAmt > 0 && v.carry) pk = v.carry + clamp(Math.ceil((v.carryAmt / carryCap(s, v.carry)) * 3), 1, 3);
      else if (v.job === 'wood' || v.job === 'stone' || v.job === 'farm' || v.job === 'clay') pk = 'empty';
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
      if (ud.legs.length) { ud.legs[0].rotation.x = P.legs; ud.legs[1].rotation.x = -P.legs; }
      if (ud.arms.length) { const base = ud.armBase || 0; ud.arms[1].rotation.x = P.armR * (base ? 0.4 : 1) + base; ud.arms[0].rotation.x = P.armL * (base ? 0.4 : 1) + base + (base ? Math.sin(t * 2) * 0.12 : 0); }
      if (ud.hips) {
        ud.hips.rotation.z = stun ? Math.sin(time * 9 + e.id) * 0.22 : moving ? Math.sin(t * 8) * 0.05 : Math.sin(t * 1.8) * 0.02;
        ud.hips.rotation.x = P.lean;
        ud.hips.position.y = (ud.hipY || 0.5) + (moving ? Math.abs(Math.cos(t * 8)) * 0.04 : 0);
      }
      if (ud.neckFlame) ud.neckFlame.scale.set(1, 0.8 + 0.3 * Math.sin(t * 13 + e.id) + 0.1 * Math.sin(t * 29), 1);
      if (ud.halo) ud.halo.scale.setScalar(0.85 + 0.25 * Math.sin(t * 6 + e.id));
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
      for (const g of [this.arrowGeo.geometry, this.potGeo, this.ballGeo, this.rockGeo]) g.userData.shared = true;
      this.shellPool = { pot: [], ball: [], rock: [] };
    }
    const arrows = [], shells = { pot: [], ball: [], rock: [] };
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
    for (const k of ['pot', 'ball', 'rock']) {
      const pool = this.shellPool[k], list = shells[k];
      while (pool.length < list.length) {
        const m = new THREE.Mesh(k === 'pot' ? this.potGeo : k === 'rock' ? this.rockGeo : this.ballGeo, MAT.std);
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
        m.rotation.x += 0.2; m.rotation.z += 0.13;
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
    sun.position.set(c.x + Math.cos(az) * 40 * (1 - el * 0.6), 12 + el * 50, c.z + Math.sin(az) * 30 - 20);
    sun.target.position.set(c.x, 0, c.z);
    const du = duskAmt(t);
    const modern = MAT.tier !== 'low';
    sun.intensity = (modern ? 0.92 : 0.76) * clamp(el * 3, 0, 1) * (1 - dark) * (rain ? 0.45 : 1);
    if (this.bloomPass) { // glow: a whisper by day, the fire and ghost lights bloom at night
      this.bloomPass.strength = lerp(0.12, 0.75, dark);
      this.bloomPass.threshold = lerp(0.97, 0.7, dark);
    }
    const wantShadow = sun.intensity > 0.04 && this.Q.shadows;
    if (sun.castShadow !== wantShadow) sun.castShadow = wantShadow; // no sun shadows at night
    sun.color.setHex(lerpHex(SUN_DAY, 0xff9a50, du));
    const half = clamp(c.dist * 1.05, 18, 48);
    const sh = sun.shadow.camera;
    if (Math.abs(sh.right - half) > 2) { sh.left = -half; sh.right = half; sh.top = half; sh.bottom = -half; sh.updateProjectionMatrix(); }
    this.hemi.intensity = lerp(modern ? 0.5 : 0.6, modern ? 0.2 : 0.17, dark) * (rain ? 0.85 : 1);
    this.hemi.color.setHex(lerpHex(lerpHex(HEMI_SKY, 0xffd0a8, du), 0x4a5aa8, dark));
    this.hemi.groundColor.setHex(lerpHex(HEMI_GROUND, 0x141830, dark));
    this.moon.intensity = 0.24 * dark;
    this.moon.position.set(c.x - 25, 40, c.z + 15);
    this.moon.target.position.set(c.x, 0, c.z);
    let bg = lerpHex(SKY_DAY, 0xf0a878, du);
    bg = lerpHex(bg, 0x0b1030, dark);
    if (rain) bg = lerpHex(bg, 0x6a7484, 0.5);
    this.scene.background.setHex(bg);
    this.scene.fog.color.setHex(bg);
    const lowQ = this.Q.farCull;
    this.scene.fog.near = c.dist + lerp(lowQ ? 14 : 40, 6, dark);
    this.scene.fog.far = c.dist + lerp(lowQ ? 34 : 130, lowQ ? 30 : 45, dark);
    const F = s.fire, FL = fireLv(s);
    const flick = 1 + Math.sin(time * 10) * 0.06 + Math.sin(time * 23) * 0.04;
    this.fireLight.intensity = (0.12 + 1.15 * dark) * (0.35 + 0.65 * F.intensity) * flick;
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
      el.style.display = 'block';
    }
    const bar = (x, y, z, f, cls, w) => {
      const p = this.project(x, y, z);
      if (!p || p.x < -50 || p.x > window.innerWidth + 50 || p.y < -50 || p.y > window.innerHeight + 50) return;
      const el = getB();
      el.className = 'bar3d ' + cls;
      el.style.width = w + 'px';
      el.firstChild.style.width = (clamp(f, 0, 1) * 100).toFixed(0) + '%';
      el.style.transform = `translate(${(p.x - w / 2).toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      el.style.display = 'block';
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
      el.style.opacity = alpha.toFixed(2);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.display = 'flex';
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
    for (let i = si; i < this.stockEls.length; i++) this.stockEls[i].style.display = 'none';
    for (let i = fi; i < this.floatEls.length; i++) this.floatEls[i].style.display = 'none';
    for (let i = bi; i < this.barEls.length; i++) this.barEls[i].style.display = 'none';
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
    const sz = Math.max(d.fw, d.fd, d.ht * 0.8);
    return this.thumb(o, 128, 88, [sz * 1.5, sz * 1.25 + d.ht * 0.3, sz * 1.9], [0, d.ht * 0.38, 0]);
  },
  villagerThumb(look, job) {
    const o = Models.villager(look, job), pk = { wood: 'wood2', stone: 'stone2', farm: 'food2' }[job];
    if (pk) { const ud = o.userData, geo = Models.packGeo(pk); setGeo(ud.pack, geo); ud.pack.visible = true; }
    return this.thumb(o, 72, 88, [0.9, 1.25, 2.0], [0, 0.72, 0]);
  },
};
