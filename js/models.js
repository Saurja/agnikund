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

/* ---------- low-poly geometry ----------
   Every curved shape in the models goes through these: they take the segment counts the model asks
   for and draw it with fewer, broader facets (LP_K of them, never under 3, and 3-4 sided shapes such as
   square posts and pyramids are kept as they are). With flat shading (see P) each facet catches the
   light on its own, which is the faceted, hand-cut low-poly look. One knob sets the whole world's
   polygon count. */
const LP_K = 0.6;
const lpN = (n, def, min) => { n = n == null ? def : n; return n <= 4 ? n : Math.max(min || 3, Math.round(n * LP_K)); };
const SphG = (r, ws, hs, ps, pl, ts, tl) => new THREE.SphereGeometry(r, lpN(ws, 8, 4), lpN(hs, 6, 3), ps, pl, ts, tl);
const CylG = (rt, rb, h, rs, hs, oe, ts, tl) => new THREE.CylinderGeometry(rt, rb, h, lpN(rs, 8), hs, oe, ts, tl);
const ConeG = (r, h, rs, hs, oe, ts, tl) => new THREE.ConeGeometry(r, h, lpN(rs, 8), hs, oe, ts, tl);
const LatheG = (pts, segs, ps, pl) => new THREE.LatheGeometry(pts, lpN(segs, 12, 5), ps, pl);
const TorusG = (r, tube, rs, ts, arc) => new THREE.TorusGeometry(r, tube, lpN(rs, 8), lpN(ts, 6, 5), arc);

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
/*
 * Character surfaces (villagers and demons). The pattern lives in the model's own space, so cloth prints and
 * demon hides move with the body instead of swimming. Codes come from the per-vertex 'fab' attribute.
 */
const NOISE_GLSL = `
  float hh3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vn3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hh3(i), hh3(i + vec3(1, 0, 0)), f.x), mix(hh3(i + vec3(0, 1, 0)), hh3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hh3(i + vec3(0, 0, 1)), hh3(i + vec3(1, 0, 1)), f.x), mix(hh3(i + vec3(0, 1, 1)), hh3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;
function charMat(opts) {
  const mat = surfaceMat(Object.assign({ vertexColors: true, roughness: 0.8 }, opts || {}));
  if (MAT.tier === 'low') return mat;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float fab;\nvarying float vFab;\nvarying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFab = fab; vObj = position;');
    sh.fragmentShader = 'varying float vFab;\nvarying vec3 vObj;\n' + NOISE_GLSL + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 op = vObj; float f = vFab;
        float n1 = vn3(op * 38.0), n2 = vn3(op * 120.0);
        vec2 cu = vec2(atan(op.z, op.x) * 3.0, op.y * 26.0); // wraps around the body like cloth
        if (f < 0.5) diffuseColor.rgb *= 0.985 + 0.03 * n1;                                  // skin: a soft, living unevenness
        else if (f < 1.5) diffuseColor.rgb *= 0.965 + 0.07 * (n1 * 0.4 + n2 * 0.6);          // woven cotton
        else if (f < 2.5) {                                                                // block print: little rosettes
          vec2 c = fract(cu) - 0.5; float d = length(c);
          float m = smoothstep(0.3, 0.24, d) * (1.0 - smoothstep(0.17, 0.11, d)) + smoothstep(0.08, 0.04, d);
          diffuseColor.rgb *= (0.93 + 0.12 * n2) * (1.0 - 0.24 * m);
        } else if (f < 3.5) {                                                              // gamcha checks
          float a = step(0.6, fract(cu.x * 0.5)), b = step(0.6, fract(cu.y * 0.3));
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.94 + 0.1 * n2), vec3(0.95, 0.92, 0.85), 0.55 * max(a, b) - 0.2 * a * b);
        } else if (f < 4.5) {                                                              // demon hide: mottled, with scaly seams
          float m = vn3(op * 14.0) * 0.6 + vn3(op * 42.0) * 0.4;
          vec2 sc = abs(fract(vec2(op.x * 13.0 + op.y * 7.0, op.z * 13.0 - op.y * 7.0)) - 0.5);
          diffuseColor.rgb *= (0.88 + 0.24 * m) * (1.0 - 0.09 * smoothstep(0.42, 0.5, max(sc.x, sc.y)));
        } else if (f < 5.5) diffuseColor.rgb *= 0.86 + 0.26 * vn3(vec3(op.x * 24.0, op.y * 3.0, op.z * 24.0)); // ghost cloth
        else if (f < 6.5) diffuseColor.rgb *= 0.78 + 0.36 * vn3(vec3(op.x * 70.0, op.y * 8.0, op.z * 70.0));   // fur, hair
        else if (f < 7.5) {                                                                // tiger skin
          float st = sin(cu.x * 2.4 + sin(op.y * 28.0) * 1.4 + n1 * 3.0);
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.92 + 0.12 * n2), vec3(0.09, 0.05, 0.03), smoothstep(0.5, 0.75, st));
        } else diffuseColor.rgb *= 0.86 + 0.2 * vn3(vec3(op.x * 5.0, op.y * 90.0, op.z * 5.0));               // metal, brushed
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (vFab < 0.5 ? 0.14 : 0.05); // light scattering through skin and cloth: faces stay readable in shade
      if (vFab > 4.5 && vFab < 5.5) { // ghosts glow at their edges
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        totalEmissiveRadiance += vec3(0.42, 0.58, 0.95) * pow(rim, 2.2) * 0.85;
      }`);
  };
  mat.customProgramCacheKey = () => 'char_' + MAT.tier + (opts && opts.transparent ? 't' : '');
  return mat;
}
const ghostMat = () => charMat({ transparent: true, opacity: 0.86, emissive: 0x2a3848, roughness: 0.9 });
function initMaterials(tier) {
  MAT.tier = tier || MAT.tier || 'high';
  MAT.useOutline = false; // the modern look relies on light, shadow and occlusion rather than ink lines
  MAT.ramp = MAT.ramp || toonRamp([95, 165, 220, 255]);
  MAT.std = surfaceMat({ vertexColors: true });
  MAT.bld = MAT.tier === 'low' ? MAT.std : texturize(surfaceMat({ vertexColors: true, roughness: 0.92 }), 0.05); // (a whisper of grain: low-poly reads from clean facets)
  MAT.bhoot = MAT.tier === 'low' ? surfaceMat({ vertexColors: true, transparent: true, opacity: 0.82, emissive: 0x2a3848 }) : ghostMat();
  MAT.char = charMat();
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
    // sunny leaf green: blue-greens lean toward yellow-green, a little brighter and livelier
    h -= ((Math.max(0, deg - 95) * 0.3) / 360) * g;
    s = Math.min(1, s * (1 + 0.04 * g));
    l *= 1 + 0.02 * g;
  }
  if (deg > 15 && deg < 50) s = Math.min(1, s * 1.08); // warm earth, wood and thatch a touch richer
  if (s > 0.78) s = 0.78 + (s - 0.78) * 0.5; // soft knee on very loud colours
  if (l > 0.9) l = 0.9 + (l - 0.9) * 0.6;    // cream, not paper-white
  if (l < 0.1) l = 0.1 - (0.1 - l) * 0.5;    // deep brown-black, never pure black
  _gcol.setHSL(h, s, l);
  _gcol.r = _gcol.r * 0.98 + 0.022; _gcol.g = _gcol.g * 0.98 + 0.016; _gcol.b = _gcol.b * 0.98 + 0.006; // sunlit warmth
  out = _gcol.getHex();
  _gradeCache.set(hex, out);
  return out;
}
/** Light palette: a golden sun against a cool periwinkle sky fill, so lit faces glow warm and shadows fall cool. */
const SUN_DAY = 0xfff0d4, HEMI_SKY = 0xb4d0fa, HEMI_GROUND = 0x8c7c50, SKY_DAY = 0xd3eaf4;
/** Shift a colour's hue (in degrees) and lightness — for gentle variety inside one family. */
function varyHex(hex, dh, dl) {
  _gcol.setHex(hex).getHSL(_hsl);
  _gcol.setHSL((_hsl.h + dh / 360 + 1) % 1, _hsl.s, clamp(_hsl.l + dl, 0, 1));
  return _gcol.getHex();
}

/* ---------- geometry helpers ---------- */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
/*
 * Surface codes for characters, read by the character material (charMat): parts built while FAB is set
 * carry it per vertex. 0 skin · 1 woven cotton · 2 block print · 3 gamcha checks · 4 demon hide
 * 5 ghost cloth (wispy, glowing rim) · 6 fur and hair · 7 tiger skin · 8 metal. Only character
 * models set it; everything else stays 0 and ignores it.
 */
let FAB = 0;
const V2 = (a) => a.map(([x, y]) => new THREE.Vector2(x, y));
const mixHex = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const darkHex = (a, f) => new THREE.Color(a).multiplyScalar(f).getHex();
function P(geo, color, x, y, z, rx, ry, rz, sx, sy, sz) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute('normal', g.attributes.normal.clone());
  _eu.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_eu);
  _vp.set(x || 0, y || 0, z || 0);
  _vs.set(sx || 1, sy || 1, sz || 1);
  _m4.compose(_vp, _q, _vs);
  out.applyMatrix4(_m4);
  // flat shading: every triangle gets its own face normal (the geometry is unindexed), so each facet
  // takes the light as one plane, the crisp low-poly look
  out.computeVertexNormals();
  const n = out.attributes.position.count, col = new THREE.Color(typeof color === 'number' ? grade(color) : color), arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (FAB) out.setAttribute('fab', new THREE.BufferAttribute(new Float32Array(n).fill(FAB), 1));
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
const cyl = (rt, rb, h, seg, c, x, y, z, rx, ry, rz) => P(CylG(rt, rb, h, segs(seg, Math.max(rt, rb))), c, x, (y || 0) + h / 2, z, rx, ry, rz);
const cone = (r, h, seg, c, x, y, z, rx, ry, rz) => P(ConeG(r, h, segs(seg, r)), c, x, (y || 0) + h / 2, z, rx, ry, rz);
const sph = (r, c, x, y, z, sx, sy, sz, ws, hs) => P(SphG(r, ...sphSeg(r * Math.max(sx || 1, sy || 1, sz || 1), ws, hs)), c, x, y, z, 0, 0, 0, sx, sy, sz);
// centre-anchored versions for rotated parts
const boxC = (w, h, d, c, x, y, z, rx, ry, rz) => P(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const cylC = (rt, rb, h, seg, c, x, y, z, rx, ry, rz) => P(CylG(rt, rb, h, segs(seg, Math.max(rt, rb))), c, x, y, z, rx, ry, rz);
const coneC = (r, h, seg, c, x, y, z, rx, ry, rz) => P(ConeG(r, h, segs(seg, r)), c, x, y, z, rx, ry, rz);
const sphR = (r, c, x, y, z, rx, ry, rz, sx, sy, sz, ws, hs) => P(SphG(r, ...sphSeg(r * Math.max(sx || 1, sy || 1, sz || 1), ws, hs)), c, x, y, z, rx, ry, rz, sx, sy, sz);
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
  let n = 0, anyFab = false;
  for (const p of parts) { n += p.attributes.position.array.length; if (p.attributes.fab) anyFab = true; }
  const pos = new Float32Array(n), nor = new Float32Array(n), col = new Float32Array(n), fab = anyFab ? new Float32Array(n / 3) : null;
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    nor.set(p.attributes.normal.array, o);
    col.set(p.attributes.color.array, o);
    if (fab && p.attributes.fab) fab.set(p.attributes.fab.array, o / 3);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (fab) g.setAttribute('fab', new THREE.BufferAttribute(fab, 1));
  if (MAT.useOutline !== false) addOutlineNormals(g); // only needed for ink outlines, and costly to build
  g.computeBoundingSphere();
  return g;
}
/**
 * One skinned mesh from parts that each ride a single bone (rigid skinning). entries: [[parts, bone]].
 * Parts are built in their bone's frame; here they move into the bind pose, so the whole jointed body
 * draws in one call instead of a dozen.
 */
function skinnedBody(g, root, bones, entries, mat) {
  root.updateMatrixWorld(true);
  const geos = [];
  let n = 0;
  for (const [parts, b] of entries) {
    const geo = merge(parts);
    geo.applyMatrix4(b.matrixWorld);
    geos.push([geo, bones.indexOf(b)]);
    n += geo.attributes.position.count;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), fab = new Float32Array(n), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  let o = 0;
  for (const [geo, bi] of geos) {
    const c = geo.attributes.position.count;
    pos.set(geo.attributes.position.array, o * 3); nor.set(geo.attributes.normal.array, o * 3); col.set(geo.attributes.color.array, o * 3);
    if (geo.attributes.fab) fab.set(geo.attributes.fab.array, o);
    for (let i = 0; i < c; i++) { si[(o + i) * 4] = bi; sw[(o + i) * 4] = 1; }
    o += c;
    geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('fab', new THREE.BufferAttribute(fab, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.computeBoundingSphere();
  // poses (lying asleep, a lunge) reach past the bind-pose bounds: a roomier sphere covers them all,
  // so villagers off the screen are skipped instead of drawn
  geo.boundingSphere.radius = geo.boundingSphere.radius * 1.6 + 0.25;
  if (!mat.skinning) { mat.skinning = true; mat.needsUpdate = true; } // (ignored by meshes that are not skinned)
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(root);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.userData.skinned = true;
  g.add(mesh);
  return mesh;
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
function silMat(color, offset, skinned) {
  MAT.sil = MAT.sil || {};
  const k = color + '_' + offset.toFixed(2) + (skinned ? 's' : '');
  if (MAT.sil[k]) return MAT.sil[k];
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOffset: { value: offset } },
    skinning: !!skinned,
    vertexShader: `#include <common>
      #include <skinning_pars_vertex>
      uniform float uOffset; varying float vRim;
      void main() {
        vec3 objectNormal = vec3(normal);
        vec3 transformed = vec3(position);
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vec3 n = normalize(normalMatrix * objectNormal), v = normalize(-mv.xyz);
        vRim = 1.0 - abs(dot(n, v));
        mv.xyz += v * uOffset;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vRim;
      void main() { gl_FragColor = vec4(uColor, 0.5); }`,
    // Drawn in the solid pass after the world (renderOrder 1) but before any unit (renderOrder 2), so the
    // depth buffer holds only trees, buildings and ground: a unit shows through those, never through
    // another villager or demon (a crowd would otherwise light up red all over). Blended by hand.
    transparent: false, depthWrite: false, depthFunc: THREE.GreaterDepth,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    // One even shape, not a patchwork of its parts: the stencil lets each screen pixel take the glow only
    // once, so an arm over the body or a leg behind the other never stacks up brighter (flat colour, no rim)
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
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
  let s = null;
  for (const part of obj.userData.silParts || [best]) { // a skinned villager gets a skinned twin on the same skeleton
    if (part.isSkinnedMesh) { s = new THREE.SkinnedMesh(part.geometry, silMat(color, offset, true)); s.bind(part.skeleton, part.bindMatrix); s.frustumCulled = part.frustumCulled; }
    else s = new THREE.Mesh(part.geometry, silMat(color, offset));
    s.renderOrder = 1; s.castShadow = false; s.receiveShadow = false;
    s.raycast = () => {};
    s.userData.sil = true; s.userData.noAO = true;
    part.add(s);
  }
  obj.traverse((c) => { if (c.isMesh && !c.userData.sil) c.renderOrder = 2; }); // the unit itself draws after every silhouette
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
/* ---------- building emblems ----------
 * A round, brass-rimmed plaque hovers over every home and workshop with a painted pictogram (an anvil
 * for the Lohar, a sack for the Bhandar, a fish for the Machhli Ghat...) and a coloured ring for its kind:
 * saffron homes, green gatherers, iron-grey crafts, gold trade, red soldiers, leaf-green healing. It always
 * faces the camera; the renderer fades the plaques out as the camera pulls far back.
 */
const EMBLEM_OF = { hut: 'home', bighouse: 'home', bighouseV: 'home', haveli: 'home', woodcamp: 'axe', minecamp: 'pick', buildyard: 'hammer', store: 'sack', claypit: 'pot', kiln: 'bricks', smelter: 'ingot', range: 'bow', bazaar: 'scales', forge: 'anvil', sawmill: 'saw', vaidyashala: 'herb', akhara: 'swords', fishhut: 'fish' };
const EMBLEM_RING = { home: '#ff9933', axe: '#5fa83c', pick: '#5fa83c', pot: '#5fa83c', fish: '#2f9ccf', hammer: '#7d848e', bricks: '#7d848e', ingot: '#7d848e', anvil: '#7d848e', saw: '#7d848e', sack: '#e0a91c', scales: '#e0a91c', bow: '#c8453c', swords: '#c8453c', herb: '#2f9e5c' };
const EMBLEM_INK = '#3a2416';
const EMBLEM_GLYPHS = {
  home(x, P) { P.fill([[-28, -2], [0, -28], [28, -2]], '#b5532f'); x.fillStyle = '#e8b47a'; x.fillRect(-20, -2, 40, 28); x.strokeRect(-20, -2, 40, 28); x.fillStyle = EMBLEM_INK; x.fillRect(-6, 9, 12, 17); },
  axe(x, P) { P.line(-18, 27, 12, -20, 8, '#8a5a2e'); P.fill([[4, -31], [30, -19], [24, 6], [10, -9]], '#cfd4dc'); },
  pick(x, P) { P.line(-14, 28, 8, -14, 8, '#8a5a2e'); x.lineWidth = 11; x.strokeStyle = EMBLEM_INK; x.beginPath(); x.moveTo(-28, -12); x.quadraticCurveTo(4, -34, 30, -6); x.stroke(); x.lineWidth = 7; x.strokeStyle = '#a9b0ba'; x.stroke(); x.lineWidth = 3; },
  hammer(x, P) { P.line(-12, 28, 6, -4, 8, '#8a5a2e'); x.save(); x.translate(9, -13); x.rotate(-0.5); x.fillStyle = '#6f757e'; x.fillRect(-19, -9, 38, 18); x.strokeRect(-19, -9, 38, 18); x.restore(); },
  sack(x, P) { x.beginPath(); x.moveTo(-20, 28); x.quadraticCurveTo(-30, -2, -10, -14); x.lineTo(10, -14); x.quadraticCurveTo(30, -2, 20, 28); x.closePath(); x.fillStyle = '#e0bf7a'; x.fill(); x.stroke(); P.fill([[-10, -14], [-16, -26], [16, -26], [10, -14]], '#d0a95e'); x.fillStyle = '#8a5a2e'; x.fillRect(-12, -18, 24, 6); x.fillStyle = '#f2c94c'; for (const [a, b] of [[-8, 8], [4, 2], [10, 14], [-2, 18]]) { x.beginPath(); x.ellipse(a, b, 3, 4.5, 0.4, 0, Math.PI * 2); x.fill(); } },
  pot(x, P) { x.beginPath(); x.ellipse(0, 8, 24, 20, 0, 0, Math.PI * 2); x.fillStyle = '#c27e4c'; x.fill(); x.stroke(); x.fillStyle = '#a86438'; x.fillRect(-10, -20, 20, 12); x.strokeRect(-10, -20, 20, 12); x.fillStyle = '#d68e58'; x.fillRect(-15, -25, 30, 6); x.strokeRect(-15, -25, 30, 6); x.strokeStyle = '#8c4e2c'; x.beginPath(); x.moveTo(-20, 6); x.quadraticCurveTo(0, 12, 20, 6); x.stroke(); x.strokeStyle = EMBLEM_INK; },
  bricks(x) { x.fillStyle = '#d8643c'; for (const [rx, ry, w] of [[-26, 10, 24], [2, 10, 24], [-13, -6, 26], [-26, -22, 0], [-13, -22, 26]]) if (w) { x.fillRect(rx, ry, w, 14); x.strokeRect(rx, ry, w, 14); } },
  ingot(x, P) { P.fill([[-26, 26], [26, 26], [18, 10], [-18, 10]], '#b9c3cf'); x.beginPath(); x.moveTo(0, -30); x.quadraticCurveTo(18, -12, 10, 2); x.quadraticCurveTo(0, 8, -10, 2); x.quadraticCurveTo(-18, -12, 0, -30); x.fillStyle = '#ff8a1f'; x.fill(); x.stroke(); x.beginPath(); x.moveTo(0, -16); x.quadraticCurveTo(8, -6, 4, 0); x.quadraticCurveTo(0, 3, -4, 0); x.quadraticCurveTo(-8, -6, 0, -16); x.fillStyle = '#ffe066'; x.fill(); },
  bow(x, P) { x.lineWidth = 7; x.strokeStyle = EMBLEM_INK; x.beginPath(); x.moveTo(-12, -30); x.quadraticCurveTo(26, 0, -12, 30); x.stroke(); x.lineWidth = 4; x.strokeStyle = '#8a5a2e'; x.stroke(); x.lineWidth = 2; x.strokeStyle = EMBLEM_INK; x.beginPath(); x.moveTo(-12, -30); x.lineTo(-12, 30); x.stroke(); P.line(-26, 0, 22, 0, 4, '#c8a46a'); P.fill([[30, 0], [20, -7], [20, 7]], '#cfd4dc'); P.fill([[-28, 0], [-34, -6], [-24, -6]], '#d33b2c'); x.lineWidth = 3; },
  scales(x, P) { P.line(0, -26, 0, 26, 5, '#c9962e'); P.line(-24, -18, 24, -18, 5, '#c9962e'); x.fillStyle = '#c9962e'; x.fillRect(-12, 24, 24, 5); for (const sx of [-1, 1]) { P.line(sx * 24, -18, sx * 24 - 9, 4, 2, EMBLEM_INK); P.line(sx * 24, -18, sx * 24 + 9, 4, 2, EMBLEM_INK); x.beginPath(); x.moveTo(sx * 24 - 13, 4); x.quadraticCurveTo(sx * 24, 16, sx * 24 + 13, 4); x.closePath(); x.fillStyle = '#e8b830'; x.fill(); x.stroke(); } },
  anvil(x, P) { P.fill([[-30, -8], [22, -8], [30, -16], [30, -4], [16, 2], [10, 14], [20, 26], [-16, 26], [-8, 14], [-12, 2], [-30, 0]], '#5f656e'); x.fillStyle = '#ffcc33'; for (const [a, b] of [[-14, -22], [-4, -28], [6, -22], [12, -30]]) { x.beginPath(); x.arc(a, b, 2.6, 0, Math.PI * 2); x.fill(); } },
  saw(x, P) { x.beginPath(); x.moveTo(-26, -6); x.lineTo(22, -14); x.lineTo(22, 4); for (let i = 0; i < 7; i++) { x.lineTo(16 - i * 6.5, 10 + (i % 2 ? 0 : 5)); } x.lineTo(-26, 6); x.closePath(); x.fillStyle = '#cfd4dc'; x.fill(); x.stroke(); x.fillStyle = '#8a5a2e'; x.fillRect(-36, -10, 12, 22); x.strokeRect(-36, -10, 12, 22); },
  herb(x, P) { x.beginPath(); x.moveTo(-4, 8); x.quadraticCurveTo(-30, -6, -10, -30); x.quadraticCurveTo(10, -18, -4, 8); x.fillStyle = '#4caf50'; x.fill(); x.stroke(); x.beginPath(); x.moveTo(2, 8); x.quadraticCurveTo(26, -8, 20, -26); x.quadraticCurveTo(0, -18, 2, 8); x.fillStyle = '#6cc04a'; x.fill(); x.stroke(); x.beginPath(); x.moveTo(-20, 8); x.lineTo(20, 8); x.quadraticCurveTo(18, 28, 0, 28); x.quadraticCurveTo(-18, 28, -20, 8); x.fillStyle = '#a07850'; x.fill(); x.stroke(); },
  swords(x, P) { for (const s of [-1, 1]) { P.line(-s * 24, 26, s * 22, -26, 6, '#dfe4ec'); P.line(-s * 30, 14, -s * 14, 22, 5, '#e8b830'); } },
  fish(x, P) { x.beginPath(); x.moveTo(-26, 0); x.quadraticCurveTo(0, -22, 18, 0); x.quadraticCurveTo(0, 22, -26, 0); x.fillStyle = '#4fb0d8'; x.fill(); x.stroke(); P.fill([[16, 0], [32, -14], [32, 14]], '#3a8fc0'); x.fillStyle = EMBLEM_INK; x.beginPath(); x.arc(-14, -3, 3, 0, Math.PI * 2); x.fill(); x.strokeStyle = '#2f7aa0'; x.beginPath(); x.moveTo(-4, -10); x.quadraticCurveTo(0, 0, -4, 10); x.stroke(); x.strokeStyle = EMBLEM_INK; },
};
function emblemMat(kind) {
  MAT.emblems = MAT.emblems || {};
  if (MAT.emblems[kind]) return MAT.emblems[kind];
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const disc = (r, c) => { x.beginPath(); x.arc(64, 64, r, 0, Math.PI * 2); x.fillStyle = c; x.fill(); };
  disc(62, 'rgba(20,12,6,0.55)'); disc(59, '#3a2416'); disc(55, '#d4a234'); disc(51, '#a8771c'); disc(48, EMBLEM_RING[kind] || '#ff9933'); disc(41, '#f6ead0');
  x.save(); x.translate(64, 66); x.lineJoin = 'round'; x.lineCap = 'round'; x.lineWidth = 3; x.strokeStyle = EMBLEM_INK;
  const P = {
    fill(pts, c) { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fillStyle = c; x.fill(); x.stroke(); },
    line(a, b, c2, d, w, col) { x.lineWidth = w + 4; x.strokeStyle = EMBLEM_INK; x.beginPath(); x.moveTo(a, b); x.lineTo(c2, d); x.stroke(); x.lineWidth = w; x.strokeStyle = col; x.stroke(); x.lineWidth = 3; x.strokeStyle = EMBLEM_INK; },
  };
  (EMBLEM_GLYPHS[kind] || EMBLEM_GLYPHS.home)(x, P);
  x.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  m.userData.emblem = true;
  MAT.emblems[kind] = m;
  return m;
}
/** The emblem over a building (none for fields, walls, roads, towers, wells, lamps and the temple). */
function addEmblem(g, type) {
  const kind = EMBLEM_OF[type];
  if (!kind) return null;
  const d = BUILDINGS[type], sp = new THREE.Sprite(emblemMat(kind));
  sp.scale.setScalar(d.fw * d.fd >= 8 ? 0.85 : 0.66);
  sp.position.set(0, d.ht + 0.5, 0);
  sp.raycast = () => {};
  sp.renderOrder = 5;
  g.add(sp);
  g.userData.emblem = sp;
  return sp;
}
/** A flickering flame of layered cones. Small flames (torches, lamps) use 5 layers instead of 11. */
function flameCluster(scale) {
  const g = new THREE.Group();
  const parts = [];
  const lite = scale < 0.5;
  const add = (r, h, c, x, z, ph, op) => {
    const m = glowMesh(ConeG(r * scale, h * scale, 5), c, op);
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
      p.push(box(0.5, 0.22, 0.35, 0x8a5a2e, -0.35, 0.2, -0.35)); p.push(P(TorusG(0.13, 0.03, 6, 14), 0x5a3a20, -0.35, 0.14, -0.1));
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
      p.push(P(TorusG(0.12, 0.035, 6, 14), 0xd8c28a, -0.1, 0.62, -0.35, Math.PI / 2));
      p.push(box(0.12, 0.09, 0.18, 0x55555f, 0.3, 0.63, -0.35));
      break;
    }
    case 'bighouse': {
      // The Bada Ghar: a timber-framed long house on a stone plinth. Cream plaster between dark posts and
      // rails, a terracotta tile roof with deep eaves and a ridge, gable ends, and a pillared veranda.
      p.push(box(3.95, 0.18, 1.95, 0xa8998a, 0, 0, 0));                                  // stone plinth
      for (let i = 0; i < 8; i++) p.push(box(0.46, 0.04, 0.1, i % 2 ? 0x968878 : 0xb5a796, -1.72 + i * 0.49, 0.18, 0.92)); // its edge stones
      p.push(box(3.5, 1.02, 1.35, 0xf0e2c4, 0, 0.18, -0.1));                             // plaster walls
      p.push(box(3.54, 0.16, 1.39, 0xb0482c, 0, 0.18, -0.1));                            // red-oxide skirting
      // the timber frame on the front: posts, a mid rail and a head beam
      for (let i = 0; i < 7; i++) p.push(box(0.1, 1.02, 0.06, C.wood, -1.7 + i * 0.567, 0.18, 0.59));
      p.push(box(3.56, 0.08, 0.07, C.wood, 0, 0.62, 0.6)); p.push(box(3.6, 0.12, 0.09, C.wood, 0, 1.12, 0.6));
      for (const sx of [-1.75, 1.75]) p.push(box(0.12, 1.02, 1.4, C.wood, sx, 0.18, -0.1)); // corner posts
      // two doors under marigold torans, and a shuttered window between them
      for (const sx of [-0.85, 0.85]) {
        p.push(box(0.4, 0.66, 0.08, C.dark, sx, 0.18, 0.6)); p.push(box(0.5, 0.08, 0.1, C.woodL, sx, 0.84, 0.62));
        for (let i = 0; i < 6; i++) p.push(P(new THREE.OctahedronGeometry(0.032, 0), i % 2 ? C.saffron : C.marigold, sx - 0.18 + i * 0.072, 0.8 - (i % 2) * 0.03, 0.66));
      }
      p.push(box(0.36, 0.26, 0.06, C.dark, 0, 0.68, 0.6)); for (const sx of [-0.21, 0.21]) p.push(box(0.1, 0.3, 0.05, 0x3f7a8a, sx, 0.66, 0.64)); // window and its open shutters
      // tile roof: two broad slopes with deep eaves, a row of tile ridges on each, a ridge beam, gable ends
      const rh = 1.24, slope = 0.5, half = 1.12;
      for (const s of [-1, 1]) {
        p.push(boxC(4.2, 0.09, half * 2 / Math.cos(slope) * 0.56, C.tile, 0, rh + 0.36, -0.1 + s * 0.56, s * slope, 0, 0));
        for (let i = 0; i < 4; i++) p.push(boxC(4.22, 0.05, 0.07, 0x8a3a22, 0, rh + 0.13 + i * 0.13 + 0.06, -0.1 + s * (1.02 - i * 0.24), s * slope, 0, 0));
      }
      p.push(boxC(4.3, 0.12, 0.14, 0x7a3220, 0, rh + 0.66, -0.1));
      for (const sx of [-1.96, 1.96]) p.push(P(new THREE.CylinderGeometry(0.74, 0.74, 0.08, 3, 1, false, Math.PI / 2), 0xe6d6b8, sx, 1.46, -0.1, 0, 0, Math.PI / 2, 0.6, 1, 1.25)); // gable triangles (apex up)
      // the veranda: four turned posts on stone footings and a lean-to beam
      for (const sx of [-1.7, -0.55, 0.55, 1.7]) { p.push(box(0.11, 0.98, 0.11, C.woodL, sx, 0.18, 0.84)); p.push(box(0.18, 0.08, 0.18, 0xb5a796, sx, 0.16, 0.84)); p.push(box(0.22, 0.06, 0.16, C.wood, sx, 1.1, 0.84)); }
      p.push(box(3.66, 0.1, 0.12, C.wood, 0, 1.14, 0.84));
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
    case 'haveli': {
      // Four huts grown into a haveli: four sandstone wings round an open courtyard on a stone plinth, flat roof
      // terraces with parapets, an upper storey with a jharokha balcony over the gate, chhatri kiosks at the
      // back corners, blue-painted shutters, and a tulsi chaura in the courtyard.
      const O = 1.72, I = 0.62, y0 = 0.2, h1 = 1.12, wall = 0xe9c99a, band = 0xb0482c, blue = 0x3f7a9a;
      p.push(box(3.96, y0, 3.96, 0xa8998a, 0, 0, 0));
      for (const [x0, x1, z0, z1] of [[-O, O, I, O], [-O, O, -O, -I], [-O, -I, -I, I], [I, O, -I, I]]) { // the four wings
        const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        p.push(box(w, h1, d, wall, cx, y0, cz));
        p.push(box(w + 0.04, 0.14, d + 0.04, band, cx, y0, cz));                         // red-oxide skirting
        p.push(box(w + 0.1, 0.08, d + 0.1, 0xd4b080, cx, y0 + h1, cz));                 // roof slab with a drip edge
      }
      const parapet = (x0, x1, z0, z1, y) => { for (const [a, b, c, e] of [[x0, x1, z0, z0], [x0, x1, z1, z1], [x0, x0, z0, z1], [x1, x1, z0, z1]]) p.push(box(Math.max(0.08, b - a), 0.16, Math.max(0.08, e - c), 0xf0d8a8, (a + b) / 2, y, (c + e) / 2)); };
      parapet(-O - 0.03, O + 0.03, -O - 0.03, O + 0.03, y0 + h1 + 0.08); parapet(-I, I, -I, I, y0 + h1 + 0.08);
      // the courtyard: flagstones, a tulsi chaura, a charpai
      p.push(box(I * 2, 0.03, I * 2, 0xc8baa0, 0, y0, 0));
      p.push(box(0.26, 0.24, 0.26, 0xe8dcc6, 0, y0, 0)); p.push(box(0.3, 0.04, 0.3, C.red, 0, y0 + 0.24, 0)); p.push(P(new THREE.IcosahedronGeometry(0.11, 0), 0x3f8a3a, 0, y0 + 0.38, 0, 0, 0, 0, 1, 1.25, 1));
      p.push(box(0.7, 0.05, 0.36, 0x8a5a2e, -0.2, y0 + 0.22, -0.4)); p.push(box(0.64, 0.025, 0.3, 0xe8dcc0, -0.2, y0 + 0.27, -0.4));
      // the gate under a carved lintel and a marigold toran, windows with blue shutters all round
      p.push(box(0.62, 0.84, 0.06, C.dark, 0, y0, O + 0.01)); p.push(box(0.1, 0.92, 0.12, C.wood, -0.36, y0, O + 0.02)); p.push(box(0.1, 0.92, 0.12, C.wood, 0.36, y0, O + 0.02)); p.push(box(0.84, 0.12, 0.14, C.woodL, 0, y0 + 0.9, O + 0.02));
      for (let i = 0; i < 9; i++) p.push(P(new THREE.OctahedronGeometry(0.034, 0), i % 2 ? C.saffron : C.marigold, -0.32 + i * 0.08, y0 + 0.86 - (i % 2) * 0.03, O + 0.1));
      for (const s of [-1, 1]) for (const k of [-1, 1]) {
        p.push(box(0.26, 0.3, 0.05, C.dark, k * 1.1, y0 + 0.42, s * (O + 0.005))); for (const e of [-1, 1]) p.push(box(0.09, 0.32, 0.04, blue, k * 1.1 + e * 0.19, y0 + 0.41, s * (O + 0.03)));
        p.push(box(0.05, 0.3, 0.26, C.dark, s * (O + 0.005), y0 + 0.42, k * 1.1)); for (const e of [-1, 1]) p.push(box(0.04, 0.32, 0.09, blue, s * (O + 0.03), y0 + 0.41, k * 1.1 + e * 0.19));
      }
      // the upper storey on the front wing, its jharokha balcony and a scalloped chhajja
      const y1 = y0 + h1 + 0.08;
      p.push(box(2.3, 0.82, O - I - 0.1, 0xf2e4c6, 0, y1, (O + I) / 2)); p.push(box(2.36, 0.08, O - I - 0.04, 0xd4b080, 0, y1 + 0.82, (O + I) / 2));
      parapet(-1.18, 1.18, I + 0.02, O - 0.08, y1 + 0.9);
      p.push(box(0.7, 0.5, 0.26, 0xf6ead0, 0, y1 + 0.16, O + 0.06)); p.push(box(0.76, 0.06, 0.32, 0xd4b080, 0, y1 + 0.66, O + 0.06)); p.push(box(0.44, 0.3, 0.05, C.dark, 0, y1 + 0.26, O + 0.2));
      p.push(P(new THREE.SphereGeometry(0.2, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xf6ead0, 0, y1 + 0.72, O + 0.06));
      for (const sx of [-0.8, 0.8]) { p.push(box(0.24, 0.28, 0.05, C.dark, sx, y1 + 0.3, O - 0.07)); p.push(box(0.32, 0.05, 0.12, 0xd4b080, sx, y1 + 0.6, O - 0.02)); }
      // chhatris: four posts and a little dome on each back corner of the terrace
      for (const sx of [-1, 1]) {
        const cx = sx * 1.3, cz = -1.3, cy = y0 + h1 + 0.08;
        for (const [a, b] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) p.push(box(0.06, 0.5, 0.06, 0xf0d8a8, cx + a, cy, cz + b));
        p.push(box(0.46, 0.06, 0.46, 0xd4b080, cx, cy + 0.5, cz));
        p.push(P(new THREE.SphereGeometry(0.22, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0xf6ead0, cx, cy + 0.56, cz));
        p.push(P(new THREE.ConeGeometry(0.04, 0.16, 4), C.gold, cx, cy + 0.86, cz));
      }
      const f = flag(C.saffron, 0.5, 0.32); f.position.set(-1.3, y0 + h1 + 1.5, -1.3); g.add(f); ud.flags.push(f);
      p.push(P(new THREE.CylinderGeometry(0.02, 0.025, 0.58, 4), C.bamboo, -1.3, y0 + h1 + 1.2, -1.3));
      ud.lights.push({ x: 0, y: 0.6, z: O + 0.3, r: 3.4, c: 0xffb060 }, { x: 0, y: 0.6, z: 0, r: 3, c: 0xffb060 });
      break;
    }
    case 'vishalkhet': {
      // Four fields made one: furrowed earth in four quarters, a stone-lined irrigation channel of water
      // across the middle fed by a well with a rahat (Persian wheel), bunds round the edge, two scarecrows.
      p.push(box(5.85, 0.1, 5.85, C.soil, 0, 0, 0));
      for (const s of [-1, 1]) { p.push(box(5.95, 0.16, 0.12, 0x7a5233, 0, 0, s * 2.92)); p.push(box(0.12, 0.16, 5.95, 0x7a5233, s * 2.92, 0, 0)); }
      for (let i = -5; i <= 5; i++) if (Math.abs(i) > 0) p.push(box(5.6, 0.04, 0.12, 0x4a2e1a, 0, 0.1, i * 0.52));
      p.push(box(5.8, 0.06, 0.34, 0x8f8a80, 0, 0.08, 0)); p.push(box(5.8, 0.02, 0.22, 0x4fb4c8, 0, 0.13, 0)); // the channel
      p.push(box(0.12, 0.12, 5.8, 0x6a4628, 0, 0.1, 0));
      // the well and its wheel at one end of the channel
      p.push(P(new THREE.CylinderGeometry(0.34, 0.36, 0.34, 8), 0xa8a296, 2.45, 0.27, 0)); p.push(P(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 8), 0x3f8fae, 2.45, 0.44, 0));
      p.push(P(new THREE.TorusGeometry(0.32, 0.035, 4, 10), 0x8a5a2e, 2.45, 0.62, 0, 0, Math.PI / 2, 0));
      for (const sz of [-0.3, 0.3]) p.push(box(0.06, 0.62, 0.06, C.wood, 2.45, 0.1, sz));
      for (const fx of [-2.6, 2.6]) {
        const fz = fx < 0 ? -2.55 : 2.55;
        p.push(cyl(0.03, 0.03, 1.2, 8, C.wood, fx, 0, fz)); p.push(box(0.6, 0.04, 0.04, C.wood, fx, 0.85, fz));
        p.push(box(0.26, 0.3, 0.14, fx < 0 ? C.red : 0x2a9d6f, fx, 0.62, fz)); p.push(sph(0.12, C.brick, fx, 1.12, fz)); p.push(cone(0.18, 0.12, 6, C.thatch, fx, 1.2, fz));
      }
      const cp = [];
      for (let i = -5; i <= 5; i++) { if (i === 0) continue; for (let j = -5; j <= 4; j++) cp.push(cone(0.13, 0.55, 4, 0xffffff, j * 0.5 + (i % 2) * 0.1 + 0.05, 0, i * 0.52 + 0.04)); }
      addPiles(g, [['food', -2.55, 0.1, 2.55, 0.62, 0.6]]);
      const crops = new THREE.Mesh(merge(cp), surfaceMat({ vertexColors: true, color: 0x7fbf3f }));
      crops.position.y = 0.1; crops.castShadow = true;
      g.add(crops); ud.crops = crops;
      break;
    }
    case 'fishhut': {
      // A fisher's hut on stilts at the water's edge (it faces its pond, +z): woven bamboo walls under a
      // thatched gable, a plank jetty out over the water with a little boat tied to it, nets drying on poles
      // and fish on a rack.
      for (const [sx, sz] of [[-0.55, -0.45], [0.55, -0.45], [-0.55, 0.45], [0.55, 0.45]]) p.push(box(0.09, 0.36, 0.09, C.wood, sx, 0, sz));
      p.push(box(1.36, 0.08, 1.16, 0x9a6a3a, 0, 0.34, 0));                                    // the floor
      for (let i = 0; i < 6; i++) p.push(box(1.36, 0.012, 0.16, i % 2 ? 0x8a5a2e : 0xa87a46, 0, 0.42, -0.48 + i * 0.19));
      p.push(box(1.1, 0.72, 0.9, C.bamboo, 0, 0.42, -0.06));                                  // woven walls
      for (let i = 0; i < 6; i++) p.push(box(1.12, 0.03, 0.92, C.bambooD, 0, 0.5 + i * 0.12, -0.06));
      p.push(box(0.32, 0.54, 0.05, C.dark, 0, 0.42, 0.4));
      for (const s of [-1, 1]) p.push(boxC(1.42, 0.07, 0.78, C.thatch, 0, 1.35, -0.06 + s * 0.3, s * 0.62, 0, 0)); // thatched gable
      p.push(boxC(1.46, 0.1, 0.1, C.thatchD, 0, 1.6, -0.06));
      for (const sx of [-0.62, 0.62]) p.push(P(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 3, 1, false, Math.PI / 2), 0xd8c4a0, sx, 1.27, -0.06, 0, 0, Math.PI / 2, 0.55, 1, 1.05));
      // the jetty, out over the water, and the boat
      for (let i = 0; i < 7; i++) p.push(box(0.54, 0.04, 0.17, i % 2 ? 0x9a6a3a : 0x8a5a2e, 0, 0.24, 0.62 + i * 0.19));
      for (const sx of [-0.25, 0.25]) for (const sz of [0.9, 1.75]) p.push(box(0.06, 0.6, 0.06, C.wood, sx, -0.36, sz));
      p.push(P(new THREE.CylinderGeometry(0.24, 0.24, 1.1, 6, 1, false, Math.PI / 2, Math.PI), 0x7a4b26, 0.62, 0.0, 1.65, Math.PI / 2, 0, 0, 1, 1, 0.55));
      p.push(box(0.36, 0.03, 0.9, 0x9a6a3a, 0.62, -0.02, 1.65));
      p.push(P(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 3), C.bamboo, 0.64, 0.12, 1.65, 0.3, 0, 0.2));
      // nets on poles, fish drying on a rack, a basket
      for (const sx of [-0.9, -0.45]) p.push(box(0.04, 1.0, 0.04, C.bamboo, sx, 0, 0.75));
      p.push(boxC(0.46, 0.55, 0.015, 0x5a5048, -0.675, 0.66, 0.75)); for (let i = 0; i < 4; i++) p.push(boxC(0.48, 0.012, 0.02, 0x3a3430, -0.675, 0.42 + i * 0.15, 0.76));
      p.push(boxC(0.02, 0.6, 0.02, C.wood, 0.9, 0.3, -0.75)); p.push(boxC(0.02, 0.6, 0.02, C.wood, 0.9, 0.3, -0.25)); p.push(boxC(0.02, 0.02, 0.56, C.wood, 0.9, 0.58, -0.5));
      for (let i = 0; i < 4; i++) p.push(P(new THREE.OctahedronGeometry(0.05, 0), 0xc8d4dc, 0.9, 0.48, -0.7 + i * 0.13, 0, 0, 0, 0.5, 1.5, 0.7));
      p.push(P(new THREE.CylinderGeometry(0.14, 0.1, 0.16, 6), C.bamboo, -0.85, 0, -0.65));
      ud.lights.push({ x: 0, y: 0.7, z: 0.6, r: 3, c: 0xffb060 });
      break;
    }
    case 'hut': {
      // A square village cottage that fits its plot (nothing reaches past it, so neighbours never clash):
      // mud walls between chunky corner posts on a stone plinth, a steep hipped thatch roof with a ragged
      // eave, a timber door under a marigold toran. Level 2 adds a porch; level 3 is lime-washed with a
      // red-oxide skirting.
      const limed = level >= 3, Q4 = Math.PI / 4;
      const sq = (rt, rb, h, c, y) => p.push(P(new THREE.CylinderGeometry(rt, rb, h, 4), c, 0, y + h / 2, 0, 0, Q4, 0)); // square frustum: half-width = r × 0.707
      p.push(box(1.36, 0.14, 1.32, 0xa08a6e, 0, 0, 0));                                        // plinth
      for (let i = 0; i < 4; i++) p.push(box(0.32, 0.03, 0.08, i % 2 ? 0x968878 : 0xb5a796, -0.5 + i * 0.33, 0.14, 0.62)); // its edge stones
      p.push(box(1.1, 0.82, 1.04, limed ? 0xf0e4c8 : C.mud, 0, 0.14, 0));                    // walls
      p.push(box(1.12, limed ? 0.2 : 0.06, 1.06, limed ? 0xb0482c : C.white, 0, limed ? 0.14 : 0.32, 0));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.11, 0.84, 0.11, C.wood, sx * 0.55, 0.14, sz * 0.52)); // corner posts
      p.push(box(1.2, 0.08, 1.14, C.wood, 0, 0.94, 0));                                         // wall plate
      // door: a dark opening in a chunky frame, a marigold toran, a mud step
      p.push(box(0.38, 0.62, 0.06, C.dark, 0, 0.14, 0.52));
      p.push(box(0.08, 0.66, 0.1, C.woodL, -0.23, 0.14, 0.53)); p.push(box(0.08, 0.66, 0.1, C.woodL, 0.23, 0.14, 0.53)); p.push(box(0.58, 0.09, 0.11, C.wood, 0, 0.78, 0.53));
      for (let i = 0; i < 7; i++) p.push(P(new THREE.OctahedronGeometry(0.034, 0), i % 2 ? C.saffron : C.marigold, -0.21 + i * 0.07, 0.74 - (i % 2) * 0.03, 0.6));
      p.push(box(0.6, 0.07, 0.22, 0xa08a6e, 0, 0, 0.74));
      // a barred window in the east wall, dung cakes drying on the west, red chillies by the door
      p.push(box(0.05, 0.24, 0.3, C.dark, 0.555, 0.42, 0)); p.push(box(0.08, 0.05, 0.38, C.wood, 0.57, 0.38, 0)); p.push(box(0.08, 0.05, 0.38, C.wood, 0.57, 0.66, 0));
      for (const z of [-0.075, 0, 0.075]) p.push(box(0.03, 0.24, 0.025, C.wood, 0.575, 0.42, z));
      for (let i = 0; i < 6; i++) p.push(P(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 6), 0x6e5238, -0.565, 0.36 + Math.floor(i / 3) * 0.2, -0.24 + (i % 3) * 0.2, 0, 0, Math.PI / 2));
      for (let i = 0; i < 5; i++) p.push(coneC(0.024, 0.09, 4, C.red, 0.34, 0.86 - i * 0.07, 0.56, Math.PI));
      // roof: a ragged eave lip, the lower thatch slope, a rope tie, the steep top and a clay kalash
      sq(1.17, 1.2, 0.08, C.thatchD, 0.94);
      sq(0.62, 1.16, 0.6, C.thatch, 1.0);
      sq(0.65, 0.65, 0.05, C.thatchD, 1.57);
      p.push(P(new THREE.ConeGeometry(0.66, 0.58, 4), varyHex(C.thatch, 4, 0.03), 0, 1.61 + 0.29, 0, 0, Q4, 0));
      p.push(P(new THREE.CylinderGeometry(0.025, 0.035, 0.16, 4), C.wood, 0, 2.18, 0));
      p.push(P(new THREE.OctahedronGeometry(0.08, 0), C.brick, 0, 2.3, 0, 0, Q4, 0, 1, 1.25, 1));
      if (level >= 2) { // a timber porch under the eave: two posts and a lintel
        for (const sx of [-0.42, 0.42]) { p.push(box(0.09, 0.8, 0.09, C.woodL, sx, 0.14, 0.76)); p.push(box(0.14, 0.05, 0.14, 0xa08a6e, sx, 0.09, 0.76)); }
        p.push(box(0.96, 0.08, 0.1, C.wood, 0, 0.9, 0.76));
      }
      // matkas by the side wall
      p.push(P(new THREE.OctahedronGeometry(0.13, 0), C.brick, 0.7, 0.13, -0.3, 0, 0.4, 0, 1, 0.9, 1));
      p.push(P(new THREE.OctahedronGeometry(0.09, 0), C.brickD, 0.72, 0.09, -0.52, 0, 0.2, 0, 1, 0.9, 1));
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
        const lamp = glowMesh(SphG(0.055, 8, 6), 0xffc060); lamp.position.set(0.12, y0 + 1.0, 0.74); g.add(lamp); ud.flames.push(lamp);
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
    case 'akhara': { // a 4×4 wrestling ground: a sunken pit of soft red earth, a mallakhamb, a Hanuman shrine, weights and a weapon rack
      p.push(box(3.9, 0.08, 3.9, C.mudD, 0, 0, 0));
      p.push(box(3.3, 0.1, 3.3, 0xb8643c, 0, 0.02, 0.1)); // the pit
      for (let i = 0; i < 14; i++) p.push(sph(0.08, 0xa8583a, -1.5 + (i * 0.23), 0.1, 0.1 + Math.sin(i * 1.7) * 1.4, 1.6, 0.25, 1.2)); // raked furrows
      for (const s of [-1, 1]) { p.push(box(3.4, 0.2, 0.12, C.wood, 0, 0, 0.1 + s * 1.68)); p.push(box(0.12, 0.2, 3.4, C.wood, s * 1.68, 0, 0.1)); } // log rim
      // mallakhamb: the polished wrestling pole, in the back corner
      p.push(cyl(0.07, 0.11, 1.8, 10, C.woodL, -1.65, 0.08, -1.65)); p.push(sph(0.1, C.woodL, -1.65, 1.96, -1.65)); p.push(cyl(0.05, 0.07, 0.12, 8, C.woodL, -1.65, 1.82, -1.65));
      // a small Hanuman shrine: saffron niche with a flag
      p.push(box(0.5, 0.5, 0.36, 0xd9582c, 1.55, 0.08, -1.7)); p.push(box(0.3, 0.3, 0.05, 0x7a2a10, 1.55, 0.18, -1.51)); p.push(cone(0.36, 0.3, 4, 0xe86f2a, 1.55, 0.58, -1.7, 0, Math.PI / 4));
      p.push(sph(0.08, 0xff7a1f, 1.55, 0.3, -1.55)); p.push(cyl(0.02, 0.025, 1.6, 5, C.bamboo, 1.85, 0.08, -1.85));
      const f = flag(C.saffron, 0.55, 0.38); f.position.set(1.85, 1.68, -1.85); g.add(f); ud.flags.push(f);
      // jodi clubs and gada weights by the side, a rack of wooden training swords and shields
      for (const x of [-0.8, -0.55]) { p.push(cyl(0.025, 0.03, 0.55, 6, C.wood, x, 0.08, -1.82)); p.push(sph(0.12, 0x8a5a2e, x, 0.2, -1.82, 1, 1.3, 1)); }
      for (const x of [0.2, 0.5]) { p.push(cyl(0.02, 0.02, 0.45, 5, C.wood, x, 0.08, -1.84)); p.push(sph(0.11, C.gold, x, 0.55, -1.84)); }
      for (const sz of [-0.9, 0.3]) p.push(cyl(0.03, 0.03, 0.9, 5, C.wood, -1.86, 0.08, sz));
      p.push(boxC(0.05, 0.05, 1.25, C.wood, -1.86, 0.82, -0.3));
      for (let k = 0; k < 4; k++) p.push(boxC(0.03, 0.55, 0.06, 0xc89a5e, -1.82, 0.5, -0.75 + k * 0.3, 0, 0, 0.05));
      p.push(cylC(0.16, 0.16, 0.03, 14, 0xd4a234, -1.8, 0.35, 0.55, 0, 0, Math.PI / 2));
      p.push(box(1.0, 0.18, 0.28, C.woodL, 0.6, 0.08, 1.8)); // a bench for those waiting their turn
      const f2 = flag(C.red, 0.4, 0.28); p.push(cyl(0.02, 0.025, 2.3, 5, C.bamboo, 1.85, 0.08, 1.85)); f2.position.set(1.85, 2.38, 1.85); g.add(f2); ud.flags.push(f2);
      break;
    }
    case 'range': { // a 4×3 archery ground: a thatched firing shelter, a lane of three straw targets, quivers and a bow rack
      p.push(box(3.9, 0.06, 2.9, 0x9a7a4a, 0, 0, 0));
      p.push(box(3.0, 0.02, 2.6, 0xa88a58, 0.25, 0.06, 0)); // the lane, swept clean
      for (let i = 0; i < 3; i++) p.push(box(0.04, 0.025, 2.4, 0xf4ecd8, -1.25 + i * 1.2, 0.07, 0)); // chalk distance marks
      for (const sx of [-1.85, -1.1]) for (const sz of [-1.3, 1.3]) p.push(cyl(0.04, 0.05, 1.3, 5, C.wood, sx, 0, sz));
      p.push(boxC(1.0, 0.07, 2.9, C.thatch, -1.48, 1.38, 0, 0, 0, 0.32));
      p.push(box(0.5, 0.32, 0.4, C.thatch, -1.7, 0, -0.9)); // straw bales
      for (const z of [-0.2, 0.8]) { // quivers full of arrows
        p.push(cyl(0.1, 0.08, 0.35, 8, C.brick, -1.75, 0.06, z));
        for (let i = 0; i < 4; i++) p.push(cylC(0.012, 0.012, 0.5, 3, 0xc89a5e, -1.78 + i * 0.02, 0.55, z, 0.1 * (i - 1.5), 0, 0.12 * (i - 1.5)));
      }
      const tg = [[0.4, 0xe9dcb8], [0.32, C.red], [0.21, 0xf4ecd8], [0.11, C.gold]];
      for (const z of [-0.9, 0, 0.9]) { // three targets on stands
        for (const dz of [-0.28, 0.28]) p.push(cyl(0.03, 0.035, 0.85, 5, C.wood, 1.68, 0.06, z + dz));
        tg.forEach(([r, c], i) => p.push(cylC(r, r, 0.08 + i * 0.02, 14, c, 1.62, 0.95, z, 0, 0, Math.PI / 2)));
      }
      break;
    }
    case 'path': { // one cell of beaten earth with pebbles (the renderer draws laid paths as one joined network)
      p.push(box(0.98, 0.025, 0.98, 0xb08a5a, 0, 0, 0)); p.push(box(0.58, 0.006, 0.58, 0xa07a4c, 0, 0.025, 0));
      for (let i = 0; i < 4; i++) p.push(sph(0.05, i % 2 ? 0x9a958c : 0xb0aa9e, -0.45 + i * 0.3, 0.02, 0.46, 1.2, 0.6, 1));
      break;
    }
    case 'road': { // one cell of brick road between stone kerbs
      p.push(box(0.98, 0.035, 0.98, 0x8a4228, 0, 0, 0));
      for (let r = 0; r < 4; r++) (r % 2 ? [[-0.37, 0.2], [0, 0.46], [0.37, 0.2]] : [[-0.245, 0.46], [0.245, 0.46]]).forEach(([w, len], i) => p.push(box(0.2, 0.014, len, [0xb5532f, 0xa84a2c, 0xc2603a][(r + i) % 3], -0.37 + r * 0.245, 0.035, w)));
      for (const sx of [-1, 1]) p.push(box(0.08, 0.07, 0.98, 0x9a958c, sx * 0.45, 0, 0));
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
          const fl = glowMesh(ConeG(0.035, 0.1, 4), 0xffcc33);
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
      for (let i = 0; i < 3; i++) p.push(P(TorusG(0.3, 0.015, 5, 12, Math.PI * 0.9), 0x8a5a2e, 0.85 + i * 0.12, 0.85, -0.55, 0, Math.PI / 2, Math.PI * 0.55));
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
      bell.add(meshOf([P(LatheG(prof, 16), 0xd4a234, 0, 0, 0), sph(0.07, 0x8a6a22, 0, -0.72, 0), P(TorusG(0.33, 0.02, 6, 18), 0xfff0a0, 0, -0.66, 0, Math.PI / 2)]));
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
      gun.add(meshOf([box(0.5, 0.2, 0.6, 0x6b4223, 0, 0, 0), P(TorusG(0.16, 0.05, 6, 14), 0x4a3020, -0.27, 0.12, 0, 0, Math.PI / 2, 0), P(TorusG(0.16, 0.05, 6, 14), 0x4a3020, 0.27, 0.12, 0, 0, Math.PI / 2, 0),
        cylC(0.13, 0.17, 0.95, 14, 0x3a3a42, 0, 0.32, 0.25, Math.PI / 2 - 0.15), P(TorusG(0.15, 0.03, 6, 14), C.gold, 0, 0.38, 0.66, -0.15), sph(0.16, 0x3a3a42, 0, 0.27, -0.2)]));
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
      p.push(P(SphG(0.78, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0xf0cf9a, 0, 4.08, 0));
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
      p.push(P(LatheG(pts, 4), 0xe8d4ae, 0, 1.68, -0.3, 0, Math.PI / 4));
      p.push(P(LatheG(pts.map((v) => new THREE.Vector2(v.x * 0.55, v.y * 0.55)), 4), 0xd4bc92, 0.62, 1.68, -0.3 + 0.0, 0, Math.PI / 4));
      p.push(P(LatheG(pts.map((v) => new THREE.Vector2(v.x * 0.55, v.y * 0.55)), 4), 0xd4bc92, -0.62, 1.68, -0.3, 0, Math.PI / 4));
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
      const diya = glowMesh(ConeG(0.05, 0.14, 4), 0xffe066); diya.position.set(0, 0.55, 0.45); g.add(diya); ud.flames.push(diya);
      ud.lights.push({ x: 0, y: 0.8, z: 1.0, r: 5, c: 0xffc070, always: true });
      break;
    }
    case 'claypit': { // a pit of wet clay with a raised rim, a puddle, a spade, drying clay blocks and a little shade
      p.push(cyl(0.78, 0.82, 0.05, 20, 0x5e341d, -0.15, 0, -0.1)); // the wet floor of the pit
      p.push(P(TorusG(0.8, 0.12, 6, 22), 0x8c5a34, -0.15, 0.05, -0.1, Math.PI / 2, 0, 0, 1, 1, 0.6)); // dug-out rim
      p.push(cyl(0.28, 0.3, 0.012, 16, 0x6f9fb0, -0.35, 0.05, -0.25)); // rain puddle
      for (const [x, z, r] of [[0.15, -0.3, 0.16], [0.05, 0.15, 0.13], [-0.45, 0.2, 0.12]]) p.push(sph(r, 0xa8603a, x, 0.06, z, 1.2, 0.55, 1)); // wet lumps
      p.push(sph(0.32, 0x9c5530, 0.62, 0.02, -0.55, 1.1, 0.6, 0.9)); // the spoil heap
      for (let i = 0; i < 6; i++) p.push(box(0.16, 0.08, 0.1, i % 2 ? 0xb5703f : 0xc27e4c, -0.75 + (i % 3) * 0.2, (i > 2 ? 0.08 : 0), 0.78)); // clay blocks drying
      p.push(cylC(0.022, 0.026, 0.7, 6, C.wood, 0.42, 0.42, 0.05, 0.25, 0, -0.3)); p.push(boxC(0.16, 0.2, 0.03, 0x8d939a, 0.5, 0.1, 0.0, 0.25, 0, -0.3)); // spade
      p.push(sph(0.12, C.brick, -0.82, 0.12, -0.75)); p.push(cyl(0.05, 0.07, 0.05, 10, C.brickD, -0.82, 0.22, -0.75)); // water matka
      for (const sx of [-0.9, -0.3]) p.push(cyl(0.025, 0.03, 1.0, 6, C.bamboo, sx, 0, -0.92));
      p.push(boxC(0.8, 0.05, 0.42, C.thatch, -0.6, 0.98, -0.78, -0.35));
      addPiles(g, [['clay', 0.55, 0, 0.45, 0.55, 0.3]]);
      break;
    }
    case 'kiln': { // Eent Bhatta: a brick firing chamber with glowing mouths, a tall banded chimney, green bricks drying
      p.push(box(1.9, 0.08, 1.8, C.mudD, 0, 0, 0));
      p.push(box(1.5, 0.9, 1.15, 0xa84a2c, 0, 0.08, -0.25));
      for (let i = 1; i < 6; i++) p.push(box(1.52, 0.018, 1.17, 0x7a3420, 0, 0.08 + i * 0.15, -0.25)); // courses of brick
      p.push(boxC(1.56, 0.08, 1.21, 0x8a3a22, 0, 1.02, -0.25));
      for (const sx of [-0.38, 0.38]) { // arched firing mouths
        p.push(box(0.36, 0.38, 0.06, 0x2a1810, sx, 0.08, 0.33));
        p.push(P(CylG(0.18, 0.18, 0.06, 12, 1, false, 0, Math.PI), 0x2a1810, sx, 0.46, 0.33, Math.PI / 2, 0, Math.PI / 2));
        const fl = glowMesh(new THREE.PlaneGeometry(0.28, 0.3), 0xff7a30, 0.9); fl.position.set(sx, 0.26, 0.37); g.add(fl); ud.flames.push(fl);
      }
      // the chimney: tapering, with dark bands, set at the back corner
      p.push(cyl(0.2, 0.3, 2.0, 14, 0xb5532f, 0.55, 1.0, -0.5));
      for (let i = 0; i < 4; i++) p.push(cyl(0.29 - i * 0.025, 0.29 - i * 0.025, 0.06, 14, 0x7a3420, 0.55, 1.15 + i * 0.5, -0.5));
      p.push(cyl(0.23, 0.21, 0.08, 14, 0x5a2a18, 0.55, 2.98, -0.5));
      // green (unfired) bricks drying in a lattice on the left, fired ones and charcoal on the right
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) p.push(box(r % 2 ? 0.08 : 0.2, 0.07, r % 2 ? 0.2 : 0.08, 0x9c7a5a, -0.75 + (r % 2 ? k * 0.1 : 0.05), 0.08 + r * 0.07, 0.55 + (r % 2 ? 0.05 : k * 0.1)));
      addPiles(g, [['brick', -0.2, 0.08, 0.62, 0.42, 0], ['charcoal', 0.58, 0.08, 0.6, 0.4, 0.3]]);
      ud.lights.push({ x: 0, y: 0.4, z: 0.7, r: 3.4, c: 0xff7a30, active: true });
      break;
    }
    case 'smelter': { // Loha Bhatti: a clay shaft furnace bound with straw rope, a glowing tuyere, two leather bellows
      p.push(box(1.9, 0.08, 1.8, C.mudD, 0, 0, 0));
      p.push(cyl(0.3, 0.58, 1.75, 16, 0x9c5a38, -0.1, 0.08, -0.15));
      for (let i = 0; i < 3; i++) p.push(P(TorusG(0.52 - i * 0.075, 0.025, 5, 18), 0xc9a040, -0.1, 0.45 + i * 0.45, -0.15, Math.PI / 2));
      p.push(cyl(0.22, 0.24, 0.04, 14, 0x2a1810, -0.1, 1.83, -0.15)); // the mouth at the top
      const glow = glowMesh(new THREE.CircleGeometry(0.11, 12), 0xffa040, 0.95); glow.position.set(-0.1, 0.3, 0.42); g.add(glow); ud.flames.push(glow);
      p.push(cylC(0.05, 0.06, 0.32, 10, 0x7a4630, -0.1, 0.3, 0.3, Math.PI / 2)); // clay tuyere pipe
      for (const sx of [-0.55, 0.35]) { // goatskin bellows on either side, each with a stick to pump it
        p.push(sph(0.2, 0x6b4223, sx, 0.2, 0.45, 1.2, 0.55, 1));
        p.push(cylC(0.015, 0.015, 0.5, 6, C.woodL, sx, 0.5, 0.45, 0.3, 0, 0));
      }
      // ore and charcoal waiting, and a stone anvil with tongs
      for (let i = 0; i < 5; i++) p.push(sph(0.1, i % 2 ? 0x8a5040 : 0x7a4636, -0.72 + (i % 3) * 0.13, 0.12 + Math.floor(i / 3) * 0.1, -0.7 + (i % 2) * 0.1, 1, 0.75, 1));
      p.push(cyl(0.2, 0.16, 0.18, 12, 0xb3843c, 0.65, 0.08, -0.65)); p.push(sph(0.17, 0x2e2a2b, 0.65, 0.26, -0.65, 1, 0.5, 1)); // charcoal basket
      p.push(box(0.3, 0.22, 0.22, 0x8d8981, 0.72, 0.08, 0.05)); p.push(cylC(0.012, 0.012, 0.4, 5, 0x3a3a40, 0.72, 0.33, 0.05, 0, 0.4, Math.PI / 2 - 0.1));
      addPiles(g, [['iron', 0.6, 0.08, 0.62, 0.45, 0]]);
      ud.lights.push({ x: -0.1, y: 0.4, z: 0.6, r: 3.2, c: 0xff9040, active: true });
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
  if (ROUND_GARDEN[mt]) squareGarden(p, mt, level);
  addLevelDecor(p, g, ud, type, level);
  if (p.length) g.add(meshOf(p));
  addEmblem(g, type);
  // static building parts get the painted, textured surface
  if (MAT.bld && MAT.bld !== MAT.std) g.traverse((c) => { if (c.isMesh && c.material === MAT.std) c.material = MAT.bld; });
  return g;
};
/*
 * Round buildings sit in a square plot: a round hut, well or tower on a square tile otherwise leaves four
 * bare corners. Each gets a little garden that fills its footprint: grass inside a low kerb, and in the
 * corners a tulsi chaura, marigolds, a vegetable patch or pumpkins (huts), flagstones with pots of
 * flowers and a bucket (the well), or a paved court with clipped shrubs and stone lamps (towers).
 */
const ROUND_GARDEN = { hut: 'home', well: 'well', firetower: 'tower', cannontower: 'tower' };
function squareGarden(p, type, level) {
  const kind = ROUND_GARDEN[type], d = BUILDINGS[type], hw = d.fw / 2 - 0.02, hd = d.fd / 2 - 0.02;
  const paved = kind !== 'home';
  p.push(box(hw * 2, 0.03, hd * 2, paved ? 0xb9ad96 : 0x6f9a45, 0, 0, 0));
  if (paved) { // flagstones in two tones with dark joints
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 2 === 0) p.push(box(0.36, 0.012, 0.36, 0xa89c84, i * 0.38, 0.03, j * 0.38));
  } else for (let i = 0; i < 14; i++) { const a = i * 2.39, r = 1.02 + (i % 3) * 0.1; const x = clamp(Math.cos(a) * r, -0.92, 0.92), z = clamp(Math.sin(a) * r, -0.92, 0.92); p.push(cone(0.022, 0.08, 4, i % 2 ? 0x5e8a3a : 0x7aa64a, x, 0.03, z)); } // tufts
  const kc = kind === 'tower' ? 0x8f8a80 : kind === 'well' ? 0x9a958c : 0x9a6a44;
  for (const s of [-1, 1]) { p.push(box(hw * 2, 0.06, 0.06, kc, 0, 0, s * (hd - 0.03))); p.push(box(0.06, 0.06, hd * 2, kc, s * (hw - 0.03), 0, 0)); }
  const front = level < 3; // at level 3 the upgrade's own tulsi pots take the front corners
  const c = kind === 'home' ? 0.86 : 0.8; // (the cottage's eave reaches 0.85: its garden corners sit just past it)
  const marigold = (x, z) => { p.push(sph(0.1, 0x3f7a32, x, 0.1, z, 1, 0.75, 1)); for (let k = 0; k < 6; k++) { const a = k * 1.05; p.push(sph(0.03, k % 2 ? 0xff9933 : 0xffb31a, x + Math.cos(a) * 0.07, 0.15 + (k % 2) * 0.03, z + Math.sin(a) * 0.07)); } };
  const pot = (x, z, fl) => { p.push(cyl(0.07, 0.05, 0.1, 8, C.brick, x, 0.03, z)); p.push(sph(0.07, 0x3f8a3a, x, 0.17, z, 1, 0.8, 1)); for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.4; p.push(sph(0.022, fl, x + Math.cos(a) * 0.045, 0.21, z + Math.sin(a) * 0.045)); } };
  if (kind === 'home') {
    if (front) { // tulsi chaura on the left of the door, marigolds on the right
      p.push(box(0.2, 0.2, 0.2, 0xe8dcc6, -c - 0.04, 0.03, c + 0.04)); p.push(box(0.23, 0.035, 0.23, C.red, -c - 0.04, 0.23, c + 0.04)); p.push(sph(0.09, 0x3f8a3a, -c - 0.04, 0.34, c + 0.04, 1, 1.25, 1));
      marigold(c + 0.04, c + 0.04);
    }
    for (let k = 0; k < 3; k++) p.push(box(0.36, 0.05, 0.07, C.soil, -c, 0.03, -c + 0.02 - k * 0.1)); // a vegetable patch: three furrows of greens
    for (let k = 0; k < 6; k++) p.push(sph(0.035, k % 2 ? 0x4f9a3c : 0x6aae4a, -c - 0.12 + (k % 3) * 0.12, 0.1, -c + 0.02 - Math.floor(k / 3) * 0.1, 1, 0.8, 1));
    p.push(sph(0.08, 0xd9822b, c, 0.08, -c, 1.1, 0.8, 1.1)); p.push(sph(0.06, 0xc8701f, c - 0.13, 0.065, -c + 0.06, 1.1, 0.8, 1.1)); // pumpkins on the vine
    p.push(P(TorusG(0.08, 0.012, 4, 10, Math.PI * 1.4), 0x4f8a3a, c - 0.05, 0.05, -c + 0.02, Math.PI / 2));
  } else if (kind === 'well') {
    pot(-c, c, 0xff7a9a); pot(c, c, 0xffd84a); pot(-c, -c, 0xffffff);
    p.push(cyl(0.07, 0.06, 0.11, 10, 0x8d939a, c, 0.03, -c)); p.push(P(TorusG(0.065, 0.01, 4, 12), 0x5a5a62, c, 0.14, -c, Math.PI / 2)); // a bucket
    p.push(box(0.08, 0.02, 0.5, 0x7d7464, 0.72, 0.03, 0.15)); // the drain
  } else { // towers: clipped shrubs at the back, stone lamps at the front
    for (const sx of [-1, 1]) { p.push(sph(0.13, 0x3f7a32, sx * c, 0.13, -c, 1, 0.9, 1)); p.push(sph(0.08, 0x4f8a3a, sx * c, 0.27, -c)); }
    if (front) for (const sx of [-1, 1]) { p.push(box(0.12, 0.26, 0.12, 0xb8b2a6, sx * c, 0.03, c)); p.push(box(0.16, 0.04, 0.16, 0x9a958c, sx * c, 0.29, c)); p.push(cyl(0.04, 0.03, 0.04, 8, C.brick, sx * c, 0.33, c)); }
  }
}
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
      const fl = glowMesh(ConeG(0.03, 0.09, 4), 0xffcc33); fl.position.set(sx * (hw - 0.3), kh + 0.08, hd - 0.06); g.add(fl); ud.flames.push(fl);
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
  else if (kind === 'wood') { for (let k = 0; k < 3; k++) p.push(cylC(0.07, 0.07, 0.55, 10, k % 2 ? 0x9a6a3a : 0x8a5a2e, 0, 0.08 + (k === 2 ? 0.12 : 0), -0.07 + (k % 2) * 0.14 - (k === 2 ? 0.07 : 0), 0, 0, Math.PI / 2)); p.push(P(TorusG(0.15, 0.02, 6, 14), 0xd8c28a, 0, 0.12, 0, 0, Math.PI / 2, 0)); glow = 0xffd0a0; }
  else if (kind === 'stone') { p.push(sph(0.16, 0xa8a49c, 0, 0.12, 0, 1, 0.75, 1)); p.push(sph(0.11, 0xc4beb2, 0.16, 0.09, 0.1)); glow = 0xe0e0ff; }
  else if (kind === 'food') { p.push(sph(0.18, 0xd6b47a, 0, 0.16, 0, 1, 1.1, 0.9)); p.push(sph(0.06, 0x9c7b45, 0, 0.36, 0)); p.push(cone(0.03, 0.1, 6, 0xf2d16b, 0.04, 0.38, 0)); glow = 0xfff0a0; }
  else if (kind === 'chest') {
    p.push(box(0.6, 0.32, 0.4, 0x8a5a2e, 0, 0, 0)); p.push(P(CylG(0.2, 0.2, 0.6, 14, 1, false, 0, Math.PI), 0x9a6a3a, 0, 0.32, 0, 0, 0, Math.PI / 2));
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
  if (level >= 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const fl = glowMesh(ConeG(0.06, 0.16, 4), 0xffcc33); fl.position.set(sx * 1.15 * s, 0.56, sz * 1.15 * s); g.add(fl); g.userData.lampFlames.push(fl); }
  const flame = flameCluster(1 + (level - 1) * 0.18);
  flame.position.y = 0.84;
  g.add(flame);
  g.userData.flame = flame;
  return g;
};
Models.diya = function () {
  const g = new THREE.Group();
  g.add(meshOf([cyl(0.09, 0.06, 0.06, 6, C.brick, 0, 0, 0)], null, true));
  const f = glowMesh(ConeG(0.03, 0.09, 4), 0xffcc33);
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
// Low-poly nature: canopies are clusters of faceted, hand-cut gems (icospheres with each corner pushed in or
// out a little), so every leaf mass catches the sun on a few broad planes.
/** Painted foliage: sunlit facets turn warm and light, the ones facing down cool and deep. */
const _fW = new THREE.Color(0xe2d46e), _fC = new THREE.Color(0x173f36);
function shadeFoliage(g, kw, kc) {
  const nor = g.attributes.normal.array, col = g.attributes.color.array;
  kw = kw == null ? 0.13 : kw; kc = kc == null ? 0.5 : kc;
  for (let i = 0; i < col.length; i += 3) {
    const ny = nor[i + 1], T = ny > 0 ? _fW : _fC, t = ny > 0 ? ny * kw : -ny * kc;
    col[i] += (T.r - col[i]) * t; col[i + 1] += (T.g - col[i + 1]) * t; col[i + 2] += (T.b - col[i + 2]) * t;
  }
  return g;
}
/** Same random value for the same corner, whichever face asks: the facets stay closed when corners move. */
function cornerRand(x, y, z, seed) {
  const h = Math.sin(Math.round(x * 997) * 12.9898 + Math.round(y * 997) * 78.233 + Math.round(z * 997) * 37.719 + seed * 4.37) * 43758.5453;
  return h - Math.floor(h);
}
/** A faceted gem: an icosphere (detail 0 = 20 faces, 1 = 80) whose corners are pushed in or out by up to amt. */
function gemGeo(r, detail, seed, amt) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  amt = amt == null ? 0.26 : amt;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (cornerRand(x, y, z, seed) - 0.5) * amt;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}
// leaf masses: 80 facets near the camera, 20 for the distant forest (the same shapes, a quarter of the triangles)
let LEAF_LOD = false;
let _leafSeed = 1;
const leaf = (r, c, x, y, z, sx, sy, sz, ry) => shadeFoliage(P(gemGeo(r, LEAF_LOD || r < 0.32 ? 0 : 1, _leafSeed++), c, x, y, z, 0, ry || 0, 0, sx, sy, sz));
/** A tree. lod = true builds the light version for far away: coarser leaf masses, no fruit or hanging roots. */
Models.treeGeo = function (type, variant, lod) {
  LEAF_LOD = !!lod; _leafSeed = variant * 13 + type.length * 7 + 1;
  try { return buildTreeGeo(type, variant, !!lod); } finally { LEAF_LOD = false; }
};
/** A tapering trunk of a few broad facets, flared at the foot; bend leans it (radians, about z). */
function trunkParts(p, r1, r2, h, c, sides, bend, x, z) {
  const n = 3, segH = h / n;
  let px = x || 0, py = 0;
  for (let i = 0; i < n; i++) {
    const a = (bend || 0) * (i + 0.5) / n, ra = r1 + (r2 - r1) * (i / n), rb = r1 + (r2 - r1) * ((i + 1) / n);
    p.push(P(new THREE.CylinderGeometry(rb, ra * (i === 0 ? 1.25 : 1), segH * 1.04, sides), c, px + Math.sin(a) * segH / 2, py + segH / 2, z || 0, 0, i * 0.7, -a));
    px += Math.sin(a) * segH; py += Math.cos(a) * segH;
  }
  return { x: px, y: py };
}
/** A palm frond: a folded blade (a shallow V in section) that arcs out and droops, pointing along +x before ry. */
function frondGeo(len, w, droop, segs) {
  const v = [];
  const pt = (t, side) => { // side -1 left edge, 0 vein, 1 right edge
    const x = t * len, y = -droop * t * t * len, ww = w * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.35);
    return [x, y - (side ? ww * 0.35 : 0), side * ww];
  };
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    for (const s of [-1, 1]) {
      const a = pt(t0, 0), b = pt(t0, s), c = pt(t1, s), d = pt(t1, 0);
      if (s > 0) v.push(...a, ...b, ...c, ...a, ...c, ...d); else v.push(...a, ...c, ...b, ...a, ...d, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  return g;
}
function buildTreeGeo(type, variant, lod) {
  const rnd = mulberry32(variant * 7919 + type.length * 131);
  // analogous variety: each tree drifts a few degrees of hue and a little lightness from its species colour
  const vr = mulberry32(variant * 31 + type.length * 7 + 5), dh = (vr() - 0.5) * 18, dl = (vr() - 0.5) * 0.08;
  const V = (hex) => varyHex(hex, dh, dl);
  const p = [];
  const bark = 0x7a5232, barkD = 0x5e3e26;
  if (type === 'palm') {
    // a ringed trunk curving up, a crown of drooping fronds, a cluster of coconuts
    const lean = (rnd() - 0.5) * 0.6, n = lod ? 4 : 6, H = 2.6 + rnd() * 0.7;
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const a = (lean * (i + 0.5)) / n, h = H / n, r = 0.13 - i * 0.012;
      p.push(P(new THREE.CylinderGeometry(r * 0.9, r, h * 1.02, lod ? 4 : 5), i % 2 ? 0x9a7650 : 0x86643f, x + (Math.sin(a) * h) / 2, y + h / 2, 0, 0, i * 0.6, -a));
      x += Math.sin(a) * h; y += Math.cos(a) * h * 0.99;
    }
    const nf = lod ? 6 : 8;
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 + rnd() * 0.35, len = 1.25 + rnd() * 0.35;
      const fr = frondGeo(len, 0.2, 0.55 + rnd() * 0.25, lod ? 3 : 5);
      p.push(shadeFoliage(P(fr, V(i % 2 ? 0x5fa63a : 0x74b843), x, y - 0.04, 0, 0, a, 0.25 + rnd() * 0.15), 0.25, 0.4));
    }
    p.push(leaf(0.18, V(0x5f9a3a), x, y, 0, 1, 0.7, 1));
    if (!lod) for (let i = 0; i < 3; i++) p.push(P(new THREE.OctahedronGeometry(0.1, 0), 0x6e4a22, x + Math.cos(i * 2.1) * 0.13, y - 0.13, Math.sin(i * 2.1) * 0.13)); // coconuts
  } else if (type === 'banyan') {
    // a squat, buttressed trunk, two big limbs, a wide flat-topped canopy, aerial roots hanging to the ground
    trunkParts(p, 0.36, 0.26, 1.5, bark, lod ? 5 : 7, 0);
    for (const s of [-1, 1]) p.push(P(new THREE.CylinderGeometry(0.09, 0.15, 1.25, 5), bark, s * 0.46, 1.62, s * 0.12, 0, 0, -s * 0.9));
    const blobs = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + rnd() * 0.5, d = 0.75 + rnd() * 0.45; blobs.push([Math.cos(a) * d * 1.25, 2.1 + rnd() * 0.35, Math.sin(a) * d, 0.75 + rnd() * 0.3]); }
    for (const b of blobs) p.push(leaf(b[3], V(rnd() > 0.5 ? 0x3f9a3e : 0x4aa646), b[0], b[1], b[2], 1.15, 0.72, 1.05, rnd() * 3));
    p.push(leaf(0.95, V(0x5cb24c), 0, 2.7, 0, 1.3, 0.62, 1.15));
    if (!lod) for (let i = 0; i < 7; i++) { const a = rnd() * Math.PI * 2, d = 0.6 + rnd() * 0.9; p.push(P(new THREE.CylinderGeometry(0.025, 0.04, 1.85, 4), 0x9a7856, Math.cos(a) * d * 1.2, 0.92, Math.sin(a) * d)); } // hanging roots
  } else if (type === 'mango') {
    // a sturdy trunk and a round, dense, dark crown hung with golden fruit
    trunkParts(p, 0.17, 0.12, 1.15, bark, lod ? 4 : 6, (rnd() - 0.5) * 0.15);
    p.push(leaf(0.8, V(0x3b8f38), 0, 1.65, 0, 1.15, 0.92, 1.1, rnd() * 3));
    p.push(leaf(0.56, V(0x4aa040), (rnd() - 0.5) * 0.5, 2.2, (rnd() - 0.5) * 0.4, 1, 1, 1, rnd() * 3));
    p.push(leaf(0.5, V(0x3b8f38), 0.55, 1.5, 0.3)); p.push(leaf(0.48, V(0x449a3c), -0.5, 1.55, -0.28));
    if (!lod) for (let i = 0; i < 7; i++) { const a = rnd() * Math.PI * 2, y = 1.3 + rnd() * 0.7; p.push(P(new THREE.OctahedronGeometry(0.075, 0), 0xffb21f, Math.cos(a) * 0.86, y, Math.sin(a) * 0.86, 0, 0, 0, 1, 1.3, 1)); }
  } else { // neem: slender forked trunk, light airy yellow-green clusters in tiers
    const top = trunkParts(p, 0.12, 0.075, 1.4, 0x7d5e40, lod ? 4 : 5, (rnd() - 0.5) * 0.25);
    for (const s of [-1, 1]) p.push(P(new THREE.CylinderGeometry(0.035, 0.055, 0.7, 4), 0x7d5e40, top.x + s * 0.2, 1.55, 0, 0, 0, -s * 0.6));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rnd(), d = i < 5 ? 0.35 + rnd() * 0.25 : 0;
      p.push(leaf(0.36 + rnd() * 0.16, V(rnd() > 0.5 ? 0x86c24a : 0x74b23e), top.x + Math.cos(a) * d, i < 5 ? 1.55 + rnd() * 0.35 : 2.25, Math.sin(a) * d, 1, 0.85, 1, rnd() * 3));
    }
  }
  return merge(p);
}
Models.stumpGeo = function (type) {
  const r = type === 'banyan' ? 0.3 : type === 'palm' ? 0.12 : 0.16;
  return merge([P(new THREE.CylinderGeometry(r, r * 1.25, 0.25, 6), 0x7a5232, 0, 0.125, 0), P(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.02, 6), 0xecd09a, 0, 0.255, 0)]);
};
/** A meadow bush: two or three faceted leaf masses (instanced around the island, see buildDecor). */
Models.bushGeo = function (variant) {
  const rnd = mulberry32(variant * 53 + 11), p = [];
  _leafSeed = variant * 5 + 3; LEAF_LOD = true;
  try {
    const n = 2 + (variant % 2);
    for (let i = 0; i < n; i++) {
      const r = i === 0 ? 0.36 : 0.22 + rnd() * 0.08;
      p.push(leaf(r, varyHex(0x5fa83c, (rnd() - 0.5) * 20, (rnd() - 0.5) * 0.06), i === 0 ? 0 : (rnd() - 0.5) * 0.5, r * 0.7, i === 0 ? 0 : (rnd() - 0.5) * 0.5, 1.1, 0.8, 1.1, rnd() * 3));
    }
    if (variant % 2 === 0) for (let i = 0; i < 4; i++) p.push(P(new THREE.OctahedronGeometry(0.05, 0), [0xff6a7a, 0xffd23a, 0xf4f0e0][(variant / 2 + i) % 3 | 0], (rnd() - 0.5) * 0.5, 0.42 + rnd() * 0.15, (rnd() - 0.5) * 0.5)); // flowers
  } finally { LEAF_LOD = false; }
  return merge(p);
};
/** A pond's banks (centred, water at y 0): clumps of reeds, lily pads with pink lotus, stones at the edge. */
Models.pondGeo = function (r, seed) {
  const rnd = mulberry32(seed * 131 + 7), p = [];
  for (let i = 0; i < 7; i++) { // reed clumps
    const a = rnd() * Math.PI * 2, d = r + 0.05 + rnd() * 0.25, x = Math.cos(a) * d, z = Math.sin(a) * d;
    for (let k = 0; k < 5; k++) p.push(P(new THREE.ConeGeometry(0.02, 0.45 + rnd() * 0.35, 3), k % 2 ? 0x6f9a3a : 0x86ae46, x + (rnd() - 0.5) * 0.22, 0.25, z + (rnd() - 0.5) * 0.22, (rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3));
    if (rnd() < 0.6) p.push(P(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 4), 0x6e4a2a, x, 0.62, z)); // a bulrush head
  }
  for (let i = 0; i < 9; i++) { // lily pads, a few with a lotus
    const a = rnd() * Math.PI * 2, d = rnd() * (r - 0.5), x = Math.cos(a) * d, z = Math.sin(a) * d;
    p.push(P(new THREE.CylinderGeometry(0.16 + rnd() * 0.06, 0.16, 0.015, 6, 1, false, 0.4, Math.PI * 1.8), 0x4f9a3a, x, 0.02, z, 0, rnd() * 6, 0));
    if (i % 3 === 0) { p.push(P(new THREE.ConeGeometry(0.06, 0.08, 5), 0xf2a6c0, x, 0.07, z)); p.push(P(new THREE.OctahedronGeometry(0.025, 0), 0xffe08a, x, 0.1, z)); }
  }
  for (let i = 0; i < 10; i++) { // stones on the bank
    const a = rnd() * Math.PI * 2, d = r + 0.15 + rnd() * 0.3;
    p.push(P(gemGeo(0.09 + rnd() * 0.08, 0, seed * 3 + i, 0.4), rnd() > 0.5 ? 0xa9a39a : 0x8f8a82, Math.cos(a) * d, 0.0, Math.sin(a) * d, 0, rnd() * 6, 0, 1, 0.6, 1));
  }
  return merge(p);
};
/** A boulder: a few faceted chunks, flattened and leaning, with a mossy facet or two on top. */
Models.rockGeo = function (variant, ore) {
  if (ore) return Models.oreRockGeo(variant);
  const rnd = mulberry32(variant * 977 + 3);
  const p = [];
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0.5 : 0.26 + rnd() * 0.12;
    const sx = 0.9 + rnd() * 0.3, sy = 0.6 + rnd() * 0.22, sz = 0.85 + rnd() * 0.3;
    const cx = i === 0 ? 0 : (rnd() - 0.5) * 0.95, cz = i === 0 ? 0 : (rnd() - 0.5) * 0.95;
    const g = P(gemGeo(r, i === 0 ? 1 : 0, variant * 7 + i, 0.34), rnd() > 0.5 ? 0xa9a39a : 0xb6afa3, cx, r * sy * 0.62, cz, rnd() * 0.3, rnd() * 3, rnd() * 0.3, sx, sy, sz);
    // facets facing the sky are lighter (sun-bleached), the steep ones darker; a few flat tops carry moss
    const nor = g.attributes.normal.array, col = g.attributes.color.array, moss = new THREE.Color(grade(0x7fb043));
    for (let k = 0; k < col.length; k += 9) {
      const ny = nor[k + 1], f = 0.86 + 0.22 * Math.max(0, ny);
      const mossy = ny > 0.82 && cornerRand(k, i, variant, 2) > 0.55;
      for (let j = 0; j < 9; j += 3) {
        if (mossy) { col[k + j] = moss.r; col[k + j + 1] = moss.g; col[k + j + 2] = moss.b; }
        else { col[k + j] *= f; col[k + j + 1] *= f; col[k + j + 2] *= f; }
      }
    }
    p.push(g);
  }
  return merge(p);
};

/** An iron-ore boulder: the same faceted shapes, rust-red and streaked, with dark metallic nodules. */
Models.oreRockGeo = function (variant) {
  const rnd = mulberry32(variant * 977 + 3);
  const p = [];
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0.5 : 0.28 + rnd() * 0.12;
    const sx = 0.9 + rnd() * 0.3, sy = 0.62 + rnd() * 0.2, sz = 0.85 + rnd() * 0.3;
    const cx = i === 0 ? 0 : (rnd() - 0.5) * 0.9, cz = i === 0 ? 0 : (rnd() - 0.5) * 0.9;
    const g = P(gemGeo(r, i === 0 ? 1 : 0, variant * 11 + i, 0.34), rnd() > 0.5 ? 0x8f5242 : 0x7d4636, cx, r * sy * 0.62, cz, rnd() * 0.3, rnd() * 3, rnd() * 0.3, sx, sy, sz);
    const nor = g.attributes.normal.array, col = g.attributes.color.array, rust = new THREE.Color(grade(0xc47a46));
    for (let k = 0; k < col.length; k += 9) {
      const streak = cornerRand(k, i, variant, 5) > 0.72, f = 0.85 + 0.22 * Math.max(0, nor[k + 1]);
      for (let j = 0; j < 9; j += 3) {
        if (streak) { col[k + j] = rust.r; col[k + j + 1] = rust.g; col[k + j + 2] = rust.b; }
        else { col[k + j] *= f; col[k + j + 1] *= f; col[k + j + 2] *= f; }
      }
    }
    p.push(g);
    for (let k = 0; k < 3; k++) { // dark iron nodules
      const a = rnd() * Math.PI * 2, e = 0.3 + rnd() * 0.8;
      p.push(P(new THREE.OctahedronGeometry(r * (0.13 + rnd() * 0.07), 0), 0x3e3a3c, cx + Math.cos(a) * Math.cos(e) * r * sx * 0.9, r * sy * 0.62 + Math.sin(e) * r * sy * 0.9, cz + Math.sin(a) * Math.cos(e) * r * sz * 0.9, rnd(), rnd(), rnd()));
    }
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
const MAT_COLS = {
  clay: [0xb5703f, 0xa8603a, 0xc27e4c], ore: [0x8a5040, 0x7a4636, 0x9a5a44, 0x4e4446], charcoal: [0x2e2a2b, 0x3d3839, 0x242122],
  brick: [0xc0502e, 0xb04628, 0xcf6040], iron: [0x8f99a4, 0x7d8792, 0xa3acb6],
};
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
      p.push(P(CylG(r0 + 0.013, r0, bh, 16), i % 2 ? 0xb3843c : 0xd6a957, 0, i * bh + bh / 2, 0, 0, 0, 0, 1, 1, 0.8));
    }
    p.push(P(TorusG(0.146, 0.017, 6, 18), 0x7d5226, 0, 0.3, 0, Math.PI / 2, 0, 0, 1, 0.8, 1));
    p.push(P(TorusG(0.094, 0.012, 6, 16), 0x7d5226, 0, 0.012, 0, Math.PI / 2, 0, 0, 1, 0.8, 1));
    p.push(P(CylG(0.132, 0.132, 0.01, 16), 0x4a2e16, 0, 0.3, 0, 0, 0, 0, 1, 1, 0.8));
    for (const sx of [-1, 1]) { // jute straps over each shoulder
      strapPart(p, [sx * 0.095, 0.3, 0.11], [sx * 0.1, 0.325, 0.27], 0x8a4a22);
      strapPart(p, [sx * 0.1, 0.325, 0.27], [sx * 0.1, 0.17, 0.405], 0x8a4a22);
    }
    const res = key.replace(/\d+$/, ''), lv = +key.slice(-1) || 0;
    if (res === 'wood') {
      const logs = [[0, 0.335, 0], [0, 0.335, -0.047], [0, 0.335, 0.047], [0, 0.415, 0]];
      const use = lv === 1 ? [logs[0]] : lv === 2 ? [logs[1], logs[2]] : [logs[1], logs[2], logs[3]];
      use.forEach(([x, y, z], i) => logPart(p, 0.045, 0.38 - i * 0.02, x, y, z, (i - 1) * 0.07, BARK[i % 3]));
      if (lv >= 2) p.push(P(TorusG(0.075, 0.01, 5, 12), 0xc8453c, 0.08, 0.36, 0, 0, Math.PI / 2, 0, 1, lv === 3 ? 1.25 : 0.8, 1)); // a red rope tie
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
    } else if (res === 'clay' || res === 'ore' || res === 'charcoal') { // lumps, piled like stones
      const cols = MAT_COLS[res];
      const spots = [[-0.055, 0.315, 0.02, 0.07], [0.06, 0.315, -0.015, 0.066], [0.0, 0.32, 0.05, 0.06], [0.01, 0.33, -0.06, 0.062], [-0.065, 0.36, -0.03, 0.058], [0.05, 0.37, 0.03, 0.06], [0, 0.42, 0, 0.065]];
      spots.slice(0, [0, 2, 4, 7][lv]).forEach(([x, y, z, r], i) => p.push(sph(r, cols[i % cols.length], x, y, z, 1.05, res === 'clay' ? 0.65 : 0.8, 1, 7, 5)));
    } else if (res === 'brick') {
      [[0, 0.32, 0], [0, 0.32, 0.06], [0, 0.32, -0.06], [0, 0.38, 0.03], [0, 0.38, -0.03], [0, 0.44, 0]].slice(0, [0, 2, 4, 6][lv]).forEach(([x, y, z], i) => p.push(boxC(0.2, 0.055, 0.075, MAT_COLS.brick[i % 3], x, y, z, 0, 0.05 * (i % 2 ? 1 : -1), 0)));
    } else if (res === 'iron') {
      [[0, 0.32, 0.03], [0, 0.32, -0.04], [0, 0.37, 0]].slice(0, lv).forEach(([x, y, z], i) => { p.push(boxC(0.18, 0.05, 0.07, MAT_COLS.iron[i % 3], x, y, z)); p.push(boxC(0.14, 0.02, 0.05, 0xc8d0d8, x, y + 0.035, z)); });
    }
    return merge(p);
  });
};
/** Little cloth potli tied at the hip for the gold nuggets a miner finds. */
Models.pouchGeo = function () {
  return cachedGeo('pouch', () => merge([
    sph(0.058, 0xc9963a, 0, -0.06, 0, 1, 1.1, 0.9),
    P(TorusG(0.03, 0.01, 5, 10), 0xd33b2c, 0, -0.005, 0, Math.PI / 2),
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
    } else if (res === 'clay') { // wet clay lumps slapped into a mound, with a few shaped blocks
      const n = [0, 3, 6, 9, 12, 15][lv];
      for (let i = 0; i < n; i++) {
        const ring = i < 7 ? 0 : i < 12 ? 1 : 2, a = i * 2.1 + ring;
        const rr = [0.3, 0.16, 0.04][ring];
        p.push(sph(0.16 - ring * 0.02, MAT_COLS.clay[i % 3], Math.cos(a) * rr, 0.07 + ring * 0.13, Math.sin(a) * rr * 0.85, 1.15, 0.6, 1.05, 8, 6));
      }
      if (lv >= 3) for (let k = 0; k < Math.min(4, lv); k++) p.push(box(0.16, 0.07, 0.1, 0xb5703f, -0.38 + k * 0.19, 0, 0.36));
    } else if (res === 'ore') { // rusty chunks heaped up, darker iron nodules among them
      const n = [0, 4, 8, 12, 16, 20][lv];
      for (let i = 0; i < n; i++) {
        const ring = i < 9 ? 0 : i < 15 ? 1 : 2, a = i * 2.4 + ring * 0.6, rr = [0.3, 0.17, 0.05][ring];
        p.push(sph(0.11 + rnd() * 0.03, MAT_COLS.ore[i % 4], Math.cos(a) * rr, 0.07 + ring * 0.12, Math.sin(a) * rr * 0.85, 1.05, 0.8, 0.95, 7, 5));
      }
    } else if (res === 'brick') { // fired bricks stacked in a criss-cross kiln stack
      const layers = [0, 1, 2, 3, 4, 5][lv];
      for (let L = 0; L < layers; L++) {
        const along = L % 2 === 0;
        for (let k = 0; k < 4; k++) {
          const o = -0.27 + k * 0.18;
          p.push(box(along ? 0.36 : 0.11, 0.075, along ? 0.11 : 0.36, MAT_COLS.brick[(k + L) % 3], along ? -0.19 : o, L * 0.077, along ? o : -0.19));
          p.push(box(along ? 0.36 : 0.11, 0.075, along ? 0.11 : 0.36, MAT_COLS.brick[(k + L + 1) % 3], along ? 0.19 : o, L * 0.077, along ? o : 0.19));
        }
      }
    } else if (res === 'charcoal') { // a woven basket heaped with black lumps, more spilling out
      p.push(cyl(0.26, 0.2, 0.22, 14, 0xb3843c, 0, 0, 0)); p.push(P(TorusG(0.26, 0.02, 5, 16), 0x7d5226, 0, 0.22, 0, Math.PI / 2));
      p.push(sph(0.24, 0x2e2a2b, 0, 0.2, 0, 1, [0, 0.25, 0.45, 0.65, 0.85, 1.05][lv], 1, 10, 6));
      for (let i = 0; i < [0, 0, 2, 4, 6, 9][lv]; i++) { const a = i * 2.2; p.push(sph(0.06 + rnd() * 0.02, MAT_COLS.charcoal[i % 3], Math.cos(a) * 0.36, 0.04, Math.sin(a) * 0.3, 1, 0.7, 1, 6, 4)); }
    } else if (res === 'iron') { // iron ingots stacked in alternating layers
      const layers = [0, 1, 2, 3, 4, 5][lv];
      for (let L = 0; L < layers; L++) {
        const along = L % 2 === 0;
        for (let k = 0; k < 3; k++) {
          const o = -0.16 + k * 0.16;
          p.push(box(along ? 0.34 : 0.11, 0.06, along ? 0.11 : 0.34, MAT_COLS.iron[(k + L) % 3], along ? 0 : o, L * 0.062, along ? o : 0));
        }
      }
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

/* ---------- villagers ----------
 * A jointed rig, proportioned like people: hips → two legs (thigh → knee → shin and foot) and a spine
 * (waist) → chest, a head on a neck, and two arms (upper arm → elbow → forearm and fist). Each fist has a
 * grip; tools and weapons sit in the right grip, the shield or bow in the left. A grip's tool lies along
 * its +z axis, so a sword points forward out of the fist instead of hanging down like a longer arm. The
 * person's right is -x (models face +z). Men wear a kurta over a draped dhoti and a wound pagdi; women a
 * saree with its pleats, border and pallu over a choli, hair in a khopa ringed with a gajra.
 * Cloth carries woven, block-printed or checked surfaces (see FAB).
 */
function hexOf(c) { return typeof c === 'number' ? c : parseInt(String(c).slice(1), 16); }
const V_HIP = 0.47;
/*
 * Each job's costume, all on the one jointed rig. legs: 'dhoti' (draped to the knee, bare calves,
 * chappals), 'lungi' (checked, to the knee), 'pants' (fitted, with wrapped shins and boots). sleeve:
 * 'long', 'short' or 'bare'. fore: 'wrap' (cloth bands), 'bracer' (leather, steel under mail or plate),
 * 'glove' (a smith's leather gauntlet), 'band' (a wrestler's gold cuff). Layers: vest (open in front,
 * or quilted), apron, robe (a long kurta), bareChest. Waist: belt (with a buckle and a pouch), sash
 * (patka). Shoulders: cowl (a short ragged cape), stole, shawl, cape, crossbelt. Head: pagdi, straw,
 * bandana, cap, band, hood, turban, shaved, topknot. Gear: gamcha, creel, toolbelt, satchel, purse,
 * scabbard, quiver, beads, armband, beard (1 dark, 2 white).
 */
const OUTFITS = {
  idle:    { legs: 'dhoti', sleeve: 'long', head: 'pagdi', gamcha: 1 },
  wood:    { legs: 'dhoti', sleeve: 'short', fore: 'wrap', vest: 0x6b4a2e, belt: 0x4e2c18, head: 'bandana', hat: 0xb83a30 },
  stone:   { legs: 'pants', pants: 0x6a5a48, sleeve: 'short', fore: 'wrap', apron: 0x7a5a3a, belt: 0x4e2c18, head: 'bandana', hat: 0x5d6b78 },
  farm:    { legs: 'dhoti', sleeve: 'long', head: 'straw', gamcha: 1 },
  fish:    { legs: 'lungi', pants: 0x2e5a8a, sleeve: 'short', belt: 0x6a4a2a, head: 'straw', creel: 1 },
  clay:    { legs: 'dhoti', sleeve: 'short', apron: 0x9a7a52, head: 'bandana', hat: 0xa8603a },
  kiln:    { legs: 'dhoti', sleeve: 'short', apron: 0x5a4030, head: 'bandana', hat: 0x6b4223 },
  smelt:   { legs: 'pants', pants: 0x4e342e, sleeve: 'bare', fore: 'glove', apron: 0x5a3a24, head: 'band', hat: 0x37474f, beard: 1 },
  build:   { legs: 'pants', pants: 0x8a7a64, sleeve: 'long', vest: 0x8d6e63, belt: 0x5a3820, toolbelt: 1, head: 'cap', hat: 0xf4ecd8, beard: 1 },
  vaidya:  { legs: 'dhoti', sleeve: 'long', robe: 1, stole: 0x2e7d32, satchel: 0x7a5a3a, head: 'turban', hat: 0xf4ecd8, beard: 2 },
  priest:  { legs: 'dhoti', sleeve: 'bare', bareChest: 1, shawl: 0xff8f1f, beads: 1, head: 'shaved' },
  trader:  { legs: 'dhoti', sleeve: 'long', vest: 0x4a148c, vestTrim: 0xe8b830, belt: 0x5a3018, purse: 1, head: 'pagdi', jewel: 1 },
  warrior: { legs: 'pants', sleeve: 'long', fore: 'bracer', sash: 1, crossbelt: 0x6b3a1e, scabbard: 1, head: 'pagdi', plume: 1 },
  brute:   { legs: 'dhoti', sleeve: 'bare', bareChest: 1, fore: 'band', beads: 1, head: 'topknot' },
  spear:   { legs: 'pants', sleeve: 'long', fore: 'bracer', vest: 0x2a3a5a, quilted: 1, sash: 1, head: 'pagdi', plume: 1 },
  khadgi:  { legs: 'pants', sleeve: 'short', fore: 'bracer', vest: 0x3a2418, crossbelt: 0x2a1408, cape: 0x8a1c1c, head: 'band', hat: 0x8a1c1c, beard: 1 },
  urumi:   { legs: 'dhoti', sleeve: 'bare', bareChest: 1, fore: 'wrap', sash: 1, head: 'band', hat: 0xc9962e },
  archer:  { legs: 'pants', sleeve: 'long', fore: 'bracer', vest: 0x6b4a2e, belt: 0x4e2c18, cowl: 0x2e6b3a, quiver: 1, head: 'hood' },
  longbow: { legs: 'pants', sleeve: 'long', fore: 'bracer', belt: 0x4e2c18, cowl: 0x4a5a2a, cape: 0x4a5a2a, quiver: 1, head: 'hood' },
  chakri:  { legs: 'pants', sleeve: 'short', fore: 'bracer', sash: 1, crossbelt: 0x5a3018, head: 'band', hat: 0xff9933 },
  medic:   { legs: 'pants', sleeve: 'long', sash: 1, satchel: 0x2e7d32, armband: 0xd33b2c, head: 'pagdi' },
};
Models.villager = function (look, job, armour) {
  const AR = slotKey(job) === 'army' && armour && ARMOURS[armour] ? ARMOURS[armour].tier : 0; // 1 leather, 2 mail, 3 plate
  const STEEL = 0xd2d8e0, MAIL = 0x8d939a, LEATHER = 0x7a4a2a;
  const O = OUTFITS[job] || OUTFITS.idle;
  const pal = lookPalette(look, job);
  const H = (k) => hexOf(pal[k]);
  const fem = look.g === 'f';
  const army = slotKey(job) === 'army';
  const brute = job === 'brute', big = brute || job === 'khadgi';
  // women in the village wear the saree; women soldiers and smiths a fighting tunic over trousers, like the men
  const saree = fem && !army && O.legs !== 'pants';
  const M = MAT.char || MAT.std;
  const skin = H('S'), skinD = darkHex(skin, 0.84), lip = mixHex(skin, 0x8a2424, 0.45), hair = H('h');
  const cloth = H('C'), clothD = H('c'), lower = H('D'), trim = H('d'), accent = H('G');
  const pantsC = O.pants || (army ? darkHex(lower, 0.78) : lower), bootC = army ? 0x3a2a1a : 0x5a3820;
  const printed = fem || ['farm', 'trader', 'idle', 'vaidya', 'kiln', 'clay'].includes(job);
  const CL = printed ? 2 : 1;
  const g = new THREE.Group();
  const bones = [], skinParts = []; // a skinned rig: every part rides one bone, the whole body is one mesh
  const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
  const rig = (parts, b) => { if (parts.length) skinParts.push([parts, b]); };
  // the kit: prisms that hang down from a joint (pr) or stand up from a base (pu), thin rings, faceted knobs
  const pr = (rt, rb, h, n, c, x, yTop, z, sx, sz, ry) => P(new THREE.CylinderGeometry(rt, rb, h, n), c, x, yTop - h / 2, z, 0, ry || 0, 0, sx || 1, 1, sz || 1);
  const pu = (rb, rt, h, n, c, x, yBot, z, sx, sz, ry) => P(new THREE.CylinderGeometry(rt, rb, h, n), c, x, yBot + h / 2, z, 0, ry || 0, 0, sx || 1, 1, sz || 1);
  const ring = (r, h, c, y, n, sz, x, z) => P(new THREE.CylinderGeometry(r, r, h, n || 8), c, x || 0, y, z || 0, 0, Math.PI / 8, 0, 1, 1, sz || 1);
  const knob = (r, c, x, y, z, sx, sy, sz) => P(new THREE.IcosahedronGeometry(r, 0), c, x, y, z, 0, 0, 0, sx || 1, sy || 1, sz || 1);
  const hips = bone(null, 0, V_HIP, 0);

  /* legs: index 0 is the right leg (-x) */
  const legs = [];
  for (const sx of [-1, 1]) {
    const L = bone(hips, sx * 0.072, -0.02, 0), knee = bone(L, 0, -0.215, 0);
    const th = [], sh = [];
    if (saree) { // only the feet show below the saree, with silver payal
      sh.push(pr(0.034, 0.03, 0.12, 6, skin, 0, -0.1, 0), ring(0.033, 0.012, 0xd8dde3, -0.19, 6));
    } else if (O.legs === 'pants') { // fitted trousers, shins wound with cloth, a stout boot
      FAB = 1;
      th.push(pr(0.075, 0.062, 0.24, 7, pantsC, 0, 0.015, 0));
      sh.push(pr(0.061, 0.05, 0.17, 7, pantsC, 0, 0.01, 0));
      FAB = 0;
      for (let k = 0; k < 2; k++) sh.push(ring(0.056 - k * 0.003, 0.02, darkHex(pantsC, 0.62), -0.065 - k * 0.055, 7)); // straps winding the shin
      sh.push(pr(0.054, 0.052, 0.08, 7, bootC, 0, -0.16, 0.005), box(0.088, 0.055, 0.17, bootC, 0, -0.25, 0.036), box(0.094, 0.014, 0.18, darkHex(bootC, 0.6), 0, -0.252, 0.036));
    } else { // the dhoti (or a checked lungi) draped over each thigh to the knee, bare calves, leather chappals
      FAB = O.legs === 'lungi' ? 3 : 1;
      const lc = O.legs === 'lungi' ? pantsC : lower;
      th.push(pr(0.083, 0.072, 0.23, 7, lc, 0, 0.015, 0));
      sh.push(pr(0.072, 0.066, 0.075, 7, lc, 0, 0.005, 0.004));
      FAB = 0;
      if (O.legs !== 'lungi') th.push(boxC(0.018, 0.2, 0.012, darkHex(lc, 0.86), sx * -0.032, -0.1, 0.072, -0.08));
      sh.push(ring(0.069, 0.014, trim, -0.068, 7));
      sh.push(pr(0.044, 0.031, 0.14, 6, skin, 0, -0.07, -0.004));
      sh.push(knob(0.036, skin, 0, -0.222, 0.044, 0.95, 0.55, 1.6), box(0.086, 0.016, 0.175, 0x5a3820, 0, -0.25, 0.036), boxC(0.07, 0.014, 0.018, 0x8a4a22, 0, -0.226, 0.07));
    }
    rig(th, L); rig(sh, knee);
    L.userData.knee = knee;
    legs.push(L);
  }

  /* the saree skirt hangs from the hips and swings with the legs (the renderer sways it) */
  let skirt = null;
  if (saree) {
    const sk = [];
    FAB = CL;
    sk.push(P(LatheG(V2([[0.206, -0.452], [0.2, -0.4], [0.178, -0.26], [0.152, -0.12], [0.134, 0.0], [0.128, 0.06], [0.001, 0.062]]), 14), lower, 0, 0, 0, 0, 0, 0, 1, 1, 0.88));
    for (let k = -2; k <= 2; k++) sk.push(boxC(0.034, 0.44, 0.012, darkHex(lower, k % 2 ? 0.86 : 0.94), k * 0.03, -0.2, 0.152 + 0.004 - Math.abs(k) * 0.006, -0.09, 0, k * 0.07)); // pleats
    FAB = 0;
    sk.push(P(new THREE.CylinderGeometry(0.207, 0.207, 0.055, 10, 1, true), trim, 0, -0.42, 0, 0, 0, 0, 1, 1, 0.88)); // the paar (border)
    sk.push(P(new THREE.CylinderGeometry(0.205, 0.205, 0.012, 10, 1, true), 0xe8b830, 0, -0.39, 0, 0, 0, 0, 1, 1, 0.88));
    skirt = bone(hips, 0, 0, 0);
    rig(sk, skirt);
  }

  /* spine and torso: the tunic, then whatever the job wears over it */
  const spine = bone(hips, 0, 0.05, 0);
  const body = [], zs = 0.77; // chests are flatter front to back
  const W = big ? 1.18 : 1; // how broad
  if (saree) { // a choli over a bare midriff, the pallu across the chest and down the back
    FAB = 0; body.push(pu(0.124, 0.12, 0.11, 8, skin, 0, -0.01, 0, 1, 0.78));
    FAB = 1; body.push(pu(0.124, 0.14, 0.1, 8, cloth, 0, 0.1, 0, 1, 0.8), pu(0.14, 0.07, 0.09, 8, cloth, 0, 0.2, 0, 1, 0.8));
    for (const sx of [-1, 1]) body.push(knob(0.058, cloth, sx * 0.055, 0.17, 0.07, 1, 0.9, 0.75));
    FAB = CL;
    body.push(boxC(0.1, 0.36, 0.016, lower, 0.01, 0.12, 0.118, -0.08, 0, -0.55), boxC(0.13, 0.5, 0.016, lower, 0.07, 0.07, -0.112, 0.08, 0, 0.12), knob(0.06, lower, 0.105, 0.255, 0.0, 0.85, 0.55, 1.5));
    FAB = 0; body.push(boxC(0.016, 0.36, 0.018, trim, 0.052, 0.098, 0.12, -0.08, 0, -0.55));
  } else if (O.bareChest) { // bare to the waist (the pehelwan broad and oiled), a dhoti wound at the hips
    const r0 = brute ? 0.17 : 0.14;
    FAB = 0;
    body.push(pu(r0, r0 * 1.12, 0.2, 8, skin, 0, -0.02, 0, 1, 0.78), pu(r0 * 1.12, r0 * 0.5, 0.1, 8, skin, 0, 0.18, 0, 1, 0.8));
    for (const sx of [-1, 1]) { body.push(boxC(r0 * 0.7, 0.07, 0.03, skinD, sx * r0 * 0.38, 0.19, r0 * 0.82, 0.15)); if (brute) body.push(knob(0.065, skin, sx * 0.18, 0.24, 0, 1.1, 0.85, 1)); } // pecs, round shoulders
    for (let k = 0; k < 3; k++) body.push(boxC(r0 * 0.6, 0.012, 0.012, skinD, 0, 0.03 + k * 0.045, r0 * 0.8)); // the stomach's lines
    FAB = 1; body.push(pu(r0 + 0.01, r0, 0.12, 8, lower, 0, -0.12, 0, 1, 0.8)); FAB = 0;
    body.push(ring(r0 + 0.012, 0.03, brute ? 0xd33b2c : accent, -0.005, 8, 0.8));
  } else { // the tunic (kurta, or a soldier's angarkha): a flared skirt, the chest, shoulders sloping to the neck
    FAB = CL;
    const hem = O.robe ? -0.44 : fem ? -0.22 : -0.17;
    body.push(pu(O.robe ? 0.2 : 0.168 * W, 0.142 * W, -hem, 8, cloth, 0, hem, 0, 1, zs + 0.02));
    body.push(pu(0.142 * W, 0.152 * W, 0.25, 8, cloth, 0, 0, 0, 1, zs), pu(0.152 * W, 0.07, 0.05, 8, cloth, 0, 0.25, 0, 1, zs));
    if (fem) for (const sx of [-1, 1]) body.push(knob(0.05, cloth, sx * 0.055, 0.17, 0.095, 1, 0.9, 0.7));
    FAB = 0;
    body.push(ring((O.robe ? 0.201 : 0.169 * W), 0.02, clothD, hem + 0.01, 8, zs + 0.02), ring(0.072, 0.025, clothD, 0.29, 8, zs));
    body.push(boxC(0.028, 0.12, 0.01, clothD, 0, 0.215, 0.152 * W * zs + 0.004, -0.08));
    for (let i = 0; i < 3; i++) body.push(knob(0.009, 0xe8b830, 0, 0.18 + i * 0.033, 0.152 * W * zs + 0.01));
  }
  const front = (O.bareChest ? 0.14 : 0.152 * W) * zs; // where the chest's front face is
  // over the tunic
  if (O.vest) { // an open koti, or a quilted gambeson closed to the throat
    FAB = O.quilted ? 1 : 6;
    if (O.quilted) { body.push(pu(0.158 * W, 0.162 * W, 0.28, 8, O.vest, 0, -0.04, 0, 1, zs + 0.03)); FAB = 0; for (let k = 0; k < 4; k++) body.push(ring(0.163 * W, 0.008, darkHex(O.vest, 0.7), 0.0 + k * 0.065, 8, zs + 0.03)); }
    else {
      body.push(P(new THREE.CylinderGeometry(0.162 * W, 0.158 * W, 0.26, 8, 1, true, 0.42, Math.PI * 2 - 0.84), O.vest, 0, 0.12, 0, 0, 0, 0, 1, 1, zs + 0.04));
      FAB = 0;
      if (O.vestTrim) for (const s of [-1, 1]) body.push(boxC(0.018, 0.26, 0.012, O.vestTrim, s * Math.sin(0.42) * 0.16 * W, 0.12, Math.cos(0.42) * 0.16 * W * (zs + 0.04) + 0.004, 0, s * 0.42, 0));
    }
    FAB = 0;
  }
  if (O.apron) { // a leather or cloth apron on a neck strap
    FAB = 6;
    body.push(boxC(0.2 * W, 0.42, 0.016, O.apron, 0, -0.02, front + 0.012, -0.06));
    FAB = 0;
    for (const s of [-1, 1]) body.push(boxC(0.016, 0.1, 0.01, darkHex(O.apron, 0.7), s * 0.06, 0.24, front + 0.006, 0.1, 0, -s * 0.25));
    body.push(ring(0.15 * W, 0.016, darkHex(O.apron, 0.7), 0.02, 8, zs + 0.02));
  }
  if (O.belt) { // a belt with a brass buckle and a pouch on the hip
    body.push(ring(0.146 * W, 0.034, O.belt, 0.0, 8, zs + 0.03), boxC(0.034, 0.03, 0.012, 0xe8b830, 0, 0.0, front + 0.012));
    FAB = 6; body.push(box(0.06, 0.06, 0.035, darkHex(O.belt, 1.3), -0.12 * W, -0.075, 0.07)); FAB = 0;
  }
  if (O.sash) { // a patka: a cloth sash wound round the waist, one end hanging in front
    FAB = 2; body.push(ring(0.15 * W, 0.04, accent, 0.0, 8, zs + 0.04), boxC(0.06, 0.18, 0.012, accent, 0.05, -0.1, front + 0.016, -0.05)); FAB = 0;
    body.push(boxC(0.062, 0.016, 0.014, trim, 0.05, -0.19, front + 0.02, -0.05));
  }
  if (O.crossbelt) for (const zz of [1, -1]) body.push(boxC(0.032, 0.42, 0.012, O.crossbelt, 0, 0.12, zz * (front + 0.012), 0, 0, zz * 0.62)); // a baldric across the chest and back
  if (O.cowl) { // a short shoulder cape with a ragged hem
    FAB = 1; body.push(pu(0.2 * W, 0.08, 0.11, 8, O.cowl, 0, 0.19, 0, 1, 0.86)); FAB = 0;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; body.push(P(new THREE.ConeGeometry(0.035, 0.06, 3), O.cowl, Math.sin(a) * 0.19, 0.165, Math.cos(a) * 0.16, Math.PI, a, 0)); }
  }
  if (O.stole) { FAB = 1; for (const s of [-1, 1]) body.push(boxC(0.05, 0.36, 0.014, O.stole, s * 0.075, 0.1, front + 0.014, -0.06), knob(0.05, O.stole, s * 0.1, 0.27, 0.0, 1, 0.5, 1.4)); FAB = 0; } // a healer's green stole round the neck
  if (O.shawl) { FAB = 1; body.push(boxC(0.1, 0.4, 0.016, O.shawl, 0.02, 0.12, front + 0.016, -0.06, 0, -0.6), boxC(0.13, 0.46, 0.016, O.shawl, 0.06, 0.08, -front - 0.016, 0.06, 0, 0.3), knob(0.065, O.shawl, 0.11, 0.26, 0, 0.9, 0.55, 1.5)); FAB = 0; body.push(boxC(0.006, 0.4, 0.006, 0xf4ecd8, -0.02, 0.12, front + 0.022, -0.05, 0, 0.62)); } // the angavastram and the sacred thread
  if (O.cape) { FAB = 1; body.push(boxC(0.3 * W, 0.56, 0.02, O.cape, 0, 0.0, -front - 0.03, 0.1)); FAB = 0; body.push(boxC(0.32 * W, 0.035, 0.03, 0xc9962e, 0, 0.27, -front - 0.01)); } // a cape from the shoulders
  if (O.gamcha) { // a checked gamcha over the right shoulder
    FAB = 3;
    body.push(P(new THREE.TorusGeometry(0.085, 0.02, 4, 7, Math.PI), 0xb83a30, -0.1, 0.262, 0, 0, Math.PI / 2, 0, 1, 1, 1.15), boxC(0.04, 0.12, 0.012, 0xb83a30, -0.1, 0.21, front + 0.008, -0.1), boxC(0.04, 0.15, 0.012, 0xb83a30, -0.1, 0.19, -front - 0.008, 0.1));
    FAB = 0;
  }
  if (O.beads) for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI; body.push(knob(brute ? 0.016 : 0.012, brute ? 0xd4a234 : 0x6b2a1e, Math.cos(a) * 0.075, 0.28 - Math.sin(a) * 0.1, front - 0.01 + Math.sin(a) * 0.03)); } // a mala
  if (O.toolbelt) { // the Mistri's belt: a pouch of nails, a plumb line, a folding rule
    FAB = 6; body.push(box(0.06, 0.07, 0.035, 0x7a4b26, 0.12, -0.08, 0.075)); FAB = 0;
    body.push(P(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 3), 0xd8c28a, -0.12, -0.05, 0.08), P(new THREE.ConeGeometry(0.016, 0.035, 4), 0x55555f, -0.12, -0.11, 0.08, Math.PI), box(0.025, 0.1, 0.012, 0xe8c85a, 0.06, -0.12, front + 0.012));
  }
  if (O.satchel) { FAB = 6; body.push(box(0.09, 0.09, 0.045, O.satchel, 0.135, -0.1, 0.03)); FAB = 0; body.push(boxC(0.026, 0.44, 0.01, darkHex(O.satchel, 0.7), 0, 0.1, front + 0.01, 0, 0, -0.6), boxC(0.026, 0.44, 0.01, darkHex(O.satchel, 0.7), 0, 0.1, -front - 0.01, 0, 0, 0.6)); }
  if (O.purse) body.push(knob(0.04, 0xc84030, -0.1, -0.05, 0.09, 1, 1.1, 0.8), ring(0.022, 0.012, 0xe8b830, -0.01, 6, 1, -0.1, 0.09));
  if (O.creel) { body.push(pu(0.045, 0.062, 0.1, 6, C.bamboo, -0.15, -0.16, 0.03), ring(0.064, 0.016, C.bambooD, -0.06, 6, 1, -0.15, 0.03)); } // a fish creel on the hip
  if (O.scabbard) { body.push(boxC(0.026, 0.05, 0.44, 0x3a2418, 0.15, -0.14, -0.05, -1.0, 0, 0)); body.push(boxC(0.032, 0.056, 0.03, 0xe8b830, 0.15, -0.01, 0.13, -1.0, 0, 0)); } // the talwar's sheath, hilt forward
  if (O.quiver) { // a big quiver on the back, red and white fletchings showing
    FAB = 6; body.push(P(new THREE.CylinderGeometry(0.05, 0.044, 0.36, 6), 0x7a4b26, -0.05, 0.14, -front - 0.05, -0.15, 0, -0.35)); FAB = 0;
    body.push(ring(0.052, 0.02, 0xc9962e, 0.28, 6, 1, -0.11, -front - 0.07));
    for (let i = 0; i < 5; i++) { const ax = -0.12 + i * 0.016, ay = 0.36 + i * 0.006; body.push(P(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 3), 0xc8a46a, ax, ay - 0.04, -front - 0.08, -0.15, 0, -0.35), P(new THREE.ConeGeometry(0.02, 0.07, 3), i % 2 ? 0xd33b2c : 0xf4ecd8, ax - 0.01, ay + 0.02, -front - 0.085, -0.15, 0, -0.35)); }
  }
  // the neck
  FAB = 0;
  body.push(pu(0.044, 0.038, 0.08, 7, skin, 0, 0.255, 0.004));
  /* armour over the clothes: a leather jerkin and shoulder guards; a mail shirt with steel shoulders; or the
     char-aina, four polished steel plates with gold rims (front, back and sides) over the mail */
  if (AR) {
    const br = (brute ? 0.2 : 0.165) * (big && !brute ? 1.1 : 1);
    if (AR === 1) {
      FAB = 6; body.push(P(new THREE.CylinderGeometry(br, br - 0.01, 0.27, 8), LEATHER, 0, 0.115, 0, 0, Math.PI / 8, 0, 1, 1, 0.8)); FAB = 0;
      body.push(P(new THREE.CylinderGeometry(br + 0.005, br + 0.005, 0.035, 8), 0x4e2c18, 0, 0.0, 0, 0, Math.PI / 8, 0, 1, 1, 0.8));
      for (let k = 0; k < 3; k++) body.push(boxC(0.05, 0.012, 0.01, 0x4e2c18, 0, 0.07 + k * 0.06, br * 0.8 + 0.004));
    } else { FAB = 8; body.push(P(new THREE.CylinderGeometry(br, br + 0.01, 0.38, 8), MAIL, 0, 0.06, 0, 0, Math.PI / 8, 0, 1, 1, 0.8)); FAB = 0; }
    for (const sx of [-1, 1]) body.push(P(new THREE.SphereGeometry(0.078, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), AR === 1 ? 0x6a3e22 : STEEL, sx * (brute ? 0.18 : 0.158), 0.24, 0, 0, 0, sx * -0.35, 1.1, 0.7, 1));
    if (AR === 3) {
      FAB = 8;
      for (const [x, z, ry, w] of [[0, br * 0.8 + 0.012, 0, 0.17], [0, -br * 0.8 - 0.012, 0, 0.17], [br + 0.01, 0, Math.PI / 2, 0.12], [-br - 0.01, 0, Math.PI / 2, 0.12]]) {
        body.push(boxC(w + 0.02, 0.19, 0.012, 0xd4a234, x, 0.14, z, 0, ry, 0), boxC(w, 0.17, 0.016, STEEL, x * 1.02, 0.14, z * 1.02, 0, ry, 0));
      }
      FAB = 0;
      body.push(P(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 6), 0xd4a234, 0, 0.14, br * 0.8 + 0.024, Math.PI / 2, 0, 0));
    }
  }
  const torso = bone(spine, 0, 0, 0); // its own bone, so breathing swells the chest alone
  rig(body, torso);

  /* the head: angular and faceted, a flat-topped skull and a jaw that tapers to the chin; small dark eyes, a
     wedge of a nose, brows; then the hair, beard and whatever the job wears on it */
  const head = bone(spine, 0, 0.3, 0.006);
  const hp = [], hy = 0.11, fz = 0.098; // fz: the face's front
  const Q8 = Math.PI / 8;
  FAB = 0;
  hp.push(P(new THREE.CylinderGeometry(0.112, 0.104, 0.12, 8), skin, 0, hy + 0.035, 0, 0, Q8, 0, 1, 1, 0.94));
  hp.push(P(new THREE.SphereGeometry(0.112, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), skin, 0, hy + 0.095, 0, 0, Q8, 0, 1, 0.55, 0.94));
  hp.push(P(new THREE.CylinderGeometry(0.104, fem ? 0.055 : 0.064, 0.095, 8), skin, 0, hy - 0.072, 0.008, 0, Q8, 0, 1, 1, 0.92));
  for (const sx of [-1, 1]) {
    hp.push(box(0.022, 0.045, 0.03, skinD, sx * 0.108, hy - 0.04, -0.005));                           // ears
    hp.push(boxC(0.024, fem ? 0.02 : 0.016, 0.012, 0x22140c, sx * 0.04, hy + 0.01, fz));              // eyes
    hp.push(boxC(0.007, 0.006, 0.006, 0xffffff, sx * 0.034, hy + 0.015, fz + 0.007));
    hp.push(boxC(0.044, 0.011, 0.014, hair, sx * 0.042, hy + 0.038, fz + 0.002, 0, 0, sx * 0.08));    // brows
    if (fem) hp.push(boxC(0.03, 0.005, 0.006, 0x1a1010, sx * 0.04, hy + 0.022, fz + 0.004, 0, 0, sx * -0.1)); // kajal
  }
  hp.push(P(new THREE.ConeGeometry(0.019, 0.052, 4), skinD, 0, hy - 0.016, fz + 0.012, Math.PI / 2 + 0.3, Q8 * 2, 0)); // the nose
  hp.push(boxC(0.034, 0.009, 0.01, lip, 0, hy - 0.058, fz - 0.006));
  if (fem) {
    hp.push(knob(0.008, 0xc81e1e, 0, hy + 0.056, fz + 0.004), knob(0.005, 0xf2c230, 0.02, hy - 0.026, fz + 0.012)); // bindi, nose stud
    for (const sx of [-1, 1]) hp.push(P(new THREE.ConeGeometry(0.012, 0.026, 4), 0xf2c230, sx * 0.112, hy - 0.072, 0.0, Math.PI)); // jhumka
  }
  // facial hair: a moustache, and a beard for some trades (white for the old Vaidya)
  const beardC = O.beard === 2 ? 0xe8e2d8 : hair;
  if (!fem && O.beard) { FAB = 6; hp.push(P(new THREE.CylinderGeometry(0.108, O.beard === 2 ? 0.02 : 0.05, O.beard === 2 ? 0.16 : 0.1, 8), beardC, 0, hy - (O.beard === 2 ? 0.1 : 0.075), 0.014, 0, Q8, 0, 1, 1, 0.94)); FAB = 0; }
  if (!fem && (look.stache || O.beard)) hp.push(boxC(0.07, 0.016, 0.02, beardC, 0, hy - 0.044, fz + 0.002), boxC(0.02, 0.03, 0.02, beardC, -0.035, hy - 0.06, fz - 0.002), boxC(0.02, 0.03, 0.02, beardC, 0.035, hy - 0.06, fz - 0.002));
  // hair, then the headgear
  let gear = AR >= 2 ? 'helmet' : O.head;
  if (fem && ['pagdi', 'bandana', 'cap', 'turban', 'shaved', 'topknot'].includes(gear)) gear = army ? 'band' : 'hair';
  const hairCap = (c) => { FAB = 6; hp.push(P(new THREE.SphereGeometry(0.12, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55), c || hair, 0, hy + 0.04, -0.01, 0, Q8, 0, 1, 0.9, 1)); hp.push(box(0.2, 0.09, 0.05, c || hair, 0, hy - 0.04, -0.09)); FAB = 0; };
  if (fem) { // a khopa (bun) ringed with a gajra; covered by the pallu if she wears it so
    hairCap();
    if (gear !== 'hood') { FAB = 6; hp.push(knob(0.06, hair, 0, hy + 0.0, -0.12)); FAB = 0; }
    if (army) { FAB = 6; for (let k = 0; k < 4; k++) hp.push(knob(0.03 - k * 0.003, hair, 0, hy - 0.06 - k * 0.055, -0.12 - k * 0.006)); FAB = 0; } // a fighter's plait instead
    else for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; hp.push(knob(0.012, 0xfaf6ee, Math.cos(a) * 0.055, hy + Math.sin(a) * 0.05, -0.15)); }
    if (look.covered && saree && gear === 'hair') { FAB = CL; hp.push(P(new THREE.SphereGeometry(0.142, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52), lower, 0, hy + 0.01, -0.03, -0.5, 0, 0)); FAB = 0; }
  } else if (gear !== 'shaved' && gear !== 'topknot' && gear !== 'hood') hairCap();
  const turban = (c, c2) => { // a pagdi: wound bands, a crown, a knot at the front
    FAB = 1;
    hp.push(pu(0.124, 0.132, 0.1, 8, c, 0, hy + 0.045, -0.006, 1, 1.02), P(new THREE.SphereGeometry(0.128, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), c, 0, hy + 0.14, -0.006, 0, Q8, 0, 1, 0.42, 1));
    FAB = 0;
    hp.push(ring(0.133, 0.022, c2, hy + 0.075, 8, 1, 0, -0.006), ring(0.135, 0.018, c, hy + 0.115, 8, 1, 0, -0.006), knob(0.03, c2, 0.02, hy + 0.1, 0.126, 1, 1, 0.6));
  };
  if (gear === 'pagdi') {
    turban(H('H'), accent);
    if (O.plume) { hp.push(boxC(0.04, 0.1, 0.014, accent, 0, hy + 0.17, 0.12, -0.25)); FAB = 6; hp.push(P(new THREE.ConeGeometry(0.014, 0.12, 4), 0xfff0d0, 0.008, hy + 0.25, 0.1, -0.35)); FAB = 0; }
    else if (O.jewel) { hp.push(knob(0.024, 0xd33b2c, 0.02, hy + 0.14, 0.13), P(new THREE.ConeGeometry(0.012, 0.1, 4), 0xf4ecd8, 0.03, hy + 0.21, 0.11, -0.3)); } // a ruby sarpech and a feather
    else hp.push(boxC(0.05, 0.12, 0.012, H('H'), 0, hy - 0.0, -0.132, 0.15)); // the tail behind
  } else if (gear === 'turban') turban(O.hat, darkHex(O.hat, 0.85));
  else if (gear === 'straw') { // a wide straw hat with a pointed crown
    FAB = 1;
    hp.push(P(new THREE.CylinderGeometry(0.26, 0.27, 0.02, 10), 0xd9b45a, 0, hy + 0.09, 0), P(new THREE.ConeGeometry(0.16, 0.15, 8), 0xe3c06a, 0, hy + 0.175, 0));
    FAB = 0;
    hp.push(ring(0.12, 0.02, 0x8a5a2e, hy + 0.11, 8));
  } else if (gear === 'bandana') { // a head-cloth knotted at the back
    FAB = 1; hp.push(P(new THREE.SphereGeometry(0.124, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.55), O.hat, 0, hy + 0.04, -0.008, 0, Q8, 0, 1, 0.92, 1.02)); FAB = 0;
    hp.push(knob(0.028, O.hat, 0, hy + 0.05, -0.125), P(new THREE.ConeGeometry(0.02, 0.09, 3), O.hat, -0.02, hy - 0.0, -0.13, -2.6, 0, 0.2), P(new THREE.ConeGeometry(0.02, 0.08, 3), O.hat, 0.02, hy, -0.13, -2.6, 0, -0.3));
  } else if (gear === 'cap') { // a white cloth topi
    FAB = 1; hp.push(boxC(0.22, 0.06, 0.15, O.hat, 0, hy + 0.13, -0.006), boxC(0.2, 0.03, 0.03, darkHex(O.hat, 0.9), 0, hy + 0.17, -0.006)); FAB = 0;
  } else if (gear === 'band') { // a cloth headband knotted at the back, the hair showing above
    hp.push(ring(0.118, 0.032, O.hat, hy + 0.055, 8), P(new THREE.ConeGeometry(0.018, 0.1, 3), O.hat, -0.02, hy + 0.02, -0.125, -2.5, 0, 0.25), P(new THREE.ConeGeometry(0.018, 0.09, 3), O.hat, 0.02, hy + 0.02, -0.125, -2.5, 0, -0.25));
  } else if (gear === 'hood') { // a hunter's hood, open at the face, coming to a point behind
    FAB = 1;
    hp.push(P(new THREE.SphereGeometry(0.15, 8, 5, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5, 0, Math.PI * 0.68), O.cowl, 0, hy + 0.015, -0.008, 0, 0, 0, 1, 1.12, 1.06));
    hp.push(P(new THREE.ConeGeometry(0.05, 0.12, 4), O.cowl, 0, hy + 0.13, -0.11, -0.9, 0, 0));
    FAB = 0;
    hp.push(P(new THREE.TorusGeometry(0.13, 0.016, 4, 8, Math.PI * 1.1), darkHex(O.cowl, 0.75), 0, hy + 0.02, 0.06, 0, 0, Math.PI * 0.95, 1, 1.15, 1));
  } else if (gear === 'shaved' || gear === 'topknot') { // the Pujari's shaved head with a choti and the tripundra; the pehelwan's topknot
    FAB = 6; hp.push(P(new THREE.SphereGeometry(0.119, 8, 2, Math.PI, Math.PI, Math.PI * 0.4, Math.PI * 0.25), hair, 0, hy + 0.04, 0)); FAB = 0; // a band of close-cropped hair round the back
    hp.push(knob(gear === 'topknot' ? 0.03 : 0.016, hair, 0, hy + 0.15, -0.06), P(new THREE.ConeGeometry(0.014, 0.07, 4), hair, 0, hy + 0.13, -0.1, -0.7, 0, 0));
    if (gear === 'shaved') { for (let k = 0; k < 3; k++) hp.push(boxC(0.06, 0.005, 0.006, 0xf4ecd8, 0, hy + 0.05 + k * 0.012, fz + 0.002 - k * 0.002, -0.3)); hp.push(knob(0.008, 0xd33b2c, 0, hy + 0.062, fz + 0.004)); }
  } else if (gear === 'helmet') { // a steel khud: a dome, a spike, a nasal bar (plate adds a plume and mail at the neck)
    FAB = 8;
    hp.push(P(new THREE.SphereGeometry(0.152, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), STEEL, 0, hy + 0.03, -0.008, 0, Q8, 0, 1, 0.86, 1.02));
    FAB = 0;
    hp.push(P(new THREE.CylinderGeometry(0.155, 0.155, 0.028, 8), 0xd4a234, 0, hy + 0.03, -0.008, 0, Q8, 0), P(new THREE.ConeGeometry(0.022, 0.1, 4), 0xd4a234, 0, hy + 0.2, -0.01), boxC(0.018, 0.1, 0.012, STEEL, 0, hy + 0.0, 0.145));
    if (AR === 3) { FAB = 8; hp.push(P(new THREE.CylinderGeometry(0.15, 0.16, 0.09, 8, 1, true, Math.PI * 0.35, Math.PI * 1.3), MAIL, 0, hy - 0.02, -0.01)); FAB = 6; hp.push(P(new THREE.ConeGeometry(0.016, 0.12, 4), 0xd33b2c, 0, hy + 0.26, -0.02, -0.3, 0, 0)); FAB = 0; }
  }
  for (const g0 of hp) g0.translate(0, -0.015, 0).scale(1.07, 1.07, 1.07).translate(0, 0.015, 0); // a touch bigger than life, to read from above
  rig(hp, head);

  /* arms: index 0 is the left arm (+x), index 1 the right arm (-x) that holds tools and weapons */
  const arms = [], grips = [];
  for (const sx of [1, -1]) {
    const A = bone(spine, sx * (brute ? 0.17 : big ? 0.165 : 0.153), 0.243, 0), E = bone(A, 0, -0.158, 0);
    const up = [], fo = [];
    const ur = brute ? 0.056 : big ? 0.05 : 0.046, fr = brute ? 0.048 : big ? 0.042 : 0.038;
    const sl = saree ? 'choli' : O.sleeve;
    const sleeveC = cloth, upC = sl === 'bare' ? skin : cloth;
    FAB = upC === skin ? 0 : CL;
    up.push(knob(ur + 0.006, upC, 0, -0.008, 0, 1, 0.95, 1));
    if (sl === 'long') up.push(pr(ur, ur - 0.006, 0.16, 7, sleeveC, 0, -0.005, 0));
    else if (sl === 'short' || sl === 'choli') { up.push(pr(ur + 0.003, ur, 0.075, 7, sleeveC, 0, -0.005, 0)); FAB = 0; up.push(pr(ur - 0.005, ur - 0.01, 0.09, 7, skin, 0, -0.075, 0)); }
    else up.push(pr(ur, ur - 0.007, 0.16, 7, skin, 0, -0.005, 0));
    FAB = 0;
    if (O.armband && sx === 1) up.push(ring(ur + 0.004, 0.03, O.armband, -0.07, 7)); // the medic's armband
    if (brute) up.push(ring(ur + 0.002, 0.02, 0xd4a234, -0.07, 7)); // a bajuband
    up.push(knob(fr + 0.004, sl === 'long' ? sleeveC : skin, 0, -0.158, 0));
    if (sl === 'long') { FAB = CL; fo.push(pr(fr, fr - 0.003, 0.09, 7, sleeveC, 0, 0.0, 0)); FAB = 0; fo.push(ring(fr + 0.002, 0.014, clothD, -0.085, 7), pr(fr - 0.006, fr - 0.009, 0.06, 7, skin, 0, -0.08, 0)); }
    else fo.push(pr(fr, fr - 0.008, 0.14, 7, skin, 0, 0.0, 0));
    const glove = O.fore === 'glove';
    if (O.fore === 'bracer') fo.push(pr(fr + 0.008, fr + 0.004, 0.08, 7, AR >= 2 ? STEEL : 0x8a5a22, 0, -0.055, 0));
    else if (O.fore === 'wrap') for (let k = 0; k < 3; k++) fo.push(ring(fr + 0.002 - k * 0.002, 0.018, 0xe0d4b8, -0.07 - k * 0.025, 7));
    else if (glove) fo.push(pr(fr + 0.02, fr + 0.012, 0.1, 7, 0x6b4223, 0, -0.045, 0));
    else if (O.fore === 'band') fo.push(ring(fr + 0.006, 0.03, 0xd4a234, -0.12, 7));
    fo.push(P(new THREE.IcosahedronGeometry(glove ? 0.046 : 0.041, 0), glove ? 0x5a3820 : skin, 0, -0.168, 0.004, 0, 0, 0, 0.85, 1.05, 0.95)); // a chunky fist
    fo.push(knob(0.015, glove ? 0x5a3820 : skin, sx * -0.025, -0.152, 0.026, 1, 1.25, 1)); // thumb
    if (saree) for (const [y, c, r] of [[-0.108, 0xf6f1e8, 0.032], [-0.121, 0xc81e1e, 0.031], [-0.131, 0xe8b830, 0.03]]) fo.push(ring(r, 0.012, c, y, 6)); // shankha, pola and a gold bangle
    if (job === 'chakri' && sx === 1) for (const y of [-0.05, -0.08]) fo.push(P(new THREE.TorusGeometry(0.062, 0.009, 4, 8), 0xd8dde6, 0, y, 0, Math.PI / 2)); // spare chakrams on the wrist
    rig(up, A); rig(fo, E);
    const G = bone(E, 0, -0.168, 0.006);
    A.userData.elbow = E; A.userData.grip = G;
    arms.push(A); grips.push(G);
  }

  /* the tool in the right grip, modelled along +z out of the fist (origin = where the fist closes): chunky,
     readable shapes, a little larger than life */
  const T = [];
  const tool = JOBS[job] && JOBS[job].tool;
  const handle = (r, z0, z1, c) => P(new THREE.CylinderGeometry(r, r, z1 - z0, 6), c || 0x8a5a2e, 0, 0, (z0 + z1) / 2, Math.PI / 2, 0, 0);
  const steelB = 0xdfe4ec, steelD = 0x9aa1ab, brass = 0xe8b830;
  let toolFlame = null;
  const ud = {};
  if (tool === 'axe') { // a long haft and a broad, flaring axe head
    T.push(handle(0.018, -0.08, 0.5), P(new THREE.CylinderGeometry(0.045, 0.09, 0.15, 4), steelB, 0, -0.07, 0.44, 0, 0, 0, 0.22, 1, 1), boxC(0.03, 0.04, 0.06, steelD, 0, 0.01, 0.44), ring(0.022, 0.03, 0x5a3820, 0, 6, 1, 0, -0.03));
  } else if (tool === 'pick') { // a gainti: a heavy curved head, a point each way
    T.push(handle(0.018, -0.08, 0.48), boxC(0.04, 0.05, 0.05, steelD, 0, 0, 0.45));
    for (const s of [-1, 1]) T.push(P(new THREE.ConeGeometry(0.024, 0.17, 4), 0xb9bcc6, 0, s * 0.1, 0.45 - 0.02, s > 0 ? 0.25 : Math.PI - 0.25, 0, 0));
  } else if (tool === 'hammer') { T.push(handle(0.015, -0.06, 0.28), boxC(0.06, 0.13, 0.06, 0x55555f, 0, 0.005, 0.29), boxC(0.064, 0.02, 0.064, 0x3a3a42, 0, 0.07, 0.29)); }
  else if (tool === 'sickle') { T.push(handle(0.017, -0.05, 0.09), P(new THREE.TorusGeometry(0.1, 0.012, 3, 8, Math.PI * 1.15), 0xd8dae0, 0, 0.09, 0.12, 0, Math.PI / 2, -0.2)); }
  else if (tool === 'sword') { // talwar: a disc pommel, a knuckle guard, a broad curved blade
    T.push(P(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), brass, 0, 0, -0.07, Math.PI / 2, 0, 0), handle(0.016, -0.065, 0.04, 0x6b3a1e), boxC(0.11, 0.02, 0.02, brass, 0, 0, 0.045), P(new THREE.TorusGeometry(0.055, 0.007, 3, 6, Math.PI), brass, 0, 0, 0, 0, Math.PI / 2, 0));
    const Rc = 1.1, n = 5;
    for (let i = 0; i < n; i++) {
      const s0 = 0.05 + (i / n) * 0.56, s1 = 0.05 + ((i + 1) / n) * 0.56, sm = (s0 + s1) / 2, th = sm / Rc, wdt = 0.055 * (1 - (i / n) * 0.4);
      T.push(boxC(0.01, wdt, s1 - s0 + 0.006, 0xf2f4f8, 0, Rc * (1 - Math.cos(th)), Rc * Math.sin(th), -th));
    }
    T.push(P(new THREE.ConeGeometry(0.022, 0.06, 4), 0xf2f4f8, 0, Rc * (1 - Math.cos(0.63 / Rc)) + 0.004, Rc * Math.sin(0.63 / Rc), Math.PI / 2 - 0.63 / Rc, 0, 0, 0.45, 1, 1));
  } else if (tool === 'khanda') { // a broad, straight, double-edged sword widening to a blunt tip, a basket hilt
    T.push(P(new THREE.CylinderGeometry(0.026, 0.026, 0.014, 8), brass, 0, 0, -0.095, Math.PI / 2, 0, 0), handle(0.017, -0.095, 0.05, 0x3a1a10), boxC(0.13, 0.026, 0.034, brass, 0, 0, 0.055), P(new THREE.TorusGeometry(0.06, 0.008, 3, 6, Math.PI), brass, 0, 0, -0.02, 0, Math.PI / 2, Math.PI));
    T.push(boxC(0.014, 0.06, 0.28, steelB, 0, 0, 0.21), boxC(0.014, 0.078, 0.26, steelB, 0, 0, 0.47), boxC(0.015, 0.088, 0.06, 0xd0d6e0, 0, 0, 0.63), boxC(0.016, 0.01, 0.5, 0xc0c6d0, 0, 0, 0.36));
  } else if (tool === 'urumi') { // the whip-sword: a ribbon of springy steel rippling from the hilt
    T.push(handle(0.016, -0.07, 0.04, 0x5a3018), P(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 8), 0xc9962e, 0, 0, 0.045, Math.PI / 2, 0, 0));
    let px = 0, py = 0, pz = 0.05;
    for (let i = 0; i < 12; i++) {
      const a = Math.sin(i * 0.7) * 0.5, b = -0.08 - i * 0.03, len = 0.075;
      const nx = px + Math.sin(a) * len * 0.5, nz = pz + Math.cos(a) * Math.cos(b) * len, ny = py + Math.sin(b) * len;
      T.push(boxC(0.03, 0.005, len + 0.006, 0xe8ecf2, (px + nx) / 2, (py + ny) / 2, (pz + nz) / 2, -b, a, 0));
      px = nx; py = ny; pz = nz;
    }
  } else if (tool === 'chakram') T.push(P(new THREE.TorusGeometry(0.11, 0.016, 3, 8), 0xd8dde6, 0, 0, 0.1, Math.PI / 2), P(new THREE.TorusGeometry(0.085, 0.007, 3, 8), brass, 0, 0.006, 0.1, Math.PI / 2));
  else if (tool === 'thali') { // the aarti plate: a brass thali with a diya, flowers and kumkum
    T.push(P(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 5), brass, 0, 0.03, 0.03), P(new THREE.CylinderGeometry(0.115, 0.1, 0.018, 8), brass, 0, 0.065, 0.05), pu(0.022, 0.026, 0.02, 6, C.brick, 0, 0.074, 0.05));
    for (let i = 0; i < 5; i++) { const a = i * 1.26; T.push(knob(0.016, i % 2 ? 0xff9933 : 0xffcc33, Math.cos(a) * 0.068, 0.082, 0.05 + Math.sin(a) * 0.068)); }
    toolFlame = glowMesh(ConeG(0.018, 0.06, 6), 0xffcc33); toolFlame.position.set(0, 0.12, 0.05); grips[1].add(toolFlame);
  } else if (tool === 'sack') T.push(knob(0.1, 0xd6b47a, 0, -0.11, 0.02, 1, 1.15, 0.9), pu(0.04, 0.03, 0.06, 6, 0xb89860, 0, -0.03, 0.02));
  else if (tool === 'herbs') T.push(P(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 5), 0x8a5a2e, 0, 0.02, 0.03), pu(0.045, 0.07, 0.05, 7, 0x8a5a2e, 0, 0.04, 0.05), knob(0.06, 0x5fae4a, 0, 0.09, 0.05, 1, 0.45, 1), P(new THREE.ConeGeometry(0.02, 0.08, 4), 0x3f8a3a, 0.02, 0.13, 0.05, 0, 0, -0.4));
  else if (tool === 'gada') { // a great gold mace: a ribbed head on a stout haft, a spike on top
    T.push(handle(0.024, -0.09, 0.38, 0x6b4223), P(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 8), 0xfff0a0, 0, 0, 0.36, Math.PI / 2, 0, 0), P(new THREE.IcosahedronGeometry(0.14, 1), 0xf2c230, 0, 0, 0.5));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; T.push(boxC(0.02, 0.06, 0.22, 0xc9962e, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.5, 0, 0, a)); }
    T.push(P(new THREE.ConeGeometry(0.035, 0.1, 6), 0xfff0a0, 0, 0, 0.67, Math.PI / 2, 0, 0));
  } else if (tool === 'spear') { // a bhala: a long shaft, a leaf blade, a red tassel, a brass butt
    T.push(handle(0.016, -0.48, 1.04), P(new THREE.OctahedronGeometry(0.06, 0), steelB, 0, 0, 1.13, 0, 0, 0, 0.35, 0.7, 2.2), P(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6), brass, 0, 0, 1.0, Math.PI / 2, 0, 0));
    for (let k = 0; k < 4; k++) T.push(P(new THREE.ConeGeometry(0.012, 0.09, 3), 0xd33b2c, (k - 1.5) * 0.01, -0.05, 0.98, Math.PI, 0, 0));
    T.push(P(new THREE.CylinderGeometry(0.02, 0.016, 0.05, 6), brass, 0, 0, -0.47, Math.PI / 2, 0, 0));
  } else if (tool === 'spade') T.push(handle(0.016, -0.12, 0.5), boxC(0.13, 0.014, 0.16, 0x8d939a, 0, 0, 0.57), boxC(0.08, 0.035, 0.024, 0x8a5a2e, 0, 0, -0.13));
  else if (tool === 'mould') { for (const [w, d, x, z] of [[0.24, 0.02, 0, -0.06], [0.24, 0.02, 0, 0.06], [0.02, 0.13, -0.11, 0], [0.02, 0.13, 0.11, 0]]) T.push(boxC(w, 0.05, d, 0x9a6a3a, x, -0.03, 0.08 + z)); }
  else if (tool === 'tongs') { for (const sx of [-0.013, 0.013]) T.push(P(new THREE.CylinderGeometry(0.009, 0.009, 0.48, 4), 0x3a3a40, sx, 0, 0.22, Math.PI / 2, 0, 0)); T.push(knob(0.036, 0xff7a30, 0, 0, 0.48)); }
  else if (tool === 'potli') T.push(knob(0.064, 0xe8dcc0, 0, -0.08, 0.02, 1, 0.9, 1), pu(0.045, 0.03, 0.045, 6, 0xc84030, 0, -0.03, 0.02), knob(0.026, 0xe8dcc0, 0, 0.02, 0.02));
  else if (tool === 'rod') { // a long bamboo fishing rod, its line hanging from the tip to a red float
    T.push(handle(0.013, -0.12, 1.25, C.bamboo)); for (let k = 0; k < 4; k++) T.push(P(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 5), C.bambooD, 0, 0, 0.1 + k * 0.3, Math.PI / 2, 0, 0));
    T.push(P(new THREE.CylinderGeometry(0.003, 0.003, 0.55, 3), 0xf0e8d0, 0, -0.27, 1.24), P(new THREE.OctahedronGeometry(0.024, 0), 0xd33b2c, 0, -0.55, 1.24));
  }
  if (T.length) grips[1].add(meshOf(T));
  if (tool === 'potli') { toolFlame = glowMesh(CylG(0.022, 0.026, 0.09, 8), 0x7dff9a, 0.9); toolFlame.position.set(0, 0.03, 0.03); grips[0].add(toolFlame); }

  /* the left hand: a dhaal (round shield) facing forward, or the bow */
  if (job === 'warrior' || job === 'spear') { // a domed round shield: a painted face, a brass rim, a boss and four studs
    const bigS = job === 'warrior', r = bigS ? 0.19 : 0.15, col = bigS ? 0xd4a234 : 0x3e5f8a;
    const sp = [P(new THREE.CylinderGeometry(r, r * 0.92, 0.035, 8), col, 0, 0, 0.05, Math.PI / 2, 0, Q8), P(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.006, 8), bigS ? 0xa8392c : 0xe8d8b0, 0, 0, 0.07, Math.PI / 2, 0, Q8),
      P(new THREE.TorusGeometry(r, 0.016, 3, 8), 0x8a5a22, 0, 0, 0.066, 0, 0, Q8), P(new THREE.IcosahedronGeometry(0.042, 0), 0xc9962e, 0, 0, 0.08, 0, 0, 0, 1, 1, 0.6)];
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; sp.push(knob(0.02, 0xfff0a0, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0.076, 1, 1, 0.6)); }
    grips[0].add(meshOf(sp));
  }
  if (job === 'archer' || job === 'longbow') { // a recurve bow (the longbow is a third taller): limbs along the grip's z axis, belly bulging away from the archer (-y)
    const BL = job === 'longbow' ? 0.62 : 0.44, BB = job === 'longbow' ? 0.15 : 0.2;
    const bow = new THREE.Group(); grips[0].add(bow);
    const limbP = [];
    for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * 0.95, a1 = ((k + 1) / 4) * 0.95;
      const p0 = [0, (1 - Math.cos(a0)) * BB, Math.sin(a0) * BL * sz], p1 = [0, (1 - Math.cos(a1)) * BB, Math.sin(a1) * BL * sz];
      const dz = p1[2] - p0[2], dy = p1[1] - p0[1], len = Math.hypot(dy, dz) + 0.012;
      limbP.push(P(new THREE.CylinderGeometry(0.015 - k * 0.002, 0.015 - k * 0.002, len, 5), k === 3 ? 0x5a3820 : 0x8a5a2e, 0, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, Math.atan2(dz, dy), 0, 0));
    }
    limbP.push(P(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), 0xd33b2c, 0, 0, 0, Math.PI / 2, 0, 0)); // the grip wrap
    bow.add(meshOf(limbP));
    const tipY = (1 - Math.cos(0.95)) * BB, tipZ = Math.sin(0.95) * BL;
    ud.bowTip = { y: tipY, z: tipZ };
    const sRest = meshOf([cylC(0.003, 0.003, tipZ * 2, 4, 0xf0e8d0, 0, tipY, 0, Math.PI / 2)], null, true, true);
    const drawn = new THREE.Group();
    const pull = 0.3, dl = Math.hypot(tipZ, pull - tipY), da = Math.atan2(tipZ, pull - tipY);
    drawn.add(meshOf([cylC(0.003, 0.003, dl, 4, 0xf0e8d0, 0, (tipY + pull) / 2, tipZ / 2, -da), cylC(0.003, 0.003, dl, 4, 0xf0e8d0, 0, (tipY + pull) / 2, -tipZ / 2, da),
      cylC(0.006, 0.006, pull + 0.06, 5, 0xc8a46a, 0, pull / 2 - 0.03, 0.0), coneC(0.013, 0.05, 4, 0xd0d4dc, 0, -0.07, 0, Math.PI), coneC(0.018, 0.05, 3, 0xd33b2c, 0, pull - 0.02, 0)], null, true, true));
    drawn.visible = false;
    bow.add(sRest); bow.add(drawn);
    ud.bowRest = sRest; ud.bowDrawn = drawn;
  }

  /* soldiers carry a little brass lantern on the belt at night (both hands stay on their weapons) */
  let torch = null;
  if (army) {
    torch = new THREE.Group();
    torch.add(meshOf([pu(0.032, 0.028, 0.012, 6, 0xc9962e, 0, -0.066, 0), pu(0.026, 0.026, 0.07, 6, 0xfff0c0, 0, -0.054, 0), P(new THREE.ConeGeometry(0.032, 0.03, 6), 0xc9962e, 0, 0.032, 0)], null, true, true));
    const fl = flameCluster(0.06); fl.position.y = -0.045; torch.add(fl); torch.userData.flame = fl;
    torch.position.set(0.16, -0.05, 0.07); torch.rotation.z = 0.1;
    hips.add(torch);
  }
  // the tokri on the back: the renderer swaps its geometry to show what is inside and how full it is
  const pack = meshOf(Models.packGeo('empty'));
  pack.position.set(0, 0.04, -0.2);
  pack.visible = false;
  spine.add(pack);
  const pouch = meshOf(Models.pouchGeo(), null, true);
  pouch.position.set(0.17, -0.03, 0.05);
  pouch.visible = false;
  hips.add(pouch);
  FAB = 0;
  const body3 = skinnedBody(g, hips, bones, skinParts, M);
  const silParts = [body3];
  Object.assign(ud, { hips, spine, torso, head, legs, arms, grips, skirt, pack, pouch, torch, toolFlame, fem, tool, silParts });
  g.userData = ud;
  return g;
};

/* ---------- demons, ghosts and spirit beasts ----------
 * Chunky, hunched creatures cut in broad facets: heavy shoulders and long ape-like arms, big claws,
 * toothy grins, glowing eyes, horns and bone spikes. Every model keeps the renderer's rig:
 *   legs (2, or 4 for beasts: front-left, front-right, back-left, back-right) swing on x · arms (2, the
 *   second holds the weapon) swing on x · hips: the trunk, which leans and bobs · body: a floating ghost,
 *   which sways · wings flap on z · head nods (beasts bite with it) · tail wags · wisps ripple ·
 *   orb / halo / neckFlame pulse.
 */
Models.enemy = function (type, variant) {
  const g = new THREE.Group();
  const ud = { legs: [], arms: [], eyes: [], wings: [], wisps: [] };
  variant = variant || 0;
  // both glowing eyes in one mesh: half the draw calls for every demon on screen
  const eyePair = (c, r, x, y, z) => glowMesh(merge([P(new THREE.OctahedronGeometry(r, 0), c, -x, y, z, 0, 0, 0, 1, 1.2, 0.6), P(new THREE.OctahedronGeometry(r, 0), c, x, y, z, 0, 0, 0, 1, 1.2, 0.6)]), c);
  const eye = (c, r) => glowMesh(new THREE.OctahedronGeometry(r || 0.05, 0), c);
  const M = MAT.char || MAT.std, GH = MAT.bhoot;
  let seed = variant * 97 + type.length * 131;
  // the kit: faceted lumps for muscle, belly and skull (each corner nudged, nothing looks lathe-turned),
  // a limb piece hanging down from a joint, spikes and claws, a grin full of teeth, curling horns
  const lump = (r, c, x, y, z, sx, sy, sz, rx, ry, rz) => P(gemGeo(r, r > 0.16 ? 1 : 0, seed++, 0.2), c, x, y, z, rx || 0, ry || 0, rz || 0, sx || 1, sy || 1, sz || 1);
  const seg = (r0, r1, len, c, x, y, z, sides) => P(new THREE.CylinderGeometry(r1, r0, len, sides || 6), c, x, y - len / 2, z);
  const spike = (r, h, c, x, y, z, rx, ry, rz) => P(new THREE.ConeGeometry(r, h, 4), c, x, y, z, rx || 0, ry || 0, rz || 0);
  const claws = (p, n, r, len, c, x, y, z, gap) => { for (let k = 0; k < n; k++) p.push(spike(r, len, c, x + (k - (n - 1) / 2) * gap, y - len / 2, z + 0.02, Math.PI - 0.4, 0, 0)); };
  const grin = (p, w, h, x, y, z, n, tooth) => {
    p.push(boxC(w, h, 0.035, 0x240810, x, y, z));
    for (let i = 0; i < n; i++) { const tx = x - w / 2 + ((i + 0.5) * w) / n; p.push(spike(w / n * 0.42, h * 0.75, tooth || 0xf4ecd8, tx, y + h * 0.22, z + 0.02, Math.PI)); if (i % 2) p.push(spike(w / n * 0.38, h * 0.6, tooth || 0xf4ecd8, tx, y - h * 0.25, z + 0.02, 0)); }
  };
  const curlHorn = (p, x, y, z, side, R, tube, c, arc) => { // swept out from the skull, up and over (a buffalo's, a ram's)
    arc = arc || Math.PI * 0.8;
    p.push(P(new THREE.TorusGeometry(R, tube, 5, 7, arc), c, x + side * R, y, z, 0, side < 0 ? 0 : Math.PI, 0));
    const ex = Math.cos(arc) * R, ey = Math.sin(arc) * R;
    p.push(spike(tube * 0.95, tube * 3, c, x + side * (R - ex), y + ey, z, 0, 0, side < 0 ? arc : -arc));
  };
  // a ghost's lower body: a coil of shrinking wisps instead of legs (each its own piece, so they ripple)
  const wispTail = (parent, c, top, r0, n, mat) => {
    let y = top;
    for (let i = 0; i < n; i++) {
      const r = r0 * (1 - i / (n + 0.6)), w = new THREE.Group();
      w.position.set(Math.sin(i * 1.4) * 0.09, y, Math.cos(i * 1.4) * 0.07 - 0.04);
      FAB = 5; w.add(meshOf([lump(r, c, 0, 0, 0, 1, 1.15, 1), spike(r * 0.6, r * 1.6, c, 0, -r * 1.1, 0, Math.PI)], mat, true)); FAB = 0;
      parent.add(w); ud.wisps.push(w);
      y -= r * 1.5;
    }
  };

  if (type === 'bhoot') {
    // Bhoot: a shadow wraith. A hunched chest and a horned skull, long clawed arms reaching, a cold heart
    // glowing in its chest, and a coiling wisp where its legs should be.
    const body = new THREE.Group(); g.add(body); ud.body = body;
    const c = 0xb8c6ec, cD = 0x7d8cc0, p = [];
    FAB = 5;
    p.push(lump(0.3, c, 0, 0.86, 0, 1.15, 0.85, 0.85));                    // chest
    for (const sx of [-1, 1]) p.push(lump(0.15, c, sx * 0.27, 0.98, 0.02, 1, 0.8, 1)); // shoulders
    p.push(lump(0.2, c, 0, 0.66, -0.02, 0.9, 0.9, 0.8));                   // waist
    p.push(lump(0.17, c, 0, 1.17, 0.12, 1, 1.05, 1));                      // the skull, pushed forward
    p.push(lump(0.1, cD, 0, 1.08, 0.24, 1.3, 0.6, 0.7));                   // jaw
    FAB = 0;
    grin(p, 0.18, 0.06, 0, 1.08, 0.3, 6);
    for (const sx of [-1, 1]) { p.push(lump(0.05, 0x10131f, sx * 0.065, 1.2, 0.26, 1.2, 1, 0.6)); curlHorn(p, sx * 0.1, 1.3, 0.06, sx, 0.08, 0.03, cD, Math.PI * 0.9); }
    body.add(meshOf(p, GH, true, false));
    body.add(eyePair(0xdff0ff, 0.026, 0.065, 1.2, 0.29));
    const heart = glowMesh(new THREE.OctahedronGeometry(0.07, 0), 0xff4a8a); heart.position.set(0, 0.86, 0.25); body.add(heart); ud.orb = heart;
    wispTail(body, c, 0.48, 0.19, 3, GH);
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.33, 0.98, 0.04); body.add(A);
      const ap = [];
      FAB = 5; ap.push(seg(0.06, 0.045, 0.3, c, 0, 0, 0), lump(0.08, c, 0, -0.38, 0.02, 1, 1.4, 1), lump(0.07, cD, 0, -0.55, 0.04)); FAB = 0;
      claws(ap, 4, 0.016, 0.13, 0xe8eef8, 0, -0.6, 0.06, 0.035);
      A.add(meshOf(ap, GH, true)); ud.arms.push(A);
    }
    ud.armBase = -0.45; // reaching
  } else if (type === 'vetala') {
    // Vetala: a bat-demon. A furred, hunched body, a big head with towering ears, a snout full of fangs,
    // leathery wings of faceted panels between long finger bones, talons tucked under.
    const fur = 0x6a3a8e, furD = 0x4a2468, mem = 0x3a1d52, p = [];
    FAB = 6;
    p.push(lump(0.24, fur, 0, 0, 0, 1, 1.15, 0.95), lump(0.18, fur, 0, 0.3, 0.06));
    for (const sx of [-1, 1]) p.push(spike(0.075, 0.32, fur, sx * 0.11, 0.52, 0.0, 0, 0, -sx * 0.32));
    FAB = 0;
    for (const sx of [-1, 1]) p.push(spike(0.04, 0.18, 0xd09ab8, sx * 0.11, 0.5, 0.035, 0, 0, -sx * 0.32));
    p.push(lump(0.08, 0x8a5aa8, 0, 0.25, 0.2, 1.3, 0.8, 0.8));
    grin(p, 0.12, 0.05, 0, 0.2, 0.25, 5);
    for (const sx of [-1, 1]) p.push(spike(0.018, 0.08, 0xffffff, sx * 0.035, 0.17, 0.26, Math.PI));
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) p.push(spike(0.014, 0.07, 0xd8cbb0, sx * 0.08 + (k - 1) * 0.025, -0.3, 0.04, Math.PI));
    g.add(meshOf(p, M));
    for (const sx of [-1, 1]) {
      const wg = new THREE.Group(); wg.position.set(sx * 0.18, 0.08, 0); g.add(wg);
      const wp = [], tips = [[0.75, 0.32], [0.82, 0.02], [0.62, -0.26]];
      const v = [], tri = (A, B, Cc) => v.push(...A, ...B, ...Cc, ...A, ...Cc, ...B); // both faces, seen from above or below
      for (let k = 0; k < tips.length; k++) { // a membrane panel between each pair of finger bones
        const a = k === 0 ? [0.3, 0.36] : tips[k - 1], b = tips[k];
        tri([0, 0, 0], [sx * a[0], a[1], 0], [sx * b[0], b[1], 0]);
      }
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
      FAB = 4; wp.push(P(mg, mem, 0, 0, 0)); FAB = 0;
      wp.push(P(new THREE.CylinderGeometry(0.02, 0.025, 0.48, 4), furD, sx * 0.15, 0.2, 0, 0, 0, sx * 1.1));
      for (const [tx, ty] of tips) { const L = Math.hypot(tx - 0.3, ty - 0.36); wp.push(P(new THREE.CylinderGeometry(0.008, 0.014, L, 4), furD, sx * (0.3 + tx) / 2, (0.36 + ty) / 2, 0, 0, 0, -sx * Math.atan2(tx - 0.3, ty - 0.36))); }
      wp.push(spike(0.022, 0.08, 0xd8cbb0, sx * 0.3, 0.42, 0, 0, 0, -sx * 0.5)); // the claw at the wrist
      wg.add(meshOf(wp, M)); ud.wings.push(wg);
    }
    g.add(eyePair(0xffe14a, 0.04, 0.065, 0.34, 0.2));
  } else if (type === 'aleya') {
    // Aleya: marsh light. A faceted heart of cold fire inside a slow-turning shell of light, sparks trailing.
    const body = new THREE.Group();
    const core = glowMesh(new THREE.OctahedronGeometry(0.13, 0), 0xf6ffc8);
    const halo = glowMesh(new THREE.IcosahedronGeometry(0.3, 0), 0xb8ff5a, 0.24);
    body.add(core, halo);
    for (let i = 0; i < 4; i++) { const t = glowMesh(new THREE.OctahedronGeometry(0.06 - i * 0.012, 0), 0xd4ff7a, 0.75 - i * 0.16); t.position.set(Math.sin(i * 1.7) * 0.05, 0.03 * i, -0.2 - i * 0.14); body.add(t); }
    g.add(body); ud.body = body; ud.halo = halo;
  } else if (type === 'shakchunni') {
    // Shakchunni: the bride ghost. A white saree that frays into a wisp, a red border, conch-shell and red
    // bangles on long reaching arms, and wet black hair hanging over her face, two red eyes behind it.
    const body = new THREE.Group(); g.add(body); ud.body = body;
    const w = 0xf2eee6, p = [];
    FAB = 5;
    p.push(lump(0.24, w, 0, 0.9, 0, 1.05, 1.1, 0.85), lump(0.16, w, 0, 1.2, 0.05, 1, 1.05, 1));
    p.push(P(new THREE.CylinderGeometry(0.24, 0.12, 0.36, 7), w, 0, 0.6, 0));
    FAB = 0;
    p.push(P(new THREE.CylinderGeometry(0.245, 0.245, 0.04, 7), 0xd22b2b, 0, 0.42, 0)); // laal paar
    p.push(boxC(0.06, 0.5, 0.03, 0xd22b2b, 0.1, 0.92, 0.2, 0, 0, -0.5)); // the pallu's border across her
    FAB = 6; // hair over the face and down her back
    p.push(lump(0.18, 0x15111a, 0, 1.24, 0.0, 1.06, 1.05, 1.04));
    for (let i = 0; i < 5; i++) p.push(boxC(0.055, 0.42 + (i % 2) * 0.1, 0.03, 0x15111a, -0.11 + i * 0.055, 1.02, 0.17, 0.1, 0, (i - 2) * 0.05));
    p.push(boxC(0.3, 0.62, 0.06, 0x15111a, 0, 0.95, -0.12, -0.1));
    FAB = 0;
    body.add(meshOf(p, GH, true, false));
    body.add(eyePair(0xff3a3a, 0.024, 0.06, 1.2, 0.2));
    const sindoor = eye(0xff2a2a, 0.02); sindoor.position.set(0, 1.38, 0.12); body.add(sindoor);
    wispTail(body, w, 0.38, 0.15, 3, GH);
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.24, 1.02, 0.03); body.add(A);
      const ap = [];
      FAB = 5; ap.push(seg(0.045, 0.035, 0.42, w, 0, 0, 0)); FAB = 0;
      ap.push(P(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 6), 0xffffff, 0, -0.34, 0), P(new THREE.CylinderGeometry(0.046, 0.046, 0.025, 6), 0xd22b2b, 0, -0.38, 0));
      claws(ap, 4, 0.011, 0.11, 0xf2e8e0, 0, -0.44, 0.02, 0.022);
      A.add(meshOf(ap, GH, true)); ud.arms.push(A);
    }
    ud.armBase = -0.6;
  } else if (type === 'nishi') {
    // Nishi Dak: the night caller. A tall ragged shroud with a deep hood, two pale eyes far inside it, long
    // pale beckoning arms, and a little lantern of cold light to lead her listener out.
    const body = new THREE.Group(); g.add(body); ud.body = body;
    const cl = 0x2a2542, clD = 0x1a1730, p = [];
    FAB = 5;
    p.push(P(LatheG(V2([[0.36, 0.0], [0.4, 0.08], [0.32, 0.5], [0.26, 0.95], [0.25, 1.24], [0.001, 1.26]]), 8), cl, 0, 0, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push(spike(0.08, 0.2 + (i % 2) * 0.08, clD, Math.cos(a) * 0.37, 0.02, Math.sin(a) * 0.37, Math.PI)); }
    for (const sx of [-1, 1]) p.push(lump(0.14, cl, sx * 0.24, 1.18, 0, 1, 0.8, 1)); // hunched shoulders
    p.push(lump(0.22, cl, 0, 1.42, 0.02, 1, 1.15, 1.05));          // the hood
    FAB = 0;
    p.push(lump(0.15, 0x07060c, 0, 1.38, 0.13, 1, 1.1, 0.7));      // the darkness inside it
    body.add(meshOf(p, GH, true, false));
    body.add(eyePair(0xcfe0ff, 0.028, 0.05, 1.42, 0.22));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.28, 1.16, 0.06); body.add(A);
      const ap = [seg(0.04, 0.028, 0.5, 0xb9bfd6, 0, 0, 0), lump(0.045, 0xb9bfd6, 0, -0.54, 0.02)];
      claws(ap, 4, 0.008, 0.14, 0xb9bfd6, 0, -0.58, 0.02, 0.018);
      A.add(meshOf(ap, GH, true)); ud.arms.push(A);
      if (sx > 0) { const lan = new THREE.Group(); lan.position.set(0, -0.66, 0.05); lan.add(meshOf([P(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3), 0x3a3550, 0, 0.06, 0), P(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 6), 0x3a3550, 0, -0.01, 0)], GH, true)); const lf = glowMesh(new THREE.OctahedronGeometry(0.05, 0), 0x9fb4ff, 0.9); lf.position.y = -0.07; lan.add(lf); A.add(lan); ud.halo = lf; }
    }
    ud.armBase = -1.1; // arms held out, beckoning
    const trail = glowMesh(ConeG(0.36, 0.5, 8, 1, true), 0x8f9cff, 0.16); trail.rotation.x = Math.PI; trail.position.y = 0.12;
    body.add(trail);
  } else if (type === 'mechho' || type === 'skondhokata' || type === 'mamdo') {
    // the walking Bengali ghosts share a rig: hips carries the trunk, two legs, two arms
    const mech = type === 'mechho', skond = type === 'skondhokata', mam = type === 'mamdo';
    const skin = mech ? 0x6fa088 : skond ? 0x5a4a6a : 0x8a9aa0, sD = darkHex(skin, 0.72), sL = mixHex(skin, 0xffffff, 0.2);
    const hips = new THREE.Group(); hips.position.y = mech ? 0.38 : mam ? 0.6 : 0.5; g.add(hips);
    const legLen = hips.position.y;
    for (const sx of [-1, 1]) {
      const L = new THREE.Group(); L.position.set(sx * (mech ? 0.15 : skond ? 0.18 : 0.1), 0, 0); hips.add(L);
      FAB = 4;
      const lp = [lump(mech ? 0.12 : skond ? 0.15 : 0.07, sD, 0, -0.05, 0, 1, 1.2, 1), seg(mech ? 0.08 : skond ? 0.12 : 0.05, mech ? 0.06 : skond ? 0.09 : 0.04, legLen * 0.75, sD, 0, -0.1, 0)];
      FAB = 0;
      lp.push(lump(mech ? 0.11 : skond ? 0.14 : 0.07, mech ? 0x4a7060 : 0x2e2430, 0, -legLen + 0.04, 0.06, 1.3, 0.45, 1.6));
      if (mech) for (let k = -1; k <= 1; k++) lp.push(lump(0.035, 0x4a7060, k * 0.05, -legLen + 0.03, 0.18, 1, 0.5, 1.3)); // webbed toes
      L.add(meshOf(lp, M)); ud.legs.push(L);
    }
    const p = [];
    let hy = 0;
    if (mech) { // Mechho Bhoot: a squat frog-fish ghoul from the ponds, in a checked lungi, fins on his head and back
      FAB = 3; p.push(P(new THREE.CylinderGeometry(0.28, 0.31, 0.2, 8), 0x3e6f9e, 0, -0.06, 0)); FAB = 4;
      p.push(lump(0.34, skin, 0, 0.22, 0.04, 1.05, 0.95, 1)); p.push(lump(0.22, sL, 0, 0.18, 0.2, 1, 1, 0.5));
      hy = 0.52;
      p.push(lump(0.24, skin, 0, hy, 0.12, 1.35, 0.75, 1.1));                 // a wide flat head
      FAB = 0;
      grin(p, 0.34, 0.07, 0, hy - 0.08, 0.36, 9, 0xe8f0d8);
      for (const sx of [-1, 1]) { p.push(lump(0.08, 0xe8f0e0, sx * 0.13, hy + 0.13, 0.22)); p.push(spike(0.05, 0.16, 0x3f6a5a, sx * 0.3, hy, 0.04, 0, 0, -sx * 1.3, 1, 1, 0.3)); } // bulging eyes, gill fins
      for (let i = 0; i < 5; i++) p.push(spike(0.06, 0.2, 0x2f5a4a, 0, hy + 0.16 - i * 0.1, -0.06 - i * 0.06, -0.6 - i * 0.15, 0, 0)); // a fin down the back
      for (let i = 0; i < 4; i++) p.push(lump(0.025, 0x9fd0b8, -0.18 + i * 0.12, 0.08 + (i % 2) * 0.1, 0.34, 0.8, 1.6, 0.8)); // pond-weed drips
    } else if (skond) { // Skondhokata: a headless hulk, hunched over a vast chest, a blue ghost-flame where his head should be
      FAB = 1; p.push(P(new THREE.CylinderGeometry(0.32, 0.36, 0.26, 8), 0xe9e2d0, 0, -0.1, 0)); FAB = 4;
      p.push(lump(0.36, skin, 0, 0.26, 0.04, 1.1, 0.9, 0.9));
      p.push(lump(0.42, skin, 0, 0.58, 0.02, 1.25, 0.85, 0.95));              // the barrel chest
      for (const sx of [-1, 1]) { p.push(lump(0.22, skin, sx * 0.42, 0.72, -0.02)); p.push(lump(0.16, sL, sx * 0.16, 0.56, 0.3, 1.1, 0.8, 0.5)); }
      p.push(lump(0.24, sD, 0, 0.8, -0.14, 1.5, 0.7, 1));                     // the hunched back
      FAB = 0;
      p.push(P(new THREE.CylinderGeometry(0.12, 0.15, 0.1, 6), 0x7a2a2a, 0, 0.86, 0.08)); p.push(P(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 6), 0x3a0c10, 0, 0.92, 0.08));
      p.push(P(new THREE.TorusGeometry(0.4, 0.014, 4, 10), 0xf4ecd8, 0, 0.4, 0.04, Math.PI / 2 - 0.2, 0.5, 0)); // the sacred thread
      const fl = new THREE.Group(); fl.position.set(0, 0.92, 0.08);
      const c1 = glowMesh(ConeG(0.11, 0.36, 5), 0x6fa8ff, 0.8); c1.position.y = 0.18;
      const c2 = glowMesh(ConeG(0.055, 0.22, 4), 0xdcecff); c2.position.y = 0.11;
      fl.add(c1, c2); hips.add(fl); ud.neckFlame = fl;
    } else { // Mamdo Bhoot: tall and gaunt, bent nearly double, ribs showing through a torn kurta, a long white beard
      FAB = 3; p.push(P(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 7), 0x2f4a6a, 0, -0.42, 0)); FAB = 1;
      p.push(P(LatheG(V2([[0.2, -0.12], [0.19, 0.05], [0.17, 0.3], [0.16, 0.48], [0.12, 0.58], [0.001, 0.6]]), 7), 0xd8d4c8, 0, 0, 0.03, 0.25, 0, 0));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push(spike(0.045, 0.13, 0xcfcab9, Math.cos(a) * 0.2, -0.16, 0.03 + Math.sin(a) * 0.2, Math.PI)); }
      FAB = 4;
      for (let k = 0; k < 4; k++) p.push(boxC(0.22 - k * 0.02, 0.02, 0.02, skin, 0, 0.18 + k * 0.08, 0.2 + k * 0.02, 0.25)); // ribs through the tear
      FAB = 1; for (const sx of [-1, 1]) p.push(lump(0.09, 0xd8d4c8, sx * 0.21, 0.5, 0.06, 1, 0.8, 1)); FAB = 4; // bony shoulders under the cloth
      p.push(P(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), skin, 0, 0.66, 0.14, 0.7, 0, 0));
      hy = 0.78;
      p.push(lump(0.15, skin, 0, hy, 0.24, 0.9, 1.15, 0.95));
      FAB = 0;
      for (const sx of [-1, 1]) { p.push(lump(0.045, 0x14161c, sx * 0.055, hy + 0.03, 0.36, 1.1, 1.2, 0.6)); p.push(spike(0.03, 0.15, 0xdcdad2, sx * 0.13, hy + 0.05, 0.18, 0.6, 0, sx * 1.2)); }
      p.push(boxC(0.13, 0.025, 0.035, 0x14161c, 0, hy + 0.09, 0.37));
      p.push(spike(0.024, 0.07, sD, 0, hy - 0.01, 0.4, Math.PI / 2));
      FAB = 6; p.push(spike(0.1, 0.4, 0xe8e6e0, 0, hy - 0.24, 0.32, Math.PI - 0.35)); p.push(lump(0.08, 0xe8e6e0, 0, hy - 0.08, 0.35, 1.4, 0.7, 0.7)); FAB = 0;
    }
    hips.add(meshOf(p, M, false, false, skond));
    if (mech) hips.add(eyePair(0xb8ff6a, 0.034, 0.13, hy + 0.14, 0.29));
    if (mam) hips.add(eyePair(0xc8ff9a, 0.022, 0.055, hy + 0.03, 0.39));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * (mech ? 0.33 : skond ? 0.54 : 0.23), mech ? 0.36 : skond ? 0.72 : 0.5, mech ? 0.06 : 0.02); hips.add(A);
      const AL = mech ? 0.34 : skond ? 0.62 : 0.56; // the headless one's fists hang almost to the ground
      FAB = mam ? 1 : 4;
      const ap = [lump(mech ? 0.08 : skond ? 0.16 : 0.06, mam ? 0xd8d4c8 : skin, 0, 0, 0), seg(mech ? 0.06 : skond ? 0.12 : 0.04, mech ? 0.05 : skond ? 0.1 : 0.03, AL * 0.55, mam ? 0xd8d4c8 : skin, 0, -0.04, 0)];
      FAB = 4;
      ap.push(lump(mech ? 0.07 : skond ? 0.17 : 0.045, skin, 0, -AL * 0.7, 0.02, 1, 1.3, 1), lump(mech ? 0.07 : skond ? 0.15 : 0.04, sD, 0, -AL - 0.02, 0.03, 1.1, 0.9, 1.1));
      FAB = 0;
      claws(ap, mech ? 3 : 4, mech ? 0.016 : skond ? 0.024 : 0.009, mam ? 0.16 : 0.08, mech ? 0x2f4a3a : 0xe8dcc0, 0, -AL - 0.08, 0.05, mam ? 0.02 : 0.04);
      A.add(meshOf(ap, M)); ud.arms.push(A);
    }
    if (mech) ud.arms[1].add(meshOf([lump(0.07, 0xd9a14a, 0, -0.42, 0.14, 0.7, 0.85, 2.2), spike(0.08, 0.12, 0xc28a3a, 0, -0.42, -0.04, -Math.PI / 2, 0, 0, 1, 1, 0.4)], M)); // a stolen fish
    if (skond) { // he carries his own head under his arm
      FAB = 4; const hp = [lump(0.18, skin, 0, -0.62, 0.16)]; FAB = 6; hp.push(lump(0.14, 0x1b1020, 0, -0.52, 0.1, 1.2, 0.6, 1.1)); FAB = 0;
      grin(hp, 0.16, 0.05, 0, -0.68, 0.32, 6);
      ud.arms[0].add(meshOf(hp, M)); ud.arms[0].add(eyePair(0xff6a3a, 0.03, 0.06, -0.6, 0.32));
    }
    if (mam) ud.armBase = -0.55; // reaching for a neck
    ud.hips = hips; ud.hipY = hips.position.y;
  } else if (type === 'shiyal' || type === 'bagh' || type === 'shuar') {
    // spirit beasts on four legs: hips is the whole body; a head that bites, a tail that lashes
    const jackal = type === 'shiyal', tiger = type === 'bagh', boar = type === 'shuar';
    const mat = boar ? M : GH;
    const skin = jackal ? 0x9fe0c8 : tiger ? 0xffa040 : 0x6a3a30, sD = darkHex(skin, 0.7), sL = mixHex(skin, 0xffffff, jackal ? 0.3 : 0.35);
    const legH = jackal ? 0.36 : tiger ? 0.42 : 0.4, bw = jackal ? 0.1 : tiger ? 0.16 : 0.2, fz = jackal ? 0.24 : tiger ? 0.34 : 0.32, bz = jackal ? -0.22 : tiger ? -0.34 : -0.3;
    const hips = new THREE.Group(); hips.position.y = legH; g.add(hips);
    for (const [lx, lz] of [[-bw, fz], [bw, fz], [-bw, bz], [bw, bz]]) {
      const L = new THREE.Group(); L.position.set(lx, 0, lz); hips.add(L);
      FAB = jackal ? 5 : tiger ? 7 : 6;
      const lr = jackal ? 0.045 : tiger ? 0.07 : 0.075;
      const lp = [lump(lr * 1.5, skin, 0, -0.02, 0, 1, 1.3, 1.2), seg(lr, lr * 0.75, legH * 0.85, sD, 0, -0.06, 0)];
      FAB = 0;
      lp.push(lump(lr * 1.2, boar ? 0x2a1a14 : sD, 0, -legH + lr * 0.4, 0.03, 1.1, 0.55, 1.4));
      if (!boar) claws(lp, 3, lr * 0.25, lr * 0.9, 0xf2ead0, 0, -legH + lr * 0.5, lr * 1.3, lr * 0.5);
      L.add(meshOf(lp, mat)); ud.legs.push(L);
    }
    const p = [];
    FAB = jackal ? 5 : tiger ? 7 : 6;
    if (jackal) { p.push(lump(0.15, skin, 0, 0.06, 0.12, 0.9, 0.95, 1.2), lump(0.13, skin, 0, 0.04, -0.12, 0.85, 0.85, 1.3)); }
    else if (tiger) { p.push(lump(0.24, skin, 0, 0.1, 0.18, 1, 1, 1.15), lump(0.22, skin, 0, 0.06, -0.16, 0.95, 0.9, 1.25), lump(0.14, sL, 0, -0.06, 0.14, 1.1, 0.6, 1.3)); }
    else { p.push(lump(0.32, skin, 0, 0.16, 0.12, 1, 1.05, 1.1), lump(0.27, skin, 0, 0.08, -0.16, 1, 0.95, 1.15)); } // the boar: a great humped shoulder
    FAB = 0;
    if (boar) for (let i = 0; i < 9; i++) { // a crest of bone spikes, longest over the shoulders, like a spined beast of the deep forest
      const t = i / 8, z = 0.36 - t * 0.78, h = 0.22 + Math.sin(t * Math.PI) * 0.2;
      for (const sx of i % 2 ? [-1, 1] : [0]) p.push(spike(0.05, h, i % 3 ? 0xf0dcc8 : 0xe8a0a8, sx * 0.1, 0.38 + Math.sin(t * Math.PI) * 0.1, z, -0.55, 0, sx * 0.45));
    }
    if (tiger) for (let i = 0; i < 4; i++) p.push(boxC(0.46, 0.035, 0.05, 0x2a1a10, 0, 0.18 + (i % 2) * 0.02, 0.26 - i * 0.16, 0, 0, 0)); // stripes over the back
    hips.add(meshOf(p, mat, false, false));
    // the head, on its own joint so it can bite
    const head = new THREE.Group(); head.position.set(0, jackal ? 0.1 : tiger ? 0.16 : 0.12, fz + (jackal ? 0.1 : 0.12)); hips.add(head); ud.head = head;
    const hp = [];
    FAB = jackal ? 5 : tiger ? 7 : 6;
    if (jackal) {
      hp.push(lump(0.11, skin, 0, 0.04, 0.04, 1, 0.95, 1.1), spike(0.06, 0.2, skin, 0, 0.0, 0.18, Math.PI / 2, 0, 0, 1, 1, 0.8)); // a long pointed snout
      for (const sx of [-1, 1]) hp.push(spike(0.04, 0.14, skin, sx * 0.06, 0.15, 0.0, -0.2, 0, -sx * 0.25));
    } else if (tiger) {
      hp.push(lump(0.18, skin, 0, 0.04, 0.06, 1.1, 0.95, 1), lump(0.11, sL, 0, -0.04, 0.17, 1.2, 0.8, 0.9));
      for (const sx of [-1, 1]) hp.push(spike(0.05, 0.08, skin, sx * 0.12, 0.17, 0.0, 0, 0, -sx * 0.3));
      for (let i = 0; i < 3; i++) hp.push(boxC(0.05, 0.02, 0.1, 0x2a1a10, (i - 1) * 0.06, 0.18, 0.04, 0, 0, (i - 1) * 0.3));
    } else {
      hp.push(lump(0.2, skin, 0, 0.0, 0.08, 1, 0.95, 1.2), lump(0.11, sD, 0, -0.06, 0.28, 1, 0.85, 1));
      for (const sx of [-1, 1]) hp.push(spike(0.04, 0.12, sD, sx * 0.11, 0.16, -0.02, -0.4, 0, -sx * 0.4));
    }
    FAB = 0;
    if (jackal) grin(hp, 0.08, 0.035, 0, -0.03, 0.24, 5);
    else if (tiger) { grin(hp, 0.16, 0.06, 0, -0.07, 0.26, 6); for (const sx of [-1, 1]) hp.push(spike(0.018, 0.08, 0xffffff, sx * 0.05, -0.1, 0.27, Math.PI)); }
    else { for (const sx of [-1, 1]) { hp.push(spike(0.035, 0.24, 0xf4ecd8, sx * 0.1, -0.02, 0.32, 0.5, 0, -sx * 0.6)); hp.push(spike(0.025, 0.14, 0xf4ecd8, sx * 0.06, -0.1, 0.36, 0.9, 0, -sx * 0.3)); } } // tusks
    head.add(meshOf(hp, mat));
    head.add(eyePair(jackal ? 0xeaffd8 : tiger ? 0xffe066 : 0xff5ad0, jackal ? 0.022 : 0.03, jackal ? 0.05 : 0.08, jackal ? 0.08 : 0.08, jackal ? 0.12 : tiger ? 0.2 : 0.22));
    if (boar) { const orb = glowMesh(new THREE.IcosahedronGeometry(0.06, 0), 0xff4ad8, 0.9); orb.position.set(0, -0.05, 0.4); head.add(orb); ud.orb = orb; } // a glowing pink snout
    // the tail
    const tail = new THREE.Group(); tail.position.set(0, jackal ? 0.08 : 0.12, bz - 0.08); hips.add(tail); ud.tail = tail;
    FAB = jackal ? 5 : tiger ? 7 : 6;
    tail.add(meshOf(jackal ? [lump(0.08, skin, 0, 0.02, -0.14, 0.9, 0.9, 1.8), spike(0.06, 0.14, sL, 0, 0.03, -0.32, -Math.PI / 2)] : tiger ? [P(new THREE.CylinderGeometry(0.025, 0.04, 0.5, 5), skin, 0, 0.12, -0.2, -0.9, 0, 0), spike(0.04, 0.1, 0x2a1a10, 0, 0.3, -0.38, -0.6)] : [P(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 4), sD, 0, 0.05, -0.1, -1.1, 0, 0)], mat));
    FAB = 0;
    ud.hips = hips; ud.hipY = hips.position.y;
  } else if (type === 'naag') {
    // Naag Pret: a ghost cobra. Coils on the ground, a body reared high, its hood spread with the old marks,
    // fangs and two green eyes. It glides; the whole serpent sways as it comes.
    const body = new THREE.Group(); g.add(body); ud.body = body;
    const c = 0x7fe0a0, cD = 0x3f9a6a, p = [];
    FAB = 5;
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; p.push(lump(0.1, i % 2 ? c : cD, Math.cos(a) * 0.24, 0.07, Math.sin(a) * 0.24 - 0.05, 1, 0.75, 1)); } // the coil
    for (let i = 0; i < 6; i++) { const t = i / 5; p.push(lump(0.09 - t * 0.012, i % 2 ? c : cD, Math.sin(t * 2.6) * 0.06, 0.16 + t * 0.58, 0.12 + Math.sin(t * Math.PI) * 0.08, 1, 1.3, 0.9)); } // rearing up
    p.push(lump(0.18, c, 0, 0.84, 0.16, 1.5, 1.1, 0.35));        // the hood
    p.push(lump(0.08, cD, 0, 0.92, 0.26, 1.2, 0.8, 1.1));        // the head
    FAB = 0;
    for (const sx of [-1, 1]) p.push(lump(0.035, 0x1d4a30, sx * 0.08, 0.86, 0.22, 1.2, 1, 0.4)); // the spectacle marks on the hood
    grin(p, 0.07, 0.03, 0, 0.88, 0.34, 2);
    for (const sx of [-1, 1]) p.push(spike(0.01, 0.05, 0xffffff, sx * 0.02, 0.86, 0.34, Math.PI));
    body.add(meshOf(p, GH, true, false));
    body.add(eyePair(0x9aff6a, 0.02, 0.04, 0.95, 0.3));
  } else {
    // the horned demons and the great asuras share one hunched, heavy-shouldered rig, each with his own look:
    // Rakshasa (a spiked club, bone spines down his back), Danav (a troll in jade-and-gold armour with a
    // stone maul), Rakta Bindu (a little blood imp), Mahasura (buffalo horns, gold crown and armour, red
    // cape, a great gold mace), Bakasura (a vast belly that opens into a second, toothy maw; an uprooted
    // tree), Raktabija (crimson hide running with glowing blood, a ruby crown, a khanda), Kalanemi (an
    // indigo sorcerer in violet robes: a tall mukut, a third eye, a staff with a crescent and an orb)
    const bk = ENEMIES[type] && ENEMIES[type].boss ? type : null, big = !!bk;
    const maha = bk === 'boss', baka = bk === 'bakasura', rakta = bk === 'raktabija', kala = bk === 'kalanemi', imp = type === 'rakta', giant = type === 'danav';
    const skins = [0x5fa86a, 0x4f78c0, 0xb84a52, 0x7a55b0];
    const skin = maha ? 0x4b3a6e : baka ? 0xb0a43a : rakta ? 0xa01c26 : kala ? 0x3a4490 : imp ? 0xc82430 : giant ? 0x6a9ab8 : skins[variant % skins.length];
    const sD = darkHex(skin, 0.72), sL = mixHex(skin, 0xffffff, 0.22);
    const bone = 0xeee2c4, gold = 0xf2c230, jade = 0x3f9a6a;
    const G2 = giant || maha; // the broadest shoulders
    const hips = new THREE.Group(); hips.position.y = 0.5; g.add(hips);
    for (const sx of [-1, 1]) { // short, thick legs: a heavy thigh, a shin that narrows, a broad clawed foot
      const L = new THREE.Group(); L.position.set(sx * (baka ? 0.19 : 0.16), 0, 0); hips.add(L);
      FAB = 4;
      const lp = [lump(baka ? 0.16 : 0.13, sD, 0, -0.06, 0, 1, 1.2, 1), seg(0.11, 0.08, 0.3, sD, 0, -0.14, 0)];
      FAB = 0;
      lp.push(lump(0.12, darkHex(skin, 0.5), 0, -0.45, 0.06, 1.1, 0.5, 1.5));
      for (let k = -1; k <= 1; k++) lp.push(spike(0.026, 0.08, bone, k * 0.055, -0.46, 0.22, Math.PI / 2, 0, 0));
      if (giant) { FAB = 8; lp.push(seg(0.135, 0.125, 0.16, jade, 0, -0.2, 0)); FAB = 0; lp.push(P(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 6), gold, 0, -0.2, 0)); }
      if (maha) { FAB = 8; lp.push(seg(0.125, 0.115, 0.14, gold, 0, -0.24, 0)); FAB = 0; }
      if (kala) { FAB = 2; lp.push(seg(0.15, 0.2, 0.36, 0x4a2278, 0, -0.06, 0)); FAB = 0; }
      L.add(meshOf(lp, M)); ud.legs.push(L);
    }
    const p = [];
    const cloth = maha ? 0xa82222 : baka ? 0x8a6a3a : rakta ? 0x24141a : kala ? 0x5a2a8a : giant ? 0x2f6a4a : imp ? 0x3a1414 : 0xf09a32;
    FAB = maha || kala ? 2 : baka || imp ? 1 : giant ? 8 : 7; // red silk, robes, rags, jade scale, tiger skin
    p.push(P(new THREE.CylinderGeometry(0.3, 0.34, 0.22, 8), cloth, 0, -0.06, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push(spike(0.07, 0.14, cloth, Math.cos(a) * 0.32, -0.2, Math.sin(a) * 0.32, Math.PI)); }
    FAB = 4;
    const bellyR = baka ? 0.5 : imp ? 0.24 : 0.33, chY = baka ? 0.58 : imp ? 0.42 : 0.5, shX = G2 ? 0.44 : baka ? 0.42 : imp ? 0.24 : 0.36;
    p.push(lump(bellyR, skin, 0, baka ? 0.26 : 0.2, baka ? 0.1 : 0.06, 1.05, 0.95, 0.95));
    if (!baka) p.push(lump(bellyR * 0.7, sL, 0, 0.16, 0.22, 1, 1, 0.55)); // the paler belly
    for (const sx of [-1, 1]) {
      p.push(lump(imp ? 0.12 : 0.17, skin, sx * (imp ? 0.1 : 0.14), chY, 0.16, 1.1, 0.8, 0.7));            // pecs
      p.push(lump(G2 ? 0.25 : imp ? 0.13 : 0.19, skin, sx * shX, chY + 0.08, -0.02, 1, 0.9, 1));            // great shoulders
    }
    p.push(lump(imp ? 0.15 : 0.23, sD, 0, chY + 0.1, -0.12, 1.5, 0.8, 1.1));                                 // the hunched back
    FAB = 0;
    if (baka) { // the belly opens into a second maw, ringed with teeth, a sickly glow deep inside
      p.push(lump(0.2, 0x3a0a10, 0, 0.26, 0.5, 0.75, 1.3, 0.4));
      for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) p.push(spike(0.035, 0.1, 0xf4ecd8, sx * 0.1, 0.06 + i * 0.075, 0.55, 0, 0, sx * Math.PI / 2));
      const maw = glowMesh(new THREE.OctahedronGeometry(0.1, 0), 0xc8ff4a, 0.85); maw.scale.set(0.45, 1.7, 0.3); maw.position.set(0, 0.26, 0.56); hips.add(maw);
      for (let i = 0; i < 6; i++) p.push(spike(0.06, 0.22, sD, 0, chY + 0.06 - i * 0.1, -0.3 - i * 0.04, -0.8, 0, 0)); // a ridge of spines down his back
      p.push(P(new THREE.TorusGeometry(0.38, 0.035, 4, 10), 0xb89a6a, 0, -0.02, 0, Math.PI / 2)); // a rope belt
    } else if (!maha && !kala && !imp && !giant && !rakta) { // the common Rakshasa: bone spines from neck to tail, a mala of skulls
      for (let i = 0; i < 5; i++) p.push(spike(0.05, 0.22 - i * 0.02, bone, 0, chY + 0.12 - i * 0.12, -0.28 - Math.sin(i * 0.6) * 0.04, -0.85, 0, 0));
      for (let i = 0; i < 5; i++) { const a = -0.8 + (i / 4) * 1.6; p.push(lump(0.045, 0xeee6d2, Math.sin(a) * 0.24, chY + 0.06 - Math.cos(a) * 0.05, Math.cos(a) * 0.26 + 0.02)); }
    }
    if (giant) { // jade plates rimmed with gold over the shoulders, chest and belt, studded with gold
      FAB = 8;
      for (const sx of [-1, 1]) p.push(lump(0.28, jade, sx * 0.46, chY + 0.14, -0.02, 1.1, 0.75, 1.1));
      p.push(boxC(0.52, 0.3, 0.1, jade, 0, chY - 0.04, 0.3, -0.1));
      FAB = 0;
      p.push(boxC(0.56, 0.04, 0.12, gold, 0, chY + 0.12, 0.31, -0.1)); p.push(boxC(0.56, 0.04, 0.12, gold, 0, chY - 0.2, 0.29, -0.1));
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) p.push(spike(0.035, 0.12, gold, sx * (0.38 + k * 0.08), chY + 0.36, -0.06 + k * 0.05, 0, 0, -sx * 0.4));
      p.push(P(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 8), gold, 0, 0.06, 0));
      p.push(boxC(0.24, 0.3, 0.04, jade, 0, -0.14, 0.34)); // the apron
    }
    if (maha) { // gold breastplate, belt, and the royal red cape
      FAB = 8; p.push(boxC(0.5, 0.26, 0.08, gold, 0, chY, 0.3, -0.12)); FAB = 0;
      p.push(P(new THREE.CylinderGeometry(0.35, 0.36, 0.08, 8), gold, 0, 0.04, 0));
      FAB = 2; p.push(boxC(0.8, 1.05, 0.04, 0x8a1a1a, 0, 0.22, -0.38, 0.14)); FAB = 0; p.push(boxC(0.82, 0.06, 0.05, gold, 0, 0.74, -0.32, 0.14));
    } else if (rakta) {
      p.push(P(new THREE.TorusGeometry(0.28, 0.045, 4, 10), gold, 0, chY + 0.1, 0.02, Math.PI / 2 - 0.25));
      for (let i = 0; i < 5; i++) p.push(P(new THREE.OctahedronGeometry(0.032, 0), 0xe8202c, -0.16 + i * 0.08, chY + 0.05 + Math.abs(i - 2) * 0.012, 0.28));
    } else if (kala) { // a violet robe to the shins, a silver sash, rudraksha beads, the cape
      FAB = 2; p.push(P(new THREE.CylinderGeometry(0.3, 0.42, 0.62, 8), 0x5a2a8a, 0, -0.34, 0)); FAB = 0;
      p.push(boxC(0.06, 0.62, 0.03, 0xcfd6e6, 0.05, 0.28, 0.3, 0.2, 0, 0.55));
      for (let i = 0; i < 9; i++) { const a = -1.1 + (i / 8) * 2.2; p.push(lump(0.028, 0x6b2a1e, Math.sin(a) * 0.27, chY + 0.1 - Math.cos(a) * 0.09, Math.cos(a) * 0.25 + 0.04)); }
      FAB = 2; p.push(boxC(0.7, 0.95, 0.04, 0x3a1a66, 0, 0.3, -0.36, 0.12)); FAB = 0;
    }
    // the head: hunched low between the shoulders and thrust forward, a jutting jaw, a heavy brow, a grin of teeth
    const hy = imp ? 0.66 : chY + 0.26, hz = imp ? 0.1 : 0.16, HR = imp ? 0.21 : baka ? 0.17 : G2 ? 0.2 : 0.22;
    FAB = 4;
    p.push(lump(HR, skin, 0, hy, hz, 1, 0.95, 1));
    p.push(lump(HR * 0.62, sL, 0, hy - HR * 0.45, hz + HR * 0.55, 1.35, 0.75, 0.8));
    p.push(boxC(HR * 1.4, HR * 0.3, HR * 0.42, sD, 0, hy + HR * 0.36, hz + HR * 0.66, 0.3));
    FAB = 0;
    grin(p, HR * 1.05, HR * 0.24, 0, hy - HR * 0.45, hz + HR * 0.98, 6);
    for (const sx of [-1, 1]) {
      if (!kala) p.push(spike(0.03, HR * 0.6, bone, sx * HR * 0.48, hy - HR * 0.3, hz + HR * 0.88, 0.3, 0, -sx * 0.25)); // tusks
      p.push(lump(HR * 0.26, 0x2a0a0a, sx * HR * 0.38, hy + HR * 0.1, hz + HR * 0.82, 1, 0.8, 0.5));           // sockets
    }
    if (maha) { // buffalo horns under a gold crown
      for (const sx of [-1, 1]) curlHorn(p, sx * HR * 0.8, hy + HR * 0.55, hz - 0.02, sx, 0.26, 0.065, 0xece0c4, Math.PI * 0.7);
      p.push(P(new THREE.CylinderGeometry(0.17, 0.19, 0.12, 6), gold, 0, hy + HR * 0.95, hz - 0.02));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.push(spike(0.045, 0.16, gold, Math.cos(a) * 0.16, hy + HR * 0.95 + 0.12, hz - 0.02 + Math.sin(a) * 0.16)); }
      p.push(P(new THREE.OctahedronGeometry(0.05, 0), 0xff3a3a, 0, hy + HR * 0.95 + 0.05, hz + 0.17));
    } else if (giant) { // a headdress: a jade band and a crest of gold blades, like a jungle king's
      FAB = 8; p.push(P(new THREE.CylinderGeometry(HR * 1.02, HR * 1.05, 0.1, 6), jade, 0, hy + HR * 0.55, hz)); FAB = 0;
      for (let i = 0; i < 5; i++) p.push(spike(0.04, 0.24 - Math.abs(i - 2) * 0.04, gold, (i - 2) * 0.07, hy + HR * 0.55 + 0.15, hz - 0.02, 0, 0, (i - 2) * 0.18));
      p.push(P(new THREE.OctahedronGeometry(0.045, 0), 0x6ff6c8, 0, hy + HR * 0.55, hz + HR + 0.01));
    } else if (rakta) { // a ruby crown with flame-shaped points, long black hair
      p.push(P(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 7), gold, 0, hy + HR * 0.85, hz));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; p.push(spike(0.045, 0.18, gold, Math.cos(a) * 0.18, hy + HR * 0.85 + 0.14, hz + Math.sin(a) * 0.18)); }
      p.push(P(new THREE.OctahedronGeometry(0.06, 0), 0xe8202c, 0, hy + HR * 0.85, hz + 0.2));
      FAB = 6; for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 2.2; p.push(spike(0.06, 0.32, 0x1a0a0e, Math.sin(a) * 0.17, hy, hz - 0.16, -1.3, 0, a * 0.5)); } FAB = 0;
    } else if (kala) { // a tall mukut and a third eye, long hair behind
      p.push(P(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 7), gold, 0, hy + HR * 0.8, hz));
      p.push(P(LatheG(V2([[0.18, 0], [0.16, 0.12], [0.11, 0.3], [0.05, 0.46], [0.001, 0.56]]), 7), 0xd4b040, 0, hy + HR * 0.8 + 0.05, hz));
      for (let i = 0; i < 4; i++) p.push(P(new THREE.OctahedronGeometry(0.03, 0), 0x8a5aff, Math.cos(i * 1.57) * 0.15, hy + HR * 0.8 + 0.12, hz + Math.sin(i * 1.57) * 0.15));
      FAB = 6; for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; p.push(spike(0.06, 0.36, 0x15102a, Math.sin(a) * 0.18, hy - 0.04, hz - 0.15, -1.35, 0, a * 0.5)); } FAB = 0;
    } else if (baka) { // a topknot of black hair, little ears
      FAB = 6; p.push(lump(0.12, 0x1a1214, 0, hy + HR * 0.95, hz - 0.04, 1.2, 0.9, 1.1)); FAB = 0;
      for (const sx of [-1, 1]) p.push(lump(0.05, skin, sx * HR * 1.02, hy + 0.02, hz, 0.6, 1, 1));
    } else { // horns: two sweeping spikes (little ones for the imp), and a wild mane behind
      for (const sx of [-1, 1]) {
        if (imp) p.push(spike(0.035, 0.14, bone, sx * HR * 0.6, hy + HR * 0.85, hz, -0.3, 0, -sx * 0.5));
        else curlHorn(p, sx * HR * 0.55, hy + HR * 0.75, hz - 0.03, sx, 0.13, 0.045, bone, Math.PI * 0.55);
      }
      if (!imp) { FAB = 6; for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 2.4; p.push(spike(0.07, 0.3, 0x1b1020, Math.sin(a) * 0.15, hy + HR * 0.5, hz - 0.15, -1.0, 0, a * 0.55)); } FAB = 0; }
    }
    hips.add(meshOf(p, M, false, false, big));
    hips.add(eyePair(kala ? 0xd0a8ff : rakta ? 0xffd040 : giant ? 0x8affe0 : 0xff3d2e, HR * 0.16, HR * 0.38, hy + HR * 0.1, hz + HR * 0.92));
    if (kala) { const third = eye(0xd0a8ff, 0.03); third.position.set(0, hy + HR * 0.4, hz + HR * 0.98); hips.add(third); }
    if (rakta) { // glowing drops of blood that run down his hide
      const drops = [];
      for (let i = 0; i < 9; i++) { const a = i * 2.4, yy = 0.12 + (i % 4) * 0.14; drops.push(P(new THREE.OctahedronGeometry(0.03, 0), 0xff2030, Math.cos(a) * 0.36, yy, Math.sin(a) * 0.32 + 0.04, 0, 0, 0, 1, 1.7, 1)); }
      hips.add(glowMesh(merge(drops), 0xff2030, 0.95));
    }
    for (const sx of [-1, 1]) { // long, heavy, ape-like arms: a big forearm and a clawed fist that hangs low
      const A = new THREE.Group(); A.position.set(sx * shX * 1.1, chY + 0.06, 0); hips.add(A);
      const AL = imp ? 0.3 : G2 ? 0.52 : baka ? 0.42 : 0.46;
      FAB = 4;
      const ap = [lump(G2 ? 0.14 : imp ? 0.08 : 0.12, skin, 0, -0.06, 0), seg(G2 ? 0.11 : imp ? 0.06 : 0.09, G2 ? 0.095 : imp ? 0.05 : 0.08, AL * 0.45, skin, 0, -0.08, 0),
        lump(G2 ? 0.16 : imp ? 0.08 : 0.13, skin, 0, -AL * 0.66, 0.02, 1, 1.3, 1), lump(G2 ? 0.13 : imp ? 0.07 : 0.11, sD, 0, -AL - 0.02, 0.03, 1.1, 0.9, 1.1)];
      FAB = 0;
      claws(ap, 3, imp ? 0.014 : 0.02, imp ? 0.06 : 0.09, bone, 0, -AL - 0.1, 0.06, imp ? 0.03 : 0.05);
      if (giant) { FAB = 8; ap.push(seg(0.15, 0.14, 0.18, jade, 0, -AL * 0.5, 0.02)); FAB = 0; ap.push(P(new THREE.CylinderGeometry(0.155, 0.155, 0.03, 6), gold, 0, -AL * 0.5, 0.02), P(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 6), gold, 0, -AL * 0.5 - 0.18, 0.02)); }
      else if (!imp) ap.push(P(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6), big ? gold : 0xb8860b, 0, -AL * 0.38, 0)); // arm ring
      if (kala) { FAB = 2; ap.push(seg(0.13, 0.17, 0.26, 0x5a2a8a, 0, -0.12, 0)); FAB = 0; }
      A.add(meshOf(ap, M)); ud.arms.push(A);
    }
    const AL = G2 ? 0.52 : baka ? 0.42 : 0.46, W = [];
    if (maha) { W.push(seg(0.04, 0.04, 0.85, 0x6b4223, 0, -AL - 0.05, 0.1)); W.push(lump(0.22, gold, 0, -AL - 0.95, 0.1)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; W.push(spike(0.045, 0.14, 0xfff0a0, Math.cos(a) * 0.22, -AL - 0.95, 0.1 + Math.sin(a) * 0.22, Math.PI / 2, 0, a + Math.PI / 2)); } }
    else if (giant) { W.push(seg(0.045, 0.05, 0.8, 0x5a3a20, 0, -AL - 0.04, 0.1)); W.push(lump(0.24, 0x8f8a80, 0, -AL - 0.92, 0.1, 1.1, 0.85, 1)); W.push(P(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 6), gold, 0, -AL - 0.92, 0.1)); } // a stone maul
    else if (baka) { // a whole young tree, torn up by the roots
      W.push(P(new THREE.CylinderGeometry(0.07, 0.13, 1.1, 6), 0x6b4a2a, 0, -AL - 0.55, 0.12));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; W.push(P(new THREE.CylinderGeometry(0.012, 0.022, 0.24, 4), 0x5a3a20, Math.cos(a) * 0.12, -AL, 0.12 + Math.sin(a) * 0.12, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8)); }
      for (let i = 0; i < 3; i++) W.push(lump(0.15, i % 2 ? 0x4f7a32 : 0x3f6a2a, (i - 1) * 0.1, -AL - 1.12 - (i % 2) * 0.08, 0.12));
    } else if (rakta) { // a broad khanda, bloodied
      W.push(seg(0.035, 0.035, 0.22, 0x5a3018, 0, -AL - 0.04, 0.1)); W.push(boxC(0.2, 0.04, 0.06, gold, 0, -AL - 0.24, 0.1));
      W.push(boxC(0.13, 0.8, 0.025, 0xdfe4ec, 0, -AL - 0.66, 0.1)); W.push(spike(0.075, 0.14, 0xdfe4ec, 0, -AL - 1.12, 0.1, Math.PI, 0, 0, 1, 1, 0.2));
      W.push(boxC(0.05, 0.6, 0.03, 0x9a1c24, 0.02, -AL - 0.62, 0.115));
    } else if (kala) { // a staff with a silver crescent cradling a glowing orb
      W.push(P(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5), 0x2a1a3a, 0, -AL - 0.15, 0.12)); W.push(P(new THREE.TorusGeometry(0.13, 0.025, 4, 8, Math.PI), 0xcfd6e6, 0, -AL + 0.66, 0.12, 0, 0, Math.PI));
      const orb = glowMesh(new THREE.IcosahedronGeometry(0.08, 0), 0xc8a0ff); orb.position.set(0, -AL + 0.63, 0.12); ud.orb = orb;
    } else if (!imp) { // a spiked club
      W.push(P(new THREE.CylinderGeometry(0.11, 0.05, 0.75, 6), 0x7a4a28, 0, -AL - 0.4, 0.12));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; W.push(spike(0.03, 0.1, 0xf2ead0, Math.cos(a) * 0.11, -AL - 0.62, 0.12 + Math.sin(a) * 0.11, 0, 0, Math.PI / 2 + a)); }
    }
    if (W.length) { // the weapon in the fist, angled forward and down (long ones would dig into the ground hanging straight)
      const wm = meshOf(W, M), wgp = new THREE.Group();
      wm.geometry.translate(0, AL, 0); // built from the shoulder: move it to the fist
      wgp.position.set(0, -AL, 0); wgp.rotation.x = kala ? 0 : -0.95;
      wgp.add(wm); ud.arms[1].add(wgp);
    }
    if (ud.orb) ud.arms[1].add(ud.orb);
    ud.hips = hips;
  }
  FAB = 0;
  g.userData = Object.assign(g.userData, ud);
  return g;
};

/* ---------- animals ---------- */
/**
 * Gau Mata: a white humped zebu cow of the Bengal plains, decked out by the village. A long gentle face
 * with drooping ears, painted horns with tassels, a tilak, a marigold garland, a bell on a red cord and a
 * block-printed jhool over her back. Faces +z; the four leg pivots sit at y 0.45 for the walk cycle.
 */
Models.cow = function () {
  const g = new THREE.Group();
  const W = 0xf2eee6, Wd = 0xe2dccf, muzzle = 0xcfa496, hoof = 0x3a2a1a;
  const p = [];
  FAB = 0;
  // body: barrel, rump, chest, the zebu hump
  p.push(sph(0.24, W, 0, 0.64, 0, 1.0, 0.95, 1.85));
  p.push(sph(0.21, W, 0, 0.66, -0.3, 1.0, 0.95, 0.9));
  p.push(sph(0.19, W, 0, 0.62, 0.3));
  p.push(sph(0.11, Wd, 0, 0.84, 0.25, 1.1, 0.9, 1.25));
  // neck, dewlap and head
  p.push(cylC(0.1, 0.13, 0.3, 14, W, 0, 0.75, 0.47, -0.95));
  p.push(sph(0.09, Wd, 0, 0.52, 0.46, 0.35, 1.25, 1.35));
  p.push(sph(0.11, W, 0, 0.84, 0.66, 0.9, 1.0, 1.25));
  p.push(sph(0.075, muzzle, 0, 0.76, 0.8, 1.05, 0.85, 1));
  for (const sx of [-1, 1]) {
    p.push(sph(0.013, 0x2a1e1a, sx * 0.025, 0.765, 0.872)); // nostrils
    p.push(sph(0.02, 0x1a1210, sx * 0.075, 0.875, 0.69, 0.8, 1, 0.6)); // eyes
    p.push(sph(0.006, 0xffffff, sx * 0.078, 0.882, 0.703));
    p.push(boxC(0.03, 0.006, 0.01, 0x2a1e1a, sx * 0.075, 0.893, 0.69, 0, 0, sx * 0.3)); // lashes
    p.push(sphR(0.06, W, sx * 0.135, 0.86, 0.61, 0, 0, sx * 1.05, 1.6, 0.5, 0.85)); // drooping ears
    p.push(sphR(0.04, 0xe8b8a8, sx * 0.137, 0.855, 0.615, 0, 0, sx * 1.05, 1.5, 0.32, 0.6));
    p.push(coneC(0.024, 0.17, 8, 0xd9582c, sx * 0.07, 0.98, 0.62, -0.15, 0, -sx * 0.5)); // horns painted saffron
    p.push(sph(0.018, 0xe8b830, sx * 0.112, 1.055, 0.605)); // brass tips
    p.push(sph(0.026, 0xc8202a, sx * 0.05, 0.93, 0.63, 1, 1.4, 1)); // wool tassels at the base
  }
  p.push(boxC(0.018, 0.06, 0.008, 0xd33b2c, 0, 0.9, 0.765, -0.5)); // tilak
  p.push(sph(0.011, 0xf2c230, 0, 0.87, 0.775));
  // a marigold garland round the neck, and a bell on a red cord
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    p.push(sph(0.028, i % 2 ? C.saffron : C.marigold, Math.cos(a) * 0.15, 0.6 + Math.sin(a) * 0.05, 0.42 + Math.sin(a) * 0.13));
  }
  p.push(P(TorusG(0.12, 0.008, 4, 16, Math.PI), 0xc8202a, 0, 0.55, 0.46, -0.4, 0, Math.PI));
  p.push(sph(0.036, 0xe8b830, 0, 0.43, 0.53)); p.push(cone(0.02, 0.03, 8, 0xc9962e, 0, 0.455, 0.53));
  // the jhool: a block-printed blanket across her back, with a gold border and tassels
  FAB = 2;
  p.push(P(CylG(0.255, 0.255, 0.4, 18, 1, true, Math.PI - 0.95, 1.9), 0xb8262a, 0, 0.64, -0.02, Math.PI / 2));
  FAB = 0;
  for (const z of [-0.22, 0.18]) p.push(P(TorusG(0.256, 0.01, 4, 18, 1.9), 0xe8b830, 0, 0.64, z, 0, 0, Math.PI / 2 - 0.95));
  for (const sx of [-1, 1]) for (const z of [-0.2, 0.16]) p.push(sph(0.02, 0xe8b830, sx * 0.2, 0.5, z, 1, 1.5, 1));
  // tail with a dark tuft, and her udder
  p.push(cylC(0.016, 0.012, 0.42, 6, W, 0, 0.52, -0.52, 0.22));
  p.push(sph(0.042, 0x2a2420, 0, 0.3, -0.565, 1, 1.6, 1));
  p.push(sph(0.07, 0xe0a8a0, 0, 0.44, -0.12, 1.2, 0.7, 1));
  g.add(meshOf(p, MAT.char || MAT.std));
  const legs = [];
  for (const [x, z] of [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.3], [0.12, -0.3]]) {
    const L = new THREE.Group(); L.position.set(x, 0.45, z); g.add(L);
    const lp = [sph(0.06, W, 0, -0.02, 0), cyl(0.056, 0.045, 0.24, 10, W, 0, -0.24, 0), sph(0.04, Wd, 0, -0.245, 0.005), cyl(0.034, 0.032, 0.165, 8, W, 0, -0.405, 0), cyl(0.037, 0.042, 0.045, 8, hoof, 0, -0.45, 0)];
    if (z > 0) lp.push(P(TorusG(0.036, 0.008, 4, 12), 0xe8b830, 0, -0.37, 0, Math.PI / 2)); // ghungroo on the forelegs
    L.add(meshOf(lp, MAT.char || MAT.std));
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
