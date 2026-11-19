// Mocap for the 3D mode: the UAL clip bank from bm (assets/bm/clips.*), retargeted onto the Mixamo rigs.
// Retarget: each master joint's world rotation relative to its rest is applied to the matching target bone,
// after a per-bone correction that swings the target's rest bone onto the master's rest bone (A-pose vs T-pose).
import * as THREE from 'three';
import { boneKey } from './dollmesh.js';

const MAP = {
  pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head',
  clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
  clavicle_r: 'RightShoulder', upperarm_r: 'RightArm', lowerarm_r: 'RightForeArm', hand_r: 'RightHand',
  thigh_l: 'LeftUpLeg', calf_l: 'LeftLeg', foot_l: 'LeftFoot', ball_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', calf_r: 'RightLeg', foot_r: 'RightFoot', ball_r: 'RightToeBase',
};
// bone direction used for the rest-pose correction: master child, target child
const DIR = {
  spine_01: ['spine_02', 'Spine1'], spine_02: ['spine_03', 'Spine2'], spine_03: ['neck_01', 'Neck'], neck_01: ['Head', 'Head'],
  clavicle_l: ['upperarm_l', 'LeftArm'], upperarm_l: ['lowerarm_l', 'LeftForeArm'], lowerarm_l: ['hand_l', 'LeftHand'], hand_l: ['middle_01_l', 'LeftHandMiddle1'],
  clavicle_r: ['upperarm_r', 'RightArm'], upperarm_r: ['lowerarm_r', 'RightForeArm'], lowerarm_r: ['hand_r', 'RightHand'], hand_r: ['middle_01_r', 'RightHandMiddle1'],
  thigh_l: ['calf_l', 'LeftLeg'], calf_l: ['foot_l', 'LeftFoot'], foot_l: ['ball_l', 'LeftToeBase'],
  thigh_r: ['calf_r', 'RightLeg'], calf_r: ['foot_r', 'RightFoot'], foot_r: ['ball_r', 'RightToeBase'],
};
export const UPPER = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand']);
export const CLIPS = ['Idle_Loop', 'Idle_Talking_Loop', 'Idle_FoldArms_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Punch_Cross', 'Melee_Hook', 'Shield_Dash', 'Roll', 'Hit_Head', 'Hit_Chest', 'Hit_Knockback', 'LayToIdle', 'Yes', 'Interact', 'Zombie_Walk_Fwd_Loop', 'Crouch_Fwd_Loop',
  'Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Dash', 'Death01', 'Idle_No_Loop'];

const q = () => new THREE.Quaternion(), v = () => new THREE.Vector3();

export async function loadBank(base = 'assets/bm/') {
  const [meta, bin] = await Promise.all([fetch(base + 'clips.json').then(r => r.json()), fetch(base + 'clips.bin').then(r => r.arrayBuffer())]);
  const rot = new Int16Array(bin, 0, meta.pelvisByteOffset >> 1), pel = new Float32Array(bin, meta.pelvisByteOffset);
  const sk = meta.skeleton, n = sk.length, idx = Object.fromEntries(sk.map((j, i) => [j.name, i]));
  const clips = {};
  for (const name of CLIPS) {
    const c = meta.clips[name]; if (!c) continue;
    const tracks = new Array(n).fill(null);
    for (const [j, off, still] of c.tracks) { const m = still ? 1 : c.frames, a = new Float32Array(m * 4); for (let i = 0; i < m * 4; i++) a[i] = rot[off + i] / 32767; tracks[j] = a; }
    clips[name] = { name, frames: c.frames, dur: c.dur, loop: c.loop, tracks, pelvis: pel.subarray(c.pelvis, c.pelvis + c.frames * 3) };
  }
  // master forward kinematics helpers
  const fk = (frame, clip) => {
    const wq = [], wp = [];
    for (let j = 0; j < n; j++) {
      const s = sk[j], t = clip && clip.tracks[j]; let lq;
      if (t) { const k = t.length === 4 ? 0 : frame * 4; lq = q().set(t[k], t[k + 1], t[k + 2], t[k + 3]).normalize(); } else lq = q().set(s.r[0], s.r[1], s.r[2], s.r[3]);
      let lp = v().fromArray(s.t); if (clip && s.name === 'pelvis') lp.fromArray(clip.pelvis, frame * 3);
      if (s.parent < 0) { wq[j] = lq; wp[j] = lp; } else { wq[j] = wq[s.parent].clone().multiply(lq); wp[j] = lp.applyQuaternion(wq[s.parent]).add(wp[s.parent]); }
    }
    return { wq, wp };
  };
  return { sk, idx, clips, fk, rest: fk(0, null) };
}

// Bake every clip onto one prepared model (a dollmesh prepModel scene). Returns per-clip local quats for the mapped bones.
export function bakeRig(bank, model) {
  model.updateMatrixWorld(true);
  const tb = {}; model.traverse(o => { if (o.isBone) tb[boneKey(o.name)] = o; });
  const names = []; model.traverse(o => { if (o.isBone && Object.values(MAP).includes(boneKey(o.name))) names.push(boneKey(o.name)); });
  const m2t = {}; for (const m in MAP) if (tb[MAP[m]]) m2t[MAP[m]] = bank.idx[m];
  const R = bank.rest, wqT = {}, wpT = {};
  for (const k in tb) { wqT[k] = tb[k].getWorldQuaternion(q()); wpT[k] = tb[k].getWorldPosition(v()); }
  // facing: rotate master about Y so its toes point the way the target's toes point
  // facing from the hip line (left hip minus right hip), which is far more stable than splayed toes
  const leftM = R.wp[bank.idx.thigh_l].clone().sub(R.wp[bank.idx.thigh_r]).setY(0).normalize();
  const leftT = wpT.LeftUpLeg.clone().sub(wpT.RightUpLeg).setY(0).normalize();
  const F = q().setFromUnitVectors(leftM, leftT), Fi = F.clone().invert();
  // per-bone rest correction
  const C = {};
  for (const name of names) {
    const mj = Object.keys(MAP).find(m => MAP[m] === name), d = DIR[mj];
    if (!d || !tb[d[1]]) { C[name] = q(); continue; }
    const dm = R.wp[bank.idx[d[0]]].clone().sub(R.wp[bank.idx[mj]]).applyQuaternion(F).normalize();
    const dt = wpT[d[1]].clone().sub(wpT[name]).normalize();
    C[name] = q().setFromUnitVectors(dt, dm);
  }
  // world quat of each bone's parent object at rest (for unmapped parents it never changes)
  const hips = tb.Hips, hipsPar = hips.parent, hipsParQ = hipsPar.getWorldQuaternion(q()), hipsParS = hipsPar.getWorldScale(v()).x;
  const hipH = wpT.Hips.y - Math.min(wpT.LeftFoot?.y ?? 0, wpT.RightFoot?.y ?? 0) + .08, mHipH = R.wp[bank.idx.pelvis].y;
  const k = hipH / mHipH, pRest = R.wp[bank.idx.pelvis];
  const bones = names.map(nm => tb[nm]);
  const baked = {};
  for (const cn in bank.clips) {
    const clip = bank.clips[cn], N = clip.frames, rot = new Float32Array(N * names.length * 4), hip = new Float32Array(N * 3);
    let mx = 0, mz = 0; const hp = [];
    for (let f = 0; f < N; f++) {
      const P = bank.fk(f, clip), W = {};
      for (let i = 0; i < names.length; i++) {
        const name = names[i], b = bones[i], j = m2t[name];
        let wq;
        if (j === undefined) wq = null;
        else { const D = F.clone().multiply(P.wq[j]).multiply(R.wq[j].clone().invert()).multiply(Fi); wq = D.multiply(C[name]).multiply(wqT[name]); }
        // parent world in this frame
        let par = b.parent, pq;
        if (par.isBone && W[boneKey(par.name)]) pq = W[boneKey(par.name)];
        else { // unmapped ancestor chain: compose from nearest mapped ancestor using rest locals
          const chain = []; let o = par; while (o && o.isBone && !W[boneKey(o.name)]) { chain.unshift(o); o = o.parent; }
          pq = o && o.isBone ? W[boneKey(o.name)].clone() : o.getWorldQuaternion(q()); for (const c of chain) pq = pq.clone().multiply(c.quaternion);
        }
        if (!wq) wq = pq.clone().multiply(b.quaternion);
        W[name] = wq;
        const lq = pq.clone().invert().multiply(wq); lq.toArray(rot, (f * names.length + i) * 4);
      }
      const pp = P.wp[bank.idx.pelvis].clone().sub(pRest).applyQuaternion(F).multiplyScalar(k); hp.push(pp); mx += pp.x; mz += pp.z;
    }
    mx /= N; mz /= N;
    // world-space offset -> hips parent local
    const inv = hipsParQ.clone().invert();
    for (let f = 0; f < N; f++) { const o = hp[f]; o.x -= mx; o.z -= mz; o.applyQuaternion(inv).multiplyScalar(1 / hipsParS); o.toArray(hip, f * 3); }
    baked[cn] = { name: cn, frames: N, dur: clip.dur, loop: clip.loop, rot, hip };
  }
  const restHip = hips.position.clone(), restRot = bones.map(b => b.quaternion.clone());
  return { names, baked, restHip, restRot, hipH, upperMask: names.map(n => UPPER.has(n)), F };
}

// Per-character animator: a locomotion blend (synced phase) + one action layer + optional snapshot fade.
const tmp = new Float32Array(4);
function sampleInto(c, t, out, w, mask, maskVal) {
  const n = c.rot.length / 4 / c.frames, last = c.frames - 1;
  let f = c.loop ? (((t % c.dur) + c.dur) % c.dur) / c.dur * last : Math.min(Math.max(t, 0) / c.dur, 1) * last;
  let i = f | 0; if (i >= last) { i = last - 1; f = last; } const a = f - i, b = 1 - a;
  for (let j = 0; j < n; j++) {
    if (mask && mask[j] !== maskVal) continue;
    const k0 = (i * n + j) * 4, k1 = k0 + n * 4, r = c.rot;
    let s = r[k0] * r[k1] + r[k0 + 1] * r[k1 + 1] + r[k0 + 2] * r[k1 + 2] + r[k0 + 3] * r[k1 + 3] < 0 ? -a : a;
    let x = r[k0] * b + r[k1] * s, y = r[k0 + 1] * b + r[k1 + 1] * s, z = r[k0 + 2] * b + r[k1 + 2] * s, ww = r[k0 + 3] * b + r[k1 + 3] * s;
    const o = j * 4, d = out[o] * x + out[o + 1] * y + out[o + 2] * z + out[o + 3] * ww < 0 ? -w : w;
    out[o] += x * d; out[o + 1] += y * d; out[o + 2] += z * d; out[o + 3] += ww * d;
  }
  return f;
}
function hipInto(c, t, out, w) {
  const last = c.frames - 1; let f = c.loop ? (((t % c.dur) + c.dur) % c.dur) / c.dur * last : Math.min(Math.max(t, 0) / c.dur, 1) * last;
  let i = f | 0; if (i >= last) { i = last - 1; f = last; } const a = f - i, h = c.hip;
  for (let k = 0; k < 3; k++) out[k] += (h[i * 3 + k] * (1 - a) + h[i * 3 + 3 + k] * a) * w;
}

export class Animator {
  constructor(rig, bones) {
    this.rig = rig; this.bones = rig.names.map(n => bones[n]); this.n = rig.names.length;
    this.loco = {}; // clip -> {w, target}
    this.phase = 0; this.idleT = Math.random() * 9;
    this.act = null; // {clip, t, rate, w, fadeIn, fadeOut, mask}
    this.snap = null; this.snapW = 0; this.snapFade = 4;
    this.acc = new Float32Array(this.n * 4); this.hip = new Float32Array(3); this.lay = new Float32Array(this.n * 4);
  }
  setLoco(name, target) { (this.loco[name] || (this.loco[name] = { w: 0, target: 0 })).target = target; }
  clearLoco() { for (const k in this.loco) this.loco[k].target = 0; }
  play(name, o = {}) {
    const c = this.rig.baked[name]; if (!c) return null;
    this.act = { clip: c, t: o.start || 0, rate: o.rate || 1, w: this.act ? this.act.w : 0, fadeIn: o.fadeIn ?? .08, fadeOut: o.fadeOut ?? .18, upper: !!o.upper, end: o.end ?? c.dur, hold: !!o.hold };
    return this.act;
  }
  stop(fade = .15) { if (this.act) { this.act.end = Math.min(this.act.end, this.act.t + fade * this.act.rate); this.act.fadeOut = fade; } }
  get busy() { return !!this.act && this.act.t < this.act.end; }
  // freeze current bone locals and fade from them (used when a ragdoll gets up)
  snapshot(fade = .35) { this.snap = new Float32Array(this.n * 4); this.bones.forEach((b, i) => b.quaternion.toArray(this.snap, i * 4)); this.snapW = 1; this.snapFade = 1 / fade; }
  update(dt, cycleRate) {
    const R = this.rig, acc = this.acc, hip = this.hip; acc.fill(0); hip.fill(0);
    this.phase += dt * cycleRate; this.idleT += dt;
    let tw = 0; for (const k in this.loco) { const l = this.loco[k]; l.w += (l.target - l.w) * (1 - Math.exp(-dt * 10)); if (l.w < .001 && l.target === 0) l.w = 0; tw += l.w; }
    if (tw < .001) { this.loco.Idle_Loop = this.loco.Idle_Loop || { w: 0, target: 0 }; this.loco.Idle_Loop.w = 1; tw = 1; }
    for (const k in this.loco) {
      const l = this.loco[k]; if (!l.w) continue; const c = R.baked[k]; if (!c) continue; const w = l.w / tw;
      const t = /Idle|Talking|Fold/.test(k) ? this.idleT : l.t !== undefined ? l.t : (this.phase % 1) * c.dur;
      sampleInto(c, t, acc, w); hipInto(c, t, hip, w);
    }
    const a = this.act;
    if (a) {
      a.t += dt * a.rate;
      const left = (a.end - a.t) / a.rate; a.w = Math.min(1, Math.min(a.w + dt / Math.max(a.fadeIn, .001), left / Math.max(a.fadeOut, .001)));
      if (a.t >= a.end && !a.hold) this.act = null;
      else if (a.w > 0) {
        const w = a.w, lay = this.lay; lay.fill(0); const h3 = [0, 0, 0];
        sampleInto(a.clip, Math.min(a.t, a.end), lay, 1, a.upper ? R.upperMask : null, true);
        for (let j = 0; j < this.n; j++) {
          if (a.upper && !R.upperMask[j]) continue; const o = j * 4;
          nlerpInto(acc, o, lay, w);
        }
        if (!a.upper) { hipInto(a.clip, Math.min(a.t, a.end), h3, 1); for (let k = 0; k < 3; k++) hip[k] = hip[k] * (1 - w) + h3[k] * w; }
      }
    }
    if (this.snap && this.snapW > 0) { this.snapW = Math.max(0, this.snapW - dt * this.snapFade); const w = this.snapW * this.snapW * (3 - 2 * this.snapW); for (let j = 0; j < this.n; j++) nlerpInto(acc, j * 4, this.snap, w); if (!this.snapW) this.snap = null; }
    for (let j = 0; j < this.n; j++) { const o = j * 4; const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2], acc[o + 3]) || 1; this.bones[j].quaternion.set(acc[o] / l, acc[o + 1] / l, acc[o + 2] / l, acc[o + 3] / l); }
    const hb = this.bones[0]; hb.position.set(R.restHip.x + hip[0], R.restHip.y + hip[1], R.restHip.z + hip[2]);
  }
}
function nlerpInto(acc, o, src, w) {
  // acc (unnormalised) <- lerp(norm(acc), src, w)
  const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2], acc[o + 3]) || 1; let x = acc[o] / l, y = acc[o + 1] / l, z = acc[o + 2] / l, ww = acc[o + 3] / l;
  const s = x * src[o] + y * src[o + 1] + z * src[o + 2] + ww * src[o + 3] < 0 ? -w : w;
  acc[o] = x * (1 - w) + src[o] * s; acc[o + 1] = y * (1 - w) + src[o + 1] * s; acc[o + 2] = z * (1 - w) + src[o + 2] * s; acc[o + 3] = ww * (1 - w) + src[o + 3] * s;
}

// rotate a bone by a rotation given in character (holder) space, approximating the parent's frame by its current world
const _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _hq = new THREE.Quaternion();
export function addHolderRot(bone, holderQinv, dq) {
  bone.parent.getWorldQuaternion(_pq); _pq.premultiply(holderQinv); // parent in holder space
  _rq.copy(_pq).invert().multiply(dq).multiply(_pq); bone.quaternion.premultiply(_rq);
}
// swing a bone (in world space) so its bone->child direction points along dirW, by weight w
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _sq = new THREE.Quaternion(), _id = new THREE.Quaternion(), _pq2 = new THREE.Quaternion();
export function aimBone(bone, child, dirW, w) {
  if (!bone || !child || w <= .001) return; child.updateWorldMatrix(true, false);
  _a.setFromMatrixPosition(bone.matrixWorld); _b.setFromMatrixPosition(child.matrixWorld).sub(_a); if (_b.lengthSq() < 1e-10) return; _b.normalize();
  _sq.setFromUnitVectors(_b, dirW); if (w < 1) _sq.slerp(_id, 1 - w);
  addWorldRot(bone, _sq);
}
// premultiply a world-space rotation onto a bone
export function addWorldRot(bone, r) {
  bone.parent.getWorldQuaternion(_pq2); const pinv = _pq2.clone().invert();
  bone.quaternion.premultiply(pinv.multiply(r).multiply(_pq2)); bone.updateMatrixWorld(true);
}
export { MAP };
