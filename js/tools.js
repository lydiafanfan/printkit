/* 打印助手 · 各个工具（参数定义 + 生成逻辑） */
import * as THREE from 'three';
import { FRAME_STUDIO } from './framestudio.js?v=14';
import { PARTS, getFit } from './parts.js?v=14';
import { JOINER } from './joiner.js?v=14';
import { PARTS2 } from './parts2.js?v=14';
import { Space, F, dilate, erode, fillHoles, maxRadius, bounds, edgeAlong, centroid, rasterArt, buildSolid, distInside } from './engine.js?v=14';

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


const HANDLE_ICON = d => `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${d}</svg>`;
const HANDLE_OPTIONS = [
  ['arch', '拱形提手', '最省料', HANDLE_ICON('<path d="M6 26h28"/><path d="M11 26V15a9 9 0 0 1 18 0v11M15 26V15a5 5 0 0 1 10 0v11"/>')],
  ['fin', '握片', '很省料', HANDLE_ICON('<path d="M6 26h28"/><path d="M12 26V10q0-4 4-4h8q4 0 4 4v16z"/><circle cx="20" cy="14" r="3.5"/>')],
  ['ring', '指环', '小章好用', HANDLE_ICON('<path d="M6 26h28"/><circle cx="20" cy="12" r="8"/><circle cx="20" cy="12" r="5"/><path d="M17 20v6M23 20v6"/>')],
  ['knob', '圆球柄', '最好握 · 费料', HANDLE_ICON('<path d="M6 26h28"/><path d="M14 26q0-4 4-6v-6"/><path d="M26 26q0-4-4-6v-6"/><circle cx="20" cy="9" r="6"/>')],
  ['none', '不要', '直接按', HANDLE_ICON('<path d="M6 26h28"/><path d="M14 12l12 10M26 12L14 22"/>')],
];

// ---------------------------------------------------------------------------
export const TOOLS = [
  // ======================= 印章 =======================
  {
    id: 'stamp', name: '印章', tagline: '线稿或文字做成印章，自动镜像', sample: 'daisy',
    defaults: { size: 35, shape: 'circle', margin: 3, relief: 1.6, base: 4, mirror: true, border: true, borderW: 1.2, handleType: 'arch', handleH: 26 },
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
      ] },
      { title: '手柄', params: [
        { k: 'handleType', type: 'cards', cols: 3, options: HANDLE_OPTIONS },
        { k: 'handleH', label: '手柄高度', type: 'range', min: 12, max: 60, step: 1, unit: 'mm', show: p => p.handleType !== 'none' },
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
      const notes = [p.mirror ? '图案已经镜像，盖出来是正的。' : '图案没有镜像，盖出来会是反的。', '印面朝上打印，不需要支撑。'];
      const hd = makeHandle(p.handleType, sp, base, p.handleH);
      if (hd) feats.push({ f: hd.recess, z0: 0, z1: 0.8, op: 'sub' });
      const parts = [solid(sp, feats, '印章')];
      if (hd) { parts.push({ geo: hd.geo, label: '手柄' }); notes.push(hd.note); }
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
    id: 'cookie', name: '饼干模', tagline: '外轮廓切模 + 带手柄的压花章，像月饼模一样压出内部细节', sample: 'daisy',
    defaults: { size: 70, height: 14, wall: 1.6, blade: 0.8, bladeH: 3, flange: true, flangeW: 4, flangeT: 1.6, thicken: 0, stamp: true, emboss: 2, plateT: 3, edgeSkip: 0.8, handleType: 'arch', handleH: 26 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '饼干大小', hint: '最长的一边', type: 'range', min: 25, max: 150, step: 1, unit: 'mm' },
        { k: 'height', label: '切模高度', type: 'range', min: 8, max: 30, step: 0.5, unit: 'mm' },
      ] },
      { title: '切模刀刃', params: [
        { k: 'wall', label: '壁厚', hint: '至少 2 倍喷嘴直径', type: 'range', min: 0.8, max: 3, step: 0.1, unit: 'mm' },
        { k: 'blade', label: '刀刃厚度', hint: '顶部切面，越薄越锋利', type: 'range', min: 0.4, max: 1.6, step: 0.1, unit: 'mm' },
        { k: 'bladeH', label: '刀刃高度', type: 'range', min: 1, max: 8, step: 0.5, unit: 'mm' },
        { k: 'flange', label: '底部加宽边', hint: '更稳、按起来不疼', type: 'toggle' },
        { k: 'flangeW', label: '加宽', type: 'range', min: 2, max: 10, step: 0.5, unit: 'mm', show: p => p.flange },
        { k: 'flangeT', label: '加宽边厚度', type: 'range', min: 1, max: 4, step: 0.2, unit: 'mm', show: p => p.flange },
      ] },
      { title: '压花章', params: [
        { k: 'stamp', label: '做压花章', hint: '图案内部的线条做成凸起，切完再压出细节', type: 'toggle' },
        { k: 'emboss', label: '花纹凸起', hint: '压进饼干的深度', type: 'range', min: 0.8, max: 5, step: 0.1, unit: 'mm', show: p => p.stamp },
        { k: 'plateT', label: '章面厚度', type: 'range', min: 2, max: 6, step: 0.2, unit: 'mm', show: p => p.stamp },
        { k: 'edgeSkip', label: '外圈额外留白', hint: '外轮廓那条线会自动去掉，这里是再往里留多少', type: 'range', min: 0, max: 6, step: 0.1, unit: 'mm', show: p => p.stamp },
      ] },
      { title: '压花章手柄', params: [
        { k: 'handleType', type: 'cards', cols: 3, options: HANDLE_OPTIONS, show: p => p.stamp },
        { k: 'handleH', label: '手柄高度', type: 'range', min: 12, max: 60, step: 1, unit: 'mm', show: p => p.stamp && p.handleType !== 'none' },
      ] },
    ],
    build(art, img, p) {
      const pad = p.wall + p.flangeW + 3;
      // 切模和压花章用的时候都要翻过来按在面团上，所以图案镜像，压出来的饼干才是正的
      const { sp, f } = placeArt(art, img, p.size, pad, { mirror: true });
      const sil = fillHoles(sp, f);
      const ring = w => F.sub(dilate(sp, sil, w), sil);
      const feats = [
        { f: ring(p.wall), z0: 0, z1: p.height - p.bladeH },
        { f: ring(Math.min(p.blade, p.wall)), z0: p.height - p.bladeH, z1: p.height },
      ];
      if (p.flange) feats.push({ f: ring(p.wall + p.flangeW), z0: 0, z1: p.flangeT });
      const parts = [solid(sp, feats, '切模')];
      const notes = ['切模：宽边朝下打印，刀刃朝上，不需要支撑。'];
      const warnings = [];
      if (p.stamp) {
        const clr = Math.max(0.3, getFit().slide + 0.1);
        const plate = erode(sp, sil, clr + 0.3);                   // 比切模内圈小一圈，能放进切模里压
        // 估算线条粗细（线条内部到边缘最远距离的 2 倍），把外轮廓那一整条线去掉
        const df = distInside(sp, f), vals = [];
        for (let i = 0; i < df.length; i++) if (df[i] > 0) vals.push(df[i]);
        vals.sort((a, b) => a - b);
        const strokeW = vals.length ? 2 * vals[Math.floor(vals.length * 0.95)] : 1;
        const skip = Math.max(strokeW + 0.4 + p.edgeSkip, clr + 0.8);
        const inner = F.inter(f, erode(sp, sil, skip));
        let n = 0; for (let i = 0; i < inner.length; i++) if (inner[i] >= 0.5) n++;
        if (n * sp.res * sp.res < 2) {
          warnings.push('这个图案内部没有线条，压花章会是平的，所以没生成。想要细节可以换一个内部有线条的图案，或者把“外圈留白”调小。');
        } else {
          const stampFeats = [{ f: plate, z0: 0, z1: p.plateT }, { f: inner, z0: p.plateT - 0.01, z1: p.plateT + p.emboss }];
          const hd = makeHandle(p.handleType, sp, plate, p.handleH);
          if (hd) stampFeats.push({ f: hd.recess, z0: 0, z1: 0.8, op: 'sub' }); // 背面定位槽，手柄插进去粘
          parts.push(solid(sp, stampFeats, '压花章'));
          if (hd) parts.push({ geo: hd.geo, label: '手柄' });
          notes.push('压花章：花纹朝上打印（背面贴床），不需要支撑。比切模内圈小一圈，可以直接放进切模里往下压。');
          if (hd) notes.push(hd.note.replace('胶水', '食品安全的胶'));
          notes.push('用法：先用切模切出饼干，切模不拿开，把压花章从上面放进去按一下，细节就压出来了。');
          if (p.emboss > p.size * 0.06) warnings.push('花纹凸起比较高，压得太深饼干可能会裂，可以先压浅一点试试。');
        }
      }
      notes.push('图案已经镜像：切模和压花章翻过来按在面团上时，压出来的饼干是正的。');
      notes.push('接触食物建议用 PLA，并只做短时间使用；用前用后清洗干净。');
      return { parts, notes, warnings, colorChange: null };
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
      let sil = fillHoles(sp, f), lines = f, bridged = 0;
      const count = g => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] >= 0.5) n++; return n; };
      const nf = count(f);
      const base0 = count(sil);
      if (base0 < nf * 1.3) {
        // 线条几乎没围出区域 = 外圈有缺口：线条“膨胀—填满—收回”（闭运算）把缺口补上；面积明显变大才算真的补上了
        const need = Math.max(nf * 1.3, base0 * 1.6);
        {
          for (const r of [0.6, 1.2, 2, 3, 4.5, 6, 8, 11, 15]) {
            const closed = erode(sp, fillHoles(sp, dilate(sp, f, r)), r);
            if (count(closed) >= need) { sil = F.union(closed, f); bridged = r; break; }
          }
          if (!bridged) {
            // 缺口太大：按整体外形（凸包）补齐
            const pts = [];
            for (let y = 0; y < sp.h; y += 2) for (let x = 0; x < sp.w; x += 2) if (f[y * sp.w + x] >= 0.5) pts.push(sp.mm(x, y));
            const hull = convexHull(pts);
            if (hull.length >= 3) {
              const hf = sp.draw(c => { c.beginPath(); hull.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); });
              if (count(hf) >= need) { sil = F.union(hf, f); bridged = -1; }
            }
          }
        }
        if (bridged) {
          // 在补上的缺口处也补一段线，让外圈完整
          const df = distInside(sp, f), vals = [];
          for (let i = 0; i < df.length; i++) if (df[i] > 0) vals.push(df[i]);
          vals.sort((x, y) => x - y);
          const w = Math.max(0.8, vals.length ? 2 * vals[Math.floor(vals.length * 0.9)] : 1);
          lines = F.union(f, F.sub(sil, erode(sp, sil, w)));
        }
      }
      // 纱层只在图案的外轮廓以内，不会超出主体
      const gauze = p.inset > 0 ? F.inter(erode(sp, sil, p.inset), sil) : sil;
      let a = 0, b = 0;
      for (let i = 0; i < lines.length; i++) { if (lines[i] >= 0.5) a++; if (gauze[i] >= 0.5) b++; }
      const warnings = [];
      if (b < a * 1.15) warnings.push('这张图的线条围不出一个区域（像一条单独的线），纱层没法铺。仿欧根纱适合有外轮廓的线稿。');
      const top = p.gauze + p.lineH;
      // 线条已经把整个轮廓盖满时（比如实心的字），就没有单独的纱层
      const gauzeGeo = buildSolid(sp, [{ f: F.sub(gauze, lines), z0: 0, z1: p.gauze }]);
      if (!gauzeGeo) warnings.push('这张图的线条把整个轮廓都盖满了，没有露出纱的地方。仿欧根纱适合“线框”式的线稿；实心图案可以用“线稿加厚”。');
      return {
        // 拆成两个零件：线条 + 纱层（不重叠），方便多色打印机分别指定耗材
        parts: [
          { ...solid(sp, [{ f: lines, z0: 0, z1: top }], '线条'), keepPlace: true },
          ...(gauzeGeo ? [{ geo: gauzeGeo, label: '纱层', keepPlace: true, second: true }] : []),
        ],
        warnings,
        ...(bridged ? { bridged } : {}),
        notes: [
          ...(bridged > 0 ? [`外圈有缺口，已经自动补上（缺口大约 ${r1(bridged * 2)}mm 以内），补的地方也加了一段线。`] : bridged < 0 ? ['外圈缺口比较大，已经按整体外形补齐，补的地方也加了一段线。'] : []),
          '纱层用半透明或透明耗材打印效果最好（透明 PETG / 透明 PLA）；预览里用“第二颜色”显示，方便看清。',
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

/**
 * 手柄（印章、饼干压花章共用）。除了圆球柄，其它都是平躺打印的薄片，很省料。
 * 返回：手柄几何、章背面对应的定位槽（覆盖度场）、打印提示。
 */
function makeHandle(type, sp, plate, H) {
  if (!type || type === 'none') return null;
  const bb = bounds(sp, plate), [cx, cy] = centroid(sp, plate), m = Math.min(bb.w, bb.h);
  const pathFrom = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); return s; };
  const flat = (shape, depth) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 }); return g.index ? g.toNonIndexed() : g; };
  let geo, recess, how;
  if (type === 'arch') {
    // ∩ 形：两只脚插进背面的两个小槽
    const L = Math.max(22, Math.min(m * 0.7, 70)), t = 3.2, w = 8, h = Math.max(12, H), R = Math.min(h, L / 2) * 0.85;
    const s = new THREE.Shape();
    s.moveTo(-L / 2, 0); s.lineTo(-L / 2, h - R); s.absarc(-L / 2 + R, h - R, R, Math.PI, Math.PI / 2, true);
    s.lineTo(L / 2 - R, h); s.absarc(L / 2 - R, h - R, R, Math.PI / 2, 0, true);
    s.lineTo(L / 2, 0); s.lineTo(L / 2 - t, 0);
    const r2 = R - t;
    s.lineTo(L / 2 - t, h - R); if (r2 > 0.5) s.absarc(L / 2 - R, h - R, r2, 0, Math.PI / 2, false);
    s.lineTo(-L / 2 + R, h - t); if (r2 > 0.5) s.absarc(-L / 2 + R, h - R, r2, Math.PI / 2, Math.PI, false);
    s.lineTo(-L / 2 + t, 0); s.lineTo(-L / 2, 0);
    geo = flat(s, w);
    recess = F.union(sp.rect(cx - L / 2 - 0.2, cy - w / 2 - 0.2, t + 0.4, w + 0.4), sp.rect(cx + L / 2 - t - 0.2, cy - w / 2 - 0.2, t + 0.4, w + 0.4));
    how = '拱形提手侧躺着打印（平的一面贴床），两只脚插进章背面的两个小槽里，点胶水固定。';
  } else if (type === 'fin') {
    const L = Math.max(20, Math.min(m * 0.5, 44)), t = 3, h = Math.max(12, H), r = Math.min(6, L / 3);
    const s = new THREE.Shape();
    s.moveTo(-L / 2, 0); s.lineTo(-L / 2, h - r); s.absarc(-L / 2 + r, h - r, r, Math.PI, Math.PI / 2, true);
    s.lineTo(L / 2 - r, h); s.absarc(L / 2 - r, h - r, r, Math.PI / 2, 0, true); s.lineTo(L / 2, 0); s.lineTo(-L / 2, 0);
    const hr = Math.min(8.5, L / 2 - 3, (h - 4) / 2.2);
    if (hr >= 4) { const hole = new THREE.Path(); hole.absarc(0, h * 0.58, hr, 0, Math.PI * 2, true); s.holes.push(hole); }
    geo = flat(s, t);
    recess = sp.rect(cx - L / 2 - 0.2, cy - t / 2 - 0.2, L + 0.4, t + 0.4);
    how = '握片平躺打印，竖着插进章背面的长槽里，点胶水固定。中间的孔可以穿一根手指。';
  } else if (type === 'ring') {
    const Ro = 12.5, Ri = 9.5, stem = 8, t = 6, sw = 12;
    const s = pathFrom([[-sw / 2, 0], [sw / 2, 0], [sw / 2, stem], [-sw / 2, stem]]);
    const ring = new THREE.Shape(); ring.absarc(0, stem + Ri + 1, Ro, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, stem + Ri + 1, Ri, 0, Math.PI * 2, true); ring.holes.push(hole);
    geo = mergeGeos([flat(s, t), flat(ring, t)]);
    recess = sp.rect(cx - sw / 2 - 0.2, cy - t / 2 - 0.2, sw + 0.4, t + 0.4);
    how = '指环平躺打印，底部的小方块插进章背面的槽里，点胶水固定；用的时候套在食指上。';
  } else {
    const rb = Math.max(7, Math.min(13, m * 0.22));
    geo = knob(rb, Math.max(15, H));
    recess = sp.circle(cx, cy, rb + 0.25);
    how = '圆球柄平底朝下单独打印，粘进章背面的圆形凹坑里。';
  }
  // 用料估算（按 PLA 1.24 g/cm³、实心算，实际切片有填充会更少）
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position;
  let v = 0; for (let i = 0; i < P.count; i += 3) v += P.getX(i) * (P.getY(i + 1) * P.getZ(i + 2) - P.getZ(i + 1) * P.getY(i + 2)) - P.getY(i) * (P.getX(i + 1) * P.getZ(i + 2) - P.getZ(i + 1) * P.getX(i + 2)) + P.getZ(i) * (P.getX(i + 1) * P.getY(i + 2) - P.getY(i + 1) * P.getX(i + 2));
  const grams = Math.abs(v) / 6 / 1000 * 1.24;
  return { geo, recess, note: `${how}（手柄最多约 ${grams < 1 ? grams.toFixed(1) : Math.round(grams)} g 耗材）` };
}
function mergeGeos(list) {
  const n = list.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3);
  let k = 0; for (const g of list) { pos.set(g.attributes.position.array, k); k += g.attributes.position.array.length; g.dispose(); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.computeVertexNormals();
  return out;
}

/** 二维凸包（Andrew 单调链） */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

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
