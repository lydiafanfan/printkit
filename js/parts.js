/*
 * 参数化零件
 * 这里的几何体直接用数学形状建模（精确的圆、矩形），尺寸就是参数本身，
 * 只有刻字借用了光栅描边（字形不需要精确）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Space, trace } from './engine.js?v=21';

const CS = 48; // 圆弧细分（ExtrudeGeometry 会再乘系数，误差 < 0.005mm）
const r2 = v => Math.round(v * 100) / 100;

// ---------- 2D 形状工具（单位 mm，y 向上） ----------
function roundRect(target, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y); if (r) target.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  target.lineTo(x + w, y + h - r); if (r) target.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  target.lineTo(x + r, y + h); if (r) target.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  target.lineTo(x, y + r); if (r) target.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return target;
}
const rectShape = (x, y, w, h, r = 0) => roundRect(new THREE.Shape(), x, y, w, h, r);
const rectPath = (x, y, w, h, r = 0) => roundRect(new THREE.Path(), x, y, w, h, r);
const circleShape = (cx, cy, r) => { const s = new THREE.Shape(); s.absarc(cx, cy, r, 0, Math.PI * 2, false); return s; };
const circlePath = (cx, cy, r) => { const s = new THREE.Path(); s.absarc(cx, cy, r, 0, Math.PI * 2, true); return s; };

function extrude(shapes, z0, z1) {
  const g = new THREE.ExtrudeGeometry(shapes, { depth: z1 - z0, bevelEnabled: false, curveSegments: CS, steps: 1 });
  g.translate(0, 0, z0);
  return g.index ? g.toNonIndexed() : g;
}
function merge(geos) { const m = mergeGeometries(geos.filter(Boolean), false); geos.forEach(g => g && g.dispose()); return m; }

/** 文字 → 多边形（毫米，y 向上）；返回 {outers:[[Vector2]], islands:[[Vector2]]} */
function textPolys(text, cx, cy, h) {
  const w = h * 0.75 * text.length + 2;
  const sp = new Space(cx - w / 2, -cy - h, cx + w / 2, -cy + h, 320);
  const f = sp.draw(c => {
    c.font = `700 ${h * 1.32}px Inter, "Helvetica Neue", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, cx, -cy + h * 0.06);
  });
  const polys = trace(sp, f, 0.2);
  const toV = pts => pts.map(([x, y]) => new THREE.Vector2(x, -y));
  return { outers: polys.map(p => toV(p.outer)), islands: polys.flatMap(p => p.holes.map(toV)) };
}

// ---------- 全局：我的打印机配合间隙 ----------
export const FIT_KEY = 'printkit.fit';
export function getFit() {
  try { return { slide: 0.2, press: 0.1, measured: false, ...JSON.parse(localStorage.getItem(FIT_KEY) || '{}') }; } catch { return { slide: 0.2, press: 0.1, measured: false }; }
}
export function setFit(v) { try { localStorage.setItem(FIT_KEY, JSON.stringify({ ...getFit(), ...v, measured: true })); } catch { } }

const clearances = p => Array.from({ length: Math.round(p.count) }, (_, i) => r2(p.start + i * p.step));

const ic = d => `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${d}</svg>`;

// =====================================================================
//  公差测试件
// =====================================================================
export const TOLERANCE = {
  id: 'tolerance', name: '公差测试件', kind: 'param', cat: 'parts',
  tagline: '打一次就知道你的打印机该留多大间隙',
  defaults: { shape: 'round', D: 10, start: 0.05, step: 0.05, count: 8, plateT: 5, chamfer: true, labels: true },
  groups: [
    { title: '测试内容', params: [
      { k: 'shape', label: '孔的形状', type: 'cards', cols: 3, options: [
        ['round', '圆孔', '轴、销、螺丝', ic('<circle cx="20" cy="15" r="9"/><circle cx="20" cy="15" r="5" stroke-dasharray="2 2"/>')],
        ['square', '方孔', '盒盖、插槽', ic('<rect x="11" y="6" width="18" height="18" rx="1"/><rect x="15" y="10" width="10" height="10" stroke-dasharray="2 2"/>')],
        ['both', '都要', '两排一起测', ic('<circle cx="13" cy="15" r="6"/><rect x="22" y="9" width="12" height="12" rx="1"/>')],
      ] },
      { k: 'D', label: '测试柱尺寸', hint: '圆柱直径 / 方柱边长', type: 'range', min: 4, max: 20, step: 0.5, unit: 'mm' },
    ] },
    { title: '间隙档位', params: [
      { k: 'start', label: '最小间隙', type: 'range', min: 0, max: 0.5, step: 0.01, unit: 'mm' },
      { k: 'step', label: '每档递增', type: 'range', min: 0.02, max: 0.2, step: 0.01, unit: 'mm' },
      { k: 'count', label: '档数', type: 'range', min: 3, max: 10, step: 1, unit: '个' },
      { k: 'preview', type: 'info', render: p => `孔的尺寸：${clearances(p).map(c => r2(p.D + c)).join(' · ')} mm` },
    ] },
    { title: '细节', params: [
      { k: 'plateT', label: '孔板厚度', hint: '也是插入深度', type: 'range', min: 3, max: 12, step: 0.5, unit: 'mm' },
      { k: 'chamfer', label: '底部防象脚', hint: 'Bambu Studio 已开「象脚补偿」时可以关掉', type: 'toggle' },
      { k: 'labels', label: '刻上间隙数字', type: 'toggle' },
    ] },
    { title: '测试结果', params: [{ k: 'fit', type: 'fitpick' }] },
  ],
  clearances,
  build(_art, _img, p) {
    const cs = clearances(p);
    const D = p.D, n = cs.length;
    const pitch = D + Math.max(5, D * 0.5) + cs[n - 1];
    const rows = p.shape === 'both' ? ['round', 'square'] : [p.shape];
    const labelH = p.labels ? Math.min(4, Math.max(2.8, D * 0.3)) : 0;
    const rowH = D + cs[n - 1] + 7 + (p.labels ? labelH + 2 : 0);
    const L = n * pitch + 6, W = rows.length * rowH + 2;
    const x0 = -L / 2, y0 = -W / 2;
    const T = p.plateT, cham = p.chamfer ? 0.3 : 0, eng = p.labels ? 0.6 : 0;

    const holes = []; // {shape:'round'|'square', cx, cy, size}
    const labels = [];
    rows.forEach((kind, ri) => {
      const rowTop = W / 2 - 1 - ri * rowH;
      const cy = rowTop - 3.5 - (D + cs[n - 1]) / 2;
      cs.forEach((c, i) => {
        const cx = x0 + 3 + pitch * (i + 0.5);
        holes.push({ kind, cx, cy, size: D + c });
        if (p.labels) labels.push({ text: c.toFixed(2).replace(/^0/, ''), cx, cy: cy - (D + cs[n - 1]) / 2 - 2.2 - labelH / 2 });
      });
    });
    const holePath = (h, grow = 0) => h.kind === 'round'
      ? circlePath(h.cx, h.cy, (h.size + grow) / 2)
      : rectPath(h.cx - (h.size + grow) / 2, h.cy - (h.size + grow) / 2, h.size + grow, h.size + grow, 0);
    const plate = (grow, extraHoles = []) => {
      const s = rectShape(x0, y0, L, W, 3);
      s.holes = [...holes.map(h => holePath(h, grow)), ...extraHoles];
      return s;
    };
    const geos = [];
    if (cham) geos.push(extrude(plate(2 * cham), 0, cham));
    geos.push(extrude(plate(0), cham, T - eng));
    if (eng) {
      const glyphs = labels.map(l => textPolys(l.text, l.cx, l.cy, labelH));
      const glyphHoles = glyphs.flatMap(g => g.outers.map(o => new THREE.Path(o)));
      const islands = glyphs.flatMap(g => g.islands.map(o => new THREE.Shape(o)));
      geos.push(extrude([plate(0, glyphHoles), ...islands], T - eng, T));
    }
    const plateGeo = merge(geos);

    // 测试柱：手柄朝下，柱子朝上
    const pegs = rows.map(kind => {
      const grip = 2.4, hgt = T + 5;
      const hs = D + 10;
      const handle = kind === 'round' ? circleShape(0, 0, hs / 2) : rectShape(-hs / 2, -hs / 2, hs, hs, 2);
      const body = kind === 'round' ? circleShape(0, 0, D / 2) : rectShape(-D / 2, -D / 2, D, D, 0.4);
      const tip = kind === 'round' ? circleShape(0, 0, D / 2 - 0.4) : rectShape(-D / 2 + 0.4, -D / 2 + 0.4, D - 0.8, D - 0.8, 0.4);
      return { geo: merge([extrude(handle, 0, grip), extrude(body, grip, grip + hgt - 0.6), extrude(tip, grip + hgt - 0.6, grip + hgt)]), label: kind === 'round' ? '圆柱' : '方柱' };
    });

    const fit = getFit();
    return {
      parts: [{ geo: plateGeo, label: '孔板' }, ...pegs],
      notes: [
        `孔板 ${r2(L)}×${r2(W)}mm，孔尺寸从 ${r2(D + cs[0])} 到 ${r2(D + cs[n - 1])}mm；测试柱 ${r2(D)}mm。`,
        '孔板和测试柱都平放打印（柱子朝上），不需要支撑。用你以后打零件常用的耗材和设置来打。',
        'Bambu Studio → 工艺 → 质量里，「X-Y 孔洞补偿」和「X-Y 轮廓补偿」保持为 0，不然测出来不准。',
        '从孔板正面（有字的一面）把测试柱逐个插进去：能顺滑插拔的最小间隙 = 滑动配合；要用力才能压进去、但不会裂的 = 紧配合。',
        '测完在上面的「测试结果」里点选，以后的参数化零件会自动用这两个数。',
        fit.measured ? `当前保存的：滑动配合 ${fit.slide}mm，紧配合 ${fit.press}mm。` : '还没有保存测试结果，暂时按默认值（滑动 0.2mm、紧配合 0.1mm）计算。',
      ],
      colorChange: null,
    };
  },
};


// =====================================================================
//  收纳盒
// =====================================================================
/** 四个角分别指定半径的圆角矩形：r = [左下, 右下, 右上, 左上] */
function rect4(target, x, y, w, h, r) {
  const [a, b, c, d] = r.map(v => Math.max(0, Math.min(v, w / 2, h / 2)));
  target.moveTo(x + a, y);
  target.lineTo(x + w - b, y); if (b) target.absarc(x + w - b, y + b, b, -Math.PI / 2, 0, false);
  target.lineTo(x + w, y + h - c); if (c) target.absarc(x + w - c, y + h - c, c, 0, Math.PI / 2, false);
  target.lineTo(x + d, y + h); if (d) target.absarc(x + d, y + h - d, d, Math.PI / 2, Math.PI, false);
  target.lineTo(x, y + a); if (a) target.absarc(x + a, y + a, a, Math.PI, Math.PI * 1.5, false);
  return target;
}

export const STORAGE = {
  id: 'storage', name: '收纳盒', kind: 'param', cat: 'parts',
  tagline: '按内部尺寸生成，可分格、带盖、叠放',
  defaults: { W: 90, D: 60, H: 40, R: 4, cols: 3, rows: 1, divT: 1.2, divH: 100, wall: 1.6, floor: 1.2, lid: 'cap', lidT: 1.6, skirt: 8, lip: 4, stack: false, footH: 3 },
  groups: [
    { title: '内部尺寸', params: [
      { k: 'W', label: '宽', type: 'range', min: 15, max: 250, step: 1, unit: 'mm' },
      { k: 'D', label: '深', type: 'range', min: 15, max: 250, step: 1, unit: 'mm' },
      { k: 'H', label: '高', type: 'range', min: 8, max: 200, step: 1, unit: 'mm' },
      { k: 'R', label: '外圆角', type: 'range', min: 0, max: 20, step: 0.5, unit: 'mm' },
      { k: 'size', type: 'info', render: p => { const g = boxGeom(p); return `外尺寸 ${r2(g.Wo)} × ${r2(g.Do)} × ${r2(g.Ht)} mm${g.n > 1 ? ` · 每格 ${r2(g.cw)} × ${r2(g.cd)} mm` : ''}`; } },
    ] },
    { title: '分格', params: [
      { k: 'cols', label: '横向格数', type: 'range', min: 1, max: 8, step: 1, unit: '格' },
      { k: 'rows', label: '纵向格数', type: 'range', min: 1, max: 8, step: 1, unit: '格' },
      { k: 'divT', label: '隔板厚度', type: 'range', min: 0.8, max: 3, step: 0.1, unit: 'mm', show: p => p.cols * p.rows > 1 },
      { k: 'divH', label: '隔板高度', hint: '占盒子高度的百分比', type: 'range', min: 20, max: 100, step: 5, unit: '%', show: p => p.cols * p.rows > 1 },
    ] },
    { title: '盒壁', params: [
      { k: 'wall', label: '侧壁厚度', hint: 'P1S 0.4 喷嘴：1.6mm ≈ 4 圈墙', type: 'range', min: 0.8, max: 4, step: 0.1, unit: 'mm' },
      { k: 'floor', label: '底板厚度', type: 'range', min: 0.8, max: 4, step: 0.2, unit: 'mm' },
    ] },
    { title: '盖子', params: [
      { k: 'lid', type: 'cards', cols: 3, options: [
        ['none', '不要', '敞口', ic('<path d="M8 8v16h24V8"/>')],
        ['cap', '套盖', '盖在盒子外面', ic('<path d="M8 12v12h24V12"/><path d="M6 6h28v7H6z" fill="currentColor" fill-opacity=".15"/>')],
        ['inset', '内嵌盖', '卡进盒口里', ic('<path d="M8 8v16h24V8"/><path d="M7 6h26v3H7zM11 9v4h18V9" fill="currentColor" fill-opacity=".15"/>')],
      ] },
      { k: 'lidT', label: '盖板厚度', type: 'range', min: 1, max: 4, step: 0.2, unit: 'mm', show: p => p.lid !== 'none' },
      { k: 'skirt', label: '套边高度', type: 'range', min: 3, max: 25, step: 0.5, unit: 'mm', show: p => p.lid === 'cap' },
      { k: 'lip', label: '插入深度', type: 'range', min: 2, max: 10, step: 0.5, unit: 'mm', show: p => p.lid === 'inset' },
    ] },
    { title: '叠放', params: [
      { k: 'stack', label: '可以叠放', hint: '盒底做一圈台阶，能插进另一个同尺寸盒子的盒口', type: 'toggle' },
      { k: 'footH', label: '台阶高度', type: 'range', min: 1.5, max: 6, step: 0.5, unit: 'mm', show: p => p.stack },
      { k: 'fit', type: 'info', render: () => { const f = getFit(); return `盖子和叠放台阶按 ${f.slide}mm 间隙计算${f.measured ? '（来自你的公差测试）' : '（默认值，做一次公差测试会更准）'}`; } },
    ] },
  ],
  build(_a, _i, p) {
    const g = boxGeom(p);
    const { W, D, Wo, Do, Ro, Ri, clr, zf, Ht, cw, cd, cols, rows, divT } = g;
    const notes = [], warnings = [];
    const geos = [];
    const outer = () => rectShape(-Wo / 2, -Do / 2, Wo, Do, Ro);
    // 底部（可叠放时先做一圈缩进的台阶）
    if (p.stack) {
      const fw = W - 2 * clr, fd = D - 2 * clr;
      geos.push(extrude(rectShape(-fw / 2, -fd / 2, fw, fd, Math.max(0.4, Ri - clr)), 0, p.footH));
      geos.push(extrude(outer(), p.footH, zf));
    } else geos.push(extrude(outer(), 0, zf));
    // 分格区域
    let divTop = zf;
    if (g.n > 1) {
      let dh = p.H * p.divH / 100;
      const cap = Math.min(p.stack ? p.H - p.footH - 0.5 : Infinity, p.lid === 'inset' ? p.H - p.lip - 0.5 : Infinity);
      if (dh > cap) { dh = cap; notes.push(`隔板自动降到 ${r2(dh)}mm 高，给${p.lid === 'inset' ? '内嵌盖' : '叠放台阶'}留出位置。`); }
      if (dh > 0.5) {
        const s = outer();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const x = -W / 2 + c * (cw + divT), y = -D / 2 + r * (cd + divT);
          const R = [c === 0 && r === 0 ? Ri : 0.5, c === cols - 1 && r === 0 ? Ri : 0.5, c === cols - 1 && r === rows - 1 ? Ri : 0.5, c === 0 && r === rows - 1 ? Ri : 0.5];
          s.holes.push(rect4(new THREE.Path(), x, y, cw, cd, R));
        }
        geos.push(extrude(s, zf, zf + dh));
        divTop = zf + dh;
      }
    }
    if (divTop < Ht - 1e-6) {
      const s = outer(); s.holes = [rectPath(-W / 2, -D / 2, W, D, Ri)];
      geos.push(extrude(s, divTop, Ht));
    }
    const parts = [{ geo: merge(geos), label: '盒子' }];

    // 盖子（顶面朝下打印）
    if (p.lid === 'cap') {
      const lw = Math.max(1.2, p.wall), ow = Wo + 2 * (clr + lw), od = Do + 2 * (clr + lw);
      const top = rectShape(-ow / 2, -od / 2, ow, od, Ro + clr + lw);
      const ring = rectShape(-ow / 2, -od / 2, ow, od, Ro + clr + lw);
      ring.holes = [rectPath(-(Wo / 2 + clr), -(Do / 2 + clr), Wo + 2 * clr, Do + 2 * clr, Ro + clr)];
      parts.push({ geo: merge([extrude(top, 0, p.lidT), extrude(ring, p.lidT, p.lidT + p.skirt)]), label: '套盖' });
    } else if (p.lid === 'inset') {
      const lw = 1.2, iw = W - 2 * clr, id = D - 2 * clr;
      const ring = rectShape(-iw / 2, -id / 2, iw, id, Math.max(0.4, Ri - clr));
      ring.holes = [rectPath(-iw / 2 + lw, -id / 2 + lw, iw - 2 * lw, id - 2 * lw, Math.max(0.3, Ri - clr - lw))];
      parts.push({ geo: merge([extrude(rectShape(-Wo / 2, -Do / 2, Wo, Do, Ro), 0, p.lidT), extrude(ring, p.lidT, p.lidT + p.lip)]), label: '内嵌盖' });
    }

    if (Math.max(Wo, Do) > 256) warnings.push(`外尺寸 ${r2(Wo)}×${r2(Do)}mm 超过了 P1S 的 256mm 打印范围。`);
    if (cw < 8 || cd < 8) warnings.push(`每格只有 ${r2(cw)}×${r2(cd)}mm，格子太小了，可以减少格数。`);
    const f = getFit();
    notes.unshift(`外尺寸 ${r2(Wo)}×${r2(Do)}×${r2(Ht)}mm，内部 ${r2(W)}×${r2(D)}×${r2(p.H)}mm。`);
    notes.push('盒子开口朝上打印；盖子顶面朝下打印，都不需要支撑。');
    notes.push(`Bambu Studio 里把「墙层数」设到 ${Math.max(2, Math.round(p.wall / 0.42))} 或以上，让 ${p.wall}mm 的壁是实心的。`);
    if (p.lid !== 'none' || p.stack) notes.push(`盖子 / 叠放台阶的配合间隙是 ${f.slide}mm${f.measured ? '（来自你的公差测试）' : '（默认值；做一次公差测试会更准）'}。太松或太紧就去公差测试件里改。`);
    if (p.stack) notes.push(`盒底有 ${p.footH}mm 高的台阶，可以插进另一个同尺寸盒子的盒口叠起来。`);
    return { parts, notes, warnings, colorChange: null };
  },
};

function boxGeom(p) {
  const clr = getFit().slide;
  const W = p.W, D = p.D, Wo = W + 2 * p.wall, Do = D + 2 * p.wall;
  const Ro = Math.min(p.R, Wo / 2, Do / 2), Ri = Math.max(0.4, Ro - p.wall);
  const zf = p.stack ? Math.max(p.floor, p.footH + 0.6) : p.floor;
  const cols = Math.round(p.cols), rows = Math.round(p.rows), divT = p.divT;
  const cw = (W - (cols - 1) * divT) / cols, cd = (D - (rows - 1) * divT) / rows;
  return { W, D, Wo, Do, Ro, Ri, clr, zf, Ht: zf + p.H, cw, cd, cols, rows, divT, n: cols * rows };
}

export const PARTS = [TOLERANCE, STORAGE];
