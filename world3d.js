// REALISTIC BEATUP 3D: third-person chaos sandbox over 1.5 km of hills. three r160 + cannon-es.
// Characters run on bm's mocap (anim3d.js), the ground is one shared heightfield (terrain3d.js).
import * as THREE from 'three';
import * as CANNON from './vendor/cannon-es.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { loadChars, loadFolk, instance, SEGS, SEG_BONE, SEG_PARENT, CHARS, FOLK } from './dollmesh.js';
import { loadBank, bakeRig, Animator, addHolderRot, aimBone, addWorldRot } from './anim3d.js';
import { clone as skClone } from './vendor/SkeletonUtils.js';
import * as TR from './terrain3d.js';

const $ = s => document.querySelector(s);
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const pick = a => a[Math.random() * a.length | 0];
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const CV = (x = 0, y = 0, z = 0) => new CANNON.Vec3(x, y, z);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gy = (x, z) => TR.heightAt(x, z);
const BOUND = TR.HALF - 14;

// ---------- renderer / scene ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fd6ff); scene.fog = new THREE.Fog(0xc4e6ff, 160, 820);
const camera = new THREE.PerspectiveCamera(60, 1, .15, 2400);
function resize() { const w = innerWidth || 1280, h = innerHeight || 720; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
scene.add(new THREE.HemisphereLight(0xe4f4ff, 0x5f8a45, 1.35));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 260 }); sun.shadow.bias = -.0005; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);
const boomLight = new THREE.PointLight(0xffa030, 0, 40, 1.6); scene.add(boomLight);
{ // sky dome
  const g = new THREE.SphereGeometry(2000, 32, 16), m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(.80,.91,1.), vec3(.25,.56,.95), smoothstep(0.,.55,h)); c = mix(c, vec3(.78,.86,.80), smoothstep(.02,-.2,h)); gl_FragColor = vec4(c,1.); }' });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky); window.__sky = sky;
}

// ---------- textures / materials ----------
const TEX = {}, BMT = {}, M = {};
const GEO = new Map();
const boxGeo = (w, h, d) => { const k = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)}`; let g = GEO.get(k); if (!g) GEO.set(k, g = new THREE.BoxGeometry(w, h, d)); return g; };
const sphGeo = new THREE.SphereGeometry(1, 14, 10), cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const lam = (o) => new THREE.MeshLambertMaterial(o);
function texRep(n, rx, ry) { const t = (TEX[n] || BMT[n]).clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; }
async function loadTex() {
  const TL = new THREE.TextureLoader();
  const ld = async (url, key, into) => { try { const t = await TL.loadAsync(url); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; into[key] = t; } catch (e) { console.warn('texture missing', url); into[key] = new THREE.Texture(); } };
  await Promise.all([
    ...['wood', 'wood2', 'brick', 'stone', 'flag', 'rug', 'metal'].map(n => ld(`assets/tex/${n}.jpg`, n, TEX)),
    ...['grass_1', 'grass_2', 'dirt_1', 'dirt_2', 'stone', 'rubble', 'bark', 'leaves', 'wood', 'roof_1', 'roof_2', 'roof_3', 'roof_4', 'cloth_red', 'cloth_oat', 'wall_07', 'wall_09', 'wall_11', 'wall_13', 'wall_15', 'wall_17'].map(n => ld(`assets/bm/tex/${n}_c.webp`, n, BMT)),
  ]);
  for (const n in TEX) M[n] = lam({ map: TEX[n] });
  // one look: bm's plaster/timber walls and tiled roofs everywhere
  M.walls = ['wall_07', 'wall_09', 'wall_11', 'wall_13', 'wall_15', 'wall_17'].map(n => lam({ map: BMT[n] }));
  [M.brick, M.brickA, M.brickB, M.brickC, M.brickD] = [0, 1, 2, 3, 4].map(i => M.walls[i]);
  M.canvasR = lam({ map: BMT.cloth_red, side: THREE.DoubleSide }); M.canvasO = lam({ map: BMT.cloth_oat, side: THREE.DoubleSide });
  M.barrel = lam({ map: texRep('wood2', 1, 2), color: 0x9a6a4e }); M.band = lam({ map: TEX.metal, color: 0x8a7440 });
  M.bedR = lam({ map: texRep('cloth_red', 3, 3), color: 0xb8a898 }); M.bedO = lam({ map: texRep('cloth_oat', 3, 3), color: 0xc8b89a });
  { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#9a7a3e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) { const x = Math.random() * 256, y = Math.random() * 256, a = (Math.random() - .5) * .9 + Math.PI / 2, l = 10 + Math.random() * 30; g.strokeStyle = `hsl(${38 + Math.random() * 10},${40 + Math.random() * 20}%,${38 + Math.random() * 34}%)`; g.lineWidth = .8 + Math.random() * 1.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); M.straw = lam({ map: t }); }
  M.leaf = lam({ color: 0x3fb950 }); M.leaf2 = lam({ color: 0x7ad151 }); M.white = lam({ color: 0xffffff }); M.red = lam({ color: 0xe2334b });
  M.black = lam({ color: 0x22252b }); M.glass = lam({ color: 0x9fd8ff }); M.tyre = lam({ color: 0x1c1c20 });
  M.pad = lam({ color: 0xffd23f }); M.padRim = lam({ color: 0x2f6fff }); M.pad2 = lam({ color: 0xff7a1a });
  M.gren = lam({ color: 0x2f5d2a }); M.steel = lam({ map: TEX.metal, color: 0x8892a0 });
  M.roofs = ['roof_1', 'roof_2', 'roof_3', 'roof_4', 'roof_1'].map(n => lam({ map: texRep(n, 2, 2) }));
  M.hay = M.straw; M.leafCard = lam({ map: BMT.leaves, alphaTest: .5, side: THREE.DoubleSide, emissive: 0x2a3a1a });
  M.cap = lam({ color: 0x7a0008 }); M.bone = lam({ color: 0xf6f1e4 }); M.tongue = lam({ color: 0xff6fa5 });
  M.bark = lam({ map: BMT.bark }); M.rock = lam({ map: BMT.stone, color: 0xcfc8bc }); M.boulder = lam({ map: BMT.rubble, color: 0xd8d0c4 });
  M.canopy = lam({ color: 0xffffff, flatShading: true });
  M.iron = lam({ map: TEX.metal, color: 0x3a3d44 }); M.cart = lam({ map: BMT.wood });
}

// ---------- physics ----------
const G_WORLD = 1, G_CHAR = 2, G_RAG = 4, ALL = 7;
const matDef = new CANNON.Material('def'), matChar = new CANNON.Material('char'), matBounce = new CANNON.Material('bounce');
let world, town, things, debris, npcs, cars, groups, timers, later, hazards, player, grab, cannons, T = 0;
const FIX = 1 / 60; let timeScale = 1, started = false, acc = 0, hitstop = 0;
const S = { score: 0, combo: 1, comboT: -9, obj: {}, pins: 0, limbs: 0, kills: 0, chain: { n: 0, t: -9 }, seen: {} };

function newWorld() {
  world = new CANNON.World({ gravity: CV(0, -22, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world); world.allowSleep = true; world.solver.iterations = 8;
  // the default n^2 array matrix is cleared every step: with ~1000 static bodies that alone cost 10+ ms
  world.collisionMatrix = new CANNON.ObjectCollisionMatrix(); world.collisionMatrixPrevious = new CANNON.ObjectCollisionMatrix();
  world.defaultContactMaterial.friction = .5; world.defaultContactMaterial.restitution = .1;
  world.addContactMaterial(new CANNON.ContactMaterial(matChar, matDef, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matChar, matChar, { friction: 0, restitution: 0 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matBounce, matDef, { friction: .4, restitution: .55 }));
  world.addBody(TR.makeBody(matDef, G_WORLD, ALL));
  const H = TR.HALF - 6;
  for (const [x, z, hx, hz] of [[H, 0, 2, H], [-H, 0, 2, H], [0, H, H, 2], [0, -H, H, 2]]) addStatic(null, new CANNON.Box(CV(hx, 200, hz)), [x, 150, z]);
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
  const t = { kind: o.kind, name: o.name, verb: o.verb, pts: o.pts || 0, tough: o.tough ?? 30, hp: o.hp ?? 0, mass: o.mass || 20, frozen: !!o.frozen, group: o.group || null, pieces: o.pieces || null, temp: !!o.temp, born: T, dead: false, fuse: o.fuse || 0, pow: o.pow || 1 };
  let mesh = o.mesh;
  if (!mesh) { mesh = new THREE.Group(); for (const pc of o.pieces) { const m = new THREE.Mesh(pc.geo || boxGeo(pc.s[0], pc.s[1], pc.s[2]), pc.mat); m.position.set(pc.p[0], pc.p[1], pc.p[2]); if (pc.ry) m.rotation.y = pc.ry; mesh.add(m); } }
  shadow(mesh); t.mesh = mesh; mesh.position.set(o.pos[0], o.pos[1], o.pos[2]); if (o.q) mesh.quaternion.copy(o.q); town.add(mesh);
  const b = new CANNON.Body({ mass: t.frozen ? 0 : t.mass, material: o.mat || matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL, linearDamping: o.damp ?? .03, angularDamping: o.adamp ?? .1, sleepSpeedLimit: .4, sleepTimeLimit: .6 });
  b.addShape(o.shape); b.position.set(o.pos[0], o.pos[1], o.pos[2]); if (o.q) b.quaternion.set(o.q.x, o.q.y, o.q.z, o.q.w);
  if (o.vel) b.velocity.set(o.vel.x, o.vel.y, o.vel.z); if (o.spin) b.angularVelocity.set(rnd(-o.spin, o.spin), rnd(-o.spin, o.spin), rnd(-o.spin, o.spin));
  if (o.angVel) b.angularVelocity.set(o.angVel.x, o.angVel.y, o.angVel.z);
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
  else addVel(t.body, dv, t.kind === 'boulder' ? .5 : 3);
}
const _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion(), _tv = V3(), _Y = V3(0, 1, 0);
function shatter(t, dv) {
  if (t.dead) return; t.mesh.updateMatrixWorld(true); t.mesh.getWorldQuaternion(_tq); const bv = t.body.velocity;
  for (const pc of t.pieces) {
    _tv.set(pc.p[0], pc.p[1], pc.p[2]); t.mesh.localToWorld(_tv); _tq2.copy(_tq); if (pc.ry) _tq2.multiply(new THREE.Quaternion().setFromAxisAngle(_Y, pc.ry));
    const k = rnd(.5, 1.1);
    addThing({ kind: 'debris', temp: true, mass: pc.m || 4, pos: [_tv.x, _tv.y, _tv.z], q: _tq2.clone(), mesh: new THREE.Mesh(pc.geo || boxGeo(pc.s[0], pc.s[1], pc.s[2]), pc.mat), shape: new CANNON.Box(CV(pc.s[0] / 2, pc.s[1] / 2, pc.s[2] / 2)), vel: { x: bv.x + dv.x * k + rnd(-1.5, 1.5), y: bv.y + dv.y * k + rnd(0, 2), z: bv.z + dv.z * k + rnd(-1.5, 1.5) }, spin: 5 });
  }
  const p = t.body.position; puff(p.x, p.y, p.z, 10, 0xc9a877, 3, .12);
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
const OBJ = [['cannon', 'Ride a cannon (walk into one)'], ['launch', 'Launch someone 30 m'], ['chain', 'Set off a 4-barrel chain reaction'], ['strike', 'Bowl over all 10 pins'], ['roadkill', 'Get run over by a car'], ['tower', 'Fall 18 m and go splat'], ['limbs', 'Remove 6 limbs'], ['house', 'Demolish a house'],
  ['boulder', 'Roll a boulder into someone'], ['summit', 'Stand on Yeet Summit'], ['village', 'Find Bellmourn village'], ['finisher', 'Land a 3-hit combo'], ['lumber', 'Fell 5 forest trees'], ['beast', 'Send a gravehart flying']];
function addScore(label, pts, big) {
  S.combo = (T - S.comboT < 3.5) ? Math.min(S.combo + 1, 10) : 1; S.comboT = T;
  const p = Math.round(pts * (1 + (S.combo - 1) * .15)); S.score += p; hudDirty = true; feed(label, p, big);
}
function feed(label, p, big) {
  // repeats of the line on top collapse into it (x2, x3 ...) and add up their points
  const f = $('#feed'), top = f.firstChild;
  if (top && top._label === label && !top._gone) { top._n++; top._pts += p || 0; top.firstChild.textContent = `${label} x${top._n}`; if (top._pts) top.querySelector('b').textContent = '+' + top._pts; clearTimeout(top._t); top._t = setTimeout(() => fadeFeed(top), 2500); return; }
  const d = document.createElement('div'); if (big) d.className = 'big'; d._label = label; d._n = 1; d._pts = p || 0;
  d.append(document.createTextNode(label)); const b = document.createElement('b'); if (p) b.textContent = '+' + p; d.append(b);
  f.prepend(d); while (f.children.length > 4) f.lastChild.remove();
  d._t = setTimeout(() => fadeFeed(d), big ? 3200 : 2500);
}
function fadeFeed(d) { d._gone = true; d.style.opacity = 0; setTimeout(() => d.remove(), 600);
}
function objective(id) { if (S.obj[id]) return; S.obj[id] = true; addScore('DONE: ' + OBJ.find(o => o[0] === id)[1], 1000, true); drawObj(); }
function drawObj() { const n = OBJ.filter(o => S.obj[o[0]]).length; $('#objs').innerHTML = `<div style="color:#1b2a4a99;font-size:11px">${n} / ${OBJ.length} done</div>` + OBJ.filter(o => !S.obj[o[0]]).slice(0, 5).map(([id, t]) => `<div>&#9744; ${t}</div>`).join(''); }
function hud() {
  if (hudDirty) { $('#pts').textContent = S.score.toLocaleString(); hudDirty = false; }
  const c = (T - S.comboT < 3.5 && S.combo > 1) ? `COMBO x${(1 + (S.combo - 1) * .15).toFixed(2)}` : ''; if ($('#combo').textContent !== c) $('#combo').textContent = c;
}

// ---------- sound ----------
let AC = null, noiseBuf = null, master = null; const SND = {};
function initAudio() {
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .9; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const files = { run: [1, 2, 3, 4, 5].map(i => `dirt_run_${i}`), walk: [1, 2, 3, 4, 5].map(i => `dirt_walk_${i}`), jump: ['dirt_jump'], land: ['dirt_land'], impact: [1, 2, 3].map(i => `sword_impact_hit_${i}`) };
    for (const k in files) { SND[k] = []; for (const f of files[k]) fetch(`assets/bm/audio/${f}.mp3`).then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b)).then(buf => SND[k].push(buf)).catch(() => { }); }
    for (const [f, v] of [['birds', .22], ['wind_calm', .16]]) { const a = new Audio(`assets/bm/audio/${f}.mp3`); a.loop = true; a.volume = v; a.play().catch(() => { }); }
  } catch (e) { AC = null; }
}
function sample(k, vol = 1, rate = 1) {
  if (!AC || AC.state !== 'running' || !SND[k] || !SND[k].length) return false;
  const s = AC.createBufferSource(), g = AC.createGain(); s.buffer = pick(SND[k]); s.playbackRate.value = rate * rnd(.92, 1.08); g.gain.value = vol; s.connect(g); g.connect(master); s.start(); return true;
}
function sfx(k, vol = 1) {
  if (!AC || AC.state !== 'running') return;
  try {
    const t = AC.currentTime, g = AC.createGain(); g.connect(master);
    const noise = (dur, f, type = 'lowpass') => { const s = AC.createBufferSource(); s.buffer = noiseBuf; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; s.connect(fl); fl.connect(g); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); s.start(t); s.stop(t + dur); };
    const tone = (f0, f1, dur, type = 'sine') => { const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); o.connect(g); g.gain.setValueAtTime(vol * .5, t); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.start(t); o.stop(t + dur); };
    if (k === 'boom') { noise(.9, 500); tone(90, 30, .5); } else if (k === 'hit') { tone(150, 40, .16, 'triangle'); noise(.08, 1800, 'bandpass'); } else if (k === 'thud') { tone(95, 35, .22, 'sine'); noise(.12, 600); } else if (k === 'splat') noise(.18, 900, 'bandpass');
    else if (k === 'crack') noise(.22, 2200, 'bandpass'); else if (k === 'boing') tone(180, 620, .25); else if (k === 'whoosh') noise(.15, 1500, 'highpass'); else if (k === 'jet') noise(.08, 700);
    else if (k === 'cannon') { noise(1.2, 380); tone(70, 25, .8); } else if (k === 'splash') noise(.4, 1200, 'bandpass');
  } catch (e) { }
}

// ---------- particles + decals ----------
const SOFT = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.45, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const PN = 1200, pm = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: SOFT, transparent: true, depthWrite: false, side: THREE.DoubleSide }), PN), pl = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: SOFT, transparent: true, depthWrite: false, opacity: .55, side: THREE.DoubleSide }), PN);
for (const m of [pm, pl]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
const PP = { x: new Float32Array(PN), y: new Float32Array(PN), z: new Float32Array(PN), vx: new Float32Array(PN), vy: new Float32Array(PN), vz: new Float32Array(PN), life: new Float32Array(PN), max: new Float32Array(PN), size: new Float32Array(PN), type: new Uint8Array(PN), g: new Float32Array(PN) };
let pi = 0; const _c = new THREE.Color();
for (const m of [pm, pl]) { const a = m.instanceMatrix.array; a.fill(0); for (let i = 0; i < PN; i++) { a[i * 16 + 15] = 1; m.setColorAt(i, _c.set(0xffffff)); } }
// type 0 blood, 1 fire, 2 smoke, 3 shrapnel/dust, 4 soft dust (drifts, no gravity)
function spawnP(x, y, z, vx, vy, vz, color, size, life, type) {
  const i = pi; pi = (pi + 1) % PN; PP.x[i] = x; PP.y[i] = y; PP.z[i] = z; PP.vx[i] = vx; PP.vy[i] = vy; PP.vz[i] = vz; PP.life[i] = PP.max[i] = life; PP.size[i] = size; PP.type[i] = type; PP.g[i] = gy(x, z);
  const glow = type === 1 || type === 0, m = glow ? pm : pl, o = glow ? pl : pm; m.setColorAt(i, _c.set(color)); m.instanceColor.needsUpdate = true; const za = o.instanceMatrix.array; for (let j = 0; j < 11; j++) za[i * 16 + j] = 0;
}
const BLOOD = [0x5a0808, 0x4c0606, 0x660a0a, 0x540707];
function blood(x, y, z, dx, dy, dz, n, spd = 5) { for (let i = 0; i < n; i++) { const k = rnd(.3, 1) * spd; spawnP(x + rnd(-.1, .1), y + rnd(-.1, .1), z + rnd(-.1, .1), dx * k + rnd(-2, 2), dy * k + rnd(0, 3.5), dz * k + rnd(-2, 2), pick(BLOOD), rnd(.02, .045), rnd(.4, .7), 0); } }
function puff(x, y, z, n, color, spd, size) { for (let i = 0; i < n; i++) spawnP(x, y, z, rnd(-spd, spd), rnd(0, spd), rnd(-spd, spd), color, size * rnd(.6, 1.3), rnd(.4, .9), 3); }
function dust(x, z, n, spd = 2, size = .22) { const y = gy(x, z) + .05; size *= .55; for (let i = 0; i < n; i++) { const a = rnd(0, 6.3), s = rnd(.4, 1) * spd; spawnP(x + Math.cos(a) * .2, y, z + Math.sin(a) * .2, Math.cos(a) * s, rnd(.2, .9), Math.sin(a) * s, pick([0xa8916c, 0x9c8462, 0xb8a582]), size * rnd(.6, 1.3), rnd(.35, .6), 4); } }
const _pR = V3(), _pU = V3(), _pF = V3();
function updateParticles(dt) {
  const A = pm.instanceMatrix.array, L = pl.instanceMatrix.array; camera.matrixWorld.extractBasis(_pR, _pU, _pF); _pF.negate();
  for (let i = 0; i < PN; i++) {
    if (PP.life[i] <= 0) continue; const ty = PP.type[i]; PP.life[i] -= dt; let s = PP.size[i]; const u = Math.max(0, PP.life[i] / PP.max[i]);
    if (ty === 0 || ty === 3) PP.vy[i] -= 20 * dt; else { const d = Math.exp(-(ty === 4 ? 3.5 : 2.5) * dt); PP.vx[i] *= d; PP.vz[i] *= d; PP.vy[i] = PP.vy[i] * d + (ty === 1 ? 4 : ty === 4 ? .2 : 1.5) * dt; }
    PP.x[i] += PP.vx[i] * dt; PP.y[i] += PP.vy[i] * dt; PP.z[i] += PP.vz[i] * dt;
    if (ty === 1) s *= u; else if (ty === 2) s *= (1.7 - u) * Math.min(1, u * 3); else if (ty === 3) s *= Math.min(1, u * 2); else if (ty === 4) s *= (1.6 - u) * Math.min(1, u * 4);
    if ((ty === 0 || ty === 3) && PP.y[i] < PP.g[i] + .04) { const g = gy(PP.x[i], PP.z[i]); PP.g[i] = g; if (PP.y[i] < g + .04) { if (ty === 0 && Math.random() < .6) addDecal(PP.x[i], PP.z[i], rnd(.12, .5), pick(BLOOD), rnd(.6, 1.6)); PP.life[i] = 0; } }
    if (PP.life[i] <= 0) s = 0;
    const a = ty <= 1 ? A : L, o = i * 16;
    // billboard: x = camera right, y = camera up, or along the screen-space velocity for blood
    let ux = _pU.x, uy = _pU.y, uz = _pU.z, rx = _pR.x, ry = _pR.y, rz = _pR.z, st = 1;
    if (ty === 0) { const vx = PP.vx[i], vy = PP.vy[i], vz = PP.vz[i], vf = vx * _pF.x + vy * _pF.y + vz * _pF.z, px = vx - _pF.x * vf, py = vy - _pF.y * vf, pz = vz - _pF.z * vf, pl2 = Math.hypot(px, py, pz);
      if (pl2 > .5) { ux = px / pl2; uy = py / pl2; uz = pz / pl2; rx = _pF.y * uz - _pF.z * uy; ry = _pF.z * ux - _pF.x * uz; rz = _pF.x * uy - _pF.y * ux; st = 1 + Math.min(2.5, pl2 * .25); } }
    a[o] = rx * s; a[o + 1] = ry * s; a[o + 2] = rz * s; a[o + 4] = ux * s * st; a[o + 5] = uy * s * st; a[o + 6] = uz * s * st; a[o + 8] = -_pF.x * s; a[o + 9] = -_pF.y * s; a[o + 10] = -_pF.z * s;
    a[o + 12] = PP.x[i]; a[o + 13] = PP.y[i]; a[o + 14] = PP.z[i];
  }
  pm.instanceMatrix.needsUpdate = true; pl.instanceMatrix.needsUpdate = true;
}
// expanding ground rings for landings
const RINGS = []; const ringGeo = new THREE.RingGeometry(.8, 1, 48); ringGeo.rotateX(-Math.PI / 2);
function shockRing(x, z, R = 6, dur = .25, col = 0xffe2b0) { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .85, depthWrite: false })); m.position.set(x, gy(x, z) + .12, z); m.renderOrder = 3; scene.add(m); RINGS.push({ m, t: 0, dur, R }); }
function ringsTick(dt) { for (let i = RINGS.length - 1; i >= 0; i--) { const r = RINGS[i]; r.t += dt; const u = Math.min(1, r.t / r.dur), e = 1 - (1 - u) ** 3; r.m.scale.setScalar(.5 + e * r.R); r.m.material.opacity = .85 * (1 - u); if (u >= 1) { scene.remove(r.m); r.m.material.dispose(); RINGS.splice(i, 1); } } }
const reticle = new THREE.Mesh(new THREE.RingGeometry(4.6, 6, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .6, depthWrite: false, depthTest: false, fog: false })); reticle.renderOrder = 3; reticle.visible = false; scene.add(reticle);
const reticleDot = new THREE.Mesh(new THREE.CircleGeometry(.6, 20).rotateX(-Math.PI / 2), reticle.material); reticle.add(reticleDot);
const DN = 420; let di = 0, dm;
function initDecals() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'); g.fillStyle = '#fff';
  const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(.55, `rgba(255,255,255,${a * .8})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  blob(64, 64, 40, .85); for (let i = 0; i < 14; i++) { const a = rnd(0, 6.3), r = rnd(20, 46); blob(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, rnd(5, 14), rnd(.5, .85)); }
  const tex = new THREE.CanvasTexture(cv); const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
  dm = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: .88, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), DN);
  dm.frustumCulled = false; dm.renderOrder = 2; const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DN; i++) { dm.setMatrixAt(i, m); dm.setColorAt(i, _c.set(0xffffff)); } scene.add(dm);
}
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion(), _dp = V3(), _ds = V3(), _dn = V3();
function addDecal(x, z, size, color, stretch = 1) {
  if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return; const h = gy(x, z); if (h < TR.WATER) return;
  const i = di; di = (di + 1) % DN; TR.normalAt(x, z, _dn); _dq.setFromUnitVectors(_Y, _dn).multiply(_dq2.setFromAxisAngle(_Y, rnd(0, 6.3)));
  _dp.set(x, h + .05 + i * .00008, z); _ds.set(size * stretch, 1, size / stretch);
  dm.setMatrixAt(i, _dm.compose(_dp, _dq, _ds)); dm.setColorAt(i, _c.set(color).multiplyScalar(.55)); dm.instanceMatrix.needsUpdate = true; dm.instanceColor.needsUpdate = true;
}
function clearFx() { PP.life.fill(0); for (const m of [pm, pl]) { const a = m.instanceMatrix.array; for (let i = 0; i < PN; i++) a[i * 16] = a[i * 16 + 5] = a[i * 16 + 10] = 0; m.instanceMatrix.needsUpdate = true; } const m = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < DN; i++) dm.setMatrixAt(i, m); dm.instanceMatrix.needsUpdate = true; }

// ---------- characters ----------
let MODELS = {}, RIGS = {}; const REST = {};
const KNAME = k => CHARS[k] ? CHARS[k][0] : FOLK[k] ? FOLK[k][0] : k;
const MASS = { pelvis: 12, chest: 14, head: 5, armL: 3, foreL: 2.5, armR: 3, foreR: 2.5, thighL: 6, shinL: 4.5, thighR: 6, shinR: 4.5 };
const SEGNAME = { chest: 'their top half', head: 'their head', armL: 'an arm', foreL: 'a forearm', armR: 'an arm', foreR: 'a forearm', thighL: 'a leg', shinL: 'a shin', thighR: 'a leg', shinR: 'a shin' };
function computeRest(inst) {
  const B = inst.bones, P = {}; for (const n in B) P[n] = B[n].getWorldPosition(V3());
  if (!P.HeadTop_End) P.HeadTop_End = P.Head.clone().add(P.Head.clone().sub(P.Neck).multiplyScalar(2.2));
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
// finger curl: rotate each finger joint toward the palm, found from the hand's own rest geometry
function c0Rest(inst) { const out = []; for (const n in inst.bones) if (/Hand(Index|Middle|Ring|Pinky|Thumb)\d$/.test(n)) out.push([inst.bones[n], inst.bones[n].userData.q0 || (inst.bones[n].userData.q0 = inst.bones[n].quaternion.clone())]); return out; }
function computeCurl(inst, amt) {
  const B = inst.bones, out = [], pos = n => B[n] ? B[n].getWorldPosition(V3()) : null; c0Rest(inst);
  for (const side of ['Left', 'Right']) {
    const hand = pos(side + 'Hand'), i1 = pos(side + 'HandIndex1'), p1 = pos(side + 'HandPinky1'), th = pos(side + 'HandThumb2'); if (!hand || !i1 || !p1) continue;
    const across = i1.clone().sub(p1).normalize(), fwd = i1.clone().add(p1).multiplyScalar(.5).sub(hand).normalize(), nrm = V3().crossVectors(fwd, across).normalize();
    if (th && th.clone().sub(hand).dot(nrm) < 0) nrm.negate(); // palm side is where the thumb sits
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) for (let j = 1; j <= 3; j++) {
      const b = B[side + 'Hand' + f + j], ch = b && b.children.find(x => x.isBone); if (!b || !ch) continue;
      const a = b.getWorldPosition(V3()), d = ch.getWorldPosition(V3()).sub(a).normalize(), ax = V3().crossVectors(d, nrm); if (ax.lengthSq() < 1e-6) continue;
      const ang = (f === 'Thumb' ? [.35, .45, .3][j - 1] : [1.25, 1.45, 1.0][j - 1]) * amt;
      addWorldRot(b, new THREE.Quaternion().setFromAxisAngle(ax.normalize(), ang)); out.push([boneName(b), b.quaternion.clone()]);
    }
  }
  return out;
}
const boneName = b => b.name.replace(/^mixamorig:?/, '');
const IDLES = ['Idle_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Idle_FoldArms_Loop'];
function makeChar(kind, x, z, o = {}) {
  const inst = instance(MODELS[kind]), holder = new THREE.Group(); holder.add(inst.root); town.add(holder);
  inst.mesh.castShadow = true; if (o.tint) inst.mesh.material.color.set(o.tint);
  if (o.player) { const mt = inst.mesh.material; mt.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n float rimF = pow(1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.), 2.4); totalEmissiveRadiance += vec3(1., .8, .45) * rimF * .6;'); }; mt.customProgramCacheKey = () => 'rim'; }
  holder.updateMatrixWorld(true); const R = REST[kind] || (REST[kind] = computeRest(inst));
  if (!R.curl) R.curl = { full: computeCurl(inst, 1), soft: null }; if (!R.curl.soft) { for (const [b, q] of c0Rest(inst)) b.quaternion.copy(q); R.curl.soft = computeCurl(inst, .35); }
  for (const [n, q] of (o.player ? R.curl.full : R.curl.soft)) if (inst.bones[n]) inst.bones[n].quaternion.copy(q);
  const y = o.y ?? gy(x, z);
  const c = { kind, name: o.name || KNAME(kind), inst, holder, bones: inst.bones, R, rootY: inst.root.position.y, yaw: o.yaw ?? rnd(0, 6.3), hp: 100, alive: true, rag: false, parts: {}, cons: {}, bleeders: [], restL: [], isPlayer: !!o.player, ground: false, gBody: null, vyPrev: 0, jumps: 0, ragT: 0, downT: 3, carT: 0, hazT: 0, atk: null, panic: 0, speed: 0, smearT: 0, launch: null, gone: false, stagger: 0, lock: 0, airT: 0, rollT: 0, charging: 0, jumpBuf: 0, comboN: 0, comboHits: 0, turnRate: 0, lean: 0, pitchLean: 0, prevVx: 0, prevVz: 0, stepPh: 0,
    home: o.home || { x, z, r: 14 }, idleClip: o.idle || pick(IDLES), walkClip: o.walk || 'Walk_Loop',
    ai: { tx: x, tz: z, wait: rnd(0, 2), spd: rnd(1.3, 2.0), stuck: 0, lx: x, lz: z } };
  holder.traverse(b => { if (b.isBone) c.restL.push([b, b.position.clone(), b.quaternion.clone()]); });
  c.an = RIGS[kind] ? new Animator(RIGS[kind], inst.bones) : null;
  const b = new CANNON.Body({ mass: 60, material: matChar, collisionFilterGroup: G_CHAR, collisionFilterMask: G_WORLD | G_CHAR, linearDamping: 0, angularDamping: 1, allowSleep: false, fixedRotation: true });
  b.addShape(new CANNON.Sphere(.32), CV(0, -.43, 0)); b.addShape(new CANNON.Sphere(.32), CV(0, .3, 0)); b.updateMassProperties();
  b.position.set(x, y + .76, z); b.char = c; b.addEventListener('collide', onCharCollide); world.addBody(b); c.body = b;
  holder.position.set(x, y, z); holder.rotation.y = c.yaw;
  return c;
}
function removeChar(c) {
  if (c.gone) return; c.gone = true; if (grab && grab.c === c) releaseGrab();
  for (const s in c.cons) world.removeConstraint(c.cons[s]); for (const s in c.parts) world.removeBody(c.parts[s]); if (!c.rag && !c.parked) world.removeBody(c.body);
  town.remove(c.holder); c.inst.dispose(); const i = npcs.indexOf(c); if (i >= 0) npcs.splice(i, 1);
}
const isDet = (c, s) => { while (s) { if (c.inst.cut.has(s)) return true; s = SEG_PARENT[s]; } return false; };
const charPos = c => c.rag ? c.parts.pelvis.position : c.body.position;
const allChars = () => player ? [player, ...npcs] : npcs.slice();

// ---------- animation ----------
// stride per locomotion cycle (m) for a 1.8 m person, used to lock the feet to the ground speed
const STRIDE = { Walk_Loop: 1.75, Walk_Formal_Loop: 1.6, Jog_Fwd_Loop: 3.1, Sprint_Loop: 4.6, Zombie_Walk_Fwd_Loop: 1.2, Crouch_Fwd_Loop: 1.3 };
const _hq = new THREE.Quaternion(), _hqi = new THREE.Quaternion(), _aq = new THREE.Quaternion(), _ae = new THREE.Euler();
function animate(c, dt) {
  const an = c.an; if (!an) return;
  const scale = c.R.H / 1.8, s = c.speed / scale; let rate = 0;
  an.clearLoco();
  if (c.flight) { an.setLoco('Jump_Loop', 1); }
  else if (!c.ground && c.airT > .1 && !c.jet) { an.setLoco('Jump_Loop', 1); }
  else if (c.jet) { an.setLoco('Jump_Loop', 1); }
  else if (s < .35) an.setLoco(c.isPlayer ? 'Idle_Loop' : c.idleClip, 1);
  else {
    const walk = c.panic > 0 ? 'Jog_Fwd_Loop' : c.walkClip;
    const wWalk = 1 - sstep(2.4, 3.6, s), wSpr = sstep(5.6, 7.4, s), wJog = Math.max(0, 1 - wWalk - wSpr);
    const idleW = 1 - sstep(.35, 1.0, s);
    if (idleW > 0) an.setLoco(c.isPlayer ? 'Idle_Loop' : c.idleClip, idleW);
    if (wWalk > 0) an.setLoco(walk, wWalk * (1 - idleW)); if (wJog > 0) an.setLoco('Jog_Fwd_Loop', wJog * (1 - idleW)); if (wSpr > 0) an.setLoco('Sprint_Loop', wSpr * (1 - idleW));
    const stride = (wWalk * (STRIDE[walk] || 1.7) + wJog * STRIDE.Jog_Fwd_Loop + wSpr * STRIDE.Sprint_Loop) || 1.7;
    rate = s / stride;
  }
  an.update(dt, rate);
  // footsteps for the player, from the gait phase
  if (c.isPlayer && rate > 0 && c.ground) { const ph = (an.phase * 2) % 1; if (ph < c.stepPh) { sample(s > 3.5 ? 'run' : 'walk', clamp(.18 + s * .05, .15, .55)) || sfx('thud', .05); if (s > 6) dust(c.body.position.x, c.body.position.z, 2, 1, .14); } c.stepPh = ph; }
  // procedural layer: lean into turns and acceleration, head look
  _hq.setFromAxisAngle(_Y, c.yaw); _hqi.copy(_hq).invert();
  const B = c.bones;
  const leanT = clamp(-c.turnRate * .055 * Math.min(1, s / 4), -.32, .32); c.lean += (leanT - c.lean) * (1 - Math.exp(-dt * 9));
  if (B.Spine && Math.abs(c.lean) > .002) addHolderRot(B.Spine, _hqi, _aq.setFromAxisAngle(V3(0, 0, 1), c.lean));
  if (B.Hips && Math.abs(c.lean) > .002) addHolderRot(B.Hips, _hqi, _aq.setFromAxisAngle(V3(0, 0, 1), c.lean * .5));
  if (B.Spine1 && Math.abs(c.pitchLean) > .002) addHolderRot(B.Spine1, _hqi, _aq.setFromAxisAngle(V3(1, 0, 0), c.pitchLean));
  if (c.isPlayer && B.Head && !an.busy && c.ground) { const look = clamp(angDiff(cam.yaw + Math.PI, c.yaw), -1.1, 1.1) * .55; c.look = (c.look || 0) + (look - (c.look || 0)) * (1 - Math.exp(-dt * 6)); addHolderRot(B.Head, _hqi, _aq.setFromAxisAngle(_Y, c.look)); }
  if (c.panic > 0 && B.Head) addHolderRot(B.Head, _hqi, _aq.setFromAxisAngle(_Y, Math.sin(T * 9 + c.home.x) * .5));
  if (c.tongue && B.Head) addHolderRot(B.Head, _hqi, _aq.setFromAxisAngle(V3(1, 0, 0), -.3));
  procPose(c, dt, s);
}
// procedural layer on top of the mocap: arms down when airborne (no wing suit), superman in cannon flight,
// the launcher uppercut, hit flinches, and feet planted on slopes
const _d1 = V3(), _d2 = V3(), _hqq = new THREE.Quaternion();
const hdir = (c, x, y, z, out = _d1) => out.set(x, y, z).normalize().applyQuaternion(c.holder.quaternion);
function procPose(c, dt, s) {
  const B = c.bones, R = c.R, an = c.an, sl = R.sideL, sr = R.sideR; c.holder.updateMatrixWorld(true);
  const air = c.flight ? 0 : ((!c.ground && c.airT > .12) || c.jet) && !an.busy ? 1 : 0;
  c.armW = (c.armW || 0) + (air - (c.armW || 0)) * (1 - Math.exp(-dt * 10));
  if (c.armW > .01) for (const [n, sd] of [['Left', sl], ['Right', sr]]) {
    aimBone(B[n + 'Arm'], B[n + 'ForeArm'], hdir(c, sd * .52, -.7, .3), c.armW * .85);
    aimBone(B[n + 'ForeArm'], B[n + 'Hand'], hdir(c, sd * .12, -.05, 1, _d2), c.armW * .8);
  }
  if (c.flight) { // superman, with a little wobble
    const wob = Math.sin(T * 7 + (c.home ? c.home.x : 0)) * .12;
    for (const [n, sd] of [['Left', sl], ['Right', sr]]) {
      aimBone(B[n + 'Arm'], B[n + 'ForeArm'], hdir(c, sd * (.22 + wob), .18, 1), .9);
      aimBone(B[n + 'ForeArm'], B[n + 'Hand'], hdir(c, sd * .08, .22, 1, _d2), .85);
      aimBone(B[n + 'UpLeg'], B[n + 'Leg'], hdir(c, sd * (.12 - wob * .5), -1, -.28), .8);
      aimBone(B[n + 'Leg'], B[n + 'Foot'], hdir(c, sd * .1, -1, -.42, _d2), .8);
    }
  }
  if (c.atk && c.atk.name === 'launcher' && B.RightArm) { // crouch-and-rise body from Jump_Start, right fist drives up
    const u = c.atk.t / c.atk.len, sd = sr;
    if (u < .38) { const w = sstep(0, .25, u); aimBone(B.RightArm, B.RightForeArm, hdir(c, sd * .35, -.85, -.35), w * .8); aimBone(B.RightForeArm, B.RightHand, hdir(c, sd * .1, .3, .9, _d2), w * .7); }
    else { const w = 1 - sstep(.75, 1, u); aimBone(B.RightArm, B.RightForeArm, hdir(c, sd * .12, .85, .45), w); aimBone(B.RightForeArm, B.RightHand, hdir(c, sd * .05, 1, .12, _d2), w); }
    aimBone(B.LeftArm, B.LeftForeArm, hdir(c, sl * .45, -.55, .5), .6); aimBone(B.LeftForeArm, B.LeftHand, hdir(c, sl * .1, .5, .8, _d2), .6);
  }
  if (c.flinch > 0) { const k = sstep(0, .22, c.flinch); c.flinch -= dt; const ax = V3(1, 0, 0); if (B.Spine1) addHolderRot(B.Spine1, _hqi, _aq.setFromAxisAngle(ax, -.32 * k)); if (B.Head) addHolderRot(B.Head, _hqi, _aq.setFromAxisAngle(V3(c.flinchSide || 0, 0, 1).normalize(), -.55 * k)); }
  if (c.flashT > 0 || c.flashOn) { c.flashT -= dt; const k = c.flashT > .08 ? .6 : Math.max(0, c.flashT / .08) * .6; c.inst.mesh.material.emissive.setRGB(k, k * .92, k * .8); c.flashOn = k > 0; }
  c.inst.root.position.y = c.rootY;
  if (c.ground && !c.flight && !c.rag && (c.isPlayer || c.near) && !(c.atk && c.atk.mv.charge) && c.rollT <= 0) footIK(c);
}
const _H = V3(), _K = V3(), _A = V3(), _At = V3(), _u = V3(), _v = V3(), _n = V3(), _iq = new THREE.Quaternion(), _nq = new THREE.Quaternion(), _fn = V3();
function footIK(c) {
  const B = c.bones; if (!B.LeftFoot || !B.RightFoot) return; const base = c.holder.position.y, off = [0, 0];
  ['Left', 'Right'].forEach((n, i) => { B[n + 'Foot'].getWorldPosition(_A); off[i] = gy(_A.x, _A.z) - base; });
  const drop = clamp(Math.min(off[0], off[1], 0), -.4, 0); c.ikDrop = (c.ikDrop || 0) + (drop - (c.ikDrop || 0)) * .35;
  if (Math.abs(c.ikDrop) < .005 && Math.abs(off[0]) < .02 && Math.abs(off[1]) < .02) return;
  c.inst.root.position.y = c.rootY + c.ikDrop; c.holder.updateMatrixWorld(true);
  ['Left', 'Right'].forEach((n, i) => {
    const up = B[n + 'UpLeg'], kn = B[n + 'Leg'], ft = B[n + 'Foot'], raise = clamp(off[i] - c.ikDrop, -.05, .45); if (Math.abs(raise) < .01) return;
    up.getWorldPosition(_H); kn.getWorldPosition(_K); ft.getWorldPosition(_A); _At.copy(_A); _At.y += raise;
    const l1 = _K.distanceTo(_H), l2 = _A.distanceTo(_K), dT = clamp(_At.distanceTo(_H), Math.abs(l1 - l2) + .01, l1 + l2 - .005);
    _u.subVectors(_H, _K); _v.subVectors(_A, _K); _n.crossVectors(_u, _v);
    if (_n.lengthSq() > 1e-8) { _n.normalize().negate(); const cur = _u.angleTo(_v), want = Math.acos(clamp((l1 * l1 + l2 * l2 - dT * dT) / (2 * l1 * l2), -1, 1)); addWorldRot(kn, _iq.setFromAxisAngle(_n, cur - want)); }
    ft.getWorldPosition(_A); _u.subVectors(_A, _H).normalize(); _v.subVectors(_At, _H).normalize(); addWorldRot(up, _iq.setFromUnitVectors(_u, _v));
    // tilt the foot to the slope
    ft.getWorldPosition(_A); TR.normalAt(_A.x, _A.z, _fn); _nq.setFromUnitVectors(_Y, _fn); _iq.identity().slerp(_nq, .7); addWorldRot(ft, _iq);
  });
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
  if (c.flight) endFlight(c, true);
  if (c.rag) { if (vel) for (const s in c.parts) { const b = c.parts[s]; b.wakeUp(); b.velocity.x += vel.x; b.velocity.y += vel.y; b.velocity.z += vel.z; } return; }
  c.holder.updateMatrixWorld(true); const bv = c.body.velocity;
  for (const s of SEGS) {
    if (c.parts[s]) continue; const R = c.R.seg[s], bone = c.bones[SEG_BONE[s]];
    bone.getWorldQuaternion(_rq); bone.getWorldPosition(_rv); _rq.multiply(_rq2.copy(R.Q0).invert()).normalize(); _rv2.copy(R.off).applyQuaternion(_rq).add(_rv);
    const b = new CANNON.Body({ mass: MASS[s], material: matDef, collisionFilterGroup: G_RAG, collisionFilterMask: G_WORLD, linearDamping: .05, angularDamping: .45, sleepSpeedLimit: .5, sleepTimeLimit: 1 });
    b.addShape(s === 'head' ? new CANNON.Sphere(R.r) : new CANNON.Box(CV(R.half[0], R.half[1], R.half[2])));
    b.position.set(_rv2.x, Math.max(_rv2.y, gy(_rv2.x, _rv2.z) + .06), _rv2.z); b.quaternion.set(_rq.x, _rq.y, _rq.z, _rq.w);
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
  if (c.parked) c.parked = false; else world.removeBody(c.body); c.rag = true; c.ragT = 0; c.atk = null; c.stagger = 0; c.lock = 0; c.downT = rnd(3, 5.5); c.inst.root.position.y = c.rootY; if (c.an) c.an.act = null;
  if (c.isPlayer && grab) releaseGrab();
}
// get-up: hand the ragdoll's pose to the LayToIdle clip instead of snapping upright
let LAY_YAW = 0;
function standUp(c) {
  if (!c.rag || c.gone) return; const pv = c.parts.pelvis.position, px = pv.x, pz = pv.z;
  const hd = c.parts.head && !isDet(c, 'head') ? c.parts.head.position : c.parts.chest ? c.parts.chest.position : null;
  if (hd) c.yaw = Math.atan2(hd.x - px, hd.z - pz) - LAY_YAW;
  c.holder.position.set(px, gy(px, pz), pz); c.holder.rotation.y = c.yaw; c.holder.updateMatrixWorld(true); driveParts(c);
  if (c.an) c.an.snapshot(c.isPlayer ? .25 : .35);
  for (const s of SEGS) { if (!c.parts[s] || isDet(c, s)) continue; if (c.cons[s]) { world.removeConstraint(c.cons[s]); delete c.cons[s]; } world.removeBody(c.parts[s]); delete c.parts[s]; }
  const keep = new Set(Object.keys(c.parts).map(s => c.bones[SEG_BONE[s]]));
  for (const [b, p, q] of c.restL) { if (keep.has(b)) continue; b.position.copy(p); b.quaternion.copy(q); }
  const h = gy(px, pz); c.body.position.set(px, h + .78, pz); c.body.velocity.set(0, 0, 0); world.addBody(c.body);
  c.rag = false; c.ground = true; c.jumps = 0; c.peakY = h; c.ai.wait = 1.4; c.ai.tx = px; c.ai.tz = pz;
  if (c.an && !c.crippled) { const rate = c.isPlayer ? 1.9 : 1.25; c.an.play('LayToIdle', { rate, fadeIn: .01, fadeOut: .25 }); c.lock = 1.4 / rate; }
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
  for (let i = 0; i < 4; i++) after(.5 + i * .5, () => { if (!c.gone) { const q = charPos(c); addDecal(q.x + rnd(-.4, .4), q.z + rnd(-.4, .4), rnd(.5, 1.1), pick(BLOOD)); } });
}
function knock(c, vel, dmg, byPlayer) {
  if (c.gone) return; ragdoll(c, vel); c.ragT = 0; const p = charPos(c);
  if (byPlayer && !c.isPlayer && !c.launch) c.launch = { x: p.x, z: p.z };
  if (dmg) hurt(c, dmg);
  if (!c.isPlayer) scare(p.x, p.z, 16);
}
function scare(x, z, r) { for (const n of npcs) { if (n.rag || n.gone || !n.alive) continue; const p = n.body.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d > r || d < .1) continue; n.panic = rnd(3, 5); n.ai.tx = clamp(p.x + dx / d * 22, -BOUND, BOUND); n.ai.tz = clamp(p.z + dz / d * 22, -BOUND, BOUND); n.ai.wait = 0; } }
function onCharCollide(e) {
  const c = e.target.char, o = e.body; if (!c || c.rag) return;
  if (o.car) { later.push(() => carHit(c, o.car)); return; }
  if (o.hazard) { later.push(() => hazardHit(c, o)); return; }
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (o.thing && !o.thing.frozen && o.type === CANNON.Body.DYNAMIC) {
    if (grab && grab.body === o && c.isPlayer) return;
    if (c.isPlayer ? (v > 9 && o.mass > 25) : (v > 5 && o.mass > 4)) {
      const vel = V3(o.velocity.x * .8, o.velocity.y * .5 + 3, o.velocity.z * .8), dmg = Math.min(70, v * Math.sqrt(o.mass) * .9), bould = o.thing.kind === 'boulder';
      later.push(() => { knock(c, vel, dmg, true); if (!c.isPlayer) { addScore(bould ? `${c.name} got bouldered` : `${c.name} got clobbered`, bould ? 300 : 80, bould); if (bould) objective('boulder'); } });
    }
  } else if (o.char && o.char.isPlayer && !c.isPlayer && (player.speed > 9.5 || player.charging)) { const pv = player.body.velocity, vel = V3(pv.x * 1.3, 6, pv.z * 1.3); later.push(() => { if (c.rag) return; knock(c, vel, 14, true); addScore(`${c.name} shoulder-barged`, 60); hitFx(charPos(c), .07, .3); }); }
}
function onRagCollide(e) {
  const b = e.target, c = b.ragOf, o = e.body; if (!c || c.gone) return;
  if (o.car && !o.car.wrecked) { later.push(() => { if (c.gone || c.carT > 0) return; c.carT = .6; const v = o.velocity; ragdoll(c, V3(v.x * .8, 5, v.z * .8)); hurt(c, 25); maybeSever(c, .2); }); return; }
  if (o.hazard) { later.push(() => hazardHit(c, o)); return; }
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v < 9) return;
  later.push(() => { if (c.gone) return; const p = b.position; blood(p.x, p.y, p.z, 0, .5, 0, Math.min(20, v), 4); if (T - c.smearT > .1) { c.smearT = T; if (p.y < gy(p.x, p.z) + .8) addDecal(p.x, p.z, rnd(.3, .7), pick(BLOOD), rnd(.7, 1.5)); } if (v > 14) { dust(p.x, p.z, 4, 2); sfx('thud', clamp(v / 40, .1, .6)); } hurt(c, (v - 7) * 2.2, true); if (v > 22) maybeSever(c, .25); });
}

// ---------- explosions ----------
let shake = 0; const kick = V3();
function explode(x, y, z, pow = 1) {
  const R = 6.5 * pow;
  for (const t of things.slice()) { if (t.dead) continue; const bp = t.body.position, dx = bp.x - x, dy = bp.y - y, dz = bp.z - z, d = Math.hypot(dx, dy, dz); if (d > R) continue; const k = 1 - d / R, n = d || 1, v = k * 20 * pow; hitThing(t, CV(dx / n * v, dy / n * v + k * 9, dz / n * v), k * 140 * pow); }
  for (const c of allChars()) {
    if (c.gone) continue; const cp = charPos(c), dx = cp.x - x, dy = cp.y + .3 - y, dz = cp.z - z, d = Math.hypot(dx, dy, dz);
    if (d > R) { if (!c.isPlayer && !c.rag && d < 32) scare(x, z, 32); continue; }
    const k = 1 - d / R, n = d || 1, vel = V3(dx / n, dy / n + .5, dz / n).multiplyScalar(k * 22 * pow);
    knock(c, vel, k * 120 * pow, true);
    if (k > .3) { const m = k > .65 ? 1 + (Math.random() * 3 | 0) : 1; for (let i = 0; i < m; i++) maybeSever(c, c.isPlayer ? .3 : .85, vel.clone().multiplyScalar(.6).add(V3(rnd(-4, 4), rnd(2, 8), rnd(-4, 4)))); }
  }
  for (const car of cars) { const p = car.body.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz, p.y - y); if (d < R * .85) { const k = 1 - d / R; wreckCar(car, CV(dx / (d || 1) * k * 16, 6 + k * 9, dz / (d || 1) * k * 16), 'blown up'); } }
  forestHit(x, z, R * .6, 999, V3(0, 0, 0), true); beastsBlast(x, z, R * .8, 16 * pow);
  for (let i = 0; i < 46; i++) { const a = rnd(0, 6.3), e = rnd(0, 1.5), s = rnd(3, 13) * pow; spawnP(x, y + .3, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, pick([0xffd23f, 0xff8a1c, 0xff4a1c, 0xfff2a0]), rnd(.3, .8) * pow, rnd(.35, .8), 1); }
  for (let i = 0; i < 18; i++) spawnP(x + rnd(-1, 1), y + rnd(.3, 1.5), z + rnd(-1, 1), rnd(-3, 3), rnd(2, 6), rnd(-3, 3), pick([0x3a3a3a, 0x555555, 0x2a2a2a]), rnd(.6, 1.2) * pow, rnd(1.2, 2.4), 2);
  for (let i = 0; i < 26; i++) { const a = rnd(0, 6.3); spawnP(x, y + .2, z, Math.cos(a) * rnd(6, 20), rnd(4, 16), Math.sin(a) * rnd(6, 20), pick([0x333333, 0x555555, 0x8a6a40]), rnd(.05, .12), rnd(.8, 1.6), 3); }
  if (y < gy(x, z) + 3) addDecal(x, z, 2.6 * pow, 0x141414);
  const dp = player ? Math.hypot(charPos(player).x - x, charPos(player).z - z) : 99; shake = Math.max(shake, clamp(1.4 * pow - dp * .03, .15, 1.6)); hitstop = Math.max(hitstop, dp < 12 ? .06 : 0);
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

// ---------- town pieces (everything takes a ground height) ----------
function mkGroup(name, pts) { const g = { name, pts, members: [], total: 0, loose: 0, done: false }; groups.push(g); return g; }
function chunk(g, x, y, z, w, h, d, mat, tough, mass, kind) { return addThing({ kind: kind || 'chunk', frozen: true, group: g, tough, mass, pos: [x, y, z], mesh: new THREE.Mesh(boxGeo(w, h, d), mat), shape: new CANNON.Box(CV(w / 2, h / 2, d / 2)) }); }
function house(x, z, mat, roofMat, y0 = gy(x, z)) {
  const g = mkGroup('House', 800), W = 6, D = 5, th = .5, rows = 4;
  for (let r = 0; r < rows; r++) {
    const y = y0 + r + .5;
    for (let i = 0; i < 3; i++) { const bx = x - W / 2 + 1 + i * 2; chunk(g, bx, y, z - D / 2 + th / 2, 2, 1, th, mat, 35, 45); if (!(i === 1 && r < 2)) chunk(g, bx, y, z + D / 2 - th / 2, 2, 1, th, mat, 35, 45); }
    for (let i = 0; i < 2; i++) { const bz = z - 1 + i * 2; chunk(g, x - W / 2 + th / 2, y, bz, th, 1, 2, mat, 35, 45); chunk(g, x + W / 2 - th / 2, y, bz, th, 1, 2, mat, 35, 45); }
  }
  const cone = new THREE.Mesh(new THREE.ConeGeometry(W * .8, 2.4, 4), roofMat); cone.rotation.y = Math.PI / 4; cone.position.y = 1.1; const slab = new THREE.Mesh(boxGeo(W + .6, .3, D + .6), roofMat); const rg = new THREE.Group(); rg.add(slab, cone);
  addThing({ kind: 'roof', frozen: true, group: g, tough: 30, mass: 160, pos: [x, y0 + rows + .15, z], mesh: rg, shape: new CANNON.Box(CV(W / 2 + .3, .15, D / 2 + .3)) });
  barrel(x + W / 2 + 1, z + 1); crate(x - W / 2 - 1, gy(x - W / 2 - 1, z - 1) + .5, z - 1); crate(x - W / 2 - 1, gy(x - W / 2 - 1, z + .1) + .5, z + .1);
}
function stoneWall(x, z, len, alongZ, rows = 3) {
  const g = mkGroup('Stone wall', 250), n = Math.round(len / 1.5), y0 = gy(x, z);
  for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * 1.5 + (r % 2 ? .37 : 0); alongZ ? chunk(g, x, y0 + .375 + r * .75, z + o, .6, .75, 1.5, M.stone, 60, 60) : chunk(g, x + o, y0 + .375 + r * .75, z, 1.5, .75, .6, M.stone, 60, 60); }
}
function fence(x, z, alongZ) {
  const pieces = []; for (let i = 0; i < 6; i++) pieces.push({ s: [.42, 1.25, .08], p: [-1.25 + i * .5, 0, 0], mat: i % 2 ? M.wood : M.wood2, m: 3 }); pieces.push({ s: [3, .12, .06], p: [0, .25, .07], mat: M.wood2, m: 3 }, { s: [3, .12, .06], p: [0, -.3, .07], mat: M.wood2, m: 3 });
  addThing({ kind: 'fence', name: 'Fence', pts: 120, tough: 20, frozen: true, pieces, pos: [x, gy(x, z) + .625, z], q: alongZ ? new THREE.Quaternion().setFromAxisAngle(_Y, Math.PI / 2) : null, shape: new CANNON.Box(CV(1.5, .625, .1)) });
}
const cratePieces = [{ s: [.95, .1, .95], p: [0, .42, 0] }, { s: [.95, .1, .95], p: [0, -.42, 0] }, { s: [.1, .8, .95], p: [.42, 0, 0] }, { s: [.1, .8, .95], p: [-.42, 0, 0] }, { s: [.8, .8, .1], p: [0, 0, .42] }, { s: [.8, .8, .1], p: [0, 0, -.42] }];
function crate(x, y, z) { for (const p of cratePieces) { p.mat = M.wood; p.m = 3; } return addThing({ kind: 'crate', name: 'Crate', verb: 'smashed', pts: 40, tough: 50, mass: 22, pieces: cratePieces, mesh: new THREE.Mesh(boxGeo(1, 1, 1), M.wood), pos: [x, y, z], shape: new CANNON.Box(CV(.5, .5, .5)), asleep: true }); }
function barrel(x, z, y) {
  if (y === undefined) y = gy(x, z) + .56;
  const g = new THREE.Group(), b = new THREE.Mesh(cylGeo, M.barrel); b.scale.set(.42, 1.1, .42); g.add(b); for (const yy of [-.3, .3]) { const r = new THREE.Mesh(cylGeo, M.band); r.scale.set(.44, .08, .44); r.position.y = yy; g.add(r); }
  return addThing({ kind: 'barrel', name: 'Barrel', hp: 40, mass: 25, mesh: g, pos: [x, y, z], shape: new CANNON.Cylinder(.42, .42, 1.1, 10), asleep: true });
}
const EXTRA_TREES = [];
function tree(x, z, s = 1) {
  if (TREE_T.length) { EXTRA_TREES.push({ x, z, s: s * 1.1 }); return; }
  const y = gy(x, z);
  addThing({ kind: 'tree', name: 'Tree', verb: 'felled', pts: 150, tough: 70, frozen: true, pos: [x, y + 1.5 * s, z], shape: new CANNON.Box(CV(.3 * s, 1.5 * s, .3 * s)), pieces: [{ s: [.5 * s, 3 * s, .5 * s], p: [0, 0, 0], mat: M.bark, m: 30 }, { s: [2.2 * s, 2.6 * s, 2.2 * s], p: [0, 2.6 * s, 0], mat: Math.random() < .5 ? M.leaf : M.leaf2, m: 20, geo: new THREE.ConeGeometry(1.7 * s, 3.4 * s, 7) }, { s: [1.5 * s, 2 * s, 1.5 * s], p: [0, 4.1 * s, 0], mat: M.leaf2, m: 10, geo: new THREE.ConeGeometry(1.2 * s, 2.4 * s, 7) }] });
}
function bench(x, z, ry) { addThing({ kind: 'bench', name: 'Bench', pts: 60, tough: 20, frozen: true, pos: [x, gy(x, z) + .45, z], q: new THREE.Quaternion().setFromAxisAngle(_Y, ry), shape: new CANNON.Box(CV(1, .45, .3)), pieces: [{ s: [2, .1, .55], p: [0, 0, 0], mat: M.wood2, m: 5 }, { s: [2, .5, .08], p: [0, .3, -.25], mat: M.wood2, m: 4 }, { s: [.1, .45, .5], p: [-.85, -.22, 0], mat: M.steel, m: 4 }, { s: [.1, .45, .5], p: [.85, -.22, 0], mat: M.steel, m: 4 }] }); }
function stall(x, z) { const pc = []; for (const [px, pz] of [[-1.4, -.9], [1.4, -.9], [-1.4, .9], [1.4, .9]]) pc.push({ s: [.14, 2.6, .14], p: [px, 0, pz], mat: M.wood2, m: 4 }); for (let i = 0; i < 5; i++) pc.push({ s: [.68, .1, 2.9], p: [-1.36 + i * .68, 1.32 + (i % 2) * .03, .1], mat: i % 2 ? M.canvasO : M.canvasR, m: 2 }); pc.push({ s: [3, .9, .8], p: [0, -.85, .6], mat: M.wood, m: 15 }); addThing({ kind: 'stall', name: 'Market stall', pts: 200, tough: 25, frozen: true, pos: [x, gy(x, z) + 1.3, z], shape: new CANNON.Box(CV(1.6, 1.3, 1.1)), pieces: pc }); }
function tramp(x, z, big) {
  const y = gy(x, z), g = new THREE.Group(), n = 8, R0 = 1.55;
  for (let i = 0; i < n; i++) { const a = (i + .5) / n * 6.283, rail = new THREE.Mesh(boxGeo(2 * R0 * Math.tan(Math.PI / n) + .12, .16, .22), M.wood2); rail.position.set(Math.cos(a) * R0, .32, Math.sin(a) * R0); rail.rotation.y = -a + Math.PI / 2; g.add(rail);
    if (i % 2 === 0) { const leg = new THREE.Mesh(boxGeo(.14, .5, .14), M.wood2); leg.position.set(Math.cos(a) * (R0 - .05), .05, Math.sin(a) * (R0 - .05)); g.add(leg); } }
  const bed = new THREE.Mesh(new THREE.CylinderGeometry(R0 - .08, R0 - .08, .06, 24), big ? M.bedR : M.bedO); bed.position.y = .3; g.add(bed);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 * .55, .05, 4, 24), M.band); ring.rotation.x = Math.PI / 2; ring.position.y = .335; if (big) g.add(ring);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const b = addStatic(g, new CANNON.Box(CV(1.3, .2, 1.3)), [x, y + .2, z], null, { bounce: big ? 37 : 19 });
  b.addEventListener('collide', e => { const o = e.body; if (o.char || o.type !== CANNON.Body.DYNAMIC) return; later.push(() => { o.wakeUp(); o.velocity.y = Math.max(o.velocity.y, big ? 24 : 13); }); });
}
function ramp(x, z, yaw, len, wid, h, y0 = gy(x, z)) { const a = Math.asin(h / len), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, yaw, 0, 'YXZ')); addStatic(new THREE.Mesh(boxGeo(wid, .3, len), lam({ map: texRep('wood2', 2, 4) })), new CANNON.Box(CV(wid / 2, .15, len / 2)), [x, y0 + h / 2, z], q); }

// ---------- the wider world ----------
const POI = [
  { id: 'town', name: 'Martlebrough', x: 0, z: 0, icon: '#e2334b' },
  { id: 'village', name: 'Bellmourn Village', x: 330, z: -250, icon: '#ff9f1c' },
  { id: 'hamlet', name: 'Splinter Hamlet', x: -300, z: -280, icon: '#2f6fff' },
  { id: 'summit', name: 'Yeet Summit', x: -360, z: 330, icon: '#9b5de5' },
  { id: 'farm', name: 'Boulder Farm', x: 190, z: 280, icon: '#2aa84a' },
];
const poi = id => POI.find(p => p.id === id);
// the dirt trail from town to a place, as [x, z] points
function trailPts(p, n = 90) {
  const pts = [], sx = Math.sign(p.x) * 40, sz = Math.sign(p.z) * 34;
  for (let i = 0; i <= n; i++) { const u = i / n; pts.push([sx + (p.x - sx) * u + Math.sin(u * 9 + p.x) * 22 * Math.sin(u * Math.PI), sz + (p.z - sz) * u + Math.cos(u * 7 + p.z) * 22 * Math.sin(u * Math.PI)]); }
  return pts;
}
// roadside stops along each trail (a quarter, half and three quarters of the way), and the boulder ledge above the farm
const STOPS = [], LEDGE = {};
const STOP_KINDS = ['camp', 'pen', 'stunt', 'camp', 'stunt', 'pen', 'stunt', 'camp', 'pen', 'pen', 'camp', 'stunt'];
function shapeTerrain() {
  TR.PLATEAUS.length = 0; TR.BUMPS.length = 0; STOPS.length = 0;
  TR.addBump(-360, 330, 120, 95); TR.addBump(275, 380, 85, 70); TR.addBump(-80, 420, 140, 40); TR.addBump(120, -420, 160, 55);
  TR.addPlateau(330, -250, 62); TR.addPlateau(-300, -280, 34); TR.addPlateau(-360, 330, 24); TR.addPlateau(190, 280, 34);
  for (const p of POI) { const pl = TR.PLATEAUS.find(q => q.x === p.x && q.z === p.z); p.y = pl ? pl.h : 0; }
  // ledge: walk from the farm toward the big hill until the ground is ~10 m above the farm
  { const f = poi('farm'), dx = 275 - f.x, dz = 380 - f.z, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l; let d = 50, x, z, h;
    for (; d < 110; d += 2) { x = f.x + ux * d; z = f.z + uz * d; h = TR.designH(x, z); if (h - f.y >= 7) break; }
    Object.assign(LEDGE, { x, z, h, ux, uz, d }); TR.addPlateau(x, z, 7, h, 10); }
  let k = 0;
  for (const p of POI) {
    if (p.id === 'town') continue; const pts = trailPts(p);
    for (const u of [.25, .5, .75]) {
      const i = Math.round(u * 90), [x, z] = pts[i], [x2, z2] = pts[i + 1], dx = x2 - x, dz = z2 - z, l = Math.hypot(dx, dz), side = k % 2 ? 1 : -1;
      const sx = x - dz / l * 10 * side, sz = z + dx / l * 10 * side, pl = TR.addPlateau(sx, sz, 9, undefined, 16);
      STOPS.push({ x: sx, z: sz, y: pl.h, kind: STOP_KINDS[k % STOP_KINDS.length], yaw: Math.atan2(x - sx, z - sz), to: p.id, u }); k++;
    }
  }
  TR.buildData();
  for (const st of STOPS) st.y = gy(st.x, st.z);
}
const fbmLite = (x, z) => Math.sin(x * .031 + 1.7) * Math.cos(z * .027 - .4) * .6 + Math.sin((x + z) * .053) * .4;
// forest: instanced trunks + canopies, static trunk colliders, felled into a physics log when hit hard
let forest = null, grassField = null;
function grassTick(px, pz) { const g = grassField; if (!g) return; let moved = 0; const R2 = g.R * g.R; for (let n = 0; n < 500; n++) { const i = g.i = (g.i + 1) % g.tx.length, dx = g.tx[i] - px, dz = g.tz[i] - pz; const d2 = dx * dx + dz * dz; if (d2 > R2) { const a = rnd(0, 6.3), r = g.R * (d2 > R2 * 4 ? Math.sqrt(Math.random()) : rnd(.75, .98)); g.place(i, px + Math.cos(a) * r, pz + Math.sin(a) * r, 2); moved++; } } if (moved) { g.tufts.instanceMatrix.needsUpdate = true; g.tufts.instanceColor.needsUpdate = true; } }
function buildForest() {
  const N = 1500, trees = EXTRA_TREES.splice(0).map(t => ({ ...t, y: gy(t.x, t.z), alive: true })); let tries = 0; const TP = POI.filter(p => p.id !== 'town').flatMap(p => trailPts(p, 45));
  while (trees.length < N && tries++ < 40000) {
    const x = rnd(-BOUND + 20, BOUND - 20), z = rnd(-BOUND + 20, BOUND - 20), r = Math.hypot(x, z);
    if (r < 115) continue; if (POI.some(p => Math.hypot(x - p.x, z - p.z) < (p.id === 'village' ? 75 : 45))) continue;
    const h = gy(x, z); if (h < TR.WATER + .8 || h > 150) continue; const n = TR.normalAt(x, z); if (n.y < .82) continue;
    // clumps: accept more in noisy "forest" patches
    const f = Math.sin(x * .012 + Math.cos(z * .009) * 2) * Math.cos(z * .011 - x * .004) + fbmLite(x, z) * .35; if (f < .12 && Math.random() < .94) continue;
    if (STOPS.some(st => Math.hypot(x - st.x, z - st.z) < 17) || Math.hypot(x - LEDGE.x, z - LEDGE.z) < 30) continue;
    if (TP.some(([px, pz]) => Math.abs(px - x) < 6 && Math.abs(pz - z) < 6)) continue;
    trees.push({ x, z, y: h, s: rnd(.8, 1.5), alive: true });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  // bm's village trees, instanced in 4x4 chunks so each chunk can be culled (and stays out of the shadow pass when far)
  const TT = TREE_T.length ? TREE_T : null, CH = TR.W / 4, chunks = new Map(), meshes = [];
  trees.forEach((t, i) => { t.tm = TT ? i % TT.length : 0; t.ht = rnd(7.5, 13.5) * (t.s / 1.15); t.w = rnd(.85, 1.15); const k = `${Math.floor((t.x + TR.HALF) / CH)},${Math.floor((t.z + TR.HALF) / CH)},${t.tm}`; (chunks.get(k) || chunks.set(k, []).get(k)).push(t); });
  for (const [k, list] of chunks) {
    const tpl = TT ? TT[list[0].tm] : null, parts = tpl ? [[tpl.bark, M.bark, false], [tpl.leaves, M.leafCard, true]] : [[(() => { const g = new THREE.CylinderGeometry(.03, .045, 1, 7); g.translate(0, .5, 0); return g; })(), M.bark, false], [(() => { const g = new THREE.IcosahedronGeometry(.28, 1); g.translate(0, .78, 0); return g; })(), M.canopy, true]];
    for (const [geo, mat, leafy] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true;
      list.forEach((t, j) => { im.setMatrixAt(j, m.compose(V3(t.x, t.y - .15, t.z), q.setFromAxisAngle(_Y, (t.x * 13.7 + t.z) % 6.28), V3(t.ht * t.w, t.ht, t.ht * t.w))); if (leafy) im.setColorAt(j, col.setHSL(.2 + rnd(-.04, .06), rnd(.2, .45), rnd(.78, .95))); (t.refs || (t.refs = [])).push([im, j]); });
      im.computeBoundingSphere(); town.add(im); meshes.push(im);
    }
  }
  // trunk colliders share one static body per 64 m cell: thousands of separate bodies make cannon's n^2 collision matrix the bottleneck
  const cellB = new Map();
  trees.forEach(t => { const r = Math.max(.25, t.ht * .035), k = `${Math.floor(t.x / 64)},${Math.floor(t.z / 64)}`; let b = cellB.get(k);
    if (!b) { b = new CANNON.Body({ mass: 0, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL }); b.position.set((Math.floor(t.x / 64) + .5) * 64, 0, (Math.floor(t.z / 64) + .5) * 64); cellB.set(k, b); }
    t.shape = new CANNON.Box(CV(r, t.ht / 2, r)); b.addShape(t.shape, CV(t.x - b.position.x, t.y + t.ht / 2, t.z - b.position.z)); t.body = b; });
  for (const b of cellB.values()) world.addBody(b);
  // spatial buckets
  const cell = 24, grid = new Map(); trees.forEach(t => { const k = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`; (grid.get(k) || grid.set(k, []).get(k)).push(t); });
  forest = { trees, meshes, grid, cell, felled: 0 };
  // rocks
  const RN = 340, rg = new THREE.DodecahedronGeometry(1, 0), rocks = new THREE.InstancedMesh(rg, M.rock, RN); rocks.castShadow = rocks.receiveShadow = true;
  for (let i = 0; i < RN; i++) {
    let x, z, tries2 = 0; do { x = rnd(-BOUND, BOUND); z = rnd(-BOUND, BOUND); } while ((Math.hypot(x, z) < 110 || POI.some(p => Math.hypot(x - p.x, z - p.z) < 40)) && tries2++ < 30);
    const s = Math.random() < .15 ? rnd(1.6, 3.2) : rnd(.3, 1.1), y = gy(x, z);
    rocks.setMatrixAt(i, m.compose(V3(x, y + s * .25, z), q.setFromEuler(new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6))), V3(s * rnd(.9, 1.4), s * rnd(.6, .9), s * rnd(.9, 1.3))));
    rocks.setColorAt(i, col.setHSL(.08, .08, rnd(.55, .8)));
    if (s > .9) { const k = `${Math.floor(x / 64)},${Math.floor(z / 64)}`; let b = cellB.get(k); if (!b) { b = new CANNON.Body({ mass: 0, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL }); b.position.set((Math.floor(x / 64) + .5) * 64, 0, (Math.floor(z / 64) + .5) * 64); cellB.set(k, b); world.addBody(b); } b.addShape(new CANNON.Sphere(s * .85), CV(x - b.position.x, y + s * .05, z - b.position.z)); }
  }
  town.add(rocks);
  // grass tufts and flowers: crossed quads, no shadows
  const TN = 3200, tg = new THREE.PlaneGeometry(.62, .42); tg.translate(0, .2, 0); const tg2 = tg.clone().rotateY(Math.PI / 2);
  const tuftG = new THREE.BufferGeometry(); { const a = tg.attributes.position.array, b = tg2.attributes.position.array, n = tg.attributes.normal.array; const pos = new Float32Array(a.length * 2); pos.set(a); pos.set(b, a.length); const nm = new Float32Array(n.length * 2); for (let i = 0; i < nm.length; i += 3) { nm[i] = 0; nm[i + 1] = 1; nm[i + 2] = 0; } tuftG.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tuftG.setAttribute('normal', new THREE.BufferAttribute(nm, 3)); tuftG.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]); }
  const bc = document.createElement('canvas'); bc.width = 64; bc.height = 64; { const g = bc.getContext('2d'); for (let i = 0; i < 14; i++) { const x = 6 + Math.random() * 52, w = 2 + Math.random() * 3, h = 28 + Math.random() * 34, lean = (Math.random() - .5) * 18; const lg = g.createLinearGradient(0, 64, 0, 0); lg.addColorStop(0, 'hsl(0,0%,62%)'); lg.addColorStop(1, 'hsl(0,0%,' + (88 + Math.random() * 12) + '%)'); g.fillStyle = lg; g.beginPath(); g.moveTo(x - w, 64); g.quadraticCurveTo(x + lean * .4, 64 - h * .6, x + lean, 64 - h); g.quadraticCurveTo(x + lean * .4 + w * .5, 64 - h * .55, x + w, 64); g.fill(); } }
  const bt = new THREE.CanvasTexture(bc); bt.colorSpace = THREE.SRGBColorSpace; { const u = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0]); tuftG.setAttribute('uv', new THREE.BufferAttribute(u, 2)); }
  const tm = lam({ color: 0xffffff, map: bt, alphaTest: .5, side: THREE.DoubleSide });
  tm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vFd;').replace('#include <project_vertex>', '#include <project_vertex>\nvFd = length(mvPosition.xyz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);').replace('#include <common>', '#include <common>\nvarying float vFd;').replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nfloat dz = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233))) * 43758.5453); if (smoothstep(22., 33., vFd) > dz || (1. - smoothstep(2.2, 4.2, vFd)) > dz) discard;'); };
  tm.customProgramCacheKey = () => 'tuft';
  const tufts = new THREE.InstancedMesh(tuftG, tm, TN); let k = 0;
  tufts.frustumCulled = false; tufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage); const tx = new Float32Array(TN), tz = new Float32Array(TN);
  const place = (i, cx, cz, R) => { let x, z, h, tries = 0; do { const a = rnd(0, 6.3), r = Math.sqrt(Math.random()) * R; x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r; h = gy(x, z); } while ((h < TR.WATER + .3 || Math.hypot(x, z) < 10 || (Math.abs(x) < 38 && Math.abs(z) < 30 && Math.abs(Math.abs(x) - 34) < 4) || (Math.hypot(x, z) < 55 && Math.random() < .5)) && tries++ < 6);
    const fl = Math.random() < .07, s = fl ? rnd(.5, .8) : rnd(.75, 1.1); tx[i] = x; tz[i] = z;
    tufts.setMatrixAt(i, m.compose(V3(x, h - .04, z), q.setFromAxisAngle(_Y, rnd(0, 3.2)), V3(s, s * rnd(.75, 1), s)));
    tufts.setColorAt(i, fl ? col.set(pick([0xffe066, 0xff8fb1, 0xffffff, 0xb79cff])) : col.setHSL(.23 + rnd(-.02, .02), .5, rnd(.22, .3))); };
  for (; k < TN; k++) place(k, 0, 5, 34);
  grassField = { tufts, tx, tz, place, R: 34, i: 0 };
  tufts.count = k; town.add(tufts);
}
const _fm = new THREE.Matrix4();
function forestHit(x, z, r, power, dir, boom) {
  if (!forest) return; const { cell, grid } = forest, x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell), z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell); let n = 0;
  for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) for (const t of grid.get(`${i},${j}`) || []) {
    if (!t.alive || Math.hypot(t.x - x, t.z - z) > r + .4 * t.s) continue; if (power < 50 * t.s) continue;
    fell(t, boom ? V3(t.x - x, 0, t.z - z).normalize() : dir); n++;
  }
  return n;
}
function fell(t, dir) {
  t.alive = false; t.body.removeShape(t.shape); const z0 = _fm.makeScale(0, 0, 0); for (const [im, j] of t.refs) { im.setMatrixAt(j, z0); im.instanceMatrix.needsUpdate = true; }
  const ht = t.ht, g = new THREE.Group(), tpl = TREE_T[t.tm];
  if (tpl) for (const [geo, mat] of [[tpl.bark, M.bark], [tpl.leaves, M.leafCard]]) { const me = new THREE.Mesh(geo, mat); me.scale.set(ht * t.w, ht, ht * t.w); me.position.y = -ht / 2; g.add(me); }
  else { const tr = new THREE.Mesh(new THREE.CylinderGeometry(.3, .45, ht, 7), M.bark); g.add(tr); }
  const r = Math.max(.25, ht * .035), sh = new CANNON.Box(CV(r, ht / 2, r)), d = dir.lengthSq() ? dir.clone().normalize() : V3(1, 0, 0);
  addThing({ kind: 'log', name: 'Tree', mass: 30 * ht, mesh: g, pos: [t.x, t.y + ht / 2 + .1, t.z], shape: sh, temp: true, angVel: V3(d.z * 1.8, 0, -d.x * 1.8), vel: { x: d.x * 2, y: 0, z: d.z * 2 } });
  addScore('Tree felled', 150); sfx('crack'); forest.felled++; if (forest.felled >= 5) objective('lumber'); dust(t.x, t.z, 10, 3, .3);
}
// cut single trees out of bm's village model (merged per material) to instance across the hills
let TREE_T = [];
function extractTrees(root, meta) {
  root.updateMatrixWorld(true); const src = { bark: [], leaves: [] };
  root.traverse(o => { if (o.isMesh && src[o.material.name]) src[o.material.name].push(o); });
  const list = (meta.trees || []).slice().sort((a, b) => a.h - b.h), pickT = list.length ? [list[0], list[list.length >> 1], list[list.length - 1]] : [];
  const P = V3(), N3 = new THREE.Matrix3();
  for (const tr of pickT) {
    const out = {}; let y0 = 1e9, y1 = -1e9;
    for (const key of ['bark', 'leaves']) {
      const pos = [], nrm = [], uv = [];
      for (const me of src[key]) {
        const g = me.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ix = g.index ? g.index.array : null, n = ix ? ix.length : pa.count; N3.getNormalMatrix(me.matrixWorld);
        for (let i = 0; i < n; i += 3) {
          let cx = 0, cz = 0; const vs = [];
          for (let k = 0; k < 3; k++) { const vi = ix ? ix[i + k] : i + k; P.fromBufferAttribute(pa, vi).applyMatrix4(me.matrixWorld); cx += P.x / 3; cz += P.z / 3; vs.push([P.x, P.y, P.z, vi]); }
          if (Math.hypot(cx - tr.p[0], cz - tr.p[1]) > tr.s * 1.2) continue;
          for (const [x, y, z, vi] of vs) { pos.push(x - tr.p[0], y, z - tr.p[1]); if (na) { P.fromBufferAttribute(na, vi).applyMatrix3(N3).normalize(); nrm.push(P.x, P.y, P.z); } if (ua) uv.push(ua.getX(vi), ua.getY(vi)); if (key === 'bark') y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        }
      }
      out[key] = { pos, nrm, uv };
    }
    if (!out.bark.pos.length || !out.leaves.pos.length) continue;
    const H = y1 - y0, tpl = { h: H };
    for (const key of ['bark', 'leaves']) { const o = out[key], g = new THREE.BufferGeometry(); for (let i = 0; i < o.pos.length; i += 3) { o.pos[i] /= H; o.pos[i + 1] = (o.pos[i + 1] - y0) / H; o.pos[i + 2] /= H; } g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); if (o.nrm.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nrm, 3)); else g.computeVertexNormals(); if (o.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); tpl[key] = g; }
    TREE_T.push(tpl);
  }
  console.log('tree templates', TREE_T.map(t => [t.bark.attributes.position.count / 3, t.leaves.attributes.position.count / 3, t.h.toFixed(1)]));
}
// bm's village, dropped onto its plateau with its own colliders
async function buildVillage() {
  const p = poi('village');
  const [g, meta] = await Promise.all([new GLTFLoader().loadAsync('assets/bm/village.glb'), fetch('assets/bm/village.json').then(r => r.json())]);
  const TL = new THREE.TextureLoader(), cache = {};
  try { extractTrees(g.scene, meta); } catch (e) { console.warn('tree extract failed', e); }
  const tex = n => cache[n] || (cache[n] = (() => { const t = TL.load(`assets/bm/tex/${n}_c.webp`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 4; return t; })());
  g.scene.traverse(o => {
    if (!o.isMesh) return; const n = o.material.name || o.name;
    if (n === 'flame') o.material = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    else if (n === 'water') o.material = new THREE.MeshLambertMaterial({ color: 0x3d8fd6, transparent: true, opacity: .8 });
    else if (n === 'iron') o.material = M.iron;
    else if (/^fruit/.test(n)) o.material = lam({ color: n === 'fruit' ? 0xd23a2a : 0xe8b030 });
    else o.material = new THREE.MeshLambertMaterial({ map: tex(n), alphaTest: n === 'leaves' || /^door_\d/.test(n) ? .5 : 0, side: n === 'leaves' ? THREE.DoubleSide : THREE.FrontSide });
    o.castShadow = o.receiveShadow = true;
  });
  g.scene.position.set(p.x, p.y, p.z); scene.add(g.scene); villageMesh = g.scene; villageMeta = meta;
}
let villageMesh = null, villageMeta = null;
function villagePhysics() {
  if (!villageMeta) return; const p = poi('village');
  for (const c of villageMeta.colliders) addStatic(null, new CANNON.Box(CV(c.hx, c.h / 2, c.hz)), [p.x + c.x, p.y + c.h / 2, p.z + c.z], new THREE.Quaternion().setFromAxisAngle(_Y, c.yaw));
  for (const d of villageMeta.doors || []) barrel(p.x + d.p[0] + 1.4, p.z + d.p[2] + 1.6);
}
function buildOutlands() {
  // Splinter Hamlet: rb houses you can knock down
  const h = poi('hamlet'), hm = [M.brickA, M.brickB, M.brickC, M.brickD];
  [[-12, -8], [10, -10], [-10, 12], [12, 10]].forEach(([dx, dz], i) => house(h.x + dx, h.z + dz, hm[i], M.roofs[(i + 1) % 5]));
  for (let i = 0; i < 6; i++) fence(h.x - 24 + i * 3, h.z + 22); stall(h.x, h.z); for (let i = 0; i < 5; i++) barrel(h.x + 3 + i * 1.2, h.z - 2);
  // Yeet Summit: a ring of trampolines round a bullseye, a jump ramp off the edge and a barrel pyramid
  const s = poi('summit');
  ramp(s.x + 17, s.z, Math.PI / 2, 10, 6, 3.4, s.y);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; tramp(s.x + Math.cos(a) * 11, s.z + Math.sin(a) * 11, i % 2 === 0); }
  { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#6b4a2c'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(40,25,10,${Math.random() * .25})`; g.fillRect(0, i * 6.4, 256, 2); }
    for (let r = 6; r >= 1; r--) { g.fillStyle = r % 2 ? 'rgba(150,52,40,.88)' : 'rgba(214,202,176,.85)'; g.beginPath(); g.arc(128, 128, r * 20, 0, 7); g.fill(); }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '90,62,36' : '60,40,22'},${Math.random() * .7})`; const x = Math.random() * 256, y = Math.random() * 256; g.fillRect(x, y, 2 + Math.random() * 14, 1 + Math.random() * 3); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; const ring = new THREE.Mesh(new THREE.CircleGeometry(6, 40), lam({ map: tx, polygonOffset: true, polygonOffsetFactor: -2 })); ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, s.y + .32, s.z); ring.receiveShadow = true; town.add(ring);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(6.15, 6.4, .32, 40), M.wood2); disc.receiveShadow = disc.castShadow = true; addStatic(disc, new CANNON.Cylinder(6.2, 6.3, .32, 20), [s.x, s.y + .16, s.z]); }
  for (let r = 0; r < 4; r++) for (let i = 0; i < 4 - r; i++) barrel(s.x - 7 + i * .9 + r * .45, s.z - 16, s.y + .56 + r * 1.1);
  const pole = new THREE.Mesh(cylGeo, M.steel); pole.scale.set(.1, 9, .1); pole.position.set(s.x + 6, s.y + 4.5, s.z + 15); const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshLambertMaterial({ map: TEX.flag, side: THREE.DoubleSide })); fl.position.set(s.x + 7.5, s.y + 8, s.z + 15); town.add(shadow(pole), fl);
  // Boulder Farm: the boulders sit on a ledge just uphill, facing the farm, and the farm folk live on the runout
  const f = poi('farm');
  for (let i = 0; i < 4; i++) stall(f.x - 10 + i * 6.5, f.z - 6); for (let i = 0; i < 8; i++) fence(f.x - 12 + i * 3, f.z + 14); for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) crate(f.x + 8 + i * 1.02, gy(f.x + 8, f.z + 4) + .5 + j, f.z + 4);
  for (let i = 0; i < 4; i++) haystack(f.x - 14 + i * 4, f.z + 8);
  { const L = LEDGE, px = -L.uz, pz = L.ux; for (let i = 0; i < 7; i++) { const o = (i - 3) * 1.9, x = L.x + px * o - L.ux * (i % 2) * 1.6, z = L.z + pz * o - L.uz * (i % 2) * 1.6, r = rnd(1.3, 2); addThing({ kind: 'boulder', name: 'Boulder', mass: 900 * r, mesh: new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), M.boulder), pos: [x, gy(x, z) + r + .05, z], shape: new CANNON.Sphere(r), asleep: true, damp: .02, adamp: .05 }); }
    const sx = L.x - L.ux * 6 + px * 6, sz = L.z - L.uz * 6 + pz * 6, sign = signPost('BOULDERS ↓', '#7a5a2a'); sign.position.set(sx, gy(sx, sz), sz); sign.rotation.y = Math.atan2(-L.ux, -L.uz); town.add(sign); }
  // roadside stops between places
  for (const st of STOPS) buildStop(st);
}
let HAY_GEO = null;
function haystack(x, z) {
  const y = gy(x, z), geo = HAY_GEO || (HAY_GEO = (() => { const gg = new THREE.SphereGeometry(1, 16, 10), a = gg.attributes.position; for (let i = 0; i < a.count; i++) { let px = a.getX(i), py = a.getY(i), pz = a.getZ(i); const n = 1 + Math.sin(px * 5.1 + pz * 3.7) * .05 + Math.sin(py * 7.3 + px * 2.1) * .04; py = py < -.25 ? -.25 : py; a.setXYZ(i, px * 1.05 * n, (py + .25) * 1.05 * n - .75, pz * 1.05 * n); } gg.computeVertexNormals(); return gg; })());
  const m = new THREE.Mesh(geo, M.straw); m.rotation.y = rnd(0, 6.3); m.scale.set(rnd(.95, 1.1), rnd(.9, 1.05), rnd(.95, 1.1)); const g = new THREE.Group(); g.add(m);
  return addThing({ kind: 'hay', name: 'Haystack', verb: 'scattered', pts: 60, mass: 40, mesh: g, pos: [x, y + .76, z], shape: new CANNON.Cylinder(1, 1, 1.5, 10), asleep: true });
}
function cart(x, z, yaw) {
  const y = gy(x, z), g = new THREE.Group(), bed = new THREE.Mesh(boxGeo(1.6, .5, 2.6), M.wood); bed.position.y = .1; g.add(bed);
  for (const sx of [-.9, .9]) for (const sz of [-.8, .8]) { const w = new THREE.Mesh(cylGeo, M.wood2); w.scale.set(.42, .12, .42); w.rotation.z = Math.PI / 2; w.position.set(sx, -.25, sz); g.add(w); }
  const hay = new THREE.Mesh(boxGeo(1.4, .5, 2.2), M.hay); hay.position.y = .55; g.add(hay);
  return addThing({ kind: 'cart', name: 'Cart', verb: 'flipped', pts: 80, mass: 160, mesh: g, pos: [x, y + .7, z], q: new THREE.Quaternion().setFromAxisAngle(_Y, yaw), shape: new CANNON.Box(CV(.85, .6, 1.3)), asleep: true });
}
// a wooden sign on a post, readable from both sides
function signPost(text, col = '#5a3a1a') {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; const g = cv.getContext('2d'); g.fillStyle = '#c9a26a'; g.fillRect(0, 0, 512, 160); g.strokeStyle = col; g.lineWidth = 12; g.strokeRect(6, 6, 500, 148);
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(90,60,30,.12)'; g.fillRect(0, 20 + i * 24, 512, 3); }
  g.fillStyle = col; g.font = 'bold 60px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 84);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; const face = lam({ map: tx });
  const grp = new THREE.Group(), board = new THREE.Mesh(boxGeo(2.6, .8, .08), [M.wood2, M.wood2, M.wood2, M.wood2, face, face]); board.position.y = 2.1;
  const post = new THREE.Mesh(boxGeo(.14, 2.4, .14), M.wood2); post.position.y = 1.2; grp.add(board, post); return shadow(grp);
}
// small things to do every ~150 m along the trails: a camp, an animal pen, or a stunt spot
const CAMPS = [];
function buildStop(st) {
  const { x, z, y, yaw } = st, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
  const at = (a, b) => [x + rx * a + fx * b, z + rz * a + fz * b];
  if (st.kind === 'camp') {
    const fire = new THREE.Group(); for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(cylGeo, M.bark); l.scale.set(.09, .9, .09); l.rotation.set(1.2, i * 1.26, 0); fire.add(l); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.6, .14, 6, 12), M.rock); ring.rotation.x = Math.PI / 2; fire.add(ring); fire.position.set(x, y + .1, z); town.add(shadow(fire));
    const lt = new THREE.PointLight(0xff9a40, 6, 14, 1.8); lt.position.set(x, y + 1, z); town.add(lt); CAMPS.push({ x, y, z, lt });
    for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28 + .5, lx = x + Math.cos(a) * 2.3, lz = z + Math.sin(a) * 2.3; const log = new THREE.Mesh(cylGeo, M.bark); log.scale.set(.25, 1.6, .25); log.rotation.set(0, -a, Math.PI / 2); log.position.set(lx, gy(lx, lz) + .25, lz); town.add(shadow(log)); }
    const [tx, tz] = at(4.5, -2); tentAt(tx, tz, yaw + .4); barrel(...at(-4, 2)); barrel(...at(-4.6, 2.9)); { const [a, b] = at(-3.4, 3.4); crate(a, gy(a, b) + .5, b); }
  } else if (st.kind === 'pen') {
    for (let i = -2; i <= 2; i++) { const [a, b] = at(i * 3, 5), [c, d] = at(i * 3, -5); fence(a, b); if (i) fence(c, d); }
    for (const sx of [-7.5, 7.5]) for (let j = -1; j <= 1; j++) { const [a, b] = at(sx, j * 3); fence(a, b, true); }
    for (let i = 0; i < 3; i++) haystack(...at(-3 + i * 3, 0)); cart(...at(10, 2), yaw + 1.2);
  } else {
    const [a, b] = at(0, -3); ramp(a, b, yaw + Math.PI, 9, 4.5, 2.6, gy(a, b)); tramp(...at(-5, 4)); tramp(...at(5, 4), true);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) { const [c, d] = at(-1 + i * .9 + r * .45, 7); barrel(c, d, gy(c, d) + .56 + r * 1.1); }
    cart(...at(-8, -2), yaw + .3);
  }
  const [sx2, sz2] = at(-6, -6), sign = signPost(poi(st.to).name.split(' ')[0].toUpperCase() + ' →'); sign.position.set(sx2, gy(sx2, sz2), sz2); sign.rotation.y = yaw; town.add(sign);
}
function tentAt(x, z, yaw) {
  const y = gy(x, z), g = new THREE.Group(), L = 3.2, H = 2, Wd = 1.7, sl = Math.hypot(H, Wd), a = Math.atan2(Wd, H);
  for (const sd of [-1, 1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(sl + .15, L), M.canvasO); pl.rotation.set(-Math.PI / 2, 0, 0); const w = new THREE.Group(); w.add(pl); pl.position.x = sd * sl / 2; w.rotation.z = sd * (Math.PI / 2 - a) * -1; w.position.y = H; g.add(w); }
  const ridge = new THREE.Mesh(boxGeo(.08, .08, L + .5), M.wood2); ridge.position.y = H + .02; g.add(ridge);
  for (const ez of [-L / 2 - .1, L / 2 + .1]) { const post = new THREE.Mesh(boxGeo(.08, H, .08), M.wood2); post.position.set(0, H / 2, ez); g.add(post); }
  g.position.set(x, y, z); g.rotation.y = yaw; town.add(shadow(g)); addStatic(null, new CANNON.Box(CV(1.4, 1, 1.6)), [x, y + 1, z], new THREE.Quaternion().setFromAxisAngle(_Y, yaw));
}
// launch cannons: walk into one and get fired across the map
function addCannon(x, z, to, label) {
  const y = gy(x, z), tgt = poi(to), yaw = Math.atan2(tgt.x - x, tgt.z - z), g = new THREE.Group();
  const base = new THREE.Mesh(boxGeo(2.6, .8, 3.2), M.cart); base.position.y = .4; g.add(base);
  for (const sx of [-1.4, 1.4]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(cylGeo, M.wood2); w.scale.set(.6, .2, .6); w.rotation.z = Math.PI / 2; w.position.set(sx, .55, sz); g.add(w); }
  const barrelM = new THREE.Mesh(new THREE.CylinderGeometry(.75, 1.0, 4.2, 18, 1, true), M.iron); barrelM.material = M.iron; barrelM.rotation.x = Math.PI / 2 - .7; barrelM.position.set(0, 2, .6); g.add(barrelM);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(.8, .14, 8, 18), M.band); rim.position.set(0, 2 + Math.sin(.7) * 2.05 * 0 + 1.3, 2.2); rim.rotation.x = -.7 + Math.PI / 2 - Math.PI / 2; g.add(rim);
  const sg = signPost(label.length > 9 ? label : 'TO ' + label, '#8a1c14'); sg.position.set(3.9, 0, -1.6); sg.rotation.y = Math.PI; sg.scale.setScalar(1.15); g.add(sg);
  g.position.set(x, y, z); g.rotation.y = yaw; shadow(g); town.add(g);
  addStatic(null, new CANNON.Box(CV(1.3, .4, 1.6)), [x, y + .4, z], new THREE.Quaternion().setFromAxisAngle(_Y, yaw));
  cannons.push({ x: x - Math.sin(yaw) * 2.6, z: z - Math.cos(yaw) * 2.6, to, cd: 0, mx: x + Math.sin(yaw) * 2.2, my: y + 3.3, mz: z + Math.cos(yaw) * 2.2 });
}
function buildScenery() {
  scene.add(TR.makeMesh({ grass: BMT.grass_1, dirt: BMT.dirt_1, rock: BMT.stone }));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(TR.W, TR.W), new THREE.MeshLambertMaterial({ color: 0x3f93d8, transparent: true, opacity: .78 })); water.rotation.x = -Math.PI / 2; water.position.y = TR.WATER; scene.add(water);
  const rr = (a, b, r) => { const s = new THREE.Path(); s.moveTo(-a + r, -b); s.lineTo(a - r, -b); s.absarc(a - r, -b + r, r, -Math.PI / 2, 0, false); s.lineTo(a, b - r); s.absarc(a - r, b - r, r, 0, Math.PI / 2, false); s.lineTo(-a + r, b); s.absarc(-a + r, b - r, r, Math.PI / 2, Math.PI, false); s.lineTo(-a, -b + r); s.absarc(-a + r, -b + r, r, Math.PI, Math.PI * 1.5, false); return s; };
  const sh = new THREE.Shape(rr(RA + 3.6, RB + 3.6, RR + 3.6).getPoints(10)); sh.holes.push(new THREE.Path(rr(RA - 3.6, RB - 3.6, RR - 3.6).getPoints(10)));
  const road = new THREE.Mesh(new THREE.ShapeGeometry(sh), lam({ color: 0x4a4e58 })); road.rotation.x = -Math.PI / 2; road.position.y = .02; road.receiveShadow = true; scene.add(road);
  const nd = Math.floor(PER / 5), dash = new THREE.InstancedMesh(boxGeo(.25, .02, 1.8), new THREE.MeshBasicMaterial({ color: 0xfff4c0 }), nd), dmx = new THREE.Matrix4(), dq = new THREE.Quaternion();
  for (let i = 0; i < nd; i++) { const p = pathAt(i * 5); dq.setFromAxisAngle(_Y, Math.atan2(p.dx, p.dz)); dash.setMatrixAt(i, dmx.compose(V3(p.x, .035, p.z), dq, V3(1, 1, 1))); } scene.add(dash);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 40), lam({ map: texRep('stone', 5, 5) })); plaza.rotation.x = -Math.PI / 2; plaza.position.y = .025; plaza.receiveShadow = true; scene.add(plaza);
  const lane = new THREE.Mesh(boxGeo(22, .05, 3.2), lam({ map: texRep('wood2', 8, 1) })); lane.position.set(-17, .025, 15); lane.receiveShadow = true; scene.add(lane);
  // dirt trails from town to each place, drawn as ribbons over the terrain
  const trailM = new THREE.MeshLambertMaterial({ map: BMT.dirt_2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const p of POI) {
    if (p.id === 'town') continue; const n = 90, pts = trailPts(p, n);
    const pos = [], uv = [], idx = [];
    pts.forEach(([x, z], i) => { const [x2, z2] = pts[Math.min(i + 1, n)], [x0, z0] = pts[Math.max(i - 1, 0)], dx = x2 - x0, dz = z2 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 1.8, nz = dx / l * 1.8; for (const s of [-1, 1]) { const px = x + nx * s, pz = z + nz * s; pos.push(px, gy(px, pz) + .06, pz); uv.push(s * .5 + .5, i * .6); } if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, trailM); m.receiveShadow = true; scene.add(m);
  }
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: .92 }); for (let i = 0; i < 40; i++) { const c = new THREE.Group(); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(sphGeo, cm); b.scale.set(rnd(14, 30), rnd(5, 9), rnd(10, 20)); b.position.set(rnd(-25, 25), rnd(-3, 3), rnd(-12, 12)); c.add(b); } c.position.set(rnd(-1100, 1100), rnd(190, 280), rnd(-1100, 1100)); scene.add(c); }
}
function buildTown() {
  const hm = [M.brick, M.brickA, M.brickB, M.brickC, M.brickD];
  [[-28, -40], [-8, -40], [14, -40], [-22, 40], [6, 40]].forEach(([x, z], i) => house(x, z, hm[i], M.roofs[i]));
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
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), lam({ map: texRep('rug', 2, 1) }));
  addThing({ kind: 'ball', name: 'Ball', mass: 150, mesh: ball, pos: [-25, 1.06, 15], shape: new CANNON.Sphere(1.05), asleep: true });
  for (let i = 0; i < 4; i++) for (let j = 0; j <= i; j++) { const g = new THREE.Group(), a = new THREE.Mesh(cylGeo, M.white); a.scale.set(.17, .9, .17); const b = new THREE.Mesh(cylGeo, M.red); b.scale.set(.18, .12, .18); b.position.y = .2; const h = new THREE.Mesh(sphGeo, M.white); h.scale.setScalar(.15); h.position.y = .48; g.add(a, b, h); addThing({ kind: 'pin', name: 'Pin', mass: 3, mesh: g, pos: [-11 + i * .8, .46, 15 + (j - i / 2) * .8], shape: new CANNON.Box(CV(.15, .45, .15)), asleep: true }); }
  addStatic(new THREE.Mesh(boxGeo(6, 22, 6), lam({ map: texRep('stone', 3, 11) })), new CANNON.Box(CV(3, 11, 3)), [52, 11, -4]);
  addStatic(new THREE.Mesh(boxGeo(9, .6, 9), lam({ map: texRep('wood2', 3, 3) })), new CANNON.Box(CV(4.5, .3, 4.5)), [52, 22.3, -4]);
  const pole = new THREE.Mesh(cylGeo, M.steel); pole.scale.set(.08, 5, .08); pole.position.set(55.5, 25.1, -7.5); const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), new THREE.MeshLambertMaterial({ map: TEX.flag, side: THREE.DoubleSide })); flag.position.set(54.1, 26.7, -7.5); town.add(shadow(pole), flag);
  barrel(50, -2, 23.16); barrel(50.9, -2.2, 23.16); crate(54, 23.1, -2);
  ramp(-48, 0, Math.PI / 2, 12, 6, 4); ramp(0, -32.5, 0, 9, 4, 2.6);
  const mx = -20, mz = -11; const mt = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.9, 8, 12), lam({ map: texRep('stone', 4, 3) })); addStatic(mt, new CANNON.Box(CV(1.4, 4, 1.4)), [mx, 4, mz]);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2, 12), M.roofs[0]); cap.position.set(mx, 9, mz); town.add(shadow(cap));
  const bl = new THREE.Group(); bl.add(new THREE.Mesh(boxGeo(.9, 11.2, .12), M.wood2), new THREE.Mesh(boxGeo(11.2, .9, .12), M.wood2)); const hub = new THREE.Mesh(sphGeo, M.red); hub.scale.setScalar(.45); bl.add(hub); shadow(bl); town.add(bl);
  const mb = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL }); mb.addShape(new CANNON.Box(CV(.45, 5.6, .08))); mb.addShape(new CANNON.Box(CV(5.6, .45, .08)));
  mb.position.set(mx, 6.6, mz + 1.9); mb.angularVelocity.set(0, 0, 1.5); mb.hazard = 'mill'; world.addBody(mb); hazards.push({ body: mb, mesh: bl });
  const ax = 17, ay = 13, az = -13, L = 11.4, th = 1.0;
  addStatic(new THREE.Mesh(boxGeo(1, 14.4, 1), M.steel), new CANNON.Box(CV(.5, 7.2, .5)), [ax, 7.2, az - 5]);
  const arm = new THREE.Mesh(boxGeo(.7, .7, 6), M.steel); arm.position.set(ax, 13.9, az - 2.3); town.add(shadow(arm));
  const anchor = new CANNON.Body({ mass: 0, collisionFilterGroup: 0, collisionFilterMask: 0 }); anchor.position.set(ax, ay, az); world.addBody(anchor);
  const wb = new CANNON.Body({ mass: 500, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: ALL, linearDamping: 0, angularDamping: 0, allowSleep: false }); wb.addShape(new CANNON.Sphere(1.3));
  wb.position.set(ax + L * Math.sin(th), ay - L * Math.cos(th), az); wb.quaternion.setFromEuler(0, 0, th); wb.hazard = 'ball'; world.addBody(wb);
  world.addConstraint(new CANNON.PointToPointConstraint(anchor, CV(0, 0, 0), wb, CV(0, L, 0), 1e7));
  const wm = new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12), lam({ map: TEX.metal, color: 0x555a66 })); const chain = new THREE.Mesh(cylGeo, M.black); town.add(shadow(wm), chain);
  hazards.push({ body: wb, mesh: wm, chain, anchor: V3(ax, ay, az), ball: true });
  [0xe2334b, 0x2f6fff, 0xffd23f, 0x2aa84a].forEach((c, i) => addCar(i * PER / 4 + 6, c));
  // cannons out of town, and back again
  addCannon(62, -34, 'village', 'BELLMOURN'); addCannon(-62, -36, 'hamlet', 'HAMLET'); addCannon(-62, 38, 'summit', 'YEET SUMMIT'); addCannon(60, 42, 'farm', 'BOULDER FARM');
  for (const id of ['village', 'hamlet', 'summit', 'farm']) { const p = poi(id), a = Math.atan2(-p.x, -p.z), r = id === 'summit' ? 14 : id === 'village' ? 50 : 26; addCannon(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 'town', 'TOWN'); }
  // and between the outlying places, so a run can chain without walking home
  for (const [from, to, label] of [['village', 'farm', 'BOULDER FARM'], ['farm', 'village', 'BELLMOURN'], ['hamlet', 'summit', 'YEET SUMMIT'], ['summit', 'hamlet', 'HAMLET']]) { const p = poi(from), q = poi(to), a = Math.atan2(q.x - p.x, q.z - p.z), r = from === 'summit' ? 18 : from === 'village' ? 52 : 28; addCannon(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, to, label); }
}
const SPAWNS = [[-6, 4], [6, -5], [12, 14], [-16, 8], [-20, -2], [22, -6], [2, 16], [-4, -14], [26, 14], [-26, 12], [42, 10], [-44, 14], [10, -34], [-14, 34], [40, -30], [-42, -22], [20, 36], [-2, -4]];
const FOLKS = () => Object.keys(FOLK).filter(k => MODELS[k]);
function spawnNPCs() {
  const kinds = ['louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot', 'louis_g', 'apricot'].filter(k => MODELS[k]);
  kinds.forEach((k, i) => npcs.push(makeChar(k, SPAWNS[i][0], SPAWNS[i][1], { home: { x: 0, z: 0, r: 58 } })));
  const fk = FOLKS(); fk.slice(0, 5).forEach((k, i) => npcs.push(makeChar(k, SPAWNS[10 + i][0], SPAWNS[10 + i][1], { home: { x: 0, z: 0, r: 58 } })));
  if (MODELS.apricot) { const a = makeChar('apricot', 52, -5, { y: 22.6, name: 'Tower Apricot' }); a.ai.wait = 1e9; npcs.push(a); }
  if (!fk.length) return;
  let n = 0; const folk = () => fk[n++ % fk.length];
  const place = (cx, cz, cnt, r, o = {}) => { for (let i = 0; i < cnt; i++) { const a = rnd(0, 6.3), d = rnd(2, r * .8), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d; npcs.push(makeChar(folk(), x, z, { home: { x: cx, z: cz, r }, ...o })); } };
  const P = id => poi(id);
  place(P('village').x, P('village').z, 10, 34, { walk: 'Walk_Formal_Loop' }); place(P('hamlet').x, P('hamlet').z, 6, 22);
  place(P('farm').x + LEDGE.ux * 22, P('farm').z + LEDGE.uz * 22, 6, 16); place(P('summit').x, P('summit').z, 6, 12);
  // camps: folk standing round the fire, talking
  for (const st of STOPS) {
    if (st.kind === 'camp') for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28 + 1.5, x = st.x + Math.cos(a) * 3, z = st.z + Math.sin(a) * 3; const c = makeChar(folk(), x, z, { home: { x: st.x, z: st.z, r: 5 }, idle: pick(['Idle_Talking_Loop', 'Idle_FoldArms_Loop', 'Idle_Loop']), yaw: Math.atan2(st.x - x, st.z - z) }); c.ai.wait = rnd(8, 30); c.homebody = true; npcs.push(c); }
    else place(st.x, st.z, 2, 8);
  }
  // walkers going up and down the trails in little groups
  for (const id of ['village', 'farm', 'hamlet']) { const pts = trailPts(P(id), 45); for (let g = 0; g < 3; g++) { const i0 = 10 + g * 2, [x, z] = pts[i0]; const c = makeChar(folk(), x + g, z, { home: { x, z, r: 400 } }); c.route = pts; c.ri = i0; c.rdir = 1; c.ai.spd = 1.6; npcs.push(c); } }
}
function buildAll() {
  newWorldVars(); newWorld(); buildTown(); buildOutlands(); buildForest();
  villagePhysics();
  player = makeChar(MODELS.martleboro ? 'martleboro' : Object.keys(MODELS)[0], 0, 5, { player: true, yaw: Math.PI, name: 'Martlebrough' }); player.peakY = 0;
  spawnNPCs(); spawnBeasts(); placeSwords(); G3.player = player; G3.npcs = npcs; G3.world = world; G3.things = things; G3.cars = cars; G3.forest = forest;
}
function newWorldVars() { town = new THREE.Group(); scene.add(town); things = []; debris = []; npcs = []; cars = []; groups = []; timers = []; later = []; hazards = []; cannons = []; beasts = []; pickups = []; CAMPS.length = 0; grab = null; T = 0; Object.assign(S, { score: 0, combo: 1, comboT: -9, obj: {}, pins: 0, limbs: 0, kills: 0, chain: { n: 0, t: -9 }, seen: {} }); hudDirty = true; }
function resetWorld() {
  for (const c of allChars()) c.inst.dispose(); scene.remove(town); tongue.visible = false; clearFx(); $('#feed').innerHTML = '';
  buildAll(); drawObj(); camT.set(0, 1.3, 5); feed('Town reset. Go again.', 0, true);
}

// ---------- input ----------
const keys = {}; const cam = { yaw: 0, pitch: .22, dist: 4.6, distT: 4.6, lastLook: -9, fov: 60, fovPunch: 0 }, camT = V3(0, 1.3, 5);
const SENS = { mouse: .0023, invert: false };
addEventListener('keydown', e => {
  if (e.repeat) return; keys[e.code] = true; if (!started) { if (e.code === 'Enter') start(); return; }
  if (e.code === 'Space') { e.preventDefault(); player.jumpBuf = .15; }
  else if (e.code === 'KeyE') heavy(); else if (e.code === 'KeyF') tryGrab(); else if (e.code === 'KeyQ') grenade();
  else if (e.code === 'KeyC' || e.code === 'ControlLeft') roll();
  else if (e.code === 'KeyX') toggleRag(); else if (e.code === 'KeyT') dropSword(player); else if (e.code === 'KeyG') slowmo(); else if (e.code === 'KeyR') resetWorld();
  else if (e.code === 'KeyM') { $('#map').classList.toggle('big'); }
  else if (e.code === 'KeyH' || e.code === 'F1') { e.preventDefault(); showHelp(true); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const locked = () => document.pointerLockElement === canvas;
function lock() { try { const r = canvas.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { canvas.requestPointerLock(); } catch (e) { } }); } catch (err) { } }
canvas.addEventListener('mousedown', e => { if (!started) return; if (!locked()) { lock(); return; } if (e.button === 0) attack(); else if (e.button === 2) heavy(); });
addEventListener('mousemove', e => { if (!started) return; if (locked()) { cam.yaw -= e.movementX * SENS.mouse; cam.pitch = clamp(cam.pitch + e.movementY * SENS.mouse * (SENS.invert ? -1 : 1), -.55, 1.3); if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) cam.lastLook = T; } });
addEventListener('wheel', e => { cam.distT = clamp(cam.distT * (e.deltaY > 0 ? 1.12 : .89), 2.6, 16); }, { passive: true });
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => { $('#clickhint').style.display = started && !locked() && $('#help').style.display === 'none' ? 'block' : 'none'; });
function showHelp(v) { $('#help').style.display = v ? 'flex' : 'none'; if (v && document.exitPointerLock) document.exitPointerLock(); }
function start() { if (!player) return; started = true; showHelp(false); lock(); if (!AC) initAudio(); if (AC && AC.state === 'suspended') AC.resume(); }
function slowmo() { timeScale = timeScale === 1 ? .25 : 1; $('#slow').style.display = timeScale === 1 ? 'none' : 'block'; $('#bslow').classList.toggle('on', timeScale !== 1); }
$('#go').onclick = start; $('#bhelp').onclick = () => showHelp(true); $('#bslow').onclick = e => { slowmo(); e.target.blur(); }; $('#breset').onclick = e => { resetWorld(); e.target.blur(); };
$('#sens').oninput = e => { SENS.mouse = .0008 + e.target.value * .00006; }; $('#inv').onchange = e => { SENS.invert = e.target.checked; };
// gamepad
const pad = { mx: 0, mz: 0, lx: 0, ly: 0, sprint: false, jet: false, prev: [], on: false };
function pollPad(dt) {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g && g.connected) : null; pad.on = !!gp; if (!gp) { pad.mx = pad.mz = 0; return; }
  const dz = v => Math.abs(v) < .16 ? 0 : (v - Math.sign(v) * .16) / .84;
  pad.mx = dz(gp.axes[0]); pad.mz = -dz(gp.axes[1]); pad.lx = dz(gp.axes[2]); pad.ly = dz(gp.axes[3]);
  const b = i => gp.buttons[i] && gp.buttons[i].pressed, edge = i => b(i) && !pad.prev[i];
  pad.sprint = b(10) || (gp.buttons[7] && gp.buttons[7].value > .3); pad.jet = gp.buttons[6] && gp.buttons[6].value > .3;
  if (started && player) {
    if (edge(0)) player.jumpBuf = .15; if (edge(2)) attack(); if (edge(1)) roll(); if (edge(3)) tryGrab(); if (edge(5)) heavy(); if (edge(4)) grenade(); if (edge(8)) toggleRag(); if (edge(9)) showHelp($('#help').style.display === 'none');
    player.jumpHeld = b(0) || keys.Space;
    if (pad.lx || pad.ly) { cam.yaw -= pad.lx * 2.8 * dt * Math.abs(pad.lx); cam.pitch = clamp(cam.pitch + pad.ly * 1.8 * dt, -.55, 1.3); cam.lastLook = T; }
  } else if (edge(0) || edge(9)) start();
  pad.prev = gp.buttons.map(x => x.pressed);
}


// ---------- wildlife: bm's gravehart grazing in the meadows. Hit one and it bellows, then charges ----------
let BEAST = null, beasts = [], pickups = [];
async function loadBeast() {
  const g = await new GLTFLoader().loadAsync('assets/bm/gravehart.glb'); BEAST = g;
  g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; const m = o.material; o.material = new THREE.MeshLambertMaterial({ map: m.map || null, color: m.map ? 0xffffff : m.color }); } });
  g.scene.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(g.scene); BEAST.size = bb.getSize(V3()); BEAST.min = bb.min.clone(); BEAST.ctr = bb.getCenter(V3());
}
const HERDS = [[150, -140], [-170, 110], [60, 190], [-210, -60], [250, 40], [-40, -230]];
function spawnBeasts() { if (!BEAST) return; for (const [hx, hz] of HERDS) for (let i = 0; i < 2; i++) beasts.push(makeBeast(hx + rnd(-10, 10), hz + rnd(-10, 10), { x: hx, z: hz, r: 40 })); G3.beasts = beasts; }
function makeBeast(x, z, home) {
  const root = skClone(BEAST.scene), sc = 2.5 / Math.max(BEAST.size.y, .01), g = new THREE.Group();
  root.scale.setScalar(sc); root.position.set(-BEAST.ctr.x * sc, -BEAST.min.y * sc, -BEAST.ctr.z * sc); g.add(root); town.add(g);
  const mixer = new THREE.AnimationMixer(root), acts = {}; for (const cl of BEAST.animations) acts[cl.name] = mixer.clipAction(cl);
  const hw = BEAST.size.x * sc / 2, hh = BEAST.size.y * sc / 2, hl = BEAST.size.z * sc / 2, b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: matDef, collisionFilterGroup: G_WORLD, collisionFilterMask: G_CHAR | G_RAG });
  b.addShape(new CANNON.Box(CV(hw * .7, hh * .75, hl * .8))); world.addBody(b);
  const B = { g, root, mixer, acts, cur: '', body: b, x, z, yaw: rnd(0, 6.3), home, state: 'roam', t: 0, tx: x, tz: z, wait: rnd(0, 4), hp: 100, hh, hl, cd: 0, spd: 0 };
  b.beast = B; playB(B, 'idle'); placeB(B, 0); return B;
}
function playB(B, name, fade = .25, once = false, rate = 1) {
  const a = B.acts[name]; if (!a) return; a.timeScale = rate; if (B.cur === name) return; const prev = B.acts[B.cur];
  a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once; a.play(); if (prev) a.crossFadeFrom(prev, fade, false); B.cur = name;
}
function placeB(B, h) { const y = gy(B.x, B.z); B.body.position.set(B.x, y + B.hh, B.z); B.body.quaternion.setFromEuler(0, B.yaw, 0); B.body.velocity.set(Math.sin(B.yaw) * B.spd, 0, Math.cos(B.yaw) * B.spd); B.g.position.set(B.x, y, B.z); B.g.rotation.set(0, B.yaw, 0); }
function angerB(B) { if (B.state === 'tumble' || B.state === 'bellow' || B.state === 'charge') return; B.state = 'bellow'; B.t = 0; B.spd = 0; playB(B, 'taunt_bellow', .15, true, 1.5); sfx('boom', .25); }
function tumbleB(B, vel, why) {
  if (B.state === 'tumble') return; B.state = 'tumble'; B.t = 0; const b = B.body; b.type = CANNON.Body.DYNAMIC; b.mass = 420; b.updateMassProperties(); b.collisionFilterMask = ALL; b.wakeUp();
  b.velocity.set(vel.x, vel.y, vel.z); b.angularVelocity.set(rnd(-4, 4), rnd(-2, 2), rnd(-4, 4)); playB(B, 'death', .1, true, 1.2);
  addScore(why || 'Gravehart sent flying', 300, true); objective('beast'); const p = b.position; blood(p.x, p.y, p.z, 0, 1, 0, 16, 5);
}
function beastsHit(o, fx, fz, mv, inCone) {
  let n = 0;
  for (const B of beasts) {
    if (B.state === 'tumble' || !inCone(B.body.position, B.hl * .7)) continue; n++; B.hp -= (mv.blade ? 22 : 13) * mv.power; B.x += fx * .35; B.z += fz * .35; B.flash = .07;
    if (B.hp <= 0 || mv.power >= 2.6) tumbleB(B, V3(fx * 9 * mv.power, 7 + mv.power * 2, fz * 9 * mv.power), mv.launch ? 'Gravehart uppercut' : null); else { angerB(B); addScore('Gravehart smacked', 40); }
  }
  return n;
}
function beastsBlast(x, z, r, s) { for (const B of beasts) { const p = B.body.position, dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d < r + B.hl * .6 && B.state !== 'tumble') tumbleB(B, V3(dx / (d || 1) * s, s * .7, dz / (d || 1) * s), 'Gravehart blown away'); } }
function beastTick(B, h) {
  const pp = charPos(player), dx = pp.x - B.x, dz = pp.z - B.z, dp = Math.hypot(dx, dz); B.far = dp > 260; if (B.far && B.state !== 'tumble') return;
  B.t += h; B.cd -= h; if (B.flash > 0) B.flash -= h;
  if (B.state === 'tumble') {
    const b = B.body; B.g.position.copy(b.position); B.g.quaternion.copy(b.quaternion); B.g.position.y -= B.hh; // pivot near the belly
    if (B.t > 9 && b.velocity.length() < 1) { // gets back up where it landed
      b.type = CANNON.Body.KINEMATIC; b.mass = 0; b.updateMassProperties(); b.collisionFilterMask = G_CHAR | G_RAG; B.x = b.position.x; B.z = b.position.z; B.hp = 100; B.state = 'roam'; B.wait = 2; B.spd = 0; playB(B, 'idle', .4); puff(B.x, gy(B.x, B.z) + 1, B.z, 10, 0xffffff, 2, .3);
    }
    if (b.position.y < -40) { B.x = B.home.x; B.z = B.home.z; B.t = 99; b.position.set(B.x, gy(B.x, B.z) + 3, B.z); b.velocity.set(0, 0, 0); }
    return;
  }
  // charges and shoulder barges
  if (player.charging > 0 && dp < B.hl + 1.2 && !player.rag) { tumbleB(B, V3(Math.sin(player.yaw) * 16, 10, Math.cos(player.yaw) * 16), 'Gravehart shoulder-barged'); hitFx(B.body.position, .12, .5, V3(Math.sin(player.yaw), 0, Math.cos(player.yaw))); return; }
  let want = 0;
  if (B.state === 'bellow') { const a = Math.atan2(dx, dz); B.yaw += angDiff(a, B.yaw) * (1 - Math.exp(-6 * h)); if (B.t > 1.25) { B.state = 'charge'; B.t = 0; playB(B, 'run_gallop', .15, false, 1.6); } }
  else if (B.state === 'charge') {
    const a = Math.atan2(dx, dz); B.yaw += clamp(angDiff(a, B.yaw), -2.2 * h, 2.2 * h); want = 10.5;
    for (const c of allChars()) { if (c.rag || c.gone || c.flight) continue; const q = c.body.position, ex = q.x - B.x, ez = q.z - B.z, d = Math.hypot(ex, ez); if (d < B.hl + .6 && Math.abs(q.y - (gy(B.x, B.z) + 1)) < 2.5) { knock(c, V3(Math.sin(B.yaw) * 15 + ex / (d || 1) * 4, 10, Math.cos(B.yaw) * 15 + ez / (d || 1) * 4), c.isPlayer ? 0 : 30, false); if (c.isPlayer) { hitFx(q, .1, .7, V3(Math.sin(B.yaw), 0, Math.cos(B.yaw))); addScore('Gored by a gravehart', 50); B.t = 9; } else addScore(`Gravehart bowled ${c.name}`, 120); } }
    if (B.t > 4 || (dp > 40 && B.t > 1.5)) { B.state = 'roam'; B.wait = rnd(2, 4); B.cd = 6; }
  }
  else { // roam
    if (B.wait > 0) { B.wait -= h; }
    else { const ex = B.tx - B.x, ez = B.tz - B.z, d = Math.hypot(ex, ez); if (d < 1.5) { B.wait = rnd(3, 9); const a = rnd(0, 6.3), r = rnd(0, B.home.r); B.tx = B.home.x + Math.cos(a) * r; B.tz = B.home.z + Math.sin(a) * r; } else { B.yaw += angDiff(Math.atan2(ex, ez), B.yaw) * (1 - Math.exp(-2.5 * h)); want = 1.7; } }
  }
  B.spd += (want - B.spd) * (1 - Math.exp(-(want > B.spd ? 3 : 6) * h));
  B.x += Math.sin(B.yaw) * B.spd * h; B.z += Math.cos(B.yaw) * B.spd * h; B.x = clamp(B.x, -BOUND, BOUND); B.z = clamp(B.z, -BOUND, BOUND);
  if (B.state === 'roam') playB(B, B.spd > .4 ? 'walk_roam' : 'idle', .35, false, B.spd > .4 ? B.spd / 1.7 : 1);
  placeB(B, h);
}
// swords from bm lying around: walk over one to pick it up, T drops it
let SWORDS = [];
async function loadSwords() {
  const L = new GLTFLoader();
  SWORDS = (await Promise.all(['gilded_sword', 'crimson_sword', 'arming_sword', 'bronze_broadsword'].map(n => L.loadAsync(`assets/bm/items/${n}.glb`).then(g => ({ n, scene: g.scene })).catch(() => null)))).filter(Boolean);
  for (const sw of SWORDS) { sw.scene.traverse(o => { if (o.isMesh) o.castShadow = true; }); const bb = new THREE.Box3().setFromObject(sw.scene); sw.min = bb.min.y; sw.len = bb.max.y - bb.min.y; sw.name = sw.n.replace(/_/g, ' '); }
}
function placeSwords() {
  if (!SWORDS.length) return; const spots = [[3, 1.5], [poi('village').x + 6, poi('village').z + 4], [poi('hamlet').x + 4, poi('hamlet').z + 4], [poi('summit').x - 4, poi('summit').z + 5], [poi('farm').x + 2, poi('farm').z + 2]];
  spots.forEach(([x, z], i) => { const sw = SWORDS[i % SWORDS.length], m = sw.scene.clone(), g = new THREE.Group(); m.position.y = -sw.min - sw.len * .25; g.add(m); g.rotation.z = Math.PI; g.scale.setScalar(1.25); const ring = new THREE.Mesh(new THREE.RingGeometry(.5, .7, 24), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .7, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; const y = gy(x, z); const holder = new THREE.Group(); const beam = new THREE.Mesh(new THREE.CylinderGeometry(.18, .32, 6, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); beam.position.y = 3.5; holder.add(g, ring, beam); ring.position.y = .03; g.position.y = sw.len * .7; holder.position.set(x, y, z); town.add(holder); pickups.push({ sw, x, z, y, holder, g, taken: false, t: 0 }); });
}
function equipSword(p, sw) {
  const B = p.bones, hand = B.RightHand; if (!hand) return; hand.updateWorldMatrix(true, true);
  const i1 = B.RightHandIndex1, p1 = B.RightHandPinky1, g = new THREE.Group(), m = sw.scene.clone(); g.add(m);
  let across = V3(0, 0, 1), mid = V3();
  if (i1 && p1) { const li = hand.worldToLocal(i1.getWorldPosition(V3())), lp = hand.worldToLocal(p1.getWorldPosition(V3())); across = li.clone().sub(lp).normalize(); mid = li.clone().add(lp).multiplyScalar(.5); const fing = mid.clone().normalize(); mid.addScaledVector(fing, mid.length() * .35); }
  hand.add(g); g.position.copy(mid); g.quaternion.setFromUnitVectors(V3(0, 1, 0), across); g.scale.setScalar(1 / (hand.getWorldScale(V3()).x || 1));
  m.position.y = -(sw.min + sw.len * .12);
  p.sword = { g, sw }; feed(`Picked up the ${sw.name}. Click to slash, T to drop`, 0, true); sfx('whoosh', .6);
}
function dropSword(p) { if (!p.sword) return; p.sword.g.parent.remove(p.sword.g); p.sword = null; feed('Dropped the sword'); }
function pickupTick(h) {
  const p = player, q = charPos(p);
  for (const k of pickups) {
    k.t += h; if (k.taken) { if (!p.sword || p.sword.sw !== k.sw) { k.away = (k.away || 0) + h; if (k.away > 20) { k.taken = false; k.holder.visible = true; k.away = 0; } } continue; }
    k.g.rotation.y = k.t * 1.4; k.g.position.y = k.sw.len * .7 + Math.sin(k.t * 2.2) * .12;
    if (!p.sword && !p.rag && !p.flight && Math.hypot(q.x - k.x, q.z - k.z) < 1.6 && Math.abs(q.y - .76 - k.y) < 2) { k.taken = true; k.holder.visible = false; equipSword(p, k.sw); }
  }
}
// onboarding: a bobbing arrow over the nearest cannon until you ride one, and a compass strip
const wayArrow = new THREE.Mesh(new THREE.ConeGeometry(.9, 2.2, 4), new THREE.MeshBasicMaterial({ color: 0xffd23f, fog: false })); wayArrow.rotation.x = Math.PI; wayArrow.visible = false; scene.add(wayArrow);
let hintOn = false, compT = 0;
function nearestCannon() { const q = charPos(player); let best = null, bd = 1e9; for (const cn of cannons) { const d = Math.hypot(cn.x - q.x, cn.z - q.z); if (d < bd) { bd = d; best = cn; } } return best; }
function onboarding(dt) {
  const done = OBJ.filter(o => S.obj[o[0]]).length, want = !S.obj.cannon && (T > 45 || done >= 3);
  if (want && !hintOn) feed('Try a cannon! Follow the yellow arrow', 0, true); hintOn = want;
  const cn = want ? nearestCannon() : null; wayArrow.visible = !!cn;
  if (cn) { wayArrow.position.set(cn.x, gy(cn.x, cn.z) + 6.5 + Math.sin(T * 3) * .5, cn.z); wayArrow.rotation.y += dt * 2; }
  compT -= dt; if (compT > 0) return; compT = .08;
  const el = $('#compass'); if (!el) return; const q = charPos(player), fwdA = cam.yaw + Math.PI, W2 = el.clientWidth || 420, items = [];
  const add = (x, z, label, col, cls) => { const a = angDiff(Math.atan2(x - q.x, z - q.z), fwdA), px = W2 / 2 - a / 1.6 * (W2 / 2); if (Math.abs(a) > 1.6) return; items.push(`<span class="${cls || ''}" style="left:${px | 0}px;color:${col}">${label}</span>`); };
  for (const [l, a] of [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['W', -Math.PI / 2]]) add(q.x + Math.sin(a) * 100, q.z + Math.cos(a) * 100, l, '#ffffffaa', 'cd');
  for (const p of POI) { if (p.id === 'town' && Math.hypot(q.x, q.z) < 90) continue; const d = Math.hypot(p.x - q.x, p.z - q.z) | 0; add(p.x, p.z, S.seen[p.id] ? `${p.name} ${d}m` : `? ${d}m`, p.icon, !S.seen[p.id] && d < 200 ? 'un' : ''); }
  if (cn) add(cn.x, cn.z, '▼ cannon', '#ffd23f', 'cn');
  el.innerHTML = items.join('');
}

// ---------- player actions ----------
function toggleRag() { const p = player; if (p.rag) { if (p.ragT > .4) standUp(p); } else { ragdoll(p, V3(Math.sin(p.yaw) * 3, 3, Math.cos(p.yaw) * 3)); p.manual = true; } }
// melee: 3-hit combo on click (jab, hook, launcher), heavy shoulder charge on E / right click
const MOVES = {
  jab: { clip: 'Punch_Cross', start: .1, end: .62, rate: 1.7, hit: .36, reach: 1.9, power: 1, lunge: 4 },
  hook: { clip: 'Melee_Hook', start: 0, end: .44, rate: 1.45, hit: .2, reach: 2.0, power: 1.2, lunge: 4.5 },
  launcher: { clip: 'Jump_Start', start: .04, end: .66, rate: 1.2, hit: .42, reach: 2.2, power: 3, lunge: 6, launch: true },
  charge: { clip: 'Shield_Dash', start: 0, end: .9, rate: 1.15, hit: .3, reach: 2.4, power: 2.6, lunge: 15, charge: .42 },
  swA: { clip: 'Sword_Regular_A', start: 0, end: .43, rate: .95, hit: .2, reach: 2.6, power: 1.3, lunge: 4, blade: true },
  swB: { clip: 'Sword_Regular_B', start: 0, end: .53, rate: .95, hit: .24, reach: 2.6, power: 1.5, lunge: 4.5, blade: true },
  swC: { clip: 'Sword_Dash', start: .03, end: .9, rate: 1.25, hit: .22, reach: 2.9, power: 2.8, lunge: 10, blade: true },
};
// soft lock: the input direction (or the camera when idle) picks the target, and a recent target stays picked
function aimAssist(p, range = 4.6) {
  const o = p.body.position, d = inputDir(), fx = d.len ? d.x : Math.sin(p.yaw), fz = d.len ? d.z : Math.cos(p.yaw); let best = null, bs = -1e9;
  for (const c of npcs) {
    if (c.gone || c.rag) continue; const q = c.body.position, dx = q.x - o.x, dz = q.z - o.z, dd = Math.hypot(dx, dz); if (dd > range || Math.abs(q.y - o.y) > 2) continue;
    const dot = (dx * fx + dz * fz) / (dd || 1); if (dot < 0 && dd > 1.2) continue;
    const sc = dot * 2 - dd / range + (p.lockC === c && T - p.lockT < 1.5 ? 1.2 : 0); if (sc > bs) { bs = sc; best = { c, d: dd, dx, dz }; }
  }
  if (best) { p.lockC = best.c; p.lockT = T; }
  return best;
}
function startMove(p, name) {
  const mv = MOVES[name]; p.atk = { name, mv, t: 0, hitDone: false, len: (mv.end - mv.start) / mv.rate, hitAt: (mv.hit - mv.start) / mv.rate };
  const tgt = aimAssist(p, name === 'charge' ? 7 : 4.6);
  p.yaw = tgt ? Math.atan2(tgt.dx, tgt.dz) : (inputDir().len ? Math.atan2(inputDir().x, inputDir().z) : p.yaw);
  const lunge = tgt ? Math.min(mv.lunge, Math.max(0, tgt.d - 1.1) * 6 + 1) : mv.lunge * .5;
  p.body.velocity.x = Math.sin(p.yaw) * lunge; p.body.velocity.z = Math.cos(p.yaw) * lunge;
  if (mv.charge) { p.charging = mv.charge; p.body.velocity.x = Math.sin(p.yaw) * mv.lunge; p.body.velocity.z = Math.cos(p.yaw) * mv.lunge; }
  p.an && p.an.play(mv.clip, { start: mv.start, end: mv.end, rate: mv.rate, fadeIn: .05, fadeOut: .14, upper: p.speed > 5 && !mv.charge && !mv.launch && !mv.blade });
  sfx('whoosh', .45);
}
function attack() {
  const p = player; if (p.flight) { p.flight.dive = true; return; } if (grab) { throwGrab(); return; } if (p.rag || p.lock > .2) return;
  if (p.atk && p.atk.t < p.atk.len * .55) { p.queued = true; return; }
  const n = (T - (p.comboT || -9) < .75) ? (p.comboN + 1) % 3 : 0; p.comboN = n; startMove(p, (p.sword ? ['swA', 'swB', 'swC'] : ['jab', 'hook', 'launcher'])[n]);
}
function heavy() { const p = player; if (grab) { throwGrab(); return; } if (p.rag || p.flight || p.lock > .2 || (p.atk && p.atk.mv.charge)) return; p.comboN = -1; startMove(p, 'charge'); }
function roll() {
  const p = player; if (!p.ground && !p.rag && !p.flight) { p.rollBuf = .15; return; } if (p.rag || p.flight || p.rollT > 0 || p.lock > .2) return; const d = inputDir();
  if (d.len) p.yaw = Math.atan2(d.x, d.z); p.rollT = .62; p.atk = null; p.carT = Math.max(p.carT, .62);
  p.an && p.an.play('Roll', { start: .08, end: 1.2, rate: 1.8, fadeIn: .05, fadeOut: .15 }); sfx('whoosh', .4); dust(p.body.position.x, p.body.position.z, 5, 1.6);
}
function hitFx(pos, stop, sh, dir, pitch = 1) {
  hitstop = Math.max(hitstop, stop); shake = Math.min(1, Math.max(shake, sh) + sh * .25); if (dir) kick.addScaledVector(dir, sh * .35);
  for (let i = 0; i < 8; i++) spawnP(pos.x, pos.y + .9, pos.z, rnd(-4, 4), rnd(1, 4), rnd(-4, 4), 0xfff2b0, rnd(.04, .09), rnd(.12, .25), 1);
  sample('impact', .5, .75 * pitch) || sfx('hit');
}
let slowT = 0, slowK = 1;
function slowFor(t, k) { slowT = Math.max(slowT, t); slowK = k; }
function doHit(p) {
  const a = p.atk, mv = a.mv, o = p.body.position, fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), dir = V3(fx, 0, fz); let n = 0;
  const inCone = (q, ext = 0) => { const dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz); return Math.abs(q.y - o.y) < 2.2 + ext && (d < 1.1 + ext || (d < mv.reach + .7 + ext && (dx * fx + dz * fz) / d > .3)); };
  const combo = (T - (p.comboT || -9) < .9 ? (p.comboHits || 0) : 0);
  for (const c of npcs.slice()) {
    if (c.gone || !inCone(charPos(c))) continue; n++;
    const strong = mv.power >= 2 || c.hp < 25 || c.rag;
    if (strong) {
      const k = mv.power, up = mv.launch ? 13 : 4 + k * 2.4, fw = mv.launch ? 3.5 : 7 * k; knock(c, V3(fx * fw + rnd(-1, 1), up, fz * fw + rnd(-1, 1)), 18 * k, true); maybeSever(c, mv.blade ? .75 : mv.power > 2.5 ? .2 : .1, mv.blade ? V3(fx * 6, 5, fz * 6) : undefined);
      addScore(`${c.name} ${a.name === 'charge' ? 'flattened' : mv.launch ? 'launched' : mv.blade ? 'cut down' : 'dropped'}`, mv.launch ? 120 : 80, mv.launch); if ((mv.launch || a.name === 'swC') && p.comboHits >= 2) objective('finisher');
    } else {
      c.stagger = .5; c.body.velocity.x = fx * 6.8; c.body.velocity.z = fz * 6.8; c.faceT = p.yaw + Math.PI; c.flinch = .22; c.flinchSide = (combo % 2 ? 1 : -1) * .6; c.flashT = .14; hurt(c, (mv.blade ? 16 : 9) * mv.power);
      if (mv.blade) { maybeSever(c, .35, V3(fx * 5, 4, fz * 5)); const q = charPos(c); blood(q.x, q.y + .5, q.z, fx, .4, fz, 14, 5); }
      c.an && c.an.play(Math.random() < .5 ? 'Hit_Head' : 'Hit_Chest', { rate: 1.3, fadeIn: .03, fadeOut: .15 }); addScore(`${c.name} ${mv.blade ? 'slashed' : a.name === 'jab' ? 'jabbed' : 'hooked'}`, 30); scare(c.body.position.x, c.body.position.z, 10); c.panic = 0;
    }
  }
  n += beastsHit(o, fx, fz, mv, inCone);
  for (const t of things.slice()) { if (t.dead) continue; const big = t.kind === 'ball' || t.kind === 'boulder' ? 1.3 : (t.frozen && !t.pieces) ? .6 : .3; if (!inCone(t.body.position, big)) continue; n++; if (t.kind === 'ball' || t.kind === 'boulder') { const b = t.body, sp = t.kind === 'boulder' ? 7 : 15; b.wakeUp(); b.velocity.set(fx * sp * mv.power * .6, 1, fz * sp * mv.power * .6); b.angularVelocity.set(fz * 8, 0, -fx * 8); continue; } hitThing(t, CV(fx * 9 * mv.power, 4 * mv.power, fz * 9 * mv.power), 30 * mv.power); }
  for (const car of cars) if (inCone(car.body.position, 1.2) && mv.power >= 2) { n++; wreckCar(car, CV(fx * 14, 8, fz * 14), 'punted'); }
  n += forestHit(o.x + fx * 1.4, o.z + fz * 1.4, 1.4, 34 * mv.power, dir) || 0;
  if (n) {
    p.comboHits = combo + 1; const hp = V3(o.x + fx, o.y - .4, o.z + fz);
    if (mv.launch) { hitFx(hp, .16, .55, dir, 1.35); slowFor(.3, .5); cam.fovPunch = -6; p.body.velocity.y = Math.max(p.body.velocity.y, 5.5); }
    else hitFx(hp, mv.power >= 2 ? .11 : .06, mv.power >= 2 ? .42 : .2, dir, 1 + Math.min(combo, 3) * .12);
  }
  else p.comboHits = 0;
  p.comboT = T;
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
  for (const t of things) { if (t.dead || t.kind === 'grenade' || t.kind === 'boulder') continue; if (t.frozen ? (!t.pieces && t.tough <= 60) : true) test(t.body.position, { t }); }
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
function inputDir() {
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let mf = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0), mr = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  if (pad.mx || pad.mz) { mf = pad.mz; mr = pad.mx; }
  let x = fx * mf + rx * mr, z = fz * mf + rz * mr, len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; len = 1; } return { x: len ? x / len : 0, z: len ? z / len : 0, len };
}
// cannon flight: a scripted arc so long shots are reliable, ending in a ragdoll splat
function fire(c, cn) {
  const tgt = poi(cn.to); let tx, tz;
  // the player gets aimed at the biggest knot of people over there (the summit aims near the bullseye)
  const cand = c.isPlayer ? npcs.filter(n => !n.gone && !n.rag && Math.hypot(n.body.position.x - tgt.x, n.body.position.z - tgt.z) < 45) : [];
  let best = null, bn = 0; for (const n of cand) { const q = n.body.position; let k = 0; for (const m of cand) { const r = m.body.position; if (Math.hypot(q.x - r.x, q.z - r.z) < 7) k++; } if (k > bn) { bn = k; best = q; } }
  if (cn.to === 'summit' && c.isPlayer) { const a = rnd(0, 6.3), r = rnd(3, 7); tx = tgt.x + Math.cos(a) * r; tz = tgt.z + Math.sin(a) * r; }
  else if (best) { tx = best.x + rnd(-1.5, 1.5); tz = best.z + rnd(-1.5, 1.5); }
  else { const a = rnd(0, 6.3), r = rnd(4, 12); tx = tgt.x + Math.cos(a) * r; tz = tgt.z + Math.sin(a) * r; }
  const d = Math.hypot(tx - cn.mx, tz - cn.mz);
  c.flight = { x0: cn.mx, y0: cn.my, z0: cn.mz, x1: tx, z1: tz, T: clamp(d / 110, 2, 4), t: 0, apex: clamp(d * .16, 18, 70), ox: 0, oz: 0, to: cn.to };
  c.body.collisionFilterMask = 0; c.body.velocity.set(0, 0, 0); c.atk = null; c.rollBuf = 0; c.jumpBuf = 0;
  puff(cn.mx, cn.my, cn.mz, 26, 0xeeeeee, 5, .5); for (let i = 0; i < 20; i++) spawnP(cn.mx, cn.my, cn.mz, rnd(-6, 6), rnd(2, 9), rnd(-6, 6), pick([0xffd23f, 0xff8a1c]), rnd(.2, .5), rnd(.2, .5), 1);
  sfx('cannon'); if (c.isPlayer) { shake = Math.max(shake, .8); hitstop = .08; addScore(`Fired at ${tgt.name}`, 100, true); objective('cannon'); feed('Steer with WASD, Space bails out, click to dive'); }
}
function flightTick(c, h) {
  const f = c.flight;
  if (c.isPlayer) {
    const d = inputDir(); f.ox = clamp(f.ox + d.x * 16 * h, -25, 25); f.oz = clamp(f.oz + d.z * 16 * h, -25, 25); const ol = Math.hypot(f.ox, f.oz); if (ol > 25) { f.ox *= 25 / ol; f.oz *= 25 / ol; }
    if (c.jumpBuf > 0 && f.t > .25) { c.jumpBuf = 0; const v = c.body.velocity; endFlight(c, true); knock(c, V3(0, 0, 0), 0, false); for (const s in c.parts) c.parts[s].velocity.set(v.x, v.y, v.z); addScore('Bailed out', 50); return; }
  }
  f.t += h * (f.dive && f.t > f.T * .45 ? 1.9 : 1); const u = Math.min(1, f.t / f.T), b = c.body, x1 = f.x1 + f.ox, z1 = f.z1 + f.oz, y1 = gy(x1, z1) + .8;
  const x = f.x0 + (x1 - f.x0) * u, z = f.z0 + (z1 - f.z0) * u, y = f.y0 + (y1 - f.y0) * u + 4 * f.apex * u * (1 - u);
  const du = 1 / f.T, vx = (x1 - f.x0) * du, vz = (z1 - f.z0) * du, vy = ((y1 - f.y0) + 4 * f.apex * (1 - 2 * u)) * du;
  b.position.set(x, y, z); b.velocity.set(vx, vy, vz); c.yaw = Math.atan2(vx, vz); c.speed = 0;
  if (Math.random() < .5) spawnP(x, y - .3, z, rnd(-.5, .5), rnd(-.5, .5), rnd(-.5, .5), f.dive ? 0xffc070 : 0xc8c4bc, rnd(.1, .2), rnd(.4, .8), 2);
  if (u >= 1 || (u > .5 && y < gy(x, z) + .9)) endFlight(c, false);
}
function endFlight(c, quiet) {
  const f = c.flight; if (!f) return; c.flight = null; c.body.collisionFilterMask = G_WORLD | G_CHAR;
  if (quiet) return; const v = c.body.velocity, k = Math.min(1, 26 / (v.length() || 1)), b = c.body.position;
  b.y = Math.max(b.y, gy(b.x, b.z) + .9);
  knock(c, V3(v.x * k - v.x, v.y * k * .3 - v.y, v.z * k - v.z), 0, false); sfx('thud', .9); addScore(f.dive ? 'Dive bomb' : 'Cannonball landing', f.dive ? 300 : 200);
  // shockwave: everyone nearby goes over
  let hits = 0; const R = f.dive ? 8 : 6;
  for (const n of npcs.slice()) { if (n === c || n.gone) continue; const q = charPos(n), dx = q.x - b.x, dz = q.z - b.z, d = Math.hypot(dx, dz); if (d > R || Math.abs(q.y - b.y) > 3) continue; const s = (1 - d / R) * 10 + 6; knock(n, V3(dx / (d || 1) * s, 6 + s * .5, dz / (d || 1) * s), 20, true); hits++; }
  beastsBlast(b.x, b.z, R, 14);
  for (let i = 0; i < 28; i++) { const a = i / 28 * 6.28; spawnP(b.x + Math.cos(a) * .6, gy(b.x, b.z) + .1, b.z + Math.sin(a) * .6, Math.cos(a) * 9, rnd(.3, 1.2), Math.sin(a) * 9, pick([0xa8916c, 0x9c8462, 0xb8a582]), rnd(.35, .6), rnd(.5, .8), 4); }
  shockRing(b.x, b.z, R, .25); shockRing(b.x, b.z, R * .6, .4, 0xb8a582);
  if (c.isPlayer) {
    hitFx(V3(b.x, b.y - 1, b.z), .14, .9, null, .8); slowFor(.3, .4); if (hits) addScore(hits > 1 ? `Shockwave x${hits}` : 'Shockwave', hits * 120, hits >= 3);
    if (f.to === 'summit') { const s = poi('summit'), d = Math.hypot(b.x - s.x, b.z - s.z); if (d < 1.5) { addScore('BULLSEYE', 1500, true); banner('BULLSEYE!'); } else if (d < 6) addScore(`Target ring ${(6 - d).toFixed(1)} m in`, Math.round((6 - d) * 120), true); }
  }
}
function controlPlayer(h) {
  const p = player; p.jet = false; p.rollBuf = Math.max(0, (p.rollBuf || 0) - h); if (!p.flight) p.jumpBuf = Math.max(0, (p.jumpBuf || 0) - h);
  if (p.flight) { flightTick(p, h); return; }
  if (p.rag) {
    p.ragT += h; const pv = p.parts.pelvis; if (keys.KeyB || pad.jet) { const ch = p.parts.chest || pv; ch.wakeUp(); ch.velocity.y = Math.min(ch.velocity.y + 70 * h, 14); jetFx(ch.position); }
    const wants = inputDir().len > 0 || p.jumpBuf > 0;
    if (!p.manual && p.ragT > (wants ? 1.1 : 2.2) && pv.velocity.length() < (wants ? 3 : 1.5)) standUp(p); else if (!p.manual && p.ragT > 6) standUp(p);
    else if (p.manual && wants && p.ragT > .5) standUp(p);
    p.jumpBuf = 0; return;
  }
  p.manual = false; const b = p.body, d = inputDir();
  if (p.lock > 0) { p.lock -= h; if (d.len && p.lock < (p.isPlayer ? .45 : 0) && p.an) { p.an.stop(.18); p.lock = 0; } }
  const sprinting = keys.ShiftLeft || keys.ShiftRight || pad.sprint;
  const inWater = b.position.y - .76 < TR.WATER - .35;
  let top = sprinting ? 10.5 : 6.4; if (pad.on && d.len < .95 && !sprinting) top *= Math.max(.35, d.len); if (inWater) top *= .5; if (p.crippled) top *= .45;
  const busy = p.lock > 0 || p.rollT > 0 || (p.atk && !p.atk.mv.charge);
  // facing
  if (d.len > 0 && !p.atk && p.rollT <= 0 && p.lock <= 0) { const ty = Math.atan2(d.x, d.z), da = angDiff(ty, p.yaw), rate = p.ground ? (p.speed > 8 ? 9 : 15) : 6; const step = da * (1 - Math.exp(-rate * h)); p.yaw += step; p.turnRate = step / h; } else p.turnRate *= .8;
  // velocity
  let tx = 0, tz = 0;
  if (p.rollT > 0) { p.rollT -= h; tx = Math.sin(p.yaw) * 10.5; tz = Math.cos(p.yaw) * 10.5; }
  else if (p.charging > 0) { p.charging -= h; tx = Math.sin(p.yaw) * 15; tz = Math.cos(p.yaw) * 15; if (p.charging <= 0) p.charging = 0; }
  else if (!busy && d.len) { tx = d.x * top * Math.min(1, d.len * 1.4); tz = d.z * top * Math.min(1, d.len * 1.4); }
  const vx = b.velocity.x, vz = b.velocity.z, spd = Math.hypot(vx, vz);
  let accel = p.ground ? (Math.hypot(tx, tz) < spd - .1 ? 46 : 58) : 16; if (p.atk && !p.atk.mv.charge) accel = 22; if (p.rollT > 0 || p.charging > 0) accel = 90;
  // skid on hard reversals
  if (p.ground && spd > 7.5 && d.len && (vx * d.x + vz * d.z) / spd < -.4 && !busy) { accel = 30; if (Math.random() < .5) dust(b.position.x - vx * .05, b.position.z - vz * .05, 2, 1.5, .2); }
  let dvx = tx - vx, dvz = tz - vz; const dl = Math.hypot(dvx, dvz), mx = accel * h; if (dl > mx) { dvx *= mx / dl; dvz *= mx / dl; }
  if (d.len || p.ground || p.rollT > 0 || p.charging) { b.velocity.x += dvx; b.velocity.z += dvz; }
  // forward lean from acceleration
  const fwdAcc = ((b.velocity.x - (p.prevVx || 0)) * Math.sin(p.yaw) + (b.velocity.z - (p.prevVz || 0)) * Math.cos(p.yaw)) / h; p.prevVx = b.velocity.x; p.prevVz = b.velocity.z;
  p.pitchLean += (clamp(fwdAcc * .006, -.18, .22) + (sprinting && spd > 8 ? .12 : 0) - p.pitchLean) * (1 - Math.exp(-6 * h));
  // jumping: buffer + coyote + variable height + double jump flip
  p.airT = p.ground ? 0 : (p.airT || 0) + h;
  if (p.jumpBuf > 0 && p.lock <= .1 && p.rollT <= .1) {
    if (p.ground || p.airT < .13) { b.velocity.y = 9.8; p.jumps = 1; p.airT = .2; p.jumpBuf = 0; p.cut = false; sample('jump', .5) || sfx('boing', .25); dust(b.position.x, b.position.z, 5, 1.6); p.an && p.an.play('Jump_Start', { start: .32, end: .62, rate: 1.4, fadeIn: .04, fadeOut: .12 }); }
    else if (p.jumps < 2) { b.velocity.y = 9.2; p.jumps = 2; p.jumpBuf = 0; p.cut = false; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28; spawnP(b.position.x, b.position.y - .7, b.position.z, Math.cos(a) * 4, -.5, Math.sin(a) * 4, 0xffffff, rnd(.12, .2), rnd(.3, .45), 4); } sfx('whoosh', .35); shake = Math.max(shake, .12); p.an && p.an.play('Roll', { start: .12, end: .95, rate: 1.55, fadeIn: .05, fadeOut: .15 }); }
  }
  if (!p.ground && !p.cut && b.velocity.y > 3 && !(keys.Space || p.jumpHeld)) { b.velocity.y *= .55; p.cut = true; }
  // ground snap on slopes and crests (stops the bunny-hop off every bump)
  if (p.ground) p.snapT = .15; else p.snapT = (p.snapT || 0) - h;
  if (p.snapT > 0 && p.jumps === 0 && b.velocity.y < 2.5 && !p.jet) { const gd = b.position.y - .76 - gy(b.position.x, b.position.z); if (gd > .02 && gd < .5) b.velocity.y = Math.min(b.velocity.y, -gd * 25 - 1); }
  if (keys.KeyB || pad.jet) { p.jet = true; b.velocity.y = Math.min(b.velocity.y + 62 * h, 13); jetFx(b.position); }
  // attacks
  if (p.atk) { const a = p.atk; a.t += h; if (!a.hitDone && a.t >= a.hitAt) { a.hitDone = true; doHit(p); } if (a.charge && p.charging > 0) { } if (a.t >= a.len) { p.atk = null; if (p.queued) { p.queued = false; attack(); } } }
  if (p.charging > 0) { const o = b.position; for (const c of npcs) { if (c.rag || c.gone) continue; const q = c.body.position; if (Math.hypot(q.x - o.x, q.z - o.z) < 1.5 && Math.abs(q.y - o.y) < 1.6) { knock(c, V3(Math.sin(p.yaw) * 20, 9, Math.cos(p.yaw) * 20), 35, true); addScore(`${c.name} flattened`, 120); hitFx(q, .1, .45, V3(Math.sin(p.yaw), 0, Math.cos(p.yaw))); } } forestHit(o.x + Math.sin(p.yaw), o.z + Math.cos(p.yaw), 1.2, 120, V3(Math.sin(p.yaw), 0, Math.cos(p.yaw))); }
  // cannons
  for (const cn of cannons) { cn.cd -= h; if (cn.cd <= 0 && Math.hypot(b.position.x - cn.x, b.position.z - cn.z) < 1.7 && Math.abs(b.position.y - .76 - gy(cn.x, cn.z)) < 1.5) { cn.cd = 2; fire(p, cn); return; } }
  if (inWater && !p.wet) { p.wet = true; sfx('splash', .6); for (let i = 0; i < 16; i++) spawnP(b.position.x, TR.WATER, b.position.z, rnd(-3, 3), rnd(3, 7), rnd(-3, 3), 0xbfe6ff, rnd(.08, .16), rnd(.4, .8), 3); } else if (!inWater) p.wet = false;
}
let jetN = 0;
function jetFx(p) { if ((jetN++ & 1) === 0) { spawnP(p.x + rnd(-.15, .15), p.y - .2, p.z + rnd(-.15, .15), rnd(-1, 1), -7, rnd(-1, 1), pick([0xffd23f, 0xff8a1c, 0xff4a1c]), rnd(.15, .3), rnd(.25, .45), 1); if (jetN % 6 === 0) { spawnP(p.x, p.y - .6, p.z, rnd(-1, 1), -2, rnd(-1, 1), 0x888888, .3, 1, 2); sfx('jet', .12); } } }

// ---------- NPC brain ----------
function npcTick(c, h) {
  if (c.carT > 0) c.carT -= h; if (c.hazT > 0) c.hazT -= h; if (c.panic > 0) c.panic -= h; if (c.stagger > 0) c.stagger -= h; if (c.lock > 0) c.lock -= h;
  if (c.flight) { flightTick(c, h); return; }
  if (c.rag) {
    c.ragT += h; const pv = c.parts.pelvis, spd = pv.velocity.length();
    if (c.alive && (c.crippled || c.bleed > 0)) { if (c.bleed > 0) c.bleed -= h; c.hp -= (c.crippled ? 9 : 4) * h; if (c.hp <= 0) die(c, 'bled out'); }
    if (c.hp < 70 && spd > 2.5 && pv.position.y < gy(pv.position.x, pv.position.z) + .7 && T - c.smearT > .14) { c.smearT = T; addDecal(pv.position.x, pv.position.z, rnd(.25, .55), pick(BLOOD), rnd(.8, 1.8)); }
    if (c.launch && c.ragT > 1 && spd < .6 && !(grab && grab.c === c)) settleLaunch(c);
    if (!c.alive) { c.corpseT -= h; if (c.corpseT <= 0 || pv.position.y < gy(pv.position.x, pv.position.z) - 20) respawn(c); return; }
    if (c.ragT > c.downT && spd < 1.2 && !c.crippled && !(grab && grab.c === c)) standUp(c);
    return;
  }
  if (c.bleed > 0) { c.bleed -= h; c.hp -= 3 * h; if (c.hp <= 0) { ragdoll(c); die(c, 'bled out'); return; } }
  const b = c.body, ai = c.ai; if (!c.parked && b.position.y < gy(b.position.x, b.position.z) - 15) { respawn(c); return; }
  const pp = charPos(player), far = Math.hypot(b.position.x - pp.x, b.position.z - pp.z) > 250; c.far = far;
  // far away: park the body outside the physics world entirely (cheap), bring it back on the ground when you come near
  if (far) { if (!c.parked) { world.removeBody(b); c.parked = true; } return; }
  if (c.parked) { c.parked = false; b.position.y = gy(b.position.x, b.position.z) + .78; b.velocity.set(0, 0, 0); world.addBody(b); }
  let vx = 0, vz = 0;
  if (c.stagger > 0 || c.lock > 0) { if (c.faceT !== undefined && c.stagger > 0) { const da = angDiff(c.faceT, c.yaw); c.yaw += da * (1 - Math.exp(-14 * h)); } }
  else if (ai.wait > 0) ai.wait -= h;
  else {
    const dx = ai.tx - b.position.x, dz = ai.tz - b.position.z, d = Math.hypot(dx, dz), sp = c.panic > 0 ? 5.2 : ai.spd;
    if (d < (c.route ? 2 : .7)) { ai.wait = c.panic > 0 || c.route ? 0 : rnd(1, 5); newTarget(c); } else { vx = dx / d * sp; vz = dz / d * sp; c.turnRate = angDiff(Math.atan2(dx, dz), c.yaw) * 3; c.yaw += angDiff(Math.atan2(dx, dz), c.yaw) * (1 - Math.exp(-7 * h)); }
    ai.stuck += h; if (ai.stuck > 1.2) { if (Math.hypot(b.position.x - ai.lx, b.position.z - ai.lz) < .5) newTarget(c); ai.stuck = 0; ai.lx = b.position.x; ai.lz = b.position.z; }
  }
  if (c.stagger <= 0) { const a = 26 * h; b.velocity.x += clamp(vx - b.velocity.x, -a, a); b.velocity.z += clamp(vz - b.velocity.z, -a, a); }
  else { const k = Math.exp(-5.5 * h); b.velocity.x *= k; b.velocity.z *= k; }
  if (c.ground && b.velocity.y < 2) { const gd = b.position.y - .76 - gy(b.position.x, b.position.z); if (gd > .02 && gd < .4) b.velocity.y = Math.min(b.velocity.y, -gd * 20 - 1); }
  for (const cn of cannons) if (cn.cd <= 0 && Math.hypot(b.position.x - cn.x, b.position.z - cn.z) < 1.4 && c.panic > 0) { cn.cd = 3; fire(c, cn); S.seen.npcCannon = 1; addScore(`${c.name} fled by cannon`, 150); }
}
function newTarget(c) {
  const hm = c.home, p = c.body.position;
  if (c.route) { c.ri += c.rdir; if (c.ri >= c.route.length - 1 || c.ri <= 0) { c.rdir = -c.rdir; c.ri = clamp(c.ri, 0, c.route.length - 1); c.ai.wait = rnd(3, 8); } const [x, z] = c.route[c.ri]; c.ai.tx = x + rnd(-1.5, 1.5); c.ai.tz = z + rnd(-1.5, 1.5); return; }
  for (let i = 0; i < 8; i++) {
    const a = rnd(0, 6.3), r = rnd(4, 16); let x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (Math.hypot(x - hm.x, z - hm.z) > hm.r) { const a2 = rnd(0, 6.3), r2 = rnd(0, hm.r * .8); x = hm.x + Math.cos(a2) * r2; z = hm.z + Math.sin(a2) * r2; }
    if (x < -5 && x > -29 && Math.abs(z - 15) < 3) continue; if (gy(x, z) < TR.WATER + .3) continue; c.ai.tx = x; c.ai.tz = z; return;
  }
  c.ai.tx = hm.x + rnd(-6, 6); c.ai.tz = hm.z + rnd(-6, 6);
}
function respawn(c) {
  const kind = c.kind, tint = c.inst.mesh.material.color.getHex(), name = c.name, hm = c.home, walk = c.walkClip; removeChar(c);
  const pp = charPos(player); let x, z, i = 0; do { const a = rnd(0, 6.3), r = rnd(0, hm.r); x = hm.x + Math.cos(a) * r; z = hm.z + Math.sin(a) * r; } while (Math.hypot(x - pp.x, z - pp.z) < 18 && i++ < 10);
  const route = c.route, nc = makeChar(kind, x, z, { tint: tint !== 0xffffff ? tint : null, name: name === 'Tower Apricot' ? KNAME('apricot') : name, home: route ? { x: route[10][0], z: route[10][1], r: 400 } : hm, walk, idle: c.idleClip });
  if (route) { nc.route = route; nc.ri = 10; nc.rdir = 1; nc.body.position.set(route[10][0], gy(route[10][0], route[10][1]) + .78, route[10][1]); } npcs.push(nc); G3.npcs = npcs;
}

// ---------- simulation ----------
let pinT = 0, poiT = 0;
function tick(h) {
  T += h;
  controlPlayer(h); for (const c of npcs.slice()) npcTick(c, h);
  if (player.carT > 0) player.carT -= h; if (player.hazT > 0) player.hazT -= h;
  for (const car of cars) { car.s += car.speed * h; if (!car.wrecked) placeCar(car); else { car.wreckT -= h; if (car.wreckT <= 0 || car.body.position.y < -10) { const p = car.body.position; puff(p.x, p.y, p.z, 14, 0xffffff, 3, .3); car.wrecked = false; car.body.type = CANNON.Body.KINEMATIC; car.body.mass = 0; car.body.updateMassProperties(); placeCar(car); } } }
  for (const hz of hazards) if (hz.ball) { const b = hz.body, v = b.velocity.length(); if (b.position.y < 3.2 && v > .3 && v < 14) b.velocity.scale(1.025, b.velocity); else if (v < .3 && b.position.y < 2) b.velocity.x += 2; }
  grabTick(); for (const B of beasts) beastTick(B, h); pickupTick(h);
  { const q = charPos(player); for (const cp of CAMPS) { if (Math.abs(cp.x - q.x) > 120 || Math.abs(cp.z - q.z) > 120) continue; if (Math.random() < .6) spawnP(cp.x + rnd(-.3, .3), cp.y + .3, cp.z + rnd(-.3, .3), rnd(-.3, .3), rnd(.5, 1.5), rnd(-.3, .3), pick([0xffd23f, 0xff8a1c, 0xff5a1c]), rnd(.12, .25), rnd(.4, .8), 1); cp.lt.intensity = 5 + Math.sin(T * 17 + cp.x) * 1.2 + Math.sin(T * 7.3) * .8; } }
  for (const c of allChars()) if (!c.rag) c.vyPrev = c.body.velocity.y;
  world.step(h);
  for (let i = 0; i < later.length && i < 4000; i++) { try { later[i](); } catch (e) { console.error(e); } } later.length = 0;
  for (const c of allChars()) { c.ground = false; c.gBody = null; }
  for (const ct of world.contacts) { const bi = ct.bi, bj = ct.bj; if (bi.char && ct.ni.y < -.5) { bi.char.ground = true; bi.char.gBody = bj; } if (bj.char && ct.ni.y > .5) { bj.char.ground = true; bj.char.gBody = bi; } }
  for (const c of allChars()) {
    if (c.gone || c.flight) continue;
    if (c.rag) { if (c.isPlayer) { const pv = c.parts.pelvis; c.peakY = Math.max(c.peakY || 0, pv.position.y); if (c.ragT > .4 && pv.velocity.length() < 3) { if (c.peakY - pv.position.y > 18) objective('tower'); c.peakY = pv.position.y; } } continue; }
    const b = c.body; c.speed = Math.hypot(b.velocity.x, b.velocity.z);
    if (c.ground) {
      if (c.gBody && c.gBody.bounce) { b.velocity.y = c.gBody.bounce; c.ground = false; c.jumps = 1; sfx('boing', c.isPlayer ? .8 : .2); if (c.isPlayer && T - (c.boingT || -9) > 1) { c.boingT = T; addScore('Boing', 20); } }
      else {
        if (c.isPlayer && c.rollBuf > 0 && c.vyPrev < -6) { c.rollBuf = 0; c.ground = true; c.lock = 0; c.atk = null; roll(); addScore(c.vyPrev < -24 ? 'Saved it! Roll landing' : 'Roll landing', c.vyPrev < -24 ? 150 : 30); dust(b.position.x, b.position.z, 10, 3); c.jumps = 0; c.peakY = b.position.y; continue; }
        if (c.vyPrev < -24) { const d = (-c.vyPrev - 18) * 6; if (c.isPlayer) { if ((c.peakY || 0) - b.position.y > 18) objective('tower'); addScore('Splat', 150); shake = Math.max(shake, .7); } knock(c, V3(rnd(-2, 2), 5, rnd(-2, 2)), d, false); if (!c.isPlayer) maybeSever(c, .3); sfx('hit'); const q = charPos(c); for (let i = 0; i < 3; i++) addDecal(q.x + rnd(-.6, .6), q.z + rnd(-.6, .6), rnd(.5, 1.2), pick(BLOOD)); continue; }
        if (c.isPlayer && c.airT > .3 && c.vyPrev < -6) { // landing
          const hard = c.vyPrev < -14; sample('land', hard ? .8 : .45) || sfx('thud', .4); dust(b.position.x, b.position.z, hard ? 12 : 6, hard ? 3 : 2); camLand = Math.min(.5, -c.vyPrev * .022);
          if (hard && !c.atk && c.rollT <= 0) { c.an && c.an.play('Jump_Land', { start: .1, end: .55, rate: 1.5, fadeIn: .03, fadeOut: .15 }); c.lock = Math.max(c.lock, .12); }
        }
        c.jumps = 0; if (c.isPlayer) c.peakY = b.position.y;
      }
    } else if (c.isPlayer) c.peakY = Math.max(c.peakY || 0, b.position.y);
    if (c.isPlayer && b.position.y < gy(b.position.x, b.position.z) - 6) { const x = b.position.x, z = b.position.z; b.position.set(x, gy(x, z) + 3, z); b.velocity.set(0, 0, 0); }
  }
  for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= h; if (tm.t <= 0) { timers.splice(i, 1); try { tm.f(); } catch (e) { console.error(e); } } }
  for (const t of things.slice()) {
    if (t.dead) continue; const p = t.body.position;
    if (t.fuse > 0) { t.fuse -= h; if (t.kind === 'grenade' && Math.random() < .5) spawnP(p.x, p.y + .15, p.z, rnd(-.5, .5), 1.5, rnd(-.5, .5), 0xffd23f, .05, .25, 1); if (t.fuse <= 0) { const x = p.x, y = p.y, z = p.z, pow = t.kind === 'barrel' ? 1.25 : t.pow; if (t.kind === 'barrel') { const ch = S.chain; ch.n = (T - ch.t < 1.3) ? ch.n + 1 : 1; ch.t = T; addScore(ch.n > 1 ? `Chain reaction x${ch.n}` : 'Barrel exploded', ch.n > 1 ? ch.n * 100 : 80, ch.n >= 4); if (ch.n >= 4) objective('chain'); } removeThing(t); explode(x, y, z, pow); continue; } }
    if (Math.abs(p.x) > TR.HALF + 20 || Math.abs(p.z) > TR.HALF + 20 || p.y < -60) { removeThing(t); continue; }
    if (t.temp && T - t.born > 45 && t.body.sleepState === CANNON.Body.SLEEPING) removeThing(t);
  }
  while (debris.length > 160) { const t = debris.shift(); if (!t.dead) removeThing(t); }
  if (debris.length && debris[0].dead) debris = debris.filter(t => !t.dead);
  pinT -= h; if (pinT <= 0) { pinT = .3; for (const t of things) if (t.kind === 'pin' && !t.down) { const q = t.body.quaternion, uy = 1 - 2 * (q.x * q.x + q.z * q.z); if (uy < .6) { t.down = true; S.pins++; addScore('Pin down', 50); if (S.pins === 10) { addScore('STRIKE', 500, true); objective('strike'); } } } }
  poiT -= h; if (poiT <= 0) { poiT = .5; const pp = charPos(player); for (const p of POI) { const d = Math.hypot(pp.x - p.x, pp.z - p.z); if (d < 45 && !S.seen[p.id]) { S.seen[p.id] = 1; if (p.id !== 'town') banner(p.name); if (p.id === 'village') objective('village'); } if (p.id === 'summit' && d < 22 && Math.abs(pp.y - p.y) < 6) objective('summit'); } }
}
function banner(t) { const b = $('#banner'); b.textContent = t; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; b.classList.add('show'); setTimeout(() => b.classList.remove('show'), 2600); }
const _cq = new THREE.Quaternion(), _cv = V3(), _cv2 = V3(); let camLand = 0, camDip = 0;
const camRay = new CANNON.RaycastResult(), _ra = CV(), _rb = CV();
function visuals(dt) {
  for (const t of things) { if (t.frozen || t.body.sleepState === CANNON.Body.SLEEPING) continue; t.mesh.position.copy(t.body.position); t.mesh.quaternion.copy(t.body.quaternion); }
  for (const car of cars) { car.mesh.position.copy(car.body.position); car.mesh.quaternion.copy(car.body.quaternion); }
  for (const hz of hazards) { hz.mesh.position.copy(hz.body.position); hz.mesh.quaternion.copy(hz.body.quaternion); if (hz.chain) { _cv.copy(hz.body.position).sub(hz.anchor); const l = _cv.length(); hz.chain.position.copy(hz.anchor).addScaledVector(_cv, .5); hz.chain.scale.set(.07, l, .07); hz.chain.quaternion.setFromUnitVectors(_Y, _cv.normalize()); } }
  const pp0 = charPos(player);
  for (const c of allChars()) {
    if (c.gone) continue;
    if (!c.rag) {
      const b = c.body.position; c.holder.position.set(b.x, b.y - .76, b.z); c.holder.rotation.y = c.yaw;
      const dd = Math.hypot(b.x - pp0.x, b.z - pp0.z); c.near = dd < 28;
      if (c.flight) { const v = c.body.velocity, e = Math.atan2(v.y, Math.hypot(v.x, v.z)); c.fpitch = (c.fpitch ?? 0) + ((Math.PI / 2 - e) - (c.fpitch ?? 0)) * (1 - Math.exp(-dt * 6)); c.holder.rotation.set(c.fpitch, c.yaw, 0, 'YXZ'); _cv2.set(0, .76, 0).applyEuler(c.holder.rotation); c.holder.position.set(b.x - _cv2.x, b.y - _cv2.y, b.z - _cv2.z); }
      else if (c.fpitch) { c.fpitch = 0; c.holder.rotation.set(0, c.yaw, 0, 'YXZ'); }
      if (dd < 150 || c.isPlayer) animate(c, dt); c.holder.visible = dd < 420 || c.isPlayer;
    }
    driveParts(c);
    for (let i = c.bleeders.length - 1; i >= 0; i--) { const bl = c.bleeders[i]; bl.t -= dt; if (bl.t <= 0) { c.bleeders.splice(i, 1); continue; } if (Math.random() < .5 * Math.min(1, bl.t / 3) + .1) { bl.o.getWorldPosition(_cv); bl.o.getWorldQuaternion(_cq); const d = V3(0, 1, 0).applyQuaternion(_cq); spawnP(_cv.x, _cv.y, _cv.z, d.x * 2.5 + rnd(-.6, .6), d.y * 2.5 + rnd(0, 1.5), d.z * 2.5 + rnd(-.6, .6), pick(BLOOD), rnd(.03, .07), rnd(.6, 1.1), 0); } }
  }
  if (grab) { const o = charPos(player), b = grab.body.position; _cv.set(b.x - o.x, b.y - (o.y + .55), b.z - o.z); const l = _cv.length() || .01; tongue.visible = true; tongue.position.set(o.x + _cv.x / 2, o.y + .55 + _cv.y / 2, o.z + _cv.z / 2); tongue.scale.set(1, l, 1); tongue.quaternion.setFromUnitVectors(_Y, _cv.multiplyScalar(1 / l)); }
  updateParticles(dt); ringsTick(dt); { const q = charPos(player); grassTick(q.x, q.z); }
  { const f = player.flight; reticle.visible = !!f; if (f) { const x1 = f.x1 + f.ox, z1 = f.z1 + f.oz, k = 1 + Math.sin(T * 9) * .06; reticle.position.set(x1, gy(x1, z1) + .15, z1); reticle.scale.setScalar((f.dive ? 8 : 6) / 6 * k); reticle.material.opacity = .5 + Math.sin(T * 9) * .12; } }
  for (const B of beasts) { if (B.far) { B.g.visible = Math.hypot(B.x - pp0.x, B.z - pp0.z) < 420; continue; } B.g.visible = true; B.mixer.update(dt); }
  onboarding(dt);
  if (boomLight.intensity > 0) boomLight.intensity = Math.max(0, boomLight.intensity - dt * 2400);
  // camera: smoothed follow, auto-swing behind when running, collision, landing dip, FOV kick
  const rd = Math.max(dt, .004), pp = charPos(player), p = player;
  if (!p.rag && !p.flight && p.speed > 2.5 && T - cam.lastLook > 1.4 && !p.atk) { const behind = p.yaw + Math.PI, da = angDiff(behind, cam.yaw); if (Math.abs(da) < 1.75) cam.yaw += da * (1 - Math.exp(-rd * .9 * Math.min(1, p.speed / 8))); }
  if (p.flight) { const v = p.body.velocity; cam.yaw += angDiff(Math.atan2(-v.x, -v.z), cam.yaw) * (1 - Math.exp(-rd * 2)); }
  const ty = pp.y + (p.rag ? .4 : .62); _cv.set(pp.x, ty, pp.z);
  // in a fight, frame the target as well as yourself
  if (p.lockC && !p.lockC.gone && T - p.lockT < 1.6 && !p.flight) { const q = charPos(p.lockC), k = .28 * (1 - sstep(1, 1.6, T - p.lockT)); if (Math.hypot(q.x - pp.x, q.z - pp.z) < 7) { _cv.x += (q.x - pp.x) * k; _cv.z += (q.z - pp.z) * k; } }
  camT.x += (_cv.x - camT.x) * (1 - Math.exp(-18 * rd)); camT.z += (_cv.z - camT.z) * (1 - Math.exp(-18 * rd)); camT.y += (_cv.y - camT.y) * (1 - Math.exp(-(p.flight ? 18 : 9) * rd));
  if (Math.abs(_cv.x - camT.x) + Math.abs(_cv.z - camT.z) > 30 || p.flight) camT.copy(_cv);
  camLand *= Math.exp(-rd * 7); camDip += (camLand - camDip) * (1 - Math.exp(-rd * 25));
  const want = p.flight ? 6.6 : p.rag ? cam.distT + 1.5 : cam.distT + clamp((p.speed - 6) * .12, 0, .8); cam.dist += (want - cam.dist) * (1 - Math.exp(-rd * 5));
  cam.fl = (cam.fl || 0) + ((p.flight ? 1 : 0) - (cam.fl || 0)) * (1 - Math.exp(-rd * 4)); const pit = cam.pitch + (.27 - cam.pitch) * cam.fl;
  const cp = Math.cos(pit), ox = Math.sin(cam.yaw) * cp, oy = Math.sin(pit), oz = Math.cos(cam.yaw) * cp;
  const lookY = camT.y + .45 - camDip;
  _ra.set(camT.x, lookY, camT.z); _rb.set(camT.x + ox * cam.dist, lookY + oy * cam.dist, camT.z + oz * cam.dist); camRay.reset();
  world.raycastClosest(_ra, _rb, { collisionFilterMask: G_WORLD, skipBackfaces: true }, camRay);
  let dist = cam.dist; if (camRay.hasHit && !(camRay.body && camRay.body.thing && !camRay.body.thing.frozen)) dist = Math.max(1.2, camRay.distance - .35);
  camera.position.set(camT.x + ox * dist, lookY + oy * dist, camT.z + oz * dist);
  const gyc = gy(camera.position.x, camera.position.z) + .45; if (camera.position.y < gyc) camera.position.y = gyc;
  // trauma shake: squared, smooth noise, with a little roll
  const tr = Math.min(1, shake) ** 2, ns = (f, o) => Math.sin(T * f + o) * .6 + Math.sin(T * f * 2.3 + o * 1.7) * .4;
  if (tr > 0) { camera.position.x += ns(29, 1) * tr * .45; camera.position.y += ns(33, 2) * tr * .45; camera.position.z += ns(31, 3) * tr * .45; }
  shake = Math.max(0, shake - dt * 1.7);
  camera.position.add(kick); kick.multiplyScalar(Math.exp(-rd * 14));
  camera.lookAt(camT.x, lookY, camT.z); if (tr > 0) camera.rotateZ(ns(23, 4) * tr * .07);
  cam.fovPunch *= Math.exp(-rd * 5); const fovT = 60 + clamp((p.speed - 7) * 1.4, 0, 8) + (p.flight ? (p.flight.dive ? 22 : 12) : 0) + (p.charging > 0 ? 6 : 0) + cam.fovPunch; cam.fov += (fovT - cam.fov) * (1 - Math.exp(-rd * 4)); if (Math.abs(camera.fov - cam.fov) > .05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  sun.position.set(camT.x + 40, camT.y + 80, camT.z + 30); sun.target.position.set(camT.x, camT.y, camT.z);
  if (window.__sky) window.__sky.position.copy(camera.position);
  hud(); drawMap();
}
// ---------- minimap ----------
let mapImg = null;
function buildMapImg() {
  const S2 = 256, cv = document.createElement('canvas'); cv.width = cv.height = S2; const g = cv.getContext('2d'), im = g.createImageData(S2, S2);
  for (let j = 0; j < S2; j++) for (let i = 0; i < S2; i++) {
    const x = (i / S2 - .5) * TR.W, z = (j / S2 - .5) * TR.W, h = gy(x, z), hx = gy(x + 6, z), k = (i + j * S2) * 4, sh = clamp(.85 + (h - hx) * .05, .5, 1.2);
    let r, gg, b; if (h < TR.WATER) { r = 70; gg = 140; b = 210; } else if (h > 110) { r = 170; gg = 165; b = 150; } else { const t = clamp(h / 110, 0, 1); r = 95 + t * 60; gg = 170 - t * 30; b = 75 + t * 40; }
    im.data[k] = r * sh; im.data[k + 1] = gg * sh; im.data[k + 2] = b * sh; im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0); mapImg = cv;
}
function drawMap() {
  const cv = $('#map'); if (!cv || !mapImg) return; const big = cv.classList.contains('big'), W2 = cv.width = big ? 520 : 180, H2 = cv.height = W2, g = cv.getContext('2d');
  const pp = charPos(player), span = big ? TR.W : 360, sc = W2 / span, cx = big ? 0 : pp.x, cz = big ? 0 : pp.z, toS = (x, z) => [(x - cx) * sc + W2 / 2, (z - cz) * sc + H2 / 2];
  g.save(); g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 / 2 - 2, 0, 7); g.clip();
  const ms = 256 / TR.W; g.drawImage(mapImg, (cx - span / 2 + TR.HALF) * ms, (cz - span / 2 + TR.HALF) * ms, span * ms, span * ms, 0, 0, W2, H2);
  g.fillStyle = '#1b2a4a88'; for (const n of npcs) { if (n.gone) continue; const q = charPos(n), [x, y] = toS(q.x, q.z); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
  g.font = `bold ${big ? 14 : 10}px Trebuchet MS`; g.textAlign = 'center';
  for (const p of POI) { let [x, y] = toS(p.x, p.z); const out = !big && Math.hypot(x - W2 / 2, y - H2 / 2) > W2 / 2 - 10; if (out) { const a = Math.atan2(y - H2 / 2, x - W2 / 2); x = W2 / 2 + Math.cos(a) * (W2 / 2 - 10); y = H2 / 2 + Math.sin(a) * (W2 / 2 - 10); } g.fillStyle = p.icon; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, big ? 7 : 5, 0, 7); g.fill(); g.stroke(); if (big || !out) { g.fillStyle = '#1b2a4a'; g.fillText(p.name, x, y - 9); } }
  const [px, py] = toS(pp.x, pp.z); g.translate(px, py); g.rotate(-player.yaw + Math.PI); g.fillStyle = '#ffd23f'; g.strokeStyle = '#1b2a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
  g.restore(); g.strokeStyle = '#1b2a4a'; g.lineWidth = 3; g.beginPath(); g.arc(W2 / 2, H2 / 2, W2 / 2 - 2, 0, 7); g.stroke();
}
function frame(dtReal) {
  if (canvas.width !== Math.floor((innerWidth || 1280) * renderer.getPixelRatio()) || canvas.height !== Math.floor((innerHeight || 720) * renderer.getPixelRatio())) resize();
  pollPad(dtReal);
  let sk = 1; if (slowT > 0) { slowT -= dtReal; sk = slowK; }
  const ts = timeScale * sk; let dtv = dtReal * ts;
  if (hitstop > 0) { hitstop -= dtReal; dtv *= .04; }
  else if (started && player) { acc += Math.min(dtReal, .1); let n = 0; while (acc >= FIX && n < 3) { tick(FIX * ts); acc -= FIX; n++; } if (n === 3) acc = 0; }
  if (player) visuals(dtv);
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
  auto: true, THREE, CANNON, scene, camera, renderer, cam, keys, S, TR, POI, pad,
  get T() { return T; }, get grab() { return grab; }, get debris() { return debris; }, get hazards() { return hazards; }, get cannons() { return cannons; },
  equipSword, dropSword, tumbleB, get SWORDS() { return SWORDS; }, get pickups() { return pickups; }, STOPS, LEDGE, get slowT() { return slowT; },
  start, reset: resetWorld, slowmo, attack, heavy, roll, grenade, tryGrab, throwGrab, toggleRag, explode, ragdoll, standUp, sever, knock, hurt, die, hitThing, shatter, unfreeze, wreckCar, addScore, objective, blood, addDecal, pathAt, fire, gy,
  teleport(x, y, z) { const p = player; if (p.rag) standUp(p); if (y === undefined) y = gy(x, z); p.body.position.set(x, y + .76, z); p.body.velocity.set(0, 0, 0); camT.set(x, y + 1.3, z); },
  step(n = 1, dt = FIX) { for (let i = 0; i < n; i++) { if (started && player) tick(dt * timeScale); if (player) visuals(dt * timeScale); } renderer.render(scene, camera); return T; },
  frame(dt = FIX) { frame(dt); return T; },
  shot() { renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', .8); },
};

(async function init() {
  try {
    const ld = $('#loading');
    ld.textContent = 'shaping the hills...'; shapeTerrain();
    await loadTex(); initDecals(); buildScenery(); buildMapImg();
    ld.textContent = 'loading people...';
    const [bank, chars, folk] = await Promise.all([loadBank('assets/bm/'), loadChars(k => { ld.textContent = `loaded ${CHARS[k][0]}...`; }), loadFolk(), buildVillage().catch(e => console.warn('village failed', e)), loadBeast().catch(e => console.warn('beast failed', e)), loadSwords().catch(e => console.warn('swords failed', e))]);
    MODELS = { ...chars, ...folk };
    if (!Object.keys(MODELS).length) throw new Error('no character models loaded');
    ld.textContent = 'teaching everyone to walk...';
    for (const k in MODELS) { try { RIGS[k] = bakeRig(bank, MODELS[k]); } catch (e) { console.warn('rig failed', k, e); } }
    { const lay = bank.clips.LayToIdle, P = bank.fk(0, lay), hd = P.wp[bank.idx.Head].clone().sub(P.wp[bank.idx.pelvis]).applyQuaternion(RIGS.martleboro.F); LAY_YAW = Math.atan2(hd.x, hd.z); }
    buildAll(); drawObj(); ld.textContent = ''; $('#go').disabled = false; G3.ready = true;
  } catch (e) { console.error(e); $('#loading').textContent = 'Failed to load: ' + e.message; G3.lastError = e; }
  requestAnimationFrame(loop);
})();
