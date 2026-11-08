/*
 * 相框工作室 · 批量生成
 * 多张图用同一套参数，各做一个相框，打包成一个 zip。
 * 为了省内存，每张图只在分析 / 生成的时候读进来，用完就丢，只留缩略图。
 */
import { artFromFile } from './engine.js?v=26';
import { previewHM } from './heightmap.js?v=26';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = () => new Promise(r => setTimeout(r, 0));
const pct = v => (v * 100).toFixed(3) + '%';
const HANDLES = ['nw', 'ne', 'sw', 'se'].map(h => `<i data-h="${h}"></i>`).join('');
const IMG_RE = /\.(png|jpe?g|webp)$/i;

/** deps: S（状态）、P()（当前参数）、tool()、toast(msg)、exportPack(res, fmt) → {data, ext} */
export function makeBatch({ S, P, tool, toast, exportPack }) {
  const dlg = document.getElementById('batch');
  const B = { items: [], sig: '', edit: null, running: false, done: 0, total: 0 };
  let uid = 0, chain = Promise.resolve();

  const itemP = it => ({ ...P(), winMode: it.mode, winBox: it.box });
  const sigOf = () => { const p = { ...P() }; delete p.winMode; delete p.winBox; return JSON.stringify([p, S.img, S.fmt]); };
  const boxOf = b => ({ cx: b.cx, cy: b.cy, w: b.w, h: b.h });
  const oval = () => P().winShape === 'oval' ? 'oval' : '';

  async function analyze(it, keepArt) {
    it.state = 'loading'; render();
    await tick();
    try {
      const art = it.art || await artFromFile(it.file);
      const info = tool().info(art, itemP(it));
      it.found = !!info.autoWin;
      it.levels = info.levels.length;
      it.bg = info.bg?.removed ? info.bg.bgName : '';
      if (it.mode === 'manual') it.box = boxOf(info.box);
      it.thumb = previewHM(info.art, it.mode === 'manual' ? { ...info, win: null } : info, P().invert);
      it.state = it.mode === 'manual' || it.found ? 'ready' : 'need';
      it.art = keepArt ? art : null;
      it.info = keepArt ? info : null;
    } catch (e) { it.state = 'error'; it.err = e.message || '读不出这张图'; it.art = null; it.info = null; }
    render();
  }
  const queue = it => (chain = chain.then(() => analyze(it)));

  function add(files) {
    const imgs = [...files].filter(f => IMG_RE.test(f.name) || /^image\/(png|jpeg|webp)$/.test(f.type));
    if (imgs.length < files.length) toast('只能用 PNG / JPG / WebP 图片，其他文件跳过了');
    for (const f of imgs) { const it = { id: ++uid, file: f, name: f.name, mode: 'auto', box: null, state: 'loading', out: null }; B.items.push(it); queue(it); }
    render();
  }

  function open(files) {
    // 参数变了：缩略图和生成结果都要重新算
    const sig = sigOf();
    if (sig !== B.sig) {
      B.sig = sig;
      B.items.forEach(it => { it.out = null; queue(it); });
    }
    B.edit = null;
    if (!dlg.open) dlg.showModal();
    if (files?.length) add(files);
    render();
  }

  // ---------- 界面 ----------
  function cardHTML(it) {
    const st = {
      loading: '<span class="bt-st">分析中…</span>',
      ready: `<span class="bt-st ok">✓ ${it.mode === 'manual' ? '手动框的窗口' : '找到窗口'}</span>`,
      need: '<span class="bt-st bad">没找到窗口，点“框窗口”</span>',
      error: `<span class="bt-st bad">${esc(it.err)}</span>`,
    }[it.state];
    const out = !it.out ? '' : it.out.err
      ? `<span class="bt-out bad" title="${esc(it.out.err)}">没生成：${esc(it.out.err)}</span>`
      : `<span class="bt-out ok" title="${esc(it.out.warns.join('\n'))}">✓ 已生成${it.out.warns.length ? ` · ${it.out.warns.length} 条提醒` : ''}</span>`;
    const box = it.thumb && it.mode === 'manual' && it.box
      ? `<div class="win-box static ${oval()}" style="left:${pct(it.box.cx - it.box.w / 2)};top:${pct(it.box.cy - it.box.h / 2)};width:${pct(it.box.w)};height:${pct(it.box.h)}"></div>` : '';
    const canEdit = !B.running && (it.state === 'ready' || it.state === 'need');
    return `<div class="bt-card ${it.state}">
      <div class="bt-thumb">${it.thumb ? `<div class="hm-stage"><img src="${it.thumb}" alt="" draggable="false">${box}</div>` : '<i class="bt-spin"></i>'}</div>
      <b title="${esc(it.name)}">${esc(it.name)}</b>${st}${out}
      <div class="bt-acts">
        <button class="chip ${it.state === 'need' ? 'on' : ''}" data-b="edit" data-id="${it.id}" ${canEdit ? '' : 'disabled'}>${it.state === 'need' ? '框窗口' : '调整窗口'}</button>
        <button class="link-btn" data-b="del" data-id="${it.id}" ${B.running ? 'disabled' : ''}>移除</button>
      </div></div>`;
  }

  function render() {
    if (!dlg.open) return;
    if (B.edit) return renderEdit();
    const its = B.items, ready = its.filter(i => i.state === 'ready').length, need = its.filter(i => i.state === 'need').length;
    const loading = its.filter(i => i.state === 'loading').length;
    const ext = S.fmt.toUpperCase();
    const sum = B.running ? `正在生成 ${B.done + 1} / ${B.total}…`
      : !its.length ? '还没有图片'
      : [loading && `${loading} 张分析中`, `${ready} 张可以生成`, need && `${need} 张没框窗口，会跳过`].filter(Boolean).join(' · ');
    const grid = dlg.querySelector('.bt-grid'), y = grid ? grid.scrollTop : 0;
    dlg.innerHTML = `<div class="bt-in">
      <div class="bt-head"><div><h3>批量生成相框</h3>
        <p>每张图用现在的参数各做一个相框：照片尺寸、高度、夹层、挂孔、磁铁都一样。每张图的相片窗口单独识别，找不到的可以手动框。</p></div>
        <button class="bt-x" data-b="close" aria-label="关闭" ${B.running ? 'disabled' : ''}>×</button></div>
      <div class="bt-grid">${its.map(cardHTML).join('')}
        <button class="bt-add" data-b="add" ${B.running ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          添加图片<small>可以一次选多张，也可以拖进来</small></button></div>
      <div class="bt-foot">
        ${B.running ? `<div class="bt-bar"><i style="width:${(B.done / B.total * 100).toFixed(1)}%"></i></div>` : ''}
        <span class="bt-sum">${sum}</span>
        ${its.length && !B.running ? '<button class="link-btn" data-b="clear">全部清空</button>' : ''}
        <button class="btn-primary" data-b="run" ${!ready || loading || B.running ? 'disabled' : ''}>生成 ${ready} 个 ${ext}，下载 zip</button>
      </div></div>`;
    const g2 = dlg.querySelector('.bt-grid'); if (g2) g2.scrollTop = y;
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
    if (it) { it.art = null; it.info = null; }
    render();
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
        const art = await artFromFile(it.file);
        const res = t.build(art, S.img, itemP(it));
        const { data, ext } = exportPack(res, fmt);
        res.parts.forEach(pt => pt.geo.dispose());
        const base = it.name.replace(/\.[^.]+$/, '') || '相框';
        let nm = base, k = 2;
        while (used.has(nm)) nm = `${base}-${k++}`;
        used.add(nm);
        files[`${nm}.${ext}`] = data instanceof Uint8Array ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
        it.out = { warns: res.warnings || [] };
        ok++;
        log.push(`✓ ${it.name} → ${nm}.${ext}${it.mode === 'manual' ? '（手动框的窗口）' : ''}`, ...it.out.warns.map(w => `    提醒：${w}`));
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
      files['生成记录.txt'] = strToU8(`相框工作室 · 批量生成 ${d.toLocaleString('zh-CN')}\n共 ${B.items.length} 张，生成 ${ok} 个\n\n${log.join('\n')}\n`);
      const zip = zipSync(files, { level: 0 }); // 3MF 本身已经压缩过
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      a.download = `相框批量-${stamp}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    render();
    const bad = todo.length - ok;
    toast(ok ? `已下载 zip：${ok} 个相框${bad ? `，${bad} 个没生成` : ''}` : '一个都没生成成功，看看每张图下面的原因');
  }

  // ---------- 事件 ----------
  const fileIn = document.createElement('input');
  Object.assign(fileIn, { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true });
  document.body.appendChild(fileIn);
  fileIn.addEventListener('change', () => { const f = [...fileIn.files]; fileIn.value = ''; if (f.length) open(f); });

  dlg.addEventListener('click', e => {
    const b = e.target.closest('button[data-b]');
    if (!b || b.disabled) return;
    const act = b.dataset.b, it = B.items.find(i => i.id === +b.dataset.id);
    if (act === 'close') dlg.close();
    else if (act === 'add') fileIn.click();
    else if (act === 'run') run();
    else if (act === 'clear') { B.items = []; render(); }
    else if (act === 'del' && it) { B.items = B.items.filter(i => i !== it); render(); }
    else if (act === 'edit' && it) startEdit(it);
    else if (act === 'done') endEdit();
    else if (act === 'auto' && B.edit) { const x = B.edit; B.edit = null; x.mode = 'auto'; x.box = null; x.art = null; x.info = null; queue(x); }
    else if (act === 'flip' && B.edit?.info) { const { box, art } = B.edit.info; setBox({ cx: box.cx, cy: box.cy, w: box.h * art.h / art.w, h: box.w * art.w / art.h }); }
  });
  // 生成中不能按 Esc 关掉；编辑窗口时 Esc 回到列表
  dlg.addEventListener('cancel', e => { if (B.running) e.preventDefault(); else if (B.edit) { e.preventDefault(); endEdit(); } });

  return { open, pick: () => fileIn.click(), setBox, get running() { return B.running; }, get count() { return B.items.length; } };
}
