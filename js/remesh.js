/*
 * 均匀三角面（给 Blender / Nomad 雕刻用）
 *
 * 只重排“平面里面”的三角形，形状一点不变：
 *  - 长边从中点劈开（三角形劈成两半还在原来的平面上，任何边都可以劈）；
 *  - 短边收缩：只收“平面内部”的点（它周围一圈三角形都在同一个平面上），收到同一平面的邻点上；
 *  - 翻边：两侧三角形共面时，按 Delaunay（对角之和 > 180°）翻，三角形更接近等边；
 *  - 平滑：平面内部的点挪到邻点的平均位置（仍在这个平面里）。
 * 棱、台阶、轮廓上的点一个都不动，所以外形、尺寸和原来完全一样；网格始终保持封闭。
 * 思路来自 Botsch & Kobbelt 的等边重网格，只是把它限制在平面区域内。
 */

const BIG = 67108864; // 2^26，边的键 = 小顶点号 * BIG + 大顶点号

/** pos: Float32Array/Float64Array（xyz），idx: Uint32Array；L：目标边长（毫米） → { pos: Float32Array, idx: Uint32Array } */
export function remeshFlat(pos, idx, L, { iters = 6 } = {}) {
  let P = Float64Array.from(pos), nV = pos.length / 3;
  let T = Int32Array.from(idx), nT = idx.length / 3;
  let dead = new Uint8Array(nT);
  const hi = (4 / 3) * L, lo = (4 / 5) * L, hi2 = hi * hi, lo2 = lo * lo;

  const growV = n => { if ((nV + n) * 3 > P.length) { const q = new Float64Array(Math.max(P.length * 2, (nV + n) * 3)); q.set(P); P = q; } };
  // TN：每个三角形所在平面的单位法线。劈、翻、收、平滑都不改变三角形所在的平面，所以只在开头算一次，
  // 劈出来的新三角形直接继承——比从很小的三角形重新算更准
  let TN = new Float64Array(nT * 3);
  const growT = n => {
    if ((nT + n) * 3 > T.length) {
      const len = Math.max(T.length * 2, (nT + n) * 3);
      const q = new Int32Array(len); q.set(T); T = q;
      const r = new Float64Array(len); r.set(TN); TN = r;
    }
    if (nT + n > dead.length) { const d = new Uint8Array(Math.max(dead.length * 2, nT + n)); d.set(dead); dead = d; }
  };
  const addV = (x, y, z) => { growV(1); P[nV * 3] = x; P[nV * 3 + 1] = y; P[nV * 3 + 2] = z; return nV++; };
  const addT = (a, b, c, from) => { growT(1); T[nT * 3] = a; T[nT * 3 + 1] = b; T[nT * 3 + 2] = c; TN[nT * 3] = TN[from * 3]; TN[nT * 3 + 1] = TN[from * 3 + 1]; TN[nT * 3 + 2] = TN[from * 3 + 2]; dead[nT] = 0; return nT++; };
  const d2 = (a, b) => { const x = P[a * 3] - P[b * 3], y = P[a * 3 + 1] - P[b * 3 + 1], z = P[a * 3 + 2] - P[b * 3 + 2]; return x * x + y * y + z * z; };
  /** 三角形 (a,b,c) 的法线（不归一化，长度 = 2×面积） */
  const cross = (a, b, c, out) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    return out;
  };
  const qa = [0, 0, 0];
  /** 三角形 (a,b,c) 的质量：等边 = 1，退化（面积 0）= 0 */
  const qual = (a, b, c) => {
    cross(a, b, c, qa);
    const m = Math.max(d2(a, b), d2(b, c), d2(c, a));
    return m > 0 ? Math.hypot(qa[0], qa[1], qa[2]) / m / 0.8660254 : 0;
  };
  const qualT = t => qual(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
  const n0 = [0, 0, 0];
  for (let t = 0; t < nT; t++) {
    cross(T[t * 3], T[t * 3 + 1], T[t * 3 + 2], n0);
    const l = Math.hypot(n0[0], n0[1], n0[2]) || 1;
    TN[t * 3] = n0[0] / l; TN[t * 3 + 1] = n0[1] / l; TN[t * 3 + 2] = n0[2] / l;
  }
  /** 两个三角形共面（共边，所以法线一致就共面） */
  const coplanar = (t, u) => TN[t * 3] * TN[u * 3] + TN[t * 3 + 1] * TN[u * 3 + 1] + TN[t * 3 + 2] * TN[u * 3 + 2] > 1 - 1e-9;

  // ---- 邻接：点 → 周围三角形（CSR）；边 → 两侧三角形（通过点的三角形列表找对边，不用哈希表） ----
  let eA, eB, eT0, eT1, nE, vOff, vTri;
  /** 含有有向边 x→y 的三角形 */
  const findHalf = (x, y) => {
    for (let i = vOff[x], e = vOff[x + 1]; i < e; i++) {
      const p = vTri[i] * 3;
      if ((T[p] === x && T[p + 1] === y) || (T[p + 1] === x && T[p + 2] === y) || (T[p + 2] === x && T[p] === y)) return vTri[i];
    }
    return -1;
  };
  const build = () => {
    const cnt = new Int32Array(nV + 1);
    for (let t = 0; t < nT; t++) { if (dead[t]) continue; cnt[T[t * 3] + 1]++; cnt[T[t * 3 + 1] + 1]++; cnt[T[t * 3 + 2] + 1]++; }
    for (let v = 0; v < nV; v++) cnt[v + 1] += cnt[v];
    vOff = cnt; vTri = new Int32Array(cnt[nV]);
    const fill = vOff.slice(0, nV);
    for (let t = 0; t < nT; t++) { if (dead[t]) continue; for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; vTri[fill[v]++] = t; } }
    const cap = nT * 2 + 8;
    if (!eA || eA.length < cap) { eA = new Int32Array(cap); eB = new Int32Array(cap); eT0 = new Int32Array(cap); eT1 = new Int32Array(cap); }
    nE = 0;
    for (let t = 0; t < nT; t++) {
      if (dead[t]) continue;
      for (let k = 0; k < 3; k++) {
        const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3];
        if (a < b) {
          eA[nE] = a; eB[nE] = b; eT0[nE] = t; eT1[nE] = findHalf(b, a); nE++;
        }
      }
    }
  };
  /** 点周围的三角形都在同一个平面上（= 平面内部的点，可以挪） */
  let flat = new Uint8Array(0);
  const computeFlat = () => {
    flat = new Uint8Array(nV);
    for (let v = 0; v < nV; v++) {
      const s = vOff[v], e = vOff[v + 1];
      if (e - s < 3) continue;
      const t0 = vTri[s];
      let ok = true;
      for (let i = s + 1; i < e && ok; i++) { const t = vTri[i]; if (TN[t0 * 3] * TN[t * 3] + TN[t0 * 3 + 1] * TN[t * 3 + 1] + TN[t0 * 3 + 2] * TN[t * 3 + 2] < 1 - 1e-9) ok = false; }
      flat[v] = ok ? 1 : 0;
    }
  };
  const ring = v => { // 点 v 的一圈邻点（去重）
    const out = [];
    for (let i = vOff[v]; i < vOff[v + 1]; i++) { const t = vTri[i]; for (let k = 0; k < 3; k++) { const w = T[t * 3 + k]; if (w !== v && !out.includes(w)) out.push(w); } }
    return out;
  };
  const third = (t, a, b) => { for (let k = 0; k < 3; k++) { const w = T[t * 3 + k]; if (w !== a && w !== b) return w; } return -1; };

  /** 把三角形 t 里的边 a-b 换成 a-m、m-b 两个三角形（保持朝向） */
  const splitTri = (t, a, b, m) => {
    for (let k = 0; k < 3; k++) {
      const x = T[t * 3 + k], y = T[t * 3 + (k + 1) % 3], z = T[t * 3 + (k + 2) % 3];
      if ((x === a && y === b) || (x === b && y === a)) { T[t * 3] = x; T[t * 3 + 1] = m; T[t * 3 + 2] = z; addT(m, y, z, t); return; }
    }
  };

  // ---- 1. 劈长边（每个三角形一轮只劈一条，劈完翻边让三角形变“胖”，再劈下一轮） ----
  const splitPass = () => {
    build();
    const list = [];
    for (let e = 0; e < nE; e++) if (eT1[e] >= 0 && d2(eA[e], eB[e]) > hi2) list.push(e);
    if (!list.length) return 0;
    list.sort((x, y) => d2(eA[y], eB[y]) - d2(eA[x], eB[x]));
    const used = new Uint8Array(nT);
    let n = 0;
    for (const e of list) {
      const t0 = eT0[e], t1 = eT1[e];
      if (used[t0] || used[t1]) continue;
      // 旁边是几乎没有面积的三角形就先不劈（等翻边把它变“胖”）：硬劈只会多出挤在一起的点和退化三角形
      if (qualT(t0) < 0.01 || qualT(t1) < 0.01) continue;
      used[t0] = used[t1] = 1;
      const a = eA[e], b = eB[e];
      const m = addV((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
      splitTri(t0, a, b, m); splitTri(t1, a, b, m);
      n++;
    }
    return n;
  };

  // ---- 2. 收短边（只收平面内部的点） ----
  const collapsePass = () => {
    build(); computeFlat();
    const lock = new Uint8Array(nT), gone = new Uint8Array(nV);
    const nn = [0, 0, 0], no = [0, 0, 0];
    let n = 0;
    for (let e = 0; e < nE; e++) {
      if (eT1[e] < 0) continue;
      let a = eA[e], b = eB[e];
      if (gone[a] || gone[b] || d2(a, b) >= lo2) continue;
      if (!flat[a]) { if (!flat[b]) continue; const s = a; a = b; b = s; } // 把 a（平面内部的点）收到 b 上
      let busy = false;
      for (let i = vOff[a]; i < vOff[a + 1] && !busy; i++) if (lock[vTri[i]] || dead[vTri[i]]) busy = true;
      for (let i = vOff[b]; i < vOff[b + 1] && !busy; i++) if (lock[vTri[i]] || dead[vTri[i]]) busy = true;
      if (busy) continue;
      // 连通条件：a、b 的公共邻点只能是这条边两侧三角形的第三个点
      const ra = ring(a), rb = ring(b);
      let common = 0; for (const w of ra) if (rb.includes(w)) common++;
      if (common !== 2) continue;
      // 收完以后：三角形不翻、不退化、不出现过长的边
      let ok = true;
      for (let i = vOff[a]; i < vOff[a + 1] && ok; i++) {
        const t = vTri[i];
        const x = T[t * 3], y = T[t * 3 + 1], z = T[t * 3 + 2];
        if (x === b || y === b || z === b) continue; // 这两个三角形会消失
        cross(x, y, z, no);
        const X = x === a ? b : x, Y = y === a ? b : y, Z = z === a ? b : z;
        cross(X, Y, Z, nn);
        const lo_ = Math.hypot(no[0], no[1], no[2]), ln = Math.hypot(nn[0], nn[1], nn[2]);
        if (ln < 1e-3 * hi2 || (nn[0] * no[0] + nn[1] * no[1] + nn[2] * no[2]) <= 0.2 * ln * lo_) ok = false;
        for (const w of [X, Y, Z]) if (w !== b && d2(w, b) > hi2) ok = false;
        if (ok && qual(X, Y, Z) < Math.min(0.1, qual(x, y, z))) ok = false;
      }
      if (!ok) continue;
      for (let i = vOff[a]; i < vOff[a + 1]; i++) {
        const t = vTri[i];
        lock[t] = 1;
        const x = T[t * 3], y = T[t * 3 + 1], z = T[t * 3 + 2];
        if (x === b || y === b || z === b) { dead[t] = 1; continue; }
        for (let k = 0; k < 3; k++) if (T[t * 3 + k] === a) T[t * 3 + k] = b;
      }
      for (let i = vOff[b]; i < vOff[b + 1]; i++) lock[vTri[i]] = 1;
      gone[a] = 1; n++;
    }
    return n;
  };

  // ---- 3. 翻边（两侧共面时按 Delaunay） ----
  const cot = (o, p, q) => { // 顶点 o 处角的余切
    const ux = P[p * 3] - P[o * 3], uy = P[p * 3 + 1] - P[o * 3 + 1], uz = P[p * 3 + 2] - P[o * 3 + 2];
    const vx = P[q * 3] - P[o * 3], vy = P[q * 3 + 1] - P[o * 3 + 1], vz = P[q * 3 + 2] - P[o * 3 + 2];
    return (ux * vx + uy * vy + uz * vz) / (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || 1e-30);
  };
  const flipPass = () => {
    build();
    const made = new Set(); // 这一轮翻出来的新边（点的三角形列表里还没有它们）
    const hasEdge = (c, d) => {
      if (made.has(c < d ? c * BIG + d : d * BIG + c)) return true;
      for (let i = vOff[c], e = vOff[c + 1]; i < e; i++) { const p = vTri[i] * 3; if (T[p] === d || T[p + 1] === d || T[p + 2] === d) return true; }
      return false;
    };
    const lock = new Uint8Array(nT), nn = [0, 0, 0], ref = [0, 0, 0];
    let n = 0;
    for (let e = 0; e < nE; e++) {
      const t0 = eT0[e], t1 = eT1[e];
      if (t1 < 0 || lock[t0] || lock[t1]) continue;
      if (!coplanar(t0, t1)) continue;
      const a = eA[e], b = eB[e], c = third(t0, a, b), d = third(t1, a, b);
      if (c < 0 || d < 0 || c === d) continue;
      if (cot(c, a, b) + cot(d, a, b) >= -1e-9) continue; // 对角之和 > 180° ⇔ 两个余切之和 < 0
      if (hasEdge(c, d)) continue;
      // t0 里 a→b 的方向决定新三角形的朝向
      let x = a, y = b;
      for (let k = 0; k < 3; k++) if (T[t0 * 3 + k] === b && T[t0 * 3 + (k + 1) % 3] === a) { x = b; y = a; }
      ref[0] = TN[t0 * 3]; ref[1] = TN[t0 * 3 + 1]; ref[2] = TN[t0 * 3 + 2];
      // 新三角形：(x, d, c) 和 (d, y, c)
      cross(x, d, c, nn); if (nn[0] * ref[0] + nn[1] * ref[1] + nn[2] * ref[2] <= 1e-12) continue;
      cross(d, y, c, nn); if (nn[0] * ref[0] + nn[1] * ref[1] + nn[2] * ref[2] <= 1e-12) continue;
      const qn = Math.min(qual(x, d, c), qual(d, y, c));
      if (qn < 0.02 && qn <= Math.min(qualT(t0), qualT(t1))) continue; // 不翻出几乎没有面积的三角形
      T[t0 * 3] = x; T[t0 * 3 + 1] = d; T[t0 * 3 + 2] = c;
      T[t1 * 3] = d; T[t1 * 3 + 1] = y; T[t1 * 3 + 2] = c;
      lock[t0] = lock[t1] = 1; made.add(c < d ? c * BIG + d : d * BIG + c);
      n++;
    }
    return n;
  };

  // ---- 4. 平滑（平面内部的点挪到邻点平均位置） ----
  const smoothPass = () => {
    build(); computeFlat();
    const nrm = [0, 0, 0], nn = [0, 0, 0], no = [0, 0, 0];
    for (let v = 0; v < nV; v++) {
      if (!flat[v] || vOff[v + 1] === vOff[v]) continue;
      const r = ring(v);
      let sx = 0, sy = 0, sz = 0;
      for (const w of r) { sx += P[w * 3]; sy += P[w * 3 + 1]; sz += P[w * 3 + 2]; }
      const k = r.length, ox = P[v * 3], oy = P[v * 3 + 1], oz = P[v * 3 + 2];
      const tv = vTri[vOff[v]]; nrm[0] = TN[tv * 3]; nrm[1] = TN[tv * 3 + 1]; nrm[2] = TN[tv * 3 + 2];
      let qx = sx / k - ox, qy = sy / k - oy, qz = sz / k - oz;
      const dn = qx * nrm[0] + qy * nrm[1] + qz * nrm[2]; qx -= dn * nrm[0]; qy -= dn * nrm[1]; qz -= dn * nrm[2]; // 留在平面里
      for (const s of [1, 0.5]) {
        const olds = [];
        const oq = [];
        for (let i = vOff[v]; i < vOff[v + 1]; i++) { const t = vTri[i]; cross(T[t * 3], T[t * 3 + 1], T[t * 3 + 2], no); olds.push(no.slice()); oq.push(qualT(t)); }
        P[v * 3] = ox + qx * s; P[v * 3 + 1] = oy + qy * s; P[v * 3 + 2] = oz + qz * s;
        let ok = true;
        for (let i = vOff[v], j = 0; i < vOff[v + 1] && ok; i++, j++) {
          const t = vTri[i]; cross(T[t * 3], T[t * 3 + 1], T[t * 3 + 2], nn);
          const o = olds[j], lo_ = Math.hypot(o[0], o[1], o[2]), ln = Math.hypot(nn[0], nn[1], nn[2]);
          if (ln < 0.05 * lo_ || nn[0] * o[0] + nn[1] * o[1] + nn[2] * o[2] <= 0 || qualT(t) < Math.min(0.1, oq[j])) ok = false;
        }
        if (ok) break;
        P[v * 3] = ox; P[v * 3 + 1] = oy; P[v * 3 + 2] = oz;
      }
    }
  };

  const tm = (name, f) => f();
  // 先把长条三角形劈到够短：每劈一轮就翻边几轮，让三角形先变“胖”，不然细长条会越劈越多
  for (let g = 0; g < 60; g++) {
    const s = tm('split0', splitPass);
    for (let f = 0; f < 3 && tm('flip0', flipPass) > nT * 0.01; f++);
    if (!s) break;
  }
  for (let it = 0; it < iters; it++) {
    for (let g = 0; g < 4 && tm('split', splitPass); g++);
    tm('collapse', collapsePass);
    tm('flip', flipPass);
    tm('smooth', () => (smoothPass(), 0));
  }
  tm('flip', flipPass);

  // ---- 压缩：去掉消失的三角形和没用到的点 ----
  const map = new Int32Array(nV).fill(-1), outT = [];
  let m = 0;
  for (let t = 0; t < nT; t++) {
    if (dead[t]) continue;
    for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (map[v] < 0) map[v] = m++; outT.push(map[v]); }
  }
  const outP = new Float32Array(m * 3);
  for (let v = 0; v < nV; v++) if (map[v] >= 0) { outP[map[v] * 3] = P[v * 3]; outP[map[v] * 3 + 1] = P[v * 3 + 1]; outP[map[v] * 3 + 2] = P[v * 3 + 2]; }
  return { pos: outP, idx: Uint32Array.from(outT) };
}

/** 三角形质量：最短高 / 最长边 归一化到等边 = 1。返回 {n, mean, p10, under03}（under03 = 质量低于 0.3 的比例） */
export function triQuality(pos, idx) {
  const q = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const l = [[a, b], [b, c], [c, a]].map(([i, j]) => Math.hypot(pos[i] - pos[j], pos[i + 1] - pos[j + 1], pos[i + 2] - pos[j + 2]));
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const A2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const lmax = Math.max(...l);
    q.push(lmax > 0 ? (A2 / lmax) / lmax / (Math.sqrt(3) / 2) : 0);
  }
  q.sort((x, y) => x - y);
  return { n: q.length, mean: q.reduce((s, x) => s + x, 0) / q.length, p10: q[Math.floor(q.length * 0.1)], under03: q.filter(x => x < 0.3).length / q.length };
}
