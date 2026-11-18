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
export function prepModel(sc, tex, height) {
  let mesh = null; sc.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  mesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: .85 });
  const sk = mesh.skeleton, g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = si.count;
  const segOfBone = sk.bones.map(b => { let o = b; while (o && o.isBone) { const s = BONE_SEG[boneKey(o.name)]; if (s) return SEGS.indexOf(s); o = o.parent; } return 0; });
  const segOf = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    si.setXYZW(i, best, 0, 0, 0); sw.setXYZW(i, 1, 0, 0, 0); segOf[i] = segOfBone[best];
  }
  si.needsUpdate = sw.needsUpdate = true;
  sc.updateMatrixWorld(true); let top = 0, bot = 1e9;
  sc.traverse(o => { if (o.isBone) { const y = o.getWorldPosition(new THREE.Vector3()).y; if (/HeadTop/.test(o.name)) top = y; if (/Foot|Toe/.test(o.name)) bot = Math.min(bot, y); } });
  const s = height / (top - bot + .06); sc.scale.setScalar(s); sc.position.y = -(bot - .05) * s;
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
  const label = s => { let o = SEGS[s]; while (o) { if (cut.has(o)) return SEGS.indexOf(o) + 1; o = SEG_PARENT[o]; } return 0; };
  return {
    root, mesh, bones, cut,
    sever(seg) {
      if (cut.has(seg) || !SEG_PARENT[seg]) return; cut.add(seg);
      const lab = SEGS.map((_, i) => label(i)), dst = g2.index.array; let n = 0;
      for (let i = 0; i < src.length; i += 3) { const a = lab[segOf[src[i]]]; if (a === lab[segOf[src[i + 1]]] && a === lab[segOf[src[i + 2]]]) { dst[n++] = src[i]; dst[n++] = src[i + 1]; dst[n++] = src[i + 2]; } }
      g2.setDrawRange(0, n); g2.index.needsUpdate = true;
    },
    dispose() { g2.dispose(); mesh.material.dispose(); },
  };
}
