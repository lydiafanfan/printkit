/*
 * 相框工作室 · 高度图处理
 * 白色 = 最高，灰色 = 次高 …… 黑色 / 透明 = 空。
 * 图中间被实体包围的最大空区域 = 相片窗口。
 */
import { Art } from './engine.js?v=23';

// ---------- 旋转 ----------
const rotCache = new WeakMap();
export function rotateArt(art, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return art;
  let m = rotCache.get(art);
  if (!m) rotCache.set(art, (m = {}));
  if (m[deg]) return m[deg];
  const swap = deg % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = swap ? art.h : art.w; c.height = swap ? art.w : art.h;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2); ctx.rotate(deg * Math.PI / 180);
  ctx.drawImage(art.src, -art.w / 2, -art.h / 2, art.w, art.h);
  return (m[deg] = new Art(c, c.width, c.height, art.label));
}

// ---------- 分析：亮度层级 + 相片窗口 ----------
const hmCache = new WeakMap();
export function analyzeHM(art, { invert, emptyT }) {
  let m = hmCache.get(art);
  if (!m) hmCache.set(art, (m = new Map()));
  const key = `${invert}|${emptyT}`;
  if (m.has(key)) return m.get(key);

  const { cw, ch, s, lum, alpha } = art.analysis();
  const n = cw * ch, b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = alpha[i] * (invert ? 1 - lum[i] : lum[i]);

  // 1) 直方图找亮度峰值 = 层级
  const BINS = 64, hist = new Float64Array(BINS);
  let solid = 0;
  for (let i = 0; i < n; i++) if (b[i] >= emptyT) { hist[Math.min(BINS - 1, (b[i] * BINS) | 0)]++; solid++; }
  if (!solid) throw new Error('图里没找到亮的部分。规则是：白色最高，灰色次高，黑色或透明是空的。');
  const sm = hist.map((v, k) => (2 * v + (hist[k - 1] || 0) + (hist[k + 1] || 0)) / 4);
  let peaks = [];
  for (let k = 0; k < BINS; k++) {
    if (sm[k] < solid * 0.012) continue;
    if (sm[k] >= (sm[k - 1] ?? -1) && sm[k] > (sm[k + 1] ?? -1)) peaks.push({ b: (k + 0.5) / BINS, n: sm[k] });
  }
  if (!peaks.length) peaks = [{ b: 1, n: solid }];
  peaks.sort((p, q) => q.b - p.b);
  const merged = [];
  for (const p of peaks) { const l = merged[merged.length - 1]; if (l && l.b - p.b < 0.08) { if (p.n > l.n) merged[merged.length - 1] = p; } else merged.push(p); }
  peaks = merged.sort((p, q) => q.n - p.n).slice(0, 6).sort((p, q) => q.b - p.b);
  const levels = peaks.map((p, j) => ({
    b: p.b,
    hi: j === 0 ? Infinity : (peaks[j - 1].b + p.b) / 2,
    lo: j === peaks.length - 1 ? emptyT : (p.b + peaks[j + 1].b) / 2,
  }));
  for (const l of levels) { let c = 0; for (let i = 0; i < n; i++) if (b[i] >= l.lo && b[i] < l.hi) c++; l.share = c / solid; }

  // 2) 相片窗口：被实体围起来的最大空区域
  const empty = new Uint8Array(n);
  for (let i = 0; i < n; i++) empty[i] = b[i] < emptyT ? 1 : 0;
  const lab = new Int32Array(n); // 0 未访问, -1 外部, >0 封闭空区编号
  const stack = new Int32Array(n);
  const flood = (start, id) => {
    let top = 0, cnt = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    stack[top++] = start; lab[start] = id;
    while (top) {
      const i = stack[--top], x = i % cw, y = (i / cw) | 0;
      cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < cw - 1 ? i + 1 : -1, y > 0 ? i - cw : -1, y < ch - 1 ? i + cw : -1];
      for (const j of nb) if (j >= 0 && empty[j] && !lab[j]) { lab[j] = id; stack[top++] = j; }
    }
    return { cnt, x0, y0, x1, y1 };
  };
  for (let x = 0; x < cw; x++) { for (const i of [x, (ch - 1) * cw + x]) if (empty[i] && !lab[i]) flood(i, -1); }
  for (let y = 0; y < ch; y++) { for (const i of [y * cw, y * cw + cw - 1]) if (empty[i] && !lab[i]) flood(i, -1); }
  let best = null, id = 1;
  for (let i = 0; i < n; i++) if (empty[i] && !lab[i]) { const r = flood(i, ++id); if (!best || r.cnt > best.cnt) best = r; }
  let cx0 = Infinity, cy0 = Infinity, cx1 = -1, cy1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (!empty[y * cw + x]) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
  const toSrc = (x0, y0, x1, y1) => ({ x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s });
  const content = toSrc(cx0, cy0, cx1, cy1);
  const win = best && best.cnt > solid * 0.02 ? toSrc(best.x0, best.y0, best.x1, best.y1) : null;
  const res = { levels, win, content };
  m.set(key, res);
  return res;
}

export function levelName(b) { return b > 0.9 ? '白色' : b > 0.7 ? '浅灰' : b > 0.45 ? '灰色' : b > 0.25 ? '深灰' : '暗灰'; }
export function defaultHeights(n) {
  if (n === 1) return [5];
  return Array.from({ length: n }, (_, j) => +(6 - j * (6 - 3.6) / (n - 1)).toFixed(1));
}

// ---------- 光栅化到毫米网格 ----------
export function rasterBright(sp, art, rect, invert) {
  const { ctx } = sp.canvas();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(art.src, rect.x, rect.y, rect.w, rect.h);
  const d = ctx.getImageData(0, 0, sp.w, sp.h).data;
  const b = sp.field();
  for (let i = 0; i < b.length; i++) {
    const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255, a = d[i * 4 + 3] / 255;
    b[i] = a * (invert ? 1 - l : l);
  }
  return b;
}
const K = 5;
const step = (v, t) => { const r = 0.5 + (v - t) * K; return r < 0 ? 0 : r > 1 ? 1 : r; };
/** 亮度落在 [lo, hi) 之间的区域 */
export function bandField(b, lo, hi) {
  const f = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) f[i] = hi === Infinity ? step(b[i], lo) : Math.min(step(b[i], lo), 1 - step(b[i], hi));
  return f;
}

// ---------- 预览图（标出识别到的相片窗口） ----------
export function previewHM(art, info, invert) {
  const W = 320, k = W / Math.max(art.w, art.h * 0.8);
  const w = Math.round(art.w * k), h = Math.round(art.h * k);
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2;
  const g = c.getContext('2d'); g.scale(2, 2);
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? '#efebe4' : '#f7f4ef'; g.fillRect(x, y, 8, 8); }
  if (invert) g.filter = 'invert(1)';
  g.drawImage(art.src, 0, 0, w, h);
  g.filter = 'none';
  if (info.win) {
    const r = info.win;
    g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeStyle = '#ff6448';
    g.strokeRect(r.x * k + 1, r.y * k + 1, r.w * k - 2, r.h * k - 2);
    g.setLineDash([]);
    g.font = '600 11px Inter, "PingFang SC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t = '相片窗口', tw = g.measureText(t).width + 14, cx = (r.x + r.w / 2) * k, cy = (r.y + r.h / 2) * k;
    g.fillStyle = '#ff6448'; g.beginPath(); g.roundRect(cx - tw / 2, cy - 10, tw, 20, 10); g.fill();
    g.fillStyle = '#fff'; g.fillText(t, cx, cy + 0.5);
  }
  return c.toDataURL();
}

// ---------- 示例高度图（原创花边相框） ----------
export function sampleHeightmap() {
  const W = 1000, H = 1300;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const gray = v => `rgb(${v},${v},${v})`;
  // 底层：灰色波浪边外形
  g.fillStyle = gray(140);
  g.beginPath(); g.roundRect(70, 70, W - 140, H - 140, 50); g.fill();
  const R = 34;
  for (let x = 70 + R; x <= W - 70 - R + 1; x += 2 * R) { g.beginPath(); g.arc(x, 70, R, 0, 7); g.arc(x, H - 70, R, 0, 7); g.fill(); }
  for (let y = 70 + R; y <= H - 70 - R + 1; y += 2 * R) { g.beginPath(); g.arc(70, y, R, 0, 7); g.arc(W - 70, y, R, 0, 7); g.fill(); }
  // 中层：窗口边上一圈浅灰
  const wx = 240, wy = 270, ww = 520, wh = 760;
  g.fillStyle = gray(200); g.beginPath(); g.roundRect(wx - 34, wy - 34, ww + 68, wh + 68, 40); g.fill();
  // 顶层：白色细边框 + 四角小花 + 小圆点
  g.strokeStyle = '#fff'; g.lineWidth = 22;
  g.beginPath(); g.roundRect(wx - 95, wy - 95, ww + 190, wh + 190, 58); g.stroke();
  const flower = (x, y, r) => {
    g.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 - Math.PI / 2; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.72, 0, 7); g.fill(); }
    g.fillStyle = gray(200); g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fill();
  };
  flower(wx - 95, wy - 95, 34); flower(wx + ww + 95, wy - 95, 34); flower(wx - 95, wy + wh + 95, 34); flower(wx + ww + 95, wy + wh + 95, 34);
  g.fillStyle = '#fff';
  for (let x = wx + 20; x < wx + ww - 10; x += 60) { g.beginPath(); g.arc(x + 10, wy - 150, 11, 0, 7); g.arc(x + 10, wy + wh + 150, 11, 0, 7); g.fill(); }
  for (let y = wy + 20; y < wy + wh - 10; y += 60) { g.beginPath(); g.arc(wx - 150, y + 10, 11, 0, 7); g.arc(wx + ww + 150, y + 10, 11, 0, 7); g.fill(); }
  // 窗口：挖空
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.roundRect(wx, wy, ww, wh, 24); g.fill();
  return new Art(c, W, H, '示例 · 花边相框');
}
