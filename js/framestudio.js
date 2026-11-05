/*
 * 相框工作室：高度图浮雕相框 + 背面夹层 + 挂件 + 底座
 *
 * 打印方向：相框正面（浮雕）朝上，背面贴打印床 → 浮雕不需要支撑。
 * 夹层做成单独的零件（同样平放打印、无悬空），粘或用定位销装到相框背面。
 * 底座是单独零件：相框底部多出一块插片，插进底座里带后仰角度的槽。
 */
import * as THREE from 'three';
import { Space, F, erode, edgeAlong, buildSolid } from './engine.js?v=16';
import { rotateArt, analyzeHM, rasterBright, bandField, defaultHeights } from './heightmap.js?v=16';

const r1 = v => Math.round(v * 10) / 10;
const PHOTOS = { instaxMini: [54, 86], instaxSq: [72, 86], instaxWide: [108, 86], r3: [89, 127], r4: [102, 152], r5: [127, 178], sq: [100, 100] };

const ic = d => `<svg viewBox="0 0 40 30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${d}</svg>`;
const HOLDER_ICONS = {
  full: ic('<rect x="6" y="4" width="28" height="22" rx="2" fill="currentColor" fill-opacity=".14"/><path d="M6 4v22h28V4"/><path d="M15 1v6M20 1v6M25 1v6" stroke-dasharray="2 2"/>'),
  half: ic('<path d="M6 4v22h28V4"/><rect x="11" y="9" width="18" height="12" rx="1" stroke-dasharray="2.5 2"/><path d="M6 26h28" stroke-width="3"/>'),
  corners: ic('<path d="M6 12V4h8M34 12V4h-8M6 18v8h8M34 18v8h-8" stroke-width="2.4"/><rect x="9" y="7" width="22" height="16" rx="1" stroke-dasharray="2.5 2"/>'),
  cover: ic('<rect x="5" y="3" width="30" height="24" rx="2"/><rect x="9" y="7" width="22" height="16" rx="1" fill="currentColor" fill-opacity=".14"/><path d="M17 23a3 3 0 0 1 6 0"/>'),
  none: ic('<rect x="6" y="4" width="28" height="22" rx="2" stroke-dasharray="3 3"/><path d="M14 10l12 10M26 10L14 20"/>'),
};
const STAND_ICONS = {
  arch: ic('<path d="M4 26V18Q4 8 20 8T36 18v8z" fill="currentColor" fill-opacity=".14"/><path d="M19 9l3-7"/>'),
  block: ic('<rect x="4" y="12" width="32" height="14" rx="3" fill="currentColor" fill-opacity=".14"/><path d="M19 13l3-10"/>'),
  round: ic('<path d="M4 26v-5q0-4 5-4h22q5 0 5 4v5z" fill="currentColor" fill-opacity=".14"/><path d="M19 18l3-12"/>'),
};

export const FRAME_STUDIO = {
  id: 'framestudio', name: '相框工作室', kind: 'heightmap',
  tagline: '上传高度图：白色最高、灰色次高、黑色或透明为空，中间留好相片窗口',
  defaults: {
    rotate: 0, invert: false, emptyT: 0.12, hmode: 'levels', levelH: [], maxH: 6, minH: 3,
    fit: 'photo', width: 140, photo: 'r3', pw: 89, ph: 127, lip: 4,
    holder: 'full', insert: 'top', slotT: 1.0, wall: 4, backT: 1.6, rail: 5, tol: 0.2, attach: 'glue',
    keyhole: true, magnet: false, magN: '4', magD: 10, magT: 3, loop: false, loopD: 4,
    stand: true, standStyle: 'arch', tilt: 12, tongueW: 30, tongueL: 8, tongueT: 3, baseW: 70, baseD: 40, baseH: 14,
  },
  groups: [
    { title: '高度', params: [
      { k: 'hmode', label: '高度方式', type: 'seg', options: [['levels', '按颜色分层'], ['smooth', '按亮度渐变']] },
      { k: 'levelH', type: 'levels', show: p => p.hmode === 'levels' },
      { k: 'maxH', label: '最亮处高度', type: 'range', min: 1, max: 20, step: 0.2, unit: 'mm', show: p => p.hmode === 'smooth' },
      { k: 'minH', label: '最暗处高度', type: 'range', min: 0.6, max: 10, step: 0.2, unit: 'mm', show: p => p.hmode === 'smooth' },
      { k: 'emptyT', label: '多暗算“空”', hint: '比这个更暗的地方不出实体', type: 'range', min: 0.02, max: 0.5, step: 0.01 },
      { k: 'invert', label: '反过来（黑色最高）', type: 'toggle' },
      { k: 'rotate', label: '旋转图片', type: 'seg', options: [[0, '0°'], [90, '90°'], [180, '180°'], [270, '270°']] },
    ] },
    { title: '尺寸与照片', params: [
      { k: 'fit', label: '尺寸怎么定', type: 'seg', options: [['photo', '按照片缩放'], ['width', '指定总宽']] },
      { k: 'width', label: '相框总宽', type: 'range', min: 40, max: 250, step: 1, unit: 'mm', show: p => p.fit === 'width' },
      { k: 'photo', label: '照片尺寸', hint: '方向会自动跟窗口一致', type: 'select', options: [['instaxMini', '拍立得 mini · 54×86'], ['instaxSq', '拍立得 square · 72×86'], ['instaxWide', '拍立得 wide · 108×86'], ['r3', '3R / 3.5×5″ · 89×127'], ['r4', '4R / 4×6″ · 102×152'], ['r5', '5×7″ · 127×178'], ['sq', '方形 · 100×100'], ['custom', '自定义'], ['auto', '自动（窗口 + 压边）']] },
      { k: 'pw', label: '照片宽', type: 'range', min: 30, max: 220, step: 1, unit: 'mm', show: p => p.photo === 'custom' },
      { k: 'ph', label: '照片高', type: 'range', min: 30, max: 220, step: 1, unit: 'mm', show: p => p.photo === 'custom' },
      { k: 'lip', label: '压边', hint: '照片比窗口每边大出的部分', type: 'range', min: 2, max: 12, step: 0.5, unit: 'mm' },
    ] },
    { title: '背面夹层', params: [
      { k: 'holder', label: '夹层样式', type: 'cards', cols: 3, options: [
        ['full', '全包插槽', '有背板，照片从一边插入', HOLDER_ICONS.full],
        ['half', '半包卡槽', '只有一圈卡边，背面镂空', HOLDER_ICONS.half],
        ['cover', '压入后盖', '外框 + 可拆背盖', HOLDER_ICONS.cover],
        ['corners', '四角卡角', '4 个小卡角，最省料', HOLDER_ICONS.corners],
        ['none', '不要夹层', '自己另外处理', HOLDER_ICONS.none],
      ] },
      { k: 'insert', label: '照片从哪边插', type: 'seg', options: [['top', '上边'], ['left', '左边'], ['right', '右边']], show: p => p.holder === 'full' || p.holder === 'half' },
      { k: 'slotT', label: '夹层厚度', hint: '照片 + 卡纸，一般 0.8–1.5', type: 'range', min: 0.4, max: 4, step: 0.1, unit: 'mm', show: p => p.holder !== 'none' },
      { k: 'wall', label: '外壁宽度', type: 'range', min: 2, max: 10, step: 0.5, unit: 'mm', show: p => p.holder !== 'none' },
      { k: 'backT', label: '背板厚度', type: 'range', min: 0.8, max: 4, step: 0.2, unit: 'mm', show: p => p.holder !== 'none' },
      { k: 'rail', label: '背面卡边宽', type: 'range', min: 2, max: 15, step: 0.5, unit: 'mm', show: p => p.holder === 'half' },
      { k: 'tol', label: '后盖松紧', hint: '每边间隙，越小越紧', type: 'range', min: 0, max: 0.6, step: 0.05, unit: 'mm', show: p => p.holder === 'cover' },
      { k: 'attach', label: '装到相框上', type: 'seg', options: [['glue', '胶水粘'], ['pins', '定位销']], show: p => ['full', 'half', 'cover'].includes(p.holder) },
    ] },
    { title: '挂件 / 冰箱贴', params: [
      { k: 'keyhole', label: '钥匙孔挂钉', hint: '背面两个，挂在钉子上', type: 'toggle' },
      { k: 'magnet', label: '冰箱磁铁坑', type: 'toggle' },
      { k: 'magN', label: '磁铁数量', type: 'seg', options: [['2', '上面 2 个'], ['4', '四角 4 个']], show: p => p.magnet },
      { k: 'magD', label: '磁铁直径', type: 'range', min: 4, max: 20, step: 0.5, unit: 'mm', show: p => p.magnet },
      { k: 'magT', label: '磁铁厚度', type: 'range', min: 1, max: 5, step: 0.5, unit: 'mm', show: p => p.magnet },
      { k: 'loop', label: '顶部挂绳环', hint: '可以穿绳子或挂件', type: 'toggle' },
      { k: 'loopD', label: '挂绳孔直径', type: 'range', min: 2, max: 8, step: 0.5, unit: 'mm', show: p => p.loop },
    ] },
    { title: '底座', params: [
      { k: 'stand', label: '做底座', hint: '相框底部加插片，插进底座立在桌上', type: 'toggle' },
      { k: 'standStyle', label: '底座样式', type: 'cards', cols: 3, show: p => p.stand, options: [
        ['arch', '拱形', '', STAND_ICONS.arch], ['block', '方块', '', STAND_ICONS.block], ['round', '扁圆', '', STAND_ICONS.round]] },
      { k: 'tilt', label: '后仰角度', type: 'range', min: 0, max: 25, step: 1, unit: '°', show: p => p.stand },
      { k: 'tongueW', label: '插片宽度', type: 'range', min: 10, max: 80, step: 1, unit: 'mm', show: p => p.stand },
      { k: 'tongueL', label: '插入深度', type: 'range', min: 4, max: 15, step: 0.5, unit: 'mm', show: p => p.stand },
      { k: 'tongueT', label: '插片厚度', type: 'range', min: 2, max: 6, step: 0.2, unit: 'mm', show: p => p.stand },
      { k: 'baseW', label: '底座宽', type: 'range', min: 30, max: 160, step: 1, unit: 'mm', show: p => p.stand },
      { k: 'baseD', label: '底座深', type: 'range', min: 20, max: 80, step: 1, unit: 'mm', show: p => p.stand },
      { k: 'baseH', label: '底座高', type: 'range', min: 8, max: 30, step: 0.5, unit: 'mm', show: p => p.stand },
    ] },
  ],

  info(art0, p) { // 给界面用：层级 + 窗口
    const art = rotateArt(art0, +p.rotate);
    return { art, ...analyzeHM(art, p) };
  },

  build(art0, _img, p) {
    const art = rotateArt(art0, +p.rotate);
    const hm = analyzeHM(art, p);
    if (!hm.win) throw new Error('没找到中间的相片窗口。请确认图中间留了一块黑色或透明的区域，并且四周被相框完整围住。');
    const warnings = [], notes = [];

    // ---- 层高 ----
    let bands;
    if (p.hmode === 'levels') {
      const H = Array.isArray(p.levelH) && p.levelH.length === hm.levels.length ? p.levelH : defaultHeights(hm.levels.length);
      bands = hm.levels.map((l, j) => ({ lo: l.lo, hi: l.hi, h: H[j] }));
    } else {
      const lo = Math.min(p.minH, p.maxH), hi = Math.max(p.minH, p.maxH);
      const N = Math.max(1, Math.min(24, Math.round((hi - lo) / 0.2)));
      bands = Array.from({ length: N + 1 }, (_, k) => ({
        lo: k === 0 ? p.emptyT : p.emptyT + (1 - p.emptyT) * (k - 0.5) / N,
        hi: k === N ? Infinity : p.emptyT + (1 - p.emptyT) * (k + 0.5) / N,
        h: lo + (hi - lo) * k / N,
      }));
    }
    const hOf = v => { for (const bd of bands) if (v >= bd.lo && v < bd.hi) return bd.h; return 0; };

    // ---- 尺寸：照片 & 缩放 ----
    const win = hm.win;
    let pw, ph;
    if (p.photo === 'custom') [pw, ph] = [p.pw, p.ph];
    else if (p.photo !== 'auto') [pw, ph] = PHOTOS[p.photo];
    if (pw && (win.h >= win.w) !== (ph >= pw)) [pw, ph] = [ph, pw];
    let s; // 毫米 / 原图像素
    if (p.fit === 'photo' && p.photo !== 'auto') s = Math.min((pw - 2 * p.lip) / win.w, (ph - 2 * p.lip) / win.h);
    else s = p.width / hm.content.w;
    if (p.photo === 'auto') { pw = win.w * s + 2 * p.lip; ph = win.h * s + 2 * p.lip; }
    const winW = win.w * s, winH = win.h * s;
    if (pw < winW + 2 || ph < winH + 2) warnings.push(`照片 ${r1(pw)}×${r1(ph)}mm 比窗口 ${r1(winW)}×${r1(winH)}mm 小，盖不住窗口。换大一点的照片或改用“按照片缩放”。`);
    const wcx = win.x + win.w / 2, wcy = win.y + win.h / 2; // 窗口中心 = 原点
    const c = hm.content;
    const cx0 = (c.x - wcx) * s, cy0 = (c.y - wcy) * s, cx1 = (c.x + c.w - wcx) * s, cy1 = (c.y + c.h - wcy) * s;
    const loopR = p.loopD / 2 + 2.4;
    const sp = new Space(cx0 - 4, cy0 - 4 - (p.loop ? 2 * loopR : 0), cx1 + 4, cy1 + 4 + (p.stand ? p.tongueL + 2 : 0), 820);

    // ---- 主体（浮雕） ----
    const b = rasterBright(sp, art, { x: -wcx * s, y: -wcy * s, w: art.w * s, h: art.h * s }, p.invert);
    const body = bandField(b, p.emptyT, Infinity);
    const hpx = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) hpx[i] = hOf(b[i]);
    const feats = bands.map(bd => ({ f: bandField(b, bd.lo, bd.hi), z0: 0, z1: bd.h }));
    const minBodyH = Math.min(...bands.map(bd => bd.h));

    // 坐标 → 像素
    const pix = (x, y) => { const px = Math.floor((x - sp.x0) / sp.res), py = Math.floor((y - sp.y0) / sp.res); return px < 0 || py < 0 || px >= sp.w || py >= sp.h ? -1 : py * sp.w + px; };

    // ---- 夹层尺寸 ----
    const P = { w: pw + 0.6, h: ph + 0.6 };
    const hasHolder = p.holder !== 'none';
    const hw = P.w / 2 + (hasHolder ? p.wall : 0), hh = P.h / 2 + (hasHolder ? p.wall : 0);
    if (hasHolder) {
      let out = false;
      for (let t = 0; t <= 1; t += 0.01) for (const [x, y] of [[-hw + 2 * hw * t, -hh], [-hw + 2 * hw * t, hh], [-hw, -hh + 2 * hh * t], [hw, -hh + 2 * hh * t]]) { const i = pix(x, y); if (i < 0 || body[i] < 0.5) out = true; }
      if (out) warnings.push('夹层外框比相框背面大，从正面会露出来一点。可以减小“外壁宽度”，或者用边框更宽的图。');
    }

    // ---- 挂件位置搜索：在主体上、避开夹层、厚度够 ----
    const inner = erode(sp, body, 1.5);
    const tongueY0 = p.stand ? edgeAlong(sp, body, 0, 0, 270)[1] : Infinity;
    const free = (x, y, need) => {
      const i = pix(x, y);
      if (i < 0 || inner[i] < 0.5 || hpx[i] < need) return false;
      if (Math.abs(x) < hw + 1.5 && Math.abs(y) < hh + 1.5) return false;
      if (p.stand && Math.abs(x) < p.tongueW / 2 + 2 && y > tongueY0 - 8) return false;
      return true;
    };
    const fitsDisk = (cx, cy, r, need) => {
      for (let a = 0; a < 16; a++) { const t = a * Math.PI / 8; if (!free(cx + Math.cos(t) * r, cy + Math.sin(t) * r, need)) return false; }
      return free(cx, cy, need) && free(cx + r / 2, cy, need) && free(cx - r / 2, cy, need) && free(cx, cy + r / 2, need) && free(cx, cy - r / 2, need);
    };
    const back = [];   // 从背面挖掉的形状
    if (p.keyhole) {
      const need = 2.6 + 0.6;
      const okAt = (x, y) => fitsDisk(x, y, 4.6, need) && fitsDisk(x, y - 7, 4.6, need) && fitsDisk(x, y - 3.5, 4.6, need);
      let spot = null;
      for (let y = cy0 + 6; y < cy1 - 6 && !spot; y += 1) for (let x = cx1 - 6; x > 4; x -= 1) if (okAt(x, y) && okAt(-x, y)) { spot = [x, y]; break; }
      if (spot) {
        for (const sx of [-1, 1]) {
          const x = sx * spot[0], y = spot[1];
          back.push({ f: F.union(sp.circle(x, y, 4.2), sp.rect(x - 2.1, y - 7, 4.2, 7, 2.1)), z0: 0, z1: 1.0 });
          back.push({ f: F.union(sp.circle(x, y, 4.4), sp.rect(x - 4.4, y - 7.5, 8.8, 7.5, 4.4)), z0: 1.0, z1: 2.6 });
        }
        notes.push('背面两个钥匙孔：钉子对准大圆孔按进去，再往下一拉就卡住。');
      } else warnings.push(`没地方放钥匙孔：需要边框上有一块厚度 ≥ ${r1(need)}mm、且不被夹层挡住的地方。可以把边框层加高或换小一点的夹层外壁。`);
    }
    if (p.magnet) {
      const r = p.magD / 2 + 0.15, depth = p.magT + 0.2, need = depth + 0.8;
      const corners = p.magN === '2' ? [[-1, -1], [1, -1]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      let miss = 0;
      for (const [sx, sy] of corners) {
        const x0 = sx < 0 ? cx0 : cx1, y0 = sy < 0 ? cy0 : cy1;
        let spot = null;
        for (let t = 0; t <= 1 && !spot; t += 0.01) { const x = x0 * (1 - t), y = y0 * (1 - t); if (fitsDisk(x, y, r, need)) spot = [x, y]; }
        if (!spot) { miss++; continue; }
        back.push({ f: sp.circle(spot[0], spot[1], r), z0: 0, z1: depth });
      }
      if (miss) warnings.push(`有 ${miss} 个磁铁放不下（需要厚度 ≥ ${r1(need)}mm 的边框位置）。可以换小一点/薄一点的磁铁，或加高边框层。`);
      if (miss < corners.length) notes.push(`背面有 Ø${r1(p.magD)}×${r1(p.magT)}mm 的磁铁坑，挤一点胶把磁铁压进去。`);
    }
    if (p.attach === 'pins' && ['full', 'half', 'cover'].includes(p.holder)) {
      for (const [x, y] of pinSpots(P, p.wall)) back.push({ f: sp.circle(x, y, 1.45), z0: 0, z1: 2.4 });
      if (minBodyH < 3.2) warnings.push('定位销孔深 2.4mm，边框最薄处不够厚，正面可能会被打穿。');
    }

    // ---- 挂绳环 & 底座插片（只加在背面那一层厚度里） ----
    const extra = [];
    if (p.loop) {
      const [, ey] = edgeAlong(sp, body, 0, 0, 90);
      const cy = ey - loopR + 3;
      const tab = F.union(sp.circle(0, cy, loopR), sp.rect(-loopR, cy, 2 * loopR, ey - cy + 4));
      extra.push({ f: tab, z0: 0, z1: Math.min(3, Math.max(2, minBodyH)) });
      back.push({ f: sp.circle(0, cy, p.loopD / 2), z0: 0, z1: 99 });
      notes.push('顶部挂绳环可以穿丝带、链子或挂件。');
    }
    if (p.stand) {
      const [, by] = edgeAlong(sp, body, 0, 0, 270);
      extra.push({ f: sp.rect(-p.tongueW / 2, by - 6, p.tongueW, 6 + p.tongueL, 1), z0: 0, z1: p.tongueT });
    }

    const frameGeo = buildSolid(sp, [...feats, ...extra, ...back.map(f => ({ ...f, op: 'sub' }))]);
    if (!frameGeo) throw new Error('没有生成出形状，检查一下高度设置');
    const parts = [{ geo: frameGeo, label: '相框' }];

    // ---- 夹层零件 ----
    if (hasHolder) parts.push(...holderParts(p, P));
    // ---- 底座零件 ----
    if (p.stand) {
      const { geo, warn } = standBase(p);
      parts.push({ geo, label: '底座' });
      if (warn) warnings.push(warn);
    }

    // ---- 提示 ----
    notes.unshift(`照片 ${r1(pw)}×${r1(ph)}mm，露出窗口约 ${r1(winW)}×${r1(winH)}mm。`);
    notes.push('相框正面朝上打印，浮雕不需要支撑。');
    const hint = {
      full: `夹层（全包插槽）背板朝下打印；装好后照片从${{ top: '上', left: '左', right: '右' }[p.insert]}边插入。`,
      half: `夹层（半包卡槽）卡边朝下打印；照片从${{ top: '上', left: '左', right: '右' }[p.insert]}边插入，背面露出一部分照片背面。`,
      cover: '夹层外框和后盖都平放打印；照片放进去后把后盖压进外框，指槽处可以撬开。',
      corners: '四个卡角平放打印；先把照片放在相框背面对好位置，再把卡角粘在四个角上。',
    }[p.holder];
    if (hint) notes.push(hint);
    if (['full', 'half', 'cover'].includes(p.holder)) notes.push(p.attach === 'pins' ? '夹层上的 4 个定位销对准相框背面的小孔按进去，需要的话再点胶。' : '用 502 或 UHU 把夹层的平面粘到相框背面，对准窗口居中。');
    if (p.stand) notes.push(`底座单独打印，插片插进去后相框会后仰 ${p.tilt}°。插得太紧可以把“插片厚度”调小 0.2mm。`);
    return { parts, notes, warnings, colorChange: null };
  },
};

/** 定位销位置：夹层外壁四个角（相框坐标） */
function pinSpots(P, wall) {
  const x = P.w / 2 + wall / 2, y = P.h / 2 + wall / 2;
  return [[-x, -y], [x, -y], [-x, y], [x, y]];
}

/** 夹层零件（按打印方向：贴相框的那面朝上）。翻过来贴到相框背面时左右会对调，所以这里左右镜像。 */
function holderParts(p, P) {
  const w = p.wall, ox = P.w / 2 + w, oy = P.h / 2 + w;
  if (p.holder === 'corners') {
    const c = Math.min(18, Math.min(P.w, P.h) * 0.22);
    const sp = new Space(-w - 2, -w - 2, c + 2, c + 2, 300);
    const plate = sp.draw(g => { g.beginPath(); g.moveTo(-w, -w); g.lineTo(c, -w); g.lineTo(-w, c); g.closePath(); g.fill(); });
    const walls = F.union(sp.rect(-w, -w, c + w, w), sp.rect(-w, -w, w, c + w));
    const one = buildSolid(sp, [{ f: plate, z0: 0, z1: p.backT }, { f: walls, z0: p.backT, z1: p.backT + p.slotT }]);
    return [0, 1, 2, 3].map(k => { const g = one.clone(); return { geo: g, label: '卡角' }; });
  }
  const sp = new Space(-ox - 3, -oy - 3, ox + 3, oy + 3, 700);
  const outer = sp.rect(-ox, -oy, 2 * ox, 2 * oy, 2.5);
  const side = { top: 'top', left: 'right', right: 'left' }[p.insert]; // 镜像
  const ext = 50;
  const extend = (x0, y0, x1, y1) => {
    if (side === 'top') y0 -= ext; else if (side === 'left') x0 -= ext; else x1 += ext;
    return sp.rect(x0, y0, x1 - x0, y1 - y0);
  };
  const cav = extend(-P.w / 2, -P.h / 2, P.w / 2, P.h / 2);
  const pins = top => p.attach === 'pins' ? [{ f: F.union(...pinSpots(P, w).map(([x, y]) => sp.circle(x, y, 1.2))), z0: top, z1: top + 2 }] : [];
  if (p.holder === 'full') {
    const top = p.backT + p.slotT;
    return [{ geo: buildSolid(sp, [{ f: outer, z0: 0, z1: p.backT }, { f: F.sub(outer, cav), z0: p.backT, z1: top }, ...pins(top)]), label: '夹层' }];
  }
  if (p.holder === 'half') {
    const r = Math.min(p.rail, Math.min(P.w, P.h) / 2 - 5);
    const open = extend(-P.w / 2 + r, -P.h / 2 + r, P.w / 2 - r, P.h / 2 - r);
    const top = p.backT + p.slotT;
    return [{ geo: buildSolid(sp, [{ f: F.sub(outer, open), z0: 0, z1: p.backT }, { f: F.sub(outer, cav), z0: p.backT, z1: top }, ...pins(top)]), label: '夹层' }];
  }
  // cover：外框 + 压入式后盖
  const top = p.slotT + p.backT;
  const ring = buildSolid(sp, [{ f: F.sub(outer, sp.rect(-P.w / 2, -P.h / 2, P.w, P.h, 0.5)), z0: 0, z1: top }, ...pins(top)]);
  const t = p.tol;
  const sp2 = new Space(-P.w / 2 - 2, -P.h / 2 - 2, P.w / 2 + 2, P.h / 2 + 2, 700);
  const lid = F.sub(sp2.rect(-P.w / 2 + t, -P.h / 2 + t, P.w - 2 * t, P.h - 2 * t, 0.5), sp2.circle(0, P.h / 2, 6));
  return [{ geo: ring, label: '后盖外框' }, { geo: buildSolid(sp2, [{ f: lid, z0: 0, z1: p.backT }]), label: '后盖' }];
}

/** 底座：侧面轮廓（带斜槽）沿宽度方向挤出，槽两端封口 */
function standBase(p) {
  const D = p.baseD, H = p.baseH, W = Math.max(p.baseW, p.tongueW + 12);
  const th = p.tilt * Math.PI / 180, slotW = p.tongueT + 0.35, depth = p.tongueL + 0.5;
  let warn = null;
  if (depth * Math.cos(th) > H - 2) warn = '插入深度比底座高度还深，槽会打穿底座。请加高底座或减小插入深度。';
  const sp = new Space(-D / 2 - 2, -H - 2, D / 2 + 2, 2, 500); // u = 前后，v = -高度
  const prof = sp.draw(g => {
    g.beginPath();
    if (p.standStyle === 'block') g.roundRect(-D / 2, -H, D, H, [Math.min(5, H / 3), Math.min(5, H / 3), 0, 0]);
    else if (p.standStyle === 'round') {
      const r = Math.min(H * 0.5, D * 0.2);
      g.moveTo(-D / 2, 0); g.lineTo(-D / 2, -H + r); g.quadraticCurveTo(-D / 2, -H, -D / 2 + r, -H); g.lineTo(D / 2 - r, -H); g.quadraticCurveTo(D / 2, -H, D / 2, -H + r); g.lineTo(D / 2, 0); g.closePath();
    } else { g.moveTo(-D / 2, 0); g.lineTo(-D / 2, -H * 0.3); g.quadraticCurveTo(-D / 2, -H, 0, -H); g.quadraticCurveTo(D / 2, -H, D / 2, -H * 0.3); g.lineTo(D / 2, 0); g.closePath(); }
    g.fill();
  });
  // 斜槽：从顶面往下、往前倾斜 th（相框插进去后向后仰）
  const us = 2, ax = Math.sin(th), ay = Math.cos(th), nx = Math.cos(th), ny = -Math.sin(th);
  const S = [us - ax * 3, -H - ay * 3], L = depth + 3;
  const slot = sp.draw(g => {
    g.beginPath();
    g.moveTo(S[0] - nx * slotW / 2, S[1] - ny * slotW / 2);
    g.lineTo(S[0] + nx * slotW / 2, S[1] + ny * slotW / 2);
    g.lineTo(S[0] + ax * L + nx * slotW / 2, S[1] + ay * L + ny * slotW / 2);
    g.lineTo(S[0] + ax * L - nx * slotW / 2, S[1] + ay * L - ny * slotW / 2);
    g.closePath(); g.fill();
  });
  const e = (W - (p.tongueW + 0.8)) / 2;
  const geo = buildSolid(sp, [{ f: prof, z0: 0, z1: W }, { f: slot, z0: e, z1: W - e, op: 'sub' }]);
  // (前后, 高, 宽) → (宽, 前后, 高)
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return { geo, warn };
}
