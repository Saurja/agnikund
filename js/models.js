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
        if (f < 0.5) diffuseColor.rgb *= 0.97 + 0.06 * n1;                                   // skin: a soft, living unevenness
        else if (f < 1.5) diffuseColor.rgb *= 0.93 + 0.12 * (n1 * 0.4 + n2 * 0.6);           // woven cotton
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
          diffuseColor.rgb *= (0.74 + 0.5 * m) * (1.0 - 0.18 * smoothstep(0.42, 0.5, max(sc.x, sc.y)));
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
  MAT.bld = MAT.tier === 'low' ? MAT.std : texturize(surfaceMat({ vertexColors: true, roughness: 0.92 }), 0.14);
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
  if (!mat.skinning) { mat.skinning = true; mat.needsUpdate = true; } // (ignored by meshes that are not skinned)
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.add(root);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; // poses (lying asleep) reach past the bind-pose bounds
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
      void main() { gl_FragColor = vec4(uColor, 0.28 + 0.5 * vRim * vRim); }`,
    // Drawn in the solid pass after the world (renderOrder 1) but before any unit (renderOrder 2), so the
    // depth buffer holds only trees, buildings and ground: a unit shows through those, never through
    // another villager or demon (a crowd would otherwise light up red all over). Blended by hand.
    transparent: false, depthWrite: false, depthFunc: THREE.GreaterDepth,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
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
    if (part.isSkinnedMesh) { s = new THREE.SkinnedMesh(part.geometry, silMat(color, offset, true)); s.bind(part.skeleton, part.bindMatrix); s.frustumCulled = false; }
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
    case 'claypit': { // a pit of wet clay with a raised rim, a puddle, a spade, drying clay blocks and a little shade
      p.push(cyl(0.78, 0.82, 0.05, 20, 0x5e341d, -0.15, 0, -0.1)); // the wet floor of the pit
      p.push(P(new THREE.TorusGeometry(0.8, 0.12, 6, 22), 0x8c5a34, -0.15, 0.05, -0.1, Math.PI / 2, 0, 0, 1, 1, 0.6)); // dug-out rim
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
        p.push(P(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12, 1, false, 0, Math.PI), 0x2a1810, sx, 0.46, 0.33, Math.PI / 2, 0, Math.PI / 2));
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
      for (let i = 0; i < 3; i++) p.push(P(new THREE.TorusGeometry(0.52 - i * 0.075, 0.025, 5, 18), 0xc9a040, -0.1, 0.45 + i * 0.45, -0.15, Math.PI / 2));
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
  const c = 0.8;
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
    p.push(P(new THREE.TorusGeometry(0.08, 0.012, 4, 10, Math.PI * 1.4), 0x4f8a3a, c - 0.05, 0.05, -c + 0.02, Math.PI / 2));
  } else if (kind === 'well') {
    pot(-c, c, 0xff7a9a); pot(c, c, 0xffd84a); pot(-c, -c, 0xffffff);
    p.push(cyl(0.07, 0.06, 0.11, 10, 0x8d939a, c, 0.03, -c)); p.push(P(new THREE.TorusGeometry(0.065, 0.01, 4, 12), 0x5a5a62, c, 0.14, -c, Math.PI / 2)); // a bucket
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
Models.rockGeo = function (variant, ore) {
  if (ore) return Models.oreRockGeo(variant);
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

/** An iron-ore boulder: the same shapes as the stone ones, rust-red and streaked, with dark metallic nodules. */
Models.oreRockGeo = function (variant) {
  const rnd = mulberry32(variant * 977 + 3);
  const p = [];
  const n = 1 + (variant % 3);
  for (let i = 0; i < n; i++) {
    const r = i === 0 ? 0.5 : 0.28 + rnd() * 0.12;
    const geo = new THREE.SphereGeometry(r, 10, 7);
    const pos = geo.attributes.position;
    const sx = 0.85 + rnd() * 0.3, sy = 0.6 + rnd() * 0.2, sz = 0.85 + rnd() * 0.3;
    for (let k = 0; k < pos.count; k++) {
      const w = 1 + Math.sin(pos.getX(k) * 11 + variant) * 0.08 + Math.cos(pos.getZ(k) * 8 + i) * 0.07;
      pos.setXYZ(k, pos.getX(k) * sx * w, pos.getY(k) * sy * w, pos.getZ(k) * sz * w);
    }
    geo.computeVertexNormals();
    const cx = i === 0 ? 0 : (rnd() - 0.5) * 0.9, cz = i === 0 ? 0 : (rnd() - 0.5) * 0.9;
    p.push(P(geo, rnd() > 0.5 ? 0x8a5040 : 0x7a4636, cx, r * 0.35, cz));
    for (let k = 0; k < 4; k++) { // rust streaks and dark iron nodules on the surface
      const a = rnd() * Math.PI * 2, e = 0.2 + rnd() * 0.9;
      const px = cx + Math.cos(a) * Math.cos(e) * r * sx * 0.92, py = r * 0.35 + Math.sin(e) * r * sy * 0.92, pz = cz + Math.sin(a) * Math.cos(e) * r * sz * 0.92;
      p.push(sph(r * (0.12 + rnd() * 0.08), k % 2 ? 0xc07a48 : 0x3e3a3c, px, py, pz, 1, 0.7, 1, 6, 4));
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
      p.push(cyl(0.26, 0.2, 0.22, 14, 0xb3843c, 0, 0, 0)); p.push(P(new THREE.TorusGeometry(0.26, 0.02, 5, 16), 0x7d5226, 0, 0.22, 0, Math.PI / 2));
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
Models.villager = function (look, job) {
  const pal = lookPalette(look, job);
  const H = (k) => hexOf(pal[k]);
  const fem = look.g === 'f';
  const army = slotKey(job) === 'army';
  const brute = job === 'brute';
  const M = MAT.char || MAT.std;
  const skin = H('S'), skinD = darkHex(skin, 0.84), skinL = mixHex(skin, 0xffe4c8, 0.12), lip = mixHex(skin, 0x8a2424, 0.45), hair = H('h');
  const cloth = H('C'), clothD = H('c'), lower = H('D'), trim = H('d'), accent = H('G');
  const printed = fem || ['farm', 'trader', 'idle', 'vaidya', 'kiln', 'clay'].includes(job);
  const CL = printed ? 2 : 1;
  const g = new THREE.Group();
  const bones = [], skinParts = []; // a skinned rig: every part rides one bone, the whole body is one mesh
  const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
  const rig = (parts, b) => { if (parts.length) skinParts.push([parts, b]); };
  const hips = bone(null, 0, V_HIP, 0);

  /* legs: index 0 is the right leg (-x). Men: the dhoti draped over each thigh to below the knee, bare
     calves, leather chappals. Women: only the feet show below the saree (with silver payal). */
  const legs = [];
  for (const sx of [-1, 1]) {
    const L = bone(hips, sx * 0.072, -0.02, 0);
    const knee = bone(L, 0, -0.215, 0);
    const th = [], sh = [];
    if (!fem) {
      FAB = brute ? 1 : 1;
      th.push(sph(0.078, lower, 0, -0.01, 0, 1, 0.8, 1));
      th.push(cyl(0.077, 0.066, 0.21, 12, lower, 0, -0.21, 0));
      th.push(boxC(0.018, 0.2, 0.01, darkHex(lower, 0.88), sx * -0.03, -0.1, 0.07, -0.08)); // a fold of the dhoti
      sh.push(cyl(0.066, 0.064, 0.075, 12, lower, 0, -0.07, 0.004));
      FAB = 0;
      sh.push(P(new THREE.TorusGeometry(0.065, 0.007, 4, 14), trim, 0, -0.068, 0.004, Math.PI / 2));
      sh.push(sph(0.038, skin, 0, -0.07, 0.0, 1, 0.6, 1));
      sh.push(cyl(0.041, 0.03, 0.135, 10, skin, 0, -0.205, -0.004)); // calf to ankle
    } else {
      FAB = 0;
      sh.push(cyl(0.033, 0.03, 0.11, 8, skin, 0, -0.2, 0));
      sh.push(P(new THREE.TorusGeometry(0.031, 0.007, 4, 12), 0xd8dde3, 0, -0.19, 0, Math.PI / 2)); // silver payal
    }
    FAB = 0;
    // foot and chappal (the foot is part of the shin, so it stays put while the knee bends)
    sh.push(sph(0.034, skin, 0, -0.222, 0.038, 0.85, 0.5, 1.65));
    sh.push(sph(0.012, skinD, sx * -0.012, -0.224, 0.09, 1, 0.8, 1));
    sh.push(box(0.074, 0.013, 0.155, 0x5a3820, 0, -0.247, 0.032));
    sh.push(P(new THREE.TorusGeometry(0.03, 0.007, 4, 10, Math.PI), 0x8a4a22, 0, -0.232, 0.06, 0, 0, 0));
    rig(th, L);
    rig(sh, knee);
    L.userData.knee = knee;
    legs.push(L);
  }

  /* the saree skirt hangs from the hips and swings with the legs (the renderer sways it) */
  let skirt = null;
  if (fem) {
    const sk = [];
    FAB = CL;
    sk.push(P(new THREE.LatheGeometry(V2([[0.206, -0.452], [0.2, -0.4], [0.178, -0.26], [0.152, -0.12], [0.134, 0.0], [0.128, 0.06], [0.001, 0.062]]), 22), lower, 0, 0, 0, 0, 0, 0, 1, 1, 0.88));
    // the front pleats fan out from the navel
    for (let k = -2; k <= 2; k++) sk.push(boxC(0.034, 0.44, 0.012, darkHex(lower, k % 2 ? 0.86 : 0.94), k * 0.03, -0.2, 0.152 + 0.004 - Math.abs(k) * 0.006, -0.09, 0, k * 0.07));
    FAB = 0;
    sk.push(P(new THREE.CylinderGeometry(0.207, 0.207, 0.055, 22, 1, true), trim, 0, -0.42, 0, 0, 0, 0, 1, 1, 0.88)); // the paar (border)
    sk.push(P(new THREE.TorusGeometry(0.205, 0.006, 4, 26), 0xe8b830, 0, -0.39, 0, Math.PI / 2, 0, 0, 1, 0.88, 1));
    skirt = bone(hips, 0, 0, 0);
    rig(sk, skirt);
  }

  /* spine: the waist joint. Everything above it leans and twists with the swing of a blow. */
  const spine = bone(hips, 0, 0.05, 0);
  const body = [];
  if (fem) { // choli (blouse) over a bare midriff, the pallu across the chest from the right hip to the left shoulder and down the back
    FAB = 0;
    body.push(P(new THREE.LatheGeometry(V2([[0.124, -0.01], [0.122, 0.06], [0.126, 0.11], [0.001, 0.112]]), 18), skin, 0, 0, 0, 0, 0, 0, 1, 1, 0.78));
    FAB = 1;
    body.push(P(new THREE.LatheGeometry(V2([[0.124, 0.1], [0.138, 0.15], [0.142, 0.2], [0.135, 0.245], [0.1, 0.278], [0.055, 0.292], [0.001, 0.296]]), 18), cloth, 0, 0, 0, 0, 0, 0, 1, 1, 0.8));
    for (const sx of [-1, 1]) body.push(sph(0.062, cloth, sx * 0.055, 0.175, 0.07, 1, 0.9, 0.75));
    FAB = CL;
    body.push(boxC(0.1, 0.36, 0.016, lower, 0.01, 0.12, 0.118, -0.08, 0, -0.55)); // pallu over the chest
    body.push(boxC(0.13, 0.5, 0.016, lower, 0.07, 0.07, -0.112, 0.08, 0, 0.12)); // and down the back
    body.push(sph(0.06, lower, 0.105, 0.255, 0.0, 0.85, 0.55, 1.5)); // over the shoulder
    FAB = 0;
    body.push(boxC(0.016, 0.36, 0.018, trim, 0.052, 0.098, 0.12, -0.08, 0, -0.55)); // its border
  } else if (brute) { // pehelwan: bare, broad and oiled, in a red langot under the dhoti
    FAB = 0;
    body.push(P(new THREE.LatheGeometry(V2([[0.15, -0.04], [0.148, 0.04], [0.172, 0.13], [0.192, 0.2], [0.188, 0.245], [0.14, 0.28], [0.06, 0.3], [0.001, 0.302]]), 20), skin, 0, 0, 0, 0, 0, 0, 1, 1, 0.78));
    for (const sx of [-1, 1]) { body.push(sph(0.07, skinL, sx * 0.068, 0.2, 0.1, 1.1, 0.72, 0.55)); body.push(sph(0.06, skin, sx * 0.17, 0.25, 0, 1.1, 0.9, 1)); }
    for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) body.push(sph(0.026, skinD, sx * 0.03, 0.03 + k * 0.042, 0.112, 1, 0.8, 0.5)); // abdomen
    FAB = 1;
    body.push(cyl(0.155, 0.16, 0.1, 18, lower, 0, -0.1, 0, 0, 0, 0)); // dhoti at the waist
    FAB = 0;
    body.push(P(new THREE.TorusGeometry(0.153, 0.022, 6, 20), accent, 0, -0.005, 0, Math.PI / 2, 0, 0, 1, 0.78, 1));
    const mala = [];
    for (let i = 0; i < 15; i++) { const a = (i / 14) * Math.PI; mala.push(sph(0.013, 0x6b2a1e, Math.cos(a) * 0.075, 0.28 - Math.sin(a) * 0.1, 0.1 + Math.sin(a) * 0.025)); }
    body.push(...mala);
  } else { // kurta: an A-line tunic to mid-thigh, a placket with brass buttons, a cloth waistband
    FAB = CL;
    body.push(P(new THREE.LatheGeometry(V2([[0.156, -0.165], [0.15, -0.1], [0.135, -0.02], [0.13, 0.03], [0.142, 0.11], [0.154, 0.18], [0.158, 0.225], [0.148, 0.258], [0.11, 0.285], [0.058, 0.3], [0.001, 0.305]]), 22), cloth, 0, 0, 0, 0, 0, 0, 1, 1, 0.76));
    FAB = 0;
    body.push(P(new THREE.CylinderGeometry(0.157, 0.157, 0.02, 22, 1, true), clothD, 0, -0.155, 0, 0, 0, 0, 1, 1, 0.76)); // hem border
    body.push(boxC(0.03, 0.13, 0.01, clothD, 0, 0.225, 0.115, -0.1));
    for (let i = 0; i < 3; i++) body.push(sph(0.0085, 0xe8b830, 0, 0.185 + i * 0.035, 0.123));
    body.push(P(new THREE.TorusGeometry(0.06, 0.012, 5, 16), clothD, 0, 0.292, 0.0, Math.PI / 2 - 0.15)); // collar
    body.push(P(new THREE.TorusGeometry(0.132, 0.016, 6, 22), accent, 0, 0.03, 0, Math.PI / 2, 0, 0, 1, 0.78, 1)); // kamarbandh
    if (['wood', 'stone', 'farm', 'build', 'clay', 'kiln', 'idle', 'smelt'].includes(job)) { // a checked gamcha over the right shoulder
      FAB = 3;
      body.push(P(new THREE.TorusGeometry(0.085, 0.02, 5, 12, Math.PI), 0xb83a30, -0.1, 0.262, 0, 0, Math.PI / 2, 0, 1, 1, 1.15));
      body.push(boxC(0.04, 0.12, 0.012, 0xb83a30, -0.1, 0.21, 0.108, -0.1));
      body.push(boxC(0.04, 0.15, 0.012, 0xb83a30, -0.1, 0.19, -0.108, 0.1));
      FAB = 0;
    }
    if (army) { // leather baldric, belt and a brass buckle
      body.push(boxC(0.03, 0.4, 0.012, 0x6b3a1e, 0, 0.13, 0.12, 0, 0, 0.6));
      body.push(boxC(0.03, 0.4, 0.012, 0x6b3a1e, 0, 0.13, -0.12, 0, 0, -0.6));
      body.push(P(new THREE.TorusGeometry(0.134, 0.014, 5, 22), 0x5a3018, 0, 0.0, 0, Math.PI / 2, 0, 0, 1, 0.78, 1));
      body.push(boxC(0.034, 0.03, 0.01, 0xe8b830, 0, 0.0, 0.106));
    }
    if (job === 'build') { // a Mistri's plumb line and a measuring cord at the waist
      body.push(cylC(0.012, 0.012, 0.09, 6, 0xd8c28a, 0.11, -0.02, 0.06, 0, 0, 0.2)); body.push(cone(0.018, 0.035, 6, 0x55555f, 0.12, -0.1, 0.06, Math.PI));
      body.push(box(0.06, 0.05, 0.03, 0x7a4b26, -0.12, -0.06, 0.07)); // a pouch of nails
    }
    if (job === 'medic') body.push(P(new THREE.TorusGeometry(0.15, 0.02, 6, 20), 0x2e7d32, 0, 0.14, 0, Math.PI / 2 - 0.5, 0, 0.6, 1, 0.8, 1)); // green healer's sash
  }
  // neck
  FAB = 0;
  body.push(cyl(0.037, 0.043, 0.075, 10, skin, 0, 0.27, 0.004));
  if (job === 'archer') { // quiver on the back with red-fletched arrows
    body.push(cylC(0.045, 0.04, 0.34, 10, 0x7a4b26, -0.05, 0.16, -0.13, -0.15, 0, -0.35));
    for (let i = 0; i < 4; i++) body.push(coneC(0.022, 0.07, 3, i % 2 ? 0xd33b2c : 0xf4ecd8, -0.11 + i * 0.016, 0.36 + i * 0.004, -0.16, -0.15, 0, -0.35));
  }
  const torso = bone(spine, 0, 0, 0); // its own bone, so breathing swells the chest alone
  rig(body, torso);

  /* head: almond eyes, brows, nose and lips; a pagdi for men (with a plume for soldiers), a khopa with a
     gajra for women, a shaved head with a choti for the Pujari */
  const head = bone(spine, 0, 0.3, 0.006);
  const hp = [];
  const hy = 0.11, R = 0.12;
  FAB = 0;
  hp.push(sph(R, skin, 0, hy, 0, 0.93, 1.06, 0.98));
  hp.push(sph(0.064, skin, 0, hy - 0.062, 0.03, 1.25, 0.72, 1.05)); // jaw and chin
  for (const sx of [-1, 1]) {
    hp.push(sph(0.024, skin, sx * 0.113, hy - 0.004, -0.004, 0.45, 1, 0.8)); // ears
    hp.push(sph(0.02, 0xf6f1e8, sx * 0.041, hy + 0.01, 0.102, 1.45, 0.82, 0.45));
    hp.push(sph(0.0135, 0x2a1810, sx * 0.041, hy + 0.009, 0.109, 1.1, 1.1, 0.45));
    hp.push(sph(0.0045, 0xffffff, sx * 0.037, hy + 0.015, 0.115));
    hp.push(boxC(0.044, 0.009, 0.01, hair, sx * 0.043, hy + 0.043, 0.108, 0, 0, sx * -0.14)); // brows
    hp.push(sph(0.02, mixHex(skin, 0xd06a5a, 0.25), sx * 0.062, hy - 0.025, 0.088, 1, 0.6, 0.4)); // cheeks
    if (fem) hp.push(boxC(0.04, 0.005, 0.005, 0x1a1010, sx * 0.043, hy + 0.022, 0.111, 0, 0, sx * -0.1)); // kajal
  }
  hp.push(sph(0.016, skinD, 0, hy - 0.018, 0.115, 0.8, 1.25, 1));
  hp.push(sph(0.018, lip, 0, hy - 0.052, 0.104, 1.55, 0.45, 0.6));
  if (fem) {
    FAB = 6;
    hp.push(P(new THREE.SphereGeometry(0.127, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, hy + 0.004, -0.012, -0.62));
    hp.push(sph(0.058, hair, 0, hy - 0.01, -0.12)); // khopa
    FAB = 0;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; hp.push(sph(0.013, 0xfaf6ee, Math.cos(a) * 0.056, hy - 0.01 + Math.sin(a) * 0.052, -0.143)); } // gajra
    hp.push(sph(0.008, 0xc81e1e, 0, hy + 0.06, 0.116)); // bindi
    if (hexOf(look.cloth) % 3 !== 0) hp.push(boxC(0.007, 0.05, 0.005, 0xc81e1e, 0, hy + 0.108, 0.082, -0.62)); // sindoor
    hp.push(sph(0.005, 0xf2c230, 0.022, hy - 0.024, 0.118)); // nose stud
    for (const sx of [-1, 1]) { hp.push(coneC(0.011, 0.024, 6, 0xf2c230, sx * 0.114, hy - 0.04, 0.0, Math.PI)); hp.push(sph(0.007, 0xf2c230, sx * 0.114, hy - 0.03, 0.0)); } // jhumka
    if (look.covered) { FAB = CL; hp.push(P(new THREE.SphereGeometry(0.14, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), lower, 0, hy, -0.03, -0.55)); FAB = 0; } // the pallu over the head
  } else if (job === 'priest') {
    FAB = 6; hp.push(P(new THREE.SphereGeometry(0.122, 16, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), hair, 0, hy, 0, 0, 0, 0, 0.95, 1.05, 1)); FAB = 0; // a little hair round the back
    hp.push(coneC(0.018, 0.07, 6, hair, 0, hy + 0.135, -0.06, -0.6)); // choti
    for (let k = 0; k < 3; k++) hp.push(boxC(0.06, 0.005, 0.005, 0xf4ecd8, 0, hy + 0.05 + k * 0.012, 0.113 - k * 0.002, -0.3)); // tripundra
    hp.push(sph(0.008, 0xd33b2c, 0, hy + 0.062, 0.116));
  } else { // pagdi: a dome wound round with bands in two colours, a knot at the front and a tail behind (or a plume)
    FAB = 6; hp.push(sph(0.123, hair, 0, hy - 0.005, -0.012, 0.96, 0.92, 0.98)); // hair beneath
    FAB = 1;
    hp.push(sph(0.132, H('H'), 0, hy + 0.05, -0.008, 1.02, 0.66, 1.05));
    for (let i = 0; i < 3; i++) hp.push(P(new THREE.TorusGeometry(0.124 - i * 0.01, 0.024, 6, 22), i % 2 ? accent : H('H'), 0, hy + 0.04 + i * 0.032, -0.006 - i * 0.004, Math.PI / 2 + (i % 2 ? 0.12 : -0.1)));
    hp.push(sph(0.024, accent, 0.022, hy + 0.1, 0.116, 1, 1, 0.6));
    if (army) { hp.push(boxC(0.04, 0.1, 0.012, accent, 0, hy + 0.12, 0.12, -0.25)); FAB = 6; hp.push(coneC(0.011, 0.09, 6, 0xfff0d0, 0.008, hy + 0.2, 0.1, -0.35)); }
    else hp.push(boxC(0.05, 0.11, 0.012, H('H'), 0, hy - 0.02, -0.128, 0.15));
    FAB = 0;
    if (look.stache) for (const sx of [-1, 1]) { hp.push(sphR(0.024, hair, sx * 0.022, hy - 0.035, 0.112, 0, 0, sx * 0.35, 1.5, 0.45, 0.55)); hp.push(sph(0.009, hair, sx * 0.05, hy - 0.028, 0.104)); }
  }
  FAB = 0;
  rig(hp, head);

  /* arms: index 0 is the left arm (+x), index 1 the right arm (-x) that holds tools and weapons */
  const arms = [], grips = [];
  for (const sx of [1, -1]) {
    const A = bone(spine, sx * (brute ? 0.17 : 0.153), 0.243, 0);
    const E = bone(A, 0, -0.158, 0);
    const up = [], fo = [];
    const sleeve = brute ? skin : cloth;
    FAB = brute ? 0 : fem ? 1 : CL;
    const ur = brute ? 0.054 : 0.046;
    up.push(sph(ur + 0.002, sleeve, 0, -0.004, 0, 1, 0.95, 1));
    if (fem) { up.push(cyl(ur, ur - 0.004, 0.07, 10, cloth, 0, -0.07, 0)); FAB = 0; up.push(cyl(ur - 0.006, ur - 0.01, 0.09, 10, skin, 0, -0.158, 0)); }
    else up.push(cyl(ur, ur - 0.006, 0.158, 10, sleeve, 0, -0.158, 0));
    FAB = 0;
    if (brute) up.push(P(new THREE.TorusGeometry(ur, 0.01, 5, 12), 0xd4a234, 0, -0.07, 0, Math.PI / 2)); // bajuband
    // forearm and fist
    const fr = brute ? 0.046 : 0.038;
    up.push(sph(fr + 0.002, fem || brute ? skin : sleeve, 0, -0.158, 0));
    if (!fem && !brute) { FAB = CL; fo.push(cyl(fr, fr - 0.002, 0.08, 10, sleeve, 0, -0.08, 0)); FAB = 0; fo.push(P(new THREE.TorusGeometry(fr - 0.001, 0.007, 4, 12), clothD, 0, -0.08, 0, Math.PI / 2)); fo.push(cyl(fr - 0.006, fr - 0.009, 0.06, 10, skin, 0, -0.138, 0)); }
    else fo.push(cyl(fr, fr - 0.008, 0.14, 10, skin, 0, -0.14, 0));
    fo.push(sph(0.034, skin, 0, -0.165, 0.004, 0.82, 1.05, 0.95)); // fist
    fo.push(sph(0.013, skin, sx * -0.022, -0.152, 0.024, 1, 1.25, 1)); // thumb
    if (fem) {
      fo.push(P(new THREE.TorusGeometry(0.032, 0.008, 4, 12), 0xf6f1e8, 0, -0.108, 0, Math.PI / 2)); // shankha
      fo.push(P(new THREE.TorusGeometry(0.031, 0.007, 4, 12), 0xc81e1e, 0, -0.121, 0, Math.PI / 2)); // pola
      fo.push(P(new THREE.TorusGeometry(0.03, 0.004, 4, 12), 0xe8b830, 0, -0.131, 0, Math.PI / 2));
    } else if (army) fo.push(cyl(fr + 0.004, fr + 0.002, 0.06, 10, 0x8a5a22, 0, -0.13, 0)); // leather bracer
    rig(up, A);
    rig(fo, E);
    const G = bone(E, 0, -0.168, 0.006);
    A.userData.elbow = E; A.userData.grip = G;
    arms.push(A); grips.push(G);
  }

  /* the tool in the right grip, modelled along +z out of the fist (origin = where the fist closes) */
  const T = [];
  const tool = JOBS[job] && JOBS[job].tool;
  const handle = (r, z0, z1, c) => cylC(r, r, z1 - z0, 8, c || 0x8a5a2e, 0, 0, (z0 + z1) / 2, Math.PI / 2);
  let toolFlame = null;
  const ud = {};
  if (tool === 'axe') { T.push(handle(0.016, -0.06, 0.46)); T.push(boxC(0.018, 0.1, 0.07, 0xd0d4dc, 0, -0.045, 0.42)); T.push(boxC(0.02, 0.03, 0.08, 0x8d939a, 0, 0.0, 0.42)); T.push(cylC(0.008, 0.008, 0.07, 6, 0xeef0f5, 0, -0.095, 0.42, Math.PI / 2)); }
  else if (tool === 'pick') { T.push(handle(0.016, -0.06, 0.46)); T.push(cylC(0.022, 0.01, 0.18, 8, 0xb9bcc6, 0, -0.09, 0.43, 0, 0, 0.0)); T.push(coneC(0.014, 0.08, 6, 0xb9bcc6, 0, 0.04, 0.43)); T.push(cylC(0.026, 0.026, 0.05, 8, 0x8d939a, 0, 0, 0.43)); }
  else if (tool === 'hammer') { T.push(handle(0.014, -0.05, 0.25)); T.push(boxC(0.05, 0.11, 0.05, 0x55555f, 0, 0.005, 0.26)); }
  else if (tool === 'sickle') { T.push(handle(0.016, -0.05, 0.08)); T.push(P(new THREE.TorusGeometry(0.085, 0.01, 4, 14, Math.PI * 1.15), 0xd8dae0, 0, 0.075, 0.1, 0, Math.PI / 2, -0.2, 1, 1, 1)); }
  else if (tool === 'sword') { // talwar: disc pommel, knuckle guard, a gently curved blade
    T.push(cylC(0.026, 0.026, 0.01, 10, 0xe8b830, 0, 0, -0.065, Math.PI / 2)); T.push(handle(0.014, -0.06, 0.04, 0x6b3a1e));
    T.push(boxC(0.09, 0.016, 0.016, 0xe8b830, 0, 0, 0.045)); T.push(P(new THREE.TorusGeometry(0.05, 0.006, 4, 10, Math.PI), 0xe8b830, 0, 0.0, 0.0, 0, Math.PI / 2, 0));
    const Rc = 1.1, n = 6; // the blade follows an arc, curving back toward the spine
    for (let i = 0; i < n; i++) {
      const s0 = 0.05 + (i / n) * 0.5, s1 = 0.05 + ((i + 1) / n) * 0.5, sm = (s0 + s1) / 2, th = sm / Rc, wdt = 0.04 * (1 - (i / n) * 0.45);
      T.push(boxC(0.008, wdt, s1 - s0 + 0.004, 0xf2f4f8, 0, Rc * (1 - Math.cos(th)), Rc * Math.sin(th), -th));
      if (i < n - 1) T.push(boxC(0.009, 0.006, s1 - s0 + 0.004, 0xc8ccd4, 0, Rc * (1 - Math.cos(th)) - wdt * 0.25, Rc * Math.sin(th), -th)); // the fuller
    }
    T.push(coneC(0.016, 0.05, 4, 0xf2f4f8, 0, Rc * (1 - Math.cos(0.57 / Rc)) + 0.004, Rc * Math.sin(0.57 / Rc), Math.PI / 2 - 0.57 / Rc, 0, 0, 0.5, 1, 1)); // the point
  }
  else if (tool === 'bow') { /* in the left hand, below */ }
  else if (tool === 'thali') { // the aarti plate: a brass thali with a diya, flowers and kumkum
    T.push(cylC(0.012, 0.012, 0.06, 6, 0xe8b830, 0, 0.03, 0.03)); T.push(cylC(0.11, 0.095, 0.018, 16, 0xe8b830, 0, 0.065, 0.05));
    T.push(cyl(0.025, 0.02, 0.018, 8, C.brick, 0, 0.074, 0.05)); for (let i = 0; i < 5; i++) { const a = i * 1.26; T.push(sph(0.016, i % 2 ? 0xff9933 : 0xffcc33, Math.cos(a) * 0.065, 0.082, 0.05 + Math.sin(a) * 0.065)); }
    toolFlame = glowMesh(new THREE.ConeGeometry(0.018, 0.06, 6), 0xffcc33); toolFlame.position.set(0, 0.12, 0.05); grips[1].add(toolFlame);
  }
  else if (tool === 'sack') { T.push(sph(0.1, 0xd6b47a, 0, -0.11, 0.02, 1, 1.15, 0.9)); T.push(cyl(0.03, 0.04, 0.06, 8, 0xb89860, 0, -0.03, 0.02)); }
  else if (tool === 'herbs') { T.push(cylC(0.012, 0.012, 0.05, 6, 0x8a5a2e, 0, 0.02, 0.03)); T.push(cyl(0.07, 0.045, 0.05, 12, 0x8a5a2e, 0, 0.04, 0.05)); T.push(sph(0.06, 0x5fae4a, 0, 0.088, 0.05, 1, 0.4, 1)); T.push(coneC(0.02, 0.08, 5, 0x3f8a3a, 0.02, 0.13, 0.05, 0, 0, -0.4)); }
  else if (tool === 'gada') { T.push(handle(0.022, -0.08, 0.36, 0x6b4223)); T.push(cylC(0.05, 0.05, 0.03, 12, 0xfff0a0, 0, 0, 0.34, Math.PI / 2)); T.push(sph(0.12, 0xf2c230, 0, 0, 0.46)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; T.push(P(new THREE.TorusGeometry(0.121, 0.008, 4, 16), 0xc9962e, 0, 0, 0.46, 0, a, 0)); } T.push(coneC(0.03, 0.08, 8, 0xfff0a0, 0, 0, 0.6, Math.PI / 2)); }
  else if (tool === 'spear') { T.push(handle(0.015, -0.45, 1.0)); T.push(coneC(0.035, 0.18, 8, 0xe0e4ea, 0, 0, 1.09, Math.PI / 2)); T.push(sph(0.028, 0xd33b2c, 0, 0, 0.99)); T.push(cylC(0.02, 0.016, 0.05, 8, 0xc9962e, 0, 0, -0.44, Math.PI / 2)); }
  else if (tool === 'spade') { T.push(handle(0.015, -0.1, 0.5)); T.push(boxC(0.12, 0.012, 0.15, 0x8d939a, 0, 0, 0.56)); T.push(boxC(0.07, 0.03, 0.02, 0x8a5a2e, 0, 0, -0.11)); }
  else if (tool === 'mould') { for (const [w, d, x, z] of [[0.24, 0.018, 0, -0.06], [0.24, 0.018, 0, 0.06], [0.018, 0.13, -0.11, 0], [0.018, 0.13, 0.11, 0]]) T.push(boxC(w, 0.05, d, 0x9a6a3a, x, -0.03, 0.08 + z)); }
  else if (tool === 'tongs') { for (const sx of [-0.012, 0.012]) T.push(cylC(0.008, 0.008, 0.46, 5, 0x3a3a40, sx, 0, 0.22, Math.PI / 2, 0, 0)); T.push(sph(0.032, 0xff7a30, 0, 0, 0.47)); }
  else if (tool === 'potli') { T.push(sph(0.062, 0xe8dcc0, 0, -0.08, 0.02, 1, 0.9, 1)); T.push(cyl(0.03, 0.045, 0.045, 8, 0xc84030, 0, -0.03, 0.02)); T.push(sph(0.026, 0xe8dcc0, 0, 0.02, 0.02)); }
  if (T.length) grips[1].add(meshOf(T));
  if (tool === 'potli') { toolFlame = glowMesh(new THREE.CylinderGeometry(0.022, 0.026, 0.09, 8), 0x7dff9a, 0.9); toolFlame.position.set(0, 0.03, 0.03); grips[0].add(toolFlame); }

  /* the left hand: a dhaal (shield) facing forward, or the bow */
  if (job === 'warrior' || job === 'spear') {
    const big = job === 'warrior', r = big ? 0.165 : 0.13, col = big ? 0xd4a234 : 0x3e5f8a;
    const sp = [cylC(r, r, 0.03, 18, col, 0, 0, 0.05, Math.PI / 2), P(new THREE.TorusGeometry(r, 0.014, 5, 20), 0x8a5a22, 0, 0, 0.066), sph(0.035, 0xc9962e, 0, 0, 0.07, 1, 1, 0.6)];
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; sp.push(sph(0.018, 0xfff0a0, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0.068, 1, 1, 0.6)); }
    grips[0].add(meshOf(sp));
  }
  if (job === 'archer') { // a recurve bow: limbs along the grip's z axis, belly bulging away from the archer (-y)
    const bow = new THREE.Group(); grips[0].add(bow);
    const limb = [];
    for (const sz of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * 0.95, a1 = ((k + 1) / 4) * 0.95;
      const p0 = [0, (1 - Math.cos(a0)) * 0.2, Math.sin(a0) * 0.42 * sz];
      const p1 = [0, (1 - Math.cos(a1)) * 0.2, Math.sin(a1) * 0.42 * sz];
      const dz = p1[2] - p0[2], dy = p1[1] - p0[1], len = Math.hypot(dy, dz) + 0.01;
      limb.push(cylC(0.012 - k * 0.0015, 0.012 - k * 0.0015, len, 6, 0x8a5a2e, 0, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2, Math.atan2(dz, dy), 0, 0));
    }
    limb.push(cylC(0.017, 0.017, 0.07, 8, 0xd33b2c, 0, 0, 0, Math.PI / 2)); // the grip wrap
    bow.add(meshOf(limb));
    const tipY = (1 - Math.cos(0.95)) * 0.2, tipZ = Math.sin(0.95) * 0.42;
    ud.bowTip = { y: tipY, z: tipZ };
    // the string, rest and drawn, and the nocked arrow (the renderer shows one or the other)
    const sRest = meshOf([cylC(0.003, 0.003, tipZ * 2, 4, 0xf0e8d0, 0, tipY, 0, Math.PI / 2)], null, true, true);
    const drawn = new THREE.Group();
    const pull = 0.3, dl = Math.hypot(tipZ, pull - tipY), da = Math.atan2(tipZ, pull - tipY);
    drawn.add(meshOf([cylC(0.003, 0.003, dl, 4, 0xf0e8d0, 0, (tipY + pull) / 2, tipZ / 2, -da), cylC(0.003, 0.003, dl, 4, 0xf0e8d0, 0, (tipY + pull) / 2, -tipZ / 2, da),
      cylC(0.006, 0.006, pull + 0.06, 5, 0xc8a46a, 0, pull / 2 - 0.03, 0.0), coneC(0.012, 0.05, 5, 0xd0d4dc, 0, -0.07, 0, Math.PI), coneC(0.016, 0.05, 3, 0xd33b2c, 0, pull - 0.02, 0)], null, true, true));
    drawn.visible = false;
    bow.add(sRest); bow.add(drawn);
    ud.bowRest = sRest; ud.bowDrawn = drawn;
  }

  /* soldiers carry a little brass lantern on the belt at night (both hands stay on their weapons) */
  let torch = null;
  if (army) {
    torch = new THREE.Group();
    torch.add(meshOf([cyl(0.028, 0.032, 0.012, 8, 0xc9962e, 0, -0.06, 0), cyl(0.026, 0.026, 0.07, 8, 0xfff0c0, 0, -0.048, 0), cone(0.03, 0.03, 8, 0xc9962e, 0, 0.022, 0), P(new THREE.TorusGeometry(0.014, 0.004, 4, 8), 0x8a6a22, 0, 0.06, 0)], null, true, true));
    const fl = flameCluster(0.06); fl.position.y = -0.045; torch.add(fl); torch.userData.flame = fl;
    torch.position.set(0.15, -0.05, 0.07); torch.rotation.z = 0.1;
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
  const body3 = skinnedBody(g, hips, bones, skinParts, M);
  const silParts = [body3];
  Object.assign(ud, { hips, spine, torso, head, legs, arms, grips, skirt, pack, pouch, torch, toolFlame, fem, tool, silParts });
  g.userData = ud;
  return g;
};

/* ---------- demons (round and spooky-cute) ---------- */
Models.enemy = function (type, variant) {
  const g = new THREE.Group();
  const ud = { legs: [], arms: [], eyes: [], wings: [] };
  // both glowing eyes in one mesh: half the draw calls for every demon on screen
  const eyePair = (c, r, x, y, z) => glowMesh(merge([P(new THREE.SphereGeometry(r, 8, 6), c, -x, y, z), P(new THREE.SphereGeometry(r, 8, 6), c, x, y, z)]), c);
  const eye = (c, r) => glowMesh(new THREE.SphereGeometry(r || 0.05, 8, 6), c);
  const M = MAT.char || MAT.std;
  if (type === 'bhoot') { // a sheet ghost: wispy cloth that glows at its edges, a tattered hem, hollow eyes with a cold light
    FAB = 5;
    const prof = [[0.42, 0.05], [0.44, 0.1], [0.4, 0.3], [0.37, 0.55], [0.36, 0.85], [0.3, 1.05], [0.18, 1.18], [0.001, 1.22]].map(([x, y]) => new THREE.Vector2(x, y));
    const p = [P(new THREE.LatheGeometry(prof, 22), 0xeef3fb, 0, 0, 0)];
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; p.push(coneC(0.09, 0.18 + (i % 3) * 0.06, 6, 0xe2e9f6, Math.cos(a) * 0.37, 0.03, Math.sin(a) * 0.37, Math.PI)); }
    p.push(sph(0.09, 0xeef3fb, -0.38, 0.7, 0.05, 1.6, 0.8, 0.8)); p.push(sph(0.09, 0xeef3fb, 0.38, 0.7, 0.05, 1.6, 0.8, 0.8));
    for (const sx of [-1, 1]) p.push(coneC(0.05, 0.14, 5, 0xe2e9f6, sx * 0.5, 0.64, 0.05, 0, 0, sx * 2.4)); // trailing sleeve tips
    FAB = 0;
    p.push(sph(0.075, 0x10131f, -0.12, 0.92, 0.28, 1, 1.5, 0.5)); p.push(sph(0.075, 0x10131f, 0.12, 0.92, 0.28, 1, 1.5, 0.5));
    p.push(sph(0.065, 0x1a1f33, 0, 0.72, 0.32, 0.9, 1.4, 0.5));
    const m = meshOf(p, MAT.bhoot, true, false);
    g.add(m);
    m.add(eyePair(0xbfe4ff, 0.022, 0.12, 0.92, 0.31));
    ud.body = m;
  } else if (type === 'vetala') { // bat-winged spirit: furred body, big ears, fangs, veined leather wings
    FAB = 6;
    const p = [sph(0.24, 0x6a3a8e, 0, 0, 0, 1, 1.1, 1), sph(0.17, 0x6a3a8e, 0, 0.3, 0.05),
      coneC(0.07, 0.24, 12, 0x6a3a8e, -0.11, 0.5, 0.0, 0, 0, 0.35), coneC(0.07, 0.24, 12, 0x6a3a8e, 0.11, 0.5, 0.0, 0, 0, -0.35)];
    FAB = 0;
    p.push(coneC(0.04, 0.12, 8, 0xd09ab8, -0.11, 0.49, 0.03, 0, 0, 0.35), coneC(0.04, 0.12, 8, 0xd09ab8, 0.11, 0.49, 0.03, 0, 0, -0.35)); // inner ears
    p.push(sph(0.06, 0x8a5aa8, 0, 0.26, 0.18, 1.3, 0.8, 0.7)); // snout
    p.push(coneC(0.02, 0.07, 6, 0xffffff, -0.04, 0.2, 0.2, Math.PI), coneC(0.02, 0.07, 6, 0xffffff, 0.04, 0.2, 0.2, Math.PI));
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) p.push(coneC(0.012, 0.06, 4, 0xd8cbb0, sx * 0.07 + (k - 1) * 0.02, -0.3, 0.03, Math.PI)); // talons
    g.add(meshOf(p, M));
    for (const sx of [-1, 1]) {
      const wg = new THREE.Group(); wg.position.set(sx * 0.18, 0.05, 0); g.add(wg);
      const wp = [];
      FAB = 4;
      for (let k = 0; k < 3; k++) wp.push(sphR(0.24, 0x3a1d52, sx * (0.22 + k * 0.18), 0.05 - k * 0.07, 0, 0, 0, sx * (0.3 + k * 0.25), 1, 0.45, 0.06));
      FAB = 0;
      wp.push(cylC(0.02, 0.02, 0.7, 6, 0x2a1238, sx * 0.33, 0.12, 0, 0, 0, sx * 1.25));
      for (let k = 0; k < 3; k++) wp.push(cylC(0.01, 0.006, 0.36, 5, 0x2a1238, sx * (0.3 + k * 0.17), -0.02 - k * 0.06, 0.005, 0, 0, sx * (0.25 + k * 0.3))); // finger bones
      wp.push(coneC(0.02, 0.07, 5, 0xd8cbb0, sx * 0.62, 0.36, 0, 0, 0, -sx * 0.6)); // the claw at the wrist
      const wm = meshOf(wp, M);
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
    FAB = 5;
    const p = [P(new THREE.LatheGeometry(V2([[0.4, 0.02], [0.43, 0.08], [0.37, 0.35], [0.3, 0.62], [0.25, 0.86], [0.22, 1.0], [0.001, 1.03]]), 20), 0xf4f1ea, 0, 0, 0)];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; p.push(coneC(0.07, 0.14 + (i % 2) * 0.05, 5, 0xeeeae0, Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4, Math.PI)); } // a torn hem
    FAB = 0;
    p.push(P(new THREE.TorusGeometry(0.42, 0.035, 6, 22), 0xd22b2b, 0, 0.07, 0, Math.PI / 2)); // laal paar
    p.push(P(new THREE.TorusGeometry(0.31, 0.03, 6, 20), 0xd22b2b, 0, 0.5, 0, Math.PI / 2 - 0.35)); // border on the pallu
    p.push(sph(0.17, 0xf2e8e0, 0, 1.15, 0.01));
    const m = meshOf(p, MAT.bhoot, true, false);
    g.add(m); ud.body = m;
    FAB = 6;
    m.add(meshOf([sph(0.19, 0x15111a, 0, 1.18, -0.04, 1.06, 1.05, 1.04), boxC(0.32, 0.6, 0.07, 0x15111a, 0, 0.9, -0.15),
      boxC(0.07, 0.42, 0.03, 0x15111a, -0.07, 1.0, 0.17), boxC(0.07, 0.46, 0.03, 0x15111a, 0.05, 0.98, 0.175), boxC(0.05, 0.36, 0.03, 0x15111a, 0.13, 1.02, 0.15)], M, true));
    FAB = 0;
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
      FAB = 4;
      const lp = [...limb(head ? 0.07 : 0.11, head ? 0.24 : 0.3, skinD, 0, 0, 0)];
      FAB = 0;
      lp.push(sph(head ? 0.1 : 0.13, head ? 0x4c6656 : 0x2e2430, 0, head ? -0.36 : -0.45, 0.06, 1.2, 0.45, 1.5));
      if (head) for (let k = -1; k <= 1; k++) lp.push(sph(0.035, 0x4c6656, k * 0.045, -0.37, 0.17, 1, 0.5, 1.2)); // webbed toes
      L.add(meshOf(lp, M));
      ud.legs.push(L);
    }
    const p = [];
    if (head) { // Mechho Bhoot: pot-bellied pond ghost in a checked lungi, slimy and dripping
      FAB = 3;
      p.push(cyl(0.27, 0.3, 0.2, 14, 0x3e6f9e, 0, -0.08, 0));
      FAB = 0;
      for (let i = 0; i < 2; i++) p.push(P(new THREE.TorusGeometry(0.29, 0.012, 4, 20), 0xd8e4f0, 0, -0.04 + i * 0.13, 0, Math.PI / 2));
      FAB = 4;
      p.push(sph(0.33, skin, 0, 0.24, 0.05, 1, 0.95, 1));
      p.push(sph(0.25, skin, 0, 0.42, -0.1));
      const hy = 0.64;
      p.push(sph(0.21, skin, 0, hy, 0.13, 1.1, 0.9, 1));
      FAB = 0;
      for (let i = 0; i < 5; i++) p.push(sph(0.025, 0x9fd0b8, -0.2 + i * 0.1, 0.05 + (i % 2) * 0.1, 0.32 - Math.abs(i - 2) * 0.04, 0.8, 1.6, 0.8)); // pond-weed drips
      for (let i = 0; i < 3; i++) p.push(P(new THREE.TorusGeometry(0.05, 0.01, 4, 10, Math.PI), 0x6a8a74, 0, 0.3 + i * 0.07, 0.36 - i * 0.01, 0, 0, Math.PI)); // fish-scale ridges on the belly
      p.push(boxC(0.2, 0.035, 0.02, 0x2a1a1a, 0, hy - 0.09, 0.32));
      for (const sx of [-1, 1]) { p.push(coneC(0.02, 0.05, 5, 0xf2ead0, sx * 0.05, hy - 0.11, 0.32, Math.PI)); p.push(sph(0.07, 0xe8f0e0, sx * 0.085, hy + 0.04, 0.27, 1, 1, 0.6)); }
      for (let i = 0; i < 5; i++) p.push(coneC(0.03, 0.16, 5, 0x2f4a3a, -0.1 + i * 0.05, hy + 0.2, 0.08 - Math.abs(i - 2) * 0.02, -0.5, 0, (i - 2) * 0.25));
    } else { // Skondhokata: a headless giant in a white dhoti, a blue ghost-flame where his head should be
      FAB = 1;
      p.push(cyl(0.32, 0.36, 0.26, 16, 0xe9e2d0, 0, -0.14, 0));
      FAB = 4;
      p.push(sph(0.4, skin, 0, 0.36, 0, 1.1, 1.0, 0.85));
      for (const sx of [-1, 1]) p.push(sph(0.16, skin, sx * 0.36, 0.6, 0));
      for (const sx of [-1, 1]) p.push(sph(0.13, skin, sx * 0.14, 0.5, 0.26, 1.1, 0.8, 0.5)); // a heavy chest
      FAB = 0;
      p.push(cyl(0.12, 0.14, 0.1, 12, 0x7a2a2a, 0, 0.68, 0));
      p.push(cyl(0.1, 0.1, 0.02, 12, 0x3a0c10, 0, 0.78, 0));
      p.push(P(new THREE.TorusGeometry(0.36, 0.014, 5, 24), 0xf4ecd8, 0, 0.36, 0.02, Math.PI / 2 - 0.2, 0.5, 0));
      const fl = new THREE.Group(); fl.position.set(0, 0.8, 0);
      const c1 = glowMesh(new THREE.ConeGeometry(0.1, 0.32, 8), 0x6fa8ff, 0.8); c1.position.y = 0.16;
      const c2 = glowMesh(new THREE.ConeGeometry(0.05, 0.2, 6), 0xdcecff); c2.position.y = 0.1;
      fl.add(c1, c2); hips.add(fl); ud.neckFlame = fl;
    }
    hips.add(meshOf(p, M, false, false, !head));
    if (head) hips.add(eyePair(0xb8ff6a, 0.035, 0.085, 0.68, 0.3));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * (head ? 0.31 : 0.46), head ? 0.36 : 0.55, head ? 0.06 : 0); hips.add(A);
      FAB = 4;
      const ap = [sph(head ? 0.07 : 0.12, skin, 0, 0, 0), ...limb(head ? 0.06 : 0.1, head ? 0.26 : 0.34, skin, 0, 0, 0), sph(head ? 0.07 : 0.12, skinD, 0, head ? -0.36 : -0.46, 0)];
      FAB = 0;
      for (let k = -1; k <= 1; k++) ap.push(coneC(0.014, 0.05, 4, head ? 0x2f4a3a : 0xe8dcc0, k * 0.03, head ? -0.42 : -0.56, 0.03, Math.PI)); // claws
      A.add(meshOf(ap, M));
      ud.arms.push(A);
    }
    if (head) { // a stolen fish in his fist
      ud.arms[1].add(meshOf([sph(0.07, 0xd9a14a, 0, -0.44, 0.14, 0.7, 0.85, 2.2), coneC(0.08, 0.12, 4, 0xc28a3a, 0, -0.44, -0.03, -Math.PI / 2, 0, 0, 1, 1, 0.4), sph(0.015, 0x111111, 0.04, -0.42, 0.27)], M));
    } else { // he carries his own head under his arm
      FAB = 4;
      const hp = [sph(0.17, skin, 0, -0.5, 0.14)];
      FAB = 6;
      hp.push(sph(0.13, 0x1b1020, 0, -0.42, 0.08, 1.2, 0.6, 1.1));
      FAB = 0;
      hp.push(boxC(0.1, 0.02, 0.02, 0x2a0a0a, 0, -0.58, 0.3));
      ud.arms[0].add(meshOf(hp, M));
      ud.arms[0].add(eyePair(0xff6a3a, 0.03, 0.06, -0.49, 0.3));
    }
    ud.hips = hips; ud.hipY = hips.position.y;
  } else if (type === 'nishi') { // night caller: a hooded shadow reaching out with long pale arms
    FAB = 5;
    const p = [P(new THREE.LatheGeometry(V2([[0.34, 0.0], [0.4, 0.06], [0.33, 0.45], [0.27, 0.9], [0.24, 1.2], [0.2, 1.42], [0.12, 1.56], [0.001, 1.6]]), 20), 0x2a2542, 0, 0, 0)];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push(coneC(0.07, 0.16 + (i % 2) * 0.06, 5, 0x241f3a, Math.cos(a) * 0.36, 0.02, Math.sin(a) * 0.36, Math.PI)); } // a shroud that frays into the dark
    FAB = 0;
    p.push(sph(0.16, 0x0b0a14, 0, 1.36, 0.1, 1, 1.05, 0.7));
    p.push(P(new THREE.TorusGeometry(0.17, 0.035, 6, 16), 0x443d66, 0, 1.36, 0.13));
    const m = meshOf(p, M, true, false);
    g.add(m); ud.body = m;
    m.add(eyePair(0xcfe0ff, 0.032, 0.055, 1.38, 0.21));
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * 0.24, 1.1, 0.06); m.add(A);
      A.add(meshOf([...limb(0.032, 0.5, 0xb9bfd6, 0, 0, 0), ...[-1, 0, 1].map((k) => cylC(0.008, 0.008, 0.12, 4, 0xb9bfd6, k * 0.02, -0.6, 0.02))], M, true));
      ud.arms.push(A);
    }
    ud.armBase = -1.15; // arms held out, beckoning
    const trail = glowMesh(new THREE.ConeGeometry(0.34, 0.5, 14, 1, true), 0x8f9cff, 0.18); trail.rotation.x = Math.PI; trail.position.y = 0.1;
    m.add(trail);
  } else if (type === 'mamdo') { // Mamdo Bhoot: tall and gaunt, a long white beard, a torn kurta over a checked lungi, long grasping hands
    const skin = 0x8a9aa0, skinD = 0x6c7a80;
    const hips = new THREE.Group(); hips.position.y = 0.6; g.add(hips);
    for (const sx of [-1, 1]) {
      const L = new THREE.Group(); L.position.set(sx * 0.1, 0, 0); hips.add(L);
      FAB = 4; const lp = [...limb(0.05, 0.45, skinD, 0, 0, 0)];
      FAB = 0; lp.push(sph(0.07, 0x4a4a50, 0, -0.56, 0.05, 1, 0.45, 1.5));
      L.add(meshOf(lp, M)); ud.legs.push(L);
    }
    const p = [];
    FAB = 3; // the lungi, wrapped to the shins
    p.push(cyl(0.2, 0.24, 0.5, 16, 0x2f4a6a, 0, -0.48, 0));
    FAB = 0;
    p.push(P(new THREE.TorusGeometry(0.2, 0.025, 6, 18), 0x24364e, 0, 0.0, 0, Math.PI / 2)); // the knot at the waist
    FAB = 1; // a long kurta, gone grey and torn at the hem
    p.push(P(new THREE.LatheGeometry(V2([[0.2, -0.12], [0.19, 0.05], [0.17, 0.3], [0.16, 0.48], [0.12, 0.58], [0.001, 0.6]]), 18), 0xd8d4c8, 0, 0, 0.03));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; p.push(coneC(0.04, 0.12, 4, 0xcfcab9, Math.cos(a) * 0.2, -0.16, 0.03 + Math.sin(a) * 0.2, Math.PI)); }
    FAB = 4; // a hunched neck and a gaunt head, pushed forward
    p.push(cylC(0.05, 0.06, 0.16, 10, skin, 0, 0.64, 0.08, 0.5));
    const hy = 0.8;
    p.push(sph(0.15, skin, 0, hy, 0.13, 0.9, 1.15, 0.95));
    FAB = 0;
    for (const sx of [-1, 1]) {
      p.push(sph(0.045, 0x14161c, sx * 0.055, hy + 0.03, 0.25, 1.1, 1.2, 0.6)); // sunken sockets
      p.push(sph(0.03, skinD, sx * 0.08, hy - 0.04, 0.24, 1, 0.6, 0.6)); // hollow cheeks
    }
    p.push(boxC(0.12, 0.02, 0.03, 0x14161c, 0, hy + 0.08, 0.26, 0, 0, 0)); // a heavy brow
    p.push(coneC(0.022, 0.06, 6, skinD, 0, hy - 0.01, 0.285, Math.PI / 2)); // a long nose
    FAB = 6; // the long white beard and wisps of hair
    p.push(coneC(0.1, 0.38, 10, 0xe8e6e0, 0, hy - 0.22, 0.22, Math.PI - 0.25));
    p.push(sph(0.08, 0xe8e6e0, 0, hy - 0.08, 0.25, 1.4, 0.7, 0.7));
    for (const sx of [-1, 1]) p.push(coneC(0.03, 0.14, 6, 0xdcdad2, sx * 0.13, hy + 0.04, 0.08, 0.6, 0, sx * 1.2));
    FAB = 0;
    hips.add(meshOf(p, M, false, false));
    hips.add(eyePair(0xc8ff9a, 0.022, 0.055, hy + 0.03, 0.27));
    for (const sx of [-1, 1]) { // long thin arms ending in bony fingers
      const A = new THREE.Group(); A.position.set(sx * 0.23, 0.52, 0.05); hips.add(A);
      FAB = 1; const ap = [sph(0.06, 0xd8d4c8, 0, 0, 0), cyl(0.055, 0.05, 0.18, 10, 0xd8d4c8, 0, -0.18, 0)];
      FAB = 4; ap.push(cyl(0.035, 0.03, 0.34, 8, skin, 0, -0.52, 0), sph(0.04, skinD, 0, -0.55, 0.02, 1, 1.2, 0.8));
      FAB = 0; for (let k = -1; k <= 1; k++) ap.push(cylC(0.008, 0.006, 0.16, 4, skinD, k * 0.02, -0.64, 0.04, 0.2));
      A.add(meshOf(ap, M)); ud.arms.push(A);
    }
    ud.armBase = -0.5; // arms half raised, reaching
    ud.hips = hips; ud.hipY = hips.position.y;
  } else {
    // the great asuras share the demon rig, each with his own look:
    // Mahasura (buffalo horns, crown, red cape), Bakasura (pot belly, gaping maw, an uprooted tree for a club),
    // Raktabija (crimson hide that drips glowing blood, a ruby crown, a broad khanda), Kalanemi (indigo
    // sorcerer: tall mukut, a third eye, violet robes and a staff with a crescent and a glowing orb)
    const bk = ENEMIES[type] && ENEMIES[type].boss ? type : null, big = !!bk;
    const maha = bk === 'boss', baka = bk === 'bakasura', rakta = bk === 'raktabija', kala = bk === 'kalanemi', imp = type === 'rakta';
    const skins = [0x4fa07e, 0x4e74c4, 0xb04a5a, 0x7a55b0];
    const skin = maha ? 0x4b3666 : baka ? 0x7a6650 : rakta ? 0x9a1c24 : kala ? 0x37408a : imp ? 0xc0202c : type === 'danav' ? 0x7a2a3c : skins[variant % skins.length];
    const sD = new THREE.Color(skin).multiplyScalar(0.78).getHex();
    const sL = new THREE.Color(skin).lerp(new THREE.Color(0xffffff), 0.25).getHex();
    const giant = type === 'danav';
    const metal = 0x4a4e58, bone = 0xe8dcc0, gold = 0xf2c230;
    const hips = new THREE.Group(); hips.position.y = 0.5; g.add(hips);
    for (const sx of [-1, 1]) { // thick legs, shaggy shins, clawed feet
      const L = new THREE.Group(); L.position.set(sx * (baka ? 0.17 : 0.15), 0, 0); hips.add(L);
      FAB = 4;
      const lp = [...limb(baka ? 0.12 : 0.1, 0.3, sD, 0, 0, 0)];
      FAB = 6;
      lp.push(cyl(0.118, 0.11, 0.12, 12, darkHex(skin, 0.55), 0, -0.36, 0));
      FAB = 0;
      lp.push(sph(0.12, 0x3a2420, 0, -0.45, 0.05, 1, 0.55, 1.4));
      for (let k = -1; k <= 1; k++) lp.push(coneC(0.022, 0.07, 6, bone, k * 0.05, -0.45, 0.2, Math.PI / 2));
      if (giant) { FAB = 8; lp.push(cyl(0.12, 0.13, 0.16, 12, metal, 0, -0.24, 0.0)); FAB = 0; } // iron greaves
      if (kala) { FAB = 2; lp.push(cyl(0.14, 0.17, 0.32, 12, 0x4a2278, 0, -0.34, 0)); FAB = 0; } // the robe reaches his shins
      L.add(meshOf(lp, M));
      ud.legs.push(L);
    }
    const p = [];
    // loincloth: tiger skin for the rakshasa, studded iron for the Danav, red silk for the Demon King, with a ragged hem
    const cloth = maha ? 0xa82222 : baka ? 0x8a6a3a : rakta ? 0x24141a : kala ? 0x5a2a8a : giant ? 0x3d3d48 : 0xf09a32;
    FAB = maha || kala ? 2 : baka ? 1 : giant ? 8 : 7;
    p.push(cyl(0.3, 0.34, 0.22, 16, cloth, 0, -0.12, 0));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; p.push(coneC(0.055, 0.12, 4, cloth, Math.cos(a) * 0.32, -0.15, Math.sin(a) * 0.32, Math.PI)); }
    FAB = 4;
    if (baka) { // a vast pot belly with a navel, a chest of matted hair
      p.push(sph(0.45, skin, 0, 0.26, 0.06, 1.05, 1.0, 1.0));
      p.push(sph(0.3, sL, 0, 0.2, 0.26, 1.05, 1.0, 0.5));
      p.push(sph(0.035, sD, 0, 0.18, 0.5, 1, 1, 0.5));
    } else {
      p.push(sph(0.36, skin, 0, 0.32, 0, 1, 1.0, 0.85));
      p.push(sph(0.24, sL, 0, 0.28, 0.17, 1, 1.05, 0.45));
    }
    for (const sx of [-1, 1]) p.push(sph(0.14, skin, sx * 0.14, 0.5, 0.16, 1.1, 0.75, 0.6)); // heavy chest
    FAB = 0;
    if (maha) { p.push(P(new THREE.TorusGeometry(0.3, 0.05, 8, 20), gold, 0, 0.55, 0.02, Math.PI / 2 - 0.3)); p.push(cyl(0.34, 0.36, 0.08, 16, gold, 0, -0.02, 0)); }
    else if (baka) { // a rope belt, and a necklace of cart-wheel spokes and bones from the villages he ate
      p.push(P(new THREE.TorusGeometry(0.36, 0.03, 6, 22), 0xb89a6a, 0, -0.02, 0, Math.PI / 2));
      for (let i = 0; i < 9; i++) { const a = -1.1 + (i / 8) * 2.2; p.push(cylC(0.022, 0.022, 0.1, 6, i % 2 ? bone : 0x7a5530, Math.sin(a) * 0.3, 0.62 - Math.cos(a) * 0.08, Math.cos(a) * 0.24 + 0.04, 0, 0, a)); }
    } else if (rakta) { // a gold collar with rubies, and blood on his chest
      p.push(P(new THREE.TorusGeometry(0.28, 0.045, 8, 20), gold, 0, 0.58, 0.02, Math.PI / 2 - 0.25));
      for (let i = 0; i < 5; i++) p.push(sph(0.03, 0xe8202c, -0.16 + i * 0.08, 0.53 + Math.abs(i - 2) * 0.012, 0.26));
    } else if (kala) { // rudraksha beads, a violet cape and a silver sash
      for (let i = 0; i < 11; i++) { const a = -1.1 + (i / 10) * 2.2; p.push(sph(0.028, 0x6b2a1e, Math.sin(a) * 0.27, 0.6 - Math.cos(a) * 0.09, Math.cos(a) * 0.23 + 0.04)); }
      p.push(boxC(0.06, 0.62, 0.03, 0xcfd6e6, 0.05, 0.28, 0.28, 0.2, 0, 0.55));
    } else if (!imp) for (let i = 0; i < 7; i++) { // a mala of little skulls
      const a = -0.9 + (i / 6) * 1.8, x = Math.sin(a) * 0.26, y = 0.57 - Math.cos(a) * 0.06, z = Math.cos(a) * 0.22 + 0.04;
      p.push(sph(0.045, 0xeee6d2, x, y, z, 1, 1.1, 0.9));
      for (const ex of [-1, 1]) p.push(sph(0.012, 0x1b1020, x + ex * 0.016 * Math.cos(a), y + 0.006, z + 0.038));
    }
    if (giant) { // an iron breastplate with gold rivets, and spiked pauldrons
      FAB = 8;
      p.push(sph(0.31, metal, 0, 0.44, 0.1, 1.1, 0.8, 0.55));
      for (const sx of [-1, 1]) p.push(sph(0.17, metal, sx * 0.37, 0.6, 0, 1.2, 0.7, 1.1));
      FAB = 0;
      for (let i = 0; i < 6; i++) p.push(sph(0.02, 0xd4a234, -0.2 + (i % 3) * 0.2, 0.36 + Math.floor(i / 3) * 0.16, 0.27));
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) p.push(coneC(0.03, 0.12, 6, 0x8a8e98, sx * (0.32 + k * 0.06), 0.72, -0.06 + k * 0.06, 0, 0, -sx * 0.5));
    }
    if (maha || kala) { FAB = 2; p.push(boxC(0.66, 0.95, 0.04, maha ? 0x8a1a1a : 0x3a1a66, 0, 0.3, -0.33, 0.12)); FAB = 0; p.push(boxC(0.68, 0.06, 0.05, maha ? gold : 0xcfd6e6, 0, 0.76, -0.31, 0.12)); } // the royal cape
    const hy = 0.82;
    FAB = 4;
    p.push(sph(0.25, skin, 0, hy, 0.02));
    p.push(sph(0.09, sL, 0, hy - 0.08, 0.22, 1.3, 0.8, 0.7));
    p.push(boxC(0.3, 0.06, 0.08, sD, 0, hy + 0.1, 0.19, 0.35)); // a heavy brow
    FAB = 0;
    if (baka) { // a gaping maw with a lolling tongue and broken teeth
      p.push(sph(0.13, 0x3a0a10, 0, hy - 0.12, 0.17, 1.15, 0.7, 0.6));
      p.push(sph(0.07, 0xc84050, 0, hy - 0.17, 0.25, 1.1, 0.5, 1));
      for (let i = 0; i < 6; i++) p.push(coneC(0.018, 0.05, 5, 0xf2ead0, -0.09 + i * 0.036, hy - 0.06, 0.25, Math.PI));
    } else p.push(boxC(0.17, 0.03, 0.02, 0x1b1020, 0, hy - 0.12, 0.235)); // the grim mouth
    for (const sx of [-1, 1]) {
      p.push(coneC(0.025, 0.08, 8, 0xffffff, sx * 0.06, hy - 0.16, 0.22, Math.PI));
      if (!kala) p.push(coneC(0.03, 0.12, 8, bone, sx * 0.1, hy - 0.06, 0.2, 0, 0, -sx * 0.3)); // tusks
      p.push(boxC(0.12, 0.03, 0.03, 0x1b1020, sx * 0.08, hy + 0.12, 0.22, 0, 0, sx * -0.4));
      p.push(sph(0.06, 0x3a0a0a, sx * 0.085, hy + 0.04, 0.2, 1, 1, 0.5));
    }
    if (maha) {
      p.push(cyl(0.2, 0.22, 0.14, 16, gold, 0, hy + 0.2, 0));
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.push(cone(0.05, 0.16, 8, gold, Math.cos(a) * 0.18, hy + 0.34, Math.sin(a) * 0.18)); }
      p.push(sph(0.05, 0xff3a3a, 0, hy + 0.27, 0.2));
      for (const sx of [-1, 1]) p.push(P(new THREE.TorusGeometry(0.3, 0.06, 8, 14, Math.PI * 0.62), 0xece0c4, sx * 0.25, hy + 0.08, 0, 0, sx < 0 ? 0 : Math.PI, Math.PI * 0.05));
    } else if (rakta) { // a ruby crown with flame-shaped points
      p.push(cyl(0.21, 0.23, 0.12, 16, gold, 0, hy + 0.19, 0));
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; p.push(coneC(0.045, 0.18, 6, gold, Math.cos(a) * 0.19, hy + 0.38, Math.sin(a) * 0.19, 0, 0, 0)); }
      p.push(sph(0.06, 0xe8202c, 0, hy + 0.27, 0.21)); p.push(sph(0.035, 0xe8202c, -0.12, hy + 0.25, 0.17)); p.push(sph(0.035, 0xe8202c, 0.12, hy + 0.25, 0.17));
      FAB = 6; for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 2.2; p.push(coneC(0.06, 0.28, 6, 0x1a0a0e, Math.sin(a) * 0.17, hy + 0.0, -0.16, -1.3, 0, a * 0.5)); } FAB = 0; // long black hair
    } else if (kala) { // a tall mukut, a third eye
      p.push(cyl(0.2, 0.2, 0.1, 16, gold, 0, hy + 0.18, 0));
      p.push(P(new THREE.LatheGeometry(V2([[0.19, 0], [0.17, 0.12], [0.12, 0.3], [0.06, 0.46], [0.001, 0.56]]), 12), 0xd4b040, 0, hy + 0.27, 0));
      for (let i = 0; i < 4; i++) p.push(sph(0.03, 0x8a5aff, Math.cos(i * 1.57) * 0.16, hy + 0.33, Math.sin(i * 1.57) * 0.16));
      FAB = 6; for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; p.push(coneC(0.06, 0.34, 6, 0x15102a, Math.sin(a) * 0.18, hy - 0.04, -0.14, -1.35, 0, a * 0.5)); } FAB = 0;
    } else {
      FAB = 6; // a wild mane
      for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; p.push(coneC(0.07, 0.3, 6, baka ? 0x3a2a1a : 0x1b1020, Math.sin(a) * 0.15, hy + 0.12 + Math.cos(a) * 0.05, -0.15, -1.0, 0, a * 0.55)); }
      p.push(sph(0.2, baka ? 0x3a2a1a : 0x1b1020, 0, hy + 0.14, -0.06, 1.2, 0.6, 1.1));
      FAB = giant ? 8 : 0;
      if (giant) p.push(sph(0.265, metal, 0, hy + 0.07, -0.01, 1, 0.72, 1)); // horned iron helmet
      FAB = 0;
      if (!baka) for (const sx of [-1, 1]) {
        p.push(coneC(giant ? 0.075 : 0.06, giant ? 0.36 : 0.28, 10, bone, sx * 0.17, hy + 0.27, 0, 0, 0, -sx * 0.4));
        for (let k = 0; k < 2; k++) p.push(P(new THREE.TorusGeometry(0.05 - k * 0.012, 0.01, 4, 12), 0x9a8a70, sx * (0.13 + k * 0.035), hy + 0.18 + k * 0.08, 0, Math.PI / 2, 0, -sx * 0.4)); // ridges on the horns
      } else for (const sx of [-1, 1]) p.push(coneC(0.045, 0.14, 8, bone, sx * 0.16, hy + 0.2, 0.02, 0, 0, -sx * 0.7)); // little stub horns
    }
    hips.add(meshOf(p, M, false, false, big));
    hips.add(eyePair(kala ? 0xd0a8ff : rakta ? 0xffd040 : 0xff3d2e, 0.035, 0.085, hy + 0.04, 0.23));
    if (kala) { const third = eye(0xd0a8ff, 0.03); third.position.set(0, hy + 0.12, 0.245); hips.add(third); }
    if (rakta) { // glowing drops of blood that run down his hide
      const drops = [];
      for (let i = 0; i < 9; i++) { const a = i * 2.4, yy = 0.15 + (i % 4) * 0.13; drops.push(P(new THREE.SphereGeometry(0.03, 6, 5), 0xff2030, Math.cos(a) * 0.34, yy, Math.sin(a) * 0.3 + 0.04, 0, 0, 0, 1, 1.6, 1)); }
      hips.add(glowMesh(merge(drops), 0xff2030, 0.95));
    }
    for (const sx of [-1, 1]) {
      const A = new THREE.Group(); A.position.set(sx * (baka ? 0.44 : 0.38), 0.45, 0); hips.add(A);
      FAB = 4;
      const ap = [sph(0.11, skin, 0, 0, 0), ...limb(baka ? 0.1 : 0.085, 0.32, skin, 0, 0, 0), sph(0.1, sD, 0, -0.42, 0)];
      FAB = 0;
      for (let k = -1; k <= 1; k++) ap.push(coneC(0.018, 0.07, 5, bone, k * 0.04, -0.5, 0.05, Math.PI)); // claws
      ap.push(P(new THREE.TorusGeometry(0.09, 0.022, 6, 14), big ? gold : giant ? metal : 0xb8860b, 0, -0.16, 0, Math.PI / 2)); // arm ring
      if (kala) { FAB = 2; ap.push(cyl(0.13, 0.1, 0.2, 10, 0x5a2a8a, 0, -0.2, 0)); FAB = 0; } // wide sleeves
      A.add(meshOf(ap, M));
      ud.arms.push(A);
    }
    FAB = 0;
    const W = [];
    if (maha) { W.push(cyl(0.04, 0.04, 0.85, 10, 0x6b4223, 0, -1.25, 0.1)); W.push(sph(0.22, gold, 0, -1.5, 0.1)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; W.push(coneC(0.04, 0.12, 8, 0xfff0a0, Math.cos(a) * 0.22, -1.5, 0.1 + Math.sin(a) * 0.22, Math.PI / 2, 0, a + Math.PI / 2)); } }
    else if (baka) { // a whole young tree, torn up by the roots
      W.push(cylC(0.07, 0.13, 1.1, 10, 0x6b4a2a, 0, -0.95, 0.12));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; W.push(cylC(0.02, 0.012, 0.22, 5, 0x5a3a20, Math.cos(a) * 0.12, -0.42, 0.12 + Math.sin(a) * 0.12, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8)); } // roots
      for (let i = 0; i < 4; i++) W.push(sph(0.13, i % 2 ? 0x4f7a32 : 0x3f6a2a, (i - 1.5) * 0.08, -1.48 - (i % 2) * 0.08, 0.12 + (i % 2 ? 0.06 : -0.04), 1, 0.8, 1));
    } else if (rakta) { // a broad khanda
      W.push(cylC(0.035, 0.035, 0.22, 8, 0x5a3018, 0, -0.5, 0.1)); W.push(boxC(0.2, 0.04, 0.06, gold, 0, -0.62, 0.1));
      W.push(boxC(0.13, 0.8, 0.025, 0xdfe4ec, 0, -1.04, 0.1)); W.push(coneC(0.075, 0.14, 4, 0xdfe4ec, 0, -1.5, 0.1, Math.PI, 0, 0, 1, 1, 0.2));
      W.push(boxC(0.05, 0.6, 0.03, 0x9a1c24, 0.02, -1.0, 0.115)); // blood on the blade
    } else if (kala) { // a staff with a silver crescent cradling a glowing orb
      W.push(cylC(0.03, 0.03, 1.5, 8, 0x2a1a3a, 0, -0.55, 0.12)); W.push(P(new THREE.TorusGeometry(0.13, 0.025, 6, 16, Math.PI), 0xcfd6e6, 0, 0.27, 0.12, 0, 0, Math.PI));
      const orb = glowMesh(new THREE.SphereGeometry(0.08, 12, 10), 0xc8a0ff); orb.position.set(0, 0.24, 0.12); ud.orb = orb;
    } else {
      W.push(cylC(0.05, 0.1, 0.75, 12, 0x7a4a28, 0, -0.78, 0.12));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; W.push(coneC(0.03, 0.09, 8, 0xf2ead0, Math.cos(a) * 0.1, -0.98, 0.12 + Math.sin(a) * 0.1, 0, 0, Math.PI / 2 + a)); }
    }
    if (!imp) ud.arms[1].add(meshOf(W, M));
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
  p.push(P(new THREE.TorusGeometry(0.12, 0.008, 4, 16, Math.PI), 0xc8202a, 0, 0.55, 0.46, -0.4, 0, Math.PI));
  p.push(sph(0.036, 0xe8b830, 0, 0.43, 0.53)); p.push(cone(0.02, 0.03, 8, 0xc9962e, 0, 0.455, 0.53));
  // the jhool: a block-printed blanket across her back, with a gold border and tassels
  FAB = 2;
  p.push(P(new THREE.CylinderGeometry(0.255, 0.255, 0.4, 18, 1, true, Math.PI - 0.95, 1.9), 0xb8262a, 0, 0.64, -0.02, Math.PI / 2));
  FAB = 0;
  for (const z of [-0.22, 0.18]) p.push(P(new THREE.TorusGeometry(0.256, 0.01, 4, 18, 1.9), 0xe8b830, 0, 0.64, z, 0, 0, Math.PI / 2 - 0.95));
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
    if (z > 0) lp.push(P(new THREE.TorusGeometry(0.036, 0.008, 4, 12), 0xe8b830, 0, -0.37, 0, Math.PI / 2)); // ghungroo on the forelegs
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
