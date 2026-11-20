// Rolling-hills terrain for the 3D mode: one heightfield shared by physics (cannon Heightfield) and the visible mesh.
// The old town sits flat at y=0 in the middle; settlements get their own flattened plateaus.
import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';

export const W = 1520, ES = 4, N = W / ES + 1, HALF = W / 2;
export const WATER = -2.6;

// deterministic value noise
function hash(x, z) { let h = (x * 374761393 + z * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, o = 5) { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * (noise(x * f, z * f) * 2 - 1); a *= .5; f *= 2.03; } return s; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// raw hills, before flattening
export function rawH(x, z) {
  const r = Math.hypot(x, z), e = Math.max(Math.abs(x), Math.abs(z));
  let h = fbm(x / 300 + 7.3, z / 300 - 2.1) * 70 + fbm(x / 95, z / 95, 4) * 14 + 16;
  h += Math.pow(Math.max(0, fbm(x / 170 - 3, z / 170 + 5, 3)), 1.6) * 90; // the odd big hill
  h += sstep(470, 740, e) * (90 + fbm(x / 120, z / 120, 3) * 60);         // mountains ring the map edge
  for (const b of BUMPS) { const d = Math.hypot(x - b.x, z - b.z) / b.r; if (d < 2.2) h += b.h * Math.exp(-d * d * 2.2); }
  return h * sstep(105, 240, r);                                            // town stays flat
}
// hand-placed hills: {x, z, r, h}
export const BUMPS = [];
export function addBump(x, z, r, h) { BUMPS.push({ x, z, r, h }); }
// flattened places: {x, z, r, h} (h filled in from rawH at the centre if omitted)
export const PLATEAUS = [];
export function addPlateau(x, z, r, h, bw = 70) { const p = { x, z, r, bw, h: h ?? Math.max(rawH(x, z), 1.5) }; PLATEAUS.push(p); return p; }
export function designH(x, z) {
  let h = rawH(x, z);
  for (const p of PLATEAUS) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + p.bw) h = p.h + (h - p.h) * sstep(p.r, p.r + p.bw, d); }
  return h;
}

let data = null;
// exact height of the physics surface (matches cannon's triangle split)
export function heightAt(x, z) {
  const fx = (x + HALF) / ES, fy = (HALF - z) / ES;
  let i = Math.floor(fx), j = Math.floor(fy); i = Math.min(N - 2, Math.max(0, i)); j = Math.min(N - 2, Math.max(0, j));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j));
  const h00 = data[i][j], h10 = data[i + 1][j], h01 = data[i][j + 1], h11 = data[i + 1][j + 1];
  return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 1.5; return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

export function buildData() {
  data = []; for (let i = 0; i < N; i++) { const row = new Array(N); for (let j = 0; j < N; j++) row[j] = designH(i * ES - HALF, HALF - j * ES); data.push(row); }
  return data;
}
export function makeBody(material, group, mask) {
  const shape = new CANNON.Heightfield(data, { elementSize: ES });
  const b = new CANNON.Body({ mass: 0, material, collisionFilterGroup: group, collisionFilterMask: mask });
  b.addShape(shape); b.quaternion.setFromEuler(-Math.PI / 2, 0, 0); b.position.set(-HALF, 0, HALF); b.isTerrain = true; return b;
}

export function makeMesh(tex) {
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3), spl = new Float32Array(N * N * 3), idx = [];
  const nrm = new THREE.Vector3();
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j, x = i * ES - HALF, z = HALF - j * ES, h = data[i][j];
    pos.set([x, h, z], k * 3); uv.set([x / W, z / W], k * 2);
    normalAt(x, z, nrm); const slope = 1 - nrm.y, m = fbm(x / 60, z / 60, 3) * .5 + .5, r = Math.hypot(x, z);
    let rock = sstep(.24, .42, slope) + sstep(105, 160, h) * .6, dirt = sstep(.14, .28, slope) * (1 - rock) * .8 + sstep(.62, .85, m) * .18;
    if (h < WATER + 1.2) dirt = Math.max(dirt, 1 - sstep(WATER, WATER + 1.2, h)); // muddy shores
    if (r < 98) { dirt *= .3; rock = 0; }
    rock = Math.min(1, rock); dirt = Math.min(1 - rock, dirt); spl.set([1 - rock - dirt, dirt, rock], k * 3);
    const t = .86 + m * .22; col.set([t * (0.97 + fbm(x / 33, z / 33, 2) * .06), t, t * .96], k * 3);
  }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const a = i * N + j, b = (i + 1) * N + j, c = i * N + j + 1, d = (i + 1) * N + j + 1;
    idx.push(a, b, c, d, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('splat', new THREE.BufferAttribute(spl, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // make sure the faces point up
  if (g.attributes.normal.getY(Math.floor(N * N / 2)) < 0) { for (let n = 0; n < idx.length; n += 3) { const t = idx[n + 1]; idx[n + 1] = idx[n + 2]; idx[n + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const rep = W / 9;
  for (const t of [tex.grass, tex.dirt, tex.rock]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  tex.grass.repeat.set(rep, rep);
  const mat = new THREE.MeshLambertMaterial({ map: tex.grass, vertexColors: true });
  mat.onBeforeCompile = sh => {
    sh.uniforms.dirtMap = { value: tex.dirt }; sh.uniforms.rockMap = { value: tex.rock };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 splat; varying vec3 vSplat;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplat = splat;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D dirtMap; uniform sampler2D rockMap; varying vec3 vSplat;')
      .replace('#include <map_fragment>', `
        mat2 rot = mat2(.7986, -.6018, .6018, .7986); // 37 degrees
        vec4 tg = texture2D(map, vMapUv); vec4 tg2 = texture2D(map, rot * vMapUv * .37 + .31);
        float mac = texture2D(map, vMapUv * .021 + .7).g, lf = texture2D(map, rot * vMapUv * .045 + .13).g;
        tg = mix(tg, tg2, .45) * (.86 + mac * .3) * (.88 + lf * .24);
        tg.rgb = mix(tg.rgb, vec3(dot(tg.rgb, vec3(.3,.59,.11))), .38) * vec3(.95,.93,.82);
        vec4 td = texture2D(dirtMap, vMapUv * .9); vec4 tr = mix(texture2D(rockMap, vMapUv * .45), texture2D(rockMap, rot * vMapUv * .17 + .5), .45); td = mix(td, texture2D(dirtMap, rot * vMapUv * .33 + .2), .4);
        vec4 texelColor = tg * vSplat.x + td * vSplat.y + tr * vSplat.z;
        diffuseColor *= texelColor;`);
  };
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
