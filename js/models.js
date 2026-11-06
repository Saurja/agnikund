'use strict';
/* =========================================================
   Low-poly 3D models built from primitives (Three.js r128).
   Static parts are merged into one vertex-coloured mesh;
   glowing parts (flames, eyes) are separate basic meshes.
   1 unit = 1 grid cell. Models face +Z.
   ========================================================= */

const C = {
  mud: 0xb5794a, mudD: 0x8c5a34, thatch: 0xd9ab55, thatchD: 0xb88a3a, white: 0xf1e6cc, dark: 0x3a2416,
  wood: 0x7a4b26, woodL: 0xa0703a, stone: 0x9a958c, stoneD: 0x6f6a62, sand: 0xd8a76b, sandD: 0xb0814a,
  brick: 0xb5532f, brickD: 0x8f3f22, saffron: 0xff9933, marigold: 0xffb31a, gold: 0xe8b830, red: 0xc8453c,
  green: 0x3f8a3a, bamboo: 0xb8a050, bambooD: 0x8a7a3a, soil: 0x5e3b22, tile: 0xa0442a,
};

const MAT = {};
/** Cartoon look: toon shading with a few hard light bands + dark ink outlines (inverted hull). */
function toonRamp(levels) {
  const tex = new THREE.DataTexture(new Uint8Array(levels), levels.length, 1, THREE.LuminanceFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
function outlineMat(width, color) {
  const m = new THREE.MeshBasicMaterial({ color: color || 0x2e1d12, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 onormal;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += onormal * ${width.toFixed(3)};`);
  };
  m.customProgramCacheKey = () => 'outline' + width;
  return m;
}
/** Add wind sway to a material: vertices bend more the higher they are, phase varies per instance. */
function withWind(mat, k, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
    sh.uniforms.uTime = MAT.windU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 wPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 wPos = vec3(0.0);
      #endif
      float wH = max(position.y, 0.0);
      float wS = (sin(uTime * 1.6 + wPos.x * 0.37 + wPos.z * 0.29) + 0.35 * sin(uTime * 3.1 + wPos.z * 0.8)) * ${k.toFixed(4)} * wH * wH;
      transformed.x += wS; transformed.z += wS * 0.6;`);
  };
  mat.customProgramCacheKey = () => 'wind_' + key;
  return mat;
}
/**
 * The shared surface for a graphics tier. Low: cheap per-vertex Lambert. Mid / High: a soft, matte
 * physically-based look (smooth shading, gentle highlights) that reads modern instead of cel-shaded.
 */
function surfaceMat(opts) {
  if (MAT.tier === 'low') { const o = Object.assign({}, opts); delete o.roughness; delete o.metalness; return new THREE.MeshLambertMaterial(o); }
  return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.86, metalness: 0 }, opts));
}
/**
 * Painted surface for buildings: soft world-space noise gives mottled plaster, wood and thatch grain
 * (no UVs needed), and walls darken where they meet the earth. Mid and High only.
 */
function texturize(mat, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = `varying vec3 vWPos;
      float hh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float vn3(vec3 x) {
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hh3(i), hh3(i + vec3(1, 0, 0)), f.x), mix(hh3(i + vec3(0, 1, 0)), hh3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hh3(i + vec3(0, 0, 1)), hh3(i + vec3(1, 0, 1)), f.x), mix(hh3(i + vec3(0, 1, 1)), hh3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float n = vn3(vWPos * 3.0) * 0.55 + vn3(vWPos * 11.0) * 0.45;
        float grain = vn3(vec3(vWPos.x * 24.0, vWPos.y * 2.2, vWPos.z * 24.0));
        diffuseColor.rgb *= 1.0 + ${amp.toFixed(3)} * (mix(n, grain, 0.4) - 0.5) * 2.0;
        diffuseColor.rgb *= mix(0.8, 1.0, clamp(vWPos.y * 2.4 + 0.12, 0.0, 1.0));
      }`);
  };
  mat.customProgramCacheKey = () => 'bld_' + MAT.tier + amp;
  return mat;
}
function initMaterials(tier) {
  MAT.tier = tier || MAT.tier || 'high';
  MAT.useOutline = false; // the modern look relies on light, shadow and occlusion rather than ink lines
  MAT.ramp = MAT.ramp || toonRamp([95, 165, 220, 255]);
  MAT.std = surfaceMat({ vertexColors: true });
  MAT.bld = MAT.tier === 'low' ? MAT.std : texturize(surfaceMat({ vertexColors: true, roughness: 0.92 }), 0.14);
  MAT.bhoot = surfaceMat({ vertexColors: true, transparent: true, opacity: 0.82, emissive: 0x2a3848 });
  MAT.outline = MAT.outline || outlineMat(0.028);
  MAT.outlineBig = MAT.outlineBig || outlineMat(0.045);
  // swaying foliage: the same surface plus a gentle wind in the vertex shader
  MAT.windU = MAT.windU || { value: 0 };
  MAT.tree = withWind(surfaceMat({ vertexColors: true, roughness: 0.95 }), 0.012, 'tree_' + MAT.tier);
  MAT.treeOutline = MAT.treeOutline || withWind(outlineMat(0.045), 0.012, 'treeOutline');
  MAT.ghostOk = MAT.ghostOk || new THREE.MeshBasicMaterial({ color: 0x6dff8e, transparent: true, opacity: 0.42, depthWrite: false });
  MAT.ghostBad = MAT.ghostBad || new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.42, depthWrite: false });
  MAT.glow = MAT.glow || {};
}
function glowMat(color, opacity) {
  const k = color + '_' + (opacity || 1);
  if (!MAT.glow[k]) MAT.glow[k] = new THREE.MeshBasicMaterial({ color, transparent: opacity != null && opacity < 1, opacity: opacity == null ? 1 : opacity, depthWrite: opacity == null || opacity >= 1 });
  return MAT.glow[k];
}

/* ---------- colour harmony ----------
   Every model colour passes through grade(). Greens are calmed from lime to sage and olive,
   the loudest saturations get a soft knee, paper-white turns cream and pure black turns deep
   brown, and a whisper of golden light ties it all together. The village then reads as one warm,
   earthy palette, and the saturated accents (fire, saffron, marigold) still draw the eye. */
const _gradeCache = new Map();
const _hsl = { h: 0, s: 0, l: 0 };
const _gcol = new THREE.Color();
const band = (x, a, b, c, d) => (x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c));
function grade(hex) {
  let out = _gradeCache.get(hex);
  if (out !== undefined) return out;
  _gcol.setHex(hex).getHSL(_hsl);
  let { h, s, l } = _hsl;
  const deg = h * 360;
  const g = band(deg, 55, 80, 165, 190); // how "green" this colour is
  if (g > 0) {
    s *= 1 - 0.32 * g;                                  // sage, not lime
    h -= ((Math.max(0, deg - 88) * 0.28) / 360) * g;    // lean toward warm olive
    l *= 1 - 0.07 * g;
  }
  if (s > 0.62) s = 0.62 + (s - 0.62) * 0.55; // soft knee on very loud colours
  if (l > 0.88) l = 0.88 + (l - 0.88) * 0.6;  // cream, not paper-white
  if (l < 0.12) l = 0.12 - (0.12 - l) * 0.5;  // deep brown-black, never pure black
  _gcol.setHSL(h, s, l);
  _gcol.r = _gcol.r * 0.97 + 0.03; _gcol.g = _gcol.g * 0.97 + 0.026; _gcol.b = _gcol.b * 0.97 + 0.018; // golden-hour split tone
  out = _gcol.getHex();
  _gradeCache.set(hex, out);
  return out;
}
/** Light palette: a golden sun against a cool periwinkle sky fill, so lit faces glow warm and shadows fall cool. */
const SUN_DAY = 0xffe6c0, HEMI_SKY = 0xc6d3ec, HEMI_GROUND = 0x7d6a46, SKY_DAY = 0xcfe0da;
/** Shift a colour's hue (in degrees) and lightness — for gentle variety inside one family. */
function varyHex(hex, dh, dl) {
  _gcol.setHex(hex).getHSL(_hsl);
  _gcol.setHSL((_hsl.h + dh / 360 + 1) % 1, _hsl.s, clamp(_hsl.l + dl, 0, 1));
  return _gcol.getHex();
}

/* ---------- geometry helpers ---------- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
function P(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute('normal', g.attributes.normal.clone()); // keep smooth normals for a soft, rounded look
  _eu.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_eu);
  _vp.set(x || 0, y || 0, z || 0);
  _vs.set(sx || 1, sy || 1, sz || 1);
  _m4.compose(_vp, _q, _vs);
  out.applyMatrix4(_m4);
  const n = out.attributes.position.count, col = new THREE.Color(typeof color === 'number' ? grade(color) : color), arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}
/*
 * Segment budget by size: big round things stay smooth, tiny details (eyes, beads, bangles) get far
 * fewer triangles. They are only a few pixels on screen, so they look the same, and a villager costs
 * a fraction of what it used to. 3–4 sided shapes (pyramids, square spires) stay crisp.
 */
const segFor = (r) => (r < 0.035 ? 6 : r < 0.07 ? 8 : r < 0.14 ? 10 : r < 0.3 ? 12 : r < 0.6 ? 16 : 20);
const segs = (s, r) => (s && s <= 4 ? s : r == null ? Math.max(s || 0, 14) : segFor(r));
const sphSeg = (r, ws, hs) => { const w = ws || segFor(r); return [w, hs || Math.max(4, Math.round(w * 0.7))]; };
// bottom-anchored shapes: y is the bottom of the shape
const box = (w, h, d, c, x, y, z, ry, rx, rz) => P(new THREE.BoxGeometry(w, h, d), c, x, (y || 0) + h / 2, z, rx, ry, rz);
const cyl = (rt, rb, h, seg, c, x, y, z, rx, ry, rz) => P(new THREE.CylinderGeometry(rt, rb, h, segs(seg, Math.max(rt, rb))), c, x, (y || 0) + h / 2, z, rx, ry, rz);
const cone = (r, h, seg, c, x, y, z, rx, ry, rz) => P(new THREE.ConeGeometry(r, h, segs(seg, r)), c, x, (y || 0) + h / 2, z, rx, ry, rz);
const sph = (r, c, x, y, z, sx, sy, sz, ws, hs) => P(new THREE.SphereGeometry(r, ...sphSeg(r * Math.max(sx || 1, sy || 1, sz || 1), ws, hs)), c, x, y, z, 0, 0, 0, sx, sy, sz);
// centre-anchored versions for rotated parts
const boxC = (w, h, d, c, x, y, z, rx, ry, rz) => P(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const cylC = (rt, rb, h, seg, c, x, y, z, rx, ry, rz) => P(new THREE.CylinderGeometry(rt, rb, h, segs(seg, Math.max(rt, rb))), c, x, y, z, rx, ry, rz);
const coneC = (r, h, seg, c, x, y, z, rx, ry, rz) => P(new THREE.ConeGeometry(r, h, segs(seg, r)), c, x, y, z, rx, ry, rz);
const sphR = (r, c, x, y, z, rx, ry, rz, sx, sy, sz, ws, hs) => P(new THREE.SphereGeometry(r, ...sphSeg(r * Math.max(sx || 1, sy || 1, sz || 1), ws, hs)), c, x, y, z, rx, ry, rz, sx, sy, sz);
/** A rounded limb: cylinder with ball ends, hanging down from y. */
const limb = (r, len, c, x, y, z) => [cyl(r, r, len, 12, c, x, y - len, z), sph(r, c, x, y - len, z, 1, 1, 1, 12, 8)];

/** Outline normals: average the normals of every vertex sharing a position so hard edges get a closed ink line. */
function addOutlineNormals(g) {
  const pos = g.attributes.position.array, nor = g.attributes.normal.array, n = pos.length / 3;
  const acc = new Map(), key = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos[i * 3] * 500) + ',' + Math.round(pos[i * 3 + 1] * 500) + ',' + Math.round(pos[i * 3 + 2] * 500);
    key[i] = k;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = [0, 0, 0]));
    a[0] += nor[i * 3]; a[1] += nor[i * 3 + 1]; a[2] += nor[i * 3 + 2];
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = acc.get(key[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  g.setAttribute('onormal', new THREE.BufferAttribute(out, 3));
}
function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.array.length;
  const pos = new Float32Array(n), nor = new Float32Array(n), col = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    nor.set(p.attributes.normal.array, o);
    col.set(p.attributes.color.array, o);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (MAT.useOutline !== false) addOutlineNormals(g); // only needed for ink outlines, and costly to build
  g.computeBoundingSphere();
  return g;
}
function meshOf(parts, mat, noShadow, noOutline, big) {
  const geo = Array.isArray(parts) ? merge(parts) : parts;
  const m = new THREE.Mesh(geo, mat || MAT.std);
  m.castShadow = !noShadow;
  m.receiveShadow = true;
  if (MAT.useOutline && !noOutline && geo.attributes.onormal) {
    const o = new THREE.Mesh(geo, big ? MAT.outlineBig : MAT.outline);
    o.userData.outline = true;
    o.raycast = () => {};
    m.add(o);
  }
  return m;
}
/*
 * X-ray silhouette: drawn only where something else is in front (depth test "greater"), as a soft
 * rim-lit glow. Vertices are pulled toward the camera along the view ray first, so the shape stays
 * the same on screen while a character's own parts (an arm in front of the body) never trigger it;
 * only real occluders like trees, huts and walls do. offset is that pull in world units.
 */
function silMat(color, offset) {
  MAT.sil = MAT.sil || {};
  const k = color + '_' + offset.toFixed(2);
  if (MAT.sil[k]) return MAT.sil[k];
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOffset: { value: offset } },
    vertexShader: `uniform float uOffset; varying float vRim;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal), v = normalize(-mv.xyz);
        vRim = 1.0 - abs(dot(n, v));
        mv.xyz += v * uOffset;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vRim;
      void main() { gl_FragColor = vec4(uColor, 0.28 + 0.5 * vRim * vRim); }`,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
  });
  m.userData.sil = true;
  MAT.sil[k] = m;
  return m;
}
/** Give an object an x-ray silhouette twin of its biggest part (one extra draw, shares the geometry). */
function addSilhouette(obj, color, offset) {
  let best = null, n = 0;
  obj.traverse((c) => {
    if (!c.isMesh || !c.geometry || !c.geometry.attributes.position || c.userData.outline) return;
    const cnt = c.geometry.attributes.position.count * (c.material && c.material.isMeshBasicMaterial ? 0.2 : 1);
    if (cnt > n) { n = cnt; best = c; }
  });
  if (!best) return null;
  const s = new THREE.Mesh(best.geometry, silMat(color, offset));
  s.renderOrder = 6; s.castShadow = false; s.receiveShadow = false;
  s.raycast = () => {};
  s.userData.sil = true;
  best.add(s);
  return s;
}
function glowMesh(geo, color, opacity) {
  const m = new THREE.Mesh(geo, glowMat(color, opacity));
  m.castShadow = false;
  return m;
}
function flag(color, w, h) { // a little triangle flag, pivot at the pole
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, -h, 0, w, -h / 2, 0, 0, 0, 0, w, -h / 2, 0, 0, -h, 0]), 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  m.castShadow = true;
  return m;
}
/** A flickering flame of layered cones. Small flames (torches, lamps) use 5 layers instead of 11. */
function flameCluster(scale) {
  const g = new THREE.Group();
  const parts = [];
  const lite = scale < 0.5;
  const add = (r, h, c, x, z, ph, op) => {
    const m = glowMesh(new THREE.ConeGeometry(r * scale, h * scale, 5), c, op);
    m.userData = { h: h * scale, ph, bx: x * scale, bz: z * scale, s: scale };
    m.position.set(x * scale, (h * scale) / 2, z * scale);
    g.add(m);
    parts.push(m);
  };
  const outer = lite ? 3 : 6, mid = lite ? 1 : 3;
  for (let i = 0; i < outer; i++) { const a = (i / outer) * Math.PI * 2; add(lite ? 0.2 : 0.17, 0.85 + (i % 2) * 0.35, 0xe8461c, Math.cos(a) * 0.24, Math.sin(a) * 0.24, i * 1.3, 0.9); }
  for (let i = 0; i < mid; i++) { const a = (i / mid) * Math.PI * 2 + 0.5; add(0.17, 1.0, 0xff8a1f, mid > 1 ? Math.cos(a) * 0.11 : 0, mid > 1 ? Math.sin(a) * 0.11 : 0, i * 2.1 + 0.5, 0.95); }
  add(0.16, 0.78, 0xffc233, 0, 0, 3.3);
  add(0.08, 0.45, 0xfff3b0, 0, 0, 4.1);
  g.userData.layers = parts;
  return g;
}
function animateFlames(g, t, intensity) {
  if (!g || !g.userData.layers) return;
  for (const m of g.userData.layers) {
    const u = m.userData;
    const f = (0.74 + 0.22 * Math.sin(t * 11 + u.ph) + 0.1 * Math.sin(t * 23 + u.ph * 2)) * intensity;
    m.scale.set(1, Math.max(0.05, f), 1);
    m.position.set(u.bx + Math.sin(t * 7 + u.ph) * 0.03 * u.s, (u.h * f) / 2, u.bz + Math.cos(t * 6 + u.ph) * 0.03 * u.s);
    m.rotation.set(Math.sin(t * 5 + u.ph) * 0.12, t * 0.6 + u.ph, Math.cos(t * 4.5 + u.ph) * 0.12);
  }
}

/* ---------- buildings ---------- */
const Models = {};

Models.building = function (type, level) {
  level = level || 1;
  const g = new THREE.Group();
  const p = [];
  const ud = g.userData;
  ud.flames = []; ud.flags = []; ud.lights = [];
  const mt = (BUILDINGS[type] && BUILDINGS[type].model) || type;
  switch (mt) {
    case 'woodcamp': {
      for (const [sx, sz] of [[-0.8, -0.7], [0.8, -0.7], [-0.8, 0.1], [0.8, 0.1]]) p.push(cyl(0.05, 0.06, 1.35, 8, C.wood, sx, 0, sz));
      p.push(boxC(1.9, 0.09, 1.25, C.thatch, 0, 1.38, -0.3, 0.32));
      addPiles(g, [['wood', -0.05, 0, -0.3, 1.0, 0]]);
      p.push(cyl(0.2, 0.23, 0.32, 14, 0x7a5638, 0.5, 0, 0.55)); p.push(cyl(0.2, 0.2, 0.02, 14, 0xe8c896, 0.5, 0.32, 0.55));
      p.push(cylC(0.025, 0.025, 0.5, 8, 0x8a5a2e, 0.5, 0.55, 0.55, 0, 0, 0.5)); p.push(sphR(0.09, 0xd0d4dc, 0.42, 0.36, 0.55, 0, 0, 0.5, 0.35, 0.9, 1));
      p.push(boxC(0.7, 0.06, 0.06, 0x9a6a3a, -0.5, 0.45, 0.55)); p.push(boxC(0.06, 0.45, 0.06, 0x7a4b26, -0.75, 0.22, 0.55, 0, 0, 0.3)); p.push(boxC(0.06, 0.45, 0.06, 0x7a4b26, -0.25, 0.22, 0.55, 0, 0, -0.3));
      break;
    }
    case 'minecamp': {
      for (const [sx, sz] of [[-0.8, -0.75], [0.15, -0.75], [-0.8, 0.0], [0.15, 0.0]]) p.push(cyl(0.05, 0.06, 1.2, 8, C.wood, sx, 0, sz));
      p.push(boxC(1.25, 0.08, 1.05, C.tile, -0.32, 1.25, -0.37, 0.28));
      addPiles(g, [['stone', 0.6, 0, -0.1, 0.75, 0.4], ['gold', 0.62, 0, 0.62, 0.55, -0.5]]);
      for (let k = 0; k < 3; k++) p.push(box(0.3, 0.22, 0.22, k % 2 ? 0xc9c4b8 : 0xb8b2a6, -0.55 + k * 0.32, 0, 0.55));
      p.push(box(0.3, 0.22, 0.22, 0xc9c4b8, -0.4, 0.22, 0.55));
      p.push(box(0.5, 0.22, 0.35, 0x8a5a2e, -0.35, 0.2, -0.35)); p.push(P(new THREE.TorusGeometry(0.13, 0.03, 6, 14), 0x5a3a20, -0.35, 0.14, -0.1));
      p.push(cylC(0.025, 0.025, 0.55, 8, 0x8a5a2e, 0.15, 0.3, 0.75, 0.3, 0, 0)); p.push(cylC(0.022, 0.012, 0.34, 8, 0xc0c4cc, 0.15, 0.55, 0.66, Math.PI / 2 + 0.3));
      break;
    }
    case 'buildyard': {
      for (const [sx, sz] of [[-0.8, -0.75], [0.8, -0.75], [-0.8, 0.05], [0.8, 0.05]]) p.push(cyl(0.05, 0.06, 1.3, 8, C.wood, sx, 0, sz));
      p.push(boxC(1.95, 0.08, 0.6, C.tile, 0, 1.4, -0.12, 0.45)); p.push(boxC(1.95, 0.08, 0.6, C.tile, 0, 1.4, -0.58, -0.45));
      p.push(box(1.2, 0.08, 0.5, 0x9a6a3a, 0, 0.55, -0.35)); for (const sx of [-0.5, 0.5]) p.push(box(0.07, 0.55, 0.4, 0x7a4b26, sx, 0, -0.35));
      for (let k = 0; k < 4; k++) p.push(box(1.1, 0.05, 0.22, k % 2 ? 0xc89a5e : 0xb8854a, 0.2, k * 0.05, 0.55));
      for (let k = 0; k < 5; k++) p.push(cylC(0.03, 0.03, 1.4, 8, C.bamboo, 0.85 + k * 0.035, 0.68, 0.5, 0, 0, -0.18));
      for (const sx of [-0.62, -0.38]) p.push(cylC(0.025, 0.025, 1.3, 6, 0x9a6a3a, sx, 0.64, 0.55, -0.2, 0, 0));
      for (let k = 0; k < 5; k++) p.push(boxC(0.26, 0.025, 0.025, 0x9a6a3a, -0.5, 0.15 + k * 0.24, 0.6 - k * 0.05));
      p.push(P(new THREE.TorusGeometry(0.12, 0.035, 6, 14), 0xd8c28a, -0.1, 0.62, -0.35, Math.PI / 2));
      p.push(box(0.12, 0.09, 0.18, 0x55555f, 0.3, 0.63, -0.35));
      break;
    }
    case 'bighouse': {
      p.push(box(3.9, 0.14, 1.9, C.mudD, 0, 0, 0));
      p.push(box(3.5, 1.0, 1.35, C.mud, 0, 0.14, -0.1));
      p.push(box(3.52, 0.07, 1.37, C.white, 0, 0.32, -0.1));
      for (const sx of [-0.9, 0.9]) { p.push(box(0.38, 0.64, 0.08, C.dark, sx, 0.14, 0.58)); for (let i = 0; i < 5; i++) p.push(box(0.06, 0.06, 0.06, i % 2 ? C.saffron : C.marigold, sx - 0.16 + i * 0.08, 0.8, 0.64)); }
      p.push(box(0.36, 0.26, 0.06, C.dark, 0, 0.5, 0.58)); p.push(box(0.4, 0.04, 0.08, C.wood, 0, 0.48, 0.6));
      for (let i = 0; i < 9; i++) p.push(sph(0.03, C.white, -1.55 + i * 0.39, 0.65 + (i % 2) * 0.08, 0.585));
      for (const sx of [-1.7, -0.55, 0.55, 1.7]) p.push(cyl(0.05, 0.06, 1.05, 10, C.woodL, sx, 0.14, 0.82));
      p.push(box(3.6, 0.08, 0.1, C.wood, 0, 1.15, 0.82));
      const hoop = new THREE.CylinderGeometry(1.08, 1.08, 3.95, 18, 1, false, 0, Math.PI);
      p.push(P(hoop, C.thatch, 0, 1.12, -0.02, 0, 0, Math.PI / 2, 0.62, 1, 0.84));
      for (const sx of [-1.98, 1.98]) p.push(P(new THREE.CylinderGeometry(1.1, 1.1, 0.06, 18, 1, false, 0, Math.PI), C.thatchD, sx, 1.12, -0.02, 0, 0, Math.PI / 2, 0.64, 1, 0.86));
      // charpai (rope cot) and a tulsi planter in the courtyard
      p.push(box(0.9, 0.06, 0.5, 0x8a5a2e, -1.25, 0.32, 1.25)); p.push(box(0.82, 0.03, 0.42, 0xe8dcc0, -1.25, 0.38, 1.25));
      for (const [ax, az] of [[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]]) p.push(cyl(0.025, 0.025, 0.32, 6, 0x7a4b26, -1.25 + ax, 0, 1.25 + az));
      p.push(box(0.3, 0.32, 0.3, 0xd8c8b0, 1.3, 0, 1.25)); p.push(box(0.34, 0.05, 0.34, 0xe03c31, 1.3, 0.3, 1.25));
      p.push(sph(0.14, 0x3f9a3c, 1.3, 0.5, 1.25, 1, 1.2, 1)); p.push(sph(0.13, C.brick, -0.2, 0.13, 1.1));
      ud.lights.push({ x: -0.9, y: 0.5, z: 0.9, r: 3, c: 0xffb060 }, { x: 0.9, y: 0.5, z: 0.9, r: 3, c: 0xffb060 });
      break;
    }
    case 'bigfield': {
      p.push(box(5.85, 0.1, 2.85, C.soil, 0, 0, 0));
      for (const s of [-1, 1]) { p.push(box(5.95, 0.16, 0.12, 0x7a5233, 0, 0, s * 1.42)); p.push(box(0.12, 0.16, 2.95, 0x7a5233, s * 2.92, 0, 0)); }
      for (let i = -2; i <= 2; i++) p.push(box(5.6, 0.04, 0.12, 0x4a2e1a, 0, 0.1, i * 0.52));
      p.push(box(0.1, 0.12, 2.9, 0x6a4628, 0, 0.1, 0));
      for (const fx of [-2.6, 2.6]) {
        p.push(cyl(0.03, 0.03, 1.2, 8, C.wood, fx, 0, -1.2)); p.push(box(0.6, 0.04, 0.04, C.wood, fx, 0.85, -1.2));
        p.push(box(0.26, 0.3, 0.14, fx < 0 ? C.red : 0x2a9d6f, fx, 0.62, -1.2)); p.push(sph(0.12, C.brick, fx, 1.12, -1.2)); p.push(cone(0.18, 0.12, 12, C.thatch, fx, 1.2, -1.2));
      }
      const cp = [];
      for (let i = -2; i <= 2; i++) for (let j = -5; j <= 5; j++) if (!(i === 2 && j === -5)) cp.push(cone(0.13, 0.55, 6, 0xffffff, j * 0.5 + (i % 2) * 0.1, 0, i * 0.52 + 0.04));
      addPiles(g, [['food', -2.6, 0.1, 1.1, 0.58, 0.6]]);
      const crops = new THREE.Mesh(merge(cp), surfaceMat({ vertexColors: true, color: 0x7fbf3f }));
      crops.position.y = 0.1; crops.castShadow = true;
      g.add(crops); ud.crops = crops;
      break;
    }
    case 'hut': {
      const limed = level >= 3; // a lime-washed house with a red-oxide skirting at the top level
      p.push(cyl(0.95, 1.0, 0.12, 10, C.mudD, 0, 0, 0));
      p.push(cyl(0.78, 0.8, 0.95, 10, limed ? 0xece0c6 : C.mud, 0, 0.12, 0));
      p.push(cyl(0.81, 0.81, limed ? 0.2 : 0.08, 10, limed ? 0xa8452c : C.white, 0, limed ? 0.12 : 0.28, 0));
      // door frame, a barred window, dung cakes drying on the wall and a string of red chillies
      p.push(box(0.07, 0.66, 0.1, C.wood, -0.21, 0.12, 0.77)); p.push(box(0.07, 0.66, 0.1, C.wood, 0.21, 0.12, 0.77)); p.push(box(0.5, 0.07, 0.11, C.wood, 0, 0.76, 0.77));
      { const a = 1.25, wx = Math.sin(a) * 0.79, wz = Math.cos(a) * 0.79;
        p.push(box(0.26, 0.22, 0.05, C.dark, wx, 0.42, wz, a)); p.push(box(0.32, 0.04, 0.07, C.wood, wx, 0.4, wz, a));
        for (const o of [-0.07, 0, 0.07]) p.push(box(0.018, 0.22, 0.02, C.wood, wx + Math.cos(a) * o, 0.42, wz - Math.sin(a) * o, a)); }
      for (let i = 0; i < 6; i++) { const a = 2.5 + (i % 3) * 0.32, y = 0.3 + Math.floor(i / 3) * 0.2;
        p.push(cylC(0.065, 0.065, 0.025, 8, 0x6e5238, Math.sin(a) * 0.8, y, Math.cos(a) * 0.8, 0, a + Math.PI / 2, Math.PI / 2)); }
      for (let i = 0; i < 5; i++) p.push(coneC(0.022, 0.09, 5, C.red, 0.3, 0.92 - i * 0.065, 0.76, Math.PI));
      if (level >= 2) p.push(box(0.62, 0.07, 0.22, C.mudD, 0, 0, 0.9)); // a mud step at the door
      p.push(box(0.36, 0.62, 0.1, C.dark, 0, 0.12, 0.76));
      for (let i = 0; i < 6; i++) p.push(box(0.06, 0.06, 0.06, i % 2 ? C.saffron : C.marigold, -0.18 + i * 0.072, 0.76, 0.82));
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; if (Math.abs(a) < 0.5 || a > Math.PI * 2 - 0.5) continue; p.push(box(0.05, 0.05, 0.05, C.white, Math.sin(a) * 0.8, 0.62 + (i % 2) * 0.1, Math.cos(a) * 0.8)); }
      const roof = [[1.24, 0], [1.16, 0.14], [0.98, 0.38], [0.72, 0.64], [0.42, 0.86], [0.16, 0.98], [0.001, 1.02]].map(([x, y]) => new THREE.Vector2(x, y));
      p.push(P(new THREE.LatheGeometry(roof, 18), C.thatch, 0, 1.0, 0));
      p.push(P(new THREE.TorusGeometry(1.2, 0.07, 6, 24), C.thatchD, 0, 1.02, 0, Math.PI / 2));
      p.push(sph(0.13, C.thatchD, 0, 2.02, 0, 1, 1.3, 1));
      p.push(sph(0.14, C.brick, 0.62, 0.14, 0.55));
      p.push(sph(0.1, C.brickD, 0.78, 0.1, 0.38));
      ud.lights.push({ x: 0, y: 0.5, z: 0.95, r: 3.2, c: 0xffb060 });
      break;
    }
    case 'field': {
      p.push(box(2.85, 0.1, 2.85, C.soil, 0, 0, 0));
      for (const s of [-1, 1]) { p.push(box(2.95, 0.16, 0.12, 0x7a5233, 0, 0, s * 1.42)); p.push(box(0.12, 0.16, 2.95, 0x7a5233, s * 1.42, 0, 0)); }
      for (let i = -2; i <= 2; i++) p.push(box(2.6, 0.04, 0.12, 0x4a2e1a, 0, 0.1, i * 0.52));
      // bijuka (scarecrow)
      p.push(cyl(0.03, 0.03, 1.2, 5, C.wood, 1.2, 0, -1.2));
      p.push(box(0.6, 0.04, 0.04, C.wood, 1.2, 0.85, -1.2));
      p.push(box(0.26, 0.3, 0.14, C.red, 1.2, 0.62, -1.2));
      p.push(sph(0.12, C.brick, 1.2, 1.12, -1.2));
      p.push(cone(0.18, 0.12, 6, C.thatch, 1.2, 1.2, -1.2));
      // crops: own mesh so it can grow and ripen
      const cp = [];
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (!(i === 2 && j === -2)) cp.push(cone(0.13, 0.55, 4, 0xffffff, j * 0.5 + (i % 2) * 0.1, 0, i * 0.52 + 0.04));
      addPiles(g, [['food', -1.1, 0.1, 1.1, 0.5, 0.6]]); // harvested sacks wait in the corner
      const crops = new THREE.Mesh(merge(cp), surfaceMat({ vertexColors: true, color: 0x7fbf3f }));
      crops.position.y = 0.1;
      crops.castShadow = true;
      g.add(crops);
      ud.crops = crops;
      break;
    }
    case 'store': {
      // Bhandar: an open storehouse whose floor is split into bays, each holding the one good the player picks.
      // Level 1 has 4 bays under thatch; level 2 has 6 on a stone floor with wattle side walls; level 3 has 8 under a clay-tile roof.
      const lv = clamp(level, 1, 3), cols = lv + 1, W = 1.76, cw = W / cols, y0 = lv >= 2 ? 0.1 : 0.05;
      const sc = [0, 0.62, 0.5, 0.41][lv], roofC = lv >= 3 ? C.tile : C.thatch, roofD = lv >= 3 ? 0x8a3a22 : C.thatchD;
      p.push(box(1.98, y0, 1.72, lv >= 3 ? 0xa04a2c : lv >= 2 ? 0xb3ad9f : C.mudD, 0, 0, -0.02)); // floor or plinth
      if (lv >= 2) for (let i = 0; i < 9; i++) p.push(box(0.2, 0.012, 1.6, i % 2 ? 0xa8a296 : 0xbab4a6, -0.88 + i * 0.22, y0, -0.02)); // flagstones
      const postC = lv >= 3 ? C.woodL : C.wood, posts = lv >= 2 ? [-0.9, 0, 0.9] : [-0.9, 0.9];
      for (const sx of posts) for (const sz of [-0.72, 0.72]) {
        p.push(cyl(0.055, 0.065, 1.22, 8, postC, sx, y0, sz));
        if (lv >= 2) p.push(box(0.17, 0.09, 0.17, 0xd8c8b0, sx, y0, sz)); // stone footing
        if (lv >= 3) { p.push(boxC(0.3, 0.06, 0.08, C.wood, sx, y0 + 1.1, sz)); p.push(sph(0.045, C.gold, sx, y0 + 1.1, sz + (sz > 0 ? 0.06 : -0.06))); } // carved bracket
      }
      p.push(box(1.9, 0.07, 0.08, C.wood, 0, y0 + 1.15, 0.72)); p.push(box(1.9, 0.07, 0.08, C.wood, 0, y0 + 1.15, -0.72)); // beams
      // pitched roof, with a thicker eave from level 2
      p.push(boxC(2.12, 0.08, 1.02, roofC, 0, y0 + 1.45, 0.38, 0.52)); p.push(boxC(2.12, 0.08, 1.02, roofC, 0, y0 + 1.45, -0.38, -0.52));
      if (lv >= 2) { p.push(boxC(2.16, 0.05, 0.3, roofD, 0, y0 + 1.24, 0.82, 0.52)); p.push(boxC(2.16, 0.05, 0.3, roofD, 0, y0 + 1.24, -0.82, -0.52)); }
      if (lv >= 3) for (let i = 0; i < 9; i++) for (const s of [-1, 1]) p.push(cylC(0.03, 0.03, 1.0, 6, 0x9a4428, -0.96 + i * 0.24, y0 + 1.495, s * 0.405, Math.PI / 2 + s * 0.52, 0, 0)); // rows of clay tiles down the slope
      p.push(cylC(0.05, 0.05, 2.16, 8, roofD, 0, y0 + 1.7, 0, 0, 0, Math.PI / 2)); // ridge
      // wattle-and-daub back wall; side walls from level 2
      p.push(box(1.86, 0.92, 0.08, 0xc8a46a, 0, y0, -0.72));
      for (let i = 0; i < 10; i++) p.push(box(0.035, 0.92, 0.035, 0x9a6a3a, -0.84 + i * 0.187, y0, -0.67));
      if (lv >= 2) for (const sx of [-0.92, 0.92]) { p.push(box(0.08, 0.6, 1.36, 0xc8a46a, sx, y0, -0.02)); p.push(box(0.1, 0.05, 1.4, C.white, sx, y0 + 0.6, -0.02)); }
      // plank dividers between the bays
      for (let c = 1; c < cols; c++) p.push(box(0.045, 0.26, 1.24, 0x9a6a3a, -W / 2 + c * cw, y0, -0.04));
      p.push(box(W, 0.18, 0.045, 0x8a5a2e, 0, y0, -0.02));
      // one heap per bay, back row first; the renderer sets which good each one shows
      const spots = [];
      for (const z of [-0.34, 0.32]) for (let c = 0; c < cols; c++) spots.push([RES_ORDER[spots.length % RES_ORDER.length], -W / 2 + cw * (c + 0.5), y0, z, sc, 0]);
      addPiles(g, spots); ud.bays = true;
      p.push(sph(0.1, C.brick, 0.98, 0.1, 0.0)); p.push(cyl(0.05, 0.07, 0.05, 10, C.brickD, 0.98, 0.19, 0.0)); // a matka by the post
      if (lv >= 2) { // a taraju (balance scale) hanging from the front beam, grain sacks and a lantern
        const tx = -0.45, ty = y0 + 0.9, tz = 0.74;
        p.push(cyl(0.006, 0.006, 0.25, 3, 0x3a2a1a, tx, ty, tz)); p.push(boxC(0.4, 0.022, 0.022, C.wood, tx, ty, tz));
        for (const sx of [-0.18, 0.18]) { p.push(cyl(0.004, 0.004, 0.2, 3, 0x3a2a1a, tx + sx, ty - 0.2, tz)); p.push(cyl(0.075, 0.05, 0.022, 10, C.gold, tx + sx, ty - 0.22, tz)); }
        for (const [sx, sy] of [[0.36, 0], [0.56, 0], [0.46, 0.15]]) p.push(sph(0.1, 0xd8c090, sx, y0 + sy + 0.08, 0.86, 1, 0.8, 0.85));
        const lamp = glowMesh(new THREE.SphereGeometry(0.055, 8, 6), 0xffc060); lamp.position.set(0.12, y0 + 1.0, 0.74); g.add(lamp); ud.flames.push(lamp);
        p.push(cyl(0.004, 0.004, 0.12, 3, 0x2a2a2a, 0.12, y0 + 1.04, 0.74));
        ud.lights.push({ x: 0.12, y: 1.0, z: 0.8, r: 3, c: 0xffc070 });
      }
      if (lv >= 3) { // the munim's low desk under the scale, with the red bahi-khata ledger
        p.push(box(0.32, 0.14, 0.18, C.woodL, -0.45, 0, 0.9)); p.push(box(0.16, 0.03, 0.11, C.red, -0.45, 0.14, 0.9)); p.push(box(0.03, 0.035, 0.11, C.gold, -0.45, 0.14, 0.9));
      }
      break;
    }
    case 'palisade': {
      for (let k = 0; k < 4; k++) {
        const x = -0.36 + k * 0.24, h = 1.25 + ((k * 7) % 3) * 0.08;
        p.push(cyl(0.065, 0.07, h, 6, k % 2 ? C.bamboo : 0xa8923f, x, 0, 0));
        p.push(cone(0.065, 0.16, 6, 0x8a7a3a, x, h, 0));
        for (let y = 0.3; y < h; y += 0.35) p.push(cyl(0.075, 0.075, 0.03, 6, C.bambooD, x, y, 0));
      }
      p.push(box(1.0, 0.05, 0.16, 0x6b4a2a, 0, 0.4, 0));
      p.push(box(1.0, 0.05, 0.16, 0x6b4a2a, 0, 0.95, 0));
      break;
    }
    case 'wall': {
      p.push(box(1.02, 1.25, 0.6, C.sand, 0, 0, 0));
      for (let y = 0.3; y < 1.25; y += 0.3) p.push(box(1.04, 0.03, 0.62, C.sandD, 0, y, 0));
      for (const x of [-0.36, 0, 0.36]) { p.push(box(0.22, 0.2, 0.6, C.sand, x, 1.25, 0)); p.push(cone(0.15, 0.16, 4, 0xe8c08a, x, 1.45, 0, 0, Math.PI / 4)); }
      p.push(box(0.08, 0.3, 0.64, C.dark, 0.18, 0.7, 0));
      break;
    }
    case 'akhara': {
      p.push(box(2.8, 0.12, 2.8, 0xb8643c, 0, 0, 0));
      for (const s of [-1, 1]) { p.push(box(2.9, 0.18, 0.1, C.wood, 0, 0, s * 1.4)); p.push(box(0.1, 0.18, 2.9, C.wood, s * 1.4, 0, 0)); }
      p.push(cyl(0.07, 0.1, 1.7, 8, C.woodL, -0.85, 0.12, -0.85));
      p.push(sph(0.1, C.woodL, -0.85, 1.88, -0.85));
      p.push(cyl(0.05, 0.07, 0.12, 8, C.woodL, -0.85, 1.75, -0.85));
      p.push(cyl(0.03, 0.03, 0.8, 5, C.wood, 0.7, 0.12, -1.2)); p.push(cyl(0.03, 0.03, 0.8, 5, C.wood, 1.2, 0.12, -1.2));
      p.push(boxC(0.6, 0.04, 0.04, C.wood, 0.95, 0.9, -1.2));
      for (const x of [0.82, 1.08]) { p.push(cyl(0.02, 0.02, 0.5, 5, C.wood, x, 0.3, -1.12)); p.push(sph(0.1, C.gold, x, 0.25, -1.12)); }
      p.push(cyl(0.03, 0.03, 2.4, 5, C.wood, 1.25, 0.12, 1.25));
      const f = flag(C.saffron, 0.6, 0.4); f.position.set(1.25, 2.5, 1.25); g.add(f); ud.flags.push(f);
      break;
    }
    case 'range': {
      for (const sx of [-1.35, -0.35]) for (const sz of [-0.7, 0.2]) p.push(cyl(0.04, 0.05, 1.2, 5, C.wood, sx, 0, sz));
      p.push(boxC(1.3, 0.07, 1.25, C.thatch, -0.85, 1.28, -0.25, 0.3));
      p.push(box(0.8, 0.3, 0.45, C.thatch, -0.85, 0, -0.25));
      p.push(cyl(0.12, 0.1, 0.35, 6, C.brick, -0.4, 0, 0.6));
      for (let i = 0; i < 4; i++) p.push(cylC(0.015, 0.015, 0.55, 3, 0xc89a5e, -0.43 + i * 0.03, 0.5, 0.6, 0.1 * (i - 1.5), 0, 0.12 * (i - 1.5)));
      p.push(cyl(0.04, 0.04, 0.8, 5, C.wood, 0.85, 0, 0.0)); p.push(cyl(0.04, 0.04, 0.8, 5, C.wood, 1.35, 0, 0.0));
      const tg = [[0.45, 0xe9dcb8], [0.36, C.red], [0.24, 0xf4ecd8], [0.13, C.gold]];
      tg.forEach(([r, c], i) => p.push(cylC(r, r, 0.08 + i * 0.02, 12, c, 1.1, 0.95, 0.05 + i * 0.01, Math.PI / 2)));
      break;
    }
    case 'well': {
      p.push(cyl(0.6, 0.64, 0.55, 10, C.stone, 0, 0, 0));
      for (let y = 0.15; y < 0.55; y += 0.18) p.push(cyl(0.645, 0.645, 0.03, 10, C.stoneD, 0, y, 0));
      p.push(cyl(0.68, 0.68, 0.08, 10, 0xb8b4ab, 0, 0.55, 0));
      p.push(cyl(0.5, 0.5, 0.02, 10, 0x1f4f6a, 0, 0.58, 0));
      p.push(cyl(0.05, 0.06, 1.3, 5, C.wood, -0.58, 0.1, 0)); p.push(cyl(0.05, 0.06, 1.3, 5, C.wood, 0.58, 0.1, 0));
      p.push(cylC(0.04, 0.04, 1.3, 6, 0x8a5a2e, 0, 1.3, 0, 0, 0, Math.PI / 2));
      p.push(boxC(1.4, 0.06, 0.55, C.tile, 0, 1.55, 0.2, 0.5)); p.push(boxC(1.4, 0.06, 0.55, C.tile, 0, 1.55, -0.2, -0.5));
      p.push(box(0.02, 0.5, 0.02, 0xc8a46a, 0, 0.8, 0));
      p.push(cyl(0.09, 0.07, 0.14, 8, C.gold, 0, 0.68, 0));
      break;
    }
    case 'bazaar': {
      for (const sx of [-1.3, 1.3]) for (const sz of [-0.75, 0.7]) p.push(cyl(0.04, 0.05, 1.6, 5, C.wood, sx, 0, sz));
      p.push(box(2.4, 0.08, 0.9, 0x8a5a2e, 0, 0.62, 0.1));
      for (const sx of [-1.1, 1.1]) for (const sz of [-0.25, 0.45]) p.push(box(0.06, 0.62, 0.06, C.wood, sx, 0, sz));
      const stripes = [C.saffron, 0xf4ecd8, 0x2a9d6f];
      for (let i = 0; i < 9; i++) p.push(boxC(0.32, 0.05, 1.8, stripes[i % 3], -1.28 + i * 0.32, 1.72, -0.02, 0.32));
      for (let i = 0; i < 9; i++) p.push(boxC(0.32, 0.18, 0.04, stripes[i % 3], -1.28 + i * 0.32, 1.36, 0.86));
      [0xc62828, 0xf9a825, 0x558b2f, 0xef6c00, 0x6d4c41].forEach((c, k) => p.push(cone(0.17, 0.24, 6, c, -0.9 + k * 0.45, 0.7, 0.15)));
      p.push(sph(0.16, C.brick, -0.9, 0.16, -0.3)); p.push(sph(0.14, C.brickD, -0.55, 0.14, -0.4));
      p.push(box(0.32, 0.36, 0.26, 0xd6b47a, 0.7, 0, -0.3)); p.push(box(0.28, 0.3, 0.24, 0xc9a66b, 0.35, 0, -0.42));
      p.push(box(0.12, 0.16, 0.12, C.gold, 0, 1.4, 0.75));
      ud.lights.push({ x: 0, y: 1.3, z: 0.75, r: 3.5, c: 0xffc060 });
      break;
    }
    case 'lamp': {
      p.push(box(0.62, 0.22, 0.62, C.stoneD, 0, 0, 0));
      p.push(cyl(0.12, 0.18, 2.1, 8, 0xa9a49a, 0, 0.22, 0));
      for (let k = 0; k < 4; k++) {
        const y = 0.6 + k * 0.42, r = 0.34 - k * 0.04;
        p.push(cyl(r, r, 0.04, 8, C.stoneD, 0, y, 0));
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + k * 0.4;
          p.push(cyl(0.04, 0.03, 0.04, 5, C.brick, Math.cos(a) * (r - 0.04), y + 0.04, Math.sin(a) * (r - 0.04)));
          const fl = glowMesh(new THREE.ConeGeometry(0.035, 0.1, 4), 0xffcc33);
          fl.position.set(Math.cos(a) * (r - 0.04), y + 0.13, Math.sin(a) * (r - 0.04));
          g.add(fl); ud.flames.push(fl);
        }
      }
      p.push(cyl(0.2, 0.12, 0.1, 8, C.brick, 0, 2.32, 0));
      const top = flameCluster(0.28); top.position.y = 2.42; g.add(top); ud.bigFlame = top;
      ud.lights.push({ x: 0, y: 2.0, z: 0, r: 6.5, c: 0xffa040, always: false, strong: true });
      break;
    }
    case 'forge': {
      p.push(box(1.7, 1.0, 1.3, 0x6d4c41, 0, 0, -0.15));
      p.push(box(0.9, 0.8, 0.05, 0x3e2723, -0.3, 0, 0.51));
      p.push(boxC(1.95, 0.08, 1.0, C.tile, 0, 1.25, 0.25, 0.5)); p.push(boxC(1.95, 0.08, 1.0, C.tile, 0, 1.25, -0.55, -0.5));
      for (let i = 0; i < 4; i++) p.push(boxC(1.97, 0.03, 0.06, 0x7a3218, 0, 1.06 + i * 0.12, 0.6 - i * 0.2, 0.5));
      p.push(box(0.55, 0.65, 0.5, C.brickD, 0.6, 0, 0.55));
      p.push(cyl(0.1, 0.12, 1.2, 6, 0x7a3218, 0.6, 0.65, 0.5));
      p.push(box(0.28, 0.14, 0.14, 0x3a3a42, -0.45, 0.32, 0.75)); p.push(cyl(0.1, 0.12, 0.32, 6, C.wood, -0.45, 0, 0.75));
      const mouth = glowMesh(new THREE.BoxGeometry(0.3, 0.22, 0.04), 0xff6a1a); mouth.position.set(0.6, 0.2, 0.81); g.add(mouth); ud.flames.push(mouth);
      ud.lights.push({ x: 0.6, y: 0.4, z: 1.0, r: 3.5, c: 0xff7a30, always: true });
      if (level >= 2) { // weapon rack with gadas and a second chimney
        p.push(box(0.08, 0.9, 0.08, C.wood, -0.95, 0, 0.6)); p.push(box(0.08, 0.9, 0.08, C.wood, -0.95, 0, 0.0)); p.push(box(0.08, 0.06, 0.68, C.wood, -0.95, 0.8, 0.3));
        for (const z of [0.12, 0.3, 0.48]) { p.push(cyl(0.02, 0.02, 0.45, 6, 0x6b4223, -0.9, 0.32, z)); p.push(sph(0.08, C.gold, -0.9, 0.3, z)); }
        p.push(cyl(0.09, 0.11, 1.0, 10, 0x7a3218, -0.5, 1.0, -0.5));
      }
      if (level >= 3) { // armour stand and saffron banner
        p.push(cyl(0.03, 0.03, 0.9, 6, C.wood, 1.05, 0, -0.35)); p.push(sph(0.16, 0x9a9aa4, 1.05, 0.75, -0.35, 1, 1.2, 0.7)); p.push(sph(0.09, 0x9a9aa4, 1.05, 1.02, -0.35));
        const f = flag(C.saffron, 0.5, 0.32); f.position.set(-0.5, 2.3, -0.5); g.add(f); ud.flags.push(f);
      }
      break;
    }
    case 'sawmill': {
      for (const [sx, sz] of [[-1.35, -0.7], [0.2, -0.7], [-1.35, 0.35], [0.2, 0.35]]) p.push(cyl(0.05, 0.06, 1.4, 8, C.wood, sx, 0, sz));
      p.push(boxC(1.95, 0.09, 1.4, C.thatch, -0.58, 1.48, -0.18, 0.28));
      // saw pit with a log and the big saw
      p.push(box(1.4, 0.1, 0.5, 0x5e3b22, -0.58, 0, -0.15)); p.push(box(0.08, 0.5, 0.08, C.wood, -1.15, 0.1, -0.15)); p.push(box(0.08, 0.5, 0.08, C.wood, -0.05, 0.1, -0.15));
      p.push(cylC(0.16, 0.16, 1.4, 14, 0x9a6a3a, -0.58, 0.75, -0.15, 0, 0, Math.PI / 2));
      p.push(boxC(0.03, 0.9, 0.3, 0xd0d4dc, -0.58, 0.95, -0.15)); p.push(boxC(0.06, 0.06, 0.4, 0x7a4b26, -0.58, 1.42, -0.15));
      for (let k = 0; k < 4; k++) p.push(box(1.0, 0.05, 0.25, k % 2 ? 0xc89a5e : 0xb8854a, 0.95, k * 0.05, 0.4));
      p.push(box(0.6, 0.05, 0.6, 0x8a5a2e, 0.95, 0.5, -0.4)); for (const sx of [0.7, 1.2]) p.push(box(0.05, 0.5, 0.5, 0x7a4b26, sx, 0, -0.4));
      for (let i = 0; i < 3; i++) p.push(P(new THREE.TorusGeometry(0.3, 0.015, 5, 12, Math.PI * 0.9), 0x8a5a2e, 0.85 + i * 0.12, 0.85, -0.55, 0, Math.PI / 2, Math.PI * 0.55));
      if (level >= 2) { // a spear rack and a second shed
        for (let i = 0; i < 4; i++) { p.push(cyl(0.015, 0.015, 1.4, 6, 0x8a5a2e, 1.3, 0, 0.0 + i * 0.12)); p.push(cone(0.035, 0.14, 6, 0xe0e4ea, 1.3, 1.4, 0.0 + i * 0.12)); }
        p.push(box(0.06, 0.06, 0.6, C.wood, 1.3, 0.9, 0.18));
      }
      if (level >= 3) { const f = flag(0xff7a1a, 0.5, 0.32); f.position.set(0.2, 2.3, 0.35); g.add(f); ud.flags.push(f); p.push(cyl(0.02, 0.02, 0.9, 5, C.wood, 0.2, 1.4, 0.35)); const fl = flameCluster(0.12); fl.position.set(1.1, 0.55, -0.4); g.add(fl); ud.bigFlame2 = fl; }
      break;
    }
    case 'belltower': {
      p.push(box(1.5, 1.4, 1.5, C.stone, 0, 0, 0));
      for (let y = 0.35; y < 1.4; y += 0.35) p.push(box(1.52, 0.03, 1.52, C.stoneD, 0, y, 0));
      for (const sx of [-0.62, 0.62]) for (const sz of [-0.62, 0.62]) p.push(cyl(0.08, 0.1, 2.0, 10, C.woodL, sx, 1.4, sz));
      p.push(box(1.6, 0.12, 1.6, C.wood, 0, 3.35, 0));
      p.push(cone(1.15, 0.8, 4, C.tile, 0, 3.47, 0, 0, Math.PI / 4));
      p.push(sph(0.08, C.gold, 0, 4.3, 0));
      p.push(box(1.3, 0.08, 0.08, C.wood, 0, 3.15, 0));
      const bell = new THREE.Group(); bell.position.set(0, 3.15, 0); g.add(bell); ud.bell = bell;
      const prof = [[0.36, -0.78], [0.34, -0.68], [0.26, -0.48], [0.22, -0.22], [0.17, -0.06], [0.001, 0]].map(([x, y]) => new THREE.Vector2(x, y));
      bell.add(meshOf([P(new THREE.LatheGeometry(prof, 16), 0xd4a234, 0, 0, 0), sph(0.07, 0x8a6a22, 0, -0.72, 0), P(new THREE.TorusGeometry(0.33, 0.02, 6, 18), 0xfff0a0, 0, -0.66, 0, Math.PI / 2)]));
      const wave = glowMesh(new THREE.RingGeometry(0.85, 1.0, 40), 0xffe08a, 0.6);
      wave.rotation.x = -Math.PI / 2; wave.position.y = 0.06; wave.visible = false;
      g.add(wave); ud.wave = wave;
      break;
    }
    case 'firetower': {
      p.push(cyl(0.75, 0.85, 3.2, 14, 0xb5532f, 0, 0, 0));
      for (let y = 0.5; y < 3.2; y += 0.55) p.push(cyl(0.78 - y * 0.03, 0.8 - y * 0.03, 0.05, 14, 0x8f3f22, 0, y, 0));
      p.push(box(0.35, 0.6, 0.06, C.dark, 0, 0, 0.82));
      p.push(cyl(0.95, 0.9, 0.18, 14, 0x8f3f22, 0, 3.2, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push(box(0.22, 0.25, 0.14, 0xb5532f, Math.cos(a) * 0.85, 3.38, Math.sin(a) * 0.85, -a)); }
      p.push(cyl(0.38, 0.22, 0.4, 14, 0x3a3a42, 0, 3.38, 0));
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; p.push(sph(0.12, C.brick, Math.cos(a) * 0.58, 3.5, Math.sin(a) * 0.58)); }
      const fl = flameCluster(0.45); fl.position.y = 3.75; g.add(fl); ud.bigFlame2 = fl;
      ud.lights.push({ x: 0, y: 4.2, z: 0, r: 6, c: 0xff7a30, always: true, strong: true });
      break;
    }
    case 'cannontower': {
      p.push(cyl(0.95, 1.05, 2.4, 16, C.sand, 0, 0, 0));
      for (let y = 0.4; y < 2.4; y += 0.5) p.push(cyl(0.98, 1.0, 0.04, 16, C.sandD, 0, y, 0));
      p.push(cyl(1.05, 1.0, 0.2, 16, C.sandD, 0, 2.4, 0));
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; p.push(box(0.26, 0.3, 0.16, C.sand, Math.cos(a) * 0.95, 2.6, Math.sin(a) * 0.95, -a)); p.push(cone(0.1, 0.12, 4, 0xe8c08a, Math.cos(a) * 0.95, 2.9, Math.sin(a) * 0.95)); }
      p.push(box(0.4, 0.7, 0.06, C.dark, 0, 0, 1.02));
      g.add(meshOf(p)); p.length = 0;
      // the cannon turns to aim
      const gun = new THREE.Group(); gun.position.y = 2.6; g.add(gun); ud.gun = gun;
      gun.add(meshOf([box(0.5, 0.2, 0.6, 0x6b4223, 0, 0, 0), P(new THREE.TorusGeometry(0.16, 0.05, 6, 14), 0x4a3020, -0.27, 0.12, 0, 0, Math.PI / 2, 0), P(new THREE.TorusGeometry(0.16, 0.05, 6, 14), 0x4a3020, 0.27, 0.12, 0, 0, Math.PI / 2, 0),
        cylC(0.13, 0.17, 0.95, 14, 0x3a3a42, 0, 0.32, 0.25, Math.PI / 2 - 0.15), P(new THREE.TorusGeometry(0.15, 0.03, 6, 14), C.gold, 0, 0.38, 0.66, -0.15), sph(0.16, 0x3a3a42, 0, 0.27, -0.2)]));
      break;
    }
    case 'tower': {
      p.push(box(1.5, 3.0, 1.5, C.sand, 0, 0, 0));
      for (let y = 0.45; y < 3; y += 0.45) p.push(box(1.52, 0.03, 1.52, C.sandD, 0, y, 0));
      for (const [x, z, ry] of [[0, 0.76, 0], [0.76, 0, Math.PI / 2], [0, -0.76, 0], [-0.76, 0, Math.PI / 2]]) p.push(box(0.12, 0.45, 0.04, C.dark, x, 1.9, z, ry));
      p.push(box(0.4, 0.7, 0.05, C.dark, 0, 0, 0.76));
      p.push(box(1.85, 0.16, 1.85, C.sandD, 0, 3.0, 0));
      for (const sx of [-0.68, 0.68]) for (const sz of [-0.68, 0.68]) p.push(cyl(0.06, 0.06, 0.85, 6, 0xe8c08a, sx, 3.16, sz));
      p.push(box(1.7, 0.1, 1.7, C.sandD, 0, 4.0, 0));
      p.push(P(new THREE.SphereGeometry(0.78, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xf0cf9a, 0, 4.08, 0));
      p.push(cone(0.08, 0.35, 5, C.gold, 0, 4.8, 0));
      ud.lights.push({ x: 0, y: 3.6, z: 0, r: 4, c: 0xffb060 });
      break;
    }
    case 'temple': {
      p.push(box(2.95, 0.2, 2.95, 0xc9b79a, 0, 0, 0));
      p.push(box(2.6, 0.2, 2.6, 0xddd0b5, 0, 0.2, 0));
      p.push(box(1.7, 1.35, 1.7, 0xe3cfa8, 0, 0.4, -0.3));
      p.push(box(1.74, 0.08, 1.74, 0xc9b07a, 0, 1.6, -0.3));
      p.push(box(0.5, 0.8, 0.06, C.dark, 0, 0.4, 0.56));
      const pts = [[0.95, 0], [0.92, 0.55], [0.82, 1.1], [0.66, 1.6], [0.46, 2.05], [0.26, 2.38], [0.0, 2.52]].map(([x, y]) => new THREE.Vector2(x, y));
      p.push(P(new THREE.LatheGeometry(pts, 4), 0xe8d4ae, 0, 1.68, -0.3, 0, Math.PI / 4));
      p.push(P(new THREE.LatheGeometry(pts.map((v) => new THREE.Vector2(v.x * 0.55, v.y * 0.55)), 4), 0xd4bc92, 0.62, 1.68, -0.3 + 0.0, 0, Math.PI / 4));
      p.push(P(new THREE.LatheGeometry(pts.map((v) => new THREE.Vector2(v.x * 0.55, v.y * 0.55)), 4), 0xd4bc92, -0.62, 1.68, -0.3, 0, Math.PI / 4));
      p.push(cyl(0.3, 0.3, 0.14, 12, 0xc9b07a, 0, 4.12, -0.3));
      p.push(sph(0.13, C.gold, 0, 4.38, -0.3));
      p.push(cone(0.07, 0.25, 6, C.gold, 0, 4.45, -0.3));
      p.push(cyl(0.02, 0.02, 1.1, 4, C.wood, 0, 4.4, -0.3));
      // mandapa porch
      for (const sx of [-0.55, 0.55]) p.push(cyl(0.06, 0.07, 0.9, 6, 0xe3cfa8, sx, 0.4, 1.05));
      p.push(box(1.4, 0.1, 0.9, 0xc9b07a, 0, 1.3, 0.8));
      p.push(cone(0.85, 0.6, 4, 0xd4bc92, 0, 1.4, 0.8, 0, Math.PI / 4));
      p.push(sph(0.08, C.gold, 0.3, 1.15, 1.05));
      const f = flag(C.saffron, 0.55, 0.38); f.position.set(0, 5.5, -0.3); g.add(f); ud.flags.push(f);
      const diya = glowMesh(new THREE.ConeGeometry(0.05, 0.14, 4), 0xffe066); diya.position.set(0, 0.55, 0.45); g.add(diya); ud.flames.push(diya);
      ud.lights.push({ x: 0, y: 0.8, z: 1.0, r: 5, c: 0xffc070, always: true });
      break;
    }
    case 'vaidyashala': { // healer's hut: square mud room, pyramid thatch, herb beds, drying rack, mortar and pestle
      p.push(box(1.9, 0.1, 1.9, C.mudD, 0, 0, 0));
      p.push(box(1.35, 0.95, 1.25, C.mud, -0.1, 0.1, -0.25));
      p.push(box(1.37, 0.07, 1.27, C.white, -0.1, 0.3, -0.25));
      p.push(box(0.34, 0.62, 0.06, 0x2e7d32, -0.1, 0.1, 0.38)); // green door curtain
      p.push(box(0.42, 0.06, 0.08, C.wood, -0.1, 0.72, 0.4));
      p.push(box(0.26, 0.2, 0.05, C.dark, 0.38, 0.5, 0.38)); p.push(box(0.3, 0.04, 0.07, C.wood, 0.38, 0.48, 0.39)); // window
      p.push(cone(1.15, 0.9, 4, C.thatch, -0.1, 1.05, -0.25, 0, Math.PI / 4));
      p.push(cone(1.2, 0.12, 4, C.thatchD, -0.1, 1.0, -0.25, 0, Math.PI / 4));
      p.push(sph(0.1, C.thatchD, -0.1, 1.95, -0.25));
      for (const [bx, bz] of [[-0.55, 0.7], [0.15, 0.7]]) { // herb beds
        p.push(box(0.55, 0.1, 0.32, 0x7a5233, bx, 0, bz)); p.push(box(0.5, 0.04, 0.27, C.soil, bx, 0.1, bz));
        for (let k = 0; k < 4; k++) p.push(sph(0.07, k % 2 ? 0x4f9a3c : 0x6aae4a, bx - 0.18 + k * 0.12, 0.16, bz + (k % 2 ? 0.05 : -0.05), 1, 1.2, 1));
      }
      for (const sx of [0.62, 0.92]) p.push(cyl(0.025, 0.03, 0.95, 6, C.wood, sx, 0.1, -0.6)); // drying rack
      p.push(cylC(0.02, 0.02, 0.36, 6, C.wood, 0.77, 0.95, -0.6, 0, 0, Math.PI / 2));
      for (let k = 0; k < 3; k++) p.push(sph(0.06, 0x5c8a3a, 0.67 + k * 0.1, 0.85, -0.6, 1, 1.6, 1));
      p.push(cyl(0.11, 0.09, 0.14, 12, C.stone, 0.72, 0.1, 0.25)); p.push(cylC(0.02, 0.02, 0.3, 6, C.woodL, 0.75, 0.32, 0.25, 0, 0, 0.4)); // mortar and pestle
      p.push(sph(0.13, C.brick, -0.82, 0.22, 0.28)); p.push(cyl(0.06, 0.08, 0.06, 10, C.brickD, -0.82, 0.32, 0.28));
      p.push(cyl(0.025, 0.03, 2.3, 6, C.bamboo, 0.85, 0.1, 0.85));
      const f = flag(0x2e7d32, 0.42, 0.28); f.position.set(0.85, 2.4, 0.85); g.add(f); ud.flags.push(f);
      ud.lights.push({ x: -0.1, y: 0.5, z: 0.6, r: 3.2, c: 0xffd890 });
      break;
    }
  }
  addLevelDecor(p, g, ud, type, level);
  if (p.length) g.add(meshOf(p));
  // static building parts get the painted, textured surface
  if (MAT.bld && MAT.bld !== MAT.std) g.traverse((c) => { if (c.isMesh && c.material === MAT.std) c.material = MAT.bld; });
  return g;
};
/**
 * What an upgrade looks like, for any building. Level 2: a stone kerb with painted white dots, a marigold
 * toran on posts at the entrance and two clay diyas. Level 3: a brick kerb with a front step, a saffron
 * flag, tulsi pots and a golden kalash on the roof.
 */
function addLevelDecor(p, g, ud, type, level) {
  const d = BUILDINGS[type];
  if (!d || d.wall || level < 2) return;
  const hw = d.fw / 2, hd = d.fd / 2, field = isFieldType(type), kh = 0.1, small = d.fw < 2 || d.fd < 2;
  const kc = level >= 3 ? 0xb5532f : 0xb8b2a6;
  p.push(box(d.fw - 0.02, kh, 0.1, kc, 0, 0, hd - 0.06)); p.push(box(d.fw - 0.02, kh, 0.1, kc, 0, 0, -hd + 0.06));
  p.push(box(0.1, kh, d.fd - 0.02, kc, hw - 0.06, 0, 0)); p.push(box(0.1, kh, d.fd - 0.02, kc, -hw + 0.06, 0, 0));
  const nd = Math.max(3, Math.round(d.fw * 4));
  for (let i = 0; i < nd; i++) p.push(sph(0.024, 0xf4ecd8, -hw + 0.14 + (i * (d.fw - 0.28)) / (nd - 1), kh + 0.005, hd - 0.06, 1, 0.45, 1));
  if (!field && !small) {
    // a welcome toran of marigolds and mango leaves strung between two posts at the front
    const px = hw - 0.12, top = Math.min(d.ht * 0.6, 1.4);
    for (const sx of [-1, 1]) p.push(cyl(0.025, 0.03, top + 0.06, 6, C.woodL, sx * px, 0, hd - 0.04));
    const n = Math.max(6, Math.round(d.fw * 6));
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = -px + f * px * 2, y = top - Math.sin(f * Math.PI) * 0.16;
      p.push(sph(0.042, i % 2 ? C.saffron : C.marigold, x, y, hd - 0.04));
      if (i % 2 === 0 && i > 0 && i < n) p.push(coneC(0.028, 0.12, 4, 0x3f8a3a, x, y - 0.1, hd - 0.04, Math.PI));
    }
    for (const sx of [-1, 1]) { // clay diyas
      p.push(cyl(0.05, 0.035, 0.04, 8, C.brick, sx * (hw - 0.3), kh, hd - 0.06));
      const fl = glowMesh(new THREE.ConeGeometry(0.03, 0.09, 4), 0xffcc33); fl.position.set(sx * (hw - 0.3), kh + 0.08, hd - 0.06); g.add(fl); ud.flames.push(fl);
    }
  }
  if (level >= 3) {
    p.push(box(Math.min(1.0, d.fw * 0.5), 0.06, 0.24, kc, 0, 0, hd + 0.1)); // front step
    const ph = d.ht + 0.8;
    p.push(cyl(0.024, 0.03, ph, 6, C.bamboo, -hw + 0.12, 0, -hd + 0.12));
    const f = flag(C.saffron, 0.42, 0.28); f.position.set(-hw + 0.12, ph, -hd + 0.12); g.add(f); ud.flags.push(f);
    if (!small) for (const sx of [-1, 1]) { // tulsi pots
      const x = sx * (hw - 0.2), z = field ? hd - 0.2 : hd - 0.32;
      p.push(box(0.2, 0.22, 0.2, 0xd8c8b0, x, 0, z)); p.push(box(0.23, 0.04, 0.23, C.red, x, 0.22, z)); p.push(sph(0.1, 0x3f8a3a, x, 0.35, z, 1, 1.3, 1));
    }
    if (['hut', 'bighouse', 'store', 'vaidyashala', 'bazaar'].includes(d.model || type)) { // golden kalash on the roof
      p.push(sph(0.085, C.gold, 0, d.ht - 0.02, 0)); p.push(cone(0.035, 0.14, 6, C.gold, 0, d.ht + 0.04, 0));
    }
  }
}

/* ---------- construction site (foundation, scaffolding, materials) ---------- */
Models.site = function (type) {
  const def = BUILDINGS[type];
  const g = new THREE.Group();
  const hw = def.fw / 2, hd = def.fd / 2;
  const f = [box(def.fw + 0.3, 0.04, def.fd + 0.3, 0x9b7653, 0, 0, 0), box(def.fw + 0.1, 0.045, def.fd + 0.1, 0xb08a62, 0, 0, 0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.push(cyl(0.035, 0.03, 0.4, 6, 0xc8a46a, sx * (hw + 0.08), 0, sz * (hd + 0.08)));
  for (const sz of [-1, 1]) f.push(box(def.fw + 0.16, 0.02, 0.02, 0xf1e6cc, 0, 0.3, sz * (hd + 0.08)));
  for (const sx of [-1, 1]) f.push(box(0.02, 0.02, def.fd + 0.16, 0xf1e6cc, sx * (hw + 0.08), 0.3, 0));
  g.add(meshOf(f, null, true, true));
  const piles = [];
  if (!def.wall) {
    const px = hw + 0.45, pz = hd - 0.3;
    for (let r = 0; r < 2; r++) for (let k = 0; k < 3 - r; k++) piles.push(cylC(0.07, 0.07, 0.6, 10, k % 2 ? 0x9a6a3a : 0x8a5a2e, px, 0.07 + r * 0.13, pz - 0.15 + k * 0.15 + r * 0.075, Math.PI / 2));
    piles.push(sph(0.13, 0xa8a49c, px, 0.1, pz - 0.6, 1, 0.75, 1)); piles.push(sph(0.1, 0xb3ada2, px + 0.15, 0.08, pz - 0.82));
  }
  const pm = piles.length ? meshOf(piles) : null;
  if (pm) g.add(pm);
  // scaffolding (scaled up as the work grows)
  let sc = null;
  if (!def.wall) {
    const h = def.ht + 0.25, sp = [];
    const ox = hw + 0.12, oz = hd + 0.12;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) sp.push(cyl(0.035, 0.035, h, 6, 0xc8b27a, sx * ox, 0, sz * oz));
    for (let y = 0.55; y < h; y += 0.6) {
      sp.push(box(ox * 2, 0.035, 0.035, 0xa8925a, 0, y, oz)); sp.push(box(ox * 2, 0.035, 0.035, 0xa8925a, 0, y, -oz));
      sp.push(box(0.035, 0.035, oz * 2, 0xa8925a, ox, y, 0)); sp.push(box(0.035, 0.035, oz * 2, 0xa8925a, -ox, y, 0));
      sp.push(box(ox * 2 + 0.1, 0.03, 0.22, 0xb8854a, 0, y + 0.03, oz + 0.1));
    }
    sp.push(boxC(0.03, Math.hypot(ox * 2, 0.6), 0.03, 0xa8925a, 0, 0.3 + 0.05, oz, 0, 0, Math.atan2(ox * 2, 0.6)));
    sc = meshOf(sp, null, false, true);
    g.add(sc);
  }
  // the beam frame that marks how high the walls have risen
  const lv = [box(def.fw + 0.04, 0.06, 0.06, 0x8a5a2e, 0, 0, hd), box(def.fw + 0.04, 0.06, 0.06, 0x8a5a2e, 0, 0, -hd), box(0.06, 0.06, def.fd, 0x8a5a2e, hw, 0, 0), box(0.06, 0.06, def.fd, 0x8a5a2e, -hw, 0, 0)];
  const level = meshOf(lv, null, true, true);
  g.add(level);
  g.userData = { scaffold: sc, piles: pm, level };
  return g;
};

/* ---------- demon loot ---------- */
Models.loot = function (kind) {
  const g = new THREE.Group();
  const p = [];
  let glow = 0xffe066;
  if (kind === 'gold') { for (let i = 0; i < 5; i++) p.push(cyl(0.1, 0.1, 0.03, 16, i % 2 ? 0xf2c230 : 0xffd84a, (i % 3 - 1) * 0.12, i * 0.03, (i % 2) * 0.08)); p.push(cylC(0.1, 0.1, 0.03, 16, 0xffd84a, 0.05, 0.25, -0.05, Math.PI / 2)); }
  else if (kind === 'wood') { for (let k = 0; k < 3; k++) p.push(cylC(0.07, 0.07, 0.55, 10, k % 2 ? 0x9a6a3a : 0x8a5a2e, 0, 0.08 + (k === 2 ? 0.12 : 0), -0.07 + (k % 2) * 0.14 - (k === 2 ? 0.07 : 0), 0, 0, Math.PI / 2)); p.push(P(new THREE.TorusGeometry(0.15, 0.02, 6, 14), 0xd8c28a, 0, 0.12, 0, 0, Math.PI / 2, 0)); glow = 0xffd0a0; }
  else if (kind === 'stone') { p.push(sph(0.16, 0xa8a49c, 0, 0.12, 0, 1, 0.75, 1)); p.push(sph(0.11, 0xc4beb2, 0.16, 0.09, 0.1)); glow = 0xe0e0ff; }
  else if (kind === 'food') { p.push(sph(0.18, 0xd6b47a, 0, 0.16, 0, 1, 1.1, 0.9)); p.push(sph(0.06, 0x9c7b45, 0, 0.36, 0)); p.push(cone(0.03, 0.1, 6, 0xf2d16b, 0.04, 0.38, 0)); glow = 0xfff0a0; }
  else if (kind === 'chest') {
    p.push(box(0.6, 0.32, 0.4, 0x8a5a2e, 0, 0, 0)); p.push(P(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 14, 1, false, 0, Math.PI), 0x9a6a3a, 0, 0.32, 0, 0, 0, Math.PI / 2));
    for (const sx of [-0.22, 0.22]) p.push(box(0.05, 0.34, 0.42, 0xf2c230, sx, 0, 0));
    p.push(box(0.1, 0.12, 0.04, 0xf2c230, 0, 0.22, 0.21));
    glow = 0xffd84a;
  }
  if (p.length) g.add(meshOf(p));
  if (kind === 'gem') {
    const gem = glowMesh(new THREE.OctahedronGeometry(0.16, 0), 0x6ff6ff);
    gem.position.y = 0.25; gem.scale.set(1, 1.4, 1);
    g.add(gem);
    glow = 0x6ff6ff;
  }
  const halo = glowMesh(new THREE.CircleGeometry(kind === 'chest' ? 0.6 : 0.35, 20), glow, 0.35);
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03;
  g.add(halo);
  g.userData = { halo, glow };
  return g;
};

/* ---------- the Agnikund (sacred fire) ---------- */
Models.agnikund = function (level) {
  const g = new THREE.Group();
  const p = [];
  const s = 1 + (level - 1) * 0.08;
  p.push(box(2.0 * s, 0.3, 2.0 * s, C.brickD, 0, 0, 0));
  p.push(box(1.6 * s, 0.28, 1.6 * s, C.brick, 0, 0.3, 0));
  p.push(box(1.2 * s, 0.25, 1.2 * s, C.brickD, 0, 0.58, 0));
  for (let i = -2; i <= 2; i++) for (const [sx, sz, ry] of [[1, 0, 0], [-1, 0, 0], [0, 1, Math.PI / 2], [0, -1, Math.PI / 2]]) {
    const x = sx ? sx * 0.81 * s : i * 0.28 * s, z = sz ? sz * 0.81 * s : i * 0.28 * s;
    p.push(box(0.16, 0.04, 0.02, C.white, x, 0.45, z, ry + Math.PI / 2));
  }
  const n = 16;
  for (let i = 0; i < n; i++) { // marigold garland around the top tier
    const t = i / n, side = Math.floor(t * 4), f = (t * 4) % 1, hw = 0.62 * s;
    const pos = [[-hw + f * 2 * hw, hw], [hw, hw - f * 2 * hw], [hw - f * 2 * hw, -hw], [-hw, -hw + f * 2 * hw]][side];
    p.push(box(0.09, 0.09, 0.09, i % 2 ? C.saffron : C.marigold, pos[0], 0.76, pos[1]));
  }
  p.push(cylC(0.07, 0.07, 0.9, 5, 0x5a3820, 0, 0.9, 0, 0, 0.7, Math.PI / 2));
  p.push(cylC(0.07, 0.07, 0.9, 5, 0x4a2e1a, 0, 0.9, 0, 0, -0.7, Math.PI / 2));
  if (level >= 2) for (const sx of [-1, 1]) p.push(cyl(0.04, 0.05, 2.6 + level * 0.2, 5, C.bamboo, sx * 1.45 * s, 0, -1.2 * s));
  if (level >= 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { p.push(cyl(0.08, 0.12, 0.4, 6, C.gold, sx * 1.15 * s, 0, sz * 1.15 * s)); p.push(cyl(0.12, 0.05, 0.08, 6, C.gold, sx * 1.15 * s, 0.4, sz * 1.15 * s)); }
  if (level >= 4) {
    for (const sx of [-1, 1]) p.push(cyl(0.08, 0.1, 2.6, 6, 0xc9b79a, sx * 1.6 * s, 0, 1.3 * s));
    for (let i = 0; i <= 14; i++) {
      const f = i / 14, x = (-1.6 + f * 3.2) * s, y = 2.5 - Math.sin(f * Math.PI) * 0.45;
      p.push(box(0.1, 0.1, 0.1, i % 2 ? C.saffron : C.marigold, x, y, 1.3 * s));
      if (i % 2 === 0) p.push(box(0.05, 0.16, 0.03, C.green, x, y - 0.16, 1.3 * s));
    }
  }
  if (level >= 5) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { p.push(sph(0.1, C.gold, sx * 0.9 * s, 0.4, sz * 0.9 * s)); p.push(cone(0.04, 0.12, 5, C.gold, sx * 0.9 * s, 0.48, sz * 0.9 * s)); }
  g.add(meshOf(p));
  g.userData.flags = [];
  if (level >= 2) for (const sx of [-1, 1]) { const f = flag(C.saffron, 0.7, 0.45); f.position.set(sx * 1.45 * s, 2.6 + level * 0.2, -1.2 * s); g.add(f); g.userData.flags.push(f); }
  g.userData.lampFlames = [];
  if (level >= 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const fl = glowMesh(new THREE.ConeGeometry(0.06, 0.16, 4), 0xffcc33); fl.position.set(sx * 1.15 * s, 0.56, sz * 1.15 * s); g.add(fl); g.userData.lampFlames.push(fl); }
  const flame = flameCluster(1 + (level - 1) * 0.18);
  flame.position.y = 0.84;
  g.add(flame);
  g.userData.flame = flame;
  return g;
};
Models.diya = function () {
  const g = new THREE.Group();
  g.add(meshOf([cyl(0.09, 0.06, 0.06, 6, C.brick, 0, 0, 0)], null, true));
  const f = glowMesh(new THREE.ConeGeometry(0.03, 0.09, 4), 0xffcc33);
  f.position.y = 0.11;
  g.add(f);
  g.userData.flame = f;
  return g;
};
Models.boundary = function () {
  const g = new THREE.Group();
  g.add(meshOf([box(0.22, 0.4, 0.22, C.stone, 0, 0, 0), box(0.24, 0.06, 0.24, 0xbdb8ae, 0, 0.4, 0), box(0.1, 0.1, 0.24, C.red, 0, 0.2, 0), cyl(0.02, 0.02, 1.0, 4, C.wood, 0, 0.46, 0)]));
  const f = flag(C.saffron, 0.4, 0.26); f.position.set(0, 1.45, 0); g.add(f);
  g.userData.flags = [f];
  return g;
};

/** Little village shrine marking the Pavitra Van: a sindoor stone, marigolds, a bell and flags. */
Models.shrine = function () {
  const g = new THREE.Group();
  const p = [box(1.0, 0.18, 0.8, C.stone, 0, 0, 0), box(0.8, 0.12, 0.6, 0xbdb8ae, 0, 0.18, 0),
    sph(0.2, 0xe2541a, 0, 0.42, 0, 1, 1.25, 1), sph(0.07, C.marigold, -0.25, 0.36, 0.18), sph(0.07, C.saffron, 0.25, 0.36, 0.18), sph(0.06, C.marigold, 0.05, 0.34, 0.24),
    cyl(0.03, 0.03, 1.2, 5, C.wood, 0.42, 0.3, -0.2), box(0.5, 0.04, 0.04, C.wood, 0.42, 1.45, -0.2), sph(0.07, C.gold, 0.42, 1.38, -0.2),
    cyl(0.025, 0.025, 1.9, 4, C.bamboo, -0.42, 0.18, -0.25), cyl(0.025, 0.025, 1.6, 4, C.bamboo, 0.1, 0.18, -0.3)];
  g.add(meshOf(p));
  g.userData.flags = [];
  for (const [x, y, z] of [[-0.42, 2.05, -0.25], [0.1, 1.75, -0.3]]) { const f = flag(C.saffron, 0.5, 0.32); f.position.set(x, y, z); g.add(f); g.userData.flags.push(f); }
  return g;
};

/* ---------- trees & rocks (merged geometry for instancing) ---------- */
// low-ish poly spheres for foliage keep a forest of 1000+ trees fast
/** Painted foliage: sunlit tops turn warm and light, undersides cool and deep, so a canopy reads as a soft rounded mass instead of a flat green ball. */
const _fW = new THREE.Color(0xe6cf78), _fC = new THREE.Color(0x1f4542);
function shadeFoliage(g, kw, kc) {
  const nor = g.attributes.normal.array, col = g.attributes.color.array;
  kw = kw == null ? 0.16 : kw; kc = kc == null ? 0.48 : kc;
  for (let i = 0; i < col.length; i += 3) {
    const ny = nor[i + 1], T = ny > 0 ? _fW : _fC, t = ny > 0 ? ny * kw : -ny * kc;
    col[i] += (T.r - col[i]) * t; col[i + 1] += (T.g - col[i + 1]) * t; col[i + 2] += (T.b - col[i + 2]) * t;
  }
  return g;
}
// leaf blobs: 7×5 near the camera, 6×4 for the distant-forest version (same shapes, about half the triangles)
let LEAF_SEG = [7, 5];
const leaf = (r, c, x, y, z, sx, sy, sz) => shadeFoliage(P(new THREE.SphereGeometry(r, LEAF_SEG[0], LEAF_SEG[1]), c, x, y, z, 0, 0, 0, sx, sy, sz));
/** A tree. lod = true builds the light version for far away: fewer segments, no fruit or hanging roots. */
Models.treeGeo = function (type, variant, lod) {
  LEAF_SEG = lod ? [6, 4] : [7, 5];
  try { return buildTreeGeo(type, variant, !!lod); } finally { LEAF_SEG = [7, 5]; }
};
function buildTreeGeo(type, variant, lod) {
  const rnd = mulberry32(variant * 7919 + type.length * 131);
  // analogous variety: each tree drifts a few degrees of hue and a little lightness from its species colour
  const vr = mulberry32(variant * 31 + type.length * 7 + 5), dh = (vr() - 0.5) * 16, dl = (vr() - 0.5) * 0.07;
  const V = (hex) => varyHex(hex, dh, dl);
  const p = [];
  const trunk = (r1, r2, h, c, x, y, z, rx, rz) => p.push(P(new THREE.CylinderGeometry(r2, r1, h, lod ? 5 : 8), c, x, y + h / 2, z, rx, 0, rz));
  if (type === 'palm') {
    const lean = (rnd() - 0.5) * 0.5, segsN = 4, H = 2.5 + rnd() * 0.7;
    let x = 0, y = 0;
    for (let i = 0; i < segsN; i++) {
      const a = (lean * (i + 1)) / segsN, h = H / segsN;
      p.push(P(new THREE.CylinderGeometry(0.1 - i * 0.012, 0.13 - i * 0.012, h, lod ? 5 : 8), i % 2 ? 0x9a7650 : 0x86643f, x + (Math.sin(a) * h) / 2, y + h / 2, 0, 0, 0, -a));
      x += Math.sin(a) * h; y += Math.cos(a) * h * 0.98;
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
      p.push(shadeFoliage(P(new THREE.SphereGeometry(0.5, lod ? 6 : 8, lod ? 3 : 5), V(i % 2 ? 0x5c9744 : 0x6aa34a), x + Math.sin(a) * 0.55, y - 0.12, Math.cos(a) * 0.55, 0.5, a, 0, 0.3, 0.07, 1.25), 0.14, 0.5));
    }
    p.push(leaf(0.2, V(0x5c9744), x, y + 0.02, 0, 1, 0.6, 1));
    if (!lod) for (let i = 0; i < 3; i++) p.push(leaf(0.1, 0x7a5426, x + Math.cos(i * 2.1) * 0.13, y - 0.14, Math.sin(i * 2.1) * 0.13)); // coconuts
  } else if (type === 'banyan') {
    trunk(0.34, 0.26, 1.5, 0x7a5638, 0, 0, 0);
    p.push(P(new THREE.CylinderGeometry(0.1, 0.15, 1.2, lod ? 5 : 8), 0x7a5638, 0.45, 1.6, 0.1, 0, 0, -0.9));
    p.push(P(new THREE.CylinderGeometry(0.1, 0.15, 1.2, lod ? 5 : 8), 0x7a5638, -0.45, 1.6, -0.1, 0, 0, 0.9));
    const blobs = [];
    for (let i = 0; i < 6; i++) blobs.push([(rnd() - 0.5) * 2.4, 2.05 + rnd() * 0.5, (rnd() - 0.5) * 2.0, 0.85 + rnd() * 0.4]);
    for (const b of blobs) p.push(leaf(b[3], V(rnd() > 0.5 ? 0x3a8a4c : 0x449654), b[0], b[1], b[2], 1, 0.82, 1));
    p.push(leaf(0.9, V(0x52a35c), 0, 2.75, 0, 1.2, 0.7, 1.1));
    if (!lod) for (let i = 0; i < 6; i++) { const rx = (rnd() - 0.5) * 2.4, rz = (rnd() - 0.5) * 1.8; p.push(P(new THREE.CylinderGeometry(0.03, 0.035, 1.75, 5), 0x9a7856, rx, 0.87, rz)); } // hanging roots
  } else if (type === 'mango') {
    trunk(0.17, 0.12, 1.1, 0x7a5638, 0, 0, 0);
    p.push(leaf(0.78, V(0x3c8a3e), 0, 1.6, 0, 1.15, 0.9, 1.1));
    p.push(leaf(0.55, V(0x4a9c48), (rnd() - 0.5) * 0.5, 2.1, (rnd() - 0.5) * 0.4));
    p.push(leaf(0.5, V(0x3c8a3e), 0.5, 1.5, 0.3)); p.push(leaf(0.48, V(0x449340), -0.45, 1.55, -0.25));
    for (let i = 0; i < 7; i++) { const a = rnd() * Math.PI * 2, y = 1.3 + rnd() * 0.7; p.push(P(new THREE.SphereGeometry(0.08, lod ? 4 : 6, lod ? 3 : 5), 0xffb21f, Math.cos(a) * 0.82, y, Math.sin(a) * 0.82, 0, 0, 0, 1, 1.2, 1)); }
  } else { // neem
    trunk(0.12, 0.08, 1.4, 0x7d5e40, 0, 0, 0, 0, (rnd() - 0.5) * 0.2);
    for (let i = 0; i < 5; i++) p.push(leaf(0.42 + rnd() * 0.18, V(rnd() > 0.5 ? 0x74b04c : 0x62a344), (rnd() - 0.5) * 1.0, 1.55 + rnd() * 0.6, (rnd() - 0.5) * 1.0));
  }
  return merge(p);
};
Models.stumpGeo = function (type) {
  const r = type === 'banyan' ? 0.3 : type === 'palm' ? 0.12 : 0.16;
  return merge([cyl(r, r * 1.15, 0.25, 12, 0x7a5638, 0, 0, 0), cyl(r * 0.98, r * 0.98, 0.02, 12, 0xe8c896, 0, 0.25, 0)]);
};
Models.rockGeo = function (variant) {
  const rnd = mulberry32(variant * 977 + 3);
  const p = [];
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0.5 : 0.28 + rnd() * 0.12;
    const geo = new THREE.SphereGeometry(r, 10, 7);
    const pos = geo.attributes.position;
    const sx = 0.85 + rnd() * 0.3, sy = 0.55 + rnd() * 0.2, sz = 0.85 + rnd() * 0.3;
    for (let k = 0; k < pos.count; k++) {
      const w = 1 + Math.sin(pos.getX(k) * 9 + variant) * 0.06 + Math.cos(pos.getZ(k) * 7 + i) * 0.06;
      pos.setXYZ(k, pos.getX(k) * sx * w, pos.getY(k) * sy * w, pos.getZ(k) * sz * w);
    }
    geo.computeVertexNormals();
    const cx = i === 0 ? 0 : (rnd() - 0.5) * 0.9, cz = i === 0 ? 0 : (rnd() - 0.5) * 0.9;
    p.push(P(geo, rnd() > 0.5 ? 0xa8a49c : 0xb3ada2, cx, r * 0.35, cz));
    if (rnd() > 0.4) p.push(P(new THREE.SphereGeometry(r * 0.45, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x7fb24e, cx, r * 0.35 + r * sy * 0.78, cz, 0, 0, 0, sx * 0.9, 0.35, sz * 0.9));
  }
  return merge(p);
};

/* ---------- tokri (woven back basket) and stockpile heaps ----------
   Shared, cached geometries: a mesh swaps between them as its fill level changes. */
const _geoCache = {};
function cachedGeo(key, make) {
  if (!_geoCache[key]) { const g = make(); g.userData.shared = true; _geoCache[key] = g; }
  return _geoCache[key];
}
const BARK = [0x8a5a2e, 0x9a6a3a, 0x7e5230], CUT = 0xecd09a;
const STONES = [0xa8a49c, 0x96918a, 0xb8b2a6, 0x8d8981];
/** A log lying along x (turned by ry) with pale, freshly cut ends. */
function logPart(p, r, len, x, y, z, ry, c) {
  p.push(cylC(r, r, len, 10, c, x, y, z, 0, ry, Math.PI / 2));
  const ox = (Math.cos(ry) * len) / 2, oz = (-Math.sin(ry) * len) / 2;
  for (const k of [-1, 1]) p.push(cylC(r * 0.8, r * 0.8, 0.016, 10, CUT, x + k * ox, y, z + k * oz, 0, ry, Math.PI / 2));
}
function strapPart(p, a, b, c) {
  const dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(b[0] - a[0], dy, dz);
  p.push(boxC(0.036, 0.016, len, c, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, -Math.atan2(dy, dz), 0, 0));
}
function wheatPart(p, x, y, z, rx, rz, h) {
  p.push(cylC(0.008, 0.008, h, 5, 0xc9a040, x, y, z, rx, 0, rz));
  const tx = x - (h / 2) * Math.sin(rz), ty = y + (h / 2) * Math.cos(rz) * Math.cos(rx), tz = z + (h / 2) * Math.cos(rz) * Math.sin(rx);
  p.push(sphR(0.022, 0xf0c95a, tx, ty, tz, rx, 0, rz, 1, 2.4, 1, 8, 6));
}
/**
 * The tokri worn on the back. key = 'empty' or resource + fill step (1–3), e.g. 'wood2'.
 * Local origin sits at the base of the basket, the rim is at y 0.30, the wearer is toward +z.
 */
Models.packGeo = function (key) {
  return cachedGeo('pack_' + key, () => {
    const p = [];
    const bh = 0.075;
    for (let i = 0; i < 4; i++) { // woven bamboo bands, a touch wider toward the top
      const r0 = 0.092 + i * 0.013;
      p.push(P(new THREE.CylinderGeometry(r0 + 0.013, r0, bh, 16), i % 2 ? 0xb3843c : 0xd6a957, 0, i * bh + bh / 2, 0, 0, 0, 0, 1, 1, 0.8));
    }
    p.push(P(new THREE.TorusGeometry(0.146, 0.017, 6, 18), 0x7d5226, 0, 0.3, 0, Math.PI / 2, 0, 0, 1, 0.8, 1));
    p.push(P(new THREE.TorusGeometry(0.094, 0.012, 6, 16), 0x7d5226, 0, 0.012, 0, Math.PI / 2, 0, 0, 1, 0.8, 1));
    p.push(P(new THREE.CylinderGeometry(0.132, 0.132, 0.01, 16), 0x4a2e16, 0, 0.3, 0, 0, 0, 0, 1, 1, 0.8));
    for (const sx of [-1, 1]) { // jute straps over each shoulder
      strapPart(p, [sx * 0.095, 0.3, 0.11], [sx * 0.1, 0.325, 0.27], 0x8a4a22);
      strapPart(p, [sx * 0.1, 0.325, 0.27], [sx * 0.1, 0.17, 0.405], 0x8a4a22);
    }
    const res = key.replace(/\d+$/, ''), lv = +key.slice(-1) || 0;
    if (res === 'wood') {
      const logs = [[0, 0.335, 0], [0, 0.335, -0.047], [0, 0.335, 0.047], [0, 0.415, 0]];
      const use = lv === 1 ? [logs[0]] : lv === 2 ? [logs[1], logs[2]] : [logs[1], logs[2], logs[3]];
      use.forEach(([x, y, z], i) => logPart(p, 0.045, 0.38 - i * 0.02, x, y, z, (i - 1) * 0.07, BARK[i % 3]));
      if (lv >= 2) p.push(P(new THREE.TorusGeometry(0.075, 0.01, 5, 12), 0xc8453c, 0.08, 0.36, 0, 0, Math.PI / 2, 0, 1, lv === 3 ? 1.25 : 0.8, 1)); // a red rope tie
    } else if (res === 'stone') {
      const spots = [[-0.055, 0.315, 0.02, 0.07], [0.06, 0.315, -0.015, 0.066], [0.0, 0.32, 0.05, 0.06], [0.01, 0.33, -0.06, 0.062], [-0.065, 0.36, -0.03, 0.058], [0.05, 0.37, 0.03, 0.06], [0, 0.42, 0, 0.065]];
      spots.slice(0, [0, 2, 4, 7][lv]).forEach(([x, y, z, r], i) => p.push(sph(r, STONES[i % 4], x, y, z, 1, 0.78, 1, 7, 5)));
    } else if (res === 'food') {
      p.push(sph(0.13, 0xe6bd52, 0, 0.3, 0, 1, [0, 0.3, 0.5, 0.75][lv], 0.8));
      const st = [[-0.05, 0.02, 0.2, -0.25], [0.05, -0.02, -0.15, 0.25], [0, 0.04, 0.3, 0], [-0.08, -0.04, -0.2, -0.4], [0.08, 0.04, 0.2, 0.4]];
      st.slice(0, lv === 1 ? 0 : lv === 2 ? 3 : 5).forEach(([x, z, rx, rz]) => wheatPart(p, x, 0.38 + lv * 0.02, z, rx, rz, 0.2));
      if (lv === 3) { p.push(sph(0.06, 0xe8792a, 0.065, 0.39, 0.03, 1.15, 0.8, 1.15)); p.push(cyl(0.01, 0.012, 0.03, 5, 0x4a7a2a, 0.065, 0.43, 0.03)); p.push(sph(0.042, 0xffb21f, -0.07, 0.38, -0.03, 1, 1.2, 1)); }
    } else if (res === 'gold') {
      p.push(sph(0.12, 0xf2c230, 0, 0.3, 0, 1, [0, 0.25, 0.45, 0.7][lv], 0.8));
      for (let i = 0; i < lv * 2; i++) { const a = i * 2.3; p.push(cylC(0.032, 0.032, 0.012, 10, 0xffd84a, Math.cos(a) * 0.06, 0.32 + lv * 0.025 + (i % 2) * 0.02, Math.sin(a) * 0.05, 0.5 + i * 0.3, 0, 0.4 - i * 0.2)); }
      if (lv === 3) p.push(sph(0.025, 0xd33b2c, 0.02, 0.4, 0.01));
    }
    return merge(p);
  });
};
/** Little cloth potli tied at the hip for the gold nuggets a miner finds. */
Models.pouchGeo = function () {
  return cachedGeo('pouch', () => merge([
    sph(0.058, 0xc9963a, 0, -0.06, 0, 1, 1.1, 0.9),
    P(new THREE.TorusGeometry(0.03, 0.01, 5, 10), 0xd33b2c, 0, -0.005, 0, Math.PI / 2),
    sph(0.028, 0xc9963a, 0, 0.02, 0, 1, 0.9, 1),
    cylC(0.022, 0.022, 0.01, 8, 0xffd84a, 0.03, 0.025, 0.02, 0.6, 0, 0.3),
  ]));
};
/**
 * A stockpile heap at fill step 1–5. Origin on the ground; about 0.9 wide (x) and 0.8 deep (z).
 * wood: a stacked log pyramid · stone: a heap of boulders · food: jute grain sacks · gold: a treasure chest.
 */
Models.pileGeo = function (res, lv) {
  return cachedGeo('pile_' + res + lv, () => {
    const p = [];
    const rnd = mulberry32(res.length * 7 + 11); // same seed at every step, so a heap only grows
    if (res === 'wood') {
      const order = [[0, 1], [0, 2], [0, 0], [0, 3], [1, 1], [1, 0], [1, 2], [2, 0], [2, 1], [3, 0]];
      const n = [0, 2, 4, 6, 8, 10][lv];
      for (let i = 0; i < n; i++) {
        const [row, k] = order[i], inRow = 4 - row;
        const z = (k - (inRow - 1) / 2) * 0.2, y = 0.1 + row * 0.172;
        logPart(p, 0.1, 0.82 + rnd() * 0.12, (rnd() - 0.5) * 0.08, y, z, (rnd() - 0.5) * 0.1, BARK[i % 3]);
      }
      const sz = lv === 1 ? 0.22 : 0.42, sh = 0.22 + Math.min(lv, 4) * 0.12;
      for (const sx of [-1, 1]) for (const k of [-1, 1]) p.push(cyl(0.028, 0.034, sh, 6, 0x6b4223, sx * 0.3, 0, k * sz)); // stakes keep the stack from rolling
    } else if (res === 'stone') {
      const spots = [];
      spots.push([0, 0.08, 0, 0.15]);
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3; spots.push([Math.cos(a) * 0.33, 0.07, Math.sin(a) * 0.28, 0.12 + rnd() * 0.03]); }
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.9; spots.push([Math.cos(a) * 0.17, 0.2, Math.sin(a) * 0.14, 0.12 + rnd() * 0.02]); }
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.2; spots.push([Math.cos(a) * 0.08, 0.31, Math.sin(a) * 0.07, 0.11]); }
      spots.push([0, 0.42, 0, 0.1]);
      const n = [0, 3, 6, 9, 13, 17][lv];
      for (let i = 0; i < n; i++) { const [x, y, z, r] = spots[i]; p.push(sph(r, STONES[i % 4], x, y, z, 1.05, 0.75, 0.95, 7, 5)); }
    } else if (res === 'food') {
      const spots = [[0, 0, 0.13], [-0.27, 0, 0.13], [0.27, 0, 0.13], [0, 0, -0.15], [-0.27, 0, -0.15], [0.27, 0, -0.15], [-0.13, 0.26, -0.01], [0.13, 0.26, -0.01]];
      const n = [0, 1, 3, 5, 6, 8][lv];
      for (let i = 0; i < n; i++) {
        const [x, y, z] = spots[i], c = [0xc29a62, 0xb08a55, 0xcfa96f][i % 3]; // jute bori
        p.push(sph(0.15, c, x, y + 0.15, z, 1, 1.05, 0.85));
        p.push(cyl(0.035, 0.045, 0.05, 8, 0x7a5530, x, y + 0.29, z));
        p.push(sph(0.045, c, x, y + 0.35, z, 1.2, 0.7, 1.2, 8, 6));
        if (i % 3 === 0) p.push(boxC(0.1, 0.06, 0.01, 0xc8453c, x, y + 0.17, z + 0.128)); // a stamped mark on the sack
      }
      if (lv >= 2) p.push(sph(0.17, 0xe6bd52, 0.05, 0, 0.36, 1, 0.3 + lv * 0.05, 0.65)); // loose grain spilling in front
      if (lv >= 4) { p.push(cyl(0.14, 0.1, 0.1, 12, 0xb3843c, -0.42, 0, 0.38)); p.push(sph(0.12, 0xe6bd52, -0.42, 0.1, 0.38, 1, 0.35, 1)); }
    } else if (res === 'gold') {
      p.push(box(0.5, 0.26, 0.32, 0x7a4b26, 0, 0, -0.12));
      for (const sx of [-0.18, 0.18]) p.push(box(0.04, 0.27, 0.33, 0xd4a234, sx, 0, -0.12));
      p.push(boxC(0.52, 0.04, 0.3, 0x6b4223, 0, 0.36, -0.33, -1.15)); // the open lid
      p.push(boxC(0.06, 0.06, 0.02, 0xd4a234, 0, 0.2, 0.045));
      p.push(sph(0.2, 0xf2c230, 0, 0.26, -0.12, 1.15, [0, 0.12, 0.28, 0.42, 0.55, 0.68][lv], 0.72));
      const stacks = [[0.38, 0.12, 4], [-0.36, 0.16, 6], [0.2, 0.3, 3], [-0.12, 0.34, 5], [0.42, -0.14, 7]];
      stacks.slice(0, [0, 0, 1, 2, 3, 5][lv]).forEach(([x, z, k]) => { for (let i = 0; i < k; i++) p.push(cyl(0.06, 0.06, 0.022, 12, i % 2 ? 0xffd84a : 0xf2c230, x + (rnd() - 0.5) * 0.015, i * 0.022, z)); });
      if (lv >= 4) { p.push(sph(0.035, 0xd33b2c, 0.06, 0.3 + lv * 0.02, -0.1)); p.push(sph(0.03, 0x2a9d6f, -0.08, 0.29 + lv * 0.02, -0.14)); }
    }
    return merge(p);
  });
};
/** Attach empty stockpile heaps to a building model at the given spots (filled in by the renderer). */
function addPiles(g, spots) {
  g.userData.piles = spots.map(([res, x, y, z, sc, ry]) => {
    const m = meshOf(Models.pileGeo(res, 5));
    m.position.set(x, y, z); m.scale.setScalar(sc); m.rotation.y = ry || 0;
    m.visible = false;
    g.add(m);
    return { res, mesh: m, lv: -1 };
  });
}

/* ---------- villagers (chibi cartoon style) ---------- */
function hexOf(c) { return typeof c === 'number' ? c : parseInt(String(c).slice(1), 16); }
Models.villager = function (look, job) {
  const pal = lookPalette(look, job);
  const H = (k) => hexOf(pal[k]);
  const fem = look.g === 'f';
  const g = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.36; g.add(hips);
  const legs = [];
  for (const sx of [-1, 1]) {
    const L = new THREE.Group(); L.position.set(sx * 0.085, 0, 0); hips.add(L);
    if (fem) L.add(meshOf([sph(0.065, H('S'), 0, -0.34, 0.04, 1, 0.6, 1.4)]));
    else L.add(meshOf([...limb(0.07, 0.2, H('D'), 0, -0.02, 0), cyl(0.055, 0.055, 0.08, 10, H('S'), 0, -0.3, 0), sph(0.07, 0x5a3420, 0, -0.33, 0.04, 1, 0.55, 1.45)]));
    legs.push(L);
  }
  const body = [];
  if (fem) {
    const prof = [[0.255, -0.36], [0.25, -0.33], [0.215, -0.22], [0.18, -0.08], [0.16, 0.04]].map(([x, y]) => new THREE.Vector2(x, y));
    body.push(P(new THREE.LatheGeometry(prof, 16), H('D'), 0, 0, 0));
    body.push(P(new THREE.TorusGeometry(0.25, 0.022, 6, 18), H('d'), 0, -0.34, 0, Math.PI / 2));
    body.push(cyl(0.14, 0.165, 0.28, 16, H('C'), 0, 0, 0));
    body.push(boxC(0.07, 0.36, 0.3, H('D'), -0.05, 0.16, 0.02, 0, 0, -0.55));
    body.push(sph(0.15, H('D'), -0.1, 0.27, -0.02, 0.6, 0.45, 1.0));
  } else {
    body.push(cyl(0.165, 0.18, 0.14, 16, H('D'), 0, -0.1, 0));
    body.push(cyl(0.15, 0.175, 0.3, 16, H('C'), 0, 0, 0));
    body.push(P(new THREE.TorusGeometry(0.175, 0.02, 6, 18), H('c'), 0, 0.01, 0, Math.PI / 2));
  }
  body.push(sph(0.155, H('C'), 0, 0.28, 0, 1, 0.5, 0.85));
  // big round head
  const hy = 0.56;
  body.push(cyl(0.06, 0.07, 0.08, 10, H('S'), 0, 0.3, 0));
  body.push(sph(0.215, H('S'), 0, hy, 0));
  for (const sx of [-1, 1]) {
    body.push(sph(0.048, 0xffffff, sx * 0.078, hy + 0.02, 0.178, 1, 1.15, 0.6));
    body.push(sph(0.028, 0x1a0f0a, sx * 0.078, hy + 0.015, 0.205, 1, 1.2, 0.6));
    body.push(sph(0.009, 0xffffff, sx * 0.07, hy + 0.03, 0.222));
    body.push(sph(0.036, 0xf08a8a, sx * 0.125, hy - 0.06, 0.165, 1, 0.6, 0.5));
    body.push(sph(0.035, H('S'), sx * 0.212, hy, 0, 0.5, 1, 0.8));
  }
  body.push(sph(0.03, new THREE.Color(H('S')).multiplyScalar(0.85).getHex(), 0, hy - 0.025, 0.215, 1, 0.8, 0.8));
  body.push(boxC(0.06, 0.012, 0.01, 0x6b2a1e, 0, hy - 0.1, 0.2));
  if (fem) {
    body.push(P(new THREE.SphereGeometry(0.228, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), H('h'), 0, hy + 0.005, -0.012, -0.3));
    body.push(sph(0.1, H('h'), 0, hy + 0.06, -0.21));
    body.push(sph(0.022, 0xd01c1c, 0, hy + 0.095, 0.205));
    if (look.covered) body.push(P(new THREE.SphereGeometry(0.24, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), H('D'), 0, hy + 0.01, -0.03, -0.45));
  } else {
    if (look.stache) body.push(sphR(0.055, H('m'), 0, hy - 0.07, 0.2, 0, 0, 0, 1.3, 0.35, 0.5));
    body.push(P(new THREE.TorusGeometry(0.17, 0.065, 8, 18), H('H'), 0, hy + 0.13, 0, Math.PI / 2));
    body.push(sph(0.19, H('H'), 0, hy + 0.16, 0, 1, 0.62, 1));
    body.push(P(new THREE.TorusGeometry(0.175, 0.025, 6, 18), H('G'), 0, hy + 0.1, 0.005, Math.PI / 2 - 0.1));
    body.push(sph(0.06, H('H'), 0, hy + 0.15, -0.21));
  }
  if (job === 'archer') { body.push(cylC(0.055, 0.05, 0.38, 10, 0x7a4b26, 0.07, 0.22, -0.18, 0, 0, 0.35)); for (let i = 0; i < 3; i++) body.push(coneC(0.025, 0.08, 3, 0xd33b2c, 0.13 + i * 0.02, 0.44, -0.18)); }
  if (job === 'priest' && !fem) body.push(boxC(0.07, 0.022, 0.01, 0xffffff, 0, hy + 0.12, 0.205));
  const torso = meshOf(body);
  hips.add(torso);
  // arms
  const arms = [];
  for (const sx of [-1, 1]) {
    const A = new THREE.Group(); A.position.set(sx * 0.19, 0.25, 0); hips.add(A);
    A.add(meshOf([sph(0.06, H('C'), 0, 0, 0), ...limb(0.05, 0.15, H('C'), 0, 0, 0), cyl(0.044, 0.044, 0.1, 10, H('S'), 0, -0.25, 0), sph(0.056, H('S'), 0, -0.29, 0)]));
    arms.push(A);
  }
  const T = [];
  const tool = JOBS[job] && JOBS[job].tool;
  const hy2 = -0.29;
  if (tool === 'axe') { T.push(cyl(0.022, 0.022, 0.5, 8, 0x8a5a2e, 0, hy2 - 0.42, 0.04)); T.push(sphR(0.09, 0xd0d4dc, 0, hy2 - 0.4, 0.12, 0, 0, 0, 0.35, 0.9, 1)); }
  else if (tool === 'pick') { T.push(cyl(0.022, 0.022, 0.5, 8, 0x8a5a2e, 0, hy2 - 0.42, 0.04)); T.push(cylC(0.025, 0.012, 0.36, 8, 0xc0c4cc, 0, hy2 - 0.4, 0.04, Math.PI / 2 + 0.2)); }
  else if (tool === 'hammer') { T.push(cyl(0.022, 0.022, 0.32, 8, 0x8a5a2e, 0, hy2 - 0.26, 0.04)); T.push(cylC(0.06, 0.06, 0.16, 10, 0x55555f, 0, hy2 - 0.26, 0.06, Math.PI / 2)); }
  else if (tool === 'sickle') { T.push(cyl(0.022, 0.022, 0.12, 8, 0x8a5a2e, 0, hy2 - 0.12, 0.04)); T.push(P(new THREE.TorusGeometry(0.09, 0.014, 5, 12, Math.PI * 1.2), 0xd8dae0, 0, hy2 - 0.18, 0.12, 0, Math.PI / 2, 0)); }
  else if (tool === 'sword') { T.push(cylC(0.05, 0.05, 0.03, 10, 0xe8b830, 0, hy2 - 0.04, 0.04, Math.PI / 2)); T.push(boxC(0.02, 0.5, 0.055, 0xf2f4f8, 0, hy2 - 0.32, 0.06, 0.12)); }
  else if (tool === 'bow') { T.push(P(new THREE.TorusGeometry(0.3, 0.017, 5, 14, Math.PI * 0.9), 0x8a5a2e, 0, hy2 - 0.02, 0.05, 0, Math.PI / 2, Math.PI * 0.55)); T.push(box(0.008, 0.008, 0.55, 0xf0e8d0, 0, hy2 - 0.02, -0.17)); }
  else if (tool === 'thali') { T.push(cyl(0.13, 0.11, 0.025, 16, 0xe8b830, 0, hy2 - 0.04, 0.08)); }
  else if (tool === 'sack') { T.push(sph(0.12, 0xd6b47a, 0, hy2 - 0.17, 0.04, 1, 1.1, 0.9)); }
  else if (tool === 'herbs') { T.push(cyl(0.09, 0.06, 0.06, 12, 0x8a5a2e, 0, hy2 - 0.08, 0.08)); T.push(sph(0.075, 0x5fae4a, 0, hy2 - 0.02, 0.08, 1, 0.45, 1)); T.push(coneC(0.025, 0.12, 5, 0x3f8a3a, 0.03, hy2 + 0.06, 0.08, 0, 0, -0.4)); } // a bowl of crushed herbs
  else if (tool === 'gada') { T.push(cyl(0.03, 0.035, 0.55, 10, 0x6b4223, 0, hy2 - 0.5, 0.06)); T.push(sph(0.15, 0xf2c230, 0, hy2 - 0.58, 0.06)); T.push(cyl(0.07, 0.07, 0.04, 12, 0xfff0a0, 0, hy2 - 0.45, 0.06)); T.push(cone(0.04, 0.09, 8, 0xfff0a0, 0, hy2 - 0.81, 0.06, Math.PI)); }
  else if (tool === 'spear') { T.push(cyl(0.02, 0.02, 1.5, 8, 0x8a5a2e, 0, hy2 - 0.55, 0.05)); T.push(cone(0.05, 0.22, 8, 0xe0e4ea, 0, hy2 + 0.95, 0.05)); T.push(sph(0.035, 0xd33b2c, 0, hy2 + 0.92, 0.05)); }
  if (T.length) arms[1].add(meshOf(T));
  let toolFlame = null;
  if (tool === 'thali') { toolFlame = glowMesh(new THREE.ConeGeometry(0.03, 0.1, 6), 0xffcc33); toolFlame.position.set(0, hy2 + 0.03, 0.08); arms[1].add(toolFlame); }
  if (job === 'brute') { // pehelwan: broad shoulders and a rudraksha mala
    torso.add(meshOf([sph(0.11, H('S'), -0.15, 0.27, 0, 1, 0.8, 0.9), sph(0.11, H('S'), 0.15, 0.27, 0, 1, 0.8, 0.9), P(new THREE.TorusGeometry(0.12, 0.018, 6, 16), 0x6b2a1e, 0, 0.3, 0.05, Math.PI / 2 - 0.5)]));
  }
  if (job === 'spear') arms[0].add(meshOf([cylC(0.13, 0.13, 0.03, 16, 0x3e5f8a, -0.05, -0.24, 0.02, 0, 0, Math.PI / 2), sph(0.035, 0xc9962e, -0.07, -0.24, 0.02)]));
  if (job === 'warrior') arms[0].add(meshOf([cylC(0.17, 0.17, 0.035, 18, 0xd4a234, -0.05, -0.24, 0.02, 0, 0, Math.PI / 2), sph(0.045, 0x8a5a22, -0.075, -0.24, 0.02), P(new THREE.TorusGeometry(0.15, 0.015, 5, 18), 0x8a5a22, -0.07, -0.24, 0.02, 0, Math.PI / 2, 0)]));
  let torch = null;
  if (slotKey(job) === 'army') {
    torch = new THREE.Group();
    torch.add(meshOf([cyl(0.022, 0.026, 0.4, 8, 0x6b4223, 0, -0.1, 0)], null, true, true));
    const fl = flameCluster(0.12); fl.position.y = 0.3; torch.add(fl); torch.userData.flame = fl;
    torch.position.set(0, -0.31, 0.06); torch.rotation.x = 0.5;
    arms[0].add(torch);
  }
  // the tokri on the back: the renderer swaps its geometry to show what is inside and how full it is
  const pack = meshOf(Models.packGeo('empty'));
  pack.position.set(0, 0.03, -0.27);
  pack.visible = false;
  hips.add(pack);
  const pouch = meshOf(Models.pouchGeo(), null, true);
  pouch.position.set(0.21, -0.02, 0.05);
  pouch.visible = false;
  hips.add(pouch);
  g.userData = { hips, torso, legs, arms, pack, pouch, torch, toolFlame, fem };
  return g;
};

/* ---------- demons (round and spooky-cute) ---------- */
Models.enemy = function (type, variant) {
  const g = new THREE.Group();
  const ud = { legs: [], arms: [], eyes: [], wings: [] };
  // both glowing eyes in one mesh: half the draw calls for every demon on screen
  const eyePair = (c, r, x, y, z) => glowMesh(merge([P(new THREE.SphereGeometry(r, 8, 6), c, -x, y, z), P(new THREE.SphereGeometry(r, 8, 6), c, x, y, z)]), c);
  const eye = (c, r) => glowMesh(new THREE.SphereGeometry(r || 0.05, 8, 6), c);
  if (type === 'bhoot') {
    const prof = [[0.42, 0.05], [0.44, 0.1], [0.4, 0.3], [0.37, 0.55], [0.36, 0.85], [0.3, 1.05], [0.18, 1.18], [0.001, 1.22]].map(([x, y]) => new THREE.Vector2(x, y));
    const p = [P(new THREE.LatheGeometry(prof, 18), 0xeef3fb, 0, 0, 0)];
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; p.push(sph(0.1, 0xe2e9f6, Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36, 1, 1.3, 1)); }
    p.push(sph(0.09, 0xeef3fb, -0.38, 0.7, 0.05, 1.6, 0.8, 0.8)); p.push(sph(0.09, 0xeef3fb, 0.38, 0.7, 0.05, 1.6, 0.8, 0.8));
    p.push(sph(0.07, 0x10131f, -0.12, 0.92, 0.28, 1, 1.5, 0.5)); p.push(sph(0.07, 0x10131f, 0.12, 0.92, 0.28, 1, 1.5, 0.5));
    p.push(sph(0.06, 0x2a2f48, 0, 0.74, 0.32, 1, 1.3, 0.5));
    const m = meshOf(p, MAT.bhoot, true, false);
    g.add(m);
    ud.body = m;
  } else if (type === 'vetala') {
    const p = [sph(0.24, 0x6a3a8e, 0, 0, 0, 1, 1.1, 1), sph(0.17, 0x6a3a8e, 0, 0.3, 0.05),
      coneC(0.06, 0.2, 12, 0x6a3a8e, -0.1, 0.47, 0.03, 0, 0, 0.3), coneC(0.06, 0.2, 12, 0x6a3a8e, 0.1, 0.47, 0.03, 0, 0, -0.3),
      coneC(0.02, 0.06, 6, 0xffffff, -0.04, 0.2, 0.2, Math.PI), coneC(0.02, 0.06, 6, 0xffffff, 0.04, 0.2, 0.2, Math.PI),
      sph(0.04, 0xd8cbb0, -0.07, -0.27, 0), sph(0.04, 0xd8cbb0, 0.07, -0.27, 0)];
    g.add(meshOf(p));
    for (const sx of [-1, 1]) {
      const wg = new THREE.Group(); wg.position.set(sx * 0.18, 0.05, 0); g.add(wg);
      const wp = [];
      for (let k = 0; k < 3; k++) wp.push(sphR(0.24, 0x3a1d52, sx * (0.22 + k * 0.18), 0.05 - k * 0.07, 0, 0, 0, sx * (0.3 + k * 0.25), 1, 0.45, 0.06));
      wp.push(cylC(0.02, 0.02, 0.7, 6, 0x2a1238, sx * 0.33, 0.12, 0, 0, 0, sx * 1.25));
      const wm = meshOf(wp);
      wg.add(wm);
      ud.wings.push(wg);
    }
    g.add(eyePair(0xffe14a, 0.045, 0.065, 0.33, 0.19));
  } else if (type === 'aleya') { // marsh light: a glowing wisp with a fading tail
    const body = new THREE.Group();
    const core = glowMesh(new THREE.SphereGeometry(0.13, 12, 10), 0xf0ffb8);
    const halo = glowMesh(new THREE.SphereGeometry(0.3, 14, 10), 0xb8ff5a, 0.26);
    body.add(core, halo);
    for (let i = 0; i < 3; i++) { const t = glowMesh(new THREE.SphereGeometry(0.065 - i * 0.015, 8, 6), 0xd4ff7a, 0.7 - i * 0.2); t.position.set(0, 0.03 * i, -0.2 - i * 0.15); body.add(t); }
    g.add(body); ud.body = body; ud.halo = halo;
  } else if (type === 'shakchunni') { // bride ghost: white saree with a red border, shell bangles, hair over the face
    const V2 = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
    const p = [P(new THREE.LatheGeometry(V2([[0.4, 0.02], [0.43, 0.08], [0.37, 0.35], [0.3, 0.62], [0.25, 0.86], [0.22, 1.0], [0.001, 1.03]]), 18), 0xf4f1ea, 0, 0, 0)];
    p.push(P(new THREE.TorusGeometry(0.42, 0.035, 6, 22), 0xd22b2b, 0, 0.07, 0, Math.PI / 2)); // laal paar
    p.push(P(new THREE.TorusGeometry(0.31, 0.03, 6, 20), 0xd22b2b, 0, 0.5, 0, Math.PI / 2 - 0.35)); // border on the pallu
    p.push(sph(0.17, 0xf2e8e0, 0, 1.15, 0.01));
    const m = meshOf(p, MAT.bhoot, true, false);
    g.add(m); ud.body = m;
    m.add(meshOf([sph(0.19, 0x15111a, 0, 1.18, -0.04, 1.06, 1.05, 1.04), boxC(0.32, 0.6, 0.07, 0x15111a, 0, 0.9, -0.15),
      boxC(0.07, 0.42, 0.03, 0x15111a, -0.07, 1.0, 0.17), boxC(0.07, 0.46, 0.03, 0x15111a, 0.05, 0.98, 0.175), boxC(0.05, 0.36, 0.03, 0x15111a, 0.13, 1.02, 0.15)], null, true));
    m.add(eyePair(0xff4a4a, 0.028, 0.09, 1.14, 0.17));
    const sindoor = eye(0xff2a2a, 0.022); sindoor.position.set(0, 1.3, 0.12); m.add(sindoor);
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.25, 0.84, 0.02); m.add(A);
      A.add(meshOf([...limb(0.045, 0.3, 0xf4f1ea, 0, 0, 0), P(new THREE.TorusGeometry(0.05, 0.016, 6, 12), 0xffffff, 0, -0.26, 0, Math.PI / 2), P(new THREE.TorusGeometry(0.05, 0.014, 6, 12), 0xd22b2b, 0, -0.3, 0, Math.PI / 2), sph(0.05, 0xf2e8e0, 0, -0.36, 0)], MAT.bhoot, true));
      ud.arms.push(A);
    }
  } else if (type === 'mechho' || type === 'skondhokata') { // walking Bengali ghosts share a rig
    const head = type === 'mechho';
    const skin = head ? 0x86a08c : 0x5a4a5e, skinD = new THREE.Color(skin).multiplyScalar(0.75).getHex();
    const hips = new THREE.Group(); hips.position.y = head ? 0.42 : 0.5; g.add(hips);
    for (const sx of [-1, 1]) {
      const L = new THREE.Group(); L.position.set(sx * (head ? 0.13 : 0.17), 0, 0); hips.add(L);
      L.add(meshOf([...limb(head ? 0.07 : 0.11, head ? 0.24 : 0.3, skinD, 0, 0, 0), sph(head ? 0.1 : 0.13, head ? 0x4c6656 : 0x2e2430, 0, head ? -0.36 : -0.45, 0.06, 1.2, 0.45, 1.5)]));
      ud.legs.push(L);
    }
    const p = [];
    if (head) { // Mechho Bhoot: pot-bellied pond ghost in a checked lungi
      p.push(cyl(0.27, 0.3, 0.2, 14, 0x3e6f9e, 0, -0.08, 0));
      for (let i = 0; i < 4; i++) p.push(P(new THREE.TorusGeometry(0.29, 0.012, 4, 20), 0xd8e4f0, 0, -0.04 + i * 0.045, 0, Math.PI / 2));
      p.push(sph(0.33, skin, 0, 0.24, 0.05, 1, 0.95, 1));
      p.push(sph(0.25, skin, 0, 0.42, -0.1));
      const hy = 0.64;
      p.push(sph(0.21, skin, 0, hy, 0.13, 1.1, 0.9, 1));
      p.push(boxC(0.2, 0.035, 0.02, 0x2a1a1a, 0, hy - 0.09, 0.32));
      for (const sx of [-1, 1]) { p.push(coneC(0.02, 0.05, 5, 0xf2ead0, sx * 0.05, hy - 0.11, 0.32, Math.PI)); p.push(sph(0.07, 0xe8f0e0, sx * 0.085, hy + 0.04, 0.27, 1, 1, 0.6)); }
      for (let i = 0; i < 5; i++) p.push(coneC(0.03, 0.16, 5, 0x2f4a3a, -0.1 + i * 0.05, hy + 0.2, 0.08 - Math.abs(i - 2) * 0.02, -0.5, 0, (i - 2) * 0.25));
    } else { // Skondhokata: a headless giant in a white dhoti, a blue ghost-flame where his head should be
      p.push(cyl(0.32, 0.36, 0.26, 16, 0xe9e2d0, 0, -0.14, 0));
      p.push(sph(0.4, skin, 0, 0.36, 0, 1.1, 1.0, 0.85));
      for (const sx of [-1, 1]) p.push(sph(0.16, skin, sx * 0.36, 0.6, 0));
      p.push(cyl(0.12, 0.14, 0.1, 12, 0x7a2a2a, 0, 0.68, 0));
      p.push(cyl(0.1, 0.1, 0.02, 12, 0x3a0c10, 0, 0.78, 0));
      p.push(P(new THREE.TorusGeometry(0.36, 0.014, 5, 24), 0xf4ecd8, 0, 0.36, 0.02, Math.PI / 2 - 0.2, 0.5, 0));
      const fl = new THREE.Group(); fl.position.set(0, 0.8, 0);
      const c1 = glowMesh(new THREE.ConeGeometry(0.1, 0.32, 8), 0x6fa8ff, 0.8); c1.position.y = 0.16;
      const c2 = glowMesh(new THREE.ConeGeometry(0.05, 0.2, 6), 0xdcecff); c2.position.y = 0.1;
      fl.add(c1, c2); hips.add(fl); ud.neckFlame = fl;
    }
    hips.add(meshOf(p, null, false, false, !head));
    if (head) hips.add(eyePair(0xb8ff6a, 0.035, 0.085, 0.68, 0.3));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * (head ? 0.31 : 0.46), head ? 0.36 : 0.55, head ? 0.06 : 0); hips.add(A);
      A.add(meshOf([sph(head ? 0.07 : 0.12, skin, 0, 0, 0), ...limb(head ? 0.06 : 0.1, head ? 0.26 : 0.34, skin, 0, 0, 0), sph(head ? 0.07 : 0.12, skinD, 0, head ? -0.36 : -0.46, 0)]));
      ud.arms.push(A);
    }
    if (head) { // a stolen fish in his fist
      ud.arms[1].add(meshOf([sph(0.07, 0xd9a14a, 0, -0.44, 0.14, 0.7, 0.85, 2.2), coneC(0.08, 0.12, 4, 0xc28a3a, 0, -0.44, -0.03, -Math.PI / 2, 0, 0, 1, 1, 0.4), sph(0.015, 0x111111, 0.04, -0.42, 0.27)]));
    } else { // he carries his own head under his arm
      ud.arms[0].add(meshOf([sph(0.17, skin, 0, -0.5, 0.14), sph(0.13, 0x1b1020, 0, -0.42, 0.08, 1.2, 0.6, 1.1), boxC(0.1, 0.02, 0.02, 0x2a0a0a, 0, -0.58, 0.3)]));
      ud.arms[0].add(eyePair(0xff6a3a, 0.03, 0.06, -0.49, 0.3));
    }
    ud.hips = hips; ud.hipY = hips.position.y;
  } else if (type === 'nishi') { // night caller: a hooded shadow reaching out with long pale arms
    const V2 = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
    const p = [P(new THREE.LatheGeometry(V2([[0.34, 0.0], [0.4, 0.06], [0.33, 0.45], [0.27, 0.9], [0.24, 1.2], [0.2, 1.42], [0.12, 1.56], [0.001, 1.6]]), 16), 0x2a2542, 0, 0, 0)];
    p.push(sph(0.16, 0x0b0a14, 0, 1.36, 0.1, 1, 1.05, 0.7));
    p.push(P(new THREE.TorusGeometry(0.17, 0.035, 6, 16), 0x443d66, 0, 1.36, 0.13));
    const m = meshOf(p, null, true, false);
    g.add(m); ud.body = m;
    m.add(eyePair(0xcfe0ff, 0.032, 0.055, 1.38, 0.21));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.24, 1.1, 0.06); m.add(A);
      A.add(meshOf([...limb(0.032, 0.5, 0xb9bfd6, 0, 0, 0), ...[-1, 0, 1].map((k) => cylC(0.008, 0.008, 0.12, 4, 0xb9bfd6, k * 0.02, -0.6, 0.02))], null, true));
      ud.arms.push(A);
    }
    ud.armBase = -1.15; // arms held out, beckoning
    const trail = glowMesh(new THREE.ConeGeometry(0.34, 0.5, 14, 1, true), 0x8f9cff, 0.18); trail.rotation.x = Math.PI; trail.position.y = 0.1;
    m.add(trail);
  } else {
    const big = type === 'boss';
    const skins = [0x4fa07e, 0x4e74c4, 0xb04a5a, 0x7a55b0];
    const skin = big ? 0x4b3666 : type === 'danav' ? 0x7a2a3c : skins[variant % skins.length];
    const sD = new THREE.Color(skin).multiplyScalar(0.78).getHex();
    const sL = new THREE.Color(skin).lerp(new THREE.Color(0xffffff), 0.25).getHex();
    const hips = new THREE.Group(); hips.position.y = 0.5; g.add(hips);
    for (const sx of [-1, 1]) {
      const L = new THREE.Group(); L.position.set(sx * 0.15, 0, 0); hips.add(L);
      L.add(meshOf([...limb(0.1, 0.3, sD, 0, 0, 0), sph(0.12, 0x3a2420, 0, -0.45, 0.05, 1, 0.55, 1.4)]));
      ud.legs.push(L);
    }
    const p = [];
    const cloth = big ? 0xa82222 : type === 'danav' ? 0x3d3d48 : 0xf09a32;
    p.push(cyl(0.3, 0.33, 0.2, 16, cloth, 0, -0.1, 0));
    if (!big && type !== 'danav') for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.push(boxC(0.04, 0.18, 0.04, 0x1a1010, Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32, 0, -a, 0)); }
    p.push(sph(0.36, skin, 0, 0.32, 0, 1, 1.0, 0.85));
    p.push(sph(0.24, sL, 0, 0.28, 0.17, 1, 1.05, 0.45));
    if (big) { p.push(P(new THREE.TorusGeometry(0.3, 0.05, 8, 20), 0xf2c230, 0, 0.55, 0.02, Math.PI / 2 - 0.3)); p.push(cyl(0.34, 0.36, 0.08, 16, 0xf2c230, 0, -0.02, 0)); }
    else for (let i = 0; i < 7; i++) { const a = -0.9 + (i / 6) * 1.8; p.push(sph(0.04, 0xf2ead0, Math.sin(a) * 0.25, 0.55 - Math.cos(a) * 0.05, Math.cos(a) * 0.2)); }
    const hy = 0.82;
    p.push(sph(0.25, skin, 0, hy, 0.02));
    p.push(sph(0.09, sL, 0, hy - 0.08, 0.22, 1.3, 0.8, 0.7));
    for (const sx of [-1, 1]) {
      p.push(coneC(0.025, 0.08, 8, 0xffffff, sx * 0.06, hy - 0.16, 0.22, Math.PI));
      p.push(boxC(0.12, 0.03, 0.03, 0x1b1020, sx * 0.08, hy + 0.12, 0.22, 0, 0, sx * -0.4));
      p.push(sph(0.06, 0xffffff, sx * 0.085, hy + 0.04, 0.2, 1, 1, 0.5));
    }
    p.push(sph(0.2, 0x1b1020, 0, hy + 0.16, -0.06, 1.2, 0.6, 1.1));
    if (big) {
      p.push(cyl(0.2, 0.22, 0.14, 16, 0xf2c230, 0, hy + 0.2, 0));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.push(cone(0.05, 0.16, 8, 0xf2c230, Math.cos(a) * 0.18, hy + 0.34, Math.sin(a) * 0.18)); }
      p.push(sph(0.05, 0xff3a3a, 0, hy + 0.27, 0.2));
      for (const sx of [-1, 1]) p.push(P(new THREE.TorusGeometry(0.3, 0.06, 8, 14, Math.PI * 0.62), 0xece0c4, sx * 0.25, hy + 0.08, 0, 0, sx < 0 ? 0 : Math.PI, Math.PI * 0.05));
    } else {
      for (const sx of [-1, 1]) { p.push(coneC(0.06, 0.28, 10, 0xf2ead0, sx * 0.17, hy + 0.27, 0, 0, 0, -sx * 0.4)); }
    }
    hips.add(meshOf(p, null, false, false, big));
    hips.add(eyePair(0xff3d2e, 0.035, 0.085, hy + 0.04, 0.23));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.38, 0.45, 0); hips.add(A);
      const ap = [sph(0.11, skin, 0, 0, 0), ...limb(0.085, 0.32, skin, 0, 0, 0), sph(0.1, sD, 0, -0.42, 0)];
      if (big) ap.push(P(new THREE.TorusGeometry(0.09, 0.025, 6, 14), 0xf2c230, 0, -0.18, 0, Math.PI / 2));
      A.add(meshOf(ap));
      ud.arms.push(A);
    }
    const W = [];
    if (big) { W.push(cyl(0.04, 0.04, 0.85, 10, 0x6b4223, 0, -1.25, 0.1)); W.push(sph(0.22, 0xf2c230, 0, -1.5, 0.1)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; W.push(coneC(0.04, 0.12, 8, 0xfff0a0, Math.cos(a) * 0.22, -1.5, 0.1 + Math.sin(a) * 0.22, Math.PI / 2, 0, a + Math.PI / 2)); } }
    else {
      W.push(cylC(0.05, 0.1, 0.75, 12, 0x7a4a28, 0, -0.78, 0.12));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; W.push(coneC(0.03, 0.09, 8, 0xf2ead0, Math.cos(a) * 0.1, -0.98, 0.12 + Math.sin(a) * 0.1, 0, 0, Math.PI / 2 + a)); }
    }
    ud.arms[1].add(meshOf(W));
    ud.hips = hips;
  }
  g.userData = Object.assign(g.userData, ud);
  return g;
};

/* ---------- animals ---------- */
Models.cow = function () {
  const g = new THREE.Group();
  const p = [box(0.85, 0.42, 0.4, 0xefe9df, 0, 0.42, 0, Math.PI / 2), box(0.22, 0.18, 0.3, 0xefe9df, 0, 0.84, 0.18, Math.PI / 2),
    box(0.26, 0.24, 0.32, 0xefe9df, 0, 0.62, 0.55), box(0.14, 0.1, 0.08, 0xd9a08a, 0, 0.62, 0.72),
    cone(0.03, 0.18, 4, 0xe03c31, -0.12, 0.84, 0.55, 0, 0, 0.5), cone(0.03, 0.18, 4, 0xe03c31, 0.12, 0.84, 0.55, 0, 0, -0.5),
    box(0.04, 0.04, 0.02, 0x111111, -0.08, 0.76, 0.715), box(0.04, 0.04, 0.02, 0x111111, 0.08, 0.76, 0.715),
    sph(0.05, 0xe8b830, 0, 0.55, 0.62), box(0.03, 0.35, 0.03, 0xa89f8f, 0, 0.45, -0.43)];
  g.add(meshOf(p));
  const legs = [];
  for (const [x, z] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) {
    const L = new THREE.Group(); L.position.set(x, 0.45, z); g.add(L);
    L.add(meshOf([box(0.08, 0.42, 0.08, 0xd6cdbd, 0, -0.45, 0), box(0.09, 0.05, 0.09, 0x3a2a1a, 0, -0.47, 0)]));
    legs.push(L);
  }
  g.userData.legs = legs;
  return g;
};
Models.peacock = function () {
  const g = new THREE.Group();
  g.add(meshOf([sph(0.16, 0x1f5fbf, 0, 0.35, 0, 1, 1, 1.3), box(0.07, 0.3, 0.07, 0x1f5fbf, 0, 0.42, 0.16), sph(0.07, 0x1f5fbf, 0, 0.72, 0.18),
    cone(0.03, 0.08, 3, 0xb5916a, 0, 0.7, 0.27, Math.PI / 2), box(0.12, 0.06, 0.01, 0x4fc3f7, 0, 0.8, 0.18),
    box(0.02, 0.25, 0.02, 0xb5916a, -0.05, 0, 0), box(0.02, 0.25, 0.02, 0xb5916a, 0.05, 0, 0)]));
  const tail = new THREE.Group(); tail.position.set(0, 0.35, -0.15); g.add(tail);
  for (let i = 0; i < 7; i++) {
    const a = -0.9 + (i / 6) * 1.8;
    const f = new THREE.Group(); f.rotation.y = a; tail.add(f);
    f.add(meshOf([box(0.12, 0.02, 0.8, 0x2b8a4f, 0, 0, -0.4), box(0.08, 0.025, 0.08, 0xe8b830, 0, 0, -0.75), box(0.04, 0.03, 0.04, 0x1f5fbf, 0, 0, -0.75)], null, true));
  }
  g.userData.tail = tail;
  return g;
};

/* ---------- small things ---------- */
Models.arrow = function () {
  return meshOf([box(0.025, 0.025, 0.55, 0xc89a5e, 0, -0.0125, 0), coneC(0.03, 0.08, 4, 0xe0e0e8, 0, 0, 0.3, Math.PI / 2), box(0.06, 0.02, 0.08, 0xd33b2c, 0, -0.01, -0.25)], null, true);
};
