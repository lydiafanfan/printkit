/* 打印助手 · 界面逻辑 */
import * as THREE from 'three';
import { Viewer, Thumbnailer } from './viewer.js?v=44';
import { TOOLS } from './tools.js?v=44';
import { SAMPLES } from './samples.js?v=44';
import { artFromSVG, artFromFile, artFromText, layoutParts, exportSTL } from './engine.js?v=44';
import { previewHM, levelLabels, isColorful, defaultHeights, sampleHeightmap } from './heightmap.js?v=44';
import { getFit, setFit } from './parts.js?v=44';
import { export3MF } from './export3mf.js?v=44';
import { exportGLB } from './exportglb.js?v=44';
import { SOLID, manifoldReady, solidMesh } from './solid.js?v=44';
import { makeBatch } from './batch.js?v=44';
import { estimate, MATERIALS, PATTERNS, EST_DEFAULT } from './estimate.js?v=44';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('printkit.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('printkit.' + k, JSON.stringify(v)); } catch { } },
};
const PRINTER = { name: 'P1S', full: 'Bambu Lab P1S', bed: 256, nozzle: 0.4 };
const fmt = v => (Math.round(v * 10) / 10).toString();
function toast(msg) { document.querySelectorAll('.toast').forEach(t => t.remove()); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

const ICONS = {
  stamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v5a3 3 0 0 1-1 2.2V12h4a2 2 0 0 1 2 2v3H4v-3a2 2 0 0 1 2-2h4v-1.8A3 3 0 0 1 9 8z"/><path d="M5 21h14"/></svg>',
  extrude: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 9l9-5 9 5-9 5z"/><path d="M3 9v6l9 5 9-5V9"/></svg>',
  keychain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="8" cy="8" r="4"/><path d="M10.8 10.8L20 20M16 16l2-2M18.5 18.5l1.5-1.5"/></svg>',
  cookie: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"/></svg>',
  organza: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12C9 5 4 4 3.5 7.5S7 12 12 12zM12 12c3-7 8-8 8.5-4.5S17 12 12 12zM12 12c-2 4-6 6-7.5 4.5S8 12 12 12zM12 12c2 4 6 6 7.5 4.5S16 12 12 12z"/><path d="M3 20h18" stroke-dasharray="2 2"/></svg>',
  storage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M2.5 5h19v3h-19zM9 8v12M15 8v12"/></svg>',
  spoolrack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="18" width="18" height="3" rx="1"/><path d="M7 18V6M12 18V6M17 18V6"/><rect x="5" y="9" width="4" height="6" rx="1"/><rect x="15" y="9" width="4" height="6" rx="1"/></svg>',
  label: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l5-6h13v12H8z"/><circle cx="8" cy="12" r="1.2"/><path d="M12 10h6M12 14h4"/></svg>',
  buckle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="8" height="10" rx="1.5"/><path d="M10 9h4l3-2M10 15h4l3 2"/><rect x="15" y="6" width="7" height="12" rx="2"/></svg>',
  joiner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h7v12H3zM14 6h7v12h-7z"/><path d="M8 10h8M8 14h8" stroke-width="2.4"/></svg>',
  tolerance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="2"/><circle cx="7" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.9"/><circle cx="17" cy="12" r="2.4"/></svg>',
  button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6" stroke-opacity=".5"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="14" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="14" r=".9" fill="currentColor"/><circle cx="14" cy="14" r=".9" fill="currentColor"/></svg>',
  framestudio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M7 15l3-3 2 2 2-1.5 3 2.5"/></svg>',
};
const PALETTE = [['#8fd3c1', '薄荷'], ['#f4c6b8', '蜜桃'], ['#f3dc9b', '奶油'], ['#a9bde6', '雾蓝'], ['#f7f4ee', '白色'], ['#d9d6cf', '灰白'], ['#9aa0a6', '灰色'], ['#2f2f33', '黑色'],
  ['#e0534a', '红色'], ['#f28c38', '橙色'], ['#f2c94c', '黄色'], ['#5aa469', '绿色'], ['#3d7bd9', '蓝色'], ['#8e6bbf', '紫色'], ['#f29bb5', '粉色'], ['#8b5e3c', '棕色']];
const FONTS = [
  ['"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif', '黑体'],
  ['"Songti SC","STSong","SimSun",serif', '宋体'],
  ['"Kaiti SC","STKaiti","KaiTi",serif', '楷体'],
  ['"Hannotate SC","HanziPen SC","Yuanti SC",cursive', '手写'],
  ['"Avenir Next","Futura","Helvetica Neue",sans-serif', 'Sans'],
  ['Georgia,"Times New Roman",serif', 'Serif'],
];

// ---------- 状态 ----------
const S = {
  toolId: LS.get('tool', 'stamp'),
  params: LS.get('params', {}),
  img: { threshold: 0.5, invert: false, thicken: 0, smooth: 0, gap: 0.6, ...LS.get('img', {}) },
  color: LS.get('color', 0),
  tab: 'sample',
  source: 'sample',          // sample | file | text
  sampleId: null,
  text: LS.get('text', '小 雏 菊'),
  font: LS.get('font', 0),
  bold: LS.get('bold', true),
  src: LS.get('src', {}),    // 每个工具各自记住用的是哪个示例 / 文字；上传的图片跨工具沿用
  art: null,
  hmArt: null,               // 相框工作室用的高度图
  parts: [],
};
if (!TOOLS.find(t => t.id === S.toolId)) S.toolId = 'stamp';
const tool = () => TOOLS.find(t => t.id === S.toolId);
const P = () => ({ ...tool().defaults, ...(S.params[S.toolId] || {}) });
const setP = (k, v) => { pushHist(k); (S.params[S.toolId] ||= {})[k] = v; LS.set('params', S.params); };
// 撤销 / 重做：记下这个工具的参数和图像调整；连续拖同一个滑块只算一步
const HIST = { undo: [], redo: [], last: null };
const snap = () => JSON.stringify({ tool: S.toolId, params: S.params[S.toolId] || {}, img: S.img });
function pushHist(key) {
  const now = Date.now(), tag = S.toolId + ':' + key;
  if (HIST.last && HIST.last.tag === tag && now - HIST.last.t < 1200) { HIST.last.t = now; return; }
  HIST.last = { tag, t: now };
  HIST.undo.push(snap()); if (HIST.undo.length > 60) HIST.undo.shift();
  HIST.redo.length = 0; syncHist();
}
function stepHist(from, to) {
  let i = from.length - 1;
  while (i >= 0 && JSON.parse(from[i]).tool !== S.toolId) i--; // 只撤销当前工具的改动
  if (i < 0) return false;
  const st = JSON.parse(from.splice(i, 1)[0]);
  to.push(snap()); HIST.last = null;
  S.params[S.toolId] = st.params; LS.set('params', S.params);
  S.img = st.img; LS.set('img', S.img);
  renderPanel(); rebuild(); syncHist();
  return true;
}
const undo = () => stepHist(HIST.undo, HIST.redo) ? toast('已撤销') : toast('没有可以撤销的了');
const redo = () => stepHist(HIST.redo, HIST.undo) ? toast('已重做') : toast('没有可以重做的了');
function syncHist() {
  const has = a => a.some(x => JSON.parse(x).tool === S.toolId);
  const u = document.getElementById('undoBtn'), r = document.getElementById('redoBtn');
  if (u) u.disabled = !has(HIST.undo); if (r) r.disabled = !has(HIST.redo);
}

const sampleCache = new Map();
function sampleArt(id) {
  if (!sampleCache.has(id)) { const s = SAMPLES.find(x => x.id === id); sampleCache.set(id, artFromSVG(s.svg, s.name)); }
  return sampleCache.get(id);
}
async function loadSample(id) {
  S.art = await sampleArt(id);
  S.source = 'sample'; S.sampleId = id;
}
const rememberSrc = v => { S.src[S.toolId] = v; LS.set('src', S.src); };
/** 切换工具时：上传的图片接着用；示例和文字每个工具各记各的 */
async function restoreSource(carried) {
  const t = tool();
  if (S.source === 'file' && S.art) { S.tab = 'upload'; if (carried) setTimeout(() => toast('沿用了刚才上传的图片，想换可以在「图案」里选'), 500); return; }
  const m = S.src[t.id];
  if (m?.mode === 'text') {
    try { S.art = artFromText(S.text, FONTS[S.font][0], S.bold); S.source = 'text'; S.tab = 'text'; return; } catch { }
  }
  await loadSample(SAMPLES.some(x => x.id === m?.sampleId) ? m.sampleId : t.sample);
  S.tab = 'sample';
}

// ---------- 3D 预览 ----------
const viewer = new Viewer($('#viewport'));
// ---------- 颜色：每个零件一种颜色（右侧面板里的「颜色」一组） ----------
S.c1 = '#8fd3c1';                // 没有主题色的工具用的主色（每个工具默认用自己的主题色）
S.c2 = LS.get('c2', '#f7f4ee');   // 默认第二色（纱层、双色零件的文字…）
S.pc = LS.get('pc', {});          // 用户改过的颜色：{ 工具 id: { 零件名: '#rrggbb' } }
S.pcOpen = null;                  // 正在展开调色板的零件名
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const pcKey = p => p.label || '零件';
const isSecond = (p, i) => !!(p.second || p.translucent || (p.keepPlace && i > 0));
/** 每个零件的颜色：用户改过的 > 零件自带的（多色相框、拼接件）> 工具的主题色 / 第二色 */
function partColors(parts = S.parts, toolId = S.toolId) {
  const ov = S.pc[toolId] || {};
  const main = META[toolId]?.hex || S.c1;
  return parts.map((p, i) => ov[pcKey(p)] || p.color || (isSecond(p, i) ? S.c2 : main));
}
function setPartColor(label, hex) {
  if (label == null) return;
  if (tool().onPartColor?.(label, hex)) { S.parts.forEach(p => { if (pcKey(p) === label) p.color = hex; }); refreshLive(); }
  else { (S.pc[S.toolId] ||= {})[label] = hex; LS.set('pc', S.pc); }
  viewer.setColors(partColors());
}
const colorName = c => PALETTE.find(([x]) => same(x, c))?.[1] || (same(c, META[S.toolId]?.hex) ? '默认色' : String(c).toUpperCase());
function colorSecHTML() {
  return sec('colors', '颜色', `<div class="pc-rows" id="pcRows"></div>
    <p class="cp-note">颜色会写进 3MF，用 Bambu Studio 打开时每个零件已经分好色；实际颜色以你装的耗材为准。STL 不带颜色。</p>
    <button class="link-btn" id="pcReset" hidden>恢复默认颜色</button>`, '<span class="sec-sum pc-dots" id="pcSum"></span>');
}
function renderColors() {
  const box = $('#pcRows'); if (!box) return;
  const cols = partColors(), groups = [];
  S.parts.forEach((p, i) => { const k = pcKey(p); let g = groups.find(x => x.k === k); if (!g) groups.push(g = { k, n: 0, c: cols[i] }); g.n++; });
  if (!groups.some(g => g.k === S.pcOpen)) S.pcOpen = null;
  $('#pcSum').innerHTML = groups.slice(0, 8).map(g => `<i style="background:${g.c}"></i>`).join('');
  $('#pcReset').hidden = !Object.keys(S.pc[S.toolId] || {}).length;
  box.innerHTML = groups.map(g => {
    const open = S.pcOpen === g.k, custom = !PALETTE.some(([c]) => same(c, g.c));
    return `<div class="pc-item ${open ? 'open' : ''}">
      <button class="pc-row" data-pc="${esc(g.k)}" aria-expanded="${open}"><i class="pc-sw" style="background:${g.c}"></i><span class="pc-name">${esc(g.k)}${g.n > 1 ? `<small>× ${g.n}</small>` : ''}</span><span class="pc-val">${esc(colorName(g.c))}</span>${CHEV}</button>
      ${open ? `<div class="cp-grid">${PALETTE.map(([c, n]) => `<button style="--c:${c}" title="${n}" aria-label="${n}" data-pcc="${c}" class="${same(c, g.c) ? 'on' : ''}"></button>`).join('')}
        <label class="cp-custom ${custom ? 'on' : ''}" title="自定义颜色" style="${custom ? `--c:${g.c}` : ''}"><input type="color" data-pcc-custom value="${g.c}"><span>${custom ? '' : '+'}</span></label></div>` : ''}</div>`;
  }).join('') || '<p class="muted">模型生成后，在这里给每个零件选颜色。</p>';
}
$('#viewReset').onclick = () => viewer.frame();
$('#undoBtn').onclick = () => undo();
$('#redoBtn').onclick = () => redo();
$('#viewFlip').onclick = () => { viewer.flip(); $('#viewFlip').classList.toggle('on', viewer.flipped); };
window.printkit = { viewer, S }; // 方便调试
$('#viewTop').onclick = () => viewer.top();

// ---------- 每个工具的配色 ----------
const META = {
  stamp: { tc: 'var(--t-peach)', hex: '#f2a38c' },
  extrude: { tc: 'var(--t-sky)', hex: '#8db3e3' },
  keychain: { tc: 'var(--t-lilac)', hex: '#ad9eea' },
  cookie: { tc: 'var(--t-butter)', hex: '#ecc463' },
  organza: { tc: 'var(--t-rose)', hex: '#e78ea6' },
  button: { tc: 'var(--t-sand)', hex: '#d9b28a' },
  framestudio: { tc: 'var(--t-mint)', hex: '#79c9ae' },
  tolerance: { tc: 'var(--t-mint)', hex: '#6fbfa6' },
  storage: { tc: 'var(--t-sand)', hex: '#d9b28a' },
  joiner: { tc: 'var(--t-sky)', hex: '#8db3e3' },
  spoolrack: { tc: 'var(--t-peach)', hex: '#efa48c' },
  label: { tc: 'var(--t-lilac)', hex: '#ad9eea' },
  buckle: { tc: 'var(--t-butter)', hex: '#e9bf5c' },
};
const IMG_TOOLS = () => TOOLS.filter(t => !t.cat);
const MESH_TOOLS = () => TOOLS.filter(t => t.cat === 'mesh');
const PART_TOOLS = () => TOOLS.filter(t => t.cat === 'parts');
const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SOON = [
];

function renderBar() {
  const t = tool(), m = META[t.id] || {};
  const ico = $('#barIco'); ico.innerHTML = ICONS[t.id]; ico.style.setProperty('--tc', m.tc);
  $('#barName').textContent = t.name;
  $('#barSub').textContent = t.tagline;
  $('#viewport').style.setProperty('--tc', m.tc || 'var(--t-sand)');
}
const navLink = (t, on) => `<a href="#/tool/${t.id}" class="${t.id === on ? 'on' : ''}"><span class="n-ico" style="--tc:${META[t.id]?.tc}">${ICONS[t.id]}</span>${t.name}</a>`;
function renderSide() {
  const on = location.hash.startsWith('#/tool/') ? S.toolId : null;
  $('#sideNav').innerHTML = `
    <a href="#/" class="${on ? '' : 'on'}"><span class="n-ico" style="--tc:var(--sunken)">${ic('<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>')}</span>首页</a>
    <div class="nav-label">图案变模型</div>
    ${IMG_TOOLS().map(t => navLink(t, on)).join('')}
    <div class="nav-label">参数化零件</div>
    ${PART_TOOLS().map(t => navLink(t, on)).join('')}
    <div class="nav-label">模型处理</div>
    ${MESH_TOOLS().map(t => navLink(t, on)).join('')}
    ${SOON.map(z => `<span class="soon"><span class="n-ico">${z.icon}</span>${z.name}<em>即将</em></span>`).join('')}`;
}
const closeSide = () => $('#side').classList.remove('open');
$('#menuBtn').addEventListener('click', () => $('#side').classList.add('open'));
$('#scrim').addEventListener('click', closeSide);
$('#sideNav').addEventListener('click', e => { if (e.target.closest('a')) closeSide(); });

// ---------- 首页 ----------
// ---------- 配色主题 ----------
// 每套主题：7 种色块颜色 + 页面底色 / 面板色 / 文字色 / 强调色。模型默认色 = 色块颜色加深一档
const THEMES = {
  candy: { name: '糖果', tiles: { mint: '#3ed6b0', peach: '#ff8a65', butter: '#ffd23f', lilac: '#b197fc', sky: '#5ea8ff', rose: '#ff8fb8', sand: '#f7b77a' },
    vars: { bg: '#ffffff', panel: '#f2f3f8', sunken: '#eef0f6', sunken2: '#e2e5ef', ink: '#14151a', ink2: '#494c59', muted: '#666a78', line: '#e4e7f0', line2: '#eceef5', accent: '#ff5a36', 'accent-soft': '#ffe6dc', 'accent-ink': '#c7361a' } },
  berry: { name: '莓果', tiles: { mint: '#7fe0c2', peach: '#ffa07a', butter: '#ffd166', lilac: '#c9a0ff', sky: '#8ec5ff', rose: '#ff86b0', sand: '#f5b8a0' },
    vars: { bg: '#fff4f7', panel: '#fce1ea', sunken: '#f9e3ea', sunken2: '#f5ccd9', ink: '#3a1731', ink2: '#6b4460', muted: '#825c76', line: '#f3d3de', line2: '#f8e2e9', accent: '#e0457b', 'accent-soft': '#fde0ea', 'accent-ink': '#b92c5e' } },
  retro: { name: '复古', tiles: { mint: '#8dbf9a', peach: '#e8896a', butter: '#edbe4c', lilac: '#b58db6', sky: '#7fa3cf', rose: '#e79aa4', sand: '#d8b384' },
    vars: { bg: '#fafbf9', panel: '#eceeea', sunken: '#e9ece7', sunken2: '#dadfd6', ink: '#20362b', ink2: '#4b5f52', muted: '#627367', line: '#dde1d9', line2: '#e7eae4', accent: '#e9692c', 'accent-soft': '#fbe2d2', 'accent-ink': '#b84a16' } },
  soft: { name: '素雅', tiles: { mint: '#dcf1e9', peach: '#fde4d8', butter: '#faefcc', lilac: '#ebe6fb', sky: '#dfecf8', rose: '#fbe1e9', sand: '#eee8de' }, vars: {} },
};
const THEME_VARS = ['bg', 'panel', 'sunken', 'sunken2', 'ink', 'ink2', 'muted', 'line', 'line2', 'accent', 'accent-soft', 'accent-ink'];
S.theme = THEMES[LS.get('theme', 'candy')] ? LS.get('theme', 'candy') : 'candy';
Object.values(META).forEach(m => { m.hex0 = m.hex; m.tile = m.tc.match(/--t-(\w+)/)[1]; });
const tileHex = id => THEMES[S.theme].tiles[META[id]?.tile] || '#efe9df';
function applyTheme(id, redraw) {
  S.theme = id; LS.set('theme', id);
  const th = THEMES[id], st = document.documentElement.style;
  THEME_VARS.forEach(k => th.vars[k] ? st.setProperty('--' + k, th.vars[k]) : st.removeProperty('--' + k));
  Object.entries(th.tiles).forEach(([k, v]) => st.setProperty('--t-' + k, v));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th.vars.bg || '#ffffff');
  Object.values(META).forEach(m => { m.hex = id === 'soft' ? m.hex0 : '#' + new THREE.Color(th.tiles[m.tile]).offsetHSL(0, -0.12, -0.11).getHexString(); });
  document.querySelectorAll('#themePick button').forEach(b => b.classList.toggle('on', b.dataset.theme === id));
  if (!redraw) return;
  if ($('#home').hidden) { viewer.setColors(partColors()); renderColors(); } else { renderHome(); setTimeout(makeThumbs, 100); }
}
$('#themePick').innerHTML = Object.entries(THEMES).map(([id, t]) => `<button data-theme="${id}" title="${t.name}" aria-label="配色：${t.name}"><i style="background:${t.tiles.peach}"></i><i style="background:${t.tiles.butter}"></i><i style="background:${t.tiles.sky}"></i><span>${t.name}</span></button>`).join('');
$('#themePick').addEventListener('click', e => { const b = e.target.closest('[data-theme]'); if (b) applyTheme(b.dataset.theme, true); });
applyTheme(S.theme, false);

// ---------- 首页 ----------
const thumbKey = id => `thumb.v16.${S.theme}.${id}`;
function renderHome() {
  const SIZE = { stamp: 'lg', cookie: 'wide', framestudio: 'wide', tolerance: 'wide', joiner: 'wide' }; // 便当格：大小不一的格子
  const card = t => {
    const m = META[t.id] || {}, url = LS.get(thumbKey(t.id), null);
    return `<a class="card-tool ${SIZE[t.id] || ''}" href="#/tool/${t.id}" style="--tc:${m.tc}">
      <div class="art" data-thumb="${t.id}">${url ? `<img src="${url}" alt="">` : `<span class="ph">${ICONS[t.id]}</span>`}</div>
      <div class="meta"><b>${t.name}</b><span>${t.tagline}</span></div>
      <span class="go"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></span></a>`;
  };
  const recent = LS.get('recent', []).map(id => TOOLS.find(t => t.id === id)).filter(Boolean).slice(0, 4);
  $('#home').innerHTML = `<div class="home-in">
    <div class="hero">
      <button class="tb-btn only-narrow" id="menuBtn2" aria-label="菜单"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      <h1>把图案<br>变成<em>模型</em></h1>
      <div class="hero-side">
        <p>线稿、文字或几个尺寸，在浏览器里直接生成 3MF / STL，拖进切片软件就能打印。</p>
        <ol class="steps"><li><b>1</b>选一个工具</li><li><b>2</b>上传图片或调参数</li><li><b>3</b>下载，开始打印</li></ol>
      </div>
    </div>
    ${recent.length ? `<div class="recent"><span class="recent-label">最近使用</span>${recent.map(t => `<a href="#/tool/${t.id}"><span class="n-ico" style="--tc:${META[t.id]?.tc}">${ICONS[t.id]}</span>${t.name}</a>`).join('')}</div>` : ''}
    <section class="h-sec">
      <div class="h-sec-head"><h2>图案变模型</h2><span>从图片、线稿或文字生成</span></div>
      <div class="grid bento">${IMG_TOOLS().map(card).join('')}</div>
    </section>
    <section class="h-sec">
      <div class="h-sec-head"><h2>零件和模型处理</h2><span>调滑块生成实用零件，或给已有的 STL 加连接件</span></div>
      <div class="grid bento">${[...PART_TOOLS(), ...MESH_TOOLS()].map(card).join('')}</div>
    </section>
  </div>`;
  $('#menuBtn2')?.addEventListener('click', () => $('#side').classList.add('open'));
}

// 首页卡片用真实的 3D 渲染图（第一次打开时生成，之后缓存）
let thumbing = false;
try { Object.keys(localStorage).filter(k => k.startsWith('printkit.thumb.') && !k.startsWith('printkit.thumb.v16.')).forEach(k => localStorage.removeItem(k)); } catch { }
async function makeThumbs() {
  if (thumbing) return; thumbing = true;
  let tn = null;
  const theme = S.theme, key = id => `thumb.v16.${theme}.${id}`;
  try {
    for (const t of TOOLS) {
      if (LS.get(key(t.id), null)) continue;
      await new Promise(r => setTimeout(r, 40));
      try {
        if (t.kind === 'mesh') continue; // 需要用户的模型，首页不渲染缩略图
        if (t.init) await t.init();
        const art = t.kind === 'heightmap' ? sampleHeightmap() : t.kind === 'param' ? null : await sampleArt(t.sample);
        const res = t.build(art, { threshold: 0.5, invert: false, thicken: 0 }, { ...t.defaults });
        layoutParts(res.parts);
        tn ||= new Thumbnailer(480, 360);
        const url = tn.render(t.kind === 'heightmap' ? res.parts.slice(0, 1) : res.parts, META[t.id]?.hex || '#8fd3c1', tileHex(t.id));
        res.parts.forEach(pt => pt.geo.dispose());
        if (theme !== S.theme) break; // 生成到一半换了配色：这一轮作废
        LS.set(key(t.id), url);
        document.querySelectorAll(`[data-thumb="${t.id}"]`).forEach(box => { const keep = box.querySelector('small'); box.innerHTML = `<img src="${url}" alt="">`; if (keep) box.appendChild(keep); });
      } catch (err) { console.warn('缩略图失败', t.id, err); }
    }
  } finally { tn?.dispose(); thumbing = false; if (theme !== S.theme) setTimeout(makeThumbs, 50); }
}

// ---------- 路由 ----------
let opened = false, introNext = false;
async function openTool(id) {
  $('#home').hidden = true; $('#studio').hidden = false;
  const changed = id !== S.toolId || !opened, carried = opened && id !== S.toolId;
  S.toolId = id; LS.set('tool', id);
  LS.set('recent', [id, ...LS.get('recent', []).filter(x => x !== id)].slice(0, 6));
  renderSide();
  if (changed) {
    if (tool().kind === 'heightmap') { if (!S.hmArt) S.hmArt = sampleHeightmap(); }
    else if (tool().init) { renderBar(); renderPanel(); $('#busy').classList.add('on'); try { await tool().init(); } catch (e) { showError('建模模块加载失败，请检查网络后刷新：' + e.message); } }
    else if (tool().kind !== 'param') await restoreSource(carried);
    opened = true;
    renderBar(); renderPanel(); rebuild(true); introNext = true; syncHist();
    window.scrollTo(0, 0); $('#panel').scrollTop = 0;
  }
  viewer.resize();
}
function showHome() {
  $('#studio').hidden = true; $('#home').hidden = false;
  renderHome(); renderSide(); window.scrollTo(0, 0);
  setTimeout(makeThumbs, 300);
}
function route() {
  const m = location.hash.match(/^#\/tool\/(\w+)/);
  if (m && TOOLS.find(t => t.id === m[1])) openTool(m[1]); else showHome();
}
addEventListener('hashchange', route);

// ---------- 左侧面板 ----------
function artThumb() { return S.art ? inkThumb(S.art, 96).url : ''; }
/** 按现在的阈值 / 反相把图变成黑白小图；ink = 有没有深色部分 */
function inkThumb(art, size = 150) {
  try {
    const { cw, ch, lum, alpha } = art.analysis();
    const k = Math.min(1, size / Math.max(cw, ch));
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'), out = ctx.createImageData(w, h);
    let ink = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = Math.floor(y / k) * cw + Math.floor(x / k);
      const v = S.img.invert ? alpha[i] * lum[i] : alpha[i] * (1 - lum[i]);
      const on = v > S.img.threshold, o = (y * w + x) * 4;
      out.data[o] = 40; out.data[o + 1] = 36; out.data[o + 2] = 32; out.data[o + 3] = on ? 255 : 0;
      if (on) ink = true;
    }
    ctx.putImageData(out, 0, 0);
    return { url: c.toDataURL(), ink };
  } catch { return { url: '', ink: false }; }
}

function ctlHTML(c, p) {
  const v = p[c.k];
  const hint = c.hint ? `<small>${c.hint}</small>` : '';
  if (c.type === 'range') {
    const pct = ((v - c.min) / (c.max - c.min) * 100).toFixed(1);
    return `<div class="ctl"><div class="ctl-top"><label for="r-${c.k}">${c.label}${hint}</label>
      <span class="num"><input type="number" data-k="${c.k}" data-num value="${v}" min="${c.min}" max="${c.max}" step="${c.step}" inputmode="decimal">${c.unit || ''}</span></div>
      <input id="r-${c.k}" class="slider" type="range" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}" style="--p:${pct}%"></div>`;
  }
  if (c.type === 'seg') return `<div class="ctl"><div class="ctl-top"><span class="lbl">${c.label}${hint}</span></div>
    <div class="seg">${c.options.map(([val, lab]) => `<button data-k="${c.k}" data-v="${val}" class="${String(v) === String(val) ? 'on' : ''}">${lab}</button>`).join('')}</div></div>`;
  if (c.type === 'toggle') return `<label class="ctl ctl-row"><span class="lbl">${c.label}${hint}</span><span class="switch"><input type="checkbox" data-k="${c.k}" ${v ? 'checked' : ''}><i></i></span></label>`;
  if (c.type === 'cards') return `<div class="ctl">${c.label ? `<div class="ctl-top"><span class="lbl">${c.label}${hint}</span></div>` : ''}
    <div class="cards c${c.cols || 3}">${c.options.map(([val, lab, desc, icon]) => `<button class="opt-card ${String(v) === String(val) ? 'on' : ''}" data-k="${c.k}" data-v="${val}">${icon || ''}<b>${lab}</b>${desc ? `<small>${desc}</small>` : ''}</button>`).join('')}</div></div>`;
  if (c.type === 'levels') return levelsHTML(p);
  if (c.type === 'text') return `<div class="ctl"><div class="ctl-top"><span class="lbl">${c.label}${hint}</span></div><textarea class="textarea" data-k="${c.k}" data-text rows="2">${esc(v)}</textarea></div>`;
  if (c.type === 'live') return `<div class="ctl live" data-live="${c.k}">${c.render(p)}</div>`;
  if (c.type === 'info') return `<div class="ctl info-line" data-info="${c.k}">${c.render(p)}</div>`;
  if (c.type === 'fitpick') return `<div data-fitpick>${fitPickHTML(p)}</div>`;
  if (c.type === 'select') return `<div class="ctl"><div class="ctl-top"><span class="lbl">${c.label}${hint}</span></div>
    <div class="select"><select data-k="${c.k}">${c.options.map(([val, lab]) => `<option value="${val}" ${v === val ? 'selected' : ''}>${lab}</option>`).join('')}</select></div></div>`;
  return '';
}

// ---------- 公差测试结果 ----------
function fitPickHTML(p) {
  const cs = tool().clearances(p), fit = getFit();
  const row = (key, title, hint) => `<div class="ctl"><div class="ctl-top"><span class="lbl">${title}<small>${hint}</small></span>
    <span class="fit-val ${fit.measured ? '' : 'dim'}">${fit[key]} mm</span></div>
    <div class="fit-chips">${cs.map(c => `<button class="chip ${fit.measured && Math.abs(fit[key] - c) < 1e-6 ? 'on' : ''}" data-fit="${key}" data-v="${c}">${c.toFixed(2)}</button>`).join('')}</div></div>`;
  return `<p class="fit-intro">${fit.measured ? '已保存你的打印机间隙，之后的参数化零件会自动使用。' : '打印测试后，点选对应的间隙保存。没测之前按默认值计算。'}</p>
    ${row('slide', '滑动配合', '能顺滑插进拔出的最小间隙')}
    ${row('press', '紧配合', '要用力压入、但不会裂')}`;
}

// ---------- 相框工作室专用 ----------
function hmInfo(p) { try { return { info: tool().info(S.hmArt, p) }; } catch (e) { return { err: e.message }; } }
/** 批量生成入口（相框工作室和所有上传图片的工具） */
function batchBtnHTML() {
  let batch = null;
  try { batch = batchRef(); } catch { } // 页面刚打开时批量模块可能还没建好
  const mine = batch?.toolId === S.toolId, dir = batch?.dirName;
  const sub = dir ? (mine ? `文件夹「${dir}」${batch.watching ? '：新图片自动生成' : ''}` : `文件夹「${dir}」现在给「${batch.toolName}」用${batch.watching ? '（自动生成中）' : ''}`)
    : '一次放多张图，或者选一个文件夹自动生成';
  const badge = batch?.watching && mine ? '<em class="live">自动生成中</em>' : mine && batch?.count ? `<em>${batch.count} 张</em>` : '';
  return `<button class="bt-open" id="hmBatch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>
      <span>批量生成<small>${sub}</small></span>${badge}</button>`;
}
const batchRef = () => batch;
const batchable = t => t && (t.kind === 'heightmap' || !t.kind);

function hmCardHTML(p) {
  const t = tool(), { info, err } = hmInfo(p);
  const manual = p.winMode === 'manual', box = manual && info?.box;
  const prev = info ? previewHM(info.viewArt || info.art, manual ? { ...info, win: null } : info, info.viewArt ? false : p.invert) : '';
  const handles = ['nw', 'ne', 'sw', 'se'].map(h => `<i data-h="${h}"></i>`).join('');
  const stage = prev ? `<div class="hm-stage"><img src="${prev}" alt="相框图预览" draggable="false">${box
    ? `<div class="win-box ${p.winShape === 'oval' ? 'oval' : ''}" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%"><span>相片窗口</span>${handles}</div>` : ''}</div>` : '';
  const status = info
    ? `${manual ? '<span class="ok">✓ 手动框选的窗口</span>' : info.win ? '<span class="ok">✓ 找到相片窗口</span>' : '<span class="bad">没找到相片窗口，可以改成“手动框选”</span>'}<span>识别到 ${info.levels.length} 种${info.byColor ? '颜色' : '高度'}</span>${info.bg?.removed ? `<span>已去掉${info.bg.bgName}背景</span>` : ''}`
    : `<span class="bad">${esc(err)}</span>`;
  const ctls = (t.cardParams || []).filter(c => !c.show || c.show(p)).map(c => ctlHTML(c, p)).join('');
  const manualTip = box ? `<div class="win-tip"><span>拖动框可以移动，拖四个角缩放。${t.photoRatio(p) ? '框的比例跟着“照片尺寸”走，换照片尺寸框会跟着变。' : ''}</span><button class="chip" id="hmFlip">横竖切换</button></div>` : '';
  return sec('hm', '相框图', `
    <div class="hm-preview">${stage}</div>
    <div class="hm-meta"><b>${esc(S.hmArt?.label || '')}</b>${status}</div>
    ${manualTip}${ctls}
    <button class="dropzone small" id="pick">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
      上传相框图<small>白色最高、灰色次高、黑色或透明为空；白底彩色图也可以</small></button>
    ${batchBtnHTML()}
    <button class="link-btn" id="hmSample">换回示例图</button>`);
}
// 手动框选：拖动 / 缩放窗口框
document.addEventListener('pointerdown', e => {
  const boxEl = e.target.closest('.win-box:not(.static)');
  if (!boxEl) return;
  const inBatch = !!boxEl.closest('#batch');
  e.preventDefault();
  const stage = boxEl.parentElement, R = stage.getBoundingClientRect(), h = e.target.dataset.h || null;
  const st = { x: e.clientX, y: e.clientY, l: boxEl.offsetLeft, t: boxEl.offsetTop, w: boxEl.offsetWidth, h: boxEl.offsetHeight };
  const ratio = st.h / st.w, lock = !!tool().photoRatio(P()), cl = (v, a, b) => Math.min(b, Math.max(a, v));
  const cur = { ...st };
  boxEl.setPointerCapture(e.pointerId);
  boxEl.classList.add('drag');
  const move = ev => {
    if (!h) { cur.l = cl(st.l + ev.clientX - st.x, 0, R.width - st.w); cur.t = cl(st.t + ev.clientY - st.y, 0, R.height - st.h); }
    else {
      const fx = h.includes('w') ? st.l + st.w : st.l, fy = h.includes('n') ? st.t + st.h : st.t;
      const px = cl(ev.clientX - R.left, 0, R.width), py = cl(ev.clientY - R.top, 0, R.height);
      let w = Math.max(16, Math.abs(px - fx)), hh = Math.max(16, Math.abs(py - fy));
      if (lock) { const z = Math.max(w, hh / ratio); w = z; hh = z * ratio; }
      cur.w = w; cur.h = hh; cur.l = h.includes('w') ? fx - w : fx; cur.t = h.includes('n') ? fy - hh : fy;
    }
    Object.assign(boxEl.style, { left: cur.l / R.width * 100 + '%', top: cur.t / R.height * 100 + '%', width: cur.w / R.width * 100 + '%', height: cur.h / R.height * 100 + '%' });
  };
  const up = () => {
    boxEl.removeEventListener('pointermove', move); boxEl.removeEventListener('pointerup', up); boxEl.removeEventListener('pointercancel', up);
    const nb = { cx: (cur.l + cur.w / 2) / R.width, cy: (cur.t + cur.h / 2) / R.height, w: cur.w / R.width, h: cur.h / R.height };
    if (inBatch) { batch.setBox(nb); return; }
    setP('winBox', nb);
    refreshGroups(); rebuild();
  };
  boxEl.addEventListener('pointermove', move); boxEl.addEventListener('pointerup', up); boxEl.addEventListener('pointercancel', up);
});
function levelsHTML(p) {
  const { info } = hmInfo(p);
  if (!info) return '';
  const H = Array.isArray(p.levelH) && p.levelH.length === info.levels.length ? p.levelH : defaultHeights(info.levels.length);
  const label = levelLabels(info.levels, info.byColor);
  return `<div class="ctl"><div class="ctl-top"><span class="lbl">每层高度<small>${info.byColor ? `图里识别到 ${info.levels.length} 种颜色，每种颜色一个高度` : `图里识别到 ${info.levels.length} 种亮度，从高到低`}</small></span></div>
    ${info.levels.map((l, j) => {
      const g = Math.round(l.b * 255), pct = ((H[j] - 0.4) / (20 - 0.4) * 100).toFixed(1);
      const bg = l.rgb ? `rgb(${l.rgb.join(',')})` : `rgb(${g},${g},${g})`;
      return `<div class="lv"><span class="sw" style="background:${bg}"></span><div class="lv-body">
        <div class="lv-top"><span>${label[j]}<small>占 ${Math.max(1, Math.round(l.share * 100))}%</small></span>
        <span class="num"><input type="number" data-level-num="${j}" value="${H[j]}" min="0.4" max="30" step="0.2" inputmode="decimal">mm</span></div>
        <input type="range" class="slider" data-level="${j}" min="0.4" max="20" step="0.2" value="${H[j]}" style="--p:${pct}%"></div></div>`;
    }).join('')}</div>`;
}
function setLevel(j, v) {
  const { info } = hmInfo(P());
  if (!info) return;
  const p = P();
  const H = (Array.isArray(p.levelH) && p.levelH.length === info.levels.length ? p.levelH : defaultHeights(info.levels.length)).slice();
  H[j] = v; setP('levelH', H);
}

const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
// 分组开合：颜色、耗材估算、打印提示所有工具共用一个状态（后两个默认收起），其余默认展开、每个工具各记各的
const SHARED_SECS = new Set(['colors', 'est', 'tips']), DEFAULT_CLOSED = new Set(['est', 'tips']);
const secKey = id => 'secs.' + (SHARED_SECS.has(id) ? '_' : S.toolId);
function secClosed(id) {
  const v = LS.get(secKey(id), {})[id];
  if (v !== undefined) return !v;
  return DEFAULT_CLOSED.has(id) || LS.get('closed.' + S.toolId, []).includes(id); // 兼容旧版本记下的状态
}
function setSecOpen(id, open) { const m = LS.get(secKey(id), {}); m[id] = open; LS.set(secKey(id), m); }
function sec(id, title, body, extra = '') {
  return `<section class="ins-sec ${secClosed(id) ? 'closed' : ''}" data-sec="${id}" data-title="${esc(title)}">
    <button class="sec-h" data-sec-toggle><span class="sec-t">${title}</span>${extra}${CHEV}</button><div class="sec-b">${body}</div></section>`;
}
// 不常动的参数：一组里有两个以上时收进组底部的「更多设置」，默认值就能直接打印
const ADV = {
  stamp: ['margin', 'base', 'borderW'],
  extrude: ['margin'],
  keychain: ['ring'],
  cookie: ['wall', 'bladeH', 'flangeW', 'flangeT', 'plateT', 'edgeSkip'],
  organza: ['inset', 'meshW', 'dotH'],
  button: ['holeSpace', 'dishD', 'rimW', 'detailH'],
  framestudio: ['smooth', 'gap', 'emptyT', 'invert', 'rotate', 'lip', 'wall', 'backT', 'rail', 'tol', 'magD', 'magT', 'loopD', 'tongueW', 'tongueL', 'tongueT', 'baseW', 'baseD', 'baseH'],
  tolerance: ['plateT', 'chamfer'],
  storage: ['divT', 'floor', 'lidT', 'footH'],
  spoolrack: ['baseT'],
  label: ['holeD', 'magD', 'magT'],
  joiner: ['seatDepth'],
};
const moreOpen = () => new Set(LS.get('more.' + S.toolId, []));
function groupsHTML(t, p) {
  const adv = new Set(ADV[t.id] || []), opened = moreOpen();
  return t.groups.map(g => {
    const items = g.params.filter(c => !c.show || c.show(p));
    if (!items.length) return '';
    const more = items.filter(c => adv.has(c.k)), main = items.filter(c => !adv.has(c.k));
    if (!main.length || more.length < 2) return sec('g-' + g.title, g.title, items.map(c => ctlHTML(c, p)).join(''));
    const changed = more.filter(c => p[c.k] !== t.defaults[c.k]).length;
    return sec('g-' + g.title, g.title, main.map(c => ctlHTML(c, p)).join('')
      + `<details class="more" data-more="${esc(g.title)}" ${opened.has(g.title) ? 'open' : ''}><summary>更多设置<em>${more.map(c => c.label).filter(Boolean).slice(0, 3).join('、')}</em>${changed ? `<i title="改过 ${changed} 项"></i>` : ''}</summary>${more.map(c => ctlHTML(c, p)).join('')}</details>`);
  }).join('');
}
const TIPS_SEC = () => colorSecHTML() + estSecHTML() + sec('tips', '打印提示', '<ul class="tips" id="tips"></ul>', '<span class="sec-sum" id="tipsSum"></span>');
/** 面板顶部的分组快捷跳转 */
function navHTML() { return '<nav class="ins-nav" id="insNav"></nav>'; }
function fillNav() {
  const nav = $('#insNav'); if (!nav) return;
  const short = { est: '耗材', tips: '提示' };
  nav.innerHTML = [...document.querySelectorAll('#panel .ins-sec')].map(el => `<button data-jump="${esc(el.dataset.sec)}">${esc(short[el.dataset.sec] || el.dataset.title)}</button>`).join('');
  spyNav();
}
function spyNav() {
  const panel = $('#panel'), nav = $('#insNav'); if (!nav) return;
  const top = panel.scrollTop + nav.offsetHeight + 24;
  let cur = null;
  panel.querySelectorAll('.ins-sec').forEach(el => { if (el.offsetTop <= top) cur = el.dataset.sec; });
  if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) cur = panel.querySelector('.ins-sec:last-of-type')?.dataset.sec || cur;
  nav.querySelectorAll('button').forEach(b => {
    const on = b.dataset.jump === cur;
    if (on && !b.classList.contains('on')) nav.scrollTo({ left: b.offsetLeft - nav.clientWidth / 2 + b.offsetWidth / 2, behavior: 'smooth' });
    b.classList.toggle('on', on);
  });
}
$('#panel').addEventListener('scroll', spyNav, { passive: true });
const FOOT = `<div class="ins-foot"><span>双击滑块可恢复默认</span><button class="link-btn" id="resetTool">恢复默认参数</button></div>`;

function renderPanel() {
  $('#panel').innerHTML = navHTML() + panelHTML();
  fillNav(); renderColors();
}
function panelHTML() {
  const t = tool(), p = P();
  if (t.kind === 'heightmap') return hmCardHTML(p) + groupsHTML(t, p) + TIPS_SEC() + FOOT;
  if (t.kind === 'param' || t.kind === 'mesh') return groupsHTML(t, p) + TIPS_SEC() + FOOT;
  const thumb = artThumb();
  const sourceLabel = S.source === 'sample' ? '示例图案' : S.source === 'text' ? '文字' : '上传的图片';
  const artBody = `
    <div class="tabs">
      <button data-tab="sample" class="${S.tab === 'sample' ? 'on' : ''}">示例</button>
      <button data-tab="upload" class="${S.tab === 'upload' ? 'on' : ''}">上传</button>
      <button data-tab="text" class="${S.tab === 'text' ? 'on' : ''}">文字</button>
    </div>
    ${S.tab === 'sample' ? `<div class="samples">${SAMPLES.map(s => `<button class="sample ${S.source === 'sample' && S.sampleId === s.id ? 'on' : ''}" data-sample="${s.id}" title="${s.name}"><span class="art">${s.svg}</span><span>${s.name}</span></button>`).join('')}</div>` : ''}
    ${S.tab === 'upload' ? `<button class="dropzone" id="pick">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        选择文件，或拖进窗口<small>SVG · PNG · JPG，白底黑线效果最好</small></button>` : ''}
    ${S.tab === 'text' ? `<textarea class="textarea" id="textIn" rows="2" placeholder="输入文字，可以换行">${esc(S.text)}</textarea>
      <div class="fonts">${FONTS.map(([f, n], i) => `<button class="chip ${i === S.font ? 'on' : ''}" data-font="${i}" style="font-family:${esc(f)}">${n}</button>`).join('')}</div>
      <label class="ctl ctl-row bold-row"><span class="lbl">粗体</span><span class="switch"><input type="checkbox" data-bold ${S.bold ? 'checked' : ''}><i></i></span></label>` : ''}
    ${batchBtnHTML()}
    ${S.art ? `<div class="current"><div class="thumb">${thumb ? `<img src="${thumb}" alt="">` : ''}</div><div class="meta"><b>${esc(S.art.label)}</b><span data-src-label>${sourceLabel} · 深色部分变成实体</span></div></div>` : ''}
    <details class="adv more" ${LS.get('advOpen', false) ? 'open' : ''}>
      <summary>图像调整<em>边缘毛躁、线条断开、线太细时用</em>${imgChanged() ? '<i title="改过"></i>' : ''}</summary>
      ${ctlHTML({ k: 'smooth', label: '平滑边缘', hint: '边缘毛躁、有锯齿时调大；太大会让细线变细', type: 'range', min: 0, max: 1.5, step: 0.05, unit: 'mm' }, S.img)}
      ${ctlHTML({ k: 'gap', label: '补小缝隙', hint: '线条没接上、有小缝或小断口时调大：比这个窄的缝都会补上；0 = 不补', type: 'range', min: 0, max: 3, step: 0.1, unit: 'mm' }, S.img)}
      ${ctlHTML({ k: 'threshold', label: '阈值', hint: '越大只保留越深的线条', type: 'range', min: 0.1, max: 0.9, step: 0.05 }, S.img)}
      ${ctlHTML({ k: 'thicken', label: '线条加粗', hint: '线太细打印不出来时调大', type: 'range', min: 0, max: 3, step: 0.1, unit: 'mm' }, S.img)}
      ${ctlHTML({ k: 'invert', label: '反相', hint: '白线黑底的图打开', type: 'toggle' }, S.img)}
    </details>`;
  return sec('art', '图案', artBody) + groupsHTML(t, p) + TIPS_SEC() + FOOT;
}
const IMG_DEFAULT = { threshold: 0.5, thicken: 0, invert: false, smooth: 0, gap: 0.6 };
const imgChanged = () => Object.entries(IMG_DEFAULT).some(([k, v]) => S.img[k] !== v);

const imgKeys = new Set(['threshold', 'thicken', 'invert', 'smooth', 'gap']);
function setValue(k, v, inImg) {
  if (inImg) { pushHist('img.' + k); S.img[k] = v; LS.set('img', S.img); } else setP(k, v);
}

$('#panel').addEventListener('input', e => {
  const t = e.target, k = t.dataset.k;
  if (t.hasAttribute('data-pcc-custom')) { // 自定义颜色：拖动时只更新色块，松手后再重画
    setPartColor(S.pcOpen, t.value);
    const item = t.closest('.pc-item');
    item.querySelector('.pc-sw').style.background = t.value; item.querySelector('.pc-val').textContent = t.value.toUpperCase();
    t.closest('.cp-custom').style.setProperty('--c', t.value);
    return;
  }
  if (t.dataset.e) { estInput(t); return; }
  if (t.id === 'textIn') { S.text = t.value; LS.set('text', S.text); textChanged(); return; }
  if (t.dataset.level || t.dataset.levelNum) {
    const j = +(t.dataset.level ?? t.dataset.levelNum), v = parseFloat(t.value);
    if (!isFinite(v)) return;
    const lv = t.closest('.lv');
    if (t.dataset.level) lv.querySelector('[data-level-num]').value = v;
    else { const r = lv.querySelector('[data-level]'); r.value = v; r.style.setProperty('--p', ((Math.min(Math.max(v, 0.4), 20) - 0.4) / 19.6 * 100) + '%'); }
    if (t.dataset.level) t.style.setProperty('--p', ((v - 0.4) / 19.6 * 100) + '%');
    setLevel(j, v); rebuild(); return;
  }
  if (k && t.hasAttribute('data-text')) { setP(k, t.value); rebuild(); return; }
  if (!k || t.type === 'checkbox' || t.tagName === 'SELECT') return;
  const inImg = imgKeys.has(k) && !!t.closest('details.adv, [data-imgctl]');
  const v = parseFloat(t.value);
  if (!isFinite(v)) return;
  const ctl = t.closest('.ctl');
  if (t.type === 'range') {
    const n = ctl.querySelector('[data-num]'); if (n) n.value = v;
    t.style.setProperty('--p', ((v - t.min) / (t.max - t.min) * 100) + '%');
  } else {
    const r = ctl.querySelector('input[type=range]');
    if (r) { r.value = v; r.style.setProperty('--p', ((Math.min(Math.max(v, r.min), r.max) - r.min) / (r.max - r.min) * 100) + '%'); }
  }
  setValue(k, v, inImg);
  if (inImg && k === 'threshold') updateThumb();
  rebuild();
});
$('#panel').addEventListener('change', e => {
  const t = e.target, k = t.dataset.k;
  if (t.hasAttribute('data-pcc-custom')) { renderColors(); return; }
  if (t.dataset.e) { estInput(t); return; }
  if (t.hasAttribute('data-bold')) { S.bold = t.checked; LS.set('bold', S.bold); textChanged(true); return; }
  if (t.tagName === 'SELECT' && t.dataset.act) { runAct(t.dataset.act, { key: t.dataset.arg, value: t.value }); return; }
  if (!k) return;
  const inImg = imgKeys.has(k) && !!t.closest('details.adv, [data-imgctl]');
  if (t.type === 'checkbox') { setValue(k, t.checked, inImg); if (inImg) updateThumb(); else refreshGroups(); rebuild(); }
  else if (t.tagName === 'SELECT') { setValue(k, t.value, false); refreshGroups(); rebuild(); }
  else if (t.dataset.num) { // 数字框失焦时夹到范围内
    const v = Math.min(Math.max(parseFloat(t.value) || +t.min, +t.min), +t.max);
    t.value = v; setValue(k, v, inImg); rebuild();
    if (tool().kind === 'heightmap' && k === 'emptyT') refreshGroups();
  } else if (t.type === 'range' && tool().kind === 'heightmap' && k === 'emptyT') refreshGroups();
});
// 双击滑块恢复默认值
$('#panel').addEventListener('dblclick', e => {
  const t = e.target;
  if (!t.matches('input[type=range][data-k]')) return;
  const k = t.dataset.k, inImg = imgKeys.has(k) && !!t.closest('details.adv, [data-imgctl]');
  const def = inImg ? IMG_DEFAULT[k] : tool().defaults[k];
  if (def === undefined) return;
  t.value = def; t.dispatchEvent(new Event('input', { bubbles: true }));
  toast('已恢复默认值');
});
$('#panel').addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches('details.adv')) LS.set('advOpen', d.open);
  else if (d.matches('details.more')) { const set = moreOpen(); d.open ? set.add(d.dataset.more) : set.delete(d.dataset.more); LS.set('more.' + S.toolId, [...set]); }
}, true);
$('#panel').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act) { runAct(b.dataset.act, b.dataset.arg); return; }
  if (b.dataset.pc !== undefined) { S.pcOpen = S.pcOpen === b.dataset.pc ? null : b.dataset.pc; renderColors(); return; }
  if (b.dataset.pcc) { setPartColor(S.pcOpen, b.dataset.pcc); renderColors(); return; }
  if (b.id === 'pcReset') { delete S.pc[S.toolId]; LS.set('pc', S.pc); viewer.setColors(partColors()); renderColors(); toast('已恢复默认颜色'); return; }
  if (b.dataset.fit) { setFit({ [b.dataset.fit]: +b.dataset.v }); refreshGroups(); toast(`已保存：${b.dataset.fit === 'slide' ? '滑动配合' : '紧配合'} ${b.dataset.v}mm`); rebuild(); return; }
  if (b.hasAttribute('data-sec-toggle')) {
    const box = b.closest('.ins-sec');
    box.classList.toggle('closed');
    setSecOpen(box.dataset.sec, !box.classList.contains('closed'));
    spyNav();
    return;
  }
  if (b.dataset.jump) {
    const box = document.querySelector(`#panel .ins-sec[data-sec="${CSS.escape(b.dataset.jump)}"]`);
    if (box) { if (box.classList.contains('closed')) { box.classList.remove('closed'); setSecOpen(box.dataset.sec, true); } box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  if (b.dataset.tab) { S.tab = b.dataset.tab; if (S.tab === 'text') { textChanged(true); } renderPanel(); return; }
  if (b.dataset.sample) { await loadSample(b.dataset.sample); rememberSrc({ mode: 'sample', sampleId: b.dataset.sample }); renderPanel(); rebuild(true); return; }
  if (b.id === 'pick') { $('#fileIn').click(); return; }
  if (b.dataset.e) { estInput(b); return; }
  if (b.id === 'estRec') { Object.assign(S.est, estRecommend().set); LS.set('est', S.est); refreshGroups(); toast('已换成推荐的填充和墙数'); return; }
  if (b.id === 'hmBatch') { batch.pick(S.toolId); return; }
  if (b.id === 'hmSample') { S.hmArt = sampleHeightmap(); setP('levelH', []); setP('winBox', null); setP('winMode', 'auto'); renderPanel(); rebuild(true); return; }
  if (b.id === 'hmFlip') {
    const { info } = hmInfo(P());
    if (info?.box) { const { box, art } = info; setP('winBox', { cx: box.cx, cy: box.cy, w: box.h * art.h / art.w, h: box.w * art.w / art.h }); refreshGroups(); rebuild(); }
    return;
  }
  if (b.dataset.font) { S.font = +b.dataset.font; LS.set('font', S.font); textChanged(true); renderPanel(); return; }
  if (b.dataset.k && b.dataset.v !== undefined) { setP(b.dataset.k, b.dataset.v); refreshGroups(); rebuild(); return; }
  if (b.id === 'resetTool') { pushHist('reset'); HIST.last = null; delete S.params[S.toolId]; LS.set('params', S.params); renderPanel(); rebuild(true); toast('已恢复默认参数'); }
});
function refreshGroups() { const y = $('#panel').scrollTop; renderPanel(); $('#panel').scrollTop = y; showTips(lastResult); updateEst(); spyNav(); }

// ---------- 耗材估算 ----------
S.est = { ...EST_DEFAULT, ...LS.get('est', {}) };
const STRONG = new Set(['buckle', 'storage', 'spoolrack', 'joiner']);
function estRecommend() {
  const id = S.toolId;
  if (STRONG.has(id)) return { set: { infill: 20, pattern: 'gyroid', walls: 3 }, text: '要受力的零件：填充 20% 螺旋体、墙 3 层。想更结实，先加墙数，比加填充有效。' };
  if (id === 'tolerance') return { set: { infill: 15, pattern: 'grid', walls: 2 }, text: '公差测试件要和以后打的零件用同一套设置，测出来的间隙才准。' };
  return { set: { infill: 15, pattern: 'grid', walls: 2 }, text: '装饰类薄件：填充 15% 网格、墙 2 层就够，这也是 Bambu Studio 的默认值。' };
}
function estSecHTML() {
  const e = S.est, pct = (e.infill / 100 * 100).toFixed(1);
  return sec('est', '耗材估算', `
    <div class="est-total"><b id="estG">—</b><span id="estSub">生成后自动计算</span></div>
    <div class="est-rows" id="estRows"></div>
    <div class="ctl"><div class="ctl-top"><span class="lbl">材料</span></div>
      <div class="seg">${MATERIALS.map(([m]) => `<button data-e="mat" data-v="${m}" class="${e.mat === m ? 'on' : ''}">${m}</button>`).join('')}</div></div>
    <div class="ctl"><div class="ctl-top"><span class="lbl">填充图案</span></div>
      <div class="select"><select data-e="pattern">${PATTERNS.map(([v, lab]) => `<option value="${v}" ${e.pattern === v ? 'selected' : ''}>${lab}</option>`).join('')}</select></div></div>
    <div class="ctl"><div class="ctl-top"><label for="r-est-infill">填充率</label>
      <span class="num"><input type="number" data-e="infill" data-num value="${e.infill}" min="0" max="100" step="5" inputmode="decimal">%</span></div>
      <input id="r-est-infill" class="slider" type="range" data-e="infill" min="0" max="100" step="5" value="${e.infill}" style="--p:${pct}%"></div>
    <div class="ctl"><div class="ctl-top"><span class="lbl">墙层数<small>外壁一圈一圈的数量</small></span></div>
      <div class="seg">${[1, 2, 3, 4].map(n => `<button data-e="walls" data-v="${n}" class="${+e.walls === n ? 'on' : ''}">${n} 层</button>`).join('')}</div></div>
    <div class="est-tip" id="estTip"></div>`, '<span class="sec-sum" id="estSum"></span>');
}
function estInput(t) {
  const k = t.dataset.e;
  let v = t.tagName === 'BUTTON' ? t.dataset.v : t.value;
  if (k === 'infill') {
    v = Math.min(100, Math.max(0, parseFloat(v)));
    if (!isFinite(v)) return;
    const ctl = t.closest('.ctl'), r = ctl.querySelector('input[type=range]'), n = ctl.querySelector('[data-num]');
    if (t !== r) r.value = v; if (t !== n) n.value = v;
    r.style.setProperty('--p', v + '%');
  }
  if (k === 'walls') v = +v;
  S.est[k] = v; LS.set('est', S.est);
  if (t.tagName === 'BUTTON') t.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === t));
  updateEst();
}
let estTimer;
function scheduleEst() { clearTimeout(estTimer); const g = $('#estG'); if (g && S.parts.length) $('#estSub').textContent = '计算中…'; estTimer = setTimeout(updateEst, 40); }
function updateEst() {
  const g = $('#estG');
  if (!g) return;
  if (!S.parts.length || !lastResult) { g.textContent = '—'; $('#estRows').innerHTML = ''; $('#estTip').innerHTML = ''; $('#estSum').textContent = ''; return; }
  let r;
  try { r = estimate(S.parts, S.est); } catch (err) { console.error(err); $('#estSub').textContent = '这个模型算不了'; return; }
  const gs = v => v >= 100 ? Math.round(v) : (Math.round(v * 10) / 10).toFixed(1);
  const m = r.g / r.rho * 1000 / (Math.PI * 0.875 * 0.875) / 1000; // 1.75mm 耗材长度（米）
  g.textContent = `${gs(r.g)} g`;
  $('#estSum').textContent = `${gs(r.g)} g · ${S.est.mat}`;
  $('#estSub').textContent = `约 ${m < 10 ? m.toFixed(1) : Math.round(m)} 米 ${S.est.mat} · 一卷 1kg 能打约 ${Math.max(1, Math.floor(1000 / r.g))} 个`;
  $('#estRows').innerHTML = r.rows.length > 1 ? r.rows.map(x => `<div><span>${esc(x.label)}</span><b>${gs(x.g)} g</b></div>`).join('') : '';
  const rec = estRecommend(), same = Object.entries(rec.set).every(([k, v]) => String(S.est[k]) === String(v));
  const solidNote = r.shellFrac > 0.85
    ? `这个模型 ${Math.round(r.shellFrac * 100)}% 都是外壁和顶底层（实心），填充改多少重量都差不多：每加 10% 只多约 ${gs(r.per10)} g。`
    : `填充每加 10%，大约多 ${gs(r.per10)} g。`;
  $('#estTip').innerHTML = `<p>${solidNote}</p><p><b>推荐</b>${rec.text}${same ? '' : ' <button class="chip" id="estRec">用推荐设置</button>'}</p>
    <p><b>层高</b>0.2mm 标准就行；浮雕、小字多的可以用 0.12–0.16mm，更细腻，用料基本一样，只是打得更慢。</p>
    <p class="dim">按 P1S「0.20mm 标准」的方式估算，和 Bambu Studio 切片结果对比过，一般差 10% 以内（闪电填充误差大一些）。多色换料的冲刷废料、支撑、裙边没算进去，以切片软件为准。</p>`;
}
function updateThumb() { const img = document.querySelector('.current .thumb img'); const u = artThumb(); if (img && u) img.src = u; }

let textTimer;
function textChanged(now) {
  clearTimeout(textTimer);
  textTimer = setTimeout(() => {
    try {
      S.art = artFromText(S.text, FONTS[S.font][0], S.bold);
      S.source = 'text'; rememberSrc({ mode: 'text' });
      const meta = document.querySelector('.current .meta b'), lab = document.querySelector('[data-src-label]');
      if (meta) { meta.textContent = S.art.label; if (lab) lab.textContent = '文字 · 深色部分变成实体'; updateThumb(); } else refreshGroups();
      rebuild(true);
    } catch (err) { showError(err.message); }
  }, now ? 0 : 350);
}

// ---------- 上传 / 拖放 ----------
async function useFile(file) {
  if (!file) return;
  try {
    const art = await artFromFile(file);
    if (tool().kind === 'heightmap') {
      S.hmArt = art; setP('levelH', []); setP('winBox', null);
      // 彩色图默认按颜色分层，灰度图按深浅
      const colorful = isColorful(art), was = P().split;
      setP('split', colorful ? 'color' : 'lum');
      if (colorful && was !== 'color' && P().hmode === 'levels') setTimeout(() => toast('彩色图：已改成按颜色分层，可以在“高度”里换回按深浅'), 2800);
      // 自动找不到窗口时，直接切到手动框选
      const { info } = hmInfo({ ...P(), winMode: 'auto' });
      if (info && !info.win) { setP('winMode', 'manual'); setTimeout(() => toast('没自动找到相片窗口，已切换到手动框选：在图上拖动这个框'), 400); }
      else setP('winMode', 'auto');
    }
    else { S.art = art; S.source = 'file'; S.tab = 'upload'; }
    renderPanel(); rebuild(true);
    toast('已载入：' + file.name);
  } catch (err) { showError(err.message || '文件读取失败'); }
}
$('#fileIn').addEventListener('change', e => { useFile(e.target.files[0]); e.target.value = ''; });
$('#meshIn').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; if (f.length) runAct('files', f); });
async function runAct(act, arg) {
  if (act === 'pick') { $('#meshIn').click(); return; }
  $('#busy').classList.add('on');
  try {
    const r = await tool().action(act, arg) || {};
    if (r.alert) showModal(r.alert.title, r.alert.html);
    if (r.toast) toast(r.toast);
  } catch (e) { showModal('出错了', `<p>${esc(e.message || e)}</p>`); }
  refreshGroups(); rebuild(act !== 'method' && act !== 'swap');
}
function showModal(title, html) {
  const d = $('#modal');
  d.innerHTML = `<div class="modal-in"><div class="modal-ico">!</div><h3>${esc(title)}</h3><div class="modal-body">${html}</div><div class="modal-btns"><button class="btn-primary" data-close>知道了</button></div></div>`;
  d.showModal();
  d.querySelector('[data-close]').onclick = () => d.close();
}
let dragDepth = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#dropVeil').classList.add('on'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropVeil').classList.remove('on'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#dropVeil').classList.remove('on');
  const files = [...(e.dataTransfer?.files || [])];
  // 相框工作室里拖进来一个文件夹：直接用文件夹模式（Chrome / Edge）
  const it0 = e.dataTransfer?.items?.[0];
  if (!$('#studio').hidden && batchable(tool()) && files.length === 1 && !files[0].type && it0?.getAsFileSystemHandle) {
    it0.getAsFileSystemHandle().then(h => h?.kind === 'directory' ? batch.useDir(h, S.toolId) : useFile(files[0]), () => useFile(files[0]));
    return;
  }
  if (!$('#studio').hidden && tool().kind === 'mesh') runAct('files', files);
  else if ($('#batch').open) batch.open(files);
  else if (!$('#studio').hidden && batchable(tool()) && files.length > 1) batch.open(files, S.toolId);
  else useFile(files[0]);
});

// ---------- 生成 ----------
let buildTimer, lastResult = null, pendingFit = false;
function rebuild(fit) {
  if (fit) pendingFit = true;
  hideTipCard();
  clearTimeout(buildTimer);
  $('#busy').classList.add('on');
  buildTimer = setTimeout(doBuild, 160); // 不依赖 requestAnimationFrame，页面在后台也能生成
}
function doBuild() {
  const t = tool();
  try {
    const art = t.kind === 'heightmap' ? S.hmArt : (t.kind === 'param' || t.kind === 'mesh') ? null : S.art;
    if (!art && !t.kind?.match(/param|mesh/)) throw new Error('先选一个图案');
    const res = t.build(art, S.img, P());
    let box;
    if (res.keepLayout) { box = new THREE.Box3(); res.parts.forEach(pt => { pt.geo.computeBoundingBox(); box.union(pt.geo.boundingBox); }); }
    else box = layoutParts(res.parts);
    S.parts.forEach(pt => pt.geo.dispose());
    S.parts = res.parts;
    viewer.setParts(res.parts, pendingFit, partColors(res.parts));
    if (introNext) { introNext = false; viewer.intro(); }
    pendingFit = false;
    // 多个零件时显示主零件尺寸；打印范围按最大的零件判断
    const sizes = res.parts.map(pt => pt.geo.boundingBox.getSize(new THREE.Vector3()));
    const s = res.parts.length > 1 && !res.parts.some(pt => pt.keepPlace) && !res.keepLayout ? sizes[0] : box.getSize(new THREE.Vector3());
    const dims = `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} mm`;
    s.maxPart = Math.max(...sizes.map(z => Math.max(z.x, z.y)));
    $('#exDims').textContent = dims;
    $('#vpDims').textContent = dims;
    const tris = res.parts.reduce((a, pt) => a + pt.geo.attributes.position.count / 3, 0);
    $('#exSub').textContent = `${res.parts.length > 1 ? `${res.parts[0].label} · 共 ${res.parts.length} 个零件 · ` : ''}${Math.round(tris).toLocaleString()} 个三角面`;
    $('#download').disabled = false; $('#fab').disabled = false;
    lastResult = { ...res, size: s };
    refreshLive(); renderColors();
    if (t.kind === 'param') { // 参数相关的说明随滑块实时更新
      const p = P();
      t.groups.flatMap(g => g.params).filter(c => c.type === 'info').forEach(c => { const el = document.querySelector(`[data-info="${c.k}"]`); if (el) el.innerHTML = c.render(p); });
      const fp = document.querySelector('[data-fitpick]'); if (fp) fp.innerHTML = fitPickHTML(p);
    }
    showTips(lastResult);
    scheduleEst();
    hideError();
  } catch (err) {
    console.error(err);
    showError(err.message || String(err));
    $('#vpDims').textContent = ''; $('#exSub').textContent = ''; $('#stWarn').hidden = true;
    $('#download').disabled = true; $('#fab').disabled = true;
  } finally {
    $('#busy').classList.remove('on');
  }
}
function refreshLive() {
  const t = tool();
  document.querySelectorAll('[data-live]').forEach(el => { const c = t.groups.flatMap(g => g.params).find(x => x.k === el.dataset.live); if (c) el.innerHTML = c.render(P()); });
}
function showTips(res) {
  const ul = $('#tips');
  if (!ul || !res) return;
  const items = [];
  (res.warnings || []).forEach(w => items.push(`<li class="warn">${esc(w)}</li>`));
  if (res.colorChange) items.push(`<li class="color">双色：在 Bambu Studio 预览里把右侧图层滑块拖到 ${fmt(res.colorChange)}mm，右键选「更换耗材」（有 AMS 自动换）或「添加暂停」（手动换）。</li>`);
  (res.notes || []).forEach(n => items.push(`<li>${esc(n)}</li>`));
  const big = res.size.maxPart || Math.max(res.size.x, res.size.y);
  if (big > PRINTER.bed) items.unshift(`<li class="warn">最长边 ${fmt(big)}mm，超过了 ${PRINTER.name} 的 ${PRINTER.bed}mm 打印范围。</li>`);
  ul.innerHTML = items.join('');
  const nWarn = items.filter(x => x.includes('class="warn"')).length;
  const w = $('#stWarn'); w.hidden = !nWarn; w.textContent = `${nWarn} 条提醒`;
  const sum = $('#tipsSum');
  if (sum) { sum.textContent = nWarn ? `${nWarn} 条提醒 · 共 ${items.length} 条` : items.length ? `${items.length} 条` : ''; sum.classList.toggle('warn', !!nWarn); }
}
$('#stWarn').addEventListener('click', () => {
  const card = $('#tipCard'), warns = [...document.querySelectorAll('#tips li.warn')].map(li => li.outerHTML).join('');
  if (!warns) return;
  if (!card.hidden && card.dataset.kind === 'warn') { hideTipCard(); return; }
  card.dataset.kind = 'warn';
  card.innerHTML = `<div class="tc-h"><b>需要留意</b><button class="tc-x" data-tc="close" aria-label="关闭">×</button></div><ul class="tips">${warns}</ul>`;
  card.hidden = false;
});
function showError(msg) { const el = $('#vpError'); el.innerHTML = `<b>没法生成</b>${esc(msg)}`; el.hidden = false; }
function hideError() { $('#vpError').hidden = true; }

$('#fab').addEventListener('click', () => $('#download').click());
// ---------- 下载（3MF / STL） ----------
S.fmt = LS.get('fmt', '3mf');
const FMT_TIP = {
  '3mf': '3MF：零件分开，Bambu Studio 可直接分色',
  stl: 'STL：所有零件在一个文件里，哪个切片软件都能开',
  glb: 'GLB：拿到 Blender / Nomad 里再改，封闭网格、精度加倍',
};
function renderFmt() {
  if (!FMT_TIP[S.fmt]) S.fmt = '3mf';
  document.querySelectorAll('#fmtSeg button').forEach(b => b.classList.toggle('on', b.dataset.fmt === S.fmt));
  $('#fmtSeg').dataset.tip = FMT_TIP[S.fmt];
  $('#fabFmt').textContent = S.fmt.toUpperCase();
}
renderFmt();
$('#fmtSeg').addEventListener('click', e => { const b = e.target.closest('[data-fmt]'); if (!b) return; S.fmt = b.dataset.fmt; LS.set('fmt', S.fmt); renderFmt(); });
/** 生成结果 → 文件数据（3MF / STL）。下载和批量生成共用 */
function exportPack(res, fmt = S.fmt, toolId = S.toolId) {
  if (!res.keepLayout) layoutParts(res.parts);
  let parts = res.parts, colors = partColors(res.parts, toolId);
  if (res.exportParts) { const base = colors; parts = res.exportParts(); layoutParts(parts); colors = parts.map((_, i) => res.parts[i]?.color ? base[i] : base[0]); }
  const data = fmt === '3mf' ? export3MF(parts, colors) : exportSTL(parts);
  if (parts !== res.parts) parts.forEach(pt => pt.geo.dispose());
  return { data, ext: fmt };
}
// 批量：一次给一个工具用；自动生成时你切到别的工具，用的还是那个工具和它的参数
const getTool = id => TOOLS.find(t => t.id === id);
const batch = makeBatch({
  S, toast, exportPack, getTool, getP: id => ({ ...getTool(id).defaults, ...(S.params[id] || {}) }),
  thumbOf: art => inkThumb(art, 150),
  onState: () => { if (!$('#studio').hidden && batchable(tool()) && !$('#batch').open) renderPanel(); },
});
$('#batch').addEventListener('close', () => { if (!$('#studio').hidden && tool().kind === 'heightmap') refreshGroups(); else if (!$('#studio').hidden && batchable(tool())) renderPanel(); });
const saveBlob = (data, type, file) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = file;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};
/** 编辑用（GLB）：网格加密重新生成一遍，每个零件合成封闭实体 → { data, bad: [没合成的零件名], tris } */
async function editablePack() {
  const t = tool();
  await manifoldReady();
  let parts, res = null;
  if (t.kind === 'mesh') parts = lastResult?.exportParts ? lastResult.exportParts() : S.parts.map(p => ({ ...p, geo: p.geo.clone() }));
  else {
    const art = t.kind === 'heightmap' ? S.hmArt : t.kind === 'param' ? null : S.art;
    SOLID.on = true; SOLID.fine = 2;
    try { res = t.build(art, S.img, P()); } finally { SOLID.on = false; SOLID.fine = 1; }
    parts = res.exportParts ? res.exportParts() : res.parts;
  }
  if (!res?.keepLayout) layoutParts(parts);
  const base = partColors(res ? res.parts : S.parts);
  const colors = parts.map((p, i) => (res?.exportParts || lastResult?.exportParts) ? ((res || lastResult).parts[i]?.color ? base[i] : base[0]) : base[i]);
  const bad = [];
  let tris = 0;
  const meshes = parts.map((p, i) => {
    const m = solidMesh(p.geo);
    if (!m.ok) bad.push(p.label || `零件 ${i + 1}`);
    tris += m.idx.length / 3;
    return { pos: m.pos, idx: m.idx, label: p.label || `零件 ${i + 1}`, color: colors[i] };
  });
  parts.forEach(p => p.geo.dispose());
  if (res && parts !== res.parts) res.parts.forEach(p => p.geo.dispose());
  return { data: exportGLB(meshes), bad, tris };
}
$('#download').addEventListener('click', async () => {
  if (!S.parts.length) return;
  const d = new Date();
  const name = `${tool().name}-${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  if (S.fmt === 'glb') {
    const btns = [$('#download'), $('#fab')];
    btns.forEach(b => { b.disabled = true; }); $('#busy').classList.add('on');
    await new Promise(r => setTimeout(r, 40)); // 先让“生成中”显示出来
    try {
      const { data, bad, tris } = await editablePack();
      saveBlob(data, 'model/gltf-binary', `${name}.glb`);
      toast(bad.length ? `GLB 已下载，但「${bad.join('、')}」没能合成封闭实体，是按原样导出的` : `GLB 已下载（${Math.round(tris).toLocaleString()} 个三角面）：拖进 Blender 或 Nomad 就能改，1 单位 = 1mm`);
    } catch (err) {
      console.error(err);
      toast('没能生成 GLB：' + (err.message || err));
    } finally {
      btns.forEach(b => { b.disabled = false; }); $('#busy').classList.remove('on');
    }
    return;
  }
  const is3mf = S.fmt === '3mf';
  const { data } = exportPack({ parts: S.parts, keepLayout: true, exportParts: lastResult?.exportParts }, S.fmt);
  const blob = new Blob([data], { type: is3mf ? 'model/3mf' : 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.${is3mf ? '3mf' : 'stl'}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(is3mf ? '3MF 已下载，拖进 Bambu Studio 就能打印' : 'STL 已下载，拖进切片软件就能打印');
  showTipCard();
});
// 下载后把「打印提示」直接显示在画布上（面板里那一组默认是收起的）
function showTipCard() {
  const card = $('#tipCard'), tips = $('#tips')?.innerHTML;
  if (!tips || LS.get('tipCardOff', false)) return;
  card.dataset.kind = 'tips';
  card.innerHTML = `<div class="tc-h"><b>打印前看一眼</b><button class="tc-x" data-tc="close" aria-label="关闭">×</button></div><ul class="tips">${tips}</ul><button class="link-btn" data-tc="off">以后不再弹出</button>`;
  card.hidden = false;
}
const hideTipCard = () => { $('#tipCard').hidden = true; };
$('#tipCard').addEventListener('click', e => {
  const b = e.target.closest('[data-tc]'); if (!b) return;
  if (b.dataset.tc === 'off') { LS.set('tipCardOff', true); toast('好的。提示还在右边面板最下面的「打印提示」里'); }
  hideTipCard();
});

// ---------- 快捷键 ----------
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
$('#kbdSave').textContent = isMac ? '⌘S' : 'Ctrl+S';
addEventListener('keydown', e => {
  if ($('#studio').hidden) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.target.closest?.('textarea, input[type=text]')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !e.target.closest?.('textarea, input[type=text]')) { e.preventDefault(); redo(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!$('#download').disabled) $('#download').click(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'f') $('#viewReset').click();
  else if (k === 't') $('#viewTop').click();
  else if (k === 'r') $('#viewFlip').click();
});

// ---------- 启动 ----------
route();
