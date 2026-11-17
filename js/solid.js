/*
 * manifold-3d（WebAssembly）的加载，以及“三角网格 → 封闭实体”的通用工具。
 * 拼接连接件、参数零件，和「编辑用」导出（GLB，给 Blender / Nomad）都用这里。
 */
import * as THREE from 'three';

const MANIFOLD_URL = new URL('../vendor/manifold/manifold.js', import.meta.url).href; // 自带一份，不依赖外部 CDN
export let W = null;
export async function manifoldReady() {
  if (!W) { const { default: Module } = await import(MANIFOLD_URL); W = await Module(); W.setup(); }
  return W;
}

/** 焊接重合顶点、去掉退化和重复的三角形 */
export function weld(pos) {
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
export function splitComponents(verts, tris) {
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
export function orient(verts, tris) {
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
export function fillHoles(verts, tris) {
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

export function toManifold(verts, tris) {
  const mesh = new W.Mesh({ numProp: 3, vertProperties: verts, triVerts: tris });
  mesh.merge();
  try {
    const m = new W.Manifold(mesh);
    if (m.status && m.status() !== 'NoError') { m.delete(); return null; }
    return m;
  } catch { return null; }
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

// ---------------------------------------------------------------------------
//  「编辑用」导出（GLB，给 Blender / Nomad）
//  打开 SOLID.on 后重新生成一遍：网格加密（fine 倍），每个零件的各层用布尔并集合成
//  一个封闭、没有内部重叠面的实体——这样在 Blender 里布尔运算、在 Nomad 里重新拓扑和平滑都不会出错。
// ---------------------------------------------------------------------------
export const SOLID = { on: false, fine: 1 };

/** 三角网格（可能是几块封闭体拼在一起）→ 一个 manifold；修不好返回 null */
export function manOf(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const { verts, tris } = weld(g.attributes.position.array);
  if (g !== geo) g.dispose();
  const list = [];
  for (const c of splitComponents(verts, tris)) {
    let t = orient(c.verts, c.tris), m = toManifold(c.verts, t);
    if (!m) { const f = fillHoles(c.verts, t); m = toManifold(c.verts, orient(c.verts, f.tris)); }
    if (!m) { list.forEach(x => x.delete()); return null; }
    if (m.isEmpty()) { m.delete(); continue; }
    list.push(m);
  }
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const u = W.Manifold.union(list); list.forEach(x => x.delete());
  return u;
}

/** 几块几何体 → 一个并集几何体（参数零件里“叠在一起的几段挤出”用）；任何一块修不好就原样拼接 */
export function unionGeos(geos) {
  const ms = geos.map(manOf);
  if (ms.some(m => !m)) { ms.forEach(m => m && m.delete()); return null; }
  const u = ms.length === 1 ? ms[0] : W.Manifold.union(ms);
  const geo = geoFrom(u);
  if (u !== ms[0]) ms.forEach(m => m.delete());
  u.delete();
  return geo;
}

/** 导出前最后一步：零件 → 带索引的封闭网格 {pos, idx, ok}；修不好就原样输出（ok=false） */
export function solidMesh(geo) {
  const m = manOf(geo);
  if (m) {
    const mesh = m.getMesh(), np = mesh.numProp, v = mesh.vertProperties, n = mesh.numVert;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = v[i * np]; pos[i * 3 + 1] = v[i * np + 1]; pos[i * 3 + 2] = v[i * np + 2]; }
    const out = { pos, idx: new Uint32Array(mesh.triVerts), ok: true, genus: m.genus(), volume: m.volume() };
    m.delete();
    return out;
  }
  const g = geo.index ? geo.toNonIndexed() : geo;
  const { verts, tris } = weld(g.attributes.position.array);
  if (g !== geo) g.dispose();
  return { pos: verts, idx: tris, ok: false };
}
