// REALISTIC BEATUP - side-view ragdoll physics sandbox
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as skClone } from './vendor/SkeletonUtils.js';
import { loadChars, instance, SEG_PARENT, CHARS } from './dollmesh.js';
const { Engine, Bodies, Body, Composite, Constraint, Query, Events, Vector } = Matter;

const S = 60;                      // physics pixels per metre
const $ = s => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const wrap = a => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- renderer ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
const cam = { x: 0, y: 2.6, h: 13, shake: 0 };
scene.add(new THREE.HemisphereLight(0xffffff, 0x99aacc, 1.7));
const sun = new THREE.DirectionalLight(0xfff4dd, 2.2); sun.position.set(4, 8, 10); scene.add(sun);
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  const vw = cam.h * w / h; camera.left = -vw / 2; camera.right = vw / 2; camera.top = cam.h / 2; camera.bottom = -cam.h / 2; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
const toWorld = (sx, sy) => ({ x: cam.x + (sx / innerWidth - .5) * cam.h * innerWidth / innerHeight, y: cam.y + (.5 - sy / innerHeight) * cam.h });
const toScreen = (x, y) => ({ x: ((x - cam.x) / (cam.h * innerWidth / innerHeight) + .5) * innerWidth, y: (.5 - (y - cam.y) / cam.h) * innerHeight });

// ---------- textures / materials ----------
const TL = new THREE.TextureLoader(), TEX = {};
for (const n of ['wood', 'wood2', 'brick', 'stone', 'flag', 'metal', 'rug']) {
  const t = TL.load(`assets/tex/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(.5, .5); TEX[n] = t;
}
const matCache = {};
function matFor(o) {
  const k = [o.tex, o.color, o.alpha, o.emis, o.metal].join();
  return matCache[k] ??= new THREE.MeshStandardMaterial({ map: o.tex && o.tex !== 'metal' ? TEX[o.tex] : null, color: o.color ?? (o.tex === 'metal' ? 0xb4c0d0 : 0xffffff), roughness: o.metal ? .4 : .8, metalness: o.metal ? .55 : 0, transparent: (o.alpha ?? 1) < 1, opacity: o.alpha ?? 1, emissive: o.emis ?? 0 });
}
const outlineMat = new THREE.LineBasicMaterial({ color: 0x1b2a4a });
const charMat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 1 });
const emojiCache = {};
function emojiMat(e) {
  if (emojiCache[e]) return emojiCache[e];
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.font = '208px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(e, 128, 144);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return emojiCache[e] = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
}
function skyTex(a, b) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- physics ----------
const engine = Engine.create({ positionIterations: 10, velocityIterations: 8, constraintIterations: 4 });
const world = engine.world;
let T = 0, paused = false, slow = false, gravMode = 0, mute = false;
const GRAV = [['🌍 Normal', 1], ['🌙 Moon', .17], ['🛰 Zero-G', 0], ['🙃 Flipped', -1]];
const later = [];            // deferred actions (run after physics step)
let created = [];            // bodies made by the current spawn
const undo = [];
const dolls = [];
let curItem = null, spawnOrigin = null;

function shapeGeo(pts, depth) {
  const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 1 }); g.translate(0, 0, -depth / 2); return g;
}
function meshFor(b, o) {
  let geo, mat;
  const bw = (b.bounds.max.x - b.bounds.min.x) / S, bh = (b.bounds.max.y - b.bounds.min.y) / S;
  if (o.emoji) { geo = new THREE.PlaneGeometry(bw * 1.15, bh * 1.15); mat = emojiMat(o.emoji); }
  else {
    let pts;
    if (o.shape === 'star') { pts = []; const r = b.circleRadius / S; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, rr = i % 2 ? r * .78 : r * 1.08; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); } }
    else if (o.shape === 'spikes') { pts = [[-bw / 2, -bh / 2]]; const n = Math.round(bw / .3); for (let i = 0; i < n; i++) { pts.push([-bw / 2 + (i + .5) * bw / n, bh / 2 + .15]); pts.push([-bw / 2 + (i + 1) * bw / n, -bh / 2 + .08]); } pts.push([bw / 2, -bh / 2]); }
    else if (b.circleRadius) { pts = []; const r = b.circleRadius / S; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } }
    else pts = b.vertices.map(v => [(v.x - b.position.x) / S, -(v.y - b.position.y) / S]);
    geo = shapeGeo(pts, o.depth ?? .6); mat = matFor(o);
  }
  const m = new THREE.Mesh(geo, mat); if (o.emoji) m.position.z = .4; else if ((o.alpha ?? 1) >= 1) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), outlineMat)); scene.add(m); return m;
}
function add(b, o = {}) {
  b.plugin = { kind: o.kind, on: true, sc: 1, tex: o.tex, ...o.p };
  if (!o.nomesh) b.plugin.mesh = meshFor(b, o);
  if (!created.length && curItem && !o.noroot) { b.plugin.root = curItem; b.plugin.ox = b.position.x / S - spawnOrigin.x; b.plugin.oy = -b.position.y / S - spawnOrigin.y; }
  created.push(b); Composite.add(world, b);
  if (o.static) Body.setStatic(b, true);
  if (o.ang) Body.setAngle(b, o.ang);
  return b;
}
const bopt = o => ({ friction: o.fr ?? .6, restitution: o.re ?? .08, density: (o.den ?? 1) * .001, frictionAir: o.air ?? .004, isSensor: !!o.sensor, ...(o.group ? { collisionFilter: { group: o.group } } : {}) });
const box = (x, y, w, h, o = {}) => add(Bodies.rectangle(x * S, -y * S, w * S, h * S, bopt(o)), o);
const ball = (x, y, r, o = {}) => add(Bodies.circle(x * S, -y * S, r * S, bopt(o)), o);
const poly = (x, y, pts, o = {}) => add(Bodies.fromVertices(x * S, -y * S, [pts.map(p => ({ x: p[0] * S, y: -p[1] * S }))], bopt(o)), o);
function link(a, b, pa, pb, o = {}) {
  const c = Constraint.create({ bodyA: a || undefined, bodyB: b, pointA: pa, pointB: pb, length: o.len ?? 0, stiffness: o.st ?? .9, damping: o.damp ?? .05 });
  c.plugin = { vis: o.vis, rope: o.rope, len: o.len ?? 0 }; Composite.add(world, c); return c;
}
function kill(b) {
  if (!b || b.plugin.dead) return; b.plugin.dead = true;
  for (const c of Composite.allConstraints(world)) if (c.bodyA === b || c.bodyB === b) Composite.remove(world, c);
  if (b.plugin.mesh) { scene.remove(b.plugin.mesh); b.plugin.mesh.geometry.dispose(); }
  Composite.remove(world, b); if (drag && drag.b === b) endDrag();
}
function removeBody(b) { if (b.plugin.doll) removeDoll(b.plugin.doll); else if (!b.plugin.map) kill(b); }
function removeDoll(d) {
  if (d.dead) return; d.dead = true; d.bodies.forEach(kill); if (d.model) scene.remove(d.model); d.marks.forEach(k => scene.remove(k.m)); d.inst?.dispose(); d.tag.remove(); dolls.splice(dolls.indexOf(d), 1); if (sel === d) sel = null;
}
const bodiesAll = () => Composite.allBodies(world);
const mpos = b => ({ x: b.position.x / S, y: -b.position.y / S });

// ---------- sound ----------
let AC, lastThud = 0;
function sfx(type, vol = 1) {
  if (mute) return;
  try {
    AC ??= new AudioContext(); const t = AC.currentTime, g = AC.createGain(); g.connect(AC.destination);
    const tone = (wave, f0, f1, d, v) => { const o = AC.createOscillator(); o.type = wave; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d); g.gain.setValueAtTime(v * vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d); o.connect(g); o.start(t); o.stop(t + d); };
    const noise = (d, f, v) => { const n = AC.createBufferSource(), buf = AC.createBuffer(1, AC.sampleRate * d, AC.sampleRate), dd = buf.getChannelData(0); for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / dd.length) ** 2; const fl = AC.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f; const g2 = AC.createGain(); g2.gain.value = v * vol; n.buffer = buf; n.connect(fl); fl.connect(g2); g2.connect(AC.destination); n.start(t); };
    if (type === 'crack') { noise(.05, 6000, .5); tone('triangle', 260, 70, .09, .3); }
    else if (type === 'snip') { noise(.03, 8000, .4); tone('square', 2400, 1200, .04, .12); }
    else if (type === 'squish') { noise(.18, 700, .7); tone('sine', 170, 55, .13, .25); }
    else if (type === 'thud') { if (T - lastThud < .07) return; lastThud = T; tone('sine', 130, 45, .14, .35); }
    else if (type === 'bonk') tone('triangle', 420, 90, .22, .4);
    else if (type === 'pop') tone('sine', 500, 1300, .07, .3);
    else if (type === 'zap') tone('sawtooth', 1400, 80, .25, .25);
    else if (type === 'pew') tone('square', 900, 200, .1, .15);
    else if (type === 'heal') tone('sine', 500, 1000, .3, .25);
    else if (type === 'glass') tone('square', 3000, 1500, .12, .12);
    else if (type === 'boom') {
      const n = AC.createBufferSource(), buf = AC.createBuffer(1, AC.sampleRate * .7, AC.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; n.buffer = buf; n.connect(f); f.connect(g); g.gain.value = .9 * vol; n.start(t); tone('sine', 90, 30, .5, .6);
    }
  } catch (e) { }
}

// ---------- particles / fx ----------
const PN = 1400, pPos = new Float32Array(PN * 3).fill(999), pCol = new Float32Array(PN * 3), parts = [];
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const dot = document.createElement('canvas'); dot.width = dot.height = 32; { const g = dot.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, 7); g.fill(); }
const pts3 = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 11, vertexColors: true, map: new THREE.CanvasTexture(dot), transparent: true, depthTest: false, sizeAttenuation: false }));
pts3.frustumCulled = false; pts3.renderOrder = 9; scene.add(pts3);
let pi = 0; const tc = new THREE.Color();
function puff(x, y, n, colors, sp = 4, up = 0, life = .8) {
  for (let i = 0; i < n; i++) { const a = rnd(0, 7), v = rnd(.2, 1) * sp; parts[pi] = { i: pi, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + up, l: rnd(.4, 1) * life, c: tc.set(pick(colors)).clone(), g: up ? 0 : 9 }; pi = (pi + 1) % PN; }
}
const STARS = [0xffe14a, 0xffffff, 0xff7ad9, 0x6ee7ff], FIRE = [0xff5a1f, 0xffb300, 0xffe14a, 0x555555], CONF = [0xff4d6d, 0xffd23f, 0x4de36b, 0x4db8ff, 0xc77dff];
function popup(x, y, txt, size = 34) { const s = toScreen(x, y), e = document.createElement('div'); e.className = 'pop'; e.textContent = txt; e.style.cssText = `left:${s.x}px;top:${s.y}px;font-size:${size}px`; $('#fx').append(e); setTimeout(() => e.remove(), 900); }
const fxs = [];
function ring(x, y, r, color = 0xffffff) {
  const m = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false })); m.position.set(x, y, 2); scene.add(m);
  fxs.push({ m, l: .35, t: .35, f(k) { m.scale.setScalar(r * (1 - k) + .1); m.material.opacity = k; } });
}
function bolt(x, y) {
  const p = []; let cx = x + rnd(-2, 2); for (let yy = y + 22; yy > y; yy -= 1.2) { p.push(new THREE.Vector3(cx, yy, 2)); cx += rnd(-.7, .7); cx += (x - cx) * .25; } p.push(new THREE.Vector3(x, y, 2));
  for (const w of [0, .05, -.05]) { const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.map(v => v.clone().setX(v.x + w))), new THREE.LineBasicMaterial({ color: 0xfff7a8, depthTest: false })); scene.add(m); fxs.push({ m, l: .18, t: .18, f() { } }); }
}
function flash(o = .8) { const f = $('#flash'); f.style.transition = 'none'; f.style.opacity = o; requestAnimationFrame(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; }); }

// ---------- gameplay helpers ----------
let has3d = false; fetch('3d.html', { method: 'HEAD' }).then(r => { has3d = r.ok; ui(); }).catch(() => { });
let sel = null, GORE = true, BRAWL = false, grpSeq = 20000, lmb = false, nextShot = 0, lastSnip = 0;
const BLOOD = [0xb3070f, 0x8a0308, 0xd0121b, 0x6e0206];
const SHARP = { sword: 1, shrap: 1, saw: 1, meteor: 1, spikes: 1 };
const KIDS = {}; for (const c in SEG_PARENT) (KIDS[SEG_PARENT[c]] ||= []).push(c);
function blood(x, y, n, sp = 5, vx = 0, vy = 0) {
  if (!GORE) return;
  for (let i = 0; i < n; i++) { const a = rnd(0, 7), v = rnd(.2, 1) * sp; parts[pi] = { i: pi, x, y, vx: Math.cos(a) * v + vx, vy: Math.sin(a) * v + vy + 1.5, l: rnd(.7, 1.8), c: tc.set(pick(BLOOD)).clone(), g: 14, blood: 1 }; pi = (pi + 1) % PN; }
}
const splats = [], splatGeo = new THREE.CircleGeometry(1, 12), splatMats = BLOOD.map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .9 })), scorchMat = new THREE.MeshBasicMaterial({ color: 0x15110e, transparent: true, opacity: .8 });
function splat(x, y, r = rnd(.05, .15), scorch) {
  let m; if (splats.length >= 600) m = splats.shift(); else { m = new THREE.Mesh(splatGeo, splatMats[0]); scene.add(m); }
  m.material = scorch ? scorchMat : pick(splatMats); m.position.set(x, y - (scorch ? .1 : rnd(.03, .2)), scorch ? .345 : .35);
  if (scorch) m.scale.set(r * 1.6, .09, 1); else m.scale.set(r * rnd(1, 2.4), r * rnd(.3, .7), 1); splats.push(m);
}
const markMats = {}, markGeo = new THREE.PlaneGeometry(1, 1);
const stumpMat = new THREE.MeshStandardMaterial({ color: 0x8a0d12, roughness: .5 }), boneMat = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: .6 }), meatMat = { color: 0x9c1c22 };
function markMat(type) {
  if (markMats[type]) return markMats[type];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  if (type === 'bruise') { for (const [x, y, r] of [[30, 32, 26], [40, 26, 16], [24, 40, 15]]) { const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, 'rgba(70,12,95,.8)'); gr.addColorStop(.6, 'rgba(120,25,60,.45)'); gr.addColorStop(1, 'rgba(120,30,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); } }
  else if (type === 'cut') { g.lineCap = 'round'; g.strokeStyle = '#5a0206'; g.lineWidth = 9; g.beginPath(); g.moveTo(6, 40); g.quadraticCurveTo(30, 18, 58, 26); g.stroke(); g.strokeStyle = '#d3141d'; g.lineWidth = 4; g.stroke(); g.fillStyle = '#a3080f'; for (const [x, y, r] of [[20, 46, 4], [36, 40, 3], [48, 42, 5], [30, 54, 3]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }
  else { g.fillStyle = '#7d0a10'; g.beginPath(); g.arc(32, 40, 16, 0, 7); g.fill(); g.fillStyle = '#f4eedc'; g.strokeStyle = '#3b2b22'; g.lineWidth = 2; g.beginPath(); g.moveTo(22, 44); g.lineTo(30, 6); g.lineTo(36, 20); g.lineTo(42, 10); g.lineTo(42, 44); g.closePath(); g.fill(); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return markMats[type] = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false });
}
function addMark(b, type, wx, wy, size = .14, bleed = 0) {
  const d = b.plugin.doll; if (!d || !GORE) return null;
  const dx = wx * S - b.position.x, dy = -wy * S - b.position.y, c = Math.cos(-b.angle), s = Math.sin(-b.angle); let m;
  if (type === 'stump') { m = new THREE.Group(); const f = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), stumpMat); f.scale.z = .7; const bn = new THREE.Mesh(new THREE.SphereGeometry(size * .45, 8, 6), boneMat); bn.position.z = size * .5; m.add(f, bn); }
  else { m = new THREE.Mesh(markGeo, markMat(type)); m.scale.set(size * 2, size * 2, 1); m.renderOrder = 6; }
  scene.add(m); const mk = { b, ox: dx * c - dy * s, oy: dx * s + dy * c, m, z: type === 'stump' ? (d.hipZ || 0) : .5, rot: rnd(0, 6.3), type, bleed }; d.marks.push(mk);
  const mine = d.marks.filter(k => k.b === b && k.type !== 'stump'); if (mine.length > 5) { scene.remove(mine[0].m); d.marks.splice(d.marks.indexOf(mine[0]), 1); }
  return mk;
}
function updateMarks(dt) {
  for (const d of dolls) for (const k of d.marks) {
    const b = k.b, c = Math.cos(b.angle), s = Math.sin(b.angle), x = (b.position.x + k.ox * c - k.oy * s) / S, y = -(b.position.y + k.ox * s + k.oy * c) / S;
    k.m.position.set(x, y, k.z); k.m.rotation.z = k.rot - b.angle;
    if (k.bleed > 0 && dt) { k.bleed -= dt; if (Math.random() < (k.type === 'stump' ? .55 : .2)) blood(x, y, 1, 1.2, b.velocity.x * .5, 0); }
  }
}
function die(d) { d.alive = false; d.hp = 0; d.tag.classList.add('dead'); }
function breakBone(d, part) {
  if (!GORE || d.broken[part] || d.cut[part]) return; d.broken[part] = true; const b = d.parts[part], p = mpos(b);
  for (const l of d.lim) if (l[4] === part) { l[2] = -3.8; l[3] = 3.8; }
  addMark(b, 'break', p.x, p.y, .13, 3); blood(p.x, p.y, 8, 3); sfx('crack'); d.pain = Math.min(100, d.pain + 30); d.hp = Math.max(0, d.hp - 8);
  if (part === 'head') d.hp = 0; if (d.hp <= 0 && d.alive) die(d);
}
function sever(d, part) {
  if (!GORE || d.dead || !d.jt[part] || d.cut[part]) return false;
  const c = d.jt[part], a = c.bodyA, b = c.bodyB, jx = (a.position.x + c.pointA.x) / S, jy = -(a.position.y + c.pointA.y) / S;
  Composite.remove(world, c); d.cut[part] = true; d.lim = d.lim.filter(l => l[4] !== part);
  const g = -(++grpSeq), walk = n => { const pb = d.parts[n]; pb.collisionFilter.group = g; pb.plugin.off = true; (KIDS[n] || []).forEach(k => !d.cut[k] && walk(k)); }; walk(part);
  d.inst?.sever(part);
  const th = (/thigh|shin/.test(part) ? d.lt : part === 'chest' ? d.lt * 1.7 : part === 'head' ? d.lt : d.at) * .62;
  addMark(a, 'stump', jx, jy, th, 10); addMark(b, 'stump', jx, jy, th, 5);
  blood(jx, jy, 45, 7); sfx('squish'); sfx('crack'); d.pain = Math.min(100, d.pain + 45); cam.shake = Math.max(cam.shake, .12);
  Body.setVelocity(b, { x: b.velocity.x + rnd(-3, 3), y: b.velocity.y - rnd(1, 4) }); Body.setAngularVelocity(b, b.angularVelocity + rnd(-.2, .2));
  d.hp = Math.max(0, d.hp - (part === 'head' || part === 'chest' ? 100 : 30)); d.stun = Math.max(d.stun, 3); if (d.hp <= 0 && d.alive) die(d);
  return true;
}
function gibs(x, y, n) { if (!GORE) return; for (let i = 0; i < n; i++) { const g = ball(x + rnd(-.2, .2), y + rnd(-.2, .2), rnd(.06, .13), { ...meatMat, depth: .2, kind: 'gib', p: { ttl: 25, drip: 3 }, noroot: 1 }); Body.setVelocity(g, { x: rnd(-9, 9), y: rnd(-12, -2) }); } }
function hurt(d, dmg, b, stun = 2.5, type = 'blunt') {
  if (d.dead || !(dmg > 0)) return; b ||= d.parts.chest; d.pain = Math.min(100, d.pain + dmg * 1.4); d.hp = Math.max(0, d.hp - dmg); d.stun = Math.max(d.stun, stun);
  const p = mpos(b), jx = p.x + rnd(-.07, .07), jy = p.y + rnd(-.07, .07), big = dmg >= 3 || Math.random() < .08;
  cam.shake = Math.max(cam.shake, Math.min(.25, dmg * .008)); if (dmg > 15) acc = -.05;
  if (type === 'sharp') { if (big) { addMark(b, 'cut', jx, jy, rnd(.1, .18), 2 + dmg * .25); blood(p.x, p.y, 5 + dmg * .8, 5); if (T - d.popT > .1) { d.popT = T; sfx('squish'); } } else if (Math.random() < .3) blood(p.x, p.y, 1, 3); }
  else if (type !== 'burn') {
    if (dmg > 5) addMark(b, 'bruise', jx, jy, rnd(.1, .2)); if (dmg > 10) blood(p.x, p.y, dmg * .5, 4);
    if (dmg > 19 && b.plugin.part !== 'chest' && b.plugin.part !== 'pelvis' && Math.random() < .6) breakBone(d, b.plugin.part);
    if (big && T - d.popT > .1) { d.popT = T; sfx(dmg > 12 ? 'squish' : 'thud'); if (!GORE) puff(p.x, p.y, 8, STARS, 5); }
  }
  if (d.hp <= 0 && d.alive) die(d);
}
function heal(d) {
  if (d.dead) return d; const p = mpos(d.parts.pelvis); puff(p.x, p.y + .3, 16, [0xff5c8a, 0xffa3c0], 3, 2.5);
  if (Object.keys(d.cut).length || Object.keys(d.broken).length || d.char > .05) { const kind = d.kind, y = Math.max(0, p.y - d.oy), wasSel = sel === d; removeDoll(d); const sc = curItem, cr = created; curItem = kind; created = []; const n = buildDoll(kind, p.x, y); curItem = sc; created = cr; if (wasSel) sel = n; return n; }
  d.hp = 100; d.blood = 100; d.pain = 0; d.temp = 37; d.alive = true; d.nap = false; d.stun = 0; d.tag.classList.remove('dead'); d.bodies.forEach(b => b.plugin.burn = 0);
  d.marks.forEach(k => scene.remove(k.m)); d.marks.length = 0; return d;
}
function splinter(b) {
  if (b.plugin.dead || b.plugin.map) return; const p = mpos(b), w = (b.bounds.max.x - b.bounds.min.x) / S, n = clamp(Math.round(w * 2), 3, 7), tex = b.plugin.tex; kill(b); sfx('crack');
  for (let i = 0; i < n; i++) { const s = box(p.x + rnd(-w / 2, w / 2), p.y + rnd(-.2, .2), rnd(.3, .7), rnd(.07, .14), { tex, p: { ttl: 25 }, noroot: 1, ang: rnd(0, 6) }); Body.setVelocity(s, { x: rnd(-7, 7), y: rnd(-9, 0) }); Body.setAngularVelocity(s, rnd(-.4, .4)); }
}
function shrapnel(x, y, n) { for (let i = 0; i < n; i++) { const a = rnd(0, 6.3), s = ball(x + Math.cos(a) * .25, y + Math.sin(a) * .25, .05, { color: 0x2b2b2b, den: 8, kind: 'shrap', group: -7777, depth: .08, p: { ttl: .8 }, noroot: 1 }); Body.setVelocity(s, { x: Math.cos(a) * 27, y: -Math.sin(a) * 27 }); } }
function explode(x, y, pow = 1) {
  const R = 5.5 * pow;
  for (const b of bodiesAll()) {
    const p = mpos(b), dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy); if (d > R || b.plugin.dead) continue; const k = 1 - d / R, P = b.plugin;
    if (P.doll) {
      const dd = P.doll; if (P.part === 'chest') { hurt(dd, 70 * k * pow, b, 4, 'blast'); if (k > .72) later.push(() => gibs(p.x, p.y, 6)); }
      if (k > .3) { blood(p.x, p.y, 5, 6); dd.char = Math.min(1, (dd.char || 0) + k * .15); }
      if (GORE && P.part !== 'pelvis' && k > .5 && Math.random() < (k - .5) * 1.1 * pow) later.push(() => sever(dd, P.part));
    }
    else if (P.kind === 'tnt' || P.kind === 'mine' || P.kind === 'bomb' || P.kind === 'nuke' || P.kind === 'grenade' || P.kind === 'cluster') P.fuse = Math.min(P.fuse ?? 9, .12 + d * .04);
    else if (P.kind === 'glass' || P.kind === 'melon' || P.kind === 'balloon') later.push(() => smash(b));
    else if ((P.tex === 'wood' || P.tex === 'wood2') && !b.isStatic && !P.kind && k > .62 && b.area < 3 * S * S) later.push(() => splinter(b));
    if (b.isStatic) continue;
    const v = k * 26 * pow / Math.max(.6, Math.sqrt(b.mass) * .6), n = d || 1;
    Body.setVelocity(b, { x: b.velocity.x + dx / n * v, y: b.velocity.y - (dy / n * v + k * 4) }); Body.setAngularVelocity(b, b.angularVelocity + rnd(-.3, .3) * k);
  }
  puff(x, y, 50 * pow, FIRE, 11 * pow); puff(x, y, 30 * pow, [0x333333, 0x555555, 0x777777], 3 * pow, 1.6, 2.6); puff(x, y, 14, [0x3b2a1a, 0x222222], 9 * pow, 0, 1.2);
  ring(x, y, R); ring(x, y, R * .6, 0xffb300); if (y < 1.5) splat(x, 0, 1.3 * pow, true);
  cam.shake = Math.max(cam.shake, .5 * pow); sfx('boom', Math.min(1.5, pow)); flash(pow > 2 ? .8 : .12);
}
function smash(b) {
  if (b.plugin.dead) return; const p = mpos(b), k = b.plugin.kind, a = b.angle; kill(b);
  if (k === 'glass') { sfx('glass'); for (let i = 0; i < 6; i++) { const s = poly(p.x + rnd(-.4, .4), p.y + rnd(-.4, .4), [[0, 0], [rnd(.2, .4), 0], [rnd(0, .2), rnd(.2, .45)]], { color: 0xbfefff, alpha: .55, depth: .1, kind: 'shrap', p: { ttl: 6 }, noroot: 1 }); Body.setVelocity(s, { x: rnd(-4, 4), y: rnd(-5, 1) }); Body.setAngle(s, a + rnd(0, 6)); } }
  else if (k === 'melon') { sfx('squish'); puff(p.x, p.y, 30, [0xff4d6d, 0xff8fa3, 0x2f9e44], 6); for (let i = 0; i < 4; i++) { const s = ball(p.x + rnd(-.2, .2), p.y + rnd(-.2, .2), .16, { emoji: '🍉', p: { ttl: 8 }, noroot: 1 }); Body.setVelocity(s, { x: rnd(-5, 5), y: rnd(-6, 0) }); } }
  else { sfx('pop'); puff(p.x, p.y, 14, CONF, 5); }
}
function ignite(b, t = 6) { if (b.plugin.kind === 'lava' || b.plugin.map) return; b.plugin.burn = Math.max(b.plugin.burn || 0, t); }
function strike(x, y) {
  bolt(x, y); sfx('zap'); flash(.25); puff(x, y, 24, [0xfff7a8, 0xffffff, 0x8fd3ff], 8); cam.shake = Math.max(cam.shake, .15);
  for (const b of bodiesAll()) { const p = mpos(b); if (Math.hypot(p.x - x, p.y - y) > 1.6) continue; const P = b.plugin; if (P.doll) { if (P.part === 'chest') { hurt(P.doll, 30, b, 3.5, 'burn'); P.doll.char = Math.min(1, (P.doll.char || 0) + .3); } ignite(b, 2); } if (P.kind === 'tnt' || P.kind === 'bomb' || P.kind === 'nuke' || P.kind === 'grenade') P.fuse = .1; if (!b.isStatic) Body.setVelocity(b, { x: b.velocity.x + rnd(-3, 3), y: b.velocity.y - 7 }); if (P.tex === 'wood' || P.tex === 'wood2') ignite(b); }
}

// ---------- ragdolls ----------
const MODELS = {};
const SKINS = { dummy: ['Test Dummy', 0xffb84d, 0x4d8cff], zombie: ['Zombie', 0x7bc96f, 0x5a4a78], alien: ['Alien', 0xc77dff, 0x30e0c0], skeleton: ['Skeleton', 0xf3f0e6, 0xdedacb], robot: ['Robot', 0xaab4c4, 0xff5c5c] };
const HOSTILE = { zombie: 1, robot: 1, alien: 1, skeleton: 1 };
function dummyPts(H) { const k = H / 1.7, P = { Hips: [0, .92], Spine1: [0, 1.12], Neck: [0, 1.42], Head: [0, 1.46], HeadTop_End: [0, 1.74] }; for (const [s, n] of [[1, 'Left'], [-1, 'Right']]) { P[n + 'Arm'] = [s * .2, 1.38]; P[n + 'ForeArm'] = [s * .48, 1.38]; P[n + 'Hand'] = [s * .72, 1.38]; P[n + 'UpLeg'] = [s * .1, .9]; P[n + 'Leg'] = [s * .1, .5]; P[n + 'Foot'] = [s * .1, .07]; } for (const n in P) P[n] = { x: P[n][0] * k, y: P[n][1] * k, z: 0 }; return P; }
let dollSeq = 0; const Z = new THREE.Vector3(0, 0, 1), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v1 = new THREE.Vector3();
function buildDoll(kind, x, y) {
  const d = { id: ++dollSeq, kind, hp: 100, alive: true, stun: 0, popT: -9, groundT: -9, atkT: 0, char: 0, blood: 100, pain: 0, bpm: 70, temp: 37, parts: {}, bodies: [], lim: [], drive: [], jt: {}, cut: {}, broken: {}, marks: [] };
  let P, bones = null; const skin = SKINS[kind];
  if (MODELS[kind]) {
    d.inst = instance(MODELS[kind]); d.model = d.inst.root; scene.add(d.model); d.model.updateMatrixWorld(true); bones = d.inst.bones; P = {};
    for (const n in bones) { const w = bones[n].getWorldPosition(new THREE.Vector3()); P[n] = { x: w.x, y: w.y, z: w.z }; }
  } else P = dummyPts(kind === 'robot' ? 1.9 : 1.7);
  d.name = skin ? skin[0] : CHARS[kind][0];
  const H = P.HeadTop_End.y, g = -d.id, lt = H * .075, at = H * .06; d.lt = lt; d.at = at;
  const mk = (name, b, color) => { b.collisionFilter.group = g; add(b, { nomesh: !!d.model, color, depth: .34, noroot: 1 }); b.plugin.doll = d; b.plugin.part = name; d.parts[name] = b; d.bodies.push(b); return b; };
  const o = { friction: .8, density: .0012, frictionAir: .012, restitution: .05 };
  const seg = (name, a, b, th, ext, color) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) * ext, ux = dx / (len / ext), uy = dy / (len / ext); const bd = mk(name, Bodies.rectangle((x + a.x + ux * len / 2) * S, -(y + a.y + uy * len / 2) * S, len * S, th * S, { ...o, chamfer: { radius: th * S * .35 } }), color); Body.setAngle(bd, Math.atan2(-dy, dx)); bd.plugin.a0 = bd.angle; return bd; };
  const c1 = skin?.[1], c2 = skin?.[2];
  const hipY = (P.LeftUpLeg.y + P.RightUpLeg.y) / 2, sw = Math.abs(P.LeftArm.x - P.RightArm.x), hw = Math.abs(P.LeftUpLeg.x - P.RightUpLeg.x) + lt * 1.2;
  const rect = (name, cy, w, h, color) => { const b = mk(name, Bodies.rectangle(x * S, -(y + cy) * S, w * S, h * S, { ...o, chamfer: { radius: 5 } }), color); b.plugin.a0 = 0; return b; };
  const pelvis = rect('pelvis', (hipY + P.Spine1.y) / 2, hw, P.Spine1.y - hipY + .1, c2);
  const chest = rect('chest', (P.Spine1.y + P.Neck.y) / 2, sw * .95, P.Neck.y - P.Spine1.y + .02, c2);
  const hr = Math.max((P.HeadTop_End.y - P.Head.y) * .55, H * .075);
  const head = mk('head', Bodies.circle(x * S, -(y + (P.Head.y + P.HeadTop_End.y) / 2) * S, hr * S, o), c1); head.plugin.a0 = 0;
  if (skin) { const f = new THREE.Mesh(new THREE.PlaneGeometry(hr * 2.3, hr * 2.3), emojiMat({ dummy: '🙂', zombie: '🧟', alien: '👽', skeleton: '💀', robot: '🤖' }[kind])); f.position.z = .22; head.plugin.mesh.add(f); }
  const J = (a, b, pt, min, max) => { const px = (x + pt.x) * S, py = -(y + pt.y) * S; d.jt[b.plugin.part] = link(a, b, { x: px - a.position.x, y: py - a.position.y }, { x: px - b.position.x, y: py - b.position.y }, { st: .95, damp: .1 }); d.lim.push([a, b, min, max, b.plugin.part]); };
  J(pelvis, chest, { x: 0, y: P.Spine1.y }, -.35, .35); J(chest, head, { x: 0, y: P.Head.y }, -.6, .6);
  for (const [n, s] of [['Left', 'L'], ['Right', 'R']]) {
    const ua = seg('arm' + s, P[n + 'Arm'], P[n + 'ForeArm'], at, 1, c1), fa = seg('fore' + s, P[n + 'ForeArm'], P[n + 'Hand'], at * .9, 1.35, c1);
    const th = seg('thigh' + s, P[n + 'UpLeg'], P[n + 'Leg'], lt, 1, c2), sh = seg('shin' + s, P[n + 'Leg'], { x: P[n + 'Leg'].x, y: Math.min(P[n + 'Foot'].y - H * .04, P[n + 'Foot'].y * .3) }, lt * .9, 1, c1);
    J(chest, ua, P[n + 'Arm'], -3.4, 3.4); J(ua, fa, P[n + 'ForeArm'], -2.4, 2.4); J(pelvis, th, P[n + 'UpLeg'], -1.4, 1.4); J(th, sh, P[n + 'Leg'], -2, 2);
    if (bones) d.drive.push([bones[n + 'Arm'], ua], [bones[n + 'ForeArm'], fa], [bones[n + 'UpLeg'], th], [bones[n + 'Leg'], sh]);
  }
  if (bones) {
    d.drive.unshift([bones.Hips, pelvis], [bones.Spine, chest], [bones.Head, head]);
    d.drive.sort((a, b) => depth(a[0]) - depth(b[0]));
    for (const e of d.drive) { e[2] = e[0].getWorldQuaternion(new THREE.Quaternion()); const w = e[0].getWorldPosition(new THREE.Vector3()), bd = e[1]; e[3] = { x: w.x - (bd.position.x / S - x), y: w.y - (-bd.position.y / S - y), z: w.z }; }
    d.hipZ = P.Hips.z;
  }
  d.restH = ((P.Spine1.y + P.Neck.y) / 2) * S; d.mass = d.bodies.reduce((s, b) => s + b.mass, 0);
  d.tag = document.createElement('div'); d.tag.className = 'tag'; d.tag.innerHTML = `${d.name}<u><s></s></u>`; $('#fx').append(d.tag); d.bar = d.tag.querySelector('s');
  d.root = curItem; d.ox = 0; d.oy = pelvis.position.y / -S - y; dolls.push(d); return d;
}
const depth = o => { let n = 0; while (o.parent) { n++; o = o.parent; } return n; };
function driveDoll(d) {
  for (const [bone, body, q0, off] of d.drive) {
    const th = -(body.angle - body.plugin.a0), part = body.plugin.part;
    if (part === 'pelvis' || d.cut[part]) { bone.parent.updateWorldMatrix(true, false); v1.set(off.x, off.y, 0).applyAxisAngle(Z, th); v1.x += body.position.x / S; v1.y += -body.position.y / S; v1.z = off.z; bone.parent.worldToLocal(v1); bone.position.copy(v1); }
    q1.setFromAxisAngle(Z, th).multiply(q0); bone.parent.getWorldQuaternion(q2); bone.quaternion.copy(q2.invert().multiply(q1));
  }
}
function attack(d, o) {
  d.atkT = T + rnd(.45, 1); const P = d.parts, arm = pick(['foreL', 'foreR'].filter(n => !P[n].plugin.off)), tb = pick([o.parts.head, o.parts.chest, o.parts.armL, o.parts.armR, o.parts.chest]);
  const dir = Math.sign(tb.position.x - P.chest.position.x) || 1; if (arm) Body.setVelocity(P[arm], { x: dir * 15, y: -4 });
  const sharp = d.kind === 'zombie' || d.kind === 'skeleton' || d.kind === 'alien';
  hurt(o, rnd(5, 13) * (d.kind === 'robot' ? 1.6 : 1), tb, .45, sharp ? 'sharp' : 'blunt');
  Body.setVelocity(tb, { x: tb.velocity.x + dir * rnd(3, 7), y: tb.velocity.y - rnd(1, 4) });
  if (o.hp < 45 && Math.random() < .14) sever(o, pick(['armL', 'armR', 'foreL', 'foreR', 'head', 'shinL', 'shinR']));
}
function tickDoll(d, dt) {
  if (d.stun > 0) d.stun -= dt;
  if (!GORE && !d.alive && !d.nap) { if ((d.koT = (d.koT || 0) + dt) > 6) { d.koT = 0; return heal(d); } } else d.koT = 0;
  const P = d.parts, gy = engine.gravity.y, held = drag && drag.b.plugin.doll === d, ok = n => !P[n].plugin.off && !d.broken[n];
  const legs = ['L', 'R'].filter(s => ok('thigh' + s) && ok('shin' + s));
  const up = d.alive && d.stun <= 0 && !held && !P.chest.isStatic && legs.length && !P.chest.plugin.off && !d.cut.head;
  for (const [a, b, min, max] of d.lim) { const r = (b.angle - b.plugin.a0) - (a.angle - a.plugin.a0); if (r < min) Body.setAngularVelocity(b, b.angularVelocity + (min - r) * .25); else if (r > max) Body.setAngularVelocity(b, b.angularVelocity - (r - max) * .25); }
  for (const part in d.jt) if (!d.cut[part]) { const c = d.jt[part], a = c.bodyA, b = c.bodyB, st = Math.hypot(a.position.x + c.pointA.x - b.position.x - c.pointB.x, a.position.y + c.pointA.y - b.position.y - c.pointB.y); if (st > S * (part === 'chest' ? .55 : .42)) { if ((c.plugin.strain = (c.plugin.strain || 0) + 1) > 8) later.push(() => sever(d, part)); } else c.plugin.strain = 0; }
  if (up && gy > 0) {
    for (const n of ['chest', 'pelvis', 'thighL', 'thighR', 'shinL', 'shinR', 'head']) if (ok(n)) { const b = P[n], e = wrap(b.angle - b.plugin.a0); Body.setAngularVelocity(b, b.angularVelocity * .8 - e * .13); }
    for (const [n, off] of [['armL', .25], ['armR', -.25], ['foreL', .1], ['foreR', -.1]]) if (ok(n)) { const b = P[n], e = wrap(b.angle - Math.PI / 2 + off); Body.setAngularVelocity(b, b.angularVelocity * .9 - e * .05); }
    if (T - d.groundT < .2) {
      const feet = Math.max(...legs.map(s => P['shin' + s].bounds.max.y)), err = d.restH - (feet - P.chest.position.y);
      const k = clamp(err / (S * .12), 0, 2.2), f = d.mass * .001 * gy * k;
      Body.applyForce(P.chest, P.chest.position, { x: 0, y: -f * .6 }); Body.applyForce(P.pelvis, P.pelvis.position, { x: 0, y: -f * .4 });
      if (P.chest.velocity.y < -2) Body.setVelocity(P.chest, { x: P.chest.velocity.x * .9, y: P.chest.velocity.y * .7 });
      // fighters walk to the nearest victim and attack
      if (BRAWL || HOSTILE[d.kind]) {
        let best = null, bd = 16; for (const o of dolls) if (o !== d && o.alive && (BRAWL || o.kind !== d.kind)) { const dx = Math.abs(o.parts.chest.position.x - P.chest.position.x) / S; if (dx < bd) { bd = dx; best = o; } }
        if (best) {
          const dir = Math.sign(best.parts.chest.position.x - P.chest.position.x);
          if (bd > .75) { Body.setVelocity(P.pelvis, { x: clamp(P.pelvis.velocity.x + dir * .3, -2, 2), y: P.pelvis.velocity.y }); const s = Math.sin(T * 9) * .05; Body.setAngularVelocity(P.thighL, P.thighL.angularVelocity + s); Body.setAngularVelocity(P.thighR, P.thighR.angularVelocity - s); }
          if (bd < 1.15 && T > d.atkT && Math.abs(best.parts.chest.position.y - P.chest.position.y) < 1.6 * S) attack(d, best);
        }
      }
    }
  }
  if (d.bodies.some(b => b.plugin.burn > 0)) { d.hp = Math.max(0, d.hp - 8 * dt); d.char = Math.min(1, d.char + dt * .14); }
  let bl = 0; for (const k of d.marks) if (k.bleed > 0) bl += k.type === 'stump' ? 2.4 : .6;
  const burning = d.bodies.some(b => b.plugin.burn > 0), frozen = P.chest.isStatic && d.frozen;
  d.blood = clamp(d.blood - bl * dt + (bl || !d.alive ? 0 : .4 * dt), 0, 100); d.pain = Math.max(0, d.pain - 4 * dt);
  d.temp += ((burning ? 80 : frozen ? -5 : d.alive ? 37 : 20) - d.temp) * dt * (burning ? .22 : frozen ? .5 : .07);
  if (d.alive) {
    if (d.blood < 45) d.hp = Math.max(0, d.hp - (45 - d.blood) * .12 * dt); if (d.blood < 12) d.hp = 0;
    if (d.temp > 44) d.hp = Math.max(0, d.hp - (d.temp - 44) * .3 * dt); if (d.temp < 28) { d.hp = Math.max(0, d.hp - (28 - d.temp) * .15 * dt); d.stun = Math.max(d.stun, .5); }
    if (d.pain > 88) d.stun = Math.max(d.stun, 1.5);
  }
  d.bpm = d.alive ? clamp(68 + d.pain * .7 + (100 - d.blood) * .7 + (d.temp - 37) * 2 - (d.nap ? 15 : 0), 25, 215) : 0;
  if (d.hp <= 0 && d.alive) die(d);
  if (d.char > 0) { const c = 1 - d.char * .6; if (d.inst) d.inst.mesh.material.color.setScalar(c); }
  if (d.model) driveDoll(d);
  const hb = P.head, hp = mpos(hb), s = toScreen(hp.x, hp.y + hb.circleRadius / S + .15);
  d.tag.style.left = s.x + 'px'; d.tag.style.top = s.y + 'px'; d.bar.style.width = d.hp + '%'; d.bar.style.background = d.hp > 50 ? '#4de36b' : d.hp > 20 ? '#ffd23f' : '#ff4d4d';
}

// ---------- items ----------
const ITEMS = {}, CATS = ['People', 'Blocks', 'Toys', 'Weapons', 'Machines', 'Danger', 'Elements', 'Disasters'];
const item = (id, cat, name, icon, fn, ev) => ITEMS[id] = { id, cat, name, icon, fn, ev };
for (const k in CHARS) item(k, 'People', CHARS[k][0], { martleboro: '🧢', louis_g: '🟢', apricot: '👑' }[k], (x, y) => buildDoll(k, x, y));
for (const k in SKINS) item(k, 'People', SKINS[k][0], { dummy: '🧍', zombie: '🧟', alien: '👽', skeleton: '💀', robot: '🤖' }[k], (x, y) => buildDoll(k, x, y));
item('dragon', 'People', 'Dragon', '🐉', (x, y) => box(x, y + .8, 1.8, 1.5, { emoji: '🐉', kind: 'dragon', den: 1.5 }));
// blocks
item('plank', 'Blocks', 'Plank', '🪵', (x, y) => box(x, y + .1, 3, .2, { tex: 'wood' }));
item('lplank', 'Blocks', 'Long Plank', '📏', (x, y) => box(x, y + .1, 6, .22, { tex: 'wood' }));
item('post', 'Blocks', 'Post', '🪜', (x, y) => box(x, y + 1.25, .3, 2.5, { tex: 'wood2' }));
item('crate', 'Blocks', 'Crate', '📦', (x, y) => box(x, y + .5, 1, 1, { tex: 'wood2' }));
item('brick', 'Blocks', 'Brick Block', '🧱', (x, y) => box(x, y + .4, 1.6, .8, { tex: 'brick', den: 2 }));
item('stone', 'Blocks', 'Stone Block', '🪨', (x, y) => box(x, y + .6, 1.2, 1.2, { tex: 'stone', den: 3 }));
item('slab', 'Blocks', 'Stone Slab', '⬛', (x, y) => box(x, y + .2, 4, .4, { tex: 'flag', den: 3 }));
item('beam', 'Blocks', 'Metal Beam', '🔩', (x, y) => box(x, y + .12, 4, .24, { tex: 'metal', metal: .8, den: 4 }));
item('ramp', 'Blocks', 'Ramp', '📐', (x, y) => poly(x, y + .5, [[0, 0], [3, 0], [3, 1.4]], { tex: 'wood' }));
item('wheel', 'Blocks', 'Wheel', '🛞', (x, y) => ball(x, y + .45, .45, { tex: 'wood2', fr: .95 }));
item('glass', 'Blocks', 'Glass', '🪟', (x, y) => box(x, y + 1, .18, 2, { color: 0xbfefff, alpha: .5, kind: 'glass' }));
item('ice', 'Blocks', 'Ice Block', '🧊', (x, y) => box(x, y + .5, 2, 1, { color: 0x9fe8ff, alpha: .8, fr: 0 }));
item('jelly', 'Blocks', 'Bouncy Jelly', '🟣', (x, y) => box(x, y + .5, 1.4, 1, { color: 0xd16bff, alpha: .85, re: .95 }));
item('tramp', 'Blocks', 'Trampoline', '🤸', (x, y) => box(x, y + .15, 3, .3, { color: 0x29c7ac, re: 1.25, static: 1, kind: 'tramp' }));
item('wall', 'Blocks', 'Solid Wall', '🧱', (x, y) => box(x, y + 2, .6, 4, { tex: 'brick', static: 1 }));
item('floor', 'Blocks', 'Floating Floor', '➖', (x, y) => box(x, y, 5, .4, { tex: 'flag', static: 1 }));
// toys
const toy = (id, name, e, r, o = {}) => item(id, 'Toys', name, e, (x, y) => o.box ? box(x, y + r, r * 2, r * 2, { emoji: e, ...o }) : ball(x, y + r, r, { emoji: e, ...o }));
toy('soccer', 'Soccer Ball', '⚽', .3, { re: .75 }); toy('bball', 'Basketball', '🏀', .34, { re: .85 }); toy('beach', 'Beach Ball', '🏐', .55, { re: .8, den: .1, air: .02 });
toy('bowl', 'Bowling Ball', '🎳', .35, { den: 8 }); toy('duck', 'Rubber Duck', '🦆', .35, { re: .6 }); toy('teddy', 'Teddy', '🧸', .45, { box: 1 });
toy('gift', 'Present', '🎁', .45, { box: 1 }); toy('pumpkin', 'Pumpkin', '🎃', .45, { den: 1.5 }); toy('melon', 'Watermelon', '🍉', .42, { kind: 'melon' });
toy('piano', 'Piano', '🎹', .8, { box: 1, den: 6 }); toy('toilet', 'Toilet', '🚽', .5, { box: 1, den: 3 }); toy('cheese', 'Cheese', '🧀', .4, { box: 1 });
toy('donut', 'Donut', '🍩', .4, { re: .5 }); toy('moai', 'Statue', '🗿', .7, { box: 1, den: 7 });
item('balloon', 'Toys', 'Balloon', '🎈', (x, y) => ball(x, y + .5, .4, { emoji: '🎈', kind: 'balloon', den: .15, air: .03 }));
item('seesaw', 'Toys', 'Seesaw', '⚖️', (x, y) => { const b = poly(x, y + .35, [[-.6, 0], [.6, 0], [0, .8]], { tex: 'stone', static: 1, group: -9001 }); const p = box(x, y + .9, 6, .2, { tex: 'wood', group: -9001 }); link(null, p, { x: x * S, y: -(y + .9) * S }, { x: 0, y: 0 }, { vis: 'pin' }); return b; });
// weapons
item('sword', 'Weapons', 'Sword', '🗡️', (x, y) => box(x, y + .9, .16, 1.8, { tex: 'metal', metal: .9, den: 3, kind: 'sword' }));
item('hammer', 'Weapons', 'Giant Hammer', '🔨', (x, y) => { const h = box(x, y + 1.2, .18, 2.4, { tex: 'wood2', group: -9100 - (++dollSeq) }); const m = box(x, y + 2.4, 1.4, .8, { tex: 'metal', metal: .8, den: 6, group: -9100 - dollSeq }); link(h, m, { x: 0, y: -1.2 * S }, { x: 0, y: 0 }); link(h, m, { x: 0, y: -.8 * S }, { x: 0, y: .4 * S }, {}); return h; });
item('chainsaw', 'Weapons', 'Chainsaw', '🪚', (x, y) => box(x, y + .3, 1.6, .5, { emoji: '🪚', kind: 'saw' }));
item('anvil', 'Weapons', 'Anvil', '⚓', (x, y) => poly(x, y + .4, [[-.7, .8], [.7, .8], [.4, 0], [-.4, 0]], { tex: 'metal', metal: .7, den: 12 }));
item('bomb', 'Weapons', 'Bomb (3s)', '💣', (x, y) => ball(x, y + .35, .35, { emoji: '💣', kind: 'bomb', p: { fuse: 3 } }));
item('tnt', 'Weapons', 'TNT', '🧨', (x, y) => box(x, y + .4, .8, .8, { color: 0xe2334b, kind: 'tnt' }));
item('mine', 'Weapons', 'Landmine', '🔴', (x, y) => box(x, y + .08, .8, .16, { color: 0x3d4a3d, kind: 'mine', p: { arm: T + 1 } }));
item('nuke', 'Weapons', 'Mega Bomb', '☢️', (x, y) => box(x, y + .7, 1, 1.4, { emoji: '☢️', kind: 'nuke', den: 3, p: { fuse: 4 } }));
item('wreck', 'Weapons', 'Wrecking Ball', '⛓️', (x, y) => { const a = box(x, y + 7, .5, .5, { tex: 'metal', static: 1 }); const b = ball(x + 4, y + 7, .7, { tex: 'metal', metal: .8, den: 9 }); link(a, b, { x: 0, y: 0 }, { x: 0, y: 0 }, { len: 4 * S, st: 1, vis: 'chain' }); return a; });
item('grenade', 'Weapons', 'Grenade', '🍍', (x, y) => ball(x, y + .2, .16, { color: 0x3d5a2a, kind: 'grenade', den: 3, re: .35, p: { fuse: 3 } }));
item('cluster', 'Weapons', 'Cluster Bomb', '🍇', (x, y) => ball(x, y + .3, .26, { color: 0x4a2d6b, kind: 'cluster', den: 3, re: .3, p: { fuse: 3 } }));
item('scissors', 'Weapons', 'Giant Scissors', '✂️', (x, y) => box(x, y + .7, 2.2, 1.3, { emoji: '✂️', kind: 'sword', den: 2 }));
item('axe', 'Weapons', 'Axe', '🪓', (x, y) => box(x, y + .6, 1.1, 1.1, { emoji: '🪓', kind: 'sword', den: 4 }));
item('knife', 'Weapons', 'Knife', '🔪', (x, y) => box(x, y + .4, .8, .8, { emoji: '🔪', kind: 'sword', den: 2 }));
item('hook', 'Weapons', 'Meat Hook', '🪝', (x, y) => { const a = box(x, y + 6, .5, .5, { tex: 'metal', static: 1 }); const h = ball(x, y + 3.2, .22, { emoji: '🪝', kind: 'hook', den: 4 }); link(a, h, { x: 0, y: 0 }, { x: 0, y: 0 }, { len: 2.8 * S, st: .9, vis: 'chain', rope: 1 }); return a; });
// machines
item('thruster', 'Machines', 'Rocket', '🚀', (x, y) => box(x, y + .5, .5, 1, { color: 0xff7b2f, kind: 'thruster', den: 1.2 }));
item('fan', 'Machines', 'Fan', '🌀', (x, y) => box(x, y + .6, .5, 1.2, { color: 0x4db8ff, kind: 'fan', static: 1 }));
item('cannon', 'Machines', 'Cannon', '🎯', (x, y) => box(x, y + .4, 1.6, .7, { tex: 'metal', metal: .8, kind: 'cannon', static: 1, ang: -.4, p: { cd: 1 } }));
item('spinner', 'Machines', 'Spinner', '➕', (x, y) => { const b = box(x, y + 2.5, 5, .3, { tex: 'metal', metal: .7, kind: 'spinner', den: 3 }); link(null, b, { x: x * S, y: -(y + 2.5) * S }, { x: 0, y: 0 }, { vis: 'pin' }); return b; });
item('conv', 'Machines', 'Conveyor', '➡️', (x, y) => box(x, y + .15, 5, .3, { color: 0x555b66, kind: 'conv', static: 1, fr: 1 }));
item('car', 'Machines', 'Car', '🚗', (x, y) => { const g = -9100 - (dollSeq++); const c = box(x, y + .75, 2.6, .6, { color: 0xe2334b, kind: 'car', group: g, p: { wheels: [] } }); for (const s of [-1, 1]) { const w = ball(x + s * .85, y + .42, .42, { tex: 'wood2', fr: 1, group: g }); link(c, w, { x: s * .85 * S, y: .33 * S }, { x: 0, y: 0 }, { st: .8 }); c.plugin.wheels.push(w); } return c; });
item('magnet', 'Machines', 'Magnet', '🧲', (x, y) => box(x, y + .5, 1, 1, { emoji: '🧲', kind: 'magnet', static: 1 }));
item('portalpad', 'Machines', 'Launch Pad', '⏫', (x, y) => box(x, y + .1, 2, .2, { color: 0xffd23f, kind: 'pad', static: 1 }));
// danger
item('spikes', 'Danger', 'Spikes', '🔺', (x, y) => box(x, y + .15, 3, .3, { tex: 'metal', metal: .8, shape: 'spikes', kind: 'spikes', static: 1 }));
item('saw', 'Danger', 'Saw Blade', '⚙️', (x, y) => ball(x, y + 1, .8, { tex: 'metal', metal: .9, shape: 'star', kind: 'saw', static: 1, depth: .12 }));
item('lava', 'Danger', 'Lava', '🌋', (x, y) => box(x, y + .15, 5, .3, { color: 0xff5a1f, emis: 0xff3300, kind: 'lava', static: 1 }));
item('bhole', 'Danger', 'Black Hole', '⚫', (x, y) => ball(x, y + 1.5, .7, { color: 0x100018, emis: 0x220044, kind: 'bhole', static: 1, sensor: 1, depth: .1 }));
item('tornado', 'Danger', 'Tornado', '🌪️', (x, y) => box(x, y + 2, 2, 4, { emoji: '🌪️', kind: 'tornado', static: 1, sensor: 1, p: { x0: x } }));
item('ufo', 'Danger', 'UFO', '🛸', (x, y) => box(x, y + 7, 2.4, 1.2, { emoji: '🛸', kind: 'ufo', static: 1, sensor: 1, p: { x0: x } }));
// elements
const grains = (id, name, e, color, n, r, o) => item(id, 'Elements', name, e, (x, y) => { let f; for (let i = 0; i < n; i++) { const b = ball(x + rnd(-.5, .5), y + .3 + rnd(0, 1.2), r, { color, depth: .25, ...o }); f ??= b; } return f; });
grains('sand', 'Sand', '⏳', 0xe8c56a, 26, .1, { fr: .9, den: 2, p: { grain: 1 } }); grains('water', 'Water', '💧', 0x3fa9ff, 30, .11, { fr: 0, re: .1, alpha: .75, p: { grain: 1, wet: 1 } });
grains('snow', 'Snowballs', '❄️', 0xffffff, 14, .16, { fr: .3, den: .4 }); grains('slime', 'Slime', '🟢', 0x5be35b, 20, .14, { fr: 1, re: .7, alpha: .8, p: { grain: 1 } });
item('fire', 'Elements', 'Campfire', '🔥', (x, y) => box(x, y + .15, 1.2, .3, { tex: 'wood2', kind: 'campfire', static: 1 }));
// disasters (instant events)
const ev = (id, name, e, fn) => item(id, 'Disasters', name, e, fn, true);
const every = (n, ms, fn) => { for (let i = 0; i < n; i++) setTimeout(() => !paused && fn(i), i * ms); };
ev('meteors', 'Meteors', '☄️', () => every(10, 260, () => { const b = ball(cam.x + rnd(-12, 12), cam.y + cam.h / 2 + 3, rnd(.3, .6), { tex: 'stone', den: 5, kind: 'meteor', p: { burn: 9, ttl: 15 }, noroot: 1 }); Body.setVelocity(b, { x: rnd(-6, 6), y: 14 }); }));
ev('quake', 'Earthquake', '🫨', () => { cam.shake = 1; sfx('boom', .7); every(40, 50, () => { for (const b of bodiesAll()) if (!b.isStatic && Math.abs(b.velocity.y) < 2) Body.setVelocity(b, { x: b.velocity.x + rnd(-2.5, 2.5), y: b.velocity.y - rnd(0, 3) }); cam.shake = .5; }); });
ev('storm', 'Thunderstorm', '⛈️', () => every(9, 350, () => { const d = pick(dolls); const x = d && Math.random() < .6 ? mpos(d.parts.head).x : cam.x + rnd(-12, 12); strike(x, groundYAt(x)); }));
ev('tsunami', 'Tsunami', '🌊', () => { every(60, 30, () => { for (const b of bodiesAll()) if (!b.isStatic) Body.applyForce(b, b.position, { x: b.mass * .0022, y: -b.mass * .0004 }); }); every(40, 40, i => { const b = ball(cam.x - cam.h + rnd(-1, 1), rnd(.3, 5), .13, { color: 0x3fa9ff, alpha: .75, fr: 0, depth: .25, p: { ttl: 14, wet: 1 }, noroot: 1 }); Body.setVelocity(b, { x: 16, y: -2 }); }); });
ev('swords', 'Sword Rain', '⚔️', () => every(12, 150, () => { const b = box(cam.x + rnd(-11, 11), cam.y + cam.h / 2 + 2, .16, 1.8, { tex: 'metal', metal: .9, den: 3, kind: 'sword', p: { ttl: 20 }, noroot: 1 }); Body.setVelocity(b, { x: 0, y: 16 }); }));
ev('rain', 'Toy Rain', '🎁', () => every(16, 140, () => { const id = pick(Object.keys(ITEMS).filter(k => ITEMS[k].cat === 'Toys' && k !== 'seesaw')); spawn(id, cam.x + rnd(-10, 10), cam.y + cam.h / 2 + 1, true); }));
ev('wind', 'Wind Gust', '💨', () => { const dir = pick([-1, 1]); every(50, 30, () => { for (const b of bodiesAll()) if (!b.isStatic) Body.applyForce(b, b.position, { x: dir * b.mass * .0012, y: 0 }); }); });
ev('gflip', 'Gravity Flip', '🙃', () => { setGrav(gravMode === 3 ? 0 : 3); });
ev('party', 'Confetti Party', '🎉', () => { every(14, 90, () => puff(cam.x + rnd(-12, 12), cam.y + rnd(-2, 6), 40, CONF, 7)); dolls.slice().forEach(heal); sfx('heal'); });
ev('tstop', 'Time Stop', '⏱️', () => togglePause());

function groundYAt(x) { let y = 0; for (const b of Query.ray(bodiesAll(), { x: x * S, y: -40 * S }, { x: x * S, y: 2 * S }).map(c => c.bodyA)) y = Math.max(y, -b.bounds.min.y / S); return y; }
function spawn(id, x, y, quiet) {
  const it = ITEMS[id]; if (!it) return; if (it.ev) { it.fn(); return; }
  created = []; curItem = id; spawnOrigin = { x, y }; const r = it.fn(x, y); curItem = null;
  if (!quiet) { undo.push({ bodies: created.slice(), doll: r && r.bodies ? r : null }); sfx('pop'); puff(x, y + .5, 8, [0xffffff], 3); }
  const out = created; created = []; return { r, bodies: out };
}

// per-kind behaviour
const fForce = (b, fx, fy) => Body.applyForce(b, b.position, { x: fx * .001, y: fy * .001 });
const TICK = {
  thruster(b) { if (!b.plugin.on) return; const a = b.angle - Math.PI / 2; fForce(b, Math.cos(a) * 12, Math.sin(a) * 12); const p = mpos(b); puff(p.x - Math.cos(a) * .6, p.y + Math.sin(a) * .6, 1, FIRE, 1.5, 0, .4); },
  balloon(b) { if (Math.abs(b.velocity.y) < 3.5) fForce(b, 0, -5.5 * Math.sign(engine.gravity.y || 1)); },
  fan(b, dt) { if (!b.plugin.on) return; const c = Math.cos(b.angle), s = Math.sin(b.angle); for (const o of bodiesAll()) { if (o.isStatic) continue; const dx = (o.position.x - b.position.x) / S, dy = (o.position.y - b.position.y) / S, f = dx * c + dy * s, side = Math.abs(-dx * s + dy * c); if (f > 0 && f < 9 && side < 1.3) fForce(o, c * o.mass * 2.6 * (1 - f / 9), s * o.mass * 2.6 * (1 - f / 9)); } if (Math.random() < .4) { const p = mpos(b); parts[pi] = { i: pi, x: p.x, y: p.y + rnd(-.5, .5), vx: c * 9, vy: -s * 9, l: .6, c: new THREE.Color(0xffffff), g: 0 }; pi = (pi + 1) % PN; } },
  cannon(b, dt) { if (!b.plugin.on) return; if ((b.plugin.cd -= dt) > 0) return; b.plugin.cd = 1.6; const c = Math.cos(b.angle), s = Math.sin(b.angle), p = mpos(b); const k = ball(p.x + c * 1.2, p.y - s * 1.2, .26, { tex: 'metal', metal: .9, den: 6, p: { ttl: 10 }, noroot: 1 }); Body.setVelocity(k, { x: c * 24, y: s * 24 }); puff(p.x + c, p.y - s, 8, [0x999999, 0xffffff], 3); sfx('thud'); },
  spinner(b) { if (b.plugin.on) Body.setAngularVelocity(b, .11); },
  car(b) { if (b.plugin.on) for (const w of b.plugin.wheels) if (!w.plugin.dead) Body.setAngularVelocity(w, w.angularVelocity * .9 + .045); },
  saw(b, dt) { if (b.isStatic && b.plugin.mesh) b.plugin.spin = (b.plugin.spin || 0) + dt * 14; },
  magnet(b) { if (!b.plugin.on) return; for (const o of bodiesAll()) { if (o.isStatic || !(o.plugin.tex === 'metal')) continue; const dx = b.position.x - o.position.x, dy = b.position.y - o.position.y, d = Math.hypot(dx, dy) / S; if (d < 8 && d > .3) fForce(o, dx / d / S * o.mass * 5 / d, dy / d / S * o.mass * 5 / d); } },
  bhole(b) { const p = mpos(b); for (const o of bodiesAll()) { if (o.isStatic) continue; const dx = b.position.x - o.position.x, dy = b.position.y - o.position.y, d = Math.hypot(dx, dy) / S; if (d > 11) continue; const f = Math.min(7, 30 / (d * d + .5)); fForce(o, (dx / d / S * f - dy / d / S * f * .35) * o.mass, (dy / d / S * f + dx / d / S * f * .35) * o.mass); if (d < .6) { if (o.plugin.doll) { if (o.plugin.part === 'chest') hurt(o.plugin.doll, 2, o, 1, false); } else later.push(() => { puff(p.x, p.y, 6, [0xc77dff, 0x000000], 3); kill(o); }); } } if (Math.random() < .3) { const a = rnd(0, 7); parts[pi] = { i: pi, x: p.x + Math.cos(a) * 2, y: p.y + Math.sin(a) * 2, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3, l: .6, c: new THREE.Color(0xc77dff), g: 0 }; pi = (pi + 1) % PN; } b.plugin.spin = (b.plugin.spin || 0) + .05; },
  tornado(b) { const x = b.plugin.x0 + Math.sin(T * .5) * 7; Body.setPosition(b, { x: x * S, y: b.position.y }); for (const o of bodiesAll()) { if (o.isStatic) continue; const dx = (b.position.x - o.position.x) / S, h = (b.bounds.max.y - o.position.y) / S; if (Math.abs(dx) < 2.2 && h > -1 && h < 9) fForce(o, (dx * 2 + Math.sin(T * 7 + o.id) * 3) * o.mass, -2.3 * o.mass); } b.plugin.mesh.scale.x = Math.abs(b.plugin.mesh.scale.x) * (Math.sin(T * 12) > 0 ? 1 : -1); },
  ufo(b) { const x = b.plugin.x0 + Math.sin(T * .4) * 9; Body.setPosition(b, { x: x * S, y: b.position.y }); const p = mpos(b); for (const o of bodiesAll()) { if (o.isStatic) continue; const dx = (b.position.x - o.position.x) / S, h = (o.position.y - b.position.y) / S; if (Math.abs(dx) < 1.3 && h > .8 && h < 12) fForce(o, dx * o.mass, -1.9 * o.mass); } if (Math.random() < .5) { parts[pi] = { i: pi, x: p.x + rnd(-1, 1), y: p.y - rnd(.5, 7), vx: 0, vy: 3, l: .5, c: new THREE.Color(0x8dffb0), g: 0 }; pi = (pi + 1) % PN; } },
  dragon(b, dt) { b.plugin.cd = (b.plugin.cd || 0) - dt; const p = mpos(b); let tgt = null, bd = 6; for (const d of dolls) { const q = mpos(d.parts.chest), dd = Math.hypot(q.x - p.x, q.y - p.y); if (dd < bd && d.alive) { bd = dd; tgt = q; } } if (tgt) { b.plugin.mesh.scale.x = Math.abs(b.plugin.mesh.scale.x) * (tgt.x < p.x ? 1 : -1); for (let i = 0; i < 2; i++) { const a = Math.atan2(tgt.y - p.y, tgt.x - p.x) + rnd(-.2, .2); parts[pi] = { i: pi, x: p.x, y: p.y + .2, vx: Math.cos(a) * 9, vy: Math.sin(a) * 9, l: bd / 9, c: new THREE.Color(pick(FIRE)), g: 0 }; pi = (pi + 1) % PN; } if (b.plugin.cd < 0) { b.plugin.cd = .5; for (const d of dolls) { const q = mpos(d.parts.chest); if (Math.hypot(q.x - p.x, q.y - p.y) < 6) d.bodies.forEach(x => ignite(x, 3)); } } } },
  campfire(b) { const p = mpos(b); puff(p.x + rnd(-.4, .4), p.y + .2, 1, FIRE, .6, 2.5, .7); },
  lava(b) { if (Math.random() < .15) { const p = mpos(b), w = (b.bounds.max.x - b.bounds.min.x) / S; puff(p.x + rnd(-w / 2, w / 2), p.y + .2, 1, FIRE, .5, 2, .6); } },
};
function tickBody(b, dt) {
  const P = b.plugin; if (P.dead) return;
  if (P.ttl !== undefined && (P.ttl -= dt) < 0) return later.push(() => kill(b));
  if (P.fuse !== undefined && (P.kind === 'bomb' || P.kind === 'nuke' || P.fuse < 5)) { P.fuse -= dt; if (P.kind === 'bomb' || P.kind === 'nuke') { const p = mpos(b); if (Math.random() < .5) puff(p.x, p.y + .4, 1, [0xffe14a, 0xff5a1f], 2, 0, .3); } if (P.fuse <= 0) return later.push(() => { const p = mpos(b); kill(b); boom(P.kind, p.x, p.y); }); }
  if (P.burn > 0) { P.burn -= dt; const p = mpos(b); if (Math.random() < .6) puff(p.x + rnd(-.2, .2), p.y + rnd(-.2, .2), 1, FIRE, .8, 2.2, .6); if (P.kind === 'tnt' || P.kind === 'bomb' || P.kind === 'nuke') P.fuse = Math.min(P.fuse ?? 9, .8); if (P.kind === 'balloon') later.push(() => smash(b)); if (P.burn <= 0 && (P.tex === 'wood' || P.tex === 'wood2') && P.mesh && !P.doll) P.mesh.material = charMat; }
  if (P.drip > 0) { P.drip -= dt; if (Math.random() < .4) { const p = mpos(b); blood(p.x, p.y, 1, .8); } }
  TICK[P.kind]?.(b, dt);
  if (b.position.y > 30 * S || Math.abs(b.position.x) > 80 * S) later.push(() => removeBody(b));
}

// collisions
function hit(a, b) {
  const A = a.plugin, B = b.plugin; if (!A || !B || A.dead || B.dead) return;
  const v = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
  if (A.doll) {
    if (B.doll === A.doll) return; const d = A.doll;
    if (A.part.startsWith('shin')) d.groundT = T;
    const sharp = SHARP[B.kind], part = A.part === 'pelvis' ? 'chest' : A.part;
    if (v > (sharp ? 4 : 9) && (b.isStatic || b.mass > .35 || sharp) && T - (d.hitT || 0) > (sharp ? .04 : .12) && (d.hitT = T)) {
      hurt(d, Math.min(45, (v - (sharp ? 2 : 9)) * (sharp ? 2.2 : 1.6) * (A.part === 'head' ? 1.6 : 1)), a, sharp ? 1.2 : 2.5, sharp ? 'sharp' : 'blunt');
      if (sharp ? (v > 8 && Math.random() < (B.kind === 'shrap' ? .07 : .5)) : (v > 21 && Math.random() < .4)) later.push(() => sever(d, part));
    }
  }
  if (A.kind === 'hook' && B.doll && !A.stuck) { A.stuck = 1; later.push(() => { if (a.plugin.dead || b.plugin.dead) return; link(a, b, { x: 0, y: 0 }, { x: a.position.x - b.position.x, y: a.position.y - b.position.y }, { st: 1, vis: 'weld' }); hurt(B.doll, 10, b, 2, 'sharp'); }); }
  if (A.kind === 'mine' && T > A.arm && !b.isStatic) A.fuse = 0;
  if (A.kind === 'tnt' && v > 12) A.fuse = 0;
  if (A.kind === 'meteor' && b.isStatic && !A.hitT) { A.hitT = 1; later.push(() => { const p = mpos(a); explode(p.x, p.y, .6); kill(a); }); }
  if ((A.kind === 'glass' && v > 6.5 && b.mass > .3) || (A.kind === 'melon' && v > 10) || (A.kind === 'balloon' && (B.kind === 'spikes' || B.kind === 'saw' || B.kind === 'sword'))) later.push(() => smash(a));
  if (A.kind === 'pad' && !b.isStatic) { later.push(() => { Body.setVelocity(b, { x: b.velocity.x + Math.sin(a.angle) * 22, y: -22 * Math.cos(a.angle) }); }); const p = mpos(a); puff(p.x, p.y, 8, [0xffd23f], 4); sfx('pop'); }
  if (A.kind === 'tramp' && !b.isStatic && v > 3) sfx('pop', .5);
  if (v > 5 && !A.grain && !B.grain) sfx('thud', Math.min(1, v / 14));
}
function touch(a, b) {
  const A = a.plugin, B = b.plugin; if (!A || !B || A.dead || B.dead) return;
  if (A.doll) {
    const d = A.doll; if (A.part.startsWith('shin') && B.doll !== d) d.groundT = T;
    if (B.kind === 'lava') { hurt(d, 1.2, a, 1.5, 'burn'); ignite(a, 3); Body.setVelocity(a, { x: a.velocity.x + rnd(-1, 1), y: -7 }); }
    else if (B.kind === 'spikes') { hurt(d, .7, a, 1.5, 'sharp'); }
    else if (B.kind === 'saw') { hurt(d, 2.5, a, 2, 'sharp'); if (Math.random() < .07) later.push(() => sever(d, A.part === 'pelvis' ? 'chest' : A.part)); Body.setVelocity(a, { x: a.velocity.x + rnd(2, 6) * Math.sign(a.position.x - b.position.x || 1), y: a.velocity.y - rnd(2, 5) }); const p = mpos(a); puff(p.x, p.y, 2, [0xffe14a, 0xffffff], 6); }
    else if (B.kind === 'campfire' || B.burn > 0) ignite(a, 3);
    else if (B.wet) { a.plugin.burn = 0; d.temp -= .04; }
  } else {
    if (B.kind === 'conv' && B.on && !a.isStatic) { const c = Math.cos(b.angle), s = Math.sin(b.angle); Body.setVelocity(a, { x: a.velocity.x + (c * 3.5 - a.velocity.x) * .15, y: a.velocity.y + (s * 3.5 - a.velocity.y) * .05 }); }
    if ((B.kind === 'lava' || B.kind === 'campfire' || (B.burn > 0 && (A.tex === 'wood' || A.tex === 'wood2'))) && !A.wet) { if (A.tex === 'wood' || A.tex === 'wood2' || A.kind === 'tnt' || A.kind === 'bomb' || A.kind === 'nuke' || A.kind === 'balloon') ignite(a, 5); }
    if (B.wet && A.burn > 0) A.burn = 0;
  }
  if (A.doll === undefined && B.kind === 'conv' && false) return;
}
Events.on(engine, 'collisionStart', e => { for (const p of e.pairs) { hit(p.bodyA, p.bodyB); hit(p.bodyB, p.bodyA); } });
Events.on(engine, 'collisionActive', e => { for (const p of e.pairs) { touch(p.bodyA, p.bodyB); touch(p.bodyB, p.bodyA); if (p.bodyA.plugin?.doll && p.bodyB.plugin?.kind === 'conv') { const a = p.bodyA, b = p.bodyB; if (b.plugin.on) Body.setVelocity(a, { x: a.velocity.x + (Math.cos(b.angle) * 3.5 - a.velocity.x) * .15, y: a.velocity.y }); } } });

// ---------- maps ----------
const MAPS = [
  { name: '🧪 Test Chamber', sky: ['#20242c', '#3a404b'], ground: { tex: 'flag', color: 0x9aa3ad }, hills: 0x2b3038, build() { for (const s of [-1, 1]) mapBox(s * 15, 6.5, 1, 13, { tex: 'stone', color: 0x8a929c }); mapBox(0, 13.5, 31, 1, { tex: 'stone', color: 0x8a929c }); for (let i = -3; i <= 3; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(.06, 13), new THREE.MeshBasicMaterial({ color: 0x4a515d })); m.position.set(i * 4, 6.5, -3); scene.add(m); decor.push(m); } for (let j = 1; j <= 3; j++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(30, .06), new THREE.MeshBasicMaterial({ color: 0x4a515d })); m.position.set(0, j * 3.25, -3); scene.add(m); decor.push(m); } const bg = new THREE.Mesh(new THREE.PlaneGeometry(30, 13), new THREE.MeshBasicMaterial({ color: 0x565d69 })); bg.position.set(0, 6.5, -4); scene.add(bg); decor.push(bg); } },
  { name: '🌳 Meadow', sky: ['#3fa2ff', '#c9efff'], ground: { color: 0x5ec84e }, hills: 0x4bb543, clouds: 1 },
  { name: '🏰 Castle Yard', sky: ['#ff9a5a', '#ffe3b0'], ground: { tex: 'flag' }, hills: 0x8a6f5a, clouds: 1, build() { for (const s of [-1, 1]) { mapBox(s * 14, 3, 3, 6, { tex: 'brick' }); mapBox(s * 14, 6.3, 4, .6, { tex: 'stone' }); } mapBox(0, 5.5, 8, .5, { tex: 'flag' }); } },
  { name: '🌙 Moon Base', sky: ['#05051a', '#27245c'], ground: { tex: 'stone', color: 0xbbbbcc }, hills: 0x55557a, grav: 1, stars: 1, build() { mapBox(-9, 1, 4, 2, { tex: 'stone' }); mapBox(10, 2.5, .6, 5, { tex: 'metal', metal: .6 }); } },
  { name: '🧸 Playroom', sky: ['#ffb3d1', '#fff1c9'], ground: { tex: 'rug' }, hills: 0xff8fb8, build() { mapBox(-12, 2, 5, .4, { tex: 'wood' }); mapBox(12, 4, 5, .4, { tex: 'wood' }); mapBox(0, 7, 4, .4, { tex: 'wood2' }); } },
];
let mapI = 0; const decor = [];
function mapBox(x, y, w, h, o) { const b = box(x, y, w, h, { ...o, static: 1, noroot: 1 }); b.plugin.map = true; return b; }
function loadMap(i) {
  for (const b of bodiesAll().slice()) { if (b.plugin.doll) removeDoll(b.plugin.doll); else kill(b); }
  decor.forEach(m => scene.remove(m)); decor.length = 0; undo.length = 0; splats.forEach(m => scene.remove(m)); splats.length = 0;
  mapI = i; const M = MAPS[i]; scene.background = skyTex(...M.sky);
  mapBox(0, -3, 90, 6, M.ground); mapBox(-45.5, 30, 1, 70, { tex: 'stone' }); mapBox(45.5, 30, 1, 70, { tex: 'stone' }); mapBox(0, 62, 92, 1, { tex: 'stone' });
  const dm = (geo, color, x, y, z, op = 1) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: op < 1, opacity: op })); m.position.set(x, y, z); scene.add(m); decor.push(m); return m; };
  for (let k = 0; k < 9; k++) dm(new THREE.CircleGeometry(rnd(6, 11), 40), M.hills, -40 + k * 10 + rnd(-2, 2), rnd(-6, -3), -20, 1);
  if (M.clouds) for (let k = 0; k < 10; k++) { const cx = rnd(-45, 45), cy = rnd(9, 22); for (let j = 0; j < 4; j++) dm(new THREE.CircleGeometry(rnd(.9, 1.6), 24), 0xffffff, cx + j * 1.2 - 1.8, cy + rnd(-.3, .3), -15, .9); }
  if (M.stars) for (let k = 0; k < 120; k++) dm(new THREE.CircleGeometry(rnd(.03, .09), 6), 0xffffff, rnd(-50, 50), rnd(1, 40), -25);
  dm(new THREE.CircleGeometry(2.2, 40), M.stars ? 0xe8e8ff : 0xfff07a, 16, 15, -24);
  M.build?.(); setGrav(M.grav ?? 0); cam.x = 0; cam.y = 2.6; ui();
}
function setGrav(m) { gravMode = m; engine.gravity.y = GRAV[m][1]; ui(); }
function togglePause() { paused = !paused; ui(); }

// ---------- tools ----------
const TOOLS = [
  ['grab', '✋', 'Grab'], ['punch', '🥊', 'Punch'], ['gun', '🔫', 'Blaster'], ['boom', '💥', 'Explode'], ['nade', '🍍', 'Grenade'], ['zap', '⚡', 'Lightning'], ['fire', '🔥', 'Ignite'], ['heal', '❤️', 'Heal'],
  ['switch', '🔌', 'Switch'], ['freeze', '❄️', 'Freeze'], ['pin', '📌', 'Pin'], ['weld', '🔗', 'Weld'], ['rope', '🪢', 'Rope'], ['spring', '➰', 'Spring'], ['snip', '✂️', 'Scissors'],
  ['grow', '🔍', 'Grow'], ['shrink', '🔬', 'Shrink'], ['clone', '👯', 'Clone'], ['del', '🗑️', 'Delete'],
];
let tool = 'grab', power = 'punch', spawnSel = null, cat = 'People', drag = null, pend = null, mouse = { x: 0, y: 0 }, keys = {};
function bodyAt(p) {
  const pt = { x: p.x * S, y: -p.y * S }, all = bodiesAll().filter(b => !b.plugin.map || false);
  let h = Query.point(all, pt).filter(b => !b.isSensor || b.plugin.kind); if (h.length) return h.sort((a, b) => (a.isStatic - b.isStatic) || (a.area - b.area))[0];
  let best = null, bd = .3 * S; for (const b of all) { if (!b.plugin.doll) continue; const d = Math.hypot(b.position.x - pt.x, b.position.y - pt.y) - (b.circleRadius || 10); if (d < bd) { bd = d; best = b; } } return best;
}
function endDrag() { if (!drag) return; const dd = drag.b.plugin.doll; if (dd) dd.stun = Math.max(dd.stun, 1.2); if (drag.c) Composite.remove(world, drag.c); drag = null; }
function useTool(t, p, e) {
  const b = bodyAt(p), pt = { x: p.x * S, y: -p.y * S }, P = b?.plugin, d = P?.doll;
  const off = b ? { x: pt.x - b.position.x, y: pt.y - b.position.y } : null;
  switch (t) {
    case 'grab': if (!b) return; if (b.isStatic) drag = { b, off, stat: 1 }; else { const c = link(null, b, pt, off, { st: .08, damp: .12 }); drag = { b, c }; } break;
    case 'punch': { ring(p.x, p.y, .9, 0xffffff); sfx('thud'); cam.shake = Math.max(cam.shake, .12); for (const o of bodiesAll()) { if (o.isStatic) continue; const dx = o.position.x - pt.x, dy = o.position.y - pt.y, dd = Math.hypot(dx, dy) / S; if (dd > 1.3) continue; const dir = b && b !== o ? Math.sign(dx || 1) : (Math.sign(dx) || pick([-1, 1])), k = (1 - dd / 1.3) * 20 / Math.max(.7, Math.sqrt(o.mass) * .6); Body.setVelocity(o, { x: o.velocity.x + dir * k, y: o.velocity.y - k * .6 }); if (o.plugin.doll && (o === b || o.plugin.part === 'chest')) hurt(o.plugin.doll, 14, o, 2); if (o.plugin.kind === 'glass' || o.plugin.kind === 'melon' || o.plugin.kind === 'balloon') later.push(() => smash(o)); } break; }
    case 'gun': { const from = toWorld(40, innerHeight * .45), a = Math.atan2(p.y - from.y, p.x - from.x); created = []; const k = ball(from.x, from.y, .2, { color: 0xffe14a, emis: 0xffaa00, den: 9, kind: 'shrap', p: { ttl: 3 }, noroot: 1 }); created = []; Body.setVelocity(k, { x: Math.cos(a) * 26, y: -Math.sin(a) * 26 }); sfx('pew'); break; }
    case 'boom': explode(p.x, p.y, 1); break;
    case 'zap': strike(p.x, p.y); break;
    case 'fire': if (b) { (d ? d.bodies : [b]).forEach(x => ignite(x, 6)); sfx('pop'); } else puff(p.x, p.y, 10, FIRE, 2, 2); break;
    case 'heal': if (d) { heal(d); sfx('heal'); popup(p.x, p.y, '💖'); } break;
    case 'switch': if (!b) return; if (d) { d.alive = !d.alive; d.nap = !d.alive; if (d.alive) { d.stun = 0; d.hp = Math.max(d.hp, 30); d.tag.classList.remove('dead'); } popup(p.x, p.y, d.alive ? 'WAKE UP!' : 'ZZZ...', 26); } else if (P.kind === 'tnt' || P.kind === 'mine' || P.kind === 'bomb' || P.kind === 'nuke') P.fuse = .05; else { P.on = !P.on; popup(p.x, p.y, P.on ? 'ON' : 'OFF', 26); } sfx('pop'); break;
    case 'freeze': if (!b || P.map || b.isSensor) return; { const st = !b.isStatic; (d ? d.bodies : [b]).forEach(x => Body.setStatic(x, st)); if (d) d.frozen = st; popup(p.x, p.y, st ? '❄️' : '💧', 30); sfx('pop'); } break;
    case 'pin': if (b && !b.isStatic) { link(null, b, pt, off, { vis: 'pin' }); popup(p.x, p.y, '📌', 28); sfx('pop'); } break;
    case 'weld': case 'rope': case 'spring':
      if (!pend) { if (!b) return; pend = { b, off, t }; hint(); }
      else { const A = pend; pend = null; if (b === A.b) return hint(); const pa = { x: A.b.position.x + A.off.x, y: A.b.position.y + A.off.y }, len = Math.hypot(pa.x - pt.x, pa.y - pt.y);
        if (t === 'weld') { if (!b) return hint(); const w1 = link(A.b, b, A.off, { x: pa.x - b.position.x, y: pa.y - b.position.y }, { st: 1, vis: 'weld' }); const o2 = { x: A.off.x + 25, y: A.off.y + 25 }; w1.plugin.sib = link(A.b, b, o2, { x: pa.x + 25 - b.position.x, y: pa.y + 25 - b.position.y }, { st: 1 }); }
        else link(A.b, b || null, A.off, b ? off : pt, t === 'rope' ? { len, st: .9, vis: 'rope', rope: 1 } : { len, st: .012, damp: .02, vis: 'spring' });
        sfx('pop'); hint(); } break;
    case 'snip': snipAt(p); break;
    case 'nade': { const from = toWorld(60, innerHeight * .3), dx = p.x - from.x, dy = p.y - from.y, tt = clamp(Math.hypot(dx, dy) / 14, .5, 1.6) * 60; const k = ball(from.x, from.y, .16, { color: 0x3d5a2a, kind: 'grenade', den: 3, re: .35, p: { fuse: 2.2 }, noroot: 1 }); Body.setVelocity(k, { x: dx * S / tt, y: (-dy * S - .5 * .278 * engine.gravity.y * tt * tt) / tt }); Body.setAngularVelocity(k, .3); sfx('pew'); break; }
    case 'grow': case 'shrink': if (b && !d && !P.map) { const k = t === 'grow' ? 1.25 : .8; if (P.sc * k > 5 || P.sc * k < .25) return; Body.scale(b, k, k); P.sc *= k; P.mesh?.scale.multiplyScalar(k); sfx('pop'); } break;
    case 'clone': if (b) { const id = d ? d.root : P.root; if (id) spawn(id, p.x + 1.5, p.y + .5); } break;
    case 'del': if (b) { const q = mpos(b); puff(q.x, q.y, 10, [0xffffff, 0xcccccc], 4); removeBody(b); sfx('pop'); } break;
  }
}
function boom(kind, x, y) {
  if (kind === 'nuke') explode(x, y, 3.2); else if (kind === 'mine') { explode(x, y, 1.2); shrapnel(x, y, 8); }
  else if (kind === 'grenade') { explode(x, y, 1.05); shrapnel(x, y, 14); }
  else if (kind === 'cluster') { explode(x, y, .8); for (let i = 0; i < 6; i++) { const g = ball(x + rnd(-.3, .3), y + rnd(0, .4), .13, { color: 0x3d5a2a, kind: 'grenade', den: 3, re: .4, p: { fuse: rnd(.7, 1.5) }, noroot: 1 }); Body.setVelocity(g, { x: rnd(-9, 9), y: rnd(-13, -5) }); } }
  else explode(x, y, 1);
}
function snipAt(p) {
  let best = null, bd = .32;
  for (const d of dolls) for (const part in d.jt) { if (d.cut[part]) continue; const c = d.jt[part], a = c.bodyA, jx = (a.position.x + c.pointA.x) / S, jy = -(a.position.y + c.pointA.y) / S, dd = Math.hypot(jx - p.x, jy - p.y); if (dd < bd) { bd = dd; best = [d, part]; } }
  if (best && GORE) { if (sever(best[0], best[1])) sfx('snip'); return; }
  const pt = { x: p.x * S, y: -p.y * S };
  for (const c of Composite.allConstraints(world)) { if (!c.plugin?.vis) continue; const a = c.bodyA ? Vector.add(c.bodyA.position, c.pointA) : c.pointA, b = c.bodyB ? Vector.add(c.bodyB.position, c.pointB) : c.pointB, l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1, t = clamp(((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / l2, 0, 1); if (Math.hypot(a.x + (b.x - a.x) * t - pt.x, a.y + (b.y - a.y) * t - pt.y) < .15 * S) { Composite.remove(world, c); if (c.plugin.sib) Composite.remove(world, c.plugin.sib); sfx('snip'); } }
  const b = bodyAt(p); if (b?.plugin.doll && T - lastSnip > .15) { lastSnip = T; hurt(b.plugin.doll, 7, b, .8, 'sharp'); sfx('snip'); }
}
const SNIPCUR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72'><text x='4' y='56' font-size='56'>✂️</text></svg>") 36 36, crosshair`;
canvas.addEventListener('contextmenu', e => e.preventDefault());
let pan = null;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId); const p = toWorld(e.clientX, e.clientY); mouse = p;
  if (e.button === 1) { pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
  if (e.button === 2) { useTool(power, p, e); return; }
  lmb = true; { const hb = bodyAt(p); if (hb?.plugin.doll && !spawnSel) sel = hb.plugin.doll; }
  if (spawnSel && !bodyAt(p)) { spawn(spawnSel, p.x, p.y); return; }
  if (spawnSel) { useTool('grab', p, e); return; }
  if (tool === 'grab' && !bodyAt(p)) { pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }; return; }
  useTool(tool, p, e);
});
canvas.addEventListener('pointermove', e => {
  mouse = toWorld(e.clientX, e.clientY);
  if (lmb && tool === 'snip' && !spawnSel) snipAt(mouse);
  if (pan) { const k = cam.h / innerHeight; cam.x = pan.cx - (e.clientX - pan.sx) * k; cam.y = pan.cy + (e.clientY - pan.sy) * k; }
});
const up = () => { pan = null; lmb = false; endDrag(); }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', e => { e.preventDefault(); const b = toWorld(e.clientX, e.clientY); cam.h = clamp(cam.h * (e.deltaY > 0 ? 1.12 : .89), 5, 45); resize(); const a = toWorld(e.clientX, e.clientY); cam.x += b.x - a.x; cam.y += b.y - a.y; }, { passive: false });
addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); $('#help').style.display = 'flex'; return; }
  const k = e.key.toLowerCase(); keys[k] = true; if (e.repeat) return;
  if (k === ' ') { e.preventDefault(); togglePause(); }
  else if (k === 'g') { slow = !slow; ui(); }
  else if (k === 'h') healAll();
  else if (k === 'r') loadMap(mapI);
  else if (k === 'z') undoLast();
  else if (k === 'x' || k === 'delete') { const b = bodyAt(mouse); if (b) removeBody(b); }
  else if (k === 'f') useTool('freeze', mouse);
  else if (k === 'escape') { spawnSel = null; pend = null; tool = 'grab'; ui(); }
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
function healAll() { dolls.slice().forEach(heal); sfx('heal'); }
function undoLast() { const u = undo.pop(); if (!u) return; if (u.doll) removeDoll(u.doll); u.bodies.forEach(b => !b.plugin.doll && kill(b)); sfx('pop'); }
function save() { const out = []; for (const b of bodiesAll()) { const P = b.plugin; if (P.root && !P.doll) out.push({ id: P.root, x: b.position.x / S - P.ox, y: -b.position.y / S - P.oy, a: b.angle, st: b.isStatic, sc: P.sc }); } for (const d of dolls) out.push({ id: d.root, x: d.parts.pelvis.position.x / S, y: Math.max(0, -d.parts.pelvis.position.y / S - d.oy) }); localStorage.setItem('rb_save', JSON.stringify({ map: mapI, items: out })); popup(cam.x, cam.y, 'SAVED! 💾', 40); }
function load() { let s; try { s = JSON.parse(localStorage.getItem('rb_save')); } catch (e) { } if (!s) return popup(cam.x, cam.y, 'Nothing saved yet', 30); loadMap(s.map); for (const it of s.items) { const r = spawn(it.id, it.x, it.y, true); if (r && r.bodies.length === 1 && it.a !== undefined) { const b = r.bodies[0]; if (it.sc && it.sc !== 1) { Body.scale(b, it.sc, it.sc); b.plugin.sc = it.sc; b.plugin.mesh?.scale.multiplyScalar(it.sc); } Body.setAngle(b, it.a); if (it.st !== b.isStatic) Body.setStatic(b, it.st); } } popup(cam.x, cam.y, 'LOADED! 📂', 40); }

// ---------- UI ----------
function hint() {
  const h = $('#hint'); let t = '';
  if (spawnSel) t = `Click in the world to drop: ${ITEMS[spawnSel].icon} ${ITEMS[spawnSel].name}  (Esc to stop)`;
  else if (pend) t = `Now click a second thing to connect ${pend.t === 'weld' ? '' : '(or empty space to hang it)'}`;
  else t = { grab: 'Drag anything to grab and fling it. Drag empty space to move the camera.', weld: 'Click two things to weld them together', rope: 'Click a limb, neck or thing, then a second one (or empty space) to tie a rope. Pull hard enough and limbs tear off.', snip: 'Click or drag across joints to cut limbs off. Also cuts ropes, welds and pins.', nade: 'Click to lob a grenade there', gun: 'Hold the mouse button to spray bullets', spring: 'Click two things to join with a spring', pin: 'Click a thing to pin it in place (it can still spin)', switch: 'Click machines to turn them on/off, bombs to set them off, people to nap/wake' }[tool] || `Click to use ${TOOLS.find(t => t[0] === tool)[2]}. Right-click always uses your last power.`;
  h.textContent = t;
}
function ui() {
  const top = $('#top'); top.innerHTML = '';
  const B = (txt, fn, on) => { const b = document.createElement('button'); b.textContent = txt; if (on) b.className = 'on'; b.onclick = () => { fn(); ui(); }; top.append(b); };
  B(paused ? '▶️ Play' : '⏸ Pause', togglePause, paused); B('🐢 Slow-mo', () => slow = !slow, slow); B(GRAV[gravMode][0], () => setGrav((gravMode + 1) % 4), gravMode);
  B(MAPS[mapI].name, () => loadMap((mapI + 1) % MAPS.length)); B('❤️ Heal all', healAll); B('↩ Undo', undoLast); B('🧹 Reset', () => loadMap(mapI)); B('💾 Save', save); B('📂 Load', load); B(mute ? '🔇' : '🔊', () => mute = !mute); B('🩸 Gore', () => GORE = !GORE, GORE); B('⚔️ Brawl', () => BRAWL = !BRAWL, BRAWL); if (has3d) B('🧊 3D MODE', () => location.href = '3d.html'); B('❓', () => $('#help').style.display = 'flex');
  const tl = $('#tools'); tl.innerHTML = '';
  for (const [id, ic, name] of TOOLS) { const b = document.createElement('button'); b.innerHTML = `<b>${ic}</b>${name}`; if (tool === id && !spawnSel) b.className = 'on'; b.onclick = () => { tool = id; spawnSel = null; pend = null; if (!['grab', 'weld', 'rope', 'spring', 'pin', 'cut', 'clone', 'grow', 'shrink'].includes(id)) power = id; ui(); }; tl.append(b); }
  const tabs = $('#tabs'); tabs.innerHTML = '';
  for (const c of CATS) { const b = document.createElement('button'); b.textContent = c; if (c === cat) b.className = 'on'; b.onclick = () => { cat = c; ui(); }; tabs.append(b); }
  const grid = $('#grid'); grid.innerHTML = '';
  for (const it of Object.values(ITEMS)) if (it.cat === cat) { const b = document.createElement('button'); b.className = 'it' + (spawnSel === it.id ? ' on' : ''); b.innerHTML = `<i>${it.icon}</i>${it.name}`; b.onclick = () => { if (it.ev) { it.fn(); return; } spawnSel = spawnSel === it.id ? null : it.id; pend = null; ui(); }; grid.append(b); }
  canvas.style.cursor = tool === 'snip' && !spawnSel ? SNIPCUR : 'default'; hint();
}
$('#go').onclick = () => { $('#help').style.display = 'none'; sfx('pop'); };

// ---------- vitals panel ----------
const PARTN = { chest: 'torso (cut in half)', head: 'head', armL: 'left arm', foreL: 'left forearm', armR: 'right arm', foreR: 'right forearm', thighL: 'left leg', shinL: 'left shin', thighR: 'right leg', shinR: 'right shin' };
const vitEl = document.createElement('div'); vitEl.id = 'vit'; document.body.append(vitEl);
document.head.append(Object.assign(document.createElement('style'), { textContent: `#vit{position:fixed;right:8px;top:110px;width:230px;background:#10141cf0;color:#e8edf5;border:3px solid #1b2a4a;border-radius:14px;box-shadow:0 5px 0 #1b2a4a;padding:10px 12px;z-index:6;font-size:13px;display:none}
#vit h3{margin:0 0 2px;font-size:17px;display:flex;justify-content:space-between}#vit h3 span{cursor:pointer;opacity:.7}#vit .st{font-weight:800;letter-spacing:1px;margin-bottom:6px}
#vit .r{display:flex;justify-content:space-between;margin-top:6px;font-weight:700}#vit .b{height:9px;background:#2a3140;border-radius:5px;overflow:hidden;margin-top:2px}#vit .b i{display:block;height:100%;border-radius:5px}
#vit ul{margin:6px 0 0;padding-left:16px;color:#ff9aa2}#vit .hb{display:inline-block}` }));
vitEl.addEventListener('click', e => { if (e.target.dataset.x) sel = null; });
let vitN = 0;
function vitals() {
  if (!sel || sel.dead) { if (vitEl.style.display !== 'none') vitEl.style.display = 'none'; return; }
  if (vitN++ % 3) return; const d = sel; vitEl.style.display = 'block';
  const st = !d.alive ? ['DEAD', '#ff4d4d'] : d.frozen ? ['FROZEN', '#7fd6ff'] : d.stun > 0 || d.nap ? ['UNCONSCIOUS', '#ffd23f'] : ['CONSCIOUS', '#4de36b'];
  const row = (ic, name, pct, txt, col) => `<div class="r"><span>${ic} ${name}</span><span>${txt}</span></div><div class="b"><i style="width:${clamp(pct, 0, 100)}%;background:${col}"></i></div>`;
  const beat = d.bpm ? 1 + .35 * Math.max(0, Math.sin(T * d.bpm / 60 * Math.PI * 2)) : 1;
  const inj = [...Object.keys(d.cut).map(k => 'Severed: ' + PARTN[k]), ...Object.keys(d.broken).map(k => 'Broken: ' + PARTN[k]), ...(d.char > .15 ? ['Burns: ' + Math.round(d.char * 100) + '%'] : [])];
  const cuts = d.marks.filter(k => k.type === 'cut').length, br = d.marks.filter(k => k.type === 'bruise').length, bleed = d.marks.some(k => k.bleed > 0);
  if (cuts) inj.push(cuts + ' cut' + (cuts > 1 ? 's' : '')); if (br) inj.push(br + ' bruise' + (br > 1 ? 's' : '')); if (bleed) inj.push('Bleeding');
  vitEl.innerHTML = `<h3>${d.name}<span data-x="1">✕</span></h3><div class="st" style="color:${st[1]}">${st[0]}</div>`
    + row('❤️', 'Health', d.hp, Math.round(d.hp) + '%', d.hp > 50 ? '#4de36b' : d.hp > 20 ? '#ffd23f' : '#ff4d4d')
    + row('🩸', 'Blood', d.blood, (d.blood * .05).toFixed(1) + ' L', '#d0121b')
    + row('⚡', 'Pain', d.pain, Math.round(d.pain) + '%', '#c77dff')
    + row(`<span class="hb" style="transform:scale(${beat.toFixed(2)})">💓</span>`, 'Heart', d.bpm / 2.15, Math.round(d.bpm) + ' bpm', '#ff5c8a')
    + row('🌡️', 'Temp', (d.temp + 5) / .85, d.temp.toFixed(1) + ' °C', d.temp > 41 ? '#ff7b2f' : d.temp < 33 ? '#7fd6ff' : '#4db8ff')
    + (inj.length ? `<ul>${inj.map(i => `<li>${i}</li>`).join('')}</ul>` : '');
}

// ---------- constraint lines ----------
const LMAX = 600, lPos = new Float32Array(LMAX * 6), lCol = new Float32Array(LMAX * 6), lGeo = new THREE.BufferGeometry();
lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3)); lGeo.setAttribute('color', new THREE.BufferAttribute(lCol, 3));
const lines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })); lines.frustumCulled = false; lines.renderOrder = 8; scene.add(lines);
const VCOL = { rope: [.55, .35, .15], chain: [.3, .3, .35], weld: [1, .85, .2], spring: [.2, .9, .5], pin: [1, .2, .3], grab: [1, 1, 1] };
function drawLines() {
  let n = 0; const seg = (ax, ay, bx, by, c) => { if (n >= LMAX) return; lPos.set([ax / S, -ay / S, 1, bx / S, -by / S, 1], n * 6); lCol.set([...c, ...c], n * 6); n++; };
  for (const c of Composite.allConstraints(world)) {
    const v = c === drag?.c ? 'grab' : c.plugin?.vis; if (!v) continue;
    const a = c.bodyA ? Vector.add(c.bodyA.position, c.pointA) : c.pointA, b = c.bodyB ? Vector.add(c.bodyB.position, c.pointB) : c.pointB;
    if (c.plugin?.rope) { const d = Vector.magnitude(Vector.sub(a, b)); c.stiffness = d > c.plugin.len ? .9 : .0001; }
    if (v === 'pin' || v === 'weld') { for (const [dx, dy] of [[6, 6], [-6, 6]]) seg(a.x - dx, a.y - dy, a.x + dx, a.y + dy, VCOL[v]); if (v === 'weld') seg(a.x, a.y, b.x, b.y, VCOL[v]); }
    else for (const w of [0, 1.5, -1.5]) seg(a.x + w, a.y + w, b.x + w, b.y + w, VCOL[v]);
  }
  lGeo.setDrawRange(0, n * 2); lGeo.attributes.position.needsUpdate = true; lGeo.attributes.color.needsUpdate = true;
}

// ---------- main loop ----------
let last = performance.now(), acc = 0;
function step(dt) {
  T += dt;
  if (drag) {
    const pt = { x: mouse.x * S, y: -mouse.y * S }, sp = (keys.q ? -1 : 0) + (keys.e ? 1 : 0);
    if (drag.stat) { if (drag.b.plugin.x0 !== undefined) drag.b.plugin.x0 += (pt.x - drag.off.x - drag.b.position.x) / S; Body.setPosition(drag.b, { x: pt.x - drag.off.x, y: pt.y - drag.off.y }); if (sp) Body.setAngle(drag.b, drag.b.angle + sp * .04); }
    else { drag.c.pointA = pt; if (sp) Body.setAngularVelocity(drag.b, sp * .12); }
  }
  if (lmb && tool === 'gun' && !spawnSel && T > nextShot) { nextShot = T + .09; useTool('gun', mouse); }
  for (const b of bodiesAll()) tickBody(b, dt);
  for (const d of dolls.slice()) tickDoll(d, dt);
  Engine.update(engine, 1000 / 60);
  while (later.length) later.shift()();
}
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(.05, (now - last) / 1000); last = now;
  const pk = (keys.arrowleft ? -1 : 0) + (keys.arrowright ? 1 : 0), pv = (keys.arrowdown ? -1 : 0) + (keys.arrowup ? 1 : 0);
  cam.x = clamp(cam.x + pk * cam.h * rdt, -40, 40); cam.y = clamp(cam.y + pv * cam.h * rdt, 0, 45);
  if (!paused) { acc += rdt * (slow ? .2 : 1); let n = 0; while (acc >= 1 / 60 && n++ < 3) { step(1 / 60); acc -= 1 / 60; } if (n > 3) acc = 0; }
  else for (const d of dolls) tickTag(d);
  for (const b of bodiesAll()) { const m = b.plugin.mesh; if (!m) continue; m.position.x = b.position.x / S; m.position.y = -b.position.y / S; m.rotation.z = -b.angle - (b.plugin.spin || 0); }
  for (let i = 0; i < PN; i++) { const p = parts[i]; if (!p) continue; if (!paused) { p.l -= rdt; p.vy -= p.g * rdt; p.x += p.vx * rdt; p.y += p.vy * rdt; if (p.blood && p.y < .03 && p.vy < 0) { if (Math.abs(p.x) < 45) splat(p.x, 0); p.l = 0; } } if (p.l <= 0) { parts[i] = null; pPos[i * 3] = 999; continue; } pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = 3; pCol[i * 3] = p.c.r; pCol[i * 3 + 1] = p.c.g; pCol[i * 3 + 2] = p.c.b; }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  for (let i = fxs.length - 1; i >= 0; i--) { const f = fxs[i]; f.l -= rdt; if (f.l <= 0) { scene.remove(f.m); fxs.splice(i, 1); } else f.f(f.l / f.t); }
  updateMarks(paused ? 0 : rdt * (slow ? .2 : 1)); drawLines(); vitals();
  cam.shake *= .9; camera.position.set(cam.x + rnd(-1, 1) * cam.shake, cam.y + rnd(-1, 1) * cam.shake, 20);
  renderer.render(scene, camera);
}
function tickTag(d) { const P = d.parts, hp = mpos(P.head), s = toScreen(hp.x, hp.y + P.head.circleRadius / S + .15); d.tag.style.left = s.x + 'px'; d.tag.style.top = s.y + 'px'; }

// ---------- boot ----------
async function boot() {
  resize();
  Object.assign(MODELS, await loadChars());
  loadMap(0);
  spawn('martleboro', -3, 0, true); spawn('louis_g', 0, 0, true); spawn('apricot', 3, 0, true); spawn('crate', 6, 0, true); spawn('plank', -7, 0, true); spawn('soccer', 7.5, 0, true);
  ui(); requestAnimationFrame(frame);
}
boot();
window.RB = { get sel() { return sel; }, set sel(v) { sel = v; }, sever, snipAt, hurt, breakBone, renderer, scene, camera, engine, dolls, spawn, ITEMS, cam, explode, bodiesAll, useTool, step, loadMap };
