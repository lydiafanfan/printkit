// 后台线程里重排三角面，页面不会卡住
import { remeshFlat } from './remesh.js?v=51';
onmessage = e => {
  const { id, pos, idx, L } = e.data;
  try {
    const r = remeshFlat(pos, idx, L);
    postMessage({ id, pos: r.pos, idx: r.idx }, [r.pos.buffer, r.idx.buffer]);
  } catch (err) { postMessage({ id, error: String(err?.message || err) }); }
};
