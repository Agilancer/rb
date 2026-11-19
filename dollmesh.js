// Shared character-mesh helpers: load a Mixamo-rigged GLB, make its skin rigid per
// body segment, and let instances be cut apart at joints (dismemberment).
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as skClone } from './vendor/SkeletonUtils.js';

export const CHARS = { martleboro: ['Martlebrough', 1.5], louis_g: ['Luis-G', 1.72], apricot: ['Princess Apricot', 1.62] };
// the 11 ragdoll segments and the bone that drives each one
export const SEG_BONE = { pelvis: 'Hips', chest: 'Spine', head: 'Head', armL: 'LeftArm', foreL: 'LeftForeArm', armR: 'RightArm', foreR: 'RightForeArm', thighL: 'LeftUpLeg', shinL: 'LeftLeg', thighR: 'RightUpLeg', shinR: 'RightLeg' };
export const SEGS = Object.keys(SEG_BONE);
export const SEG_PARENT = { chest: 'pelvis', head: 'chest', armL: 'chest', foreL: 'armL', armR: 'chest', foreR: 'armR', thighL: 'pelvis', shinL: 'thighL', thighR: 'pelvis', shinR: 'thighR' };
const BONE_SEG = Object.fromEntries(Object.entries(SEG_BONE).map(([s, b]) => [b, s]));
export const boneKey = n => n.replace(/^mixamorig:?/, '');

// Prepare a loaded glTF scene: material, rigid skin weights, per-vertex segment ids, scale to height (feet at y=0).
// extra townsfolk from the bm repo: [name, height, hips height, icon]
export const FOLK = { knight_blue: ['Blue Knight', 1.86, 1.036, '🛡️'], lord_red: ['Red Lord', 1.8, .995, '🤴'], lady_blue: ['Blue Lady', 1.68, .975, '👸'], crone: ['Crone', 1.55, .851, '🧙‍♀️'], smith: ['Blacksmith', 1.74, .942, '⚒️'], sage: ['Sage', 1.7, .887, '🧙'], old_man: ['Old Man', 1.72, .904, '👴'], worker: ['Worker', 1.83, .99, '👷'], dude: ['Dude', 1.79, .954, '🧔'], elder: ['Elder', 1.76, .952, '🧓'] };
export function prepModel(sc, tex, height, hips) {
  let mesh = null; sc.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  mesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: .85 });
  const sk = mesh.skeleton, g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count;
  const segOfBone = sk.bones.map(b => { let o = b; while (o && o.isBone) { const s = BONE_SEG[boneKey(o.name)]; if (s) return SEGS.indexOf(s); o = o.parent; } return 0; });
  // Keep the artist's smooth weights for the living body (rigid weights are what turned the armpits into
  // a wing suit whenever an arm went up). A rigid copy is kept for when the body gets cut apart.
  const segOf = new Uint8Array(n), rigidI = new Float32Array(n * 4), rigidW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    rigidI[i * 4] = best; rigidW[i * 4] = 1; segOf[i] = segOfBone[best];
  }
  sc.userData.rigidI = rigidI; sc.userData.rigidW = rigidW;
  sc.updateMatrixWorld(true); let top = 0, bot = 1e9;
  sc.traverse(o => { if (o.isBone) { const y = o.getWorldPosition(new THREE.Vector3()).y; if (/HeadTop/.test(o.name)) top = y; if (/Foot|Toe/.test(o.name)) bot = Math.min(bot, y); } });
  let hipY = 0; sc.traverse(o => { if (o.isBone && /Hips$/.test(o.name)) hipY = o.getWorldPosition(new THREE.Vector3()).y; });
  const s = top ? height / (top - bot + .06) : hips / (hipY - bot + .05); sc.scale.setScalar(s); sc.position.y = -(bot - .05) * s; sc.userData.top = height;
  sc.userData.segOf = segOf; sc.userData.index = g.index.array.slice();
  return sc;
}

export function loadChars(onEach) {
  const L = new GLTFLoader(), TL = new THREE.TextureLoader(), out = {};
  return Promise.all(Object.keys(CHARS).map(k => new Promise(res => L.load(`assets/models/${k}.glb`, g => {
    const tex = TL.load(`assets/models/${k}_c.webp`); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    out[k] = prepModel(g.scene, tex, CHARS[k][1]); onEach?.(k); res();
  }, undefined, err => { console.error('model failed', k, err); res(); })))).then(() => out);
}

export function loadFolk() {
  const L = new GLTFLoader(), TL = new THREE.TextureLoader(), out = {};
  return Promise.all(Object.keys(FOLK).map(k => new Promise(res => L.load(`assets/models/folk/${k}.glb`, g => {
    const tex = TL.load(`assets/models/folk/${k}_c.webp`); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    try { out[k] = prepModel(g.scene, tex, FOLK[k][1], FOLK[k][2]); } catch (e) { console.error('folk failed', k, e); } res();
  }, undefined, err => { console.error('folk failed', k, err); res(); })))).then(() => out);
}

// One character instance. bones are keyed without the "mixamorig" prefix (Hips, LeftArm, ...).
// sever(seg) visually detaches that segment (and everything below it) from its parent:
// triangles bridging the cut are dropped so nothing stretches. The caller moves the bones.
export function instance(model) {
  const root = skClone(model), bones = {}; let mesh = null;
  root.traverse(o => { if (o.isBone) bones[boneKey(o.name)] = o; if (o.isSkinnedMesh) mesh = o; });
  const g = mesh.geometry, g2 = new THREE.BufferGeometry();
  for (const k in g.attributes) g2.setAttribute(k, g.attributes[k]);
  g2.setIndex(new THREE.BufferAttribute(model.userData.index.slice(), 1));
  mesh.geometry = g2; mesh.frustumCulled = false; mesh.material = mesh.material.clone();
  const cut = new Set(), segOf = model.userData.segOf, src = model.userData.index;
  let rigid = false;
  const makeRigid = () => {
    if (rigid || !model.userData.rigidI) return; rigid = true; const si = g2.attributes.skinIndex, n = si.count;
    const I = new (si.array.constructor)(n * 4); for (let i = 0; i < n * 4; i++) I[i] = model.userData.rigidI[i];
    g2.setAttribute('skinIndex', new THREE.BufferAttribute(I, 4)); g2.setAttribute('skinWeight', new THREE.BufferAttribute(model.userData.rigidW.slice(), 4));
  };
  const label = s => { let o = SEGS[s]; while (o) { if (cut.has(o)) return SEGS.indexOf(o) + 1; o = SEG_PARENT[o]; } return 0; };
  return {
    root, mesh, bones, cut,
    sever(seg) {
      if (cut.has(seg) || !SEG_PARENT[seg]) return; cut.add(seg); makeRigid();
      const lab = SEGS.map((_, i) => label(i)), dst = g2.index.array; let n = 0;
      for (let i = 0; i < src.length; i += 3) { const a = lab[segOf[src[i]]]; if (a === lab[segOf[src[i + 1]]] && a === lab[segOf[src[i + 2]]]) { dst[n++] = src[i]; dst[n++] = src[i + 1]; dst[n++] = src[i + 2]; } }
      g2.setDrawRange(0, n); g2.index.needsUpdate = true;
    },
    dispose() { g2.dispose(); mesh.material.dispose(); },
  };
}
