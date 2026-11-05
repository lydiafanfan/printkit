/*
 * 打印助手 · 几何引擎
 *
 * 思路：所有 2D 形状都先画到一张“毫米网格”上（每个像素存 0..1 的覆盖度，0.5 是边界），
 * 加粗/外扩用距离场，填洞用泛洪，布尔运算用 max/min。
 * 然后把要挤出的东西描述成一叠「在 z0..z1 之间加上/减去某个形状」，
 * 按高度切成若干层，每层用 marching squares 描出平滑轮廓，再挤出成三维。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// ---------------------------------------------------------------------------
//  毫米网格
// ---------------------------------------------------------------------------
export class Space {
  /** 覆盖 [xmin,xmax]×[ymin,ymax]（毫米，y 向下），最长边约 maxPx 像素 */
  constructor(xmin, ymin, xmax, ymax, maxPx = 800) {
    this.res = Math.max(Math.max(xmax - xmin, ymax - ymin) / maxPx, 0.05);
    this.w = Math.ceil((xmax - xmin) / this.res);
    this.h = Math.ceil((ymax - ymin) / this.res);
    this.x0 = xmin; this.y0 = ymin;
    this.ymin = ymin; this.ymax = ymin + this.h * this.res;
    this.xmin = xmin; this.xmax = xmin + this.w * this.res;
  }
  field() { return new Float32Array(this.w * this.h); }
  canvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1 / this.res, 0, 0, 1 / this.res, -this.x0 / this.res, -this.y0 / this.res);
    return { c, ctx };
  }
  /** 用 Canvas 在毫米坐标里画形状，返回覆盖度场 */
  draw(fn) {
    const { ctx } = this.canvas();
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    fn(ctx);
    const d = ctx.getImageData(0, 0, this.w, this.h).data;
    const f = this.field();
    for (let i = 0; i < f.length; i++) f[i] = d[i * 4 + 3] / 255;
    return f;
  }
  rect(x, y, w, h, r = 0) { return this.draw(c => { c.beginPath(); c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); c.fill(); }); }
  circle(cx, cy, r) { return this.draw(c => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); }); }
  /** 像素 → 毫米（像素中心） */
  mm(px, py) { return [this.x0 + (px + 0.5) * this.res, this.y0 + (py + 0.5) * this.res]; }
}

// ---------------------------------------------------------------------------
//  场运算
// ---------------------------------------------------------------------------
export const F = {
  union(...fs) { const o = fs[0].slice(); for (let k = 1; k < fs.length; k++) { const f = fs[k]; for (let i = 0; i < o.length; i++) if (f[i] > o[i]) o[i] = f[i]; } return o; },
  sub(a, ...bs) { const o = a.slice(); for (const b of bs) for (let i = 0; i < o.length; i++) { const v = 1 - b[i]; if (v < o[i]) o[i] = v; } return o; },
  inter(a, b) { const o = a.slice(); for (let i = 0; i < o.length; i++) if (b[i] < o[i]) o[i] = b[i]; return o; },
  any(f) { for (let i = 0; i < f.length; i++) if (f[i] > 0.5) return true; return false; },
  /** 判断形状 b 是否完全落在 a 里面 */
  inside(b, a) { for (let i = 0; i < b.length; i++) if (b[i] > 0.5 && a[i] < 0.5) return false; return true; },
};

/** 欧氏距离变换（Felzenszwalb），返回每个像素到最近“内部”像素的平方距离 */
function edt(f, w, h) {
  const INF = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = f[i] >= 0.5 ? 0 : INF;
  const n = Math.max(w, h);
  const fb = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = len => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((fb[q] + q * q) - (fb[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((fb[q] + q * q) - (fb[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + fb[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) fb[y] = g[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fb[x] = g[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
  return g;
}

/** 向外扩 r 毫米（线条加粗、留边、刀刃厚度都用它） */
export function dilate(sp, f, rmm) {
  if (!(rmm > 0)) return f.slice();
  const r = rmm / sp.res;
  const d2 = edt(f, sp.w, sp.h);
  const o = new Float32Array(f.length);
  for (let i = 0; i < o.length; i++) {
    if (f[i] >= 0.5) { o[i] = 1; continue; }
    const v = r + 1 - Math.sqrt(d2[i]);
    o[i] = Math.max(f[i], v < 0 ? 0 : v > 1 ? 1 : v);
  }
  return o;
}
/** 向内缩 r 毫米 */
export function erode(sp, f, rmm) {
  const inv = f.map(v => 1 - v);
  return dilate(sp, inv, rmm).map(v => 1 - v);
}
/** 把封闭线条围起来的区域填实 */
export function fillHoles(sp, f) {
  const { w, h } = sp;
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = i => { if (!seen[i] && f[i] < 0.5) { seen[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const i = stack[--top], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  const o = f.slice();
  for (let i = 0; i < o.length; i++) if (!seen[i]) o[i] = 1;
  return o;
}
/** 形状上离 (cx,cy) 最远的点有多远（毫米） */
export function maxRadius(sp, f, cx = 0, cy = 0) {
  let m = 0;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    if (f[y * sp.w + x] < 0.5) continue;
    const [mx, my] = sp.mm(x, y);
    const d = Math.hypot(mx - cx, my - cy);
    if (d > m) m = d;
  }
  return m + sp.res;
}
/** 形状的包围盒（毫米） */
export function bounds(sp, f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) {
    if (f[y * sp.w + x] < 0.5) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return null;
  return { x: sp.x0 + x0 * sp.res, y: sp.y0 + y0 * sp.res, w: (x1 - x0 + 1) * sp.res, h: (y1 - y0 + 1) * sp.res };
}
/** 从 (cx,cy) 沿某个方向走，找到离开形状的位置（毫米） */
export function edgeAlong(sp, f, cx, cy, angleDeg) {
  const a = angleDeg * Math.PI / 180, dx = Math.cos(a), dy = -Math.sin(a);
  let last = [cx, cy];
  for (let t = 0; t < 2000; t += sp.res * 0.5) {
    const x = cx + dx * t, y = cy + dy * t;
    const px = Math.floor((x - sp.x0) / sp.res), py = Math.floor((y - sp.y0) / sp.res);
    if (px < 0 || py < 0 || px >= sp.w || py >= sp.h) break;
    if (f[py * sp.w + px] >= 0.5) last = [x, y];
  }
  return last;
}
/** 形状重心（毫米） */
export function centroid(sp, f) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (f[y * sp.w + x] >= 0.5) { const [mx, my] = sp.mm(x, y); sx += mx; sy += my; n++; }
  return n ? [sx / n, sy / n] : [0, 0];
}

// ---------------------------------------------------------------------------
//  线稿（图片 / SVG / 文字）
// ---------------------------------------------------------------------------
export class Art {
  constructor(src, w, h, label) { this.src = src; this.w = w; this.h = h; this.label = label; this._an = null; this._bb = new Map(); }
  analysis() {
    if (this._an) return this._an;
    const s = Math.min(1, 900 / Math.max(this.w, this.h));
    const cw = Math.max(1, Math.round(this.w * s)), ch = Math.max(1, Math.round(this.h * s));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.src, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data;
    const lum = new Float32Array(cw * ch), alpha = new Float32Array(cw * ch);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      alpha[i] = d[i * 4 + 3] / 255;
    }
    return (this._an = { cw, ch, s, lum, alpha });
  }
  /** 有墨迹部分的包围盒（原图像素坐标） */
  bbox(img) {
    const key = `${img.threshold}|${img.invert}`;
    if (this._bb.has(key)) return this._bb.get(key);
    const { cw, ch, s, lum, alpha } = this.analysis();
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (ink(lum[i], alpha[i], img.invert) > img.threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const bb = x1 < 0 ? null : { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
    this._bb.set(key, bb);
    return bb;
  }
  /** 给定“最长边”尺寸，返回图案的宽高（毫米） */
  dims(img, size) {
    const bb = this.bbox(img);
    if (!bb) throw new Error('图里没找到线条，试试调整“阈值”或“反相”');
    const a = bb.h / bb.w;
    return a <= 1 ? { w: size, h: size * a } : { w: size / a, h: size };
  }
}
const ink = (lum, a, invert) => (invert ? a * lum : a * (1 - lum));

/** 把线稿画到网格的 rect（毫米）里，返回覆盖度场 */
export function rasterArt(sp, art, rect, img, mirror = false) {
  const bb = art.bbox(img);
  if (!bb) throw new Error('图里没找到线条，试试调整“阈值”或“反相”');
  const { ctx } = sp.canvas();
  if (mirror) { const cx = rect.x + rect.w / 2; ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.src, bb.x, bb.y, bb.w, bb.h, rect.x, rect.y, rect.w, rect.h);
  const d = ctx.getImageData(0, 0, sp.w, sp.h).data;
  const f = sp.field();
  for (let i = 0; i < f.length; i++) {
    const v = ink((0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255, d[i * 4 + 3] / 255, img.invert);
    const t = 0.5 + (v - img.threshold) * 3;
    f[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  return img.thicken > 0 ? dilate(sp, f, img.thicken / 2) : f;
}

const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('图片读取失败')); i.src = src; });

export async function artFromSVG(text, label = 'SVG') {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('这个 SVG 文件读不了');
  let w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
  const vb = svg.getAttribute('viewBox');
  if (vb) { const p = vb.trim().split(/[\s,]+/).map(Number); if (!(w > 0 && h > 0) || /%/.test(svg.getAttribute('width') || '')) { w = p[2]; h = p[3]; } }
  if (!(w > 0 && h > 0)) { w = 512; h = 512; }
  if (!vb) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const k = 2048 / Math.max(w, h);
  svg.setAttribute('width', w * k); svg.setAttribute('height', h * k);
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)));
  return new Art(img, w * k, h * k, label);
}
export async function artFromFile(file) {
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return artFromSVG(await file.text(), file.name);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Art(c, c.width, c.height, file.name);
  } finally { URL.revokeObjectURL(url); }
}
export function artFromText(text, font, bold) {
  const lines = String(text || '').split('\n').filter(l => l.trim());
  if (!lines.length) throw new Error('先输入文字');
  const fs = 260;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  const fontStr = `${bold ? 700 : 400} ${fs}px ${font}`;
  ctx.font = fontStr;
  const wmax = Math.max(...lines.map(l => ctx.measureText(l).width));
  c.width = Math.ceil(wmax + fs); c.height = Math.ceil(lines.length * fs * 1.2 + fs * 0.6);
  ctx = c.getContext('2d');
  ctx.font = fontStr; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, fs * 0.3 + fs * 1.2 * (i + 0.5)));
  return new Art(c, c.width, c.height, `文字「${lines.join(' ')}」`);
}

// ---------------------------------------------------------------------------
//  轮廓追踪（marching squares，带插值，内部始终在走向的同一侧）
// ---------------------------------------------------------------------------
const T = 0, R = 1, B = 2, L = 3;
const EMID = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
const CORN = [[0, 0, 8], [1, 0, 4], [1, 1, 2], [0, 1, 1]];
const RAW = { 1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 6: [[T, B]], 7: [[T, L]], 8: [[T, L]], 9: [[T, B]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]] };
const SADDLE = { 5: { in: [[T, L], [B, R]], out: [[T, R], [L, B]] }, 10: { in: [[T, R], [L, B]], out: [[T, L], [B, R]] } };
function orient(idx, [e1, e2]) {
  const p = EMID[e1], q = EMID[e2], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  let best = null, bd = Infinity;
  for (const c of CORN) { const d = (c[0] - mx) ** 2 + (c[1] - my) ** 2; if (d < bd - 1e-9) { bd = d; best = c; } }
  const cross = (q[0] - p[0]) * (best[1] - p[1]) - (q[1] - p[1]) * (best[0] - p[0]);
  return (cross > 0) === ((idx & best[2]) !== 0) ? [e1, e2] : [e2, e1];
}
const ORI = {};
for (const k in RAW) ORI[k] = RAW[k].map(pr => orient(+k, pr));
for (const k in SADDLE) ORI[k] = { in: SADDLE[k].in.map(pr => orient(+k, pr)), out: SADDLE[k].out.map(pr => orient(+k, pr)) };

function simplify(pts, tol) { // 闭合折线的 Douglas–Peucker
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  const rdp = (a, b) => {
    const [ax, ay] = pts[a], [bx, by] = pts[b % pts.length];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; rdp(a, mi); rdp(mi, b); }
  };
  const half = pts.length >> 1;
  keep[0] = keep[half] = 1;
  rdp(0, half); rdp(half, pts.length);
  return pts.filter((_, i) => keep[i]);
}
const area = p => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] * p[i][1] - p[i][0] * p[j][1]); return a / 2; };
function pip(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 返回 [{outer:[[x,y]..], holes:[[..]..]}]，单位毫米，y 向下 */
export function trace(sp, f, tolPx = 0.3) {
  const W = sp.w + 2, H = sp.h + 2;
  const g = new Float32Array(W * H);
  for (let y = 0; y < sp.h; y++) g.set(f.subarray(y * sp.w, y * sp.w + sp.w), (y + 1) * W + 1);
  const next = new Map(), pts = new Map();
  const hE = (i, j) => { const id = (j * W + i) * 2; if (!pts.has(id)) { const a = g[j * W + i], b = g[j * W + i + 1]; pts.set(id, [i + (0.5 - a) / (b - a), j]); } return id; };
  const vE = (i, j) => { const id = (j * W + i) * 2 + 1; if (!pts.has(id)) { const a = g[j * W + i], b = g[(j + 1) * W + i]; pts.set(id, [i, j + (0.5 - a) / (b - a)]); } return id; };
  const edge = (i, j, e) => (e === T ? hE(i, j) : e === B ? hE(i, j + 1) : e === L ? vE(i, j) : vE(i + 1, j));
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = g[j * W + i], b = g[j * W + i + 1], c = g[(j + 1) * W + i + 1], d = g[(j + 1) * W + i];
    const idx = (a > 0.5 ? 8 : 0) | (b > 0.5 ? 4 : 0) | (c > 0.5 ? 2 : 0) | (d > 0.5 ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const prs = idx === 5 || idx === 10 ? ORI[idx][(a + b + c + d) / 4 > 0.5 ? 'in' : 'out'] : ORI[idx];
    for (const [e1, e2] of prs) next.set(edge(i, j, e1), edge(i, j, e2));
  }
  const loops = [];
  const seen = new Set();
  for (const s of next.keys()) {
    if (seen.has(s)) continue;
    const loop = [];
    let e = s;
    while (e !== undefined && !seen.has(e)) { seen.add(e); const p = pts.get(e); loop.push([p[0] - 1, p[1] - 1]); e = next.get(e); }
    if (loop.length >= 3) loops.push(loop);
  }
  const minArea = Math.max(0.12 / (sp.res * sp.res), 2); // 去掉小于 ~0.12mm² 的噪点
  const outers = [], holes = [];
  for (let lp of loops) {
    lp = simplify(lp, tolPx);
    const a = area(lp);
    if (Math.abs(a) < minArea) continue;
    const mmPts = lp.map(([x, y]) => sp.mm(x, y));
    const bb = lp.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
    (a > 0 ? outers : holes).push({ px: lp, mm: mmPts, a: Math.abs(a), bb });
  }
  outers.sort((p, q) => p.a - q.a);
  const polys = outers.map(o => ({ outer: o.mm, holes: [], src: o }));
  for (const h of holes) {
    const host = polys.find(p => { const b = p.src.bb; return b[0] <= h.bb[0] && b[1] <= h.bb[1] && b[2] >= h.bb[2] && b[3] >= h.bb[3] && pip(h.px[0], p.src.px); });
    if (host) host.holes.push(h.mm);
  }
  return polys;
}

// ---------------------------------------------------------------------------
//  分层挤出
// ---------------------------------------------------------------------------
/** features: [{f, z0, z1, op:'add'|'sub'}] → 一个 BufferGeometry（z 向上，y 已翻转为向上） */
export function buildSolid(sp, features) {
  const zs = [...new Set(features.flatMap(ft => [ft.z0, ft.z1]).map(z => +z.toFixed(4)))].sort((a, b) => a - b);
  const layers = [];
  for (let k = 0; k < zs.length - 1; k++) {
    const za = zs[k], zb = zs[k + 1], zm = (za + zb) / 2;
    const act = features.filter(ft => ft.z0 < zm && ft.z1 > zm);
    const key = act.map(ft => features.indexOf(ft)).join(',');
    const prev = layers[layers.length - 1];
    if (prev && prev.key === key && Math.abs(prev.z1 - za) < 1e-6) { prev.z1 = zb; continue; }
    layers.push({ key, z0: za, z1: zb, act });
  }
  const geos = [];
  for (const L of layers) {
    const adds = L.act.filter(a => a.op !== 'sub').map(a => a.f);
    if (!adds.length) continue;
    let f = adds.length > 1 ? F.union(...adds) : adds[0];
    const subs = L.act.filter(a => a.op === 'sub').map(a => a.f);
    if (subs.length) f = F.sub(f, ...subs);
    const polys = trace(sp, f);
    if (!polys.length) continue;
    const shapes = polys.map(p => {
      const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x, -y)));
      s.holes = p.holes.map(h => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, -y))));
      return s;
    });
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: L.z1 - L.z0, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geo.translate(0, 0, L.z0);
    geos.push(geo);
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach(g => g.dispose());
  return merged;
}

/** 把几个零件从左到右排开，整体居中，底面在 z=0 */
export function layoutParts(parts, gap = 8) {
  let x = 0;
  for (const p of parts) {
    p.geo.computeBoundingBox();
    const b = p.geo.boundingBox;
    if (p !== parts[0] && !p.keepPlace) p.geo.translate(x - b.min.x, -(b.min.y + b.max.y) / 2, 0);
    p.geo.computeBoundingBox();
    x = p.geo.boundingBox.max.x + gap;
  }
  const box = new THREE.Box3();
  parts.forEach(p => box.union(p.geo.boundingBox));
  const c = box.getCenter(new THREE.Vector3());
  parts.forEach(p => { p.geo.translate(-c.x, -c.y, -box.min.z); p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); });
  box.makeEmpty(); parts.forEach(p => box.union(p.geo.boundingBox));
  return box;
}

export function exportSTL(parts) {
  const scene = new THREE.Scene();
  for (const p of parts) scene.add(new THREE.Mesh(p.geo));
  scene.updateMatrixWorld(true);
  return new STLExporter().parse(scene, { binary: true });
}

/** 形状内部每个像素到边缘的距离（毫米）——用来找“离边缘够远”的位置放连接件 */
export function distInside(sp, f) {
  const inv = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) inv[i] = f[i] >= 0.5 ? 0 : 1;
  const d2 = edt(inv, sp.w, sp.h);
  const out = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i] >= 0.5 ? Math.sqrt(d2[i]) * sp.res : 0;
  return out;
}
