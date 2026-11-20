// The starting town for 3D mode, built with vectorclad's City builders (vc/js/city.js) so every
// building is a destructible owner for its voxel engine (vc/js/destruct). One unit is one meter.
// Buildings are made of solid pieces (walls per storey, floor slabs, stair steps, partitions,
// furniture) so the inside is real: rooms, corridors and stairs up to the roof.
import * as THREE from 'three';
import { cell } from './vc/js/city.js';

const V3 = THREE.Vector3;
let C = null;           // the City being built
const INFO = { foot: [], spawn: new V3(0, 0, 18), pickups: [], spots: [], indoor: [], ramps: [], bounce: [], parks: [], parking: [], names: [] };
let seed = 7;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * ((seed - 1) / 2147483646); };
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const W = [1, 1, 1];

// ---- faces ------------------------------------------------------------------------------------
// A face spec: [tile, tileW, tileH, v0] (v0 lines a storey's tile up with its floor)
const tm = (t) => (/^store/.test(t) ? 4.2 : /^sky|^rf/.test(t) ? 4 : /^walls1/.test(t) ? 2.4 : /^walls5/.test(t) ? 2.8 : /^walls/.test(t) ? 3.2 : /^roof/.test(t) ? 6 : 3);
const F = (t, w, h, v0) => [t, w ?? tm(t), h ?? tm(t), v0 ?? 0];

function wallFace(spec, ax, az, bx, bz, y0, y1, tint) {
  const [t, tw, th, v0] = spec;
  C.wall(C.bufFor(t), t, ax, az, bx, bz, y0, y1, tw, th, { ao: false, v0, tint: tint || W });
}
function topFace(t, x0, z0, x1, z1, y, ts = tm(t), tint) {
  C.flat(C.bufFor(t), t, x0, z0, x1, z1, y, (x, z) => [x / ts, -z / ts], 0, tint || W);
}
function botFace(t, x0, z0, x1, z1, y, ts = tm(t)) {
  const Q = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  C.quad(C.bufFor(t), Q, [0, -1, 0], Q.map((p) => [p[0] / ts, p[2] / ts]), cell(t), [0.8, 0.8, 0.8]);
}
/**
 * A solid box piece: drawn, solid for the voxel engine and a collider for feet.
 * f: { px, nx, pz, nz, top, bot } face specs (null = not drawn), mat: voxel material.
 */
function piece(x0, y0, z0, x1, y1, z1, f, mat = 'concrete', extra) {
  if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
  C.vol({ t: 'solid', x0, x1, z0, z1, y0, y1, mat });
  C.collide(x0, y0, z0, x1, y1, z1, extra);
  if (f.px) wallFace(f.px, x1, z1, x1, z0, y0, y1);
  if (f.nx) wallFace(f.nx, x0, z0, x0, z1, y0, y1);
  if (f.pz) wallFace(f.pz, x0, z1, x1, z1, y0, y1);
  if (f.nz) wallFace(f.nz, x1, z0, x0, z0, y0, y1);
  if (f.top) topFace(f.top[0], x0, z0, x1, z1, y1, f.top[1]);
  if (f.bot) botFace(f.bot[0], x0, z0, x1, z1, y0, f.bot[1]);
}
const all = (s, top, bot) => ({ px: s, nx: s, pz: s, nz: s, top: top || [s[0], s[1]], bot: bot || null });

// ---- props (vertex-colored shapes, destructible with their building) -------------------------------
const box = (x, y, z, sx, sy, sz, col, ry = 0) => C.prop('box', x, y + sy / 2, z, sx, sy, sz, col, ry);
const cyl = (x, y, z, r, h, col) => C.prop('cyl', x, y + h / 2, z, r, h, r, col);
const COL = {
  wood: [0.45, 0.3, 0.18], dark: [0.12, 0.12, 0.13], metal: [0.55, 0.57, 0.6], white: [0.92, 0.92, 0.9], red: [0.75, 0.12, 0.1],
  blue: [0.15, 0.3, 0.7], green: [0.2, 0.55, 0.25], yellow: [0.95, 0.75, 0.1], orange: [0.95, 0.45, 0.1], tan: [0.75, 0.62, 0.45],
  black: [0.04, 0.04, 0.05], glass: [0.3, 0.45, 0.5], cream: [0.9, 0.85, 0.72], light: [1.6, 1.6, 1.5], steel: [0.35, 0.37, 0.4],
};
const ITEM_COLS = [COL.red, COL.blue, COL.green, COL.yellow, COL.orange, COL.white, [0.6, 0.2, 0.6], [0.9, 0.5, 0.6], [0.4, 0.25, 0.1]];

// ---- buildings -------------------------------------------------------------------------------
/**
 * spec: x0,z0,x1,z1 footprint; n storeys of fh meters; ext: [ground tile, upper tile] facade kits;
 * solid: tile for blank wall; inner: plaster tile; floor: floor tile; mat: outer wall voxel material;
 * doors: [{ side: 'n'|'s'|'e'|'w', at: 0..1, w }]; plan: 'corridor'|'open'|'house'|'rooms';
 * furnish(storey, room) to dress rooms; roof: roof tile; name.
 */
function building(S) {
  const { x0, z0, x1, z1, n, fh } = S;
  const T = 0.3, SL = 0.3; // wall thickness, slab thickness
  const inner = F(S.inner || 'walls20', 3.2, 3.2), floorT = S.floor || 'paveB10', ceil = S.ceil || 'walls02';
  C.beginOwner('building');
  INFO.names.push({ name: S.name, x: (x0 + x1) / 2, z: (z0 + z1) / 2, top: n * fh });
  INFO.foot.push({ x0, z0, x1, z1 });
  topFace(S.floor || 'paveB10', x0 + 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, 0.03, 3);
  // Stairwell along one side: two lanes of 1.4 m, flights between 1.3 m landings at both ends
  const SW = 3.0, SLn = S.stairLen || Math.min(8.5, (z1 - z0) - 2 * T - 0.5);
  const sx0 = S.stairX ?? x0 + T, sx1 = sx0 + SW, sz0 = z0 + T, sz1 = sz0 + SLn;
  const L = 1.3, run0 = sz0 + L, run1 = sz1 - L;
  const hasStairs = n > 1 || S.roofAccess;
  const doorsOn = (side) => (S.doors || []).filter((d) => d.side === side);
  for (let k = 0; k < n; k++) {
    const y0 = k * fh, y1 = (k + 1) * fh - SL;
    const ext = F(k === 0 ? S.ext[0] : S.ext[1], k === 0 && /^store/.test(S.ext[0]) ? 4.2 : 4, y1 - y0 + SL);
    // outer walls with door gaps on the ground floor
    const runWall = (side) => {
      const horiz = side === 'n' || side === 's';
      const a0 = horiz ? x0 : z0 + T, a1 = horiz ? x1 : z1 - T, c = side === 'n' ? z0 : side === 's' ? z1 - T : side === 'w' ? x0 : x1 - T;
      const gaps = k === 0 ? doorsOn(side).map((d) => { const m = a0 + (a1 - a0) * d.at; return [m - d.w / 2, m + d.w / 2, d.h || 3]; }) : [];
      gaps.sort((p, q) => p[0] - q[0]);
      let a = a0;
      const seg = (s0, s1, ya, yb) => {
        if (s1 - s0 < 0.05) return;
        const out = side === 'n' ? { nz: ext } : side === 's' ? { pz: ext } : side === 'w' ? { nx: ext } : { px: ext };
        const inn = side === 'n' ? { pz: inner } : side === 's' ? { nz: inner } : side === 'w' ? { px: inner } : { nx: inner };
        const f = Object.assign({}, out, inn, { top: null });
        if (yb >= y1 - 1e-3 && k === n - 1) f.top = ['walls02', 3];
        if (horiz) piece(s0, ya, c, s1, yb, c + T, f, S.mat);
        else piece(c, ya, s0, c + T, yb, s1, f, S.mat);
      };
      for (const [g0, g1, gh] of gaps) {
        seg(a, g0, y0, y1);
        seg(g0, g1, y0 + gh, y1); // lintel
        a = g1;
        // door frame posts so the gap reads as a door
        const mid = (g0 + g1) / 2;
        if (horiz) INFO.spots.push(new V3(mid, 0, side === 'n' ? z0 - 2 : z1 + 2));
        else INFO.spots.push(new V3(side === 'w' ? x0 - 2 : x1 + 2, 0, mid));
      }
      seg(a, a1, y0, y1);
    };
    for (const s of ['n', 's', 'w', 'e']) runWall(s);
    // floor slab above this storey (the roof on the top one), with the stairwell open
    const yS = y1, ySt = y1 + SL, roof = k === n - 1;
    const slabF = { px: F('walls02', 3, SL), nx: F('walls02', 3, SL), pz: F('walls02', 3, SL), nz: F('walls02', 3, SL), top: [roof ? (S.roof || 'roof00') : floorT, roof ? 6 : 3], bot: [ceil, 3] };
    const hole = hasStairs && (!roof || S.roofAccess !== false) ? [sx0, run0, sx1, run1] : null;
    slab(x0, z0, x1, z1, yS, ySt, hole, slabF);
    if (roof) {
      // parapet
      const ph = 1.1, pf = F(S.parapet || 'walls02', 3, ph);
      piece(x0, ySt, z0, x1, ySt + ph, z0 + 0.25, all(pf), S.mat);
      piece(x0, ySt, z1 - 0.25, x1, ySt + ph, z1, all(pf), S.mat);
      piece(x0, ySt, z0 + 0.25, x0 + 0.25, ySt + ph, z1 - 0.25, all(pf), S.mat);
      piece(x1 - 0.25, ySt, z0 + 0.25, x1, ySt + ph, z1 - 0.25, all(pf), S.mat);
      INFO.pickups.push(new V3((x0 + x1) / 2 + 3, ySt, (z0 + z1) / 2));
    }
    // stairs: lane A (west half) goes south on even storeys, lane B north on odd ones
    if (hasStairs && (k < n - 1 || S.roofAccess !== false)) {
      const lane = k % 2, lx0 = sx0 + (lane ? SW / 2 : 0), lx1 = lx0 + SW / 2 - 0.1;
      const rise = fh, steps = Math.max(8, Math.round(rise / 0.2)), dr = rise / steps, dz = (run1 - run0) / steps;
      for (let i = 0; i < steps; i++) {
        const yt = y0 + dr * (i + 1);
        const za = lane ? run1 - dz * (i + 1) : run0 + dz * i, zb = za + dz;
        piece(lx0, y0 + Math.max(0, dr * i - 0.35), za, lx1, yt, zb, { px: inner, nx: inner, pz: inner, nz: inner, top: ['paveB20', 1.5], bot: [ceil, 3] }, 'concrete', { stair: true });
      }
      // divider between the lanes
      piece(sx0 + SW / 2 - 0.1, y0, run0 + 0.3, sx0 + SW / 2, y0 + 1.1, run1 - 0.3, all(inner), 'panel');
      // the stair core walls on the open side, with a door to the floor
      if (!S.openStairs) {
        const cx = sx1, door = 1.4;
        piece(cx, y0, sz0, cx + 0.2, y1, sz0 + 0.2, all(inner), 'concrete');
        piece(cx, y0, sz0 + 0.2 + door, cx + 0.2, y1, sz1, all(inner), 'concrete');
        piece(cx, y0 + 2.4, sz0 + 0.2, cx + 0.2, y1, sz0 + 0.2 + door, all(inner), 'concrete');
        piece(sx0, y0, sz1, cx + 0.2, y1, sz1 + 0.2, all(inner), 'concrete');
      }
    }
    // inside: partitions and furniture
    const R = { x0: x0 + T, z0: z0 + T, x1: x1 - T, z1: z1 - T, y: y0, h: y1 - y0, k };
    const skipX = hasStairs && !S.openStairs ? sx1 + 0.2 : x0 + T;
    if (S.plan === 'corridor') corridorPlan(S, R, skipX, inner);
    else if (S.plan === 'house') housePlan(S, R, skipX, inner);
    else if (S.plan === 'open' && S.furnish) S.furnish(R);
    INFO.indoor.push({ x0: R.x0 + 1, z0: R.z0 + 1, x1: R.x1 - 1, z1: R.z1 - 1, y: y0, name: S.name });
    if (rnd() < 0.7) INFO.pickups.push(new V3(rnd(skipX + 1, R.x1 - 1), y0, rnd(R.z0 + 1, R.z1 - 1)));
  }
  // roof stair housing
  if (S.roofAccess !== false && hasStairs) {
    const y0 = n * fh, y1 = y0 + 2.8, inn = F('walls02', 3, 3);
    const ex = all(F(S.parapet || 'walls02', 3, 3));
    piece(sx0 - 0.25, y0, sz0 - 0.25, sx1 + 0.25, y1, sz0, ex, 'concrete');
    piece(sx0 - 0.25, y0, sz1, sx1 + 0.25, y1, sz1 + 0.25, ex, 'concrete');
    piece(sx0 - 0.25, y0, sz0, sx0, y1, sz1, ex, 'concrete');
    piece(sx1, y0, sz0, sx1 + 0.25, y1, sz0 + 0.2, ex, 'concrete');
    piece(sx1, y0 + 2.3, sz0 + 0.2, sx1 + 0.25, y1, sz0 + 1.6, ex, 'concrete');
    piece(sx1, y0, sz0 + 1.6, sx1 + 0.25, y1, sz1, ex, 'concrete');
    piece(sx0 - 0.25, y1, sz0 - 0.25, sx1 + 0.25, y1 + 0.25, sz1 + 0.25, { ...ex, top: ['roof00', 6] }, 'concrete');
    void inn;
  }
  if (S.extra) S.extra();
  C.endOwner();
}

/** A rectangle slab with an optional rectangular hole, as up to four pieces */
function slab(x0, z0, x1, z1, y0, y1, hole, f) {
  if (!hole) return piece(x0, y0, z0, x1, y1, z1, f, 'concrete');
  const [hx0, hz0, hx1, hz1] = hole;
  piece(x0, y0, z0, x1, y1, hz0, f, 'concrete');
  piece(x0, y0, hz1, x1, y1, z1, f, 'concrete');
  piece(x0, y0, hz0, hx0, y1, hz1, f, 'concrete');
  piece(hx1, y0, hz0, x1, y1, hz1, f, 'concrete');
}

/** An interior wall from a to b along x or z, with door gaps (centers along it, 1.2 m) */
function partition(ax, az, bx, bz, y, h, doors, inner, mat = 'panel') {
  const t = 0.18, horiz = Math.abs(bz - az) < 1e-6;
  const a0 = horiz ? Math.min(ax, bx) : Math.min(az, bz), a1 = horiz ? Math.max(ax, bx) : Math.max(az, bz);
  const cs = horiz ? az : ax;
  let a = a0;
  const f = all(inner);
  const seg = (s0, s1, ya, yb) => {
    if (s1 - s0 < 0.05) return;
    if (horiz) piece(s0, ya, cs - t / 2, s1, yb, cs + t / 2, f, mat);
    else piece(cs - t / 2, ya, s0, cs + t / 2, yb, s1, f, mat);
  };
  for (const d of [...doors].sort((p, q) => p - q)) {
    seg(a, d - 0.6, y, y + h);
    seg(d - 0.6, d + 0.6, y + 2.3, y + h);
    a = d + 0.6;
  }
  seg(a, a1, y, y + h);
}

/** Classrooms or offices off a corridor down the long axis */
function corridorPlan(S, R, skipX, inner) {
  const cw = 3.2, zc = (R.z0 + R.z1) / 2, za = zc - cw / 2, zb = zc + cw / 2;
  const roomW = S.roomW || 9;
  const x0 = skipX, len = R.x1 - x0;
  const nr = Math.max(1, Math.round(len / roomW)), rw = len / nr;
  // corridor walls with a door into each room
  const doorsA = [], doorsB = [];
  for (let i = 0; i < nr; i++) { const m = x0 + rw * (i + 0.5); doorsA.push(m + rw * 0.25); doorsB.push(m - rw * 0.25); }
  // where the corridor meets the stair core and the outer doors, leave it open
  partition(x0, za, R.x1, za, R.y, R.h, doorsA, inner);
  partition(x0, zb, R.x1, zb, R.y, R.h, doorsB, inner);
  for (let i = 1; i < nr; i++) {
    const x = x0 + rw * i;
    partition(x, R.z0, x, za - 0.09, R.y, R.h, [], inner);
    partition(x, zb + 0.09, x, R.z1, R.y, R.h, [], inner);
  }
  // lockers down the corridor in schools
  if (S.kind === 'school') {
    for (let x = x0 + 1.5; x < R.x1 - 1.5; x += 0.55) if (Math.abs(((x - x0) % rw) - rw * 0.25) > 1 && Math.abs(((x - x0) % rw) - rw * 0.75) > 1) box(x, R.y, za + 0.35, 0.5, 1.9, 0.45, S.locker || COL.blue);
  }
  for (let i = 0; i < nr; i++) {
    const rx0 = x0 + rw * i + 0.2, rx1 = x0 + rw * (i + 1) - 0.2;
    if (S.furnish) { S.furnish({ ...R, x0: rx0, x1: rx1, z0: R.z0, z1: za - 0.2, face: 1 }); S.furnish({ ...R, x0: rx0, x1: rx1, z0: zb + 0.2, z1: R.z1, face: -1 }); }
  }
}

function housePlan(S, R, skipX, inner) {
  const xm = (Math.max(skipX, R.x0) + R.x1) / 2, zm = (R.z0 + R.z1) / 2;
  partition(xm, R.z0, xm, R.z1, R.y, R.h, [zm - 1.5, zm + 1.5].filter((z) => z > R.z0 + 1 && z < R.z1 - 1), inner);
  partition(xm, zm, R.x1, zm, R.y, R.h, [(xm + R.x1) / 2], inner);
  const rooms = [
    { x0: Math.max(skipX, R.x0) + 0.2, x1: xm - 0.2, z0: R.z0 + 0.2, z1: R.z1 - 0.2 },
    { x0: xm + 0.2, x1: R.x1 - 0.2, z0: R.z0 + 0.2, z1: zm - 0.2 },
    { x0: xm + 0.2, x1: R.x1 - 0.2, z0: zm + 0.2, z1: R.z1 - 0.2 },
  ];
  rooms.forEach((r, i) => homeRoom({ ...R, ...r }, R.k === 0 ? ['living', 'kitchen', 'dining'][i] : ['bed', 'bed', 'bath'][i]));
}

// ---- furniture ---------------------------------------------------------------------------------
function homeRoom(r, kind) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, y = r.y;
  if (r.x1 - r.x0 < 2 || r.z1 - r.z0 < 2) return;
  if (kind === 'living') {
    box(cx, y, r.z0 + 0.6, 2.2, 0.8, 0.9, pick([COL.blue, COL.red, COL.tan, COL.green])); // sofa
    box(cx, y + 0.8, r.z0 + 0.25, 2.2, 0.5, 0.2, COL.dark);
    box(cx, y, cz, 1.2, 0.45, 0.7, COL.wood); // coffee table
    box(cx, y, r.z1 - 0.3, 1.6, 0.6, 0.4, COL.dark); box(cx, y + 0.6, r.z1 - 0.3, 1.4, 0.8, 0.08, COL.black); // tv
    box(r.x0 + 0.4, y, r.z1 - 0.4, 0.5, 1.8, 0.5, COL.green); // plant/lamp
  } else if (kind === 'kitchen') {
    for (let x = r.x0 + 0.4; x < r.x1 - 0.3; x += 0.62) box(x, y, r.z0 + 0.35, 0.6, 0.9, 0.6, COL.white);
    box(r.x1 - 0.5, y, r.z1 - 0.5, 0.8, 1.9, 0.7, COL.metal); // fridge
    box(cx, y, cz + 0.3, 1.0, 0.9, 1.0, COL.wood);
  } else if (kind === 'dining') {
    box(cx, y, cz, 1.8, 0.75, 1.0, COL.wood);
    for (const [dx, dz] of [[-0.6, -0.8], [0.6, -0.8], [-0.6, 0.8], [0.6, 0.8]]) box(cx + dx, y, cz + dz, 0.45, 0.9, 0.45, COL.wood);
  } else if (kind === 'bed') {
    box(cx, y, r.z0 + 1.1, 1.6, 0.55, 2.0, pick([COL.white, COL.blue, [0.8, 0.5, 0.6]]));
    box(cx, y, r.z0 + 0.1, 1.7, 1.0, 0.15, COL.wood);
    box(r.x1 - 0.4, y, r.z1 - 0.4, 0.6, 1.9, 0.6, COL.wood); // wardrobe
  } else if (kind === 'bath') {
    box(r.x0 + 0.5, y, r.z0 + 0.9, 0.8, 0.6, 1.7, COL.white);
    box(r.x1 - 0.4, y, r.z1 - 0.4, 0.5, 0.8, 0.6, COL.white);
  }
}
function classroom(r) {
  if (r.x1 - r.x0 < 3) return;
  const y = r.y, fz = r.face > 0 ? r.z0 + 0.25 : r.z1 - 0.25;
  box((r.x0 + r.x1) / 2, y + 0.9, fz, Math.min(5, r.x1 - r.x0 - 1), 1.2, 0.06, [0.1, 0.25, 0.15]); // board
  box(r.x0 + 1.2, y, fz + r.face * 1.2, 1.4, 0.75, 0.7, COL.wood); // teacher
  for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 3; iz++) {
    const x = r.x0 + 1.2 + ix * ((r.x1 - r.x0 - 2.2) / 3), z = fz + r.face * (2.6 + iz * 1.15);
    if ((z - r.z0) < 0.4 || (r.z1 - z) < 0.4) continue;
    box(x, y, z, 0.7, 0.72, 0.5, COL.tan); box(x, y, z + r.face * 0.45, 0.4, 0.45, 0.4, COL.blue);
  }
}
function office(r) {
  if (r.x1 - r.x0 < 3) return;
  const y = r.y;
  for (let x = r.x0 + 1.2; x < r.x1 - 1; x += 2.4) for (let z = r.z0 + 1.2; z < r.z1 - 1; z += 2.4) {
    box(x, y, z, 1.5, 0.75, 0.8, COL.white); box(x, y + 0.75, z - 0.2, 0.55, 0.4, 0.05, COL.black); box(x, y, z + 0.6, 0.5, 0.95, 0.5, COL.dark);
  }
  box(r.x1 - 0.4, y, r.z0 + 0.4, 0.5, 1.2, 0.5, COL.green);
}

// ---- ground and roads ---------------------------------------------------------------------------
const GRID = [-210, -70, 70, 210], RW = 8, WALK = 3.5, EDGE = 250;
INFO.map = { grid: GRID, rw: RW, edge: EDGE };
function ground() {
  const g = (t, x0, z0, x1, z1, y, ts) => C.flat(C.groundBuf(t), t, x0, z0, x1, z1, y, (x, z) => [x / ts, -z / ts]);
  // grass over everything, roads and sidewalks over it
  g('grass00', -EDGE, -EDGE, EDGE, EDGE, 0, 11);
  for (const c of GRID) {
    g('asphalt00', c - RW, -EDGE, c + RW, EDGE, 0.02, 8);
    g('asphalt00', -EDGE, c - RW, EDGE, c + RW, 0.021, 8);
    for (const s of [-1, 1]) {
      g('paveB00', c + s * RW - (s > 0 ? 0 : WALK), -EDGE, c + s * RW + (s > 0 ? WALK : 0), EDGE, 0.03, 3);
      g('paveB00', -EDGE, c + s * RW - (s > 0 ? 0 : WALK), EDGE, c + s * RW + (s > 0 ? WALK : 0), 0.031, 3);
    }
    // center lines
    C.flat(C.groundBuf('asphalt24', true), 'asphalt24', c - 0.6, -EDGE, c + 0.6, EDGE, 0.04, (x, z) => [(x - c + 0.6) / 1.2, -z / 8], 0);
    C.flat(C.groundBuf('asphalt24', true), 'asphalt24', -EDGE, c - 0.6, EDGE, c + 0.6, 0.041, (x, z) => [(z - c + 0.6) / 1.2, x / 8], 0);
  }
  for (const c of GRID) for (const d of GRID) {
    // street lamps at corners (destructible poles)
    for (const [sx, sz] of [[1, 1], [-1, -1]]) {
      const x = c + sx * (RW + 0.8), z = d + sz * (RW + 0.8);
      C.beginOwner('lamp');
      C.prop('pole', x, 3.5, z, 0.1, 7, 0.1, COL.steel);
      C.prop('box', x - sx * 0.9, 7, z, 1.8, 0.15, 0.3, COL.steel);
      C.prop('box', x - sx * 1.6, 6.85, z, 0.6, 0.12, 0.35, COL.light);
      C.endOwner();
    }
  }
  // street trees along every road
  for (const c of GRID) for (let t = -EDGE + 10; t < EDGE - 10; t += 16) {
    if (GRID.some((d) => Math.abs(t - d) < 14)) continue;
    for (const s of [-1, 1]) {
      C.treeSpots.push({ x: c + s * (RW + WALK + 1.5), y: 0, z: t, scale: 0.8 + rnd() * 0.3, species: pick(['oak', 'maple', 'elm', 'beech', 'linden']), seed: Math.floor(rnd() * 1e9) });
      C.treeSpots.push({ x: t, y: 0, z: c + s * (RW + WALK + 1.5), scale: 0.8 + rnd() * 0.3, species: pick(['oak', 'maple', 'elm', 'birch']), seed: Math.floor(rnd() * 1e9) });
    }
  }
  // sidewalk spots for people
  for (const c of GRID) for (let t = -EDGE + 20; t < EDGE - 20; t += 9) {
    INFO.spots.push(new V3(c + RW + 1.7, 0, t), new V3(t, 0, c - RW - 1.7));
  }
}

// ---- the town ---------------------------------------------------------------------------------
function towers() {
  const T = [
    { name: 'Meridian Tower', x0: -54, z0: -54, x1: -24, z1: -26, n: 12, ext: ['store18_00', 'sky12_00'], mat: 'glass', roof: 'roof01' },
    { name: 'Harbor Trust', x0: 24, z0: -54, x1: 54, z1: -28, n: 9, ext: ['store11_00', 'sky01_00'], mat: 'panel', roof: 'roof03' },
    { name: 'Limestone Court', x0: -54, z0: 26, x1: -26, z1: 54, n: 7, ext: ['store07_00', 'sky15_00'], mat: 'stone', roof: 'roof00' },
    { name: 'Copper Works', x0: 26, z0: 28, x1: 54, z1: 54, n: 5, ext: ['store14_00', 'sky10_00'], mat: 'concrete', roof: 'roof02' },
  ];
  for (const t of T) {
    building({ ...t, fh: 4, plan: 'corridor', roomW: 7, furnish: office, inner: 'walls20', floor: 'paveB10', ceil: 'walls02', parapet: 'walls03',
      doors: [{ side: t.z0 < 0 ? 's' : 'n', at: 0.55, w: 2.6 }, { side: t.x0 < 0 ? 'e' : 'w', at: 0.5, w: 2.4 }] });
  }
  // plaza: paved square, benches and lamps around the fountain
  C.flat(C.groundBuf('paveB10'), 'paveB10', -20, -20, 20, 20, 0.02, (x, z) => [x / 3, -z / 3]);
  for (const [x, z, ry] of [[-8, 0, 0], [8, 0, 0], [0, -8, Math.PI / 2], [0, 8, Math.PI / 2]]) {
    C.prop('box', x, 0.45, z, ry ? 0.6 : 2.2, 0.1, ry ? 2.2 : 0.6, COL.wood); C.prop('box', x, 0.22, z, ry ? 0.5 : 2, 0.44, ry ? 2 : 0.5, COL.steel);
  }
  for (const [x, z] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) { C.prop('pole', x, 2.2, z, 0.08, 4.4, 0.08, COL.steel); C.prop('box', x, 4.5, z, 0.5, 0.25, 0.5, COL.light); }
  // plaza: fountain and planters
  C.beginOwner('fountain');
  cyl(0, 0, 0, 5, 0.6, [0.6, 0.6, 0.62]); cyl(0, 0.6, 0, 4.4, 0.05, [0.2, 0.45, 0.6]); cyl(0, 0, 0, 0.6, 3, [0.6, 0.6, 0.62]); cyl(0, 3, 0, 1.6, 0.3, [0.6, 0.6, 0.62]);
  C.endOwner();
  for (const [x, z] of [[-14, -14], [14, -14], [-14, 14], [14, 14]]) C.treeSpots.push({ x, y: 0, z, scale: 1.1, species: 'oak', seed: Math.floor(rnd() * 1e9) });
}

function bank() {
  building({
    name: 'First Goat Bank', x0: -194, z0: -46, x1: -160, z1: -16, n: 2, fh: 5.5, ext: ['store20_00', 'sky20_00'], mat: 'stone', roof: 'roof00', parapet: 'walls51',
    inner: 'walls22', floor: 'paveB12', plan: 'open', doors: [{ side: 's', at: 0.6, w: 3 }],
    furnish(R) {
      if (R.k === 0) {
        for (let x = R.x0 + 8; x < R.x1 - 3; x += 2.2) { box(x, R.y, R.z0 + 9, 2, 1.1, 0.7, COL.wood); box(x, R.y + 1.1, R.z0 + 9, 2, 0.9, 0.05, COL.glass); }
        // the vault: steel box with a round door
        piece(R.x1 - 9, R.y, R.z0 + 0.2, R.x1 - 0.2, R.y + 3.2, R.z0 + 0.6, all(F('walls47', 2.8, 2.8)), 'steel');
        piece(R.x1 - 9, R.y, R.z0 + 0.6, R.x1 - 8.6, R.y + 3.2, R.z0 + 6, all(F('walls47', 2.8, 2.8)), 'steel');
        piece(R.x1 - 9, R.y, R.z0 + 6, R.x1 - 4.5, R.y + 3.2, R.z0 + 6.4, all(F('walls47', 2.8, 2.8)), 'steel');
        piece(R.x1 - 3, R.y, R.z0 + 6, R.x1 - 0.2, R.y + 3.2, R.z0 + 6.4, all(F('walls47', 2.8, 2.8)), 'steel');
        piece(R.x1 - 9, R.y + 3.2, R.z0 + 0.2, R.x1 - 0.2, R.y + 3.6, R.z0 + 6.4, all(F('walls47', 2.8, 2.8)), 'steel');
        C.prop('cyl', R.x1 - 3.75, R.y + 1.4, R.z0 + 6.6, 1.3, 0.3, 1.3, COL.steel, 0, Math.PI / 2);
        for (let i = 0; i < 14; i++) box(R.x1 - 7.5 + (i % 7) * 0.8, R.y + Math.floor(i / 7) * 0.3, R.z0 + 2, 0.6, 0.28, 0.4, [1.0, 0.8, 0.2]); // gold bars
        INFO.pickups.push(new V3(R.x1 - 4, R.y, R.z0 + 3), new V3(R.x1 - 6, R.y, R.z0 + 4));
        for (let x = R.x0 + 3; x < R.x1 - 12; x += 5) cyl(x, R.y, R.z1 - 6, 0.45, R.h, [0.85, 0.82, 0.75]); // columns
      } else office(R);
    },
  });
}

function police() {
  building({
    name: 'Police Station', x0: -150, z0: -50, x1: -108, z1: -18, n: 3, fh: 4, ext: ['store09_00', 'sky13_00'], mat: 'concrete', roof: 'roof02',
    inner: 'walls44', floor: 'paveB13', plan: 'corridor', roomW: 8, doors: [{ side: 's', at: 0.55, w: 3 }],
    furnish(r) {
      if (r.k === 0 && r.face < 0) {
        // holding cells: steel bars
        for (let x = r.x0 + 0.3; x < r.x1; x += 0.25) C.prop('pole', x, r.y + 1.3, r.z0 + 0.3, 0.03, 2.6, 0.03, COL.steel);
        box((r.x0 + r.x1) / 2, r.y, r.z1 - 0.6, 2, 0.45, 0.8, COL.metal);
      } else if (r.k === 1 && r.face > 0) {
        // armory: racks and crates, with guns lying about
        for (let x = r.x0 + 0.6; x < r.x1 - 0.5; x += 1.4) box(x, r.y, r.z0 + 0.4, 1.2, 2, 0.5, COL.steel);
        INFO.pickups.push(new V3((r.x0 + r.x1) / 2, r.y, (r.z0 + r.z1) / 2), new V3(r.x0 + 1.5, r.y, r.z1 - 1), new V3(r.x1 - 1.5, r.y, r.z1 - 1));
      } else office(r);
    },
  });
  // two cruisers out front become physics cars in game3d.js
  INFO.parking.push({ x: -140, z: -10, ry: -Math.PI / 2, kind: 'police' }, { x: -126, z: -10, ry: -Math.PI / 2, kind: 'police' });
}

function shops() {
  const kits = ['store01', 'store05', 'store12', 'store16', 'store03'];
  let x = -196;
  for (let i = 0; i < 5; i++) {
    const w = 18 + (i % 2) * 4;
    building({
      name: ['Corner Bakery', 'Hardware', 'Records', 'Pharmacy', 'Diner'][i], x0: x, z0: 20, x1: x + w, z1: 36, n: 2, fh: 4.2, ext: [kits[i] + '_00', pick(['sky05_00', 'sky16_00', 'sky12_00'])],
      mat: 'brick', roof: 'roof04', inner: 'walls20', floor: 'paveB11', plan: 'house', doors: [{ side: 'n', at: 0.5, w: 2.4 }],
    });
    x += w + 1;
  }
}

function grocery() {
  const x0 = 92, z0 = -40, x1 = 152, z1 = 4;
  building({
    name: 'GoatMart Grocery', x0, z0, x1, z1, n: 1, fh: 6.5, ext: ['store18_00', 'store18_00'], mat: 'concrete', roof: 'roof42', parapet: 'walls60',
    inner: 'walls02', floor: 'paveB01', plan: 'open', roofAccess: true, openStairs: true, stairX: x1 - 3.4,
    doors: [{ side: 's', at: 0.25, w: 4 }, { side: 's', at: 0.45, w: 4 }, { side: 'n', at: 0.8, w: 3.5, h: 4 }],
    furnish(R) {
      const y = R.y;
      // columns
      for (let x = R.x0 + 10; x < R.x1 - 5; x += 10) for (let z = R.z0 + 10; z < R.z1 - 6; z += 12) piece(x - 0.25, y, z - 0.25, x + 0.25, y + R.h, z + 0.25, all(F('walls03', 3.2, 3.2)), 'concrete');
      // aisles of shelves full of goods
      for (let a = 0; a < 8; a++) {
        const x = R.x0 + 6 + a * 5.2;
        if (x > R.x1 - 8) break;
        for (const s of [-1, 1]) for (let z = R.z0 + 8; z < R.z1 - 12; z += 1.2) {
          box(x + s * 0.4, y, z, 0.8, 0.1, 1.15, COL.white);
          for (let lv = 0; lv < 4; lv++) box(x + s * 0.45, y + 0.15 + lv * 0.5, z, 0.6, 0.35, 1.0, pick(ITEM_COLS));
        }
        box(x, y, (R.z0 + R.z1) / 2 - 2, 0.1, 2.2, R.z1 - R.z0 - 22, COL.white);
      }
      // freezers along the back
      for (let x = R.x0 + 2; x < R.x1 - 6; x += 2.6) { box(x, y, R.z0 + 1, 2.4, 2.2, 1.4, COL.white); box(x, y + 0.3, R.z0 + 1.72, 2.2, 1.7, 0.05, [0.5, 0.75, 0.9]); }
      // checkouts by the doors
      for (let i = 0; i < 6; i++) { const x = R.x0 + 4 + i * 4; box(x, y, R.z1 - 7, 0.9, 0.9, 3.5, COL.dark); box(x, y + 0.9, R.z1 - 6, 0.4, 0.4, 0.4, COL.black); }
      // produce bins
      for (let i = 0; i < 4; i++) { box(R.x1 - 12, y, R.z0 + 8 + i * 4, 3, 0.8, 2.5, COL.wood); for (let k = 0; k < 6; k++) C.prop('ico', R.x1 - 12.8 + (k % 3) * 0.8, y + 0.9, R.z0 + 7.6 + i * 4 + Math.floor(k / 3) * 0.8, 0.35, 0.3, 0.35, pick([COL.red, COL.green, COL.orange, COL.yellow])); }
      INFO.pickups.push(new V3(R.x0 + 30, y, R.z1 - 10), new V3(R.x1 - 10, y, R.z0 + 4));
      INFO.carts = { x: R.x0 + 8, z: R.z1 + 4, y };
    },
  });
  // parking lot
  C.flat(C.groundBuf('asphalt00'), 'asphalt00', x0 - 6, z1 + 6, x1 + 30, z1 + 54, 0.025, (x, z) => [x / 8, -z / 8]);
  for (let x = x0; x < x1 + 26; x += 3) C.flat(C.groundBuf('asphalt20', true), 'asphalt20', x - 0.08, z1 + 12, x + 0.08, z1 + 20, 0.03, (xx, z) => [0.5, -z / 4], 0);
  for (let i = 0; i < 9; i++) INFO.parking.push({ x: x0 + 1.5 + i * 6, z: z1 + 16, ry: Math.PI / 2, kind: 'car' });
  for (let i = 0; i < 6; i++) INFO.parking.push({ x: x0 + 6 + i * 8, z: z1 + 40, ry: -Math.PI / 2, kind: 'car' });
}

function school(o) {
  const S = {
    name: o.name, x0: o.x0, z0: o.z0, x1: o.x1, z1: o.z1, n: o.n, fh: 4, ext: o.ext, mat: 'brick', roof: 'roof00', parapet: o.parapet || 'walls10',
    inner: o.inner || 'walls46', floor: 'paveB11', plan: 'corridor', roomW: 9.5, kind: 'school', locker: o.locker, furnish: classroom,
    doors: [{ side: 's', at: 0.5, w: 3.2 }, { side: 'n', at: 0.5, w: 2.4 }, { side: 'e', at: 0.5, w: 2.4 }],
  };
  building(S);
  if (o.gym) {
    const g = o.gym;
    building({
      name: o.name + ' Gym', ...g, n: 1, fh: g.h || 9, ext: [o.ext[0], o.ext[1]], mat: 'brick', roof: 'roof42', parapet: 'walls10', inner: 'walls46', floor: 'rf14_00', ceil: 'walls47',
      plan: 'open', roofAccess: false, doors: [{ side: g.door || 'n', at: 0.5, w: 3 }],
      furnish(R) {
        const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, y = R.y;
        for (const s of [-1, 1]) {
          const x = s > 0 ? R.x1 - 1.2 : R.x0 + 1.2;
          C.prop('pole', x, y + 1.6, cz, 0.08, 3.2, 0.08, COL.steel);
          box(x - s * 0.2, y + 2.9, cz, 0.08, 1.1, 1.8, COL.white);
          C.prop('cyl', x - s * 0.6, y + 3.05, cz, 0.24, 0.04, 0.24, COL.orange);
        }
        for (let i = 0; i < 4; i++) box(cx + (i - 1.5) * 4, y, R.z0 + 1.2 + 0.0, 3.6, 0.5 + 0.0, 1.8, COL.wood); // bleachers
        for (let i = 0; i < 4; i++) box(cx + (i - 1.5) * 4, y + 0.5, R.z0 + 0.8, 3.6, 0.5, 1.0, COL.wood);
        INFO.pickups.push(new V3(cx, y, cz + 3));
        INFO.balls = INFO.balls || [];
        INFO.balls.push({ x: cx, y: y + 1, z: cz, r: 0.24, color: 0xe06a1a }, { x: cx + 2, y: y + 1, z: cz - 2, r: 0.24, color: 0xe06a1a });
      },
    });
  }
}

function houses(bx0, bz0) {
  // two rows of houses facing streets, big and small, with yards
  const roofs = ['rf05_00', 'rf06_00', 'rf17_00', 'rf19_00'];
  const walls = [['walls20', 'sky06_00'], ['walls21', 'sky14_00'], ['walls57', 'sky18_00'], ['walls24', 'sky02_00'], ['walls23', 'sky08_00']];
  let i = 0;
  for (const row of [0, 1]) {
    let x = bx0 + 4;
    while (x < bx0 + 108) {
      const big = rnd() < 0.4, w = big ? 16 : 10, d = big ? 12 : 9, n = big ? 2 : 1;
      if (x + w > bx0 + 112) break;
      const z0 = row ? bz0 + 112 - d - 8 : bz0 + 8, z1 = z0 + d;
      const [, win] = walls[i++ % walls.length];
      const fh = 3.2, roof = roofs[i % roofs.length];
      building({
        name: big ? 'Big House' : 'Little House', x0: x, z0, x1: x + w, z1, n, fh, ext: [win, win], mat: big ? 'brick' : 'wood', roofAccess: false, roof: 'roof00',
        inner: 'walls20', floor: 'rf14_00', plan: 'house', stairLen: 6.5, doors: [{ side: row ? 's' : 'n', at: 0.65, w: 1.4, h: 2.4 }],
        extra() { hipRoof(x, z0, x + w, z1, n * fh + 0.3, big ? 3.2 : 2.6, roof); },
      });
      INFO.spots.push(new V3(x + w / 2, 0, row ? z1 + 4 : z0 - 4));
      if (rnd() < 0.5) C.treeSpots.push({ x: x + w / 2 + rnd(-3, 3), y: 0, z: row ? z0 - 5 : z1 + 5, scale: 0.9, species: pick(['maple', 'oak', 'pine']), seed: Math.floor(rnd() * 1e9) });
      x += w + 5 + rnd(0, 3);
    }
  }
}

/** A hip roof over x0..x1, z0..z1 from y0, h tall (pyramid volume for the voxel engine) */
function hipRoof(x0, z0, x1, z1, y0, h, tile) {
  const o = 0.4; x0 -= o; z0 -= o; x1 += o; z1 += o;
  C.vol({ t: 'pyr', hip: true, x0, x1, z0, z1, y0, y1: y0 + h, mat: 'wood' });
  const b = C.bufFor(tile), c = cell(tile), along = x1 - x0 >= z1 - z0, ts = 3;
  const d = (along ? z1 - z0 : x1 - x0) / 2, yr = y0 + h;
  const P = along
    ? { a: [x0 + d, yr, (z0 + z1) / 2], b: [x1 - d, yr, (z0 + z1) / 2] }
    : { a: [(x0 + x1) / 2, yr, z0 + d], b: [(x0 + x1) / 2, yr, z1 - d] };
  const tri = (p, q, r) => {
    const n = new V3().crossVectors(new V3(...q).sub(new V3(...p)), new V3(...r).sub(new V3(...p))).normalize();
    const uv = (v) => (Math.abs(n.x) > Math.abs(n.z) ? [v[2] / ts, (v[1] + Math.hypot(v[0], 0) * 0) / ts * 1.4] : [v[0] / ts, v[1] / ts * 1.4]);
    const i0 = b.n;
    for (const v of [p, q, r]) b.v(v[0], v[1], v[2], n.x, n.y, n.z, 1, 1, 1, uv(v)[0], uv(v)[1], c, 0);
    b.idx.push(i0, i0 + 1, i0 + 2);
  };
  const A = [x0, y0, z0], B = [x1, y0, z0], Cc = [x1, y0, z1], D = [x0, y0, z1];
  if (along) {
    tri(A, P.a, P.b); tri(A, P.b, B); // north
    tri(Cc, P.b, P.a); tri(Cc, P.a, D); // south
    tri(D, P.a, A); tri(B, P.b, Cc); // ends
  } else {
    tri(B, P.b, P.a); tri(B, P.a, A);
    tri(D, P.a, P.b); tri(D, P.b, Cc);
    tri(A, P.a, D); tri(Cc, P.b, B);
  }
  // fix winding so faces point out: emit both sides cheaply by duplicating reversed
  const n0 = b.idx.length;
  for (let i = n0 - 18; i < n0; i += 3) b.idx.push(b.idx[i], b.idx[i + 2], b.idx[i + 1]);
}

// ---- parks and playgrounds (static parts; the moving toys are physics bodies in game3d.js) ---------
function park(x0, z0, x1, z1, name, big) {
  INFO.parks.push({ x0, z0, x1, z1, name, big });
  const g = (t, a, b, c, d, y, ts) => C.flat(C.groundBuf(t), t, a, b, c, d, y, (x, z) => [x / ts, -z / ts]);
  g('grass11', x0, z0, x1, z1, 0.01, 5);
  // rubber play surface
  g('paveB34', x0 + 6, z0 + 6, x1 - 6, z1 - 6, 0.035, 2);
  // paths
  g('paveB25', (x0 + x1) / 2 - 1.5, z0, (x0 + x1) / 2 + 1.5, z1, 0.04, 2);
  for (let i = 0; i < (big ? 14 : 8); i++) C.treeSpots.push({ x: rnd(x0 + 2, x1 - 2), y: 0, z: rnd() < 0.5 ? z0 + rnd(1, 4) : z1 - rnd(1, 4), scale: 1 + rnd() * 0.3, species: pick(['oak', 'maple', 'pine', 'elm']), seed: Math.floor(rnd() * 1e9) });
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // the big climbing fort: towers, decks, a bridge, a tube slide and a straight slide, a climbing wall
  C.beginOwner('fort');
  const fx = cx - (big ? 18 : 10), fz = cz - 6, H = big ? 4.5 : 3;
  const deck = (x, z, w, d, y, col) => {
    for (const [px, pz] of [[x, z], [x + w, z], [x, z + d], [x + w, z + d]]) C.prop('cyl', px, y / 2 + (H + 2.5 - y) / 2, pz, 0.12, H + 2.5, 0.12, COL.yellow);
    piece(x, y - 0.15, z, x + w, y, z + d, all(F('rf14_00', 3, 3)), 'wood');
    box(x + w / 2, y + 2.4, z + d / 2, w + 0.4, 0.15, d + 0.4, col);
    C.prop('cone4', x + w / 2, y + 3.1, z + d / 2, w * 0.75, 1.3, d * 0.75, col, Math.PI / 4);
  };
  deck(fx, fz, 4, 4, H, COL.red);
  deck(fx + 12, fz, 4, 4, H, COL.blue);
  if (big) { deck(fx + 24, fz - 4, 5, 5, H + 2, COL.green); deck(fx + 12, fz + 12, 4, 4, H - 1.5, COL.orange); }
  // bridge between the first two
  piece(fx + 4, H - 0.12, fz + 1.2, fx + 12, H, fz + 2.8, all(F('rf14_00', 2, 2)), 'wood');
  for (let x = fx + 4.3; x < fx + 12; x += 0.6) { C.prop('pole', x, H + 0.5, fz + 1.2, 0.04, 1, 0.04, COL.yellow); C.prop('pole', x, H + 0.5, fz + 2.8, 0.04, 1, 0.04, COL.yellow); }
  if (big) {
    piece(fx + 16, H + 1.88, fz - 0.2, fx + 24, H + 2, fz + 1.4, all(F('rf14_00', 2, 2)), 'wood');
    INFO.ramps.push({ x0: fx + 16, x1: fx + 24, z0: fz - 0.2, z1: fz + 1.4, y0: H, y1: H + 2, axis: 'x', slide: false });
  }
  // stairs up to the first deck
  for (let i = 0; i < Math.round(H / 0.3); i++) piece(fx + 1 + 0, i * 0.3, fz + 4 + (Math.round(H / 0.3) - i) * 0.35 - 0.35, fx + 3, (i + 1) * 0.3, fz + 4 + (Math.round(H / 0.3) - i) * 0.35, all(F('rf14_00', 2, 2)), 'wood');
  // a long straight slide off the blue deck (eastward) and a steep one off the red deck
  slide(fx + 16, fz + 1.2, fx + 16 + H * 2.4, fz + 2.8, H, 'x');
  slide(fx - H * 1.6, fz + 1.2, fx, fz + 2.8, H, '-x');
  if (big) {
    slide(fx + 29, fz - 3, fx + 29 + (H + 2) * 2.6, fz - 1, H + 2, 'x');
    // climbing wall on the green tower
    box(fx + 26.5, 0, fz + 1.1, 5, H + 2, 0.2, [0.55, 0.55, 0.6]);
    for (let i = 0; i < 30; i++) C.prop('ico', fx + 24.4 + rnd(0, 4.2), rnd(0.3, H + 1.8), fz + 1.25, 0.12, 0.12, 0.08, pick(ITEM_COLS));
    // monkey bars
    for (const z of [fz + 18, fz + 20]) for (const x of [fx, fx + 9]) C.prop('pole', x, 1.4, z, 0.06, 2.8, 0.06, COL.blue);
    for (const z of [fz + 18, fz + 20]) C.prop('box', fx + 4.5, 2.8, z, 9, 0.08, 0.08, COL.blue);
    for (let x = fx + 0.5; x < fx + 9; x += 0.5) C.prop('box', x, 2.8, fz + 19, 0.05, 0.05, 2, COL.blue);
    // geodesic dome climber
    for (let a = 0; a < 10; a++) for (let b = 0; b < 4; b++) {
      const t = (a / 10) * Math.PI * 2, p = (b / 4) * Math.PI / 2, r = 3;
      C.prop('ico', cx + 18 + Math.cos(t) * Math.cos(p) * r, Math.sin(p) * r, cz + 14 + Math.sin(t) * Math.cos(p) * r, 0.1, 0.1, 0.1, COL.red);
    }
  }
  C.endOwner();
  // sandbox
  g('paveB50', cx + (big ? 6 : 2), cz + 8, cx + (big ? 16 : 10), cz + 16, 0.045, 2);
  // the anchor points for moving toys
  INFO.parkToys = INFO.parkToys || [];
  INFO.parkToys.push({ cx, cz, big, x0, z0, x1, z1, fx, fz, H });
  INFO.pickups.push(new V3(cx + 6, 0, cz - 12), new V3(fx + 14, H, fz + 2));
}

function slide(x0, z0, x1, z1, H, dir) {
  // a sloped chute: drawn as a tilted strip with rails; feet follow INFO.ramps
  const hi = dir === 'x' ? x0 : x1, lo = dir === 'x' ? x1 : x0;
  const b = C.bufFor('walls35'), c = cell('walls35');
  const y = (x) => H * (1 - Math.abs(x - hi) / Math.abs(lo - hi)) + 0.12;
  const pts = [[x0, y(x0), z0], [x1, y(x1), z0], [x1, y(x1), z1], [x0, y(x0), z1]];
  const n = new V3(dir === 'x' ? H : -H, Math.abs(x1 - x0), 0).normalize();
  const i0 = b.n;
  pts.forEach((p) => b.v(p[0], p[1], p[2], n.x, n.y, n.z, 1, 1, 1, p[0] / 2, p[2] / 2, c, 0));
  b.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2, i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  for (const z of [z0, z1]) C.strut('pole', new V3(x0, y(x0) + 0.35, z), new V3(x1, y(x1) + 0.35, z), 0.06, COL.yellow);
  INFO.ramps.push({ x0, x1, z0, z1, y0: 0.12, y1: H + 0.12, hiX: hi, loX: lo, slide: true });
}

export function buildTown(city) {
  C = city;
  seed = 7;
  // road layout in the shape vectorclad's traffic (vc/js/cars.js) reads
  const road = (c, i) => ({ x0: c - RW, x1: c + RW, r0: c - RW, r1: c + RW, z0: c - RW, z1: c + RW, k: i, dir: i % 2 ? 1 : -1 });
  C.L = { curb: 0, water: -3, aves: GRID.map(road), sts: GRID.map(road), z0: -EDGE, z1: EDGE, x0: -EDGE, x1: EDGE, blockD: 124, blockW: 124 };
  C.carSpots = INFO.parking;
  C.bounds = { minX: -EDGE + 2, maxX: EDGE - 2, minZ: -EDGE + 2, maxZ: EDGE - 2 };
  C.spawn = INFO.spawn;
  ground();
  towers();
  bank();
  police();
  shops();
  grocery();
  school({ name: 'Ridgemont High School', x0: -196, z0: -196, x1: -100, z1: -156, n: 3, ext: ['store17_00', 'sky17_00'], locker: COL.red,
    gym: { x0: -196, z0: -146, x1: -154, z1: -110, h: 10, door: 'e' } });
  school({ name: 'Hillside Middle School', x0: -56, z0: -196, x1: 20, z1: -162, n: 2, ext: ['store14_00', 'sky12_00'], locker: COL.green, parapet: 'walls15',
    gym: { x0: 26, z0: -196, x1: 56, z1: -166, h: 9, door: 'w' } });
  school({ name: 'Sunny Acres Elementary', x0: 86, z0: -196, x1: 156, z1: -164, n: 2, ext: ['store05_00', 'sky05_00'], locker: COL.yellow, inner: 'walls24' });
  park(-56, -150, 56, -84, 'Hillside Park', false);
  park(84, -150, 196, -84, 'Sunny Acres Playground', false);
  park(-56, 82, 56, 196, 'Goat Hill Mega Park', true);
  houses(-196, 82);
  houses(84, 82);
  // football field by the high school
  C.flat(C.groundBuf('grass02'), 'grass02', -146, -146, -86, -96, 0.015, (x, z) => [x / 6, -z / 6]);
  for (const z of [-145, -97]) { C.beginOwner('goal'); C.prop('pole', -116, 3, z, 0.1, 6, 0.1, COL.yellow); C.prop('box', -116, 3, z, 5.6, 0.12, 0.12, COL.yellow); C.prop('pole', -118.8, 4.5, z, 0.07, 3, 0.07, COL.yellow); C.prop('pole', -113.2, 4.5, z, 0.07, 3, 0.07, COL.yellow); C.endOwner(); }
  INFO.pickups.push(new V3(-116, 0, -121));
  return INFO;
}
export { INFO as TOWN };
