// REALISTIC BEATUP 3D: a goat man loose in a destructible town.
// Buildings, trees, cars and debris run on vectorclad's engine (vc/js: World, Destruction, FX,
// Sound, Cars, weapon models); the town is town.js; loose props and playground toys are cannon-es.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import * as CANNON from './vendor/cannon-es.js';
import { loadTextures, makeMaterials, setBase, SKINS, glowTexture } from './vc/js/atlas.js';
import { FX, Particles } from './vc/js/fx.js';
import { Sound } from './vc/js/audio.js';
import { World } from './vc/js/world.js';
import { Destruction } from './vc/js/destruct/destruct.js';
import { setCeilingTextures } from './vc/js/destruct/ceilings.js';
import { buildWeaponModel } from './vc/js/weapons.js';
import { loadGuns } from './vc/js/guns3d.js';
import { buildTown, TOWN } from './town.js';

const $ = (s) => document.querySelector(s);
const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _a = new V3(), _b = new V3(), _c = new V3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// ---- renderer ---------------------------------------------------------------------------------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.08, 3000);
function resize() { const w = innerWidth || 1280, h = innerHeight || 720; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const loadMsg = (t) => { const e = $('#loading'); if (e) e.textContent = t; };

let hitstop = 0, fx, sound, world, D, mats, phys, groundMat, shake = 0, chaos = 0, T = 0, timeScale = 1, kills = 0;
const P = { pos: new V3(0, 0, 18), vel: new V3(), yaw: Math.PI, alive: true, hp: 300, maxHp: 300, grounded: true, jumps: 0, r: 0.45, h: 2.3, fireFace: 0, inCar: null, zip: null, jet: 100, deadT: 0, onBody: null };
const AIM = { point: new V3(), dir: new V3(0, 0, -1), hitNpc: null };

// ---- weapons ----------------------------------------------------------------------------------
// slot types: hand, shoulder, leg (leftHand also takes the shield)
const SLOTS = [
  { id: 'rightHand', label: 'Right hand', type: 'hand', key: 'LMB' },
  { id: 'leftHand', label: 'Left hand', type: 'hand', key: 'RMB' },
  { id: 'shoulderL', label: 'L shoulder', type: 'shoulder', key: 'F' },
  { id: 'shoulderR', label: 'R shoulder', type: 'shoulder', key: 'F' },
  { id: 'legL', label: 'L leg', type: 'leg', key: 'Q' },
  { id: 'legR', label: 'R leg', type: 'leg', key: 'Q' },
];
const S = (i) => SKINS[i];
const WD = {
  sword: { name: 'Iron Sword', kind: 'melee', file: 'iron_sword', slots: ['hand'], dmg: 45, reach: 2.6, rate: 0.5, power: 60, desc: 'The old faithful. Lops off limbs.' },
  greatsword: { name: 'Lionguard Greatsword', kind: 'melee', file: 'lionguard_sword', slots: ['hand'], dmg: 70, reach: 3, rate: 0.7, power: 90, desc: 'Big swing, bigger mess.' },
  emberfang: { name: 'Emberfang', kind: 'melee', file: 'emberfang_sword', slots: ['hand'], dmg: 50, reach: 2.6, rate: 0.5, power: 70, fire: true, desc: 'Sets whatever it cuts on fire.' },
  icevein: { name: 'Icevein Blade', kind: 'melee', file: 'icevein_sword', slots: ['hand'], dmg: 55, reach: 2.7, rate: 0.45, power: 60, desc: 'Cold, quick and very sharp.' },
  axe: { name: "Butcher's Axe", kind: 'melee', file: 'butcher_axe', slots: ['hand'], dmg: 80, reach: 2.4, rate: 0.8, power: 120, sever: 0.7, desc: 'Takes something off nearly every swing.' },
  hammer: { name: 'War Hammer', kind: 'melee', file: 'war_hammer', slots: ['hand'], dmg: 90, reach: 2.6, rate: 0.9, power: 900, knock: 22, desc: 'Knocks holes in walls. And people.' },
  beamRifle: { name: 'BR-07 Beam Rifle', kind: 'bolt', model: 'beamRifle', skin: 0, slots: ['hand'], ammo: 16, reload: 2, rate: 0.22, dmg: 34, speed: 140, power: 140, radius: 0.7, color: 0xff4fc8, desc: 'Fast particle bolts.' },
  bazooka: { name: 'HB-90 Hyper Bazooka', kind: 'rocket', model: 'bazooka', skin: 0, slots: ['hand'], ammo: 5, reload: 2.6, rate: 0.85, dmg: 120, splash: 5.5, speed: 48, power: 520, desc: 'Big unguided rockets. Walls hate it.' },
  machineGun: { name: 'MG-79 Machine Gun', kind: 'bullet', model: 'machineGun', skin: 0, slots: ['hand'], ammo: 90, reload: 2, rate: 0.075, dmg: 11, spread: 0.018, power: 45, radius: 0.4, desc: 'Rotary gun. Hold the trigger.' },
  shotgun: { name: 'SC-12 Shotgun Cannon', kind: 'pellet', model: 'shotgun', skin: 0, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.7, dmg: 12, pellets: 10, spread: 0.06, power: 40, radius: 0.35, desc: 'Ten pellets. Brutal up close.' },
  grenade: { name: 'GL-6 Grenade Launcher', kind: 'grenade', model: 'grenade', skin: 0, slots: ['hand'], ammo: 8, reload: 2.4, rate: 0.42, dmg: 90, splash: 4.5, speed: 26, power: 360, desc: 'Arcing high-explosive shells.' },
  beamCannon: { name: 'MBC-2 Mega Beam Cannon', kind: 'mega', model: 'beamCannon', skin: 0, slots: ['hand', 'shoulder'], ammo: 3, reload: 3.5, rate: 2.0, charge: 0.5, duration: 1.6, dps: 260, color: 0xffb84a, desc: 'Charged beam that cuts through everything.' },
  vulcanPod: { name: 'VP-4 Vulcan Pod', kind: 'bullet', model: 'vulcanPod', skin: 0, slots: ['shoulder'], ammo: 200, reload: 2.5, rate: 0.05, dmg: 7, spread: 0.03, power: 35, radius: 0.35, desc: 'Shoulder gatling.' },
  missilePod: { name: 'MP-6 Missile Pod', kind: 'missile', model: 'missilePod', skin: 0, slots: ['shoulder', 'leg'], ammo: 6, reload: 3.5, rate: 0.09, dmg: 60, splash: 3.5, speed: 34, power: 240, desc: 'Six homing missiles.' },
  heavyPod: { name: 'HMP-8 Heavy Missile Pod', kind: 'missile', model: 'heavyPod', skin: 0, slots: ['shoulder'], ammo: 8, reload: 5, rate: 0.14, dmg: 100, splash: 6, speed: 28, power: 480, mscale: 1.5, desc: 'Eight big warheads.' },
  microPod: { name: 'μMP-24 Micro Missile Pod', kind: 'missile', model: 'microPod', skin: 0, slots: ['shoulder', 'leg'], ammo: 24, reload: 4, rate: 0.035, dmg: 22, splash: 2.2, speed: 38, power: 100, mscale: 0.6, wobble: 1.7, desc: 'A swarm of 24 tiny missiles.' },
  shield: { name: 'RX-S Shield', kind: 'shield', model: 'shield', skin: 0, slots: ['leftHand'], desc: 'Hold RMB to raise. Takes most of the hurt.' },
  nuke: { name: 'Goat Nuke Launcher', kind: 'rocket', model: 'bazooka', skin: 6, slots: ['hand'], ammo: 1, reload: 6, rate: 2, dmg: 600, splash: 16, speed: 30, power: 2400, nuke: true, desc: 'One shot. Whole buildings come down.' },
  railgun: { name: 'Rail Rifle', kind: 'rail', model: 'beamRifle', skin: 7, slots: ['hand'], ammo: 4, reload: 2.5, rate: 0.9, dmg: 160, power: 700, radius: 1.1, color: 0x7fd8ff, desc: 'Punches straight through people and walls.' },
  flamer: { name: 'Flamethrower', kind: 'flame', model: 'machineGun', skin: 5, slots: ['hand'], ammo: 120, reload: 2.5, rate: 0.04, dmg: 4, desc: 'Sets everything on fire.' },
  minigun: { name: 'Hand Minigun', kind: 'bullet', model: 'vulcanPod', skin: 1, slots: ['hand'], ammo: 300, reload: 3, rate: 0.03, dmg: 9, spread: 0.035, power: 40, radius: 0.4, desc: 'Ludicrous rate of fire.' },
  cluster: { name: 'Cluster Launcher', kind: 'grenade', model: 'grenade', skin: 2, slots: ['hand'], ammo: 4, reload: 3, rate: 0.6, dmg: 70, splash: 3.5, speed: 24, power: 260, cluster: 6, desc: 'Each shell splits into six.' },
  goldBazooka: { name: 'Golden Bazooka', kind: 'rocket', model: 'bazooka', skin: 8, slots: ['hand'], ammo: 3, reload: 2, rate: 0.6, dmg: 160, splash: 7, speed: 55, power: 800, desc: 'Fancy. Also enormous.' },
  heavyVulcan: { name: 'Twin Vulcan', kind: 'bullet', model: 'vulcanPod', skin: 6, slots: ['shoulder', 'leg'], ammo: 300, reload: 3, rate: 0.035, dmg: 8, spread: 0.04, power: 40, radius: 0.4, desc: 'Leg- or shoulder-mounted gatling.' },
};
const PICKUP_POOL = ['bazooka', 'machineGun', 'shotgun', 'grenade', 'beamRifle', 'beamCannon', 'vulcanPod', 'missilePod', 'heavyPod', 'microPod', 'shield', 'railgun', 'flamer', 'minigun', 'cluster', 'goldBazooka', 'heavyVulcan', 'greatsword', 'emberfang', 'icevein', 'axe', 'hammer', 'nuke', 'bazooka', 'missilePod', 'shotgun'];
const allowed = (w, slot) => WD[w].slots.includes(slot.type) || WD[w].slots.includes(slot.id);
let uid = 1;
const INV = { bag: [], equip: { rightHand: null, leftHand: null, shoulderL: null, shoulderR: null, legL: null, legR: null } };
const newItem = (w) => ({ id: uid++, w, ammo: WD[w].ammo || 0, cool: 0, reloadT: 0, model: null });

const MELEE_SRC = {};
function weaponModel(w) {
  const d = WD[w];
  let g;
  if (d.kind === 'melee') {
    g = new THREE.Group();
    const src = MELEE_SRC[d.file];
    if (src) {
      const m = src.clone(true);
      g.add(m);
    } else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.12), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 })));
    return { group: g, muzzles: [] };
  }
  const m = buildWeaponModel(d.model, S(d.skin), mats);
  m.group.scale.setScalar(d.slots.includes('hand') ? 0.3 : 0.26);
  const wrap = new THREE.Group(); wrap.add(m.group);
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { group: wrap, muzzles: m.muzzles || [], spin: m.spin, inner: m.group };
}

// ---- input --------------------------------------------------------------------------------------
const keys = {}, mouse = { l: false, r: false };
let camYaw = Math.PI, camPitch = -0.12, camDist = 5.5, started = false, invOpen = false;
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); toggleInv(); return; }
  if (invOpen) { if (e.code === 'Escape') toggleInv(); return; }
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyR' && started) location.reload();
  if (e.code === 'KeyG') { timeScale = timeScale === 1 ? 0.3 : 1; $('#slow').style.display = timeScale < 1 ? 'block' : 'none'; }
  if (e.code === 'KeyH' || e.code === 'F1') { e.preventDefault(); $('#help').style.display = $('#help').style.display === 'none' ? 'flex' : 'none'; }
  if (e.code === 'KeyE') interact();
  if (e.code === 'Space' && !P.inCar) jump();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('mousedown', (e) => {
  if (!started || invOpen) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); }
  if (e.button === 0) mouse.l = true;
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  camYaw -= e.movementX * 0.0024;
  camPitch = clamp(camPitch - e.movementY * 0.0022, -1.2, 0.6);
  lastMouse = T;
});
let lastMouse = -9;
addEventListener('wheel', (e) => { if (!invOpen) camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 2.2, 18); });

// ---- HUD ----------------------------------------------------------------------------------------
function toast(t, big) {
  const d = document.createElement('div'); d.innerHTML = t; if (big) d.className = 'big';
  $('#feed').prepend(d); setTimeout(() => { d.style.opacity = 0; }, 2600); setTimeout(() => d.remove(), 3300);
  while ($('#feed').children.length > 6) $('#feed').lastChild.remove();
}
function addChaos(n, label) { chaos += n; if (label) toast(`${label} <b>+${n}</b>`); }
let hudT = 0;
function hud(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  $('#hpbar').style.width = `${(100 * P.hp) / P.maxHp}%`;
  $('#jetbar').style.width = `${P.jet}%`;
  $('#pts').textContent = Math.floor(chaos).toLocaleString();
  $('#kills').textContent = `${kills} down · ${D ? D.stats.removed.toLocaleString() : 0} chunks of town`;
  let near = '', bd = 1e9;
  for (const b of TOWN.names) { const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z); if (d < bd) { bd = d; near = b.name; } }
  for (const p of TOWN.parks) if (P.pos.x > p.x0 && P.pos.x < p.x1 && P.pos.z > p.z0 && P.pos.z < p.z1) { near = p.name; bd = 0; }
  $('#where').textContent = bd < 40 ? near : 'Goatsville';
  $('#slots').innerHTML = SLOTS.map((s) => {
    const it = INV.equip[s.id]; if (!it) return `<div class="sl empty"><kbd>${s.key}</kbd> ${s.label}</div>`;
    const d = WD[it.w];
    const am = d.kind === 'melee' || d.kind === 'shield' ? '' : it.reloadT > 0 ? '<i>RELOAD</i>' : `<i>${it.ammo}/${d.ammo}</i>`;
    return `<div class="sl"><kbd>${s.key}</kbd> ${d.name} ${am}</div>`;
  }).join('');
  $('#speed').style.display = P.inCar ? 'block' : 'none';
  if (P.inCar) $('#speed').textContent = `${Math.round(Math.abs(P.inCar.speed || 0) * 3.6)} km/h`;
  const nc = !P.inCar && nearestCar();
  $('#prompt').textContent = P.inCar ? 'E get out' : nc ? 'E steal car' : zipNear() ? 'E ride the zip line' : '';
}

// ---- boot -----------------------------------------------------------------------------------------
async function boot() {
  setBase('vc/');
  loadMsg('loading textures...');
  const tex = await loadTextures(renderer, (p) => loadMsg(`loading textures ${Math.round(p * 100)}%`));
  loadMsg('loading weapons...');
  await loadGuns('vc/assets/scifi-guns/');
  const gl = new GLTFLoader();
  await Promise.all(['iron_sword', 'lionguard_sword', 'emberfang_sword', 'icevein_sword', 'butcher_axe', 'war_hammer'].map((f) => gl.loadAsync(`assets/melee/${f}.glb`).then((g) => {
    const s = g.scene; const b = new THREE.Box3().setFromObject(s), sz = b.getSize(new V3());
    const k = 1.25 / Math.max(sz.x, sz.y, sz.z); s.scale.setScalar(k);
    // grip at the origin, blade up +Y
    const long = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
    if (long === 'x') s.rotation.z = Math.PI / 2; if (long === 'z') s.rotation.x = Math.PI / 2;
    s.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(s); s.position.y -= b2.min.y + (b2.max.y - b2.min.y) * 0.12;
    s.position.x -= (b2.min.x + b2.max.x) / 2; s.position.z -= (b2.min.z + b2.max.z) / 2;
    s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const w = new THREE.Group(); w.add(s); MELEE_SRC[f] = w;
  }).catch((e) => console.warn('melee', f, e))));
  mats = makeMaterials(tex);
  sound = new Sound();
  fx = new FX(scene, { onShake: (p, k) => { const d = p ? p.distanceTo(camera.position) : 0; shake = Math.max(shake, k * 0.6 / (1 + d / 25)); }, sound });
  loadMsg('building the town...');
  await new Promise((r) => setTimeout(r, 20));
  world = new World(scene, mats, fx, sound, { M: 1, cityTex: tex.city, build: buildTown }, { onHit: () => {} });
  world.spiders = { damage: () => false };
  setCeilingTextures(tex.ceiling, tex.ceilingGlow);
  D = world.destruct = new Destruction({ scene, world, city: world.city, fx, sound, renderer, M: 1 });
  D.player = P;
  D.onPlayerHit = (amount) => hurtPlayer(amount * 0.25, null, 'crush');
  scene.fog = new THREE.Fog(0xc4ccd2, 120, 900);
  initPhysics();
  initGore();
  loadMsg('waking the goat...');
  await loadPlayer(gl);
  spawnPickups();
  // starting kit
  equipTo(newItem('machineGun'), 'rightHand');
  equipTo(newItem('sword'), 'leftHand');
  equipTo(newItem('missilePod'), 'shoulderR');
  INV.bag.push(newItem('bazooka'), newItem('shotgun'), newItem('grenade'), newItem('microPod'));
  makeIcons();
  loadMsg('');
  $('#go').disabled = false; $('#go').textContent = 'PLAY!';
  // characters stream in behind play
  loadPeople(gl);
  last = performance.now();
  requestAnimationFrame(frame);
}

// ---- player ---------------------------------------------------------------------------------------
let goat = null;
function setupModel(src, height) {
  const root = skClone(src);
  root.updateMatrixWorld(true);
  let mesh = null; root.traverse((o) => { if (o.isSkinnedMesh) { mesh = mesh || o; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  const b = new THREE.Box3().setFromObject(root), h = b.max.y - b.min.y || 1;
  const k = height / h;
  root.scale.multiplyScalar(k);
  root.position.y = -b.min.y * k;
  const g = new THREE.Group(); g.add(root);
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
  return { g, root, mesh, bones };
}
const ANIMS = { idle: [/^idle$/, /Idle_Loop/, /idle/i], walk: [/^walk$/, /Walk_Fwd/, /walk/i], run: [/^run$/, /^run\d?$/, /flee/, /walk_shamble/, /walk/i], atk: [/^atk1$/, /^atk\d$/, /Scratch/, /kick/, /throw/], atk2: [/^atk2$/, /^atk3$/, /^atk\d$/, /Scratch/, /kick/], hit: [/^hit$/, /Hit_Chest/, /^hit/i], death: [/^death$/, /Death01/, /death/i, /fall/], jump: [/^jump$/, /jump/i], roar: [/^roar$/, /angry/, /Scratch/], flee: [/^flee$/, /^run$/, /scared/], scared: [/^scared$/, /afraid/, /frightened/], wave: [/^wave$/, /greet/], dance: [/dance_\d/], cheer: [/cheer/, /clap/] };
function findClip(clips, k) { for (const re of ANIMS[k] || [new RegExp(`^${k}$`)]) { const c = clips.find((c) => re.test(c.name)); if (c) return c; } return null; }
function makeActor(model, clips) {
  const mixer = new THREE.AnimationMixer(model.root), acts = {};
  for (const k of Object.keys(ANIMS)) {
    const c = findClip(clips, k); if (!c) continue;
    const a = mixer.clipAction(c); acts[k] = a;
    if (/death|atk|hit|jump|roar|wave|cheer/.test(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  return { mixer, acts, cur: null };
}
function play(A, k, fade = 0.2, speed = 1) {
  const a = A.acts[k]; if (!a) return;
  a.timeScale = speed;
  if (A.cur === a && a.isRunning() && a.loop !== THREE.LoopOnce) return;
  a.reset().fadeIn(fade).play();
  if (A.cur && A.cur !== a) A.cur.fadeOut(fade);
  A.cur = a;
}
async function loadPlayer(gl) {
  const g = await gl.loadAsync('assets/monsters/goatman_gold_good.glb');
  const m = setupModel(g.scene, 2.4);
  goat = { ...m, ...makeActor(m, g.animations), clips: g.animations };
  scene.add(goat.g);
  play(goat, 'idle');
  P.pos.copy(TOWN.spawn);
}

function jump() {
  if (!P.alive || P.zip) return;
  if (P.grounded) { P.vel.y = 8.5; P.grounded = false; P.jumps = 1; play(goat, 'jump', 0.1, 1.3); sound.thump?.(P.pos); }
  else if (P.jumps < 2) { P.vel.y = 8; P.jumps = 2; play(goat, 'jump', 0.05, 1.6); }
}

function rampHeight(x, z, y) {
  let h = -Infinity, slide = null;
  for (const r of TOWN.ramps) {
    if (x < Math.min(r.x0, r.x1) || x > Math.max(r.x0, r.x1) || z < r.z0 || z > r.z1) continue;
    let yy;
    if (r.slide) { const t = (x - r.hiX) / (r.loX - r.hiX); yy = r.y1 + (r.y0 - r.y1) * clamp(t, 0, 1); }
    else yy = r.y0 + (r.y1 - r.y0) * clamp((x - r.x0) / (r.x1 - r.x0), 0, 1);
    if (yy <= y + 0.8 && yy > h) { h = yy; slide = r.slide ? r : null; }
  }
  return { h, slide };
}

function standOnBodies(x, z, y) {
  let best = -Infinity, body = null;
  for (const b of phys.stand) {
    const A = b.aabb; if (b.aabbNeedsUpdate) b.updateAABB();
    if (x < A.lowerBound.x || x > A.upperBound.x || z < A.lowerBound.z || z > A.upperBound.z) continue;
    const top = A.upperBound.y;
    if (top <= y + 0.6 && top > best) { best = top; body = b; }
  }
  return { h: best, body };
}

function updatePlayer(dt) {
  if (!goat) return;
  if (!P.alive) {
    P.deadT -= dt;
    if (P.deadT <= 0) { P.alive = true; P.hp = P.maxHp; P.pos.copy(TOWN.spawn); P.vel.set(0, 0, 0); play(goat, 'idle'); toast('The goat gets back up.', true); }
    goat.mixer.update(dt);
    return;
  }
  if (P.inCar) { drive(dt); goat.g.visible = false; return; }
  goat.g.visible = true;
  if (P.zip) { rideZip(dt); goat.mixer.update(dt); return; }
  const fwd = _a.set(Math.sin(camYaw), 0, Math.cos(camYaw)), right = _b.set(-fwd.z, 0, fwd.x);
  const mv = new V3();
  if (keys.KeyW) mv.add(fwd); if (keys.KeyS) mv.sub(fwd); if (keys.KeyD) mv.sub(right); if (keys.KeyA) mv.add(right);
  const moving = mv.lengthSq() > 0;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const sp = sprint ? 11 : 5.5;
  if (moving) mv.normalize().multiplyScalar(sp);
  const k = P.grounded ? 14 : 3;
  P.vel.x = damp(P.vel.x, mv.x, k, dt); P.vel.z = damp(P.vel.z, mv.z, k, dt);
  // jetpack
  if (keys.KeyB && P.jet > 0) {
    P.vel.y = Math.min(P.vel.y + 30 * dt, 9); P.jet = Math.max(0, P.jet - 28 * dt); P.grounded = false;
    if (Math.random() < 0.8) { const b = goat.bones.Spine1 || goat.bones.Hips; b.getWorldPosition(_c); _c.addScaledVector(fwd, -0.4); fx.fire.emit(_c.x, _c.y, _c.z, rnd(-1, 1), -8, rnd(-1, 1), 0.3, 0.5, 0.1, 1, 0.6, 0.2, 1, 1, 0.2, 0, 0); }
  } else if (P.grounded) P.jet = Math.min(100, P.jet + 20 * dt);
  P.vel.y -= 22 * dt;
  const prevY = P.pos.y;
  P.pos.addScaledVector(P.vel, dt);
  // head bump on ceilings
  if (P.vel.y > 0) {
    world.query(P.pos.x - 0.3, P.pos.z - 0.3, P.pos.x + 0.3, P.pos.z + 0.3, (c) => {
      if (c.walk || c.vox) return;
      if (c.min.y >= prevY + P.h - 0.05 && c.min.y < P.pos.y + P.h) { P.pos.y = c.min.y - P.h; P.vel.y = 0; }
    });
  }
  world.resolve(P.pos, P.r, P.h, Math.max(prevY, P.pos.y));
  pushOutOfCars(P.pos, P.r);
  let g = world.groundHeight(P.pos.x, P.pos.z, Math.max(prevY, P.pos.y), P.r * 0.6);
  const rh = rampHeight(P.pos.x, P.pos.z, Math.max(prevY, P.pos.y));
  const sb = standOnBodies(P.pos.x, P.pos.z, Math.max(prevY, P.pos.y));
  let slideR = null; P.onBody = null;
  if (rh.h > g) { g = rh.h; slideR = rh.slide; }
  if (sb.h > g) { g = sb.h; P.onBody = sb.body; }
  if (P.pos.y <= g) {
    // trampolines
    const tr = TOWN.bounce.find((b) => Math.hypot(P.pos.x - b.x, P.pos.z - b.z) < b.r && Math.abs(g - b.y) < 0.3);
    if (tr && P.vel.y < -2) { P.vel.y = Math.min(24, -P.vel.y * 1.05 + 4); P.pos.y = g; sound.thump?.(P.pos); addChaos(5); }
    else {
      if (P.vel.y < -24) hurtPlayer((-P.vel.y - 24) * 4, null, 'fall');
      P.pos.y = g; P.vel.y = 0; P.grounded = true; P.jumps = 0;
    }
  } else if (P.pos.y > g + 0.25) P.grounded = false;
  if (slideR && P.grounded) { const dir = Math.sign(slideR.loX - slideR.hiX); P.vel.x += dir * 18 * dt; P.slideT = 0.2; }
  if (P.onBody) { // ride whatever we stand on (merry-go-round)
    const b = P.onBody, rx = P.pos.x - b.position.x, rz = P.pos.z - b.position.z;
    P.pos.x += (b.velocity.x + b.angularVelocity.y * rz) * dt; P.pos.z += (b.velocity.z - b.angularVelocity.y * rx) * dt;
  }
  if (P.pos.y < -20) { P.pos.copy(TOWN.spawn); P.vel.set(0, 0, 0); }
  // facing
  const flat = Math.hypot(P.vel.x, P.vel.z);
  P.fireFace -= dt;
  let want = P.yaw;
  if (P.fireFace > 0 || mouse.r) want = camYaw;
  else if (flat > 0.5) want = Math.atan2(P.vel.x, P.vel.z);
  let dy = want - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  P.yaw += dy * Math.min(1, dt * 12);
  goat.g.position.copy(P.pos); goat.g.rotation.y = P.yaw;
  // animation
  if (!P.attackT || P.attackT < T) {
    if (!P.grounded && P.vel.y > 1) { /* jump clip plays */ }
    else if (P.slideT > 0) play(goat, 'idle');
    else if (flat > 7) play(goat, 'run', 0.2, 1.1);
    else if (flat > 0.6) play(goat, 'walk', 0.2, flat / 3.2);
    else if (P.grounded) play(goat, 'idle', 0.3);
  }
  P.slideT = (P.slideT || 0) - dt;
  goat.mixer.update(dt);
  pushBodies(P.pos, P.vel, P.r + 0.2, P.h, 90);
  // regen
  P.hp = Math.min(P.maxHp, P.hp + dt * 4);
  // pickups
  for (const pk of pickups) {
    if (pk.taken || Math.abs(pk.pos.y - P.pos.y) > 2 || Math.hypot(pk.pos.x - P.pos.x, pk.pos.z - P.pos.z) > 1.6) continue;
    takePickup(pk);
  }
}

function hurtPlayer(amount, from, kind) {
  if (!P.alive || amount <= 0) return;
  const sh = INV.equip.leftHand && WD[INV.equip.leftHand.w].kind === 'shield' && mouse.r;
  if (sh) amount *= 0.15;
  P.hp -= amount;
  $('#flash').style.background = '#c00'; $('#flash').style.opacity = Math.min(0.5, amount / 60);
  setTimeout(() => { $('#flash').style.opacity = 0; }, 80);
  bleed(P.pos.clone().setY(P.pos.y + 1.4), from ? _a.subVectors(P.pos, from).normalize() : UP, Math.min(30, amount));
  if (P.hp <= 0) {
    P.alive = false; P.deadT = 4; P.hp = 0;
    if (P.inCar) leaveCar();
    play(goat, 'death', 0.1);
    toast('GOAT DOWN. Back in a moment...', true);
  } else if (amount > 15) play(goat, 'hit', 0.05);
}

// ---- camera -----------------------------------------------------------------------------------------
const camT = new V3();
function updateCamera(dt) {
  if (!goat) return;
  const car = P.inCar;
  if (car && T - lastMouse > 1.5) { let d = car.yaw + Math.PI / 2 - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); camYaw += d * Math.min(1, dt * 3); }
  const base = car ? car.pos : P.pos;
  const fwd = new V3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const right = new V3(-Math.cos(camYaw), 0, Math.sin(camYaw));
  camT.set(base.x, base.y + (car ? 2.2 : 2.1), base.z);
  if (!car) camT.addScaledVector(right, -0.75);
  let dist = car ? Math.max(8, camDist + 3) : camDist;
  const back = fwd.clone().negate();
  const hit = world.raycast(camT, back, dist + 0.4, { targets: false });
  if (hit) dist = Math.max(0.6, hit.dist - 0.35);
  camera.position.copy(camT).addScaledVector(back, dist);
  { const gy = world.groundHeight(camera.position.x, camera.position.z, camera.position.y + 1, 0.2); if (gy > -1e9 && camera.position.y < gy + 0.6) camera.position.y = gy + 0.6; }
  if (shake > 0) { camera.position.x += rnd(-1, 1) * shake; camera.position.y += rnd(-1, 1) * shake; shake = Math.max(0, shake - dt * 2.5); }
  camera.lookAt(_a.copy(camT).add(fwd));
  sound.listener.x = camera.position.x; sound.listener.y = camera.position.y; sound.listener.z = camera.position.z;
  // aim: what the crosshair is on
  const o = camera.position, d = camera.getWorldDirection(_b).clone();
  let best = 400, pnt = null;
  const h = world.raycast(o, d, best, { targets: true });
  if (h) { best = h.dist; pnt = h.point; }
  const n = rayNpc(o, d, best);
  AIM.hitNpc = null;
  if (n) { best = n.t; pnt = n.point; AIM.hitNpc = n.npc; }
  AIM.point.copy(pnt || _c.copy(o).addScaledVector(d, 400));
  AIM.dir.copy(d);
}

// ---- pickups ----------------------------------------------------------------------------------------
const pickups = [];
function spawnPickups() {
  const ringGeo = new THREE.TorusGeometry(0.7, 0.05, 6, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8 });
  const beamGeoP = new THREE.CylinderGeometry(0.12, 0.35, 14, 8, 1, true), beamMatP = new THREE.MeshBasicMaterial({ color: 0xffc23f, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  TOWN.pickups.forEach((p, i) => {
    const w = PICKUP_POOL[i % PICKUP_POOL.length];
    const m = weaponModel(w);
    const g = new THREE.Group(); g.add(m.group);
    const beam = new THREE.Mesh(beamGeoP, beamMatP); beam.position.y = 6; g.add(beam);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.85; g.add(ring);
    g.position.set(p.x, p.y + 1.0, p.z);
    scene.add(g);
    pickups.push({ w, g, pos: p.clone(), taken: false });
  });
}
function takePickup(pk) {
  pk.taken = true; scene.remove(pk.g);
  const it = newItem(pk.w), d = WD[pk.w];
  const slot = SLOTS.find((s) => !INV.equip[s.id] && allowed(pk.w, s));
  if (slot) { equipTo(it, slot.id); toast(`Picked up <b>${d.name}</b> → ${slot.label}`, true); }
  else { INV.bag.push(it); toast(`Picked up <b>${d.name}</b> · <kbd>Tab</kbd> to equip`, true); }
  sound.reload?.();
  setTimeout(() => { if (!pk.taken) return; pk.taken = false; pk.w = pick(PICKUP_POOL); const m = weaponModel(pk.w); pk.g.remove(pk.g.children[0]); pk.g.add(m.group); scene.add(pk.g); }, 45000);
  if (invOpen) drawInv();
}

// ---- equipping --------------------------------------------------------------------------------------
function equipTo(it, slotId) {
  const old = INV.equip[slotId];
  if (old) { unmount(old); INV.bag.push(old); }
  INV.bag = INV.bag.filter((x) => x !== it);
  INV.equip[slotId] = it;
  mount(it, slotId);
}
function unequip(slotId) {
  const it = INV.equip[slotId]; if (!it) return;
  unmount(it); INV.equip[slotId] = null; INV.bag.push(it);
}
function mount(it) { const m = weaponModel(it.w); it.model = m; scene.add(m.group); }
function unmount(it) { if (it.model) { scene.remove(it.model.group); it.model = null; } if (it.beam) { scene.remove(it.beam); it.beam = null; } }

const MOUNT = {
  rightHand: { bone: 'RightHand', off: [0, 0, 0] }, leftHand: { bone: 'LeftHand', off: [0, 0, 0] },
  shoulderL: { bone: 'Spine2', off: [0.42, 0.42, -0.12] }, shoulderR: { bone: 'Spine2', off: [-0.42, 0.42, -0.12] },
  legL: { bone: 'LeftUpLeg', off: [0.3, -0.2, 0] }, legR: { bone: 'RightUpLeg', off: [-0.3, -0.2, 0] },
};
const MELEE_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
function placeWeapons() {
  for (const s of SLOTS) {
    const it = INV.equip[s.id]; if (!it || !it.model) continue;
    const g = it.model.group, M = MOUNT[s.id], bone = goat.bones[M.bone] || goat.bones.Spine || goat.bones.Hips;
    g.visible = !P.inCar && goat.g.visible;
    bone.getWorldPosition(g.position);
    if (M.off[0] || M.off[1] || M.off[2]) g.position.add(_a.set(M.off[0], M.off[1], M.off[2]).applyAxisAngle(UP, P.yaw));
    const d = WD[it.w];
    if (d.kind === 'melee') {
      bone.getWorldQuaternion(g.quaternion); g.quaternion.multiply(MELEE_Q);
    } else if (d.kind === 'shield') {
      g.quaternion.setFromAxisAngle(UP, P.yaw + (mouse.r ? 0 : -0.8));
      if (mouse.r) g.position.addScaledVector(_a.set(Math.sin(P.yaw), 0, Math.cos(P.yaw)), 0.5);
    } else {
      // guns point where the crosshair is
      _m.lookAt(AIM.point, g.position, UP);
      g.quaternion.setFromRotationMatrix(_m);
      g.quaternion.multiply(_q.setFromAxisAngle(UP, Math.PI));
    }
    if (it.model.spin && it.spinV) it.model.spin.rotation.z += it.spinV * 0.016;
  }
}

// ---- firing -------------------------------------------------------------------------------------------
function muzzleOf(it) {
  const m = it.model;
  if (m && m.muzzles.length) { const k = (it.mi = ((it.mi || 0) + 1) % m.muzzles.length); return m.muzzles[k].getWorldPosition(new V3()); }
  if (m) return m.group.getWorldPosition(new V3()).addScaledVector(AIM.dir, 0.6);
  return P.pos.clone().setY(P.pos.y + 1.6);
}
function triggers(dt) {
  const held = {
    rightHand: mouse.l && !P.inCar, leftHand: mouse.r && !P.inCar,
    shoulderL: keys.KeyF, shoulderR: keys.KeyF, legL: keys.KeyQ, legR: keys.KeyQ,
  };
  if (mouse.l && !INV.equip.rightHand && !P.inCar && (!P.kickT || P.kickT < T)) { P.kickT = T + 0.55; melee({ dmg: 25, reach: 2.2, power: 80, knock: 9 }, null); }
  for (const s of SLOTS) {
    const it = INV.equip[s.id]; if (!it) continue;
    const d = WD[it.w];
    it.cool -= dt;
    if (it.reloadT > 0) { it.reloadT -= dt; if (it.reloadT <= 0) it.ammo = d.ammo; }
    if (it.spinV) it.spinV = Math.max(0, it.spinV - dt * 30);
    if (d.kind === 'mega') { tickMega(it, d, held[s.id], dt); continue; }
    if (!held[s.id] || it.cool > 0 || it.reloadT > 0 || d.kind === 'shield' || !P.alive) continue;
    if (d.kind === 'melee') { it.cool = d.rate; melee(d, it); continue; }
    if (P.inCar && s.type === 'hand') continue;
    fire(it, d);
    it.cool = d.rate;
    it.ammo--;
    if (it.ammo <= 0) { it.reloadT = d.reload; sound.reload?.(); }
  }
}
function fire(it, d) {
  P.fireFace = 0.8;
  const o = muzzleOf(it), dir = _a.subVectors(AIM.point, o).normalize().clone();
  if (d.kind === 'bullet' || d.kind === 'pellet') {
    const n = d.pellets || 1;
    for (let i = 0; i < n; i++) {
      const dd = dir.clone().add(new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(d.spread || 0)).normalize();
      hitscan(o, dd, 300, d);
    }
    it.spinV = 40;
    fx.muzzle(o, dir, 0xffc070, 0.35);
    d.kind === 'pellet' ? sound.shotgun?.(o) : sound.gun?.(o);
  } else if (d.kind === 'rail') {
    hitscan(o, dir, 400, d, true);
    fx.muzzle(o, dir, d.color, 0.8); sound.beam?.(o); shake = Math.max(shake, 0.15);
  } else if (d.kind === 'flame') {
    for (let i = 0; i < 3; i++) {
      const v = dir.clone().multiplyScalar(rnd(14, 20)).add(new V3(rnd(-1.5, 1.5), rnd(-1, 1.5), rnd(-1.5, 1.5)));
      fx.fire.emit(o.x, o.y, o.z, v.x, v.y, v.z, rnd(0.5, 0.8), 0.3, 1.6, 1, 0.55, 0.15, 1, 0.9, 0.2, 0.05, 0, 0.6, -3);
    }
    flames.push({ p: o.clone(), v: dir.clone().multiplyScalar(17), t: 0.6 });
    if (Math.random() < 0.3) sound.ignite?.(o);
  } else {
    // projectiles
    if (d.kind === 'missile') {
      for (let i = 0; i < 1; i++) launch(d, o, dir, pickTarget(AIM.point));
      sound.missile?.(o);
    } else {
      launch(d, o, dir, null);
      d.kind === 'grenade' ? sound.thump?.(o) : sound.rocket?.(o);
    }
    fx.muzzle(o, dir, 0xffa040, d.nuke ? 1.2 : 0.6);
  }
}
function hitscan(o, d, max, def, pierce) {
  const h = world.raycast(o, d, max, { targets: true });
  let end = h ? h.dist : max;
  const hits = [];
  // people along the ray (all of them for the rail, the nearest otherwise)
  for (const n of npcs) {
    if (n.gone) continue;
    const t = rayNpcOne(n, o, d, end);
    if (t) hits.push(t);
  }
  hits.sort((a, b) => a.t - b.t);
  const use = pierce ? hits : hits.slice(0, 1);
  if (!pierce && use.length) end = use[0].t;
  for (const t of use) hurtNpc(t.npc, def.dmg * (t.head ? 2.5 : 1), d, t.head ? 'head' : 'shot', t.point);
  // loose props
  const bh = rayBodies(o, d, end);
  if (bh) { bh.body.applyImpulse(new CANNON.Vec3(d.x * def.power * 0.2, d.y * def.power * 0.2 + 2, d.z * def.power * 0.2), new CANNON.Vec3(bh.point.x - bh.body.position.x, bh.point.y - bh.body.position.y, bh.point.z - bh.body.position.z)); end = Math.min(end, bh.t); hitBody(bh.body, def.dmg); }
  if (h && h.dist <= end + 0.01) {
    if (h.target) world.damage(h.target, def.dmg * 0.6, h.point);
    D.bullet(h, { radius: def.radius || 0.4, power: def.power, dir: d, speed: 6, chunks: pierce ? 10 : 3 });
    fx.sparksBurst(h.point, h.normal, 5, 0xffc070, 8);
    if (pierce) {
      // the rail keeps going through the wall
      for (let k = 1; k < 4; k++) { const p = h.point.clone().addScaledVector(d, k * 1.2); D.bullet({ point: p, normal: h.normal, struct: h.struct, collider: h.collider }, { radius: def.radius, power: def.power * 0.7, dir: d, speed: 6, chunks: 6 }); }
    }
  }
  tracer(o, _c.copy(o).addScaledVector(d, end), pierce ? def.color : 0xffd890, pierce ? 0.05 : 0.02);
}

// tracers
const tracers = [];
const trGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true); trGeo.rotateX(Math.PI / 2); trGeo.translate(0, 0, 0.5);
function tracer(a, b, color, w) {
  const m = new THREE.Mesh(trGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false }));
  m.position.copy(a); m.lookAt(b); m.scale.set(w, w, a.distanceTo(b)); scene.add(m);
  tracers.push({ m, t: 0.08 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) { const r = tracers[i]; r.t -= dt; r.m.material.opacity = Math.max(0, r.t / 0.08); if (r.t <= 0) { scene.remove(r.m); r.m.material.dispose(); tracers.splice(i, 1); } }
}

// beam cannon
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); beamGeo.rotateX(Math.PI / 2); beamGeo.translate(0, 0, 0.5);
function tickMega(it, d, held, dt) {
  if (!it.megaT) it.megaT = 0;
  if (held && it.cool <= 0 && it.reloadT <= 0 && it.megaT <= 0) { it.megaT = d.charge + d.duration; it.cool = d.rate; sound.laserCharge?.(P.pos, d.charge); }
  if (it.megaT > 0) {
    it.megaT -= dt;
    P.fireFace = 0.5;
    const firing = it.megaT < d.duration;
    if (!it.beam) { it.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.85, toneMapped: false, blending: THREE.AdditiveBlending })); scene.add(it.beam); }
    const o = muzzleOf(it), dir = _a.subVectors(AIM.point, o).normalize().clone();
    const h = world.raycast(o, dir, 260, { targets: true });
    const len = h ? h.dist : 260;
    it.beam.position.copy(o); it.beam.lookAt(_b.copy(o).add(dir)); it.beam.scale.set(firing ? 0.35 : 0.05, firing ? 0.35 : 0.05, firing ? len : 1.5);
    if (firing) {
      if (h) { D.beam(h, dir, dt); if (h.target) world.damage(h.target, d.dps * dt, h.point); fx.beamHit?.(h.point, h.normal, d.color); }
      for (const n of npcs) { const t = rayNpcOne(n, o, dir, len, 0.4); if (t) hurtNpc(n, d.dps * dt * 1.5, dir, 'burn', t.point); }
      const bh = rayBodies(o, dir, len); if (bh) bh.body.applyImpulse(new CANNON.Vec3(dir.x * 30 * dt * 60, 5, dir.z * 30 * dt * 60));
      shake = Math.max(shake, 0.08);
      if (Math.random() < 0.3) sound.beam?.(o);
    }
    if (it.megaT <= 0) { scene.remove(it.beam); it.beam = null; it.ammo--; if (it.ammo <= 0) it.reloadT = d.reload; }
  }
}

// projectiles
const shots = [];
const glowTex = glowTexture();
function launch(d, o, dir, target) {
  const big = d.nuke ? 3 : d.mscale || 1;
  const m = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * big, 0.08 * big, 0.6 * big, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: d.kind === 'grenade' ? 0x2c3a20 : 0xdddddd, metalness: 0.5, roughness: 0.4 }));
  if (d.kind === 'grenade') body.geometry = new THREE.SphereGeometry(0.12 * big, 8, 6);
  m.add(body);
  const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false })); gl.scale.setScalar(0.8 * big); gl.position.z = -0.35 * big; m.add(gl);
  m.position.copy(o); scene.add(m);
  const sp = d.speed * (d.kind === 'missile' ? 0.45 : 1);
  const vel = dir.clone().multiplyScalar(sp);
  if (d.kind === 'missile') vel.add(new V3(rnd(-4, 4), rnd(3, 7), rnd(-4, 4)));
  shots.push({ d, m, pos: o.clone(), vel, target, t: 0, grav: d.kind === 'grenade' ? 16 : 0, fuse: d.kind === 'grenade' ? 3 : 8 });
}
function pickTarget(pt) {
  let best = null, bd = 12;
  for (const n of npcs) { if (n.dead || n.gone) continue; const dd = n.g.position.distanceTo(pt); if (dd < bd) { bd = dd; best = n; } }
  return best || { pos: pt.clone() };
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.t += dt;
    const d = s.d;
    if (d.kind === 'missile' && s.t > 0.25) {
      const tp = s.target && s.target.g ? s.target.g.position.clone().setY(s.target.g.position.y + s.target.h * 0.5) : s.target?.pos;
      if (tp) {
        const want = _a.subVectors(tp, s.pos).normalize().multiplyScalar(d.speed);
        if (d.wobble) want.add(_b.set(Math.sin(s.t * 13 + i), Math.cos(s.t * 11 + i), Math.sin(s.t * 9)).multiplyScalar(d.wobble * 3));
        s.vel.lerp(want, Math.min(1, dt * 4));
      }
    }
    s.vel.y -= s.grav * dt;
    const step = s.vel.length() * dt, dir = _b.copy(s.vel).normalize().clone();
    let hitP = null, normal = UP, h = null;
    if (step > 0) {
      h = world.raycast(s.pos, dir, step + 0.2, { targets: true });
      for (const n of npcs) { const t = rayNpcOne(n, s.pos, dir, h ? h.dist : step + 0.2); if (t) { hitP = t.point; h = null; break; } }
      const bh = rayBodies(s.pos, dir, step + 0.2); if (bh && !hitP) { hitP = bh.point; }
      if (h && !hitP) { hitP = h.point; normal = h.normal; }
    }
    if (d.kind === 'grenade' && h && !hitP?.npc && s.t < s.fuse && Math.abs(s.vel.y) > 3 && h.normal.y > 0.6 && !d.cluster) {
      // bounce
      s.vel.reflect(h.normal).multiplyScalar(0.45); s.pos.copy(h.point).addScaledVector(h.normal, 0.15); hitP = null;
      sound.impact?.(s.pos);
    }
    if (hitP || s.t > s.fuse || s.pos.y < -2) {
      const p = hitP || s.pos;
      if (d.cluster && !s.child) {
        for (let k = 0; k < d.cluster; k++) { const v = new V3(rnd(-6, 6), rnd(5, 10), rnd(-6, 6)); shots.push({ d, m: s.m.clone(), pos: p.clone().addScaledVector(normal, 0.3), vel: v, target: null, t: 0, grav: 16, fuse: rnd(0.8, 1.6), child: true }); scene.add(shots[shots.length - 1].m); }
      }
      explode(p, d.splash || 3, d.power, d.dmg, { normal, nuke: d.nuke });
      scene.remove(s.m); shots.splice(i, 1); continue;
    }
    s.pos.addScaledVector(s.vel, dt);
    s.m.position.copy(s.pos); s.m.lookAt(_a.copy(s.pos).add(s.vel));
    if (d.kind !== 'grenade' && Math.random() < 0.9) fx.smoke.emit(s.pos.x, s.pos.y, s.pos.z, rnd(-0.3, 0.3), rnd(0, 0.5), rnd(-0.3, 0.3), rnd(1, 2), 0.2, 1.2, 0.8, 0.8, 0.8, 0.5, 0.6, 0.6, 0.6, 0, 0.5, 0.3);
  }
}

const flames = [];
function updateFlames(dt) {
  for (let i = flames.length - 1; i >= 0; i--) {
    const f = flames[i]; f.t -= dt; f.p.addScaledVector(f.v, dt);
    for (const n of npcs) if (!n.gone && n.g.position.distanceTo(_a.copy(f.p).setY(f.p.y - n.h * 0.4)) < 1.4) { n.burn = 6; hurtNpc(n, 3, f.v, 'burn', f.p); }
    if (f.t <= 0) { flames.splice(i, 1); if (Math.random() < 0.3) { const h = world.raycast(f.p, f.v.clone().normalize(), 1, { targets: true }); if (h) { if (h.target) world.damage(h.target, 6, h.point); D.bullet(h, { radius: 0.3, power: 20, dir: f.v.clone().normalize(), speed: 2, chunks: 1 }); } } }
  }
}

function explode(p, R, power, dmg, o = {}) {
  D.blast(p, R, power);
  fx.explosion(p, clamp(R / 4.5, 0.35, 4), { normal: o.normal });
  sound.explosion?.(p, clamp(R / 5, 0.5, 3));
  world.damageRadius(p, R * 1.3, dmg);
  shake = Math.max(shake, clamp(R / 6 / (1 + p.distanceTo(camera.position) / 30), 0.05, 1.5));
  if (R >= 5) { hitstop = Math.min(0.09, 0.03 + R * 0.006); for (let i = 0; i < R * 4; i++) fx.smoke.emit(p.x + rnd(-R, R) * 0.5, p.y + rnd(0, R * 0.4), p.z + rnd(-R, R) * 0.5, rnd(-1, 1), rnd(0.2, 1), rnd(-1, 1), rnd(4, 7), R * 0.25, R * 0.7, 0.55, 0.5, 0.45, 0.6, 0.5, 0.48, 0.45, 0, 0.6, -0.05); }
  if (o.nuke) { $('#flash').style.background = '#fff'; $('#flash').style.opacity = 0.9; setTimeout(() => { $('#flash').style.opacity = 0; }, 120); addChaos(500, 'NUKE'); }
  for (const n of npcs) {
    if (n.gone) continue;
    const dd = n.g.position.distanceTo(p);
    if (dd > R * 1.7) continue;
    const k = 1 - dd / (R * 1.7);
    const dir = _a.subVectors(n.g.position, p).setY(0).normalize().clone();
    dir.y = 0.8;
    hurtNpc(n, dmg * (0.3 + k), dir.multiplyScalar(4 + power * 0.04 * k), 'blast', n.g.position.clone().setY(n.g.position.y + n.h * 0.5));
  }
  for (const b of phys.dyn) {
    const dv = _a.set(b.position.x - p.x, b.position.y - p.y, b.position.z - p.z), dd = dv.length();
    if (dd > R * 2) continue;
    dv.normalize(); const k = (1 - dd / (R * 2)) * power * 0.06 * Math.min(b.mass, 40);
    b.wakeUp(); b.applyImpulse(new CANNON.Vec3(dv.x * k, (dv.y + 0.6) * k, dv.z * k));
    if (b.barrel && dd < R) setTimeout(() => blowBarrel(b), rnd(80, 300));
  }
  if (!P.inCar) {
    const dd = P.pos.distanceTo(p);
    if (dd < R * 1.3) { const k = 1 - dd / (R * 1.3); hurtPlayer(dmg * 0.25 * k, p, 'blast'); P.vel.add(_a.subVectors(P.pos, p).normalize().multiplyScalar(14 * k)).setY(P.vel.y + 6 * k); P.grounded = false; }
  }
  addChaos(Math.round(R * 4));
}

// melee: a swing in front of the goat
function melee(d, it) {
  P.fireFace = 0.4;
  P.yaw = camYaw;
  P.attackT = T + 0.45;
  play(goat, Math.random() < 0.5 ? 'atk' : 'atk2', 0.08, 1.6);
  sound.servo?.(P.pos);
  setTimeout(() => {
    const f = new V3(Math.sin(P.yaw), 0, Math.cos(P.yaw)), c = P.pos.clone().addScaledVector(f, d.reach * 0.6).setY(P.pos.y + 1.2);
    let hit = false;
    for (const n of npcs) {
      if (n.gone) continue;
      const q = n.g.position, dd = Math.hypot(q.x - c.x, q.z - c.z);
      if (dd < d.reach * 0.7 + n.r && Math.abs(q.y - P.pos.y) < 2.5) {
        const kn = f.clone().multiplyScalar(d.knock || 4).setY(d.knock ? 4 : 1.5);
        hurtNpc(n, d.dmg, kn, d.kind === 'melee' && it ? (WD[it.w].sever ? 'chop' : 'slash') : 'kick', q.clone().setY(q.y + n.h * 0.6));
        if (d.fire) n.burn = 5;
        hit = true;
      }
    }
    for (const b of phys.dyn) {
      if (Math.hypot(b.position.x - c.x, b.position.z - c.z) < d.reach * 0.8 && Math.abs(b.position.y - c.y) < 2) { b.wakeUp(); b.applyImpulse(new CANNON.Vec3(f.x * d.power * 0.5, d.power * 0.2, f.z * d.power * 0.5)); hit = true; hitBody(b, d.dmg); }
    }
    // walls, cars and trees
    const h = world.raycast(c.clone().addScaledVector(f, -0.8), f, d.reach + 0.6, { targets: true });
    if (h) { if (h.target) world.damage(h.target, d.dmg, h.point); D.bullet(h, { radius: d.power > 400 ? 1.4 : 0.5, power: d.power, dir: f, speed: 5, chunks: d.power > 400 ? 8 : 2 }); fx.sparksBurst(h.point, h.normal, 6, 0xffc070, 8); hit = true; }
    if (hit) { sound.impact?.(c); shake = Math.max(shake, 0.12); }
  }, 180);
}

// ---- people and monsters ----------------------------------------------------------------------------
const npcs = [];
const MONSTERS = [
  ['goatman_black', 'goat'], ['goatman_bw', 'goat'], ['goatman_gold_bad', 'goat'], ['goatman_white', 'goat'], ['goatman_gold_good', 'goat'],
  ['kobold_1', 'kobold'], ['kobold_3', 'kobold'], ['kobold_armored_1', 'kobold'], ['kobold_armored_2', 'kobold'], ['kobold_armored_3', 'kobold'],
  ['goblin_green_1', 'goblin'], ['goblin_green_2', 'goblin'], ['goblin_green_3', 'goblin'], ['goblin_green_armored_1', 'goblin'], ['goblin_green_armored_2', 'goblin'],
  ['goblin_red_1', 'goblin'], ['goblin_red_2', 'goblin'], ['goblin_red_3', 'goblin'], ['goblin_red_armored_1', 'goblin'], ['goblin_red_armored_2', 'goblin'],
  ['zombie_1', 'zombie'], ['zombie_2', 'zombie'], ['zombie_3', 'zombie'], ['zombie_4', 'zombie'], ['zombie_ogre', 'zombie'],
  ['plague_giant_1', 'giant'], ['plague_giant_2', 'giant'], ['plague_giant_armored', 'giant'], ['werewolf_brown', 'wolf'],
  ['possessed_man_1', 'possessed'], ['possessed_man_2', 'possessed'], ['possessed_woman_1', 'possessed'], ['possessed_woman_2', 'possessed'],
];
const HEIGHTS = { goat: 2.3, kobold: 1.4, goblin: 1.3, zombie: 1.8, giant: 3.2, wolf: 2.4, possessed: 1.8 };
const ZOMBIE_H = { zombie_ogre: 2.6 };

let folkClips = [];
async function loadFolkClips() {
  const j = await (await fetch('assets/folk/clips.json')).json();
  // rotations are unit quaternions quantized to int16 (hip translations follow, unused here)
  const I = new Int16Array(await (await fetch('assets/folk/clips.bin')).arrayBuffer(), 0, j.hipsByteOffset >> 1);
  const F = { subarray: (a, b) => Float32Array.from(I.subarray(a, b), (v) => v / 32767) };
  const names = j.skeleton.map((s) => THREE.PropertyBinding.sanitizeNodeName(s.name || s));
  const want = ['idle', 'walk', 'run', 'flee', 'scared', 'afraid', 'wave', 'dance_1', 'dance_3', 'cheer', 'fall', 'hit', 'look_around', 'talk', 'kick', 'throw'];
  for (const name of want) {
    const c = j.clips[name]; if (!c) continue;
    const times = Float32Array.from({ length: c.frames }, (_, i) => i / j.fps);
    const tracks = c.tracks.map(([ji, off, cst]) => cst
      ? new THREE.QuaternionKeyframeTrack(`${names[ji]}.quaternion`, [0], Array.from(F.subarray(off, off + 4)))
      : new THREE.QuaternionKeyframeTrack(`${names[ji]}.quaternion`, times, F.subarray(off, off + c.frames * 4)));
    folkClips.push(new THREE.AnimationClip(name === 'fall' ? 'death' : name, c.dur, tracks));
  }
}

/** Modern clothes: keep skin and hair, turn the rest black/charcoal or a loud color */
function modernize(img, mode) {
  const w = img.width, h = img.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const D2 = g.getImageData(0, 0, w, h), a = D2.data;
  const LOUD = [[230, 40, 60], [30, 120, 240], [250, 200, 20], [40, 200, 120], [250, 110, 20], [180, 60, 220], [20, 200, 220], [255, 90, 170]];
  const c1 = pick(LOUD), c2 = pick(LOUD);
  for (let i = 0; i < a.length; i += 4) {
    const r = a[i] / 255, gg = a[i + 1] / 255, b = a[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = mx, s = mx ? (mx - mn) / mx : 0;
    const skin = r > gg && gg > b * 0.9 && r - b > 0.08 && r - b < 0.5 && s > 0.15 && s < 0.65 && v > 0.42;
    if (skin || v < 0.1) continue;
    const L = 0.3 * r + 0.59 * gg + 0.11 * b;
    let o;
    if (mode === 0) o = [L * 70 + 12, L * 70 + 12, L * 75 + 14];
    else if (mode === 1) { if (L > 0.14) { const k = 0.4 + L * 0.8; o = [c1[0] * k, c1[1] * k, c1[2] * k]; } else o = [L * 80 + 14, L * 80 + 14, L * 85 + 16]; }
    else { const k = 0.35 + L; o = [c1[0] * k * 0.5 + 40 * L, c1[1] * k * 0.5 + 40 * L, c1[2] * k * 0.5 + 40 * L]; }
    a[i] = clamp(o[0], 0, 255); a[i + 1] = clamp(o[1], 0, 255); a[i + 2] = clamp(o[2], 0, 255);
  }
  g.putImageData(D2, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

async function loadPeople(gl) {
  try { await loadFolkClips(); } catch (e) { console.warn('folk clips', e); }
  const folk = (await (await fetch('assets/folk/folk.json')).json()).models;
  const fkeys = Object.keys(folk).sort(() => Math.random() - 0.5).slice(0, 16);
  const mons = MONSTERS.filter(([, k]) => k !== 'goat').sort(() => Math.random() - 0.5).slice(0, 12).concat(MONSTERS.filter(([id, k]) => k === 'goat' && id !== 'goatman_gold_good'));
  const TL = new THREE.ImageLoader();
  // villagers first: they're the town
  await Promise.all(fkeys.map(async (k) => {
    try {
      const f = folk[k];
      const [g, img] = await Promise.all([gl.loadAsync(`assets/folk/${f.glb}`), TL.loadAsync(`assets/folk/${f.c}`)]);
      const texs = [modernize(img, 0), modernize(img, 1), modernize(img, 2)];
      for (let i = 0; i < 3; i++) spawnNpc(g.scene, folkClips, 'folk', f.height || 1.75, texs[i % 3]);
    } catch (e) { console.warn('folk', k, e); }
  }));
  await Promise.all(mons.map(async ([id, kind]) => {
    try {
      const g = await gl.loadAsync(`assets/monsters/${id}.glb`);
      const n = kind === 'giant' || kind === 'wolf' ? 1 : kind === 'goat' ? 2 : 3;
      for (let i = 0; i < n; i++) spawnNpc(g.scene, g.animations, kind, ZOMBIE_H[id] || HEIGHTS[kind]);
    } catch (e) { console.warn('monster', id, e); }
  }));
  toast(`${npcs.length} locals in town. Some of them bite.`, true);
}

function spawnNpc(src, clips, kind, height, tex) {
  const m = setupModel(src, height * rnd(0.95, 1.06));
  if (tex) m.root.traverse((o) => { if (o.isSkinnedMesh) { o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }); } });
  else m.root.traverse((o) => { if (o.isSkinnedMesh) o.material = o.material.clone(); });
  const A = makeActor(m, clips);
  const hostile = !['folk', 'goat'].includes(kind);
  // where: villagers on sidewalks and inside buildings, monsters in parks and the edges of town
  let p;
  if (kind === 'folk' && Math.random() < 0.35 && TOWN.indoor.length) { const r = pick(TOWN.indoor); p = new V3(rnd(r.x0, r.x1), r.y, rnd(r.z0, r.z1)); }
  else if (hostile) { const pk = pick(TOWN.parks); p = Math.random() < 0.5 ? new V3(rnd(pk.x0, pk.x1), 0, rnd(pk.z0, pk.z1)) : pick(TOWN.spots).clone().add(new V3(rnd(-3, 3), 0, rnd(-3, 3))); }
  else p = pick(TOWN.spots).clone().add(new V3(rnd(-2, 2), 0, rnd(-2, 2)));
  m.g.position.copy(p);
  scene.add(m.g);
  const hp = { folk: 60, goat: 140, kobold: 70, goblin: 60, zombie: 110, giant: 500, wolf: 260, possessed: 90 }[kind];
  const n = {
    ...m, ...A, kind, hostile, hp, maxHp: hp, h: m.g.children[0] ? height : height, r: height * 0.22, yaw: rnd(0, 6.28), target: null, speed: 0, state: 'idle', stateT: rnd(1, 4),
    vel: new V3(), fly: false, dead: false, gone: false, burn: 0, cut: new Set(), home: p.clone(), indoor: p.y > 0.5, atkT: 0, aggro: hostile ? 0 : 0, panic: 0,
    limbs: findLimbs(m.root),
  };
  play(n, kind === 'folk' && Math.random() < 0.3 ? pick(['dance', 'wave', 'cheer', 'idle']) : 'idle', 0.1);
  npcs.push(n);
  return n;
}
function findLimbs(root) {
  const L = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name;
    if (!L.head && /(^|[^a-z])Head$|^Head$|mixamorigHead$/.test(n)) L.head = o;
    if (!L.armL && /LeftArm$|upperarm_l$/.test(n)) L.armL = o;
    if (!L.armR && /RightArm$|upperarm_r$/.test(n)) L.armR = o;
    if (!L.legL && /LeftUpLeg$|thigh_l$/.test(n)) L.legL = o;
    if (!L.legR && /RightUpLeg$|thigh_r$/.test(n)) L.legR = o;
    if (!L.foreL && /LeftForeArm$|lowerarm_l$/.test(n)) L.foreL = o;
    if (!L.foreR && /RightForeArm$|lowerarm_r$/.test(n)) L.foreR = o;
    if (!L.shinL && /LeftLeg$|calf_l$/.test(n)) L.shinL = o;
    if (!L.shinR && /RightLeg$|calf_r$/.test(n)) L.shinR = o;
  });
  return L;
}

function rayNpcOne(n, o, d, max, pad = 0) {
  if (n.gone) return null;
  const p = n.g.position;
  // body capsule as two spheres and a head sphere
  const tests = [[n.h * 0.55, n.r * 1.25 + pad, false], [n.h * 0.25, n.r * 1.1 + pad, false], [n.h * 0.9, n.r * 0.75 + pad, true]];
  let best = null;
  for (const [hy, r, head] of tests) {
    if (n.cut.has('head') && head) continue;
    const cx = p.x, cy = p.y + (n.dead && !n.fly ? 0.3 : hy), cz = p.z;
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > max) continue;
    if (!best || t < best.t) best = { t, npc: n, head: head && !n.dead, point: new V3().copy(o).addScaledVector(d, t) };
  }
  return best;
}
function rayNpc(o, d, max) { let best = null; for (const n of npcs) { const t = rayNpcOne(n, o, d, max); if (t && (!best || t.t < best.t)) best = t; } return best; }

function hurtNpc(n, dmg, dir, kind, point) {
  if (n.gone) return;
  const p = point || n.g.position.clone().setY(n.g.position.y + n.h * 0.6);
  const dd = dir ? dir.clone() : new V3(0, 1, 0);
  bleed(p, dd.clone().normalize(), Math.min(40, dmg * 0.8));
  if (n.dead) {
    // the dead still come apart
    if (kind === 'blast' || kind === 'chop' || (kind === 'head' && !n.cut.has('head'))) maybeSever(n, kind, dd, kind === 'blast' ? 0.5 : 0.6);
    if (kind === 'blast' && dir) launchNpc(n, dd);
    return;
  }
  n.hp -= dmg;
  if (kind === 'head' && dmg > 20) { sever(n, 'head', dd); n.hp = 0; }
  else if (kind === 'chop' && Math.random() < 0.7) maybeSever(n, kind, dd, 0.9);
  else if (kind === 'slash' && Math.random() < 0.3) maybeSever(n, kind, dd, 0.6);
  else if (kind === 'blast' && dmg > 40) maybeSever(n, kind, dd, dmg > 120 ? 0.8 : 0.35);
  else if (kind === 'shot' && dmg > 25 && Math.random() < 0.15) maybeSever(n, kind, dd, 0.5);
  if (n.hostile || n.kind === 'goat') { n.aggro = 30; n.hostile = true; }
  else n.panic = 12;
  // everyone near panics
  for (const o of npcs) if (!o.hostile && !o.dead && o.g.position.distanceTo(n.g.position) < 25) o.panic = 10;
  if (n.hp <= 0) die(n, kind, dd);
  else {
    play(n, 'hit', 0.05);
    n.stunT = T + 0.5;
    if (kind === 'blast' || (dir && dir.length() > 6)) launchNpc(n, dd);
  }
}
function launchNpc(n, v) { n.fly = true; n.vel.copy(v); n.spin = rnd(-8, 8); }
function die(n, kind, dir) {
  if (n.dead) return;
  n.dead = true; n.deadT = 0;
  kills++;
  addChaos(n.hostile ? 150 : 100, n.hostile ? `${n.kind.toUpperCase()} DOWN` : 'LOCAL DOWN');
  play(n, 'death', 0.1);
  if (kind === 'blast' || kind === 'car') launchNpc(n, dir);
  if (kind === 'blast' && dir && dir.length() > 25) { gib(n); }
  bloodPool(n.g.position, 0.6 + Math.random() * 0.8);
}
function maybeSever(n, kind, dir, chance) {
  if (Math.random() > chance) return;
  const options = ['armL', 'armR', 'legL', 'legR', 'foreL', 'foreR', 'shinL', 'shinR', 'head'].filter((k) => n.limbs[k] && !n.cut.has(k));
  if (!options.length) return;
  sever(n, pick(options), dir);
}
const MEAT = new THREE.MeshStandardMaterial({ color: 0x7a0b0b, roughness: 0.5 });
const BONEM = new THREE.MeshStandardMaterial({ color: 0xe8e0c8, roughness: 0.6 });
function sever(n, part, dir) {
  const b = n.limbs[part]; if (!b || n.cut.has(part)) return;
  n.cut.add(part);
  const p = b.getWorldPosition(new V3());
  if (!Number.isFinite(p.x + p.y + p.z)) p.copy(n.g.position).setY(n.g.position.y + n.h * 0.6);
  b.scale.setScalar(0.0001);
  // the piece that comes off: a chunk with the skin's color, flying
  const isHead = part === 'head';
  const len = isHead ? n.h * 0.13 : /fore|shin/.test(part) ? n.h * 0.16 : n.h * 0.26;
  const rad = isHead ? n.h * 0.075 : n.h * 0.05;
  const geo = isHead ? new THREE.SphereGeometry(rad, 10, 8) : new THREE.CapsuleGeometry(rad, len, 4, 8);
  const skinMat = n.mesh && n.mesh.material && n.mesh.material.map ? new THREE.MeshStandardMaterial({ map: n.mesh.material.map, roughness: 0.8 }) : MEAT;
  const mesh = new THREE.Mesh(geo, skinMat); mesh.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(rad * 1.05, 10), MEAT); cap.position.y = isHead ? -rad * 0.7 : len / 2 + rad * 0.9; cap.rotation.x = Math.PI / 2; mesh.add(cap);
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.3, rad * 0.3, rad * 0.8, 6), BONEM); bone.position.y = cap.position.y + rad * 0.2; mesh.add(bone);
  const g = new THREE.Group(); g.add(mesh); scene.add(g);
  const shape = isHead ? new CANNON.Sphere(rad) : new CANNON.Box(new CANNON.Vec3(rad, len / 2 + rad, rad));
  const body = new CANNON.Body({ mass: isHead ? 4 : 3, shape, position: new CANNON.Vec3(p.x, p.y, p.z), linearDamping: 0.1, angularDamping: 0.2 });
  const v = dir ? dir.clone().normalize().multiplyScalar(rnd(3, 8)) : new V3();
  body.velocity.set(v.x + rnd(-2, 2), v.y + rnd(2, 5), v.z + rnd(-2, 2)); body.angularVelocity.set(rnd(-10, 10), rnd(-10, 10), rnd(-10, 10));
  addBody(body, g, { gib: true, life: 40 });
  spurts.push({ bone: b.parent || b, t: 2.5, n });
  bleed(p, UP, 30);
  bloodPool(n.g.position.clone().add(new V3(rnd(-0.5, 0.5), 0, rnd(-0.5, 0.5))), 0.5);
  sound.crunch?.(p);
  addChaos(isHead ? 120 : 60, isHead ? 'DECAPITATED' : 'DISMEMBERED');
  if (isHead || (n.cut.has('legL') && n.cut.has('legR'))) { if (!n.dead) { n.hp = 0; die(n, 'cut', dir); } }
}
function gib(n) {
  n.gone = true; scene.remove(n.g);
  const p = n.g.position.clone().setY(n.g.position.y + n.h * 0.5);
  for (let i = 0; i < 9; i++) {
    const r = n.h * rnd(0.04, 0.08);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), i % 3 ? MEAT : BONEM); m.castShadow = true;
    const g = new THREE.Group(); g.add(m); scene.add(g);
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(r), position: new CANNON.Vec3(p.x, p.y, p.z), linearDamping: 0.1 });
    body.velocity.set(rnd(-9, 9), rnd(4, 12), rnd(-9, 9));
    addBody(body, g, { gib: true, life: 30 });
  }
  bleed(p, UP, 80); bloodPool(n.g.position, 1.8);
  addChaos(200, 'OBLITERATED');
}

function updateNpcs(dt) {
  const pp = P.inCar ? P.inCar.pos : P.pos;
  for (const n of npcs) {
    if (n.gone) continue;
    const pos = n.g.position, d = Math.hypot(pos.x - pp.x, pos.z - pp.z);
    const near = d < 110;
    n.g.visible = d < 170;
    // spurting stumps and burning
    if (n.burn > 0) { n.burn -= dt; if (Math.random() < 0.6) fx.fire.emit(pos.x + rnd(-0.3, 0.3), pos.y + rnd(0.3, n.h), pos.z + rnd(-0.3, 0.3), 0, 2, 0, 0.5, 0.4, 0.1, 1, 0.6, 0.2, 1, 1, 0.3, 0, 0); if (!n.dead) { n.hp -= dt * 12; n.panic = 5; if (n.hp <= 0) die(n, 'burn', UP); } }
    if (n.fly) {
      n.vel.y -= 20 * dt;
      const prev = pos.y;
      pos.addScaledVector(n.vel, dt);
      n.root.rotation.x += n.spin * dt;
      world.resolve(pos, n.r, n.h * 0.6, Math.max(prev, pos.y));
      const g = world.groundHeight(pos.x, pos.z, Math.max(prev, pos.y), n.r * 0.5);
      if (pos.y <= g) {
        pos.y = g;
        if (n.vel.y < -12) { hurtNpc(n, (-n.vel.y - 12) * 6, new V3(0, 1, 0), 'fall'); bloodPool(pos, 0.5); sound.thump?.(pos); }
        n.vel.y = Math.abs(n.vel.y) > 8 ? -n.vel.y * 0.3 : 0; n.vel.x *= 0.5; n.vel.z *= 0.5;
        if (Math.hypot(n.vel.x, n.vel.z) < 0.6 && Math.abs(n.vel.y) < 0.5) { n.fly = false; n.root.rotation.x = n.dead ? 0 : 0; if (!n.dead) play(n, 'idle'); }
      }
      if (near) n.mixer.update(dt);
      continue;
    }
    if (n.dead) { n.deadT += dt; if (near && n.deadT < 4) n.mixer.update(dt); if (n.deadT > 120 && d > 60) { n.gone = true; scene.remove(n.g); } continue; }
    if (n.stunT && n.stunT > T) { if (near) n.mixer.update(dt); continue; }
    // brains
    n.stateT -= dt; n.panic -= dt; n.aggro -= dt;
    let goal = null, run = false;
    const target = n.hostile ? huntTarget(n) : null;
    if (target) {
      goal = target.p; run = true;
      const td = Math.hypot(goal.x - pos.x, goal.z - pos.z);
      if (td < 1.3 + n.r * 2 && Math.abs(goal.y - pos.y) < 2) {
        goal = null;
        n.yaw = Math.atan2(target.p.x - pos.x, target.p.z - pos.z);
        if (n.atkT < T) {
          n.atkT = T + 1.4;
          play(n, Math.random() < 0.5 ? 'atk' : 'atk2', 0.1);
          const dmg = { kobold: 8, goblin: 7, zombie: 12, giant: 35, wolf: 20, possessed: 10, goat: 15 }[n.kind] || 8;
          setTimeout(() => {
            if (n.dead) return;
            if (target.isPlayer) { if (!P.inCar && P.pos.distanceTo(pos) < 2.8 + n.r * 2) hurtPlayer(dmg, pos, 'claw'); }
            else if (target.npc && !target.npc.dead && target.npc.g.position.distanceTo(pos) < 2.6) hurtNpc(target.npc, dmg * 1.5, _a.subVectors(target.npc.g.position, pos).normalize().multiplyScalar(2), 'slash');
          }, 450);
        }
      }
    } else if (n.panic > 0) {
      const away = _a.subVectors(pos, pp).setY(0).normalize();
      goal = pos.clone().addScaledVector(away, 10); run = true;
    } else {
      if (n.stateT <= 0) {
        n.stateT = rnd(3, 9);
        if (Math.random() < 0.6) {
          if (n.indoor) { const r = TOWN.indoor.find((q) => Math.abs(q.y - n.home.y) < 0.5 && n.home.x > q.x0 - 1 && n.home.x < q.x1 + 1 && n.home.z > q.z0 - 1 && n.home.z < q.z1 + 1); n.wander = r ? new V3(rnd(r.x0, r.x1), r.y, rnd(r.z0, r.z1)) : n.home.clone(); }
          else n.wander = pick(TOWN.spots).clone();
          if (!n.indoor && n.wander.distanceTo(pos) > 60) n.wander = pos.clone().add(new V3(rnd(-15, 15), 0, rnd(-15, 15)));
        } else n.wander = null;
      }
      goal = n.wander;
    }
    let moving = false;
    if (goal) {
      const dx = goal.x - pos.x, dz = goal.z - pos.z, dl = Math.hypot(dx, dz);
      if (dl > 0.6) {
        const sp = (run ? (n.kind === 'zombie' ? 2.2 : n.kind === 'giant' ? 3.5 : n.kind === 'wolf' ? 8 : 4.6) : 1.3) * (n.hostile && !run ? 1 : 1);
        const want = Math.atan2(dx, dz); let dy = want - n.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); n.yaw += dy * Math.min(1, dt * 6);
        const px = pos.x, pz = pos.z, py = pos.y;
        pos.x += Math.sin(n.yaw) * sp * dt; pos.z += Math.cos(n.yaw) * sp * dt;
        if (near) {
          world.resolve(pos, n.r, n.h, py);
          const g = world.groundHeight(pos.x, pos.z, py, n.r * 0.5);
          if (g > -1e9 && g < py + 0.75) pos.y = damp(py, g, 20, dt); else if (g < py - 0.1) pos.y = Math.max(g, py - 9 * dt);
        }
        if (Math.hypot(pos.x - px, pos.z - pz) < sp * dt * 0.3) { n.stuckT = (n.stuckT || 0) + dt; if (n.stuckT > 1) { n.wander = null; n.stateT = 0; n.stuckT = 0; n.yaw += rnd(-2, 2); } }
        moving = true;
        play(n, run ? (n.kind === 'folk' && n.panic > 0 ? 'flee' : 'run') : 'walk', 0.25);
      } else if (n.wander) { n.wander = null; }
    }
    if (!moving && (!n.cur || n.cur === n.acts.walk || n.cur === n.acts.run || n.cur === n.acts.flee)) play(n, n.panic > 0 ? 'scared' : 'idle', 0.3);
    n.g.rotation.y = n.yaw;
    if (near) n.mixer.update(dt * (n.dead ? 1 : 1));
  }
  // spurts
  for (let i = spurts.length - 1; i >= 0; i--) {
    const s = spurts[i]; s.t -= dt;
    if (s.t <= 0 || s.n.gone) { spurts.splice(i, 1); continue; }
    s.bone.getWorldPosition(_a);
    if (Math.random() < 0.7) blood.emit(_a.x, _a.y, _a.z, rnd(-1.5, 1.5), rnd(1, 4), rnd(-1.5, 1.5), 0.9, 0.06, 0.05, 0.5, 0.02, 0.02, 1, 0.3, 0, 0, 1, 0, 12);
  }
}
function huntTarget(n) {
  const pos = n.g.position;
  const pp = P.inCar ? P.inCar.pos : P.pos;
  const dP = pos.distanceTo(pp);
  if (P.alive && (dP < 35 || n.aggro > 0)) return { p: pp, isPlayer: true };
  // monsters hunt villagers too
  if (n.kind === 'goat') return null;
  let best = null, bd = 25;
  for (const o of npcs) { if (o === n || o.dead || o.gone || o.hostile) continue; const dd = o.g.position.distanceTo(pos); if (dd < bd) { bd = dd; best = o; } }
  return best ? { p: best.g.position, npc: best } : null;
}

// ---- blood --------------------------------------------------------------------------------------------
let blood, poolMat;
const spurts = [], pools = [];
function initGore() {
  blood = new Particles(scene, { capacity: 6000, texture: glowTexture(), additive: false });
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  for (let i = 0; i < 9; i++) { const x = 64 + rnd(-25, 25), y = 64 + rnd(-25, 25), r = rnd(15, 38); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(90,0,4,0.95)'); gr.addColorStop(0.8, 'rgba(70,0,3,0.85)'); gr.addColorStop(1, 'rgba(60,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  poolMat = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
}
function bleed(p, dir, n) {
  if (!blood) return;
  for (let i = 0; i < n; i++) {
    const v = dir.clone().multiplyScalar(rnd(1, 5)).add(new V3(rnd(-2, 2), rnd(0, 3), rnd(-2, 2)));
    blood.emit(p.x, p.y, p.z, v.x, v.y, v.z, rnd(0.6, 1.2), rnd(0.05, 0.1), 0.04, 0.45, 0.01, 0.02, 1, 0.25, 0, 0, 1, 0.3, 14);
  }
}
const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function bloodPool(p, s) {
  const g = world.groundHeight(p.x, p.z, p.y + 0.5, 0.2);
  const m = new THREE.Mesh(poolGeo, poolMat); m.position.set(p.x, (g > -1e9 ? g : p.y) + 0.03, p.z); m.rotation.y = rnd(0, 6); m.scale.setScalar(0.1); m.receiveShadow = true; scene.add(m);
  pools.push({ m, s, t: 0 });
  if (pools.length > 220) { const o = pools.shift(); scene.remove(o.m); }
}
function updatePools(dt) { for (const p of pools) if (p.t < 1) { p.t = Math.min(1, p.t + dt * 0.5); p.m.scale.setScalar(p.s * (0.2 + 0.8 * p.t)); } }

// ---- physics props and playground toys -------------------------------------------------------------------
function initPhysics() {
  const w = new CANNON.World({ gravity: new CANNON.Vec3(0, -16, 0) });
  w.broadphase = new CANNON.SAPBroadphase(w);
  w.allowSleep = true;
  w.defaultContactMaterial.friction = 0.4; w.defaultContactMaterial.restitution = 0.2;
  groundMat = new CANNON.Material('g');
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMat });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0); w.addBody(ground);
  phys = { w, dyn: [], meshes: [], stand: [], statics: new Map(), lines: [] };
  // town colliders as static boxes (taken away once their building turns to voxels)
  for (const c of world.colliders) {
    if (c.walk || c.stair || !c.owner) continue;
    const hx = (c.max.x - c.min.x) / 2, hy = (c.max.y - c.min.y) / 2, hz = (c.max.z - c.min.z) / 2;
    if (hx < 0.05 || hy < 0.05 || hz < 0.05) continue;
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), position: new CANNON.Vec3(c.min.x + hx, c.min.y + hy, c.min.z + hz) });
    w.addBody(b);
    let l = phys.statics.get(c.owner); if (!l) phys.statics.set(c.owner, (l = [])); l.push(b);
  }
  buildToys();
}
function addBody(body, obj, o = {}) {
  phys.w.addBody(body); scene.add(obj);
  body.obj = obj; Object.assign(body, o); body.born = T;
  phys.dyn.push(body);
  return body;
}
function mesh(geo, color, o = {}) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0, emissive: o.emissive || 0 })); m.castShadow = true; m.receiveShadow = true; return m; }
function staticBox(x, y, z, sx, sy, sz, color) {
  const m = mesh(new THREE.BoxGeometry(sx, sy, sz), color); m.position.set(x, y, z); scene.add(m);
  const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)), position: new CANNON.Vec3(x, y, z) }); phys.w.addBody(b); return b;
}
function dynBox(x, y, z, sx, sy, sz, color, mass, o = {}) {
  const m = mesh(new THREE.BoxGeometry(sx, sy, sz), color, o);
  const b = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)), position: new CANNON.Vec3(x, y, z), linearDamping: o.ld ?? 0.05, angularDamping: o.ad ?? 0.1 });
  const g = new THREE.Group(); g.add(m);
  return addBody(b, g, o);
}
function dynBall(x, y, z, r, color, mass, o = {}) {
  const m = mesh(new THREE.SphereGeometry(r, 18, 12), color, o);
  if (o.stripes) { const s = mesh(new THREE.TorusGeometry(r * 1.001, r * 0.08, 6, 24), 0xffffff); m.add(s); const s2 = s.clone(); s2.rotation.y = Math.PI / 2; m.add(s2); }
  const mat = new CANNON.Material(); const cm = new CANNON.ContactMaterial(mat, groundMat, { restitution: o.bounce ?? 0.6, friction: 0.4 }); phys.w.addContactMaterial(cm);
  const b = new CANNON.Body({ mass, shape: new CANNON.Sphere(r), position: new CANNON.Vec3(x, y, z), material: mat, linearDamping: 0.05, angularDamping: 0.1 });
  const g = new THREE.Group(); g.add(m);
  return addBody(b, g, o);
}
function rope(a, bodyB, pivotB, color = 0x333333) {
  const geo = new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]);
  const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color })); scene.add(l);
  phys.lines.push({ l, a, b: bodyB, pv: pivotB });
}
function buildToys() {
  for (const T0 of TOWN.parkToys || []) {
    const { cx, cz, big } = T0;
    // swing set
    const sx = cx + (big ? 6 : 4), sz = cz - (big ? 22 : 14), n = big ? 6 : 4, H = 3.2, span = n * 1.3 + 0.6;
    for (const dx of [-span / 2, span / 2]) for (const dz of [-1, 1]) { const p = mesh(new THREE.CylinderGeometry(0.07, 0.07, H * 1.08, 6), 0x2266cc); p.position.set(sx + dx, H / 2, sz + dz * 0.9); p.rotation.x = dz * 0.28; scene.add(p); }
    const bar = mesh(new THREE.CylinderGeometry(0.08, 0.08, span, 8), 0x2266cc); bar.rotation.z = Math.PI / 2; bar.position.set(sx, H, sz); scene.add(bar);
    const top = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(sx, H, sz) }); phys.w.addBody(top);
    for (let i = 0; i < n; i++) {
      const x = sx - span / 2 + 0.95 + i * 1.3;
      const seat = dynBox(x, 0.6, sz, 0.55, 0.06, 0.28, [0xdd2222, 0xffcc00, 0x22aa44][i % 3], 4, { ad: 0.3, ld: 0.02 });
      for (const ox of [-0.24, 0.24]) {
        const c = new CANNON.PointToPointConstraint(seat, new CANNON.Vec3(ox, 0, 0), top, new CANNON.Vec3(x - sx + ox, 0, 0)); phys.w.addConstraint(c);
        rope(new V3(x + ox, H, sz), seat, new CANNON.Vec3(ox, 0, 0));
      }
    }
    // seesaws
    for (let i = 0; i < (big ? 3 : 2); i++) {
      const x = cx - 4 + i * 4, z = cz + (big ? 26 : 12);
      staticBox(x, 0.3, z, 0.4, 0.6, 0.5, 0x555555);
      const plank = dynBox(x, 0.68, z, 4.2, 0.1, 0.4, 0xff6622, 12, { ad: 0.05 });
      const piv = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 0.68, z) }); phys.w.addBody(piv);
      phys.w.addConstraint(new CANNON.HingeConstraint(plank, piv, { pivotA: new CANNON.Vec3(), axisA: new CANNON.Vec3(0, 0, 1), pivotB: new CANNON.Vec3(), axisB: new CANNON.Vec3(0, 0, 1) }));
      for (const s of [-1.9, 1.9]) { const h = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5), 0x222222); h.position.set(s, 0.3, 0); h.rotation.x = Math.PI / 2; plank.obj.add(h); }
      plank.stand = true; phys.stand.push(plank);
    }
    // merry-go-round
    {
      const x = cx + (big ? 16 : 8), z = cz + (big ? 0 : 4), R = big ? 2.6 : 2;
      const disc = mesh(new THREE.CylinderGeometry(R, R, 0.15, 24), 0xeecc22);
      const g = new THREE.Group(); g.add(disc);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const bar = mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), 0xcc2222); bar.position.set(Math.cos(a) * R * 0.85, 0.5, Math.sin(a) * R * 0.85); g.add(bar); }
      const pole = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), 0xcc2222); pole.position.y = 0.6; g.add(pole);
      const b = new CANNON.Body({ mass: 80, shape: new CANNON.Cylinder(R, R, 0.15, 16), position: new CANNON.Vec3(x, 0.35, z), angularDamping: 0.08 });
      addBody(b, g, { mgr: true });
      const piv = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 0.35, z) }); phys.w.addBody(piv);
      phys.w.addConstraint(new CANNON.HingeConstraint(b, piv, { pivotA: new CANNON.Vec3(), axisA: new CANNON.Vec3(0, 1, 0), pivotB: new CANNON.Vec3(), axisB: new CANNON.Vec3(0, 1, 0) }));
      b.stand = true; phys.stand.push(b); b.allowSleep = false;
      b.angularVelocity.set(0, 1.5, 0);
    }
    // trampolines
    for (let i = 0; i < (big ? 3 : 1); i++) {
      const x = cx - (big ? 6 : 2) - i * 5.5, z = cz + (big ? 10 : 6), r = 2;
      const t = mesh(new THREE.CylinderGeometry(r, r, 0.08, 24), 0x111111); t.position.set(x, 0.75, z); scene.add(t);
      const rim = mesh(new THREE.TorusGeometry(r, 0.12, 6, 24), 0x2288ff); rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.78, z); scene.add(rim);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; const l = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 5), 0x888888); l.position.set(x + Math.cos(a) * r, 0.37, z + Math.sin(a) * r); scene.add(l); }
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(r, r, 0.1, 16), position: new CANNON.Vec3(x, 0.75, z), material: new CANNON.Material() });
      phys.w.addBody(b);
      phys.w.addContactMaterial(new CANNON.ContactMaterial(b.material, b.material, { restitution: 1 }));
      b.aabbNeedsUpdate = true; b.updateAABB(); phys.stand.push(b);
      TOWN.bounce.push({ x, z, r, y: 0.8 });
    }
    // giant balls and beach balls
    for (let i = 0; i < (big ? 6 : 3); i++) dynBall(cx + rnd(-12, 12), 3, cz + rnd(-4, 8), i % 2 ? 1.2 : 0.45, [0xff3355, 0x33aaff, 0xffdd22, 0x44dd66][i % 4], i % 2 ? 6 : 0.6, { bounce: 0.85, stripes: true });
    // spring riders
    for (let i = 0; i < (big ? 4 : 2); i++) {
      const x = cx + 10 + i * 2.2, z = cz - 6;
      const g = new THREE.Group(); const bodyM = mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 8), [0x44cc44, 0xff8800, 0xcc44cc, 0x2299ff][i]); bodyM.rotation.z = Math.PI / 2; g.add(bodyM);
      const head = mesh(new THREE.SphereGeometry(0.25, 10, 8), bodyM.material.color.getHex()); head.position.set(0.45, 0.3, 0); g.add(head);
      const b = new CANNON.Body({ mass: 6, shape: new CANNON.Box(new CANNON.Vec3(0.45, 0.25, 0.25)), position: new CANNON.Vec3(x, 1.0, z), angularDamping: 0.3, linearDamping: 0.3 });
      addBody(b, g, {});
      const base = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 0, z) }); phys.w.addBody(base);
      phys.w.addConstraint(new CANNON.PointToPointConstraint(b, new CANNON.Vec3(0, -0.9, 0), base, new CANNON.Vec3()));
      const sp = new CANNON.Spring(b, base, { localAnchorA: new CANNON.Vec3(0, 0.3, 0), localAnchorB: new CANNON.Vec3(0, 1.3, 0), restLength: 0, stiffness: 120, damping: 2 });
      phys.springs = phys.springs || []; phys.springs.push(sp);
      rope(new V3(x, 0, z), b, new CANNON.Vec3(0, -0.9, 0), 0x999999);
    }
    if (big) {
      // tire swing
      const x = cx - 14, z = cz - 18;
      for (const dx of [-1.6, 1.6]) { const p = mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.2, 6), 0x664422); p.position.set(x + dx, 2.1, z); scene.add(p); }
      const bar = mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), 0x664422); bar.rotation.z = Math.PI / 2; bar.position.set(x, 4.2, z); scene.add(bar);
      const tire = new THREE.Group(); tire.add(mesh(new THREE.TorusGeometry(0.55, 0.2, 8, 18), 0x161616)); tire.children[0].rotation.x = Math.PI / 2;
      const tb = new CANNON.Body({ mass: 10, shape: new CANNON.Cylinder(0.75, 0.75, 0.4, 10), position: new CANNON.Vec3(x, 1.2, z), angularDamping: 0.2 });
      addBody(tb, tire, {});
      const tp = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(x, 4.2, z) }); phys.w.addBody(tp);
      phys.w.addConstraint(new CANNON.DistanceConstraint(tb, tp, 3));
      rope(new V3(x, 4.2, z), tb, new CANNON.Vec3(0, 0, 0));
      // domino run
      for (let i = 0; i < 40; i++) { const a = i * 0.09; dynBox(cx + 22 + Math.cos(a) * 10, 1.0, cz + 26 - Math.sin(a) * 10 * 0.6 - i * 0.12, 0.3, 2, 1, [0xffffff, 0x222222][i % 2], 6).quaternion.setFromEuler(0, a + Math.PI / 2, 0); }
      // bowling lane
      for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) { const pin = dynBox(cx - 24 + r * 0.6, 0.6, cz + 30 + (k - r / 2) * 0.6, 0.25, 1.2, 0.25, 0xffffff, 2); pin.pin = true; }
      dynBall(cx - 34, 0.5, cz + 30, 0.4, 0x111133, 12, { bounce: 0.1 });
      // crate pyramid
      for (let r = 0; r < 5; r++) for (let k = 0; k < 5 - r; k++) dynBox(cx + 30 + k * 1.05 + r * 0.52, 0.5 + r * 1.0, cz - 26, 1, 1, 1, 0x9a6b3a, 8);
      // zip line from the green tower
      const z0 = new V3(T0.fx + 26.5, T0.H + 2 + 2.6, T0.fz - 1.5), z1 = new V3(cx + 40, 1.6, cz - 30);
      const geo = new THREE.BufferGeometry().setFromPoints([z0, z1]); scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 })));
      for (const p of [z1]) { const post = mesh(new THREE.CylinderGeometry(0.12, 0.12, p.y + 0.3, 6), 0x555555); post.position.set(p.x, (p.y + 0.3) / 2, p.z); scene.add(post); }
      zips.push({ a: z0, b: z1 });
    }
  }
  // shopping carts at the grocery
  if (TOWN.carts) for (let i = 0; i < 8; i++) {
    const c = TOWN.carts, g = new THREE.Group();
    const basket = mesh(new THREE.BoxGeometry(0.6, 0.45, 0.9), 0xb0b4ba, { metal: 0.8, rough: 0.3 }); basket.position.y = 0.35; g.add(basket);
    const handle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 5), 0xcc2222); handle.rotation.z = Math.PI / 2; handle.position.set(0, 0.7, -0.5); g.add(handle);
    const b = new CANNON.Body({ mass: 15, shape: new CANNON.Box(new CANNON.Vec3(0.3, 0.45, 0.45)), position: new CANNON.Vec3(c.x + i * 0.75, 0.5, c.z), linearDamping: 0.3, angularDamping: 0.5 });
    b.shapeOffsets[0].set(0, 0, 0);
    addBody(b, g, {});
  }
  for (const bl of TOWN.balls || []) dynBall(bl.x, bl.y, bl.z, bl.r, bl.color, 0.6, { bounce: 0.75 });
  // explosive barrels and traffic cones on the streets
  for (let i = 0; i < 26; i++) {
    const p = pick(TOWN.spots);
    const g = new THREE.Group(); g.add(mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 12), 0xc4161c, { metal: 0.4, rough: 0.4 }));
    const b = new CANNON.Body({ mass: 20, shape: new CANNON.Cylinder(0.32, 0.32, 0.9, 10), position: new CANNON.Vec3(p.x + rnd(-1, 1), 0.46, p.z + rnd(-1, 1)) });
    addBody(b, g, { barrel: true, hp: 25 });
  }
  for (let i = 0; i < 30; i++) {
    const p = pick(TOWN.spots);
    const g = new THREE.Group(); g.add(mesh(new THREE.ConeGeometry(0.2, 0.7, 10), 0xff6a00));
    const b = new CANNON.Body({ mass: 1.5, shape: new CANNON.Cylinder(0.04, 0.2, 0.7, 8), position: new CANNON.Vec3(p.x + rnd(-2, 2), 0.36, p.z + rnd(-2, 2)) });
    addBody(b, g, {});
  }
}
function hitBody(b, dmg) { if (b.barrel) { b.hp -= dmg; if (b.hp <= 0) blowBarrel(b); } }
function blowBarrel(b) {
  if (b.blown) return; b.blown = true;
  const p = new V3(b.position.x, b.position.y, b.position.z);
  removeBody(b);
  explode(p, 4.5, 380, 110, {});
}
function removeBody(b) { phys.w.removeBody(b); scene.remove(b.obj); const i = phys.dyn.indexOf(b); if (i >= 0) phys.dyn.splice(i, 1); const j = phys.stand.indexOf(b); if (j >= 0) phys.stand.splice(j, 1); }
function rayBodies(o, d, max) {
  let best = null;
  for (const b of phys.dyn) {
    const r = b.boundingRadius * 0.8;
    const ox = o.x - b.position.x, oy = o.y - b.position.y, oz = o.z - b.position.z;
    const bb = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = bb * bb - c;
    if (disc < 0) continue;
    const t = -bb - Math.sqrt(disc);
    if (t < 0 || t > max || (best && t > best.t)) continue;
    best = { t, body: b, point: new V3().copy(o).addScaledVector(d, t) };
  }
  return best;
}
function pushBodies(pos, vel, r, h, mass) {
  for (const b of phys.dyn) {
    if (b.mgr) continue;
    const dx = b.position.x - pos.x, dz = b.position.z - pos.z, dy = b.position.y - pos.y;
    const rr = r + b.boundingRadius * 0.6;
    if (dy < -0.5 || dy > h || dx * dx + dz * dz > rr * rr) continue;
    const d = Math.hypot(dx, dz) || 1;
    const sp = Math.hypot(vel.x, vel.z);
    b.wakeUp();
    const k = Math.min(mass, 40) * Math.max(1.5, sp) * 0.06 * Math.min(1, 30 / b.mass + 0.2);
    b.applyImpulse(new CANNON.Vec3(dx / d * k + vel.x * 0.05 * b.mass, sp > 3 ? k * 0.3 : 0, dz / d * k + vel.z * 0.05 * b.mass));
  }
}
let physClean = 0;
function updatePhysics(dt) {
  if (phys.springs) for (const s of phys.springs) s.applyForce();
  phys.w.step(1 / 60, dt, 3);
  for (const b of phys.dyn) { b.obj.position.copy(b.position); b.obj.quaternion.copy(b.quaternion); }
  for (const L of phys.lines) {
    const a = L.l.geometry.attributes.position;
    const w = L.b.pointToWorldFrame(L.pv, new CANNON.Vec3());
    a.setXYZ(0, L.a.x, L.a.y, L.a.z); a.setXYZ(1, w.x, w.y, w.z); a.needsUpdate = true;
  }
  // buildings that turned to voxels lose their static stand-ins
  physClean -= dt;
  if (physClean <= 0) {
    physClean = 0.25;
    for (const [o, l] of phys.statics) if (o.struct || o.dead) { for (const b of l) phys.w.removeBody(b); phys.statics.delete(o); }
    for (const b of [...phys.dyn]) if (b.life && T - b.born > b.life) removeBody(b);
    // bowling strike
    const pins = phys.dyn.filter((b) => b.pin);
    if (pins.length && !phys.strike && pins.every((b) => Math.abs(new THREE.Euler().setFromQuaternion(b.obj.quaternion).x) > 0.8 || Math.abs(new THREE.Euler().setFromQuaternion(b.obj.quaternion).z) > 0.8)) { phys.strike = true; addChaos(300, 'STRIKE!'); }
  }
}

// ---- zip line -----------------------------------------------------------------------------------------
const zips = [];
function zipNear() { return zips.find((z) => P.pos.distanceTo(_a.copy(z.a).setY(z.a.y - 2.4)) < 2.5); }
function rideZip(dt) {
  const z = P.zip; z.t = Math.min(1, z.t + dt * (6 + z.t * 14) / z.a.distanceTo(z.b));
  P.pos.lerpVectors(z.a, z.b, z.t).setY(P.pos.y - 0); P.pos.y -= 2.3;
  goat.g.position.copy(P.pos); goat.g.rotation.y = Math.atan2(z.b.x - z.a.x, z.b.z - z.a.z);
  play(goat, 'jump', 0.1, 0.3);
  if (z.t >= 1) { P.zip = null; P.vel.set((z.b.x - z.a.x) * 0.2, 2, (z.b.z - z.a.z) * 0.2); addChaos(40, 'ZIP!'); }
}

// ---- cars -----------------------------------------------------------------------------------------------
function carSys() { return world.city.carSys; }
function nearestCar() {
  let best = null, bd = 3.6;
  for (const c of carSys().list) { if (c.state === 2 || c.gone) continue; const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
function pushOutOfCars(pos, r) {
  for (const c of carSys().list) {
    if (c.gone || c === P.inCar) continue;
    const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z;
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || pos.y > 1.5) continue;
    // in the car's frame (+x forward)
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const hx = c.len / 2 + r, hz = c.wid / 2 + r;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      if (hx - Math.abs(lx) < hz - Math.abs(lz)) { const nl = Math.sign(lx) * hx; pos.x = c.pos.x + nl * cs + lz * sn; pos.z = c.pos.z - nl * sn + lz * cs; }
      else { const nz = Math.sign(lz) * hz; pos.x = c.pos.x + lx * cs + nz * sn; pos.z = c.pos.z - lx * sn + nz * cs; }
    }
  }
}
function interact() {
  if (!started || !P.alive) return;
  if (P.inCar) { leaveCar(); return; }
  const z = zipNear(); if (z) { P.zip = { a: z.a, b: z.b, t: 0 }; return; }
  const car = nearestCar();
  if (car) { enterCar(car); return; }
  // otherwise a kick
  if (!P.kickT || P.kickT < T) { P.kickT = T + 0.55; melee({ dmg: 25, reach: 2.2, power: 80, knock: 9 }, null); }
}
function enterCar(car) {
  const CS = carSys();
  CS.moving = CS.moving.filter((c) => c !== car);
  if (car.lane) { const i = car.lane.cars.indexOf(car); if (i >= 0) car.lane.cars.splice(i, 1); car.lane = null; }
  car.moving = false; car.curve = null;
  if (!car.collider.cells) car.collider.cells = world.cellRange(car.collider.min.x, car.collider.min.z, car.collider.max.x, car.collider.max.z);
  car.speed = 0; car.vel = new V3(); car.pos.y = car.pos.y || 0;
  P.inCar = car;
  toast('Car stolen. <kbd>W</kbd>/<kbd>S</kbd> drive, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake, <kbd>E</kbd> get out', true);
  addChaos(50);
  // the driver gets thrown out
  const v = npcs.find((n) => !n.dead && n.g.position.distanceTo(car.pos) < 2);
  if (v) hurtNpc(v, 5, new V3(0, 3, 0), 'kick');
}
function leaveCar() {
  const car = P.inCar; P.inCar = null;
  const side = new V3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  P.pos.copy(car.pos).addScaledVector(side, car.wid / 2 + 0.9); P.pos.y = car.pos.y;
  P.vel.set(car.vel.x * 0.5, 2, car.vel.z * 0.5);
  car.speed = 0;
}
function drive(dt) {
  const car = P.inCar, CS = carSys();
  if (car.state === 2) { leaveCar(); return; }
  const top = 42, thr = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), steer = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const boost = keys.ShiftLeft || keys.ShiftRight;
  if (thr > 0) car.speed = Math.min(top * (boost ? 1.4 : 1), car.speed + 16 * thr * dt * (boost ? 1.5 : 1));
  else if (thr < 0) car.speed = Math.max(-14, car.speed + (car.speed > 0 ? 30 : 9) * thr * dt);
  else car.speed = damp(car.speed, 0, 0.7, dt);
  if (keys.Space) car.speed = damp(car.speed, 0, 3.5, dt);
  const sp = car.speed / top;
  car.yaw -= steer * (keys.Space ? 2.8 : 1.9) * clamp(Math.abs(sp) * 3, 0, 1) * Math.sign(car.speed || 1) * dt;
  const fx_ = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
  car.vel.x = fx_ * car.speed; car.vel.z = fz * car.speed;
  car.vel.y -= 25 * dt;
  const prevY = car.pos.y, ox = car.pos.x, oz = car.pos.z;
  // crash into buildings: knock a hole in them
  const dir = new V3(fx_ * Math.sign(car.speed || 1), 0, fz * Math.sign(car.speed || 1));
  if (Math.abs(car.speed) > 9) {
    const h = world.raycast(_a.set(car.pos.x, car.pos.y + 0.8, car.pos.z), dir, car.len / 2 + Math.abs(car.speed) * dt + 0.3, { targets: true });
    if (h) {
      const k = Math.abs(car.speed);
      if (h.target && h.target.kind === 'car') { world.damage(h.target, k * 1.5, h.point); world.city.damageCar(car, k * 0.8, h.point); }
      else if (h.target) world.damage(h.target, k * 3, h.point);
      D.bullet(h, { radius: 1.2 + k * 0.04, power: k * 22, dir, speed: k * 0.4, chunks: 8 });
      if (k > 20) { D.blast(h.point, 1 + k * 0.05, k * 14); world.damageRadius(h.point, 2 + k * 0.05, k * 2); }
      sound.crunch?.(h.point); fx.sparksBurst(h.point, h.normal, 14, 0xffc070, 12); shake = Math.max(shake, k / 60);
      car.speed *= 0.45; addChaos(Math.round(k * 2), 'CRASH');
      if (k > 30) world.city.damageCar(car, 6, h.point);
    }
  }
  car.pos.x += car.vel.x * dt; car.pos.z += car.vel.z * dt; car.pos.y += car.vel.y * dt;
  if (world.resolve(car.pos, 1.2, 1.4, Math.max(prevY, car.pos.y))) { if (Math.abs(car.speed) > 6) { sound.crunch?.(car.pos); fx.sparksBurst(car.pos, UP, 8, 0xffc070, 12); } car.speed *= 0.6; }
  const g = world.groundHeight(car.pos.x, car.pos.z, Math.max(prevY, car.pos.y), 0.9);
  if (car.pos.y <= g) { car.pos.y = g; car.vel.y = 0; }
  // other cars
  for (const c of CS.list) {
    if (c === car || c.gone) continue;
    const d = Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z);
    if (d < 3.2 && Math.abs(car.speed) > 2) {
      const k = Math.abs(car.speed);
      world.city.damageCar(c, k * 1.2, c.pos); if (k > 15) world.city.damageCar(car, k * 0.3, car.pos);
      sound.crunch?.(c.pos); car.speed *= -0.3; addChaos(Math.round(k * 3), 'SMASH');
      car.pos.x = ox; car.pos.z = oz; shake = Math.max(shake, k / 50);
      if (c.moving && c.state === 0) { c.state = 1; c.speed = 0; }
    }
  }
  // people
  for (const n of npcs) {
    if (n.gone || n.fly) continue;
    if (Math.hypot(n.g.position.x - car.pos.x, n.g.position.z - car.pos.z) < 2 + n.r && Math.abs(car.speed) > 4 && Math.abs(n.g.position.y - car.pos.y) < 2) {
      const v = car.vel.clone().multiplyScalar(0.9).setY(Math.abs(car.speed) * 0.35 + 3);
      hurtNpc(n, Math.abs(car.speed) * 4, v, 'blast', n.g.position.clone().setY(n.g.position.y + 1));
      launchNpc(n, v); addChaos(80, 'ROADKILL'); car.speed *= 0.92;
    }
  }
  pushBodies(car.pos, car.vel, 2.2, 1.6, 400);
  CS.bounds(car);
  car.collider.min.set(car.min.x, 0, car.min.z); car.collider.max.set(car.max.x, 1.8, car.max.z);
  world.moveCollider(car.collider);
  CS.place(car);
  P.pos.copy(car.pos);
  sound.setThrust?.(0.15 + Math.abs(sp) * 0.4, dt);
}

// ---- inventory (Diablo-style paper doll) ---------------------------------------------------------------
const ICONS = {};
function makeIcons() {
  const rt = new THREE.WebGLRenderTarget(128, 128);
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 3.6)); const dl = new THREE.DirectionalLight(0xffffff, 3.5); dl.position.set(2, 3, 4); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
  const px = new Uint8Array(128 * 128 * 4), cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g2 = cv.getContext('2d'), img = g2.createImageData(128, 128);
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  for (const w of Object.keys(WD)) {
    const m = weaponModel(w); const g = m.group;
    if (WD[w].kind === 'melee') g.rotation.z = -Math.PI / 4; else g.rotation.y = -Math.PI / 2 - 0.5;
    sc.add(g); g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new V3()), r = b.getSize(new V3()).length() / 2;
    cam.position.copy(c).add(new V3(0.35, 0.3, 1).normalize().multiplyScalar(r / Math.tan(15 * Math.PI / 180) * 1.05)); cam.lookAt(c);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, 128, 128, px);
    for (let y = 0; y < 128; y++) img.data.set(px.subarray((127 - y) * 512, (128 - y) * 512), y * 512);
    g2.clearRect(0, 0, 128, 128); g2.putImageData(img, 0, 0);
    ICONS[w] = cv.toDataURL();
    sc.remove(g);
  }
  // the goat portrait for the paper doll
  {
    const W = 336, H = 448, rt2 = new THREE.WebGLRenderTarget(W, H), px2 = new Uint8Array(W * H * 4);
    const parent = goat.g.parent, pos = goat.g.position.clone(), ry = goat.g.rotation.y;
    sc.add(goat.g); goat.g.position.set(0, 0, 0); goat.g.rotation.y = 0.35; goat.g.updateMatrixWorld(true);
    const c2 = new THREE.PerspectiveCamera(30, W / H, 0.1, 50); c2.position.set(0, 1.2, 6.6); c2.lookAt(0, 1.2, 0);
    renderer.setRenderTarget(rt2); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, c2);
    renderer.readRenderTargetPixels(rt2, 0, 0, W, H, px2);
    const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H; const g3 = cv2.getContext('2d'), im = g3.createImageData(W, H);
    for (let y = 0; y < H; y++) im.data.set(px2.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g3.putImageData(im, 0, 0); ICONS.__goat = cv2.toDataURL();
    parent.add(goat.g); goat.g.position.copy(pos); goat.g.rotation.y = ry; rt2.dispose();
  }
  renderer.setRenderTarget(null); renderer.toneMapping = tm; renderer.setClearColor(0x000000, 1);
}
let selItem = null;
function toggleInv() {
  if (!started) return;
  invOpen = !invOpen;
  $('#inv').style.display = invOpen ? 'flex' : 'none';
  if (invOpen) { document.exitPointerLock?.(); drawInv(); mouse.l = mouse.r = false; for (const k in keys) keys[k] = false; }
}
function itemHtml(it, where) { const d = WD[it.w]; return `<div class="item ${selItem === it ? 'sel' : ''}" draggable="true" data-id="${it.id}" data-where="${where}" title="${d.name}"><img src="${ICONS[it.w] || ''}"><span>${d.name}</span><u>${d.slots.map((x) => ({ hand: 'H', shoulder: 'S', leg: 'L', leftHand: 'LH' }[x])).join('·')}</u></div>`; }
function drawInv() {
  const slots = SLOTS.map((s) => {
    const it = INV.equip[s.id], ok = selItem && allowed(selItem.w, s);
    return `<div class="slot s-${s.id} ${ok ? 'ok' : ''}" data-slot="${s.id}"><b>${s.label}</b><em>${s.key}</em>${it ? itemHtml(it, s.id) : ''}</div>`;
  }).join('');
  $('#doll').innerHTML = `<img class="goatpic" src="${ICONS.__goat || ''}">` + slots;
  const cells = [];
  for (let i = 0; i < 40; i++) { const it = INV.bag[i]; cells.push(`<div class="cell" data-cell="${i}">${it ? itemHtml(it, 'bag') : ''}</div>`); }
  $('#bag').innerHTML = cells.join('');
  const it = selItem;
  $('#desc').innerHTML = it ? `<h3>${WD[it.w].name}</h3><p>${WD[it.w].desc}</p><p class="fits">Fits: ${WD[it.w].slots.map((s) => ({ hand: 'either hand', shoulder: 'shoulders', leg: 'legs', leftHand: 'left hand' }[s])).join(', ')}${WD[it.w].dmg ? ` · Damage ${WD[it.w].dmg}` : ''}${WD[it.w].splash ? ` · Blast ${WD[it.w].splash} m` : ''}</p><p class="tip">Click a glowing slot to equip. Right-click to auto-equip. Drag works too.</p>` : '<h3>Gear</h3><p>Click an item, then a glowing slot on the goat. Right-click an item to equip it in the first slot that fits; right-click gear on the goat to take it off.</p>';
}
function findItem(id) { id = +id; return INV.bag.find((x) => x.id === id) || Object.values(INV.equip).find((x) => x && x.id === id); }
function slotOf(it) { return Object.keys(INV.equip).find((k) => INV.equip[k] === it); }
function autoEquip(it) {
  const cur = slotOf(it);
  if (cur) { unequip(cur); return; }
  const free = SLOTS.find((s) => allowed(it.w, s) && !INV.equip[s.id]) || SLOTS.find((s) => allowed(it.w, s));
  if (free) equipTo(it, free.id);
}
function placeInSlot(it, slotId) {
  const s = SLOTS.find((x) => x.id === slotId);
  if (!allowed(it.w, s)) { toast(`${WD[it.w].name} doesn't fit the ${s.label.toLowerCase()}`); return; }
  const from = slotOf(it);
  if (from) { INV.equip[from] = null; unmount(it); const other = INV.equip[slotId]; if (other) { unmount(other); INV.equip[slotId] = null; if (allowed(other.w, SLOTS.find((x) => x.id === from))) { INV.equip[from] = other; mount(other); } else INV.bag.push(other); } INV.equip[slotId] = it; mount(it); }
  else equipTo(it, slotId);
}
function invClick(e, right) {
  const el = e.target.closest('.item'), slotEl = e.target.closest('.slot');
  if (right) { e.preventDefault(); if (el) { autoEquip(findItem(el.dataset.id)); selItem = null; drawInv(); } return; }
  if (selItem && slotEl) { placeInSlot(selItem, slotEl.dataset.slot); selItem = null; drawInv(); return; }
  if (selItem && e.target.closest('#bag')) { const from = slotOf(selItem); if (from) unequip(from); selItem = null; drawInv(); return; }
  if (el) { const it = findItem(el.dataset.id); selItem = selItem === it ? null : it; drawInv(); }
}
document.addEventListener('DOMContentLoaded', () => {});
const invEl = $('#inv');
invEl.addEventListener('click', (e) => invClick(e, false));
invEl.addEventListener('contextmenu', (e) => invClick(e, true));
invEl.addEventListener('dragstart', (e) => { const el = e.target.closest('.item'); if (el) { selItem = findItem(el.dataset.id); e.dataTransfer.setData('text', el.dataset.id); } });
invEl.addEventListener('dragover', (e) => e.preventDefault());
invEl.addEventListener('drop', (e) => { e.preventDefault(); const it = findItem(e.dataTransfer.getData('text')); if (!it) return; const s = e.target.closest('.slot'); if (s) placeInSlot(it, s.dataset.slot); else if (e.target.closest('#bag')) { const f = slotOf(it); if (f) unequip(f); } selItem = null; drawInv(); });
$('#invclose').addEventListener('click', (e) => { e.stopPropagation(); toggleInv(); });

// ---- main loop ------------------------------------------------------------------------------------------
let last = 0, fpsT = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  fpsT += dt; fpsN++; if (fpsT > 1) { $('#fps').textContent = `${fpsN} fps`; fpsT = 0; fpsN = 0; }
  if (!started || invOpen) { if (world && goat) { updateCamera(0); renderer.render(scene, camera); } return; }
  if (hitstop > 0) { hitstop -= dt; dt *= 0.08; }
  dt *= timeScale; T += dt;
  updatePlayer(dt);
  updateCamera(dt);
  placeWeapons();
  triggers(dt);
  updateShots(dt);
  updateFlames(dt);
  updateNpcs(dt);
  updatePhysics(dt);
  updateTracers(dt);
  updatePools(dt);
  for (const pk of pickups) if (!pk.taken) { pk.g.rotation.y += dt * 1.5; pk.g.children[0].position.y = Math.sin(T * 2 + pk.pos.x) * 0.12; }
  world.update(dt, P.inCar ? P.inCar.pos : P.pos, { grounded: false, vel: P.vel, feet: [], camera });
  blood.update(dt);
  fx.update(dt);
  // chaos from the town coming apart
  if (D.stats.collapses > (frame.col || 0)) { frame.col = D.stats.collapses; addChaos(1000); toast('<b>STRUCTURE DOWN!</b> +1000', true); shake = Math.max(shake, 0.9); sound.explosion?.(camera.position, 2.5); }
  const rem = D.stats.removed; if (rem > (frame.rem || 0)) { chaos += (rem - (frame.rem || 0)) * 0.5; frame.rem = rem; }
  hud(dt);
  renderer.render(scene, camera);
}

$('#go').addEventListener('click', () => {
  if (!world) return;
  $('#help').style.display = 'none';
  if (!started) { started = true; sound.unlock?.(); toast('Welcome to Goatsville. Break everything.', true); }
  canvas.requestPointerLock?.();
});
$('#bhelp')?.addEventListener('click', () => { $('#help').style.display = 'flex'; document.exitPointerLock?.(); });
$('#binv')?.addEventListener('click', () => toggleInv());
window.G3 = { snap(name = 'snap') { renderer.setSize(960, 540, false); camera.aspect = 960 / 540; camera.updateProjectionMatrix(); updateCamera(0); renderer.render(scene, camera); const u = canvas.toDataURL('image/jpeg', 0.7); resize(); return fetch('http://127.0.0.1:8399/' + name, { method: 'POST', body: u }).then(() => u.length); }, step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { last = performance.now() - dt * 1000; frame(performance.now()); } }, P, npcs, INV, WD, explode, equipTo, newItem, toggleInv, get world() { return world; }, get D() { return D; }, get phys() { return phys; }, TOWN, camera, renderer, scene, enterCar, nearestCar, interact, get chaos() { return chaos; }, get goat() { return goat; }, get started() { return started; }, keys, mouse, setCam(y, p, d) { camYaw = y; camPitch = p; if (d) camDist = d; } };
boot().catch((e) => { console.error(e); loadMsg('Failed to load: ' + e.message); });
