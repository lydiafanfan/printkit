/*
 * GLB 导出（给 Blender / Nomad Sculpt 二次编辑）
 * - 每个零件是一个独立物体，带名字和颜色；
 * - 网格已经是封闭实体（见 solid.js），可以直接布尔运算、重新拓扑、平滑；
 * - 单位：1 = 1 毫米。Blender 里看起来会很大（按米显示），导出 STL 时比例保持 1，切片软件里就是原尺寸；
 * - glTF 规定 Y 朝上，这里把 Z 朝上的模型转过去，Blender / Nomad 导入后会自动转回来。
 */
const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const rgb = hex => { const n = parseInt(String(hex || '#cccccc').slice(1, 7), 16); return [lin((n >> 16 & 255) / 255), lin((n >> 8 & 255) / 255), lin((n & 255) / 255)]; };

/** meshes: [{pos: Float32Array(xyz, Z 朝上), idx: Uint32Array, label, color}] → ArrayBuffer */
export function exportGLB(meshes) {
  const json = {
    asset: { version: '2.0', generator: 'PrintKit 打印助手' },
    scene: 0, scenes: [{ name: 'PrintKit', nodes: meshes.map((_, i) => i) }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
  };
  const chunks = [];
  let off = 0;
  const push = (arr, target) => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, target });
    chunks.push(bytes); off += bytes.byteLength;
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
    return json.bufferViews.length - 1;
  };
  meshes.forEach((m, i) => {
    const n = m.pos.length / 3, p = new Float32Array(n * 3);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < n; k++) {
      const x = m.pos[k * 3], y = m.pos[k * 3 + 2], z = -m.pos[k * 3 + 1]; // Z 朝上 → Y 朝上
      p[k * 3] = x; p[k * 3 + 1] = y; p[k * 3 + 2] = z;
      if (x < mn[0]) mn[0] = x; if (y < mn[1]) mn[1] = y; if (z < mn[2]) mn[2] = z;
      if (x > mx[0]) mx[0] = x; if (y > mx[1]) mx[1] = y; if (z > mx[2]) mx[2] = z;
    }
    const vPos = push(p, 34962), vIdx = push(m.idx, 34963);
    json.accessors.push({ bufferView: vPos, componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx });
    json.accessors.push({ bufferView: vIdx, componentType: 5125, count: m.idx.length, type: 'SCALAR' });
    json.materials.push({ name: m.label || `零件 ${i + 1}`, pbrMetallicRoughness: { baseColorFactor: [...rgb(m.color), 1], metallicFactor: 0, roughnessFactor: 0.8 } });
    json.meshes.push({ name: m.label || `零件 ${i + 1}`, primitives: [{ attributes: { POSITION: json.accessors.length - 2 }, indices: json.accessors.length - 1, material: i }] });
    json.nodes.push({ name: m.label || `零件 ${i + 1}`, mesh: i });
  });
  json.buffers.push({ byteLength: off });

  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jPad) { const t = new Uint8Array(jsonBytes.length + jPad).fill(0x20); t.set(jsonBytes); jsonBytes = t; }
  const total = 12 + 8 + jsonBytes.length + 8 + off;
  const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true); // "glTF" v2
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(jsonBytes, 20); // JSON
  let k = 20 + jsonBytes.length;
  dv.setUint32(k, off, true); dv.setUint32(k + 4, 0x004E4942, true); k += 8; // BIN
  for (const c of chunks) { u8.set(c, k); k += c.byteLength; }
  return out;
}
