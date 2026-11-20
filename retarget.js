// Retargets Mixamo-rig clips (Vesperwrithe's hero) onto another Mixamo-named skeleton (the goat-man).
// Each frame the source pose is solved to world rotations, each bone's swing from its own rest pose is carried
// over onto the target's rest pose, then turned back into local rotations. The hips only bob up and down (the
// game moves the goat itself), scaled to his height.
import * as THREE from 'three';

const strip = (n) => n.replace(/^mixamorig:?/, '');
const _q = new THREE.Quaternion(), _p = new THREE.Vector3();

/** rest data of a rig: world rotations and the bones parents-first, keyed by stripped name */
function rig(root) {
  root.updateMatrixWorld(true);
  const bones = [], by = {}, restW = new Map(), restL = new Map();
  root.traverse((o) => { if (o.isBone || /mixamorig/.test(o.name)) { bones.push(o); by[strip(o.name)] = o; restW.set(o, o.getWorldQuaternion(new THREE.Quaternion())); restL.set(o, o.quaternion.clone()); } });
  return { root, bones, by, restW, restL };
}

/**
 * src: the anim GLB's scene; dst: the goat's model root (in its rest pose).
 * Returns { clips: { [newName]: AnimationClip }, peaks: { [newName]: seconds } }: the peak is where the right hand
 * moves fastest (the strike), for the swings.
 */
export function retargetAll(src, clips, dst, list, fps = 30) {
  const S = rig(src), D = rig(dst);
  const sHips = S.by.Hips, dHips = D.by.Hips;
  const sHipRest = sHips.getWorldPosition(new THREE.Vector3()), dHipRest = dHips.getWorldPosition(new THREE.Vector3());
  const k = dHipRest.y / Math.max(1e-3, sHipRest.y);
  const dHipParentInv = dHips.parent.matrixWorld.clone().invert();
  const off = new Map(); // per target bone: inv(srcRestW) * dstRestW
  for (const b of D.bones) { const s = S.by[strip(b.name)]; if (s) off.set(b, S.restW.get(s).clone().invert().multiply(D.restW.get(b))); }
  const parentRestW = (b) => (D.restW.has(b.parent) ? null : b.parent.getWorldQuaternion(new THREE.Quaternion()));
  const out = { clips: {}, peaks: {}, missing: D.bones.filter((b) => !off.has(b)).map((b) => b.name) };
  const mixer = new THREE.AnimationMixer(src);
  for (const [name, srcName, t0 = 0, t1 = Infinity] of list) {
    const clip = clips.find((c) => c.name === srcName); if (!clip) continue;
    const a = mixer.clipAction(clip); a.play();
    const end = Math.min(t1, clip.duration), n = Math.max(2, Math.round((end - t0) * fps) + 1);
    const times = new Float32Array(n), q = new Map(D.bones.map((b) => [b, new Float32Array(n * 4)])), hp = new Float32Array(n * 3);
    const W = new Map(); let best = 0, bestF = 0;
    const ends = [S.by.RightHand, S.by.RightFoot].filter(Boolean), prev = ends.map(() => new THREE.Vector3()), cur = new THREE.Vector3();
    for (let f = 0; f < n; f++) {
      const t = t0 + ((end - t0) * f) / (n - 1); times[f] = t - t0;
      mixer.setTime(t); src.updateMatrixWorld(true);
      ends.forEach((e, i) => { e.getWorldPosition(cur); if (f > 0) { const v = cur.distanceTo(prev[i]); if (v > best) { best = v; bestF = f; } } prev[i].copy(cur); });
      for (const b of D.bones) {
        const pw = W.get(b.parent) || parentRestW(b) || new THREE.Quaternion();
        const s = S.by[strip(b.name)];
        const w = s && off.has(b) ? s.getWorldQuaternion(new THREE.Quaternion()).multiply(off.get(b)) : pw.clone().multiply(D.restL.get(b));
        W.set(b, w);
        _q.copy(pw).invert().multiply(w).toArray(q.get(b), f * 4);
      }
      // hips: the vertical bob only
      const dy = (sHips.getWorldPosition(_p).y - sHipRest.y) * k;
      _p.copy(dHipRest); _p.y += dy; _p.applyMatrix4(dHipParentInv).toArray(hp, f * 3);
    }
    a.stop(); mixer.uncacheAction(clip);
    const tracks = D.bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, q.get(b)));
    tracks.push(new THREE.VectorKeyframeTrack(`${dHips.name}.position`, times, hp));
    out.clips[name] = new THREE.AnimationClip(name, end - t0, tracks);
    out.peaks[name] = (bestF / (n - 1)) * (end - t0);
  }
  return out;
}
