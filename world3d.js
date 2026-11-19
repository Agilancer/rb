// REALISTIC BEATUP 3D: third-person chaos sandbox. three r160 + cannon-es.
import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';
import { loadChars, instance, SEGS, SEG_BONE, SEG_PARENT, CHARS } from './dollmesh.js';

const $ = s => document.querySelector(s);
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const pick = a => a[Math.random() * a.length | 0];
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const CV = (x = 0, y = 0, z = 0) => new CANNON.Vec3(x, y, z);

// ---------- renderer / scene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7fd0ff); scene.fog = new THREE.Fog(0xa8e0ff, 70, 210);
const camera = new THREE.PerspectiveCamera(62, 1, .15, 420);
function resize() { const w = innerWidth || 1280, h = innerHeight || 720; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
scene.add(new THREE.HemisphereLight(0xdff3ff, 0x6fa35a, 1.5));
const sun = new THREE.DirectionalLight(0xfff2d6, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 160 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .03;
scene.add(sun, sun.target);
const boomLight = new THREE.PointLight(0xffa030, 0, 40, 1.6); scene.add(boomLight);

// ---------- textures / materials ----------
const TEX = {}, M = {};
const GEO = new Map();
const boxGeo = (w, h, d) => { const k = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`; let g = GEO.get(k); if (!g) GEO.set(k, g = new THREE.BoxGeometry(w, h, d)); return g; };
const sphGeo = new THREE.SphereGeometry(1, 14, 10), cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const lam = (o) => new THREE.MeshLambertMaterial(o);
function texRep(n, rx, ry) { const t = TEX[n].clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; }
async function loadTex() {
  const TL = new THREE.TextureLoader();
  await Promise.all(['wood', 'wood2', 'brick', 'stone', 'flag', 'rug', 'metal'].map(async n => {
    try { const t = await TL.loadAsync(`assets/tex/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; TEX[n] = t; }
    catch (e) { console.warn('texture missing', n); TEX[n] = new THREE.Texture(); }
  }));
  for (const n in TEX) M[n] = lam({ map: TEX[n] });
  M.brickA = lam({ map: TEX.brick, color: 0xffe0b0 }); M.brickB = lam({ map: TEX.brick, color: 0xffb8c8 }); M.brickC = lam({ map: TEX.brick, color: 0xb8d8ff }); M.brickD = lam({ map: TEX.brick, color: 0xd8ffc0 });
  M.barrel = lam({ map: TEX.metal, color: 0xff2a2a }); M.band = lam({ color: 0xffd23f });
  M.leaf = lam({ color: 0x3fb950 }); M.leaf2 = lam({ color: 0x7ad151 }); M.white = lam({ color: 0xffffff }); M.red = lam({ color: 0xe2334b });
  M.black = lam({ color: 0x22252b }); M.glass = lam({ color: 0x9fd8ff }); M.tyre = lam({ color: 0x1c1c20 });
  M.pad = lam({ color: 0xffd23f }); M.padRim = lam({ color: 0x2f6fff }); M.pad2 = lam({ color: 0xff7a1a });
  M.gren = lam({ color: 0x2f5d2a }); M.steel = lam({ map: TEX.metal, color: 0x8892a0 });
  M.roofs = [0xe2334b, 0x2f6fff, 0x2aa84a, 0xff9f1c, 0x9b5de5].map(c => lam({ color: c }));
  M.cap = lam({ color: 0x7a0008 }); M.bone = lam({ color: 0xf6f1e4 }); M.tongue = lam({ color: 0xff6fa5 });
}

// ---------- physics ----------
const G_WORLD = 1, G_CHAR = 2, G_RAG = 4, ALL = 7;
const matDef = new CANNON.Material('def'), matChar = new CANNON.Material('char'), matBounce = new CANNON.Material('bounce');
let world, town, things, debris, npcs, cars, groups, timers, later, hazards, player, grab, T = 0;
const FIX = 1 / 60; let timeScale = 1, started = false, acc = 0;
const S = { score: 0, combo: 1, comboT: -9, obj: {}, pins: 0, limbs: 0, kills: 0, chain: { n: 0, t: -9 } };

function newWorld() {
  world = new CANNON.World({ gravity: CV(0, -22, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true; world.solver.iterations = 8;
  world.defaultContactMaterial.friction = .5; world.defaultContactMaterial.restitution = .1;
  world.addContactMaterial(new CANNON.ContactMaterial(matChar, matDef, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matChar, matChar, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBounce, matDef, { friction: .4, restitution: .55 }));
  const g = new CANNON.Body({ mass: 0, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL });
  g.addShape(new CANNON.Plane()); g.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(g);
  for (const [x, z, hx, hz] of [[74, 0, 1, 76], [-74, 0, 1, 76], [0, 74, 76, 1], [0, -74, 76, 1]]) addStatic(null, new CANNON.Box(CV(hx, 40, hz)), [x, 40, z]);
}
function addStatic(mesh, shape, pos, q, extra) {
  const b = new CANNON.Body({ mass: 0, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL });
  b.addShape(shape); b.position.set(pos[0], pos[1], pos[2]); if (q) b.quaternion.set(q.x, q.y, q.z, q.w); if (extra) Object.assign(b, extra); world.addBody(b);
  if (mesh) { mesh.position.set(pos[0], pos[1], pos[2]); if (q) mesh.quaternion.copy(q); shadow(mesh); town.add(mesh); }
  return b;
}
function shadow(m) { m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return m; }

// ---------- things (props, breakables, debris) ----------
function addThing(o) {
  const t = { kind: o.kind, name: o.name, pts: o.pts || 0, tough: o.tough ?? 30, hp: o.hp ?? 0, mass: o.mass || 20, frozen: !!o.frozen, group: o.group || null, pieces: o.pieces || null, temp: !!o.temp, born: T, dead: false, fuse: o.fuse || 0, pow: o.pow || 1 };
  let mesh = o.mesh;
  if (!mesh) { mesh = new THREE.Group(); for (const pc of o.pieces) { const m = new THREE.Mesh(pc.geo || boxGeo(pc.s[0], pc.s[1], pc.s[2]), pc.mat); m.position.set(pc.p[0], pc.p[1], pc.p[2]); if (pc.ry) m.rotation.y = pc.ry; mesh.add(m); } }
  shadow(mesh); t.mesh = mesh; mesh.position.set(o.pos[0], o.pos[1], o.pos[2]); if (o.q) mesh.quaternion.copy(o.q); town.add(mesh);
  const b = new CANNON.Body({ mass: t.frozen ? 0 : t.mass, material: o.mat || matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL, linearDamping: .03, angularDamping: .1, sleepSpeedLimit: .4, sleepTimeLimit: .6 });
  b.addShape(o.shape); b.position.set(o.pos[0], o.pos[1], o.pos[2]); if (o.q) b.quaternion.set(o.q.x, o.q.y, o.q.z, o.q.w);
  if (o.vel) b.velocity.set(o.vel.x, o.vel.y, o.vel.z); if (o.spin) b.angularVelocity.set(rnd(-o.spin, o.spin), rnd(-o.spin, o.spin), rnd(-o.spin, o.spin));
  b.thing = t; t.body = b; b.addEventListener('collide', onThingCollide); world.addBody(b);
  if (!t.frozen && o.asleep) b.sleep();
  things.push(t); if (t.group) { t.group.members.push(t); t.group.total++; } if (t.temp) debris.push(t);
  return t;
}
function removeThing(t) {
  if (t.dead) return; t.dead = true; world.removeBody(t.body); town.remove(t.mesh);
  const i = things.indexOf(t); if (i >= 0) things.splice(i, 1);
  if (grab && grab.t === t) releaseGrab();
}
function onThingCollide(e) {
  const t = e.target.thing, o = e.body; if (!t || t.dead) return;
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v < 4) return;
  later.push(() => thingImpact(t, o, v));
}
function thingImpact(t, o, v) {
  if (t.dead || (!t.frozen && !t.pieces && t.kind !== 'barrel')) return;
  const om = o.type === CANNON.Body.KINEMATIC ? 500 : (o.mass || 1000);
  let power = v * Math.min(1.5, om / 40) * 4;
  if (o.ragOf) power *= 2; if (o.char) power *= .5;
  hitThing(t, CV(o.velocity.x * .5, o.velocity.y * .5 + 1, o.velocity.z * .5), power);
}
function addVel(b, dv, spin = 3) { b.wakeUp(); b.velocity.x += dv.x; b.velocity.y += dv.y; b.velocity.z += dv.z; b.angularVelocity.x += rnd(-spin, spin); b.angularVelocity.y += rnd(-spin, spin); b.angularVelocity.z += rnd(-spin, spin); }
function hitThing(t, dv, power) {
  if (t.dead) return;
  if (t.kind === 'barrel') { t.hp -= power; if (t.hp <= 0) { if (!t.fuse) t.fuse = rnd(.12, .4); } addVel(t.body, dv); }
  else if (t.pieces && power >= t.tough) shatter(t, dv);
  else if (t.frozen) { if (power >= t.tough) unfreeze(t, dv); }
  else addVel(t.body, dv);
}
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion(), _tv = V3(), _Y = V3(0, 1, 0);
function shatter(t, dv) {
  if (t.dead) return; t.mesh.updateMatrixWorld(true); t.mesh.getWorldQuaternion(_tq); const bv = t.body.velocity;
  for (const pc of t.pieces) {
    _tv.set(pc.p[0], pc.p[1], pc.p[2]); t.mesh.localToWorld(_tv); _tq2.copy(_tq); if (pc.ry) _tq2.multiply(new THREE.Quaternion().setFromAxisAngle(_Y, pc.ry));
    const k = rnd(.5, 1.1);
    addThing({ kind: 'debris', temp: true, mass: pc.m || 4, pos: [_tv.x, _tv.y, _tv.z], q: _tq2.clone(), mesh: new THREE.Mesh(pc.geo || boxGeo(pc.s[0], pc.s[1], pc.s[2]), pc.mat), shape: new CANNON.Box(CV(pc.s[0] / 2, pc.s[1] / 2, pc.s[2] / 2)), vel: { x: bv.x + dv.x * k + rnd(-1.5, 1.5), y: bv.y + dv.y * k + rnd(0, 2), z: bv.z + dv.z * k + rnd(-1.5, 1.5) }, spin: 5 });
  }
  const p = t.body.position; puff(p.x, p.y, p.z, 8, 0xc9a877, 3, .12);
  if (t.pts) addScore(`${t.name} ${t.verb || 'wrecked'}`, t.pts); sfx('crack');
  removeThing(t);
}
function unfreeze(t, dv) {
  if (t.dead || !t.frozen) return; t.frozen = false; const b = t.body;
  b.type = CANNON.Body.DYNAMIC; b.mass = t.mass; b.updateMassProperties(); b.aabbNeedsUpdate = true; b.wakeUp();
  if (dv) { b.velocity.set(dv.x, dv.y, dv.z); b.angularVelocity.set(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)); }
  t.temp = true; t.born = T; debris.push(t); S.score += 10; hudDirty = true;
  const g = t.group; if (!g) return; g.loose++;
  if (!g.done && g.loose >= g.total * .5) { g.done = true; addScore(`${g.name} wrecked`, g.pts, true); if (g.name === 'House') objective('house'); sfx('crack'); }
  const p = b.position;
  for (const o of g.members) {
    if (!o.frozen || o.dead) continue; const q = o.body.position;
    if (o.kind === 'roof') { if (g.loose >= g.total * .3) after(.1, () => unfreeze(o, CV(rnd(-1, 1), 1, rnd(-1, 1)))); }
    else if (q.y > p.y + .3 && Math.hypot(q.x - p.x, q.z - p.z) < 1.9) after(rnd(.08, .2), () => unfreeze(o, CV(rnd(-.5, .5), 0, rnd(-.5, .5))));
  }
}
function after(t, f) { timers.push({ t, f }); }

// ---------- score / hud ----------
let hudDirty = true;
const OBJ = [['launch', 'Launch someone 30 m'], ['chain', 'Set off a 4-barrel chain reaction'], ['strike', 'Bowl over all 10 pins'], ['roadkill', 'Get run over by a car'], ['tower', 'Fall 18 m and go splat'], ['limbs', 'Remove 6 limbs'], ['house', 'Demolish a house']];
function addScore(label, pts, big) {
  S.combo = (T - S.comboT < 3.5) ? Math.min(S.combo + 1, 10) : 1; S.comboT = T;
  const p = Math.round(pts * (1 + (S.combo - 1) * .15)); S.score += p; hudDirty = true; feed(label, p, big);
}
function feed(label, p, big) {
  const f = $('#feed'), d = document.createElement('div'); if (big) d.className = 'big';
  d.textContent = label; if (p) { const b = document.createElement('b'); b.textContent = '+' + p; d.append(b); }
  f.prepend(d); while (f.children.length > 7) f.lastChild.remove();
  setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 3800);
}
function objective(id) { if (S.obj[id]) return; S.obj[id] = true; addScore('DONE: ' + OBJ.find(o => o[0] === id)[1], 1000, true); drawObj(); }
function drawObj() { $('#objs').innerHTML = OBJ.map(([id, t]) => `<div class="${S.obj[id] ? 'done' : ''}">${S.obj[id] ? '&#10004;' : '&#9744;'} ${t}</div>`).join(''); }
function hud() {
  if (hudDirty) { $('#pts').textContent = S.score.toLocaleString(); hudDirty = false; }
  const c = (T - S.comboT < 3.5 && S.combo > 1) ? `COMBO x${(1 + (S.combo - 1) * .15).toFixed(2)}` : ''; if ($('#combo').textContent !== c) $('#combo').textContent = c;
}

// ---------- sound ----------
let AC = null, noiseBuf = null;
function initAudio() { try { AC = new (window.AudioContext || window.webkitAudioContext)(); noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } catch (e) { AC = null; } }
function sfx(k, vol = 1) {
  if (!AC || AC.state !== 'running') return;
  try {
    const t = AC.currentTime, g = AC.createGain(); g.connect(AC.destination);
    const noise = (dur, f, type = 'lowpass') => { const s = AC.createBufferSource(); s.buffer = noiseBuf; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; s.connect(fl); fl.connect(g); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.start(t); s.stop(t + dur); };
    const tone = (f0, f1, dur, type = 'sine') => { const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(g); g.gain.setValueAtTime(vol * .5, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.start(t); o.stop(t + dur); };
    if (k === 'boom') { noise(.9, 500); tone(90, 30, .5); } else if (k === 'hit') tone(170, 45, .14, 'triangle'); else if (k === 'splat') noise(.18, 900, 'bandpass');
    else if (k === 'crack') noise(.22, 2200, 'bandpass'); else if (k === 'boing') tone(180, 620, .25); else if (k === 'whoosh') noise(.15, 1500, 'highpass'); else if (k === 'jet') noise(.08, 700);
  } catch (e) { }
}

// ---------- particles + decals ----------
const PN = 900, pm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), PN);
pm.frustumCulled = false; pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(pm);
const PP = { x: new Float32Array(PN), y: new Float32Array(PN), z: new Float32Array(PN), vx: new Float32Array(PN), vy: new Float32Array(PN), vz: new Float32Array(PN), life: new Float32Array(PN), max: new Float32Array(PN), size: new Float32Array(PN), type: new Uint8Array(PN) };
let pi = 0; const _c = new THREE.Color();
{ const a = pm.instanceMatrix.array; a.fill(0); for (let i = 0; i < PN; i++) { a[i * 16 + 15] = 1; pm.setColorAt(i, _c.set(0xffffff)); } }
// type 0 blood, 1 fire, 2 smoke, 3 shrapnel/dust
function spawnP(x, y, z, vx, vy, vz, color, size, life, type) {
  const i = pi; pi = (pi + 1) % PN; PP.x[i] = x; PP.y[i] = y; PP.z[i] = z; PP.vx[i] = vx; PP.vy[i] = vy; PP.vz[i] = vz; PP.life[i] = PP.max[i] = life; PP.size[i] = size; PP.type[i] = type;
  pm.setColorAt(i, _c.set(color)); pm.instanceColor.needsUpdate = true;
}
const BLOOD = [0x8f0008, 0x6e0006, 0xa8060e, 0x7c000a];
function blood(x, y, z, dx, dy, dz, n, spd = 5) { for (let i = 0; i < n; i++) { const k = rnd(.3, 1) * spd; spawnP(x + rnd(-.1, .1), y + rnd(-.1, .1), z + rnd(-.1, .1), dx * k + rnd(-2, 2), dy * k + rnd(0, 3.5), dz * k + rnd(-2, 2), pick(BLOOD), rnd(.035, .1), rnd(.7, 1.5), 0); } }
function puff(x, y, z, n, color, spd, size) { for (let i = 0; i < n; i++) spawnP(x, y, z, rnd(-spd, spd), rnd(0, spd), rnd(-spd, spd), color, size * rnd(.6, 1.3), rnd(.4, .9), 3); }
function updateParticles(dt) {
  const a = pm.instanceMatrix.array;
  for (let i = 0; i < PN; i++) {
    if (PP.life[i] <= 0) continue; const ty = PP.type[i]; PP.life[i] -= dt; let s = PP.size[i]; const u = Math.max(0, PP.life[i] / PP.max[i]);
    if (ty === 0 || ty === 3) PP.vy[i] -= 20 * dt; else { const d = Math.exp(-2.5 * dt); PP.vx[i] *= d; PP.vz[i] *= d; PP.vy[i] = PP.vy[i] * d + (ty === 1 ? 4 : 1.5) * dt; }
    PP.x[i] += PP.vx[i] * dt; PP.y[i] += PP.vy[i] * dt; PP.z[i] += PP.vz[i] * dt;
    if (ty === 1) s *= u; else if (ty === 2) s *= (1.7 - u) * Math.min(1, u * 3); else if (ty === 3) s *= Math.min(1, u * 2);
    if (PP.y[i] < .04 && (ty === 0 || ty === 3)) { if (ty === 0 && Math.random() < .4) addDecal(PP.x[i], PP.z[i], rnd(.12, .5), pick(BLOOD), rnd(.6, 1.6)); PP.life[i] = 0; }
    if (PP.life[i] <= 0) s = 0;
    const o = i * 16; a[o] = a[o + 5] = a[o + 10] = s; a[o + 12] = PP.x[i]; a[o + 13] = PP.y[i]; a[o + 14] = PP.z[i];
  }
  pm.instanceMatrix.needsUpdate = true;
}
const DN = 320; let di = 0, dm;
function initDecals() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'); g.fillStyle = '#fff';
  g.beginPath(); g.arc(64, 64, 34, 0, 7); g.fill(); for (let i = 0; i < 16; i++) { const a = rnd(0, 6.3), r = rnd(22, 50); g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rnd(4, 15), 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(cv); const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
  dm = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: .05, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), DN);
  dm.frustumCulled = false; dm.renderOrder = 2; const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DN; i++) { dm.setMatrixAt(i, m); dm.setColorAt(i, _c.set(0xffffff)); } scene.add(dm);
}
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = V3(), _ds = V3();
function addDecal(x, z, size, color, stretch = 1) {
  if (Math.abs(x) > 85 || Math.abs(z) > 85) return;
  const i = di; di = (di + 1) % DN; _dq.setFromAxisAngle(_Y, rnd(0, 6.3)); _dp.set(x, .045 + i * .00008, z); _ds.set(size * stretch, 1, size / stretch);
  dm.setMatrixAt(i, _dm.compose(_dp, _dq, _ds)); dm.setColorAt(i, _c.set(color)); dm.instanceMatrix.needsUpdate = true; dm.instanceColor.needsUpdate = true;
}
function clearFx() { PP.life.fill(0); const a = pm.instanceMatrix.array; for (let i = 0; i < PN; i++) a[i * 16] = a[i * 16 + 5] = a[i * 16 + 10] = 0; pm.instanceMatrix.needsUpdate = true; const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DN; i++) dm.setMatrixAt(i, m); dm.instanceMatrix.needsUpdate = true; }

// ---------- characters ----------
let MODELS = {}; const REST = {};
const MASS = { pelvis: 12, chest: 14, head: 5, armL: 3, foreL: 2.5, armR: 3, foreR: 2.5, thighL: 6, shinL: 4.5, thighR: 6, shinR: 4.5 };
const SEGNAME = { chest: 'their top half', head: 'their head', armL: 'an arm', foreL: 'a forearm', armR: 'an arm', foreR: 'a forearm', thighL: 'a leg', shinL: 'a shin', thighR: 'a leg', shinR: 'a shin' };
function computeRest(inst) {
  const B = inst.bones, P = {}; for (const n in B) P[n] = B[n].getWorldPosition(V3());
  const H = P.HeadTop_End.y, rl = H * .05, ra = H * .04, hipY = (P.LeftUpLeg.y + P.RightUpLeg.y) / 2, z0 = P.Hips.z, seg = {};
  const mid = (a, b) => a.clone().add(b).multiplyScalar(.5);
  seg.pelvis = { C: V3(0, (hipY + P.Spine1.y) / 2, z0), half: [Math.abs(P.LeftUpLeg.x - P.RightUpLeg.x) / 2 + rl, Math.max(.05, (P.Spine1.y - hipY) / 2 + .03), H * .065] };
  seg.chest = { C: V3(0, (P.Spine1.y + P.Neck.y) / 2, z0), half: [Math.abs(P.LeftArm.x - P.RightArm.x) / 2 * .9, Math.max(.05, (P.Neck.y - P.Spine1.y) / 2), H * .07] };
  seg.head = { C: V3(0, (P.Head.y + P.HeadTop_End.y) / 2, P.Head.z), r: Math.max((P.HeadTop_End.y - P.Head.y) * .5, H * .08), half: [0, 0, 0] };
  for (const [n, s] of [['Left', 'L'], ['Right', 'R']]) {
    const a = P[n + 'Arm'], e = P[n + 'ForeArm'], h = e.clone().add(P[n + 'Hand'].clone().sub(e).multiplyScalar(1.3));
    seg['arm' + s] = { C: mid(a, e), half: [Math.max(.04, Math.abs(e.x - a.x) / 2), ra, ra] };
    seg['fore' + s] = { C: mid(e, h), half: [Math.max(.04, Math.abs(h.x - e.x) / 2), ra * .9, ra * .9] };
    const u = P[n + 'UpLeg'], k = P[n + 'Leg'], f = V3(k.x, .03, k.z);
    seg['thigh' + s] = { C: mid(u, k), half: [rl, Math.max(.04, Math.abs(u.y - k.y) / 2), rl] };
    seg['shin' + s] = { C: mid(k, f), half: [rl * .9, Math.max(.04, (k.y - .03) / 2), rl * .9] };
  }
  for (const s of SEGS) { const b = B[SEG_BONE[s]]; seg[s].J = P[SEG_BONE[s]].clone(); seg[s].Q0 = b.getWorldQuaternion(new THREE.Quaternion()); seg[s].QPinv = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert(); seg[s].off = seg[s].C.clone().sub(seg[s].J); }
  return { P, H, seg, sideL: Math.sign(P.LeftForeArm.x - P.LeftArm.x) || 1, sideR: Math.sign(P.RightForeArm.x - P.RightArm.x) || -1 };
}
function makeChar(kind, x, z, o = {}) {
  const inst = instance(MODELS[kind]), holder = new THREE.Group(); holder.add(inst.root); town.add(holder);
  inst.mesh.castShadow = true; if (o.tint) inst.mesh.material.color.set(o.tint);
  holder.updateMatrixWorld(true); const R = REST[kind] || (REST[kind] = computeRest(inst));
  const c = { kind, name: o.name || CHARS[kind][0], inst, holder, bones: inst.bones, R, rootY: inst.root.position.y, yaw: o.yaw ?? rnd(0, 6.3), hp: 100, alive: true, rag: false, parts: {}, cons: {}, bleeders: [], restL: [], anim: { ph: rnd(0, 6), t: rnd(0, 9) }, isPlayer: !!o.player, ground: false, gBody: null, vyPrev: 0, jumps: 0, ragT: 0, downT: 3, carT: 0, hazT: 0, atk: 0, panic: 0, speed: 0, smearT: 0, launch: null, gone: false, ai: { tx: x, tz: z, wait: rnd(0, 2), spd: rnd(1.5, 2.6), stuck: 0, lx: x, lz: z } };
  holder.traverse(b => { if (b.isBone) c.restL.push([b, b.position.clone(), b.quaternion.clone()]); });
  const b = new CANNON.Body({ mass: 60, material: matChar, collisionFilterGroup: G_CHAR, collisionFilterMask: G_WORLD | G_CHAR, linearDamping: 0, angularDamping: 1, allowSleep: false, fixedRotation: true });
  b.addShape(new CANNON.Sphere(.32), CV(0, -.43, 0)); b.addShape(new CANNON.Sphere(.32), CV(0, .3, 0)); b.updateMassProperties();
  b.position.set(x, (o.y || 0) + .76, z); b.char = c; b.addEventListener('collide', onCharCollide); world.addBody(b); c.body = b;
  holder.position.set(x, o.y || 0, z); holder.rotation.y = c.yaw;
  return c;
}
function removeChar(c) {
  if (c.gone) return; c.gone = true; if (grab && grab.c === c) releaseGrab();
  for (const s in c.cons) world.removeConstraint(c.cons[s]); for (const s in c.parts) world.removeBody(c.parts[s]); if (!c.rag) world.removeBody(c.body);
  town.remove(c.holder); c.inst.dispose(); const i = npcs.indexOf(c); if (i >= 0) npcs.splice(i, 1);
}
const isDet = (c, s) => { while (s) { if (c.inst.cut.has(s)) return true; s = SEG_PARENT[s]; } return false; };
const charPos = c => c.rag ? c.parts.pelvis.position : c.body.position;
const allChars = () => player ? [player, ...npcs] : npcs.slice();

// local delta rotations (rest-aligned axes) -> bone local quaternion
const _e = new THREE.Euler(), _d = new THREE.Quaternion();
function setSeg(c, s, x, y, z) { if (c.parts[s]) return; const R = c.R.seg[s]; _d.setFromEuler(_e.set(x, y, z)); c.bones[SEG_BONE[s]].quaternion.copy(R.QPinv).multiply(_d).multiply(R.Q0); }
function pose(c, dt) {
  const a = c.anim, sp = c.speed, mv = clamp(sp / 4, 0, 1); a.t += dt; if (mv > .05) a.ph += dt * (5 + sp * 1.25);
  const s = Math.sin(a.ph), co = Math.cos(a.ph), A = mv * (.5 + Math.min(sp, 12) * .028), t = a.t, L = c.R.sideL, Rr = c.R.sideR, idle = 1 - mv;
  let pel = [0, 0, 0], ch = [.04 + mv * .2 + Math.sin(t * 2) * .025, s * .14 * mv, 0], hd = [-mv * .12 + Math.sin(t * 1.3) * .05 * idle, -s * .12 * mv + Math.sin(t * .7) * .25 * idle, 0];
  let thL = -s * A * 1.1, thR = s * A * 1.1, shL = A * (.25 + 1.0 * Math.max(0, co)), shR = A * (.25 + 1.0 * Math.max(0, -co));
  const low = 1.3; let aL = [s * A * 1.0 + Math.sin(t * 1.7) * .06 * idle, 0, -low * L], aR = [-s * A * 1.0 - Math.sin(t * 1.7) * .06 * idle, 0, -low * Rr], fL = .25 + mv * 1.0, fR = .25 + mv * 1.0, bob = Math.abs(s) * .07 * mv + Math.sin(t * 2) * .012 * idle;
  if (!c.ground && !c.jet) { const fl = Math.sin(t * 22) * .35; thL = -.9; shL = 1.3; thR = .25; shR = .7; aL = [fl, 0, .55 * L]; aR = [-fl, 0, .55 * Rr]; fL = fR = .3; ch[0] = -.1; bob = 0; }
  if (c.jet) { thL = .25 + Math.sin(t * 9) * .15; thR = .25 - Math.sin(t * 9) * .15; shL = shR = .35; aL = [.5, 0, -1.0 * L]; aR = [.5, 0, -1.0 * Rr]; fL = fR = .1; ch[0] = .3; hd[0] = -.3; }
  if (c.panic > 0) { const w = Math.sin(t * 16) * .3; aL = [w, 0, 1.15 * L]; aR = [-w, 0, 1.15 * Rr]; fL = fR = .2; hd[1] = Math.sin(t * 9) * .5; }
  if (c.atk > 0) {
    const w = Math.sin((1 - c.atk / .4) * Math.PI);
    if (c.atkType === 'butt') { ch[0] = 1.25 * w; hd[0] = .5 * w; aL[0] = 1.3 * w; aR[0] = 1.3 * w; thL = .3 * w; thR = -.5 * w; }
    else { thR = -1.9 * w; shR = .15; ch[0] = -.4 * w; thL = .2 * w; aL[0] = -.8 * w; aR[0] = .8 * w; }
  }
  if (c.tongue) { hd[0] = -.25; }
  setSeg(c, 'pelvis', pel[0], pel[1], pel[2]); setSeg(c, 'chest', ch[0], ch[1], ch[2]); setSeg(c, 'head', hd[0], hd[1], hd[2]);
  setSeg(c, 'armL', aL[0], aL[1], aL[2]); setSeg(c, 'armR', aR[0], aR[1], aR[2]); setSeg(c, 'foreL', 0, -fL * L, 0); setSeg(c, 'foreR', 0, -fR * Rr, 0);
  setSeg(c, 'thighL', thL, 0, 0); setSeg(c, 'thighR', thR, 0, 0); setSeg(c, 'shinL', shL, 0, 0); setSeg(c, 'shinR', shR, 0, 0);
  c.inst.root.position.y = c.rootY + bob;
}
const _bq = new THREE.Quaternion(), _bv = V3(), _bs = V3(), _wq = new THREE.Quaternion(), _wp = V3();
function setBoneWorld(bone, q, p) {
  const par = bone.parent; par.updateWorldMatrix(true, false); par.matrixWorld.decompose(_bv, _bq, _bs);
  bone.quaternion.copy(_bq.invert().multiply(q)); if (p) bone.position.copy(par.worldToLocal(p));
}
function driveParts(c) {
  for (const s of SEGS) {
    const b = c.parts[s]; if (!b) continue; const R = c.R.seg[s];
    _wq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w); let p = null;
    if (s === 'pelvis' || c.inst.cut.has(s)) { p = _wp.copy(R.off).negate().applyQuaternion(_wq); p.x += b.position.x; p.y += b.position.y; p.z += b.position.z; }
    _wq.multiply(R.Q0); setBoneWorld(c.bones[SEG_BONE[s]], _wq, p);
  }
}
const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rv = V3(), _rv2 = V3();
function ragdoll(c, vel) {
  if (c.gone) return;
  if (c.rag) { if (vel) for (const s in c.parts) { const b = c.parts[s]; b.wakeUp(); b.velocity.x += vel.x; b.velocity.y += vel.y; b.velocity.z += vel.z; } return; }
  c.holder.updateMatrixWorld(true); const bv = c.body.velocity;
  for (const s of SEGS) {
    if (c.parts[s]) continue; const R = c.R.seg[s], bone = c.bones[SEG_BONE[s]];
    bone.getWorldQuaternion(_rq); bone.getWorldPosition(_rv); _rq.multiply(_rq2.copy(R.Q0).invert()).normalize(); _rv2.copy(R.off).applyQuaternion(_rq).add(_rv);
    const b = new CANNON.Body({ mass: MASS[s], material: matDef, collisionFilterGroup: G_RAG, collisionFilterMask: G_WORLD, linearDamping: .05, angularDamping: .45, sleepSpeedLimit: .5, sleepTimeLimit: 1 });
    b.addShape(s === 'head' ? new CANNON.Sphere(R.r) : new CANNON.Box(CV(R.half[0], R.half[1], R.half[2])));
    b.position.set(_rv2.x, Math.max(_rv2.y, .06), _rv2.z); b.quaternion.set(_rq.x, _rq.y, _rq.z, _rq.w);
    b.velocity.set(bv.x + (vel ? vel.x : 0) + rnd(-.5, .5), bv.y + (vel ? vel.y : 0), bv.z + (vel ? vel.z : 0) + rnd(-.5, .5)); b.angularVelocity.set(rnd(-3, 3), rnd(-3, 3), rnd(-3, 3));
    b.ragOf = c; b.seg = s; b.addEventListener('collide', onRagCollide); world.addBody(b); c.parts[s] = b;
  }
  for (const s of SEGS) {
    const p = SEG_PARENT[s]; if (!p || c.cons[s] || c.inst.cut.has(s) || !c.parts[s] || !c.parts[p]) continue;
    const J = c.R.seg[s].J, pa = J.clone().sub(c.R.seg[p].C), pb = J.clone().sub(c.R.seg[s].C), A = CV(pa.x, pa.y, pa.z), B = CV(pb.x, pb.y, pb.z); let k;
    if (s === 'chest' || s === 'head') k = new CANNON.ConeTwistConstraint(c.parts[p], c.parts[s], { pivotA: A, pivotB: B, axisA: CV(0, 1, 0), axisB: CV(0, 1, 0), angle: s === 'head' ? .7 : .5, twistAngle: .6, maxForce: 1e5 });
    else if (s === 'thighL' || s === 'thighR') k = new CANNON.ConeTwistConstraint(c.parts[p], c.parts[s], { pivotA: A, pivotB: B, axisA: CV(0, -1, 0), axisB: CV(0, -1, 0), angle: .9, twistAngle: .6, maxForce: 1e5 });
    else k = new CANNON.PointToPointConstraint(c.parts[p], A, c.parts[s], B, 1e5);
    world.addConstraint(k); c.cons[s] = k;
  }
  world.removeBody(c.body); c.rag = true; c.ragT = 0; c.atk = 0; c.downT = rnd(3, 5.5); c.inst.root.position.y = c.rootY;
  if (c.isPlayer && grab) releaseGrab();
}
function standUp(c) {
  if (!c.rag || c.gone) return; const pv = c.parts.pelvis.position, px = pv.x, py = pv.y, pz = pv.z;
  for (const s of SEGS) { if (!c.parts[s] || isDet(c, s)) continue; if (c.cons[s]) { world.removeConstraint(c.cons[s]); delete c.cons[s]; } world.removeBody(c.parts[s]); delete c.parts[s]; }
  const keep = new Set(Object.keys(c.parts).map(s => c.bones[SEG_BONE[s]]));
  for (const [b, p, q] of c.restL) { if (keep.has(b)) continue; b.position.copy(p); b.quaternion.copy(q); }
  c.body.position.set(px, Math.max(py + .5, .8), pz); c.body.velocity.set(0, 4, 0); world.addBody(c.body);
  c.rag = false; c.ground = false; c.jumps = 1; c.peakY = py; c.ai.wait = 1; c.ai.tx = px; c.ai.tz = pz;
  if (c.launch) settleLaunch(c);
}
function settleLaunch(c) {
  const p = charPos(c), d = Math.hypot(p.x - c.launch.x, p.z - c.launch.z); c.launch = null;
  if (d > 6) { addScore(`${c.name} launched ${d | 0} m`, (d | 0) * 10, d >= 30); if (d >= 30) objective('launch'); }
}
function addCap(bone, pos, dir, r) {
  const g = new THREE.Group(); bone.add(g); g.position.copy(pos); bone.updateWorldMatrix(true, false); g.scale.setScalar(1 / (bone.getWorldScale(V3()).x || 1));
  g.quaternion.setFromUnitVectors(_Y, dir);
  const red = new THREE.Mesh(sphGeo, M.cap); red.scale.set(r, r * .4, r); const nub = new THREE.Mesh(cylGeo, M.bone); nub.scale.set(r * .36, r * 1.3, r * .36); nub.position.y = r * .5; g.add(red, nub); return g;
}
function sever(c, seg, vel) {
  if (!c || c.gone || !SEG_PARENT[seg] || c.inst.cut.has(seg)) return false;
  if (!c.rag) ragdoll(c);
  const bone = c.bones[SEG_BONE[seg]], rest = c.restL.find(r => r[0] === bone), R = c.R.seg[seg]; if (!rest) return;
  c.inst.sever(seg); if (c.cons[seg]) { world.removeConstraint(c.cons[seg]); delete c.cons[seg]; }
  const r = seg === 'head' ? R.r * .5 : seg === 'chest' ? R.half[0] * .8 : Math.min(R.half[0], R.half[1]) * 1.25;
  const c1 = addCap(bone, V3(), V3(0, -1, 0), r), c2 = addCap(bone.parent, rest[1], V3(0, 1, 0).applyQuaternion(rest[2]).normalize(), r);
  c.bleeders.push({ o: c1, t: 6 }, { o: c2, t: 9 });
  const b = c.parts[seg]; b.wakeUp(); b.velocity.x += (vel ? vel.x : rnd(-3, 3)); b.velocity.y += (vel ? vel.y : rnd(3, 7)); b.velocity.z += (vel ? vel.z : rnd(-3, 3)); b.angularVelocity.set(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8));
  blood(b.position.x, b.position.y, b.position.z, 0, 1, 0, 34, 6); sfx('splat');
  S.limbs++; if (S.limbs >= 6) objective('limbs');
  addScore(`${c.isPlayer ? 'You' : c.name} lost ${c.isPlayer ? SEGNAME[seg].replace('their', 'your') : SEGNAME[seg]}`, seg === 'head' ? 400 : seg === 'chest' ? 500 : 150);
  if (seg === 'head') die(c, 'lost their head'); else if (seg === 'chest') die(c, 'got torn in half'); else if (/thigh|shin/.test(seg)) c.crippled = true; else c.bleed = 8;
  return true;
}
function maybeSever(c, chance, vel) {
  if (Math.random() > chance) return; const opts = ['armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR', 'head', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR'].filter(s => !isDet(c, s));
  if (c.isPlayer) { const o2 = opts.filter(s => /arm|fore/.test(s)); if (o2.length) sever(c, pick(o2), vel); return; }
  if (opts.length) sever(c, pick(opts), vel);
}
function hurt(c, dmg, quiet) {
  const p = charPos(c); if (!quiet) { blood(p.x, p.y + .4, p.z, 0, .6, 0, Math.min(36, 4 + dmg * .5 | 0)); if (dmg > 12) sfx('splat', .6); }
  if (c.isPlayer || !c.alive) return; c.hp -= dmg; if (c.hp <= 0) die(c, 'got splattered');
}
function die(c, how) {
  if (!c.alive || c.isPlayer) return; c.alive = false; c.hp = 0; c.corpseT = 24; S.kills++; addScore(`${c.name} ${how}`, 250);
  const p = charPos(c), x = p.x, z = p.z; for (let i = 0; i < 4; i++) after(.5 + i * .5, () => { if (!c.gone) { const q = charPos(c); addDecal(q.x + rnd(-.4, .4), q.z + rnd(-.4, .4), rnd(.5, 1.1), pick(BLOOD)); } });
}
function knock(c, vel, dmg, byPlayer) {
  if (c.gone) return; ragdoll(c, vel); c.ragT = 0; const p = charPos(c);
  if (byPlayer && !c.isPlayer && !c.launch) c.launch = { x: p.x, z: p.z };
  if (dmg) hurt(c, dmg);
}
function onCharCollide(e) {
  const c = e.target.char, o = e.body; if (!c || c.rag) return;
  if (o.car) { later.push(() => carHit(c, o.car)); return; }
  if (o.hazard) { later.push(() => hazardHit(c, o)); return; }
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (o.thing && !o.thing.frozen && o.type === CANNON.Body.DYNAMIC) {
    if (grab && grab.body === o && c.isPlayer) return;
    if (c.isPlayer ? (v > 9 && o.mass > 25) : (v > 5 && o.mass > 4)) { const vel = V3(o.velocity.x * .8, o.velocity.y * .5 + 3, o.velocity.z * .8), dmg = Math.min(70, v * Math.sqrt(o.mass) * .9); later.push(() => { knock(c, vel, dmg, true); if (!c.isPlayer) addScore(`${c.name} got clobbered`, 80); }); }
  } else if (o.char && o.char.isPlayer && !c.isPlayer && player.speed > 9) { const pv = player.body.velocity, vel = V3(pv.x * 1.3, 5, pv.z * 1.3); later.push(() => { knock(c, vel, 12, true); addScore(`${c.name} shoulder-barged`, 60); sfx('hit'); }); }
}
function onRagCollide(e) {
  const b = e.target, c = b.ragOf, o = e.body; if (!c || c.gone) return;
  if (o.car && !o.car.wrecked) { later.push(() => { if (c.gone || c.carT > 0) return; c.carT = .6; const v = o.velocity; ragdoll(c, V3(v.x * .8, 5, v.z * .8)); hurt(c, 25); maybeSever(c, .2); }); return; }
  if (o.hazard) { later.push(() => hazardHit(c, o)); return; }
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v < 9) return;
  later.push(() => { if (c.gone) return; const p = b.position; blood(p.x, p.y, p.z, 0, .5, 0, Math.min(20, v), 4); if (T - c.smearT > .1) { c.smearT = T; if (p.y < .8) addDecal(p.x, p.z, rnd(.3, .7), pick(BLOOD), rnd(.7, 1.5)); } hurt(c, (v - 7) * 2.2, true); if (v > 22) maybeSever(c, .25); });
}

// ---------- explosions ----------
let shake = 0;
function explode(x, y, z, pow = 1) {
  const R = 6.5 * pow;
  for (const t of things.slice()) { if (t.dead) continue; const bp = t.body.position, dx = bp.x - x, dy = bp.y - y, dz = bp.z - z, d = Math.hypot(dx, dy, dz); if (d > R) continue; const k = 1 - d / R, n = d || 1, v = k * 20 * pow; hitThing(t, CV(dx / n * v, dy / n * v + k * 9, dz / n * v), k * 140 * pow); }
  for (const c of allChars()) {
    if (c.gone) continue; const cp = charPos(c), dx = cp.x - x, dy = cp.y + .3 - y, dz = cp.z - z, d = Math.hypot(dx, dy, dz);
    if (d > R) { if (!c.isPlayer && !c.rag && d < 32) { c.panic = rnd(3, 5); c.ai.tx = clamp(cp.x + dx / d * 25, -66, 66); c.ai.tz = clamp(cp.z + dz / d * 25, -66, 66); c.ai.wait = 0; } continue; }
    const k = 1 - d / R, n = d || 1, vel = V3(dx / n, dy / n + .5, dz / n).multiplyScalar(k * 22 * pow);
    knock(c, vel, k * 120 * pow, true);
    if (k > .3) { const m = k > .65 ? 1 + (Math.random() * 3 | 0) : 1; for (let i = 0; i < m; i++) maybeSever(c, c.isPlayer ? .3 : .85, vel.clone().multiplyScalar(.6).add(V3(rnd(-4, 4), rnd(2, 8), rnd(-4, 4)))); }
  }
  for (const car of cars) { const p = car.body.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz, p.y - y); if (d < R * .85) { const k = 1 - d / R; wreckCar(car, CV(dx / (d || 1) * k * 16, 6 + k * 9, dz / (d || 1) * k * 16), 'blown up'); } }
  for (let i = 0; i < 46; i++) { const a = rnd(0, 6.3), e = rnd(0, 1.5), s = rnd(3, 13) * pow; spawnP(x, y + .3, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, pick([0xffd23f, 0xff8a1c, 0xff4a1c, 0xfff2a0]), rnd(.3, .8) * pow, rnd(.35, .8), 1); }
  for (let i = 0; i < 18; i++) spawnP(x + rnd(-1, 1), y + rnd(.3, 1.5), z + rnd(-1, 1), rnd(-3, 3), rnd(2, 6), rnd(-3, 3), pick([0x3a3a3a, 0x555555, 0x2a2a2a]), rnd(.6, 1.2) * pow, rnd(1.2, 2.4), 2);
  for (let i = 0; i < 26; i++) { const a = rnd(0, 6.3); spawnP(x, y + .2, z, Math.cos(a) * rnd(6, 20), rnd(4, 16), Math.sin(a) * rnd(6, 20), pick([0x333333, 0x555555, 0x8a6a40]), rnd(.05, .12), rnd(.8, 1.6), 3); }
  if (y < 3) addDecal(x, z, 2.6 * pow, 0x141414);
  const dp = player ? Math.hypot(charPos(player).x - x, charPos(player).z - z) : 99; shake = Math.max(shake, clamp(1.4 * pow - dp * .03, .15, 1.6));
  boomLight.position.set(x, y + 1.5, z); boomLight.intensity = 400 * pow; sfx('boom', clamp(1.2 - dp * .015, .2, 1));
  const fl = $('#flash'); if (dp < 14) { fl.style.transition = 'none'; fl.style.opacity = .35; setTimeout(() => { fl.style.transition = 'opacity .4s'; fl.style.opacity = 0; }, 40); }
}

// ---------- cars ----------
const RA = 34, RB = 26, RR = 8, LX = 2 * (RA - RR), LZ = 2 * (RB - RR), ARC = Math.PI * RR / 2, PER = 2 * LX + 2 * LZ + 4 * ARC;
function pathAt(s) {
  s = ((s % PER) + PER) % PER; let a;
  if (s < LX) return { x: -(RA - RR) + s, z: -RB, dx: 1, dz: 0 }; s -= LX;
  if (s < ARC) { a = s / RR; return { x: RA - RR + RR * Math.sin(a), z: -(RB - RR) - RR * Math.cos(a), dx: Math.cos(a), dz: Math.sin(a) }; } s -= ARC;
  if (s < LZ) return { x: RA, z: -(RB - RR) + s, dx: 0, dz: 1 }; s -= LZ;
  if (s < ARC) { a = s / RR; return { x: RA - RR + RR * Math.cos(a), z: RB - RR + RR * Math.sin(a), dx: -Math.sin(a), dz: Math.cos(a) }; } s -= ARC;
  if (s < LX) return { x: RA - RR - s, z: RB, dx: -1, dz: 0 }; s -= LX;
  if (s < ARC) { a = s / RR; return { x: -(RA - RR) - RR * Math.sin(a), z: RB - RR + RR * Math.cos(a), dx: -Math.cos(a), dz: -Math.sin(a) }; } s -= ARC;
  if (s < LZ) return { x: -RA, z: RB - RR - s, dx: 0, dz: -1 }; s -= LZ;
  a = s / RR; return { x: -(RA - RR) - RR * Math.cos(a), z: -(RB - RR) - RR * Math.sin(a), dx: Math.sin(a), dz: -Math.cos(a) };
}
function addCar(s, color) {
  const g = new THREE.Group(), cm = lam({ color });
  const body = new THREE.Mesh(boxGeo(2, .7, 4.2), cm); body.position.y = -.1; const cab = new THREE.Mesh(boxGeo(1.7, .6, 2.1), M.glass); cab.position.set(0, .5, -.2); const roof = new THREE.Mesh(boxGeo(1.8, .1, 2.2), cm); roof.position.set(0, .84, -.2); g.add(body, cab, roof);
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) { const w = new THREE.Mesh(cylGeo, M.tyre); w.scale.set(.42, .3, .42); w.rotation.z = Math.PI / 2; w.position.set(x, -.33, z); g.add(w); }
  for (const x of [-.6, .6]) { const l = new THREE.Mesh(boxGeo(.4, .2, .1), M.pad); l.position.set(x, 0, 2.1); g.add(l); }
  shadow(g); town.add(g);
  const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL }); b.addShape(new CANNON.Box(CV(1, .6, 2.1))); world.addBody(b);
  const car = { s, speed: 12, body: b, mesh: g, wrecked: false, wreckT: 0 }; b.car = car; cars.push(car); placeCar(car); return car;
}
function placeCar(car) { const p = pathAt(car.s), b = car.body; b.position.set(p.x, .75, p.z); b.quaternion.setFromEuler(0, Math.atan2(p.dx, p.dz), 0); b.velocity.set(p.dx * car.speed, 0, p.dz * car.speed); b.angularVelocity.set(0, 0, 0); }
function wreckCar(car, dv, how) {
  const b = car.body;
  if (!car.wrecked) { car.wrecked = true; car.wreckT = 12; b.type = CANNON.Body.DYNAMIC; b.mass = 400; b.updateMassProperties(); b.wakeUp(); addScore(`Car ${how || 'punted'}`, 300); }
  b.wakeUp(); b.velocity.x += dv.x; b.velocity.y += dv.y; b.velocity.z += dv.z; b.angularVelocity.set(rnd(-4, 4), rnd(-3, 3), rnd(-4, 4));
}
function carHit(c, car) {
  if (c.gone || c.carT > 0 || car.wrecked) return; c.carT = 1; const v = car.body.velocity;
  knock(c, V3(v.x * 1.15 + rnd(-2, 2), rnd(6, 9), v.z * 1.15 + rnd(-2, 2)), 55, false); maybeSever(c, c.isPlayer ? .1 : .35); sfx('hit', 1); shake = Math.max(shake, c.isPlayer ? .6 : .1);
  if (c.isPlayer) { addScore('You got run over', 100); objective('roadkill'); } else addScore(`${c.name} got run over`, 200);
}
function hazardHit(c, o) {
  if (c.gone || c.hazT > 0) return; c.hazT = 1; const p = charPos(c); let vel;
  if (o.hazard === 'mill') { const rx = p.x - o.position.x, ry = p.y - o.position.y, w = o.angularVelocity.z; vel = V3(-w * ry * 1.3, w * rx * 1.3 + 5, rnd(2, 6)); }
  else vel = V3(o.velocity.x * 1.1, Math.abs(o.velocity.y) + 6, o.velocity.z * 1.1 + rnd(-3, 3));
  knock(c, vel, o.hazard === 'mill' ? 35 : 55, false); maybeSever(c, c.isPlayer ? .1 : .25); sfx('hit');
  addScore(`${c.isPlayer ? 'You' : c.name} ${o.hazard === 'mill' ? 'got windmilled' : 'met the wrecking ball'}`, c.isPlayer ? 100 : 250);
}

// ---------- town ----------
function mkGroup(name, pts) { const g = { name, pts, members: [], total: 0, loose: 0, done: false }; groups.push(g); return g; }
function chunk(g, x, y, z, w, h, d, mat, tough, mass, kind) { return addThing({ kind: kind || 'chunk', frozen: true, group: g, tough, mass, pos: [x, y, z], mesh: new THREE.Mesh(boxGeo(w, h, d), mat), shape: new CANNON.Box(CV(w / 2, h / 2, d / 2)) }); }
function house(x, z, mat, roofMat) {
  const g = mkGroup('House', 800), W = 6, D = 5, th = .5, rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = r + .5;
    for (let i = 0; i < 3; i++) { const bx = x - W / 2 + 1 + i * 2; chunk(g, bx, y, z - D / 2 + th / 2, 2, 1, th, mat, 35, 45); if (!(i === 1 && r < 2)) chunk(g, bx, y, z + D / 2 - th / 2, 2, 1, th, mat, 35, 45); }
    for (let i = 0; i < 2; i++) { const bz = z - 1 + i * 2; chunk(g, x - W / 2 + th / 2, y, bz, th, 1, 2, mat, 35, 45); chunk(g, x + W / 2 - th / 2, y, bz, th, 1, 2, mat, 35, 45); }
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(W * .8, 2.4, 4), roofMat); cone.rotation.y = Math.PI / 4; cone.scale.z = 1; cone.position.y = 1.1; const slab = new THREE.Mesh(boxGeo(W + .6, .3, D + .6), roofMat); const rg = new THREE.Group(); rg.add(slab, cone);
  addThing({ kind: 'roof', frozen: true, group: g, tough: 30, mass: 160, pos: [x, rows + .15, z], mesh: rg, shape: new CANNON.Box(CV(W / 2 + .3, .15, D / 2 + .3)) });
  barrel(x + W / 2 + 1, z + 1); crate(x - W / 2 - 1, .5, z - 1); crate(x - W / 2 - 1, .5, z + .1);
}
function stoneWall(x, z, len, alongZ, rows = 3) {
  const g = mkGroup('Stone wall', 250), n = Math.round(len / 1.5);
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 1.5 + (r % 2 ? .37 : 0); alongZ ? chunk(g, x, .375 + r * .75, z + o, .6, .75, 1.5, M.stone, 60, 60) : chunk(g, x + o, .375 + r * .75, z, 1.5, .75, .6, M.stone, 60, 60); }
}
function fence(x, z, alongZ) {
  const pieces = []; for (let i = 0; i < 6; i++) pieces.push({ s: [.42, 1.25, .08], p: [-1.25 + i * .5, 0, 0], mat: i % 2 ? M.wood : M.wood2, m: 3 }); pieces.push({ s: [3, .12, .06], p: [0, .25, .07], mat: M.wood2, m: 3 }, { s: [3, .12, .06], p: [0, -.3, .07], mat: M.wood2, m: 3 });
  addThing({ kind: 'fence', name: 'Fence', pts: 120, tough: 20, frozen: true, pieces, pos: [x, .625, z], q: alongZ ? new THREE.Quaternion().setFromAxisAngle(_Y, Math.PI / 2) : null, shape: new CANNON.Box(CV(1.5, .625, .1)) });
}
const cratePieces = [{ s: [.95, .1, .95], p: [0, .42, 0] }, { s: [.95, .1, .95], p: [0, -.42, 0] }, { s: [.1, .8, .95], p: [.42, 0, 0] }, { s: [.1, .8, .95], p: [-.42, 0, 0] }, { s: [.8, .8, .1], p: [0, 0, .42] }, { s: [.8, .8, .1], p: [0, 0, -.42] }];
function crate(x, y, z) { for (const p of cratePieces) { p.mat = M.wood; p.m = 3; } return addThing({ kind: 'crate', name: 'Crate', verb: 'smashed', pts: 40, tough: 50, mass: 22, pieces: cratePieces, mesh: new THREE.Mesh(boxGeo(1, 1, 1), M.wood), pos: [x, y, z], shape: new CANNON.Box(CV(.5, .5, .5)), asleep: true }); }
function barrel(x, z, y = .56) {
  const g = new THREE.Group(), b = new THREE.Mesh(cylGeo, M.barrel); b.scale.set(.42, 1.1, .42); g.add(b); for (const yy of [-.3, .3]) { const r = new THREE.Mesh(cylGeo, M.band); r.scale.set(.44, .08, .44); r.position.y = yy; g.add(r); }
  return addThing({ kind: 'barrel', name: 'Barrel', hp: 40, mass: 25, mesh: g, pos: [x, y, z], shape: new CANNON.Cylinder(.42, .42, 1.1, 10), asleep: true });
}
function tree(x, z, s = 1) {
  addThing({ kind: 'tree', name: 'Tree', verb: 'felled', pts: 150, tough: 70, frozen: true, pos: [x, 1.5 * s, z], shape: new CANNON.Box(CV(.3 * s, 1.5 * s, .3 * s)), pieces: [{ s: [.5 * s, 3 * s, .5 * s], p: [0, 0, 0], mat: M.wood, m: 30 }, { s: [2.2 * s, 2.6 * s, 2.2 * s], p: [0, 2.6 * s, 0], mat: Math.random() < .5 ? M.leaf : M.leaf2, m: 20, geo: new THREE.ConeGeometry(1.7 * s, 3.4 * s, 7) }, { s: [1.5 * s, 2 * s, 1.5 * s], p: [0, 4.1 * s, 0], mat: M.leaf2, m: 10, geo: new THREE.ConeGeometry(1.2 * s, 2.4 * s, 7) }] });
}
function bench(x, z, ry) { addThing({ kind: 'bench', name: 'Bench', pts: 60, tough: 20, frozen: true, pos: [x, .45, z], q: new THREE.Quaternion().setFromAxisAngle(_Y, ry), shape: new CANNON.Box(CV(1, .45, .3)), pieces: [{ s: [2, .1, .55], p: [0, 0, 0], mat: M.wood2, m: 5 }, { s: [2, .5, .08], p: [0, .3, -.25], mat: M.wood2, m: 4 }, { s: [.1, .45, .5], p: [-.85, -.22, 0], mat: M.steel, m: 4 }, { s: [.1, .45, .5], p: [.85, -.22, 0], mat: M.steel, m: 4 }] }); }
function stall(x, z) { const pc = []; for (const [px, pz] of [[-1.4, -.9], [1.4, -.9], [-1.4, .9], [1.4, .9]]) pc.push({ s: [.14, 2.6, .14], p: [px, 0, pz], mat: M.wood2, m: 4 }); pc.push({ s: [3.3, .12, 2.3], p: [0, 1.3, 0], mat: M.rug, m: 8 }, { s: [3, .9, .8], p: [0, -.85, .6], mat: M.wood, m: 15 }); addThing({ kind: 'stall', name: 'Market stall', pts: 200, tough: 25, frozen: true, pos: [x, 1.3, z], shape: new CANNON.Box(CV(1.6, 1.3, 1.1)), pieces: pc }); }
function tramp(x, z, big) {
  const g = new THREE.Group(), rim = new THREE.Mesh(cylGeo, big ? M.red : M.padRim); rim.scale.set(1.7, .4, 1.7); const top = new THREE.Mesh(cylGeo, big ? M.pad2 : M.pad); top.scale.set(1.45, .42, 1.45); g.add(rim, top);
  const b = addStatic(g, new CANNON.Box(CV(1.3, .2, 1.3)), [x, .2, z], null, { bounce: big ? 37 : 19 });
  b.addEventListener('collide', e => { const o = e.body; if (o.char || o.type !== CANNON.Body.DYNAMIC) return; later.push(() => { o.wakeUp(); o.velocity.y = Math.max(o.velocity.y, big ? 24 : 13); }); });
}
function ramp(x, z, yaw, len, wid, h) { const a = Math.asin(h / len), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, yaw, 0, 'YXZ')); addStatic(new THREE.Mesh(boxGeo(wid, .3, len), lam({ map: texRep('wood2', 2, 4) })), new CANNON.Box(CV(wid / 2, .15, len / 2)), [x, h / 2, z], q); }
function buildScenery() {
  // permanent visuals: ground, road, plaza, clouds, hills
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#6cc24a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { g.fillStyle = pick(['#62b842', '#78cc55', '#5fb040', '#84d660']); g.fillRect(rnd(256), rnd(256), rnd(3, 9), rnd(3, 9)); }
  const gt = new THREE.CanvasTexture(cv); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(30, 30); gt.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lam({ map: gt })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const rr = (a, b, r) => { const s = new THREE.Path(); s.moveTo(-a + r, -b); s.lineTo(a - r, -b); s.absarc(a - r, -b + r, r, -Math.PI / 2, 0, false); s.lineTo(a, b - r); s.absarc(a - r, b - r, r, 0, Math.PI / 2, false); s.lineTo(-a + r, b); s.absarc(-a + r, b - r, r, Math.PI / 2, Math.PI, false); s.lineTo(-a, -b + r); s.absarc(-a + r, -b + r, r, Math.PI, Math.PI * 1.5, false); return s; };
  const sh = new THREE.Shape(rr(RA + 3.6, RB + 3.6, RR + 3.6).getPoints(10)); sh.holes.push(new THREE.Path(rr(RA - 3.6, RB - 3.6, RR - 3.6).getPoints(10)));
  const road = new THREE.Mesh(new THREE.ShapeGeometry(sh), lam({ color: 0x4a4e58 })); road.rotation.x = -Math.PI / 2; road.position.y = .02; road.receiveShadow = true; scene.add(road);
  const nd = Math.floor(PER / 5), dash = new THREE.InstancedMesh(boxGeo(.25, .02, 1.8), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }), nd), dmx = new THREE.Matrix4(), dq = new THREE.Quaternion();
  for (let i = 0; i < nd; i++) { const p = pathAt(i * 5); dq.setFromAxisAngle(_Y, Math.atan2(p.dx, p.dz)); dash.setMatrixAt(i, dmx.compose(V3(p.x, .035, p.z), dq, V3(1, 1, 1))); } scene.add(dash);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 40), lam({ map: texRep('stone', 5, 5) })); plaza.rotation.x = -Math.PI / 2; plaza.position.y = .025; plaza.receiveShadow = true; scene.add(plaza);
  const lane = new THREE.Mesh(boxGeo(22, .05, 3.2), lam({ map: texRep('wood2', 8, 1) })); lane.position.set(-17, .025, 15); lane.receiveShadow = true; scene.add(lane);
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }); for (let i = 0; i < 16; i++) { const c = new THREE.Mesh(sphGeo, cm); c.scale.set(rnd(8, 18), rnd(2.5, 4), rnd(6, 12)); c.position.set(rnd(-160, 160), rnd(55, 85), rnd(-160, 160)); scene.add(c); }
  for (let i = 0; i < 22; i++) { const a = i / 22 * 6.283, h = new THREE.Mesh(sphGeo, lam({ color: pick([0x58b848, 0x4aa840, 0x6ac858]) })); h.scale.set(rnd(18, 30), rnd(8, 20), rnd(18, 30)); h.position.set(Math.cos(a) * 115, -2, Math.sin(a) * 115); scene.add(h); }
}
function buildTown() {
  // houses outside the ring road
  const hm = [M.brick, M.brickA, M.brickB, M.brickC, M.brickD];
  [[-28, -40], [-8, -40], [14, -40], [-22, 40], [6, 40]].forEach(([x, z], i) => house(x, z, hm[i], M.roofs[i]));
  // inside the ring
  for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - r; i++) crate(9 + i * 1.02 + r * .51, .5 + r * 1.0, 3);
  for (let y = 0; y < 2; y++) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) crate(-13 + i * 1.02, .5 + y, -4 + j * 1.02);
  for (const [x, z] of [[13, -3], [13.9, -3.3], [13.4, -2.2], [14.5, -2.5], [12.6, -3.9]]) barrel(x, z);
  for (let i = 0; i < 6; i++) barrel(15 + i * 1.5, 13);
  for (const [x, z] of [[-24, 2], [-23, 2.6], [-24.4, 3.2]]) barrel(x, z); crate(-22.6, .5, 3.6);
  for (let i = 0; i < 9; i++) fence(-12 + i * 3, -20.8); for (let i = 0; i < 8; i++) fence(4 + i * 3, 20.8); for (let i = 0; i < 4; i++) fence(-29, -6 + i * 3, true);
  stoneWall(14.5, 8, 9, false); stoneWall(-12, -15, 6, true, 2); stoneWall(35, -40, 9, false);
  stall(-3.5, -11); stall(3.5, -11); bench(-7, 0, Math.PI / 2); bench(7, 0, -Math.PI / 2); bench(0, 9.5, Math.PI);
  tramp(-8, 7); tramp(-3, -17.5); tramp(25, 5); tramp(45.5, 4, true);
  for (const [x, z, s] of [[27, 18, 1], [-27, -19, 1.1], [-27, 20, .9], [22, -4, 1], [44, 24, 1.2], [-46, 24, 1], [-44, -30, 1.3], [30, 44, 1], [-40, 44, 1.1], [46, -40, 1], [0, 36, 1.2], [-55, -8, 1], [58, 30, 1.1], [20, -34, .9]]) tree(x, z, s);
  // bowling
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), lam({ map: texRep('rug', 2, 1) }));
  addThing({ kind: 'ball', name: 'Ball', mass: 150, mesh: ball, pos: [-25, 1.06, 15], shape: new CANNON.Sphere(1.05), asleep: true });
  for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) { const g = new THREE.Group(), a = new THREE.Mesh(cylGeo, M.white); a.scale.set(.17, .9, .17); const b = new THREE.Mesh(cylGeo, M.red); b.scale.set(.18, .12, .18); b.position.y = .2; const h = new THREE.Mesh(sphGeo, M.white); h.scale.setScalar(.15); h.position.y = .48; g.add(a, b, h); addThing({ kind: 'pin', name: 'Pin', mass: 3, mesh: g, pos: [-11 + i * .8, .46, 15 + (j - i / 2) * .8], shape: new CANNON.Box(CV(.15, .45, .15)), asleep: true }); }
  // tower + flag
  addStatic(new THREE.Mesh(boxGeo(6, 22, 6), lam({ map: texRep('stone', 3, 11) })), new CANNON.Box(CV(3, 11, 3)), [52, 11, -4]);
  addStatic(new THREE.Mesh(boxGeo(9, .6, 9), lam({ map: texRep('wood2', 3, 3) })), new CANNON.Box(CV(4.5, .3, 4.5)), [52, 22.3, -4]);
  const pole = new THREE.Mesh(cylGeo, M.steel); pole.scale.set(.08, 5, .08); pole.position.set(55.5, 25.1, -7.5); const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), new THREE.MeshLambertMaterial({ map: TEX.flag, side: THREE.DoubleSide })); flag.position.set(54.1, 26.7, -7.5); town.add(shadow(pole), flag);
  barrel(50, -2, 23.16); barrel(50.9, -2.2, 23.16); crate(54, 23.1, -2);
  // ramps
  ramp(-48, 0, Math.PI / 2, 12, 6, 4); ramp(0, -32.5, 0, 9, 4, 2.6);
  // windmill
  const mx = -20, mz = -11; const mt = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.9, 8, 12), lam({ map: texRep('stone', 4, 3) })); addStatic(mt, new CANNON.Box(CV(1.4, 4, 1.4)), [mx, 4, mz]);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2, 12), M.roofs[0]); cap.position.set(mx, 9, mz); town.add(shadow(cap));
  const bl = new THREE.Group(); bl.add(new THREE.Mesh(boxGeo(.9, 11.2, .12), M.wood2), new THREE.Mesh(boxGeo(11.2, .9, .12), M.wood2)); const hub = new THREE.Mesh(sphGeo, M.red); hub.scale.setScalar(.45); bl.add(hub); shadow(bl); town.add(bl);
  const mb = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL }); mb.addShape(new CANNON.Box(CV(.45, 5.6, .08))); mb.addShape(new CANNON.Box(CV(5.6, .45, .08)));
  mb.position.set(mx, 6.6, mz + 1.9); mb.angularVelocity.set(0, 0, 1.5); mb.hazard = 'mill'; world.addBody(mb); hazards.push({ body: mb, mesh: bl });
  // wrecking ball
  const ax = 17, ay = 13, az = -13, L = 11.4, th = 1.0;
  addStatic(new THREE.Mesh(boxGeo(1, 14.4, 1), M.steel), new CANNON.Box(CV(.5, 7.2, .5)), [ax, 7.2, az - 5]);
  const arm = new THREE.Mesh(boxGeo(.7, .7, 6), M.steel); arm.position.set(ax, 13.9, az - 2.3); town.add(shadow(arm));
  const anchor = new CANNON.Body({ mass: 0, collisionFilterGroup: 0, collisionFilterMask: 0 }); anchor.position.set(ax, ay, az); world.addBody(anchor);
  const wb = new CANNON.Body({ mass: 500, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL, linearDamping: 0, angularDamping: 0, allowSleep: false }); wb.addShape(new CANNON.Sphere(1.3));
  wb.position.set(ax + L * Math.sin(th), ay - L * Math.cos(th), az); wb.quaternion.setFromEuler(0, 0, th); wb.hazard = 'ball'; world.addBody(wb);
  world.addConstraint(new CANNON.PointToPointConstraint(anchor, CV(0, 0, 0), wb, CV(0, L, 0), 1e7));
  const wm = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12), lam({ map: TEX.metal, color: 0x555a66 })); const chain = new THREE.Mesh(cylGeo, M.black); town.add(shadow(wm), chain);
  hazards.push({ body: wb, mesh: wm, chain, anchor: V3(ax, ay, az), ball: true });
  // cars
  [0xe2334b, 0x2f6fff, 0xffd23f, 0x2aa84a].forEach((c, i) => addCar(i * PER / 4 + 6, c));
}
const SPAWNS = [[-6, 4], [6, -5], [12, 14], [-16, 8], [-20, -2], [22, -6], [2, 16], [-4, -14], [26, 14], [-26, 12], [42, 10], [-44, 14], [10, -34], [-14, 34], [40, -30], [-42, -22], [20, 36], [-2, -4]];
function spawnNPCs() {
  const kinds = ['louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot'].filter(k => MODELS[k]);
  kinds.forEach((k, i) => npcs.push(makeChar(k, SPAWNS[i][0], SPAWNS[i][1])));
  if (MODELS.martleboro) [[0x8dff8d, 'Green Martlebrough'], [0xff8de8, 'Pink Martlebrough'], [0x8dc4ff, 'Blue Martlebrough']].forEach(([t, n], i) => npcs.push(makeChar('martleboro', SPAWNS[10 + i][0], SPAWNS[10 + i][1], { tint: t, name: n })));
  if (MODELS.apricot) { const a = makeChar('apricot', 52, -5, { y: 22.6, name: 'Tower Apricot' }); a.ai.wait = 1e9; npcs.push(a); }
}
function buildAll() {
  newWorldVars(); newWorld(); buildTown();
  player = makeChar(MODELS.martleboro ? 'martleboro' : Object.keys(MODELS)[0], 0, 5, { player: true, yaw: Math.PI, name: 'Martlebrough' }); player.peakY = 0;
  spawnNPCs(); G3.player = player; G3.npcs = npcs; G3.world = world; G3.things = things; G3.cars = cars;
}
function newWorldVars() { town = new THREE.Group(); scene.add(town); things = []; debris = []; npcs = []; cars = []; groups = []; timers = []; later = []; hazards = []; grab = null; T = 0; Object.assign(S, { score: 0, combo: 1, comboT: -9, obj: {}, pins: 0, limbs: 0, kills: 0, chain: { n: 0, t: -9 } }); hudDirty = true; }
function resetWorld() {
  for (const c of allChars()) c.inst.dispose(); scene.remove(town); tongue.visible = false; clearFx(); $('#feed').innerHTML = '';
  buildAll(); drawObj(); camT.set(0, 1.3, 5); feed('Town reset. Go again.', 0, true);
}

// ---------- input ----------
const keys = {}; const cam = { yaw: 0, pitch: .32, dist: 6.5 }, camT = V3(0, 1.3, 5);
addEventListener('keydown', e => {
  if (e.repeat) return; keys[e.code] = true; if (!started) { if (e.code === 'Enter') start(); return; }
  if (e.code === 'Space') { e.preventDefault(); player.jumpQ = true; }
  else if (e.code === 'KeyE') attack(); else if (e.code === 'KeyF') tryGrab(); else if (e.code === 'KeyQ') grenade();
  else if (e.code === 'KeyX') toggleRag(); else if (e.code === 'KeyG') slowmo(); else if (e.code === 'KeyR') resetWorld();
  else if (e.code === 'KeyH' || e.code === 'F1') { e.preventDefault(); showHelp(true); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('mousedown', e => { if (!started) return; if (!locked()) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (err) { } if (e.button !== 0) return; } if (e.button === 0) attack(); });
addEventListener('mousemove', e => { if (!started) return; if (locked() || e.buttons) { cam.yaw -= e.movementX * .0026; cam.pitch = clamp(cam.pitch + e.movementY * .0026, -.35, 1.45); } });
addEventListener('wheel', e => { cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.12 : .89), 2.5, 22); }, { passive: true });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function showHelp(v) { $('#help').style.display = v ? 'flex' : 'none'; if (v && document.exitPointerLock) document.exitPointerLock(); }
function start() { if (!player) return; started = true; showHelp(false); if (!AC) initAudio(); if (AC && AC.state === 'suspended') AC.resume(); }
function slowmo() { timeScale = timeScale === 1 ? .25 : 1; $('#slow').style.display = timeScale === 1 ? 'none' : 'block'; $('#bslow').classList.toggle('on', timeScale !== 1); }
$('#go').onclick = start; $('#bhelp').onclick = () => showHelp(true); $('#bslow').onclick = e => { slowmo(); e.target.blur(); }; $('#breset').onclick = e => { resetWorld(); e.target.blur(); };

// ---------- player actions ----------
function toggleRag() { const p = player; if (p.rag) { if (p.ragT > .4) standUp(p); } else { ragdoll(p, V3(Math.sin(p.yaw) * 3, 3, Math.cos(p.yaw) * 3)); p.manual = true; } }
function attack() {
  const p = player; if (grab) { throwGrab(); return; } if (p.rag || p.atk > 0) return;
  p.atk = .4; p.atkHit = false; p.atkN = (p.atkN || 0) + 1; p.atkType = p.atkN % 2 ? 'butt' : 'kick'; p.yaw = cam.yaw + Math.PI; sfx('whoosh', .5);
}
function doHit() {
  const p = player, o = p.body.position, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw); let n = 0;
  const inCone = (q, ext = 0) => { const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz); return Math.abs(q.y - o.y) < 2.2 + ext && (d < 1.1 + ext || (d < 2.7 + ext && (dx * fx + dz * fz) / d > .35)); };
  for (const c of npcs.slice()) {
    if (c.gone || !inCone(charPos(c))) continue; n++; const was = c.rag;
    knock(c, V3(fx * 18 + rnd(-2, 2), rnd(7, 10), fz * 18 + rnd(-2, 2)), 30, true); maybeSever(c, c.hp < 50 ? .3 : .14);
    if (!was) addScore(`${c.name} ${p.atkType === 'butt' ? 'headbutted' : 'kicked'}`, 50);
  }
  for (const t of things.slice()) { if (t.dead) continue; const big = t.kind === 'ball' ? 1 : (t.frozen && !t.pieces) ? .6 : .3; if (!inCone(t.body.position, big)) continue; n++; if (t.kind === 'ball') { const b = t.body; b.wakeUp(); b.velocity.set(fx * 15, 1, fz * 15); b.angularVelocity.set(fz * 14, 0, -fx * 14); continue; } hitThing(t, CV(fx * 15, 6, fz * 15), 56); }
  for (const car of cars) if (inCone(car.body.position, 1.2)) { n++; wreckCar(car, CV(fx * 14, 8, fz * 14), 'punted'); }
  if (n) { sfx('hit'); shake = Math.max(shake, .25); }
}
function grenade() {
  const p = player, o = charPos(p); if (things.filter(t => t.kind === 'grenade').length >= 8) return;
  const cp = Math.cos(cam.pitch), fx = -Math.sin(cam.yaw) * cp, fy = Math.sin(-cam.pitch) + .45, fz = -Math.cos(cam.yaw) * cp, v = p.rag ? p.parts.pelvis.velocity : p.body.velocity;
  const g = new THREE.Mesh(sphGeo, M.gren); g.scale.setScalar(.17); const pin = new THREE.Mesh(sphGeo, M.red); pin.scale.setScalar(.45); pin.position.y = .9; g.add(pin);
  addThing({ kind: 'grenade', mass: 1.2, mat: matBounce, mesh: g, pos: [o.x + fx * .7, o.y + .7, o.z + fz * .7], shape: new CANNON.Sphere(.17), vel: { x: v.x + fx * 17, y: v.y * .3 + fy * 13, z: v.z + fz * 17 }, spin: 8, fuse: 2.5, pow: 1.15 }); sfx('whoosh', .7);
}
const tongue = new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1, 6), new THREE.MeshLambertMaterial({ color: 0xff6fa5 })); tongue.visible = false; scene.add(tongue);
function tryGrab() {
  if (grab) { releaseGrab(); return; } const p = player; if (p.rag) return;
  const o = p.body.position, fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw); let best = null, bd = 11;
  const test = (q, obj) => { const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz, q.y - o.y); if (d < bd && (d < 2.5 || (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1) > .3)) { bd = d; best = obj; } };
  for (const c of npcs) if (!c.gone) test(charPos(c), { c });
  for (const t of things) { if (t.dead || t.kind === 'grenade') continue; if (t.frozen ? (!t.pieces && t.tough <= 60) : true) test(t.body.position, { t }); }
  if (!best) { feed('Nothing to lick'); return; }
  if (best.c) { ragdoll(best.c); best.body = best.c.parts.chest && !isDet(best.c, 'chest') ? best.c.parts.chest : best.c.parts.pelvis; if (!best.c.launch) { const q = charPos(best.c); best.c.launch = { x: q.x, z: q.z }; } }
  else { if (best.t.frozen) unfreeze(best.t, CV(0, 2, 0)); best.body = best.t.body; }
  grab = best; p.tongue = true; sfx('splat', .5);
}
function releaseGrab() { grab = null; if (player) player.tongue = false; tongue.visible = false; }
function throwGrab() {
  const g = grab; if (!g) return; const cp = Math.cos(cam.pitch), vx = -Math.sin(cam.yaw) * cp * 28, vy = Math.sin(-cam.pitch) * 20 + 9, vz = -Math.cos(cam.yaw) * cp * 28;
  if (g.c) { for (const s in g.c.parts) { const b = g.c.parts[s]; b.wakeUp(); b.velocity.set(vx, vy, vz); } g.c.ragT = 0; addScore(`${g.c.name} yeeted`, 60); } else { g.body.wakeUp(); g.body.velocity.set(vx, vy, vz); }
  releaseGrab(); sfx('whoosh');
}
function grabTick() {
  const g = grab; if (!g) return; if ((g.t && g.t.dead) || (g.c && g.c.gone) || player.rag) { releaseGrab(); return; }
  const o = player.body.position, b = g.body, hx = o.x - Math.sin(cam.yaw) * 2.8, hy = o.y + 1.5, hz = o.z - Math.cos(cam.yaw) * 2.8;
  let vx = (hx - b.position.x) * 9, vy = (hy - b.position.y) * 9, vz = (hz - b.position.z) * 9; const m = Math.hypot(vx, vy, vz); if (m > 30) { vx *= 30 / m; vy *= 30 / m; vz *= 30 / m; }
  b.wakeUp(); b.velocity.x += (vx - b.velocity.x) * .35; b.velocity.y += (vy - b.velocity.y) * .35; b.velocity.z += (vz - b.velocity.z) * .35; if (g.c) g.c.ragT = 0;
}
function controlPlayer(h) {
  const p = player; p.jet = false;
  if (p.rag) {
    p.ragT += h; const pv = p.parts.pelvis; if (keys.KeyB) { const ch = p.parts.chest || pv; ch.wakeUp(); ch.velocity.y = Math.min(ch.velocity.y + 70 * h, 14); jetFx(ch.position); }
    if (!p.manual && p.ragT > 2.6 && pv.velocity.length() < 1.5) standUp(p); else if (!p.manual && p.ragT > 7) standUp(p);
    p.jumpQ = false; return;
  }
  p.manual = false; const b = p.body, fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  const mf = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mr = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let dx = fx * mf + rx * mr, dz = fz * mf + rz * mr; const dl = Math.hypot(dx, dz); const sp = (keys.ShiftLeft || keys.ShiftRight) ? 11.5 : 6.5;
  if (dl > 0) { dx /= dl; dz /= dl; let da = Math.atan2(dx, dz) - p.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); if (p.atk <= 0) p.yaw += da * (1 - Math.exp(-14 * h)); }
  const a = (p.ground ? 70 : 22) * h, tx = dl ? dx * sp : 0, tz = dl ? dz * sp : 0;
  if (dl || p.ground) { b.velocity.x += clamp(tx - b.velocity.x, -a, a); b.velocity.z += clamp(tz - b.velocity.z, -a, a); }
  p.airT = p.ground ? 0 : (p.airT || 0) + h;
  if (p.jumpQ) { p.jumpQ = false; if (p.ground || p.airT < .12) { b.velocity.y = 9.5; p.jumps = 1; p.airT = 1; sfx('boing', .25); } else if (p.jumps < 2) { b.velocity.y = 9.5; p.jumps = 2; puff(b.position.x, b.position.y - .7, b.position.z, 8, 0xffffff, 2, .12); sfx('boing', .3); } }
  if (keys.KeyB) { p.jet = true; b.velocity.y = Math.min(b.velocity.y + 62 * h, 13); jetFx(b.position); }
  if (p.atk > 0) { p.atk -= h; if (!p.atkHit && p.atk < .32) { p.atkHit = true; doHit(); } }
}
let jetN = 0;
function jetFx(p) { if ((jetN++ & 1) === 0) { spawnP(p.x + rnd(-.15, .15), p.y - .2, p.z + rnd(-.15, .15), rnd(-1, 1), -7, rnd(-1, 1), pick([0xffd23f, 0xff8a1c, 0xff4a1c]), rnd(.15, .3), rnd(.25, .45), 1); if (jetN % 6 === 0) { spawnP(p.x, p.y - .6, p.z, rnd(-1, 1), -2, rnd(-1, 1), 0x888888, .3, 1, 2); sfx('jet', .12); } } }

// ---------- NPC brain ----------
function npcTick(c, h) {
  if (c.carT > 0) c.carT -= h; if (c.hazT > 0) c.hazT -= h; if (c.panic > 0) c.panic -= h;
  if (c.rag) {
    c.ragT += h; const pv = c.parts.pelvis, spd = pv.velocity.length();
    if (c.alive && (c.crippled || c.bleed > 0)) { if (c.bleed > 0) c.bleed -= h; c.hp -= (c.crippled ? 9 : 4) * h; if (c.hp <= 0) die(c, 'bled out'); }
    if (c.hp < 70 && spd > 2.5 && pv.position.y < .7 && T - c.smearT > .14) { c.smearT = T; addDecal(pv.position.x, pv.position.z, rnd(.25, .55), pick(BLOOD), rnd(.8, 1.8)); }
    if (c.launch && c.ragT > 1 && spd < .6 && !(grab && grab.c === c)) settleLaunch(c);
    if (!c.alive) { c.corpseT -= h; if (c.corpseT <= 0 || pv.position.y < -20) respawn(c); return; }
    if (c.ragT > c.downT && spd < 1.2 && !c.crippled && !(grab && grab.c === c)) standUp(c);
    return;
  }
  if (c.bleed > 0) { c.bleed -= h; c.hp -= 3 * h; if (c.hp <= 0) { ragdoll(c); die(c, 'bled out'); return; } }
  const b = c.body, ai = c.ai; if (b.position.y < -20) { respawn(c); return; }
  let vx = 0, vz = 0;
  if (ai.wait > 0) ai.wait -= h;
  else {
    const dx = ai.tx - b.position.x, dz = ai.tz - b.position.z, d = Math.hypot(dx, dz), sp = c.panic > 0 ? 5.5 : ai.spd;
    if (d < .6) { ai.wait = c.panic > 0 ? 0 : rnd(.5, 3); newTarget(c); } else { vx = dx / d * sp; vz = dz / d * sp; let da = Math.atan2(dx, dz) - c.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); c.yaw += da * (1 - Math.exp(-8 * h)); }
    ai.stuck += h; if (ai.stuck > 1.2) { if (Math.hypot(b.position.x - ai.lx, b.position.z - ai.lz) < .5) newTarget(c); ai.stuck = 0; ai.lx = b.position.x; ai.lz = b.position.z; }
  }
  const a = 30 * h; b.velocity.x += clamp(vx - b.velocity.x, -a, a); b.velocity.z += clamp(vz - b.velocity.z, -a, a);
}
function newTarget(c) { const p = c.body.position; for (let i = 0; i < 6; i++) { const a = rnd(0, 6.3), r = rnd(4, 16), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (Math.abs(x) > 64 || Math.abs(z) > 64) continue; if (x < -5 && x > -29 && Math.abs(z - 15) < 3) continue; c.ai.tx = x; c.ai.tz = z; return; } c.ai.tx = rnd(-20, 20); c.ai.tz = rnd(-15, 15); }
function respawn(c) {
  const kind = c.kind, tint = c.inst.mesh.material.color.getHex(), name = c.name; removeChar(c);
  let sp = pick(SPAWNS); const pp = charPos(player); for (let i = 0; i < 8 && Math.hypot(sp[0] - pp.x, sp[1] - pp.z) < 18; i++) sp = pick(SPAWNS);
  npcs.push(makeChar(kind, sp[0] + rnd(-1, 1), sp[1] + rnd(-1, 1), { tint: tint !== 0xffffff ? tint : null, name: name === 'Tower Apricot' ? CHARS.apricot[0] : name })); G3.npcs = npcs;
}

// ---------- simulation ----------
let pinT = 0;
function tick(h) {
  T += h;
  controlPlayer(h); for (const c of npcs.slice()) npcTick(c, h);
  if (player.carT > 0) player.carT -= h; if (player.hazT > 0) player.hazT -= h;
  for (const car of cars) { car.s += car.speed * h; if (!car.wrecked) placeCar(car); else { car.wreckT -= h; if (car.wreckT <= 0 || car.body.position.y < -10) { const p = car.body.position; puff(p.x, p.y, p.z, 14, 0xffffff, 3, .3); car.wrecked = false; car.body.type = CANNON.Body.KINEMATIC; car.body.mass = 0; car.body.updateMassProperties(); placeCar(car); } } }
  for (const hz of hazards) if (hz.ball) { const b = hz.body, v = b.velocity.length(); if (b.position.y < 3.2 && v > .3 && v < 14) b.velocity.scale(1.025, b.velocity); else if (v < .3 && b.position.y < 2) b.velocity.x += 2; }
  grabTick();
  for (const c of allChars()) if (!c.rag) c.vyPrev = c.body.velocity.y;
  world.step(h);
  for (let i = 0; i < later.length && i < 4000; i++) { try { later[i](); } catch (e) { console.error(e); } } later.length = 0;
  // ground contacts
  for (const c of allChars()) { c.ground = false; c.gBody = null; }
  for (const ct of world.contacts) { const bi = ct.bi, bj = ct.bj; if (bi.char && ct.ni.y < -.5) { bi.char.ground = true; bi.char.gBody = bj; } if (bj.char && ct.ni.y > .5) { bj.char.ground = true; bj.char.gBody = bi; } }
  for (const c of allChars()) {
    if (c.gone) continue;
    if (c.rag) { if (c.isPlayer) { const pv = c.parts.pelvis; c.peakY = Math.max(c.peakY || 0, pv.position.y); if (c.ragT > .4 && pv.velocity.length() < 3) { if (c.peakY - pv.position.y > 18) objective('tower'); c.peakY = pv.position.y; } } continue; }
    const b = c.body; c.speed = Math.hypot(b.velocity.x, b.velocity.z);
    if (c.ground) {
      if (c.gBody && c.gBody.bounce) { b.velocity.y = c.gBody.bounce; c.ground = false; c.jumps = 1; sfx('boing', c.isPlayer ? .8 : .2); if (c.isPlayer && T - (c.boingT || -9) > 1) { c.boingT = T; addScore('Boing', 20); } }
      else {
        if (c.vyPrev < -23) { const d = (-c.vyPrev - 18) * 6; if (c.isPlayer) { if ((c.peakY || 0) - b.position.y > 18) objective('tower'); addScore('Splat', 150); shake = Math.max(shake, .7); } knock(c, V3(rnd(-2, 2), 5, rnd(-2, 2)), d, false); if (!c.isPlayer) maybeSever(c, .3); sfx('hit'); const q = charPos(c); for (let i = 0; i < 3; i++) addDecal(q.x + rnd(-.6, .6), q.z + rnd(-.6, .6), rnd(.5, 1.2), pick(BLOOD)); continue; }
        c.jumps = 0; if (c.isPlayer) c.peakY = b.position.y;
      }
    } else if (c.isPlayer) c.peakY = Math.max(c.peakY || 0, b.position.y);
    if (b.position.y < -15) { b.position.set(0, 3, 5); b.velocity.set(0, 0, 0); }
  }
  // timers, fuses, debris
  for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= h; if (tm.t <= 0) { timers.splice(i, 1); try { tm.f(); } catch (e) { console.error(e); } } }
  for (const t of things.slice()) {
    if (t.dead) continue; const p = t.body.position;
    if (t.fuse > 0) { t.fuse -= h; if (t.kind === 'grenade' && Math.random() < .5) spawnP(p.x, p.y + .15, p.z, rnd(-.5, .5), 1.5, rnd(-.5, .5), 0xffd23f, .05, .25, 1); if (t.fuse <= 0) { const x = p.x, y = p.y, z = p.z, pow = t.kind === 'barrel' ? 1.25 : t.pow; if (t.kind === 'barrel') { const ch = S.chain; ch.n = (T - ch.t < 1.3) ? ch.n + 1 : 1; ch.t = T; addScore(ch.n > 1 ? `Chain reaction x${ch.n}` : 'Barrel exploded', ch.n > 1 ? ch.n * 100 : 80, ch.n >= 4); if (ch.n >= 4) objective('chain'); } removeThing(t); explode(x, y, z, pow); continue; } }
    if (p.y < -12 || Math.abs(p.x) > 90 || Math.abs(p.z) > 90) { removeThing(t); continue; }
    if (t.temp && T - t.born > 45 && t.body.sleepState === CANNON.Body.SLEEPING) removeThing(t);
  }
  while (debris.length > 150) { const t = debris.shift(); if (!t.dead) removeThing(t); }
  if (debris.length && debris[0].dead) debris = debris.filter(t => !t.dead);
  pinT -= h; if (pinT <= 0) { pinT = .3; for (const t of things) if (t.kind === 'pin' && !t.down) { const q = t.body.quaternion, uy = 1 - 2 * (q.x * q.x + q.z * q.z); if (uy < .6) { t.down = true; S.pins++; addScore('Pin down', 50); if (S.pins === 10) { addScore('STRIKE', 500, true); objective('strike'); } } } }
}
const _cq = new THREE.Quaternion(), _cv = V3();
function visuals(dt) {
  for (const t of things) { if (t.frozen || t.body.sleepState === CANNON.Body.SLEEPING) continue; t.mesh.position.copy(t.body.position); t.mesh.quaternion.copy(t.body.quaternion); }
  for (const car of cars) { car.mesh.position.copy(car.body.position); car.mesh.quaternion.copy(car.body.quaternion); }
  for (const hz of hazards) { hz.mesh.position.copy(hz.body.position); hz.mesh.quaternion.copy(hz.body.quaternion); if (hz.chain) { _cv.copy(hz.body.position).sub(hz.anchor); const l = _cv.length(); hz.chain.position.copy(hz.anchor).addScaledVector(_cv, .5); hz.chain.scale.set(.07, l, .07); hz.chain.quaternion.setFromUnitVectors(_Y, _cv.normalize()); } }
  for (const c of allChars()) {
    if (c.gone) continue;
    if (!c.rag) { const b = c.body.position; c.holder.position.set(b.x, b.y - .75, b.z); c.holder.rotation.y = c.yaw; pose(c, dt); }
    driveParts(c);
    for (let i = c.bleeders.length - 1; i >= 0; i--) { const bl = c.bleeders[i]; bl.t -= dt; if (bl.t <= 0) { c.bleeders.splice(i, 1); continue; } if (Math.random() < .5 * Math.min(1, bl.t / 3) + .1) { bl.o.getWorldPosition(_cv); bl.o.getWorldQuaternion(_cq); const d = V3(0, 1, 0).applyQuaternion(_cq); spawnP(_cv.x, _cv.y, _cv.z, d.x * 2.5 + rnd(-.6, .6), d.y * 2.5 + rnd(0, 1.5), d.z * 2.5 + rnd(-.6, .6), pick(BLOOD), rnd(.03, .07), rnd(.6, 1.1), 0); } }
  }
  if (grab) { const o = charPos(player), b = grab.body.position; _cv.set(b.x - o.x, b.y - (o.y + .55), b.z - o.z); const l = _cv.length() || .01; tongue.visible = true; tongue.position.set(o.x + _cv.x / 2, o.y + .55 + _cv.y / 2, o.z + _cv.z / 2); tongue.scale.set(1, l, 1); tongue.quaternion.setFromUnitVectors(_Y, _cv.multiplyScalar(1 / l)); }
  updateParticles(dt);
  if (boomLight.intensity > 0) boomLight.intensity = Math.max(0, boomLight.intensity - dt * 2400);
  // camera
  const pp = charPos(player), ty = pp.y + (player.rag ? .5 : .65); _cv.set(pp.x, ty, pp.z); camT.lerp(_cv, 1 - Math.exp(-14 * Math.max(dt, .004)));
  const cp = Math.cos(cam.pitch); camera.position.set(camT.x + Math.sin(cam.yaw) * cp * cam.dist, Math.max(.3, camT.y + Math.sin(cam.pitch) * cam.dist), camT.z + Math.cos(cam.yaw) * cp * cam.dist);
  if (shake > 0) { camera.position.x += rnd(-shake, shake) * .35; camera.position.y += rnd(-shake, shake) * .35; camera.position.z += rnd(-shake, shake) * .35; shake = Math.max(0, shake - dt * 2.2); }
  camera.lookAt(camT.x, camT.y + .45, camT.z);
  sun.position.set(camT.x + 30, 55, camT.z + 22); sun.target.position.set(camT.x, 0, camT.z);
  hud();
}
function frame(dtReal) {
  if (canvas.width !== Math.floor((innerWidth || 1280) * renderer.getPixelRatio()) || canvas.height !== Math.floor((innerHeight || 720) * renderer.getPixelRatio())) resize();
  if (started && player) { acc += Math.min(dtReal, .1); let n = 0; while (acc >= FIX && n < 3) { tick(FIX * timeScale); acc -= FIX; n++; } if (n === 3) acc = 0; }
  if (player) visuals(dtReal * timeScale);
  renderer.render(scene, camera);
}
let last = performance.now(), fN = 0, fT = 0;
function loop(now) {
  requestAnimationFrame(loop); const dt = Math.min(.1, (now - last) / 1000); last = now;
  if (G3.auto) { try { frame(dt); } catch (e) { console.error(e); G3.lastError = e; } }
  fN++; fT += dt; if (fT > .5) { $('#fps').textContent = `${Math.round(fN / fT)} fps | ${world ? world.bodies.length : 0} bodies`; fN = 0; fT = 0; }
}

// ---------- console handles ----------
const G3 = window.G3 = {
  auto: true, THREE, CANNON, scene, camera, renderer, cam, keys, S,
  get T() { return T; }, get grab() { return grab; }, get debris() { return debris; }, get hazards() { return hazards; },
  start, reset: resetWorld, slowmo, attack, grenade, tryGrab, throwGrab, toggleRag, explode, ragdoll, standUp, sever, knock, hurt, die, hitThing, shatter, unfreeze, wreckCar, addScore, objective, blood, addDecal, pathAt,
  teleport(x, y, z) { const p = player; if (p.rag) standUp(p); p.body.position.set(x, y + .76, z); p.body.velocity.set(0, 0, 0); camT.set(x, y + 1.3, z); },
  step(n = 1, dt = FIX) { for (let i = 0; i < n; i++) { if (started && player) tick(dt * timeScale); if (player) visuals(dt * timeScale); } renderer.render(scene, camera); return T; },
  frame(dt = FIX) { frame(dt); return T; },
  shot() { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', .7); },
};

(async function init() {
  try {
    await loadTex(); initDecals(); buildScenery();
    MODELS = await loadChars(k => { $('#loading').textContent = `loaded ${CHARS[k][0]}...`; });
    if (!Object.keys(MODELS).length) throw new Error('no character models loaded');
    buildAll(); drawObj(); $('#loading').textContent = ''; G3.ready = true;
  } catch (e) { console.error(e); $('#loading').textContent = 'Failed to load: ' + e.message; G3.lastError = e; }
  requestAnimationFrame(loop);
})();
