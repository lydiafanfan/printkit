// 内置示例线稿（原创的简单图形），方便打开就能试
const svg = (vb, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;

const petals = Array.from({ length: 8 }, (_, i) =>
  `<ellipse cx="0" cy="-25" rx="9.5" ry="16" transform="rotate(${i * 45})"/>`).join('');

function scallopFrame() {
  // 120×160 的花边相框：外圈波浪边 + 内圈细线 + 四角小花
  const d = 10, x0 = 10, y0 = 10, x1 = 110, y1 = 150;
  let p = `M${x0} ${y0}`;
  for (let x = x0; x < x1; x += d) p += ` a5 5 0 0 1 ${d} 0`;
  for (let y = y0; y < y1; y += d) p += ` a5 5 0 0 1 0 ${d}`;
  for (let x = x1; x > x0; x -= d) p += ` a5 5 0 0 1 ${-d} 0`;
  for (let y = y1; y > y0; y -= d) p += ` a5 5 0 0 1 0 ${-d}`;
  p += 'Z';
  const flower = (cx, cy) => `<g transform="translate(${cx} ${cy})">${Array.from({ length: 5 }, (_, i) => `<circle cx="0" cy="-3.2" r="2.1" transform="rotate(${i * 72})"/>`).join('')}<circle r="1.4" fill="#fff"/></g>`;
  return svg('0 0 120 160', `
    <path d="${p}" fill="none" stroke="#000" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="19" y="19" width="82" height="122" rx="5" fill="none" stroke="#000" stroke-width="1.6"/>
    ${flower(19, 19)}${flower(101, 19)}${flower(19, 141)}${flower(101, 141)}
    <circle cx="60" cy="14.5" r="1.6"/><circle cx="60" cy="145.5" r="1.6"/><circle cx="14.5" cy="80" r="1.6"/><circle cx="105.5" cy="80" r="1.6"/>`);
}

export const SAMPLES = [
  {
    id: 'daisy', name: '小雏菊',
    svg: svg('-50 -50 100 100', `<g fill="none" stroke="#000" stroke-width="3.6">${petals}</g><circle r="10" fill="#fff" stroke="#000" stroke-width="3.6"/><circle r="4"/>`),
  },
  {
    id: 'heart', name: '爱心',
    svg: svg('0 0 100 90', `<path d="M50 84 C22 64 6 48 8 30 C10 13 32 4 50 22 C68 4 90 13 92 30 C94 48 78 64 50 84Z"/>`),
  },
  {
    id: 'cat', name: '小猫',
    svg: svg('0 0 100 100', `
      <path d="M20 44 L16 14 L38 28 Q50 24 62 28 L84 14 L80 44 Q88 60 78 74 Q66 88 50 88 Q34 88 22 74 Q12 60 20 44Z" fill="none" stroke="#000" stroke-width="4.2" stroke-linejoin="round"/>
      <circle cx="37" cy="54" r="5"/><circle cx="63" cy="54" r="5"/>
      <path d="M45 64 L55 64 L50 70Z"/>
      <path d="M50 70 Q46 77 40 74 M50 70 Q54 77 60 74" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round"/>
      <path d="M8 60 L28 63 M10 70 L28 68 M92 60 L72 63 M90 70 L72 68" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>`),
  },
  {
    id: 'house', name: '小房子',
    svg: svg('0 0 100 100', `<g fill="none" stroke="#000" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round">
      <path d="M14 46 L50 16 L86 46"/><path d="M24 40 V86 H76 V40"/><path d="M43 86 V64 H57 V86"/>
      <rect x="31" y="50" width="11" height="10"/><rect x="60" y="50" width="11" height="10"/><path d="M66 26 V16 H74 V33"/></g>`),
  },
  {
    id: 'star', name: '星星',
    svg: svg('0 0 100 100', `<path d="M50 6 L61.8 36 L94 38 L69 58.6 L77.6 90 L50 72 L22.4 90 L31 58.6 L6 38 L38.2 36Z" fill="none" stroke="#000" stroke-width="6" stroke-linejoin="round"/>`),
  },
  {
    id: 'butterfly', name: '蝴蝶',
    svg: svg('0 0 100 100', `<g fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
      <path d="M50 46 C42 24 22 10 12 20 C4 30 12 46 26 50 C36 52 44 50 50 48 Z"/>
      <path d="M50 46 C58 24 78 10 88 20 C96 30 88 46 74 50 C64 52 56 50 50 48 Z"/>
      <path d="M50 52 C40 54 24 60 22 72 C21 84 34 88 42 80 C47 74 49 64 50 56 Z"/>
      <path d="M50 52 C60 54 76 60 78 72 C79 84 66 88 58 80 C53 74 51 64 50 56 Z"/>
      <path d="M22 26 C28 32 36 38 46 44 M78 26 C72 32 64 38 54 44 M30 70 C36 66 42 62 48 58 M70 70 C64 66 58 62 52 58"/>
      <path d="M48 40 C44 30 40 24 34 20 M52 40 C56 30 60 24 66 20"/>
      </g><ellipse cx="50" cy="56" rx="3.2" ry="17"/>`),
  },
  { id: 'frame', name: '花边相框', svg: scallopFrame() },
];
