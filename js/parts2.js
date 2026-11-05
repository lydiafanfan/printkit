/*
 * 参数化零件（第二批）：线轴架、标签牌、侧插扣。
 * 直接用 manifold-3d 做实体建模 → 输出一定是封闭网格，尺寸就是参数本身。
 */
import { Space, trace } from './engine.js';
import { manifoldReady, geoFrom } from './joiner.js';
import { getFit } from './parts.js';

let W = null;
const init = async () => { W = await manifoldReady(); };
const r1 = v => Math.round(v * 10) / 10;
const ic = d => `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;

/** 每次生成用一个“回收站”，最后统一释放 WASM 内存 */
function scope() {
  const list = [];
  const t = m => { list.push(m); return m; };
  t.free = () => { list.forEach(m => { try { m.delete(); } catch { } }); list.length = 0; };
  return t;
}
const area2 = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] - pts[i][0]) * (pts[j][1] + pts[i][1]); return a; };
const ccw = pts => (area2(pts) > 0 ? pts : pts.slice().reverse()); // 保证逆时针
function rrPoly(x, y, w, h, r, seg = 10) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  if (r < 0.05) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const pts = [], arc = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
  return pts;
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// =====================================================================
//  线轴架
// =====================================================================
const SPOOL_PRESETS = {
  small: { d: 6, h: 42, pitch: 32, name: '普通线轴' },
  cone: { d: 14, h: 95, pitch: 72, name: '宝塔线' },
  bobbin: { d: 5, h: 22, pitch: 25, name: '梭芯' },
};
export const SPOOLRACK = {
  id: 'spoolrack', name: '线轴架', kind: 'param', cat: 'parts', init,
  tagline: '放缝纫线、宝塔线、梭芯，可以放桌上或钉在墙上',
  defaults: { preset: 'small', pegD: 6, pegH: 42, pitch: 32, cols: 5, rows: 2, tilt: 12, baseT: 4, mount: 'desk' },
  groups: [
    { title: '放什么', params: [
      { k: 'preset', type: 'cards', cols: 2, options: [
        ['small', '普通线轴', '柱 Ø6 · 高 42', ic('<rect x="13" y="8" width="14" height="16" rx="2"/><path d="M11 8h18M11 24h18M20 2v28" stroke-width="1.2"/>')],
        ['cone', '宝塔线', '柱 Ø14 · 高 95', ic('<path d="M14 26l3-20h6l3 20z"/><path d="M20 2v28" stroke-width="1.2"/>')],
        ['bobbin', '梭芯', '柱 Ø5 · 高 22', ic('<ellipse cx="20" cy="15" rx="9" ry="9"/><circle cx="20" cy="15" r="3"/>')],
        ['custom', '自定义', '自己填尺寸', ic('<path d="M8 22h24M8 15h24M8 8h24"/><circle cx="14" cy="22" r="2"/><circle cx="26" cy="15" r="2"/><circle cx="18" cy="8" r="2"/>')],
      ] },
      { k: 'pegD', label: '柱子直径', hint: '比线轴中间的孔小 0.5–1mm', type: 'range', min: 3, max: 25, step: 0.5, unit: 'mm', show: p => p.preset === 'custom' },
      { k: 'pegH', label: '柱子高度', type: 'range', min: 10, max: 150, step: 1, unit: 'mm', show: p => p.preset === 'custom' },
      { k: 'pitch', label: '柱子间距', hint: '比线轴直径大一点', type: 'range', min: 10, max: 120, step: 1, unit: 'mm', show: p => p.preset === 'custom' },
    ] },
    { title: '排列', params: [
      { k: 'cols', label: '每排几个', type: 'range', min: 1, max: 10, step: 1, unit: '个' },
      { k: 'rows', label: '几排', type: 'range', min: 1, max: 6, step: 1, unit: '排' },
      { k: 'tilt', label: '柱子倾斜', hint: '上墙时往上翘，线轴不会滑出来', type: 'range', min: 0, max: 25, step: 1, unit: '°' },
      { k: 'size', type: 'info', render: p => { const g = spoolGeom(p); return `底板 ${r1(g.PW)} × ${r1(g.PD)} mm · 共 ${p.cols * p.rows} 根柱子`; } },
    ] },
    { title: '底座', params: [
      { k: 'baseT', label: '底板厚度', type: 'range', min: 2.4, max: 10, step: 0.2, unit: 'mm' },
      { k: 'mount', label: '放哪里', type: 'seg', options: [['desk', '桌面'], ['wall', '钉在墙上']] },
    ] },
  ],
  build(_a, _i, p) {
    const t = scope(), M = W.Manifold, CS = W.CrossSection;
    try {
      const g = spoolGeom(p);
      const base = t(M.extrude(t(CS.ofPolygons([rrPoly(-g.PW / 2, -g.PD / 2, g.PW, g.PD, 6)])), p.baseT));
      const r = g.d / 2, pegs = [];
      for (let j = 0; j < p.rows; j++) for (let i = 0; i < p.cols; i++) {
        const x = -((p.cols - 1) * g.px) / 2 + i * g.px, y = -((p.rows - 1) * g.py) / 2 + j * g.py;
        const foot = t(M.cylinder(3, r * 1.6, r, 48));                  // 根部加粗，不容易断
        const shaft = t(t(M.cylinder(g.h - 3.8, r, r, 48)).translate(0, 0, 3));
        const top = t(t(M.cylinder(0.8, r, Math.max(0.5, r - 0.8), 48)).translate(0, 0, g.h - 0.8));
        const peg = t(t(t(M.union([foot, shaft, top])).translate(0, 0, -1.5)).rotate([p.tilt, 0, 0]));
        pegs.push(t(peg.translate(x, y, p.baseT)));
      }
      let all = t(t(M.union([base, ...pegs])).trimByPlane([0, 0, 1], 0));
      if (p.mount === 'wall') {
        for (const sx of [-1, 1]) {
          const x = sx * (g.PW / 2 - 7);
          const hole = t(t(M.cylinder(p.baseT + 2, 2.2, 2.2, 32)).translate(x, 0, -1));
          const sink = t(t(M.cylinder(2.2, 2.2, 4.4, 32)).translate(x, 0, p.baseT - 2.2 + 0.01));
          all = t(all.subtract(hole).subtract(sink));
        }
      }
      const geo = geoFrom(all);
      const warnings = [];
      if (Math.max(g.PW, g.PD) > 256) warnings.push(`底板 ${r1(g.PW)}×${r1(g.PD)}mm 超过 P1S 的 256mm，减少一点数量或间距。`);
      if (g.h > 100) warnings.push('柱子很高，打印时可能晃动；建议在 Bambu Studio 里把这个模型的打印速度调慢一点。');
      return {
        parts: [{ geo, label: '线轴架' }], warnings, colorChange: null,
        notes: [
          `${SPOOL_PRESETS[p.preset]?.name || '自定义'}：柱子 Ø${g.d} × ${g.h}mm，间距 ${g.px}mm。`,
          '底板朝下打印，不需要支撑；柱子根部做了加粗，不容易掰断。',
          p.mount === 'wall' ? '左右两边有沉头螺丝孔（适合 M3.5–M4 木螺丝）。上墙时让柱子往上翘的那边朝上。' : '放桌上用。想更稳可以在底部贴防滑垫。',
          p.tilt ? `柱子倾斜 ${p.tilt}°，P1S 不用支撑就能打。` : '柱子是竖直的。',
        ],
      };
    } finally { t.free(); }
  },
};
function spoolGeom(p) {
  const pr = SPOOL_PRESETS[p.preset];
  const d = pr ? pr.d : p.pegD, h = pr ? pr.h : p.pegH, px = pr ? pr.pitch : p.pitch, py = px;
  const ear = p.mount === 'wall' ? 14 : 0;
  const pad = Math.max(px * 0.7, d * 1.6 + 8);
  return { d, h, px, py, PW: (p.cols - 1) * px + pad + 2 * ear, PD: (p.rows - 1) * py + pad };
}

// =====================================================================
//  标签牌
// =====================================================================
const LABEL_FONTS = [['"PingFang SC","Hiragino Sans GB",sans-serif', '黑体'], ['"Songti SC","STSong",serif', '宋体'], ['"Kaiti SC","STKaiti",serif', '楷体'], ['"Avenir Next","Futura","Helvetica Neue",sans-serif', 'Sans'], ['Georgia,serif', 'Serif']];
export const LABEL = {
  id: 'label', name: '标签牌', kind: 'param', cat: 'parts', init,
  tagline: '文字标签和挂牌，可以凸字、凹字或平面双色',
  defaults: { text: '布料 · 棉麻', font: '0', bold: true, textH: 8, shape: 'round', pad: 4, plateT: 2, style: 'raise', relief: 0.8, border: true, hole: 'left', holeD: 4.5, magnet: false, magD: 10, magT: 2 },
  groups: [
    { title: '文字', params: [
      { k: 'text', label: '内容', hint: '可以换行', type: 'text' },
      { k: 'font', label: '字体', type: 'seg', options: LABEL_FONTS.map(([, n], i) => [String(i), n]) },
      { k: 'bold', label: '粗体', type: 'toggle' },
      { k: 'textH', label: '字高', hint: 'P1S 0.4 喷嘴：凸字建议 ≥ 5mm', type: 'range', min: 3, max: 30, step: 0.5, unit: 'mm' },
    ] },
    { title: '形状', params: [
      { k: 'shape', type: 'cards', cols: 3, options: [
        ['round', '圆角', '', ic('<rect x="5" y="8" width="30" height="14" rx="4"/>')],
        ['pill', '胶囊', '', ic('<rect x="5" y="8" width="30" height="14" rx="7"/>')],
        ['tag', '吊牌', '', ic('<path d="M5 15l6-7h24v14H11z"/><circle cx="11" cy="15" r="1.6"/>')],
      ] },
      { k: 'pad', label: '留边', type: 'range', min: 1, max: 15, step: 0.5, unit: 'mm' },
      { k: 'border', label: '加一圈边框', type: 'toggle' },
      { k: 'hole', label: '挂孔', type: 'seg', options: [['none', '不要'], ['left', '左边'], ['top', '上边']] },
      { k: 'holeD', label: '孔直径', type: 'range', min: 2, max: 10, step: 0.5, unit: 'mm', show: p => p.hole !== 'none' },
    ] },
    { title: '效果', params: [
      { k: 'style', type: 'cards', cols: 3, options: [
        ['raise', '凸字', '可在凸起处换色', ic('<path d="M5 20h30v4H5z"/><path d="M12 20v-6h4v6M22 20v-6h6v6" />')],
        ['engrave', '凹字', '可以填颜料', ic('<path d="M5 14h30v10H5z"/><path d="M12 14v4h4v-4M22 14v4h6v-4"/>')],
        ['flush', '平面双色', 'AMS 分色', ic('<path d="M5 14h30v10H5z"/><path d="M12 14h4v3h-4zM22 14h6v3h-6z" fill="currentColor"/>')],
      ] },
      { k: 'plateT', label: '底板厚度', type: 'range', min: 1.2, max: 6, step: 0.2, unit: 'mm' },
      { k: 'relief', label: '凸起 / 凹陷', type: 'range', min: 0.4, max: 2, step: 0.1, unit: 'mm', show: p => p.style !== 'flush' },
      { k: 'magnet', label: '背面磁铁坑', hint: '贴在冰箱、铁柜上', type: 'toggle' },
      { k: 'magD', label: '磁铁直径', type: 'range', min: 4, max: 20, step: 0.5, unit: 'mm', show: p => p.magnet },
      { k: 'magT', label: '磁铁厚度', type: 'range', min: 1, max: 4, step: 0.5, unit: 'mm', show: p => p.magnet },
    ] },
  ],
  build(_a, _i, p) {
    const t = scope(), M = W.Manifold, CS = W.CrossSection;
    try {
      const lines = String(p.text || '').split('\n').filter(l => l.trim());
      if (!lines.length) throw new Error('先输入标签文字');
      const h = p.textH, font = (LABEL_FONTS[+p.font] || LABEL_FONTS[0])[0];
      const estW = Math.max(...lines.map(l => [...l].length)) * h * 1.1 + 4, estH = lines.length * h * 1.4 + 4;
      const sp = new Space(-estW / 2, -estH / 2, estW / 2, estH / 2, Math.min(2600, Math.ceil(Math.max(estW, estH) / 0.035)));
      const f = sp.draw(c => {
        c.font = `${p.bold ? 700 : 500} ${h * 1.3}px ${font}`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        lines.forEach((l, i) => c.fillText(l, 0, (i - (lines.length - 1) / 2) * h * 1.35));
      });
      const polys = trace(sp, f, 0.12);
      if (!polys.length) throw new Error('文字太小，生成不出来，把字高调大一点');
      const contours = polys.flatMap(q => [q.outer, ...q.holes]).map(pts => pts.map(([x, y]) => [x, -y]));
      const textCS = t(CS.ofPolygons(contours, 'EvenOdd'));
      const b = textCS.bounds();
      let x0 = b.min[0] - p.pad, x1 = b.max[0] + p.pad, y0 = b.min[1] - p.pad, y1 = b.max[1] + p.pad;
      const hr = p.holeD / 2, ring = 2.4;
      if (p.hole === 'left') x0 -= p.holeD + ring + 1;
      if (p.hole === 'top') y1 += p.holeD + ring + 1;
      const H = y1 - y0;
      let outline;
      if (p.shape === 'pill') outline = rrPoly(x0, y0, x1 - x0, H, H / 2, 16);
      else if (p.shape === 'tag') { const k = Math.min(H * 0.35, 10); outline = ccw([[x0, y0 + k], [x0 + k, y0], [x1, y0], [x1, y1], [x0 + k, y1], [x0, y1 - k]]); }
      else outline = rrPoly(x0, y0, x1 - x0, H, Math.min(4, H / 4));
      let plateCS = t(CS.ofPolygons([outline]));
      let holeXY = null;
      if (p.hole === 'left') holeXY = [x0 + hr + ring, (y0 + y1) / 2];
      if (p.hole === 'top') holeXY = [(x0 + x1) / 2, y1 - hr - ring];
      if (holeXY) plateCS = t(plateCS.subtract(t(t(CS.circle(hr, 40)).translate(holeXY))));
      const T = p.plateT;
      const ext = (cs, z0, z1) => t(t(M.extrude(cs, z1 - z0)).translate(0, 0, z0));
      const borderCS = p.border ? t(plateCS.subtract(t(plateCS.offset(-1.2, 'Round')))) : null;
      const parts = [], notes = [], warnings = [];
      let colorChange = null;
      if (p.style === 'raise') {
        const top = borderCS ? t(textCS.add(borderCS)) : textCS;
        const solid = t(M.union([ext(plateCS, 0, T), ext(t(top.intersect(plateCS)), T - 0.01, T + p.relief)]));
        parts.push({ geo: geoFrom(maybeMagnet(solid)), label: '标签' });
        colorChange = T;
        notes.push(`想要双色：在 ${r1(T)}mm 高度换料（Bambu Studio 预览里右键图层滑块）。`);
      } else if (p.style === 'engrave') {
        let solid = ext(plateCS, 0, T);
        const cut = borderCS ? t(textCS.add(t(plateCS.offset(-1.2, 'Round')).subtract(t(plateCS.offset(-2.2, 'Round'))))) : textCS;
        solid = t(solid.subtract(ext(cut, T - Math.min(p.relief, T - 0.6), T + 1)));
        parts.push({ geo: geoFrom(maybeMagnet(solid)), label: '标签' });
        notes.push('凹字里可以用丙烯颜料或指甲油填色，干了用砂纸把表面磨干净。');
      } else {
        const top = borderCS ? t(textCS.add(borderCS)).intersect(plateCS) : t(textCS.intersect(plateCS));
        t(top);
        const L = 0.6;
        const baseSolid = t(M.union([ext(plateCS, 0, T - L), ext(t(plateCS.subtract(top)), T - L - 0.01, T)]));
        parts.push({ geo: geoFrom(maybeMagnet(baseSolid)), label: '底色', keepPlace: true });
        parts.push({ geo: geoFrom(ext(top, T - L, T)), label: '文字', keepPlace: true });
        notes.push('平面双色：导出 3MF，Bambu Studio 里“底色”和“文字”分别选 AMS 耗材，表面是平的。');
      }
      function maybeMagnet(solid) {
        if (!p.magnet) return solid;
        if (p.magT + 0.6 > T) { warnings.push(`底板只有 ${T}mm，放不下 ${p.magT}mm 厚的磁铁，把底板加厚到 ${r1(p.magT + 0.8)}mm 以上。`); return solid; }
        const cx = (x0 + x1) / 2 + (p.hole === 'left' ? (p.holeD + ring + 1) / 2 : 0), cy = (y0 + y1) / 2 - (p.hole === 'top' ? (p.holeD + ring + 1) / 2 : 0);
        return t(solid.subtract(t(t(M.cylinder(p.magT + 0.2, p.magD / 2 + 0.15, p.magD / 2 + 0.15, 48)).translate(cx, cy, -0.01))));
      }
      if (h < 5 && p.style !== 'engrave') warnings.push('字高小于 5mm，笔画可能太细，0.4 喷嘴打出来会糊。可以调大字高或用凹字。');
      notes.unshift(`标签 ${r1(x1 - x0)} × ${r1(H)}mm。平放打印，不需要支撑。`);
      if (p.magnet) notes.push(`背面中间有 Ø${p.magD}×${p.magT}mm 的磁铁坑，挤一点胶把磁铁压进去。`);
      return { parts, notes, warnings, colorChange };
    } finally { t.free(); }
  },
};

// =====================================================================
//  侧插扣（背包带、宠物项圈那种）
// =====================================================================
export const BUCKLE = {
  id: 'buckle', name: '侧插扣', kind: 'param', cat: 'parts', init,
  tagline: '织带用的插扣：两边一捏就松开，平放打印',
  defaults: { W: 25, T: 2, tm: 4, aw: 3 },
  groups: [
    { title: '织带', params: [
      { k: 'W', label: '织带宽度', hint: '常见 20 / 25 / 38mm', type: 'range', min: 10, max: 50, step: 1, unit: 'mm' },
      { k: 'T', label: '织带厚度', type: 'range', min: 1, max: 4, step: 0.1, unit: 'mm' },
    ] },
    { title: '扣子', params: [
      { k: 'tm', label: '插头厚度', type: 'range', min: 3, max: 6, step: 0.2, unit: 'mm' },
      { k: 'aw', label: '弹片宽度', hint: '越宽越硬、越不容易断', type: 'range', min: 2, max: 4.5, step: 0.1, unit: 'mm' },
      { k: 'fit', type: 'info', render: () => { const f = getFit(); return `插头和插座之间留 ${f.slide}mm 间隙${f.measured ? '（来自你的公差测试）' : '（默认值）'}`; } },
    ] },
  ],
  build(_a, _i, p) {
    const t = scope(), M = W.Manifold, CS = W.CrossSection, c = getFit().slide;
    try {
      const Wi = p.W + 2, wall = 3.2, Fw = Wi + 2 * (wall + c), Lp = Math.max(18, p.W * 0.9), bw = 1.5, aw = p.aw;
      const slotH = p.T + 1.2, LB = 3 + slotH + 3;
      const poly = pts => t(CS.ofPolygons([ccw(pts)]));
      const U = list => t(CS.union(list));
      // ---- 插头（平放打印，弹片在平面内弯曲，最不容易断）
      const bar = t(poly(rect(-Fw / 2, 0, Fw / 2, LB)).subtract(poly(rect(-p.W / 2 - 0.6, 3, p.W / 2 + 0.6, 3 + slotH))));
      const arms = [], barbs = [];
      for (const s of [-1, 1]) {
        const xi = s * (Wi / 2 - aw), xo = s * Wi / 2;
        arms.push(poly([[Math.min(xi, xo), LB - 0.5], [Math.max(xi, xo), LB - 0.5], [Math.max(xi, xo) - (s > 0 ? 0.6 : 0), LB + Lp], [Math.min(xi, xo) + (s < 0 ? 0.6 : 0), LB + Lp]]));
        const y = LB + Lp;
        barbs.push(poly([[s * (Wi / 2 - 0.5), y - 6], [s * (Wi / 2 + bw), y - 6], [s * (Wi / 2 + bw), y - 4.8], [s * (Wi / 2 - 0.5), y - 0.6]]));
      }
      const guide = poly(rect(-2.2, LB - 0.5, 2.2, LB + Lp + 1.2));
      const maleCS = U([bar, ...arms, ...barbs, guide]);
      const male = t(M.extrude(maleCS, p.tm));
      // ---- 插座：底板 + 中间侧墙（带卡位窗口）+ 顶板；空腔高度 = 插头厚 + 2×间隙
      const Lh = Lp + 4, cavH = p.tm + 2 * c, plate = 1.6;
      const outer = U([poly(rrPoly(-Fw / 2, 0, Fw, Lh + 0.01, 2)), poly(rect(-Fw / 2, Lh, Fw / 2, Lh + LB))]);
      const strapSlot = poly(rect(-p.W / 2 - 0.6, Lh + 3, p.W / 2 + 0.6, Lh + 3 + slotH));
      const shell = t(outer.subtract(strapSlot));
      const cavity = poly(rect(-(Wi / 2 + c), -1, Wi / 2 + c, Lp + 2 + c));
      const windows = [-1, 1].map(s => poly(rect(Math.min(s * (Wi / 2 + c - 0.05), s * (Fw / 2 + 1)), Lp - 6 - 0.3, Math.max(s * (Wi / 2 + c - 0.05), s * (Fw / 2 + 1)), Lp - 0.4)));
      const mid = t(t(shell.subtract(cavity)).subtract(U(windows)));
      const ext = (cs, z0, z1) => t(t(M.extrude(cs, z1 - z0)).translate(0, 0, z0));
      const female = t(M.union([ext(shell, 0, plate), ext(mid, plate - 0.01, plate + cavH + 0.01), ext(shell, plate + cavH, plate + cavH + plate)]));
      return {
        parts: [{ geo: geoFrom(male), label: '插头' }, { geo: geoFrom(female), label: '插座' }],
        colorChange: null,
        warnings: p.aw < 2.6 ? ['弹片比较细，PLA 可能会断，建议用 PETG 或把弹片调宽一点。'] : [],
        notes: [
          `适合 ${p.W}mm 宽、${p.T}mm 厚的织带；扣子总宽 ${r1(Fw)}mm。`,
          '两个零件都平放打印，不需要支撑。插座顶面跨过插槽的地方是“搭桥”，P1S 默认设置就能打好。',
          '插头一定要平放打印：弹片在水平面里弯曲，层与层之间不受力，最不容易断。',
          '建议用 PETG（有韧性）；PLA 也能用，但别反复掰太多次。',
          '插进去听到“咔哒”一声就扣好了；捏住两侧窗口里的倒钩就能拔出来。',
        ],
      };
    } finally { t.free(); }
  },
};

export const PARTS2 = [SPOOLRACK, LABEL, BUCKLE];
