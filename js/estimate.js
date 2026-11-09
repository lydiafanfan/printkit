/*
 * 耗材估算：按 Bambu Studio「0.20mm Standard」的切片方式粗算每个零件用多少克。
 *
 * 做法像一个简化的切片器：
 *  1. 把零件投影到 XY 小格子上，每一格向上打一条射线，求出这一列里实体所在的高度区间
 *     （按“绕数”合并，零件里互相重叠的几块会当成一块，跟切片软件一样）；
 *  2. 按 0.2mm 一层切开：离上表面 < 1mm 是顶层、离下表面 < 0.6mm 是底层（实心）；
 *  3. 每层里离边缘 < 墙厚的格子是墙（实心），剩下的按填充率算。
 * 1~4 层墙的结果一次算好，换填充、墙数、材料时不用重算。
 */
import * as THREE from 'three';

export const MATERIALS = [['PLA', 1.26], ['PETG', 1.28], ['ABS', 1.05], ['ASA', 1.05], ['TPU', 1.22]]; // Bambu 耗材预设里的密度
export const PATTERNS = [ // 第三个数：同样填充率时实际用料和网格的比（Bambu Studio 切片对比得出）
  ['grid', '网格', 1], ['gyroid', '螺旋体', 0.9], ['cubic', '立方体', 0.93], ['crosshatch', '交叉', 0.94],
  ['honeycomb', '蜂窝', 1.17], ['adaptivecubic', '自适应立方', 0.66], ['lightning', '闪电', 0.22],
];
export const EST_DEFAULT = { mat: 'PLA', infill: 15, pattern: 'grid', walls: 2 };

const TOP = 1.0, BOTTOM = 0.6;                       // 顶 5 层（≥1mm）、底 3 层
export const wallT = n => 0.377 + 0.407 * (n - 1);    // 墙的间距：外墙 0.42、内墙 0.45 线宽减去重叠
const MAXW = 4;
// 按 Bambu Studio 切片结果校准：实际挤出量 / 区域体积
const K_SKIN = 1.11, K_WALL = 0.985, K_SPARSE = 1.03; // 79 次切片对比：平均差 4%

const cache = new WeakMap();

/** 体积，以及 1~4 层墙时实心部分（墙 + 顶底层）的体积，mm³ */
export function meshStats(geo) {
  if (cache.has(geo)) return cache.get(geo);
  const pos = geo.attributes.position, idx = geo.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const vi = idx ? i => idx.getX(i) : i => i;
  // 精确体积 + 包围盒
  let V = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const P = new Float64Array(nTri * 9);
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = vi(t * 3 + k), x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      P[t * 9 + k * 3] = x; P[t * 9 + k * 3 + 1] = y; P[t * 9 + k * 3 + 2] = z;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const o = t * 9;
    const ux = P[o + 3] - P[o], uy = P[o + 4] - P[o + 1], uz = P[o + 5] - P[o + 2];
    const wx = P[o + 6] - P[o], wy = P[o + 7] - P[o + 1], wz = P[o + 8] - P[o + 2];
    V += (P[o] * (uy * wz - uz * wy) + P[o + 1] * (uz * wx - ux * wz) + P[o + 2] * (ux * wy - uy * wx)) / 6;
  }
  const flip = V < 0 ? -1 : 1;
  V = Math.abs(V);
  const empty = { V, skin: V, wall: [0, 0, 0, 0, 0] };
  if (!(V > 1e-6) || !isFinite(x0)) { cache.set(geo, empty); return empty; }

  // 格子：一般 0.3mm，零件很大时放粗，控制在约 40 万格
  const cs = Math.max(0.3, Math.sqrt((x1 - x0) * (y1 - y0) / 2.5e5));
  const nx = Math.ceil((x1 - x0) / cs) + 2, ny = Math.ceil((y1 - y0) / cs) + 2, N = nx * ny;
  const gx = x0 - cs, gy = y0 - cs, J = 1.37e-4; // 采样点加一点偏移，避免正好落在三角形边上
  // 每个三角形覆盖哪些格子中心：两遍（先计数，再填）
  const cnt = new Int32Array(N + 1);
  const each = (fn) => {
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const ax = P[o], ay = P[o + 1], bx = P[o + 3], by = P[o + 4], cx = P[o + 6], cy = P[o + 7];
      const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(d) < 1e-12) continue; // 竖直面
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - gx) / cs - 0.5 - J / cs)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - gx) / cs - 0.5));
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - gy) / cs - 0.5 - J / cs)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - gy) / cs - 0.5));
      for (let j = j0; j <= j1; j++) {
        const py = gy + (j + 0.5) * cs + J;
        for (let i = i0; i <= i1; i++) {
          const px = gx + (i + 0.5) * cs + J;
          const l1 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
          const l2 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          fn(j * nx + i, l1 * P[o + 2] + l2 * P[o + 5] + l3 * P[o + 8], d * flip > 0 ? -1 : 1);
        }
      }
    }
  };
  each(c => cnt[c + 1]++);
  for (let c = 0; c < N; c++) cnt[c + 1] += cnt[c];
  const M = cnt[N], zs = new Float32Array(M), sg = new Int8Array(M), fill = cnt.slice(0, N);
  each((c, z, s) => { const k = fill[c]++; zs[k] = z; sg[k] = s; });

  // 每一列：排序后按绕数求实体区间 [a, b]
  const ivS = new Int32Array(N + 1), ivA = [], ivB = [];
  const ord = [];
  for (let c = 0; c < N; c++) {
    ivS[c] = ivA.length;
    const s0 = cnt[c], s1 = cnt[c + 1];
    if (s1 - s0 >= 2) {
      ord.length = 0;
      for (let k = s0; k < s1; k++) ord.push(k);
      ord.sort((p, q) => zs[p] - zs[q]);
      let w = 0, a = 0;
      for (const k of ord) {
        const w2 = w + sg[k];
        if (w <= 0 && w2 > 0) a = zs[k];
        else if (w > 0 && w2 <= 0 && zs[k] - a > 1e-4) {
          // 叠在一起的两块（上一块的顶 = 下一块的底）合成一段
          const L = ivA.length;
          if (L > ivS[c] && a - ivB[L - 1] < 0.01) ivB[L - 1] = zs[k]; else { ivA.push(a); ivB.push(zs[k]); }
        }
        w = w2;
      }
    }
  }
  ivS[N] = ivA.length;

  // 按层切：每层算实体、顶底层、离边缘的距离
  const dz = Math.max(0.2, (z1 - z0) / 250), K = Math.max(1, Math.round((z1 - z0) / dz));
  const dzr = (z1 - z0) / K, cellV = cs * cs * dzr;
  const mask = new Uint8Array(N), skin = new Uint8Array(N), dist = new Float32Array(N);
  const thr = [0, 1, 2, 3, 4].map(n => n ? wallT(n) / cs + 0.5 : 0);
  let vox = 0, sk = 0;
  const wall = [0, 0, 0, 0, 0]; // 1~4 层墙：不在顶底层里的墙格子数
  const D1 = 1, D2 = Math.SQRT2, BIG = 1e9;
  for (let k = 0; k < K; k++) {
    const zc = z0 + (k + 0.5) * dzr;
    let any = false;
    for (let c = 0; c < N; c++) {
      let m = 0, s = 0;
      for (let q = ivS[c]; q < ivS[c + 1]; q++) {
        if (zc > ivA[q] && zc < ivB[q]) { m = 1; s = (ivB[q] - zc < TOP || zc - ivA[q] < BOTTOM) ? 1 : 0; break; }
      }
      mask[c] = m; skin[c] = s;
      if (m) { any = true; vox++; if (s) sk++; }
      dist[c] = m ? BIG : 0;
    }
    if (!any) continue;
    // 两遍倒角距离变换（格子单位）
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = j * nx + i; if (!mask[c]) continue;
      dist[c] = Math.min(dist[c], dist[c - 1] + D1, dist[c - nx] + D1, dist[c - nx - 1] + D2, dist[c - nx + 1] + D2);
    }
    for (let j = ny - 2; j > 0; j--) for (let i = nx - 2; i > 0; i--) {
      const c = j * nx + i; if (!mask[c]) continue;
      const v = Math.min(dist[c], dist[c + 1] + D1, dist[c + nx] + D1, dist[c + nx + 1] + D2, dist[c + nx - 1] + D2);
      dist[c] = v;
      if (!skin[c]) for (let n = 1; n <= MAXW; n++) if (v < thr[n]) wall[n]++;
    }
  }
  // 体素体积按精确体积校正
  const f = vox ? V / (vox * cellV) : 1;
  const r = { V, skin: sk * cellV * f, wall: wall.map(w => w * cellV * f) };
  cache.set(geo, r);
  return r;
}

/** parts: [{geo, label}]；s: {mat, infill, pattern, walls}。返回每个零件和总共的克数 */
export function estimate(parts, s = EST_DEFAULT) {
  const rho = (MATERIALS.find(m => m[0] === s.mat) || MATERIALS[0])[1];
  const pf = (PATTERNS.find(p => p[0] === s.pattern) || PATTERNS[0])[2];
  const d = Math.min(1, Math.max(0, s.infill / 100) * pf), n = Math.min(MAXW, Math.max(1, s.walls | 0));
  let V = 0, shellV = 0;
  // 叠在一起的零件（多色）：互相贴着的那一面在切片里不是顶面 / 底面，顶底层按合起来的整体算
  const grp = parts.filter(pt => pt.keepPlace), skinF = grp.length > 1 ? groupSkinFactor(grp.map(pt => pt.geo)) : 1;
  const rows = parts.map(pt => {
    const m0 = meshStats(pt.geo), sk = m0.skin * (pt.keepPlace ? skinF : 1), m = { ...m0, skin: sk };
    const shell = Math.min(m.V, m.skin + m.wall[n]), inner = m.V - shell;
    V += m.V; shellV += shell;
    const vol = m.skin * K_SKIN + m.wall[n] * K_WALL + inner * Math.min(1, d * K_SPARSE);
    return { label: pt.label || '零件', V: m.V, shell, inner, g: vol * rho / 1000 };
  });
  const g = rows.reduce((a, r) => a + r.g, 0);
  return { rows, g, V, shellFrac: V ? shellV / V : 1, per10: (V - shellV) * 0.1 * pf * K_SPARSE * rho / 1000, rho };
}

/** 多个零件合起来的顶底层体积 / 各自算的顶底层体积之和 */
const grpCache = new WeakMap();
function groupSkinFactor(geos) {
  const hit = grpCache.get(geos[0]);
  if (hit && hit.geos.length === geos.length && hit.geos.every((g, i) => g === geos[i])) return hit.f;
  const arrs = geos.map(g => (g.index ? g.toNonIndexed() : g).attributes.position.array);
  const all = new Float32Array(arrs.reduce((a, x) => a + x.length, 0));
  let o = 0; for (const a of arrs) { all.set(a, o); o += a.length; }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(all, 3));
  const sum = geos.reduce((a, g) => a + meshStats(g).skin, 0);
  const f = sum > 0 ? Math.min(1, meshStats(merged).skin / sum) : 1;
  grpCache.set(geos[0], { geos, f });
  return f;
}
