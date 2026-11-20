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
import { retargetAll } from './retarget.js';

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
  { id: 'leftHand', label: 'Left hand', type: 'hand', key: 'V' },
];
const S = (i) => SKINS[i];
const WD = {
  g_assaultrifle2_1: { name: 'Battle Rifle 1', kind: 'bullet', glb: 'assaultrifle2_1', len: 1.196, slots: ['hand'], ammo: 25, reload: 2, rate: 0.11, dmg: 21, spread: 0.012, power: 70, radius: 0.45, desc: 'Heavier rounds, more holes.' },
  g_assaultrifle2_2: { name: 'Battle Rifle 2', kind: 'bullet', glb: 'assaultrifle2_2', len: 1.196, slots: ['hand'], ammo: 25, reload: 2, rate: 0.11, dmg: 21, spread: 0.012, power: 70, radius: 0.45, desc: 'Heavier rounds, more holes.' },
  g_assaultrifle2_3: { name: 'Battle Rifle 3', kind: 'bullet', glb: 'assaultrifle2_3', len: 1.196, slots: ['hand'], ammo: 25, reload: 2, rate: 0.11, dmg: 21, spread: 0.012, power: 70, radius: 0.45, desc: 'Heavier rounds, more holes.' },
  g_assaultrifle2_4: { name: 'Battle Rifle 4', kind: 'bullet', glb: 'assaultrifle2_4', len: 1.196, slots: ['hand'], ammo: 25, reload: 2, rate: 0.11, dmg: 21, spread: 0.012, power: 70, radius: 0.45, desc: 'Heavier rounds, more holes.' },
  g_assaultrifle_1: { name: 'Assault Rifle 1', kind: 'bullet', glb: 'assaultrifle_1', len: 1.235, slots: ['hand'], ammo: 30, reload: 2, rate: 0.09, dmg: 16, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_assaultrifle_2: { name: 'Assault Rifle 2', kind: 'bullet', glb: 'assaultrifle_2', len: 1.235, slots: ['hand'], ammo: 30, reload: 2, rate: 0.09, dmg: 16, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_assaultrifle_3: { name: 'Assault Rifle 3', kind: 'bullet', glb: 'assaultrifle_3', len: 1.235, slots: ['hand'], ammo: 30, reload: 2, rate: 0.09, dmg: 16, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_assaultrifle_4: { name: 'Assault Rifle 4', kind: 'bullet', glb: 'assaultrifle_4', len: 1.235, slots: ['hand'], ammo: 30, reload: 2, rate: 0.09, dmg: 16, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_assaultrifle_5: { name: 'Assault Rifle 5', kind: 'bullet', glb: 'assaultrifle_5', len: 1.235, slots: ['hand'], ammo: 30, reload: 2, rate: 0.09, dmg: 16, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_bullpup_1: { name: 'Bullpup 1', kind: 'bullet', glb: 'bullpup_1', len: 0.962, slots: ['hand'], ammo: 30, reload: 1.9, rate: 0.08, dmg: 15, spread: 0.012, power: 50, radius: 0.4, desc: 'Compact and nasty.' },
  g_bullpup_2: { name: 'Bullpup 2', kind: 'bullet', glb: 'bullpup_2', len: 0.962, slots: ['hand'], ammo: 30, reload: 1.9, rate: 0.08, dmg: 15, spread: 0.012, power: 50, radius: 0.4, desc: 'Compact and nasty.' },
  g_bullpup_3: { name: 'Bullpup 3', kind: 'bullet', glb: 'bullpup_3', len: 0.962, slots: ['hand'], ammo: 30, reload: 1.9, rate: 0.08, dmg: 15, spread: 0.012, power: 50, radius: 0.4, desc: 'Compact and nasty.' },
  g_pistol_1: { name: 'Pistol 1', kind: 'bullet', glb: 'pistol_1', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_pistol_2: { name: 'Pistol 2', kind: 'bullet', glb: 'pistol_2', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_pistol_3: { name: 'Pistol 3', kind: 'bullet', glb: 'pistol_3', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_pistol_4: { name: 'Pistol 4', kind: 'bullet', glb: 'pistol_4', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_pistol_5: { name: 'Pistol 5', kind: 'bullet', glb: 'pistol_5', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_pistol_6: { name: 'Pistol 6', kind: 'bullet', glb: 'pistol_6', len: 0.273, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_revolver_1: { name: 'Revolver 1', kind: 'bullet', glb: 'revolver_1', len: 0.390, slots: ['hand'], ammo: 6, reload: 1.8, rate: 0.38, dmg: 60, spread: 0.005, power: 110, radius: 0.55, desc: 'Six big ones.' },
  g_revolver_2: { name: 'Revolver 2', kind: 'bullet', glb: 'revolver_2', len: 0.390, slots: ['hand'], ammo: 6, reload: 1.8, rate: 0.38, dmg: 60, spread: 0.005, power: 110, radius: 0.55, desc: 'Six big ones.' },
  g_revolver_3: { name: 'Revolver 3', kind: 'bullet', glb: 'revolver_3', len: 0.390, slots: ['hand'], ammo: 6, reload: 1.8, rate: 0.38, dmg: 60, spread: 0.005, power: 110, radius: 0.55, desc: 'Six big ones.' },
  g_revolver_4: { name: 'Revolver 4', kind: 'bullet', glb: 'revolver_4', len: 0.390, slots: ['hand'], ammo: 6, reload: 1.8, rate: 0.38, dmg: 60, spread: 0.005, power: 110, radius: 0.55, desc: 'Six big ones.' },
  g_revolver_5: { name: 'Revolver 5', kind: 'bullet', glb: 'revolver_5', len: 0.390, slots: ['hand'], ammo: 6, reload: 1.8, rate: 0.38, dmg: 60, spread: 0.005, power: 110, radius: 0.55, desc: 'Six big ones.' },
  g_shotgun_1: { name: 'Shotgun 1', kind: 'pellet', glb: 'shotgun_1', len: 1.365, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.75, dmg: 12, pellets: 10, spread: 0.065, power: 45, radius: 0.38, desc: 'Ten pellets. Point blank is best.' },
  g_shotgun_2: { name: 'Shotgun 2', kind: 'pellet', glb: 'shotgun_2', len: 1.365, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.75, dmg: 12, pellets: 10, spread: 0.065, power: 45, radius: 0.38, desc: 'Ten pellets. Point blank is best.' },
  g_shotgun_3: { name: 'Shotgun 3', kind: 'pellet', glb: 'shotgun_3', len: 1.365, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.75, dmg: 12, pellets: 10, spread: 0.065, power: 45, radius: 0.38, desc: 'Ten pellets. Point blank is best.' },
  g_shotgun_4: { name: 'Shotgun 4', kind: 'pellet', glb: 'shotgun_4', len: 1.365, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.75, dmg: 12, pellets: 10, spread: 0.065, power: 45, radius: 0.38, desc: 'Ten pellets. Point blank is best.' },
  g_shotgun_sawedoff: { name: 'Sawed-Off', kind: 'pellet', glb: 'shotgun_sawedoff', len: 0.715, slots: ['hand'], ammo: 2, reload: 1.6, rate: 0.3, dmg: 13, pellets: 14, spread: 0.1, power: 60, radius: 0.45, desc: 'Two barrels of rude.' },
  g_shotgun_shortstock: { name: 'Riot Shotgun', kind: 'pellet', glb: 'shotgun_shortstock', len: 1.066, slots: ['hand'], ammo: 8, reload: 2.4, rate: 0.55, dmg: 11, pellets: 9, spread: 0.06, power: 40, radius: 0.35, desc: 'Crowd control, goat style.' },
  g_sniperrifle_1: { name: 'Sniper Rifle 1', kind: 'rail', glb: 'sniperrifle_1', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_sniperrifle_2: { name: 'Sniper Rifle 2', kind: 'rail', glb: 'sniperrifle_2', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_sniperrifle_3: { name: 'Sniper Rifle 3', kind: 'rail', glb: 'sniperrifle_3', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_sniperrifle_4: { name: 'Sniper Rifle 4', kind: 'rail', glb: 'sniperrifle_4', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_sniperrifle_5: { name: 'Sniper Rifle 5', kind: 'rail', glb: 'sniperrifle_5', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_sniperrifle_6: { name: 'Sniper Rifle 6', kind: 'rail', glb: 'sniperrifle_6', len: 1.586, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_submachinegun_1: { name: 'SMG 1', kind: 'bullet', glb: 'submachinegun_1', len: 0.806, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.06, dmg: 11, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_submachinegun_2: { name: 'SMG 2', kind: 'bullet', glb: 'submachinegun_2', len: 0.806, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.06, dmg: 11, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_submachinegun_3: { name: 'SMG 3', kind: 'bullet', glb: 'submachinegun_3', len: 0.806, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.06, dmg: 11, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_submachinegun_4: { name: 'SMG 4', kind: 'bullet', glb: 'submachinegun_4', len: 0.806, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.06, dmg: 11, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_submachinegun_5: { name: 'SMG 5', kind: 'bullet', glb: 'submachinegun_5', len: 0.806, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.06, dmg: 11, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_ak47: { name: 'AK-47', kind: 'bullet', glb: 'ak47', len: 1.144, slots: ['hand'], ammo: 30, reload: 2, rate: 0.1, dmg: 18, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_c4: { name: 'C4', kind: 'grenade', glb: 'c4', len: 0.260, slots: ['hand'], ammo: 2, reload: 2.5, rate: 0.7, dmg: 170, splash: 7.5, speed: 16, power: 1000, desc: 'Brings buildings down.' },
  g_flaregun: { name: 'Flare Gun', kind: 'rocket', glb: 'flaregun', len: 0.312, slots: ['hand'], ammo: 1, reload: 1.4, rate: 0.5, dmg: 60, splash: 3, speed: 38, power: 160, fire: true, desc: 'Sets things alight from afar.' },
  g_fraggrenademodel: { name: 'Frag Grenades', kind: 'grenade', glb: 'fraggrenademodel', len: 0.156, slots: ['hand'], ammo: 3, reload: 1.5, rate: 0.5, dmg: 90, splash: 4.5, speed: 22, power: 380, desc: 'Pull, throw, duck.' },
  g_grease_gun: { name: 'Grease Gun', kind: 'bullet', glb: 'grease_gun', len: 0.988, slots: ['hand'], ammo: 32, reload: 1.6, rate: 0.09, dmg: 14, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  g_luger: { name: 'Luger', kind: 'bullet', glb: 'luger', len: 0.286, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.2, dmg: 26, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_m24grenade: { name: 'Stick Grenades', kind: 'grenade', glb: 'm24grenade', len: 0.468, slots: ['hand'], ammo: 3, reload: 1.8, rate: 0.6, dmg: 70, splash: 3.5, speed: 22, power: 260, cluster: 6, desc: 'Each one splits into six.' },
  g_m4a1: { name: 'M4A1', kind: 'bullet', glb: 'm4a1', len: 1.092, slots: ['hand'], ammo: 30, reload: 2, rate: 0.08, dmg: 15, spread: 0.014, power: 55, radius: 0.42, desc: 'Full auto, chews through walls.' },
  g_molotov_cocktail: { name: 'Molotovs', kind: 'grenade', glb: 'molotov_cocktail', len: 0.364, slots: ['hand'], ammo: 3, reload: 1.6, rate: 0.5, dmg: 50, splash: 4, speed: 20, power: 150, fire: true, desc: 'Bottled arson.' },
  g_nuclear_bomb: { name: 'Goat Nuke', kind: 'rocket', glb: 'nuclear_bomb', len: 1.950, slots: ['hand'], ammo: 1, reload: 6, rate: 2, dmg: 600, splash: 16, speed: 30, power: 2400, nuke: true, desc: 'One shot. Whole blocks come down.' },
  g_pipe_bomb: { name: 'Pipe Bombs', kind: 'grenade', glb: 'pipe_bomb', len: 0.338, slots: ['hand'], ammo: 2, reload: 2, rate: 0.6, dmg: 130, splash: 6, speed: 20, power: 650, desc: 'Walls hate it.' },
  g_makarov: { name: 'Makarov', kind: 'bullet', glb: 'makarov', len: 0.221, slots: ['hand'], ammo: 12, reload: 1.2, rate: 0.17, dmg: 22, spread: 0.008, power: 45, radius: 0.35, desc: 'Point and pop.' },
  g_shotgun: { name: 'Pump Shotgun', kind: 'pellet', glb: 'shotgun', len: 1.365, slots: ['hand'], ammo: 6, reload: 2.2, rate: 0.75, dmg: 12, pellets: 10, spread: 0.065, power: 45, radius: 0.38, desc: 'Ten pellets. Point blank is best.' },
  g_sniper: { name: 'Bolt Sniper', kind: 'rail', glb: 'sniper', len: 1.534, slots: ['hand'], ammo: 5, reload: 2.5, rate: 1.0, dmg: 170, power: 700, radius: 1.1, color: 0xfff2c8, desc: 'Straight through people and walls.' },
  g_suomi_kp: { name: 'Suomi KP', kind: 'bullet', glb: 'suomi_kp', len: 1.131, slots: ['hand'], ammo: 70, reload: 1.6, rate: 0.055, dmg: 10, spread: 0.028, power: 32, radius: 0.3, desc: 'Hose it.' },
  mp_combat_knife: { name: 'Combat Knife', kind: 'melee', file: 'mp_combat_knife', slots: ['hand'], dmg: 36, reach: 2.1, rate: 0.26, power: 30, sever: true, desc: 'Quick, quiet, messy.' },
  mp_crowbar: { name: 'Crowbar', kind: 'melee', file: 'mp_crowbar', slots: ['hand'], dmg: 48, reach: 2.4, rate: 0.5, power: 220, knock: 11, desc: 'Opens doors and skulls.' },
  mp_dagger: { name: 'Dagger', kind: 'melee', file: 'mp_dagger', slots: ['hand'], dmg: 34, reach: 2.1, rate: 0.26, power: 30, desc: 'Stab stab stab.' },
  mp_fireaxe: { name: 'Fire Axe', kind: 'melee', file: 'mp_fireaxe', slots: ['hand'], dmg: 78, reach: 2.6, rate: 0.75, power: 200, sever: 0.8, knock: 9, desc: 'Heeere comes the goat.' },
  mp_hammer: { name: 'Claw Hammer', kind: 'melee', file: 'mp_hammer', slots: ['hand'], dmg: 44, reach: 2.2, rate: 0.45, power: 160, knock: 9, desc: 'Every problem is a nail.' },
  mp_katana: { name: 'Katana', kind: 'melee', file: 'mp_katana', slots: ['hand'], dmg: 62, reach: 3.0, rate: 0.42, power: 70, sever: true, desc: 'Lops limbs clean off.' },
  mp_kitchenknife: { name: 'Kitchen Knife', kind: 'melee', file: 'mp_kitchenknife', slots: ['hand'], dmg: 32, reach: 2.0, rate: 0.24, power: 25, sever: true, desc: 'Dinner is served.' },
  mp_kunai: { name: 'Kunai', kind: 'melee', file: 'mp_kunai', slots: ['hand'], dmg: 30, reach: 2.0, rate: 0.22, power: 25, desc: 'Ninja goat.' },
  mp_machete: { name: 'Machete', kind: 'melee', file: 'mp_machete', slots: ['hand'], dmg: 55, reach: 2.5, rate: 0.4, power: 60, sever: true, desc: 'Clears jungles. And crowds.' },
  mp_medievalmace: { name: 'Flanged Mace', kind: 'melee', file: 'mp_medievalmace', slots: ['hand'], dmg: 64, reach: 2.5, rate: 0.6, power: 340, knock: 15, desc: 'Sends people flying.' },
  mp_medievalwarhammer: { name: 'Warhammer', kind: 'melee', file: 'mp_medievalwarhammer', slots: ['hand'], dmg: 80, reach: 2.7, rate: 0.8, power: 700, knock: 19, desc: 'Knocks holes in walls.' },
  mp_nailbat: { name: 'Nail Bat', kind: 'melee', file: 'mp_nailbat', slots: ['hand'], dmg: 58, reach: 2.6, rate: 0.55, power: 300, knock: 16, desc: 'Home run, every time.' },
  mp_policebaton: { name: 'Police Baton', kind: 'melee', file: 'mp_policebaton', slots: ['hand'], dmg: 36, reach: 2.3, rate: 0.35, power: 180, knock: 10, desc: 'Stolen from a cop. Ironic.' },
  mp_rustypipe: { name: 'Rusty Pipe', kind: 'melee', file: 'mp_rustypipe', slots: ['hand'], dmg: 46, reach: 2.6, rate: 0.5, power: 240, knock: 12, desc: 'Tetanus included.' },
  mp_sledgehammer: { name: 'Sledgehammer', kind: 'melee', file: 'mp_sledgehammer', slots: ['hand'], dmg: 92, reach: 2.8, rate: 0.9, power: 950, knock: 23, desc: 'Flattens people and walls alike.' },
  mp_spade: { name: 'Spade', kind: 'melee', file: 'mp_spade', slots: ['hand'], dmg: 52, reach: 3.0, rate: 0.6, power: 260, knock: 13, desc: 'Bonk. Then dig.' },
  mp_spear: { name: 'Spear', kind: 'melee', file: 'mp_spear', slots: ['hand'], dmg: 58, reach: 3.9, rate: 0.55, power: 80, sever: true, desc: 'Reach out and skewer someone.' },
  mp_tireiron: { name: 'Tire Iron', kind: 'melee', file: 'mp_tireiron', slots: ['hand'], dmg: 44, reach: 2.3, rate: 0.42, power: 200, knock: 10, desc: 'Roadside justice.' },
  mp_tomahawk: { name: 'Tomahawk', kind: 'melee', file: 'mp_tomahawk', slots: ['hand'], dmg: 56, reach: 2.3, rate: 0.45, power: 90, sever: true, desc: 'Chop chop.' },
  mp_tomahawk_modern: { name: 'Tactical Tomahawk', kind: 'melee', file: 'mp_tomahawk_modern', slots: ['hand'], dmg: 58, reach: 2.3, rate: 0.42, power: 90, sever: true, desc: 'Chop chop, but tactical.' },
  mp_twohandedaxe: { name: 'Great Axe', kind: 'melee', file: 'mp_twohandedaxe', slots: ['hand'], dmg: 95, reach: 2.9, rate: 0.9, power: 300, sever: 0.9, knock: 12, desc: 'Takes something off every swing.' },
  sword: { name: 'Iron Sword', kind: 'melee', file: 'iron_sword', slots: ['hand'], dmg: 45, reach: 2.6, rate: 0.5, power: 60, desc: 'The old faithful. Lops off limbs.' },
  greatsword: { name: 'Lionguard Greatsword', kind: 'melee', file: 'lionguard_sword', slots: ['hand'], dmg: 70, reach: 3, rate: 0.7, power: 90, desc: 'Big swing, bigger mess.' },
  emberfang: { name: 'Emberfang', kind: 'melee', file: 'emberfang_sword', slots: ['hand'], dmg: 50, reach: 2.6, rate: 0.5, power: 70, fire: true, desc: 'Sets whatever it cuts on fire.' },
  icevein: { name: 'Icevein Blade', kind: 'melee', file: 'icevein_sword', slots: ['hand'], dmg: 55, reach: 2.7, rate: 0.45, power: 60, desc: 'Cold, quick and very sharp.' },
  axe: { name: "Butcher's Axe", kind: 'melee', file: 'butcher_axe', slots: ['hand'], dmg: 80, reach: 2.4, rate: 0.8, power: 120, sever: 0.7, desc: 'Takes something off nearly every swing.' },
  dagger: { name: 'Crescent Dagger', kind: 'melee', file: 'crescent_dagger', slots: ['hand'], dmg: 34, reach: 2.1, rate: 0.26, power: 30, desc: 'Quick little stabs. Lots of them.' },
  hornDagger: { name: 'Horned Dagger', kind: 'melee', file: 'horned_dagger', slots: ['hand'], dmg: 36, reach: 2.1, rate: 0.27, power: 30, desc: 'Curved, cruel and fast.' },
  venomDagger: { name: 'Venom Dagger', kind: 'melee', file: 'venom_dagger', slots: ['hand'], dmg: 32, reach: 2.1, rate: 0.25, power: 30, sever: true, desc: 'Green edge. Takes fingers, and more.' },
  rubyDagger: { name: 'Rubyfang Dagger', kind: 'melee', file: 'rubyfang_dagger', slots: ['hand'], dmg: 38, reach: 2.1, rate: 0.28, power: 30, fire: true, desc: 'Red-hot. Cuts and cooks.' },
  duskSword: { name: 'Dusk Sword', kind: 'melee', file: 'dusk_sword', slots: ['hand'], dmg: 55, reach: 2.8, rate: 0.48, power: 60, sever: true, desc: 'A dark blade that lops limbs clean.' },
  moonSword: { name: 'Moonring Sword', kind: 'melee', file: 'moonring_sword', slots: ['hand'], dmg: 50, reach: 2.8, rate: 0.42, power: 60, sever: true, desc: 'Light and wicked fast.' },
  rimeSword: { name: 'Rimeshard Sword', kind: 'melee', file: 'rimeshard_sword', slots: ['hand'], dmg: 58, reach: 2.8, rate: 0.5, power: 70, sever: true, desc: 'Ice-blue edge. Very final.' },
  sunSword: { name: 'Sunguard Sword', kind: 'melee', file: 'sunguard_sword', slots: ['hand'], dmg: 60, reach: 2.8, rate: 0.52, power: 70, fire: true, desc: 'Burns as it bites.' },
  rootSword: { name: 'Wildroot Sword', kind: 'melee', file: 'wildroot_sword', slots: ['hand'], dmg: 54, reach: 2.8, rate: 0.48, power: 60, sever: true, desc: 'Grown, not forged. Still sharp.' },
  mace: { name: 'Bluewheel Mace', kind: 'melee', file: 'bluewheel_mace', slots: ['hand'], dmg: 62, reach: 2.4, rate: 0.6, power: 320, knock: 14, desc: 'Sends people flying.' },
  morningStar: { name: 'Great Morning Star', kind: 'melee', file: 'great_morning_star', slots: ['hand'], dmg: 78, reach: 2.7, rate: 0.75, power: 520, knock: 18, desc: 'Spikes. On a stick. Swung hard.' },
  maul: { name: 'Frostspire Maul', kind: 'melee', file: 'frostspire_maul', slots: ['hand'], dmg: 88, reach: 2.8, rate: 0.85, power: 760, knock: 21, desc: 'Flattens people and walls alike.' },
  spear: { name: 'Crimson Twist Spear', kind: 'melee', file: 'crimson_twist_spear', slots: ['hand'], dmg: 58, reach: 3.9, rate: 0.55, power: 80, sever: true, desc: 'Reach out and skewer someone.' },
  frostSpear: { name: 'Frost Spear', kind: 'melee', file: 'frost_spear', slots: ['hand'], dmg: 56, reach: 3.9, rate: 0.55, power: 80, desc: 'Long, cold, pointy.' },
  goldSpear: { name: 'Goldcross Spear', kind: 'melee', file: 'goldcross_spear', slots: ['hand'], dmg: 60, reach: 3.9, rate: 0.58, power: 90, sever: true, desc: 'A holy-looking way to be unholy.' },
  pike: { name: 'Red Pike', kind: 'melee', file: 'red_pike', slots: ['hand'], dmg: 64, reach: 4.4, rate: 0.7, power: 100, sever: true, desc: 'The longest reach in town.' },
  hammer: { name: 'War Hammer', kind: 'melee', file: 'war_hammer', slots: ['hand'], dmg: 90, reach: 2.6, rate: 0.9, power: 900, knock: 22, desc: 'Knocks holes in walls. And people.' },
  shield: { name: 'RX-S Shield', kind: 'shield', model: 'shield', skin: 0, slots: ['leftHand'], desc: 'Hold RMB to raise. Takes most of the hurt.' },
};
const PICKUP_POOL = ['g_assaultrifle2_1', 'g_assaultrifle2_2', 'g_assaultrifle2_3', 'g_assaultrifle2_4', 'g_assaultrifle_1', 'g_assaultrifle_2', 'g_assaultrifle_3', 'g_assaultrifle_4', 'g_assaultrifle_5', 'g_bullpup_1', 'g_bullpup_2', 'g_bullpup_3', 'g_pistol_1', 'g_pistol_2', 'g_pistol_3', 'g_pistol_4', 'g_pistol_5', 'g_pistol_6', 'g_revolver_1', 'g_revolver_2', 'g_revolver_3', 'g_revolver_4', 'g_revolver_5', 'g_shotgun_1', 'g_shotgun_2', 'g_shotgun_3', 'g_shotgun_4', 'g_shotgun_sawedoff', 'g_shotgun_shortstock', 'g_sniperrifle_1', 'g_sniperrifle_2', 'g_sniperrifle_3', 'g_sniperrifle_4', 'g_sniperrifle_5', 'g_sniperrifle_6', 'g_submachinegun_1', 'g_submachinegun_2', 'g_submachinegun_3', 'g_submachinegun_4', 'g_submachinegun_5', 'g_ak47', 'g_c4', 'g_flaregun', 'g_fraggrenademodel', 'g_grease_gun', 'g_luger', 'g_m24grenade', 'g_m4a1', 'g_molotov_cocktail', 'g_nuclear_bomb', 'g_pipe_bomb', 'g_makarov', 'g_shotgun', 'g_sniper', 'g_suomi_kp', 'shield'];
const allowed = (w, slot) => WD[w].slots.includes(slot.type) || WD[w].slots.includes(slot.id);
let uid = 1;
const INV = { bag: [], equip: { rightHand: null, leftHand: null } };
const newItem = (w) => ({ id: uid++, w, ammo: WD[w].ammo || 0, cool: 0, reloadT: 0, model: null });

const MELEE_SRC = {}, GUN_SRC = {}, GUN_MAN = {}, CAR_SRC = {};
let CAR_LIST = [];
// longest dimension of each model, in meters, by where it's carried (the goat-man is 2.4 m tall)
const HAND_LEN = { bazooka: 1.45, beamCannon: 1.5, machineGun: 1.15, shotgun: 1.0, grenade: 0.9, beamRifle: 1.1, vulcanPod: 1.0, shield: 1.05 };
const MOUNT_LEN = { shoulder: 0.34, leg: 0.32 };
function weaponModel(w, type = 'hand') {
  const d = WD[w];
  if (d.kind === 'melee') {
    const g = new THREE.Group();
    const src = MELEE_SRC[d.file];
    if (src) g.add(src.clone(true));
    else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.12), new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 })));
    return { group: g, muzzles: [], type };
  }
  if (d.glb) {
    const g = new THREE.Group(), src = GUN_SRC[d.glb];
    const inner = src ? src.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, d.len || 0.6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    g.add(inner);
    const mz = new THREE.Object3D(); mz.position.fromArray(GUN_MAN[d.glb]?.muzzle || [0, 0.05, d.len || 0.6]); inner.add(mz);
    return { group: g, muzzles: [mz], inner, type };
  }
  const m = buildWeaponModel(d.model, S(d.skin), mats);
  m.group.updateMatrixWorld(true);
  const sz = new THREE.Box3().setFromObject(m.group).getSize(new V3());
  const want = type === 'hand' ? (HAND_LEN[d.model] || 1.1) * (d.nuke ? 1.2 : 1) : MOUNT_LEN[type] * (d.model === 'heavyPod' ? 1.25 : 1);
  m.group.scale.setScalar(want / Math.max(sz.x, sz.y, sz.z));
  // mounts sit centered on their hardpoint (the models' origins are at the muzzle face)
  if (type !== 'hand') { m.group.updateMatrixWorld(true); m.group.position.sub(new THREE.Box3().setFromObject(m.group).getCenter(new V3())); }
  const wrap = new THREE.Group(); wrap.add(m.group);
  m.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: wrap, muzzles: m.muzzles || [], spin: m.spin, inner: m.group, type };
}

// ---- input --------------------------------------------------------------------------------------
// On foot: WASD move (camera-relative), Shift sprint, Space jump/flip, RMB aim, LMB shoot, Q/MMB mounts,
// E headbutt, V melee, C (hold) lick-grab, R ragdoll, F get in/out of cars, B jetpack.
const keys = {}, mouse = { l: false, r: false, m: false };
let camYaw = Math.PI, camPitch = -0.12, camDist = 5.2, started = false, invOpen = false, lastMouse = -9;
addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'KeyI') { e.preventDefault(); toggleInv(); return; }
  if (invOpen) { if (e.code === 'Escape') toggleInv(); return; }
  if (['Space', 'KeyF', 'KeyQ', 'KeyE', 'KeyR', 'KeyV', 'KeyC', 'F1', 'AltLeft'].includes(e.code)) e.preventDefault();
  const first = !keys[e.code];
  keys[e.code] = true;
  if (!first || !started) return;
  if (e.code === 'Space' && !P.inCar) jump();
  if (e.code === 'KeyF' || e.code === 'Enter') interact();
  if (e.code === 'KeyE') headbutt();
  if (e.code === 'KeyV') quickMelee();
  if (e.code === 'KeyR') toggleRagdoll();
  if (e.code === 'KeyG') { timeScale = timeScale === 1 ? 0.3 : 1; $('#slow').style.display = timeScale < 1 ? 'block' : 'none'; }
  if (e.code === 'KeyH' || e.code === 'F1') { $('#help').style.display = $('#help').style.display === 'none' ? 'flex' : 'none'; if ($('#help').style.display !== 'none') document.exitPointerLock?.(); }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = mouse.m = false; });
canvas.addEventListener('mousedown', (e) => {
  if (!started || invOpen) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.()?.catch?.(() => {}); }
  if (e.button === 0) mouse.l = true;
  if (e.button === 1) { mouse.m = true; e.preventDefault(); }
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 1) mouse.m = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const k = mouse.r && !P.inCar ? 0.6 : 1;
  camYaw -= e.movementX * 0.0022 * k;
  camPitch = clamp(camPitch - e.movementY * 0.002 * k, -1.15, 0.6);
  lastMouse = T;
});
addEventListener('wheel', (e) => { if (!invOpen) camDist = clamp(camDist + Math.sign(e.deltaY) * 0.7, 2.6, 14); });

// ---- HUD ----------------------------------------------------------------------------------------
const sfx = {
  whoosh(p, k = 1) { sound.noiseHit?.({ type: 'bandpass', freq: 420, freqEnd: 2600 * k, q: 1.4, peak: 0.3, attack: 0.03, decay: 0.14 + 0.1 / k, pos: p }); },
  bleat(p) { sound.voice?.({ pitch: [430, 560, 340], vowel: [[760, 4, 1], [1250, 5, 0.55], [2700, 6, 0.25]], dur: 0.42, vib: 0.12, vibRate: 15, rasp: 0.25, peak: 0.2, pos: p }); },
  slap(p) { sound.noiseHit?.({ type: 'lowpass', freq: 1500, q: 0.8, peak: 0.55, decay: 0.12, pos: p }); },
};
function toast(t, big) {
  const d = document.createElement('div'); d.innerHTML = t; if (big) d.className = 'big';
  $('#feed').prepend(d); setTimeout(() => { d.style.opacity = 0; }, 2600); setTimeout(() => d.remove(), 3300);
  while ($('#feed').children.length > 6) $('#feed').lastChild.remove();
}
// chaos combo: scoring within 3.5 s of the last score raises the multiplier
let combo = 1, comboT = 0;
function addChaos(n, label) {
  if (n >= 20) { if (comboT > 0) combo = Math.min(10, combo + 1); comboT = 3.5; }
  const v = Math.round(n * combo);
  chaos += v;
  if (label) toast(`${label} <b>+${v}</b>${combo > 1 ? ` <i>×${combo}</i>` : ''}`);
}
let hudT = 0;
function hud(dt) {
  drawMap();
  hudT -= dt; if (hudT > 0) return; hudT = 0.1;
  $('#hpbar').style.width = `${(100 * P.hp) / P.maxHp}%`;
  $('#jetbar').style.width = `${P.jet}%`;
  $('#pts').textContent = Math.floor(chaos).toLocaleString();
  $('#combo').textContent = combo > 1 ? `×${combo} COMBO` : '';
  $('#combo').style.opacity = combo > 1 ? 0.4 + 0.6 * Math.min(1, comboT / 3.5) : 0;
  $('#wanted').innerHTML = WANT.level > 0 ? `<span class="${WANT.seen ? 'hot' : ''}">${'🚨'.repeat(WANT.level)}</span><i>${'·'.repeat(5 - WANT.level)}</i>` : '';
  $('#kills').textContent = `${kills} down · ${D ? D.stats.removed.toLocaleString() : 0} chunks of town`;
  let near = '', bd = 1e9;
  for (const b of TOWN.names) { const d = Math.hypot(b.x - P.pos.x, b.z - P.pos.z); if (d < bd) { bd = d; near = b.name; } }
  for (const p of TOWN.parks) if (P.pos.x > p.x0 && P.pos.x < p.x1 && P.pos.z > p.z0 && P.pos.z < p.z1) { near = p.name; bd = 0; }
  $('#where').textContent = bd < 40 ? near : 'Goatsville';
  $('#slots').innerHTML = SLOTS.map((s) => {
    const it = INV.equip[s.id]; if (!it) return '';
    const d = WD[it.w];
    const am = d.kind === 'melee' || d.kind === 'shield' ? '' : it.reloadT > 0 ? '<i>RELOAD</i>' : `<i>${it.ammo}</i>`;
    return `<div class="sl"><kbd>${s.key}</kbd> ${d.name} ${am}</div>`;
  }).join('');
  $('#speed').style.display = P.inCar ? 'block' : 'none';
  if (P.inCar) $('#speed').textContent = `${Math.round(Math.abs(P.inCar.speed || 0) * 3.6)} km/h`;
  $('#cross').className = mouse.r && !P.inCar ? 'aim' : '';
  const nc = !P.inCar && !P.rag && nearestCar();
  $('#prompt').innerHTML = P.inCar ? '' : P.rag ? '<kbd>R</kbd> get up' : nc ? `<kbd>F</kbd> ${nc.lane || nc.driver ? 'jack' : 'steal'} car` : zipNear() ? '<kbd>F</kbd> zip line' : '';
}

// ---- boot -----------------------------------------------------------------------------------------
/** a melee model, turned about its grip so the blade's width (its edges, or an axe's head) runs along +Z */
function edgeAlign(s) {
  const turn = new THREE.Group(); turn.add(s); turn.updateMatrixWorld(true);
  const sz = new THREE.Box3().setFromObject(turn).getSize(new V3());
  if (sz.x > sz.z) turn.rotation.y = Math.PI / 2;
  const w = new THREE.Group(); w.add(turn); return w;
}
async function boot() {
  setBase('vc/');
  loadMsg('loading textures...');
  const tex = await loadTextures(renderer, (p) => loadMsg(`loading textures ${Math.round(p * 100)}%`));
  loadMsg('loading weapons...');
  await loadGuns('vc/assets/scifi-guns/');
  const gl = new GLTFLoader();
  const MAN = await fetch('assets/models.json').then((r) => r.json());
  Object.assign(GUN_MAN, MAN.guns); CAR_LIST = MAN.cars;
  await Promise.all([
    ...Object.keys(MAN.guns).map((k) => gl.loadAsync(`assets/guns/${k}.glb`).then((g) => { g.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; }); GUN_SRC[k] = g.scene; }).catch((e) => console.warn('gun', k, e))),
    ...MAN.cars.map((c) => gl.loadAsync(`assets/cars/${c.f}.glb`).then((g) => { CAR_SRC[c.f] = g.scene; }).catch((e) => console.warn('car', c.f, e))),
  ]);
  const KIT = [...MAN.melee.map((k) => 'mp_' + k), 'crescent_dagger', 'horned_dagger', 'venom_dagger', 'rubyfang_dagger', 'dusk_sword', 'moonring_sword', 'rimeshard_sword', 'sunguard_sword', 'wildroot_sword', 'bluewheel_mace', 'great_morning_star', 'frostspire_maul', 'crimson_twist_spear', 'frost_spear', 'goldcross_spear', 'red_pike'];
  await Promise.all(KIT.map((f) => gl.loadAsync(`assets/melee/${f}.glb`).then((g) => {
    // bm's hero kit: real scale, blade up +Y, grip at the origin. The goat-man is 2.4 m, so a third bigger.
    const s = g.scene; s.scale.setScalar(1.3);
    s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    MELEE_SRC[f] = edgeAlign(s);
  }).catch((e) => console.warn('melee', f, e))));
  await Promise.all(['iron_sword', 'lionguard_sword', 'emberfang_sword', 'icevein_sword', 'butcher_axe', 'war_hammer'].map((f) => gl.loadAsync(`assets/melee/${f}.glb`).then((g) => {
    const s = g.scene; const b = new THREE.Box3().setFromObject(s), sz = b.getSize(new V3());
    const k = 1.25 / Math.max(sz.x, sz.y, sz.z); s.scale.setScalar(k);
    // grip at the origin, blade up +Y
    const long = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.y >= sz.z ? 'y' : 'z';
    if (long === 'x') s.rotation.z = Math.PI / 2; if (long === 'z') s.rotation.x = Math.PI / 2;
    if (f === 'iron_sword') s.rotation.x += Math.PI; // modeled tip-down
    s.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(s); s.position.y -= b2.min.y + (b2.max.y - b2.min.y) * 0.12;
    s.position.x -= (b2.min.x + b2.max.x) / 2; s.position.z -= (b2.min.z + b2.max.z) / 2;
    s.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    MELEE_SRC[f] = edgeAlign(s);
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
  setupCars();
  spawnPickups();
  // starting kit
  // the goat starts with nothing: every weapon is out there in town, glowing (blades by the start)
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
const ANIMS = { idle: [/^idle$/, /Idle_Loop/, /idle/i], walk: [/^walk$/, /Walk_Fwd/, /walk/i], run: [/^run$/, /^run\d?$/, /flee/, /walk_shamble/, /walk/i], atk: [/^atk1$/, /^atk\d$/, /Scratch/, /kick/, /throw/], atk2: [/^atk2$/, /^atk3$/, /^atk\d$/, /Scratch/, /kick/], hit: [/^hit$/, /Hit_Chest/, /^hit/i], death: [/^death$/, /Death01/, /death/i, /fall/], jump: [/^jump$/, /jump/i], roar: [/^roar$/, /angry/, /Scratch/], flee: [/^flee$/, /^run$/, /scared/], scared: [/^scared$/, /afraid/, /frightened/], wave: [/^wave$/, /greet/], dance: [/dance_\d/], cheer: [/cheer/, /clap/], sit: [/^sit_idle$/, /^sit$/], getup: [/get_up/], angry: [/^angry$/] };
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
  if (A === goat && (k === 'idle' || k === 'walk' || k === 'run') && armedMelee() && A.acts[k + 'A']) k += 'A'; // sword-ready stance
  const a = A.acts[k]; if (!a) return;
  a.timeScale = speed;
  if (A.cur === a && a.isRunning() && a.loop !== THREE.LoopOnce) return;
  a.reset().fadeIn(fade).play();
  if (A.cur && A.cur !== a) A.cur.fadeOut(fade);
  A.cur = a;
}
const VLIST = [
  ['idle', 'axe_unarmed_idle'], ['walk', 'axe_unarmed_walk_forward'], ['run', 'axe_unarmed_run_forward'],
  ['jump', 'sword_and_shield_jump', 0.17], ['hit', 'sword_and_shield_impact'], ['death', 'sword_and_shield_death'], ['atk', 'standing_melee_attack_kick_ver_2'],
  ['idleA', 'sword_and_shield_idle'], ['walkA', 'sword_and_shield_walk'], ['runA', 'sword_and_shield_run'],
  ['sw_slash', 'sword_and_shield_slash'], ['sw_back', 'axe_standing_melee_attack_backhand'], ['sw_down', 'standing_melee_attack_downward'],
  ['sw_cleave', 'great_sword_slash'], ['sw_flat', 'axe_standing_melee_attack_horizontal'], ['sw_stab', 'stabbing'], ['sw_lunge', 'sword_and_shield_attack'],
];
const SW = {};
// each weapon class swings a three-hit chain: two cuts and a finisher
const SWINGS = { blade: ['sw_slash', 'sw_back', 'sw_down'], heavy: ['sw_cleave', 'sw_flat', 'sw_down'], spear: ['sw_stab', 'sw_stab', 'sw_lunge'] };
/** play the strike out of one of the hero's attack clips, squeezed into dur seconds, the hit at its middle */
function swingAnim(name, dur) {
  const s = SW[name]; if (!s || !goat) return;
  const from = Math.max(0, s.peak - 0.42), to = Math.min(s.dur, s.peak + 0.34), a = s.act;
  a.reset(); a.time = from; a.timeScale = (to - from) / dur; a.setEffectiveWeight(1); a.fadeIn(0.05).play();
  if (goat.cur && goat.cur !== a) goat.cur.fadeOut(0.08);
  goat.cur = a; P.animLock = T + dur;
}
const armedMelee = () => [INV.equip.rightHand, INV.equip.leftHand].some((it) => it && WD[it.w].kind === 'melee');
async function loadPlayer(gl) {
  const [g, va] = await Promise.all([gl.loadAsync('assets/monsters/goatman_gold_good.glb'), gl.loadAsync('assets/anims/vesper.glb')]);
  const m = setupModel(g.scene, 2.4);
  const R = retargetAll(va.scene, va.animations, m.root, VLIST);
  if (R.missing.length) console.info('goat bones with no vesper match:', R.missing.join(', '));
  // a pivot at the hips so the goat can flip and tumble around his middle
  const pivot = new THREE.Group(); pivot.position.y = 1.15;
  m.g.remove(m.root); pivot.add(m.root); m.root.position.y -= 1.15; m.g.add(pivot);
  const clips = Object.values(R.clips);
  goat = { ...m, pivot, ...makeActor(m, clips), clips };
  for (const k of ['idleA', 'walkA', 'runA']) if (R.clips[k]) goat.acts[k] = goat.mixer.clipAction(R.clips[k]);
  for (const k of Object.keys(R.clips)) if (k.startsWith('sw_') || k === 'atk') {
    const a = goat.mixer.clipAction(R.clips[k]); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    SW[k] = { act: a, peak: R.peaks[k], dur: R.clips[k].duration };
  }
  scene.add(goat.g);
  play(goat, 'idle');
  P.pos.copy(TOWN.spawn);
}

// ---- moving like a goat -----------------------------------------------------------------------------
const MOVE = { walk: 2.6, jog: 7.2, sprint: 13.5, aim: 4.2, accel: 48, air: 14, jump: 10.5, grav: 26 };
function jump() {
  if (!P.alive || P.zip || P.rag) return;
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && Math.hypot(P.vel.x, P.vel.z) > 9;
  if (P.grounded || P.coyote > 0) {
    P.vel.y = MOVE.jump + (sprint ? 1.5 : 0); P.grounded = false; P.coyote = 0; P.jumps = 1;
    play(goat, 'jump', 0.08, 1.3); sound.thump?.(P.pos);
  } else if (P.jumps < 2) {
    P.vel.y = MOVE.jump * 0.95; P.jumps = 2; P.flip = 0.0001; // second jump is a front flip
    sfx.bleat(P.pos);
  }
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
    if (P.rag) updateRagdoll(dt, true);
    if (P.deadT <= 0) {
      if (P.rag) endRagdoll();
      P.alive = true; P.hp = P.maxHp; P.pos.copy(TOWN.spawn); P.vel.set(0, 0, 0); play(goat, 'idle');
      WANT.heat = 0; WANT.level = 0; $('#down').style.display = 'none'; timeScale = 1;
      toast('Back on your hooves. The cops lost interest.', true);
    }
    goat.mixer.update(dt);
    return;
  }
  if (P.inCar) { drivePlayer(dt); goat.g.visible = false; return; }
  goat.g.visible = true;
  if (P.jack) { jackStep(dt); goat.mixer.update(dt); poseArms(dt); return; }
  if (P.rag) { updateRagdoll(dt); return; }
  if (P.zip) { rideZip(dt); goat.mixer.update(dt); return; }
  const aiming = mouse.r;
  const fwd = _a.set(Math.sin(camYaw), 0, Math.cos(camYaw)), right = _b.set(-Math.cos(camYaw), 0, Math.sin(camYaw));
  const mv = new V3();
  if (keys.KeyW) mv.add(fwd); if (keys.KeyS) mv.sub(fwd); if (keys.KeyD) mv.add(right); if (keys.KeyA) mv.sub(right);
  const moving = mv.lengthSq() > 0;
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && !aiming;
  const sp = aiming ? MOVE.aim : sprint ? MOVE.sprint : keys.AltLeft ? MOVE.walk : MOVE.jog;
  if (moving) mv.normalize().multiplyScalar(sp);
  // snappy on the ground, keeps its momentum in the air
  if (P.grounded || moving) {
    const acc = (P.grounded ? MOVE.accel : MOVE.air) * dt, dx = mv.x - P.vel.x, dz = mv.z - P.vel.z, dl = Math.hypot(dx, dz);
    if (dl <= acc) { P.vel.x = mv.x; P.vel.z = mv.z; } else { P.vel.x += (dx / dl) * acc; P.vel.z += (dz / dl) * acc; }
  }
  // jetpack
  if (keys.KeyB && P.jet > 0) {
    P.vel.y = Math.min(P.vel.y + 34 * dt, 10); P.jet = Math.max(0, P.jet - 26 * dt); P.grounded = false;
    if (Math.random() < 0.8) { const b = goat.bones.Spine1 || goat.bones.Hips; b.getWorldPosition(_c); _c.x -= Math.sin(P.yaw) * 0.4; _c.z -= Math.cos(P.yaw) * 0.4; fx.fire.emit(_c.x, _c.y, _c.z, rnd(-1, 1), -8, rnd(-1, 1), 0.3, 0.5, 0.1, 1, 0.6, 0.2, 1, 1, 0.2, 0, 0); }
  } else if (P.grounded) P.jet = Math.min(100, P.jet + 20 * dt);
  P.vel.y -= MOVE.grav * dt;
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
  const wasAir = !P.grounded;
  if (P.pos.y <= g) {
    const tr = TOWN.bounce.find((b) => Math.hypot(P.pos.x - b.x, P.pos.z - b.z) < b.r && Math.abs(g - b.y) < 0.3);
    if (tr && P.vel.y < -2) { P.vel.y = Math.min(26, -P.vel.y * 1.08 + 4); P.pos.y = g; sound.thump?.(P.pos); addChaos(10, 'BOING'); }
    else if (P.vel.y < -19) { // big fall: the goat goes floppy (and survives)
      P.pos.y = g; hurtPlayer((-P.vel.y - 19) * 3, null, 'fall');
      if (P.alive) startRagdoll(new V3(P.vel.x, -P.vel.y * 0.25, P.vel.z));
      return;
    } else {
      if (wasAir) landed();
      P.pos.y = g; P.vel.y = 0; P.grounded = true; P.jumps = 0; P.coyote = 0.12;
    }
  } else if (P.pos.y > g + 0.25) { if (P.grounded) P.coyote = 0.12; P.grounded = false; }
  P.coyote = Math.max(0, (P.coyote || 0) - dt);
  if (!P.grounded) P.airT = (P.airT || 0) + dt;
  if (slideR && P.grounded) { const dir = Math.sign(slideR.loX - slideR.hiX); P.vel.x += dir * 18 * dt; P.slideT = 0.2; }
  if (P.onBody) { // ride whatever we stand on (merry-go-round)
    const b = P.onBody, rx = P.pos.x - b.position.x, rz = P.pos.z - b.position.z;
    P.pos.x += (b.velocity.x + b.angularVelocity.y * rz) * dt; P.pos.z += (b.velocity.z - b.angularVelocity.y * rx) * dt;
  }
  if (P.pos.y < -20) { P.pos.copy(TOWN.spawn); P.vel.set(0, 0, 0); }
  // facing: where you're going, or where you aim
  const flat = Math.hypot(P.vel.x, P.vel.z);
  P.fireFace -= dt;
  let want = P.yaw;
  if (aiming || P.fireFace > 0 || P.lick) want = camYaw;
  else if (moving) want = Math.atan2(mv.x, mv.z);
  let dy = want - P.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  P.yaw += dy * Math.min(1, dt * (aiming ? 25 : 16));
  goat.g.position.copy(P.pos); goat.g.rotation.y = P.yaw;
  // front flip on the double jump, lean into turns when running
  if (P.flip) { P.flip += dt / 0.55; goat.pivot.rotation.x = Math.min(1, P.flip) * Math.PI * 2; if (P.flip >= 1) { P.flip = 0; goat.pivot.rotation.x = 0; addChaos(60, 'FRONT FLIP'); } }
  goat.pivot.rotation.z = damp(goat.pivot.rotation.z, P.grounded ? clamp(-dy * 0.6, -0.25, 0.25) * clamp(flat / 10, 0, 1) : 0, 8, dt);
  // animation
  if (!P.attackT || P.attackT < T) {
    if (T < (P.animLock || 0)) { /* a swing is playing out */ }
    else if (!P.grounded && (P.vel.y > 0 || P.airT > 0.35)) { if (goat.cur !== goat.acts.jump) play(goat, 'jump', 0.15, 0.9); }
    else if (P.slideT > 0) play(goat, 'idle');
    else if (flat > 5.5) play(goat, 'run', 0.15, clamp(flat / 8, 0.8, 1.6));
    else if (flat > 0.5) play(goat, 'walk', 0.15, clamp(flat / 2.4, 0.7, 2.2));
    else if (P.grounded) play(goat, 'idle', 0.25);
  }
  P.slideT = (P.slideT || 0) - dt;
  goat.mixer.update(dt);
  poseArms(dt);
  pushBodies(P.pos, P.vel, P.r + 0.2, P.h, 90);
  P.hp = Math.min(P.maxHp, P.hp + dt * 5);
  for (const pk of pickups) {
    if (pk.taken || Math.abs(pk.pos.y - P.pos.y) > 2 || Math.hypot(pk.pos.x - P.pos.x, pk.pos.z - P.pos.z) > 1.8) continue;
    takePickup(pk);
  }
}
function landed() {
  if (P.airT > 1.3) addChaos(Math.round(P.airT * 35), 'AIR TIME');
  P.airT = 0;
  if (P.vel.y < -10) { sound.thump?.(P.pos); fx.dust?.(P.pos, 0.6); }
}

// arms point the guns at the crosshair while aiming or shooting (two-handed hold for a lone gun)
const IDQ = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _yb = new V3(0, 1, 0);
function pointBone(b, dir, k) {
  b.getWorldQuaternion(_qa);
  const cur = _c.set(0, 1, 0).applyQuaternion(_qa);
  _qb.setFromUnitVectors(cur, dir);
  if (k < 1) _qb.slerp(IDQ, 1 - k);
  _qa.premultiply(_qb);
  b.parent.getWorldQuaternion(_qc).invert();
  b.quaternion.copy(_qc.multiply(_qa));
  b.updateMatrixWorld(true);
}
function aimArm(A, side, target, k) {
  const arm = A.bones[side + 'Arm'], fore = A.bones[side + 'ForeArm'], hand = A.bones[side + 'Hand'];
  if (!arm || !fore || !hand) return;
  const sh = arm.getWorldPosition(new V3()), dir = target.clone().sub(sh).normalize();
  pointBone(arm, dir, k); pointBone(fore, dir, k); pointBone(hand, dir, k);
}
const isGun = (it) => it && !['melee', 'shield'].includes(WD[it.w].kind);
const _ikA = new V3(), _ikB = new V3(), _ikC = new V3();
/** two-bone IK: the side's wrist to T, the elbow bent toward the pole direction */
function ik2(A, side, T, pole, k) {
  const arm = A.bones[side + 'Arm'], fore = A.bones[side + 'ForeArm'], hand = A.bones[side + 'Hand'];
  if (!arm || !fore || !hand || k < 0.01) return;
  const S = arm.getWorldPosition(_ikA), E = fore.getWorldPosition(_ikB), H = hand.getWorldPosition(_ikC);
  const l1 = S.distanceTo(E), l2 = E.distanceTo(H);
  const dir = T.clone().sub(S); let d = dir.length(); dir.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const n = pole.clone().addScaledVector(dir, -pole.dot(dir)); if (n.lengthSq() < 1e-6) n.set(0, -1, 0); n.normalize();
  const S0 = S.clone();
  pointBone(arm, dir.clone().multiplyScalar(Math.cos(a)).addScaledVector(n, Math.sin(a)), k);
  const E2 = fore.getWorldPosition(new V3());
  pointBone(fore, S0.addScaledVector(dir, d).sub(E2).normalize(), k);
}
/** turn a bone so the world direction `cur` (as it is now) points along `want` */
function turnBone(b, cur, want, k) {
  _qb.setFromUnitVectors(cur, want); if (k < 1) _qb.slerp(IDQ, 1 - k);
  b.getWorldQuaternion(_qa); _qa.premultiply(_qb);
  b.parent.getWorldQuaternion(_qc).invert(); b.quaternion.copy(_qc.multiply(_qa)); b.updateMatrixWorld(true);
}
const goatAxes = () => { const y = P.yaw; return { f: new V3(Math.sin(y), 0, Math.cos(y)), r: new V3(-Math.cos(y), 0, Math.sin(y)) }; };
/** guns: trigger hand under the cheek with the elbow dropped, the other hand on the foregrip */
function aimArms(dt) {
  const R = INV.equip.rightHand, L = INV.equip.leftHand;
  const want = (mouse.r || P.fireFace > 0) && (isGun(R) || isGun(L)) && !P.swing ? 1 : 0;
  P.aimK = damp(P.aimK || 0, want, 14, dt);
  if (P.aimK < 0.02) return;
  goat.g.updateMatrixWorld(true);
  const { r } = goatAxes(), B = goat.bones, down = new V3(0, -1, 0);
  const main = isGun(R) ? 'Right' : 'Left', s = main === 'Right' ? 1 : -1, other = main === 'Right' ? 'Left' : 'Right';
  const S = B[main + 'Arm'].getWorldPosition(new V3()), dir = AIM.point.clone().sub(S).normalize();
  ik2(goat, main, S.clone().addScaledVector(dir, 0.4).addScaledVector(r, -0.13 * s).addScaledVector(UP, -0.05), down.clone().addScaledVector(r, 0.6 * s), P.aimK);
  const oit = other === 'Right' ? R : L;
  if (isGun(oit)) { const S2 = B[other + 'Arm'].getWorldPosition(new V3()); ik2(goat, other, S2.clone().addScaledVector(AIM.point.clone().sub(S2).normalize(), 0.42), down.clone().addScaledVector(r, -0.6 * s), P.aimK); }
  else if (!oit) {
    const gun = main === 'Right' ? R : L, reach = (WD[gun.w].len || 1.1) * 0.4;
    ik2(goat, other, B[main + 'Hand'].getWorldPosition(new V3()).addScaledVector(dir, reach).addScaledVector(UP, -0.04), down.clone().addScaledVector(r, -0.7 * s), P.aimK * 0.95);
  }
}
const meleeClass = (d) => (d.reach > 3.5 ? 'spear' : d.knock || d.file === 'butcher_axe' ? 'heavy' : 'blade');
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
/** where a melee hand goes and where its blade points: carry poses, and the swing arcs */
function meleePose(side, it, dt) {
  const d = WD[it.w], s = side === 'Right' ? 1 : -1, cls = meleeClass(d), B = goat.bones;
  const { f } = goatAxes(), r = goatAxes().r.multiplyScalar(s), u = UP;
  const S = B[side + 'Arm'].getWorldPosition(new V3());
  const sw = P.swing && P.swing.side === side ? P.swing : null;
  let hand, blade;
  if (sw) {
    const x = clamp(sw.t / sw.dur, 0, 1), e = ease(x);
    if (cls === 'spear') { // thrust and pull back
      const reach = Math.sin(Math.min(1, x * 1.5) * Math.PI);
      blade = f.clone().addScaledVector(u, 0.04).normalize();
      hand = S.clone().addScaledVector(f, 0.05 + 0.6 * reach).addScaledVector(u, -0.32).addScaledVector(r, 0.02);
    } else if (sw.kind === 'over') { // overhead chop: up and back, down through the front
      const th = -0.7 + 3.0 * e, a = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(f, Math.sin(th));
      blade = a.clone();
      hand = S.clone().addScaledVector(r, -0.12).addScaledVector(f, 0.2).addScaledVector(a, 0.42).addScaledVector(u, -0.05);
    } else { // forehand: high outside to low across; backhand: back the other way
      const back = sw.kind === 'back', a0 = back ? Math.PI + 0.4 : -0.4, a1 = back ? -0.4 : Math.PI + 0.4, a = a0 + (a1 - a0) * e;
      const dh = r.clone().multiplyScalar(Math.cos(a)).addScaledVector(f, Math.sin(a)), tilt = (back ? -0.3 : 0.5) * (1 - 2 * e);
      blade = dh.clone().addScaledVector(u, tilt).normalize();
      hand = S.clone().addScaledVector(r, -0.16).addScaledVector(u, -0.22 + tilt * 0.25).addScaledVector(dh, 0.5);
    }
  } else if (cls === 'heavy') { // resting on the shoulder
    hand = S.clone().addScaledVector(f, 0.3).addScaledVector(u, -0.34).addScaledVector(r, -0.05);
    blade = u.clone().multiplyScalar(0.78).addScaledVector(f, -0.55).addScaledVector(r, 0.18).normalize();
  } else if (cls === 'spear') { // low, point forward, both hands
    hand = S.clone().addScaledVector(f, 0.2).addScaledVector(u, -0.62).addScaledVector(r, 0.06);
    blade = f.clone().multiplyScalar(0.95).addScaledVector(u, 0.28).normalize();
  } else { // low ready: point forward and down
    hand = S.clone().addScaledVector(f, 0.34).addScaledVector(u, -0.64).addScaledVector(r, 0.1);
    blade = f.clone().multiplyScalar(0.9).addScaledVector(u, -0.3).addScaledVector(r, -0.12).normalize();
  }
  it.poseK = sw ? 1 : damp(it.poseK || 0, P.rag ? 0 : 1, 10, dt);
  const k = it.poseK;
  ik2(goat, side, hand, u.clone().negate().addScaledVector(r, 0.7), k);
  turnBone(B[side + 'Hand'], handFrame(goat, side).blade, blade, k);
  if (cls === 'spear' && !INV.equip[side === 'Right' ? 'leftHand' : 'rightHand']) {
    const other = side === 'Right' ? 'Left' : 'Right';
    ik2(goat, other, handFrame(goat, side).grip.addScaledVector(blade, 0.62), u.clone().negate().addScaledVector(r, -0.7), k);
  }
}
function poseArms(dt) {
  if (P.swing) { P.swing.t += dt; if (P.swing.t > P.swing.dur) P.swing = null; }
  aimArms(dt);
  goat.g.updateMatrixWorld(true);
}

// ---- ragdoll (R, big hits, big falls) ---------------------------------------------------------------
const FLAIL = ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'Neck', 'Spine1'];
function toggleRagdoll() { if (P.rag) { if (P.rag.t > 0.4) endRagdoll(); } else if (!P.inCar && P.alive) startRagdoll(new V3(P.vel.x, Math.max(P.vel.y, 2), P.vel.z)); }
function startRagdoll(v) {
  if (P.rag || P.inCar || !goat) return;
  const b = new CANNON.Body({ mass: 70, shape: new CANNON.Box(new CANNON.Vec3(0.38, 0.95, 0.3)), position: new CANNON.Vec3(P.pos.x, P.pos.y + 1.2, P.pos.z), linearDamping: 0.04, angularDamping: 0.12 });
  b.quaternion.setFromEuler(0, P.yaw, 0);
  b.velocity.set(v.x, v.y, v.z);
  b.angularVelocity.set(rnd(-5, 5) + v.z * 0.3, rnd(-3, 3), rnd(-5, 5) - v.x * 0.3);
  phys.w.addBody(b);
  P.rag = { b, t: 0, still: 0, from: P.pos.clone(), dist: 0, ph: FLAIL.map(() => rnd(0, 6)) };
  P.flip = 0; goat.pivot.rotation.set(0, 0, 0);
  play(goat, 'jump', 0.1, 0.4);
}
function updateRagdoll(dt, dead) {
  const R = P.rag, b = R.b;
  R.t += dt;
  // floors of buildings that turned to voxels aren't in cannon: don't sink through what's left
  const g = world.groundHeight(b.position.x, b.position.z, b.position.y + 0.5, 0.3);
  if (g > -1e9 && b.position.y < g + 0.35) { b.position.y = g + 0.35; if (b.velocity.y < 0) b.velocity.y *= -0.3; }
  const sp = b.velocity.length();
  R.still = sp < 0.9 ? R.still + dt : 0;
  goat.g.rotation.set(0, 0, 0);
  goat.g.position.set(b.position.x, b.position.y - 1.15, b.position.z);
  goat.pivot.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  P.pos.set(b.position.x, b.position.y - 1.15, b.position.z);
  R.dist = Math.max(R.dist, Math.hypot(P.pos.x - R.from.x, P.pos.z - R.from.z) + Math.max(0, R.from.y - P.pos.y));
  goat.mixer.update(dt);
  // floppy limbs
  const amp = (dead ? 0.04 : 0.06) + Math.min(1.2, sp / 6);
  FLAIL.forEach((n, i) => { const bn = goat.bones[n]; if (!bn) return; const ph = R.ph[i] + T * (7 + i); bn.rotateX(Math.sin(ph) * amp); bn.rotateZ(Math.cos(ph * 0.8) * amp * 0.7); });
  // a tumbling goat bowls people over
  if (sp > 5) for (const n of npcs) if (!n.gone && !n.fly && n.g.position.distanceTo(P.pos) < 1.6 + n.r) { const v = new V3(b.velocity.x, Math.abs(b.velocity.y) + 3, b.velocity.z); hurtNpc(n, sp * 2, v, 'kick', n.g.position.clone().setY(n.g.position.y + 1)); launchNpc(n, v); addChaos(40, 'BOWLED OVER'); }
  if (!dead && R.t > 0.5 && R.still > 1.2) endRagdoll();
}
function endRagdoll() {
  const R = P.rag; if (!R) return;
  phys.w.removeBody(R.b);
  P.rag = null;
  const e = new THREE.Euler().setFromQuaternion(goat.pivot.quaternion, 'YXZ');
  P.yaw = e.y; goat.pivot.quaternion.identity();
  const g = world.groundHeight(P.pos.x, P.pos.z, P.pos.y + 1.5, 0.3);
  if (g > -1e9) P.pos.y = Math.max(g, P.pos.y);
  P.vel.set(0, 0, 0); P.grounded = true;
  if (R.dist > 6) addChaos(Math.round(R.dist * 6), 'RAGDOLL');
  play(goat, 'idle', 0.3);
}

// ---- headbutt (E), lick-grab (hold C) ---------------------------------------------------------------
function headbutt() {
  if (!P.alive || P.inCar || P.rag || (P.hbT || 0) > T) return;
  P.hbT = T + 0.55; P.attackT = T + 0.45;
  if (mouse.r) P.yaw = camYaw;
  const f = new V3(Math.sin(P.yaw), 0, Math.cos(P.yaw)), charge = Math.hypot(P.vel.x, P.vel.z) > 10;
  P.vel.addScaledVector(f, charge ? 6 : 9);
  swingAnim('sw_lunge', 0.32);
  setTimeout(() => {
    const power = charge ? 1.6 : 1, c = P.pos.clone().addScaledVector(f, 1.3).setY(P.pos.y + 1.4);
    let hit = false;
    for (const n of npcs) {
      if (n.gone || n.held) continue;
      const q = n.g.position;
      if (Math.hypot(q.x - c.x, q.z - c.z) < 1.4 + n.r && Math.abs(q.y - P.pos.y) < 2) {
        const v = f.clone().multiplyScalar(14 * power).setY(7 * power);
        hurtNpc(n, 28 * power, v, 'kick', q.clone().setY(q.y + n.h * 0.6)); launchNpc(n, v); hit = true;
        addChaos(30, 'HEADBUTT');
      }
    }
    for (const b of phys.dyn) if (Math.hypot(b.position.x - c.x, b.position.z - c.z) < 1.8 && Math.abs(b.position.y - c.y) < 2.2) { b.wakeUp(); const k = Math.min(b.mass, 60) * 10 * power; b.applyImpulse(new CANNON.Vec3(f.x * k, k * 0.45, f.z * k)); hitBody(b, 30); hit = true; }
    const h = world.raycast(c.clone().addScaledVector(f, -1), f, 2.6, { targets: true });
    if (h) { if (h.target) world.damage(h.target, 25 * power, h.point); D.bullet(h, { radius: 0.7 * power, power: 260 * power, dir: f, speed: 6, chunks: 5 }); fx.sparksBurst(h.point, h.normal, 6, 0xffc070, 8); hit = true; }
    if (hit) { sound.impact?.(c); shake = Math.max(shake, 0.2 * power); hitstop = 0.05; }
  }, 140);
}
let tongue = null;
function updateLick(dt) {
  if (!tongue) { tongue = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineBasicMaterial({ color: 0xff6f9a })); tongue.frustumCulled = false; scene.add(tongue); }
  const head = goat.bones.Head;
  const want = keys.KeyC && P.alive && !P.inCar && !P.rag;
  if (want && !P.lick) {
    const f = new V3(Math.sin(P.yaw), 0, Math.cos(P.yaw)), p0 = P.pos.clone().setY(P.pos.y + 1.2);
    let best = null, bd = 3.4;
    for (const b of phys.dyn) { if (b.mgr || b.mass > 120) continue; const v = _a.set(b.position.x - p0.x, b.position.y - p0.y, b.position.z - p0.z); const d = v.length(); if (d < bd && v.normalize().dot(f) > 0.2) { bd = d; best = { body: b }; } }
    for (const n of npcs) { if (n.gone || n.kind === 'giant') continue; const v = _a.subVectors(n.g.position, P.pos).setY(0); const d = v.length(); if (d < bd && v.normalize().dot(f) > 0.2) { bd = d; best = { npc: n }; } }
    if (best) { P.lick = best; sfx.bleat(P.pos); if (best.npc) { best.npc.held = true; best.npc.fly = false; play(best.npc, best.npc.dead ? 'death' : 'hit', 0.1); } }
  }
  if (P.lick && !want) {
    const L = P.lick; P.lick = null;
    const tf = new V3(Math.sin(camYaw), 0, Math.cos(camYaw)), tv = tf.multiplyScalar(14).add(P.vel).setY(6 + Math.max(0, P.vel.y));
    if (L.npc) { L.npc.held = false; launchNpc(L.npc, tv); addChaos(40, 'YEET'); sfx.bleat(P.pos); }
    else if (L.body) { L.body.wakeUp(); L.body.applyImpulse(new CANNON.Vec3(tv.x * L.body.mass * 0.8, tv.y * L.body.mass * 0.8, tv.z * L.body.mass * 0.8)); addChaos(10, 'YEET'); }
  }
  tongue.visible = !!P.lick;
  if (!P.lick || !head) return;
  const mouth = head.getWorldPosition(new V3()).add(_b.set(Math.sin(P.yaw) * 0.25, -0.05, Math.cos(P.yaw) * 0.25));
  const hold = mouth.clone().add(_b.set(Math.sin(P.yaw) * 1.4, -0.6, Math.cos(P.yaw) * 1.4));
  let end;
  if (P.lick.body) {
    const b = P.lick.body; b.wakeUp();
    const k = b.mass * 40, c = b.mass * 6;
    b.applyForce(new CANNON.Vec3((hold.x - b.position.x) * k - b.velocity.x * c, (hold.y - b.position.y) * k - b.velocity.y * c + b.mass * 16, (hold.z - b.position.z) * k - b.velocity.z * c));
    end = new V3(b.position.x, b.position.y, b.position.z);
  } else {
    const n = P.lick.npc, q = n.g.position;
    // dragged by the collar: trails behind the goat's mouth
    q.x = damp(q.x, hold.x, 10, dt); q.z = damp(q.z, hold.z, 10, dt); q.y = Math.max(world.groundHeight(q.x, q.z, q.y + 1, 0.2), damp(q.y, hold.y - n.h * 0.6, 10, dt));
    n.yaw = P.yaw + Math.PI; n.g.rotation.y = n.yaw;
    if (!n.dead && Math.random() < dt * 0.6) n.panic = 10;
    end = q.clone().setY(q.y + n.h * 0.8);
  }
  const a = tongue.geometry.attributes.position; a.setXYZ(0, mouth.x, mouth.y, mouth.z); a.setXYZ(1, end.x, end.y, end.z); a.needsUpdate = true;
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
    P.alive = false; P.deadT = 5; P.hp = 0;
    if (P.inCar) leaveCar();
    if (!P.rag) startRagdoll(from ? _a.subVectors(P.pos, from).setY(0).normalize().multiplyScalar(5).setY(4) : new V3(0, 3, 0));
    $('#down').style.display = 'flex'; timeScale = 0.45;
  } else if (kind === 'claw' && amount >= 25 && from && !P.inCar) startRagdoll(_a.subVectors(P.pos, from).setY(0).normalize().multiplyScalar(9).setY(6));
  else if (amount > 15 && !P.rag) play(goat, 'hit', 0.05);
}

// ---- camera -----------------------------------------------------------------------------------------
const camT = new V3(), camSm = new V3();
let camD = 5, camAim = 0, camFov = 65;
function updateCamera(dt) {
  if (!goat) return;
  const car = P.inCar, aiming = mouse.r && !car && !P.rag;
  camAim = damp(camAim, aiming ? 1 : 0, 12, dt);
  if (car && T - lastMouse > 1.2 && Math.abs(car.speed) > 2) { let d = car.yaw + Math.PI / 2 - camYaw; if (car.speed < -2) d += Math.PI; d = Math.atan2(Math.sin(d), Math.cos(d)); camYaw += d * Math.min(1, dt * 2.5); }
  const base = car ? car.pos : P.pos;
  const fwd = new V3(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
  const right = new V3(-Math.cos(camYaw), 0, Math.sin(camYaw));
  _c.set(base.x, base.y + (car ? 2.0 : 2.0 - camAim * 0.2), base.z);
  if (!car) _c.addScaledVector(right, 0.45 + camAim * 0.35); // over the right shoulder
  if (dt > 0 && camSm.lengthSq() > 0 && camSm.distanceTo(_c) < 8) camSm.set(damp(camSm.x, _c.x, 25, dt), damp(camSm.y, _c.y, 14, dt), damp(camSm.z, _c.z, 25, dt));
  else camSm.copy(_c);
  camT.copy(camSm);
  const wantD = car ? Math.max(7.5, camDist + 2.5) : camDist + (2.4 - camDist) * camAim;
  camD = dt > 0 ? damp(camD, wantD, 8, dt) : wantD;
  let dist = camD;
  const back = fwd.clone().negate();
  const hit = world.raycast(camT, back, dist + 0.4, { targets: false });
  if (hit) dist = Math.max(0.6, hit.dist - 0.35);
  camera.position.copy(camT).addScaledVector(back, dist);
  { const gy = world.groundHeight(camera.position.x, camera.position.z, camera.position.y + 1, 0.2); if (gy > -1e9 && camera.position.y < gy + 0.5) camera.position.y = gy + 0.5; }
  if (shake > 0) { camera.position.x += rnd(-1, 1) * shake; camera.position.y += rnd(-1, 1) * shake; shake = Math.max(0, shake - dt * 2.5); }
  camera.lookAt(_a.copy(camT).add(fwd));
  const fov = 65 - camAim * 17 + (car ? clamp(Math.abs(car.speed) / 40, 0, 1) * 14 : clamp((Math.hypot(P.vel.x, P.vel.z) - 8) / 5, 0, 1) * 8);
  if (Math.abs(fov - camFov) > 0.05) { camFov = dt > 0 ? damp(camFov, fov, 6, dt) : fov; camera.fov = camFov; camera.updateProjectionMatrix(); }
  sound.listener.x = camera.position.x; sound.listener.y = camera.position.y; sound.listener.z = camera.position.z;
  // aim: what the crosshair is on (never the goat himself)
  const o = camera.position.clone().addScaledVector(fwd, dist * 0.9 + 0.3), d = fwd.clone();
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
/** a pickup's model, centered on its spot (blades tilted, so a spear doesn't poke into the ground) */
function pickupModel(w) {
  const m = weaponModel(w);
  if (WD[w].kind === 'melee') m.group.rotation.z = -Math.PI / 3;
  m.group.updateMatrixWorld(true); m.group.position.sub(new THREE.Box3().setFromObject(m.group).getCenter(new V3()));
  return m.group;
}
const CAR_MODELS = [], CAR_CAP = 40;
/** every car in town drawn as one of the packs' models (police ones for cruisers); the physics stay the same */
function setupCars() {
  const CS = carSys(); if (!CS) return;
  for (const c of CAR_LIST) {
    const root = CAR_SRC[c.f]; if (!root) continue;
    root.updateMatrixWorld(true);
    const parts = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mat = o.material; if (/glass|window|wind/i.test(mat.name || '')) { mat.transparent = true; mat.opacity = 0.45; mat.depthWrite = false; }
      const im = new THREE.InstancedMesh(o.geometry.clone().applyMatrix4(o.matrixWorld), mat, CAR_CAP);
      im.count = 0; im.frustumCulled = false; im.castShadow = im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(im); parts.push(im);
      const hsl = mat.color.getHSL({}); im.paint = !mat.map && !/glass|window|light|tire|tyre|wheel|rim|black|chrome/i.test(mat.name || '') && hsl.l > 0.45 && hsl.s < 0.15;
    });
    CAR_MODELS.push({ ...c, parts, n: 0 });
  }
  const civ = CAR_MODELS.filter((m) => !m.police), cops = CAR_MODELS.filter((m) => m.police);
  if (!civ.length) return;
  CS.view.visible = false;
  const fr = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere(), cm = new THREE.Matrix4(), sm = new THREE.Matrix4(), col = new THREE.Color(), pc = new THREE.Color();
  // plain white bodies get a paint job, a different one per car
  const PAINT = [0xb8302a, 0x2c5fa8, 0x26262c, 0xe6e6e6, 0xa9adb3, 0xe0b42a, 0x2f7d4a, 0x6b1f2a, 0x1f7f86, 0xd0672a, 0x4a3b8c, 0x8a8f5a].map((h) => new THREE.Color(h));
  CS.cull = (camera) => {
    camera.updateMatrixWorld();
    fr.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const C = camera.position, src = CS.mesh.instanceMatrix.array, K = CS.mesh.instanceColor.array;
    for (const m of CAR_MODELS) m.n = 0;
    for (const car of CS.list) {
      const p = car.pos, d2 = (p.x - C.x) ** 2 + (p.z - C.z) ** 2;
      if (d2 > 520 * 520 || (d2 > 900 && !fr.intersectsSphere(sph.set(p, car.len)))) continue;
      const m = car.police && cops.length ? cops[car.i % cops.length] : civ[(car.i * 7 + car.skin * 3) % civ.length];
      if (m.n >= CAR_CAP) continue;
      const s = car.len / m.len;
      cm.fromArray(src, car.i * 16).multiply(sm.makeScale(s, s, s));
      if (car.state === 2) col.setRGB(0.16, 0.15, 0.14); else col.fromArray(K, car.i * 3);
      const paint = car.state !== 2 && !car.police ? pc.copy(PAINT[(car.i * 5 + car.skin) % PAINT.length]).multiply(col) : col;
      for (const im of m.parts) { im.setMatrixAt(m.n, cm); im.setColorAt(m.n, im.paint ? paint : col); }
      m.n++;
    }
    for (const m of CAR_MODELS) for (const im of m.parts) { im.count = m.n; im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; }
  };
}
function spawnPickups() {
  const ringGeo = new THREE.TorusGeometry(0.7, 0.05, 6, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8 });
  const beamGeoP = new THREE.CylinderGeometry(0.12, 0.35, 14, 8, 1, true), beamMatP = new THREE.MeshBasicMaterial({ color: 0xffc23f, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  // Spread the armory over the whole town: the building/park spots, then sidewalk spots far from every other
  // pickup, none near where the goat starts. The big stuff (nukes, mega guns) lies far out.
  const far = (p, d) => p.distanceTo(TOWN.spawn) > d;
  const spots = TOWN.pickups.filter((p) => far(p, 45));
  const out = TOWN.spots.filter((p) => far(p, 45)).sort(() => Math.random() - 0.5);
  for (const p of out) { if (spots.length >= 46) break; if (spots.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 42)) spots.push(p.clone().setY(0)); }
  // half the armory is blades (bm's swords, daggers, maces and spears); a few lie right by the start
  const shuffle = (a) => a.sort(() => Math.random() - 0.5);
  const big = (w) => WD[w].nuke || WD[w].kind === 'mega';
  const BLADES = Object.keys(WD).filter((w) => WD[w].kind === 'melee'), GUNS = [...new Set(PICKUP_POOL)].filter((w) => WD[w].kind !== 'melee');
  spots.sort((a, b) => a.distanceTo(TOWN.spawn) - b.distanceTo(TOWN.spawn));
  const blades = shuffle(BLADES.concat(BLADES)), guns = shuffle(GUNS.filter((w) => !big(w))), bigs = shuffle(GUNS.filter(big));
  const order = [];
  for (let i = 0; i < spots.length; i++) order.push(i >= spots.length - bigs.length ? bigs[spots.length - 1 - i] : i % 2 ? guns[(i >> 1) % guns.length] : blades[(i >> 1) % blades.length]);
  const sp = TOWN.spawn;
  for (const [dx, dz, w] of [[5, -6, 'mp_katana'], [-5, -6, 'mp_nailbat'], [7, 3, 'mp_machete']]) { spots.unshift(new V3(sp.x + dx, 0, sp.z + dz)); order.unshift(w); }
  spots.forEach((p, i) => {
    const w = order[i];
    const bob = new THREE.Group(); bob.add(pickupModel(w));
    const g = new THREE.Group(); g.add(bob);
    const beam = new THREE.Mesh(beamGeoP, beamMatP); beam.position.y = 6; g.add(beam);
    const ring = new THREE.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.85; g.add(ring);
    g.position.set(p.x, p.y + 1.0, p.z);
    scene.add(g);
    pickups.push({ w, g, pos: p.clone(), taken: false });
  });
}
function takePickup(pk) {
  if (pk.cool > T) return;
  const it = newItem(pk.w), d = WD[pk.w];
  const slot = SLOTS.find((s) => !INV.equip[s.id] && allowed(pk.w, s));
  if (slot) { pk.taken = true; scene.remove(pk.g); }
  if (slot) { equipTo(it, slot.id); toast(`Picked up <b>${d.name}</b> → ${slot.label}`, true); }
  else {
    // swap with what's there and leave the old one lying on this spot
    const sw = SLOTS.find((s) => allowed(pk.w, s) && (s.type !== 'hand' || s.id === 'rightHand')) || SLOTS.find((s) => allowed(pk.w, s));
    const old = INV.equip[sw.id]; unmount(old); INV.equip[sw.id] = null; equipTo(it, sw.id);
    toast(`Swapped <b>${WD[old.w].name}</b> for <b>${d.name}</b>`, true);
    pk.w = old.w; pk.cool = T + 2; const bob = pk.g.children[0]; bob.clear(); bob.add(pickupModel(pk.w));
    sound.reload?.(); if (invOpen) drawInv();
    return;
  }
  sound.reload?.();
  setTimeout(() => { if (!pk.taken) return; pk.taken = false; const kin = Object.keys(WD).filter((x) => (WD[x].kind === 'melee') === (d.kind === 'melee') && !WD[x].nuke && PICKUP_POOL.concat(x).includes(x) && (d.kind === 'melee' || PICKUP_POOL.includes(x))); pk.w = pick(kin); const bob = pk.g.children[0]; bob.clear(); bob.add(pickupModel(pk.w)); scene.add(pk.g); }, 45000);
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
function mount(it, slotId) { const s = SLOTS.find((x) => x.id === slotId) || SLOTS[0]; const m = weaponModel(it.w, s.type); it.model = m; scene.add(m.group); if (WD[it.w].kind === 'melee') { m.group.updateMatrixWorld(true); it.len = new THREE.Box3().setFromObject(m.group).max.y; } }
function unmount(it) { if (it.model) { scene.remove(it.model.group); it.model = null; } if (it.beam) { scene.remove(it.beam); it.beam = null; } }

// Where mounts sit on the goat, in his own frame (+x left, +y up, +z forward), relative to a bone
const MOUNT = {
  shoulderL: { bone: 'LeftArm', off: [0.2, 0.1, -0.1] }, shoulderR: { bone: 'RightArm', off: [-0.2, 0.1, -0.1] },
  legL: { bone: 'LeftUpLeg', mid: 'LeftLeg', off: [0.17, 0, 0.02] }, legR: { bone: 'RightUpLeg', mid: 'RightLeg', off: [-0.17, 0, 0.02] },
};
const ZERO = new V3(), _bx = new V3(), _by = new V3(), _bz = new V3();
function faceDir(g, dir) { _m.lookAt(dir, ZERO, Math.abs(dir.y) > 0.98 ? _bx.set(0, 0, 1) : UP); g.quaternion.setFromRotationMatrix(_m); }
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'], CURL = [1.15, 1.35, 0.9];
const _hw = new V3(), _hm = new V3(), _hi = new V3(), _hp = new V3();
/** the hand's working frame: f along the fingers, blade out of the thumb side of a fist, palm normal, grip point */
function handFrame(A, side) {
  const B = A.bones;
  B[side + 'Hand'].getWorldPosition(_hw); B[side + 'HandMiddle1'].getWorldPosition(_hm);
  B[side + 'HandIndex1'].getWorldPosition(_hi); B[side + 'HandPinky1'].getWorldPosition(_hp);
  const f = _hm.clone().sub(_hw).normalize();
  const blade = _hi.clone().sub(_hp); blade.addScaledVector(f, -blade.dot(f)).normalize();
  const palm = side === 'Right' ? new V3().crossVectors(blade, f) : new V3().crossVectors(f, blade);
  const grip = _hw.clone().lerp(_hm, 0.85).addScaledVector(palm, 0.045);
  return { f, blade, palm, grip };
}
/** close the fingers round whatever the hand holds (and open them again when it lets go) */
function curlFingers(A, side, H) {
  const axis = new V3().crossVectors(H.f, H.palm).normalize();
  for (const fn of FINGERS) for (let k = 1; k <= 3; k++) {
    const b = A.bones[side + 'Hand' + fn + k]; if (!b) continue;
    if (!b.userData.q0) b.userData.q0 = b.quaternion.clone();
    b.quaternion.copy(b.userData.q0); b.updateMatrixWorld(true);
    b.getWorldQuaternion(_qa); _qb.setFromAxisAngle(axis, CURL[k - 1]); _qa.premultiply(_qb);
    b.parent.getWorldQuaternion(_qc).invert(); b.quaternion.copy(_qc.multiply(_qa)); b.updateMatrixWorld(true);
  }
  A.curled = A.curled || {}; A.curled[side] = true;
}
function relaxFingers(A, side) {
  if (!A.curled || !A.curled[side]) return;
  A.curled[side] = false;
  for (const fn of FINGERS) for (let k = 1; k <= 3; k++) { const b = A.bones[side + 'Hand' + fn + k]; if (b && b.userData.q0) b.quaternion.copy(b.userData.q0); }
}
const TRAIL_N = 16;
let trail = null;
/** a ribbon off the blade while it swings */
function updateTrail(g, it) {
  if (!trail) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 6), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 6), 3));
    const idx = []; for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } geo.setIndex(idx);
    trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    trail.frustumCulled = false; trail.pts = []; scene.add(trail);
  }
  const pts = trail.pts;
  if (g && it && P.swing) {
    const bd = _by.set(0, 1, 0).applyQuaternion(g.quaternion), L = it.len || 1.2;
    pts.unshift({ a: g.position.clone().addScaledVector(bd, L), b: g.position.clone().addScaledVector(bd, L * 0.4), t: T, c: WD[it.w].fire ? [1, 0.55, 0.2] : [0.85, 0.9, 1] });
    if (pts.length > TRAIL_N) pts.length = TRAIL_N;
  }
  while (pts.length && T - pts[pts.length - 1].t > 0.13) pts.pop();
  const P_ = trail.geometry.attributes.position, C_ = trail.geometry.attributes.color;
  trail.visible = pts.length > 1;
  for (let i = 0; i < TRAIL_N; i++) {
    const q = pts[Math.min(i, pts.length - 1)]; if (!q) break;
    const k = Math.max(0, 1 - (T - q.t) / 0.13) * (1 - i / TRAIL_N) * 0.8;
    P_.setXYZ(i * 2, q.a.x, q.a.y, q.a.z); P_.setXYZ(i * 2 + 1, q.b.x, q.b.y, q.b.z);
    C_.setXYZ(i * 2, q.c[0] * k, q.c[1] * k, q.c[2] * k); C_.setXYZ(i * 2 + 1, 0, 0, 0);
  }
  P_.needsUpdate = true; C_.needsUpdate = true;
}
function placeWeapons() {
  const vis = !P.inCar && goat.g.visible;
  goat.g.updateMatrixWorld(true);
  for (const [sid, side] of [['rightHand', 'Right'], ['leftHand', 'Left']]) { const it = INV.equip[sid]; if (!it || !vis || WD[it.w].kind === 'shield') relaxFingers(goat, side); }
  const cy = Math.cos(P.yaw), sy = Math.sin(P.yaw);
  const facing = _bz.set(sy, 0, cy);
  for (const s of SLOTS) {
    const it = INV.equip[s.id]; if (!it || !it.model) continue;
    const g = it.model.group, d = WD[it.w];
    g.visible = vis;
    if (!vis) continue;
    if (s.type === 'hand') {
      const side = s.id === 'rightHand' ? 'Right' : 'Left', hand = goat.bones[side + 'Hand'];
      hand.getWorldPosition(g.position);
      if (d.kind === 'melee') {
        // the handle runs across the palm through the closed fist; the blade comes out of the thumb side and
        // the edge lines up with the knuckles
        const H = handFrame(goat, side);
        curlFingers(goat, side, H);
        _m.makeBasis(_bz.crossVectors(H.blade, H.f), H.blade, H.f);
        g.quaternion.setFromRotationMatrix(_m);
        g.position.copy(H.grip);
        _bz.set(sy, 0, cy); // facing, used again below
        if (P.swing && P.swing.side === side) updateTrail(g, it);
      } else if (d.kind === 'shield') {
        const raised = mouse.r;
        if (raised) { g.position.copy(P.pos).add(_bx.set(sy * 0.6, 1.35, cy * 0.6)); faceDir(g, facing); }
        else { goat.bones.LeftForeArm.getWorldPosition(g.position).add(_bx.set(cy * 0.12, 0, -sy * 0.12)); faceDir(g, facing); g.rotateY(-0.8); }
      } else {
        curlFingers(goat, side, handFrame(goat, side));
        // guns: barrel along the hand when relaxed, at the crosshair when aiming (the arm IK points the hand)
        const dir = P.aimK > 0.5 ? _bx.subVectors(AIM.point, g.position).normalize() : _bx.set(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(_q)).normalize();
        faceDir(g, dir);
        g.position.addScaledVector(dir, 0.04);
      }
    } else {
      const M = MOUNT[s.id], bone = goat.bones[M.bone];
      bone.getWorldPosition(g.position);
      if (M.mid) g.position.lerp(goat.bones[M.mid].getWorldPosition(_by), 0.45);
      g.position.x += M.off[0] * cy + M.off[2] * sy; g.position.y += M.off[1]; g.position.z += -M.off[0] * sy + M.off[2] * cy;
      // pods swivel toward the crosshair but never point back into the goat
      const dir = _bx.subVectors(AIM.point, g.position).normalize();
      if (dir.dot(facing) < 0.25) dir.addScaledVector(facing, 0.25 - dir.dot(facing)).normalize();
      faceDir(g, dir);
      if (mouse.r && g.position.distanceTo(camera.position) < 1.8) g.visible = false; // don't block the aim
    }
    if (it.model.spin && it.spinV) it.model.spin.rotation.z += it.spinV * 0.016;
  }
  updateTrail(null, null);
}

// ---- firing -------------------------------------------------------------------------------------------
function muzzleOf(it) {
  if (P.inCar) return P.inCar.pos.clone().setY(P.inCar.pos.y + 1.9); // drive-by, out of the window
  const m = it.model;
  if (m && m.muzzles.length) { const k = (it.mi = ((it.mi || 0) + 1) % m.muzzles.length); m.group.updateMatrixWorld(true); return m.muzzles[k].getWorldPosition(new V3()); }
  if (m) return m.group.getWorldPosition(new V3()).addScaledVector(AIM.dir, 0.6);
  return P.pos.clone().setY(P.pos.y + 1.6);
}
// LMB fires whatever is in the hands (a melee weapon in the right hand swings), Q / middle mouse fires the
// shoulder and leg mounts; in a car LMB fires the mounts too.
function triggers(dt) {
  const inCar = !!P.inCar, can = P.alive && !P.rag && !P.jack;
  const hand = mouse.l && can, mounts = false;
  const R = INV.equip.rightHand, L = INV.equip.leftHand;
  if (hand && !inCar && !R && !isGun(L) && (P.hbT || 0) < T) headbutt();
  for (const s of SLOTS) {
    const it = INV.equip[s.id]; if (!it) continue;
    const d = WD[it.w];
    it.cool -= dt;
    if (it.reloadT > 0) { it.reloadT -= dt; if (it.reloadT <= 0) it.ammo = d.ammo; }
    if (it.spinV) it.spinV = Math.max(0, it.spinV - dt * 30);
    let held = s.type === 'hand' ? hand && !(inCar && d.kind === 'melee') : mounts;
    // the left hand's melee weapon only answers LMB when the right hand has no gun (V swings it any time)
    if (s.id === 'leftHand' && d.kind === 'melee' && isGun(R)) held = false;
    if (d.kind === 'mega') { tickMega(it, d, held, dt); continue; }
    if (!held || it.cool > 0 || it.reloadT > 0 || d.kind === 'shield') continue;
    if (d.kind === 'melee') { it.cool = d.rate; melee(d, it); continue; }
    fire(it, d);
    it.cool = d.rate;
    it.ammo--;
    if (it.ammo <= 0) { it.reloadT = d.reload; sound.reload?.(); }
  }
}
function quickMelee() {
  if (!P.alive || P.inCar || P.rag) return;
  const it = [INV.equip.leftHand, INV.equip.rightHand].find((x) => x && WD[x.w].kind === 'melee');
  if (it) { if (it.cool > 0) return; it.cool = WD[it.w].rate; melee(WD[it.w], it); }
  else if (!P.kickT || P.kickT < T) { P.kickT = T + 0.55; melee({ dmg: 25, reach: 2.2, power: 80, knock: 9 }, null); }
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
    if (dd < R * 1.3) { const k = 1 - dd / (R * 1.3); hurtPlayer(dmg * 0.25 * k, p, 'blast'); const v = _a.subVectors(P.pos, p).setY(0).normalize().multiplyScalar(18 * k).clone(); v.y = 5 + 10 * k; if (k > 0.3 && P.alive && !P.rag) startRagdoll(v); else { P.vel.add(v); P.grounded = false; } }
  }
  addChaos(Math.round(R * 4));
}

// melee: a swing in front of the goat
function melee(d, it) {
  // quick taps chain: forehand, backhand, then an overhead finisher
  P.chain = T - (P.lastSwing || -9) < 0.8 ? ((P.chain || 0) + 1) % 3 : 0; P.lastSwing = T;
  const fin = P.chain === 2 && !!it, heavy = !!d.knock, quick = d.rate < 0.35;
  const side = it && INV.equip.leftHand === it ? 'Left' : 'Right';
  const dur = clamp(d.rate * 0.85, 0.26, 0.55) * (fin ? 1.2 : 1);
  if (it) P.swing = { t: 0, dur, side, kind: fin ? 'over' : P.chain === 1 ? 'back' : 'fore' };
  swingAnim(it ? SWINGS[meleeClass(d)][P.chain] : 'atk', it ? dur : Math.max(dur, 0.4)); // no weapon: a kick
  P.fireFace = dur + 0.25; P.yaw = camYaw; P.attackT = T + dur + 0.1;
  sfx.whoosh(P.pos, heavy ? 0.7 : quick ? 1.3 : 1);
  const f0 = new V3(Math.sin(P.yaw), 0, Math.cos(P.yaw));
  if (P.grounded) { const L = (d.reach > 3.5 ? 6 : 4.5) * (fin ? 1.5 : 1); P.vel.x += f0.x * L; P.vel.z += f0.z * L; }
  setTimeout(() => {
    const f = new V3(Math.sin(P.yaw), 0, Math.cos(P.yaw)), c = P.pos.clone().addScaledVector(f, d.reach * 0.6).setY(P.pos.y + 1.2);
    let hit = false;
    for (const n of npcs) {
      if (n.gone) continue;
      const q = n.g.position, dd = Math.hypot(q.x - c.x, q.z - c.z);
      if (dd < d.reach * 0.7 + n.r && Math.abs(q.y - P.pos.y) < 2.5) {
        const kn = f.clone().multiplyScalar((d.knock || 4) * (fin ? 2 : 1)).setY(d.knock || fin ? 4 : 1.5);
        hurtNpc(n, d.dmg * (fin ? 1.6 : 1), kn, it ? (WD[it.w].sever || fin ? 'chop' : 'slash') : 'kick', q.clone().setY(q.y + n.h * 0.6));
        if (fin && !n.fly) launchNpc(n, kn);
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
    if (hit) {
      sound.impact?.(c); sfx.slap(c);
      shake = Math.max(shake, heavy ? 0.32 : fin ? 0.26 : 0.14);
      hitstop = Math.max(hitstop, heavy ? 0.1 : fin ? 0.085 : 0.045);
      if (fin) addChaos(25, 'FINISHER');
    }
  }, (dur * 0.5 * 1000) / Math.max(0.3, timeScale));
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
  const want = ['idle', 'walk', 'run', 'flee', 'scared', 'afraid', 'wave', 'dance_1', 'dance_3', 'cheer', 'fall', 'hit', 'look_around', 'talk', 'kick', 'throw', 'sit_idle', 'sit', 'get_up', 'angry', 'spar', 'jog', 'point'];
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
    else if (mode === 3) { const k = 0.3 + L * 0.9; o = [18 + 30 * k, 26 + 42 * k, 60 + 105 * k]; }
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
      folkSrc.push({ src: g.scene, h: f.height || 1.75, tex: texs[1] });
    } catch (e) { console.warn('folk', k, e); }
  }));
  // the police: town-guard models in navy
  await Promise.all(['watchman', 'gaoler', 'veteran', 'drillsergeant', 'deadwatch'].filter((k) => folk[k]).map(async (k) => {
    try {
      const f = folk[k];
      const [g, img] = await Promise.all([gl.loadAsync(`assets/folk/${f.glb}`), TL.loadAsync(`assets/folk/${f.c}`)]);
      copSrc.push({ src: g.scene, h: (f.height || 1.78) * 1.03, tex: modernize(img, 3) });
    } catch (e) { console.warn('cop', k, e); }
  }));
  makeDrivers();
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
  const hostile = !['folk', 'goat', 'cop'].includes(kind);
  // where: villagers on sidewalks and inside buildings, monsters in parks and the edges of town
  let p;
  if (kind === 'folk' && Math.random() < 0.35 && TOWN.indoor.length) { const r = pick(TOWN.indoor); p = new V3(rnd(r.x0, r.x1), r.y, rnd(r.z0, r.z1)); }
  else if (hostile) { const pk = pick(TOWN.parks); p = Math.random() < 0.5 ? new V3(rnd(pk.x0, pk.x1), 0, rnd(pk.z0, pk.z1)) : pick(TOWN.spots).clone().add(new V3(rnd(-3, 3), 0, rnd(-3, 3))); }
  else p = pick(TOWN.spots).clone().add(new V3(rnd(-2, 2), 0, rnd(-2, 2)));
  m.g.position.copy(p);
  scene.add(m.g);
  const hp = { cop: 90, folk: 60, goat: 140, kobold: 70, goblin: 60, zombie: 110, giant: 500, wolf: 260, possessed: 90 }[kind];
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
  if (!n.hostile && n.kind !== 'goat') crime(n.hp <= 0 ? (n.cop ? 1 : 0.7) : n.cop ? 0.3 : 0.12);
  if (kind === 'head' && dmg > 20) { sever(n, 'head', dd); n.hp = 0; }
  else if (kind === 'chop' && Math.random() < 0.7) maybeSever(n, kind, dd, 0.9);
  else if (kind === 'slash' && Math.random() < 0.3) maybeSever(n, kind, dd, 0.6);
  else if (kind === 'blast' && dmg > 40) maybeSever(n, kind, dd, dmg > 120 ? 0.8 : 0.35);
  else if (kind === 'shot' && dmg > 25 && Math.random() < 0.15) maybeSever(n, kind, dd, 0.5);
  if (n.hostile || n.kind === 'goat') { n.aggro = 30; n.hostile = true; }
  else if (!n.cop && !(n.angry > 0)) n.panic = 12;
  // everyone near panics
  for (const o of npcs) if (!o.hostile && !o.dead && !o.cop && !(o.angry > 0) && o.g.position.distanceTo(n.g.position) < 25) o.panic = 10;
  if (n.hp <= 0) die(n, kind, dd);
  else {
    play(n, 'hit', 0.05);
    n.stunT = T + 0.5;
    if (kind === 'blast' || (dir && dir.length() > 6)) launchNpc(n, dd);
  }
}
function launchNpc(n, v) { if (n.held) return; n.fly = true; n.vel.copy(v); n.spin = rnd(-8, 8); }
function die(n, kind, dir) {
  if (n.dead) return;
  n.dead = true; n.deadT = 0;
  if (n.gun) { scene.remove(n.gun.group); n.gun = null; }
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
    if (n.held) { if (near) n.mixer.update(dt); continue; }
    // spurting stumps and burning
    if (n.burn > 0) { n.burn -= dt; if (Math.random() < 0.6) fx.fire.emit(pos.x + rnd(-0.3, 0.3), pos.y + rnd(0.3, n.h), pos.z + rnd(-0.3, 0.3), 0, 2, 0, 0.5, 0.4, 0.1, 1, 0.6, 0.2, 1, 1, 0.3, 0, 0); if (!n.dead) { n.hp -= dt * 12; n.panic = 5; if (n.hp <= 0) die(n, 'burn', UP); } }
    if (n.fly) {
      if (n.gun) n.gun.group.visible = false;
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
    if (n.angry > 0) n.angry -= dt;
    if (n.cop && copBrain(n, dt, near, d)) continue;
    let goal = null, run = false;
    const target = n.hostile || n.angry > 0 ? huntTarget(n) : null;
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
            else if (target.npc && !target.npc.dead && target.npc.g.position.distanceTo(pos) < 2.6) { NOT_ME = true; hurtNpc(target.npc, dmg * 1.5, _a.subVectors(target.npc.g.position, pos).normalize().multiplyScalar(2), 'slash'); NOT_ME = false; }
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

// ---- cars --------------------------------------------------------------------------------------------
function carSys() { return world.city.carSys; }
const carLeft = (car) => new V3(-Math.sin(car.yaw), 0, -Math.cos(car.yaw)); // the driver's side
function nearestCar() {
  let best = null, bd = 4.6;
  for (const c of carSys().list) { if (c.state === 2 || c.gone || c === P.inCar) continue; const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
function pushOutOfCars(pos, r) {
  for (const c of carSys().list) {
    if (c.gone || c === P.inCar) continue;
    const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z;
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4 || pos.y > c.pos.y + 1.5) continue;
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
  if (P.rag || P.jack) return;
  const z = zipNear(); if (z) { P.zip = { a: z.a, b: z.b, t: 0 }; return; }
  const car = nearestCar();
  if (car) enterCar(car);
}
/** take a car out of traffic so our own physics drives it */
function detachCar(car) {
  const CS = carSys(), sp = car.moving ? car.speed || 0 : 0;
  CS.moving = CS.moving.filter((c) => c !== car);
  if (car.lane) { const i = car.lane.cars.indexOf(car); if (i >= 0) car.lane.cars.splice(i, 1); car.lane = null; }
  car.moving = false; car.curve = null;
  if (!car.collider.cells) car.collider.cells = world.cellRange(car.collider.min.x, car.collider.min.z, car.collider.max.x, car.collider.max.z);
  car.v = car.v || new V3(Math.cos(car.yaw) * sp, 0, -Math.sin(car.yaw) * sp); car.speed = sp; car.vy = 0;
  rolling.delete(car);
}
function enterCar(car) {
  if (P.jack) return;
  const jacked = !!(car.moving || car.driver || car.cop);
  detachCar(car);
  if (!jacked) { seatGoat(car, false); return; }
  car.v.set(0, 0, 0); car.speed = 0;
  const left = carLeft(car), door = car.pos.clone().addScaledVector(left, car.wid / 2 + 0.75);
  door.y = car.pos.y;
  P.jack = { car, t: 0, from: P.pos.clone(), door, left, npc: null, yank: false };
  P.vel.set(0, 0, 0);
  if (P.lick) { P.lick.npc && (P.lick.npc.held = false); P.lick = null; }
}
/** the jack, 0.8 s: step to the door, yank it, drag the driver out by the collar, drop him, get in */
function jackStep(dt) {
  const J = P.jack, car = J.car; J.t += dt;
  const k = Math.min(1, J.t / 0.2);
  P.pos.lerpVectors(J.from, J.door, k * k * (3 - 2 * k));
  P.yaw = Math.atan2(-J.left.x, -J.left.z);
  goat.g.position.copy(P.pos); goat.g.rotation.y = P.yaw;
  if (J.t > 0.2 && !J.yank) {
    J.yank = true; swingAnim('sw_lunge', 0.4); sfx.slap(car.pos);
    if (!car.cop) J.npc = ejectDriver(car, 'drag');
  }
  if (J.npc) {
    const n = J.npc, x = clamp((J.t - 0.25) / 0.35, 0, 1);
    const seat = seatPos(car), out = J.door.clone().addScaledVector(J.left, 1.0);
    n.g.position.lerpVectors(seat, out, x); n.g.position.y = car.pos.y + (1 - x) * DRV_Y + Math.sin(x * Math.PI) * 0.45;
    n.yaw = Math.atan2(J.left.x, J.left.z); n.g.rotation.y = n.yaw;
    if (x >= 1) {
      n.held = false; launchNpc(n, J.left.clone().multiplyScalar(4).setY(2.5)); play(n, 'hit', 0.05);
      hitstop = Math.max(hitstop, 0.06); shake = Math.max(shake, 0.3); sound.impact?.(n.g.position);
      if (Math.random() < 0.4) { n.angry = 25; toast('The driver wants to fight!'); } else n.panic = 15;
      J.npc = null;
    }
  }
  if (J.t >= 0.8) { if (J.npc) { J.npc.held = false; J.npc = null; } P.jack = null; seatGoat(car, true); }
}
function seatGoat(car, jacked) {
  if (car.cop) { WANT.cars = WANT.cars.filter((c) => c !== car); car.cop = null; crime(1); toast('You stole a <b>police cruiser</b>. Bold.', true); }
  P.inCar = car; car.player = true; car.hp = Math.max(car.hp, 220);
  P.vel.set(0, 0, 0); if (P.lick) { P.lick.npc && (P.lick.npc.held = false); P.lick = null; }
  if (jacked) { crime(0.5); addChaos(60, 'CARJACKED'); } else addChaos(20, 'CAR STOLEN');
  toast('<kbd>W</kbd>/<kbd>S</kbd> gas, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake drift, <kbd>Shift</kbd> boost, <kbd>LMB</kbd> drive-by, <kbd>F</kbd> get out', true);
}
function leaveCar() {
  const car = P.inCar; P.inCar = null; car.player = false;
  const left = carLeft(car), sp = Math.hypot(car.v.x, car.v.z);
  P.pos.copy(car.pos).addScaledVector(left, car.wid / 2 + 0.9); P.pos.y = car.pos.y;
  P.yaw = car.yaw + Math.PI / 2;
  if (sp > 8) { // bail out at speed: the goat tumbles, the car keeps rolling
    rolling.add(car);
    startRagdoll(new V3(car.v.x * 0.8 + left.x * 4, 3, car.v.z * 0.8 + left.z * 4));
    addChaos(Math.round(sp * 3), 'BAILED OUT');
  } else { car.v.set(0, 0, 0); car.speed = 0; P.vel.set(0, 0, 0); }
}
function drivePlayer(dt) {
  const car = P.inCar;
  if (car.state === 2) { leaveCar(); hurtPlayer(40, car.pos, 'blast'); return; }
  const thr = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), steer = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  carStep(car, thr, steer, !!keys.Space, !!(keys.ShiftLeft || keys.ShiftRight), dt, true);
  P.pos.copy(car.pos); P.vel.copy(car.v);
  sound.setThrust?.(0.15 + Math.abs(car.speed) / 44 * 0.4, dt);
}
const rolling = new Set();
/** arcade car physics with grip and handbrake drift; used by the goat, the cops and runaway cars */
function carStep(car, thr, steer, brake, boost, dt, mine) {
  const CS = carSys(), top = 44 * (boost ? 1.3 : 1);
  let fx_ = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
  let fs = car.v.x * fx_ + car.v.z * fz;
  const lx = car.v.x - fx_ * fs, lz = car.v.z - fz * fs;
  if (thr > 0) fs = fs < 0 ? fs + 30 * dt : Math.min(top, fs + (boost ? 26 : 17) * dt * (1 - 0.5 * fs / top));
  else if (thr < 0) fs = fs > 0 ? fs - 32 * dt : Math.max(-15, fs - 11 * dt);
  else fs = damp(fs, 0, 0.5, dt);
  if (brake) fs = damp(fs, 0, 1.3, dt);
  const sa = Math.abs(fs);
  car.yaw -= steer * clamp(sa / 5, 0, 1) * (2.1 - clamp(sa / top, 0, 1) * 0.9) * (brake ? 1.6 : 1) * Math.sign(fs || 1) * dt;
  fx_ = Math.cos(car.yaw); fz = -Math.sin(car.yaw);
  const keep = Math.exp(-(brake ? 0.8 : 6) * dt);
  car.v.x = fx_ * fs + lx * keep; car.v.z = fz * fs + lz * keep;
  car.speed = fs;
  const slip = Math.hypot(lx, lz);
  if (slip > 3.5 && sa > 6) {
    for (const s of [-1, 1]) { const rx = car.pos.x - fx_ * car.len * 0.38 + fz * s * car.wid * 0.45, rz = car.pos.z - fz * car.len * 0.38 - fx_ * s * car.wid * 0.45; if (Math.random() < 0.6) fx.smoke.emit(rx, car.pos.y + 0.2, rz, rnd(-0.5, 0.5), rnd(0.3, 1), rnd(-0.5, 0.5), rnd(0.8, 1.6), 0.4, 1.8, 0.85, 0.85, 0.85, 0.55, 0.8, 0.8, 0.8, 0, 0.8, -0.2); }
    if (mine) car.drift = (car.drift || 0) + dt * slip / 6;
  } else if (mine && car.drift) { if (car.drift > 1) addChaos(Math.round(car.drift * 25), 'DRIFT'); car.drift = 0; }
  car.vy = (car.vy || 0) - 25 * dt;
  const prevY = car.pos.y, ox = car.pos.x, oz = car.pos.z;
  const spd = Math.hypot(car.v.x, car.v.z);
  // crashing into buildings knocks holes in them
  if (spd > 9) {
    const dir = new V3(car.v.x / spd, 0, car.v.z / spd);
    const o = new V3(car.pos.x, car.pos.y + 0.8, car.pos.z).addScaledVector(dir, car.len / 2 - 0.2);
    const h = world.raycast(o, dir, spd * dt + 0.6, { targets: true });
    if (h && h.target !== car) {
      const k = spd;
      if (h.target && h.target.kind === 'car') { world.city.damageCar(h.target, k * 1.2, h.point); world.city.damageCar(car, k * 0.4, h.point); }
      else if (h.target) world.damage(h.target, k * 3, h.point);
      D.bullet(h, { radius: 1.2 + k * 0.04, power: k * 22, dir, speed: k * 0.4, chunks: 8 });
      if (k > 20) { D.blast(h.point, 1 + k * 0.05, k * 14); world.damageRadius(h.point, 2 + k * 0.05, k * 2); }
      sound.crunch?.(h.point); fx.sparksBurst(h.point, h.normal, 14, 0xffc070, 12);
      if (mine) { shake = Math.max(shake, k / 60); addChaos(Math.round(k * 2), 'CRASH'); }
      car.v.multiplyScalar(0.45);
      if (k > 30) world.city.damageCar(car, 6, h.point);
    }
  }
  car.pos.x += car.v.x * dt; car.pos.z += car.v.z * dt; car.pos.y += car.vy * dt;
  if (world.resolve(car.pos, 1.2, 1.4, Math.max(prevY, car.pos.y))) { if (spd > 6) { sound.crunch?.(car.pos); fx.sparksBurst(car.pos, UP, 8, 0xffc070, 12); } car.v.multiplyScalar(0.55); }
  const g = world.groundHeight(car.pos.x, car.pos.z, Math.max(prevY, car.pos.y), 0.9);
  if (car.pos.y <= g) { car.pos.y = g; car.vy = 0; }
  // other cars
  for (const c of CS.list) {
    if (c === car || c.gone) continue;
    if (Math.abs(c.pos.x - car.pos.x) > 4 || Math.abs(c.pos.z - car.pos.z) > 4) continue;
    if (Math.hypot(c.pos.x - car.pos.x, c.pos.z - car.pos.z) < 3.1 && spd > 2) {
      world.city.damageCar(c, spd * 1.1, c.pos); if (spd > 15) world.city.damageCar(car, spd * 0.3, car.pos);
      sound.crunch?.(c.pos);
      if (c.v && !c.moving) { c.v.addScaledVector(car.v, 0.6); if (!c.player && !c.cop) rolling.add(c); }
      if (c.moving && c.state === 0) { c.speed = 0; }
      car.v.multiplyScalar(-0.3); car.pos.x = ox; car.pos.z = oz;
      if (mine) { addChaos(Math.round(spd * 3), 'SMASH'); shake = Math.max(shake, spd / 50); }
    }
  }
  // people
  for (const n of npcs) {
    if (n.gone || n.fly || n.held) continue;
    if (Math.abs(n.g.position.y - car.pos.y) < 2 && Math.hypot(n.g.position.x - car.pos.x, n.g.position.z - car.pos.z) < 2 + n.r && spd > 4) {
      const v = car.v.clone().multiplyScalar(0.9).setY(spd * 0.35 + 3);
      NOT_ME = !mine; hurtNpc(n, spd * 4, v, 'blast', n.g.position.clone().setY(n.g.position.y + 1)); NOT_ME = false;
      launchNpc(n, v); if (mine) addChaos(80, 'ROADKILL');
      car.v.multiplyScalar(0.92);
    }
  }
  // the goat on foot
  if (!mine && !P.inCar && !P.rag && P.alive && spd > 5 && Math.abs(P.pos.y - car.pos.y) < 1.5 && inCarBox(car, P.pos, 0.4)) runOver(car.v, spd);
  pushBodies(car.pos, car.v, 2.2, 1.6, 400);
  CS.bounds(car);
  car.collider.min.set(car.min.x, car.pos.y, car.min.z); car.collider.max.set(car.max.x, car.pos.y + 1.8, car.max.z);
  world.moveCollider(car.collider);
  CS.place(car);
}
/** is p within the car's footprint (grown by pad)? */
function inCarBox(c, p, pad) {
  const dx = p.x - c.pos.x, dz = p.z - c.pos.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return Math.abs(dx * cs - dz * sn) < c.len / 2 + pad && Math.abs(dx * sn + dz * cs) < c.wid / 2 + pad;
}
function runOver(v, spd) {
  startRagdoll(new V3(v.x * 0.9, 4 + spd * 0.3, v.z * 0.9));
  hurtPlayer(spd * 1.4, P.pos.clone().sub(v), 'car');
  sound.crunch?.(P.pos); shake = Math.max(shake, 0.5);
}
let trafT = 0;
function updateTraffic(dt) {
  for (const c of rolling) { if (c.player || c.state === 2) { rolling.delete(c); continue; } carStep(c, 0, 0, false, false, dt, false); if (Math.hypot(c.v.x, c.v.z) < 0.3) rolling.delete(c); }
  // traffic doesn't stop for goats
  if (!P.inCar && !P.rag && P.alive) for (const c of carSys().moving) {
    if (c.speed < 3 || Math.abs(c.pos.x - P.pos.x) > 4 || Math.abs(c.pos.z - P.pos.z) > 4) continue;
    if (inCarBox(c, P.pos, 0.35)) { runOver(new V3(Math.cos(c.yaw) * c.speed, 0, -Math.sin(c.yaw) * c.speed), c.speed); c.speed *= 0.3; break; }
  }
}

// ---- drivers: villagers at the wheel of nearby traffic; stealing the car drags them out ----------------
const drivers = [], folkSrc = [], copSrc = [];
function makeDrivers() {
  for (let i = 0; i < 8 && folkSrc.length; i++) {
    const s = folkSrc[i % folkSrc.length], m = setupModel(s.src, s.h);
    m.root.traverse((o) => { if (o.isSkinnedMesh) { o.material = new THREE.MeshStandardMaterial({ map: s.tex, roughness: 0.85 }); o.castShadow = false; } });
    const A = makeActor(m, folkClips); play(A, 'sit', 0);
    m.g.visible = false; scene.add(m.g);
    drivers.push({ ...m, ...A, src: s, car: null });
  }
}
let drvT = 0;
function updateDrivers(dt) {
  if (!drivers.length) return;
  drvT -= dt;
  if (drvT <= 0) {
    drvT = 0.5;
    const pp = P.pos;
    const near = carSys().moving.filter((c) => c.state !== 2).map((c) => [c, Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z)]).filter((x) => x[1] < 75).sort((a, b) => a[1] - b[1]).slice(0, drivers.length).map((x) => x[0]);
    for (const dv of drivers) if (dv.car && !near.includes(dv.car) && !dv.car.cop) { dv.car.driver = null; dv.car = null; dv.g.visible = false; }
    for (const c of near) if (!c.driver) { const dv = drivers.find((d) => !d.car); if (!dv) break; dv.car = c; c.driver = dv; dv.g.visible = true; }
  }
  for (const dv of drivers) {
    const c = dv.car; if (!c) continue;
    if (c.state === 2) { const n = ejectDriver(c, false); if (n) { NOT_ME = true; hurtNpc(n, 999, UP.clone().multiplyScalar(6), 'blast'); NOT_ME = false; } continue; }
    seatPos(c, dv.g.position);
    dv.g.rotation.y = c.yaw + Math.PI / 2;
    dv.mixer.update(dt);
  }
}
let DRV_Y = -0.2;
/** pull whoever is driving out through the driver's door */
let DRV_X = 0.08;
/** the driver's seat in the world */
function seatPos(car, out = new V3()) {
  const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw), lx = DRV_X * car.len, lz = -0.38;
  return out.set(car.pos.x + lx * cy + lz * sy, car.pos.y + DRV_Y, car.pos.z - lx * sy + lz * cy);
}
/** whoever is driving, out of the car: 'drag' leaves him in the seat for the goat to haul out */
function ejectDriver(car, how) {
  const dv = car.driver; car.driver = null;
  const s = dv ? dv.src : folkSrc.length ? pick(folkSrc) : null;
  if (dv) { dv.car = null; dv.g.visible = false; }
  if (!s) return null;
  const left = carLeft(car);
  const n = spawnNpc(s.src, folkClips, 'folk', s.h, s.tex);
  n.indoor = false;
  if (how === 'drag') { seatPos(car, n.g.position); n.held = true; play(n, 'scared', 0.05); }
  else {
    n.g.position.copy(car.pos).addScaledVector(left, car.wid / 2 + 0.5);
    if (how) { launchNpc(n, left.clone().multiplyScalar(4.5).setY(3)); play(n, 'hit', 0.05); n.panic = 15; sound.impact?.(n.g.position); }
  }
  n.home = n.g.position.clone();
  return n;
}

// ---- heat: hurting locals brings the cops ------------------------------------------------------------
const WANT = { heat: 0, level: 0, coolT: 0, seen: false, spawnT: 0, cars: [], sirenT: 0 };
let NOT_ME = false;
function crime(x) {
  if (NOT_ME || !P.alive) return;
  const before = WANT.level;
  WANT.heat = Math.min(5.99, WANT.heat + x); WANT.level = Math.floor(WANT.heat);
  WANT.coolT = 14 + WANT.level * 4;
  if (WANT.level > before) { toast(`<b>HEAT ${'🚨'.repeat(WANT.level)}</b> the cops are coming`, true); sound.alarm?.(); }
}
function updateWanted(dt) {
  const tp = P.inCar ? P.inCar.pos : P.pos;
  const cops = npcs.filter((n) => n.cop && !n.dead && !n.gone);
  WANT.seen = WANT.level > 0 && (cops.some((n) => n.g.position.distanceTo(tp) < 40) || WANT.cars.some((c) => c.pos.distanceTo(tp) < 50));
  if (WANT.seen) WANT.coolT = Math.max(WANT.coolT, 5);
  WANT.coolT -= dt;
  if (WANT.coolT <= 0 && WANT.heat > 0) { WANT.heat = Math.max(0, WANT.heat - dt * 0.3); const lv = Math.floor(WANT.heat); if (lv < WANT.level) { WANT.level = lv; if (!lv) { toast('You lost the cops.', true); addChaos(150, 'ESCAPED'); } } }
  const want = WANT.level ? Math.min(2 + WANT.level * 2, 10) : 0;
  WANT.spawnT -= dt;
  if (cops.length < want && WANT.spawnT <= 0 && copSrc.length) { WANT.spawnT = 1.5; spawnCop(); }
  WANT.cars = WANT.cars.filter((c) => c.cop && c.state !== 2 && !c.player);
  if (WANT.level >= 2 && WANT.cars.length < Math.min(3, WANT.level - 1) && (WANT.dispT = (WANT.dispT || 0) - dt) <= 0) { WANT.dispT = 4; dispatchCopCar(); }
  for (const c of WANT.cars) copCarAI(c, dt);
  // light bars on every police car, chasing or not
  for (const c of carSys().list) if (c.lb) {
    c.lb.visible = c.state !== 2;
    c.lb.position.set(c.pos.x, c.pos.y + 1.47, c.pos.z); c.lb.rotation.y = c.yaw;
    const ph = (T * 8 | 0) % 2, live = !!c.cop;
    c.lb.children[1].material.opacity = live ? (ph ? 1 : 0.1) : 0.12; c.lb.children[2].material.opacity = live ? (ph ? 0.1 : 1) : 0.12;
    c.lb.glow.visible = live; c.lb.glow.material.color.setHex(ph ? 0xff2233 : 0x2a6bff);
  }
  WANT.sirenT -= dt;
  if (WANT.sirenT <= 0 && WANT.cars.some((c) => c.pos.distanceTo(tp) < 60)) { WANT.sirenT = 2.4; sound.alarm?.(); }
}
function spawnCop(at) {
  const s = pick(copSrc);
  let p = at;
  if (!p) {
    for (let i = 0; i < 25 && !p; i++) { const q = pick(TOWN.spots); const d = q.distanceTo(P.pos); if (d > 35 && d < 90) p = q.clone(); }
    if (!p) return null;
  }
  const n = spawnNpc(s.src, folkClips, 'cop', s.h, s.tex);
  n.g.position.copy(p); n.home = p.clone(); n.indoor = false; n.cop = true; n.rush = Math.random() < 0.4; n.shootT = T + rnd(1, 2);
  n.gun = weaponModel('g_pistol_1', 'hand'); n.gun.group.scale.multiplyScalar(0.8); scene.add(n.gun.group);
  return n;
}
function copBrain(n, dt, near, d) {
  if (WANT.level <= 0 || !P.alive) {
    if (d > 110) { n.gone = true; scene.remove(n.g); if (n.gun) scene.remove(n.gun.group); }
    if (n.gun) n.gun.group.visible = false;
    return false;
  }
  const pos = n.g.position, tp = P.inCar ? P.inCar.pos : P.pos;
  const dx = tp.x - pos.x, dz = tp.z - pos.z, dist = Math.hypot(dx, dz);
  let dy = Math.atan2(dx, dz) - n.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); n.yaw += dy * Math.min(1, dt * 8);
  const holdAt = P.inCar ? 9 : n.rush ? 1.3 : 13;
  if (dist > holdAt) {
    const sp = WANT.level >= 3 ? 9.4 : 7.6, px = pos.x, pz = pos.z, py = pos.y;
    pos.x += Math.sin(n.yaw) * sp * dt; pos.z += Math.cos(n.yaw) * sp * dt;
    if (near) { world.resolve(pos, n.r, n.h, py); const g = world.groundHeight(pos.x, pos.z, py, n.r * 0.5); if (g > -1e9 && g < py + 0.75) pos.y = damp(py, g, 20, dt); else if (g < py - 0.1) pos.y = Math.max(g, py - 9 * dt); }
    if (Math.hypot(pos.x - px, pos.z - pz) < sp * dt * 0.3) { n.yaw += rnd(-1.5, 1.5); }
    play(n, 'run', 0.2);
  } else play(n, 'idle', 0.25);
  if (near) n.mixer.update(dt);
  // gun up at the goat
  const tgt = new V3(tp.x, tp.y + 1.2, tp.z);
  if (near && n.g.visible) {
    n.g.rotation.y = n.yaw; n.g.updateMatrixWorld(true);
    if (dist <= holdAt + 4) aimArm(n, 'Right', tgt, 1);
    const hand = n.bones.RightHand;
    if (hand && n.gun) { n.gun.group.visible = true; hand.getWorldPosition(n.gun.group.position); faceDir(n.gun.group, dist <= holdAt + 4 ? _bx.subVectors(tgt, n.gun.group.position).normalize() : _bx.set(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(_q))); }
  } else if (n.gun) n.gun.group.visible = false;
  if (!P.inCar && !P.rag && !P.jack && dist < 1.9 && (n.tackleT || 0) < T) {
    n.tackleT = T + 4; play(n, 'atk', 0.05);
    startRagdoll(new V3(dx / dist * 6, 3.5, dz / dist * 6)); hurtPlayer(10, pos, 'shot');
    toast('<b>TACKLED</b>'); sfx.slap(P.pos); shake = Math.max(shake, 0.35);
  }
  if (dist < 48 && n.shootT < T && !(n.rush && dist < 6)) { n.shootT = T + rnd(0.7, 1.5); copShoot(n, tgt, dist); }
  return true;
}
function copShoot(n, tgt, dist) {
  const o = n.gun && n.gun.group.visible ? n.gun.group.position.clone().addScaledVector(_bx.subVectors(tgt, n.gun.group.position).normalize(), 0.5) : n.g.position.clone().setY(n.g.position.y + 1.4);
  const d = tgt.clone().sub(o).normalize();
  const miss = Math.random() > clamp(0.7 - dist / 70, 0.15, 0.62) || P.rag;
  if (miss) d.add(new V3(rnd(-1, 1), rnd(-0.3, 0.6), rnd(-1, 1)).multiplyScalar(0.07)).normalize();
  const h = world.raycast(o, d, dist + 2, { targets: true });
  let end = dist + 2;
  if (h && (h.dist < dist - 1.2 || miss) && !(P.inCar && h.target === P.inCar)) { end = h.dist; if (h.target) world.damage(h.target, 3, h.point); D.bullet(h, { radius: 0.25, power: 25, dir: d, speed: 3, chunks: 1 }); fx.sparksBurst(h.point, h.normal, 3, 0xffc070, 6); }
  else if (!miss) { end = dist; if (P.inCar) world.city.damageCar(P.inCar, 1.2, tgt); else hurtPlayer(7, o, 'shot'); }
  tracer(o, o.clone().addScaledVector(d, end), 0xffe0a0, 0.025); fx.muzzle(o, d, 0xffc070, 0.3); sound.gun?.(o);
}
const lbMat = (c) => new THREE.SpriteMaterial({ map: glowTex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
let policeTex = null;
function policeDoor() {
  if (!policeTex) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#16203a'; g.fillRect(0, 50, 256, 14);
    g.fillStyle = '#111'; g.font = '900 38px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('POLICE', 128, 27);
    policeTex = new THREE.CanvasTexture(cv); policeTex.colorSpace = THREE.SRGBColorSpace; policeTex.anisotropy = 4;
  }
  return new THREE.MeshStandardMaterial({ map: policeTex, roughness: 0.45 });
}
/** a light bar, white doors and a flashing glow on the road: the car follows along (see updateWanted) */
function lightBar(car) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.12, car.wid * 0.8), 0x15171c));
  const r = new THREE.Sprite(lbMat(0xff2233)), b = new THREE.Sprite(lbMat(0x2a6bff));
  r.position.set(0, 0.12, -car.wid * 0.28); b.position.set(0, 0.12, car.wid * 0.28); r.scale.setScalar(1.5); b.scale.setScalar(1.5);
  g.add(r, b);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff2233, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55, toneMapped: false }));
  glow.position.y = -1.42; g.add(glow); g.glow = glow;
  scene.add(g); car.lb = g;
}
function dispatchCopCar() {
  const tp = P.inCar ? P.inCar.pos : P.pos;
  let best = null, bd = 1e9;
  for (const c of carSys().list) {
    if (c.state !== 0 || c.player || c.cop || c.flat) continue;
    const d = c.pos.distanceTo(tp);
    if (d > 55 && d < 290 && d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  detachCar(best);
  best.cop = { stuck: 0, revT: 0, bailed: false };
  best.police = true; // drawn as a police model
  if (!best.lb) lightBar(best);
  WANT.cars.push(best);
}
function copCarAI(car, dt) {
  const C = car.cop, tp = P.inCar ? P.inCar.pos : P.pos;
  const dx = tp.x - car.pos.x, dz = tp.z - car.pos.z, d = Math.hypot(dx, dz) || 1;
  if (d > 260 || WANT.level < 2) { car.cop = null; return; }
  if (C.bailed && d < 45 && !P.inCar) { carStep(car, 0, 0, true, false, dt, false); return; }
  C.bailed = false;
  const fx_ = Math.cos(car.yaw), fz = -Math.sin(car.yaw);
  const dot = (dx * fx_ + dz * fz) / d, cross = (fx_ * dz - fz * dx) / d;
  let steer = clamp(cross * 3, -1, 1); if (dot < 0) steer = cross >= 0 ? 1 : -1;
  let thr = d > 13 || P.inCar ? 1 : 0, brake = !P.inCar && d < 13;
  if (C.revT > 0) { C.revT -= dt; thr = -1; steer = -steer; brake = false; }
  else if (thr > 0 && Math.abs(car.speed) < 1.5) { C.stuck += dt; if (C.stuck > 1.4) { C.revT = 1.1; C.stuck = 0; } }
  else C.stuck = 0;
  NOT_ME = true; carStep(car, thr, steer, brake, d > 70 || (P.inCar && d < 30), dt, false); NOT_ME = false;
  if (!P.inCar && d < 16 && Math.abs(car.speed) < 2.5) {
    C.bailed = true;
    const left = carLeft(car), cops = npcs.filter((n) => n.cop && !n.dead && !n.gone).length;
    if (cops < 12) for (const s of [1, -1]) spawnCop(car.pos.clone().addScaledVector(left, s * (car.wid / 2 + 0.7)));
  }
}

// ---- minimap ---------------------------------------------------------------------------------------------
let mapCtx = null;
function drawMap() {
  const cv = $('#map'); if (!cv || !TOWN.map) return;
  if (!mapCtx) mapCtx = cv.getContext('2d');
  const g = mapCtx, W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, s = W / 230;
  const fx_ = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
  const px = P.pos.x, pz = P.pos.z, M = TOWN.map;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#34482f'; g.fillRect(0, 0, W, H);
  g.setTransform(s * rx, -s * fx_, s * rz, -s * fz, cx - s * (rx * px + rz * pz), cy + s * (fx_ * px + fz * pz));
  g.fillStyle = '#8d8c86'; for (const c of M.grid) { g.fillRect(c - M.rw - 3.5, -M.edge, 2 * (M.rw + 3.5), 2 * M.edge); g.fillRect(-M.edge, c - M.rw - 3.5, 2 * M.edge, 2 * (M.rw + 3.5)); }
  g.fillStyle = '#3d3d43'; for (const c of M.grid) { g.fillRect(c - M.rw, -M.edge, 2 * M.rw, 2 * M.edge); g.fillRect(-M.edge, c - M.rw, 2 * M.edge, 2 * M.rw); }
  g.fillStyle = '#5c8a4a'; for (const p of TOWN.parks) g.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);
  g.fillStyle = '#d9d2c2'; for (const b of TOWN.foot) g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const dot = (x, z, col, r) => { const dx = x - px, dz = z - pz, u = cx + s * (rx * dx + rz * dz), v = cy - s * (fx_ * dx + fz * dz); if (u < -5 || v < -5 || u > W + 5 || v > H + 5) return; g.fillStyle = col; g.beginPath(); g.arc(u, v, r, 0, 7); g.fill(); };
  for (const pk of pickups) if (!pk.taken) dot(pk.pos.x, pk.pos.z, '#ffd23f', 2.6);
  const blink = (T * 6 | 0) % 2;
  for (const n of npcs) if (!n.dead && !n.gone && (n.hostile || n.cop)) dot(n.g.position.x, n.g.position.z, n.cop ? (blink ? '#3a7bff' : '#ff3344') : '#e8553e', n.cop ? 3.2 : 2.2);
  for (const c of WANT.cars) dot(c.pos.x, c.pos.z, blink ? '#ff3344' : '#3a7bff', 4.5);
  // the goat: an arrow pointing where he faces
  const a = (P.inCar ? P.inCar.yaw + Math.PI / 2 : P.yaw) - camYaw, ux = -Math.sin(a), uy = -Math.cos(a);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath();
  g.moveTo(cx + ux * 8, cy + uy * 8); g.lineTo(cx - ux * 5 - uy * 5, cy - uy * 5 + ux * 5); g.lineTo(cx - ux * 2, cy - uy * 2); g.lineTo(cx - ux * 5 + uy * 5, cy - uy * 5 - ux * 5); g.closePath(); g.fill(); g.stroke();
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
  if (from) { INV.equip[from] = null; unmount(it); const other = INV.equip[slotId]; if (other) { unmount(other); INV.equip[slotId] = null; if (allowed(other.w, SLOTS.find((x) => x.id === from))) { INV.equip[from] = other; mount(other, from); } else INV.bag.push(other); } INV.equip[slotId] = it; mount(it, slotId); }
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
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 1; }
  updatePlayer(dt);
  updateCamera(dt);
  placeWeapons();
  triggers(dt);
  updateShots(dt);
  updateFlames(dt);
  updateNpcs(dt);
  updateLick(dt);
  updateTraffic(dt);
  updateWanted(dt);
  updatePhysics(dt);
  updateTracers(dt);
  updatePools(dt);
  for (const pk of pickups) if (!pk.taken) { pk.g.rotation.y += dt * 1.5; pk.g.children[0].position.y = Math.sin(T * 2 + pk.pos.x) * 0.12; }
  world.update(dt, P.inCar ? P.inCar.pos : P.pos, { grounded: false, vel: P.vel, feet: [], camera });
  updateDrivers(dt);
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
  if (!started) { started = true; sound.unlock?.(); toast('Welcome to Goatsville. Grab a blade from the gold lights, or just headbutt things.', true); }
  canvas.requestPointerLock?.()?.catch?.(() => {});
});
$('#bhelp')?.addEventListener('click', () => { $('#help').style.display = 'flex'; document.exitPointerLock?.(); });
$('#binv')?.addEventListener('click', () => toggleInv());
window.G3 = { snap(name = 'snap') { renderer.setSize(960, 540, false); camera.aspect = 960 / 540; camera.updateProjectionMatrix(); updateCamera(0); renderer.render(scene, camera); const u = canvas.toDataURL('image/jpeg', 0.7); resize(); return fetch('http://127.0.0.1:8399/' + name, { method: 'POST', body: u }).then(() => u.length); }, step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { last = performance.now() - dt * 1000; frame(performance.now()); } }, P, npcs, INV, WD, explode, equipTo, newItem, toggleInv, get world() { return world; }, get D() { return D; }, get phys() { return phys; }, TOWN, camera, renderer, scene, enterCar, nearestCar, interact, get chaos() { return chaos; }, get goat() { return goat; }, get started() { return started; }, keys, mouse, pickups, get mats() { return mats; }, weaponModel, WANT, crime, carSys, drivers, spawnCop, startRagdoll, ejectDriver, get combo() { return combo; }, setCam(y, p, d) { camYaw = y; camPitch = p; if (d) camDist = d; } };
boot().catch((e) => { console.error(e); loadMsg('Failed to load: ' + e.message); });
