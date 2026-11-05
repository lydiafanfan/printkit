/* 打印助手 · 各个工具（参数定义 + 生成逻辑） */
import * as THREE from 'three';
import { FRAME_STUDIO } from './framestudio.js';
import { PARTS } from './parts.js';
import { JOINER } from './joiner.js';
import { PARTS2 } from './parts2.js';
import { Space, F, dilate, erode, fillHoles, maxRadius, bounds, edgeAlong, centroid, rasterArt, buildSolid } from './engine.js';

const r1 = v => Math.round(v * 10) / 10;

/** 在一个足够大的网格里放好线稿（以原点为中心） */
function placeArt(art, img, size, pad, opts = {}) {
  const d = art.dims(img, size);
  const half = Math.max(d.w, d.h) / 2 * (opts.round ? 1.45 : 1) + pad;
  const sp = new Space(-Math.max(half, d.w / 2 + pad), -Math.max(half, d.h / 2 + pad), Math.max(half, d.w / 2 + pad), Math.max(half, d.h / 2 + pad), opts.px || 800);
  const f = rasterArt(sp, art, { x: -d.w / 2, y: -d.h / 2, w: d.w, h: d.h }, img, !!opts.mirror);
  if (!F.any(f)) throw new Error('图案太细或太小，试试把“线条加粗”调大一点');
  return { sp, f, d };
}
function solid(sp, feats, label) {
  const geo = buildSolid(sp, feats);
  if (!geo) throw new Error('没有生成出形状，检查一下参数');
  return { geo, label };
}

// ---------------------------------------------------------------------------
export const TOOLS = [
  // ======================= 印章 =======================
  {
    id: 'stamp', name: '印章', tagline: '线稿或文字做成印章，自动镜像', sample: 'daisy',
    defaults: { size: 35, shape: 'circle', margin: 3, relief: 1.6, base: 4, mirror: true, border: true, borderW: 1.2, handle: true, handleH: 28 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '图案大小', hint: '图案最长的一边', type: 'range', min: 10, max: 120, step: 1, unit: 'mm' },
        { k: 'shape', label: '底座形状', type: 'seg', options: [['circle', '圆形'], ['round', '圆角方'], ['square', '方形'], ['follow', '随图案']] },
        { k: 'margin', label: '底座留边', type: 'range', min: 0, max: 15, step: 0.5, unit: 'mm' },
      ] },
      { title: '高度', params: [
        { k: 'relief', label: '图案凸起', hint: '1.2–2mm 比较好盖', type: 'range', min: 0.6, max: 4, step: 0.1, unit: 'mm' },
        { k: 'base', label: '底座厚度', type: 'range', min: 1.5, max: 10, step: 0.5, unit: 'mm' },
      ] },
      { title: '细节', params: [
        { k: 'mirror', label: '镜像图案', hint: '开着盖出来才是正的', type: 'toggle' },
        { k: 'border', label: '外圈边框', type: 'toggle' },
        { k: 'borderW', label: '边框粗细', type: 'range', min: 0.6, max: 4, step: 0.1, unit: 'mm', show: p => p.border },
        { k: 'handle', label: '附带手柄', hint: '单独打印，粘在背面', type: 'toggle' },
        { k: 'handleH', label: '手柄高度', type: 'range', min: 15, max: 60, step: 1, unit: 'mm', show: p => p.handle },
      ] },
    ],
    build(art, img, p) {
      const round = p.shape === 'circle';
      const { sp, f } = placeArt(art, img, p.size, p.margin + 3, { mirror: p.mirror, round });
      const d = art.dims(img, p.size);
      let base;
      if (p.shape === 'circle') base = sp.circle(0, 0, maxRadius(sp, f) + p.margin);
      else if (p.shape === 'follow') base = dilate(sp, fillHoles(sp, f), Math.max(p.margin, 0.8));
      else {
        const w = d.w + 2 * p.margin, h = d.h + 2 * p.margin;
        base = sp.rect(-w / 2, -h / 2, w, h, p.shape === 'round' ? Math.min(w, h) * 0.18 : 0.6);
      }
      const top = p.base + p.relief;
      const feats = [{ f: base, z0: 0, z1: p.base }, { f: F.inter(f, base), z0: p.base, z1: top }];
      if (p.border && p.shape !== 'follow') feats.push({ f: F.sub(base, erode(sp, base, p.borderW)), z0: p.base, z1: top });
      const parts = [solid(sp, feats, '印章')];
      const notes = [p.mirror ? '图案已经镜像，盖出来是正的。' : '图案没有镜像，盖出来会是反的。', '印面朝上打印，不需要支撑。'];
      if (p.handle) {
        const bb = bounds(sp, base);
        const rb = Math.max(7, Math.min(15, Math.min(bb.w, bb.h) * 0.32));
        parts.push({ geo: knob(rb, p.handleH), label: '手柄' });
        notes.push('手柄平的一面朝下单独打印，用 502 胶或 UHU 粘在印章背面中心。');
      }
      return { parts, notes, colorChange: null };
    },
  },

  // ======================= 线稿加厚 =======================
  {
    id: 'extrude', name: '线稿加厚', tagline: 'SVG / PNG 线稿变成有厚度的模型', sample: 'house',
    defaults: { size: 60, height: 2.4, solidFill: false, backing: 'none', backT: 1.6, margin: 2 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '图案大小', hint: '图案最长的一边', type: 'range', min: 10, max: 220, step: 1, unit: 'mm' },
        { k: 'height', label: '线条厚度', hint: '模型的高度', type: 'range', min: 0.6, max: 20, step: 0.2, unit: 'mm' },
        { k: 'solidFill', label: '填成实心', hint: '把线条围起来的地方都填满', type: 'toggle' },
      ] },
      { title: '底板', params: [
        { k: 'backing', label: '底板', type: 'seg', options: [['none', '不要'], ['follow', '随外形'], ['rect', '长方形']] },
        { k: 'backT', label: '底板厚度', type: 'range', min: 0.6, max: 6, step: 0.2, unit: 'mm', show: p => p.backing !== 'none' },
        { k: 'margin', label: '底板留边', type: 'range', min: 0, max: 15, step: 0.5, unit: 'mm', show: p => p.backing !== 'none' },
      ] },
    ],
    build(art, img, p) {
      const { sp, f: raw, d } = placeArt(art, img, p.size, p.margin + 3);
      const f = p.solidFill ? fillHoles(sp, raw) : raw;
      const notes = [];
      if (p.backing === 'none') {
        notes.push('线条之间没有连在一起的部分会变成单独的小块；想要整体一块，可以加底板。');
        return { parts: [solid(sp, [{ f, z0: 0, z1: p.height }], '模型')], notes, colorChange: null };
      }
      const back = p.backing === 'follow'
        ? dilate(sp, fillHoles(sp, f), Math.max(p.margin, 0.5))
        : sp.rect(-d.w / 2 - p.margin, -d.h / 2 - p.margin, d.w + 2 * p.margin, d.h + 2 * p.margin, 1.5);
      notes.push('底板朝下打印，不需要支撑。');
      return {
        parts: [solid(sp, [{ f: back, z0: 0, z1: p.backT }, { f: F.inter(f, back), z0: p.backT, z1: p.backT + p.height }], '模型')],
        notes, colorChange: p.backT,
      };
    },
  },

  // ======================= 钥匙扣 =======================
  {
    id: 'keychain', name: '钥匙扣', tagline: '图案加外圈和挂孔，可以双色打印', sample: 'cat',
    defaults: { size: 40, style: 'raise', backT: 2.4, relief: 1.2, margin: 2.5, holePos: 'top', holeD: 4.5, ring: 2.2 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '图案大小', hint: '图案最长的一边', type: 'range', min: 15, max: 90, step: 1, unit: 'mm' },
        { k: 'margin', label: '外圈宽度', type: 'range', min: 1, max: 8, step: 0.5, unit: 'mm' },
      ] },
      { title: '图案', params: [
        { k: 'style', label: '图案效果', type: 'seg', options: [['raise', '凸起'], ['engrave', '凹刻'], ['flush', '平面双色']] },
        { k: 'backT', label: '底板厚度', type: 'range', min: 1.2, max: 6, step: 0.2, unit: 'mm' },
        { k: 'relief', label: '图案高度', hint: '凸起高度 / 凹刻深度', type: 'range', min: 0.4, max: 3, step: 0.2, unit: 'mm', show: p => p.style !== 'flush' },
      ] },
      { title: '挂孔', params: [
        { k: 'holePos', label: '位置', type: 'seg', options: [['top', '正上'], ['tl', '左上'], ['tr', '右上'], ['left', '左边']] },
        { k: 'holeD', label: '孔直径', type: 'range', min: 2.5, max: 8, step: 0.5, unit: 'mm' },
        { k: 'ring', label: '孔圈宽度', type: 'range', min: 1.5, max: 4, step: 0.1, unit: 'mm' },
      ] },
    ],
    build(art, img, p) {
      const R = p.holeD / 2 + p.ring;
      const { sp, f } = placeArt(art, img, p.size, p.margin + 2 * R + 4);
      const back0 = dilate(sp, fillHoles(sp, f), p.margin);
      const ang = { top: 90, tl: 135, tr: 45, left: 180 }[p.holePos];
      const [cx, cy] = centroid(sp, back0);
      const [ex, ey] = edgeAlong(sp, back0, cx, cy, ang);
      const a = ang * Math.PI / 180, inset = Math.min(2.5, R * 0.6);
      const hx = ex + Math.cos(a) * (R - inset), hy = ey - Math.sin(a) * (R - inset);
      const back = F.union(back0, sp.circle(hx, hy, R));
      const hole = sp.circle(hx, hy, p.holeD / 2);
      const T = p.backT, art2 = F.inter(f, back0);
      let feats, colorChange;
      if (p.style === 'raise') { feats = [{ f: back, z0: 0, z1: T }, { f: art2, z0: T, z1: T + p.relief }]; colorChange = T; }
      else if (p.style === 'engrave') { feats = [{ f: back, z0: 0, z1: T }, { f: art2, z0: T - Math.min(p.relief, T - 0.6), z1: T, op: 'sub' }]; colorChange = null; }
      else { feats = [{ f: back, z0: 0, z1: T }]; colorChange = null; }
      feats.push({ f: hole, z0: 0, z1: T + p.relief + 1, op: 'sub' });
      const notes = ['底面朝下打印，不需要支撑。'];
      if (p.style === 'raise') notes.push(`想要双色：在高度 ${r1(T)}mm 处暂停换料。`);
      if (p.style === 'engrave') notes.push(`凹刻后可以用丙烯颜料填色，干了用砂纸磨掉多余部分。`);
      let parts = [solid(sp, feats, '钥匙扣')];
      if (p.style === 'flush') {
        // 平面双色：顶上 0.6mm 拆成图案和底色两部分，切片软件里分别指定颜色
        const top = 0.6;
        parts = [solid(sp, [{ f: back, z0: 0, z1: T - top }, { f: F.sub(back, art2), z0: T - top, z1: T }, { f: hole, z0: 0, z1: T + 1, op: 'sub' }], '底色'),
          solid(sp, [{ f: F.sub(art2, hole), z0: T - top, z1: T }], '图案')];
        parts.forEach(pt => { pt.keepPlace = true; });
        notes.push('平面双色：导出 3MF，Bambu Studio 里“底色”和“图案”两个零件分别选 AMS 耗材。');
      }
      return { parts, notes, colorChange };
    },
  },

  // ======================= 饼干模 =======================
  {
    id: 'cookie', name: '饼干模', tagline: '沿着外轮廓做刀刃，也能切黏土', sample: 'star',
    defaults: { size: 70, height: 14, wall: 1.6, blade: 0.8, bladeH: 3, flange: true, flangeW: 4, flangeT: 1.6, thicken: 0 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '饼干大小', hint: '最长的一边', type: 'range', min: 25, max: 150, step: 1, unit: 'mm' },
        { k: 'height', label: '模具高度', type: 'range', min: 8, max: 30, step: 0.5, unit: 'mm' },
      ] },
      { title: '刀刃', params: [
        { k: 'wall', label: '壁厚', hint: '至少 2 倍喷嘴直径', type: 'range', min: 0.8, max: 3, step: 0.1, unit: 'mm' },
        { k: 'blade', label: '刀刃厚度', hint: '顶部切面，越薄越锋利', type: 'range', min: 0.4, max: 1.6, step: 0.1, unit: 'mm' },
        { k: 'bladeH', label: '刀刃高度', type: 'range', min: 1, max: 8, step: 0.5, unit: 'mm' },
      ] },
      { title: '手扶边', params: [
        { k: 'flange', label: '底部加宽边', hint: '更稳、按起来不疼', type: 'toggle' },
        { k: 'flangeW', label: '加宽', type: 'range', min: 2, max: 10, step: 0.5, unit: 'mm', show: p => p.flange },
        { k: 'flangeT', label: '厚度', type: 'range', min: 1, max: 4, step: 0.2, unit: 'mm', show: p => p.flange },
      ] },
    ],
    build(art, img, p) {
      const pad = p.wall + p.flangeW + 3;
      const { sp, f } = placeArt(art, img, p.size, pad);
      const sil = fillHoles(sp, f);
      const ring = w => F.sub(dilate(sp, sil, w), sil);
      const feats = [
        { f: ring(p.wall), z0: 0, z1: p.height - p.bladeH },
        { f: ring(Math.min(p.blade, p.wall)), z0: p.height - p.bladeH, z1: p.height },
      ];
      if (p.flange) feats.push({ f: ring(p.wall + p.flangeW), z0: 0, z1: p.flangeT });
      return {
        parts: [solid(sp, feats, '饼干模')],
        notes: ['宽边朝下打印，刀刃朝上，不需要支撑。', '接触食物建议用 PLA，并只做短时间使用；用前用后清洗干净。'],
        colorChange: null,
      };
    },
  },

  // ======================= 仿欧根纱 =======================
  {
    id: 'organza', name: '仿欧根纱', tagline: '底部一层薄纱 + 凸起线条，像刺绣在纱上', sample: 'butterfly',
    defaults: { size: 60, gauze: 0.2, inset: 0, lineH: 0.6 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '图案大小', hint: '图案最长的一边', type: 'range', min: 15, max: 200, step: 1, unit: 'mm' },
      ] },
      { title: '纱层', params: [
        { k: 'gauze', label: '纱层厚度', hint: '设成 1–2 层的层高，比如 0.2 或 0.4', type: 'range', min: 0.08, max: 0.8, step: 0.02, unit: 'mm' },
        { k: 'inset', label: '纱层内缩', hint: '0 = 刚好填满轮廓；调大让纱藏在线条里面', type: 'range', min: 0, max: 2, step: 0.1, unit: 'mm' },
      ] },
      { title: '线条', params: [
        { k: 'lineH', label: '线条高出纱层', type: 'range', min: 0.2, max: 2.4, step: 0.1, unit: 'mm' },
      ] },
    ],
    build(art, img, p) {
      const { sp, f } = placeArt(art, img, p.size, 3);
      const sil = fillHoles(sp, f);
      // 纱层只在图案的外轮廓以内，不会超出主体
      const gauze = p.inset > 0 ? F.inter(erode(sp, sil, p.inset), sil) : sil;
      let a = 0, b = 0;
      for (let i = 0; i < f.length; i++) { if (f[i] >= 0.5) a++; if (gauze[i] >= 0.5) b++; }
      const warnings = [];
      if (b < a * 1.15) warnings.push('线稿的外轮廓好像没有闭合，纱层填不进去。请确认最外圈线条是连起来的，或在“图像调整”里把线条加粗一点。');
      const top = p.gauze + p.lineH;
      // 线条已经把整个轮廓盖满时（比如实心的字），就没有单独的纱层
      const gauzeGeo = buildSolid(sp, [{ f: F.sub(gauze, f), z0: 0, z1: p.gauze }]);
      if (!gauzeGeo) warnings.push('这张图的线条把整个轮廓都盖满了，没有露出纱的地方。仿欧根纱适合“线框”式的线稿；实心图案可以用“线稿加厚”。');
      return {
        // 拆成两个零件：线条 + 纱层（不重叠），方便多色打印机分别指定耗材
        parts: [
          { ...solid(sp, [{ f, z0: 0, z1: top }], '线条'), keepPlace: true },
          ...(gauzeGeo ? [{ geo: gauzeGeo, label: '纱层', keepPlace: true, translucent: true }] : []),
        ],
        warnings,
        notes: [
          '纱层用半透明或透明耗材效果最好（透明 PETG / 透明 PLA），线条可以换一个颜色。',
          '导出 3MF 后，“线条”和“纱层”是两个零件，在 Bambu Studio 里分别选 AMS 耗材就行；没有 AMS 就在纱层高度暂停换料。',
          '首层要慢一点、调平要好；纱层只有一两层，建议首层层高和“纱层厚度”一致。',
          '线条宽度最好 ≥ 0.8mm（两条挤出线），太细的话在“图像调整 → 线条加粗”里加粗。',
          '打完从打印板上慢慢揭下来，柔性 PEI 板弯一下更好取。',
        ],
        colorChange: p.gauze,
      };
    },
  },

  FRAME_STUDIO,
  ...PARTS,
  ...PARTS2,
  JOINER,
];

/** 印章手柄：底面是平的，上面一个圆头 */
function knob(rb, H) {
  const neck = rb * 0.4, ball = rb * 0.62;
  const yc = H - ball, th0 = Math.asin(neck / ball), yNeck = yc - ball * Math.cos(th0);
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(rb, 0), new THREE.Vector2(rb, 1.6)];
  for (let i = 1; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector2(neck + (rb - neck) * Math.pow(1 - t, 2.2), 1.6 + (yNeck - 1.6) * t)); }
  for (let i = 1; i <= 24; i++) { const th = th0 + (Math.PI - th0) * i / 24; pts.push(new THREE.Vector2(Math.max(0, ball * Math.sin(th)), yc - ball * Math.cos(th))); }
  const g = new THREE.LatheGeometry(pts, 72);
  g.rotateX(Math.PI / 2);
  return g.toNonIndexed();
}
