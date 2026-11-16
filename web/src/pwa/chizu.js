// chizu.js — 地図。車の印を押す前に、どこへ行くのかを先に見せる。
//
// 2026-11-16 20:32 船長:「車のマークおすまえに、地図、ルートと駐車場所は、先に提示しておく。でないと怖くて押せないから。
//   みていて、前まで行けば警備の方が案内してくれます。」
// - 地図の絵は、国土地理院の地理院タイル(淡色地図)。鍵なし・無料。国土地理院のサーバーから、その場で読んで出す
//   (この使い方は、出典を出せば申請は要らない。出典は、地図が画面に出ている間、いつも見える所に)。
// - 取りに行くのは「行き先のあたりの絵」だけ。見ている人の位置は使わない・送らない。
// - 印(P など)は Senlings が上に重ねる。施設の図は、ここにも repo にも入れない(行き先の一点は、現場の案内から来る)。
// - 絵が一枚も取れないとき(圏外など)は、地図ごと出さない。車の印は、そのまま使える。

export const TILE = 256;
export const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
// 絵の上に印を重ねているので、「追記」と書く(国土地理院コンテンツ利用規約の書き方)
export const SHUTTEN = '地理院タイルに印を追記';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const usable = p => p && finite(p.lat) && finite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;

/** 緯度・経度 → その zoom での世界のピクセル(Web メルカトル。左上が 0,0) */
export function worldPx(lat, lng, z) {
  const n = TILE * 2 ** z;
  const s = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/**
 * 絵の割り付け(画面に依らない)。points: [{lat,lng}]。
 * 一点なら zoom 16(まわりの道が入る広さ)。いくつかあるなら、全部が余白つきで入る一番大きい zoom(17 まで)。
 * 返すもの:{ z, w, h, tiles:[{z,x,y,left,top}], pts:[{x,y}] }(left/top と pts は、絵の左上からのピクセル)。点が無ければ null。
 */
export function chizuPlan(points, { w = 360, h = 240, pad = 44, zOne = 16, zMax = 17, zMin = 10 } = {}) {
  const ps = (Array.isArray(points) ? points : []).filter(usable);
  if (!ps.length) return null;
  const boxAt = z => {
    const px = ps.map(p => worldPx(p.lat, p.lng, z));
    const xs = px.map(p => p.x), ys = px.map(p => p.y);
    return { px, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  };
  let z = zOne, b = boxAt(z);
  if (ps.length > 1) {
    for (z = zMax; z > zMin; z--) { b = boxAt(z); if (b.maxX - b.minX <= w - 2 * pad && b.maxY - b.minY <= h - 2 * pad) break; }
    b = boxAt(z);
  }
  const left = Math.round((b.minX + b.maxX) / 2 - w / 2), top = Math.round((b.minY + b.maxY) / 2 - h / 2);
  const n = 2 ** z, tiles = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h - 1) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w - 1) / TILE); tx++) {
      tiles.push({ z, x: ((tx % n) + n) % n, y: ty, left: tx * TILE - left, top: ty * TILE - top });
    }
  }
  return { z, w, h, tiles, pts: b.px.map(p => ({ x: p.x - left, y: p.y - top })) };
}

export const tileUrl = t => TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => { const e = document.createElementNS(SVG_NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const pct = v => `${Math.round(v * 1e4) / 1e4}%`;

// 印の絵。いまは P(車を停める所)だけ。青地に白の P は、道路の駐車場の標識と同じ
function markP({ x, y }) {
  const g = svgEl('g', { class: 'chizu-mark chizu-p', transform: `translate(${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10})` });
  g.append(svgEl('circle', { r: 17, fill: '#0008' }), svgEl('circle', { r: 16, fill: '#fff' }), svgEl('circle', { r: 13.5, fill: '#1456c4' }));
  const t = svgEl('text', { y: 6.5, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#fff', 'font-family': 'Arial, Helvetica, sans-serif' });
  t.textContent = 'P';
  g.append(t);
  return g;
}

/**
 * 地図を描く。marks: [{ kind: 'p', lat, lng }]。描けたら true。
 * el は入れもの(hidden を持つ)。点が無いとき・絵が一枚も取れないときは、el ごと隠す。
 */
export function renderChizu(el, marks, { label = '車の行き先の地図' } = {}) {
  el.replaceChildren();
  const ms = (Array.isArray(marks) ? marks : []).filter(usable);
  const plan = chizuPlan(ms);
  el.hidden = !plan;
  if (!plan) return false;
  const box = Object.assign(document.createElement('div'), { className: 'chizu' });
  box.style.paddingBottom = pct(plan.h / plan.w * 100); // 高さは幅から(古い端末でも効く書き方)
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  let waiting = plan.tiles.length, got = 0;
  const settle = () => { if (waiting === 0 && got === 0) { el.hidden = true; el.replaceChildren(); } };
  for (const t of plan.tiles) {
    const img = Object.assign(document.createElement('img'), { alt: '', decoding: 'async', draggable: false });
    // 継ぎ目に髪の毛ほどの隙間が出ないよう、1px だけ重ねる
    Object.assign(img.style, { left: pct(t.left / plan.w * 100), top: pct(t.top / plan.h * 100), width: `calc(${pct(TILE / plan.w * 100)} + 1px)`, height: `calc(${pct(TILE / plan.h * 100)} + 1px)` });
    img.onload = () => { waiting--; got++; };
    img.onerror = () => { waiting--; img.remove(); settle(); };
    img.src = tileUrl(t);
    box.append(img);
  }
  const svg = svgEl('svg', { viewBox: `0 0 ${plan.w} ${plan.h}`, 'aria-hidden': 'true' });
  ms.forEach((m, i) => { if (m.kind === 'p') svg.append(markP(plan.pts[i])); });
  box.append(svg, Object.assign(document.createElement('span'), { className: 'chizu-shutten', textContent: SHUTTEN }));
  el.append(box);
  return true;
}
