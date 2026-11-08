/*
 * 拼接连接件：上传切好的 / 分件的模型，自动在接触的地方加连接结构。
 *
 * 流程：读取 STL/OBJ → 焊接顶点、拆分零件、统一法线方向、自动补洞 → 变成 manifold 实体
 *      → 找零件之间的接触（平面切口 / 曲面贴合）→ 在接触区域自动排布连接件 → 布尔运算。
 * 布尔运算用 manifold-3d（WebAssembly），结果一定是封闭网格。
 */
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { Space, F, distInside } from './engine.js?v=24';
import { getFit } from './parts.js?v=24';

const MANIFOLD_URL = new URL('../vendor/manifold/manifold.js', import.meta.url).href; // 自带一份，不依赖外部 CDN
let W = null;
export async function manifoldReady() {
  if (!W) { const { default: Module } = await import(MANIFOLD_URL); W = await Module(); W.setup(); }
  return W;
}

const PART_COLORS = ['#8fd3c1', '#f2b6a0', '#f3d98e', '#b3a8ea', '#9fc3ea', '#e9a6c0', '#c7d98f', '#d9b28a'];
const r1 = v => Math.round(v * 10) / 10;

// =====================================================================
//  状态
// =====================================================================
export const JOIN = { parts: [], overrides: {}, swaps: {}, version: 0, report: {}, contacts: [], problems: [] };

// =====================================================================
//  读取 + 修补
// =====================================================================
function readPositions(name, buf) {
  if (/\.obj$/i.test(name)) {
    const group = new OBJLoader().parse(new TextDecoder().decode(buf));
    const out = [];
    group.updateMatrixWorld(true);
    group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      out.push(g.attributes.position.array);
    });
    const n = out.reduce((a, x) => a + x.length, 0), all = new Float32Array(n);
    let k = 0; for (const a of out) { all.set(a, k); k += a.length; }
    return all;
  }
  const g = new STLLoader().parse(buf);
  return (g.index ? g.toNonIndexed() : g).attributes.position.array;
}

/** 焊接重合顶点、去掉退化和重复的三角形 */
function weld(pos) {
  const n = pos.length / 3, q = 1e3, map = new Map(), verts = [], idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const k = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = map.get(k);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(k, id); }
    idx[i] = id;
  }
  const tris = [], seen = new Set();
  for (let t = 0; t < n / 3; t++) {
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key); tris.push(a, b, c);
  }
  return { verts: new Float32Array(verts), tris: new Uint32Array(tris) };
}

/** 按连通性拆成独立零件 */
function splitComponents(verts, tris) {
  const nv = verts.length / 3, par = new Int32Array(nv).map((_, i) => i);
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < tris.length; t += 3) { const a = find(tris[t]); par[find(tris[t + 1])] = a; par[find(tris[t + 2])] = a; }
  const groups = new Map();
  for (let t = 0; t < tris.length; t += 3) { const r = find(tris[t]); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(tris[t], tris[t + 1], tris[t + 2]); }
  return [...groups.values()].map(list => {
    const remap = new Map(), v = [], tr = new Uint32Array(list.length);
    list.forEach((id, i) => { let m = remap.get(id); if (m === undefined) { m = v.length / 3; remap.set(id, m); v.push(verts[id * 3], verts[id * 3 + 1], verts[id * 3 + 2]); } tr[i] = m; });
    return { verts: new Float32Array(v), tris: tr };
  });
}

const ek = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
/** 统一三角形朝向（相邻三角形在公共边上方向相反），并保证法线朝外 */
function orient(verts, tris) {
  const T = tris.length / 3, edges = new Map();
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
    const key = ek(tris[3 * t + k], tris[3 * t + (k + 1) % 3]);
    if (!edges.has(key)) edges.set(key, []); edges.get(key).push(t);
  }
  const has = (t, p, q) => { const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2]; return (a === p && b === q) || (b === p && c === q) || (c === p && a === q); };
  const seen = new Uint8Array(T);
  for (let s = 0; s < T; s++) {
    if (seen[s]) continue;
    seen[s] = 1; const queue = [s];
    while (queue.length) {
      const cur = queue.pop();
      for (let k = 0; k < 3; k++) {
        const p = tris[3 * cur + k], q = tris[3 * cur + (k + 1) % 3];
        const list = edges.get(ek(p, q));
        if (!list || list.length !== 2) continue;
        const o = list[0] === cur ? list[1] : list[0];
        if (seen[o]) continue;
        if (has(o, p, q)) { const tmp = tris[3 * o + 1]; tris[3 * o + 1] = tris[3 * o + 2]; tris[3 * o + 2] = tmp; }
        seen[o] = 1; queue.push(o);
      }
    }
  }
  let vol = 0;
  for (let t = 0; t < T; t++) {
    const a = tris[3 * t] * 3, b = tris[3 * t + 1] * 3, c = tris[3 * t + 2] * 3;
    vol += verts[a] * (verts[b + 1] * verts[c + 2] - verts[b + 2] * verts[c + 1]) - verts[a + 1] * (verts[b] * verts[c + 2] - verts[b + 2] * verts[c]) + verts[a + 2] * (verts[b] * verts[c + 1] - verts[b + 1] * verts[c]);
  }
  if (vol < 0) for (let t = 0; t < T; t++) { const tmp = tris[3 * t + 1]; tris[3 * t + 1] = tris[3 * t + 2]; tris[3 * t + 2] = tmp; }
  return tris;
}

/** 找出边界边围成的洞，逐个三角化补上 */
function fillHoles(verts, tris) {
  const dir = new Set();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) dir.add(tris[t + k] + '>' + tris[t + (k + 1) % 3]);
  const next = new Map();
  let complex = false;
  for (const e of dir) {
    const [a, b] = e.split('>').map(Number);
    if (dir.has(b + '>' + a)) continue;
    if (next.has(b)) complex = true;
    next.set(b, a); // 补洞的边方向和原边相反
  }
  if (!next.size) return { tris, holes: 0, ok: true };
  const used = new Set(), add = [];
  let holes = 0;
  const vx = i => new THREE.Vector3(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = []; let v = start, guard = 0;
    while (v !== undefined && !used.has(v) && guard++ < 1e6) { used.add(v); loop.push(v); v = next.get(v); }
    if (v !== start || loop.length < 3) { complex = true; continue; }
    holes++;
    // Newell 法线 + 投影到平面后三角化
    const P = loop.map(vx), nrm = new THREE.Vector3();
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nrm.x += (a.y - b.y) * (a.z + b.z); nrm.y += (a.z - b.z) * (a.x + b.x); nrm.z += (a.x - b.x) * (a.y + b.y); }
    nrm.normalize();
    const u = new THREE.Vector3().crossVectors(nrm, Math.abs(nrm.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
    const w = new THREE.Vector3().crossVectors(nrm, u);
    const flat = P.map(p => new THREE.Vector2(p.dot(u), p.dot(w)));
    const faces = THREE.ShapeUtils.triangulateShape(flat, []);
    if (!faces.length && loop.length >= 3) { complex = true; continue; }
    for (const [i, j, k] of faces) {
      const n = new THREE.Vector3().subVectors(P[j], P[i]).cross(new THREE.Vector3().subVectors(P[k], P[i]));
      add.push(...(n.dot(nrm) >= 0 ? [loop[i], loop[j], loop[k]] : [loop[i], loop[k], loop[j]]));
    }
  }
  const out = new Uint32Array(tris.length + add.length);
  out.set(tris); out.set(add, tris.length);
  return { tris: out, holes, ok: !complex };
}

function toManifold(verts, tris) {
  const mesh = new W.Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
  mesh.merge();
  try {
    const m = new W.Manifold(mesh);
    if (m.status && m.status() !== 'NoError') { m.delete(); return null; }
    return m;
  } catch { return null; }
}

/** 一块网格 → 一个或多个零件 */
function processMesh(name, pos, problems) {
  const { verts, tris } = weld(pos);
  const comps = splitComponents(verts, tris).filter(c => c.tris.length >= 12);
  const out = [];
  comps.forEach((c, i) => {
    const label = comps.length > 1 ? `${name.replace(/\.(stl|obj)$/i, '')} · ${i + 1}` : name.replace(/\.(stl|obj)$/i, '');
    let t = orient(c.verts, c.tris);
    let man = toManifold(c.verts, t), fixed = 0;
    if (!man) {
      const f = fillHoles(c.verts, t);
      fixed = f.holes;
      t = orient(c.verts, f.tris);
      man = toManifold(c.verts, t);
      if (!man) { problems.push({ name: label, why: f.ok ? `补了 ${f.holes} 个洞，但网格还有交叉或重叠的面` : '有边被三个以上的面共用，或洞的形状太复杂，没法自动补' }); return; }
    }
    if (man.volume() < 0.5) { man.delete(); return; } // 丢掉碎屑
    out.push({ name: label, man, fixed });
  });
  return out;
}

export function geoFrom(man) {
  const m = man.getMesh(), np = m.numProp, v = m.vertProperties;
  let pos = v;
  if (np !== 3) { pos = new Float32Array(m.numVert * 3); for (let i = 0; i < m.numVert; i++) { pos[i * 3] = v[i * np]; pos[i * 3 + 1] = v[i * np + 1]; pos[i * 3 + 2] = v[i * np + 2]; } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1));
  const ng = g.toNonIndexed(); g.dispose();
  ng.computeVertexNormals(); ng.computeBoundingBox();
  return ng;
}

function addParts(list) {
  for (const p of list) {
    const geo = geoFrom(p.man);
    JOIN.parts.push({ id: Math.random().toString(36).slice(2, 8), name: p.name, man: p.man, geo, fixed: p.fixed, color: PART_COLORS[JOIN.parts.length % PART_COLORS.length], volume: p.man.volume() });
  }
  JOIN.version++;
}

export async function loadFiles(files) {
  await manifoldReady();
  const problems = [];
  let added = 0;
  for (const f of files) {
    if (!/\.(stl|obj)$/i.test(f.name)) { problems.push({ name: f.name, why: '只支持 STL 和 OBJ 文件' }); continue; }
    try {
      const pos = readPositions(f.name, await f.arrayBuffer());
      const parts = processMesh(f.name, pos, problems);
      addParts(parts); added += parts.length;
    } catch (e) { problems.push({ name: f.name, why: '文件读不了：' + (e.message || e) }); }
  }
  JOIN.problems = problems;
  return { added, problems };
}

export function removePart(id) {
  const i = JOIN.parts.findIndex(p => p.id === id);
  if (i < 0) return;
  JOIN.parts[i].man.delete(); JOIN.parts[i].geo.dispose();
  JOIN.parts.splice(i, 1); JOIN.version++;
}
export function clearParts() { while (JOIN.parts.length) removePart(JOIN.parts[0].id); JOIN.overrides = {}; JOIN.swaps = {}; }

// ---------- 示例模型 ----------
export async function loadSample(kind) {
  await manifoldReady();
  clearParts();
  const M = W.Manifold, list = [];
  if (kind === 'vase') {
    // 厚壁花瓶，从中间切开（切面是一个圆环）
    const body = M.cylinder(70, 30, 24, 96).subtract(M.cylinder(70, 21, 16, 96).translate(0, 0, 4));
    const top = body.trimByPlane([0, 0, 1], 32), bottom = body.trimByPlane([0, 0, -1], -32);
    list.push({ name: '花瓶 · 上半', man: top, fixed: 0 }, { name: '花瓶 · 下半', man: bottom, fixed: 0 });
    body.delete();
  } else {
    // 分件蛋糕：蛋糕体 + 奶油层（带一圈奶油花）+ 樱桃
    const cake = M.cylinder(30, 36, 36, 120);
    let cream = M.cylinder(5, 36, 34, 120).translate(0, 0, 30);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cream = cream.add(M.sphere(4.6, 32).translate(Math.cos(a) * 30, Math.sin(a) * 30, 35.2)); }
    const cherry = M.sphere(7, 48).translate(0, 0, 35 + 7 - 1.2).add(M.cylinder(9, 0.9, 0.6, 16).rotate([0, 18, 0]).translate(1, 0, 46));
    list.push({ name: '蛋糕体', man: cake, fixed: 0 }, { name: '奶油', man: cream, fixed: 0 }, { name: '樱桃', man: cherry, fixed: 0 });
  }
  addParts(list);
}

// =====================================================================
//  接触检测
// =====================================================================
function planeGroups(geo) {
  const pos = geo.attributes.position, groups = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const map = new Map();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const area = n.length() / 2;
    if (area < 1e-6) continue;
    n.normalize();
    const d = n.dot(a);
    const key = `${Math.round(n.x * 40)},${Math.round(n.y * 40)},${Math.round(n.z * 40)},${Math.round(d * 5)}`;
    let g = map.get(key);
    if (!g) { g = { n: n.clone(), d, area: 0, tris: [] }; map.set(key, g); groups.push(g); }
    g.area += area; g.tris.push(a.clone(), b.clone(), c.clone());
  }
  // 合并因为取整被分开的同一平面
  const merged = [];
  for (const g of groups.sort((p, q) => q.area - p.area)) {
    const m = merged.find(x => x.n.dot(g.n) > 0.9995 && Math.abs(x.d - g.d) < 0.06);
    if (m) { m.area += g.area; m.tris.push(...g.tris); } else merged.push(g);
  }
  return merged.filter(g => g.area >= 4);
}

function frameFor(n) {
  const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  return { u, v, n: n.clone() };
}

function planarContact(gA, gB) {
  const fr = frameFor(gA.n);
  const origin = gA.n.clone().multiplyScalar(gA.d);
  const proj = tris => tris.map(p => [p.dot(fr.u), p.dot(fr.v)]);
  const pa = proj(gA.tris), pb = proj(gB.tris);
  const bb = pts => pts.reduce((r, [x, y]) => [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const A = bb(pa), B = bb(pb);
  const x0 = Math.max(A[0], B[0]), y0 = Math.max(A[1], B[1]), x1 = Math.min(A[2], B[2]), y1 = Math.min(A[3], B[3]);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const sp = new Space(x0 - 1, y0 - 1, x1 + 1, y1 + 1, 420);
  const draw = pts => sp.draw(g => { g.beginPath(); for (let i = 0; i < pts.length; i += 3) { g.moveTo(...pts[i]); g.lineTo(...pts[i + 1]); g.lineTo(...pts[i + 2]); g.closePath(); } g.fill('nonzero'); });
  const mask = F.inter(draw(pa), draw(pb));
  let cnt = 0; for (let i = 0; i < mask.length; i++) if (mask[i] >= 0.5) cnt++;
  const area = cnt * sp.res * sp.res;
  if (area < 3) return null;
  return { type: 'plane', fr, origin, sp, mask, area };
}

/** 找出所有零件之间的接触；底座（体积大的）在前 */
function findContacts(parts) {
  const groups = parts.map(p => planeGroups(p.geo));
  const boxes = parts.map(p => p.geo.boundingBox.clone().expandByScalar(0.6));
  const contacts = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (!boxes[i].intersectsBox(boxes[j])) continue;
    const [a, b] = parts[i].volume >= parts[j].volume ? [i, j] : [j, i];
    let best = null;
    for (const gA of groups[a]) for (const gB of groups[b]) {
      if (gA.n.dot(gB.n) > -0.999 || Math.abs(gA.d + gB.d) > 0.08) continue;
      const c = planarContact(gA, gB);
      if (c && (!best || c.area > best.area)) best = c;
    }
    if (best) { contacts.push({ a, b, ...best }); continue; }
    // 曲面贴合 / 互相嵌入：看 b 往哪个方向挪一点会和 a 重叠
    const A = parts[a].man, B = parts[b].man;
    const base = A.intersect(B); const v0 = base.volume(); base.delete();
    let bestDir = null, bestV = v0 + 0.02;
    for (const d of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      const moved = B.translate(-d[0] * 0.5, -d[1] * 0.5, -d[2] * 0.5), x = A.intersect(moved);
      const v = x.volume(); x.delete(); moved.delete();
      if (v > bestV) { bestV = v; bestDir = d; }
    }
    if (bestDir) contacts.push({ a, b, type: 'touch', n: new THREE.Vector3(...bestDir), overlap: v0 });
  }
  return contacts;
}

// =====================================================================
//  连接件
// =====================================================================
const SEG = 48;
const mat4 = (u, v, n, p) => [u.x, u.y, u.z, 0, v.x, v.y, v.z, 0, n.x, n.y, n.z, 0, p.x, p.y, p.z, 1];

function thickness(geo, p, dir) {
  // 从接触面往零件里面射一条线，第一次穿出零件的距离就是这里的厚度
  const d = dir.clone().normalize();
  const rc = new THREE.Raycaster(p.clone().addScaledVector(d, 0.05), d, 0, 500);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const hit = rc.intersectObject(mesh, false)[0];
  return hit ? hit.distance + 0.05 : 0;
}

/** 在接触区域里用“最远点采样”排布连接件位置 */
function layoutPoints(c, need, count, spacing) {
  const { sp, mask } = c;
  const dist = distInside(sp, mask);
  let maxD = 0; for (const d of dist) if (d > maxD) maxD = d;
  const cand = [];
  const step = Math.max(1, Math.round(0.5 / sp.res));
  for (let y = 0; y < sp.h; y += step) for (let x = 0; x < sp.w; x += step) {
    const d = dist[y * sp.w + x];
    if (d >= need) cand.push({ x, y, d, mm: sp.mm(x, y) });
  }
  if (!cand.length) return { pts: [], maxD };
  const pts = [cand.reduce((m, q) => (q.d > m.d ? q : m))];
  while (pts.length < count) {
    let best = null, bd = -1;
    for (const q of cand) {
      let md = Infinity;
      for (const p of pts) md = Math.min(md, Math.hypot(q.mm[0] - p.mm[0], q.mm[1] - p.mm[1]));
      if (md >= spacing && md > bd) { bd = md; best = q; }
    }
    if (!best) break;
    pts.push(best);
  }
  return { pts: pts.map(p => p.mm), maxD };
}

function principalAxis(c) {
  const { sp, mask } = c;
  let n = 0, mx = 0, my = 0;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (mask[y * sp.w + x] >= 0.5) { const [a, b] = sp.mm(x, y); mx += a; my += b; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (mask[y * sp.w + x] >= 0.5) { const [a, b] = sp.mm(x, y); sxx += (a - mx) ** 2; syy += (b - my) ** 2; sxy += (a - mx) * (b - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { cx: mx, cy: my, ang };
}

/** 把一个形状向四周和 -n 方向各扩一点（做配合间隙） */
function grow(m, u, v, n, c) {
  const list = [m, m.translate(u.x * c, u.y * c, u.z * c), m.translate(-u.x * c, -u.y * c, -u.z * c), m.translate(v.x * c, v.y * c, v.z * c), m.translate(-v.x * c, -v.y * c, -v.z * c), m.translate(-n.x * c, -n.y * c, -n.z * c)];
  const out = W.Manifold.union(list);
  list.slice(1).forEach(x => x.delete());
  return out;
}

const METHOD_NAMES = { auto: '自动', dowel: '定位销', pin: '凸销 + 凹孔', snap: '卡扣', dovetail: '燕尾', seat: '嵌入定位', none: '不连接' };
export { METHOD_NAMES };

// =====================================================================
//  工具定义
// =====================================================================
let cache = { key: '', parts: null, extras: null, notes: null, warnings: null };

export const JOINER = {
  id: 'joiner', name: '拼接连接件', kind: 'mesh', cat: 'mesh',
  tagline: '给切开或分件的模型自动加定位销、卡扣、燕尾或嵌入槽',
  defaults: { method: 'dowel', size: 0, count: 0, depth: 8, seatDepth: 1.2, explode: 0.35 },
  groups: [
    { title: '模型', params: [{ k: 'files', type: 'live', render: () => filesHTML() }] },
    { title: '连接位置', params: [{ k: 'contacts', type: 'live', render: p => contactsHTML(p) }] },
    { title: '平面切口默认用', params: [
      { k: 'method', type: 'cards', cols: 3, options: [
        ['dowel', '定位销', '两边挖孔 + 单独的销', icon('<rect x="6" y="5" width="10" height="20" rx="1"/><rect x="24" y="5" width="10" height="20" rx="1"/><path d="M12 15h16" stroke-width="4"/>')],
        ['pin', '凸销凹孔', '一边凸起一边孔', icon('<rect x="6" y="5" width="12" height="20" rx="1"/><rect x="24" y="5" width="10" height="20" rx="1"/><path d="M18 15h7" stroke-width="4"/>')],
        ['snap', '卡扣', '按进去就卡住', icon('<rect x="6" y="5" width="10" height="20" rx="1"/><rect x="24" y="5" width="10" height="20" rx="1"/><path d="M12 15h16M26 11l3 4-3 4M14 11l-3 4 3 4"/>')],
        ['dovetail', '燕尾', '滑进去、防转动', icon('<path d="M6 5h12v7l-3 3 3 3v7H6zM34 5H22v7l-3 3 3 3v7h12z"/>')],
        ['seat', '嵌入定位', '小件 / 曲面也能用', icon('<path d="M5 22h30v4H5z"/><path d="M13 22v-4h14v4" stroke-dasharray="2 2"/><circle cx="20" cy="11" r="6"/>')],
      ] },
    ] },
    { title: '尺寸', params: [
      { k: 'size', label: '连接件直径', hint: '0 = 按接触面大小自动选', type: 'range', min: 0, max: 12, step: 0.5, unit: 'mm' },
      { k: 'count', label: '每处数量', hint: '0 = 自动（尽量 2 个以上防转动）', type: 'range', min: 0, max: 8, step: 1, unit: '个' },
      { k: 'depth', label: '插入深度', hint: '每一边；太薄的地方会自动变浅', type: 'range', min: 3, max: 20, step: 0.5, unit: 'mm' },
      { k: 'seatDepth', label: '嵌入深度', hint: '“嵌入定位”往底座里陷多深', type: 'range', min: 0.4, max: 4, step: 0.1, unit: 'mm' },
      { k: 'fit', type: 'live', render: () => { const f = getFit(); return `<span class="info-line">配合间隙 ${f.slide}mm${f.measured ? '（来自你的公差测试）' : '（默认值，做一次公差测试会更准）'}</span>`; } },
    ] },
    { title: '预览', params: [{ k: 'explode', label: '分开查看', hint: '把零件拉开看连接件，不影响导出', type: 'range', min: 0, max: 1, step: 0.05 }] },
  ],

  async action(act, arg) {
    if (act === 'files') { const r = await loadFiles(arg); return r.problems.length ? { alert: problemAlert(r.problems, r.added) } : { toast: `已载入 ${r.added} 个零件` }; }
    if (act === 'sample') { await loadSample(arg); return {}; }
    if (act === 'remove') { removePart(arg); return {}; }
    if (act === 'clear') { clearParts(); return {}; }
    if (act === 'method') { JOIN.overrides[arg.key] = arg.value; JOIN.version++; return {}; }
    if (act === 'swap') { JOIN.swaps[arg] = !JOIN.swaps[arg]; JOIN.version++; return {}; }
    return {};
  },
  async init() { await manifoldReady(); if (!JOIN.parts.length) await loadSample('cake'); },

  build(_a, _i, p) {
    if (!W) throw new Error('正在加载布尔运算模块…');
    if (!JOIN.parts.length) throw new Error('先上传切好的 STL / OBJ，或者点一个示例试试');
    const fit = getFit();
    const key = JSON.stringify([JOIN.version, p.method, p.size, p.count, p.depth, p.seatDepth, fit.slide]);
    if (cache.key !== key) compute(p, fit, key);
    // 显示：装配状态 + 按“分开查看”拉开
    const parts = JOIN.parts.map((pt, i) => ({ geo: cache.parts[i].clone(), label: pt.name, color: pt.color }));
    const box = new THREE.Box3(); parts.forEach(q => { q.geo.computeBoundingBox(); box.union(q.geo.boundingBox); });
    const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    parts.forEach(q => {
      const c = q.geo.boundingBox.getCenter(new THREE.Vector3()).sub(ctr);
      if (c.lengthSq() < 1e-6) c.set(0, 0, -1);
      q.offset = c.normalize().multiplyScalar(p.explode * size * 0.35).toArray();
    });
    // 拉开后整体不能沉到打印板下面
    const lowest = Math.min(...parts.map(q => q.geo.boundingBox.min.z + q.offset[2]));
    if (lowest < box.min.z) parts.forEach(q => { q.offset[2] += box.min.z - lowest; });
    const extras = cache.extras.map(e => ({ geo: e.geo.clone(), label: e.label, color: '#e7e2d9' }));
    let x = box.max.x + 10;
    extras.forEach(e => { e.geo.computeBoundingBox(); const b = e.geo.boundingBox; e.geo.translate(x - b.min.x, ctr.y - (b.min.y + b.max.y) / 2, -b.min.z + box.min.z); x += b.max.x - b.min.x + 4; });
    return {
      parts: [...parts, ...extras], keepLayout: true,
      notes: cache.notes, warnings: cache.warnings, colorChange: null,
      exportParts: () => [...JOIN.parts.map((pt, i) => ({ geo: cache.parts[i].clone(), label: pt.name })), ...cache.extras.map(e => ({ geo: e.geo.clone(), label: e.label }))],
    };
  },
};

function compute(p, fit, key) {
  const clr = fit.slide;
  const cur = JOIN.parts.map(pt => pt.man);           // 当前（会被替换成新的实体）
  const own = new Set();                               // 这次新建、最后要释放的
  const take = m => { own.add(m); return m; };
  const extras = [], notes = [], warnings = [];
  const contacts = findContacts(JOIN.parts);
  JOIN.contacts = contacts.map(c => ({ key: ck(c), a: c.a, b: c.b, type: c.type, area: c.area || 0 }));
  JOIN.report = {};
  let dowelN = 0, snapN = 0;

  for (const c of contacts) {
    const k = ck(c);
    const swap = !!JOIN.swaps[k];
    let method = JOIN.overrides[k] || 'auto';
    if (method === 'auto') method = c.type === 'plane' ? p.method : 'seat';
    if (method === 'none') { JOIN.report[k] = '不加连接'; continue; }
    const [ia, ib] = swap ? [c.b, c.a] : [c.a, c.b];
    const A = () => cur[ia], B = () => cur[ib];

    // 嵌入定位：小件沿接触方向往底座里“长”一点，底座挖出对应形状（带间隙）
    const seat = (why = '') => {
      const n = c.type === 'plane' ? c.fr.n.clone() : c.n.clone();
      if (swap) n.negate();
      const fr = frameFor(n), d = p.seatDepth;
      const moved = take(B().translate(-n.x * d, -n.y * d, -n.z * d));
      const plug = take(moved.intersect(A()));
      if (plug.volume() < 0.05) { JOIN.report[k] = why + '接触太少，没法做嵌入，建议直接用胶水。'; warnings.push(`${JOIN.parts[ia].name} 和 ${JOIN.parts[ib].name} 接触太少，没加连接，可以直接用胶水。`); return; }
      const pocket = take(grow(plug, fr.u, fr.v, fr.n, clr));
      cur[ib] = take(B().add(plug)); cur[ia] = take(A().subtract(pocket));
      JOIN.report[k] = why + `${JOIN.parts[ib].name} 底部多出 ${d}mm 的“榫头”，嵌进 ${JOIN.parts[ia].name} 的凹位。`;
    };
    if (method === 'seat' || c.type !== 'plane') { seat(); continue; }

    // ---------- 平面切口 ----------
    const fr = { u: c.fr.u.clone(), v: c.fr.v.clone(), n: c.fr.n.clone() };
    if (swap) { fr.n.negate(); fr.v.negate(); }
    const size = p.size > 0 ? p.size : null;
    const wall = 1.2;
    const autoCount = p.count > 0 ? p.count : c.area > 6000 ? 4 : c.area > 2500 ? 3 : c.area > 120 ? 2 : 1;
    const toWorld = (x, y) => c.origin.clone().addScaledVector(c.fr.u, x).addScaledVector(c.fr.v, y);

    if (method === 'dovetail') {
      const ax = principalAxis(c);
      const { maxD } = layoutPoints(c, 0, 1, 0);
      const w = size || Math.max(4, Math.min(12, (maxD - wall) * 1.1));
      const s = new THREE.Vector3().addScaledVector(c.fr.u, Math.cos(ax.ang)).addScaledVector(c.fr.v, Math.sin(ax.ang)).normalize();
      const q = new THREE.Vector3().crossVectors(fr.n, s);
      const ctr = toWorld(ax.cx, ax.cy);
      const hB = thickness(JOIN.parts[ib].geo, ctr, fr.n);
      const h = Math.min(p.depth * 0.6, 6, hB - 1.5);
      if (maxD < 3 || h < 2) { seat('接触面太窄，做不了燕尾，改用嵌入定位：'); continue; }
      const wt = w + 2 * h * Math.tan(15 * Math.PI / 180);
      const cs = W.CrossSection.ofPolygons([[[-w / 2, -0.8], [w / 2, -0.8], [w / 2, 0], [wt / 2, h], [-wt / 2, h], [-w / 2, 0]]]);
      const L = Math.hypot(c.sp.w, c.sp.h) * c.sp.res + 10;
      const rail = take(take(W.Manifold.extrude(cs, L)).translate(0, 0, -L / 2).transform(mat4(q, fr.n, s, ctr)));
      cs.delete();
      const both = take(A().add(B()));
      const key2 = take(rail.intersect(both));
      // 槽 = 键向两侧（q）和顶部（n）各扩一个间隙；沿滑动方向 s 不用扩
      const sh = (vx, f) => take(key2.translate(vx.x * f, vx.y * f, vx.z * f));
      const slot = take(W.Manifold.union([key2, sh(q, clr), sh(q, -clr), sh(fr.n, clr)]));
      cur[ia] = take(A().add(key2)); cur[ib] = take(B().subtract(slot));
      JOIN.report[k] = `${JOIN.parts[ia].name} 上长出宽 ${r1(w)}mm、高 ${r1(h)}mm 的燕尾键，${JOIN.parts[ib].name} 顺着它滑进去。`;
      continue;
    }

    const d = size || null;
    const dGuess = d || 5;
    let { pts, maxD } = layoutPoints(c, dGuess / 2 + clr + wall, autoCount, Math.max(dGuess * 2.5, 8));
    const dAuto = d || Math.max(3, Math.min(8, Math.floor((maxD - clr - wall) * 2 * 0.75 * 2) / 2));
    if (!d) ({ pts } = layoutPoints(c, dAuto / 2 + clr + wall, autoCount, Math.max(dAuto * 2.5, 8)));
    if (!pts.length || dAuto < 3) { seat('切面太窄，放不下销子，改用嵌入定位：'); continue; }
    const D = d || dAuto, r = D / 2;
    const placed = [];
    for (const [x, y] of pts) {
      const P = toWorld(x, y);
      const hA = thickness(JOIN.parts[ia].geo, P, fr.n.clone().negate()), hB = thickness(JOIN.parts[ib].geo, P, fr.n);
      const h = Math.min(p.depth, hA - wall, hB - wall);
      const minH = method === 'snap' ? 5 : 2.5;
      if (h < minH) continue;
      placed.push({ P, h });
    }
    if (!placed.length) { seat('零件太薄，挖不了足够深的孔，改用嵌入定位：'); continue; }

    const holesA = [], holesB = [], males = [];
    for (const { P, h } of placed) {
      const T = mat4(fr.u, fr.v, fr.n, P);
      const cyl = (rad, z0, z1, rad2 = rad) => take(take(W.Manifold.cylinder(z1 - z0, rad, rad2, SEG)).translate(0, 0, z0).transform(T));
      if (method === 'dowel') {
        holesA.push(cyl(r + clr, -h, 0.02)); holesB.push(cyl(r + clr, -0.02, h));
        extras.push({ geo: geoFrom(dowelPin(r, 2 * h - 0.6, take)), label: `定位销 Ø${D}` }); dowelN++;
      } else if (method === 'pin') {
        males.push(take(cyl(r, -0.6, h - 0.5).add(cyl(r, h - 0.5, h - 0.1, r - 0.4))));
        holesB.push(cyl(r + clr, -0.02, h + 0.3));
      } else if (method === 'snap') {
        const sz = snapSize(D);
        const L = 2 * h - 0.6, ins = h - 0.3;
        const box = (wx, wy, z0, z1) => take(take(W.Manifold.cube([wx, wy, z1 - z0])).translate(-wx / 2, -wy / 2, z0).transform(T));
        const slotW = sz.w + 2 * clr, slotT = sz.t + 2 * clr, chamW = sz.w + 2 * sz.b + 2 * clr + 0.2;
        holesA.push(box(slotW, slotT, -h - 0.2, 0.02), box(chamW, slotT, -h - 0.2, -(ins - 2.4 - 0.3)));
        holesB.push(box(slotW, slotT, -0.02, h + 0.2), box(chamW, slotT, ins - 2.4 - 0.3, h + 0.2));
        extras.push({ geo: geoFrom(snapClip(sz, L, take)), label: '卡扣' }); snapN++;
      }
    }
    if (holesA.length) cur[ia] = take(A().subtract(take(W.Manifold.union(holesA))));
    if (males.length) cur[ia] = take(A().add(take(W.Manifold.union(males))));
    if (holesB.length) cur[ib] = take(B().subtract(take(W.Manifold.union(holesB))));
    const hMin = Math.min(...placed.map(q => q.h));
    JOIN.report[k] = method === 'dowel' ? `${placed.length} 个 Ø${D} 定位销，每边深 ${r1(hMin)}mm`
      : method === 'pin' ? `${JOIN.parts[ia].name} 上 ${placed.length} 个 Ø${D} 凸销，插进 ${JOIN.parts[ib].name}`
      : `${placed.length} 个卡扣，每边插入 ${r1(hMin - 0.3)}mm`;
    if (placed.length < pts.length) JOIN.report[k] += `（有 ${pts.length - placed.length} 个位置太薄，跳过了）`;
  }

  // 输出几何
  cache.parts?.forEach(g => g.dispose()); cache.extras?.forEach(e => e.geo.dispose());
  cache = { key, parts: cur.map(m => geoFrom(m)), extras, notes, warnings };
  own.forEach(m => { if (!JOIN.parts.some(pt => pt.man === m)) m.delete(); });

  // 提示
  const fixed = JOIN.parts.filter(pt => pt.fixed);
  if (fixed.length) notes.push(`已自动补洞：${fixed.map(pt => `${pt.name}（${pt.fixed} 个）`).join('、')}。`);
  if (!contacts.length) warnings.push('没找到零件之间的接触。请确认上传的是“装配时的位置”（切完没有挪动过的零件）。');
  notes.push(`间隙按 ${clr}mm 计算${fit.measured ? '（来自你的公差测试）' : '（默认值）'}。`);
  if (dowelN) notes.push(`另外打印 ${dowelN} 根定位销：竖着打，用 PETG 或 PLA 都行；插不进去就把销子在砂纸上滚几圈。`);
  if (snapN) notes.push(`另外打印 ${snapN} 个卡扣：一定要平躺着打（导出时已经是平放的），这样弹片不容易断。PETG 比 PLA 更不容易断。`);
  notes.push('导出后零件会排开放在打印板上。在 Bambu Studio 里选中零件按 F（放平），选切口那一面贴床，打印最省支撑。');
  notes.push('嵌入定位、凸销这些地方建议再点一点胶，会更牢。');
}

const ck = c => `${c.a}|${c.b}`;

function dowelPin(r, L, take) {
  const M = W.Manifold, ch = Math.min(0.5, r * 0.25);
  return take(M.union([take(M.cylinder(ch, r - ch, r, SEG)), take(M.cylinder(L - 2 * ch, r, r, SEG).translate(0, 0, ch)), take(M.cylinder(ch, r, r - ch, SEG).translate(0, 0, L - ch))]));
}
function snapSize(D) { const w = Math.max(4, D); return { w, t: Math.max(3, Math.min(6, w * 0.75)), b: 0.5 }; }
/** 双头卡扣：轮廓在 XY 平面，Z 方向是厚度（平躺打印） */
function snapClip(sz, L, take) {
  const { w, t, b } = sz, hl = L / 2, ws = Math.max(1, w * 0.3), sl = Math.min(hl - 1.2, 5.5);
  const head = s => [[-(w / 2 + b), s * (hl - 2.4)], [w / 2 + b, s * (hl - 2.4)], [w / 2 - 0.3, s * hl], [-(w / 2 - 0.3), s * hl]];
  let cs = W.CrossSection.ofPolygons([[[-w / 2, -hl + 0.01], [w / 2, -hl + 0.01], [w / 2, hl - 0.01], [-w / 2, hl - 0.01]]]);
  const add = poly => { const o = W.CrossSection.ofPolygons([poly]); const n = cs.add(o); cs.delete(); o.delete(); cs = n; };
  const sub = poly => { const o = W.CrossSection.ofPolygons([poly]); const n = cs.subtract(o); cs.delete(); o.delete(); cs = n; };
  add(head(1)); add(head(-1).reverse());
  sub([[-ws / 2, hl - sl], [ws / 2, hl - sl], [ws / 2, hl + 1], [-ws / 2, hl + 1]]);
  sub([[-ws / 2, -hl - 1], [ws / 2, -hl - 1], [ws / 2, -hl + sl], [-ws / 2, -hl + sl]]);
  const m = take(W.Manifold.extrude(cs, t)); cs.delete();
  return m;
}

function icon(d) { return `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`; }
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function problemAlert(problems, added) {
  return {
    title: added ? `有 ${problems.length} 个零件没法自动修好` : '这个文件没法自动修好',
    html: `<p>下面的零件网格有问题，我已经尝试自动补洞，但还是不能变成封闭的实体，所以没有加进来：</p>
      <ul>${problems.map(x => `<li><b>${escH(x.name)}</b>：${escH(x.why)}</li>`).join('')}</ul>
      <p>可以先用这些工具修一下再上传：</p>
      <ul><li><b>Bambu Studio</b>：导入后右键零件 →「修复模型」，再右键「导出为 STL」</li><li><b>Windows 3D Builder</b> / <b>Meshmixer</b> / <b>Blender 3D Print Toolbox</b>：都有一键修复</li></ul>`,
  };
}

function filesHTML() {
  const list = JOIN.parts.map(pt => `<li><span class="pdot" style="background:${pt.color}"></span><span class="pname">${escH(pt.name)}</span>
    ${pt.fixed ? `<span class="ptag fix">补了 ${pt.fixed} 个洞</span>` : '<span class="ptag ok">完好</span>'}
    <button class="pdel" data-act="remove" data-arg="${pt.id}" title="移除">×</button></li>`).join('');
  return `<button class="dropzone small" data-act="pick">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
      选择 STL / OBJ（可多选）<small>保持零件“装配时”的位置；一个文件多块或分开传都行</small></button>
    <div class="row-btns"><span class="muted">示例：</span><button class="chip" data-act="sample" data-arg="cake">分件蛋糕</button><button class="chip" data-act="sample" data-arg="vase">切开的花瓶</button>${JOIN.parts.length ? '<button class="link-btn" data-act="clear">清空</button>' : ''}</div>
    ${list ? `<ul class="plist2">${list}</ul>` : ''}`;
}

function contactsHTML() {
  if (!JOIN.contacts.length) return `<p class="muted small">${JOIN.parts.length > 1 ? '还没找到接触的地方（生成后会显示在这里）。' : '上传两个以上的零件后，这里会列出它们接触的地方。'}</p>`;
  return JOIN.contacts.map(c => {
    const A = JOIN.parts[c.a], B = JOIN.parts[c.b];
    if (!A || !B) return '';
    const cur = JOIN.overrides[c.key] || 'auto';
    const opts = c.type === 'plane' ? ['auto', 'dowel', 'pin', 'snap', 'dovetail', 'seat', 'none'] : ['auto', 'seat', 'none'];
    return `<div class="contact">
      <div class="c-top"><span class="pdot" style="background:${A.color}"></span>${escH(A.name)}<span class="c-arrow">↔</span><span class="pdot" style="background:${B.color}"></span>${escH(B.name)}</div>
      <div class="c-meta">${c.type === 'plane' ? `平面切口 · ${Math.round(c.area)} mm²` : '曲面贴合 / 嵌在一起'}</div>
      <div class="c-row"><div class="select"><select data-act="method" data-arg="${c.key}">${opts.map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>${METHOD_NAMES[o]}${o === 'auto' ? `（${c.type === 'plane' ? '按默认' : '嵌入定位'}）` : ''}</option>`).join('')}</select></div>
      <button class="chip" data-act="swap" data-arg="${c.key}" title="交换凸起 / 凹槽在哪一边">⇄ 换边</button></div>
      ${JOIN.report[c.key] ? `<div class="c-report">${escH(JOIN.report[c.key])}</div>` : ''}
    </div>`;
  }).join('');
}
