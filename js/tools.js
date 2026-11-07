/* 打印助手 · 各个工具（参数定义 + 生成逻辑） */
import * as THREE from 'three';
import { FRAME_STUDIO } from './framestudio.js?v=20';
import { PARTS, getFit } from './parts.js?v=20';
import { JOINER } from './joiner.js?v=20';
import { PARTS2 } from './parts2.js?v=20';
import { Space, F, dilate, erode, fillHoles, maxRadius, bounds, edgeAlong, centroid, rasterArt, buildSolid, distInside } from './engine.js?v=20';

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

const ic2 = d => `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">${d}</svg>`;
const GAUZE_ICONS = {
  solid: ic2('<rect x="6" y="5" width="28" height="20" rx="3" fill="currentColor" fill-opacity=".25"/>'),
  grid: ic2('<rect x="6" y="5" width="28" height="20" rx="3"/><path d="M13 5v20M20 5v20M27 5v20M6 12h28M6 18h28"/>'),
  diamond: ic2('<rect x="6" y="5" width="28" height="20" rx="3"/><path d="M6 13l8-8M6 21l16-16M10 25l20-20M18 25l16-16M26 25l8-8M6 13l12 12M6 5l20 20M14 5l20 20M22 5l12 12"/>'),
  hex: ic2('<rect x="6" y="5" width="28" height="20" rx="3"/><path d="M12 10l3-2 3 2v4l-3 2-3-2zM18 10l3-2 3 2v4l-3 2-3-2zM24 10l3-2 3 2v4l-3 2-3-2zM15 16l3-2 3 2v4l-3 2-3-2zM21 16l3-2 3 2v4l-3 2-3-2z"/>'),
  dots: ic2('<rect x="6" y="5" width="28" height="20" rx="3" fill="currentColor" fill-opacity=".12"/><g fill="currentColor" stroke="none"><circle cx="12" cy="10" r="1.6"/><circle cx="20" cy="10" r="1.6"/><circle cx="28" cy="10" r="1.6"/><circle cx="16" cy="15" r="1.6"/><circle cx="24" cy="15" r="1.6"/><circle cx="12" cy="20" r="1.6"/><circle cx="20" cy="20" r="1.6"/><circle cx="28" cy="20" r="1.6"/></g>'),
  scatter: ic2('<rect x="6" y="5" width="28" height="20" rx="3" fill="currentColor" fill-opacity=".12"/><g fill="currentColor" stroke="none"><circle cx="11" cy="10" r="2"/><circle cx="19" cy="8.5" r="1"/><circle cx="26" cy="11" r="1.7"/><circle cx="15" cy="17" r="1.2"/><circle cx="22" cy="19" r="2.2"/><circle cx="29.5" cy="18" r="1"/><circle cx="10" cy="21" r="1"/></g>'),
  lacedot: ic2('<rect x="6" y="5" width="28" height="20" rx="3"/><path d="M6 11l6-6 6 6 6-6 6 6 4-4M6 11l6 6 6-6 6 6 6-6 4 4M6 23l6-6 6 6 6-6 6 6" stroke-width="1"/><g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.5"/><circle cx="24" cy="5" r="1.5"/><circle cx="18" cy="11" r="1.5"/><circle cx="30" cy="11" r="1.5"/><circle cx="6.5" cy="11" r="1.5"/><circle cx="12" cy="17" r="1.5"/><circle cx="24" cy="17" r="1.5"/><circle cx="18" cy="23" r="1.5"/><circle cx="30" cy="23" r="1.5"/></g>'),
  eyelet: ic2('<path fill="currentColor" fill-opacity=".25" stroke="none" fill-rule="evenodd" d="M9 5h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM11.5 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM25.5 11a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0zM18.5 19a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0z"/><rect x="6" y="5" width="28" height="20" rx="3"/><g stroke-width="1.4"><circle cx="13" cy="11" r="2.2"/><circle cx="27" cy="11" r="2.2"/><circle cx="20" cy="19" r="2.2"/></g>'),
  scallop: ic2('<rect x="6" y="5" width="28" height="20" rx="3"/><path d="M6 9a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0M9.5 12.5a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0M6 16a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0M9.5 19.5a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0a3.5 3.5 0 0 0 7 0" stroke-width="1"/>'),
};

// ---------------------------------------------------------------------------
const BTN_ICONS = {
  two: ic2('<circle cx="20" cy="15" r="11"/><circle cx="20" cy="15" r="8" stroke-opacity=".45"/><circle cx="16.5" cy="15" r="1.7" fill="currentColor"/><circle cx="23.5" cy="15" r="1.7" fill="currentColor"/>'),
  four: ic2('<circle cx="20" cy="15" r="11"/><circle cx="20" cy="15" r="8" stroke-opacity=".45"/><circle cx="17" cy="12" r="1.5" fill="currentColor"/><circle cx="23" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="18" r="1.5" fill="currentColor"/><circle cx="23" cy="18" r="1.5" fill="currentColor"/>'),
};
const MESH_FILLS = ['grid', 'diamond', 'hex', 'scallop'];
const DOT_FILLS = ['dots', 'scatter', 'lacedot', 'eyelet'];

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
    defaults: { size: 60, gauze: 0.2, inset: 0, lineH: 0.6, fill: 'solid', meshGap: 2.5, meshW: 0.5, dotShape: 'circle', dotSize: 1.6, dotGap: 4, dotH: 0.4, dotColor: 'line', seed: 1 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '图案大小', hint: '图案最长的一边', type: 'range', min: 15, max: 200, step: 1, unit: 'mm' },
      ] },
      { title: '纱层', params: [
        { k: 'gauze', label: '纱层厚度', hint: '设成 1–2 层的层高，比如 0.2 或 0.4', type: 'range', min: 0.08, max: 0.8, step: 0.02, unit: 'mm' },
        { k: 'inset', label: '纱层内缩', hint: '0 = 刚好填满轮廓；调大让纱藏在线条里面', type: 'range', min: 0, max: 2, step: 0.1, unit: 'mm' },
        { k: 'fill', label: '纱的样子', type: 'cards', cols: 2, options: [
          ['solid', '实心纱', '一整片', GAUZE_ICONS.solid],
          ['grid', '方格网', '规整的小方格', GAUZE_ICONS.grid],
          ['diamond', '菱形网纱', '像婚纱头纱', GAUZE_ICONS.diamond],
          ['hex', '六角蕾丝网', '蜂窝状网眼', GAUZE_ICONS.hex],
          ['scallop', '鱼鳞蕾丝', '一排排小扇贝', GAUZE_ICONS.scallop],
          ['lacedot', '蕾丝波点', '网纱交点上缀小点', GAUZE_ICONS.lacedot],
          ['dots', '波点纱', '实心纱上整齐的小点', GAUZE_ICONS.dots],
          ['scatter', '自由波点', '大小不一、随意撒开', GAUZE_ICONS.scatter],
          ['eyelet', '洞洞绣', '纱上镂空小洞，洞边一圈凸起', GAUZE_ICONS.eyelet],
        ] },
        { k: 'meshGap', label: '网眼大小', hint: '网线之间的距离', type: 'range', min: 1, max: 6, step: 0.1, unit: 'mm', show: p => MESH_FILLS.includes(p.fill) },
        { k: 'meshW', label: '网线粗细', hint: 'P1S 0.4 喷嘴：0.45–0.6 最细又打得出来', type: 'range', min: 0.4, max: 1.2, step: 0.05, unit: 'mm', show: p => MESH_FILLS.includes(p.fill) || p.fill === 'lacedot' },
        { k: 'dotShape', label: '点的形状', type: 'seg', options: [['circle', '圆点'], ['flower', '小花'], ['star', '星星'], ['heart', '爱心']], show: p => DOT_FILLS.includes(p.fill) },
        { k: 'dotSize', label: '点的大小', hint: '直径；自由波点是最大的那颗，其他会小一些', type: 'range', min: 0.6, max: 6, step: 0.1, unit: 'mm', show: p => DOT_FILLS.includes(p.fill) },
        { k: 'dotGap', label: '点的间距', hint: '相邻两个点中心的距离；自由波点是大概的疏密', type: 'range', min: 1.5, max: 12, step: 0.1, unit: 'mm', show: p => DOT_FILLS.includes(p.fill) },
        { k: 'seed', label: '换一种撒法', hint: '拖一下就会重新随机撒点', type: 'range', min: 1, max: 60, step: 1, unit: '', show: p => p.fill === 'scatter' },
        { k: 'dotH', label: '点凸起', hint: '比纱层高出多少；0 = 平的。洞洞绣是洞边那一圈的高度', type: 'range', min: 0, max: 1.2, step: 0.05, unit: 'mm', show: p => DOT_FILLS.includes(p.fill) },
        { k: 'dotColor', label: '凸起部分的颜色', type: 'seg', options: [['line', '跟线条'], ['gauze', '跟纱层']], show: p => DOT_FILLS.includes(p.fill) && (p.dotH > 0 || p.fill !== 'lacedot') },
      ] },
      { title: '线条', params: [
        { k: 'lineH', label: '线条高出纱层', type: 'range', min: 0.2, max: 2.4, step: 0.1, unit: 'mm' },
      ] },
    ],
    build(art, img, p) {
      // 网纱的线很细，用更高的分辨率（每像素 ≤ 网线宽的 1/6）
      // 点类的纱按点的大小定分辨率（每像素 ≤ 点直径的 1/12）
      const isMesh = MESH_FILLS.includes(p.fill), isDot = DOT_FILLS.includes(p.fill);
      const fine = Math.min(isMesh || p.fill === 'lacedot' ? p.meshW / 6 : 9, isDot ? p.dotSize / 12 : 9, p.fill === 'eyelet' ? EYELET_RING / 5 : 9);
      const px = fine >= 9 ? 800 : Math.min(2200, Math.max(800, Math.ceil((p.size + 6) / fine)));
      const { sp, f } = placeArt(art, img, p.size, 3, { px });
      let { sil, bridged } = solidify(sp, f), lines = f;
      {
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
      let gauzeF = F.sub(gauze, lines), meshInfo = null, raised = null, dotInfo = null;
      if (isMesh) {
        // 网纱：图案 ∩ 纱层区域。网线一直延伸到外轮廓线上，所以整片自然连在一起
        gauzeF = F.sub(F.inter(meshPattern(sp, p.fill, p.meshGap, p.meshW), gauze), lines);
        meshInfo = connectMesh(sp, lines, gauzeF, gauze, p.meshGap);
        gauzeF = meshInfo.gauzeF;
      } else if (isDot) {
        dotInfo = dotGauze(sp, p, gauzeF, gauze, lines);
        gauzeF = dotInfo.gauzeF; raised = dotInfo.raised; meshInfo = dotInfo.meshInfo;
      }
      // 点的处理：凸起（在纱层上面加高）或者 0 高度时做成平面双色（嵌在纱层里，换成线条颜色）
      let rz = [], inlay = false;
      if (raised) {
        if (p.dotH > 0) rz = [{ f: raised, z0: p.gauze, z1: p.gauze + p.dotH }];
        else if (p.dotColor === 'line' && p.fill !== 'lacedot') { gauzeF = F.sub(gauzeF, raised); rz = [{ f: raised, z0: 0, z1: p.gauze }]; inlay = true; }
      }
      const raisedOnLine = rz.length > 0 && p.dotColor === 'line';
      const gauzeGeo = buildSolid(sp, [{ f: gauzeF, z0: 0, z1: p.gauze }, ...(raisedOnLine ? [] : rz)]);
      if (!gauzeGeo) warnings.push('这张图的线条把整个轮廓都盖满了，没有露出纱的地方。仿欧根纱适合“线框”式的线稿；实心图案可以用“线稿加厚”。');
      return {
        // 拆成两个零件：线条 + 纱层（不重叠），方便多色打印机分别指定耗材
        parts: [
          { ...solid(sp, [{ f: lines, z0: 0, z1: top }, ...(raisedOnLine ? rz : [])], '线条'), keepPlace: true },
          ...(gauzeGeo ? [{ geo: gauzeGeo, label: '纱层', keepPlace: true, second: true }] : []),
        ],
        warnings: meshInfo && !meshInfo.ok ? [...warnings, `网纱还有 ${meshInfo.loose} 块和主体没连上（打印后会掉下来）。把“网眼大小”调小，或把“网线粗细”调大一点再试试。`] : warnings,
        ...(bridged ? { bridged } : {}),
        notes: [
          ...(bridged > 0 ? [`外圈有缺口，已经自动补上（缺口大约 ${r1(bridged * 2)}mm 以内），补的地方也加了一段线。`] : bridged < 0 ? ['外圈缺口比较大，已经按整体外形补齐，补的地方也加了一段线。'] : []),
          '纱层用半透明或透明耗材打印效果最好（透明 PETG / 透明 PLA）；预览里用“第二颜色”显示，方便看清。',
          ...(dotInfo ? dotInfo.notes : []),
          ...(inlay ? ['点是平的、换成线条颜色（平面双色），要用 AMS 才打得出来。'] : []),
          ...(raised && !rz.length && p.fill !== 'lacedot' ? ['点是平的又和纱层同色，打出来看不见。把“点凸起”调大，或者颜色改成“跟线条”。'] : []),
          ...(rz.length && !raisedOnLine ? ['凸起的点和纱层是同一种耗材：单色打印机没法只靠“在纱层高度换料”做出来，要用 AMS，或者把“凸起部分的颜色”改成“跟线条”。'] : []),
          ...(meshInfo && (isMesh || p.fill === 'lacedot') ? [
            `网纱：${p.fill === 'lacedot' ? `点距 ${dotInfo.gap}mm` : `网眼 ${p.meshGap}mm`}、网线 ${p.meshW}mm。已检查连通性：${meshInfo.ok ? '线条和网纱连成一整片 ✓' : `还有 ${meshInfo.loose} 块没连上`}${meshInfo.patched ? `；有 ${meshInfo.patched} 处小细节没碰到网线，已在它周围补了一小块实心纱把它连上` : ''}${meshInfo.crumbs ? `；去掉了 ${meshInfo.crumbs} 个单独漂着的网线碎屑` : ''}。`,
            'Bambu Studio 里打开「质量 → 检测薄壁」，并把「首层线宽」设成和网线粗细差不多（如 0.45），细网线才打得出来；首层速度调慢一点。',
          ] : []),
          '导出 3MF 后，“线条”和“纱层”是两个零件，在 Bambu Studio 里分别选 AMS 耗材就行；没有 AMS 就在纱层高度暂停换料。',
          '首层要慢一点、调平要好；纱层只有一两层，建议首层层高和“纱层厚度”一致。',
          '线条宽度最好 ≥ 0.8mm（两条挤出线），太细的话在“图像调整 → 线条加粗”里加粗。',
          '打完从打印板上慢慢揭下来，柔性 PEI 板弯一下更好取。',
        ],
        colorChange: p.gauze,
      };
    },
  },

  // ======================= 纽扣 =======================
  {
    id: 'button', name: '纽扣', tagline: '线稿变成实心纽扣，两孔或四孔，边缘圆滑或利落', sample: 'daisy',
    defaults: { size: 25, thick: 3.2, holes: '4', holeD: 2, holeSpace: 4.5, angle2: '0', angle4: '0', bevel: 0.8, face: 'dish', dishD: 0.6, rimW: 1.8, detail: 'none', detailH: 0.4, count: 1 },
    groups: [
      { title: '尺寸', params: [
        { k: 'size', label: '纽扣大小', hint: '最长的一边；常见衬衫扣 11–15，外套扣 20–30', type: 'range', min: 8, max: 60, step: 0.5, unit: 'mm' },
        { k: 'thick', label: '厚度', type: 'range', min: 1.6, max: 6, step: 0.1, unit: 'mm' },
      ] },
      { title: '扣眼', params: [
        { k: 'holes', label: '孔的数量', type: 'cards', cols: 2, options: [
          ['2', '两孔', '', BTN_ICONS.two],
          ['4', '四孔', '', BTN_ICONS.four],
        ] },
        { k: 'holeD', label: '孔直径', hint: '普通缝线 1.5–2；粗线 / 皮绳 2.5 以上', type: 'range', min: 1.2, max: 4, step: 0.1, unit: 'mm' },
        { k: 'holeSpace', label: '孔间距', hint: '相邻两个孔中心的距离；纽扣放不下时会自动缩小', type: 'range', min: 2, max: 15, step: 0.1, unit: 'mm' },
        { k: 'angle2', label: '排列方向', type: 'seg', options: [['0', '横排'], ['90', '竖排'], ['45', '斜排']], show: p => p.holes === '2' },
        { k: 'angle4', label: '排列方向', type: 'seg', options: [['0', '正方'], ['45', '菱形']], show: p => p.holes === '4' },
      ] },
      { title: '边缘和正面', params: [
        { k: 'bevel', label: '边缘圆滑', hint: '0 = 利落的直角边；越大越圆润（最多到厚度的一半）', type: 'range', min: 0, max: 3, step: 0.1, unit: 'mm' },
        { k: 'face', label: '正面', type: 'seg', options: [['dish', '内凹带边'], ['flat', '平面']] },
        { k: 'dishD', label: '凹下深度', type: 'range', min: 0.2, max: 1.6, step: 0.1, unit: 'mm', show: p => p.face === 'dish' },
        { k: 'rimW', label: '边框宽度', type: 'range', min: 0.8, max: 5, step: 0.1, unit: 'mm', show: p => p.face === 'dish' },
        { k: 'detail', label: '线稿花纹', hint: '把线稿的线条刻在正面', type: 'seg', options: [['none', '不要'], ['engrave', '凹刻'], ['raise', '凸起']] },
        { k: 'detailH', label: '花纹深度 / 高度', type: 'range', min: 0.2, max: 1.2, step: 0.1, unit: 'mm', show: p => p.detail !== 'none' },
      ] },
      { title: '数量', params: [
        { k: 'count', label: '一次做几颗', hint: '一起排在打印板上', type: 'range', min: 1, max: 24, step: 1, unit: '颗' },
      ] },
    ],
    build(art, img, p) {
      const { sp, f } = placeArt(art, img, p.size, 3);
      let { sil, bridged } = solidify(sp, f);
      let dIn = distInside(sp, sil);
      const N = dIn.length, res = sp.res;
      const T = p.thick, warnings = [], notes = [];
      // 内缩 e 毫米后的形状（用一张距离场，边缘抗锯齿）
      const inset = e => { const o = new Float32Array(N); for (let i = 0; i < N; i++) { const v = dIn[i] / res - e / res; o[i] = v <= 0 ? 0 : v >= 1 ? 1 : v; } return o; };
      const at = (x, y) => { const i = Math.round((x - sp.x0) / res - 0.5), j = Math.round((y - sp.y0) / res - 0.5); return i < 0 || j < 0 || i >= sp.w || j >= sp.h ? 0 : dIn[j * sp.w + i]; };
      let maxD = 0, mi = 0; for (let i = 0; i < N; i++) if (dIn[i] > maxD) { maxD = dIn[i]; mi = i; }

      // ---- 边缘圆角：不超过厚度的一半，也不超过形状最窄处 ----
      const r = Math.min(p.bevel, T / 2 - 0.05, maxD * 0.8);
      if (p.bevel > r + 0.05) notes.push(`边缘圆滑已限制在 ${r1(r)}mm（不能超过厚度的一半）。`);
      // ---- 内凹 ----
      let dish = p.face === 'dish';
      const D = Math.min(p.dishD, T - 1.2), W = Math.max(D * 1.4, 0.8);   // W：凹面斜坡的宽度
      if (dish && maxD < p.rimW + W + p.holeD) { dish = false; notes.push('纽扣太小，放不下内凹和边框，已改成平面。'); }

      // ---- 扣眼位置：一组孔整体围着形状的中心（重心）排；中心太窄放不下时，整组只在中心附近挪一点，
      //      实在不行才往远处找。对称的图优先留在对称轴上 ----
      const [gx, gy] = centroid(sp, sil);
      const hr = p.holeD / 2, n = +p.holes;
      const ang = (n === 2 ? +p.angle2 : +p.angle4) * Math.PI / 180;
      const offs = sp2 => n === 2
        ? [-1, 1].map(k => [k * sp2 / 2 * Math.cos(ang), k * sp2 / 2 * Math.sin(ang)])
        : [0, 1, 2, 3].map(k => { const a = ang + Math.PI / 4 + k * Math.PI / 2, rr = sp2 / Math.SQRT2; return [rr * Math.cos(a), rr * Math.sin(a)]; });
      const minSpace = p.holeD + 0.9;
      const cands = [];
      { const lim = p.size / 2, st = Math.max(0.2, p.size / 120);
        for (let dy = -lim; dy <= lim + 1e-9; dy += st) for (let dx = -lim; dx <= lim + 1e-9; dx += st) {
          const d = Math.hypot(dx, dy); if (d > lim) continue;
          const onAxis = Math.abs(dx) < st / 2 || Math.abs(dy) < st / 2;
          cands.push({ x: gx + dx, y: gy + dy, d, cost: d + (onAxis ? 0 : 0.35) });
        }
        cands.sort((a, b) => a.cost - b.cost); }
      const near = p.size * 0.15;
      const needs = [dish ? p.rimW + W + hr + 0.3 : -1, Math.max(r, 0.6) + hr + 0.8].filter(v => v > 0), needMin = hr + 0.6;
      let space = Math.max(p.holeSpace, minSpace), cx = gx, cy = gy, placed = false;
      const search = (maxD, needList) => {
        for (const need of needList) for (let s2 = space; s2 >= minSpace - 1e-6; s2 -= 0.1) {
          const o = offs(s2);
          for (const c of cands) {
            if (c.cost > maxD + 0.35) break; if (c.d > maxD) continue;
            if (o.every(([ox, oy]) => at(c.x + ox, c.y + oy) >= need)) { space = s2; cx = c.x; cy = c.y; return true; }
          }
        }
        return false;
      };
      let filled = 0;
      placed = search(near, needs);
      if (!placed) {
        // 中间太窄（比如蝴蝶四片翅膀只在中间碰一点）：只在中心附近把缝隙补实（像翅膀之间连一层蹼），
        // 扣眼就能留在正中间，腰部也更结实，不容易从中间断开
        const ext = (n === 4 ? space / Math.SQRT2 : space / 2) + hr + 2.2;
        for (const rc of [0.8, 1.2, 1.8, 2.5, 3.5, 5].filter(v => v <= p.size * 0.2)) {
          const closed = erode(sp, fillHoles(sp, dilate(sp, sil, rc)), rc);
          const sil2 = F.union(sil, F.inter(closed, sp.circle(gx, gy, ext + rc)));
          const keep = dIn; dIn = distInside(sp, sil2);
          if (search(near, needs)) { sil = sil2; filled = rc; placed = true; break; }
          dIn = keep;
        }
      }
      placed ||= search(near, [needMin]) || search(Infinity, needs) || search(Infinity, [needMin]);
      if (filled) notes.push('图案中间太窄放不下扣眼，已经在中心附近把缝隙补实一点，扣眼留在正中间，纽扣也更结实。');
      if (!placed) { space = minSpace; warnings.push('纽扣太小或太细，扣眼放不下，孔会打穿到边上。把纽扣调大、孔调小，或者改成两孔。'); }
      else {
        if (space < p.holeSpace - 0.05) notes.push(`孔间距自动缩小到 ${r1(space)}mm，才能放进纽扣里。`);
        if (Math.hypot(cx - gx, cy - gy) > near) notes.push('形状中间太窄放不下扣眼，扣眼挪到了比较宽的地方。可以把孔调小、孔间距调小，或者换成两孔。');
      }
      const centersFor = sp2 => offs(sp2).map(([ox, oy]) => [cx + ox, cy + oy]);
      const centers = centersFor(space);
      const inDish = dish && centers.every(([x, y]) => at(x, y) >= p.rimW + W + hr);
      const zTop = inDish ? T - D : T;       // 扣眼顶面的高度
      const ch = Math.min(0.4, hr * 0.5);     // 扣眼两头倒一点角，缝线不容易磨断
      const holeCache = new Map();
      const holeAt = z => {
        const extra = +Math.max(0, ch - z, ch - (zTop - z)).toFixed(3);
        if (holeCache.has(extra)) return holeCache.get(extra);
        const hf = sp.draw(c => { c.beginPath(); for (const [x, y] of centers) { c.moveTo(x + hr + extra, y); c.arc(x, y, hr + extra, 0, Math.PI * 2); } c.fill(); });
        holeCache.set(extra, hf); return hf;
      };

      // ---- 线稿花纹 ----
      let L = null;
      const dd = Math.min(p.detailH, T - D - 0.8);
      if (p.detail !== 'none') {
        const clear = sp.draw(c => { c.beginPath(); for (const [x, y] of centers) { c.moveTo(x + hr + 0.8, y); c.arc(x, y, hr + 0.8, 0, Math.PI * 2); } c.fill(); });
        L = F.sub(F.inter(f, inset(Math.max(r, 0.4))), clear);
        if (!F.any(L)) { L = null; notes.push('线稿的线条都在边缘上，正面没有可以刻的花纹。'); }
      }
      const Lrim = L && dish ? F.inter(L, F.sub(sil, inset(p.rimW + W / 2))) : L;
      const Ldish = L && dish ? F.inter(L, inset(p.rimW + W / 2)) : null;

      // ---- 按高度切片：每一片算出截面 ----
      const outerE = z => z < r ? r - Math.sqrt(Math.max(0, r * r - (r - z) ** 2)) : z > T - r ? r - Math.sqrt(Math.max(0, r * r - (z - (T - r)) ** 2)) : 0;
      // 凹面：边框往里是一段余弦曲线的斜坡，再往里是平底
      const dishCut = z => { const u = Math.min(1, (T - z) / D); return p.rimW + W * Math.acos(1 - 2 * u) / Math.PI; };
      const section = z => {
        let g = inset(outerE(z));
        if (dish && z > T - D) g = F.sub(g, inset(dishCut(z)));
        if (L && p.detail === 'engrave') {
          if (dish) { if (z > T - dd) g = F.sub(g, Lrim); if (z > T - D - dd && Ldish) g = F.sub(g, Ldish); }
          else if (z > T - dd) g = F.sub(g, L);
        }
        return F.sub(g, holeAt(z));
      };
      // 切片高度：圆角按等角度取点（看起来最圆），凹面、倒角各取几层
      const breaks = new Set([0, T]);
      const add = z => { if (z > 0 && z < T) breaks.add(+z.toFixed(4)); };
      if (r > 0) { const k = Math.min(14, Math.max(4, Math.ceil(r * 9))); for (let i = 1; i < k; i++) { const th = i / k * Math.PI / 2; add(r * (1 - Math.cos(th))); add(T - r * (1 - Math.cos(th))); } add(r); add(T - r); }
      if (dish) { const k = Math.min(10, Math.max(3, Math.ceil(D / 0.08))); for (let i = 0; i < k; i++) add(T - D + D * i / k); }
      for (const z of [ch / 2, ch, zTop - ch, zTop - ch / 2, zTop]) add(z);
      if (L && p.detail === 'engrave') { add(T - dd); if (dish) add(T - D - dd); }
      const zs = [...breaks].sort((a, b) => a - b);
      const feats = [];
      for (let k = 0; k < zs.length - 1; k++) feats.push({ f: section((zs[k] + zs[k + 1]) / 2), z0: zs[k], z1: zs[k + 1] });
      if (L && p.detail === 'raise') {
        const topFace = inset(r);
        if (dish) {
          feats.push({ f: F.inter(Lrim, topFace), z0: T - 0.01, z1: T + dd });
          if (Ldish) feats.push({ f: Ldish, z0: T - D - 0.01, z1: T - D + dd });
        } else feats.push({ f: F.inter(L, topFace), z0: T - 0.01, z1: T + dd });
      }
      const geo = buildSolid(sp, feats);
      if (!geo) throw new Error('没有生成出纽扣，检查一下参数');

      // ---- 多颗：排成方阵 ----
      let out = geo;
      const cnt = Math.max(1, Math.round(p.count));
      if (cnt > 1) {
        geo.computeBoundingBox();
        const b = geo.boundingBox, w = b.max.x - b.min.x + 4, h = b.max.y - b.min.y + 4, cols = Math.ceil(Math.sqrt(cnt));
        const copies = [];
        for (let i = 0; i < cnt; i++) copies.push(geo.clone().translate((i % cols) * w, -Math.floor(i / cols) * h, 0));
        geo.dispose(); out = mergeGeos(copies);
        out.computeBoundingBox(); const ob = out.boundingBox;
        if (ob.max.x - ob.min.x > 250 || ob.max.y - ob.min.y > 250) warnings.push('这么多颗排不下 P1S 的打印板（256mm），减少数量或者分两次打。');
      }

      notes.unshift(
        `${n === 2 ? '两' : '四'}孔，孔径 ${p.holeD}mm，孔间距 ${r1(space)}mm${inDish ? '，孔在凹面里' : ''}；孔两头倒了 ${r1(ch)}mm 的小角，缝线不容易磨断。`,
        ...(bridged > 0 ? ['线稿外圈有缺口，已经自动补上再填成实心。'] : bridged < 0 ? ['线稿外圈缺口比较大，已经按整体外形补齐再填成实心。'] : []),
        '正面朝上平放打印，不需要支撑。边缘圆滑时，下半圈是悬空的小斜面，0.2mm 层高打得很好；想要更圆润可以用 0.12mm 层高。',
        '孔径 2mm 以下打出来可能稍微小一点，用 2mm 钻头或者牙签转一下就顺了。',
        '纽扣要过水洗：PLA 别用烘干机和高温熨烫；常洗的衣服建议用 PETG。',
      );
      if (p.detail === 'engrave' && L) notes.push('凹刻花纹可以用丙烯或指甲油填色，更显花纹。');
      return { parts: [{ geo: out, label: cnt > 1 ? `纽扣 ×${cnt}` : '纽扣' }], notes, warnings, colorChange: null, ...(bridged ? { bridged } : {}) };
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

// ---------------------------------------------------------------------------
//  点类纱：波点纱 / 自由波点 / 蕾丝波点 / 洞洞绣
// ---------------------------------------------------------------------------
const EYELET_RING = 0.5;   // 洞洞绣洞边一圈的宽度（mm）

/** 可复现的伪随机数 */
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** 在 (x,y) 画一个半径 r 的小图形（实心） */
function motif(c, shape, x, y, r, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot); c.beginPath();
  if (shape === 'flower') {
    const pr = r * 0.42, pd = r - pr;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * 2 * Math.PI / 5, px = pd * Math.cos(a), py = pd * Math.sin(a);
      c.moveTo(px + pr, py); c.arc(px, py, pr, 0, Math.PI * 2);
    }
    c.moveTo(r * 0.45, 0); c.arc(0, 0, r * 0.45, 0, Math.PI * 2);
  } else if (shape === 'star') {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.5 : r;
      k ? c.lineTo(rr * Math.cos(a), rr * Math.sin(a)) : c.moveTo(rr * Math.cos(a), rr * Math.sin(a));
    }
    c.closePath();
  } else if (shape === 'heart') {
    c.moveTo(0, 0.85 * r);
    c.bezierCurveTo(-0.35 * r, 0.55 * r, -r, 0.15 * r, -r, -0.3 * r);
    c.bezierCurveTo(-r, -0.8 * r, -0.3 * r, -1.0 * r, 0, -0.55 * r);
    c.bezierCurveTo(0.3 * r, -1.0 * r, r, -0.8 * r, r, -0.3 * r);
    c.bezierCurveTo(r, 0.15 * r, 0.35 * r, 0.55 * r, 0, 0.85 * r);
    c.closePath();
  } else {
    c.arc(0, 0, r, 0, Math.PI * 2);
  }
  c.fill(); c.restore();
}

/** 错位排列的点阵，以图案中心为原点（对称好看） */
function latticePts(sp, gap, rowH, r) {
  const cx = (sp.xmin + sp.xmax) / 2, cy = (sp.ymin + sp.ymax) / 2, out = [];
  const nj = Math.ceil((sp.ymax - sp.ymin) / 2 / rowH) + 2, ni = Math.ceil((sp.xmax - sp.xmin) / 2 / gap) + 2;
  for (let j = -nj; j <= nj; j++) for (let i = -ni; i <= ni; i++) out.push({ x: cx + (i + (j & 1) * 0.5) * gap, y: cy + j * rowH, r, rot: 0 });
  return out;
}

/** 自由波点：大小不一、随机撒开、互不相碰（飞镖法 + 网格加速） */
function scatterPts(sp, room, R, gap, seed, shape) {
  const rnd = mulberry32(seed * 7919 + 13);
  const clr = Math.max(0.5, gap - 2 * R);
  const W = sp.xmax - sp.xmin, H = sp.ymax - sp.ymin;
  const tries = Math.min(150000, Math.ceil(W * H / (gap * gap) * 30));
  const cs = 2 * R + 1.4 * clr, cols = Math.ceil(W / cs) + 1, grid = new Map(), out = [];
  for (let t = 0; t < tries; t++) {
    const x = sp.xmin + rnd() * W, y = sp.ymin + rnd() * H, r = R * (0.4 + 0.6 * rnd() ** 1.6), k = 0.75 + 0.6 * rnd(), a = rnd();
    if (room(x, y) < r + 0.3) continue;
    const gx = Math.floor((x - sp.xmin) / cs), gy = Math.floor((y - sp.ymin) / cs);
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
      for (const q of grid.get((gy + dy) * cols + gx + dx) || []) if (Math.hypot(q.x - x, q.y - y) < r + q.r + clr * k) { ok = false; break; }
    }
    if (!ok) continue;
    const rot = shape === 'heart' ? (a - 0.5) * 0.8 : a * Math.PI * 2;
    const d = { x, y, r, rot }, key = gy * cols + gx;
    out.push(d); (grid.get(key) || grid.set(key, []).get(key)).push(d);
  }
  return out;
}

/**
 * 点类纱。free = 纱层里没被线条占掉的地方，region = 整个纱层区域。
 * 返回 { gauzeF: 纱层（z 0..纱厚）, raised: 点（凸起或嵌色的部分）, meshInfo, notes, gap }
 */
function dotGauze(sp, p, free, region, lines) {
  const R = p.dotSize / 2, notes = [];
  const minGap = p.fill === 'eyelet' ? p.dotSize + 2 * EYELET_RING + 0.6 : p.dotSize + 0.6;
  const gap = r1(Math.max(p.dotGap, minGap));
  if (gap > p.dotGap + 1e-6) notes.push(`点的间距太小，点${p.fill === 'eyelet' ? '和洞边' : ''}之间留不出空隙，已自动放宽到 ${gap}mm，免得粘成一片。`);
  const din = distInside(sp, free);
  const room = (x, y) => {
    const i = Math.round((x - sp.x0) / sp.res - 0.5), j = Math.round((y - sp.y0) / sp.res - 0.5);
    return i < 0 || j < 0 || i >= sp.w || j >= sp.h ? 0 : din[j * sp.w + i];
  };
  const draw = list => sp.draw(c => { for (const d of list) motif(c, p.dotShape, d.x, d.y, d.r, d.rot); });
  const rowH = p.fill === 'lacedot' ? gap * 0.6 : gap * Math.sqrt(3) / 2;
  const pts = p.fill === 'scatter' ? scatterPts(sp, room, R, gap, p.seed, p.dotShape) : latticePts(sp, gap, rowH, R);
  let gauzeF = free, raised, meshInfo = null, n;

  if (p.fill === 'lacedot') {
    // 菱形网线 + 每个交点上一个点（像法式点点网纱 point d'esprit），整片要连通
    const net = sp.draw(c => {
      c.lineWidth = p.meshW; c.lineCap = 'round'; c.beginPath();
      for (const d of pts) { c.moveTo(d.x, d.y); c.lineTo(d.x + gap / 2, d.y + rowH); c.moveTo(d.x, d.y); c.lineTo(d.x - gap / 2, d.y + rowH); }
      c.stroke();
      for (const d of pts) motif(c, p.dotShape, d.x, d.y, d.r, d.rot);
    });
    gauzeF = F.sub(F.inter(net, region), lines);
    meshInfo = connectMesh(sp, lines, gauzeF, region, gap);
    gauzeF = meshInfo.gauzeF;
    const keep = pts.filter(d => room(d.x, d.y) >= d.r * 0.9);
    raised = F.inter(draw(keep), gauzeF); n = keep.length;
  } else if (p.fill === 'eyelet') {
    // 实心纱上开小洞，洞边一圈加厚（像洞洞绣 / 英式刺绣）。洞离线条和边缘留足距离，纱不会断开
    const keep = pts.filter(d => room(d.x, d.y) >= d.r + EYELET_RING + 0.5);
    const holes = draw(keep);
    gauzeF = F.sub(free, holes);
    raised = F.sub(F.inter(dilate(sp, holes, EYELET_RING), free), holes); n = keep.length;
  } else {
    // 实心纱 + 点：点不碰线条，也不贴着边缘
    const keep = p.fill === 'scatter' ? pts : pts.filter(d => room(d.x, d.y) >= d.r + 0.3);
    raised = F.inter(draw(keep), free); n = keep.length;
  }
  if (!n) notes.push('纱层上的空间太小，一个点都放不下。把“点的大小”或“点的间距”调小试试。');
  else notes.push(`${{ dots: '波点纱', scatter: '自由波点', lacedot: '蕾丝波点', eyelet: '洞洞绣' }[p.fill]}：放了 ${n} 个${p.fill === 'eyelet' ? '洞' : '点'}${p.fill === 'scatter' ? '，拖“换一种撒法”可以重新随机' : ''}。${p.fill === 'scatter' || p.fill === 'dots' ? '点之间不相连，靠底下这层实心纱托住。' : ''}`);
  if (p.dotSize < 1.2 && p.dotH > 0) notes.push('点小于 1.2mm 时，凸起部分只有一两圈挤出线，打出来会更像小圆疙瘩；想要清楚的形状（小花、星星、爱心）建议 ≥ 2.5mm。');
  return { gauzeF, raised, meshInfo, notes, gap };
}

/** 线稿 → 实心外形：填满封闭区域；外圈有缺口时自动补上（闭运算，补不上就用凸包）。bridged: 0 没补 / >0 补的半径 / -1 凸包 */
function solidify(sp, f) {
  let sil = fillHoles(sp, f), bridged = 0;
  const count = g => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] >= 0.5) n++; return n; };
  const nf = count(f);
  const base0 = count(sil);
  // 本来就是实心的图（最粗的地方超过整体的 12%）就不用补缺口
  let fx0 = sp.w, fx1 = -1, fy0 = sp.h, fy1 = -1;
  for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (f[y * sp.w + x] >= 0.5) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
  const dF = distInside(sp, f); let thick = 0; for (let i = 0; i < dF.length; i++) if (dF[i] > thick) thick = dF[i];
  const isSolid = thick > 0.12 * Math.max(fx1 - fx0, fy1 - fy0) * sp.res;
  // 补出来的形状不能比原图的外框大（否则就是把整张画布填满了）
  const inBox = g => { for (let y = 0; y < sp.h; y++) for (let x = 0; x < sp.w; x++) if (g[y * sp.w + x] >= 0.5 && (x < fx0 - 2 || x > fx1 + 2 || y < fy0 - 2 || y > fy1 + 2)) return false; return true; };
  if (!isSolid && base0 < nf * 1.3) {
    // 线条几乎没围出区域 = 外圈有缺口：线条“膨胀—填满—收回”（闭运算）把缺口补上；面积明显变大才算真的补上了
    const need = Math.max(nf * 1.3, base0 * 1.6);
    {
      for (const r of [0.6, 1.2, 2, 3, 4.5, 6, 8, 11, 15]) {
        const closed = erode(sp, fillHoles(sp, dilate(sp, f, r)), r);
        if (count(closed) >= need && inBox(closed)) { sil = F.union(closed, f); bridged = r; break; }
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

  }
  return { sil, bridged };
}

/** 网纱图案（覆盖整个网格范围的细线），之后再和纱层区域取交集 */
function meshPattern(sp, kind, gap, w) {
  const x0 = sp.xmin, x1 = sp.xmax, y0 = sp.ymin, y1 = sp.ymax, D = Math.hypot(x1 - x0, y1 - y0);
  return sp.draw(c => {
    c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    if (kind === 'grid') {
      for (let x = Math.floor(x0 / gap) * gap; x <= x1; x += gap) { c.moveTo(x, y0); c.lineTo(x, y1); }
      for (let y = Math.floor(y0 / gap) * gap; y <= y1; y += gap) { c.moveTo(x0, y); c.lineTo(x1, y); }
    } else if (kind === 'diamond') {
      // 两组斜线（±55°），菱形网眼，和婚纱头纱的网很像
      for (const a of [55, -55]) {
        const r = a * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r), nx = -dy, ny = dx;
        const step = gap;
        for (let k = -D; k <= D; k += step) {
          const cx = (x0 + x1) / 2 + nx * k, cy = (y0 + y1) / 2 + ny * k;
          c.moveTo(cx - dx * D, cy - dy * D); c.lineTo(cx + dx * D, cy + dy * D);
        }
      }
    } else if (kind === 'scallop') {
      // 鱼鳞 / 扇贝：每排半圆，下一排错开半个，端点正好落在上一排的弧底，整片连通
      const R = gap / 2;
      for (let j = 0, y = y0 - gap; y <= y1 + R; j++, y += R) {
        for (let x = x0 - gap + (j % 2 ? R : 0); x <= x1 + gap; x += gap) { c.moveTo(x + R, y); c.arc(x, y, R, 0, Math.PI); }
      }
    } else {
      // 六角蜂窝：gap 是相邻网眼中心距
      const R = gap / Math.sqrt(3), hx = gap, hy = 1.5 * R;
      for (let row = 0, y = y0 - R; y <= y1 + R; row++, y += hy) {
        for (let x = x0 - gap + (row % 2 ? gap / 2 : 0); x <= x1 + gap; x += hx) {
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + i * Math.PI / 3, b = a + Math.PI / 3;
            c.moveTo(x + R * Math.cos(a), y + R * Math.sin(a)); c.lineTo(x + R * Math.cos(b), y + R * Math.sin(b));
          }
        }
      }
    }
    c.stroke();
  });
}

/** 连通性：线条 ∪ 网纱 必须是一整块。没碰到网线的小细节就在周围补一小块实心纱；网线碎屑删掉 */
function connectMesh(sp, lines, gauzeF, region, gap) {
  const { w, h } = sp, N = w * h;
  const label = solid => {
    const lab = new Int32Array(N), sizes = [0], hasLine = [false], stack = new Int32Array(N);
    let id = 0;
    for (let i = 0; i < N; i++) {
      if (lab[i] || solid[i] < 0.5) continue;
      id++; let top = 0, n = 0, line = false; stack[top++] = i; lab[i] = id;
      while (top) {
        const j = stack[--top], x = j % w; n++; if (lines[j] >= 0.5) line = true;
        if (x > 0 && !lab[j - 1] && solid[j - 1] >= 0.5) { lab[j - 1] = id; stack[top++] = j - 1; }
        if (x < w - 1 && !lab[j + 1] && solid[j + 1] >= 0.5) { lab[j + 1] = id; stack[top++] = j + 1; }
        if (j >= w && !lab[j - w] && solid[j - w] >= 0.5) { lab[j - w] = id; stack[top++] = j - w; }
        if (j < N - w && !lab[j + w] && solid[j + w] >= 0.5) { lab[j + w] = id; stack[top++] = j + w; }
      }
      sizes.push(n); hasLine.push(line);
    }
    let main = 1; for (let k = 2; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
    return { lab, sizes, hasLine, main, count: sizes.length - 1 };
  };
  let g = gauzeF, crumbs = 0, patched = 0;
  let L = label(F.union(lines, g));
  if (L.count > 1) {
    g = g.slice();
    const fixMask = new Float32Array(N);
    for (let k = 1; k < L.sizes.length; k++) {
      if (k === L.main) continue;
      if (!L.hasLine[k]) { for (let i = 0; i < N; i++) if (L.lab[i] === k) g[i] = 0; crumbs++; }      // 只有网线的碎屑：删掉
      else { for (let i = 0; i < N; i++) if (L.lab[i] === k) fixMask[i] = 1; patched++; }             // 没连上的细节：周围补实心纱
    }
    if (patched) {
      const patch = F.sub(F.inter(dilate(sp, fixMask, gap * 0.9 + 0.6), region), lines);
      g = F.union(g, patch);
    }
    L = label(F.union(lines, g));
  }
  return { gauzeF: g, ok: L.count <= 1, loose: Math.max(0, L.count - 1), patched, crumbs };
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
