/*
 * 批量生成：所有“上传图片”的工具都能用（印章、线稿加厚、钥匙扣、饼干模、仿欧根纱、纽扣、相框工作室）。
 * 多张图用同一套参数，各做一个模型，打包成一个 zip。
 * 相框工作室多一步：每张图单独识别相片窗口，找不到的可以手动框。
 * 为了省内存，每张图只在分析 / 生成的时候读进来，用完就丢，只留缩略图。
 *
 * 文件夹模式（Chrome / Edge）：选一个电脑上的文件夹，里面的照片自动出现在列表里，
 * 生成的 3MF 直接存到这个文件夹下的「输出/工具名」里，并追加写「生成记录.txt」。
 * 打开“自动生成”后，网页开着时每隔几秒看一次文件夹，没生成过的照片自动生成；
 * 已经生成过的不会自己重新生成（除非照片换了新的），要用新参数重做就点“全部重新生成”。
 */
import { artFromFile } from './engine.js?v=33';
import { previewHM } from './heightmap.js?v=33';
import { estimate } from './estimate.js?v=33';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = () => new Promise(r => setTimeout(r, 0));
const pct = v => (v * 100).toFixed(3) + '%';
const FOLDER_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const HANDLES = ['nw', 'ne', 'sw', 'se'].map(h => `<i data-h="${h}"></i>`).join('');
const fmtG = v => v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1);
const IMG_RE = /\.(png|jpe?g|webp)$/i, SVG_RE = /\.svg$/i;
const HAS_FS = typeof window.showDirectoryPicker === 'function';
const OUT = '输出', LOG = '生成记录.txt', POLL = 4000;
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// 记住上次的文件夹（浏览器只允许把“文件夹句柄”存在 IndexedDB 里，下次还要再点一次允许）
const idb = (() => {
  let db;
  const open = () => db ||= new Promise((res, rej) => {
    const r = indexedDB.open('printkit', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  };
  return { get: k => tx('readonly', st => st.get(k)).catch(() => null), set: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => {}) };
})();

/**
 * deps: S（状态）、getTool(id)、getP(id)（这个工具的参数）、toast(msg)、exportPack(res, fmt) → {data, ext}、
 *       thumbOf(art) → {url, ink}（普通图片工具的缩略图：按阈值变成黑白，ink = 有没有深色部分）、onState()
 * 批量一次只给一个工具用（B.toolId）；自动生成时你切到别的工具也没关系，用的还是这个工具和它的参数。
 */
export function makeBatch({ S, getTool, getP, toast, exportPack, thumbOf, onState = () => {} }) {
  const dlg = document.getElementById('batch');
  const B = { toolId: 'framestudio', items: [], sig: '', edit: null, running: false, done: 0, total: 0, dir: null, outRoot: null, outDir: null, watch: false, saved: null, timer: 0, ignored: new Set(), loggedP: '' };
  const tool = () => getTool(B.toolId), P = () => getP(B.toolId);
  const isHM = () => tool().kind === 'heightmap';
  const okName = n => IMG_RE.test(n) || (!isHM() && SVG_RE.test(n));
  const what = () => isHM() ? '照片' : '图片';
  let uid = 0, chain = Promise.resolve();
  idb.get('dir').then(h => { if (h && !B.dir) { B.saved = h; render(); } });
  const fileOf = it => it.file || it.fh.getFile();

  const totalG = () => B.items.reduce((a, i) => a + (i.out?.g || 0), 0);
  const itemP = it => isHM() ? { ...P(), winMode: it.mode, winBox: it.box } : P();
  const sigOf = () => { const p = { ...P() }; delete p.winMode; delete p.winBox; return JSON.stringify([B.toolId, p, S.img, S.fmt]); };
  const boxOf = b => ({ cx: b.cx, cy: b.cy, w: b.w, h: b.h });
  const oval = () => P().winShape === 'oval' ? 'oval' : '';

  async function analyze(it, keepArt) {
    it.state = 'loading'; render();
    await tick();
    try {
      const art = it.art || await artFromFile(await fileOf(it));
      if (!isHM()) { // 普通图片工具：只要读得出来、有深色部分就行
        const th = thumbOf(art);
        it.thumb = th.url; it.found = true;
        it.state = th.ink ? 'ready' : 'error';
        if (!th.ink) it.err = '图里没有深色线条（白线黑底的图在“图像调整”里打开反相）';
        it.art = null; it.info = null;
        render(); return;
      }
      const info = tool().info(art, itemP(it));
      it.found = !!info.autoWin;
      it.levels = info.levels.length;
      it.bg = info.bg?.removed ? info.bg.bgName : '';
      if (it.mode === 'manual') it.box = boxOf(info.box);
      it.thumb = previewHM(info.viewArt || info.art, it.mode === 'manual' ? { ...info, win: null } : info, info.viewArt ? false : P().invert);
      it.state = it.mode === 'manual' || it.found ? 'ready' : 'need';
      it.art = keepArt ? art : null;
      it.info = keepArt ? info : null;
    } catch (e) { it.state = 'error'; it.err = e.message || '读不出这张图'; it.art = null; it.info = null; }
    render();
  }
  const queue = it => (chain = chain.then(() => analyze(it)).then(maybeAuto));

  function add(files) {
    if (B.dir) { toast(`现在用的是文件夹「${B.dir.name}」：把${what()}放进这个文件夹就会自动出现`); return; }
    const imgs = [...files].filter(f => okName(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type) || (!isHM() && f.type === 'image/svg+xml'));
    if (imgs.length < files.length) toast(isHM() ? '只能用 PNG / JPG / WebP 图片，其他文件跳过了' : '只能用 SVG / PNG / JPG / WebP 图片，其他文件跳过了');
    for (const f of imgs) { const it = { id: ++uid, file: f, name: f.name, mode: 'auto', box: null, state: 'loading', out: null }; B.items.push(it); queue(it); }
    render();
  }

  /** 换成给另一个工具批量：同样的图片重新按新工具分析；文件夹模式下自动生成先暂停 */
  function switchTool(id) {
    if (id === B.toolId || B.running) return;
    const wasWatch = B.watch;
    B.toolId = id; B.edit = null; B.watch = false; B.loggedP = '';
    if (B.dir) { reconnectOut().then(() => { B.items = []; scan(); }); if (wasWatch) toast(`文件夹改成给「${tool().name}」用了，自动生成先暂停`); onState(); }
    else B.items = B.items.filter(it => okName(it.name));
    B.items.forEach(it => { it.mode = 'auto'; it.box = null; it.written = null; });
  }
  async function reconnectOut() {
    B.outRoot = await B.dir.getDirectoryHandle(OUT, { create: true });
    B.outDir = await B.outRoot.getDirectoryHandle(tool().name, { create: true });
  }

  function open(files, toolId) {
    if (toolId) switchTool(toolId);
    // 参数变了：缩略图和生成结果都要重新算
    const sig = sigOf();
    if (sig !== B.sig) {
      B.sig = sig;
      B.items.forEach(it => { it.out = null; queue(it); });
    }
    const es = JSON.stringify(S.est);
    if (es !== B.estSig) { B.estSig = es; B.items.forEach(it => { it.out = null; }); }
    B.edit = null;
    if (!dlg.open) dlg.showModal();
    if (files?.length) add(files);
    render();
  }

  // ---------- 界面 ----------
  function cardHTML(it) {
    const st = {
      loading: '<span class="bt-st">分析中…</span>',
      ready: `<span class="bt-st ok">✓ ${!isHM() ? '可以生成' : it.mode === 'manual' ? '手动框的窗口' : '找到窗口'}</span>`,
      need: '<span class="bt-st bad">没找到窗口，点“框窗口”</span>',
      error: `<span class="bt-st bad">${esc(it.err)}</span>`,
    }[it.state];
    const w = it.written, old = w && (w.sig === null ? '（之前生成的）' : w.sig !== sigOf() ? '（用的之前的参数）' : '');
    const out = !it.out ? (w ? `<span class="bt-out ok" title="${OUT}/${esc(tool().name)}/${esc(w.name)}">✓ 已生成${old}${w.g != null && !old ? ` · ${fmtG(w.g)} g` : ''}</span>` : '') : it.out.err
      ? `<span class="bt-out bad" title="${esc(it.out.err)}">没生成：${esc(it.out.err)}</span>`
      : `<span class="bt-out ok" title="${esc(it.out.warns.join('\n'))}">✓ 已生成${it.out.g != null ? ` · ${fmtG(it.out.g)} g` : ''}${it.out.warns.length ? ` · ${it.out.warns.length} 条提醒` : ''}</span>`;
    const box = it.thumb && it.mode === 'manual' && it.box
      ? `<div class="win-box static ${oval()}" style="left:${pct(it.box.cx - it.box.w / 2)};top:${pct(it.box.cy - it.box.h / 2)};width:${pct(it.box.w)};height:${pct(it.box.h)}"></div>` : '';
    const canEdit = !B.running && (it.state === 'ready' || it.state === 'need');
    return `<div class="bt-card ${it.state}">
      <div class="bt-thumb">${it.thumb ? `<div class="hm-stage"><img src="${it.thumb}" alt="" draggable="false">${box}</div>` : '<i class="bt-spin"></i>'}</div>
      <b title="${esc(it.name)}">${esc(it.name)}</b>${st}${out}
      <div class="bt-acts">
        ${isHM() ? `<button class="chip ${it.state === 'need' ? 'on' : ''}" data-b="edit" data-id="${it.id}" ${canEdit ? '' : 'disabled'}>${it.state === 'need' ? '框窗口' : '调整窗口'}</button>` : '<span></span>'}
        <button class="link-btn" data-b="del" data-id="${it.id}" ${B.running ? 'disabled' : ''}>移除</button>
      </div></div>`;
  }

  function render() {
    if (!dlg.open) return;
    if (B.edit) return renderEdit();
    const its = B.items, ready = its.filter(i => i.state === 'ready').length, need = its.filter(i => i.state === 'need').length;
    const loading = its.filter(i => i.state === 'loading').length;
    const ext = S.fmt.toUpperCase();
    const fresh = its.filter(i => i.state === 'ready' && !i.written).length;
    const t = tool();
    const sum = B.running ? `正在生成 ${B.done + 1} / ${B.total}…`
      : !its.length ? `还没有${what()}`
      : B.dir ? [loading && `${loading} 张分析中`, `${its.length - fresh - need} 张已生成`, fresh && `${fresh} 张还没生成`, need && `${need} 张没框窗口`].filter(Boolean).join(' · ')
      : [loading && `${loading} 张分析中`, `${ready} 张可以生成`, need && `${need} 张没框窗口，会跳过`, totalG() && `上次生成共约 ${fmtG(totalG())} g ${S.est.mat}`].filter(Boolean).join(' · ');
    const grid = dlg.querySelector('.bt-grid'), y = grid ? grid.scrollTop : 0;
    dlg.innerHTML = `<div class="bt-in">
      <div class="bt-head"><div><h3>批量生成 · ${esc(t.name)}</h3>
        <p>${isHM() ? '每张图用现在的参数各做一个相框：照片尺寸、高度、夹层、挂孔、磁铁都一样。每张图的相片窗口单独识别，找不到的可以手动框。'
          : `每张图用「${esc(t.name)}」现在的参数（包括“图像调整”里的阈值、加粗、反相）各做一个，尺寸、厚度这些都一样。`}</p></div>
        <button class="bt-x" data-b="close" aria-label="关闭" ${B.running ? 'disabled' : ''}>×</button></div>
      ${dirBarHTML()}
      <div class="bt-grid">${its.map(cardHTML).join('')}
        ${B.dir ? `<div class="bt-add bt-hint">${FOLDER_IC}<span>把${what()}放进文件夹<br>「${esc(B.dir.name)}」</span><small>几秒内会出现在这里</small></div>` : `<button class="bt-add" data-b="add" ${B.running ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          添加图片<small>可以一次选多张，也可以拖进来</small></button>`}</div>
      <div class="bt-foot">
        ${B.running ? `<div class="bt-bar"><i style="width:${(B.done / B.total * 100).toFixed(1)}%"></i></div>` : ''}
        <span class="bt-sum">${sum}</span>
        ${B.dir ? `${ready && !B.running ? '<button class="link-btn" data-b="regen">用现在的参数全部重新生成</button>' : ''}
        <button class="btn-primary" data-b="runDir" ${!fresh || B.running ? 'disabled' : ''}>${fresh ? `生成 ${fresh} 个到「${OUT}/${esc(t.name)}」` : '都生成好了'}</button>`
        : `${its.length && !B.running ? '<button class="link-btn" data-b="clear">全部清空</button>' : ''}
        <button class="btn-primary" data-b="run" ${!ready || loading || B.running ? 'disabled' : ''}>生成 ${ready} 个 ${ext}，下载 zip</button>`}
      </div></div>`;
    const g2 = dlg.querySelector('.bt-grid'); if (g2) g2.scrollTop = y;
  }

  function dirBarHTML() {
    if (B.dir) return `<div class="bt-dir">${FOLDER_IC}<div><b>${esc(B.dir.name)}</b><small>生成的文件存到「${esc(B.dir.name)}/${OUT}/${esc(tool().name)}」，记录在「${OUT}/${LOG}」</small></div>
      <span class="bt-live ${B.watch ? 'on' : ''}">${B.watch ? '自动生成中' : '自动生成已暂停'}</span>
      <button class="chip ${B.watch ? '' : 'on'}" data-b="watch">${B.watch ? '暂停' : '开始自动生成'}</button>
      <button class="link-btn" data-b="disc" ${B.running ? 'disabled' : ''}>断开</button></div>
      ${B.watch ? `<p class="bt-note">网页开着时（可以放在后台）每隔几秒看一次文件夹：没生成过的${what()}自动用「${esc(tool().name)}」现在的参数生成；改了参数只影响之后新放进去的${what()}。关掉网页就停了。</p>` : ''}`;
    if (!HAS_FS) return '<p class="bt-note">想直接读电脑上的文件夹、自动生成？用 Chrome 或 Edge 打开这个网页就有“选择文件夹”。</p>';
    return `<div class="bt-dir off">${FOLDER_IC}<div><b>用电脑上的文件夹</b><small>${what()}放进文件夹就自动生成，3MF 直接存回文件夹里，不用下载 zip</small></div>
      ${B.saved ? `<button class="chip" data-b="reconnect" ${B.running ? 'disabled' : ''}>继续用「${esc(B.saved.name)}」</button>` : ''}
      <button class="chip ${B.saved ? '' : 'on'}" data-b="dir" ${B.running ? 'disabled' : ''}>选择文件夹</button></div>`;
  }

  // ---------- 文件夹 ----------
  async function connect(h) {
    try {
      const ok = !h.queryPermission || (await h.queryPermission({ mode: 'readwrite' })) === 'granted' || (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
      if (!ok) { toast('没有拿到这个文件夹的读写权限'); return; }
      B.dir = h;
      await reconnectOut();
    } catch (e) { B.dir = null; toast('打不开这个文件夹：' + (e.message || e)); return; }
    B.saved = h; B.items = []; B.ignored = new Set(); B.watch = false; B.loggedP = '';
    idb.set('dir', h);
    clearInterval(B.timer); B.timer = setInterval(scan, POLL);
    await scan();
    const n = B.items.length;
    toast(n ? `读到 ${n} 张${what()}` : `文件夹里还没有${what()}，放进去几秒后会出现`);
    onState();
  }
  function disconnect() {
    clearInterval(B.timer); B.timer = 0;
    B.dir = null; B.outDir = null; B.outRoot = null; B.watch = false; B.items = []; B.edit = null;
    render(); onState();
  }
  const baseOf = n => n.replace(/\.[^.]+$/, '') || tool().name;
  /** 输出文件名：同名不同格式（a.png 和 a.jpg）时带上原来的扩展名 */
  function outName(it, ext) {
    const b = baseOf(it.name), clash = B.items.some(i => i !== it && baseOf(i.name) === b);
    return `${clash ? it.name.replace(/\./g, '_') : b}.${ext}`;
  }
  /** 输出文件夹里已经有比照片新的结果 → 算生成过 */
  async function existing(it, mtime) {
    for (const ext of [S.fmt, S.fmt === '3mf' ? 'stl' : '3mf']) {
      try {
        const nm = outName(it, ext), f = await (await B.outDir.getFileHandle(nm)).getFile();
        if (f.lastModified >= mtime) return { name: nm, sig: null, g: null };
      } catch { }
    }
    return null;
  }
  async function scan() {
    if (!B.dir || B.scanning || B.running) return;
    B.scanning = true;
    let changed = false;
    try {
      const seen = new Set();
      for await (const [name, h] of B.dir.entries()) {
        if (h.kind !== 'file' || name.startsWith('.') || !okName(name)) continue;
        seen.add(name);
        if (B.ignored.has(name)) continue;
        const f = await h.getFile();
        let it = B.items.find(i => i.name === name);
        if (it) {
          // 照片换了（同名新文件）：当成新照片重新分析、重新生成
          if (f.lastModified !== it.mtime && it.state !== 'loading' && it !== B.edit) {
            Object.assign(it, { fh: h, mtime: f.lastModified, mode: 'auto', box: null, out: null, written: null, told: false });
            queue(it); changed = true;
          }
          continue;
        }
        it = { id: ++uid, fh: h, name, mtime: f.lastModified, mode: 'auto', box: null, state: 'loading', out: null };
        B.items.push(it);
        B.items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
        it.written = await existing(it, f.lastModified);
        queue(it); changed = true;
      }
      const n0 = B.items.length;
      B.items = B.items.filter(i => seen.has(i.name) || i === B.edit);
      if (B.items.length !== n0) changed = true;
    } catch (e) {
      clearInterval(B.timer); B.timer = 0; B.watch = false;
      toast('读不了文件夹了（可能被移动或删除了，或者权限没了）：已停止自动生成');
      onState();
    } finally { B.scanning = false; }
    if (changed) render();
  }
  /** 自动生成：打开时，把没生成过、找到窗口的照片生成掉 */
  function maybeAuto() {
    if (!B.dir) return;
    for (const it of B.items) if ((it.state === 'need' || it.state === 'error') && !it.told && B.watch && !dlg.open) { it.told = true; toast(it.state === 'need' ? `「${it.name}」没找到相片窗口，打开“批量生成”手动框一下` : `「${it.name}」没法生成：${it.err}`); }
    if (!B.watch || B.running || B.edit || B.items.some(i => i.state === 'loading')) return;
    const todo = B.items.filter(i => i.state === 'ready' && !i.written && !i.out?.err);
    if (todo.length) runDir(todo);
  }
  function setWatch(on) {
    B.watch = on; render(); onState();
    if (on) maybeAuto();
  }

  /** 现在的参数，写进生成记录 */
  function paramsText() {
    const t = tool(), p = P(), lines = [];
    if (!isHM()) { const m = S.img; lines.push(`  图像调整：阈值 ${m.threshold}，线条加粗 ${m.thicken}mm，反相 ${m.invert ? '开' : '关'}，平滑边缘 ${m.smooth}mm`); }
    const fmtV = (c, v) => c.options ? (c.options.find(o => String(o[0]) === String(v))?.[1] ?? v)
      : c.type === 'toggle' ? (v ? '开' : '关') : `${v}${c.unit || ''}`;
    for (const g of t.groups) {
      const xs = g.params.filter(c => c.label && (!c.show || c.show(p))).map(c => `${c.label} ${fmtV(c, p[c.k])}`);
      if (g.params.some(c => c.type === 'levels') && (!g.params.find(c => c.type === 'levels').show || g.params.find(c => c.type === 'levels').show(p)))
        xs.push(Array.isArray(p.levelH) && p.levelH.length ? `每层高度 ${p.levelH.join(' / ')}mm（层数不一样的图用默认高度）` : '每层高度 默认');
      if (xs.length) lines.push(`  ${g.title}：${xs.join('，')}`);
    }
    const c = (t.cardParams || []).filter(c => !c.show || c.show(p)).map(c => `${c.label} ${fmtV(c, p[c.k])}`);
    if (c.length) lines.push(`  相框图：${c.join('，')}`);
    const e = S.est;
    lines.push(`  导出：${S.fmt.toUpperCase()}；耗材估算按 ${e.mat}、填充 ${e.infill}%、墙 ${e.walls} 层`);
    return lines.join('\n');
  }
  async function appendLog(text) {
    try {
      const fh = await B.outRoot.getFileHandle(LOG, { create: true }), size = (await fh.getFile()).size;
      const w = await fh.createWritable({ keepExistingData: true });
      await w.seek(size); await w.write(text); await w.close();
    } catch (e) { console.warn('生成记录写不了', e); }
  }
  async function runDir(todo) {
    if (!todo.length || B.running || !B.dir) return;
    B.running = true; B.done = 0; B.total = todo.length;
    render();
    const t = tool(), fmt = S.fmt, sig = sigOf(), log = [];
    const pt = paramsText();
    if (pt !== B.loggedP) { B.loggedP = pt; log.push(`\n—— ${new Date().toLocaleString('zh-CN')} 起「${t.name}」用的参数 ——\n${pt}\n`); }
    let ok = 0, g = 0;
    for (const it of todo) {
      await tick();
      try {
        const res = t.build(await artFromFile(await fileOf(it)), S.img, itemP(it));
        const { data, ext } = exportPack(res, fmt);
        let est = null;
        try { est = estimate(res.parts, S.est); } catch { }
        res.parts.forEach(p => p.geo.dispose());
        const nm = outName(it, ext);
        const w = await (await B.outDir.getFileHandle(nm, { create: true })).createWritable();
        await w.write(data); await w.close();
        it.out = { warns: res.warnings || [], g: est?.g ?? null, rows: est?.rows || [] };
        it.written = { name: nm, sig, g: est?.g ?? null };
        ok++; g += est?.g || 0;
        const gTxt = est ? ` · 约 ${fmtG(est.g)} g（${est.rows.map(r => `${r.label} ${fmtG(r.g)}`).join('，')}）` : '';
        log.push(`${hm(new Date())} ✓ ${it.name} → ${OUT}/${t.name}/${nm}${it.mode === 'manual' ? '（手动框的窗口）' : ''}${gTxt}`, ...it.out.warns.map(x => `      提醒：${x}`));
      } catch (e) {
        it.out = { err: e.message || String(e) };
        log.push(`${hm(new Date())} ✗ ${it.name}：${it.out.err}`);
      }
      B.done++;
      render();
    }
    await appendLog(log.join('\n') + '\n');
    B.running = false;
    render();
    const bad = todo.length - ok;
    toast(ok ? `已存到「${OUT}/${t.name}」：${ok} 个${g ? `，共约 ${fmtG(g)} g` : ''}${bad ? `，${bad} 个没生成` : ''}` : '一个都没生成成功，看看每张图下面的原因');
    maybeAuto(); // 生成时又放进来的照片
  }

  function renderEdit() {
    const it = B.edit;
    if (it.state === 'loading' || !it.box) { dlg.innerHTML = `<div class="bt-in"><div class="bt-head"><div><h3>${esc(it.name)}</h3><p>正在读图…</p></div></div><div class="bt-edit"><i class="bt-spin"></i></div></div>`; return; }
    const b = it.box, ratio = tool().photoRatio(P());
    dlg.innerHTML = `<div class="bt-in">
      <div class="bt-head"><div><h3>${esc(it.name)}</h3><p>拖动框移动位置，拖四个角缩放。${ratio ? '框的比例跟着“照片尺寸”走。' : ''}窗口形状和圆角用左边面板里的设置。</p></div></div>
      <div class="bt-edit"><div class="hm-stage"><img src="${it.thumb}" alt="" draggable="false">
        <div class="win-box ${oval()}" style="left:${pct(b.cx - b.w / 2)};top:${pct(b.cy - b.h / 2)};width:${pct(b.w)};height:${pct(b.h)}"><span>相片窗口</span>${HANDLES}</div></div></div>
      <div class="bt-foot">
        ${it.found ? '<button class="chip" data-b="auto">改回自动识别</button>' : ''}
        <button class="chip" data-b="flip">横竖切换</button>
        <span class="bt-sum"></span>
        <button class="btn-primary" data-b="done">完成</button>
      </div></div>`;
  }

  async function startEdit(it) {
    B.edit = it;
    it.mode = 'manual'; it.out = null;
    await (chain = chain.then(() => analyze(it, true)));
  }
  function endEdit() {
    const it = B.edit;
    B.edit = null;
    if (it) { it.art = null; it.info = null; it.written = null; }
    render();
    maybeAuto();
  }
  /** 拖动 / 缩放结束（app.js 的拖框代码调用）：按照片比例重新算一次框 */
  function setBox(nb) {
    const it = B.edit;
    if (!it?.art) return;
    it.box = nb;
    const info = tool().info(it.art, itemP(it));
    it.box = boxOf(info.box); it.info = info;
    renderEdit();
  }

  // ---------- 生成 ----------
  async function run() {
    const todo = B.items.filter(i => i.state === 'ready');
    if (!todo.length || B.running) return;
    B.running = true; B.done = 0; B.total = todo.length;
    render();
    const files = {}, used = new Set(), log = [], t = tool(), fmt = S.fmt;
    let ok = 0;
    for (const it of todo) {
      await tick();
      try {
        const art = await artFromFile(await fileOf(it));
        const res = t.build(art, S.img, itemP(it));
        const { data, ext } = exportPack(res, fmt);
        let est = null;
        try { est = estimate(res.parts, S.est); } catch { }
        res.parts.forEach(pt => pt.geo.dispose());
        const base = baseOf(it.name);
        let nm = base, k = 2;
        while (used.has(nm)) nm = `${base}-${k++}`;
        used.add(nm);
        files[`${nm}.${ext}`] = data instanceof Uint8Array ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
        it.out = { warns: res.warnings || [], g: est?.g ?? null, rows: est?.rows || [] };
        ok++;
        const gTxt = est ? ` · 约 ${fmtG(est.g)} g（${est.rows.map(r => `${r.label} ${fmtG(r.g)}`).join('，')}）` : '';
        log.push(`✓ ${it.name} → ${nm}.${ext}${it.mode === 'manual' ? '（手动框的窗口）' : ''}${gTxt}`, ...it.out.warns.map(w => `    提醒：${w}`));
      } catch (e) {
        it.out = { err: e.message || String(e) };
        log.push(`✗ ${it.name}：${it.out.err}`);
      }
      B.done++;
      render();
    }
    B.items.filter(i => i.state === 'need').forEach(i => log.push(`– ${i.name}：没找到相片窗口，跳过了`));
    B.running = false;
    if (ok) {
      const d = new Date(), stamp = `${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const tg = totalG(), e = S.est;
      const gLine = tg ? `\n耗材估算：共约 ${fmtG(tg)} g ${e.mat}（填充 ${e.infill}% · 墙 ${e.walls} 层，按 P1S 0.20mm 标准估算，以切片软件为准）` : '';
      files['生成记录.txt'] = strToU8(`${t.name} · 批量生成 ${d.toLocaleString('zh-CN')}\n共 ${B.items.length} 张，生成 ${ok} 个${gLine}\n\n参数：\n${paramsText()}\n\n${log.join('\n')}\n`);
      const zip = zipSync(files, { level: 0 }); // 3MF 本身已经压缩过
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      a.download = `${t.name}批量-${stamp}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    render();
    const bad = todo.length - ok;
    toast(ok ? `已下载 zip：${ok} 个${t.name}${totalG() ? `，共约 ${fmtG(totalG())} g` : ''}${bad ? `，${bad} 个没生成` : ''}` : '一个都没生成成功，看看每张图下面的原因');
  }

  // ---------- 事件 ----------
  const fileIn = document.createElement('input');
  Object.assign(fileIn, { type: 'file', multiple: true, hidden: true });
  document.body.appendChild(fileIn);
  const pickFiles = () => { fileIn.accept = isHM() ? 'image/png,image/jpeg,image/webp' : '.svg,image/svg+xml,image/png,image/jpeg,image/webp'; fileIn.click(); };
  fileIn.addEventListener('change', () => { const f = [...fileIn.files]; fileIn.value = ''; if (f.length) open(f); });

  dlg.addEventListener('click', e => {
    const b = e.target.closest('button[data-b]');
    if (!b || b.disabled) return;
    const act = b.dataset.b, it = B.items.find(i => i.id === +b.dataset.id);
    if (act === 'close') dlg.close();
    else if (act === 'add') pickFiles();
    else if (act === 'run') run();
    else if (act === 'runDir') runDir(B.items.filter(i => i.state === 'ready' && !i.written));
    else if (act === 'regen') runDir(B.items.filter(i => i.state === 'ready'));
    else if (act === 'dir') window.showDirectoryPicker({ id: 'printkit-batch', mode: 'readwrite' }).then(connect, e => { if (e.name !== 'AbortError') toast('打不开文件夹：' + e.message); });
    else if (act === 'reconnect' && B.saved) connect(B.saved);
    else if (act === 'disc') disconnect();
    else if (act === 'watch') setWatch(!B.watch);
    else if (act === 'clear') { B.items = []; render(); }
    else if (act === 'del' && it) { if (it.fh) B.ignored.add(it.name); B.items = B.items.filter(i => i !== it); render(); }
    else if (act === 'edit' && it) startEdit(it);
    else if (act === 'done') endEdit();
    else if (act === 'auto' && B.edit) { const x = B.edit; B.edit = null; x.mode = 'auto'; x.box = null; x.art = null; x.info = null; queue(x); }
    else if (act === 'flip' && B.edit?.info) { const { box, art } = B.edit.info; setBox({ cx: box.cx, cy: box.cy, w: box.h * art.h / art.w, h: box.w * art.w / art.h }); }
  });
  // 生成中不能按 Esc 关掉；编辑窗口时 Esc 回到列表
  dlg.addEventListener('cancel', e => { if (B.running) e.preventDefault(); else if (B.edit) { e.preventDefault(); endEdit(); } });

  // 正在往文件夹里写的时候关网页，提醒一下
  addEventListener('beforeunload', e => { if (B.running && B.dir) { e.preventDefault(); e.returnValue = ''; } });

  return {
    open, setBox,
    /** 从某个工具打开：已经有图片或文件夹就直接打开，没有就选图片 */
    pick: id => { open(null, id); if (!B.dir && !B.items.length) pickFiles(); },
    useDir: (h, id) => { if (id) switchTool(id); if (!dlg.open) dlg.showModal(); return connect(h); },
    get toolId() { return B.toolId; }, get toolName() { return tool().name; },
    get running() { return B.running; }, get count() { return B.items.length; },
    get watching() { return !!B.dir && B.watch; }, get dirName() { return B.dir?.name || ''; },
  };
}
