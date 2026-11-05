/*
 * 3MF 导出（3MF Core 规范）。
 * - 每个零件是一个独立的网格对象，带名字和颜色；
 * - 需要叠在一起打印的零件（双色钥匙扣、仿欧根纱）合成一个“组合对象”，
 *   导入 Bambu Studio 后是一个物体里的多个零件，可以分别选 AMS 耗材；
 * - 其他零件（手柄、夹层、底座）是各自独立的物体；
 * - 整体放在 P1S 打印板中心 (128, 128)。
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n4 = v => (Math.round(v * 1e4) / 1e4).toString();

function meshXML(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const m = mergeVertices(g, 1e-4); // 共用顶点 → 封闭网格
  const pos = m.attributes.position, idx = m.index;
  const v = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) v[i] = `<vertex x="${n4(pos.getX(i))}" y="${n4(pos.getY(i))}" z="${n4(pos.getZ(i))}"/>`;
  const t = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (a === b || b === c || a === c) continue; // 去掉退化三角形
    t.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
  }
  g.dispose(); m.dispose();
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh>`;
}

/** parts: [{geo, label, keepPlace, translucent}], colors: 每个零件的 #rrggbb */
export function export3MF(parts, colors, center = [128, 128]) {
  const mats = parts.map((p, i) => `<base name="${esc(p.label || '零件')}" displaycolor="${(colors[i] || '#cccccc').toUpperCase()}FF"/>`);
  const objects = [], items = [];
  let id = 2; // 1 = basematerials
  const meshIds = parts.map((p, i) => {
    const oid = id++;
    objects.push(`<object id="${oid}" type="model" name="${esc(p.label || '零件')}" pid="1" pindex="${i}">${meshXML(p.geo)}</object>`);
    return oid;
  });
  const T = `transform="1 0 0 0 1 0 0 0 1 ${center[0]} ${center[1]} 0"`;
  const group = parts.map((p, i) => (p.keepPlace ? i : -1)).filter(i => i >= 0);
  if (group.length > 1) {
    const oid = id++;
    objects.push(`<object id="${oid}" type="model" name="${esc(parts[group[0]].label)}+${group.length - 1}"><components>${group.map(i => `<component objectid="${meshIds[i]}"/>`).join('')}</components></object>`);
    items.push(`<item objectid="${oid}" ${T}/>`);
  }
  parts.forEach((p, i) => { if (!(group.length > 1 && p.keepPlace)) items.push(`<item objectid="${meshIds[i]}" ${T}/>`); });

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="zh-CN" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">PrintKit 打印助手</metadata>
<resources><basematerials id="1">${mats.join('')}</basematerials>${objects.join('')}</resources>
<build>${items.join('')}</build>
</model>`;
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),
    '3D/3dmodel.model': strToU8(model),
  };
  return zipSync(files, { level: 6 });
}
